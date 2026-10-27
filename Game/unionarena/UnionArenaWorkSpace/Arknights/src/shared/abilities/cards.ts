/**
 * The card abilities the engine runs, by card number. Each entry follows the card's printed text (shown above it); a card that is not
 * listed has its text applied by hand. Keyword abilities printed at the start of a line (《冲击无效》...) are already in the card data and are
 * not repeated here.
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import type { Ability, AbilityEnv, Condition } from "./types.ts";
import {
  activate, activateAp, activateMain, activeCard, all, and, apCost, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode,
  chooseOpponent, chooseOwn, chosen, chosenCount, costChange, countPrintedBp, discard, discardCost, draw, duringOpponentTurn, duringYourTurn, either,
  energyCostAtMost, energyThisTurn, flag, frontHasPrintedBp, givenOnly, grant, grantAbility, hasKeywordNow, ifThen, isCharacterCard, look, lookedToBottom,
  may, moveChosen, moveLine, named, noneChosen, notNamed, notSelf, ofColor, onAttack, onBlock, onPlay, onSidelined, onUse, opponentFrontHasCharacters,
  opponentHasColor, opponentRestedAtLeast, otherOwnFront, ownFieldEmpty, printedBp, put, rest, restSelf, run, selfActive, selfOnFront, selfRested,
  sideline, sidelineSelf, sidelinedByBpOrOpponent, staticAura, staticSelf, toHand, when, withAffinity, withCondition, withKeyword, youHaveKeywordCharacter,
  youHaveNamed
} from "./dsl.ts";
import { BLUE_A_ABILITIES } from "./cards-blue-a.ts";
import { BLUE_B_ABILITIES } from "./cards-blue-b.ts";
import { PURPLE_ABILITIES } from "./cards-purple.ts";
import { YELLOW_ABILITIES } from "./cards-yellow.ts";

// ---- Helpers for the red cards ----
const fieldCharacters = (env: AbilityEnv, owner = env.owner): UnionArenaFieldCard[] => [...owner.front, ...owner.energy].filter((card) => env.ctx.card(card.cardId)?.type === "character");
/** The first chosen field card has a keyword now. */
const chosenHas = (name: string, keyword: string): Condition => (env) => {
  const uid = env.vars[name]?.[0];
  const card = uid ? [...env.owner.front, ...env.owner.energy].find((entry) => entry.uid === uid) : undefined;
  return !!card && hasKeywordNow(env, card, keyword);
};
/** 我方能量线中存在原本的BP为2500的活跃状态的角色 */
const energyHasActive2500: Condition = (env) => env.owner.energy.some((card) => !card.rested && env.ctx.card(card.cardId)?.bp === 2500 && env.ctx.card(card.cardId)?.type === "character");
/** 我方前线中存在（此卡以外的）原本的BP为2500的活跃状态的角色 */
const frontHasOtherActive2500: Condition = (env) => env.owner.front.some((card) => card.uid !== env.self?.uid && !card.rested && env.ctx.card(card.cardId)?.bp === 2500);
/** 手牌中有N张“特征：affinity” */
const handHasAffinity = (affinity: string, count: number): Condition => (env) => env.owner.hand.filter((cardId) => env.ctx.card(cardId)?.affinities.includes(affinity)).length >= count;
/** 此角色的同线中存在（其他）拥有《keyword》的角色 */
const sameLineHasKeyword = (keyword: string): Condition => (env) => {
  if (!env.self) return false;
  const line = env.owner.front.includes(env.self) ? env.owner.front : env.owner.energy;
  return line.some((card) => card.uid !== env.self!.uid && hasKeywordNow(env, card, keyword));
};
/** 我方前线中的〈林〉以外的角色 (aura of 林) */
const ownFrontExceptLin = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.owner.front.includes(card) && env.ctx.card(card.cardId)?.name !== "林" && env.ctx.card(card.cardId)?.type === "character";
/** The total printed BP of the picked cards is at most `limit`. */
const totalBpAtMost = (limit: number) => (env: AbilityEnv, cardIds: string[]): boolean => cardIds.reduce((sum, cardId) => sum + (env.ctx.card(cardId)?.bp ?? 0), 0) <= limit;
/** Records that a (non-automatic) 每回合1次 ability of this card has been used. */
const markUsed = (index: number) => (env: AbilityEnv): void => { if (env.self) env.self.used = [...(env.self.used ?? []), index]; };
const notUsed = (index: number): Condition => (env) => !!env.self && !(env.self.used ?? []).includes(index);
const red2500AP1 = and(isCharacterCard, printedBp(2500), apCostIs(1), ofColor("red"));

export const CARD_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 米莎：【退场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UC01BT/ARK-1-001": [onSidelined(draw(1), discard(1))],

  // 米莎：【登场时】选择我方场上的最多1张所需能量不高于2的角色，本回合中，BP+2000。
  "UC01BT/ARK-1-002": [onPlay(chooseOwn("target", { max: 1, filter: energyCostAtMost(2), prompt: "选择我方场上最多 1 张所需能量不高于 2 的角色（本回合 BP+2000）" }), bp(chosen("target"), 2000))],

  // 塔露拉：此角色处于活跃状态的场合，此角色的产生能量+(黄)。
  "UC01BT/ARK-1-014": [staticSelf({ energy: 1 }, selfActive)],

  // 爱国者：对方的场上存在2张或更多休息状态的角色的场合，手牌中此卡牌的所需能量减少4。
  //        【启动主要】〔将1张手牌置于场外〕「每回合1次」只有在对方的场上存在2张或更多休息状态的角色的场合才能发动。此角色在本回合中，获得《伤害2》。
  "UC01BT/ARK-1-017": [
    costChange({ energy: 4 }, opponentRestedAtLeast(2)),
    activateMain({ costs: [discardCost(1)], condition: opponentRestedAtLeast(2), once: true }, grant("self", "伤害2"))
  ],

  // 废城：【启动主要】〔转为休息状态〕〔将1张手牌置于场外〕只有在对方的场上存在2张或更多休息状态的角色的场合才能发动。选择我方场上的1张角色，转为活跃状态。
  "UC01BT/ARK-1-028": [
    activateMain({ costs: [restSelf, discardCost(1)], condition: opponentRestedAtLeast(2) }, chooseOwn("target", { min: 1, max: 1, prompt: "选择我方场上的 1 张角色转为活跃状态" }), activate(chosen("target")))
  ],

  // 芙兰卡：【攻击时】我方的前线中存在原本的BP为2500的角色的场合，此角色在本回合中，获得BP+2000和《冲击1》。【阻挡时】此角色在本回合中，BP-2000。
  "UC01BT/ARK-1-068": [
    withCondition(onAttack(bp("self", 2000), grant("self", "冲击1")), frontHasPrintedBp(2500)),
    onBlock(bp("self", -2000))
  ],

  // 诗怀雅：【登场时】【退场时】选择我方场上的最多1张其他角色，本回合中，BP+1000。
  "UC01BT/ARK-1-083": [when(["onPlay", "onSidelined"], chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 赤霄・拔刀（事件）：选择对方前线中的1张『BP不高于3000』的角色退场。我方的场上存在〈陈〉的场合，改为『BP不高于5000』。
  "UC01BT/ARK-1-096": [
    onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (youHaveNamed("陈")(env) ? 5000 : 3000)), prompt: "选择对方前线中 1 张 BP 不高于 3000（我方有〈陈〉时为 5000）的角色退场" }), sideline(chosen("target")))
  ],

  // 临光：【登场时】【阻挡时】【退场时】我方前线中的所有其他角色，本回合中，BP+1000。
  "UC01ST/ARK-1-104": [when(["onPlay", "onBlock", "onSidelined"], bp(otherOwnFront, 1000))],

  // ======== Red (龙门 / 企鹅物流 / 黑钢国际 / 红色罗德岛) ========

  // 杰西卡：【启动主要】〔转为休息状态〕「每回合1次」选择我方场上的最多1张原本的BP为2500的其他角色，本回合中，BP+1500。
  "UC01BT/ARK-1-067": [activateMain({ costs: [restSelf], once: true }, chooseOwn("target", { max: 1, filter: and(notSelf, printedBp(2500)), prompt: "选择我方场上最多 1 张原本 BP 为 2500 的其他角色（本回合 BP+1500）" }), bp(chosen("target"), 1500))],

  // 雷蛇：【阻挡时】我方的前线中存在原本的BP为2500的角色的场合，选择我方场上的最多1张角色，本回合中，BP+500。
  "UC01BT/ARK-1-069": [withCondition(onBlock(chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+500）" }), bp(chosen("target"), 500)), frontHasPrintedBp(2500))],

  // 能天使：【登场时】选择我方场上的最多1张原本的BP为2500的角色，本回合中，BP+1500。
  "UC01BT/ARK-1-070": [onPlay(chooseOwn("target", { max: 1, filter: printedBp(2500), prompt: "选择我方场上最多 1 张原本 BP 为 2500 的角色（本回合 BP+1500）" }), bp(chosen("target"), 1500))],

  // 能天使：【启动主要】「每回合1次」此角色转为活跃状态。此角色在本回合中，BP-2000。
  "UC01BT/ARK-1-071": [activateMain({ once: true }, activate("self"), bp("self", -2000))],

  // 能天使：当此角色的攻击结束时，对方的前线中存在角色的场合，可以将我方能量线中的1张原本的BP为2500的活跃状态的角色转为休息状态。
  //        这样做的场合，此角色转为活跃状态，此角色在本回合中，BP-1500。
  "UC01BT/ARK-1-072": [withCondition(when(["onAttackEnd"], may("将能量线中 1 张原本 BP 为 2500 的活跃角色转为休息，使此角色转为活跃（本回合 BP-1500）？",
    chooseOwn("cost", { line: "energy", min: 1, max: 1, filter: and(printedBp(2500), activeCard), prompt: "选择能量线中 1 张原本 BP 为 2500 的活跃角色转为休息" }),
    ifThen(chosenCount("cost"), [rest(chosen("cost")), activate("self"), bp("self", -1500)]))), all(opponentFrontHasCharacters, energyHasActive2500))],

  // 德克萨斯：【登场时】确认我方卡组最上方的5张卡牌。公开其中最多1张〈德克萨斯〉以外的BP为2500的红色角色卡牌并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  "UC01BT/ARK-1-075": [onPlay(look(5), chooseLooked("pick", { max: 1, filter: and(notNamed("德克萨斯"), isCharacterCard, printedBp(2500), ofColor("red")), prompt: "公开最多 1 张〈德克萨斯〉以外 BP 为 2500 的红色角色卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom())],

  // 德克萨斯：【登场时】从我方的手牌中将最多1张BP为2500且消费AP为1的红色角色卡牌在我方的场上以休息状态登场。通过此效果在能量线中登场的场合，该角色转为活跃状态。
  //          【启动主要】〔前线中存在的场合〕〔将1张手牌置于场外〕「每回合1次」选择我方场上的1张原本的BP为2500的角色，本回合中，BP+1500。
  "UC01BT/ARK-1-076": [
    onPlay(chooseFromHand("card", { max: 1, filter: red2500AP1, prompt: "从手牌选择最多 1 张 BP 为 2500、消费 AP 为 1 的红色角色登场（在能量线登场时转为活跃）" }), put("card", "choose", true, true)),
    activateMain({ costs: [discardCost(1)], condition: selfOnFront, once: true }, chooseOwn("target", { min: 1, max: 1, filter: printedBp(2500), prompt: "选择我方场上 1 张原本 BP 为 2500 的角色（本回合 BP+1500）" }), bp(chosen("target"), 1500))
  ],

  // 阿米娅：此角色处于活跃状态的场合，此角色的产生能量+[红]。
  "UC01BT/ARK-1-077": [staticSelf({ energy: 1 }, selfActive)],

  // 凯尔希：对方的场上存在黄色或蓝色卡牌的场合，手牌中此卡牌的所需能量减少1。
  "UC01BT/ARK-1-078": [costChange({ energy: 1 }, opponentHasColor("yellow", "blue"))],

  // 霜叶：【登场时】选择对方场上的最多1张角色，直到我方的下一个回合开始时为止，对方无法将被选择的角色移动，无法通过自己的卡牌效果转为休息状态。
  "UC01BT/ARK-1-079": [onPlay(chooseOpponent("target", { max: 1, prompt: "选择对方场上最多 1 张角色（直到我方下一回合开始：不能移动，不能被对方自己的效果转为休息）" }), flag(chosen("target"), "cannotMove", "untilYourNextTurn"), flag(chosen("target"), "noSelfRest", "untilYourNextTurn"))],

  // 魏彦吾：【登场时】确认我方卡组最上方的4张卡牌。公开其中最多1张“特征：龙门”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UC01BT/ARK-1-081": [onPlay(look(4), chooseLooked("pick", { max: 1, filter: withAffinity("龙门"), prompt: "公开最多 1 张“特征：龙门”的卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // 诗怀雅：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UC01BT/ARK-1-082": [onPlay(draw(1), discard(1))],

  // 陈：【启动主要】「每回合1次」可以将我方手牌中的2张“特征：龙门”置于场外。这样做的场合，此角色在本回合中，获得BP+500和《伤害2》。
  "UC01BT/ARK-1-085": [activateMain({ once: true }, ifThen(handHasAffinity("龙门", 2), [may("将手牌中 2 张“特征：龙门”置于场外，使此角色本回合 BP+500 并获得《伤害2》？",
    chooseFromHand("cost", { min: 2, max: 2, filter: withAffinity("龙门"), prompt: "选择手牌中 2 张“特征：龙门”置于场外" }), moveChosen("cost", "sideline"), bp("self", 500), grant("self", "伤害2"))]))],

  // 陈：【退场时】从我方的场外将最多1张〈赤霄・拔刀〉或拥有《2次阻挡》的角色卡牌加入手牌。
  "UC01BT/ARK-1-086": [onSidelined(chooseFromSideline("card", { max: 1, filter: either(named("赤霄・拔刀"), and(isCharacterCard, withKeyword("2次阻挡"))), prompt: "从场外选择最多 1 张〈赤霄・拔刀〉或拥有《2次阻挡》的角色卡加入手牌" }), moveChosen("card", "hand"))],

  // 陈：我方场上的拥有《2次阻挡》的角色每有1张，场上以外的所有场所的此卡牌的所需能量减少1。
  //    【启动主要】「前线中存在的场合」「每回合1次」选择我方场上的1张角色，本回合中，BP+1000。选择的角色拥有《2次阻挡》的场合，抽取1张卡牌。
  "UC01BT/ARK-1-087": [
    costChange({ energy: (env) => fieldCharacters(env).filter((card) => hasKeywordNow(env, card, "2次阻挡")).length }),
    activateMain({ condition: selfOnFront, once: true }, chooseOwn("target", { min: 1, max: 1, prompt: "选择我方场上 1 张角色（本回合 BP+1000；拥有《2次阻挡》时抽 1 张）" }), bp(chosen("target"), 1000), ifThen(chosenHas("target", "2次阻挡"), [draw(1)]))
  ],

  // 文月：【启动主要】〔转为休息状态〕「每回合1次」此角色在本回合中，获得产生能量+(红)和“当主要阶段结束时，将此角色退场”。
  "UC01BT/ARK-1-089": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 星熊：【退场时】因BP变为0或更低或通过对方的效果，此角色退场的场合，选择对方前线中的最多1张BP不高于3000的角色退场。
  "UC01BT/ARK-1-091": [withCondition(onSidelined(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3000), prompt: "选择对方前线中最多 1 张 BP 不高于 3000 的角色退场" }), sideline(chosen("target"))), sidelinedByBpOrOpponent)],

  // 星熊：【启动主要】「前线中存在的场合」「每回合1次」选择我方场上的1张角色，本回合中，BP+1000。选择的角色拥有《伤害2》的场合，此角色直到下一个我方的回合开始时为止，BP+1000。
  "UC01BT/ARK-1-092": [activateMain({ condition: selfOnFront, once: true }, chooseOwn("target", { min: 1, max: 1, prompt: "选择我方场上 1 张角色（本回合 BP+1000）" }), bp(chosen("target"), 1000), ifThen(chosenHas("target", "伤害2"), [bp("self", 1000, "untilYourNextTurn")]))],

  // 米莎：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。
  "UC01BT/ARK-1-093": [onPlay(chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }), toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // 林：「前线中存在的场合」此角色处于休息状态的场合，我方前线中的〈林〉以外的角色，不会被对方角色的效果选择。【我方的回合中】结束阶段中此角色可以不转为活跃状态。
  "UC01BT/ARK-1-094": [
    staticAura(ownFrontExceptLin, { flags: ["untargetable:character"] }, all(selfOnFront, selfRested)),
    withCondition(when(["onEndStart"], may("结束阶段中「林」不转为活跃状态？", flag("self", "stayRested"))), all(duringYourTurn, selfRested))
  ],

  // 龙门（场地）：【启动主要】〔转为休息状态〕〔将此卡牌退场〕选择我方场上的最多1张“特征：龙门”，本回合中，给予《冲击+1》。
  "UC01BT/ARK-1-095": [activateMain({ costs: [restSelf, sidelineSelf] }, chooseOwn("target", { max: 1, filter: withAffinity("龙门"), prompt: "选择我方场上最多 1 张“特征：龙门”（本回合给予《冲击+1》）" }), grant(chosen("target"), "冲击+1"))],

  // 弹幕！（事件）：选择对方前线中的1张『BP不高于2000』的角色退场。我方场上的原本的BP为2500的角色每有1张，此效果可选择角色的BP范围+1000。
  "UC01BT/ARK-1-097": [onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => 2000 + 1000 * countPrintedBp(env, 2500)), prompt: "选择对方前线中 1 张 BP 不高于 2000（我方每有 1 张原本 BP 2500 的角色 +1000）的角色退场" }), sideline(chosen("target")))],

  // 企鹅物流（事件）：确认我方卡组最上方的7张卡牌。公开其中“特征：企鹅物流”和BP为2500的角色卡牌最多各1张并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  "UC01BT/ARK-1-098": [onUse(look(7),
    chooseLooked("penguin", { max: 1, filter: withAffinity("企鹅物流"), prompt: "公开最多 1 张“特征：企鹅物流”的卡" }),
    chooseLooked("bp2500", { max: 1, filter: and(isCharacterCard, printedBp(2500)), exclude: "penguin", prompt: "公开最多 1 张 BP 为 2500 的角色卡" }),
    moveChosen(["penguin", "bp2500"], "hand"), lookedToBottom())],

  // 龙门近卫局（事件）：我方场上所有拥有《伤害2》或《2次阻挡》的角色，本回合中，给予“此角色不会被BP不高于3000的角色阻挡”。
  "UC01BT/ARK-1-099": [onUse(flag((env) => fieldCharacters(env).filter((card) => hasKeywordNow(env, card, "伤害2") || hasKeywordNow(env, card, "2次阻挡")), "unblockableBpAtMost:3000"))],

  // 龙门币（事件）：选择我方的最多2张AP卡牌，转为活跃状态。
  "UC01BT/ARK-1-100": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 能天使：【启动主要】「每回合1次」将此角色移动至其他线。
  "UC01ST/ARK-1-112": [activateMain({ once: true }, moveLine("self"))],

  // 陈：【启动主要】〔支付1AP〕「每回合1次」此角色在本回合中，获得《伤害2》。【攻击时】我方的场上存在拥有《2次阻挡》的角色的场合，抽取1张卡牌，将我方的1张手牌置于场外。
  "UC01ST/ARK-1-113": [
    activateMain({ costs: [apCost(1)], once: true }, grant("self", "伤害2")),
    withCondition(onAttack(draw(1), discard(1)), youHaveKeywordCharacter("2次阻挡"))
  ],

  // 莫斯提马：【登场时】对方前线中的所有角色，本回合中，给予“当此角色在进行阻挡的战斗中胜利时，将此角色移动至能量线”。
  "UCEX01BT/ARK-2-062": [
    onPlay(grantAbility((env) => env.opponent.front.filter((card) => env.ctx.card(card.cardId)?.type === "character"), 1)),
    givenOnly(when(["onWinBlock"], ifThen((env) => !!env.self && env.owner.front.includes(env.self), [moveLine("self")])))
  ],

  // 能天使：【对方的回合中】「前线中存在的场合」此角色BP-2000。
  //        【退场时】确认我方卡组最上方的3张卡牌。公开其中最多1张“特征：企鹅物流”或BP为2500的角色卡牌并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  "UCEX01BT/ARK-2-063": [
    staticSelf({ bp: -2000 }, all(duringOpponentTurn, selfOnFront)),
    onSidelined(look(3), chooseLooked("pick", { max: 1, filter: either(withAffinity("企鹅物流"), and(isCharacterCard, printedBp(2500))), prompt: "公开最多 1 张“特征：企鹅物流”或 BP 为 2500 的角色卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom())
  ],

  // 可颂：【阻挡时】可以将我方前线中的1张原本的BP为2500的活跃状态的角色转为休息状态。这样做的场合，此角色在本回合中，BP+2500。
  "UCEX01BT/ARK-2-064": [withCondition(onBlock(may("将前线中 1 张原本 BP 为 2500 的活跃角色转为休息，使「可颂」本回合 BP+2500？",
    chooseOwn("cost", { line: "front", min: 1, max: 1, filter: and(notSelf, printedBp(2500), activeCard), prompt: "选择前线中 1 张原本 BP 为 2500 的活跃角色转为休息" }),
    ifThen(chosenCount("cost"), [rest(chosen("cost")), bp("self", 2500)]))), frontHasOtherActive2500)],

  // 空：此角色无法进行攻击。【启动主要】〔转为休息状态〕从下列选择1项。
  //    •选择我方场上的1张其他角色，本回合中，BP+500。 •选择我方场上的1张其他角色，本回合中，BP+1500。将此角色放回手牌。
  "UCEX01BT/ARK-2-065": [
    staticSelf({ flags: ["cannotAttack"] }),
    activateMain({ costs: [restSelf] },
      chooseMode("mode", ["选择我方场上的1张其他角色，本回合中，BP+500。", "选择我方场上的1张其他角色，本回合中，BP+1500。将此角色放回手牌。"]),
      chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色" }),
      ifThen((env) => env.vars.mode?.[0] === "m:0", [bp(chosen("target"), 500)], [bp(chosen("target"), 1500), toHand("self")]))
  ],

  // 德克萨斯：我方的场上1张卡牌也没有的场合，手牌中此卡牌的所需能量减少2。
  //          【退场时】从我方的手牌中将最多1张〈德克萨斯〉以外的BP为2500且消费AP为1的红色的角色卡牌在我方的前线中以休息状态登场。
  "UCEX01BT/ARK-2-066": [
    costChange({ energy: 2 }, ownFieldEmpty),
    onSidelined(chooseFromHand("card", { max: 1, filter: and(notNamed("德克萨斯"), red2500AP1), prompt: "从手牌选择最多 1 张〈德克萨斯〉以外 BP 为 2500、消费 AP 为 1 的红色角色，以休息状态登场到前线" }), put("card", "front", true))
  ],

  // 诗怀雅：【退场时】选择我方场上的最多1张其他角色，本回合中，BP+3000。
  "UCEX01BT/ARK-2-067": [onSidelined(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+3000）" }), bp(chosen("target"), 3000))],

  // 陈：【退场时】抽取1张卡牌。
  "UCEX01BT/ARK-2-068": [onSidelined(draw(1))],

  // 陈：【启动主要】「每回合1次」只有在此角色的同线中存在拥有《2次阻挡》的角色的场合才能发动，此角色在本回合中，获得《伤害2》。
  "UCEX01BT/ARK-2-069": [activateMain({ condition: sameLineHasKeyword("2次阻挡"), once: true }, grant("self", "伤害2"))],

  // 星熊：「前线中存在的场合」「每回合1次」当我方一次受到2点或更多的伤害的场合，可以改为受到1点伤害。
  "UCEX01BT/ARK-2-070": [withCondition(when(["onTakeDamage"], may("这次伤害改为受到 1 点？", run("这次伤害改为受到 1 点", (env) => { env.game.damageCap = 1; markUsed(0)(env); }))), all(selfOnFront, notUsed(0)))],

  // 星熊：【启动主要】「前线中存在的场合」「每回合1次」只有在对方的前线中存在角色的场合才能发动。选择我方场上的1张拥有《伤害2》的角色，转为活跃状态。
  "UCEX01BT/ARK-2-071": [activateMain({ condition: all(selfOnFront, opponentFrontHasCharacters), once: true }, chooseOwn("target", { min: 1, max: 1, filter: withKeyword("伤害2"), prompt: "选择我方场上 1 张拥有《伤害2》的角色转为活跃状态" }), activate(chosen("target")))],

  // 林：「前线中存在的场合」此角色处于休息状态的场合，我方前线中的〈林〉以外的角色，不会被对方的事件卡牌的效果选择。【我方的回合中】结束阶段中此角色可以不转为活跃状态。
  "UCEX01BT/ARK-2-072": [
    staticAura(ownFrontExceptLin, { flags: ["untargetable:event"] }, all(selfOnFront, selfRested)),
    withCondition(when(["onEndStart"], may("结束阶段中「林」不转为活跃状态？", flag("self", "stayRested"))), all(duringYourTurn, selfRested))
  ],

  // 满是谜团的物流公司（事件）：确认我方卡组最上方的5张卡牌。公开其中任意张数合计BP不高于7500的红色的角色卡牌并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  "UCEX01BT/ARK-2-073": [onUse(look(5), chooseLooked("pick", { max: 5, filter: and(isCharacterCard, ofColor("red")), check: totalBpAtMost(7500), prompt: "公开任意张合计 BP 不高于 7500 的红色角色卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom())],
  // The other colours, one file each.
  ...YELLOW_ABILITIES,
  ...BLUE_A_ABILITIES,
  ...BLUE_B_ABILITIES,
  ...PURPLE_ABILITIES
};
