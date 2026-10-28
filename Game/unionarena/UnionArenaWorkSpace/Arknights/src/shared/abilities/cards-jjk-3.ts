/**
 * Abilities of the JJK cards, batch 3: the purple cards UA02BT/JJK-1-070 ... 100, the blue EX04BT/JJK-1-040 and the yellow EX04BT/JJK-3-001 ... 003
 * (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it.
 *
 * Not in the table: UA02BT/JJK-1-090 (only the 【冲击无效】 keyword line, which counts as automatic by itself).
 * Reading choices: see the notes above 092 (真人), 094 (自闭圆顿里), 098 (不义游戏) and 3-001 (天内 理子).
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { costOf, energyLineOnly, energyOf, flagsOf, LINE_LIMIT, queueCardEvent, raidByEffect, raidTargetMatches, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateMain, all, and, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn,
  chosen, chosenCount, costChange, discard, discardCost, draw, either, energyCostAtMost, energyThisTurn, givenOnly, grant, grantAbility, ifThen, isCharacterCard, look,
  lookedToBottom, may, moveChosen, moveLine, named, noneChosen, notNamed, notSelf, onAttack, onBlock, onPlay, onSidelined, onUse, opponentHasColor, put, restSelf, run,
  selfActive, selfOnEnergy, selfOnFront, sideline, sidelineSelf, staticSelf, toHand, when, withAffinity, withCondition, youHaveNamed, activateAp
} from "./dsl.ts";

// ---- Helpers for these cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const MAHITO = "真人";
const AOI = "东堂 葵";
const KYOTO = "京都校";
const HUMAN_TRAIT = "改造人类";
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const findField = (env: AbilityEnv, uid: string): UnionArenaFieldCard | null => env.players.flatMap(fieldOf).find((card) => card.uid === uid) ?? null;
/** The chosen field cards still on the field. */
const chosenCards = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => (env.vars[name] ?? []).flatMap((uid) => findField(env, uid) ?? []);
/** Something was chosen under `name` and that card is no longer on the field (it was sidelined by the effect). */
const leftField = (name: string): Condition => (env) => (env.vars[name] ?? []).length > 0 && chosenCards(env, name).length === 0;

/** Required energy of a hand card now (with its own cost changes). */
const handCost = (env: AbilityEnv, cardId: string): number => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy;
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => handCost(env, cardId) <= limit;
/** 满足所需能量: the energy line makes enough energy of the card's colour. */
const affordable: CardFilter = (env, cardId) => energyOf(env.ctx, env.owner, env.ctx.card(cardId)?.color ?? "") >= handCost(env, cardId);

const deckAtLeast = (count: number): Condition => (env) => env.owner.library.length >= count;
/** 将我方卡组最上方的N张卡牌置于场外 */
const mill = (count: number) => (env: AbilityEnv): void => { env.owner.sideline.push(...env.owner.library.splice(0, count)); };
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;

/** 从我方手牌或场外将最多1张…: one card from the hand, or (when none was picked there) from the sideline, put into `name`. */
const handOrSideline = (name: string, inHand: CardFilter, inSideline: CardFilter, what: string): Step[] => [
  chooseFromHand(name, { max: 1, filter: inHand, prompt: `从手牌选择最多 1 张${what}（不选则可从场外选择）` }),
  ifThen(noneChosen(name), [chooseFromSideline(name, { max: 1, filter: inSideline, prompt: `从场外选择最多 1 张${what}` })])
];
/** 拥有「改造人类」特征的角色卡牌 */
const modifiedHuman: CardFilter = and(isCharacterCard, withAffinity(HUMAN_TRAIT));
/** 从我方手牌或我方场外将最多1张拥有「改造人类」特征的角色卡牌以活跃状态登场 */
const putModifiedHumanActive: Step[] = [
  ...handOrSideline("human", modifiedHuman, modifiedHuman, "拥有“改造人类”特征的角色卡牌（以活跃状态登场）"),
  ifThen(chosenCount("human"), [put("human", "choose", false)])
];

/** 我方场上的1张〈真人〉以外的角色 exists */
const hasNonMahito: Condition = (env) => fieldOf(env.owner).some((card) => isCharacter(env, card) && env.ctx.card(card.cardId)?.name !== MAHITO);

/** 可以将我方卡组最上方3张卡牌置于场外 */
const mayMillThree: Step = ifThen(deckAtLeast(1), [may("将卡组最上方 3 张卡牌置于场外？", run("将卡组最上方 3 张卡牌置于场外", mill(3)))]);

/** A field card that can be moved to the other line by an effect (not 无法移动). */
const movable: CardFilter = (_env, _cardId, card) => !!card && !flagsOf(card).includes("cannotMove");
const movableToFront: CardFilter = (env, cardId, card) => movable(env, cardId, card) && !energyLineOnly(env.ctx, cardId);
/** The opponent's front line has a movable character and their energy line a character that can go to the front. */
const opponentCanSwapLines: Condition = (env) => env.opponent.front.some((card) => isCharacter(env, card) && movable(env, card.cardId, card))
  && env.opponent.energy.some((card) => isCharacter(env, card) && movableToFront(env, card.cardId, card));

/** 与此角色同线的其他［特征：京都校］ (characters on the same line as this card). */
const otherKyotoOnSameLine = (env: AbilityEnv): number => {
  const self = env.self;
  if (!self) return 0;
  const line = env.owner.front.includes(self) ? env.owner.front : env.owner.energy;
  return line.filter((card) => card.uid !== self.uid && isCharacter(env, card) && (env.ctx.card(card.cardId)?.affinities ?? []).includes(KYOTO)).length;
};
/** 选择对方正在攻击的1张角色: the attacker of the battle this card is blocking. */
const attackingNow: CardFilter = (env, _cardId, card) => {
  const battle = [...env.game.after].reverse().find((entry) => entry.kind === "battle" && entry.blocked && entry.defenderUid === env.self?.uid);
  return !!card && !!battle && battle.kind === "battle" && battle.attackerUid === card.uid;
};
const kyotoPenalty = (name: string): Step => ifThen((env) => otherKyotoOnSameLine(env) > 0, [bp(chosen(name), (env) => -1000 * otherKyotoOnSameLine(env))]);

/** An ability of this card (by index) has not been used this turn (for 「每回合1次」 on a triggered ability). */
const notUsedThisTurn = (index: number): Condition => (env) => !!env.self && !(env.self.used ?? []).includes(index);
const markUsedThisTurn = (index: number): Step => run("本回合已发动", (env) => { if (env.self) env.self.used = [...(env.self.used ?? []), index]; });
/** 自闭圆顿里: the attacker is a 〈真人〉. */
const attackerIsMahito: Condition = (env) => env.ctx.card(env.cause?.attackerCardId ?? "")?.name === MAHITO;

/** 进行突进 with a hand card chosen under `name` (as a Raid by an effect). */
const handCardOf = (env: AbilityEnv, name: string): string | undefined => {
  const key = env.vars[name]?.[0];
  return key ? env.owner.hand[Number(key.slice(2))] : undefined;
};
const raidTargetsFor = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => {
  const cardId = handCardOf(env, name);
  const stats = cardId ? env.ctx.card(cardId) : null;
  return stats?.raid ? fieldOf(env.owner).filter((card) => raidTargetMatches(env.ctx, stats, card)) : [];
};
const chosenOwnCards = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => (env.vars[name] ?? []).flatMap((uid) => fieldOf(env.owner).filter((card) => card.uid === uid));
/** 以休息状态登场或发动突进 */
const putRestedOrRaid = (name: string): Step[] => [
  ifThen((env) => raidTargetsFor(env, name).length > 0, [chooseMode(`${name}:how`, ["以休息状态登场", "发动突进"])]),
  ifThen(modeIs(`${name}:how`, 1), [
    { do: "choose", as: `${name}:target`, from: "field", side: "you", filter: (env, _cardId, card) => !!card && raidTargetsFor(env, name).includes(card), min: 1, max: 1, prompt: "选择突进的对象", good: true },
    ifThen((env) => chosenOwnCards(env, `${name}:target`).some((card) => env.owner.energy.includes(card)), [chooseMode(`${name}:front`, ["移动至前线", "留在能量线"])]),
    ifThen((env) => modeIs(`${name}:front`, 0)(env) && env.owner.front.length >= LINE_LIMIT, [{ do: "choose", as: `${name}:room`, from: "field", side: "you", line: "front", min: 1, max: 1, prompt: "前线已满：选择 1 张置于移除区", good: false }]),
    run("进行突进", (env) => {
      const key = env.vars[name]![0]!;
      const cardId = env.owner.hand.splice(Number(key.slice(2)), 1)[0]!;
      const targetUid = env.vars[`${name}:target`]![0]!;
      raidByEffect(env.game, env.ctx, env.owner, cardId, targetUid, modeIs(`${name}:front`, 0)(env), env.vars[`${name}:room`]?.[0]);
    })
  ], [put(name, "choose", true)])
];

/** 不义游戏 (098): the opponent's own part, as an ability of the event that the event queues for them (index 1 of its list). */
const OPPONENT_PLAY_ABILITY = 1;

const ownFrontOrEnergyNames = (env: AbilityEnv, names: string[]): boolean => env.owner.front.some((card) => names.includes(env.ctx.card(card.cardId)?.name ?? ""));

export const JJK_3_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 虎杖 悠仁：【突进】〈虎杖 悠仁〉转为活跃状态，并可以移动至前线
  //          【登场时】选择对方前线中的最多1张BP不高于4000的角色，放回手牌。
  "EX04BT/JJK-1-040": [onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(4000), prompt: "选择对方前线中最多 1 张 BP 不高于 4000 的角色放回手牌" }), toHand(chosen("target")))],

  // 高田：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。若没有其他角色放回手牌，此角色放回手牌。
  "UA02BT/JJK-1-070": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // 吉野 顺平：【启动主要】[转为休息状态][每回合1次]此角色产生能量+●紫●。主要阶段结束时，将此角色退场。
  "UA02BT/JJK-1-071": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 被改造的人类：【启动主要】[转为休息状态]#此卡牌退场#选择对方前线1张角色，本回合中BP-1000。
  "UA02BT/JJK-1-072": [activateMain({ costs: [restSelf, sidelineSelf] },
    chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线 1 张角色（本回合 BP-1000）" }), bp(chosen("target"), -1000))],

  // 究极 机械丸：此角色处于活跃状态的场合，此角色产生能量+●紫●。
  "UA02BT/JJK-1-074": [staticSelf({ energy: 1 }, selfActive)],

  // 庵 歌姬：【登场时】确认我方卡组最上方的3张卡牌。公开其中最多1张［特征：京都校］并加入手牌。剩余的卡牌自选顺序置于卡组最下方。加入手牌的场合，将自己的1张手牌置于場外。
  "UA02BT/JJK-1-075": [onPlay(
    look(3), chooseLooked("pick", { max: 1, filter: withAffinity(KYOTO), prompt: "公开最多 1 张“特征：京都校”的卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(),
    ifThen(chosenCount("pick"), [discard(1)]))],

  // 加茂 宪纪：【攻击时】选择对方前线中最多1张其他角色，本回合中，BP-1000。
  "UA02BT/JJK-1-077": [onAttack(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-1000）" }), bp(chosen("target"), -1000))],

  // 禅院 真依：【登场时】选择我方场上最多1张其他角色，本回合中，BP+1000。
  "UA02BT/JJK-1-078": [onPlay(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 东堂 葵：我方场上存在〈高田〉的场合，此角色BP+500。
  //        【启动主要】#将1张手牌置于场外#[每回合1次]本回合中此角色获得【伤害②】（此角色攻击并给予对手直接伤害时，改为给予2点伤害）
  "UA02BT/JJK-1-080": [
    staticSelf({ bp: 500 }, youHaveNamed("高田")),
    activateMain({ costs: [discardCost(1)], once: true }, grant("self", "伤害2"))
  ],

  // 东堂 葵：【突进】〈东堂 葵〉转为活跃状态，并可以移动至前线。（the Raid and 【伤害②】 are in the card data）
  //        【登场时】此角色本回合中BP+2000。可以选择对方前线中和对方能量线中的角色各1张，交换他们的位置。
  "UA02BT/JJK-1-081": [onPlay(
    bp("self", 2000),
    ifThen(opponentCanSwapLines, [may("选择对方前线和能量线中的角色各 1 张，交换位置？",
      chooseOpponent("front", { line: "front", min: 1, max: 1, filter: movable, prompt: "选择对方前线中 1 张角色（与对方能量线的角色交换位置）" }),
      chooseOpponent("energy", { line: "energy", min: 1, max: 1, filter: movableToFront, prompt: "选择对方能量线中 1 张角色（与对方前线的角色交换位置）" }),
      run("交换所选的对方前线与能量线角色的位置", (env) => {
        const front = chosenCards(env, "front")[0];
        const energy = chosenCards(env, "energy")[0];
        if (!front || !energy || !env.opponent.front.includes(front) || !env.opponent.energy.includes(energy)) return;
        env.opponent.front = env.opponent.front.map((card) => (card === front ? energy : card));
        env.opponent.energy = env.opponent.energy.map((card) => (card === energy ? front : card));
        queueCardEvent(env.game, env.ctx, "onMoveToEnergy", env.opponent, front);
        queueCardEvent(env.game, env.ctx, "onMoveToFront", env.opponent, energy);
      }))]))],

  // 西宫 桃：【登场时】从我方手牌中将1张所需能量不高于2且消费AP为1并拥有「京都校」特征的卡牌以休息状态登场。
  "UA02BT/JJK-1-082": [onPlay(
    chooseFromHand("card", { min: 1, max: 1, filter: and(isCharacterCard, withAffinity(KYOTO), apCostIs(1), handCostAtMost(2)), prompt: "从手牌选择 1 张所需能量不高于 2、消费 AP 为 1 的“京都校”卡牌，以休息状态登场" }),
    ifThen(chosenCount("card"), [put("card", "choose", true)]))],

  // 三轮 霞：【登场时】抽取1张卡牌。
  "UA02BT/JJK-1-083": [onPlay(draw(1))],

  // 三轮 霞：【2次攻击】（当此角色本回合中首次进行攻击时，转为活跃状态）（in the card data）
  //        此角色必须尽可能阻挡对方的攻击（the engine blocks with it at once when it can; see "mustBlock" in engine.ts）
  //        【登场时】选择对方前线中最多1张角色，与此角色同线的其他［特征：京都校］每有1张，本回合中，选择的角色BP-1000。
  //        【阻挡时】选择对方正在攻击的1张角色，与此角色同线的其他［特征：京都校］每有1张，本回合中，选择的角色BP-1000。
  "UA02BT/JJK-1-084": [
    staticSelf({ flags: ["mustBlock"] }),
    onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（同线的其他“京都校”每有 1 张，本回合 BP-1000）" }), kyotoPenalty("target")),
    onBlock(chooseOpponent("target", { line: "front", min: 1, max: 1, filter: attackingNow, prompt: "选择对方正在攻击的角色（同线的其他“京都校”每有 1 张，本回合 BP-1000）" }), kyotoPenalty("target"))
  ],

  // 吉野 顺平&淀月：【登场时】我方场上存在〈真人〉的场合，可以将我方卡组最上方3张卡牌置于场外。
  //              【退场时】我方场上存在〈真人〉的场合，从我方手牌或场外将最多1张〈吉野 顺平：异形〉以休息状态登场。
  "UA02BT/JJK-1-085": [
    withCondition(onPlay(ifThen(deckAtLeast(1), [may("将卡组最上方 3 张卡牌置于场外？", run("将卡组最上方 3 张卡牌置于场外", mill(3)))])), youHaveNamed(MAHITO)),
    withCondition(onSidelined(
      ...handOrSideline("card", named("吉野 顺平:异形"), named("吉野 顺平:异形"), "〈吉野 顺平：异形〉（以休息状态登场）"),
      ifThen(chosenCount("card"), [put("card", "choose", true)])), youHaveNamed(MAHITO))
  ],

  // 漏瑚：【登场时】选择对方前线中最多1张角色，本回合中BP-1000。
  "UA02BT/JJK-1-086": [onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-1000）" }), bp(chosen("target"), -1000))],

  // 漏瑚：【突进】〈漏瑚〉转为活跃状态，并可以移动至前线。（in the card data）
  //     【登场时】选择对方前线中最多1张BP不高于3000的角色退场。
  "UA02BT/JJK-1-087": [onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3000), prompt: "选择对方前线中最多 1 张 BP 不高于 3000 的角色退场" }), sideline(chosen("target")))],

  // 陀艮：【退场时】抽取1张卡牌。
  "UA02BT/JJK-1-088": [onSidelined(draw(1))],

  // 花御：对方场上有黄色或蓝色的卡牌的场合，手牌中的此卡牌所需能量减少●キ紫×1●。（read as: 减少1）
  "UA02BT/JJK-1-089": [costChange({ energy: 1 }, opponentHasColor("yellow", "blue"))],

  // 真人：【启动主要】[前线中存在的场合][每回合1次]我方场上的1张〈真人〉以外的角色退场，那样做的场合，可以将我方卡组最上方3张卡牌置于场外。从我方手牌或我方场外将最多1张拥有「改造人类」特征的角色卡牌以活跃状态登场。
  //   Read as: if the character was sidelined ("那样做的场合"), then the deck may be milled by 3 and a 改造人类 character put onto the field; without it nothing else happens.
  "UA02BT/JJK-1-092": [activateMain({ condition: selfOnFront, once: true },
    chooseOwn("out", { min: 1, max: 1, filter: notNamed(MAHITO), prompt: "选择我方场上 1 张〈真人〉以外的角色退场" }),
    sideline(chosen("out")),
    ifThen(leftField("out"), [mayMillThree, ...putModifiedHumanActive]))],

  // 真人：【突进】〈真人〉转为活跃状态，并可以移动至前线。（in the card data）
  //     【登场时】选择对方前线中最多1张角色，本回合中BP-2500。将我方场外最多1张［特征：改造人类］或〈自闭圆顿里〉加入手牌。
  "UA02BT/JJK-1-093": [onPlay(
    chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-2500）" }), bp(chosen("target"), -2500),
    chooseFromSideline("back", { max: 1, filter: either(withAffinity(HUMAN_TRAIT), named("自闭圆顿里")), prompt: "从场外选择最多 1 张“特征：改造人类”或〈自闭圆顿里〉加入手牌" }),
    moveChosen("back", "hand"))],

  // 自闭圆顿里（场地）：[每回合1次]当我方场上的〈真人〉进行攻击时，可以将我方场上的1张〈真人〉以外的角色退场。那样做的场合，从我方手牌或我方场外将最多1张拥有「改造人类」特征的角色卡牌以活跃状态登场。
  //   「每回合1次」 is used up when the player says yes (declining keeps it for a later 〈真人〉 attack).
  "UA02BT/JJK-1-094": [withCondition(when(["onOwnAttack"],
    ifThen(hasNonMahito, [may("将我方场上的 1 张〈真人〉以外的角色退场？",
      markUsedThisTurn(0),
      chooseOwn("out", { min: 1, max: 1, filter: notNamed(MAHITO), prompt: "选择我方场上 1 张〈真人〉以外的角色退场" }),
      sideline(chosen("out")),
      ifThen(leftField("out"), putModifiedHumanActive))])),
  (env) => attackerIsMahito(env) && notUsedThisTurn(0)(env))],

  // 火砾虫（事件）：选择对方前线中的1张BP不高于2500的角色退场。我方场上存在〈漏瑚〉的场合，抽取1张卡牌。
  "UA02BT/JJK-1-095": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(2500), prompt: "选择对方前线中 1 张 BP 不高于 2500 的角色退场" }), sideline(chosen("target")),
    ifThen(youHaveNamed("漏瑚"), [draw(1)]))],

  // 交流战（事件）：选择我方场外最多1张拥有「京都校」特征的角色卡牌加入手牌。从我方手牌将最多1张满足能量需求且消费AP为1拥有「京都校」特征的角色卡牌以休息状态登场或发动突进。
  "UA02BT/JJK-1-096": [onUse(
    chooseFromSideline("back", { max: 1, filter: and(isCharacterCard, withAffinity(KYOTO)), prompt: "从场外选择最多 1 张“京都校”角色卡牌加入手牌" }),
    moveChosen("back", "hand"),
    chooseFromHand("card", { max: 1, filter: and(isCharacterCard, withAffinity(KYOTO), apCostIs(1), affordable), prompt: "从手牌选择最多 1 张满足所需能量、消费 AP 为 1 的“京都校”角色，以休息状态登场或发动突进" }),
    ifThen(chosenCount("card"), putRestedOrRaid("card")))],

  // 不存在的记忆（事件）：选择我方场上的最多各1张〈东堂 葵〉和〈东堂 葵〉以外的角色，本回合中BP+1000。选择2张的场合，此效果选中的〈东堂 葵〉本回合中获得▼冲击（+1）▼（冲击给予的伤害+1，没有冲击的场合，获得【冲击①】）。
  "UA02BT/JJK-1-097": [onUse(
    chooseOwn("aoi", { max: 1, filter: named(AOI), prompt: "选择我方场上最多 1 张〈东堂 葵〉（本回合 BP+1000）" }),
    chooseOwn("other", { max: 1, filter: notNamed(AOI), prompt: "选择我方场上最多 1 张〈东堂 葵〉以外的角色（本回合 BP+1000）" }),
    bp(chosen("aoi"), 1000), bp(chosen("other"), 1000),
    ifThen(all(chosenCount("aoi"), chosenCount("other")), [grant(chosen("aoi"), "冲击+1")]))],

  // 不义游戏（事件）：选择对方前线中的1张BP不高于5000的角色，置于对方卡组最下方。对方从手牌中将最多1张所需能量不高于3的角色卡牌在对方前线中以休息状态登场。通过此效果登场的角色不发动【登场时】效果。我方场上存在〈东堂 葵〉的场合，抽取1张卡牌。
  //   The opponent's part is a second (never triggered) ability of this card that the event queues for the opponent, so the hand, the question and any
  //   full-front-line question are theirs; it resolves right after the event (so our draw comes before their card is put onto the field).
  "UA02BT/JJK-1-098": [
    onUse(
      chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中 1 张 BP 不高于 5000 的角色置于其卡组最下方" }),
      { do: "toDeckBottom", target: chosen("target") },
      run("对方从手牌中将最多 1 张所需能量不高于 3 的角色在前线登场", (env) => {
        env.game.seq += 1;
        env.game.queue.push({ id: env.game.seq, ownerId: env.opponent.accountId, cardId: env.selfCardId, ability: OPPONENT_PLAY_ABILITY, selfUid: null, cause: null });
      }),
      ifThen(youHaveNamed(AOI), [draw(1)])),
    {
      kind: "triggered", when: [], steps: [
        chooseFromHand("card", { max: 1, filter: and(isCharacterCard, handCostAtMost(3), (env, cardId) => !energyLineOnly(env.ctx, cardId)), prompt: "从手牌选择最多 1 张所需能量不高于 3 的角色，以休息状态在前线登场（不发动【登场时】）" }),
        ifThen(chosenCount("card"), [
          put("card", "front", true),
          run("通过此效果登场的角色不发动【登场时】效果", (env) => {
            const uid = env.vars["placed:card"]?.[0];
            if (uid) env.game.queue = env.game.queue.filter((entry) => entry.selfUid !== uid);
          })
        ])
      ]
    }
  ],

  // 无为转变（事件）：选择对方前线中的1张BP不高于3000的角色退场。可以从我方卡组最上方将3张卡牌置于场外。此效果将对方的角色退场且我方场上存在〈真人〉的场合，从我方手牌或我方场外将最多1张拥有「改造人类」特征的角色卡牌以活跃状态登场。
  "UA02BT/JJK-1-099": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(3000), prompt: "选择对方前线中 1 张 BP 不高于 3000 的角色退场" }), sideline(chosen("target")),
    mayMillThree,
    ifThen(all(leftField("target"), youHaveNamed(MAHITO)), putModifiedHumanActive))],

  // 领域展开（事件）：选择我方的最多2张AP卡牌转为活跃状态。
  "UA02BT/JJK-1-100": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 天内 理子：[能量线中存在的场合]当我方和对方的攻击阶段结束时，我方的前线中〈五条 悟〉和〈夏油 杰〉都不存在的场合，此角色移动至前线。
  //          【启动主要】[能量线中存在的场合][转为休息状态][将1张手牌置于场外][每回合1次]选择我方场上的1张所需能量不高于5的〔〈五条 悟〉或〈夏油 杰〉〕，转为活跃状态。
  //   "都不存在" read as: neither of the two is on our front line.
  "EX04BT/JJK-3-001": [
    withCondition(when(["onEveryAttackPhaseEnd"], moveLine("self")),
      (env) => selfOnEnergy(env) && !!env.self && !flagsOf(env.self).includes("cannotMove") && !energyLineOnly(env.ctx, env.selfCardId) && !ownFrontOrEnergyNames(env, ["五条 悟", "夏油 杰"])),
    activateMain({ costs: [restSelf, discardCost(1)], condition: selfOnEnergy, once: true },
      chooseOwn("target", { min: 1, max: 1, filter: and(either(named("五条 悟"), named("夏油 杰")), energyCostAtMost(5)), prompt: "选择我方场上 1 张所需能量不高于 5 的〈五条 悟〉或〈夏油 杰〉转为活跃状态" }),
      activate(chosen("target")))
  ],

  // 家入 硝子：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "EX04BT/JJK-3-002": [onPlay(draw(1), discard(1))],

  // 庵 歌姬：【攻击时】确认我方卡组最上方的1张卡牌。将其置于我方卡组的最上方或最下方。
  "EX04BT/JJK-3-003": [onAttack(ifThen(deckAtLeast(1), [
    look(1),
    chooseMode("where", ["置于卡组最上方", "置于卡组最下方"]),
    ifThen(modeIs("where", 0),
      [run("将确认的卡牌放回卡组最上方", (env) => { const looking = env.game.looking; if (looking?.cards.length) { env.owner.library.unshift(...looking.cards); looking.cards = []; } })],
      [lookedToBottom()])
  ]))]
};
