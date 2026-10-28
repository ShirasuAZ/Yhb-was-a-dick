/**
 * EVA batch 3 (UC03BT/EVA-1-063 ... 088): one test per card (more for cards with several abilities), set up as the printed text describes and
 * checked against it. Cards are addressed by card number through the shared harness.
 *
 * DATA NOTE: cards.json lists the red cards of this set (068 on) as yellow characters with required energy 0 and no energy production. The
 * abilities read such a card as red; the tests that depend on a required energy `patch` it (restored after each test).
 */
import { afterEach, describe, expect, it } from "vitest";
import { applyAction, bpOf, costOf, damageOf, energyOf, flagsOf, impactOf } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { abilitiesFor, isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { EVA_3_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-eva-3.ts";
import type { UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { loadTitleCards } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { choice, ctx, field, setup } from "./ability-harness.ts";

const eva = (n: string): string => `UC03BT/EVA-1-${n}`;
const FILLER = "UC01BT/ARK-1-004"; // yellow, cost 0, BP1500, trigger 获得, no ability (also the deck filler)
const TALULA = "UC01BT/ARK-1-014"; // yellow, cost 2, BP2500, no trigger (ability: energy)
const PLAIN = eva("076"); // 伊吹 摩耶: red, no trigger, BP3000, only a cost cut
const PLAIN_B = eva("086"); // 式波: red, no trigger, BP2000, only 《冲击无效》
const SHINJI_PURPLE = eva("027"); // 碇 真嗣, purple, trigger 抽卡
const REI_YELLOW = eva("001"); // 绫波 零, really yellow (it has an energy colour), cost 0
const PE = "UCEX01BT/ARK-2-055"; // a purple site that makes 1 energy (see `power`)

type Harness = ReturnType<typeof setup>;
const cards = loadTitleCards();
const titleCard = (number: string) => cards.find((entry) => entry.number === number)!;

// ---- Patching the printed data of a card for one test ----

type Printed = { color: string; energyCost: number };
const originals = new Map<string, Printed>();
/** Gives a card an assumed colour / required energy (cards.json has neither for the red cards); undone after the test. */
function patch(number: string, values: Partial<Printed>): void {
  const stats = ctx.card(number) as unknown as Printed;
  if (!originals.has(number)) originals.set(number, { color: stats.color, energyCost: stats.energyCost });
  Object.assign(stats, values);
}
afterEach(() => {
  for (const [number, printed] of originals) Object.assign(ctx.card(number) as unknown as Printed, printed);
  originals.clear();
});

// ---- Helpers ----

/** Puts `number` into the hand and plays it from there; returns the field card. */
function play(h: Harness, number: string, line: "front" | "energy" = "front"): UnionArenaFieldCard {
  h.a.hand.push(number);
  h.act("a", { type: "play", handIndex: h.a.hand.length - 1, line });
  return h.a[line][h.a[line].length - 1]!;
}
function useEvent(h: Harness, number: string): void {
  h.a.hand.push(number);
  h.act("a", { type: "event", handIndex: h.a.hand.length - 1 });
}
/** `count` purple energy (the events of this batch are purple): one purple site on the energy line whose energy is raised. */
function power(h: Harness, count: number, who: "a" | "b" = "a"): UnionArenaFieldCard {
  const site = field(h[who], "energy", PE);
  site.energyMod = count - 1;
  return site;
}
const pick = (h: Harness, who: "a" | "b", picks: string[]): void => h.act(who, { type: "choose", picks });
/** A harmless action that makes the engine recompute continuous effects. */
const refresh = (h: Harness): void => h.act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "activate" } });
const deck = (...top: string[]): string[] => [...top, ...Array(30 - top.length).fill(FILLER)];
/** Passes turns until `who`'s main phase has begun. */
function toMainOf(h: Harness, who: "a" | "b"): void {
  for (let guard = 0; guard < 12 && !(h.game.turnPlayerId === who && h.game.phase === "main"); guard += 1) {
    const turn = h.game.turnPlayerId as "a" | "b";
    if (turn === who) h.act(turn, { type: "next_phase" });
    else if (h.game.phase === "main" || h.game.phase === "attack") h.act(turn, { type: "end_turn" });
    else h.act(turn, { type: "next_phase" });
  }
}
/** `a` attacks with `uid` (nobody blocks); `a` picks b's first life card and `b` does not use its trigger. */
function strike(h: Harness, uid: string, damage = 1): void {
  h.act("a", { type: "attack", attackerUid: uid });
  if (h.game.pending?.kind === "block") h.act("b", { type: "block", blockerUid: null });
  const lives = h.b.life.slice(0, damage);
  h.act("a", { type: "damage", lifeIds: lives.map((life) => life.id) });
  for (const life of lives) h.act("b", { type: "trigger", lifeId: life.id, activate: false });
}
const apRested = (h: Harness): number => h.a.ap.filter((card) => card.rested).length;
/** The 087 effect has not been used this turn. */
const notMarked = (h: Harness): boolean => !(h.game.turnMarks ?? []).some((mark) => mark.endsWith("式波·明日香·兰格雷:BP+2000"));

describe("EVA batch 3: the table", () => {
  it("lists every card of the batch except 075 as automated, and the names the filters rely on", () => {
    expect(Object.keys(EVA_3_ABILITIES)).toHaveLength(24);
    for (const number of Object.keys(EVA_3_ABILITIES)) expect(isAutomated(titleCard(number)), number).toBe(true);
    expect(titleCard(eva("027")).name).toBe("碇 真嗣");
    expect(titleCard(eva("033")).name).toBe("新世纪福音战士初号机（盖乌斯之枪）");
    expect(titleCard(eva("034")).name).toBe("新世纪福音战士13号机");
    expect(titleCard(eva("069")).name).toBe("绫波 零");
    expect(titleCard(eva("086")).name).toBe("式波·明日香·兰格雷");
  });

  it("075 stays manual: its 【启动主要】 is used from the sideline, which the engine cannot do", () => {
    expect(abilitiesFor(eva("075"))).toBeUndefined();
    expect(isAutomated(titleCard(eva("075")))).toBe(false);
  });
});

describe("盖乌斯之枪", () => {
  it("063: the target choice offers only BP 3000 or less; afterwards 1 card is drawn and 1 hand card is discarded", () => {
    const h = setup();
    h.a.library = deck(PLAIN_B);
    const low = field(h.b, "front", PLAIN); // 3000
    const low2 = field(h.b, "front", eva("085")); // 2500
    const high = field(h.b, "front", eva("078")); // 4000
    h.a.hand.push(TALULA);
    useEvent(h, eva("063"));
    const options = choice(h.game, "a");
    expect(options.options).toEqual([low.uid, low2.uid]);
    expect(options.min).toBe(1);
    pick(h, "a", [low2.uid]);
    expect(h.b.front).toEqual([low, high]);
    expect(h.b.sideline).toEqual([eva("085")]);
    expect(h.a.hand).toEqual([TALULA, PLAIN_B]); // drew the top card
    const discard = choice(h.game, "a");
    expect(discard.options).toEqual(["h:0", "h:1"]);
    pick(h, "a", ["h:0"]);
    expect(h.a.hand).toEqual([PLAIN_B]);
    expect(h.a.sideline).toEqual([TALULA, eva("063")]); // the discarded card, then the event itself after it resolved
  });

  it("063: with 〈碇 真嗣〉 or 〈初号机（盖乌斯之枪）〉 on our field the limit is 5000", () => {
    for (const helper of [SHINJI_PURPLE, eva("033")]) {
      const h = setup();
      field(h.a, "energy", helper);
      const four = field(h.b, "front", eva("078")); // 4000
      field(h.b, "front", eva("079")); // 5000 + ... not on our turn? its BP is 5000 (its bonus is on its owner's turn only)
      useEvent(h, eva("063"));
      const options = choice(h.game, "a");
      expect(options.options).toContain(four.uid);
      expect(options.options).toHaveLength(2);
    }
    const plain = setup();
    const four = field(plain.b, "front", eva("078"));
    useEvent(plain, eva("063"));
    expect(plain.game.pending).toBeNull(); // no valid target: nothing to choose, the effect only draws and discards
    expect(plain.b.front).toEqual([four]);
    expect(plain.a.hand).toEqual([]); // drew 1 and had to discard it
  });
});

describe("收到收到 / 我知道这很乱来", () => {
  for (const number of ["064", "067"]) {
    it(`${number}: activates up to 2 chosen AP cards (picking none is allowed)`, () => {
      const h = setup();
      power(h, 3);
      h.a.ap[0]!.rested = true;
      h.a.ap[1]!.rested = true;
      useEvent(h, eva(number)); // pays 1 AP (the third)
      expect(apRested(h)).toBe(3);
      const options = choice(h.game, "a");
      expect(options.min).toBe(0);
      expect(options.max).toBe(2);
      pick(h, "a", ["ap:a:ap0", "ap:a:ap2"]);
      expect(h.a.ap.map((card) => card.rested)).toEqual([false, true, false]);

      const none = setup();
      power(none, 3);
      none.a.ap[0]!.rested = true;
      useEvent(none, eva(number));
      pick(none, "a", []);
      expect(apRested(none)).toBe(2);
    });
  }
});

describe("绝望之枪朗基努斯", () => {
  it("065: costs 1 less AP while 〈碇 真嗣〉 or 〈13号机〉 is on our field", () => {
    const h = setup();
    expect(costOf(h.game, h.players, ctx, "a", eva("065")).ap).toBe(2);
    field(h.a, "energy", SHINJI_PURPLE);
    expect(costOf(h.game, h.players, ctx, "a", eva("065")).ap).toBe(1);
    const other = setup();
    field(other.a, "front", eva("034"));
    expect(costOf(other.game, other.players, ctx, "a", eva("065")).ap).toBe(1);
    const unrelated = setup();
    field(unrelated.a, "front", PLAIN);
    expect(costOf(unrelated.game, unrelated.players, ctx, "a", eva("065")).ap).toBe(2);
    // and the AP is really paid
    field(h.b, "front", eva("078"));
    power(h, 4);
    useEvent(h, eva("065"));
    expect(apRested(h)).toBe(1);
  });

  it("065: sidelines an opposing front-line character with BP 5000 or less", () => {
    const h = setup();
    const four = field(h.b, "front", eva("078")); // 4000
    const five = field(h.b, "front", eva("079")); // 5000
    const big = field(h.b, "front", TALULA);
    big.bpMod = 4000; // 6500
    power(h, 4);
    useEvent(h, eva("065"));
    const options = choice(h.game, "a");
    expect(options.options).toEqual([four.uid, five.uid]);
    pick(h, "a", [five.uid]);
    expect(h.b.front).toEqual([four, big]);
    expect(h.b.sideline).toEqual([eva("079")]);
    expect(apRested(h)).toBe(2);
  });
});

describe("哼。那样子连笨蛋都算不上…只是个小鬼嘛", () => {
  it("066: BP-1000 to an opposing front-line character, then up to 1 AP card active (none is allowed)", () => {
    const h = setup();
    const target = field(h.b, "front", PLAIN);
    const other = field(h.b, "front", PLAIN_B);
    field(h.b, "energy", PLAIN_B);
    power(h, 2);
    h.a.ap[0]!.rested = true;
    useEvent(h, eva("066")); // pays ap1
    const options = choice(h.game, "a");
    expect(options.options).toEqual([target.uid, other.uid]);
    expect(options.min).toBe(1);
    pick(h, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(2000);
    expect(bpOf(ctx, other)).toBe(2000);
    const ap = choice(h.game, "a");
    expect(ap.min).toBe(0);
    expect(ap.max).toBe(1);
    pick(h, "a", ["ap:a:ap0"]);
    expect(h.a.ap.map((card) => card.rested)).toEqual([false, true, false]);

    const none = setup();
    field(none.b, "front", PLAIN);
    power(none, 2);
    none.a.ap[0]!.rested = true;
    useEvent(none, eva("066"));
    pick(none, "a", []);
    expect(none.a.ap.map((card) => card.rested)).toEqual([true, true, false]);
  });
});

describe("赤木 律子", () => {
  it("068: while active it produces 1 more red energy on the energy line (none while resting)", () => {
    const h = setup();
    const ritsuko = field(h.a, "energy", eva("068"));
    refresh(h);
    expect(energyOf(ctx, h.a, "red")).toBe(1);
    ritsuko.rested = true;
    refresh(h);
    expect(energyOf(ctx, h.a, "red")).toBe(0);
  });
});

describe("绫波 零", () => {
  it("069: 启动主要 (rest, once per turn) gives +1 red energy this turn and sidelines this character when the main phase ends", () => {
    const h = setup();
    const rei = field(h.a, "energy", eva("069"));
    h.act("a", { type: "activate", uid: rei.uid, ability: 0 });
    expect(rei.rested).toBe(true);
    expect(energyOf(ctx, h.a, "red")).toBe(1);
    expect(() => h.act("a", { type: "activate", uid: rei.uid, ability: 0 })).toThrow();
    h.act("a", { type: "next_phase" }); // main phase ends
    expect(h.a.energy).toEqual([]);
    expect(h.a.sideline).toEqual([eva("069")]);
    expect(energyOf(ctx, h.a, "red")).toBe(0);
  });

  it("070: 登场时 looks at the top 3 cards, may put 1 into the sideline and puts the rest back on top in the chosen order", () => {
    const h = setup();
    const [x, y, z] = [PLAIN, PLAIN_B, TALULA];
    h.a.library = deck(x, y, z);
    play(h, eva("070"));
    const out = choice(h.game, "a");
    expect(out.cards).toEqual([x, y, z]);
    expect(out.min).toBe(0);
    expect(out.max).toBe(1);
    pick(h, "a", ["l:1"]);
    expect(h.a.sideline).toEqual([y]);
    const order = choice(h.game, "a");
    expect(order.cards).toEqual([x, z]);
    pick(h, "a", ["l:1", "l:0"]);
    expect(h.a.library.slice(0, 3)).toEqual([z, x, FILLER]);
    expect(h.a.library).toHaveLength(29);
  });

  it("070: picking none puts all 3 back on top", () => {
    const h = setup();
    h.a.library = deck(PLAIN, PLAIN_B, TALULA);
    play(h, eva("070"));
    pick(h, "a", []);
    pick(h, "a", ["l:0", "l:1", "l:2"]);
    expect(h.a.sideline).toEqual([]);
    expect(h.a.library.slice(0, 3)).toEqual([PLAIN, PLAIN_B, TALULA]);
    expect(h.a.library).toHaveLength(30);
  });

  it("071: 《冲击无效》 is kept; 启动主要 needs 2 red 〈绫波 零〉 with different required energy in the sideline", () => {
    expect(titleCard(eva("071")).stats.keywords).toEqual(["冲击无效"]);
    patch(eva("069"), { color: "red", energyCost: 1 });
    patch(eva("070"), { color: "red", energyCost: 1 });
    patch(eva("071"), { color: "red", energyCost: 2 });
    const h = setup();
    const rei = field(h.a, "energy", eva("071"));
    // same required energy twice, a yellow 〈绫波 零〉 and a red card of another name: not enough kinds
    h.a.sideline.push(eva("069"), eva("070"), REI_YELLOW, PLAIN);
    expect(() => h.act("a", { type: "activate", uid: rei.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    h.a.sideline.push(eva("071"));
    h.act("a", { type: "activate", uid: rei.uid, ability: 0 });
    expect(energyOf(ctx, h.a, "red")).toBe(1);
    expect(() => h.act("a", { type: "activate", uid: rei.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });

  it("071: the extra energy lasts through the opponent's turn and ends when our next turn starts", () => {
    patch(eva("069"), { color: "red", energyCost: 1 });
    patch(eva("071"), { color: "red", energyCost: 2 });
    const h = setup();
    const rei = field(h.a, "energy", eva("071"));
    h.a.sideline.push(eva("069"), eva("071"));
    h.act("a", { type: "activate", uid: rei.uid, ability: 0 });
    h.act("a", { type: "end_turn" });
    expect(energyOf(ctx, h.a, "red")).toBe(1); // the opponent's turn
    toMainOf(h, "a");
    expect(energyOf(ctx, h.a, "red")).toBe(0);
  });
});

describe("碇 源堂&冬月 耕造", () => {
  it("072: 启动主要 (rest) draws 1 card and puts 1 hand card into the sideline", () => {
    const h = setup();
    const pair = field(h.a, "front", eva("072"));
    h.a.library = deck(PLAIN_B);
    h.a.hand.push(TALULA);
    h.act("a", { type: "activate", uid: pair.uid, ability: 0 });
    expect(pair.rested).toBe(true);
    expect(h.a.hand).toEqual([TALULA, PLAIN_B]);
    pick(h, "a", ["h:1"]);
    expect(h.a.hand).toEqual([TALULA]);
    expect(h.a.sideline).toEqual([PLAIN_B]);
    expect(() => h.act("a", { type: "activate", uid: pair.uid, ability: 0 })).toThrow(); // resting: the cost cannot be paid
  });
});

describe("碇 真嗣", () => {
  it("074: costs 2 less required energy while we have no card on our field", () => {
    patch(eva("074"), { color: "red", energyCost: 3 });
    const h = setup();
    expect(costOf(h.game, h.players, ctx, "a", eva("074")).energy).toBe(1);
    field(h.a, "front", PLAIN);
    expect(costOf(h.game, h.players, ctx, "a", eva("074")).energy).toBe(3);
    const energyOnly = setup();
    field(energyOnly.a, "energy", PLAIN);
    expect(costOf(energyOnly.game, energyOnly.players, ctx, "a", eva("074")).energy).toBe(3); // any card on the field, either line
  });

  it("074: 登场时 looks at the top card and puts it into the sideline or back on top", () => {
    const h = setup();
    h.a.library = deck(PLAIN, PLAIN_B);
    play(h, eva("074"));
    const out = choice(h.game, "a");
    expect(out.cards).toEqual([PLAIN]);
    expect(out.min).toBe(0);
    pick(h, "a", ["l:0"]);
    expect(h.a.sideline).toEqual([PLAIN]);
    expect(h.a.library[0]).toBe(PLAIN_B);
    expect(h.game.pending).toBeNull();

    const keep = setup();
    keep.a.library = deck(PLAIN, PLAIN_B);
    play(keep, eva("074"));
    pick(keep, "a", []);
    expect(keep.a.sideline).toEqual([]);
    expect(keep.a.library.slice(0, 2)).toEqual([PLAIN, PLAIN_B]);
    expect(keep.a.library).toHaveLength(30);
  });
});

describe("伊吹 摩耶", () => {
  it("076: costs 1 less required energy while the opponent has a yellow or purple card (a red one does not count)", () => {
    patch(eva("076"), { color: "red", energyCost: 3 });
    const none = setup();
    expect(costOf(none.game, none.players, ctx, "a", eva("076")).energy).toBe(3);
    const yellow = setup();
    field(yellow.b, "front", FILLER);
    expect(costOf(yellow.game, yellow.players, ctx, "a", eva("076")).energy).toBe(2);
    const purple = setup();
    field(purple.b, "energy", SHINJI_PURPLE);
    expect(costOf(purple.game, purple.players, ctx, "a", eva("076")).energy).toBe(2);
    const red = setup();
    field(red.b, "front", eva("084")); // a red card (the data lists it as a yellow card without energy)
    field(red.b, "front", eva("083"));
    expect(costOf(red.game, red.players, ctx, "a", eva("076")).energy).toBe(3);
  });
});

describe("新世纪福音战士临时5号机", () => {
  it("077: 登场时 draws 1 only with 4 or more cards without a trigger on our field", () => {
    const h = setup();
    field(h.a, "front", PLAIN);
    field(h.a, "energy", PLAIN_B);
    field(h.a, "energy", TALULA);
    h.a.library = deck(PLAIN_B);
    play(h, eva("077")); // this card itself has no trigger: 4 cards
    expect(h.a.hand).toEqual([PLAIN_B]);

    const few = setup();
    field(few.a, "front", PLAIN);
    field(few.a, "energy", FILLER); // has a trigger: not counted
    field(few.a, "energy", PLAIN_B);
    play(few, eva("077"));
    expect(few.a.hand).toEqual([]);
  });

  it("077: 退场时 (the owner chooses) rests up to 1 opposing front-line character", () => {
    const h = setup();
    const temp = field(h.b, "front", eva("077"));
    const mine = field(h.a, "front", PLAIN);
    const mine2 = field(h.a, "front", PLAIN_B);
    field(h.a, "energy", TALULA);
    field(h.a, "front", TALULA); // an extra card keeps `mine`/`mine2` ordering simple
    power(h, 4);
    h.a.hand.push(eva("065"));
    h.act("a", { type: "event", handIndex: 0 }); // 065 targets the opponent's front line: sidelines the 5号机 (BP4000)
    expect(h.b.sideline).toEqual([eva("077")]);
    const options = choice(h.game, "b");
    expect(options.options).toEqual([mine.uid, mine2.uid, h.a.front[2]!.uid]);
    expect(options.min).toBe(0);
    pick(h, "b", [mine2.uid]);
    expect(mine2.rested).toBe(true);
    expect(mine.rested).toBe(false);
    expect(temp.uid).not.toBe(mine.uid);

    const none = setup();
    field(none.b, "front", eva("077"));
    const mine3 = field(none.a, "front", PLAIN);
    power(none, 4);
    none.a.hand.push(eva("065"));
    none.act("a", { type: "event", handIndex: 0 });
    pick(none, "b", []);
    expect(mine3.rested).toBe(false);
  });
});

describe("新世纪福音战士3号机", () => {
  it("078: 登场时 may sideline a 〈式波·明日香·兰格雷〉 of ours; then this character becomes active and we draw 1", () => {
    const h = setup();
    const asuka = field(h.a, "front", PLAIN_B);
    field(h.a, "front", PLAIN);
    h.a.library = deck(TALULA);
    const unit = play(h, eva("078"));
    unit.rested = true; // (it comes in resting; the effect makes it active)
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    expect(h.a.sideline).toEqual([PLAIN_B]);
    expect(h.a.front.map((card) => card.uid)).not.toContain(asuka.uid);
    expect(unit.rested).toBe(false);
    expect(h.a.hand).toEqual([TALULA]);
  });

  it("078: answering no does nothing; without a 〈式波·明日香·兰格雷〉 there is no question", () => {
    const h = setup();
    const asuka = field(h.a, "front", PLAIN_B);
    play(h, eva("078"));
    pick(h, "a", ["no"]);
    expect(h.a.front).toContain(asuka);
    expect(h.a.sideline).toEqual([]);
    expect(h.a.hand).toEqual([]);

    const none = setup();
    field(none.a, "front", PLAIN);
    play(none, eva("078"));
    expect(none.game.pending).toBeNull();
  });
});

describe("新世纪福音战士初号机 拟神化", () => {
  it("079: with no face-down card under it, on our turn BP+5000 and 冲击③; with 1 or more neither", () => {
    const h = setup();
    const unit = field(h.a, "front", eva("079"));
    refresh(h);
    expect(bpOf(ctx, unit)).toBe(10000);
    expect(impactOf(ctx, unit)).toBe(3);
    unit.faceDown = [PLAIN];
    refresh(h);
    expect(bpOf(ctx, unit)).toBe(5000);
    expect(impactOf(ctx, unit)).toBe(0);
    unit.faceDown = [];
    h.act("a", { type: "end_turn" });
    expect(bpOf(ctx, unit)).toBe(5000); // not on the opponent's turn
    expect(impactOf(ctx, unit)).toBe(0);
  });

  it("079: with 4 or more face-down cards under it, the opponent's trigger effects cannot choose it", () => {
    const h = setup();
    const unit = field(h.a, "front", eva("079"));
    unit.faceDown = [PLAIN, PLAIN, PLAIN];
    refresh(h);
    expect(flagsOf(unit)).not.toContain("noTriggerTarget");
    unit.faceDown = [PLAIN, PLAIN, PLAIN, PLAIN];
    refresh(h);
    expect(flagsOf(unit)).toContain("noTriggerTarget");
  });

  it("079: 登场时 puts red 〈绫波 零〉 with different required energy (up to 1 of each) from the sideline face down under this character", () => {
    patch(eva("069"), { color: "red", energyCost: 1 });
    patch(eva("070"), { color: "red", energyCost: 1 });
    patch(eva("071"), { color: "red", energyCost: 2 });
    const h = setup();
    h.a.sideline.push(eva("069"), eva("070"), eva("071"), REI_YELLOW, PLAIN);
    const unit = play(h, eva("079"));
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([eva("069"), eva("070"), eva("071")]); // only red 〈绫波 零〉
    expect(options.min).toBe(0);
    expect(() => pick(h, "a", ["s:0", "s:1"])).toThrow("INVALID_CHOICE"); // the same required energy twice
    pick(h, "a", ["s:1", "s:2"]);
    expect(unit.faceDown).toEqual([eva("070"), eva("071")]);
    expect(h.a.sideline).toEqual([eva("069"), REI_YELLOW, PLAIN]);
    expect(h.game.pending).toBeNull();
  });

  it("079: 登场时 — picking none puts nothing under it", () => {
    patch(eva("069"), { color: "red", energyCost: 1 });
    patch(eva("071"), { color: "red", energyCost: 2 });
    const h = setup();
    h.a.sideline.push(eva("069"), eva("071"));
    const unit = play(h, eva("079"));
    pick(h, "a", []);
    expect(unit.faceDown ?? []).toEqual([]);
    expect(h.a.sideline).toEqual([eva("069"), eva("071")]);
  });

  it("079: when its attack ends, it may reveal up to 2 of the face-down cards below into the hand; taking 2 makes it active", () => {
    const h = setup("attack");
    const unit = field(h.a, "front", eva("079"));
    unit.faceDown = [PLAIN, PLAIN_B, TALULA];
    strike(h, unit.uid);
    expect(unit.rested).toBe(true);
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([PLAIN, PLAIN_B, TALULA]);
    expect(options.min).toBe(0);
    expect(options.max).toBe(2);
    pick(h, "a", ["l:0", "l:2"]);
    expect(h.a.hand).toEqual([PLAIN, TALULA]);
    expect(unit.faceDown).toEqual([PLAIN_B]);
    expect(unit.rested).toBe(false);
    expect(h.game.looking).toBeNull();
    expect(h.game.pending).toBeNull();
  });

  it("079: taking only 1 does not make it active; taking none leaves everything face down", () => {
    const h = setup("attack");
    const unit = field(h.a, "front", eva("079"));
    unit.faceDown = [PLAIN, PLAIN_B];
    strike(h, unit.uid);
    pick(h, "a", ["l:1"]);
    expect(h.a.hand).toEqual([PLAIN_B]);
    expect(unit.faceDown).toEqual([PLAIN]);
    expect(unit.rested).toBe(true);

    const none = setup("attack");
    const unit2 = field(none.a, "front", eva("079"));
    unit2.faceDown = [PLAIN, PLAIN_B];
    strike(none, unit2.uid);
    pick(none, "a", []);
    expect(none.a.hand).toEqual([]);
    expect(unit2.faceDown).toEqual([PLAIN, PLAIN_B]);
    expect(none.a.library).toHaveLength(30);

    const empty = setup("attack");
    const unit3 = field(empty.a, "front", eva("079"));
    strike(empty, unit3.uid);
    expect(empty.game.pending).toBeNull(); // nothing below: no question
  });
});

describe("新世纪福音战士零号机", () => {
  const fieldSetup = () => {
    const h = setup();
    const unit = field(h.a, "front", eva("080"));
    const target = field(h.b, "front", PLAIN);
    h.a.library = deck(PLAIN, PLAIN_B);
    return { h, unit, target };
  };

  it("080: 启动主要 sidelines itself, sidelines an opposing front-line character; 退场时 draws 2", () => {
    const { h, unit, target } = fieldSetup();
    h.act("a", { type: "activate", uid: unit.uid, ability: 0 });
    pick(h, "a", [target.uid]);
    expect(h.a.front).toEqual([]);
    expect(h.a.sideline).toEqual([eva("080")]);
    expect(h.b.front.map((card) => card.uid)).not.toContain(target.uid);
    expect(h.b.sideline).toEqual([PLAIN]);
    expect(h.a.hand).toEqual([PLAIN, PLAIN_B]); // 退场时: draw 2
  });

  it("080: picking no target is allowed, and the cost cut is still given; it cannot be used from the energy line", () => {
    const { h, unit, target } = fieldSetup();
    h.act("a", { type: "activate", uid: unit.uid, ability: 0 });
    pick(h, "a", []);
    expect(h.b.front).toEqual([target]);
    expect(costOf(h.game, h.players, ctx, "a", eva("074")).ap).toBe(0);

    const back = setup();
    const resting = field(back.a, "energy", eva("080"));
    expect(() => back.act("a", { type: "activate", uid: resting.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
  });

  it("080: the next 〈碇 真嗣〉 or card named …初号机… from the hand costs 1 less red energy and 1 less AP — once, and only this turn", () => {
    patch(eva("074"), { color: "red", energyCost: 3 });
    patch(eva("075"), { color: "red", energyCost: 3 });
    patch(eva("076"), { color: "red", energyCost: 3 });
    patch(eva("079"), { color: "red", energyCost: 5 });
    const { h, unit } = fieldSetup();
    const supply = field(h.a, "energy", FILLER); // keeps our field from being empty
    supply.flags = ["extraEnergy:red:2"];
    expect(costOf(h.game, h.players, ctx, "a", eva("075"))).toEqual({ energy: 3, ap: 2 });
    h.act("a", { type: "activate", uid: unit.uid, ability: 0 });
    pick(h, "a", []);
    expect(costOf(h.game, h.players, ctx, "a", eva("075"))).toEqual({ energy: 2, ap: 1 }); // 〈碇 真嗣〉
    expect(costOf(h.game, h.players, ctx, "a", eva("079"))).toEqual({ energy: 4, ap: 0 }); // the name contains 初号机
    expect(costOf(h.game, h.players, ctx, "a", eva("033"))).toEqual({ energy: 0, ap: 0 }); // 初号机（盖乌斯之枪）: purple, no red energy to cut
    expect(costOf(h.game, h.players, ctx, "a", eva("076"))).toEqual({ energy: 3, ap: 1 }); // another name: nothing
    expect(costOf(h.game, h.players, ctx, "a", eva("065")).ap).toBe(2); // an event
    // playing a matching card spends it: needs only 2 red energy and no AP
    play(h, eva("074"));
    expect(h.a.front.map((card) => card.cardId)).toEqual([eva("074")]);
    expect(apRested(h)).toBe(0);
    expect(costOf(h.game, h.players, ctx, "a", eva("075"))).toEqual({ energy: 3, ap: 2 });
  });

  it("080: the cut is also spent by a Raid from the hand, and is gone in a later turn", () => {
    patch(eva("079"), { color: "red", energyCost: 2 });
    patch(eva("075"), { color: "red", energyCost: 3 });
    const { h, unit } = fieldSetup();
    const supply = field(h.a, "energy", FILLER);
    supply.flags = ["extraEnergy:red:1"]; // only 1 red energy: the Raid needs the cut
    const shinji = field(h.a, "front", SHINJI_PURPLE);
    h.act("a", { type: "activate", uid: unit.uid, ability: 0 });
    pick(h, "a", []);
    h.a.hand.push(eva("079"));
    h.act("a", { type: "raid", handIndex: h.a.hand.length - 1, targetUid: shinji.uid });
    expect(h.a.front.map((card) => card.cardId)).toContain(eva("079"));
    expect(apRested(h)).toBe(0);
    expect(costOf(h.game, h.players, ctx, "a", eva("075"))).toEqual({ energy: 3, ap: 2 });

    const later = fieldSetup();
    later.h.act("a", { type: "activate", uid: later.unit.uid, ability: 0 });
    pick(later.h, "a", []);
    later.h.act("a", { type: "end_turn" });
    toMainOf(later.h, "a");
    expect(costOf(later.h.game, later.h.players, ctx, "a", eva("075"))).toEqual({ energy: 3, ap: 2 });
  });
});

describe("新世纪福音战士2号机", () => {
  const redHand = () => {
    patch(eva("076"), { color: "red", energyCost: 2 });
    patch(eva("072"), { color: "red", energyCost: 3 });
  };

  it("081: 登场时 puts a red character without a trigger from the hand onto the field resting, if its required energy is at most our cards without a trigger", () => {
    redHand();
    const h = setup();
    field(h.a, "energy", TALULA);
    field(h.a, "energy", TALULA); // 2 cards without a trigger
    // eligible (cost <= 2): 086 (0), 076 (2); not: 072 (3), 084 (has a trigger), 001 (yellow)
    h.a.hand.push(PLAIN_B, PLAIN, eva("072"), eva("084"), REI_YELLOW);
    play(h, eva("081"));
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([PLAIN_B, PLAIN]);
    expect(options.min).toBe(0);
    pick(h, "a", ["h:1"]);
    pick(h, "a", ["line:front"]);
    const played = h.a.front[h.a.front.length - 1]!;
    expect(played.cardId).toBe(PLAIN);
    expect(played.rested).toBe(true);
    expect(h.a.hand).toEqual([PLAIN_B, eva("072"), eva("084"), REI_YELLOW]);
    expect(h.game.pending).toBeNull(); // 3 cards without a trigger: no draw
    expect(h.a.sideline).toEqual([]);
  });

  it("081: every card without a trigger on our field raises the range; with 4 or more (after the put) draw 2 and put 1 hand card into the sideline", () => {
    redHand();
    const h = setup();
    for (let index = 0; index < 3; index += 1) field(h.a, "energy", TALULA);
    h.a.library = deck(eva("084"), eva("083"));
    h.a.hand.push(eva("072"), PLAIN_B);
    play(h, eva("081"));
    expect(choice(h.game, "a").cards).toEqual([eva("072"), PLAIN_B]); // the range is 3 now
    pick(h, "a", ["h:1"]);
    pick(h, "a", ["line:energy"]);
    expect(h.a.hand).toEqual([eva("072"), eva("084"), eva("083")]); // drew 2
    expect(choice(h.game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    pick(h, "a", ["h:2"]);
    expect(h.a.hand).toEqual([eva("072"), eva("084")]);
    expect(h.a.sideline).toEqual([eva("083")]);
  });

  it("081: picking none still draws 2 when we already have 4 or more cards without a trigger; with fewer nothing is drawn", () => {
    const h = setup();
    for (let index = 0; index < 4; index += 1) field(h.a, "energy", TALULA);
    h.a.hand.push(PLAIN_B);
    h.a.library = deck(eva("084"), eva("083"));
    play(h, eva("081"));
    pick(h, "a", []);
    expect(h.a.hand).toEqual([PLAIN_B, eva("084"), eva("083")]);
    pick(h, "a", ["h:0"]);
    expect(h.a.sideline).toEqual([PLAIN_B]);

    const few = setup();
    few.a.hand.push(eva("084"));
    play(few, eva("081"));
    expect(few.game.pending).toBeNull(); // nothing eligible (the only card has a trigger)
    expect(few.a.hand).toEqual([eva("084")]);
  });
});

describe("新世纪福音战士2号机 兽化", () => {
  const setup082 = () => {
    const h = setup("attack");
    const unit = field(h.a, "front", eva("082"));
    field(h.b, "front", PLAIN, true); // resting: it cannot block
    return { h, unit };
  };

  it("082: carries 伤害② (from the data)", () => {
    const h = setup();
    expect(damageOf(ctx, field(h.a, "front", eva("082")))).toBe(2);
  });

  it("082: when its attack ends it may put 2 hand cards without a trigger into the sideline: it becomes active and BP+3000 (once per turn)", () => {
    const { h, unit } = setup082();
    h.a.hand.push(PLAIN, FILLER, PLAIN_B);
    strike(h, unit.uid, 2); // 伤害②
    expect(unit.rested).toBe(true);
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    expect(h.game.pending).toBeNull(); // exactly 2 hand cards without a trigger (the one with a trigger is not eligible): no further question
    expect(h.a.hand).toEqual([FILLER]);
    expect(h.a.sideline).toEqual([PLAIN, PLAIN_B]);
    expect(unit.rested).toBe(false);
    expect(bpOf(ctx, unit)).toBe(7000);
    // attacking again this turn: the effect does not come back
    h.a.hand.push(PLAIN, PLAIN_B);
    strike(h, unit.uid, 2);
    expect(h.game.pending).toBeNull();
    expect(unit.rested).toBe(true);
  });

  it("082: with more than 2 hand cards without a trigger we choose which 2 (cards with a trigger are not offered)", () => {
    const { h, unit } = setup082();
    h.a.hand.push(PLAIN, FILLER, PLAIN_B, TALULA);
    strike(h, unit.uid, 2);
    pick(h, "a", ["yes"]);
    const options = choice(h.game, "a");
    expect(options.options).toEqual(["h:0", "h:2", "h:3"]);
    expect(options.min).toBe(2);
    expect(options.max).toBe(2);
    pick(h, "a", ["h:2", "h:3"]);
    expect(h.a.hand).toEqual([PLAIN, FILLER]);
    expect(h.a.sideline).toEqual([PLAIN_B, TALULA]);
  });

  it("082: answering no does nothing; with fewer than 2 hand cards without a trigger, or no opposing front-line character, there is no question", () => {
    const { h, unit } = setup082();
    h.a.hand.push(PLAIN, PLAIN_B);
    strike(h, unit.uid, 2);
    pick(h, "a", ["no"]);
    expect(h.a.hand).toEqual([PLAIN, PLAIN_B]);
    expect(unit.rested).toBe(true);
    expect(bpOf(ctx, unit)).toBe(4000);

    const one = setup082();
    one.h.a.hand.push(PLAIN, FILLER);
    strike(one.h, one.unit.uid, 2);
    expect(one.h.game.pending).toBeNull();

    const alone = setup("attack");
    const unit3 = field(alone.a, "front", eva("082"));
    alone.a.hand.push(PLAIN, PLAIN_B);
    strike(alone, unit3.uid, 2);
    expect(alone.game.pending).toBeNull();
    expect(unit3.rested).toBe(true);
  });
});

describe("加持 良治", () => {
  it("083: 登场时 returns another character of ours with required energy 1 or less to the hand", () => {
    const h = setup();
    const other = field(h.a, "front", PLAIN_B);
    field(h.a, "front", TALULA); // required energy 2: not eligible
    const kaji = play(h, eva("083"));
    expect(h.game.pending).toBeNull(); // the only eligible card
    expect(h.a.hand).toEqual([PLAIN_B]);
    expect(h.a.front.map((card) => card.uid)).not.toContain(other.uid);
    expect(h.a.front).toContain(kaji);
  });

  it("083: with several eligible characters we choose; with none this character returns to the hand", () => {
    const h = setup();
    const first = field(h.a, "front", PLAIN_B);
    const second = field(h.a, "energy", eva("084"));
    play(h, eva("083"));
    expect(choice(h.game, "a").options).toEqual([first.uid, second.uid]);
    pick(h, "a", [second.uid]);
    expect(h.a.hand).toEqual([eva("084")]);
    expect(h.a.front.map((card) => card.cardId)).toEqual([PLAIN_B, eva("083")]);

    const none = setup();
    field(none.a, "front", TALULA);
    play(none, eva("083"));
    expect(none.a.hand).toEqual([eva("083")]);
    expect(none.a.front.map((card) => card.cardId)).toEqual([TALULA]);

    const alone = setup();
    play(alone, eva("083"));
    expect(alone.a.hand).toEqual([eva("083")]);
    expect(alone.a.front).toEqual([]);
  });
});

describe("葛城 美里", () => {
  it("084: 登场时 draws 1 card and puts 1 hand card into the sideline", () => {
    const h = setup();
    h.a.library = deck(PLAIN_B);
    h.a.hand.push(TALULA);
    play(h, eva("084"));
    expect(h.a.hand).toEqual([TALULA, PLAIN_B]);
    pick(h, "a", ["h:0"]);
    expect(h.a.hand).toEqual([PLAIN_B]);
    expect(h.a.sideline).toEqual([TALULA]);
  });

  it("085: 登场时 mode 1 — BP+1000 to up to 1 other character of ours (not itself; picking none is allowed)", () => {
    const h = setup();
    const ally = field(h.a, "front", PLAIN);
    const back = field(h.a, "energy", PLAIN_B);
    const misato = play(h, eva("085"));
    const modes = choice(h.game, "a");
    expect(modes.labels).toHaveLength(2);
    pick(h, "a", ["m:0"]);
    const options = choice(h.game, "a");
    expect(options.options).toEqual([ally.uid, back.uid, ...[]].filter((uid) => uid !== misato.uid));
    expect(options.options).not.toContain(misato.uid);
    expect(options.min).toBe(0);
    pick(h, "a", [back.uid]);
    expect(bpOf(ctx, back)).toBe(3000);
    expect(bpOf(ctx, ally)).toBe(3000);

    const none = setup();
    const ally2 = field(none.a, "front", PLAIN);
    play(none, eva("085"));
    pick(none, "a", ["m:0"]);
    pick(none, "a", []);
    expect(bpOf(ctx, ally2)).toBe(3000);
  });

  it("085: 登场时 mode 2 — moves up to 1 character of ours to the other line (a character that cannot move is not offered)", () => {
    const h = setup();
    const ally = field(h.a, "front", PLAIN);
    const frozen = field(h.a, "front", PLAIN_B);
    frozen.flags = ["cannotMove"];
    const back = field(h.a, "energy", TALULA);
    const misato = play(h, eva("085"));
    pick(h, "a", ["m:1"]);
    const options = choice(h.game, "a");
    expect(options.options).toEqual([ally.uid, misato.uid, back.uid]); // itself may be moved too
    expect(options.min).toBe(0);
    pick(h, "a", [ally.uid]);
    expect(h.a.front.map((card) => card.uid)).not.toContain(ally.uid);
    expect(h.a.energy.map((card) => card.uid)).toContain(ally.uid);

    const none = setup();
    const ally2 = field(none.a, "front", PLAIN);
    play(none, eva("085"));
    pick(none, "a", ["m:1"]);
    pick(none, "a", []);
    expect(none.a.front).toContain(ally2);
  });
});

describe("式波·明日香·兰格雷", () => {
  it("086: only the 《冲击无效》 keyword — fully automatic", () => {
    expect(abilitiesFor(eva("086"))).toEqual([]);
    expect(isAutomated(titleCard(eva("086")))).toBe(true);
    expect(titleCard(eva("086")).stats.keywords).toEqual(["冲击无效"]);
  });

  /** b attacks a (no blocker): the first life card is taken by `b`, `a` declines any trigger. Returns the life card hit. */
  function hit(h: Harness, attackerUid: string): void {
    h.act("b", { type: "attack", attackerUid });
    const life = h.a.life[0]!;
    h.act("b", { type: "damage", lifeIds: [life.id] });
    h.act("a", { type: "trigger", lifeId: life.id, activate: false });
  }
  function opponentTurn(lifeCards: string[], copies = 1) {
    const h = setup();
    const asukas = Array.from({ length: copies }, () => field(h.a, "energy", eva("087")));
    lifeCards.forEach((cardId, index) => { h.a.life[index]!.cardId = cardId; });
    const raiders = [field(h.b, "front", PLAIN), field(h.b, "front", PLAIN_B)];
    h.act("a", { type: "end_turn" });
    toMainOf(h, "b");
    h.act("b", { type: "next_phase" }); // attack phase
    return { h, asukas, raiders };
  }

  it("087: on the opponent's turn a life card without a trigger going to the sideline lets it get BP+2000 (may), once per turn", () => {
    const { h, asukas, raiders } = opponentTurn([PLAIN, PLAIN_B]);
    hit(h, raiders[0]!.uid);
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    expect(bpOf(ctx, asukas[0]!)).toBe(5000);
    expect(h.a.sideline).toEqual([PLAIN]);
    // a second life card without a trigger in the same turn: the effect is used up
    hit(h, raiders[1]!.uid);
    expect(h.game.pending).toBeNull();
    expect(bpOf(ctx, asukas[0]!)).toBe(5000);
    expect(h.a.sideline).toEqual([PLAIN, PLAIN_B]);
  });

  it("087: answering no gives nothing and does not use the once-per-turn up; a life card with a trigger does not count", () => {
    const { h, asukas, raiders } = opponentTurn([FILLER, PLAIN, PLAIN_B]);
    hit(h, raiders[0]!.uid); // FILLER has a trigger (declined): not heard
    expect(h.game.pending).toBeNull();
    hit(h, raiders[1]!.uid);
    pick(h, "a", ["no"]);
    expect(bpOf(ctx, asukas[0]!)).toBe(3000);
    expect(notMarked(h)).toBe(true);
  });

  it("087: two copies share the once-per-turn limit (the effect is per name)", () => {
    const { h, asukas, raiders } = opponentTurn([PLAIN], 2);
    hit(h, raiders[0]!.uid);
    // the owner orders the two simultaneous abilities, then answers the first one only
    for (let guard = 0; guard < 4 && h.game.pending; guard += 1) {
      const pending = choice(h.game, "a");
      pick(h, "a", pending.purpose === "confirm" ? ["yes"] : [pending.options[0]!]);
    }
    expect(asukas.map((card) => bpOf(ctx, card)).sort()).toEqual([3000, 5000]);
  });
});

describe("式波·明日香·兰格雷 (088)", () => {
  it("088: costs 2 less required energy while we have no card on our field", () => {
    patch(eva("088"), { color: "red", energyCost: 3 });
    const h = setup();
    expect(costOf(h.game, h.players, ctx, "a", eva("088")).energy).toBe(1);
    field(h.a, "energy", PLAIN);
    expect(costOf(h.game, h.players, ctx, "a", eva("088")).energy).toBe(3);
  });

  it("088: 登场时 reveals the top card if it has no trigger and may add it to the hand; otherwise it stays on top", () => {
    const h = setup();
    h.a.library = deck(PLAIN, PLAIN_B);
    play(h, eva("088"));
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([PLAIN]);
    expect(options.min).toBe(0);
    pick(h, "a", ["l:0"]);
    expect(h.a.hand).toEqual([PLAIN]);
    expect(h.a.library[0]).toBe(PLAIN_B);
    expect(h.game.pending).toBeNull();

    const decline = setup();
    decline.a.library = deck(PLAIN, PLAIN_B);
    play(decline, eva("088"));
    pick(decline, "a", []);
    expect(decline.a.hand).toEqual([]);
    expect(decline.a.library.slice(0, 2)).toEqual([PLAIN, PLAIN_B]);
    expect(decline.a.library).toHaveLength(30);
  });

  it("088: a top card with a trigger cannot be taken and goes back on top", () => {
    const h = setup();
    h.a.library = deck(FILLER, PLAIN_B);
    play(h, eva("088"));
    expect(h.game.pending).toBeNull(); // nothing eligible: no question
    expect(h.a.hand).toEqual([]);
    expect(h.a.library.slice(0, 2)).toEqual([FILLER, PLAIN_B]);
    expect(h.a.library).toHaveLength(30);
  });
});
