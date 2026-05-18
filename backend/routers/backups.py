from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select, desc
from typing import List
import os
import shutil
import datetime
from pydantic import BaseModel
from ..database import get_db
from ..models import Backup, Event
from ..schemas import Backup as BackupSchema
from ..utils.file_backups import (
    FILE_EDIT_BACKUP_TYPE,
    find_legacy_sidecar_backups,
    get_backup_settings,
    move_legacy_sidecar_backup,
    prune_all_file_edit_backups,
    restore_file_edit_backup,
    save_backup_settings,
)

router = APIRouter(prefix="/backups", tags=["backups"])

BACKUP_PATH = os.getenv("BACKUP_PATH", "/mnt/klipper-farm/backups")
PRINTERS_PATH = os.getenv("PRINTERS_PATH", "/mnt/klipper-farm/printers")

class BackupSettingsRequest(BaseModel):
    file_backup_limit: int

async def migrate_legacy_file_backups(db: AsyncSession):
    migrated = 0
    for legacy_path in find_legacy_sidecar_backups():
        backup_path = move_legacy_sidecar_backup(legacy_path)
        if not backup_path:
            continue

        result = await db.execute(select(Backup).where(Backup.file_path == backup_path))
        if result.scalar_one_or_none():
            continue

        db.add(Backup(
            filename=os.path.relpath(backup_path, BACKUP_PATH).replace(os.sep, "/"),
            file_path=backup_path,
            backup_type=FILE_EDIT_BACKUP_TYPE,
            status="success",
        ))
        migrated += 1

    if migrated:
        db.add(Event(
            severity="info",
            event_type="backup",
            message=f"Migrated {migrated} file edit backup(s) into central backups",
        ))

    settings = get_backup_settings()
    pruned_paths = prune_all_file_edit_backups(settings["file_backup_limit"])
    if pruned_paths:
        await db.execute(delete(Backup).where(Backup.file_path.in_(pruned_paths)))

    await db.flush()

@router.get("/", response_model=List[BackupSchema])
async def list_backups(db: AsyncSession = Depends(get_db)):
    await migrate_legacy_file_backups(db)
    result = await db.execute(select(Backup).order_by(desc(Backup.created_at)))
    return result.scalars().all()

@router.get("/settings")
async def get_settings():
    return get_backup_settings()

@router.post("/settings")
async def update_settings(req: BackupSettingsRequest, db: AsyncSession = Depends(get_db)):
    settings = save_backup_settings(req.file_backup_limit)
    pruned_paths = prune_all_file_edit_backups(settings["file_backup_limit"])
    if pruned_paths:
        await db.execute(delete(Backup).where(Backup.file_path.in_(pruned_paths)))
    await db.flush()
    return {**settings, "pruned": len(pruned_paths)}

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
        if backup.backup_type == FILE_EDIT_BACKUP_TYPE:
            restored_path = restore_file_edit_backup(backup.file_path)
            event = Event(
                severity="warning",
                event_type="restore",
                message=f"File restored from backup: {backup.filename}",
            )
            db.add(event)
            await db.flush()
            return {"status": "success", "message": "File restore complete", "path": restored_path}

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
