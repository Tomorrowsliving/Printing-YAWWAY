import datetime
import json
import os
import shutil
from pathlib import Path

BACKUP_ROOT = os.getenv("BACKUP_PATH", "/mnt/klipper-farm/backups")
PRINTERS_ROOT = os.getenv("PRINTERS_PATH", "/mnt/klipper-farm/printers")
FILE_EDIT_BACKUP_TYPE = "file-edit"
FILE_EDIT_BACKUP_DIR = "file-edits"
BACKUP_SETTINGS_FILE = "backup-settings.json"
DEFAULT_FILE_BACKUP_LIMIT = 5
DEFAULT_FARM_BACKUP_RETENTION = 14


def _safe_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def is_path_within(path, root):
    try:
        return os.path.commonpath([os.path.abspath(path), os.path.abspath(root)]) == os.path.abspath(root)
    except ValueError:
        return False


def is_backup_filename(filename):
    return filename.endswith(".bak")


def is_config_filename(filename):
    return filename.endswith((".cfg", ".conf"))


def should_create_edit_backup(path):
    return is_config_filename(os.path.basename(path)) and not is_backup_filename(os.path.basename(path))


def get_backup_settings():
    default_limit = _safe_int(os.getenv("FILE_BACKUP_LIMIT"), DEFAULT_FILE_BACKUP_LIMIT)
    settings = {
        "file_backup_limit": max(0, default_limit),
        "automatic_enabled": os.getenv("BACKUP_AUTOMATIC_ENABLED", "true").lower() not in ("0", "false", "no"),
        "scheduled_time": os.getenv("BACKUP_SCHEDULED_TIME", "02:00"),
        "farm_backup_retention": max(1, _safe_int(os.getenv("FARM_BACKUP_RETENTION"), DEFAULT_FARM_BACKUP_RETENTION)),
    }
    settings_path = os.path.join(BACKUP_ROOT, BACKUP_SETTINGS_FILE)

    try:
        with open(settings_path, "r") as f:
            saved = json.load(f)
            settings["file_backup_limit"] = max(0, _safe_int(saved.get("file_backup_limit"), settings["file_backup_limit"]))
            settings["automatic_enabled"] = bool(saved.get("automatic_enabled", settings["automatic_enabled"]))
            settings["scheduled_time"] = str(saved.get("scheduled_time") or settings["scheduled_time"])
            settings["farm_backup_retention"] = max(1, _safe_int(saved.get("farm_backup_retention"), settings["farm_backup_retention"]))
    except FileNotFoundError:
        pass
    except (OSError, json.JSONDecodeError):
        pass

    return settings


def save_backup_settings(file_backup_limit, automatic_enabled=None, scheduled_time=None, farm_backup_retention=None):
    os.makedirs(BACKUP_ROOT, exist_ok=True)
    current = get_backup_settings()
    settings = {
        "file_backup_limit": max(0, _safe_int(file_backup_limit, current["file_backup_limit"])),
        "automatic_enabled": current["automatic_enabled"] if automatic_enabled is None else bool(automatic_enabled),
        "scheduled_time": scheduled_time or current["scheduled_time"],
        "farm_backup_retention": max(1, _safe_int(farm_backup_retention, current["farm_backup_retention"])),
    }
    settings_path = os.path.join(BACKUP_ROOT, BACKUP_SETTINGS_FILE)
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)
    return settings


def file_edit_backup_root():
    return os.path.join(BACKUP_ROOT, FILE_EDIT_BACKUP_DIR)


def original_relpath_for_backup_path(backup_path):
    backup_abs = os.path.abspath(backup_path)
    root_abs = os.path.abspath(file_edit_backup_root())
    if not is_path_within(backup_abs, root_abs):
        raise ValueError("Backup is outside the file edit backup directory")

    parts = Path(os.path.relpath(backup_abs, root_abs)).parts
    if len(parts) < 2:
        raise ValueError("Invalid file edit backup path")

    original_filename = parts[-2]
    original_dir_parts = parts[:-2]
    return os.path.join(*original_dir_parts, original_filename) if original_dir_parts else original_filename


def target_path_for_backup(backup_path):
    return os.path.join(PRINTERS_ROOT, original_relpath_for_backup_path(backup_path))


def _backup_dir_for_original(original_path):
    rel_path = os.path.relpath(original_path, PRINTERS_ROOT)
    return os.path.join(file_edit_backup_root(), os.path.dirname(rel_path), os.path.basename(original_path))


def create_file_edit_backup(original_path):
    settings = get_backup_settings()
    limit = settings["file_backup_limit"]
    if limit == 0 or not should_create_edit_backup(original_path) or not os.path.exists(original_path):
        return None, []

    backup_dir = _backup_dir_for_original(original_path)
    os.makedirs(backup_dir, exist_ok=True)

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_filename = f"{timestamp}_{os.path.basename(original_path)}.bak"
    backup_path = os.path.join(backup_dir, backup_filename)
    shutil.copy2(original_path, backup_path)

    return backup_path, prune_file_edit_backups(original_path, limit)


def prune_file_edit_backups(original_path, limit):
    if limit <= 0:
        limit = 0

    backup_dir = _backup_dir_for_original(original_path)
    if not os.path.isdir(backup_dir):
        return []

    backups = [
        os.path.join(backup_dir, name)
        for name in os.listdir(backup_dir)
        if is_backup_filename(name) and os.path.isfile(os.path.join(backup_dir, name))
    ]
    backups.sort(key=lambda path: os.path.getmtime(path), reverse=True)

    removed = []
    for old_path in backups[limit:]:
        os.remove(old_path)
        removed.append(old_path)
    return removed


def prune_all_file_edit_backups(limit):
    root = file_edit_backup_root()
    if not os.path.isdir(root):
        return []

    removed = []
    for dirpath, _, filenames in os.walk(root):
        backup_names = [name for name in filenames if is_backup_filename(name)]
        if not backup_names:
            continue

        backup_paths = [os.path.join(dirpath, name) for name in backup_names]
        backup_paths.sort(key=lambda path: os.path.getmtime(path), reverse=True)
        for old_path in backup_paths[max(0, limit):]:
            os.remove(old_path)
            removed.append(old_path)

    return removed


def restore_file_edit_backup(backup_path):
    target_path = target_path_for_backup(backup_path)
    if not is_path_within(target_path, PRINTERS_ROOT):
        raise ValueError("Restore target is outside printer storage")
    if not os.path.exists(backup_path):
        raise FileNotFoundError("Backup file not found")

    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    shutil.copy2(backup_path, target_path)
    return target_path


def move_legacy_sidecar_backup(path):
    if not is_backup_filename(os.path.basename(path)) or not is_path_within(path, PRINTERS_ROOT):
        return None

    directory = os.path.dirname(path)
    original_name = os.path.basename(path)
    while original_name.endswith(".bak"):
        original_name = original_name[:-4]

    if not is_config_filename(original_name):
        return None

    original_path = os.path.join(directory, original_name)
    backup_dir = _backup_dir_for_original(original_path)
    os.makedirs(backup_dir, exist_ok=True)

    timestamp = datetime.datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y%m%d_%H%M%S_%f")
    backup_path = os.path.join(backup_dir, f"{timestamp}_{original_name}.bak")
    counter = 1
    while os.path.exists(backup_path):
        backup_path = os.path.join(backup_dir, f"{timestamp}_{counter}_{original_name}.bak")
        counter += 1

    shutil.move(path, backup_path)
    return backup_path


def find_legacy_sidecar_backups():
    if not os.path.isdir(PRINTERS_ROOT):
        return []

    legacy_paths = []
    for dirpath, _, filenames in os.walk(PRINTERS_ROOT):
        for filename in filenames:
            if is_backup_filename(filename):
                legacy_paths.append(os.path.join(dirpath, filename))
    return legacy_paths
