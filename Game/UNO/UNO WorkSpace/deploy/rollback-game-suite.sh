#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  printf 'Usage: %s /absolute/path/to/existing-uno-app /absolute/path/to/.layudown-backups/TIMESTAMP\n' "$0" >&2
  exit 2
fi

APP_DIR=${1%/}
BACKUP_DIR=${2%/}
STAMP=$(date +%Y%m%d-%H%M%S)
FAILED="$APP_DIR/dist.failed-$STAMP"
UNIT_FILE=${LAYUDOWN_UNIT_FILE:-/etc/systemd/system/layudown-shogi.service}
NGINX_FILE=${LAYUDOWN_NGINX_FILE:-/etc/nginx/conf.d/layudown-gamesuite.conf}

case "$APP_DIR:$BACKUP_DIR" in
  /*:/*) ;;
  *) printf 'APP_DIR and BACKUP_DIR must be absolute paths.\n' >&2; exit 2 ;;
esac
case "$APP_DIR" in
  /|*' '*) printf 'APP_DIR must be an existing project directory without whitespace.\n' >&2; exit 2 ;;
esac
[ -d "$APP_DIR" ] && [ -d "$BACKUP_DIR" ] || { printf 'Project or backup directory does not exist.\n' >&2; exit 1; }
[ -f "$BACKUP_DIR/.layudown-game-suite-backup" ] || { printf 'Backup marker is missing.\n' >&2; exit 1; }
EXPECTED_BACKUP="$APP_DIR/.layudown-backups/$(basename "$BACKUP_DIR")"
[ "$BACKUP_DIR" = "$EXPECTED_BACKUP" ] || { printf 'Refusing to restore from a path outside this project backup directory.\n' >&2; exit 1; }
sudo -v

if [ -f "$BACKUP_DIR/dist.saved" ]; then
  [ -f "$BACKUP_DIR/dist/server/index.js" ] && [ -f "$BACKUP_DIR/dist/client/index.html" ] || { printf 'Saved production dist is incomplete.\n' >&2; exit 1; }
  [ ! -e "$FAILED" ] || { printf 'Rollback destination already exists: %s\n' "$FAILED" >&2; exit 1; }
  if [ -e "$APP_DIR/dist" ]; then sudo mv -- "$APP_DIR/dist" "$FAILED"; fi
  sudo mv -- "$BACKUP_DIR/dist" "$APP_DIR/dist"
fi

if [ -f "$BACKUP_DIR/shogi.was-present" ]; then
  [ -f "$BACKUP_DIR/shogi.service" ] || { printf 'Saved Shogi service file is missing.\n' >&2; exit 1; }
  sudo cat "$BACKUP_DIR/shogi.service" | sudo tee "$UNIT_FILE" >/dev/null
  sudo systemd-analyze verify "$UNIT_FILE"
  if [ -f "$BACKUP_DIR/shogi.was-active" ]; then
    sudo systemctl restart layudown-shogi.service
  elif sudo systemctl is-active --quiet layudown-shogi.service; then
    sudo systemctl stop layudown-shogi.service
  fi
  if [ -f "$BACKUP_DIR/shogi.was-enabled" ]; then
    sudo systemctl enable layudown-shogi.service
  else
    sudo systemctl disable layudown-shogi.service
  fi
else
  if [ -f "$UNIT_FILE" ] && sudo grep -q 'LayUDown Shogi service' "$UNIT_FILE"; then
    sudo systemctl disable --now layudown-shogi.service
    sudo rm -f -- "$UNIT_FILE"
  fi
fi
sudo systemctl daemon-reload

if [ -f "$BACKUP_DIR/nginx.was-present" ]; then
  [ -f "$BACKUP_DIR/nginx.conf" ] || { printf 'Saved Nginx configuration is missing.\n' >&2; exit 1; }
  sudo cat "$BACKUP_DIR/nginx.conf" | sudo tee "$NGINX_FILE" >/dev/null
else
  if [ -f "$NGINX_FILE" ] && sudo grep -q 'LayUDown Game Suite managed virtual host' "$NGINX_FILE"; then
    sudo rm -f -- "$NGINX_FILE"
  fi
fi
sudo nginx -t

if [ -f "$BACKUP_DIR/uno.service" ]; then
  sudo systemctl restart "$(sudo cat "$BACKUP_DIR/uno.service")"
fi
if sudo systemctl is-active --quiet nginx; then sudo systemctl reload nginx; fi

printf 'Restored the LayUDown project from %s\n' "$BACKUP_DIR"
if [ -e "$FAILED" ]; then printf 'Failed update retained at %s\n' "$FAILED"; fi
printf 'Only this project, layudown-shogi.service, the LayUDown Nginx site file, and its recorded UNO service were touched.\n'
