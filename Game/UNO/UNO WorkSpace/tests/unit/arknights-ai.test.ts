import { describe, expect, it } from "vitest";
import { actingPlayerId, applyAction, type EngineContext } from "../../../../Arknights/ArknightsWorkSpace/src/shared/engine.ts";
import { legalActions } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/legal.ts";
import { chooseHeuristic, type HeuristicLevel } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/heuristic.ts";
import { cloneMatch, createMatch, makeRng, wantsMulligan, type Match } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/match.ts";
import { deckCards, PRESET_DECKS } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/decks.ts";
import { UNION_ARENA_CATALOG } from "../../../../Arknights/ArknightsWorkSpace/src/server/catalog.ts";
import { checkUnionArenaDeck } from "../../../../Arknights/ArknightsWorkSpace/src/server/types.ts";
import { chooseBySearch, determinize } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/search.ts";
import { actionFeatures, ACTION_FEATURES, observe, OBSERVATION_SIZE } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/features.ts";
import { chooseByPolicy, loadPolicy, type PolicyWeightsJson } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/policy.ts";
import weights from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/policy-weights.json";
import { cardContext, isAutomated } from "../../../../Arknights/ArknightsWorkSpace/src/shared/abilities/registry.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx: EngineContext = cardContext((id) => byId.get(id));

function newMatch(seed: number): Match {
  return createMatch([
    { id: "a", name: "A", deck: deckCards(PRESET_DECKS[0]!) },
    { id: "b", name: "B", deck: deckCards(PRESET_DECKS[1]!) }
  ], seed, { mulligan: (player) => wantsMulligan(ctx, player.hand) });
}

/** Plays a game to the end with the given levels; returns the winner and how many actions it took. */
function playOut(match: Match, levels: Record<string, HeuristicLevel>, seed: number): { winner: string | null; actions: number } {
  const rng = makeRng(seed);
  let actions = 0;
  while (match.game.step === "turn" && actions < 5000) {
    const actor = actingPlayerId(match.game)!;
    const action = chooseHeuristic(match, ctx, actor, levels[actor]!, rng)!;
    applyAction(match.game, match.players, ctx, actor, action);
    actions += 1;
  }
  return { winner: match.game.winnerId, actions };
}

describe("Arknights computer players", () => {
  it("uses legal preset decks made only of cards the engine runs by itself", () => {
    for (const deck of PRESET_DECKS) {
      expect(checkUnionArenaDeck(deckCards(deck), 3, UNION_ARENA_CATALOG)).toEqual({ structuralOk: true, issues: [] });
      for (const id of deckCards(deck)) expect(isAutomated(byId.get(id)!), id).toBe(true);
    }
  });

  it("deals the same game from the same seed", () => {
    const one = newMatch(42);
    const two = newMatch(42);
    expect(one.players.map((player) => [player.hand, player.library, player.life])).toEqual(two.players.map((player) => [player.hand, player.library, player.life]));
    expect(newMatch(43).players[0].hand).not.toEqual(one.players[0].hand);
  });

  it("lists only actions the engine accepts, at every decision of many games", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const match = newMatch(seed);
      const rng = makeRng(seed);
      let steps = 0;
      while (match.game.step === "turn" && steps < 3000) {
        const actor = actingPlayerId(match.game)!;
        const actions = legalActions(match.game, match.players, ctx, actor);
        expect(actions.length, `seed ${seed} step ${steps}`).toBeGreaterThan(0);
        for (const action of actions) {
          const copy = cloneMatch(match);
          expect(() => applyAction(copy.game, copy.players, ctx, actor, action), JSON.stringify(action)).not.toThrow();
        }
        applyAction(match.game, match.players, ctx, actor, chooseHeuristic(match, ctx, actor, "easy", rng, actions)!);
        steps += 1;
      }
      expect(match.game.step).toBe("over");
    }
  });

  it("finishes every game, and the normal level beats the easy one most of the time", () => {
    let normalWins = 0;
    const games = 200;
    for (let seed = 0; seed < games; seed += 1) {
      const normal = seed % 2 === 0 ? "a" : "b";
      const result = playOut(newMatch(1000 + seed), { [normal]: "normal", [normal === "a" ? "b" : "a"]: "easy" }, seed);
      expect(result.winner).not.toBeNull();
      if (result.winner === normal) normalWins += 1;
    }
    expect(normalWins / games).toBeGreaterThan(0.6);
  });

  it("search only fills in what the searching player cannot see", () => {
    const match = newMatch(7);
    const world = determinize(match, "a", makeRng(3));
    const [a, b] = match.players;
    const [wa, wb] = world.players;
    expect(wa.hand).toEqual(a.hand);
    expect([...wa.library, ...wa.life.map((slot) => slot.cardId)].sort()).toEqual([...a.library, ...a.life.map((slot) => slot.cardId)].sort());
    expect([...wb.hand, ...wb.library, ...wb.life.map((slot) => slot.cardId)].sort()).toEqual([...b.hand, ...b.library, ...b.life.map((slot) => slot.cardId)].sort());
    expect(wb.hand.length).toBe(b.hand.length);
    expect(world.game).toEqual(match.game);
    // The search's choice is always one of the legal actions.
    const actor = actingPlayerId(match.game)!;
    const choice = chooseBySearch(match, ctx, actor, { budgetMs: 1e9, maxRollouts: 3, maxActions: 4 }, 5);
    expect(legalActions(match.game, match.players, ctx, actor)).toContainEqual(choice);
  });

  it("encodes observations and actions with fixed sizes and without hidden cards", () => {
    const match = newMatch(9);
    const actor = actingPlayerId(match.game)!;
    expect(observe(match.game, match.players, ctx, actor)).toHaveLength(OBSERVATION_SIZE);
    for (const action of legalActions(match.game, match.players, ctx, actor)) expect(actionFeatures(match.game, match.players, ctx, actor, action)).toHaveLength(ACTION_FEATURES);
    // Changing what the viewer cannot see (the opponent's hand, the decks, face-down life) changes nothing in its observation.
    const other = match.players.find((player) => player.accountId !== actor)!;
    const before = observe(match.game, match.players, ctx, actor);
    const swapped = determinize(match, actor, makeRng(11));
    expect(Array.from(observe(swapped.game, swapped.players, ctx, actor))).toEqual(Array.from(before));
    expect(other.hand.length).toBeGreaterThan(0);
  });

  it("plays the shipped reinforcement-learning model with legal moves to the end of a game", () => {
    const policy = loadPolicy(weights as unknown as PolicyWeightsJson);
    const match = newMatch(21);
    const rng = makeRng(21);
    let steps = 0;
    while (match.game.step === "turn" && steps < 3000) {
      const actor = actingPlayerId(match.game)!;
      const action = actor === "a" ? chooseByPolicy(policy, match.game, match.players, ctx, actor)! : chooseHeuristic(match, ctx, actor, "normal", rng)!;
      expect(legalActions(match.game, match.players, ctx, actor)).toContainEqual(action);
      applyAction(match.game, match.players, ctx, actor, action);
      steps += 1;
    }
    expect(match.game.step).toBe("over");
  });
});
