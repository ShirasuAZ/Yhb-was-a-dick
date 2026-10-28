/**
 * The referee for agent games (rl/agent.ts serve): one Arknights UNION ARENA game held only in this process's memory and served over HTTP
 * on 127.0.0.1. Agents never get the game itself, only what their own seat may see, so there is nothing on disk for them to peek at (the
 * opponent's hand, the deck order, face-down life cards or the other seat's token).
 *
 * Every request is a POST with a JSON body { seat, token, ... }:
 *   /view {text?}              -> { seat, view, actions, newLog } (or { text } with text: true)
 *   /act  {index, text?}       -> the same, after playing decision `index` (and the computer's moves, or the other seat's forced moves)
 *   /wait {timeout?, text?}    -> the same, once it is this seat's decision or the game is over (or after `timeout` seconds)
 * Against a computer the only seat is "agent"; two-agent games have "p1" and "p2". Each seat has its own secret token.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { agentActions, agentView, advance, applyAgentAction, computerPlayer, type ComputerLevel, type ComputerPlayer } from "../src/shared/ai/agent.ts";
import { actingPlayerId, applyAction, gameStateView, lifeView } from "../src/shared/engine.ts";
import type { UnionArenaRoomState } from "../src/shared/protocol.ts";
import { legalActions } from "../src/shared/ai/legal.ts";
import { dealMatch, makeRng, randomInt, type Match, type Rng } from "../src/shared/ai/match.ts";
import { loadPolicy, type PolicyWeightsJson } from "../src/shared/ai/policy.ts";
import { UNION_ARENA_CATALOG } from "../src/server/catalog.ts";
import { cardContext } from "../src/shared/abilities/registry.ts";
import { deckByName } from "./random_deck.ts";

export type Level = ComputerLevel | "agent";
export const LEVELS: readonly Level[] = ["easy", "normal", "hard", "master", "agent"];

interface Game {
  version: 3;
  level: Level;
  match: Match;
  rng: Rng;
  /** Per seat: how much of the log it has been shown. */
  logSeen: Record<string, number>;
  tokens: Record<string, string>;
}

export interface RefereeOptions {
  level?: Level;
  deck?: string;
  opponentDeck?: string;
  /** "random", or a seat ("agent" / "p1" going first; "opponent" / "p2" going second). */
  first?: string;
  seed?: number;
  host?: string;
  port?: number;
  /** Only for resuming later: the referee alone reads and writes this file (it holds the whole game). Off by default. */
  saveFile?: string;
}

export interface Referee {
  host: string;
  port: number;
  tokens: Record<string, string>;
  seats: string[];
  /** Whose decision comes first (the first mulligan). */
  firstToDecide: string | null;
  /** Local controller only. Never served to a model: includes both hands, but no deck order, life faces or tokens. */
  snapshot(): { state: UnionArenaRoomState; opponentHand: string[] };
  close(): Promise<void>;
}

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx = cardContext((id) => byId.get(id));

function newGame(options: RefereeOptions): Game {
  const level = options.level ?? "hard";
  if (!LEVELS.includes(level)) throw new Error(`level must be one of ${LEVELS.join(", ")}`);
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = makeRng(seed);
  const duel = level === "agent";
  const [one, two] = duel ? ["p1", "p2"] : ["agent", "opponent"];
  const first = options.first ?? "random";
  const firstIndex = first === one || first === "agent" ? 0 : first === two || first === "opponent" ? 1 : (randomInt(rng, 2) as 0 | 1);
  const match = dealMatch([
    { id: one, name: duel ? "玩家 1" : "你", deck: deckByName(options.deck ?? "lungmen", rng) },
    { id: two, name: duel ? "玩家 2" : `电脑（${level}）`, deck: deckByName(options.opponentDeck ?? "rhodes", rng) }
  ], seed, firstIndex);
  const token = (): string => randomBytes(16).toString("hex");
  return { version: 3, level, match, rng, logSeen: {}, tokens: duel ? { p1: token(), p2: token() } : { agent: token() } };
}

function computerFor(game: Game): ComputerPlayer {
  const level = game.level as ComputerLevel;
  const policy = level === "master" ? loadPolicy(JSON.parse(readFileSync(new URL("../src/shared/ai/policy-weights.json", import.meta.url), "utf8")) as PolicyWeightsJson) : null;
  return computerPlayer(level, ctx, { policy, rng: game.rng });
}

/** Two-agent games: plays forced moves (a single legal action) for whoever has to act. */
function advanceForced(match: Match): void {
  for (let moves = 0; moves < 2000 && match.game.step === "turn"; moves += 1) {
    const actor = actingPlayerId(match.game)!;
    const actions = legalActions(match.game, match.players, ctx, actor);
    if (actions.length !== 1) return;
    applyAction(match.game, match.players, ctx, actor, actions[0]!);
  }
}

/** What one seat may see: { seat, view, actions, newLog }, or the same as readable text. */
export function seatReply(game: Game, seat: string, text: boolean): unknown {
  const { match } = game;
  const view = agentView(match.game, match.players, ctx, seat);
  const actions = agentActions(match, ctx, seat).map(({ index, text: description }) => ({ index, text: description }));
  // The engine keeps only the latest entries; logTotal counts every entry ever written.
  const { log } = match.game;
  const total = match.game.logTotal ?? log.length;
  const unseen = total - (game.logSeen[seat] ?? 0);
  const newLog = [...(unseen > log.length ? [`（还有 ${unseen - log.length} 条更早的日志已不保留）`] : []), ...log.slice(log.length - Math.min(unseen, log.length))];
  game.logSeen[seat] = total;
  if (!text) return { seat, view, actions, newLog };
  const line = (cards: typeof view.you.front): string => cards.map((card) => `${card.name}(BP${card.bpNow}${card.rested ? " 休" : ""}${card.under ? ` 叠${card.under}` : ""}${card.keywordsNow.length ? ` ${card.keywordsNow.join("")}` : ""})`).join(" ") || "-";
  const status = view.step === "over" ? `对局结束：${view.winner === seat ? "你赢了" : "你输了"}（${view.endReason}）`
    : view.step === "mulligan" ? "换牌" : `${view.yourTurn ? "你的回合" : "对手的回合"} · ${view.phase}${view.toAct !== seat ? " · 等待对手" : ""}`;
  return { text: [
    `=== [${seat}] 第 ${view.turn} 回合 · ${status}`,
    ...newLog.map((entry) => `  · ${entry}`),
    `对手：生命 ${view.opponent.life} 手牌 ${view.opponent.hand} 牌库 ${view.opponent.deck} AP ${view.opponent.ap}`,
    `  前线：${line(view.opponent.front)}`,
    `  能量线：${line(view.opponent.energyLine)}`,
    `你：生命 ${view.you.life} 牌库 ${view.you.deck} AP ${view.you.ap} 能量 ${Object.entries(view.you.energy).map(([color, amount]) => `${color}${amount}`).join(" ") || "0"}`,
    `  前线：${line(view.you.front)}`,
    `  能量线：${line(view.you.energyLine)}`,
    "手牌：",
    ...view.you.hand.map((card) => `  ${card.index}. ${card.name}[${card.color}${card.type === "character" ? "" : card.type === "event" ? "·事件" : "·场地"} E${card.costNow.energy} AP${card.costNow.ap}${card.bp !== null ? ` BP${card.bp}` : ""}${card.keywords.length ? ` ${card.keywords.join("")}` : ""}${card.trigger ? ` 触发:${card.trigger.split("：")[0]}` : ""}] ${card.text}`),
    ...(view.pending && view.toAct === seat ? [`待决：${String(view.pending.prompt ?? view.pending.kind)}${attackerText(view.pending)}`] : []),
    ...actions.map((entry) => `  [${entry.index}] ${entry.text}`)
  ].join("\n") };
}

/** For a block decision: who is attacking. */
function attackerText(pending: Record<string, unknown>): string {
  const attacker = pending.attacker as { name: string; bpNow: number | null; keywordsNow: string[] } | undefined;
  return attacker ? `（进攻：「${attacker.name}」BP${attacker.bpNow}${attacker.keywordsNow.length ? ` ${attacker.keywordsNow.join("")}` : ""}）` : "";
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 65536) reject(new HttpError(413, "request too large"));
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) as Record<string, unknown> : {}); } catch { reject(new HttpError(400, "body must be JSON")); }
    });
    request.on("error", reject);
  });
}

export async function startReferee(options: RefereeOptions = {}): Promise<Referee> {
  const game: Game = options.saveFile && existsSync(options.saveFile) ? JSON.parse(readFileSync(options.saveFile, "utf8")) as Game : newGame(options);
  const duel = game.level === "agent";
  const computer = duel ? null : computerFor(game);
  if (computer) advance(game.match, ctx, "agent", computer);
  const save = (): void => {
    if (!options.saveFile) return;
    writeFileSync(`${options.saveFile}.tmp`, JSON.stringify(game), { mode: 0o600 });
    renameSync(`${options.saveFile}.tmp`, options.saveFile);
  };
  save();
  const ready = (seat: string): boolean => game.match.game.step === "over" || agentActions(game.match, ctx, seat).length > 0;
  // Waiting /wait requests, answered after every move.
  let waiters: Array<{ seat: string; answer: () => void }> = [];
  const notify = (): void => {
    const still: typeof waiters = [];
    for (const waiter of waiters) (ready(waiter.seat) ? waiter.answer() : still.push(waiter));
    waiters = still;
  };

  const seatOf = (body: Record<string, unknown>): string => {
    const seat = typeof body.seat === "string" ? body.seat : duel ? "" : "agent";
    const expected = game.tokens[seat];
    const given = Buffer.from(typeof body.token === "string" ? body.token : "");
    if (!expected || given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) throw new HttpError(403, `wrong seat or token (seats: ${Object.keys(game.tokens).join(", ")})`);
    return seat;
  };

  const server: Server = createServer((request, response) => {
    const send = (status: number, payload: unknown): void => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(payload));
    };
    void (async () => {
      if (request.method !== "POST") throw new HttpError(405, "use POST");
      const body = await readBody(request);
      const seat = seatOf(body);
      const text = body.text === true;
      if (request.url === "/view") return send(200, seatReply(game, seat, text));
      if (request.url === "/act") {
        const choice = agentActions(game.match, ctx, seat).find((entry) => entry.index === Number(body.index));
        if (!choice) throw new HttpError(409, `no decision ${String(body.index)} for ${seat} now: "view" (or "wait") lists them`);
        applyAgentAction(game.match, ctx, seat, choice);
        if (computer) advance(game.match, ctx, seat, computer);
        else advanceForced(game.match);
        save();
        send(200, seatReply(game, seat, text));
        notify();
        return;
      }
      if (request.url === "/wait") {
        if (ready(seat)) return send(200, seatReply(game, seat, text));
        const timeout = setTimeout(() => {
          waiters = waiters.filter((waiter) => waiter.answer !== answer);
          send(200, seatReply(game, seat, text));
        }, Math.max(0, Number(body.timeout ?? 600)) * 1000);
        const answer = (): void => { clearTimeout(timeout); send(200, seatReply(game, seat, text)); };
        waiters.push({ seat, answer });
        request.on("close", () => { if (!response.writableEnded) { clearTimeout(timeout); waiters = waiters.filter((waiter) => waiter.answer !== answer); } });
        return;
      }
      throw new HttpError(404, "unknown path (/view, /act, /wait)");
    })().catch((error: Error) => send(error instanceof HttpError ? error.status : 500, { error: error.message }));
  });

  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 0, host, resolve); });
  return {
    host,
    port: (server.address() as AddressInfo).port,
    tokens: { ...game.tokens },
    seats: Object.keys(game.tokens),
    firstToDecide: game.match.game.step === "mulligan" ? game.match.game.mulliganQueue[0] ?? null : actingPlayerId(game.match.game),
    snapshot: () => {
      const [one, two] = game.match.players;
      const players = [one, two].map((player, index) => ({ id: player.accountId, username: player.username, avatarUrl: null, seat: index as 0 | 1, connected: true, isHost: index === 0, ready: true }));
      const state: UnionArenaRoomState = {
        roomCode: "模型对战", phase: "playing", players, you: players[0]!,
        life: { you: lifeView(one), opponent: lifeView(two) },
        game: gameStateView(game.match.game, one, two, ctx), hand: [...one.hand],
        playerCount: 2, requiredPlayers: 2, startAllowed: false, spectators: [], youAreSpectator: false
      };
      return structuredClone({ state, opponentHand: [...two.hand] });
    },
    close: () => new Promise((resolve) => { for (const waiter of waiters) waiter.answer(); server.close(() => resolve()); server.closeAllConnections(); })
  };
}
