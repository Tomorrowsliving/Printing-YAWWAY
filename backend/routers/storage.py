from fastapi import APIRouter, Request
import os
import ipaddress
import socket
from urllib.parse import urlparse

router = APIRouter(prefix="/storage", tags=["storage"])

NFS_EXPORT_PATH = os.getenv("NFS_EXPORT_PATH", "/exports")
NFS_CLIENT_MOUNT = os.getenv("NFS_CLIENT_MOUNT", "/mnt/klipper-farm")
STORAGE_ROOT = os.getenv("STORAGE_ROOT", "/mnt/klipper-farm") # Mapping in container

def host_from_url(value):
    if not value:
        return None
    value = str(value).strip()
    parsed = urlparse(value if "://" in value else f"//{value}")
    return parsed.hostname or value.split("/", 1)[0].split(":", 1)[0].strip("/")

def is_placeholder_host(host):
    if not host:
        return True
    lowered = host.strip().lower()
    return lowered in {
        "localhost",
        "server_ip",
        "your_server_ip",
        "manual_ip_required",
        "0.0.0.0",
        "::",
        "::1",
    }

def is_unusable_network_host(host):
    if is_placeholder_host(host):
        return True
    try:
        addr = ipaddress.ip_address(host)
        return addr.is_loopback or addr.is_unspecified or addr.is_link_local
    except ValueError:
        return False

def is_docker_fallback_host(host):
    if is_unusable_network_host(host):
        return True
    try:
        addr = ipaddress.ip_address(host)
        return addr in ipaddress.ip_network("172.16.0.0/12")
    except ValueError:
        return False

def get_request_host(request):
    return (
        host_from_url(request.headers.get("x-forwarded-host"))
        or host_from_url(request.headers.get("host"))
        or request.url.hostname
    )

def detect_socket_lan_host():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()

def get_server_ip(request):
    candidates = [
        os.getenv("NFS_SERVER_HOST"),
        os.getenv("BACKEND_PUBLIC_URL"),
        os.getenv("BACKEND_URL"),
        get_request_host(request),
    ]

    for candidate in candidates:
        host = host_from_url(candidate)
        if not is_unusable_network_host(host):
            return host

    socket_host = detect_socket_lan_host()
    if socket_host and not is_docker_fallback_host(socket_host):
        return socket_host

    return "UNDETECTED"

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
