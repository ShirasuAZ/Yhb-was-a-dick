/**
 * The reinforcement-learning player in the browser and in Node: a small neural network trained by rl/train.py, run here in plain
 * TypeScript (no ML library). It scores every legal action from the observation and the action's own features and plays the best one.
 * The layer layout must match rl/train.py's `PolicyNet`.
 */
import type { UnionArenaAction } from "../protocol.ts";
import type { EngineContext, EngineGame, EnginePlayer } from "../engine.ts";
import { actionFeatures, ACTION_FEATURES, observe, OBSERVATION_SIZE } from "./features.ts";
import { legalActions } from "./legal.ts";

interface LayerJson { in: number; out: number; w: string; b: string; }
export interface PolicyWeightsJson {
  version: 1;
  observationSize: number;
  actionFeatures: number;
  layers: Record<"state1" | "state2" | "action1" | "action2" | "head1" | "head2", LayerJson>;
}
export interface Layer { in: number; out: number; w: Float32Array; b: Float32Array; }
export interface Policy { layers: Record<keyof PolicyWeightsJson["layers"], Layer>; }

export function decode(base64: string): Float32Array {
  const binary = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Float32Array(bytes.buffer);
}

export function loadPolicy(json: PolicyWeightsJson): Policy {
  if (json.observationSize !== OBSERVATION_SIZE || json.actionFeatures !== ACTION_FEATURES) throw new Error("policy was trained with different features");
  const layers = Object.fromEntries(Object.entries(json.layers).map(([name, layer]) => [name, { in: layer.in, out: layer.out, w: decode(layer.w), b: decode(layer.b) }])) as Policy["layers"];
  return { layers };
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

/** One score per action; higher is better. */
export function scoreActions(policy: Policy, observation: Float32Array, actions: readonly Float32Array[]): number[] {
  const { layers } = policy;
  const state = dense(layers.state2, dense(layers.state1, observation));
  return actions.map((features) => {
    const action = dense(layers.action2, dense(layers.action1, features));
    const joined = new Float32Array(state.length * 3);
    joined.set(state, 0);
    joined.set(action, state.length);
    for (let index = 0; index < state.length; index += 1) joined[state.length * 2 + index] = state[index]! * action[index]!;
    return dense(layers.head2, dense(layers.head1, joined), true)[0]!;
  });
}

export function chooseByPolicy(policy: Policy, game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, playerId: string, actions: UnionArenaAction[] = legalActions(game, players, ctx, playerId)): UnionArenaAction | null {
  if (actions.length <= 1) return actions[0] ?? null;
  const observation = observe(game, players, ctx, playerId);
  const scores = scoreActions(policy, observation, actions.map((action) => actionFeatures(game, players, ctx, playerId, action)));
  let best = 0;
  scores.forEach((score, index) => { if (score > scores[best]!) best = index; });
  return actions[best]!;
}
