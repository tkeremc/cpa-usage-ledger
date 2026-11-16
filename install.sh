#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo 'Usage: bash install.sh PLUGINS_DIR [PATH_TO_MANAGEMENT_HTML]' >&2
  exit 1
fi
PLUGINS_DIR="$1"
PANEL_FILE="${2:-$HOME/.cli-proxy-api/static/management.html}"
if [[ "$PLUGINS_DIR" != /* ]]; then
  echo 'PLUGINS_DIR must be an absolute path.' >&2; exit 1
fi
bash "$SOURCE_DIR/build.sh"
"${PYTHON:-python3}" -B "$SOURCE_DIR/patch_management.py" --panel "$PANEL_FILE"
case "$(uname -m)" in x86_64) ARCH=amd64 ;; aarch64) ARCH=arm64 ;; *) exit 1 ;; esac
mkdir -p -- "$PLUGINS_DIR/linux/$ARCH"
install -m 700 "$SOURCE_DIR/dist/linux/$ARCH/cpa-usage-ledger.so" "$PLUGINS_DIR/linux/$ARCH/cpa-usage-ledger.so.new"
mv -- "$PLUGINS_DIR/linux/$ARCH/cpa-usage-ledger.so.new" "$PLUGINS_DIR/linux/$ARCH/cpa-usage-ledger.so"
echo 'Installed. Merge config.example.yaml into your CPA config before restarting CPA.'
echo 'Keep management.disable-auto-update-panel=true to preserve the session integration.'
echo 'Then restart CPA and reload the MAIN Management Center page.'
