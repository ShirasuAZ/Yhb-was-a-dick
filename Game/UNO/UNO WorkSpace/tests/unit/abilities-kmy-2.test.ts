/**
 * KMY (鬼灭之刃) cards, batch 2 (UA05BT/KMY-1-034 .. 065, purple): one test per card, set up as its printed text describes and checked against the text.
 * Card text comes from `Cards/cards.json` (no card images exist on this machine).
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, energyOf, flagsOf, hasKeyword, impactOf } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { KMY_2_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-kmy-2.ts";
import { legalActions } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/legal.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { choice, ctx, energy, field, FILLER, setup } from "./ability-harness.ts";

const k = (n: string): string => `UA05BT/KMY-1-${n}`;
type Act = (who: string, action: Parameters<ReturnType<typeof setup>["act"]>[1]) => void;
const pick = (act: Act, who: string, picks: string[]): void => act(who, { type: "choose", picks });
const sidelineManually = (act: Act, who: string, owner: "you" | "opponent", uid: string): void => act(who, { type: "manual", manual: { op: "field", owner, uid, act: "sideline" } });
/** Lets the continuous abilities settle (the harness puts cards on the field directly): any action runs the engine's refresh. */
const refresh = (act: Act): void => act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "activate" } });

// Helper cards.
const E2 = k("050"); // 累: purple, cost 3, BP2500, makes two purple energy (an energy source whose cost is above 1)
const SITE_E = k("061"); // 京极屋: a site, makes one purple energy and is not a character (so character choices do not list it)
const AMIYA = "UCEX01BT/ARK-2-047"; // 阿米娅: purple, cost 0, BP1500, makes one purple energy
const W0 = "UC01BT/ARK-1-009"; // W: yellow, cost 0, BP2000
const NINE = "UC01BT/ARK-1-088"; // 九: red, cost 0, BP2000
const GUARD = "UC01ST/ARK-1-103"; // Guard: blue, cost 3, BP3000
const HOSHI = "UC01BT/ARK-1-092"; // 星熊: red, BP4000
// Cards of this batch used as helpers.
const NAKIME = k("042");
const LOWER_THREE = k("046"); // 下弦之叁: draws when it leaves
const LOWER_ONE_MOON = k("044"); // 魇梦 (下弦之鬼)
const GYUTARO_0 = k("053"); // 妓夫太郎 cost 0, AP 1
const GYUTARO_3 = k("054"); // 妓夫太郎 cost 3, AP 1
const GYUTARO_4 = k("055"); // 妓夫太郎 cost 4, AP 1 (Raid)
const GYUTARO_AP2 = k("056"); // 妓夫太郎 cost 4, AP 2
const DAKI_1 = k("057"); // 堕姬 cost 1
const DAKI_3 = k("058"); // 堕姬 cost 3, AP 2
const DAKI_RAID = k("059"); // 堕姬 Raid
const WARABIHIME = k("060"); // 蕨姬: also regarded as 〈堕姬〉

describe("KMY batch 2: the table", () => {
  it("has every card automated and the names the filters rely on", () => {
    for (let number = 34; number <= 65; number += 1) expect(isAutomated(titleCard(k(String(number).padStart(3, "0")))), String(number)).toBe(true);
    for (const number of Object.keys(KMY_2_ABILITIES)) expect(isAutomated(titleCard(number)), number).toBe(true);
    // Cards 040 and 051 only print a keyword line: 040 is recognised as such (no entry), 051's line ends in "。" so it has an empty entry.
    expect(Object.keys(KMY_2_ABILITIES)).toHaveLength(31);
    expect(KMY_2_ABILITIES[k("040")]).toBeUndefined();
    expect(KMY_2_ABILITIES[k("051")]).toEqual([]);
    expect(titleCard(k("053")).name).toBe("妓夫太郎");
    expect(titleCard(k("057")).name).toBe("堕姬");
    expect(titleCard(k("060")).name).toBe("蕨姬");
    expect(titleCard(k("036")).name).toBe("鬼舞辻 无惨(拟态“艺妓”)");
    expect(titleCard(k("044")).stats.affinities).toEqual(["下弦之鬼"]);
    expect(titleCard(k("051")).stats.affinities).toEqual(["上弦之鬼"]);
  });
});

describe("KMY batch 2: 鬼舞辻 无惨", () => {
  it("鬼舞辻 无惨 (034): looks at 5, reveals up to one 下弦之鬼 to the hand, the rest to the bottom, and only then discards", () => {
    const { game, a, act } = setup();
    energy(a, 1, AMIYA);
    a.library = [LOWER_THREE, W0, LOWER_ONE_MOON, GUARD, W0, FILLER, FILLER];
    a.hand.push(k("034"), NINE);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:0", "l:2"]); // only the 下弦之鬼
    pick(act, "a", ["l:2"]);
    pick(act, "a", ["l:2", "l:0", "l:1", "l:3"]); // the rest in order: Guard, 下弦之叁, W, W
    expect(a.library).toEqual([FILLER, FILLER, GUARD, LOWER_THREE, W0, W0]);
    // The card was added: one hand card goes to the sideline.
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([LOWER_ONE_MOON]);
    expect(a.sideline).toEqual([NINE]);

    // Up to one: revealing nothing means no discard.
    const second = setup();
    energy(second.a, 1, AMIYA);
    second.a.library = [LOWER_THREE, W0, FILLER];
    second.a.hand.push(k("034"), NINE);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1", "l:2"]);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([NINE]);
    expect(second.a.sideline).toEqual([]);

    // Nothing qualifies: no question about the reveal.
    const third = setup();
    energy(third.a, 1, AMIYA);
    third.a.library = [W0, GUARD, NINE, FILLER, FILLER, FILLER];
    third.a.hand.push(k("034"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(third.game, "a").options).toHaveLength(5); // goes straight to ordering the five cards for the bottom
    expect(choice(third.game, "a").ordered).toBe(true);
  });

  it("鬼舞辻 无惨 (035): 冲击2 and 伤害2; with 20 or fewer cards in the sideline it cannot enter the front line or move there", () => {
    const { game, players, a, act } = setup();
    energy(a, 2, E2);
    a.sideline = Array(20).fill(FILLER);
    a.hand.push(k("035"));
    expect(() => act("a", { type: "play", handIndex: 0, line: "front" })).toThrow("ENERGY_LINE_ONLY");
    expect(legalActions(game, players, ctx, "a")).not.toContainEqual({ type: "play", handIndex: 0, line: "front" });
    expect(legalActions(game, players, ctx, "a")).toContainEqual({ type: "play", handIndex: 0, line: "energy" });
    act("a", { type: "play", handIndex: 0, line: "energy" });
    const muzan = a.energy[a.energy.length - 1]!;
    expect(impactOf(ctx, muzan)).toBe(2);
    expect(hasKeyword(ctx, muzan, "伤害2")).toBe(true);

    // 21 cards: the restriction ends.
    const second = setup();
    energy(second.a, 2, E2);
    second.a.sideline = Array(21).fill(FILLER);
    second.a.hand.push(k("035"));
    expect(legalActions(second.game, second.players, ctx, "a")).toContainEqual({ type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.front.map((card) => card.cardId)).toEqual([k("035")]);
  });

  it("鬼舞辻 无惨 (035): moving to the front line is refused with 20 or fewer sideline cards, allowed with 21", () => {
    const { a, act } = setup("movement");
    const muzan = field(a, "energy", k("035"));
    a.sideline = Array(20).fill(FILLER);
    act("a", { type: "manual", manual: { op: "draw" } }); // continuous abilities are recomputed after each action
    expect(() => act("a", { type: "move", toFront: [muzan.uid], toEnergy: [], remove: [] })).toThrow("CANNOT_MOVE");

    const second = setup("movement");
    const free = field(second.a, "energy", k("035"));
    second.a.sideline = Array(21).fill(FILLER);
    second.act("a", { type: "manual", manual: { op: "draw" } });
    second.act("a", { type: "move", toFront: [free.uid], toEnergy: [], remove: [] });
    expect(second.a.front).toEqual([free]);
  });

  it("鬼舞辻 无惨 (036): also regarded as 〈鬼舞辻 无惨〉; once per turn sidelines another own character and the top card of the deck, then BP+1000", () => {
    const { game, a, b, act } = setup();
    const geisha = field(a, "front", k("036"));
    const other = field(a, "front", W0);
    const energyCard = field(a, "energy", FILLER);
    field(b, "front", NINE);
    refresh(act);
    expect(flagsOf(geisha)).toContain("name:鬼舞辻 无惨");
    a.library = [GUARD, FILLER, FILLER];
    act("a", { type: "activate", uid: geisha.uid, ability: 1 });
    // Another character of ours (not itself, not the opponent's): the energy line counts too.
    expect(choice(game, "a").options).toEqual([other.uid, energyCard.uid]);
    pick(act, "a", [other.uid]);
    expect(a.front).toEqual([geisha]);
    expect(a.sideline).toEqual([W0, GUARD]);
    expect(a.library).toEqual([FILLER, FILLER]);
    expect(bpOf(ctx, geisha)).toBe(4000);
    expect(() => act("a", { type: "activate", uid: geisha.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, geisha)).toBe(3000);

    // Alone on the field: no character leaves (no BP), the top card of the deck still goes to the sideline; still once per turn.
    const second = setup();
    const alone = field(second.a, "front", k("036"));
    second.a.library = [GUARD, FILLER];
    second.act("a", { type: "activate", uid: alone.uid, ability: 1 });
    expect(second.game.pending).toBeNull();
    expect(second.a.sideline).toEqual([GUARD]);
    expect(bpOf(ctx, alone)).toBe(3000);
    expect(() => second.act("a", { type: "activate", uid: alone.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
  });

  it("鬼舞辻 无惨 (037): once per turn rests for +1 purple energy this turn and leaves when the main phase ends", () => {
    const { a, act } = setup();
    const boy = field(a, "energy", k("037"));
    refresh(act);
    expect(flagsOf(boy)).toContain("name:鬼舞辻 无惨");
    expect(energyOf(ctx, a, "purple")).toBe(1);
    act("a", { type: "activate", uid: boy.uid, ability: 1 });
    expect(boy.rested).toBe(true);
    expect(energyOf(ctx, a, "purple")).toBe(2);
    expect(() => act("a", { type: "activate", uid: boy.uid, ability: 1 })).toThrow();
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([k("037")]);
  });

  it("鬼舞辻 无惨 (038): also regarded as 〈鬼舞辻 无惨〉; makes +1 purple energy only while active", () => {
    const { a, act } = setup();
    const tsukihiko = field(a, "energy", k("038"));
    refresh(act);
    expect(flagsOf(tsukihiko)).toContain("name:鬼舞辻 无惨");
    expect(energyOf(ctx, a, "purple")).toBe(2);
    tsukihiko.rested = true;
    act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "rest" } });
    expect(energyOf(ctx, a, "purple")).toBe(1);
  });
});

describe("KMY batch 2: 响凯, 朱纱丸, 手鬼, 鸣女, 矢琶羽", () => {
  it("响凯 (039): costs 1 less energy while the opponent has a yellow or red card", () => {
    const { game, players, b } = setup();
    expect(costOf(game, players, ctx, "a", k("039")).energy).toBe(3);
    field(b, "front", GUARD); // blue
    field(b, "energy", AMIYA); // purple
    expect(costOf(game, players, ctx, "a", k("039")).energy).toBe(3);
    field(b, "energy", W0); // yellow
    expect(costOf(game, players, ctx, "a", k("039")).energy).toBe(2);
    b.energy = b.energy.filter((card) => card.cardId !== W0);
    field(b, "front", NINE); // red
    expect(costOf(game, players, ctx, "a", k("039")).energy).toBe(2);
    // The opponent's cards only: our own yellow does not count.
    const second = setup();
    field(second.a, "front", W0);
    expect(costOf(second.game, second.players, ctx, "a", k("039")).energy).toBe(3);
  });

  it("朱纱丸 (040): only the keyword 冲击无效, which stops the attacker's Impact", () => {
    expect(KMY_2_ABILITIES[k("040")]).toBeUndefined();
    expect(isAutomated(titleCard(k("040")))).toBe(true);
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", k("051")); // BP4000, 冲击1
    attacker.bpMod = 0;
    const temari = field(b, "front", k("040")); // BP2000, 冲击无效
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: temari.uid });
    expect(b.sideline).toEqual([k("040")]);
    expect(game.pending).toBeNull(); // no Impact damage

    const second = setup("attack");
    const attacker2 = field(second.a, "front", k("051"));
    const plain = field(second.b, "front", FILLER);
    second.act("a", { type: "attack", attackerUid: attacker2.uid });
    second.act("b", { type: "block", blockerUid: plain.uid });
    expect(second.game.pending).toMatchObject({ kind: "damage", amount: 1 });
  });

  it("手鬼 (041): when sidelined, mode 1 moves up to one own character to the other line", () => {
    const { game, a, act } = setup();
    const hand = field(a, "front", k("041"));
    const front = field(a, "front", W0);
    const back = field(a, "energy", FILLER);
    const stuck = field(a, "energy", NINE);
    stuck.flags = ["cannotMove"];
    sidelineManually(act, "a", "you", hand.uid);
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    // Up to one; a character that cannot move is not offered.
    expect(choice(game, "a").options).toEqual([front.uid, back.uid]);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [back.uid]);
    expect(a.front).toEqual([front, back]);
    expect(a.energy).toEqual([stuck]);

    // Choosing none moves nothing.
    const second = setup();
    const t2 = field(second.a, "front", k("041"));
    const f2 = field(second.a, "front", W0);
    field(second.a, "energy", FILLER);
    sidelineManually(second.act, "a", "you", t2.uid);
    pick(second.act, "a", ["m:0"]);
    pick(second.act, "a", []);
    expect(second.a.front).toEqual([f2]);
    expect(second.a.energy).toHaveLength(1);

    // The front-line character moves to the energy line.
    const third = setup();
    const t3 = field(third.a, "front", k("041"));
    const f3 = field(third.a, "front", W0);
    sidelineManually(third.act, "a", "you", t3.uid);
    pick(third.act, "a", ["m:0"]);
    pick(third.act, "a", [f3.uid]);
    expect(third.a.front).toEqual([]);
    expect(third.a.energy).toEqual([f3]);
  });

  it("手鬼 (041): mode 2 may swap one front-line and one energy-line character; declining keeps them", () => {
    const { game, a, act } = setup();
    const hand = field(a, "front", k("041"));
    const f1 = field(a, "front", W0);
    const f2 = field(a, "front", NINE);
    const e1 = field(a, "energy", FILLER);
    const e2 = field(a, "energy", AMIYA);
    sidelineManually(act, "a", "you", hand.uid);
    pick(act, "a", ["m:1"]);
    expect(choice(game, "a").options).toEqual([f1.uid, f2.uid]);
    pick(act, "a", [f2.uid]);
    expect(choice(game, "a").options).toEqual([e1.uid, e2.uid]);
    pick(act, "a", [e2.uid]);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.front).toEqual([f1, e2]);
    expect(a.energy).toEqual([e1, f2]);

    const second = setup();
    const t2 = field(second.a, "front", k("041"));
    const x1 = field(second.a, "front", W0);
    const y1 = field(second.a, "energy", FILLER);
    sidelineManually(second.act, "a", "you", t2.uid);
    pick(second.act, "a", ["m:1"]);
    expect(choice(second.game, "a").purpose).toBe("confirm"); // one candidate on each line: only the question remains
    pick(second.act, "a", ["no"]);
    expect(second.a.front).toEqual([x1]);
    expect(second.a.energy).toEqual([y1]);
  });

  it("鸣女 (042): returns another own character of cost 1 or less to the hand; with none, returns itself", () => {
    const { game, a, act } = setup();
    energy(a, 1, E2);
    const cheap = field(a, "front", FILLER);
    field(a, "front", GUARD); // cost 3: not eligible
    const cheap2 = field(a, "energy", W0);
    a.hand.push(NAKIME);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([cheap.uid, cheap2.uid]); // the cost-3 Guard is not eligible, nor is 鸣女 itself
    pick(act, "a", [cheap2.uid]);
    expect(a.hand).toEqual([W0]);
    expect(a.front.map((card) => card.cardId)).toContain(NAKIME);

    const second = setup();
    energy(second.a, 1, E2);
    field(second.a, "front", GUARD);
    second.a.hand.push(NAKIME);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([NAKIME]);
    expect(second.a.front.map((card) => card.cardId)).toEqual([GUARD]);
  });

  it("矢琶羽 (043): rests and discards a card, then chooses: move a character, or swap front and energy characters", () => {
    const { game, a, act } = setup();
    const yahaba = field(a, "front", k("043"));
    const other = field(a, "energy", FILLER);
    a.hand.push(W0, NINE);
    act("a", { type: "activate", uid: yahaba.uid, ability: 0 });
    expect(yahaba.rested).toBe(true);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:1"]);
    expect(a.sideline).toEqual([NINE]);
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    expect(choice(game, "a").options).toEqual([yahaba.uid, other.uid]);
    pick(act, "a", [other.uid]);
    expect(a.front).toEqual([yahaba, other]);
    expect(a.energy).toEqual([]);
    // It is rested now: the cost cannot be paid again.
    expect(() => act("a", { type: "activate", uid: yahaba.uid, ability: 0 })).toThrow("ABILITY_COST");

    // Swap mode.
    const second = setup();
    const y2 = field(second.a, "front", k("043"));
    const e2 = field(second.a, "energy", FILLER);
    second.a.hand.push(W0);
    second.act("a", { type: "activate", uid: y2.uid, ability: 0 });
    pick(second.act, "a", ["m:1"]); // the single hand card was discarded without a question
    expect(choice(second.game, "a").purpose).toBe("confirm");
    pick(second.act, "a", ["yes"]);
    expect(second.a.front).toEqual([e2]);
    expect(second.a.energy).toEqual([y2]);

    // The discard is part of the cost.
    const third = setup();
    const y3 = field(third.a, "front", k("043"));
    expect(() => third.act("a", { type: "activate", uid: y3.uid, ability: 0 })).toThrow("ABILITY_COST");
  });
});

describe("KMY batch 2: 下弦之鬼", () => {
  it("魇梦 (044): draws a card when played, only if a character was sidelined this turn", () => {
    const { game, a, act } = setup();
    energy(a, 4, AMIYA);
    a.hand.push(LOWER_ONE_MOON);
    a.library = [GUARD, FILLER, FILLER];
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([]);

    // One of our own characters left earlier this turn.
    const second = setup();
    energy(second.a, 4, AMIYA);
    const gone = field(second.a, "front", FILLER);
    sidelineManually(second.act, "a", "you", gone.uid);
    second.a.hand.push(LOWER_ONE_MOON);
    second.a.library = [GUARD, FILLER, FILLER];
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([GUARD]);

    // The opponent's character counts as well.
    const third = setup();
    energy(third.a, 4, AMIYA);
    const theirs = field(third.b, "front", FILLER);
    sidelineManually(third.act, "a", "opponent", theirs.uid);
    third.a.hand.push(LOWER_ONE_MOON);
    third.a.library = [GUARD, FILLER];
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(third.a.hand).toEqual([GUARD]);
  });

  it("魇梦 (045): Raid onto 魇梦; BP+500 with 15 or more sideline cards; draws 2 and discards 1 when it enters", () => {
    const { game, a, act } = setup();
    energy(a, 4, AMIYA);
    const base = field(a, "energy", LOWER_ONE_MOON, true);
    const wrong = field(a, "energy", FILLER);
    a.hand.push(k("045"));
    a.library = [GUARD, W0, FILLER];
    expect(() => act("a", { type: "raid", handIndex: 0, targetUid: wrong.uid, toFront: true })).toThrow("RAID_TARGET_INVALID");
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(base.cardId).toBe(k("045"));
    expect(base.rested).toBe(false);
    expect(a.front).toContain(base);
    expect(a.hand).toEqual([GUARD, W0]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:1"]);
    expect(a.hand).toEqual([GUARD]);
    expect(a.sideline).toEqual([W0]);
    // BP: 4000 with fewer than 15 sideline cards, 4500 from 15 on (our own sideline).
    expect(bpOf(ctx, base)).toBe(4000);
    a.sideline = Array(14).fill(FILLER);
    refresh(act);
    expect(bpOf(ctx, base)).toBe(4000);
    a.sideline.push(FILLER);
    refresh(act);
    expect(bpOf(ctx, base)).toBe(4500);
  });

  it("下弦之叁 (046): draws a card when sidelined", () => {
    const { a, act } = setup();
    const three = field(a, "front", LOWER_THREE);
    a.library = [GUARD, FILLER];
    sidelineManually(act, "a", "you", three.uid);
    expect(a.hand).toEqual([GUARD]);
    expect(a.sideline).toEqual([LOWER_THREE]);
  });

  it("下弦之肆 (047): draws a card when sidelined in battle", () => {
    const { a, b, act } = setup("attack");
    const attacker = field(a, "front", W0); // BP2000
    const four = field(b, "front", k("047")); // BP1000
    b.library = [GUARD, FILLER];
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: four.uid });
    expect(b.sideline).toEqual([k("047")]);
    expect(b.hand).toEqual([GUARD]);
  });

  it("下弦之贰 (048): sidelined in our turn, gives up to one opposing front-line character BP-2000 this turn; nothing in the opponent's turn", () => {
    const { game, a, b, act } = setup();
    const two = field(a, "front", k("048"));
    const low = field(b, "front", W0);
    const high = field(b, "front", GUARD);
    field(b, "energy", NINE);
    sidelineManually(act, "a", "you", two.uid);
    expect(choice(game, "a").options).toEqual([low.uid, high.uid]); // only the front line
    pick(act, "a", [high.uid]);
    expect(bpOf(ctx, high)).toBe(1000);
    expect(bpOf(ctx, low)).toBe(2000);

    // Up to one.
    const second = setup();
    const t2 = field(second.a, "front", k("048"));
    const x = field(second.b, "front", W0);
    sidelineManually(second.act, "a", "you", t2.uid);
    pick(second.act, "a", []);
    expect(bpOf(ctx, x)).toBe(2000);

    // The opponent's turn: sidelined in battle, nothing happens.
    const third = setup("attack", "b");
    const t3 = field(third.a, "front", k("048")); // BP3500
    const attacker = field(third.b, "front", HOSHI);
    attacker.bpMod = 1000;
    const victim = field(third.a, "front", W0);
    third.act("b", { type: "attack", attackerUid: attacker.uid });
    third.act("a", { type: "block", blockerUid: t3.uid });
    expect(third.a.sideline).toEqual([k("048")]);
    expect(third.game.pending).toBeNull();
    expect(bpOf(ctx, attacker)).toBe(5000);
    expect(bpOf(ctx, victim)).toBe(2000);
  });

  it("下弦之陆 (049): when sidelined draws a card and discards a card", () => {
    const { game, a, act } = setup();
    const six = field(a, "front", k("049"));
    a.hand.push(W0);
    a.library = [GUARD, FILLER];
    sidelineManually(act, "a", "you", six.uid);
    expect(a.hand).toEqual([W0, GUARD]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:1"]);
    expect(a.hand).toEqual([W0]);
    expect(a.sideline).toEqual([k("049"), GUARD]);
  });

  it("累 (050): when played, if a character was sidelined this turn, gives up to one opposing front-line character BP-1500", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, AMIYA);
    const target = field(b, "front", GUARD);
    a.hand.push(k("050"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(game.pending).toBeNull(); // nothing sidelined yet this turn
    expect(bpOf(ctx, target)).toBe(3000);

    const second = setup();
    energy(second.a, 3, AMIYA);
    const gone = field(second.a, "front", FILLER);
    const low = field(second.b, "front", W0);
    const high = field(second.b, "front", GUARD);
    field(second.b, "energy", NINE);
    sidelineManually(second.act, "a", "you", gone.uid);
    second.a.hand.push(k("050"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(second.game, "a").options).toEqual([low.uid, high.uid]);
    pick(second.act, "a", [high.uid]);
    expect(bpOf(ctx, high)).toBe(1500);
    expect(bpOf(ctx, low)).toBe(2000);

    // The opponent's character counts, and up to one means none is fine.
    const third = setup();
    energy(third.a, 3, AMIYA);
    const theirs = field(third.b, "front", FILLER);
    const keep = field(third.b, "front", GUARD);
    sidelineManually(third.act, "a", "opponent", theirs.uid);
    third.a.hand.push(k("050"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", []);
    expect(bpOf(ctx, keep)).toBe(3000);
  });
});

describe("KMY batch 2: 上弦之鬼", () => {
  it("猗窝座 (051): only the keyword 冲击1", () => {
    expect(KMY_2_ABILITIES[k("051")]).toEqual([]);
    expect(isAutomated(titleCard(k("051")))).toBe(true);
    const { game, a, b, act } = setup("attack");
    const akaza = field(a, "front", k("051"));
    const blocker = field(b, "front", FILLER);
    expect(impactOf(ctx, akaza)).toBe(1);
    act("a", { type: "attack", attackerUid: akaza.uid });
    act("b", { type: "block", blockerUid: blocker.uid });
    expect(b.sideline).toEqual([FILLER]);
    expect(game.pending).toMatchObject({ kind: "damage", amount: 1 });
  });

  it("猗窝座 (052): enters active; may discard 2 hand cards for 【瞄准攻击】 and 【冲击①】 this turn", () => {
    const { game, a, act } = setup();
    energy(a, 3, E2);
    a.hand.push(k("052"), W0, NINE, GUARD);
    act("a", { type: "play", handIndex: 0, line: "front" });
    const akaza = a.front[0]!;
    expect(akaza.rested).toBe(false); // 以活跃状态登场
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    expect(choice(game, "a").min).toBe(2);
    pick(act, "a", ["h:0", "h:2"]);
    expect(a.hand).toEqual([NINE]);
    expect(a.sideline).toEqual([W0, GUARD]);
    expect(hasKeyword(ctx, akaza, "瞄准攻击")).toBe(true);
    expect(impactOf(ctx, akaza)).toBe(1);
    act("a", { type: "end_turn" });
    expect(hasKeyword(ctx, akaza, "瞄准攻击")).toBe(false);
    expect(impactOf(ctx, akaza)).toBe(0);

    // Declining: nothing is discarded and no keyword is gained.
    const second = setup();
    energy(second.a, 3, E2);
    second.a.hand.push(k("052"), W0, NINE);
    second.act("a", { type: "play", handIndex: 0, line: "energy" });
    pick(second.act, "a", ["no"]);
    expect(second.a.hand).toEqual([W0, NINE]);
    expect(hasKeyword(ctx, second.a.energy[second.a.energy.length - 1]!, "瞄准攻击")).toBe(false);
    expect(second.a.energy[second.a.energy.length - 1]!.rested).toBe(false);

    // Fewer than two hand cards: nothing to discard, no question.
    const third = setup();
    energy(third.a, 3, E2);
    third.a.hand.push(k("052"), W0);
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(third.game.pending).toBeNull();
    expect(third.a.hand).toEqual([W0]);
  });
});

describe("KMY batch 2: 妓夫太郎", () => {
  it("妓夫太郎 (053): once per turn pays 1 AP to draw a card", () => {
    const { a, act } = setup();
    const giyutaro = field(a, "front", GYUTARO_0);
    a.library = [GUARD, W0, FILLER];
    act("a", { type: "activate", uid: giyutaro.uid, ability: 0 });
    expect(a.ap.filter((card) => card.rested)).toHaveLength(1);
    expect(a.hand).toEqual([GUARD]);
    expect(() => act("a", { type: "activate", uid: giyutaro.uid, ability: 0 })).toThrow("ONCE_PER_TURN");

    // The AP must be payable.
    const second = setup();
    const g2 = field(second.a, "front", GYUTARO_0);
    second.a.ap.forEach((card) => { card.rested = true; });
    expect(() => second.act("a", { type: "activate", uid: g2.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("妓夫太郎 (054): when played with 〈堕姬〉 on our field, draws a card and discards a card (蕨姬 counts as 〈堕姬〉)", () => {
    for (const daki of [DAKI_1, WARABIHIME]) {
      const { game, a, act } = setup();
      energy(a, 3, AMIYA);
      field(a, "energy", daki);
      a.hand.push(GYUTARO_3, W0);
      a.library = [GUARD, FILLER];
      act("a", { type: "play", handIndex: 0, line: "front" });
      expect(a.hand).toEqual([W0, GUARD]);
      expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
      pick(act, "a", ["h:0"]);
      expect(a.hand).toEqual([GUARD]);
      expect(a.sideline).toEqual([W0]);
    }
    // Without 〈堕姬〉 (only the opponent has one) nothing happens.
    const second = setup();
    energy(second.a, 3, AMIYA);
    field(second.b, "energy", DAKI_1);
    second.a.hand.push(GYUTARO_3, W0);
    second.a.library = [GUARD, FILLER];
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([W0]);
  });

  it("妓夫太郎 (055): Raid onto 妓夫太郎; once per turn becomes active after winning a battle it attacked in; draws when attacking with 〈堕姬〉 on the field", () => {
    const { a, act } = setup();
    energy(a, 4, AMIYA);
    const base = field(a, "energy", GYUTARO_0, true);
    a.hand.push(GYUTARO_4);
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(base.cardId).toBe(GYUTARO_4);
    expect(a.front).toContain(base);
    expect(base.rested).toBe(false);

    // Raiding onto a 妓夫太郎 that already used its own ability 0 this turn does not block 055's ability.
    const natural = setup("main");
    energy(natural.a, 4, AMIYA);
    const drawer = field(natural.a, "front", GYUTARO_0);
    natural.act("a", { type: "activate", uid: drawer.uid, ability: 0 });
    natural.a.hand.push(GYUTARO_4);
    natural.act("a", { type: "raid", handIndex: natural.a.hand.length - 1, targetUid: drawer.uid, toFront: true });
    const wall = field(natural.b, "front", FILLER);
    natural.act("a", { type: "next_phase" });
    natural.act("a", { type: "attack", attackerUid: drawer.uid });
    natural.act("b", { type: "block", blockerUid: wall.uid });
    expect(drawer.rested).toBe(false);

    // Win a battle: active again, once per turn only.
    const attack = setup("attack");
    const giyutaro = field(attack.a, "front", GYUTARO_4);
    const weak1 = field(attack.b, "front", FILLER);
    const weak2 = field(attack.b, "front", FILLER);
    attack.a.library = [GUARD, W0, FILLER];
    attack.act("a", { type: "attack", attackerUid: giyutaro.uid });
    expect(attack.game.pending).toMatchObject({ kind: "block" }); // no 〈堕姬〉: no draw question, straight to the block
    expect(attack.a.hand).toEqual([]);
    attack.act("b", { type: "block", blockerUid: weak1.uid });
    expect(giyutaro.rested).toBe(false);
    attack.act("a", { type: "attack", attackerUid: giyutaro.uid });
    attack.act("b", { type: "block", blockerUid: weak2.uid });
    expect(attack.b.sideline).toEqual([FILLER, FILLER]);
    expect(giyutaro.rested).toBe(true);

    // Unblocked attacks are not battles: it does not become active.
    const third = setup("attack");
    const g3 = field(third.a, "front", GYUTARO_4);
    third.act("a", { type: "attack", attackerUid: g3.uid });
    expect(g3.rested).toBe(true);

    // With 〈堕姬〉 (even a 蕨姬) on our field, attacking draws a card.
    const fourth = setup("attack");
    const g4 = field(fourth.a, "front", GYUTARO_4);
    field(fourth.a, "energy", WARABIHIME);
    fourth.a.library = [GUARD, FILLER];
    fourth.act("a", { type: "attack", attackerUid: g4.uid });
    expect(fourth.a.hand).toEqual([GUARD]);
  });

  it("妓夫太郎 (056): played on the front line, sidelines up to one opposing front-line character with BP 3000 or less; not from the energy line", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, E2);
    const low = field(b, "front", W0);
    const mid = field(b, "front", GUARD);
    field(b, "front", HOSHI);
    field(b, "energy", FILLER);
    a.hand.push(GYUTARO_AP2);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([low.uid, mid.uid]);
    pick(act, "a", [mid.uid]);
    expect(b.sideline).toEqual([GUARD]);

    // Up to one.
    const second = setup();
    energy(second.a, 2, E2);
    field(second.b, "front", W0);
    second.a.hand.push(GYUTARO_AP2);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.b.front).toHaveLength(1);

    // Energy line: not on the front line, so nothing.
    const third = setup();
    energy(third.a, 2, E2);
    field(third.b, "front", W0);
    third.a.hand.push(GYUTARO_AP2);
    third.act("a", { type: "play", handIndex: 0, line: "energy" });
    expect(third.game.pending).toBeNull();
    expect(third.b.front).toHaveLength(1);
  });

  it("妓夫太郎 (056): when sidelined, looks at 3, reveals up to one 〈堕姬〉 (蕨姬 counts) to the hand, the rest to the bottom, then discards", () => {
    const { game, a, act } = setup();
    const giyutaro = field(a, "front", GYUTARO_AP2);
    a.library = [GUARD, WARABIHIME, W0, FILLER];
    a.hand.push(NINE);
    sidelineManually(act, "a", "you", giyutaro.uid);
    expect(choice(game, "a").options).toEqual(["l:1"]);
    pick(act, "a", ["l:1"]);
    pick(act, "a", ["l:1", "l:0"]);
    expect(a.library).toEqual([FILLER, W0, GUARD]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([WARABIHIME]);
    expect(a.sideline).toEqual([GYUTARO_AP2, NINE]);

    // Revealing none: no discard.
    const second = setup();
    const g2 = field(second.a, "front", GYUTARO_AP2);
    second.a.library = [GUARD, DAKI_1, W0, FILLER];
    second.a.hand.push(NINE);
    sidelineManually(second.act, "a", "you", g2.uid);
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1", "l:2"]);
    expect(second.a.hand).toEqual([NINE]);
    expect(second.game.pending).toBeNull();
  });

  it("堕姬 (057): when sidelined, looks at 6, reveals up to one 〈妓夫太郎〉 to the hand, the rest to the bottom, then discards", () => {
    const { game, a, act } = setup();
    const daki = field(a, "front", DAKI_1);
    a.library = [W0, GYUTARO_0, GUARD, GYUTARO_3, NINE, WARABIHIME, FILLER, FILLER];
    a.hand.push(W0);
    sidelineManually(act, "a", "you", daki.uid);
    expect(choice(game, "a").options).toEqual(["l:1", "l:3"]);
    pick(act, "a", ["l:3"]);
    expect(choice(game, "a").options).toHaveLength(5);
    pick(act, "a", ["l:0", "l:1", "l:2", "l:3", "l:4"]);
    expect(a.library).toEqual([FILLER, FILLER, W0, GYUTARO_0, GUARD, NINE, WARABIHIME]);
    pick(act, "a", ["h:1"]);
    expect(a.hand).toEqual([W0]);
    expect(a.sideline).toEqual([DAKI_1, GYUTARO_3]);
  });

  it("堕姬 (058): when played or sidelined, puts up to one 妓夫太郎 (cost 3 or less, AP 1) from the sideline onto the front line, active", () => {
    const { game, a, act } = setup();
    energy(a, 3, AMIYA);
    a.sideline = [GUARD, GYUTARO_4, GYUTARO_3, GYUTARO_AP2, GYUTARO_0];
    a.hand.push(DAKI_3);
    act("a", { type: "play", handIndex: 0, line: "energy" });
    // 055 (cost 4) and 056 (AP 2) are not eligible.
    expect(choice(game, "a").options).toEqual(["s:2", "s:4"]);
    pick(act, "a", ["s:4"]);
    expect(game.pending).toBeNull();
    expect(a.front.map((card) => card.cardId)).toEqual([GYUTARO_0]);
    expect(a.front[0]!.rested).toBe(false);
    expect(a.sideline).toEqual([GUARD, GYUTARO_4, GYUTARO_3, GYUTARO_AP2]);

    // Sidelined: the same.
    const second = setup();
    const daki = field(second.a, "front", DAKI_3);
    second.a.sideline = [GYUTARO_3, GYUTARO_0];
    sidelineManually(second.act, "a", "you", daki.uid);
    expect(choice(second.game, "a").options).toEqual(["s:0", "s:1"]);
    pick(second.act, "a", ["s:0"]);
    expect(second.a.front.map((card) => card.cardId)).toEqual([GYUTARO_3]);
    expect(second.a.front[0]!.rested).toBe(false);

    // Up to one.
    const third = setup();
    const d3 = field(third.a, "front", DAKI_3);
    third.a.sideline = [GYUTARO_3, GYUTARO_0];
    sidelineManually(third.act, "a", "you", d3.uid);
    pick(third.act, "a", []);
    expect(third.a.front).toEqual([]);
  });

  it("堕姬 (059): Raid onto 堕姬 (or 蕨姬); BP+500 in our turn with 〈妓夫太郎〉 on our field", () => {
    const { a, act } = setup();
    energy(a, 3, AMIYA);
    const base = field(a, "energy", DAKI_1, true);
    const plain = field(a, "energy", FILLER);
    a.hand.push(DAKI_RAID, DAKI_RAID);
    expect(() => act("a", { type: "raid", handIndex: 0, targetUid: plain.uid, toFront: true })).toThrow("RAID_TARGET_INVALID");
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(base.cardId).toBe(DAKI_RAID);
    expect(base.rested).toBe(false);
    expect(bpOf(ctx, base)).toBe(3500);
    field(a, "energy", GYUTARO_0);
    refresh(act);
    expect(bpOf(ctx, base)).toBe(4000);

    // A 蕨姬 (regarded as 〈堕姬〉) is a valid Raid target too.
    const second = setup();
    energy(second.a, 3, AMIYA);
    const sister = field(second.a, "energy", WARABIHIME, true);
    refresh(second.act);
    second.a.hand.push(DAKI_RAID);
    second.act("a", { type: "raid", handIndex: 0, targetUid: sister.uid, toFront: true });
    expect(sister.cardId).toBe(DAKI_RAID);

    // Not in the opponent's turn.
    const third = setup("attack", "b");
    const raider = field(third.a, "front", DAKI_RAID);
    field(third.a, "energy", GYUTARO_0);
    third.act("b", { type: "manual", manual: { op: "ap", apId: "b:ap0", act: "activate" } });
    expect(bpOf(ctx, raider)).toBe(3500);
  });

  it("堕姬 (059): when sidelined with 〈妓夫太郎〉 on our field, may discard a card to return in the front line, resting", () => {
    const { game, a, act } = setup();
    const daki = field(a, "front", DAKI_RAID);
    field(a, "energy", GYUTARO_0);
    a.hand.push(W0, NINE);
    sidelineManually(act, "a", "you", daki.uid);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([NINE]);
    expect(a.sideline).toEqual([W0]);
    expect(a.front.map((card) => card.cardId)).toEqual([DAKI_RAID]);
    expect(a.front[0]!.rested).toBe(true);

    // Declining.
    const second = setup();
    const d2 = field(second.a, "front", DAKI_RAID);
    field(second.a, "front", GYUTARO_0);
    second.a.hand.push(W0);
    sidelineManually(second.act, "a", "you", d2.uid);
    pick(second.act, "a", ["no"]);
    expect(second.a.hand).toEqual([W0]);
    expect(second.a.sideline).toEqual([DAKI_RAID]);

    // No 〈妓夫太郎〉 on the field, or no hand card: no question.
    const third = setup();
    const d3 = field(third.a, "front", DAKI_RAID);
    third.a.hand.push(W0);
    sidelineManually(third.act, "a", "you", d3.uid);
    expect(third.game.pending).toBeNull();
    const fourth = setup();
    const d4 = field(fourth.a, "front", DAKI_RAID);
    field(fourth.a, "front", GYUTARO_0);
    sidelineManually(fourth.act, "a", "you", d4.uid);
    expect(fourth.game.pending).toBeNull();
    expect(fourth.a.sideline).toEqual([DAKI_RAID]);
  });

  it("蕨姬 (060): also regarded as 〈堕姬〉", () => {
    const { a, act } = setup();
    const sister = field(a, "energy", WARABIHIME);
    expect(isAutomated(titleCard(WARABIHIME))).toBe(true);
    refresh(act);
    expect(flagsOf(sister)).toContain("name:堕姬");
    // The name also counts in the hand and sideline: 京极屋 (061) can return it as a 〈堕姬〉.
    const second = setup();
    const site = field(second.a, "energy", k("061"));
    second.a.sideline = [WARABIHIME, GUARD, W0];
    second.act("a", { type: "activate", uid: site.uid, ability: 0 });
    expect(choice(second.game, "a").options).toEqual(["s:0"]);
  });
});

describe("KMY batch 2: site and events", () => {
  it("京极屋 (061): rests and leaves to return up to one 〈妓夫太郎〉 or 〈堕姬〉 from the sideline to the hand", () => {
    const { game, a, act } = setup();
    const site = field(a, "energy", k("061"));
    a.sideline = [GUARD, GYUTARO_0, DAKI_1, WARABIHIME, W0];
    act("a", { type: "activate", uid: site.uid, ability: 0 });
    expect(a.energy).toEqual([]);
    expect(choice(game, "a").options).toEqual(["s:1", "s:2", "s:3"]);
    expect(choice(game, "a").max).toBe(1);
    pick(act, "a", ["s:3"]);
    expect(a.hand).toEqual([WARABIHIME]);
    expect(a.sideline).toEqual([GUARD, GYUTARO_0, DAKI_1, W0, k("061")]);

    // Up to one: none is fine, and the site has still gone.
    const second = setup();
    const s2 = field(second.a, "energy", k("061"));
    second.a.sideline = [GYUTARO_0];
    second.act("a", { type: "activate", uid: s2.uid, ability: 0 });
    pick(second.act, "a", []);
    expect(second.a.hand).toEqual([]);
    expect(second.a.sideline).toContain(k("061"));

    // A rested site cannot pay the cost.
    const third = setup();
    const s3 = field(third.a, "energy", k("061"), true);
    expect(() => third.act("a", { type: "activate", uid: s3.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("鬼之力 (062): BP+1000, plus +1000 for each character sidelined this turn; at 5000 or more also gains 冲击+1", () => {
    const { game, a, act } = setup();
    energy(a, 2, SITE_E);
    const target = field(a, "front", W0); // BP2000
    const bystander = field(a, "front", FILLER);
    a.hand.push(k("062"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([target.uid, bystander.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(3000);
    expect(impactOf(ctx, target)).toBe(0);
    expect(a.sideline).toEqual([k("062")]);

    // Two characters (one of each player) sidelined this turn: +3000 in all, 5000 reached.
    const second = setup();
    energy(second.a, 2, SITE_E);
    const t2 = field(second.a, "front", W0);
    const mine = field(second.a, "energy", FILLER);
    const theirs = field(second.b, "front", FILLER);
    sidelineManually(second.act, "a", "you", mine.uid);
    sidelineManually(second.act, "a", "opponent", theirs.uid);
    second.a.hand.push(k("062"));
    second.act("a", { type: "event", handIndex: 0 });
    // The only character left is the target (no question); +1000 and +2000 for the two that left.
    expect(second.game.pending).toBeNull();
    expect(bpOf(ctx, t2)).toBe(5000);
    expect(impactOf(ctx, t2)).toBe(1); // 冲击+1 without Impact gives 冲击①

    // One that left: 2000 + 1000 + 1000 = 4000, below 5000: no Impact.
    const third = setup();
    energy(third.a, 2, SITE_E);
    const t3 = field(third.a, "front", W0);
    const gone = field(third.a, "energy", FILLER);
    sidelineManually(third.act, "a", "you", gone.uid);
    third.a.hand.push(k("062"));
    third.act("a", { type: "event", handIndex: 0 });
    expect(bpOf(ctx, t3)).toBe(4000);
    expect(impactOf(ctx, t3)).toBe(0);

    // A character that already has 冲击① gets one more.
    const fourth = setup();
    energy(fourth.a, 2, SITE_E);
    const akaza = field(fourth.a, "front", k("051")); // BP4000
    fourth.a.hand.push(k("062"));
    fourth.act("a", { type: "event", handIndex: 0 });
    expect(bpOf(ctx, akaza)).toBe(5000);
    expect(impactOf(ctx, akaza)).toBe(2);
    fourth.act("a", { type: "end_turn" });
    expect(impactOf(ctx, akaza)).toBe(1);
    expect(bpOf(ctx, akaza)).toBe(4000);
  });

  it("全部低下头 跪下行礼 (063): sidelines one own character, then one opposing front-line character; draws a card either way", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, SITE_E);
    const mine = field(a, "front", FILLER);
    const spare = field(a, "energy", W0);
    const front1 = field(b, "front", GUARD);
    const front2 = field(b, "front", HOSHI);
    field(b, "energy", NINE);
    a.hand.push(k("063"));
    a.library = [GUARD, FILLER];
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([mine.uid, spare.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [spare.uid]);
    expect(a.sideline).toContain(W0);
    expect(choice(game, "a").options).toEqual([front1.uid, front2.uid]);
    pick(act, "a", [front2.uid]);
    expect(b.sideline).toEqual([HOSHI]);
    expect(a.front).toEqual([mine]);
    expect(a.hand).toEqual([GUARD]);

    // No character of ours to sideline: nothing to the opponent, but the draw still happens.
    const second = setup();
    energy(second.a, 3, SITE_E);
    field(second.b, "front", GUARD);
    second.a.hand.push(k("063"));
    second.a.library = [GUARD, FILLER];
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.game.pending).toBeNull();
    expect(second.b.sideline).toEqual([]);
    expect(second.a.hand).toEqual([GUARD]);
  });

  it("肃清 (064): sidelines one own character, then one AP card becomes active; draws 2 either way", () => {
    const { game, a, act } = setup();
    energy(a, 2, SITE_E);
    const mine = field(a, "front", FILLER);
    const keep = field(a, "front", W0);
    a.hand.push(k("064"));
    a.library = [GUARD, W0, FILLER];
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([mine.uid, keep.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [mine.uid]);
    expect(a.front).toEqual([keep]);
    const rested = a.ap.find((card) => card.rested)!;
    expect(choice(game, "a").options).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [`ap:${rested.id}`]);
    expect(a.ap.every((card) => !card.rested)).toBe(true);
    expect(a.hand).toEqual([GUARD, W0]);
    expect(a.sideline).toEqual([FILLER, k("064")]);

    // No character to sideline: no AP card is readied, but 2 cards are drawn.
    const second = setup();
    energy(second.a, 2, SITE_E);
    second.a.hand.push(k("064"));
    second.a.library = [GUARD, W0, FILLER];
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.game.pending).toBeNull();
    expect(second.a.ap.filter((card) => card.rested)).toHaveLength(1);
    expect(second.a.hand).toEqual([GUARD, W0]);
  });

  it("永远在一起 绝不分离 (065): looks at 7, reveals up to one 〈妓夫太郎〉 and up to one 〈堕姬〉 (蕨姬 counts), the rest go to the bottom", () => {
    const { game, a, act } = setup();
    energy(a, 2, SITE_E);
    a.library = [GYUTARO_0, DAKI_1, WARABIHIME, GYUTARO_3, GUARD, W0, NINE, FILLER, FILLER];
    a.hand.push(k("065"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual(["l:0", "l:3"]);
    pick(act, "a", ["l:3"]);
    expect(choice(game, "a").options).toEqual(["l:1", "l:2"]);
    pick(act, "a", ["l:2"]);
    expect(a.hand).toEqual([GYUTARO_3, WARABIHIME]);
    expect(choice(game, "a").options).toHaveLength(5);
    pick(act, "a", ["l:4", "l:3", "l:2", "l:1", "l:0"]); // NINE, W, Guard, 堕姬, 妓夫太郎
    expect(a.library).toEqual([FILLER, FILLER, NINE, W0, GUARD, DAKI_1, GYUTARO_0]);
    expect(a.sideline).toEqual([k("065")]);

    // Up to one of each: only one kind, or none.
    const second = setup();
    energy(second.a, 2, SITE_E);
    second.a.library = [GYUTARO_0, DAKI_1, GUARD, W0, NINE, FILLER, FILLER];
    second.a.hand.push(k("065"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:1"]);
    expect(second.a.hand).toEqual([DAKI_1]);
    pick(second.act, "a", ["l:0", "l:1", "l:2", "l:3", "l:4", "l:5"]);
    expect(second.game.pending).toBeNull();
    expect(second.a.library).toHaveLength(6);
  });
});
