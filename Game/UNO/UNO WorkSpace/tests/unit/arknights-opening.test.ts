import { describe, expect, it } from "vitest";
import { HAND_COUNT, LIFE_COUNT, UnionArenaRoom } from "../../../../Arknights/ArknightsWorkSpace/src/server/rooms.ts";
import { buildUnionArenaCatalog, checkUnionArenaDeck } from "../../../../Arknights/ArknightsWorkSpace/src/server/types.ts";
import type { UnionArenaAccount, UnionArenaAuthProvider } from "../../../../Arknights/ArknightsWorkSpace/src/shared/protocol.ts";

// 100 distinct cards, four per card number, so every card id is unique and a card's whereabouts can be told from its id.
const catalog = buildUnionArenaCatalog(
  Array.from({ length: 100 }, (_, index) => ({ id: `c${index}`, number: `UC01BT/ARK-1-${String(Math.floor(index / 4)).padStart(3, "0")}`, name: `卡${index}`, rarity: "C", file: `c${index}.png` })),
  new Set(Array.from({ length: 100 }, (_, index) => `c${index}.png`))
);
const deckA = Array.from({ length: 50 }, (_, index) => `c${index}`);
const deckB = Array.from({ length: 50 }, (_, index) => `c${index + 50}`);
const accounts = new Map<string, UnionArenaAccount>([
  ["a", { id: "a", username: "A", avatarUrl: null }],
  ["b", { id: "b", username: "B", avatarUrl: null }]
]);
const auth: UnionArenaAuthProvider = { verifyToken: () => null, findAccount: (id) => (id ? accounts.get(id) ?? null : null) };
const fakeSocket = (id: string) => ({ id, data: {}, join: () => undefined }) as never;

function readyRoom() {
  const room = new UnionArenaRoom("TEST24", catalog, new Set(catalog.map((card) => card.id)), auth);
  const a = room.add(accounts.get("a")!, fakeSocket("sa"));
  const b = room.add(accounts.get("b")!, fakeSocket("sb"));
  room.updateDeck(a, deckA, 3);
  room.updateDeck(b, deckB, 3);
  a.ready = true;
  b.ready = true;
  return { room, a, b };
}

describe("Arknights deck check", () => {
  it("accepts a 50-card, 3-AP, one-work, at-most-four-copies deck and nothing else is required", () => {
    const check = checkUnionArenaDeck(deckA, 3, catalog);
    expect(check).toEqual({ structuralOk: true, issues: [] });
  });

  it("reports each broken rule", () => {
    expect(checkUnionArenaDeck(deckA.slice(0, 49), 3, catalog).issues).toEqual(["主牌组为 49/50 张"]);
    expect(checkUnionArenaDeck(deckA, 2, catalog).issues).toEqual(["AP 卡为 2/3 张"]);
    // c0..c3 are four prints of one card number, so a fifth copy of any of them breaks the four-copies limit.
    const fiveCopies = [...deckA.slice(0, 49), "c0"];
    expect(checkUnionArenaDeck(fiveCopies, 3, catalog).issues).toEqual(["UC01BT/ARK-1-000 共投入 5 张，超过同卡号 4 张上限"]);
    const otherWork = buildUnionArenaCatalog([{ id: "x1", number: "UC01BT/HTR-1-001", name: "x", rarity: "C", file: "x1.png" }, ...catalog.map(({ id, number, name, rarity, file }) => ({ id, number, name, rarity, file }))], new Set(["x1.png", ...catalog.map((card) => card.file)]));
    expect(checkUnionArenaDeck([...deckA.slice(0, 49), "x1"], 3, otherWork).issues).toContain("同一副牌不能混用不同作品代码");
    expect(checkUnionArenaDeck([...deckA.slice(0, 49), "nope"], 3, catalog).structuralOk).toBe(false);
  });
});

describe("Arknights opening sequence", () => {
  it("cannot start before both players are ready with legal decks", () => {
    const { room, b } = readyRoom();
    b.ready = false;
    expect(room.readyForStart).toBe(false);
    expect(() => room.startGame()).toThrow("NOT_READY_TO_START");
    b.ready = true;
    expect(room.readyForStart).toBe(true);
    expect(room.stateFor(b).startAllowed).toBe(true);
  });

  it("changing the deck clears readiness", () => {
    const { room, a } = readyRoom();
    room.updateDeck(a, deckA, 3);
    expect(a.ready).toBe(false);
    expect(room.readyForStart).toBe(false);
  });

  it("deals the starting hands, then asks Player One first about the mulligan", () => {
    const { room, a, b } = readyRoom();
    room.startGame();
    expect(room.phase).toBe("playing");
    for (const seat of [a, b]) {
      expect(seat.hand).toHaveLength(HAND_COUNT);
      expect(seat.library).toHaveLength(50 - HAND_COUNT);
      expect(seat.life).toEqual([]);
      expect([...seat.hand, ...seat.library].sort()).toEqual([...seat.deck].sort());
    }
    const view = room.stateFor(a).game!;
    expect(view).toMatchObject({ step: "mulligan", turnPlayerId: null, handCount: { you: 7, opponent: 7 } });
    expect(["a", "b"]).toContain(view.firstPlayerId);
    expect(view.mulliganPlayerId).toBe(view.firstPlayerId);
  });

  it("puts a redrawn hand on the bottom of the deck, draws seven new cards and reshuffles", () => {
    const { room, a, b } = readyRoom();
    room.startGame();
    const first = room.stateFor(a).game!.firstPlayerId === "a" ? a : b;
    const second = first === a ? b : a;
    const oldHand = [...first.hand];
    expect(() => room.mulligan(second, false)).toThrow("NOT_YOUR_MULLIGAN");
    room.mulligan(first, true);
    expect(first.hand).toHaveLength(HAND_COUNT);
    expect(first.hand.some((card) => oldHand.includes(card))).toBe(false); // the new cards come off the top, the old hand went underneath
    expect(first.library).toHaveLength(50 - HAND_COUNT);
    expect([...first.hand, ...first.library].sort()).toEqual([...first.deck].sort());
    expect(() => room.mulligan(first, false)).toThrow("NOT_YOUR_MULLIGAN");
    expect(room.stateFor(a).game?.step).toBe("mulligan");
  });

  it("deals seven face-down life cards after both decisions, then Player One's first turn begins", () => {
    const { room, a, b } = readyRoom();
    room.startGame();
    const first = room.stateFor(a).game!.firstPlayerId === "a" ? a : b;
    const second = first === a ? b : a;
    room.mulligan(first, false);
    room.mulligan(second, true);
    for (const seat of [a, b]) {
      expect(seat.life).toHaveLength(LIFE_COUNT);
      expect(seat.hand).toHaveLength(HAND_COUNT);
      expect(seat.library).toHaveLength(50 - HAND_COUNT - LIFE_COUNT);
      expect([...seat.hand, ...seat.life.map((slot) => slot.cardId), ...seat.library].sort()).toEqual([...seat.deck].sort());
    }
    expect(room.stateFor(a).game).toMatchObject({ step: "turn", turn: 1, turnPlayerId: first.accountId, mulliganPlayerId: null, deckCount: { you: 36, opponent: 36 } });
    expect(() => room.mulligan(first, true)).toThrow("NOT_MULLIGAN_STEP");
  });

  it("never sends a face-down life card's identity, nor the opponent's hand, to either player", () => {
    const { room, a, b } = readyRoom();
    room.startGame();
    room.mulligan(room.stateFor(a).game!.mulliganPlayerId === "a" ? a : b, false);
    room.mulligan(room.stateFor(a).game!.mulliganPlayerId === "a" ? a : b, false);
    for (const [viewer, other] of [[a, b], [b, a]] as const) {
      const state = room.stateFor(viewer);
      const json = JSON.stringify(state);
      expect(state.hand).toEqual(viewer.hand);
      for (const slot of [...viewer.life, ...other.life]) expect(json).not.toContain(`"${slot.cardId}"`);
      for (const cardId of other.hand) expect(json).not.toContain(`"${cardId}"`);
      for (const cardId of [...viewer.library, ...other.library]) expect(json).not.toContain(`"${cardId}"`);
      expect([...state.life.you, ...state.life.opponent].every((card) => card.cardId === null)).toBe(true);
    }
  });

  it("returns the remaining player to the lobby when a seat is removed mid-game", () => {
    const { room, a, b } = readyRoom();
    room.startGame();
    room.remove(b);
    expect(room.phase).toBe("lobby");
    expect(room.game).toBeNull();
    expect(a).toMatchObject({ ready: false, hand: [], library: [], life: [] });
    expect(room.stateFor(a)).toMatchObject({ phase: "lobby", game: null, hand: [], playerCount: 1 });
    expect(a.deck).toEqual(deckA);
  });
});
