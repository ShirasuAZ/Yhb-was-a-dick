import { describe, expect, it } from "vitest";
import { UNION_ARENA_CATALOG } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/catalog.ts";
import { checkUnionArenaDeck } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/types.ts";

/** The trigger types limited to four cards each, as in the rule manual ("Decks"). */
const LIMITED_TRIGGERS = ["特殊", "色彩", "最终"];

/**
 * 50 card ids of one title that obey every deck rule: at most four per card number, and at most four cards for each of
 * the 特殊 / 色彩 / 最终 trigger types.
 */
function deckOf(ipId: string): string[] {
  const ids: string[] = [];
  const perNumber = new Map<string, number>();
  const perTrigger = new Map<string, number>();
  for (const card of UNION_ARENA_CATALOG) {
    if (card.ipId !== ipId || !card.imageAvailable || !card.stats) continue;
    const used = perNumber.get(card.number) ?? 0;
    if (used >= 4) continue;
    const trigger = card.stats.trigger?.label;
    const limited = trigger !== undefined && LIMITED_TRIGGERS.includes(trigger);
    if (limited && (perTrigger.get(trigger) ?? 0) >= 4) continue;
    perNumber.set(card.number, used + 1);
    if (limited) perTrigger.set(trigger, (perTrigger.get(trigger) ?? 0) + 1);
    ids.push(card.id);
    if (ids.length === 50) return ids;
  }
  return ids;
}

describe("deck rules across titles", () => {
  it("accepts a single-title deck for every title that has enough cards", () => {
    for (const ipId of ["ark", "aot", "jjk", "kmy", "eva"]) {
      const deck = deckOf(ipId);
      if (deck.length < 50) continue;
      const check = checkUnionArenaDeck(deck, 3, UNION_ARENA_CATALOG);
      expect(check.issues, `${ipId}: ${check.issues.join(" / ")}`).toEqual([]);
      expect(check.structuralOk).toBe(true);
    }
  });

  it("refuses a deck that mixes two titles", () => {
    const ark = deckOf("ark").slice(0, 25);
    const aot = deckOf("aot").slice(0, 25);
    const check = checkUnionArenaDeck([...ark, ...aot], 3, UNION_ARENA_CATALOG);
    expect(check.structuralOk).toBe(false);
    expect(check.issues.join(" ")).toMatch(/不能混用不同 IP/);
  });

  it("refuses a deck whose cards disagree with the title the client claims", () => {
    const deck = deckOf("aot");
    const check = checkUnionArenaDeck(deck, 3, UNION_ARENA_CATALOG, undefined, "ark");
    expect(check.structuralOk).toBe(false);
    expect(check.issues.join(" ")).toMatch(/不一致/);
  });

  it("accepts a deck whose declared title matches its cards", () => {
    const deck = deckOf("aot");
    expect(checkUnionArenaDeck(deck, 3, UNION_ARENA_CATALOG, undefined, "aot").structuralOk).toBe(true);
  });

  it("counts AP cards separately from the 50 main cards", () => {
    const deck = deckOf("ark");
    expect(checkUnionArenaDeck(deck, 2, UNION_ARENA_CATALOG).issues.join(" ")).toMatch(/AP 卡/);
    expect(checkUnionArenaDeck(deck, 4, UNION_ARENA_CATALOG).issues.join(" ")).toMatch(/AP 卡/);
    // 51 main cards is also refused, even with the right AP count.
    expect(checkUnionArenaDeck([...deck, deck[0]!], 3, UNION_ARENA_CATALOG).issues.join(" ")).toMatch(/主牌组为 51/);
  });

  it("counts parallel art against the same card number", () => {
    const card = UNION_ARENA_CATALOG.find((entry) => entry.ipId === "ark" && entry.imageAvailable && entry.parallelIds.length >= 2 && !LIMITED_TRIGGERS.includes(entry.stats?.trigger?.label ?? ""));
    expect(card).toBeDefined();
    const rest = deckOf("ark").filter((id) => UNION_ARENA_CATALOG.find((candidate) => candidate.id === id)?.number !== card!.number);
    // Four cards of that number, alternating between its different prints: still legal.
    const four = [0, 1, 2, 3].map((index) => card!.parallelIds[index % card!.parallelIds.length]!);
    expect(new Set(four).size).toBeGreaterThan(1);
    const legal = [...four, ...rest].slice(0, 50);
    expect(checkUnionArenaDeck(legal, 3, UNION_ARENA_CATALOG).issues.join(" ")).not.toMatch(/同卡号/);
    // A fifth card of the same number goes over the limit, even though every id is a different print.
    const fifth = card!.parallelIds[4 % card!.parallelIds.length]!;
    const illegal = [fifth, ...legal].slice(0, 50);
    expect(illegal.filter((id) => UNION_ARENA_CATALOG.find((candidate) => candidate.id === id)?.number === card!.number).length).toBe(5);
    expect(checkUnionArenaDeck(illegal, 3, UNION_ARENA_CATALOG).issues.join(" ")).toMatch(/超过同卡号 4 张上限/);
  });

  it("refuses unknown card ids and cards with no image", () => {
    const deck = deckOf("ark");
    expect(checkUnionArenaDeck([...deck.slice(1), "not-a-card"], 3, UNION_ARENA_CATALOG).issues.join(" ")).toMatch(/无法使用/);
    const noImage = UNION_ARENA_CATALOG.find((card) => !card.imageAvailable);
    if (noImage) {
      expect(checkUnionArenaDeck([...deck.slice(1), noImage.id], 3, UNION_ARENA_CATALOG).issues.join(" ")).toMatch(/无法使用/);
    }
  });
});
