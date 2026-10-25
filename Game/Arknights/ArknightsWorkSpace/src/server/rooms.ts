import { randomInt } from "node:crypto";
import type { Namespace, Server, Socket } from "socket.io";
import type {
  ActionAck,
  ClientToServerEvents,
  ServerToClientEvents,
  UnionArenaAccount,
  UnionArenaAction,
  UnionArenaAuthProvider,
  UnionArenaPlayer,
  UnionArenaRoomState
} from "../shared/protocol.ts";
import { applyAction, beginFirstTurn, clearBoard, gameStateView, lifeView, newEngineGame, type EngineContext, type EngineGame, type EnginePlayer, type LifeSlot } from "../shared/engine.ts";
import { checkUnionArenaDeck, type UnionArenaCardRecord } from "./types.ts";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECONNECT_GRACE_MS = 30_000;
/** Life cards per player, from the official playmat (seven numbered slots). */
export const LIFE_COUNT = 7;
/** Starting hand size (rule manual, "Preparing to Play" step 3). */
export const HAND_COUNT = 7;
type UaSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** The server's own bookkeeping for a running game (the rules engine's state); the clients only get the public `UnionArenaGameState` derived from it. */
type GameData = EngineGame;

function shuffled<T>(cards: readonly T[]): T[] {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

interface Seat extends UnionArenaPlayer, EnginePlayer {
  accountId: string;
  socketId: string | null;
  /** In life-area order; empty until the game starts. */
  life: LifeSlot[];
  /** The submitted deck, in submission order. Never changes during a game. */
  deck: string[];
  /** What is left of the shuffled deck during a game, top card first. */
  library: string[];
  hand: string[];
  apCount: number;
  deckCheck: ReturnType<typeof checkUnionArenaDeck>;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

export class UnionArenaRoom {
  readonly players: Seat[] = [];
  readonly spectators = new Map<string, { id: string; username: string; socketId: string; connected: boolean }>();
  phase: "lobby" | "playing" = "lobby";
  game: GameData | null = null;
  hostId = "";

  /** Card data for the rules engine. */
  private readonly ctx: EngineContext;

  constructor(readonly code: string, private readonly catalog: UnionArenaCardRecord[], private readonly availableIds: Set<string>, private readonly auth: UnionArenaAuthProvider) {
    const byId = new Map(catalog.map((card) => [card.id, card]));
    this.ctx = { card: (cardId) => { const card = byId.get(cardId); return card?.stats ? { ...card.stats, name: card.name } : null; } };
  }

  add(account: UnionArenaAccount, socket: UaSocket): Seat {
    const seat = this.players.length as 0 | 1;
    const player: Seat = {
      id: account.id,
      accountId: account.id,
      username: account.username,
      avatarUrl: account.avatarUrl,
      seat,
      connected: true,
      isHost: false,
      ready: false,
      socketId: socket.id,
      life: [],
      deck: [],
      library: [],
      hand: [],
      apCount: 0,
      ap: [],
      front: [],
      energy: [],
      sideline: [],
      removal: [],
      deckCheck: checkUnionArenaDeck([], 0, this.catalog, this.availableIds),
      disconnectTimer: null
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.accountId;
    player.isHost = this.hostId === player.accountId;
    socket.data.uaRoomCode = this.code;
    socket.join(this.code);
    return player;
  }

  attach(player: Seat, socket: UaSocket): void {
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    const previousSocketId = player.socketId;
    if (previousSocketId && previousSocketId !== socket.id) this.namespaceSocket(previousSocketId)?.disconnect(true);
    player.socketId = socket.id;
    player.connected = true;
    const account = this.auth.findAccount(player.accountId);
    if (account) {
      player.username = account.username;
      player.avatarUrl = account.avatarUrl;
    }
    socket.data.uaRoomCode = this.code;
    socket.join(this.code);
  }

  private namespaceSocket(socketId: string): UaSocket | undefined {
    return this.sockets().get(socketId) as UaSocket | undefined;
  }

  private sockets(): Map<string, UaSocket> {
    return this.io?.sockets ?? new Map<string, UaSocket>();
  }

  private io: Namespace<ClientToServerEvents, ServerToClientEvents> | null = null;
  setNamespace(namespace: Namespace<ClientToServerEvents, ServerToClientEvents>): void { this.io = namespace; }

  detach(socket: UaSocket): Seat | null {
    const player = this.players.find((candidate) => candidate.socketId === socket.id);
    if (!player) return null;
    player.socketId = null;
    player.connected = false;
    socket.data.uaRoomCode = undefined;
    return player;
  }

  remove(player: Seat): void {
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    if (player.socketId) {
      const socket = this.namespaceSocket(player.socketId);
      socket?.leave(this.code);
      if (socket) socket.data.uaRoomCode = undefined;
    }
    this.players.splice(this.players.indexOf(player), 1);
    this.players.forEach((entry, seat) => { entry.seat = seat as 0 | 1; });
    if (this.hostId === player.accountId) this.hostId = this.players[0]?.accountId ?? "";
    this.players.forEach((entry) => { entry.isHost = entry.accountId === this.hostId; });
    // A game cannot go on with one seat: whoever is left goes back to the lobby (decks kept, ready cleared) and can wait for a new opponent.
    if (this.phase === "playing") this.resetToLobby();
  }

  private resetToLobby(): void {
    this.phase = "lobby";
    this.game = null;
    for (const seat of this.players) {
      seat.life = [];
      seat.library = [];
      seat.hand = [];
      seat.ready = false;
      clearBoard(seat);
    }
  }

  /**
   * Takes the top LIFE_COUNT cards of each player's library as that player's face-down life area (rule manual, "Preparing to Play" step 5:
   * after the starting hand and mulligan). A seat that has no library yet gets its deck shuffled first.
   */
  dealLife(): void {
    for (const seat of this.players) {
      if (!seat.library.length && !seat.hand.length) seat.library = shuffled(seat.deck);
      seat.life = seat.library.splice(0, LIFE_COUNT).map((cardId, index) => ({ id: `${seat.accountId}:life:${index}`, cardId, faceUp: false }));
    }
  }

  /**
   * Opening steps 1 to 4 of the rule manual's "Preparing to Play": shuffle each deck, pick Player One (the manual says "rock paper scissors"; the
   * server draws it at random), draw the starting hands. Then the mulligan decisions follow, Player One first.
   */
  startGame(): void {
    if (!this.readyForStart) throw new Error("NOT_READY_TO_START");
    const first = this.players[randomInt(this.players.length)]!;
    const second = this.players.find((seat) => seat !== first)!;
    for (const seat of this.players) {
      seat.library = shuffled(seat.deck);
      seat.hand = seat.library.splice(0, HAND_COUNT);
      seat.life = [];
      clearBoard(seat);
    }
    this.phase = "playing";
    this.game = newEngineGame(first.accountId, [first.accountId, second.accountId]);
  }

  /**
   * One mulligan decision. Redrawing puts the hand on the bottom of the deck, draws seven new cards from the top, then reshuffles the deck.
   * Once both players have decided, step 5 (the life areas) is dealt and Player One's first turn begins.
   */
  mulligan(player: Seat, redraw: boolean): void {
    const game = this.game;
    if (this.phase !== "playing" || !game || game.step !== "mulligan") throw new Error("NOT_MULLIGAN_STEP");
    if (game.mulliganQueue[0] !== player.accountId) throw new Error("NOT_YOUR_MULLIGAN");
    if (redraw) {
      player.library.push(...player.hand);
      player.hand = player.library.splice(0, HAND_COUNT);
      player.library = shuffled(player.library);
    }
    game.mulliganQueue.shift();
    if (!game.mulliganQueue.length) {
      this.dealLife();
      beginFirstTurn(game, this.players);
    }
  }

  /** One move of the game proper, checked and carried out by the rules engine. */
  act(player: Seat, action: UnionArenaAction): void {
    if (this.phase !== "playing" || !this.game) throw new Error("NOT_PLAYING");
    applyAction(this.game, this.players, this.ctx, player.accountId, action);
  }

  /** After a finished game, the room goes back to its lobby; decks stay, both players have to ready up again. */
  returnToLobby(): void {
    if (this.game?.step !== "over") throw new Error("GAME_NOT_OVER");
    this.resetToLobby();
  }

  stateFor(player: Seat): UnionArenaRoomState {
    const players: UnionArenaPlayer[] = this.players.map((seat) => ({ id: seat.id, username: seat.username, avatarUrl: seat.avatarUrl, seat: seat.seat, connected: seat.connected, isHost: seat.isHost, ready: seat.ready }));
    const opponent = this.players.find((candidate) => candidate !== player);
    return {
      roomCode: this.code,
      phase: this.phase,
      players,
      you: players.find((candidate) => candidate.id === player.id)!,
      life: { you: lifeView(player), opponent: lifeView(opponent) },
      game: this.game ? gameStateView(this.game, player, opponent) : null,
      hand: [...player.hand],
      playerCount: this.players.length,
      requiredPlayers: 2,
      startAllowed: this.readyForStart,
      spectators: [...this.spectators.values()].map(({ id, username, connected }) => ({ id, username, connected })),
      youAreSpectator: false
    };
  }

  broadcast(): void {
    for (const player of this.players) {
      const socket = player.socketId ? this.namespaceSocket(player.socketId) : undefined;
      if (socket) socket.emit("ua:state", this.stateFor(player));
    }
    for (const spectator of this.spectators.values()) {
      const socket = this.namespaceSocket(spectator.socketId);
      if (socket) socket.emit("ua:state", this.spectatorState(spectator.id));
    }
  }

  spectatorState(id: string): UnionArenaRoomState {
    const player = this.players[0];
    if (!player) throw new Error("ROOM_NOT_FOUND");
    const state = this.stateFor(player);
    state.youAreSpectator = true;
    state.you = { id, username: this.spectators.get(id)?.username ?? "观战者", avatarUrl: null, seat: 0, connected: true, isHost: false, ready: false };
    state.hand = [];
    return state;
  }

  updateDeck(player: Seat, cardIds: string[], apCount: number): void {
    player.deck = cardIds;
    player.apCount = apCount;
    player.deckCheck = checkUnionArenaDeck(cardIds, apCount, this.catalog, this.availableIds);
    // A changed deck has not been confirmed yet: the player has to press ready again.
    player.ready = false;
    this.broadcast();
  }

  getAccount(accountId: string): Seat | undefined { return this.players.find((player) => player.accountId === accountId); }
  getSocket(socketId: string): Seat | undefined { return this.players.find((player) => player.socketId === socketId); }
  findAccount(accountId: string): Seat | undefined { return this.players.find((player) => player.accountId === accountId); }
  get readyForStart(): boolean {
    return this.phase === "lobby" && this.players.length === 2 && this.players.every((player) => player.connected && player.ready && player.deckCheck.structuralOk);
  }
}

export class UnionArenaRoomManager {
  readonly rooms = new Map<string, UnionArenaRoom>();
  private readonly namespace: Namespace<ClientToServerEvents, ServerToClientEvents>;
  private readonly activeByAccount = new Map<string, string>();

  constructor(
    io: Server<ClientToServerEvents, ServerToClientEvents>,
  private readonly auth: UnionArenaAuthProvider,
    private readonly catalog: UnionArenaCardRecord[],
    private readonly availableIds = new Set(catalog.filter((card) => card.imageAvailable).map((card) => card.id))
  ) {
    this.namespace = io.of("/arknights");
    this.namespace.use((socket, next) => {
      const account = auth.verifyToken(socket.handshake.auth?.token);
      if (!account) {
        next(new Error("AUTH_REQUIRED"));
        return;
      }
      socket.data.accountId = account.id;
      next();
    });
    this.namespace.on("connection", (socket) => this.handleConnection(socket as UaSocket));
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = String(randomInt(1000, 10000));
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("ROOM_CODE_EXHAUSTED");
  }

  private account(socket: UaSocket): UnionArenaAccount {
    const account = this.auth.findAccount(socket.data.accountId);
    if (!account) throw new Error("AUTH_REQUIRED");
    return account;
  }

  private respond<T>(ack: (result: ActionAck<T>) => void, action: () => T): void {
    try { ack({ ok: true, data: action() }); }
    catch (error) { ack({ ok: false, code: error instanceof Error ? error.message : "UNKNOWN_ERROR", message: error instanceof Error ? error.message : "操作失败" }); }
  }

  private handleConnection(socket: UaSocket): void {
    const account = this.account(socket);
    this.resumeAccount(account.id, socket);
    socket.on("ua:create_room", (_payload, ack) => this.respond(ack, () => {
      const current = this.activeByAccount.get(account.id);
      if (current) throw new Error("ALREADY_IN_ROOM");
      const code = this.generateCode();
      const room = new UnionArenaRoom(code, this.catalog, this.availableIds, this.auth);
      room.setNamespace(this.namespace);
      this.rooms.set(code, room);
      const player = room.add(this.auth.findAccount(account.id)!, socket);
      this.activeByAccount.set(account.id, code);
      room.broadcast();
      return { roomCode: code, you: room.stateFor(player).you };
    }));
    socket.on("ua:join_room", (payload, ack) => this.respond(ack, () => {
      if (this.activeByAccount.has(account.id)) throw new Error("ALREADY_IN_ROOM");
      const code = typeof payload?.roomCode === "string" ? payload.roomCode.trim().toUpperCase() : "";
      const room = this.rooms.get(code);
      if (!room) throw new Error("ROOM_NOT_FOUND");
      if (room.phase !== "lobby") throw new Error("GAME_IN_PROGRESS");
      if (room.players.length >= 2) throw new Error("ROOM_FULL");
      const player = room.add(this.auth.findAccount(account.id)!, socket);
      this.activeByAccount.set(account.id, code);
      room.broadcast();
      return { roomCode: code, you: room.stateFor(player).you };
    }));
    socket.on("ua:spectate_room", (payload, ack) => this.respond(ack, () => {
      if (this.activeByAccount.has(account.id) || socket.data.uaSpectatingRoom) throw new Error("ALREADY_IN_ROOM");
      const code = typeof payload?.roomCode === "string" ? payload.roomCode.trim() : "";
      const room = this.rooms.get(code);
      if (!room || !/^\d{4}$/.test(code)) throw new Error("ROOM_NOT_FOUND");
      room.spectators.set(account.id, { id: account.id, username: account.username, socketId: socket.id, connected: true });
      socket.data.uaSpectatingRoom = code; socket.join(code); room.broadcast();
      return { roomCode: code };
    }));
    socket.on("ua:leave_spectating", (_payload, ack) => this.respond(ack, () => { this.leaveSpectating(socket, account.id); return undefined; }));
    socket.on("ua:resume_room", (_payload, ack) => this.respond(ack, () => {
      const code = this.activeByAccount.get(account.id);
      const room = code ? this.rooms.get(code) : undefined;
      const player = room?.getAccount(account.id);
      if (!room || !player) throw new Error("NO_ACTIVE_ROOM");
      room.attach(player, socket);
      room.broadcast();
      return { roomCode: code! };
    }));
    socket.on("ua:submit_deck", (payload, ack) => this.respond(ack, () => {
      const { room, player } = this.current(socket);
      if (room.phase !== "lobby") throw new Error("GAME_ALREADY_STARTED");
      if (!Array.isArray(payload?.cardIds) || payload.cardIds.length > 50 || !payload.cardIds.every((id) => typeof id === "string")) throw new Error("INVALID_DECK");
      if (!Number.isInteger(payload?.apCount) || payload.apCount < 0 || payload.apCount > 3) throw new Error("INVALID_AP_COUNT");
      room.updateDeck(player, payload.cardIds, payload.apCount);
      return { structuralOk: player.deckCheck.structuralOk, issues: player.deckCheck.issues };
    }));
    socket.on("ua:ready", (payload, ack) => this.respond(ack, () => {
      const { room, player } = this.current(socket);
      if (room.phase !== "lobby") throw new Error("GAME_ALREADY_STARTED");
      if (typeof payload?.ready !== "boolean") throw new Error("INVALID_READY");
      if (payload.ready && !player.deckCheck.structuralOk) throw new Error("DECK_INCOMPLETE");
      player.ready = payload.ready;
      room.broadcast();
      return undefined;
    }));
    socket.on("ua:start_game", (_payload, ack) => this.respond(ack, () => {
      const { room, player } = this.current(socket);
      if (!player.isHost) throw new Error("HOST_ONLY");
      if (room.phase !== "lobby") throw new Error("GAME_ALREADY_STARTED");
      if (room.players.length !== 2 || room.players.some((entry) => !entry.connected)) throw new Error("NOT_ENOUGH_PLAYERS");
      if (!room.players.every((entry) => entry.ready && entry.deckCheck.structuralOk)) throw new Error("DECKS_NOT_READY");
      room.startGame();
      room.broadcast();
      return undefined;
    }));
    socket.on("ua:mulligan", (payload, ack) => this.respond(ack, () => {
      const { room, player } = this.current(socket);
      if (typeof payload?.redraw !== "boolean") throw new Error("INVALID_MULLIGAN");
      room.mulligan(player, payload.redraw);
      room.broadcast();
      return undefined;
    }));
    socket.on("ua:action", (payload, ack) => this.respond(ack, () => {
      const { room, player } = this.current(socket);
      room.act(player, payload);
      room.broadcast();
      return undefined;
    }));
    socket.on("ua:return_to_lobby", (_payload, ack) => this.respond(ack, () => {
      const { room } = this.current(socket);
      room.returnToLobby();
      room.broadcast();
      return undefined;
    }));
    socket.on("ua:leave_room", (_payload, ack) => this.respond(ack, () => {
      const { room, player } = this.current(socket);
      room.remove(player);
      this.activeByAccount.delete(account.id);
      if (!room.players.length) this.rooms.delete(room.code);
      else room.broadcast();
      return undefined;
    }));
    socket.on("disconnect", () => {
      if (socket.data.uaSpectatingRoom) this.leaveSpectating(socket, account.id);
      const room = [...this.rooms.values()].find((entry) => entry.getSocket(socket.id));
      const player = room?.detach(socket);
      if (!room || !player) return;
      room.broadcast();
      player.disconnectTimer = setTimeout(() => {
        if (player.connected || room.getAccount(player.accountId) !== player) return;
        room.remove(player);
        this.activeByAccount.delete(player.accountId);
        if (!room.players.length) this.rooms.delete(room.code);
        else room.broadcast();
      }, RECONNECT_GRACE_MS);
    });
  }

  private current(socket: UaSocket): { room: UnionArenaRoom; player: Seat } {
    if (socket.data.uaSpectatingRoom) throw new Error("SPECTATOR_READ_ONLY");
    const code = this.activeByAccount.get(String(socket.data.accountId ?? ""));
    const room = code ? this.rooms.get(code) : undefined;
    const player = room?.getSocket(socket.id);
    if (!room || !player) throw new Error("NOT_IN_ROOM");
    return { room, player };
  }

  private leaveSpectating(socket: UaSocket, accountId: string): void {
    const code = socket.data.uaSpectatingRoom as string | undefined; const room = code ? this.rooms.get(code) : undefined;
    if (room) { room.spectators.delete(accountId); room.broadcast(); }
    if (code) socket.leave(code); socket.data.uaSpectatingRoom = undefined;
  }

  private resumeAccount(accountId: string, socket: UaSocket): void {
    const code = this.activeByAccount.get(accountId);
    const room = code ? this.rooms.get(code) : undefined;
    const player = room?.getAccount(accountId);
    if (!room || !player) return;
    room.attach(player, socket);
    room.broadcast();
  }

  refreshAccount(accountId: string): void {
    const code = this.activeByAccount.get(accountId);
    const room = code ? this.rooms.get(code) : undefined;
    const player = room?.getAccount(accountId);
    const account = this.auth.findAccount(accountId);
    if (player && account) {
      player.username = account.username;
      player.avatarUrl = account.avatarUrl;
      room!.broadcast();
    }
  }

  close(): void {
    for (const room of this.rooms.values()) for (const player of room.players) if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    this.rooms.clear();
    this.activeByAccount.clear();
    this.namespace.disconnectSockets(true);
  }
}
