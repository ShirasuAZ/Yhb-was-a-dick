/**
 * Expert-iteration data: games where both seats are the search teacher (src/shared/ai/teacher.ts: the network's favourite moves checked by
 * rollouts and the win-rate network). Every decision with more than one legal action is recorded with what the network would see and the
 * teacher's choice, so rl/train_bc.py can teach the network to play like the teacher.
 *
 * Usage (from Game/UNO/UNO WorkSpace):
 *   npx tsx ../../unionarena/UnionArenaWorkSpace/Arknights/rl/expert_data.ts <seed> <games> <out-prefix> [teacher settings] [random-deck share]
 * Teacher settings as "c=4,r=8,t=1,m=0.03" (candidates, rollouts, turns, keep margin). Writes, one row per decision:
 *   <out-prefix>.obs     float32 OBSERVATION_SIZE           <out-prefix>.obsids  int32 OBSERVATION_CARD_SLOTS
 *   <out-prefix>.feats   float32 ACTION_FEATURES per action <out-prefix>.actids  int32 ACTION_CARD_SLOTS per action
 *   <out-prefix>.jsonl   {count, chosen, prior, values, weight, outcome, game, seat} (values: the teacher's estimate per action, -1 if
 *                        not tried; prior: the network's own favourite; outcome: 1 if this seat won the game, 0 if it lost, 0.5 otherwise)
 * The network already agrees with the teacher most of the time, so only a share (KEEP_AGREEING) of those decisions is kept, with
 * `weight` 1 / KEEP_AGREEING to keep the mix right; every decision where they differ is kept.
 * Files are appended game by game, so a run can be stopped at any time.
 */
import { appendFileSync, readFileSync } from "node:fs";
import type { UnionArenaAction } from "../src/shared/protocol.ts";
import { actingPlayerId, applyAction, type EngineContext } from "../src/shared/engine.ts";
import { legalActions } from "../src/shared/ai/legal.ts";
import { createMatch, makeRng, nextRandom, randomInt, wantsMulligan } from "../src/shared/ai/match.ts";
import { deckCards, PRESET_DECKS } from "../src/shared/ai/decks.ts";
import { actionCardIds, actionFeatures, observe, observeCardIds } from "../src/shared/ai/features.ts";
import { loadPolicy, policyScores, type PolicyWeightsJson } from "../src/shared/ai/policy.ts";
import { searchDecision } from "../src/shared/ai/search.ts";
import { teacherOptions } from "../src/shared/ai/teacher.ts";
import { loadWinRate, type WinRateWeightsJson } from "../src/shared/ai/winrate.ts";
import { UNION_ARENA_CATALOG } from "../src/server/catalog.ts";
import { cardContext } from "../src/shared/abilities/registry.ts";
import { randomDeck } from "./random_deck.ts";

const ACTION_LIMIT = 3000;
/** The training environment's limit on actions per decision (rl/env_worker.ts). */
const MAX_ACTIONS = 96;
const KEEP_AGREEING = 0.3;

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx: EngineContext = cardContext((id) => byId.get(id));
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const policy = loadPolicy((process.env.POLICY ? JSON.parse(readFileSync(process.env.POLICY, "utf8")) : read("../src/shared/ai/policy-weights.json")) as PolicyWeightsJson);
const winRate = loadWinRate(read("../src/shared/ai/winrate-weights.json") as WinRateWeightsJson);

const [seedText = "1", gamesText = "10", prefix = "expert", settingsText = "c=4,r=8,t=1,m=0.03", randomText = "0.5"] = process.argv.slice(2);
const settings = Object.fromEntries(settingsText.split(",").map((pair) => pair.split("="))) as Record<string, string>;
const options = teacherOptions(policy, winRate, ctx, { candidates: Number(settings.c ?? 4), rollouts: Number(settings.r ?? 8), depth: Number(settings.d ?? 1e9), turns: settings.t ? Number(settings.t) : undefined, margin: settings.m ? Number(settings.m) : undefined, rollout: "policy" });
const rng = makeRng(Number(seedText));
const sameAction = (a: UnionArenaAction, b: UnionArenaAction): boolean => JSON.stringify(a) === JSON.stringify(b);
const bytes = (values: Float32Array | Int32Array): Buffer => Buffer.from(values.buffer, values.byteOffset, values.byteLength);

for (let game = 0; game < Number(gamesText); game += 1) {
  const deck = (): string[] => nextRandom(rng) < Number(randomText) ? randomDeck(rng) : deckCards(PRESET_DECKS[randomInt(rng, PRESET_DECKS.length)]!);
  const match = createMatch([{ id: "A", name: "A", deck: deck() }, { id: "B", name: "B", deck: deck() }], randomInt(rng, 2 ** 31), { first: randomInt(rng, 2) as 0 | 1, mulligan: (player) => wantsMulligan(ctx, player.hand) });
  const obs: Buffer[] = [], obsIds: Buffer[] = [], feats: Buffer[] = [], actIds: Buffer[] = [];
  const rows: Array<{ count: number; chosen: number; prior: number; values: number[]; weight: number; seat: string }> = [];
  let steps = 0;
  while (match.game.step === "turn" && steps < ACTION_LIMIT) {
    const actor = actingPlayerId(match.game)!;
    const legal = legalActions(match.game, match.players, ctx, actor);
    const result = searchDecision(match, ctx, actor, options, randomInt(rng, 2 ** 31))!;
    if (legal.length > 1) {
      const actions = legal.slice(0, MAX_ACTIONS);
      const chosen = actions.findIndex((action) => sameAction(action, result.action));
      const scores = policyScores(policy, match.game, match.players, ctx, actor, actions);
      const prior = scores.indexOf(Math.max(...scores));
      if (chosen >= 0 && (chosen !== prior || nextRandom(rng) < KEEP_AGREEING)) {
        const { game: state, players } = match;
        obs.push(bytes(observe(state, players, ctx, actor)));
        obsIds.push(bytes(observeCardIds(state, players, ctx, actor)));
        for (const action of actions) {
          feats.push(bytes(actionFeatures(state, players, ctx, actor, action)));
          actIds.push(bytes(actionCardIds(state, players, ctx, actor, action)));
        }
        const values = actions.map((action) => result.candidates.find((entry) => sameAction(entry.action, action))?.value ?? -1);
        rows.push({ count: actions.length, chosen, prior, values: values.map((value) => Math.round(value * 1000) / 1000), weight: chosen === prior ? 1 / KEEP_AGREEING : 1, seat: actor });
      }
    }
    applyAction(match.game, match.players, ctx, actor, result.action);
    steps += 1;
  }
  const winner = match.game.winnerId;
  appendFileSync(`${prefix}.obs`, Buffer.concat(obs));
  appendFileSync(`${prefix}.obsids`, Buffer.concat(obsIds));
  appendFileSync(`${prefix}.feats`, Buffer.concat(feats));
  appendFileSync(`${prefix}.actids`, Buffer.concat(actIds));
  appendFileSync(`${prefix}.jsonl`, rows.map((row) => JSON.stringify({ ...row, outcome: winner === row.seat ? 1 : winner ? 0 : 0.5, game: Number(seedText) * 100000 + game })).join("\n") + (rows.length ? "\n" : ""));
}
