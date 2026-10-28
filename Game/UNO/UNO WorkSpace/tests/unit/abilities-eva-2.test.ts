/**
 * EVA batch 2 (UC03BT/EVA-1-032 ... 062): one test per card (more for cards with several abilities), set up as the printed text describes and
 * checked against it. Cards are addressed by card number through the shared harness.
 */
import { describe, expect, it } from "vitest";
import { bpOf, canBlock, costOf, damageOf, energyOf, flagsOf, hasKeyword, impactOf } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { abilitiesFor, isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { EVA_2_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-eva-2.ts";
import { legalActions } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/legal.ts";
import type { UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, field, setup } from "./ability-harness.ts";
import { loadTitleCards } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";

const eva = (n: string): string => `UC03BT/EVA-1-${n}`;
const PE = "UCEX01BT/ARK-2-055"; // a purple site that makes 1 energy (see `power`); never takes part in character choices
const ROSE = "UCEX01BT/ARK-2-054"; // purple, cost 0, AP1, BP2000, no ability
const KING = "UC01BT/ARK-1-004"; // yellow, cost 0, BP1500, no ability (also the filler card)
const NINE = "UC01BT/ARK-1-088"; // red, cost 0, BP2000, no ability
const FILLER = KING;

const SHINJI_PURPLE = eva("027"); // 碇 真嗣, purple, cost 0, AP1
const SHINJI_YELLOW = eva("073"); // 碇 真嗣, yellow, cost 0
const WILLE = eva("044"); // 葛城 美里, WILLE, cost 0, BP500, 登场时 BP+1000
const WILLE_PLAIN = eva("049"); // 式波, WILLE, cost 1, BP2000, only 《冲击无效》
const REI_TEMP = eva("024"); // 绫波零（暂称）, purple, cost 0

type Harness = ReturnType<typeof setup>;
const cards = loadTitleCards();
const titleCard = (number: string) => cards.find((entry) => entry.number === number)!;

/** `count` purple energy: one purple site on the energy line whose energy is raised. */
function power(h: Harness, count: number): UnionArenaFieldCard {
  const site = field(h.a, "energy", PE);
  site.energyMod = count - 1;
  return site;
}
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
const pick = (h: Harness, who: "a" | "b", picks: string[]): void => h.act(who, { type: "choose", picks });
/** Passes turns until `who`'s main phase has begun. */
function toMainOf(h: Harness, who: "a" | "b"): void {
  for (let guard = 0; guard < 12 && !(h.game.turnPlayerId === who && h.game.phase === "main"); guard += 1) {
    const turn = h.game.turnPlayerId as "a" | "b";
    if (turn === who) h.act(turn, { type: "next_phase" });
    else if (h.game.phase === "main" || h.game.phase === "attack") h.act(turn, { type: "end_turn" });
    else h.act(turn, { type: "next_phase" });
  }
}
/** `a` attacks with `uid`, `b` does not block, `a` picks b's first life card and `b` does not use its trigger. */
function strike(h: Harness, uid: string): void {
  h.act("a", { type: "attack", attackerUid: uid });
  if (h.game.pending?.kind === "block") h.act("b", { type: "block", blockerUid: null });
  const life = h.b.life[0]!;
  h.act("a", { type: "damage", lifeIds: [life.id] });
  h.act("b", { type: "trigger", lifeId: life.id, activate: false });
}

describe("EVA batch 2: the table", () => {
  it("lists every card of the batch as automated, and the names the filters rely on", () => {
    expect(Object.keys(EVA_2_ABILITIES)).toHaveLength(29);
    for (const number of Object.keys(EVA_2_ABILITIES)) expect(isAutomated(titleCard(number)), number).toBe(true);
    expect(titleCard(eva("027")).name).toBe("碇 真嗣");
    expect(titleCard(eva("037")).name).toBe("渚 薰");
    expect(titleCard(eva("024")).name).toBe("绫波零（暂称）");
    expect(titleCard(eva("034")).name).toBe("新世纪福音战士13号机");
    expect(titleCard(eva("058")).name).toBe("莉莉丝");
    expect(titleCard(eva("044")).stats!.affinities).toEqual(["WILLE"]);
  });
});

describe("碇 源堂", () => {
  it("032: 登场时 puts a purple 〈绫波零（暂称）〉 / 〈渚 薰〉 / site with cost 2 or less from the hand onto the field resting (no discard)", () => {
    const h = setup();
    power(h, 2);
    // 渚 薰 cost 0 / 绫波零（暂称） cost 0 / 莉莉丝 (a site) cost 2 are eligible; 渚 薰 cost 3, a yellow card and 绫波 零 (another name) are not.
    h.a.hand.push(eva("037"), eva("039"), REI_TEMP, eva("058"), KING, eva("001"));
    play(h, eva("032"));
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([eva("037"), REI_TEMP, eva("058")]);
    pick(h, "a", [options.options[0]!]);
    const line = choice(h.game, "a");
    expect(line.options).toEqual(["line:front", "line:energy"]);
    pick(h, "a", ["line:front"]);
    const nagisa = h.a.front[h.a.front.length - 1]!;
    expect(nagisa.cardId).toBe(eva("037"));
    expect(nagisa.rested).toBe(true);
    expect(h.a.sideline).toEqual([]);
    expect(h.game.pending).toBeNull();
  });

  it("032: a site from the hand can only go onto the energy line", () => {
    const h = setup();
    power(h, 2);
    h.a.hand.push(eva("058"));
    play(h, eva("032"));
    pick(h, "a", ["h:0"]);
    expect(h.game.pending).toBeNull(); // no question about the line
    const lilith = h.a.energy[h.a.energy.length - 1]!;
    expect(lilith.cardId).toBe(eva("058"));
    expect(lilith.rested).toBe(true);
    expect(lilith.faceDown).toHaveLength(2); // its own 登场时 ran
  });

  it("032: from the sideline it costs a hand card (and only cost 2 or less); with no hand candidate the sideline is asked", () => {
    const h = setup();
    power(h, 2);
    h.a.sideline.push(eva("037"), eva("039"), eva("001"), eva("058"));
    h.a.hand.push(KING, NINE);
    play(h, eva("032"));
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([eva("037"), eva("058")]);
    pick(h, "a", [options.options[0]!]);
    pick(h, "a", ["line:front"]);
    const nagisa = h.a.front[h.a.front.length - 1]!;
    expect(nagisa.cardId).toBe(eva("037"));
    expect(nagisa.rested).toBe(true);
    const discard = choice(h.game, "a");
    expect(discard.options).toEqual(["h:0", "h:1"]);
    pick(h, "a", ["h:0"]);
    expect(h.a.hand).toEqual([NINE]);
    expect(h.a.sideline).toEqual([eva("039"), eva("001"), eva("058"), KING]);
  });

  it("032: up to 1 — picking none from the hand leads to the sideline question, picking none there does nothing and discards nothing", () => {
    const h = setup();
    power(h, 2);
    h.a.hand.push(eva("037"));
    h.a.sideline.push(eva("037"));
    play(h, eva("032"));
    pick(h, "a", []); // none from the hand ...
    const second = choice(h.game, "a");
    expect(second.options).toEqual(["s:0"]); // ... so the sideline is asked
    pick(h, "a", []);
    expect(h.game.pending).toBeNull();
    expect(h.a.hand).toEqual([eva("037")]);
    expect(h.a.sideline).toEqual([eva("037")]);
    expect(h.a.front.map((card) => card.cardId)).toEqual([eva("032")]);
  });
});

describe("新世纪福音战士初号机（盖乌斯之枪）", () => {
  it("033: 登场时 draws 1, then puts up to 1 purple AP1 character without 突进 from the hand onto the field active", () => {
    const h = setup();
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    // eligible: 渚 薰 037 and 迷迭香 (purple, AP1, no Raid); not: 13号机 (has 突进), 碇 源堂 (AP2), 弑君者 (yellow), 九 (red, drawn)
    h.a.hand.push(eva("034"), eva("032"), KING, eva("037"), ROSE);
    play(h, eva("033"));
    expect(h.a.hand).toEqual([eva("034"), eva("032"), KING, eva("037"), ROSE, NINE]);
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([eva("037"), ROSE]);
    expect(options.min).toBe(0);
    pick(h, "a", ["h:3"]);
    pick(h, "a", ["line:front"]);
    const nagisa = h.a.front[h.a.front.length - 1]!;
    expect(nagisa.cardId).toBe(eva("037"));
    expect(nagisa.rested).toBe(false); // active
    expect(h.a.hand).toEqual([eva("034"), eva("032"), KING, ROSE, NINE]);
  });

  it("033: 登场时 — picking none puts nothing onto the field", () => {
    const h = setup();
    h.a.hand.push(eva("037"));
    play(h, eva("033"));
    pick(h, "a", []);
    expect(h.a.front.map((card) => card.cardId)).toEqual([eva("033")]);
    expect(h.a.hand).toEqual([eva("037"), FILLER]);
  });

  it("033: 启动主要 (on the front line, once per turn) sidelines another front-line character, then repeats the 登场时 effect", () => {
    const h = setup();
    const gaius = field(h.a, "front", eva("033"));
    const ally = field(h.a, "front", KING);
    field(h.a, "energy", NINE); // not on the front line: cannot be chosen
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    h.a.hand.push(ROSE);
    h.act("a", { type: "activate", uid: gaius.uid, ability: 1 });
    expect(h.a.front).toEqual([gaius]); // the only other front-line character was sidelined (no question)
    expect(h.a.sideline).toEqual([KING]);
    expect(ally.uid).not.toBe(gaius.uid);
    expect(h.a.hand).toEqual([ROSE, NINE]); // drew 1
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([ROSE]);
    pick(h, "a", ["h:0"]);
    pick(h, "a", ["line:energy"]);
    expect(h.a.energy[h.a.energy.length - 1]!.cardId).toBe(ROSE);
    expect(h.a.energy[h.a.energy.length - 1]!.rested).toBe(false);
    // once per turn
    expect(() => h.act("a", { type: "activate", uid: gaius.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
  });

  it("033: 启动主要 asks which one when several are on the front line; with no other one nothing happens (no draw); on the energy line it cannot be used", () => {
    const h = setup();
    const gaius = field(h.a, "front", eva("033"));
    const first = field(h.a, "front", KING);
    const second = field(h.a, "front", NINE);
    h.act("a", { type: "activate", uid: gaius.uid, ability: 1 });
    expect(choice(h.game, "a").options).toEqual([first.uid, second.uid]);
    pick(h, "a", [second.uid]);
    expect(h.a.front).toEqual([gaius, first]);
    expect(h.a.sideline).toEqual([NINE]);
    expect(h.game.pending).toBeNull(); // the 登场时 draw ran; the hand is empty, so nothing to put

    const alone = setup();
    const lone = field(alone.a, "front", eva("033"));
    alone.act("a", { type: "activate", uid: lone.uid, ability: 1 });
    expect(alone.game.pending).toBeNull();
    expect(alone.a.hand).toEqual([]); // "这样做的场合": nothing was sidelined, so no 登场时 effect

    const back = setup();
    const resting = field(back.a, "energy", eva("033"));
    field(back.a, "front", KING);
    expect(() => back.act("a", { type: "activate", uid: resting.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
  });
});

describe("新世纪福音战士13号机", () => {
  it("034: our turn — with 13 or more cards in our sideline BP+1000 and 伤害②; with 26 or more BP+1000 more and 冲击④; not on the opponent's turn", () => {
    const h = setup();
    const unit = field(h.a, "front", eva("034"));
    h.a.sideline = Array(12).fill(KING);
    refresh(h);
    expect(bpOf(ctx, unit)).toBe(4000);
    expect(damageOf(ctx, unit)).toBe(1);
    h.a.sideline.push(KING);
    refresh(h);
    expect(bpOf(ctx, unit)).toBe(5000);
    expect(damageOf(ctx, unit)).toBe(2);
    expect(impactOf(ctx, unit)).toBe(0);
    h.a.sideline = Array(26).fill(KING);
    refresh(h);
    expect(bpOf(ctx, unit)).toBe(6000);
    expect(damageOf(ctx, unit)).toBe(2);
    expect(impactOf(ctx, unit)).toBe(4);
    h.act("a", { type: "end_turn" });
    expect(bpOf(ctx, unit)).toBe(4000);
    expect(impactOf(ctx, unit)).toBe(0);
  });

  it("034: 启动主要 puts 1 face-down card under one of our field cards into the sideline, then draws 1 (once per turn, on the front line)", () => {
    const h = setup();
    const unit = field(h.a, "front", eva("034"));
    const lilith = field(h.a, "energy", eva("058"));
    lilith.faceDown = [NINE, ROSE];
    unit.faceDown = [KING];
    h.a.library = [eva("037"), ...Array(29).fill(FILLER)];
    h.act("a", { type: "activate", uid: unit.uid, ability: 2 });
    expect(choice(h.game, "a").options).toEqual([unit.uid, lilith.uid]); // both piles hold a face-down card
    pick(h, "a", [lilith.uid]);
    expect(lilith.faceDown).toEqual([ROSE]);
    expect(unit.faceDown).toEqual([KING]);
    expect(h.a.sideline).toEqual([NINE]);
    expect(h.a.hand).toEqual([eva("037")]);
    expect(() => h.act("a", { type: "activate", uid: unit.uid, ability: 2 })).toThrow("ONCE_PER_TURN");
  });

  it("034: 启动主要 without any face-down card does nothing (no draw); on the energy line it cannot be used", () => {
    const h = setup();
    const unit = field(h.a, "front", eva("034"));
    h.act("a", { type: "activate", uid: unit.uid, ability: 2 });
    expect(h.game.pending).toBeNull();
    expect(h.a.hand).toEqual([]);
    const back = setup();
    const resting = field(back.a, "energy", eva("034"));
    resting.faceDown = [KING];
    expect(() => back.act("a", { type: "activate", uid: resting.uid, ability: 2 })).toThrow("ABILITY_CONDITION");
  });
});

describe("EVANGELION Mark.06", () => {
  it("035: 登场时 draws 1 and puts every card under a chosen field card (ours or the opponent's) into its owner's sideline", () => {
    const h = setup();
    power(h, 4);
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    const mine = field(h.a, "front", KING);
    mine.under = [ROSE];
    const theirs = field(h.b, "energy", eva("058"));
    theirs.faceDown = [NINE, KING];
    theirs.under = [ROSE];
    field(h.b, "front", NINE); // nothing under it: not offered
    play(h, eva("035"));
    expect(h.a.hand).toEqual([NINE]);
    const options = choice(h.game, "a");
    expect(options.options).toEqual([mine.uid, theirs.uid]);
    expect(options.min).toBe(1);
    pick(h, "a", [theirs.uid]);
    expect(h.b.sideline).toEqual([ROSE, NINE, KING]);
    expect(theirs.under).toEqual([]);
    expect(theirs.faceDown).toEqual([]);
    expect(mine.under).toEqual([ROSE]);
    expect(h.a.sideline).toEqual([]);
  });

  it("035: choosing our own raided card sends its raid source to our sideline; with nothing under any card there is no question", () => {
    const h = setup();
    power(h, 4);
    const mine = field(h.a, "front", KING);
    mine.under = [ROSE];
    const other = field(h.a, "energy", NINE);
    other.under = [];
    play(h, eva("035"));
    // only `mine` has cards under it, so it is chosen without a question
    expect(h.game.pending).toBeNull();
    expect(h.a.sideline).toEqual([ROSE]);
    expect(mine.under).toEqual([]);

    const empty = setup();
    power(empty, 4);
    play(empty, eva("035"));
    expect(empty.game.pending).toBeNull();
    expect(empty.a.sideline).toEqual([]);
  });
});

describe("EVANGELION Mark.09", () => {
  it("036: BP+500 on our turn only", () => {
    const h = setup();
    const mark = field(h.a, "front", eva("036"));
    refresh(h);
    expect(bpOf(ctx, mark)).toBe(4000);
    h.act("a", { type: "end_turn" });
    expect(bpOf(ctx, mark)).toBe(3500);
  });

  it("036: 登场时 draws 2 and puts 2 hand cards into the sideline", () => {
    const h = setup();
    power(h, 4);
    h.a.library = [NINE, ROSE, ...Array(28).fill(FILLER)];
    h.a.hand.push(KING);
    play(h, eva("036"));
    expect(h.a.hand).toEqual([KING, NINE, ROSE]);
    const options = choice(h.game, "a");
    expect(options.min).toBe(2);
    expect(options.max).toBe(2);
    pick(h, "a", ["h:0", "h:2"]);
    expect(h.a.hand).toEqual([NINE]);
    expect(h.a.sideline).toEqual([KING, ROSE]);
  });

  it("036: 退场时 may discard 1 hand card to put this card back onto the field resting (and its 登场时 runs again)", () => {
    const h = setup();
    const mark = field(h.a, "front", eva("036"));
    h.a.hand.push(KING);
    h.a.library = [NINE, ROSE, ...Array(28).fill(FILLER)];
    h.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: mark.uid, act: "sideline" } });
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    // one hand card: no question about which to discard; then the line it comes back to; its 登场时 draws 2 and discards 2 (the whole hand)
    pick(h, "a", ["line:front"]);
    expect(h.game.pending).toBeNull();
    expect(h.a.front.map((card) => card.cardId)).toEqual([eva("036")]);
    expect(h.a.front[0]!.rested).toBe(true);
    expect(h.a.hand).toEqual([]);
    expect(h.a.sideline).toEqual([KING, NINE, ROSE]);
  });

  it("036: 退场时 — answering no, or having no hand card, leaves it in the sideline", () => {
    const h = setup();
    const mark = field(h.a, "front", eva("036"));
    h.a.hand.push(KING);
    h.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: mark.uid, act: "sideline" } });
    pick(h, "a", ["no"]);
    expect(h.a.front).toEqual([]);
    expect(h.a.sideline).toEqual([eva("036")]);
    expect(h.a.hand).toEqual([KING]);

    const empty = setup();
    const lone = field(empty.a, "front", eva("036"));
    empty.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: lone.uid, act: "sideline" } });
    expect(empty.game.pending).toBeNull();
    expect(empty.a.sideline).toEqual([eva("036")]);
  });
});

describe("渚 薰", () => {
  it("037: 启动主要 rest, once per turn: +1 purple energy this turn, and it is sidelined when the main phase ends", () => {
    const h = setup();
    const nagisa = field(h.a, "energy", eva("037"));
    expect(energyOf(ctx, h.a, "purple")).toBe(1);
    h.act("a", { type: "activate", uid: nagisa.uid, ability: 0 });
    expect(nagisa.rested).toBe(true);
    expect(energyOf(ctx, h.a, "purple")).toBe(2);
    nagisa.rested = false;
    expect(() => h.act("a", { type: "activate", uid: nagisa.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    h.act("a", { type: "next_phase" });
    expect(h.a.energy).toEqual([]);
    expect(h.a.sideline).toEqual([eva("037")]);
  });

  it("038: 登场时 looks at 4, adds up to 1 〈碇 真嗣〉/〈13号机〉/〈莉莉丝〉 to the hand, the rest go to the bottom in a chosen order, then discard 1", () => {
    const h = setup();
    power(h, 1);
    h.a.library = [NINE, eva("027"), eva("034"), KING, ...Array(26).fill(FILLER)];
    h.a.hand.push(NINE);
    play(h, eva("038"));
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([eva("027"), eva("034")]);
    pick(h, "a", [options.options[0]!]);
    const order = choice(h.game, "a");
    expect(order.cards).toEqual([NINE, eva("034"), KING]);
    pick(h, "a", [order.options[2]!, order.options[0]!, order.options[1]!]);
    expect(h.a.library.slice(-3)).toEqual([KING, NINE, eva("034")]);
    expect(h.a.library).toHaveLength(29);
    expect(h.a.hand).toEqual([NINE, eva("027")]);
    pick(h, "a", ["h:0"]);
    expect(h.a.hand).toEqual([eva("027")]);
    expect(h.a.sideline).toEqual([NINE]);
  });

  it("038: 登场时 — picking none adds nothing and discards nothing; 莉莉丝 is eligible too", () => {
    const h = setup();
    power(h, 1);
    h.a.library = [eva("058"), NINE, ROSE, KING, ...Array(26).fill(FILLER)];
    h.a.hand.push(KING);
    play(h, eva("038"));
    expect(choice(h.game, "a").cards).toEqual([eva("058")]);
    pick(h, "a", []);
    const order = choice(h.game, "a");
    pick(h, "a", order.options);
    expect(h.a.hand).toEqual([KING]);
    expect(h.a.library).toHaveLength(30);
    expect(h.a.library.slice(-4)).toEqual([eva("058"), NINE, ROSE, KING]);
    expect(h.game.pending).toBeNull();
  });

  it("039: first 启动主要 rests it to give another character BP+500 this turn", () => {
    const h = setup();
    const nagisa = field(h.a, "front", eva("039"));
    const king = field(h.a, "front", KING);
    h.act("a", { type: "activate", uid: nagisa.uid, ability: 0 });
    expect(nagisa.rested).toBe(true);
    expect(bpOf(ctx, king)).toBe(2000);
    expect(bpOf(ctx, nagisa)).toBe(3000); // another character, not itself
    expect(() => h.act("a", { type: "activate", uid: nagisa.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("039: second 启动主要 (on the energy line) activates a resting 〈碇 真嗣〉 on the energy line, then this character too; the effect once per turn among all 〈渚 薰〉", () => {
    const h = setup();
    const nagisa = field(h.a, "energy", eva("039"), true);
    const second = field(h.a, "energy", eva("039"), true);
    const resting = field(h.a, "energy", SHINJI_PURPLE, true);
    field(h.a, "energy", eva("028"), false); // an active 碇 真嗣: not a candidate
    field(h.a, "front", SHINJI_PURPLE, true); // on the front line: not a candidate
    h.act("a", { type: "activate", uid: nagisa.uid, ability: 1 });
    expect(resting.rested).toBe(false);
    expect(nagisa.rested).toBe(false);
    expect(h.game.pending).toBeNull();
    // another 〈渚 薰〉 cannot use the effect again this turn
    expect(() => h.act("a", { type: "activate", uid: second.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    expect(second.rested).toBe(true);
  });

  it("039: second 启动主要 asks which 〈碇 真嗣〉; with none resting this character is not activated; on the front line it cannot be used", () => {
    const h = setup();
    const nagisa = field(h.a, "energy", eva("039"), true);
    const first = field(h.a, "energy", SHINJI_PURPLE, true);
    const second = field(h.a, "energy", eva("029"), true);
    h.act("a", { type: "activate", uid: nagisa.uid, ability: 1 });
    expect(choice(h.game, "a").options).toEqual([first.uid, second.uid]);
    pick(h, "a", [second.uid]);
    expect(second.rested).toBe(false);
    expect(first.rested).toBe(true);
    expect(nagisa.rested).toBe(false);

    const none = setup();
    const resting = field(none.a, "energy", eva("039"), true);
    none.act("a", { type: "activate", uid: resting.uid, ability: 1 });
    expect(resting.rested).toBe(true); // "这样做的场合" did not hold

    const front = setup();
    const onFront = field(front.a, "front", eva("039"), true);
    field(front.a, "energy", SHINJI_PURPLE, true);
    expect(() => front.act("a", { type: "activate", uid: onFront.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
  });
});

describe("赤木 律子", () => {
  it("040: 登场时 returns another character with cost 1 or less to the hand; this character stays", () => {
    const h = setup();
    power(h, 1);
    const king = field(h.a, "front", KING);
    field(h.a, "front", eva("046")); // cost 3: not eligible
    const ritsuko = play(h, eva("040"));
    expect(h.game.pending).toBeNull(); // one candidate: no question
    expect(h.a.front).not.toContain(king);
    expect(h.a.hand).toEqual([KING]);
    expect(h.a.front).toContain(ritsuko);
  });

  it("040: 登场时 asks which one when several qualify", () => {
    const h = setup();
    power(h, 1);
    const king = field(h.a, "front", KING);
    const nine = field(h.a, "energy", NINE);
    play(h, eva("040"));
    expect(choice(h.game, "a").options).toEqual([king.uid, nine.uid]);
    pick(h, "a", [nine.uid]);
    expect(h.a.hand).toEqual([NINE]);
    expect(h.a.energy).not.toContain(nine);
  });

  it("040: with no other character that qualifies, this character goes back to the hand", () => {
    const h = setup();
    power(h, 1);
    field(h.a, "front", eva("046")); // cost 3
    play(h, eva("040"));
    expect(h.a.hand).toEqual([eva("040")]);
    expect(h.a.front.map((card) => card.cardId)).toEqual([eva("046")]);

    const alone = setup();
    power(alone, 1);
    play(alone, eva("040"));
    expect(alone.a.hand).toEqual([eva("040")]);
    expect(alone.a.front).toEqual([]);
  });

  it("040: a qualifying character that cannot be returned does not count as returned, so this one goes back", () => {
    const h = setup();
    power(h, 1);
    const king = field(h.a, "front", KING);
    king.flags = ["cannotToHand"];
    play(h, eva("040"));
    expect(h.a.front).toContain(king);
    expect(h.a.hand).toEqual([eva("040")]);
  });
});

describe("新世纪福音战士改2号机", () => {
  it("041: 登场时 BP-1000 to up to 1 opposing front-line character", () => {
    const h = setup();
    power(h, 4);
    const target = field(h.b, "front", NINE);
    const behind = field(h.b, "energy", KING);
    play(h, eva("041"));
    expect(choice(h.game, "a").options).toEqual([target.uid]); // front line only
    expect(choice(h.game, "a").min).toBe(0);
    pick(h, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(1000);
    expect(bpOf(ctx, behind)).toBe(1500);

    const second = setup();
    power(second, 4);
    const kept = field(second.b, "front", NINE);
    play(second, eva("041"));
    pick(second, "a", []);
    expect(bpOf(ctx, kept)).toBe(2000);
  });

  /** b blocks a's strong attacker with the raided 改2号机 (its raid source is 式波); the battle would sideline it. */
  function raidedBlocked() {
    const h = setup("attack");
    const attacker = field(h.a, "front", KING);
    attacker.bpMod = 5000;
    const stack = field(h.b, "front", eva("041"));
    stack.under = [WILLE_PLAIN];
    h.act("a", { type: "attack", attackerUid: attacker.uid });
    h.act("b", { type: "block", blockerUid: stack.uid });
    return { h, stack };
  }

  it("041: when it would be sidelined it may instead put itself (the top card of the raid) into the sideline and stay as its raid source", () => {
    const { h, stack } = raidedBlocked();
    expect(choice(h.game, "b").purpose).toBe("confirm");
    pick(h, "b", ["yes"]);
    expect(h.b.front).toContain(stack);
    expect(stack.cardId).toBe(WILLE_PLAIN);
    expect(stack.under).toEqual([]);
    expect(h.b.sideline).toEqual([eva("041")]);
    expect(h.game.pending).toBeNull();
  });

  it("041: answering no sidelines the whole stack as usual", () => {
    const { h, stack } = raidedBlocked();
    pick(h, "b", ["no"]);
    expect(h.b.front).not.toContain(stack);
    expect(h.b.sideline).toEqual([WILLE_PLAIN, eva("041")]);
  });

  it("041: with no raid source under it (not raided) there is nothing to replace", () => {
    const h = setup("attack");
    const attacker = field(h.a, "front", KING);
    attacker.bpMod = 5000;
    const alone = field(h.b, "front", eva("041"));
    h.act("a", { type: "attack", attackerUid: attacker.uid });
    h.act("b", { type: "block", blockerUid: alone.uid });
    expect(h.game.pending).toBeNull();
    expect(h.b.front).toEqual([]);
    expect(h.b.sideline).toEqual([eva("041")]);
  });
});

describe("新世纪福音战士改8号机", () => {
  it("042: BP+500 for each face-down card under it", () => {
    const h = setup();
    const unit = field(h.a, "front", eva("042"));
    refresh(h);
    expect(bpOf(ctx, unit)).toBe(4000);
    unit.faceDown = [KING, NINE];
    refresh(h);
    expect(bpOf(ctx, unit)).toBe(5000);
    h.act("a", { type: "end_turn" }); // also in the opponent's turn
    expect(bpOf(ctx, unit)).toBe(5000);
  });

  it("042: 登场时 draws 2 and puts 1 hand card into the sideline", () => {
    const h = setup();
    power(h, 5);
    h.a.library = [NINE, ROSE, ...Array(28).fill(FILLER)];
    h.a.hand.push(KING);
    play(h, eva("042"));
    expect(h.a.hand).toEqual([KING, NINE, ROSE]);
    expect(choice(h.game, "a").max).toBe(1);
    pick(h, "a", ["h:1"]);
    expect(h.a.hand).toEqual([KING, ROSE]);
    expect(h.a.sideline).toEqual([NINE]);
  });

  it("042: 启动主要 BP-1000 on an opposing front-line character; if that brings it to 0 the top card of the deck may be put face down under this card", () => {
    const h = setup();
    const unit = field(h.a, "front", eva("042"));
    const weak = field(h.b, "front", eva("037")); // BP1000
    field(h.b, "energy", eva("037")); // not on the front line
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    h.act("a", { type: "activate", uid: unit.uid, ability: 2 });
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    expect(unit.faceDown).toEqual([NINE]);
    expect(h.a.library).toHaveLength(29);
    expect(h.b.front).not.toContain(weak); // BP 0: sidelined
    expect(h.b.sideline).toEqual([eva("037")]);
    expect(bpOf(ctx, unit)).toBe(4500);
    expect(() => h.act("a", { type: "activate", uid: unit.uid, ability: 2 })).toThrow("ONCE_PER_TURN");
  });

  it("042: 启动主要 — answering no puts nothing under it; a target that stays above 0 BP gives no question; a protected target is unchanged", () => {
    const h = setup();
    const unit = field(h.a, "front", eva("042"));
    field(h.b, "front", eva("037"));
    h.act("a", { type: "activate", uid: unit.uid, ability: 2 });
    pick(h, "a", ["no"]);
    expect(unit.faceDown ?? []).toEqual([]);
    expect(h.a.library).toHaveLength(30);

    const strong = setup();
    const unit2 = field(strong.a, "front", eva("042"));
    const big = field(strong.b, "front", NINE);
    strong.act("a", { type: "activate", uid: unit2.uid, ability: 2 });
    expect(strong.game.pending).toBeNull();
    expect(bpOf(ctx, big)).toBe(1000);
    expect(unit2.faceDown ?? []).toEqual([]);

    const guarded = setup();
    const unit3 = field(guarded.a, "front", eva("042"));
    const shielded = field(guarded.b, "front", eva("037"));
    shielded.flags = ["noBpDown"];
    guarded.act("a", { type: "activate", uid: unit3.uid, ability: 2 });
    expect(guarded.game.pending).toBeNull(); // BP did not fall, so no face-down card
    expect(bpOf(ctx, shielded)).toBe(1000);

    const several = setup();
    const unit4 = field(several.a, "front", eva("042"));
    const x = field(several.b, "front", eva("037"));
    const y = field(several.b, "front", KING);
    several.act("a", { type: "activate", uid: unit4.uid, ability: 2 });
    expect(choice(several.game, "a").options).toEqual([x.uid, y.uid]);
    expect(choice(several.game, "a").min).toBe(1);
  });
});

describe("新世纪福音战士新2号机", () => {
  it("043: 登场时 gets 《2次攻击》 only when 2 or more opposing front-line characters have BP below their printed BP", () => {
    const h = setup();
    power(h, 4);
    field(h.b, "front", KING).bpMod = -500;
    field(h.b, "front", NINE).bpMod = -500;
    const unit = play(h, eva("043"));
    expect(hasKeyword(ctx, unit, "2次攻击")).toBe(true);

    const one = setup();
    power(one, 4);
    field(one.b, "front", KING).bpMod = -500;
    field(one.b, "front", NINE); // at its printed BP
    field(one.b, "front", ROSE).bpMod = 1000; // above its printed BP
    field(one.b, "energy", NINE).bpMod = -500; // not on the front line
    const single = play(one, eva("043"));
    expect(hasKeyword(ctx, single, "2次攻击")).toBe(false);
  });

  /** 新2号机 raided onto 式波 in the front line, with 4 WILLE cards in the sideline; it attacks and the attack ends. */
  function afterAttack(extraWille = 0) {
    const h = setup();
    power(h, 4);
    const base = field(h.a, "front", WILLE_PLAIN);
    const blocker = field(h.b, "front", eva("039")); // BP3000
    h.a.sideline.push(WILLE, WILLE, WILLE, WILLE, ...Array(extraWille).fill(eva("046")), KING);
    h.a.hand.push(eva("043"));
    h.act("a", { type: "raid", handIndex: 0, targetUid: base.uid });
    expect(base.cardId).toBe(eva("043"));
    expect(base.under).toEqual([WILLE_PLAIN]);
    h.act("a", { type: "next_phase" });
    expect(canBlock(ctx, base, blocker)).toBe(true);
    h.act("a", { type: "attack", attackerUid: base.uid });
    h.act("b", { type: "block", blockerUid: null });
    const life = h.b.life[0]!;
    h.act("a", { type: "damage", lifeIds: [life.id] });
    h.act("b", { type: "trigger", lifeId: life.id, activate: false });
    return { h, base, blocker };
  }

  it("043: when its attack ends it may remove 4 WILLE cards from the sideline: it becomes active, BP+3000, cannot be blocked by BP 3000 or less, and its raid source goes to the sideline", () => {
    const { h, base, blocker } = afterAttack();
    expect(base.rested).toBe(true);
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    expect(h.game.pending).toBeNull(); // exactly 4 WILLE cards: no question
    expect(h.a.removal).toEqual([WILLE, WILLE, WILLE, WILLE]);
    expect(h.a.sideline).toEqual([KING, WILLE_PLAIN]); // WILLE_PLAIN was the raid source
    expect(base.under).toEqual([]);
    expect(base.rested).toBe(false);
    expect(bpOf(ctx, base)).toBe(7000);
    expect(flagsOf(base)).toContain("unblockableBpAtMost:3000");
    expect(canBlock(ctx, base, blocker)).toBe(false);
    // it can attack again, and the BP 3000 blocker cannot block it (no question about blocking)
    h.act("a", { type: "attack", attackerUid: base.uid });
    expect(h.game.pending?.kind).toBe("damage");
  });

  it("043: with more than 4 WILLE cards the player picks which 4; answering no changes nothing", () => {
    const { h, base } = afterAttack(1); // 046 is a WILLE card too
    pick(h, "a", ["yes"]);
    const options = choice(h.game, "a");
    expect(options.min).toBe(4);
    expect(options.max).toBe(4);
    expect(options.options).toHaveLength(5);
    pick(h, "a", options.options.slice(1));
    expect(h.a.removal).toEqual([WILLE, WILLE, WILLE, eva("046")]);
    expect(base.rested).toBe(false);

    const declined = afterAttack();
    pick(declined.h, "a", ["no"]);
    expect(declined.base.rested).toBe(true);
    expect(declined.h.a.removal).toEqual([]);
    expect(declined.base.under).toEqual([WILLE_PLAIN]);
    expect(bpOf(ctx, declined.base)).toBe(4000);
  });

  it("043: with fewer than 4 WILLE cards in the sideline the attack end does nothing", () => {
    const h = setup();
    power(h, 4);
    const base = field(h.a, "front", WILLE_PLAIN);
    h.a.sideline.push(WILLE, WILLE, WILLE, KING);
    h.a.hand.push(eva("043"));
    h.act("a", { type: "raid", handIndex: 0, targetUid: base.uid });
    h.act("a", { type: "next_phase" });
    strike(h, base.uid);
    expect(h.game.pending).toBeNull();
    expect(base.rested).toBe(true);
    expect(h.a.removal).toEqual([]);
  });
});

describe("葛城 美里", () => {
  it("044: 登场时 BP+1000 to up to 1 other character (not itself)", () => {
    const h = setup();
    const king = field(h.a, "front", KING);
    const nine = field(h.a, "energy", NINE);
    const misato = play(h, WILLE);
    const options = choice(h.game, "a");
    expect(options.options).toEqual([king.uid, nine.uid]);
    expect(options.min).toBe(0);
    pick(h, "a", [nine.uid]);
    expect(bpOf(ctx, nine)).toBe(3000);
    expect(bpOf(ctx, king)).toBe(1500);
    expect(bpOf(ctx, misato)).toBe(500);

    const none = setup();
    const kept = field(none.a, "front", KING);
    play(none, WILLE);
    pick(none, "a", []);
    expect(bpOf(ctx, kept)).toBe(1500);
  });

  it("045: 启动主要 rests and sidelines itself to give 冲击① to one of our purple characters with cost 5 or more this turn", () => {
    const h = setup();
    power(h, 1);
    const misato = field(h.a, "front", eva("045"));
    const big = field(h.a, "front", eva("042")); // purple, cost 5
    const other = field(h.a, "front", eva("031")); // purple, cost 5
    field(h.a, "front", ROSE); // purple but cost 0
    field(h.a, "front", eva("041")); // purple, cost 4
    h.act("a", { type: "activate", uid: misato.uid, ability: 0 });
    expect(h.a.sideline).toEqual([eva("045")]);
    expect(h.a.front).not.toContain(misato);
    const targets = choice(h.game, "a");
    expect(targets.options).toEqual([big.uid, other.uid]);
    pick(h, "a", [big.uid]);
    const modes = choice(h.game, "a");
    expect(modes.options).toEqual(["m:0", "m:1"]);
    pick(h, "a", ["m:0"]);
    expect(impactOf(ctx, big)).toBe(1);
    expect(damageOf(ctx, big)).toBe(1);
    expect(impactOf(ctx, other)).toBe(0);
  });

  it("045: or 伤害② instead; picking no character gives nothing (the cost is paid all the same)", () => {
    const h = setup();
    const misato = field(h.a, "energy", eva("045"));
    const big = field(h.a, "front", eva("042"));
    h.act("a", { type: "activate", uid: misato.uid, ability: 0 });
    pick(h, "a", [big.uid]);
    pick(h, "a", ["m:1"]);
    expect(damageOf(ctx, big)).toBe(2);
    expect(impactOf(ctx, big)).toBe(0);

    const none = setup();
    const lone = field(none.a, "front", eva("045"));
    const big2 = field(none.a, "front", eva("042"));
    none.act("a", { type: "activate", uid: lone.uid, ability: 0 });
    pick(none, "a", []);
    expect(none.game.pending).toBeNull();
    expect(none.a.sideline).toEqual([eva("045")]);
    expect(damageOf(ctx, big2)).toBe(1);

    const rested = setup();
    const tired = field(rested.a, "front", eva("045"), true);
    expect(() => rested.act("a", { type: "activate", uid: tired.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("046: 启动主要 rests it, puts 1 WILLE card from the hand into the sideline and draws 1", () => {
    const h = setup();
    const misato = field(h.a, "front", eva("046"));
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    h.a.hand.push(KING, WILLE);
    h.act("a", { type: "activate", uid: misato.uid, ability: 0 });
    expect(misato.rested).toBe(true);
    // only one WILLE card in the hand: no question
    expect(h.game.pending).toBeNull();
    expect(h.a.sideline).toEqual([WILLE]);
    expect(h.a.hand).toEqual([KING, NINE]);
  });

  it("046: asks which WILLE card when there are several; without one in the hand nothing is drawn", () => {
    const h = setup();
    const misato = field(h.a, "front", eva("046"));
    h.a.hand.push(WILLE, KING, WILLE_PLAIN);
    h.act("a", { type: "activate", uid: misato.uid, ability: 0 });
    const options = choice(h.game, "a");
    expect(options.options).toEqual(["h:0", "h:2"]);
    expect(options.min).toBe(1);
    pick(h, "a", ["h:2"]);
    expect(h.a.sideline).toEqual([WILLE_PLAIN]);
    expect(h.a.hand).toHaveLength(3); // 2 left + 1 drawn

    const empty = setup();
    const tired = field(empty.a, "front", eva("046"));
    empty.a.hand.push(KING);
    empty.act("a", { type: "activate", uid: tired.uid, ability: 0 });
    expect(empty.a.hand).toEqual([KING]);
    expect(empty.a.sideline).toEqual([]);
    expect(tired.rested).toBe(true);
  });
});

describe("北上 绿", () => {
  it("047: the required energy is 1 less while the opponent's field has a yellow or red card", () => {
    const h = setup();
    expect(costOf(h.game, h.players, ctx, "a", eva("047")).energy).toBe(3);
    field(h.b, "front", ROSE); // purple
    expect(costOf(h.game, h.players, ctx, "a", eva("047")).energy).toBe(3);
    field(h.b, "energy", NINE); // red
    expect(costOf(h.game, h.players, ctx, "a", eva("047")).energy).toBe(2);
    const second = setup();
    field(second.b, "front", KING); // yellow
    expect(costOf(second.game, second.players, ctx, "a", eva("047")).energy).toBe(2);
  });

  it("047: it can be played with 2 purple energy only while the opponent has a yellow or red card", () => {
    const h = setup();
    power(h, 2);
    h.a.hand.push(eva("047"));
    expect(() => h.act("a", { type: "play", handIndex: 0, line: "front" })).toThrow("NOT_ENOUGH_ENERGY");
    field(h.b, "front", KING);
    h.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(h.a.front.map((card) => card.cardId)).toEqual([eva("047")]);
  });
});

describe("式波·明日香·兰格雷", () => {
  it("049: only the 《冲击无效》 keyword — fully automatic, and a character fighting it takes no Impact damage", () => {
    expect(abilitiesFor(eva("049"))).toEqual([]);
    expect(isAutomated(titleCard(eva("049")))).toBe(true);
    const h = setup("attack");
    const attacker = field(h.a, "front", eva("033")); // BP5000 with 冲击①
    expect(impactOf(ctx, attacker)).toBe(1);
    const asuka = field(h.b, "front", eva("049"));
    h.act("a", { type: "attack", attackerUid: attacker.uid });
    h.act("b", { type: "block", blockerUid: asuka.uid });
    expect(h.b.front).toEqual([]); // sidelined by the battle
    expect(h.game.pending).toBeNull(); // no Impact damage
    expect(h.b.life).toHaveLength(7);

    const plain = setup("attack");
    const attacker2 = field(plain.a, "front", eva("033"));
    const blocker = field(plain.b, "front", KING);
    plain.act("a", { type: "attack", attackerUid: attacker2.uid });
    plain.act("b", { type: "block", blockerUid: blocker.uid });
    expect(plain.game.pending?.kind).toBe("damage"); // Impact damage against an ordinary blocker
  });

  it("050: 启动主要 puts 1 WILLE card from the hand into the sideline, then BP-1000 to up to 1 opposing front-line character (once per turn, on the front line)", () => {
    const h = setup();
    const asuka = field(h.a, "front", eva("050"));
    const target = field(h.b, "front", NINE);
    field(h.b, "energy", KING);
    h.a.hand.push(KING, WILLE);
    h.act("a", { type: "activate", uid: asuka.uid, ability: 0 });
    expect(h.a.sideline).toEqual([WILLE]); // the only WILLE card: no question
    const options = choice(h.game, "a");
    expect(options.options).toEqual([target.uid]);
    expect(options.min).toBe(0);
    pick(h, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(1000);
    expect(() => h.act("a", { type: "activate", uid: asuka.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });

  it("050: picking no target is allowed; without a WILLE card in the hand nothing happens; on the energy line it cannot be used", () => {
    const h = setup();
    const asuka = field(h.a, "front", eva("050"));
    const target = field(h.b, "front", NINE);
    h.a.hand.push(WILLE);
    h.act("a", { type: "activate", uid: asuka.uid, ability: 0 });
    pick(h, "a", []);
    expect(bpOf(ctx, target)).toBe(2000);
    expect(h.a.sideline).toEqual([WILLE]);

    const empty = setup();
    const lone = field(empty.a, "front", eva("050"));
    const other = field(empty.b, "front", NINE);
    empty.a.hand.push(KING);
    empty.act("a", { type: "activate", uid: lone.uid, ability: 0 });
    expect(empty.game.pending).toBeNull();
    expect(bpOf(ctx, other)).toBe(2000);
    expect(empty.a.hand).toEqual([KING]);

    const back = setup();
    const resting = field(back.a, "energy", eva("050"));
    back.a.hand.push(WILLE);
    expect(() => back.act("a", { type: "activate", uid: resting.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
  });

  it("051: BP+1000 on our turn only; 登场时 draws 1", () => {
    const h = setup();
    power(h, 6);
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    const asuka = play(h, eva("051"));
    expect(h.a.hand).toEqual([NINE]);
    expect(bpOf(ctx, asuka)).toBe(5000);
    h.act("a", { type: "end_turn" });
    expect(bpOf(ctx, asuka)).toBe(4000);
  });
});

describe("铃原 樱", () => {
  it("052: 启动主要 rests and sidelines it, then adds a 〈碇 真嗣〉 or WILLE card from the sideline to the hand (it can take itself)", () => {
    const h = setup();
    const sakura = field(h.a, "front", eva("052"));
    h.a.sideline.push(KING, SHINJI_PURPLE, WILLE, SHINJI_YELLOW, eva("001"));
    h.act("a", { type: "activate", uid: sakura.uid, ability: 0 });
    expect(h.a.front).toEqual([]);
    const options = choice(h.game, "a");
    // 碇 真嗣 (both colours), the WILLE card and the card itself; not 弑君者 or 绫波 零
    expect(options.cards).toEqual([SHINJI_PURPLE, WILLE, SHINJI_YELLOW, eva("052")]);
    expect(options.min).toBe(1);
    pick(h, "a", [options.options[1]!]);
    expect(h.a.hand).toEqual([WILLE]);
    expect(h.a.sideline).toEqual([KING, SHINJI_PURPLE, SHINJI_YELLOW, eva("001"), eva("052")]);
  });

  it("052: with nothing else to take it returns itself to the hand", () => {
    const h = setup();
    const sakura = field(h.a, "energy", eva("052"));
    h.a.sideline.push(KING);
    h.act("a", { type: "activate", uid: sakura.uid, ability: 0 });
    expect(h.game.pending).toBeNull();
    expect(h.a.hand).toEqual([eva("052")]);
    expect(h.a.sideline).toEqual([KING]);
  });
});

describe("AAA Wunder", () => {
  /** a plays AAA Wunder (4 energy) and makes it active; b has an active blocker. */
  function wunderAttacking() {
    const h = setup();
    power(h, 4);
    const blocker = field(h.b, "front", KING);
    const wunder = play(h, eva("053"));
    h.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: wunder.uid, act: "activate" } });
    h.act("a", { type: "next_phase" });
    return { h, wunder, blocker };
  }

  it("053: 登场时 the opponent must block its attack when able: not blocking is refused, also for the computer players", () => {
    const { h, wunder, blocker } = wunderAttacking();
    expect(flagsOf(wunder)).toContain("mustBeBlocked");
    h.act("a", { type: "attack", attackerUid: wunder.uid });
    expect(h.game.pending?.kind).toBe("block");
    expect(() => h.act("b", { type: "block", blockerUid: null })).toThrow("MUST_BLOCK");
    expect(h.game.pending?.kind).toBe("block"); // still waiting for the block
    const legal = legalActions(h.game, h.players, ctx, "b");
    expect(legal).toEqual([{ type: "block", blockerUid: blocker.uid }]);
    h.act("b", { type: "block", blockerUid: blocker.uid });
    expect(h.b.front).toEqual([]); // BP4000 beats BP1500
  });

  it("053: nothing to block with (resting) means the attack goes through; without the mark (not played this turn) not blocking is allowed", () => {
    const { h, wunder, blocker } = wunderAttacking();
    blocker.rested = true;
    h.act("a", { type: "attack", attackerUid: wunder.uid });
    expect(h.game.pending?.kind).toBe("damage");

    const plain = setup("attack");
    const placed = field(plain.a, "front", eva("053"));
    field(plain.b, "front", KING);
    plain.act("a", { type: "attack", attackerUid: placed.uid });
    expect(legalActions(plain.game, plain.players, ctx, "b")).toContainEqual({ type: "block", blockerUid: null });
    plain.act("b", { type: "block", blockerUid: null });
    expect(plain.game.pending?.kind).toBe("damage");
  });

  it("053: the mark lasts only this turn", () => {
    const { h, wunder } = wunderAttacking();
    h.act("a", { type: "end_turn" });
    expect(flagsOf(wunder)).not.toContain("mustBeBlocked");
  });

  it("053: 退场时 looks at 5, adds up to 2 cards with cost 5 or more to the hand, the rest go to the bottom in a chosen order", () => {
    const h = setup();
    const wunder = field(h.a, "front", eva("053"));
    h.a.library = [eva("031"), eva("042"), eva("051"), KING, NINE, ...Array(25).fill(FILLER)];
    h.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: wunder.uid, act: "sideline" } });
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([eva("031"), eva("042"), eva("051")]); // cost 5, 5 and 6
    expect(options.max).toBe(2);
    pick(h, "a", [options.options[0]!, options.options[2]!]);
    expect(h.a.hand).toEqual([eva("031"), eva("051")]);
    const order = choice(h.game, "a");
    expect(order.cards).toEqual([eva("042"), KING, NINE]);
    pick(h, "a", [order.options[2]!, order.options[0]!, order.options[1]!]);
    expect(h.a.library).toHaveLength(28);
    expect(h.a.library.slice(-3)).toEqual([NINE, eva("042"), KING]);
    expect(h.game.pending).toBeNull();
  });

  it("053: 退场时 — picking none (or nothing eligible) adds nothing", () => {
    const h = setup();
    const wunder = field(h.a, "front", eva("053"));
    h.a.library = [eva("031"), KING, NINE, ROSE, KING, ...Array(25).fill(FILLER)];
    h.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: wunder.uid, act: "sideline" } });
    pick(h, "a", []);
    pick(h, "a", choice(h.game, "a").options);
    expect(h.a.hand).toEqual([]);
    expect(h.a.library).toHaveLength(30);

    const none = setup();
    const lone = field(none.a, "front", eva("053"));
    none.a.library = [KING, NINE, ROSE, KING, NINE, ...Array(25).fill(FILLER)];
    none.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: lone.uid, act: "sideline" } });
    expect(choice(none.game, "a").purpose).toBe("target"); // only the order of the five
    pick(none, "a", choice(none.game, "a").options);
    expect(none.a.hand).toEqual([]);
  });
});

describe("真希波·真理·伊拉丝多莉亚斯", () => {
  it("055: 登场时 looks at 3, adds up to 1 WILLE card to the hand, the rest go to the bottom, then discard 1", () => {
    const h = setup();
    power(h, 1);
    h.a.library = [NINE, WILLE, KING, ...Array(27).fill(FILLER)];
    h.a.hand.push(ROSE);
    play(h, eva("055"));
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([WILLE]);
    pick(h, "a", [options.options[0]!]);
    const order = choice(h.game, "a");
    expect(order.cards).toEqual([NINE, KING]);
    pick(h, "a", [order.options[1]!, order.options[0]!]);
    expect(h.a.library.slice(-2)).toEqual([KING, NINE]);
    expect(h.a.library).toHaveLength(29);
    expect(h.a.hand).toEqual([ROSE, WILLE]);
    pick(h, "a", ["h:0"]);
    expect(h.a.hand).toEqual([WILLE]);
    expect(h.a.sideline).toEqual([ROSE]);
  });

  it("055: picking none adds nothing and discards nothing", () => {
    const h = setup();
    power(h, 1);
    h.a.library = [NINE, WILLE, KING, ...Array(27).fill(FILLER)];
    h.a.hand.push(ROSE);
    play(h, eva("055"));
    pick(h, "a", []);
    pick(h, "a", choice(h.game, "a").options);
    expect(h.a.hand).toEqual([ROSE]);
    expect(h.a.sideline).toEqual([]);
    expect(h.a.library).toHaveLength(30);
  });

  it("056: 启动主要 (only in the turn it came onto the field, once) gives a WILLE character 'when attacking and unblocked, draw up to 1' this turn", () => {
    const h = setup();
    power(h, 3);
    h.a.library = [NINE, ROSE, ...Array(28).fill(FILLER)];
    const mari = play(h, eva("056"));
    const ally = field(h.a, "front", WILLE);
    h.act("a", { type: "activate", uid: mari.uid, ability: 0 });
    const options = choice(h.game, "a");
    expect(options.options).toEqual([mari.uid, ally.uid]); // both are WILLE characters
    expect(options.min).toBe(1);
    pick(h, "a", [ally.uid]);
    expect(ally.grantedAbilities).toEqual([{ cardId: eva("056"), index: 1 }]);
    expect(() => h.act("a", { type: "activate", uid: mari.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    h.act("a", { type: "next_phase" });
    h.act("a", { type: "attack", attackerUid: ally.uid });
    // b has no blocker, so the attack is unblocked: the given ability asks whether to draw
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    expect(h.a.hand).toEqual([NINE]);
    expect(h.game.pending?.kind).toBe("damage");
  });

  it("056: given to a character that is blocked, nothing is drawn", () => {
    const h = setup();
    power(h, 3);
    const mari = play(h, eva("056"));
    const ally = field(h.a, "front", WILLE);
    const blocker = field(h.b, "front", KING);
    h.act("a", { type: "activate", uid: mari.uid, ability: 0 });
    pick(h, "a", [ally.uid]);
    h.act("a", { type: "next_phase" });
    h.act("a", { type: "attack", attackerUid: ally.uid });
    h.act("b", { type: "block", blockerUid: blocker.uid });
    expect(h.game.pending).toBeNull();
    expect(h.a.hand).toEqual([]);
  });

  it("056: declining the draw draws nothing", () => {
    const h = setup();
    power(h, 3);
    const mari = play(h, eva("056"));
    const ally = field(h.a, "front", WILLE);
    h.act("a", { type: "activate", uid: mari.uid, ability: 0 });
    pick(h, "a", [ally.uid]);
    h.act("a", { type: "next_phase" });
    h.act("a", { type: "attack", attackerUid: ally.uid });
    pick(h, "a", ["no"]);
    expect(h.a.hand).toEqual([]);
    expect(h.game.pending?.kind).toBe("damage");
  });

  it("056: it cannot be used when the card did not come onto the field this turn", () => {
    const h = setup();
    const mari = field(h.a, "front", eva("056")); // already there, no entry for this turn
    expect(() => h.act("a", { type: "activate", uid: mari.uid, ability: 0 })).toThrow("ABILITY_CONDITION");

    const later = setup();
    power(later, 3);
    const played = play(later, eva("056"));
    later.act("a", { type: "end_turn" });
    toMainOf(later, "a");
    expect(later.game.turnPlayerId).toBe("a");
    expect(() => later.act("a", { type: "activate", uid: played.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
  });

  it("057: 攻击时 may discard 1 hand card to put a purple 〈碇 真嗣〉 (cost 3 or less, AP1) from the sideline onto the field resting", () => {
    const h = setup("attack");
    const mari = field(h.a, "front", eva("057"));
    h.a.hand.push(KING, NINE);
    // eligible: purple 真嗣 cost 0 (027), cost 3 (030) and 031 (printed 5, but 3 in the sideline: "手牌中与场外存在的此卡牌的所需能量减少[紫×2]");
    // not: the yellow one (073) or a card that is not 碇 真嗣
    h.a.sideline.push(SHINJI_PURPLE, eva("031"), SHINJI_YELLOW, eva("030"), eva("037"));
    h.act("a", { type: "attack", attackerUid: mari.uid });
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    const discard = choice(h.game, "a");
    expect(discard.options).toEqual(["h:0", "h:1"]);
    pick(h, "a", ["h:0"]);
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([SHINJI_PURPLE, eva("031"), eva("030")]);
    expect(options.min).toBe(0);
    pick(h, "a", [options.options[1]!]);
    pick(h, "a", ["line:front"]);
    const shinji = h.a.front[h.a.front.length - 1]!;
    expect(shinji.cardId).toBe(eva("031"));
    expect(shinji.rested).toBe(true);
    expect(h.a.hand).toEqual([NINE]);
    expect(h.a.sideline).toEqual([SHINJI_PURPLE, SHINJI_YELLOW, eva("030"), eva("037"), KING]);
  });

  it("057: the discarded card itself can be the 〈碇 真嗣〉 that comes back; answering no, picking none, or an empty hand does nothing", () => {
    const h = setup("attack");
    const mari = field(h.a, "front", eva("057"));
    h.a.hand.push(SHINJI_PURPLE, KING);
    h.act("a", { type: "attack", attackerUid: mari.uid });
    pick(h, "a", ["yes"]);
    pick(h, "a", ["h:0"]);
    expect(choice(h.game, "a").cards).toEqual([SHINJI_PURPLE]);
    pick(h, "a", []);
    expect(h.a.front).toEqual([mari]);
    expect(h.a.hand).toEqual([KING]);

    const no = setup("attack");
    const mari2 = field(no.a, "front", eva("057"));
    no.a.hand.push(KING);
    no.a.sideline.push(SHINJI_PURPLE);
    no.act("a", { type: "attack", attackerUid: mari2.uid });
    pick(no, "a", ["no"]);
    expect(no.a.hand).toEqual([KING]);
    expect(no.a.front).toEqual([mari2]);

    const empty = setup("attack");
    const mari3 = field(empty.a, "front", eva("057"));
    empty.a.sideline.push(SHINJI_PURPLE);
    empty.act("a", { type: "attack", attackerUid: mari3.uid });
    expect(empty.game.pending?.kind).toBe("damage"); // no question at all
    expect(empty.a.front).toEqual([mari3]);
  });
});

describe("莉莉丝", () => {
  it("058: 登场时 puts the top 2 cards of the deck face down under this site", () => {
    const h = setup();
    power(h, 2);
    h.a.library = [NINE, ROSE, ...Array(28).fill(FILLER)];
    const lilith = play(h, eva("058"), "energy");
    expect(lilith.faceDown).toEqual([NINE, ROSE]);
    expect(h.a.library).toHaveLength(28);
  });

  it("058: 启动主要 (rest) works only while nothing is face down under it, and sidelines the site", () => {
    const h = setup();
    const lilith = field(h.a, "energy", eva("058"));
    lilith.faceDown = [KING];
    expect(() => h.act("a", { type: "activate", uid: lilith.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    lilith.faceDown = [];
    h.act("a", { type: "activate", uid: lilith.uid, ability: 1 });
    expect(h.a.energy).toEqual([]);
    expect(h.a.sideline).toEqual([eva("058")]);
    const resting = setup();
    const tired = field(resting.a, "energy", eva("058"), true);
    expect(() => resting.act("a", { type: "activate", uid: tired.uid, ability: 1 })).toThrow("ABILITY_COST");
  });

  it("058: 退场时 adds up to 1 character from the sideline to the hand; in our turn we may discard 1 hand card to switch up to 1 AP card to active", () => {
    const h = setup();
    const lilith = field(h.a, "energy", eva("058"));
    h.a.ap[0]!.rested = true;
    h.a.sideline.push(KING, WILLE, eva("059")); // 059 is an event: not a character
    h.a.hand.push(NINE);
    h.act("a", { type: "activate", uid: lilith.uid, ability: 1 });
    const characters = choice(h.game, "a");
    expect(characters.cards).toEqual([KING, WILLE]);
    expect(characters.min).toBe(0);
    pick(h, "a", [characters.options[1]!]);
    expect(h.a.hand).toEqual([NINE, WILLE]);
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    pick(h, "a", ["h:0"]);
    const aps = choice(h.game, "a");
    expect(aps.options).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
    pick(h, "a", ["ap:a:ap0"]);
    expect(h.a.ap[0]!.rested).toBe(false);
    expect(h.a.hand).toEqual([WILLE]);
    expect(h.a.sideline).toEqual([KING, eva("059"), eva("058"), NINE]);
  });

  it("058: 退场时 — answering no, or being sidelined in the opponent's turn, gives the character but no AP; picking none adds nothing", () => {
    const h = setup();
    const lilith = field(h.a, "energy", eva("058"));
    h.a.ap[0]!.rested = true;
    h.a.sideline.push(KING);
    h.a.hand.push(NINE);
    h.act("a", { type: "activate", uid: lilith.uid, ability: 1 });
    pick(h, "a", ["s:0"]);
    pick(h, "a", ["no"]);
    expect(h.a.hand).toEqual([NINE, KING]);
    expect(h.a.ap[0]!.rested).toBe(true);
    expect(h.game.pending).toBeNull();

    const theirs = setup("main", "b");
    const site = field(theirs.a, "energy", eva("058"));
    theirs.a.sideline.push(KING, ROSE);
    theirs.a.hand.push(NINE);
    theirs.act("b", { type: "manual", manual: { op: "field", owner: "opponent", uid: site.uid, act: "sideline" } });
    const options = choice(theirs.game, "a");
    expect(options.options).toEqual(["s:0", "s:1"]);
    pick(theirs, "a", ["s:1"]);
    expect(theirs.game.pending).toBeNull(); // not our turn: no discard / AP question
    expect(theirs.a.hand).toEqual([NINE, ROSE]);

    const none = setup();
    const lone = field(none.a, "energy", eva("058"));
    none.a.sideline.push(KING);
    none.act("a", { type: "activate", uid: lone.uid, ability: 1 });
    pick(none, "a", []);
    expect(none.a.hand).toEqual([]);
    expect(none.game.pending).toBeNull(); // empty hand: no discard question
  });
});

describe("events", () => {
  it("059: switches up to 2 of our AP cards to active (picking fewer is allowed)", () => {
    const h = setup();
    power(h, 3);
    h.a.ap[1]!.rested = true;
    h.a.ap[2]!.rested = true;
    useEvent(h, eva("059")); // pays 1 AP: ap0 rests
    const options = choice(h.game, "a");
    expect(options.options).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
    expect(options.min).toBe(0);
    expect(options.max).toBe(2);
    pick(h, "a", ["ap:a:ap0", "ap:a:ap2"]);
    expect(h.a.ap.map((card) => card.rested)).toEqual([false, true, false]);
    expect(h.a.sideline).toEqual([eva("059")]);

    const none = setup();
    power(none, 3);
    useEvent(none, eva("059"));
    pick(none, "a", []);
    expect(none.a.ap.map((card) => card.rested)).toEqual([true, false, false]);
    expect(none.a.ap.filter((card) => !card.rested)).toHaveLength(2);
  });

  it("060: rests one of our active front-line characters, then draws 3", () => {
    const h = setup();
    power(h, 4);
    h.a.library = [NINE, ROSE, KING, ...Array(27).fill(FILLER)];
    const first = field(h.a, "front", KING);
    const second = field(h.a, "front", NINE);
    field(h.a, "front", ROSE, true); // already resting: not eligible
    field(h.a, "energy", ROSE); // not on the front line
    useEvent(h, eva("060"));
    const options = choice(h.game, "a");
    expect(options.options).toEqual([first.uid, second.uid]);
    expect(options.min).toBe(1);
    pick(h, "a", [second.uid]);
    expect(second.rested).toBe(true);
    expect(first.rested).toBe(false);
    expect(h.a.hand).toEqual([NINE, ROSE, KING]);
  });

  it("060: without an active front-line character nothing is rested and nothing is drawn", () => {
    const h = setup();
    power(h, 4);
    field(h.a, "front", KING, true);
    useEvent(h, eva("060"));
    expect(h.game.pending).toBeNull();
    expect(h.a.hand).toEqual([]);
    expect(h.a.sideline).toEqual([eva("060")]);
  });

  it("061: BP-3000 to up to 1 opposing front-line character and BP-1000 to up to 1 (each may be none or the same one)", () => {
    const h = setup();
    power(h, 4);
    const big = field(h.b, "front", eva("041")); // BP4000
    const mid = field(h.b, "front", eva("036")); // BP3500
    field(h.b, "energy", NINE);
    useEvent(h, eva("061"));
    const first = choice(h.game, "a");
    expect(first.options).toEqual([big.uid, mid.uid]);
    expect(first.min).toBe(0);
    pick(h, "a", [big.uid]);
    expect(bpOf(ctx, big)).toBe(1000);
    const second = choice(h.game, "a");
    expect(second.options).toEqual([big.uid, mid.uid]);
    pick(h, "a", [mid.uid]);
    expect(bpOf(ctx, mid)).toBe(2500);

    const none = setup();
    power(none, 4);
    const target = field(none.b, "front", eva("041"));
    field(none.b, "front", NINE);
    useEvent(none, eva("061"));
    pick(none, "a", []);
    pick(none, "a", []);
    expect(bpOf(ctx, target)).toBe(4000);

    const same = setup();
    power(same, 4);
    const both = field(same.b, "front", eva("041"));
    field(same.b, "front", NINE);
    useEvent(same, eva("061"));
    pick(same, "a", [both.uid]);
    pick(same, "a", [both.uid]);
    expect(bpOf(ctx, both)).toBe(0);
    expect(same.b.front.map((card) => card.cardId)).toEqual([NINE]); // BP 0: sidelined
  });

  it("062: puts a purple 〈碇 真嗣〉 from our sideline onto the field resting", () => {
    const h = setup();
    power(h, 3);
    h.a.sideline.push(SHINJI_YELLOW, KING, eva("029"));
    useEvent(h, eva("062"));
    // only the purple one qualifies (the yellow 碇 真嗣 does not): no question, then the line
    pick(h, "a", ["line:energy"]);
    const shinji = h.a.energy[h.a.energy.length - 1]!;
    expect(shinji.cardId).toBe(eva("029"));
    expect(shinji.rested).toBe(true);
    expect(h.a.sideline).toEqual([SHINJI_YELLOW, KING, eva("062")]);
  });

  it("062: asks which one when several purple copies are in the sideline; with none nothing happens", () => {
    const h = setup();
    power(h, 3);
    h.a.sideline.push(eva("027"), eva("030"));
    useEvent(h, eva("062"));
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([eva("027"), eva("030")]);
    expect(options.min).toBe(1);
    pick(h, "a", [options.options[1]!]);
    pick(h, "a", ["line:front"]);
    expect(h.a.front.map((card) => card.cardId)).toEqual([eva("030")]);
    expect(h.a.front[0]!.rested).toBe(true);

    const none = setup();
    power(none, 3);
    none.a.sideline.push(SHINJI_YELLOW, KING);
    useEvent(none, eva("062"));
    expect(none.game.pending).toBeNull();
    expect(none.a.front).toEqual([]);
  });
});
