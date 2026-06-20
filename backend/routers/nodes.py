from fastapi import APIRouter, Depends, HTTPException, Request, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, delete, update
from sqlalchemy.orm import selectinload
from typing import List, Optional
from ..database import AsyncSessionLocal, get_db
from ..models import Assignment, Node, Event, Printer, ServiceInstance, UsbDevice
from ..schemas import NodeCreate, NodeHeartbeat, Node as NodeSchema
from ..utils.network_settings import get_effective_dashboard_host, host_from_url
import datetime
import ipaddress
import httpx
import logging
import os
import asyncio
import time

# Setup logger
logger = logging.getLogger("klipper-farm")

router = APIRouter(prefix="/nodes", tags=["nodes"])

AUTO_MOUNT_IN_FLIGHT = set()
AUTO_MOUNT_LAST_ATTEMPT = {}
AUTO_MOUNT_THROTTLE_SECONDS = 300
NODE_OPERATION_STATES = {}
SOFTWARE_INSTALL_OPERATIONS = {
    "runtime": (
        "software_runtime_installing",
        "Installing Klipper, Moonraker, and Mainsail. Large downloads and Python package builds can make Pi Zero nodes slow to answer.",
    ),
    "klipper": (
        "software_klipper_installing",
        "Installing Klipper runtime. The node may answer slowly while apt, git, and pip finish.",
    ),
    "moonraker": (
        "software_moonraker_installing",
        "Installing Moonraker runtime. Python package builds can take several minutes on small Pis.",
    ),
    "mainsail": (
        "software_mainsail_installing",
        "Installing Mainsail and web server packages. The node may briefly stop answering.",
    ),
}
SOFTWARE_OPERATION_NAMES = {operation for operation, _message in SOFTWARE_INSTALL_OPERATIONS.values()}

def _normalise_service_name(name: str):
    name = clean_string(name)
    if not name:
        return None
    return name if name.endswith(".service") else f"{name}.service"

def _service_type(name: str):
    if name.startswith("klipper-"):
        return "klipper"
    if name.startswith("moonraker-"):
        return "moonraker"
    return "other"

def _safe_service_name(service: str):
    service = _normalise_service_name(service)
    if not service or not (service.startswith("klipper-") or service.startswith("moonraker-")):
        raise HTTPException(status_code=403, detail="Unauthorised service name")
    return service

async def persist_node_inventory(db: AsyncSession, node_id: int, usb_devices=None, service_instances=None):
    now = utcnow()

    if usb_devices is not None:
        await db.execute(delete(UsbDevice).where(UsbDevice.node_id == node_id))
        for item in usb_devices if isinstance(usb_devices, list) else []:
            device_id = clean_string(item.get("id") or item.get("device_id") or item.get("name"))
            path = clean_string(item.get("path"))
            if not device_id and not path:
                continue
            db.add(UsbDevice(node_id=node_id, device_id=device_id, path=path, last_seen=now))

    if service_instances is not None:
        await db.execute(delete(ServiceInstance).where(ServiceInstance.node_id == node_id))
        for item in service_instances if isinstance(service_instances, list) else []:
            name = _normalise_service_name(item.get("name") or item.get("service"))
            if not name:
                continue
            db.add(ServiceInstance(
                node_id=node_id,
                name=name,
                status=clean_string(item.get("status")),
                active=clean_string(item.get("active")),
                service_type=_service_type(name),
                last_seen=now,
            ))

def is_local_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback
    except ValueError:
        return False

def clean_string(value):
    if value is None:
        return None
    return str(value).replace("\x00", "").strip()

def get_nfs_server_host(request: Optional[Request] = None):
    return get_effective_dashboard_host(request)

def utcnow():
    return datetime.datetime.now(datetime.timezone.utc)

def set_node_operation(node_id: int, operation: str, message: str, ttl_seconds: int = 600):
    now = utcnow()
    NODE_OPERATION_STATES[node_id] = {
        "operation": operation,
        "message": message,
        "started_at": now,
        "expires_at": now + datetime.timedelta(seconds=ttl_seconds),
    }

def get_node_operation(node_id: int):
    state = NODE_OPERATION_STATES.get(node_id)
    if not state:
        return None
    if state["expires_at"] <= utcnow():
        NODE_OPERATION_STATES.pop(node_id, None)
        return None
    return state

def clear_node_operation(node_id: int, operation: Optional[str] = None):
    state = NODE_OPERATION_STATES.get(node_id)
    if not state:
        return
    if operation and state.get("operation") != operation:
        return
    NODE_OPERATION_STATES.pop(node_id, None)

def is_software_operation(state):
    return bool(state and state.get("operation") in SOFTWARE_OPERATION_NAMES)

def _kind_from_software_operation(operation: str):
    for kind, (operation_name, _message) in SOFTWARE_INSTALL_OPERATIONS.items():
        if operation_name == operation:
            return kind
    return "software"

def software_job_from_operation(node_id: int, state):
    if not is_software_operation(state):
        return None
    started_at = state.get("started_at") or utcnow()
    message = state.get("message") or "Software install is running."
    kind = _kind_from_software_operation(state.get("operation"))
    return {
        "id": f"node-{node_id}-{state.get('operation')}",
        "kind": kind,
        "component": kind,
        "status": "running",
        "success": None,
        "message": message,
        "current_command": "",
        "started_at": started_at,
        "updated_at": utcnow(),
        "completed_at": None,
        "log": [{
            "timestamp": started_at,
            "level": "info",
            "message": message,
        }],
    }

def software_install_fallback_payload(node: Node, state=None, warning: Optional[str] = None):
    active_operation = state or get_node_operation(node.id)
    job = software_job_from_operation(node.id, active_operation)
    if not job:
        return None
    payload = {
        "success": True,
        "accepted": True,
        "busy": True,
        "message": active_operation.get("message") or "Software install is running.",
        "job": job,
        "install_job": job,
        "status": {
            "install_job": job,
            "busy": True,
        },
        "active_operation": active_operation.get("operation"),
    }
    if warning:
        payload["warning"] = warning
    return payload

def _storage_mount_payload(server_ip: str):
    return {
        "server": server_ip,
        "export": os.getenv("NFS_EXPORT_PATH", "/exports"),
        "mount_point": os.getenv("NFS_CLIENT_MOUNT", "/mnt/klipper-farm"),
        "persistent": True,
    }

def _agent_url(node: Node, path: str):
    return f"http://{node.ip_address}:{node.agent_port}{path}"

async def _wait_for_node_health(node: Node, timeout_seconds: int = 45):
    deadline = time.monotonic() + timeout_seconds
    last_error = None
    async with httpx.AsyncClient() as client:
        while time.monotonic() < deadline:
            try:
                res = await client.get(_agent_url(node, "/health"), timeout=3)
                if res.status_code == 200:
                    return {"ready": True, "health": res.json()}
                last_error = f"HTTP {res.status_code}"
            except Exception as e:
                last_error = str(e)
            await asyncio.sleep(3)
    return {"ready": False, "error": last_error or "Timed out waiting for node health"}

async def _post_node_update(node: Node, timeout_seconds: int = 90):
    async with httpx.AsyncClient() as client:
        res = await client.post(_agent_url(node, "/update"), timeout=timeout_seconds)
    try:
        payload = res.json()
    except Exception:
        payload = {"success": False, "status": "failed", "message": res.text}
    if res.status_code >= 400:
        payload["success"] = False
        payload.setdefault("status", "failed")
        payload.setdefault("message", f"Node-agent returned HTTP {res.status_code}")
    return payload

async def _post_node_storage_mount(node: Node, server_ip: str):
    async with httpx.AsyncClient() as client:
        res = await client.post(
            _agent_url(node, "/storage/mount"),
            json=_storage_mount_payload(server_ip),
            timeout=360,
        )
    try:
        payload = res.json()
    except Exception:
        payload = {"success": False, "message": res.text}
    if res.status_code >= 400:
        payload["success"] = False
        payload.setdefault("message", f"Node-agent returned HTTP {res.status_code}")
    return payload

async def auto_mount_node_storage(node_id: int, hostname: str, ip_address: str, agent_port: int, server_ip: str, reason: str):
    if not server_ip or not ip_address or not agent_port:
        return

    now = time.monotonic()
    last_attempt = AUTO_MOUNT_LAST_ATTEMPT.get(node_id, 0)
    if node_id in AUTO_MOUNT_IN_FLIGHT or now - last_attempt < AUTO_MOUNT_THROTTLE_SECONDS:
        return

    AUTO_MOUNT_IN_FLIGHT.add(node_id)
    AUTO_MOUNT_LAST_ATTEMPT[node_id] = now
    set_node_operation(
        node_id,
        "nfs_mounting",
        "Auto-connecting NFS storage. The node may briefly stop responding while packages or mounts settle.",
        ttl_seconds=420,
    )
    base_url = f"http://{ip_address}:{agent_port}"
    event_severity = "info"
    event_message = f"NFS storage auto-connect completed for {hostname}"
    details = {"reason": reason, "server": server_ip}

    try:
        async with httpx.AsyncClient() as client:
            try:
                check_res = await client.get(f"{base_url}/storage/check", timeout=5)
                if check_res.status_code == 200:
                    check_data = check_res.json()
                    details["before"] = check_data
                    if check_data.get("nfs_available"):
                        return
            except Exception as e:
                details["precheck_error"] = str(e)

            mount_res = await client.post(
                f"{base_url}/storage/mount",
                json=_storage_mount_payload(server_ip),
                timeout=360,
            )
            try:
                mount_data = mount_res.json()
            except Exception:
                mount_data = {"message": mount_res.text}
            details["mount"] = mount_data

            if mount_res.status_code >= 400 or mount_data.get("success") is False:
                event_severity = "warning"
                event_message = mount_data.get("message") or f"NFS storage auto-connect failed for {hostname}"
                details["what_failed"] = "NFS storage auto-connect"
                details["likely_cause"] = "Node-agent is out of date, NFS helpers are missing, or the mount path/export is not reachable"
                details["suggested_fix"] = "Use Update & Retry NFS on the node card. The dashboard will retry the update once, then try the NFS mount again."
                details["recommended_action"] = "update_and_retry_nfs"
            else:
                event_message = mount_data.get("message") or event_message
    except Exception as e:
        event_severity = "warning"
        event_message = f"NFS storage auto-connect failed for {hostname}: {e}"
        details["error"] = str(e)
        details["what_failed"] = "NFS storage auto-connect"
        details["likely_cause"] = "Node-agent was unreachable or did not complete the mount command"
        details["suggested_fix"] = "Use Update & Retry NFS on the node card. The dashboard will retry the update once, then try the NFS mount again."
        details["recommended_action"] = "update_and_retry_nfs"
    finally:
        AUTO_MOUNT_IN_FLIGHT.discard(node_id)
        clear_node_operation(node_id, "nfs_mounting")

    try:
        async with AsyncSessionLocal() as db:
            db.add(Event(
                node_id=node_id,
                severity=event_severity,
                event_type="node_storage_auto_mount",
                message=event_message,
                details=details,
            ))
            await db.commit()
    except Exception as e:
        logger.error(f"Failed to record auto-mount event for node {node_id}: {e}")

def schedule_auto_mount_node_storage(node: Node, request: Optional[Request], reason: str):
    if not node or not node.approved:
        return
    if not node.online:
        logger.info("Skipping storage auto-connect for %s: node is offline", node.hostname)
        return
    server_ip = get_nfs_server_host(request)
    if not server_ip:
        logger.warning("Skipping storage auto-connect for %s: dashboard LAN host is not configured", node.hostname)
        return
    asyncio.create_task(auto_mount_node_storage(
        node.id,
        node.hostname,
        node.ip_address,
        node.agent_port,
        server_ip,
        reason,
    ))

async def monitor_approved_node_storage():
    await asyncio.sleep(15)
    while True:
        try:
            server_ip = get_nfs_server_host(None)
            if not server_ip:
                logger.warning("Skipping storage watchdog: dashboard LAN host is not configured")
            else:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(
                        select(Node).where(Node.approved.is_(True)).where(Node.online.is_(True))
                    )
                    for node in result.scalars().all():
                        active_operation = get_node_operation(node.id)
                        if active_operation and active_operation.get("operation") == "nfs_mounting":
                            continue
                        asyncio.create_task(auto_mount_node_storage(
                            node.id,
                            node.hostname,
                            node.ip_address,
                            node.agent_port,
                            server_ip,
                            "storage_watchdog",
                        ))
        except Exception as e:
            logger.error("Storage watchdog failed: %s", e)

        await asyncio.sleep(60)

def unique_non_empty(values):
    seen = set()
    result = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result

def get_backend_public_host(request: Request):
    configured_url = get_effective_dashboard_host(request) or os.getenv("BACKEND_PUBLIC_URL") or os.getenv("BACKEND_URL")
    client_host = request.client.host if request.client else None
    return host_from_url(configured_url) or request.url.hostname or client_host

def render_moonraker_config(printer_slug, moonraker_port, config_path, logs_path, backend_ip, node_ip):
    trusted_clients = unique_non_empty([
        "127.0.0.1",
        host_from_url(backend_ip),
        host_from_url(node_ip),
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
    ])
    cors_domains = unique_non_empty([
        f"http://{host_from_url(backend_ip)}" if backend_ip else None,
        f"http://{host_from_url(node_ip)}" if node_ip else None,
        f"http://{host_from_url(node_ip)}:{moonraker_port}" if node_ip else None,
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

def ensure_moonraker_config_payload(data: dict, node: Node, request: Request):
    if data.get("moonraker_conf_content"):
        return data

    required_fields = ["printer_slug", "moonraker_port", "config_path", "logs_path"]
    missing_fields = [field for field in required_fields if not data.get(field)]
    if missing_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot generate moonraker.conf, missing fields: {', '.join(missing_fields)}",
        )

    backend_ip = get_backend_public_host(request)
    node_ip = node.ip_address
    data["backend_ip"] = backend_ip
    data["node_ip"] = node_ip
    data["moonraker_conf_content"] = render_moonraker_config(
        printer_slug=data["printer_slug"],
        moonraker_port=data["moonraker_port"],
        config_path=data["config_path"],
        logs_path=data["logs_path"],
        backend_ip=backend_ip,
        node_ip=node_ip,
    )
    return data

def serialize_node(node):
    """Utility to serialize SQLAlchemy Node model to dict to avoid MissingGreenlet errors"""
    active_operation = get_node_operation(node.id)
    usb_devices = [
        {"id": device.device_id, "path": device.path, "last_seen": device.last_seen}
        for device in (node.__dict__.get("usb_devices") or [])
    ]
    service_instances = [
        {
            "name": instance.name,
            "status": instance.status,
            "active": instance.active,
            "service_type": instance.service_type,
            "last_seen": instance.last_seen,
        }
        for instance in (node.__dict__.get("service_instances") or [])
    ]
    return {
        "id": node.id,
        "node_uuid": node.node_uuid,
        "hostname": node.hostname,
        "name": node.name,
        "ip_address": node.ip_address,
        "agent_port": node.agent_port,
        "cpu_usage": node.cpu_usage,
        "ram_usage": node.ram_usage,
        "temperature": node.temperature,
        "uptime": node.uptime,
        "online": node.online,
        "approved": node.approved,
        "last_seen": node.last_seen,
        "model": node.model,
        "notes": node.notes,
        "agent_version": node.agent_version,
        "update_available": node.update_available,
        "last_update_check": node.last_update_check,
        "last_update_status": node.last_update_status,
        "last_update_message": node.last_update_message,
        "last_update_at": node.last_update_at,
        "active_operation": active_operation.get("operation") if active_operation else None,
        "active_operation_message": active_operation.get("message") if active_operation else None,
        "active_operation_started_at": active_operation.get("started_at") if active_operation else None,
        "active_operation_expires_at": active_operation.get("expires_at") if active_operation else None,
        "usb_devices": usb_devices,
        "service_instances": service_instances,
        "status": node.status,
        "created_at": node.created_at,
        "updated_at": node.updated_at,
    }

async def get_node_or_404(node_id: int, db: AsyncSession):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node

@router.post("/", response_model=NodeSchema)
async def register_node(node_in: NodeCreate, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Node).where(
            or_(
                Node.hostname == node_in.hostname,
                (Node.ip_address == node_in.ip_address) & (Node.agent_port == node_in.agent_port)
            )
        )
    )
    existing_node = result.scalar_one_or_none()

    if existing_node:
        for field, value in node_in.model_dump(exclude_unset=True).items():
            setattr(existing_node, field, value)
        existing_node.last_seen = utcnow()
        existing_node.online = True
        node = existing_node
    else:
        node = Node(**node_in.model_dump())
        node.approved = True
        node.status = "approved"
        node.last_seen = utcnow()
        node.online = True
        db.add(node)

    event = Event(
        node_id=node.id,
        severity="info",
        event_type="node_registration",
        message=f"Node {node.hostname} registered/updated manually"
    )
    db.add(event)
    await db.commit()
    await db.refresh(node)
    schedule_auto_mount_node_storage(node, request, "manual_registration")
    return serialize_node(node)

@router.put("/{node_id}", response_model=NodeSchema)
async def update_node(node_id: int, node_in: NodeCreate, request: Request, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)

    was_approved = bool(node.approved)
    for field, value in node_in.model_dump(exclude_unset=True).items():
        setattr(node, field, value)

    node.updated_at = utcnow()
    await db.commit()
    await db.refresh(node)
    if node.approved and not was_approved:
        db.add(Event(
            node_id=node.id,
            severity="info",
            event_type="node_approved",
            message=f"Node approved: {node.hostname}",
            details={"source": "node_edit", "ip_address": node.ip_address, "agent_port": node.agent_port},
        ))
        await db.commit()
        schedule_auto_mount_node_storage(node, request, "node_approved_from_edit")
    return serialize_node(node)

@router.get("/", response_model=List[NodeSchema])
async def list_nodes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Node)
        .options(selectinload(Node.usb_devices), selectinload(Node.service_instances))
        .order_by(Node.hostname)
    )
    nodes = result.scalars().all()
    return [serialize_node(n) for n in nodes]

@router.get("/{node_id}", response_model=NodeSchema)
async def get_node(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Node)
        .options(selectinload(Node.usb_devices), selectinload(Node.service_instances))
        .where(Node.id == node_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return serialize_node(node)

@router.delete("/{node_id}")
async def delete_node(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)

    node_hostname = node.hostname
    NODE_OPERATION_STATES.pop(node_id, None)
    await db.execute(update(Printer).where(Printer.assigned_node_id == node_id).values(assigned_node_id=None))
    await db.execute(delete(Assignment).where(Assignment.node_id == node_id))
    await db.execute(delete(UsbDevice).where(UsbDevice.node_id == node_id))
    await db.execute(delete(ServiceInstance).where(ServiceInstance.node_id == node_id))
    await db.execute(update(Event).where(Event.node_id == node_id).values(node_id=None))
    await db.delete(node)

    event = Event(
        severity="warning",
        event_type="node_deleted",
        message=f"Node deleted: {node_hostname}",
        details={"node_id": node_id, "hostname": node_hostname, "assignments_cleared": True},
    )
    db.add(event)
    await db.commit()
    return {"status": "success", "message": f"Node {node_hostname} deleted"}

@router.post("/heartbeat", response_model=NodeSchema)
async def node_heartbeat(hb: NodeHeartbeat, request: Request, db: AsyncSession = Depends(get_db)):
    client_host = request.client.host
    if not is_local_ip(client_host) and not is_local_ip(hb.ip_address):
        raise HTTPException(status_code=403, detail="Non-local heartbeats rejected")

    # Sanitise inputs
    hb_node_uuid = clean_string(hb.node_uuid)
    if hb_node_uuid in ("unknown", "null", "undefined", ""):
        hb_node_uuid = None

    hb_hostname = clean_string(hb.hostname)
    hb_ip_address = clean_string(hb.ip_address)
    hb_model = clean_string(hb.pi_model or hb.model)
    hb_uptime = clean_string(hb.uptime)
    hb_version = clean_string(hb.version)

    # 1. Lookup by node_uuid first
    node = None
    if hb_node_uuid:
        result = await db.execute(select(Node).where(Node.node_uuid == hb_node_uuid))
        node = result.scalar_one_or_none()

    # 2. Fallback to hostname + ip_address + agent_port
    if not node:
        result = await db.execute(select(Node).where(
            Node.hostname == hb_hostname,
            Node.ip_address == hb_ip_address,
            Node.agent_port == hb.agent_port
        ))
        node = result.scalar_one_or_none()

    is_new = False
    if not node:
        is_new = True
        node = Node(
            node_uuid=hb_node_uuid,
            hostname=hb_hostname,
            ip_address=hb_ip_address,
            agent_port=hb.agent_port,
            approved=False,
            status="discovered"
        )
        db.add(node)
    elif hb_node_uuid and not node.node_uuid:
        # Update existing node with newly generated UUID
        node.node_uuid = hb_node_uuid

    # Update health fields
    node.hostname = hb_hostname
    node.ip_address = hb_ip_address
    node.agent_port = hb.agent_port
    node.model = hb_model or node.model
    node.cpu_usage = hb.cpu_usage if hb.cpu_usage is not None else node.cpu_usage
    node.ram_usage = hb.ram_usage if hb.ram_usage is not None else node.ram_usage
    node.temperature = hb.temperature if hb.temperature is not None else node.temperature
    node.uptime = hb_uptime or node.uptime
    node.agent_version = hb_version or node.agent_version
    node.online = True
    node.last_seen = utcnow()
    if node.approved:
        node.status = "online"
    else:
        node.status = "discovered"

    active_operation = get_node_operation(node.id)
    if active_operation and active_operation.get("operation") != "nfs_mounting" and not is_software_operation(active_operation):
        clear_node_operation(node.id)

    if is_new:
        await db.flush() # Ensure node.id is populated
        db.add(Event(node_id=node.id, severity="info", event_type="node_discovered", message=f"New node discovered: {node.hostname}"))

    await db.flush()
    await persist_node_inventory(db, node.id, hb.usb_devices, hb.service_instances)
    await db.commit()
    await db.refresh(node)
    schedule_auto_mount_node_storage(node, request, "heartbeat")
    return serialize_node(node)

@router.post("/{node_id}/approve", response_model=NodeSchema)
async def approve_node(node_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)
    node.approved = True
    node.status = "approved"
    node.updated_at = utcnow()
    db.add(Event(
        node_id=node.id,
        severity="info",
        event_type="node_approved",
        message=f"Node approved: {node.hostname}",
        details={"ip_address": node.ip_address, "agent_port": node.agent_port},
    ))
    await db.commit()
    await db.refresh(node)
    schedule_auto_mount_node_storage(node, request, "node_approved")
    return serialize_node(node)

@router.post("/{node_id}/refresh", response_model=NodeSchema)
async def refresh_node(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)

    url = f"http://{node.ip_address}:{node.agent_port}/health"
    logger.info(f"Refreshing node {node.id} ({node.hostname}) at {url}")

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=5)
        if res.status_code == 200:
            data = res.json()
            node.cpu_usage = data.get("cpu_usage", node.cpu_usage)
            node.ram_usage = data.get("ram_usage", node.ram_usage)
            node.temperature = data.get("temperature", node.temperature)
            node.uptime = data.get("uptime", node.uptime)
            node.model = data.get("pi_model", data.get("model", node.model))
            node.agent_version = data.get("version", node.agent_version)
            node.online = True
            node.last_seen = utcnow()
            node.status = "online" if node.approved else "discovered"

            await db.commit()
            await db.refresh(node)
            return serialize_node(node)
        else:
            logger.warning(f"Refresh failed for {node.hostname}: Status {res.status_code}")
            active_operation = get_node_operation(node.id)
            if active_operation:
                node.status = active_operation.get("operation", node.status)
            else:
                node.online = False
                node.status = "offline"
            await db.commit()
            await db.refresh(node)
            return serialize_node(node)
    except Exception as e:
        logger.error(f"Refresh error for {node.hostname} at {url}: {str(e)}")
        active_operation = get_node_operation(node.id)
        if active_operation:
            node.status = active_operation.get("operation", node.status)
        else:
            node.online = False
            node.status = "offline"
        await db.commit()
        await db.refresh(node)
        return serialize_node(node)

@router.get("/{node_id}/health")
async def get_node_live_health(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)

    url = f"http://{node.ip_address}:{node.agent_port}/health"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=4)
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Node agent returned {res.status_code}")

        data = res.json()
        node.cpu_usage = data.get("cpu_usage", node.cpu_usage)
        node.ram_usage = data.get("ram_usage", node.ram_usage)
        node.temperature = data.get("temperature", node.temperature)
        node.uptime = clean_string(data.get("uptime")) or node.uptime
        node.model = data.get("pi_model", data.get("model", node.model))
        node.agent_version = data.get("version", node.agent_version)
        node.online = True
        node.last_seen = utcnow()
        node.status = "online" if node.approved else "discovered"
        await db.commit()

        data["source"] = "live"
        data["checked_at"] = utcnow().isoformat()
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Live health check failed for node {node.hostname} at {url}: {e}")
        active_operation = get_node_operation(node.id)
        if active_operation:
            return {
                "source": "operation",
                "checked_at": utcnow().isoformat(),
                "active_operation": active_operation.get("operation"),
                "message": active_operation.get("message"),
                "cpu_usage": node.cpu_usage,
                "ram_usage": node.ram_usage,
                "temperature": node.temperature,
                "uptime": node.uptime,
            }
        raise HTTPException(status_code=502, detail="Node health temporarily unavailable")

@router.post("/{node_id}/detect-port", response_model=NodeSchema)
async def detect_node_port(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)

    common_ports = [8001, 8002, 8003, 7126, 7125]
    async with httpx.AsyncClient() as client:
        for port in common_ports:
            url = f"http://{node.ip_address}:{port}/health"
            try:
                res = await client.get(url, timeout=1)
                if res.status_code == 200:
                    node.agent_port = port
                    node.online = True
                    node.status = "online" if node.approved else "discovered"
                    await db.commit()
                    await db.refresh(node)
                    return serialize_node(node)
            except Exception as e:
                logger.debug(f"Port {port} not responsive on {node.ip_address}: {e}")
                continue

    raise HTTPException(status_code=404, detail=f"No agent found on {node.ip_address} using common ports.")

@router.post("/{node_id}/update")
async def update_node_agent(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)

    url = f"http://{node.ip_address}:{node.agent_port}/update"
    previous_version = node.agent_version
    try:
        set_node_operation(
            node.id,
            "node_updating",
            "Updating the node agent. It may briefly stop responding while dependencies or services restart.",
            ttl_seconds=180,
        )
        node.status = "updating"
        db.add(Event(
            node_id=node.id,
            severity="info",
            event_type="node_update_started",
            message=f"Update started for node {node.hostname}",
            details={"previous_version": previous_version, "url": url},
        ))
        await db.commit()

        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=60) # Increase timeout for pip install

        update_res = res.json()

        node.last_update_status = update_res.get("status", "failed")
        node.last_update_message = update_res.get("message", "No message provided")
        node.last_update_at = utcnow()

        if update_res.get("success"):
            node.status = "online" # or "restart_required" if we add that state
            db.add(Event(
                node_id=node.id,
                severity="info",
                event_type="node_update_succeeded",
                message=f"Update succeeded for node {node.hostname}: {node.last_update_message}",
                details={
                    "previous_version": previous_version,
                    "current_version": update_res.get("current_version") or update_res.get("version") or node.agent_version,
                    "status": node.last_update_status,
                    "timestamp": node.last_update_at.isoformat(),
                },
            ))
        else:
            node.status = "error"
            db.add(Event(
                node_id=node.id,
                severity="error",
                event_type="node_update_failed",
                message=f"Update failed for node {node.hostname}: {node.last_update_message}",
                details={
                    "previous_version": previous_version,
                    "status": node.last_update_status,
                    "timestamp": node.last_update_at.isoformat(),
                    "fix": "Check node-agent logs and retry the update.",
                },
            ))

        await db.commit()
        await db.refresh(node)
        clear_node_operation(node.id, "node_updating")
        return update_res
    except Exception as e:
        logger.error(f"Dashboard update route error: {e}")
        clear_node_operation(node.id, "node_updating")
        node.status = "error"
        node.last_update_status = "failed"
        node.last_update_message = str(e)
        node.last_update_at = utcnow()
        db.add(Event(
            node_id=node.id,
            severity="error",
            event_type="node_update_failed",
            message=f"Update failed for node {node.hostname}: {e}",
            details={
                "previous_version": previous_version,
                "status": node.last_update_status,
                "timestamp": node.last_update_at.isoformat(),
                "fix": "Check node-agent connectivity and retry the update.",
            },
        ))
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Update communication failed at {url}: {str(e)}")

@router.post("/{node_id}/restart-agent")
async def restart_node_agent(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)

    url = f"http://{node.ip_address}:{node.agent_port}/restart-agent"
    try:
        set_node_operation(
            node.id,
            "agent_restarting",
            "Agent restart requested. The node can look unreachable until the next heartbeat arrives.",
            ttl_seconds=120,
        )
        node.status = "restarting"
        await db.commit()
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=5)
        db.add(Event(node_id=node.id, severity="info", event_type="node_agent_restart", message=f"Restarted agent on {node.hostname}"))
        await db.commit()
        return res.json()
    except Exception as e:
        clear_node_operation(node.id, "agent_restarting")
        node.status = "error"
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Restart agent failed: {str(e)}")

@router.post("/{node_id}/reboot")
async def reboot_node_proxy(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)

    url = f"http://{node.ip_address}:{node.agent_port}/reboot"
    try:
        set_node_operation(
            node.id,
            "node_rebooting",
            "Node reboot requested. It will report online again after the Pi starts and sends a heartbeat.",
            ttl_seconds=300,
        )
        node.status = "rebooting"
        node.online = False
        await db.commit()
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=5)
        db.add(Event(node_id=node.id, severity="warning", event_type="node_reboot", message=f"Rebooted node {node.hostname}"))
        await db.commit()
        return res.json()
    except Exception as e:
        clear_node_operation(node.id, "node_rebooting")
        node.status = "error"
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Reboot node failed: {str(e)}")

@router.post("/{node_id}/restart-services")
async def restart_node_services(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)

    url = f"http://{node.ip_address}:{node.agent_port}/restart-printers"
    try:
        set_node_operation(
            node.id,
            "services_restarting",
            "Restarting printer services. Status and storage checks may pause for a moment.",
            ttl_seconds=120,
        )
        node.status = "restarting_services"
        await db.commit()
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=10)
        db.add(Event(node_id=node.id, severity="info", event_type="printer_services_restart", message=f"Restarted all printer services on {node.hostname}"))
        node.status = "online"
        clear_node_operation(node.id, "services_restarting")
        await db.commit()
        return res.json()
    except Exception as e:
        clear_node_operation(node.id, "services_restarting")
        node.status = "error"
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Restart services failed: {str(e)}")

@router.get("/{node_id}/usb")
async def get_node_usb(node_id: int, db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to fetch USB devices from a node-agent"""
    node = await get_node_or_404(node_id, db)

    url = f"http://{node.ip_address}:{node.agent_port}/usb"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=5)
        if res.status_code == 200:
            data = res.json()
            await persist_node_inventory(db, node.id, data, None)
            await db.commit()
            return data
        else:
            raise HTTPException(status_code=502, detail=f"Node agent returned {res.status_code}")
    except Exception as e:
        logger.error(f"Failed to fetch USB from node {node.hostname}: {e}")
        raise HTTPException(status_code=502, detail=f"Could not reach node agent at {url}")

@router.get("/{node_id}/instances")
async def get_node_instances(node_id: int, db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to fetch Klipper/Moonraker service instances from a node-agent."""
    node = await get_node_or_404(node_id, db)
    url = f"http://{node.ip_address}:{node.agent_port}/instances"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=5)
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Node agent returned {res.status_code}")
        data = res.json()
        if isinstance(data, dict) and data.get("error"):
            raise HTTPException(status_code=502, detail=data["error"])
        await persist_node_inventory(db, node.id, None, data)
        await db.commit()
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch instances from node {node.hostname}: {e}")
        raise HTTPException(status_code=502, detail=f"Could not reach node agent at {url}")

@router.get("/{node_id}/logs/{service_name}")
async def get_node_service_logs(node_id: int, service_name: str, lines: int = 200, db: AsyncSession = Depends(get_db)):
    """Fetch recent journal logs for a safe Klipper or Moonraker service."""
    node = await get_node_or_404(node_id, db)
    service = _safe_service_name(service_name)
    url = f"http://{node.ip_address}:{node.agent_port}/logs/{service}"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, params={"lines": max(20, min(lines, 1000))}, timeout=10)
        if res.status_code == 404:
            raise HTTPException(status_code=404, detail="Node-agent does not support logs yet. Update node-agent.")
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Node agent returned {res.status_code}")
        return res.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch logs from node {node.hostname}: {e}")
        raise HTTPException(status_code=502, detail=f"Could not reach node agent at {url}")

@router.post("/{node_id}/storage/mount")
async def proxy_storage_mount(node_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to initiate NFS mount on a node"""
    node = await get_node_or_404(node_id, db)

    server_ip = get_nfs_server_host(request)
    if not server_ip:
        raise HTTPException(
            status_code=400,
            detail="Could not auto-detect the dashboard LAN host. Open the dashboard using its LAN IP/hostname, or set NFS_SERVER_HOST in .env.",
        )

    payload = _storage_mount_payload(server_ip)

    url = f"http://{node.ip_address}:{node.agent_port}/storage/mount"
    try:
        set_node_operation(
            node.id,
            "nfs_mounting",
            "Connecting NFS storage. Installing helpers or mounting shares can make the agent briefly stop responding.",
            ttl_seconds=420,
        )
        async with httpx.AsyncClient() as client:
            res = await client.post(url, json=payload, timeout=360)

        if res.status_code == 200:
            return res.json()
        elif res.status_code == 404:
            raise HTTPException(status_code=404, detail="Node-agent does not support storage mount. Update node-agent.")
        else:
            data = res.json() if res.headers.get("content-type") == "application/json" else {"message": res.text}
            raise HTTPException(status_code=400, detail=data.get("message", "Mount failed on node-agent"))

    except httpx.RequestError as e:
        logger.error(f"Network error reaching node {node.hostname}: {e}")
        raise HTTPException(status_code=502, detail=f"Could not reach node agent at {url}")
    finally:
        clear_node_operation(node.id, "nfs_mounting")

@router.post("/{node_id}/storage/update-and-mount")
async def update_agent_and_retry_storage(node_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    """Operator-approved recovery: update node-agent, retry update once on failure, then retry NFS mount."""
    node = await get_node_or_404(node_id, db)
    server_ip = get_nfs_server_host(request)
    if not server_ip:
        raise HTTPException(
            status_code=400,
            detail="Could not auto-detect the dashboard LAN host. Open the dashboard using its LAN IP/hostname, or set NFS_SERVER_HOST in .env.",
        )

    attempts = []
    update_result = None
    set_node_operation(
        node.id,
        "node_updating",
        "Updating node-agent before retrying NFS storage. If the first update fails, the dashboard will retry once.",
        ttl_seconds=540,
    )
    db.add(Event(
        node_id=node.id,
        severity="info",
        event_type="node_storage_recovery_started",
        message=f"Update and NFS retry started for node {node.hostname}",
        details={"server": server_ip, "max_update_attempts": 2},
    ))
    await db.commit()

    try:
        for attempt_number in (1, 2):
            try:
                update_result = await _post_node_update(node)
            except Exception as e:
                update_result = {
                    "success": False,
                    "status": "failed",
                    "message": f"Update request failed: {e}",
                    "error": str(e),
                }
            update_result["attempt"] = attempt_number
            attempts.append(update_result)

            node.last_update_status = update_result.get("status", "failed")
            node.last_update_message = update_result.get("message", "No message provided")
            node.last_update_at = utcnow()
            if update_result.get("success"):
                break

            db.add(Event(
                node_id=node.id,
                severity="warning",
                event_type="node_update_retry",
                message=f"Node-agent update attempt {attempt_number} failed for {node.hostname}: {node.last_update_message}",
                details={
                    "attempt": attempt_number,
                    "will_retry": attempt_number == 1,
                    "status": node.last_update_status,
                    "message": node.last_update_message,
                },
            ))
            await db.commit()
            if attempt_number == 1:
                await asyncio.sleep(3)

        if not update_result or not update_result.get("success"):
            node.status = "error"
            db.add(Event(
                node_id=node.id,
                severity="error",
                event_type="node_storage_recovery_failed",
                message=f"Update and NFS retry failed for {node.hostname}: update failed twice",
                details={
                    "what_failed": "Node-agent update before NFS retry",
                    "likely_cause": "The node repo has local edits, Git cannot fast-forward, or the node cannot reach GitHub/Python package indexes",
                    "suggested_fix": "Check node-agent logs or SSH into the node, resolve local repo changes, then run Update & Retry NFS again.",
                    "attempts": attempts,
                },
            ))
            await db.commit()
            return {
                "success": False,
                "status": "update_failed",
                "message": "Node-agent update failed twice. NFS mount was not retried.",
                "update_attempts": attempts,
            }

        node.status = "online"
        db.add(Event(
            node_id=node.id,
            severity="info",
            event_type="node_update_succeeded",
            message=f"Update succeeded before NFS retry for node {node.hostname}: {node.last_update_message}",
            details={
                "status": node.last_update_status,
                "attempt": update_result.get("attempt"),
                "restart_required": bool(update_result.get("restart_required")),
                "timestamp": node.last_update_at.isoformat(),
            },
        ))
        await db.commit()

        restart_result = None
        health_after_restart = None
        if update_result.get("restart_required"):
            try:
                async with httpx.AsyncClient() as client:
                    restart_res = await client.post(_agent_url(node, "/restart-agent"), timeout=5)
                restart_result = restart_res.json() if restart_res.status_code == 200 else {"success": False, "message": restart_res.text}
            except Exception as e:
                restart_result = {"success": False, "message": str(e)}
            health_after_restart = await _wait_for_node_health(node, timeout_seconds=45)

        set_node_operation(
            node.id,
            "nfs_mounting",
            "Retrying NFS storage after node-agent update.",
            ttl_seconds=420,
        )
        mount_result = await _post_node_storage_mount(node, server_ip)
        mount_success = mount_result.get("success") is not False
        db.add(Event(
            node_id=node.id,
            severity="info" if mount_success else "warning",
            event_type="node_storage_recovery_succeeded" if mount_success else "node_storage_recovery_failed",
            message=(
                f"Update and NFS retry completed for {node.hostname}"
                if mount_success
                else f"Update succeeded but NFS retry failed for {node.hostname}: {mount_result.get('message', 'Mount failed')}"
            ),
            details={
                "update_attempts": attempts,
                "restart": restart_result,
                "health_after_restart": health_after_restart,
                "mount": mount_result,
                "server": server_ip,
            },
        ))
        await db.commit()
        return {
            "success": mount_success,
            "status": "mounted" if mount_success else "mount_failed",
            "message": mount_result.get("message") or ("NFS retry completed" if mount_success else "NFS retry failed"),
            "update_attempts": attempts,
            "restart": restart_result,
            "health_after_restart": health_after_restart,
            "mount": mount_result,
        }
    finally:
        clear_node_operation(node.id)

@router.post("/{node_id}/instances/create")
async def proxy_create_instance(node_id: int, request: Request, data: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to create a printer instance on a node-agent"""
    node = await get_node_or_404(node_id, db)

    data = ensure_moonraker_config_payload(dict(data), node, request)
    url = f"http://{node.ip_address}:{node.agent_port}/instances/create"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(url, json=data, timeout=30)
        if res.status_code == 200:
            return res.json()
        else:
            raise HTTPException(status_code=res.status_code, detail=res.text)
    except Exception as e:
        logger.error(f"Failed to create instance on node {node.hostname}: {e}")
        raise HTTPException(status_code=502, detail=f"Could not reach node agent at {url}")

async def get_node_for_proxy(node_id: int, db: AsyncSession):
    return await get_node_or_404(node_id, db)

async def proxy_node_get(node: Node, path: str, timeout: int = 5):
    url = f"http://{node.ip_address}:{node.agent_port}{path}"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=timeout)
        if res.status_code == 404:
            raise HTTPException(status_code=404, detail="Node-agent does not support this endpoint. Update node-agent.")
        return res.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reach node {node.hostname} at {url}: {e}")
        raise HTTPException(status_code=502, detail="Node unreachable")

async def proxy_node_post(node: Node, path: str, timeout: int = 900):
    url = f"http://{node.ip_address}:{node.agent_port}{path}"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=timeout)
        if res.status_code == 404:
            raise HTTPException(status_code=404, detail="Node-agent does not support this endpoint. Update node-agent.")
        return res.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reach node {node.hostname} at {url}: {e}")
        raise HTTPException(status_code=502, detail="Node unreachable or timeout")

def _merge_install_job_payload(node: Node, payload: dict):
    payload = dict(payload or {})
    active_operation = get_node_operation(node.id)
    job = payload.get("job") or payload.get("install_job") or (software_job_from_operation(node.id, active_operation) if active_operation else None)
    if job:
        payload["job"] = job
        payload["install_job"] = job
        status_payload = payload.get("status") if isinstance(payload.get("status"), dict) else payload
        if isinstance(status_payload, dict):
            status_payload["install_job"] = job

        if job.get("status") in {"completed", "failed", "cancelled"} and active_operation:
            clear_node_operation(node.id, active_operation.get("operation"))
    return payload

async def start_node_software_install(node: Node, kind: str, paths: List[str]):
    operation, message = SOFTWARE_INSTALL_OPERATIONS[kind]
    set_node_operation(node.id, operation, message, ttl_seconds=7200)
    timeout = httpx.Timeout(12.0, connect=4.0)

    for index, path in enumerate(paths):
        url = f"http://{node.ip_address}:{node.agent_port}{path}"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(url)
        except httpx.ReadTimeout:
            logger.info("Software install request to %s timed out after being sent; treating as running", url)
            return software_install_fallback_payload(
                node,
                warning="The node accepted the install request but did not return a live status before the timeout.",
            )
        except httpx.ConnectError as e:
            clear_node_operation(node.id, operation)
            logger.error("Could not connect to node %s at %s: %s", node.hostname, url, e)
            raise HTTPException(status_code=502, detail="Node unreachable")
        except httpx.RequestError as e:
            clear_node_operation(node.id, operation)
            logger.error("Software install request failed for node %s at %s: %s", node.hostname, url, e)
            raise HTTPException(status_code=502, detail="Node unreachable")

        if res.status_code == 404 and index < len(paths) - 1:
            continue
        if res.status_code == 404:
            clear_node_operation(node.id, operation)
            raise HTTPException(status_code=404, detail="Node-agent does not support this endpoint. Update node-agent.")

        try:
            payload = res.json()
        except ValueError:
            payload = {"message": res.text}

        if res.status_code >= 400:
            clear_node_operation(node.id, operation)
            raise HTTPException(status_code=res.status_code, detail=payload.get("message") or payload.get("detail") or "Install failed on node-agent")

        payload = _merge_install_job_payload(node, payload)
        job_status = (payload.get("job") or {}).get("status")
        if payload.get("success") is False or job_status in {"completed", "failed", "cancelled"}:
            clear_node_operation(node.id, operation)
        payload["active_operation"] = operation
        return payload

    clear_node_operation(node.id, operation)
    raise HTTPException(status_code=404, detail="Node-agent does not support this endpoint. Update node-agent.")

@router.get("/{node_id}/software/status")
async def proxy_software_status(node_id: int, db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to check Klipper, Moonraker, Mainsail, and nginx status on a node"""
    node = await get_node_for_proxy(node_id, db)
    try:
        return _merge_install_job_payload(node, await proxy_node_get(node, "/software/status", timeout=5))
    except HTTPException as e:
        if e.status_code == 404:
            return _merge_install_job_payload(node, await proxy_node_get(node, "/software/check", timeout=5))
        fallback = software_install_fallback_payload(node)
        if fallback:
            return fallback
        raise

@router.get("/{node_id}/software/check")
async def proxy_software_check(node_id: int, db: AsyncSession = Depends(get_db)):
    """Compatibility alias for the newer software status endpoint"""
    return await proxy_software_status(node_id, db)

@router.get("/{node_id}/software/install/status")
async def proxy_software_install_status(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_for_proxy(node_id, db)
    try:
        return _merge_install_job_payload(node, await proxy_node_get(node, "/software/install/status", timeout=5))
    except HTTPException as e:
        if e.status_code == 404:
            return await proxy_software_status(node_id, db)
        fallback = software_install_fallback_payload(node)
        if fallback:
            return fallback
        raise

@router.get("/{node_id}/storage/check")
async def proxy_storage_check(node_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to check NFS status on a node"""
    node = await get_node_or_404(node_id, db)

    url = f"http://{node.ip_address}:{node.agent_port}/storage/check"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=5)

        if res.status_code == 200:
            data = res.json()
            if node.approved and not data.get("nfs_available"):
                schedule_auto_mount_node_storage(node, request, "storage_check")
            return data
        elif res.status_code == 404:
            return {
                "nfs_available": False,
                "mounted": False,
                "error": "Node-agent does not support storage check. Update node-agent."
            }
        else:
            return {"nfs_available": False, "mounted": False, "error": f"Agent returned {res.status_code}"}
    except Exception as e:
        logger.error(f"Failed to check storage for node {node.hostname}: {e}")
        return {"nfs_available": False, "mounted": False, "error": "Node unreachable"}

@router.post("/{node_id}/software/install/runtime")
async def proxy_install_runtime(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_for_proxy(node_id, db)
    return await start_node_software_install(node, "runtime", ["/software/install/runtime"])

@router.post("/{node_id}/software/install/klipper")
async def proxy_install_klipper(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_for_proxy(node_id, db)
    return await start_node_software_install(node, "klipper", ["/software/install/klipper", "/software/install-klipper"])

@router.post("/{node_id}/software/install/moonraker")
async def proxy_install_moonraker(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_for_proxy(node_id, db)
    return await start_node_software_install(node, "moonraker", ["/software/install/moonraker", "/software/install-moonraker"])

@router.post("/{node_id}/software/install/mainsail")
async def proxy_install_mainsail(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_for_proxy(node_id, db)
    return await start_node_software_install(node, "mainsail", ["/software/install/mainsail"])

@router.post("/{node_id}/software/install-klipper")
async def proxy_install_klipper_legacy(node_id: int, db: AsyncSession = Depends(get_db)):
    return await proxy_install_klipper(node_id, db)

@router.post("/{node_id}/software/install-moonraker")
async def proxy_install_moonraker_legacy(node_id: int, db: AsyncSession = Depends(get_db)):
    return await proxy_install_moonraker(node_id, db)
