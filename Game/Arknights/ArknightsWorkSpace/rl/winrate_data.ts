/**
 * Training data for the win-rate network (rl/train_winrate.py): whole games between computer players, with what each player could see at
 * its decision points and whether that player went on to win.
 *
 * Players vs Players can use any deck, so most games use random decks built from the fully automated cards (one or two colours, at most
 * four copies per number and four of each 特殊 / 色彩 / 最终 trigger); the rest use the preset decks. Players are a mix of the easy and
 * normal heuristics and the shipped reinforcement-learning policy, so the network sees both strong and weak play.
 *
 * Usage (from Game/UNO/UNO WorkSpace): npx tsx ../../Arknights/ArknightsWorkSpace/rl/winrate_data.ts <seed> <games> <out-prefix>
 * Writes <out-prefix>.obs (float32, rows of OBSERVATION_SIZE), <out-prefix>.win (uint8) and <out-prefix>.game (int32 game index).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { actingPlayerId, applyAction, type EngineContext } from "../src/shared/engine.ts";
import { chooseHeuristic } from "../src/shared/ai/heuristic.ts";
import { createMatch, makeRng, nextRandom, randomInt, wantsMulligan, type Match, type Rng } from "../src/shared/ai/match.ts";
import { deckCards, PRESET_DECKS } from "../src/shared/ai/decks.ts";
import { observe, OBSERVATION_SIZE } from "../src/shared/ai/features.ts";
import { chooseByPolicy, loadPolicy, type Policy, type PolicyWeightsJson } from "../src/shared/ai/policy.ts";
import { UNION_ARENA_CATALOG } from "../src/server/catalog.ts";
import { cardContext } from "../src/shared/abilities/registry.ts";
import { randomDeck } from "./random_deck.ts";

const ACTION_LIMIT = 3000;
/** Share of decision points kept (neighbouring positions of one game are nearly the same). */
const KEEP = 0.2;

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx: EngineContext = cardContext((id) => byId.get(id));
const policy: Policy = loadPolicy(JSON.parse(readFileSync(new URL("../src/shared/ai/policy-weights.json", import.meta.url), "utf8")) as PolicyWeightsJson);

type Player = "easy" | "normal" | "policy";
function pickPlayer(rng: Rng): Player {
  const roll = nextRandom(rng);
  return roll < 0.2 ? "easy" : roll < 0.55 ? "normal" : "policy";
}

function choose(match: Match, player: Player, actor: string, rng: Rng) {
  if (player === "policy") return chooseByPolicy(policy, match.game, match.players, ctx, actor)!;
  return chooseHeuristic(match, ctx, actor, player, rng)!;
}

const [seedText, gamesText, out] = process.argv.slice(2);
if (!seedText || !gamesText || !out) throw new Error("usage: winrate_data.ts <seed> <games> <out-prefix>");
const seed = Number(seedText);
const rng = makeRng(seed);
const observations: Float32Array[] = [];
const wins: number[] = [];
const gameIndexes: number[] = [];
let finished = 0;
for (let game = 0; game < Number(gamesText); game += 1) {
  const decks = nextRandom(rng) < 0.75 ? [randomDeck(rng), randomDeck(rng)] : [0, 1].map(() => deckCards(PRESET_DECKS[randomInt(rng, PRESET_DECKS.length)]!));
  const players: Record<string, Player> = { A: pickPlayer(rng), B: pickPlayer(rng) };
  const match = createMatch([{ id: "A", name: "A", deck: decks[0]! }, { id: "B", name: "B", deck: decks[1]! }], seed * 100003 + game, { first: (game % 2) as 0 | 1, mulligan: (player) => wantsMulligan(ctx, player.hand) });
  const seen: Array<{ viewer: string; observation: Float32Array }> = [];
  let steps = 0;
  while (match.game.step === "turn" && steps < ACTION_LIMIT) {
    const actor = actingPlayerId(match.game)!;
    if (nextRandom(rng) < KEEP) seen.push({ viewer: actor, observation: observe(match.game, match.players, ctx, actor) });
    applyAction(match.game, match.players, ctx, actor, choose(match, players[actor]!, actor, rng));
    steps += 1;
  }
  const winner = match.game.winnerId;
  if (!winner) continue;
  finished += 1;
  for (const entry of seen) {
    observations.push(entry.observation);
    wins.push(entry.viewer === winner ? 1 : 0);
    gameIndexes.push(seed * 1_000_000 + game);
  }
}

const flat = new Float32Array(observations.length * OBSERVATION_SIZE);
observations.forEach((observation, index) => flat.set(observation, index * OBSERVATION_SIZE));
writeFileSync(`${out}.obs`, Buffer.from(flat.buffer));
writeFileSync(`${out}.win`, Buffer.from(Uint8Array.from(wins)));
writeFileSync(`${out}.game`, Buffer.from(Int32Array.from(gameIndexes).buffer));
process.stdout.write(`${JSON.stringify({ games: finished, samples: wins.length })}\n`);
