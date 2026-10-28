/**
 * Small builders and conditions for writing card abilities (cards.ts) close to how the card text reads. Example:
 *   onPlay(chooseOwn("target", { max: 1, filter: energyCostAtMost(2) }), bp({ chosen: "target" }, 2000))
 * is "【登场时】选择我方场上的最多1张所需能量不高于2的角色，本回合中，BP+2000。"
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, flagsOf as katanaFlagsOf, queueCardEvent as katanaQueueCardEvent, type EnginePlayer } from "../engine.ts";
import type { AbilityEnv, AbilityEvent, ActivatedAbility, Condition, Cost, CostAbility, Duration, StaticAbility, Step, Target, TriggeredAbility } from "./types.ts";

// ---- Triggered and activated abilities ----

export const when = (events: AbilityEvent[], ...steps: Step[]): TriggeredAbility => ({ kind: "triggered", when: events, steps });
export const onPlay = (...steps: Step[]): TriggeredAbility => when(["onPlay"], ...steps);
export const onSidelined = (...steps: Step[]): TriggeredAbility => when(["onSidelined"], ...steps);
export const onAttack = (...steps: Step[]): TriggeredAbility => when(["onAttack"], ...steps);
export const onBlock = (...steps: Step[]): TriggeredAbility => when(["onBlock"], ...steps);
/** An event card's text. */
export const onUse = (...steps: Step[]): TriggeredAbility => when(["onUse"], ...steps);
/** Adds a "……的场合" condition (checked when it resolves) or 每回合1次 to a triggered ability. */
export const withCondition = (ability: TriggeredAbility, condition: Condition): TriggeredAbility => ({ ...ability, condition });
export const oncePerTurn = <T extends TriggeredAbility | ActivatedAbility>(ability: T): T => ({ ...ability, oncePerTurn: true });

export function activateMain(options: { costs?: Cost[]; condition?: Condition; once?: boolean }, ...steps: Step[]): ActivatedAbility {
  return { kind: "activated", costs: options.costs ?? [], condition: options.condition, oncePerTurn: options.once, steps };
}
export const restSelf: Cost = { pay: "restSelf" };
export const sidelineSelf: Cost = { pay: "sidelineSelf" };
export const discardCost = (count: number): Cost => ({ pay: "discard", count });
export const apCost = (count: number): Cost => ({ pay: "ap", count });

// ---- Continuous abilities and cost changes ----

export const staticSelf = (effect: Omit<StaticAbility, "kind" | "affects">, condition?: Condition): StaticAbility => ({ kind: "static", condition, ...effect });
export const staticAura = (affects: StaticAbility["affects"], effect: Omit<StaticAbility, "kind" | "affects">, condition?: Condition): StaticAbility => ({ kind: "static", condition, affects, ...effect });
export const costChange = (change: Omit<CostAbility, "kind" | "condition">, condition?: Condition): CostAbility => ({ kind: "cost", condition, ...change });

// ---- Steps ----

type ChooseOptions = { min?: number; max?: number; line?: "front" | "energy"; filter?: (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean; prompt?: string };

/** 选择我方场上的…角色 (`good`: the effect helps the chosen card). */
export function chooseOwn(as: string, options: ChooseOptions = {}): Step {
  return { do: "choose", as, from: "field", side: "you", line: options.line, filter: options.filter, min: options.min ?? 0, max: options.max ?? 1, prompt: options.prompt ?? `选择我方${options.line === "front" ? "前线" : options.line === "energy" ? "能量线" : "场上"}的角色`, good: true };
}
/** 选择对方前线/场上的…角色 (the effect harms it). */
export function chooseOpponent(as: string, options: ChooseOptions = {}): Step {
  return { do: "choose", as, from: "field", side: "opponent", line: options.line, filter: options.filter, min: options.min ?? 0, max: options.max ?? 1, prompt: options.prompt ?? `选择对方${options.line === "front" ? "前线" : options.line === "energy" ? "能量线" : "场上"}的角色`, good: false };
}
export function chooseFromSideline(as: string, options: ChooseOptions = {}): Step {
  return { do: "choose", as, from: "sideline", side: "you", filter: options.filter, min: options.min ?? 0, max: options.max ?? 1, prompt: options.prompt ?? "选择我方场外的卡牌", good: true };
}

export const bp = (target: Target, amount: number | ((env: AbilityEnv) => number), until: Duration = "turn"): Step => ({ do: "bp", target, amount, until });
export const grant = (target: Target, keyword: string, until: Duration = "turn"): Step => ({ do: "keyword", target, keyword, until });
export const rest = (target: Target): Step => ({ do: "rest", target });
export const activate = (target: Target): Step => ({ do: "activate", target });
export const sideline = (target: Target): Step => ({ do: "sideline", target });
export const toHand = (target: Target): Step => ({ do: "toHand", target });
export const remove = (target: Target): Step => ({ do: "remove", target });
export const draw = (count = 1): Step => ({ do: "draw", count });
export const discard = (count = 1): Step => ({ do: "discard", count });
export const moveChosen = (chosen: string | string[], to: "hand" | "sideline" | "removal" | "deckBottom"): Step => ({ do: "moveChosen", chosen, to });
export const may = (prompt: string, ...steps: Step[]): Step => ({ do: "may", prompt, steps });
export const ifThen = (test: Condition, steps: Step[], otherwise?: Step[]): Step => ({ do: "if", test, steps, else: otherwise });
export const chosen = (name: string): Target => ({ chosen: name });

// ---- Targets computed from the game ----

const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
/** 我方前线中的所有其他角色 */
export const otherOwnFront = (env: AbilityEnv): UnionArenaFieldCard[] => env.owner.front.filter((card) => isCharacter(env, card) && card.uid !== env.self?.uid);

// ---- Conditions and filters ----

export const duringYourTurn: Condition = (env) => env.game.turnPlayerId === env.owner.accountId;
export const duringOpponentTurn: Condition = (env) => env.game.turnPlayerId === env.opponent.accountId;
export const selfOnFront: Condition = (env) => !!env.self && env.owner.front.includes(env.self);
export const selfOnEnergy: Condition = (env) => !!env.self && env.owner.energy.includes(env.self);
export const selfActive: Condition = (env) => !!env.self && !env.self.rested;
export const all = (...conditions: Condition[]): Condition => (env) => conditions.every((condition) => condition(env));
/** 对方的场上存在N张或更多休息状态的角色 */
export const opponentRestedAtLeast = (count: number): Condition => (env) => fieldOf(env.opponent).filter((card) => card.rested && isCharacter(env, card)).length >= count;
/** 我方的场上存在〈name〉 */
export const youHaveNamed = (name: string): Condition => (env) => fieldOf(env.owner).some((card) => env.ctx.card(card.cardId)?.name === name);
/** 我方的前线中存在原本的BP为N的（其他）角色 */
export const frontHasPrintedBp = (bpValue: number, excludeSelf = false): Condition => (env) =>
  env.owner.front.some((card) => (!excludeSelf || card.uid !== env.self?.uid) && env.ctx.card(card.cardId)?.bp === bpValue);
/** Counts our field characters whose printed BP is `bpValue`. */
export const countPrintedBp = (env: AbilityEnv, bpValue: number): number => fieldOf(env.owner).filter((card) => isCharacter(env, card) && env.ctx.card(card.cardId)?.bp === bpValue).length;

export const energyCostAtMost = (limit: number) => (env: AbilityEnv, cardId: string): boolean => (env.ctx.card(cardId)?.energyCost ?? 99) <= limit;
export const notSelf = (env: AbilityEnv, _cardId: string, card: UnionArenaFieldCard | null): boolean => card?.uid !== env.self?.uid;
/** BP不高于N (N may depend on the game). */
export const bpAtMost = (limit: number | ((env: AbilityEnv) => number)) => (env: AbilityEnv, _cardId: string, card: UnionArenaFieldCard | null): boolean => {
  if (!card) return false;
  return bpOf(env.ctx, card) <= (typeof limit === "function" ? limit(env) : limit) + bpRangeBonus(env);
};

// ---- Looking at the deck, putting cards onto the field, moving, marks ----

/** 确认我方卡组最上方的N张卡牌 */
export const look = (count: number): Step => ({ do: "look", count });
/** 剩余的卡牌自选顺序置于我方卡组的最下方 */
export const lookedToBottom = (): Step => ({ do: "lookedToBottom" });
/** 公开其中最多N张…并加入手牌 */
export function chooseLooked(as: string, options: ChooseOptions & { check?: (env: AbilityEnv, cardIds: string[]) => boolean; exclude?: string } = {}): Step {
  return { do: "choose", as, from: "looked", side: "you", filter: options.filter, check: options.check, exclude: options.exclude, min: options.min ?? 0, max: options.max ?? 1, prompt: options.prompt ?? "选择要公开并加入手牌的卡", good: true };
}
export function chooseFromHand(as: string, options: ChooseOptions = {}): Step {
  return { do: "choose", as, from: "hand", side: "you", filter: options.filter, min: options.min ?? 0, max: options.max ?? 1, prompt: options.prompt ?? "选择手牌", good: true };
}
/** 从下列选择1项 */
export const chooseMode = (as: string, modes: string[]): Step => ({ do: "choose", as, from: "mode", side: "you", modes, min: 1, max: 1, prompt: "从下列选择 1 项", good: true });
/** 选择我方的最多N张AP卡牌 */
export const chooseAp = (as: string, max: number): Step => ({ do: "choose", as, from: "ap", side: "you", min: 0, max, prompt: `选择我方最多 ${max} 张 AP 卡`, good: true });
export const activateAp = (chosenName: string): Step => ({ do: "activateAp", chosen: chosenName });
/** 在我方的场上（前线 / 能量线）以休息/活跃状态登场 */
export const put = (chosenName: string, line: "choose" | "front" | "energy", rested: boolean, activeOnEnergy = false): Step => ({ do: "put", chosen: chosenName, line, rested, activeOnEnergy });
/** 将此角色移动至其他线 */
export const moveLine = (target: Target): Step => ({ do: "moveLine", target });
/** 本回合产生能量+N */
export const energyThisTurn = (target: Target, amount: number): Step => ({ do: "energy", target, amount });
export const flag = (target: Target, mark: string, until: Duration = "turn"): Step => ({ do: "flag", target, flag: mark, until });
export const grantAbility = (target: Target, ability: number): Step => ({ do: "grantAbility", target, ability });
/** An ability that only works on cards it is given to (grantAbility). */
export const givenOnly = (ability: TriggeredAbility): TriggeredAbility => ({ ...ability, grantedOnly: true });
export const run = (text: string, fn: (env: AbilityEnv) => void): Step => ({ do: "run", text, fn });

// ---- More conditions and filters ----

const statsOf = (env: AbilityEnv, cardId: string) => env.ctx.card(cardId);
export const chosenCount = (name: string, count = 1): Condition => (env) => (env.vars[name] ?? []).length >= count;
export const noneChosen = (name: string): Condition => (env) => (env.vars[name] ?? []).length === 0;
export const opponentFrontHasCharacters: Condition = (env) => env.opponent.front.some((card) => isCharacter(env, card));
export const selfRested: Condition = (env) => !!env.self && env.self.rested;
export const youHaveKeywordCharacter = (keyword: string): Condition => (env) => fieldOf(env.owner).some((card) => isCharacter(env, card) && hasKeywordNow(env, card, keyword));
export const ownFieldEmpty: Condition = (env) => fieldOf(env.owner).length === 0;
/** 对方的场上存在 colour 卡牌 */
export const opponentHasColor = (...colors: string[]): Condition => (env) => fieldOf(env.opponent).some((card) => colors.includes(statsOf(env, card.cardId)?.color ?? ""));
/** Sidelined because its BP fell to 0 or less, or by an effect of the opponent. */
export const sidelinedByBpOrOpponent: Condition = (env) => env.cause?.kind === "bpZero" || (env.cause?.kind === "effect" && env.cause.byPlayerId === env.opponent.accountId);

export const hasKeywordNow = (env: AbilityEnv, card: UnionArenaFieldCard, keyword: string): boolean =>
  [...(statsOf(env, card.cardId)?.keywords ?? []), ...card.grants, ...(card.staticKeywords ?? []), ...(card.lasting ?? []).flatMap((entry) => (entry.keyword ? [entry.keyword] : []))].includes(keyword);

/** Card filters for choose steps (they see the card id, and the field card when there is one). */
type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
export const and = (...filters: CardFilter[]): CardFilter => (env, cardId, card) => filters.every((filter) => filter(env, cardId, card));
export const printedBp = (value: number): CardFilter => (env, cardId) => statsOf(env, cardId)?.bp === value;
export const isCharacterCard: CardFilter = (env, cardId) => statsOf(env, cardId)?.type === "character";
export const ofColor = (color: string): CardFilter => (env, cardId) => statsOf(env, cardId)?.color === color;
export const apCostIs = (value: number): CardFilter => (env, cardId) => statsOf(env, cardId)?.apCost === value;
export const named = (name: string): CardFilter => (env, cardId) => statsOf(env, cardId)?.name === name;
export const notNamed = (name: string): CardFilter => (env, cardId) => statsOf(env, cardId)?.name !== name;
export const withAffinity = (affinity: string): CardFilter => (env, cardId) => statsOf(env, cardId)?.affinities.includes(affinity) ?? false;
export const withKeyword = (keyword: string): CardFilter => (env, cardId, card) => (card ? hasKeywordNow(env, card, keyword) : statsOf(env, cardId)?.keywords.includes(keyword) ?? false);
export const either = (...filters: CardFilter[]): CardFilter => (env, cardId, card) => filters.some((filter) => filter(env, cardId, card));
export const activeCard: CardFilter = (_env, _cardId, card) => !!card && !card.rested;

// ---- Paying AP as an effect, and "this turn" facts (AOT) ----

/** Our AP area holds at least `count` active AP cards. */
export const hasActiveApCount = (count = 1): Condition => (env) => env.owner.ap.filter((card) => !card.rested).length >= count;
/** 支付N AP (as part of an effect): switches active AP cards to resting. In the attack phase it is remembered (see `apPaidInAttackPhaseThisTurn`). */
export const payApEffect = (count = 1): Step => run(`支付 ${count} AP`, (env) => {
  for (const card of env.owner.ap.filter((entry) => !entry.rested).slice(0, count)) card.rested = true;
  if (env.game.phase === "attack") env.game.turnMarks = [...(env.game.turnMarks ?? []), `${env.game.turn}:${env.owner.accountId}:apPaidInAttack`];
});
/** "可以支付N AP。这样做的场合，……": offered only while the AP can be paid; the steps run after the payment. */
export const mayPayApEffect = (prompt: string, count: number, ...steps: Step[]): Step => ifThen(hasActiveApCount(count), [may(prompt, payApEffect(count), ...steps)]);
/** 我方在本回合的攻击阶段中支付过AP费用 (only AP paid by effects that use `payApEffect` is counted). */
export const apPaidInAttackPhaseThisTurn: Condition = (env) => (env.game.turnMarks ?? []).includes(`${env.game.turn}:${env.owner.accountId}:apPaidInAttack`);
/** 我方在本回合中使用过事件卡牌 (the engine records every event used from the hand). */
export const usedEventThisTurn: Condition = (env) => (env.game.turnMarks ?? []).includes(`${env.game.turn}:${env.owner.accountId}:eventUsed`);

// ---- "The next BP range you choose this turn is raised" (AOT Armin Arlelt 077) and "used a [X] affinity card this turn" ----

/** Mark kept in `game.turnMarks` by an effect "the next time you choose a character with an ability that specifies a BP range this turn, add N to the range". */
export const bpRangePlusMark = (env: AbilityEnv): string => `${env.game.turn}:${env.owner.accountId}:bpRangePlus`;
/** What `bpAtMost` adds to the limit now: 1000 for every pending mark. The first choose step to look at it uses it up (engine: `choose` step, `__bpRange`). */
export const bpRangeBonus = (env: AbilityEnv): number => {
  const pending = (env.game.turnMarks ?? []).filter((mark) => mark === bpRangePlusMark(env)).length;
  if (pending) env.vars.__bpRange = ["1"];
  return pending * 1000;
};
/** 本回合中，下一次选择“指定BP范围”的角色时，指定的BP范围+1000 (works with every choose step that filters with `bpAtMost`). */
export const raiseNextBpRange: Step = run("本回合中，下一次选择指定BP范围的角色时，BP范围+1000", (env) => { env.game.turnMarks = [...(env.game.turnMarks ?? []), bpRangePlusMark(env)]; });
/** 我方在本回合中使用过[affinity]的卡牌 (a card played, Raided or used as an event from the hand; the engine records each as a turn mark). */
export const usedAffinityThisTurn = (affinity: string): Condition => (env) => {
  const prefix = `${env.game.turn}:${env.owner.accountId}:cardUsed:`;
  return (env.game.turnMarks ?? []).some((mark) => mark.startsWith(prefix) && (env.ctx.card(mark.slice(prefix.length))?.affinities ?? []).includes(affinity));
};

// ---- AOT batch 7: "the next [Food] card you use", cards that returned to the hand in the attack phase ----

/** 本回合中，下一张将要从手牌中使用的 [affinity] 卡牌的消费AP-N (played, Raided or used as an event; the engine spends the entry on that use). */
export const nextUseAffinityApCut = (affinity: string, ap = 1): Step =>
  run(`本回合中，下一张使用的 [${affinity}] 卡牌消费 AP-${ap}`, (env) => {
    env.game.nextUseAffinity = [...(env.game.nextUseAffinity ?? []), { turn: env.game.turn, ownerId: env.owner.accountId, affinity, ap, spent: false }];
  });
/** 本回合的攻击阶段中，我方场上符合条件的卡牌放回过手牌 (the engine records every card number returned from the field to the hand during an attack phase as a turn mark). */
export const returnedToHandInAttackPhase = (filter: (env: AbilityEnv, cardId: string) => boolean): Condition => (env) => {
  const prefix = `${env.game.turn}:${env.owner.accountId}:returnedInAttack:`;
  return (env.game.turnMarks ?? []).some((mark) => mark.startsWith(prefix) && filter(env, mark.slice(prefix.length)));
};

// ---- KMY: “特征：日轮刀”的效果选择 (a character chosen by an effect of a 日轮刀 card) ----

/** Turn flag (cleared at the end of the turn) on a character that a “特征：日轮刀” effect chose this turn. */
export const KATANA_CHOSEN_FLAG = "katanaChosen";
/**
 * 被我方的“特征：日轮刀”的效果选择: marks the cards chosen under `name` (own field cards) with `KATANA_CHOSEN_FLAG` for the rest of the turn and
 * queues their "onChosenByKatana" abilities (一回合1次 reactions of the chosen card; use `oncePerTurn(when(["onChosenByKatana"], ...))`).
 */
export const markChosenByKatana = (name: string): Step => run("被“特征：日轮刀”的效果选择", (env) => {
  for (const uid of env.vars[name] ?? []) {
    const card = [...env.owner.front, ...env.owner.energy].find((entry) => entry.uid === uid);
    if (!card) continue;
    if (!katanaFlagsOf(card).includes(KATANA_CHOSEN_FLAG)) card.flags = [...(card.flags ?? []), KATANA_CHOSEN_FLAG];
    katanaQueueCardEvent(env.game, env.ctx, "onChosenByKatana", env.owner, card);
  }
});
/** 本回合中此角色被我方的“特征：日轮刀”的效果选择的场合 (`env.self`). */
export const selfChosenByKatanaThisTurn: Condition = (env) => !!env.self && katanaFlagsOf(env.self).includes(KATANA_CHOSEN_FLAG);
/** 无法通过此效果选择本回合中已被“特征：日轮刀”的效果选择过的角色 (a choose filter). */
export const notChosenByKatanaThisTurn = (_env: AbilityEnv, _cardId: string, card: UnionArenaFieldCard | null): boolean => !card || !katanaFlagsOf(card).includes(KATANA_CHOSEN_FLAG);
/** 本回合中已被“特征：日轮刀”的效果选择过的角色 (a choose filter). */
export const chosenByKatanaThisTurn = (_env: AbilityEnv, _cardId: string, card: UnionArenaFieldCard | null): boolean => !!card && katanaFlagsOf(card).includes(KATANA_CHOSEN_FLAG);

// ---- EVA batch 3: "the next 〈name〉 / character whose name contains … you use this turn costs less" ----

/**
 * 本回合中，下一张将要从手牌中使用的〈names〉或卡牌名包含“nameParts”的角色卡牌的所需能量减少[colour×energy]，消费AP-ap
 * (played or Raided; the engine spends the entry on that use, see `game.nextUseNamed`). The energy cut only applies to a card of `color`.
 */
export const nextUseNamedCut = (options: { names: string[]; nameParts: string[]; color: string; energy: number; ap: number }): Step =>
  run(`本回合中，下一张使用的${options.names.map((name) => `〈${name}〉`).join("或")}或卡牌名包含“${options.nameParts.join("”“")}”的角色卡牌所需能量-${options.energy}，消费 AP-${options.ap}`, (env) => {
    env.game.nextUseNamed = [...(env.game.nextUseNamed ?? []), { turn: env.game.turn, ownerId: env.owner.accountId, ...options, spent: false }];
  });
