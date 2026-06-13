from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import Event, FilamentSpool, FilamentUsage, Printer
from ..schemas import FilamentAdjustment, FilamentSpoolCreate, FilamentUsageCreate
from ..utils.filament import default_density_for_material


router = APIRouter(prefix="/filaments", tags=["filaments"])


def _clean_status(status: str) -> str:
    value = (status or "active").strip().lower()
    if value not in {"active", "empty", "archived"}:
        raise HTTPException(status_code=400, detail="Spool status must be active, empty or archived")
    return value


def _validate_spool_payload(data: FilamentSpoolCreate):
    if not (data.name or "").strip():
        raise HTTPException(status_code=400, detail="Spool name is required")
    if data.initial_weight_g <= 0:
        raise HTTPException(status_code=400, detail="Initial weight must be greater than zero")
    if data.remaining_weight_g is not None and data.remaining_weight_g < 0:
        raise HTTPException(status_code=400, detail="Remaining weight cannot be negative")
    if data.diameter_mm <= 0:
        raise HTTPException(status_code=400, detail="Diameter must be greater than zero")
    if data.density_g_cm3 <= 0:
        raise HTTPException(status_code=400, detail="Density must be greater than zero")


def serialize_spool(spool: FilamentSpool):
    initial = float(spool.initial_weight_g or 0)
    remaining = float(spool.remaining_weight_g or 0)
    used = max(0.0, initial - remaining)
    percent = (remaining / initial * 100) if initial > 0 else 0
    loaded_printer = spool.__dict__.get("printer")
    return {
        "id": spool.id,
        "name": spool.name,
        "material": spool.material,
        "brand": spool.brand,
        "colour": spool.colour,
        "diameter_mm": spool.diameter_mm,
        "density_g_cm3": spool.density_g_cm3,
        "initial_weight_g": initial,
        "remaining_weight_g": remaining,
        "empty_spool_weight_g": spool.empty_spool_weight_g,
        "printer_id": spool.printer_id,
        "printer_name": loaded_printer.name if loaded_printer else None,
        "status": spool.status,
        "notes": spool.notes,
        "remaining_percent": round(max(0.0, min(100.0, percent)), 1),
        "used_weight_g": round(used, 1),
        "created_at": spool.__dict__.get("created_at"),
        "updated_at": spool.__dict__.get("updated_at"),
    }


async def _ensure_printer_exists(db: AsyncSession, printer_id: int | None):
    if not printer_id:
        return None
    printer = (await db.execute(select(Printer).where(Printer.id == printer_id))).scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")
    return printer


async def _mark_as_only_loaded_spool(db: AsyncSession, spool: FilamentSpool):
    if not spool.printer_id or spool.status != "active":
        return
    result = await db.execute(
        select(FilamentSpool).where(
            FilamentSpool.printer_id == spool.printer_id,
            FilamentSpool.status == "active",
            FilamentSpool.id != spool.id,
        )
    )
    for other in result.scalars().all():
        other.printer_id = None


async def deduct_spool_usage(
    db: AsyncSession,
    spool: FilamentSpool,
    usage_g: float,
    *,
    printer_id: int | None = None,
    slicer_job_id: int | None = None,
    gcode_path: str | None = None,
    usage_mm: float | None = None,
    reason: str = "print_started",
    note: str | None = None,
):
    if usage_g <= 0:
        raise HTTPException(status_code=400, detail="Usage must be greater than zero")

    spool.remaining_weight_g = max(0.0, float(spool.remaining_weight_g or 0) - usage_g)
    if spool.remaining_weight_g <= 0:
        spool.status = "empty"

    record = FilamentUsage(
        spool_id=spool.id,
        printer_id=printer_id,
        slicer_job_id=slicer_job_id,
        gcode_path=gcode_path,
        usage_g=usage_g,
        usage_mm=usage_mm,
        reason=reason,
        note=note,
    )
    db.add(record)
    db.add(Event(
        printer_id=printer_id,
        severity="info" if spool.remaining_weight_g > 0 else "warning",
        event_type="filament_usage",
        message=f"Deducted {usage_g:.1f}g from {spool.name}",
        details={"spool_id": spool.id, "remaining_weight_g": spool.remaining_weight_g, "reason": reason},
    ))
    await db.flush()
    return record


@router.get("/spools")
async def list_spools(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(FilamentSpool)
        .options(selectinload(FilamentSpool.printer))
        .order_by(FilamentSpool.status, FilamentSpool.name)
    )
    return [serialize_spool(spool) for spool in result.scalars().all()]


@router.post("/spools")
async def create_spool(data: FilamentSpoolCreate, db: AsyncSession = Depends(get_db)):
    _validate_spool_payload(data)
    printer = await _ensure_printer_exists(db, data.printer_id)
    material = (data.material or "PLA").strip().upper()
    remaining = data.remaining_weight_g if data.remaining_weight_g is not None else data.initial_weight_g
    spool = FilamentSpool(
        name=data.name.strip(),
        material=material,
        brand=(data.brand or "").strip() or None,
        colour=(data.colour or "").strip() or None,
        diameter_mm=data.diameter_mm,
        density_g_cm3=data.density_g_cm3 or default_density_for_material(material),
        initial_weight_g=data.initial_weight_g,
        remaining_weight_g=remaining,
        empty_spool_weight_g=data.empty_spool_weight_g,
        printer_id=data.printer_id,
        status=_clean_status(data.status),
        notes=data.notes,
    )
    if printer:
        spool.printer = printer
    db.add(spool)
    await db.flush()
    await _mark_as_only_loaded_spool(db, spool)
    db.add(Event(severity="info", event_type="filament_spool_created", message=f"Filament spool added: {spool.name}"))
    await db.flush()
    return serialize_spool(spool)


@router.put("/spools/{spool_id}")
async def update_spool(spool_id: int, data: FilamentSpoolCreate, db: AsyncSession = Depends(get_db)):
    _validate_spool_payload(data)
    await _ensure_printer_exists(db, data.printer_id)
    spool = (await db.execute(
        select(FilamentSpool).options(selectinload(FilamentSpool.printer)).where(FilamentSpool.id == spool_id)
    )).scalar_one_or_none()
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")

    material = (data.material or "PLA").strip().upper()
    spool.name = data.name.strip()
    spool.material = material
    spool.brand = (data.brand or "").strip() or None
    spool.colour = (data.colour or "").strip() or None
    spool.diameter_mm = data.diameter_mm
    spool.density_g_cm3 = data.density_g_cm3 or default_density_for_material(material)
    spool.initial_weight_g = data.initial_weight_g
    spool.remaining_weight_g = data.remaining_weight_g if data.remaining_weight_g is not None else spool.remaining_weight_g
    spool.empty_spool_weight_g = data.empty_spool_weight_g
    spool.printer_id = data.printer_id
    spool.status = _clean_status(data.status)
    spool.notes = data.notes
    await db.flush()
    await _mark_as_only_loaded_spool(db, spool)
    db.add(Event(severity="info", event_type="filament_spool_updated", message=f"Filament spool updated: {spool.name}"))
    await db.flush()
    return serialize_spool(spool)


@router.delete("/spools/{spool_id}")
async def delete_spool(spool_id: int, db: AsyncSession = Depends(get_db)):
    spool = (await db.execute(select(FilamentSpool).where(FilamentSpool.id == spool_id))).scalar_one_or_none()
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    name = spool.name
    await db.delete(spool)
    db.add(Event(severity="warning", event_type="filament_spool_deleted", message=f"Filament spool deleted: {name}"))
    await db.flush()
    return {"status": "success"}


@router.get("/spools/{spool_id}/usage")
async def list_spool_usage(spool_id: int, db: AsyncSession = Depends(get_db)):
    spool = (await db.execute(select(FilamentSpool).where(FilamentSpool.id == spool_id))).scalar_one_or_none()
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    result = await db.execute(
        select(FilamentUsage)
        .where(FilamentUsage.spool_id == spool_id)
        .order_by(desc(FilamentUsage.created_at))
        .limit(100)
    )
    return [
        {
            "id": row.id,
            "spool_id": row.spool_id,
            "printer_id": row.printer_id,
            "slicer_job_id": row.slicer_job_id,
            "gcode_path": row.gcode_path,
            "usage_g": row.usage_g,
            "usage_mm": row.usage_mm,
            "reason": row.reason,
            "note": row.note,
            "created_at": row.created_at,
        }
        for row in result.scalars().all()
    ]


@router.post("/spools/{spool_id}/usage")
async def add_spool_usage(spool_id: int, data: FilamentUsageCreate, db: AsyncSession = Depends(get_db)):
    spool = (await db.execute(
        select(FilamentSpool).options(selectinload(FilamentSpool.printer)).where(FilamentSpool.id == spool_id)
    )).scalar_one_or_none()
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    await _ensure_printer_exists(db, data.printer_id)
    await deduct_spool_usage(
        db,
        spool,
        data.usage_g,
        printer_id=data.printer_id,
        slicer_job_id=data.slicer_job_id,
        gcode_path=data.gcode_path,
        usage_mm=data.usage_mm,
        reason=data.reason,
        note=data.note,
    )
    await db.flush()
    return serialize_spool(spool)


@router.post("/spools/{spool_id}/adjust")
async def adjust_spool(spool_id: int, data: FilamentAdjustment, db: AsyncSession = Depends(get_db)):
    spool = (await db.execute(
        select(FilamentSpool).options(selectinload(FilamentSpool.printer)).where(FilamentSpool.id == spool_id)
    )).scalar_one_or_none()
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    spool.remaining_weight_g = max(0.0, float(spool.remaining_weight_g or 0) + data.delta_g)
    if spool.remaining_weight_g > 0 and spool.status == "empty":
        spool.status = "active"
    db.add(FilamentUsage(
        spool_id=spool.id,
        printer_id=spool.printer_id,
        usage_g=-data.delta_g,
        reason="manual_adjustment",
        note=data.note,
    ))
    db.add(Event(
        printer_id=spool.printer_id,
        severity="info",
        event_type="filament_adjustment",
        message=f"Adjusted {spool.name} by {data.delta_g:+.1f}g",
        details={"spool_id": spool.id, "remaining_weight_g": spool.remaining_weight_g},
    ))
    await db.flush()
    return serialize_spool(spool)
