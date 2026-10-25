/** Abilities of the purple cards (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, energyLineOnly, flagsOf } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, activeCard, all, and, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode,
  chooseOpponent, chooseOwn, chosen, chosenCount, discard, draw, duringYourTurn, either, energyCostAtMost, energyThisTurn, flag, givenOnly, grant, grantAbility,
  ifThen, isCharacterCard, look, lookedToBottom, may, moveChosen, moveLine, named, noneChosen, notNamed, notSelf, ofColor, onPlay, onSidelined, onUse, oncePerTurn, put,
  rest, restSelf, run, selfActive, selfOnEnergy, selfOnFront, sideline, staticAura, staticSelf, toHand, when, withAffinity, withCondition, youHaveNamed
} from "./dsl.ts";

// ---- Helpers for the purple cards ----
/** 博士 (2-053) 【登场时】: also run when it is put from the sideline into the removal area. */
const doctorOnPlay: Step[] = [
  chooseOwn("target", { max: 1, filter: and(notNamed("博士"), ofColor("purple"), either(withAffinity("罗德岛制药公司"), named("陈"))), prompt: "选择我方场上最多 1 张〈博士〉以外的紫色“特征：罗德岛制药公司”或〈陈〉（本回合 BP+1000）" }),
  bp(chosen("target"), 1000)
];
type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const fieldCharacters = (env: AbilityEnv, owner = env.owner): UnionArenaFieldCard[] => [...owner.front, ...owner.energy].filter((card) => isCharacter(env, card));
const numberOf = (env: AbilityEnv, cardId: string): string | undefined => env.ctx.card(cardId)?.number;
/** 我方场外的卡牌存在N张或更多 */
const sidelineAtLeast = (count: number): Condition => (env) => env.owner.sideline.length >= count;
/** 我方的移除区中存在N张或更多的卡牌 */
const removalAtLeast = (count: number): Condition => (env) => env.owner.removal.length >= count;
/** The card's name now: printed, or changed by a "name:<name>" mark (此卡牌的卡牌名变更为〈…〉). */
const namesOf = (env: AbilityEnv, card: UnionArenaFieldCard): string[] =>
  [env.ctx.card(card.cardId)?.name ?? "", ...flagsOf(card).flatMap((mark) => (mark.startsWith("name:") ? [mark.slice(5)] : []))];
/** 我方的场上存在〈name〉的角色 (counting changed names) */
const youHaveNamedNow = (name: string): Condition => (env) => fieldCharacters(env).some((card) => namesOf(env, card).includes(name));
/** 卡牌名包含“text” */
const nameIncludes = (text: string): CardFilter => (env, cardId, card) => (card ? namesOf(env, card) : [env.ctx.card(cardId)?.name ?? ""]).some((name) => name.includes(text));
/** 我方的场上存在卡牌名包含“text”的角色 */
const youHaveNameIncluding = (text: string): Condition => (env) => fieldCharacters(env).some((card) => nameIncludes(text)(env, card.cardId, card));
/** 我方场外的卡牌存在15张或更多的场合，此卡牌的卡牌名变更为〈不死的黑蛇 塔露拉〉。 */
const blackSnakeName = staticSelf({ flags: ["name:不死的黑蛇 塔露拉"] }, sidelineAtLeast(15));
const bpAtLeast = (value: number): CardFilter => (env, _cardId, card) => !!card && bpOf(env.ctx, card) >= value;
const isMode = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;
/** 将我方卡组最上方的N张卡牌置于场外 */
const mill = (count: number) => (env: AbilityEnv): void => { env.owner.sideline.push(...env.owner.library.splice(0, count)); };
/** A field card that can be moved to the other line by our own effect (not 无法移动, and not 无法移动至前线 when it is on the energy line). */
const canChangeLine: CardFilter = (env, cardId, card) => !!card && !flagsOf(card).includes("cannotMove") && (env.owner.front.includes(card) || !energyLineOnly(env.ctx, cardId));
/** Is the hand card chosen under `name` this card number? (read before it leaves the hand) */
const chosenHandIs = (name: string, number: string): Condition => (env) => {
  const key = env.vars[name]?.[0];
  return !!key && key.startsWith("h:") && numberOf(env, env.owner.hand[Number(key.slice(2))] ?? "") === number;
};

const KOSCHEI = "UCEX01BT/ARK-2-030";
/**
 * 科西切's 【退场时】 (also used by 斗士塔露拉 2-040): 可以将此卡牌背面朝上置于我方场上的1张卡牌名包含“塔露拉”的角色的下方。这样做的场合，将我方卡组最上方的3张卡牌置于场外。
 * "此卡牌" is the 科西切 that was just put into the sideline (the last one there).
 */
const koscheiUnderTalulah: Step = may("将「科西切」背面朝上置于卡牌名包含“塔露拉”的角色下方，并将卡组最上方的 3 张卡牌置于场外？",
  chooseOwn("talulah", { min: 1, max: 1, filter: nameIncludes("塔露拉"), prompt: "选择我方场上 1 张卡牌名包含“塔露拉”的角色（「科西切」背面朝上置于其下方）" }),
  ifThen(chosenCount("talulah"), [run("「科西切」背面朝上置于该角色下方，将卡组最上方的 3 张卡牌置于场外", (env) => {
    const talulah = fieldCharacters(env).find((card) => card.uid === env.vars.talulah?.[0]);
    let index = -1;
    env.owner.sideline.forEach((cardId, at) => { if (numberOf(env, cardId) === KOSCHEI) index = at; });
    if (!talulah || index < 0) return;
    talulah.faceDown = [...(talulah.faceDown ?? []), env.owner.sideline.splice(index, 1)[0]!];
    mill(3)(env);
  })]));
const koscheiInSideline: Condition = (env) => env.owner.sideline.some((cardId) => numberOf(env, cardId) === KOSCHEI);

export const PURPLE_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 阿丽娜：此卡牌无法在前线中登场，无法移动至前线。
  //        【启动主要】〔转为休息状态〕「每回合1次」此角色在本回合中，获得产生能量+(紫)和“当主要阶段结束时，将此角色退场”。
  "UCEX01BT/ARK-2-025": [
    staticSelf({ flags: ["energyLineOnly", "cannotMove"] }),
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 2)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 阿丽娜：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。
  "UCEX01BT/ARK-2-026": [onPlay(chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }), toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // 阿丽娜：「能量线中存在的场合」当我方的攻击阶段结束时，选择我方前线中的1张BP1500或更高的角色，可以与此角色交换位置。
  //        【退场时】抽取1张卡牌。将我方卡组最上方的3张卡牌置于场外。
  "UCEX01BT/ARK-2-027": [
    withCondition(when(["onAttackPhaseEnd"], may("与前线中 1 张 BP1500 或更高的角色交换位置？",
      chooseOwn("swap", { line: "front", min: 1, max: 1, filter: and(bpAtLeast(1500), canChangeLine), prompt: "选择我方前线中 1 张 BP1500 或更高的角色（与「阿丽娜」交换位置）" }),
      run("「阿丽娜」与选择的角色交换位置", (env) => {
        const self = env.self;
        const other = env.owner.front.find((card) => card.uid === env.vars.swap?.[0]);
        if (!self || !other || !env.owner.energy.includes(self)) return;
        env.owner.energy[env.owner.energy.indexOf(self)] = other;
        env.owner.front[env.owner.front.indexOf(other)] = self;
      }))),
    all(selfOnEnergy, (env) => !!env.self && !flagsOf(env.self).includes("cannotMove") && env.owner.front.some((card) => isCharacter(env, card) && bpAtLeast(1500)(env, card.cardId, card) && canChangeLine(env, card.cardId, card)))),
    onSidelined(draw(1), run("将卡组最上方的 3 张卡牌置于场外", mill(3)))
  ],

  // 伊诺：《冲击无效》 【退场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UCEX01BT/ARK-2-028": [onSidelined(draw(1), discard(1))],

  // 皇帝的利刃：【登场时】抽取1张卡牌。之后，选择对方场上的最多1张场地卡牌退场。
  "UCEX01BT/ARK-2-029": [onPlay(draw(1),
    { do: "choose", as: "site", from: "field", side: "opponent", characters: false, filter: (env, cardId) => env.ctx.card(cardId)?.type === "site", min: 0, max: 1, prompt: "选择对方场上最多 1 张场地卡退场", good: false },
    sideline(chosen("site")))],

  // 科西切：【启动主要】「前线中存在的场合」「每回合1次」选择我方场上的1张其他角色，本回合中，给予“此角色存在于前线的场合也会产生能量”。
  //        【退场时】可以将此卡牌背面朝上置于我方场上的1张卡牌名包含“塔露拉”的角色的下方。这样做的场合，将我方卡组最上方的3张卡牌置于场外。
  "UCEX01BT/ARK-2-030": [
    activateMain({ condition: selfOnFront, once: true }, chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色（本回合存在于前线时也会产生能量）" }), flag(chosen("target"), "energyOnFront")),
    withCondition(onSidelined(koscheiUnderTalulah), all(youHaveNameIncluding("塔露拉"), koscheiInSideline))
  ],

  // 萨沙：【启动主要】「前线中存在的场合」「每回合1次」确认我方卡组最上方的1张卡牌。将其置于我方卡组的最上方或场外。
  "UCEX01BT/ARK-2-031": [activateMain({ condition: selfOnFront, once: true }, look(1),
    chooseLooked("mill", { max: 1, prompt: "选择则置于场外，不选则放回卡组最上方" }), moveChosen("mill", "sideline"),
    run("确认的卡牌放回卡组最上方", (env) => { const looking = env.game.looking; if (looking?.cards.length) { env.owner.library.unshift(...looking.cards); looking.cards = []; } }))],

  // W：【登场时】从下列选择1项。
  //   ・我方的场外存在15张或更多的卡牌的场合，选择我方场上的最多1张“特征：整合运动”，本回合中，给予《冲击+1》。
  //   ・我方的移除区中存在9张或更多的卡牌的场合，选择我方场上的最多1张“特征：罗德岛制药公司”，本回合中，给予《冲击+1》。
  "UCEX01BT/ARK-2-032": [onPlay(
    chooseMode("mode", ["我方的场外存在15张或更多的卡牌的场合，选择我方场上的最多1张“特征：整合运动”，本回合中，给予《冲击+1》。", "我方的移除区中存在9张或更多的卡牌的场合，选择我方场上的最多1张“特征：罗德岛制药公司”，本回合中，给予《冲击+1》。"]),
    ifThen(isMode("mode", 0),
      [ifThen(sidelineAtLeast(15), [chooseOwn("target", { max: 1, filter: withAffinity("整合运动"), prompt: "选择我方场上最多 1 张“特征：整合运动”（本回合给予《冲击+1》）" }), grant(chosen("target"), "冲击+1")])],
      [ifThen(removalAtLeast(9), [chooseOwn("target", { max: 1, filter: withAffinity("罗德岛制药公司"), prompt: "选择我方场上最多 1 张“特征：罗德岛制药公司”（本回合给予《冲击+1》）" }), grant(chosen("target"), "冲击+1")])]))],

  // W：【登场时】可以从我方的手牌中将1张拥有[特殊]的卡牌公开，并背面朝上置于此角色的下方。这样做的场合，将此角色转为活跃状态，将我方卡组最上方的1张卡牌背面朝上置于此角色的下方。
  //   【退场时】将此角色下方的背面朝上的卡牌全部公开并加入手牌。
  "UCEX01BT/ARK-2-033": [
    withCondition(onPlay(may("从手牌公开 1 张拥有[特殊]的卡牌，背面朝上置于「W」下方？",
      chooseFromHand("special", { min: 1, max: 1, filter: (env, cardId) => env.ctx.card(cardId)?.trigger?.label === "特殊", prompt: "选择手牌中 1 张拥有[特殊]的卡牌（公开后背面朝上置于「W」下方）" }),
      ifThen(chosenCount("special"), [
        run("公开的卡牌背面朝上置于「W」下方", (env) => {
          const key = env.vars.special?.[0];
          if (!env.self || !key) return;
          const [cardId] = env.owner.hand.splice(Number(key.slice(2)), 1);
          if (!cardId) return;
          env.game.log.push(`「W」：公开「${env.ctx.card(cardId)?.name ?? "未知卡牌"}」`);
          env.self.faceDown = [...(env.self.faceDown ?? []), cardId];
        }),
        activate("self"),
        run("将卡组最上方的 1 张卡牌背面朝上置于「W」下方", (env) => { if (env.self) env.self.faceDown = [...(env.self.faceDown ?? []), ...env.owner.library.splice(0, 1)]; })
      ]))), all((env) => !!env.self, (env) => env.owner.hand.some((cardId) => env.ctx.card(cardId)?.trigger?.label === "特殊"))),
    onSidelined(run("「W」下方背面朝上的卡牌全部公开并加入手牌", (env) => {
      for (const cardId of env.cause?.faceDown ?? []) {
        const index = env.owner.sideline.lastIndexOf(cardId);
        if (index >= 0) env.owner.hand.push(env.owner.sideline.splice(index, 1)[0]!);
      }
    }))
  ],

  // 陈：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UCEX01BT/ARK-2-034": [onPlay(draw(1), discard(1))],

  // 陈：【登场时】将我方场外的最多1张卡牌置于移除区。之后，我方的移除区中存在3张或更多的卡牌的场合，选择我方场上的最多1张角色，本回合中，BP+1000。
  "UCEX01BT/ARK-2-035": [onPlay(chooseFromSideline("card", { max: 1, prompt: "选择我方场外最多 1 张卡牌置于移除区" }), moveChosen("card", "removal"),
    ifThen(removalAtLeast(3), [chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+1000）" }), bp(chosen("target"), 1000)]))],

  // 陈：【我方的回合中】我方的移除区中存在3张或更多的卡牌的场合，此角色获得《伤害+1》。
  "UCEX01BT/ARK-2-036": [staticSelf({ keywords: ["伤害+1"] }, all(duringYourTurn, removalAtLeast(3)))],

  // 陈：《冲击无效》 【启动主要】「前线中存在的场合」「每回合1次」将我方场外的1张卡牌置于移除区。
  "UCEX01BT/ARK-2-037": [activateMain({ condition: selfOnFront, once: true }, chooseFromSideline("card", { min: 1, max: 1, prompt: "选择我方场外 1 张卡牌置于移除区" }), moveChosen("card", "removal"))],

  // 陈：【启动主要】我方的移除区中存在的卡牌每有3张，此角色在本回合中，获得《伤害+1》。〈陈〉的此效果1回合只能发动1次。
  //    【启动主要】「前线中存在的场合」「每回合1次」抽取1张卡牌，将我方场外的最多1张卡牌置于移除区。
  "UCEX01BT/ARK-2-038": [
    activateMain({ once: true, condition: (env) => !(env.game.turnMarks ?? []).includes(`${env.game.turn}:${env.owner.accountId}:ARK-2-038`) },
      run("移除区每有 3 张卡牌，本回合获得 1 个《伤害+1》", (env) => {
        env.game.turnMarks = [...(env.game.turnMarks ?? []), `${env.game.turn}:${env.owner.accountId}:ARK-2-038`];
        if (env.self) for (let count = Math.floor(env.owner.removal.length / 3); count > 0; count -= 1) env.self.grants.push("伤害+1");
      })),
    activateMain({ condition: selfOnFront, once: true }, draw(1), chooseFromSideline("card", { max: 1, prompt: "选择我方场外最多 1 张卡牌置于移除区" }), moveChosen("card", "removal"))
  ],

  // 斗士塔露拉：我方场外的卡牌存在15张或更多的场合，此卡牌的卡牌名变更为〈不死的黑蛇 塔露拉〉。
  //            我方场外的卡牌存在15张或更多的场合，此角色的产生能量+(紫)。
  "UCEX01BT/ARK-2-039": [blackSnakeName, staticSelf({ energy: 1 }, sidelineAtLeast(15))],

  // 斗士塔露拉：我方场外的卡牌存在15张或更多的场合，此卡牌的卡牌名变更为〈不死的黑蛇 塔露拉〉。
  //            【登场时】「能量线中存在的场合」将我方的1张手牌置于场外。通过此效果置于场外的卡牌为〈科西切〉的场合，可以发动该卡牌的【退场时】效果。
  "UCEX01BT/ARK-2-040": [
    blackSnakeName,
    withCondition(onPlay(chooseFromHand("discard", { min: 1, max: 1, prompt: "选择 1 张手牌置于场外" }),
      ifThen(chosenHandIs("discard", KOSCHEI), [moveChosen("discard", "sideline"), koscheiUnderTalulah], [moveChosen("discard", "sideline")])), selfOnEnergy)
  ],

  // 斗士塔露拉：我方场外的卡牌存在15张或更多的场合，此卡牌的卡牌名变更为〈不死的黑蛇 塔露拉〉。
  //            【启动主要】〔转为休息状态〕「每回合1次」选择我方场上的最多1张BP不高于1000的角色，移动至其他线。
  "UCEX01BT/ARK-2-041": [
    blackSnakeName,
    activateMain({ costs: [restSelf], once: true }, chooseOwn("target", { max: 1, filter: and(bpAtMost(1000), canChangeLine), prompt: "选择我方场上最多 1 张 BP 不高于 1000 的角色移动至其他线" }), ifThen(chosenCount("target"), [moveLine(chosen("target"))]))
  ],

  // 斗士塔露拉：我方场外的卡牌存在15张或更多的场合，此卡牌的卡牌名变更为〈不死的黑蛇 塔露拉〉。 【登场时】抽取1张卡牌。
  //            【攻击时】「每回合1次」可以将我方前线中的1张BP不高于1000的活跃状态的角色转为休息状态。这样做的场合，将此角色转为活跃状态，之后，
  //            可以将我方能量线中的1张BP不高于1000的活跃状态的角色转为休息状态。这样做的场合，抽取1张卡牌。
  "UCEX01BT/ARK-2-042": [
    blackSnakeName,
    onPlay(draw(1)),
    oncePerTurn(when(["onAttack"], ifThen((env) => env.owner.front.some((card) => card.uid !== env.self?.uid && isCharacter(env, card) && !card.rested && bpAtMost(1000)(env, card.cardId, card)), [
      may("将前线中 1 张 BP 不高于 1000 的活跃角色转为休息，使此角色转为活跃状态？",
        chooseOwn("cost1", { line: "front", min: 1, max: 1, filter: and(notSelf, bpAtMost(1000), activeCard), prompt: "选择前线中 1 张 BP 不高于 1000 的活跃角色转为休息" }),
        rest(chosen("cost1")), activate("self"),
        ifThen((env) => env.owner.energy.some((card) => isCharacter(env, card) && !card.rested && bpAtMost(1000)(env, card.cardId, card)), [
          may("将能量线中 1 张 BP 不高于 1000 的活跃角色转为休息，抽 1 张卡？",
            chooseOwn("cost2", { line: "energy", min: 1, max: 1, filter: and(bpAtMost(1000), activeCard), prompt: "选择能量线中 1 张 BP 不高于 1000 的活跃角色转为休息" }),
            rest(chosen("cost2")), draw(1))
        ]))
    ])))
  ],

  // 爱国者：「前线中存在的场合」我方场上的原本的BP不高于1000的角色，不会受到BP降低效果的影响。
  "UCEX01BT/ARK-2-043": [staticAura((env, card, cardOwner) => cardOwner === env.owner && isCharacter(env, card) && (env.ctx.card(card.cardId)?.bp ?? 99999) <= 1000, { flags: ["noBpDown"] }, selfOnFront)],

  // 不死的黑蛇 塔露拉：《2次攻击》 【登场时】选择对方前线中的最多1张角色，本回合中，BP-5000。
  //                   【启动主要】「前线中存在的场合」「每回合1次」此角色的下方存在背面朝上的卡牌的场合，选择对方前线中的1张角色，直到下一个我方的回合开始时为止，BP-2000。
  "UCEX01BT/ARK-2-044": [
    onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-5000）" }), bp(chosen("target"), -5000)),
    activateMain({ condition: all(selfOnFront, (env) => (env.self?.faceDown ?? []).length > 0), once: true },
      chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色（直到我方下一回合开始 BP-2000）" }), bp(chosen("target"), -2000, "untilYourNextTurn"))
  ],

  // 霜星：我方场外存在的卡牌每有5张，此角色BP+500。
  "UCEX01BT/ARK-2-045": [staticSelf({ bp: (env) => 500 * Math.floor(env.owner.sideline.length / 5) })],

  // 霜星：【登场时】本回合中，下一张将要从手牌中使用的BP不高于1000的角色卡牌的消费AP-1。
  "UCEX01BT/ARK-2-046": [onPlay(run("本回合中，下一张从手牌使用的 BP 不高于 1000 的角色卡牌消费 AP-1", (env) => {
    env.game.nextPlayLowBp = [...(env.game.nextPlayLowBp ?? []), { turn: env.game.turn, ownerId: env.owner.accountId, maxBp: 1000, ap: 1, spent: false }];
  }))],

  // 阿米娅：【登场时】我方的场上存在〈陈〉的场合，从下列选择1项。 •抽取1张卡牌。 •将我方场外的最多2张卡牌置于移除区。
  "UCEX01BT/ARK-2-048": [withCondition(onPlay(chooseMode("mode", ["抽取1张卡牌。", "将我方场外的最多2张卡牌置于移除区。"]),
    ifThen(isMode("mode", 0), [draw(1)], [chooseFromSideline("cards", { max: 2, prompt: "选择我方场外最多 2 张卡牌置于移除区" }), moveChosen("cards", "removal")])), youHaveNamed("陈"))],

  // 阿米娅：【登场时】确认我方卡组最上方的3张卡牌。公开其中最多1张“特征：罗德岛制药公司”或〈陈〉并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UCEX01BT/ARK-2-049": [onPlay(look(3), chooseLooked("pick", { max: 1, filter: either(withAffinity("罗德岛制药公司"), named("陈")), prompt: "公开最多 1 张“特征：罗德岛制药公司”或〈陈〉并加入手牌" }),
    moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // 阿米娅：「每回合1次」当此角色进行攻击且没有被阻挡时，将我方场外的最多1张卡牌置于移除区。
  //        【登场时】抽取1张卡牌。之后，从我方的手牌中将最多1张所需能量『不高于1』且消费AP为1的紫色的角色卡牌在我方的场上以休息状态登场。我方的移除区中存在3张或更多的卡牌的场合，改为『不高于3』。
  "UCEX01BT/ARK-2-050": [
    oncePerTurn(when(["onAttackUnblocked"], chooseFromSideline("card", { max: 1, prompt: "选择我方场外最多 1 张卡牌置于移除区" }), moveChosen("card", "removal"))),
    onPlay(draw(1), chooseFromHand("card", {
      max: 1, filter: and(isCharacterCard, ofColor("purple"), apCostIs(1), (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= (removalAtLeast(3)(env) ? 3 : 1)),
      prompt: "从手牌选择最多 1 张所需能量不高于 1（移除区有 3 张或更多时为 3）、消费 AP 为 1 的紫色角色，以休息状态登场"
    }), put("card", "choose", true))
  ],

  // 阿米娅：根据我方的移除区中存在的卡牌张数，此角色获得下列所有效果。
  //   •3张或更多：【登场时】选择对方前线中的最多1张BP不高于3000的角色退场。
  //   •6张或更多：《冲击1》
  //   •9张或更多：【启动主要】「每回合1次」选择我方场上的最多1张〈陈〉。此角色在本回合中，获得BP+1000和与选择的〈陈〉相同数量的《伤害+1》。
  "UCEX01BT/ARK-2-051": [
    withCondition(onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3000), prompt: "选择对方前线中最多 1 张 BP 不高于 3000 的角色退场" }), sideline(chosen("target"))), removalAtLeast(3)),
    staticSelf({ keywords: ["冲击1"] }, removalAtLeast(6)),
    activateMain({ condition: removalAtLeast(9), once: true }, chooseOwn("chen", { max: 1, filter: named("陈"), prompt: "选择我方场上最多 1 张〈陈〉" }), bp("self", 1000), ifThen(chosenCount("chen"), [grant("self", "伤害+1")]))
  ],

  // 凯尔希：此角色处于活跃状态的场合，此角色的产生能量+(紫)。
  "UCEX01BT/ARK-2-052": [staticSelf({ energy: 1 }, selfActive)],

  // 博士：当此卡牌置于场外时，可以将此卡牌从场外置于移除区。这样做的场合，发动此卡牌的【登场时】效果。
  //      此卡牌无法在前线中登场，无法移动至前线。
  //      【登场时】选择我方场上的最多1张〈博士〉以外的紫色的[“特征：罗德岛制药公司”或〈陈〉]，本回合中，BP+1000。
  "UCEX01BT/ARK-2-053": [
    staticSelf({ flags: ["energyLineOnly", "cannotMove"] }),
    onPlay(...doctorOnPlay),
    when(["onEnterSideline"], may("将「博士」从场外置于移除区，并发动它的【登场时】效果？",
      run("「博士」从场外置于移除区", (env) => {
        const index = env.owner.sideline.lastIndexOf(env.selfCardId);
        if (index >= 0) env.owner.removal.push(...env.owner.sideline.splice(index, 1));
      }),
      ...doctorOnPlay))
  ],

  // 切尔诺伯格（场地）：此场地以活跃状态登场。 【启动主要】〔转为休息状态〕选择我方场上的1张角色，本回合中，BP+1000。
  "UCEX01BT/ARK-2-055": [
    onPlay(activate("self")),
    activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, prompt: "选择我方场上 1 张角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))
  ],

  // 决战（事件）：选择我方的最多2张AP卡牌，转为活跃状态。
  "UCEX01BT/ARK-2-056": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 不息恶火（事件）：选择对方前线中的1张角色，本回合中，BP-4000。我方的场上存在〈不死的黑蛇 塔露拉〉的场合，对方前线中的所有角色，本回合中，BP-1000。
  "UCEX01BT/ARK-2-057": [onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色（本回合 BP-4000）" }), bp(chosen("target"), -4000),
    ifThen(youHaveNamedNow("不死的黑蛇 塔露拉"), [bp((env) => env.opponent.front.filter((card) => isCharacter(env, card)), -1000)]))],

  // 赤霄＆影霄（事件）：选择对方前线中的最多1张『BP不高于3000』的角色退场。我方的场上存在〈阿米娅〉或〈陈〉的场合，改为『BP不高于4000』。我方的场上存在〈阿米娅〉和〈陈〉的场合，改为『BP不高于5000』。
  "UCEX01BT/ARK-2-058": [onUse(chooseOpponent("target", {
    line: "front", max: 1, filter: bpAtMost((env) => 3000 + 1000 * [youHaveNamed("阿米娅")(env), youHaveNamed("陈")(env)].filter(Boolean).length),
    prompt: "选择对方前线中最多 1 张 BP 不高于 3000（我方有〈阿米娅〉或〈陈〉时 4000，两者都有时 5000）的角色退场"
  }), sideline(chosen("target")))],

  // 久远的回忆（事件）：确认我方卡组最上方的4张卡牌。将其中最多2张加入手牌，剩余的卡牌置于移除区。
  "UCEX01BT/ARK-2-059": [onUse(look(4), chooseLooked("pick", { max: 2, prompt: "选择最多 2 张加入手牌（其余置于移除区）" }), moveChosen("pick", "hand"),
    run("剩余的卡牌置于移除区", (env) => { const looking = env.game.looking; if (looking?.cards.length) { env.owner.removal.push(...looking.cards); looking.cards = []; } }))],

  // 不屈（事件）：从我方的场外将最多1张角色卡牌加入手牌。我方的场上存在卡牌名包含“塔露拉”的角色的场合，抽取1张卡牌。
  "UCEX01BT/ARK-2-060": [onUse(chooseFromSideline("card", { max: 1, filter: isCharacterCard, prompt: "从我方场外选择最多 1 张角色卡加入手牌" }), moveChosen("card", "hand"), ifThen(youHaveNameIncluding("塔露拉"), [draw(1)]))],

  // 烈焰之中（事件）：此卡牌只有在我方的场外没有角色卡牌的场合才能使用。从下列选择1项。
  //   •抽取3张卡牌。 •选择我方场上的最多1张〈阿米娅〉，本回合中，给予BP+1000和《冲击+3》。
  "UCEX01BT/ARK-2-061": [{
    ...onUse(chooseMode("mode", ["抽取3张卡牌。", "选择我方场上的最多1张〈阿米娅〉，本回合中，给予BP+1000和《冲击+3》。"]),
      ifThen(isMode("mode", 0), [draw(3)], [chooseOwn("amiya", { max: 1, filter: named("阿米娅"), prompt: "选择我方场上最多 1 张〈阿米娅〉（本回合 BP+1000、《冲击+3》）" }), bp(chosen("amiya"), 1000), grant(chosen("amiya"), "冲击+3")])),
    useCondition: (env) => !env.owner.sideline.some((cardId) => env.ctx.card(cardId)?.type === "character")
  }]
};
