import { describe, expect, it } from "vitest";
import { LIFE_COUNT, UnionArenaRoom } from "../../../../Arknights/ArknightsWorkSpace/src/server/rooms.ts";
import { buildUnionArenaCatalog } from "../../../../Arknights/ArknightsWorkSpace/src/server/types.ts";
import type { UnionArenaAccount, UnionArenaAuthProvider } from "../../../../Arknights/ArknightsWorkSpace/src/shared/protocol.ts";

const catalog = buildUnionArenaCatalog(
  Array.from({ length: 13 }, (_, index) => ({ id: `c${index}`, number: `UC01BT/ARK-1-${String(index).padStart(3, "0")}`, name: `卡${index}`, rarity: "C", file: `c${index}.png` })),
  new Set(Array.from({ length: 13 }, (_, index) => `c${index}.png`))
);
const accounts = new Map<string, UnionArenaAccount>([
  ["a", { id: "a", username: "A", avatarUrl: null }],
  ["b", { id: "b", username: "B", avatarUrl: null }]
]);
const auth: UnionArenaAuthProvider = { verifyToken: () => null, findAccount: (id) => (id ? accounts.get(id) ?? null : null) };
const fakeSocket = (id: string) => ({ id, data: {}, join: () => undefined }) as never;

function twoPlayerRoom() {
  const room = new UnionArenaRoom("TEST22", catalog, new Set(catalog.map((card) => card.id)), auth);
  const a = room.add(accounts.get("a")!, fakeSocket("sa"));
  const b = room.add(accounts.get("b")!, fakeSocket("sb"));
  a.deck = Array.from({ length: 50 }, (_, index) => `c${index % 13}`);
  b.deck = Array.from({ length: 50 }, (_, index) => `c${(index + 3) % 13}`);
  return { room, a, b };
}

describe("Arknights life area state", () => {
  it("has no life cards before the game starts", () => {
    const { room, a } = twoPlayerRoom();
    expect(room.stateFor(a).life).toEqual({ you: [], opponent: [] });
  });

  it("deals LIFE_COUNT face-down cards per player and never sends a face-down card's identity", () => {
    const { room, a, b } = twoPlayerRoom();
    room.dealLife();
    const forA = room.stateFor(a);
    const forB = room.stateFor(b);
    expect(forA.life.you).toHaveLength(LIFE_COUNT);
    expect(forA.life.opponent).toHaveLength(LIFE_COUNT);
    expect(forA.life.you.every((card) => card.cardId === null)).toBe(true);
    expect(forA.life.opponent.every((card) => card.cardId === null)).toBe(true);
    // Each player sees the other's area as the opponent area, with the same slots.
    expect(forB.life.opponent.map((card) => card.id)).toEqual(forA.life.you.map((card) => card.id));
    expect(new Set([...forA.life.you, ...forA.life.opponent].map((card) => card.id)).size).toBe(LIFE_COUNT * 2);
    // Life data and decks stay out of the public player list.
    expect(JSON.stringify(forA.players)).not.toMatch(/life|deck|cardId/);
    // Dealt cards come from the owner's own deck.
    expect(a.life.every((slot) => a.deck.includes(slot.cardId))).toBe(true);
  });

  it("reveals only the face-up card, in place, keeping the order and count", () => {
    const { room, a, b } = twoPlayerRoom();
    room.dealLife();
    const hidden = room.stateFor(b).life.opponent.map((card) => card.id);
    a.life[2]!.faceUp = true;
    for (const viewer of [a, b]) {
      const area = viewer === a ? room.stateFor(viewer).life.you : room.stateFor(viewer).life.opponent;
      expect(area.map((card) => card.id)).toEqual(hidden);
      expect(area.map((card) => card.cardId !== null)).toEqual(area.map((_, index) => index === 2));
    }
    expect(room.stateFor(b).life.opponent[2]!.cardId).toBe(a.life[2]!.cardId);
  });

  it("shows an empty opponent area while the second seat is empty", () => {
    const room = new UnionArenaRoom("TEST23", catalog, new Set(), auth);
    const a = room.add(accounts.get("a")!, fakeSocket("sa"));
    expect(room.stateFor(a).life.opponent).toEqual([]);
  });
});
