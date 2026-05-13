from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from ..database import get_db
from ..models import Printer, Node, PrinterNote
from ..schemas import PrinterCreate, Printer as PrinterSchema
import datetime

router = APIRouter(prefix="/printers", tags=["printers"])

@router.post("/", response_model=PrinterSchema)
async def create_printer(printer_in: PrinterCreate, db: AsyncSession = Depends(get_db)):
    printer = Printer(**printer_in.model_dump())
    printer.created_at = datetime.datetime.now(datetime.timezone.utc)
    db.add(printer)
    await db.flush()
    return printer

@router.get("/", response_model=List[PrinterSchema])
async def list_printers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer))
    return result.scalars().all()

@router.get("/{printer_id}", response_model=PrinterSchema)
async def get_printer(printer_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")
    return printer

@router.put("/{printer_id}", response_model=PrinterSchema)
async def update_printer(printer_id: int, printer_in: PrinterCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Printer).where(Printer.id == printer_id))
    printer = result.scalar_one_or_none()
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    for field, value in printer_in.model_dump().items():
        setattr(printer, field, value)

    await db.flush()
    return printer
