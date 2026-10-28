/**
 * Abilities of the KMY cards, batch 6 (see cards.ts for the conventions): EX05BT/KMY-3-067 .. 073 (炼狱 family), UA05ST/KMY-1-xxx (starter deck) and
 * UA01NC/KMY-2-xxx. Each entry follows the card's printed text, shown above it.
 *
 * Reprints: UA05ST 003 / 004 / 014 / 015 are the same cards as UA05BT 003 / 004 / 014 / 015 and reuse those entries; 033 is encoded again so that 炭子
 * counts as 〈灶门 炭治郎〉 (the batch-1 entry compares the printed name only). UA05ST/KMY-1-102 is a keyword line only (automatic, no entry).
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, costOf, energyLineOnly, energyOf, flagsOf, queueCardEvent } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Target } from "./types.ts";
import {
  activate, activateMain, all, and, apCost, apCostIs, bp, bpAtMost, chooseFromHand, chooseLooked, chooseOpponent, chooseOwn, chosen, chosenCount, discard,
  discardCost, draw, duringYourTurn, either, energyCostAtMost, grant, flag, ifThen, isCharacterCard, look, lookedToBottom, may, moveChosen, named, notNamed, notSelf,
  onPlay, onSidelined, onUse, oncePerTurn, put, raiseNextBpRange, rest, restSelf, run, selfOnEnergy, selfOnFront, sideline, sidelineSelf, staticAura, staticSelf,
  when, withAffinity, withCondition, youHaveNamed
} from "./dsl.ts";
import { KMY_1_ABILITIES } from "./cards-kmy-1.ts";

// ---- Helpers for the KMY cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const fieldOf = (env: AbilityEnv): UnionArenaFieldCard[] => [...env.owner.front, ...env.owner.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const findOwn = (env: AbilityEnv, uid: string): UnionArenaFieldCard | undefined => fieldOf(env).find((card) => card.uid === uid);
const bpAtLeast = (limit: number): CardFilter => (env, _cardId, card) => !!card && bpOf(env.ctx, card) >= limit;
const handCost = (env: AbilityEnv, cardId: string): number => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy;
/** 满足所需能量: the energy line makes enough energy of the card's colour. */
const affordable: CardFilter = (env, cardId) => energyOf(env.ctx, env.owner, env.ctx.card(cardId)?.color ?? "") >= handCost(env, cardId);

/** 猪子 / 炭子 / 善子 "此卡牌也视为〈…〉": also named by their number, so a check on a card that is not on the field (looked at, in the hand) sees it. */
const ALIAS_OF_NUMBER: Readonly<Record<string, string>> = {
  "UA05BT/KMY-1-091": "嘴平 伊之助",
  "UA05BT/KMY-1-092": "灶门 炭治郎",
  "UA05BT/KMY-1-093": "我妻 善逸"
};
/** The card is 〈name〉: printed name, the name it is also regarded as, or a "name:<name>" mark on the field. */
const regardedAs = (name: string): CardFilter => (env, cardId, card) => {
  const stats = env.ctx.card(cardId);
  return stats?.name === name || ALIAS_OF_NUMBER[stats?.number ?? ""] === name || (!!card && flagsOf(card).includes(`name:${name}`));
};
/** 我方的场上存在〈name〉 (counting the cards also regarded as that name) */
const hasRegardedAs = (name: string): Condition => (env) => fieldOf(env).some((card) => isCharacter(env, card) && regardedAs(name)(env, card.cardId, card));
/** 〈灶门 炭治郎〉或〈灶门 祢豆子〉或〈嘴平 伊之助〉 (and 〈我妻 善逸〉 for the 伙伴 event) */
const tanjiroNezukoInosuke: CardFilter = either(regardedAs("灶门 炭治郎"), regardedAs("灶门 祢豆子"), regardedAs("嘴平 伊之助"));
const withZenitsu: CardFilter = either(tanjiroNezukoInosuke, regardedAs("我妻 善逸"));

/**
 * The number of 〈产屋敷 耀哉〉 and other [特征:柱] characters on our field (both lines): "其他的[特征:柱]" leaves out the ability's own card.
 */
const pillarCount = (env: AbilityEnv): number =>
  fieldOf(env).filter((card) => {
    if (!isCharacter(env, card)) return false;
    const stats = env.ctx.card(card.cardId);
    return stats?.name === "产屋敷 耀哉" || (stats?.affinities.includes("柱") === true && card.uid !== env.self?.uid);
  }).length;
const pillarsAtLeast = (count: number): Condition => (env) => pillarCount(env) >= count;

/** [特征:天元的妻子] or [特征:变装] */
const tengenWifeOrDisguise: CardFilter = either(withAffinity("天元的妻子"), withAffinity("变装"));
/** The number of [特征:天元的妻子] and [特征:变装] characters on our field (a card with both counts once). */
const tengenTeamCount = (env: AbilityEnv): number => fieldOf(env).filter((card) => isCharacter(env, card) && tengenWifeOrDisguise(env, card.cardId, card)).length;

const inAttackPhase: Condition = (env) => env.game.phase === "attack";
/** All our characters on the field. */
const allOwnCharacters: Target = (env) => fieldOf(env).filter((card) => isCharacter(env, card));

/** A field character that can be moved to the other line by our own effect (not 无法移动; a card on the energy line not 无法移动至前线). */
const canChangeLine: CardFilter = (env, cardId, card) => !!card && !flagsOf(card).includes("cannotMove") && (env.owner.front.includes(card) || !energyLineOnly(env.ctx, cardId, env.owner));

/** Swaps the positions of a front-line character and an energy-line character (the move events of both are queued). */
function swapPositions(env: AbilityEnv, frontUid: string | undefined, backUid: string | undefined): void {
  const front = frontUid ? findOwn(env, frontUid) : undefined;
  const back = backUid ? findOwn(env, backUid) : undefined;
  if (!front || !back || !env.owner.front.includes(front) || !env.owner.energy.includes(back)) return;
  env.owner.front = env.owner.front.map((card) => (card === front ? back : card));
  env.owner.energy = env.owner.energy.map((card) => (card === back ? front : card));
  queueCardEvent(env.game, env.ctx, "onMoveToEnergy", env.owner, front);
  queueCardEvent(env.game, env.ctx, "onMoveToFront", env.owner, back);
}

/**
 * Hand cards put into the sideline by an effect this turn, as left by the engine's `moveChosen` step: one mark per card,
 * "<turn>:<owner>:handCardDiscardedBy:<number of the card whose ability did it>:<number of the discarded card>". A discard paid as a cost is not among them.
 */
const discardMarkPrefix = (env: AbilityEnv): string => `${env.game.turn}:${env.owner.accountId}:handCardDiscardedBy:`;
/** 通过我方的事件卡牌或〈炼狱 杏寿郎〉的效果: the ability belongs to an event card or to a card named 〈炼狱 杏寿郎〉. */
const eventOrKyojuro = (env: AbilityEnv, sourceNumber: string): boolean => {
  const source = env.ctx.card(sourceNumber);
  return source?.type === "event" || source?.name === "炼狱 杏寿郎";
};
/** 本回合中通过我方的事件卡牌或〈炼狱 杏寿郎〉的效果将我方的手牌置于场外 */
const discardedByEventOrKyojuroThisTurn: Condition = (env) => {
  const prefix = discardMarkPrefix(env);
  return (env.game.turnMarks ?? []).some((mark) => mark.startsWith(prefix) && eventOrKyojuro(env, mark.slice(prefix.length).split(":")[0]!));
};
/** 炼狱 瑠火: uses up the mark of this very card having been put into the sideline from the hand by an event or 〈炼狱 杏寿郎〉; `hit` is set when there was one. */
const consumeOwnDiscardMark = run("找到通过事件卡牌或〈炼狱 杏寿郎〉的效果置于场外的此卡牌", (env) => {
  const prefix = discardMarkPrefix(env);
  const marks = env.game.turnMarks ?? [];
  const index = marks.findIndex((mark) => {
    if (!mark.startsWith(prefix)) return false;
    const [source, discarded] = mark.slice(prefix.length).split(":");
    return discarded === env.selfCardId && eventOrKyojuro(env, source!);
  });
  env.vars.hit = index >= 0 ? ["1"] : [];
  if (index >= 0) env.game.turnMarks = marks.filter((_, position) => position !== index);
});

/** 炎之呼吸 / 生生流转: "[BP不高于3000]……存在〈name〉的场合，改为选择[BP不高于5000]" */
const sidelineLimit = (condition: Condition, low = 3000, high = 5000): CardFilter => bpAtMost((env) => (condition(env) ? high : low));

export const KMY_6_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // ---- EX05BT (炎柱 starter-style cards) ----

  // 炼狱 瑠火：当通过我方的事件卡牌或〈炼狱 杏寿郎〉的效果将此卡牌从手牌中置于场外时，抽取1张卡牌。
  "EX05BT/KMY-3-067": [when(["onEnterSideline"], consumeOwnDiscardMark, ifThen(chosenCount("hit"), [draw(1)]))],

  // 须磨&槙於&雏鹤：【我方的回合中】我方的场上存在〈宇髓 天元〉的场合，此角色BP+500。
  //               【我方的回合中】当此角色在攻击阶段中进行移动时，选择我方场上的最多1张〈宇髓 天元〉或“特征：变装”，本回合中，BP+1000。
  "EX05BT/KMY-3-068": [
    staticSelf({ bp: 500 }, all(duringYourTurn, youHaveNamed("宇髓 天元"))),
    withCondition(when(["onMoveToFront", "onMoveToEnergy"],
      chooseOwn("target", { max: 1, filter: either(named("宇髓 天元"), withAffinity("变装")), prompt: "选择我方场上最多 1 张〈宇髓 天元〉或“特征：变装”（本回合 BP+1000）" }),
      bp(chosen("target"), 1000)), all(duringYourTurn, inAttackPhase))
  ],

  // 宇髓 天元：【撤步】（可以在我方的移动阶段中从前线移动至能量线）
  //          【我方的回合中】我方的场上存在合计3张或更多的“特征：天元的妻子”和“特征：变装”的场合，此角色BP+1000。
  "EX05BT/KMY-3-069": [staticSelf({ bp: 1000 }, all(duringYourTurn, (env) => tengenTeamCount(env) >= 3))],

  // 炼狱 杏寿郎：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "EX05BT/KMY-3-070": [onPlay(draw(1), discard(1))],

  // 炼狱 杏寿郎：【启动主要】[将1张手牌置于场外][每回合1次]本回合中，下一次我方通过“指定BP范围的效果”选择角色时，可指定的BP范围+1000。
  "EX05BT/KMY-3-071": [activateMain({ costs: [discardCost(1)], once: true }, raiseNextBpRange)],

  // 炼狱 杏寿郎：【突进】〈炼狱 杏寿郎〉转为活跃状态，并可以移动至前线
  //            【我方的回合中】本回合中通过我方的事件卡牌或〈炼狱 杏寿郎〉的效果将我方的手牌置于场外的场合，此角色获得BP+500和【冲击①】。
  //            【登场时】将我方任意张数的手牌置于场外，选择对方前线中的最多1张『BP不高于3000』的角色，退场。通过此效果从手牌中置于场外的卡牌每有1张，此效果可选择的角色的BP范围+500。
  "EX05BT/KMY-3-072": [
    staticSelf({ bp: 500, keywords: ["冲击1"] }, all(duringYourTurn, discardedByEventOrKyojuroThisTurn)),
    onPlay(
      chooseFromHand("discarded", { max: 99, prompt: "将任意张数的手牌置于场外（每 1 张使可选择的 BP 范围 +500）" }),
      moveChosen("discarded", "sideline"),
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost((env) => 3000 + 500 * (env.vars.discarded?.length ?? 0)), prompt: "选择对方前线中最多 1 张 BP 不高于 3000（每置于场外 1 张手牌 +500）的角色退场" }),
      sideline(chosen("target")))
  ],

  // 炎之呼吸 壹之型 不知火（事件）：选择对方前线中的1张『BP不高于3000』的角色，退场。抽取1张卡牌，将我方的1张手牌置于场外。我方的场上存在〈炼狱 杏寿郎〉的场合，改为『BP不高于5000』。
  "EX05BT/KMY-3-073": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: sidelineLimit(youHaveNamed("炼狱 杏寿郎")), prompt: "选择对方前线中 1 张 BP 不高于 3000（我方场上有〈炼狱 杏寿郎〉时 5000）的角色退场" }),
    sideline(chosen("target")), draw(1), discard(1))],

  // ---- UA05ST (starter deck) ----

  // 我妻 善逸：【登场时】确认我方卡组最上方的4张卡牌。公开其中最多1张〈灶门 炭治郎〉或〈灶门 祢豆子〉或〈嘴平 伊之助〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UA05ST/KMY-1-001": [onPlay(look(4),
    chooseLooked("pick", { max: 1, filter: tanjiroNezukoInosuke, prompt: "公开最多 1 张〈灶门 炭治郎〉〈灶门 祢豆子〉〈嘴平 伊之助〉并加入手牌" }), moveChosen("pick", "hand"),
    lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // 鳞泷 左近次：【启动主要】[转为休息状态]选择我方场上的其他1张角色，本回合中，BP+1000。 (= UA05BT/KMY-1-003)
  "UA05ST/KMY-1-003": KMY_1_ABILITIES["UA05BT/KMY-1-003"]!,

  // 鎹鸦：【启动主要】[转为休息状态][每回合1次]本回合中，此角色的产生能量+●黄●。当主要阶段结束时，退场此角色。 (= UA05BT/KMY-1-004)
  "UA05ST/KMY-1-004": KMY_1_ABILITIES["UA05BT/KMY-1-004"]!,

  // 栗花落 香奈乎：此角色处于活跃状态的场合，此角色的产生能量+●黄●。 (= UA05BT/KMY-1-014)
  "UA05ST/KMY-1-014": KMY_1_ABILITIES["UA05BT/KMY-1-014"]!,

  // 嘴平 伊之助：【冲击①】 [前线中存在的场合]当我方的攻击阶段结束时，此角色处于活跃状态的场合，将此角色退场。 当此角色在进行攻击的战斗中败北时，将此角色退场。 (= UA05BT/KMY-1-015)
  "UA05ST/KMY-1-015": KMY_1_ABILITIES["UA05BT/KMY-1-015"]!,

  // 水之呼吸 拾之型 生生流转（事件）：选择对方前线中1张[BP不高于3000]的角色退场。我方场上存在<灶门炭治郎>的场合，改为选择[BP不高于5000]。
  //   (same as UA05BT/KMY-1-033, but 炭子 counts as 〈灶门 炭治郎〉)
  "UA05ST/KMY-1-033": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: sidelineLimit(hasRegardedAs("灶门 炭治郎")), prompt: "选择对方前线中 1 张 BP 不高于 3000（我方场上有〈灶门 炭治郎〉时 5000）的角色退场" }),
    sideline(chosen("target")))],

  // 灶门 炭治郎：【撤步】（可以在我方的移动阶段中从前线移动至能量线）  (UA05ST/KMY-1-102: a keyword line only, automatic)

  // 灶门 炭治郎：【突进】〈灶门 炭治郎〉转为活跃状态，并可以移动至前线。
  //            【登场时】我方场上存在〈灶门 祢豆子〉的场合，直到下个我方的回合开始时为止，此角色获得BP+500和【冲击①】。
  //            ■■■■■（trailing marks, not ability text）
  "UA05ST/KMY-1-103": [withCondition(onPlay(bp("self", 500, "untilYourNextTurn"), grant("self", "冲击1", "untilYourNextTurn")), youHaveNamed("灶门 祢豆子"))],

  // 灶门 祢豆子：【登场时】选择对手前线中最多1张所需能量不高于3的角色退场。
  "UA05ST/KMY-1-104": [onPlay(
    chooseOpponent("target", { line: "front", max: 1, filter: energyCostAtMost(3), prompt: "选择对方前线中最多 1 张所需能量不高于 3 的角色退场" }), sideline(chosen("target")))],

  // 锖兔：【登场时】选择我方场上最多1张其他的角色，本回合中，BP+1000。
  "UA05ST/KMY-1-105": [onPlay(
    chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 富冈 义勇：【冲击①】 【登场时】选择对方前线中的最多1张角色转为休息状态。抽取1张卡牌。
  "UA05ST/KMY-1-107": [onPlay(
    chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态" }), rest(chosen("target")), draw(1))],

  // 巨大的岩石（场地）：【启动主要】[转为休息状态][将此卡牌退场]本回合中，我方场上的所有角色BP+1000。
  "UA05ST/KMY-1-108": [activateMain({ costs: [restSelf, sidelineSelf] }, bp(allOwnCharacters, 1000))],

  // 伙伴（事件）：确认我方卡组最上方的5张卡牌。公开其中的最多2张〈灶门 炭治郎〉或〈灶门 祢豆子〉或〈我妻 善逸〉或〈嘴平 伊之助〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。
  "UA05ST/KMY-1-109": [onUse(look(5),
    chooseLooked("pick", { max: 2, filter: withZenitsu, prompt: "公开最多 2 张〈灶门 炭治郎〉〈灶门 祢豆子〉〈我妻 善逸〉〈嘴平 伊之助〉并加入手牌" }), moveChosen("pick", "hand"),
    lookedToBottom())],

  // ---- UA01NC ----

  // 灶门 炭治郎：【我方的回合中】[每回合1次]攻击阶段中当我方场上的角色移动时，选择我方场上最多1张角色，本回合中BP+1000。
  "UA01NC/KMY-2-001": [oncePerTurn(withCondition(when(["onOwnMoveInAttack"],
    chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+1000）" }), bp(chosen("target"), 1000)), duringYourTurn))],

  // 灶门 祢豆子：[能量线中存在的场合]当我方的攻击阶段开始时，选择我方前线中的1张角色，可以与此角色交换位置。
  "UA01NC/KMY-2-002": [withCondition(when(["onAttackStart"],
    chooseOwn("front", { line: "front", min: 1, max: 1, filter: canChangeLine, prompt: "选择我方前线中的 1 张角色（与此角色交换位置）" }),
    ifThen(chosenCount("front"), [may("与此角色交换位置？", run("与所选的前线角色交换位置", (env) => swapPositions(env, env.vars.front?.[0], env.self?.uid)))])),
    all(selfOnEnergy, (env) => !!env.self && canChangeLine(env, env.selfCardId, env.self)))],

  // 甘露寺 蜜璃：【启动主要】[支付1AP][每回合1次]此角色在本回合中，BP+2500。
  "UA01NC/KMY-2-004": [activateMain({ costs: [apCost(1)], once: true }, bp("self", 2500))],

  // 蝴蝶 忍：【启动主要】[前线中存在的场合][每回合1次]选择对方前线中最多1张BP1500或更高的角色，本回合中BP-1000。
  "UA01NC/KMY-2-005": [activateMain({ condition: selfOnFront, once: true },
    chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(1500), prompt: "选择对方前线中最多 1 张 BP1500 或更高的角色（本回合 BP-1000）" }), bp(chosen("target"), -1000))],

  // 不死川 实弥：【我方的回合中】我方场上存在合计3张或更多的〈产屋敷 耀哉〉和其他的[特征:柱]的场合，此角色BP+500。
  //            【登场时】我方场上存在合计6张或更多的〈产屋敷 耀哉〉和其他的[特征:柱]的场合，此角色转为活跃状态。
  "UA01NC/KMY-2-006": [
    staticSelf({ bp: 500 }, all(duringYourTurn, pillarsAtLeast(3))),
    withCondition(onPlay(activate("self")), pillarsAtLeast(6))
  ],

  // 时透 无一郎：我方场上存在合计3张或更多的〈产屋敷 耀哉〉和其他的[特征:柱]的场合，此角色的产生能量+[黄]。
  "UA01NC/KMY-2-007": [staticSelf({ energy: 1 }, pillarsAtLeast(3))],

  // 富冈 义勇：【冲击无效】与此角色进行战斗的角色在本次战斗中，失去冲击。
  //          【登场时】直到我方的下一个回合开始时为止，此角色获得[不会通过对方的角色或事件卡牌的效果退场]。
  //   (the keyword line has no reminder text in brackets, so it is not read as a keyword line and the card data lists no keyword: given here)
  "UA01NC/KMY-2-008": [
    staticSelf({ keywords: ["冲击无效"] }),
    onPlay(flag("self", "noSidelineByOppEffect", "untilYourNextTurn"))
  ],

  // 悲鸣屿 行冥：【登场时】可以将我方的1张手牌置于场外。这样做的场合，从我方的手牌中将最多1张〈悲鸣屿 行冥〉以外的满足所需能量且消费AP为1的拥有特征[柱]的角色以休息状态登场。
  "UA01NC/KMY-2-009": [onPlay(ifThen((env) => env.owner.hand.length > 0, [may("将 1 张手牌置于场外，然后从手牌中登场 1 张〈悲鸣屿 行冥〉以外的柱？",
    discard(1),
    chooseFromHand("card", { max: 1, filter: and(isCharacterCard, notNamed("悲鸣屿 行冥"), withAffinity("柱"), apCostIs(1), affordable), prompt: "从手牌选择最多 1 张〈悲鸣屿 行冥〉以外、满足所需能量且消费 AP 为 1 的“柱”，以休息状态登场" }),
    ifThen(chosenCount("card"), [put("card", "choose", true)]))]))],

  // 宇髓 天元：此角色以活跃状态登场。
  //          【攻击时】选择我方前线中的[特征：天元的妻子]和我方能量线中的〈宇髓 天元〉或[特征：天元的妻子]各1张，可以交换他们的为止。（"为止" read as 位置）
  "UA01NC/KMY-2-010": [
    onPlay(activate("self")),
    when(["onAttack"],
      chooseOwn("front", { line: "front", min: 1, max: 1, filter: and(withAffinity("天元的妻子"), canChangeLine), prompt: "选择我方前线中的 1 张“天元的妻子”（与能量线中的 1 张交换位置）" }),
      chooseOwn("back", { line: "energy", min: 1, max: 1, filter: and(either(named("宇髓 天元"), withAffinity("天元的妻子")), canChangeLine), prompt: "选择我方能量线中的 1 张〈宇髓 天元〉或“天元的妻子”（与前线中的 1 张交换位置）" }),
      ifThen(all(chosenCount("front"), chosenCount("back")), [may("交换他们的位置？", run("交换所选的前线与能量线角色的位置", (env) => swapPositions(env, env.vars.front?.[0], env.vars.back?.[0])))]))
  ],

  // 炼狱 杏寿郎：【冲击无效】与此角色进行战斗的角色在本次战斗中，失去冲击。
  //            [前线中存在的场合]我方场上的〈炼狱 杏寿郎〉以外的角色不会被【瞄准攻击】所指定。
  //            【退场时】选择我方场上最多1张〈炼狱 杏寿郎〉以外的角色，本回合中BP+1000。
  "UA01NC/KMY-2-011": [
    staticSelf({ keywords: ["冲击无效"] }),
    staticAura((env, card, cardOwner) => cardOwner === env.owner && isCharacter(env, card) && env.ctx.card(card.cardId)?.name !== "炼狱 杏寿郎", { flags: ["unsnipeable"] }, selfOnFront),
    onSidelined(chooseOwn("target", { max: 1, filter: notNamed("炼狱 杏寿郎"), prompt: "选择我方场上最多 1 张〈炼狱 杏寿郎〉以外的角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))
  ]
};
