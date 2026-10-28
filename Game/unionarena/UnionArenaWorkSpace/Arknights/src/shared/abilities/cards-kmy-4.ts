/** Abilities of the KMY cards, batch 4 (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { energyLineOnly, flagsOf, queueCardEvent } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step, StaticAbility } from "./types.ts";
import {
  activate, activateMain, all, and, apCostIs, apCost, bp, bpAtMost, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn, chosen,
  chosenCount, costChange, discard, discardCost, draw, duringYourTurn, either, energyThisTurn, grant, grantAbility, ifThen, isCharacterCard, look, lookedToBottom,
  may, moveChosen, moveLine, named, notSelf, ofColor, onAttack, onPlay, onSidelined, onUse, oncePerTurn, rest, restSelf, run, selfActive, selfOnFront, sideline,
  sidelinedByBpOrOpponent, sidelineSelf, givenOnly, staticAura, staticSelf, toHand, when, withAffinity, withCondition, youHaveNamed
} from "./dsl.ts";
import { KMY_1_ABILITIES } from "./cards-kmy-1.ts";

// ---- Helpers for the KMY cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;

/** 猪子 / 炭子 / 善子 "此卡牌也视为〈…〉" (same table as cards-kmy-3.ts): a card named by its number wherever it is. */
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
  const alias = ALIAS_OF_NUMBER[stats?.number ?? ""];
  return [stats?.name ?? "", ...(alias ? [alias] : []), ...flagsOf(card).flatMap((mark) => (mark.startsWith("name:") ? [mark.slice(5)] : []))];
};
/** 我方的场上存在〈name〉 -- a character (counting a card also regarded as that name) */
const hasNamedCharacter = (name: string): Condition => (env) => fieldOf(env).some((card) => isCharacter(env, card) && namesOf(env, card).includes(name));
/** 我方的场上存在〈name〉 -- a card of any type (the 〈日轮刀(…)〉 sites are not characters) */
const hasNamedCard = (name: string): Condition => (env) => fieldOf(env).some((card) => namesOf(env, card).includes(name));
/** 我方的场上存在“特征：affinity”的卡牌 (any card type; the 日轮刀 are sites) */
const hasAffinityCard = (affinity: string): Condition => (env) => fieldOf(env).some((card) => env.ctx.card(card.cardId)?.affinities.includes(affinity) === true);

const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;
const printedCostAtMost = (limit: number): CardFilter => (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= limit;
const yellowCharacter: CardFilter = and(isCharacterCard, ofColor("yellow"));
const KATANA = "日轮刀";
const katanaCard = withAffinity(KATANA);
const NEZUKO = "灶门 祢豆子";
const TANJIRO = "灶门 炭治郎";
const nezukoCard = named(NEZUKO);

/** The number of 〈产屋敷 耀哉〉 and [特征:柱] characters on our field -- this card included (the texts here do not say 其他). */
const pillarTotal = (env: AbilityEnv): number =>
  fieldOf(env).filter((card) => isCharacter(env, card) && (env.ctx.card(card.cardId)?.name === "产屋敷 耀哉" || env.ctx.card(card.cardId)?.affinities.includes("柱") === true)).length;
const pillarTotalAtLeast = (count: number): Condition => (env) => pillarTotal(env) >= count;
const pillarCard = withAffinity("柱");

/** A field card that an effect can move to the other line (not 无法移动; one that may not stand on the front line cannot go there). */
const movable: CardFilter = (env, cardId, card) => !!card && !flagsOf(card).includes("cannotMove") && (env.owner.front.includes(card) || !energyLineOnly(env.ctx, cardId));

const PLACES = ["置于卡组最上方", "置于卡组最下方"];
/** 将确认的卡牌置于卡组最上方或最下方 (the choice is `where`, m:0 = top). */
const putLookedOnTopOrBottom = run("将确认的卡牌置于卡组最上方或最下方", (env) => {
  const looking = env.game.looking;
  if (!looking?.cards.length) return;
  if (env.vars.where?.[0] === "m:0") env.owner.library.unshift(...looking.cards);
  else env.owner.library.push(...looking.cards);
  looking.cards = [];
});
/** 将我方的1张手牌置于我方卡组的最上方或最下方 */
const handToTopOrBottom: Step[] = [
  chooseFromHand("back", { min: 1, max: 1, prompt: "选择我方 1 张手牌，置于卡组最上方或最下方" }),
  ifThen(chosenCount("back"), [
    chooseMode("where", PLACES),
    run("将选择的手牌置于卡组最上方或最下方", (env) => {
      const key = env.vars.back?.[0];
      if (!key?.startsWith("h:")) return;
      const [card] = env.owner.hand.splice(Number(key.slice(2)), 1);
      if (!card) return;
      if (env.vars.where?.[0] === "m:0") env.owner.library.unshift(card);
      else env.owner.library.push(card);
    })
  ])
];

/** 确认我方卡组最上方的N张卡牌。公开其中最多1张(filter)并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。 */
const searchDeck = (count: number, filter: CardFilter, prompt: string): Step[] => [look(count), chooseLooked("pick", { max: 1, filter, prompt }), moveChosen("pick", "hand"), lookedToBottom()];

/** 对方将自己场外存在的N张卡牌置于移除区 (the opponent picks from their own sideline; with fewer than N, all of them). */
const opponentRemovesFromSideline = (count: number): Step[] => [
  { do: "choose", as: "out", from: "sideline", side: "opponent", chooser: "opponent", min: count, max: count, prompt: `选择自己场外 ${count} 张卡牌置于移除区`, good: false },
  run("对方将选择的卡牌置于移除区", (env) => {
    const indexes = (env.vars.out ?? []).filter((key) => key.startsWith("os:")).map((key) => Number(key.slice(3))).sort((a, b) => b - a);
    const removed = indexes.flatMap((index) => env.opponent.sideline.splice(index, 1));
    env.opponent.removal.push(...removed.reverse());
  })
];

/** 交换前线与能量线的两张角色的位置 (as cards-kmy-1.ts, 祢豆子 011). */
const swappable: CardFilter = (env, cardId, card) => !!card && !flagsOf(card).includes("cannotMove") && (env.owner.front.includes(card) || !energyLineOnly(env.ctx, cardId));
const findOwn = (env: AbilityEnv, uid: string): UnionArenaFieldCard | undefined => fieldOf(env).find((card) => card.uid === uid);

/** 灶门 祢豆子 021: the looked-at card is 〈灶门 炭治郎〉 (also 炭子) or 〈日轮刀(灶门 炭治郎)〉. */
const lookedIsTanjiroOrKatana = (env: AbilityEnv): boolean => {
  const cardId = env.game.looking?.cards[0];
  const stats = cardId ? env.ctx.card(cardId) : null;
  return !!stats && (stats.name === TANJIRO || stats.name === "日轮刀(灶门 炭治郎)" || ALIAS_OF_NUMBER[stats.number ?? ""] === TANJIRO);
};
/** 将确认的卡牌置于我方卡组的最上方 (the looked-at card goes back where it was). */
const lookedBackOnTop = run("将确认的卡牌置于卡组最上方", (env) => {
  const looking = env.game.looking;
  if (!looking?.cards.length) return;
  env.owner.library.unshift(...looking.cards);
  looking.cards = [];
});

/** 灶门 祢豆子 002's shield: our 〈灶门 祢豆子〉. */
const ownNezuko: NonNullable<StaticAbility["affects"]> = (env, card, cardOwner) => cardOwner === env.owner && isCharacter(env, card) && env.ctx.card(card.cardId)?.name === NEZUKO;
const activeFrontNezuko: CardFilter = (env, cardId, card) => !!card && !card.rested && env.owner.front.includes(card) && env.ctx.card(cardId)?.name === NEZUKO;

export const KMY_4_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 不死川 实弥：【2次攻击】（当此角色在本回合中首次进行攻击时，转为活跃状态）
  //            (keyword line only: the keyword is already in the card data)
  "EX05BT/KMY-1-022": [],

  // 悲鸣屿 行冥：我方我方场上存在合计3张或更多的〈产屋敷 耀哉〉和其他的“特征:柱”的场合，此角色获得【冲击①】（当在进行攻击的战斗中胜利时，给与对方玩家1点伤害）。
  //            (the same effect as UA05BT/KMY-1-026)
  "EX05BT/KMY-1-026": KMY_1_ABILITIES["UA05BT/KMY-1-026"]!,

  // 产屋敷 耀哉：【启动主要】[转为休息状态][将此角色退场]选择我方场上的一张“特征：柱”，转为活跃状态。
  "EX05BT/KMY-3-001": [activateMain({ costs: [restSelf, sidelineSelf] },
    chooseOwn("target", { min: 1, max: 1, filter: pillarCard, prompt: "选择我方场上 1 张[特征:柱]转为活跃状态" }), activate(chosen("target")))],

  // 灶门 炭治郎：【我方的回合中】[前线中存在的场合]我方场上的〈灶门 祢豆子〉不会被对方角色的效果或触发的效果选择。
  //            【登场时】可以将我方前线中的1张活跃状态的〈灶门 祢豆子〉转为休息状态。这样做的场合，将此角色转为活跃状态。
  "EX05BT/KMY-3-002": [
    staticAura(ownNezuko, { flags: ["untargetable:character", "noTriggerTarget"] }, all(duringYourTurn, selfOnFront)),
    onPlay(ifThen((env) => env.owner.front.some((card) => activeFrontNezuko(env, card.cardId, card)), [may("将我方前线中 1 张活跃状态的〈灶门 祢豆子〉转为休息状态，然后将此角色转为活跃状态？",
      chooseOwn("nezuko", { line: "front", min: 1, max: 1, filter: activeFrontNezuko, prompt: "选择我方前线中 1 张活跃状态的〈灶门 祢豆子〉转为休息状态" }),
      rest(chosen("nezuko")), activate("self"))]))
  ],

  // 灶门 祢豆子：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "EX05BT/KMY-3-003": [onPlay(draw(1), discard(1))],

  // 神崎 葵：【登场时】可以将我方的1张手牌置于场外。这样做的场合，从我方的场外将最多1张所需能量不高于3的黄色的角色卡牌加入手牌。
  "EX05BT/KMY-3-004": [onPlay(ifThen((env) => env.owner.hand.length > 0, [may("将 1 张手牌置于场外，然后从场外将最多 1 张所需能量不高于 3 的黄色角色加入手牌？",
    discard(1), chooseFromSideline("pick", { max: 1, filter: and(yellowCharacter, printedCostAtMost(3)), prompt: "从场外选择最多 1 张所需能量不高于 3 的黄色角色加入手牌" }), moveChosen("pick", "hand"))]))],

  // 珠世：【启动主要】[转为休息状态]对方将自己场外存在的『1张』卡牌置于移除区。对方的场外存在10张或更多的卡牌的场合，改为『2张』。
  "EX05BT/KMY-3-005": [activateMain({ costs: [restSelf] },
    ifThen((env) => env.opponent.sideline.length >= 10, opponentRemovesFromSideline(2), opponentRemovesFromSideline(1)))],

  // 愈史郎：我方的场上存在〈珠世〉的场合，此角色BP+1000。
  "EX05BT/KMY-3-006": [staticSelf({ bp: 1000 }, youHaveNamed("珠世"))],

  // 甘露寺 蜜璃：【启动主要】[前线中存在的场合][将1张手牌置于场外][每回合1次]选择我方场上的一张消费AP为2的“特征：柱”，转为活跃状态。
  "EX05BT/KMY-3-007": [activateMain({ costs: [discardCost(1)], condition: selfOnFront, once: true },
    chooseOwn("target", { min: 1, max: 1, filter: and(apCostIs(2), pillarCard), prompt: "选择我方场上 1 张消费 AP 为 2 的[特征:柱]转为活跃状态" }), activate(chosen("target")))],

  // 蝴蝶 忍：【撤步】（可以在我方的移动阶段中从前线移动至能量线）
  //        当此角色在进行攻击的战斗中败北时，抽取最多1张卡牌。
  //        【退场时】因BP变为0或更低或通过对方的效果，此角色退场的场合，抽取1张卡牌。
  "EX05BT/KMY-3-008": [
    when(["onLoseAttackBattle"], may("抽取 1 张卡牌？", draw(1))),
    withCondition(onSidelined(draw(1)), sidelinedByBpOrOpponent)
  ],

  // 时透 无一郎：【启动主要】[前线中存在的场合][每回合1次]选择我方场上的一张消费AP为2的“特征：柱”，本回合中，给予【冲击+1】（冲击给予的伤害+1，没有冲击的场合，获得【冲击①】）
  "EX05BT/KMY-3-009": [activateMain({ condition: selfOnFront, once: true },
    chooseOwn("target", { min: 1, max: 1, filter: and(apCostIs(2), pillarCard), prompt: "选择我方场上 1 张消费 AP 为 2 的[特征:柱]（本回合获得【冲击+1】）" }), grant(chosen("target"), "冲击+1"))],

  // 富冈 义勇：我方我方场上存在合计3张或更多的〈产屋敷 耀哉〉和“特征:柱”的场合，手牌中存在的此卡牌的消费AP-1。
  //          【攻击时】我方我方场上存在合计6张或更多的〈产屋敷 耀哉〉和“特征:柱”的场合，选择我方场上的最多1张其他的“特征：柱”，本回合中，BP+1500。
  "EX05BT/KMY-3-010": [
    costChange({ ap: 1 }, pillarTotalAtLeast(3)),
    withCondition(onAttack(
      chooseOwn("target", { max: 1, filter: and(notSelf, pillarCard), prompt: "选择我方场上最多 1 张其他的[特征:柱]（本回合 BP+1500）" }), bp(chosen("target"), 1500)),
    pillarTotalAtLeast(6))
  ],

  // 看护（事件）：从我方的场外将1张角色卡牌加入手牌。
  "EX05BT/KMY-3-011": [onUse(
    chooseFromSideline("pick", { min: 1, max: 1, filter: isCharacterCard, prompt: "从场外选择 1 张角色卡牌加入手牌" }), moveChosen("pick", "hand"))],

  // 隐：【登场时】从下列选择1项。
  //   ·选择我方场上的最多1张角色，移动至其他线中。
  //   ·选择我方前线中的角色和我方能量线中的角色各1张，可以交换他们的位置。
  "EX05BT/KMY-3-012": [onPlay(
    chooseMode("mode", ["选择我方场上的最多1张角色，移动至其他线中。", "选择我方前线中的角色和我方能量线中的角色各1张，可以交换他们的位置。"]),
    ifThen(modeIs("mode", 0), [
      chooseOwn("mover", { max: 1, filter: movable, prompt: "选择我方场上最多 1 张角色，移动至其他线中" }),
      ifThen(chosenCount("mover"), [moveLine(chosen("mover"))])
    ]),
    ifThen(modeIs("mode", 1), [
      chooseOwn("front", { line: "front", min: 1, max: 1, filter: swappable, prompt: "选择我方前线中的 1 张角色（与能量线中的 1 张角色交换位置）" }),
      chooseOwn("back", { line: "energy", min: 1, max: 1, filter: swappable, prompt: "选择我方能量线中的 1 张角色（与前线中的 1 张角色交换位置）" }),
      ifThen(all(chosenCount("front"), chosenCount("back")), [may("交换他们的位置？", run("交换前线与能量线的两张角色的位置", (env) => {
        const front = findOwn(env, env.vars.front![0]!);
        const back = findOwn(env, env.vars.back![0]!);
        if (!front || !back || !env.owner.front.includes(front) || !env.owner.energy.includes(back)) return;
        env.owner.front = env.owner.front.map((card) => (card === front ? back : card));
        env.owner.energy = env.owner.energy.map((card) => (card === back ? front : card));
        queueCardEvent(env.game, env.ctx, "onMoveToEnergy", env.owner, front);
        queueCardEvent(env.game, env.ctx, "onMoveToFront", env.owner, back);
      }))])
    ]))],

  // 鎹鸦：【启动主要】[转为休息状态][每回合1次]本回合中，此角色的产生能量+[蓝]。当主要阶段结束时，将此角色退场。
  "EX05BT/KMY-3-013": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 灶门 炭治郎：[每回合1次]当此角色被我方的“特征：日轮刀”的效果选择时，此角色在本回合中，BP+500。
  "EX05BT/KMY-3-015": [oncePerTurn(when(["onChosenByKatana"], bp("self", 500)))],

  // 灶门 炭治郎：[每回合1次]当此角色被我方的“特征：日轮刀”的效果选择时，选择我方场上的最多1张〈灶门 祢豆子〉，本回合中，BP+1000。
  //            【启动主要】[前线中存在的场合][支付1AP][每回合1次]选择我方场上的1张〈灶门 祢豆子〉，本回合中，BP+1000。
  "EX05BT/KMY-3-016": [
    oncePerTurn(when(["onChosenByKatana"],
      chooseOwn("nezuko", { max: 1, filter: nezukoCard, prompt: "选择我方场上最多 1 张〈灶门 祢豆子〉（本回合 BP+1000）" }), bp(chosen("nezuko"), 1000))),
    activateMain({ costs: [apCost(1)], condition: selfOnFront, once: true },
      chooseOwn("nezuko", { min: 1, max: 1, filter: nezukoCard, prompt: "选择我方场上 1 张〈灶门 祢豆子〉（本回合 BP+1000）" }), bp(chosen("nezuko"), 1000))
  ],

  // 灶门 炭治郎：【突进】〈灶门 炭治郎〉转为活跃状态，并可以移动至前线
  //            [每回合1次]当此角色被我方的“特征：日轮刀”的效果选择时，此角色在本回合中，获得【冲击①】。
  //            【登场时】可以将我方场上的1张〈灶门 祢豆子〉放回手牌。这样做的场合，将我方的1张手牌置于场外，选择对方前线中的最多1张BP不高于4000的角色，退场。
  "EX05BT/KMY-3-017": [
    oncePerTurn(when(["onChosenByKatana"], grant("self", "冲击1"))),
    onPlay(ifThen((env) => fieldOf(env).some((card) => nezukoCard(env, card.cardId, card)), [may("将我方场上的 1 张〈灶门 祢豆子〉放回手牌，然后将 1 张手牌置于场外，并选择对方前线中最多 1 张 BP 不高于 4000 的角色退场？",
      chooseOwn("nezuko", { min: 1, max: 1, filter: nezukoCard, prompt: "选择我方场上 1 张〈灶门 祢豆子〉放回手牌" }), toHand(chosen("nezuko")),
      discard(1),
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(4000), prompt: "选择对方前线中最多 1 张 BP 不高于 4000 的角色退场" }), sideline(chosen("target")))]))
  ],

  // 灶门 祢豆子：【登场时】确认我方卡组最上方的1张卡牌。将其置于我方卡组的最上方或最下方。
  "EX05BT/KMY-3-018": [onPlay(look(1), ifThen((env) => (env.game.looking?.cards.length ?? 0) > 0, [chooseMode("where", PLACES), putLookedOnTopOrBottom]))],

  // 灶门 祢豆子：【登场时】抽取1张卡牌，将我方的1张手牌置于我方卡组的最上方或最下方。
  "EX05BT/KMY-3-019": [onPlay(draw(1), ...handToTopOrBottom)],

  // 灶门 祢豆子：【攻击时】确认我方卡组最上方的1张卡牌。将其置于我方卡组的最上方。确认的卡牌为〈灶门 炭治郎〉或〈日轮刀(灶门 炭治郎)〉的场合，可以将其公开。这样做的场合，此角色在本回合中，BP+1000。将公开的卡牌置于我方卡组的最上方。
  "EX05BT/KMY-3-020": [onAttack(
    look(1),
    ifThen(lookedIsTanjiroOrKatana, [may("公开确认的卡牌？（此角色本回合 BP+1000）", bp("self", 1000))]),
    lookedBackOnTop)],

  // 灶门 祢豆子：【突进】〈灶门 祢豆子〉转为活跃状态，并可以移动至前线
  //            此角色从我方的场上放回手牌的场合，改为将此角色和此角色的突进源放回手牌。
  //            【我方的回合中】我方的场上存在〈灶门 炭治郎〉的场合，此角色BP+500。
  //            【登场时】我方的场上存在〈灶门 炭治郎〉的场合，『抽取1张卡牌』。我方的场上同时存在〈灶门 炭治郎〉和〈日轮刀(灶门 炭治郎)〉的场合，可以改为『抽取2张卡牌，将我方的1张手牌置于我方卡组的最上方或最下方』。
  "EX05BT/KMY-3-021": [
    staticSelf({ flags: ["underToHand"] }),
    staticSelf({ bp: 500 }, all(duringYourTurn, hasNamedCharacter(TANJIRO))),
    onPlay(ifThen(hasNamedCharacter(TANJIRO), [
      ifThen(hasNamedCard("日轮刀(灶门 炭治郎)"), [may("改为抽取 2 张卡牌，并将 1 张手牌置于卡组最上方或最下方？",
        run("改为抽取2张卡牌", (env) => { env.vars.alt = ["1"]; }), draw(2), ...handToTopOrBottom)]),
      ifThen((env) => !env.vars.alt?.length, [draw(1)])
    ]))
  ],

  // 不死川 玄弥：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）
  //            (keyword line only)
  "EX05BT/KMY-3-023": [],

  // 不死川 玄弥：此角色以活跃状态登场。
  //            【退场时】可以将此角色加入手牌。
  "EX05BT/KMY-3-024": [
    onPlay(activate("self")),
    onSidelined(ifThen((env) => env.owner.sideline.includes(env.selfCardId), [may("将此角色加入手牌？",
      run("将此角色加入手牌", (env) => {
        const index = env.owner.sideline.lastIndexOf(env.selfCardId);
        if (index >= 0) env.owner.hand.push(...env.owner.sideline.splice(index, 1));
      }))]))
  ],

  // 钢铁冢 萤：【登场时】从下列选择1项。
  //   ·确认我方卡组最上方的7张卡牌。公开其中最多1张“特征：日轮刀”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  //   ·我方的场上存在“特征：日轮刀”的场合，抽取1张卡牌。
  "EX05BT/KMY-3-025": [onPlay(
    chooseMode("mode", ["确认我方卡组最上方的7张卡牌。公开其中最多1张“特征：日轮刀”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。", "我方的场上存在“特征：日轮刀”的场合，抽取1张卡牌。"]),
    ifThen(modeIs("mode", 0), searchDeck(7, katanaCard, "公开最多 1 张[特征:日轮刀]并加入手牌")),
    ifThen(modeIs("mode", 1), [ifThen(hasAffinityCard(KATANA), [draw(1)])]))],

  // 铁穴森 钢藏：此角色处于活跃状态的场合，此角色的产生能量+[蓝]。
  "EX05BT/KMY-3-026": [staticSelf({ energy: 1 }, selfActive)],

  // 小铁：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，此角色放回手牌。
  "EX05BT/KMY-3-027": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, printedCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    toHand(chosen("target")), ifThen((env) => (env.vars.target ?? []).length === 0, [toHand("self")]))],

  // 铁地河源 铁珍：【登场时】确认我方卡组最上方的4张卡牌。公开其中最多1张“特征：刀匠村”或“特征：日轮刀”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "EX05BT/KMY-3-028": [onPlay(
    ...searchDeck(4, either(withAffinity("刀匠村"), katanaCard), "公开最多 1 张[特征:刀匠村]或[特征:日轮刀]并加入手牌"),
    ifThen(chosenCount("pick"), [discard(1)]))],

  // 缘壹零式：【退场时】从下列选择1项。
  //   ·确认我方卡组最上方的7张卡牌。公开其中最多1张“特征：日轮刀”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  //   ·从我方的场外将最多1张“特征：日轮刀”加入手牌。
  "EX05BT/KMY-3-029": [onSidelined(
    chooseMode("mode", ["确认我方卡组最上方的7张卡牌。公开其中最多1张“特征：日轮刀”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。", "从我方的场外将最多1张“特征：日轮刀”加入手牌。"]),
    ifThen(modeIs("mode", 0), searchDeck(7, katanaCard, "公开最多 1 张[特征:日轮刀]并加入手牌")),
    ifThen(modeIs("mode", 1), [
      chooseFromSideline("back", { max: 1, filter: katanaCard, prompt: "从场外选择最多 1 张[特征:日轮刀]加入手牌" }), moveChosen("back", "hand")]))],

  // 甘露寺 蜜璃：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）
  //            (keyword line only)
  "EX05BT/KMY-3-030": [],

  // 甘露寺 蜜璃：【退场时】选择我方场上的最多1张角色，本回合中，BP+1000。
  "EX05BT/KMY-3-031": [onSidelined(
    chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 甘露寺 蜜璃：【我方的回合中】[每回合1次]当此角色被我方的“特征：日轮刀”的效果选择时，此角色在本回合中，获得【伤害②】（当通过此角色的攻击给予对方直接伤害时，改为给予2点伤害）。
  "EX05BT/KMY-3-032": [withCondition(oncePerTurn(when(["onChosenByKatana"], grant("self", "伤害2"))), duringYourTurn)]
};
