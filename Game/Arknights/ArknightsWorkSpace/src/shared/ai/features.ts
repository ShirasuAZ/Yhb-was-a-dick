/**
 * Number vectors for reinforcement learning: what one player can see of the game (`observe`), and one vector per legal action
 * (`actionFeatures`). Training (Node env worker) and play (the browser) use this same code, so a trained network sees exactly the same
 * numbers in both places. Nothing a player cannot see is encoded: face-down life cards, the opponent's hand and both decks appear only
 * as counts.
 */
import type { UnionArenaAction, UnionArenaCardStats, UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, energyOf, type EngineContext, type EngineGame, type EnginePlayer } from "../engine.ts";
import { cardIndex } from "./card-index.ts";

const COLORS = ["yellow", "red", "blue", "purple"] as const;
const TYPES = ["character", "site", "event"] as const;
const TRIGGERS = ["抽卡", "获得", "激活", "特殊", "色彩", "最终", "突进"] as const;
const KEYWORDS = ["撤步", "瞄准攻击", "2次攻击", "2次阻挡", "冲击无效", "伤害2"] as const;
const PHASES = ["start", "movement", "main", "attack", "end"] as const;
const PENDING = ["block", "damage", "triggers", "discard", "choose"] as const;
const ACTION_TYPES = ["next_phase", "extra_draw", "move", "play", "raid", "event", "attack", "block", "damage", "trigger", "end_turn", "discard", "choose", "activate"] as const;
const HAND_SLOTS = 10;
const REVEALED_SLOTS = 2;

export const CARD_FEATURES = 1 + TYPES.length + COLORS.length + 4 + KEYWORDS.length + 2 + TRIGGERS.length + 2;
export const FIELD_FEATURES = CARD_FEATURES + 8;
const GLOBAL_FEATURES = PHASES.length + PENDING.length + 2 + 26;
export const OBSERVATION_SIZE = GLOBAL_FEATURES + 4 * 4 * FIELD_FEATURES + HAND_SLOTS * CARD_FEATURES + REVEALED_SLOTS * CARD_FEATURES;
export const ACTION_FEATURES = ACTION_TYPES.length + 6 + CARD_FEATURES + FIELD_FEATURES + 6;

const oneHot = <T>(values: readonly T[], value: T | null | undefined): number[] => values.map((entry) => (entry === value ? 1 : 0));

/** A card's printed data. */
export function cardVector(stats: UnionArenaCardStats | null | undefined): number[] {
  if (!stats) return Array<number>(CARD_FEATURES).fill(0);
  const impact = stats.keywords.some((keyword) => /^冲击\d+$/.test(keyword)) ? 1 : 0;
  return [
    1,
    ...oneHot(TYPES, stats.type),
    ...oneHot(COLORS, stats.color as (typeof COLORS)[number]),
    stats.energyCost / 8, stats.apCost / 3, (stats.bp ?? 0) / 5000, stats.energyGen / 2,
    ...KEYWORDS.map((keyword) => (stats.keywords.includes(keyword) ? 1 : 0)),
    impact, stats.raid ? 1 : 0,
    ...oneHot(TRIGGERS, stats.trigger?.label as (typeof TRIGGERS)[number] | undefined),
    stats.trigger ? 0 : 1,
    stats.energyGenPlus ? 1 : 0
  ];
}

function fieldVector(ctx: EngineContext, card: UnionArenaFieldCard | undefined): number[] {
  if (!card) return Array<number>(FIELD_FEATURES).fill(0);
  return [
    ...cardVector(ctx.card(card.cardId)),
    card.rested ? 1 : 0, bpOf(ctx, card) / 5000, card.bpMod / 5000, card.attacks ? 1 : 0, card.blocks ? 1 : 0,
    card.under.length / 2, card.skipNextActivate ? 1 : 0, card.grants.length / 2
  ];
}

const find = (players: readonly EnginePlayer[], id: string): EnginePlayer => players.find((player) => player.accountId === id)!;
const other = (players: readonly EnginePlayer[], id: string): EnginePlayer => players.find((player) => player.accountId !== id)!;

/** Hand cards in a fixed order (by type, cost and BP), so the same hand always gives the same vector whatever the draw order. */
function sortedHand(ctx: EngineContext, hand: readonly string[]): string[] {
  const key = (cardId: string): string => {
    const stats = ctx.card(cardId);
    return stats ? `${TYPES.indexOf(stats.type)}:${String(stats.energyCost).padStart(2, "0")}:${String(stats.bp ?? 0).padStart(5, "0")}:${cardId}` : `9:${cardId}`;
  };
  return [...hand].sort((a, b) => key(a).localeCompare(key(b)));
}

/** What `viewerId` can see, as OBSERVATION_SIZE numbers. */
export function observe(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, viewerId: string): Float32Array {
  const me = find(players, viewerId);
  const opponent = other(players, viewerId);
  const pending = game.pending;
  const values: number[] = [
    ...oneHot(PHASES, game.phase),
    ...oneHot(PENDING, pending?.kind),
    pending?.playerId === viewerId ? 1 : 0,
    game.turnPlayerId === viewerId ? 1 : 0,
    game.firstPlayerId === viewerId ? 1 : 0,
    Math.min(game.turn, 40) / 40,
    (game.turnsTaken[viewerId] ?? 0) / 20,
    game.extraDrawUsed ? 1 : 0,
    me.life.length / 7, opponent.life.length / 7,
    me.hand.length / 10, opponent.hand.length / 10,
    me.library.length / 50, opponent.library.length / 50,
    me.ap.length / 3, me.ap.filter((card) => !card.rested).length / 3,
    opponent.ap.length / 3, opponent.ap.filter((card) => !card.rested).length / 3,
    ...COLORS.map((color) => energyOf(ctx, me, color) / 8),
    ...COLORS.map((color) => energyOf(ctx, opponent, color) / 8),
    me.sideline.length / 50, opponent.sideline.length / 50, me.removal.length / 20, opponent.removal.length / 20
  ];
  for (const line of [me.front, me.energy, opponent.front, opponent.energy]) for (let slot = 0; slot < 4; slot += 1) values.push(...fieldVector(ctx, line[slot]));
  const hand = sortedHand(ctx, me.hand);
  for (let slot = 0; slot < HAND_SLOTS; slot += 1) values.push(...cardVector(hand[slot] ? ctx.card(hand[slot]!) : null));
  const revealed = pending?.kind === "triggers" ? pending.revealed : [];
  for (let slot = 0; slot < REVEALED_SLOTS; slot += 1) values.push(...cardVector(revealed[slot] ? ctx.card(revealed[slot]!.cardId) : null));
  if (values.length !== OBSERVATION_SIZE) throw new Error(`observation size ${values.length} != ${OBSERVATION_SIZE}`);
  return Float32Array.from(values);
}

interface ActionParts { subject: string | null; target: UnionArenaFieldCard | undefined; flags: number[]; extra: number[] }

/** The card an action uses, the field card it targets, and its flags (shared by the feature vector and the card ids). */
function actionParts(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, actorId: string, action: UnionArenaAction): ActionParts {
  const me = find(players, actorId);
  const opponent = other(players, actorId);
  const fieldOf = (uid: string | null | undefined): UnionArenaFieldCard | undefined => uid ? [...me.front, ...me.energy, ...opponent.front, ...opponent.energy].find((card) => card.uid === uid) : undefined;
  let subject: string | null = null;
  let target: UnionArenaFieldCard | undefined;
  const flags = [0, 0, 0, 0, 0, 0]; // front line, energy line, to the front, activate, removes a card, no block
  const extra = [0, 0, 0, 0, 0, 0]; // moved to front, moved back, BP moved to the front, cards dropped, value dropped, owner of the target is me
  switch (action.type) {
    case "play":
    case "event":
      subject = me.hand[action.handIndex] ?? null;
      if (action.type === "play") { flags[action.line === "front" ? 0 : 1] = 1; if (action.remove) { flags[4] = 1; target = fieldOf(action.remove); } }
      break;
    case "raid":
      subject = me.hand[action.handIndex] ?? null;
      target = fieldOf(action.targetUid);
      flags[2] = action.toFront ? 1 : 0;
      break;
    case "attack":
      subject = fieldOf(action.attackerUid)?.cardId ?? null;
      target = fieldOf(action.targetUid);
      break;
    case "block":
      if (action.blockerUid === null) flags[5] = 1;
      else { const blocker = fieldOf(action.blockerUid); subject = blocker?.cardId ?? null; target = blocker; }
      if (game.pending?.kind === "block") { const attacker = fieldOf(game.pending.attackerUid); if (attacker && !target) target = attacker; }
      break;
    case "trigger": {
      const slot = game.pending?.kind === "triggers" ? game.pending.revealed.find((entry) => entry.id === action.lifeId) : undefined;
      subject = slot?.cardId ?? null;
      flags[3] = action.activate ? 1 : 0;
      target = fieldOf(action.targetUid ?? action.raid?.targetUid);
      if (action.raid) flags[2] = action.raid.toFront ? 1 : 0;
      if (action.sidelineIndex !== undefined) subject = me.sideline[action.sidelineIndex] ?? subject;
      break;
    }
    case "move": {
      extra[0] = action.toFront.length / 4;
      extra[1] = action.toEnergy.length / 4;
      extra[2] = action.toFront.reduce((sum, uid) => sum + (fieldOf(uid) ? bpOf(ctx, fieldOf(uid)!) : 0), 0) / 10000;
      break;
    }
    case "activate": {
      const card = fieldOf(action.uid);
      subject = card?.cardId ?? null;
      target = card;
      break;
    }
    case "choose": {
      // Confirm answers use the "activate" flag; picks are described by the first picked card and how many were picked.
      flags[3] = action.picks[0] === "yes" ? 1 : 0;
      const first = action.picks[0];
      if (first && /^[hs]:\d+$/.test(first)) subject = (first.startsWith("h:") ? me.hand : me.sideline)[Number(first.slice(2))] ?? null;
      else if (first) target = fieldOf(first);
      extra[3] = action.picks.length / 4;
      if (game.pending?.kind === "choose") extra[4] = game.pending.good === false ? -1 : 1;
      break;
    }
    case "discard": {
      const dropped = me.hand.filter((_, index) => !action.keep.includes(index));
      extra[3] = dropped.length / 4;
      extra[4] = dropped.reduce((sum, cardId) => sum + (ctx.card(cardId)?.bp ?? 0), 0) / 10000;
      break;
    }
    default:
      break;
  }
  if (target) extra[5] = [...me.front, ...me.energy].includes(target) ? 1 : -1;
  return { subject, target, flags, extra };
}

/** One vector per action: its type, its options, the card it uses and the card it targets. */
export function actionFeatures(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, actorId: string, action: UnionArenaAction): Float32Array {
  const { subject, target, flags, extra } = actionParts(game, players, ctx, actorId, action);
  const values = [...oneHot(ACTION_TYPES, action.type), ...flags, ...cardVector(subject ? ctx.card(subject) : null), ...fieldVector(ctx, target), ...extra];
  if (values.length !== ACTION_FEATURES) throw new Error(`action feature size ${values.length} != ${ACTION_FEATURES}`);
  return Float32Array.from(values);
}

// ---- Card identities, for the network's card embeddings (v2) ----

/** Card slots of `observeCardIds`, in the order of `observe`'s card vectors: the four lines (4 slots each), the hand, revealed life cards. */
export const OBSERVATION_CARD_SLOTS = 4 * 4 + HAND_SLOTS + REVEALED_SLOTS;
/** Card ids per action: the card it uses, the card it targets, and the card whose ability asks (a choice's or a trigger's source). */
export const ACTION_CARD_SLOTS = 3;

/** The embedding index (card-index.ts) of every card `observe` describes, slot for slot (0 = empty). */
export function observeCardIds(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, viewerId: string): Int32Array {
  const me = find(players, viewerId);
  const opponent = other(players, viewerId);
  const ids: number[] = [];
  for (const line of [me.front, me.energy, opponent.front, opponent.energy]) for (let slot = 0; slot < 4; slot += 1) ids.push(cardIndex(ctx, line[slot]?.cardId));
  const hand = sortedHand(ctx, me.hand);
  for (let slot = 0; slot < HAND_SLOTS; slot += 1) ids.push(cardIndex(ctx, hand[slot]));
  const pending = game.pending;
  const revealed = pending?.kind === "triggers" ? pending.revealed : [];
  for (let slot = 0; slot < REVEALED_SLOTS; slot += 1) ids.push(cardIndex(ctx, revealed[slot]?.cardId));
  return Int32Array.from(ids);
}

/** The embedding indexes of an action's cards: the one it uses, the one it targets, the one whose ability asks. */
export function actionCardIds(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, actorId: string, action: UnionArenaAction): Int32Array {
  const { subject, target } = actionParts(game, players, ctx, actorId, action);
  let used = subject;
  // A pick among the cards being looked at names that card.
  if (!used && action.type === "choose" && /^l:\d+$/.test(action.picks[0] ?? "")) used = game.looking?.cards[Number(action.picks[0]!.slice(2))] ?? null;
  const pending = game.pending;
  const source = pending?.kind === "choose" ? pending.sourceCardId ?? null : pending?.kind === "triggers" && action.type === "trigger" ? subject : null;
  return Int32Array.from([cardIndex(ctx, used), cardIndex(ctx, target?.cardId), cardIndex(ctx, source)]);
}
