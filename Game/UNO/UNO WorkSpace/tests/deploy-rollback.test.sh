#!/bin/sh
set -eu

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
APP="$ROOT/project"
BACKUP="$APP/.layudown-backups/20300101-120000"
UNIT="$ROOT/systemd/layudown-shogi.service"
NGINX="$ROOT/nginx/layudown-gamesuite.conf"
LOG="$ROOT/commands.log"
mkdir -p "$APP/dist/server" "$APP/dist/client" "$BACKUP/dist/server" "$BACKUP/dist/client" "$(dirname "$UNIT")" "$(dirname "$NGINX")"

sudo() {
  [ "${1:-}" = -v ] && return 0
  if [ "${1:-}" = tee ]; then
    target=$2
    while IFS= read -r line; do printf '%s\n' "$line"; done > "$target"
    return 0
  fi
  if [ "${1:-}" = systemd-analyze ] || [ "${1:-}" = nginx ]; then
    command_name=$1
    shift
    printf '%s %s\n' "$command_name" "$*" >> "$LOG"
    return 0
  fi
  "$@"
}
systemctl() {
  printf 'systemctl %s\n' "$*" >> "$LOG"
  if [ "$1" = is-active ] && [ "${3:-}" = nginx ]; then return 0; fi
  return 0
}

printf 'old-uno-server\n' > "$BACKUP/dist/server/index.js"
printf '<title>LayUDown</title>\n' > "$BACKUP/dist/client/index.html"
printf 'current-update\n' > "$APP/dist/server/index.js"
printf '<title>LayUDown</title>\n' > "$APP/dist/client/index.html"
printf 'new unit\nDescription=LayUDown Shogi service\n' > "$UNIT"
printf '# LayUDown Game Suite managed virtual host\n' > "$NGINX"
printf 'layudown-uno.service\n' > "$BACKUP/uno.service"
: > "$BACKUP/dist.saved"
: > "$BACKUP/.layudown-game-suite-backup"

TEST_LOG="$LOG" LAYUDOWN_UNIT_FILE="$UNIT" LAYUDOWN_NGINX_FILE="$NGINX"
(
  set -- "$APP" "$BACKUP"
  . "$(dirname "$0")/../deploy/rollback-game-suite.sh" "$@"
)

grep -q 'old-uno-server' "$APP/dist/server/index.js"
grep -q '<title>LayUDown</title>' "$APP/dist/client/index.html"
[ ! -e "$UNIT" ]
[ ! -e "$NGINX" ]
grep -q 'current-update' "$APP"/dist.failed-*/server/index.js
grep -q 'systemctl disable --now layudown-shogi.service' "$LOG"
grep -q 'systemctl restart layudown-uno.service' "$LOG"
grep -q 'systemctl reload nginx' "$LOG"
printf 'ROLLBACK_SIMULATION_OK\n'
