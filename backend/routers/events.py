from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List, Optional
from ..database import get_db
from ..models import Event
from ..schemas import Event as EventSchema

router = APIRouter(prefix="/events", tags=["events"])

@router.get("/", response_model=List[EventSchema])
async def list_events(
    printer_id: Optional[int] = Query(None),
    node_id: Optional[int] = Query(None),
    severity: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    limit: int = Query(50),
    db: AsyncSession = Depends(get_db)
):
    query = select(Event).order_by(desc(Event.created_at))

    if printer_id:
        query = query.where(Event.printer_id == printer_id)
    if node_id:
        query = query.where(Event.node_id == node_id)
    if severity:
        query = query.where(Event.severity == severity)
    if event_type:
        query = query.where(Event.event_type == event_type)

    query = query.limit(limit)
    result = await db.execute(query)
    return result.scalars().all()
