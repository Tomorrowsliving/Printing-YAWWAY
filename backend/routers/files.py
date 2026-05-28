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
ALLOWED_FILE_TYPES = {"config", "gcode", "logs"}
FILE_TYPE_DIRECTORIES = {
    "config": "config",
    "gcode": "gcodes",
    "logs": "logs",
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

def validate_storage_file_path(path: str):
    if not is_path_within(path, STORAGE_ROOT):
        raise HTTPException(status_code=403, detail="Access denied")
    if is_backup_filename(os.path.basename(path)):
        raise HTTPException(status_code=400, detail="Backup files are managed from the Backups section")

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
    target_path = os.path.join(STORAGE_ROOT, printer_slug, storage_subdir_for_file_type(file_type))
    if not is_path_within(target_path, STORAGE_ROOT):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(target_path):
        # Create directory if it doesn't exist to make it easier for user
        os.makedirs(target_path, exist_ok=True)

    files = []
    for item in os.listdir(target_path):
        if is_backup_filename(item):
            continue

        item_path = os.path.join(target_path, item)
        stats = os.stat(item_path)
        files.append(FileInfo(
            name=item,
            path=item_path,
            type="file" if os.path.isfile(item_path) else "directory",
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
    validate_storage_file_path(path)

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
        ))

    if pruned_paths:
        await db.execute(delete(Backup).where(Backup.file_path.in_(pruned_paths)))

    with open(path, "w", encoding="utf-8") as f:
        f.write(req.content)

    await db.flush()
    return {"status": "success", "backup_created": bool(backup_path)}

@router.post("/upload")
async def upload_file(printer_slug: str, file_type: str, file: UploadFile = File(...)):
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

    return {"filename": filename, "status": "success"}

@router.get("/download")
async def download_file(path: str):
    validate_storage_file_path(path)

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(path, filename=os.path.basename(path))

@router.delete("/delete")
async def delete_file(path: str):
    validate_storage_file_path(path)

    if os.path.exists(path):
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        return {"status": "success"}
    else:
        raise HTTPException(status_code=404, detail="File not found")
