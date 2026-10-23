#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/uno-game"
ARCHIVE="${1:-/root/uno-deploy-1.1.9.tar.gz}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 用户执行此脚本。" >&2
  exit 1
fi
if [ ! -f "$ARCHIVE" ]; then
  echo "找不到更新包：$ARCHIVE" >&2
  exit 1
fi

cd "$APP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
cp -a dist "dist.backup-$STAMP"
echo "已备份旧版本到 $APP_DIR/dist.backup-$STAMP"

tar -xzf "$ARCHIVE" -C "$APP_DIR"
systemctl restart uno-game.service
sleep 1
systemctl --no-pager --full status uno-game.service

echo
echo "健康检查："
curl -fsS http://127.0.0.1:3000/api/health
echo
echo "音效响应："
curl -fsSI http://127.0.0.1:3000/sounds/card-play.mp3 | head -n 1
echo
echo "前端入口："
curl -fsS http://127.0.0.1:3000/ | grep -o 'assets/index-[^"]*'
