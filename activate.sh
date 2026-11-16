#!/usr/bin/env bash
# Optional convenience helper for existing systemd user-service installations.
set -euo pipefail
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"${PYTHON:-python3}" -B "$SOURCE_DIR/patch_management.py" "$@"
systemctl --user restart "${CPA_SERVICE:-cliproxyapi.service}"
echo 'CPA restarted. Reload the MAIN Management Center page (Ctrl+Shift+R).'
echo 'Open Plugins → CPA Usage Ledger → Usage history.'
