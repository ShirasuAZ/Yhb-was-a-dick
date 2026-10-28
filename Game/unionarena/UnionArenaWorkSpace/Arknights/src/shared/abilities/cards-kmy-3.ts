/** Abilities of the KMY cards, batch 3 (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { flagsOf } from "../engine.ts";
import type { Ability, AbilityEnv, Condition } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, bp, bpAtMost, chooseAp, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn,
  chosen, chosenCount, costChange, discard, discardCost, draw, duringOpponentTurn, duringYourTurn, either, energyThisTurn, flag, givenOnly, grant,
  grantAbility, ifThen, isCharacterCard, look, lookedToBottom, may, moveChosen, named, notSelf, onPlay, onSidelined, onUse, opponentHasColor,
  restSelf, run, selfActive, selfOnFront, sideline, staticSelf, toHand, when, withAffinity
} from "./dsl.ts";

// ---- Helpers for the KMY cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;

/** 猪子 / 炭子 / 善子 "此卡牌也视为〈…〉": also named by their number, so a check made before the continuous effect is applied still sees it. */
const ALIAS_OF_NUMBER: Readonly<Record<string, string>> = {
  "UA05BT/KMY-1-091": "嘴平 伊之助",
  "UA05BT/KMY-1-092": "灶门 炭治郎",
  "UA05BT/KMY-1-093": "我妻 善逸"
};
const fieldOf = (env: AbilityEnv): UnionArenaFieldCard[] => [...env.owner.front, ...env.owner.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
/** The names a field card has now: printed, the one it is also regarded as, or one set by a "name:<name>" mark. */
const namesOf = (env: AbilityEnv, card: UnionArenaFieldCard): string[] => {
  const stats = env.ctx.card(card.cardId);
  const alias = ALIAS_OF_NUMBER[env.ctx.card(card.cardId)?.number ?? ""];
  return [stats?.name ?? "", ...(alias ? [alias] : []), ...flagsOf(card).flatMap((mark) => (mark.startsWith("name:") ? [mark.slice(5)] : []))];
};
/** 我方场上存在〈name〉 (counting the cards also regarded as that name) */
const hasNamed = (name: string): Condition => (env) => fieldOf(env).some((card) => isCharacter(env, card) && namesOf(env, card).includes(name));
const chosenCards = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => (env.vars[name] ?? []).flatMap((uid) => [...env.owner.front, ...env.owner.energy].filter((card) => card.uid === uid));
/** The card chosen under `name` is (also regarded as) 〈cardName〉. */
const chosenIsNamed = (name: string, cardName: string): Condition => (env) => chosenCards(env, name).some((card) => namesOf(env, card).includes(cardName));

/** A card (in any zone) that is not 〈name〉 -- counting the name it is also regarded as (善子 is 〈我妻 善逸〉 wherever she is). */
const notRegardedAs = (name: string): CardFilter => (env, cardId) => {
  const stats = env.ctx.card(cardId);
  return stats?.name !== name && ALIAS_OF_NUMBER[stats?.number ?? ""] !== name;
};
/** Looked-at cards that have 【突进】. */
const hasRaid: CardFilter = (env, cardId) => !!env.ctx.card(cardId)?.raid;
const tengenWifeOrDisguise = either(withAffinity("天元的妻子"), withAffinity("变装"));

/** 宇髓 天元's own team: [特征:天元的妻子] and [特征:变装] characters on our field. */
const tengenTeam = (env: AbilityEnv): UnionArenaFieldCard[] =>
  fieldOf(env).filter((card) => isCharacter(env, card) && tengenWifeOrDisguise(env, card.cardId, card));
/** 〈宇髓 天元〉、[特征:天元的妻子]、[特征:变装] on our field, each card counted once. */
const tengenCount = (env: AbilityEnv): number =>
  fieldOf(env).filter((card) => isCharacter(env, card) && (namesOf(env, card).includes("宇髓 天元") || tengenWifeOrDisguise(env, card.cardId, card))).length;
/** 我方场上的所有角色 */
const allOwnCharacters = (env: AbilityEnv): UnionArenaFieldCard[] => fieldOf(env).filter((card) => isCharacter(env, card));

/** 本回合中此角色移动过 (set by the two move events below). */
const MOVED_FLAG = "movedThisTurn";
const selfMoved: Condition = (env) => !!env.self && flagsOf(env.self).includes(MOVED_FLAG);

/** 确认卡组最上方的1张卡牌后，置于卡组最上方或最下方 (the choice is `where`, m:0 = top). */
const putLookedOnTopOrBottom = run("将确认的卡牌置于卡组最上方或最下方", (env) => {
  const looking = env.game.looking;
  if (!looking?.cards.length) return;
  if (env.vars.where?.[0] === "m:0") env.owner.library.unshift(...looking.cards);
  else env.owner.library.push(...looking.cards);
  looking.cards = [];
});

/** 雷之呼吸 / 飞血镰: "[BP不高于3000]……存在〈name〉的场合，改为选择[BP不高于5000]" */
const eventSideline = (name: string, prompt: string) => [
  chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (hasNamed(name)(env) ? 5000 : 3000)), prompt }),
  sideline(chosen("target"))
];

export const KMY_3_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 飞血镰（事件）：选择对方前线中的1张[BP不高于3000]的角色退场。我方场上存在〈妓夫太郎〉的场合，改为选择[BP不高于5000]。
  "UA05BT/KMY-1-066": [onUse(...eventSideline("妓夫太郎", "选择对方前线中 1 张 BP 不高于 3000（我方场上有〈妓夫太郎〉时 5000）的角色退场"))],

  // 无惨的血（事件）：选择我方的最多2张AP卡牌转为活跃状态。
  "UA05BT/KMY-1-067": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 我妻 善逸：【登场时】确认我方卡组最上方的7张卡牌，公开其中最多1张拥有【突进】的卡牌并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UA05BT/KMY-1-069": [onPlay(look(7),
    chooseLooked("pick", { max: 1, filter: hasRaid, prompt: "公开最多 1 张拥有【突进】的卡牌并加入手牌" }), moveChosen("pick", "hand"),
    lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // 我妻 善逸：【撤步】（可以在我方移动阶段从前线移动至能量线）
  //          【登场时】从我方场外将最多1张〈我妻 善逸〉以外的角色卡牌加入手牌。
  "UA05BT/KMY-1-070": [onPlay(
    chooseFromSideline("pick", { max: 1, filter: and(isCharacterCard, notRegardedAs("我妻 善逸")), prompt: "从场外选择最多 1 张〈我妻 善逸〉以外的角色加入手牌" }), moveChosen("pick", "hand"))],

  // 我妻 善逸：【突进】〈我妻 善逸〉转为活跃状态，并可以移动至前线。
  //          我方场上存在〈灶门 炭治郎〉的场合，此角色获得【伤害②】（此角色攻击并给予对手直接伤害时，改为给予2点伤害）。
  //          【登场时】我方场上存在〈嘴平 伊之助〉的场合，抽取2张卡牌，将我方的1张手牌置于场外。
  //          ■■■■■（trailing marks, not ability text）
  "UA05BT/KMY-1-071": [
    staticSelf({ keywords: ["伤害2"] }, hasNamed("灶门 炭治郎")),
    onPlay(ifThen(hasNamed("嘴平 伊之助"), [draw(2), discard(1)]))
  ],

  // 灶门 炭治郎：【启动主要】[转为休息状态]选择我方场上的1张其他角色，本回合中BP+1000。
  "UA05BT/KMY-1-072": [activateMain({ costs: [restSelf] },
    chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 灶门 炭治郎：【我方的回合中】我方场上存在〈嘴平 伊之助〉的场合，此角色的BP+1000。
  //            【对方的回合中】我方场上存在〈我妻 善逸〉的场合，此角色的BP+1000。
  "UA05BT/KMY-1-073": [
    staticSelf({ bp: 1000 }, all(duringYourTurn, hasNamed("嘴平 伊之助"))),
    staticSelf({ bp: 1000 }, all(duringOpponentTurn, hasNamed("我妻 善逸")))
  ],

  // 灶门 祢豆子：此角色处于活跃状态的场合，此角色产生能量+●红●。
  "UA05BT/KMY-1-074": [staticSelf({ energy: 1 }, selfActive)],

  // 啾太郎：【启动主要】[转为休息状态][每回合1次]本回合中，此角色产生能量+●红●。主要阶段结束时，将此角色退场。
  "UA05BT/KMY-1-075": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 嘴平 伊之助：本回合中此角色移动过的场合，此角色在本回合中，BP+500。
  "UA05BT/KMY-1-077": [
    when(["onMoveToFront", "onMoveToEnergy"], flag("self", MOVED_FLAG)),
    staticSelf({ bp: 500 }, selfMoved)
  ],

  // 嘴平 伊之助：此角色以活跃状态登场。
  //            【冲击①】（当在进行攻击的战斗中胜利时，给与对方玩家1点伤害）。
  //            【伤害②】（当通过此角色的攻击给予对方直接伤害时，改为给予2点伤害）
  //            我方的攻击阶段结束时，将此角色退场。
  "UA05BT/KMY-1-078": [
    onPlay(activate("self")),
    when(["onAttackPhaseEnd"], sideline("self"))
  ],

  // 嘴平 伊之助：【突进】〈嘴平 伊之助〉转为活跃状态，并可以移动至前线。
  //            我方场上存在〈灶门 炭治郎〉的场合，此角色获得【冲击①】（当在进行攻击的战斗中胜利时，给与对方玩家1点伤害）。
  //            【登场时】我方场上存在〈我妻 善逸〉的场合，选择我方场上的最多1张其他角色，转为活跃状态。
  //            ■■■■■（trailing marks, not ability text）
  "UA05BT/KMY-1-079": [
    staticSelf({ keywords: ["冲击1"] }, hasNamed("灶门 炭治郎")),
    onPlay(ifThen(hasNamed("我妻 善逸"), [
      chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色转为活跃状态" }), activate(chosen("target"))]))
  ],

  // 肌肉鼠：对方场上存在黄色或紫色卡牌的场合，手牌中的此卡牌所需能量减少●キ红×1●。
  "UA05BT/KMY-1-080": [costChange({ energy: 1 }, opponentHasColor("yellow", "purple"))],

  // 炼狱 千寿郎：【登场时】选择我方场上的最多1张其他角色，本回合中，BP+1000。
  "UA05BT/KMY-1-081": [onPlay(
    chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 雏鹤：【退场时】从我方场外将最多1张〈宇髓 天元〉加入手牌。
  "UA05BT/KMY-1-083": [onSidelined(
    chooseFromSideline("pick", { max: 1, filter: named("宇髓 天元"), prompt: "从场外选择最多 1 张〈宇髓 天元〉加入手牌" }), moveChosen("pick", "hand"))],

  // 槙於：【我方的回合中】我方场上存在〈宇髓 天元〉的场合，此角色BP+500。
  "UA05BT/KMY-1-084": [staticSelf({ bp: 500 }, all(duringYourTurn, hasNamed("宇髓 天元")))],

  // 宇髓 天元：【登场时】确认我方卡组最上方的4张卡牌。公开其中最多1张［特征:天元的妻子］或［特征:变装］并加入手牌。剩余的卡牌自选顺序置于卡组最下方。
  "UA05BT/KMY-1-086": [onPlay(look(4),
    chooseLooked("pick", { max: 1, filter: tengenWifeOrDisguise, prompt: "公开最多 1 张[特征:天元的妻子]或[特征:变装]并加入手牌" }), moveChosen("pick", "hand"),
    lookedToBottom())],

  // 宇髓 天元：【突进】〈宇髓 天元〉转为活跃状态，并可以移动至前线。
  //          【登场时】此角色在本回合中，获得【2次攻击】（当此角色在本回合中首次进行攻击时，转为活跃状态）。
  //          【启动主要】[每回合1次]我方场上的所有［特征:天元的妻子］和［特征:变装］，本回合中，BP+500。
  "UA05BT/KMY-1-087": [
    activateMain({ once: true }, bp(tengenTeam, 500)),
    onPlay(grant("self", "2次攻击"))
  ],

  // 炼狱 杏寿郎：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，此角色放回手牌。
  "UA05BT/KMY-1-088": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= 1), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    toHand(chosen("target")), ifThen((env) => (env.vars.target ?? []).length === 0, [toHand("self")]))],

  // 炼狱 杏寿郎：【启动主要】[前线中存在的场合]#将1张手牌置于场外#[每回合1次]我方场上的所有角色，本回合中，BP+500。
  "UA05BT/KMY-1-089": [activateMain({ costs: [discardCost(1)], condition: selfOnFront, once: true }, bp(allOwnCharacters, 500))],

  // 炼狱 杏寿郎：此角色以活跃状态登场。
  //            【登场时】可以将我方的1张手牌置于场外。那样做的场合，选择对方前线中的最多1张BP不高于3000的角色退场。此角色在本回合中获得【冲击①】（当在进行攻击的战斗中胜利时，给与对方玩家1点伤害）。
  "UA05BT/KMY-1-090": [onPlay(
    activate("self"),
    ifThen((env) => env.owner.hand.length > 0, [may("将 1 张手牌置于场外，然后选择对方前线中最多 1 张 BP 不高于 3000 的角色退场？",
      discard(1),
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3000), prompt: "选择对方前线中最多 1 张 BP 不高于 3000 的角色退场" }),
      sideline(chosen("target")))]),
    grant("self", "冲击1"))],

  // 猪子：此卡牌也视为〈嘴平 伊之助〉。
  //     【撤步】（可以在我方移动阶段从前线移动至能量线）
  "UA05BT/KMY-1-091": [staticSelf({ flags: ["name:嘴平 伊之助"] })],

  // 炭子：此卡牌也视为〈灶门 炭治郎〉。
  //     【冲击无效】（与此角色进行战斗的角色在本次战斗中失去【冲击】）。
  "UA05BT/KMY-1-092": [staticSelf({ flags: ["name:灶门 炭治郎"] })],

  // 善子：此卡牌也视为〈我妻 善逸〉。
  //     【登场时】确认我方卡组最上方的1张卡牌。将那张卡牌置于我方卡组最上方或最下方。
  "UA05BT/KMY-1-093": [
    staticSelf({ flags: ["name:我妻 善逸"] }),
    onPlay(look(1), ifThen((env) => (env.game.looking?.cards.length ?? 0) > 0, [chooseMode("where", ["置于卡组最上方", "置于卡组最下方"]), putLookedOnTopOrBottom]))
  ],

  // 便当（场地）：此场地以活跃状态登场。
  //            【启动主要】[转为休息状态]选择我方场上的1张角色，本回合中，BP+1000。
  "UA05BT/KMY-1-094": [
    activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, prompt: "选择我方场上 1 张角色（本回合 BP+1000）" }), bp(chosen("target"), 1000)),
    onPlay(activate("self"))
  ],

  // 好吃！好吃！好吃！（事件）：抽取2张卡牌，将我方的1张手牌置于场外。
  "UA05BT/KMY-1-095": [onUse(draw(2), discard(1))],

  // 音之呼吸 伍之型 鸣弦奏奏（事件）：选择对方前线中的1张BP不高于我方场上的〈宇髓 天元〉、[特征:天元的妻子]、[特征:变装]合计张数×1000的角色退场。
  "UA05BT/KMY-1-096": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => tengenCount(env) * 1000), prompt: "选择对方前线中 1 张 BP 不高于〈宇髓 天元〉与[天元的妻子][变装]合计张数×1000 的角色退场" }),
    sideline(chosen("target")))],

  // 雷之呼吸 壹之型 霹雳一闪（事件）：选择对方前线中的1张[BP不高于3000]的角色退场。我方场上存在〈我妻 善逸〉的场合，改为选择[BP不高于5000]。
  "UA05BT/KMY-1-097": [onUse(...eventSideline("我妻 善逸", "选择对方前线中 1 张 BP 不高于 3000（我方场上有〈我妻 善逸〉时 5000）的角色退场"))],

  // 兽之呼吸 伍之牙 狂乱撕扯（事件）：选择我方前线中的1张角色，本回合中，BP+2000。选择的角色为〈嘴平 伊之助〉的场合，追加在本回合中，给予【冲击+1】（冲击给予的伤害+1，没有冲击的场合，获得冲击①）。
  "UA05BT/KMY-1-098": [onUse(
    chooseOwn("target", { line: "front", min: 1, max: 1, prompt: "选择我方前线中 1 张角色（本回合 BP+2000）" }),
    bp(chosen("target"), 2000),
    ifThen(chosenIsNamed("target", "嘴平 伊之助"), [grant(chosen("target"), "冲击+1")]))],

  // 全集中呼吸（事件）：选择我方的最多2张AP卡牌转为活跃状态。
  "UA05BT/KMY-1-99": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 猪突猛进（事件）：选择我方前线中的1张角色，本回合中，BP+3000。
  "UA05BT/KMY-1-100": [onUse(
    chooseOwn("target", { line: "front", min: 1, max: 1, prompt: "选择我方前线中 1 张角色（本回合 BP+3000）" }), bp(chosen("target"), 3000))],

  // 伊黑 小芭内：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "EX05BT/KMY-1-017": [onPlay(draw(1), discard(1))]
};
