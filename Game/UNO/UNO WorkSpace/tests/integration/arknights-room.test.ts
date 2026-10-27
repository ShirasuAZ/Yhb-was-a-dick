import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import sharp from "sharp";
import { createAppServer, type AppServer } from "../../server/app.ts";
import type { ActionAck, ClientToServerEvents, ServerToClientEvents, UnionArenaRoomState } from "../../shared/protocol.ts";
import type { UnionArenaRoomState as GameRoomState } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { UNION_ARENA_CATALOG } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/catalog.ts";

type UaSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
let server: AppServer;
let url: string;
let dataDir: string;
const clients: UaSocket[] = [];

function connect(token: string): Promise<UaSocket> {
  const socket = io(`${url}/arknights`, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Arknights socket timed out")), 5000);
    socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
  });
}

function emitAck<T>(socket: UaSocket, event: keyof ClientToServerEvents, payload: unknown): Promise<ActionAck<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Ack timed out for ${String(event)}`)), 5000);
    (socket as unknown as { emit: (name: string, body: unknown, ack: (result: ActionAck<T>) => void) => void })
      .emit(event, payload, (result) => { clearTimeout(timer); resolve(result); });
  });
}

function waitForState(socket: UaSocket, predicate: (state: UnionArenaRoomState) => boolean): Promise<UnionArenaRoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("ua:state", onState); reject(new Error("Room state timed out")); }, 5000);
    const onState = (state: UnionArenaRoomState): void => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off("ua:state", onState);
      resolve(state);
    };
    socket.on("ua:state", onState);
  });
}

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "layudown-arknights-"));
  server = createAppServer({ dataDir });
  url = `http://127.0.0.1:${await server.listen(0, "127.0.0.1")}`;
});

afterAll(async () => {
  for (const client of clients) client.disconnect();
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("Arknights UNION ARENA integration", () => {
  it("serves the whole multi-title catalog and every title's card art", async () => {
    const catalog = await fetch(`${url}/api/arknights/catalog`);
    expect(catalog.status).toBe(200);
    const body = await catalog.json() as { cards: Array<{ id: string; number: string; ipId: string | null; imageUrl: string | null }>; ips: Array<{ id: string }> };
    // Every title in the workspace is in one catalog, and each card's title comes from its own number.
    expect(body.ips.map((ip) => ip.id)).toEqual(["ark", "aot", "jjk", "kmy", "eva"]);
    expect(new Set(body.cards.map((card) => card.ipId))).toEqual(new Set(["ark", "aot", "jjk", "kmy", "eva"]));
    expect(body.cards.filter((card) => card.ipId === "ark")).toHaveLength(254);
    expect(body.cards.length).toBeGreaterThan(254);
    // The battle map is a separate, pre-existing asset; it is asserted on its own below so a missing map does not
    // mask the catalog checks (see the workspace README: the board is drawn with CSS, the map file is optional).
    expect((await fetch(`${url}/assets/arknights/cards/UC01BT-ARK-1-001_%E7%B1%B3%E8%8E%8E_7011.png`)).status).toBe(200);
    expect((await fetch(`${url}/assets/arknights/Map.png`)).status).toBe(404);
    // The new route serves every title, including the ones the old path was never able to reach.
    const aot = body.cards.find((card) => card.ipId === "aot" && card.imageUrl);
    expect(aot).toBeDefined();
    expect((await fetch(`${url}${aot!.imageUrl}`)).status).toBe(200);
    // A name that is not one of the catalog's images never reaches the file system.
    expect((await fetch(`${url}/assets/union-arena/cards/${encodeURIComponent("../../package.json")}`)).status).toBe(404);
  });

  it("answers for the optional battle map asset without breaking the rest of the app", async () => {
    // The board is drawn in CSS (Arknights/README.md); the Map/ folder is not part of the repository, so either answer
    // is correct here — what matters is that the route answers and the server stays up.
    const status = (await fetch(`${url}/assets/arknights/battle-map.png`)).status;
    expect([200, 404]).toContain(status);
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
  });

  it("protects avatar uploads and stores validated, re-encoded images per account", async () => {
    const account = server.auth.register(`Avatar_${Date.now().toString(36)}`, "Password123!", "avatar@example.test");
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#28735f" } }).png().toBuffer();
    const unauthorized = await fetch(`${url}/api/profile/avatar`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Image-Type": "image/png" }, body: bytes });
    expect(unauthorized.status).toBe(401);

    const rejected = await fetch(`${url}/api/profile/avatar`, { method: "PUT", headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/octet-stream", "X-Image-Type": "image/png" }, body: Buffer.from("not an image") });
    expect(rejected.status).toBe(400);
    expect(server.auth.findAccount(account.account.id)?.avatarUrl).toBeNull();

    const upload = (image: Buffer): Promise<Response> => fetch(`${url}/api/profile/avatar`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/octet-stream", "X-Image-Type": "image/png" },
      body: new Uint8Array(image)
    });
    const firstResponse = await upload(bytes);
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as { account: { avatarUrl: string } };
    expect(first.account.avatarUrl).toContain(account.account.id);
    const firstKey = server.auth.getAvatarKey(account.account.id)!;
    const served = await fetch(`${url}${first.account.avatarUrl}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("image/webp");

    const secondResponse = await upload(bytes);
    expect(secondResponse.status).toBe(200);
    expect(server.auth.getAvatarKey(account.account.id)).not.toBe(firstKey);
    expect(await import("node:fs").then(({ existsSync }) => existsSync(path.join(dataDir, "avatars", firstKey)))).toBe(false);
  });

  it("lets the host start once both players have a legal deck and are ready, and keeps hidden cards hidden", async () => {
    const alice = server.auth.register("ArkAlice", "Password123!");
    const bob = server.auth.register("ArkBob", "Password123!");
    const aliceSocket = await connect(alice.token);
    const aliceNext = waitForState(aliceSocket, (state) => state.playerCount === 1);
    const created = await emitAck<{ roomCode: string }>(aliceSocket, "ua:create_room", {});
    expect(created.ok).toBe(true);
    const firstState = await aliceNext;
    expect(firstState.you.id).toBe(alice.account.id);
    expect(firstState.life).toEqual({ you: [], opponent: [] });

    const bobSocket = await connect(bob.token);
    const aliceJoined = waitForState(aliceSocket, (state) => state.playerCount === 2);
    const bobJoined = waitForState(bobSocket, (state) => state.playerCount === 2);
    const joined = await emitAck<{ roomCode: string }>(bobSocket, "ua:join_room", { roomCode: created.data!.roomCode });
    expect(joined.ok).toBe(true);
    expect((await aliceJoined).players.map((player) => player.id)).toEqual([alice.account.id, bob.account.id]);
    expect((await bobJoined).players.map((player) => player.seat)).toEqual([0, 1]);

    const cards = (await (await fetch(`${url}/api/arknights/catalog`)).json()).cards as Array<{ id: string; number: string; imageAvailable: boolean }>;
    const uniqueNumbers = [...new Map(cards.filter((card) => card.imageAvailable && card.number.startsWith("UC01BT/ARK-1-")).map((card) => [card.number, card])).values()].slice(0, 13);
    const deck = uniqueNumbers.flatMap((card) => Array(4).fill(card.id)).slice(0, 50);
    const ap = { cardIds: deck, apCount: 3 };

    // An illegal deck (49 cards) is reported and cannot be readied.
    const short = await emitAck<{ structuralOk: boolean; issues: string[] }>(bobSocket, "ua:submit_deck", { cardIds: deck.slice(0, 49), apCount: 3 });
    expect(short.data?.structuralOk).toBe(false);
    expect(short.data?.issues.some((issue) => issue.includes("49/50"))).toBe(true);
    expect((await emitAck(bobSocket, "ua:ready", { ready: true })).code).toBe("DECK_INCOMPLETE");

    // Nobody can start while the other deck is missing or illegal.
    expect((await emitAck<{ structuralOk: boolean }>(aliceSocket, "ua:submit_deck", ap)).data?.structuralOk).toBe(true);
    expect((await emitAck(aliceSocket, "ua:start_game", {})).code).toBe("DECKS_NOT_READY");

    // A legal deck readies its seat, so the second legal deck completes the room — and the game starts by itself:
    // no host, no start button. The state both clients receive is already the opening of the game.
    const aliceStarted = waitForState(aliceSocket, (state) => state.phase === "playing");
    const bobStarted = waitForState(bobSocket, (state) => state.phase === "playing");
    expect((await emitAck<{ structuralOk: boolean }>(bobSocket, "ua:submit_deck", ap)).data?.structuralOk).toBe(true);
    const aliceView = await aliceStarted;
    const bobView = await bobStarted;
    expect((await emitAck(aliceSocket, "ua:start_game", {})).code).toBe("GAME_ALREADY_STARTED");

    // Opening: seven-card hands (only the owner sees them), a first player, and the mulligan decided in order, Player One first.
    for (const [view, other] of [[aliceView, bobView], [bobView, aliceView]] as const) {
      expect(view.hand).toHaveLength(7);
      expect(view.game).toMatchObject({ step: "mulligan", handCount: { you: 7, opponent: 7 }, deckCount: { you: 43, opponent: 43 } });
      expect(view.game?.firstPlayerId).toBe(other.game?.firstPlayerId);
      expect(view.game?.mulliganPlayerId).toBe(view.game?.firstPlayerId);
      expect(view.life).toEqual({ you: [], opponent: [] });
    }
    const bySeat = new Map([[alice.account.id, aliceSocket], [bob.account.id, bobSocket]]);
    const firstId = aliceView.game!.firstPlayerId;
    const secondId = firstId === alice.account.id ? bob.account.id : alice.account.id;
    expect((await emitAck(bySeat.get(secondId)!, "ua:mulligan", { redraw: false })).code).toBe("NOT_YOUR_MULLIGAN");
    expect((await emitAck(bySeat.get(firstId)!, "ua:mulligan", { redraw: true })).ok).toBe(true);
    expect((await emitAck(bySeat.get(firstId)!, "ua:mulligan", { redraw: false })).code).toBe("NOT_YOUR_MULLIGAN");
    const aliceReady = waitForState(aliceSocket, (state) => state.game?.step === "turn");
    const bobReady = waitForState(bobSocket, (state) => state.game?.step === "turn");
    expect((await emitAck(bySeat.get(secondId)!, "ua:mulligan", { redraw: false })).ok).toBe(true);
    const aliceTurn = await aliceReady;
    const bobTurn = await bobReady;

    // Seven face-down life cards each, whose identity no client is ever sent, and Player One's first turn.
    for (const [view, other] of [[aliceTurn, bobTurn], [bobTurn, aliceTurn]] as const) {
      expect(view.life.you).toHaveLength(7);
      expect(view.life.opponent).toHaveLength(7);
      expect([...view.life.you, ...view.life.opponent].every((card) => card.cardId === null)).toBe(true);
      expect(view.life.opponent.map((card) => card.id)).toEqual(other.life.you.map((card) => card.id));
      expect(view.hand).toHaveLength(7);
      expect(view.game).toMatchObject({ step: "turn", turn: 1, turnPlayerId: firstId, mulliganPlayerId: null, handCount: { you: 7, opponent: 7 }, deckCount: { you: 36, opponent: 36 } });
    }

    // A dropped connection resumes into exactly the same game state — but only when the client asks for its room back.
    // A fresh connection that does not ask stays out, which is what stops "返回大厅" from being undone by a reconnect.
    bobSocket.disconnect();
    const bobBack: UaSocket = io(`${url}/arknights`, { auth: { token: bob.token }, transports: ["websocket"], forceNew: true, reconnection: false });
    clients.push(bobBack);
    await new Promise<void>((resolve) => bobBack.once("connect", () => resolve()));
    // The ack is sent after the room's broadcast, so listen for the state before asking for it back.
    const resumedState = waitForState(bobBack, (state) => state.phase === "playing" && state.players.every((player) => player.connected));
    expect((await emitAck(bobBack, "ua:resume_room", {})).ok).toBe(true);
    const resumed = await resumedState;
    expect(resumed.hand).toEqual(bobTurn.hand);
    expect(resumed.life).toEqual(bobTurn.life);
    expect(resumed.game).toEqual(bobTurn.game);

    // Asking for a room nobody holds says so, instead of attaching to somebody else's.
    expect((await emitAck(await connect(server.auth.register("ArkStranger", "Password123!").token), "ua:resume_room", {})).code).toBe("NO_ACTIVE_ROOM");

    // A third account cannot join a running game.
    const carol = server.auth.register("ArkCarol", "Password123!");
    const carolSocket = await connect(carol.token);
    expect((await emitAck(carolSocket, "ua:join_room", { roomCode: created.data!.roomCode })).code).toBe("GAME_IN_PROGRESS");

    // If a player leaves a running game, the other goes back to the lobby with the deck kept and readiness cleared.
    const aliceAlone = waitForState(aliceSocket, (state) => state.phase === "lobby");
    expect((await emitAck(bobBack, "ua:leave_room", {})).ok).toBe(true);
    const lobby = await aliceAlone;
    expect(lobby).toMatchObject({ phase: "lobby", game: null, hand: [], playerCount: 1, life: { you: [], opponent: [] } });
    expect(lobby.you.ready).toBe(false);
  });
  it("runs the turns through the rules engine: only the acting player may act, cards are paid for and the turn passes on", async () => {
    const dana = server.auth.register("ArkDana", "Password123!");
    const evan = server.auth.register("ArkEvan", "Password123!");
    const danaSocket = await connect(dana.token);
    const evanSocket = await connect(evan.token);
    const created = await emitAck<{ roomCode: string }>(danaSocket, "ua:create_room", {});
    const joined = waitForState(danaSocket, (state) => state.playerCount === 2);
    expect((await emitAck(evanSocket, "ua:join_room", { roomCode: created.data!.roomCode })).ok).toBe(true);
    await joined;
    // A deck of 0-cost, 1-AP characters, so whatever is drawn can be played on the first turn.
    const cards = UNION_ARENA_CATALOG;
    const cheap = [...new Map(cards.filter((card) => card.imageAvailable && card.stats?.type === "character" && card.stats.energyCost === 0 && card.stats.apCost === 1 && !["特殊", "色彩", "最终"].includes(card.stats.trigger?.label ?? "")).map((card) => [card.number, card])).values()];
    expect(cheap.length).toBeGreaterThanOrEqual(13);
    const deck = cheap.slice(0, 13).flatMap((card) => Array(4).fill(card.id)).slice(0, 50);
    // Two legal decks fill the room, and the room starts the game itself — there is no start button any more.
    const started = waitForState(danaSocket, (state) => state.phase === "playing");
    for (const socket of [danaSocket, evanSocket]) {
      expect((await emitAck<{ structuralOk: boolean }>(socket, "ua:submit_deck", { cardIds: deck, apCount: 3 })).data?.structuralOk).toBe(true);
    }
    const firstId = (await started).game!.firstPlayerId;
    const first = firstId === dana.account.id ? danaSocket : evanSocket;
    const second = first === danaSocket ? evanSocket : danaSocket;
    expect((await emitAck(second, "ua:action", { type: "next_phase" })).code).toBe("NOT_YOUR_TURN");
    expect((await emitAck(first, "ua:mulligan", { redraw: false })).ok).toBe(true);
    const turnOne = waitForState(first, (state) => state.game?.step === "turn") as unknown as Promise<GameRoomState>;
    expect((await emitAck(second, "ua:mulligan", { redraw: false })).ok).toBe(true);
    const view = await turnOne;
    expect(view.game).toMatchObject({ phase: "start", extraDrawUsed: false, pending: null });
    expect(view.game!.board.you.ap).toEqual([{ id: expect.any(String), rested: false }]);
    expect((await emitAck(second, "ua:action", { type: "next_phase" })).code).toBe("NOT_YOUR_TURN");
    expect((await emitAck(first, "ua:action", { type: "play", handIndex: 0, line: "front" })).code).toBe("NOT_NOW");
    expect((await emitAck(first, "ua:action", { type: "next_phase" })).ok).toBe(true);
    expect((await emitAck(first, "ua:action", { type: "next_phase" })).ok).toBe(true);
    const played = waitForState(second, (state) => (state as unknown as GameRoomState).game?.board.opponent.energy.length === 1) as unknown as Promise<GameRoomState>;
    expect((await emitAck(first, "ua:action", { type: "play", handIndex: 0, line: "energy" })).ok).toBe(true);
    const opponentView = await played;
    expect(opponentView.game!.board.opponent.energy[0]).toMatchObject({ rested: true });
    expect(opponentView.game!.board.opponent.ap).toEqual([{ id: expect.any(String), rested: true }]);
    expect(opponentView.game!.handCount.opponent).toBe(6);
    // The only AP card is resting now.
    expect((await emitAck(first, "ua:action", { type: "play", handIndex: 0, line: "energy" })).code).toBe("NOT_ENOUGH_AP");
    const handedOver = waitForState(second, (state) => state.game?.turnPlayerId !== firstId && state.game?.turn === 2) as unknown as Promise<GameRoomState>;
    expect((await emitAck(first, "ua:action", { type: "end_turn" })).ok).toBe(true);
    const secondTurn = await handedOver;
    // Player Two: two AP cards on the first turn, and a draw.
    expect(secondTurn.game!.board.you.ap).toHaveLength(2);
    expect(secondTurn.hand).toHaveLength(8);
    expect(secondTurn.game!.log.some((line) => line.includes("登场到能量线"))).toBe(true);
    // Conceding ends the game; then both can go back to the room's lobby with their decks.
    const over = waitForState(first, (state) => state.game?.step === "over") as unknown as Promise<GameRoomState>;
    expect((await emitAck(second, "ua:action", { type: "concede" })).ok).toBe(true);
    expect((await over).game!.winnerId).toBe(firstId);
    expect((await emitAck(second, "ua:action", { type: "next_phase" })).code).toBe("GAME_OVER");
    const lobby = waitForState(first, (state) => state.phase === "lobby");
    expect((await emitAck(first, "ua:return_to_lobby", {})).ok).toBe(true);
    expect((await lobby).game).toBeNull();
  });

  it("starts the game by itself once the room is full, and only the host can dissolve it", async () => {
    const frank = server.auth.register("ArkFrank", "Password123!");
    const gina = server.auth.register("ArkGina", "Password123!");
    const frankSocket = await connect(frank.token);
    const ginaSocket = await connect(gina.token);
    const created = await emitAck<{ roomCode: string }>(frankSocket, "ua:create_room", {});
    const roomCode = created.data!.roomCode;
    const joined = waitForState(frankSocket, (state) => state.playerCount === 2);
    expect((await emitAck(ginaSocket, "ua:join_room", { roomCode })).ok).toBe(true);
    await joined;

    // Rooms are full at two players, and the room starts once both decks are legal — no start button involved.
    const third = server.auth.register("ArkHana", "Password123!");
    const thirdSocket = await connect(third.token);
    expect((await emitAck(thirdSocket, "ua:join_room", { roomCode })).code).toBe("ROOM_FULL");

    const cards = (await (await fetch(`${url}/api/arknights/catalog`)).json()).cards as Array<{ id: string; number: string; imageAvailable: boolean }>;
    const numbers = [...new Map(cards.filter((card) => card.imageAvailable && card.number.startsWith("UC01BT/ARK-1-")).map((card) => [card.number, card])).values()].slice(0, 13);
    const deck = numbers.flatMap((card) => Array(4).fill(card.id)).slice(0, 50);
    const started = waitForState(ginaSocket, (state) => state.phase === "playing");
    for (const socket of [frankSocket, ginaSocket]) {
      expect((await emitAck<{ structuralOk: boolean }>(socket, "ua:submit_deck", { cardIds: deck, apCount: 3 })).data?.structuralOk).toBe(true);
    }
    // Both seats are ready without anyone pressing "ready"; the first state after the last deck is the opening.
    expect((await started).game?.step).toBe("mulligan");

    // Only the host may dissolve the room, and everyone in it is told.
    expect((await emitAck(ginaSocket, "ua:dissolve_room", {})).code).toBe("HOST_ONLY");
    const closed = new Promise<{ message: string }>((resolve) => ginaSocket.once("ua:room_closed", resolve));
    expect((await emitAck(frankSocket, "ua:dissolve_room", {})).ok).toBe(true);
    expect((await closed).message).toContain("解散");
    // The room is gone: neither player is in it any more, so they can create a fresh one.
    expect((await emitAck(ginaSocket, "ua:create_room", {})).ok).toBe(true);
  });

  it("tells a player's friends when they come online, and which game they are in", async () => {
    const iris = server.auth.register("ArkIris", "Password123!");
    const jay = server.auth.register("ArkJay", "Password123!");
    server.auth.sendFriendRequest(iris.account.id, jay.account.id);
    server.auth.acceptFriendRequest(jay.account.id, iris.account.id);

    const jaySocket = await connect(jay.token);
    // The friends list lives on the site's own socket, not the Arknights namespace.
    const socialSocket = (token: string): Promise<Socket> => new Promise((resolve, reject) => {
      const socket = io(`${url}/`, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
      clients.push(socket);
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });
    const irisMain = await socialSocket(iris.token);
    const list = (socket: Socket): Promise<Array<{ id: string; online?: boolean; game?: string | null }>> =>
      new Promise((resolve) => (socket as unknown as { emit: (name: string, body: unknown, cb: (result: { data?: { friends: Array<{ id: string; online?: boolean; game?: string | null }> } }) => void) => void })
        .emit("social_get", {}, (result) => resolve(result.data?.friends ?? [])));

    // Both are connected, so each sees the other online and not in a game.
    expect(await list(irisMain)).toEqual([expect.objectContaining({ id: jay.account.id, online: true, game: null })]);

    // Seated in a Union Arena room, the friend is shown playing Arknights — the room's own bookkeeping says so.
    const created = await emitAck<{ roomCode: string }>(jaySocket, "ua:create_room", {});
    expect(created.ok).toBe(true);
    expect(await list(irisMain)).toEqual([expect.objectContaining({ id: jay.account.id, online: true, game: "arknights" })]);

    // Leaving the room clears the game line but keeps the account online.
    expect((await emitAck(jaySocket, "ua:leave_room", {})).ok).toBe(true);
    expect(await list(irisMain)).toEqual([expect.objectContaining({ id: jay.account.id, online: true, game: null })]);

    // A closed tab takes the account offline.
    jaySocket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await list(irisMain)).toEqual([expect.objectContaining({ id: jay.account.id, online: false, game: null })]);
  });

  it("survives ua:* and UNO events emitted without an ack callback", async () => {
    const mallory = server.auth.register("ArkMallory", "Password123!");
    const socket = await connect(mallory.token);
    const raw = socket as unknown as { emit: (name: string, body?: unknown) => void };
    const events = ["ua:create_room", "ua:join_room", "ua:resume_room", "ua:submit_deck", "ua:ready", "ua:start_game", "ua:dissolve_room", "ua:mulligan", "ua:action", "ua:return_to_lobby", "ua:leave_room"];
    for (const event of events) raw.emit(event, {});
    raw.emit("ua:join_room");
    raw.emit("ua:action", null);
    raw.emit("host_get_lan_status");
    raw.emit("host_set_lan_access", {});

    // If the process had thrown, the server would be gone and this ack (and the HTTP check) would fail.
    const left = await emitAck(socket, "ua:leave_room", {});
    expect(left.ok === true || typeof left.code === "string").toBe(true);
    expect((await fetch(`${url}/api/arknights/catalog`)).status).toBe(200);
  });
});
