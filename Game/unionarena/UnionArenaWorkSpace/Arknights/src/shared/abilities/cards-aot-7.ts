/**
 * Abilities of the AOT cards, batch 7: UEX07BT/AOT-2-037 … 073 (the blue, green and red cards of the set; see cards.ts for the conventions). Each entry
 * follows the card's printed text, shown above it. The keyword lines that start a line (《Raid》, 《Nullify Impact》 …) and the life-card trigger are read
 * from the card data and not repeated. Cards printing "-" (054, 057) have no ability text and need no entry.
 *
 * Left out (stays manual): UEX07BT/AOT-2-069 Armin Arlelt (Colossal Titan): "The number of cards you can place onto your front line is reduced by one"
 * would change the line limit (LINE_LIMIT) in the engine, the client and the computer players' move generation (like UE10BT/AOT-1-057 in batch 2).
 *
 * Engine pieces these cards use (added for this batch): `nextUseAffinityApCut` (062 Nicolo), the "attackFromEnergyLine" mark (056 Pieck Finger), the
 * "playOnlyByAbility" mark (067 Mikasa Ackermann) and the hand-zone event "onEndStartInHand" with `returnedToHandInAttackPhase` (066 Mikasa Ackermann).
 *
 * Notes on the data: an AOT card's affinities are one string joined by "／"; the engine splits them (`withAffinity("Marleyan Warrior")` works).
 * `keywords` of 060 lacks the Nullify Impact it prints, so 060 gives it to itself.
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, costOf, loseIfNoLife } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, activeCard, all, and, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent,
  chooseOwn, chosen, chosenCount, costChange, discard, discardCost, draw, either, energyCostAtMost, energyThisTurn, flag, grant, ifThen, isCharacterCard, look,
  lookedToBottom, may, mayPayApEffect, moveChosen, nextUseAffinityApCut, notSelf, ofColor, onAttack, onPlay, onSidelined, onUse, put, rest, restSelf, returnedToHandInAttackPhase,
  run, selfOnEnergy, selfOnFront, sideline, staticSelf, usedAffinityThisTurn, when, withAffinity, withCondition, youHaveNamed
} from "./dsl.ts";

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;

// ---- Helpers for the AOT cards ----

const fieldCharacters = (env: AbilityEnv): UnionArenaFieldCard[] => [...env.owner.front, ...env.owner.energy].filter((card) => env.ctx.card(card.cardId)?.type === "character");
const isEventCard: CardFilter = (env, cardId) => env.ctx.card(cardId)?.type === "event";
const nameIncludes = (part: string): CardFilter => (env, cardId) => (env.ctx.card(cardId)?.name ?? "").includes(part);
const noRaid: CardFilter = (env, cardId) => !env.ctx.card(cardId)?.raid;
const cadet = withAffinity("104th Cadet Corps");
const marleyan = withAffinity("Marleyan Warrior");
const pureTitan = withAffinity("Pure Titan");
/** BP equal to or more than N (field cards). */
const bpAtLeast = (limit: number): CardFilter => (env, _cardId, card) => !!card && bpOf(env.ctx, card) >= limit;
/** This character has N or more BP now. */
const selfBpAtLeast = (limit: number): Condition => (env) => !!env.self && bpOf(env.ctx, env.self) >= limit;
/** Required energy of a hand card now (with cost changes). */
const handCost = (env: AbilityEnv, cardId: string): number => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy;
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => handCost(env, cardId) <= limit;
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;
const handNotEmpty: Condition = (env) => env.owner.hand.length > 0;
const lifeAtMost = (count: number): Condition => (env) => env.owner.life.length <= count;

/** Event cards in our sideline. */
const eventsInSideline = (env: AbilityEnv): number => env.owner.sideline.filter((cardId) => env.ctx.card(cardId)?.type === "event").length;
/** 我方场外的事件卡牌存在N张或更多 */
const eventsInSidelineAtLeast = (count: number): Condition => (env) => eventsInSideline(env) >= count;

/** The chosen character (by its name in `vars`) is Raided: a card lies under it. */
const chosenRaided = (name: string): Condition => (env) => (env.vars[name] ?? []).some((uid) => fieldCharacters(env).some((card) => card.uid === uid && card.under.length > 0));
/** 1000 BP, or 2000 BP if the chosen character is Raided. */
const raidedBonus = (name: string) => (env: AbilityEnv): number => (chosenRaided(name)(env) ? 2000 : 1000);
/** "Choose up to one other [Marleyan Warrior] affinity card on your field." */
const chooseOtherMarleyan = (as: string): Step => chooseOwn(as, { max: 1, filter: and(notSelf, marleyan), prompt: "选择我方场上最多 1 张其他 [Marleyan Warrior] 卡" });

/** 我方场上存在N张或更多卡牌名互不相同、没有 [Rumbling] 的黄色角色 */
const uniqueYellowAtLeast = (count: number): Condition => (env) => {
  const names = new Set(fieldCharacters(env)
    .filter((card) => ofColor("yellow")(env, card.cardId, card) && !withAffinity("Rumbling")(env, card.cardId, card))
    .map((card) => env.ctx.card(card.cardId)?.name));
  return names.size >= count;
};

/** "<ability text>的此效果1回合只能发动1次": marks on the game for this turn, per player (EngineGame.turnMarks). */
const turnMarkKey = (env: AbilityEnv, text: string): string => `${env.game.turn}:${env.owner.accountId}:${text}`;
const notMarkedThisTurn = (text: string): Condition => (env) => !(env.game.turnMarks ?? []).includes(turnMarkKey(env, text));
const markThisTurn = (text: string): Step => run("本回合已发动过此效果", (env) => { env.game.turnMarks = [...(env.game.turnMarks ?? []), turnMarkKey(env, text)]; });

/** Draw a card, then place one card from your hand into your sideline. */
const drawThenDiscard: Step[] = [draw(1), discard(1)];

/** Looks at the top cards and adds up to one that meets the filter to the hand; the rest go to the bottom of the deck in any order. */
const lookTakeOneToBottom = (count: number, filter: CardFilter, prompt: string): Step[] => [
  look(count), chooseLooked("pick", { max: 1, filter, prompt }), moveChosen("pick", "hand"), lookedToBottom()
];

const lookedStep = (as: string, extra: Partial<Extract<Step, { do: "choose" }>>): Step =>
  ({ do: "choose", as, from: "looked", side: "you", min: 0, max: 99, prompt: "", good: true, ...extra });
/** Puts the picked looked-at cards on top of the deck (the first pick on top); any other looked-at card goes to the bottom. */
const placeLookedOnTop = (...names: string[]): Step => run("确认的卡牌按选择的顺序置于卡组最上方", (env) => {
  const looking = env.game.looking;
  if (!looking) return;
  const keys = names.flatMap((name) => env.vars[name] ?? []);
  const kept = keys.map((key) => looking.cards[Number(key.slice(2))]).filter((cardId): cardId is string => !!cardId);
  const others = looking.cards.filter((_, index) => !keys.includes(`l:${index}`));
  looking.cards = [];
  env.owner.library.unshift(...kept);
  env.owner.library.push(...others);
});
/** 将它们自选顺序置于我方卡组的最上方 (all of the looked-at cards; the first card picked ends up on top). */
const allLookedOnTop = (): Step[] => [
  lookedStep("top", { all: true, prompt: "依次点选确认的卡，按点选顺序放到卡组最上方（先点的在最上面）" }),
  placeLookedOnTop("top")
];

/** Takes the top card of the owner's life area (the player cannot know which one it is) into the hand; remembers it under `vars.moved`. */
const lifeToHand = run("将我方生命区的 1 张卡牌加入手牌", (env) => {
  const slot = env.owner.life.shift();
  if (!slot) return;
  env.owner.hand.push(slot.cardId);
  env.vars.moved = ["1"];
  loseIfNoLife(env.game, env.players, env.owner);
});

/** Choose up to one character with `limit` or less BP on your opponent's front line and sideline it (`vars.target` is empty when none was chosen). */
const sidelineUpTo = (limit: number): Step[] => [
  chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(limit), prompt: `选择对方前线最多 1 张 BP 不高于 ${limit} 的角色退场` }),
  sideline(chosen("target"))
];

const SASHA_065_LIMIT = "Sasha Braus 065 When Played";
const MIKASA_066_LIMIT = "Mikasa Ackermann 066 End Phase";
/** A red [104th Cadet Corps] affinity card (a card number). */
const redCadet = (env: AbilityEnv, cardId: string): boolean => ofColor("red")(env, cardId, null) && cadet(env, cardId, null);
/** Whether the character was played or Raided this turn (the engine remembers what came onto the field). */
const enteredThisTurn: Condition = (env) => !!env.self && (env.game.entered ?? []).some((entry) => entry.turn === env.game.turn && entry.ownerId === env.owner.accountId && entry.uid === env.self!.uid);

export const AOT_7_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // I'll Do It. Everyone Cover Me (event):
  // If you have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field, reduce this card's AP cost by 1 while in your hand.
  // Choose one character with {5000 or less BP} on your opponent's front line and sideline it. If <Mikasa Ackermann> is on your field, {8000 or less BP} instead.
  // (Read "card names are unique" as four characters with four different names.)
  "UEX07BT/AOT-2-037": [
    costChange({ ap: 1 }, uniqueYellowAtLeast(4)),
    onUse(
      chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (youHaveNamed("Mikasa Ackermann")(env) ? 8000 : 5000)), prompt: "选择对方前线 1 张 BP 不高于 5000（我方场上有〈Mikasa Ackermann〉时为 8000）的角色退场" }),
      sideline(chosen("target"))
    )
  ],

  // Hange Zoë: 《When Played》 Choose up to one other character on your field. It gains 1000 BP until the end of the turn.
  "UEX07BT/AOT-2-038": [onPlay(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // Hange Zoë: 《When Played》 Choose up to one character with 2500 or more BP on your opponent's front line. It loses 2000 BP until the end of the turn.
  "UEX07BT/AOT-2-039": [onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(2500), prompt: "选择对方前线最多 1 张 BP 不低于 2500 的角色（本回合 BP-2000）" }), bp(chosen("target"), -2000))],

  // Levi: 《Activate: Main》 《Switch to Resting》 《Once Per Turn》 Switch one active character on your front line to resting. If you do, this character gains 《Blue》 energy generation until the end of the turn.
  "UEX07BT/AOT-2-040": [activateMain({ costs: [restSelf], once: true },
    chooseOwn("target", { line: "front", min: 1, max: 1, filter: and(notSelf, activeCard), prompt: "选择我方前线 1 张活跃状态的角色转为休息状态" }),
    rest(chosen("target")),
    ifThen(chosenCount("target"), [energyThisTurn("self", 1)]))],

  // Levi:
  // 《Nullify Impact》 (The character battling this character loses Impact for the duration of this battle.)
  // 《When Attacking》 You may pay 1 AP. If you do, choose up to two characters on your field. They each gain 1500 BP until the end of the turn.
  "UEX07BT/AOT-2-041": [onAttack(mayPayApEffect("支付 1 AP：选择我方场上最多 2 张角色，本回合各 BP+1500？", 1,
    chooseOwn("target", { max: 2, prompt: "选择我方场上最多 2 张角色（本回合各 BP+1500）" }), bp(chosen("target"), 1500)))],

  // Levi:
  // 《Raid》 <Levi> Switch to active. May move to the front line.
  // 《When Played》 Draw a card. Then, you may place one card from your hand into your sideline. If you do, choose up to one of your AP cards and switch it to active.
  // 《When Attacking》 You may pay 1 AP. If you do, choose one of the following:
  // ・Draw a card. This character gains 1000 BP until the end of the turn.
  // ・This character gains 1000 BP and 《Impact (1)》 until the end of the turn.
  "UEX07BT/AOT-2-042": [
    onPlay(draw(1), ifThen(handNotEmpty, [may("将 1 张手牌置于场外？这样做的场合，选择我方最多 1 张 AP 卡转为活跃状态", discard(1), chooseAp("ap", 1), activateAp("ap"))])),
    onAttack(mayPayApEffect("支付 1 AP：从下列选择 1 项？", 1,
      chooseMode("mode", ["抽 1 张卡，此角色本回合 BP+1000", "此角色本回合 BP+1000 并获得《冲击1》"]),
      ifThen(modeIs("mode", 0), [draw(1), bp("self", 1000)], [bp("self", 1000), grant("self", "冲击1")])))
  ],

  // Sasha Braus: 《When Played》 Draw a card, then place one card from your hand into your sideline.
  "UEX07BT/AOT-2-043": [onPlay(...drawThenDiscard)],

  // Historia Reiss: 《Activate: Main》 《Switch to Resting》 You can only activate this ability if you have six or more event cards in your sideline. Choose one other [104th Cadet Corps] affinity card on your field. It gains 1000 BP until the end of the turn.
  "UEX07BT/AOT-2-044": [activateMain({ costs: [restSelf], condition: eventsInSidelineAtLeast(6) },
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, cadet), prompt: "选择我方场上 1 张其他 [104th Cadet Corps] 卡（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // Historia Reiss:
  // 《When Played》 Choose one of the following:
  // ・Draw a card, then place one card from your hand into your sideline.
  // ・If you have two or more event cards in your sideline, draw a card.
  // ・If you have six or more event cards in your sideline, draw two cards, then place one card from your hand into your sideline.
  "UEX07BT/AOT-2-045": [onPlay(
    chooseMode("mode", ["抽 1 张卡，再将 1 张手牌置于场外", "我方场外的事件卡牌有 2 张或更多的场合，抽 1 张卡", "我方场外的事件卡牌有 6 张或更多的场合，抽 2 张卡，再将 1 张手牌置于场外"]),
    ifThen(modeIs("mode", 0), drawThenDiscard),
    ifThen(modeIs("mode", 1), [ifThen(eventsInSidelineAtLeast(2), [draw(1)])]),
    ifThen(modeIs("mode", 2), [ifThen(eventsInSidelineAtLeast(6), [draw(2), discard(1)])])
  )],

  // Mikasa Ackermann:
  // This character gains all abilities listed below if you have the required number of event cards in your sideline.
  // ・Two or more: It gains 1000 BP.
  // ・Four or more: 《Nullify Impact》 (The character battling this character loses Impact for the duration of this battle.)
  "UEX07BT/AOT-2-046": [staticSelf({ bp: 1000 }, eventsInSidelineAtLeast(2)), staticSelf({ keywords: ["冲击无效"] }, eventsInSidelineAtLeast(4))],

  // Armin Arlelt: 《When Played》 Look at the top two cards of your deck. Place up to one event card into your sideline. Place the remaining cards on the top of your deck in any order.
  "UEX07BT/AOT-2-047": [onPlay(
    look(2),
    chooseLooked("event", { max: 1, filter: isEventCard, prompt: "选择最多 1 张事件卡置于场外" }),
    moveChosen("event", "sideline"),
    ...allLookedOnTop()
  )],

  // Sweet Candy (event): Look at the top four cards of your deck. Reveal up to one character card and add it to your hand. Place the remaining cards on the bottom of your deck in any order. Then, play up to one blue character card with 3 or less required energy and 1 AP cost from your hand set to resting onto your field.
  "UEX07BT/AOT-2-048": [onUse(
    ...lookTakeOneToBottom(4, isCharacterCard, "公开最多 1 张角色卡并加入手牌"),
    chooseFromHand("card", { max: 1, filter: and(isCharacterCard, ofColor("blue"), handCostAtMost(3), apCostIs(1)), prompt: "从手牌选择最多 1 张所需能量不高于 3、消费 AP 为 1 的蓝色角色以休息状态登场" }),
    ifThen(chosenCount("card"), [put("card", "choose", true)])
  )],

  // Thunder Spears (event): Choose one character with 2500 or less BP or 4500 or more BP on your opponent's front line and sideline it.
  "UEX07BT/AOT-2-049": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: either(bpAtMost(2500), bpAtLeast(4500)), prompt: "选择对方前线 1 张 BP 不高于 2500 或不低于 4500 的角色退场" }),
    sideline(chosen("target"))
  )],

  // Gabi Braun: 《When Attacking》 Choose up to one other [Marleyan Warrior] affinity card on your field. {It gains 1000 BP until the end of the turn}. If the chosen character is Raided, {That character and this character gain 2000 BP until the end of the turn} instead.
  "UEX07BT/AOT-2-050": [onAttack(
    chooseOtherMarleyan("target"),
    ifThen(chosenRaided("target"), [bp(chosen("target"), 2000), bp("self", 2000)], [bp(chosen("target"), 1000)])
  )],

  // Falco Grice:
  // 《When Played》 《#If on the Energy Line#》 Switch this character to active.
  // 《Activate: Main》 《Switch to Resting》 《Place 1 Card From Hand Into Sideline》 Choose one other [Marleyan Warrior] affinity card on your field. It gains {1000 BP} until the end of the turn. If the chosen character is Raided, {2000 BP} instead.
  "UEX07BT/AOT-2-051": [
    withCondition(onPlay(activate("self")), selfOnEnergy),
    activateMain({ costs: [restSelf, discardCost(1)] },
      chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, marleyan), prompt: "选择我方场上 1 张其他 [Marleyan Warrior] 卡（本回合 BP+1000；进行过突进的场合为 +2000）" }),
      bp(chosen("target"), raidedBonus("target")))
  ],

  // Zeke Jaeger: 《When Played》 Look at the top five cards of your deck. Reveal up to one [Pure Titan] affinity card and add it to your hand. Place the remaining cards on the bottom of your deck in any order.
  "UEX07BT/AOT-2-052": [onPlay(...lookTakeOneToBottom(5, pureTitan, "公开最多 1 张 [Pure Titan] 卡并加入手牌"))],

  // Zeke Jaeger (Beast Titan):
  // 《Raid》 <Zeke Jaeger> Switch to active. May move to the front line.
  // 《When Played》 Choose up to one character with 3000 or less BP on your opponent's front line and sideline it. If you sideline a character with this ability, you may pay 1 AP. If you do, play up to one [Pure Titan] affinity card from your sideline set to resting onto your field.
  "UEX07BT/AOT-2-053": [onPlay(
    ...sidelineUpTo(3000),
    run("确认选择的角色已退场", (env) => {
      const uid = env.vars.target?.[0];
      if (uid && ![...env.opponent.front, ...env.opponent.energy].some((card) => card.uid === uid)) env.vars.sidelined = ["1"];
    }),
    ifThen(chosenCount("sidelined"), [mayPayApEffect("支付 1 AP：从场外将最多 1 张 [Pure Titan] 卡以休息状态登场？", 1,
      chooseFromSideline("titan", { max: 1, filter: and(isCharacterCard, pureTitan), prompt: "从场外选择最多 1 张 [Pure Titan] 卡以休息状态登场" }),
      ifThen(chosenCount("titan"), [put("titan", "choose", true)]))])
  )],

  // Pieck Finger: 《When Played》 Choose up to one other [Marleyan Warrior] affinity card on your field. It gains {1000 BP} until the end of the turn. If the chosen character is Raided, {2000 BP} instead.
  "UEX07BT/AOT-2-055": [onPlay(chooseOtherMarleyan("target"), bp(chosen("target"), raidedBonus("target")))],

  // Pieck Finger (Cart Titan):
  // 《Raid》 <Pieck Finger> Switch to active. May move to the front line.
  // 《If on the Front Line》 If this character was played this turn, it gains 《Impact (1)》.
  // 《When Played》 You may reduce this character's BP by 2000 until the end of the turn. If you do, it gains "This character can attack from the energy line" and 《Snipe》 until the end of the turn.
  // 《When Sidelined》 Return up to one base card of this Raided character to your hand.
  // (Attacking from the energy line is the engine's "attackFromEnergyLine" mark; the client does not offer the attack from the energy line yet.)
  "UEX07BT/AOT-2-056": [
    staticSelf({ keywords: ["冲击1"] }, all(selfOnFront, enteredThisTurn)),
    onPlay(may("此角色本回合 BP-2000？这样做的场合，本回合获得「此角色可以从能量线攻击」和《瞄准攻击》", bp("self", -2000), flag("self", "attackFromEnergyLine"), grant("self", "瞄准攻击"))),
    onSidelined(chooseFromSideline("base", { max: 1, filter: (env, cardId) => (env.cause?.under ?? []).includes(cardId), prompt: "选择此突进角色的最多 1 张突进源卡牌加入手牌" }), moveChosen("base", "hand"))
  ],

  // Porco Galliard (Jaw Titan):
  // 《Raid》 <Porco Galliard> Switch to active. May move to the front line.
  // 《When Played》 Look at the top four cards of your deck. Reveal up to one [Marleyan Warrior] affinity card and add it to your hand. Place the remaining cards on the bottom of your deck in any order.
  // 《When Attacking》 If this character has 6000 or more BP, draw a card.
  "UEX07BT/AOT-2-058": [
    onPlay(...lookTakeOneToBottom(4, marleyan, "公开最多 1 张 [Marleyan Warrior] 卡并加入手牌")),
    withCondition(onAttack(draw(1)), selfBpAtLeast(6000))
  ],

  // Reiner, Bertholdt, & Annie: This card is also treated as <Reiner Braun>, <Bertholdt Hoover>, and <Annie Leonhart>.
  // (The "name:" marks make it a Raid target of those names; filters that read a card's name directly do not see it.)
  "UEX07BT/AOT-2-059": [staticSelf({ flags: ["name:Reiner Braun", "name:Bertholdt Hoover", "name:Annie Leonhart"] })],

  // Reiner Braun (Armored Titan):
  // 《Raid》 <Reiner Braun> Switch to active. May move to the front line.
  // 《Nullify Impact》 (The character battling this character loses Impact for the duration of this battle.)
  // 《When Played》 You may place one card from your hand into your sideline. If you do, this character gains 2000 BP until the end of the turn.
  // 《When Attacking》 If this character has 6000 or more BP, draw a card and give this character 《Impact (1)》 until the end of the turn.
  "UEX07BT/AOT-2-060": [
    staticSelf({ keywords: ["冲击无效"] }),
    onPlay(ifThen(handNotEmpty, [may("将 1 张手牌置于场外？这样做的场合，此角色本回合 BP+2000", discard(1), bp("self", 2000))])),
    withCondition(onAttack(draw(1), grant("self", "冲击1")), selfBpAtLeast(6000))
  ],

  // Sneak Attack (event): Sideline up to one character with "Pieck Finger" in its card name on your field. Choose up to one character with {3000 or less BP} on your opponent's front line and sideline it. If you have a character card with "Pieck Finger" in its card name in your sideline, {5000 or less BP} instead. Then, if you sidelined a character on your field with this card's ability, add up to one character card with "Pieck Finger" in its card name from your sideline to your hand.
  // (The sideline is checked when the second sentence resolves, after the first one, so sidelining your own Pieck Finger raises the limit.)
  "UEX07BT/AOT-2-061": [onUse(
    chooseOwn("mine", { max: 1, filter: nameIncludes("Pieck Finger"), prompt: "选择我方场上最多 1 张卡名含 Pieck Finger 的角色退场" }),
    sideline(chosen("mine")),
    run("确认我方的角色已退场", (env) => {
      const uid = env.vars.mine?.[0];
      if (uid && !fieldCharacters(env).some((card) => card.uid === uid)) env.vars.mineDone = ["1"];
    }),
    chooseOpponent("target", {
      line: "front", max: 1, prompt: "选择对方前线最多 1 张 BP 不高于 3000（我方场外有卡名含 Pieck Finger 的角色卡时为 5000）的角色退场",
      filter: bpAtMost((env) => (env.owner.sideline.some((cardId) => isCharacterCard(env, cardId, null) && nameIncludes("Pieck Finger")(env, cardId, null)) ? 5000 : 3000))
    }),
    sideline(chosen("target")),
    ifThen(chosenCount("mineDone"), [
      chooseFromSideline("back", { max: 1, filter: and(isCharacterCard, nameIncludes("Pieck Finger")), prompt: "从场外选择最多 1 张卡名含 Pieck Finger 的角色卡加入手牌" }),
      moveChosen("back", "hand")
    ])
  )],

  // Nicolo: 《When Played》 Reduce the AP cost of the next [Food] affinity card you use this turn by 1.
  "UEX07BT/AOT-2-062": [onPlay(nextUseAffinityApCut("Food", 1))],

  // Jean Kirschtein: 《When Attacking》 Look at the top three cards of your deck, then place them on the top of your deck in any order.
  "UEX07BT/AOT-2-064": [onAttack(look(3), ...allLookedOnTop())],

  // Sasha Braus: 《When Played》 If you have used a [Food] affinity card this turn, switch this character to active. You can only activate this <Sasha Braus> ability one time each turn.
  "UEX07BT/AOT-2-065": [withCondition(onPlay(markThisTurn(SASHA_065_LIMIT), ifThen(usedAffinityThisTurn("Food"), [activate("self")])), notMarkedThisTurn(SASHA_065_LIMIT))],

  // Mikasa Ackermann: At the start of your end phase, if one of your red [104th Cadet Corps] affinity cards has returned from your field to your hand during the attack phase this turn, you may play this card from your hand set to resting onto your front line. You can only activate this <Mikasa Ackermann> ability one time each turn.
  // (A hand-zone ability: the engine's "onEndStartInHand" event; the returned cards are remembered as turn marks.)
  "UEX07BT/AOT-2-066": [withCondition(
    when(["onEndStartInHand"],
      markThisTurn(MIKASA_066_LIMIT),
      may("将手牌中的此卡牌以休息状态登场到前线？",
        chooseFromHand("card", { min: 1, max: 1, filter: (env, cardId) => cardId === env.selfCardId, prompt: "选择手牌中的此卡牌" }),
        put("card", "front", true))),
    (env) => env.owner.hand.includes(env.selfCardId) && notMarkedThisTurn(MIKASA_066_LIMIT)(env) && returnedToHandInAttackPhase(redCadet)(env)
  )],

  // Mikasa Ackermann:
  // This card can only be played by one of your abilities or by performing Raid with it.
  // 《Raid》 <Mikasa Ackermann> Switch to active. May move to the front line.
  // 《When Played》 Choose one of the following:
  // ・Add up to one card with 3 or less required energy and [104th Cadet Corps] affinity and without 《Raid》 from your sideline to your hand.
  // ・Choose up to one character on your opponent's front line. If it has 5000 or more BP, you may place two cards from your hand into your sideline. If you do, sideline that character.
  "UEX07BT/AOT-2-067": [
    staticSelf({ flags: ["playOnlyByAbility"] }),
    onPlay(
      chooseMode("mode", ["从场外将最多 1 张所需能量不高于 3、有 [104th Cadet Corps]、没有《Raid》的卡牌加入手牌", "选择对方前线最多 1 张角色；其 BP 不低于 5000 的场合，可以将 2 张手牌置于场外，这样做的场合该角色退场"]),
      ifThen(modeIs("mode", 0), [
        chooseFromSideline("back", { max: 1, filter: and(cadet, energyCostAtMost(3), noRaid), prompt: "从场外选择最多 1 张所需能量不高于 3、有 [104th Cadet Corps]、没有《Raid》的卡牌加入手牌" }),
        moveChosen("back", "hand")
      ], [
        chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线最多 1 张角色" }),
        ifThen((env) => env.owner.hand.length >= 2 && (env.vars.target ?? []).some((uid) => env.opponent.front.some((card) => card.uid === uid && bpOf(env.ctx, card) >= 5000)),
          [may("将 2 张手牌置于场外？这样做的场合，该角色退场", discard(2), sideline(chosen("target")))])
      ])
    )
  ],

  // Armin Arlelt (Colossal Titan) (UEX07BT/AOT-2-069): left out (see the top of the file).

  // Eren Jaeger: 《When Played》 Look at the top three cards of your deck. Reveal up to one [104th Cadet Corps] affinity card and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If you added a card to your hand, place one card from your hand into your sideline.
  "UEX07BT/AOT-2-070": [onPlay(...lookTakeOneToBottom(3, cadet, "公开最多 1 张 [104th Cadet Corps] 卡并加入手牌"), ifThen(chosenCount("pick"), [discard(1)]))],

  // Eren Jaeger:
  // 《Nullify Impact》 (The character battling this character loses Impact for the duration of this battle.)
  // 《Activate: Main》 《Once Per Turn》 Add one card from your life area to your hand. If you do, this character gains 《Impact (1)》 until the end of the turn.
  // 《When Attacking》 {Look at the top card of your deck. If that card has 3 or less required energy and [104th Cadet Corps] affinity, you may reveal it and add it to your hand. Otherwise, place it on the top or bottom of your deck}. If you have 3 or less life, {Draw a card} instead.
  // (A card that qualifies but is not taken is also placed on the top or bottom.)
  "UEX07BT/AOT-2-071": [
    activateMain({ once: true }, lifeToHand, ifThen(chosenCount("moved"), [grant("self", "冲击1")])),
    onAttack(ifThen(lifeAtMost(3), [draw(1)], [
      look(1),
      chooseLooked("pick", { max: 1, filter: and(cadet, energyCostAtMost(3)), prompt: "公开所需能量不高于 3 且有 [104th Cadet Corps] 的这张卡并加入手牌（不选则置于卡组最上方或最下方）" }),
      ifThen(chosenCount("pick"), [moveChosen("pick", "hand")], [
        ifThen((env) => (env.game.looking?.cards.length ?? 0) > 0, [chooseMode("where", ["置于卡组最上方", "置于卡组最下方"])])
      ]),
      run("将确认的卡牌置于卡组最上方或最下方", (env) => {
        const looking = env.game.looking;
        if (!looking?.cards.length) return;
        if (env.vars.where?.[0] === "m:0") env.owner.library.unshift(...looking.cards); else env.owner.library.push(...looking.cards);
        looking.cards = [];
      })
    ]))
  ],

  // Eren Jaeger (Attack Titan):
  // 《Raid》 <Eren Jaeger> Switch to active. May move to the front line.
  // 《When Played》 This character gains 1000 BP until the start of your next turn. Choose one of the following:
  // ・Choose up to one character with 3000 or less BP on your opponent's front line and sideline it.
  // ・Add one card from your life area to your hand. Choose up to one character with 5000 or less BP on your opponent's front line and sideline it.
  // ・If you have 3 or less life, choose up to one character with 5000 or less BP on your opponent's front line and sideline it.
  "UEX07BT/AOT-2-072": [onPlay(
    bp("self", 1000, "untilYourNextTurn"),
    chooseMode("mode", ["选择对方前线最多 1 张 BP 不高于 3000 的角色退场", "将我方生命区的 1 张卡牌加入手牌，选择对方前线最多 1 张 BP 不高于 5000 的角色退场", "我方生命 3 以下的场合，选择对方前线最多 1 张 BP 不高于 5000 的角色退场"]),
    ifThen(modeIs("mode", 0), sidelineUpTo(3000)),
    ifThen(modeIs("mode", 1), [lifeToHand, ...sidelineUpTo(5000)]),
    ifThen(modeIs("mode", 2), [ifThen(lifeAtMost(3), sidelineUpTo(5000))])
  )],

  // Seafood (event):
  // Choose one of the following:
  // ・Choose up to one character on your field. It gains 1000 BP until the end of the turn. Draw two cards.
  // ・Choose up to two characters on your field. They each gain 1000 BP until the end of the turn. Draw a card.
  // ・Choose up to three characters on your field. They each gain 1000 BP until the end of the turn.
  "UEX07BT/AOT-2-073": [onUse(
    chooseMode("mode", ["选择我方场上最多 1 张角色，本回合 BP+1000；抽 2 张卡", "选择我方场上最多 2 张角色，本回合各 BP+1000；抽 1 张卡", "选择我方场上最多 3 张角色，本回合各 BP+1000"]),
    ifThen(modeIs("mode", 0), [chooseOwn("one", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+1000）" }), bp(chosen("one"), 1000), draw(2)]),
    ifThen(modeIs("mode", 1), [chooseOwn("two", { max: 2, prompt: "选择我方场上最多 2 张角色（本回合各 BP+1000）" }), bp(chosen("two"), 1000), draw(1)]),
    ifThen(modeIs("mode", 2), [chooseOwn("three", { max: 3, prompt: "选择我方场上最多 3 张角色（本回合各 BP+1000）" }), bp(chosen("three"), 1000)])
  )]
};
