from fastapi import APIRouter, Depends, HTTPException, Request, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, delete, update
from typing import List
from ..database import get_db
from ..models import Node, Event, Printer
from ..schemas import NodeCreate, NodeHeartbeat, Node as NodeSchema
import datetime
import ipaddress
import httpx
import logging
import os

# Setup logger
logger = logging.getLogger("klipper-farm")

router = APIRouter(prefix="/nodes", tags=["nodes"])

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

def serialize_node(node):
    """Utility to serialize SQLAlchemy Node model to dict to avoid MissingGreenlet errors"""
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
        "status": node.status,
        "created_at": node.created_at,
        "updated_at": node.updated_at,
    }

@router.post("/", response_model=NodeSchema)
async def register_node(node_in: NodeCreate, db: AsyncSession = Depends(get_db)):
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
        existing_node.last_seen = datetime.datetime.now(datetime.timezone.utc)
        existing_node.online = True
        node = existing_node
    else:
        node = Node(**node_in.model_dump())
        node.approved = True
        node.status = "approved"
        node.last_seen = datetime.datetime.now(datetime.timezone.utc)
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
    return serialize_node(node)

@router.put("/{node_id}", response_model=NodeSchema)
async def update_node(node_id: int, node_in: NodeCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    for field, value in node_in.model_dump(exclude_unset=True).items():
        setattr(node, field, value)

    node.updated_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()
    await db.refresh(node)
    return serialize_node(node)

@router.get("/", response_model=List[NodeSchema])
async def list_nodes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).order_by(Node.hostname))
    nodes = result.scalars().all()
    return [serialize_node(n) for n in nodes]

@router.get("/{node_id}", response_model=NodeSchema)
async def get_node(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return serialize_node(node)

@router.delete("/{node_id}")
async def delete_node(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

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
    node.last_seen = datetime.datetime.now(datetime.timezone.utc)
    if node.approved:
        node.status = "online"
    else:
        node.status = "discovered"

    if is_new:
        await db.flush() # Ensure node.id is populated
        db.add(Event(node_id=node.id, severity="info", event_type="node_discovered", message=f"New node discovered: {node.hostname}"))

    await db.commit()
    await db.refresh(node)
    return serialize_node(node)

@router.post("/{node_id}/approve", response_model=NodeSchema)
async def approve_node(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node: raise HTTPException(status_code=404, detail="Node not found")
    node.approved = True
    node.status = "approved"
    node.updated_at = datetime.datetime.now(datetime.timezone.utc)
    db.add(Event(node_id=node.id, severity="info", event_type="node_approved", message=f"Node {node.hostname} approved"))
    await db.commit()
    await db.refresh(node)
    return serialize_node(node)

@router.post("/{node_id}/refresh", response_model=NodeSchema)
async def refresh_node(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

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
            node.last_seen = datetime.datetime.now(datetime.timezone.utc)
            node.status = "online" if node.approved else "discovered"

            await db.commit()
            await db.refresh(node)
            return serialize_node(node)
        else:
            logger.warning(f"Refresh failed for {node.hostname}: Status {res.status_code}")
            node.online = False
            node.status = "offline"
            await db.commit()
            await db.refresh(node)
            return serialize_node(node)
    except Exception as e:
        logger.error(f"Refresh error for {node.hostname} at {url}: {str(e)}")
        node.online = False
        node.status = "offline"
        await db.commit()
        await db.refresh(node)
        return serialize_node(node)

@router.post("/{node_id}/detect-port", response_model=NodeSchema)
async def detect_node_port(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node: raise HTTPException(status_code=404, detail="Node not found")

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
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    url = f"http://{node.ip_address}:{node.agent_port}/update"
    try:
        node.status = "updating"
        await db.commit()

        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=60) # Increase timeout for pip install

        update_res = res.json()

        node.last_update_status = update_res.get("status", "failed")
        node.last_update_message = update_res.get("message", "No message provided")
        node.last_update_at = datetime.datetime.now(datetime.timezone.utc)

        if update_res.get("success"):
            node.status = "online" # or "restart_required" if we add that state
            db.add(Event(node_id=node.id, severity="info", event_type="node_update", message=f"Update successful: {node.last_update_message}"))
        else:
            node.status = "error"
            db.add(Event(node_id=node.id, severity="error", event_type="node_update", message=f"Update failed: {node.last_update_message}"))

        await db.commit()
        await db.refresh(node)
        return update_res
    except Exception as e:
        logger.error(f"Dashboard update route error: {e}")
        node.status = "error"
        node.last_update_status = "failed"
        node.last_update_message = str(e)
        node.last_update_at = datetime.datetime.now(datetime.timezone.utc)
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Update communication failed at {url}: {str(e)}")

@router.post("/{node_id}/restart-agent")
async def restart_node_agent(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node: raise HTTPException(status_code=404, detail="Node not found")

    url = f"http://{node.ip_address}:{node.agent_port}/restart-agent"
    try:
        node.status = "restarting"
        await db.commit()
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=5)
        db.add(Event(node_id=node.id, severity="info", event_type="node_agent_restart", message=f"Restarted agent on {node.hostname}"))
        await db.commit()
        return res.json()
    except Exception as e:
        node.status = "error"
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Restart agent failed: {str(e)}")

@router.post("/{node_id}/reboot")
async def reboot_node_proxy(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node: raise HTTPException(status_code=404, detail="Node not found")

    url = f"http://{node.ip_address}:{node.agent_port}/reboot"
    try:
        node.status = "rebooting"
        node.online = False
        await db.commit()
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=5)
        db.add(Event(node_id=node.id, severity="warning", event_type="node_reboot", message=f"Rebooted node {node.hostname}"))
        await db.commit()
        return res.json()
    except Exception as e:
        node.status = "error"
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Reboot node failed: {str(e)}")

@router.post("/{node_id}/restart-services")
async def restart_node_services(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node: raise HTTPException(status_code=404, detail="Node not found")

    url = f"http://{node.ip_address}:{node.agent_port}/restart-printers"
    try:
        node.status = "restarting_services"
        await db.commit()
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=10)
        db.add(Event(node_id=node.id, severity="info", event_type="printer_services_restart", message=f"Restarted all printer services on {node.hostname}"))
        node.status = "online"
        await db.commit()
        return res.json()
    except Exception as e:
        node.status = "error"
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Restart services failed: {str(e)}")

@router.get("/{node_id}/usb")
async def get_node_usb(node_id: int, db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to fetch USB devices from a node-agent"""
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

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
async def proxy_storage_mount(node_id: int, db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to initiate NFS mount on a node"""
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Get server IP (prioritise explicit host from ENV, then auto-detect)
    server_ip = os.getenv("NFS_SERVER_HOST")
    if not server_ip:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # We try to find a LAN IP by connecting to a public address (not used)
            s.connect(('8.8.8.8', 80))
            server_ip = s.getsockname()[0]
            # Ensure it is not a Docker internal IP (usually 172.x or 127.x)
            if server_ip.startswith(("172.", "127.")):
                 # Fallback to hostname -I if possible or leave for manual config
                 server_ip = "MANUAL_IP_REQUIRED"
        except:
            server_ip = "SERVER_IP"
        finally:
            s.close()

    if server_ip == "MANUAL_IP_REQUIRED":
         raise HTTPException(status_code=400, detail="Could not auto-detect LAN IP. Please set NFS_SERVER_HOST in .env")

    payload = {
        "server": server_ip,
        "export": os.getenv("NFS_EXPORT_PATH", "/exports"),
        "mount_point": os.getenv("NFS_CLIENT_MOUNT", "/mnt/klipper-farm"),
        "persistent": True
    }

    url = f"http://{node.ip_address}:{node.agent_port}/storage/mount"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(url, json=payload, timeout=60) # High timeout for apt-get

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

@router.post("/{node_id}/instances/create")
async def proxy_create_instance(node_id: int, data: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to create a printer instance on a node-agent"""
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

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

@router.get("/{node_id}/software/check")
async def proxy_software_check(node_id: int, db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to check Klipper/Moonraker software on a node"""
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node: raise HTTPException(status_code=404, detail="Node not found")
    url = f"http://{node.ip_address}:{node.agent_port}/software/check"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=5)
        return res.json()
    except:
        raise HTTPException(status_code=502, detail="Node unreachable")

@router.get("/{node_id}/storage/check")
async def proxy_storage_check(node_id: int, db: AsyncSession = Depends(get_db)):
    """Proxied endpoint to check NFS status on a node"""
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    url = f"http://{node.ip_address}:{node.agent_port}/storage/check"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=5)

        if res.status_code == 200:
            return res.json()
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

@router.post("/{node_id}/software/install-klipper")
async def proxy_install_klipper(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node: raise HTTPException(status_code=404, detail="Node not found")
    url = f"http://{node.ip_address}:{node.agent_port}/software/install-klipper"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=300)
        return res.json()
    except:
        raise HTTPException(status_code=502, detail="Node unreachable or timeout")

@router.post("/{node_id}/software/install-moonraker")
async def proxy_install_moonraker(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node: raise HTTPException(status_code=404, detail="Node not found")
    url = f"http://{node.ip_address}:{node.agent_port}/software/install-moonraker"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=300)
        return res.json()
    except:
        raise HTTPException(status_code=502, detail="Node unreachable or timeout")
