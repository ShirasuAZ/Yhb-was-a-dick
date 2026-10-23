# LayUDown Game Suite 2.1.0 Update

The update archive contains a prebuilt website overlay and a separate `arknights-workspace/` directory. The latter contains the Arknights source, card index, card images and only `Map/对战地图.png`. It does not contain `Map.png`, account data, uploaded avatars, `.env` files or credentials.

The current app continues to serve on its existing port. The Arknights Socket.IO namespace uses the existing `/socket.io` path, and the game page, API and static assets share the website origin. The local `gamesuite.conf` template proxies `/socket.io`, `/api/` and `/` to port 3000; this update does not replace Nginx configuration. Confirm that the installed host config has equivalent routes before deployment.

## Docker Build

From the extracted archive root, build the included runtime image:

```bash
docker build -f Dockerfile.update -t layudown:2.1.0 .
```

The image serves the website on port 3000 and includes the Arknights assets under `/app/arknights`. Keep the existing persistent data volume mounted at `/app/data` and retain the current host port mapping, LAN settings, and reverse proxy. The image does not contain account records or user avatar uploads.

Before replacing the current container, back up its Compose/service definition, `.env`, the persistent `/app/data` volume and the current image. Start the new image with the same service name, network, port mapping and data volume. Check `http://127.0.0.1:3000/api/health`, `/api/arknights/catalog`, `/assets/arknights/battle-map.png`, and a client connection to `/socket.io` before routing public traffic to it.

To roll back, restore the saved container image and service definition, then restart the original service with its original data volume and environment. Do not delete the persistent data volume as part of either step.

## Direct Node Deployment

Overlay `website-overlay/dist/` on the current app's `dist/` directory. Place `arknights-workspace/` in a versioned asset directory and set `UNION_ARENA_WORKSPACE_DIR` to that absolute path. Keep the current `UNO_DATA_DIR`. Install the dependencies from the included package files with `npm ci --omit=dev`, then restart only the existing website/UNO service on its current port.

Back up the current `dist/`, `package.json`, lockfile, service environment and persistent data first. For rollback, restore those files and the original environment, then restart the same service. Do not replace the user data directory.

The game catalog endpoint reports the rule fields as unverified. Lobby rooms and seats work, but deck readiness and game start remain disabled until the full card database and official rules are verified. This archive is not a claim that complete UNION ARENA gameplay is deployed. SMTP must be configured before email changes can be sent; otherwise the server rejects the request.

## Deployment Verification

This workspace has no access to the live host, installed Nginx configuration or service manager. The archive was built and checked locally; public IP, port 80, WebSocket proxying on the live server, and two-device internet play still require host-side verification.
