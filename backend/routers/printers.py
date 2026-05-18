from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
import asyncio
import httpx
from ..database import get_db
from ..models import Printer, Node, PrinterNote, Event
from ..schemas import PrinterCreate, Printer as PrinterSchema, PrinterDetail
from .nodes import serialize_node
import datetime

router = APIRouter(prefix="/printers", tags=["printers"])

async def probe_printer_status(printer):
    if not printer.assigned_node_id or not printer.node or not printer.moonraker_port:
        return printer.status or "offline"

    url = f"http://{printer.node.ip_address}:{printer.moonraker_port}/server/info"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=1.5)
        if res.status_code != 200:
            return "offline"

        payload = res.json()
        info = payload.get("result", payload)
        klippy_state = str(info.get("klippy_state") or "").lower()
        klippy_connected = info.get("klippy_connected")

        if klippy_state == "ready":
            return "idle"
        if klippy_state in ("error", "shutdown"):
            return "error"
        if klippy_state in ("startup", "connecting"):
            return "starting"
        if klippy_connected is True:
            return "online"
        return "offline"
    except Exception:
        return "offline"

def serialize_printer(printer, include_node=False, status_override=None):
    """Utility to serialize SQLAlchemy Printer model to dict to avoid MissingGreenlet errors"""
    data = {
        "id": printer.id,
        "name": printer.name,
        "slug": printer.slug,
        "mcu_serial": printer.mcu_serial,
        "expected_mcu_serial": printer.expected_mcu_serial,
        "klipper_service_name": printer.klipper_service_name,
        "moonraker_service_name": printer.moonraker_service_name,
        "moonraker_port": printer.moonraker_port,
        "config_path": printer.config_path,
        "gcode_path": printer.gcode_path,
        "webcam_url": printer.webcam_url,
        "embedded_ui_url": printer.embedded_ui_url,
        "status": status_override if status_override is not None else printer.status,
        "last_seen": printer.last_seen,
        "assigned_node_id": printer.assigned_node_id,
        "created_at": printer.created_at,
        "updated_at": printer.updated_at,
    }
    if include_node and printer.node:
        data["node"] = serialize_node(printer.node)
    return data

@router.post("/", response_model=PrinterSchema)
async def create_printer(printer_in: PrinterCreate, db: AsyncSession = Depends(get_db)):
    printer = Printer(**printer_in.model_dump())
    printer.created_at = datetime.datetime.now(datetime.timezone.utc)
    db.add(printer)

    # Record event
    event = Event(
        severity="info",
        event_type="printer_creation",
        message=f"Printer {printer.name} created."
    )
    db.add(event)

    await db.commit()
    await db.refresh(printer)
    return serialize_printer(printer)

@router.get("/", response_model=List[PrinterDetail])
async def list_printers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer))
    printers = result.scalars().all()
    statuses = await asyncio.gather(*(probe_printer_status(p) for p in printers))
    return [
        serialize_printer(printer, include_node=True, status_override=status)
        for printer, status in zip(printers, statuses)
    ]

@router.get("/{printer_id}", response_model=PrinterSchema)
async def get_printer(printer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")
    return serialize_printer(printer)

@router.put("/{printer_id}", response_model=PrinterSchema)
async def update_printer(printer_id: int, printer_in: PrinterCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    for field, value in printer_in.model_dump(exclude_unset=True).items():
        setattr(printer, field, value)

    await db.commit()
    await db.refresh(printer)
    return serialize_printer(printer)

@router.get("/{printer_id}/detail", response_model=PrinterDetail)
async def get_printer_detail(printer_id: int, db: AsyncSession = Depends(get_db)):
    """Extended endpoint that explicitly loads the assigned node"""
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    status = await probe_printer_status(printer)
    data = serialize_printer(printer, include_node=True, status_override=status)

    return data

@router.post("/{printer_id}/restart")
async def restart_printer_services(printer_id: int, target: str = Body(..., embed=True), db: AsyncSession = Depends(get_db)):
    """Remote restart for specific printer services (klipper, moonraker, or both)"""
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer: raise HTTPException(status_code=404, detail="Printer not found")

    if not printer.assigned_node_id:
        raise HTTPException(status_code=400, detail="Printer not assigned to any node")

    node_result = await db.execute(select(Node).where(Node.id == printer.assigned_node_id))
    node = node_result.scalar_one_or_none()

    services = []
    if target == "klipper" or target == "all":
        services.append(f"klipper-{printer.slug}")
    if target == "moonraker" or target == "all":
        services.append(f"moonraker-{printer.slug}")

    url = f"http://{node.ip_address}:{node.agent_port}/instances/restart"

    results = []
    async with httpx.AsyncClient() as client:
        for svc in services:
            try:
                res = await client.post(url, json={"service": svc}, timeout=10)
                results.append(res.json())
            except Exception as e:
                results.append({"service": svc, "error": str(e)})

    db.add(Event(
        printer_id=printer.id,
        node_id=node.id,
        severity="info",
        event_type="printer_restart",
        message=f"Restarted {target} for printer {printer.name}"
    ))
    await db.commit()

    return {"status": "success", "results": results}
