/**
 * EVA batch 1 (UC03BT/EVA-1-001 ... 031): one test per card (more for cards with several abilities), set up as the printed text describes and
 * checked against it. Cards are addressed by card number through the shared harness.
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, energyOf, flagsOf, impactOf } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { abilitiesFor, isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import type { UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";
import { loadTitleCards } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";

const eva = (n: string): string => `UC03BT/EVA-1-${n}`;
const YE = eva("019"); // a yellow site that makes 2 energy (not a character, so it never takes part in character choices)
const PE = "UCEX01BT/ARK-2-055"; // a purple site that makes 1 energy
const BLUE_E = "UC01BT/ARK-1-036"; // blue, makes 1 energy
const KING = "UC01BT/ARK-1-004"; // yellow, cost 0, BP1500, trigger [获得], no ability
const NINE = "UC01BT/ARK-1-088"; // red, cost 0, BP2000, trigger [抽卡], no ability
const CHEN = "UC01BT/ARK-1-084"; // red, cost 0, BP1500, trigger [获得], no ability
const ROSE = "UCEX01BT/ARK-2-054"; // purple, cost 0, BP2000, trigger [激活], no ability
const FILLER = "UC01BT/ARK-1-004";

type Harness = ReturnType<typeof setup>;

/** Puts `number` into the hand and plays it from there; returns the field card. */
function play(h: Harness, number: string, line: "front" | "energy" = "front"): UnionArenaFieldCard {
  h.a.hand.push(number);
  h.act("a", { type: "play", handIndex: h.a.hand.length - 1, line });
  return h.a[line][h.a[line].length - 1]!;
}
/** Uses the event in the hand. */
function useEvent(h: Harness, number: string): void {
  h.a.hand.push(number);
  h.act("a", { type: "event", handIndex: h.a.hand.length - 1 });
}
/** A harmless action that makes the engine recompute continuous effects. */
const refresh = (h: Harness): void => h.act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "activate" } });
/** The turn player `a` attacks with `attackerUid`; `b` does not block; `a` picks `b`'s life card `lifeId` (the trigger is then pending for `b`). */
function strike(h: Harness, attackerUid: string, lifeId: string): void {
  h.act("a", { type: "attack", attackerUid });
  if (h.game.pending?.kind === "block") h.act("b", { type: "block", blockerUid: null });
  h.act("a", { type: "damage", lifeIds: [lifeId] });
}
/** Passes turns until `who`'s main phase has begun. */
function toMainOf(h: Harness, who: "a" | "b"): void {
  for (let guard = 0; guard < 12 && !(h.game.turnPlayerId === who && h.game.phase === "main"); guard += 1) {
    const turn = h.game.turnPlayerId as "a" | "b";
    if (turn === who) h.act(turn, { type: "next_phase" });
    else if (h.game.phase === "main" || h.game.phase === "attack") h.act(turn, { type: "end_turn" });
    else h.act(turn, { type: "next_phase" });
  }
}

describe("绫波 零", () => {
  it("001: [启动主要] rest, once per turn: +1 yellow energy and sidelined when the main phase ends", () => {
    const h = setup();
    const rei = field(h.a, "energy", eva("001"));
    expect(energyOf(ctx, h.a, "yellow")).toBe(1);
    h.act("a", { type: "activate", uid: rei.uid, ability: 0 });
    expect(rei.rested).toBe(true);
    expect(energyOf(ctx, h.a, "yellow")).toBe(2);
    rei.rested = false;
    expect(() => h.act("a", { type: "activate", uid: rei.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    h.act("a", { type: "next_phase" });
    expect(h.a.energy).toEqual([]);
    expect(h.a.sideline).toEqual([eva("001")]);
  });

  it("002: in the opponent's turn it cannot move, cannot be returned to the hand and is not affected by BP reductions; not in our own turn", () => {
    const h = setup("main", "b");
    const rei = field(h.a, "front", eva("002"));
    field(h.a, "front", KING);
    energy(h.b, 3, BLUE_E);
    energy(h.b, 4, BLUE_E);
    h.b.hand.push("UC01BT/ARK-1-044"); // 灰喉: 登场时 BP-1000 to a BP1500+ character on the front line
    h.act("b", { type: "play", handIndex: 0, line: "front" });
    expect(flagsOf(rei)).toEqual(expect.arrayContaining(["cannotMove", "cannotToHand", "noBpDown"]));
    h.act("b", { type: "choose", picks: [rei.uid] });
    expect(bpOf(ctx, rei)).toBe(4000);
    // The event 如你所愿 would return a character with BP 5000 or less to the hand: not this one.
    h.b.hand.push("UCEX01BT/ARK-2-024");
    h.act("b", { type: "event", handIndex: 0 });
    h.act("b", { type: "choose", picks: [rei.uid] });
    expect(h.a.front).toContain(rei);
    expect(h.a.hand).toEqual([]);
    // In our own turn none of it applies.
    toMainOf(h, "a");
    expect(flagsOf(rei)).not.toContain("cannotMove");
    expect(flagsOf(rei)).not.toContain("noBpDown");
  });

  it("003: BP+1000 in our turn once a character with [获得] has come onto our field this turn", () => {
    const h = setup();
    energy(h.a, 3, YE);
    const rei = field(h.a, "front", eva("003"));
    refresh(h);
    expect(bpOf(ctx, rei)).toBe(2000);
    play(h, NINE); // [抽卡]: does not count
    expect(bpOf(ctx, rei)).toBe(2000);
    play(h, KING); // [获得]: counts
    expect(bpOf(ctx, rei)).toBe(3000);
    // Not in the opponent's turn.
    h.act("a", { type: "end_turn" });
    expect(bpOf(ctx, rei)).toBe(2000);
  });

  it("003: a character with [获得] that was put onto the field by a card effect counts too; a card on the field already does not", () => {
    const h = setup();
    const rei = field(h.a, "front", eva("003"));
    field(h.a, "front", KING);
    refresh(h);
    expect(bpOf(ctx, rei)).toBe(2000);
    energy(h.a, 2, YE);
    h.a.hand.push(eva("005"));
    h.act("a", { type: "play", handIndex: 0, line: "energy" }); // 005 has a [获得] trigger
    expect(bpOf(ctx, rei)).toBe(3000);
  });

  it("004: 登场时 up to 1 character gets BP+1000 this turn (it may be none)", () => {
    const h = setup();
    energy(h.a, 1, YE);
    const king = field(h.a, "front", KING);
    const rei = play(h, eva("004"));
    expect(choice(h.game, "a").options).toEqual(expect.arrayContaining([king.uid, rei.uid]));
    h.act("a", { type: "choose", picks: [king.uid] });
    expect(bpOf(ctx, king)).toBe(2500);
    expect(bpOf(ctx, rei)).toBe(3000);

    const second = setup();
    energy(second.a, 1, YE);
    const other = field(second.a, "front", KING);
    const self = play(second, eva("004"));
    second.act("a", { type: "choose", picks: [] });
    expect(bpOf(ctx, other)).toBe(1500);
    expect(bpOf(ctx, self)).toBe(3000);
  });

  it("005: leaving by an effect: may discard 1 hand card to put a yellow 〈绫波 零〉 (cost 2 or less) from the sideline onto the field active", () => {
    const h = setup("main", "b");
    const rei = field(h.a, "front", eva("005"));
    h.a.hand.push(KING, NINE);
    h.a.sideline.push(eva("001"), eva("002"), CHEN);
    energy(h.b, 4, BLUE_E);
    h.b.hand.push("UCEX01BT/ARK-2-024"); // 如你所愿: returns the chosen character to the hand
    h.act("b", { type: "event", handIndex: 0 });
    h.act("b", { type: "choose", picks: [rei.uid] });
    expect(h.a.hand).toEqual([KING, NINE, eva("005")]);
    expect(choice(h.game, "a").purpose).toBe("confirm");
    h.act("a", { type: "choose", picks: ["yes"] });
    h.act("a", { type: "choose", picks: ["h:0"] }); // discard 弑君者
    const options = choice(h.game, "a");
    // 绫波 零 (cost 0) is eligible; the cost 4 one and the red card are not; neither is the discarded 弑君者.
    expect(options.cards).toEqual([eva("001")]);
    h.act("a", { type: "choose", picks: [options.options[0]!] });
    h.act("a", { type: "choose", picks: ["line:front"] });
    expect(h.a.front.map((card) => card.cardId)).toEqual([eva("001")]);
    expect(h.a.front[0]!.rested).toBe(false);
    expect(h.a.hand).toEqual([NINE, eva("005")]);
    expect(h.a.sideline).toEqual([eva("002"), CHEN, KING]);
  });

  it("005: answering no does nothing; leaving by hand operation or BP 0 does not ask; picking none of the sideline cards is allowed", () => {
    const h = setup("main", "b");
    const rei = field(h.a, "front", eva("005"));
    h.a.hand.push(KING);
    h.a.sideline.push(eva("001"));
    h.b.hand.push("UCEX01BT/ARK-2-024");
    energy(h.b, 4, BLUE_E);
    h.act("b", { type: "event", handIndex: 0 });
    h.act("b", { type: "choose", picks: [rei.uid] });
    h.act("a", { type: "choose", picks: ["no"] });
    expect(h.game.pending).toBeNull();
    expect(h.a.front).toEqual([]);
    expect(h.a.sideline).toEqual([eva("001")]);

    const second = setup("main", "b");
    const other = field(second.a, "front", eva("005"));
    second.a.hand.push(KING);
    second.a.sideline.push(eva("001"));
    second.act("b", { type: "manual", manual: { op: "field", owner: "opponent", uid: other.uid, act: "sideline" } });
    expect(second.game.pending).toBeNull();

    const third = setup("main", "b");
    const third005 = field(third.a, "front", eva("005"));
    third.a.hand.push(KING);
    third.a.sideline.push(eva("001"), eva("003"));
    energy(third.b, 4, BLUE_E);
    third.b.hand.push("UCEX01BT/ARK-2-024");
    third.act("b", { type: "event", handIndex: 0 });
    third.act("b", { type: "choose", picks: [third005.uid] });
    third.act("a", { type: "choose", picks: ["yes"] });
    third.act("a", { type: "choose", picks: ["h:1"] }); // discard 弑君者 (the hand is 弑君者 and 005)
    third.act("a", { type: "choose", picks: [] });
    expect(third.a.front).toEqual([]);
  });

  it("005: leaving the field by a battle also triggers it", () => {
    const h = setup("attack");
    const attacker = field(h.a, "front", KING);
    attacker.bpMod = 5000;
    const rei = field(h.b, "front", eva("005"));
    h.b.hand.push(NINE, CHEN);
    h.b.sideline.push(eva("004"));
    h.act("a", { type: "attack", attackerUid: attacker.uid });
    h.act("b", { type: "block", blockerUid: rei.uid });
    expect(choice(h.game, "b").purpose).toBe("confirm");
    h.act("b", { type: "choose", picks: ["yes"] });
    h.act("b", { type: "choose", picks: ["h:0"] });
    const options = choice(h.game, "b").options;
    expect(options.length).toBeGreaterThanOrEqual(1);
    h.act("b", { type: "choose", picks: ["s:0"] });
    h.act("b", { type: "choose", picks: ["line:energy"] });
    expect(h.b.energy.map((card) => card.cardId)).toEqual([eva("004")]);
    expect(h.b.energy[0]!.rested).toBe(false);
  });
});

describe("葛城 美里", () => {
  it("006: [启动主要] rest and sideline this card: a chosen yellow character becomes active", () => {
    const h = setup();
    const misato = field(h.a, "front", eva("006"));
    const king = field(h.a, "front", KING, true);
    const king2 = field(h.a, "front", eva("009"), true);
    const nine = field(h.a, "front", NINE, true);
    h.act("a", { type: "activate", uid: misato.uid, ability: 0 });
    expect(h.a.sideline).toEqual([eva("006")]);
    expect(h.a.front).not.toContain(misato);
    const options = choice(h.game, "a");
    expect(options.options.sort()).toEqual([king.uid, king2.uid].sort());
    h.act("a", { type: "choose", picks: [king2.uid] });
    expect(king2.rested).toBe(false);
    expect(king.rested).toBe(true);
    expect(nine.rested).toBe(true);
  });

  it("006: a single yellow character is chosen by itself; it cannot be used while resting", () => {
    const h = setup();
    const misato = field(h.a, "front", eva("006"));
    const king = field(h.a, "front", KING, true);
    const nine = field(h.a, "front", NINE, true);
    h.act("a", { type: "activate", uid: misato.uid, ability: 0 });
    expect(king.rested).toBe(false);
    expect(nine.rested).toBe(true);
    const resting = field(h.a, "front", eva("006"), true);
    expect(() => h.act("a", { type: "activate", uid: resting.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("007: +1 yellow energy while active", () => {
    const h = setup();
    const misato = field(h.a, "energy", eva("007"));
    refresh(h);
    expect(energyOf(ctx, h.a, "yellow")).toBe(2);
    h.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: misato.uid, act: "rest" } });
    expect(energyOf(ctx, h.a, "yellow")).toBe(1);
  });

  /** `b` (the defender) has 葛城 美里 008 and the given life card on top; `a` attacks with one character per element of `attackers`. */
  function threeStrikes(lifeCards: string[], bEnergy = 1) {
    const h = setup("attack");
    const attackers = lifeCards.map(() => field(h.a, "front", KING));
    const misato = field(h.b, "energy", eva("008"));
    energy(h.b, bEnergy, YE);
    lifeCards.forEach((cardId, index) => { h.b.life[index]!.cardId = cardId; });
    return { h, attackers, misato };
  }

  it("008: in the opponent's turn a [获得] trigger can be replaced: the card comes onto the field resting and 1 hand card is discarded", () => {
    const { h, attackers } = threeStrikes([KING, KING]);
    h.b.hand.push(NINE, CHEN);
    const lifeId = h.b.life[0]!.id;
    strike(h, attackers[0]!.uid, lifeId);
    h.act("b", { type: "trigger", lifeId, activate: true });
    expect(choice(h.game, "b").purpose).toBe("confirm");
    h.act("b", { type: "choose", picks: ["yes"] });
    expect(choice(h.game, "b").labels).toEqual(["前线", "能量线"]);
    h.act("b", { type: "choose", picks: ["line:front"] });
    h.act("b", { type: "choose", picks: ["h:0"] });
    expect(h.game.pending).toBeNull();
    expect(h.b.front.map((card) => card.cardId)).toEqual([KING]);
    expect(h.b.front[0]!.rested).toBe(true);
    expect(h.b.hand).toEqual([CHEN]);
    expect(h.b.sideline).toEqual([NINE]);
    expect(h.b.life).toHaveLength(6);
    // Only once per turn: the next [获得] trigger is not offered.
    const secondLife = h.b.life[0]!.id;
    strike(h, attackers[1]!.uid, secondLife);
    h.act("b", { type: "trigger", lifeId: secondLife, activate: true });
    expect(h.game.pending).toBeNull();
    expect(h.b.hand).toEqual([CHEN, KING]);
    expect(h.b.front).toHaveLength(1);
  });

  it("008: answering no resolves the [获得] trigger as printed (the card goes to the hand)", () => {
    const { h, attackers } = threeStrikes([KING]);
    h.b.hand.push(NINE);
    const lifeId = h.b.life[0]!.id;
    strike(h, attackers[0]!.uid, lifeId);
    h.act("b", { type: "trigger", lifeId, activate: true });
    h.act("b", { type: "choose", picks: ["no"] });
    expect(h.game.pending).toBeNull();
    expect(h.b.hand).toEqual([NINE, KING]);
    expect(h.b.front).toEqual([]);
  });

  it("008: not offered when the required energy is missing, for other triggers, or when the trigger is not activated", () => {
    // 式波·明日香·兰格雷 013 costs 4 and has [获得]; 葛城 美里 008 on the energy line makes only 2 energy (a yellow site adds 2 more).
    const missing = threeStrikes([eva("013")], 0);
    const missingLife = missing.h.b.life[0]!.id;
    strike(missing.h, missing.attackers[0]!.uid, missingLife);
    missing.h.act("b", { type: "trigger", lifeId: missingLife, activate: true });
    expect(missing.h.game.pending).toBeNull();
    expect(missing.h.b.hand).toEqual([eva("013")]);
    // With 4 energy it is offered.
    const enough = threeStrikes([eva("013")], 1);
    const enoughLife = enough.h.b.life[0]!.id;
    strike(enough.h, enough.attackers[0]!.uid, enoughLife);
    enough.h.act("b", { type: "trigger", lifeId: enoughLife, activate: true });
    expect(choice(enough.h.game, "b").purpose).toBe("confirm");
    // Another trigger ([抽卡]) is drawn as printed.
    const draws = threeStrikes([NINE]);
    const drawsLife = draws.h.b.life[0]!.id;
    strike(draws.h, draws.attackers[0]!.uid, drawsLife);
    draws.h.act("b", { type: "trigger", lifeId: drawsLife, activate: true });
    expect(draws.h.game.pending).toBeNull();
    expect(draws.h.b.hand).toEqual([FILLER]);
    // Not activating it: the card goes to the sideline without a question.
    const passes = threeStrikes([KING]);
    const passLife = passes.h.b.life[0]!.id;
    strike(passes.h, passes.attackers[0]!.uid, passLife);
    passes.h.act("b", { type: "trigger", lifeId: passLife, activate: false });
    expect(passes.h.game.pending).toBeNull();
    expect(passes.h.b.sideline).toEqual([KING]);
  });
});

describe("式波·明日香·兰格雷", () => {
  it("009: 登场时 draw 1 card, then put 1 hand card into the sideline", () => {
    const h = setup();
    h.a.hand.push(NINE);
    play(h, eva("009"));
    const options = choice(h.game, "a");
    expect(options.options).toEqual(["h:0", "h:1"]);
    h.act("a", { type: "choose", picks: ["h:0"] });
    expect(h.a.hand).toEqual([FILLER]);
    expect(h.a.sideline).toEqual([NINE]);
    expect(h.a.library).toHaveLength(29);
  });

  it("010: 登场时 up to 1 character gets 《冲击1》 this turn", () => {
    const h = setup();
    energy(h.a, 1, YE);
    const king = field(h.a, "front", KING);
    play(h, eva("010"));
    h.act("a", { type: "choose", picks: [king.uid] });
    expect(impactOf(ctx, king)).toBe(1);

    const second = setup();
    energy(second.a, 1, YE);
    const other = field(second.a, "front", KING);
    play(second, eva("010"));
    second.act("a", { type: "choose", picks: [] });
    expect(impactOf(ctx, other)).toBe(0);
  });

  it("011: 登场时 returns another character with required energy 1 or less to the hand, else itself", () => {
    const h = setup();
    energy(h.a, 1, YE);
    const king = field(h.a, "front", KING);
    const asuka = play(h, eva("011"));
    expect(h.a.hand).toEqual([KING]);
    expect(h.a.front).toEqual([asuka]);
    expect(h.a.front).not.toContain(king);

    const alone = setup();
    energy(alone.a, 1, YE);
    play(alone, eva("011"));
    expect(alone.a.hand).toEqual([eva("011")]);
    expect(alone.a.front).toEqual([]);

    const costly = setup();
    energy(costly.a, 1, YE);
    field(costly.a, "front", eva("004")); // cost 2: not allowed
    play(costly, eva("011"));
    expect(costly.a.hand).toEqual([eva("011")]);
    expect(costly.a.front).toHaveLength(1);
  });

  it("012: may sideline another character; if so draw 2, or draw 1 and activate a character", () => {
    const first = setup();
    energy(first.a, 2, YE);
    const king = field(first.a, "front", KING);
    play(first, eva("012"));
    expect(choice(first.game, "a").purpose).toBe("confirm");
    first.act("a", { type: "choose", picks: ["yes"] });
    expect(first.a.sideline).toEqual([KING]);
    expect(first.a.front).not.toContain(king);
    expect(choice(first.game, "a").labels).toHaveLength(2);
    first.act("a", { type: "choose", picks: ["m:0"] });
    expect(first.a.hand).toHaveLength(2);

    const second = setup();
    energy(second.a, 2, YE);
    field(second.a, "front", KING);
    const nine = field(second.a, "front", NINE, true);
    play(second, eva("012"));
    second.act("a", { type: "choose", picks: ["yes"] });
    second.act("a", { type: "choose", picks: [second.a.front[0]!.uid] }); // sideline 弑君者
    second.act("a", { type: "choose", picks: ["m:1"] });
    expect(second.a.hand).toHaveLength(1);
    second.act("a", { type: "choose", picks: [nine.uid] });
    expect(nine.rested).toBe(false);
  });

  it("012: answering no (or having no other character) does nothing", () => {
    const h = setup();
    energy(h.a, 2, YE);
    const king = field(h.a, "front", KING);
    play(h, eva("012"));
    h.act("a", { type: "choose", picks: ["no"] });
    expect(h.game.pending).toBeNull();
    expect(h.a.front).toContain(king);
    expect(h.a.hand).toEqual([]);

    const alone = setup();
    energy(alone.a, 2, YE);
    play(alone, eva("012"));
    expect(alone.game.pending).toBeNull();
  });

  it("013: 登场时 becomes active; mode 1 rests up to 1 opposing front-line character", () => {
    const h = setup();
    energy(h.a, 2, YE);
    const nine = field(h.b, "front", NINE);
    const asuka = play(h, eva("013"));
    expect(asuka.rested).toBe(false);
    expect(choice(h.game, "a").labels).toHaveLength(2);
    h.act("a", { type: "choose", picks: ["m:0"] });
    h.act("a", { type: "choose", picks: [nine.uid] });
    expect(nine.rested).toBe(true);
  });

  it("013: mode 2 (our turn): may sideline one of our characters; if so sideline an opposing front-line character with BP 5000 or less and the next cheap yellow card costs 1 less AP", () => {
    const h = setup();
    energy(h.a, 2, YE);
    const king = field(h.a, "front", KING);
    const weak = field(h.b, "front", NINE);
    const strong = field(h.b, "front", KING);
    strong.bpMod = 4000; // 5500: too high
    play(h, eva("013"));
    h.act("a", { type: "choose", picks: ["m:1"] });
    h.act("a", { type: "choose", picks: ["yes"] });
    h.act("a", { type: "choose", picks: [king.uid] });
    const options = choice(h.game, "a");
    expect(options.options).toEqual([weak.uid]);
    h.act("a", { type: "choose", picks: [weak.uid] });
    expect(h.a.sideline).toEqual([KING]);
    expect(h.b.sideline).toEqual([NINE]);
    expect(h.b.front).toEqual([strong]);
    // The next yellow character with required energy 2 or less costs 1 less AP; others are unaffected.
    expect(costOf(h.game, h.players, ctx, "a", eva("004")).ap).toBe(0);
    expect(costOf(h.game, h.players, ctx, "a", eva("002")).ap).toBe(1); // required energy 4
    expect(costOf(h.game, h.players, ctx, "a", "UCEX01BT/ARK-2-047").ap).toBe(1); // purple
    const apBefore = h.a.ap.filter((card) => !card.rested).length;
    play(h, eva("004"));
    expect(h.a.ap.filter((card) => !card.rested).length).toBe(apBefore);
    h.act("a", { type: "choose", picks: [] });
    expect(costOf(h.game, h.players, ctx, "a", eva("004")).ap).toBe(1);
  });

  it("013: mode 2 can be declined, and does nothing if the cost is not paid", () => {
    const h = setup();
    energy(h.a, 2, YE);
    const king = field(h.a, "front", KING);
    const nine = field(h.b, "front", NINE);
    play(h, eva("013"));
    h.act("a", { type: "choose", picks: ["m:1"] });
    h.act("a", { type: "choose", picks: ["no"] });
    expect(h.a.front).toContain(king);
    expect(h.b.front).toEqual([nine]);
    expect(costOf(h.game, h.players, ctx, "a", eva("004")).ap).toBe(1);
  });

  it("013: [启动主要] discard 2 hand cards, once per turn: this character gets BP+1000 and 《冲击1》", () => {
    const h = setup();
    const asuka = field(h.a, "front", eva("013"));
    h.a.hand.push(KING, NINE, CHEN);
    h.act("a", { type: "activate", uid: asuka.uid, ability: 1 });
    expect(choice(h.game, "a").min).toBe(2);
    h.act("a", { type: "choose", picks: ["h:0", "h:2"] });
    expect(bpOf(ctx, asuka)).toBe(5000);
    expect(impactOf(ctx, asuka)).toBe(1);
    expect(h.a.sideline).toEqual([KING, CHEN]);
    expect(() => h.act("a", { type: "activate", uid: asuka.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
    const short = setup();
    const lonely = field(short.a, "front", eva("013"));
    short.a.hand.push(KING);
    expect(() => short.act("a", { type: "activate", uid: lonely.uid, ability: 1 })).toThrow("ABILITY_COST");
  });
});

describe("真希波·真理·伊拉丝多莉亚斯", () => {
  it("015: the required energy is 1 less while the opponent's field has a purple or red card", () => {
    const h = setup();
    expect(costOf(h.game, h.players, ctx, "a", eva("015")).energy).toBe(3);
    field(h.b, "front", "UC01BT/ARK-1-036"); // blue
    expect(costOf(h.game, h.players, ctx, "a", eva("015")).energy).toBe(3);
    field(h.b, "energy", NINE); // red
    expect(costOf(h.game, h.players, ctx, "a", eva("015")).energy).toBe(2);
    const second = setup();
    field(second.b, "energy", ROSE); // purple
    expect(costOf(second.game, second.players, ctx, "a", eva("015")).energy).toBe(2);
  });

  it("016: only the 《撤步》 keyword: fully automatic, and it can step back to the energy line", () => {
    expect(abilitiesFor(eva("016"))).toEqual([]);
    const card = loadTitleCards().find((entry) => entry.number === eva("016"))!;
    expect(isAutomated(card)).toBe(true);
    const h = setup("movement");
    const mari = field(h.a, "front", eva("016"));
    h.act("a", { type: "move", toFront: [], toEnergy: [mari.uid], remove: [] });
    expect(h.a.energy).toEqual([mari]);
    expect(h.a.front).toEqual([]);
  });

  it("017: 登场时 look at 4, add up to 1 character with [获得] to the hand, rest to the bottom, then discard 1 hand card", () => {
    const h = setup();
    energy(h.a, 1, YE);
    h.a.library = [NINE, KING, CHEN, ROSE, ...Array(26).fill(FILLER)];
    h.a.hand.push(NINE);
    play(h, eva("017"));
    const pick = choice(h.game, "a");
    expect(pick.cards).toEqual([KING, CHEN]); // [抽卡] and [激活] cards are not eligible
    h.act("a", { type: "choose", picks: [pick.options[0]!] });
    const order = choice(h.game, "a");
    expect(order.cards).toEqual([NINE, CHEN, ROSE]);
    h.act("a", { type: "choose", picks: [order.options[2]!, order.options[0]!, order.options[1]!] });
    expect(h.a.library.slice(-3)).toEqual([ROSE, NINE, CHEN]);
    expect(h.a.library).toHaveLength(29);
    expect(h.a.hand).toEqual([NINE, KING]);
    h.act("a", { type: "choose", picks: ["h:0"] });
    expect(h.a.hand).toEqual([KING]);
    expect(h.a.sideline).toEqual([NINE]);
  });

  it("017: nothing eligible (or picking none) adds nothing and discards nothing", () => {
    const h = setup();
    energy(h.a, 1, YE);
    h.a.library = [NINE, ROSE, ...Array(28).fill(NINE)];
    h.a.hand.push(CHEN);
    play(h, eva("017"));
    const order = choice(h.game, "a");
    h.act("a", { type: "choose", picks: [order.options[0]!, order.options[1]!, order.options[2]!, order.options[3]!] });
    expect(h.game.pending).toBeNull();
    expect(h.a.hand).toEqual([CHEN]);
    expect(h.a.library).toHaveLength(30);
    expect(h.a.library.slice(-4)).toEqual([NINE, ROSE, NINE, NINE]);

    const second = setup();
    energy(second.a, 1, YE);
    second.a.library = [KING, ...Array(29).fill(FILLER)];
    play(second, eva("017"));
    second.act("a", { type: "choose", picks: [] });
    expect(second.a.hand).toEqual([]);
  });

  it("018: 攻击时 may pay 1 AP: draw 1 and activate a character other than 〈真希波·真理·伊拉丝多莉亚斯〉", () => {
    const h = setup("attack");
    const mari = field(h.a, "front", eva("018"));
    const king = field(h.a, "front", KING, true);
    const other = field(h.a, "energy", eva("018"), true); // another copy of the same name: not allowed
    h.act("a", { type: "attack", attackerUid: mari.uid });
    expect(choice(h.game, "a").purpose).toBe("confirm");
    h.act("a", { type: "choose", picks: ["yes"] });
    expect(h.a.ap.filter((card) => !card.rested)).toHaveLength(2);
    expect(h.a.hand).toEqual([FILLER]);
    const options = choice(h.game, "a");
    expect(options.options).toEqual([king.uid]);
    h.act("a", { type: "choose", picks: [king.uid] });
    expect(king.rested).toBe(false);
    expect(other.rested).toBe(true);
  });

  it("018: answering no, or having no active AP, skips the whole effect", () => {
    const h = setup("attack");
    const mari = field(h.a, "front", eva("018"));
    h.act("a", { type: "attack", attackerUid: mari.uid });
    h.act("a", { type: "choose", picks: ["no"] });
    expect(h.a.hand).toEqual([]);
    expect(h.a.ap.filter((card) => !card.rested)).toHaveLength(3);

    const second = setup("attack");
    const mari2 = field(second.a, "front", eva("018"));
    second.a.ap.forEach((card) => { card.rested = true; });
    second.act("a", { type: "attack", attackerUid: mari2.uid });
    expect(second.game.pending?.kind).not.toBe("choose");
    expect(second.a.hand).toEqual([]);
  });

  /** `b` owns the defending 018 (on the given line); `a` strikes the life card `life`. */
  function defend(life: string, line: "front" | "energy") {
    const h = setup("attack");
    const attacker = field(h.a, "front", KING);
    const mari = field(h.b, line, eva("018"));
    h.b.life[0]!.cardId = life;
    const lifeId = h.b.life[0]!.id;
    strike(h, attacker.uid, lifeId);
    return { h, mari, lifeId };
  }

  it("018: in the opponent's turn, with it on the front line, a [抽卡] trigger can be replaced by [获得]", () => {
    const { h, lifeId } = defend(NINE, "front");
    h.act("b", { type: "trigger", lifeId, activate: true });
    expect(choice(h.game, "b").purpose).toBe("confirm");
    h.act("b", { type: "choose", picks: ["yes"] });
    expect(h.game.pending).toBeNull();
    expect(h.b.hand).toEqual([NINE]);
    expect(h.b.library).toHaveLength(30);

    const no = defend(NINE, "front");
    no.h.act("b", { type: "trigger", lifeId: no.lifeId, activate: true });
    no.h.act("b", { type: "choose", picks: ["no"] });
    expect(no.h.b.hand).toEqual([FILLER]);
    expect(no.h.b.library).toHaveLength(29);
    expect(no.h.b.sideline).toEqual([NINE]);
  });

  it("018: an [激活] trigger can be replaced too; not when it is on the energy line; other triggers are not offered", () => {
    const active = defend(ROSE, "front");
    active.h.act("b", { type: "trigger", lifeId: active.lifeId, activate: true, targetUid: active.mari.uid });
    active.h.act("b", { type: "choose", picks: ["yes"] });
    expect(active.h.b.hand).toEqual([ROSE]);
    expect(bpOf(ctx, active.mari)).toBe(4000);

    const declined = defend(ROSE, "front");
    declined.h.act("b", { type: "trigger", lifeId: declined.lifeId, activate: true, targetUid: declined.mari.uid });
    declined.h.act("b", { type: "choose", picks: ["no"] });
    expect(bpOf(ctx, declined.mari)).toBe(7000);
    expect(declined.h.b.hand).toEqual([]);

    const back = defend(NINE, "energy");
    back.h.act("b", { type: "trigger", lifeId: back.lifeId, activate: true });
    expect(back.h.game.pending).toBeNull();
    expect(back.h.b.hand).toEqual([FILLER]);

    const get = defend(KING, "front");
    get.h.act("b", { type: "trigger", lifeId: get.lifeId, activate: true });
    expect(get.h.game.pending).toBeNull();
    expect(get.h.b.hand).toEqual([KING]);
  });
});

describe("第3新东京市立第一中学", () => {
  it("019: 登场时 may discard 1 hand card to add a yellow character with required energy 3 or less from the sideline to the hand", () => {
    const h = setup();
    h.a.hand.push(NINE, CHEN);
    h.a.sideline.push(eva("001"), eva("002"), CHEN);
    play(h, eva("019"), "energy");
    expect(choice(h.game, "a").purpose).toBe("confirm");
    h.act("a", { type: "choose", picks: ["yes"] });
    h.act("a", { type: "choose", picks: ["h:0"] });
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([eva("001")]); // 002 costs 4; the red cards are not yellow
    h.act("a", { type: "choose", picks: [options.options[0]!] });
    expect(h.a.hand).toEqual([CHEN, eva("001")]);
    expect(h.a.sideline).toEqual([eva("002"), CHEN, NINE]);
  });

  it("019: answering no, picking none, or having an empty hand does nothing", () => {
    const h = setup();
    h.a.hand.push(NINE);
    h.a.sideline.push(eva("001"));
    play(h, eva("019"), "energy");
    h.act("a", { type: "choose", picks: ["no"] });
    expect(h.a.hand).toEqual([NINE]);
    expect(h.a.sideline).toEqual([eva("001")]);

    const empty = setup();
    empty.a.sideline.push(eva("001"));
    play(empty, eva("019"), "energy");
    expect(empty.game.pending).toBeNull();

    const none = setup();
    none.a.hand.push(NINE);
    none.a.sideline.push(eva("001"));
    play(none, eva("019"), "energy");
    none.act("a", { type: "choose", picks: ["yes"] }); // the only hand card is discarded without a question
    expect(none.a.sideline).toEqual([eva("001"), NINE]);
    none.act("a", { type: "choose", picks: [] });
    expect(none.a.hand).toEqual([]);
    expect(none.a.sideline).toEqual([eva("001"), NINE]);
  });
});

describe("events", () => {
  it("020 你是笨蛋吗？: sideline 1 opposing front-line character with BP 3000 or less; 5000 or less with 〈式波·明日香·兰格雷〉 on our field", () => {
    const h = setup();
    energy(h.a, 2, YE);
    const weak = field(h.b, "front", NINE);
    const weak2 = field(h.b, "front", CHEN);
    const mid = field(h.b, "front", KING);
    mid.bpMod = 2500; // 4000
    const strong = field(h.b, "front", KING);
    strong.bpMod = 4500; // 6000
    useEvent(h, eva("020"));
    expect(choice(h.game, "a").options.sort()).toEqual([weak.uid, weak2.uid].sort());
    h.act("a", { type: "choose", picks: [weak2.uid] });
    expect(h.b.sideline).toEqual([CHEN]);
    expect(h.a.sideline).toEqual([eva("020")]);

    const second = setup();
    energy(second.a, 2, YE);
    field(second.a, "front", eva("009"));
    const low = field(second.b, "front", NINE);
    const middle = field(second.b, "front", KING);
    middle.bpMod = 2500;
    const high = field(second.b, "front", KING);
    high.bpMod = 4500;
    useEvent(second, eva("020"));
    expect(choice(second.game, "a").options.sort()).toEqual([low.uid, middle.uid].sort());
    second.act("a", { type: "choose", picks: [middle.uid] });
    expect(second.b.front).toEqual([low, high]);
  });

  it("021 和碇在一起的时候就感觉很温暖: activate a character; for 〈绫波 零〉 also activate up to 1 AP card; draw 1 with a non-yellow 〈碇 真嗣〉", () => {
    const h = setup();
    energy(h.a, 2, YE);
    const rei = field(h.a, "front", eva("001"), true);
    field(h.a, "front", eva("027")); // purple 碇 真嗣
    h.a.ap[0]!.rested = true;
    h.a.ap[1]!.rested = true;
    useEvent(h, eva("021"));
    h.act("a", { type: "choose", picks: [rei.uid] });
    expect(rei.rested).toBe(false);
    const aps = choice(h.game, "a");
    expect(aps.options).toHaveLength(3);
    h.act("a", { type: "choose", picks: ["ap:a:ap1"] });
    expect(h.a.ap.map((card) => card.rested)).toEqual([true, false, true]); // the event itself cost the third AP card
    expect(h.a.hand).toEqual([FILLER]);
  });

  it("021: another character: no AP card, and no draw without a non-yellow 〈碇 真嗣〉", () => {
    const h = setup();
    energy(h.a, 2, YE);
    const king = field(h.a, "front", KING, true);
    field(h.a, "front", eva("001")); // not chosen
    h.a.ap[0]!.rested = true;
    useEvent(h, eva("021"));
    h.act("a", { type: "choose", picks: [king.uid] });
    expect(king.rested).toBe(false);
    expect(h.game.pending).toBeNull();
    expect(h.a.ap[0]!.rested).toBe(true);
    expect(h.a.hand).toEqual([]);
  });

  it("022 你挺有趣的嘛: rest an opposing front-line character; draw 1 if it has no [突进]", () => {
    const h = setup();
    energy(h.a, 2, YE);
    const nine = field(h.b, "front", NINE);
    useEvent(h, eva("022"));
    expect(nine.rested).toBe(true);
    expect(h.a.hand).toEqual([FILLER]);

    const raid = setup();
    energy(raid.a, 2, YE);
    const shinji = field(raid.b, "front", eva("033")); // has 突进
    useEvent(raid, eva("022"));
    expect(shinji.rested).toBe(true);
    expect(raid.a.hand).toEqual([]);

    const none = setup();
    energy(none.a, 2, YE);
    useEvent(none, eva("022"));
    expect(none.a.hand).toEqual([]);
  });

  it("023 洗澡可是对生命的洗涤哟: up to 2 AP cards become active", () => {
    const h = setup();
    energy(h.a, 2, YE);
    h.a.ap[0]!.rested = true;
    h.a.ap[1]!.rested = true;
    useEvent(h, eva("023")); // costs the third AP card
    expect(h.a.ap.map((card) => card.rested)).toEqual([true, true, true]);
    h.act("a", { type: "choose", picks: ["ap:a:ap0", "ap:a:ap2"] });
    expect(h.a.ap.map((card) => card.rested)).toEqual([false, true, false]);
    expect(h.a.sideline).toEqual([eva("023")]);

    const none = setup();
    energy(none.a, 2, YE);
    none.a.ap[0]!.rested = true;
    none.a.ap[1]!.rested = true;
    useEvent(none, eva("023"));
    none.act("a", { type: "choose", picks: [] });
    expect(none.a.ap.every((card) => card.rested)).toBe(true);
  });
});

describe("绫波零（暂称）", () => {
  it("025: 登场时 look at the top card: put it on the top of the deck or into the sideline", () => {
    const h = setup();
    energy(h.a, 1, PE);
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    play(h, eva("025"));
    expect(choice(h.game, "a").cards).toEqual([NINE]);
    h.act("a", { type: "choose", picks: ["l:0"] });
    expect(h.a.sideline).toEqual([NINE]);
    expect(h.a.library).toHaveLength(29);
    expect(h.a.library[0]).toBe(FILLER);

    const top = setup();
    energy(top.a, 1, PE);
    top.a.library = [NINE, ...Array(29).fill(FILLER)];
    play(top, eva("025"));
    top.act("a", { type: "choose", picks: [] });
    expect(top.a.sideline).toEqual([]);
    expect(top.a.library).toHaveLength(30);
    expect(top.a.library[0]).toBe(NINE);
  });

  it("026: 攻击时 puts the top card of the deck face down under it", () => {
    const h = setup("attack");
    const rei = field(h.a, "front", eva("026"));
    h.act("a", { type: "attack", attackerUid: rei.uid });
    expect(rei.faceDown).toEqual([FILLER]);
    expect(h.a.library).toHaveLength(29);
    expect(bpOf(ctx, rei)).toBe(3500);
  });

  it("026: BP+500 for each face-down card under it in our turn only", () => {
    const h = setup();
    const rei = field(h.a, "front", eva("026"));
    rei.faceDown = [FILLER, FILLER];
    refresh(h);
    expect(bpOf(ctx, rei)).toBe(4000);
    h.act("a", { type: "end_turn" });
    expect(bpOf(ctx, rei)).toBe(3000);
  });

  it("026: when our turn starts with 3 or more face-down cards under it, it is sidelined (with those cards); with 2 it stays", () => {
    const h = setup("main");
    const rei = field(h.a, "front", eva("026"));
    rei.faceDown = [FILLER, FILLER, NINE];
    toMainOf(h, "b");
    expect(h.a.front).toContain(rei);
    toMainOf(h, "a");
    expect(h.a.front).not.toContain(rei);
    expect(h.a.sideline).toEqual([FILLER, FILLER, NINE, eva("026")]);

    const two = setup("main");
    const keep = field(two.a, "energy", eva("026"));
    keep.faceDown = [FILLER, FILLER];
    toMainOf(two, "b");
    toMainOf(two, "a");
    expect(two.a.energy).toContain(keep);
    expect(keep.faceDown).toHaveLength(2);
  });
});

describe("碇 真嗣", () => {
  it("027: 登场时 draw 1 card, then put 1 hand card into the sideline", () => {
    const h = setup();
    h.a.hand.push(NINE);
    play(h, eva("027"));
    h.act("a", { type: "choose", picks: ["h:1"] });
    expect(h.a.hand).toEqual([NINE]);
    expect(h.a.sideline).toEqual([FILLER]);
    expect(h.a.library).toHaveLength(29);
  });

  it("028: [启动主要] rest: the top card of the deck goes to the sideline", () => {
    const h = setup();
    const shinji = field(h.a, "front", eva("028"));
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    h.act("a", { type: "activate", uid: shinji.uid, ability: 0 });
    expect(shinji.rested).toBe(true);
    expect(h.a.sideline).toEqual([NINE]);
    expect(h.a.library).toHaveLength(29);
    expect(() => h.act("a", { type: "activate", uid: shinji.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("029: +1 purple energy while active", () => {
    const h = setup();
    const shinji = field(h.a, "energy", eva("029"));
    refresh(h);
    expect(energyOf(ctx, h.a, "purple")).toBe(2);
    h.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: shinji.uid, act: "rest" } });
    expect(energyOf(ctx, h.a, "purple")).toBe(1);
  });

  it("030: 登场时 puts up to 1 face-down card under our field cards into the sideline", () => {
    const h = setup();
    energy(h.a, 3, PE);
    const left = field(h.a, "front", eva("026"));
    left.faceDown = [NINE, CHEN];
    const right = field(h.a, "energy", eva("026"));
    right.faceDown = [KING];
    field(h.a, "front", KING); // nothing under it: not offered
    play(h, eva("030"));
    expect(choice(h.game, "a").options.sort()).toEqual([left.uid, right.uid].sort());
    h.act("a", { type: "choose", picks: [left.uid] });
    expect(left.faceDown).toEqual([CHEN]);
    expect(h.a.sideline).toEqual([NINE]);
    expect(right.faceDown).toEqual([KING]);

    const none = setup();
    energy(none.a, 3, PE);
    const pile = field(none.a, "front", eva("026"));
    pile.faceDown = [NINE, CHEN];
    field(none.a, "energy", eva("026")).faceDown = [KING];
    play(none, eva("030"));
    none.act("a", { type: "choose", picks: [] });
    expect(pile.faceDown).toHaveLength(2);
    expect(none.a.sideline).toEqual([]);
  });

  it("030: [启动主要] while on the energy line: move to the front line (not from the front line)", () => {
    const h = setup();
    const shinji = field(h.a, "energy", eva("030"));
    h.act("a", { type: "activate", uid: shinji.uid, ability: 1 });
    expect(h.a.front).toEqual([shinji]);
    expect(h.a.energy).toEqual([]);
    expect(() => h.act("a", { type: "activate", uid: shinji.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
  });

  it("031: costs 2 less in the hand; BP+1000 in our turn while another card of ours has required energy 5 or more", () => {
    const h = setup();
    expect(costOf(h.game, h.players, ctx, "a", eva("031")).energy).toBe(3);
    const shinji = field(h.a, "front", eva("031"));
    refresh(h);
    expect(bpOf(ctx, shinji)).toBe(3000); // only itself
    field(h.a, "energy", eva("013")); // required energy 4: not enough
    refresh(h);
    expect(bpOf(ctx, shinji)).toBe(3000);
    field(h.a, "energy", eva("031"));
    refresh(h);
    expect(bpOf(ctx, shinji)).toBe(4000);
    h.act("a", { type: "end_turn" });
    expect(bpOf(ctx, shinji)).toBe(3000);
  });
});
