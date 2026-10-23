# LayUDown Game Suite 1.0.0 Deployment

This is a Linux production update package for the existing LayUDown website. It includes the built homepage, the existing UNO client and server, the Shogi client and server, local static assets, source snapshots, tests, and deployment/rollback helpers. The package does not contain account data, `.env` files, secrets, `node_modules`, or Windows installation software.

## Runtime and ports

- Node.js 20.19 or newer.
- TCP 80 remains the public Nginx entry point.
- UNO remains on its existing TCP 3000 service.
- Shogi listens on `127.0.0.1:3001`; do not open 3001 to the public network.
- Nginx routes `/` and `/uno` to the existing UNO service, `/shogi` and `/api/shogi/` to port 3001, and `/socket.io` and `/shogi-socket.io` to their respective services with WebSocket upgrade headers.
- This package does not depend on `layudown.cn`; use `http://47.100.174.241/` after deployment.

## Before updating

Inspect the running processes, port ownership, application directory, service names, and the effective Nginx configuration. On the server, use `ss -ltnp` and `sudo nginx -T`; do not remove unrelated site files or replace the full Nginx configuration. Confirm that port 3001 is free or already belongs to the LayUDown Shogi service. Keep the account data directory and current `.env` outside this package.

Extract the archive to a temporary directory. The deployment helper only replaces the existing app's `dist/` directory and creates a timestamped backup beside it. It does not restart the existing UNO service, install dependencies, alter account data, or edit Nginx/firewall configuration:

```bash
cd /path/to/extracted/LayUDown-Game-Suite-Setup-1.0.0
chmod +x deploy/deploy-game-suite.sh deploy/rollback-game-suite.sh
deploy/deploy-game-suite.sh /absolute/path/to/existing-uno-app
```

Keep the printed `dist.bak-*` path until verification is complete. If the app is deployed through a symlinked release directory, pass the resolved active application directory used by the existing UNO process.

## Add the Shogi service

Use a dedicated service file. Replace `APP_DIR` and `APP_USER` with the exact existing project path and the account that owns/runs this project. Resolve Node with `command -v node` and use its absolute path in `ExecStart`. Do not change the existing UNO unit:

```ini
[Unit]
Description=LayUDown Shogi service
After=network.target

[Service]
Type=simple
User=APP_USER
WorkingDirectory=APP_DIR
Environment=NODE_ENV=production
Environment=SHOGI_PORT=3001
Environment=SHOGI_HOST=127.0.0.1
ExecStart=/absolute/path/to/node APP_DIR/dist/server/shogi-index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Install this as `/etc/systemd/system/layudown-shogi.service`, then run `sudo systemctl daemon-reload`, `sudo systemctl enable --now layudown-shogi.service`, `sudo systemctl is-active layudown-shogi.service`, and `curl -fsS http://127.0.0.1:3001/api/shogi/health`. The response should contain `"ok":true`. If a unit with that name already exists, inspect it and preserve its project-specific settings rather than overwriting it blindly.

The UNO service remains on port 3000. Its static files are read from `dist/client`, so replacing `dist/` does not require restarting UNO. Do not restart it unless the existing deployment specifically requires that for static file refresh.

## Nginx and public checks

Read `deploy/nginx-uno-lobby.locations.conf`. Merge its locations into the already active `server` block that handles the IP on port 80. Check for conflicting `location` blocks first; adjust only this site's conflicting route, preserve unrelated server blocks, then run `sudo nginx -t` and reload Nginx only after it passes. The snippet uses loopback backends and includes WebSocket upgrade handling. It does not require exposing port 3001.

After starting the Shogi service and applying the project-specific Nginx locations, verify:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3001/api/shogi/health
curl -I http://47.100.174.241/
curl -I http://47.100.174.241/uno
curl -I http://47.100.174.241/shogi
```

Then open `http://47.100.174.241/` in a browser. Confirm the logged-out view shows only the login/register screen, and the authenticated homepage shows the LayUDown header plus UNO, 日本将棋, and 关于我. Check `/uno` room creation and `/shogi` local and online games. Keep the homepage `<title>` and header `h1` as `LayUDown`.

The workspace tests cover desktop, narrow desktop, mobile portrait and landscape viewports, but the production IP, the live ECS configuration, and physical mobile devices have not been tested from this package build. Perform those checks after deploying it.

## Rollback

Rollback the static/server build with the exact backup path printed by the deployment helper:

```bash
deploy/rollback-game-suite.sh /absolute/path/to/existing-uno-app /absolute/path/to/dist.bak-YYYYMMDD-HHMMSS
```

If the Shogi service was installed, stop and disable only `layudown-shogi.service`; restore its previous unit file if there was one. Revert only the locations added to this site's active port-80 server block, validate with `sudo nginx -t`, and reload Nginx. Do not touch unrelated services, OpenClaw, other Nginx sites, firewall rules, or the account data directory.

## Contents

- `dist/`: actual Vite and esbuild production output for the full site and both services.
- `source/UNO/UNO WorkSpace/`: full project source, tests, package metadata, and public resources, excluding generated caches, runtime data, old release archives, and `node_modules`.
- `source/Hon shugi/Hon shugi WorkSpace/`: canonical Shogi rules engine source and its tests.
- `deploy/`: Nginx location snippet, deployment and rollback scripts, and this guide.

