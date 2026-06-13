import math
import re
from collections import deque
from typing import Any, Optional


FILAMENT_DEFAULT_DENSITIES = {
    "PLA": 1.24,
    "PLA+": 1.24,
    "PETG": 1.27,
    "ABS": 1.04,
    "ASA": 1.07,
    "TPU": 1.21,
    "NYLON": 1.14,
    "PA": 1.14,
    "PC": 1.20,
}


NUMBER_RE = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)")


def default_density_for_material(material: Optional[str]) -> float:
    return FILAMENT_DEFAULT_DENSITIES.get((material or "").strip().upper(), 1.24)


def _first_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = NUMBER_RE.search(str(value))
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def grams_from_length(length_mm: Optional[float], diameter_mm: Optional[float], density_g_cm3: Optional[float]) -> Optional[float]:
    if not length_mm or length_mm <= 0:
        return None
    diameter = diameter_mm or 1.75
    density = density_g_cm3 or 1.24
    radius = diameter / 2
    volume_mm3 = math.pi * radius * radius * length_mm
    volume_cm3 = volume_mm3 / 1000
    return volume_cm3 * density


def estimate_usage_g(metadata: dict[str, Any], spool: Any = None) -> Optional[float]:
    direct = _first_float(metadata.get("filament_used_g"))
    if direct is not None and direct >= 0:
        return direct

    cm3 = _first_float(metadata.get("filament_used_cm3"))
    if cm3 is not None and cm3 >= 0:
        density = (
            getattr(spool, "density_g_cm3", None)
            or _first_float(metadata.get("filament_density_g_cm3"))
            or 1.24
        )
        return cm3 * density

    length_mm = _first_float(metadata.get("filament_used_mm"))
    diameter = (
        getattr(spool, "diameter_mm", None)
        or _first_float(metadata.get("filament_diameter_mm"))
        or 1.75
    )
    density = (
        getattr(spool, "density_g_cm3", None)
        or _first_float(metadata.get("filament_density_g_cm3"))
        or 1.24
    )
    return grams_from_length(length_mm, diameter, density)


def extract_gcode_filament_metadata(path: str, scan_lines: int = 1200) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "estimated_time": None,
        "filament_used_mm": None,
        "filament_used_cm3": None,
        "filament_used_g": None,
        "filament_diameter_mm": None,
        "filament_density_g_cm3": None,
    }

    def process_line(line: str):
        lower = line.lower()
        value = _first_float(line.split("=", 1)[-1] if "=" in line else line.split(":", 1)[-1])

        if metadata["estimated_time"] is None and (
            "estimated printing time" in lower or "estimated print time" in lower
        ):
            metadata["estimated_time"] = line.split(":", 1)[-1].strip(" ;\n\r\t")
        if metadata["filament_used_mm"] is None and "filament used" in lower and "[mm]" in lower:
            metadata["filament_used_mm"] = value
        if metadata["filament_used_cm3"] is None and "filament used" in lower and "[cm3]" in lower:
            metadata["filament_used_cm3"] = value
        if metadata["filament_used_g"] is None and (
            ("filament used" in lower and "[g]" in lower)
            or "filament weight" in lower
            or "total filament weight" in lower
        ):
            metadata["filament_used_g"] = value
        if metadata["filament_density_g_cm3"] is None and "filament_density" in lower:
            metadata["filament_density_g_cm3"] = value
        if metadata["filament_diameter_mm"] is None and "filament_diameter" in lower:
            metadata["filament_diameter_mm"] = value

    try:
        tail = deque(maxlen=scan_lines)
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for line_number, line in enumerate(f):
                if line_number < scan_lines:
                    process_line(line)
                tail.append(line)
        for line in tail:
            process_line(line)
    except OSError:
        pass

    estimated = estimate_usage_g(metadata)
    if estimated is not None and metadata["filament_used_g"] is None:
        metadata["filament_used_g"] = round(estimated, 3)

    return {key: value for key, value in metadata.items() if value is not None}
