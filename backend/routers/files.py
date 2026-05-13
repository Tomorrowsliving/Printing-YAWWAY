from fastapi import APIRouter, HTTPException, UploadFile, File
import os
import shutil
from typing import List, Optional
from pydantic import BaseModel
from fastapi.responses import FileResponse

router = APIRouter(prefix="/files", tags=["files"])

STORAGE_ROOT = os.getenv("PRINTERS_PATH", "storage/printers")

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
    if not os.path.abspath(path).startswith(os.path.abspath(STORAGE_ROOT)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    with open(path, "r") as f:
        return {"content": f.read()}

@router.post("/save")
async def save_file(path: str, req: SaveFileRequest):
    if not os.path.abspath(path).startswith(os.path.abspath(STORAGE_ROOT)):
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
    os.makedirs(target_dir, exist_ok=True)

    file_path = os.path.join(target_dir, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"filename": file.filename, "status": "success"}

@router.get("/download")
async def download_file(path: str):
    if not os.path.abspath(path).startswith(os.path.abspath(STORAGE_ROOT)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(path, filename=os.path.basename(path))

@router.delete("/delete")
async def delete_file(path: str):
    if not os.path.abspath(path).startswith(os.path.abspath(STORAGE_ROOT)):
        raise HTTPException(status_code=403, detail="Access denied")

    if os.path.exists(path):
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        return {"status": "success"}
    else:
        raise HTTPException(status_code=404, detail="File not found")
