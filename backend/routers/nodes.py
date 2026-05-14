from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, delete
from typing import List
from ..database import get_db
from ..models import Node, Event
from ..schemas import NodeCreate, NodeHeartbeat, Node as NodeSchema
import datetime
import ipaddress
import requests

router = APIRouter(prefix="/nodes", tags=["nodes"])

def is_local_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback
    except ValueError:
        return False

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
    await db.flush()
    return node

@router.get("/", response_model=List[NodeSchema])
async def list_nodes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).order_by(Node.hostname))
    return result.scalars().all()

@router.get("/{node_id}", response_model=NodeSchema)
async def get_node(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node

@router.delete("/{node_id}")
async def delete_node(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    node_hostname = node.hostname
    await db.delete(node)

    event = Event(
        severity="warning",
        event_type="node_deleted",
        message=f"Node {node_hostname} was removed"
    )
    db.add(event)
    await db.flush()
    return {"status": "success", "message": f"Node {node_hostname} deleted"}

@router.post("/heartbeat", response_model=NodeSchema)
async def node_heartbeat(hb: NodeHeartbeat, request: Request, db: AsyncSession = Depends(get_db)):
    client_host = request.client.host
    if not is_local_ip(client_host) and not is_local_ip(hb.ip_address):
        raise HTTPException(status_code=403, detail="Non-local heartbeats rejected")

    result = await db.execute(select(Node).where(Node.node_uuid == hb.node_uuid))
    node = result.scalar_one_or_none()

    is_new = False
    if not node:
        is_new = True
        node = Node(node_uuid=hb.node_uuid, approved=False, status="discovered")
        db.add(node)

    node.hostname = hb.hostname
    node.ip_address = hb.ip_address
    node.agent_port = hb.agent_port
    node.model = hb.model
    node.cpu_usage = hb.cpu_usage
    node.ram_usage = hb.ram_usage
    node.temperature = hb.temperature
    node.uptime = hb.uptime
    node.agent_version = hb.agent_version
    node.online = True
    node.last_seen = datetime.datetime.now(datetime.timezone.utc)

    if node.approved:
        node.status = "online"

    await db.flush()

    if is_new:
        event = Event(
            node_id=node.id,
            severity="info",
            event_type="node_discovered",
            message=f"New node discovered: {node.hostname}"
        )
        db.add(event)

    return node

@router.post("/{node_id}/approve", response_model=NodeSchema)
async def approve_node(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    node.approved = True
    node.status = "approved"
    node.updated_at = datetime.datetime.now(datetime.timezone.utc)

    event = Event(
        node_id=node.id,
        severity="info",
        event_type="node_approved",
        message=f"Node {node.hostname} approved"
    )
    db.add(event)
    await db.flush()
    return node

@router.post("/{node_id}/refresh", response_model=NodeSchema)
async def refresh_node(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    url = f"http://{node.ip_address}:{node.agent_port}/health"
    try:
        res = requests.get(url, timeout=5)
        res.raise_for_status()
        data = res.json()

        node.hostname = data.get("hostname", node.hostname)
        node.cpu_usage = data.get("cpu_usage", 0.0)
        node.ram_usage = data.get("ram_usage", 0.0)
        node.temperature = data.get("temperature", 0.0)
        node.uptime = data.get("uptime", node.uptime)
        node.agent_version = data.get("version", node.agent_version)
        node.online = True
        node.last_seen = datetime.datetime.now(datetime.timezone.utc)
        node.status = "online" if node.approved else "discovered"

        await db.flush()
        return node
    except Exception as e:
        node.online = False
        node.status = "offline"
        await db.flush()
        raise HTTPException(status_code=502, detail=f"Failed to reach node at {url}: {str(e)}")

@router.post("/{node_id}/update")
async def update_node_agent(node_id: int, db: AsyncSession = Depends(get_db)):
    """Trigger remote update on node agent"""
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    url = f"http://{node.ip_address}:{node.agent_port}/update"
    try:
        node.status = "updating"
        await db.flush()

        res = requests.post(url, timeout=30)
        res.raise_for_status()

        event = Event(
            node_id=node.id,
            severity="info",
            event_type="node_update_triggered",
            message=f"Update triggered for node {node.hostname}"
        )
        db.add(event)
        await db.flush()
        return res.json()
    except Exception as e:
        node.status = "error"
        await db.flush()
        raise HTTPException(status_code=502, detail=f"Failed to trigger update at {url}: {str(e)}")
