import { describe, expect, it } from "vitest";
import { agentActions, agentView, advance, applyAgentAction, computerPlayer, describeAction } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/agent.ts";
import { dealMatch, makeRng, randomInt } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/match.ts";
import { deckCards, PRESET_DECKS } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/decks.ts";
import { UNION_ARENA_CATALOG } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/catalog.ts";
import { cardContext } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx = cardContext((id) => byId.get(id));

describe("Arknights agent API", () => {
  it("plays whole games one decision at a time, every decision described, against a computer player", () => {
    for (const seed of [1, 2, 3]) {
      const rng = makeRng(seed);
      const match = dealMatch([{ id: "agent", name: "A", deck: deckCards(PRESET_DECKS[1]!) }, { id: "cpu", name: "C", deck: deckCards(PRESET_DECKS[seed % 4]!) }], seed, (seed % 2) as 0 | 1);
      const opponent = computerPlayer("normal", ctx, { rng });
      let decisions = 0;
      advance(match, ctx, "agent", opponent);
      while (match.game.step !== "over" && decisions < 3000) {
        const actions = agentActions(match, ctx, "agent");
        expect(actions.length).toBeGreaterThan(0);
        for (const entry of actions) expect(entry.text.length).toBeGreaterThan(0);
        applyAgentAction(match, ctx, "agent", actions[randomInt(rng, actions.length)]!);
        decisions += 1;
        advance(match, ctx, "agent", opponent);
      }
      expect(match.game.step).toBe("over");
      expect(agentActions(match, ctx, "agent")).toEqual([]);
    }
  });

  it("shows the agent only what it may see: no opponent hand cards, no deck order", () => {
    const match = dealMatch([{ id: "agent", name: "A", deck: deckCards(PRESET_DECKS[1]!) }, { id: "cpu", name: "C", deck: deckCards(PRESET_DECKS[0]!) }], 5, 0);
    advance(match, ctx, "agent", computerPlayer("easy", ctx, { rng: makeRng(5) }));
    const view = agentView(match.game, match.players, ctx, "agent");
    const text = JSON.stringify(view);
    const cpu = match.players[1];
    expect(view.opponent.hand).toBe(cpu.hand.length);
    expect(text).not.toContain(cpu.library[0]!);
    expect(view.you.hand.map((card) => card.id)).toEqual(match.players[0].hand);
    expect(view.you.hand[0]).toMatchObject({ name: expect.any(String), costNow: { energy: expect.any(Number), ap: expect.any(Number) } });
  });

  it("describes moves in plain words", () => {
    const match = dealMatch([{ id: "agent", name: "A", deck: deckCards(PRESET_DECKS[1]!) }, { id: "cpu", name: "C", deck: deckCards(PRESET_DECKS[0]!) }], 9, 0);
    expect(agentActions(match, ctx, "agent").map((entry) => entry.text)).toEqual(["保留起手牌", "重抽 7 张（手牌放到牌库底、抽 7 张新牌、洗牌）"]);
    expect(describeAction(match.game, match.players, ctx, "agent", { type: "end_turn" })).toBe("结束回合");
    expect(describeAction(match.game, match.players, ctx, "agent", { type: "event", handIndex: 0 })).toMatch(/^使用事件「.+」$/);
    expect(describeAction(match.game, match.players, ctx, "agent", { type: "discard", keep: [0, 1, 2, 3, 4, 6] })).toMatch(/^弃掉 5\.「.+」$/);
  });
});
