/** Abilities of the EVA cards, batch 1 (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { costOf, energyOf, flagsOf, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, bpAtMost, bp, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn,
  chosen, chosenCount, costChange, discard, discardCost, draw, duringOpponentTurn, duringYourTurn, energyCostAtMost, energyThisTurn, givenOnly, grant, grantAbility,
  ifThen, isCharacterCard, look, lookedToBottom, may, moveChosen, moveLine, named, notNamed, notSelf, ofColor, onAttack, onPlay, onUse, opponentHasColor, put, rest,
  restSelf, run, selfActive, selfOnEnergy, selfOnFront, sideline, sidelineSelf, staticSelf, toHand, when, withCondition, youHaveNamed
} from "./dsl.ts";

// ---- Helpers for these cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const handNotEmpty: Condition = (env) => env.owner.hand.length > 0;
const hasActiveAp: Condition = (env) => env.owner.ap.some((card) => !card.rested);
const cardName = (env: AbilityEnv, card: UnionArenaFieldCard): string | undefined => env.ctx.card(card.cardId)?.name;

/** 获得“当主要阶段结束时，将此角色退场” (given with grantAbility). */
const sidelineAtMainEnd = givenOnly(when(["onMainEnd"], sideline("self")));

/** 拥有【获得】的卡牌 (the trigger [获得]: 此卡牌加入手牌; the Raid trigger is a different one). */
const hasObtainTrigger: CardFilter = (env, cardId) => env.ctx.card(cardId)?.trigger?.label === "获得";
/** 本回合中我方的场上登场了拥有【获得】的角色 */
const obtainCharacterEnteredThisTurn: Condition = (env) =>
  (env.game.entered ?? []).some((entry) => entry.turn === env.game.turn && entry.ownerId === env.owner.accountId && env.ctx.card(entry.cardId)?.type === "character" && hasObtainTrigger(env, entry.cardId, null));

/** The chosen field cards are no longer on the field (通过此效果退场). */
const chosenGone = (name: string): Condition => (env) => {
  const uids = env.vars[name] ?? [];
  return uids.length > 0 && uids.every((uid) => !env.players.some((player) => fieldOf(player).some((card) => card.uid === uid)));
};
/** The mode picked by chooseMode(name, ...) is the index-th. */
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;
/** The chosen field card is named `cardNameWanted`. */
const chosenIsNamed = (name: string, cardNameWanted: string): Condition => (env) => {
  const uid = env.vars[name]?.[0];
  const card = uid ? env.players.flatMap(fieldOf).find((entry) => entry.uid === uid) : undefined;
  return !!card && cardName(env, card) === cardNameWanted;
};
/** The chosen field card has no Raid ([突进]). */
const chosenHasNoRaid = (name: string): Condition => (env) => {
  const uid = env.vars[name]?.[0];
  const card = uid ? env.players.flatMap(fieldOf).find((entry) => entry.uid === uid) : undefined;
  return !!card && !env.ctx.card(card.cardId)?.raid;
};
/** Another character of ours is on the field. */
const hasOtherOwnCharacter: Condition = (env) => fieldOf(env.owner).some((card) => card.uid !== env.self?.uid && isCharacter(env, card));

/** "<text>的此效果1回合只能发动1次": a mark on the game for this turn, per player. */
const turnMark = (env: AbilityEnv, text: string): string => `${env.game.turn}:${env.owner.accountId}:${text}`;
const notMarkedThisTurn = (text: string): Condition => (env) => !(env.game.turnMarks ?? []).includes(turnMark(env, text));
const markThisTurn = (text: string) => (env: AbilityEnv): void => { env.game.turnMarks = [...(env.game.turnMarks ?? []), turnMark(env, text)]; };

/** 剩余的卡牌自选顺序置于我方卡组的最上方 (the first card picked ends up on top). */
const lookedToTop = (): Step[] => [
  { do: "choose", as: "top", from: "looked", side: "you", all: true, min: 0, max: 99, prompt: "依次点选剩余的卡，按点选顺序放到卡组最上方（先点的在最上面）", good: true },
  run("剩余的卡牌按选择的顺序置于卡组最上方", (env) => {
    const looking = env.game.looking;
    if (!looking) return;
    const keys = env.vars.top ?? [];
    const cards = keys.map((key) => looking.cards[Number(key.slice(2))]).filter((cardId): cardId is string => !!cardId);
    looking.cards = looking.cards.filter((_, index) => !keys.includes(`l:${index}`));
    env.owner.library.unshift(...cards);
  })
];

/** 将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。 */
const returnCost1OrSelf: Step[] = [
  chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
  toHand(chosen("target")),
  ifThen((env) => (env.vars.target ?? []).length === 0, [toHand("self")])
];

/** 本回合中，下一张将要从手牌中使用的所需能量不高于2的黄色的角色卡牌的消费AP-1。 */
const nextCheapYellowCheaper = run("本回合中，下一张从手牌使用的所需能量不高于 2 的黄色角色卡牌消费 AP-1", (env) => {
  env.game.nextPlayCheap = [...(env.game.nextPlayCheap ?? []), { turn: env.game.turn, ownerId: env.owner.accountId, maxEnergy: 2, color: "yellow", ap: 1, spent: false }];
});

/** 支付1AP (the first active AP card rests); `paid` is set when it was paid. */
const payOneAp = run("支付 1 AP", (env) => {
  const card = env.owner.ap.find((entry) => !entry.rested);
  if (card) card.rested = true;
});

/** 将我方场上的卡牌下方的最多1张背面朝上的卡牌置于场外 (EVA 碇 真嗣 030): the pile is chosen, the card taken from it is unseen anyway. */
const choosePileWithFaceDown: Step = {
  do: "choose", as: "pile", from: "field", side: "you", characters: false, min: 0, max: 1, good: true,
  filter: (_env, _cardId, card) => (card?.faceDown?.length ?? 0) > 0, prompt: "选择我方场上下方存在背面朝上卡牌的卡牌（将其下方的 1 张背面朝上的卡牌置于场外）"
};
const faceDownToSideline = run("将其下方的 1 张背面朝上的卡牌置于场外", (env) => {
  const uid = env.vars.pile?.[0];
  const card = uid ? fieldOf(env.owner).find((entry) => entry.uid === uid) : undefined;
  if (!card?.faceDown?.length) return;
  env.owner.sideline.push(card.faceDown[0]!);
  card.faceDown = card.faceDown.slice(1);
});

const faceDownCount = (env: AbilityEnv): number => env.self?.faceDown?.length ?? 0;
/** 我方的场上存在其他的所需能量为5或更高的卡牌 */
const otherOwnCostAtLeast5: Condition = (env) => fieldOf(env.owner).some((card) => card.uid !== env.self?.uid && (env.ctx.card(card.cardId)?.energyCost ?? 0) >= 5);

const AYANAMI = "绫波 零";
const SHIKINAMI = "式波·明日香·兰格雷";
const MARI = "真希波·真理·伊拉丝多莉亚斯";
const SHINJI = "碇 真嗣";

export const EVA_1_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 绫波 零：【启动主要】[转为休息状态][每回合1次]此角色在本回合中，获得产生能量+[黄]和“当主要阶段结束时，将此角色退场”。
  "UC03BT/EVA-1-001": [activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)), sidelineAtMainEnd],

  // 绫波 零：《冲击无效》
  //        【对方的回合中】此角色无法移动，无法放回手牌，不会受到BP降低的效果影响。
  "UC03BT/EVA-1-002": [staticSelf({ flags: ["cannotMove", "cannotToHand", "noBpDown"] }, duringOpponentTurn)],

  // 绫波 零：【我方的回合中】本回合中我方的场上登场了拥有【获得】的角色的场合，此角色BP+1000。
  "UC03BT/EVA-1-003": [staticSelf({ bp: 1000 }, all(duringYourTurn, obtainCharacterEnteredThisTurn))],

  // 绫波 零：《冲击无效》
  //        【登场时】选择我方场上的最多1张角色，本回合中，BP+1000。
  "UC03BT/EVA-1-004": [onPlay(chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 绫波 零：当此角色通过我方或对方的效果或因战斗离开场上时，可以将我方的1张手牌置于场外。这样做的场合，从我方的场外将最多1张所需能量不高于2的黄色的〈绫波 零〉在我方的场上以活跃状态登场。
  "UC03BT/EVA-1-005": [withCondition(
    when(["onLeaveField"], may("将 1 张手牌置于场外，从场外将〈绫波 零〉以活跃状态登场？", discard(1),
      chooseFromSideline("card", { max: 1, filter: and(isCharacterCard, ofColor("yellow"), named(AYANAMI), energyCostAtMost(2)), prompt: "从场外选择最多 1 张所需能量不高于 2 的黄色〈绫波 零〉以活跃状态登场" }),
      ifThen(chosenCount("card"), [put("card", "choose", false)]))),
    all(handNotEmpty, (env) => (env.cause?.kind === "battle" || env.cause?.kind === "effect") && !env.cause.cost)
  )],

  // 葛城 美里：【启动主要】[转为休息状态] ＃将此卡牌退场＃选择我方场上的1张黄色的角色，转为活跃状态。
  "UC03BT/EVA-1-006": [activateMain({ costs: [restSelf, sidelineSelf] },
    chooseOwn("target", { min: 1, max: 1, filter: ofColor("yellow"), prompt: "选择我方场上 1 张黄色的角色转为活跃状态" }), activate(chosen("target")))],

  // 葛城 美里：此角色处于活跃状态的场合，此角色的产生能量+[黄]。
  "UC03BT/EVA-1-007": [staticSelf({ energy: 1 }, selfActive)],

  // 葛城 美里：【对方的回合中】我方将要发动满足所需能量的角色卡牌的【获得】的场合，可以改为将该卡牌在我方的场上以休息状态登场。这样做的场合，将我方的1张手牌置于场外。〈葛城 美里〉的此效果1回合只能发动1次。
  "UC03BT/EVA-1-008": [{
    kind: "replaceTrigger",
    condition: (env, trigger) => {
      const stats = env.ctx.card(trigger.cardId);
      return duringOpponentTurn(env) && trigger.label === "获得" && stats?.type === "character" && notMarkedThisTurn("葛城 美里")(env)
        && energyOf(env.ctx, env.owner, stats.color) >= costOf(env.game, env.players, env.ctx, env.owner.accountId, trigger.cardId).energy;
    },
    prompt: "改为将该卡牌以休息状态登场？（这样做的场合，将 1 张手牌置于场外）",
    steps: [
      run("〈葛城 美里〉的此效果本回合已发动", markThisTurn("葛城 美里")),
      chooseLooked("card", { min: 1, max: 1, prompt: "该卡牌" }),
      put("card", "choose", true),
      discard(1)
    ]
  }],

  // 式波·明日香·兰格雷：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-009": [onPlay(draw(1), discard(1))],

  // 式波·明日香·兰格雷：【登场时】选择我方场上的最多1张角色，本回合中，给予【冲击①】（当在进行攻击的战斗中胜利时，给予对方玩家1点伤害）。
  "UC03BT/EVA-1-010": [onPlay(chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合给予《冲击1》）" }), grant(chosen("target"), "冲击1"))],

  // 式波·明日香·兰格雷：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。
  "UC03BT/EVA-1-011": [onPlay(...returnCost1OrSelf)],

  // 式波·明日香·兰格雷：【登场时】可以将我方场上的1张其他角色退场。这样做的场合，从下列选择1项。
  //                    ・抽取2张卡牌。
  //                    ・抽取1张卡牌，选择我方场上的最多1张角色，转为活跃状态。
  "UC03BT/EVA-1-012": [withCondition(onPlay(may("将我方场上的 1 张其他角色退场？",
    chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色退场" }), sideline(chosen("target")),
    ifThen(chosenGone("target"), [
      chooseMode("mode", ["抽取2张卡牌。", "抽取1张卡牌，选择我方场上的最多1张角色，转为活跃状态。"]),
      ifThen(modeIs("mode", 0), [draw(2)], [draw(1), chooseOwn("active", { max: 1, prompt: "选择我方场上最多 1 张角色转为活跃状态" }), activate(chosen("active"))])
    ]))), hasOtherOwnCharacter)],

  // 式波·明日香·兰格雷：【登场时】将此角色转为活跃状态，从下列选择1项。
  //                    ・选择对方前线中的最多1张角色，转为休息状态。
  //                    ・我方的回合中的场合，可以将我方场上的1张角色退场。这样做的场合，选择对方前线中的最多1张BP不高于5000的角色退场，本回合中，下一张将要从手牌中使用的所需能量不高于2的黄色的角色卡牌的消费AP-1。
  //                    【启动主要】[将2张手牌置于场外][每回合1次]此角色在本回合中，获得BP+1000和【冲击①】。
  "UC03BT/EVA-1-013": [
    onPlay(
      activate("self"),
      chooseMode("mode", ["选择对方前线中的最多1张角色，转为休息状态。", "我方的回合中的场合，可以将我方场上的1张角色退场。这样做的场合，选择对方前线中的最多1张BP不高于5000的角色退场，本回合中，下一张将要从手牌中使用的所需能量不高于2的黄色的角色卡牌的消费AP-1。"]),
      ifThen(modeIs("mode", 0), [chooseOpponent("rested", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态" }), rest(chosen("rested"))]),
      ifThen(all(modeIs("mode", 1), duringYourTurn), [may("将我方场上的 1 张角色退场？",
        chooseOwn("cost", { min: 1, max: 1, prompt: "选择我方场上 1 张角色退场" }), sideline(chosen("cost")),
        ifThen(chosenGone("cost"), [
          chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中最多 1 张 BP 不高于 5000 的角色退场" }), sideline(chosen("target")),
          nextCheapYellowCheaper
        ]))])
    ),
    activateMain({ costs: [discardCost(2)], once: true }, bp("self", 1000), grant("self", "冲击1"))
  ],

  // 真希波·真理·伊拉丝多莉亚斯：对方的场上存在紫色或红色卡牌的场合，手牌中此卡牌的所需能量减少[黄×1]。
  "UC03BT/EVA-1-015": [costChange({ energy: 1 }, opponentHasColor("purple", "red"))],

  // 真希波·真理·伊拉丝多莉亚斯：【撤步】（可以在我方的移动阶段中从前线移动至能量线）（只有关键字，没有其它能力文本；卡牌数据里关键字用【】印刷，所以要有一条空记录才算全自动）
  "UC03BT/EVA-1-016": [],

  // 真希波·真理·伊拉丝多莉亚斯：【登场时】确认我方卡组最上方的4张卡牌。公开其中最多1张拥有【获得】的角色卡牌并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-017": [onPlay(look(4), chooseLooked("pick", { max: 1, filter: and(isCharacterCard, hasObtainTrigger), prompt: "公开最多 1 张拥有【获得】的角色卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // 真希波·真理·伊拉丝多莉亚斯：【对方的回合中】[前线中存在的场合]我方将要发动【抽卡】或【激活】的场合，可以改为【获得】。
  //                          【攻击时】可以支付1AP。这样做的场合，抽取1张卡牌。选择我方场上的最多1张〈真希波·真理·伊拉丝多莉亚斯〉以外的角色，转为活跃状态。
  "UC03BT/EVA-1-018": [
    {
      kind: "replaceTrigger",
      condition: (env, trigger) => duringOpponentTurn(env) && selfOnFront(env) && (trigger.label === "抽卡" || trigger.label === "激活"),
      prompt: "改为【获得】（此卡牌加入手牌）？",
      as: "获得"
    },
    withCondition(onAttack(may("支付 1 AP：抽取 1 张卡牌，并选择最多 1 张其他角色转为活跃状态？", payOneAp, draw(1),
      chooseOwn("target", { max: 1, filter: notNamed(MARI), prompt: "选择我方场上最多 1 张〈真希波·真理·伊拉丝多莉亚斯〉以外的角色转为活跃状态" }), activate(chosen("target")))), hasActiveAp)
  ],

  // 第3新东京市立第一中学：【登场时】可以将我方的1张手牌置于场外。这样做的场合，从我方的场外将最多1张所需能量不高于3的黄色的角色卡牌加入手牌。
  "UC03BT/EVA-1-019": [withCondition(onPlay(may("将 1 张手牌置于场外，从场外将 1 张黄色角色卡牌加入手牌？", discard(1),
    chooseFromSideline("card", { max: 1, filter: and(isCharacterCard, ofColor("yellow"), energyCostAtMost(3)), prompt: "从场外选择最多 1 张所需能量不高于 3 的黄色角色卡牌加入手牌" }), moveChosen("card", "hand"))), handNotEmpty)],

  // 你是笨蛋吗？：选择对方前线中的1张『BP不高于3000』的角色退场。我方的场上存在〈式波·明日香·兰格雷〉的场合，改为『BP不高于5000』。
  "UC03BT/EVA-1-020": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (youHaveNamed(SHIKINAMI)(env) ? 5000 : 3000)), prompt: "选择对方前线中 1 张 BP 不高于 3000 的角色退场（我方有〈式波·明日香·兰格雷〉时：5000）" }),
    sideline(chosen("target"))
  )],

  // 和碇在一起的时候就感觉很温暖：选择我方场上的1张角色，转为活跃状态。选择的角色为〈绫波 零〉的场合，选择我方的最多1张AP卡牌，转为活跃状态。我方的场上存在黄色以外的〈碇 真嗣〉的场合，抽取1张卡牌。
  "UC03BT/EVA-1-021": [onUse(
    chooseOwn("target", { min: 1, max: 1, prompt: "选择我方场上 1 张角色转为活跃状态" }), activate(chosen("target")),
    ifThen(chosenIsNamed("target", AYANAMI), [chooseAp("ap", 1), activateAp("ap")]),
    ifThen((env) => fieldOf(env.owner).some((card) => cardName(env, card) === SHINJI && env.ctx.card(card.cardId)?.color !== "yellow"), [draw(1)])
  )],

  // 你挺有趣的嘛：选择对方前线中的1张角色，转为休息状态。选择的角色没有【突进】的场合，抽取1张卡牌。
  "UC03BT/EVA-1-022": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色转为休息状态" }), rest(chosen("target")),
    ifThen(chosenHasNoRaid("target"), [draw(1)])
  )],

  // 洗澡可是对生命的洗涤哟：选择我方的最多2张AP卡牌，转为活跃状态。
  "UC03BT/EVA-1-023": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 绫波零（暂称）：【登场时】确认我方卡组最上方的1张卡牌。将其置于我方卡组的最上方或场外。
  "UC03BT/EVA-1-025": [onPlay(look(1), chooseLooked("out", { max: 1, prompt: "选择将其置于场外（不选则置于卡组最上方）" }), moveChosen("out", "sideline"), ...lookedToTop())],

  // 绫波零（暂称）：我方的回合开始时，此角色下方存在3张或更多的背面朝上的卡牌的场合，将此角色退场。
  //              【我方的回合中】此角色下方的背面朝上的卡牌每有1张，此角色BP+500。
  //              【攻击时】将我方卡组最上方的1张卡牌背面朝上置于此角色的下方。
  "UC03BT/EVA-1-026": [
    // “回合开始时”按主要阶段开始时处理（起始阶段和移动阶段里没有会改变结果的操作）。
    withCondition(when(["onMainStart"], sideline("self")), (env) => faceDownCount(env) >= 3),
    staticSelf({ bp: (env) => 500 * faceDownCount(env) }, duringYourTurn),
    onAttack(run("将卡组最上方的 1 张卡牌背面朝上置于此角色下方", (env) => { if (env.self) env.self.faceDown = [...(env.self.faceDown ?? []), ...env.owner.library.splice(0, 1)]; }))
  ],

  // 碇 真嗣：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-027": [onPlay(draw(1), discard(1))],

  // 碇 真嗣：【启动主要】[转为休息状态]将我方卡组最上方的1张卡牌置于场外。
  "UC03BT/EVA-1-028": [activateMain({ costs: [restSelf] }, run("将卡组最上方的 1 张卡牌置于场外", (env) => { const top = env.owner.library.shift(); if (top) env.owner.sideline.push(top); }))],

  // 碇 真嗣：此角色处于活跃状态的场合，此角色的产生能量+[紫]。
  "UC03BT/EVA-1-029": [staticSelf({ energy: 1 }, selfActive)],

  // 碇 真嗣：《冲击无效》
  //        【登场时】将我方场上的卡牌下方的最多1张背面朝上的卡牌置于场外。
  //        【启动主要】＃能量线中存在的场合＃将此角色移动至前线。
  "UC03BT/EVA-1-030": [
    onPlay(choosePileWithFaceDown, faceDownToSideline),
    activateMain({ condition: all(selfOnEnergy, (env) => !!env.self && !flagsOf(env.self).includes("cannotMove")) }, moveLine("self"))
  ],

  // 碇 真嗣：手牌中与场外存在的此卡牌的所需能量减少[紫×2]。（场外存在时的减少没有处理：只有从场外选择“所需能量为N”的效果会用到）
  //        《冲击无效》
  //        【我方的回合中】我方的场上存在其他的所需能量为5或更高的卡牌的场合，此角色BP+1000。
  "UC03BT/EVA-1-031": [costChange({ energy: 2 }), staticSelf({ bp: 1000 }, all(duringYourTurn, otherOwnCostAtLeast5))]
};
