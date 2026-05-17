from fastapi import APIRouter, HTTPException
import os
import socket

router = APIRouter(prefix="/storage", tags=["storage"])

NFS_EXPORT_PATH = os.getenv("NFS_EXPORT_PATH", "/exports")
NFS_CLIENT_MOUNT = os.getenv("NFS_CLIENT_MOUNT", "/mnt/klipper-farm")
STORAGE_ROOT = os.getenv("STORAGE_ROOT", "/mnt/klipper-farm") # Mapping in container

def get_server_ip():
    # prioritise explicit host from ENV, then auto-detect
    server_ip = os.getenv("NFS_SERVER_HOST")
    if server_ip: return server_ip

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        IP = s.getsockname()[0]
        s.close()
        # Filter out docker internal IPs
        if IP.startswith(("172.", "127.")):
            return "MANUAL_IP_REQUIRED"
        return IP
    except:
        return "SERVER_IP"

@router.get("/nfs-status")
async def get_nfs_status():
    server_ip = get_server_ip()

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
