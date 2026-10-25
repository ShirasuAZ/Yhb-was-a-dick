import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Server as SocketServer, Socket } from "socket.io";
import type {
  ActionAck,
  CardColor,
  CreateRoomResult,
  JoinRoomResult,
  MutationAck,
  RoomState,
  ServerToClientEvents,
  ClientToServerEvents,
  PublicPlayer,
  OwnPlayer,
  QuickEmoji
} from "../shared/protocol.ts";
import { isQuickEmoji } from "../shared/protocol.ts";
import { UnoGame } from "./game/game.ts";
import {
  LanAccessController,
  type LanStatus
} from "./lan.ts";
import {
  AuthService,
  type PublicAccount
} from "./auth.ts";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export class RoomError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RoomError";
    this.code = code;
  }
}

export interface RoomPlayer {
  id: string;
  accountId: string;
  name: string;
  seat: number;
  tokenHash: string;
  connected: boolean;
  socketId: string | null;
  ready: boolean;
  active: boolean;
}
export interface RoomSpectator { id: string; accountId: string; name: string; socketId: string; connected: boolean; }

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECONNECT_GRACE_SECONDS = 10 * 60;
export const LOBBY_RECONNECT_GRACE_SECONDS = 8;
export const PENALTY_RESPONSE_SECONDS = 20;
const ROOM_IDLE_TTL_MS = 30 * 60 * 1000;
const ACTION_HISTORY_SIZE = 200;

function normalizeRoomCode(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new RoomError("INVALID_ROOM_CODE", "请输入房间号");
  }
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    throw new RoomError("INVALID_ROOM_CODE", "房间号应为 6 位字符");
  }
  return code;
}

function normalizeActionId(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 8 || raw.length > 80) {
    throw new RoomError("INVALID_ACTION_ID", "操作编号无效");
  }
  return raw;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class Room {
  readonly code: string;
  readonly createdAt = Date.now();
  hostId: string;
  phase: "lobby" | "playing" | "finished" = "lobby";
  players: RoomPlayer[] = [];
  spectators: RoomSpectator[] = [];
  game: UnoGame | null = null;
  lastActivity = Date.now();

  private readonly manager: RoomManager;
  private readonly recentActions = new Map<string, Set<string>>();
  private readonly recentEmotes = new Map<string, Set<string>>();
  private readonly emoteTimes = new Map<string, number[]>();
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();
  private penaltyTimer: NodeJS.Timeout | null = null;
  private penaltyTimerKey: string | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(manager: RoomManager, code: string, hostId: string) {
    this.manager = manager;
    this.code = code;
    this.hostId = hostId;
  }

  addPlayer(player: RoomPlayer): void {
    this.players.push(player);
    this.touch();
  }

  findPlayer(playerId: string): RoomPlayer | undefined {
    return this.players.find((player) => player.id === playerId);
  }

  findPlayerByToken(token: string): RoomPlayer | undefined {
    const tokenHash = hashToken(token);
    return this.players.find(
      (player) => player.tokenHash === tokenHash && player.active
    );
  }

  getPlayerBySocket(socketId: string): RoomPlayer | undefined {
    return this.players.find((player) => player.socketId === socketId);
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  publicStateFor(playerId: string): RoomState {
    const viewer = this.findPlayer(playerId);
    const spectator = this.spectators.find((entry) => entry.id === playerId);
    if (!viewer && !spectator) throw new RoomError("PLAYER_NOT_FOUND", "用户不在房间中");
    const gamePlayers = new Map(
      this.game?.players.map((player) => [player.id, player]) ?? []
    );
    const players: PublicPlayer[] = this.players.map((player) => {
      const gamePlayer = gamePlayers.get(player.id);
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        connected: player.connected,
        ready: player.ready,
        isHost: player.id === this.hostId,
        active: player.active,
        handCount: gamePlayer?.hand.length ?? 0,
        unoDeclared: gamePlayer?.unoDeclared ?? false
      };
    });
    const viewerGamePlayer = gamePlayers.get(playerId);
    const you: OwnPlayer = {
      id: viewer?.id ?? spectator!.id,
      name: viewer?.name ?? spectator!.name,
      seat: viewer?.seat ?? -1,
      connected: viewer?.connected ?? true,
      ready: viewer?.ready ?? false,
      isHost: viewer?.id === this.hostId,
      active: viewer?.active ?? true,
      handCount: viewerGamePlayer?.hand.length ?? 0,
      unoDeclared: viewerGamePlayer?.unoDeclared ?? false,
      hand: viewer ? [...(viewerGamePlayer?.hand ?? [])] : []
    };

    return {
      roomCode: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players,
      spectators: this.spectators.map((entry) => ({ id: entry.id, name: entry.name, connected: entry.connected })),
      youAreSpectator: !viewer,
      you,
      game: this.game?.publicView(viewer ? playerId : "") ?? null,
      reconnectionGraceSeconds:
        this.phase === "lobby"
          ? LOBBY_RECONNECT_GRACE_SECONDS
          : RECONNECT_GRACE_SECONDS
    };
  }

  emitStates(): void {
    for (const player of this.players) {
      if (!player.connected || !player.socketId) {
        continue;
      }
      this.manager.io
        .to(player.socketId)
        .emit("room_state", this.publicStateFor(player.id));
    }
    for (const spectator of this.spectators) {
      if (spectator.connected) this.manager.io.to(spectator.socketId).emit("room_state", this.publicStateFor(spectator.id));
    }
  }

  emitStateTo(playerId: string): void {
    const player = this.findPlayer(playerId);
    if (!player?.connected || !player.socketId) {
      return;
    }
    this.manager.io
      .to(player.socketId)
      .emit("room_state", this.publicStateFor(player.id));
  }

  runAction(
    playerId: string,
    rawActionId: unknown,
    action: () => void
  ): boolean {
    const actionId = normalizeActionId(rawActionId);
    const seen = this.recentActions.get(playerId) ?? new Set<string>();
    if (seen.has(actionId)) {
      return true;
    }
    action();
    seen.add(actionId);
    if (seen.size > ACTION_HISTORY_SIZE) {
      const first = seen.values().next().value;
      if (typeof first === "string") {
        seen.delete(first);
      }
    }
    this.recentActions.set(playerId, seen);
    this.touch();
    this.syncTimers();
    this.emitStates();
    return false;
  }

  setReady(playerId: string, ready: boolean, actionId: unknown): boolean {
    const player = this.requireActivePlayer(playerId);
    if (this.isRepeatedAction(playerId, actionId)) {
      return true;
    }
    if (this.phase !== "lobby") {
      throw new RoomError("GAME_ALREADY_STARTED", "对局已经开始");
    }
    if (player.id === this.hostId) {
      throw new RoomError("HOST_ALWAYS_READY", "房主无需切换准备状态");
    }
    return this.runAction(playerId, actionId, () => {
      player.ready = ready;
    });
  }

  startGame(playerId: string, actionId: unknown): boolean {
    const player = this.requireActivePlayer(playerId);
    if (this.isRepeatedAction(playerId, actionId)) {
      return true;
    }
    if (player.id !== this.hostId) {
      throw new RoomError("HOST_ONLY", "只有房主可以开始游戏");
    }
    if (this.phase !== "lobby") {
      throw new RoomError("GAME_ALREADY_STARTED", "对局已经开始");
    }
    const activePlayers = this.players.filter((candidate) => candidate.active);
    if (activePlayers.length < 2) {
      throw new RoomError("NOT_ENOUGH_PLAYERS", "至少需要 2 名玩家");
    }
    if (activePlayers.length > 6) {
      throw new RoomError("TOO_MANY_PLAYERS", "最多支持 6 名玩家");
    }
    if (activePlayers.some((candidate) => !candidate.connected)) {
      throw new RoomError("PLAYER_OFFLINE", "所有玩家都必须在线");
    }
    if (
      activePlayers.some(
        (candidate) => candidate.id !== this.hostId && !candidate.ready
      )
    ) {
      throw new RoomError("PLAYERS_NOT_READY", "仍有玩家未准备");
    }
    return this.runAction(playerId, actionId, () => {
      this.game = new UnoGame(
        activePlayers.map((candidate) => ({
          id: candidate.id,
          name: candidate.name
        })),
        { gameKey: randomUUID() }
      );
      this.phase = "playing";
    });
  }

  restartGame(playerId: string, actionId: unknown): boolean {
    const player = this.requireActivePlayer(playerId);
    if (this.isRepeatedAction(playerId, actionId)) {
      return true;
    }
    if (player.id !== this.hostId) {
      throw new RoomError("HOST_ONLY", "只有房主可以开始新一局");
    }
    if (this.phase !== "finished") {
      throw new RoomError("GAME_NOT_FINISHED", "当前对局尚未结束");
    }
    const activePlayers = this.players.filter((candidate) => candidate.active);
    if (activePlayers.length < 2) {
      throw new RoomError("NOT_ENOUGH_PLAYERS", "至少需要 2 名玩家");
    }
    if (activePlayers.some((candidate) => !candidate.connected)) {
      throw new RoomError("PLAYER_OFFLINE", "所有玩家都必须在线");
    }
    return this.runAction(playerId, actionId, () => {
      this.game = new UnoGame(
        activePlayers.map((candidate) => ({
          id: candidate.id,
          name: candidate.name
        })),
        { gameKey: randomUUID() }
      );
      this.phase = "playing";
    });
  }

  playCard(
    playerId: string,
    cardId: unknown,
    color: unknown,
    expectedTurnNumber: unknown,
    actionId: unknown
  ): boolean {
    this.requireActivePlayer(playerId);
    if (this.isRepeatedAction(playerId, actionId)) {
      return true;
    }
    this.requirePlayingPlayer(playerId);
    this.requireExpectedTurn(expectedTurnNumber);
    if (typeof cardId !== "string") {
      throw new RoomError("INVALID_CARD", "卡牌编号无效");
    }
    if (
      color !== undefined &&
      color !== "red" &&
      color !== "yellow" &&
      color !== "green" &&
      color !== "blue"
    ) {
      throw new RoomError("INVALID_COLOR", "颜色无效");
    }
    return this.runAction(playerId, actionId, () => {
      this.game!.playCard(playerId, cardId, color as CardColor | undefined);
      this.syncPhase();
    });
  }

  drawCard(
    playerId: string,
    expectedTurnNumber: unknown,
    actionId: unknown
  ): boolean {
    this.requireActivePlayer(playerId);
    if (this.isRepeatedAction(playerId, actionId)) {
      return true;
    }
    this.requirePlayingPlayer(playerId);
    this.requireExpectedTurn(expectedTurnNumber);
    return this.runAction(playerId, actionId, () => {
      this.game!.drawCard(playerId);
      this.syncPhase();
    });
  }

  endTurn(
    playerId: string,
    expectedTurnNumber: unknown,
    actionId: unknown
  ): boolean {
    this.requireActivePlayer(playerId);
    if (this.isRepeatedAction(playerId, actionId)) {
      return true;
    }
    this.requirePlayingPlayer(playerId);
    this.requireExpectedTurn(expectedTurnNumber);
    return this.runAction(playerId, actionId, () => {
      this.game!.endTurn(playerId);
      this.syncPhase();
    });
  }

  declareUno(playerId: string, actionId: unknown): boolean {
    this.requireActivePlayer(playerId);
    if (this.isRepeatedAction(playerId, actionId)) {
      return true;
    }
    this.requirePlayingPlayer(playerId);
    return this.runAction(playerId, actionId, () => {
      this.game!.declareUno(playerId);
      this.syncPhase();
    });
  }

  catchUno(playerId: string, targetId: unknown, actionId: unknown): boolean {
    this.requireActivePlayer(playerId);
    if (this.isRepeatedAction(playerId, actionId)) {
      return true;
    }
    this.requirePlayingPlayer(playerId);
    if (typeof targetId !== "string") {
      throw new RoomError("INVALID_TARGET", "目标玩家无效");
    }
    return this.runAction(playerId, actionId, () => {
      this.game!.catchUno(playerId, targetId);
      this.syncPhase();
    });
  }

  respondPenalty(
    playerId: string,
    decision: unknown,
    expectedTurnNumber: unknown,
    actionId: unknown
  ): boolean {
    this.requireActivePlayer(playerId);
    if (this.isRepeatedAction(playerId, actionId)) {
      return true;
    }
    this.requirePlayingPlayer(playerId);
    this.requireExpectedTurn(expectedTurnNumber);
    if (decision !== "accept" && decision !== "challenge") {
      throw new RoomError("INVALID_DECISION", "请选择接受或质疑");
    }
    return this.runAction(playerId, actionId, () => {
      this.game!.respondPenalty(playerId, decision);
      this.syncPhase();
    });
  }

  sendEmote(
    playerId: string,
    rawEmoji: unknown,
    rawActionId: unknown
  ): boolean {
    const player = this.requireActivePlayer(playerId);
    if (this.phase === "lobby" || !this.game) {
      throw new RoomError("GAME_NOT_STARTED", "对局开始后才能发送表情");
    }
    if (!isQuickEmoji(rawEmoji)) {
      throw new RoomError("INVALID_EMOTE", "不支持该表情");
    }
    const actionId = normalizeActionId(rawActionId);
    const seen = this.recentEmotes.get(playerId) ?? new Set<string>();
    if (seen.has(actionId)) {
      return true;
    }

    const now = Date.now();
    const recent = (this.emoteTimes.get(playerId) ?? []).filter(
      (timestamp) => now - timestamp < 1000
    );
    if (recent.length >= 2) {
      throw new RoomError("EMOTE_RATE_LIMIT", "发送太快了，请稍后再试");
    }
    recent.push(now);
    this.emoteTimes.set(playerId, recent);

    seen.add(actionId);
    if (seen.size > ACTION_HISTORY_SIZE) {
      const first = seen.values().next().value;
      if (typeof first === "string") {
        seen.delete(first);
      }
    }
    this.recentEmotes.set(playerId, seen);
    this.touch();

    this.manager.io.to(this.code).emit("emote", {
      id: randomUUID(),
      playerId: player.id,
      emoji: rawEmoji as QuickEmoji,
      sentAt: now
    });
    return false;
  }

  leave(playerId: string): void {
    const player = this.requireActivePlayer(playerId);
    const wasHost = this.hostId === playerId;
    this.clearOfflineTimer(playerId);
    this.recentActions.delete(playerId);
    this.recentEmotes.delete(playerId);
    this.emoteTimes.delete(playerId);
    this.manager.detachSocket(player, this.code);

    if (this.phase === "lobby") {
      this.players = this.players.filter((candidate) => candidate.id !== playerId);
      this.players.forEach((candidate, index) => {
        candidate.seat = index;
      });
    } else {
      if (this.phase === "playing") {
        this.game?.forfeit(playerId);
      }
      player.active = false;
      player.connected = false;
      player.socketId = null;
      player.ready = false;
      this.syncPhase();
    }

    if (wasHost) {
      this.transferHost();
    }
    this.touch();
    this.syncTimers();

    if (this.players.length === 0 || !this.players.some((candidate) => candidate.active)) {
      this.manager.deleteRoom(this.code);
      return;
    }
    this.emitStates();
    this.manager.checkIdleRoom(this);
  }

  handleDisconnect(socketId: string): void {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return;
    }
    player.connected = false;
    player.socketId = null;
    this.touch();
    if (this.hostId === player.id) {
      this.transferHost();
    }
    this.scheduleOfflineTimeout(player.id);
    this.emitStates();
    this.manager.checkIdleRoom(this);
  }

  resume(player: RoomPlayer, socket: AppSocket): void {
    const previousSocket = player.socketId;
    player.connected = true;
    player.socketId = socket.id;
    player.ready = player.id === this.hostId ? true : player.ready;
    this.clearOfflineTimer(player.id);
    socket.data.roomCode = this.code;
    socket.data.playerId = player.id;
    socket.join(this.code);
    if (previousSocket && previousSocket !== socket.id) {
      const oldSocket = this.manager.io.sockets.sockets.get(previousSocket);
      if (oldSocket) {
        oldSocket.emit("session_replaced", {
          message: "该账号已在另一台设备进入房间，本机已退出该座位"
        });
        oldSocket.leave(this.code);
        oldSocket.data.roomCode = undefined;
        oldSocket.data.playerId = undefined;
      }
    }
    this.transferHost();
    this.touch();
    this.emitStateTo(player.id);
  }

  private requireActivePlayer(playerId: string): RoomPlayer {
    const player = this.findPlayer(playerId);
    if (!player || !player.active) {
      throw new RoomError("PLAYER_NOT_FOUND", "玩家不在房间中");
    }
    return player;
  }

  private requirePlayingPlayer(playerId: string): RoomPlayer {
    const player = this.requireActivePlayer(playerId);
    if (this.phase !== "playing" || !this.game) {
      throw new RoomError("GAME_NOT_PLAYING", "对局尚未进行");
    }
    return player;
  }

  private requireExpectedTurn(expected: unknown): void {
    if (
      typeof expected !== "number" ||
      !Number.isInteger(expected) ||
      expected !== this.game?.turnNumber
    ) {
      throw new RoomError(
        "STALE_ACTION",
        "游戏状态已更新，请按最新回合重新操作"
      );
    }
  }

  private isRepeatedAction(playerId: string, rawActionId: unknown): boolean {
    const actionId = normalizeActionId(rawActionId);
    return this.recentActions.get(playerId)?.has(actionId) ?? false;
  }

  private syncPhase(): void {
    if (this.game?.status === "finished") {
      this.phase = "finished";
    }
  }

  transferHost(): void {
    const current = this.findPlayer(this.hostId);
    if (current?.active && current.connected) {
      current.ready = true;
      return;
    }
    const candidates = this.players
      .filter((player) => player.active && player.connected)
      .sort((a, b) => a.seat - b.seat);
    if (candidates[0]) {
      this.hostId = candidates[0].id;
      candidates[0].ready = true;
    }
  }

  private scheduleOfflineTimeout(playerId: string): void {
    this.clearOfflineTimer(playerId);
    const graceSeconds =
      this.phase === "lobby"
        ? LOBBY_RECONNECT_GRACE_SECONDS
        : RECONNECT_GRACE_SECONDS;
    const timer = setTimeout(() => {
      const room = this.manager.rooms.get(this.code);
      if (!room) {
        return;
      }
      const player = this.findPlayer(playerId);
      if (!player || player.connected || !player.active) {
        return;
      }
      player.active = false;
      this.recentActions.delete(playerId);
      this.recentEmotes.delete(playerId);
      this.emoteTimes.delete(playerId);
      if (this.phase === "lobby") {
        this.players = this.players.filter((candidate) => candidate.id !== playerId);
        this.players.forEach((candidate, index) => {
          candidate.seat = index;
        });
      } else if (this.phase === "playing") {
        this.game?.forfeit(playerId);
        this.syncPhase();
      }
      if (this.hostId === playerId) {
        this.transferHost();
      }
      this.syncTimers();
      if (
        this.players.length === 0 ||
        !this.players.some((candidate) => candidate.active)
      ) {
        this.manager.deleteRoom(this.code);
        return;
      }
      this.emitStates();
      this.manager.checkIdleRoom(this);
    }, graceSeconds * 1000);
    timer.unref();
    this.offlineTimers.set(playerId, timer);
  }

  private clearOfflineTimer(playerId: string): void {
    const timer = this.offlineTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.offlineTimers.delete(playerId);
    }
  }

  syncTimers(): void {
    const pending = this.game?.pendingPenalty;
    if (!pending || this.phase !== "playing") {
      if (this.penaltyTimer) {
        clearTimeout(this.penaltyTimer);
        this.penaltyTimer = null;
      }
      this.penaltyTimerKey = null;
      return;
    }
    const key = `${pending.targetId}:${pending.attackerId}`;
    if (this.penaltyTimer && this.penaltyTimerKey === key) {
      return;
    }
    if (this.penaltyTimer) {
      clearTimeout(this.penaltyTimer);
      this.penaltyTimer = null;
    }
    this.penaltyTimerKey = key;
    const targetId = pending.targetId;
    const attackerId = pending.attackerId;
    this.penaltyTimer = setTimeout(() => {
      this.penaltyTimer = null;
      this.penaltyTimerKey = null;
      const activePending = this.game?.pendingPenalty;
      if (
        !activePending ||
        activePending.targetId !== targetId ||
        activePending.attackerId !== attackerId
      ) {
        return;
      }
      try {
        this.game?.respondPenalty(targetId, "accept");
        this.syncPhase();
        this.emitStates();
      } catch {
        // The room state remains authoritative if the response became stale.
      }
    }, PENALTY_RESPONSE_SECONDS * 1000);
    this.penaltyTimer.unref();
  }

  setIdleTimer(timer: NodeJS.Timeout | null): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = timer;
  }

  clearTimers(): void {
    for (const timer of this.offlineTimers.values()) {
      clearTimeout(timer);
    }
    this.offlineTimers.clear();
    if (this.penaltyTimer) {
      clearTimeout(this.penaltyTimer);
      this.penaltyTimer = null;
    }
    this.penaltyTimerKey = null;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

export class RoomManager {
  readonly io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
  readonly rooms = new Map<string, Room>();
  readonly lanAccess: LanAccessController;
  readonly auth: AuthService;

  constructor(
    io: SocketServer<ClientToServerEvents, ServerToClientEvents>,
    lanAccess = new LanAccessController(),
    auth = new AuthService()
  ) {
    this.io = io;
    this.lanAccess = lanAccess;
    this.auth = auth;
  }

  private generateRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const bytes = randomBytes(6);
      let code = "";
      for (let index = 0; index < 6; index += 1) {
        const byte = bytes[index] ?? 0;
        code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new RoomError("ROOM_CODE_EXHAUSTED", "暂时无法创建房间，请重试");
  }

  createRoom(socket: AppSocket, _rawName: unknown): CreateRoomResult {
    this.requireDetached(socket);
    const account = this.requireAccount(socket);
    const code = this.generateRoomCode();
    const token = randomBytes(32).toString("base64url");
    const player: RoomPlayer = {
      id: randomUUID(),
      accountId: account.id,
      name: account.username,
      seat: 0,
      tokenHash: hashToken(token),
      connected: true,
      socketId: socket.id,
      ready: true,
      active: true
    };
    const room = new Room(this, code, player.id);
    room.addPlayer(player);
    this.rooms.set(code, room);
    this.attachSocket(room, player, socket);
    room.emitStates();
    return { roomCode: code, playerId: player.id, token };
  }

  joinRoom(
    socket: AppSocket,
    rawCode: unknown,
    rawName: unknown
  ): JoinRoomResult {
    this.requireDetached(socket);
    const code = normalizeRoomCode(rawCode);
    void rawName;
    const account = this.requireAccount(socket);
    const room = this.rooms.get(code);
    if (!room) {
      throw new RoomError("ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const existing = room.players.find(
      (player) => player.accountId === account.id && player.active
    );
    if (existing) {
      const token = randomBytes(32).toString("base64url");
      existing.tokenHash = hashToken(token);
      room.resume(existing, socket);
      room.emitStates();
      return { roomCode: code, playerId: existing.id, token };
    }
    if (room.phase !== "lobby") {
      throw new RoomError("GAME_IN_PROGRESS", "对局已经开始，不能加入");
    }
    const activePlayers = room.players.filter((player) => player.active);
    if (activePlayers.length >= 6) {
      throw new RoomError("ROOM_FULL", "房间已满");
    }
    if (
      activePlayers.some(
        (player) =>
          player.name.toLocaleLowerCase("en-US") ===
          account.username.toLocaleLowerCase("en-US")
      )
    ) {
      throw new RoomError("NAME_TAKEN", "该名称已在房间中使用");
    }
    const token = randomBytes(32).toString("base64url");
    const player: RoomPlayer = {
      id: randomUUID(),
      accountId: account.id,
      name: account.username,
      seat: activePlayers.length,
      tokenHash: hashToken(token),
      connected: true,
      socketId: socket.id,
      ready: false,
      active: true
    };
    room.addPlayer(player);
    this.attachSocket(room, player, socket);
    room.emitStates();
    return { roomCode: code, playerId: player.id, token };
  }

  resumeSession(
    socket: AppSocket,
    rawCode: unknown,
    rawToken: unknown
  ): JoinRoomResult {
    this.requireDetached(socket);
    const code = normalizeRoomCode(rawCode);
    if (typeof rawToken !== "string" || rawToken.length < 20) {
      throw new RoomError("INVALID_SESSION", "重连凭证无效");
    }
    const room = this.rooms.get(code);
    if (!room) {
      throw new RoomError("ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const account = this.requireAccount(socket);
    const player = room.findPlayerByToken(rawToken);
    if (!player) {
      throw new RoomError("INVALID_SESSION", "重连凭证无效或座位已释放");
    }
    if (player.accountId !== account.id) {
      throw new RoomError("INVALID_SESSION", "该重连凭证不属于当前账号");
    }
    room.resume(player, socket);
    this.clearIdleRoom(room);
    room.emitStates();
    return { roomCode: code, playerId: player.id, token: rawToken };
  }

  private requireDetached(socket: AppSocket): void {
    if (socket.data.spectatingRoom) throw new RoomError("ALREADY_IN_ROOM", "请先退出观战席");
    if (socket.data.roomCode) {
      const existing = this.rooms.get(socket.data.roomCode);
      const player = existing?.getPlayerBySocket(socket.id);
      if (existing && player) {
        throw new RoomError("ALREADY_IN_ROOM", "当前连接已经在房间中");
      }
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
    }
  }

  private attachSocket(room: Room, player: RoomPlayer, socket: AppSocket): void {
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    this.clearIdleRoom(room);
  }

  spectateRoom(socket: AppSocket, rawCode: unknown): void {
    this.requireDetached(socket);
    const code = normalizeRoomCode(rawCode);
    const room = this.rooms.get(code);
    const account = this.requireAccount(socket);
    if (!room) throw new RoomError("ROOM_NOT_FOUND", "房间不存在或已关闭");
    if (room.players.some((entry) => entry.accountId === account.id)) throw new RoomError("ALREADY_IN_ROOM", "你已经在该房间中");
    const spectator = { id: randomUUID(), accountId: account.id, name: account.username, socketId: socket.id, connected: true };
    room.spectators.push(spectator);
    socket.data.spectatingRoom = room.code;
    socket.data.spectatorId = spectator.id;
    socket.join(room.code);
    room.emitStates();
  }

  leaveSpectating(socket: AppSocket): void {
    const code = socket.data.spectatingRoom;
    const room = code ? this.rooms.get(code) : undefined;
    if (room) {
      room.spectators = room.spectators.filter((entry) => entry.id !== socket.data.spectatorId);
      room.emitStates();
    }
    socket.data.spectatingRoom = undefined;
    socket.data.spectatorId = undefined;
    if (code) socket.leave(code);
  }

  detachSocket(player: RoomPlayer, roomCode: string): void {
    if (!player.socketId) {
      return;
    }
    const socket = this.io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.leave(roomCode);
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
    }
  }

  handleConnection(socket: AppSocket): void {
    socket.on("auth_register", (payload, ack) => {
      this.respond(ack, () => {
        this.requireNoRoomForAuth(socket);
        const result = this.auth.register(
          payload?.username,
          payload?.password,
          payload?.email,
          socket.handshake.address
        );
        socket.data.accountId = result.account.id;
        return result;
      });
    });
    socket.on("auth_login", (payload, ack) => {
      this.respond(ack, () => {
        this.requireNoRoomForAuth(socket);
        const result = this.auth.login(
          payload?.username,
          payload?.password,
          socket.handshake.address
        );
        socket.data.accountId = result.account.id;
        return result;
      });
    });
    socket.on("auth_me", (_payload, ack) => {
      this.respond(ack, () => {
        const account = this.requireAccount(socket);
        return { account };
      });
    });
    socket.on("social_get", (_payload, ack) => this.respond(ack, () => this.auth.socialState(this.requireAccount(socket).id)));
    socket.on("social_search", (payload, ack) => this.respond(ack, () => ({ accounts: this.auth.searchAccounts(payload?.query, this.requireAccount(socket).id) })));
    socket.on("social_request", (payload, ack) => this.respond(ack, () => { const account = this.requireAccount(socket); this.auth.sendFriendRequest(account.id, payload?.target); const target = this.auth.searchAccounts(String(payload?.target), account.id)[0]; if (target) this.notifyAccount(target.id); return { duplicate: false }; }));
    socket.on("social_accept", (payload, ack) => this.respond(ack, () => { const account = this.requireAccount(socket); this.auth.acceptFriendRequest(account.id, payload?.requesterId); this.notifyAccount(account.id); this.notifyAccount(String(payload?.requesterId)); return { duplicate: false }; }));
    socket.on("social_reject", (payload, ack) => this.respond(ack, () => { const account = this.requireAccount(socket); this.auth.rejectFriendRequest(account.id, payload?.requesterId); this.notifyAccount(String(payload?.requesterId)); return { duplicate: false }; }));
    socket.on("social_invite", (payload, ack) => this.respond(ack, () => {
      const account = this.requireAccount(socket);
      if (!this.auth.areFriends(account.id, payload?.targetId)) throw new RoomError("NOT_FRIENDS", "只能邀请好友");
      this.auth.inviteFriend(account.id, String(payload?.targetId), payload?.game, String(payload?.roomCode), payload?.role);
      const target = this.io.sockets.sockets;
      for (const candidate of target.values()) if (candidate.data.accountId === payload?.targetId) candidate.emit("friend_room_invite", { game: payload.game, roomCode: payload.roomCode, inviter: account.username, role: payload.role });
      return { duplicate: false };
    }));
    socket.on("auth_logout", (_payload, ack) => {
      this.respond(ack, () => {
        this.requireNoRoomForAuth(socket);
        socket.data.accountId = undefined;
        return { duplicate: false };
      });
    });
    socket.on("auth_reset_password", (payload, ack) => {
      this.respond(ack, () => {
        this.auth.resetPassword(payload?.username, payload?.email, payload?.password, socket.handshake.address);
        return undefined;
      });
    });
    socket.on("auth_delete_account", (payload, ack) => {
      this.respond(ack, () => {
        this.requireNoRoomForAuth(socket);
        const account = this.requireAccount(socket);
        this.auth.deleteAccount(account.id, payload?.password);
        socket.data.accountId = undefined;
        return undefined;
      });
    });
    socket.on("auth_change_password", (payload, ack) => {
      this.respond(ack, () => {
        const account = this.requireAccount(socket);
        return this.auth.changePassword(account.id, payload?.currentPassword, payload?.newPassword);
      });
    });
    socket.on("auth_begin_email_change", (payload, ack) => {
      this.respondAsync(ack, async () => {
        const account = this.requireAccount(socket);
        await this.auth.beginEmailChange(account.id, payload?.currentPassword, payload?.email);
        return undefined;
      });
    });
    socket.on("auth_verify_email_change", (payload, ack) => {
      this.respond(ack, () => {
        const account = this.requireAccount(socket);
        return { account: this.auth.verifyEmailChange(account.id, payload?.code) };
      });
    });
    socket.on("create_room", (payload, ack) => {
      this.respond(ack, () => this.createRoom(socket, payload?.name));
    });
    socket.on("join_room", (payload, ack) => {
      this.respond(ack, () =>
        this.joinRoom(socket, payload?.roomCode, payload?.name)
      );
    });
    socket.on("spectate_room", (payload, ack) => this.respond(ack, () => { this.spectateRoom(socket, payload?.roomCode); return undefined; }));
    socket.on("leave_spectating", (_payload, ack) => this.respond(ack, () => { this.leaveSpectating(socket); return { duplicate: false }; }));
    socket.on("resume_session", (payload, ack) => {
      this.respond(ack, () =>
        this.resumeSession(socket, payload?.roomCode, payload?.token)
      );
    });
    socket.on("sync_room", (_payload, ack) => {
      this.withPlayer(
        socket,
        () => ({ duplicate: false }),
        ack
      );
    });
    socket.on("set_ready", (payload, ack) => {
      this.withPlayer(socket, (room, player) => {
        if (typeof payload?.ready !== "boolean") {
          throw new RoomError("INVALID_READY", "准备状态无效");
        }
        const duplicate = room.setReady(
          player.id,
          payload.ready,
          payload?.actionId
        );
        return { duplicate };
      }, ack);
    });
    socket.on("start_game", (payload, ack) => {
      this.withPlayer(socket, (room, player) => {
        const duplicate = room.startGame(player.id, payload?.actionId);
        return { duplicate };
      }, ack);
    });
    socket.on("restart_game", (payload, ack) => {
      this.withPlayer(socket, (room, player) => {
        const duplicate = room.restartGame(player.id, payload?.actionId);
        return { duplicate };
      }, ack);
    });
    socket.on("leave_room", (payload, ack) => {
      this.withPlayer(
        socket,
        (room, player) => {
          room.leave(player.id);
          socket.data.roomCode = undefined;
          socket.data.playerId = undefined;
          return { duplicate: false };
        },
        ack
      );
    });
    socket.on("play_card", (payload, ack) => {
      this.withPlayer(socket, (room, player) => {
        const duplicate = room.playCard(
          player.id,
          payload?.cardId,
          payload?.color,
          payload?.turnNumber,
          payload?.actionId
        );
        return { duplicate };
      }, ack);
    });
    socket.on("draw_card", (payload, ack) => {
      this.withPlayer(socket, (room, player) => {
        const duplicate = room.drawCard(
          player.id,
          payload?.turnNumber,
          payload?.actionId
        );
        return { duplicate };
      }, ack);
    });
    socket.on("end_turn", (payload, ack) => {
      this.withPlayer(socket, (room, player) => {
        const duplicate = room.endTurn(
          player.id,
          payload?.turnNumber,
          payload?.actionId
        );
        return { duplicate };
      }, ack);
    });
    socket.on("declare_uno", (payload, ack) => {
      this.withPlayer(socket, (room, player) => {
        const duplicate = room.declareUno(player.id, payload?.actionId);
        return { duplicate };
      }, ack);
    });
    socket.on("catch_uno", (payload, ack) => {
      this.withPlayer(socket, (room, player) => {
        const duplicate = room.catchUno(
          player.id,
          payload?.targetId,
          payload?.actionId
        );
        return { duplicate };
      }, ack);
    });
    socket.on("respond_penalty", (payload, ack) => {
      this.withPlayer(socket, (room, player) => {
        const duplicate = room.respondPenalty(
          player.id,
          payload?.decision,
          payload?.turnNumber,
          payload?.actionId
        );
        return { duplicate };
      }, ack);
    });
    socket.on("send_emote", (payload, ack) => {
      this.respond(ack, () => {
        const code = socket.data.roomCode;
        if (!code) {
          throw new RoomError("NOT_IN_ROOM", "请先加入房间");
        }
        const room = this.rooms.get(code);
        if (!room) {
          throw new RoomError("ROOM_NOT_FOUND", "房间不存在或已关闭");
        }
        const player = room.getPlayerBySocket(socket.id);
        if (!player) {
          throw new RoomError("INVALID_SESSION", "当前连接不再拥有该座位");
        }
        const duplicate = room.sendEmote(
          player.id,
          payload?.emoji,
          payload?.actionId
        );
        return { duplicate };
      });
    });
    socket.on("host_get_lan_status", (_payload, rawAck) => {
      // Clients may emit without a callback; never call an undefined ack.
      const ack = typeof rawAck === "function" ? rawAck : (): void => undefined;
      if (!this.requireLocalHostControl(socket, ack)) {
        return;
      }
      ack({ ok: true, data: this.lanAccess.status() });
    });
    socket.on("host_set_lan_access", (payload, rawAck) => {
      const ack = typeof rawAck === "function" ? rawAck : (): void => undefined;
      if (!this.requireLocalHostControl(socket, ack)) {
        return;
      }
      if (typeof payload?.enabled !== "boolean") {
        ack({
          ok: false,
          code: "INVALID_LAN_STATE",
          message: "局域网开关状态无效"
        });
        return;
      }
      const enabled = payload.enabled;
      this.lanAccess.setEnabled(enabled);
      if (!enabled) {
        this.disconnectRemoteSockets();
      }
      const status = this.lanAccess.status();
      this.emitLanStatusToLocalSockets(status);
      ack({ ok: true, data: status });
    });
    socket.on("disconnect", () => {
      if (socket.data.spectatingRoom) this.leaveSpectating(socket);
      const code = socket.data.roomCode;
      if (!code) {
        return;
      }
      const room = this.rooms.get(code);
      room?.handleDisconnect(socket.id);
    });
  }

  private requireAccount(socket: AppSocket): PublicAccount {
    const account = this.auth.findAccount(socket.data.accountId);
    if (!account) {
      throw new RoomError("AUTH_REQUIRED", "请先登录或注册账号");
    }
    return account;
  }

  private notifyAccount(accountId: string): void {
    for (const candidate of this.io.sockets.sockets.values()) if (candidate.data.accountId === accountId) candidate.emit("social_updated");
  }

  private requireNoRoomForAuth(socket: AppSocket): void {
    if (socket.data.roomCode || socket.data.spectatingRoom) {
      throw new RoomError(
        "AUTH_IN_ROOM",
        "请先离开当前房间再切换账号"
      );
    }
  }

  private requireLocalHostControl<T>(
    socket: AppSocket,
    ack: (result: ActionAck<T>) => void
  ): boolean {
    if (process.env.UNO_HOST_CONTROL === "0") {
      ack({
        ok: false,
        code: "HOST_CONTROL_DISABLED",
        message: "此服务器已禁用主机网络控制"
      });
      return false;
    }
    if (this.lanAccess.isLocalAddress(socket.data.clientAddress ?? socket.handshake.address)) {
      return true;
    }
    ack({
      ok: false,
      code: "HOST_CONTROL_LOCAL_ONLY",
      message: "只有运行服务器的本机可以更改局域网开放状态"
    });
    return false;
  }

  private disconnectRemoteSockets(): void {
    for (const socket of this.io.sockets.sockets.values()) {
      if (!this.lanAccess.isLocalAddress(socket.data.clientAddress ?? socket.handshake.address)) {
        socket.disconnect(true);
      }
    }
  }

  private emitLanStatusToLocalSockets(status: LanStatus): void {
    for (const socket of this.io.sockets.sockets.values()) {
      if (this.lanAccess.isLocalAddress(socket.data.clientAddress ?? socket.handshake.address)) {
        socket.emit("lan_status", status);
      }
    }
  }

  private withPlayer(
    socket: AppSocket,
    action: (room: Room, player: RoomPlayer) => unknown,
    ack: (result: MutationAck) => void
  ): void {
    this.respond(ack, () => {
      const code = socket.data.roomCode;
      const playerId = socket.data.playerId;
      if (!code || !playerId) {
        throw new RoomError("NOT_IN_ROOM", "请先加入房间");
      }
      const room = this.rooms.get(code);
      if (!room) {
        throw new RoomError("ROOM_NOT_FOUND", "房间不存在或已关闭");
      }
      const player = room.getPlayerBySocket(socket.id);
      if (!player) {
        throw new RoomError("INVALID_SESSION", "当前连接不再拥有该座位");
      }
      const result = action(room, player);
      const current = room.findPlayer(player.id);
      if (current?.active) {
        // Send the authoritative state directly to the acting socket as well
        // as the room broadcast, so a missed broadcast cannot leave one
        // client showing an old ready/game state.
        socket.emit("room_state", room.publicStateFor(player.id));
      }
      return result;
    });
  }

  // `ack` comes straight from the client; a socket.io emit without a callback leaves it undefined.
  // Calling it unguarded throws inside the event handler and takes the whole process down.
  private respond<T>(rawAck: ((result: ActionAck<T>) => void) | undefined, action: () => T): void {
    const ack = typeof rawAck === "function" ? rawAck : (): void => undefined;
    try {
      const data = action();
      const duplicate =
        typeof data === "object" &&
        data !== null &&
        "duplicate" in data &&
        Boolean((data as { duplicate?: boolean }).duplicate);
      ack({ ok: true, duplicate, data });
    } catch (error) {
      if (error instanceof RoomError || error instanceof Error) {
        const code =
          "code" in error && typeof error.code === "string"
            ? error.code
            : "INTERNAL_ERROR";
        ack({
          ok: false,
          code,
          message:
            error instanceof RoomError || code !== "INTERNAL_ERROR"
              ? error.message
              : "服务器处理操作时发生错误"
        });
        if (code === "INTERNAL_ERROR") {
          console.error(error);
        }
        return;
      }
      ack({ ok: false, code: "UNKNOWN_ERROR", message: "未知错误" });
    }
  }

  private respondAsync<T>(rawAck: ((result: ActionAck<T>) => void) | undefined, action: () => Promise<T>): void {
    const ack = typeof rawAck === "function" ? rawAck : (): void => undefined;
    void action().then((data) => ack({ ok: true, data })).catch((error: unknown) => {
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "INTERNAL_ERROR";
      ack({
        ok: false,
        code,
        message: error instanceof Error && code !== "INTERNAL_ERROR"
          ? error.message
          : "服务器处理操作时发生错误"
      });
      if (code === "INTERNAL_ERROR") console.error(error);
    });
  }

  deleteRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) {
      return;
    }
    room.clearTimers();
    for (const viewer of room.spectators) { const viewerSocket = this.io.sockets.sockets.get(viewer.socketId); if (viewerSocket) { viewerSocket.data.spectatingRoom = undefined; viewerSocket.data.spectatorId = undefined; } }
    this.rooms.delete(code);
    this.io.to(code).emit("room_closed", { message: "房间已关闭" });
    this.io.socketsLeave(code);
  }

  checkIdleRoom(room: Room): void {
    if (room.players.some((player) => player.connected)) {
      this.clearIdleRoom(room);
      return;
    }
    if (!this.rooms.has(room.code)) {
      return;
    }
    const timer = setTimeout(() => {
      if (!this.rooms.has(room.code)) {
        return;
      }
      if (!room.players.some((player) => player.connected)) {
        this.deleteRoom(room.code);
      }
    }, ROOM_IDLE_TTL_MS);
    timer.unref();
    room.setIdleTimer(timer);
  }

  clearIdleRoom(room: Room): void {
    room.setIdleTimer(null);
  }

  close(): void {
    for (const room of this.rooms.values()) {
      room.clearTimers();
    }
    this.rooms.clear();
  }
}
