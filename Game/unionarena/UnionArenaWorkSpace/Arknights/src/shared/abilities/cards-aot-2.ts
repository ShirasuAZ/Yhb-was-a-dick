/**
 * Abilities of the AOT cards, batch 2 (UE10BT/AOT-1-036 … 069; see cards.ts for the conventions). Each entry follows the card's printed text,
 * shown above it. The keyword lines that start a line (《Raid》, …) and the life-card trigger are read from the card data and not repeated.
 *
 * Left out (stays manual): AOT-1-057 Bertholdt Hoover (Colossal Titan): "The number of cards you can place onto your front line is reduced by
 * one" would change the line limit in the engine, the client and the computer players' move generation.
 *
 * Notes on the data: an AOT card's affinities are one string joined by "／" ("104th Cadet Corps／Marleyan Warrior／Inheritor of the Titan"),
 * so the filters here split it. `keywords` of 061 lacks the Impact / Nullify Impact it prints, so 061 gives them to itself.
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, costOf, energyOf, flagsOf, LINE_LIMIT, raidByEffect, raidTargetMatches, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step, Target } from "./types.ts";
import {
  activateAp, activateMain, and, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseLooked, chooseMode, chooseOpponent, chooseOwn, chosen, chosenCount, costChange,
  discard, discardCost, draw, duringOpponentTurn, duringYourTurn, either, energyCostAtMost, energyThisTurn, flag, givenOnly, grant, grantAbility, ifThen, isCharacterCard,
  look, lookedToBottom, moveChosen, notSelf, ofColor, onPlay, onSidelined, onUse, put, restSelf, run, selfActive, selfOnFront, sideline, staticSelf, toHand, when,
  withCondition, chooseFromSideline
} from "./dsl.ts";

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;

// ---- Helpers for the AOT cards ----

const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
/** The card's affinities, one by one (the data joins them with "／" inside one string). */
const affinitiesOf = (env: AbilityEnv, cardId: string): string[] => (env.ctx.card(cardId)?.affinities ?? []).flatMap((entry) => entry.split(/[／/]/));
const hasAffinity = (affinity: string): CardFilter => (env, cardId) => affinitiesOf(env, cardId).includes(affinity);
const pureTitan = hasAffinity("Pure Titan");
const nameIncludes = (part: string): CardFilter => (env, cardId) => (env.ctx.card(cardId)?.name ?? "").includes(part);
/** The number of our field cards that meet a filter. */
const countOwn = (env: AbilityEnv, filter: CardFilter): number => fieldOf(env.owner).filter((card) => filter(env, card.cardId, card)).length;
/** 我方场上存在 [affinity] 的卡牌 (at least `count`). */
const youHaveAffinity = (affinity: string, count = 1): Condition => (env) => countOwn(env, hasAffinity(affinity)) >= count;
/** 我方的场上存在卡牌名中含有 "part" 的角色 */
const youHaveNameIncluding = (part: string): Condition => (env) => fieldOf(env.owner).some((card) => isCharacter(env, card) && nameIncludes(part)(env, card.cardId, card));
/** All [Pure Titan] affinity cards (characters) on our field. */
const ownPureTitans: Target = (env) => fieldOf(env.owner).filter((card) => isCharacter(env, card) && pureTitan(env, card.cardId, card));
/** Required energy of a hand card now (with cost changes). */
const handCost = (env: AbilityEnv, cardId: string): number => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy;
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => handCost(env, cardId) <= limit;
const handCostAtLeast = (limit: number): CardFilter => (env, cardId) => handCost(env, cardId) >= limit;

/** 我方的产生能量合计N或更多 */
const COLORS = ["red", "green", "blue", "yellow", "purple"];
const energyGeneration = (env: AbilityEnv): number => COLORS.reduce((sum, color) => sum + energyOf(env.ctx, env.owner, color), 0);
const sixEnergy: Condition = (env) => energyGeneration(env) >= 6;
/** 对方的前线中存在活跃状态的角色 */
const opponentFrontHasActive: Condition = (env) => env.opponent.front.some((card) => isCharacter(env, card) && !card.rested);

/** Records a "1回合只能……1次" use for the owner this turn (EngineGame.turnMarks, "<turn>:<owner>:<text>"). */
const markTurn = (text: string) => (env: AbilityEnv): void => { env.game.turnMarks = [...(env.game.turnMarks ?? []), `${env.game.turn}:${env.owner.accountId}:${text}`]; };
const markedThisTurn = (text: string): Condition => (env) => (env.game.turnMarks ?? []).includes(`${env.game.turn}:${env.owner.accountId}:${text}`);

/** 获得“当主要阶段结束时，将此角色退场” (given with grantAbility). */
const sidelineAtMainEnd = givenOnly(when(["onMainEnd"], sideline("self")));

/** Play up to one card with 2 or less required energy, 1 AP cost and [Pure Titan] affinity from your hand set to resting onto your field. */
const playSmallPureTitan: Step[] = [
  chooseFromHand("card", { max: 1, filter: and(handCostAtMost(2), apCostIs(1), pureTitan), prompt: "从手牌选择最多 1 张所需能量不高于 2、消费 AP 为 1 的 [Pure Titan] 卡以休息状态登场" }),
  ifThen(chosenCount("card"), [put("card", "choose", true)])
];

/** Draw a card, then place one card from your hand into your sideline. */
const drawThenDiscard: Step[] = [draw(1), discard(1)];

// Play a hand card onto the front line set to active, or perform Raid with it (AOT-1-064).
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;
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
const putActiveOrRaid = (name: string): Step[] => [
  ifThen((env) => raidTargetsFor(env, name).length > 0, [chooseMode(`${name}:how`, ["以活跃状态登场到前线", "进行突进"])]),
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
  ], [put(name, "front", false)])
];
const bigGreenCharacter = and(isCharacterCard, ofColor("green"), handCostAtLeast(4), apCostIs(1));
/** Play up to two green characters with 4 or more required energy and 1 AP cost from your hand (one question each). */
const playUpToTwoBig: Step[] = ["first", "second"].flatMap((which): Step[] => [
  chooseFromHand(`big:${which}`, { max: 1, filter: bigGreenCharacter, prompt: `从手牌选择最多 1 张所需能量 4 或更高、消费 AP 为 1 的绿色角色（${which === "first" ? "第 1" : "第 2"} 张），以活跃状态登场到前线或对我方场上的角色进行突进` }),
  ifThen(chosenCount(`big:${which}`), putActiveOrRaid(`big:${which}`))
]);
/** Look at the top seven cards, reveal up to two green character cards among them and add them to your hand; the rest go to the bottom. */
const lookSevenTakeTwo: Step[] = [
  look(7),
  chooseLooked("pick", { max: 2, filter: and(isCharacterCard, ofColor("green")), prompt: "公开最多 2 张绿色角色卡并加入手牌" }),
  moveChosen("pick", "hand"),
  lookedToBottom()
];

export const AOT_2_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // Kenny Ackermann:
  //   《Activate: Main》 《Once Per Turn》 You can only activate this ability on the turn this character is played. Choose one character on your opponent's front line with BP equal to or less than this character's BP and sideline it.
  //   《Activate: Main》 《Place 1 Card From Hand Into Sideline》 This character gains 1000 BP until the end of the turn.
  // (The third entry is bookkeeping: it marks the card as played this turn, for the first ability.)
  "UE10BT/AOT-1-036": [
    activateMain({ once: true, condition: (env) => !!env.self && flagsOf(env.self).includes("playedThisTurn") },
      chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (env.self ? bpOf(env.ctx, env.self) : 0)), prompt: "选择对方前线中 1 张 BP 不高于此角色 BP 的角色退场" }),
      sideline(chosen("target"))),
    activateMain({ costs: [discardCost(1)] }, bp("self", 1000)),
    onPlay(flag("self", "playedThisTurn"))
  ],

  // Rod Reiss: 《When Played》 Choose up to one other character on your field. It gains 1000 BP until the end of the turn.
  "UE10BT/AOT-1-037": [onPlay(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // Rod Reiss (Titan):
  //   《During Your Turn》 This character gains 2000 BP. If there is an active character on your opponent's front line, this character also gains 《Damage (2)》
  //   《When Sidelined》 Draw a card.
  "UE10BT/AOT-1-038": [
    staticSelf({ bp: 2000 }, duringYourTurn),
    staticSelf({ keywords: ["伤害2"] }, (env) => duringYourTurn(env) && opponentFrontHasActive(env)),
    onSidelined(draw(1))
  ],

  // Cart Titan: 《When Played》 Return one other character on your field with 1 or less required energy to your hand. If you cannot, return this character to your hand.
  "UE10BT/AOT-1-039": [onPlay(chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }), toHand(chosen("target")), ifThen((env) => (env.vars.target ?? []).length === 0, [toHand("self")]))],

  // Pure Titan (Small Titan): 《When Played》 Draw a card.
  "UE10BT/AOT-1-040": [onPlay(draw(1))],

  // Pure Titans (Zeke's Titans): 《When Played》 Draw a card, then place one card from your hand into your sideline.
  "UE10BT/AOT-1-041": [onPlay(...drawThenDiscard)],

  // Pure Titan (Peering Titan): -   (no ability text)
  "UE10BT/AOT-1-042": [],
  // Pure Titan (Bearded Titan): -   (no ability text)
  "UE10BT/AOT-1-043": [],
  // Zeke Jaeger (0): -   (no ability text)
  "UE10BT/AOT-1-045": [],

  // Zeke Jaeger: 《Activate: Main》 《Switch to Resting》 Choose one [Pure Titan] affinity card on your field. It gains 1000 BP until the end of the turn.
  "UE10BT/AOT-1-046": [activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, filter: pureTitan, prompt: "选择我方场上 1 张 [Pure Titan] 卡（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // Zeke Jaeger:
  //   《During Your Turn》 If you have three or more [Pure Titan] affinity cards on your field, this character gains 1500 BP.
  //   《When Played》 Play up to one card with 2 or less required energy, 1 AP cost, and [Pure Titan] affinity from your hand set to resting onto your field.
  "UE10BT/AOT-1-047": [
    staticSelf({ bp: 1500 }, (env) => duringYourTurn(env) && youHaveAffinity("Pure Titan", 3)(env)),
    onPlay(...playSmallPureTitan)
  ],

  // Zeke Jaeger (Beast Titan):
  //   For each card with [Pure Titan] affinity on your field, reduce this card's required energy by 《Green×1》 while anywhere other than on your field.
  //   《Raid》 <Zeke Jaeger> Switch to active. May move to the front line.
  //   《When Played》 All [Pure Titan] affinity cards on your field gain 1000 BP until the end of the turn.
  //   《Activate: Main》 《Once Per Turn》 Choose up to one [Pure Titan] affinity card on your field. It gains 《Impact (1)》 until the end of the turn. If this character is on your front line, all [Pure Titan] affinity cards on your field gain 1000 BP until the end of the turn.
  "UE10BT/AOT-1-048": [
    costChange({ energy: (env) => countOwn(env, pureTitan) }),
    onPlay(bp(ownPureTitans, 1000)),
    activateMain({ once: true }, chooseOwn("target", { max: 1, filter: pureTitan, prompt: "选择我方场上最多 1 张 [Pure Titan] 卡（本回合获得《冲击1》）" }), grant(chosen("target"), "冲击1"),
      ifThen(selfOnFront, [bp(ownPureTitans, 1000)]))
  ],

  // Pure Titan (Relaxing Titan): 《When Sidelined》 Play up to one card with 2 or less required energy, 1 AP cost, and [Pure Titan] affinity from your hand set to resting onto your field.
  "UE10BT/AOT-1-049": [onSidelined(...playSmallPureTitan)],

  // Annie Leonhart: 《When Played》 Draw a card, then place one card from your hand into your sideline.
  "UE10BT/AOT-1-050": [onPlay(...drawThenDiscard)],

  // Annie Leonhart: 《When Played》 Look at the top three cards of your deck. Reveal up to one [Marleyan Warrior] or [Pure Titan] affinity card among them and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If you added a card to your hand, place one card from your hand into your sideline.
  "UE10BT/AOT-1-051": [onPlay(look(3), chooseLooked("pick", { max: 1, filter: either(hasAffinity("Marleyan Warrior"), pureTitan), prompt: "公开最多 1 张 [Marleyan Warrior] 或 [Pure Titan] 卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // Annie Leonhart: If this character is active, it gains 《Green》 energy generation.
  "UE10BT/AOT-1-052": [staticSelf({ energy: 1 }, selfActive)],

  // Annie Leonhart (Female Titan):
  //   《Raid》 <Annie Leonhart> Switch to active. May move to the front line.
  //   《If on the Front Line》 When a [Marleyan Warrior] affinity card performs Raid from your hand, reduce its required energy by 《Green×1》.
  //   《When Played》 Play up to one green character card with 3 or less required energy and 1 AP cost from your hand set to resting onto your field.
  //   《When Sidelined》 Return up to one base card of this Raided character to your hand.
  "UE10BT/AOT-1-053": [
    { kind: "cost", energy: 1, condition: selfOnFront, fromField: (env, handCardId, raiding) => raiding && hasAffinity("Marleyan Warrior")(env, handCardId, null) },
    onPlay(chooseFromHand("card", { max: 1, filter: and(isCharacterCard, ofColor("green"), handCostAtMost(3), apCostIs(1)), prompt: "从手牌选择最多 1 张所需能量不高于 3、消费 AP 为 1 的绿色角色以休息状态登场" }), ifThen(chosenCount("card"), [put("card", "choose", true)])),
    onSidelined(chooseFromSideline("base", { max: 1, filter: (env, cardId) => (env.cause?.under ?? []).includes(cardId), prompt: "选择此突进角色的最多 1 张突进源卡牌加入手牌" }), moveChosen("base", "hand"))
  ],

  // Bertholdt Hoover: 《Activate: Main》 《Switch to Resting》 《Once Per Turn》 This character gains 《Green》 energy generation until the end of the turn. At the end of the main phase, sideline this character.
  "UE10BT/AOT-1-054": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    sidelineAtMainEnd
  ],

  // Bertholdt Hoover: 《When Played》 If you have 6 or more energy generation, draw a card.
  "UE10BT/AOT-1-055": [withCondition(onPlay(draw(1)), sixEnergy)],

  // Bertholdt Hoover: This character generates energy even if it is on the front line.
  "UE10BT/AOT-1-056": [staticSelf({ flags: ["energyOnFront"] })],

  // Bertholdt Hoover (Colossal Titan): left out (see the top of the file).

  // Reiner Braun: -   (no ability text)
  "UE10BT/AOT-1-058": [],

  // Reiner Braun: If you have 6 or more energy generation, this character gains 1000 BP.
  "UE10BT/AOT-1-059": [staticSelf({ bp: 1000 }, sixEnergy)],

  // Reiner Braun: 《When Played》 Draw two cards, then place one card from your hand into your sideline.
  "UE10BT/AOT-1-060": [onPlay(draw(2), discard(1))],

  // Reiner Braun (Armored Titan):
  //   《Raid》 <Reiner Braun> Switch to active. May move to the front line.
  //   《Impact (1)》 (When this character attacks and wins a battle, deal 1 damage to your opponent.)
  //   《Nullify Impact》 (The character battling this character loses 《Impact》 for the duration of this battle.)
  //   《During Opponent's Turn》 Your opponent cannot choose this character with abilities on character or event cards unless they pay 1 AP as an additional cost.
  // (Impact (1) and Nullify Impact are missing from the card data's keywords, so this card gives them to itself.)
  "UE10BT/AOT-1-061": [
    staticSelf({ keywords: ["冲击1", "冲击无效"] }),
    staticSelf({ flags: ["taxAp:character", "taxAp:event"] }, duringOpponentTurn)
  ],

  // Titan Forest (site): 《Activate: Main》 《Switch to Resting》 《Place 1 Card From Hand Into Sideline》 《Once Per Turn》 This site gains 《Green》 energy generation until the end of the turn.
  "UE10BT/AOT-1-062": [activateMain({ costs: [restSelf, discardCost(1)], once: true }, energyThisTurn("self", 1))],

  // Titan Injection (event): Look at the top four cards of your deck. Reveal one card among them and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If the card you revealed has [Pure Titan] affinity or "Rod Reiss" or "Zeke Jaeger" in its card name, choose up to one of your AP cards and switch it to active.
  "UE10BT/AOT-1-063": [onUse(
    look(4),
    chooseLooked("pick", { min: 1, max: 1, prompt: "公开其中 1 张卡并加入手牌" }),
    run("确认公开的卡牌是否为 [Pure Titan] 或卡名含有 Rod Reiss / Zeke Jaeger", (env) => {
      const key = env.vars.pick?.[0];
      const cardId = key ? env.game.looking?.cards[Number(key.slice(2))] : undefined;
      if (cardId && either(pureTitan, nameIncludes("Rod Reiss"), nameIncludes("Zeke Jaeger"))(env, cardId, null)) env.vars.hit = ["1"];
    }),
    moveChosen("pick", "hand"),
    lookedToBottom(),
    ifThen(chosenCount("hit"), [chooseAp("ap", 1), activateAp("ap")])
  )],

  // We Fight Now!! We Decide This Right Here!! (event):
  //   {Choose one} of the abilities listed below. If there is a character with "Reiner Braun" in its card name on your field, {Choose all} instead.
  //   ・Look at the top seven cards of your deck. Reveal up to two green character cards among them and add them to your hand. Place the remaining cards on the bottom of your deck in any order.
  //   ・Play up to two green character cards with 4 or more required energy and 1 AP cost from your hand set to active onto your front line or perform Raid with them on characters on your field.
  "UE10BT/AOT-1-064": [onUse(
    ifThen(youHaveNameIncluding("Reiner Braun"), [...lookSevenTakeTwo, ...playUpToTwoBig], [
      chooseMode("mode", ["查看卡组最上方的 7 张卡，公开最多 2 张绿色角色卡并加入手牌", "从手牌将最多 2 张所需能量 4 或更高、消费 AP 为 1 的绿色角色以活跃状态登场到前线或进行突进"]),
      ifThen(modeIs("mode", 0), lookSevenTakeTwo, playUpToTwoBig)
    ])
  )],

  // Marleyan Warriors (event): Choose up to two of your AP cards and switch them to active.
  "UE10BT/AOT-1-065": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // I'm Going For a Perfect Game. (event): Choose one character with {3000 or less BP} on your opponent's front line and sideline it. If there is a character with "Zeke Jaeger" in its card name on your field, {5000 or less BP} instead.
  "UE10BT/AOT-1-066": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (youHaveNameIncluding("Zeke Jaeger")(env) ? 5000 : 3000)), prompt: "选择对方前线中 1 张 BP 不高于 3000（我方场上有卡名含 Zeke Jaeger 的角色时为 5000）的角色退场" }),
    sideline(chosen("target"))
  )],

  // Are We Doing It?! Now...?! Here?! (event):
  //   You can only use one <Are We Doing It?! Now...?! Here?!> card per turn.
  //   Choose one card on your field. It gains "This card gains 《Green》《Green》 energy generation" until the end of the turn. If there is a character with "Bertholdt Hoover" in its card name on your field, choose up to one of your AP cards and switch it to active.
  "UE10BT/AOT-1-067": [{
    ...onUse(
      run("本回合已使用过〈Are We Doing It?! Now...?! Here?!〉", markTurn("Are We Doing It?! Now...?! Here?!")),
      { do: "choose", as: "target", from: "field", side: "you", min: 1, max: 1, characters: false, prompt: "选择我方场上的 1 张卡（本回合产生能量 +《Green》《Green》）", good: true },
      flag(chosen("target"), "extraEnergy:green:2"),
      ifThen(youHaveNameIncluding("Bertholdt Hoover"), [chooseAp("ap", 1), activateAp("ap")])
    ),
    useCondition: (env) => !markedThisTurn("Are We Doing It?! Now...?! Here?!")(env)
  }],

  // Carla Jaeger: 《Activate: Main》 《Switch to Resting》 《Once Per Turn》 This character gains 《Red》 energy generation until the end of the turn. At the end of the main phase, sideline this character.
  "UE10BT/AOT-1-068": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    sidelineAtMainEnd
  ],

  // Hange Zoë: 《When Played》 If you have an [Inheritor of the Titan] affinity card on your field, draw a card.
  "UE10BT/AOT-1-069": [withCondition(onPlay(draw(1)), youHaveAffinity("Inheritor of the Titan"))]
};
