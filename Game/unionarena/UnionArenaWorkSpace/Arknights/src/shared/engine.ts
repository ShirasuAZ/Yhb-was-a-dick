/**
 * The rules engine for a running game, from the first turn to the end, following the official rule manual (Ver 1.1): turn phases, AP,
 * required energy, playing characters / sites / events, Raid, movement, attacks, blocks, battles, damage, trigger checks, the end phase and
 * both ways to win. It has no Node or browser dependencies, so the server runs it for online games and the client runs it for the tutorial
 * and the vs-computer mode.
 *
 * What the engine automates: everything the rule manual defines, the keyword abilities a card always has (printed at the start of an ability
 * line), the seven printed trigger types, and the own abilities of every card that has an entry in abilities/cards.ts (When Played, When
 * Sidelined, When Attacking / Blocking, Activate: Main, continuous effects, cost changes...). A card without an entry has its ability text
 * applied by the players with the manual operations, and every manual operation is written to the public log.
 *
 * Card abilities run through one loop (`drain`): abilities that activate are queued; the turn player's resolve first, and a player with
 * several chooses their order; an ability's steps may stop to ask for a choice (`pending.kind === "choose"`); once the queue is empty the
 * game carries on with what was interrupted (`after`: e.g. "the attack was declared, now ask for a block").
 *
 * All functions mutate the game and player objects they are given and throw an `Error` whose message is an error code on an illegal move.
 */
import type {
  UnionArenaAction,
  UnionArenaApCard,
  UnionArenaBoard,
  UnionArenaCardStats,
  UnionArenaChoice,
  UnionArenaFieldCard,
  UnionArenaGameState,
  UnionArenaGameStep,
  UnionArenaLifeCard,
  UnionArenaManualOp,
  UnionArenaPending,
  UnionArenaTurnPhase
} from "./protocol.ts";
import type { Ability, AbilityEnv, AbilityEvent, ActivatedAbility, Condition, ReplaceSidelineAbility, ReplaceTriggerAbility, SidelineCause, Step, Target, TriggeredAbility } from "./abilities/types.ts";

/** Cards per line (front line, energy line). */
export const LINE_LIMIT = 4;
/** Hand size kept at the end of the turn. */
export const HAND_LIMIT = 8;
const LOG_LIMIT = 40;
/** How many structured events are kept for the floating on-card notifications. */
const EVENT_LIMIT = 24;

/**
 * One public event, kept alongside its text so the client can float it over the card it happened to.
 * `uid` is a field card uid when the event belongs to a card on the board; events without one (draws,
 * phase changes, battle results) are only shown in the log list.
 */
export interface EngineEvent { seq: number; text: string; uid?: string; kind: string; }
/** Keyword abilities that can be given to a character with the manual "grant" operation, as printed on the cards. */
export const GRANTABLE_KEYWORDS = ["冲击1", "冲击+1", "伤害2", "伤害+1", "瞄准攻击", "2次攻击", "2次阻挡", "冲击无效", "撤步"] as const;

/** A life card as the engine keeps it: the identity is only shown to clients once it is face up. */
export interface LifeSlot { id: string; cardId: string; faceUp: boolean; }

export interface EnginePlayer {
  accountId: string;
  username: string;
  hand: string[];
  /** Top card first. */
  library: string[];
  life: LifeSlot[];
  /** AP cards in the deck (3 for a legal deck); the AP area never holds more. */
  apCount: number;
  ap: UnionArenaApCard[];
  front: UnionArenaFieldCard[];
  energy: UnionArenaFieldCard[];
  sideline: string[];
  removal: string[];
}

export type EnginePending =
  | { kind: "block"; playerId: string; attackerUid: string }
  | { kind: "damage"; playerId: string; defenderId: string; amount: number; attackerUid: string }
  | { kind: "triggers"; playerId: string; attackerId: string; revealed: LifeSlot[]; /** The damage came from a character with the "noActiveTrigger" mark: the 激活 trigger cannot be activated. */ activeBlocked?: boolean }
  | { kind: "discard"; playerId: string }
  | UnionArenaChoice;

/** A card ability that has activated and waits to resolve. `selfUid` is its card on the field (null once the card has left it). */
export interface QueuedAbility {
  id: number;
  ownerId: string;
  cardId: string;
  ability: number;
  selfUid: string | null;
  /** The card the ability is printed on, when it was given to `cardId` (grantAbility). */
  abilityCardId?: string;
  /** For 【退场时】: why the card was sidelined. */
  cause?: SidelineCause | null;
}

/** The ability being resolved: which one, how far its steps have got, and what has been chosen so far. */
export interface ResolvingAbility { entry: QueuedAbility; pc: number; vars: Record<string, string[]>; }

/** What the game does once every queued ability has resolved. The latest one added runs first. */
export type Continuation =
  | { kind: "afterAttackDeclared"; attackerOwnerId: string; attackerUid: string; targetUid: string | null }
  | { kind: "battle"; attackerOwnerId: string; attackerUid: string; defenderOwnerId: string; defenderUid: string; blocked?: boolean }
  | { kind: "afterBattle"; attackerOwnerId: string; attackerUid: string; defenderOwnerId: string; won: boolean; impact: number }
  | { kind: "unblocked"; attackerOwnerId: string; attackerUid: string }
  | { kind: "damage"; attackerOwnerId: string; attackerUid: string; amount: number | null; asked?: boolean }
  | { kind: "attackEnd"; attackerOwnerId: string; attackerUid: string }
  | { kind: "eventDone"; ownerId: string; cardId: string }
  | { kind: "resumeTriggers"; pending: Extract<EnginePending, { kind: "triggers" }> }
  | { kind: "endSteps" }
  | { kind: "endTurnNow" }
  | { kind: "attackPhaseStart" }
  | { kind: "beginEndPhase" };

export interface EngineGame {
  step: UnionArenaGameStep;
  firstPlayerId: string;
  turnPlayerId: string | null;
  /** Turns played so far by both players together; the first turn is 1. */
  turn: number;
  /** Accounts that still have to decide on the mulligan, in order (Player One first). */
  mulliganQueue: string[];
  phase: UnionArenaTurnPhase;
  /** Turns each player has started, for the AP table. */
  turnsTaken: Record<string, number>;
  extraDrawUsed: boolean;
  pending: EnginePending | null;
  winnerId: string | null;
  endReason: string | null;
  log: string[];
  /** Entries ever written to `log`, which itself keeps only the latest LOG_LIMIT (so a reader can tell what it has not seen yet). */
  logTotal?: number;
  /** The same events as `log`, with the card each one belongs to (newest last). */
  events: EngineEvent[];
  /** Counter for event sequence numbers (kept apart from `seq`, which numbers field cards). */
  eventSeq: number;
  /** Counter for field card ids and queued abilities. */
  seq: number;
  /** Card abilities waiting to resolve, in the order they activated. */
  queue: QueuedAbility[];
  resolving: ResolvingAbility | null;
  after: Continuation[];
  /** Cards an ability is looking at (确认卡组最上方……), out of the deck until put somewhere. */
  looking?: { ownerId: string; cards: string[] } | null;
  /** A replacement effect's limit on the damage about to be dealt (改为受到1点伤害). */
  damageCap?: number | null;
  /** Characters about to be sidelined while a replacement effect ("可以改为……") may apply: asked about in order, offer by offer. */
  replacing?: Array<{ ownerId: string; uid: string; cause: SidelineCause; declined: string[]; asking: string | null; /** Waiting on a replacement of being returned to the hand (a `replaces: "toHand"` ability), not of sidelining. */ toHand?: boolean }>;
  /** How many copies of each card with a "当此卡牌置于场外时" ability are in each player's sideline (to notice new arrivals). */
  sidelineSeen?: Record<string, Record<string, number>>;
  /** Owners of front-line characters sidelined since `drain` last looked (for "对方前线中的角色退场时" abilities, event onOpponentFrontSidelined). */
  frontSidelinedOwners?: string[];
  /** Marks card abilities leave for the rest of a turn, as "<turn>:<text>" (e.g. a name's 1回合只能发动1次 effect has been used). */
  turnMarks?: string[];
  /** The character the last attacker beat in a battle: its BP then (the loser is sidelined before the winner's abilities run; AOT Hange Zoë "against a character with 5000 or more BP"). */
  lastBattleWon?: { attackerUid: string; foeBp: number } | null;
  /**
   * "本回合中，下一张将要从手牌使用的…": a change to the next card of this name and colour its owner plays from the hand this turn
   * (AP cost reduced, put onto the field active). Spent by that play; only the entries of the current `turn` count.
   */
  nextPlay?: Array<{ turn: number; ownerId: string; name: string; color: string; ap: number; active: boolean; spent: boolean }>;
  /** "本回合中，下一张将要从手牌中使用的BP不高于N的角色卡牌的消费AP-1": like `nextPlay`, for the next character with printed BP `maxBp` or less. */
  nextPlayLowBp?: Array<{ turn: number; ownerId: string; maxBp: number; ap: number; spent: boolean }>;
  /** "本回合中，下一张将要从手牌中使用的〈name〉以外的卡牌的消费AP-N" (any card type, played, Raided or used as an event): spent by that use. */
  nextUseExcept?: Array<{ turn: number; ownerId: string; exceptName: string; ap: number; spent: boolean }>;
  /** "本回合中，下一张将要从手牌中使用的 [affinity] 卡牌的消费AP-N" (AOT Nicolo 062: [Food]; any card type, played, Raided or used as an event): spent by that use. */
  nextUseAffinity?: Array<{ turn: number; ownerId: string; affinity: string; ap: number; spent: boolean }>;
  /** "本回合中，下一张将要从手牌中使用的所需能量不高于N的X色角色卡牌的消费AP-1" (EVA 式波 013): spent by that play. */
  nextPlayCheap?: Array<{ turn: number; ownerId: string; maxEnergy: number; color: string; ap: number; spent: boolean }>;
  /**
   * "本回合中，下一张将要从手牌中使用的〈碇 真嗣〉或卡牌名包含“初号机”的角色卡牌的所需能量减少[红×1]，消费AP-1" (EVA 零号机 080): the next character from the hand
   * (played or Raided) whose name is one of `names` or contains one of `nameParts`; its required energy drops by `energy` if it is of `color`, its AP cost by `ap`.
   */
  nextUseNamed?: Array<{ turn: number; ownerId: string; names: string[]; nameParts: string[]; color: string; energy: number; ap: number; spent: boolean }>;
  /** Characters that came onto a field this turn (played, Raided or put by an effect), for "本回合中我方的场上登场了……" conditions. Only the current `turn` counts. */
  entered?: Array<{ turn: number; ownerId: string; cardId: string; /** The field card it became (for "只有在此角色登场的回合中"). */ uid?: string }>;
  /** A revealed life card's trigger waiting on its owner's answer to a trigger-replacing offer (see ReplaceTriggerAbility). */
  triggerSwap?: { ownerId: string; attackerId: string; lifeId: string; action: Extract<UnionArenaAction, { type: "trigger" }>; revealed: LifeSlot[]; declined: string[]; asking: string | null };
}

/** The not yet spent entry of `game.nextPlayCheap` that applies to this card. */
export function nextPlayCheapFor(game: EngineGame, ctx: EngineContext, ownerId: string, cardId: string): NonNullable<EngineGame["nextPlayCheap"]>[number] | undefined {
  const stats = ctx.card(cardId);
  if (stats?.type !== "character") return undefined;
  return (game.nextPlayCheap ?? []).find((entry) => !entry.spent && entry.turn === game.turn && entry.ownerId === ownerId && stats.energyCost <= entry.maxEnergy && stats.color === entry.color);
}

/** The not yet spent entry of `game.nextUseExcept` that applies to this card (the first card used that is not of the excepted name). */
export function nextUseExceptFor(game: EngineGame, ctx: EngineContext, ownerId: string, cardId: string): NonNullable<EngineGame["nextUseExcept"]>[number] | undefined {
  const name = ctx.card(cardId)?.name;
  return (game.nextUseExcept ?? []).find((entry) => !entry.spent && entry.turn === game.turn && entry.ownerId === ownerId && entry.exceptName !== name);
}

/** The not yet spent entry of `game.nextUseAffinity` that applies to this card (the first card used that has the affinity; the data joins affinities with "／"). */
export function nextUseAffinityFor(game: EngineGame, ctx: EngineContext, ownerId: string, cardId: string): NonNullable<EngineGame["nextUseAffinity"]>[number] | undefined {
  const parts = (ctx.card(cardId)?.affinities ?? []).flatMap((entry) => entry.split("／").map((part) => part.trim()));
  return (game.nextUseAffinity ?? []).find((entry) => !entry.spent && entry.turn === game.turn && entry.ownerId === ownerId && parts.includes(entry.affinity));
}

/** The not yet spent entry of `game.nextUseNamed` that applies to this card (a character whose name matches). */
export function nextUseNamedFor(game: EngineGame, ctx: EngineContext, ownerId: string, cardId: string): NonNullable<EngineGame["nextUseNamed"]>[number] | undefined {
  const stats = ctx.card(cardId);
  if (stats?.type !== "character") return undefined;
  return (game.nextUseNamed ?? []).find((entry) => !entry.spent && entry.turn === game.turn && entry.ownerId === ownerId && (entry.names.includes(stats.name) || entry.nameParts.some((part) => stats.name.includes(part))));
}

/** The card is being used from the hand: spends the `nextUseExcept` entry (and the `nextUseAffinity` entry) that applied to it. */
function spendNextUseExcept(game: EngineGame, ctx: EngineContext, ownerId: string, cardId: string): void {
  const named = nextUseNamedFor(game, ctx, ownerId, cardId);
  if (named) named.spent = true;
  const entry = nextUseExceptFor(game, ctx, ownerId, cardId);
  if (entry) entry.spent = true;
  const byAffinity = nextUseAffinityFor(game, ctx, ownerId, cardId);
  if (byAffinity) byAffinity.spent = true;
}

/** 本回合中，下一张将要从手牌中使用的BP不高于N的角色卡牌的消费AP-1: the not yet spent entry of `game.nextPlayLowBp` that applies to this card. */
export function nextPlayLowBpFor(game: EngineGame, ctx: EngineContext, ownerId: string, cardId: string): NonNullable<EngineGame["nextPlayLowBp"]>[number] | undefined {
  const stats = ctx.card(cardId);
  if (stats?.type !== "character" || stats.bp === null) return undefined;
  return (game.nextPlayLowBp ?? []).find((entry) => !entry.spent && entry.turn === game.turn && entry.ownerId === ownerId && stats.bp! <= entry.maxBp);
}

/** The unspent "next card played from the hand" change that applies to `cardId` for `ownerId` this turn, if any. */
export function nextPlayFor(game: EngineGame, ctx: EngineContext, ownerId: string, cardId: string): NonNullable<EngineGame["nextPlay"]>[number] | undefined {
  const stats = ctx.card(cardId);
  return (game.nextPlay ?? []).find((entry) => !entry.spent && entry.turn === game.turn && entry.ownerId === ownerId && entry.name === stats?.name && entry.color === stats?.color);
}

/** The two lines of a player's field; a client's board view has the same shape. */
type FieldLines = Pick<EnginePlayer, "front" | "energy">;

export interface EngineCard extends UnionArenaCardStats {
  name: string;
  number?: string;
  /** The card's own abilities the engine runs (abilities/cards.ts); absent when its text is applied by hand. */
  abilities?: readonly Ability[];
}

export interface EngineContext {
  /** Printed data, name and abilities of a card, or null when unknown. */
  card(cardId: string): EngineCard | null;
}

export function newEngineGame(firstPlayerId: string, mulliganQueue: string[]): EngineGame {
  return { step: "mulligan", firstPlayerId, turnPlayerId: null, turn: 0, mulliganQueue, phase: "start", turnsTaken: {}, extraDrawUsed: false, pending: null, winnerId: null, endReason: null, log: [], events: [], eventSeq: 0, seq: 0, queue: [], resolving: null, after: [], looking: null, damageCap: null };
}

/** Empties every zone the game proper uses (not hand, library, life). */
export function clearBoard(player: EnginePlayer): void {
  player.ap = [];
  player.front = [];
  player.energy = [];
  player.sideline = [];
  player.removal = [];
}

const LINE_NAME = { front: "前线", energy: "能量线" } as const;
const PHASE_NAME: Readonly<Record<UnionArenaTurnPhase, string>> = { start: "起始阶段", movement: "移动阶段", main: "主要阶段", attack: "攻击阶段", end: "结束阶段" };

function fail(code: string): never { throw new Error(code); }

function log(game: EngineGame, text: string): void {
  logEvent(game, text, undefined, "text");
}

/**
 * Records an event and, when it belongs to a board card, remembers which one so the client can float
 * the text over that card. `kind` is a short machine label the client uses to keep messages short.
 */
function logEvent(game: EngineGame, text: string, uid: string | undefined, kind: string): void {
  game.logTotal = (game.logTotal ?? game.log.length) + 1;
  game.log.push(text);
  if (game.log.length > LOG_LIMIT) game.log.splice(0, game.log.length - LOG_LIMIT);
  game.events.push({ seq: game.eventSeq++, text, uid, kind });
  if (game.events.length > EVENT_LIMIT) game.events.splice(0, game.events.length - EVENT_LIMIT);
}

function find(players: readonly EnginePlayer[], id: string): EnginePlayer {
  return players.find((player) => player.accountId === id) ?? fail("NOT_IN_GAME");
}

function other(players: readonly EnginePlayer[], id: string): EnginePlayer {
  return players.find((player) => player.accountId !== id) ?? fail("NOT_IN_GAME");
}

function nameOf(ctx: EngineContext, cardId: string): string {
  return ctx.card(cardId)?.name ?? "未知卡牌";
}

function statsOf(ctx: EngineContext, cardId: string): EngineCard {
  return ctx.card(cardId) ?? fail("CARD_DATA_MISSING");
}

/** The card's own abilities the engine runs, if any. */
export function abilitiesOf(ctx: EngineContext, cardId: string): readonly Ability[] {
  return ctx.card(cardId)?.abilities ?? [];
}

/** The ability a queued entry runs (on its own card, or the card that gave it). */
function abilityOfEntry(ctx: EngineContext, entry: QueuedAbility): Ability | undefined {
  return abilitiesOf(ctx, entry.abilityCardId ?? entry.cardId)[entry.ability];
}

/** Rule-changing marks the field card has now (see UnionArenaFieldCard.flags). */
export function flagsOf(card: UnionArenaFieldCard): string[] {
  return [...(card.flags ?? []), ...(card.staticFlags ?? []), ...(card.lasting ?? []).flatMap((entry) => (entry.flag ? [entry.flag] : []))];
}

/** Whether `blocker` may block `attacker` (an attacker can be unblockable by characters with low BP). */
export function canBlock(ctx: EngineContext, attacker: UnionArenaFieldCard, blocker: UnionArenaFieldCard): boolean {
  if (blocker.rested || ctx.card(blocker.cardId)?.type !== "character") return false;
  // 无法阻挡拥有《冲击》的角色 ("cannotBlockImpact", AOT Eren Jaeger (Doomsday Titan))
  if (flagsOf(blocker).includes("cannotBlockImpact") && impactOf(ctx, attacker) > 0) return false;
  return flagsOf(attacker).every((flag) => {
    const limit = flag.match(/^unblockableBpAtMost:(\d+)$/);
    // 不会被BPN或更高的角色阻挡 ("unblockableBpAtLeast:<n>")
    const floor = flag.match(/^unblockableBpAtLeast:(\d+)$/);
    if (floor) return bpOf(ctx, blocker) < Number(floor[1]);
    return !limit || bpOf(ctx, blocker) > Number(limit[1]);
  });
}

/** 对方必须尽可能的阻挡此角色的攻击 ("mustBeBlocked"): the attacker has the mark and the defender has a character that could block it. */
export function mustBeBlocked(ctx: EngineContext, attacker: UnionArenaFieldCard, defender: Pick<EnginePlayer, "front">): boolean {
  return flagsOf(attacker).includes("mustBeBlocked") && defender.front.some((card) => canBlock(ctx, attacker, card));
}

/**
 * "onlyAffinityEffects:<affinity>" (无法被没有特征"<affinity>"的我方和对方的角色效果选择或转为休息状态): whether an ability of the character
 * `sourceCardId` is kept from choosing or resting this card.
 */
function shieldedFrom(ctx: EngineContext, card: UnionArenaFieldCard, sourceCardId: string): boolean {
  const source = ctx.card(sourceCardId);
  if (source?.type !== "character") return false;
  return flagsOf(card).some((flag) => flag.startsWith("onlyAffinityEffects:") && !source.affinities.includes(flag.slice("onlyAffinityEffects:".length)));
}

/** A keyword ability the field card has now: printed, given for the turn, given until a next turn, or from a continuous ability. */
function keywordsOf(ctx: EngineContext, card: UnionArenaFieldCard): string[] {
  return [
    ...(ctx.card(card.cardId)?.keywords ?? []),
    ...card.grants,
    ...(card.staticKeywords ?? []),
    ...(card.lasting ?? []).flatMap((entry) => (entry.keyword ? [entry.keyword] : []))
  ];
}

export function hasKeyword(ctx: EngineContext, card: UnionArenaFieldCard, keyword: string): boolean {
  return keywordsOf(ctx, card).includes(keyword);
}

/** 此卡牌无法在前线中登场: the card's continuous abilities carry the "energyLineOnly" mark (it can only be put onto the energy line). */
export function energyLineOnly(ctx: EngineContext, cardId: string, player?: Pick<EnginePlayer, "sideline">): boolean {
  return abilitiesOf(ctx, cardId).some((ability) => ability.kind === "static" && (ability.flags ?? []).some((mark) => {
    if (mark === "energyLineOnly") return true;
    // "energyLineOnlyIfSidelineAtMost:<N>" (我方场外的卡牌张数不高于N张的场合，此角色不能在前线中登场): needs the player whose card it is.
    return mark.startsWith("energyLineOnlyIfSidelineAtMost:") && !!player && player.sideline.length <= Number(mark.slice("energyLineOnlyIfSidelineAtMost:".length));
  }));
}

/** 此卡牌只能通过我方的能力登场或进行突进 (the card's continuous abilities carry the "playOnlyByAbility" mark: it cannot be played from the hand with the normal play action). */
export function playOnlyByAbility(ctx: EngineContext, cardId: string): boolean {
  return abilitiesOf(ctx, cardId).some((ability) => ability.kind === "static" && (ability.flags ?? []).includes("playOnlyByAbility"));
}

/** 此卡牌只有在……的场合才能登场 (AOT Ymir, Our Founder): whether the `playCondition` of the card's continuous abilities allows `ownerId` to play it from the hand now. */
export function playConditionHolds(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, ownerId: string, cardId: string): boolean {
  const conditions = abilitiesOf(ctx, cardId).flatMap((ability) => (ability.kind === "static" && ability.playCondition ? [ability.playCondition] : []));
  if (!conditions.length) return true;
  const env = abilityEnv(game, players, ctx, ownerId, null, cardId);
  return conditions.every((condition) => condition(env));
}

/** 必须尽可能的进行攻击: an active front-line character with the "mustAttack" mark that could still attack (the attack phase cannot end yet). */
export function mustStillAttack(ctx: EngineContext, player: Pick<EnginePlayer, "front">): boolean {
  return player.front.some((card) => !card.rested && ctx.card(card.cardId)?.type === "character" && flagsOf(card).includes("mustAttack") && !flagsOf(card).includes("cannotAttack"));
}

export function bpOf(ctx: EngineContext, card: UnionArenaFieldCard): number {
  // 不会受到BP降低效果的影响 ("noBpDown"): reductions from continuous effects and lasting changes do not count while it has the mark
  // (reductions for this turn are not applied to it at all while it has the mark; see the "bp" step).
  if (flagsOf(card).includes("noBpDown")) return (ctx.card(card.cardId)?.bp ?? 0) + card.bpMod + Math.max(0, card.staticBp ?? 0) + (card.lasting ?? []).reduce((sum, entry) => sum + Math.max(0, entry.bp), 0);
  return (ctx.card(card.cardId)?.bp ?? 0) + card.bpMod + (card.staticBp ?? 0) + (card.lasting ?? []).reduce((sum, entry) => sum + entry.bp, 0);
}

/** Impact damage: "冲击N" (gaining it twice still gives N once), raised by "冲击+N"; "冲击+N" without Impact gives Impact N. */
export function impactOf(ctx: EngineContext, card: UnionArenaFieldCard): number {
  let base = 0;
  let plus = 0;
  for (const keyword of keywordsOf(ctx, card)) {
    const impact = keyword.match(/^冲击(\d+)$/);
    const raise = keyword.match(/^冲击\+(\d+)$/);
    if (impact) base = Math.max(base, Number(impact[1]));
    if (raise) plus += Number(raise[1]);
  }
  return base > 0 ? base + plus : plus;
}

/** Direct damage: 1, or 2 with 伤害2 (gaining it twice still gives 2), plus every 伤害+N. */
export function damageOf(ctx: EngineContext, card: UnionArenaFieldCard): number {
  const keywords = keywordsOf(ctx, card);
  const plus = keywords.reduce((sum, keyword) => sum + Number(keyword.match(/^伤害\+(\d+)$/)?.[1] ?? 0), 0);
  return (keywords.includes("伤害2") ? 2 : 1) + plus;
}

/**
 * Energy of one colour generated by the energy line. Front-line cards generate nothing (unless they carry the "energyOnFront" mark: 此角色存在于
 * 前线的场合也会产生能量); resting cards still do.
 */
export function energyOf(ctx: EngineContext, player: Pick<EnginePlayer, "energy"> & { front?: UnionArenaFieldCard[] }, color: string): number {
  const producing = [...player.energy, ...(player.front ?? []).filter((card) => flagsOf(card).includes("energyOnFront"))];
  return producing.reduce((sum, card) => {
    const stats = ctx.card(card.cardId);
    const generated = stats?.energyGenColor ?? stats?.color;
    // "extraEnergy:<colour>:<n>": energy of a given colour added by an effect (gains 《Green》《Green》 on a card of another colour).
    const extra = flagsOf(card).reduce((total, flag) => { const match = flag.match(/^extraEnergy:(\w+):(\d+)$/); return match && match[1] === color ? total + Number(match[2]) : total; }, 0);
    return (generated === color ? sum + Math.max(0, (stats?.energyGen ?? 0) + card.energyMod + (card.staticEnergy ?? 0) + (card.energyTurn ?? 0)) : sum) + extra;
  }, 0);
}

/** AP cards the AP area must hold at the start of a player's nth turn (rule manual, Start Phase step 3). */
export function apTarget(game: EngineGame, playerId: string): number {
  const nth = game.turnsTaken[playerId] ?? 0;
  if (nth <= 1) return playerId === game.firstPlayerId ? 1 : 2;
  return nth === 2 ? 2 : 3;
}

/** Remembers that `cardId` came onto `ownerId`'s field this turn (`game.entered`; older turns' entries are dropped). */
function recordEntered(game: EngineGame, ownerId: string, cardId: string, uid?: string): void {
  game.entered = [...(game.entered ?? []).filter((entry) => entry.turn === game.turn), { turn: game.turn, ownerId, cardId, ...(uid ? { uid } : {}) }];
}

function newFieldCard(game: EngineGame, owner: EnginePlayer, cardId: string, rested: boolean): UnionArenaFieldCard {
  game.seq += 1;
  recordEntered(game, owner.accountId, cardId, `${owner.accountId}:f${game.seq}`);
  return { uid: `${owner.accountId}:f${game.seq}`, cardId, under: [], rested, bpMod: 0, energyMod: 0, grants: [], attacks: 0, blocks: 0, skipNextActivate: false, staticBp: 0, staticKeywords: [], staticEnergy: 0, lasting: [], used: [], flags: [], staticFlags: [], energyTurn: 0, grantedAbilities: [] };
}

function locate(player: EnginePlayer, uid: string): { line: "front" | "energy"; card: UnionArenaFieldCard } | null {
  const front = player.front.find((card) => card.uid === uid);
  if (front) return { line: "front", card: front };
  const energy = player.energy.find((card) => card.uid === uid);
  return energy ? { line: "energy", card: energy } : null;
}

/** A field card on either side. */
function locateAny(players: readonly EnginePlayer[], uid: string): { owner: EnginePlayer; line: "front" | "energy"; card: UnionArenaFieldCard } | null {
  for (const owner of players) {
    const found = locate(owner, uid);
    if (found) return { owner, ...found };
  }
  return null;
}

/** "Switch to active", unless an ability said the next switch does not happen. */
function makeActive(card: UnionArenaFieldCard): void {
  if (!card.rested) return;
  if (card.skipNextActivate) { card.skipNextActivate = false; return; }
  card.rested = false;
}

/**
 * Moves a field card off the field. Only the top card of a Raid stack goes to the destination; the cards under it go to the sideline
 * (rule manual, "When a Raided Character on the Field Moves to a Destination Other than the Field").
 */
function leaveField(player: EnginePlayer, uid: string, destination: "sideline" | "removal" | "hand" | "deckBottom"): UnionArenaFieldCard {
  const found = locate(player, uid) ?? fail("CARD_NOT_ON_FIELD");
  player[found.line] = player[found.line].filter((card) => card.uid !== uid);
  // "underToHand" (KMY 灶门 祢豆子 021: 放回手牌的场合，改为将此角色和此角色的突进源放回手牌): the Raid source goes to the hand with it.
  if (destination === "hand" && flagsOf(found.card).includes("underToHand")) player.hand.push(...found.card.under);
  else player.sideline.push(...found.card.under);
  player.sideline.push(...(found.card.faceDown ?? []));
  if (destination === "sideline") player.sideline.push(found.card.cardId);
  else if (destination === "removal") player.removal.push(found.card.cardId);
  else if (destination === "hand") player.hand.push(found.card.cardId);
  else player.library.push(found.card.cardId);
  return found.card;
}

/** "Sidelined" in the rule manual's sense (battle, BP 0 or less, an effect saying 退场): the card's 【退场时】 abilities activate. */
function sidelineCard(game: EngineGame, ctx: EngineContext, owner: EnginePlayer, uid: string, cause: SidelineCause): UnionArenaFieldCard {
  // 此角色不会退场 ("cannotSideline"): it stays on the field (manual operations still apply).
  const staying = locate(owner, uid)?.card;
  if (staying && cause.kind !== "manual" && flagsOf(staying).includes("cannotSideline")) {
    log(game, `「${nameOf(ctx, staying.cardId)}」不会退场`);
    return staying;
  }
  // 不会通过对方的角色或事件卡牌的效果退场 ("noSidelineByOppEffect", KMY 富冈 义勇 UA01NC/KMY-2-008): an effect of the opponent (not a cost) cannot sideline it.
  if (staying && cause.kind === "effect" && !cause.cost && cause.byPlayerId && cause.byPlayerId !== owner.accountId && flagsOf(staying).includes("noSidelineByOppEffect")) {
    log(game, `「${nameOf(ctx, staying.cardId)}」不会通过对方的效果退场`);
    return staying;
  }
  // A replacement effect on the owner's field may apply: the owner is asked first (see `offerReplacement`); the card stays until then.
  if (staying && replaceable(cause) && [...owner.front, ...owner.energy].some((card) => abilitiesOf(ctx, card.cardId).some((ability) => ability.kind === "replaceSideline" && !ability.replaces))) {
    (game.replacing ??= []).push({ ownerId: owner.accountId, uid, cause, declined: [], asking: null });
    return staying;
  }
  return completeSideline(game, ctx, owner, uid, cause);
}

/** Replacement effects ("……退场的场合，可以改为……") apply to sidelining by a battle or an effect, not by BP 0 or less, a cost or by hand. */
const replaceable = (cause: SidelineCause): boolean => (cause.kind === "battle" || cause.kind === "effect") && !cause.cost;

/** The card leaves the field for the sideline; its 【退场时】 abilities activate. */
function completeSideline(game: EngineGame, ctx: EngineContext, owner: EnginePlayer, uid: string, cause: SidelineCause): UnionArenaFieldCard {
  // Remember a front-line character leaving, so `drain` can tell the other player's cards (onOpponentFrontSidelined).
  const wasOnFront = owner.front.some((entry) => entry.uid === uid) && ctx.card(owner.front.find((entry) => entry.uid === uid)!.cardId)?.type === "character";
  const card = leaveField(owner, uid, "sideline");
  if (wasOnFront) (game.frontSidelinedOwners ??= []).push(owner.accountId);
  // 本回合中我方角色退场过 (see characterSidelinedThisTurn)
  if (ctx.card(card.cardId)?.type === "character") { const mark = characterSidelinedMark(game, owner.accountId); if (!(game.turnMarks ??= []).includes(mark)) game.turnMarks.push(mark); game.turnMarks.push(`${game.turn}:${owner.accountId}:characterSidelinedN`); }
  // 本回合中有角色因BP变为0或因效果退场 (either player's character; a cost does not count): see `characterSidelinedByBpOrEffectThisTurn`
  if (ctx.card(card.cardId)?.type === "character" && (cause.kind === "bpZero" || cause.kind === "effect") && !cause.cost) { const mark = bpOrEffectSidelinedMark(game); if (!(game.turnMarks ??= []).includes(mark)) game.turnMarks.push(mark); }
  const withUnderCards: SidelineCause = card.under.length ? { ...cause, under: [...card.under] } : cause;
  // 【退场时】 abilities may need the face-down cards that were under it (they are in the sideline now).
  const withUnder: SidelineCause = card.faceDown?.length ? { ...withUnderCards, faceDown: [...card.faceDown] } : withUnderCards;
  queueAbilities(game, ctx, "onSidelined", owner, null, card.cardId, withUnder);
  queueAbilities(game, ctx, "onLeaveField", owner, null, card.cardId, withUnder);
  return card;
}

/**
 * A character is about to be returned to its owner's hand by an effect or a trigger. If a `replaces: "toHand"` ability on its owner's field offers
 * to replace that, the character stays and the owner is asked (see `offerReplacement`); true then. Otherwise false: the caller returns it.
 */
function holdReturnForReplacement(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, owner: EnginePlayer, target: UnionArenaFieldCard, cause: SidelineCause): boolean {
  if (!replacementOffers(game, players, ctx, owner, target, cause, true).length) return false;
  (game.replacing ??= []).push({ ownerId: owner.accountId, uid: target.uid, cause, declined: [], asking: null, toHand: true });
  return true;
}

/** The card leaves the field for its owner's hand; its 放回手牌 / 离开场上 abilities activate. */
function completeReturn(game: EngineGame, ctx: EngineContext, owner: EnginePlayer, uid: string, cause: SidelineCause): void {
  const card = leaveField(owner, uid, "hand");
  queueAbilities(game, ctx, "onReturnToHand", owner, null, card.cardId);
  queueAbilities(game, ctx, "onLeaveField", owner, null, card.cardId, cause);
}

/** The replacement effects that can replace sidelining `target` now: "<source uid>#<ability index>". */
function replacementOffers(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, owner: EnginePlayer, target: UnionArenaFieldCard, cause: SidelineCause, toHand = false): string[] {
  const offers: string[] = [];
  for (const source of [...owner.front, ...owner.energy]) {
    abilitiesOf(ctx, source.cardId).forEach((ability, index) => {
      if (ability.kind !== "replaceSideline" || (ability.oncePerTurn && source.used?.includes(index)) || (ability.replaces === "toHand") !== toHand) return;
      if (ability.condition(abilityEnv(game, players, ctx, owner.accountId, source.uid, source.cardId, {}, cause), target, cause)) offers.push(`${source.uid}#${index}`);
    });
  }
  return offers;
}

/** The next character waiting on a replacement effect: ask its owner about the next offer, or sideline it when none is left. */
function offerReplacement(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext): void {
  const item = game.replacing![0]!;
  const owner = find(players, item.ownerId);
  const target = locate(owner, item.uid)?.card;
  if (!target) { game.replacing!.shift(); return; }
  const offer = replacementOffers(game, players, ctx, owner, target, item.cause, item.toHand).find((key) => !item.declined.includes(key));
  if (!offer) {
    game.replacing!.shift();
    if (item.toHand) { completeReturn(game, ctx, owner, item.uid, item.cause); logEvent(game, `「${nameOf(ctx, target.cardId)}」放回手牌`, item.uid, "leave"); return; }
    completeSideline(game, ctx, owner, item.uid, item.cause);
    logEvent(game, `「${nameOf(ctx, target.cardId)}」退场`, item.uid, "leave");
    return;
  }
  const source = locate(owner, offer.split("#")[0]!)!.card;
  const ability = abilitiesOf(ctx, source.cardId)[Number(offer.split("#")[1])] as ReplaceSidelineAbility;
  item.asking = offer;
  game.pending = { kind: "choose", playerId: owner.accountId, purpose: "confirm", prompt: `「${nameOf(ctx, source.cardId)}」：「${nameOf(ctx, target.cardId)}」将要${item.toHand ? "放回手牌" : "退场"}。${ability.prompt}`, options: ["yes", "no"], cards: [null, null], min: 1, max: 1, sourceCardId: source.cardId };
}

/** The owner's answer about a replacement offer: "yes" applies it (the character stays), "no" moves on to the next offer. */
function answerReplacement(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, yes: boolean): void {
  const item = game.replacing![0]!;
  const offer = item.asking!;
  item.asking = null;
  if (!yes) { item.declined.push(offer); return; }
  const owner = find(players, item.ownerId);
  const target = locate(owner, item.uid)?.card;
  const source = locate(owner, offer.split("#")[0]!)?.card;
  game.replacing!.shift();
  if (!target || !source) return;
  const index = Number(offer.split("#")[1]);
  const ability = abilitiesOf(ctx, source.cardId)[index] as ReplaceSidelineAbility;
  if (ability.oncePerTurn) source.used = [...(source.used ?? []), index];
  log(game, `「${nameOf(ctx, source.cardId)}」：「${nameOf(ctx, target.cardId)}」没有${item.toHand ? "放回手牌" : "退场"}，改为由「${nameOf(ctx, source.cardId)}」的效果处理`);
  ability.apply(abilityEnv(game, players, ctx, owner.accountId, source.uid, source.cardId, {}, item.cause), target);
}

/** "当此卡牌置于场外时": queues the abilities of such cards that have arrived in a sideline since the last look. */
function noticeSidelineArrivals(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext): void {
  const seen = (game.sidelineSeen ??= {});
  for (const owner of players) {
    const counts: Record<string, number> = {};
    for (const cardId of owner.sideline) {
      if (abilitiesOf(ctx, cardId).some((ability) => ability.kind === "triggered" && ability.when.includes("onEnterSideline"))) counts[cardId] = (counts[cardId] ?? 0) + 1;
    }
    const before = seen[owner.accountId] ?? {};
    for (const [cardId, count] of Object.entries(counts)) {
      for (let copy = before[cardId] ?? 0; copy < count; copy += 1) queueAbilities(game, ctx, "onEnterSideline", owner, null, cardId);
    }
    seen[owner.accountId] = counts;
  }
}

/** Places a card onto a line. A full line first gives up the chosen card to the removal area (the only time a field card goes there for room). */
function placeOnLine(game: EngineGame, ctx: EngineContext, player: EnginePlayer, line: "front" | "energy", card: UnionArenaFieldCard, removeUid: string | undefined): void {
  if (player[line].length >= LINE_LIMIT) {
    if (!removeUid || !player[line].some((entry) => entry.uid === removeUid)) fail("LINE_FULL");
    const removed = leaveField(player, removeUid, "removal");
    log(game, `${player.username} 的${LINE_NAME[line]}已满，将「${nameOf(ctx, removed.cardId)}」置于移除区`);
  }
  player[line].push(card);
}

function payAp(player: EnginePlayer, amount: number): void {
  const active = player.ap.filter((card) => !card.rested);
  if (active.length < amount) fail("NOT_ENOUGH_AP");
  active.slice(0, amount).forEach((card) => { card.rested = true; });
}

function draw(player: EnginePlayer, count = 1): number {
  const cards = player.library.splice(0, count);
  player.hand.push(...cards);
  return cards.length;
}

function gameOver(game: EngineGame, winner: EnginePlayer, reason: string): void {
  game.step = "over";
  game.winnerId = winner.accountId;
  game.endReason = reason;
  game.pending = null;
  game.queue = [];
  game.resolving = null;
  game.after = [];
  log(game, `对局结束：${winner.username} 获胜（${reason}）`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Card abilities: environment, costs, continuous effects, the queue and the step interpreter.
// ---------------------------------------------------------------------------------------------------------------------------------

function abilityEnv(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, ownerId: string, selfUid: string | null, cardId: string, vars: Record<string, string[]> = {}, cause: SidelineCause | null = null): AbilityEnv {
  const owner = find(players, ownerId);
  const self = selfUid ? locate(owner, selfUid)?.card ?? null : null;
  return { game, players, ctx, owner, opponent: other(players, ownerId), self: self && self.cardId === cardId ? self : null, selfCardId: cardId, vars, cause };
}

const entryEnv = (game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, entry: QueuedAbility, vars: Record<string, string[]> = {}): AbilityEnv =>
  abilityEnv(game, players, ctx, entry.ownerId, entry.selfUid, entry.cardId, vars, entry.cause ?? null);

const holds = (condition: Condition | undefined, env: AbilityEnv): boolean => !condition || condition(env);

/** Whether an event in `ownerId`'s hand may be used now (此卡牌只有在……的场合才能使用: its onUse ability's `useCondition`). */
export function eventUsable(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, ownerId: string, cardId: string): boolean {
  const ability = abilitiesOf(ctx, cardId).find((entry) => entry.kind === "triggered" && entry.when.includes("onUse")) as TriggeredAbility | undefined;
  return !ability?.useCondition || ability.useCondition(abilityEnv(game, players, ctx, ownerId, null, cardId));
}

/** What a card in `ownerId`'s hand costs right now: its printed required energy and AP cost, changed by its own cost abilities. */
export function costOf(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, ownerId: string, cardId: string, raiding = false): { energy: number; ap: number } {
  const stats = statsOf(ctx, cardId);
  let energy = stats.energyCost;
  let ap = stats.apCost;
  const abilities = abilitiesOf(ctx, cardId);
  if (abilities.some((ability) => ability.kind === "cost")) {
    const env = abilityEnv(game, players, ctx, ownerId, null, cardId);
    for (const ability of abilities) {
      if (ability.kind !== "cost" || ability.fromField || !holds(ability.condition, env)) continue;
      energy -= typeof ability.energy === "function" ? ability.energy(env) : ability.energy ?? 0;
      ap -= ability.ap ?? 0;
    }
  }
  // Cost cuts that cards on the owner's field give to the cards in the hand (`fromField`).
  const cutter = players.find((player) => player.accountId === ownerId);
  for (const source of cutter ? [...cutter.front, ...cutter.energy] : []) {
    for (const ability of abilitiesOf(ctx, source.cardId)) {
      if (ability.kind !== "cost" || !ability.fromField) continue;
      const env = abilityEnv(game, players, ctx, ownerId, source.uid, source.cardId);
      if (!holds(ability.condition, env) || !ability.fromField(env, cardId, raiding)) continue;
      energy -= typeof ability.energy === "function" ? ability.energy(env) : ability.energy ?? 0;
      ap -= ability.ap ?? 0;
    }
  }
  ap -= nextPlayFor(game, ctx, ownerId, cardId)?.ap ?? 0;
  ap -= nextPlayLowBpFor(game, ctx, ownerId, cardId)?.ap ?? 0;
  ap -= nextPlayCheapFor(game, ctx, ownerId, cardId)?.ap ?? 0;
  ap -= nextUseExceptFor(game, ctx, ownerId, cardId)?.ap ?? 0;
  ap -= nextUseAffinityFor(game, ctx, ownerId, cardId)?.ap ?? 0;
  const namedCut = nextUseNamedFor(game, ctx, ownerId, cardId);
  if (namedCut) { ap -= namedCut.ap; if (stats.color === namedCut.color) energy -= namedCut.energy; }
  return { energy: Math.max(0, energy), ap: Math.max(0, ap) };
}

function requireCost(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, player: EnginePlayer, cardId: string, payAP: boolean, raiding = false): void {
  const stats = statsOf(ctx, cardId);
  const cost = costOf(game, players, ctx, player.accountId, cardId, raiding);
  if (energyOf(ctx, player, stats.color) < cost.energy) fail("NOT_ENOUGH_ENERGY");
  if (payAP) payAp(player, cost.ap);
}

/** Recomputes every field card's changes from continuous abilities (cards on the field whose conditions hold right now). */
function refreshStatics(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext): void {
  const all = players.flatMap((owner) => [...owner.front, ...owner.energy].map((card) => ({ owner, card })));
  for (const { card } of all) { card.staticBp = 0; card.staticKeywords = []; card.staticEnergy = 0; card.staticFlags = []; }
  for (const { owner, card: source } of all) {
    const abilities = abilitiesOf(ctx, source.cardId);
    if (!abilities.some((ability) => ability.kind === "static")) continue;
    const env = abilityEnv(game, players, ctx, owner.accountId, source.uid, source.cardId);
    for (const ability of abilities) {
      if (ability.kind !== "static" || !holds(ability.condition, env)) continue;
      const targets = ability.affects ? all.filter(({ owner: targetOwner, card }) => ability.affects!(env, card, targetOwner)) : [{ owner, card: source }];
      const bp = typeof ability.bp === "function" ? ability.bp(env) : ability.bp ?? 0;
      for (const { card } of targets) {
        card.staticBp = (card.staticBp ?? 0) + bp;
        card.staticKeywords = [...(card.staticKeywords ?? []), ...(ability.keywords ?? [])];
        card.staticEnergy = (card.staticEnergy ?? 0) + (ability.energy ?? 0);
        card.staticFlags = [...(card.staticFlags ?? []), ...(ability.flags ?? [])];
      }
    }
  }
  // "本回合中，你不能用〈name〉以外的角色攻击" (game.turnMarks "<turn>:<owner>:onlyAttackWith:<name>", AOT Rumbling): the owner's other characters get "cannotAttack".
  for (const player of players) {
    const prefix = `${game.turn}:${player.accountId}:onlyAttackWith:`;
    for (const mark of game.turnMarks ?? []) {
      if (!mark.startsWith(prefix)) continue;
      const name = mark.slice(prefix.length);
      for (const { owner, card } of all) if (owner === player && ctx.card(card.cardId)?.type === "character" && ctx.card(card.cardId)?.name !== name) card.staticFlags = [...(card.staticFlags ?? []), "cannotAttack"];
    }
  }
}

/** Queues the abilities of a card that activate at `event` (once-per-turn ones only if not used yet this turn). */
function queueAbilities(game: EngineGame, ctx: EngineContext, event: AbilityEvent, owner: EnginePlayer, card: UnionArenaFieldCard | null, cardId: string, cause: SidelineCause | null = null): void {
  // 在攻击阶段中从场上放回手牌: remembered per card number for the rest of the turn (AOT Mikasa Ackermann 066, see `returnedToHandInAttackPhase` in abilities/dsl.ts).
  if (event === "onReturnToHand" && game.phase === "attack") (game.turnMarks ??= []).push(`${game.turn}:${owner.accountId}:returnedInAttack:${cardId}`);
  abilitiesOf(ctx, cardId).forEach((ability, index) => {
    if (ability.kind !== "triggered" || ability.grantedOnly || !ability.when.includes(event)) return;
    if (ability.heardIf && !ability.heardIf(ctx, cause)) return;
    if (ability.oncePerTurn && card) {
      if (card.used?.includes(index)) return;
      card.used = [...(card.used ?? []), index];
    }
    game.seq += 1;
    game.queue.push({ id: game.seq, ownerId: owner.accountId, cardId, ability: index, selfUid: card?.uid ?? null, cause });
  });
  // Abilities given to this card by other cards' effects.
  for (const given of card?.grantedAbilities ?? []) {
    const ability = abilitiesOf(ctx, given.cardId)[given.index];
    if (ability?.kind !== "triggered" || !ability.when.includes(event)) continue;
    game.seq += 1;
    game.queue.push({ id: game.seq, ownerId: owner.accountId, cardId, ability: given.index, selfUid: card!.uid, abilityCardId: given.cardId, cause });
  }
}

/** An event about one field card. */
function emitSelf(game: EngineGame, ctx: EngineContext, event: AbilityEvent, owner: EnginePlayer, card: UnionArenaFieldCard): void {
  queueAbilities(game, ctx, event, owner, card, card.cardId);
  // 攻击阶段中当我方场上的角色移动时 (KMY 灶门 炭治郎 2-001): every card on the mover's field hears a move made in its owner's attack phase.
  if ((event === "onMoveToFront" || event === "onMoveToEnergy") && game.phase === "attack" && game.turnPlayerId === owner.accountId) {
    for (const heard of [...owner.front, ...owner.energy]) queueAbilities(game, ctx, "onOwnMoveInAttack", owner, heard, heard.cardId, { kind: "effect", byPlayerId: owner.accountId, attackerCardId: card.cardId });
  }
}

/** An event about a player: every card on their field hears it. */
function emitAll(game: EngineGame, ctx: EngineContext, event: AbilityEvent, owner: EnginePlayer): void {
  for (const card of [...owner.front, ...owner.energy]) queueAbilities(game, ctx, event, owner, card, card.cardId);
}

/** Steps after compiling `may` and `if` into jumps, so a resolving ability is just a program counter. */
type Instruction =
  | Exclude<Step, { do: "may" } | { do: "if" } | { do: "discard" } | { do: "put" } | { do: "moveLine" } | { do: "lookedToBottom" }>
  | { do: "jumpIfNot"; test: Condition; to: number }
  | { do: "jump"; to: number }
  | { do: "confirm"; prompt: string; to: number }
  /** Makes room on a full destination line: the owner picks a card of that line for the removal area. */
  | { do: "room"; as: string; line: "front" | "energy" | { chosen: string }; moving?: Target }
  | { do: "place"; chosen: string; line: "front" | "energy" | { chosen: string }; room: string; rested: boolean; activeOnEnergy?: boolean }
  | { do: "moveDo"; target: Target; room: string };

const compiled = new WeakMap<object, Instruction[]>();

function compile(steps: readonly Step[]): Instruction[] {
  const out: Instruction[] = [];
  const emit = (list: readonly Step[]): void => {
    for (const step of list) {
      if (step.do === "may") {
        const confirm: Instruction = { do: "confirm", prompt: step.prompt, to: -1 };
        out.push(confirm);
        emit(step.steps);
        confirm.to = out.length;
      } else if (step.do === "if") {
        const test: Instruction = { do: "jumpIfNot", test: step.test, to: -1 };
        out.push(test);
        emit(step.steps);
        if (step.else) {
          const skip: Instruction = { do: "jump", to: -1 };
          out.push(skip);
          test.to = out.length;
          emit(step.else);
          skip.to = out.length;
        } else test.to = out.length;
      } else if (step.do === "discard") {
        out.push({ do: "choose", as: "__discard", from: "hand", side: "you", min: step.count, max: step.count, prompt: `选择 ${step.count} 张手牌置于场外`, good: false });
        out.push({ do: "moveChosen", chosen: "__discard", to: "sideline" });
      } else if (step.do === "put") {
        const line = step.line === "choose" ? { chosen: "__line" } : step.line;
        if (step.line === "choose") out.push({ do: "choose", as: "__line", from: "line", side: "you", min: 1, max: 1, prompt: "选择登场的线", good: true, forChosen: step.chosen });
        out.push({ do: "room", as: "__room", line });
        out.push({ do: "place", chosen: step.chosen, line, room: "__room", rested: step.rested, activeOnEnergy: step.activeOnEnergy });
      } else if (step.do === "moveLine") {
        out.push({ do: "room", as: "__room", line: "front", moving: step.target });
        out.push({ do: "moveDo", target: step.target, room: "__room" });
      } else if (step.do === "lookedToBottom") {
        out.push({ do: "choose", as: "__bottom", from: "looked", side: "you", all: true, min: 0, max: 99, prompt: "依次点选剩余的卡，按点选顺序放到卡组最下方", good: true });
        out.push({ do: "moveChosen", chosen: "__bottom", to: "deckBottom" });
      } else out.push(step);
    }
  };
  emit(steps);
  return out;
}

/** The program an ability runs; an Activate: Main ability first has its discard costs chosen. */
function programOf(ability: Ability): Instruction[] {
  let program = compiled.get(ability);
  if (program) return program;
  if (ability.kind === "triggered") program = compile(ability.steps);
  else if (ability.kind === "activated") {
    const discards = ability.costs.flatMap((cost): Step[] => (cost.pay === "discard" ? [{ do: "discard", count: cost.count }] : []));
    program = compile([...discards, ...ability.steps]);
  } else if (ability.kind === "replaceTrigger") program = compile(ability.steps ?? []);
  else program = [];
  compiled.set(ability, program);
  return program;
}

function targetsOf(env: AbilityEnv, target: Target): Array<{ owner: EnginePlayer; card: UnionArenaFieldCard }> {
  const withOwner = (card: UnionArenaFieldCard): { owner: EnginePlayer; card: UnionArenaFieldCard } | null => {
    const found = locateAny(env.players, card.uid);
    return found ? { owner: found.owner, card: found.card } : null;
  };
  let cards: UnionArenaFieldCard[];
  if (target === "self") cards = env.self ? [env.self] : [];
  else if (typeof target === "function") cards = target(env);
  else cards = (env.vars[target.chosen] ?? []).flatMap((uid) => locateAny(env.players, uid)?.card ?? []);
  return cards.flatMap((card) => withOwner(card) ?? []);
}

/** The options a choose step offers right now, with a label for options that are not cards. */
function chooseOptions(env: AbilityEnv, step: Extract<Instruction, { do: "choose" }>): Array<{ key: string; cardId: string | null; label?: string }> {
  const result: Array<{ key: string; cardId: string | null; label?: string }> = [];
  const { owner } = env;
  switch (step.from) {
    case "field": {
      const sides = step.side === "you" ? [owner] : step.side === "opponent" ? [env.opponent] : [owner, env.opponent];
      const sourceType = env.ctx.card(env.selfCardId)?.type;
      for (const player of sides) {
        const lines = step.line ? [player[step.line]] : [player.front, player.energy];
        for (const card of lines.flat()) {
          if (step.characters !== false && env.ctx.card(card.cardId)?.type !== "character") continue;
          // 不会被对方角色/事件卡牌的效果选择
          if (player !== owner && flagsOf(card).includes(`untargetable:${sourceType}`)) continue;
          // 不会被BP N或更高的对方角色的效果选择 ("untargetableByCharBpAtLeast:<n>", JJK 日下部 笃也): the source's BP now (its printed BP once it has left the field).
          if (player !== owner && sourceType === "character") {
            const floor = flagsOf(card).flatMap((flag) => { const match = flag.match(/^untargetableByCharBpAtLeast:(\d+)$/); return match ? [Number(match[1])] : []; });
            if (floor.length && (env.self ? bpOf(env.ctx, env.self) : env.ctx.card(env.selfCardId)?.bp ?? 0) >= Math.min(...floor)) continue;
          }
          // "taxAp:<type>": choosing it with a <type> card's ability costs the chooser 1 AP (needs an active AP card, see `payTargetTax`).
          if (player !== owner && flagsOf(card).includes(`taxAp:${sourceType}`) && !owner.ap.some((ap) => !ap.rested)) continue;
          if (shieldedFrom(env.ctx, card, env.selfCardId)) continue;
          if (step.filter && !step.filter(env, card.cardId, card)) continue;
          result.push({ key: card.uid, cardId: card.cardId });
        }
      }
      return result;
    }
    case "hand":
    case "sideline": {
      // side "opponent" on a sideline choice (KMY 珠世: 对方将自己场外存在的卡牌置于移除区): the opponent's own sideline, keys "os:<index>".
      const theirs = step.from === "sideline" && step.side === "opponent";
      const zone = step.from === "hand" ? owner.hand : theirs ? env.opponent.sideline : owner.sideline;
      zone.forEach((cardId, index) => { if (!step.filter || step.filter(env, cardId, null)) result.push({ key: `${theirs ? "os" : step.from === "hand" ? "h" : "s"}:${index}`, cardId }); });
      return result;
    }
    case "looked": {
      const looking = env.game.looking;
      const taken = step.exclude ? env.vars[step.exclude] ?? [] : [];
      if (looking?.ownerId === owner.accountId) looking.cards.forEach((cardId, index) => { if (!taken.includes(`l:${index}`) && (!step.filter || step.filter(env, cardId, null))) result.push({ key: `l:${index}`, cardId }); });
      return result;
    }
    case "ap":
      owner.ap.forEach((card, index) => result.push({ key: `ap:${card.id}`, cardId: null, label: `AP 卡 ${index + 1}（${card.rested ? "休息" : "活跃"}）` }));
      return result;
    case "mode":
      (step.modes ?? []).forEach((text, index) => result.push({ key: `m:${index}`, cardId: null, label: text }));
      return result;
    case "line": {
      // Nothing to put: no question. A site can only go onto the energy line.
      const placing = step.forChosen ? env.vars[step.forChosen] ?? [] : [];
      if (!placing.length) return result;
      const onlyEnergy = placing.some((key) => env.ctx.card(zoneCard(env, key) ?? "")?.type === "site" || energyLineOnly(env.ctx, zoneCard(env, key) ?? "", env.owner));
      if (!onlyEnergy) result.push({ key: "line:front", cardId: null, label: "前线" });
      result.push({ key: "line:energy", cardId: null, label: "能量线" });
      return result;
    }
  }
}

/** Whether a resolving ability is a character's ability acting on a card of the other player ("对方的角色能力", for the "immuneOppCharacter" mark). */
function opposingCharacterEffect(ctx: EngineContext, entry: QueuedAbility, targetOwner: EnginePlayer): boolean {
  return ctx.card(entry.cardId)?.type === "character" && targetOwner.accountId !== entry.ownerId;
}

/**
 * "taxAp:<type>" (对方不支付1AP就无法用角色/事件卡牌的能力选择此角色): picking such an opposing card with an ability of a <type> card rests one active AP
 * card of the chooser per card. Returns false, paying nothing, when the chooser cannot afford all the picks.
 */
function payTargetTax(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, entry: QueuedAbility, uids: string[]): boolean {
  const owner = find(players, entry.ownerId);
  const opponent = other(players, entry.ownerId);
  const sourceType = ctx.card(entry.cardId)?.type;
  const taxed = [...opponent.front, ...opponent.energy].filter((card) => uids.includes(card.uid) && flagsOf(card).includes(`taxAp:${sourceType}`));
  if (!taxed.length) return true;
  const active = owner.ap.filter((ap) => !ap.rested);
  if (active.length < taxed.length) return false;
  taxed.forEach((card, index) => { active[index]!.rested = true; log(game, `「${nameOf(ctx, entry.cardId)}」：为选择「${nameOf(ctx, card.cardId)}」支付 1 AP`); });
  return true;
}

/** The card behind a hand / sideline / looked-at key. */
function zoneCard(env: AbilityEnv, key: string): string | undefined {
  const index = Number(key.slice(2));
  if (key.startsWith("h:")) return env.owner.hand[index];
  if (key.startsWith("s:")) return env.owner.sideline[index];
  if (key.startsWith("l:")) return env.game.looking?.cards[index];
  return undefined;
}

function applyDuration(card: UnionArenaFieldCard, change: { bp?: number; keyword?: string; flag?: string }, until: "turn" | "untilYourNextTurn", abilityOwnerId: string): void {
  if (until === "turn") {
    if (change.bp) card.bpMod += change.bp;
    if (change.keyword) card.grants.push(change.keyword);
    if (change.flag) card.flags = [...(card.flags ?? []), change.flag];
    return;
  }
  card.lasting = [...(card.lasting ?? []), { bp: change.bp ?? 0, keyword: change.keyword ?? null, flag: change.flag ?? null, untilTurnOf: abilityOwnerId }];
}

/** The destination line of a room / place instruction. */
function lineOf(env: AbilityEnv, line: "front" | "energy" | { chosen: string }): "front" | "energy" {
  if (typeof line === "string") return line;
  return env.vars[line.chosen]?.[0] === "line:front" ? "front" : "energy";
}

/** Runs the resolving ability until it finishes or has to ask for a choice. */
function stepResolving(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext): void {
  const resolving = game.resolving!;
  const { entry } = resolving;
  const ability = abilityOfEntry(ctx, entry);
  const program = ability ? programOf(ability) : [];
  const env = entryEnv(game, players, ctx, entry, resolving.vars);
  const source = `「${nameOf(ctx, entry.cardId)}」`;
  // An effect can end the game (a life area emptied): nothing more resolves then.
  while (resolving.pc < program.length && game.step === "turn" && !game.replacing?.length) {
    const step = program[resolving.pc]!;
    switch (step.do) {
      case "jump": resolving.pc = step.to; continue;
      case "jumpIfNot": resolving.pc = step.test(env) ? resolving.pc + 1 : step.to; continue;
      case "confirm":
        game.pending = { kind: "choose", playerId: entry.ownerId, purpose: "confirm", prompt: `${source}：${step.prompt}`, options: ["yes", "no"], cards: [null, null], min: 1, max: 1, sourceCardId: entry.cardId };
        return;
      case "choose": {
        delete resolving.vars.__bpRange;
        const options = chooseOptions(env, step);
        // "本回合中，下一次选择指定BP范围的角色时，BP范围+1000": a filter that used the raised range (see `bpRangeBonus` in dsl.ts) uses the mark up.
        if (resolving.vars.__bpRange && options.length && !step.chooser) { const mark = `${game.turn}:${entry.ownerId}:bpRangePlus`; game.turnMarks = (game.turnMarks ?? []).filter((entry2) => entry2 !== mark); }
        delete resolving.vars.__bpRange;
        const min = step.all ? options.length : step.min;
        // No real choice: at most the required number of options (or, for an order, at most one card).
        if (step.all ? options.length <= 1 : options.length <= min) {
          if (step.from === "field" && !step.chooser) payTargetTax(game, players, ctx, entry, options.map((option) => option.key));
          resolving.vars[step.as] = options.map((option) => option.key);
          resolving.pc += 1;
          continue;
        }
        game.pending = {
          kind: "choose", playerId: step.chooser === "opponent" ? other(players, entry.ownerId).accountId : entry.ownerId, purpose: "target", prompt: `${source}：${step.prompt}`, options: options.map((option) => option.key), cards: options.map((option) => option.cardId),
          labels: options.some((option) => option.label) ? options.map((option) => option.label ?? "") : undefined,
          min, max: step.all ? options.length : Math.min(step.max, options.length), sourceCardId: entry.cardId, good: step.good, ordered: step.all || undefined
        };
        return;
      }
      case "room": {
        // A full destination line first gives up one of its cards (chosen by its owner) to the removal area.
        const line = lineOf(env, step.line);
        const moving = step.moving ? targetsOf(env, step.moving) : [];
        const destination = moving.length ? (moving[0]!.owner.front.includes(moving[0]!.card) ? "energy" : "front") : line;
        const owner = moving[0]?.owner ?? env.owner;
        if (owner[destination].length < LINE_LIMIT) { resolving.vars[step.as] = []; resolving.pc += 1; continue; }
        const options = owner[destination];
        if (options.length === 1) { resolving.vars[step.as] = [options[0]!.uid]; resolving.pc += 1; continue; }
        game.pending = { kind: "choose", playerId: owner.accountId, purpose: "target", prompt: `${LINE_NAME[destination]}已满：选择 1 张置于移除区`, options: options.map((card) => card.uid), cards: options.map((card) => card.cardId), min: 1, max: 1, sourceCardId: entry.cardId, good: false };
        return;
      }
      case "bp": {
        const amount = typeof step.amount === "function" ? step.amount(env) : step.amount;
        for (const { owner: targetOwner, card } of targetsOf(env, step.target)) {
          if (amount < 0 && flagsOf(card).includes("noBpDown")) { log(game, `${source}：「${nameOf(ctx, card.cardId)}」不受 BP 降低效果的影响`); continue; }
          // 对方的角色能力无法使此角色退场或降低其BP ("immuneOppCharacter", AOT War Hammer Titan)
          if (amount < 0 && opposingCharacterEffect(ctx, entry, targetOwner) && flagsOf(card).includes("immuneOppCharacter")) { log(game, `${source}：「${nameOf(ctx, card.cardId)}」不受对方角色能力降低 BP 的影响`); continue; }
          applyDuration(card, { bp: amount }, step.until, entry.ownerId);
          logEvent(game, `${source}：「${nameOf(ctx, card.cardId)}」${step.until === "turn" ? "本回合" : "直到下一个回合开始"} BP${amount >= 0 ? "+" : ""}${amount}`, card.uid, "bp");
        }
        break;
      }
      case "keyword":
        for (const { card } of targetsOf(env, step.target)) {
          applyDuration(card, { keyword: step.keyword }, step.until, entry.ownerId);
          logEvent(game, `${source}：「${nameOf(ctx, card.cardId)}」获得《${step.keyword}》`, card.uid, "keyword");
        }
        break;
      case "rest":
      case "activate":
        for (const { owner, card } of targetsOf(env, step.target)) {
          // 无法通过自己的卡牌效果转为休息状态
          if (step.do === "rest" && owner === env.owner && flagsOf(card).includes("noSelfRest")) continue;
          if (step.do === "rest" && shieldedFrom(ctx, card, env.selfCardId)) continue;
          if (step.do === "rest") card.rested = true; else makeActive(card);
          logEvent(game, `${source}：「${nameOf(ctx, card.cardId)}」转为${step.do === "rest" ? "休息" : "活跃"}状态`, card.uid, "state");
        }
        break;
      case "sideline":
      case "toHand":
      case "remove":
      case "toDeckBottom":
        for (const { owner, card } of targetsOf(env, step.target)) {
          const name = nameOf(ctx, card.cardId);
          if (step.do === "sideline") {
            if (opposingCharacterEffect(ctx, entry, owner) && flagsOf(card).includes("immuneOppCharacter")) { log(game, `${source}：「${name}」不会被对方的角色能力退场`); continue; }
            sidelineCard(game, ctx, owner, card.uid, { kind: "effect", byPlayerId: entry.ownerId, sourceCardId: entry.abilityCardId ?? entry.cardId });
            if (locate(owner, card.uid)) continue; // 不会退场
          } else {
            // 无法放回手牌 ("cannotToHand")
            if (step.do === "toHand" && flagsOf(card).includes("cannotToHand")) { log(game, `${source}：「${name}」无法放回手牌`); continue; }
            // 被放回手牌的场合，可以改为……: the owner is asked first; the character stays until then.
            if (step.do === "toHand" && holdReturnForReplacement(game, players, ctx, owner, card, { kind: "effect", byPlayerId: entry.ownerId })) continue;
            leaveField(owner, card.uid, step.do === "toHand" ? "hand" : step.do === "remove" ? "removal" : "deckBottom");
          }
          if (step.do === "toHand") queueAbilities(game, ctx, "onReturnToHand", owner, null, card.cardId);
          if (step.do !== "sideline") queueAbilities(game, ctx, "onLeaveField", owner, null, card.cardId, { kind: "effect", byPlayerId: entry.ownerId });
          log(game, `${source}：「${name}」${{ sideline: "退场", toHand: "放回手牌", remove: "置于移除区", toDeckBottom: "置于卡组最下方" }[step.do]}`);
        }
        break;
      case "draw": {
        const drawn = draw(env.owner, step.count);
        logEvent(game, `${source}：${env.owner.username} 抽 ${drawn} 张卡`, undefined, "draw");
        break;
      }
      case "moveChosen": {
        // Picks keep their order (the order chosen for the bottom of the deck); indexes are read before anything is removed.
        const keys = (Array.isArray(step.chosen) ? step.chosen : [step.chosen]).flatMap((name) => resolving.vars[name] ?? []).filter((key) => /^[hsl]:\d+$/.test(key));
        const zoneOf = (prefix: string): string[] => (prefix === "h" ? env.owner.hand : prefix === "s" ? env.owner.sideline : game.looking?.cards ?? []);
        const moved = keys.map((key) => zoneOf(key[0]!)[Number(key.slice(2))]!).filter(Boolean);
        const handMoved = keys.filter((key) => key.startsWith("h:")).map((key) => env.owner.hand[Number(key.slice(2))]!).filter(Boolean);
        for (const prefix of ["h", "s", "l"]) {
          const indexes = keys.filter((key) => key.startsWith(prefix)).map((key) => Number(key.slice(2))).sort((a, b) => b - a);
          for (const index of indexes) zoneOf(prefix).splice(index, 1);
        }
        const destination = step.to === "hand" ? env.owner.hand : step.to === "sideline" ? env.owner.sideline : step.to === "removal" ? env.owner.removal : env.owner.library;
        destination.push(...moved);
        // 本回合中有我方的手牌或卡组中的卡牌通过我方的效果置于过场外
        if (step.to === "sideline" && keys.some((key) => key.startsWith("h:") || key.startsWith("l:"))) markHandDeckSidelined(game, env.owner.accountId);
        // 本回合中通过某张卡牌的效果将手牌置于场外 (KMY 炼狱 槙寿郎): the card whose ability did it is part of the mark (see `handDiscardedByCardsThisTurn`)
        if (step.to === "sideline" && keys.some((key) => key.startsWith("h:"))) (game.turnMarks ??= []).push(`${game.turn}:${env.owner.accountId}:handDiscardedBy:${entry.abilityCardId ?? entry.cardId}`);
        // 通过某张卡牌的效果将某张手牌置于场外 (KMY 炼狱 瑠火 / 炼狱 杏寿郎, see abilities/cards-kmy-6.ts): one mark per card, with the card whose ability did it.
        // A discard paid as the cost of an activated ability ([将1张手牌置于场外]) is not an effect and leaves none.
        if (step.to === "sideline" && !(ability?.kind === "activated" && resolving.pc < 2 * ability.costs.filter((cost) => cost.pay === "discard").length)) {
          for (const discarded of handMoved) (game.turnMarks ??= []).push(`${game.turn}:${env.owner.accountId}:handCardDiscardedBy:${entry.abilityCardId ?? entry.cardId}:${discarded}`);
        }
        // Cards going to the bottom of the deck stay hidden; the others are public.
        if (moved.length) log(game, step.to === "deckBottom" ? `${source}：${moved.length} 张卡置于卡组最下方` : `${source}：${keys.some((key) => key.startsWith("l:")) ? "公开" : ""}${moved.map((cardId) => `「${nameOf(ctx, cardId)}」`).join("")}${{ hand: "加入手牌", sideline: "置于场外", removal: "置于移除区", deckBottom: "" }[step.to]}`);
        break;
      }
      case "look": {
        const cards = env.owner.library.splice(0, step.count);
        game.looking = { ownerId: env.owner.accountId, cards };
        log(game, `${source}：${env.owner.username} 确认卡组最上方的 ${cards.length} 张卡`);
        break;
      }
      case "place": {
        const line = lineOf(env, step.line);
        const key = (resolving.vars[step.chosen] ?? [])[0];
        const cardId = key ? zoneCard(env, key) : undefined;
        if (!key || !cardId) break;
        const zone = key.startsWith("h:") ? env.owner.hand : key.startsWith("s:") ? env.owner.sideline : game.looking?.cards ?? [];
        zone.splice(Number(key.slice(2)), 1);
        const card = newFieldCard(game, env.owner, cardId, step.rested && !(step.activeOnEnergy && line === "energy"));
        placeOnLine(game, ctx, env.owner, line, card, resolving.vars[step.room]?.[0]);
        // Later steps can refer to the card that came onto the field as chosen("placed:<name>") (该角色).
        resolving.vars[`placed:${step.chosen}`] = [card.uid];
        logEvent(game, `${source}：「${nameOf(ctx, cardId)}」以${card.rested ? "休息" : "活跃"}状态登场到${LINE_NAME[line]}`, card.uid, "play");
        // Its 【登场时】 abilities can tell it came onto the field by this ability (通过我方的效果登场).
        queueAbilities(game, ctx, "onPlay", env.owner, card, card.cardId, { kind: "effect", byPlayerId: entry.ownerId, sourceCardId: entry.abilityCardId ?? entry.cardId, from: key.startsWith("h:") ? "hand" : key.startsWith("s:") ? "sideline" : "deck" });
        break;
      }
      case "moveDo":
        for (const { owner, card } of targetsOf(env, step.target)) {
          const from = owner.front.includes(card) ? "front" : "energy";
          const to = from === "front" ? "energy" : "front";
          const room = resolving.vars[step.room]?.[0];
          if (room && owner[to].some((entry) => entry.uid === room)) { leaveField(owner, room, "removal"); }
          owner[from] = owner[from].filter((entry) => entry !== card);
          owner[to].push(card);
          log(game, `${source}：「${nameOf(ctx, card.cardId)}」移动至${LINE_NAME[to]}`);
          emitSelf(game, ctx, to === "front" ? "onMoveToFront" : "onMoveToEnergy", owner, card);
        }
        break;
      case "energy":
        for (const { card } of targetsOf(env, step.target)) {
          card.energyTurn = (card.energyTurn ?? 0) + step.amount;
          log(game, `${source}：「${nameOf(ctx, card.cardId)}」本回合产生能量${step.amount >= 0 ? "+" : ""}${step.amount}`);
        }
        break;
      case "flag":
        for (const { card } of targetsOf(env, step.target)) applyDuration(card, { flag: step.flag }, step.until, entry.ownerId);
        break;
      case "grantAbility":
        for (const { card } of targetsOf(env, step.target)) card.grantedAbilities = [...(card.grantedAbilities ?? []), { cardId: entry.abilityCardId ?? entry.cardId, index: step.ability }];
        break;
      case "activateAp": {
        const ids = (resolving.vars[step.chosen] ?? []).filter((key) => key.startsWith("ap:")).map((key) => key.slice(3));
        for (const card of env.owner.ap) if (ids.includes(card.id)) card.rested = false;
        if (ids.length) log(game, `${source}：${ids.length} 张 AP 卡转为活跃状态`);
        break;
      }
      case "run": {
        // A `run` step that moves cards out of the owner's hand / deck / looked-at cards into their sideline (a mill) counts for `handDeckSidelinedThisTurn`.
        const before = { hand: env.owner.hand.length, library: env.owner.library.length, looked: game.looking?.cards.length ?? 0, sideline: env.owner.sideline.length };
        step.fn(env);
        if (env.owner.sideline.length > before.sideline && (env.owner.hand.length < before.hand || env.owner.library.length < before.library || (game.looking?.cards.length ?? 0) < before.looked)) markHandDeckSidelined(game, env.owner.accountId);
        log(game, `${source}：${step.text}`);
        break;
      }
    }
    resolving.pc += 1;
    refreshStatics(game, players, ctx);
  }
  // A replacement question first (see `drain`); the ability goes on afterwards.
  if (resolving.pc < program.length && game.replacing?.length) return;
  // Cards still being looked at when an ability ends go to the bottom of the deck in their order.
  if (game.looking?.cards.length) find(players, game.looking.ownerId).library.push(...game.looking.cards);
  game.looking = null;
  game.resolving = null;
}

/**
 * Starts the next queued ability: the turn player's first (rule manual, "When Multiple Abilities Activate Simultaneously"); a player with
 * several waiting picks which one resolves first. An ability whose condition does not hold when it resolves does nothing.
 */
function startNextQueued(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext): void {
  const turnPlayer = game.turnPlayerId!;
  const ownerId = game.queue.some((entry) => entry.ownerId === turnPlayer) ? turnPlayer : game.queue[0]!.ownerId;
  const mine = game.queue.filter((entry) => entry.ownerId === ownerId);
  if (mine.length > 1) {
    game.pending = { kind: "choose", playerId: ownerId, purpose: "order", prompt: "多个能力同时发动：选择先结算哪一个", options: mine.map((entry) => `q:${entry.id}`), cards: mine.map((entry) => entry.cardId), min: 1, max: 1, sourceCardId: mine[0]!.cardId };
    return;
  }
  const entry = mine[0]!;
  game.queue = game.queue.filter((queued) => queued !== entry);
  beginResolving(game, players, ctx, entry);
}

/** Starts resolving a queued ability, unless its condition ("……的场合") does not hold now: then it does nothing. */
function beginResolving(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, entry: QueuedAbility): void {
  const ability = abilityOfEntry(ctx, entry);
  if (ability?.kind === "triggered" && !holds(ability.condition, entryEnv(game, players, ctx, entry))) {
    log(game, `「${nameOf(ctx, entry.cardId)}」的能力条件不满足，没有效果`);
    return;
  }
  game.resolving = { entry, pc: 0, vars: {} };
}

/** Sidelines every character whose BP is 0 or less ("When BP Becomes Zero or Less"); true when one was. */
function sidelineZeroBp(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext): boolean {
  for (const owner of players) {
    for (const card of [...owner.front, ...owner.energy]) {
      if (ctx.card(card.cardId)?.type !== "character" || bpOf(ctx, card) > 0) continue;
      if (flagsOf(card).includes("cannotSideline")) continue;
      sidelineCard(game, ctx, owner, card.uid, { kind: "bpZero", byPlayerId: null });
      log(game, `「${nameOf(ctx, card.cardId)}」BP 降至 0 或更低，退场`);
      return true;
    }
  }
  return false;
}

/** Resolves queued abilities, then carries on with what they interrupted, until the game waits for a player. */
function drain(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext): void {
  for (let guard = 0; guard < 10000; guard += 1) {
    if (game.step !== "turn") return;
    refreshStatics(game, players, ctx);
    noticeSidelineArrivals(game, players, ctx);
    // 对方前线中的角色退场时: the other player's cards hear about each front-line character that was sidelined.
    while (game.frontSidelinedOwners?.length) emitAll(game, ctx, "onOpponentFrontSidelined", other(players, game.frontSidelinedOwners.shift()!));
    if (sidelineZeroBp(game, players, ctx)) continue;
    if (game.pending) return;
    // A character about to be sidelined while a replacement effect may apply: that question comes before anything else.
    if (game.replacing?.length) { offerReplacement(game, players, ctx); continue; }
    if (game.resolving) { stepResolving(game, players, ctx); continue; }
    if (game.queue.length) { startNextQueued(game, players, ctx); continue; }
    const next = game.after.pop();
    if (!next) return;
    runContinuation(game, players, ctx, next);
  }
  fail("ABILITY_LOOP");
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Turn structure.
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Start Phase, steps 1 to 4: effects "until the start of your next turn" end; switch every resting card (characters, sites, AP cards) to
 * active, bring the AP area up to the table's count (new AP cards are placed active), then draw a card (Player One skips this on the first
 * turn). A player who must draw from an empty deck loses. Step 5, the optional extra draw, waits for the player.
 */
function beginTurn(game: EngineGame, players: readonly EnginePlayer[], playerId: string): void {
  const player = find(players, playerId);
  game.turnPlayerId = playerId;
  game.phase = "start";
  game.extraDrawUsed = false;
  game.pending = null;
  game.turnsTaken[playerId] = (game.turnsTaken[playerId] ?? 0) + 1;
  log(game, `第 ${game.turn} 回合：${player.username} 的回合开始`);
  for (const owner of players) for (const card of [...owner.front, ...owner.energy]) card.lasting = (card.lasting ?? []).filter((entry) => entry.untilTurnOf !== playerId);
  // "noStartActivate" (在起始阶段中不会转为活跃状态): from a continuous effect.
  for (const card of [...player.front, ...player.energy]) if (!flagsOf(card).includes("noStartActivate")) makeActive(card);
  for (const card of player.ap) card.rested = false;
  const target = Math.min(apTarget(game, playerId), player.apCount);
  while (player.ap.length < target) player.ap.push({ id: `${playerId}:ap${player.ap.length}`, rested: false });
  const firstTurnOfPlayerOne = playerId === game.firstPlayerId && game.turnsTaken[playerId] === 1;
  if (firstTurnOfPlayerOne) return;
  if (!player.library.length) {
    gameOver(game, other(players, playerId), `${player.username} 在起始阶段无法从牌库抽卡`);
    return;
  }
  draw(player);
}

/** Called once both mulligans are decided and the life areas are dealt: Player One's first turn begins. */
export function beginFirstTurn(game: EngineGame, players: readonly EnginePlayer[]): void {
  game.step = "turn";
  game.turn = 1;
  game.turnsTaken = {};
  game.queue = game.queue ?? [];
  game.after = game.after ?? [];
  game.resolving = game.resolving ?? null;
  for (const player of players) clearBoard(player);
  beginTurn(game, players, game.firstPlayerId);
}

/** End Phase step 1: abilities that activate at the start of the end phase; the remaining steps follow once they have resolved. */
function endTurn(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext): void {
  // The attack phase ends first: "when the attack phase ends" abilities resolve before the end phase begins.
  const before = game.queue.length;
  emitAll(game, ctx, "onAttackPhaseEnd", find(players, game.turnPlayerId!));
  // 每个攻击阶段结束时: the cards of both players hear it.
  for (const owner of players) emitAll(game, ctx, "onEveryAttackPhaseEnd", owner);
  if (game.queue.length > before) { game.after.push({ kind: "beginEndPhase" }); return; }
  beginEndPhase(game, players, ctx);
}

/** End Phase step 1 (after the attack phase has ended). */
function beginEndPhase(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext): void {
  const player = find(players, game.turnPlayerId!);
  game.phase = "end";
  log(game, `${player.username} 进入结束阶段`);
  game.after.push({ kind: "endSteps" });
  emitAll(game, ctx, "onEndStart", player);
  // 我方的结束阶段开始时，手牌中的此卡牌 (AOT Mikasa Ackermann 066): the cards in the hand hear it too (no field card; `env.self` is null).
  for (const cardId of player.hand) queueAbilities(game, ctx, "onEndStartInHand", player, null, cardId);
}

/** End Phase steps 2 and 3: switch resting characters and sites to active (AP cards stay resting), then keep at most eight cards in hand. */
function endSteps(game: EngineGame, players: readonly EnginePlayer[]): void {
  const player = find(players, game.turnPlayerId!);
  for (const card of [...player.front, ...player.energy]) if (!flagsOf(card).includes("stayRested")) makeActive(card);
  if (player.hand.length > HAND_LIMIT) {
    game.pending = { kind: "discard", playerId: player.accountId };
    return;
  }
  finishTurn(game, players);
}

/** End Phase step 4 (effects "until the end of the turn" stop), then the opponent's turn begins. */
function finishTurn(game: EngineGame, players: readonly EnginePlayer[]): void {
  for (const player of players) {
    for (const card of [...player.front, ...player.energy]) {
      card.bpMod = 0;
      card.grants = [];
      card.attacks = 0;
      card.blocks = 0;
      card.used = [];
      card.flags = [];
      card.energyTurn = 0;
      card.grantedAbilities = [];
    }
  }
  game.pending = null;
  game.turn += 1;
  beginTurn(game, players, other(players, game.turnPlayerId!).accountId);
}

/** Whether a character on the field matches a Raid target: a name, or "[affinity]". The target must not itself have Raid. */
export function raidTargetMatches(ctx: EngineContext, raidCard: UnionArenaCardStats, target: UnionArenaFieldCard): boolean {
  const stats = ctx.card(target.cardId);
  if (!raidCard.raid || !stats || stats.type !== "character" || stats.raid) return false;
  return raidCard.raid.targets.some((spec) => {
    const affinity = spec.match(/^\[(.+)\]$/);
    // A "name:<name>" mark (此卡牌的卡牌名变更为〈…〉) makes the card match that name too.
    return affinity ? stats.affinities.includes(affinity[1]!) : stats.name === spec || flagsOf(target).includes(`name:${spec}`);
  });
}

/**
 * Raid: the card goes on top of the target, which switches to active (abilities that applied to the card underneath stop applying) and
 * may move from the energy line to the front line. Then the Raid card's 【登场时】 abilities activate.
 */
function performRaid(game: EngineGame, ctx: EngineContext, player: EnginePlayer, cardId: string, targetUid: string, toFront: boolean, removeUid: string | undefined): void {
  const stats = statsOf(ctx, cardId);
  const found = locate(player, targetUid) ?? fail("RAID_TARGET_INVALID");
  if (!raidTargetMatches(ctx, stats, found.card)) fail("RAID_TARGET_INVALID");
  const target = found.card;
  const below = nameOf(ctx, target.cardId);
  const raidedCardId = target.cardId;
  recordEntered(game, player.accountId, cardId, targetUid);
  target.under = [...target.under, target.cardId];
  target.cardId = cardId;
  target.bpMod = 0;
  target.grants = [];
  target.energyMod = 0;
  target.lasting = [];
  target.used = [];
  target.flags = [];
  target.energyTurn = 0;
  target.grantedAbilities = [];
  target.skipNextActivate = false;
  target.attacks = 0;
  target.blocks = 0;
  target.rested = false;
  log(game, `${player.username} 以「${stats.name}」突进到「${below}」上，转为活跃状态`);
  if (toFront && found.line === "energy") {
    player.energy = player.energy.filter((card) => card.uid !== targetUid);
    placeOnLine(game, ctx, player, "front", target, removeUid);
    log(game, `「${stats.name}」移动至前线`);
  }
  // 当此角色被突进时 (EVA 式波 113): the raided card (now under the Raid card) hears it; with the Raid card's 【登场时】 the owner orders them.
  queueAbilities(game, ctx, "onBeingRaided", player, null, raidedCardId);
  emitSelf(game, ctx, "onPlay", player, target);
}

function takeFromHand(player: EnginePlayer, handIndex: number): string {
  if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= player.hand.length) fail("INVALID_CARD");
  return player.hand.splice(handIndex, 1)[0]!;
}

function handCard(player: EnginePlayer, handIndex: number): string {
  if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= player.hand.length) fail("INVALID_CARD");
  return player.hand[handIndex]!;
}

/** Simultaneous movement: energy line to front line, and characters with 撤步 from the front line to the energy line. */
function move(game: EngineGame, ctx: EngineContext, player: EnginePlayer, toFront: string[], toEnergy: string[], remove: string[]): void {
  const unique = (ids: string[]): boolean => new Set(ids).size === ids.length;
  if (!Array.isArray(toFront) || !Array.isArray(toEnergy) || !Array.isArray(remove) || !unique([...toFront, ...toEnergy, ...remove])) fail("INVALID_MOVE");
  for (const uid of toFront) {
    const card = player.energy.find((entry) => entry.uid === uid) ?? fail("INVALID_MOVE");
    if (ctx.card(card.cardId)?.type !== "character") fail("SITE_CANNOT_MOVE");
    if (flagsOf(card).includes("cannotMove")) fail("CANNOT_MOVE");
  }
  for (const uid of toEnergy) {
    const card = player.front.find((entry) => entry.uid === uid) ?? fail("INVALID_MOVE");
    if (!hasKeyword(ctx, card, "撤步")) fail("STEP_REQUIRED");
    if (flagsOf(card).includes("cannotMove")) fail("CANNOT_MOVE");
  }
  const removeFront = remove.filter((uid) => player.front.some((card) => card.uid === uid));
  const removeEnergy = remove.filter((uid) => player.energy.some((card) => card.uid === uid));
  if (removeFront.length + removeEnergy.length !== remove.length) fail("INVALID_MOVE");
  const frontOverflow = Math.max(0, player.front.length - toEnergy.length + toFront.length - LINE_LIMIT);
  const energyOverflow = Math.max(0, player.energy.length - toFront.length + toEnergy.length - LINE_LIMIT);
  // A full destination gives up one card per incoming character, and only then.
  if (removeFront.length !== frontOverflow || removeEnergy.length !== energyOverflow) fail(frontOverflow || energyOverflow ? "LINE_FULL" : "INVALID_MOVE");
  for (const uid of remove) {
    const removed = leaveField(player, uid, "removal");
    log(game, `${player.username} 为腾出位置将「${nameOf(ctx, removed.cardId)}」置于移除区`);
  }
  const forward = player.energy.filter((card) => toFront.includes(card.uid));
  const back = player.front.filter((card) => toEnergy.includes(card.uid));
  player.energy = [...player.energy.filter((card) => !toFront.includes(card.uid)), ...back];
  player.front = [...player.front.filter((card) => !toEnergy.includes(card.uid)), ...forward];
  for (const card of forward) { log(game, `${player.username} 将「${nameOf(ctx, card.cardId)}」从能量线移动至前线`); emitSelf(game, ctx, "onMoveToFront", player, card); }
  for (const card of back) { log(game, `${player.username} 将「${nameOf(ctx, card.cardId)}」从前线移动至能量线（撤步）`); emitSelf(game, ctx, "onMoveToEnergy", player, card); }
}

function enterMain(game: EngineGame, ctx: EngineContext, player: EnginePlayer): void {
  game.phase = "main";
  log(game, `${player.username} 进入主要阶段`);
  emitAll(game, ctx, "onMainStart", player);
}

/** The player dealing damage picks one life card per point; with no life left there is nothing to pick. */
function startDamage(game: EngineGame, attacker: EnginePlayer, defender: EnginePlayer, amount: number, attackerUid: string): void {
  const count = Math.min(amount, defender.life.length);
  game.pending = count > 0 ? { kind: "damage", playerId: attacker.accountId, defenderId: defender.accountId, amount: count, attackerUid } : null;
}

/** The steps of an attack, run once the abilities they set off have resolved. */
function runContinuation(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, next: Continuation): void {
  switch (next.kind) {
    case "afterAttackDeclared": {
      const attackerOwner = find(players, next.attackerOwnerId);
      const defender = other(players, next.attackerOwnerId);
      // An attacker that left the field during its 【攻击时】 abilities ends the attack.
      if (!locate(attackerOwner, next.attackerUid)) return;
      if (next.targetUid) {
        if (locate(defender, next.targetUid)) game.after.push({ kind: "battle", attackerOwnerId: next.attackerOwnerId, attackerUid: next.attackerUid, defenderOwnerId: defender.accountId, defenderUid: next.targetUid });
        return;
      }
      const attacker = locate(attackerOwner, next.attackerUid)!.card;
      // 必须尽可能阻挡 ("mustBlock"): such a character that can block does so at once, without the defender being asked.
      const forced = defender.front.find((card) => flagsOf(card).includes("mustBlock") && canBlock(ctx, attacker, card));
      if (forced) {
        forced.rested = true;
        forced.blocks += 1;
        if (forced.blocks === 1 && hasKeyword(ctx, forced, "2次阻挡")) forced.rested = false;
        log(game, `「${nameOf(ctx, forced.cardId)}」必须尽可能阻挡，阻挡了「${nameOf(ctx, attacker.cardId)}」`);
        game.after.push({ kind: "battle", attackerOwnerId: next.attackerOwnerId, attackerUid: next.attackerUid, defenderOwnerId: defender.accountId, defenderUid: forced.uid, blocked: true });
        emitSelf(game, ctx, "onBlock", defender, forced);
        return;
      }
      if (defender.front.some((card) => canBlock(ctx, attacker, card))) {
        game.pending = { kind: "block", playerId: defender.accountId, attackerUid: next.attackerUid };
        return;
      }
      game.after.push({ kind: "unblocked", attackerOwnerId: next.attackerOwnerId, attackerUid: next.attackerUid });
      return;
    }
    case "battle": {
      // Battle: the attacker wins on equal or higher BP. The loser is sidelined only when it is the attacked character.
      const attackerOwner = find(players, next.attackerOwnerId);
      const defenderOwner = find(players, next.defenderOwnerId);
      const attacker = locate(attackerOwner, next.attackerUid)?.card;
      const defender = locate(defenderOwner, next.defenderUid)?.card;
      if (!attacker || !defender) return;
      const attackBp = bpOf(ctx, attacker);
      const defendBp = bpOf(ctx, defender);
      if (attackBp >= defendBp) {
        const impact = hasKeyword(ctx, defender, "冲击无效") ? 0 : impactOf(ctx, attacker);
        logEvent(game, `战斗：「${nameOf(ctx, attacker.cardId)}」(${attackBp}) 胜过「${nameOf(ctx, defender.cardId)}」(${defendBp})，后者退场`, attacker.uid, "battle-win");
        game.lastBattleWon = { attackerUid: next.attackerUid, foeBp: defendBp };
        game.after.push({ kind: "afterBattle", attackerOwnerId: next.attackerOwnerId, attackerUid: next.attackerUid, defenderOwnerId: next.defenderOwnerId, won: true, impact });
        sidelineCard(game, ctx, defenderOwner, defender.uid, { kind: "battle", byPlayerId: next.attackerOwnerId });
      } else {
        logEvent(game, `战斗：「${nameOf(ctx, attacker.cardId)}」(${attackBp}) 不敌「${nameOf(ctx, defender.cardId)}」(${defendBp})，攻击角色不退场`, attacker.uid, "battle-lose");
        if (next.blocked) emitSelf(game, ctx, "onWinBlock", defenderOwner, defender);
        emitSelf(game, ctx, "onLoseAttackBattle", attackerOwner, attacker);
      }
      return;
    }
    case "afterBattle": {
      // After the loser's 【退场时】 abilities: the winner's "when it wins a battle" abilities, then Impact.
      const attackerOwner = find(players, next.attackerOwnerId);
      const attacker = locate(attackerOwner, next.attackerUid)?.card;
      if (next.impact > 0) game.after.push({ kind: "damage", attackerOwnerId: next.attackerOwnerId, attackerUid: next.attackerUid, amount: next.impact });
      if (attacker) emitSelf(game, ctx, "onWinBattle", attackerOwner, attacker);
      return;
    }
    case "unblocked": {
      const attackerOwner = find(players, next.attackerOwnerId);
      const attacker = locate(attackerOwner, next.attackerUid)?.card;
      if (!attacker) return;
      game.after.push({ kind: "damage", attackerOwnerId: next.attackerOwnerId, attackerUid: next.attackerUid, amount: null });
      emitSelf(game, ctx, "onAttackUnblocked", attackerOwner, attacker);
      return;
    }
    case "damage": {
      const attackerOwner = find(players, next.attackerOwnerId);
      const attacker = locate(attackerOwner, next.attackerUid)?.card;
      let amount = next.amount ?? (attacker ? damageOf(ctx, attacker) : 0);
      const defenderPlayer = other(players, next.attackerOwnerId);
      // "When you would take 2 or more damage at once": replacement abilities get their chance first.
      if (!next.asked && amount >= 2) {
        const before = game.queue.length;
        for (const card of defenderPlayer.front) queueAbilities(game, ctx, "onTakeDamage", defenderPlayer, card, card.cardId);
        if (game.queue.length > before) { game.damageCap = null; game.after.push({ ...next, amount, asked: true }); return; }
      }
      if (game.damageCap != null) { amount = Math.min(amount, game.damageCap); game.damageCap = null; }
      if (next.amount !== null) log(game, `「${attacker ? nameOf(ctx, attacker.cardId) : "攻击角色"}」的冲击给予 ${other(players, next.attackerOwnerId).username} ${amount} 点伤害`);
      startDamage(game, attackerOwner, other(players, next.attackerOwnerId), amount, next.attackerUid);
      return;
    }
    case "attackEnd": {
      const attackerOwner = find(players, next.attackerOwnerId);
      const attacker = locate(attackerOwner, next.attackerUid)?.card;
      if (attacker) emitSelf(game, ctx, "onAttackEnd", attackerOwner, attacker);
      return;
    }
    case "eventDone": {
      // Events go to the sideline once their ability has resolved.
      find(players, next.ownerId).sideline.push(next.cardId);
      return;
    }
    case "resumeTriggers":
      game.pending = next.pending;
      return;
    case "endSteps":
      endSteps(game, players);
      return;
    case "endTurnNow":
      endTurn(game, players, ctx);
      return;
    case "beginEndPhase":
      beginEndPhase(game, players, ctx);
      return;
    case "attackPhaseStart":
      // 当攻击阶段开始时: after the main phase's 【主要阶段结束时】 abilities have resolved.
      emitAll(game, ctx, "onAttackStart", find(players, game.turnPlayerId!));
      return;
  }
}

/** The triggers that need a chosen character, and which characters may be chosen. */
function triggerTargets(ctx: EngineContext, owner: FieldLines, attacker: FieldLines, trigger: { label: string; text: string }): UnionArenaFieldCard[] | null {
  const isCharacter = (card: UnionArenaFieldCard): boolean => ctx.card(card.cardId)?.type === "character";
  if (trigger.label === "激活") return [...owner.front, ...owner.energy].filter(isCharacter);
  // "noTriggerTarget": 无法被对方的触发能力选择 (the opponent's trigger abilities cannot choose it).
  const choosable = (card: UnionArenaFieldCard): boolean => isCharacter(card) && !flagsOf(card).includes("noTriggerTarget");
  if (trigger.label === "特殊") return attacker.front.filter(choosable);
  if (trigger.label === "色彩") {
    const limit = trigger.text.match(/BP不高于(\d+)的角色/);
    if (limit) return attacker.front.filter((card) => choosable(card) && bpOf(ctx, card) <= Number(limit[1]));
    if (trigger.text.includes("转为休息状态")) return attacker.front.filter(choosable);
  }
  return null;
}

/** Cards in the sideline a "play it from your sideline" colour trigger may choose. */
function sidelinePlayTargets(ctx: EngineContext, owner: Pick<EnginePlayer, "sideline">, text: string): number[] {
  return playableIndexes(ctx, owner.sideline, text);
}

/** Cards in the hand a "play it from your hand" colour trigger may choose (the AOT cards print it from the hand). */
function handPlayTargets(ctx: EngineContext, hand: readonly string[], text: string): number[] {
  return text.includes("手牌") ? playableIndexes(ctx, hand, text) : [];
}

/** The positions of `cards` that fit the trigger's "required energy N or less, AP cost M, colour C character" rule. */
function playableIndexes(ctx: EngineContext, cards: readonly string[], text: string): number[] {
  const rule = text.match(/所需能量不高于(\d+)且消费AP(\d+)的(.)色角色/);
  if (!rule) return [];
  const colors: Readonly<Record<string, string>> = { 黄: "yellow", 红: "red", 蓝: "blue", 紫: "purple", 绿: "green" };
  return cards.flatMap((cardId, index) => {
    const stats = ctx.card(cardId);
    return stats && stats.type === "character" && !energyLineOnly(ctx, cardId) && stats.energyCost <= Number(rule[1]) && stats.apCost === Number(rule[2]) && stats.color === colors[rule[3]!] ? [index] : [];
  });
}

/**
 * Resolves one revealed life card. If it has a trigger and its owner activates it, the printed trigger runs; then the card goes to the
 * sideline (unless the trigger put it into the hand or onto the field).
 */
function resolveTrigger(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, owner: EnginePlayer, attacker: EnginePlayer, slot: LifeSlot, action: Extract<UnionArenaAction, { type: "trigger" }>, override?: { label: string; text: string }): void {
  const stats = ctx.card(slot.cardId);
  const trigger = override ?? stats?.trigger ?? null;
  const name = nameOf(ctx, slot.cardId);
  if (!trigger || !action.activate) {
    owner.sideline.push(slot.cardId);
    log(game, trigger ? `${owner.username} 未发动「${name}」的触发` : `「${name}」没有触发`);
    queueLifeToSideline(game, ctx, owner, slot.cardId);
    return;
  }
  const targets = triggerTargets(ctx, owner, attacker, trigger);
  let target: UnionArenaFieldCard | null = null;
  if (targets) {
    if (action.targetUid) target = targets.find((card) => card.uid === action.targetUid) ?? fail("TRIGGER_TARGET_INVALID");
    else if (targets.length) fail("TRIGGER_TARGET_REQUIRED");
  }
  const prefix = `${owner.username} 发动「${name}」的触发【${trigger.label}】`;
  let destination: "sideline" | "hand" | "field" = "sideline";
  switch (trigger.label) {
    case "抽卡":
      log(game, `${prefix}：抽 ${draw(owner)} 张卡`);
      break;
    case "获得":
      destination = "hand";
      log(game, `${prefix}：此卡加入手牌`);
      break;
    case "突进":
      if (action.raid) {
        // Raid by a trigger: the required energy must be there, no AP is paid.
        if (energyOf(ctx, owner, stats!.color) < (players ? costOf(game, players, ctx, owner.accountId, slot.cardId).energy : stats!.energyCost)) fail("NOT_ENOUGH_ENERGY");
        log(game, `${prefix}：进行突进`);
        performRaid(game, ctx, owner, slot.cardId, action.raid.targetUid, action.raid.toFront === true, action.raid.remove);
        destination = "field";
      } else {
        destination = "hand";
        log(game, `${prefix}：此卡加入手牌`);
      }
      break;
    case "激活":
      if (target) {
        makeActive(target);
        target.bpMod += 3000;
        log(game, `${prefix}：「${nameOf(ctx, target.cardId)}」转为活跃状态，本回合 BP+3000`);
      } else log(game, `${prefix}：场上没有可选择的角色`);
      break;
    case "特殊":
      if (target && flagsOf(target).includes("specialTriggerToHand")) {
        // The target's mark (AOT Hardened Punch): sidelining it with a 【特殊】 trigger is replaced by adding the trigger card to its owner's hand.
        destination = "hand";
        log(game, `${prefix}：「${nameOf(ctx, target.cardId)}」没有退场，此卡改为加入手牌`);
      } else if (target) {
        sidelineCard(game, ctx, attacker, target.uid, { kind: "effect", byPlayerId: owner.accountId });
        log(game, `${prefix}：「${nameOf(ctx, target.cardId)}」退场`);
      } else log(game, `${prefix}：对方前线没有角色`);
      break;
    case "色彩":
      if (trigger.text.includes("手牌") && trigger.text.includes("登场")) {
        const choices = handPlayTargets(ctx, owner.hand, trigger.text);
        if (choices.length) {
          const index = action.handIndex;
          if (index === undefined || !choices.includes(index)) fail("TRIGGER_TARGET_REQUIRED");
          const cardId = owner.hand.splice(index, 1)[0]!;
          const card = newFieldCard(game, owner, cardId, false);
          placeOnLine(game, ctx, owner, "front", card, action.remove);
          log(game, `${prefix}：从手牌将「${nameOf(ctx, cardId)}」以活跃状态登场到前线`);
          emitSelf(game, ctx, "onPlay", owner, card);
        } else log(game, `${prefix}：手牌里没有符合条件的角色`);
      } else if (trigger.text.includes("场外") && trigger.text.includes("登场")) {
        const choices = sidelinePlayTargets(ctx, owner, trigger.text);
        if (choices.length) {
          const index = action.sidelineIndex;
          if (index === undefined || !choices.includes(index)) fail("TRIGGER_TARGET_REQUIRED");
          const cardId = owner.sideline.splice(index, 1)[0]!;
          const card = newFieldCard(game, owner, cardId, false);
          placeOnLine(game, ctx, owner, "front", card, action.remove);
          log(game, `${prefix}：从场外将「${nameOf(ctx, cardId)}」以活跃状态登场到前线`);
          emitSelf(game, ctx, "onPlay", owner, card);
        } else log(game, `${prefix}：场外没有符合条件的角色`);
      } else if (!target) {
        log(game, `${prefix}：没有符合条件的角色`);
      } else if (trigger.text.includes("退场")) {
        sidelineCard(game, ctx, attacker, target.uid, { kind: "effect", byPlayerId: owner.accountId });
        log(game, `${prefix}：「${nameOf(ctx, target.cardId)}」退场`);
      } else if (trigger.text.includes("放回手牌") && holdReturnForReplacement(game, players, ctx, attacker, target, { kind: "effect", byPlayerId: owner.accountId })) {
        log(game, `${prefix}：「${nameOf(ctx, target.cardId)}」将要放回手牌`);
      } else if (trigger.text.includes("放回手牌")) {
        leaveField(attacker, target.uid, "hand");
        queueAbilities(game, ctx, "onReturnToHand", attacker, null, target.cardId);
        queueAbilities(game, ctx, "onLeaveField", attacker, null, target.cardId, { kind: "effect", byPlayerId: owner.accountId });
        log(game, `${prefix}：「${nameOf(ctx, target.cardId)}」放回手牌`);
      } else {
        target.rested = true;
        target.skipNextActivate = true;
        log(game, `${prefix}：「${nameOf(ctx, target.cardId)}」转为休息状态，下一次转为活跃状态无效`);
      }
      break;
    case "最终":
      if (!owner.life.length && owner.library.length) {
        const cardId = owner.library.shift()!;
        game.seq += 1;
        owner.life.push({ id: `${owner.accountId}:life:r${game.seq}`, cardId, faceUp: false });
        log(game, `${prefix}：将牌库顶 1 张卡置于生命区`);
      } else log(game, `${prefix}：生命区仍有卡牌，没有效果`);
      break;
    default:
      log(game, `${prefix}：${trigger.text}（请按卡面结算）`);
  }
  if (destination === "sideline") { owner.sideline.push(slot.cardId); queueLifeToSideline(game, ctx, owner, slot.cardId); }
  else if (destination === "hand") owner.hand.push(slot.cardId);
}

/** 当卡牌从我方的生命区中置于场外时 (EVA 式波 087): every card on the life owner's field hears "onOwnLifeToSideline"; the cause names the life card. */
function queueLifeToSideline(game: EngineGame, ctx: EngineContext, owner: EnginePlayer, cardId: string): void {
  for (const heard of [...owner.front, ...owner.energy]) queueAbilities(game, ctx, "onOwnLifeToSideline", owner, heard, heard.cardId, { kind: "effect", byPlayerId: owner.accountId, sourceCardId: cardId });
}

/** A revealed life card's trigger is done: the rest of the revealed cards (if any) are next; abilities it set off resolve before them. */
function completeTrigger(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, owner: EnginePlayer, attacker: EnginePlayer, pending: Extract<EnginePending, { kind: "triggers" }>, slot: LifeSlot, action: Extract<UnionArenaAction, { type: "trigger" }>, override?: { label: string; text: string }, handled = false): void {
  if (!handled) resolveTrigger(game, players, ctx, owner, attacker, slot, action, override);
  pending.revealed = pending.revealed.filter((entry) => entry.id !== slot.id);
  if (pending.revealed.length) {
    game.pending = pending;
    // Abilities a trigger set off (e.g. 【登场时】 after a trigger Raid) resolve before the next revealed card.
    if (game.queue.length || game.replacing?.length) { game.pending = null; game.after.push({ kind: "resumeTriggers", pending: { ...pending, revealed: [...pending.revealed] } }); }
    return;
  }
  game.pending = null;
  if (!owner.life.length) gameOver(game, attacker, `${owner.username} 的生命区没有卡牌了`);
}

/** The trigger-replacing abilities ("<source uid>#<ability index>") on the owner's field that can replace this revealed card's trigger now. */
function triggerSwapOffers(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, owner: EnginePlayer, slot: LifeSlot): string[] {
  const label = ctx.card(slot.cardId)?.trigger?.label;
  if (!label) return [];
  const offers: string[] = [];
  for (const source of [...owner.front, ...owner.energy]) {
    abilitiesOf(ctx, source.cardId).forEach((ability, index) => {
      if (ability.kind !== "replaceTrigger") return;
      if (ability.condition(abilityEnv(game, players, ctx, owner.accountId, source.uid, source.cardId), { label, cardId: slot.cardId })) offers.push(`${source.uid}#${index}`);
    });
  }
  return offers;
}

/** Asks the owner about the next trigger-replacing offer; with none left the trigger resolves as printed. */
function askTriggerSwap(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext): void {
  const swap = game.triggerSwap!;
  const owner = find(players, swap.ownerId);
  const slot = swap.revealed.find((entry) => entry.id === swap.lifeId)!;
  const offer = triggerSwapOffers(game, players, ctx, owner, slot).find((key) => !swap.declined.includes(key));
  if (!offer) {
    game.triggerSwap = undefined;
    completeTrigger(game, players, ctx, owner, find(players, swap.attackerId), { kind: "triggers", playerId: swap.ownerId, attackerId: swap.attackerId, revealed: swap.revealed }, slot, swap.action);
    return;
  }
  const source = locate(owner, offer.split("#")[0]!)!.card;
  const ability = abilitiesOf(ctx, source.cardId)[Number(offer.split("#")[1])] as ReplaceTriggerAbility;
  swap.asking = offer;
  game.pending = { kind: "choose", playerId: owner.accountId, purpose: "confirm", prompt: `「${nameOf(ctx, source.cardId)}」：「${nameOf(ctx, slot.cardId)}」的触发【${ctx.card(slot.cardId)?.trigger?.label}】。${ability.prompt}`, options: ["yes", "no"], cards: [null, null], min: 1, max: 1, sourceCardId: source.cardId };
}

/** The owner's answer about a trigger-replacing offer: "yes" replaces the trigger, "no" moves on to the next offer. */
function answerTriggerSwap(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, yes: boolean): void {
  const swap = game.triggerSwap!;
  const offer = swap.asking!;
  swap.asking = null;
  if (!yes) { swap.declined.push(offer); askTriggerSwap(game, players, ctx); return; }
  const owner = find(players, swap.ownerId);
  const attacker = find(players, swap.attackerId);
  const slot = swap.revealed.find((entry) => entry.id === swap.lifeId)!;
  const source = locate(owner, offer.split("#")[0]!)!.card;
  const index = Number(offer.split("#")[1]);
  const ability = abilitiesOf(ctx, source.cardId)[index] as ReplaceTriggerAbility;
  game.triggerSwap = undefined;
  const pending: Extract<EnginePending, { kind: "triggers" }> = { kind: "triggers", playerId: swap.ownerId, attackerId: swap.attackerId, revealed: swap.revealed };
  log(game, `「${nameOf(ctx, source.cardId)}」：「${nameOf(ctx, slot.cardId)}」的触发改为由「${nameOf(ctx, source.cardId)}」的效果处理`);
  if (ability.steps?.length) {
    // The revealed card is looked at (key "l:0") by the steps, which put it where the effect says.
    game.looking = { ownerId: owner.accountId, cards: [slot.cardId] };
    game.seq += 1;
    game.queue.push({ id: game.seq, ownerId: owner.accountId, cardId: source.cardId, ability: index, selfUid: source.uid });
    completeTrigger(game, players, ctx, owner, attacker, pending, slot, swap.action, undefined, true);
    return;
  }
  completeTrigger(game, players, ctx, owner, attacker, pending, slot, swap.action, ability.as === "获得" ? { label: "获得", text: "此卡牌加入手牌。" } : undefined);
}

function applyManual(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, actor: EnginePlayer, manual: UnionArenaManualOp): void {
  const who = actor.username;
  switch (manual?.op) {
    case "draw":
      if (!draw(actor)) fail("DECK_EMPTY");
      log(game, `${who}（卡牌效果）抽 1 张卡`);
      return;
    case "hand": {
      if (manual.act !== "sideline" && manual.act !== "removal") fail("INVALID_MANUAL");
      const cardId = takeFromHand(actor, manual.handIndex);
      actor[manual.act === "sideline" ? "sideline" : "removal"].push(cardId);
      log(game, `${who}（卡牌效果）将手牌「${nameOf(ctx, cardId)}」置于${manual.act === "sideline" ? "场外" : "移除区"}`);
      return;
    }
    case "ap": {
      const card = actor.ap.find((entry) => entry.id === manual.apId) ?? fail("INVALID_MANUAL");
      if (manual.act !== "rest" && manual.act !== "activate") fail("INVALID_MANUAL");
      card.rested = manual.act === "rest";
      log(game, `${who}（卡牌效果）将 1 张 AP 卡转为${card.rested ? "休息" : "活跃"}状态`);
      return;
    }
    case "sideline_to_hand": {
      if (!Number.isInteger(manual.index) || manual.index < 0 || manual.index >= actor.sideline.length) fail("INVALID_MANUAL");
      const cardId = actor.sideline.splice(manual.index, 1)[0]!;
      actor.hand.push(cardId);
      log(game, `${who}（卡牌效果）将场外的「${nameOf(ctx, cardId)}」加入手牌`);
      return;
    }
    case "grant":
    case "field": {
      const owner = manual.owner === "opponent" ? other(players, actor.accountId) : actor;
      const card = locate(owner, manual.uid)?.card ?? fail("CARD_NOT_ON_FIELD");
      const name = nameOf(ctx, card.cardId);
      const whose = owner === actor ? "" : `${owner.username} 的`;
      if (manual.op === "grant") {
        if (!(GRANTABLE_KEYWORDS as readonly string[]).includes(manual.keyword)) fail("INVALID_MANUAL");
        card.grants.push(manual.keyword);
        log(game, `${who}（卡牌效果）本回合给予${whose}「${name}」《${manual.keyword}》`);
        return;
      }
      switch (manual.act) {
        case "rest": card.rested = true; break;
        case "activate": makeActive(card); break;
        case "bp+": card.bpMod += 1000; break;
        case "bp-": card.bpMod -= 1000; break;
        case "energy+": card.energyMod += 1; break;
        case "energy-": card.energyMod -= 1; break;
        case "sideline": sidelineCard(game, ctx, owner, card.uid, { kind: "manual", byPlayerId: actor.accountId }); break;
        case "hand": case "removal":
          leaveField(owner, card.uid, manual.act);
          if (manual.act === "hand") queueAbilities(game, ctx, "onReturnToHand", owner, null, card.cardId);
          queueAbilities(game, ctx, "onLeaveField", owner, null, card.cardId, { kind: "manual", byPlayerId: actor.accountId });
          break;
        default: fail("INVALID_MANUAL");
      }
      const text: Readonly<Record<string, string>> = { rest: "转为休息状态", activate: "转为活跃状态", "bp+": "本回合 BP+1000", "bp-": "本回合 BP-1000", "energy+": "能量产出 +1", "energy-": "能量产出 -1", sideline: "退场", hand: "放回手牌", removal: "置于移除区" };
      log(game, `${who}（卡牌效果）${whose}「${name}」${text[manual.act]}`);
      return;
    }
    default:
      fail("INVALID_MANUAL");
  }
}

/** Who has to act now: the player a pending decision waits for, else the turn player. */
export function actingPlayerId(game: EngineGame): string | null {
  if (game.step !== "turn") return null;
  return game.pending?.playerId ?? game.turnPlayerId;
}

/** Why an Activate: Main ability cannot be used right now, or null when it can. */
export function activationIssue(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, playerId: string, uid: string, index: number): string | null {
  if (game.step !== "turn" || game.turnPlayerId !== playerId || game.pending || game.resolving || game.queue.length || game.after.length) return "NOT_NOW";
  if (game.phase !== "main") return "NOT_NOW";
  const owner = find(players, playerId);
  const card = locate(owner, uid)?.card;
  if (!card) return "CARD_NOT_ON_FIELD";
  const ability = abilitiesOf(ctx, card.cardId)[index];
  if (!ability || ability.kind !== "activated") return "NO_SUCH_ABILITY";
  if (ability.oncePerTurn && card.used?.includes(index)) return "ONCE_PER_TURN";
  const env = abilityEnv(game, players, ctx, playerId, uid, card.cardId);
  if (!holds(ability.condition, env)) return "ABILITY_CONDITION";
  for (const cost of ability.costs) {
    if (cost.pay === "restSelf" && card.rested) return "ABILITY_COST";
    if (cost.pay === "discard" && owner.hand.length < cost.count) return "ABILITY_COST";
    if (cost.pay === "ap" && owner.ap.filter((entry) => !entry.rested).length < cost.count) return "ABILITY_COST";
    if (cost.pay === "sidelineSelf" && flagsOf(card).includes("cannotSideline")) return "ABILITY_COST";
  }
  return null;
}

/** Uses an Activate: Main ability: pays its costs (discards are chosen as its first step), then resolves it. */
function activateAbility(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, actor: EnginePlayer, uid: string, index: number): void {
  const issue = activationIssue(game, players, ctx, actor.accountId, uid, index);
  if (issue) fail(issue);
  const card = locate(actor, uid)!.card;
  const ability = abilitiesOf(ctx, card.cardId)[index] as ActivatedAbility;
  if (ability.oncePerTurn) card.used = [...(card.used ?? []), index];
  log(game, `${actor.username} 发动「${nameOf(ctx, card.cardId)}」的【启动主要】`);
  game.seq += 1;
  const entry: QueuedAbility = { id: game.seq, ownerId: actor.accountId, cardId: card.cardId, ability: index, selfUid: uid };
  for (const cost of ability.costs) {
    if (cost.pay === "restSelf") card.rested = true;
    else if (cost.pay === "ap") payAp(actor, cost.count);
    else if (cost.pay === "sidelineSelf") { sidelineCard(game, ctx, actor, uid, { kind: "effect", byPlayerId: actor.accountId, cost: true }); entry.selfUid = null; }
  }
  game.resolving = { entry, pc: 0, vars: {} };
  // 当我方场上的某张卡牌的【启动主要】效果发动时: the cards on the activator's field hear it (after the activated ability itself resolves), `cause.sourceCardId` is the activated card.
  for (const heard of [...actor.front, ...actor.energy]) queueAbilities(game, ctx, "onOwnActivateMain", actor, heard, heard.cardId, { kind: "effect", byPlayerId: actor.accountId, sourceCardId: card.cardId });
}

/** Applies one action by `actorId`, then resolves the card abilities it set off. Throws an error code when the action is not allowed now. */
export function applyAction(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, actorId: string, action: UnionArenaAction): void {
  game.queue = game.queue ?? [];
  game.after = game.after ?? [];
  game.resolving = game.resolving ?? null;
  applyActionCore(game, players, ctx, actorId, action);
  drain(game, players, ctx);
}

function applyActionCore(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, actorId: string, action: UnionArenaAction): void {
  if (game.step === "over") fail("GAME_OVER");
  if (game.step !== "turn") fail("NOT_YOUR_TURN");
  if (!action || typeof action !== "object") fail("INVALID_ACTION");
  const actor = find(players, actorId);
  const opponent = other(players, actorId);
  // These two are always open to both players: concede, and the manual operations used to apply printed abilities at any timing.
  if (action.type === "concede") { gameOver(game, opponent, `${actor.username} 认输`); return; }
  if (action.type === "manual") { applyManual(game, players, ctx, actor, action.manual); return; }

  const pending = game.pending;
  if (pending) {
    if (pending.playerId !== actorId) fail("WAITING_FOR_OPPONENT");
    switch (action.type) {
      case "choose": {
        if (pending.kind !== "choose") fail("NOT_NOW");
        answer(game, players, ctx, pending, action.picks);
        return;
      }
      case "block": {
        if (pending.kind !== "block") fail("NOT_NOW");
        game.pending = null;
        if (action.blockerUid === null) {
          // 对方必须尽可能的阻挡此角色的攻击 ("mustBeBlocked"): not blocking is refused while a character could block.
          const mustBlock = locate(opponent, pending.attackerUid)?.card;
          if (mustBlock && mustBeBlocked(ctx, mustBlock, actor)) { game.pending = pending; fail("MUST_BLOCK"); }
          log(game, `${actor.username} 不阻挡`);
          game.after.push({ kind: "unblocked", attackerOwnerId: opponent.accountId, attackerUid: pending.attackerUid });
          return;
        }
        const blocker = actor.front.find((card) => card.uid === action.blockerUid);
        const blocked = locate(opponent, pending.attackerUid)?.card;
        if (!blocker || !blocked || !canBlock(ctx, blocked, blocker)) { game.pending = pending; fail("INVALID_BLOCKER"); }
        blocker.rested = true;
        blocker.blocks += 1;
        if (blocker.blocks === 1 && hasKeyword(ctx, blocker, "2次阻挡")) blocker.rested = false;
        log(game, `${actor.username} 以「${nameOf(ctx, blocker.cardId)}」阻挡`);
        game.after.push({ kind: "battle", attackerOwnerId: opponent.accountId, attackerUid: pending.attackerUid, defenderOwnerId: actor.accountId, defenderUid: blocker.uid, blocked: true });
        emitSelf(game, ctx, "onBlock", actor, blocker);
        return;
      }
      case "damage": {
        if (pending.kind !== "damage") fail("NOT_NOW");
        const defender = find(players, pending.defenderId);
        const ids = action.lifeIds;
        if (!Array.isArray(ids) || ids.length !== pending.amount || new Set(ids).size !== ids.length) fail("INVALID_LIFE_CHOICE");
        const chosen = ids.map((id) => defender.life.find((slot) => slot.id === id) ?? fail("INVALID_LIFE_CHOICE"));
        defender.life = defender.life.filter((slot) => !ids.includes(slot.id));
        for (const slot of chosen) slot.faceUp = true;
        log(game, `${defender.username} 受到 ${chosen.length} 点伤害，翻开生命卡：${chosen.map((slot) => `「${nameOf(ctx, slot.cardId)}」`).join("")}`);
        // 对方无法发动《激活》触发 ("noActiveTrigger" on the character that dealt the damage).
        const dealer = locate(actor, pending.attackerUid)?.card;
        game.pending = { kind: "triggers", playerId: defender.accountId, attackerId: actorId, revealed: chosen, ...(dealer && flagsOf(dealer).includes("noActiveTrigger") ? { activeBlocked: true } : {}) };
        return;
      }
      case "trigger": {
        if (pending.kind !== "triggers") fail("NOT_NOW");
        let triggerAction = action;
        const slot = pending.revealed.find((entry) => entry.id === action.lifeId) ?? fail("INVALID_LIFE_CHOICE");
        const attacker = find(players, pending.attackerId);
        if (triggerAction.activate && pending.activeBlocked && ctx.card(slot.cardId)?.trigger?.label === "激活") {
          log(game, `「${nameOf(ctx, slot.cardId)}」的《激活》触发无法发动（对方角色的效果）`);
          triggerAction = { ...triggerAction, activate: false, targetUid: undefined };
        }
        // 我方将要发动……的场合，可以改为……: the owner is asked first when a card on their field offers to replace this trigger.
        if (triggerAction.activate && triggerSwapOffers(game, players, ctx, actor, slot).length) {
          const label = ctx.card(slot.cardId)?.trigger;
          const targets = label ? triggerTargets(ctx, actor, attacker, label) : null;
          if (targets && triggerAction.targetUid && !targets.some((card) => card.uid === triggerAction.targetUid)) fail("TRIGGER_TARGET_INVALID");
          if (targets && !triggerAction.targetUid && targets.length) fail("TRIGGER_TARGET_REQUIRED");
          game.triggerSwap = { ownerId: actor.accountId, attackerId: pending.attackerId, lifeId: slot.id, action: triggerAction, revealed: [...pending.revealed], declined: [], asking: null };
          askTriggerSwap(game, players, ctx);
          return;
        }
        completeTrigger(game, players, ctx, actor, attacker, pending, slot, triggerAction);
        return;
      }
      case "discard": {
        if (pending.kind !== "discard") fail("NOT_NOW");
        const keep = action.keep;
        if (!Array.isArray(keep) || keep.length !== HAND_LIMIT || new Set(keep).size !== keep.length || keep.some((index) => !Number.isInteger(index) || index < 0 || index >= actor.hand.length)) fail("INVALID_DISCARD");
        const removed = actor.hand.filter((_, index) => !keep.includes(index));
        actor.hand = actor.hand.filter((_, index) => keep.includes(index));
        actor.removal.push(...removed);
        log(game, `${actor.username} 手牌超过 ${HAND_LIMIT} 张，将 ${removed.length} 张置于移除区`);
        game.pending = null;
        finishTurn(game, players);
        return;
      }
      default:
        fail("NOT_NOW");
    }
  }

  if (game.turnPlayerId !== actorId) fail("NOT_YOUR_TURN");
  if (game.resolving || game.queue.length || game.after.length) fail("NOT_NOW");
  switch (action.type) {
    case "next_phase": {
      if (game.phase === "attack") { if (mustStillAttack(ctx, actor)) fail("MUST_ATTACK"); endTurn(game, players, ctx); return; }
      if (game.phase === "movement") { enterMain(game, ctx, actor); return; }
      if (game.phase === "main") emitAll(game, ctx, "onMainEnd", actor);
      const next: Partial<Record<UnionArenaTurnPhase, UnionArenaTurnPhase>> = { start: "movement", main: "attack" };
      const phase = next[game.phase] ?? fail("NOT_NOW");
      const fromMain = game.phase === "main";
      game.phase = phase;
      log(game, `${actor.username} 进入${PHASE_NAME[phase]}`);
      if (fromMain) game.after.push({ kind: "attackPhaseStart" });
      return;
    }
    case "extra_draw":
      if (game.phase !== "start" || game.extraDrawUsed) fail("NOT_NOW");
      if (!actor.library.length) fail("DECK_EMPTY");
      payAp(actor, 1);
      draw(actor);
      game.extraDrawUsed = true;
      log(game, `${actor.username} 支付 1 AP 额外抽 1 张卡`);
      return;
    case "move":
      if (game.phase !== "movement") fail("NOT_NOW");
      move(game, ctx, actor, action.toFront, action.toEnergy, action.remove);
      enterMain(game, ctx, actor);
      return;
    case "play": {
      if (game.phase !== "main") fail("NOT_NOW");
      const cardId = handCard(actor, action.handIndex);
      const stats = statsOf(ctx, cardId);
      if (stats.type === "event") fail("USE_EVENT_INSTEAD");
      if (action.line !== "front" && action.line !== "energy") fail("INVALID_LINE");
      if (stats.type === "site" && action.line !== "energy") fail("SITE_ENERGY_LINE_ONLY");
      if (action.line === "front" && energyLineOnly(ctx, cardId, actor)) fail("ENERGY_LINE_ONLY");
      if (playOnlyByAbility(ctx, cardId)) fail("PLAY_ONLY_BY_ABILITY");
      if (!playConditionHolds(game, players, ctx, actorId, cardId)) fail("PLAY_CONDITION");
      if (actor[action.line].length >= LINE_LIMIT && !actor[action.line].some((card) => card.uid === action.remove)) fail("LINE_FULL");
      const ap = costOf(game, players, ctx, actorId, cardId).ap;
      requireCost(game, players, ctx, actor, cardId, true);
      takeFromHand(actor, action.handIndex);
      // 下一张将要从手牌使用的……以活跃状态登场
      const nextPlay = nextPlayFor(game, ctx, actorId, cardId);
      if (nextPlay) nextPlay.spent = true;
      const lowBp = nextPlayLowBpFor(game, ctx, actorId, cardId);
      if (lowBp) lowBp.spent = true;
      const cheap = nextPlayCheapFor(game, ctx, actorId, cardId);
      if (cheap) cheap.spent = true;
      spendNextUseExcept(game, ctx, actorId, cardId);
      (game.turnMarks ??= []).push(`${game.turn}:${actorId}:cardUsed:${cardId}`);
      const card = newFieldCard(game, actor, cardId, !nextPlay?.active);
      placeOnLine(game, ctx, actor, action.line, card, action.remove);
      logEvent(game, `${actor.username} 支付 ${ap} AP，将「${stats.name}」以${card.rested ? "休息" : "活跃"}状态登场到${LINE_NAME[action.line]}`, card.uid, "play");
      emitSelf(game, ctx, "onPlay", actor, card);
      return;
    }
    case "raid": {
      if (game.phase !== "main") fail("NOT_NOW");
      const cardId = handCard(actor, action.handIndex);
      const stats = statsOf(ctx, cardId);
      if (!stats.raid) fail("NO_RAID");
      const target = locate(actor, action.targetUid)?.card;
      if (!target || !raidTargetMatches(ctx, stats, target)) fail("RAID_TARGET_INVALID");
      if (action.toFront && locate(actor, action.targetUid)!.line === "energy" && actor.front.length >= LINE_LIMIT && !actor.front.some((card) => card.uid === action.remove)) fail("LINE_FULL");
      const ap = costOf(game, players, ctx, actorId, cardId, true).ap;
      requireCost(game, players, ctx, actor, cardId, true, true);
      takeFromHand(actor, action.handIndex);
      spendNextUseExcept(game, ctx, actorId, cardId);
      (game.turnMarks ??= []).push(`${game.turn}:${actorId}:cardUsed:${cardId}`);
      log(game, `${actor.username} 支付 ${ap} AP`);
      performRaid(game, ctx, actor, cardId, action.targetUid, action.toFront === true, action.remove);
      return;
    }
    case "event": {
      if (game.phase !== "main") fail("NOT_NOW");
      const cardId = handCard(actor, action.handIndex);
      const stats = statsOf(ctx, cardId);
      if (stats.type !== "event") fail("NOT_AN_EVENT");
      if (!eventUsable(game, players, ctx, actorId, cardId)) fail("EVENT_CONDITION");
      const ap = costOf(game, players, ctx, actorId, cardId).ap;
      requireCost(game, players, ctx, actor, cardId, true);
      takeFromHand(actor, action.handIndex);
      // "If you have used an event card this turn": remembered as a turn mark (see `usedEventThisTurn` in abilities/dsl.ts).
      game.turnMarks = [...(game.turnMarks ?? []), `${game.turn}:${actorId}:eventUsed`, `${game.turn}:${actorId}:cardUsed:${cardId}`];
      spendNextUseExcept(game, ctx, actorId, cardId);
      const index = abilitiesOf(ctx, cardId).findIndex((ability) => ability.kind === "triggered" && ability.when.includes("onUse"));
      if (index < 0) {
        actor.sideline.push(cardId);
        log(game, `${actor.username} 支付 ${ap} AP 使用事件「${stats.name}」，结算后置于场外`);
        return;
      }
      log(game, `${actor.username} 支付 ${ap} AP 使用事件「${stats.name}」`);
      game.after.push({ kind: "eventDone", ownerId: actorId, cardId });
      game.seq += 1;
      const entry: QueuedAbility = { id: game.seq, ownerId: actorId, cardId, ability: index, selfUid: null };
      const ability = abilitiesOf(ctx, cardId)[index] as TriggeredAbility;
      const env = abilityEnv(game, players, ctx, actorId, null, cardId);
      if (holds(ability.condition, env)) game.resolving = { entry, pc: 0, vars: {} };
      return;
    }
    case "activate":
      activateAbility(game, players, ctx, actor, action.uid, action.ability);
      return;
    case "attack": {
      if (game.phase !== "attack") fail("NOT_NOW");
      // 此角色可以从能量线攻击 ("attackFromEnergyLine" mark, AOT Pieck Finger 056): an energy-line character with the mark may attack too.
      const attacker = actor.front.find((card) => card.uid === action.attackerUid) ?? actor.energy.find((card) => card.uid === action.attackerUid && flagsOf(card).includes("attackFromEnergyLine")) ?? fail("INVALID_ATTACKER");
      if (attacker.rested || ctx.card(attacker.cardId)?.type !== "character" || flagsOf(attacker).includes("cannotAttack")) fail("INVALID_ATTACKER");
      let sniped: UnionArenaFieldCard | null = null;
      if (action.targetUid) {
        if (!hasKeyword(ctx, attacker, "瞄准攻击")) fail("SNIPE_REQUIRED");
        sniped = opponent.front.find((card) => card.uid === action.targetUid) ?? fail("INVALID_TARGET");
        // 不会被【瞄准攻击】指定 ("unsnipeable")
        if (flagsOf(sniped).includes("unsnipeable")) fail("INVALID_TARGET");
      }
      attacker.rested = true;
      attacker.attacks += 1;
      if (attacker.attacks === 1 && hasKeyword(ctx, attacker, "2次攻击")) attacker.rested = false;
      if (sniped) log(game, `${actor.username} 以「${nameOf(ctx, attacker.cardId)}」瞄准攻击「${nameOf(ctx, sniped.cardId)}」，对手不能阻挡`);
      else log(game, `${actor.username} 以「${nameOf(ctx, attacker.cardId)}」攻击 ${opponent.username}`);
      game.after.push({ kind: "attackEnd", attackerOwnerId: actorId, attackerUid: attacker.uid });
      game.after.push({ kind: "afterAttackDeclared", attackerOwnerId: actorId, attackerUid: attacker.uid, targetUid: sniped?.uid ?? null });
      emitSelf(game, ctx, "onAttack", actor, attacker);
      // 当我方的某张角色攻击时: the other cards on the attacker's field hear it, with the attacker's card in `cause.attackerCardId`.
      for (const card of [...actor.front, ...actor.energy]) queueAbilities(game, ctx, "onOwnAttack", actor, card, card.cardId, { kind: "effect", byPlayerId: actorId, attackerCardId: attacker.cardId });
      return;
    }
    case "end_turn":
      if (game.phase !== "main" && game.phase !== "attack") fail("NOT_NOW");
      if (mustStillAttack(ctx, actor)) fail("MUST_ATTACK");
      if (game.phase === "main") {
        // The main phase ends (its abilities resolve), the attack phase passes with no attack, then the end phase.
        emitAll(game, ctx, "onMainEnd", actor);
        game.phase = "attack";
        game.after.push({ kind: "endTurnNow" });
        game.after.push({ kind: "attackPhaseStart" });
        return;
      }
      endTurn(game, players, ctx);
      return;
    default:
      fail("NOT_NOW");
  }
}

/** Whether these picks would be accepted for the current choice (used by the computer players to skip combinations a rule forbids). */
export function choiceAllowed(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, picks: string[]): boolean {
  const resolving = game.resolving;
  const ability = resolving ? abilityOfEntry(ctx, resolving.entry) : undefined;
  const step = ability && resolving ? programOf(ability)[resolving.pc] : undefined;
  if (step?.do !== "choose" || !step.check) return true;
  const env = entryEnv(game, players, ctx, resolving!.entry, resolving!.vars);
  return step.check(env, picks.map((pick) => zoneCard(env, pick) ?? locateAny(players, pick)?.card.cardId ?? ""));
}

/** Answers a card ability's choice and moves its program on. */
function answer(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, choice: UnionArenaChoice, picks: string[]): void {
  if (!Array.isArray(picks) || new Set(picks).size !== picks.length || picks.some((pick) => !choice.options.includes(pick))) fail("INVALID_CHOICE");
  if (picks.length < choice.min || picks.length > choice.max) fail("INVALID_CHOICE");
  game.pending = null;
  if (game.replacing?.[0]?.asking) { answerReplacement(game, players, ctx, picks[0] === "yes"); return; }
  if (game.triggerSwap?.asking) { answerTriggerSwap(game, players, ctx, picks[0] === "yes"); return; }
  if (choice.purpose === "order") {
    const id = Number(picks[0]!.slice(2));
    const entry = game.queue.find((queued) => queued.id === id) ?? fail("INVALID_CHOICE");
    game.queue = game.queue.filter((queued) => queued !== entry);
    beginResolving(game, players, ctx, entry);
    return;
  }
  const resolving = game.resolving ?? fail("INVALID_CHOICE");
  const ability = abilityOfEntry(ctx, resolving.entry);
  const step = ability ? programOf(ability)[resolving.pc] : undefined;
  if (step?.do === "confirm") resolving.pc = picks[0] === "yes" ? resolving.pc + 1 : step.to;
  else if (step?.do === "choose" || step?.do === "room") {
    if (step.do === "choose" && step.check) {
      const env = entryEnv(game, players, ctx, resolving.entry, resolving.vars);
      if (!step.check(env, picks.map((pick) => zoneCard(env, pick) ?? locateAny(players, pick)?.card.cardId ?? ""))) { game.pending = choice; fail("INVALID_CHOICE"); }
    }
    if (step.do === "choose" && step.from === "field" && !step.chooser && !payTargetTax(game, players, ctx, resolving.entry, picks)) { game.pending = choice; fail("INVALID_CHOICE"); }
    resolving.vars[step.as] = picks;
    resolving.pc += 1;
  } else fail("INVALID_CHOICE");
}

export function boardView(player: EnginePlayer | undefined): UnionArenaBoard {
  const copy = (card: UnionArenaFieldCard): UnionArenaFieldCard => ({ ...card, under: [...card.under], grants: [...card.grants], staticKeywords: [...(card.staticKeywords ?? [])], lasting: [...(card.lasting ?? [])], used: [...(card.used ?? [])], ...(card.faceDown ? { faceDown: card.faceDown.map(() => "") } : {}) });
  return {
    ap: (player?.ap ?? []).map((card) => ({ ...card })),
    front: (player?.front ?? []).map(copy),
    energy: (player?.energy ?? []).map(copy),
    sideline: [...(player?.sideline ?? [])],
    removal: [...(player?.removal ?? [])]
  };
}

/** The pending decision as `viewerId` sees it. Revealed life cards are face up; the cards behind another player's hand options are hidden. */
export function pendingView(game: EngineGame, viewerId?: string): UnionArenaPending | null {
  const pending = game.pending;
  if (!pending) return null;
  if (pending.kind === "triggers") return { kind: "triggers", playerId: pending.playerId, attackerId: pending.attackerId, revealed: pending.revealed.map((slot) => ({ id: slot.id, cardId: slot.cardId })) };
  if (pending.kind === "damage") return { kind: "damage", playerId: pending.playerId, defenderId: pending.defenderId, amount: pending.amount };
  if (pending.kind === "choose") return { ...pending, options: [...pending.options], cards: pending.cards.map((cardId, index) => (viewerId !== pending.playerId && /^[hl]:/.test(pending.options[index]!) ? null : cardId)) };
  return { ...pending };
}

/** What a trigger needs from its owner: a field character, a sideline card, or nothing. Used by the clients to ask the right question. */
export function triggerNeeds(ctx: EngineContext, owner: FieldLines & Pick<EnginePlayer, "sideline">, attacker: FieldLines, cardId: string, hand: readonly string[] = []): { targets: string[]; sideline: number[]; hand: number[]; raidTargets: string[] } {
  const stats = ctx.card(cardId);
  const trigger = stats?.trigger;
  if (!stats || !trigger) return { targets: [], sideline: [], hand: [], raidTargets: [] };
  return {
    targets: (triggerTargets(ctx, owner, attacker, trigger) ?? []).map((card) => card.uid),
    sideline: trigger.label === "色彩" && !trigger.text.includes("手牌") ? sidelinePlayTargets(ctx, owner, trigger.text) : [],
    hand: trigger.label === "色彩" ? handPlayTargets(ctx, hand, trigger.text) : [],
    raidTargets: trigger.label === "突进" && energyOf(ctx, owner, stats.color) >= stats.energyCost ? [...owner.front, ...owner.energy].filter((card) => raidTargetMatches(ctx, stats, card)).map((card) => card.uid) : []
  };
}

/** What a client may see of a life area: order and count always, the card identity only once it is face up. */
export function lifeView(player: EnginePlayer | undefined): UnionArenaLifeCard[] {
  return (player?.life ?? []).map((slot) => ({ id: slot.id, cardId: slot.faceUp ? slot.cardId : null }));
}

/** The public game state for one player: hands and decks of both players only as counts. */
export function gameStateView(game: EngineGame, player: EnginePlayer, opponent: EnginePlayer | undefined, ctx?: EngineContext): UnionArenaGameState {
  const players = opponent ? [player, opponent] : [player];
  return {
    step: game.step,
    firstPlayerId: game.firstPlayerId,
    turnPlayerId: game.turnPlayerId,
    turn: game.turn,
    mulliganPlayerId: game.mulliganQueue[0] ?? null,
    handCount: { you: player.hand.length, opponent: opponent?.hand.length ?? 0 },
    deckCount: { you: player.library.length, opponent: opponent?.library.length ?? 0 },
    phase: game.step === "mulligan" ? null : game.phase,
    extraDrawUsed: game.extraDrawUsed,
    board: { you: boardView(player), opponent: boardView(opponent) },
    pending: pendingView(game, player.accountId),
    winnerId: game.winnerId,
    endReason: game.endReason,
    log: [...game.log],
    events: [...game.events],
    handCosts: player.hand.map((cardId) => {
      const stats = ctx?.card(cardId);
      if (!ctx || !stats || !opponent || game.step === "mulligan") return { energy: stats?.energyCost ?? 0, ap: stats?.apCost ?? 0 };
      return costOf(game, players, ctx, player.accountId, cardId);
    })
  };
}

// ---- For card abilities written as code ({ do: "run" }) ----

/** Queues a field card's own abilities for an event about it (e.g. a move to the other line done by an effect). */
export function queueCardEvent(game: EngineGame, ctx: EngineContext, event: AbilityEvent, owner: EnginePlayer, card: UnionArenaFieldCard): void {
  emitSelf(game, ctx, event, owner, card);
}

/** A player whose life area an effect has emptied loses (as after damage). */
export function loseIfNoLife(game: EngineGame, players: readonly EnginePlayer[], player: EnginePlayer): void {
  if (!player.life.length && game.step !== "over") gameOver(game, other(players, player.accountId), `${player.username} 的生命区没有卡牌了`);
}

/** 退场 by an effect of `byPlayerId` (for abilities written as code): replacement effects and 【退场时】 abilities apply as usual. */
export function sidelineByEffect(game: EngineGame, ctx: EngineContext, owner: EnginePlayer, uid: string, byPlayerId: string): void {
  sidelineCard(game, ctx, owner, uid, { kind: "effect", byPlayerId });
}

/** 进行突进 by an effect: the card (already taken out of its zone) goes on top of the target, as a Raid from the hand does. */
export function raidByEffect(game: EngineGame, ctx: EngineContext, player: EnginePlayer, cardId: string, targetUid: string, toFront: boolean, removeUid: string | undefined): void {
  performRaid(game, ctx, player, cardId, targetUid, toFront, removeUid);
}

/** The turn mark ("<turn>:<owner>:characterSidelined") left when one of `ownerId`'s characters is sidelined this turn. */
export const characterSidelinedMark = (game: EngineGame, ownerId: string): string => `${game.turn}:${ownerId}:characterSidelined`;
/** 本回合中 `ownerId` 的角色退场过 (battle, BP 0 or less, an effect, a cost or a manual operation; a character leaving any other way does not count). */
export const characterSidelinedThisTurn = (game: EngineGame, ownerId: string): boolean => (game.turnMarks ?? []).includes(characterSidelinedMark(game, ownerId));
/** How many characters of `ownerId` were sidelined this turn (the same moments as `characterSidelinedThisTurn`, once per character). */
export const characterSidelinedCountThisTurn = (game: EngineGame, ownerId: string): number => (game.turnMarks ?? []).filter((mark) => mark === `${game.turn}:${ownerId}:characterSidelinedN`).length;

/** The turn mark left when any character is sidelined this turn by BP 0 or less or by an effect (not a cost). */
export const bpOrEffectSidelinedMark = (game: EngineGame): string => `${game.turn}:bpOrEffectSidelined`;
/** 本回合中有角色因BP变为0或因效果退场 (either player's; JJK 漏瑚). */
export const characterSidelinedByBpOrEffectThisTurn = (game: EngineGame): boolean => (game.turnMarks ?? []).includes(bpOrEffectSidelinedMark(game));
/** The turn mark left when cards of `ownerId`'s hand or deck are put into their sideline by their own effect. */
export const handDeckSidelinedMark = (game: EngineGame, ownerId: string): string => `${game.turn}:${ownerId}:handDeckSidelined`;
/** 本回合中有我方的手牌或卡组中的卡牌通过我方的效果置于过场外 (a discard or mill by an effect's steps; JJK 伏黑 惠 023). */
export const handDeckSidelinedThisTurn = (game: EngineGame, ownerId: string): boolean => (game.turnMarks ?? []).includes(handDeckSidelinedMark(game, ownerId));
function markHandDeckSidelined(game: EngineGame, ownerId: string): void {
  const mark = handDeckSidelinedMark(game, ownerId);
  if (!(game.turnMarks ??= []).includes(mark)) game.turnMarks.push(mark);
}
