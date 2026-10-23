# UNO 1.2.1 web deployment

`release/uno-web-1.2.1.tar.gz` contains `dist/client/` and `dist/server/index.js`. It does not contain server account data, secrets, `node_modules`, or Android APK files.

The existing UNO process remains on port 3000 and continues to serve the SPA, API, join routes, and Socket.IO. Nginx on port 80 proxies requests to it. Add `nginx-uno-lobby.locations.conf` to the existing `server {}` block, merging/replacing conflicting locations instead of adding duplicate blocks. The forwarding header is overwritten with Nginx's actual peer address so remote clients cannot spoof host-only controls.

## Upload from Windows PowerShell

Replace `SERVER_USER` with the SSH account that already has access to the server:

```powershell
scp "D:\MyGame\UNO\UNO WorkSpace\release\uno-web-1.2.1.tar.gz" SERVER_USER@47.100.174.241:/tmp/uno-web-1.2.1.tar.gz
```

## Apply on the Linux server

First inspect the active Nginx configuration and identify its existing port-80 server block and config file. Also locate the existing UNO app directory and systemd service:

```bash
sudo nginx -T 2>&1 | less
sudo systemctl list-units --type=service --all | grep -Ei 'uno|node'
```

In the commands below, replace `APP_DIR`, `NGINX_SITE_CONF`, and `UNO_SERVICE` with the paths and unit name found above. Back up the current app artifacts and Nginx site config before applying the update:

```bash
NGINX_SITE_CONF=/etc/nginx/sites-enabled/default
APP_DIR=/opt/uno-online
UNO_SERVICE=uno-online.service
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp -a "$NGINX_SITE_CONF" "$NGINX_SITE_CONF.bak-$STAMP"
sudo cp -a "$APP_DIR/dist/client" "$APP_DIR/dist/client.bak-$STAMP"
sudo cp -a "$APP_DIR/dist/server" "$APP_DIR/dist/server.bak-$STAMP"
mkdir -p /tmp/uno-web-1.2.1
tar -xzf /tmp/uno-web-1.2.1.tar.gz -C /tmp/uno-web-1.2.1
```

Edit the active `server {}` block to include the locations from `nginx-uno-lobby.locations.conf`, merging existing `/api/`, `/socket.io`, and `/` locations. If the file uses `$connection_upgrade`, ensure the Nginx `http {}` block defines `map $http_upgrade $connection_upgrade { default upgrade; '' close; }`; otherwise use `proxy_set_header Connection "upgrade";` within `/socket.io`. Do not alter SSH or firewall settings. Deploy, test the Nginx syntax, restart the existing UNO service, then reload Nginx:

```bash
sudo cp -a /tmp/uno-web-1.2.1/dist/. "$APP_DIR/dist/"
sudo nginx -t
sudo systemctl restart "$UNO_SERVICE"
sudo systemctl reload nginx
curl -fsS http://127.0.0.1/api/health
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/uno
curl -I http://127.0.0.1/assets/profile/avatar.jpg
```

From a browser, verify `http://47.100.174.241/`, sign in, open UNO, and check room creation/join. Test WebSocket with two clients to confirm the `/socket.io` proxy. Nginx syntax validation must pass before reload.

## Rollback

Restore the backed-up `dist/client` and `dist/server` directories and Nginx config, then run `sudo nginx -t`, restart the same UNO service, and reload Nginx. The account/data directory is not part of this update and remains untouched.

The Windows installer is separate: `UNO-LAN-1.2.1-setup.exe`. No APK is rebuilt or included.
