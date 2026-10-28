/**
 * Abilities of the JJK cards, batch 6 (see cards.ts for the conventions): EX04BT/JJK-3-067 ... 073 (red cards of the extra booster, listed as yellow), the blue starter-deck UA02ST/JJK-1-044 ... 109
 * and the UA02NC/JJK-2-001 ... 011 cards. Each entry follows the card's printed text, shown above it.
 *
 * Exact reprints of already encoded cards reuse their entry: UA02ST/JJK-1-044, 056, 058 (= UA02BT/JJK-1-044, 056, 058), EX04BT/JJK-3-073 (= UA02BT/JJK-1-034).
 * Reading choices: see the notes above UA02NC/JJK-2-005 / 007 / 010 and EX04BT/JJK-3-070 / 072.
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, characterSidelinedThisTurn, costOf, energyLineOnly, energyOf, flagsOf, queueCardEvent, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateMain, all, and, apCostIs, bp, bpAtMost, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn,
  chosen, chosenCount, costChange, discard, discardCost, draw, duringOpponentTurn, duringYourTurn, either, energyCostAtMost, flag, grant, ifThen, isCharacterCard, look,
  lookedToBottom, may, moveChosen, named, notNamed, onAttack, onPlay, onSidelined, onUse, opponentRestedAtLeast, put, remove, restSelf, run, selfOnFront, sideline,
  sidelineSelf, staticAura, staticSelf, toHand, usedEventThisTurn, withAffinity, withCondition, youHaveNamed, ofColor
} from "./dsl.ts";
import { JJK_1_ABILITIES } from "./cards-jjk-1.ts";
import { JJK_2_ABILITIES } from "./cards-jjk-2.ts";

// ---- Helpers for these cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const FINGER = "宿傩的手指";
const GOJO = "五条 悟";
const GETO = "夏油 杰";
const SHOKO = "家入 硝子";
const DOMAIN = "嵌合暗翳庭";
const MAHITO = "真人";
const ITADORI = "虎杖 悠仁";
const KYOTO = "京都校";
const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const nameOfCard = (env: AbilityEnv, card: UnionArenaFieldCard): string => env.ctx.card(card.cardId)?.name ?? "";
const findField = (env: AbilityEnv, uid: string): UnionArenaFieldCard | null => env.players.flatMap(fieldOf).find((card) => card.uid === uid) ?? null;
/** The chosen field cards still on the field. */
const chosenCards = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => (env.vars[name] ?? []).flatMap((uid) => findField(env, uid) ?? []);
/** Something was chosen under `name` and that card is no longer on the field (it was sidelined by the effect: 这样做的场合). */
const leftField = (name: string): Condition => (env) => (env.vars[name] ?? []).length > 0 && chosenCards(env, name).length === 0;
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;

/** Required energy of a hand card now (with its own cost changes). */
const handCost = (env: AbilityEnv, cardId: string): number => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy;
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => handCost(env, cardId) <= limit;

// Deck and sideline
const deckAtLeast = (count: number): Condition => (env) => env.owner.library.length >= count;
/** 将我方卡组最上方的N张卡牌置于场外 */
const mill = (count: number) => (env: AbilityEnv): void => { env.owner.sideline.push(...env.owner.library.splice(0, count)); };
const fingerCount = (env: AbilityEnv): number => env.owner.sideline.filter((cardId) => env.ctx.card(cardId)?.name === FINGER).length;
const fingersAtLeast = (count: number): Condition => (env) => fingerCount(env) >= count;
const isEventCard: CardFilter = (env, cardId) => env.ctx.card(cardId)?.type === "event";
/** BP1500或更高 (the current BP). */
const bpAtLeast = (limit: number): CardFilter => (env, _cardId, card) => !!card && bpOf(env.ctx, card) >= limit;

/** 公开其中最多N张…并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。 */
const searchThenDiscard = (count: number, filter: CardFilter, what: string): Step[] => [
  look(count),
  chooseLooked("pick", { max: 1, filter, prompt: `公开最多 1 张${what}并加入手牌` }),
  moveChosen("pick", "hand"),
  lookedToBottom(),
  ifThen(chosenCount("pick"), [discard(1)])
];

/** 对方选择对方前线中的1张角色放回手牌 (the opponent picks their own; with none, nothing happens). */
const opponentPicksBackOne: Step[] = [
  { do: "choose", as: "back", from: "field", side: "opponent", chooser: "opponent", line: "front", min: 1, max: 1, prompt: "选择自己前线中 1 张角色放回手牌", good: false },
  toHand(chosen("back"))
];

/** 同线中存在〈name〉: another card of that name on the front line (the cards that use it also need "前线中存在的场合"). */
const sameLineHas = (name: string): Condition => (env) => !!env.self && env.owner.front.includes(env.self) && env.owner.front.some((card) => card.uid !== env.self!.uid && nameOfCard(env, card) === name);

/** The single field card of the owner chosen under `name`, if still there. */
const ownChosen = (env: AbilityEnv, name: string): UnionArenaFieldCard | undefined => chosenCards(env, name).find((card) => fieldOf(env.owner).includes(card));

/** A field card that can be moved to the other line by our own effect (not 无法移动), and, going to the front line, not 无法在前线中登场. */
const movable = (card: UnionArenaFieldCard): boolean => !flagsOf(card).includes("cannotMove");
const movableToFront = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => movable(card) && !energyLineOnly(env.ctx, card.cardId);

/** 东堂 葵 (2-010): another 京都校 character on the other line that can trade places with this card. */
const canTradeWith = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => {
  const self = env.self;
  if (!self || card.uid === self.uid || !isCharacter(env, card) || !(env.ctx.card(card.cardId)?.affinities ?? []).includes(KYOTO)) return false;
  if (!movable(self) || !movable(card)) return false;
  if (env.owner.front.includes(self)) return env.owner.energy.includes(card) && movableToFront(env, card);
  return env.owner.front.includes(card) && movableToFront(env, self);
};
const hasTradePartner: Condition = (env) => fieldOf(env.owner).some((card) => canTradeWith(env, card));

/** 我方的产生能量 (3-067): the energy generated by our energy line, all colours together. */
const totalEnergy = (env: AbilityEnv): number => ["red", "yellow", "blue", "green", "purple"].reduce((sum, color) => sum + energyOf(env.ctx, env.owner, color), 0);

/** 我方场上的〈真人〉以外的角色 exist */
const hasNonMahito: Condition = (env) => fieldOf(env.owner).some((card) => isCharacter(env, card) && nameOfCard(env, card) !== MAHITO);

/**
 * 红色: the data lists the red cards of the extra booster EX04BT/JJK-3-036 ... as colour "yellow" with red energy generation, so a card
 * counts as red when its colour or its energy colour is red.
 */
const isRed: CardFilter = (env, cardId) => { const stats = env.ctx.card(cardId); return stats?.color === "red" || stats?.energyGenColor === "red"; };

/** The cards of the opponent's front line with BP 4000 or more. */
const opponentBigFront = (env: AbilityEnv): number => env.opponent.front.filter((card) => isCharacter(env, card) && bpOf(env.ctx, card) >= 4000).length;

/** 不存在的记忆 (3-071): how many of the four names were chosen. */
const CHOSEN_NAMES = ["swell", "decay", "blood", "yuji"];
const chosenTotal = (env: AbilityEnv): number => CHOSEN_NAMES.reduce((sum, name) => sum + Math.min(1, (env.vars[name] ?? []).length), 0);

/** 宿傩 (2-007): the attack-time choice takes 1 more character per 〈宿傩的手指〉 in the sideline (the deck rules allow at most 4 of a card). */
const MAX_FINGERS = 8;
const sukunaAttackChoices: Step[] = Array.from({ length: MAX_FINGERS + 1 }, (_, count): Step =>
  ifThen((env) => (count === MAX_FINGERS ? fingerCount(env) >= MAX_FINGERS : fingerCount(env) === count), [
    chooseOpponent("target", { max: 1 + count, filter: bpAtLeast(1500), prompt: `选择对方场上最多 ${1 + count} 张 BP1500 或更高的角色（本回合 BP-1000）` }),
    bp(chosen("target"), -1000)
  ]));

/** Moves the picked card of the sideline ("s:<index>") to the top of the deck. */
const pickedSidelineToDeckTop = (name: string): Step => run("将所选的卡牌置于卡组最上方", (env) => {
  const key = env.vars[name]?.[0];
  if (!key?.startsWith("s:")) return;
  const [cardId] = env.owner.sideline.splice(Number(key.slice(2)), 1);
  if (cardId) env.owner.library.unshift(cardId);
});
/** Moves the picked looked-at card ("l:<index>") to the top of the deck. */
const pickedLookedToDeckTop = (name: string): Step => run("将所选的卡牌置于卡组最上方", (env) => {
  const key = env.vars[name]?.[0];
  const looking = env.game.looking;
  if (!key?.startsWith("l:") || !looking) return;
  const [cardId] = looking.cards.splice(Number(key.slice(2)), 1);
  if (cardId) env.owner.library.unshift(cardId);
});

const ownAllCharacters = (env: AbilityEnv): UnionArenaFieldCard[] => fieldOf(env.owner).filter((card) => isCharacter(env, card));

export const JJK_6_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // ---- EX04BT (the extra booster's red cards, listed as yellow) ----

  // 真人：【启动主要】[前线中存在的场合][每回合1次]只有在我方的产生能量为5或更高的场合才能发动。从下列选择1项。
  //     ·此角色在本回合中，获得【冲击①】（当在进行攻击的战斗中胜利时，给予对方玩家1点伤害）。
  //     ·可以将我方场上的1张〈真人〉以外的角色退场。这样做的场合，抽取2张卡牌，将我方的1张手牌置于场外。
  "EX04BT/JJK-3-067": [activateMain({ condition: all(selfOnFront, (env) => totalEnergy(env) >= 5), once: true },
    chooseMode("mode", ["此角色在本回合中，获得【冲击①】", "可以将我方场上的1张〈真人〉以外的角色退场。这样做的场合，抽取2张卡牌，将我方的1张手牌置于场外"]),
    ifThen(modeIs("mode", 0), [grant("self", "冲击1")]),
    ifThen(modeIs("mode", 1), [ifThen(hasNonMahito, [may("将我方场上的 1 张〈真人〉以外的角色退场，抽取 2 张卡牌并将 1 张手牌置于场外？",
      chooseOwn("out", { min: 1, max: 1, filter: notNamed(MAHITO), prompt: "选择我方场上 1 张〈真人〉以外的角色退场" }), sideline(chosen("out")),
      ifThen(leftField("out"), [draw(2), discard(1)]))])]))],

  // 地下铁路的站台（场地）：【启动主要】[转为休息状态]将我方卡组最上方的1张卡牌置于场外。
  //                      【启动主要】[转为休息状态][将此卡牌退场]从我方的场外将1张〈夏油 杰〉或“特征：咒灵”或“特征：咒胎九相图”置于我方卡组的最上方。
  //   (The second one can only be used while the sideline holds such a card.)
  "EX04BT/JJK-3-068": [
    activateMain({ costs: [restSelf] }, run("将我方卡组最上方的 1 张卡牌置于场外", mill(1))),
    activateMain({
      costs: [restSelf, sidelineSelf],
      condition: (env) => env.owner.sideline.some((cardId) => either(named(GETO), withAffinity("咒灵"), withAffinity("咒胎九相图"))(env, cardId, null))
    },
    chooseFromSideline("pick", { min: 1, max: 1, filter: either(named(GETO), withAffinity("咒灵"), withAffinity("咒胎九相图")), prompt: "从场外选择 1 张〈夏油 杰〉或“咒灵”或“咒胎九相图”置于卡组最上方" }),
    pickedSidelineToDeckTop("pick"))
  ],

  // 黑闪（事件）：我方的场上存在〈虎杖 悠仁〉的场合，手牌中存在的此卡牌的消费AP-1。
  //            选择对方前线中的最多1张BP不高于5000的角色退场。那之后，对方的前线中存在2张或更多BP4000或更高的角色的场合，选择我方场上的最多2张BP4000或更高的“特征：咒术师”，本回合中，BP+2000。
  "EX04BT/JJK-3-069": [
    costChange({ ap: 1 }, youHaveNamed(ITADORI)),
    onUse(
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中最多 1 张 BP 不高于 5000 的角色退场" }), sideline(chosen("target")),
      ifThen((env) => opponentBigFront(env) >= 2, [
        chooseOwn("boost", { max: 2, filter: and(withAffinity("咒术师"), bpAtLeast(4000)), prompt: "选择我方场上最多 2 张 BP4000 或更高的“咒术师”（本回合 BP+2000）" }),
        bp(chosen("boost"), 2000)]))
  ],

  // 狱门疆（事件）：我方的前线中〔存在合计2张或更多的“特征：咒灵”和“特征：咒胎九相图”色或存在〈夏油 杰〉〕的场合，手牌中存在的此卡牌的消费AP-1。
  //             选择对方前线中的1张BP不高于5000的角色置于移除区。通过此效果将BP5000的角色置于移除区的场合，抽取1张卡牌。
  //   Reading: “色” is a misprint of “或”: 2 or more cards that have the trait 咒灵 or 咒胎九相图 on our front line, or a 〈夏油 杰〉 there. “BP5000的角色” = its BP was exactly 5000.
  "EX04BT/JJK-3-070": [
    costChange({ ap: 1 }, (env) => env.owner.front.some((card) => nameOfCard(env, card) === GETO)
      || env.owner.front.filter((card) => isCharacter(env, card) && ((env.ctx.card(card.cardId)?.affinities ?? []).includes("咒灵") || (env.ctx.card(card.cardId)?.affinities ?? []).includes("咒胎九相图"))).length >= 2),
    onUse(
      chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中 1 张 BP 不高于 5000 的角色置于移除区" }),
      run("记录被选择的角色的 BP 是否为 5000", (env) => { const card = chosenCards(env, "target")[0]; env.vars.exactly5000 = card && bpOf(env.ctx, card) === 5000 ? ["yes"] : []; }),
      remove(chosen("target")),
      ifThen(chosenCount("exactly5000"), [draw(1)]))
  ],

  // 不存在的记忆（事件）：选择我方前线中的〈胀相〉、〈坏相〉、〈血涂〉、〈虎杖 悠仁〉最多各1张，本回合中，BP+1000。
  //                  选择了包含〈胀相〉在内的合计2张或更多的场合，通过此效果选择的〈胀相〉追加在本回合中，给予【冲击+1】（冲击给予的伤害+1，没有冲击的场合，获得【冲击①】）。
  //                  选择了包含〈胀相〉在内的合计3张或更多的场合，抽取1张卡牌。
  "EX04BT/JJK-3-071": [onUse(
    chooseOwn("swell", { line: "front", max: 1, filter: named("胀相"), prompt: "选择我方前线中最多 1 张〈胀相〉（本回合 BP+1000）" }),
    chooseOwn("decay", { line: "front", max: 1, filter: named("坏相"), prompt: "选择我方前线中最多 1 张〈坏相〉（本回合 BP+1000）" }),
    chooseOwn("blood", { line: "front", max: 1, filter: named("血涂"), prompt: "选择我方前线中最多 1 张〈血涂〉（本回合 BP+1000）" }),
    chooseOwn("yuji", { line: "front", max: 1, filter: named(ITADORI), prompt: "选择我方前线中最多 1 张〈虎杖 悠仁〉（本回合 BP+1000）" }),
    ...CHOSEN_NAMES.map((name): Step => bp(chosen(name), 1000)),
    ifThen(all(chosenCount("swell"), (env) => chosenTotal(env) >= 2), [grant(chosen("swell"), "冲击+1")]),
    ifThen(all(chosenCount("swell"), (env) => chosenTotal(env) >= 3), [draw(1)]))],

  // 迷你机械丸（事件）：※此卡牌只能在卡组中最多投入3张。（deck-building rule, not an effect）
  //                  我方的移除区中存在〈五条 悟〉的场合，手牌中存在的此卡牌的所需能量减少[红×3]。
  //                  抽取1张卡牌。从我方的手牌中将最多2张所需能量不高于3且消费AP为1的红色的“特征：咒术师”在我方的场上以休息状态登场。
  //   The two cards are chosen one after the other (each "最多1张", the second after the first has been put onto the field).
  "EX04BT/JJK-3-072": [
    costChange({ energy: 3 }, (env) => env.owner.removal.some((cardId) => env.ctx.card(cardId)?.name === GOJO)),
    onUse(
      draw(1),
      chooseFromHand("first", { max: 1, filter: and(isCharacterCard, withAffinity("咒术师"), isRed, apCostIs(1), handCostAtMost(3)), prompt: "从手牌选择最多 2 张所需能量不高于 3、消费 AP 为 1 的红色“咒术师”（先选第 1 张，以休息状态登场）" }),
      ifThen(chosenCount("first"), [
        put("first", "choose", true),
        chooseFromHand("second", { max: 1, filter: and(isCharacterCard, withAffinity("咒术师"), isRed, apCostIs(1), handCostAtMost(3)), prompt: "再选择最多 1 张所需能量不高于 3、消费 AP 为 1 的红色“咒术师”（以休息状态登场）" }),
        ifThen(chosenCount("second"), [put("second", "choose", true)])]))
  ],

  // 领域展开（事件）：选择我方的最多2张AP卡牌，转为活跃状态。
  "EX04BT/JJK-3-073": JJK_1_ABILITIES["UA02BT/JJK-1-034"]!,

  // ---- UA02ST (starter deck) ----

  // 钉崎 野蔷薇（= UA02BT/JJK-1-044）：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，此角色放回手牌。
  "UA02ST/JJK-1-044": JJK_2_ABILITIES["UA02BT/JJK-1-044"]!,

  // 伏黑（= UA02BT/JJK-1-056 伏黑 惠；the text prints “选择最对方场上”, a typo of “选择对方场上”）：【登场时】选择对方场上最多1张BP1500或更高的角色，本回合中BP-1000。
  "UA02ST/JJK-1-056": JJK_2_ABILITIES["UA02BT/JJK-1-056"]!,

  // 夜蛾 正道（= UA02BT/JJK-1-058）：【启动主要】[转为休息状态]选择我方场上的1张其他角色，本回合中BP+1000。
  "UA02ST/JJK-1-058": JJK_2_ABILITIES["UA02BT/JJK-1-058"]!,

  // 虎杖 悠仁：【对方的回合中】我方场外存在〈宿傩的手指〉的场合，此角色BP+1000。
  "UA02ST/JJK-1-101": [staticSelf({ bp: 1000 }, all(duringOpponentTurn, fingersAtLeast(1)))],

  // 五条 悟：【冲击①】（当在进行攻击的战斗中胜利时，给与对方玩家1点伤害）（keyword in the card data）
  //        【登场时】[前线中存在的场合]对方将对方前线中的1张角色放回手牌。
  "UA02ST/JJK-1-103": [withCondition(onPlay(...opponentPicksBackOne), selfOnFront)],

  // 佐佐木&井口：【攻击时】抽取1张卡牌，将我方1的张手牌置于场外。（「1的张」应为「1张」）
  "UA02ST/JJK-1-104": [onAttack(draw(1), discard(1))],

  // 宿傩：【突进】〈虎杖 悠仁〉转为活跃状态，并可以移动至前线。（the Raid is in the card data）
  //     【我方的回合中】我方场外存在1张或更多〈宿傩的手指〉的场合，此角色BP+1000。存在2张或更多〈宿傩的手指〉的场合，此角色获得【冲击①】。
  //     【登场时】抽取2张卡牌，将我方1的张手牌置于场外。（「1的张」应为「1张」）
  "UA02ST/JJK-1-105": [
    staticSelf({ bp: 1000 }, all(duringYourTurn, fingersAtLeast(1))),
    staticSelf({ keywords: ["冲击1"] }, all(duringYourTurn, fingersAtLeast(2))),
    onPlay(draw(2), discard(1))
  ],

  // 伏黑 惠：【登场时】选择对方场上最多1张BP不高于3000的角色，放回手牌。
  "UA02ST/JJK-1-107": [onPlay(chooseOpponent("target", { max: 1, filter: bpAtMost(3000), prompt: "选择对方场上最多 1 张 BP 不高于 3000 的角色放回手牌" }), toHand(chosen("target")))],

  // 东京都立咒术高等专门学校（场地）：此场地以活跃状态登场。
  //   【启动主要】[转为休息状态][每回合1次]只有本回合中我方使用过事件卡牌的场合才能发动。我方场上的所有角色本回合中，BP+1000。
  "UA02ST/JJK-1-108": [
    onPlay(activate("self")),
    activateMain({ costs: [restSelf], once: true, condition: usedEventThisTurn }, bp(ownAllCharacters, 1000))
  ],

  // 咒术高专1年（事件）：抽取3张卡牌。将我方2张手牌置于场外。
  "UA02ST/JJK-1-109": [onUse(draw(3), discard(2))],

  // ---- UA02NC ----

  // 家入 硝子：【登场时】确认我方卡组最上方的4张卡牌。公开其中最多1张〈五条 悟〉或〈夏油 杰〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UA02NC/JJK-2-001": [onPlay(...searchThenDiscard(4, either(named(GOJO), named(GETO)), "〈五条 悟〉或〈夏油 杰〉"))],

  // 钉崎 野蔷薇：【登场时】对方场上存在休息状态的角色的场合，从我方场外将最多1张所需能量不高于2的黄色事件卡牌加入手牌。
  "UA02NC/JJK-2-002": [withCondition(onPlay(
    chooseFromSideline("pick", { max: 1, filter: and(isEventCard, ofColor("yellow"), energyCostAtMost(2)), prompt: "从场外选择最多 1 张所需能量不高于 2 的黄色事件卡牌加入手牌" }),
    moveChosen("pick", "hand")), opponentRestedAtLeast(1))],

  // 夏油 杰：【我方的回合中】[前线中存在的场合]同线中存在〈五条 悟〉的场合，此角色与我方前线中存在的所有〈五条 悟〉BP+500。
  //        【启动主要】[将1张手牌置于场外][每回合1次]此角色在本回合中，获得[此角色存在于前线的场合也会产生能量。]。
  "UA02NC/JJK-2-003": [
    staticAura((env, card, cardOwner) => cardOwner.accountId === env.owner.accountId && (card.uid === env.self?.uid || (env.owner.front.includes(card) && nameOfCard(env, card) === GOJO)),
      { bp: 500 }, all(duringYourTurn, selfOnFront, sameLineHas(GOJO))),
    activateMain({ costs: [discardCost(1)], once: true }, flag("self", "energyOnFront"))
  ],

  // 五条 悟：（【）我方的回合中】[前线中存在的场合]同线中存在〈夏油 杰〉的场合，此角色获得【伤害②】。（the opening 【 is missing in the text）
  //        【退场时】确认我方卡组最上方的3张卡牌。公开其中最多1张〈五条 悟〉或〈家入 硝子〉或〈夏油 杰〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UA02NC/JJK-2-004": [
    staticSelf({ keywords: ["伤害2"] }, all(duringYourTurn, selfOnFront, sameLineHas(GETO))),
    onSidelined(...searchThenDiscard(3, either(named(GOJO), named(SHOKO), named(GETO)), "〈五条 悟〉〈家入 硝子〉或〈夏油 杰〉"))
  ],

  // 伏黑 惠：【登场时】确认我方卡组最上方的4张卡牌。公开其中最多1张〈嵌合暗翳庭〉或拥有特征[式神]的角色置于卡组最上方或场外。剩余的卡牌自选顺序置于卡组最下方。
  //   Reading: the revealed card (if any) goes to the top of the deck or the sideline, as the player chooses; the others go to the bottom in an order of their choice.
  "UA02NC/JJK-2-005": [onPlay(
    look(4),
    chooseLooked("pick", { max: 1, filter: either(named(DOMAIN), and(isCharacterCard, withAffinity("式神"))), prompt: "公开最多 1 张〈嵌合暗翳庭〉或“式神”角色，置于卡组最上方或场外" }),
    ifThen(chosenCount("pick"), [
      chooseMode("where", ["置于卡组最上方", "置于场外"]),
      ifThen(modeIs("where", 0), [pickedLookedToDeckTop("pick")], [moveChosen("pick", "sideline")])]),
    lookedToBottom())],

  // 虎杖 悠仁：我方场外存在〈宿傩的手指〉的场合，此角色的产生能量+[蓝]
  "UA02NC/JJK-2-006": [staticSelf({ energy: 1 }, fingersAtLeast(1))],

  // 宿傩：此角色以活跃状态登场。
  //     【2次阻挡】（当此角色在本回合中首次进行阻挡时，转为活跃状态）（not in the card data's keywords)
  //     【我放的回合中】此角色的BP+500。（「我放」应为「我方」）
  //     【攻击时】选择对方场上最多[1张]BP1500或更高的角色，本回合中BP-1000。我方场外每存在1张〈宿傩的手指〉，可选择的角色[+1张]。
  "UA02NC/JJK-2-007": [
    onPlay(activate("self")),
    staticSelf({ keywords: ["2次阻挡"] }),
    staticSelf({ bp: 500 }, duringYourTurn),
    onAttack(...sukunaAttackChoices)
  ],

  // 七海 建人：【退场时】可以将我方卡组最上方的1张卡牌置于场外。这样做的场合，选择我方场上最多1张角色，本回合中BP+1000。
  "UA02NC/JJK-2-008": [onSidelined(ifThen(deckAtLeast(1), [may("将卡组最上方的 1 张卡牌置于场外？",
    run("将卡组最上方的 1 张卡牌置于场外", mill(1)),
    chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))]))],

  // 东堂 葵：【启动主要】[每回合1次]此选择1张与此角色不同线中存在的拥有特征[京都校]的角色，与此角色交换位置。（「此选择」应为「选择」）
  "UA02NC/JJK-2-010": [activateMain({ once: true, condition: hasTradePartner },
    { do: "choose", as: "partner", from: "field", side: "you", filter: (env, _cardId, card) => !!card && canTradeWith(env, card), min: 1, max: 1, prompt: "选择与此角色不同线中的 1 张“京都校”角色，与此角色交换位置", good: true },
    run("与所选角色交换位置", (env) => {
      const self = env.self;
      const other = ownChosen(env, "partner");
      if (!self || !other) return;
      const selfOnFrontLine = env.owner.front.includes(self);
      if (selfOnFrontLine === env.owner.front.includes(other)) return;
      const [frontCard, energyCard] = selfOnFrontLine ? [self, other] : [other, self];
      env.owner.front = env.owner.front.map((card) => (card === frontCard ? energyCard : card));
      env.owner.energy = env.owner.energy.map((card) => (card === energyCard ? frontCard : card));
      queueCardEvent(env.game, env.ctx, "onMoveToEnergy", env.owner, frontCard);
      queueCardEvent(env.game, env.ctx, "onMoveToFront", env.owner, energyCard);
    }))],

  // 真人：【我方的回合中】本回合中我方场上的角色退场过的场合，此角色的产生能量+[紫]。
  //     【启动主要】[每回合1次]将我方场上的1张〈真人〉以外的角色退场。这样做的场合，选择我方场上最多1张拥有特征[咒灵]或[改造人类]的角色，本回合中BP+1000。
  //   (It can only be started while we have a character other than a 〈真人〉 to sideline.)
  "UA02NC/JJK-2-011": [
    staticSelf({ energy: 1 }, all(duringYourTurn, (env) => characterSidelinedThisTurn(env.game, env.owner.accountId))),
    activateMain({ once: true, condition: hasNonMahito },
      chooseOwn("out", { min: 1, max: 1, filter: notNamed(MAHITO), prompt: "选择我方场上 1 张〈真人〉以外的角色退场" }), sideline(chosen("out")),
      ifThen(leftField("out"), [
        chooseOwn("target", { max: 1, filter: either(withAffinity("咒灵"), withAffinity("改造人类")), prompt: "选择我方场上最多 1 张“咒灵”或“改造人类”（本回合 BP+1000）" }),
        bp(chosen("target"), 1000)]))
  ]
};
