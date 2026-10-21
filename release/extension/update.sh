#!/usr/bin/env bash
set -e
echo "===================================================="
echo "  Blackboarder - Academic Companion Auto-Updater"
echo "===================================================="
TARGET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
# The repository archive always exists; the built extension lives in its dist/ folder.
ZIP_URL="https://github.com/yvs1n/blackboarder/archive/refs/heads/main.zip"

echo "[1/2] Downloading latest extension files from GitHub..."
curl -fsSL -o "$WORK_DIR/update.zip" "$ZIP_URL"
unzip -q "$WORK_DIR/update.zip" -d "$WORK_DIR/src"

SRC_DIST="$(find "$WORK_DIR/src" -maxdepth 2 -type d -name dist | head -n 1)"
if [ -z "$SRC_DIST" ] || [ ! -f "$SRC_DIST/manifest.json" ]; then
  echo "[ERROR] The downloaded archive does not contain a built extension (dist/manifest.json)."
  exit 1
fi

echo "[2/2] Updating extension files in place..."
cp -R "$SRC_DIST"/. "$TARGET_DIR"/

echo ""
echo "===================================================="
echo "  SUCCESS! Blackboarder is updated to latest code!"
echo "  All tasks, courses, and your Sync Key are intact."
echo "===================================================="
