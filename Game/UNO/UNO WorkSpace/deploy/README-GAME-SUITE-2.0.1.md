# LayUDown Game Suite 2.0.1 Update

This GZ archive contains the production `dist/` directory for the existing 2.0.0 game suite. It updates the homepage and account service served by UNO on port 3000, and the Shogi web route and service on port 3001. Nginx continues to provide the public port 80 entry point. Account data is not included; the existing `UNO_DATA_DIR` and its `accounts.json` must be preserved.

In Shogi, the host starts a game after the opponent joins and gets ready. The room number and setup controls are hidden after start. The compact game view keeps the current-turn label, exit button, upright hand pieces, and a board sized to about 480 CSS pixels on larger screens. Leaving during a live game awards the opponent the win and frees the seat.

## Update

Upload `LayUDown-Game-Suite-2.0.1.tar.gz` to the server and extract it to a temporary directory:

```bash
mkdir -p /tmp/layudown-2.0.1
tar -xzf /tmp/LayUDown-Game-Suite-2.0.1.tar.gz -C /tmp/layudown-2.0.1
```

From the existing LayUDown application directory, back up and replace only `dist/`:

```bash
cd /absolute/path/to/existing-layudown-app
STAMP=$(date +%Y%m%d-%H%M%S)
cp -a dist ".dist.backup-$STAMP"
cp -a /tmp/layudown-2.0.1/dist ".dist.next-$STAMP"
mv dist ".dist.old-$STAMP"
mv ".dist.next-$STAMP" dist
```

Restart the existing systemd service that owns port 3000 and the Shogi unit, then verify both health checks:

```bash
sudo systemctl restart YOUR_EXISTING_PORT_3000_SERVICE
sudo systemctl restart layudown-shogi.service
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3001/health
```

Replace `YOUR_EXISTING_PORT_3000_SERVICE` with the service currently running the homepage and UNO. The update does not include account data, environment files, Nginx configuration, or dependencies. If either service does not start, restore the previous `dist/` directory from `.dist.old-$STAMP` and restart the same services.

## Account Notes

New registrations require a unique email address. Password recovery uses the registered username and email to set a new password; old login tokens stop working. Existing accounts without email data remain usable for login but cannot use email recovery. This update does not send email and does not include account records.

## Ports

- Public homepage: `http://47.100.174.241/` via port 80.
- Homepage and UNO service: port 3000.
- Shogi service: port 3001.
