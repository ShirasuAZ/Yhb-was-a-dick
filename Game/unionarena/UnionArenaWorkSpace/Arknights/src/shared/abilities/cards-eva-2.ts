/** Abilities of the EVA cards, batch 2 (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, costOf, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, activeCard, all, and, bp, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn,
  chosen, chosenCount, costChange, discard, draw, duringYourTurn, either, energyThisTurn, flag, givenOnly, grant, grantAbility, ifThen, isCharacterCard, look,
  lookedToBottom, may, moveChosen, named, notSelf, ofColor, onAttack, onPlay, onSidelined, onUse, apCostIs, opponentHasColor, put, rest, restSelf,
  run, selfOnEnergy, selfOnFront, sideline, sidelineSelf, staticSelf, toHand, when, withAffinity, withCondition
} from "./dsl.ts";

// ---- Helpers for these cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const handNotEmpty: Condition = (env) => env.owner.hand.length > 0;

const SHINJI = "碇 真嗣";
const NAGISA = "渚 薰";
const AYANAMI_TEMP = "绫波零（暂称）";
const EVA13 = "新世纪福音战士13号机";
const LILITH = "莉莉丝";

const wille = withAffinity("WILLE");
const isSiteCard: CardFilter = (env, cardId) => env.ctx.card(cardId)?.type === "site";
const hasNoRaid: CardFilter = (env, cardId) => !env.ctx.card(cardId)?.raid;
const restedCard: CardFilter = (_env, _cardId, card) => !!card && card.rested;
/** Required energy of a card in the hand now (with its own cost changes) / printed required energy of any card. */
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy <= limit;
/** Required energy of a card in the sideline: printed, less "手牌中与场外存在的此卡牌的所需能量减少[紫×N]" (碇 真嗣 031 costs 3 there). */
const sidelineCost = (env: AbilityEnv, cardId: string): number => {
  const stats = env.ctx.card(cardId);
  const cut = stats?.abilityText.match(/手牌中与场外存在的此卡牌的所需能量减少\[.×(\d+)\]/);
  return (stats?.energyCost ?? 99) - Number(cut?.[1] ?? 0);
};
const sidelineCostAtMost = (limit: number): CardFilter => (env, cardId) => sidelineCost(env, cardId) <= limit;
const printedCostAtLeast = (limit: number): CardFilter => (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 0) >= limit;

/** 获得“当主要阶段结束时，将此角色退场” (given with grantAbility). */
const sidelineAtMainEnd = givenOnly(when(["onMainEnd"], sideline("self")));

/** A field card (either side) by uid. */
const fieldCardByUid = (env: AbilityEnv, uid: string | undefined): UnionArenaFieldCard | undefined => (uid ? [...fieldOf(env.owner), ...fieldOf(env.opponent)].find((card) => card.uid === uid) : undefined);
const chosenCard = (env: AbilityEnv, name: string): UnionArenaFieldCard | undefined => fieldCardByUid(env, env.vars[name]?.[0]);

/** The chosen field cards are no longer on the field (通过此效果退场). */
const chosenGone = (name: string): Condition => (env) => {
  const uids = env.vars[name] ?? [];
  return uids.length > 0 && uids.every((uid) => !fieldCardByUid(env, uid));
};
/** The chosen field card is resting now (转为休息状态 worked) / active now (转为活跃状态 worked). */
const chosenRested = (name: string): Condition => (env) => !!chosenCard(env, name)?.rested;
const chosenActive = (name: string): Condition => (env) => { const card = chosenCard(env, name); return !!card && !card.rested; };
/** The chosen opponent card's BP is 0 or less now (通过此效果将对方的角色的BP变为0或更低). */
const chosenBpZero: (name: string) => Condition = (name) => (env) => { const card = chosenCard(env, name); return !!card && bpOf(env.ctx, card) <= 0; };
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;

/** "<text>的此效果1回合只能发动1次": a mark on the game for this turn, per player. */
const turnMark = (env: AbilityEnv, text: string): string => `${env.game.turn}:${env.owner.accountId}:${text}`;
const notMarkedThisTurn = (text: string): Condition => (env) => !(env.game.turnMarks ?? []).includes(turnMark(env, text));
const markThisTurn = (text: string) => (env: AbilityEnv): void => { env.game.turnMarks = [...(env.game.turnMarks ?? []), turnMark(env, text)]; };

const faceDownCount = (env: AbilityEnv): number => env.self?.faceDown?.length ?? 0;
const sidelineAtLeast = (count: number): Condition => (env) => env.owner.sideline.length >= count;
/** 此角色登场的回合中 (this very field card came onto the field this turn). */
const enteredThisTurn: Condition = (env) => !!env.self && (env.game.entered ?? []).some((entry) => entry.turn === env.game.turn && entry.ownerId === env.owner.accountId && entry.uid === env.self!.uid);

/** 将我方场上的卡牌下方的1张背面朝上的卡牌置于场外 (EVA 13号机 034): the pile is chosen, the card taken from it is unseen anyway. */
const choosePileWithFaceDown: Step = {
  do: "choose", as: "pile", from: "field", side: "you", characters: false, min: 1, max: 1, good: true,
  filter: (_env, _cardId, card) => (card?.faceDown?.length ?? 0) > 0, prompt: "选择我方场上下方存在背面朝上卡牌的卡牌（将其下方的 1 张背面朝上的卡牌置于场外）"
};
const faceDownToSideline = run("将其下方的 1 张背面朝上的卡牌置于场外", (env) => {
  const card = chosenCard(env, "pile");
  if (!card?.faceDown?.length) return;
  env.owner.sideline.push(card.faceDown[0]!);
  card.faceDown = card.faceDown.slice(1);
});

/** 将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。 */
const returnCost1OrSelf: Step[] = [
  chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= 1), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
  toHand(chosen("target")),
  ifThen((env) => !chosenGone("target")(env), [toHand("self")])
];

/** 初号机（盖乌斯之枪）033's 【登场时】, which its 【启动主要】 triggers again. */
const gaiusPlay: Step[] = [
  draw(1),
  chooseFromHand("card", { max: 1, filter: and(isCharacterCard, ofColor("purple"), apCostIs(1), hasNoRaid), prompt: "从手牌选择最多 1 张消费 AP 为 1 的没有【突进】的紫色角色卡牌，以活跃状态登场" }),
  ifThen(chosenCount("card"), [put("card", "choose", false)])
];

/** 确认卡组最上方的N张卡牌。公开其中最多1张(filter)并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将我方的1张手牌置于场外。 */
const lookPickDiscard = (count: number, filter: CardFilter, prompt: string): Step[] => [
  look(count), chooseLooked("pick", { max: 1, filter, prompt }), moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)])
];

/** 〈碇 源堂〉032's cards: a purple 〈绫波零（暂称）〉, 〈渚 薰〉 or site. */
const gendoTarget: CardFilter = and(ofColor("purple"), either(named(AYANAMI_TEMP), named(NAGISA), isSiteCard));

export const EVA_2_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 碇 源堂：【登场时】从我方的手牌或场外将最多1张所需能量不高于2的紫色的〔〈绫波零（暂称）〉或〈渚 薰〉或场地卡牌〕在我方的场上以休息状态登场。从场外登场的场合，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-032": [onPlay(
    chooseFromHand("hand", { max: 1, filter: and(gendoTarget, handCostAtMost(2)), prompt: "从手牌选择最多 1 张所需能量不高于 2 的紫色〈绫波零（暂称）〉〈渚 薰〉或场地卡牌，以休息状态登场" }),
    ifThen(chosenCount("hand"), [put("hand", "choose", true)], [
      chooseFromSideline("side", { max: 1, filter: and(gendoTarget, sidelineCostAtMost(2)), prompt: "从场外选择最多 1 张所需能量不高于 2 的紫色〈绫波零（暂称）〉〈渚 薰〉或场地卡牌，以休息状态登场" }),
      ifThen(chosenCount("side"), [put("side", "choose", true), discard(1)])
    ])
  )],

  // 新世纪福音战士初号机（盖乌斯之枪）：【突进】〈碇 真嗣〉转为活跃状态，并可以移动至前线
  //   【冲击①】（当在进行攻击的战斗中胜利时，给予对方玩家1点伤害）
  //   【登场时】抽取1张卡牌，从我方的手牌中将最多1张消费AP为1的没有【突进】的紫色的角色卡牌，在我方的场上以活跃状态登场。
  //   【启动主要】[前线中存在的场合] [每回合1次]选择我方前线中的1张其他角色退场。这样做的场合，发动此角色的【登场时】效果。
  "UC03BT/EVA-1-033": [
    onPlay(...gaiusPlay),
    activateMain({ condition: selfOnFront, once: true },
      chooseOwn("cost", { line: "front", min: 1, max: 1, filter: notSelf, prompt: "选择我方前线中的 1 张其他角色退场" }),
      sideline(chosen("cost")),
      ifThen(chosenGone("cost"), gaiusPlay))
  ],

  // 新世纪福音战士13号机：【突进】〈碇 真嗣〉/〈渚 薰〉转为活跃状态，并可以移动至前线
  //   【我方的回合中】根据我方场外存在的卡牌张数，此角色获得下列所有效果。
  //   ・13张或更多：BP+1000和【伤害②】
  //   ・26张或更多：BP+1000和【冲击④】
  //   【启动主要】[前线中存在的场合] [每回合1次]将我方场上的卡牌下方的1张背面朝上的卡牌置于场外。这样做的场合，抽取1张卡牌。
  "UC03BT/EVA-1-034": [
    staticSelf({ bp: 1000, keywords: ["伤害2"] }, all(duringYourTurn, sidelineAtLeast(13))),
    staticSelf({ bp: 1000, keywords: ["冲击4"] }, all(duringYourTurn, sidelineAtLeast(26))),
    activateMain({ condition: selfOnFront, once: true }, choosePileWithFaceDown, faceDownToSideline, ifThen(chosenCount("pile"), [draw(1)]))
  ],

  // EVANGELION Mark.06：【突进】〈渚 薰〉转为活跃状态，并可以移动至前线
  //   【登场时】抽取1张卡牌。选择我方或对方场上的1张卡牌，将该卡牌的下方存在的所有卡牌置于场外。
  "UC03BT/EVA-1-035": [onPlay(
    draw(1),
    {
      do: "choose", as: "pile", from: "field", side: "any", characters: false, min: 1, max: 1,
      filter: (_env, _cardId, card) => (card?.under.length ?? 0) + (card?.faceDown?.length ?? 0) > 0, prompt: "选择我方或对方场上下方存在卡牌的卡牌（将其下方的所有卡牌置于场外）"
    },
    run("将该卡牌的下方存在的所有卡牌置于场外", (env) => {
      const uid = env.vars.pile?.[0];
      const owner = [env.owner, env.opponent].find((player) => fieldOf(player).some((card) => card.uid === uid));
      const card = owner && fieldOf(owner).find((entry) => entry.uid === uid);
      if (!owner || !card) return;
      owner.sideline.push(...card.under, ...(card.faceDown ?? []));
      card.under = [];
      card.faceDown = [];
    })
  )],

  // EVANGELION Mark.09：【突进】〈绫波零（暂称）〉转为活跃状态，并可以移动至前线
  //   【我方的回合中】此角色BP+500。
  //   【登场时】抽取2张卡牌，将我方的2张手牌置于场外。
  //   【退场时】可以将我方的1张手牌置于场外。这样做的场合，将此卡牌在我方的场上以休息状态登场。
  "UC03BT/EVA-1-036": [
    staticSelf({ bp: 500 }, duringYourTurn),
    onPlay(draw(2), discard(2)),
    onSidelined(ifThen(handNotEmpty, [may("将 1 张手牌置于场外，将此卡牌以休息状态登场？",
      discard(1),
      run("找到场外的此卡牌", (env) => { const index = env.owner.sideline.lastIndexOf(env.selfCardId); if (index >= 0) env.vars.me = [`s:${index}`]; }),
      ifThen(chosenCount("me"), [put("me", "choose", true)]))]))
  ],

  // 渚 薰：【启动主要】[转为休息状态][每回合1次]此角色在本回合中，获得产生能量+[紫]和“当主要阶段结束时，将此角色退场”。
  "UC03BT/EVA-1-037": [activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)), sidelineAtMainEnd],

  // 渚 薰：【登场时】确认我方卡组最上方的4张卡牌。公开其中最多1张〈碇 真嗣〉或〈新世纪福音战士13号机〉或〈莉莉丝〉并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-038": [onPlay(...lookPickDiscard(4, either(named(SHINJI), named(EVA13), named(LILITH)), "公开最多 1 张〈碇 真嗣〉〈新世纪福音战士13号机〉〈莉莉丝〉并加入手牌"))],

  // 渚 薰：【启动主要】[转为休息状态]选择我方场上的1张其他角色，本回合中，BP+500。
  //       【启动主要】＃能量线中存在的场合＃选择我方能量线中的1张休息状态的〈碇 真嗣〉，转为活跃状态。这样做的场合，将此角色转为活跃状态。〈渚 薰〉的此效果1回合只能发动1次。
  "UC03BT/EVA-1-039": [
    activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色（本回合 BP+500）" }), bp(chosen("target"), 500)),
    activateMain({ condition: all(selfOnEnergy, notMarkedThisTurn("渚 薰:激活碇 真嗣")) },
      run("〈渚 薰〉的此效果本回合已发动", markThisTurn("渚 薰:激活碇 真嗣")),
      chooseOwn("shinji", { line: "energy", min: 1, max: 1, filter: and(named(SHINJI), restedCard), prompt: "选择我方能量线中 1 张休息状态的〈碇 真嗣〉转为活跃状态" }),
      activate(chosen("shinji")),
      ifThen(chosenActive("shinji"), [activate("self")]))
  ],

  // 赤木 律子：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。
  "UC03BT/EVA-1-040": [onPlay(...returnCost1OrSelf)],

  // 新世纪福音战士改2号机：【突进】〈式波·明日香·兰格雷〉转为活跃状态，并可以移动至前线
  //   当此角色退场的场合，可以改为将突进状态的最上方的此卡牌置于场外。
  //   【登场时】选择对方前线中的最多1张角色，本回合中，BP-1000。
  "UC03BT/EVA-1-041": [
    {
      kind: "replaceSideline",
      condition: (env, target) => !!env.self && target.uid === env.self.uid && target.under.length > 0,
      prompt: "可以改为将突进状态的最上方的此卡牌置于场外（角色留在场上）。",
      apply: (env, target) => {
        const below = target.under[target.under.length - 1]!;
        env.owner.sideline.push(target.cardId);
        target.under = target.under.slice(0, -1);
        target.cardId = below;
      }
    },
    onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-1000）" }), bp(chosen("target"), -1000))
  ],

  // 新世纪福音战士改8号机：【突进】〈真希波·真理·伊拉丝多莉亚斯〉转为活跃状态，并可以移动至前线
  //   此角色下方的背面朝上的卡牌每有1张，此角色BP+500。
  //   【登场时】抽取2张卡牌，将我方的1张手牌置于场外。
  //   【启动主要】[前线中存在的场合] [每回合1次]选择对方前线中的1张角色，本回合中，BP-1000。通过此效果将对方的角色的BP变为0或更低的场合，将我方卡组最上方的最多1张卡牌背面朝上置于此角色的下方。
  "UC03BT/EVA-1-042": [
    staticSelf({ bp: (env) => 500 * faceDownCount(env) }),
    onPlay(draw(2), discard(1)),
    activateMain({ condition: selfOnFront, once: true },
      chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色（本回合 BP-1000）" }),
      bp(chosen("target"), -1000),
      ifThen(chosenBpZero("target"), [may("将卡组最上方的 1 张卡牌背面朝上置于此角色的下方？",
        run("将卡组最上方的 1 张卡牌背面朝上置于此角色的下方", (env) => { if (env.self) env.self.faceDown = [...(env.self.faceDown ?? []), ...env.owner.library.splice(0, 1)]; }))]))
  ],

  // 新世纪福音战士新2号机：【突进】〈式波·明日香·兰格雷〉转为活跃状态，并可以移动至前线
  //   当此角色的攻击结束时，可以将我方场外的4张“特征：WILLE”置于移除区。这样做的场合，将此角色转为活跃状态，此角色在本回合中，获得BP+3000和“此角色不会被BP不高于3000的角色阻挡”，将此角色的突进元的卡牌置于场外。
  //   【登场时】对方的前线中存在2张或更多BP比原本的BP低的角色的场合，此角色在本回合中，获得【2次攻击】。
  "UC03BT/EVA-1-043": [
    withCondition(when(["onAttackEnd"], may("将场外的 4 张“特征：WILLE”置于移除区，将此角色转为活跃状态并获得 BP+3000？",
      chooseFromSideline("cost", { min: 4, max: 4, filter: wille, prompt: "选择场外的 4 张“特征：WILLE”置于移除区" }),
      moveChosen("cost", "removal"),
      activate("self"),
      bp("self", 3000),
      flag("self", "unblockableBpAtMost:3000"),
      run("将此角色的突进元的卡牌置于场外", (env) => { if (!env.self) return; env.owner.sideline.push(...env.self.under); env.self.under = []; }))),
      (env) => env.owner.sideline.filter((cardId) => env.ctx.card(cardId)?.affinities.includes("WILLE")).length >= 4),
    withCondition(onPlay(grant("self", "2次攻击")),
      (env) => env.opponent.front.filter((card) => isCharacter(env, card) && bpOf(env.ctx, card) < (env.ctx.card(card.cardId)?.bp ?? 0)).length >= 2)
  ],

  // 葛城 美里：【登场时】选择我方场上的最多1张其他角色，本回合中，BP+1000。
  "UC03BT/EVA-1-044": [onPlay(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 葛城 美里：【启动主要】[转为休息状态] ＃将此卡牌退场＃选择我方场上的最多1张所需能量为5或更高的紫色的角色，本回合中，给予【冲击①】或【伤害②】。
  "UC03BT/EVA-1-045": [activateMain({ costs: [restSelf, sidelineSelf] },
    chooseOwn("target", { max: 1, filter: and(ofColor("purple"), printedCostAtLeast(5)), prompt: "选择我方场上最多 1 张所需能量为 5 或更高的紫色角色" }),
    ifThen(chosenCount("target"), [
      chooseMode("mode", ["给予【冲击①】", "给予【伤害②】"]),
      ifThen(modeIs("mode", 0), [grant(chosen("target"), "冲击1")], [grant(chosen("target"), "伤害2")])
    ]))],

  // 葛城 美里：【启动主要】[转为休息状态]将我方手牌中的1张“特征：WILLE”置于场外。这样做的场合，抽取1张卡牌。
  "UC03BT/EVA-1-046": [activateMain({ costs: [restSelf] },
    chooseFromHand("card", { min: 1, max: 1, filter: wille, prompt: "将手牌中的 1 张“特征：WILLE”置于场外" }),
    moveChosen("card", "sideline"),
    ifThen(chosenCount("card"), [draw(1)]))],

  // 北上 绿：对方的场上存在黄色或红色卡牌的场合，手牌中此卡牌的所需能量减少[紫×1]。
  "UC03BT/EVA-1-047": [costChange({ energy: 1 }, opponentHasColor("yellow", "red"))],

  // 式波·明日香·兰格雷：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）
  //   (keyword line only: the keyword is already in the card data; the entry just lists the card)
  "UC03BT/EVA-1-049": [],

  // 式波·明日香·兰格雷：【启动主要】[前线中存在的场合][每回合1次]将我方手牌中的1张“特征：WILLE”置于场外。这样做的场合，选择对方前线中的最多1张角色，本回合中，BP-1000。
  "UC03BT/EVA-1-050": [activateMain({ condition: selfOnFront, once: true },
    chooseFromHand("card", { min: 1, max: 1, filter: wille, prompt: "将手牌中的 1 张“特征：WILLE”置于场外" }),
    moveChosen("card", "sideline"),
    ifThen(chosenCount("card"), [
      chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-1000）" }),
      bp(chosen("target"), -1000)
    ]))],

  // 式波·明日香·兰格雷：【我方的回合中】此角色BP+1000。
  //                    【登场时】抽取1张卡牌。
  "UC03BT/EVA-1-051": [staticSelf({ bp: 1000 }, duringYourTurn), onPlay(draw(1))],

  // 铃原 樱：【启动主要】[转为休息状态] ＃将此卡牌退场＃从我方的场外将1张〈碇 真嗣〉或“特征：WILLE”加入手牌。
  "UC03BT/EVA-1-052": [activateMain({ costs: [restSelf, sidelineSelf] },
    chooseFromSideline("card", { min: 1, max: 1, filter: either(named(SHINJI), wille), prompt: "从场外选择 1 张〈碇 真嗣〉或“特征：WILLE”加入手牌" }),
    moveChosen("card", "hand"))],

  // AAA Wunder：【突进】〈葛城 美里〉转为活跃状态，并可以移动至前线
  //   【登场时】此角色在本回合中，获得“对方必须尽可能的阻挡此角色的攻击”。
  //   【退场时】确认我方卡组最上方的5张卡牌。公开其中最多2张所需能量为5或更高的卡牌并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  "UC03BT/EVA-1-053": [
    onPlay(flag("self", "mustBeBlocked")),
    onSidelined(look(5), chooseLooked("pick", { max: 2, filter: printedCostAtLeast(5), prompt: "公开最多 2 张所需能量为 5 或更高的卡牌并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom())
  ],

  // 真希波·真理·伊拉丝多莉亚斯：【登场时】确认我方卡组最上方的3张卡牌。公开其中最多1张“特征：WILLE”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-055": [onPlay(...lookPickDiscard(3, wille, "公开最多 1 张“特征：WILLE”并加入手牌"))],

  // 真希波·真理·伊拉丝多莉亚斯：【启动主要】[每回合1次]只有在此角色登场的回合中才能发动。选择我方场上的1张“特征：WILLE”，本回合中，给予“当此角色进行攻击且没有被阻挡时，抽取最多1张卡牌”。
  "UC03BT/EVA-1-056": [
    activateMain({ condition: enteredThisTurn, once: true },
      chooseOwn("target", { min: 1, max: 1, filter: wille, prompt: "选择我方场上的 1 张“特征：WILLE”（本回合给予“攻击且没有被阻挡时，抽取最多 1 张卡牌”）" }),
      grantAbility(chosen("target"), 1)),
    givenOnly(when(["onAttackUnblocked"], may("抽取 1 张卡牌？", draw(1))))
  ],

  // 真希波·真理·伊拉丝多莉亚斯：【攻击时】可以将我方的1张手牌置于场外。这样做的场合，从我方的场外将最多1张所需能量不高于3且消费AP为1的紫色的〈碇 真嗣〉在我方的场上以休息状态登场。
  "UC03BT/EVA-1-057": [withCondition(onAttack(may("将 1 张手牌置于场外，从场外将〈碇 真嗣〉以休息状态登场？", discard(1),
    chooseFromSideline("card", { max: 1, filter: and(isCharacterCard, ofColor("purple"), named(SHINJI), sidelineCostAtMost(3), apCostIs(1)), prompt: "从场外选择最多 1 张所需能量不高于 3 且消费 AP 为 1 的紫色〈碇 真嗣〉，以休息状态登场" }),
    ifThen(chosenCount("card"), [put("card", "choose", true)]))), handNotEmpty)],

  // 莉莉丝：【登场时】将我方卡组最上方的2张卡牌背面朝上置于此场地的下方。
  //        【启动主要】[转为休息状态]只有在此场地的下方没有背面朝上的卡牌的场合才能发动。将此场地退场。
  //        【退场时】从我方的场外将最多1张角色卡牌加入手牌。我方的回合中的场合，可以将我方的1张手牌置于场外。这样做的场合，选择我方的最多1张AP卡牌，转为活跃状态。
  "UC03BT/EVA-1-058": [
    onPlay(run("将卡组最上方的 2 张卡牌背面朝上置于此场地的下方", (env) => { if (env.self) env.self.faceDown = [...(env.self.faceDown ?? []), ...env.owner.library.splice(0, 2)]; })),
    activateMain({ costs: [restSelf], condition: (env) => !!env.self && faceDownCount(env) === 0 }, sideline("self")),
    onSidelined(
      chooseFromSideline("card", { max: 1, filter: isCharacterCard, prompt: "从场外选择最多 1 张角色卡牌加入手牌" }),
      moveChosen("card", "hand"),
      ifThen(all(duringYourTurn, handNotEmpty), [may("将 1 张手牌置于场外，将最多 1 张 AP 卡牌转为活跃状态？", discard(1), chooseAp("ap", 1), activateAp("ap"))])
    )
  ],

  // 与你的合奏真棒啊…：选择我方的最多2张AP卡牌，转为活跃状态。
  "UC03BT/EVA-1-059": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 千万别再驾驶EVA了：将我方前线中的1张活跃状态的角色转为休息状态。这样做的场合，抽取3张卡牌。
  "UC03BT/EVA-1-060": [onUse(
    chooseOwn("target", { line: "front", min: 1, max: 1, filter: activeCard, prompt: "选择我方前线中 1 张活跃状态的角色转为休息状态" }),
    rest(chosen("target")),
    ifThen(chosenRested("target"), [draw(3)])
  )],

  // 谨遵吩咐――公主殿下！：选择对方前线中的最多1张角色，本回合中，BP-3000。选择对方前线中的最多1张角色，本回合中，BP-1000。
  "UC03BT/EVA-1-061": [onUse(
    chooseOpponent("big", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-3000）" }), bp(chosen("big"), -3000),
    chooseOpponent("small", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-1000）" }), bp(chosen("small"), -1000)
  )],

  // 欢迎回来，碇真嗣。我一直在等你：从我方的场外将1张紫色的〈碇 真嗣〉在我方的场上以休息状态登场。
  "UC03BT/EVA-1-062": [onUse(
    chooseFromSideline("card", { min: 1, max: 1, filter: and(isCharacterCard, ofColor("purple"), named(SHINJI)), prompt: "从场外选择 1 张紫色〈碇 真嗣〉，以休息状态登场" }),
    ifThen(chosenCount("card"), [put("card", "choose", true)])
  )]
};
