import { describe, expect, it } from "vitest";
import { UNION_ARENA_CATALOG } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/catalog.ts";
import { UnionArenaRoom } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/rooms.ts";
import type { UnionArenaAccount, UnionArenaAuthProvider } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { PRESET_DECKS, deckCards } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/decks.ts";
import type { IpId } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ips.ts";

const ACCOUNTS: UnionArenaAccount[] = [{ id: "a", username: "A", avatarUrl: null }, { id: "b", username: "B", avatarUrl: null }];
const AUTH: UnionArenaAuthProvider = {
  verifyToken: () => null,
  findAccount: (id) => ACCOUNTS.find((account) => account.id === id) ?? null
};

/** 50 legal cards of one title, from the catalog. */
function deckOf(ipId: IpId): string[] {
  const limited = ["特殊", "色彩", "最终"];
  const seen = new Set<string>();
  const out: string[] = [];
  const perTrigger: Record<string, number> = {};
  for (const card of UNION_ARENA_CATALOG) {
    if (card.ipId !== ipId || !card.imageAvailable || !card.stats || seen.has(card.number)) continue;
    seen.add(card.number);
    const label = card.stats.trigger?.label;
    if (label !== undefined && limited.includes(label) && (perTrigger[label] ?? 0) >= 4) continue;
    const take = Math.min(4, 50 - out.length);
    if (label !== undefined && limited.includes(label)) perTrigger[label] = (perTrigger[label] ?? 0) + take;
    for (let index = 0; index < take; index += 1) out.push(card.id);
    if (out.length >= 50) break;
  }
  return out;
}

function room(): { room: UnionArenaRoom; a: ReturnType<UnionArenaRoom["add"]>; b: ReturnType<UnionArenaRoom["add"]> } {
  const instance = new UnionArenaRoom("XIP001", UNION_ARENA_CATALOG, new Set(UNION_ARENA_CATALOG.map((card) => card.id)), AUTH);
  const seats = ACCOUNTS.map((account, index) => instance.add(account, { id: `s${index}`, data: {}, join: () => undefined } as never));
  // No namespace: `broadcast` is never called by the methods under test.
  return { room: instance, a: seats[0]!, b: seats[1]! };
}

describe("a room where the two players bring different titles", () => {
  it("accepts one deck of each title, and reads each deck's title from its cards", () => {
    const { room: instance, a, b } = room();
    instance.updateDeck(a, deckOf("jjk"), 3);
    instance.updateDeck(b, deckOf("aot"), 3);
    expect(a.deckCheck.structuralOk, a.deckCheck.issues.join(" / ")).toBe(true);
    expect(b.deckCheck.structuralOk, b.deckCheck.issues.join(" / ")).toBe(true);
    // The titles were worked out from the cards, not taken from anything a client sent.
    expect(a.deckIpId).toBe("jjk");
    expect(b.deckIpId).toBe("aot");
  });

  it("tells each seat the opponent's title and deck size, but never a card", () => {
    const { room: instance, a, b } = room();
    instance.updateDeck(a, deckOf("jjk"), 3);
    instance.updateDeck(b, deckOf("aot"), 3);
    const seenByA = instance.stateFor(a);
    const opponent = seenByA.players.find((player) => player.id === "b")!;
    expect(opponent.deckIpId).toBe("aot");
    expect(opponent.deckSize).toBe(50);
    expect(opponent.deckLegal).toBe(true);
    // Nothing about the opponent's actual cards leaks through the player list.
    expect(JSON.stringify(seenByA.players)).not.toMatch(/cardId|"deck"\s*:/);
  });

  it("freezes both decks when the game starts", () => {
    const { room: instance, a, b } = room();
    instance.updateDeck(a, deckOf("jjk"), 3);
    instance.updateDeck(b, deckOf("aot"), 3);
    instance.startGame();
    expect(a.deckSnapshot?.ipId).toBe("jjk");
    expect(b.deckSnapshot?.ipId).toBe("aot");
    const frozenJjk = [...a.deckSnapshot!.cardIds];
    // A deck submitted after the start cannot change the frozen one (the manager refuses it before this, but the
    // snapshot is what the game reads even if something tried).
    instance.updateDeck(a, deckOf("kmy"), 3);
    expect(a.deckSnapshot!.cardIds).toEqual(frozenJjk);
    expect(a.deckSnapshot!.ipId).toBe("jjk");
    // The seat keeps reporting the frozen title during the game.
    expect(instance.stateFor(a).players.find((player) => player.id === "a")!.deckIpId).toBe("jjk");
  });

  it("clears the snapshot when a seat leaves mid-game, so the next game freezes afresh", () => {
    const { room: instance, a, b } = room();
    instance.updateDeck(a, deckOf("jjk"), 3);
    instance.updateDeck(b, deckOf("aot"), 3);
    instance.startGame();
    expect(a.deckSnapshot).not.toBeNull();
    // A game cannot go on with one seat: the room falls back to its lobby, ready for another opponent.
    instance.remove(b);
    expect(a.deckSnapshot).toBeNull();
    expect(instance.phase).toBe("lobby");
    // The submitted deck itself survives, ready for another game.
    expect(a.deck).toHaveLength(50);
  });
});
