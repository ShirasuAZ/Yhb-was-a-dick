/**
 * A whole game without a server or a page: two decks, a seeded random number generator, and the rule manual's "Preparing to Play".
 * The vs-computer mode, the search-based opponent and reinforcement learning all run games through this.
 */
import type { UnionArenaAction } from "../protocol.ts";
import { applyAction, beginFirstTurn, clearBoard, newEngineGame, type EngineContext, type EngineGame, type EnginePlayer } from "../engine.ts";

const HAND_COUNT = 7;
const LIFE_COUNT = 7;

/** A small, fast, seedable generator (mulberry32). Its whole state is one number, so a game can be copied together with it. */
export interface Rng { state: number; }
export function makeRng(seed: number): Rng { return { state: seed >>> 0 }; }
export function nextRandom(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function randomInt(rng: Rng, below: number): number { return Math.floor(nextRandom(rng) * below); }
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomInt(rng, index + 1);
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

export interface Match {
  game: EngineGame;
  players: [EnginePlayer, EnginePlayer];
  rng: Rng;
}

export interface MatchSeat { id: string; name: string; deck: readonly string[]; apCount?: number; }

/**
 * Preparing to Play, steps 1 to 3: shuffle both decks, pick Player One at random (or `first`), draw seven each. The game then waits for
 * the mulligan decisions, Player One first (`decideMulligan`).
 */
export function dealMatch(seats: [MatchSeat, MatchSeat], seed: number, first?: 0 | 1): Match {
  const rng = makeRng(seed);
  const players = seats.map((seat): EnginePlayer => {
    const player: EnginePlayer = { accountId: seat.id, username: seat.name, hand: [], library: shuffle(rng, seat.deck), life: [], apCount: seat.apCount ?? 3, ap: [], front: [], energy: [], sideline: [], removal: [] };
    clearBoard(player);
    player.hand = player.library.splice(0, HAND_COUNT);
    return player;
  }) as [EnginePlayer, EnginePlayer];
  const firstIndex = first ?? (randomInt(rng, 2) as 0 | 1);
  const order = [players[firstIndex]!, players[1 - firstIndex]!];
  return { game: newEngineGame(order[0]!.accountId, order.map((player) => player!.accountId)), players, rng };
}

/**
 * One mulligan decision (the player whose turn it is to decide). A redraw puts the hand at the bottom, draws seven and reshuffles. After
 * both decisions: seven face-down life cards each, and Player One's first turn begins.
 */
export function decideMulligan(match: Match, playerId: string, redraw: boolean): void {
  if (match.game.step !== "mulligan" || match.game.mulliganQueue[0] !== playerId) throw new Error("NOT_YOUR_MULLIGAN");
  const player = match.players.find((entry) => entry.accountId === playerId)!;
  if (redraw) {
    player.library.push(...player.hand);
    player.hand = player.library.splice(0, HAND_COUNT);
    player.library = shuffle(match.rng, player.library);
  }
  match.game.mulliganQueue.shift();
  if (match.game.mulliganQueue.length) return;
  for (const entry of match.players) entry.life = entry.library.splice(0, LIFE_COUNT).map((cardId, index) => ({ id: `${entry.accountId}:life:${index}`, cardId, faceUp: false }));
  beginFirstTurn(match.game, match.players);
}

/** A whole opening in one go: deal, both mulligan decisions by `mulligan`, life areas, first turn. */
export function createMatch(seats: [MatchSeat, MatchSeat], seed: number, options: { first?: 0 | 1; mulligan?: (player: EnginePlayer, match: Match) => boolean } = {}): Match {
  const match = dealMatch(seats, seed, options.first);
  while (match.game.step === "mulligan") {
    const playerId = match.game.mulliganQueue[0]!;
    const player = match.players.find((entry) => entry.accountId === playerId)!;
    decideMulligan(match, playerId, options.mulligan?.(player, match) ?? false);
  }
  return match;
}

/** A deep copy, so a search can try moves without touching the real game. */
export function cloneMatch(match: Match): Match {
  return { game: structuredClone(match.game), players: structuredClone(match.players), rng: { ...match.rng } };
}

export function act(match: Match, ctx: EngineContext, playerId: string, action: UnionArenaAction): void {
  applyAction(match.game, match.players, ctx, playerId, action);
}

/** The keep-or-redraw choice the computer players make: redraw a hand with no card it could play on its first turns. */
export function wantsMulligan(ctx: EngineContext, hand: readonly string[]): boolean {
  return !hand.some((cardId) => (ctx.card(cardId)?.energyCost ?? 9) === 0 && ctx.card(cardId)?.type === "character");
}
