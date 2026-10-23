/**
 * The rules engine for a running game, from the first turn to the end, following the official rule manual (Ver 1.1): turn phases, AP,
 * required energy, playing characters / sites / events, Raid, movement, attacks, blocks, battles, damage, trigger checks, the end phase and
 * both ways to win. It has no Node or browser dependencies, so the server runs it for online games and the client runs it for the tutorial.
 *
 * What the engine automates: everything the rule manual defines, the keyword abilities a card always has (printed at the start of an ability
 * line) and the seven printed trigger types. A card's own ability text (When Played, Activate: Main, conditional keywords, cost changes...)
 * is not interpreted; the players apply it with the manual operations, and every manual operation is written to the public log.
 *
 * All functions mutate the game and player objects they are given and throw an `Error` whose message is an error code on an illegal move.
 */
import type {
  UnionArenaAction,
  UnionArenaApCard,
  UnionArenaBoard,
  UnionArenaCardStats,
  UnionArenaFieldCard,
  UnionArenaGameState,
  UnionArenaGameStep,
  UnionArenaLifeCard,
  UnionArenaManualOp,
  UnionArenaPending,
  UnionArenaTurnPhase
} from "./protocol.ts";

/** Cards per line (front line, energy line). */
export const LINE_LIMIT = 4;
/** Hand size kept at the end of the turn. */
export const HAND_LIMIT = 8;
const LOG_LIMIT = 40;
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
  | { kind: "triggers"; playerId: string; attackerId: string; revealed: LifeSlot[] }
  | { kind: "discard"; playerId: string };

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
  /** Counter for field card ids. */
  seq: number;
}

/** The two lines of a player's field; a client's board view has the same shape. */
type FieldLines = Pick<EnginePlayer, "front" | "energy">;

export interface EngineContext {
  /** Printed data and name of a card, or null when unknown. */
  card(cardId: string): (UnionArenaCardStats & { name: string }) | null;
}

export function newEngineGame(firstPlayerId: string, mulliganQueue: string[]): EngineGame {
  return { step: "mulligan", firstPlayerId, turnPlayerId: null, turn: 0, mulliganQueue, phase: "start", turnsTaken: {}, extraDrawUsed: false, pending: null, winnerId: null, endReason: null, log: [], seq: 0 };
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
  game.log.push(text);
  if (game.log.length > LOG_LIMIT) game.log.splice(0, game.log.length - LOG_LIMIT);
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

function statsOf(ctx: EngineContext, cardId: string): UnionArenaCardStats & { name: string } {
  return ctx.card(cardId) ?? fail("CARD_DATA_MISSING");
}

/** A keyword ability the field card has now: always (printed) or given until the end of the turn. */
function keywordsOf(ctx: EngineContext, card: UnionArenaFieldCard): string[] {
  return [...(ctx.card(card.cardId)?.keywords ?? []), ...card.grants];
}

export function hasKeyword(ctx: EngineContext, card: UnionArenaFieldCard, keyword: string): boolean {
  return keywordsOf(ctx, card).includes(keyword);
}

export function bpOf(ctx: EngineContext, card: UnionArenaFieldCard): number {
  return (ctx.card(card.cardId)?.bp ?? 0) + card.bpMod;
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

/** Energy of one colour generated by the energy line. Front-line cards generate nothing; resting cards still do. */
export function energyOf(ctx: EngineContext, player: Pick<EnginePlayer, "energy">, color: string): number {
  return player.energy.reduce((sum, card) => {
    const stats = ctx.card(card.cardId);
    const generated = stats?.energyGenColor ?? stats?.color;
    return generated === color ? sum + Math.max(0, (stats?.energyGen ?? 0) + card.energyMod) : sum;
  }, 0);
}

/** AP cards the AP area must hold at the start of a player's nth turn (rule manual, Start Phase step 3). */
export function apTarget(game: EngineGame, playerId: string): number {
  const nth = game.turnsTaken[playerId] ?? 0;
  if (nth <= 1) return playerId === game.firstPlayerId ? 1 : 2;
  return nth === 2 ? 2 : 3;
}

function newFieldCard(game: EngineGame, owner: EnginePlayer, cardId: string, rested: boolean): UnionArenaFieldCard {
  game.seq += 1;
  return { uid: `${owner.accountId}:f${game.seq}`, cardId, under: [], rested, bpMod: 0, energyMod: 0, grants: [], attacks: 0, blocks: 0, skipNextActivate: false };
}

function locate(player: EnginePlayer, uid: string): { line: "front" | "energy"; card: UnionArenaFieldCard } | null {
  const front = player.front.find((card) => card.uid === uid);
  if (front) return { line: "front", card: front };
  const energy = player.energy.find((card) => card.uid === uid);
  return energy ? { line: "energy", card: energy } : null;
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
  player.sideline.push(...found.card.under);
  if (destination === "sideline") player.sideline.push(found.card.cardId);
  else if (destination === "removal") player.removal.push(found.card.cardId);
  else if (destination === "hand") player.hand.push(found.card.cardId);
  else player.library.push(found.card.cardId);
  return found.card;
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

function requireEnergy(ctx: EngineContext, player: EnginePlayer, stats: UnionArenaCardStats): void {
  if (energyOf(ctx, player, stats.color) < stats.energyCost) fail("NOT_ENOUGH_ENERGY");
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
  log(game, `对局结束：${winner.username} 获胜（${reason}）`);
}

/**
 * Start Phase, steps 1 to 4: switch every resting card (characters, sites, AP cards) to active, bring the AP area up to the table's count
 * (new AP cards are placed active), then draw a card (Player One skips this on the first turn). A player who must draw from an empty deck loses.
 * Step 5, the optional extra draw, waits for the player.
 */
function beginTurn(game: EngineGame, players: readonly EnginePlayer[], playerId: string): void {
  const player = find(players, playerId);
  game.turnPlayerId = playerId;
  game.phase = "start";
  game.extraDrawUsed = false;
  game.pending = null;
  game.turnsTaken[playerId] = (game.turnsTaken[playerId] ?? 0) + 1;
  log(game, `第 ${game.turn} 回合：${player.username} 的回合开始`);
  for (const card of [...player.front, ...player.energy]) makeActive(card);
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
  for (const player of players) clearBoard(player);
  beginTurn(game, players, game.firstPlayerId);
}

/** End Phase: switch resting characters and sites to active (AP cards stay resting), then keep at most eight cards in hand. */
function endTurn(game: EngineGame, players: readonly EnginePlayer[]): void {
  const player = find(players, game.turnPlayerId!);
  game.phase = "end";
  log(game, `${player.username} 进入结束阶段`);
  for (const card of [...player.front, ...player.energy]) makeActive(card);
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
    return affinity ? stats.affinities.includes(affinity[1]!) : stats.name === spec;
  });
}

/**
 * Raid: the card goes on top of the target, which switches to active (abilities that applied to the card underneath stop applying) and
 * may move from the energy line to the front line.
 */
function performRaid(game: EngineGame, ctx: EngineContext, player: EnginePlayer, cardId: string, targetUid: string, toFront: boolean, removeUid: string | undefined): void {
  const stats = statsOf(ctx, cardId);
  const found = locate(player, targetUid) ?? fail("RAID_TARGET_INVALID");
  if (!raidTargetMatches(ctx, stats, found.card)) fail("RAID_TARGET_INVALID");
  const target = found.card;
  const below = nameOf(ctx, target.cardId);
  target.under = [...target.under, target.cardId];
  target.cardId = cardId;
  target.bpMod = 0;
  target.grants = [];
  target.energyMod = 0;
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
  }
  for (const uid of toEnergy) {
    const card = player.front.find((entry) => entry.uid === uid) ?? fail("INVALID_MOVE");
    if (!hasKeyword(ctx, card, "撤步")) fail("STEP_REQUIRED");
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
  for (const card of forward) log(game, `${player.username} 将「${nameOf(ctx, card.cardId)}」从能量线移动至前线`);
  for (const card of back) log(game, `${player.username} 将「${nameOf(ctx, card.cardId)}」从前线移动至能量线（撤步）`);
}

/** Battle: the attacker wins on equal or higher BP. The loser is sidelined only when it is the attacked character. */
function battle(game: EngineGame, ctx: EngineContext, attackerOwner: EnginePlayer, attackerUid: string, defenderOwner: EnginePlayer, defenderUid: string): void {
  const attacker = locate(attackerOwner, attackerUid)?.card;
  const defender = locate(defenderOwner, defenderUid)?.card;
  if (!attacker || !defender) { game.pending = null; return; }
  const attackBp = bpOf(ctx, attacker);
  const defendBp = bpOf(ctx, defender);
  if (attackBp >= defendBp) {
    leaveField(defenderOwner, defenderUid, "sideline");
    log(game, `战斗：「${nameOf(ctx, attacker.cardId)}」(${attackBp}) 胜过「${nameOf(ctx, defender.cardId)}」(${defendBp})，后者退场`);
    const impact = hasKeyword(ctx, defender, "冲击无效") ? 0 : impactOf(ctx, attacker);
    if (impact > 0) {
      log(game, `「${nameOf(ctx, attacker.cardId)}」的冲击给予 ${defenderOwner.username} ${impact} 点伤害`);
      startDamage(game, attackerOwner, defenderOwner, impact, attackerUid);
      return;
    }
  } else {
    log(game, `战斗：「${nameOf(ctx, attacker.cardId)}」(${attackBp}) 不敌「${nameOf(ctx, defender.cardId)}」(${defendBp})，攻击角色不退场`);
  }
  game.pending = null;
}

/** The player dealing damage picks one life card per point; with no life left there is nothing to pick. */
function startDamage(game: EngineGame, attacker: EnginePlayer, defender: EnginePlayer, amount: number, attackerUid: string): void {
  const count = Math.min(amount, defender.life.length);
  game.pending = count > 0 ? { kind: "damage", playerId: attacker.accountId, defenderId: defender.accountId, amount: count, attackerUid } : null;
}

/** The triggers that need a chosen character, and which characters may be chosen. */
function triggerTargets(ctx: EngineContext, owner: FieldLines, attacker: FieldLines, trigger: { label: string; text: string }): UnionArenaFieldCard[] | null {
  const isCharacter = (card: UnionArenaFieldCard): boolean => ctx.card(card.cardId)?.type === "character";
  if (trigger.label === "激活") return [...owner.front, ...owner.energy].filter(isCharacter);
  if (trigger.label === "特殊") return attacker.front.filter(isCharacter);
  if (trigger.label === "色彩") {
    const limit = trigger.text.match(/BP不高于(\d+)的角色/);
    if (limit) return attacker.front.filter((card) => isCharacter(card) && bpOf(ctx, card) <= Number(limit[1]));
    if (trigger.text.includes("转为休息状态")) return attacker.front.filter(isCharacter);
  }
  return null;
}

/** Cards in the sideline a "play it from your sideline" colour trigger may choose. */
function sidelinePlayTargets(ctx: EngineContext, owner: Pick<EnginePlayer, "sideline">, text: string): number[] {
  const rule = text.match(/所需能量不高于(\d+)且消费AP(\d+)的(.)色角色/);
  if (!rule) return [];
  const colors: Readonly<Record<string, string>> = { 黄: "yellow", 红: "red", 蓝: "blue", 紫: "purple", 绿: "green" };
  return owner.sideline.flatMap((cardId, index) => {
    const stats = ctx.card(cardId);
    return stats && stats.type === "character" && stats.energyCost <= Number(rule[1]) && stats.apCost === Number(rule[2]) && stats.color === colors[rule[3]!] ? [index] : [];
  });
}

/**
 * Resolves one revealed life card. If it has a trigger and its owner activates it, the printed trigger runs; then the card goes to the
 * sideline (unless the trigger put it into the hand or onto the field).
 */
function resolveTrigger(game: EngineGame, ctx: EngineContext, owner: EnginePlayer, attacker: EnginePlayer, slot: LifeSlot, action: Extract<UnionArenaAction, { type: "trigger" }>): void {
  const stats = ctx.card(slot.cardId);
  const trigger = stats?.trigger ?? null;
  const name = nameOf(ctx, slot.cardId);
  if (!trigger || !action.activate) {
    owner.sideline.push(slot.cardId);
    log(game, trigger ? `${owner.username} 未发动「${name}」的触发` : `「${name}」没有触发`);
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
        requireEnergy(ctx, owner, stats!);
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
      if (target) {
        leaveField(attacker, target.uid, "sideline");
        log(game, `${prefix}：「${nameOf(ctx, target.cardId)}」退场`);
      } else log(game, `${prefix}：对方前线没有角色`);
      break;
    case "色彩":
      if (trigger.text.includes("场外") && trigger.text.includes("登场")) {
        const choices = sidelinePlayTargets(ctx, owner, trigger.text);
        if (choices.length) {
          const index = action.sidelineIndex;
          if (index === undefined || !choices.includes(index)) fail("TRIGGER_TARGET_REQUIRED");
          const cardId = owner.sideline.splice(index, 1)[0]!;
          placeOnLine(game, ctx, owner, "front", newFieldCard(game, owner, cardId, false), action.remove);
          log(game, `${prefix}：从场外将「${nameOf(ctx, cardId)}」以活跃状态登场到前线`);
        } else log(game, `${prefix}：场外没有符合条件的角色`);
      } else if (!target) {
        log(game, `${prefix}：没有符合条件的角色`);
      } else if (trigger.text.includes("退场")) {
        leaveField(attacker, target.uid, "sideline");
        log(game, `${prefix}：「${nameOf(ctx, target.cardId)}」退场`);
      } else if (trigger.text.includes("放回手牌")) {
        leaveField(attacker, target.uid, "hand");
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
  if (destination === "sideline") owner.sideline.push(slot.cardId);
  else if (destination === "hand") owner.hand.push(slot.cardId);
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
        case "sideline": case "hand": case "removal": leaveField(owner, card.uid, manual.act); break;
        default: fail("INVALID_MANUAL");
      }
      const text: Readonly<Record<string, string>> = { rest: "转为休息状态", activate: "转为活跃状态", "bp+": "本回合 BP+1000", "bp-": "本回合 BP-1000", "energy+": "能量产出 +1", "energy-": "能量产出 -1", sideline: "退场", hand: "放回手牌", removal: "置于移除区" };
      log(game, `${who}（卡牌效果）${whose}「${name}」${text[manual.act]}`);
      // "When BP Becomes Zero or Less": a character reduced to 0 BP or less by an ability is sidelined.
      if (manual.act === "bp-" && ctx.card(card.cardId)?.type === "character" && bpOf(ctx, card) <= 0) {
        leaveField(owner, card.uid, "sideline");
        log(game, `「${name}」BP 降至 0 或更低，退场`);
      }
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

/** Applies one action by `actorId`. Throws an error code when the action is not allowed now. */
export function applyAction(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, actorId: string, action: UnionArenaAction): void {
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
      case "block": {
        if (pending.kind !== "block") fail("NOT_NOW");
        const attackerOwner = opponent;
        if (action.blockerUid === null) {
          const attacker = locate(attackerOwner, pending.attackerUid)?.card;
          log(game, `${actor.username} 不阻挡`);
          if (!attacker) { game.pending = null; return; }
          startDamage(game, attackerOwner, actor, damageOf(ctx, attacker), attacker.uid);
          return;
        }
        const blocker = actor.front.find((card) => card.uid === action.blockerUid) ?? fail("INVALID_BLOCKER");
        if (blocker.rested || ctx.card(blocker.cardId)?.type !== "character") fail("INVALID_BLOCKER");
        blocker.rested = true;
        blocker.blocks += 1;
        if (blocker.blocks === 1 && hasKeyword(ctx, blocker, "2次阻挡")) blocker.rested = false;
        log(game, `${actor.username} 以「${nameOf(ctx, blocker.cardId)}」阻挡`);
        battle(game, ctx, attackerOwner, pending.attackerUid, actor, blocker.uid);
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
        game.pending = { kind: "triggers", playerId: defender.accountId, attackerId: actorId, revealed: chosen };
        return;
      }
      case "trigger": {
        if (pending.kind !== "triggers") fail("NOT_NOW");
        const slot = pending.revealed.find((entry) => entry.id === action.lifeId) ?? fail("INVALID_LIFE_CHOICE");
        const attacker = find(players, pending.attackerId);
        resolveTrigger(game, ctx, actor, attacker, slot, action);
        pending.revealed = pending.revealed.filter((entry) => entry.id !== slot.id);
        if (pending.revealed.length) return;
        game.pending = null;
        if (!actor.life.length) gameOver(game, attacker, `${actor.username} 的生命区没有卡牌了`);
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
        finishTurn(game, players);
        return;
      }
      default:
        fail("NOT_NOW");
    }
  }

  if (game.turnPlayerId !== actorId) fail("NOT_YOUR_TURN");
  switch (action.type) {
    case "next_phase": {
      const next: Partial<Record<UnionArenaTurnPhase, UnionArenaTurnPhase>> = { start: "movement", movement: "main", main: "attack" };
      if (game.phase === "attack") { endTurn(game, players); return; }
      const phase = next[game.phase] ?? fail("NOT_NOW");
      game.phase = phase;
      log(game, `${actor.username} 进入${PHASE_NAME[phase]}`);
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
      game.phase = "main";
      log(game, `${actor.username} 进入主要阶段`);
      return;
    case "play": {
      if (game.phase !== "main") fail("NOT_NOW");
      const cardId = handCard(actor, action.handIndex);
      const stats = statsOf(ctx, cardId);
      if (stats.type === "event") fail("USE_EVENT_INSTEAD");
      if (action.line !== "front" && action.line !== "energy") fail("INVALID_LINE");
      if (stats.type === "site" && action.line !== "energy") fail("SITE_ENERGY_LINE_ONLY");
      if (actor[action.line].length >= LINE_LIMIT && !actor[action.line].some((card) => card.uid === action.remove)) fail("LINE_FULL");
      requireEnergy(ctx, actor, stats);
      payAp(actor, stats.apCost);
      takeFromHand(actor, action.handIndex);
      placeOnLine(game, ctx, actor, action.line, newFieldCard(game, actor, cardId, true), action.remove);
      log(game, `${actor.username} 支付 ${stats.apCost} AP，将「${stats.name}」以休息状态登场到${LINE_NAME[action.line]}`);
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
      requireEnergy(ctx, actor, stats);
      payAp(actor, stats.apCost);
      takeFromHand(actor, action.handIndex);
      log(game, `${actor.username} 支付 ${stats.apCost} AP`);
      performRaid(game, ctx, actor, cardId, action.targetUid, action.toFront === true, action.remove);
      return;
    }
    case "event": {
      if (game.phase !== "main") fail("NOT_NOW");
      const cardId = handCard(actor, action.handIndex);
      const stats = statsOf(ctx, cardId);
      if (stats.type !== "event") fail("NOT_AN_EVENT");
      requireEnergy(ctx, actor, stats);
      payAp(actor, stats.apCost);
      takeFromHand(actor, action.handIndex);
      actor.sideline.push(cardId);
      log(game, `${actor.username} 支付 ${stats.apCost} AP 使用事件「${stats.name}」，结算后置于场外`);
      return;
    }
    case "attack": {
      if (game.phase !== "attack") fail("NOT_NOW");
      const attacker = actor.front.find((card) => card.uid === action.attackerUid) ?? fail("INVALID_ATTACKER");
      if (attacker.rested || ctx.card(attacker.cardId)?.type !== "character") fail("INVALID_ATTACKER");
      let sniped: UnionArenaFieldCard | null = null;
      if (action.targetUid) {
        if (!hasKeyword(ctx, attacker, "瞄准攻击")) fail("SNIPE_REQUIRED");
        sniped = opponent.front.find((card) => card.uid === action.targetUid) ?? fail("INVALID_TARGET");
      }
      attacker.rested = true;
      attacker.attacks += 1;
      if (attacker.attacks === 1 && hasKeyword(ctx, attacker, "2次攻击")) attacker.rested = false;
      if (sniped) {
        log(game, `${actor.username} 以「${nameOf(ctx, attacker.cardId)}」瞄准攻击「${nameOf(ctx, sniped.cardId)}」，对手不能阻挡`);
        battle(game, ctx, actor, attacker.uid, opponent, sniped.uid);
        return;
      }
      log(game, `${actor.username} 以「${nameOf(ctx, attacker.cardId)}」攻击 ${opponent.username}`);
      if (opponent.front.some((card) => !card.rested && ctx.card(card.cardId)?.type === "character")) {
        game.pending = { kind: "block", playerId: opponent.accountId, attackerUid: attacker.uid };
        return;
      }
      startDamage(game, actor, opponent, damageOf(ctx, attacker), attacker.uid);
      return;
    }
    case "end_turn":
      if (game.phase !== "main" && game.phase !== "attack") fail("NOT_NOW");
      endTurn(game, players);
      return;
    default:
      fail("NOT_NOW");
  }
}

export function boardView(player: EnginePlayer | undefined): UnionArenaBoard {
  const copy = (card: UnionArenaFieldCard): UnionArenaFieldCard => ({ ...card, under: [...card.under], grants: [...card.grants] });
  return {
    ap: (player?.ap ?? []).map((card) => ({ ...card })),
    front: (player?.front ?? []).map(copy),
    energy: (player?.energy ?? []).map(copy),
    sideline: [...(player?.sideline ?? [])],
    removal: [...(player?.removal ?? [])]
  };
}

/** The pending decision as clients see it. Revealed life cards are face up, so their identity is public. */
export function pendingView(game: EngineGame): UnionArenaPending | null {
  const pending = game.pending;
  if (!pending) return null;
  if (pending.kind === "triggers") return { kind: "triggers", playerId: pending.playerId, attackerId: pending.attackerId, revealed: pending.revealed.map((slot) => ({ id: slot.id, cardId: slot.cardId })) };
  if (pending.kind === "damage") return { kind: "damage", playerId: pending.playerId, defenderId: pending.defenderId, amount: pending.amount };
  return { ...pending };
}

/** What a trigger needs from its owner: a field character, a sideline card, or nothing. Used by the clients to ask the right question. */
export function triggerNeeds(ctx: EngineContext, owner: FieldLines & Pick<EnginePlayer, "sideline">, attacker: FieldLines, cardId: string): { targets: string[]; sideline: number[]; raidTargets: string[] } {
  const stats = ctx.card(cardId);
  const trigger = stats?.trigger;
  if (!stats || !trigger) return { targets: [], sideline: [], raidTargets: [] };
  return {
    targets: (triggerTargets(ctx, owner, attacker, trigger) ?? []).map((card) => card.uid),
    sideline: trigger.label === "色彩" ? sidelinePlayTargets(ctx, owner, trigger.text) : [],
    raidTargets: trigger.label === "突进" && energyOf(ctx, owner, stats.color) >= stats.energyCost ? [...owner.front, ...owner.energy].filter((card) => raidTargetMatches(ctx, stats, card)).map((card) => card.uid) : []
  };
}

/** What a client may see of a life area: order and count always, the card identity only once it is face up. */
export function lifeView(player: EnginePlayer | undefined): UnionArenaLifeCard[] {
  return (player?.life ?? []).map((slot) => ({ id: slot.id, cardId: slot.faceUp ? slot.cardId : null }));
}

/** The public game state for one player: hands and decks of both players only as counts. */
export function gameStateView(game: EngineGame, player: EnginePlayer, opponent: EnginePlayer | undefined): UnionArenaGameState {
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
    pending: pendingView(game),
    winnerId: game.winnerId,
    endReason: game.endReason,
    log: [...game.log]
  };
}
