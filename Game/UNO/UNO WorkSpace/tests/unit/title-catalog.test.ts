import { describe, expect, it } from "vitest";
import { TITLE_CARDS, titleContext, titleCard, automatedCards } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { normalizeRaid, normalizeTrigger } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/triggers.ts";

describe("image-free title catalog", () => {
  it("has every title's cards, one per card number, with their stats", () => {
    const perTitle = new Map<string, number>();
    for (const card of TITLE_CARDS) perTitle.set(card.ipId, (perTitle.get(card.ipId) ?? 0) + 1);
    expect(Object.fromEntries(perTitle)).toEqual({ ark: 194, aot: 267, jjk: 203, kmy: 205, eva: 122 });
    expect(new Set(TITLE_CARDS.map((card) => card.id)).size).toBe(TITLE_CARDS.length);
    expect(titleContext.card("UC01BT/ARK-1-001")?.name).toBe("米莎");
  });
  it("normalizes the English triggers and the Chinese titles' Raid triggers onto the engine's vocabulary", () => {
    const special = titleContext.card(TITLE_CARDS.find((card) => card.ipId === "aot" && card.stats.trigger?.label === "SPECIAL")!.id)!;
    expect(special.trigger).toEqual({ label: "特殊", text: "选择对方前线中的1张角色退场。" });
    const active = titleContext.card(TITLE_CARDS.find((card) => card.ipId === "aot" && card.stats.trigger?.label === "Active")!.id)!;
    expect(active.trigger).toEqual({ label: "激活", text: "选择我方场上的1张角色，转为活跃状态，本回合中，BP+3000。" });
    const aotRaid = titleContext.card(TITLE_CARDS.find((card) => card.ipId === "aot" && card.stats.trigger?.label === "Raid")!.id)!;
    expect(aotRaid.trigger?.label).toBe("突进");
    expect(aotRaid.raid?.text).toBe("转为活跃状态，并可以移动至前线");
    const jjkRaid = titleContext.card(TITLE_CARDS.find((card) => card.ipId === "jjk" && /进行突进/.test(card.stats.trigger?.text ?? ""))!.id)!;
    expect(jjkRaid.trigger?.label).toBe("突进");
    expect(normalizeTrigger(null)).toBeNull();
    expect(normalizeRaid(null)).toBeNull();
  });
  it("normalizes every printed trigger sentence of every title (none is left in English)", () => {
    for (const card of TITLE_CARDS) {
      const trigger = titleContext.card(card.id)!.trigger;
      if (!trigger || !trigger.label) continue;
      expect(trigger.label, card.id).toMatch(/^[一-鿿]+$/);
      expect(trigger.text, card.id).toMatch(/[一-鿿]/);
    }
  });
  it("counts the cards the engine plays by itself today", () => {
    expect(automatedCards("ark").length).toBe(194);
    expect(titleCard("UCEX01BT/ARK-2-062").stats.type).toBe("character");
  });
});
