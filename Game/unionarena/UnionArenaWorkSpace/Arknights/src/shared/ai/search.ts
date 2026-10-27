/**
 * The "hard" computer player: determinized Monte Carlo search. At a decision with several legal actions it tries each one many times. Each
 * try first fills in what it cannot see (the opponent's hand, both decks and all face-down life cards) with a random arrangement of the
 * cards that could be there, then plays the game out with the normal heuristic for both sides. The action that wins most often is played.
 * It never looks at hidden cards: it only uses what that player could know.
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

function rollout(match: Match, ctx: EngineContext, rng: Rng): string | null {
  let steps = 0;
  while (match.game.step === "turn" && steps < ROLLOUT_ACTION_LIMIT) {
    const actor = actingPlayerId(match.game)!;
    applyAction(match.game, match.players, ctx, actor, chooseHeuristic(match, ctx, actor, "normal", rng)!);
    steps += 1;
  }
  return match.game.winnerId;
}

export function chooseBySearch(match: Match, ctx: EngineContext, playerId: string, options: SearchOptions = {}, seed = Math.floor(Math.random() * 2 ** 31)): UnionArenaAction | null {
  const actions = legalActions(match.game, match.players, ctx, playerId);
  if (actions.length <= 1) return actions[0] ?? null;
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const budget = options.budgetMs ?? 400;
  const maxRollouts = options.maxRollouts ?? 200;
  const rng = makeRng(seed);
  // Consider the heuristic's favourites first; the rest are rarely worth the time.
  const ranked = actions.map((action, index) => ({ action, index, score: scoreAction(match, ctx, playerId, action) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, options.maxActions ?? 10);
  const stats = ranked.map(() => ({ wins: 0, tries: 0 }));
  const start = now();
  let round = 0;
  while (round < maxRollouts && (round < 4 || now() - start < budget)) {
    ranked.forEach((entry, index) => {
      const world = determinize(match, playerId, rng);
      applyAction(world.game, world.players, ctx, playerId, entry.action);
      const winner = rollout(world, ctx, makeRng(Math.floor(nextRandom(rng) * 2 ** 31)));
      stats[index]!.tries += 1;
      if (winner === playerId) stats[index]!.wins += 1;
      else if (winner === null) stats[index]!.wins += 0.5;
    });
    round += 1;
  }
  let best = 0;
  ranked.forEach((_, index) => {
    const rate = stats[index]!.wins / stats[index]!.tries;
    const bestRate = stats[best]!.wins / stats[best]!.tries;
    if (rate > bestRate + 1e-9) best = index;
  });
  return ranked[best]!.action;
}
