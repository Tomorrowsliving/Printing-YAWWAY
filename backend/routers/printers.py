from fastapi import APIRouter, Depends, HTTPException, Body, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload
from typing import Any, Dict, List, Optional
import asyncio
import httpx
import json
import os
import posixpath
import re
import shutil
from ..database import get_db
from ..models import Assignment, Backup, Event, FileRecord, FilamentSpool, Printer, Node, PrinterNote
from ..schemas import PrinterCreate, Printer as PrinterSchema, PrinterDetail
from ..utils.filament import estimate_usage_g, extract_gcode_filament_metadata
from ..utils.file_backups import BACKUP_ROOT, FILE_EDIT_BACKUP_TYPE, PRINTERS_ROOT, is_path_within
from .filaments import deduct_spool_usage
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
    plugins: List[str] = Field(default_factory=list)
    replace_existing: bool = True
    restart_services: bool = True

class GcodePrintRequest(BaseModel):
    file_path: str
    target_printer_ids: List[int] = Field(default_factory=list)
    only_compatible: bool = False
    filament_spool_id: Optional[int] = None
    deduct_filament: bool = True

GCODE_EXTENSIONS = (".gcode", ".gco", ".g")
GCODE_WORD_RE = re.compile(r"([A-Z])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))", re.IGNORECASE)

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

async def probe_printer_runtime(printer, client: Optional[httpx.AsyncClient] = None):
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
    objects_url = f"http://{printer.node.ip_address}:{printer.moonraker_port}/printer/objects/query?print_stats&virtual_sdcard"
    if client is None:
        async with httpx.AsyncClient() as scoped_client:
            return await probe_printer_runtime(printer, scoped_client)

    try:
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
            "active_gcode": None,
            "progress": None,
        }

        try:
            objects_res = await client.get(objects_url, timeout=1.5)
            if objects_res.status_code == 200:
                objects_payload = objects_res.json().get("result", objects_res.json())
                objects_status = objects_payload.get("status", {})
                print_stats = objects_status.get("print_stats", {})
                virtual_sdcard = objects_status.get("virtual_sdcard", {})
                runtime["active_gcode"] = print_stats.get("filename")
                progress = virtual_sdcard.get("progress")
                if progress is not None:
                    runtime["progress"] = round(float(progress) * 100, 1)
                if str(print_stats.get("state", "")).lower() == "printing":
                    runtime["status"] = "printing"
        except Exception:
            pass

        if klippy_state == "ready":
            runtime["status"] = runtime["status"] if runtime["status"] == "printing" else "idle"
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
        "active_gcode": runtime.get("active_gcode"),
        "progress": runtime.get("progress"),
        "last_seen": printer.last_seen,
        "assigned_node_id": printer.assigned_node_id,
        "created_at": printer.created_at,
        "updated_at": printer.updated_at,
    }
    if include_node and printer.node:
        data["node"] = serialize_node(printer.node)
    if printer.__dict__.get("notes"):
        data["notes"] = serialize_printer_note(printer.notes)
    return data

def serialize_printer_note(note: PrinterNote | None):
    if not note:
        return None
    return {
        "id": note.id,
        "printer_id": note.printer_id,
        "model": note.model,
        "bed_size": note.bed_size,
        "nozzle_size": note.nozzle_size,
        "hotend": note.hotend,
        "extruder": note.extruder,
        "probe_type": note.probe_type,
        "board_type": note.board_type,
        "mcu_serial": note.mcu_serial,
        "slicer_profile_notes": note.slicer_profile_notes,
        "known_issues": note.known_issues,
        "maintenance_notes": note.maintenance_notes,
        "last_serviced_date": note.last_serviced_date,
    }

class PrinterNoteRequest(BaseModel):
    model: Optional[str] = None
    bed_size: Optional[str] = None
    nozzle_size: Optional[str] = None
    hotend: Optional[str] = None
    extruder: Optional[str] = None
    probe_type: Optional[str] = None
    board_type: Optional[str] = None
    mcu_serial: Optional[str] = None
    slicer_profile_notes: Optional[str] = None
    known_issues: Optional[str] = None
    maintenance_notes: Optional[str] = None
    last_serviced_date: Optional[datetime.datetime] = None

def render_service_templates(printer: Printer):
    slug = printer.slug
    config_path = printer.config_path or posixpath.join("/mnt/klipper-farm/printers", slug, "config")
    gcode_path = printer.gcode_path or posixpath.join("/mnt/klipper-farm/printers", slug, "gcodes")
    logs_path = posixpath.join(posixpath.dirname(gcode_path.rstrip("/")), "logs")
    moonraker_port = printer.moonraker_port or 7125
    printer_cfg = posixpath.join(config_path, "printer.cfg")
    moonraker_conf = posixpath.join(config_path, "moonraker.conf")
    socket_path = f"/tmp/klippy_{slug}"
    klipper_service = printer.klipper_service_name or f"klipper-{slug}.service"
    moonraker_service = printer.moonraker_service_name or f"moonraker-{slug}.service"

    if not klipper_service.endswith(".service"):
        klipper_service = f"{klipper_service}.service"
    if not moonraker_service.endswith(".service"):
        moonraker_service = f"{moonraker_service}.service"

    klipper_unit = f"""[Unit]
Description=Klipper for {slug}
After=network.target

[Service]
Type=simple
User=root
ExecStart=/opt/klippy-env/bin/python /opt/klipper/klippy/klippy.py {printer_cfg} -l {posixpath.join(logs_path, "klippy.log")} -a {socket_path}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
"""
    moonraker_unit = f"""[Unit]
Description=Moonraker for {slug}
After=network.target {klipper_service}
Requires={klipper_service}

[Service]
Type=simple
User=root
ExecStart=/opt/moonraker-env/bin/python /opt/moonraker/moonraker/moonraker.py -c {moonraker_conf} -d {posixpath.dirname(config_path.rstrip("/"))}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
"""
    return {
        "klipper_service": klipper_service,
        "moonraker_service": moonraker_service,
        "moonraker_port": moonraker_port,
        "config_path": config_path,
        "gcode_path": gcode_path,
        "logs_path": logs_path,
        "socket_path": socket_path,
        "files": [
            {"filename": klipper_service, "content": klipper_unit},
            {"filename": moonraker_service, "content": moonraker_unit},
        ],
    }

async def get_printer_and_assigned_node(printer_id: int, db: AsyncSession):
    result = await db.execute(
        select(Printer)
        .options(selectinload(Printer.node))
        .where(Printer.id == printer_id)
    )
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")
    if not printer.assigned_node_id:
        raise HTTPException(status_code=400, detail="Printer not assigned to any node")

    node = printer.node
    if not node:
        node_result = await db.execute(select(Node).where(Node.id == printer.assigned_node_id))
        node = node_result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Assigned node not found")
    return printer, node

async def record_file_edit_backups(db: AsyncSession, backup_paths):
    for backup_path in backup_paths or []:
        result = await db.execute(select(Backup).where(Backup.file_path == backup_path))
        if result.scalar_one_or_none():
            continue
        db.add(Backup(
            filename=os.path.relpath(backup_path, BACKUP_ROOT).replace(os.sep, "/"),
            file_path=backup_path,
            backup_type=FILE_EDIT_BACKUP_TYPE,
            status="success",
        ))

def _printer_gcode_dir(printer: Printer) -> str:
    return printer.gcode_path or os.path.join(PRINTERS_ROOT, printer.slug, "gcodes")

def _is_gcode_file(path: str) -> bool:
    return os.path.basename(path).lower().endswith(GCODE_EXTENSIONS)

def _safe_gcode_path(path: str, root: str = PRINTERS_ROOT) -> str:
    if not is_path_within(path, root) or not _is_gcode_file(path):
        raise HTTPException(status_code=403, detail="G-code path is outside managed printer storage")
    return os.path.abspath(path)

def _printer_cfg_path(config_path: Optional[str]) -> Optional[str]:
    if not config_path:
        return None
    return os.path.abspath(os.path.join(config_path, "printer.cfg") if os.path.isdir(config_path) else config_path)

def _config_text_has_section(content: str, section: str) -> bool:
    return re.search(rf"(?im)^\s*\[{re.escape(section)}\]\s*$", content) is not None

def _relative_gcode_path(printer: Printer, path: str) -> str:
    gcode_dir = os.path.abspath(_printer_gcode_dir(printer))
    abs_path = _safe_gcode_path(path, gcode_dir)
    return os.path.relpath(abs_path, gcode_dir).replace(os.sep, "/")

def _parse_bed_size_text(value: Optional[str]):
    if not value:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)\s*(?:x|×|by|,)\s*(\d+(?:\.\d+)?)", str(value), re.IGNORECASE)
    if not match:
        return None
    return {
        "min_x": 0.0,
        "max_x": float(match.group(1)),
        "min_y": 0.0,
        "max_y": float(match.group(2)),
        "source": "printer_notes",
    }

def _parse_bed_from_config(config_path: Optional[str]):
    if not config_path:
        return None

    printer_cfg = os.path.join(config_path, "printer.cfg") if os.path.isdir(config_path) else config_path
    if not os.path.exists(printer_cfg) or not is_path_within(printer_cfg, PRINTERS_ROOT):
        return None

    axes = {
        "x": {"min": 0.0, "max": None},
        "y": {"min": 0.0, "max": None},
    }
    section = ""

    try:
        with open(printer_cfg, "r", encoding="utf-8", errors="ignore") as f:
            for raw_line in f:
                line = raw_line.split(";", 1)[0].strip()
                if not line:
                    continue
                if line.startswith("[") and line.endswith("]"):
                    section = line.strip("[]").strip().lower()
                    continue
                if section not in {"stepper_x", "stepper_y"} or ":" not in line:
                    continue

                key, value = [part.strip().lower() for part in line.split(":", 1)]
                axis = "x" if section == "stepper_x" else "y"
                try:
                    number = float(value.split()[0])
                except (TypeError, ValueError, IndexError):
                    continue
                if key == "position_min":
                    axes[axis]["min"] = number
                elif key == "position_max":
                    axes[axis]["max"] = number
    except OSError:
        return None

    if axes["x"]["max"] is None or axes["y"]["max"] is None:
        return None

    return {
        "min_x": axes["x"]["min"],
        "max_x": axes["x"]["max"],
        "min_y": axes["y"]["min"],
        "max_y": axes["y"]["max"],
        "source": "printer_cfg",
    }

def _printer_bed_bounds(printer: Printer):
    return _parse_bed_size_text(getattr(getattr(printer, "notes", None), "bed_size", None)) or _parse_bed_from_config(printer.config_path)

def _analyse_gcode_file(path: str):
    path = _safe_gcode_path(path)
    bounds = {
        "min_x": None,
        "max_x": None,
        "min_y": None,
        "max_y": None,
    }
    absolute_xy = True
    units_factor = 1.0
    current_x = None
    current_y = None
    move_count = 0
    xy_move_count = 0

    def update_bounds(x, y):
        if x is None or y is None:
            return
        bounds["min_x"] = x if bounds["min_x"] is None else min(bounds["min_x"], x)
        bounds["max_x"] = x if bounds["max_x"] is None else max(bounds["max_x"], x)
        bounds["min_y"] = y if bounds["min_y"] is None else min(bounds["min_y"], y)
        bounds["max_y"] = y if bounds["max_y"] is None else max(bounds["max_y"], y)

    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for raw_line in f:
                line = raw_line.split(";", 1)[0].strip().upper()
                if not line:
                    continue
                words = {letter.upper(): float(value) for letter, value in GCODE_WORD_RE.findall(line)}
                gcode = words.get("G")
                if gcode == 20:
                    units_factor = 25.4
                    continue
                if gcode == 21:
                    units_factor = 1.0
                    continue
                if gcode == 90:
                    absolute_xy = True
                    continue
                if gcode == 91:
                    absolute_xy = False
                    continue
                if gcode not in {0, 1}:
                    continue

                move_count += 1
                next_x = current_x
                next_y = current_y
                has_xy = False
                if "X" in words:
                    value = words["X"] * units_factor
                    next_x = value if absolute_xy or current_x is None else current_x + value
                    has_xy = True
                if "Y" in words:
                    value = words["Y"] * units_factor
                    next_y = value if absolute_xy or current_y is None else current_y + value
                    has_xy = True

                current_x = next_x
                current_y = next_y
                if has_xy and current_x is not None and current_y is not None:
                    xy_move_count += 1
                    update_bounds(current_x, current_y)
    except OSError as e:
        raise HTTPException(status_code=404, detail=f"Could not read G-code file: {e}")

    has_bounds = all(value is not None for value in bounds.values())
    width = bounds["max_x"] - bounds["min_x"] if has_bounds else None
    depth = bounds["max_y"] - bounds["min_y"] if has_bounds else None
    return {
        **bounds,
        "width": width,
        "depth": depth,
        "move_count": move_count,
        "xy_move_count": xy_move_count,
        "has_bounds": has_bounds,
    }

def _gcode_fit_status(analysis: dict, bed_bounds: Optional[dict]):
    if not analysis.get("has_bounds"):
        return {"status": "unknown", "message": "No XY bounds found"}
    if not bed_bounds:
        return {"status": "unknown", "message": "Bed size unavailable"}

    margin = 0.001
    fits = (
        analysis["min_x"] >= bed_bounds["min_x"] - margin
        and analysis["max_x"] <= bed_bounds["max_x"] + margin
        and analysis["min_y"] >= bed_bounds["min_y"] - margin
        and analysis["max_y"] <= bed_bounds["max_y"] + margin
    )
    if fits:
        return {"status": "fits", "message": "Fits bed"}
    return {"status": "too_large", "message": "Outside bed bounds"}

def _read_gcode_metadata(path: str):
    meta_path = f"{path}.meta.json"
    if not os.path.exists(meta_path) or not is_path_within(meta_path, PRINTERS_ROOT):
        return {}
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}

def _merged_gcode_metadata(path: str):
    metadata = _read_gcode_metadata(path)
    parsed = extract_gcode_filament_metadata(path)
    for key, value in parsed.items():
        if metadata.get(key) is None:
            metadata[key] = value
    return metadata

def _serialize_gcode_target(printer: Printer):
    bed_bounds = _printer_bed_bounds(printer)
    return {
        "id": printer.id,
        "name": printer.name,
        "slug": printer.slug,
        "status": printer.status,
        "assigned_node_id": printer.assigned_node_id,
        "moonraker_port": printer.moonraker_port,
        "node": serialize_node(printer.node) if printer.node else None,
        "bed_bounds": bed_bounds,
    }

def _serialize_gcode_file(path: str, source_printer: Printer, target_printers: List[Printer]):
    stat = os.stat(path)
    analysis = _analyse_gcode_file(path)
    metadata = _merged_gcode_metadata(path)
    target_statuses = []
    compatible_printer_ids = []
    for target in target_printers:
        fit = _gcode_fit_status(analysis, _printer_bed_bounds(target))
        if fit["status"] == "fits":
            compatible_printer_ids.append(target.id)
        target_statuses.append({
            "printer_id": target.id,
            **fit,
        })

    return {
        "name": os.path.basename(path),
        "path": path,
        "relative_path": os.path.relpath(path, _printer_gcode_dir(source_printer)).replace(os.sep, "/"),
        "source_printer_id": source_printer.id,
        "source_printer_name": source_printer.name,
        "source_printer_slug": source_printer.slug,
        "size": stat.st_size,
        "last_modified": stat.st_mtime,
        "analysis": analysis,
        "metadata": metadata,
        "group_key": f"slicer:{metadata['slice_group_id']}" if metadata.get("slice_group_id") else f"file:{path}",
        "group_label": metadata.get("source_model") if metadata.get("slice_group_id") else os.path.basename(path),
        "compatible_printer_ids": compatible_printer_ids,
        "target_statuses": target_statuses,
    }

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

def _api_error_message(error: HTTPException) -> str:
    detail = error.detail
    if isinstance(detail, dict):
        return str(detail.get("message") or detail)
    return str(detail)

async def _send_gcode_script(node: Node, moonraker_port: int, script: str, timeout: float = 30.0):
    return await post_moonraker_json(
        node,
        moonraker_port,
        "/printer/gcode/script",
        {"script": script},
        timeout=timeout,
    )

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
    result = await db.execute(select(Printer).options(selectinload(Printer.node)))
    printers = result.scalars().all()
    async with httpx.AsyncClient() as client:
        runtimes = await asyncio.gather(*(probe_printer_runtime(p, client) for p in printers))
    return [
        serialize_printer(printer, include_node=True, runtime_override=runtime)
        for printer, runtime in zip(printers, runtimes)
    ]

@router.get("/config-helper/presets")
async def get_config_helper_presets():
    return CONFIG_HELPER_PRESETS

@router.get("/{printer_id}/config-helper/state")
async def get_printer_config_helper_state(printer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    plugin_states = {plugin["id"]: False for plugin in CONFIG_HELPER_PRESETS["plugin_presets"]}
    printer_cfg = _printer_cfg_path(printer.config_path)
    if not printer_cfg:
        return {
            "config_exists": False,
            "printer_cfg_path": None,
            "plugins": [],
            "plugin_states": plugin_states,
            "bed_probe_enabled": False,
            "bed_probe_sections": {},
        }

    if not is_path_within(printer_cfg, PRINTERS_ROOT):
        raise HTTPException(status_code=403, detail="Printer config path is outside managed printer storage")

    if not os.path.exists(printer_cfg):
        return {
            "config_exists": False,
            "printer_cfg_path": printer_cfg,
            "plugins": [],
            "plugin_states": plugin_states,
            "bed_probe_enabled": False,
            "bed_probe_sections": {},
        }

    try:
        with open(printer_cfg, "r", encoding="utf-8", errors="ignore") as handle:
            content = handle.read()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not read printer.cfg: {exc}")

    for plugin in CONFIG_HELPER_PRESETS["plugin_presets"]:
        sections = plugin.get("sections") or []
        plugin_states[plugin["id"]] = bool(sections) and all(_config_text_has_section(content, section) for section in sections)

    bed_probe_sections = {
        section: _config_text_has_section(content, section)
        for section in ["bltouch", "probe", "safe_z_home", "bed_mesh"]
    }

    return {
        "config_exists": True,
        "printer_cfg_path": printer_cfg,
        "plugins": [plugin_id for plugin_id, active in plugin_states.items() if active],
        "plugin_states": plugin_states,
        "bed_probe_enabled": any(bed_probe_sections.values()),
        "bed_probe_sections": bed_probe_sections,
    }

@router.get("/gcodes")
async def list_all_printer_gcodes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Printer)
        .options(selectinload(Printer.node), selectinload(Printer.notes))
        .order_by(Printer.name)
    )
    printers = result.scalars().all()

    files = []
    for printer in printers:
        gcode_dir = _printer_gcode_dir(printer)
        if not is_path_within(gcode_dir, PRINTERS_ROOT):
            continue

        os.makedirs(gcode_dir, exist_ok=True)
        for dirpath, _, filenames in os.walk(gcode_dir):
            for filename in filenames:
                path = os.path.join(dirpath, filename)
                if not _is_gcode_file(path):
                    continue
                files.append(_serialize_gcode_file(path, printer, printers))

    files.sort(key=lambda item: item["last_modified"], reverse=True)
    return {
        "files": files,
        "targets": [_serialize_gcode_target(printer) for printer in printers],
        "printers": [
            {
                "id": printer.id,
                "name": printer.name,
                "slug": printer.slug,
                "gcode_dir": _printer_gcode_dir(printer),
            }
            for printer in printers
        ],
    }

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
    result = await db.execute(
        select(Printer)
        .options(selectinload(Printer.node), selectinload(Printer.notes))
        .where(Printer.id == printer_id)
    )
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    runtime = await probe_printer_runtime(printer)
    data = serialize_printer(printer, include_node=True, runtime_override=runtime)

    return data

@router.get("/{printer_id}/notes")
async def get_printer_notes(printer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer).options(selectinload(Printer.notes)).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")
    if not printer.notes:
        note = PrinterNote(printer_id=printer.id, mcu_serial=printer.expected_mcu_serial)
        db.add(note)
        await db.flush()
        return serialize_printer_note(note)
    return serialize_printer_note(printer.notes)

@router.put("/{printer_id}/notes")
async def update_printer_notes(printer_id: int, req: PrinterNoteRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer).options(selectinload(Printer.notes)).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    note = printer.notes or PrinterNote(printer_id=printer.id)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(note, field, value)
    db.add(note)

    if req.mcu_serial is not None:
        printer.mcu_serial = req.mcu_serial
    db.add(Event(
        printer_id=printer.id,
        severity="info",
        event_type="printer_profile",
        message=f"Printer profile updated for {printer.name}",
    ))
    await db.flush()
    return serialize_printer_note(note)

@router.get("/{printer_id}/service-templates")
async def get_printer_service_templates(printer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")
    return render_service_templates(printer)

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

@router.get("/{printer_id}/gcodes")
async def list_printer_gcodes(printer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Printer)
        .options(selectinload(Printer.node), selectinload(Printer.notes))
        .where(Printer.id == printer_id)
    )
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    targets_result = await db.execute(
        select(Printer)
        .options(selectinload(Printer.node), selectinload(Printer.notes))
        .order_by(Printer.name)
    )
    target_printers = targets_result.scalars().all()

    gcode_dir = _printer_gcode_dir(printer)
    if not is_path_within(gcode_dir, PRINTERS_ROOT):
        raise HTTPException(status_code=403, detail="G-code directory is outside managed printer storage")

    os.makedirs(gcode_dir, exist_ok=True)
    files = []
    for dirpath, _, filenames in os.walk(gcode_dir):
        for filename in filenames:
            path = os.path.join(dirpath, filename)
            if not _is_gcode_file(path):
                continue
            files.append(_serialize_gcode_file(path, printer, target_printers))

    files.sort(key=lambda item: item["last_modified"], reverse=True)
    return {
        "printer_id": printer.id,
        "gcode_dir": gcode_dir,
        "files": files,
        "targets": [_serialize_gcode_target(target) for target in target_printers],
    }

@router.post("/{printer_id}/gcodes/print")
async def print_printer_gcode(printer_id: int, request_data: GcodePrintRequest, db: AsyncSession = Depends(get_db)):
    source_result = await db.execute(
        select(Printer)
        .options(selectinload(Printer.node), selectinload(Printer.notes))
        .where(Printer.id == printer_id)
    )
    source_printer = source_result.scalar_one_or_none()
    if not source_printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    if not request_data.target_printer_ids:
        raise HTTPException(status_code=400, detail="Select at least one printer")

    source_path = _safe_gcode_path(request_data.file_path, _printer_gcode_dir(source_printer))
    relative_path = _relative_gcode_path(source_printer, source_path)
    analysis = _analyse_gcode_file(source_path)
    gcode_metadata = _merged_gcode_metadata(source_path)

    requested_spool = None
    if request_data.filament_spool_id:
        requested_spool = (await db.execute(
            select(FilamentSpool)
            .options(selectinload(FilamentSpool.printer))
            .where(FilamentSpool.id == request_data.filament_spool_id)
        )).scalar_one_or_none()
        if not requested_spool:
            raise HTTPException(status_code=404, detail="Filament spool not found")

    target_result = await db.execute(
        select(Printer)
        .options(selectinload(Printer.node), selectinload(Printer.notes))
        .where(Printer.id.in_(request_data.target_printer_ids))
    )
    targets = target_result.scalars().all()
    if not targets:
        raise HTTPException(status_code=404, detail="No target printers found")

    results = []
    for target in targets:
        fit = _gcode_fit_status(analysis, _printer_bed_bounds(target))
        if request_data.only_compatible and fit["status"] != "fits":
            results.append({
                "printer_id": target.id,
                "printer_name": target.name,
                "status": "skipped",
                "fit_status": fit["status"],
                "message": fit["message"],
            })
            continue

        if not target.node or not target.moonraker_port:
            results.append({
                "printer_id": target.id,
                "printer_name": target.name,
                "status": "failed",
                "fit_status": fit["status"],
                "message": "Printer is missing an assigned node or Moonraker port",
            })
            continue

        target_dir = _printer_gcode_dir(target)
        if not is_path_within(target_dir, PRINTERS_ROOT):
            results.append({
                "printer_id": target.id,
                "printer_name": target.name,
                "status": "failed",
                "fit_status": fit["status"],
                "message": "Target G-code directory is outside managed storage",
            })
            continue

        target_path = os.path.abspath(os.path.join(target_dir, *relative_path.split("/")))
        if not is_path_within(target_path, target_dir):
            results.append({
                "printer_id": target.id,
                "printer_name": target.name,
                "status": "failed",
                "fit_status": fit["status"],
                "message": "Invalid target G-code path",
            })
            continue

        try:
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            if os.path.abspath(source_path) != target_path:
                shutil.copy2(source_path, target_path)
                source_meta_path = f"{source_path}.meta.json"
                if os.path.exists(source_meta_path):
                    shutil.copy2(source_meta_path, f"{target_path}.meta.json")

            moonraker_response = await post_moonraker_json(
                target.node,
                target.moonraker_port,
                "/printer/print/start",
                {"filename": relative_path},
                timeout=10.0,
            )
            filament_usage = None
            if request_data.deduct_filament:
                spool = requested_spool
                if not spool:
                    spool = (await db.execute(
                        select(FilamentSpool)
                        .options(selectinload(FilamentSpool.printer))
                        .where(FilamentSpool.printer_id == target.id, FilamentSpool.status == "active")
                        .order_by(FilamentSpool.updated_at.desc().nullslast(), FilamentSpool.created_at.desc())
                    )).scalars().first()
                if not spool and gcode_metadata.get("filament_spool_id"):
                    spool = (await db.execute(
                        select(FilamentSpool)
                        .options(selectinload(FilamentSpool.printer))
                        .where(FilamentSpool.id == gcode_metadata["filament_spool_id"])
                    )).scalar_one_or_none()

                usage_g = estimate_usage_g(gcode_metadata, spool)
                if spool and usage_g:
                    await deduct_spool_usage(
                        db,
                        spool,
                        usage_g,
                        printer_id=target.id,
                        gcode_path=target_path,
                        usage_mm=gcode_metadata.get("filament_used_mm"),
                        reason="print_started",
                        note=f"Started {relative_path}",
                    )
                    filament_usage = {
                        "spool_id": spool.id,
                        "spool_name": spool.name,
                        "usage_g": round(usage_g, 1),
                        "remaining_weight_g": round(float(spool.remaining_weight_g or 0), 1),
                    }
                elif usage_g:
                    filament_usage = {
                        "status": "not_deducted",
                        "usage_g": round(usage_g, 1),
                        "message": "No loaded filament spool found",
                    }
            results.append({
                "printer_id": target.id,
                "printer_name": target.name,
                "status": "started",
                "fit_status": fit["status"],
                "message": "Print started",
                "filament_usage": filament_usage,
                "moonraker_response": moonraker_response,
            })
            db.add(Event(
                printer_id=target.id,
                node_id=target.node.id,
                severity="info",
                event_type="gcode_print_start",
                message=f"Started {relative_path} on printer {target.name}",
                details={
                    "source_printer_id": source_printer.id,
                    "fit_status": fit["status"],
                    "filament_usage": filament_usage,
                },
            ))
        except HTTPException as e:
            results.append({
                "printer_id": target.id,
                "printer_name": target.name,
                "status": "failed",
                "fit_status": fit["status"],
                "message": _api_error_message(e),
            })
        except Exception as e:
            results.append({
                "printer_id": target.id,
                "printer_name": target.name,
                "status": "failed",
                "fit_status": fit["status"],
                "message": str(e),
            })

    await db.commit()
    return {
        "file": relative_path,
        "analysis": analysis,
        "results": results,
        "started": len([item for item in results if item["status"] == "started"]),
        "failed": len([item for item in results if item["status"] == "failed"]),
        "skipped": len([item for item in results if item["status"] == "skipped"]),
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
    printer, node = await get_printer_and_assigned_node(printer_id, db)

    if target == "firmware":
        if not printer.moonraker_port:
            raise HTTPException(status_code=400, detail="Printer Moonraker port is missing")
        result = await _send_gcode_script(node, printer.moonraker_port, "FIRMWARE_RESTART", timeout=10.0)
        db.add(Event(
            printer_id=printer.id,
            node_id=node.id,
            severity="warning",
            event_type="firmware_restart",
            message=f"Firmware restart requested for printer {printer.name}",
        ))
        await db.commit()
        return {"status": "success", "result": result}

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

@router.post("/{printer_id}/emergency-stop")
async def emergency_stop_printer(printer_id: int, db: AsyncSession = Depends(get_db)):
    printer, node = await get_printer_and_assigned_node(printer_id, db)
    if not printer.moonraker_port:
        raise HTTPException(status_code=400, detail="Printer Moonraker port is missing")

    result = await post_moonraker_json(node, printer.moonraker_port, "/printer/emergency_stop", {}, timeout=5.0)
    db.add(Event(
        printer_id=printer.id,
        node_id=node.id,
        severity="critical",
        event_type="emergency_stop",
        message=f"Emergency stop sent to printer {printer.name}",
    ))
    await db.commit()
    return {"status": "success", "result": result}

@router.post("/{printer_id}/repair-moonraker")
async def repair_printer_moonraker(printer_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    printer, node = await get_printer_and_assigned_node(printer_id, db)
    if not printer.config_path or not printer.moonraker_port:
        raise HTTPException(status_code=400, detail="Printer config path or Moonraker port is missing")

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
    await record_file_edit_backups(db, response.get("backup_paths"))

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
    printer, node = await get_printer_and_assigned_node(printer_id, db)
    if not printer.config_path or not printer.moonraker_port:
        raise HTTPException(status_code=400, detail="Printer config path or Moonraker port is missing")

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
        await record_file_edit_backups(db, response.get("backup_paths"))

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
