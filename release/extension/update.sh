#!/usr/bin/env bash
set -e
echo "===================================================="
echo "  Blackboarder - Academic Companion Auto-Updater"
echo "===================================================="
TARGET_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
TEMP_ZIP="/tmp/blackboarder-update-$$.zip"
ZIP_URL="https://raw.githubusercontent.com/yvs1n/blackboarder/main/release/blackboarder-extension.zip"

echo "[1/2] Downloading latest extension files from GitHub..."
curl -fsSL -o "$TEMP_ZIP" "$ZIP_URL"

echo "[2/2] Updating extension files in place..."
unzip -o -q "$TEMP_ZIP" -d "$TARGET_DIR"
rm -f "$TEMP_ZIP"

echo ""
echo "===================================================="
echo "  SUCCESS! Blackboarder is updated to latest code!"
echo "  All tasks, courses, and your Sync Key are intact."
echo "===================================================="
