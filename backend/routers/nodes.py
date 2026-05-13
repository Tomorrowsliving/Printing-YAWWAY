from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from ..database import get_db
from ..models import Node, Event
from ..schemas import NodeCreate, NodeHeartbeat, Node as NodeSchema
import datetime
import ipaddress

router = APIRouter(prefix="/nodes", tags=["nodes"])

def is_local_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback
    except ValueError:
        return False

@router.post("/", response_model=NodeSchema)
async def register_node(node_in: NodeCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.hostname == node_in.hostname))
    existing_node = result.scalar_one_or_none()

    if existing_node:
        for field, value in node_in.model_dump().items():
            setattr(existing_node, field, value)
        existing_node.last_seen = datetime.datetime.now(datetime.timezone.utc)
        existing_node.online = True
        node = existing_node
    else:
        node = Node(**node_in.model_dump())
        node.last_seen = datetime.datetime.now(datetime.timezone.utc)
        node.online = True
        db.add(node)

    # Record event
    event = Event(
        node_id=node.id,
        severity="info",
        event_type="node_registration",
        message=f"Node {node.hostname} registered/updated at {node.ip_address}"
    )
    db.add(event)

    await db.flush()
    return node

@router.get("/", response_model=List[NodeSchema])
async def list_nodes(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node))
    return result.scalars().all()

@router.get("/{node_id}", response_model=NodeSchema)
async def get_node(node_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node

@router.post("/heartbeat", response_model=NodeSchema)
async def node_heartbeat(hb: NodeHeartbeat, request: Request, db: AsyncSession = Depends(get_db)):
    # Security: Only accept local network heartbeats
    client_host = request.client.host
    if not is_local_ip(client_host) and not is_local_ip(hb.ip_address):
        raise HTTPException(status_code=403, detail="Non-local heartbeats rejected")

    result = await db.execute(select(Node).where(Node.node_uuid == hb.node_uuid))
    node = result.scalar_one_or_none()

    is_new = False
    if not node:
        is_new = True
        node = Node(node_uuid=hb.node_uuid, approved=False)
        db.add(node)

    node.hostname = hb.hostname
    node.ip_address = hb.ip_address
    node.agent_port = hb.agent_port
    node.model = hb.model
    node.cpu_usage = hb.cpu_usage
    node.ram_usage = hb.ram_usage
    node.temperature = hb.temperature
    node.uptime = hb.uptime
    node.online = True
    node.last_seen = datetime.datetime.now(datetime.timezone.utc)

    await db.flush()

    if is_new:
        event = Event(
            node_id=node.id,
            severity="info",
            event_type="node_discovered",
            message=f"New node discovered: {node.hostname} ({node.node_uuid})"
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
    await db.flush()
    return node

@router.post("/{node_id}/refresh")
async def refresh_node(node_id: int, db: AsyncSession = Depends(get_db)):
    # Placeholder for explicit refresh logic if needed
    return {"status": "success"}
