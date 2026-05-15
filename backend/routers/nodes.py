from fastapi import APIRouter, Depends, HTTPException, Request
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

# Setup logger
logger = logging.getLogger("klipper-farm")

router = APIRouter(prefix="/nodes", tags=["nodes"])

def is_local_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback
    except ValueError:
        return False

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

    # Prevent duplicate discovery for same hostname or same UUID
    result = await db.execute(select(Node).where(or_(Node.node_uuid == hb.node_uuid, Node.hostname == hb.hostname)))
    node = result.scalar_one_or_none()

    is_new = False
    if not node:
        is_new = True
        node = Node(node_uuid=hb.node_uuid, approved=False, status="discovered")
        db.add(node)
    elif node.node_uuid != hb.node_uuid and node.hostname == hb.hostname:
        # Hostname matched but UUID changed (re-install), update UUID
        node.node_uuid = hb.node_uuid

    # Prefer wired IP (e.g. 10.1.* or 192.168.*)
    current_is_wired = node.ip_address and node.ip_address.startswith(("10.1.", "192.168."))
    new_is_wired = hb.ip_address.startswith(("10.1.", "192.168."))

    if (not current_is_wired and new_is_wired) or not node.ip_address:
        node.ip_address = hb.ip_address

    node.hostname = hb.hostname
    node.agent_port = hb.agent_port
    node.model = hb.model
    node.cpu_usage = hb.cpu_usage
    node.ram_usage = hb.ram_usage
    node.temperature = hb.temperature
    node.uptime = hb.uptime
    node.agent_version = hb.agent_version
    node.online = True
    node.last_seen = datetime.datetime.now(datetime.timezone.utc)
    if node.approved: node.status = "online"

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
    if not node: raise HTTPException(status_code=404, detail="Node not found")

    url = f"http://{node.ip_address}:{node.agent_port}/health"
    logger.info(f"Refreshing node {node.id} ({node.hostname}) at {url}")

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=5)
        if res.status_code == 200:
            data = res.json()
            node.cpu_usage = data.get("cpu_usage", 0.0)
            node.ram_usage = data.get("ram_usage", 0.0)
            node.temperature = data.get("temperature", 0.0)
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
            raise Exception(f"Received status code {res.status_code}")
    except Exception as e:
        node.online = False
        node.status = "offline"
        await db.commit()
        await db.refresh(node)
        raise HTTPException(status_code=400, detail=f"Failed to reach node at {url}: {str(e)}")

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
        except: continue

    raise HTTPException(status_code=404, detail=f"No agent found on {node.ip_address} using common ports.")

@router.post("/{node_id}/update")
async def update_node_agent(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node: raise HTTPException(status_code=404, detail="Node not found")
    url = f"http://{node.ip_address}:{node.agent_port}/update"
    try:
        node.status = "updating"
        await db.commit()
        async with httpx.AsyncClient() as client:
            res = await client.post(url, timeout=10)
        res.raise_for_status()
        return res.json()
    except Exception as e:
        node.status = "error"
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Update failed at {url}: {str(e)}")
