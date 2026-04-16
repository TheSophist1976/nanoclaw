#!/bin/bash
# Sentinel nmap scan — runs on HOST via systemd timer.
# Scans the LAN for hosts, open ports, and service versions.
# Compares against yesterday's baseline using ndiff.
# Writes results to ~/Documents/Mark-main/Security/nmap/
#
# Requires: nmap, node

set -euo pipefail

# Ensure node is on PATH (nvm doesn't load under sudo)
export PATH="/home/sophist/.nvm/versions/node/v22.22.2/bin:$PATH"

SCAN_DIR="/home/sophist/Documents/Mark-main/Security/nmap"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUBNET="192.168.50.0/24"
TODAY=$(date +%Y-%m-%d)

mkdir -p "$SCAN_DIR"

# --- 1. Host discovery ---
echo "[sentinel] Host discovery on $SUBNET..."
nmap -sn "$SUBNET" -oX "$SCAN_DIR/hosts-${TODAY}.xml" >/dev/null 2>&1

# --- 2. Extract live host IPs ---
LIVE_HOSTS=$(grep -oP 'addr="\K[0-9.]+' "$SCAN_DIR/hosts-${TODAY}.xml" | sort -t. -k4 -n | uniq)
HOST_COUNT=$(echo "$LIVE_HOSTS" | wc -l)
echo "[sentinel] Found $HOST_COUNT hosts"

# --- 3. Port scan + service version on all live hosts ---
echo "[sentinel] Port scan + service detection on $HOST_COUNT hosts..."
nmap -sS -sV -F $LIVE_HOSTS -oX "$SCAN_DIR/ports-${TODAY}.xml" >/dev/null 2>&1

# --- 4. Ndiff against yesterday ---
YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
HOST_DIFF_FILE="$SCAN_DIR/.host-diff"
PORT_DIFF_FILE="$SCAN_DIR/.port-diff"
rm -f "$HOST_DIFF_FILE" "$PORT_DIFF_FILE"

if [ -f "$SCAN_DIR/hosts-${YESTERDAY}.xml" ]; then
  ndiff "$SCAN_DIR/hosts-${YESTERDAY}.xml" "$SCAN_DIR/hosts-${TODAY}.xml" > "$HOST_DIFF_FILE" 2>/dev/null || true
fi

if [ -f "$SCAN_DIR/ports-${YESTERDAY}.xml" ]; then
  ndiff "$SCAN_DIR/ports-${YESTERDAY}.xml" "$SCAN_DIR/ports-${TODAY}.xml" > "$PORT_DIFF_FILE" 2>/dev/null || true
fi

# --- 5. Parse into JSON ---
echo "[sentinel] Parsing results..."
node "$SCRIPT_DIR/parse-nmap.mjs" \
  "$SCAN_DIR/hosts-${TODAY}.xml" \
  "$SCAN_DIR/ports-${TODAY}.xml" \
  "$HOST_DIFF_FILE" \
  "$PORT_DIFF_FILE" \
  > "$SCAN_DIR/latest.json"

cp "$SCAN_DIR/latest.json" "$SCAN_DIR/scan-${TODAY}.json"

echo "[sentinel] Scan complete. Results in $SCAN_DIR/latest.json"

# --- 6. Fix ownership so container agent can read ---
chown -R sophist:sophist "$SCAN_DIR"

# --- 7. Clean up scans older than 30 days ---
find "$SCAN_DIR" -name "*.xml" -mtime +30 -delete 2>/dev/null || true
find "$SCAN_DIR" -name "scan-*.json" -mtime +30 -delete 2>/dev/null || true
