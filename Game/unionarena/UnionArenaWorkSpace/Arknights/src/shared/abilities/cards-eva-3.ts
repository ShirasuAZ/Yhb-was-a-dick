/**
 * Abilities of the EVA cards, batch 3 (UC03BT/EVA-1-063 ... 088; see cards.ts for the conventions). Each entry follows the card's printed text, shown above it.
 *
 * DATA NOTE: from 068 on the set is red, but cards.json lists those cards as `color: "yellow"` with required energy 0 and no energy production
 * (`energyGen` 0, `energyGenColor` null). The printed text is encoded as written (红色, [红×N]); `printedColor` below reads such a "yellow character
 * without any energy colour" as red, so the cards work with the data as it is now and after it is fixed.
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { costOf, flagsOf, energyLineOnly, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, bp, bpAtMost, chooseAp, chooseFromHand, chooseLooked, chooseMode, chooseOpponent, chooseOwn, chosen, chosenCount,
  costChange, discard, draw, duringOpponentTurn, duringYourTurn, flag, givenOnly, grantAbility, ifThen, isCharacterCard, look, may, moveChosen, moveLine, named,
  nextUseNamedCut, notSelf, onPlay, onSidelined, onUse, oncePerTurn, opponentFrontHasCharacters, ownFieldEmpty, put, rest, restSelf, run, selfActive, selfOnFront,
  sideline, sidelineSelf, staticSelf, toHand, when, withCondition, youHaveNamed
} from "./dsl.ts";

// ---- Helpers for these cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];

const SHINJI = "碇 真嗣";
const AYANAMI = "绫波 零";
const SHIKINAMI = "式波·明日香·兰格雷";
const EVA13 = "新世纪福音战士13号机";
const EVA_GAIUS = "新世纪福音战士初号机（盖乌斯之枪）";

/** The card's colour, reading a "yellow character with no energy colour" (a red card the data lost; see the note at the top) as red. */
const printedColor = (env: AbilityEnv, cardId: string): string | undefined => {
  const stats = env.ctx.card(cardId);
  if (stats?.type === "character" && stats.color === "yellow" && !stats.energyGenColor) return "red";
  return stats?.color;
};
const isRed: CardFilter = (env, cardId) => printedColor(env, cardId) === "red";
/** 没有【触发】的卡牌 */
const hasNoTrigger: CardFilter = (env, cardId) => !env.ctx.card(cardId)?.trigger;
const noTriggerOnField = (env: AbilityEnv): number => fieldOf(env.owner).filter((card) => hasNoTrigger(env, card.cardId, card)).length;
const noTriggerOnFieldAtLeast = (count: number): Condition => (env) => noTriggerOnField(env) >= count;
const noTriggerInHandAtLeast = (count: number): Condition => (env) => env.owner.hand.filter((cardId) => hasNoTrigger(env, cardId, null)).length >= count;
const youHaveAnyNamed = (...names: string[]): Condition => (env) => names.some((name) => youHaveNamed(name)(env));
/** 我方场外的红色的〈绫波 零〉 */
const redAyanami: CardFilter = and(isCharacterCard, isRed, named(AYANAMI));
const printedCost = (env: AbilityEnv, cardId: string): number => env.ctx.card(cardId)?.energyCost ?? 0;
const distinctCosts = (env: AbilityEnv, cardIds: string[]): boolean => new Set(cardIds.map((cardId) => printedCost(env, cardId))).size === cardIds.length;
const faceDownCount = (env: AbilityEnv): number => env.self?.faceDown?.length ?? 0;

/** The chosen field cards are no longer on the field (通过此效果退场). */
const chosenGone = (name: string): Condition => (env) => {
  const uids = env.vars[name] ?? [];
  return uids.length > 0 && uids.every((uid) => !env.players.some((player) => fieldOf(player).some((card) => card.uid === uid)));
};
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;

/** "<text>的此效果1回合只能发动1次": a mark on the game for this turn, per player. */
const turnMark = (env: AbilityEnv, text: string): string => `${env.game.turn}:${env.owner.accountId}:${text}`;
const notMarkedThisTurn = (text: string): Condition => (env) => !(env.game.turnMarks ?? []).includes(turnMark(env, text));
const markThisTurn = (text: string) => (env: AbilityEnv): void => { env.game.turnMarks = [...(env.game.turnMarks ?? []), turnMark(env, text)]; };

/** 获得“当主要阶段结束时，将此角色退场” (given with grantAbility). */
const sidelineAtMainEnd = givenOnly(when(["onMainEnd"], sideline("self")));

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

/** 确认我方卡组最上方的1张卡牌。将其置于我方卡组的最上方或场外。 */
const peekTopToSidelineOrTop: Step[] = [
  look(1),
  chooseLooked("out", { max: 1, prompt: "选择将其置于场外（不选则置于卡组最上方）" }),
  moveChosen("out", "sideline"),
  ...lookedToTop()
];

/** 一个能被移动至其他线的角色 (not 无法移动; one on the energy line must be allowed on the front line). */
const canChangeLine: CardFilter = (env, cardId, card) => !!card && !flagsOf(card).includes("cannotMove") && (env.owner.front.includes(card) || !energyLineOnly(env.ctx, cardId, env.owner));

/** 将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。 */
const returnCost1OrSelf: Step[] = [
  chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= 1), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
  toHand(chosen("target")),
  ifThen((env) => !chosenGone("target")(env), [toHand("self")])
];

/** 盖乌斯之枪 / 绝望之枪朗基努斯: choose 1 opposing front-line character whose BP is within the limit and sideline it. */
const sidelineOpponentFront = (limit: number | ((env: AbilityEnv) => number), prompt: string): Step[] => [
  chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(limit), prompt }),
  sideline(chosen("target"))
];

export const EVA_3_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 盖乌斯之枪：选择对方前线中的1张『BP不高于3000』的角色退场。抽取1张卡牌，将我方的1张手牌置于场外。我方的场上存在〈碇 真嗣〉或〈新世纪福音战士初号机（盖乌斯之枪）〉的场合，改为『BP不高于5000』。
  "UC03BT/EVA-1-063": [onUse(
    ...sidelineOpponentFront((env) => (youHaveAnyNamed(SHINJI, EVA_GAIUS)(env) ? 5000 : 3000), "选择对方前线中 1 张 BP 不高于 3000 的角色退场（我方有〈碇 真嗣〉或〈初号机（盖乌斯之枪）〉时：5000）"),
    draw(1), discard(1)
  )],

  // 收到收到：选择我方的最多2张AP卡牌，转为活跃状态。
  "UC03BT/EVA-1-064": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 绝望之枪朗基努斯：我方的场上存在〈碇 真嗣〉或〈新世纪福音战士13号机〉的场合，手牌中此卡牌的消费AP-1。
  //                选择对方前线中的1张BP不高于5000的角色退场。
  "UC03BT/EVA-1-065": [
    costChange({ ap: 1 }, youHaveAnyNamed(SHINJI, EVA13)),
    onUse(...sidelineOpponentFront(5000, "选择对方前线中 1 张 BP 不高于 5000 的角色退场"))
  ],

  // 哼。那样子连笨蛋都算不上…只是个小鬼嘛：选择对方前线中的1张角色，本回合中，BP-1000。选择我方的最多1张AP卡牌，转为活跃状态。
  "UC03BT/EVA-1-066": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色（本回合 BP-1000）" }), bp(chosen("target"), -1000),
    chooseAp("ap", 1), activateAp("ap")
  )],

  // 我知道这很乱来：选择我方的最多2张AP卡牌，转为活跃状态。
  "UC03BT/EVA-1-067": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 赤木 律子：此角色处于活跃状态的场合，此角色的产生能量+[红]。
  "UC03BT/EVA-1-068": [staticSelf({ flags: ["extraEnergy:red:1"] }, selfActive)],

  // 绫波 零：【启动主要】[转为休息状态][每回合1次]此角色在本回合中，获得产生能量+[红]和“当主要阶段结束时，将此角色退场”。
  "UC03BT/EVA-1-069": [activateMain({ costs: [restSelf], once: true }, flag("self", "extraEnergy:red:1"), grantAbility("self", 1)), sidelineAtMainEnd],

  // 绫波 零：【登场时】确认我方卡组最上方的3张卡牌。将其中最多1张置于场外，剩余的卡牌自选顺序置于我方卡组的最上方。
  "UC03BT/EVA-1-070": [onPlay(look(3), chooseLooked("out", { max: 1, prompt: "选择最多 1 张置于场外" }), moveChosen("out", "sideline"), ...lookedToTop())],

  // 绫波 零：《冲击无效》
  //        【启动主要】[每回合1次]只有在我方的场外存在2种或更多所需能量不同的红色的〈绫波 零〉的场合才能发动。此角色直到下一个我方的回合开始时为止，产生能量+[红]。
  "UC03BT/EVA-1-071": [activateMain({
    once: true,
    condition: (env) => new Set(env.owner.sideline.filter((cardId) => redAyanami(env, cardId, null)).map((cardId) => printedCost(env, cardId))).size >= 2
  }, flag("self", "extraEnergy:red:1", "untilYourNextTurn"))],

  // 碇 源堂&冬月 耕造：【启动主要】[转为休息状态]抽取1张卡牌，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-072": [activateMain({ costs: [restSelf] }, draw(1), discard(1))],

  // 碇 真嗣：我方的场上1张卡牌都没有的场合，手牌中此卡牌的所需能量减少[红×2]。
  //        【登场时】确认我方卡组最上方的1张卡牌。将其置于我方卡组的最上方或场外。
  "UC03BT/EVA-1-074": [costChange({ energy: 2 }, ownFieldEmpty), onPlay(...peekTopToSidelineOrTop)],

  // 碇 真嗣：【启动主要】[场外存在的场合] [将2张手牌置于场外] ＃支付1AP＃只有在满足此卡牌的所需能量的场合才能发动。将场外的此卡牌在我方的场上以休息状态登场。
  //        【登场时】选择与此角色不同线中的1张我方的角色，可以与此角色交换位置。
  // (075 is not automated: its 【启动主要】 is used from the sideline, which the engine cannot do — see the report.)

  // 伊吹 摩耶：对方的场上存在黄色或紫色卡牌的场合，手牌中此卡牌的所需能量减少[红×1]。
  "UC03BT/EVA-1-076": [costChange({ energy: 1 }, (env) => fieldOf(env.opponent).some((card) => ["yellow", "purple"].includes(printedColor(env, card.cardId) ?? "")))],

  // 新世纪福音战士临时5号机：【突进】〈真希波·真理·伊拉丝多莉亚斯〉转为活跃状态，并可以移动至前线
  //                      【登场时】我方的场上存在4张或更多没有【触发】的卡牌的场合，抽取1张卡牌。
  //                      【退场时】选择对方前线中的最多1张角色，转为休息状态。
  "UC03BT/EVA-1-077": [
    withCondition(onPlay(draw(1)), noTriggerOnFieldAtLeast(4)),
    onSidelined(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态" }), rest(chosen("target")))
  ],

  // 新世纪福音战士3号机：【登场时】可以将我方场上的1张〈式波·明日香·兰格雷〉退场。这样做的场合，将此角色转为活跃状态，抽取1张卡牌。
  "UC03BT/EVA-1-078": [withCondition(onPlay(may("将我方场上的 1 张〈式波·明日香·兰格雷〉退场？",
    chooseOwn("target", { min: 1, max: 1, filter: named(SHIKINAMI), prompt: "选择我方场上 1 张〈式波·明日香·兰格雷〉退场" }), sideline(chosen("target")),
    ifThen(chosenGone("target"), [activate("self"), draw(1)]))), youHaveNamed(SHIKINAMI))],

  // 新世纪福音战士初号机 拟神化：【突进】〈碇 真嗣〉转为活跃状态，并可以移动至前线
  //   根据此角色下方的背面朝上的卡牌的张数，此角色获得下列效果。
  //   ・0张：【我方的回合中】此角色获得BP+5000和【冲击③】。
  //   ・4张或更多：此角色不会被对方的触发效果选择。
  //   当此角色的攻击结束时，确认此角色下方的背面朝上的卡牌，公开其中最多2张卡牌并加入手牌。将2张卡牌加入手牌的场合，将此角色转为活跃状态。
  //   【登场时】从我方的场外将所需能量各不相同的红色的〈绫波 零〉最多各1张背面朝上置于此角色的下方。
  "UC03BT/EVA-1-079": [
    staticSelf({ bp: 5000, keywords: ["冲击3"] }, all(duringYourTurn, (env) => faceDownCount(env) === 0)),
    staticSelf({ flags: ["noTriggerTarget"] }, (env) => faceDownCount(env) >= 4),
    withCondition(when(["onAttackEnd"],
      run("确认此角色下方的背面朝上的卡牌", (env) => { env.game.looking = { ownerId: env.owner.accountId, cards: [...(env.self?.faceDown ?? [])] }; }),
      chooseLooked("pick", { max: 2, prompt: "公开最多 2 张下方的卡牌并加入手牌" }),
      moveChosen("pick", "hand"),
      run("剩余的卡牌仍背面朝上置于此角色的下方", (env) => {
        if (env.self) env.self.faceDown = [...(env.game.looking?.cards ?? [])];
        env.game.looking = null;
      }),
      ifThen(chosenCount("pick", 2), [activate("self")])
    ), (env) => faceDownCount(env) > 0),
    onPlay(
      {
        do: "choose", as: "cards", from: "sideline", side: "you", filter: redAyanami, check: distinctCosts, min: 0, max: 99,
        prompt: "从场外选择所需能量各不相同的红色〈绫波 零〉（最多各 1 张），背面朝上置于此角色的下方", good: true
      },
      run("将所选卡牌背面朝上置于此角色的下方", (env) => {
        const indexes = (env.vars.cards ?? []).filter((key) => key.startsWith("s:")).map((key) => Number(key.slice(2))).sort((a, b) => b - a);
        const moved = indexes.map((index) => env.owner.sideline.splice(index, 1)[0]!).reverse();
        if (env.self) env.self.faceDown = [...(env.self.faceDown ?? []), ...moved];
      })
    )
  ],

  // 新世纪福音战士零号机：【突进】〈绫波 零〉转为活跃状态，并可以移动至前线
  //   【启动主要】[前线中存在的场合] ＃将此卡牌退场＃选择对方前线中的最多1张角色退场。本回合中，下一张将要从手牌中使用的〈碇 真嗣〉或卡牌名包含“初号机”的角色卡牌的所需能量减少[红×1]，消费AP-1。
  //   【退场时】抽取2张卡牌。
  "UC03BT/EVA-1-080": [
    activateMain({ condition: selfOnFront, costs: [sidelineSelf] },
      chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色退场" }), sideline(chosen("target")),
      nextUseNamedCut({ names: [SHINJI], nameParts: ["初号机"], color: "red", energy: 1, ap: 1 })),
    onSidelined(draw(2))
  ],

  // 新世纪福音战士2号机：【突进】〈式波·明日香·兰格雷〉转为活跃状态，并可以移动至前线
  //   【登场时】从我方的手牌中将最多1张所需能量不高于『0』的没有【触发】的红色的角色卡牌在我方的场上以休息状态登场。我方场上的没有【触发】的卡牌每有1张，通过此效果登场的角色的所需能量范围+1。
  //            我方的场上存在4张或更多没有【触发】的卡牌的场合，抽取2张卡牌，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-081": [onPlay(
    chooseFromHand("card", {
      max: 1, prompt: "从手牌选择最多 1 张所需能量不高于（我方场上没有【触发】的卡牌张数）的没有【触发】的红色角色卡牌，以休息状态登场",
      filter: and(isCharacterCard, isRed, hasNoTrigger, (env, cardId) => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy <= noTriggerOnField(env))
    }),
    ifThen(chosenCount("card"), [put("card", "choose", true)]),
    ifThen(noTriggerOnFieldAtLeast(4), [draw(2), discard(1)])
  )],

  // 新世纪福音战士2号机 兽化：【突进】〈真希波·真理·伊拉丝多莉亚斯〉转为活跃状态，并可以移动至前线
  //   【伤害②】（当通过此角色的攻击给予对方直接伤害时，改为给予2点伤害）
  //   [每回合1次]当此角色的攻击结束时，对方的前线中存在角色的场合，可以将我方手牌中的2张没有【触发】的卡牌置于场外。这样做的场合，将此角色转为活跃状态，本回合中，BP+3000。
  "UC03BT/EVA-1-082": [oncePerTurn(withCondition(when(["onAttackEnd"], may("将手牌中的 2 张没有【触发】的卡牌置于场外，将此角色转为活跃状态并 BP+3000？",
    chooseFromHand("cost", { min: 2, max: 2, filter: hasNoTrigger, prompt: "选择手牌中的 2 张没有【触发】的卡牌置于场外" }),
    moveChosen("cost", "sideline"),
    activate("self"),
    bp("self", 3000))), all(opponentFrontHasCharacters, noTriggerInHandAtLeast(2))))],

  // 加持 良治：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。
  "UC03BT/EVA-1-083": [onPlay(...returnCost1OrSelf)],

  // 葛城 美里：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-084": [onPlay(draw(1), discard(1))],

  // 葛城 美里：【登场时】从下列选择1项。
  //          ・选择我方场上的最多1张其他角色，本回合中，BP+1000。
  //          ・选择我方场上的最多1张角色，移动至其他线。
  "UC03BT/EVA-1-085": [onPlay(
    chooseMode("mode", ["选择我方场上的最多1张其他角色，本回合中，BP+1000。", "选择我方场上的最多1张角色，移动至其他线。"]),
    ifThen(modeIs("mode", 0), [chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000)]),
    ifThen(modeIs("mode", 1), [chooseOwn("mover", { max: 1, filter: canChangeLine, prompt: "选择我方场上最多 1 张角色，移动至其他线" }), ifThen(chosenCount("mover"), [moveLine(chosen("mover"))])])
  )],

  // 式波·明日香·兰格雷：《冲击无效》（keyword line only; the keyword is in the card data)
  "UC03BT/EVA-1-086": [],

  // 式波·明日香·兰格雷：【对方的回合中】当没有【触发】的卡牌从我方的生命区中置于场外时，此角色在本回合中，可以BP+2000。〈式波·明日香·兰格雷〉的此效果1回合只能发动1次。
  "UC03BT/EVA-1-087": [{
    ...withCondition(when(["onOwnLifeToSideline"], may("此角色本回合 BP+2000？", run("〈式波·明日香·兰格雷〉的此效果本回合已发动", markThisTurn("式波·明日香·兰格雷:BP+2000")), bp("self", 2000))),
      all(duringOpponentTurn, notMarkedThisTurn("式波·明日香·兰格雷:BP+2000"))),
    heardIf: (ctx, cause) => !ctx.card(cause?.sourceCardId ?? "")?.trigger
  }],

  // 式波·明日香·兰格雷：我方的场上1张卡牌都没有的场合，手牌中此卡牌的所需能量减少[红×2]。
  //                    【登场时】确认我方卡组最上方的1张卡牌。确认的卡牌为没有【触发】的卡牌的场合，可以公开并加入手牌。没有加入手牌的场合，将该卡牌置于卡组的最上方。
  "UC03BT/EVA-1-088": [
    costChange({ energy: 2 }, ownFieldEmpty),
    onPlay(look(1), chooseLooked("pick", { max: 1, filter: hasNoTrigger, prompt: "公开没有【触发】的卡牌并加入手牌（不选则置于卡组最上方）" }), moveChosen("pick", "hand"), ...lookedToTop())
  ]
};
