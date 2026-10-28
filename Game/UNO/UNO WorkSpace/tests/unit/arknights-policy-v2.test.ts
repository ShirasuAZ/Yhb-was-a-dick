import { describe, expect, it } from "vitest";
import { actingPlayerId, applyAction, type EngineContext } from "../../../../Arknights/ArknightsWorkSpace/src/shared/engine.ts";
import { legalActions } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/legal.ts";
import { createMatch, makeRng, nextRandom, wantsMulligan } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/match.ts";
import { deckCards, PRESET_DECKS } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/decks.ts";
import { ACTION_CARD_SLOTS, actionCardIds, actionFeatures, ACTION_FEATURES, observe, observeCardIds, OBSERVATION_CARD_SLOTS, OBSERVATION_SIZE } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/features.ts";
import { CARD_INDEX_SIZE } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/card-index.ts";
import { chooseByPolicy, loadPolicy, policyScores, scoreActions, type PolicyWeightsJson } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/policy.ts";
import { UNION_ARENA_CATALOG } from "../../../../Arknights/ArknightsWorkSpace/src/server/catalog.ts";
import { cardContext } from "../../../../Arknights/ArknightsWorkSpace/src/shared/abilities/registry.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx: EngineContext = cardContext((id) => byId.get(id));
const DIM = 4;

/** A small random version 2 network with the real input sizes. */
function randomWeights(seed: number): PolicyWeightsJson {
  const rng = makeRng(seed);
  const values = (count: number): string => Buffer.from(Float32Array.from({ length: count }, () => (nextRandom(rng) - 0.5) * 0.2).buffer).toString("base64");
  const layer = (input: number, output: number) => ({ in: input, out: output, w: values(input * output), b: values(output) });
  return {
    version: 2,
    observationSize: OBSERVATION_SIZE,
    actionFeatures: ACTION_FEATURES,
    layers: {
      state1: layer(OBSERVATION_SIZE + OBSERVATION_CARD_SLOTS * DIM, 16), state2: layer(16, 8),
      action1: layer(ACTION_FEATURES + ACTION_CARD_SLOTS * DIM, 8), action2: layer(8, 8),
      head1: layer(24, 8), head2: layer(8, 1)
    },
    embedding: { rows: CARD_INDEX_SIZE, dim: DIM, w: values(CARD_INDEX_SIZE * DIM) }
  };
}

describe("Arknights policy network with card vectors (version 2)", () => {
  it("appends each card's vector to the observation and the action inputs", () => {
    const policy = loadPolicy(randomWeights(1));
    const plain = { layers: policy.layers };
    const table = policy.embedding!.w;
    const withVectors = (values: Float32Array, ids: Int32Array): Float32Array => {
      const out = new Float32Array(values.length + ids.length * DIM);
      out.set(values);
      ids.forEach((id, slot) => out.set(table.subarray(id * DIM, (id + 1) * DIM), values.length + slot * DIM));
      return out;
    };
    const match = createMatch([{ id: "a", name: "A", deck: deckCards(PRESET_DECKS[0]!) }, { id: "b", name: "B", deck: deckCards(PRESET_DECKS[2]!) }], 4, { mulligan: (player) => wantsMulligan(ctx, player.hand) });
    for (let step = 0; step < 120 && match.game.step === "turn"; step += 1) {
      const actor = actingPlayerId(match.game)!;
      const actions = legalActions(match.game, match.players, ctx, actor);
      const expected = scoreActions(plain, withVectors(observe(match.game, match.players, ctx, actor), observeCardIds(match.game, match.players, ctx, actor)),
        actions.map((action) => withVectors(actionFeatures(match.game, match.players, ctx, actor, action), actionCardIds(match.game, match.players, ctx, actor, action))));
      const scores = policyScores(policy, match.game, match.players, ctx, actor, actions);
      scores.forEach((score, index) => expect(score).toBeCloseTo(expected[index]!, 5));
      applyAction(match.game, match.players, ctx, actor, chooseByPolicy(policy, match.game, match.players, ctx, actor)!);
    }
    expect(Array.from(observeCardIds(match.game, match.players, ctx, "a")).some((id) => id > 0)).toBe(true);
  });

  it("refuses weights made for more cards than this build knows", () => {
    const weights = randomWeights(2);
    weights.embedding!.rows = CARD_INDEX_SIZE + 1;
    expect(() => loadPolicy(weights)).toThrow();
  });
});
