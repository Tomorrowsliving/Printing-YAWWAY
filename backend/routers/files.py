from fastapi import APIRouter, HTTPException, UploadFile, File
import os
import shutil
import httpx
from typing import List, Optional
from pydantic import BaseModel
from fastapi.responses import FileResponse

router = APIRouter(prefix="/files", tags=["files"])

STORAGE_ROOT = os.getenv("PRINTERS_PATH", "/mnt/klipper-farm/printers")

class FileInfo(BaseModel):
    name: str
    path: str
    type: str # file or directory
    size: int
    last_modified: float

class SaveFileRequest(BaseModel):
    content: str

@router.get("/{printer_slug}/{file_type}", response_model=List[FileInfo])
async def list_files(printer_slug: str, file_type: str):
    # file_type could be: config, gcode, logs
    target_path = os.path.join(STORAGE_ROOT, printer_slug, file_type)

    # Security: Ensure target path is within STORAGE_ROOT
    abs_path = os.path.abspath(target_path)
    abs_root = os.path.abspath(STORAGE_ROOT)
    if os.path.commonpath([abs_path, abs_root]) != abs_root:
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(target_path):
        # Create directory if it doesn't exist to make it easier for user
        os.makedirs(target_path, exist_ok=True)

    files = []
    for item in os.listdir(target_path):
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
    # Security: Ensure path is within STORAGE_ROOT
    abs_path = os.path.abspath(path)
    abs_root = os.path.abspath(STORAGE_ROOT)
    if os.path.commonpath([abs_path, abs_root]) != abs_root:
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    with open(path, "r") as f:
        return {"content": f.read()}

@router.post("/save")
async def save_file(path: str, req: SaveFileRequest):
    abs_path = os.path.abspath(path)
    abs_root = os.path.abspath(STORAGE_ROOT)
    if os.path.commonpath([abs_path, abs_root]) != abs_root:
        raise HTTPException(status_code=403, detail="Access denied")

    # Create backup before save if it's a config file
    if ".cfg" in path or ".conf" in path:
        backup_path = path + ".bak"
        if os.path.exists(path):
            shutil.copy2(path, backup_path)

    with open(path, "w") as f:
        f.write(req.content)

    return {"status": "success"}

@router.post("/upload")
async def upload_file(printer_slug: str, file_type: str, file: UploadFile = File(...)):
    target_dir = os.path.join(STORAGE_ROOT, printer_slug, file_type)

    # Security: Ensure target directory is within STORAGE_ROOT before creating it
    abs_dir = os.path.abspath(target_dir)
    abs_root = os.path.abspath(STORAGE_ROOT)
    if os.path.commonpath([abs_dir, abs_root]) != abs_root:
        raise HTTPException(status_code=403, detail="Access denied")

    os.makedirs(target_dir, exist_ok=True)

    # Sanitize filename to prevent absolute path or directory traversal via filename
    safe_filename = os.path.basename(file.filename)
    file_path = os.path.join(target_dir, safe_filename)

    # Security: Ensure upload path is within STORAGE_ROOT
    abs_path = os.path.abspath(file_path)
    if os.path.commonpath([abs_path, abs_root]) != abs_root:
        raise HTTPException(status_code=403, detail="Access denied")

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"filename": safe_filename, "status": "success"}

@router.get("/download")
async def download_file(path: str):
    abs_path = os.path.abspath(path)
    abs_root = os.path.abspath(STORAGE_ROOT)
    if os.path.commonpath([abs_path, abs_root]) != abs_root:
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(path, filename=os.path.basename(path))

@router.delete("/delete")
async def delete_file(path: str):
    abs_path = os.path.abspath(path)
    abs_root = os.path.abspath(STORAGE_ROOT)
    if os.path.commonpath([abs_path, abs_root]) != abs_root:
        raise HTTPException(status_code=403, detail="Access denied")

    if os.path.exists(path):
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        return {"status": "success"}
    else:
        raise HTTPException(status_code=404, detail="File not found")

@router.get("/examples/klipper")
async def list_klipper_examples():
    """Fetches list of example configs from Klipper GitHub"""
    url = "https://api.github.com/repos/Klipper3d/klipper/contents/config"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=10)
        if res.status_code == 200:
            files = res.json()
            return [f for f in files if f["name"].endswith(".cfg")]
        else:
            return []
    except:
        return []

@router.get("/examples/klipper/content")
async def get_klipper_example_content(path: str):
    """Fetches content of a specific Klipper example config"""
    # path is the download_url or relative path from GitHub
    if not path.startswith("https://raw.githubusercontent.com/Klipper3d/klipper/master/config/"):
         raise HTTPException(status_code=403, detail="Unauthorised example path")

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(path, timeout=10)
        return {"content": res.text}
    except:
        raise HTTPException(status_code=502, detail="Failed to fetch example content")
