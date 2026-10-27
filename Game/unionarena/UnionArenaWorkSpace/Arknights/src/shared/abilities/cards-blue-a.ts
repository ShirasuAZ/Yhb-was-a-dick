/**
 * Abilities of the blue-a cards: UC01BT ARK-1 blue (罗德岛制药公司 / 企鹅物流 / 黑钢国际 / 整合运动). See cards.ts for the conventions; each entry
 * follows the card's printed text, shown above it (checked against the card images).
 *
 * Marks used here (see UnionArenaFieldCard.flags): "cannotSideline" (此角色不会退场: battles, BP 0 or less and effects do not sideline it),
 * "energyLineOnly" + "cannotMove" (此卡牌无法在前线中登场，无法移动至前线: it only ever stands on the energy line).
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step, Target } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent,
  chooseOwn, chosen, chosenCount, costChange, discard, discardCost, draw, duringOpponentTurn, duringYourTurn, energyCostAtMost, energyThisTurn, flag, givenOnly,
  grant, grantAbility, ifThen, isCharacterCard, look, lookedToBottom, may, moveChosen, noneChosen, notNamed, notSelf, ofColor, onBlock, onPlay, onUse,
  opponentHasColor, printedBp, put, restSelf, run, selfActive, selfOnEnergy, selfOnFront, sideline, staticAura, staticSelf, toHand, when, withAffinity,
  withCondition, youHaveNamed
} from "./dsl.ts";

// ---- Helpers for the blue-a cards ----
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
/** BP N或更高 (current BP). */
const bpAtLeast = (limit: number) => (env: AbilityEnv, _cardId: string, card: UnionArenaFieldCard | null): boolean => !!card && bpOf(env.ctx, card) >= limit;
/** BP为4500且消费AP为1的蓝色角色卡牌 */
const blue4500AP1 = and(isCharacterCard, printedBp(4500), apCostIs(1), ofColor("blue"));
/** 所需能量不高于3且消费AP为1的蓝色角色卡牌 */
const blueCost3AP1 = and(isCharacterCard, energyCostAtMost(3), apCostIs(1), ofColor("blue"));
/** The first chosen field card is no longer on the field (the effect that should have sidelined it did). */
const chosenGone = (name: string): Condition => (env) => {
  const uid = env.vars[name]?.[0];
  return !!uid && !env.players.some((player) => [...player.front, ...player.energy].some((card) => card.uid === uid));
};
/** The card a put step brought onto the field (该角色) is named `cardName`. */
const placedNamed = (name: string, cardName: string): Condition => (env) => {
  const uid = env.vars[`placed:${name}`]?.[0];
  const card = uid ? [...env.owner.front, ...env.owner.energy].find((entry) => entry.uid === uid) : undefined;
  return !!card && env.ctx.card(card.cardId)?.name === cardName;
};
/** 对方前线中存在BP不高于N的角色 */
const opponentFrontBpAtMost = (limit: number): Condition => (env) => env.opponent.front.some((card) => isCharacter(env, card) && bpOf(env.ctx, card) <= limit);
/** 我方能量线中的角色 (aura target) */
const ownEnergyCharacter = (env: AbilityEnv, card: UnionArenaFieldCard, cardOwner: EnginePlayer): boolean => cardOwner === env.owner && env.owner.energy.includes(card) && isCharacter(env, card);
/** 我方场上〈杜宾〉以外的所需能量为3的角色 (aura target) */
const ownCost3NotDobermann = (env: AbilityEnv, card: UnionArenaFieldCard, cardOwner: EnginePlayer): boolean =>
  cardOwner === env.owner && isCharacter(env, card) && env.ctx.card(card.cardId)?.name !== "杜宾" && env.ctx.card(card.cardId)?.energyCost === 3;
/** 此卡牌无法在前线中登场，无法移动至前线。 */
const energyLineOnlyCard = staticSelf({ flags: ["energyLineOnly", "cannotMove"] });
/** 获得“当主要阶段结束时，将此角色退场” (given with grantAbility). */
const sidelineAtMainEnd = givenOnly(when(["onMainEnd"], sideline("self")));
/** 我方回合中〈红〉放回手牌的效果（1回合只能发动1次）。 */
const RED_MARK = "〈红〉放回手牌";
const redMarkUsed: Condition = (env) => (env.game.turnMarks ?? []).includes(`${env.game.turn}:${RED_MARK}`);
/** 对方前线中的所有BP1500或更高的角色 */
const opponentFront1500: Target = (env) => env.opponent.front.filter((card) => isCharacter(env, card) && bpOf(env.ctx, card) >= 1500);
/** 迷迭香的【登场时】效果：『BP-500』，我方的能量线中存在BP4000或更高的角色的场合，改为『BP-1000』。 */
const rosmontisOnPlay: Step[] = [bp(opponentFront1500, (env) => (env.owner.energy.some((card) => isCharacter(env, card) && bpOf(env.ctx, card) >= 4000) ? -1000 : -500))];
/** 将我方场上的1张所需能量不高于3的角色放回手牌 */
const returnCost3 = (as: string): Step[] => [chooseOwn(as, { min: 1, max: 1, filter: energyCostAtMost(3), prompt: "选择我方场上 1 张所需能量不高于 3 的角色放回手牌" }), toHand(chosen(as))];

export const BLUE_A_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 霜星：【登场时】此角色在本回合中，获得“当主要阶段结束时，将此角色退场”。
  "UC01BT/ARK-1-034": [onPlay(grantAbility("self", 1)), sidelineAtMainEnd],

  // 芙兰卡：【启动主要】「每回合1次」此角色在本回合中，获得BP+1500和“当攻击阶段结束时，将此角色退场”。
  "UC01BT/ARK-1-035": [activateMain({ once: true }, bp("self", 1500), grantAbility("self", 1)), givenOnly(when(["onAttackPhaseEnd"], sideline("self")))],

  // 雷蛇：【阻挡时】选择我方场上的最多1张角色，本回合中，BP+500。
  "UC01BT/ARK-1-036": [onBlock(chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+500）" }), bp(chosen("target"), 500))],

  // 能天使：对方的场上存在黄色或红色卡牌的场合，手牌中此卡牌的所需能量减少1。
  "UC01BT/ARK-1-037": [costChange({ energy: 1 }, opponentHasColor("yellow", "red"))],

  // 德克萨斯：【登场时】抽取1张卡牌。
  "UC01BT/ARK-1-038": [onPlay(draw(1))],

  // 阿米娅：【启动主要】〔将1张手牌置于场外〕「每回合1次」选择我方能量线中的1张角色，本回合中，给予“此角色不会退场”。
  "UC01BT/ARK-1-040": [activateMain({ costs: [discardCost(1)], once: true }, chooseOwn("target", { line: "energy", min: 1, max: 1, prompt: "选择我方能量线中 1 张角色（本回合不会退场）" }), flag(chosen("target"), "cannotSideline"))],

  // 阿米娅：【登场时】可以选择对方前线中的1张BP不高于4000的角色，将其退场。这样做的场合，此角色在本回合中，获得“当主要阶段结束时，将此角色退场”。
  "UC01BT/ARK-1-041": [
    onPlay(ifThen(opponentFrontBpAtMost(4000), [may("选择对方前线中 1 张 BP 不高于 4000 的角色退场（此角色本回合获得“当主要阶段结束时，将此角色退场”）？",
      chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(4000), prompt: "选择对方前线中 1 张 BP 不高于 4000 的角色退场" }),
      sideline(chosen("target")), ifThen(chosenGone("target"), [grantAbility("self", 1)]))])),
    sidelineAtMainEnd
  ],

  // 阿米娅（突进）：【我方的回合中】〔前线中存在的场合〕我方能量线中的角色不会退场。
  "UC01BT/ARK-1-042": [staticAura(ownEnergyCharacter, { flags: ["cannotSideline"] }, all(duringYourTurn, selfOnFront))],

  // 灰喉：【登场时】选择对方前线中的最多1张BP1500或更高的角色，本回合中，BP-1000。
  "UC01BT/ARK-1-044": [onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(1500), prompt: "选择对方前线中最多 1 张 BP 1500 或更高的角色（本回合 BP-1000）" }), bp(chosen("target"), -1000))],

  // 凯尔希：此角色处于活跃状态的场合，此角色的产生能量+[蓝]。
  "UC01BT/ARK-1-046": [staticSelf({ energy: 1 }, selfActive)],

  // 凯尔希：【登场时】〔能量线中存在的场合〕确认我方卡组最上方的7张卡牌。公开其中最多1张BP为4500的角色卡牌并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  //        之后，从我方的手牌中将最多1张BP为4500且消费AP为1的蓝色角色卡牌在我方的场上以休息状态登场。
  "UC01BT/ARK-1-047": [withCondition(onPlay(
    look(7), chooseLooked("pick", { max: 1, filter: and(isCharacterCard, printedBp(4500)), prompt: "公开最多 1 张 BP 为 4500 的角色卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(),
    chooseFromHand("card", { max: 1, filter: blue4500AP1, prompt: "从手牌选择最多 1 张 BP 为 4500、消费 AP 为 1 的蓝色角色，以休息状态登场" }), put("card", "choose", true)
  ), selfOnEnergy)],

  // 凯尔希（突进）：【登场时】抽取1张卡牌。
  //        【启动主要】〔能量线中存在的场合〕〔转为休息状态〕〔将1张手牌置于场外〕将我方场上的1张所需能量不高于3的角色放回手牌。
  //        这样做的场合，从我方的手牌中将最多1张BP为4500且消费AP为1的蓝色角色卡牌在我方的场上以活跃状态登场。
  "UC01BT/ARK-1-048": [
    onPlay(draw(1)),
    activateMain({ costs: [restSelf, discardCost(1)], condition: selfOnEnergy }, ...returnCost3("ret"), ifThen(chosenCount("ret"), [
      chooseFromHand("card", { max: 1, filter: blue4500AP1, prompt: "从手牌选择最多 1 张 BP 为 4500、消费 AP 为 1 的蓝色角色，以活跃状态登场" }), put("card", "choose", false)
    ]))
  ],

  // 杜宾：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。
  "UC01BT/ARK-1-049": [onPlay(chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }), toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // 杜宾：〔前线中存在的场合〕我方场上〈杜宾〉以外的所有所需能量为3的角色，BP+1000。
  "UC01BT/ARK-1-050": [staticAura(ownCost3NotDobermann, { bp: 1000 }, selfOnFront)],

  // 博士：此卡牌无法在前线中登场，无法移动至前线。
  //      【启动主要】〔转为休息状态〕「每回合1次」此角色在本回合中，获得产生能量+[蓝]和“当主要阶段结束时，将此角色退场”。
  "UC01BT/ARK-1-051": [energyLineOnlyCard, activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 2)), sidelineAtMainEnd],

  // 博士：此卡牌无法在前线中登场，无法移动至前线。
  //      【启动主要】〔转为休息状态〕〔将1张手牌置于场外〕「每回合1次」确认我方卡组最上方的5张卡牌。从中将最多1张〈博士〉以外的所需能量不高于3且消费AP为1的蓝色角色卡牌
  //      在我方的场上以休息状态登场。剩余的卡牌自选顺序置于我方卡组的最下方。当本回合的主要阶段结束时，将此角色退场。
  "UC01BT/ARK-1-052": [
    energyLineOnlyCard,
    activateMain({ costs: [restSelf, discardCost(1)], once: true },
      look(5), chooseLooked("card", { max: 1, filter: and(notNamed("博士"), blueCost3AP1), prompt: "选择最多 1 张〈博士〉以外、所需能量不高于 3 且消费 AP 为 1 的蓝色角色，以休息状态登场" }),
      put("card", "choose", true), lookedToBottom(), grantAbility("self", 2)),
    sidelineAtMainEnd
  ],

  // 红：【我方的回合中】当此角色从我方的场上放回手牌时，本回合中，下一张将要从手牌使用的蓝色的〈红〉的消费AP-1，并以活跃状态登场。〈红〉的此效果1回合只能发动1次。
  //    【对方的回合中】此角色的BP-2500。
  "UC01BT/ARK-1-055": [
    withCondition(when(["onReturnToHand"], run("本回合中，下一张从手牌使用的蓝色〈红〉消费 AP-1，并以活跃状态登场", (env) => {
      env.game.turnMarks = [...(env.game.turnMarks ?? []), `${env.game.turn}:${RED_MARK}`];
      env.game.nextPlay = [...(env.game.nextPlay ?? []), { turn: env.game.turn, ownerId: env.owner.accountId, name: "红", color: "blue", ap: 1, active: true, spent: false }];
    })), all(duringYourTurn, (env) => !redMarkUsed(env))),
    staticSelf({ bp: -2500 }, duringOpponentTurn)
  ],

  // 煌：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UC01BT/ARK-1-057": [onPlay(draw(1), discard(1))],

  // 煌：我方的前线中与能量线中都存在BP4000或更高的其他角色的场合，此角色获得《伤害2》。
  //    【我方的回合中】「每回合1次」此角色或我方能量线中的角色通过BP变为0或更低以外的方式退场的场合，可以改为将此角色突进源的卡牌置于场外。这样做的场合，抽取1张卡牌。
  "UC01BT/ARK-1-059": [
    staticSelf({ keywords: ["伤害2"] }, (env) => [env.owner.front, env.owner.energy].every((line) => line.some((card) => card !== env.self && isCharacter(env, card) && bpOf(env.ctx, card) >= 4000))),
    {
      kind: "replaceSideline",
      oncePerTurn: true,
      condition: (env, target) => duringYourTurn(env) && !!env.self && env.self.under.length > 0 && (target === env.self || env.owner.energy.includes(target)),
      prompt: "可以改为将「煌」的突进源置于场外，并抽 1 张卡。",
      apply: (env) => {
        env.owner.sideline.push(...env.self!.under);
        env.self!.under = [];
        const drawn = env.owner.library.shift();
        if (drawn) env.owner.hand.push(drawn);
      }
    }
  ],

  // 煌：【登场时】选择我方能量线中的最多1张角色，本回合中，给予“此角色不会退场”。
  "UC01BT/ARK-1-058": [onPlay(chooseOwn("target", { line: "energy", max: 1, prompt: "选择我方能量线中最多 1 张角色（本回合不会退场）" }), flag(chosen("target"), "cannotSideline"))],

  // 迷迭香：〔前线中存在的场合〕此角色BP-1000。
  //        【登场时】对方前线中的所有BP1500或更高的角色，本回合中，『BP-500』。我方的能量线中存在BP4000或更高的角色的场合，改为『BP-1000』。
  //        【启动主要】「每回合1次」将我方场上的1张所需能量不高于3的角色放回手牌。这样做的场合，发动此角色的【登场时】效果。
  "UC01BT/ARK-1-060": [
    staticSelf({ bp: -1000 }, selfOnFront),
    onPlay(...rosmontisOnPlay),
    activateMain({ once: true }, ...returnCost3("ret"), ifThen(chosenCount("ret"), rosmontisOnPlay))
  ],

  // PRTS（场地）：【登场时】确认我方卡组最上方的4张卡牌。公开其中最多1张“特征：罗德岛制药公司”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  "UC01BT/ARK-1-061": [onPlay(look(4), chooseLooked("pick", { max: 1, filter: withAffinity("罗德岛制药公司"), prompt: "公开最多 1 张“特征：罗德岛制药公司”的卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom())],

  // 应急理智加强剂（事件）：选择我方的最多2张AP卡牌，转为活跃状态。
  "UC01BT/ARK-1-062": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 指令：熔毁（事件）：从下列选择1项。
  //   •选择对方前线中的最多1张BP不高于4000的角色退场。
  //   •将我方场上的1张所需能量不高于3的角色放回手牌。这样做的场合，从我方的手牌中将最多1张BP为4500且消费AP为1的蓝色角色卡牌在我方的场上以活跃状态登场。
  //    本回合中，给予该角色BP+1000和《瞄准攻击》。
  "UC01BT/ARK-1-063": [onUse(
    chooseMode("mode", ["选择对方前线中的最多1张BP不高于4000的角色退场。", "将我方场上的1张所需能量不高于3的角色放回手牌。这样做的场合，从手牌将最多1张BP为4500且消费AP为1的蓝色角色以活跃状态登场，本回合中给予BP+1000和《瞄准攻击》。"]),
    ifThen((env) => env.vars.mode?.[0] === "m:0",
      [chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(4000), prompt: "选择对方前线中最多 1 张 BP 不高于 4000 的角色退场" }), sideline(chosen("target"))],
      [...returnCost3("ret"), ifThen(chosenCount("ret"), [
        chooseFromHand("card", { max: 1, filter: blue4500AP1, prompt: "从手牌选择最多 1 张 BP 为 4500、消费 AP 为 1 的蓝色角色，以活跃状态登场" }), put("card", "choose", false),
        bp(chosen("placed:card"), 1000), grant(chosen("placed:card"), "瞄准攻击")
      ])])
  )],

  // 精神爆发（事件）：选择对方前线中的1张『BP不高于3000』的角色退场。我方的场上存在〈阿米娅〉的场合，改为『BP不高于5000』。
  "UC01BT/ARK-1-064": [onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (youHaveNamed("阿米娅")(env) ? 5000 : 3000)), prompt: "选择对方前线中 1 张 BP 不高于 3000（我方有〈阿米娅〉时为 5000）的角色退场" }), sideline(chosen("target")))],

  // 未知技术（事件）：将我方场上的1张所需能量不高于3的角色放回手牌。这样做的场合，抽取3张卡牌。
  "UC01BT/ARK-1-065": [onUse(...returnCost3("ret"), ifThen(chosenCount("ret"), [draw(3)]))],

  // 抓紧我的手！！（事件）：从我方的场外将1张所需能量不高于3且消费AP为1的蓝色角色卡牌在我方的能量线中以休息状态登场。登场的角色为〈博士〉的场合，该角色转为活跃状态。
  "UC01BT/ARK-1-066": [onUse(
    chooseFromSideline("card", { min: 1, max: 1, filter: blueCost3AP1, prompt: "从场外选择 1 张所需能量不高于 3 且消费 AP 为 1 的蓝色角色，以休息状态登场到能量线" }),
    put("card", "energy", true), ifThen(placedNamed("card", "博士"), [activate(chosen("placed:card"))])
  )]
};
