#!/usr/bin/env bash
# Local headless harness for Manunggal. Test-only; not shipped.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="${MG_TEST_BASE:-/tmp/opencode/mgtest}"
DATA="$BASE/data"
CONFIG="$BASE/config"
CACHE="$BASE/cache"
RUNTIME="$BASE/runtime"
OUT="$BASE/out"
LOG="$BASE/shell.log"
MONITOR="${MG_TEST_MONITOR:-1280x800}"
TEXT_SCALE="${MG_TEST_TEXT_SCALE:-1.0}"

rm -rf "$BASE"
mkdir -p "$DATA/gnome-shell/extensions" "$CONFIG" "$CACHE" "$RUNTIME" "$OUT/shots"
chmod 700 "$RUNTIME"

ln -s "$ROOT" "$DATA/gnome-shell/extensions/manunggal@lurim412"
ln -s "$ROOT/tools/harness/mgtest@local" "$DATA/gnome-shell/extensions/mgtest@local"

glib-compile-schemas --strict "$ROOT/schemas"

export XDG_DATA_HOME="$DATA"
export XDG_CONFIG_HOME="$CONFIG"
export XDG_CACHE_HOME="$CACHE"
export XDG_RUNTIME_DIR="$RUNTIME"
export GSETTINGS_BACKEND=dconf
export MG_TEST_OUT="$OUT"
export MG_TEST_MONITOR="$MONITOR"
export MG_TEST_TEXT_SCALE="$TEXT_SCALE"
export GI_TYPELIB_PATH=/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/mutter-18
export LD_LIBRARY_PATH=/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/mutter-18

dbus-run-session -- bash -euo pipefail -c '
    gsettings set org.gnome.shell enabled-extensions "[\"manunggal@lurim412\", \"mgtest@local\"]" || true
    gsettings set org.gnome.shell disable-user-extensions false || true
    gsettings set org.gnome.desktop.interface text-scaling-factor "$MG_TEST_TEXT_SCALE" || true
    gnome-shell --headless --no-x11 --virtual-monitor "$MG_TEST_MONITOR" >"$MG_TEST_OUT/../shell.log" 2>&1 &
    shell_pid=$!
    for i in $(seq 1 120); do
        if [ -f "$MG_TEST_OUT/report.json" ]; then
            # Give the report one more moment to be complete.
            sleep 1
            break
        fi
        if ! kill -0 "$shell_pid" 2>/dev/null; then
            echo "shell exited early" >&2
            break
        fi
        sleep 1
    done
    if kill -0 "$shell_pid" 2>/dev/null; then
        kill "$shell_pid" 2>/dev/null || true
        wait "$shell_pid" 2>/dev/null || true
    fi
'

echo "--- report ---"
cat "$OUT/report.json" 2>/dev/null || echo "no report"
echo "--- shell log (filtered) ---"
grep -E "mgtest|Manunggal|manunggal|Error|ERROR|CRITICAL|WARNING" "$LOG" | tail -80 || true
echo "--- screenshots ---"
ls -la "$OUT/shots"
