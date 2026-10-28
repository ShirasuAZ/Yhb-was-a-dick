/**
 * Abilities of the AOT cards, batch 6: UEX07BT/AOT-2-001 … 036 (the yellow "Rumbling" deck) and UEPR/AOT-2-068 (see cards.ts for the conventions).
 * Each entry follows the card's printed text, shown above it. The keyword lines that start a line (《Raid》, 《Step》, 《Impact (1)》 …) and the
 * life-card trigger are read from the card data and not repeated, except where the data's `keywords` lacks a keyword the text prints
 * (017 Step, 019 Nullify Impact, 022 Impact (1)): those cards give it to themselves.
 *
 * "Four or more yellow characters without [Rumbling] affinity whose card names are unique on your field" is read as: the number of DIFFERENT card
 * names among your yellow characters that lack the [Rumbling] affinity is four or more (two copies of one name count once). See `fourUnique`.
 *
 * Left out (stays manual): 013 Armin Arlelt (Colossal Titan) and 029 Colossal Titan: "The number of cards you can place onto your front line is
 * reduced by one" would change the line limit (LINE_LIMIT), which the engine, the client and the computer players' move generation read (the same
 * reason AOT-1-057 and UE10ST/AOT-1-113 were left out). 020 and 023 print "-" and need no entry.
 *
 * Approximations: 068 Armin Arlelt cuts the Raid cost of <Armin Arlelt (Colossal Titan)> whenever it is on the field, whichever <Armin Arlelt> the
 * Raid targets (the engine does not tell a cost cut which card is raided), and the cut is 2 energy of any colour (the card prints 《Red×2》).
 * 017 Falco Grice (Jaw Titan) takes field characters from the field without any "leaves the field" ability firing (they are not sidelined).
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, apCost, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn,
  chosen, chosenCount, costChange, discard, discardCost, draw, duringOpponentTurn, duringYourTurn, energyCostAtMost, energyThisTurn, flag, givenOnly, grant, grantAbility, ifThen,
  isCharacterCard, look, lookedToBottom, may, moveChosen, named, noneChosen, notSelf, ofColor, onPlay, onUse, put, restSelf, run, selfActive, selfOnEnergy, sideline, staticSelf,
  toHand, when, withCondition
} from "./dsl.ts";

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
type ChooseStep = Extract<Step, { do: "choose" }>;

// ---- Helpers for the AOT cards ----

const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const nameOf = (env: AbilityEnv, cardId: string): string => env.ctx.card(cardId)?.name ?? "";
/** The card's affinities, one by one (the data joins them with "／" inside one string; the engine's card context already splits them). */
const affinitiesOf = (env: AbilityEnv, cardId: string): string[] => (env.ctx.card(cardId)?.affinities ?? []).flatMap((entry) => entry.split(/[／/]/));
const hasAffinity = (affinity: string): CardFilter => (env, cardId) => affinitiesOf(env, cardId).includes(affinity);
const notRumbling: CardFilter = (env, cardId) => !affinitiesOf(env, cardId).includes("Rumbling");
const nameIncludes = (part: string): CardFilter => (env, cardId) => nameOf(env, cardId).includes(part);
const noRaid: CardFilter = (env, cardId) => !env.ctx.card(cardId)?.raid;
/** 我方的场上存在卡牌名中含有 "part" 的角色 */
const youHaveNameIncluding = (part: string): Condition => (env) => fieldOf(env.owner).some((card) => isCharacter(env, card) && nameOf(env, card.cardId).includes(part));
/** If there is a character with "Eren" in its card name and a character with "Zeke" in its card name on your field */
const erenAndZeke: Condition = all(youHaveNameIncluding("Eren"), youHaveNameIncluding("Zeke"));
/** <Ymir, Our Founder> is on your field or in your sideline */
const YMIR = "Ymir, Our Founder";
const ymirOnFieldOrSideline: Condition = (env) => fieldOf(env.owner).some((card) => nameOf(env, card.cardId) === YMIR) || env.owner.sideline.some((cardId) => nameOf(env, cardId) === YMIR);
/** You have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field (four different names). */
const uniqueYellowNames = (env: AbilityEnv): number =>
  new Set(fieldOf(env.owner).filter((card) => isCharacter(env, card) && env.ctx.card(card.cardId)?.color === "yellow" && notRumbling(env, card.cardId, card)).map((card) => nameOf(env, card.cardId))).size;
const fourUnique: Condition = (env) => uniqueYellowNames(env) >= 4;
/** The card's printed required energy is at most `limit`. */
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= limit;
/** A `check` for a multi-pick choice: the cards picked have different card names. */
const differentNames = (env: AbilityEnv, cardIds: string[]): boolean => new Set(cardIds.map((cardId) => nameOf(env, cardId))).size === cardIds.length;
const withCheck = (step: Step, check: (env: AbilityEnv, cardIds: string[]) => boolean): Step => ({ ...(step as ChooseStep), check });
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;

/** Records a "1回合只能……1次" use for the owner this turn (EngineGame.turnMarks, "<turn>:<owner>:<text>"). */
const turnMarkKey = (env: AbilityEnv, text: string): string => `${env.game.turn}:${env.owner.accountId}:${text}`;
const notMarkedThisTurn = (text: string): Condition => (env) => !(env.game.turnMarks ?? []).includes(turnMarkKey(env, text));
const markThisTurn = (text: string): Step => run("本回合已发动过此效果", (env) => { env.game.turnMarks = [...(env.game.turnMarks ?? []), turnMarkKey(env, text)]; });
/** Records on the card that its (hand-written) 「每回合1次」 ability `index` has been used this turn. */
const markUsed = (index: number): Step => run("本回合已发动过此效果", (env) => { if (env.self) env.self.used = [...(env.self.used ?? []), index]; });
const notUsed = (index: number): Condition => (env) => !!env.self && !(env.self.used ?? []).includes(index);

/** 获得“当主要阶段结束时，将此角色退场” (given with grantAbility). */
const sidelineAtMainEnd = givenOnly(when(["onMainEnd"], sideline("self")));

/** Look at the top N cards, reveal up to one that meets `filter`, add it to your hand, put the rest on the bottom; if you added a card, place one card from your hand into your sideline. */
const lookTakeOneThenDiscard = (count: number, filter: CardFilter, prompt: string): Step[] => [
  look(count), chooseLooked("pick", { max: 1, filter, prompt }), moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)])
];

// 007 Hange Zoë: the ability index of her "Once Per Turn" win-a-battle ability (for markUsed / notUsed).
const HANGE_WIN_BATTLE = 2;

// 022 Eren Jaeger (Doomsday Titan): "Play up to one [Nine Titans] affinity card from your hand or sideline set to active onto your field."
// One question for the hand (pick none to look in the sideline instead), one for the sideline.
const notEvent: CardFilter = (env, cardId) => env.ctx.card(cardId)?.type !== "event";
const playNineTitan: Step[] = [
  chooseFromHand("hand", { max: 1, filter: and(notEvent, hasAffinity("Nine Titans")), prompt: "从手牌选择最多 1 张 [Nine Titans] 卡以活跃状态登场（不选则可从场外选择）" }),
  ifThen(noneChosen("hand"), [
    chooseFromSideline("side", { max: 1, filter: and(notEvent, hasAffinity("Nine Titans")), prompt: "从场外选择最多 1 张 [Nine Titans] 卡以活跃状态登场" }),
    ifThen(chosenCount("side"), [put("side", "choose", false)])
  ], [put("hand", "choose", false)])
];
const notDoomsdayOnField: Condition = (env) => !fieldOf(env.owner).some((card) => nameOf(env, card.cardId) === "Eren Jaeger (Doomsday Titan)");
const playedThisTurn: Condition = (env) => (env.game.entered ?? []).some((entry) => entry.turn === env.game.turn && entry.uid === env.self?.uid);

// 017 Falco Grice (Jaw Titan): "Choose up to three characters on your field or character cards in your sideline with 3 or less required energy and unique
// card names and without [Rumbling] affinity and place them face down under this character." One question for the field, one for the sideline.
const fieldIdsPicked = (env: AbilityEnv): string[] => (env.vars.fd ?? []).flatMap((uid) => fieldOf(env.owner).filter((card) => card.uid === uid).map((card) => card.cardId));
const jawTitanUnder: Step[] = [
  withCheck(chooseOwn("fd", { max: 3, filter: and(notSelf, energyCostAtMost(3), notRumbling), prompt: "选择我方场上最多 3 张所需能量不高于 3、卡名各不相同、没有 [Rumbling] 特征的角色（背面朝上置于此角色下方）" }), differentNames),
  withCheck(chooseFromSideline("sd", { max: 3, filter: and(isCharacterCard, energyCostAtMost(3), notRumbling), prompt: "选择我方场外最多 3 张所需能量不高于 3、卡名各不相同、没有 [Rumbling] 特征的角色卡（背面朝上置于此角色下方）" }),
    (env, cardIds) => cardIds.length + fieldIdsPicked(env).length <= 3 && differentNames(env, [...fieldIdsPicked(env), ...cardIds])),
  run("将选择的卡牌背面朝上置于此角色下方", (env) => {
    const self = env.self;
    if (!self) return;
    // Sideline picks first (their indexes are read before anything is added to the sideline), highest index first.
    const indexes = (env.vars.sd ?? []).filter((key) => /^s:\d+$/.test(key)).map((key) => Number(key.slice(2))).sort((a, b) => b - a);
    const fromSideline = indexes.map((index) => env.owner.sideline.splice(index, 1)[0]!).reverse();
    const fromField: string[] = [];
    for (const uid of env.vars.fd ?? []) {
      const found = fieldOf(env.owner).find((card) => card.uid === uid);
      if (!found) continue;
      env.owner.front = env.owner.front.filter((card) => card.uid !== uid);
      env.owner.energy = env.owner.energy.filter((card) => card.uid !== uid);
      env.owner.sideline.push(...found.under, ...(found.faceDown ?? []));
      fromField.push(found.cardId);
    }
    self.faceDown = [...(self.faceDown ?? []), ...fromField, ...fromSideline];
  })
];

export const AOT_6_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // Armin Arlelt: When <Armin Arlelt (Colossal Titan)> performs Raid on this character, reduce that card's required energy by 《Red×2》.
  "UEPR/AOT-2-068": [costChange({ energy: 2, fromField: (env, handCardId, raiding) => raiding && nameOf(env, handCardId) === "Armin Arlelt (Colossal Titan)" })],

  // Yelena: If this character is active, it gains 《Yellow》 energy generation.
  "UEX07BT/AOT-2-001": [staticSelf({ energy: 1 }, selfActive)],

  // Onyankopon: 《When Played》 Play up to one yellow character card with 3 or less required energy and 1 AP cost and without [Rumbling] affinity from your hand set to resting onto your field. You cannot play a card with a card name that is on your field with this ability.
  "UEX07BT/AOT-2-002": [onPlay(
    chooseFromHand("card", {
      max: 1,
      filter: and(isCharacterCard, ofColor("yellow"), handCostAtMost(3), apCostIs(1), notRumbling, (env, cardId) => !fieldOf(env.owner).some((card) => nameOf(env, card.cardId) === nameOf(env, cardId))),
      prompt: "从手牌选择最多 1 张所需能量不高于 3、消费 AP 为 1、没有 [Rumbling] 特征、卡名不与我方场上相同的黄色角色以休息状态登场"
    }),
    ifThen(chosenCount("card"), [put("card", "choose", true)])
  )],

  // Gabi Braun: 《When Played》 If you have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field, choose up to one other character on your field. It gains 1500 BP until the end of the turn.
  "UEX07BT/AOT-2-003": [withCondition(onPlay(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1500）" }), bp(chosen("target"), 1500)), fourUnique)],

  // Kiyomi Azumabito: 《When Played》 Return one other character on your field with 1 or less required energy to your hand. If you cannot, return this character to your hand.
  "UEX07BT/AOT-2-004": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    toHand(chosen("target")),
    ifThen(noneChosen("target"), [toHand("self")])
  )],

  // Conny Springer: If you have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field, this character gains 1000 BP.
  "UEX07BT/AOT-2-005": [staticSelf({ bp: 1000 }, fourUnique)],

  // Jean Kirschtein: 《During Your Turn》 If you have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field, this character gains 1500 BP.
  "UEX07BT/AOT-2-006": [staticSelf({ bp: 1500 }, all(duringYourTurn, fourUnique))],

  // Hange Zoë:
  // Play this character set to active.
  // At the end of your opponent's attack phase, sideline this character.
  // 《Once Per Turn》 When this character attacks and wins a battle against a character with 5000 or more BP, switch it to active. It loses 《Snipe》 until the end of the turn.
  // 《When Played》 If you have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field, this character gains 2000 BP and 《Snipe》 (You may target a character on your opponent's front line and attack it with this character. If you do, your opponent cannot block) until the end of the turn.
  "UEX07BT/AOT-2-007": [
    // "Play this character set to active": written as an ability that switches it to active when played (like AOT-1's other "set to active" cards).
    onPlay(activate("self")),
    withCondition(when(["onEveryAttackPhaseEnd"], sideline("self")), duringOpponentTurn),
    // 「每回合1次」 is used up only when the ability really applies (a win against a 5000+ BP character), so it is kept by hand, not by `oncePerTurn`.
    withCondition(when(["onWinBattle"], markUsed(HANGE_WIN_BATTLE), activate("self"), run("直到回合结束失去《瞄准攻击》", (env) => {
      if (!env.self) return;
      env.self.grants = env.self.grants.filter((keyword) => keyword !== "瞄准攻击");
      env.self.lasting = (env.self.lasting ?? []).filter((entry) => entry.keyword !== "瞄准攻击");
    })), (env) => notUsed(HANGE_WIN_BATTLE)(env) && env.game.lastBattleWon?.attackerUid === env.self?.uid && (env.game.lastBattleWon?.foeBp ?? 0) >= 5000),
    withCondition(onPlay(bp("self", 2000), grant("self", "瞄准攻击")), fourUnique)
  ],

  // Mikasa Ackermann:
  // This character cannot be blocked by a character with 5000 or more BP.
  // If your opponent has 1 life, this character gains 《Impact (1)》.
  // 《When Played》 If you have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field and your opponent has 5 or less life, switch this character to active. You can only activate this <Mikasa Ackermann> ability one time each turn.
  "UEX07BT/AOT-2-008": [
    staticSelf({ flags: ["unblockableBpAtLeast:5000"] }),
    staticSelf({ keywords: ["冲击1"] }, (env) => env.opponent.life.length === 1),
    withCondition(
      onPlay(markThisTurn("Mikasa Ackermann AOT-2-008 When Played"), ifThen((env) => fourUnique(env) && env.opponent.life.length <= 5, [activate("self")])),
      notMarkedThisTurn("Mikasa Ackermann AOT-2-008 When Played")
    )
  ],

  // Levi:
  // 《During Your Turn》 This character gains 1000 BP.
  // 《Activate: Main》 《Pay 1 AP》 You can only activate this ability if you have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field. Choose {one} of the abilities listed below. You may place one card from your hand into your sideline. If you do, {two} instead. You can only activate this <Levi> ability one time each turn.
  // ・Switch this character to active.
  // ・This character gains 《Double Attack》 (When this character attacks for the first time this turn, switch it to active) until the end of the turn.
  "UEX07BT/AOT-2-009": [
    staticSelf({ bp: 1000 }, duringYourTurn),
    activateMain({ costs: [apCost(1)], condition: (env) => fourUnique(env) && notMarkedThisTurn("Levi AOT-2-009 Activate: Main")(env) },
      markThisTurn("Levi AOT-2-009 Activate: Main"),
      ifThen((env) => env.owner.hand.length > 0, [may("将 1 张手牌置于场外，改为两项效果都选择？", discard(1), run("两项效果都选择", (env) => { env.vars.both = ["1"]; }))]),
      ifThen(chosenCount("both"), [activate("self"), grant("self", "2次攻击")], [
        chooseMode("mode", ["将此角色转为活跃状态", "本回合中，此角色获得《2次攻击》"]),
        ifThen(modeIs("mode", 0), [activate("self")], [grant("self", "2次攻击")])
      ]))
  ],

  // Annie Leonhart: 《Activate: Main》 《Switch to Resting》 《Once Per Turn》 This character gains 《Yellow》 energy generation and "At the end of the main phase, sideline this character" until the end of the turn.
  "UEX07BT/AOT-2-010": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    sidelineAtMainEnd
  ],

  // Armin Arlelt: 《When Played》 Draw a card, then place one card from your hand into your sideline.
  "UEX07BT/AOT-2-011": [onPlay(draw(1), discard(1))],

  // Armin Arlelt: 《When Played》 {Draw a card, then place one card from your hand into your sideline}. If you have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field, {Draw a card} instead.
  "UEX07BT/AOT-2-012": [onPlay(ifThen(fourUnique, [draw(1)], [draw(1), discard(1)]))],

  // Armin Arlelt (Colossal Titan): left out (see the top of the file).

  // Pieck Finger:
  // 《When Played》 《#If on the Energy Line#》 If you have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field, switch this character to active.
  // 《Activate: Main》 《Switch to Resting》 Choose one other character on your field. It gains 1000 BP until the end of the turn.
  "UEX07BT/AOT-2-014": [
    withCondition(onPlay(activate("self")), all(selfOnEnergy, fourUnique)),
    activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))
  ],

  // Falco Grice: 《When Played》 Choose up to one other character on your field. It gains 1000 BP until the end of the turn.
  "UEX07BT/AOT-2-015": [onPlay(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // Falco Grice: 《When Played》 Look at the top three cards of your deck. Reveal up to one character card without [Rumbling] affinity and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If you added a card to your hand, place one card from your hand into your sideline.
  "UEX07BT/AOT-2-016": [onPlay(...lookTakeOneThenDiscard(3, and(isCharacterCard, notRumbling), "公开最多 1 张没有 [Rumbling] 特征的角色卡并加入手牌"))],

  // Falco Grice (Jaw Titan):
  // 《Raid》 <Falco Grice> Switch to active. May move to the front line.
  // 《Step》 (During your movement phase, you may move this card from your front line to your energy line.)
  // 《When Played》 Choose up to three characters on your field or character cards in your sideline with 3 or less required energy and unique card names and without [Rumbling] affinity and place them face down under this character.
  // 《Activate: Main》 《Switch to Resting》 Look at the face-down cards under this character. Add up to one card among them to your hand.
  // (The data's keywords lack 《Step》, so this card gives it to itself.)
  "UEX07BT/AOT-2-017": [
    staticSelf({ keywords: ["撤步"] }),
    onPlay(...jawTitanUnder),
    activateMain({ costs: [restSelf] },
      run("确认此角色下方背面朝上的卡牌", (env) => {
        if (!env.self?.faceDown?.length) return;
        env.game.looking = { ownerId: env.owner.accountId, cards: [...env.self.faceDown] };
        env.self.faceDown = [];
      }),
      chooseLooked("pick", { max: 1, prompt: "选择最多 1 张此角色下方的卡牌加入手牌" }),
      moveChosen("pick", "hand"),
      run("其余的卡牌仍背面朝上置于此角色下方", (env) => {
        const looking = env.game.looking;
        if (!looking) return;
        if (env.self) env.self.faceDown = [...(env.self.faceDown ?? []), ...looking.cards];
        else env.owner.sideline.push(...looking.cards);
        looking.cards = [];
      }))
  ],

  // Reiner Braun (Armored Titan):
  // 《Raid》 <Reiner Braun> Switch to active. May move to the front line.
  // 《Nullify Impact》 (The character battling this character loses Impact for the duration of this battle.)
  // 《When Played》 If you have four or more yellow characters without [Rumbling] affinity whose card names are unique on your field, this character gains 1000 BP, 《Impact (1)》, and "Your opponent cannot choose this character with abilities on characters or event cards unless they pay 1 AP as an additional cost" until the start of your next turn.
  // (The data's keywords lack 《Nullify Impact》, so this card gives it to itself.)
  "UEX07BT/AOT-2-019": [
    staticSelf({ keywords: ["冲击无效"] }),
    withCondition(onPlay(bp("self", 1000, "untilYourNextTurn"), grant("self", "冲击1", "untilYourNextTurn"), flag("self", "taxAp:character", "untilYourNextTurn"), flag("self", "taxAp:event", "untilYourNextTurn")), fourUnique)
  ],

  // Eren Jaeger (UEX07BT/AOT-2-020): printed "-" (no ability text).

  // Eren Jaeger: If <Ymir, Our Founder> is on your field or in your sideline, this character gains 《Yellow》 energy generation.
  "UEX07BT/AOT-2-021": [staticSelf({ energy: 1 }, ymirOnFieldOrSideline)],

  // Eren Jaeger (Doomsday Titan):
  // If a character with "Zeke" in its card name is on your field and <Eren Jaeger (Doomsday Titan)> is not on your field, reduce this card's required energy by 《Yellow×5》 while anywhere other than on your field.
  // This character cannot block a character with 《Impact》.
  // 《Raid》 <Eren Jaeger> Switch to active. May move to the front line.
  // 《Impact (1)》 (When this character attacks and wins a battle, deal 1 damage to your opponent.)
  // 《When Played》 Play up to one [Nine Titans] affinity card from your hand or sideline set to active onto your field.
  // 《Activate: Main》 《Pay 1 AP》 《Once Per Turn》 You cannot activate this ability on the turn this character is played. Activate this character's 《When Played》 ability.
  // (The data's keywords lack 《Impact (1)》, so this card gives it to itself.)
  "UEX07BT/AOT-2-022": [
    costChange({ energy: 5 }, all(youHaveNameIncluding("Zeke"), notDoomsdayOnField)),
    staticSelf({ flags: ["cannotBlockImpact"], keywords: ["冲击1"] }),
    onPlay(...playNineTitan),
    activateMain({ costs: [apCost(1)], once: true, condition: (env) => !playedThisTurn(env) }, ...playNineTitan)
  ],

  // Eren Jaeger / Zeke Jaeger (AOT-2-023): printed "-" (no ability text).

  // Zeke Jaeger:
  // 《When Played》 Choose one of the following:
  // ・Look at the top three cards of your deck. Place up to one card into your sideline. Place the remaining cards on the bottom of your deck in any order.
  // ・If this character is played from your sideline, draw a card.
  "UEX07BT/AOT-2-024": [onPlay(
    chooseMode("mode", ["查看卡组最上方的 3 张卡，将最多 1 张置于场外，其余自选顺序置于卡组最下方", "此角色从场外登场的场合，抽 1 张卡牌"]),
    ifThen(modeIs("mode", 0),
      [look(3), chooseLooked("pick", { max: 1, prompt: "选择最多 1 张置于场外" }), moveChosen("pick", "sideline"), lookedToBottom()],
      [ifThen((env) => env.cause?.from === "sideline", [draw(1)])])
  )],

  // Zeke Jaeger (Beast Titan):
  // 《Raid》 <Zeke Jaeger> Switch to active. May move to the front line.
  // 《When Played》 This character gains 《Impact (1)》 until the end of the turn. Choose up to one character with {3000 or less BP} on your opponent's front line and sideline it. If there is a character with "Eren" in its card name on your field and <Ymir, Our Founder> is on your field or in your sideline, {4000 or less BP} instead.
  "UEX07BT/AOT-2-025": [onPlay(
    grant("self", "冲击1"),
    chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost((env) => (youHaveNameIncluding("Eren")(env) && ymirOnFieldOrSideline(env) ? 4000 : 3000)), prompt: "选择对方前线最多 1 张 BP 不高于 3000（我方场上有卡名含 Eren 的角色且〈Ymir, Our Founder〉在我方场上或场外时为 4000）的角色退场" }),
    sideline(chosen("target"))
  )],

  // Jaw Titan: If there is a character with "Eren" in its card name and a character with "Zeke" in its card name on your field, this character gains "This character generates energy even on the front line."
  "UEX07BT/AOT-2-026": [staticSelf({ flags: ["energyOnFront"] }, erenAndZeke)],

  // Beast Titan:
  // 《Step》 (During your movement phase, you may move this card from your front line to your energy line.)
  // 《During Your Turn》 If there is a character with "Eren" in its card name and a character with "Zeke" in its card name on your field, this character gains 1500 BP.
  "UEX07BT/AOT-2-027": [staticSelf({ bp: 1500 }, all(duringYourTurn, erenAndZeke))],

  // War Hammer Titan: If there is a character with "Eren" in its card name and a character with "Zeke" in its card name on your field, this character gains "Your opponent's character abilities cannot sideline this character or reduce its BP" and 《Double Block》 (When this character blocks for the first time this turn, switch it to active.)
  "UEX07BT/AOT-2-028": [staticSelf({ flags: ["immuneOppCharacter"], keywords: ["2次阻挡"] }, erenAndZeke)],

  // Colossal Titan (AOT-2-029): left out (see the top of the file).

  // Tom Ksaver: 《When Played》 《When Sidelined》 Reveal the top two cards of your deck. Add up to one card with "Zeke" in its card name among them to your hand. Place the remaining cards into your sideline. If you added a card to your hand, place one card from your hand into your sideline.
  "UEX07BT/AOT-2-030": [when(["onPlay", "onSidelined"],
    look(2),
    chooseLooked("pick", { max: 1, filter: nameIncludes("Zeke"), prompt: "公开最多 1 张卡名含 Zeke 的卡并加入手牌" }),
    moveChosen("pick", "hand"),
    run("其余的卡牌置于场外", (env) => {
      const looking = env.game.looking;
      if (!looking) return;
      env.owner.sideline.push(...looking.cards);
      looking.cards = [];
    }),
    ifThen(chosenCount("pick"), [discard(1)]))],

  // Ymir, Our Founder (site):
  // This site can only be played if there is a character with "Jaeger" in its card name on your field.
  // 《When Played》 Look at the top four cards of your deck. Reveal up to one [Inheritor of the Titan] affinity card and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If you added a card to your hand, place one card from your hand into your sideline.
  // 《Activate: Main》 《Switch to Resting》 《Place 2 Cards From Hand Into Sideline》 《Pay 1 AP》 Play one yellow character card with 2 or less required energy and "Jaeger" in its card name from your sideline set to resting onto your field.
  "UEX07BT/AOT-2-031": [
    staticSelf({ playCondition: youHaveNameIncluding("Jaeger") }),
    onPlay(...lookTakeOneThenDiscard(4, hasAffinity("Inheritor of the Titan"), "公开最多 1 张 [Inheritor of the Titan] 卡并加入手牌")),
    activateMain({ costs: [restSelf, discardCost(2), apCost(1)] },
      chooseFromSideline("card", { min: 1, max: 1, filter: and(isCharacterCard, ofColor("yellow"), energyCostAtMost(2), nameIncludes("Jaeger")), prompt: "从场外选择 1 张所需能量不高于 2、卡名含 Jaeger 的黄色角色以休息状态登场" }),
      ifThen(chosenCount("card"), [put("card", "choose", true)]))
  ],

  // I Hope You're Watching, Mister Ksaver!! (event):
  // Sideline one yellow character with "Zeke" in its card name on your field. If you do, choose up to one character with 5000 or less BP on your opponent's front line and sideline it, then choose up to one of the following:
  // ・Look at the top seven cards of your deck. Reveal up to one <Ymir, Our Founder> card and add it to your hand. Place the remaining cards on the bottom of your deck in any order.
  // ・If <Ymir, Our Founder> is on your field or in your sideline, play up to one yellow <Zeke Jaeger> card without 《Raid》 from your sideline set to resting onto your field.
  "UEX07BT/AOT-2-032": [onUse(
    chooseOwn("zeke", { min: 1, max: 1, filter: and(isCharacterCard, ofColor("yellow"), nameIncludes("Zeke")), prompt: "选择我方场上 1 张卡名含 Zeke 的黄色角色退场" }),
    sideline(chosen("zeke")),
    ifThen((env) => (env.vars.zeke ?? []).length > 0 && !fieldOf(env.owner).some((card) => card.uid === env.vars.zeke![0]), [
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(5000), prompt: "选择对方前线最多 1 张 BP 不高于 5000 的角色退场" }),
      sideline(chosen("target")),
      { do: "choose", as: "mode", from: "mode", side: "you", modes: ["查看卡组最上方的 7 张卡，公开最多 1 张〈Ymir, Our Founder〉并加入手牌", "〈Ymir, Our Founder〉在我方场上或场外的场合，从场外将最多 1 张没有突进的黄色〈Zeke Jaeger〉以休息状态登场"], min: 0, max: 1, prompt: "从下列选择最多 1 项", good: true },
      ifThen(modeIs("mode", 0), [look(7), chooseLooked("pick", { max: 1, filter: named(YMIR), prompt: "公开最多 1 张〈Ymir, Our Founder〉并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom()]),
      ifThen((env) => modeIs("mode", 1)(env) && ymirOnFieldOrSideline(env), [
        chooseFromSideline("card", { max: 1, filter: and(named("Zeke Jaeger"), ofColor("yellow"), noRaid), prompt: "从场外选择最多 1 张没有突进的黄色〈Zeke Jaeger〉以休息状态登场" }),
        ifThen(chosenCount("card"), [put("card", "choose", true)])
      ])
    ])
  )],

  // I'm Sorry. I Can't Do That: Choose up to two of your AP cards and switch them to active.
  "UEX07BT/AOT-2-033": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // Rumbling (event):
  // You can only use this card if there is a character with "Eren" in its card name and a character with "Zeke" in its card name on your field and you have two or more other cards in your hand.
  // Place all the cards in your hand into your sideline. Sideline all characters with 5000 or less BP on your opponent's front line. You gain "You cannot attack with characters other than <Eren Jaeger (Doomsday Titan)>" until the end of the turn.
  "UEX07BT/AOT-2-034": [{
    ...onUse(
      run("将手牌全部置于场外", (env) => { env.owner.sideline.push(...env.owner.hand.splice(0)); }),
      sideline((env): UnionArenaFieldCard[] => env.opponent.front.filter((card) => isCharacter(env, card) && bpOf(env.ctx, card) <= 5000)),
      run("本回合中，不能用〈Eren Jaeger (Doomsday Titan)〉以外的角色攻击", (env) => { env.game.turnMarks = [...(env.game.turnMarks ?? []), turnMarkKey(env, "onlyAttackWith:Eren Jaeger (Doomsday Titan)")]; })
    ),
    // The event itself is still in the hand when this is checked (and when asked by the computer players).
    useCondition: (env) => erenAndZeke(env) && env.owner.hand.length - (env.owner.hand.includes(env.selfCardId) ? 1 : 0) >= 2
  }],

  // Freedom: Choose up to two of your AP cards and switch them to active.
  "UEX07BT/AOT-2-035": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // We're Going. Now. To Save the World: Look at the top five cards of your deck. Reveal up to three character cards with unique card names and without [Rumbling] affinity and add them to your hand. Place the remaining cards on the bottom of your deck in any order.
  "UEX07BT/AOT-2-036": [onUse(
    look(5),
    chooseLooked("pick", { max: 3, filter: and(isCharacterCard, notRumbling), check: differentNames, prompt: "公开最多 3 张卡名各不相同、没有 [Rumbling] 特征的角色卡并加入手牌" }),
    moveChosen("pick", "hand"),
    lookedToBottom()
  )]
};

