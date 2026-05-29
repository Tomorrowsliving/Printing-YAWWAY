import os
import psutil
import subprocess
import socket
import asyncio
import httpx
import logging
import shutil
import json
import re
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
import time
import datetime
from urllib.parse import urlparse

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("node-agent")

app = FastAPI(title="Klipper Farm Node Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration from environment
AGENT_PORT = int(os.getenv("NODE_AGENT_PORT", os.getenv("AGENT_PORT", 8001)))
CENTRAL_SERVER_URL = os.getenv("BACKEND_URL", os.getenv("CENTRAL_SERVER_URL", "http://server:8001"))
NODE_AGENT_REPO_DIR = os.getenv("NODE_AGENT_REPO_DIR", "/home/pi/klipper-farm-control-plane")
UUID_FILE = "/etc/klipper-farm-node-agent.uuid"
KLIPPER_PATH = "/opt/klipper"
MOONRAKER_PATH = "/opt/moonraker"
MAINSAIL_PATH = "/var/www/mainsail"
KLIPPY_ENV_PATH = "/opt/klippy-env"
MOONRAKER_ENV_PATH = "/opt/moonraker-env"
MAINSAIL_RELEASE_URL = "https://github.com/mainsail-crew/mainsail/releases/latest/download/mainsail.zip"
MAINSAIL_NGINX_SITE = "/etc/nginx/sites-available/mainsail"
MAINSAIL_NGINX_ENABLED_SITE = "/etc/nginx/sites-enabled/mainsail"
MAINSAIL_CONFIG_PATH = os.path.join(MAINSAIL_PATH, "config.json")
BACKUP_ROOT = os.getenv("BACKUP_PATH", "/mnt/klipper-farm/backups")
PRINTERS_ROOT = os.getenv("PRINTERS_PATH", "/mnt/klipper-farm/printers")

def get_node_uuid():
    """Get persistent UUID or generate a new one."""
    if os.path.exists(UUID_FILE):
        try:
            with open(UUID_FILE, "r") as f:
                uuid_val = f.read().strip()
                if uuid_val and len(uuid_val) > 10:
                    return uuid_val
        except Exception as e:
            logger.error(f"Error reading UUID file: {e}")

    # Generate new UUID
    import uuid
    new_uuid = str(uuid.uuid4())
    try:
        # Try to write to /etc (requires root/sudo)
        # If we can't, fallback to local directory for MVP/dev
        target_path = UUID_FILE
        try:
            with open(target_path, "w") as f:
                f.write(new_uuid)
            os.chmod(target_path, 0o644)
        except PermissionError:
            target_path = os.path.join(os.path.dirname(__file__), ".node_uuid")
            with open(target_path, "w") as f:
                f.write(new_uuid)

        logger.info(f"Generated new persistent UUID: {new_uuid} at {target_path}")
        return new_uuid
    except Exception as e:
        logger.error(f"Failed to generate persistent UUID: {e}")
        return "unknown-" + socket.gethostname()

NODE_UUID = get_node_uuid()
logger.info(f"Node UUID: {NODE_UUID}")

class InstanceCreate(BaseModel):
    printer_slug: str
    mcu_serial: str
    moonraker_port: int
    config_path: str
    gcode_path: str
    logs_path: str
    printer_cfg_content: Optional[str] = None
    moonraker_conf_content: Optional[str] = None
    backend_ip: Optional[str] = None
    node_ip: Optional[str] = None

class EmergencyStopRequest(BaseModel):
    moonraker_port: Optional[int] = None

class MoonrakerRepairRequest(BaseModel):
    printer_slug: str
    moonraker_port: int
    config_path: str
    gcode_path: Optional[str] = None
    logs_path: str
    moonraker_conf_content: Optional[str] = None
    backend_ip: Optional[str] = None
    node_ip: Optional[str] = None

class KlipperConfigHelperRequest(BaseModel):
    printer_slug: str
    moonraker_port: int
    config_path: str
    gcode_path: Optional[str] = None
    bed_probe: Optional[Dict[str, Any]] = None
    plugins: List[str] = Field(default_factory=list)
    replace_existing: bool = True
    restart_services: bool = True
    dry_run: bool = False

class MountRequest(BaseModel):
    server: str
    export: str
    mount_point: str
    persistent: Optional[bool] = True

MOONRAKER_SYSTEM_PACKAGES = [
    "git",
    "python3",
    "python3-venv",
    "python3-pip",
    "python3-virtualenv",
    "python3-dev",
    "libopenjp2-7",
    "libsodium-dev",
    "zlib1g-dev",
    "libjpeg-dev",
    "packagekit",
    "wireless-tools",
    "curl",
    "build-essential",
]

MOONRAKER_OPTIONAL_SYSTEM_PACKAGES = [
    "python3-libcamera",
]

def run_checked(command, timeout=None):
    logger.info("Running command: %s", " ".join(command))
    return subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
    )

def run_best_effort(command, timeout=None):
    logger.info("Running command: %s", " ".join(command))
    return subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )

def has_root_privileges():
    return hasattr(os, "geteuid") and os.geteuid() == 0

def privileged_command(command):
    if has_root_privileges():
        return list(command)
    return ["sudo", "-n", *command]

def run_privileged(command, timeout=None, **kwargs):
    cmd = privileged_command(command)
    logger.info("Running privileged command: %s", " ".join(cmd))
    return subprocess.run(cmd, timeout=timeout, **kwargs)

def describe_process_error(error):
    output = (getattr(error, "stderr", "") or getattr(error, "stdout", "") or str(error)).strip()
    cmd = " ".join(getattr(error, "cmd", []) or [])
    if cmd:
        return f"{cmd} failed with exit code {error.returncode}: {output}"
    return output

def get_mount_info(mount_path):
    try:
        with open("/proc/mounts", "r") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 3 and parts[1] == mount_path:
                    return parts[0], parts[2]
    except Exception as e:
        logger.error(f"Error reading /proc/mounts: {e}")
    return "", ""

def get_fstab_mount_entry(mount_path):
    try:
        with open("/etc/fstab", "r") as f:
            for line in f:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                parts = stripped.split()
                if len(parts) >= 4 and parts[1] == mount_path and parts[2].startswith("nfs"):
                    return {
                        "source": parts[0],
                        "mount_point": parts[1],
                        "filesystem_type": parts[2],
                        "options": parts[3],
                    }
    except Exception as e:
        logger.error(f"Error reading /etc/fstab: {e}")
    return None

STORAGE_SELF_HEAL_STATUS = {
    "enabled": False,
    "last_attempt_at": None,
    "last_success_at": None,
    "last_error": "",
}

async def ensure_persistent_storage_mounted(reason="startup"):
    mount_path = os.getenv("NFS_CLIENT_MOUNT", "/mnt/klipper-farm")
    entry = get_fstab_mount_entry(mount_path)
    STORAGE_SELF_HEAL_STATUS["enabled"] = bool(entry)

    if not entry:
        STORAGE_SELF_HEAL_STATUS["last_error"] = "No persistent NFS mount is configured yet."
        return {"attempted": False, "reason": reason, "message": STORAGE_SELF_HEAL_STATUS["last_error"]}

    source, filesystem_type = get_mount_info(mount_path)
    if source:
        STORAGE_SELF_HEAL_STATUS["last_error"] = ""
        STORAGE_SELF_HEAL_STATUS["last_success_at"] = datetime.datetime.now().isoformat()
        return {
            "attempted": False,
            "reason": reason,
            "message": f"Storage already mounted from {source}.",
            "mount_source": source,
            "filesystem_type": filesystem_type,
        }

    STORAGE_SELF_HEAL_STATUS["last_attempt_at"] = datetime.datetime.now().isoformat()
    try:
        run_privileged(["mkdir", "-p", mount_path], check=True, capture_output=True, text=True, timeout=20)
        result = run_privileged(["mount", mount_path], capture_output=True, text=True, timeout=20)
        if result.returncode == 0:
            STORAGE_SELF_HEAL_STATUS["last_error"] = ""
            STORAGE_SELF_HEAL_STATUS["last_success_at"] = datetime.datetime.now().isoformat()
            logger.info("Persistent storage remounted at %s after %s", mount_path, reason)
            return {"attempted": True, "success": True, "reason": reason, "mount_point": mount_path}

        STORAGE_SELF_HEAL_STATUS["last_error"] = result.stderr.strip() or result.stdout.strip() or "mount command failed"
        logger.warning("Persistent storage remount failed: %s", STORAGE_SELF_HEAL_STATUS["last_error"])
        return {
            "attempted": True,
            "success": False,
            "reason": reason,
            "message": STORAGE_SELF_HEAL_STATUS["last_error"],
        }
    except subprocess.TimeoutExpired as e:
        STORAGE_SELF_HEAL_STATUS["last_error"] = f"mount timed out after {e.timeout}s"
        logger.warning("Persistent storage remount timed out at %s", mount_path)
        return {"attempted": True, "success": False, "reason": reason, "message": STORAGE_SELF_HEAL_STATUS["last_error"]}
    except Exception as e:
        STORAGE_SELF_HEAL_STATUS["last_error"] = str(e)
        logger.error("Persistent storage remount error: %s", e)
        return {"attempted": True, "success": False, "reason": reason, "message": str(e)}

def get_os_major_version():
    try:
        with open("/etc/os-release", "r") as f:
            for line in f:
                if line.startswith("VERSION_ID="):
                    raw_version = line.split("=", 1)[1].strip().strip('"')
                    return int(raw_version.split(".", 1)[0])
    except Exception:
        pass
    return None

def is_raspberry_pi_os():
    if os.path.exists("/etc/rpi-issue"):
        return True
    try:
        with open("/proc/device-tree/model", "r") as f:
            return "raspberry pi" in f.read().lower()
    except Exception:
        return False

def install_moonraker_system_dependencies():
    run_checked(["sudo", "apt-get", "update", "--allow-releaseinfo-change"], timeout=180)
    run_checked(["sudo", "apt-get", "install", "-y", *MOONRAKER_SYSTEM_PACKAGES], timeout=600)

    if is_raspberry_pi_os() and (get_os_major_version() or 0) >= 11:
        for package in MOONRAKER_OPTIONAL_SYSTEM_PACKAGES:
            result = run_best_effort(["apt-cache", "show", package], timeout=30)
            if result.returncode == 0:
                install_result = run_best_effort(["sudo", "apt-get", "install", "-y", package], timeout=180)
                if install_result.returncode != 0:
                    logger.warning("Optional Moonraker package %s failed to install: %s", package, install_result.stderr)

def find_moonraker_requirements():
    candidates = [
        os.path.join(MOONRAKER_PATH, "scripts", "moonraker-requirements.txt"),
        os.path.join(MOONRAKER_PATH, "requirements.txt"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    raise FileNotFoundError(f"Moonraker requirements file not found under {MOONRAKER_PATH}")

def host_from_url(value: Optional[str]):
    if not value:
        return None
    parsed = urlparse(value if "://" in value else f"http://{value}")
    return parsed.hostname or value.split(":", 1)[0].strip("/")

def unique_non_empty(values):
    seen = set()
    result = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result

def render_moonraker_config(printer_slug, moonraker_port, config_path, logs_path, backend_ip=None, node_ip=None):
    backend_host = host_from_url(backend_ip) or host_from_url(CENTRAL_SERVER_URL)
    node_host = host_from_url(node_ip) or get_ip()

    trusted_clients = unique_non_empty([
        "127.0.0.1",
        backend_host,
        node_host,
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
    ])
    cors_domains = unique_non_empty([
        f"http://{backend_host}" if backend_host else None,
        f"http://{node_host}" if node_host else None,
        f"http://{node_host}:{moonraker_port}" if node_host else None,
    ])

    lines = [
        "[server]",
        "host: 0.0.0.0",
        f"port: {moonraker_port}",
        f"klippy_uds_address: /tmp/klippy_{printer_slug}",
        "",
        "[file_manager]",
        "enable_object_processing: False",
        "",
        "[authorization]",
        "trusted_clients:",
    ]
    lines.extend(f"    {client}" for client in trusted_clients)
    lines.extend(["", "cors_domains:"])
    lines.extend(f"    {domain}" for domain in cors_domains)
    return "\n".join(lines) + "\n"

def get_printer_data_path(config_path):
    normalized = os.path.abspath(config_path)
    if os.path.basename(normalized) == "config":
        return os.path.dirname(normalized)
    return os.path.dirname(normalized)

def render_moonraker_unit(printer_slug, moonraker_conf, logs_path, data_path):
    return f"""[Unit]
Description=Moonraker for {printer_slug}
After=network.target

[Service]
Type=simple
User=root
ExecStart=/opt/moonraker-env/bin/python /opt/moonraker/moonraker/moonraker.py -d {data_path} -c {moonraker_conf} -l {os.path.join(logs_path, "moonraker.log")}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
"""

def path_is_within(path, root):
    try:
        return os.path.commonpath([os.path.abspath(path), os.path.abspath(root)]) == os.path.abspath(root)
    except ValueError:
        return False

def moonraker_backup_path(original_path, source_path=None):
    if not path_is_within(original_path, PRINTERS_ROOT):
        return None

    timestamp_source = source_path or original_path
    timestamp = datetime.datetime.fromtimestamp(os.path.getmtime(timestamp_source)).strftime("%Y%m%d_%H%M%S_%f")
    rel_path = os.path.relpath(original_path, PRINTERS_ROOT)
    backup_dir = os.path.join(BACKUP_ROOT, "file-edits", os.path.dirname(rel_path), os.path.basename(original_path))
    os.makedirs(backup_dir, exist_ok=True)

    backup_path = os.path.join(backup_dir, f"{timestamp}_{os.path.basename(original_path)}.bak")
    counter = 1
    while os.path.exists(backup_path):
        backup_path = os.path.join(backup_dir, f"{timestamp}_{counter}_{os.path.basename(original_path)}.bak")
        counter += 1
    return backup_path

def backup_moonraker_config(moonraker_conf):
    backup_path = moonraker_backup_path(moonraker_conf)
    if not backup_path:
        return None
    shutil.copy2(moonraker_conf, backup_path)
    return backup_path

def backup_printer_config(printer_cfg):
    backup_path = moonraker_backup_path(printer_cfg)
    if not backup_path:
        return None
    shutil.copy2(printer_cfg, backup_path)
    return backup_path

def config_has_section(content, section):
    pattern = rf"^\s*\[{re.escape(section)}\]\s*(?:#.*)?$"
    return re.search(pattern, content, re.IGNORECASE | re.MULTILINE) is not None

def append_missing_klipper_support(printer_cfg, gcode_path):
    if not os.path.exists(printer_cfg):
        return None, []

    with open(printer_cfg, "r") as f:
        content = f.read()

    additions = []
    added_sections = []

    if not config_has_section(content, "virtual_sdcard"):
        path = gcode_path or os.path.join(os.path.dirname(os.path.dirname(printer_cfg)), "gcodes")
        os.makedirs(path, exist_ok=True)
        additions.append(f"[virtual_sdcard]\npath: {path}\n")
        added_sections.append("virtual_sdcard")

    if not config_has_section(content, "pause_resume"):
        additions.append("[pause_resume]\n")
        added_sections.append("pause_resume")

    if not config_has_section(content, "display_status"):
        additions.append("[display_status]\n")
        added_sections.append("display_status")

    macro_templates = {
        "gcode_macro PAUSE": """[gcode_macro PAUSE]
description: Pause the active print
rename_existing: PAUSE_BASE
gcode:
    PAUSE_BASE
""",
        "gcode_macro RESUME": """[gcode_macro RESUME]
description: Resume the active print
rename_existing: RESUME_BASE
gcode:
    RESUME_BASE
""",
        "gcode_macro CANCEL_PRINT": """[gcode_macro CANCEL_PRINT]
description: Cancel the active print
rename_existing: CANCEL_PRINT_BASE
gcode:
    TURN_OFF_HEATERS
    CANCEL_PRINT_BASE
""",
    }

    for section, template in macro_templates.items():
        if not config_has_section(content, section):
            additions.append(template)
            added_sections.append(section)

    if not additions:
        return None, []

    backup_path = backup_printer_config(printer_cfg)
    with open(printer_cfg, "a") as f:
        separator = "\n" if content.endswith("\n") else "\n\n"
        f.write(separator)
        f.write("# Klipper Farm auto-added support sections for Moonraker and Mainsail.\n\n")
        f.write("\n".join(additions).rstrip())
        f.write("\n")

    return backup_path, added_sections

PIN_VALUE_PATTERN = re.compile(r"^[!^~]*[A-Za-z0-9_:.+\-/]+$")

PLUGIN_SNIPPETS = {
    "exclude_object": {
        "label": "Exclude Object",
        "sections": ["exclude_object"],
        "content": "[exclude_object]\n",
    },
    "respond": {
        "label": "Respond",
        "sections": ["respond"],
        "content": "[respond]\n",
    },
    "gcode_arcs": {
        "label": "G-code Arcs",
        "sections": ["gcode_arcs"],
        "content": "[gcode_arcs]\nresolution: 0.1\n",
    },
    "firmware_retraction": {
        "label": "Firmware Retraction",
        "sections": ["firmware_retraction"],
        "content": "\n".join([
            "[firmware_retraction]",
            "retract_length: 0.8",
            "retract_speed: 35",
            "unretract_extra_length: 0",
            "unretract_speed: 35",
            "",
        ]),
    },
}

def clean_config_value(value, fallback=""):
    if value is None:
        return fallback
    return str(value).replace("\x00", "").strip()

def require_pin(value, label):
    pin = clean_config_value(value)
    if not pin:
        raise ValueError(f"{label} is required")
    if not PIN_VALUE_PATTERN.match(pin):
        raise ValueError(f"{label} has invalid characters")
    return pin

def config_float(data, key, fallback):
    try:
        return float(data.get(key, fallback))
    except (TypeError, ValueError):
        return float(fallback)

def config_int(data, key, fallback, minimum=None, maximum=None):
    try:
        value = int(data.get(key, fallback))
    except (TypeError, ValueError):
        value = int(fallback)
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value

def format_config_number(value, digits=3):
    number = float(value)
    text = f"{number:.{digits}f}".rstrip("0").rstrip(".")
    return text or "0"

def managed_block(block_id, body):
    return (
        f"# >>> Klipper Farm managed: {block_id}\n"
        f"{body.rstrip()}\n"
        f"# <<< Klipper Farm managed: {block_id}\n"
    )

def remove_managed_block(content, block_id):
    pattern = rf"(?ms)^# >>> Klipper Farm managed: {re.escape(block_id)}\n.*?^# <<< Klipper Farm managed: {re.escape(block_id)}\n?"
    return re.sub(pattern, "", content).rstrip() + "\n"

def section_regex(section):
    return re.compile(rf"(?ms)^\s*\[{re.escape(section)}\]\s*(?:#.*)?\n.*?(?=^\s*\[|^#\*# <---------------------- SAVE_CONFIG|\Z)")

def remove_config_sections(content, sections):
    removed = []
    updated = content
    for section in sections:
        pattern = section_regex(section)
        if pattern.search(updated):
            updated = pattern.sub("", updated)
            removed.append(section)
    return updated.rstrip() + "\n", removed

def update_section_option(content, section, option, value):
    pattern = section_regex(section)
    match = pattern.search(content)
    if not match:
        return content, False

    section_text = match.group(0)
    option_pattern = re.compile(rf"(?m)^(\s*{re.escape(option)}\s*:\s*).*$")
    replacement = f"{option}: {value}"
    if option_pattern.search(section_text):
        updated_section = option_pattern.sub(replacement, section_text)
    else:
        updated_section = section_text.rstrip() + f"\n{replacement}\n"

    return content[:match.start()] + updated_section + content[match.end():], True

def comment_section_option(content, section, option, reason):
    pattern = section_regex(section)
    match = pattern.search(content)
    if not match:
        return content, False

    section_text = match.group(0)
    option_pattern = re.compile(rf"(?m)^(\s*)({re.escape(option)}\s*:\s*.*)$")
    if not option_pattern.search(section_text):
        return content, False

    updated_section = option_pattern.sub(rf"\1# \2  # {reason}", section_text)
    return content[:match.start()] + updated_section + content[match.end():], True

def insert_before_save_config(content, block):
    save_config_marker = "#*# <---------------------- SAVE_CONFIG"
    marker_index = content.find(save_config_marker)
    if marker_index >= 0:
        prefix = content[:marker_index].rstrip()
        suffix = content[marker_index:].lstrip()
        return f"{prefix}\n\n{block}\n{suffix}"
    return content.rstrip() + f"\n\n{block}"

def render_bed_probe_block(bed_probe):
    probe_type = clean_config_value(bed_probe.get("probe_type"), "bltouch").lower()
    if probe_type not in {"bltouch", "probe"}:
        raise ValueError("Probe type must be bltouch or probe")

    sensor_pin = require_pin(bed_probe.get("sensor_pin"), "Sensor pin")
    control_pin = clean_config_value(bed_probe.get("control_pin"))

    x_offset = format_config_number(config_float(bed_probe, "x_offset", 0))
    y_offset = format_config_number(config_float(bed_probe, "y_offset", 0))
    z_offset = format_config_number(config_float(bed_probe, "z_offset", 0))
    probe_speed = format_config_number(config_float(bed_probe, "probe_speed", 5))
    lift_speed = format_config_number(config_float(bed_probe, "lift_speed", 5))
    samples = config_int(bed_probe, "samples", 2, 1, 10)
    sample_retract_dist = format_config_number(config_float(bed_probe, "sample_retract_dist", 2))

    if probe_type == "bltouch":
        control_pin = require_pin(control_pin, "Control pin")
        probe_lines = [
            "[bltouch]",
            f"sensor_pin: {sensor_pin}",
            f"control_pin: {control_pin}",
            f"x_offset: {x_offset}",
            f"y_offset: {y_offset}",
            f"z_offset: {z_offset}",
            f"speed: {probe_speed}",
            f"lift_speed: {lift_speed}",
            f"samples: {samples}",
            f"sample_retract_dist: {sample_retract_dist}",
        ]
    else:
        probe_lines = [
            "[probe]",
            f"pin: {sensor_pin}",
            f"x_offset: {x_offset}",
            f"y_offset: {y_offset}",
            f"z_offset: {z_offset}",
            f"speed: {probe_speed}",
            f"samples: {samples}",
            f"sample_retract_dist: {sample_retract_dist}",
        ]

    safe_x = format_config_number(config_float(bed_probe, "safe_z_home_x", 117.5))
    safe_y = format_config_number(config_float(bed_probe, "safe_z_home_y", 117.5))
    safe_speed = format_config_number(config_float(bed_probe, "safe_z_home_speed", 50))
    z_hop = format_config_number(config_float(bed_probe, "z_hop", 10))
    z_hop_speed = format_config_number(config_float(bed_probe, "z_hop_speed", 5))

    mesh_min_x = format_config_number(config_float(bed_probe, "mesh_min_x", 20))
    mesh_min_y = format_config_number(config_float(bed_probe, "mesh_min_y", 20))
    mesh_max_x = format_config_number(config_float(bed_probe, "mesh_max_x", 205))
    mesh_max_y = format_config_number(config_float(bed_probe, "mesh_max_y", 205))
    mesh_speed = format_config_number(config_float(bed_probe, "mesh_speed", 120))
    horizontal_move_z = format_config_number(config_float(bed_probe, "horizontal_move_z", 5))
    probe_count_x = config_int(bed_probe, "probe_count_x", 5, 2, 15)
    probe_count_y = config_int(bed_probe, "probe_count_y", 5, 2, 15)

    mesh_lines = [
        "[safe_z_home]",
        f"home_xy_position: {safe_x}, {safe_y}",
        f"speed: {safe_speed}",
        f"z_hop: {z_hop}",
        f"z_hop_speed: {z_hop_speed}",
        "",
        "[bed_mesh]",
        f"speed: {mesh_speed}",
        f"horizontal_move_z: {horizontal_move_z}",
        f"mesh_min: {mesh_min_x}, {mesh_min_y}",
        f"mesh_max: {mesh_max_x}, {mesh_max_y}",
        f"probe_count: {probe_count_x}, {probe_count_y}",
    ]
    if probe_count_x >= 4 and probe_count_y >= 4:
        mesh_lines.append("algorithm: bicubic")

    return "\n".join(probe_lines) + "\n\n" + "\n".join(mesh_lines) + "\n"

def build_config_helper_patch(content, data: KlipperConfigHelperRequest):
    changes = []
    warnings = []
    snippets = []
    updated = remove_managed_block(remove_managed_block(content, "bed_probe"), "klipper_plugins")

    bed_probe = data.bed_probe or {}
    if bed_probe.get("enabled"):
        target_sections = ["bltouch", "probe", "safe_z_home", "bed_mesh"]
        add_probe_block = True
        if data.replace_existing:
            updated, removed = remove_config_sections(updated, target_sections)
            if removed:
                changes.append(f"Replaced existing section(s): {', '.join(removed)}")
        else:
            existing = [section for section in target_sections if config_has_section(updated, section)]
            if existing:
                warnings.append(f"Skipped probe block because existing section(s) are present: {', '.join(existing)}")
                add_probe_block = False

        if add_probe_block:
            probe_block = managed_block("bed_probe", render_bed_probe_block(bed_probe))
            snippets.append(probe_block)
            changes.append("Added bed probe, safe Z home, and bed mesh sections")

        if bed_probe.get("use_probe_for_z_homing", True):
            updated, changed = update_section_option(updated, "stepper_z", "endstop_pin", "probe:z_virtual_endstop")
            if changed:
                changes.append("Set [stepper_z] endstop_pin to probe:z_virtual_endstop")
                updated, commented = comment_section_option(
                    updated,
                    "stepper_z",
                    "position_endstop",
                    "disabled by Klipper Farm when probe:z_virtual_endstop is used",
                )
                if commented:
                    changes.append("Disabled [stepper_z] position_endstop")
            else:
                warnings.append("Could not find [stepper_z]; add endstop_pin: probe:z_virtual_endstop manually if this probe should home Z")

    plugin_ids = [plugin for plugin in data.plugins if plugin in PLUGIN_SNIPPETS]
    if plugin_ids:
        plugin_sections = []
        plugin_parts = []
        for plugin_id in plugin_ids:
            plugin = PLUGIN_SNIPPETS[plugin_id]
            sections = plugin["sections"]
            if data.replace_existing:
                updated, removed = remove_config_sections(updated, sections)
                if removed:
                    changes.append(f"Replaced existing plugin section(s): {', '.join(removed)}")
                plugin_parts.append(plugin["content"])
                plugin_sections.extend(sections)
            else:
                existing = [section for section in sections if config_has_section(updated, section)]
                if existing:
                    warnings.append(f"Skipped {plugin['label']} because section already exists: {', '.join(existing)}")
                    continue
                plugin_parts.append(plugin["content"])
                plugin_sections.extend(sections)

        if plugin_parts:
            snippets.append(managed_block("klipper_plugins", "\n".join(part.rstrip() for part in plugin_parts)))
            changes.append(f"Added Klipper plugin section(s): {', '.join(plugin_sections)}")

    if snippets:
        updated = insert_before_save_config(updated, "\n".join(snippets))

    changed = updated.rstrip() != content.rstrip()
    return updated, changed, changes, warnings, "\n".join(snippets).rstrip() + ("\n" if snippets else "")

def move_legacy_moonraker_sidecar_backups(moonraker_conf):
    moved_paths = []
    directory = os.path.dirname(moonraker_conf)
    prefix = f"{os.path.basename(moonraker_conf)}.bak"
    try:
        candidates = [
            os.path.join(directory, name)
            for name in os.listdir(directory)
            if name.startswith(prefix) and os.path.isfile(os.path.join(directory, name))
        ]
    except FileNotFoundError:
        return moved_paths

    for candidate in candidates:
        backup_path = moonraker_backup_path(moonraker_conf, source_path=candidate)
        if not backup_path:
            continue
        shutil.move(candidate, backup_path)
        moved_paths.append(backup_path)
    return moved_paths

def update_mainsail_config_instance(printer_slug, moonraker_port, node_ip=None):
    if not os.path.isdir(MAINSAIL_PATH):
        return None

    node_host = host_from_url(node_ip) or get_ip()
    config = {
        "defaultLocale": "en",
        "defaultMode": "dark",
        "defaultTheme": "mainsail",
        "hostname": None,
        "port": None,
        "path": None,
        "instancesDB": "json",
        "instances": [],
    }

    if os.path.exists(MAINSAIL_CONFIG_PATH):
        try:
            with open(MAINSAIL_CONFIG_PATH, "r") as f:
                existing = json.load(f)
            if isinstance(existing, dict):
                config.update(existing)
        except (OSError, json.JSONDecodeError):
            pass

    instances = config.get("instances")
    if not isinstance(instances, list):
        instances = []

    instance = {
        "hostname": node_host,
        "port": int(moonraker_port),
        "path": "/",
        "name": printer_slug,
    }

    updated = False
    for index, item in enumerate(instances):
        if not isinstance(item, dict):
            continue
        if item.get("name") == printer_slug or (
            item.get("hostname") == node_host and int(item.get("port", 0) or 0) == int(moonraker_port)
        ):
            instances[index] = {**item, **instance}
            updated = True
            break

    if not updated:
        instances.append(instance)

    config["instances"] = instances
    if len(instances) == 1:
        config["hostname"] = node_host
        config["port"] = int(moonraker_port)
        config["path"] = "/"
        config["instancesDB"] = "moonraker"
    else:
        config["hostname"] = None
        config["port"] = None
        config["path"] = None
        config["instancesDB"] = "json"

    with open(MAINSAIL_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=4)
        f.write("\n")

    return instance

def get_software_status():
    klippy_python = os.path.join(KLIPPY_ENV_PATH, "bin", "python")
    moonraker_python = os.path.join(MOONRAKER_ENV_PATH, "bin", "python")
    nginx_installed = os.path.exists("/usr/sbin/nginx") or os.path.exists("/usr/bin/nginx")

    return {
        "klipper_installed": os.path.exists(os.path.join(KLIPPER_PATH, "klippy", "klippy.py")),
        "moonraker_installed": os.path.exists(os.path.join(MOONRAKER_PATH, "moonraker", "moonraker.py")),
        "mainsail_installed": os.path.exists(os.path.join(MAINSAIL_PATH, "index.html")),
        "nginx_installed": nginx_installed,
        "klipper_path": KLIPPER_PATH,
        "moonraker_path": MOONRAKER_PATH,
        "mainsail_path": MAINSAIL_PATH,
        "klippy_env": KLIPPY_ENV_PATH,
        "moonraker_env": MOONRAKER_ENV_PATH,
        "klipper_env": os.path.exists(klippy_python),
        "klipper_env_installed": os.path.exists(klippy_python),
        "moonraker_env_installed": os.path.exists(moonraker_python),
        "nfs_mounted": os.path.ismount("/mnt/klipper-farm") or os.path.exists("/mnt/klipper-farm/printers"),
        "systemd": os.path.exists("/run/systemd/system"),
    }

def nginx_mainsail_config(moonraker_port=None):
    moonraker_proxy = ""
    if moonraker_port:
        moonraker_proxy = f"""
    location /websocket {{
        proxy_pass http://127.0.0.1:{int(moonraker_port)}/websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }}

    location ~ ^/(printer|server|machine|access|api|webcam|files|debug|announcements|history) {{
        proxy_pass http://127.0.0.1:{int(moonraker_port)}$request_uri;
        proxy_set_header Host $host;
    }}
"""

    return f"""server {{
    listen 80 default_server;
    listen [::]:80 default_server;

    root /var/www/mainsail;
    index index.html;

    server_name _;
{moonraker_proxy}

    location / {{
        try_files $uri $uri/ /index.html;
    }}
}}
"""

def update_mainsail_nginx_proxy(moonraker_port):
    if not os.path.exists("/usr/sbin/nginx") and not os.path.exists("/usr/bin/nginx"):
        return False

    config = nginx_mainsail_config(moonraker_port)
    os.makedirs(os.path.dirname(MAINSAIL_NGINX_SITE), exist_ok=True)
    with open(MAINSAIL_NGINX_SITE, "w") as f:
        f.write(config)

    if not os.path.exists(MAINSAIL_NGINX_ENABLED_SITE):
        os.makedirs(os.path.dirname(MAINSAIL_NGINX_ENABLED_SITE), exist_ok=True)
        try:
            os.symlink(MAINSAIL_NGINX_SITE, MAINSAIL_NGINX_ENABLED_SITE)
        except FileExistsError:
            pass

    run_checked(["sudo", "nginx", "-t"], timeout=30)
    run_checked(["sudo", "systemctl", "restart", "nginx"], timeout=60)
    return True

def clean_string(value):
    if value is None:
        return None
    return str(value).replace("\x00", "").strip()

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

def get_pi_model():
    try:
        with open("/proc/device-tree/model", "r") as f:
            return f.read().strip()
    except Exception:
        return "Unknown"

def get_cpu_temperature():
    try:
        temps = psutil.sensors_temperatures()
        if not temps:
            return 0.0
        for key in ("cpu_thermal", "cpu-thermal", "soc_thermal"):
            entries = temps.get(key)
            if entries:
                return float(entries[0].current)
        for entries in temps.values():
            if entries:
                return float(entries[0].current)
    except Exception:
        pass
    return 0.0

def bytes_to_mb(value):
    return round(float(value or 0) / 1024 / 1024, 1)

def get_disk_usage(path="/"):
    try:
        usage = psutil.disk_usage(path)
        return {
            "path": path,
            "total_mb": bytes_to_mb(usage.total),
            "used_mb": bytes_to_mb(usage.used),
            "free_mb": bytes_to_mb(usage.free),
            "percent": round(float(usage.percent), 1),
        }
    except Exception:
        return None

def get_load_average():
    try:
        load1, load5, load15 = os.getloadavg()
        cpu_count = psutil.cpu_count() or 1
        return {
            "load_1m": round(load1, 2),
            "load_5m": round(load5, 2),
            "load_15m": round(load15, 2),
            "load_percent_1m": round(min(100, (load1 / cpu_count) * 100), 1),
        }
    except Exception:
        return {
            "load_1m": 0,
            "load_5m": 0,
            "load_15m": 0,
            "load_percent_1m": 0,
        }

@app.get("/health")
async def health():
    usb_serial = []
    base_path = "/dev/serial/by-id"
    if os.path.exists(base_path):
        usb_serial = os.listdir(base_path)

    memory = psutil.virtual_memory()
    boot_seconds = int(time.time() - psutil.boot_time())
    root_disk = get_disk_usage("/")
    nfs_disk = get_disk_usage("/mnt/klipper-farm") if os.path.exists("/mnt/klipper-farm") else None

    return {
        "hostname": clean_string(socket.gethostname()),
        "ip_address": clean_string(get_ip()),
        "cpu_usage": round(float(psutil.cpu_percent(interval=0.1)), 1),
        "cpu_count": psutil.cpu_count() or 1,
        "load_average": get_load_average(),
        "ram_usage": round(float(memory.percent), 1),
        "ram_total_mb": bytes_to_mb(memory.total),
        "ram_used_mb": bytes_to_mb(memory.used),
        "ram_available_mb": bytes_to_mb(memory.available),
        "temperature": get_cpu_temperature(),
        "uptime": clean_string(f"{boot_seconds}s"),
        "uptime_seconds": boot_seconds,
        "root_disk": root_disk,
        "nfs_disk": nfs_disk,
        "model": clean_string(get_pi_model()),
        "pi_model": clean_string(get_pi_model()),
        "version": "1.0.0",
        "online": True,
        "usb_serial_count": len(usb_serial),
        "usb_device_count": len(psutil.disk_partitions()) # Placeholder for device count
    }

@app.get("/usb")
async def list_usb():
    devices = []
    base_path = "/dev/serial/by-id"
    if os.path.exists(base_path):
        for d in os.listdir(base_path):
            devices.append({
                "id": d,
                "path": os.path.join(base_path, d)
            })
    return devices

@app.get("/instances")
async def list_instances():
    # In a real scenario, we'd list systemd services matching klipper-*.service
    try:
        result = subprocess.run(['systemctl', 'list-units', '--type=service', 'klipper-*', 'moonraker-*', '--all', '--no-legend'], capture_output=True, text=True)
        instances = []
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 4:
                instances.append({
                    "name": parts[0],
                    "status": parts[3],
                    "active": parts[2]
                })
        return instances
    except Exception as e:
        return {"error": str(e)}

@app.post("/instances/create")
async def create_instance(data: InstanceCreate):
    """
    Creates systemd services and config for a new printer instance.
    """
    logger.info(f"Creating instance for {data.printer_slug}")

    # Ensure directories exist (NFS usually)
    try:
        os.makedirs(data.config_path, exist_ok=True)
        os.makedirs(data.gcode_path, exist_ok=True)
        os.makedirs(data.logs_path, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create directories: {e}")

    printer_cfg = os.path.join(data.config_path, "printer.cfg")
    if data.printer_cfg_content:
        with open(printer_cfg, "w") as f:
            f.write(data.printer_cfg_content)
    elif not os.path.exists(printer_cfg):
        with open(printer_cfg, "w") as f:
            f.write(f"[mcu]\nserial: {data.mcu_serial}\n\n[printer]\nkinematics: none\nmax_velocity: 300\nmax_accel: 3000\n")

    moonraker_conf = os.path.join(data.config_path, "moonraker.conf")
    if data.moonraker_conf_content:
        with open(moonraker_conf, "w") as f:
            f.write(data.moonraker_conf_content)
    elif not os.path.exists(moonraker_conf):
        with open(moonraker_conf, "w") as f:
            f.write(render_moonraker_config(
                printer_slug=data.printer_slug,
                moonraker_port=data.moonraker_port,
                config_path=data.config_path,
                logs_path=data.logs_path,
                backend_ip=data.backend_ip,
                node_ip=data.node_ip,
            ))

    # Install Systemd Units
    klipper_service = f"klipper-{data.printer_slug}.service"
    moonraker_service = f"moonraker-{data.printer_slug}.service"

    klipper_unit = f"""[Unit]
Description=Klipper for {data.printer_slug}
After=network.target

[Service]
Type=simple
User=root
ExecStart=/opt/klippy-env/bin/python /opt/klipper/klippy/klippy.py {printer_cfg} -l {os.path.join(data.logs_path, "klippy.log")} -a /tmp/klippy_{data.printer_slug}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
"""

    moonraker_unit = render_moonraker_unit(
        printer_slug=data.printer_slug,
        moonraker_conf=moonraker_conf,
        logs_path=data.logs_path,
        data_path=get_printer_data_path(data.config_path),
    )

    try:
        # We use a temp file and sudo mv to handle permissions safely if agent is not root
        # though our installer runs agent as root for MVP simplicity.
        with open(f"/tmp/{klipper_service}", "w") as f: f.write(klipper_unit)
        with open(f"/tmp/{moonraker_service}", "w") as f: f.write(moonraker_unit)

        subprocess.run(["sudo", "mv", f"/tmp/{klipper_service}", f"/etc/systemd/system/{klipper_service}"], check=True)
        subprocess.run(["sudo", "mv", f"/tmp/{moonraker_service}", f"/etc/systemd/system/{moonraker_service}"], check=True)
        subprocess.run(["sudo", "systemctl", "daemon-reload"], check=True)
        subprocess.run(["sudo", "systemctl", "enable", klipper_service], check=True)
        subprocess.run(["sudo", "systemctl", "enable", moonraker_service], check=True)
        subprocess.run(["sudo", "systemctl", "start", klipper_service], check=True)
        subprocess.run(["sudo", "systemctl", "start", moonraker_service], check=True)
        update_mainsail_config_instance(data.printer_slug, data.moonraker_port, data.node_ip)
        update_mainsail_nginx_proxy(data.moonraker_port)
    except Exception as e:
        logger.error(f"Failed to install systemd units: {e}")
        return {"status": "partial_success", "message": f"Configs created but systemd install failed: {e}"}

    return {"status": "success", "message": f"Instance {data.printer_slug} created and started."}

def validate_service_name(service: str):
    if not re.match(r"^(klipper|moonraker)-[A-Za-z0-9_.-]+(?:\.service)?$", service or ""):
        raise HTTPException(status_code=403, detail="Unauthorised service name")

@app.post("/instances/start")
async def start_instance(service: str = Body(..., embed=True)):
    validate_service_name(service)
    subprocess.run(["sudo", "systemctl", "start", service])
    return {"status": "started"}

@app.post("/instances/stop")
async def stop_instance(service: str = Body(..., embed=True)):
    validate_service_name(service)
    subprocess.run(["sudo", "systemctl", "stop", service])
    return {"status": "stopped"}

@app.post("/instances/restart")
async def restart_instance(service: str = Body(..., embed=True)):
    validate_service_name(service)
    subprocess.run(["sudo", "systemctl", "restart", service])
    return {"status": "restarted"}

@app.get("/logs/{instance}")
async def get_instance_logs(instance: str, lines: int = 200):
    validate_service_name(instance)
    safe_lines = max(20, min(int(lines or 200), 1000))
    try:
        result = subprocess.run(
            ["journalctl", "-u", instance, "-n", str(safe_lines), "--no-pager", "--output", "short-iso"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return {
            "service": instance,
            "lines": safe_lines,
            "returncode": result.returncode,
            "output": result.stdout,
            "error": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Timed out reading service logs")

@app.post("/emergency-stop")
async def emergency_stop(req: EmergencyStopRequest):
    if not req.moonraker_port:
        raise HTTPException(status_code=400, detail="moonraker_port is required")
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(f"http://127.0.0.1:{req.moonraker_port}/printer/emergency_stop", json={}, timeout=5)
        if res.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Moonraker returned HTTP {res.status_code}: {res.text}")
        logger.warning("Emergency stop sent through Moonraker port %s", req.moonraker_port)
        return {"status": "success", "moonraker_port": req.moonraker_port}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Emergency stop failed: {e}")

@app.post("/instances/config-helper/apply")
async def apply_klipper_config_helper(data: KlipperConfigHelperRequest):
    service = f"klipper-{data.printer_slug}.service"
    validate_service_name(service)

    printer_cfg = os.path.join(data.config_path, "printer.cfg")
    if not path_is_within(printer_cfg, PRINTERS_ROOT):
        raise HTTPException(status_code=403, detail="Config path is outside the managed printers directory")
    if not os.path.exists(printer_cfg):
        raise HTTPException(status_code=404, detail=f"printer.cfg not found at {printer_cfg}")

    try:
        with open(printer_cfg, "r") as f:
            content = f.read()

        updated, changed, changes, warnings, snippet = build_config_helper_patch(content, data)
        backup_paths = []

        if changed and not data.dry_run:
            backup_path = backup_printer_config(printer_cfg)
            if backup_path:
                backup_paths.append(backup_path)
                changes.insert(0, f"Backed up printer.cfg to {backup_path}")

            with open(printer_cfg, "w") as f:
                f.write(updated.rstrip() + "\n")

            if data.restart_services:
                run_checked(["sudo", "systemctl", "restart", service], timeout=60)
                changes.append(f"Restarted {service}")

        return {
            "status": "preview" if data.dry_run else "success",
            "message": "Config helper preview generated" if data.dry_run else "Klipper config updated",
            "changed": changed,
            "backup_paths": backup_paths,
            "changes": changes,
            "warnings": warnings,
            "snippet": snippet,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=describe_process_error(e))
    except Exception as e:
        logger.error("Config helper failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to apply Klipper config helper: {e}")

@app.post("/instances/repair-moonraker")
async def repair_moonraker_instance(data: MoonrakerRepairRequest):
    service = f"moonraker-{data.printer_slug}.service"
    klipper_service = f"klipper-{data.printer_slug}.service"
    validate_service_name(service)
    validate_service_name(klipper_service)

    data_path = get_printer_data_path(data.config_path)
    moonraker_conf = os.path.join(data.config_path, "moonraker.conf")
    printer_cfg = os.path.join(data.config_path, "printer.cfg")
    moonraker_unit = f"/etc/systemd/system/{service}"
    changes = []
    backup_paths = []
    klipper_config_changed = False

    try:
        os.makedirs(data.config_path, exist_ok=True)
        os.makedirs(data.logs_path, exist_ok=True)
        if data.gcode_path:
            os.makedirs(data.gcode_path, exist_ok=True)
        os.makedirs(data_path, exist_ok=True)

        printer_backup_path, added_sections = append_missing_klipper_support(printer_cfg, data.gcode_path)
        if added_sections:
            klipper_config_changed = True
            if printer_backup_path:
                backup_paths.append(printer_backup_path)
                changes.append(f"Backed up printer.cfg to {printer_backup_path}")
            changes.append(f"Added missing Klipper/Mainsail section(s): {', '.join(added_sections)}")

        if os.path.exists(moonraker_conf):
            backup_path = backup_moonraker_config(moonraker_conf)
            if backup_path:
                backup_paths.append(backup_path)
                changes.append(f"Backed up moonraker.conf to {backup_path}")

        moved_legacy_paths = move_legacy_moonraker_sidecar_backups(moonraker_conf)
        if moved_legacy_paths:
            backup_paths.extend(moved_legacy_paths)
            changes.append(f"Moved {len(moved_legacy_paths)} legacy Moonraker backup(s) into central backups")

        config_content = data.moonraker_conf_content or render_moonraker_config(
            printer_slug=data.printer_slug,
            moonraker_port=data.moonraker_port,
            config_path=data.config_path,
            logs_path=data.logs_path,
            backend_ip=data.backend_ip,
            node_ip=data.node_ip,
        )
        with open(moonraker_conf, "w") as f:
            f.write(config_content)
        changes.append("Rewrote moonraker.conf without deprecated file_manager paths")

        unit_content = render_moonraker_unit(
            printer_slug=data.printer_slug,
            moonraker_conf=moonraker_conf,
            logs_path=data.logs_path,
            data_path=data_path,
        )
        temp_unit = f"/tmp/{service}"
        with open(temp_unit, "w") as f:
            f.write(unit_content)
        run_checked(["sudo", "mv", temp_unit, moonraker_unit], timeout=30)
        changes.append(f"Updated {service} to use data path {data_path}")

        run_checked(["sudo", "systemctl", "daemon-reload"], timeout=30)
        if klipper_config_changed:
            run_checked(["sudo", "systemctl", "restart", klipper_service], timeout=60)
            changes.append(f"Restarted {klipper_service}")
        run_checked(["sudo", "systemctl", "restart", service], timeout=60)
        changes.append(f"Restarted {service}")

        mainsail_instance = update_mainsail_config_instance(data.printer_slug, data.moonraker_port, data.node_ip)
        if mainsail_instance:
            changes.append(f"Updated Mainsail printer entry for {mainsail_instance['hostname']}:{mainsail_instance['port']}")
        if update_mainsail_nginx_proxy(data.moonraker_port):
            changes.append(f"Updated Mainsail nginx proxy for Moonraker port {data.moonraker_port}")
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=describe_process_error(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to repair Moonraker config: {e}")

    return {
        "status": "success",
        "message": f"Printer and Moonraker config repaired for {data.printer_slug}",
        "data_path": data_path,
        "backup_paths": backup_paths,
        "changes": changes,
    }

@app.get("/software/status")
@app.get("/software/check")
async def check_software():
    return get_software_status()

@app.post("/software/install/klipper")
@app.post("/software/install-klipper")
async def install_klipper():
    try:
        run_checked(["sudo", "apt-get", "update", "--allow-releaseinfo-change"], timeout=180)
        run_checked(["sudo", "apt-get", "install", "-y", "git", "python3", "python3-venv", "python3-pip", "build-essential"], timeout=600)

        if not os.path.exists(KLIPPER_PATH):
            run_checked(["sudo", "git", "clone", "https://github.com/Klipper3d/klipper", KLIPPER_PATH], timeout=300)
        else:
            update_result = run_best_effort(["sudo", "git", "-C", KLIPPER_PATH, "pull", "--ff-only"], timeout=180)
            if update_result.returncode != 0:
                logger.warning("Klipper source update skipped/failed: %s", update_result.stderr)

        if not os.path.exists(KLIPPY_ENV_PATH):
            run_checked(["sudo", "python3", "-m", "venv", KLIPPY_ENV_PATH], timeout=180)

        requirements_path = os.path.join(KLIPPER_PATH, "scripts", "klippy-requirements.txt")
        run_checked(["sudo", os.path.join(KLIPPY_ENV_PATH, "bin", "pip"), "install", "--upgrade", "pip", "wheel"], timeout=300)
        run_checked(["sudo", os.path.join(KLIPPY_ENV_PATH, "bin", "pip"), "install", "-r", requirements_path], timeout=900)

        return {"success": True, "message": "Klipper installed successfully.", "status": get_software_status()}
    except subprocess.CalledProcessError as e:
        logger.error("Klipper install command failed: %s", describe_process_error(e))
        return {"success": False, "message": describe_process_error(e), "status": get_software_status()}
    except subprocess.TimeoutExpired as e:
        logger.error("Klipper install command timed out: %s", e)
        cmd = " ".join(e.cmd) if isinstance(e.cmd, list) else str(e.cmd)
        return {"success": False, "message": f"Klipper install timed out while running: {cmd}", "status": get_software_status()}
    except Exception as e:
        return {"success": False, "message": str(e), "status": get_software_status()}

@app.post("/software/install/moonraker")
@app.post("/software/install-moonraker")
async def install_moonraker():
    try:
        install_moonraker_system_dependencies()
        if not os.path.exists(MOONRAKER_PATH):
            run_checked(["sudo", "git", "clone", "https://github.com/Arksine/moonraker", MOONRAKER_PATH], timeout=300)
        else:
            update_result = run_best_effort(["sudo", "git", "-C", MOONRAKER_PATH, "pull", "--ff-only"], timeout=180)
            if update_result.returncode != 0:
                logger.warning("Moonraker source update skipped/failed: %s", update_result.stderr)

        if not os.path.exists(MOONRAKER_ENV_PATH):
            run_checked(["sudo", "python3", "-m", "venv", MOONRAKER_ENV_PATH], timeout=180)

        requirements_path = find_moonraker_requirements()
        run_checked(["sudo", os.path.join(MOONRAKER_ENV_PATH, "bin", "pip"), "install", "--upgrade", "pip", "wheel"], timeout=300)
        run_checked(["sudo", os.path.join(MOONRAKER_ENV_PATH, "bin", "pip"), "install", "-r", requirements_path], timeout=900)

        return {
            "success": True,
            "message": f"Moonraker installed successfully using {requirements_path}.",
            "requirements_path": requirements_path,
            "status": get_software_status(),
        }
    except subprocess.CalledProcessError as e:
        logger.error("Moonraker install command failed: %s", describe_process_error(e))
        return {"success": False, "message": describe_process_error(e), "status": get_software_status()}
    except subprocess.TimeoutExpired as e:
        logger.error("Moonraker install command timed out: %s", e)
        cmd = " ".join(e.cmd) if isinstance(e.cmd, list) else str(e.cmd)
        return {"success": False, "message": f"Moonraker install timed out while running: {cmd}", "status": get_software_status()}
    except Exception as e:
        return {"success": False, "message": str(e), "status": get_software_status()}

@app.post("/software/install/mainsail")
async def install_mainsail():
    try:
        run_checked(["sudo", "apt-get", "update", "--allow-releaseinfo-change"], timeout=180)
        run_checked(["sudo", "apt-get", "install", "-y", "nginx", "unzip", "wget", "curl", "ca-certificates"], timeout=600)

        archive_path = "/tmp/mainsail.zip"
        run_checked(["sudo", "mkdir", "-p", MAINSAIL_PATH], timeout=60)
        run_checked(["sudo", "find", MAINSAIL_PATH, "-mindepth", "1", "-delete"], timeout=120)
        run_checked(["sudo", "rm", "-f", archive_path], timeout=30)
        run_checked(["sudo", "curl", "-L", "--fail", "-o", archive_path, MAINSAIL_RELEASE_URL], timeout=300)
        run_checked(["sudo", "unzip", "-oq", archive_path, "-d", MAINSAIL_PATH], timeout=180)
        run_checked(["sudo", "rm", "-f", archive_path], timeout=30)

        tmp_site = "/tmp/mainsail-nginx.conf"
        with open(tmp_site, "w") as f:
            f.write(nginx_mainsail_config())

        run_checked(["sudo", "mkdir", "-p", "/etc/nginx/sites-available", "/etc/nginx/sites-enabled"], timeout=60)
        run_checked(["sudo", "mv", tmp_site, MAINSAIL_NGINX_SITE], timeout=30)
        run_best_effort(["sudo", "rm", "-f", "/etc/nginx/sites-enabled/default", "/etc/nginx/sites-available/default"], timeout=30)
        run_checked(["sudo", "ln", "-sf", MAINSAIL_NGINX_SITE, MAINSAIL_NGINX_ENABLED_SITE], timeout=30)
        run_checked(["sudo", "nginx", "-t"], timeout=30)
        run_checked(["sudo", "systemctl", "enable", "nginx"], timeout=60)
        run_checked(["sudo", "systemctl", "restart", "nginx"], timeout=60)

        return {
            "success": True,
            "message": "Mainsail installed successfully.",
            "mainsail_url": f"http://{get_ip()}",
            "status": get_software_status(),
        }
    except subprocess.CalledProcessError as e:
        logger.error("Mainsail install command failed: %s", describe_process_error(e))
        return {"success": False, "message": describe_process_error(e), "status": get_software_status()}
    except subprocess.TimeoutExpired as e:
        logger.error("Mainsail install command timed out: %s", e)
        cmd = " ".join(e.cmd) if isinstance(e.cmd, list) else str(e.cmd)
        return {"success": False, "message": f"Mainsail install timed out while running: {cmd}", "status": get_software_status()}
    except Exception as e:
        return {"success": False, "message": str(e), "status": get_software_status()}

@app.post("/software/install/runtime")
async def install_printer_runtime():
    steps = []
    for component, installer in (
        ("klipper", install_klipper),
        ("moonraker", install_moonraker),
        ("mainsail", install_mainsail),
    ):
        result = await installer()
        steps.append({"component": component, **result})
        if not result.get("success"):
            return {
                "success": False,
                "message": f"Printer runtime install stopped while installing {component}: {result.get('message', 'Unknown error')}",
                "steps": steps,
                "status": get_software_status(),
            }

    return {
        "success": True,
        "message": "Printer runtime installed successfully.",
        "mainsail_url": f"http://{get_ip()}",
        "steps": steps,
        "status": get_software_status(),
    }

@app.get("/storage/check")
async def check_storage():
    """
    Non-blocking storage check.
    Uses /proc/mounts to avoid hanging on stale NFS mounts.
    """
    mount_path = os.getenv("NFS_CLIENT_MOUNT", "/mnt/klipper-farm")

    mounted = False
    mount_source = ""
    filesystem_type = ""
    writable = False
    missing_dirs = []
    persistent_entry = get_fstab_mount_entry(mount_path)

    # 1. Read /proc/mounts to detect mount status without blocking
    mount_source, filesystem_type = get_mount_info(mount_path)
    mounted = bool(mount_source)

    # 2. Only perform IO tests if /proc/mounts confirms it is mounted
    if mounted:
        # Use subprocess with timeout for any IO operation on the mount
        try:
            # Check writability
            test_file = os.path.join(mount_path, ".agent_write_test")
            proc = run_privileged(
                ["touch", test_file],
                capture_output=True, timeout=2.0
            )
            if proc.returncode == 0:
                writable = True
                run_privileged(["rm", "-f", test_file], timeout=1.0)

            # Check required directories
            required = ["printers", "gcodes", "configs", "backups", "uploads", "logs"]
            for d in required:
                d_path = os.path.join(mount_path, d)
                proc = subprocess.run(["test", "-d", d_path], timeout=1.0)
                if proc.returncode != 0:
                    missing_dirs.append(d)

        except subprocess.TimeoutExpired:
            logger.warning(f"Storage IO check timed out on {mount_path} - stale mount?")
            mounted = False # Treat as unavailable if it hangs
            writable = False
        except Exception as e:
            logger.error(f"Storage IO check error: {e}")
            writable = False

    return {
        "nfs_available": mounted and writable and not missing_dirs,
        "mount_path": mount_path,
        "mounted": mounted,
        "is_mount": mounted,
        "writable": writable,
        "mount_source": mount_source,
        "filesystem_type": filesystem_type,
        "missing_dirs": missing_dirs,
        "persistent_configured": bool(persistent_entry),
        "persistent_source": persistent_entry.get("source") if persistent_entry else "",
        "auto_reconnect": bool(persistent_entry),
        "self_heal": STORAGE_SELF_HEAL_STATUS,
        "checked_at": datetime.datetime.now().isoformat()
    }

@app.post("/storage/mount")
async def mount_storage(req: MountRequest):
    if not req.mount_point.startswith("/mnt/"):
        raise HTTPException(status_code=403, detail="Only mounting under /mnt/ is allowed")

    attempts = []

    try:
        # 1. Install dependencies only when the NFS mount helper is missing.
        if not shutil.which("mount.nfs") and not shutil.which("mount.nfs4"):
            logger.info("Ensuring nfs-common is installed...")
            run_privileged(["apt-get", "update"], check=True, capture_output=True, text=True, timeout=120)
            run_privileged(["apt-get", "install", "-y", "nfs-common"], check=True, capture_output=True, text=True, timeout=180)
        else:
            attempts.append({"cmd": "nfs-common already installed", "success": True, "stderr": ""})

        # 2. Create mount point
        run_privileged(["mkdir", "-p", req.mount_point], check=True, capture_output=True, text=True, timeout=30)

        # 3. Clear any stale mount before attempting the current server.
        existing_source, existing_type = get_mount_info(req.mount_point)
        if existing_source:
            attempts.append({
                "cmd": f"existing mount {existing_source} ({existing_type})",
                "success": True,
                "stderr": ""
            })
            unmount_cmd = privileged_command(["umount", "-l", req.mount_point])
            unmount_res = subprocess.run(unmount_cmd, capture_output=True, text=True, timeout=15)
            attempts.append({
                "cmd": " ".join(unmount_cmd),
                "success": unmount_res.returncode == 0,
                "stderr": unmount_res.stderr
            })
            if unmount_res.returncode != 0:
                return {
                    "success": False,
                    "message": f"Unable to unmount existing storage mount {existing_source}: {unmount_res.stderr}",
                    "attempts": attempts
                }

        # 4. Attempt mount - Try NFSv4 root first (modern)
        mount_opts = "timeo=50,retrans=2"

        # Attempt 1: NFSv4 root
        cmd1 = privileged_command(["mount", "-t", "nfs4", "-o", mount_opts, f"{req.server}:/", req.mount_point])
        res1 = subprocess.run(cmd1, capture_output=True, text=True, timeout=10)
        attempts.append({"cmd": " ".join(cmd1), "success": res1.returncode == 0, "stderr": res1.stderr})
        fstab_source = f"{req.server}:/"
        fstab_type = "nfs4"

        if res1.returncode != 0:
            # Attempt 2: Traditional NFS export path
            cmd2 = privileged_command(["mount", "-t", "nfs", "-o", mount_opts, f"{req.server}:{req.export}", req.mount_point])
            res2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=10)
            attempts.append({"cmd": " ".join(cmd2), "success": res2.returncode == 0, "stderr": res2.stderr})
            fstab_source = f"{req.server}:{req.export}"
            fstab_type = "nfs"

            if res2.returncode != 0:
                msg = f"All mount attempts failed. Last error: {res2.stderr}"
                if "Permission denied" in res2.stderr:
                    msg = "NFS server denied access. Check PERMITTED settings on the dashboard server."
                return {"success": False, "message": msg, "attempts": attempts}

        # 5. Add to fstab for persistence if requested
        if req.persistent:
            if any(c in req.server + req.export + req.mount_point for c in ";|&><$()\"'"):
                 return {"success": False, "message": "Invalid characters in mount parameters"}

            fstab_options = "defaults,_netdev,nofail,x-systemd.automount,timeo=50,retrans=2"
            fstab_entry = f"{fstab_source} {req.mount_point} {fstab_type} {fstab_options} 0 0"
            with open("/etc/fstab", "r") as f:
                existing_fstab = f.readlines()

            filtered_fstab = [
                line for line in existing_fstab
                if line.lstrip().startswith("#")
                or len(line.split()) < 2
                or line.split()[1] != req.mount_point
            ]
            if not filtered_fstab or not filtered_fstab[-1].endswith("\n"):
                filtered_fstab.append("\n")

            if fstab_entry + "\n" not in filtered_fstab:
                filtered_fstab.append(fstab_entry + "\n")

            if filtered_fstab != existing_fstab:
                try:
                    run_privileged(
                        ["tee", "/etc/fstab"],
                        input="".join(filtered_fstab),
                        check=True,
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                except subprocess.CalledProcessError:
                    run_privileged(
                        ["tee", "-a", "/etc/fstab"],
                        input=fstab_entry + "\n",
                        check=True,
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )

            daemon_reload = run_privileged(["systemctl", "daemon-reload"], capture_output=True, text=True, timeout=20)
            attempts.append({
                "cmd": "systemctl daemon-reload",
                "success": daemon_reload.returncode == 0,
                "stderr": daemon_reload.stderr,
            })
            STORAGE_SELF_HEAL_STATUS["enabled"] = True
            STORAGE_SELF_HEAL_STATUS["last_error"] = ""
            STORAGE_SELF_HEAL_STATUS["last_success_at"] = datetime.datetime.now().isoformat()

        return {"success": True, "message": "NFS storage mounted successfully.", "attempts": attempts}
    except subprocess.TimeoutExpired as e:
        cmd = " ".join(getattr(e, "cmd", []) or [])
        return {"success": False, "message": f"Mount operation timed out while running '{cmd}' after {e.timeout} seconds.", "attempts": attempts}
    except subprocess.CalledProcessError as e:
        return {"success": False, "message": describe_process_error(e), "attempts": attempts}
    except Exception as e:
        logger.error(f"Mount error: {e}")
        return {"success": False, "message": str(e), "attempts": attempts}

@app.get("/version")
async def get_version():
    commit = "unknown"
    branch = "unknown"
    if os.path.exists(NODE_AGENT_REPO_DIR):
        try:
            commit = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", "HEAD"], text=True).strip()
            branch = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", "--abbrev-ref", "HEAD"], text=True).strip()
        except Exception:
            pass

    return {
        "version": "1.0.0",
        "commit": commit,
        "branch": branch,
        "repo_dir": NODE_AGENT_REPO_DIR,
        "agent_dir": os.path.join(NODE_AGENT_REPO_DIR, "node-agent")
    }

async def delayed_restart():
    await asyncio.sleep(1)
    subprocess.run(["sudo", "systemctl", "restart", "klipper-farm-node-agent"])

async def delayed_reboot():
    await asyncio.sleep(1)
    subprocess.run(["sudo", "reboot"])

@app.post("/restart-agent")
async def restart_agent():
    asyncio.create_task(delayed_restart())
    return {
        "success": True,
        "message": "Node-agent restart initiated.",
        "action": "restart_agent",
        "timestamp": datetime.datetime.now().isoformat()
    }

@app.post("/reboot")
async def reboot_node():
    asyncio.create_task(delayed_reboot())
    return {
        "success": True,
        "message": "Node reboot initiated.",
        "action": "reboot",
        "timestamp": datetime.datetime.now().isoformat()
    }

@app.post("/restart-printers")
async def restart_printers():
    try:
        # Restart all klipper and moonraker services
        subprocess.run("sudo systemctl restart klipper*", shell=True)
        subprocess.run("sudo systemctl restart moonraker*", shell=True)
        return {
            "success": True,
            "message": "All printer services restarted.",
            "action": "restart_printers",
            "timestamp": datetime.datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Failed to restart services: {str(e)}",
            "action": "restart_printers",
            "timestamp": datetime.datetime.now().isoformat()
        }

@app.post("/update")
async def update_agent():
    if not os.path.exists(NODE_AGENT_REPO_DIR):
        raise HTTPException(status_code=404, detail="Repo directory not found")

    result = {
        "success": False,
        "status": "failed",
        "message": "",
        "before_commit": "",
        "after_commit": "",
        "remote_commit": "",
        "git_fetch_output": "",
        "git_pull_output": "",
        "pip_output": "",
        "restart_required": False,
        "timestamp": datetime.datetime.now().isoformat()
    }

    try:
        # 1. Get current commit
        result["before_commit"] = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", "HEAD"], text=True).strip()

        # 2. Fetch
        fetch_res = subprocess.run(["git", "-C", NODE_AGENT_REPO_DIR, "fetch", "origin"], capture_output=True, text=True)
        result["git_fetch_output"] = fetch_res.stdout + fetch_res.stderr

        # 3. Get remote commit
        branch = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", "--abbrev-ref", "HEAD"], text=True).strip()
        result["remote_commit"] = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", f"origin/{branch}"], text=True).strip()

        if result["before_commit"] == result["remote_commit"]:
            result["success"] = True
            result["status"] = "already_up_to_date"
            result["message"] = "Node-agent is already up to date."
            result["after_commit"] = result["before_commit"]
        else:
            # 4. Pull
            pull_res = subprocess.run(["git", "-C", NODE_AGENT_REPO_DIR, "pull", "--ff-only"], capture_output=True, text=True)
            result["git_pull_output"] = pull_res.stdout + pull_res.stderr
            if pull_res.returncode != 0:
                result["message"] = f"Git pull failed: {pull_res.stderr}"
                return result

            result["after_commit"] = subprocess.check_output(["git", "-C", NODE_AGENT_REPO_DIR, "rev-parse", "HEAD"], text=True).strip()
            result["status"] = "updated"
            result["message"] = "Source code updated successfully."
            result["restart_required"] = True
            result["success"] = True

        # 5. Always check dependencies if requirements changed or explicitly on update
        agent_dir = os.path.join(NODE_AGENT_REPO_DIR, "node-agent")
        venv_pip = os.path.join(agent_dir, "venv", "bin", "pip")
        requirements_txt = os.path.join(agent_dir, "requirements.txt")

        if os.path.exists(venv_pip) and os.path.exists(requirements_txt):
            pip_res = subprocess.run([venv_pip, "install", "-r", requirements_txt], capture_output=True, text=True)
            result["pip_output"] = pip_res.stdout + pip_res.stderr
            if pip_res.returncode != 0:
                result["success"] = False
                result["status"] = "failed"
                result["message"] = f"Pip install failed: {pip_res.stderr}"

        return result
    except Exception as e:
        logger.error(f"Update failed: {e}")
        result["message"] = str(e)
        return result

async def heartbeat_task():
    """Background task to notify central server we are online."""
    async with httpx.AsyncClient() as client:
        while True:
            try:
                # Use health info for heartbeat
                h = await health()
                payload = {
                    "node_uuid": NODE_UUID,
                    "hostname": h["hostname"],
                    "ip_address": h["ip_address"],
                    "agent_port": AGENT_PORT,
                    "model": h["model"],
                    "pi_model": h["pi_model"],
                    "version": h["version"],
                    "cpu_usage": h["cpu_usage"],
                    "ram_usage": h["ram_usage"],
                    "temperature": h["temperature"],
                    "uptime": h["uptime"],
                    "usb_serial_count": h["usb_serial_count"],
                    "usb_device_count": h["usb_device_count"]
                }
                await client.post(f"{CENTRAL_SERVER_URL}/api/nodes/heartbeat", json=payload, timeout=5.0)
            except Exception as e:
                logger.error(f"Heartbeat failed: {e}")
            await asyncio.sleep(15)

async def storage_watchdog_task():
    await asyncio.sleep(5)
    while True:
        try:
            await ensure_persistent_storage_mounted("watchdog")
        except Exception as e:
            logger.error(f"Storage watchdog failed: {e}")
        await asyncio.sleep(45)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(ensure_persistent_storage_mounted("startup"))
    asyncio.create_task(storage_watchdog_task())
    asyncio.create_task(heartbeat_task())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=AGENT_PORT)
