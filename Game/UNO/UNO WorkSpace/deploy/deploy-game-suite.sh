#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s /absolute/path/to/the-existing-UNO-project\n' "$0" >&2
  exit 2
fi

APP_DIR=${1%/}
PACKAGE_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STAMP=$(date +%Y%m%d-%H%M%S)
APP_USER=${LAYUDOWN_APP_USER:-${SUDO_USER:-$(id -un)}}
APP_GROUP=$(id -gn "$APP_USER")
DATA_DIR=${UNO_DATA_DIR:-$APP_DIR/data}
NODE_BIN=$(command -v node || true)
NGINX_INCLUDE_DIR=${LAYUDOWN_NGINX_INCLUDE_DIR:-/etc/nginx/conf.d}
NGINX_FILE=${LAYUDOWN_NGINX_FILE:-$NGINX_INCLUDE_DIR/layudown-gamesuite.conf}
UNIT_FILE=${LAYUDOWN_UNIT_FILE:-/etc/systemd/system/layudown-shogi.service}
BACKUP_DIR="$APP_DIR/.layudown-backups/$STAMP"
NEXT="$APP_DIR/.dist.next-$STAMP"
ROLLBACK_SCRIPT="$PACKAGE_ROOT/deploy/rollback-game-suite.sh"
SWAP_STARTED=0
OLD="$APP_DIR/.dist.old-$STAMP"

case "$APP_DIR:$DATA_DIR:$NGINX_INCLUDE_DIR" in
  /*:/*:/*) ;;
  *) printf 'Project, account data, and Nginx paths must be absolute.\n' >&2; exit 2 ;;
esac
if [[ "$APP_DIR" == "/" || "$APP_DIR" == *[[:space:]]* || "$DATA_DIR" == *[[:space:]]* ]]; then
  printf 'Project and account data paths must not contain whitespace.\n' >&2
  exit 2
fi
[[ -d "$APP_DIR" ]] || { printf 'Existing project directory does not exist.\n' >&2; exit 1; }
APP_DIR=$(realpath "$APP_DIR")
DATA_DIR=$(realpath "$DATA_DIR")
[[ -f "$APP_DIR/dist/server/index.js" ]] || { printf 'The selected path does not contain the current UNO production server.\n' >&2; exit 1; }
[[ -f "$APP_DIR/dist/client/index.html" ]] || { printf 'The selected path does not contain the current UNO web build.\n' >&2; exit 1; }
[[ -f "$DATA_DIR/accounts.json" ]] || { printf 'Account store not found. Set UNO_DATA_DIR to the exact data directory used by the existing UNO service.\n' >&2; exit 1; }
[[ -f "$PACKAGE_ROOT/dist/client/index.html" && -f "$PACKAGE_ROOT/dist/server/index.js" && -f "$PACKAGE_ROOT/dist/server/shogi-index.js" ]] || { printf 'The production package is incomplete.\n' >&2; exit 1; }
[[ -f "$PACKAGE_ROOT/deploy/gamesuite.conf" && -f "$ROLLBACK_SCRIPT" ]] || { printf 'Deployment or rollback files are missing from this package.\n' >&2; exit 1; }
grep -q '<title>LayUDown</title>' "$PACKAGE_ROOT/dist/client/index.html" || { printf 'Package title protection check failed.\n' >&2; exit 1; }
[[ -n "$NODE_BIN" ]] || { printf 'Node.js is not installed or not on PATH.\n' >&2; exit 1; }
NODE_VERSION=$("$NODE_BIN" -p 'process.versions.node.split(".").map(Number).slice(0,2).join(" ")')
read -r NODE_MAJOR NODE_MINOR <<< "$NODE_VERSION"
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 19) )); then
  printf 'Node.js 20.19 or newer is required; found %s.\n' "$($NODE_BIN --version)" >&2
  exit 1
fi
if ! (cd "$APP_DIR" && "$NODE_BIN" --input-type=module -e 'await import("express"); await import("socket.io")'); then
  printf 'The existing UNO project cannot load express and socket.io. Restore its locked production dependencies before deployment; no project files were changed.\n' >&2
  exit 1
fi
getent passwd "$APP_USER" >/dev/null || { printf 'Application user does not exist: %s\n' "$APP_USER" >&2; exit 1; }
[[ -d "$NGINX_INCLUDE_DIR" ]] || { printf 'Nginx include directory does not exist: %s\n' "$NGINX_INCLUDE_DIR" >&2; exit 1; }

sudo -v
sudo nginx -t
sudo systemctl is-active --quiet nginx || { printf 'Nginx is not active; refusing to change its site configuration.\n' >&2; exit 1; }
NGINX_DUMP=$(sudo nginx -T 2>&1)
if printf '%s\n' "$NGINX_DUMP" | grep -Eq '^[[:space:]]*server_name[[:space:]].*47[.]100[.]174[.]241([[:space:];])'; then
  if [[ ! -f "$NGINX_FILE" ]] || ! grep -q 'LayUDown Game Suite managed virtual host' "$NGINX_FILE"; then
    printf 'An active Nginx server already claims 47.100.174.241. Inspect nginx -T and resolve the existing project site manually; no Nginx file was changed.\n' >&2
    exit 1
  fi
fi

UNO_LISTENERS=$(sudo ss -H -ltnp 'sport = :3000' 2>/dev/null || true)
[[ -n "$UNO_LISTENERS" ]] || { printf 'TCP 3000 has no listener; refusing to guess which existing UNO service to restart.\n' >&2; exit 1; }
UNO_PIDS=$(printf '%s\n' "$UNO_LISTENERS" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
[[ -n "$UNO_PIDS" ]] || { printf 'Could not identify the process that owns TCP 3000.\n' >&2; exit 1; }
RUNNING_UNITS=$(sudo systemctl list-units --type=service --state=running --no-legend | awk '{print $1}')
UNO_SERVICE=""
for PID in $UNO_PIDS; do
  PROCESS_DIR=$(sudo readlink -f "/proc/$PID/cwd" 2>/dev/null || true)
  [[ "$PROCESS_DIR" == "$APP_DIR" ]] || { printf 'TCP 3000 process %s runs from %s, not the selected project %s.\n' "$PID" "${PROCESS_DIR:-unknown}" "$APP_DIR" >&2; exit 1; }
  PID_UNIT=""
  while IFS= read -r UNIT; do
    [[ -n "$UNIT" ]] || continue
    CONTROL_GROUP=$(sudo systemctl show -p ControlGroup --value "$UNIT" 2>/dev/null || true)
    if [[ -n "$CONTROL_GROUP" ]] && sudo grep -Fq -- "$CONTROL_GROUP" "/proc/$PID/cgroup"; then PID_UNIT=$UNIT; break; fi
  done <<< "$RUNNING_UNITS"
  [[ -n "$PID_UNIT" ]] || { printf 'TCP 3000 process %s is not owned by a running systemd service. Refusing to restart an unidentified process.\n' "$PID" >&2; exit 1; }
  if [[ -n "$UNO_SERVICE" && "$UNO_SERVICE" != "$PID_UNIT" ]]; then
    printf 'TCP 3000 is owned by more than one systemd service; refusing an ambiguous update.\n' >&2
    exit 1
  fi
  UNO_SERVICE=$PID_UNIT
done

SHOGI_LISTENERS=$(sudo ss -H -ltnp 'sport = :3001' 2>/dev/null || true)
if [[ -n "$SHOGI_LISTENERS" ]]; then
  if ! sudo systemctl is-active --quiet layudown-shogi.service || [[ ! -f "$UNIT_FILE" ]] || ! grep -q 'LayUDown Shogi service' "$UNIT_FILE"; then
    printf 'TCP 3001 is already occupied by a service not managed by this LayUDown package. No service was stopped.\n' >&2
    exit 1
  fi
  SHOGI_PIDS=$(printf '%s\n' "$SHOGI_LISTENERS" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
  for PID in $SHOGI_PIDS; do
    PROCESS_DIR=$(sudo readlink -f "/proc/$PID/cwd" 2>/dev/null || true)
    [[ "$PROCESS_DIR" == "$APP_DIR" ]] || { printf 'Existing port 3001 service is not running from this project path.\n' >&2; exit 1; }
  done
fi

BACKUP_PARENT="$APP_DIR/.layudown-backups"
if [[ ! -d "$BACKUP_PARENT" ]]; then
  sudo install -d -m 0700 -o "$APP_USER" -g "$APP_GROUP" "$BACKUP_PARENT"
else
  sudo -u "$APP_USER" test -x "$BACKUP_PARENT" -a -w "$BACKUP_PARENT" || {
    printf 'The project backup directory is not writable by %s; no files were changed.\n' "$APP_USER" >&2
    exit 1
  }
fi
[[ ! -e "$BACKUP_DIR" ]] || { printf 'Backup path already exists; retry after checking the project backup directory.\n' >&2; exit 1; }
sudo install -d -m 0700 -o "$APP_USER" -g "$APP_GROUP" "$BACKUP_DIR"
sudo touch "$BACKUP_DIR/.layudown-game-suite-backup"
printf '%s\n' "$UNO_SERVICE" | sudo tee "$BACKUP_DIR/uno.service" >/dev/null
if sudo systemctl is-active --quiet layudown-shogi.service; then sudo touch "$BACKUP_DIR/shogi.was-active"; fi
if sudo systemctl is-enabled --quiet layudown-shogi.service; then sudo touch "$BACKUP_DIR/shogi.was-enabled"; fi
if sudo test -f "$UNIT_FILE"; then
  sudo grep -q 'LayUDown Shogi service' "$UNIT_FILE" || { printf 'Refusing to replace an unrelated unit file at %s.\n' "$UNIT_FILE" >&2; exit 1; }
  sudo cp -a "$UNIT_FILE" "$BACKUP_DIR/shogi.service"
  sudo touch "$BACKUP_DIR/shogi.was-present"
fi
if sudo test -f "$NGINX_FILE"; then
  sudo grep -q 'LayUDown Game Suite managed virtual host' "$NGINX_FILE" || { printf 'Refusing to replace an unrelated Nginx file at %s.\n' "$NGINX_FILE" >&2; exit 1; }
  sudo cp -a "$NGINX_FILE" "$BACKUP_DIR/nginx.conf"
  sudo touch "$BACKUP_DIR/nginx.was-present"
fi
sudo cp -a "$APP_DIR/dist" "$BACKUP_DIR/dist"
sudo touch "$BACKUP_DIR/dist.saved"
sudo chown -R "$APP_USER:$APP_GROUP" "$BACKUP_DIR"

rollback_on_failure() {
  STATUS=$?
  trap - EXIT ERR
  if (( STATUS != 0 )); then
    printf 'Deployment failed; restoring this update from %s.\n' "$BACKUP_DIR" >&2
    sh "$ROLLBACK_SCRIPT" "$APP_DIR" "$BACKUP_DIR" || printf 'Automatic rollback reported an error; backup retained at %s.\n' "$BACKUP_DIR" >&2
    if [[ -e "$NEXT" ]]; then sudo rm -rf -- "$NEXT"; fi
    if [[ -e "$OLD" ]]; then sudo rm -rf -- "$OLD"; fi
  fi
  exit "$STATUS"
}
trap rollback_on_failure EXIT

sudo cp -a "$PACKAGE_ROOT/dist" "$NEXT"
sudo chown -R "$APP_USER":"$(id -gn "$APP_USER")" "$NEXT"
sudo mv -- "$APP_DIR/dist" "$OLD"
SWAP_STARTED=1
sudo mv -- "$NEXT" "$APP_DIR/dist"
sudo rm -rf -- "$OLD"

sudo tee "$UNIT_FILE" >/dev/null <<UNIT_EOF
[Unit]
Description=LayUDown Shogi service
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=UNO_DATA_DIR=$DATA_DIR
Environment=SHOGI_PORT=3001
Environment=SHOGI_HOST=127.0.0.1
ExecStart=$NODE_BIN $APP_DIR/dist/server/shogi-index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT_EOF
sudo chmod 0644 "$UNIT_FILE"
[[ -s "$UNIT_FILE" ]] || { printf 'The Shogi unit file was not written.\n' >&2; exit 1; }
sudo systemd-analyze verify "$UNIT_FILE"

sudo tee "$NGINX_FILE" < "$PACKAGE_ROOT/deploy/gamesuite.conf" >/dev/null
sudo chmod 0644 "$NGINX_FILE"
sudo nginx -t
NGINX_AFTER=$(sudo nginx -T 2>&1)
printf '%s\n' "$NGINX_AFTER" | grep -Fq "# configuration file $NGINX_FILE:" || { printf 'Nginx does not load %s; refusing to reload.\n' "$NGINX_FILE" >&2; exit 1; }

sudo systemctl daemon-reload
if [[ -f "$BACKUP_DIR/shogi.was-active" ]]; then
  sudo systemctl restart layudown-shogi.service
else
  sudo systemctl enable --now layudown-shogi.service
fi
sudo systemctl restart "$UNO_SERVICE"
curl --fail --silent --show-error http://127.0.0.1:3001/health | grep -q '"ok":true'
curl --fail --silent --show-error http://127.0.0.1:3000/api/health | grep -q '"ok":true'
sudo systemctl reload nginx

for ROUTE in / /uno /shogi; do
  BODY=$(curl --fail --silent --show-error --resolve '47.100.174.241:80:127.0.0.1' "http://47.100.174.241$ROUTE")
  printf '%s' "$BODY" | grep -q '<title>LayUDown</title>' || { printf 'GET %s did not serve the protected LayUDown document.\n' "$ROUTE" >&2; exit 1; }
  CODE=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --head --resolve '47.100.174.241:80:127.0.0.1' "http://47.100.174.241$ROUTE")
  [[ "$CODE" == 200 ]] || { printf 'HEAD %s returned HTTP %s.\n' "$ROUTE" "$CODE" >&2; exit 1; }
done
curl --fail --silent --show-error --resolve '47.100.174.241:80:127.0.0.1' 'http://47.100.174.241/health' | grep -q '"service":"shogi"'
curl --fail --silent --show-error --resolve '47.100.174.241:80:127.0.0.1' 'http://47.100.174.241/api/health' | grep -q '"ok":true'

(
cd "$APP_DIR"
node --input-type=module - <<'NODE'
import { io } from "socket.io-client";
const socket = io("http://127.0.0.1", {
  path: "/shogi-socket.io",
  transports: ["websocket"],
  forceNew: true,
  reconnection: false,
  timeout: 5000,
  extraHeaders: { Host: "47.100.174.241" }
});
const timer = setTimeout(() => { socket.close(); console.error("Shogi WebSocket proxy timed out"); process.exit(1); }, 7000);
socket.once("connect_error", (error) => {
  clearTimeout(timer);
  socket.close();
  if (error.message === "AUTH_REQUIRED") {
    console.log("Shogi WebSocket proxy reached the authenticated service.");
    process.exit(0);
  }
  console.error(`Unexpected Shogi WebSocket error: ${error.message}`);
  process.exit(1);
});
socket.once("connect", () => {
  clearTimeout(timer);
  socket.close();
  console.error("Unauthenticated Shogi WebSocket was accepted.");
  process.exit(1);
});
NODE
)

trap - EXIT
printf 'Deployment verified.\n'
printf 'Updated project: %s\n' "$APP_DIR"
printf 'UNO service: %s (TCP 3000)\n' "$UNO_SERVICE"
printf 'Shogi service: layudown-shogi.service (127.0.0.1:3001)\n'
printf 'Nginx site: %s\n' "$NGINX_FILE"
printf 'Rollback backup: %s\n' "$BACKUP_DIR"
printf 'Public entry: http://47.100.174.241/\n'
