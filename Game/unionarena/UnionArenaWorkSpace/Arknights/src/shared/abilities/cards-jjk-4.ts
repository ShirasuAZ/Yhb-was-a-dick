/**
 * Abilities of the Jujutsu Kaisen cards EX04BT/JJK-3-004 ... 035 (batch jjk-4). See cards.ts for the conventions; each entry follows the
 * card's printed text, shown above it.
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { abilitiesOf, bpOf, characterSidelinedByBpOrEffectThisTurn, costOf, handDeckSidelinedThisTurn, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step, Target } from "./types.ts";
import {
  activate, activateMain, and, apCostIs, bp, bpAtMost, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn, chosen, chosenCount,
  costChange, discard, draw, duringOpponentTurn, duringYourTurn, either, energyCostAtMost, flag, grant, ifThen, isCharacterCard, look, lookedToBottom, may,
  mayPayApEffect, moveChosen, moveLine, named, noneChosen, notSelf, ofColor, onAttack, onPlay, onSidelined, onUse, oncePerTurn, put, restSelf, run, selfOnFront,
  sideline, sidelineSelf, staticSelf, toHand, when, withAffinity, withCondition, youHaveNamed, all
} from "./dsl.ts";

// ---- Helpers for these cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const RIKO = "天内 理子";
const GETO = "夏油 杰";
const GOJO = "五条 悟";
const SUKUNA = "宿傩";
const FINGER = "宿傩的手指";
const NANAMI = "七海 建人";
const MECHAMARU = "究极 机械丸";
const MIWA = "三轮 霞";
const MAHITO = "真人";
const FUSHIGURO = "伏黑 惠";
const DOMAIN = "嵌合暗翳庭";

const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const nameOfCard = (env: AbilityEnv, card: UnionArenaFieldCard): string => env.ctx.card(card.cardId)?.name ?? "";
const findField = (env: AbilityEnv, uid: string): UnionArenaFieldCard | null => env.players.flatMap(fieldOf).find((card) => card.uid === uid) ?? null;
/** The chosen field cards still on the field. */
const chosenCards = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => (env.vars[name] ?? []).flatMap((uid) => findField(env, uid) ?? []);

/** Required energy of a hand card now (with its own cost changes). */
const handCost = (env: AbilityEnv, cardId: string): number => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy;

// Deck and sideline
const deckAtMost = (count: number): Condition => (env) => env.owner.library.length <= count;
const deckAtLeast = (count: number): Condition => (env) => env.owner.library.length >= count;
/** 将我方卡组最上方的N张卡牌置于场外 */
const mill = (count: number) => (env: AbilityEnv): void => { env.owner.sideline.push(...env.owner.library.splice(0, count)); };
const sidelineHas = (name: string): Condition => (env) => env.owner.sideline.some((cardId) => env.ctx.card(cardId)?.name === name);
const handNotEmpty: Condition = (env) => env.owner.hand.length > 0;
const fingerCount = (env: AbilityEnv): number => env.owner.sideline.filter((cardId) => env.ctx.card(cardId)?.name === FINGER).length;
const fingersAtLeast = (count: number): Condition => (env) => fingerCount(env) >= count;

/** 同线中存在〈name〉: another card of that name on the same line as this card (the cards that use it must be on the front line). */
const sameLineHas = (name: string): Condition => (env) => !!env.self && env.owner.front.includes(env.self) && env.owner.front.some((card) => card.uid !== env.self!.uid && nameOfCard(env, card) === name);
/** 【我方的回合中】[前线中存在的场合]同线中存在〈partner〉，或我方的场外存在〈天内 理子〉的场合 */
const withPartnerOrRiko = (partner: string): Condition => all(duringYourTurn, selfOnFront, (env) => sameLineHas(partner)(env) || sidelineHas(RIKO)(env));

/** 公开其中最多N张…并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。 */
const searchThenDiscard = (count: number, max: number, filter: CardFilter, what: string): Step[] => [
  look(count),
  chooseLooked("pick", { max, filter, prompt: `公开最多 ${max} 张${what}并加入手牌` }),
  moveChosen("pick", "hand"),
  lookedToBottom(),
  ifThen(chosenCount("pick"), [discard(1)])
];

/** 对方前线中的所有BP N 或更高的角色 */
const opponentFrontBpAtLeast = (limit: number): Target => (env) => env.opponent.front.filter((card) => isCharacter(env, card) && bpOf(env.ctx, card) >= limit);
/** 我方场上的所有〈伏黑 惠〉 */
const ownFushiguro: Target = (env) => fieldOf(env.owner).filter((card) => isCharacter(env, card) && nameOfCard(env, card) === FUSHIGURO);

/** 选择对方场上最多1张场地 */
const chooseOpponentSite = (as: string, prompt: string): Step => ({
  do: "choose", as, from: "field", side: "opponent", characters: false, filter: (env, cardId) => env.ctx.card(cardId)?.type === "site", min: 0, max: 1, prompt, good: false
});

/** 我方场上存在N张或更多其他的“特征：京都校”或〈三轮 霞〉 */
const kyotoAtLeast = (count: number): Condition => (env) =>
  fieldOf(env.owner).filter((card) => card.uid !== env.self?.uid && ((env.ctx.card(card.cardId)?.affinities ?? []).includes("京都校") || nameOfCard(env, card) === MIWA)).length >= count;
/** 此卡牌也视为〈究极 机械丸〉 (a Raid card of 〈究极 机械丸〉 can Raid it: the engine reads "name:" marks when matching Raid targets). */
const ALSO_MECHAMARU = staticSelf({ flags: [`name:${MECHAMARU}`] });

const printedBpAtLeast = (limit: number): CardFilter => (env, cardId) => (env.ctx.card(cardId)?.bp ?? 0) >= limit;
const isEventCard: CardFilter = (env, cardId) => env.ctx.card(cardId)?.type === "event";
/** 没有【特殊触发】和【最终触发】 */
const noSpecialOrFinalTrigger: CardFilter = (env, cardId) => !["特殊", "最终"].includes(env.ctx.card(cardId)?.trigger?.label ?? "");
/** 产生能量不高于N: the card's energy generation now. */
const energyGenAtMost = (limit: number): CardFilter => (env, cardId, card) => {
  const stats = env.ctx.card(cardId);
  return (stats?.energyGen ?? 0) + (card?.energyMod ?? 0) + (card?.staticEnergy ?? 0) + (card?.energyTurn ?? 0) <= limit;
};

/** 1回合只能使用1张〈name〉 / 1回合只能……1次 (per player). */
const turnMarkKey = (env: AbilityEnv, text: string): string => `${env.game.turn}:${env.owner.accountId}:${text}`;
const notMarkedThisTurn = (text: string): Condition => (env) => !(env.game.turnMarks ?? []).includes(turnMarkKey(env, text));
const markThisTurn = (text: string): Step => run("本回合已使用", (env) => { env.game.turnMarks = [...(env.game.turnMarks ?? []), turnMarkKey(env, text)]; });
/** 宿傩 (015): the modes picked (execution is in printed order). */
const SUKUNA_MODES = [
  "抽取1张卡牌，将我方的1张手牌置于场外",
  "对方前线中的所有BP2500或更高的角色，本回合中，BP-2000",
  "选择对方前线中的最多1张BP不高于3500的角色，退场"
];
const modePicked = (index: number): Condition => (env) => (env.vars.modes ?? []).includes(`m:${index}`);

/** 将所选的确认的卡牌按点选顺序置于卡组最上方 (the first card picked ends up on top). */
const pickedLookedOnTop = (name: string): Step => run("所选的卡牌按顺序置于卡组最上方", (env) => {
  const looking = env.game.looking;
  if (!looking) return;
  const keys = env.vars[name] ?? [];
  const cards = keys.map((key) => looking.cards[Number(key.slice(2))]).filter((cardId): cardId is string => !!cardId);
  looking.cards = looking.cards.filter((_, index) => !keys.includes(`l:${index}`));
  env.owner.library.unshift(...cards);
});

/** 真人 (035): our non-〈真人〉 characters. */
const mahitoCandidates = (env: AbilityEnv): UnionArenaFieldCard[] => fieldOf(env.owner).filter((card) => isCharacter(env, card) && nameOfCard(env, card) !== MAHITO);
const distinctNames = (env: AbilityEnv, cards: UnionArenaFieldCard[]): number => new Set(cards.map((card) => nameOfCard(env, card))).size;

export const JJK_4_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 黑井 美里：【登场时】确认我方卡组最上方的5张卡牌。公开其中最多1张〈天内 理子〉或〈冲绳旅行〉并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "EX04BT/JJK-3-004": [onPlay(...searchThenDiscard(5, 1, either(named(RIKO), named("冲绳旅行")), "〈天内 理子〉或〈冲绳旅行〉"))],

  // 夏油 杰：【我方的回合中】[前线中存在的场合]同线中存在〈五条 悟〉，或我方的场外存在〈天内 理子〉的场合，此角色的BP+1000。
  //        【登场时】可以支付1AP。这样做的场合，从我方的场外将1张所需能量不高于3且消费AP1的拥有特征“咒灵”的黄色角色卡牌在我方的场上以休息状态登场。
  "EX04BT/JJK-3-005": [
    staticSelf({ bp: 1000 }, withPartnerOrRiko(GOJO)),
    onPlay(mayPayApEffect("支付 1 AP，从场外将 1 张咒灵黄色角色以休息状态登场？", 1,
      chooseFromSideline("card", { min: 1, max: 1, filter: and(isCharacterCard, withAffinity("咒灵"), ofColor("yellow"), apCostIs(1), energyCostAtMost(3)), prompt: "从场外选择 1 张所需能量不高于 3、消费 AP 为 1 的“咒灵”黄色角色（以休息状态登场）" }),
      ifThen(chosenCount("card"), [put("card", "choose", true)])))
  ],

  // 五条 悟：【我方的回合中】[前线中存在的场合]同线中存在〈夏油 杰〉，或我方的场外存在〈天内 理子〉的场合，此角色获得BP+1000和【冲击①】。
  //        【登场时】确认我方卡组最上方的3张卡牌。公开其中最多1张〈术式顺转「苍」〉或〈术式反转「赫」〉或〈虚式「茈」〉并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "EX04BT/JJK-3-006": [
    staticSelf({ bp: 1000, keywords: ["冲击1"] }, withPartnerOrRiko(GETO)),
    onPlay(...searchThenDiscard(3, 1, either(named("术式顺转「苍」"), named("术式反转「赫」"), named("虚式「茈」")), "〈术式顺转「苍」〉〈术式反转「赫」〉或〈虚式「茈」〉"))
  ],

  // 伏黑 惠：[每回合1次]当我方场上的〈嵌合暗翳庭〉的【启动主要】效果发动时，我方场上的所有〈伏黑 惠〉在本回合中，BP+1000。
  //        【登场时】选择对方前线中的最多1张BP不高于我方场上的“特征：式神”和〈嵌合暗翳庭〉的合计张数×1000的角色退场。
  "EX04BT/JJK-3-007": [
    // Only heard for the 〈嵌合暗翳庭〉's ability (so other activations do not queue it, and two 〈伏黑 惠〉 do not ask for an order each time).
    oncePerTurn({ ...when(["onOwnActivateMain"], bp(ownFushiguro, 1000)), heardIf: (ctx, cause) => ctx.card(cause?.sourceCardId ?? "")?.name === DOMAIN }),
    onPlay(
      chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张 BP 不高于（我方场上“式神”和〈嵌合暗翳庭〉的张数×1000）的角色退场",
        filter: bpAtMost((env) => 1000 * fieldOf(env.owner).filter((card) => (env.ctx.card(card.cardId)?.affinities ?? []).includes("式神") || nameOfCard(env, card) === DOMAIN).length) }),
      sideline(chosen("target")))
  ],

  // 脱兔：当此角色从我方的场上放回手牌时，选择我方场上的最多1张“特征：式神”，转为活跃状态。
  "EX04BT/JJK-3-008": [when(["onReturnToHand"], chooseOwn("target", { max: 1, filter: withAffinity("式神"), prompt: "选择我方场上最多 1 张“特征：式神”转为活跃状态" }), activate(chosen("target")))],

  // 满象：此角色在前线中存在的场合也会产生能量。
  //     【登场时】将我方场上的1张其他的“特征：式神”放回手牌。没有其他角色放回手牌的场合，此角色放回手牌。
  "EX04BT/JJK-3-009": [
    staticSelf({ flags: ["energyOnFront"] }),
    onPlay(
      chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, withAffinity("式神")), prompt: "选择我方场上 1 张其他的“特征：式神”放回手牌" }),
      toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))
  ],

  // 虹龙：【对方的回合中】我方的场上存在〈夏油 杰〉的场合，此角色的BP+1000。
  "EX04BT/JJK-3-010": [staticSelf({ bp: 1000 }, all(duringOpponentTurn, youHaveNamed(GETO)))],

  // 冲绳旅行（事件）：确认我方卡组最上方的5张卡牌。公开其中最多2张〈五条 悟〉或〈夏油 杰〉或〈天内 理子〉并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  "EX04BT/JJK-3-011": [onUse(
    look(5), chooseLooked("pick", { max: 2, filter: either(named(GOJO), named(GETO), named(RIKO)), prompt: "公开最多 2 张〈五条 悟〉〈夏油 杰〉或〈天内 理子〉并加入手牌" }),
    moveChosen("pick", "hand"), lookedToBottom())],

  // 术式顺转「苍」（事件）：1回合只能使用1张〈〈术式顺转「苍」〉。（"〈〈" read as "〈"）
  //                    选择对方能量线中的1张产生能量不高于1的角色，移动至前。那之后，对方没有角色因这次移动置于移除区的场合，抽取1张卡牌。
  //                    （进行移动时前线中没有空位的场合，对方选择前线中的1张卡牌置于移除区后再进行移动）（"移动至前" read as 移动至前线）
  "EX04BT/JJK-3-012": [{
    ...onUse(
      markThisTurn("苍"),
      chooseOpponent("target", { line: "energy", min: 1, max: 1, filter: energyGenAtMost(1), prompt: "选择对方能量线中 1 张产生能量不高于 1 的角色，移动至前线" }),
      ifThen(chosenCount("target"), [moveLine(chosen("target")), ifThen(noneChosen("__room"), [draw(1)])])),
    useCondition: notMarkedThisTurn("苍")
  }],

  // 虎杖 悠仁：【我方的回合中】[前线中存在的场合]我方的场外存在1张或更多〈宿傩的手指〉的场合，我方手牌中存在的所有〈宿傩〉的所需能量『减少[蓝×1]』。我方的场外存在4张或更多〈宿傩的手指〉的场合，改为『减少[蓝×2]』。
  //          【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "EX04BT/JJK-3-013": [
    costChange({ energy: (env) => (fingerCount(env) >= 4 ? 2 : 1), fromField: (env, handCardId) => env.ctx.card(handCardId)?.name === SUKUNA }, all(duringYourTurn, selfOnFront, fingersAtLeast(1))),
    onPlay(draw(1), discard(1))
  ],

  // 狗巻 棘：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）  (a keyword line only; the keyword is in the card data)
  "EX04BT/JJK-3-014": [],

  // 宿傩：【突进】〈虎杖 悠仁〉转为活跃状态，并可以移动至前线  【冲击①】（the Raid and the keyword are in the card data）
  //     【登场时】从下列选择『1项』。我方的场外存在3张或更多〈宿傩的手指〉的场合，改为选择『2项』。我方的场外存在4张或更多〈宿傩的手指〉的场合，改为选择『所有』。
  //     ·抽取1张卡牌，将我方的1张手牌置于场外。
  //     ·对方前线中的所有BP2500或更高的角色，本回合中，BP-2000。
  //     ·选择对方前线中的最多1张BP不高于3500的角色，退场。
  "EX04BT/JJK-3-015": [onPlay(
    ifThen(fingersAtLeast(4), [run("场外存在 4 张或更多〈宿傩的手指〉：选择所有", (env) => { env.vars.modes = ["m:0", "m:1", "m:2"]; })], [
      ifThen(fingersAtLeast(3), [{ do: "choose", as: "modes", from: "mode", side: "you", modes: SUKUNA_MODES, min: 2, max: 2, prompt: "场外存在 3 张或更多〈宿傩的手指〉：从下列选择 2 项", good: true }], [chooseMode("modes", SUKUNA_MODES)])]),
    ifThen(modePicked(0), [draw(1), discard(1)]),
    ifThen(modePicked(1), [bp(opponentFrontBpAtLeast(2500), -2000)]),
    ifThen(modePicked(2), [chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3500), prompt: "选择对方前线中最多 1 张 BP 不高于 3500 的角色退场" }), sideline(chosen("target"))]))],

  // 禅院 直毘人：【登场时】确认我方卡组最上方的2张卡牌。将其中任意张数自选顺序置于我方卡组的最上方，剩余的卡牌自选顺序置于我方卡组的最下方。
  "EX04BT/JJK-3-016": [onPlay(
    look(2),
    chooseLooked("top", { min: 0, max: 2, prompt: "选择任意张数置于卡组最上方（按点选顺序，先点的在最上面；其余置于最下方）" }),
    pickedLookedOnTop("top"),
    lookedToBottom())],

  // 禅院 真希：【登场时】从我方的场外将最多1张没有【特殊触发】和【最终触发】的事件卡牌加入手牌。
  "EX04BT/JJK-3-017": [onPlay(
    chooseFromSideline("pick", { max: 1, filter: and(isEventCard, noSpecialOrFinalTrigger), prompt: "从场外选择最多 1 张没有【特殊触发】和【最终触发】的事件卡牌加入手牌" }),
    moveChosen("pick", "hand"))],

  // 七海 建人：【对方的回合中】我方的卡组不多于15张的场合，此角色获得BP+1000和【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）。
  //          【登场时】将我方卡组最上方的最多1张卡牌置于场外。
  "EX04BT/JJK-3-018": [
    staticSelf({ bp: 1000, keywords: ["冲击无效"] }, all(duringOpponentTurn, deckAtMost(15))),
    onPlay(ifThen(deckAtLeast(1), [may("将卡组最上方的 1 张卡牌置于场外？", run("将卡组最上方的 1 张卡牌置于场外", mill(1)))]))
  ],

  // 七海 建人：【突进】〈七海 建人〉转为活跃状态，并可以移动至前线（the Raid is in the card data）
  //          【登场时】选择对方前线中的最多1张角色，直到我方的下一个回合开始时为止，给予“此角色无法攻击”。
  //          【攻击时】将我方卡组最上方的最多1张卡牌置于场外。那之后，我方的卡组不多于15张的场合，抽取最多1张卡牌，对方前线中的所有BP1500或更高的角色在本回合中，BP-1000。
  "EX04BT/JJK-3-019": [
    onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（直到我方下一个回合开始时为止无法攻击）" }), flag(chosen("target"), "cannotAttack", "untilYourNextTurn")),
    onAttack(
      ifThen(deckAtLeast(1), [may("将卡组最上方的 1 张卡牌置于场外？", run("将卡组最上方的 1 张卡牌置于场外", mill(1)))]),
      ifThen(deckAtMost(15), [
        ifThen(deckAtLeast(1), [may("抽取 1 张卡牌？", draw(1))]),
        bp(opponentFrontBpAtLeast(1500), -1000)]))
  ],

  // 灰原 雄：【退场时】我方的场上存在〈七海 建人〉的场合，抽取最多1张卡牌。
  "EX04BT/JJK-3-021": [withCondition(onSidelined(ifThen(deckAtLeast(1), [may("抽取 1 张卡牌？", draw(1))])), youHaveNamed(NANAMI))],

  // 灰原 雄：【启动主要】[转为休息状态][将此卡牌退场]从我方的场外将最多1张〈七海 建人〉加入手牌。
  "EX04BT/JJK-3-022": [activateMain({ costs: [restSelf, sidelineSelf] },
    chooseFromSideline("pick", { max: 1, filter: named(NANAMI), prompt: "从场外选择最多 1 张〈七海 建人〉加入手牌" }), moveChosen("pick", "hand"))],

  // 伏黑 惠：【我方的回合中】本回合中有我方的手牌或卡组中的卡牌通过我方的效果置于过场外的场合，此角色的BP+500。
  "EX04BT/JJK-3-023": [staticSelf({ bp: 500 }, all(duringYourTurn, (env) => handDeckSidelinedThisTurn(env.game, env.owner.accountId)))],

  // 骄傲吧 你很强（事件）：我方的前线中存在〈宿傩〉的场合，手牌中存在的此卡牌的所需能量减少[蓝×2]。
  //                     选择对方前线中的1张原本BP为4000或更高的角色退场。抽取2张卡牌。
  "EX04BT/JJK-3-024": [
    costChange({ energy: 2 }, (env) => env.owner.front.some((card) => nameOfCard(env, card) === SUKUNA)),
    onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, filter: printedBpAtLeast(4000), prompt: "选择对方前线中 1 张原本 BP 为 4000 或更高的角色退场" }), sideline(chosen("target")), draw(2))
  ],

  // 夏油 杰：【登场时】从我方的手牌中将1张所需能量不高于2且消费AP为1的拥有特征“咒灵”的子色角色卡牌在我方的场上以休息状态登场。
  //        （"子色" is read as 紫色: 子 / 紫 are homophones, the yellow 夏油 005 prints 黄色 in the same place, and the engine has no notion of a deck's sub-colour.）
  "EX04BT/JJK-3-025": [onPlay(
    chooseFromHand("card", { min: 1, max: 1, filter: and(isCharacterCard, ofColor("purple"), withAffinity("咒灵"), apCostIs(1), (env, cardId) => handCost(env, cardId) <= 2), prompt: "从手牌选择 1 张所需能量不高于 2、消费 AP 为 1 的紫色“咒灵”角色（以休息状态登场）" }),
    ifThen(chosenCount("card"), [put("card", "choose", true)]))],

  // 伏黑 甚尔：我方和对方的生命合计不多于4张的场合，手牌中存在的此卡牌的所需能量减少[紫×2]。
  //          此角色以活跃状态登场。
  //          【我方的回合中】此角色的BP+1000。
  //          【登场时】此角色在本回合中，获得【冲击①】和【瞄准攻击】（可以指定攻击对方前线中的角色，指定的场合，对方不能阻挡）。
  "EX04BT/JJK-3-026": [
    costChange({ energy: 2 }, (env) => env.owner.life.length + env.opponent.life.length <= 4),
    staticSelf({ bp: 1000 }, duringYourTurn),
    onPlay(activate("self"), grant("self", "冲击1"), grant("self", "瞄准攻击"))
  ],

  // 究极 机械丸 绝对形态：【突进】〈究极 机械丸〉转为活跃状态，并可以移动至前线（in the card data）
  //                   我方的场上存在5张或更多其他的“特征：京都校”或〈三轮 霞〉的场合，此角色获得【冲击①】。
  //                   【登场时】从下列选择1项。·选择对方前线中的最多1张BP不高于3500的角色退场。·选择对方场上的最多1张场地退场。
  "EX04BT/JJK-3-027": [
    staticSelf({ keywords: ["冲击1"] }, kyotoAtLeast(5)),
    onPlay(
      chooseMode("mode", ["选择对方前线中的最多1张BP不高于3500的角色退场", "选择对方场上的最多1张场地退场"]),
      ifThen((env) => env.vars.mode?.[0] === "m:0", [chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3500), prompt: "选择对方前线中最多 1 张 BP 不高于 3500 的角色退场" }), sideline(chosen("target"))]),
      ifThen((env) => env.vars.mode?.[0] === "m:1", [chooseOpponentSite("site", "选择对方场上最多 1 张场地退场"), sideline(chosen("site"))]))
  ],

  // 三轮 霞：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "EX04BT/JJK-3-028": [onPlay(draw(1), discard(1))],

  // 与 幸吉：此卡牌也视为〈究极 机械丸〉。
  "EX04BT/JJK-3-029": [ALSO_MECHAMARU],

  // 与 幸吉：此卡牌也视为〈究极 机械丸〉。
  //        【登场时】我方的场上存在5张或更多其他的“特征：京都校”或〈三轮 霞〉的场合，选择对方前线中的最多1张角色，本回合中，BP-1000。
  "EX04BT/JJK-3-030": [
    ALSO_MECHAMARU,
    withCondition(onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-1000）" }), bp(chosen("target"), -1000)), kyotoAtLeast(5))
  ],

  // 漏瑚：【我方的回合中】本回合中有角色因BP变为0或因效果退场的场合，此角色的BP+1000。
  "EX04BT/JJK-3-031": [staticSelf({ bp: 1000 }, all(duringYourTurn, (env) => characterSidelinedByBpOrEffectThisTurn(env.game)))],

  // 陀艮：【退场时】将我方卡组最上方的2张卡牌置于场外。
  "EX04BT/JJK-3-032": [onSidelined(run("将卡组最上方的 2 张卡牌置于场外", mill(2)))],

  // 陀艮：【突进】〈陀艮〉转为活跃状态，并可以移动至前线（in the card data）
  //     【攻击时】可以将我方的1张手牌置于场外。这样做的场合，从我方的场外将1张所需能量不高于2且消费AP1的紫色角色卡牌在我方的场上以休息状态登场。通过此效果登场的角色的【登场时】效果不发动。
  "EX04BT/JJK-3-033": [onAttack(ifThen(handNotEmpty, [may("将手牌 1 张置于场外，从场外将 1 张紫色角色以休息状态登场？",
    discard(1),
    chooseFromSideline("card", { min: 1, max: 1, filter: and(isCharacterCard, ofColor("purple"), apCostIs(1), energyCostAtMost(2)), prompt: "从场外选择 1 张所需能量不高于 2、消费 AP 为 1 的紫色角色（以休息状态登场，其【登场时】效果不发动）" }),
    ifThen(chosenCount("card"), [
      put("card", "choose", true),
      run("通过此效果登场的角色的【登场时】效果不发动", (env) => {
        const uid = env.vars["placed:card"]?.[0];
        if (!uid) return;
        env.game.queue = env.game.queue.filter((entry) => {
          if (entry.selfUid !== uid) return true;
          const ability = abilitiesOf(env.ctx, entry.abilityCardId ?? entry.cardId)[entry.ability];
          return !(ability?.kind === "triggered" && ability.when.includes("onPlay"));
        });
      })]))]))],

  // 花御：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）  (a keyword line only; the keyword is in the card data)
  "EX04BT/JJK-3-034": [],

  // 真人：【突进】〈真人〉转为活跃状态，并可以移动至前线（in the card data）
  //     【登场时】可以将我方场上的2张〈真人〉以外的角色退场。此效果无法将拥有相同卡牌名称的角色退场。通过此效果将2张退场的场合，抽取2张卡牌，选择对方前线中的最多1张角色，本回合中，BP-4000。
  "EX04BT/JJK-3-035": [onPlay(ifThen((env) => distinctNames(env, mahitoCandidates(env)) >= 2, [may("将我方场上的 2 张〈真人〉以外、卡牌名称不同的角色退场？",
    {
      do: "choose", as: "out", from: "field", side: "you", min: 2, max: 2, good: false,
      filter: (env, cardId) => env.ctx.card(cardId)?.name !== MAHITO,
      check: (env, cardIds) => cardIds.length === 2 && new Set(cardIds.map((cardId) => env.ctx.card(cardId)?.name)).size === 2,
      prompt: "选择我方场上 2 张〈真人〉以外、卡牌名称不同的角色退场"
    },
    sideline(chosen("out")),
    ifThen((env) => (env.vars.out ?? []).length === 2 && chosenCards(env, "out").length === 0, [
      draw(2),
      chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-4000）" }),
      bp(chosen("target"), -4000)]))]))]
};
