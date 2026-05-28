from fastapi import APIRouter, Depends, HTTPException, Body, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select
from typing import Any, Dict, List, Optional
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

CONFIG_HELPER_PRESETS = {
    "probe_pin_presets": [
        {
            "id": "creality-42x-probe-port",
            "label": "Creality 4.2.x Probe Port",
            "probe_type": "bltouch",
            "sensor_pin": "^PB1",
            "control_pin": "PB0",
            "x_offset": -44,
            "y_offset": -6,
            "z_offset": 0,
        },
        {
            "id": "creality-42x-z-stop",
            "label": "Creality 4.2.x Z-Stop Signal",
            "probe_type": "bltouch",
            "sensor_pin": "^PC14",
            "control_pin": "PB0",
            "x_offset": -44,
            "y_offset": -6,
            "z_offset": 0,
        },
        {
            "id": "btt-skr-mini-e3-v3",
            "label": "BTT SKR Mini E3 V3",
            "probe_type": "bltouch",
            "sensor_pin": "^PC14",
            "control_pin": "PA1",
            "x_offset": -44,
            "y_offset": -6,
            "z_offset": 0,
        },
        {
            "id": "generic-inductive",
            "label": "Generic Inductive Probe",
            "probe_type": "probe",
            "sensor_pin": "^PA1",
            "control_pin": "",
            "x_offset": 0,
            "y_offset": 0,
            "z_offset": 0,
        },
    ],
    "mesh_presets": [
        {
            "id": "ender-small-bed",
            "label": "Ender Small Bed",
            "safe_z_home_x": 82.5,
            "safe_z_home_y": 82.5,
            "mesh_min_x": 20,
            "mesh_min_y": 20,
            "mesh_max_x": 145,
            "mesh_max_y": 145,
            "probe_count_x": 5,
            "probe_count_y": 5,
        },
        {
            "id": "ender-235-bed",
            "label": "Ender 235mm Bed",
            "safe_z_home_x": 117.5,
            "safe_z_home_y": 117.5,
            "mesh_min_x": 20,
            "mesh_min_y": 20,
            "mesh_max_x": 205,
            "mesh_max_y": 205,
            "probe_count_x": 5,
            "probe_count_y": 5,
        },
    ],
    "plugin_presets": [
        {
            "id": "exclude_object",
            "label": "Exclude Object",
            "sections": ["exclude_object"],
        },
        {
            "id": "respond",
            "label": "Respond",
            "sections": ["respond"],
        },
        {
            "id": "gcode_arcs",
            "label": "G-code Arcs",
            "sections": ["gcode_arcs"],
        },
        {
            "id": "firmware_retraction",
            "label": "Firmware Retraction",
            "sections": ["firmware_retraction"],
        },
    ],
}


class PrinterConfigHelperRequest(BaseModel):
    bed_probe: Optional[Dict[str, Any]] = None
    plugins: List[str] = []
    replace_existing: bool = True
    restart_services: bool = True

class PrinterProbeReachRequest(BaseModel):
    bed_probe: Dict[str, Any]
    bed_width: float
    bed_height: float
    margin_mm: float = 5
    step_mm: float = 10
    max_attempts: int = 20

def moonraker_warning_messages(info):
    warnings = [str(warning) for warning in (info.get("warnings") or []) if warning]
    missing_requirements = [str(item) for item in (info.get("missing_klippy_requirements") or []) if item]
    failed_components = [str(item) for item in (info.get("failed_components") or []) if item]

    if missing_requirements:
        sections = ", ".join(f"[{item}]" for item in missing_requirements)
        warnings.append(
            f"Missing Klipper config sections: {sections}. "
            "Add these sections to printer.cfg so Moonraker and Mainsail features can work correctly."
        )

    if failed_components:
        warnings.append(f"Moonraker failed components: {', '.join(failed_components)}.")

    return warnings

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
        warnings = moonraker_warning_messages(info)
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

def _float_value(data: Dict[str, Any], key: str, default: float = 0.0) -> float:
    try:
        value = float(data.get(key, default))
        return value if value == value else default
    except (TypeError, ValueError):
        return default

def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))

def _round_mm(value: float) -> float:
    return round(float(value), 3)

def _api_error_message(error: HTTPException) -> str:
    detail = error.detail
    if isinstance(detail, dict):
        return str(detail.get("message") or detail)
    return str(detail)

def _is_probe_point_on_bed(x: float, y: float, bed_probe: Dict[str, Any], bed_width: float, bed_height: float, margin: float) -> bool:
    probe_x = x + _float_value(bed_probe, "x_offset")
    probe_y = y + _float_value(bed_probe, "y_offset")
    return margin <= probe_x <= bed_width - margin and margin <= probe_y <= bed_height - margin

async def _fetch_motion_status(node: Node, moonraker_port: int) -> Dict[str, Any]:
    payload = await fetch_moonraker_json(
        node,
        moonraker_port,
        "/printer/objects/query?toolhead&gcode_move&print_stats&webhooks",
        timeout=5.0,
    )
    result = payload.get("result", payload)
    return result.get("status", {})

async def _send_gcode_script(node: Node, moonraker_port: int, script: str, timeout: float = 30.0):
    return await post_moonraker_json(
        node,
        moonraker_port,
        "/printer/gcode/script",
        {"script": script},
        timeout=timeout,
    )

async def _safe_retract(node: Node, moonraker_port: int, safe_z: float, lift_feed: float):
    script = "\n".join([
        "SAVE_GCODE_STATE NAME=KF_PROBE_REACH_ABORT",
        "G90",
        f"G1 Z{safe_z:.3f} F{lift_feed:.0f}",
        "RESTORE_GCODE_STATE NAME=KF_PROBE_REACH_ABORT MOVE=0",
    ])
    await _send_gcode_script(node, moonraker_port, script, timeout=10.0)

async def _try_probe_reach_point(
    node: Node,
    moonraker_port: int,
    x: float,
    y: float,
    safe_z: float,
    lift_feed: float,
    move_feed: float,
):
    script = "\n".join([
        "SAVE_GCODE_STATE NAME=KF_PROBE_REACH",
        "G90",
        f"G1 Z{safe_z:.3f} F{lift_feed:.0f}",
        f"G1 X{x:.3f} Y{y:.3f} F{move_feed:.0f}",
        "PROBE",
        f"G1 Z{safe_z:.3f} F{lift_feed:.0f}",
        "RESTORE_GCODE_STATE NAME=KF_PROBE_REACH MOVE=0",
    ])
    try:
        response = await _send_gcode_script(node, moonraker_port, script, timeout=45.0)
        return {"success": True, "response": response}
    except HTTPException as probe_error:
        try:
            await _safe_retract(node, moonraker_port, safe_z, lift_feed)
        except HTTPException:
            pass
        return {"success": False, "error": _api_error_message(probe_error)}

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

@router.get("/config-helper/presets")
async def get_config_helper_presets():
    return CONFIG_HELPER_PRESETS

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

@router.post("/{printer_id}/probe-reach/find")
async def find_printer_probe_reach(printer_id: int, request_data: PrinterProbeReachRequest, db: AsyncSession = Depends(get_db)):
    printer, node = await get_printer_and_assigned_node(printer_id, db)
    if not printer.moonraker_port:
        raise HTTPException(status_code=400, detail="Printer Moonraker port is missing")

    bed_probe = dict(request_data.bed_probe or {})
    if not bed_probe.get("enabled", True):
        raise HTTPException(status_code=400, detail="Bed probe is disabled in the config helper.")

    bed_width = _clamp(float(request_data.bed_width or 0), 10, 1000)
    bed_height = _clamp(float(request_data.bed_height or 0), 10, 1000)
    margin = _clamp(float(request_data.margin_mm or 5), 0, min(bed_width, bed_height) / 3)
    step = _clamp(float(request_data.step_mm or 5), 0.5, 25)
    max_attempts = int(_clamp(float(request_data.max_attempts or 8), 1, 20))

    status = await _fetch_motion_status(node, printer.moonraker_port)
    webhooks = status.get("webhooks") or {}
    if str(webhooks.get("state") or "").lower() != "ready":
        raise HTTPException(status_code=400, detail="Klipper must be ready before running the probe reach finder.")

    print_stats = status.get("print_stats") or {}
    if str(print_stats.get("state") or "").lower() in {"printing", "paused"}:
        raise HTTPException(status_code=400, detail="Probe reach finder is blocked while a print is active or paused.")

    toolhead = status.get("toolhead") or {}
    homed_axes = str(toolhead.get("homed_axes") or "").lower()
    missing_axes = [axis.upper() for axis in ("x", "y", "z") if axis not in homed_axes]
    if missing_axes:
        raise HTTPException(
            status_code=400,
            detail=f"Home {'/'.join(missing_axes)} before running the probe reach finder.",
        )

    position = toolhead.get("position") or [0, 0, 0]
    axis_minimum = toolhead.get("axis_minimum") or [0, 0, 0]
    axis_maximum = toolhead.get("axis_maximum") or [bed_width, bed_height, 250]
    current_z = float(position[2] if len(position) > 2 else 0)
    max_z = float(axis_maximum[2] if len(axis_maximum) > 2 else max(current_z + 30, 250))
    z_hop = _clamp(_float_value(bed_probe, "z_hop", 10), 2, 25)
    safe_z = _clamp(current_z + z_hop, z_hop, max(z_hop, max_z - 1))
    lift_feed = _clamp(_float_value(bed_probe, "lift_speed", 5), 1, 50) * 60
    move_feed = _clamp(_float_value(bed_probe, "mesh_speed", 120), 5, 300) * 60

    suggested = {
        **bed_probe,
        "mesh_min_x": _round_mm(min(_float_value(bed_probe, "mesh_min_x", 0), _float_value(bed_probe, "mesh_max_x", bed_width))),
        "mesh_max_x": _round_mm(max(_float_value(bed_probe, "mesh_min_x", 0), _float_value(bed_probe, "mesh_max_x", bed_width))),
        "mesh_min_y": _round_mm(min(_float_value(bed_probe, "mesh_min_y", 0), _float_value(bed_probe, "mesh_max_y", bed_height))),
        "mesh_max_y": _round_mm(max(_float_value(bed_probe, "mesh_min_y", 0), _float_value(bed_probe, "mesh_max_y", bed_height))),
    }

    attempts = []
    successful_edges = []
    x_offset = _float_value(bed_probe, "x_offset")
    y_offset = _float_value(bed_probe, "y_offset")
    nozzle_min_x = float(axis_minimum[0] if len(axis_minimum) > 0 else 0)
    nozzle_min_y = float(axis_minimum[1] if len(axis_minimum) > 1 else 0)
    nozzle_max_x = float(axis_maximum[0] if len(axis_maximum) > 0 else bed_width)
    nozzle_max_y = float(axis_maximum[1] if len(axis_maximum) > 1 else bed_height)
    fine_step = max(0.5, min(2.0, step / 5))

    def lane_values(minimum: float, maximum: float) -> List[float]:
        low = min(float(minimum), float(maximum))
        high = max(float(minimum), float(maximum))
        span = high - low
        if span <= 0:
            return [_round_mm(low)]
        inset = min(max(margin, span * 0.18), span / 3)
        lanes = [_round_mm(low + inset), _round_mm(high - inset)]
        return list(dict.fromkeys(lanes))

    def probe_coordinate_limit(axis: str) -> tuple[float, float]:
        if axis == "x":
            return nozzle_min_x + x_offset, nozzle_max_x + x_offset
        return nozzle_min_y + y_offset, nozzle_max_y + y_offset

    async def probe_edge_candidate(
        edge_name: str,
        axis: str,
        moving_probe_coord: float,
        fixed_probe_coord: float,
        attempt_number: int,
        phase: str,
        lane_number: int,
    ) -> bool:
        probe_x = moving_probe_coord if axis == "x" else fixed_probe_coord
        probe_y = fixed_probe_coord if axis == "x" else moving_probe_coord
        nozzle_x = probe_x - x_offset
        nozzle_y = probe_y - y_offset
        attempt = {
            "edge": edge_name,
            "axis": axis,
            "lane": lane_number,
            "phase": phase,
            "attempt": attempt_number,
            "nozzle_x": _round_mm(nozzle_x),
            "nozzle_y": _round_mm(nozzle_y),
            "probe_x": _round_mm(probe_x),
            "probe_y": _round_mm(probe_y),
        }

        if nozzle_x < nozzle_min_x or nozzle_x > nozzle_max_x or nozzle_y < nozzle_min_y or nozzle_y > nozzle_max_y:
            attempt["status"] = "skipped_nozzle_limit"
            attempts.append(attempt)
            return False

        probe_result = await _try_probe_reach_point(
            node,
            printer.moonraker_port,
            nozzle_x,
            nozzle_y,
            safe_z,
            lift_feed,
            move_feed,
        )
        if probe_result["success"]:
            attempt["status"] = "success"
            attempts.append(attempt)
            return True

        attempt["status"] = "probe_failed"
        attempt["error"] = probe_result.get("error")
        attempts.append(attempt)
        followup_status = await _fetch_motion_status(node, printer.moonraker_port)
        followup_state = str((followup_status.get("webhooks") or {}).get("state") or "").lower()
        if followup_state != "ready":
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Probe failed and Klipper is no longer ready. Retract/recover the printer before trying again.",
                    "attempts": attempts,
                },
            )
        return False

    async def search_edge_lane(edge_name: str, axis: str, field_name: str, outward_direction: int, fixed_probe_coord: float, lane_number: int) -> float:
        probe_min_limit, probe_max_limit = probe_coordinate_limit(axis)
        probe_min_limit = max(probe_min_limit, -bed_width if axis == "x" else -bed_height)
        probe_max_limit = min(probe_max_limit, bed_width * 2 if axis == "x" else bed_height * 2)
        candidate = _round_mm(_clamp(float(suggested[field_name]), probe_min_limit, probe_max_limit))
        last_success = None
        first_failure = None
        attempt_number = 1

        while attempt_number <= max_attempts:
            success = await probe_edge_candidate(edge_name, axis, candidate, fixed_probe_coord, attempt_number, "find-safe-start", lane_number)
            if success:
                last_success = candidate
                attempt_number += 1
                break
            first_failure = candidate
            candidate = _round_mm(_clamp(candidate - outward_direction * step, probe_min_limit, probe_max_limit))
            attempt_number += 1

        if last_success is None:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"Could not find a safe starting point for the {edge_name} edge.",
                    "attempts": attempts,
                },
            )

        first_failure = None
        candidate = _round_mm(_clamp(last_success + outward_direction * step, probe_min_limit, probe_max_limit))
        while attempt_number <= max_attempts:
            if candidate == last_success:
                return _round_mm(last_success)
            success = await probe_edge_candidate(edge_name, axis, candidate, fixed_probe_coord, attempt_number, "coarse-edge", lane_number)
            if success:
                last_success = candidate
                next_candidate = _round_mm(_clamp(candidate + outward_direction * step, probe_min_limit, probe_max_limit))
                if next_candidate == candidate:
                    return _round_mm(last_success)
                candidate = next_candidate
                attempt_number += 1
                continue
            first_failure = candidate
            break

        if first_failure is None:
            return _round_mm(last_success)

        fine_candidate = _round_mm(_clamp(last_success + outward_direction * fine_step, min(last_success, first_failure), max(last_success, first_failure)))
        fine_attempt = 1
        max_fine_attempts = int(max(2, abs(first_failure - last_success) / fine_step)) + 2
        while fine_attempt <= max_fine_attempts:
            if fine_candidate == last_success or (outward_direction < 0 and fine_candidate <= first_failure) or (outward_direction > 0 and fine_candidate >= first_failure):
                return _round_mm(last_success)
            success = await probe_edge_candidate(edge_name, axis, fine_candidate, fixed_probe_coord, fine_attempt, "fine-edge", lane_number)
            if success:
                last_success = fine_candidate
                fine_candidate = _round_mm(_clamp(fine_candidate + outward_direction * fine_step, min(last_success, first_failure), max(last_success, first_failure)))
                fine_attempt += 1
                continue
            return _round_mm(last_success)

        return _round_mm(last_success)

    async def search_edge(edge_name: str, axis: str, field_name: str, outward_direction: int, lanes: List[float]) -> float:
        lane_results = []
        for lane_number, lane in enumerate(lanes, start=1):
            lane_results.append(await search_edge_lane(edge_name, axis, field_name, outward_direction, lane, lane_number))
        return _round_mm(max(lane_results) if outward_direction < 0 else min(lane_results))

    x_edge_lanes = lane_values(float(suggested["mesh_min_y"]), float(suggested["mesh_max_y"]))
    for edge_name, field_name, outward_direction in [
        ("left", "mesh_min_x", -1),
        ("right", "mesh_max_x", 1),
    ]:
        suggested[field_name] = await search_edge(edge_name, "x", field_name, outward_direction, x_edge_lanes)
        successful_edges.append(edge_name)

    y_edge_lanes = lane_values(float(suggested["mesh_min_x"]), float(suggested["mesh_max_x"]))
    for edge_name, field_name, outward_direction in [
        ("front", "mesh_min_y", -1),
        ("back", "mesh_max_y", 1),
    ]:
        suggested[field_name] = await search_edge(edge_name, "y", field_name, outward_direction, y_edge_lanes)
        successful_edges.append(edge_name)

    if float(suggested["mesh_min_x"]) >= float(suggested["mesh_max_x"]) or float(suggested["mesh_min_y"]) >= float(suggested["mesh_max_y"]):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Successful probe points collapsed the mesh area. Check probe offset and bed size.",
                "attempts": attempts,
            },
        )

    db.add(Event(
        printer_id=printer.id,
        node_id=node.id,
        severity="info",
        event_type="probe_reach_finder",
        message=f"Found probe-safe mesh reach for printer {printer.name}",
        details={"attempts": attempts, "suggested_bed_probe": suggested},
    ))
    await db.commit()
    return {
        "status": "success",
        "message": "Probe reach finder completed. Mesh bounds were updated from successful edge probes.",
        "suggested_bed_probe": suggested,
        "attempts": attempts,
        "successful_edges": successful_edges,
    }

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

async def proxy_printer_config_helper(
    printer_id: int,
    request_data: PrinterConfigHelperRequest,
    dry_run: bool,
    db: AsyncSession,
):
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
        **request_data.model_dump(),
        "dry_run": dry_run,
        "printer_slug": printer.slug,
        "moonraker_port": printer.moonraker_port,
        "config_path": printer.config_path,
        "gcode_path": printer.gcode_path or posixpath.join(data_path, "gcodes"),
    }

    url = f"http://{node.ip_address}:{node.agent_port}/instances/config-helper/apply"
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
        raise HTTPException(status_code=502, detail=f"Node config helper failed: {detail}")

    response = res.json()
    if not dry_run:
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
            event_type="printer_config_helper",
            message=f"Applied config helper changes for printer {printer.name}",
            details=response,
        ))
        await db.commit()

    return response

@router.post("/{printer_id}/config-helper/preview")
async def preview_printer_config_helper(
    printer_id: int,
    request_data: PrinterConfigHelperRequest,
    db: AsyncSession = Depends(get_db),
):
    return await proxy_printer_config_helper(printer_id, request_data, True, db)

@router.post("/{printer_id}/config-helper/apply")
async def apply_printer_config_helper(
    printer_id: int,
    request_data: PrinterConfigHelperRequest,
    db: AsyncSession = Depends(get_db),
):
    return await proxy_printer_config_helper(printer_id, request_data, False, db)
