/**
 * The "hard" computer player: determinized Monte Carlo search. At a decision with several legal actions it tries each one many times. Each
 * try first fills in what it cannot see (the opponent's hand, both decks and all face-down life cards) with a random arrangement of the
 * cards that could be there, then plays the game out with the normal heuristic for both sides. The action that wins most often is played.
 * It never looks at hidden cards: it only uses what that player could know.
 *
 * The options also make the stronger "teacher" used to train the network (rl/expert_data.ts): candidate actions ranked by another scorer
 * (the network), and rollouts cut after a number of moves, the position then valued by an estimate of the win chance (the win-rate network).
 */
import type { UnionArenaAction } from "../protocol.ts";
import { actingPlayerId, applyAction, type EngineContext, type EnginePlayer } from "../engine.ts";
import { chooseHeuristic, scoreAction } from "./heuristic.ts";
import { legalActions } from "./legal.ts";
import { cloneMatch, makeRng, nextRandom, shuffle, type Match, type Rng } from "./match.ts";

export interface SearchOptions {
  /** Time budget per decision in milliseconds. */
  budgetMs?: number;
  /** Most actions considered (the heuristic's best ones). */
  maxActions?: number;
  /** Rollouts per action at most. */
  maxRollouts?: number;
  now?: () => number;
  /** Scores the legal actions to pick the candidates (default: the heuristic). Higher is better. */
  prior?: (match: Match, playerId: string, actions: UnionArenaAction[]) => number[];
  /** Moves per rollout before it stops and `leafValue` judges the position (default: play to the end). */
  rolloutDepth?: number;
  /** Also stop a rollout once this many turns have begun since the decision, so every candidate is judged at the same point of the game. */
  rolloutTurns?: number;
  /** The prior's favourite is kept unless another candidate's value beats it by more than this (default 0: the best value wins). */
  keepMargin?: number;
  /** `playerId`'s win chance (0 to 1) in a rollout's last position, when the rollout stopped before the end. */
  leafValue?: (match: Match, playerId: string) => number;
  /** Moves made in rollouts, for both sides (default: the normal heuristic). */
  rolloutPolicy?: (match: Match, actor: string, rng: Rng) => UnionArenaAction;
}

const ROLLOUT_ACTION_LIMIT = 3000;

/** Replaces everything `viewerId` cannot see with a random arrangement of the cards that could be there. */
export function determinize(match: Match, viewerId: string, rng: Rng): Match {
  const copy = cloneMatch(match);
  for (const player of copy.players) {
    const hidden = (player: EnginePlayer): string[] => [...(player.accountId === viewerId ? [] : player.hand), ...player.library, ...player.life.filter((slot) => !slot.faceUp).map((slot) => slot.cardId)];
    const pool = shuffle(rng, hidden(player));
    let next = 0;
    if (player.accountId !== viewerId) player.hand = player.hand.map(() => pool[next++]!);
    player.library = player.library.map(() => pool[next++]!);
    for (const slot of player.life) if (!slot.faceUp) slot.cardId = pool[next++]!;
  }
  return copy;
}

/** Plays on with the normal heuristic for both sides; `playerId`'s result: 1 win, 0 loss, 0.5 neither (or the leaf estimate when cut off). */
function rollout(match: Match, ctx: EngineContext, rng: Rng, playerId: string, depth: number, options: SearchOptions, lastTurn = Infinity): number {
  const { leafValue, rolloutPolicy } = options;
  let steps = 0;
  while (match.game.step === "turn" && steps < Math.min(depth, ROLLOUT_ACTION_LIMIT) && match.game.turn <= lastTurn) {
    const actor = actingPlayerId(match.game)!;
    applyAction(match.game, match.players, ctx, actor, rolloutPolicy ? rolloutPolicy(match, actor, rng) : chooseHeuristic(match, ctx, actor, "normal", rng)!);
    steps += 1;
  }
  if (match.game.step === "turn" && leafValue) return leafValue(match, playerId);
  return match.game.winnerId === playerId ? 1 : match.game.winnerId === null ? 0.5 : 0;
}

/** The search's choice and how each candidate fared (`value`: mean result of its rollouts), for training data. */
export interface SearchResult { action: UnionArenaAction; candidates: Array<{ action: UnionArenaAction; value: number; tries: number }> }

export function chooseBySearch(match: Match, ctx: EngineContext, playerId: string, options: SearchOptions = {}, seed = Math.floor(Math.random() * 2 ** 31)): UnionArenaAction | null {
  return searchDecision(match, ctx, playerId, options, seed)?.action ?? null;
}

export function searchDecision(match: Match, ctx: EngineContext, playerId: string, options: SearchOptions = {}, seed = Math.floor(Math.random() * 2 ** 31)): SearchResult | null {
  const actions = legalActions(match.game, match.players, ctx, playerId);
  if (!actions.length) return null;
  if (actions.length === 1) return { action: actions[0]!, candidates: [{ action: actions[0]!, value: 0.5, tries: 0 }] };
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const budget = options.budgetMs ?? 400;
  const maxRollouts = options.maxRollouts ?? 200;
  const rng = makeRng(seed);
  // Consider the favourites first (the heuristic's, or the given scorer's); the rest are rarely worth the time.
  const priorScores = options.prior?.(match, playerId, actions);
  const ranked = actions.map((action, index) => ({ action, index, score: priorScores ? priorScores[index]! : scoreAction(match, ctx, playerId, action) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, options.maxActions ?? 10);
  const stats = ranked.map(() => ({ wins: 0, tries: 0 }));
  const lastTurn = options.rolloutTurns !== undefined ? match.game.turn + options.rolloutTurns - 1 : Infinity;
  const start = now();
  let round = 0;
  while (round < maxRollouts && (round < 4 || now() - start < budget)) {
    // Every candidate of a round meets the same hidden cards and the same random events, so their results differ by the action alone.
    const worldSeed = Math.floor(nextRandom(rng) * 2 ** 31);
    const rolloutSeed = Math.floor(nextRandom(rng) * 2 ** 31);
    ranked.forEach((entry, index) => {
      const world = determinize(match, playerId, makeRng(worldSeed));
      applyAction(world.game, world.players, ctx, playerId, entry.action);
      stats[index]!.wins += rollout(world, ctx, makeRng(rolloutSeed), playerId, options.rolloutDepth ?? Infinity, options, lastTurn);
      stats[index]!.tries += 1;
    });
    round += 1;
  }
  const rateOf = (index: number): number => stats[index]!.wins / stats[index]!.tries;
  let best = 0;
  ranked.forEach((_, index) => { if (rateOf(index) > rateOf(best) + 1e-9) best = index; });
  if (rateOf(best) - rateOf(0) <= (options.keepMargin ?? 0)) best = 0;
  return { action: ranked[best]!.action, candidates: ranked.map((entry, index) => ({ action: entry.action, value: stats[index]!.wins / stats[index]!.tries, tries: stats[index]!.tries })) };
}
