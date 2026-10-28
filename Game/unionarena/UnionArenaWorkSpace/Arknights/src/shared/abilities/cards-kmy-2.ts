/** Abilities of the KMY cards, batch 2 (UA05BT/KMY-1-034 .. 065, purple; see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, characterSidelinedCountThisTurn, energyLineOnly, flagsOf, queueCardEvent } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, apCostIs, apCost, bp, bpAtMost, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn,
  chosen, chosenCount, costChange, discard, discardCost, draw, duringYourTurn, either, energyCostAtMost, energyThisTurn, givenOnly, grant, grantAbility, ifThen, look,
  lookedToBottom, may, moveChosen, moveLine, noneChosen, notSelf, onAttack, onPlay, onSidelined, onUse, oncePerTurn, opponentHasColor, put, restSelf, run, selfActive,
  selfOnFront, sideline, sidelineSelf, staticSelf, toHand, when, withAffinity, withCondition
} from "./dsl.ts";

// ---- Helpers for the KMY purple cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const fieldCharacters = (env: AbilityEnv): UnionArenaFieldCard[] => [...env.owner.front, ...env.owner.energy].filter((card) => isCharacter(env, card));
const findOwn = (env: AbilityEnv, uid: string): UnionArenaFieldCard | undefined => [...env.owner.front, ...env.owner.energy].find((card) => card.uid === uid);
const chosenCards = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => (env.vars[name] ?? []).flatMap((uid) => [...env.opponent.front, ...env.opponent.energy, ...env.owner.front, ...env.owner.energy].filter((card) => card.uid === uid));
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;
const printedCostAtMost = (limit: number): CardFilter => (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= limit;
const sidelineAtLeast = (count: number): Condition => (env) => env.owner.sideline.length >= count;
const sidelineAtMost = (count: number): Condition => (env) => env.owner.sideline.length <= count;
/** 将我方卡组最上方的N张卡牌置于场外 */
const mill = (count: number) => (env: AbilityEnv): void => { env.owner.sideline.push(...env.owner.library.splice(0, count)); };

/**
 * 此卡牌也视为〈…〉: the extra names a card has everywhere (hand, deck, sideline, field), by card number. A card with this line also carries a
 * "name:<name>" mark on the field (see the static entries below) so that a Raid onto it works.
 */
const ALSO_NAMED: Readonly<Record<string, readonly string[]>> = {
  "UA05BT/KMY-1-036": ["鬼舞辻 无惨"],
  "UA05BT/KMY-1-037": ["鬼舞辻 无惨"],
  "UA05BT/KMY-1-038": ["鬼舞辻 无惨"],
  "UA05BT/KMY-1-060": ["堕姬"]
};
const namesOfCard = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null): string[] => {
  const stats = env.ctx.card(cardId);
  return [stats?.name ?? "", ...(ALSO_NAMED[stats?.number ?? ""] ?? []), ...(card ? flagsOf(card).flatMap((mark) => (mark.startsWith("name:") ? [mark.slice(5)] : [])) : [])];
};
/** The card is named〈name〉(printed name, or a name it is also regarded as). */
const namedAlso = (name: string): CardFilter => (env, cardId, card) => namesOfCard(env, cardId, card).includes(name);
/** 我方的场上存在〈name〉 */
const youHaveNamedAlso = (name: string): Condition => (env) => fieldCharacters(env).some((card) => namedAlso(name)(env, card.cardId, card));

const GIYUTARO = "妓夫太郎";
const DAKI = "堕姬";
const LOWER_MOON = "下弦之鬼";

/** 本回合中有角色退场过 (either player's characters). */
const characterSidelinedThisTurnByAnyone: Condition = (env) =>
  characterSidelinedCountThisTurn(env.game, env.owner.accountId) + characterSidelinedCountThisTurn(env.game, env.opponent.accountId) > 0;
/** 本回合中每有1张角色退场过 */
const charactersSidelinedThisTurn = (env: AbilityEnv): number =>
  characterSidelinedCountThisTurn(env.game, env.owner.accountId) + characterSidelinedCountThisTurn(env.game, env.opponent.accountId);

/** 那样做的场合: the chosen card(s) have really left our field (a card that "will not be sidelined" stays). */
const sidelinedChosen = (name: string): Condition => (env) => {
  const uids = env.vars[name] ?? [];
  return uids.length > 0 && uids.every((uid) => !findOwn(env, uid));
};

/** A field character that can be moved to the other line by our own effect (not 无法移动; a card on the energy line not 无法移动至前线). */
const canChangeLine: CardFilter = (env, cardId, card) => !!card && !flagsOf(card).includes("cannotMove") && (env.owner.front.includes(card) || !energyLineOnly(env.ctx, cardId, env.owner));
/** Can swap with a card on the other line. */
const canSwap = canChangeLine;

/** 【退场时】/【启动主要】 of 手鬼 and 矢琶羽: choose 1 of 2 — move one character to the other line, or swap a front and an energy character. */
const moveOrSwap: Step[] = [
  chooseMode("mode", ["选择我方场上的最多1张角色，移动至其他线中。", "选择我方前线中的角色和能量线中的角色各1张，可以交换他们的位置。"]),
  ifThen(modeIs("mode", 0), [
    chooseOwn("move", { max: 1, filter: canChangeLine, prompt: "选择我方场上最多 1 张角色，移动至其他线中" }),
    ifThen(chosenCount("move"), [moveLine(chosen("move"))])
  ]),
  ifThen(modeIs("mode", 1), [
    chooseOwn("front", { line: "front", min: 1, max: 1, filter: canSwap, prompt: "选择我方前线中的 1 张角色（与能量线中的 1 张角色交换位置）" }),
    chooseOwn("back", { line: "energy", min: 1, max: 1, filter: canSwap, prompt: "选择我方能量线中的 1 张角色（与前线中的 1 张角色交换位置）" }),
    ifThen(all(chosenCount("front"), chosenCount("back")), [may("交换他们的位置？", run("交换前线与能量线中所选角色的位置", (env) => {
      const front = findOwn(env, env.vars.front![0]!);
      const back = findOwn(env, env.vars.back![0]!);
      if (!front || !back || !env.owner.front.includes(front) || !env.owner.energy.includes(back)) return;
      env.owner.front = env.owner.front.map((card) => (card === front ? back : card));
      env.owner.energy = env.owner.energy.map((card) => (card === back ? front : card));
      queueCardEvent(env.game, env.ctx, "onMoveToEnergy", env.owner, front);
      queueCardEvent(env.game, env.ctx, "onMoveToFront", env.owner, back);
    }))])
  ])
];

/** 确认我方卡组最上方的N张卡牌。公开其中最多1张〈name〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将我方的1张手牌置于场外。 */
const lookForNamed = (count: number, name: string): Step[] => [
  look(count),
  chooseLooked("pick", { max: 1, filter: namedAlso(name), prompt: `公开最多 1 张〈${name}〉并加入手牌` }), moveChosen("pick", "hand"),
  lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)])
];

/** 选择我方的1张AP卡牌转为活跃状态 */
const chooseOneAp = (as: string): Step => ({ do: "choose", as, from: "ap", side: "you", min: 1, max: 1, prompt: "选择我方 1 张 AP 卡转为活跃状态", good: true });

export const KMY_2_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 鬼舞辻 无惨：【登场时】确认我方卡组最上方的5张卡牌。公开其中最多1张[特征：下弦之鬼]并加入手牌。加入手牌的场合，将我方的1张手牌置于场外。
  //   (the printed text leaves out "剩余的卡牌自选顺序置于卡组最下方"; the looked-at cards must go somewhere, so the rest go to the bottom as on every similar card)
  "UA05BT/KMY-1-034": [onPlay(look(5),
    chooseLooked("pick", { max: 1, filter: withAffinity(LOWER_MOON), prompt: "公开最多 1 张“特征：下弦之鬼”并加入手牌" }), moveChosen("pick", "hand"),
    lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // 鬼舞辻 无惨：【冲击②】 【伤害②】
  //   我放场外的卡牌张数不高于20张的场合，此角色不能在前线中登场，不能移动至前线。
  "UA05BT/KMY-1-035": [
    staticSelf({ flags: ["energyLineOnlyIfSidelineAtMost:20"] }),
    staticSelf({ flags: ["cannotMove"] }, sidelineAtMost(20))
  ],

  // 鬼舞辻 无惨(拟态“艺妓”)：此卡牌也视为〈鬼舞辻 无惨〉。
  //   【启动主要】[每回合1次]将我方场上的其他1张角色退场，将我方卡组最上方的1张卡牌置于场外。那样做的场合，此角色在本回合中，BP+1000。
  "UA05BT/KMY-1-036": [
    staticSelf({ flags: ["name:鬼舞辻 无惨"] }),
    // Only "那样做的场合" (the BP+1000) depends on a character having left; the deck card is put into the sideline either way.
    activateMain({ once: true },
      chooseOwn("other", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上的其他 1 张角色退场（然后将卡组最上方的 1 张卡牌置于场外）" }),
      sideline(chosen("other")),
      run("将卡组最上方的 1 张卡牌置于场外", mill(1)),
      ifThen(sidelinedChosen("other"), [bp("self", 1000)]))
  ],

  // 鬼舞辻 无惨(拟态“少年”)：此卡牌也视为〈鬼舞辻 无惨〉。
  //   【启动主要】[转为休息状态][每回合1次]本回合中，此角色产生能量+●紫●。主要阶段结束时，将此角色退场。
  "UA05BT/KMY-1-037": [
    staticSelf({ flags: ["name:鬼舞辻 无惨"] }),
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 2)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 鬼舞辻 无惨(拟态“月彦”)：此卡牌也视为〈鬼舞辻 无惨〉。
  //   此角色处于活跃状态的场合，此角色产生能量+●紫●。
  "UA05BT/KMY-1-038": [
    staticSelf({ flags: ["name:鬼舞辻 无惨"] }),
    staticSelf({ energy: 1 }, selfActive)
  ],

  // 响凯：对方场上存在黄色或红色卡牌的场合，手牌中的此卡牌所需能量减少●キ紫×1●。
  "UA05BT/KMY-1-039": [costChange({ energy: 1 }, opponentHasColor("yellow", "red"))],

  // 朱纱丸：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）
  //   (keyword line only: already automatic; no entry)

  // 手鬼：【退场时】从以下选择1项。·选择我方场上的最多1张角色，移动至其他线中。·选择我方前线中的角色和能量线中的角色各1张，可以交换他们的位置。
  "UA05BT/KMY-1-041": [onSidelined(...moveOrSwap)],

  // 鸣女：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，此角色放回手牌。
  "UA05BT/KMY-1-042": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // 矢琶羽：【启动主要】[转为休息状态]#将1张手牌置于场外#从以下选择1项。
  //   ·选择我方场上的最多1张角色，移动至其他线中。·选择我方前线中的角色和能量线中的角色各1张，可以交换他们的位置。
  //   (the "#…#" around the discard are printed where a second cost bracket belongs: read as the cost [将1张手牌置于场外])
  "UA05BT/KMY-1-043": [activateMain({ costs: [restSelf, discardCost(1)] }, ...moveOrSwap)],

  // 魇梦：【登场时】本回合中有角色退场过的场合，抽取1张卡牌。
  "UA05BT/KMY-1-044": [withCondition(onPlay(draw(1)), characterSidelinedThisTurnByAnyone)],

  // 魇梦：【突进】〈魇梦〉转为活跃状态，并可以移动至前线。
  //   我放场外的卡牌张数为15张或更多的场合，此角色BP+500。
  //   【登场时】抽取2张卡牌，将我方的1张手牌置于场外。
  "UA05BT/KMY-1-045": [
    staticSelf({ bp: 500 }, sidelineAtLeast(15)),
    onPlay(draw(2), discard(1))
  ],

  // 下弦之叁：【退场时】抽取1张卡牌。
  "UA05BT/KMY-1-046": [onSidelined(draw(1))],

  // 下弦之肆：【退场时】抽取1张卡牌。
  "UA05BT/KMY-1-047": [onSidelined(draw(1))],

  // 下弦之贰：【退场时】我方的回合中的场合，选择对方前线中的最多1张角色，本回合中，BP-2000。
  "UA05BT/KMY-1-048": [withCondition(onSidelined(
    chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-2000）" }), bp(chosen("target"), -2000)), duringYourTurn)],

  // 下弦之陆：【退场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UA05BT/KMY-1-049": [onSidelined(draw(1), discard(1))],

  // 累：【登场时】本回合中有角色退场果的场合，选择对方前线中的1最多1张角色，本回合中，BP-1500。（"退场果" / "1最多1张" read as 退场过 / 最多1张）
  "UA05BT/KMY-1-050": [withCondition(onPlay(
    chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-1500）" }), bp(chosen("target"), -1500)), characterSidelinedThisTurnByAnyone)],

  // 猗窝座：【冲击①】（当在进行攻击的战斗中胜利时，给与对方玩家1点伤害）。
  //   (keyword line only, but the line ends in "。" so it is not recognised as one: the entry makes the card count as automated)
  "UA05BT/KMY-1-051": [],

  // 猗窝座：此角色以活跃状态登场。
  //   【登场时】可以将我方的2张手牌置于场外。那样做的场合，此角色在本回合中获得【瞄准攻击】和【冲击①】。
  "UA05BT/KMY-1-052": [onPlay(
    activate("self"),
    ifThen((env) => env.owner.hand.length >= 2, [may("将 2 张手牌置于场外，使此角色本回合获得【瞄准攻击】和【冲击①】？", discard(2), grant("self", "瞄准攻击"), grant("self", "冲击1"))]))],

  // 妓夫太郎：【启动主要】[支付1AP][每回合1次]抽取1张卡牌。
  "UA05BT/KMY-1-053": [activateMain({ costs: [apCost(1)], once: true }, draw(1))],

  // 妓夫太郎：【登场时】我方场上存在〈堕姬〉的场合，抽取1张卡牌，将我方的1张手牌置于场外。
  "UA05BT/KMY-1-054": [withCondition(onPlay(draw(1), discard(1)), youHaveNamedAlso(DAKI))],

  // 妓夫太郎：【突进】〈妓夫太郎〉转为活跃状态，并可以移动至前线。
  //   [每回合1次]当此角色在进行攻击的战斗中胜利时，将此角色转为活跃状态。
  //   【攻击时】我方场上存在〈堕姬〉的场合，抽取1张卡牌。
  //   ■■■■■（trailing marks, not ability text）
  "UA05BT/KMY-1-055": [
    oncePerTurn(when(["onWinBattle"], activate("self"))),
    withCondition(onAttack(draw(1)), youHaveNamedAlso(DAKI))
  ],

  // 妓夫太郎：【登场时】[前线中存在的场合]选择对方前线中的最多1张BP不高与3000的角色退场。（"不高与" read as 不高于）
  //   【退场时】确认我方卡组最上方的3张卡牌。公开其中最多1张〈堕姬〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UA05BT/KMY-1-056": [
    withCondition(onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3000), prompt: "选择对方前线中最多 1 张 BP 不高于 3000 的角色退场" }), sideline(chosen("target"))), selfOnFront),
    onSidelined(...lookForNamed(3, DAKI))
  ],

  // 堕姬：【退场时】确认我方卡组最上方的6张卡牌。公开其中最多1张〈妓夫太郎〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UA05BT/KMY-1-057": [onSidelined(...lookForNamed(6, GIYUTARO))],

  // 堕姬：【登场时】【退场时】从我方场外将最多1张所需能量不高于3且消费AP为1的〈妓夫太郎〉在我方前线中以活跃状态登场。
  "UA05BT/KMY-1-058": [when(["onPlay", "onSidelined"],
    chooseFromSideline("card", { max: 1, filter: and(namedAlso(GIYUTARO), printedCostAtMost(3), apCostIs(1)), prompt: "从场外选择最多 1 张所需能量不高于 3、消费 AP 为 1 的〈妓夫太郎〉，在前线以活跃状态登场" }),
    ifThen(chosenCount("card"), [put("card", "front", false)]))],

  // 堕姬：【突进】〈堕姬〉转为活跃状态，并可以移动至前线。
  //   【我方的回合中】我方场上存在〈妓夫太郎〉的场合，此角色BP+500。
  //   【退场时】我方场上存在〈妓夫太郎〉的场合，可以将我方的1张手牌置于场外。那样做的场合，此角色在我方前线中以休息状态登场。
  "UA05BT/KMY-1-059": [
    staticSelf({ bp: 500 }, all(duringYourTurn, youHaveNamedAlso(GIYUTARO))),
    withCondition(onSidelined(ifThen((env) => env.owner.hand.length > 0, [
      // "此角色": the copy of this card most recently put into the sideline (found before the discarded card joins it).
      run("找到场外的此角色", (env) => {
        const index = env.owner.sideline.lastIndexOf(env.selfCardId);
        env.vars.me = index >= 0 ? [`s:${index}`] : [];
      }),
      may("将 1 张手牌置于场外，使「堕姬」在前线以休息状态登场？", discard(1), ifThen(chosenCount("me"), [put("me", "front", true)]))
    ])), youHaveNamedAlso(GIYUTARO))
  ],

  // 蕨姬：此卡牌也视为〈堕姬〉。
  "UA05BT/KMY-1-060": [staticSelf({ flags: ["name:堕姬"] })],

  // 京极屋（场地）：【启动主要】[转为休息状态][将此卡牌退场]从我方场外将最多1张〈妓夫太郎〉或〈堕姬〉加入手牌。
  "UA05BT/KMY-1-061": [activateMain({ costs: [restSelf, sidelineSelf] },
    chooseFromSideline("card", { max: 1, filter: either(namedAlso(GIYUTARO), namedAlso(DAKI)), prompt: "从场外选择最多 1 张〈妓夫太郎〉或〈堕姬〉加入手牌" }), moveChosen("card", "hand"))],

  // 鬼之力（事件）：选择我方场上的1张角色，本回合中，[BP+1000]。本回合中每有1张角色退场过，追加[BP+1000]。选择的角色BP为5000或更高的场合，给予【冲击+1】（冲击给予的伤害+1，没有冲击的场合，获得冲击①）。
  //   (the BP condition is judged after the boosts have been applied)
  "UA05BT/KMY-1-062": [onUse(
    chooseOwn("target", { min: 1, max: 1, prompt: "选择我方场上 1 张角色（本回合 BP+1000，本回合每有 1 张角色退场过再追加 BP+1000）" }),
    bp(chosen("target"), (env) => 1000 + 1000 * charactersSidelinedThisTurn(env)),
    ifThen((env) => chosenCards(env, "target").some((card) => bpOf(env.ctx, card) >= 5000), [grant(chosen("target"), "冲击+1")]))],

  // 全部低下头 跪下行礼（事件）：将我方场上的1张角色退场。那样做的场合，选择对方前线中的1张角色退场。抽取1张卡牌。
  "UA05BT/KMY-1-063": [onUse(
    chooseOwn("mine", { min: 1, max: 1, prompt: "选择我方场上 1 张角色退场" }), sideline(chosen("mine")),
    ifThen(sidelinedChosen("mine"), [
      chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色退场" }), sideline(chosen("target"))
    ]),
    draw(1))],

  // 肃清（事件）：将我方场上的1张角色退场。那样做的场合，选择我方的1张AP卡牌转为活跃状态。抽取2张卡牌。
  "UA05BT/KMY-1-064": [onUse(
    chooseOwn("mine", { min: 1, max: 1, prompt: "选择我方场上 1 张角色退场" }), sideline(chosen("mine")),
    ifThen(sidelinedChosen("mine"), [chooseOneAp("ap"), activateAp("ap")]),
    draw(2))],

  // 永远在一起 绝不分离（事件）：确认我方卡组最上方的7张卡牌。公开其中〈妓夫太郎〉和〈堕姬〉最多各1张加入手牌。剩余的卡牌自选顺序置于卡组最下方。
  "UA05BT/KMY-1-065": [onUse(look(7),
    chooseLooked("giyutaro", { max: 1, filter: namedAlso(GIYUTARO), prompt: "公开最多 1 张〈妓夫太郎〉并加入手牌" }),
    chooseLooked("daki", { max: 1, filter: namedAlso(DAKI), exclude: "giyutaro", prompt: "公开最多 1 张〈堕姬〉并加入手牌" }),
    moveChosen(["giyutaro", "daki"], "hand"), lookedToBottom())]
};
