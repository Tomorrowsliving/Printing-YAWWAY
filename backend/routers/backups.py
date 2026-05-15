from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List
import os
import shutil
import datetime
from ..database import get_db
from ..models import Backup, Event
from ..schemas import Backup as BackupSchema

router = APIRouter(prefix="/backups", tags=["backups"])

BACKUP_PATH = os.getenv("BACKUP_PATH", "/mnt/klipper-farm/backups")
PRINTERS_PATH = os.getenv("PRINTERS_PATH", "/mnt/klipper-farm/printers")

@router.get("/", response_model=List[BackupSchema])
async def list_backups(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Backup).order_by(desc(Backup.created_at)))
    return result.scalars().all()

@router.post("/create")
async def create_backup(db: AsyncSession = Depends(get_db)):
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{timestamp}.zip"
    file_path = os.path.join(BACKUP_PATH, filename)

    try:
        # Simple backup logic: zip the printers directory
        # In a real farm, this would also include a DB dump
        if not os.path.exists(BACKUP_PATH):
            os.makedirs(BACKUP_PATH)

        shutil.make_archive(file_path.replace(".zip", ""), 'zip', PRINTERS_PATH)

        backup = Backup(
            filename=filename,
            file_path=file_path,
            backup_type="manual",
            status="success"
        )
        db.add(backup)

        event = Event(
            severity="info",
            event_type="backup",
            message=f"Manual backup created: {filename}"
        )
        db.add(event)

        await db.flush()
        return {"status": "success", "filename": filename}
    except Exception as e:
        backup = Backup(
            filename=filename,
            file_path=file_path,
            backup_type="manual",
            status="failed",
            error_message=str(e)
        )
        db.add(backup)
        await db.flush()
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")

@router.post("/restore/{backup_id}")
async def restore_backup(backup_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Backup).where(Backup.id == backup_id))
    backup = result.scalar_one_or_none()
    if not backup:
        raise HTTPException(status_code=404, detail="Backup not found")

    try:
        # Restore logic: unzip back to printers directory
        shutil.unpack_archive(backup.file_path, PRINTERS_PATH)

        event = Event(
            severity="warning",
            event_type="restore",
            message=f"System restored from backup: {backup.filename}"
        )
        db.add(event)
        await db.flush()
        return {"status": "success", "message": "Restore complete"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Restore failed: {str(e)}")
