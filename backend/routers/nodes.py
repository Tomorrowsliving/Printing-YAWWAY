from fastapi import APIRouter, Depends, HTTPException, Request, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, delete, update
from typing import List, Optional
from ..database import AsyncSessionLocal, get_db
from ..models import Node, Event, Printer
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

def _storage_mount_payload(server_ip: str):
    return {
        "server": server_ip,
        "export": os.getenv("NFS_EXPORT_PATH", "/exports"),
        "mount_point": os.getenv("NFS_CLIENT_MOUNT", "/mnt/klipper-farm"),
        "persistent": True,
    }

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
            else:
                event_message = mount_data.get("message") or event_message
    except Exception as e:
        event_severity = "warning"
        event_message = f"NFS storage auto-connect failed for {hostname}: {e}"
        details["error"] = str(e)
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
        schedule_auto_mount_node_storage(node, request, "node_approved_from_edit")
    return serialize_node(node)

@router.get("/", response_model=List[NodeSchema])
async def list_nodes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).order_by(Node.hostname))
    nodes = result.scalars().all()
    return [serialize_node(n) for n in nodes]

@router.get("/{node_id}", response_model=NodeSchema)
async def get_node(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)
    return serialize_node(node)

@router.delete("/{node_id}")
async def delete_node(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_or_404(node_id, db)

    node_hostname = node.hostname
    await db.execute(update(Printer).where(Printer.assigned_node_id == node_id).values(assigned_node_id=None))
    await db.delete(node)

    event = Event(severity="warning", event_type="node_deleted", message=f"Node {node_hostname} was removed")
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
    if active_operation and active_operation.get("operation") != "nfs_mounting":
        clear_node_operation(node.id)

    if is_new:
        await db.flush() # Ensure node.id is populated
        db.add(Event(node_id=node.id, severity="info", event_type="node_discovered", message=f"New node discovered: {node.hostname}"))

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
    db.add(Event(node_id=node.id, severity="info", event_type="node_approved", message=f"Node {node.hostname} approved"))
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
    try:
        set_node_operation(
            node.id,
            "node_updating",
            "Updating the node agent. It may briefly stop responding while dependencies or services restart.",
            ttl_seconds=180,
        )
        node.status = "updating"
        await db.commit()

        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=60) # Increase timeout for pip install

        update_res = res.json()

        node.last_update_status = update_res.get("status", "failed")
        node.last_update_message = update_res.get("message", "No message provided")
        node.last_update_at = utcnow()

        if update_res.get("success"):
            node.status = "online" # or "restart_required" if we add that state
            db.add(Event(node_id=node.id, severity="info", event_type="node_update", message=f"Update successful: {node.last_update_message}"))
        else:
            node.status = "error"
            db.add(Event(node_id=node.id, severity="error", event_type="node_update", message=f"Update failed: {node.last_update_message}"))

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
            return res.json()
        else:
            raise HTTPException(status_code=502, detail=f"Node agent returned {res.status_code}")
    except Exception as e:
        logger.error(f"Failed to fetch USB from node {node.hostname}: {e}")
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

@router.get("/{node_id}/software/status")
async def proxy_software_status(node_id: int, db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to check Klipper, Moonraker, Mainsail, and nginx status on a node"""
    node = await get_node_for_proxy(node_id, db)
    try:
        return await proxy_node_get(node, "/software/status", timeout=5)
    except HTTPException as e:
        if e.status_code == 404:
            return await proxy_node_get(node, "/software/check", timeout=5)
        raise

@router.get("/{node_id}/software/check")
async def proxy_software_check(node_id: int, db: AsyncSession = Depends(get_db)):
    """Compatibility alias for the newer software status endpoint"""
    return await proxy_software_status(node_id, db)

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
    return await proxy_node_post(node, "/software/install/runtime", timeout=1800)

@router.post("/{node_id}/software/install/klipper")
async def proxy_install_klipper(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_for_proxy(node_id, db)
    try:
        return await proxy_node_post(node, "/software/install/klipper", timeout=900)
    except HTTPException as e:
        if e.status_code == 404:
            return await proxy_node_post(node, "/software/install-klipper", timeout=900)
        raise

@router.post("/{node_id}/software/install/moonraker")
async def proxy_install_moonraker(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_for_proxy(node_id, db)
    try:
        return await proxy_node_post(node, "/software/install/moonraker", timeout=900)
    except HTTPException as e:
        if e.status_code == 404:
            return await proxy_node_post(node, "/software/install-moonraker", timeout=900)
        raise

@router.post("/{node_id}/software/install/mainsail")
async def proxy_install_mainsail(node_id: int, db: AsyncSession = Depends(get_db)):
    node = await get_node_for_proxy(node_id, db)
    return await proxy_node_post(node, "/software/install/mainsail", timeout=900)

@router.post("/{node_id}/software/install-klipper")
async def proxy_install_klipper_legacy(node_id: int, db: AsyncSession = Depends(get_db)):
    return await proxy_install_klipper(node_id, db)

@router.post("/{node_id}/software/install-moonraker")
async def proxy_install_moonraker_legacy(node_id: int, db: AsyncSession = Depends(get_db)):
    return await proxy_install_moonraker(node_id, db)
