/**
 * Plays two computer players against each other and prints the win rate of the first one, alternating seats and decks.
 *   npx tsx rl/evaluate.ts <player> <player> [games] [seed]
 * A player is "easy", "normal", "hard" or "policy:<weights.json>". Run it from the UNO workspace (the card catalog is found from there).
 */
import { readFileSync } from "node:fs";
import type { UnionArenaAction } from "../src/shared/protocol.ts";
import { actingPlayerId, applyAction, type EngineContext } from "../src/shared/engine.ts";
import { chooseHeuristic } from "../src/shared/ai/heuristic.ts";
import { createMatch, makeRng, randomInt, wantsMulligan, type Match } from "../src/shared/ai/match.ts";
import { deckCards, PRESET_DECKS } from "../src/shared/ai/decks.ts";
import { chooseByPolicy, loadPolicy, type PolicyWeightsJson } from "../src/shared/ai/policy.ts";
import { chooseBySearch } from "../src/shared/ai/search.ts";
import { UNION_ARENA_CATALOG } from "../src/server/catalog.ts";
import { cardContext } from "../src/shared/abilities/registry.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx: EngineContext = cardContext((id) => byId.get(id));

const [first = "normal", second = "easy", gamesText = "100", seedText = "1"] = process.argv.slice(2);
const games = Number(gamesText);
const rng = makeRng(Number(seedText));

function player(spec: string): (match: Match, id: string) => UnionArenaAction {
  if (spec.startsWith("policy:")) {
    const policy = loadPolicy(JSON.parse(readFileSync(spec.slice(7), "utf8")) as PolicyWeightsJson);
    return (match, id) => chooseByPolicy(policy, match.game, match.players, ctx, id)!;
  }
  if (spec === "hard") return (match, id) => chooseBySearch(match, ctx, id, { budgetMs: 1e9, maxRollouts: 24, maxActions: 8 }, randomInt(rng, 2 ** 31))!;
  return (match, id) => chooseHeuristic(match, ctx, id, spec === "easy" ? "easy" : "normal", rng)!;
}

const players = { A: player(first), B: player(second) };
let wins = 0;
const started = Date.now();
for (let game = 0; game < games; game += 1) {
  const decks = [PRESET_DECKS[game % 2]!, PRESET_DECKS[Math.floor(game / 2) % 2]!];
  const match = createMatch([{ id: "A", name: first, deck: deckCards(decks[0]!) }, { id: "B", name: second, deck: deckCards(decks[1]!) }], Number(seedText) * 100003 + game, { first: (game % 2) as 0 | 1, mulligan: (entry) => wantsMulligan(ctx, entry.hand) });
  let steps = 0;
  while (match.game.step === "turn" && steps < 3000) {
    const actor = actingPlayerId(match.game) as "A" | "B";
    applyAction(match.game, match.players, ctx, actor, players[actor](match, actor));
    steps += 1;
  }
  if (match.game.winnerId === "A") wins += 1;
}
const rate = wins / games;
const margin = 1.96 * Math.sqrt((rate * (1 - rate)) / games);
console.log(`${first} vs ${second}: ${wins}/${games} = ${(rate * 100).toFixed(1)}% (±${(margin * 100).toFixed(1)}%), ${((Date.now() - started) / 1000).toFixed(1)}s`);
