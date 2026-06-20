from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
import os
import shutil
import httpx
from typing import List, Optional
from pydantic import BaseModel
from fastapi.responses import FileResponse
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import Backup, Event
from ..utils.file_backups import (
    BACKUP_ROOT,
    FILE_EDIT_BACKUP_TYPE,
    create_file_edit_backup,
    is_backup_filename,
    is_path_within,
)

router = APIRouter(prefix="/files", tags=["files"])

STORAGE_ROOT = os.getenv("PRINTERS_PATH", "/mnt/klipper-farm/printers")
ALLOWED_FILE_TYPES = {"config", "moonraker", "macros", "gcode", "logs", "backups"}
FILE_TYPE_DIRECTORIES = {
    "config": "config",
    "moonraker": "config",
    "macros": os.path.join("config", "macros"),
    "gcode": "gcodes",
    "logs": "logs",
    "backups": "",
}
KLIPPER_CONFIG_API_URL = "https://api.github.com/repos/Klipper3d/klipper/contents/config"
KLIPPER_RAW_CONFIG_PREFIX = "https://raw.githubusercontent.com/Klipper3d/klipper/master/config/"

class FileInfo(BaseModel):
    name: str
    path: str
    type: str # file or directory
    size: int
    last_modified: float

class SaveFileRequest(BaseModel):
    content: str

class RenameFileRequest(BaseModel):
    path: str
    new_name: str

def _managed_root_for_path(path: str):
    if is_path_within(path, STORAGE_ROOT):
        return STORAGE_ROOT
    if is_path_within(path, BACKUP_ROOT):
        return BACKUP_ROOT
    return None

def validate_storage_file_path(path: str, allow_backups: bool = True):
    root = _managed_root_for_path(path)
    if not root or (root == BACKUP_ROOT and not allow_backups):
        raise HTTPException(status_code=403, detail="Access denied")
    if root == STORAGE_ROOT and is_backup_filename(os.path.basename(path)):
        raise HTTPException(status_code=400, detail="Backup files are managed from the Backups section")
    return root

def storage_subdir_for_file_type(file_type: str):
    if file_type not in ALLOWED_FILE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type")
    return FILE_TYPE_DIRECTORIES[file_type]

@router.get("/examples/klipper")
async def list_klipper_examples():
    """Fetches list of example configs from Klipper GitHub"""
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(KLIPPER_CONFIG_API_URL, timeout=10)
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch Klipper examples")

        files = res.json()
        return [f for f in files if f["name"].endswith(".cfg")]
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to fetch Klipper examples")

@router.get("/examples/klipper/content")
async def get_klipper_example_content(path: str):
    """Fetches content of a specific Klipper example config"""
    # path is the download_url or relative path from GitHub
    if not path.startswith(KLIPPER_RAW_CONFIG_PREFIX):
        raise HTTPException(status_code=403, detail="Unauthorised example path")

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(path, timeout=10)
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch example content")
        return {"content": res.text}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to fetch example content")

@router.get("/{printer_slug}/{file_type}", response_model=List[FileInfo])
async def list_files(printer_slug: str, file_type: str):
    if file_type == "backups":
        target_path = os.path.join(BACKUP_ROOT, "file-edits", printer_slug)
        root = BACKUP_ROOT
    else:
        target_path = os.path.join(STORAGE_ROOT, printer_slug, storage_subdir_for_file_type(file_type))
        root = STORAGE_ROOT

    if not is_path_within(target_path, root):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(target_path):
        os.makedirs(target_path, exist_ok=True)

    files = []
    for dirpath, dirnames, filenames in os.walk(target_path):
        dirnames[:] = [name for name in dirnames if not name.startswith(".")]
        for item in filenames:
            if file_type != "backups" and is_backup_filename(item):
                continue
            if file_type == "moonraker" and not item.lower().startswith("moonraker"):
                continue
            item_path = os.path.join(dirpath, item)
            stats = os.stat(item_path)
            files.append(FileInfo(
                name=os.path.relpath(item_path, target_path).replace(os.sep, "/"),
                path=item_path,
                type="file",
                size=stats.st_size,
                last_modified=stats.st_mtime
            ))
    return files

@router.get("/read")
async def read_file(path: str):
    validate_storage_file_path(path)

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    with open(path, "r", encoding="utf-8") as f:
        return {"content": f.read()}

@router.post("/save")
async def save_file(path: str, req: SaveFileRequest, db: AsyncSession = Depends(get_db)):
    validate_storage_file_path(path, allow_backups=False)

    backup_path, pruned_paths = create_file_edit_backup(path)
    if backup_path:
        backup_name = os.path.relpath(backup_path, BACKUP_ROOT).replace(os.sep, "/")
        db.add(Backup(
            filename=backup_name,
            file_path=backup_path,
            backup_type=FILE_EDIT_BACKUP_TYPE,
            status="success",
        ))
        db.add(Event(
            severity="info",
            event_type="backup",
            message=f"File edit backup created: {backup_name}",
            details={"backup_path": backup_path, "source_path": path},
        ))

    if pruned_paths:
        await db.execute(delete(Backup).where(Backup.file_path.in_(pruned_paths)))

    with open(path, "w", encoding="utf-8") as f:
        f.write(req.content)

    db.add(Event(
        severity="info",
        event_type="file_saved",
        message=f"Managed file saved: {os.path.basename(path)}",
        details={
            "path": path,
            "backup_created": bool(backup_path),
            "backup_path": backup_path,
            "pruned_backups": len(pruned_paths or []),
        },
    ))
    await db.flush()
    return {"status": "success", "backup_created": bool(backup_path)}

@router.post("/upload")
async def upload_file(printer_slug: str, file_type: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    if file_type == "backups":
        raise HTTPException(status_code=400, detail="Upload restore archives from the Backups section")
    target_dir = os.path.join(STORAGE_ROOT, printer_slug, storage_subdir_for_file_type(file_type))
    if not is_path_within(target_dir, STORAGE_ROOT):
        raise HTTPException(status_code=403, detail="Access denied")

    os.makedirs(target_dir, exist_ok=True)

    filename = os.path.basename(file.filename or "")
    file_path = os.path.join(target_dir, filename)
    if not filename or not is_path_within(file_path, target_dir) or is_backup_filename(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    db.add(Event(
        severity="info",
        event_type="file_uploaded",
        message=f"File uploaded: {filename}",
        details={"printer_slug": printer_slug, "file_type": file_type, "path": file_path},
    ))
    await db.flush()
    return {"filename": filename, "status": "success"}

@router.post("/rename")
async def rename_file(req: RenameFileRequest):
    validate_storage_file_path(req.path, allow_backups=False)
    if not os.path.exists(req.path):
        raise HTTPException(status_code=404, detail="File not found")

    new_name = os.path.basename(req.new_name or "")
    if not new_name or new_name != req.new_name.strip() or is_backup_filename(new_name):
        raise HTTPException(status_code=400, detail="Invalid filename")

    target_path = os.path.join(os.path.dirname(req.path), new_name)
    if not is_path_within(target_path, os.path.dirname(req.path)):
        raise HTTPException(status_code=403, detail="Access denied")
    if os.path.exists(target_path):
        raise HTTPException(status_code=409, detail="A file with that name already exists")

    os.rename(req.path, target_path)
    return {"status": "success", "path": target_path, "filename": new_name}

@router.get("/download")
async def download_file(path: str):
    validate_storage_file_path(path)

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(path, filename=os.path.basename(path))

@router.delete("/delete")
async def delete_file(path: str, db: AsyncSession = Depends(get_db)):
    validate_storage_file_path(path)

    if os.path.exists(path):
        filename = os.path.basename(path)
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        db.add(Event(
            severity="warning",
            event_type="file_deleted",
            message=f"Managed file deleted: {filename}",
            details={"path": path},
        ))
        await db.flush()
        return {"status": "success"}
    else:
        raise HTTPException(status_code=404, detail="File not found")
