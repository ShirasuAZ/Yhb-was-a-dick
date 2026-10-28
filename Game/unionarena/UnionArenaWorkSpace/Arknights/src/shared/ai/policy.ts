/**
 * The reinforcement-learning player in the browser and in Node: a small neural network trained by rl/train.py, run here in plain
 * TypeScript (no ML library). It scores every legal action from the observation and the action's own features and plays the best one.
 * Version 2 weights add a learned vector per card number (card-index.ts): the cards in the observation and each action's cards are
 * looked up and appended to the inputs, so the network can tell cards with the same printed numbers apart.
 * The layer layout must match rl/train.py's `PolicyNet` (version 1) and `PolicyNetV2` (version 2).
 */
import type { UnionArenaAction } from "../protocol.ts";
import type { EngineContext, EngineGame, EnginePlayer } from "../engine.ts";
import { ACTION_CARD_SLOTS, actionCardIds, actionFeatures, ACTION_FEATURES, LEGACY_ACTION_FEATURES, LEGACY_OBSERVATION_SIZE, observe, observeCardIds, OBSERVATION_CARD_SLOTS, OBSERVATION_SIZE } from "./features.ts";
import { CARD_INDEX_SIZE } from "./card-index.ts";
import { legalActions } from "./legal.ts";

interface LayerJson { in: number; out: number; w: string; b: string; }
export interface PolicyWeightsJson {
  version: 1 | 2;
  observationSize: number;
  actionFeatures: number;
  layers: Record<"state1" | "state2" | "action1" | "action2" | "head1" | "head2", LayerJson>;
  /** Version 2: the card embedding table, `rows` x `dim` (row 0 = no card). */
  embedding?: { rows: number; dim: number; w: string };
}
export interface Layer { in: number; out: number; w: Float32Array; b: Float32Array; }
/** `observationSize` / `actionFeatures`: how much of the (prefix-compatible) feature vectors the network reads. */
export interface Policy { layers: Record<keyof PolicyWeightsJson["layers"], Layer>; embedding?: { rows: number; dim: number; w: Float32Array }; observationSize: number; actionFeatures: number }

export function decode(base64: string): Float32Array {
  const binary = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Float32Array(bytes.buffer);
}

export function loadPolicy(json: PolicyWeightsJson): Policy {
  // A network trained before green was added reads the first part of the (longer) vectors; any other size is a different feature set.
  const current = json.observationSize === OBSERVATION_SIZE && json.actionFeatures === ACTION_FEATURES;
  const legacy = json.observationSize === LEGACY_OBSERVATION_SIZE && json.actionFeatures === LEGACY_ACTION_FEATURES;
  if (!current && !legacy) throw new Error("policy was trained with different features");
  const layers = Object.fromEntries(Object.entries(json.layers).map(([name, layer]) => [name, { in: layer.in, out: layer.out, w: decode(layer.w), b: decode(layer.b) }])) as Policy["layers"];
  const sizes = { observationSize: json.observationSize, actionFeatures: json.actionFeatures };
  if (!json.embedding) return { layers, ...sizes };
  if (json.embedding.rows > CARD_INDEX_SIZE) throw new Error("policy knows cards this build does not");
  return { layers, ...sizes, embedding: { rows: json.embedding.rows, dim: json.embedding.dim, w: decode(json.embedding.w) } };
}

/** `values` followed by the embedding rows of `ids` (cards the table does not have count as no card). */
function withCards(policy: Policy, values: ArrayLike<number>, ids: ArrayLike<number>): Float32Array {
  const { dim, rows, w } = policy.embedding!;
  const out = new Float32Array(values.length + ids.length * dim);
  out.set(values as Float32Array, 0);
  for (let slot = 0; slot < ids.length; slot += 1) {
    const row = ids[slot]! < rows ? ids[slot]! : 0;
    out.set(w.subarray(row * dim, (row + 1) * dim), values.length + slot * dim);
  }
  return out;
}

/** y = W x + b (W is out x in, row-major, as PyTorch stores it), then ReLU unless `linear`. */
export function dense(layer: Layer, input: ArrayLike<number>, linear = false): Float32Array {
  const output = new Float32Array(layer.out);
  for (let row = 0; row < layer.out; row += 1) {
    let sum = layer.b[row]!;
    const offset = row * layer.in;
    for (let column = 0; column < layer.in; column += 1) sum += layer.w[offset + column]! * input[column]!;
    output[row] = linear || sum > 0 ? sum : 0;
  }
  return output;
}

/**
 * One score per action; higher is better. Version 2 policies also need the observation's card ids and each action's card ids
 * (features.ts observeCardIds / actionCardIds).
 */
export function scoreActions(policy: Policy, observation: Float32Array, actions: readonly Float32Array[], observationIds?: Int32Array, actionIds?: readonly Int32Array[]): number[] {
  const { layers } = policy;
  const stateIn = policy.embedding ? withCards(policy, observation.subarray(0, policy.observationSize), observationIds ?? new Int32Array(OBSERVATION_CARD_SLOTS)) : observation;
  const state = dense(layers.state2, dense(layers.state1, stateIn));
  return actions.map((features, index) => {
    const actionIn = policy.embedding ? withCards(policy, features.subarray(0, policy.actionFeatures), actionIds?.[index] ?? new Int32Array(ACTION_CARD_SLOTS)) : features;
    const action = dense(layers.action2, dense(layers.action1, actionIn));
    const joined = new Float32Array(state.length * 3);
    joined.set(state, 0);
    joined.set(action, state.length);
    for (let index = 0; index < state.length; index += 1) joined[state.length * 2 + index] = state[index]! * action[index]!;
    return dense(layers.head2, dense(layers.head1, joined), true)[0]!;
  });
}

/** The policy's score for each of `actions` in this position, from `playerId`'s point of view (works for version 1 and 2 weights). */
export function policyScores(policy: Policy, game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, playerId: string, actions: readonly UnionArenaAction[]): number[] {
  const observation = observe(game, players, ctx, playerId);
  const features = actions.map((action) => actionFeatures(game, players, ctx, playerId, action));
  if (!policy.embedding) return scoreActions(policy, observation, features);
  return scoreActions(policy, observation, features, observeCardIds(game, players, ctx, playerId), actions.map((action) => actionCardIds(game, players, ctx, playerId, action)));
}

export function chooseByPolicy(policy: Policy, game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, playerId: string, actions: UnionArenaAction[] = legalActions(game, players, ctx, playerId)): UnionArenaAction | null {
  if (actions.length <= 1) return actions[0] ?? null;
  const scores = policyScores(policy, game, players, ctx, playerId, actions);
  let best = 0;
  scores.forEach((score, index) => { if (score > scores[best]!) best = index; });
  return actions[best]!;
}
