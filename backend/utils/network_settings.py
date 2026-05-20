import json
import os
import ipaddress
import socket
from urllib.parse import urlparse


STORAGE_ROOT = os.getenv("STORAGE_ROOT", "/mnt/klipper-farm")
SETTINGS_DIR = os.getenv("SETTINGS_PATH", os.path.join(STORAGE_ROOT, "settings"))
NETWORK_SETTINGS_FILE = "network-settings.json"


def host_from_url(value):
    if not value:
        return None
    value = str(value).strip()
    parsed = urlparse(value if "://" in value else f"//{value}")
    return parsed.hostname or value.split("/", 1)[0].split(":", 1)[0].strip("/")


def is_placeholder_host(host):
    if not host:
        return True
    lowered = str(host).strip().lower()
    return lowered in {
        "localhost",
        "server_ip",
        "your_server_ip",
        "manual_ip_required",
        "undetected",
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
    if not request:
        return None
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


def _settings_path():
    return os.path.join(SETTINGS_DIR, NETWORK_SETTINGS_FILE)


def load_network_settings():
    try:
        with open(_settings_path(), "r") as f:
            data = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        data = {}

    dashboard_host = host_from_url(data.get("dashboard_host"))
    if is_unusable_network_host(dashboard_host):
        dashboard_host = ""

    return {"dashboard_host": dashboard_host or ""}


def save_network_settings(dashboard_host):
    host = host_from_url(dashboard_host)
    if host and is_unusable_network_host(host):
        raise ValueError("Use a LAN IP or hostname that Pi nodes can reach.")

    os.makedirs(SETTINGS_DIR, exist_ok=True)
    data = {"dashboard_host": host or ""}
    with open(_settings_path(), "w") as f:
        json.dump(data, f, indent=2)
    return data


def get_env_host():
    for key in ("NFS_SERVER_HOST", "BACKEND_PUBLIC_URL", "BACKEND_URL"):
        host = host_from_url(os.getenv(key))
        if host and not is_unusable_network_host(host):
            return host
    return None


def get_suggested_host(request=None):
    for host in (get_request_host(request), detect_socket_lan_host()):
        if host and not is_docker_fallback_host(host):
            return host
    return None


def get_effective_dashboard_host(request=None):
    saved_host = load_network_settings().get("dashboard_host")
    if saved_host:
        return saved_host

    env_host = get_env_host()
    if env_host:
        return env_host

    return get_suggested_host(request)


def describe_network_state(request=None):
    saved = load_network_settings()
    env_host = get_env_host()
    browser_host = get_request_host(request)
    suggested_host = get_suggested_host(request)
    effective_host = get_effective_dashboard_host(request)

    return {
        "dashboard_host": saved["dashboard_host"],
        "env_host": env_host or "",
        "browser_host": browser_host or "",
        "suggested_host": suggested_host or "",
        "effective_host": effective_host or "",
        "browser_host_usable": bool(browser_host and not is_unusable_network_host(browser_host)),
        "saved_host_usable": bool(saved["dashboard_host"]),
        "requires_setup": not bool(saved["dashboard_host"] or env_host),
    }
