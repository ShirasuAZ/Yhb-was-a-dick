/**
 * The shape of a card's own abilities, as data the rules engine runs. Each card number maps to a list of `Ability` (see cards.ts); the
 * builders in dsl.ts keep those entries short. Conditions, filters and amounts are functions of an `AbilityEnv`, so they can read the
 * whole game, but the engine only ever stores plain data (which ability, which step, what was chosen), so a game can still be copied.
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import type { EngineContext, EngineGame, EnginePlayer } from "../engine.ts";

/** Moments a triggered ability can activate at. Self events are about the ability's own card; the others are about its owner. */
export type AbilityEvent =
  | "onPlay" // 【登场时】: put onto the field (played, Raid, or by an effect)
  | "onSidelined" // 【退场时】: sidelined (battle, BP 0 or less, an effect saying 退场)
  | "onAttack" // 【攻击时】
  | "onAttackUnblocked" // 当此角色进行攻击且没有被阻挡时
  | "onBlock" // 【阻挡时】
  | "onWinBattle" // 当此角色在进行攻击的战斗中胜利时
  | "onAttackEnd" // 当此角色的攻击结束时
  | "onMoveToFront" // 当此角色从能量线移动至前线时
  | "onMoveToEnergy" // 当此角色从前线移动至能量线时
  | "onMainStart" // 当我方的主要阶段开始时 (cards on the owner's field)
  | "onMainEnd" // 当主要阶段结束时 (cards on the turn player's field)
  | "onEndStart" // 当我方的结束阶段开始时 (cards on the owner's field)
  | "onAttackPhaseEnd" // 当攻击阶段结束时 (cards on the turn player's field; also when the turn ends from the main phase)
  | "onWinBlock" // 当此角色在进行阻挡的战斗中胜利时
  | "onTakeDamage" // 当我方一次受到2点或更多的伤害的场合 (front-line cards of the damaged player; for replacing the damage)
  | "onReturnToHand" // 当此角色从场上放回手牌时 (like 【退场时】, the card has already left the field)
  | "onLeaveField" // 当此角色离开场上时: sidelined, or put into the hand / removal area / deck by an effect (the card has already left; see `cause`)
  | "onEnterSideline" // 当此卡牌置于场外时: the card has arrived in its owner's sideline from anywhere (field, hand, deck, life area)
  | "onOwnAttack" // 当我方场上的某张角色攻击时: every card on the attacker's field hears it; `env.cause.attackerCardId` is the attacking card
  | "onEveryAttackPhaseEnd" // 每个攻击阶段结束时: cards on both players' fields hear it (also the opponent's attack phase)
  | "onAttackStart" // 当攻击阶段开始时 (cards on the turn player's field, and abilities given to them; after the main phase's own abilities resolved)
  | "onLoseAttackBattle" // 当此角色在进行攻击的战斗中败北时 (the attacker's BP was lower; it is not sidelined by the battle itself)
  | "onOpponentFrontSidelined" // 对方前线中的角色退场时: every card on the OTHER player's field hears it (any cause; the card has already left)
  | "onOwnActivateMain" // 当我方场上的某张卡牌的【启动主要】效果发动时: every card on the activator's field hears it; `env.cause.sourceCardId` is the activated card
  | "onEndStartInHand" // 我方的结束阶段开始时，手牌中的此卡牌 (cards in the turn player's hand; no field card, so `env.self` is null)
  | "onChosenByKatana" // 当此角色被我方的“特征：日轮刀”的效果选择时 (KMY; queued by `markChosenByKatana` in dsl.ts, heard by the chosen card only)
  | "onOwnMoveInAttack" // 攻击阶段中当我方场上的角色移动时 (KMY): every card on the turn player's field hears each move made in the attack phase; `env.cause.attackerCardId` is the card that moved
  | "onOwnLifeToSideline" // 当卡牌从我方的生命区中置于场外时 (EVA 式波 087): every card on the life owner's field hears it; `env.cause.sourceCardId` is the life card (check its trigger with `heardIf`)
  | "onBeingRaided" // 当此角色被突进时 (EVA 式波 113): heard by the card that was raided (now under the Raid card, so `env.self` is null; `env.owner` is its owner)
  | "onUse"; // an event card's text, when the event is used

/**
 * Why a card was sidelined: a battle, BP 0 or less, an effect (and whose), or a manual operation. Also given to 【登场时】 abilities of a card put
 * onto the field by an ability (kind "effect", with `sourceCardId`), and to "onLeaveField". `under`: the cards that were under a sidelined
 * Raid card (its 突进源).
 */
export interface SidelineCause {
  kind: "battle" | "bpZero" | "effect" | "manual"; byPlayerId: string | null; sourceCardId?: string; under?: string[];
  /** For "onOwnAttack": the card that attacked. */
  attackerCardId?: string;
  /** Face-down cards that were under it (now in the sideline). */
  faceDown?: string[];
  /** Sidelined to pay a cost (〔将此卡牌退场〕): replacement effects do not apply. */
  cost?: boolean;
  /** For a 【登场时】 ability of a card put onto the field by another ability: where it was put from ("hand", "sideline" or the cards being looked at, "deck"). */
  from?: "hand" | "sideline" | "deck";
}

/** What an ability's conditions and effects can see. `self` is the card on the field; null for an event, or a card that has left the field. */
export interface AbilityEnv {
  game: EngineGame;
  players: readonly EnginePlayer[];
  ctx: EngineContext;
  owner: EnginePlayer;
  opponent: EnginePlayer;
  self: UnionArenaFieldCard | null;
  selfCardId: string;
  /** Things chosen by earlier steps, by name: field card uids, "h:<index>" / "s:<index>" / "l:<index>" for hand, sideline and looked-at
   *  cards, "ap:<id>" for AP cards, "m:<index>" for modes, "line:front" / "line:energy". */
  vars: Record<string, string[]>;
  /** For 【退场时】 abilities: why the card was sidelined. */
  cause: SidelineCause | null;
}

export type Condition = (env: AbilityEnv) => boolean;
/** Field cards an effect applies to: the ability's own card, a chosen set, or computed. */
export type Target = "self" | { chosen: string } | ((env: AbilityEnv) => UnionArenaFieldCard[]);
/** How long a change lasts: until the end of this turn, or until the start of the owner's next turn. */
export type Duration = "turn" | "untilYourNextTurn";

export type Step =
  | {
    do: "choose";
    /** Name the choice is stored under. */
    as: string;
    /** Where the options come from: field cards, your hand / sideline, the cards being looked at, your AP cards, modes, or a line. */
    from: "field" | "hand" | "sideline" | "looked" | "ap" | "mode" | "line";
    /** For "mode": the printed options (从下列选择1项). */
    modes?: string[];
    /** Pick every option, in an order the player chooses (自选顺序). */
    all?: boolean;
    /** Leaves out options already picked under this name (e.g. "最多各1张" from the same cards). */
    exclude?: string;
    /** For "line": the chosen card that is being put onto the field. */
    forChosen?: string;
    /** A rule the picked cards must meet together (e.g. total BP 7500 or less). */
    check?: (env: AbilityEnv, cardIds: string[]) => boolean;
    side: "you" | "opponent" | "any";
    /** Who makes the choice: the ability's owner (default), or the opponent ("对方将自己场上的……转为休息状态"). */
    chooser?: "opponent";
    line?: "front" | "energy";
    /** Characters only (the default for field choices) or any card. */
    characters?: boolean;
    filter?: (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
    min: number;
    max: number;
    prompt: string;
    /** Whether being chosen is good for the chosen card (computer players use it to pick targets). */
    good?: boolean;
  }
  | { do: "bp"; target: Target; amount: number | ((env: AbilityEnv) => number); until: Duration }
  | { do: "keyword"; target: Target; keyword: string; until: Duration }
  | { do: "rest" | "activate" | "sideline" | "toHand" | "remove" | "toDeckBottom"; target: Target }
  /** Energy generation +/- until the end of the turn. */
  | { do: "energy"; target: Target; amount: number }
  /** A rule-changing mark (see UnionArenaFieldCard.flags). */
  | { do: "flag"; target: Target; flag: string; until: Duration }
  /** Gives the targets another ability of this card (its index in this card's list) until the end of the turn. */
  | { do: "grantAbility"; target: Target; ability: number }
  /** Looks at the top `count` cards of your deck (they stay out of the deck until put somewhere). */
  | { do: "look"; count: number }
  /** Puts the cards still being looked at on the bottom of your deck, in an order you choose. */
  | { do: "lookedToBottom" }
  /** Puts chosen hand / sideline / looked-at cards onto your field (their 【登场时】 abilities activate). */
  | { do: "put"; chosen: string; line: "choose" | "front" | "energy"; rested: boolean; activeOnEnergy?: boolean }
  /** Moves field characters to the other line (a full destination gives up a card to the removal area first). */
  | { do: "moveLine"; target: Target }
  /** Switches chosen AP cards ("ap:<id>") to active. */
  | { do: "activateAp"; chosen: string }
  | { do: "draw"; count: number }
  /** The owner puts `count` cards from hand into the sideline (choosing them). */
  | { do: "discard"; count: number }
  /** Moves chosen hand / sideline cards to another zone. */
  | { do: "moveChosen"; chosen: string | string[]; to: "hand" | "sideline" | "removal" | "deckBottom" }
  | { do: "may"; prompt: string; steps: Step[] }
  | { do: "if"; test: Condition; steps: Step[]; else?: Step[] }
  /** Escape hatch for an effect the other steps cannot say (no choices inside). */
  | { do: "run"; fn: (env: AbilityEnv) => void; text: string };

export type Cost = { pay: "restSelf" } | { pay: "discard"; count: number } | { pay: "ap"; count: number } | { pay: "sidelineSelf" };

export interface TriggeredAbility {
  kind: "triggered";
  when: AbilityEvent[];
  /** Only active on cards it was given to (grantAbility), not on its own card. */
  grantedOnly?: boolean;
  /** Checked when the ability resolves: false means it does nothing ("……的场合"). */
  condition?: Condition;
  /** For an event's onUse ability: the event can only be used while this holds (此卡牌只有在……的场合才能使用). */
  useCondition?: Condition;
  oncePerTurn?: boolean;
  /** Checked when the event is heard (before the ability is queued); false means it is not queued at all. `cause` is the event's cause (e.g. `sourceCardId` of "onOwnActivateMain"). */
  heardIf?: (ctx: EngineContext, cause: SidelineCause | null) => boolean;
  steps: Step[];
}

/** 【启动主要】: used in the main phase by paying its costs. */
export interface ActivatedAbility {
  kind: "activated";
  /** Must hold to use it ("只有在……的场合才能发动", 「前线中存在的场合」). */
  condition?: Condition;
  costs: Cost[];
  oncePerTurn?: boolean;
  steps: Step[];
}

/** A continuous effect on field cards while its card is on the field (and `condition` holds). */
export interface StaticAbility {
  kind: "static";
  condition?: Condition;
  /** Which field cards it changes (default: its own card). */
  affects?: (env: AbilityEnv, card: UnionArenaFieldCard, cardOwner: EnginePlayer) => boolean;
  bp?: number | ((env: AbilityEnv) => number);
  keywords?: string[];
  /** Rule-changing marks (see UnionArenaFieldCard.flags). */
  flags?: string[];
  /** Extra energy generation (in the card's own energy colour). */
  energy?: number;
  /**
   * "此卡牌只有在……的场合才能登场": the card can only be played from the hand while this holds (`env.self` is null, `env.owner` the player
   * playing it). A static ability with only this field changes nothing on the field (AOT Ymir, Our Founder).
   */
  playCondition?: Condition;
}

/** A change to this card's own cost while it is in the hand. */
export interface CostAbility {
  kind: "cost";
  condition?: Condition;
  energy?: number | ((env: AbilityEnv) => number);
  ap?: number;
  /**
   * Set on an ability of a card on the field: it cuts the cost of the owner's hand cards instead of its own card's (AOT Annie 053:
   * "[Marleyan Warrior] 进行突进时所需能量-1"). `env.self` is that field card; `raiding` is true when the cost is for a Raid from the hand.
   */
  fromField?: (env: AbilityEnv, handCardId: string, raiding: boolean) => boolean;
}

/**
 * "……退场的场合，可以改为……": when one of the owner's characters is about to be sidelined (not by BP 0 or less, a manual operation or a
 * cost), the owner may have something else happen instead, and the character stays on the field.
 */
export interface ReplaceSidelineAbility {
  kind: "replaceSideline";
  /**
   * Set: it replaces being returned to the hand (by an effect or a trigger) instead of being sidelined (AOT Mikasa 088: "……放回手牌的场合，可以改为……").
   * `target` is the character about to be returned; `apply` may queue an ability of its card for choices (e.g. discarding a hand card).
   */
  replaces?: "toHand";
  /** Whether it can replace sidelining `target` now (the ability's own card is `env.self`). */
  condition: (env: AbilityEnv, target: UnionArenaFieldCard, cause: SidelineCause) => boolean;
  oncePerTurn?: boolean;
  /** The question, after "「X」将要退场。". */
  prompt: string;
  /** What happens instead (no choices). */
  apply: (env: AbilityEnv, target: UnionArenaFieldCard) => void;
}

/**
 * "我方将要发动……【抽卡】/【获得】的场合，可以改为……": when the owner activates a revealed life card's trigger, a card on their field may offer to
 * have something else happen instead (EVA 葛城 美里 008, 真希波 018). `as` resolves the trigger as another label ("获得"); `steps` (if any)
 * run as an ability of this card afterwards, instead of the trigger. For `steps`, the revealed card is the only card being looked at
 * (`chooseLooked` / `put` with key "l:0" take it onto the field).
 */
export interface ReplaceTriggerAbility {
  kind: "replaceTrigger";
  /** Whether it can replace the trigger now (the ability's own card is `env.self`). `label` and `cardId` belong to the revealed life card. */
  condition: (env: AbilityEnv, trigger: { label: string; cardId: string }) => boolean;
  /** The question, after "「X」的触发【label】。". */
  prompt: string;
  /** Resolve the trigger as this label instead (the card's own text for it is used: only "获得" is supported). */
  as?: "获得";
  /** Run instead of the trigger: the revealed card is not added to the hand or sidelined by the trigger then. */
  steps?: Step[];
}

export type Ability = TriggeredAbility | ActivatedAbility | StaticAbility | CostAbility | ReplaceSidelineAbility | ReplaceTriggerAbility;

/** A field card's chosen hand/sideline key. */
export const handKey = (index: number): string => `h:${index}`;
export const sidelineKey = (index: number): string => `s:${index}`;
