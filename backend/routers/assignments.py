from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Printer, Node, Event
from pydantic import BaseModel
import httpx

router = APIRouter(prefix="/assignments", tags=["assignments"])

class MigrationRequest(BaseModel):
    printer_id: int
    target_node_id: int
    confirmed: bool = False

async def _get_printer_and_target(req: MigrationRequest, db: AsyncSession):
    result = await db.execute(select(Printer).where(Printer.id == req.printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    target_result = await db.execute(select(Node).where(Node.id == req.target_node_id))
    target_node = target_result.scalar_one_or_none()
    if not target_node:
        raise HTTPException(status_code=404, detail="Target node not found")

    old_node = None
    if printer.assigned_node_id:
        old_result = await db.execute(select(Node).where(Node.id == printer.assigned_node_id))
        old_node = old_result.scalar_one_or_none()

    return printer, old_node, target_node

async def _safe_node_get(node: Node, path: str, timeout: int = 5):
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"http://{node.ip_address}:{node.agent_port}{path}", timeout=timeout)
        if res.status_code != 200:
            return None, f"HTTP {res.status_code}"
        return res.json(), None
    except Exception as exc:
        return None, str(exc)

async def _safe_node_post(node: Node, path: str, payload: dict, timeout: int = 10):
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(f"http://{node.ip_address}:{node.agent_port}{path}", json=payload, timeout=timeout)
        if res.status_code != 200:
            return None, f"HTTP {res.status_code}: {res.text[:200]}"
        return res.json(), None
    except Exception as exc:
        return None, str(exc)

async def build_preflight(printer: Printer, old_node: Node | None, target_node: Node):
    target_usb, target_usb_error = await _safe_node_get(target_node, "/usb")
    target_instances, target_instances_error = await _safe_node_get(target_node, "/instances")
    old_health_error = None
    old_online = False
    if old_node:
        _, old_health_error = await _safe_node_get(old_node, "/health", timeout=3)
        old_online = old_health_error is None

    expected = (printer.expected_mcu_serial or printer.mcu_serial or "").strip()
    usb_devices = target_usb if isinstance(target_usb, list) else []
    target_has_mcu = bool(expected) and any(
        expected in str(device.get("id") or device.get("path") or "")
        for device in usb_devices
    )
    target_online = target_usb_error is None and target_instances_error is None
    warnings = []
    if not target_online:
        warnings.append("Target node is not answering all preflight checks.")
    if expected and not target_has_mcu:
        warnings.append("Expected MCU serial was not found on the target node.")
    if old_node and not old_online:
        warnings.append("Current node is offline; old services cannot be stopped automatically.")
    if not expected:
        warnings.append("Printer has no expected MCU serial recorded, so USB suitability is advisory only.")

    return {
        "printer_id": printer.id,
        "target_node_id": target_node.id,
        "old_node_id": old_node.id if old_node else None,
        "target_online": target_online,
        "old_online": old_online,
        "expected_mcu_serial": expected,
        "target_has_expected_mcu": target_has_mcu,
        "usb_devices": usb_devices,
        "service_instances": target_instances if isinstance(target_instances, list) else [],
        "warnings": warnings,
        "can_migrate": target_online and (not expected or target_has_mcu),
        "requires_confirmation": bool(warnings),
        "errors": {
            "target_usb": target_usb_error,
            "target_instances": target_instances_error,
            "old_health": old_health_error,
        },
    }

@router.post("/check")
async def migration_preflight(req: MigrationRequest, db: AsyncSession = Depends(get_db)):
    printer, old_node, target_node = await _get_printer_and_target(req, db)
    return await build_preflight(printer, old_node, target_node)

@router.post("/migrate")
async def migrate_printer(req: MigrationRequest, db: AsyncSession = Depends(get_db)):
    printer, old_node, target_node = await _get_printer_and_target(req, db)
    old_node_id = printer.assigned_node_id
    preflight = await build_preflight(printer, old_node, target_node)
    if not preflight["can_migrate"] and not req.confirmed:
        raise HTTPException(status_code=400, detail={"message": "Migration preflight failed", "preflight": preflight})
    if preflight["requires_confirmation"] and not req.confirmed:
        raise HTTPException(status_code=409, detail={"message": "Migration requires confirmation", "preflight": preflight})

    stop_results = []
    start_results = []
    service_names = [
        printer.klipper_service_name or f"klipper-{printer.slug}",
        printer.moonraker_service_name or f"moonraker-{printer.slug}",
    ]

    if old_node and preflight.get("old_online"):
        for service in service_names:
            result, error = await _safe_node_post(old_node, "/instances/stop", {"service": service})
            stop_results.append({"service": service, "result": result, "error": error})

    printer.assigned_node_id = req.target_node_id

    for service in service_names:
        result, error = await _safe_node_post(target_node, "/instances/start", {"service": service})
        start_results.append({"service": service, "result": result, "error": error})

    moonraker_ok = False
    if printer.moonraker_port:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"http://{target_node.ip_address}:{printer.moonraker_port}/server/info", timeout=4)
            moonraker_ok = res.status_code == 200
        except Exception:
            moonraker_ok = False

    event = Event(
        printer_id=req.printer_id,
        node_id=req.target_node_id,
        severity="info" if moonraker_ok else "warning",
        event_type="migration",
        message=f"Printer {printer.name} migrated from node {old_node_id} to {req.target_node_id}",
        details={
            "old_node_id": old_node_id,
            "new_node_id": req.target_node_id,
            "preflight": preflight,
            "stop_results": stop_results,
            "start_results": start_results,
            "moonraker_verified": moonraker_ok,
        },
    )
    db.add(event)

    await db.flush()
    return {
        "status": "success",
        "message": f"Migrated {printer.name} to {target_node.hostname}",
        "preflight": preflight,
        "stop_results": stop_results,
        "start_results": start_results,
        "moonraker_verified": moonraker_ok,
    }
