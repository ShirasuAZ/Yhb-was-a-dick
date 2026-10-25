import express from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { randomInt } from "node:crypto";
import path from "node:path";
import { Server as SocketServer, type Socket } from "socket.io";
import {
  ShogiGame,
  ShogiRuleError,
  type GameView,
  type Move,
  type Side
} from "../../../Hon shugi/Hon shugi WorkSpace/src/engine.ts";
import { AuthService, type PublicAccount } from "./auth.ts";

interface ShogiPlayer {
  accountId: string;
  name: string;
  side: Side;
  connected: boolean;
  socketId: string | null;
}

export const SURRENDER_AFTER_MS = 180_000;
export const DISSOLVE_DELAY_MS = 5_000;

export interface ShogiTimingOptions {
  now: () => number;
  surrenderAfterMs: number;
  dissolveDelayMs: number;
}

export interface ShogiRoomResult {
  reason: "checkmate" | "resigned" | "draw";
  winner: Side | null;
}

interface ShogiRoomState {
  roomCode: string;
  game: GameView;
  /** Server clock (ms) when this snapshot was produced; clients derive offsets from it. */
  serverNow: number;
  /** Server time the game officially started, or null before the host starts it. */
  startedAt: number | null;
  surrenderAfterMs: number;
  result: ShogiRoomResult | null;
  endedAt: number | null;
  dissolveAt: number | null;
  started: boolean;
  ready: Side[];
  players: Partial<Record<Side, string>>;
  connected: Partial<Record<Side, boolean>>;
  yourSide: Side;
  hostSide: Side;
  spectator?: boolean;
  spectators?: Array<{ id: string; name: string; connected: boolean }>;
}

interface IdentityState {
  username: string;
  roomCode: string | null;
  side: Side | null;
}

type Ack = (result: { ok: boolean; message?: string; data?: unknown }) => void;

const ROOM_ALPHABET = "0123456789";
const RECONNECT_GRACE_MS = 30 * 60 * 1000;

function createCode(): string {
  return Array.from({ length: 4 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join("");
}

function validSquare(value: unknown): value is { row: number; col: number } {
  if (!value || typeof value !== "object") return false;
  const square = value as { row?: unknown; col?: unknown };
  return Number.isInteger(square.row) && Number.isInteger(square.col) &&
    Number(square.row) >= 0 && Number(square.row) < 9 &&
    Number(square.col) >= 0 && Number(square.col) < 9;
}

function validMove(value: unknown): value is Move {
  if (!value || typeof value !== "object") return false;
  const move = value as Partial<Move>;
  if (move.kind === "move") {
    return validSquare(move.from) && validSquare(move.to) &&
      (move.promote === undefined || typeof move.promote === "boolean");
  }
  return move.kind === "drop" && validSquare(move.to) &&
    ["rook", "bishop", "gold", "silver", "knight", "lance", "pawn"].includes(String(move.piece));
}

class ShogiRoom {
  readonly code: string;
  readonly game = new ShogiGame();
  readonly players = new Map<Side, ShogiPlayer>();
  readonly spectators = new Map<string, { id: string; name: string; socketId: string; connected: boolean }>();
  readonly ready = new Set<Side>();
  hostAccountId: string | null = null;
  started = false;
  startedAt: number | null = null;
  endedAt: number | null = null;
  dissolveAt: number | null = null;
  result: ShogiRoomResult | null = null;
  dissolved = false;
  dissolveTimer: NodeJS.Timeout | null = null;
  readonly graceTimers = new Set<NodeJS.Timeout>();
  readonly sockets = new Set<Socket>();

  constructor(code: string, readonly timing: ShogiTimingOptions) {
    this.code = code;
  }

  markStarted(): void {
    this.started = true;
    this.startedAt = this.timing.now();
    this.endedAt = null;
    this.dissolveAt = null;
    this.result = null;
  }

  /** Records the end of the game exactly once. Returns false if it was already recorded. */
  finish(): boolean {
    if (this.endedAt !== null || this.dissolved) return false;
    const view = this.game.view();
    if (view.status === "playing") return false;
    this.endedAt = this.timing.now();
    this.dissolveAt = this.endedAt + this.timing.dissolveDelayMs;
    this.result = {
      reason: view.status === "checkmate" ? "checkmate" : view.status === "resigned" ? "resigned" : "draw",
      winner: view.winner
    };
    return true;
  }

  /** Remaining milliseconds before resignation is allowed (0 when allowed). */
  surrenderWaitMs(): number {
    if (this.startedAt === null) return this.timing.surrenderAfterMs;
    return Math.max(0, this.startedAt + this.timing.surrenderAfterMs - this.timing.now());
  }

  /** Tears the room down: clears timers, seats and sockets. Returns the sockets that were attached. */
  dissolve(): Socket[] {
    this.dissolved = true;
    if (this.dissolveTimer) clearTimeout(this.dissolveTimer);
    this.dissolveTimer = null;
    for (const timer of this.graceTimers) clearTimeout(timer);
    this.graceTimers.clear();
    const sockets = [...this.sockets];
    this.sockets.clear();
    for (const player of this.players.values()) {
      player.connected = false;
      player.socketId = null;
    }
    this.players.clear();
    this.ready.clear();
    this.hostAccountId = null;
    return sockets;
  }

  addPlayer(account: PublicAccount, socket: Socket): ShogiPlayer {
    const side: Side = this.players.has("sente") ? "gote" : "sente";
    const player: ShogiPlayer = {
      accountId: account.id,
      name: account.username,
      side,
      connected: true,
      socketId: socket.id
    };
    this.players.set(side, player);
    if (this.started && this.game.view().status !== "playing") {
      this.started = false;
      this.ready.clear();
    }
    this.hostAccountId ??= account.id;
    this.sockets.add(socket);
    return player;
  }

  attach(player: ShogiPlayer, socket: Socket): void {
    const previousSocketId = player.socketId;
    if (previousSocketId && previousSocketId !== socket.id) {
      for (const candidate of this.sockets) {
        if (candidate.id === previousSocketId) candidate.disconnect(true);
      }
    }
    player.connected = true;
    player.socketId = socket.id;
    this.sockets.add(socket);
  }

  detach(socket: Socket): ShogiPlayer | null {
    this.sockets.delete(socket);
    for (const player of this.players.values()) {
      if (player.socketId === socket.id) {
        player.connected = false;
        player.socketId = null;
        return player;
      }
    }
    return null;
  }

  removePlayer(player: ShogiPlayer): boolean {
    if (this.players.get(player.side) !== player) return false;
    this.players.delete(player.side);
    if (player.socketId) {
      for (const socket of this.sockets) {
        if (socket.id === player.socketId) this.sockets.delete(socket);
      }
    }
    player.connected = false;
    player.socketId = null;
    this.ready.delete(player.side);
    if (this.hostAccountId === player.accountId) {
      this.hostAccountId = this.players.values().next().value?.accountId ?? null;
    }
    return true;
  }

  stateFor(player: ShogiPlayer): ShogiRoomState {
    const host = [...this.players.values()].find((entry) => entry.accountId === this.hostAccountId);
    return {
      roomCode: this.code,
      game: this.game.view(),
      serverNow: this.timing.now(),
      startedAt: this.startedAt,
      surrenderAfterMs: this.timing.surrenderAfterMs,
      result: this.result,
      endedAt: this.endedAt,
      dissolveAt: this.dissolveAt,
      started: this.started,
      ready: [...this.ready],
      players: Object.fromEntries([...this.players.values()].map((entry) => [entry.side, entry.name])) as Partial<Record<Side, string>>,
      connected: Object.fromEntries([...this.players.values()].map((entry) => [entry.side, entry.connected])) as Partial<Record<Side, boolean>>,
      yourSide: player.side,
      hostSide: host?.side ?? player.side,
      spectators: [...this.spectators.values()]
    };
  }

  stateForSpectator(id: string): ShogiRoomState {
    const player = this.players.values().next().value as ShogiPlayer | undefined;
    if (!player) throw new Error("ROOM_NOT_FOUND");
    return { ...this.stateFor(player), spectator: true, yourSide: "sente", hostSide: [...this.players.values()].find((entry) => entry.accountId === this.hostAccountId)?.side ?? "sente", spectators: [...this.spectators.values()] };
  }

  broadcast(): void {
    for (const socket of this.sockets) {
      const player = [...this.players.values()].find((entry) => entry.socketId === socket.id);
      if (player) socket.emit("shogi:state", this.stateFor(player));
      else for (const spectator of this.spectators.values()) if (spectator.socketId === socket.id) socket.emit("shogi:state", this.stateForSpectator(spectator.id));
    }
  }

  removeDisconnectedPlayer(player: ShogiPlayer): boolean {
    return !player.connected && this.removePlayer(player);
  }

}

export interface ShogiServer {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketServer;
  rooms: Map<string, ShogiRoom>;
  auth: AuthService;
  listen: (port?: number, host?: string) => Promise<number>;
  close: () => Promise<void>;
}

export function createShogiServer(options: {
  clientDist?: string;
  auth?: AuthService;
  dataDir?: string;
  /** Test hooks only; production uses the defaults (Date.now, 180 s, 5 s). */
  now?: () => number;
  surrenderAfterMs?: number;
  dissolveDelayMs?: number;
} = {}): ShogiServer {
  const timing: ShogiTimingOptions = {
    now: options.now ?? Date.now,
    surrenderAfterMs: options.surrenderAfterMs ?? SURRENDER_AFTER_MS,
    dissolveDelayMs: options.dissolveDelayMs ?? DISSOLVE_DELAY_MS
  };
  const app = express();
  app.disable("x-powered-by");
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { path: "/shogi-socket.io", maxHttpBufferSize: 16 * 1024 });
  const rooms = new Map<string, ShogiRoom>();
  const auth = options.auth ?? new AuthService(options.dataDir);

  io.use((socket, next) => {
    const session = auth.verifyTokenSession(socket.handshake.auth?.token);
    if (!session) {
      next(new Error("AUTH_REQUIRED"));
      return;
    }
    socket.data.shogiAccount = session.account;
    socket.data.shogiExpiresAt = session.expiresAt;
    next();
  });

  const findRoom = (value: unknown): ShogiRoom | undefined =>
    typeof value === "string" ? rooms.get(value.trim().toUpperCase()) : undefined;
  const findAccountSeat = (accountId: string): { room: ShogiRoom; player: ShogiPlayer } | null => {
    for (const room of rooms.values()) {
      for (const player of room.players.values()) {
        if (player.accountId === accountId) return { room, player };
      }
    }
    return null;
  };
  const uniqueCode = (): string => {
    let code = createCode();
    while (rooms.has(code)) code = createCode();
    return code;
  };

  /**
   * Single place where a finished game is settled. Safe to call repeatedly: only the first call
   * for a room records the result and schedules the (server-controlled) dissolution.
   */
  const settleIfFinished = (target: ShogiRoom): void => {
    if (!target.finish()) return;
    const delay = Math.max(0, (target.dissolveAt ?? 0) - timing.now());
    target.dissolveTimer = setTimeout(() => dissolveRoom(target), delay);
    target.dissolveTimer.unref?.();
  };

  /** Dissolves exactly one room; idempotent and never touches other rooms. */
  const dissolveRoom = (target: ShogiRoom): void => {
    if (target.dissolved) return;
    const sockets = target.dissolve();
    if (rooms.get(target.code) === target) rooms.delete(target.code);
    for (const socket of sockets) {
      socket.emit("shogi:closed", { message: "房间已解散", dissolved: true });
      socket.emit("shogi:identity", { username: String(socket.data.shogiAccount?.username ?? ""), roomCode: null, side: null } satisfies IdentityState);
    }
  };

  app.get("/health", (_request, response) => response.json({ ok: true, service: "shogi", rooms: rooms.size }));
  app.get("/api/shogi/health", (_request, response) => response.json({ ok: true, service: "shogi", rooms: rooms.size }));
  app.get("/api/shogi/membership", (request, response) => {
    const account = auth.verifyToken(request.headers.authorization?.replace(/^Bearer /, ""));
    const room = findRoom(request.query.room);
    response.json({ member: !!account && !!room && [...room.players.values()].some((player) => player.accountId === account.id) });
  });
  const clientDist = options.clientDist ?? path.resolve(process.cwd(), "dist/client");
  app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
  app.get(/^\/shogi(?:\/.*)?$/, (_request, response) => response.sendFile(path.join(clientDist, "index.html")));

  io.on("connection", (socket) => {
    const account = socket.data.shogiAccount as PublicAccount;
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, Number(socket.data.shogiExpiresAt) - Date.now()));
    expiryTimer.unref?.();
    let room: ShogiRoom | null = null;
    let player: ShogiPlayer | null = null;

    const existingSeat = findAccountSeat(account.id);
    if (existingSeat) {
      room = existingSeat.room;
      player = existingSeat.player;
      room.attach(player, socket);
    }
    const identity: IdentityState = {
      username: account.username,
      roomCode: room?.code ?? null,
      side: player?.side ?? null
    };
    socket.emit("shogi:identity", identity);
    if (room && player) socket.emit("shogi:state", room.stateFor(player));

    const currentSeat = (): boolean => !!room && !!player &&
      player.accountId === account.id && room.players.get(player.side) === player &&
      player.socketId === socket.id;

    socket.on("shogi:create", (_payload: unknown, ack?: Ack) => {
      if (room?.dissolved) { room = null; player = null; }
      if (room) { ack?.({ ok: false, message: `您已在房间 ${room.code}` }); return; }
      const priorSeat = findAccountSeat(account.id);
      if (priorSeat) {
        room = priorSeat.room;
        player = priorSeat.player;
        room.attach(player, socket);
        ack?.({ ok: true, data: { roomCode: room.code } });
        socket.emit("shogi:identity", { username: account.username, roomCode: room.code, side: player.side } satisfies IdentityState);
        socket.emit("shogi:state", room.stateFor(player));
        return;
      }
      room = new ShogiRoom(uniqueCode(), timing);
      player = room.addPlayer(account, socket);
      rooms.set(room.code, room);
      ack?.({ ok: true, data: { roomCode: room.code } });
      socket.emit("shogi:identity", { username: account.username, roomCode: room.code, side: player.side } satisfies IdentityState);
      socket.emit("shogi:state", room.stateFor(player));
    });

    socket.on("shogi:join", (payload: { roomCode?: unknown }, ack?: Ack) => {
      if (room?.dissolved) { room = null; player = null; }
      if (room) { ack?.({ ok: false, message: `您已在房间 ${room.code}` }); return; }
      const target = findRoom(payload?.roomCode);
      if (!target) { ack?.({ ok: false, message: "房间不存在或已关闭" }); return; }
      if (target.endedAt !== null || target.dissolved) { ack?.({ ok: false, message: "房间即将解散，无法加入" }); return; }
      if (target.started && target.game.view().status === "playing") { ack?.({ ok: false, message: "对局已经开始，无法加入" }); return; }
      if (target.players.size >= 2) { ack?.({ ok: false, message: "房间已满" }); return; }
      if (findAccountSeat(account.id)) { ack?.({ ok: false, message: "当前账号已在另一房间，请先退出该房间" }); return; }
      room = target;
      player = room.addPlayer(account, socket);
      ack?.({ ok: true, data: { roomCode: room.code } });
      socket.emit("shogi:identity", { username: account.username, roomCode: room.code, side: player.side } satisfies IdentityState);
      room.broadcast();
    });

    socket.on("shogi:spectate", (payload: { roomCode?: unknown }, ack?: Ack) => {
      if (room || findAccountSeat(account.id)) { ack?.({ ok: false, message: "当前账号已经在房间中" }); return; }
      const target = findRoom(payload?.roomCode);
      if (!target) { ack?.({ ok: false, message: "房间不存在或已关闭" }); return; }
      const spectator = { id: account.id, name: account.username, socketId: socket.id, connected: true };
      target.spectators.set(account.id, spectator); target.sockets.add(socket); socket.join(target.code);
      room = target; player = null;
      ack?.({ ok: true, data: { roomCode: target.code } });
      socket.emit("shogi:identity", { username: account.username, roomCode: target.code, side: null } satisfies IdentityState);
      target.broadcast();
    });

    socket.on("shogi:move", (payload: { roomCode?: unknown; expectedPly?: unknown; move?: unknown }, ack?: Ack) => {
      if (!currentSeat() || !room || !player || findRoom(payload?.roomCode)?.code !== room.code || !validMove(payload.move)) {
        ack?.({ ok: false, message: "无效的走棋请求" });
        return;
      }
      if (!room.started) { ack?.({ ok: false, message: "请等待房主开始对局" }); return; }
      if (room.endedAt !== null || room.dissolved || room.game.gameStatus !== "playing") { ack?.({ ok: false, message: "对局已经结束" }); return; }
      if (!Number.isInteger(payload.expectedPly) || payload.expectedPly !== room.game.view().history.length) {
        ack?.({ ok: false, message: "棋局已更新，请确认最新棋盘后再走棋" });
        return;
      }
      if (room.game.currentSide !== player.side) { ack?.({ ok: false, message: "还没轮到你行棋" }); return; }
      try {
        room.game.move(payload.move);
        settleIfFinished(room);
        ack?.({ ok: true });
        room.broadcast();
      } catch (error) {
        ack?.({ ok: false, message: error instanceof ShogiRuleError ? error.message : "走棋被服务器拒绝" });
      }
    });

    socket.on("shogi:ready", (payload: { ready?: unknown }, ack?: Ack) => {
      if (!currentSeat() || !room || !player || room.started || room.players.size !== 2) {
        ack?.({ ok: false, message: "等待另一位玩家加入后再准备" });
        return;
      }
      if (player.accountId === room.hostAccountId) {
        ack?.({ ok: false, message: "房主可以在对手准备后开始游戏" });
        return;
      }
      if (typeof payload?.ready !== "boolean") {
        ack?.({ ok: false, message: "无效的准备状态" });
        return;
      }
      if (payload.ready) room.ready.add(player.side);
      else room.ready.delete(player.side);
      ack?.({ ok: true });
      room.broadcast();
    });

    socket.on("shogi:start", (_payload: unknown, ack?: Ack) => {
      if (!currentSeat() || !room || !player) {
        ack?.({ ok: false, message: "只有房主可以开始尚未开始的对局" });
        return;
      }
      const roomToStart = room;
      const startingPlayer = player;
      if (roomToStart.started || startingPlayer.accountId !== roomToStart.hostAccountId) {
        ack?.({ ok: false, message: "只有房主可以开始尚未开始的对局" });
        return;
      }
      const opponent = [...roomToStart.players.values()].find((candidate) => candidate.accountId !== roomToStart.hostAccountId);
      if (roomToStart.players.size !== 2 || !opponent || ![...roomToStart.players.values()].every((candidate) => candidate.connected)) {
        ack?.({ ok: false, message: "等待两位玩家都在线" });
        return;
      }
      if (!roomToStart.ready.has(opponent.side)) {
        ack?.({ ok: false, message: "等待对手准备" });
        return;
      }
      if (roomToStart.dissolved || roomToStart.endedAt !== null) {
        ack?.({ ok: false, message: "房间即将解散" });
        return;
      }
      if (roomToStart.game.view().status !== "playing") roomToStart.game.reset();
      roomToStart.markStarted();
      ack?.({ ok: true });
      roomToStart.broadcast();
    });

    socket.on("shogi:resign", (payload: { roomCode?: unknown }, ack?: Ack) => {
      if (!currentSeat() || !room || !player || findRoom(payload?.roomCode)?.code !== room.code) {
        ack?.({ ok: false, message: "无效的投降请求" });
        return;
      }
      if (!room.started || room.startedAt === null) { ack?.({ ok: false, message: "对局尚未开始" }); return; }
      if (room.endedAt !== null || room.dissolved || room.game.gameStatus !== "playing") {
        ack?.({ ok: false, message: "对局已经结束" });
        return;
      }
      const waitMs = room.surrenderWaitMs();
      if (waitMs > 0) {
        ack?.({ ok: false, message: `开局满 3 分钟后才能投降，还需等待 ${Math.ceil(waitMs / 1000)} 秒` });
        return;
      }
      room.game.resign(player.side);
      settleIfFinished(room);
      ack?.({ ok: true });
      room.broadcast();
    });

    socket.on("shogi:leave", (_payload: unknown, ack?: Ack) => {
      if (room && !player && room.spectators.delete(account.id)) { socket.leave(room.code); room.sockets.delete(socket); room = null; ack?.({ ok: true }); return; }
      if (!currentSeat() || !room || !player) { ack?.({ ok: false, message: "当前账号不在房间中" }); return; }
      const leavingRoom = room;
      const leavingPlayer = player;
      if (leavingRoom.started && leavingRoom.endedAt === null && leavingRoom.game.view().status === "playing") {
        leavingRoom.game.resign(leavingPlayer.side);
        settleIfFinished(leavingRoom);
      }
      leavingRoom.removePlayer(leavingPlayer);
      room = null;
      player = null;
      socket.emit("shogi:closed", { message: "已退出房间" });
      ack?.({ ok: true });
      if (leavingRoom.players.size === 0) dissolveRoom(leavingRoom);
      else leavingRoom.broadcast();
    });

    socket.on("disconnect", () => {
      clearTimeout(expiryTimer);
      if (!room) return;
      const disconnectedRoom = room;
      if (!player) { disconnectedRoom.spectators.delete(account.id); disconnectedRoom.sockets.delete(socket); room = null; disconnectedRoom.broadcast(); return; }
      const disconnectedPlayer = disconnectedRoom.detach(socket);
      if (!disconnectedPlayer) return;
      disconnectedRoom.broadcast();
      const timer = setTimeout(() => {
        disconnectedRoom.graceTimers.delete(timer);
        if (disconnectedRoom.dissolved) return;
        if (disconnectedRoom.removeDisconnectedPlayer(disconnectedPlayer)) {
          if (disconnectedRoom.players.size === 0) dissolveRoom(disconnectedRoom);
          else disconnectedRoom.broadcast();
        }
      }, RECONNECT_GRACE_MS);
      disconnectedRoom.graceTimers.add(timer);
      timer.unref?.();
    });
  });

  const listen = (port = Number(process.env.SHOGI_PORT ?? 3001), host = process.env.SHOGI_HOST ?? "127.0.0.1"): Promise<number> => new Promise((resolve, reject) => {
    const onError = (error: Error) => { httpServer.off("listening", onListening); reject(error); };
    const onListening = () => { httpServer.off("error", onError); const address = httpServer.address(); if (!address || typeof address === "string") { reject(new Error("Unable to resolve shogi port")); return; } resolve(address.port); };
    httpServer.once("error", onError); httpServer.once("listening", onListening); httpServer.listen(port, host);
  });
  const close = async (): Promise<void> => {
    for (const room of [...rooms.values()]) {
      room.dissolve();
    }
    rooms.clear();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    if (httpServer.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };
  return { app, httpServer, io, rooms, auth, listen, close };
}
