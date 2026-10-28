/** Abilities of the KMY cards, batch 5 (EX05BT/KMY-3-033 .. 066: blue 柱 / 日轮刀 sites, purple 上弦之鬼, yellow 炭治郎 team). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, characterSidelinedCountThisTurn, costOf, flagsOf } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, apCost, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode,
  chooseOpponent, chooseOwn, chosen, chosenByKatanaThisTurn, chosenCount, costChange, discard, draw, duringYourTurn, flag, grant, ifThen, isCharacterCard,
  look, lookedToBottom, markChosenByKatana, may, moveChosen, moveLine, named, notChosenByKatanaThisTurn, notSelf, ofColor, onAttack, onPlay, onSidelined, onUse,
  oncePerTurn, put, restSelf, run, selfChosenByKatanaThisTurn, selfOnFront, sideline, staticSelf, toHand, when, withAffinity, withCondition, either
} from "./dsl.ts";

// ---- Helpers for the KMY cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const fieldOf = (env: AbilityEnv): UnionArenaFieldCard[] => [...env.owner.front, ...env.owner.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const fieldCharacters = (env: AbilityEnv): UnionArenaFieldCard[] => fieldOf(env).filter((card) => isCharacter(env, card));
const findOwn = (env: AbilityEnv, uid: string): UnionArenaFieldCard | undefined => fieldOf(env).find((card) => card.uid === uid);
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;
const bpAtLeast = (limit: number): CardFilter => (env, _cardId, card) => !!card && bpOf(env.ctx, card) >= limit;
/** Required energy of a hand card now (with its own cost changes). */
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy <= limit;

/**
 * "此卡牌也视为〈…〉": the extra names those UA05BT cards have in every zone (hand, deck, looked-at cards, field), by card number:
 * 鬼舞辻 无惨 (拟态 036-038), 蕨姬 (= 堕姬), 猪子 / 炭子 / 善子. A field card also carries a "name:<name>" mark (see cards-kmy-2 / cards-kmy-3).
 */
const ALIAS_OF_NUMBER: Readonly<Record<string, string>> = {
  "UA05BT/KMY-1-036": "鬼舞辻 无惨", "UA05BT/KMY-1-037": "鬼舞辻 无惨", "UA05BT/KMY-1-038": "鬼舞辻 无惨", "UA05BT/KMY-1-060": "堕姬",
  "UA05BT/KMY-1-091": "嘴平 伊之助", "UA05BT/KMY-1-092": "灶门 炭治郎", "UA05BT/KMY-1-093": "我妻 善逸"
};
const namesOfCard = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null): string[] => {
  const stats = env.ctx.card(cardId);
  const alias = ALIAS_OF_NUMBER[stats?.number ?? ""];
  return [stats?.name ?? "", ...(alias ? [alias] : []), ...(card ? flagsOf(card).flatMap((mark) => (mark.startsWith("name:") ? [mark.slice(5)] : [])) : [])];
};
/** The card is named〈name〉(printed name, or a name it is also regarded as). */
const namedAlso = (name: string): CardFilter => (env, cardId, card) => namesOfCard(env, cardId, card).includes(name);
/** 我方的场上存在〈name〉 (a character) */
const youHaveNamedAlso = (name: string): Condition => (env) => fieldCharacters(env).some((card) => namedAlso(name)(env, card.cardId, card));
/** 我方的场上存在〈name〉 (any card, e.g. the 日轮刀 sites) */
const youHaveCardNamed = (name: string): Condition => (env) => fieldOf(env).some((card) => namedAlso(name)(env, card.cardId, card));
/** 我方的场上存在突进状态的〔〈a〕或〈b〉〕: a Raided character (cards under it) with one of the names. */
const youHaveRaidedNamed = (...names: string[]): Condition => (env) =>
  fieldCharacters(env).some((card) => card.under.length > 0 && names.some((name) => namedAlso(name)(env, card.cardId, card)));
const raidedNamed = (name: string): CardFilter => (env, cardId, card) => !!card && card.under.length > 0 && namedAlso(name)(env, cardId, card);

const TANJIRO = "灶门 炭治郎";
const ZENITSU = "我妻 善逸";
const INOSUKE = "嘴平 伊之助";
const MITSURI = "甘露寺 蜜璃";
const MUICHIRO = "时透 无一郎";
const GIYUTARO = "妓夫太郎";
const DAKI = "堕姬";
const ZOHAKUTEN = "憎珀天";

/** 本回合中有角色退场过 (either player's characters). */
const characterSidelinedThisTurnByAnyone: Condition = (env) =>
  characterSidelinedCountThisTurn(env.game, env.owner.accountId) + characterSidelinedCountThisTurn(env.game, env.opponent.accountId) > 0;
const sidelineAtLeast = (count: number): Condition => (env) => env.owner.sideline.length >= count;

/** 确认卡组最上方的1张卡牌后，置于卡组最上方或最下方 (the choice is `where`, m:0 = top). */
const putLookedOnTopOrBottom = run("将确认的卡牌置于卡组最上方或最下方", (env) => {
  const looking = env.game.looking;
  if (!looking?.cards.length) return;
  if (env.vars.where?.[0] === "m:0") env.owner.library.unshift(...looking.cards);
  else env.owner.library.push(...looking.cards);
  looking.cards = [];
});

/** 对方将自己前线中的1张角色放回手牌 */
const opponentReturnsOwnFront: Step[] = [
  { do: "choose", as: "back", from: "field", side: "opponent", chooser: "opponent", line: "front", min: 1, max: 1, prompt: "选择自己前线中 1 张角色放回手牌", good: false },
  toHand(chosen("back"))
];

// ---- The 日轮刀 sites ----

/** A 日轮刀 site's choice: one of our characters named `name` that no 日轮刀 effect has chosen this turn. */
const katanaTarget = (name: string): CardFilter => and(namedAlso(name), notChosenByKatanaThisTurn);
const hasKatanaTarget = (name: string): Condition => (env) => fieldCharacters(env).some((card) => katanaTarget(name)(env, card.cardId, card));
const chooseKatanaTarget = (name: string, prompt: string): Step =>
  chooseOwn("target", { min: 1, max: 1, filter: katanaTarget(name), prompt });

// ---- 半天狗 and his clones ----

/** 通过我方的效果，此角色退场 (not a cost) */
const sidelinedByOwnEffect: Condition = (env) => env.cause?.kind === "effect" && env.cause.byPlayerId === env.owner.accountId && !env.cause.cost;
/** ……通过我方的〈憎珀天〉的效果退场 */
const sidelinedByZohakuten: Condition = (env) => sidelinedByOwnEffect(env) && env.ctx.card(env.cause?.sourceCardId ?? "")?.name === ZOHAKUTEN;
/** 将我方卡组最上方的N张卡牌置于场外 */
const mill = (count: number) => (env: AbilityEnv): void => { env.owner.sideline.push(...env.owner.library.splice(0, count)); };

const faceDownAtLeast = (count: number): Condition => (env) => (env.self?.faceDown?.length ?? 0) >= count;

/** 半天狗: the four clones to pick from the sideline (one of each). */
const CLONES = ["哀绝", "空喜", "可乐", "积怒"] as const;
const cloneKeys = ["clone0", "clone1", "clone2", "clone3"] as const;
const handyanguPicks: Step[] = CLONES.map((name, index) =>
  chooseFromSideline(cloneKeys[index]!, { min: 1, max: 1, filter: named(name), prompt: `从场外选择 1 张〈${name}〉` }));
/** The sideline index of a "s:<n>" key. */
const keyIndex = (key: string): number => Number(key.slice(2));

// ---- 堕姬 (053) ----

/** A front-line 〈堕姬〉 with 【突进】 that is not in Raid state (no cards under it), other than the ability's own card. */
const raidableDaki: CardFilter = (env, cardId, card) =>
  !!card && card.uid !== env.self?.uid && env.owner.front.includes(card) && !!env.ctx.card(cardId)?.raid && card.under.length === 0 && namedAlso(DAKI)(env, cardId, card);
const hasRaidableDaki: Condition = (env) => env.owner.front.some((card) => raidableDaki(env, card.cardId, card));

// ---- 鬼舞辻 无惨 (049) ----

const MUZAN_FLAG = "muzanSidelinedOthers";
const nSidelined = (count: number): Condition => (env) => Number(env.vars.__sidelined?.[0] ?? 0) >= count;

// ---- 炼狱 槙寿郎 (066) ----

/** 本回合中通过我方的事件卡牌或〈炼狱 杏寿郎〉的效果将我方的手牌置于场外 (the engine leaves a "handDiscardedBy:<card number>" turn mark for each such discard). */
const handDiscardedByEventOrKyojuro: Condition = (env) => {
  const prefix = `${env.game.turn}:${env.owner.accountId}:handDiscardedBy:`;
  return (env.game.turnMarks ?? []).some((mark) => {
    if (!mark.startsWith(prefix)) return false;
    const stats = env.ctx.card(mark.slice(prefix.length));
    return stats?.type === "event" || stats?.name === "炼狱 杏寿郎";
  });
};

export const KMY_5_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 甘露寺 蜜璃：【2次阻挡】（当此角色在本回合中首次进行阻挡时，转为活跃状态）
  //            我方的场上存在〈日轮刀(甘露寺 蜜璃)〉的场合，此角色的产生能量+[蓝]。
  "EX05BT/KMY-3-033": [staticSelf({ energy: 1 }, youHaveCardNamed("日轮刀(甘露寺 蜜璃)"))],

  // 甘露寺 蜜璃：【突进】〈甘露寺 蜜璃〉转为活跃状态，并可以移动至前线 【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）
  //            [每回合1次]当此角色被我方的“特征：日轮刀”的效果选择时，此角色直到我方的下一个回合开始时为止，BP+1000。
  //            【登场时】对方将自己前线中的1张角色放回手牌。 【攻击时】选择我方场上的最多1张其他角色，本回合中，BP+1000。
  //   (the data's `keywords` is empty although the text has 【冲击无效】 in the middle of the Raid line: it is given here)
  "EX05BT/KMY-3-034": [
    staticSelf({ keywords: ["冲击无效"] }),
    oncePerTurn(when(["onChosenByKatana"], bp("self", 1000, "untilYourNextTurn"))),
    onPlay(...opponentReturnsOwnFront),
    onAttack(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))
  ],

  // 时透 无一郎：【攻击时】抽取1张卡牌，将我方的1张手牌置于场外。
  "EX05BT/KMY-3-036": [onAttack(draw(1), discard(1))],

  // 时透 无一郎：【启动主要】[每回合1次]只有在本回合中此角色被我方的“特征：日轮刀”的效果选择的场合才能发动。将此角色移动至其他线中。
  "EX05BT/KMY-3-037": [activateMain({ once: true, condition: all(selfChosenByKatanaThisTurn, (env) => !!env.self && !flagsOf(env.self).includes("cannotMove")) }, moveLine("self"))],

  // 时透 无一郎：【攻击时】本回合中此角色被我方的“特征：日轮刀”的效果选择的场合，从下列选择1项。
  //            ·选择对方前线中的最多1张BP2500或更高的角色，本回合中，BP-2000。
  //            ·选择对方前线中的最多2张BP1500或更高的角色，本回合中，BP-1000。
  "EX05BT/KMY-3-038": [withCondition(onAttack(
    chooseMode("mode", ["选择对方前线中的最多1张BP2500或更高的角色，本回合中，BP-2000。", "选择对方前线中的最多2张BP1500或更高的角色，本回合中，BP-1000。"]),
    ifThen(modeIs("mode", 0), [
      chooseOpponent("big", { line: "front", max: 1, filter: bpAtLeast(2500), prompt: "选择对方前线中最多 1 张 BP2500 或更高的角色（本回合 BP-2000）" }), bp(chosen("big"), -2000)
    ]),
    ifThen(modeIs("mode", 1), [
      chooseOpponent("small", { line: "front", max: 2, filter: bpAtLeast(1500), prompt: "选择对方前线中最多 2 张 BP1500 或更高的角色（本回合 BP-1000）" }), bp(chosen("small"), -1000)
    ])), selfChosenByKatanaThisTurn)],

  // 时透 无一郎：【突进】〈时透 无一郎〉转为活跃状态，并可以移动至前线
  //            [每回合1次]当此角色被我方的“特征：日轮刀”的效果选择时，此角色直到我方的下一个回合开始时为止，获得”此角色不会被BP不高于3000的角色阻挡”和“不会被对方角色的效果选择，不会被【瞄准攻击】指定”。
  //            【登场时】选择对方前线中的最多1张BP2500或更高的角色，本回合中，BP-2000。
  //            【攻击时】抽取1张卡牌，选择对方前线中的最多1张BP1500或更高的角色，本回合中，BP-1000。
  "EX05BT/KMY-3-039": [
    oncePerTurn(when(["onChosenByKatana"],
      flag("self", "unblockableBpAtMost:3000", "untilYourNextTurn"), flag("self", "untargetable:character", "untilYourNextTurn"), flag("self", "unsnipeable", "untilYourNextTurn"))),
    onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(2500), prompt: "选择对方前线中最多 1 张 BP2500 或更高的角色（本回合 BP-2000）" }), bp(chosen("target"), -2000)),
    onAttack(draw(1), chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(1500), prompt: "选择对方前线中最多 1 张 BP1500 或更高的角色（本回合 BP-1000）" }), bp(chosen("target"), -1000))
  ],

  // 刀匠村（场地）：此场地以活跃状态登场。
  //   【启动主要】[转为休息状态]确认我方卡组最上方的2张卡牌。公开其中最多1张“特征：刀匠村”或“特征：日轮刀”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "EX05BT/KMY-3-040": [
    onPlay(activate("self")),
    activateMain({ costs: [restSelf] }, look(2),
      chooseLooked("pick", { max: 1, filter: either(withAffinity("刀匠村"), withAffinity("日轮刀")), prompt: "公开最多 1 张“特征：刀匠村”或“特征：日轮刀”并加入手牌" }), moveChosen("pick", "hand"),
      lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))
  ],

  // 日轮刀(灶门 炭治郎)（场地）：此场地以活跃状态登场。
  //   【启动主要】[转为休息状态]无法通过此效果选择本回合中已被“特征：日轮刀”的效果选择过的角色。选择我方场上的1张〈灶门 炭治郎〉，本回合中，BP+1000。那之后，可以确认我方卡组最上方的1张卡牌。这样做的场合，将其置于我方卡组的最上方或最下方。
  "EX05BT/KMY-3-041": [
    onPlay(activate("self")),
    activateMain({ costs: [restSelf], condition: hasKatanaTarget(TANJIRO) },
      chooseKatanaTarget(TANJIRO, "选择我方场上 1 张〈灶门 炭治郎〉（本回合 BP+1000）"), bp(chosen("target"), 1000), markChosenByKatana("target"),
      may("确认我方卡组最上方的 1 张卡牌，并置于卡组最上方或最下方？", look(1),
        ifThen((env) => (env.game.looking?.cards.length ?? 0) > 0, [chooseMode("where", ["置于卡组最上方", "置于卡组最下方"]), putLookedOnTopOrBottom])))
  ],

  // 日轮刀(甘露寺 蜜璃)（场地）：此场地以活跃状态登场。
  //   【启动主要】[转为休息状态]无法通过此效果选择本回合中已被“特征：日轮刀”的效果选择过的角色。选择我方场上的1张〈甘露寺 蜜璃〉，本回合中，『BP+1000』。可以将我方的1张手牌置于场外。这样做的场合，改为『BP+2000』。
  "EX05BT/KMY-3-042": [
    onPlay(activate("self")),
    activateMain({ costs: [restSelf], condition: hasKatanaTarget(MITSURI) },
      chooseKatanaTarget(MITSURI, "选择我方场上 1 张〈甘露寺 蜜璃〉（本回合 BP+1000，弃 1 张手牌则改为 BP+2000）"),
      markChosenByKatana("target"),
      // "改为BP+2000": the +1000 is applied first, and the discard adds the other +1000 (the same total as +2000 instead of +1000).
      bp(chosen("target"), 1000),
      ifThen((env) => env.owner.hand.length > 0, [may("将 1 张手牌置于场外，使 BP+1000 改为 BP+2000？", discard(1), bp(chosen("target"), 1000))]))
  ],

  // 日轮刀(时透 无一郎)（场地）：此场地以活跃状态登场。
  //   【启动主要】[转为休息状态]无法通过此效果选择本回合中已被“特征：日轮刀”的效果选择过的角色。选择我方场上的1张〈时透 无一郎〉，本回合中，给予BP+1000和“此角色不会被BP不高于2000的角色阻挡”。
  "EX05BT/KMY-3-043": [
    onPlay(activate("self")),
    activateMain({ costs: [restSelf], condition: hasKatanaTarget(MUICHIRO) },
      chooseKatanaTarget(MUICHIRO, "选择我方场上 1 张〈时透 无一郎〉（本回合 BP+1000，不会被 BP 不高于 2000 的角色阻挡）"),
      bp(chosen("target"), 1000), flag(chosen("target"), "unblockableBpAtMost:2000"), markChosenByKatana("target"))
  ],

  // 斑纹（事件）：选择我方的最多2张AP卡牌，转为活跃状态。
  "EX05BT/KMY-3-044": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 圆舞一闪（事件）：选择对方前线中的1张『BP不高于3000』的角色，退场。我方的场上存在〈灶门 炭治郎〉的场合，改为『BP不高于4000』。我方的场上同时存在〈灶门 炭治郎〉和〈日轮刀(灶门 炭治郎)〉的场合，改为『BP不高于5000』。
  "EX05BT/KMY-3-045": [onUse(
    chooseOpponent("target", {
      line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张 BP 不高于 3000（有〈灶门 炭治郎〉时 4000，再有〈日轮刀(灶门 炭治郎)〉时 5000）的角色退场",
      filter: bpAtMost((env) => (youHaveNamedAlso(TANJIRO)(env) ? (youHaveCardNamed("日轮刀(灶门 炭治郎)")(env) ? 5000 : 4000) : 3000))
    }),
    sideline(chosen("target")))],

  // 赫刀（事件）：选择我方场上的1张本回合中已被“特征：日轮刀”的效果选择过的角色，本回合中，给予BP+1000和と〔【冲击+1】（冲击给予的伤害+1，没有冲击的场合，获得【冲击①】）或【伤害+1】（当通过此角色的攻击给与对方直接伤害时，追加给予1点伤害）〕，抽取1张卡牌。
  //   ("和と〔A或B〕" read as: BP+1000, and one of 【冲击+1】 / 【伤害+1】 of the player's choice; the event can only be used while such a character exists)
  "EX05BT/KMY-3-046": [{
    ...onUse(
      chooseOwn("target", { min: 1, max: 1, filter: chosenByKatanaThisTurn, prompt: "选择我方场上 1 张本回合中已被“特征：日轮刀”的效果选择过的角色（BP+1000，并获得【冲击+1】或【伤害+1】）" }),
      bp(chosen("target"), 1000),
      chooseMode("kw", ["【冲击+1】（冲击给予的伤害+1，没有冲击的场合，获得【冲击①】）", "【伤害+1】（通过此角色的攻击给与对方直接伤害时，追加给予1点伤害）"]),
      ifThen(modeIs("kw", 0), [grant(chosen("target"), "冲击+1")]),
      ifThen(modeIs("kw", 1), [grant(chosen("target"), "伤害+1")]),
      draw(1)),
    useCondition: (env) => fieldCharacters(env).some((card) => chosenByKatanaThisTurn(env, card.cardId, card))
  }],

  // 霞之呼吸 伍之型 霞云之海（事件）：我方的场上存在〈时透 无一郎〉的场合，手牌中存在的此卡牌的消费AP-1。
  //   选择对方前线中的1张BP不高于5000的角色，置于对方卡组的最下方。
  "EX05BT/KMY-3-047": [
    costChange({ ap: 1 }, youHaveNamedAlso(MUICHIRO)),
    onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中 1 张 BP 不高于 5000 的角色，置于对方卡组的最下方" }),
      { do: "toDeckBottom", target: chosen("target") })
  ],

  // 恋之呼吸 壹之型 初恋的战栗（事件）：选择对方前线中的1张BP不高于5000的角色，放回手牌。我方的场上存在〈甘露寺 蜜璃〉的场合，抽取1张卡牌，选择我方场上的最多1张〈甘露寺 蜜璃〉，本回合中，给予【冲击+1】（冲击给予的伤害+1，没有冲击的场合，获得【冲击①】）。
  "EX05BT/KMY-3-048": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中 1 张 BP 不高于 5000 的角色放回手牌" }), toHand(chosen("target")),
    ifThen(youHaveNamedAlso(MITSURI), [
      draw(1),
      chooseOwn("mitsuri", { max: 1, filter: namedAlso(MITSURI), prompt: "选择我方场上最多 1 张〈甘露寺 蜜璃〉（本回合获得【冲击+1】）" }), grant(chosen("mitsuri"), "冲击+1")
    ]))],

  // 鬼舞辻 无惨：我方的场外存在15张或更多的卡牌的场合，此角色获得【冲击①】。
  //            【登场时】可以将我方场上的任意张数的其他角色退场。这样做的场合，抽取与通过此效果退场的角色张数相同数量的卡牌。
  //            【启动主要】[每回合1次]只有在本回合中通过此角色的【登场时】效果将角色退场的场合才能发动。从我方的手牌中将1张所需能量不高于3且消费AP为1的紫色角色卡牌在我方的场上以休息状态登场。
  "EX05BT/KMY-3-049": [
    staticSelf({ keywords: ["冲击1"] }, sidelineAtLeast(15)),
    onPlay(may("将我方场上任意张数的其他角色退场（抽取相同张数的卡牌）？",
      chooseOwn("out", { min: 0, max: 7, filter: notSelf, prompt: "选择我方场上任意张数的其他角色退场" }),
      sideline(chosen("out")),
      run("记录实际退场的角色张数", (env) => {
        const gone = (env.vars.out ?? []).filter((uid) => !findOwn(env, uid)).length;
        env.vars.__sidelined = [String(gone)];
        if (gone > 0 && env.self && !flagsOf(env.self).includes(MUZAN_FLAG)) env.self.flags = [...(env.self.flags ?? []), MUZAN_FLAG];
      }),
      ...Array.from({ length: 7 }, (_, index) => ifThen(nSidelined(index + 1), [draw(1)])))),
    activateMain({ once: true, condition: (env) => !!env.self && flagsOf(env.self).includes(MUZAN_FLAG) },
      chooseFromHand("card", { min: 1, max: 1, filter: and(isCharacterCard, ofColor("purple"), apCostIs(1), handCostAtMost(3)), prompt: "从手牌选择 1 张所需能量不高于 3、消费 AP 为 1 的紫色角色，以休息状态登场" }),
      ifThen(chosenCount("card"), [put("card", "choose", true)]))
  ],

  // 妓夫太郎：【登场时】我方的场上存在〈堕姬〉的场合，选择对方前线中的最多1张BP1500或更高的角色，本回合中，BP-1000。
  "EX05BT/KMY-3-050": [withCondition(onPlay(
    chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(1500), prompt: "选择对方前线中最多 1 张 BP1500 或更高的角色（本回合 BP-1000）" }), bp(chosen("target"), -1000)),
    youHaveNamedAlso(DAKI))],

  // 玉壶：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "EX05BT/KMY-3-051": [onPlay(draw(1), discard(1))],

  // 玉壶：【突进】〈玉壶〉转为活跃状态，并可以移动至前线
  //     【登场时】选择对方前线中的最多1张角色，本回合中，『BP-1500』。本回合中有角色退场的场合，改为『BP-2500』。
  //     【攻击时】抽取1张卡牌，将我方的1张手牌置于场外。
  "EX05BT/KMY-3-052": [
    onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-1500，本回合有角色退场过则 BP-2500）" }),
      bp(chosen("target"), (env) => (characterSidelinedThisTurnByAnyone(env) ? -2500 : -1500))),
    onAttack(draw(1), discard(1))
  ],

  // 堕姬：【启动主要】选择我方前线中的1张拥有【突进】且不是突进状态的〈堕姬〉，转为活跃状态，将此角色正面朝上置于该角色的下方。(变为突进状态)。
  "EX05BT/KMY-3-053": [activateMain({ condition: hasRaidableDaki },
    chooseOwn("target", { line: "front", min: 1, max: 1, filter: raidableDaki, prompt: "选择我方前线中 1 张拥有【突进】且不是突进状态的〈堕姬〉（转为活跃状态，此角色置于其下方）" }),
    activate(chosen("target")),
    run("将此角色正面朝上置于该角色的下方（变为突进状态）", (env) => {
      const self = env.self;
      const target = findOwn(env, env.vars.target?.[0] ?? "");
      if (!self || !target || target === self) return;
      env.owner.front = env.owner.front.filter((card) => card !== self);
      env.owner.energy = env.owner.energy.filter((card) => card !== self);
      target.under = [...target.under, self.cardId, ...self.under];
      if (self.faceDown?.length) target.faceDown = [...(target.faceDown ?? []), ...self.faceDown];
    }))],

  // 堕姬：【登场时】我方的场上存在〈妓夫太郎〉的场合，选择对方前线中的最多1张BP1500或更高的角色，本回合中，BP-1000。
  //     【启动主要】[前线中存在的场合][支付1AP][每回合1次]选择我方场上的1张〈妓夫太郎〉，本回合中，给予【冲击+1】（冲击给予的伤害+1，没有冲击的场合，获得【冲击①】）。
  "EX05BT/KMY-3-054": [
    withCondition(onPlay(
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(1500), prompt: "选择对方前线中最多 1 张 BP1500 或更高的角色（本回合 BP-1000）" }), bp(chosen("target"), -1000)),
      youHaveNamedAlso(GIYUTARO)),
    activateMain({ costs: [apCost(1)], condition: all(selfOnFront, youHaveNamedAlso(GIYUTARO)), once: true },
      chooseOwn("target", { min: 1, max: 1, filter: namedAlso(GIYUTARO), prompt: "选择我方场上 1 张〈妓夫太郎〉（本回合获得【冲击+1】）" }), grant(chosen("target"), "冲击+1"))
  ],

  // 半天狗：【退场时】从我方的场外选择〈哀绝〉、〈空喜〉、〈可乐〉、〈积怒〉各1张，将其中最多2张在我方的场上以休息状态登场，剩余的卡牌加入手牌。
  //   (the four picks are set apart as the looked-at cards: up to 2 of them are put onto the field, the rest go to the hand)
  "EX05BT/KMY-3-055": [onSidelined(
    ...handyanguPicks,
    run("将选择的卡牌作为确认的卡牌", (env) => {
      const keys = cloneKeys.flatMap((name) => env.vars[name] ?? []);
      const cards = keys.map((key) => env.owner.sideline[keyIndex(key)]!).filter(Boolean);
      for (const index of keys.map(keyIndex).sort((a, b) => b - a)) env.owner.sideline.splice(index, 1);
      env.game.looking = { ownerId: env.owner.accountId, cards };
    }),
    chooseLooked("field1", { max: 1, prompt: "选择最多 2 张在场上以休息状态登场的卡牌（第 1 张，其余加入手牌）" }),
    chooseLooked("field2", { max: 1, exclude: "field1", prompt: "选择最多 2 张在场上以休息状态登场的卡牌（第 2 张，其余加入手牌）" }),
    // Put the higher index first so that the other key stays valid.
    run("决定登场顺序", (env) => {
      const keys = [...(env.vars.field1 ?? []), ...(env.vars.field2 ?? [])].sort((a, b) => keyIndex(b) - keyIndex(a));
      env.vars.first = keys[0] ? [keys[0]] : [];
      env.vars.second = keys[1] ? [keys[1]] : [];
    }),
    ifThen(chosenCount("first"), [put("first", "choose", true)]),
    ifThen(chosenCount("second"), [put("second", "choose", true)]),
    run("剩余的卡牌加入手牌", (env) => {
      const looking = env.game.looking;
      if (!looking) return;
      env.owner.hand.push(...looking.cards);
      looking.cards = [];
    }))],

  // 哀绝：【退场时】通过我方的效果，此角色退场的场合，选择对方前线中的最多1张角色，本回合中，『BP-1000』。如果是通过我方的〈憎珀天〉的效果退场的话，改为『BP-2000』。
  "EX05BT/KMY-3-056": [withCondition(onSidelined(
    chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-1000，被〈憎珀天〉退场时 BP-2000）" }),
    bp(chosen("target"), (env) => (sidelinedByZohakuten(env) ? -2000 : -1000))), sidelinedByOwnEffect)],

  // 空喜：【退场时】通过我方的效果，此角色退场的场合，抽取『1张』卡牌。如果是通过我方的〈憎珀天〉的效果退场的话，改为『2张』。
  "EX05BT/KMY-3-057": [withCondition(onSidelined(ifThen(sidelinedByZohakuten, [draw(2)], [draw(1)])), sidelinedByOwnEffect)],

  // 可乐：【退场时】将我方卡组最上方的1张卡牌置于场外。通过我方的〈憎珀天〉的效果，此角色退场的场合，选择我方的最多1张AP卡牌，转为活跃状态。
  "EX05BT/KMY-3-058": [onSidelined(
    run("将卡组最上方的 1 张卡牌置于场外", mill(1)),
    ifThen(sidelinedByZohakuten, [chooseAp("ap", 1), activateAp("ap")]))],

  // 憎珀天：【突进】〈积怒〉转为活跃状态，并可以移动至前线
  //      【登场时】将我方场上的〈哀绝〉、〈空喜〉、〈可乐〉最多各1张退场。这样做的场合，通过此效果退场的所有角色背面朝上置于此角色的下方。
  //      根据此角色下方的背面朝上的卡牌张数，此角色获得下列所有效果。
  //      ·1张或更多：【退场时】可以将此卡牌在我方的场上以休息状态登场。
  //      ·2张或更多：【伤害②】和【2次阻挡】
  //      ·3张或更多：此角色BP+500和【2次攻击】
  "EX05BT/KMY-3-060": [
    onPlay(
      chooseOwn("c0", { max: 1, filter: named("哀绝"), prompt: "选择我方场上最多 1 张〈哀绝〉退场" }),
      chooseOwn("c1", { max: 1, filter: named("空喜"), prompt: "选择我方场上最多 1 张〈空喜〉退场" }),
      chooseOwn("c2", { max: 1, filter: named("可乐"), prompt: "选择我方场上最多 1 张〈可乐〉退场" }),
      run("记录选择的角色卡号", (env) => {
        env.vars.__ids = ["c0", "c1", "c2"].flatMap((name) => (env.vars[name] ?? []).flatMap((uid) => { const card = findOwn(env, uid); return card ? [`${uid}|${card.cardId}`] : []; }));
      }),
      sideline({ chosen: "c0" }), sideline({ chosen: "c1" }), sideline({ chosen: "c2" }),
      run("通过此效果退场的所有角色背面朝上置于此角色的下方", (env) => {
        const self = env.self;
        if (!self) return;
        for (const entry of env.vars.__ids ?? []) {
          const [uid, cardId] = entry.split("|") as [string, string];
          if (findOwn(env, uid)) continue; // 不会退场
          const index = env.owner.sideline.lastIndexOf(cardId);
          if (index < 0) continue;
          env.owner.sideline.splice(index, 1);
          self.faceDown = [...(self.faceDown ?? []), cardId];
        }
      })),
    withCondition(onSidelined(
      run("找到场外的此卡牌", (env) => {
        const index = env.owner.sideline.lastIndexOf(env.selfCardId);
        env.vars.me = index >= 0 ? [`s:${index}`] : [];
      }),
      ifThen(chosenCount("me"), [may("将此卡牌在我方的场上以休息状态登场？", put("me", "choose", true))])),
      (env) => (env.cause?.faceDown?.length ?? 0) >= 1),
    staticSelf({ keywords: ["伤害2", "2次阻挡"] }, faceDownAtLeast(2)),
    staticSelf({ bp: 500, keywords: ["2次攻击"] }, faceDownAtLeast(3))
  ],

  // 无惨的研究（事件）：选择对方前线中的1张『BP不高于3000』的角色，退场。我方的场外存在5张或更多的卡牌的场合，改为『BP不高于5000』。
  "EX05BT/KMY-3-061": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (sidelineAtLeast(5)(env) ? 5000 : 3000)), prompt: "选择对方前线中 1 张 BP 不高于 3000（我方场外有 5 张以上卡牌时 5000）的角色退场" }),
    sideline(chosen("target")))],

  // 我妻 善逸：我方的场上存在突进状态的〔〈灶门 炭治郎〉或〈嘴平 伊之助〉〕的场合，此角色BP+1000。
  "EX05BT/KMY-3-062": [staticSelf({ bp: 1000 }, youHaveRaidedNamed(TANJIRO, INOSUKE))],

  // 灶门 炭治郎：【启动主要】[转为休息状态][将此卡牌退场]选择我方场上的1张突进状态的〈我妻 善逸〉，本回合中，给予【冲击+1】（冲击给予的伤害+1，没有冲击的场合，获得【冲击①】）。
  //            【启动主要】[转为休息状态][将此卡牌退场]选择我方场上的1张突进状态的〈嘴平 伊之助〉，本回合中，给予【伤害+1】（当通过此角色的攻击给与对方直接伤害时，追加给予1点伤害）。
  "EX05BT/KMY-3-063": [
    activateMain({ costs: [restSelf, { pay: "sidelineSelf" }], condition: youHaveRaidedNamed(ZENITSU) },
      chooseOwn("target", { min: 1, max: 1, filter: raidedNamed(ZENITSU), prompt: "选择我方场上 1 张突进状态的〈我妻 善逸〉（本回合获得【冲击+1】）" }), grant(chosen("target"), "冲击+1")),
    activateMain({ costs: [restSelf, { pay: "sidelineSelf" }], condition: youHaveRaidedNamed(INOSUKE) },
      chooseOwn("target", { min: 1, max: 1, filter: raidedNamed(INOSUKE), prompt: "选择我方场上 1 张突进状态的〈嘴平 伊之助〉（本回合获得【伤害+1】）" }), grant(chosen("target"), "伤害+1"))
  ],

  // 灶门 炭治郎：【突进】〈灶门 炭治郎〉转为活跃状态，并可以移动至前线
  //            【登场时】确认我方卡组最上方的5张卡牌。公开其中〈我妻 善逸〉和〈嘴平 伊之助〉最多各1张并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。通过此效果将2张卡牌加入手牌的场合，将我方的1张手牌置于场外。
  //            【启动主要】[前线中存在的场合][转为休息状态]选择我方场上的〈我妻 善逸〉和〈嘴平 伊之助〉最多各1张，本回合中，BP+2000。
  "EX05BT/KMY-3-064": [
    onPlay(look(5),
      chooseLooked("zenitsu", { max: 1, filter: namedAlso(ZENITSU), prompt: "公开最多 1 张〈我妻 善逸〉并加入手牌" }),
      chooseLooked("inosuke", { max: 1, filter: namedAlso(INOSUKE), exclude: "zenitsu", prompt: "公开最多 1 张〈嘴平 伊之助〉并加入手牌" }),
      moveChosen(["zenitsu", "inosuke"], "hand"), lookedToBottom(),
      ifThen(all(chosenCount("zenitsu"), chosenCount("inosuke")), [discard(1)])),
    activateMain({ costs: [restSelf], condition: selfOnFront },
      chooseOwn("zenitsu", { max: 1, filter: namedAlso(ZENITSU), prompt: "选择我方场上最多 1 张〈我妻 善逸〉（本回合 BP+2000）" }),
      chooseOwn("inosuke", { max: 1, filter: namedAlso(INOSUKE), prompt: "选择我方场上最多 1 张〈嘴平 伊之助〉（本回合 BP+2000）" }),
      bp(chosen("zenitsu"), 2000), bp(chosen("inosuke"), 2000))
  ],

  // 嘴平 伊之助：【登场时】我方的场上存在突进状态的〔〈灶门 炭治郎〉或〈我妻 善逸〉〕的场合，此角色转为活跃状态。
  "EX05BT/KMY-3-065": [withCondition(onPlay(activate("self")), youHaveRaidedNamed(TANJIRO, ZENITSU))],

  // 炼狱 槙寿郎：【攻击时】本回合中通过我方的事件卡牌或〈炼狱 杏寿郎〉的效果将我方的手牌置于场外的场合，从下列选择1项。
  //            ·此角色在本回合中，BP+1000。 ·抽取1张卡牌。
  "EX05BT/KMY-3-066": [withCondition(onAttack(
    chooseMode("mode", ["此角色在本回合中，BP+1000。", "抽取1张卡牌。"]),
    ifThen(modeIs("mode", 0), [bp("self", 1000)]),
    ifThen(modeIs("mode", 1), [draw(1)])), handDiscardedByEventOrKyojuro)]
};
