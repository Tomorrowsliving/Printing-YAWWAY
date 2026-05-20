from fastapi import APIRouter, Depends, HTTPException, Body, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select
from typing import List, Optional
import asyncio
import httpx
import os
import posixpath
from ..database import get_db
from ..models import Assignment, Backup, Event, FileRecord, Printer, Node, PrinterNote
from ..schemas import PrinterCreate, Printer as PrinterSchema, PrinterDetail
from ..utils.file_backups import BACKUP_ROOT, FILE_EDIT_BACKUP_TYPE
from .nodes import serialize_node, get_backend_public_host
import datetime

router = APIRouter(prefix="/printers", tags=["printers"])

def validate_printer_payload(printer_in):
    name = (printer_in.name or "").strip()
    slug = (printer_in.slug or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Printer name is required")
    if not slug:
        raise HTTPException(status_code=400, detail="Printer slug is required")
    printer_in.name = name
    printer_in.slug = slug

async def probe_printer_runtime(printer):
    fallback = {
        "status": printer.status or "offline",
        "status_message": "",
        "moonraker_warnings": [],
    }

    if not printer.assigned_node_id or not printer.node or not printer.moonraker_port:
        fallback["status"] = printer.status or "offline"
        fallback["status_message"] = "Printer is not assigned to a node or Moonraker port is missing."
        return fallback

    url = f"http://{printer.node.ip_address}:{printer.moonraker_port}/server/info"
    printer_info_url = f"http://{printer.node.ip_address}:{printer.moonraker_port}/printer/info"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=1.5)
        if res.status_code != 200:
            fallback["status"] = "offline"
            fallback["status_message"] = f"Moonraker returned HTTP {res.status_code} from /server/info."
            return fallback

        payload = res.json()
        info = payload.get("result", payload)
        klippy_state = str(info.get("klippy_state") or "").lower()
        klippy_connected = info.get("klippy_connected")
        warnings = info.get("warnings") or []
        status_message = ""

        try:
            async with httpx.AsyncClient() as client:
                printer_res = await client.get(printer_info_url, timeout=1.5)
            if printer_res.status_code == 200:
                printer_info = printer_res.json().get("result", printer_res.json())
                status_message = printer_info.get("state_message") or ""
        except Exception:
            pass

        runtime = {
            "status": "offline",
            "status_message": status_message.strip(),
            "moonraker_warnings": warnings,
        }

        if klippy_state == "ready":
            runtime["status"] = "idle"
            return runtime
        if klippy_state in ("error", "shutdown"):
            runtime["status"] = "error"
            if not runtime["status_message"]:
                runtime["status_message"] = f"Klipper is in {klippy_state} state."
            return runtime
        if klippy_state in ("startup", "connecting"):
            runtime["status"] = "starting"
            return runtime
        if klippy_connected is True:
            runtime["status"] = "online"
            return runtime
        if not runtime["status_message"]:
            runtime["status_message"] = "Moonraker is reachable, but Klipper is not connected."
        return runtime
    except Exception as e:
        fallback["status"] = "offline"
        fallback["status_message"] = f"Could not reach Moonraker at {url}: {e}"
        return fallback

async def probe_printer_status(printer):
    return (await probe_printer_runtime(printer))["status"]

def serialize_printer(printer, include_node=False, runtime_override=None, status_override=None):
    """Utility to serialize SQLAlchemy Printer model to dict to avoid MissingGreenlet errors"""
    runtime = runtime_override or {}
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
        "status": runtime.get("status") or (status_override if status_override is not None else printer.status),
        "status_message": runtime.get("status_message") or "",
        "moonraker_warnings": runtime.get("moonraker_warnings") or [],
        "last_seen": printer.last_seen,
        "assigned_node_id": printer.assigned_node_id,
        "created_at": printer.created_at,
        "updated_at": printer.updated_at,
    }
    if include_node and printer.node:
        data["node"] = serialize_node(printer.node)
    return data

async def get_printer_and_assigned_node(printer_id: int, db: AsyncSession):
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")
    if not printer.assigned_node_id:
        raise HTTPException(status_code=400, detail="Printer not assigned to any node")

    node_result = await db.execute(select(Node).where(Node.id == printer.assigned_node_id))
    node = node_result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Assigned node not found")
    return printer, node

async def fetch_moonraker_json(node: Node, moonraker_port: int, path: str, timeout: float = 3.0):
    url = f"http://{node.ip_address}:{moonraker_port}{path}"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=timeout)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Moonraker at {url}: {e}")

    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Moonraker returned HTTP {res.status_code}: {res.text}")
    return res.json()

async def post_moonraker_json(node: Node, moonraker_port: int, path: str, payload: dict, timeout: float = 10.0):
    url = f"http://{node.ip_address}:{moonraker_port}{path}"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(url, json=payload, timeout=timeout)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Moonraker at {url}: {e}")

    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Moonraker returned HTTP {res.status_code}: {res.text}")
    return res.json()

@router.post("/", response_model=PrinterSchema)
async def create_printer(printer_in: PrinterCreate, db: AsyncSession = Depends(get_db)):
    validate_printer_payload(printer_in)
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
    runtimes = await asyncio.gather(*(probe_printer_runtime(p) for p in printers))
    return [
        serialize_printer(printer, include_node=True, runtime_override=runtime)
        for printer, runtime in zip(printers, runtimes)
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
    validate_printer_payload(printer_in)
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    for field, value in printer_in.model_dump(exclude_unset=True).items():
        setattr(printer, field, value)

    await db.commit()
    await db.refresh(printer)
    return serialize_printer(printer)

@router.delete("/{printer_id}")
async def delete_printer(printer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    printer_name = printer.name
    await db.execute(delete(Assignment).where(Assignment.printer_id == printer_id))
    await db.execute(delete(PrinterNote).where(PrinterNote.printer_id == printer_id))
    await db.execute(delete(FileRecord).where(FileRecord.printer_id == printer_id))
    await db.execute(delete(Event).where(Event.printer_id == printer_id))
    await db.delete(printer)
    db.add(Event(
        severity="warning",
        event_type="printer_deleted",
        message=f"Printer {printer_name} was removed from the fleet"
    ))
    await db.commit()
    return {"status": "success", "message": f"Printer {printer_name} deleted"}

@router.get("/{printer_id}/detail", response_model=PrinterDetail)
async def get_printer_detail(printer_id: int, db: AsyncSession = Depends(get_db)):
    """Extended endpoint that explicitly loads the assigned node"""
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    runtime = await probe_printer_runtime(printer)
    data = serialize_printer(printer, include_node=True, runtime_override=runtime)

    return data

@router.get("/{printer_id}/runtime")
async def get_printer_runtime_snapshot(printer_id: int, db: AsyncSession = Depends(get_db)):
    printer, node = await get_printer_and_assigned_node(printer_id, db)
    if not printer.moonraker_port:
        raise HTTPException(status_code=400, detail="Printer Moonraker port is missing")

    objects = [
        "toolhead",
        "gcode_move",
        "print_stats",
        "virtual_sdcard",
        "extruder",
        "heater_bed",
        "webhooks",
    ]
    payload = await fetch_moonraker_json(
        node,
        printer.moonraker_port,
        f"/printer/objects/query?{'&'.join(objects)}",
    )
    result = payload.get("result", payload)
    return {
        "eventtime": result.get("eventtime"),
        "status": result.get("status", {}),
        "moonraker_url": f"http://{node.ip_address}:{printer.moonraker_port}",
    }

@router.post("/{printer_id}/home")
async def home_printer_axis(printer_id: int, axis: str = Body(..., embed=True), db: AsyncSession = Depends(get_db)):
    printer, node = await get_printer_and_assigned_node(printer_id, db)
    if not printer.moonraker_port:
        raise HTTPException(status_code=400, detail="Printer Moonraker port is missing")

    target_axis = (axis or "").strip().upper()
    if target_axis not in {"X", "Y", "Z", "ALL"}:
        raise HTTPException(status_code=400, detail="Axis must be X, Y, Z, or ALL")

    script = "G28" if target_axis == "ALL" else f"G28 {target_axis}"
    response = await post_moonraker_json(
        node,
        printer.moonraker_port,
        "/printer/gcode/script",
        {"script": script},
        timeout=15.0,
    )

    db.add(Event(
        printer_id=printer.id,
        node_id=node.id,
        severity="info",
        event_type="printer_home_axis",
        message=f"Sent {script} to printer {printer.name}",
    ))
    await db.commit()
    return {"status": "success", "axis": target_axis, "script": script, "moonraker_response": response}

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

@router.post("/{printer_id}/repair-moonraker")
async def repair_printer_moonraker(printer_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")
    if not printer.assigned_node_id:
        raise HTTPException(status_code=400, detail="Printer not assigned to any node")
    if not printer.config_path or not printer.moonraker_port:
        raise HTTPException(status_code=400, detail="Printer config path or Moonraker port is missing")

    node_result = await db.execute(select(Node).where(Node.id == printer.assigned_node_id))
    node = node_result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Assigned node not found")

    data_path = posixpath.dirname(printer.config_path.rstrip("/"))
    payload = {
        "printer_slug": printer.slug,
        "moonraker_port": printer.moonraker_port,
        "config_path": printer.config_path,
        "gcode_path": printer.gcode_path or posixpath.join(data_path, "gcodes"),
        "logs_path": posixpath.join(data_path, "logs"),
        "backend_ip": get_backend_public_host(request),
        "node_ip": node.ip_address,
    }

    url = f"http://{node.ip_address}:{node.agent_port}/instances/repair-moonraker"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(url, json=payload, timeout=30)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach node agent at {url}: {e}")

    if res.status_code >= 400:
        try:
            error_payload = res.json()
            detail = error_payload.get("detail", error_payload)
        except Exception:
            detail = res.text
        raise HTTPException(status_code=502, detail=f"Node repair failed: {detail}")

    response = res.json()
    for backup_path in response.get("backup_paths") or []:
        result = await db.execute(select(Backup).where(Backup.file_path == backup_path))
        if result.scalar_one_or_none():
            continue
        db.add(Backup(
            filename=os.path.relpath(backup_path, BACKUP_ROOT).replace(os.sep, "/"),
            file_path=backup_path,
            backup_type=FILE_EDIT_BACKUP_TYPE,
            status="success",
        ))

    db.add(Event(
        printer_id=printer.id,
        node_id=node.id,
        severity="info",
        event_type="moonraker_repair",
        message=f"Repaired Moonraker config for printer {printer.name}",
        details=response,
    ))
    await db.commit()
    return response
