/**
 * The win-rate estimate: a small network trained by rl/train_winrate.py that reads what one player can see (the same `observe` vector the
 * computer player uses) and gives the chance that this player wins. It never sees the opponent's hand or either deck, so showing a player
 * their own estimate gives away nothing. The layer layout must match rl/train_winrate.py's `WinNet`.
 */
import type { EngineContext, EngineGame, EnginePlayer } from "../engine.ts";
import { observe, OBSERVATION_SIZE } from "./features.ts";
import { decode, dense, type Layer } from "./policy.ts";

interface LayerJson { in: number; out: number; w: string; b: string; }
export interface WinRateWeightsJson {
  version: 1;
  observationSize: number;
  layers: Record<"layer1" | "layer2" | "layer3" | "out", LayerJson>;
}
export interface WinRateModel { layers: Record<keyof WinRateWeightsJson["layers"], Layer>; }

export function loadWinRate(json: WinRateWeightsJson): WinRateModel {
  if (json.observationSize !== OBSERVATION_SIZE) throw new Error("win-rate model was trained with different features");
  const layers = Object.fromEntries(Object.entries(json.layers).map(([name, layer]) => [name, { in: layer.in, out: layer.out, w: decode(layer.w), b: decode(layer.b) }])) as WinRateModel["layers"];
  return { layers };
}

/** The win chance (0 to 1) for an observation vector. */
export function winProbability(model: WinRateModel, observation: ArrayLike<number>): number {
  const { layers } = model;
  const logit = dense(layers.out, dense(layers.layer3, dense(layers.layer2, dense(layers.layer1, observation))), true)[0]!;
  return 1 / (1 + Math.exp(-logit));
}

/** `viewerId`'s chance to win, from what that player can see; null outside a running game. */
export function estimateWinRate(model: WinRateModel, game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, viewerId: string): number | null {
  if (game.step !== "turn" || players.length !== 2 || !players.some((player) => player.accountId === viewerId)) return null;
  return winProbability(model, observe(game, players, ctx, viewerId));
}
