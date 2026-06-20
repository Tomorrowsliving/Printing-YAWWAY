from fastapi import APIRouter, Request
import os
import shutil
import uuid
from ..utils.network_settings import get_effective_dashboard_host

router = APIRouter(prefix="/storage", tags=["storage"])

NFS_EXPORT_PATH = os.getenv("NFS_EXPORT_PATH", "/exports")
NFS_CLIENT_MOUNT = os.getenv("NFS_CLIENT_MOUNT", "/mnt/klipper-farm")
STORAGE_ROOT = os.getenv("STORAGE_ROOT", "/mnt/klipper-farm") # Mapping in container

def get_server_ip(request):
    return get_effective_dashboard_host(request) or "UNDETECTED"

def _format_bytes(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    units = ["B", "KB", "MB", "GB", "TB"]
    index = 0
    while value >= 1024 and index < len(units) - 1:
        value /= 1024
        index += 1
    return f"{value:.1f} {units[index]}" if index else f"{int(value)} {units[index]}"

def _count_files(root, suffixes=None):
    if not os.path.isdir(root):
        return 0
    count = 0
    suffixes = tuple(item.lower() for item in suffixes or [])
    for dirpath, _, filenames in os.walk(root):
        for filename in filenames:
            if suffixes and not filename.lower().endswith(suffixes):
                continue
            count += 1
    return count

def _nfs_status_payload(request: Request, run_write_test: bool = False):
    server_ip = get_server_ip(request)

    required = ["printers", "gcodes", "configs", "backups", "uploads", "logs"]
    dir_status = {}
    for d in required:
        dir_status[d] = os.path.exists(os.path.join(STORAGE_ROOT, d))

    readable = os.path.isdir(STORAGE_ROOT) and os.access(STORAGE_ROOT, os.R_OK)
    writable = os.path.isdir(STORAGE_ROOT) and os.access(STORAGE_ROOT, os.W_OK)
    write_error = None
    write_test_path = None

    if run_write_test and writable:
        write_test_path = os.path.join(STORAGE_ROOT, f".nfs-health-{uuid.uuid4().hex}.tmp")
        try:
            with open(write_test_path, "w", encoding="utf-8") as f:
                f.write("klipper-farm-health-check\n")
            with open(write_test_path, "r", encoding="utf-8") as f:
                readable = readable and "klipper-farm-health-check" in f.read()
            os.remove(write_test_path)
            writable = True
        except Exception as exc:
            writable = False
            write_error = str(exc)
            try:
                if write_test_path and os.path.exists(write_test_path):
                    os.remove(write_test_path)
            except OSError:
                pass

    disk = None
    if os.path.exists(STORAGE_ROOT):
        try:
            usage = shutil.disk_usage(STORAGE_ROOT)
            disk = {
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "total_formatted": _format_bytes(usage.total),
                "used_formatted": _format_bytes(usage.used),
                "free_formatted": _format_bytes(usage.free),
                "used_percent": round((usage.used / usage.total) * 100, 1) if usage.total else None,
            }
        except OSError:
            disk = None

    backups_root = os.path.join(STORAGE_ROOT, "backups")
    printers_root = os.path.join(STORAGE_ROOT, "printers")
    gcode_count = _count_files(printers_root, [".gcode", ".gco", ".g"])
    backup_count = _count_files(backups_root)

    mounted = os.path.ismount(STORAGE_ROOT) or readable
    return {
        "server_export_path": NFS_EXPORT_PATH,
        "storage_root": STORAGE_ROOT,
        "expected_client_mount": NFS_CLIENT_MOUNT,
        "permitted_subnet": os.getenv("NFS_PERMITTED", "10.1.8.0/22"),
        "required_directories": dir_status,
        "mounted": mounted,
        "readable": readable,
        "writable": writable,
        "write_tested": run_write_test,
        "write_error": write_error,
        "disk": disk,
        "free_space": disk["free_formatted"] if disk else None,
        "storage_usage_percent": disk["used_percent"] if disk else None,
        "backup_count": backup_count,
        "gcode_count": gcode_count,
        "mount_command_nfs": f"sudo mount -t nfs {server_ip}:{NFS_EXPORT_PATH} {NFS_CLIENT_MOUNT}",
        "mount_command_nfs4": f"sudo mount -t nfs4 {server_ip}:/ {NFS_CLIENT_MOUNT}"
    }

@router.get("/nfs-status")
async def get_nfs_status(request: Request):
    return _nfs_status_payload(request)

@router.post("/nfs-test")
async def test_nfs_connection(request: Request):
    return _nfs_status_payload(request, run_write_test=True)
