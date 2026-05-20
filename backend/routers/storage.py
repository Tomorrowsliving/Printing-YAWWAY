from fastapi import APIRouter, Request
import os
from ..utils.network_settings import get_effective_dashboard_host

router = APIRouter(prefix="/storage", tags=["storage"])

NFS_EXPORT_PATH = os.getenv("NFS_EXPORT_PATH", "/exports")
NFS_CLIENT_MOUNT = os.getenv("NFS_CLIENT_MOUNT", "/mnt/klipper-farm")
STORAGE_ROOT = os.getenv("STORAGE_ROOT", "/mnt/klipper-farm") # Mapping in container

def get_server_ip(request):
    return get_effective_dashboard_host(request) or "UNDETECTED"

@router.get("/nfs-status")
async def get_nfs_status(request: Request):
    server_ip = get_server_ip(request)

    # Check required directories in the container mount
    required = ["printers", "gcodes", "configs", "backups", "uploads", "logs"]
    dir_status = {}
    for d in required:
        dir_status[d] = os.path.exists(os.path.join(STORAGE_ROOT, d))

    return {
        "server_export_path": NFS_EXPORT_PATH,
        "storage_root": STORAGE_ROOT,
        "expected_client_mount": NFS_CLIENT_MOUNT,
        "permitted_subnet": os.getenv("NFS_PERMITTED", "10.1.8.0/22"),
        "required_directories": dir_status,
        "mount_command_nfs": f"sudo mount -t nfs {server_ip}:{NFS_EXPORT_PATH} {NFS_CLIENT_MOUNT}",
        "mount_command_nfs4": f"sudo mount -t nfs4 {server_ip}:/ {NFS_CLIENT_MOUNT}"
    }
