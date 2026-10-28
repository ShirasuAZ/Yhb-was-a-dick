/**
 * Plays two computer players against each other and prints the win rate of the first one, alternating seats and decks.
 *   npx tsx rl/evaluate.ts <player> <player> [games] [seed] [presets|random]
 * A player is "easy", "normal", "hard", "policy:<weights.json>" or "teacher:c=4,r=8,t=1,m=0.03" (the search teacher, src/shared/ai/teacher.ts,
 * with the shipped networks). Decks: the four preset decks in turn, or a random legal deck per side and game. Run it from the UNO workspace
 * (the card catalog is found from there). Add --json for a machine-readable line.
 */
import { readFileSync } from "node:fs";
import type { UnionArenaAction } from "../src/shared/protocol.ts";
import { actingPlayerId, applyAction, type EngineContext } from "../src/shared/engine.ts";
import { chooseHeuristic } from "../src/shared/ai/heuristic.ts";
import { createMatch, makeRng, randomInt, wantsMulligan, type Match } from "../src/shared/ai/match.ts";
import { chooseByPolicy, loadPolicy, type PolicyWeightsJson } from "../src/shared/ai/policy.ts";
import { chooseBySearch } from "../src/shared/ai/search.ts";
import { teacherOptions } from "../src/shared/ai/teacher.ts";
import { loadWinRate, type WinRateWeightsJson } from "../src/shared/ai/winrate.ts";
import { PRESET_NUMBER_DECKS, randomTitleDeck } from "./train_decks.ts";
import { titleContext } from "./title-catalog.ts";

const ctx: EngineContext = titleContext;

const json = process.argv.includes("--json");
const [first = "normal", second = "easy", gamesText = "100", seedText = "1", deckMode = "presets"] = process.argv.slice(2).filter((arg) => arg !== "--json");
const games = Number(gamesText);
const rng = makeRng(Number(seedText));

function player(spec: string): (match: Match, id: string) => UnionArenaAction {
  if (spec.startsWith("policy:")) {
    const policy = loadPolicy(JSON.parse(readFileSync(spec.slice(7), "utf8")) as PolicyWeightsJson);
    return (match, id) => chooseByPolicy(policy, match.game, match.players, ctx, id)!;
  }
  if (spec.startsWith("teacher:")) {
    const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
    const settings = Object.fromEntries(spec.slice(8).split(",").map((pair) => pair.split("="))) as Record<string, string>;
    const options = teacherOptions(loadPolicy(read("../src/shared/ai/policy-weights.json") as PolicyWeightsJson), loadWinRate(read("../src/shared/ai/winrate-weights.json") as WinRateWeightsJson), ctx,
      { candidates: Number(settings.c ?? 4), rollouts: Number(settings.r ?? 8), depth: Number(settings.d ?? 1e9), turns: settings.t ? Number(settings.t) : undefined, margin: settings.m ? Number(settings.m) : undefined, rollout: "policy" });
    return (match, id) => chooseBySearch(match, ctx, id, options, randomInt(rng, 2 ** 31))!;
  }
  if (spec === "hard") return (match, id) => chooseBySearch(match, ctx, id, { budgetMs: 1e9, maxRollouts: 24, maxActions: 8 }, randomInt(rng, 2 ** 31))!;
  return (match, id) => chooseHeuristic(match, ctx, id, spec === "easy" ? "easy" : "normal", rng)!;
}

const players = { A: player(first), B: player(second) };
let wins = 0;
const started = Date.now();
for (let game = 0; game < games; game += 1) {
  // Presets: every pairing of the four decks, each with both seats going first.
  const decks = deckMode === "random" ? [randomTitleDeck(rng), randomTitleDeck(rng)] : [PRESET_NUMBER_DECKS[Math.floor(game / 2) % PRESET_NUMBER_DECKS.length]!, PRESET_NUMBER_DECKS[Math.floor(game / 8) % PRESET_NUMBER_DECKS.length]!];
  const match = createMatch([{ id: "A", name: first, deck: decks[0]! }, { id: "B", name: second, deck: decks[1]! }], Number(seedText) * 100003 + game, { first: (game % 2) as 0 | 1, mulligan: (entry) => wantsMulligan(ctx, entry.hand) });
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
if (json) console.log(JSON.stringify({ first, second, wins, games }));
else console.log(`${first} vs ${second}: ${wins}/${games} = ${(rate * 100).toFixed(1)}% (±${(margin * 100).toFixed(1)}%), ${((Date.now() - started) / 1000).toFixed(1)}s`);
