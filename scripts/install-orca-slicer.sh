#!/usr/bin/env bash
set -euo pipefail

REPO="OrcaSlicer/OrcaSlicer"
STORAGE_ROOT=""
VERSION="latest"
ASSET_URL=""
BACKEND_PATH="/mnt/klipper-farm/tools/orca-slicer/orca-slicer"

usage() {
  cat <<'USAGE'
Install OrcaSlicer as an external engine for Klipper Farm.

This downloads the official OrcaSlicer AppImage from GitHub, extracts it into
the dashboard's shared storage, creates a headless wrapper, and writes
settings/slicer.json so the backend can auto-detect it.

Usage:
  sudo bash scripts/install-orca-slicer.sh --storage-root /data/compose/16/storage

Options:
  --storage-root PATH   Host path mounted as /mnt/klipper-farm in the backend container.
  --version TAG         GitHub release tag, for example v2.3.2. Defaults to latest.
  --asset-url URL       Use a specific AppImage URL instead of GitHub release discovery.
  --backend-path PATH   Path visible inside the backend container.
  -h, --help            Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --storage-root)
      STORAGE_ROOT="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-latest}"
      shift 2
      ;;
    --asset-url)
      ASSET_URL="${2:-}"
      shift 2
      ;;
    --backend-path)
      BACKEND_PATH="${2:-$BACKEND_PATH}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$STORAGE_ROOT" ]]; then
  echo "Missing --storage-root" >&2
  usage
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required. Install it with: sudo apt install -y curl" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required. Install it with: sudo apt install -y python3" >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64)
    ARCH_PATTERN='(x86_64|amd64|ubuntu)'
    ;;
  aarch64|arm64)
    ARCH_PATTERN='(aarch64|arm64)'
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

INSTALL_DIR="$STORAGE_ROOT/tools/orca-slicer"
SETTINGS_DIR="$STORAGE_ROOT/settings"
DOWNLOAD_DIR="$INSTALL_DIR/downloads"
APPIMAGE="$DOWNLOAD_DIR/OrcaSlicer.AppImage"
EXTRACT_DIR="$INSTALL_DIR/squashfs-root"
WRAPPER="$INSTALL_DIR/orca-slicer"

mkdir -p "$DOWNLOAD_DIR" "$SETTINGS_DIR"

if [[ -z "$ASSET_URL" ]]; then
  if [[ "$VERSION" == "latest" ]]; then
    API_URL="https://api.github.com/repos/$REPO/releases/latest"
  else
    API_URL="https://api.github.com/repos/$REPO/releases/tags/$VERSION"
  fi

  echo "Finding OrcaSlicer AppImage from $API_URL"
  RELEASE_JSON="$(curl -fsSL "$API_URL")"
  ASSET_URL="$(printf '%s' "$RELEASE_JSON" | python3 -c '
import json
import re
import sys

arch_pattern = sys.argv[1]
release = json.load(sys.stdin)
assets = release.get("assets", [])
matches = []
for asset in assets:
    name = asset.get("name", "")
    url = asset.get("browser_download_url", "")
    lower = name.lower()
    if not url or "appimage" not in lower:
        continue
    if "linux" not in lower:
        continue
    score = 0
    if re.search(arch_pattern, lower):
        score += 10
    if "ubuntu2404" in lower:
        score += 3
    if "ubuntu" in lower:
        score += 2
    matches.append((score, name, url))

matches.sort(reverse=True)
if not matches:
    raise SystemExit("No Linux AppImage asset found in the selected release.")
print(matches[0][2])
' "$ARCH_PATTERN")"
fi

echo "Downloading $ASSET_URL"
curl -fL "$ASSET_URL" -o "$APPIMAGE"
chmod +x "$APPIMAGE"

echo "Extracting AppImage into $INSTALL_DIR"
rm -rf "$EXTRACT_DIR"
(
  cd "$INSTALL_DIR"
  "$APPIMAGE" --appimage-extract >/dev/null
)

cat > "$WRAPPER" <<'WRAPPER'
#!/usr/bin/env bash
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
WRAPPER
chmod +x "$WRAPPER"

python3 - "$SETTINGS_DIR/slicer.json" "$BACKEND_PATH" <<'PY'
import json
import os
import sys

settings_path, backend_path = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(settings_path), exist_ok=True)
settings = {}
try:
    with open(settings_path, "r", encoding="utf-8") as f:
        settings = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    pass

settings["orca_binary_path"] = backend_path
with open(settings_path, "w", encoding="utf-8") as f:
    json.dump(settings, f, indent=2)
PY

echo
echo "OrcaSlicer external engine installed."
echo "Host wrapper:    $WRAPPER"
echo "Backend path:    $BACKEND_PATH"
echo "Settings file:   $SETTINGS_DIR/slicer.json"
echo
echo "Open the dashboard Slicer page and press Refresh. If the health check fails,"
echo "check backend container logs for any missing Linux runtime libraries."
