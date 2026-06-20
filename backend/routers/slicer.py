from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import asyncio
import datetime
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import tempfile
from pathlib import Path

import requests
from ..database import AsyncSessionLocal, get_db
from ..models import Event, FilamentSpool, Printer, SlicerJob, SlicerModel, SlicerProfile
from ..schemas import SlicerBatchJobCreate, SlicerJob as SlicerJobSchema
from ..schemas import SlicerJobCreate, SlicerProfile as SlicerProfileSchema, SlicerProfileBase, SlicerSettings
from ..schemas import SlicerModel as SlicerModelSchema
from ..utils.filament import estimate_usage_g, extract_gcode_filament_metadata
from ..utils.file_backups import PRINTERS_ROOT, is_path_within

router = APIRouter(prefix="/slicer", tags=["slicer"])

STORAGE_ROOT = os.getenv("STORAGE_ROOT") or os.path.dirname(PRINTERS_ROOT.rstrip(os.sep))
MODELS_ROOT = os.path.join(STORAGE_ROOT, "models")
SETTINGS_DIR = os.path.join(STORAGE_ROOT, "settings")
SLICER_SETTINGS_FILE = os.path.join(SETTINGS_DIR, "slicer.json")
ALLOWED_MODEL_EXTENSIONS = {".stl", ".3mf"}
DEFAULT_ORCA_PATHS = [
    "/mnt/klipper-farm/tools/orca-slicer/orca-slicer",
    "/opt/orca-slicer/orca-slicer",
    "/usr/local/bin/orca-slicer",
    "/usr/bin/orca-slicer",
    "/usr/local/bin/OrcaSlicer",
    "/usr/bin/OrcaSlicer",
]
ORCA_INSTALL_LOCK = asyncio.Lock()
ORCA_REPO = "OrcaSlicer/OrcaSlicer"
ORCA_BACKEND_PATH = "/mnt/klipper-farm/tools/orca-slicer/orca-slicer"


def _detected_orca_path():
    for path in DEFAULT_ORCA_PATHS:
        if os.path.exists(path) and os.access(path, os.X_OK):
            return path
    return None


def _safe_filename(filename: str):
    name = os.path.basename(filename or "")
    name = re.sub(r"[^A-Za-z0-9_. -]+", "_", name).strip()
    if not name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    return name


def _safe_stem(value: str):
    stem = Path(value or "slice").stem
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("._-")
    return stem or "slice"


def _model_file_available(model: SlicerModel):
    return bool(
        model.file_path
        and is_path_within(model.file_path, MODELS_ROOT)
        and os.path.exists(model.file_path)
    )


def _unique_gcode_path(output_dir: str, model: SlicerModel, printer: Printer):
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    base = f"{_safe_stem(model.filename)}_{printer.slug}_{timestamp}"
    candidate = os.path.join(output_dir, f"{base}.gcode")
    counter = 2
    while os.path.exists(candidate):
        candidate = os.path.join(output_dir, f"{base}_{counter}.gcode")
        counter += 1
    return candidate


def _settings():
    try:
        with open(SLICER_SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        data = {}
    return {"orca_binary_path": data.get("orca_binary_path") or os.getenv("ORCA_SLICER_PATH") or _detected_orca_path()}


def _save_settings(data: dict):
    os.makedirs(SETTINGS_DIR, exist_ok=True)
    current = _settings()
    current.update(data)
    with open(SLICER_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return current


def _orca_arch_pattern():
    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64"}:
        return "x86_64"
    if machine in {"aarch64", "arm64"}:
        return "aarch64"
    raise RuntimeError(f"Unsupported architecture for OrcaSlicer AppImage: {machine}")


def _select_orca_asset(release: dict):
    arch = _orca_arch_pattern()
    matches = []
    for asset in release.get("assets", []):
        name = asset.get("name") or ""
        url = asset.get("browser_download_url") or ""
        lower = name.lower()
        if not url or not lower.endswith(".appimage") or "linux" not in lower:
            continue
        score = 0
        if arch == "x86_64":
            if "aarch64" in lower or "arm64" in lower:
                continue
            score += 10
        else:
            if not ("aarch64" in lower or "arm64" in lower):
                continue
            score += 10
        if "ubuntu2404" in lower:
            score += 3
        if "ubuntu" in lower:
            score += 2
        matches.append((score, name, url))
    matches.sort(reverse=True)
    if not matches:
        raise RuntimeError("No Linux AppImage asset found in the latest OrcaSlicer release.")
    return {"name": matches[0][1], "url": matches[0][2]}


def _validate_appimage_arch(path: str):
    machine = platform.machine().lower()
    with open(path, "rb") as f:
        header = f.read(20)
    if len(header) < 20 or header[:4] != b"\x7fELF":
        raise RuntimeError("Downloaded OrcaSlicer asset is not an ELF AppImage.")
    elf_machine = int.from_bytes(header[18:20], "little")
    if machine in {"x86_64", "amd64"} and elf_machine != 62:
        raise RuntimeError("Downloaded OrcaSlicer AppImage is not the x86_64 build.")
    if machine in {"aarch64", "arm64"} and elf_machine != 183:
        raise RuntimeError("Downloaded OrcaSlicer AppImage is not the ARM64 build.")


def _download_file(url: str, target: str):
    with requests.get(url, stream=True, timeout=(15, 120)) as response:
        response.raise_for_status()
        with open(target, "wb") as f:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)


def _write_orca_wrapper(wrapper_path: str):
    wrapper = """#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPDIR="$ROOT/squashfs-root"
HOME_ROOT="${ORCA_SLICER_HOME:-/mnt/klipper-farm/tools/orca-slicer/home}"

mkdir -p "$HOME_ROOT" "$HOME_ROOT/.config" "$HOME_ROOT/.cache"
export HOME="$HOME_ROOT"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME_ROOT/.config}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME_ROOT/.cache}"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"

if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a "$APPDIR/AppRun" "$@"
fi

exec "$APPDIR/AppRun" "$@"
"""
    with open(wrapper_path, "w", encoding="utf-8") as f:
        f.write(wrapper)
    os.chmod(wrapper_path, 0o755)


def _install_orca_slicer():
    install_dir = os.path.join(STORAGE_ROOT, "tools", "orca-slicer")
    download_dir = os.path.join(install_dir, "downloads")
    appimage_path = os.path.join(download_dir, "OrcaSlicer.AppImage")
    extract_dir = os.path.join(install_dir, "squashfs-root")
    wrapper_path = os.path.join(install_dir, "orca-slicer")

    os.makedirs(download_dir, exist_ok=True)
    os.makedirs(SETTINGS_DIR, exist_ok=True)

    release_url = f"https://api.github.com/repos/{ORCA_REPO}/releases/latest"
    release_response = requests.get(release_url, timeout=(15, 60))
    release_response.raise_for_status()
    release = release_response.json()
    asset = _select_orca_asset(release)

    _download_file(asset["url"], appimage_path)
    os.chmod(appimage_path, 0o755)
    _validate_appimage_arch(appimage_path)

    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir)
    result = subprocess.run(
        [appimage_path, "--appimage-extract"],
        cwd=install_dir,
        capture_output=True,
        text=True,
        timeout=900,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "AppImage extraction failed").strip())

    _write_orca_wrapper(wrapper_path)
    settings = _save_settings({"orca_binary_path": ORCA_BACKEND_PATH})
    health_result = subprocess.run(
        [wrapper_path, "--help"],
        capture_output=True,
        text=True,
        timeout=20,
    )
    health_output = (health_result.stdout or health_result.stderr or "").strip()
    health_available = health_result.returncode == 0 and ("OrcaSlicer" in health_output or "orca-slicer" in health_output.lower())
    return {
        "success": health_available,
        "installed": True,
        "asset": asset["name"],
        "download_url": asset["url"],
        "backend_path": ORCA_BACKEND_PATH,
        "storage_root": STORAGE_ROOT,
        "settings": settings,
        "health_check": {
            "returncode": health_result.returncode,
            "output": health_output.splitlines()[:5],
        },
    }


def _printer_gcode_dir(printer: Printer):
    return printer.gcode_path or os.path.join(PRINTERS_ROOT, printer.slug, "gcodes")


def _profile_config_paths(profile: Optional[SlicerProfile]):
    if not profile or not isinstance(profile.data, dict):
        return []
    config_file = profile.data.get("config_file")
    if isinstance(config_file, list):
        raw_paths = [str(item) for item in config_file]
    else:
        raw_paths = re.split(r"[;\n]+", str(config_file or ""))
    return [path.strip() for path in raw_paths if path and path.strip()]


def _profile_extra_args(profile: Optional[SlicerProfile]):
    if not profile or not isinstance(profile.data, dict):
        return []
    args = []
    extra_args = profile.data.get("extra_args")
    if isinstance(extra_args, list):
        for item in extra_args:
            args.extend(shlex.split(str(item)))
    return args


def _find_inherited_profile(path: Path, inherited_name: str):
    names = [inherited_name]
    if not inherited_name.endswith(".json"):
        names.append(f"{inherited_name}.json")
    for name in names:
        candidate = path.parent / name
        if candidate.exists():
            return candidate
    return None


def _flatten_orca_profile(path: str, work_dir: str):
    source = Path(path)
    if source.suffix.lower() != ".json" or not source.exists():
        return str(source)

    seen = set()

    def merge(current: Path):
        resolved = current.resolve()
        if resolved in seen:
            raise RuntimeError(f"Profile inheritance loop detected at {current}")
        seen.add(resolved)
        with open(current, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise RuntimeError(f"Invalid Orca profile file: {current}")

        inherited_name = data.get("inherits")
        parent = _find_inherited_profile(current, inherited_name) if inherited_name else None
        if parent:
            merged = merge(parent)
            merged.update(data)
            merged.pop("inherits", None)
            return merged
        return data

    merged_profile = merge(source)
    safe_stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", source.stem).strip("._-") or "profile"
    target = Path(work_dir) / f"{safe_stem}.flattened.json"
    with open(target, "w", encoding="utf-8") as f:
        json.dump(merged_profile, f, indent=2)
    return str(target)


def _profile_files(profile: Optional[SlicerProfile], work_dir: str):
    return [_flatten_orca_profile(path, work_dir) for path in _profile_config_paths(profile)]


def _orca_error_message(output: str):
    message = (output or "OrcaSlicer failed").strip()[:2000]
    if "Relative extruder addressing requires resetting the extruder position" in message:
        return (
            f"{message}\n\n"
            "OrcaSlicer did not receive a complete printer profile. Select printer, material and process "
            "profiles that point to Orca JSON profiles, or import a 3MF that already contains slicer settings."
        )
    return message


def _extract_gcode_metadata(path: str):
    metadata = extract_gcode_filament_metadata(path)
    return {
        "estimated_time": metadata.get("estimated_time"),
        "filament_used_mm": metadata.get("filament_used_mm"),
        "filament_used_cm3": metadata.get("filament_used_cm3"),
        "filament_used_g": metadata.get("filament_used_g"),
        "filament_diameter_mm": metadata.get("filament_diameter_mm"),
        "filament_density_g_cm3": metadata.get("filament_density_g_cm3"),
    }


@router.get("/settings", response_model=SlicerSettings)
async def get_slicer_settings():
    return _settings()


@router.post("/settings", response_model=SlicerSettings)
async def update_slicer_settings(settings: SlicerSettings):
    path = (settings.orca_binary_path or "").strip() or None
    return _save_settings({"orca_binary_path": path})


@router.get("/health")
async def slicer_health():
    path = _settings().get("orca_binary_path")
    if not path:
        return {
            "configured": False,
            "available": False,
            "detected_paths": DEFAULT_ORCA_PATHS,
            "message": "Install OrcaSlicer with the helper script or configure a binary path in Settings or Slicer.",
        }
    if not os.path.exists(path):
        return {"configured": True, "available": False, "message": f"Binary not found: {path}"}
    try:
        result = subprocess.run([path, "--help"], capture_output=True, text=True, timeout=10)
        output = (result.stdout or result.stderr).strip()
        available = result.returncode == 0 and ("OrcaSlicer" in output or "orca-slicer" in output.lower())
        return {
            "configured": True,
            "available": available,
            "path": path,
            "version": output.splitlines()[:3],
            "message": "OrcaSlicer answered CLI health check" if available else "OrcaSlicer returned an unexpected CLI response",
        }
    except Exception as exc:
        return {"configured": True, "available": False, "path": path, "message": str(exc)}


@router.get("/install-info")
async def slicer_install_info():
    storage_root = STORAGE_ROOT
    host_storage_hint = os.getenv("HOST_STORAGE_ROOT") or "<host-storage-root>"
    return {
        "engine": "OrcaSlicer",
        "licence": "AGPL-3.0",
        "official_repository": "https://github.com/OrcaSlicer/OrcaSlicer",
        "official_releases": "https://github.com/OrcaSlicer/OrcaSlicer/releases",
        "recommended_backend_path": ORCA_BACKEND_PATH,
        "storage_root": storage_root,
        "install_command": f"sudo bash scripts/install-orca-slicer.sh --storage-root {host_storage_hint}",
        "live_example": "sudo bash scripts/install-orca-slicer.sh --storage-root /data/compose/16/storage",
        "dev_example": "sudo bash scripts/install-orca-slicer.sh --storage-root /home/yawway/Printing-YAWWAY-dev-storage",
        "notes": [
            "The helper downloads the latest AppImage from the official GitHub release rather than bundling OrcaSlicer in this project.",
            "It extracts the AppImage into shared storage so the backend container can execute it without FUSE.",
            "It writes settings/slicer.json so the dashboard can auto-detect the runner path.",
            "The backend image includes the headless Linux runtime libraries required by the AppImage.",
        ],
    }


@router.post("/install")
async def install_slicer_engine(db: AsyncSession = Depends(get_db)):
    if ORCA_INSTALL_LOCK.locked():
        raise HTTPException(status_code=409, detail="OrcaSlicer install is already running. Wait for it to finish, then refresh.")

    async with ORCA_INSTALL_LOCK:
        db.add(Event(
            severity="info",
            event_type="slicer_install_started",
            message="OrcaSlicer server install started",
            details={"storage_root": STORAGE_ROOT, "backend_path": ORCA_BACKEND_PATH},
        ))
        await db.commit()
        try:
            result = await asyncio.to_thread(_install_orca_slicer)
        except Exception as exc:
            db.add(Event(
                severity="error",
                event_type="slicer_install_failed",
                message=f"OrcaSlicer server install failed: {exc}",
                details={
                    "what_failed": "OrcaSlicer server install",
                    "likely_cause": "The backend could not download the official AppImage, extract it, or write to central storage.",
                    "suggested_fix": "Check internet access from the server, free space, and write permissions on central storage, then try Install OrcaSlicer again.",
                    "error": str(exc),
                },
            ))
            await db.commit()
            raise HTTPException(status_code=500, detail=f"OrcaSlicer install failed: {exc}")

        install_ready = bool(result.get("success"))
        db.add(Event(
            severity="info" if install_ready else "warning",
            event_type="slicer_install_succeeded" if install_ready else "slicer_install_warning",
            message="OrcaSlicer server install completed" if install_ready else "OrcaSlicer server install completed but health check needs attention",
            details={
                "asset": result.get("asset"),
                "backend_path": result.get("backend_path"),
                "storage_root": result.get("storage_root"),
                "health_check": result.get("health_check"),
            },
        ))
        await db.commit()
        return result


@router.get("/profiles", response_model=list[SlicerProfileSchema])
async def list_profiles(profile_type: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    query = select(SlicerProfile).order_by(SlicerProfile.profile_type, SlicerProfile.name)
    if profile_type:
        query = query.where(SlicerProfile.profile_type == profile_type)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/profiles", response_model=SlicerProfileSchema)
async def create_profile(profile: SlicerProfileBase, db: AsyncSession = Depends(get_db)):
    if profile.profile_type not in {"printer", "filament", "process"}:
        raise HTTPException(status_code=400, detail="Profile type must be printer, filament or process")
    row = SlicerProfile(**profile.model_dump())
    db.add(row)
    await db.flush()
    return row


@router.put("/profiles/{profile_id}", response_model=SlicerProfileSchema)
async def update_profile(profile_id: int, profile: SlicerProfileBase, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SlicerProfile).where(SlicerProfile.id == profile_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found")
    for field, value in profile.model_dump().items():
        setattr(row, field, value)
    await db.flush()
    return row


@router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SlicerProfile).where(SlicerProfile.id == profile_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found")
    await db.delete(row)
    await db.flush()
    return {"status": "success"}


@router.get("/models", response_model=list[SlicerModelSchema])
async def list_models(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SlicerModel).order_by(desc(SlicerModel.created_at)))
    return [model for model in result.scalars().all() if _model_file_available(model)]


@router.post("/models/upload")
async def upload_model(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    filename = _safe_filename(file.filename)
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_MODEL_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only STL and 3MF uploads are supported")

    os.makedirs(MODELS_ROOT, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    target_path = os.path.join(MODELS_ROOT, f"{timestamp}_{filename}")
    if not is_path_within(target_path, MODELS_ROOT):
        raise HTTPException(status_code=403, detail="Access denied")
    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    row = SlicerModel(
        filename=filename,
        file_path=target_path,
        size=os.path.getsize(target_path),
        source_format=extension.lstrip("."),
    )
    db.add(row)
    db.add(Event(severity="info", event_type="slicer_model_upload", message=f"Slicer model uploaded: {filename}"))
    await db.flush()
    return row


@router.delete("/models/{model_id}")
async def delete_model(model_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SlicerModel).where(SlicerModel.id == model_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    if row.file_path and is_path_within(row.file_path, MODELS_ROOT) and os.path.exists(row.file_path):
        os.remove(row.file_path)
    await db.delete(row)
    await db.flush()
    return {"status": "success"}


@router.get("/models/{model_id}/download")
async def download_model(model_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SlicerModel).where(SlicerModel.id == model_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    if not _model_file_available(row):
        raise HTTPException(
            status_code=404,
            detail={
                "message": "Model file not found in central storage",
                "what_failed": "Slicer model download",
                "likely_cause": "The model database record points to a file that no longer exists under /mnt/klipper-farm/models.",
                "suggested_fix": "Upload the STL or 3MF file again, then select the new model from the Slicer page.",
            },
        )
    return FileResponse(row.file_path, filename=row.filename, media_type="application/octet-stream")


@router.get("/jobs", response_model=list[SlicerJobSchema])
async def list_jobs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SlicerJob).order_by(desc(SlicerJob.created_at)).limit(100))
    return result.scalars().all()


@router.get("/jobs/{job_id}", response_model=SlicerJobSchema)
async def get_job(job_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SlicerJob).where(SlicerJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Slicer job not found")
    return job


async def _queue_slicer_job(
    db: AsyncSession,
    model: SlicerModel,
    printer: Printer,
    printer_profile_id: Optional[int],
    filament_profile_id: Optional[int],
    process_profile_id: Optional[int],
    filament_spool_id: Optional[int],
    centre_on_bed: bool,
    slice_group_id: str,
):
    if model.source_format == "stl" and not (printer_profile_id and filament_profile_id and process_profile_id):
        raise HTTPException(
            status_code=400,
            detail="STL slicing needs printer, material and process profiles. Add or select Orca profiles first.",
        )
    if filament_spool_id:
        spool = (await db.execute(select(FilamentSpool).where(FilamentSpool.id == filament_spool_id))).scalar_one_or_none()
        if not spool:
            raise HTTPException(status_code=404, detail="Filament spool not found")

    job = SlicerJob(
        model_id=model.id,
        printer_id=printer.id,
        printer_profile_id=printer_profile_id,
        filament_profile_id=filament_profile_id,
        process_profile_id=process_profile_id,
        engine="orca",
        status="queued",
        message="Queued for OrcaSlicer",
        command={
            "centre_on_bed": centre_on_bed,
            "slice_group_id": slice_group_id,
            "filament_spool_id": filament_spool_id,
        },
    )
    db.add(job)
    db.add(Event(printer_id=printer.id, severity="info", event_type="slicer_job_queued", message=f"Queued slice for {model.filename}"))
    await db.flush()
    asyncio.create_task(run_slicer_job(job.id))
    return job


async def _resolve_profile_id(db: AsyncSession, requested_id: Optional[int], profile_type: str, printer_id: int):
    if requested_id:
        result = await db.execute(select(SlicerProfile).where(SlicerProfile.id == requested_id))
        profile = result.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail=f"{profile_type.title()} profile not found")
        if profile.profile_type != profile_type:
            raise HTTPException(status_code=400, detail=f"Profile {profile.name} is not a {profile_type} profile")
        if not profile.printer_id or profile.printer_id == printer_id:
            return profile.id

        fallback = (await db.execute(
            select(SlicerProfile)
            .where(SlicerProfile.profile_type == profile_type, SlicerProfile.printer_id == printer_id)
            .order_by(SlicerProfile.name)
        )).scalars().first()
        return fallback.id if fallback else None

    fallback = (await db.execute(
        select(SlicerProfile)
        .where(
            SlicerProfile.profile_type == profile_type,
            (SlicerProfile.printer_id == printer_id) | (SlicerProfile.printer_id.is_(None)),
        )
        .order_by(SlicerProfile.printer_id.is_(None), SlicerProfile.name)
    )).scalars().first()
    return fallback.id if fallback else None


@router.post("/jobs", response_model=SlicerJobSchema)
async def create_job(req: SlicerJobCreate, db: AsyncSession = Depends(get_db)):
    model = (await db.execute(select(SlicerModel).where(SlicerModel.id == req.model_id))).scalar_one_or_none()
    printer = (await db.execute(select(Printer).where(Printer.id == req.printer_id))).scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if not printer:
        raise HTTPException(status_code=404, detail="Printer not found")

    return await _queue_slicer_job(
        db,
        model,
        printer,
        req.printer_profile_id,
        req.filament_profile_id,
        req.process_profile_id,
        req.filament_spool_id,
        req.centre_on_bed,
        f"slicer-job-{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}-{req.model_id}-{req.printer_id}",
    )


@router.post("/jobs/batch", response_model=list[SlicerJobSchema])
async def create_batch_jobs(req: SlicerBatchJobCreate, db: AsyncSession = Depends(get_db)):
    model = (await db.execute(select(SlicerModel).where(SlicerModel.id == req.model_id))).scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    printer_ids = list(dict.fromkeys(req.printer_ids))
    if not printer_ids:
        raise HTTPException(status_code=400, detail="Select at least one printer")

    result = await db.execute(select(Printer).where(Printer.id.in_(printer_ids)).order_by(Printer.name))
    printers = result.scalars().all()
    if len(printers) != len(printer_ids):
        raise HTTPException(status_code=404, detail="One or more printers were not found")

    slice_group_id = f"slicer-batch-{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}-{req.model_id}"
    planned_jobs = []
    missing_profiles = []
    for printer in printers:
        printer_profile_id = await _resolve_profile_id(db, req.printer_profile_id, "printer", printer.id)
        filament_profile_id = await _resolve_profile_id(db, req.filament_profile_id, "filament", printer.id)
        process_profile_id = await _resolve_profile_id(db, req.process_profile_id, "process", printer.id)
        if model.source_format == "stl":
            missing = []
            if not printer_profile_id:
                missing.append("printer")
            if not filament_profile_id:
                missing.append("material")
            if not process_profile_id:
                missing.append("process")
            if missing:
                missing_profiles.append(f"{printer.name}: {', '.join(missing)}")
        planned_jobs.append((printer, printer_profile_id, filament_profile_id, process_profile_id))

    if missing_profiles:
        raise HTTPException(
            status_code=400,
            detail=f"Missing Orca profiles for {', '.join(missing_profiles)}",
        )

    jobs = []
    for printer, printer_profile_id, filament_profile_id, process_profile_id in planned_jobs:
        jobs.append(await _queue_slicer_job(
            db,
            model,
            printer,
            printer_profile_id,
            filament_profile_id,
            process_profile_id,
            req.filament_spool_id,
            req.centre_on_bed,
            slice_group_id,
        ))
    return jobs


@router.post("/jobs/{job_id}/cancel", response_model=SlicerJobSchema)
async def cancel_job(job_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SlicerJob).where(SlicerJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Slicer job not found")
    if job.status in {"completed", "failed"}:
        return job
    job.status = "cancelled"
    job.message = "Cancelled before or during execution"
    await db.flush()
    return job


async def run_slicer_job(job_id: int):
    async with AsyncSessionLocal() as db:
        try:
            job = (await db.execute(select(SlicerJob).where(SlicerJob.id == job_id))).scalar_one_or_none()
            if not job or job.status == "cancelled":
                return
            model = (await db.execute(select(SlicerModel).where(SlicerModel.id == job.model_id))).scalar_one()
            printer = (await db.execute(select(Printer).where(Printer.id == job.printer_id))).scalar_one()
            printer_profile = (await db.execute(select(SlicerProfile).where(SlicerProfile.id == job.printer_profile_id))).scalar_one_or_none() if job.printer_profile_id else None
            filament_profile = (await db.execute(select(SlicerProfile).where(SlicerProfile.id == job.filament_profile_id))).scalar_one_or_none() if job.filament_profile_id else None
            process_profile = (await db.execute(select(SlicerProfile).where(SlicerProfile.id == job.process_profile_id))).scalar_one_or_none() if job.process_profile_id else None
            job_options = job.command if isinstance(job.command, dict) else {}
            centre_on_bed = bool(job_options.get("centre_on_bed", True))
            slice_group_id = job_options.get("slice_group_id") or f"slicer-job-{job_id}"
            filament_spool_id = job_options.get("filament_spool_id")
            filament_spool = (await db.execute(
                select(FilamentSpool).where(FilamentSpool.id == filament_spool_id)
            )).scalar_one_or_none() if filament_spool_id else None

            binary = _settings().get("orca_binary_path")
            if not binary or not os.path.exists(binary):
                raise RuntimeError("OrcaSlicer binary path is not configured or cannot be found")

            output_dir = _printer_gcode_dir(printer)
            if not is_path_within(output_dir, PRINTERS_ROOT):
                raise RuntimeError("Printer G-code path is outside managed printer storage")
            os.makedirs(output_dir, exist_ok=True)

            tmp_root = os.path.join(STORAGE_ROOT, "tmp")
            os.makedirs(tmp_root, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix=f"slicer-job-{job_id}-", dir=tmp_root) as profile_work_dir:
                job_output_dir = os.path.join(profile_work_dir, "output")
                os.makedirs(job_output_dir, exist_ok=True)
                settings_files = [
                    *_profile_files(printer_profile, profile_work_dir),
                    *_profile_files(process_profile, profile_work_dir),
                ]
                filament_files = _profile_files(filament_profile, profile_work_dir)
                extra_args = [
                    *_profile_extra_args(printer_profile),
                    *_profile_extra_args(filament_profile),
                    *_profile_extra_args(process_profile),
                ]

                command = [
                    binary,
                    "--slice",
                    "0",
                    "--outputdir",
                    job_output_dir,
                ]
                if centre_on_bed:
                    command.extend(["--arrange", "1", "--ensure-on-bed"])
                if settings_files:
                    command.extend(["--load-settings", ";".join(settings_files)])
                if filament_files:
                    command.extend(["--load-filaments", ";".join(filament_files)])
                command.extend(extra_args)
                command.append(model.file_path)

                job.status = "running"
                job.message = "Running OrcaSlicer"
                job.command = {"argv": command, "options": job_options}
                await db.commit()

                def _run():
                    return subprocess.run(command, capture_output=True, text=True, timeout=1800)

                result = await asyncio.to_thread(_run)
                if result.returncode != 0:
                    raise RuntimeError(_orca_error_message(result.stderr or result.stdout))

                generated_files = sorted(Path(job_output_dir).glob("*.gcode"), key=lambda path: path.stat().st_mtime, reverse=True)
                if not generated_files:
                    raise RuntimeError("OrcaSlicer completed but no G-code file was found")

                output_path = _unique_gcode_path(output_dir, model, printer)
                shutil.move(str(generated_files[0]), output_path)
            metadata = _extract_gcode_metadata(output_path)
            usage_g = estimate_usage_g(metadata, filament_spool)
            if usage_g is not None:
                metadata["filament_used_g"] = round(usage_g, 3)
            meta_path = f"{output_path}.meta.json"
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump({
                    "slice_group_id": slice_group_id,
                    "source_model_id": model.id,
                    "source_model": model.filename,
                    "target_printer_id": printer.id,
                    "target_printer": printer.name,
                    "profiles": {
                        "printer": printer_profile.name if printer_profile else None,
                        "filament": filament_profile.name if filament_profile else None,
                        "process": process_profile.name if process_profile else None,
                    },
                    "filament_spool_id": filament_spool.id if filament_spool else None,
                    "filament_spool": filament_spool.name if filament_spool else None,
                    **metadata,
                }, f, indent=2)

            job.status = "completed"
            job.message = "Slice complete; G-code saved to the G-code Hub"
            job.output_path = output_path
            job.estimated_time = metadata["estimated_time"]
            job.filament_used_mm = metadata["filament_used_mm"]
            db.add(Event(printer_id=printer.id, severity="info", event_type="slicer_job_completed", message=f"Slice completed for {model.filename}"))
            await db.commit()
        except Exception as exc:
            job = (await db.execute(select(SlicerJob).where(SlicerJob.id == job_id))).scalar_one_or_none()
            if job:
                job.status = "failed"
                job.message = str(exc)
                db.add(Event(printer_id=job.printer_id, severity="error", event_type="slicer_job_failed", message=f"Slice failed: {exc}"))
                await db.commit()
