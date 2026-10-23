# Rollback

Use the backup directory created before deployment. Replace `BACKUP` with its actual timestamp:

```bash
APP_DIR=/opt/uno-game
UNO_SERVICE=uno-game.service
BACKUP=/opt/uno-game/dist.bak-YYYYMMDD-HHMMSS
test -f "$BACKUP/client/index.html"
test -f "$BACKUP/server/index.js"
sudo mv "$APP_DIR/dist" "$APP_DIR/dist.failed-$(date +%Y%m%d-%H%M%S)"
sudo cp -a "$BACKUP" "$APP_DIR/dist"
sudo systemctl restart "$UNO_SERVICE"
sudo systemctl is-active "$UNO_SERVICE"
curl --retry 5 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
```

The archive does not modify account data, environment files, dependencies, or Nginx configuration. Keep the backup until the public page and room creation have been checked.
