/**
 * A game API for programs and LLM agents: what one player can see, as plain JSON with card names and texts; the legal actions, each with
 * a one-line description; and computer players that make their moves until the agent has a real decision. rl/agent.ts wraps it as a
 * command line; tests and scripts can use it directly. Nothing here shows the viewer anything the rules hide (the opponent's hand, the
 * decks, face-down life cards).
 */
import type { UnionArenaAction, UnionArenaFieldCard } from "../protocol.ts";
import { actingPlayerId, applyAction, bpOf, costOf, energyOf, flagsOf, hasKeyword, lifeView, pendingView, type EngineContext, type EngineGame, type EnginePlayer } from "../engine.ts";
import { legalActions } from "./legal.ts";
import { chooseHeuristic } from "./heuristic.ts";
import { chooseBySearch, type SearchOptions } from "./search.ts";
import { chooseByPolicy, type Policy } from "./policy.ts";
import { decideMulligan, randomInt, wantsMulligan, type Match, type Rng } from "./match.ts";

export type ComputerLevel = "easy" | "normal" | "hard" | "master";

const COLOR_NAME: Readonly<Record<string, string>> = { yellow: "黄", red: "红", blue: "蓝", purple: "紫", green: "绿" };
const KEYWORDS = ["撤步", "瞄准攻击", "2次攻击", "2次阻挡", "冲击无效", "伤害2"] as const;

export interface CardSummary {
  id: string; number: string; name: string; type: string; color: string; energyCost: number; apCost: number; bp: number | null; energyGen: number;
  affinities: string[]; keywords: string[]; trigger: string | null; raid: string[] | null;
  /** The card's own ability text (keyword reminder lines left out). */
  text: string;
}

export function cardSummary(ctx: EngineContext, cardId: string): CardSummary | null {
  const card = ctx.card(cardId);
  if (!card) return null;
  const text = (card.abilityText ?? "").split("\n").map((line) => line.trim()).filter((line) => line && !/^《[^》]+》（[^）]*）$/.test(line)).join(" ");
  return {
    id: cardId, number: card.number ?? "", name: card.name, type: card.type, color: COLOR_NAME[card.color] ?? card.color, energyCost: card.energyCost, apCost: card.apCost,
    bp: card.bp, energyGen: card.energyGen, affinities: [...card.affinities], keywords: [...card.keywords], trigger: card.trigger ? `${card.trigger.label}：${card.trigger.text}` : null,
    raid: card.raid?.targets ?? null, text
  };
}

export interface FieldCardSummary { uid: string; name: string; number: string; bpNow: number; rested: boolean; under: number; keywordsNow: string[]; marks: string[]; cardId: string; }

function fieldSummary(ctx: EngineContext, card: UnionArenaFieldCard): FieldCardSummary {
  const stats = ctx.card(card.cardId);
  return {
    uid: card.uid, cardId: card.cardId, name: stats?.name ?? card.cardId, number: stats?.number ?? "", bpNow: bpOf(ctx, card), rested: card.rested, under: card.under.length,
    keywordsNow: KEYWORDS.filter((keyword) => hasKeyword(ctx, card, keyword)), marks: flagsOf(card)
  };
}

const find = (players: readonly EnginePlayer[], id: string): EnginePlayer => players.find((player) => player.accountId === id)!;
const other = (players: readonly EnginePlayer[], id: string): EnginePlayer => players.find((player) => player.accountId !== id)!;
const nameOf = (ctx: EngineContext, cardId: string | null | undefined): string => (cardId ? ctx.card(cardId)?.name ?? cardId : "卡牌");

export interface AgentView {
  /** "mulligan", "turn" or "over". */
  step: string;
  turn: number;
  phase: string;
  yourTurn: boolean;
  /** Whose decision it is now (null when the game is over). */
  toAct: string | null;
  winner: string | null;
  endReason: string | null;
  you: {
    id: string; life: number; deck: number; ap: string; energy: Record<string, number>; sideline: string[]; removal: string[];
    front: FieldCardSummary[]; energyLine: FieldCardSummary[];
    hand: Array<CardSummary & { index: number; costNow: { energy: number; ap: number } }>;
  };
  opponent: { id: string; life: number; deck: number; hand: number; ap: string; sideline: string[]; removal: string[]; front: FieldCardSummary[]; energyLine: FieldCardSummary[] };
  /** The decision in progress (a block, damage, trigger, choice…) as the viewer sees it, with card names. */
  pending: Record<string, unknown> | null;
  /** The latest log lines. */
  log: string[];
}

/** Everything `viewerId` can see, with card names (opponent's hand, decks and face-down life cards stay hidden). */
export function agentView(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, viewerId: string): AgentView {
  const me = find(players, viewerId);
  const them = other(players, viewerId);
  const ap = (player: EnginePlayer): string => `${player.ap.filter((card) => !card.rested).length}/${player.ap.length}`;
  const energy: Record<string, number> = {};
  for (const [color, name] of Object.entries(COLOR_NAME)) { const amount = energyOf(ctx, me, color); if (amount) energy[name] = amount; }
  const pending = pendingView(game, viewerId);
  let pendingOut: Record<string, unknown> | null = null;
  if (pending) {
    pendingOut = { ...pending };
    if (pending.kind === "choose") pendingOut.optionNames = pending.options.map((option, index) => pending.labels?.[index] || nameOf(ctx, pending.cards[index]));
    if (pending.kind === "triggers") pendingOut.revealedCards = pending.revealed.map((slot) => (slot.cardId ? cardSummary(ctx, slot.cardId) : null));
    if (pending.kind === "block") { const attacker = [...them.front, ...them.energy].find((card) => card.uid === pending.attackerUid); if (attacker) pendingOut.attacker = fieldSummary(ctx, attacker); }
  }
  return {
    step: game.step, turn: game.turn, phase: game.phase, yourTurn: game.turnPlayerId === viewerId, toAct: game.step === "mulligan" ? game.mulliganQueue[0] ?? null : actingPlayerId(game),
    winner: game.winnerId, endReason: game.endReason,
    you: {
      id: viewerId, life: me.life.length, deck: me.library.length, ap: ap(me), energy, sideline: me.sideline.map((id) => nameOf(ctx, id)), removal: me.removal.map((id) => nameOf(ctx, id)),
      front: me.front.map((card) => fieldSummary(ctx, card)), energyLine: me.energy.map((card) => fieldSummary(ctx, card)),
      hand: me.hand.map((cardId, index) => ({ ...cardSummary(ctx, cardId)!, index, costNow: game.step === "turn" ? costOf(game, players, ctx, viewerId, cardId) : { energy: ctx.card(cardId)?.energyCost ?? 0, ap: ctx.card(cardId)?.apCost ?? 0 } }))
    },
    opponent: {
      id: them.accountId, life: lifeView(them).length, deck: them.library.length, hand: them.hand.length, ap: ap(them), sideline: them.sideline.map((id) => nameOf(ctx, id)), removal: them.removal.map((id) => nameOf(ctx, id)),
      front: them.front.map((card) => fieldSummary(ctx, card)), energyLine: them.energy.map((card) => fieldSummary(ctx, card))
    },
    pending: pendingOut,
    log: game.log.slice(-20)
  };
}

/** A one-line description of an action, for `playerId` (who may see their own hand). */
export function describeAction(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, playerId: string, action: UnionArenaAction): string {
  const me = find(players, playerId);
  const all = players.flatMap((player) => [...player.front, ...player.energy]);
  const field = (uid?: string | null): string => (uid ? nameOf(ctx, all.find((card) => card.uid === uid)?.cardId) : "无");
  const hand = (index: number): string => nameOf(ctx, me.hand[index]);
  const pending = game.pending;
  switch (action.type) {
    case "next_phase": return { start: "进入移动阶段", movement: "不移动，进入主要阶段", main: "进入攻击阶段", attack: "结束攻击阶段", end: "下一阶段" }[game.phase] ?? "进入下一阶段";
    case "end_turn": return "结束回合";
    case "extra_draw": return "支付 1 AP 额外抽 1 张";
    case "move": return `移动：上前线 [${action.toFront.map(field).join("、")}]，回能量线 [${action.toEnergy.map(field).join("、")}]${action.remove.length ? `，移除 [${action.remove.map(field).join("、")}]` : ""}`;
    case "play": return `登场「${hand(action.handIndex)}」到${action.line === "front" ? "前线" : "能量线"}${action.remove ? `（「${field(action.remove)}」置于移除区腾位）` : ""}`;
    case "raid": return `突进「${hand(action.handIndex)}」到「${field(action.targetUid)}」上${action.toFront ? "，并移动至前线" : ""}`;
    case "event": return `使用事件「${hand(action.handIndex)}」`;
    case "attack": return `用「${field(action.attackerUid)}」攻击${action.targetUid ? `「${field(action.targetUid)}」` : "对手"}`;
    case "block": return action.blockerUid ? `用「${field(action.blockerUid)}」阻挡` : "不阻挡";
    case "damage": return `选择对手的 ${action.lifeIds.length} 张生命卡`;
    case "trigger": {
      if (!action.activate) return "不发动触发";
      const extra = action.targetUid ? `，目标「${field(action.targetUid)}」` : action.sidelineIndex !== undefined ? `，从场外登场「${nameOf(ctx, me.sideline[action.sidelineIndex])}」` : action.raid ? `，突进到「${field(action.raid.targetUid)}」` : "";
      return `发动触发${extra}`;
    }
    case "activate": return `发动「${field(action.uid)}」的【启动主要】（第 ${action.ability + 1} 个能力）`;
    case "discard": return `弃掉 ${me.hand.map((_, index) => index).filter((index) => !action.keep.includes(index)).map((index) => `${index}.「${hand(index)}」`).join("、")}`;
    case "choose": {
      const label = (pick: string): string => {
        if (pending?.kind !== "choose") return pick;
        const index = pending.options.indexOf(pick);
        return pending.labels?.[index] || nameOf(ctx, pending.cards[index]);
      };
      if (action.picks.length === 1 && (action.picks[0] === "yes" || action.picks[0] === "no")) return action.picks[0] === "yes" ? "是" : "否";
      return action.picks.length ? `选择：${action.picks.map(label).join(" → ")}` : "不选择";
    }
    case "manual": case "concede": return action.type === "concede" ? "认输" : "手动操作";
    default: return JSON.stringify(action);
  }
}

/** A decision the agent can take: an engine action, or (before the first turn) the mulligan choice. */
export interface AgentAction { index: number; text: string; action?: UnionArenaAction; mulligan?: { redraw: boolean } }

/** The decisions open to `playerId` now: the mulligan choice, or the legal actions (empty when it is not this player's decision). */
export function agentActions(match: Match, ctx: EngineContext, playerId: string): AgentAction[] {
  const { game, players } = match;
  if (game.step === "mulligan") {
    if (game.mulliganQueue[0] !== playerId) return [];
    return [{ index: 0, text: "保留起手牌", mulligan: { redraw: false } }, { index: 1, text: "重抽 7 张（手牌放到牌库底、抽 7 张新牌、洗牌）", mulligan: { redraw: true } }];
  }
  if (game.step !== "turn" || actingPlayerId(game) !== playerId) return [];
  return legalActions(game, players, ctx, playerId).map((action, index) => ({ index, action, text: describeAction(game, players, ctx, playerId, action) }));
}

/** Carries out one of `agentActions`. */
export function applyAgentAction(match: Match, ctx: EngineContext, playerId: string, chosen: AgentAction): void {
  if (chosen.mulligan) decideMulligan(match, playerId, chosen.mulligan.redraw);
  else if (chosen.action) applyAction(match.game, match.players, ctx, playerId, chosen.action);
  else throw new Error("NO_ACTION");
}

/** A computer player: picks one action (or the mulligan) for `playerId`. */
export type ComputerPlayer = (match: Match, playerId: string) => UnionArenaAction;

export interface ComputerOptions { policy?: Policy | null; search?: SearchOptions; rng: Rng }

/** The vs-computer levels: easy / normal heuristics, hard = determinized search, master = the trained network (needs `policy`). */
export function computerPlayer(level: ComputerLevel, ctx: EngineContext, options: ComputerOptions): ComputerPlayer {
  return (match, playerId) => {
    if (level === "master") {
      if (!options.policy) throw new Error("MASTER_NEEDS_POLICY");
      return chooseByPolicy(options.policy, match.game, match.players, ctx, playerId)!;
    }
    if (level === "hard") return chooseBySearch(match, ctx, playerId, options.search ?? { budgetMs: 1e9, maxRollouts: 24, maxActions: 8 }, randomInt(options.rng, 2 ** 31))!;
    return chooseHeuristic(match, ctx, playerId, level, options.rng)!;
  };
}

/**
 * Plays the other player's moves (and its mulligan) and `agentId`'s forced moves (a single legal action) until `agentId` has a real
 * decision or the game is over. Returns how many moves were played.
 */
export function advance(match: Match, ctx: EngineContext, agentId: string, opponent: ComputerPlayer, limit = 2000): number {
  let moves = 0;
  for (; moves < limit; moves += 1) {
    const { game, players } = match;
    if (game.step === "mulligan") {
      const next = game.mulliganQueue[0]!;
      if (next === agentId) return moves;
      decideMulligan(match, next, wantsMulligan(ctx, find(players, next).hand));
      continue;
    }
    if (game.step !== "turn") return moves;
    const actor = actingPlayerId(game)!;
    if (actor !== agentId) { applyAction(game, players, ctx, actor, opponent(match, actor)); continue; }
    const actions = legalActions(game, players, ctx, agentId);
    if (actions.length !== 1) return moves;
    applyAction(game, players, ctx, agentId, actions[0]!);
  }
  return moves;
}
