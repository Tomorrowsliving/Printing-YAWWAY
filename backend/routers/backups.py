from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select, desc
from typing import List, Optional
import os
import shutil
import datetime
import asyncio
import json
import zipfile
from pydantic import BaseModel
from ..database import AsyncSessionLocal, get_db
from ..models import Assignment, Backup, Event, Node, Printer, PrinterNote, ServiceInstance
from ..schemas import Backup as BackupSchema
from ..utils.file_backups import (
    FILE_EDIT_BACKUP_TYPE,
    find_legacy_sidecar_backups,
    get_backup_settings,
    move_legacy_sidecar_backup,
    original_relpath_for_backup_path,
    prune_all_file_edit_backups,
    restore_file_edit_backup,
    save_backup_settings,
)

router = APIRouter(prefix="/backups", tags=["backups"])

BACKUP_PATH = os.getenv("BACKUP_PATH", "/mnt/klipper-farm/backups")
PRINTERS_PATH = os.getenv("PRINTERS_PATH", "/mnt/klipper-farm/printers")
FARM_BACKUP_CATEGORY = "farm"
PRINTER_CONFIG_BACKUP_CATEGORY = "printer-config"
OTHER_BACKUP_CATEGORY = "other"
ALL_PRINTERS_SLUG = "__all_printers__"

class BackupSettingsRequest(BaseModel):
    file_backup_limit: int
    automatic_enabled: bool = True
    scheduled_time: str = "02:00"
    farm_backup_retention: int = 14

def _label_from_slug(slug: str):
    return slug.replace("-", " ").replace("_", " ").title()

def _file_edit_printer_slug(backup: Backup):
    try:
        original_relpath = original_relpath_for_backup_path(backup.file_path)
        parts = original_relpath.replace("\\", "/").split("/")
        return parts[0] if len(parts) > 1 else None
    except Exception:
        rel_filename = (backup.filename or "").replace("\\", "/")
        parts = rel_filename.split("/")
        if len(parts) >= 3 and parts[0] == "file-edits":
            return parts[1]
    return None

def enrich_backup(backup: Backup, printer_names: dict):
    if backup.backup_type == FILE_EDIT_BACKUP_TYPE:
        printer_slug = _file_edit_printer_slug(backup)
        backup.backup_category = PRINTER_CONFIG_BACKUP_CATEGORY
        backup.display_type = "Printer Config"
        backup.printer_slug = printer_slug
        backup.printer_name = printer_names.get(printer_slug) if printer_slug else None
        if printer_slug and not backup.printer_name:
            backup.printer_name = _label_from_slug(printer_slug)
    elif backup.backup_type in ("manual", "farm", "klipper-farm"):
        backup.backup_category = FARM_BACKUP_CATEGORY
        backup.display_type = "Farm Backup"
        backup.printer_slug = ALL_PRINTERS_SLUG
        backup.printer_name = "All printers"
    else:
        backup.backup_category = OTHER_BACKUP_CATEGORY
        backup.display_type = "Other"
        backup.printer_slug = None
        backup.printer_name = None

    return backup

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
async def list_backups(
    printer_slug: Optional[str] = Query(None),
    backup_category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    await migrate_legacy_file_backups(db)
    printer_result = await db.execute(select(Printer.slug, Printer.name))
    printer_names = {slug: name for slug, name in printer_result.all()}

    result = await db.execute(select(Backup).order_by(desc(Backup.created_at)))
    backups = [enrich_backup(backup, printer_names) for backup in result.scalars().all()]

    if backup_category and backup_category != "all":
        backups = [backup for backup in backups if backup.backup_category == backup_category]

    if printer_slug and printer_slug != "all":
        backups = [backup for backup in backups if backup.printer_slug == printer_slug]

    return backups

@router.get("/settings")
async def get_settings():
    return get_backup_settings()

@router.post("/settings")
async def update_settings(req: BackupSettingsRequest, db: AsyncSession = Depends(get_db)):
    settings = save_backup_settings(
        req.file_backup_limit,
        automatic_enabled=req.automatic_enabled,
        scheduled_time=req.scheduled_time,
        farm_backup_retention=req.farm_backup_retention,
    )
    pruned_paths = prune_all_file_edit_backups(settings["file_backup_limit"])
    if pruned_paths:
        await db.execute(delete(Backup).where(Backup.file_path.in_(pruned_paths)))
    await db.flush()
    return {**settings, "pruned": len(pruned_paths)}

def _json_default(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    return str(value)

def _row_to_dict(obj):
    return {column.name: getattr(obj, column.name) for column in obj.__table__.columns}

async def _metadata_manifest(db: AsyncSession):
    tables = {
        "printers": Printer,
        "nodes": Node,
        "assignments": Assignment,
        "printer_notes": PrinterNote,
        "service_instances": ServiceInstance,
    }
    manifest = {
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "schema": 1,
        "tables": {},
    }
    for name, model in tables.items():
        result = await db.execute(select(model))
        manifest["tables"][name] = [_row_to_dict(row) for row in result.scalars().all()]
    return manifest

def _prune_farm_backups(retention: int):
    if retention <= 0 or not os.path.isdir(BACKUP_PATH):
        return []
    candidates = [
        os.path.join(BACKUP_PATH, name)
        for name in os.listdir(BACKUP_PATH)
        if name.endswith(".zip") and (name.startswith("backup_") or name.startswith("scheduled_"))
    ]
    candidates.sort(key=lambda path: os.path.getmtime(path), reverse=True)
    removed = []
    for path in candidates[retention:]:
        try:
            os.remove(path)
            removed.append(path)
        except OSError:
            pass
    return removed

async def _create_farm_backup(db: AsyncSession, source: str = "manual"):
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    prefix = "scheduled" if source == "scheduled" else "backup"
    filename = f"{prefix}_{timestamp}.zip"
    file_path = os.path.join(BACKUP_PATH, filename)

    try:
        if not os.path.exists(BACKUP_PATH):
            os.makedirs(BACKUP_PATH)

        manifest = await _metadata_manifest(db)
        with zipfile.ZipFile(file_path, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, indent=2, default=_json_default))
            if os.path.isdir(PRINTERS_PATH):
                for dirpath, _, filenames in os.walk(PRINTERS_PATH):
                    for file_name in filenames:
                        source_path = os.path.join(dirpath, file_name)
                        rel_path = os.path.relpath(source_path, PRINTERS_PATH).replace(os.sep, "/")
                        archive.write(source_path, f"printers/{rel_path}")

        backup = Backup(
            filename=filename,
            file_path=file_path,
            backup_type="farm" if source == "scheduled" else "manual",
            status="success"
        )
        db.add(backup)

        event = Event(
            severity="info",
            event_type="backup",
            message=f"{source.title()} backup created: {filename}",
            details={"source": source, "manifest_tables": list(manifest["tables"].keys())},
        )
        db.add(event)

        removed = _prune_farm_backups(get_backup_settings()["farm_backup_retention"])
        await db.flush()
        return {"status": "success", "filename": filename, "pruned": len(removed)}
    except Exception as e:
        backup = Backup(
            filename=filename,
            file_path=file_path,
            backup_type="manual",
            status="failed",
            error_message=str(e)
        )
        db.add(backup)
        db.add(Event(
            severity="error",
            event_type="backup_failed",
            message=f"{source.title()} backup failed: {filename}",
            details={"error": str(e)},
        ))
        await db.flush()
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")

@router.post("/create")
async def create_backup(db: AsyncSession = Depends(get_db)):
    return await _create_farm_backup(db, "manual")

async def scheduled_backup_loop():
    last_run_date = None
    while True:
        try:
            settings = get_backup_settings()
            if settings.get("automatic_enabled"):
                now = datetime.datetime.now()
                scheduled = str(settings.get("scheduled_time") or "02:00")
                hour, minute = [int(part) for part in scheduled.split(":", 1)]
                due = now.hour == hour and now.minute == minute
                if due and last_run_date != now.date():
                    async with AsyncSessionLocal() as db:
                        await _create_farm_backup(db, "scheduled")
                        await db.commit()
                    last_run_date = now.date()
        except Exception:
            pass
        await asyncio.sleep(30)

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

        if backup.backup_type in ("manual", "farm", "klipper-farm"):
            with zipfile.ZipFile(backup.file_path, "r") as archive:
                for item in archive.infolist():
                    if not item.filename.startswith("printers/") or item.is_dir():
                        continue
                    target = os.path.join(PRINTERS_PATH, item.filename[len("printers/"):])
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with archive.open(item) as source, open(target, "wb") as dest:
                        shutil.copyfileobj(source, dest)
        else:
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
