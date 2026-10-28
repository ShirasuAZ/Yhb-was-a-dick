/**
 * Abilities of the Jujutsu Kaisen blue (and two purple) cards UA02BT/JJK-1-036 ... 069 (batch jjk-2). See cards.ts for the conventions;
 * each entry follows the card's printed text, shown above it.
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, characterSidelinedThisTurn, flagsOf, queueCardEvent, loseIfNoLife, energyLineOnly, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, activeCard, all, and, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent,
  chooseOwn, chosen, chosenCount, discard, draw, duringOpponentTurn, either, energyCostAtMost, energyThisTurn, givenOnly, grant, grantAbility, ifThen, look,
  lookedToBottom, may, moveChosen, named, noneChosen, notSelf, onAttack, onPlay, onSidelined, onUse, rest, restSelf, run, selfActive, selfOnFront, sideline,
  staticSelf, toHand, when, withAffinity, withCondition, youHaveNamed
} from "./dsl.ts";

// ---- Helpers for these cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const FINGER = "宿傩的手指";
const SHRINE = "伏魔御厨子";
const ITADORI = "虎杖 悠仁";
const NANAMI = "七海 建人";
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const findField = (env: AbilityEnv, uid: string): UnionArenaFieldCard | null => env.players.flatMap(fieldOf).find((card) => card.uid === uid) ?? null;
/** The chosen field cards still on the field. */
const chosenCards = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => (env.vars[name] ?? []).flatMap((uid) => findField(env, uid) ?? []);
const ownCharacters = (env: AbilityEnv): UnionArenaFieldCard[] => fieldOf(env.owner).filter((card) => isCharacter(env, card));
/** 我方场上存在其他角色 */
const hasOtherCharacter: Condition = (env) => ownCharacters(env).some((card) => card.uid !== env.self?.uid);
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;

/** 我方场外存在N张〈宿傩的手指〉 */
const fingerCount = (env: AbilityEnv): number => env.owner.sideline.filter((cardId) => env.ctx.card(cardId)?.name === FINGER).length;
const fingersAtLeast = (count: number): Condition => (env) => fingerCount(env) >= count;
const fingersBetween = (low: number, high: number): Condition => (env) => fingerCount(env) >= low && fingerCount(env) <= high;
/** 我方卡组不多于N张 */
const deckAtMost = (count: number): Condition => (env) => env.owner.library.length <= count;
const deckAtLeast = (count: number): Condition => (env) => env.owner.library.length >= count;
const sidelineAtLeast = (count: number): Condition => (env) => env.owner.sideline.length >= count;
/** 将我方卡组最上方的N张卡牌置于场外 */
const mill = (count: number) => (env: AbilityEnv): void => { env.owner.sideline.push(...env.owner.library.splice(0, count)); };
/** BP1500或更高 */
const bpAtLeast = (limit: number): CardFilter => (env, _cardId, card) => !!card && bpOf(env.ctx, card) >= limit;
/** 我方场外存在1张或更多［特征：呪具］（the data spells the trait 咒具）或者4张或更多事件卡牌 */
const cursedToolsOrEvents: Condition = (env) => {
  const cards = env.owner.sideline.map((cardId) => env.ctx.card(cardId));
  return cards.some((card) => card?.affinities.some((trait) => trait === "咒具" || trait === "呪具")) || cards.filter((card) => card?.type === "event").length >= 4;
};
/** 确认的卡牌里剩下的全部置于场外 */
const restOfLookedToSideline = run("剩余的卡牌置于场外", (env) => {
  const looking = env.game.looking;
  if (looking?.cards.length) { env.owner.sideline.push(...looking.cards); looking.cards = []; }
});
/** 该角色下一次转为活跃状态无效 (for chosen cards that are resting now). */
const skipNextActivate = (name: string): Step => run("该角色下一次转为活跃状态无效", (env) => {
  for (const card of chosenCards(env, name)) if (card.rested) card.skipNextActivate = true;
});
/** A field card that can be moved to the other line by our own effect (not 无法移动). */
const movable: CardFilter = (_env, _cardId, card) => !!card && !flagsOf(card).includes("cannotMove");
/** …and, going to the front line, not 无法在前线中登场 / 无法移动至前线. */
const movableToFront: CardFilter = (env, cardId, card) => movable(env, cardId, card) && !energyLineOnly(env.ctx, cardId);
const canSwapLines: Condition = (env) => env.owner.front.some((card) => isCharacter(env, card) && movable(env, card.cardId, card))
  && env.owner.energy.some((card) => isCharacter(env, card) && movableToFront(env, card.cardId, card));
/** 对方选择对方前线中的N张角色放回手牌 (the opponent picks their own; with fewer than N, all of them). */
const opponentPicksBack = (count: number): Step[] => [
  { do: "choose", as: "back", from: "field", side: "opponent", chooser: "opponent", line: "front", min: count, max: count, prompt: `选择自己前线中 ${count} 张角色放回手牌`, good: false },
  toHand(chosen("back"))
];
/** 宿傩的手指 (事件): the two ways to pay for using it. */
const fingerLifeAvailable: Condition = (env) => env.owner.life.length > 0;
const fingerItadoriAvailable: Condition = (env) => fieldOf(env.owner).some((card) => isCharacter(env, card) && env.ctx.card(card.cardId)?.name === ITADORI && !card.rested);
/** 瓦落瓦落: where the character goes. */
const PLACES = ["置于卡组最上方", "置于卡组最下方"];
/** Only a card number's plain-text keyword line: its keywords come from the card data. */
const NO_ABILITY: readonly Ability[] = [];

export const JJK_2_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 伊地知 洁高：【启动主要】[转为休息状态][每回合1次]此角色产生能量+●蓝●。主要阶段结束时，将此角色退场。
  "UA02BT/JJK-1-036": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 虎杖 悠仁：【登场时】确认我方卡组最上方的5张卡牌。公开其中最多1张〈宿傩的手指〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将我方的1张手牌置于卡组最下方。
  "UA02BT/JJK-1-038": [onPlay(
    look(5), chooseLooked("pick", { max: 1, filter: named(FINGER), prompt: "公开最多 1 张〈宿傩的手指〉并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(),
    ifThen(chosenCount("pick"), [chooseFromHand("back", { min: 1, max: 1, prompt: "选择我方 1 张手牌置于卡组最下方" }), moveChosen("back", "deckBottom")]))],

  // 虎杖 悠仁：【登场时】选择对方前线中最多1张BP不高于3500的角色。我方场外存在1~2张〈宿傩的手指〉的场合，将选择的角色放回手牌。我方场外存在3张或更多〈宿傩的手指〉的场合，将选择的角色退场。
  "UA02BT/JJK-1-039": [onPlay(
    chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3500), prompt: "选择对方前线中最多 1 张 BP 不高于 3500 的角色" }),
    ifThen(fingersBetween(1, 2), [toHand(chosen("target"))]),
    ifThen(fingersAtLeast(3), [sideline(chosen("target"))]))],

  // 虎杖 悠仁：【突进】〈虎杖 悠仁〉转为活跃状态，并可以移动至前线。
  //          【登场时】选择对方前线中最多1张BP不高于4000的角色，放回手牌。
  "UA02BT/JJK-1-040": [onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(4000), prompt: "选择对方前线中最多 1 张 BP 不高于 4000 的角色放回手牌" }), toHand(chosen("target")))],

  // 狗卷 棘：【启动主要】[前线中存在的场合][每回合1次]选择对方场上最多1张BP1000或更高的角色，本回合中BP-500。
  "UA02BT/JJK-1-041": [activateMain({ condition: selfOnFront, once: true },
    chooseOpponent("target", { max: 1, filter: bpAtLeast(1000), prompt: "选择对方场上最多 1 张 BP1000 或更高的角色（本回合 BP-500）" }), bp(chosen("target"), -500))],

  // 钉崎 野蔷薇：【登场时】抽取1张卡牌，将我方1的张手牌置于场外。（「1的张」应为「1张」）
  "UA02BT/JJK-1-043": [onPlay(draw(1), discard(1))],

  // 钉崎 野蔷薇：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有放回手牌的场合，此角色放回手牌。
  "UA02BT/JJK-1-044": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // 五条 悟：此角色处于活跃状态的场合，此角色产生能量+●蓝●。
  "UA02BT/JJK-1-045": [staticSelf({ energy: 1 }, selfActive)],

  // 五条 悟：【攻击时】抽取1张卡牌。
  "UA02BT/JJK-1-046": [onAttack(draw(1))],

  // 宿傩：【突进】〈虎杖 悠仁〉转为活跃状态，并可以移动至前线。（cards.json 把登场时的文字里的〈宿傩的手指〉〈伏魔御厨子〉也读成了突进目标，它们不是角色，没有影响）
  //      【登场时】选择对方前线中最多1张角色，转为休息状态，该角色的下1次转为活跃状态无效。确认我方卡组最上方的5张卡牌。公开其中最多1张〈宿傩的手指〉或〈伏魔御厨子〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。
  "UA02BT/JJK-1-047": [onPlay(
    chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态（下一次转为活跃状态无效）" }),
    ifThen(chosenCount("target"), [rest(chosen("target")), skipNextActivate("target")]),
    look(5), chooseLooked("pick", { max: 1, filter: either(named(FINGER), named(SHRINE)), prompt: "公开最多 1 张〈宿傩的手指〉或〈伏魔御厨子〉并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom())],

  // 宿傩：【冲击①】（当在进行攻击的战斗中胜利时，给与对方玩家1点伤害）
  //      【登场时】[前线中存在的场合]对方选择对方前线中的『1张』角色放回手牌。我方场外存在2~3张〈宿傩的手指〉的场合，改为选择『2张』。我方场外存在4张或更多〈宿傩的手指〉的场合，改为选择『3张』。
  "UA02BT/JJK-1-048": [withCondition(onPlay(
    ifThen(fingersAtLeast(4), opponentPicksBack(3), [ifThen(fingersAtLeast(2), opponentPicksBack(2), opponentPicksBack(1))])), selfOnFront)],

  // 禅院 真希：我方场外存在1张或更多［特征：呪具］或者4张或更多事件卡牌的场合，此角色BP+1000。
  "UA02BT/JJK-1-049": [staticSelf({ bp: 1000 }, cursedToolsOrEvents)],

  // 禅院 真希：【对方的回合中】我方场外存在1张或更多［特征：呪具］或者4张或更多事件卡牌的场合，此角色BP+1500。
  //          【登场时】确认我方卡组最上方的2张卡牌。将其中1张卡牌并加入手牌。剩余的卡牌置于场外。
  "UA02BT/JJK-1-050": [
    staticSelf({ bp: 1500 }, all(duringOpponentTurn, cursedToolsOrEvents)),
    onPlay(look(2), chooseLooked("pick", { min: 1, max: 1, prompt: "选择 1 张卡牌加入手牌（剩余的置于场外）" }), moveChosen("pick", "hand"), restOfLookedToSideline)
  ],

  // 七海 建人：【攻击时】可以将我方卡组最上方1张卡牌置于场外。那样做的场合，选择对方场上最多1张BP1500或更高的角色，本回合中BP-1500。
  "UA02BT/JJK-1-052": [onAttack(ifThen(deckAtLeast(1), [may("将卡组最上方 1 张卡牌置于场外？",
    run("将卡组最上方 1 张卡牌置于场外", mill(1)),
    chooseOpponent("target", { max: 1, filter: bpAtLeast(1500), prompt: "选择对方场上最多 1 张 BP1500 或更高的角色（本回合 BP-1500）" }), bp(chosen("target"), -1500))]))],

  // 七海 建人：我方卡组不多于15张的场合，此角色获得【冲击①】
  //          【登场时】可以将我方场外存在的7张卡牌置于除外区，那样做的场合，抽取3张卡牌。
  "UA02BT/JJK-1-053": [
    staticSelf({ keywords: ["冲击1"] }, deckAtMost(15)),
    onPlay(ifThen(sidelineAtLeast(7), [may("将场外 7 张卡牌置于移除区，抽取 3 张卡牌？",
      chooseFromSideline("cost", { min: 7, max: 7, prompt: "选择我方场外 7 张卡牌置于移除区" }), moveChosen("cost", "removal"), draw(3))]))
  ],

  // 七海 建人：【突进】〈七海 建人〉转为活跃状态，并可以移动至前线。
  //          我方卡组不多于15张的场合，此角色BP+1000并获得【冲击①】和【伤害②】
  //          【退场时】可以将我方卡组最上方2张卡牌置于场外。那样做的场合，选择对方前线中最多1张角色，转为休息状态。
  "UA02BT/JJK-1-054": [
    staticSelf({ bp: 1000, keywords: ["冲击1", "伤害2"] }, deckAtMost(15)),
    onSidelined(ifThen(deckAtLeast(2), [may("将卡组最上方 2 张卡牌置于场外？",
      run("将卡组最上方 2 张卡牌置于场外", mill(2)),
      chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态" }), rest(chosen("target")))]))
  ],

  // 熊猫：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）
  //      （只有关键字一行，写成【】而不是《》，所以要有一个空条目才算全自动；冲击无效来自卡牌数据里的关键字）
  "UA02BT/JJK-1-055": NO_ABILITY,

  // 伏黑 惠：【登场时】选择对方场上最多1张BP1500或更高的角色，本回合中BP-1000。
  "UA02BT/JJK-1-056": [onPlay(chooseOpponent("target", { max: 1, filter: bpAtLeast(1500), prompt: "选择对方场上最多 1 张 BP1500 或更高的角色（本回合 BP-1000）" }), bp(chosen("target"), -1000))],

  // 伏黑 惠：【登场时】选择对方场上最多1张场地，将其置于对方卡组最下方。
  "UA02BT/JJK-1-057": [onPlay(
    { do: "choose", as: "site", from: "field", side: "opponent", characters: false, filter: (env, cardId) => env.ctx.card(cardId)?.type === "site", min: 0, max: 1, prompt: "选择对方场上最多 1 张场地置于其卡组最下方", good: false },
    { do: "toDeckBottom", target: chosen("site") })],

  // 夜蛾 正道：【启动主要】[转为休息状态]选择我方场上的1张其他角色，本回合中，BP+1000。
  "UA02BT/JJK-1-058": [activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 吉野 顺平：【退场时】抽取1张卡牌。
  "UA02BT/JJK-1-059": [onSidelined(draw(1))],

  // 东堂 葵：【攻击时】可以选择我方前线中和能量线中的角色各1张，交换他们的位置。
  "UA02BT/JJK-1-060": [withCondition(onAttack(may("选择我方前线和能量线中的角色各 1 张，交换位置？",
    chooseOwn("front", { line: "front", min: 1, max: 1, filter: movable, prompt: "选择我方前线中 1 张角色（与能量线的角色交换位置）" }),
    chooseOwn("energy", { line: "energy", min: 1, max: 1, filter: movableToFront, prompt: "选择我方能量线中 1 张角色（与前线的角色交换位置）" }),
    run("交换所选前线与能量线角色的位置", (env) => {
      const front = chosenCards(env, "front")[0];
      const energy = chosenCards(env, "energy")[0];
      if (!front || !energy || !env.owner.front.includes(front) || !env.owner.energy.includes(energy)) return;
      env.owner.front = env.owner.front.map((card) => (card === front ? energy : card));
      env.owner.energy = env.owner.energy.map((card) => (card === energy ? front : card));
      queueCardEvent(env.game, env.ctx, "onMoveToEnergy", env.owner, front);
      queueCardEvent(env.game, env.ctx, "onMoveToFront", env.owner, energy);
    }))), canSwapLines)],

  // 伏魔御厨子（场地）：此场地以活跃状态登场。
  //                  【启动主要】[转为休息状态]选择我方场上的1张〈宿傩〉，本回合中，根据我方场外存在的〈宿傩的手指〉的数量，此角色获得下列全部效果。
  //                  ・2张或更多：【伤害②】 ・3张或更多：▼瞄准攻击▼ ・4张或更多：▼冲击（+1）▼
  "UA02BT/JJK-1-061": [
    onPlay(activate("self")),
    activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, filter: named("宿傩"), prompt: "选择我方场上 1 张〈宿傩〉" }),
      ifThen(fingersAtLeast(2), [grant(chosen("target"), "伤害2")]),
      ifThen(fingersAtLeast(3), [grant(chosen("target"), "瞄准攻击")]),
      ifThen(fingersAtLeast(4), [grant(chosen("target"), "冲击+1")]))
  ],

  // 迳庭拳（事件）：选择对方前线中的1张BP不高于5000的角色，『放回手牌』。我方场上存在〈虎杖 悠仁〉的场合，改为『将此角色退场』。
  "UA02BT/JJK-1-062": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中 1 张 BP 不高于 5000 的角色" }),
    ifThen(youHaveNamed(ITADORI), [sideline(chosen("target"))], [toHand(chosen("target"))]))],

  // 宿傩的手指（事件）：使用此卡牌时，只有将我方的1张生命值置于场外或将我方场上的1张活跃状态的〈虎杖 悠仁〉转为休息状态才能使用。
  //                  抽取1张卡牌。选择我方的最多1张AP卡牌转为活跃状态。
  "UA02BT/JJK-1-063": [{
    ...onUse(
      ifThen(all(fingerLifeAvailable, fingerItadoriAvailable), [chooseMode("cost", ["将我方的 1 张生命值置于场外", `将我方场上的 1 张活跃状态的〈${ITADORI}〉转为休息状态`])]),
      ifThen((env) => (env.vars.cost ? env.vars.cost[0] === "m:0" : fingerLifeAvailable(env)),
        [run("将我方生命区的 1 张卡牌置于场外", (env) => { const slot = env.owner.life.shift(); if (slot) env.owner.sideline.push(slot.cardId); loseIfNoLife(env.game, env.players, env.owner); })],
        [chooseOwn("itadori", { min: 1, max: 1, filter: and(named(ITADORI), activeCard), prompt: `选择我方场上 1 张活跃状态的〈${ITADORI}〉转为休息状态` }), rest(chosen("itadori"))]),
      draw(1), chooseAp("ap", 1), activateAp("ap")),
    useCondition: (env) => fingerLifeAvailable(env) || fingerItadoriAvailable(env)
  }],

  // 十画咒法「瓦落瓦落」（事件）：选择对方前线中的1张BP不高于5000的角色，『对方选择』将其置于卡组最上方或最下方。我方场上存在〈七海 建人〉的场合，改为『我方选择』。
  "UA02BT/JJK-1-064": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中 1 张 BP 不高于 5000 的角色" }),
    ifThen(chosenCount("target"), [
      ifThen(youHaveNamed(NANAMI), [chooseMode("place", PLACES)],
        [{ do: "choose", as: "place", from: "mode", side: "you", chooser: "opponent", modes: PLACES, min: 1, max: 1, prompt: "选择将该角色置于卡组最上方或最下方", good: true }]),
      { do: "toDeckBottom", target: chosen("target") },
      ifThen(modeIs("place", 0), [run("该角色改为置于卡组最上方", (env) => { const library = env.opponent.library; if (library.length) library.unshift(library.pop()!); })])
    ]))],

  // 屠坐魔（事件，特征：咒具）：选择我方前线中的1张角色本回合中BP+2000。抽取1张卡牌。
  "UA02BT/JJK-1-065": [onUse(chooseOwn("target", { line: "front", min: 1, max: 1, prompt: "选择我方前线中 1 张角色（本回合 BP+2000）" }), bp(chosen("target"), 2000), draw(1))],

  // 游云（事件，特征：咒具）：选择对方前线中的1张BP不高于2500的角色退场。
  "UA02BT/JJK-1-066": [onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(2500), prompt: "选择对方前线中 1 张 BP 不高于 2500 的角色退场" }), sideline(chosen("target")))],

  // 领域展开（事件）：选择我方的最多2张AP卡牌转为活跃状态。
  "UA02BT/JJK-1-067": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 夏油 杰：【登场时】可以将我方场上的1张其他角色退场，那样做的场合，确认我方卡组最上方的6张卡牌。公开其中最多2张［特征：咒灵］并加入手牌。剩余的卡牌置于场外。
  "UA02BT/JJK-1-068": [onPlay(ifThen(hasOtherCharacter, [may("将我方场上的 1 张其他角色退场，确认卡组最上方的 6 张卡牌？",
    chooseOwn("out", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色退场" }), sideline(chosen("out")),
    ifThen((env) => (env.vars.out ?? []).length > 0 && chosenCards(env, "out").length === 0, [
      look(6), chooseLooked("pick", { max: 2, filter: withAffinity("咒灵"), prompt: "公开最多 2 张［特征：咒灵］并加入手牌（剩余的置于场外）" }), moveChosen("pick", "hand"), restOfLookedToSideline
    ]))]))],

  // 夏油 杰：【冲击①】（当在进行攻击的战斗中胜利时，给与对方玩家1点伤害）
  //        【登场时】可以将我方场上的1张其他角色退场。
  //        【启动主要】[转为休息状态][每回合1次]只有在本回合中我方角色退场过的场合才能发动。对方退场对方场上的1张角色。
  "UA02BT/JJK-1-069": [
    onPlay(ifThen(hasOtherCharacter, [may("将我方场上的 1 张其他角色退场？",
      chooseOwn("out", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色退场" }), sideline(chosen("out")))])),
    activateMain({ costs: [restSelf], once: true, condition: (env) => characterSidelinedThisTurn(env.game, env.owner.accountId) },
      { do: "choose", as: "out", from: "field", side: "opponent", chooser: "opponent", min: 1, max: 1, prompt: "选择自己场上 1 张角色退场", good: false },
      sideline(chosen("out")))
  ]
};
