import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { AuthService } from "../../server/auth.ts";
import { createShogiServer, type ShogiServer } from "../../server/shogi.ts";
import { ShogiGame, type Piece, type SerializedPosition } from "../../../../Hon shugi/Hon shugi WorkSpace/src/engine.ts";

type RoomState = {
  roomCode: string;
  started: boolean;
  ready: string[];
  game: { turn: string; status: string; winner: string | null; history: Array<{ side: string; to: { row: number; col: number } }>; lastMove: { to: { row: number; col: number } } | null; board: unknown[][] };
  serverNow: number;
  startedAt: number | null;
  surrenderAfterMs: number;
  result: { reason: string; winner: string | null } | null;
  endedAt: number | null;
  dissolveAt: number | null;
  players: { sente?: string; gote?: string };
  yourSide: string;
  hostSide: string;
};

describe("Shogi online service", () => {
  let server: ShogiServer;
  let auth: AuthService;
  let url: string;
  let dataDir: string;
  let aliceToken: string;
  let bobToken: string;
  let charlieToken: string;
  const clients: Socket[] = [];
  const streams = new WeakMap<Socket, { states: RoomState[]; identities: Identity[] }>();

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "layudown-shogi-"));
    auth = new AuthService(dataDir);
    server = createShogiServer({ dataDir });
    const port = await server.listen(0, "127.0.0.1");
    url = `http://127.0.0.1:${port}`;
    aliceToken = auth.register("Alice", "Password123!").token;
    bobToken = auth.register("Bob", "Password123!").token;
    charlieToken = auth.register("Charlie", "Password123!").token;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("uses verified account names, creates four-digit rooms, validates turns and isolates rooms", async () => {
    const alice = await connect(aliceToken);
    const created = await emit<{ roomCode: string }>(alice, "shogi:create", { name: "forged-name" });
    expect(created.ok).toBe(true);
    expect(created.data?.roomCode).toMatch(/^\d{4}$/);
    const code = created.data!.roomCode;
    const aliceStates = listenState(alice);
    await receiveState(aliceStates);

    const bob = await connect(bobToken);
    const joined = await emit<{ roomCode: string }>(bob, "shogi:join", { roomCode: code, name: "Alice" });
    expect(joined.ok).toBe(true);
    const initial = await receiveState(aliceStates);
    expect(initial.players).toEqual({ sente: "Alice", gote: "Bob" });
    expect(initial.yourSide).toBe("sente");
    expect(initial.started).toBe(false);
    expect(initial.game.board.flat().filter(Boolean)).toHaveLength(40);

    expect((await emit(alice, "shogi:start", {})).ok).toBe(false);
    expect((await emit(bob, "shogi:ready", { ready: true })).ok).toBe(true);
    expect((await emit(alice, "shogi:start", {})).ok).toBe(true);
    const wrongTurn = await emit(bob, "shogi:move", { roomCode: code, expectedPly: 0, move: { kind: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 } } });
    expect(wrongTurn.ok).toBe(false);
    const illegal = await emit(alice, "shogi:move", { roomCode: code, expectedPly: 0, move: { kind: "move", from: { row: 6, col: 4 }, to: { row: 4, col: 4 } } });
    expect(illegal.ok).toBe(false);
    const legal = await emit(alice, "shogi:move", { roomCode: code, expectedPly: 0, move: { kind: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 } } });
    expect(legal.ok).toBe(true);
    const duplicate = await emit(alice, "shogi:move", { roomCode: code, expectedPly: 0, move: { kind: "move", from: { row: 6, col: 3 }, to: { row: 5, col: 3 } } });
    expect(duplicate.ok).toBe(false);

    const isolated = await connect(charlieToken);
    const other = await emit<{ roomCode: string }>(isolated, "shogi:create", {});
    expect(other.data?.roomCode).not.toBe(code);
    expect(server.rooms.get(other.data!.roomCode)?.game.view().turn).toBe("sente");
  });

  it("restores only the verified account seat and replaces its older connection", async () => {
    const alice = await connect(aliceToken);
    const created = await emit<{ roomCode: string }>(alice, "shogi:create", {});
    const code = created.data!.roomCode;
    const bob = await connect(bobToken);
    await emit(bob, "shogi:join", { roomCode: code });
    await emit(bob, "shogi:ready", { ready: true });
    await emit(alice, "shogi:start", {});
    expect((await emit(alice, "shogi:move", { roomCode: code, expectedPly: 0, move: { kind: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 } } })).ok).toBe(true);
    alice.disconnect();

    const restored = await connect(aliceToken);
    const restoredStates = listenState(restored);
    const state = await receiveState(restoredStates);
    expect(state.roomCode).toBe(code);
    expect(state.yourSide).toBe("sente");
    expect(state.game.history).toHaveLength(1);
    expect(state.game.turn).toBe("gote");

    const anotherAccount = await connect(charlieToken);
    const identities = listenIdentity(anotherAccount);
    expect(await receiveIdentity(identities)).toEqual({ username: "Charlie", roomCode: null, side: null });
    const roomJoin = await emit(anotherAccount, "shogi:join", { roomCode: code });
    expect(roomJoin.ok).toBe(false);

  });

  it("rejects missing and forged login sessions", async () => {
    const bad = io(url, { path: "/shogi-socket.io", transports: ["websocket"], forceNew: true, auth: { token: `${aliceToken}x` }, reconnection: false });
    clients.push(bad);
    const error = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("expected auth rejection")), 4000);
      bad.once("connect_error", (cause) => { clearTimeout(timer); resolve(cause.message); });
      bad.once("connect", () => { clearTimeout(timer); reject(new Error("forged token connected")); });
    });
    expect(error).toBe("AUTH_REQUIRED");

    const anonymous = io(url, { path: "/shogi-socket.io", transports: ["websocket"], forceNew: true, reconnection: false });
    clients.push(anonymous);
    const anonymousError = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("expected anonymous rejection")), 4000);
      anonymous.once("connect_error", (cause) => { clearTimeout(timer); resolve(cause.message); });
      anonymous.once("connect", () => { clearTimeout(timer); reject(new Error("anonymous socket connected")); });
    });
    expect(anonymousError).toBe("AUTH_REQUIRED");
  });

  it("awards the opponent a win and frees the seat when a player leaves", async () => {
    const alice = await connect(aliceToken);
    const created = await emit<{ roomCode: string }>(alice, "shogi:create", {});
    const code = created.data!.roomCode;
    const bob = await connect(bobToken);
    await emit(bob, "shogi:join", { roomCode: code });
    await emit(bob, "shogi:ready", { ready: true });
    await emit(alice, "shogi:start", {});
    expect((await emit(alice, "shogi:move", { roomCode: code, expectedPly: 0, move: { kind: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 } } })).ok).toBe(true);

    expect((await emit(alice, "shogi:leave", {})).ok).toBe(true);
    const remaining = server.rooms.get(code);
    expect(remaining?.players.size).toBe(1);
    expect(remaining?.game.view()).toMatchObject({ status: "resigned", winner: "gote" });
    expect(remaining?.players.has("sente")).toBe(false);
    expect(remaining?.hostAccountId).toBe(auth.verifyToken(bobToken)?.id);
    expect(remaining?.stateFor(remaining.players.get("gote")!).hostSide).toBe("gote");

    // A forfeit by leaving ends the game like any other result: the server schedules dissolution
    // and the finished room can no longer be joined or restarted.
    expect(remaining?.result).toEqual({ reason: "resigned", winner: "gote" });
    expect(remaining?.dissolveAt).toBe(remaining!.endedAt! + 5000);
    const charlie = await connect(charlieToken);
    expect((await emit(charlie, "shogi:join", { roomCode: code })).ok).toBe(false);
    expect((await emit(bob, "shogi:start", {})).ok).toBe(false);
    expect(server.rooms.get(code)?.game.view()).toMatchObject({ status: "resigned", winner: "gote" });
  });

  describe("last move, checkmate, resignation and room dissolution", () => {
    let clockOffset = 0;
    let timed: ShogiServer;
    let timedUrl: string;

    beforeEach(async () => {
      clockOffset = 0;
      timed = createShogiServer({ dataDir, now: () => Date.now() + clockOffset, dissolveDelayMs: 400 });
      timedUrl = `http://127.0.0.1:${await timed.listen(0, "127.0.0.1")}`;
    });
    afterEach(async () => { await timed.close(); });

    async function startRoom(a = aliceToken, b = bobToken) {
      const alice = await connectTo(timedUrl, a);
      const code = (await emit<{ roomCode: string }>(alice, "shogi:create", {})).data!.roomCode;
      const bob = await connectTo(timedUrl, b);
      await emit(bob, "shogi:join", { roomCode: code });
      await emit(bob, "shogi:ready", { ready: true });
      expect((await emit(alice, "shogi:start", {})).ok).toBe(true);
      return { alice, bob, code };
    }
    const pawn = (fromCol: number, side: "sente" | "gote") => side === "sente"
      ? { kind: "move", from: { row: 6, col: fromCol }, to: { row: 5, col: fromCol } }
      : { kind: "move", from: { row: 2, col: fromCol }, to: { row: 3, col: fromCol } };
    function sparse(): SerializedPosition {
      const board: Array<Array<Piece | null>> = Array.from({ length: 9 }, () => Array(9).fill(null));
      board[8]![4] = { type: "king", side: "sente", promoted: false };
      board[0]![4] = { type: "king", side: "gote", promoted: false };
      const hand = () => ({ king: 0, rook: 0, bishop: 0, gold: 0, silver: 0, knight: 0, lance: 0, pawn: 0 });
      return { board, hands: { sente: hand(), gote: hand() }, turn: "sente", status: "playing", winner: null, check: null, drawReason: null, history: [], repetition: {}, positionHistory: {} };
    }
    const waitFor = async (predicate: () => boolean, ms = 3000) => {
      const deadline = Date.now() + ms;
      while (!predicate() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
      expect(predicate()).toBe(true);
    };
    const latest = (socket: Socket) => streams.get(socket)!.states.at(-1)!;

    it("marks the last confirmed move for both players and ignores rejected moves", async () => {
      const { alice, bob, code } = await startRoom();
      expect(latest(alice).game.lastMove).toBeNull();
      expect((await emit(alice, "shogi:move", { roomCode: code, expectedPly: 0, move: pawn(4, "sente") })).ok).toBe(true);
      await waitFor(() => latest(bob).game.history.length === 1);
      expect(latest(bob).game.lastMove?.to).toEqual({ row: 5, col: 4 });
      expect(latest(alice).game.lastMove?.to).toEqual({ row: 5, col: 4 });
      // illegal + out-of-turn attempts must not move the marker
      expect((await emit(alice, "shogi:move", { roomCode: code, expectedPly: 1, move: pawn(3, "sente") })).ok).toBe(false);
      expect((await emit(bob, "shogi:move", { roomCode: code, expectedPly: 1, move: { kind: "move", from: { row: 2, col: 4 }, to: { row: 5, col: 4 } } })).ok).toBe(false);
      expect(timed.rooms.get(code)!.game.view().lastMove?.to).toEqual({ row: 5, col: 4 });
      expect((await emit(bob, "shogi:move", { roomCode: code, expectedPly: 1, move: pawn(4, "gote") })).ok).toBe(true);
      await waitFor(() => latest(alice).game.history.length === 2);
      expect(latest(alice).game.lastMove?.to).toEqual({ row: 3, col: 4 });
      expect(latest(bob).game.lastMove?.to).toEqual({ row: 3, col: 4 });
    });

    it("rejects resignation before 180 server seconds, even after a reconnect, and accepts it afterwards", async () => {
      const { alice, bob, code } = await startRoom();
      const state = latest(alice);
      expect(state.surrenderAfterMs).toBe(180_000);
      expect(state.startedAt).not.toBeNull();
      expect((await emit(bob, "shogi:resign", { roomCode: code })).ok).toBe(false);
      clockOffset = 179_000;
      expect((await emit(bob, "shogi:resign", { roomCode: code })).ok).toBe(false);
      expect(timed.rooms.get(code)!.game.view().status).toBe("playing");
      // reconnecting does not restart the timer
      bob.disconnect();
      const bobAgain = await connectTo(timedUrl, bobToken);
      await waitFor(() => streams.get(bobAgain)!.states.length > 0);
      expect(latest(bobAgain).startedAt).toBe(state.startedAt);
      clockOffset = 180_001;
      expect((await emit(bobAgain, "shogi:resign", { roomCode: "ZZZZZ" })).ok).toBe(false);
      const resigned = await emit(bobAgain, "shogi:resign", { roomCode: code });
      expect(resigned.ok).toBe(true);
      expect(timed.rooms.get(code)!.game.view()).toMatchObject({ status: "resigned", winner: "sente" });
      await waitFor(() => latest(alice).result?.reason === "resigned");
      expect(latest(alice).result).toEqual({ reason: "resigned", winner: "sente" });
      // board and last-move untouched by resignation, and no second resignation/move is accepted
      expect(latest(alice).game.history).toHaveLength(0);
      expect((await emit(alice, "shogi:resign", { roomCode: code })).ok).toBe(false);
      expect((await emit(alice, "shogi:move", { roomCode: code, expectedPly: 0, move: pawn(4, "sente") })).ok).toBe(false);
    });

    it("declares checkmate from the engine, ends the game once and dissolves the room after the server delay", async () => {
      const { alice, bob, code } = await startRoom();
      const room = timed.rooms.get(code)!;
      const position = sparse();
      position.board[0]![3] = { type: "pawn", side: "gote", promoted: false };
      position.board[0]![5] = { type: "pawn", side: "gote", promoted: false };
      position.board[2]![3] = { type: "gold", side: "sente", promoted: false };
      position.board[2]![5] = { type: "gold", side: "sente", promoted: false };
      position.board[5]![0] = { type: "rook", side: "sente", promoted: false };
      (room as unknown as { game: ShogiGame }).game = new ShogiGame(position);
      const mate = { kind: "move", from: { row: 5, col: 0 }, to: { row: 5, col: 4 } };
      expect((await emit(alice, "shogi:move", { roomCode: code, expectedPly: 0, move: mate })).ok).toBe(true);
      await waitFor(() => latest(bob).result?.reason === "checkmate");
      for (const client of [alice, bob]) {
        expect(latest(client)).toMatchObject({ result: { reason: "checkmate", winner: "sente" }, game: { status: "checkmate", winner: "sente" } });
        expect(latest(client).dissolveAt! - latest(client).endedAt!).toBe(400);
      }
      const endedAt = latest(alice).endedAt;
      expect((await emit(bob, "shogi:move", { roomCode: code, expectedPly: 1, move: { kind: "move", from: { row: 0, col: 4 }, to: { row: 1, col: 4 } } })).ok).toBe(false);
      expect((await emit(bob, "shogi:resign", { roomCode: code })).ok).toBe(false);
      expect(timed.rooms.get(code)!.endedAt).toBe(endedAt);
      // refresh during the countdown keeps the original end time
      alice.disconnect();
      const aliceAgain = await connectTo(timedUrl, aliceToken);
      await waitFor(() => streams.get(aliceAgain)!.states.length > 0);
      expect(latest(aliceAgain).endedAt).toBe(endedAt);
      const closed = new Promise<{ dissolved?: boolean }>((resolve) => bob.once("shogi:closed", resolve));
      expect(await closed).toMatchObject({ dissolved: true });
      expect(timed.rooms.has(code)).toBe(false);
      expect(timed.rooms.size).toBe(0);
      expect((await emit(aliceAgain, "shogi:move", { roomCode: code, expectedPly: 1, move: pawn(4, "sente") })).ok).toBe(false);
      const fresh = await emit(aliceAgain, "shogi:join", { roomCode: code });
      expect(fresh.ok).toBe(false);
    });

    it("dissolves only the finished room when several rooms are active", async () => {
      const first = await startRoom();
      const carol = auth.register("Carol", "Password123!").token;
      const dave = auth.register("Dave", "Password123!").token;
      const second = await startRoom(carol, dave);
      clockOffset = 181_000;
      expect((await emit(first.bob, "shogi:resign", { roomCode: first.code })).ok).toBe(true);
      await waitFor(() => !timed.rooms.has(first.code));
      expect(timed.rooms.has(second.code)).toBe(true);
      expect(timed.rooms.get(second.code)!.game.view().status).toBe("playing");
      expect(timed.rooms.get(second.code)!.dissolveTimer).toBeNull();
    });
  });

  it("supports health GET and HEAD and SPA HEAD routes", async () => {
    const get = await fetch(`${url}/health`);
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ ok: true, service: "shogi" });
    const head = await fetch(`${url}/shogi`, { method: "HEAD" });
    expect(head.status).toBe(200);
  });

  function connect(token: string): Promise<Socket> { return connectTo(url, token); }

  function connectTo(target: string, token: string): Promise<Socket> {
    const socket = io(target, { path: "/shogi-socket.io", transports: ["websocket"], forceNew: true, auth: { token }, reconnection: false });
    const stream = { states: [] as RoomState[], identities: [] as Identity[] };
    streams.set(socket, stream);
    socket.on("shogi:state", (state: RoomState) => stream.states.push(state));
    socket.on("shogi:identity", (identity: Identity) => stream.identities.push(identity));
    clients.push(socket);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("connect timed out")), 5000);
      socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
      socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
    });
  }

  function emit<T = unknown>(socket: Socket, event: string, payload: unknown): Promise<Ack<T>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} ack timed out`)), 5000);
      socket.emit(event, payload, (result: Ack<T>) => { clearTimeout(timer); resolve(result); });
    });
  }

  type Ack<T = unknown> = { ok: boolean; message?: string; data?: T };
  type Identity = { username: string; roomCode: string | null; side: string | null };

  function listenState(socket: Socket): RoomState[] {
    return streams.get(socket)!.states;
  }

  async function receiveState(values: RoomState[]): Promise<RoomState> {
    const deadline = Date.now() + 5000;
    while (!values.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    const state = values.shift();
    if (!state) throw new Error("state timed out");
    return state;
  }

  function listenIdentity(socket: Socket): Identity[] {
    return streams.get(socket)!.identities;
  }

  async function receiveIdentity(values: Identity[]): Promise<Identity> {
    const deadline = Date.now() + 5000;
    while (!values.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    const identity = values.shift();
    if (!identity) throw new Error("identity timed out");
    return identity;
  }
});
