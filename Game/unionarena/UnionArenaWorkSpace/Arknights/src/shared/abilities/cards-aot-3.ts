/**
 * Abilities of the AOT cards, batch 3 (UE10BT/AOT-1-070 … 100, UE10ST/AOT-1-068 and 070; see cards.ts for the conventions). Each entry follows the
 * card's printed text, shown above it. The keyword lines that start a line (《Raid》, …) and the life-card trigger are read from the card data and not
 * repeated. Cards printing "-" (079, 083, 085, 090) have no ability text and need no entry.
 *
 * Notes on the data: an AOT card's affinities are one string joined by "／"; the engine splits them (`withAffinity("104th Cadet Corps")` works).
 * `keywords` of 092, 093 and 094 lacks the Impact (1) / Damage (2) they print, so those cards give them to themselves.
 * 095 Basement prints required energy 0 in the data, so its "reduce by Red×2" has no visible effect (it is encoded as printed).
 */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { costOf, LINE_LIMIT, loseIfNoLife, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, apCostIs, bp, bpAtMost, chooseAp, chooseFromHand, chooseLooked, chooseMode, chooseOpponent, chooseOwn, chosen, chosenCount,
  costChange, discard, discardCost, draw, duringYourTurn, either, energyCostAtMost, energyThisTurn, flag, givenOnly, grant, grantAbility, ifThen, isCharacterCard, look,
  lookedToBottom, may, moveChosen, named, notSelf, ofColor, onPlay, onAttack, onUse, oncePerTurn, opponentHasColor, put, raiseNextBpRange, restSelf, run, selfActive,
  selfOnFront, sideline, sidelineSelf, staticSelf, toHand, usedAffinityThisTurn, when, withAffinity, withCondition, youHaveNamed
} from "./dsl.ts";

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;

// ---- Helpers for the AOT cards ----

const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";
const CADET = "104th Cadet Corps";
const cadet = withAffinity(CADET);
const nameIncludes = (part: string): CardFilter => (env, cardId) => (env.ctx.card(cardId)?.name ?? "").includes(part);
/** 我方的场上存在卡牌名中含有 "part" 的角色 */
const youHaveNameIncluding = (part: string): Condition => (env) => fieldOf(env.owner).some((card) => isCharacter(env, card) && nameIncludes(part)(env, card.cardId, card));
/** Required energy of a hand card now (with cost changes). */
const handCost = (env: AbilityEnv, cardId: string): number => costOf(env.game, env.players, env.ctx, env.owner.accountId, cardId).energy;
const handCostAtMost = (limit: number): CardFilter => (env, cardId) => handCost(env, cardId) <= limit;
const handCostIs = (value: number): CardFilter => (env, cardId) => handCost(env, cardId) === value;
/** 我方的生命区有N张或更少 */
const lifeAtMost = (count: number): Condition => (env) => env.owner.life.length <= count;
/** 我方场上存在N张或更多其他的 [104th Cadet Corps] 卡牌 */
const otherCadetsAtLeast = (count: number): Condition => (env) =>
  fieldOf(env.owner).filter((card) => card.uid !== env.self?.uid && cadet(env, card.cardId, card)).length >= count;
/** 我方在本回合中使用过 [Food] 的卡牌 */
const usedFood = usedAffinityThisTurn("Food");

const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;

/** 获得“当主要阶段结束时，将此角色退场” (given with grantAbility). */
const sidelineAtMainEnd = givenOnly(when(["onMainEnd"], sideline("self")));
/** 获得“在攻击阶段结束时，将此角色放回手牌” (given with grantAbility; AOT Eren Jaeger 092 and the event 099). */
const returnAtAttackPhaseEnd = (): Ability => givenOnly(when(["onAttackPhaseEnd"], toHand("self")));

/** Return one other character on your field with 1 or less required energy to your hand. If you cannot, return this character to your hand. */
const returnSmallOrSelf: Step[] = [
  chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
  toHand(chosen("target")),
  ifThen((env) => (env.vars.target ?? []).length === 0, [toHand("self")])
];

/** Choose up to one other character on your field. It gains 1000 BP until the end of the turn. */
const otherGainsThousand: Step[] = [chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000)];

/** Armin Arlelt 077's 《When Played》 (also the text of its Activate: Main). */
const arminModes: Step[] = [
  chooseMode("mode", ["选择我方场上最多 1 张其他角色，本回合 BP+1000", "本回合中，下一次选择指定 BP 范围的角色时，指定的 BP 范围 +1000"]),
  ifThen(modeIs("mode", 0), otherGainsThousand, [raiseNextBpRange])
];

/** Draw a card, then place one card from your hand into your sideline. */
const drawThenDiscard: Step[] = [draw(1), discard(1)];

/** Looks at the top cards and adds up to one that meets the filter to the hand; the rest go to the bottom; if a card was added, discard one. */
const lookTakeOneThenDiscard = (count: number, filter: CardFilter, prompt: string): Step[] => [
  look(count), chooseLooked("pick", { max: 1, filter, prompt }), moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)])
];

/** The red 104th Cadet Corps card with 3 or less required energy and 1 AP cost that 092 and 099 play from the hand set to active. */
const smallCadet = and(isCharacterCard, ofColor("red"), handCostAtMost(3), apCostIs(1), cadet);
/** Play up to one such card onto the front line set to active; it gains "At the end of the attack phase, return this character to your hand" (the ability at `returnIndex`). */
const playSmallCadet = (name: string, returnIndex: number, prompt: string): Step[] => [
  chooseFromHand(name, { max: 1, filter: smallCadet, prompt }),
  ifThen(chosenCount(name), [put(name, "front", false), grantAbility(chosen(`placed:${name}`), returnIndex)])
];

// Mikasa Ackermann 088's replacement of "returned to your hand": the follow-up ability that places a hand card into the sideline (index 2 below).
const MIKASA_088_DISCARD_INDEX = 2;

export const AOT_3_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // Hannes: 《When Played》 Return one other character on your field with 1 or less required energy to your hand. If you cannot, return this character to your hand.
  "UE10BT/AOT-1-070": [onPlay(...returnSmallOrSelf)],

  // Eren Kruger: 《Activate: Main》 《Switch to Resting》 《Sideline This Card》 You can only activate this ability if <Grisha Jaeger> is on your field. Draw two cards, then place one card from your hand into your sideline.
  "UE10BT/AOT-1-071": [activateMain({ costs: [restSelf, sidelineSelf], condition: youHaveNamed("Grisha Jaeger") }, draw(2), discard(1))],

  // Grisha Jaeger: 《When Played》 Look at the top five cards of your deck. Reveal up to one red character card with "Eren Jaeger" in its card name or up to one <Key to the Basement> card among them and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If you added a card to your hand, place one card from your hand into your sideline.
  // (Read as up to one card in total, from either group.)
  "UE10BT/AOT-1-072": [onPlay(...lookTakeOneThenDiscard(5, either(and(isCharacterCard, ofColor("red"), nameIncludes("Eren Jaeger")), named("Key to the Basement")), "公开最多 1 张卡名含 Eren Jaeger 的红色角色卡或〈Key to the Basement〉并加入手牌"))],

  // Levi: Play this character set to active onto your field.
  //       《Double Attack》 (When this character attacks for the first time this turn, switch it to active.)
  "UE10BT/AOT-1-073": [onPlay(activate("self"))],

  // Ymir: If there is a blue or green card on your opponent's field, reduce this card's required energy by 《Red×1》 while in your hand.
  "UE10BT/AOT-1-074": [costChange({ energy: 1 }, opponentHasColor("blue", "green"))],

  // Armin Arlelt: 《When Played》 Draw a card, then place one card from your hand into your sideline.
  "UE10BT/AOT-1-075": [onPlay(...drawThenDiscard)],

  // Armin Arlelt: 《During Your Turn》 When this character is returned to your hand from your field, you may place one red <Armin Arlelt> card with 1 required energy from your hand into your sideline. If you do, draw two cards, then place one card from your hand into your sideline.
  "UE10BT/AOT-1-076": [withCondition(when(["onReturnToHand"],
    ifThen((env) => env.owner.hand.some((cardId) => and(isCharacterCard, ofColor("red"), named("Armin Arlelt"), handCostIs(1))(env, cardId, null)), [
      may("将手牌中 1 张所需能量为 1 的红色〈Armin Arlelt〉置于场外？这样做的场合，抽 2 张卡，再将 1 张手牌置于场外",
        chooseFromHand("swap", { min: 1, max: 1, filter: and(isCharacterCard, ofColor("red"), named("Armin Arlelt"), handCostIs(1)), prompt: "选择手牌中 1 张所需能量为 1 的红色〈Armin Arlelt〉置于场外" }),
        moveChosen("swap", "sideline"), draw(2), discard(1))
    ])), duringYourTurn)],

  // Armin Arlelt:
  //   《When Played》 Choose one of the following:
  //   ・Choose up to one other character on your field. It gains 1000 BP until the end of the turn.
  //   ・The next time you choose a character with an ability that specifies a BP range this turn, add 1000 to the specified BP range. (You can choose a character with 3000 or less BP with an ability that lets you choose a character with 2000 or less BP.)
  //   《Activate: Main》 《If on the Front Line》 《Once Per Turn》 Activate this character's 《When Played》 ability.
  // (The second mode raises the limit of every "N or less BP" choice made with `bpAtMost` — see `raiseNextBpRange` in dsl.ts.)
  "UE10BT/AOT-1-077": [onPlay(...arminModes), activateMain({ condition: selfOnFront, once: true }, ...arminModes)],

  // Christa Lenz: 《When Played》 Choose up to one other character on your field. It gains 1000 BP until the end of the turn.
  "UE10BT/AOT-1-078": [onPlay(...otherGainsThousand)],

  // Sasha Braus: 《When Played》 Look at the top seven cards of your deck. Reveal up to one [Food] affinity card among them and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If you added a card to your hand, place one card from your hand into your sideline.
  "UE10BT/AOT-1-080": [onPlay(...lookTakeOneThenDiscard(7, withAffinity("Food"), "公开最多 1 张 [Food] 卡并加入手牌"))],

  // Sasha Braus: 《During Your Turn》 If you have used a [Food] affinity card this turn, this character gains 500 BP and 《Impact (1)》 (When this character attacks and wins a battle, deal 1 damage to your opponent.)
  "UE10BT/AOT-1-081": [staticSelf({ bp: 500, keywords: ["冲击1"] }, all(duringYourTurn, usedFood))],

  // Sasha Braus: 《When Played》 Choose up to one [104th Cadet Corps] affinity card on your field. It gains 1000 BP until the end of the turn. If you have used a [Food] affinity card this turn, switch this character to active.
  "UE10BT/AOT-1-082": [onPlay(
    chooseOwn("target", { max: 1, filter: cadet, prompt: "选择我方场上最多 1 张 [104th Cadet Corps] 卡（本回合 BP+1000）" }), bp(chosen("target"), 1000),
    ifThen(usedFood, [activate("self")])
  )],

  // Jean Kirschtein: 《Activate: Main》 《Switch to Resting》 Choose one other character on your field. It gains 1000 BP until the end of the turn.
  "UE10BT/AOT-1-084": [activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // Mikasa Ackermann: 《During Your Turn》 If you have five or more other [104th Cadet Corps] affinity cards on your field, this character gains 1000 BP.
  "UE10BT/AOT-1-086": [staticSelf({ bp: 1000 }, all(duringYourTurn, otherCadetsAtLeast(5)))],

  // Mikasa Ackermann: If this character is active, it gains 《Red》 energy generation.
  "UE10BT/AOT-1-087": [staticSelf({ energy: 1 }, selfActive)],

  // Mikasa Ackermann:
  //   《During Your Turn》 If this character is returned from your field to your hand, you may place one card from your hand into your sideline instead.
  //   《During Your Turn》 If you have five or more other [104th Cadet Corps] affinity cards on your field, this character gains 500 BP.
  // (The first is a replacement of "returned to the hand" by an effect or a trigger; when taken, it queues ability 2, which asks for the card.)
  "UE10BT/AOT-1-088": [
    {
      kind: "replaceSideline", replaces: "toHand",
      condition: (env, target) => !!env.self && env.self.uid === target.uid && duringYourTurn(env) && env.owner.hand.length > 0,
      prompt: "可以改为将 1 张手牌置于场外吗？",
      apply: (env) => {
        env.game.seq += 1;
        env.game.queue.push({ id: env.game.seq, ownerId: env.owner.accountId, cardId: env.selfCardId, ability: MIKASA_088_DISCARD_INDEX, selfUid: env.self?.uid ?? null, cause: null });
      }
    },
    staticSelf({ bp: 500 }, all(duringYourTurn, otherCadetsAtLeast(5))),
    when([], discard(1))
  ],

  // Mikasa Ackermann:
  //   《Raid》 <Mikasa Ackermann> Switch to active. May move to the front line.
  //   《When Played》 If there is a character with "Eren Jaeger" in its card name on your field, choose up to one character with 3500 or less BP on your opponent's front line and sideline it.
  "UE10BT/AOT-1-089": [withCondition(onPlay(
    chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(3500), prompt: "选择对方前线最多 1 张 BP 不高于 3500 的角色退场" }), sideline(chosen("target"))
  ), youHaveNameIncluding("Eren Jaeger"))],

  // Eren Jaeger:
  //   《Step》 (During your movement phase, you may move this card from your front line to your energy line.)
  //   《Activate: Main》 《If on the Front Line》 《Once Per Turn》 Add one card from your life area to your hand. If you do, this character gains 1000 BP until the end of the turn.
  "UE10BT/AOT-1-091": [activateMain({ condition: selfOnFront, once: true },
    ifThen((env) => env.owner.life.length > 0, [
      run("将生命区的 1 张卡牌加入手牌", (env) => { const slot = env.owner.life.shift(); if (slot) env.owner.hand.push(slot.cardId); loseIfNoLife(env.game, env.players, env.owner); }),
      bp("self", 1000)
    ]))],

  // Eren Jaeger:
  //   《Raid》 <Eren Jaeger> Switch to active. May move to the front line.
  //   《Impact (1)》 (When this character attacks and wins a battle, deal 1 damage to your opponent.)
  //   《When Attacking》 Place up to one other [104th Cadet Corps] affinity card on your front line on the top of your deck. If your front line is not full, play up to one red card with 3 or less required energy, 1 AP cost, and [104th Cadet Corps] affinity from your hand set to active onto your front line. That character gains "At the end of the attack phase, return this character to your hand" until the end of the turn.
  "UE10BT/AOT-1-092": [
    staticSelf({ keywords: ["冲击1"] }),
    onAttack(
      chooseOwn("top", { line: "front", max: 1, filter: and(notSelf, cadet), prompt: "选择我方前线最多 1 张其他 [104th Cadet Corps] 卡置于卡组最上方" }),
      ifThen(chosenCount("top"), [
        { do: "toDeckBottom", target: chosen("top") },
        run("该卡牌改为置于卡组最上方", (env) => { const library = env.owner.library; if (library.length) library.unshift(library.pop()!); })
      ]),
      ifThen((env) => env.owner.front.length < LINE_LIMIT, playSmallCadet("card", 2, "从手牌选择最多 1 张所需能量不高于 3、消费 AP 为 1 的红色 [104th Cadet Corps] 卡以活跃状态登场到前线")),
    ),
    returnAtAttackPhaseEnd()
  ],

  // Eren Jaeger (Attack Titan):
  //   《Raid》 <Eren Jaeger> Switch to active. May move to the front line.
  //   《Damage (2)》 (When this character attacks and deals direct damage, deal 2 damage instead.)
  //   《During Your Turn》 This character gains 1000 BP.
  //   《When Attacking》 Choose one of the following:
  //   ・Draw a card.
  //   ・If you have 3 or less life, you may place two cards from your hand into your sideline. If you do, choose up to one character with 2000 or less BP on your opponent's front line and sideline it.
  "UE10BT/AOT-1-093": [
    staticSelf({ keywords: ["伤害2"] }),
    staticSelf({ bp: 1000 }, duringYourTurn),
    onAttack(
      chooseMode("mode", ["抽 1 张卡", "我方生命 3 以下的场合，可以将 2 张手牌置于场外；这样做的场合，选择对方前线最多 1 张 BP 不高于 2000 的角色退场"]),
      ifThen(modeIs("mode", 0), [draw(1)], [
        ifThen((env) => lifeAtMost(3)(env) && env.owner.hand.length >= 2, [
          may("将 2 张手牌置于场外，并选择对方前线 BP 不高于 2000 的角色退场？", discard(2),
            chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(2000), prompt: "选择对方前线最多 1 张 BP 不高于 2000 的角色退场" }), sideline(chosen("target")))
        ])
      ])
    )
  ],

  // Eren Jaeger (Attack Titan):
  //   《Raid》 <Eren Jaeger> Switch to active. May move to the front line.
  //   《Damage (2)》 (When this character attacks and deals direct damage, deal 2 damage instead.)
  //   《Activate: Main》 《If on the Front Line》 《Once Per Turn》 Choose up to one character with 2000 or less BP on your opponent's front line and sideline it.
  //   《When Attacking》 《Once Per Turn》 Choose one of the following:
  //   ・This character gains 《Impact (1)》 (When this character attacks and wins a battle, deal 1 damage to your opponent) until the end of the turn.
  //   ・If you have 3 or less life, switch this character to active.
  "UE10BT/AOT-1-094": [
    staticSelf({ keywords: ["伤害2"] }),
    activateMain({ condition: selfOnFront, once: true }, chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(2000), prompt: "选择对方前线最多 1 张 BP 不高于 2000 的角色退场" }), sideline(chosen("target"))),
    oncePerTurn(onAttack(
      chooseMode("mode", ["此角色本回合获得《冲击1》", "我方生命 3 以下的场合，将此角色转为活跃状态"]),
      ifThen(modeIs("mode", 0), [grant("self", "冲击1")], [ifThen(lifeAtMost(3), [activate("self")])])
    ))
  ],

  // Basement (site):
  //   If you have a <Key to the Basement> card in your sideline, reduce this card's required energy by 《Red×2》 while in your hand.
  //   《When Played》 Draw a card, then place one card from your hand into your sideline.
  "UE10BT/AOT-1-095": [
    costChange({ energy: 2 }, (env) => env.owner.sideline.some((cardId) => env.ctx.card(cardId)?.name === "Key to the Basement")),
    onPlay(...drawThenDiscard)
  ],

  // Hardened Punch (event):
  //   If there is a character with "Eren Jaeger" in its card name on your field, reduce this card's AP cost by 1 while in your hand.
  //   Choose up to one character with 5000 or less BP on your opponent's front line and sideline it. Choose up to one Raided <Eren Jaeger (Attack Titan)> on your field. It gains "If your opponent sidelines this character with a 《Special Trigger》 ability, they add the card with the 《Special Trigger》 ability to their hand instead" until the end of the turn.
  // (Read as: that Eren is not sidelined by the Special trigger; the trigger card goes to the opponent's hand instead of the sideline.)
  "UE10BT/AOT-1-096": [
    costChange({ ap: 1 }, youHaveNameIncluding("Eren Jaeger")),
    onUse(
      chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(5000), prompt: "选择对方前线最多 1 张 BP 不高于 5000 的角色退场" }), sideline(chosen("target")),
      chooseOwn("raided", { max: 1, filter: and(named("Eren Jaeger (Attack Titan)"), (_env, _cardId, card) => !!card && card.under.length > 0), prompt: "选择我方场上最多 1 张进行过突进的〈Eren Jaeger (Attack Titan)〉" }),
      flag(chosen("raided"), "specialTriggerToHand")
    )
  ],

  // Dedicate Your Heart!! (event): Choose up to two of your AP cards and switch them to active.
  "UE10BT/AOT-1-097": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // Key to the Basement (event): Look at the top five cards of your deck. Reveal up to one <Basement> or [Inheritor of the Titan] affinity card among them and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If the revealed card has 6 or more base required energy, choose up to one of your AP cards and switch it to active.
  "UE10BT/AOT-1-098": [onUse(
    look(5),
    chooseLooked("pick", { max: 1, filter: either(named("Basement"), withAffinity("Inheritor of the Titan")), prompt: "公开最多 1 张〈Basement〉或 [Inheritor of the Titan] 卡并加入手牌" }),
    run("确认公开的卡牌的所需能量是否为 6 或更高", (env) => {
      const key = env.vars.pick?.[0];
      const cardId = key ? env.game.looking?.cards[Number(key.slice(2))] : undefined;
      if (cardId && (env.ctx.card(cardId)?.energyCost ?? 0) >= 6) env.vars.hit = ["1"];
    }),
    moveChosen("pick", "hand"),
    lookedToBottom(),
    ifThen(chosenCount("hit"), [chooseAp("ap", 1), activateAp("ap")])
  )],

  // Omni-Directional Mobility Gear (event): Draw two cards. Play up to two red cards with 3 or less required energy, 1 AP cost, and [104th Cadet Corps] affinity from your hand set to active onto your front line. Those characters gain "At the end of the attack phase, return this character to your hand" until the end of the turn.
  "UE10BT/AOT-1-099": [
    onUse(
      draw(2),
      ...playSmallCadet("first", 1, "从手牌选择最多 1 张所需能量不高于 3、消费 AP 为 1 的红色 [104th Cadet Corps] 卡（第 1 张）以活跃状态登场到前线"),
      ...playSmallCadet("second", 1, "从手牌选择最多 1 张所需能量不高于 3、消费 AP 为 1 的红色 [104th Cadet Corps] 卡（第 2 张）以活跃状态登场到前线")
    ),
    returnAtAttackPhaseEnd()
  ],

  // A Steamed Potato, Sir! (event): Place up to three cards from your hand on the bottom of your deck in any order. Draw a number of cards equal to the number of cards placed on the bottom of your deck with this ability. Choose up to one of your AP cards and switch it to active.
  // (The cards go to the bottom in the order they are picked.)
  "UE10BT/AOT-1-100": [onUse(
    chooseFromHand("bottom", { max: 3, prompt: "依次点选最多 3 张手牌，按点选顺序置于卡组最下方" }),
    run("抽与置于卡组最下方的卡牌张数相同的卡", (env) => { env.vars.drawCount = env.vars.bottom ?? []; }),
    moveChosen("bottom", "deckBottom"),
    run("抽卡", (env) => { const count = env.vars.drawCount?.length ?? 0; env.owner.hand.push(...env.owner.library.splice(0, count)); }),
    chooseAp("ap", 1), activateAp("ap")
  )],

  // Carla Jaeger (UE10ST/AOT-1-068): 《Activate: Main》 《Switch to Resting》 《Once Per Turn》 This character gains 《Red》 energy generation until the end of the turn. At the end of the main phase, sideline this character.
  "UE10ST/AOT-1-068": [
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 1)),
    sidelineAtMainEnd
  ],

  // Hannes (UE10ST/AOT-1-070): 《When Played》 Return one other character on your field with 1 or less required energy to your hand. If you cannot, return this character to your hand.
  "UE10ST/AOT-1-070": [onPlay(...returnSmallOrSelf)]
};
