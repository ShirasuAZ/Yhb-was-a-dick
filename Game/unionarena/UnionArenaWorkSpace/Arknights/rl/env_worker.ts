/**
 * Training environment for rl/train.py, one Node process per worker. It runs a batch of games with the real rules engine and talks JSON
 * lines over stdin/stdout. The learner ("L") plays one seat; the other seat ("O") is a computer player (heuristic easy/normal, or a frozen
 * policy snapshot). Decisions with only one legal action, and all opponent moves, are played inside the worker, so Python only sees the
 * learner's real choices.
 *
 * Commands (one JSON object per line):
 *   {"cmd":"init","envs":8,"seed":1,"mix":{"easy":0.5,"normal":0.5,"policy":0},"cards":true,"randomDecks":0.5,"shaping":0}  -> {"ok":true,"obs":...}
 *   {"cmd":"step","actions":[i, ...]}                                              -> batch (see `batch`)
 *   {"cmd":"mix","mix":{...}}  {"cmd":"policy","path":"weights.json"}              -> {"ok":true}
 *   {"cmd":"pool","paths":["a.json", ...]}   (the "policy" opponents: each game picks one of these snapshots)  -> {"ok":true}
 *   {"cmd":"eval","games":200,"path":"weights.json","opponent":"normal","seed":7}   -> {"ok":true,"winRate":0.61,...}
 *     (opponent may also be "policy:<weights.json>": head to head against another network)
 * Arrays go back as base64 Float32: observations (envs x OBSERVATION_SIZE), and the legal actions' features of every env one after another
 * (sum(counts) x ACTION_FEATURES). With "cards", each observation row also carries its OBSERVATION_CARD_SLOTS card ids and each action row
 * its ACTION_CARD_SLOTS card ids, appended as floats (for the version 2 network's card vectors).
 * "randomDecks" is the share of games where each side gets a random legal deck (rl/random_deck.ts) instead of a preset one; "shaping" is the
 * reward per life card of difference (0 = only the result counts).
 * Run it with the site's tsx from the UNO workspace (the card catalog is found from there).
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { UnionArenaAction } from "../src/shared/protocol.ts";
import { actingPlayerId, applyAction, type EngineContext } from "../src/shared/engine.ts";
import { legalActions } from "../src/shared/ai/legal.ts";
import { chooseHeuristic } from "../src/shared/ai/heuristic.ts";
import { createMatch, makeRng, nextRandom, randomInt, wantsMulligan, type Match, type Rng } from "../src/shared/ai/match.ts";
import { ACTION_CARD_SLOTS, actionCardIds, actionFeatures, ACTION_FEATURES, observe, observeCardIds, OBSERVATION_CARD_SLOTS, OBSERVATION_SIZE } from "../src/shared/ai/features.ts";
import { pickDeck, PRESET_NUMBER_DECKS } from "./train_decks.ts";
import { CARD_INDEX_SIZE } from "../src/shared/ai/card-index.ts";
import { titleContext } from "./title-catalog.ts";
import { chooseByPolicy, loadPolicy, type Policy, type PolicyWeightsJson } from "../src/shared/ai/policy.ts";
import { chooseBySearch } from "../src/shared/ai/search.ts";

const MAX_ACTIONS = 96;
const ACTION_LIMIT = 3000;
const LEARNER = "L";
const OPPONENT = "O";

const ctx: EngineContext = titleContext;

type OpponentKind = "easy" | "normal" | "policy" | "hard";
interface Env { match: Match; opponent: OpponentKind; policy: Policy | null; actions: UnionArenaAction[]; steps: number; lifeMine: number; lifeTheirs: number; }

let rng: Rng = makeRng(1);
let envs: Env[] = [];
let mix: Record<OpponentKind, number> = { easy: 0.5, normal: 0.5, policy: 0, hard: 0 };
let opponentPool: Policy[] = [];
let withCards = false;
let randomDecks = 0;
let shaping = 0.05;
const OBS_WIDTH = (): number => OBSERVATION_SIZE + (withCards ? OBSERVATION_CARD_SLOTS : 0);
const ACT_WIDTH = (): number => ACTION_FEATURES + (withCards ? ACTION_CARD_SLOTS : 0);
const loadWeights = (path: string): Policy => loadPolicy(JSON.parse(readFileSync(path, "utf8")) as PolicyWeightsJson);
const results = { wins: 0, losses: 0, draws: 0, truncated: 0 };

function pickOpponent(): OpponentKind {
  const entries = (Object.entries(mix) as Array<[OpponentKind, number]>).filter(([kind, weight]) => weight > 0 && (kind !== "policy" || opponentPool.length > 0));
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = nextRandom(rng) * total;
  for (const [kind, weight] of entries) { roll -= weight; if (roll <= 0) return kind; }
  return entries[0]?.[0] ?? "normal";
}

function newMatch(seed: number): Match {
  const deck = (): string[] => pickDeck(rng, randomDecks);
  return createMatch([{ id: LEARNER, name: "learner", deck: deck() }, { id: OPPONENT, name: "opponent", deck: deck() }], seed, { mulligan: (player) => wantsMulligan(ctx, player.hand) });
}

function opponentMove(env: Env): UnionArenaAction {
  const { match } = env;
  if (env.opponent === "policy" && env.policy) return chooseByPolicy(env.policy, match.game, match.players, ctx, OPPONENT)!;
  if (env.opponent === "hard") return chooseBySearch(match, ctx, OPPONENT, { budgetMs: 50, maxRollouts: 8, maxActions: 6 }, randomInt(rng, 2 ** 31))!;
  return chooseHeuristic(match, ctx, OPPONENT, env.opponent === "easy" ? "easy" : "normal", rng)!;
}

const lifeOf = (match: Match, id: string): number => match.players.find((player) => player.accountId === id)!.life.length;

/** Plays forced moves and the opponent's moves until the learner has a real choice or the game ends. */
function advance(env: Env): void {
  const { match } = env;
  while (match.game.step === "turn" && env.steps < ACTION_LIMIT) {
    const actor = actingPlayerId(match.game)!;
    if (actor === OPPONENT) { applyAction(match.game, match.players, ctx, actor, opponentMove(env)); env.steps += 1; continue; }
    const actions = legalActions(match.game, match.players, ctx, actor);
    if (actions.length === 1) { applyAction(match.game, match.players, ctx, actor, actions[0]!); env.steps += 1; continue; }
    env.actions = actions.slice(0, MAX_ACTIONS);
    if (actions.length > MAX_ACTIONS) results.truncated += 1;
    return;
  }
  env.actions = [];
}

function startEnv(): Env {
  const opponent = pickOpponent();
  const policy = opponent === "policy" ? opponentPool[randomInt(rng, opponentPool.length)]! : null;
  const env: Env = { match: newMatch(randomInt(rng, 2 ** 31)), opponent, policy, actions: [], steps: 0, lifeMine: 7, lifeTheirs: 7 };
  advance(env);
  if (env.match.game.step !== "turn") return startEnv();
  return env;
}

function encode(values: Float32Array): string { return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString("base64"); }

function batch(rewards: number[], dones: number[], outcomes: number[]): string {
  const obsWidth = OBS_WIDTH();
  const actWidth = ACT_WIDTH();
  const observations = new Float32Array(envs.length * obsWidth);
  const counts = envs.map((env) => env.actions.length);
  // Only the real actions are sent, env after env: Python splits them with `counts`.
  const features = new Float32Array(counts.reduce((sum, count) => sum + count, 0) * actWidth);
  let row = 0;
  envs.forEach((env, index) => {
    const { game, players } = env.match;
    observations.set(observe(game, players, ctx, LEARNER), index * obsWidth);
    if (withCards) observations.set(observeCardIds(game, players, ctx, LEARNER), index * obsWidth + OBSERVATION_SIZE);
    for (const action of env.actions) {
      features.set(actionFeatures(game, players, ctx, LEARNER, action), row * actWidth);
      if (withCards) features.set(actionCardIds(game, players, ctx, LEARNER, action), row * actWidth + ACTION_FEATURES);
      row += 1;
    }
  });
  return JSON.stringify({ ok: true, obs: encode(observations), feats: encode(features), counts, rewards, dones, outcomes, opponents: envs.map((env) => env.opponent) });
}

function step(choices: number[]): string {
  const rewards: number[] = [];
  const dones: number[] = [];
  const outcomes: number[] = [];
  envs = envs.map((env, index) => {
    const action = env.actions[Math.min(Math.max(choices[index] ?? 0, 0), env.actions.length - 1)]!;
    applyAction(env.match.game, env.match.players, ctx, LEARNER, action);
    env.steps += 1;
    advance(env);
    const mine = lifeOf(env.match, LEARNER);
    const theirs = lifeOf(env.match, OPPONENT);
    let reward = shaping * ((env.lifeTheirs - theirs) - (env.lifeMine - mine));
    env.lifeMine = mine;
    env.lifeTheirs = theirs;
    if (env.match.game.step === "turn" && env.steps < ACTION_LIMIT) { rewards.push(reward); dones.push(0); outcomes.push(0); return env; }
    const winner = env.match.game.winnerId;
    const outcome = winner === LEARNER ? 1 : winner === OPPONENT ? -1 : 0;
    reward += outcome;
    if (outcome > 0) results.wins += 1; else if (outcome < 0) results.losses += 1; else results.draws += 1;
    rewards.push(reward); dones.push(1); outcomes.push(outcome);
    return startEnv();
  });
  return batch(rewards, dones, outcomes);
}

/** Greedy policy against a computer player, alternating decks and seats. */
function evaluate(games: number, path: string, opponent: string, seed: number): string {
  const policy = loadWeights(path);
  const rival = opponent.startsWith("policy:") ? loadWeights(opponent.slice("policy:".length)) : null;
  const evalRng = makeRng(seed);
  let wins = 0;
  let firstWins = 0;
  let firstGames = 0;
  for (let game = 0; game < games; game += 1) {
    const decks = [PRESET_NUMBER_DECKS[game % PRESET_NUMBER_DECKS.length]!, PRESET_NUMBER_DECKS[Math.floor(game / 2) % PRESET_NUMBER_DECKS.length]!];
    const match = createMatch([{ id: LEARNER, name: "learner", deck: decks[0]! }, { id: OPPONENT, name: "opponent", deck: decks[1]! }], seed * 7919 + game, { first: (game % 2) as 0 | 1, mulligan: (player) => wantsMulligan(ctx, player.hand) });
    let steps = 0;
    while (match.game.step === "turn" && steps < ACTION_LIMIT) {
      const actor = actingPlayerId(match.game)!;
      const action = actor === LEARNER ? chooseByPolicy(policy, match.game, match.players, ctx, actor)!
        : rival ? chooseByPolicy(rival, match.game, match.players, ctx, actor)!
        : opponent === "hard" ? chooseBySearch(match, ctx, actor, { budgetMs: 1e9, maxRollouts: 24, maxActions: 8 }, randomInt(evalRng, 2 ** 31))!
        : chooseHeuristic(match, ctx, actor, opponent === "easy" ? "easy" : "normal", evalRng)!;
      applyAction(match.game, match.players, ctx, actor, action);
      steps += 1;
    }
    if (match.game.winnerId === LEARNER) { wins += 1; if (match.game.firstPlayerId === LEARNER) firstWins += 1; }
    if (match.game.firstPlayerId === LEARNER) firstGames += 1;
  }
  return JSON.stringify({ ok: true, winRate: wins / games, wins, games, firstWinRate: firstWins / Math.max(1, firstGames) });
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let reply: string;
  try {
    const message = JSON.parse(line) as { cmd: string; envs?: number; seed?: number; mix?: Record<OpponentKind, number>; actions?: number[]; path?: string; paths?: string[]; games?: number; opponent?: string; cards?: boolean; randomDecks?: number; shaping?: number };
    switch (message.cmd) {
      case "init":
        rng = makeRng(message.seed ?? 1);
        if (message.mix) mix = { ...mix, ...message.mix };
        withCards = message.cards ?? false;
        randomDecks = message.randomDecks ?? 0;
        shaping = message.shaping ?? 0.05;
        envs = Array.from({ length: message.envs ?? 8 }, () => startEnv());
        reply = batch(envs.map(() => 0), envs.map(() => 0), envs.map(() => 0));
        break;
      case "step":
        reply = step(message.actions ?? []);
        break;
      case "mix":
        mix = { ...mix, ...message.mix };
        reply = JSON.stringify({ ok: true });
        break;
      case "policy":
        opponentPool = [loadWeights(message.path!)];
        reply = JSON.stringify({ ok: true });
        break;
      case "pool":
        opponentPool = (message.paths ?? []).map(loadWeights);
        reply = JSON.stringify({ ok: true });
        break;
      case "stats":
        reply = JSON.stringify({ ok: true, ...results });
        results.wins = 0; results.losses = 0; results.draws = 0; results.truncated = 0;
        break;
      case "eval":
        reply = evaluate(message.games ?? 200, message.path!, message.opponent ?? "normal", message.seed ?? 7);
        break;
      case "sizes":
        reply = JSON.stringify({ ok: true, observation: OBSERVATION_SIZE, action: ACTION_FEATURES, observationCards: OBSERVATION_CARD_SLOTS, actionCards: ACTION_CARD_SLOTS, cardRows: CARD_INDEX_SIZE, maxActions: MAX_ACTIONS });
        break;
      default:
        reply = JSON.stringify({ ok: false, error: `unknown command ${message.cmd}` });
    }
  } catch (error) {
    reply = JSON.stringify({ ok: false, error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) });
  }
  process.stdout.write(`${reply}\n`);
});
