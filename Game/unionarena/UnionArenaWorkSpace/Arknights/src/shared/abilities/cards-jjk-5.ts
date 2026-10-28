/**
 * Abilities of the Jujutsu Kaisen cards EX04BT/JJK-3-036 ... 066 (batch jjk-5; 040, 045, 047, 060 are not in the batch). See cards.ts for the
 * conventions; each entry follows the card's printed text, shown above it.
 *
 * Not in the table: EX04BT/JJK-3-039 (夏油 杰) gives the card the 【启动主要】 abilities of other cards: the engine only reads granted *triggered*
 * abilities, and granted activations would need the activate action, the AI's legal moves and the client to learn about them; it stays manual.
 * 041 and 054 print only keyword lines (撤步 / 冲击无效), which count as automatic by themselves.
 * Reading choices: see the notes above 056 (伏黑 惠) and 061 (胀相).
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, energyOf, flagsOf, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step, Target } from "./types.ts";
import {
  activate, activateMain, all, and, bp, bpAtMost, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn, chosen, chosenCount,
  discard, discardCost, draw, duringOpponentTurn, duringYourTurn, either, energyThisTurn, flag, givenOnly, grant, grantAbility, ifThen, look, lookedToBottom, may,
  moveChosen, named, notNamed, notSelf, onAttack, onPlay, onSidelined, onUse, put, remove, restSelf, run, selfActive, selfOnFront, sideline, staticSelf, when,
  withAffinity, withCondition
} from "./dsl.ts";

// ---- Helpers for these cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const MECHAMARU = ["究极 机械丸", "究极 机械丸 绝对形态"];
const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const nameOfCard = (env: AbilityEnv, card: UnionArenaFieldCard): string => env.ctx.card(card.cardId)?.name ?? "";
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;

const deckAtLeast = (count: number): Condition => (env) => env.owner.library.length >= count;
const handAtLeast = (count: number): Condition => (env) => env.owner.hand.length >= count;
/** 将我方卡组最上方的N张卡牌置于场外 */
const mill = (count: number) => (env: AbilityEnv): void => { env.owner.sideline.push(...env.owner.library.splice(0, count)); };

/** The number of characters on the opposing front line with BP N or more. */
const opponentFrontBpCount = (env: AbilityEnv, limit: number): number => env.opponent.front.filter((card) => isCharacter(env, card) && bpOf(env.ctx, card) >= limit).length;
/** 对方的前线中存在2张或更多BP4000或更高的角色 */
const twoBigOpponents: Condition = (env) => opponentFrontBpCount(env, 4000) >= 2;

/** 我方的产生能量为N或更高 (all colours together). */
const COLORS = ["red", "green", "blue", "yellow", "purple"];
const energyGeneration = (env: AbilityEnv): number => COLORS.reduce((sum, color) => sum + energyOf(env.ctx, env.owner, color), 0);
const fiveEnergy: Condition = (env) => energyGeneration(env) >= 5;

/** 我方的场上存在〈究极 机械丸〉或〈究极 机械丸 绝对形态〉 (a card that also counts as one of them, with a "name:" mark, does too). */
const youHaveMechamaru: Condition = (env) => fieldOf(env.owner).some((card) =>
  MECHAMARU.includes(nameOfCard(env, card)) || flagsOf(card).some((mark) => mark.startsWith("name:") && MECHAMARU.includes(mark.slice(5))));

/** 同线中存在〈a〉和〈b〉: other cards of those names on the same line as this card. */
const sameLineHasAll = (names: string[]): Condition => (env) => {
  const self = env.self;
  if (!self) return false;
  const line = env.owner.front.includes(self) ? env.owner.front : env.owner.energy;
  return names.every((name) => line.some((card) => card.uid !== self.uid && nameOfCard(env, card) === name));
};

/** An ability of this card (by index) has not been used this turn (for 「每回合1次」 on a triggered ability that may not resolve at every event). */
const notUsedThisTurn = (index: number): Condition => (env) => !!env.self && !(env.self.used ?? []).includes(index);
const markUsedThisTurn = (index: number): Step => run("本回合已发动", (env) => { if (env.self) env.self.used = [...(env.self.used ?? []), index]; });

/** 公开其中最多N张…并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。 */
const searchThenDiscard = (count: number, max: number, filter: CardFilter, what: string): Step[] => [
  look(count),
  chooseLooked("pick", { max, filter, prompt: `公开最多 ${max} 张${what}并加入手牌` }),
  moveChosen("pick", "hand"),
  lookedToBottom(),
  ifThen(chosenCount("pick"), [discard(1)])
];

/** 剩余的卡牌自选顺序置于我方卡组的最上方 (the first card picked ends up on top). */
const lookedToTopInOrder: Step[] = [
  { do: "choose", as: "top", from: "looked", side: "you", all: true, min: 0, max: 99, prompt: "依次点选剩余的卡，按点选顺序放回卡组最上方（先点的在最上面）", good: true },
  run("剩余的卡牌按所选顺序置于卡组最上方", (env) => {
    const looking = env.game.looking;
    if (!looking) return;
    const keys = env.vars.top ?? [];
    const cards = keys.map((key) => looking.cards[Number(key.slice(2))]).filter((cardId): cardId is string => !!cardId);
    looking.cards = looking.cards.filter((_, index) => !keys.includes(`l:${index}`));
    env.owner.library.unshift(...cards);
  })
];

/** 我方场上所有的〈坏相〉和〈血涂〉 */
const ownHuaiOrXuetu: Target = (env) => fieldOf(env.owner).filter((card) => isCharacter(env, card) && ["坏相", "血涂"].includes(nameOfCard(env, card)));

/** 花御 (066): the mark for "此角色在下一个对方的回合中，BP+1000" (kept until our next turn begins, but only counts in the opponent's turn). */
const OPPONENT_TURN_BP = "oppTurnBp+1000";

/** 钉崎 野蔷薇 (049): the character put into the sideline by 登场时 (its card number is kept under this name). */
const discardedCard = (env: AbilityEnv): string | undefined => env.vars.dcard?.[0];
const discardedIsSorcerer: Condition = (env) => (env.ctx.card(discardedCard(env) ?? "")?.affinities ?? []).includes("咒术师");
/** 所需能量或原本的BP与该卡牌相同 */
const sameCostOrBpAsDiscarded: CardFilter = (env, cardId) => {
  const wanted = env.ctx.card(discardedCard(env) ?? "");
  const stats = env.ctx.card(cardId);
  return !!wanted && !!stats && (stats.energyCost === wanted.energyCost || (stats.bp !== null && wanted.bp !== null && stats.bp === wanted.bp));
};

/** 漏瑚 (064): the attack-time ability it gets for the turn is its list index 1. */
const KURUMA_GIVEN = 1;

export const JJK_5_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 大祓炮（事件）：选择对方前线中的1张『BP不高于3000』的角色退场。我方的场上存在〈究极 机械丸〉或〈究极 机械丸 绝对形态〉的场合，改为选择『BP不高于5000』。
  "EX04BT/JJK-3-036": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (youHaveMechamaru(env) ? 5000 : 3000)), prompt: "选择对方前线中 1 张 BP 不高于 3000（我方场上有〈究极 机械丸〉时为 5000）的角色退场" }),
    sideline(chosen("target")))],

  // 夏油 杰：【登场时】确认我方卡组最上方的2张卡牌。将其中任意张数的“特征：咒灵”或“特征：咒胎九相图”置于场外。剩余的卡牌自选顺序置于我方卡组的最上方。
  "EX04BT/JJK-3-037": [onPlay(
    look(2),
    chooseLooked("out", { max: 2, filter: either(withAffinity("咒灵"), withAffinity("咒胎九相图")), prompt: "选择任意张数的“咒灵”或“咒胎九相图”置于场外" }),
    moveChosen("out", "sideline"),
    ...lookedToTopInOrder)],

  // 夏油 杰：【登场时】确认我方卡组最上方的3张卡牌。公开其中最多1张“特征：咒灵”或“特征：咒胎九相图”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "EX04BT/JJK-3-038": [onPlay(...searchThenDiscard(3, 1, either(withAffinity("咒灵"), withAffinity("咒胎九相图")), "“咒灵”或“咒胎九相图”"))],

  // 虎杖 悠仁：【撤步】【冲击无效】（keyword lines only; the keywords are in the card data）
  //   EX04BT/JJK-3-041 is not in the table.

  // 虎杖 悠仁：【启动主要】[前线中存在的场合][每回合1次]根据对方的前线中存在的BP4000或更高的角色的张数，此角色在本回合中，获得下列所有效果。
  //          ·2张或更多：此角色的BP+1000。 ·4张或更多：【冲击①】
  "EX04BT/JJK-3-042": [activateMain({ condition: selfOnFront, once: true },
    ifThen((env) => opponentFrontBpCount(env, 4000) >= 2, [bp("self", 1000)]),
    ifThen((env) => opponentFrontBpCount(env, 4000) >= 4, [grant("self", "冲击1")]))],

  // 虎杖 悠仁：【突进】〈虎杖 悠仁〉转为活跃状态，并可以移动至前线（in the card data）
  //          【攻击时】[每回合1次]我方的场上存在3张或更多其他的“特征：咒术师”的场合，从下列选择1项。
  //          ·此角色在本回合中，获得【冲击①】。 ·此角色在本回合中，可以BP-2000。这样做的场合，此角色转为活跃状态。
  //   「每回合1次」 is used up when the ability resolves with its condition met (not when the condition failed).
  "EX04BT/JJK-3-043": [withCondition(
    onAttack(
      markUsedThisTurn(0),
      chooseMode("mode", ["此角色在本回合中，获得【冲击①】", "此角色在本回合中，可以BP-2000。这样做的场合，此角色转为活跃状态"]),
      ifThen(modeIs("mode", 0), [grant("self", "冲击1")]),
      ifThen(modeIs("mode", 1), [may("此角色本回合 BP-2000，并转为活跃状态？", bp("self", -2000), activate("self"))])),
    (env) => notUsedThisTurn(0)(env) && fieldOf(env.owner).filter((card) => card.uid !== env.self?.uid && isCharacter(env, card) && (env.ctx.card(card.cardId)?.affinities ?? []).includes("咒术师")).length >= 3)],

  // 狗巻 棘：此角色处于活跃状态的场合，此角色产生能量+[红]。
  "EX04BT/JJK-3-044": [staticSelf({ energy: 1 }, selfActive)],

  // 忧忧：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，此角色放回手牌。
  "EX04BT/JJK-3-046": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= 1), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    { do: "toHand", target: chosen("target") }, ifThen((env) => (env.vars.target ?? []).length === 0, [{ do: "toHand", target: "self" }]))],

  // 钉崎 野蔷薇：【登场时】选择我方场上的最多1张其他的“特征：咒术师”，本回合中，『BP+500』。对方的前线中存在2张或更多BP4000或更高的角色的场合，改为『BP+1500』。
  "EX04BT/JJK-3-048": [onPlay(
    chooseOwn("target", { max: 1, filter: and(notSelf, withAffinity("咒术师")), prompt: "选择我方场上最多 1 张其他的“咒术师”（本回合 BP+500，对方前线有 2 张 BP4000 以上时 BP+1500）" }),
    bp(chosen("target"), (env) => (twoBigOpponents(env) ? 1500 : 500)))],

  // 钉崎 野蔷薇：【突进】〈钉崎 野蔷薇〉转为活跃状态，并可以移动至前线（in the card data）
  //            【登场时】抽取1张卡牌，将我方的1张手牌置于场外。通过此效果将“特征：咒术师”置于场外的场合，选择对方前线中的最多1张所需能量或原本的BP与该卡牌相同的角色，本回合中，BP-3000。
  //            【启动主要】[将1张手牌置于场外][每回合1次]选择我方场上的1张“特征：咒术师”，本回合中，BP+500。
  "EX04BT/JJK-3-049": [
    onPlay(
      draw(1),
      chooseFromHand("d", { min: 1, max: 1, prompt: "选择我方 1 张手牌置于场外" }),
      run("记住置于场外的卡牌", (env) => {
        const key = env.vars.d?.[0];
        const cardId = key ? env.owner.hand[Number(key.slice(2))] : undefined;
        env.vars.dcard = cardId ? [cardId] : [];
      }),
      moveChosen("d", "sideline"),
      ifThen(discardedIsSorcerer, [
        chooseOpponent("target", { line: "front", max: 1, filter: sameCostOrBpAsDiscarded, prompt: "选择对方前线中最多 1 张所需能量或原本的 BP 与置于场外的卡牌相同的角色（本回合 BP-3000）" }),
        bp(chosen("target"), -3000)])),
    activateMain({ costs: [discardCost(1)], once: true },
      chooseOwn("target", { min: 1, max: 1, filter: withAffinity("咒术师"), prompt: "选择我方场上 1 张“咒术师”（本回合 BP+500）" }), bp(chosen("target"), 500))
  ],

  // 日下部 笃也：此角色不会被BP4000或更高的对方角色的效果选择。
  "EX04BT/JJK-3-050": [staticSelf({ flags: ["untargetableByCharBpAtLeast:4000"] })],

  // 五条 悟：此角色以活跃状态登场。
  //        【伤害②】（当通过此角色的攻击给予对方直接伤害时，改为给予2点伤害）（in the card data）
  //        当对方的攻击阶段结束时，此角色置于移除区。
  "EX04BT/JJK-3-051": [
    onPlay(activate("self")),
    withCondition(when(["onEveryAttackPhaseEnd"], remove("self")), duringOpponentTurn)
  ],

  // 五条 悟：【冲击①】（in the card data）
  //        当对方的攻击阶段结束时，对方的前线中〔存在2张或更多BP4000或更高的角色或存在〈夏油 杰〉〕的场合，将此角色置于移除区，确认我方卡组最上方的4张卡牌。公开其中最多2张〈五条 悟〉以外的“特征：咒术师”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  "EX04BT/JJK-3-052": [withCondition(
    when(["onEveryAttackPhaseEnd"],
      remove("self"),
      look(4),
      chooseLooked("pick", { max: 2, filter: and(withAffinity("咒术师"), notNamed("五条 悟")), prompt: "公开最多 2 张〈五条 悟〉以外的“咒术师”并加入手牌" }),
      moveChosen("pick", "hand"),
      lookedToBottom()),
    all(duringOpponentTurn, (env) => !!env.self, (env) => twoBigOpponents(env) || env.opponent.front.some((card) => nameOfCard(env, card) === "夏油 杰")))],

  // 七海 建人：【退场时】确认我方卡组最上方的4张卡牌。公开其中最多1张〈虎杖 悠仁〉并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "EX04BT/JJK-3-053": [onSidelined(...searchThenDiscard(4, 1, named("虎杖 悠仁"), "〈虎杖 悠仁〉"))],

  // 熊猫：【冲击无效】（keyword line only; EX04BT/JJK-3-054 is not in the table）

  // 伏黑 惠：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "EX04BT/JJK-3-055": [onPlay(draw(1), discard(1))],

  // 伏黑 惠：【启动主要】[前线中存在的场合][每回合1次]选择我方场上的1张“特征：咒术师”，此角色在本回合中，『BP+500』。对方对方的前线中存在2张或更多BP4000或更高的角色的场合，改为『BP+1500』。
  //   Read as: the chosen 咒术师 gets the BP (a choice that gave the BP to this card itself would be pointless; the card itself is one of the options, so
  //   choosing it gives the literal "此角色" reading). "对方对方" is a typo for 对方.
  "EX04BT/JJK-3-056": [activateMain({ condition: selfOnFront, once: true },
    chooseOwn("target", { min: 1, max: 1, filter: withAffinity("咒术师"), prompt: "选择我方场上 1 张“咒术师”（本回合 BP+500，对方前线有 2 张 BP4000 以上时 BP+1500）" }),
    bp(chosen("target"), (env) => (twoBigOpponents(env) ? 1500 : 500)))],

  // 冥冥：【伤害②】（in the card data）
  //     【我方的回合中】此角色的BP+1000。
  "EX04BT/JJK-3-057": [staticSelf({ bp: 1000 }, duringYourTurn)],

  // 坏相：【攻击时】同线中存在〈胀相〉和〈血涂〉的场合，抽取1张卡牌，将我方的1张手牌置于场外，此角色在本回合中，BP+1000。
  "EX04BT/JJK-3-058": [withCondition(onAttack(draw(1), discard(1), bp("self", 1000)), sameLineHasAll(["胀相", "血涂"]))],

  // 血涂：【攻击时】同线中存在〈胀相〉和〈坏相〉的场合，抽取1张卡牌，将我方的1张手牌置于场外，此角色在本回合中，BP+1000。
  "EX04BT/JJK-3-059": [withCondition(onAttack(draw(1), discard(1), bp("self", 1000)), sameLineHasAll(["胀相", "坏相"]))],

  // 胀相：【登场时】将我方卡组最上方的最多2张卡牌置于场外。可以从我方的场外将1张〈坏相〉或〈血涂〉加入手牌。这样做的场合，将我方的1张手牌置于场外。
  //   "最多2张": the player chooses how many (0, 1 or 2) are put into the sideline.
  "EX04BT/JJK-3-061": [onPlay(
    ifThen(deckAtLeast(1), [
      chooseMode("n", ["将卡组最上方的 2 张卡牌置于场外", "将卡组最上方的 1 张卡牌置于场外", "不将卡组最上方的卡牌置于场外"]),
      run("将卡组最上方的卡牌置于场外", (env) => mill([2, 1, 0][Number((env.vars.n?.[0] ?? "m:2").slice(2))] ?? 0)(env))]),
    chooseFromSideline("pick", { max: 1, filter: either(named("坏相"), named("血涂")), prompt: "从场外选择最多 1 张〈坏相〉或〈血涂〉加入手牌" }),
    moveChosen("pick", "hand"),
    ifThen(chosenCount("pick"), [discard(1)]))],

  // 胀相：【突进】〈胀相〉转为活跃状态，并可以移动至前线（in the card data）
  //     【登场时】抽取1张卡牌。从我方的手牌中将最多1张〈坏相〉或〈血涂〉在我方的场上以休息状态登场。
  //     【启动主要】[前线中存在的场合][每回合1次]同线中存在〈坏相〉和〈血涂〉的场合，我方场上所有的〈坏相〉和〈血涂〉在本回合中，BP+500。
  "EX04BT/JJK-3-062": [
    onPlay(
      draw(1),
      chooseFromHand("card", { max: 1, filter: either(named("坏相"), named("血涂")), prompt: "从手牌选择最多 1 张〈坏相〉或〈血涂〉，以休息状态登场" }),
      ifThen(chosenCount("card"), [put("card", "choose", true)])),
    activateMain({ condition: selfOnFront, once: true }, ifThen(sameLineHasAll(["坏相", "血涂"]), [bp(ownHuaiOrXuetu, 500)]))
  ],

  // 蝗GUY：【启动主要】[转为休息状态][每回合1次]本回合中，此角色的产生能量+[红]。主要阶段结束时，将此角色退场。
  "EX04BT/JJK-3-063": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 漏瑚：【启动主要】[前线中存在的场合][每回合1次]只有在我方的产生能量为5或更高的场合才能发动。从下列选择1项。
  //     ·此角色在本回合中，获得【伤害②】。
  //     ·此角色在本回合中，获得“【攻击时】可以将我方的2张手牌置于场外。这样做的场合，选择对方前线中的最多1张BP不高于2000的角色退场”。
  "EX04BT/JJK-3-064": [
    activateMain({ condition: all(selfOnFront, fiveEnergy), once: true },
      chooseMode("mode", ["此角色在本回合中，获得【伤害②】", "此角色在本回合中，获得“【攻击时】可以将我方的2张手牌置于场外。这样做的场合，选择对方前线中的最多1张BP不高于2000的角色退场”"]),
      ifThen(modeIs("mode", 0), [grant("self", "伤害2")]),
      ifThen(modeIs("mode", 1), [grantAbility("self", KURUMA_GIVEN)])),
    givenOnly(onAttack(ifThen(handAtLeast(2), [may("将 2 张手牌置于场外，选择对方前线中最多 1 张 BP 不高于 2000 的角色退场？",
      discard(2),
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(2000), prompt: "选择对方前线中最多 1 张 BP 不高于 2000 的角色退场" }),
      sideline(chosen("target")))])))
  ],

  // 陀艮：【启动主要】[前线中存在的场合][每回合1次]只有在我方的产生能量为5或更高的场合才能发动。可以将我方的1张手牌置于场外。这样做的场合，此角色转为活跃状态。
  "EX04BT/JJK-3-065": [activateMain({ condition: all(selfOnFront, fiveEnergy), once: true },
    ifThen(handAtLeast(1), [may("将 1 张手牌置于场外，此角色转为活跃状态？", discard(1), activate("self"))]))],

  // 花御：【启动主要】[前线中存在的场合][每回合1次]只有在我方的产生能量为5或更高的场合才能发动。从下列选择1项。
  //     ·此角色在本回合中，BP+1000。 ·此角色在下一个对方的回合中，BP+1000。
  "EX04BT/JJK-3-066": [
    activateMain({ condition: all(selfOnFront, fiveEnergy), once: true },
      chooseMode("mode", ["此角色在本回合中，BP+1000", "此角色在下一个对方的回合中，BP+1000"]),
      ifThen(modeIs("mode", 0), [bp("self", 1000)]),
      ifThen(modeIs("mode", 1), [flag("self", OPPONENT_TURN_BP, "untilYourNextTurn")])),
    staticSelf({ bp: 1000 }, (env) => duringOpponentTurn(env) && !!env.self && flagsOf(env.self).includes(OPPONENT_TURN_BP))
  ]
};
