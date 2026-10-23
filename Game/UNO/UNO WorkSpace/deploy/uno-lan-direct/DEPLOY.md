# UNO LAN Direct Update

This archive updates the web application runtime only. It contains `dist/client/` and `dist/server/index.js`; it does not include `node_modules`, environment files, account data, or secrets. No dependency installation or Nginx change is required for the existing deployment.

Upload `uno-lan-direct-update.tar.gz` to `/tmp` on the server, then set `APP_DIR` and `UNO_SERVICE` to the existing application directory and service name:

```bash
APP_DIR=/opt/uno-game
UNO_SERVICE=uno-game.service
ARCHIVE=/tmp/uno-lan-direct-update.tar.gz
test -f "$APP_DIR/dist/client/index.html"
test -f "$APP_DIR/dist/server/index.js"
test -d "$APP_DIR/node_modules"
test -f "$ARCHIVE"
tar -tzf "$ARCHIVE"

STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp -a "$APP_DIR/dist" "$APP_DIR/dist.bak-$STAMP"
STAGING=$(mktemp -d /tmp/uno-lan-direct.XXXXXX)
tar -xzf "$ARCHIVE" -C "$STAGING"
test -f "$STAGING/dist/client/index.html"
test -f "$STAGING/dist/server/index.js"
sudo cp -a "$STAGING/dist/." "$APP_DIR/dist/"
sudo systemctl restart "$UNO_SERVICE"
sudo systemctl is-active "$UNO_SERVICE"
curl --retry 5 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/join-info
```

The restart interrupts active games. Check the public `/uno` URL after restart and verify a player can create a room. A host joining from another network must enable LAN access in its own waiting room and allow the configured TCP port through its firewall.

Each host listens on `0.0.0.0` by default, with `PORT=3000`. If using a different port, open that TCP port in the host firewall and enter `IPv4:port` in Connect Host. The client accepts any syntactically valid IPv4 address; reachability depends on routing, virtual-network membership, host firewall rules, and the running server. It does not infer reachability from an IP range or a VPN brand.

When the target host has one open lobby, `/join` redirects to that room. If it has multiple joinable lobbies, the target host returns a selectable list. A visitor who has no account on that host must log in or register there; the invited room is joined automatically after authentication without another join click. No joinable room, a full host, an already-started game, a closed LAN switch, or a failed network connection produces an error response or a browser network error. HTTPS pages may directly navigate to a private HTTP host because browsers block active mixed-content probes.
