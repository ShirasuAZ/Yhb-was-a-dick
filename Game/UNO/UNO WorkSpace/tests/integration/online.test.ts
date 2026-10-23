import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAppServer, type AppServer } from "../../server/index.ts";
import { LanAccessController } from "../../server/lan.ts";
import {
  LOBBY_RECONNECT_GRACE_SECONDS,
  RECONNECT_GRACE_SECONDS
} from "../../server/room.ts";
import type { UnoGame } from "../../server/game/game.ts";
import type { Card } from "../../shared/protocol.ts";
import type { RoomState } from "../../shared/protocol.ts";
import { TestClient, actionId } from "./helpers.ts";

let server: AppServer;
let url: string;
let clients: TestClient[] = [];

async function client(): Promise<TestClient> {
  const instance = new TestClient(url);
  clients.push(instance);
  await instance.connect();
  return instance;
}

async function createStartedRoom(
  playerNames: string[]
): Promise<{ clients: TestClient[]; roomCode: string; tokens: string[] }> {
  const instances = [await client()];
  await instances[0]!.register(playerNames[0]!);
  const created = await instances[0]!.createRoom(playerNames[0]!);
  const tokens = [created.token];
  for (let index = 1; index < playerNames.length; index += 1) {
    const instance = await client();
    await instance.register(playerNames[index]!);
    const joined = await instance.joinRoom(created.roomCode, playerNames[index]!);
    tokens.push(joined.token);
    instances.push(instance);
  }
  for (const instance of instances.slice(1)) {
    const result = await instance.setReady(true);
    expect(result.ok).toBe(true);
  }
  const start = await instances[0]!.startGame();
  expect(start.ok).toBe(true);
  await Promise.all(
    instances.map((instance) =>
      instance.waitForState((state) => state.phase === "playing")
    )
  );
  return { clients: instances, roomCode: created.roomCode, tokens };
}

function assertPublicStatesMatch(states: RoomState[]): void {
  const first = states[0]!;
  for (const state of states.slice(1)) {
    expect(state.game?.currentPlayerId).toBe(first.game?.currentPlayerId);
    expect(state.game?.currentColor).toBe(first.game?.currentColor);
    expect(state.game?.direction).toBe(first.game?.direction);
    expect(state.game?.turnNumber).toBe(first.game?.turnNumber);
    expect(state.game?.deckCount).toBe(first.game?.deckCount);
    expect(state.game?.discardTop.id).toBe(first.game?.discardTop.id);
    expect(state.players.map((player) => player.seat)).toEqual(
      first.players.map((player) => player.seat)
    );
    expect(state.players.map((player) => player.handCount)).toEqual(
      first.players.map((player) => player.handCount)
    );
  }
}

function extractCard(game: UnoGame, predicate: (card: Card) => boolean): Card {
  const zones: Card[][] = [
    game.deck,
    game.discard,
    ...game.players.map((player) => player.hand)
  ];
  for (const zone of zones) {
    const index = zone.findIndex(predicate);
    if (index >= 0) {
      return zone.splice(index, 1)[0]!;
    }
  }
  throw new Error("Card not found in game");
}

function actionForClient(instance: TestClient): {
  event:
    | "play_card"
    | "draw_card"
    | "end_turn"
    | "declare_uno"
    | "respond_penalty";
  payload: Record<string, unknown>;
  seq: number;
} | null {
  const state = instance.state;
  const game = state?.game;
  if (!state || !game || state.phase !== "playing") {
    return null;
  }
  const seq = game.lastEvent?.seq ?? 0;
  if (game.pendingPenalty) {
    if (game.pendingPenalty.canRespond) {
      return {
        event: "respond_penalty",
        payload: {
          decision: "accept",
          turnNumber: game.turnNumber,
          actionId: actionId()
        },
        seq
      };
    }
    return null;
  }
  if (game.pendingUno?.canDeclare) {
    return {
      event: "declare_uno",
      payload: { actionId: actionId() },
      seq
    };
  }
  if (game.currentPlayerId !== state.you.id) {
    return null;
  }
  if (game.drawnCardId) {
    if (game.playableCardIds.includes(game.drawnCardId)) {
      return playAction(instance, game.drawnCardId, seq);
    }
    return {
      event: "end_turn",
      payload: {
        turnNumber: game.turnNumber,
        actionId: actionId()
      },
      seq
    };
  }
  if (game.playableCardIds[0]) {
    return playAction(instance, game.playableCardIds[0], seq);
  }
  return {
    event: "draw_card",
    payload: {
      turnNumber: game.turnNumber,
      actionId: actionId()
    },
    seq
  };
}

function playAction(
  instance: TestClient,
  cardId: string,
  seq: number
): {
  event: "play_card";
  payload: Record<string, unknown>;
  seq: number;
} {
  const state = instance.state!;
  const game = state.game!;
  const card = state.you.hand.find((candidate) => candidate.id === cardId);
  if (!card) {
    throw new Error("Playable card missing from own hand");
  }
  const colors = ["red", "yellow", "green", "blue"] as const;
  return {
    event: "play_card",
    payload: {
      cardId,
      ...(card.kind === "wild" || card.kind === "wild4"
        ? { color: colors[game.turnNumber % colors.length] }
        : {}),
      turnNumber: game.turnNumber,
      actionId: actionId()
    },
    seq
  };
}

async function runAutomatedGame(
  instances: TestClient[],
  maxSteps = 800
): Promise<void> {
  for (let step = 0; step < maxSteps; step += 1) {
    const states = instances
      .map((instance) => instance.state)
      .filter((state): state is RoomState => state !== null);
    if (states.every((state) => state.phase === "finished")) {
      return;
    }
    const ordered = instances
      .filter((instance) => instance.state?.phase === "playing")
      .sort(
        (left, right) =>
          (right.state?.game?.lastEvent?.seq ?? 0) -
          (left.state?.game?.lastEvent?.seq ?? 0)
      );
    const selected = ordered
      .map((instance) => ({ instance, action: actionForClient(instance) }))
      .find((candidate) => candidate.action !== null);
    if (!selected?.action) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    const { instance: driver, action } = selected;
    const result = await driver.emitAck(action.event, action.payload);
    if (!result.ok) {
      throw new Error(
        `Automated action failed: ${result.code} ${result.message}`
      );
    }
    await Promise.all(
      instances.map((instance) =>
        instance.waitForState(
          (state) =>
            (state.game?.lastEvent?.seq ?? 0) > action.seq ||
            state.phase === "finished"
        )
      )
    );
  }
  throw new Error("Automated game did not finish within the step limit");
}

beforeAll(async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "uno-integration-auth-"));
  server = createAppServer({ dataDir });
  const port = await server.listen(0, "127.0.0.1");
  url = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  for (const instance of clients) {
    instance.close();
  }
  clients = [];
});

afterAll(async () => {
  await server.close();
});

describe("real Socket.IO multiplayer", () => {
  it("serves the SPA for GET and HEAD requests on the UNO route", async () => {
    const get = await fetch(`${url}/uno`);
    expect(get.status).toBe(200);
    expect(await get.text()).toContain("<title>LayUDown</title>");
    const head = await fetch(`${url}/uno`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toContain("text/html");
  });

  it("routes an IP join to the only available lobby or offers a choice", async () => {
    const ownRooms: string[] = [];
    try {
      const empty = await fetch(url + "/join", { redirect: "manual" });
      expect(empty.status).toBe(404);
      expect(await empty.text()).toContain("当前没有可加入的房间");

      const firstHost = await client();
      const firstName = "jh" + randomUUID().replace(/-/g, "").slice(0, 8);
      await firstHost.register(firstName);
      const first = await firstHost.createRoom(firstName);
      ownRooms.push(first.roomCode);
      const only = await fetch(url + "/join", { redirect: "manual" });
      expect(only.status).toBe(302);
      expect(only.headers.get("location")).toBe("/room/" + first.roomCode);

      const secondHost = await client();
      const secondName = "sh" + randomUUID().replace(/-/g, "").slice(0, 8);
      await secondHost.register(secondName);
      const second = await secondHost.createRoom(secondName);
      ownRooms.push(second.roomCode);
      const choices = await fetch(url + "/join", { redirect: "manual" });
      expect(choices.status).toBe(200);
      const html = await choices.text();
      expect(html).toContain("/room/" + first.roomCode);
      expect(html).toContain("/room/" + second.roomCode);
      const selected = await fetch(url + "/join?room=" + second.roomCode.toLowerCase(), { redirect: "manual" });
      expect(selected.status).toBe(302);
      expect(selected.headers.get("location")).toBe("/room/" + second.roomCode);
    } finally {
      for (const code of ownRooms) server.rooms.rooms.delete(code);
    }
  });

  it("explains that the target host has no joinable room when its lobby is full", async () => {
    const roomCodes: string[] = [];
    try {
      const host = await client();
      const hostName = "fh" + randomUUID().replace(/-/g, "").slice(0, 8);
      await host.register(hostName);
      const room = await host.createRoom(hostName);
      roomCodes.push(room.roomCode);

      for (let index = 0; index < 5; index += 1) {
        const guest = await client();
        const guestName = "fg" + randomUUID().replace(/-/g, "").slice(0, 8);
        await guest.register(guestName);
        await guest.joinRoom(room.roomCode, guestName);
      }

      const full = await fetch(url + "/join", { redirect: "manual" });
      expect(full.status).toBe(404);
      expect(await full.text()).toContain("等待房间都已满员");
    } finally {
      for (const code of roomCodes) server.rooms.rooms.delete(code);
    }
  });

  it("reports LAN adapter addresses and toggles real LAN access from the host", async () => {
    const host = await client();
    const statusResult = await host.emitAck<
      Record<string, never>,
      {
        enabled: boolean;
        port: number;
        localUrl: string;
        addresses: Array<{ name: string; url: string }>;
      }
    >("host_get_lan_status", {});
    expect(statusResult.ok).toBe(true);
    expect(statusResult.data?.enabled).toBe(false);
    expect(statusResult.data?.port).toBeGreaterThan(0);
    expect(statusResult.data?.localUrl).toContain("127.0.0.1");

    const opened = await host.emitAck<
      { enabled: boolean; actionId: string },
      { enabled: boolean }
    >("host_set_lan_access", {
      enabled: true,
      actionId: randomUUID()
    });
    expect(opened.ok).toBe(true);
    expect(opened.data?.enabled).toBe(true);

    const closed = await host.emitAck<
      { enabled: boolean; actionId: string },
      { enabled: boolean }
    >("host_set_lan_access", {
      enabled: false,
      actionId: randomUUID()
    });
    expect(closed.ok).toBe(true);
    expect(closed.data?.enabled).toBe(false);

    const joinInfo = await fetch(`${url}/api/join-info`);
    expect(joinInfo.ok).toBe(true);
    expect(joinInfo.headers.get("access-control-allow-origin")).toBe("*");
    await expect(joinInfo.json()).resolves.toMatchObject({
      ok: true,
      app: "uno",
      lanEnabled: false
    });
    const missingAsset = await fetch(`${url}/assets/uno/removed-card.svg`);
    expect(missingAsset.status).toBe(404);

    const reopened = await host.emitAck<
      { enabled: boolean; actionId: string },
      { enabled: boolean }
    >("host_set_lan_access", {
      enabled: true,
      actionId: randomUUID()
    });
    expect(reopened.ok).toBe(true);
    expect(reopened.data?.enabled).toBe(true);
  });

  it("tells a remote client that the host LAN switch is closed", async () => {
    const lanAccess = new LanAccessController({ enabled: false });
    lanAccess.allowsConnection = () => false;
    const blocked = createAppServer({
      lanAccess,
      dataDir: mkdtempSync(path.join(os.tmpdir(), "uno-lan-closed-"))
    });
    const port = await blocked.listen(0, "127.0.0.1");
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/join-info`,
        { headers: { Origin: "http://127.0.0.1:5173" } }
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        code: "LAN_CLOSED"
      });
    } finally {
      await blocked.close();
    }
  });

  it("blocks remote Socket.IO handshakes while LAN access is closed", async () => {
    const lanAccess = new LanAccessController({ enabled: false });
    lanAccess.allowsConnection = () => lanAccess.isEnabled();
    const blocked = createAppServer({
      lanAccess,
      dataDir: mkdtempSync(path.join(os.tmpdir(), "uno-socket-lan-"))
    });
    const port = await blocked.listen(0, "127.0.0.1");
    const socketUrl = `http://127.0.0.1:${port}`;
    const rejected = new TestClient(socketUrl);
    try {
      await expect(rejected.connect()).rejects.toThrow();
      rejected.close();
      lanAccess.setEnabled(true);
      const accepted = new TestClient(socketUrl);
      await accepted.connect();
      accepted.close();
    } finally {
      rejected.close();
      await blocked.close();
    }
  });

  it("lets two independent clients join by room code and share one authoritative state", async () => {
    const room = await createStartedRoom(["甲玩家", "乙玩家"]);
    const [host, guest] = room.clients;
    const hostState = host!.state!;
    const guestState = guest!.state!;

    expect(hostState.roomCode).toBe(room.roomCode);
    expect(hostState.players).toHaveLength(2);
    expect(hostState.players.map((player) => player.name)).toEqual([
      "甲玩家",
      "乙玩家"
    ]);
    assertPublicStatesMatch([hostState, guestState]);

    expect(Object.hasOwn(hostState.players[1]!, "hand")).toBe(false);
    expect(Object.hasOwn(guestState.players[0]!, "hand")).toBe(false);
    expect(hostState.you.hand.length).toBeGreaterThanOrEqual(7);
    expect(guestState.you.hand.length).toBeGreaterThanOrEqual(7);
    expect(hostState.reconnectionGraceSeconds).toBe(
      RECONNECT_GRACE_SECONDS
    );
    expect(
      hostState.you.hand.every((card) => {
        const serverHand = room.clients[0]!.state!.you.hand;
        return serverHand.some((candidate) => candidate.id === card.id);
      })
    ).toBe(true);

    const serverRoom = server.rooms.rooms.get(room.roomCode)!;
    serverRoom.game!.verify();
  });

  it("returns the authoritative room state on a manual sync", async () => {
    const host = await client();
    const guest = await client();
    await host.register("同步房主");
    await guest.register("同步玩家");
    const created = await host.createRoom("同步房主");
    await guest.joinRoom(created.roomCode, "同步玩家");
    await guest.setReady(true);
    const synced = await guest.emitAck("sync_room", {});

    expect(synced.ok).toBe(true);
    const state = await guest.waitForState((candidate) => candidate.you.ready);
    expect(
      state.players.find((player) => player.id === state.you.id)?.ready
    ).toBe(true);
    expect(state.reconnectionGraceSeconds).toBe(
      LOBBY_RECONNECT_GRACE_SECONDS
    );
  });

  it("rejects a non-boolean ready payload", async () => {
    const host = await client();
    const guest = await client();
    await host.register("校验房主");
    await guest.register("校验玩家");
    const created = await host.createRoom("校验房主");
    await guest.joinRoom(created.roomCode, "校验玩家");

    const invalid = await guest.emitAck<Record<string, unknown>>("set_ready", {
      ready: "false",
      actionId: actionId()
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe("INVALID_READY");
    const state = await guest.waitForState(
      (candidate) => candidate.you.ready === false
    );
    expect(state.you.ready).toBe(false);
  });

  it("keeps six online players in one ordered, consistent room", async () => {
    const room = await createStartedRoom([
      "玩家一",
      "玩家二",
      "玩家三",
      "玩家四",
      "玩家五",
      "玩家六"
    ]);
    const states = room.clients.map((instance) => instance.state!);

    expect(states[0]!.players).toHaveLength(6);
    expect(states[0]!.players.map((player) => player.seat)).toEqual([
      0, 1, 2, 3, 4, 5
    ]);
    assertPublicStatesMatch(states);

    for (let step = 0; step < 12; step += 1) {
      const driver = room.clients
        .filter((instance) => instance.state?.phase === "playing")
        .sort(
          (left, right) =>
            (right.state?.game?.lastEvent?.seq ?? 0) -
            (left.state?.game?.lastEvent?.seq ?? 0)
        )[0];
      if (!driver) {
        break;
      }
      const action = actionForClient(driver);
      if (!action) {
        break;
      }
      const result = await driver.emitAck(action.event, action.payload);
      expect(result.ok).toBe(true);
      await Promise.all(
        room.clients.map((instance) =>
          instance.waitForState(
            (state) =>
              (state.game?.lastEvent?.seq ?? 0) > action.seq ||
              state.phase === "finished"
          )
        )
      );
      assertPublicStatesMatch(room.clients.map((instance) => instance.state!));
    }
    server.rooms.rooms.get(room.roomCode)!.game!.verify();
  });

  it("accepts only one of two concurrent actions generated for the same turn", async () => {
    const room = await createStartedRoom(["并发甲", "并发乙"]);
    const [first, second] = room.clients;
    const current =
      first!.state!.game!.currentPlayerId === first!.state!.you.id ? first! : second!;
    const other = current === first ? second! : first!;
    const game = current.state!.game!;
    const turnNumber = game.turnNumber;
    const playable = game.playableCardIds[0];

    const playableCard = current.state!.you.hand.find(
      (card) => card.id === playable
    );
    const currentAction = playableCard
      ? current.emitAck("play_card", {
          cardId: playableCard.id,
          ...(playableCard.kind === "wild" || playableCard.kind === "wild4"
            ? { color: "red" }
            : {}),
          turnNumber,
          actionId: randomUUID()
        })
      : current.emitAck("draw_card", {
          turnNumber,
          actionId: randomUUID()
        });
    const staleCard = other.state!.you.hand[0]!.id;
    const otherAction = other.emitAck("play_card", {
      cardId: staleCard,
      turnNumber,
      actionId: randomUUID()
    });

    const results = await Promise.all([currentAction, otherAction]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const rejected = results.find((result) => !result.ok)!;
    expect(["NOT_YOUR_TURN", "STALE_ACTION", "ILLEGAL_PLAY"]).toContain(
      rejected.code
    );
    server.rooms.rooms.get(room.roomCode)!.game!.verify();
  });

  it("rejects forged cards, non-current actions and missing wild colors", async () => {
    const room = await createStartedRoom(["校验甲", "校验乙"]);
    const serverRoom = server.rooms.rooms.get(room.roomCode)!;
    const game = serverRoom.game!;
    const current = room.clients.find(
      (instance) => instance.state!.game!.currentPlayerId === instance.state!.you.id
    )!;
    const other = room.clients.find((instance) => instance !== current)!;
    const turnNumber = current.state!.game!.turnNumber;

    const notCurrent = await other.emitAck("play_card", {
      cardId: other.state!.you.hand[0]!.id,
      turnNumber,
      actionId: actionId()
    });
    expect(notCurrent.ok).toBe(false);
    expect(["NOT_YOUR_TURN", "STALE_ACTION"]).toContain(notCurrent.code);

    const forged = await current.emitAck("play_card", {
      cardId: "forged-card-id",
      turnNumber,
      actionId: actionId()
    });
    expect(forged.ok).toBe(false);
    expect(forged.code).toBe("CARD_NOT_IN_HAND");

    const wild = extractCard(game, (card) => card.kind === "wild");
    const currentGamePlayer = game.players.find(
      (player) => player.id === current.state!.you.id
    )!;
    currentGamePlayer.hand.push(wild);
    serverRoom.emitStates();
    await current.waitForState((state) =>
      state.game!.playableCardIds.includes(wild.id)
    );
    const missingColor = await current.emitAck("play_card", {
      cardId: wild.id,
      turnNumber,
      actionId: actionId()
    });
    expect(missingColor.ok).toBe(false);
    expect(missingColor.code).toBe("COLOR_REQUIRED");
    expect(currentGamePlayer.hand.some((card) => card.id === wild.id)).toBe(
      true
    );
    expect(game.turnNumber).toBe(turnNumber);
    game.verify();
  });

  it("treats a repeated action id as idempotent", async () => {
    const room = await createStartedRoom(["幂等甲", "幂等乙"]);
    const current =
      room.clients.find(
        (instance) =>
          instance.state!.game!.currentPlayerId === instance.state!.you.id
      )!;
    const game = current.state!.game!;
    const id = randomUUID();
    const playable = game.playableCardIds[0];
    const playableCard = current.state!.you.hand.find(
      (card) => card.id === playable
    );
    const payload = playableCard
      ? {
          cardId: playableCard.id,
          ...(playableCard.kind === "wild" || playableCard.kind === "wild4"
            ? { color: "red" }
            : {}),
          turnNumber: game.turnNumber,
          actionId: id
        }
      : { turnNumber: game.turnNumber, actionId: id };
    const event = playable ? "play_card" : "draw_card";

    const first = await current.emitAck(event, payload);
    const second = await current.emitAck(event, payload);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    server.rooms.rooms.get(room.roomCode)!.game!.verify();
  });

  it("restores the same seat, hand, deck and turn after a reconnect", async () => {
    const room = await createStartedRoom(["重连甲", "重连乙"]);
    const rejoining = room.clients[1]!;
    const token = room.tokens[1]!;
    const before = rejoining.state!;
    const handIds = before.you.hand.map((card) => card.id).sort();
    const seat = before.you.seat;
    const deckCount = before.game!.deckCount;
    const turnNumber = before.game!.turnNumber;
    rejoining.close();
    await room.clients[0]!.waitForState(
      (state) => state.players.some((player) => !player.connected)
    );

    const resumed = await client();
    await resumed.login(rejoining.username, rejoining.password);
    await resumed.resume(room.roomCode, token);
    const after = await resumed.waitForState(
      (state) => state.players.filter((player) => player.connected).length === 2
    );

    expect(after.you.seat).toBe(seat);
    expect(after.you.hand.map((card) => card.id).sort()).toEqual(handIds);
    expect(after.game!.deckCount).toBe(deckCount);
    expect(after.game!.turnNumber).toBe(turnNumber);
    expect(after.roomCode).toBe(room.roomCode);
    const serverRoom = server.rooms.rooms.get(room.roomCode)!;
    expect(serverRoom.players).toHaveLength(2);
    serverRoom.game!.verify();
  });

  it("notifies the room when a returning account rejoins by room code", async () => {
    const host = await client();
    const guest = await client();
    await host.register("回房房主");
    await guest.register("回房玩家");
    const created = await host.createRoom("回房房主");
    await guest.joinRoom(created.roomCode, "回房玩家");
    guest.close();
    await host.waitForState((state) =>
      state.players.some(
        (player) => player.name === "回房玩家" && !player.connected
      )
    );

    const returning = await client();
    await returning.login("回房玩家", "TestPass123!");
    await returning.joinRoom(created.roomCode, "回房玩家");
    const restored = await host.waitForState((state) =>
      state.players.some(
        (player) => player.name === "回房玩家" && player.connected
      )
    );
    expect(
      restored.players.filter((player) => player.name === "回房玩家")
    ).toHaveLength(1);
  });

  it("transfers host control and allows the remaining player to continue", async () => {
    const room = await createStartedRoom(["房主", "继任者"]);
    const [host, successor] = room.clients;
    await host!.emitAck("leave_room", { actionId: randomUUID() });
    const state = await successor!.waitForState(
      (candidate) =>
        candidate.phase === "finished" &&
        candidate.players.find((player) => player.id === candidate.hostId)?.id ===
          candidate.you.id
    );

    expect(state.hostId).toBe(state.you.id);
    expect(state.game?.winnerId).toBe(state.you.id);
    expect(
      state.players.find((player) => !player.active)?.name
    ).toBe("房主");
    server.rooms.rooms.get(room.roomCode)!.game!.verify();
  });

  it("transfers host on a disconnected host and keeps the new host after reconnect", async () => {
    const host = await client();
    const guest = await client();
    await host.register("断线房主");
    await guest.register("在线玩家");
    const created = await host.createRoom("断线房主");
    await guest.joinRoom(created.roomCode, "在线玩家");
    host.close();
    const transferred = await guest.waitForState(
      (state) => state.hostId === state.you.id
    );
    expect(transferred.hostId).toBe(transferred.you.id);

    const resumedHost = await client();
    await resumedHost.login(host.username, host.password);
    await resumedHost.resume(created.roomCode, created.token);
    const restored = await resumedHost.waitForState(
      (state) =>
        state.players.filter((player) => player.connected).length === 2
    );
    expect(restored.you.isHost).toBe(false);
    expect(restored.hostId).toBe(transferred.you.id);
  });

  it("restores host control when the only connected player reconnects later", async () => {
    const room = await createStartedRoom(["先断玩家", "后断房主"]);
    const [host, guest] = room.clients;
    const hostPlayerId = host!.state!.you.id;
    guest!.close();
    await host!.waitForState((state) =>
      state.players.some((player) => !player.connected)
    );
    host!.close();
    await expect
      .poll(
        () =>
          server.rooms.rooms
            .get(room.roomCode)!
            .players.find((player) => player.id === hostPlayerId)?.connected,
        { timeout: 2000 }
      )
      .toBe(false);

    const returning = await client();
    await returning.login(guest!.username, guest!.password);
    await returning.resume(room.roomCode, room.tokens[1]!);
    const restored = await returning.waitForState(
      (state) => state.you.connected && state.you.isHost
    );
    expect(restored.hostId).toBe(restored.you.id);
    expect(
      restored.players.find((player) => player.id === restored.hostId)?.ready
    ).toBe(true);
    server.rooms.rooms.get(room.roomCode)!.game!.verify();
  });

  it("moves the previous device to the lobby when the same account resumes elsewhere", async () => {
    const first = await client();
    const second = await client();
    await first.register("同账号玩家");
    const created = await first.createRoom("同账号玩家");
    await second.login("同账号玩家", "TestPass123!");
    const joined = await second.joinRoom(created.roomCode, "同账号玩家");

    await expect
      .poll(() => first.replacedMessage, { timeout: 2000 })
      .toContain("另一台设备");
    const room = server.rooms.rooms.get(created.roomCode)!;
    expect(room.players).toHaveLength(1);
    expect(room.players[0]!.id).toBe(joined.playerId);
    expect(room.players[0]!.socketId).toBe(second.socket.id);
    expect(first.socket.connected).toBe(true);

    const rejected = await first.setReady(true);
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe("NOT_IN_ROOM");
  });

  it("plays a complete two-player game through the real server", async () => {
    const room = await createStartedRoom(["完整甲", "完整乙"]);
    await runAutomatedGame(room.clients);
    const finished = room.clients.map((instance) => instance.state!);
    expect(finished.every((state) => state.phase === "finished")).toBe(true);
    expect(finished[0]!.game!.winnerId).toBeTruthy();
    expect(finished[1]!.game!.winnerId).toBe(finished[0]!.game!.winnerId);
    const serverRoom = server.rooms.rooms.get(room.roomCode)!;
    const oldplus10 = serverRoom.game!.plus10CardId;
    const oldGameId = serverRoom.game!.id;
    serverRoom.game!.verify();

    const restart = await room.clients[0]!.emitAck("restart_game", {
      actionId: randomUUID()
    });
    expect(restart.ok).toBe(true);
    await Promise.all(
      room.clients.map((instance) =>
        instance.waitForState((state) => state.phase === "playing")
      )
    );
    expect(serverRoom.game!.id).not.toBe(oldGameId);
    expect(serverRoom.game!.plus10CardId).not.toBe(oldplus10);
    expect(serverRoom.game!.players.every((player) => player.hand.length >= 7)).toBe(
      true
    );
    serverRoom.game!.verify();
  });

  it("resolves a real +4 challenge through the server", async () => {
    const room = await createStartedRoom(["加四甲", "加四乙"]);
    const serverRoom = server.rooms.rooms.get(room.roomCode)!;
    const game = serverRoom.game!;
    const current = game.currentPlayer;
    const wild4 = extractCard(game, (card) => card.kind === "wild4");
    const matching = extractCard(
      game,
      (card) => card.color === game.currentColor
    );
    current.hand.push(wild4, matching);
    serverRoom.emitStates();
    const currentClient = room.clients.find(
      (instance) => instance.state?.you.id === current.id
    )!;
    const attackingState = await currentClient.waitForState((state) =>
      state.game!.playableCardIds.includes(wild4.id)
    );
    const beforeHandCount = current.hand.length;

    const playResult = await currentClient.emitAck("play_card", {
      cardId: wild4.id,
      color: "yellow",
      turnNumber: attackingState.game!.turnNumber,
      actionId: randomUUID()
    });
    expect(playResult.ok).toBe(true);

    const targetId = game.pendingPenalty?.targetId;
    const targetClient = room.clients.find(
      (instance) => instance.state?.you.id === targetId
    )!;
    const pendingState = await targetClient.waitForState(
      (state) => state.game?.pendingPenalty?.canRespond === true
    );
    const challenge = await targetClient.emitAck("respond_penalty", {
      decision: "challenge",
      turnNumber: pendingState.game!.turnNumber,
      actionId: randomUUID()
    });
    expect(challenge.ok).toBe(true);
    const after = await targetClient.waitForState(
      (state) => state.game?.lastEvent?.type === "wild4_challenge_won"
    );
    expect(after.game!.currentPlayerId).toBe(targetId);
    expect(current.hand).toHaveLength(beforeHandCount - 1 + 4);
    game.verify();
  });

  it("stacks two +2 cards through the real server and applies the total", async () => {
    const room = await createStartedRoom(["叠加甲", "叠加乙", "叠加丙"]);
    const serverRoom = server.rooms.rooms.get(room.roomCode)!;
    const game = serverRoom.game!;
    const index = game.players.findIndex(
      (player) => player.id === game.currentPlayerId
    );
    const firstPlayer = game.players[index]!;
    const secondPlayer = game.players[(index + 1) % game.players.length]!;
    const thirdPlayer = game.players[(index + 2) % game.players.length]!;
    const first = extractCard(game, (card) => card.kind === "draw2");
    const second = extractCard(game, (card) => card.kind === "draw2");
    firstPlayer.hand.push(first);
    secondPlayer.hand.push(second);
    game.currentColor = first.color ?? game.currentColor;
    serverRoom.emitStates();

    const firstClient = room.clients.find(
      (instance) => instance.state?.you.id === firstPlayer.id
    )!;
    const secondClient = room.clients.find(
      (instance) => instance.state?.you.id === secondPlayer.id
    )!;
    const thirdClient = room.clients.find(
      (instance) => instance.state?.you.id === thirdPlayer.id
    )!;
    const firstState = await firstClient.waitForState((state) =>
      state.game!.playableCardIds.includes(first.id)
    );
    const firstPlay = await firstClient.emitAck("play_card", {
      cardId: first.id,
      turnNumber: firstState.game!.turnNumber,
      actionId: randomUUID()
    });
    expect(firstPlay.ok).toBe(true);

    const secondState = await secondClient.waitForState(
      (state) =>
        state.game?.pendingPenalty?.canRespond === true &&
        state.game.pendingPenalty.total === 2
    );
    const secondPlay = await secondClient.emitAck("play_card", {
      cardId: second.id,
      turnNumber: secondState.game!.turnNumber,
      actionId: randomUUID()
    });
    expect(secondPlay.ok).toBe(true);

    const thirdBefore = thirdPlayer.hand.length;
    const thirdState = await thirdClient.waitForState(
      (state) =>
        state.game?.pendingPenalty?.canRespond === true &&
        state.game.pendingPenalty.total === 4
    );
    const accepted = await thirdClient.emitAck("respond_penalty", {
      decision: "accept",
      turnNumber: thirdState.game!.turnNumber,
      actionId: randomUUID()
    });
    expect(accepted.ok).toBe(true);
    const after = await thirdClient.waitForState(
      (state) => state.game?.pendingPenalty === null
    );
    await Promise.all(
      room.clients.map((instance) =>
        instance.waitForState(
          (state) => state.game?.pendingPenalty === null
        )
      )
    );
    expect(thirdPlayer.hand).toHaveLength(thirdBefore + 4);
    expect(after.game!.currentPlayerId).toBe(firstPlayer.id);
    expect(
      room.clients.every(
        (instance) => instance.state?.game?.pendingPenalty === null
      )
    ).toBe(true);
    game.verify();
  });

  it("applies the unique +10 penalty with one synchronized random color", async () => {
    const room = await createStartedRoom(["加十甲", "加十乙"]);
    const serverRoom = server.rooms.rooms.get(room.roomCode)!;
    const game = serverRoom.game!;
    const current = game.currentPlayer;
    const plus10 = extractCard(game, (card) => card.kind === "wild10");
    current.hand.push(plus10);
    serverRoom.emitStates();
    const currentClient = room.clients.find(
      (instance) => instance.state?.you.id === current.id
    )!;
    const attackingState = await currentClient.waitForState((state) =>
      state.game!.playableCardIds.includes(plus10.id)
    );
    const targetPlayer = game.players.find(
      (player) => player.id !== current.id
    )!;
    const targetBefore = targetPlayer.hand.length;

    const result = await currentClient.emitAck("play_card", {
      cardId: plus10.id,
      turnNumber: attackingState.game!.turnNumber,
      actionId: randomUUID()
    });
    expect(result.ok).toBe(true);

    const states = await Promise.all(
      room.clients.map((instance) =>
        instance.waitForState(
          (state) => state.game?.discardTop.id === plus10.id
        )
      )
    );
    const color = states[0]!.game!.currentColor;
    expect(states.every((state) => state.game!.currentColor === color)).toBe(
      true
    );
    expect(states[0]!.game!.currentPlayerId).toBe(current.id);
    expect(targetPlayer.hand).toHaveLength(targetBefore + 10);
    expect(
      [
        ...game.deck,
        ...game.discard,
        ...game.players.flatMap((player) => player.hand)
      ].filter((card) => card.kind === "wild10")
    ).toHaveLength(1);
    expect(game.discard.at(-1)?.id).toBe(plus10.id);
    game.verify();
  });

  it("broadcasts quick emotes to everyone without touching game state", async () => {
    const room = await createStartedRoom(["表情甲", "表情乙"]);
    const [sender, receiver] = room.clients;
    const senderId = sender!.state!.you.id;
    const gameBefore = JSON.stringify(sender!.state!.game);

    const firstSend = await sender!.sendEmote("😹");
    expect(firstSend.ok).toBe(true);
    const [senderCopy, receiverCopy] = await Promise.all([
      sender!.waitForEmote((message) => message.emoji === "😹"),
      receiver!.waitForEmote((message) => message.emoji === "😹")
    ]);
    expect(senderCopy.playerId).toBe(senderId);
    expect(receiverCopy.playerId).toBe(senderId);
    expect(receiverCopy.id).toBe(senderCopy.id);
    expect(JSON.stringify(sender!.state!.game)).toBe(gameBefore);

    const repeatSend = await sender!.sendEmote("😹");
    expect(repeatSend.ok).toBe(true);
    const repeated = await receiver!.waitForEmote(
      (message) => message.emoji === "😹" && message.id !== receiverCopy.id
    );
    expect(repeated.id).not.toBe(receiverCopy.id);
    expect(JSON.stringify(sender!.state!.game)).toBe(gameBefore);
  });

  it("rejects invalid emotes, lobby emotes, and non-room senders", async () => {
    const host = await client();
    const hostName = "eh" + randomUUID().replace(/-/g, "").slice(0, 8);
    await host.register(hostName);
    const created = await host.createRoom(hostName);
    try {
      const lobbySend = await host.sendEmote("👍");
      expect(lobbySend.ok).toBe(false);
      expect(lobbySend.code).toBe("GAME_NOT_STARTED");

      const outsider = await client();
      await outsider.register(
        "eo" + randomUUID().replace(/-/g, "").slice(0, 8)
      );
      const outsideSend = await outsider.sendEmote("👍");
      expect(outsideSend.ok).toBe(false);
      expect(outsideSend.code).toBe("NOT_IN_ROOM");
    } finally {
      server.rooms.rooms.delete(created.roomCode);
    }

    const room = await createStartedRoom(["表情丙", "表情丁"]);
    const sender = room.clients[0]!;
    const invalid = await sender.sendEmote("<script>alert(1)</script>");
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe("INVALID_EMOTE");
  });

  it("rate limits a player to two emotes per second", async () => {
    const room = await createStartedRoom(["表情戊", "表情己"]);
    const sender = room.clients[0]!;
    const results = await Promise.all([
      sender.sendEmote("🤩"),
      sender.sendEmote("😂"),
      sender.sendEmote("👍")
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    const limited = results.find(
      (result) => !result.ok && result.code === "EMOTE_RATE_LIMIT"
    );
    expect(limited).toBeDefined();
  });
});
