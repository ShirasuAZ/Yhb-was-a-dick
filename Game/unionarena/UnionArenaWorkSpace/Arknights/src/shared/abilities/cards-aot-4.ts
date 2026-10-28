/**
 * Abilities of the AOT cards, batch 4: UE10ST/AOT-1-075 … 113 (the starter deck's red cards, the blue/green ones) and UEPR/AOT-1-001 … 023 (promo
 * reprints of the blue cards of batch 1). Each entry follows the card's printed text, shown above it. The keyword lines that start a line (《Raid》,
 * 《Step》, 《Impact (1)》 …) and the life-card trigger are read from the card data and not repeated.
 *
 * The promo cards print exactly the text of their UE10BT twin, so they reuse the finished entries of `cards-aot-1.ts` (same ability lists, so the
 * ability indexes that `grantAbility` uses stay the same).
 *
 * Left out (stays manual): UE10ST/AOT-1-113 Colossal Titan: "The number of cards you can place onto your front line is reduced by one" would change
 * the line limit (LINE_LIMIT) in the engine, the client and the computer players' move generation (like UE10BT/AOT-1-057 in batch 2).
 *
 * Notes on the data: an AOT card's affinities are one string joined by "／", so the filters here split it.
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, costOf, energyOf, loseIfNoLife } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step, Target } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseLooked, chooseMode, chooseOpponent, chooseOwn, chosen,
  chosenCount, discard, draw, duringOpponentTurn, energyCostAtMost, givenOnly, grantAbility, ifThen, isCharacterCard, look, lookedToBottom, mayPayApEffect, moveChosen,
  notSelf, ofColor, onAttack, onPlay, onUse, put, restSelf, run, selfActive, selfOnEnergy, selfOnFront, sideline, sidelineSelf, staticSelf, toHand, when, withCondition
} from "./dsl.ts";
import { AOT_1_ABILITIES } from "./cards-aot-1.ts";

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;

// ---- Helpers for the AOT cards ----

const CADET = "104th Cadet Corps";
const fieldOf = (env: AbilityEnv): UnionArenaFieldCard[] => [...env.owner.front, ...env.owner.energy];
/** The card's affinities, one by one (the data joins them with "／" inside one string). */
const affinitiesOf = (env: AbilityEnv, cardId: string): string[] => (env.ctx.card(cardId)?.affinities ?? []).flatMap((entry) => entry.split(/[／/]/).map((part) => part.trim()));
const hasAffinity = (affinity: string): CardFilter => (env, cardId) => affinitiesOf(env, cardId).includes(affinity);
const cadet = hasAffinity(CADET);
/** The number of our field cards (any type) that meet a filter. */
const countOwn = (env: AbilityEnv, filter: CardFilter): number => fieldOf(env).filter((card) => filter(env, card.cardId, card)).length;
/** 我方场上存在N张或更多 [104th Cadet Corps] 的卡牌 */
const cadetsOnFieldAtLeast = (count: number): Condition => (env) => countOwn(env, cadet) >= count;
/** All [104th Cadet Corps] affinity cards (characters) on our field. */
const ownCadets: Target = (env) => fieldOf(env).filter((card) => env.ctx.card(card.cardId)?.type === "character" && cadet(env, card.cardId, card));
/** 我方的场上存在卡牌名中含有 "part" 的角色 */
const youHaveNameIncluding = (part: string): Condition => (env) => fieldOf(env).some((card) => env.ctx.card(card.cardId)?.type === "character" && (env.ctx.card(card.cardId)?.name ?? "").includes(part));
/** Required energy of a hand card now (with cost changes). */
const handCost = (env: AbilityEnv, cardId: string): number => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy;
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => handCost(env, cardId) <= limit;
/** BP equal to or more than N (field cards). */
const bpAtLeast = (limit: number): CardFilter => (env, _cardId, card) => !!card && bpOf(env.ctx, card) >= limit;
/** 我方的产生能量合计N或更多 */
const COLORS = ["red", "green", "blue", "yellow", "purple"];
const energyGeneration = (env: AbilityEnv): number => COLORS.reduce((sum, color) => sum + energyOf(env.ctx, env.owner, color), 0);
/** 我方的生命区中的卡牌 N 张或更少 */
const lifeAtMost = (count: number): Condition => (env) => env.owner.life.length <= count;

/** "<ability text>的此效果1回合只能发动1次": marks on the game for this turn, per player (EngineGame.turnMarks). */
const turnMarkKey = (env: AbilityEnv, text: string): string => `${env.game.turn}:${env.owner.accountId}:${text}`;
const notMarkedThisTurn = (text: string): Condition => (env) => !(env.game.turnMarks ?? []).includes(turnMarkKey(env, text));
const markThisTurn = (text: string): Step => run("本回合已发动过此效果", (env) => { env.game.turnMarks = [...(env.game.turnMarks ?? []), turnMarkKey(env, text)]; });

/** Draw a card, then place one card from your hand into your sideline. */
const drawThenDiscard: Step[] = [draw(1), discard(1)];
/** Choose up to one of your AP cards and switch it to active. */
const oneApActive: Step[] = [chooseAp("ap", 1), activateAp("ap")];

/** A promo card prints the text of its UE10BT twin: the same ability list. */
const sameAsBt = (number: string): readonly Ability[] => {
  const twin = AOT_1_ABILITIES[`UE10BT/AOT-1-${number}`];
  if (!twin) throw new Error(`cards-aot-4: UE10BT/AOT-1-${number} has no entry in cards-aot-1.ts`);
  return twin;
};

/** Takes the top card of the owner's life area (the player cannot know which one it is) into the hand; remembers it under `vars.moved`. */
const lifeToHand = run("将我方生命区的 1 张卡牌加入手牌", (env) => {
  const slot = env.owner.life.shift();
  if (!slot) return;
  env.owner.hand.push(slot.cardId);
  env.vars.moved = ["1"];
  loseIfNoLife(env.game, env.players, env.owner);
});
/** Places the top card of the owner's life area into the sideline; remembers it under `vars.moved`. */
const lifeToSideline = run("将我方生命区的 1 张卡牌置于场外", (env) => {
  const slot = env.owner.life.shift();
  if (!slot) return;
  env.owner.sideline.push(slot.cardId);
  env.vars.moved = ["1"];
  loseIfNoLife(env.game, env.players, env.owner);
});

const EREN_107_LIMIT = "Eren Jaeger (UE10ST/AOT-1-107) Activate: Main";

export const AOT_4_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // ---- UE10ST ----

  // Armin Arlelt: 《When Played》 Draw a card, then place one card from your hand into your sideline.
  "UE10ST/AOT-1-075": [onPlay(...drawThenDiscard)],

  // Jean Kirschtein: 《Activate: Main》 《Switch to Resting》 Choose one other character on your field. It gains 1000 BP until the end of the turn.
  "UE10ST/AOT-1-084": [activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // Mikasa Ackermann (UE10ST/AOT-1-085): printed "-" (no ability text).
  "UE10ST/AOT-1-085": [],

  // Mikasa Ackermann: If this character is active, it gains 《Red》 energy generation.
  "UE10ST/AOT-1-087": [staticSelf({ energy: 1 }, selfActive)],

  // Eren Jaeger (UE10ST/AOT-1-090): printed "-" (no ability text).
  "UE10ST/AOT-1-090": [],

  // Eren Jaeger:
  //   《Step》 (During your movement phase, you may move this card from your front line to your energy line.)
  //   《Activate: Main》 《If on the Front Line》 《Once Per Turn》 Add one card from your life area to your hand. If you do, this character gains 1000 BP until the end of the turn.
  "UE10ST/AOT-1-091": [
    activateMain({ condition: selfOnFront, once: true }, lifeToHand, ifThen(chosenCount("moved"), [bp("self", 1000)]))
  ],

  // Dedicate Your Heart!! (event): Choose up to two of your AP cards and switch them to active.
  "UE10ST/AOT-1-097": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // Annie Leonhart, Bertholdt Hoover (UE10ST/AOT-1-101, -102): printed "-" (no ability text).
  "UE10ST/AOT-1-101": [],
  "UE10ST/AOT-1-102": [],

  // Armin Arlelt:
  //   《When Played》 《#If on the Energy Line#》 Choose one of the following:
  //   ・Look at the top three cards of your deck. Reveal up to one [104th Cadet Corps] affinity card with 3 or less required energy among them and add it to your hand. Place the remaining cards on the bottom of your deck in any order.
  //   ・Play up to one red card with 3 or less required energy, 1 AP cost, and [104th Cadet Corps] affinity from your hand set to active onto your front line. That character gains "At the end of the attack phase, return this character to your hand" until the end of the turn.
  "UE10ST/AOT-1-104": [
    withCondition(onPlay(
      chooseMode("mode", [
        "查看卡组最上方的 3 张卡，公开最多 1 张所需能量不高于 3 的 [104th Cadet Corps] 卡并加入手牌，剩余的置于卡组最下方",
        "从手牌将最多 1 张所需能量不高于 3、消费 AP 为 1 的红色 [104th Cadet Corps] 卡以活跃状态登场到前线（本回合攻击阶段结束时放回手牌）"
      ]),
      ifThen((env) => env.vars.mode?.[0] === "m:0", [
        look(3),
        chooseLooked("pick", { max: 1, filter: and(cadet, energyCostAtMost(3)), prompt: "公开最多 1 张所需能量不高于 3 的 [104th Cadet Corps] 卡并加入手牌" }),
        moveChosen("pick", "hand"),
        lookedToBottom()
      ], [
        chooseFromHand("card", { max: 1, filter: and(ofColor("red"), cadet, handCostAtMost(3), apCostIs(1)), prompt: "从手牌选择最多 1 张所需能量不高于 3、消费 AP 为 1 的红色 [104th Cadet Corps] 卡以活跃状态登场到前线" }),
        ifThen(chosenCount("card"), [put("card", "front", false), grantAbility(chosen("placed:card"), 1)])
      ])
    ), selfOnEnergy),
    givenOnly(when(["onAttackPhaseEnd"], toHand("self")))
  ],

  // Mikasa Ackermann:
  //   If there is a character with "Eren Jaeger" in its card name on your field, play this character set to active onto your field.
  //   《Impact (1)》 (When this character attacks and wins a battle, deal 1 damage to your opponent.)
  // (Impact (1) is missing from the card data's keywords, so this card gives it to itself.)
  "UE10ST/AOT-1-105": [staticSelf({ keywords: ["冲击1"] }), withCondition(onPlay(activate("self")), youHaveNameIncluding("Eren Jaeger"))],

  // Eren Jaeger: If you have 3 or less life, this character gains 1000 BP.
  "UE10ST/AOT-1-106": [staticSelf({ bp: 1000 }, lifeAtMost(3))],

  // Eren Jaeger:
  //   《Raid》 <Eren Jaeger> Switch to active. May move to the front line.
  //   《When Played》 Draw a card.
  //   《Activate: Main》 《If on the Front Line》 Place one card from your life area into your sideline. If you do, choose up to one of your AP cards and switch it to active. You can only activate this <Eren Jaeger> ability one time each turn.
  "UE10ST/AOT-1-107": [
    onPlay(draw(1)),
    activateMain({ condition: all(selfOnFront, notMarkedThisTurn(EREN_107_LIMIT)) },
      markThisTurn(EREN_107_LIMIT), lifeToSideline, ifThen(chosenCount("moved"), oneApActive))
  ],

  // Cadet Corps Grounds (site):
  //   If you have five or more [104th Cadet Corps] affinity cards on your field, play this site set to active onto your field.
  //   《Activate: Main》 《Switch to Resting》 《Sideline This Card》 All [104th Cadet Corps] affinity cards on your field gain 1000 BP until the end of the turn.
  "UE10ST/AOT-1-108": [
    withCondition(onPlay(activate("self")), cadetsOnFieldAtLeast(5)),
    activateMain({ costs: [restSelf, sidelineSelf] }, bp(ownCadets, 1000))
  ],

  // 104th Cadet Corps (event): Choose one character on your opponent's front line with BP equal to or less than 1000 multiplied by the number of [104th Cadet Corps] affinity cards on your field and sideline it.
  "UE10ST/AOT-1-109": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => 1000 * countOwn(env, cadet)), prompt: "选择对方前线中 1 张 BP 不高于 1000×我方场上 [104th Cadet Corps] 卡数量的角色退场" }),
    sideline(chosen("target"))
  )],

  // Levi:
  //   《Raid》 <Levi> Switch to active. May move to the front line.
  //   《When Played》 Choose up to one character with 2500 or more BP on your opponent's front line. It loses 2000 BP until the end of the turn.
  //   《When Attacking》 You may pay 1 AP. If you do, choose up to one character with 2000 or less BP on your opponent's front line and return it to their hand.
  "UE10ST/AOT-1-110": [
    onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtLeast(2500), prompt: "选择对方前线中最多 1 张 BP 不低于 2500 的角色（本回合 BP-2000）" }), bp(chosen("target"), -2000)),
    onAttack(mayPayApEffect("支付 1 AP：选择对方前线 1 张 BP 不高于 2000 的角色放回手牌？", 1,
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(2000), prompt: "选择对方前线中最多 1 张 BP 不高于 2000 的角色放回手牌" }), toHand(chosen("target"))))
  ],

  // Erwin Smith:
  //   《If on the Front Line》 At the start of your attack phase, if this character is active, choose up to one of your AP cards and switch it to active.
  //   《When Attacking》 You may pay 1 AP. If you do, this character gains 500 BP until the end of the turn.
  "UE10ST/AOT-1-111": [
    withCondition(when(["onAttackStart"], ...oneApActive), all(selfOnFront, selfActive)),
    onAttack(mayPayApEffect("支付 1 AP：此角色本回合 BP+500？", 1, bp("self", 500)))
  ],

  // Armored Titan:
  //   《During Opponent's Turn》 Your opponent cannot choose this character with abilities on character or event cards unless they pay 1 AP as an additional cost.
  //   《When Played》 Choose up to one character with {2000 or less BP} on your opponent's front line and sideline it. If you have 8 or more energy generation, {4000 or less BP} instead.
  "UE10ST/AOT-1-112": [
    staticSelf({ flags: ["taxAp:character", "taxAp:event"] }, duringOpponentTurn),
    onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost((env) => (energyGeneration(env) >= 8 ? 4000 : 2000)), prompt: "选择对方前线中最多 1 张 BP 不高于 2000（我方产生能量 8 或更多时为 4000）的角色退场" }), sideline(chosen("target")))
  ],

  // Colossal Titan (UE10ST/AOT-1-113): left out (see the top of the file).

  // ---- UEPR (the same text as the UE10BT card of the same number) ----

  // Erwin Smith: -   (no ability text)
  "UEPR/AOT-1-001": [],
  "UEPR/AOT-1-003": [...sameAsBt("003")],
  "UEPR/AOT-1-004": [...sameAsBt("004")],
  "UEPR/AOT-1-005": [...sameAsBt("005")],
  "UEPR/AOT-1-006": [...sameAsBt("006")],
  // Levi: -   (no ability text)
  "UEPR/AOT-1-007": [],
  "UEPR/AOT-1-008": [...sameAsBt("008")],
  // Ymir: -   (no ability text)
  "UEPR/AOT-1-012": [],
  "UEPR/AOT-1-013": [...sameAsBt("013")],
  "UEPR/AOT-1-015": [...sameAsBt("015")],
  "UEPR/AOT-1-016": [...sameAsBt("016")],
  // Historia Reiss: -   (no ability text)
  "UEPR/AOT-1-019": [],
  "UEPR/AOT-1-020": [...sameAsBt("020")],
  "UEPR/AOT-1-023": [...sameAsBt("023")]
};
