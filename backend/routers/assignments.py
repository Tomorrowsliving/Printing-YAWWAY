from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Printer, Node, Event
from pydantic import BaseModel
import datetime

router = APIRouter(prefix="/assignments", tags=["assignments"])

class MigrationRequest(BaseModel):
    printer_id: int
    target_node_id: int

@router.post("/migrate")
async def migrate_printer(req: MigrationRequest, db: AsyncSession = Depends(get_db)):
    # Fetch printer
    result = await db.execute(select(Printer).where(Printer.id == req.printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    old_node_id = printer.assigned_node_id

    # Fetch target node
    result = await db.execute(select(Node).where(Node.id == req.target_node_id))
    target_node = result.scalar_one_or_none()
    if not target_node:
        raise HTTPException(status_code=404, detail="Target node not found")

    if not target_node.online:
        raise HTTPException(status_code=400, detail="Target node is offline")

    # Update assignment
    printer.assigned_node_id = req.target_node_id

    # Record event
    event = Event(
        printer_id=req.printer_id,
        node_id=req.target_node_id,
        severity="info",
        event_type="migration",
        message=f"Printer {printer.name} migrated from node {old_node_id} to {req.target_node_id}",
        details={"old_node_id": old_node_id, "new_node_id": req.target_node_id}
    )
    db.add(event)

    await db.flush()
    return {"status": "success", "message": f"Migrated {printer.name} to {target_node.hostname}"}
