/** Abilities of the JJK cards, batch 1 (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { costOf, energyOf } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step, Target } from "./types.ts";
import {
  activate, activateAp, activateMain, activeCard, and, apCost, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseOpponent,
  chooseOwn, chosen, chosenCount, costChange, discard, draw, duringOpponentTurn, either, energyCostAtMost, energyThisTurn, grant, grantAbility, givenOnly, ifThen,
  isCharacterCard, look, lookedToBottom, moveChosen, moveLine, named, noneChosen, notSelf, onAttack, onPlay, onSidelined, onUse, opponentHasColor, put, remove, rest,
  restSelf, run, selfActive, selfOnFront, sideline, staticAura, staticSelf, toHand, when, withAffinity, withCondition, youHaveNamed
} from "./dsl.ts";

// ---- Helpers for the JJK 1 cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const ownField = (env: AbilityEnv): UnionArenaFieldCard[] => [...env.owner.front, ...env.owner.energy];
const findField = (env: AbilityEnv, uid: string): UnionArenaFieldCard | null => {
  for (const owner of env.players) {
    const card = [...owner.front, ...owner.energy].find((entry) => entry.uid === uid);
    if (card) return card;
  }
  return null;
};
/** The chosen field cards still on the field. */
const chosenCards = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => (env.vars[name] ?? []).flatMap((uid) => findField(env, uid) ?? []);
const restedCard: CardFilter = (_env, _cardId, card) => !!card && card.rested;

/** 该角色的下1次转为活跃状态无效 (for chosen cards that are resting now). */
const skipNextActivate = (name: string): Step => run("该角色下一次转为活跃状态无效", (env) => {
  for (const card of chosenCards(env, name)) if (card.rested) card.skipNextActivate = true;
});
/** 转为休息状态。该角色的下1次转为活跃状态无效。 */
const restAndFreeze = (name: string): Step => ifThen(chosenCount(name), [rest(chosen(name)), skipNextActivate(name)]);

/** Required energy of a hand card now (with its own cost changes). */
const handCost = (env: AbilityEnv, cardId: string): number => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy;

/** The card name 伏黑 惠 is printed 〈伏黑 恵〉 in some ability texts (a Japanese variant of the same character); the card data spells it 惠. */
const FUSHIGURO = ["伏黑 惠", "伏黑 恵"];
const youHaveFushiguro: Condition = (env) => ownField(env).some((card) => FUSHIGURO.includes(env.ctx.card(card.cardId)?.name ?? ""));
/** The text prints 〈玉犬：黑＆白〉; the card data spells the name 玉犬:黑&白. */
const DIVINE_DOGS = "玉犬:黑&白";

/** 我方前线所有角色 */
const ownFrontCharacters: Target = (env) => env.owner.front.filter((card) => isCharacter(env, card));
/** 我方场上的所有［特征：式神］ */
const ownShikigami: Target = (env) => ownField(env).filter((card) => isCharacter(env, card) && (env.ctx.card(card.cardId)?.affinities ?? []).includes("式神"));

/** 拥有「式神」特征的角色卡牌，消费AP为1，所需能量不高于3 (in the hand: with its own cost changes). */
const shikigamiInHand = (limit: number): CardFilter => and(isCharacterCard, withAffinity("式神"), apCostIs(1), (env, cardId) => handCost(env, cardId) <= limit);
const shikigamiInSideline = (limit: number): CardFilter => and(isCharacterCard, withAffinity("式神"), apCostIs(1), energyCostAtMost(limit));
/** 满足所需能量: the energy line makes enough energy of the card's colour. */
const affordable: CardFilter = (env, cardId) => energyOf(env.ctx, env.owner, env.ctx.card(cardId)?.color ?? "") >= handCost(env, cardId);

/** 从我方手牌或场外将最多1张…: one card from the hand, or (when none was picked there) from the sideline, put into `name`. */
const handOrSideline = (name: string, inHand: CardFilter, inSideline: CardFilter, what: string): Step[] => [
  chooseFromHand(name, { max: 1, filter: inHand, prompt: `从手牌选择最多 1 张${what}（不选则可从场外选择）` }),
  ifThen(noneChosen(name), [chooseFromSideline(name, { max: 1, filter: inSideline, prompt: `从场外选择最多 1 张${what}` })])
];

/** 选择对方场上最多1张场地 */
const chooseOpponentSite = (as: string, prompt: string): Step => ({
  do: "choose", as, from: "field", side: "opponent", characters: false, filter: (env, cardId) => env.ctx.card(cardId)?.type === "site", min: 0, max: 1, prompt, good: false
});

/** 无量空处 (1-028): the marker an affected character carries; it counts only while that site is on the field. */
const frozenBy = (siteUid: string): string => `frozenBy:${siteUid}`;

/** 嵌合暗翳庭 (1-027): the attacker is 〈伏黑 恵〉. */
const attackerIsFushiguro: Condition = (env) => FUSHIGURO.includes(env.ctx.card(env.cause?.attackerCardId ?? "")?.name ?? "");
/** An ability of this card (by index) has not been used this turn (for 「每回合1次」 on a triggered ability that is not activated at every event). */
const notUsedThisTurn = (index: number): Condition => (env) => !!env.self && !(env.self.used ?? []).includes(index);
const markUsedThisTurn = (index: number): Step => run("本回合已发动", (env) => { if (env.self) env.self.used = [...(env.self.used ?? []), index]; });

export const JJK_1_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 虎杖 悠仁：【启动主要】[转为休息状态][每回合1次]此角色产生能量+●黄●。主要阶段结束时，将此角色退场。
  "UA02BT/JJK-1-001": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 虎杖 悠仁：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）
  //   Only a keyword line (the engine reads the keyword from the card data); listed so the card counts as automated.
  "UA02BT/JJK-1-002": [],

  // 狗巻 棘：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有放回手牌的场合，此角色放回手牌。
  "UA02BT/JJK-1-003": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // 狗巻 棘：【退场时】选择对方前线中最多1张角色，转为休息状态。
  "UA02BT/JJK-1-004": [onSidelined(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态" }), rest(chosen("target")))],

  // 狗巻 棘：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）
  //        【启动主要】[支付1AP][每回合1次]我方前线所有角色本回合中BP+1000。
  "UA02BT/JJK-1-005": [activateMain({ costs: [apCost(1)], once: true }, bp(ownFrontCharacters, 1000))],

  // 钉崎 野蔷薇：【启动主要】[前线中存在的场合][转为休息状态]选择对方前线中最多1张角色，转为休息状态。
  "UA02BT/JJK-1-007": [activateMain({ costs: [restSelf], condition: selfOnFront }, chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态" }), rest(chosen("target")))],

  // 钉崎 野蔷薇：【启动主要】[支付1AP][每回合1次]此角色本回合中获得【伤害②】（此角色攻击并给予对手直接伤害时，改为给予2点伤害）
  //            【突进】〈钉崎 野蔷薇〉转为活跃状态，并可以移动至前线。（the Raid is in the card data）
  //            【登场时】选择对方前线中最多1张角色，转为休息状态。该角色的下1次转为活跃状态无效。
  "UA02BT/JJK-1-008": [
    activateMain({ costs: [apCost(1)], once: true }, grant("self", "伤害2")),
    onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态（下一次转为活跃状态无效）" }), restAndFreeze("target"))
  ],

  // 五条 悟：对方场上存在蓝色或紫色的卡牌的场合，手牌中的此卡牌所需能量减少●黄×1●。（read as: 减少1）
  "UA02BT/JJK-1-009": [costChange({ energy: 1 }, opponentHasColor("blue", "purple"))],

  // 五条 悟：【登场时】选择对方场上最多1张场地，将其置于对方卡组最下方。
  "UA02BT/JJK-1-010": [onPlay(chooseOpponentSite("site", "选择对方场上最多 1 张场地，置于对方卡组最下方"), { do: "toDeckBottom", target: chosen("site") })],

  // 五条 悟：【2次阻挡】（当此角色在本回合中首次进行阻挡时，转为活跃状态）
  //        【对方的回合中】当对方角色的效果或事件卡牌的效果选择此角色时，不追加支付1AP则无法选择此角色。
  "UA02BT/JJK-1-011": [staticSelf({ flags: ["taxAp:character", "taxAp:event"] }, duringOpponentTurn)],

  // 五条 悟：【冲击①】（当在进行攻击的战斗中胜利时，给与对方玩家1点伤害）
  //        【登场时】抽取1张卡牌。本回合中，下一张从手牌中使用的〈五条 悟〉以外的卡牌的消费AP-1。
  "UA02BT/JJK-1-012": [onPlay(draw(1), run("本回合中，下一张从手牌中使用的〈五条 悟〉以外的卡牌的消费AP-1", (env) => {
    env.game.nextUseExcept = [...(env.game.nextUseExcept ?? []), { turn: env.game.turn, ownerId: env.owner.accountId, exceptName: env.ctx.card(env.selfCardId)?.name ?? "五条 悟", ap: 1, spent: false }];
  }))],

  // 禅院 真希：此角色处于活跃状态的场合，此角色产生能量+●黄●。
  "UA02BT/JJK-1-014": [staticSelf({ energy: 1 }, selfActive)],

  // 熊猫：【撤步】（可以在我方的移动阶段中从前线移动至能量线）  (keyword line only)
  "UA02BT/JJK-1-015": [],

  // 熊猫：【撤步】（可以在我方的移动阶段中从前线移动至能量线）  (keyword line only)
  "UA02BT/JJK-1-016": [],

  // 熊猫：【撤步】【突进】〈熊猫〉转为活跃状态，并可以移动至前线。【2次阻挡】【冲击①】（keywords and Raid are in the card data）
  //     此角色BP+1000。
  "UA02BT/JJK-1-017": [staticSelf({ bp: 1000 })],

  // 伏黑 津美纪：【登场时】选择我方场上最多1张其他角色，本回合中，BP+1000。
  "UA02BT/JJK-1-018": [onPlay(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 伏黑 惠：【登场时】确认我方卡组最上方的5张卡牌。公开其中最多1张［特徴：式神］并加入手牌。剩余的卡牌自选顺序置于卡组最下方。
  "UA02BT/JJK-1-020": [onPlay(look(5), chooseLooked("pick", { max: 1, filter: withAffinity("式神"), prompt: "公开最多 1 张“特征：式神”的卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom())],

  // 伏黑 惠：【登场时】从我方手牌或场外将最多1张1张所需能量不高于3且消费AP为1并拥有「式神」特征的卡牌以活跃状态登场。（"1张1张" read as 最多1张）
  "UA02BT/JJK-1-021": [onPlay(
    ...handOrSideline("card", shikigamiInHand(3), shikigamiInSideline(3), "所需能量不高于 3、消费 AP 为 1 的“式神”（以活跃状态登场）"),
    ifThen(chosenCount("card"), [put("card", "choose", false)]))],

  // 伏黑 惠：【突进】〈伏黑 惠〉转为活跃状态，并可以移动至前线。（the Raid is in the card data）
  //        【登场时】确认我方卡组最上方的5张卡牌。公开其中最多1张［特征：式神］或〈嵌合暗翳庭〉并加入手牌。剩余的卡牌自选顺序置于卡组最下方。
  //        从我方手牌将最多1张满足所需能量且消费AP为1并拥有「式神」特征的卡牌以休息状态登场。
  "UA02BT/JJK-1-022": [onPlay(
    look(5), chooseLooked("pick", { max: 1, filter: either(withAffinity("式神"), named("嵌合暗翳庭")), prompt: "公开最多 1 张“特征：式神”或〈嵌合暗翳庭〉并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(),
    chooseFromHand("card", { max: 1, filter: and(isCharacterCard, withAffinity("式神"), apCostIs(1), affordable), prompt: "从手牌选择最多 1 张满足所需能量、消费 AP 为 1 的“式神”，以休息状态登场" }),
    ifThen(chosenCount("card"), [put("card", "choose", true)]))],

  // 玉犬:黑&白：【攻击时】选择我方场上最多1张其他角色，本回合中，BP+500。
  "UA02BT/JJK-1-024": [onAttack(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+500）" }), bp(chosen("target"), 500))],

  // 玉犬:浑：我方场外有〈玉犬：黑＆白〉的场合，此角色获得【伤害②】（此角色攻击并给予对手直接伤害时，改为给予2点伤害）
  "UA02BT/JJK-1-025": [staticSelf({ keywords: ["伤害2"] }, (env) => env.owner.sideline.some((cardId) => env.ctx.card(cardId)?.name === DIVINE_DOGS))],

  // 鵺：【攻击时】抽取1张卡牌，将我方1的张手牌置于场外。（"1的张" read as 1张）
  "UA02BT/JJK-1-026": [onAttack(draw(1), discard(1))],

  // 嵌合暗翳庭（场地）：【启动主要】[支付1AP][每回合1次]我方场上的所有［特征：式神］本回合中BP+1000。
  //                  [每回合1次]我方场上的〈伏黑 恵〉攻击时，选择我方前线中最多1张［特征：式神］转为活跃状态。
  "UA02BT/JJK-1-027": [
    activateMain({ costs: [apCost(1)], once: true }, bp(ownShikigami, 1000)),
    withCondition(when(["onOwnAttack"], markUsedThisTurn(1),
      chooseOwn("target", { line: "front", max: 1, filter: withAffinity("式神"), prompt: "选择我方前线中最多 1 张“特征：式神”转为活跃状态" }), activate(chosen("target"))),
    (env) => attackerIsFushiguro(env) && notUsedThisTurn(1)(env))
  ],

  // 无量空处（场地）：【登场时】选择对方前线中最多1张角色，转为休息状态。只要我方场上存在此场地，那个角色在起始阶段和结束阶段中不会转为活跃状态。
  //                每个攻击阶段结束时，我方前线中不存在〈五条 悟〉的场合，此场地退场。
  "UA02BT/JJK-1-028": [
    onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态（此场地在场上时，起始阶段和结束阶段中不会转为活跃状态）" }), ifThen(chosenCount("target"), [
      rest(chosen("target")),
      run("只要我方场上存在此场地，那个角色在起始阶段和结束阶段中不会转为活跃状态", (env) => {
        if (!env.self) return;
        for (const card of chosenCards(env, "target")) card.lasting = [...(card.lasting ?? []), { bp: 0, keyword: null, flag: frozenBy(env.self.uid), untilTurnOf: "site" }];
      })])),
    staticAura((env, card) => !!env.self && (card.lasting ?? []).some((entry) => entry.flag === frozenBy(env.self!.uid)), { flags: ["noStartActivate", "stayRested"] }),
    withCondition(when(["onEveryAttackPhaseEnd"], sideline("self")), (env) => !env.owner.front.some((card) => env.ctx.card(card.cardId)?.name === "五条 悟"))
  ],

  // 虚式「茈」（事件）：我方场上存在〈五条 悟〉的场合，手牌中此卡牌的消费AP-1。选择对方前线中的1张角色，将其置于移除区。
  "UA02BT/JJK-1-029": [
    costChange({ ap: 1 }, youHaveNamed("五条 悟")),
    onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色置于移除区" }), remove(chosen("target")))
  ],

  // 术式反转「赫」（事件）：选择对方前线中的1张BP不高于4000的角色，将其移动至能量线。（移动时能量线中没有空位的场合，那个玩家选择1张卡牌置于除外区后再进行移动）
  "UA02BT/JJK-1-030": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(4000), prompt: "选择对方前线中 1 张 BP 不高于 4000 的角色移动至能量线" }),
    ifThen(chosenCount("target"), [moveLine(chosen("target"))]))],

  // 刍灵咒法「簪」（事件）：选择对方前线中的1张休息状态的角色退场。
  "UA02BT/JJK-1-031": [onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, filter: restedCard, prompt: "选择对方前线中 1 张休息状态的角色退场" }), sideline(chosen("target")))],

  // 刍灵咒法「共鸣」（事件）：选择我方前线中的处于活跃状态的角色和对方前线中的角色各1张，转为休息状态。我方场上存在〈钉崎 野蔷薇〉的场合，选择我方的最多1张AP卡牌转为活跃状态。
  "UA02BT/JJK-1-032": [onUse(
    chooseOwn("mine", { line: "front", min: 1, max: 1, filter: activeCard, prompt: "选择我方前线中 1 张活跃状态的角色转为休息状态" }),
    chooseOpponent("theirs", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色转为休息状态" }),
    rest(chosen("mine")), rest(chosen("theirs")),
    ifThen(youHaveNamed("钉崎 野蔷薇"), [chooseAp("ap", 1), activateAp("ap")]))],

  // 十种影法术（事件）：抽取1张卡牌。从我方手牌或场外将最多1张所需能量不高于3且消费AP为1并拥有「式神」特征的卡牌在我方前线中『以休息状态登场』。我方场上存在〈伏黑 恵〉的场合，改为『以活跃状态登场』。
  "UA02BT/JJK-1-033": [onUse(
    draw(1),
    ...handOrSideline("card", shikigamiInHand(3), shikigamiInSideline(3), "所需能量不高于 3、消费 AP 为 1 的“式神”（在前线登场）"),
    ifThen(chosenCount("card"), [ifThen(youHaveFushiguro, [put("card", "front", false)], [put("card", "front", true)])]))],

  // 领域展开（事件）：选择我方的最多2张AP卡牌转为活跃状态。
  "UA02BT/JJK-1-034": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 家入 硝子：对方场上有黄色或紫色的卡牌的场合，手牌中的此卡牌所需能量减少●蓝×1●。（read as: 减少1）
  "UA02BT/JJK-1-035": [costChange({ energy: 1 }, opponentHasColor("yellow", "purple"))]
};
