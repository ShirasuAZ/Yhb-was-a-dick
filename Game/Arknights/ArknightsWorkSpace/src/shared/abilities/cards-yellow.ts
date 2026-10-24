/** Abilities of the yellow cards (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, costOf, flagsOf, LINE_LIMIT, loseIfNoLife, queueCardEvent, raidByEffect, raidTargetMatches, abilitiesOf, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step, Target } from "./types.ts";
import {
  activate, activateAp, activateMain, activeCard, all, and, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode,
  chooseOpponent, chooseOwn, chosen, chosenCount, costChange, discard, discardCost, draw, duringYourTurn, energyCostAtMost, energyThisTurn, givenOnly,
  grantAbility, ifThen, isCharacterCard, look, lookedToBottom, may, moveChosen, named, noneChosen, notSelf, ofColor, onAttack, onPlay, onSidelined, onUse,
  oncePerTurn, opponentHasColor, opponentRestedAtLeast, put, remove, rest, restSelf, run, selfOnFront, sideline, staticAura, staticSelf, toHand, when,
  withAffinity, withCondition, youHaveNamed
} from "./dsl.ts";

// ---- Helpers for the yellow cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const fieldCharacters = (env: AbilityEnv, player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy].filter((card) => isCharacter(env, card));
const findField = (env: AbilityEnv, uid: string): { owner: EnginePlayer; card: UnionArenaFieldCard } | null => {
  for (const owner of env.players) {
    const card = [...owner.front, ...owner.energy].find((entry) => entry.uid === uid);
    if (card) return { owner, card };
  }
  return null;
};
/** The chosen field cards still on the field. */
const chosenCards = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => (env.vars[name] ?? []).flatMap((uid) => findField(env, uid)?.card ?? []);
/** How many of the chosen cards are resting now (通过此效果转为休息状态的角色). */
const restedCount = (env: AbilityEnv, name: string): number => chosenCards(env, name).filter((card) => card.rested).length;
/** How many of the chosen cards have left the field (通过此效果退场的角色). */
const goneCount = (env: AbilityEnv, name: string): number => (env.vars[name] ?? []).filter((uid) => !findField(env, uid)).length;
const opponentRestedCharacters = (env: AbilityEnv): number => fieldCharacters(env, env.opponent).filter((card) => card.rested).length;
/** The mode picked by chooseMode(name, ...) is the index-th. */
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;

/** 场外存在的此卡牌的所需能量减少N: required energy of cards in the sideline (碎骨 1-007). */
const SIDELINE_COST_CUT: Readonly<Record<string, number>> = { "UC01BT/ARK-1-007": 2 };
const sidelineCost = (env: AbilityEnv, cardId: string): number => {
  const stats = env.ctx.card(cardId);
  return Math.max(0, (stats?.energyCost ?? 99) - (SIDELINE_COST_CUT[stats?.number ?? ""] ?? 0));
};
/** Required energy of a hand card now (with its own cost changes). */
const handCost = (env: AbilityEnv, cardId: string): number => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy;

const yellowCharacter: CardFilter = and(isCharacterCard, ofColor("yellow"));
const sidelineCostAtMost = (limit: number): CardFilter => (env, cardId) => sidelineCost(env, cardId) <= limit;
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => handCost(env, cardId) <= limit;
const handCostAtLeast = (limit: number): CardFilter => (env, cardId) => handCost(env, cardId) >= limit;
const energyCostIs = (value: number): CardFilter => (env, cardId) => env.ctx.card(cardId)?.energyCost === value;
/** BPN或更高 */
const bpAtLeast = (limit: number): CardFilter => (env, _cardId, card) => !!card && bpOf(env.ctx, card) >= limit;
const restedCard: CardFilter = (_env, _cardId, card) => !!card && card.rested;
const hasRaid: CardFilter = (env, cardId) => !!env.ctx.card(cardId)?.raid;
const canMove: CardFilter = (_env, _cardId, card) => !!card && !flagsOf(card).includes("cannotMove");

/** 该角色下一次转为活跃状态无效 (for chosen cards that are resting now). */
const skipNextActivate = (name: string): Step => run("该角色下一次转为活跃状态无效", (env) => {
  for (const card of chosenCards(env, name)) if (card.rested) card.skipNextActivate = true;
});
/** 转为休息状态。该角色下一次转为活跃状态无效。 */
const restAndFreeze = (name: string): Step => ifThen(chosenCount(name), [rest(chosen(name)), skipNextActivate(name)]);

/** Draws `count` cards (a number worked out when the step runs). */
const drawSome = (env: AbilityEnv, count: number): void => { if (count > 0) env.owner.hand.push(...env.owner.library.splice(0, count)); };

/** Records a "1回合只能……1次" use for the owner this turn (EngineGame.turnMarks, "<turn>:<text>"). */
const markTurn = (env: AbilityEnv, text: string): void => { env.game.turnMarks = [...(env.game.turnMarks ?? []), `${env.game.turn}:${env.owner.accountId}:${text}`]; };
const markedThisTurn = (text: string): Condition => (env) => (env.game.turnMarks ?? []).includes(`${env.game.turn}:${env.owner.accountId}:${text}`);

/** The card behind a chosen hand / sideline key. */
const zoneCardOf = (env: AbilityEnv, name: string): string | undefined => {
  const key = env.vars[name]?.[0];
  if (!key) return undefined;
  return (key.startsWith("h:") ? env.owner.hand : env.owner.sideline)[Number(key.slice(2))];
};
/** Own field characters the chosen hand / sideline card could Raid onto. */
const raidTargets = (env: AbilityEnv, name: string): UnionArenaFieldCard[] => {
  const cardId = zoneCardOf(env, name);
  const stats = cardId ? env.ctx.card(cardId) : null;
  return stats?.raid ? [...env.owner.front, ...env.owner.energy].filter((card) => raidTargetMatches(env.ctx, stats, card)) : [];
};
/** A chosen-cards choice that is bad for the chosen (own) cards (e.g. which one goes to the removal area). */
const chooseOwnToLose = (as: string, line: "front" | "energy", prompt: string): Step => ({ do: "choose", as, from: "field", side: "you", line, min: 1, max: 1, prompt, good: false });

/**
 * 在我方的场上以休息状态登场或进行突进: the card chosen under `name` (hand or sideline) is put onto the field resting, or Raids onto an own
 * character (which may move to the front line). Afterwards chosen("placed:<name>") is the card that came onto the field.
 */
const putOrRaid = (name: string): Step[] => [
  ifThen((env) => raidTargets(env, name).length > 0, [chooseMode(`${name}:how`, ["以休息状态登场", "进行突进"])]),
  ifThen(modeIs(`${name}:how`, 1), [
    { do: "choose", as: `${name}:target`, from: "field", side: "you", filter: (env, _cardId, card) => !!card && raidTargets(env, name).includes(card), min: 1, max: 1, prompt: "选择突进的对象", good: true },
    ifThen((env) => chosenCards(env, `${name}:target`).some((card) => env.owner.energy.includes(card)), [chooseMode(`${name}:front`, ["移动至前线", "留在能量线"])]),
    ifThen((env) => modeIs(`${name}:front`, 0)(env) && env.owner.front.length >= LINE_LIMIT, [chooseOwnToLose(`${name}:room`, "front", "前线已满：选择 1 张置于移除区")]),
    run("进行突进", (env) => {
      const key = env.vars[name]![0]!;
      const zone = key.startsWith("h:") ? env.owner.hand : env.owner.sideline;
      const cardId = zone.splice(Number(key.slice(2)), 1)[0]!;
      const targetUid = env.vars[`${name}:target`]![0]!;
      raidByEffect(env.game, env.ctx, env.owner, cardId, targetUid, modeIs(`${name}:front`, 0)(env), env.vars[`${name}:room`]?.[0]);
      env.vars[`placed:${name}`] = [targetUid];
    })
  ], [put(name, "choose", true)])
];
/** One card from the hand or the sideline (asked in that order) that is then put onto the field or Raids. */
const fromHandOrSideline = (name: string, inHand: CardFilter, inSideline: CardFilter, what: string): Step[] => [
  chooseFromHand(name, { max: 1, filter: inHand, prompt: `从手牌选择最多 1 张${what}（不选则可从场外选择）` }),
  ifThen(noneChosen(name), [chooseFromSideline(name, { max: 1, filter: inSideline, prompt: `从场外选择最多 1 张${what}` })]),
  ifThen(chosenCount(name), putOrRaid(name))
];
const placedUids = (env: AbilityEnv): string[] => Object.entries(env.vars).filter(([key]) => key.startsWith("placed:")).flatMap(([, uids]) => uids);

/** 碎骨 (1-007) 【退场时】: the chosen 突进源 card's 【登场时】 or 【退场时】 ability is activated by this character. */
const isRaidSource: CardFilter = (env, cardId) => (env.cause?.under ?? []).includes(cardId) && sourceAbility(env, cardId) >= 0;
const sourceAbility = (env: AbilityEnv, cardId: string): number =>
  abilitiesOf(env.ctx, cardId).findIndex((ability) => ability.kind === "triggered" && !ability.grantedOnly && ability.when.some((event) => event === "onPlay" || event === "onSidelined"));

/** 爱国者 (2-007): its 【登场时】, also used by its 【启动主要】. */
const patriotSteps: Step[] = [chooseOpponent("target", { line: "energy", max: 1, prompt: "选择对方能量线中最多 1 张角色转为休息状态（下一次转为活跃状态无效）" }), restAndFreeze("target"), bp("self", 1000, "untilYourNextTurn")];
/** 梅菲斯特・歌者 (2-009): its 【退场时】, also used by its 【启动主要】. */
const singerTargets: Target = (env) => env.opponent.front.filter((card) => isCharacter(env, card) && bpOf(env.ctx, card) >= 1500);

export const YELLOW_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 亚历克斯：【退场时】从我方的场外将最多1张拥有突进的角色卡牌加入手牌。
  "UC01BT/ARK-1-003": [onSidelined(chooseFromSideline("card", { max: 1, filter: and(isCharacterCard, hasRaid), prompt: "从场外选择最多 1 张拥有《突进》的角色卡加入手牌" }), moveChosen("card", "hand"))],

  // 弑君者：【登场时】确认我方卡组最上方的3张卡牌。公开其中最多1张“特征：整合运动”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UC01BT/ARK-1-005": [onPlay(look(3), chooseLooked("pick", { max: 1, filter: withAffinity("整合运动"), prompt: "公开最多 1 张“特征：整合运动”的卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // 弑君者：此角色不会被BP不高于2000的角色阻挡。
  //        当此角色进行攻击且没有被阻挡时，从我方的手牌中将最多1张所需能量为0的黄色角色卡牌在我方的场上以休息状态登场。
  //        【启动主要】「每回合1次」将我方场上的3张活跃状态的角色转为休息状态。这样做的场合，此角色在本回合中，获得“此角色不会被BP4000或更高的角色阻挡”。
  "UC01BT/ARK-1-006": [
    staticSelf({ flags: ["unblockableBpAtMost:2000"] }),
    when(["onAttackUnblocked"], chooseFromHand("card", { max: 1, filter: and(yellowCharacter, (env, cardId) => handCost(env, cardId) === 0), prompt: "从手牌选择最多 1 张所需能量为 0 的黄色角色，以休息状态登场" }), ifThen(chosenCount("card"), [put("card", "choose", true)])),
    activateMain({ once: true }, chooseOwn("cost", { min: 3, max: 3, filter: activeCard, prompt: "选择我方场上 3 张活跃状态的角色转为休息状态" }),
      ifThen(chosenCount("cost", 3), [rest(chosen("cost")), ifThen((env) => restedCount(env, "cost") >= 3, [{ do: "flag", target: "self", flag: "unblockableBpAtLeast:4000", until: "turn" }])]))
  ],

  // 碎骨：场外存在的此卡牌的所需能量减少2。（见 sidelineCost：从场外选择“所需能量为N”的卡时按减少后的值）
  //      【我方的回合中】此角色BP+1500。
  //      【退场时】可以由此角色发动作为此角色突进源的卡牌所拥有的【登场时】或【退场时】效果。
  "UC01BT/ARK-1-007": [
    staticSelf({ bp: 1500 }, duringYourTurn),
    withCondition(onSidelined(chooseFromSideline("source", { max: 1, filter: isRaidSource, prompt: "可以选择 1 张突进源，由「碎骨」发动它的【登场时】或【退场时】效果" }),
      ifThen(chosenCount("source"), [run("发动突进源的效果", (env) => {
        const cardId = zoneCardOf(env, "source")!;
        env.game.seq += 1;
        env.game.queue.push({ id: env.game.seq, ownerId: env.owner.accountId, cardId: env.selfCardId, ability: sourceAbility(env, cardId), selfUid: null, abilityCardId: cardId });
      })])), (env) => (env.cause?.under ?? []).length > 0)
  ],

  // 碎骨：【登场时】从我方的场外将最多1张所需能量为0的黄色角色卡牌加入手牌。
  //      【攻击时】从下列选择1项。•选择我方场上的最多1张所需能量不高于2的角色，本回合中，BP+2000。•选择我方场上的最多2张所需能量不高于2的角色，本回合中，BP+1000。
  "UC01BT/ARK-1-008": [
    onPlay(chooseFromSideline("card", { max: 1, filter: and(yellowCharacter, sidelineCostAtMost(0)), prompt: "从场外选择最多 1 张所需能量为 0 的黄色角色卡加入手牌" }), moveChosen("card", "hand")),
    onAttack(chooseMode("mode", ["选择我方场上的最多1张所需能量不高于2的角色，本回合中，BP+2000。", "选择我方场上的最多2张所需能量不高于2的角色，本回合中，BP+1000。"]),
      ifThen(modeIs("mode", 0),
        [chooseOwn("target", { max: 1, filter: energyCostAtMost(2), prompt: "选择我方场上最多 1 张所需能量不高于 2 的角色（本回合 BP+2000）" }), bp(chosen("target"), 2000)],
        [chooseOwn("target", { max: 2, filter: energyCostAtMost(2), prompt: "选择我方场上最多 2 张所需能量不高于 2 的角色（本回合 BP+1000）" }), bp(chosen("target"), 1000)]))
  ],

  // W：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。
  "UC01BT/ARK-1-010": [onPlay(chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }), toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // W：当此角色进行攻击且没有被阻挡时，可以抽取卡牌至手牌变为2张。
  "UC01BT/ARK-1-011": [when(["onAttackUnblocked"], ifThen((env) => env.owner.hand.length < 2, [may("抽卡至手牌变为 2 张？", run("抽卡至手牌变为 2 张", (env) => drawSome(env, 2 - env.owner.hand.length)))]))],

  // W：《撤步》
  //   当此角色从能量线移动至前线时，从我方的场外将最多1张所需能量为0的黄色角色卡牌加入手牌。
  //   当此角色从前线移动至能量线时，选择对方前线中的最多1张BP1000或更高的角色，本回合中，BP-500。
  "UC01BT/ARK-1-012": [
    when(["onMoveToFront"], chooseFromSideline("card", { max: 1, filter: and(yellowCharacter, sidelineCostAtMost(0)), prompt: "从场外选择最多 1 张所需能量为 0 的黄色角色卡加入手牌" }), moveChosen("card", "hand")),
    when(["onMoveToEnergy"], chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(1000), prompt: "选择对方前线中最多 1 张 BP1000 或更高的角色（本回合 BP-500）" }), bp(chosen("target"), -500))
  ],

  // 塔露拉：【启动主要】「每回合1次」选择我方能量线中的1张角色，转为活跃状态或休息状态。
  "UC01BT/ARK-1-013": [activateMain({ once: true }, chooseOwn("target", { line: "energy", min: 1, max: 1, prompt: "选择我方能量线中 1 张角色" }),
    ifThen(chosenCount("target"), [chooseMode("mode", ["转为活跃状态", "转为休息状态"]), ifThen(modeIs("mode", 0), [activate(chosen("target"))], [rest(chosen("target"))])]))],

  // 塔露拉：【登场时】将我方场上任意张数的活跃状态的角色转为休息状态，选择对方前线中的最多1张『BP不高于1000』的角色退场。通过此效果转为休息状态的角色每有1张，此效果可选择角色的BP范围+1000。
  //        【启动主要】「每回合1次」将我方场上任意张数休息状态的其他角色退场，选择对方前线中的1张『BP不高于1000』的角色退场。通过此效果退场的我方的角色每有1张，此效果可选择角色的BP范围+1000。
  "UC01BT/ARK-1-015": [
    onPlay(chooseOwn("cost", { max: 8, filter: activeCard, prompt: "将我方场上任意张活跃状态的角色转为休息状态（每张使可选 BP 范围 +1000）" }), rest(chosen("cost")),
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost((env) => 1000 + 1000 * restedCount(env, "cost")), prompt: "选择对方前线中最多 1 张 BP 不高于 1000（每张转为休息的角色 +1000）的角色退场" }), sideline(chosen("target"))),
    activateMain({ once: true }, chooseOwn("cost", { max: 8, filter: and(notSelf, restedCard), prompt: "将我方场上任意张休息状态的其他角色退场（每张使可选 BP 范围 +1000）" }), sideline(chosen("cost")),
      chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => 1000 + 1000 * goneCount(env, "cost")), prompt: "选择对方前线中 1 张 BP 不高于 1000（每张退场的角色 +1000）的角色退场" }), sideline(chosen("target")))
  ],

  // 爱国者：《2次阻挡》【我方的回合中】我方的手牌不多于3张的场合，此角色获得《伤害2》。
  "UC01BT/ARK-1-016": [staticSelf({ keywords: ["伤害2"] }, all(duringYourTurn, (env) => env.owner.hand.length <= 3))],

  // 浮士德：对方的场上存在蓝色或红色卡牌的场合，手牌中此卡牌的所需能量减少1。
  "UC01BT/ARK-1-018": [costChange({ energy: 1 }, opponentHasColor("blue", "red"))],

  // 浮士德：【启动主要】「每回合1次」选择我方场上的1张角色，置于我方卡组的最下方。这样做的场合，选择对方前线中的最多1张BP2000或更高的角色，本回合中，BP-1500。
  //        此角色存在于前线，且通过此效果置于我方卡组最下方的角色为〈梅菲斯特〉的场合，选择我方的最多1张AP卡牌，转为活跃状态，此角色直到我方的下一个回合开始时为止，BP+500。
  "UC01BT/ARK-1-019": [activateMain({ once: true }, chooseOwn("bottom", { min: 1, max: 1, prompt: "选择我方场上 1 张角色置于卡组最下方" }),
    ifThen(chosenCount("bottom"), [
      { do: "toDeckBottom", target: chosen("bottom") },
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(2000), prompt: "选择对方前线中最多 1 张 BP2000 或更高的角色（本回合 BP-1500）" }), bp(chosen("target"), -1500),
      // The card just put on the bottom of the deck is the deck's last card.
      ifThen(all(selfOnFront, (env) => env.ctx.card(env.owner.library[env.owner.library.length - 1] ?? "")?.name === "梅菲斯特"), [chooseAp("ap", 1), activateAp("ap"), bp("self", 500, "untilYourNextTurn")])
    ]))],

  // 梅菲斯特：【启动主要】〔转为休息状态〕「每回合1次」此角色在本回合中，获得产生能量+(黄)和“当主要阶段结束时，将此角色退场”。
  "UC01BT/ARK-1-020": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // 梅菲斯特：【启动主要】〔转为休息状态〕「每回合1次」可以将我方手牌中的1张所需能量1或更高的卡牌置于场外。这样做的场合，从我方的场外将最多1张所需能量为0的黄色角色卡牌在我方的场上以休息状态登场。
  //          本回合中，给予该角色“当攻击阶段结束时，此角色置于移除区”。
  "UC01BT/ARK-1-021": [
    activateMain({ costs: [restSelf], once: true }, ifThen((env) => env.owner.hand.some((cardId) => handCost(env, cardId) >= 1), [may("将手牌中 1 张所需能量 1 或更高的卡置于场外，从场外让 1 张所需能量为 0 的黄色角色以休息状态登场？",
      chooseFromHand("cost", { min: 1, max: 1, filter: handCostAtLeast(1), prompt: "选择手牌中 1 张所需能量 1 或更高的卡置于场外" }), moveChosen("cost", "sideline"),
      chooseFromSideline("card", { max: 1, filter: and(yellowCharacter, sidelineCostAtMost(0)), prompt: "从场外选择最多 1 张所需能量为 0 的黄色角色，以休息状态登场（攻击阶段结束时置于移除区）" }),
      ifThen(chosenCount("card"), [put("card", "choose", true), grantAbility(chosen("placed:card"), 1)]))])),
    givenOnly(when(["onAttackPhaseEnd"], remove("self")))
  ],

  // 整合运动士兵：【登场时】此角色通过我方的效果登场的场合，将此角色转为活跃状态，本回合中，『BP+2000』。通过我方的〈梅菲斯特〉的效果登场的场合，改为『BP+3000』。
  "UC01BT/ARK-1-022": [withCondition(onPlay(activate("self"), bp("self", (env) => (env.ctx.card(env.cause?.sourceCardId ?? "")?.name === "梅菲斯特" ? 3000 : 2000))),
    (env) => env.cause?.kind === "effect" && env.cause.byPlayerId === env.owner.accountId)],

  // 雪怪小队：〔前线中存在的场合〕我方场上的〈霜星〉，无法被没有特征“雪怪小队”的我方和对方的角色效果选择或转为休息状态。
  //          【启动主要】〔前线中存在的场合〕〔转为休息状态〕选择我方场上的1张〈霜星〉，转为活跃状态。
  "UC01BT/ARK-1-023": [
    staticAura((env, card, cardOwner) => cardOwner.accountId === env.owner.accountId && env.ctx.card(card.cardId)?.name === "霜星", { flags: ["onlyAffinityEffects:雪怪小队"] }, selfOnFront),
    activateMain({ costs: [restSelf], condition: selfOnFront }, chooseOwn("target", { min: 1, max: 1, filter: named("霜星"), prompt: "选择我方场上 1 张〈霜星〉转为活跃状态" }), activate(chosen("target")))
  ],

  // 霜星：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UC01BT/ARK-1-024": [onPlay(draw(1), discard(1))],

  // 霜星：【登场时】从我方的手牌或我方的场外将最多1张〈雪怪小队〉在我方的场上以休息状态登场。
  "UC01BT/ARK-1-025": [onPlay(
    chooseFromHand("card", { max: 1, filter: named("雪怪小队"), prompt: "从手牌选择最多 1 张〈雪怪小队〉以休息状态登场（不选则可从场外选择）" }),
    ifThen(noneChosen("card"), [chooseFromSideline("card", { max: 1, filter: named("雪怪小队"), prompt: "从场外选择最多 1 张〈雪怪小队〉以休息状态登场" })]),
    ifThen(chosenCount("card"), [put("card", "choose", true)]))],

  // 霜星：【启动主要】〔前线中存在的场合〕〔转为休息状态〕选择对方前线中的1张角色，转为休息状态。
  "UC01BT/ARK-1-026": [activateMain({ costs: [restSelf], condition: selfOnFront }, chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色转为休息状态" }), rest(chosen("target")))],

  // 霜星：此角色以活跃状态登场。
  //      当我方的主要阶段开始时，将我方生命区的1张卡牌置于场外，或将此角色退场。
  //      【启动主要】〔前线中存在的场合〕〔转为休息状态〕选择对方前线中的最多2张角色，转为休息状态。选择的角色下一次转为活跃状态无效。〈霜星〉的此效果1回合只能发动1次。
  "UC01BT/ARK-1-027": [
    onPlay(activate("self")),
    when(["onMainStart"], ifThen((env) => env.owner.life.length > 0, [
      chooseMode("mode", ["将我方生命区的1张卡牌置于场外", "将此角色退场"]),
      ifThen(modeIs("mode", 0), [run("将生命区的 1 张卡牌置于场外", (env) => { const slot = env.owner.life.shift(); if (slot) env.owner.sideline.push(slot.cardId); loseIfNoLife(env.game, env.players, env.owner); })], [sideline("self")])
    ], [sideline("self")])),
    activateMain({ costs: [restSelf], condition: all(selfOnFront, (env) => !markedThisTurn("霜星 1-027")(env)) },
      chooseOpponent("target", { line: "front", max: 2, prompt: "选择对方前线中最多 2 张角色转为休息状态（下一次转为活跃状态无效）" }), rest(chosen("target")),
      run("选择的角色下一次转为活跃状态无效（〈霜星〉的此效果本回合不能再发动）", (env) => {
        for (const card of chosenCards(env, "target")) if (card.rested) card.skipNextActivate = true;
        markTurn(env, "霜星 1-027");
      }))
  ],

  // 源石碎片（事件）：选择我方的最多2张AP卡牌，转为活跃状态。
  "UC01BT/ARK-1-029": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 烈焚灼息（事件）：我方的场上存在〈塔露拉〉的场合，手牌中此卡牌的消费AP-1。选择对方前线中的1张角色，置于移除区。
  "UC01BT/ARK-1-030": [
    costChange({ ap: 1 }, youHaveNamed("塔露拉")),
    onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, prompt: "选择对方前线中 1 张角色置于移除区" }), remove(chosen("target")))
  ],

  // Lullabye（事件）：选择对方前线中的1张BP不高于5000的角色，『转为休息状态。该角色下一次转为活跃状态无效』。我方的场上存在〈霜星〉的场合，可以改为『退场』。
  "UC01BT/ARK-1-031": [onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中 1 张 BP 不高于 5000 的角色" }),
    ifThen(all(youHaveNamed("霜星"), chosenCount("target")), [chooseMode("mode", ["转为休息状态。该角色下一次转为活跃状态无效", "退场"])]),
    ifThen(modeIs("mode", 1), [sideline(chosen("target"))], [restAndFreeze("target")]))],

  // 整合运动（事件）：从我方的手牌中或我方的场外将最多2张所需能量不高于2且消费AP为1的黄色角色在我方的场上以休息状态登场或进行突进。选择最多1张通过此效果登场的角色，转为活跃状态。
  "UC01BT/ARK-1-032": [onUse(
    ...fromHandOrSideline("first", and(yellowCharacter, apCostIs(1), handCostAtMost(2)), and(yellowCharacter, apCostIs(1), sidelineCostAtMost(2)), "所需能量不高于 2、消费 AP 为 1 的黄色角色（登场或突进）"),
    ifThen(chosenCount("first"), fromHandOrSideline("second", and(yellowCharacter, apCostIs(1), handCostAtMost(2)), and(yellowCharacter, apCostIs(1), sidelineCostAtMost(2)), "所需能量不高于 2、消费 AP 为 1 的黄色角色（第 2 张，登场或突进）")),
    chooseOwn("wake", { max: 1, filter: (env, _cardId, card) => !!card && placedUids(env).includes(card.uid), prompt: "选择最多 1 张通过此效果登场的角色转为活跃状态" }), activate(chosen("wake")))],

  // 辣味糖（事件）：1回合只能使用1张〈辣味糖〉。
  //               选择我方的最多1张AP卡牌，转为活跃状态。将我方前线中的1张活跃状态的角色转为休息状态，对方将自己前线中的1张活跃状态的角色转为休息状态。通过此效果将我方前线中的〈霜星〉转为休息状态的场合，将其转为活跃状态。
  "UC01BT/ARK-1-033": [{
    ...onUse(run("1回合只能使用1张〈辣味糖〉", (env) => markTurn(env, "辣味糖")), chooseAp("ap", 1), activateAp("ap"),
      chooseOwn("mine", { line: "front", min: 1, max: 1, filter: activeCard, prompt: "选择我方前线中 1 张活跃状态的角色转为休息状态" }), rest(chosen("mine")),
      { do: "choose", as: "theirs", from: "field", side: "opponent", chooser: "opponent", line: "front", filter: activeCard, min: 1, max: 1, prompt: "选择自己前线中 1 张活跃状态的角色转为休息状态", good: false }, rest(chosen("theirs")),
      ifThen((env) => chosenCards(env, "mine").some((card) => card.rested && env.ctx.card(card.cardId)?.name === "霜星"), [activate(chosen("mine"))])),
    useCondition: (env) => !markedThisTurn("辣味糖")(env)
  }
  ],

  // 霜星：【攻击时】确认对方场上休息状态的角色张数后，确认我方卡组最上方的相同数量卡牌。公开其中最多1张“特征：雪怪小队”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  //      【启动主要】〔前线中存在的场合〕〔将1张手牌置于场外〕「每回合1次」选择对方能量线中的1张角色，转为休息状态。
  "UC01ST/ARK-1-111": [
    onAttack(run("确认与对方场上休息角色张数相同数量的卡组最上方的卡牌", (env) => { env.game.looking = { ownerId: env.owner.accountId, cards: env.owner.library.splice(0, opponentRestedCharacters(env)) }; }),
      chooseLooked("pick", { max: 1, filter: withAffinity("雪怪小队"), prompt: "公开最多 1 张“特征：雪怪小队”的卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom()),
    activateMain({ costs: [discardCost(1)], condition: selfOnFront, once: true }, chooseOpponent("target", { line: "energy", min: 1, max: 1, prompt: "选择对方能量线中 1 张角色转为休息状态" }), rest(chosen("target")))
  ],

  // 米莎：【登场时】可以将我方场上的最多2张所需能量为0的活跃状态的角色转为休息状态。没有将2张角色转为休息状态的场合，将此角色放回我方的手牌。
  "UCEX01BT/ARK-2-001": [onPlay(chooseOwn("cost", { max: 2, filter: and(energyCostIs(0), activeCard), prompt: "可以将我方场上最多 2 张所需能量为 0 的活跃角色转为休息状态（不足 2 张时「米莎」放回手牌）" }), rest(chosen("cost")),
    ifThen((env) => restedCount(env, "cost") < 2, [toHand("self")]))],

  // Guard：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UCEX01BT/ARK-2-002": [onPlay(draw(1), discard(1))],

  // W：【启动主要】〔前线中存在的场合〕「每回合1次」选择我方能量线中的1张所需能量不高于4的角色，与此角色交换位置。
  "UCEX01BT/ARK-2-003": [activateMain({ condition: all(selfOnFront, (env) => !flagsOf(env.self!).includes("cannotMove")), once: true },
    chooseOwn("target", { line: "energy", min: 1, max: 1, filter: and(energyCostAtMost(4), canMove), prompt: "选择我方能量线中 1 张所需能量不高于 4 的角色，与「W」交换位置" }),
    run("与此角色交换位置", (env) => {
      const other = chosenCards(env, "target")[0];
      const self = env.self;
      if (!other || !self) return;
      const owner = env.owner;
      owner.front = owner.front.map((card) => (card === self ? other : card));
      owner.energy = owner.energy.map((card) => (card === other ? self : card));
      queueCardEvent(env.game, env.ctx, "onMoveToEnergy", owner, self);
      queueCardEvent(env.game, env.ctx, "onMoveToFront", owner, other);
    }))],

  // W：《撤步》「每回合1次」当此角色从前线移动至能量线时，选择对方前线中的最多1张角色退场。选择对方前线中的最多1张BP1500或更高的角色，本回合中，BP-1000。
  //   【退场时】抽取2张卡牌。
  "UCEX01BT/ARK-2-004": [
    oncePerTurn(when(["onMoveToEnergy"], chooseOpponent("out", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色退场" }), sideline(chosen("out")),
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(1500), prompt: "选择对方前线中最多 1 张 BP1500 或更高的角色（本回合 BP-1000）" }), bp(chosen("target"), -1000))),
    onSidelined(draw(2))
  ],

  // 塔露拉：【登场时】可以将我方场上的最多2张活跃状态的角色转为休息状态。这样做的场合，从我方的手牌中将最多1张所需能量不高于2且消费AP为1的黄色角色卡牌在我方的场上以休息状态登场。
  "UCEX01BT/ARK-2-005": [onPlay(chooseOwn("cost", { max: 2, filter: activeCard, prompt: "可以将我方场上最多 2 张活跃角色转为休息状态（这样做时可从手牌登场 1 张角色）" }), rest(chosen("cost")),
    ifThen((env) => restedCount(env, "cost") >= 1, [
      chooseFromHand("card", { max: 1, filter: and(yellowCharacter, apCostIs(1), handCostAtMost(2)), prompt: "从手牌选择最多 1 张所需能量不高于 2、消费 AP 为 1 的黄色角色，以休息状态登场" }),
      ifThen(chosenCount("card"), [put("card", "choose", true)])
    ]))],

  // 爱国者：【登场时】对方将自己场上的2张活跃状态的角色转为休息状态。
  "UCEX01BT/ARK-2-006": [onPlay({ do: "choose", as: "theirs", from: "field", side: "opponent", chooser: "opponent", filter: activeCard, min: 2, max: 2, prompt: "选择自己场上 2 张活跃状态的角色转为休息状态", good: false }, rest(chosen("theirs")))],

  // 爱国者：【我方的回合中】对方的场上存在2张或更多休息状态的角色的场合，此角色获得《冲击1》和《伤害2》。
  //        【登场时】选择对方能量线中的最多1张角色，转为休息状态。该角色下一次转为活跃状态无效。此角色直到下一个我方的回合开始时为止，BP+1000。
  //        【启动主要】〔前线中存在的场合〕「每回合1次」发动此角色的【登场时】效果。
  "UCEX01BT/ARK-2-007": [
    staticSelf({ keywords: ["冲击1", "伤害2"] }, all(duringYourTurn, opponentRestedAtLeast(2))),
    onPlay(...patriotSteps),
    activateMain({ condition: selfOnFront, once: true }, ...patriotSteps)
  ],

  // 梅菲斯特：【我方的回合中】当此角色通过我方的效果离开场上时，抽取1张卡牌。
  "UCEX01BT/ARK-2-008": [withCondition(when(["onLeaveField"], draw(1)), all(duringYourTurn, (env) => env.cause?.kind === "effect" && env.cause.byPlayerId === env.owner.accountId))],

  // 梅菲斯特・歌者：【启动主要】〔前线中存在的场合〕「每回合1次」发动此角色的【退场时】效果。
  //               【退场时】对方前线中的所有BP1500或更高的角色，本回合中，BP-1000。
  "UCEX01BT/ARK-2-009": [
    activateMain({ condition: selfOnFront, once: true }, bp(singerTargets, -1000)),
    onSidelined(bp(singerTargets, -1000))
  ],

  // 霜星：【登场时】对方的场上休息状态的角色每有2张，抽取1张卡牌。
  "UCEX01BT/ARK-2-010": [onPlay(run("对方场上的休息角色每有 2 张，抽 1 张卡", (env) => drawSome(env, Math.floor(opponentRestedCharacters(env) / 2))))],

  // 活生生的怪物（事件）：抽取1张卡牌，将我方能量线中的所有休息状态的角色，转为活跃状态。通过此效果将3张或更多的卡牌转为活跃状态的场合，选择我方的最多1张AP卡牌，转为活跃状态。
  "UCEX01BT/ARK-2-011": [onUse(draw(1),
    run("将我方能量线中所有休息状态的角色转为活跃状态", (env) => {
      const woke: string[] = [];
      for (const card of env.owner.energy) {
        if (!card.rested || !isCharacter(env, card)) continue;
        if (card.skipNextActivate) { card.skipNextActivate = false; continue; }
        card.rested = false;
        woke.push(card.uid);
      }
      env.vars.woke = woke;
    }),
    ifThen(chosenCount("woke", 3), [chooseAp("ap", 1), activateAp("ap")]))],

  // 被继承的意志（事件）：从我方的场外将最多1张所需能量不高于1且消费AP为1的黄色的角色卡牌在我方的场上以休息状态登场或进行突进。之后，我方场上的所有所需能量不高于2的角色，本回合中，BP+1000。
  "UCEX01BT/ARK-2-012": [onUse(
    chooseFromSideline("card", { max: 1, filter: and(yellowCharacter, apCostIs(1), sidelineCostAtMost(1)), prompt: "从场外选择最多 1 张所需能量不高于 1、消费 AP 为 1 的黄色角色（登场或突进）" }),
    ifThen(chosenCount("card"), putOrRaid("card")),
    bp((env) => fieldCharacters(env, env.owner).filter((card) => (env.ctx.card(card.cardId)?.energyCost ?? 99) <= 2), 1000))]
};
