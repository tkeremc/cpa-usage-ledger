#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON:-python3}"
PYTHON_CONFIG_BIN="${PYTHON_CONFIG:-python3-config}"
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) ARCH=amd64 ;;
  Linux/aarch64) ARCH=arm64 ;;
  *) echo 'Only Linux x86_64 and aarch64 builds are supported.' >&2; exit 1 ;;
esac
TARGET="$SOURCE_DIR/dist/linux/$ARCH/cpa-usage-ledger.so"
PYTHON_LIBRARY="$("$PYTHON_BIN" -c 'import os,sysconfig; print(os.path.join(sysconfig.get_config_var("LIBDIR"), sysconfig.get_config_var("LDLIBRARY")))')"
if [[ ! -f "$PYTHON_LIBRARY" ]]; then
  echo 'A shared CPython library and matching development headers are required.' >&2
  exit 1
fi
mkdir -p -- "$(dirname -- "$TARGET")"
# python-config emits compiler flags, so word splitting is intentional here.
read -r -a PYTHON_INCLUDE_FLAGS <<< "$("$PYTHON_CONFIG_BIN" --includes)"
read -r -a PYTHON_LINK_FLAGS <<< "$("$PYTHON_CONFIG_BIN" --embed --ldflags)"
"${CC:-gcc}" -shared -fPIC -O2 -Wall -Wextra -Werror -fvisibility=hidden \
  "${PYTHON_INCLUDE_FLAGS[@]}" \
  "-DPLUGIN_SOURCE_DIR=\"$SOURCE_DIR\"" \
  "-DPLUGIN_PYTHON_LIBRARY=\"$PYTHON_LIBRARY\"" \
  "$SOURCE_DIR/bridge.c" -o "$TARGET.new" \
  "${PYTHON_LINK_FLAGS[@]}" -lpthread -ldl
chmod 700 "$TARGET.new"
mv -- "$TARGET.new" "$TARGET"
printf 'Built: %s\n' "$TARGET"
