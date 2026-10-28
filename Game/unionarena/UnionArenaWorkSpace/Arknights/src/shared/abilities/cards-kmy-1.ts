/** Abilities of the KMY cards, batch 1 (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, costOf, energyLineOnly, flagsOf, queueCardEvent } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode,
  chooseOpponent, chooseOwn, chosen, chosenCount, costChange, discard, discardCost, draw, duringYourTurn, energyCostAtMost, energyThisTurn, either,
  givenOnly, grantAbility, ifThen, isCharacterCard, look, lookedToBottom, may, moveChosen, named, noneChosen, notSelf, ofColor, onAttack, onPlay,
  onSidelined, onUse, oncePerTurn, opponentHasColor, put, rest, restSelf, run, selfActive, selfOnFront, sideline, sidelineSelf, staticSelf, toHand,
  when, withCondition, youHaveNamed
} from "./dsl.ts";

// ---- Helpers for the KMY cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const findOwn = (env: AbilityEnv, uid: string): UnionArenaFieldCard | undefined => [...env.owner.front, ...env.owner.energy].find((card) => card.uid === uid);
const chosenCards = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => (env.vars[name] ?? []).flatMap((uid) => [...env.opponent.front, ...env.opponent.energy, ...env.owner.front, ...env.owner.energy].filter((card) => card.uid === uid));
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;
/** Required energy of a hand card now (with its own cost changes). */
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy <= limit;
/** Printed required energy of a card in the sideline. */
const printedCostAtMost = (limit: number): CardFilter => (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= limit;
const bpAtLeast = (limit: number): CardFilter => (env, _cardId, card) => !!card && bpOf(env.ctx, card) >= limit;
const yellowCharacter: CardFilter = and(isCharacterCard, ofColor("yellow"));

/** 该角色下一次转为活跃状态无效 (for chosen cards that are resting now). */
const skipNextActivate = (name: string): Step => run("该角色下一次转为活跃状态无效", (env) => {
  for (const card of chosenCards(env, name)) if (card.rested) card.skipNextActivate = true;
});
/** 转为休息状态。该角色下一次转为活跃状态无效。 */
const restAndFreeze = (name: string): Step => ifThen(chosenCount(name), [rest(chosen(name)), skipNextActivate(name)]);

/**
 * The number of 〈产屋敷 耀哉〉 and [特征:柱] characters on our field (both lines). "其他的[特征:柱]" leaves out the ability's own card;
 * an event has no card on the field, so it counts them all.
 */
const pillarCount = (env: AbilityEnv): number =>
  [...env.owner.front, ...env.owner.energy].filter((card) => {
    if (!isCharacter(env, card)) return false;
    const stats = env.ctx.card(card.cardId);
    return stats?.name === "产屋敷 耀哉" || (stats?.affinities.includes("柱") === true && card.uid !== env.self?.uid);
  }).length;
const pillarsAtLeast = (count: number): Condition => (env) => pillarCount(env) >= count;

/** 伊之助/善逸's looked-at names: 〈灶门 炭治郎〉〈灶门 祢豆子〉〈嘴平 伊之助〉 */
const tanjiroNezukoInosuke: CardFilter = either(named("灶门 炭治郎"), named("灶门 祢豆子"), named("嘴平 伊之助"));

/** 从我方的场外加入手牌 a 〈灶门 祢豆子〉 of cost 3 or less and AP cost 1 (炭治郎 1-008). */
const nezukoCostAtMost = (limit: number, source: "hand" | "sideline"): CardFilter =>
  and(named("灶门 祢豆子"), apCostIs(1), source === "hand" ? handCostAtMost(limit) : printedCostAtMost(limit));

/** Looks at a hand card that is a 柱 (柱合会议) before it leaves the looked-at cards. */
const revealedIsPillar = (env: AbilityEnv): boolean => {
  const key = env.vars.pick?.[0];
  const cardId = key ? env.game.looking?.cards[Number(key.slice(2))] : undefined;
  return !!cardId && env.ctx.card(cardId)?.affinities.includes("柱") === true;
};

/** 甘露寺 蜜璃 1-020: the BP range of the character that can be chosen. */
const mitsuriRange = (env: AbilityEnv): number => (pillarCount(env) >= 6 ? 4000 : 3000);

/** 蝴蝶 忍 1-021: its three effects. */
const shinobuDraw: Step[] = [draw(1)];
const shinobuRest: Step[] = [
  chooseOpponent("rest", { line: "front", max: 1, filter: bpAtMost(3000), prompt: "选择对方前线中最多 1 张 BP3000 以下的角色转为休息状态" }),
  rest(chosen("rest"))
];
const shinobuBoost: Step[] = [
  chooseOwn("boost", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }),
  bp(chosen("boost"), 1000)
];

export const KMY_1_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 我妻 善逸：【登场时】确认我方卡组最上方的3张卡牌。公开其中最多1张〈灶门 炭治郎〉或〈灶门 祢豆子〉或〈嘴平 伊之助〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将自己的1张手牌置于場外。
  "UA05BT/KMY-1-001": [onPlay(look(3),
    chooseLooked("pick", { max: 1, filter: tanjiroNezukoInosuke, prompt: "公开最多 1 张〈灶门 炭治郎〉〈灶门 祢豆子〉〈嘴平 伊之助〉并加入手牌" }), moveChosen("pick", "hand"),
    lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // 产屋敷 耀哉：【启动主要】[转为休息状态][将1张手牌置于场外][将此卡牌退场]选择我方的最多1张AP卡牌转为活跃状态。
  "UA05BT/KMY-1-002": [activateMain({ costs: [restSelf, discardCost(1), sidelineSelf] }, chooseAp("ap", 1), activateAp("ap"))],

  // 鳞泷 左近次：【启动主要】[转为休息状态]选择我方场上1张其他角色，本回合中BP+1000。
  "UA05BT/KMY-1-003": [activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 鎹鸦：【启动主要】[转为休息状态][每回合1次]本回合中，此角色产生能量+●黄●。主要阶段结束时，将此角色退场。
  "UA05BT/KMY-1-004": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 灶门 炭治郎：【登场时】从我方手牌中将最多1张所需能量不高于2且消费AP为1的〈灶门 祢豆子〉在我方前线中以休息状态登场。
  "UA05BT/KMY-1-006": [onPlay(
    chooseFromHand("card", { max: 1, filter: nezukoCostAtMost(2, "hand"), prompt: "从手牌选择最多 1 张所需能量不高于 2、消费 AP 为 1 的〈灶门 祢豆子〉，在前线以休息状态登场" }),
    ifThen(chosenCount("card"), [put("card", "front", true)]))],

  // 灶门 炭治郎：【登场时】选择对方前线中最多1张BP不高于3000的角色退场。
  "UA05BT/KMY-1-007": [onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3000), prompt: "选择对方前线中最多 1 张 BP 不高于 3000 的角色退场" }), sideline(chosen("target")))],

  // 灶门 炭治郎：【突进】〈灶门 炭治郎〉转为活跃状态，并可以移动至前线。 【冲击①】
  //            【登场时】从我方场外将最多1张所需能量不高于3且消费AP为1的〈灶门 祢豆子〉加入手牌。从我方手牌中将最多1张所需能量不高于3且消费AP为1的〈灶门 祢豆子〉以休息状态登场。
  //            ■■■■■（trailing marks, not ability text）
  "UA05BT/KMY-1-008": [onPlay(
    chooseFromSideline("back", { max: 1, filter: nezukoCostAtMost(3, "sideline"), prompt: "从场外选择最多 1 张所需能量不高于 3、消费 AP 为 1 的〈灶门 祢豆子〉加入手牌" }), moveChosen("back", "hand"),
    chooseFromHand("card", { max: 1, filter: nezukoCostAtMost(3, "hand"), prompt: "从手牌选择最多 1 张所需能量不高于 3、消费 AP 为 1 的〈灶门 祢豆子〉，以休息状态登场" }),
    ifThen(chosenCount("card"), [put("card", "choose", true)]))],

  // 灶门 祢豆子：【我方的回合中】我方场上存在〈灶门 炭治郎〉的场合，此角色的BP+1000。
  "UA05BT/KMY-1-009": [staticSelf({ bp: 1000 }, all(duringYourTurn, youHaveNamed("灶门 炭治郎")))],

  // 灶门 祢豆子：【登场时】[前线中存在的场合]我方场上存在〈灶门 炭治郎〉的场合，选择对手前线中的最多1张BP1500或更高的角色，本回合中，BP-1000。
  "UA05BT/KMY-1-010": [withCondition(onPlay(
    chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(1500), prompt: "选择对方前线中最多 1 张 BP1500 或更高的角色（本回合 BP-1000）" }), bp(chosen("target"), -1000)),
    all(selfOnFront, youHaveNamed("灶门 炭治郎")))],

  // 灶门 祢豆子：【突进】〈灶门 祢豆子〉转为活跃状态，并可以移动至前线。
  //            【我方的回合中】我方场上存在〈灶门 炭治郎〉的场合，此角色的BP+500。
  //            【攻击时】选择我方前线中的〈灶门 炭治郎〉和我方能量线中的其他角色各1张，可以交换他们的位置。
  "UA05BT/KMY-1-011": [
    staticSelf({ bp: 500 }, all(duringYourTurn, youHaveNamed("灶门 炭治郎"))),
    onAttack(
      chooseOwn("tanjiro", { line: "front", min: 1, max: 1, filter: and(named("灶门 炭治郎"), canSwap), prompt: "选择我方前线中的 1 张〈灶门 炭治郎〉（与能量线中的 1 张其他角色交换位置）" }),
      chooseOwn("other", { line: "energy", min: 1, max: 1, filter: canSwap, prompt: "选择我方能量线中的 1 张其他角色（与〈灶门 炭治郎〉交换位置）" }),
      ifThen(all(chosenCount("tanjiro"), chosenCount("other")), [may("交换他们的位置？", run("交换〈灶门 炭治郎〉与能量线中的角色的位置", (env) => {
        const front = findOwn(env, env.vars.tanjiro![0]!);
        const back = findOwn(env, env.vars.other![0]!);
        if (!front || !back || !env.owner.front.includes(front) || !env.owner.energy.includes(back)) return;
        env.owner.front = env.owner.front.map((card) => (card === front ? back : card));
        env.owner.energy = env.owner.energy.map((card) => (card === back ? front : card));
        queueCardEvent(env.game, env.ctx, "onMoveToEnergy", env.owner, front);
        queueCardEvent(env.game, env.ctx, "onMoveToFront", env.owner, back);
      }))]))
  ],

  // 不死川 玄弥：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）
  //            (keyword line only: the keyword is already in the card data; the entry makes the card count as automated)
  "UA05BT/KMY-1-012": [],

  // 不死川 玄弥：【我方的回合中】[每回合1次]对方前线中的角色退场时，可以抽取1张卡牌。那样做的场合，将我方的1张手牌置于场外。
  "UA05BT/KMY-1-013": [withCondition(oncePerTurn(when(["onOpponentFrontSidelined"], may("抽取 1 张卡牌，然后将 1 张手牌置于场外？", draw(1), discard(1)))), duringYourTurn)],

  // 栗花落 香奈乎：此角色处于活跃状态的场合，此角色产生能量+●黄●。
  "UA05BT/KMY-1-014": [staticSelf({ energy: 1 }, selfActive)],

  // 嘴平 伊之助：【冲击①】（当在进行攻击的战斗中胜利时，给与对方玩家1点伤害）
  //            [前线中存在的场合]我方的攻击阶段结束时，此角色处于活跃状态的场合，将此角色退场。
  //            当此角色在进行攻击的战斗中败北时，将此角色退场。
  "UA05BT/KMY-1-015": [
    withCondition(when(["onAttackPhaseEnd"], sideline("self")), all(selfOnFront, selfActive)),
    when(["onLoseAttackBattle"], sideline("self"))
  ],

  // 村田：【撤步】（可以在我方移动阶段从前线移动至能量线）
  //     (keyword line only)
  "UA05BT/KMY-1-016": [],

  // 伊黑 小芭内：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UA05BT/KMY-1-017": [onPlay(draw(1), discard(1))],

  // 宇髓 天元：【撤步】（可以在我方移动阶段从前线移动至能量线）
  //          (keyword line only)
  "UA05BT/KMY-1-018": [],

  // 甘露寺 蜜璃：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，此角色放回手牌。
  "UA05BT/KMY-1-019": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // 甘露寺 蜜璃：【登场时】[前线中存在的场合]我方场上存在合计3~5张的〈产屋敷 耀哉〉和其他的[特征:柱]的场合，选择对方前线中的最多1张[BP不高于3000]的角色退场。
  //            我方场上存在合计6张或更多的〈产屋敷 耀哉〉和其他的[特征:柱]的场合，改为选择[BP不高于4000]。
  "UA05BT/KMY-1-020": [withCondition(onPlay(
    chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(mitsuriRange), prompt: "选择对方前线中最多 1 张 BP 不高于 3000（柱合计 6 张以上时 4000）的角色退场" }), sideline(chosen("target"))),
    all(selfOnFront, pillarsAtLeast(3)))],

  // 蝴蝶 忍：【登场时】从以下选择[1项]。我方我方场上存在合计6张或更多的〈产屋敷 耀哉〉和其他的[特征:柱]的场合，改为选择[全部]。
  //        ·抽取1张卡牌。 ·选择对方前线中的最多1张BP3000以下的角色，转为休息状态。 ·选择我方场上的最多1张其他角色，本回合中，BP+1000。
  "UA05BT/KMY-1-021": [onPlay(ifThen(pillarsAtLeast(6), [...shinobuDraw, ...shinobuRest, ...shinobuBoost], [
    chooseMode("mode", ["抽取1张卡牌。", "选择对方前线中的最多1张BP3000以下的角色，转为休息状态。", "选择我方场上的最多1张其他角色，本回合中，BP+1000。"]),
    ifThen(modeIs("mode", 0), shinobuDraw),
    ifThen(modeIs("mode", 1), shinobuRest),
    ifThen(modeIs("mode", 2), shinobuBoost)
  ]))],

  // 不死川 实弥：【2次攻击】（当此角色在本回合中首次进行攻击时，转为活跃状态）。
  //            (keyword line only)
  "UA05BT/KMY-1-022": [],

  // 时透 无一郎：对方场上存在紫色或红色卡牌的场合，手牌中的此卡牌所需能量减少●キ黄×1●。
  "UA05BT/KMY-1-023": [costChange({ energy: 1 }, opponentHasColor("purple", "red"))],

  // 时透 无一郎：【登场时】选择对方前线中的最多1张角色，转为休息状态，该角色的下1次转为活跃状态无效。
  //            【退场时】选择对方前线中的最多1张角色，转为休息状态。
  "UA05BT/KMY-1-024": [
    onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态（下一次转为活跃状态无效）" }), restAndFreeze("target")),
    onSidelined(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态" }), rest(chosen("target")))
  ],

  // 富冈 义勇：【攻击时】抽取1张卡牌。
  "UA05BT/KMY-1-025": [onAttack(draw(1))],

  // 悲鸣屿 行冥：我方我方场上存在合计3张或更多的〈产屋敷 耀哉〉和其他的[特征:柱]的场合，此角色获得【冲击①】。
  "UA05BT/KMY-1-026": [staticSelf({ keywords: ["冲击1"] }, pillarsAtLeast(3))],

  // 炼狱 杏寿郎：我方我方场上存在合计3张或更多的〈产屋敷 耀哉〉和其他的[特征:柱]的场合，此角色获得【2次阻挡】。
  "UA05BT/KMY-1-027": [staticSelf({ keywords: ["2次阻挡"] }, pillarsAtLeast(3))],

  // 蝴蝶屋（场地）：【启动主要】[转为休息状态][将此卡牌退场]从我方场外将最多2张所需能量不高于3的黄色角色卡牌加入手牌。
  "UA05BT/KMY-1-028": [activateMain({ costs: [restSelf, sidelineSelf] },
    chooseFromSideline("cards", { max: 2, filter: and(yellowCharacter, printedCostAtMost(3)), prompt: "从场外选择最多 2 张所需能量不高于 3 的黄色角色加入手牌" }), moveChosen("cards", "hand"))],

  // 全集中呼吸（事件）：选择我方的最多2张AP卡牌转为活跃状态。
  "UA05BT/KMY-1-029": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 柱合会议（事件）：确认我方卡组最上方的4张卡牌。公开其中1张卡牌并加入手牌。剩余的卡牌自选顺序置于卡组最下方。公开的卡牌为[特征:柱]的场合，选择我方的最多1张AP卡牌转为活跃状态。
  "UA05BT/KMY-1-030": [onUse(look(4),
    chooseLooked("pick", { min: 1, max: 1, prompt: "公开其中 1 张卡牌并加入手牌" }),
    run("公开的卡牌是否为[特征:柱]", (env) => { env.vars.pillar = revealedIsPillar(env) ? ["yes"] : []; }),
    moveChosen("pick", "hand"), lookedToBottom(),
    ifThen(chosenCount("pillar"), [chooseAp("ap", 1), activateAp("ap")]))],

  // 柱合审判（事件）：选择对方前线中的1张[BP不高于3000]的角色退场。我方我方场上存在合计3张或更多的〈产屋敷 耀哉〉和[特征:柱]的场合，改为选择[BP不高于5000]。
  "UA05BT/KMY-1-031": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (pillarCount(env) >= 3 ? 5000 : 3000)), prompt: "选择对方前线中 1 张 BP 不高于 3000（柱合计 3 张以上时 5000）的角色退场" }), sideline(chosen("target")))],

  // 判断太慢了（事件）：选择对方前线中的1张角色，转为休息状态。选择我方场上最多1张〈鳞泷 左近次〉，转为活跃状态。
  "UA05BT/KMY-1-032": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色转为休息状态" }), rest(chosen("target")),
    chooseOwn("sakonji", { max: 1, filter: named("鳞泷 左近次"), prompt: "选择我方场上最多 1 张〈鳞泷 左近次〉转为活跃状态" }), activate(chosen("sakonji")))],

  // 水之呼吸 拾之型 生生流转（事件）：选择对方前线中的1张[BP不高于3000]的角色退场。我方场上存在〈灶门 炭治郎〉的场合，改为选择[BP不高于5000]。
  "UA05BT/KMY-1-033": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (youHaveNamed("灶门 炭治郎")(env) ? 5000 : 3000)), prompt: "选择对方前线中 1 张 BP 不高于 3000（我方场上有〈灶门 炭治郎〉时 5000）的角色退场" }), sideline(chosen("target")))]
};

/** A field card that an effect can swap to the other line (not 无法移动). */
function canSwap(env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null): boolean {
  return !!card && !flagsOf(card).includes("cannotMove") && (env.owner.front.includes(card) || !energyLineOnly(env.ctx, cardId));
}
