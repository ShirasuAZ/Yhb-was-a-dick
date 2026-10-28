/** Abilities of the AOT cards, batch 1 (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { flagsOf } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, activeCard, all, and, apCost, apPaidInAttackPhaseThisTurn, bp, bpAtMost, chooseAp, chooseLooked, chooseOpponent, chooseOwn, chosen,
  chosenCount, costChange, discard, draw, duringOpponentTurn, duringYourTurn, either, energyThisTurn, flag, grant, grantAbility, givenOnly, ifThen, may, moveChosen, noneChosen, notSelf,
  ofColor, onAttack, onPlay, onUse, oncePerTurn, opponentHasColor, rest, restSelf, run, selfActive, selfOnFront, sideline, staticSelf, toHand, when, withCondition, youHaveNamed,
  usedEventThisTurn, mayPayApEffect, look, lookedToBottom
} from "./dsl.ts";

// ---- Helpers for the AOT cards ----
type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const fieldCharacters = (env: AbilityEnv, owner = env.owner): UnionArenaFieldCard[] => [...owner.front, ...owner.energy].filter((card) => env.ctx.card(card.cardId)?.type === "character");
/** AOT prints several affinities in one string, joined by "／" ("104th Cadet Corps／Levi Squad"): the affinity parts of a card. */
const affinityParts = (env: AbilityEnv, cardId: string): string[] => (env.ctx.card(cardId)?.affinities ?? []).flatMap((entry) => entry.split("／").map((part) => part.trim()));
/** The card has the affinity (one part of its printed affinity line). */
const withPart = (affinity: string): CardFilter => (env, cardId) => affinityParts(env, cardId).includes(affinity);
const isEventCard: CardFilter = (env, cardId) => env.ctx.card(cardId)?.type === "event";
const isBlueEvent = and(isEventCard, ofColor("blue"));
/** Event cards in our sideline. */
const eventsInSideline = (env: AbilityEnv): number => env.owner.sideline.filter((cardId) => env.ctx.card(cardId)?.type === "event").length;
/** 我方场外的事件卡牌存在N张或更多 */
const eventsInSidelineAtLeast = (count: number): Condition => (env) => eventsInSideline(env) >= count;
/** 我方场上存在卡牌名包含“Ymir”的角色 */
const ymirCharacterOnField: Condition = (env) => fieldCharacters(env).some((card) => (env.ctx.card(card.cardId)?.name ?? "").includes("Ymir"));
/** The delayed effect "At the start of the attack phase this turn, choose up to one of your AP cards and switch it to active" (given to the card by grantAbility). */
const apAtAttackStart = (): Ability => givenOnly(when(["onAttackStart"], chooseAp("ap", 1), activateAp("ap")));
const lookedStep = (as: string, extra: Partial<Extract<Step, { do: "choose" }>>): Step =>
  ({ do: "choose", as, from: "looked", side: "you", min: 0, max: 99, prompt: "", good: true, ...extra });
/** Puts the picked looked-at cards on top of the deck (the first pick on top) and the remaining ones into the sideline. */
const placeLookedOnTop = (...names: string[]): Step => run("确认的卡牌按选择的顺序置于卡组最上方，其余置于场外", (env) => {
  const looking = env.game.looking;
  if (!looking) return;
  const keys = names.flatMap((name) => env.vars[name] ?? []);
  const kept = keys.map((key) => looking.cards[Number(key.slice(2))]).filter((cardId): cardId is string => !!cardId);
  const others = looking.cards.filter((_, index) => !keys.includes(`l:${index}`));
  looking.cards = [];
  env.owner.library.unshift(...kept);
  env.owner.sideline.push(...others);
});
/** 将它们自选顺序置于我方卡组的最上方 (all of them; the first card picked ends up on top). */
const allLookedOnTop = (): Step[] => [
  lookedStep("top", { all: true, prompt: "依次点选确认的卡，按点选顺序放到卡组最上方（先点的在最上面）" }),
  placeLookedOnTop("top")
];
/** 将其中任意数量的卡牌自选顺序置于我方卡组的最上方，然后将剩余的卡牌置于场外 (pick the top card, then the next one; unpicked cards go to the sideline). */
const anyLookedOnTopRestToSideline = (): Step[] => [
  lookedStep("top1", { max: 1, prompt: "选择放在卡组最上方的第 1 张（不选则全部置于场外）" }),
  ifThen(chosenCount("top1"), [lookedStep("top2", { max: 1, exclude: "top1", prompt: "选择放在其下方的第 2 张（不选则其余置于场外）" })]),
  placeLookedOnTop("top1", "top2")
];
/** "<ability text>的此效果1回合只能发动1次" for the ability of cards with this name: marks on the game for this turn, per player. */
const turnMarkKey = (env: AbilityEnv, text: string): string => `${env.game.turn}:${env.owner.accountId}:${text}`;
const notMarkedThisTurn = (text: string): Condition => (env) => !(env.game.turnMarks ?? []).includes(turnMarkKey(env, text));
const markThisTurn = (text: string): Step => run("本回合已发动过此效果", (env) => { env.game.turnMarks = [...(env.game.turnMarks ?? []), turnMarkKey(env, text)]; });
/** Records on the card that its (non-automatic) 「每回合1次」 ability `index` has been used this turn. */
const markUsed = (index: number): Step => run("本回合已发动过此效果", (env) => { if (env.self) env.self.used = [...(env.self.used ?? []), index]; });
const notUsed = (index: number): Condition => (env) => !!env.self && !(env.self.used ?? []).includes(index);
const leviThirdAttackSnipe = "leviThirdAttackSnipe";

export const AOT_1_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // Erwin Smith (UE10BT/AOT-1-001): printed "-" (no ability text).
  "UE10BT/AOT-1-001": [],

  // Erwin Smith:
  // 《When Played》 Look at the top three cards of your deck. Reveal up to one <Levi> card among them and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If you added a card to your hand, place one card from your hand into your sideline.
  // 《Activate: Main》 《Pay 1 AP》 《Once Per Turn》 This character gains 《Blue》 energy generation until the end of the turn. At the start of the attack phase this turn, choose up to one of your AP cards and switch it to active.
  "UE10BT/AOT-1-002": [
    onPlay(look(3), chooseLooked("pick", { max: 1, filter: (env, cardId) => env.ctx.card(cardId)?.name === "Levi", prompt: "公开最多 1 张〈Levi〉并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)])),
    activateMain({ costs: [apCost(1)], once: true }, energyThisTurn("self", 1), grantAbility("self", 2)),
    apAtAttackStart()
  ],

  // Hange Zoë:
  // 《When Played》 You may choose one active [Inheritor of the Titan] or [Pure Titan] affinity card on your field or your opponent's field and switch it to resting. If you do, the player whose character was switched to resting with this ability draws a card.
  "UE10BT/AOT-1-003": [onPlay(ifThen(
    (env) => [env.owner, env.opponent].some((player) => [...player.front, ...player.energy].some((card) => !card.rested && (withPart("Inheritor of the Titan")(env, card.cardId, card) || withPart("Pure Titan")(env, card.cardId, card)))),
    [may("将 1 张活跃状态的 [Inheritor of the Titan] 或 [Pure Titan] 卡牌转为休息状态？",
      { do: "choose", as: "target", from: "field", side: "any", min: 1, max: 1, characters: false, good: false, prompt: "选择我方或对方场上 1 张活跃状态的 [Inheritor of the Titan] 或 [Pure Titan] 卡牌（转为休息状态，其控制者抽 1 张卡）",
        filter: and(activeCard, either(withPart("Inheritor of the Titan"), withPart("Pure Titan"))) },
      rest(chosen("target")),
      run("被转为休息状态的卡牌的玩家抽 1 张卡牌", (env) => {
        const uid = env.vars.target?.[0];
        const holder = env.players.find((player) => [...player.front, ...player.energy].some((card) => card.uid === uid && card.rested));
        const drawn = holder?.library.splice(0, 1) ?? [];
        holder?.hand.push(...drawn);
      }))]))],

  // Eld Gin: 《During Your Turn》 If you have paid an AP cost during the attack phase this turn, this character gains 2000 BP.
  "UE10BT/AOT-1-004": [staticSelf({ bp: 2000 }, all(duringYourTurn, apPaidInAttackPhaseThisTurn))],

  // Oruo Bozad: 《Activate: Main》 《Switch to Resting》 《Once Per Turn》 This character gains 《Blue》 energy generation until the end of the turn. At the end of the main phase, sideline this character.
  "UE10BT/AOT-1-005": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    givenOnly(when(["onMainEnd"], sideline("self")))
  ],

  // Petra Rall: 《When Played》 At the start of the attack phase this turn, choose up to one of your AP cards and switch it to active.
  "UE10BT/AOT-1-006": [onPlay(grantAbility("self", 1)), apAtAttackStart()],

  // Levi (UE10BT/AOT-1-007): printed "-" (no ability text).
  "UE10BT/AOT-1-007": [],

  // Levi: 《When Attacking》 You may pay 1 AP. If you do, draw a card and give this character 500 BP until the end of the turn.
  "UE10BT/AOT-1-008": [onAttack(mayPayApEffect("支付 1 AP：抽 1 张卡牌，此角色本回合 BP+500？", 1, draw(1), bp("self", 500)))],

  // Levi: 《When Attacking》 You may pay 1 AP. If you do, draw a card and give this character 1000 BP until the end of the turn.
  "UE10BT/AOT-1-009": [onAttack(mayPayApEffect("支付 1 AP：抽 1 张卡牌，此角色本回合 BP+1000？", 1, draw(1), bp("self", 1000)))],

  // Levi:
  // 《If on the Front Line》 At the start of your attack phase, if this character is active, choose up to one of your AP cards and switch it to active.
  // 《When Attacking》 You may pay 1 AP. If you do, choose up to one character on your field. It gains 1000 BP and "This character cannot be chosen by your opponent's trigger abilities" until the end of the turn.
  "UE10BT/AOT-1-010": [
    withCondition(when(["onAttackStart"], chooseAp("ap", 1), activateAp("ap")), all(selfOnFront, selfActive)),
    onAttack(mayPayApEffect("支付 1 AP：选择我方场上最多 1 张角色，本回合 BP+1000 且不会被对方的触发能力选择？", 1,
      chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+1000，不会被对方的触发能力选择）" }), bp(chosen("target"), 1000), flag(chosen("target"), "noTriggerTarget")))
  ],

  // Levi:
  // 《Raid》 <Levi> Switch to active. May move to the front line.
  // 《Once Per Turn》 At the end of this character's attack, you may pay 1 AP. If you do, switch this character to active.
  // 《When Played》 This character gains 1000 BP, 《Double Attack》 (When this character attacks for the first time this turn, switch it to active), and "When this character attacks a third time this turn, it gains 《Snipe》 (You may target a character on your opponent's front line and attack it with this character. If you do, your opponent cannot block) until the end of the attack" until the end of the turn.
  "UE10BT/AOT-1-011": [
    // 「每回合1次」 counts only when the AP is actually paid: declining after an earlier attack keeps it for the next attack's end.
    withCondition(when(["onAttackEnd"], mayPayApEffect("支付 1 AP：将此角色转为活跃状态？", 1, markUsed(0), activate("self"))), notUsed(0)),
    onPlay(bp("self", 1000), grant("self", "2次攻击"), flag("self", leviThirdAttackSnipe)),
    // The third attack of the turn is declared when this character has attacked twice; Snipe is needed at that declaration.
    staticSelf({ keywords: ["瞄准攻击"] }, (env) => !!env.self && flagsOf(env.self).includes(leviThirdAttackSnipe) && env.self.attacks === 2)
  ],

  // Ymir (UE10BT/AOT-1-012): printed "-" (no ability text).
  "UE10BT/AOT-1-012": [],

  // Ymir: 《During Opponent's Turn》 If <Historia Reiss> is on your field, this character gains 1000 BP.
  "UE10BT/AOT-1-013": [staticSelf({ bp: 1000 }, all(duringOpponentTurn, youHaveNamed("Historia Reiss")))],

  // Ymir (Jaw Titan):
  // 《Raid》 <Ymir> Switch to active. May move to the front line.
  // 《When Attacking》 《Once Per Turn》 Draw a card, then place one card from your hand into your sideline. Then, if you have six or more event cards in your sideline, you may switch this character to active.
  "UE10BT/AOT-1-014": [oncePerTurn(onAttack(draw(1), discard(1), ifThen(eventsInSidelineAtLeast(6), [may("将此角色转为活跃状态？", activate("self"))])))],

  // Armin Arlelt: 《When Played》 Return one other character on your field with 1 or less required energy to your hand. If you cannot, return this character to your hand.
  "UE10BT/AOT-1-015": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= 1), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // Conny Springer: If there is a green or red card on your opponent's field, reduce this card's required energy by 《Blue×1》 while in your hand.
  "UE10BT/AOT-1-016": [costChange({ energy: 1 }, opponentHasColor("green", "red"))],

  // Historia Reiss (UE10BT/AOT-1-019): printed "-" (no ability text).
  "UE10BT/AOT-1-019": [],

  // Historia Reiss: 《When Played》 Look at the top two cards of your deck. {Place them on the top of your deck in any order}. If a character with "Ymir" in its card name is on your field, {Place any number of them on the top of your deck in any order, then place any remaining cards into your sideline} instead.
  "UE10BT/AOT-1-020": [onPlay(look(2), ifThen(ymirCharacterOnField, anyLookedOnTopRestToSideline(), allLookedOnTop()))],

  // Historia Reiss:
  // If a character with "Ymir" in its card name is on your field, this character gains 500 BP.
  // 《When Played》 If you have used an event card this turn, choose up to one of your AP cards and switch it to active. You can only activate this <Historia Reiss> ability one time each turn.
  "UE10BT/AOT-1-021": [
    staticSelf({ bp: 500 }, ymirCharacterOnField),
    withCondition(onPlay(markThisTurn("Historia Reiss 021 When Played"), ifThen(usedEventThisTurn, [chooseAp("ap", 1), activateAp("ap")])), notMarkedThisTurn("Historia Reiss 021 When Played"))
  ],

  // Historia Reiss:
  // 《Raid》 <Historia Reiss> Switch to active. May move to the front line.
  // This character gains all abilities listed below if you have the required number of event cards in your sideline.
  // ・Two or more: 《When Attacking》 Choose up to one other [104th Cadet Corps] affinity card on your field. It gains 1000 BP until the end of the turn.
  // ・Four or more: 《Activate: Main》 《If on the Front Line》 《Once Per Turn》 If you have used an event card this turn, choose up to one of your AP cards and switch it to active.
  // ・Six or more: 《Impact (1)》
  "UE10BT/AOT-1-022": [
    withCondition(onAttack(chooseOwn("target", { max: 1, filter: and(notSelf, withPart("104th Cadet Corps")), prompt: "选择我方场上最多 1 张其他 [104th Cadet Corps] 卡牌（本回合 BP+1000）" }), bp(chosen("target"), 1000)), eventsInSidelineAtLeast(2)),
    activateMain({ condition: all(selfOnFront, eventsInSidelineAtLeast(4)), once: true }, ifThen(usedEventThisTurn, [chooseAp("ap", 1), activateAp("ap")])),
    staticSelf({ keywords: ["冲击1"] }, eventsInSidelineAtLeast(6))
  ],

  // Mikasa Ackermann: 《When Played》 Draw a card, then place one card from your hand into your sideline.
  "UE10BT/AOT-1-023": [onPlay(draw(1), discard(1))],

  // Mikasa Ackermann:
  // This character gains all abilities listed below if you have the required number of event cards in your sideline.
  // ・Two or more: This character gains 《Blue》 energy generation.
  // ・Four or more: This character gains 1000 BP.
  "UE10BT/AOT-1-024": [staticSelf({ energy: 1 }, eventsInSidelineAtLeast(2)), staticSelf({ bp: 1000 }, eventsInSidelineAtLeast(4))],

  // Mikasa Ackermann:
  // Your opponent cannot activate 《Active Trigger》 abilities during trigger checks resulting from damage dealt by this character.
  // 《When Played》 Choose up to one character with 4000 or less BP on your opponent's front line and return it to their hand.
  "UE10BT/AOT-1-025": [
    staticSelf({ flags: ["noActiveTrigger"] }),
    onPlay(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(4000), prompt: "选择对方前线 1 张 BP 不高于 4000 的角色放回手牌" }), toHand(chosen("target")))
  ],

  // Eren Jaeger: If this character is active, it gains 《Blue》 energy generation.
  "UE10BT/AOT-1-026": [staticSelf({ energy: 1 }, selfActive)],

  // Eren Jaeger:
  // 《Nullify Impact》 (The character battling this character loses 《Impact》 for the duration of this battle.)
  // 《When Played》 Look at the top five cards of your deck. Reveal up to one blue event card among them and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If you added a card to your hand, place one card from your hand into your sideline.
  "UE10BT/AOT-1-027": [onPlay(look(5), chooseLooked("pick", { max: 1, filter: isBlueEvent, prompt: "公开最多 1 张蓝色事件卡并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // Former Headquarters of the Scout Regiment: 《Activate: Main》 《Switch to Resting》 Reveal the top card of your deck. If the revealed card is a blue character card with 3 or less required energy, add it to your hand. If you do not add it to your hand, place it on the top of your deck.
  "UE10BT/AOT-1-028": [activateMain({ costs: [restSelf] }, run("公开卡组最上方的 1 张卡牌；是所需能量不高于 3 的蓝色角色卡则加入手牌，否则放回卡组最上方", (env) => {
    const top = env.owner.library[0];
    if (!top) return;
    const stats = env.ctx.card(top);
    env.game.log.push(`${env.owner.username} 公开卡组最上方的「${stats?.name ?? "未知卡牌"}」`);
    if (stats?.type === "character" && stats.color === "blue" && stats.energyCost <= 3) env.owner.hand.push(env.owner.library.shift()!);
  }))],

  // Memory: Draw a card, then place one card from your hand into your sideline. Choose up to one of your AP cards and switch it to active.
  "UE10BT/AOT-1-029": [onUse(draw(1), discard(1), chooseAp("ap", 1), activateAp("ap"))],

  // You Call That Clean?! Do It All Again.: Choose up to two of your AP cards and switch them to active.
  "UE10BT/AOT-1-030": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // Cleanup: Look at the top two cards of your deck. Place any number of them on the top of your deck in any order, then place any remaining cards into your sideline. Draw two cards.
  "UE10BT/AOT-1-031": [onUse(look(2), ...anyLookedOnTopRestToSideline(), draw(2))],

  // Bombs: Choose up to one character with 3500 or less BP on your opponent's front line and return it to their hand.
  "UE10BT/AOT-1-032": [onUse(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3500), prompt: "选择对方前线 1 张 BP 不高于 3500 的角色放回手牌" }), toHand(chosen("target")))],

  // Historia's Resolve: Choose one character with {2000} or less BP on your opponent's front line and sideline it. If <Historia Reiss> is on your field, add 1000 to the BP range of the character you may choose with this ability for each event card in your sideline.
  "UE10BT/AOT-1-033": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => 2000 + (youHaveNamed("Historia Reiss")(env) ? 1000 * eventsInSideline(env) : 0)), prompt: "选择对方前线 1 张 BP 不高于 2000（我方场上有〈Historia Reiss〉时，场外每有 1 张事件卡 +1000）的角色退场" }),
    sideline(chosen("target")))],

  // Levi's Barrage: Choose one character with {3000 or less BP} on your opponent's front line and sideline it. If <Levi> is on your field, {5000 or less BP} instead.
  "UE10BT/AOT-1-034": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (youHaveNamed("Levi")(env) ? 5000 : 3000)), prompt: "选择对方前线 1 张 BP 不高于 3000（我方场上有〈Levi〉时为 5000）的角色退场" }),
    sideline(chosen("target")))],

  // Kenny Ackermann: If there is a blue or red card on your opponent's field, reduce this card's required energy by 《Green×1》 while in your hand.
  "UE10BT/AOT-1-035": [costChange({ energy: 1 }, opponentHasColor("blue", "red"))]
};
