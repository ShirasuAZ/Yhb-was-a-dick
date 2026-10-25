import express from "express";
import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Server as SocketServer } from "socket.io";
import sharp from "sharp";
import type {
  ClientToServerEvents,
  ServerToClientEvents
} from "../shared/protocol.ts";
import { RoomManager } from "./room.ts";
import { LanAccessController } from "./lan.ts";
import { AuthService } from "./auth.ts";
import { clientAddress } from "./requestAddress.ts";
import { installSocialApi } from "./social.ts";
import {
  UNION_ARENA_ASSET_ROOT,
  UNION_ARENA_BATTLE_MAP,
  UNION_ARENA_CATALOG,
  UnionArenaRoomManager
} from "../../../Arknights/ArknightsWorkSpace/src/server/index.ts";

const LAN_CLOSED_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>UNO 主机未开放局域网访问</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #101112;
        color: #f3f4f6;
        font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      }
      main {
        width: min(560px, calc(100vw - 40px));
        padding: 28px;
        border: 1px solid #303236;
        border-radius: 10px;
        background: #18191b;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }
      p {
        margin: 0 0 10px;
        color: #b8bcc4;
        line-height: 1.65;
      }
      code {
        color: #f3f4f6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>主机已启动，但局域网访问未开放</h1>
      <p>请在运行主机的电脑上进入房间等待页，点击“开放局域网访问”，然后刷新此页面。</p>
      <p>如果已经开放仍无法进入，请检查 Windows 防火墙是否允许 TCP 端口 <code>3000–3011</code>，以及双方是否在同一局域网或虚拟局域网中。</p>
    </main>
  </body>
</html>`;

export interface AppServer {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
  rooms: RoomManager;
  lanAccess: LanAccessController;
  auth: AuthService;
  unionArenaRooms: UnionArenaRoomManager;
  listen: (port?: number, host?: string) => Promise<number>;
  close: () => Promise<void>;
}

export interface AppServerOptions {
  clientDist?: string;
  lanAccess?: LanAccessController;
  auth?: AuthService;
  dataDir?: string;
}

export function createAppServer(options: AppServerOptions = {}): AppServer {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  const httpServer = createServer(app);
  const lanAccess = options.lanAccess ?? new LanAccessController();
  const auth = options.auth ?? new AuthService(options.dataDir);
  const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    {
      maxHttpBufferSize: 32 * 1024,
      ...(allowedOrigins.length > 0
        ? { cors: { origin: allowedOrigins, credentials: false } }
        : {})
    }
  );
  io.use((socket, next) => {
    socket.data.clientAddress = clientAddress(
      lanAccess,
      socket.handshake.address,
      socket.handshake.headers["x-forwarded-for"]
    );
    if (lanAccess.allowsConnection(socket.data.clientAddress)) {
      next();
    } else {
      next(new Error("LAN_ACCESS_CLOSED"));
    }
  });
  io.use((socket, next) => {
    const account = auth.verifyToken(socket.handshake.auth?.token);
    if (account) {
      socket.data.accountId = account.id;
    }
    next();
  });
  const rooms = new RoomManager(io, lanAccess, auth);
  io.on("connection", (socket) => rooms.handleConnection(socket));
  const unionArenaRooms = new UnionArenaRoomManager(io as never, auth, UNION_ARENA_CATALOG);

  app.use((request, response, next) => {
    if (
      request.path !== "/api/health" &&
      request.path !== "/api/join-info"
    ) {
      next();
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Accept, Content-Type"
    );
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  });

  app.use((request, response, next) => {
    if (lanAccess.allowsConnection(clientAddress(
      lanAccess,
      request.socket.remoteAddress,
      request.headers["x-forwarded-for"]
    ))) {
      next();
      return;
    }
    if (request.path.startsWith("/api/")) {
      response.status(403).json({
        ok: false,
        code: "LAN_CLOSED",
        message: "主机尚未开放局域网访问"
      });
      return;
    }
    response.status(403).type("html").send(LAN_CLOSED_HTML);
  });

  installSocialApi(app, auth, async (accountId, game, code, token) => {
    if (game === "uno") return rooms.rooms.get(code)?.players.some((p) => p.accountId === accountId && p.active) ?? false;
    if (game === "arknights") return !!unionArenaRooms.rooms.get(code)?.getAccount(accountId);
    try {
      const result = await fetch(`http://127.0.0.1:${Number(process.env.SHOGI_PORT ?? 3001)}/api/shogi/membership?room=${encodeURIComponent(code)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
      const body = await result.json() as { member?: boolean };
      return result.ok && body.member === true;
    } catch { return false; }
  });

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      rooms: rooms.rooms.size,
      uptimeSeconds: Math.round(process.uptime())
    });
  });

  app.get("/api/arknights/catalog", (_request, response) => {
    response.setHeader("Cache-Control", "public, max-age=300");
    response.json({
      cards: UNION_ARENA_CATALOG.map((card) => ({
        ...card,
        imageUrl: card.imageAvailable
          ? `/assets/arknights/cards/${encodeURIComponent(card.file)}`
          : null
      }))
    });
  });

  app.get("/assets/arknights/battle-map.png", (_request, response, next) => {
    response.setHeader("Cache-Control", "public, max-age=86400");
    response.sendFile(UNION_ARENA_BATTLE_MAP, (error) => {
      if (error && !response.headersSent) next(error);
    });
  });

  app.get("/assets/arknights/cards/:file", (request, response, next) => {
    const file = request.params.file;
    if (typeof file !== "string" || !UNION_ARENA_CATALOG.some((card) => card.file === file && card.imageAvailable)) {
      response.sendStatus(404);
      return;
    }
    response.setHeader("Cache-Control", "public, max-age=86400");
    response.sendFile(path.join(UNION_ARENA_ASSET_ROOT, file), (error) => {
      if (error && !response.headersSent) next(error);
    });
  });

  app.get("/api/avatars/:accountId", (request, response, next) => {
    const accountId = request.params.accountId;
    const avatarKey = typeof accountId === "string" ? auth.getAvatarKey(accountId) : null;
    if (!avatarKey || path.basename(avatarKey) !== avatarKey || !avatarKey.endsWith(".webp")) {
      response.sendStatus(404);
      return;
    }
    response.type("image/webp").setHeader("Cache-Control", "public, max-age=3600");
    response.sendFile(path.join(auth.dataDir, "avatars", avatarKey), (error) => {
      if (error && !response.headersSent) next(error);
    });
  });

  app.put("/api/profile/avatar", express.raw({ type: "application/octet-stream", limit: "3mb" }), async (request, response) => {
    const authorization = request.get("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
    const account = auth.verifyToken(token);
    if (!account) {
      response.status(401).json({ ok: false, message: "请先登录" });
      return;
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ ok: false, message: "请选择有效图片" });
      return;
    }
    const declaredType = request.get("x-image-type")?.toLowerCase();
    try {
      const image = sharp(request.body, { limitInputPixels: 20_000_000 });
      const metadata = await image.metadata();
      const allowedFormats = new Set(["png", "jpeg", "webp"]);
      const actualType = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format ?? ""}`;
      if (!metadata.format || !allowedFormats.has(metadata.format) ||
        (declaredType && declaredType !== actualType) ||
        !metadata.width || !metadata.height || metadata.width * metadata.height > 20_000_000) {
        response.status(415).json({ ok: false, message: "仅支持有效的 PNG、JPEG 或 WebP 图片" });
        return;
      }
      const avatarDir = path.join(auth.dataDir, "avatars");
      await fs.promises.mkdir(avatarDir, { recursive: true, mode: 0o700 });
      const key = `${account.id}-${randomUUID()}.webp`;
      const filePath = path.join(avatarDir, key);
      await image.rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 82 }).toFile(filePath);
      const previousKey = auth.getAvatarKey(account.id);
      const updatedAccount = auth.setAvatarKey(account.id, key);
      if (previousKey && path.basename(previousKey) === previousKey && previousKey.endsWith(".webp")) {
        await fs.promises.rm(path.join(avatarDir, previousKey), { force: true });
      }
      unionArenaRooms.refreshAccount(account.id);
      response.json({ ok: true, account: updatedAccount });
    } catch (error) {
      response.status(400).json({ ok: false, message: error instanceof Error ? "无法读取图片文件" : "头像保存失败" });
    }
  });

  app.get("/api/join-info", (_request, response) => {
    const status = lanAccess.status();
    response.json({
      ok: true,
      app: "uno",
      lanEnabled: status.enabled,
      port: status.port,
      hostName: status.hostName
    });
  });

  app.get("/join", (request, response) => {
    const allRooms = [...rooms.rooms.values()];
    const joinableRooms = allRooms
      .filter((room) => {
        const activePlayers = room.players.filter((player) => player.active);
        return room.phase === "lobby" && activePlayers.length < 6;
      })
      .map((room) => ({
        code: room.code,
        players: room.players.filter((player) => player.active).length
      }));
    const requestedCode = request.query.room;
    const selected = typeof requestedCode === "string"
      ? joinableRooms.find((room) => room.code === requestedCode.toUpperCase())
      : joinableRooms.length === 1 ? joinableRooms[0] : undefined;

    if (typeof requestedCode === "string" && !selected) {
      response.status(404).type("html").send(
        "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>无法加入房间</title><body><main><h1>无法加入房间</h1><p>该房间不存在、已关闭、已满员或对局已经开始。</p></main></body></html>"
      );
      return;
    }

    if (selected) {
      response.redirect(302, `/room/${selected.code}`);
      return;
    }
    if (joinableRooms.length > 1 && requestedCode === undefined) {
      const options = joinableRooms.map((room) =>
        `<li><a href="/room/${room.code}">${room.code}</a><span>${room.players}/6 人</span></li>`
      ).join("");
      response.status(200).type("html").send(
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>选择 UNO 房间</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101112;color:#f3f4f6;font:16px system-ui,"Microsoft YaHei",sans-serif}main{width:min(520px,calc(100vw - 40px))}h1{font-size:22px}p,li span{color:#aeb3bb}ul{list-style:none;padding:0}li{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:14px 0;border-bottom:1px solid #35383d}a{color:#8ac7ff;font-weight:700}</style><main><h1>选择要加入的房间</h1><ul>${options}</ul></main></html>`
      );
      return;
    }
    const message = allRooms.length === 0
      ? "这台主机当前没有可加入的房间。请房主先创建房间后重试。"
      : allRooms.some((room) => room.phase === "lobby")
        ? "这台主机的等待房间都已满员（最多 6 人）。"
        : "这台主机没有等待中的房间，对局可能已经开始。";
    response.status(404).type("html").send(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>无法加入房间</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101112;color:#f3f4f6;font:16px system-ui,"Microsoft YaHei",sans-serif}main{width:min(520px,calc(100vw - 40px))}h1{font-size:22px}p{color:#aeb3bb;line-height:1.6}</style><main><h1>无法加入房间</h1><p>${message}</p></main></html>`
    );
  });

  app.get("/api/network", (request, response) => {
    if (!lanAccess.isLocalAddress(clientAddress(
      lanAccess,
      request.socket.remoteAddress,
      request.headers["x-forwarded-for"]
    ))) {
      response.status(403).json({
        ok: false,
        message: "Only the host machine can read LAN host controls"
      });
      return;
    }
    response.json({ ok: true, status: lanAccess.status() });
  });

  const downloadDir = path.resolve(process.env.UNO_DOWNLOAD_DIR ?? path.resolve(process.cwd(), "release"));
  const downloadable = /^UNO-LAN-[\d.]+-(?:setup|portable)\.exe$|^UNO-LAN-[\d.]+-android-debug\.apk$/;
  app.get("/downloads", (_request, response) => {
    const files = fs.existsSync(downloadDir)
      ? fs.readdirSync(downloadDir).filter((name) => downloadable.test(name)).sort().reverse()
      : [];
    const links = files.map((name) =>
      '<li><a href="/downloads/' + encodeURIComponent(name) + '">' + name + '</a></li>'
    ).join("");
    response.type("html").send('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>UNO 下载</title>' +
      '<style>body{font:16px system-ui;background:#101112;color:#eee;max-width:720px;margin:48px auto;padding:0 24px}a{color:#8ac7ff}li{padding:8px}</style>' +
      '</head><body><h1>UNO 下载</h1><p><a href="/">打开网页版</a></p><ul>' +
      (links || '<li>安装包暂未上传</li>') + '</ul></body></html>');
  });  app.get("/downloads/:file", (request, response, next) => {
    const name = request.params.file;
    if (typeof name !== "string" || !downloadable.test(name)) return next();
    response.download(path.join(downloadDir, name), name, (error) => {
      if (error && !response.headersSent) next(error);
    });
  });

  const clientDist =
    options.clientDist ?? path.resolve(process.cwd(), "dist/client");
  app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
  app.get("/", (_request, response) => {
    response.sendFile(path.join(clientDist, "index.html"), (error) => {
      if (error) {
        response
          .status(200)
          .type("text/plain")
          .send(
            "UNO server is running. In development open http://localhost:5173."
          );
      }
    });
  });
  app.use((request, response, next) => {
    if (
      (request.method !== "GET" && request.method !== "HEAD") ||
      !request.accepts("html") ||
      request.path.startsWith("/api/") ||
      request.path.startsWith("/assets/") ||
      /\.[a-z0-9]+$/i.test(request.path)
    ) {
      next();
      return;
    }
    response.sendFile(path.join(clientDist, "index.html"), (error) => {
      if (error) {
        response.status(404).type("text/plain").send("Not found");
      }
    });
  });

  const listen = (port = 0, host = "127.0.0.1"): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        httpServer.off("error", onError);
        const address = httpServer.address();
        if (!address || typeof address === "string") {
          reject(new Error("Unable to resolve listening port"));
          return;
        }
        lanAccess.setPort(address.port);
        resolve(address.port);
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(port, host);
    });

  const close = async (): Promise<void> => {
    rooms.close();
    unionArenaRooms.close();
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  };

  return { app, httpServer, io, rooms, unionArenaRooms, lanAccess, auth, listen, close };
}
