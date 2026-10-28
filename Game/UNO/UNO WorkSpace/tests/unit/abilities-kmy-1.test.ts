/**
 * KMY (鬼灭之刃) cards, batch 1 (UA05BT/KMY-1-001 .. 033): one test per card, set up as its printed text describes and checked against the text.
 * Card text comes from `Cards/cards.json` (no card images exist on this machine).
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, energyOf, hasKeyword, impactOf } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { KMY_1_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-kmy-1.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { choice, ctx, energy, field, FILLER, setup } from "./ability-harness.ts";

const k = (n: string): string => `UA05BT/KMY-1-${n}`;
type Act = (who: string, action: Parameters<ReturnType<typeof setup>["act"]>[1]) => void;
const pick = (act: Act, who: string, picks: string[]): void => act(who, { type: "choose", picks });
const sidelineManually = (act: Act, who: string, owner: "you" | "opponent", uid: string): void => act(who, { type: "manual", manual: { op: "field", owner, uid, act: "sideline" } });
/** Lets the continuous abilities settle (the harness puts cards on the field directly): any action runs the engine's refresh. */
const refresh = (act: Act): void => act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "activate" } });

// Helper cards.
const MURATA = k("016"); // 村田: yellow, cost 0, makes one yellow energy on the energy line, 撤步
const TANJIRO = k("005"); // 灶门 炭治郎: yellow, cost 0, BP1500, no ability
const PILLAR = k("018"); // 宇髓 天元: 柱, yellow, makes two yellow energy, 撤步 only
const OYAKATA = k("002"); // 产屋敷 耀哉
const W0 = "UC01BT/ARK-1-009"; // W: yellow, cost 0, BP2000
const NINE = "UC01BT/ARK-1-088"; // 九: red, cost 0, BP2000
const AMIYA = "UCEX01BT/ARK-2-047"; // 阿米娅: purple, cost 0
const MISHA = "UC01BT/ARK-1-001"; // 米莎: BP1000
const GUARD = "UC01ST/ARK-1-103"; // Guard: blue, cost 3, BP3000
const HOSHI = "UC01BT/ARK-1-092"; // 星熊: red, BP4000

describe("KMY batch 1: the table", () => {
  it("has every card automated and the names the filters rely on", () => {
    for (const number of Object.keys(KMY_1_ABILITIES)) expect(isAutomated(titleCard(number)), number).toBe(true);
    expect(Object.keys(KMY_1_ABILITIES)).toHaveLength(32);
    expect(titleCard(k("002")).name).toBe("产屋敷 耀哉");
    expect(titleCard(k("005")).name).toBe("灶门 炭治郎");
    expect(titleCard(k("009")).name).toBe("灶门 祢豆子");
    expect(titleCard(k("015")).name).toBe("嘴平 伊之助");
    expect(titleCard(k("003")).name).toBe("鳞泷 左近次");
    expect(titleCard(k("018")).stats.affinities).toEqual(["柱"]);
  });
});

describe("KMY batch 1: yellow characters", () => {
  it("我妻 善逸 (001): looks at 3, reveals up to one 炭治郎 / 祢豆子 / 伊之助 to the hand, the rest to the bottom, and only then discards", () => {
    const { game, a, act } = setup();
    energy(a, 2, MURATA);
    a.library = [GUARD, TANJIRO, W0, GUARD];
    a.hand.push(k("001"), W0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:1"]); // only 灶门 炭治郎 qualifies
    pick(act, "a", ["l:1"]);
    pick(act, "a", ["l:0", "l:1"]);
    expect(a.library).toEqual([GUARD, GUARD, W0]);
    // The card was added: one hand card goes to the sideline.
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([TANJIRO]);
    expect(a.sideline).toEqual([W0]);

    // Up to one: revealing nothing means no discard.
    const second = setup();
    energy(second.a, 2, MURATA);
    second.a.library = [TANJIRO, GUARD, W0];
    second.a.hand.push(k("001"), W0);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1", "l:2"]);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([W0]);
    expect(second.a.sideline).toEqual([]);

    // A 嘴平 伊之助 or 灶门 祢豆子 qualifies as well; with nothing to reveal no question about the reveal is asked.
    const third = setup();
    energy(third.a, 2, MURATA);
    third.a.library = [k("015"), k("009"), GUARD];
    third.a.hand.push(k("001"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(third.game).options).toEqual(["l:0", "l:1"]);
    const fourth = setup();
    energy(fourth.a, 2, MURATA);
    fourth.a.library = [GUARD, NINE, W0];
    fourth.a.hand.push(k("001"));
    fourth.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(fourth.act, "a", ["l:0", "l:1", "l:2"]);
    expect(fourth.game.pending).toBeNull();
  });

  it("产屋敷 耀哉 (002): rests, discards a card and leaves the field to make up to one AP card active", () => {
    const { game, a, act } = setup();
    const oyakata = field(a, "energy", OYAKATA);
    a.ap[0]!.rested = true;
    a.ap[1]!.rested = true;
    a.hand.push(GUARD);
    act("a", { type: "activate", uid: oyakata.uid, ability: 0 });
    // Costs are paid: the card is in the sideline, so is the discarded card.
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([OYAKATA, GUARD]);
    expect(choice(game, "a").options).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
    pick(act, "a", ["ap:a:ap1"]);
    expect(a.ap.map((card) => card.rested)).toEqual([true, false, false]);

    // Up to one: choosing none activates nothing.
    const second = setup();
    const other = field(second.a, "energy", OYAKATA);
    second.a.ap[0]!.rested = true;
    second.a.hand.push(GUARD);
    second.act("a", { type: "activate", uid: other.uid, ability: 0 });
    pick(second.act, "a", []);
    expect(second.a.ap[0]!.rested).toBe(true);

    // The cost needs a hand card.
    const third = setup();
    const empty = field(third.a, "energy", OYAKATA);
    expect(() => third.act("a", { type: "activate", uid: empty.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("鳞泷 左近次 (003): rests to give another character BP+1000 this turn", () => {
    const { game, a, act } = setup();
    const sakonji = field(a, "front", k("003"));
    const one = field(a, "front", FILLER);
    const two = field(a, "energy", W0);
    act("a", { type: "activate", uid: sakonji.uid, ability: 0 });
    expect(sakonji.rested).toBe(true);
    expect(choice(game, "a").options).toEqual([one.uid, two.uid]); // not itself
    pick(act, "a", [two.uid]);
    expect(bpOf(ctx, two)).toBe(3000);
    expect(bpOf(ctx, one)).toBe(1500);
    expect(bpOf(ctx, sakonji)).toBe(2500);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, two)).toBe(2000);
    // Resting is a cost: once rested it cannot be used again.
    const second = setup();
    const used = field(second.a, "front", k("003"), true);
    expect(() => second.act("a", { type: "activate", uid: used.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("鎹鸦 (004): once per turn rests for +1 yellow energy this turn and leaves when the main phase ends", () => {
    const { a, act } = setup();
    const crow = field(a, "energy", k("004"));
    expect(energyOf(ctx, a, "yellow")).toBe(1);
    act("a", { type: "activate", uid: crow.uid, ability: 0 });
    expect(crow.rested).toBe(true);
    expect(energyOf(ctx, a, "yellow")).toBe(2);
    expect(() => act("a", { type: "activate", uid: crow.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([k("004")]);
  });

  it("灶门 炭治郎 (006): puts a 〈灶门 祢豆子〉 of cost 2 or less and AP 1 from the hand onto the front line, resting", () => {
    const { game, a, act } = setup();
    energy(a, 3, MURATA);
    a.hand.push(k("006"), k("011"), k("009"), GUARD, k("010"));
    act("a", { type: "play", handIndex: 0, line: "energy" });
    // 祢豆子 011 costs 3: not eligible.
    expect(choice(game, "a").options).toEqual(["h:1", "h:3"]);
    pick(act, "a", ["h:3"]);
    // No question about the line: it enters the front line.
    expect(game.pending).toBeNull();
    expect(a.front.map((card) => card.cardId)).toEqual([k("010")]);
    expect(a.front[0]!.rested).toBe(true);
    expect(a.hand).toEqual([k("011"), k("009"), GUARD]);

    // Up to one.
    const second = setup();
    energy(second.a, 3, MURATA);
    second.a.hand.push(k("006"), k("009"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.a.front.map((card) => card.cardId)).toEqual([k("006")]);
    expect(second.a.hand).toEqual([k("009")]);
  });

  it("灶门 炭治郎 (007): sidelines up to one opposing front-line character with BP 3000 or less", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, MURATA);
    const low = field(b, "front", W0);
    const mid = field(b, "front", GUARD);
    field(b, "front", HOSHI);
    field(b, "energy", FILLER);
    a.hand.push(k("007"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([low.uid, mid.uid]);
    pick(act, "a", [mid.uid]);
    expect(b.sideline).toEqual([GUARD]);

    const second = setup();
    energy(second.a, 4, MURATA);
    field(second.b, "front", W0);
    second.a.hand.push(k("007"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.b.front).toHaveLength(1);
    expect(second.b.sideline).toEqual([]);
  });

  it("灶门 炭治郎 (008): returns a cheap 祢豆子 from the sideline, then puts one from the hand resting on a line of your choice", () => {
    const { game, a, act } = setup();
    energy(a, 2, PILLAR);
    a.sideline.push(GUARD, k("009"), k("011"), k("007"));
    a.hand.push(k("008"), k("010"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["s:1", "s:2"]);
    pick(act, "a", ["s:2"]);
    expect(a.hand).toEqual([k("010"), k("011")]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(choice(game, "a").options).toEqual(["line:front", "line:energy"]);
    pick(act, "a", ["line:energy"]);
    expect(a.energy.filter((card) => card.cardId === k("010"))).toHaveLength(1);
    expect(a.energy[a.energy.length - 1]!.rested).toBe(true);
    expect(a.hand).toEqual([k("011")]);

    // Both parts are optional ("up to one"), and the card just returned can be put onto the field at once.
    const second = setup();
    energy(second.a, 2, PILLAR);
    second.a.sideline.push(k("009"));
    second.a.hand.push(k("008"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.game.pending).toBeNull(); // nothing in the hand to put onto the field
    expect(second.a.hand).toEqual([]);
    const third = setup();
    energy(third.a, 2, PILLAR);
    third.a.sideline.push(k("009"));
    third.a.hand.push(k("008"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", ["s:0"]);
    pick(third.act, "a", ["h:0"]);
    pick(third.act, "a", ["line:front"]);
    expect(third.a.front.map((card) => card.cardId)).toEqual([k("008"), k("009")]);
    expect(third.a.front[1]!.rested).toBe(true);
    expect(third.a.hand).toEqual([]);
  });

  it("灶门 炭治郎 (008): Raid onto 灶门 炭治郎, impact 1", () => {
    const { game, a, act } = setup();
    energy(a, 2, PILLAR);
    const base = field(a, "energy", TANJIRO, true);
    a.hand.push(k("008"));
    a.sideline.push(k("009"));
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(base.cardId).toBe(k("008"));
    expect(base.rested).toBe(false);
    expect(a.front).toContain(base);
    expect(impactOf(ctx, base)).toBe(1);
    // The 【登场时】 ability asks about the sideline, then about the hand and the line.
    pick(act, "a", ["s:0"]);
    pick(act, "a", ["h:0"]);
    pick(act, "a", ["line:front"]);
    expect(game.pending).toBeNull();
    expect(a.front.map((card) => card.cardId)).toEqual([k("008"), k("009")]);
    expect(a.front[1]!.rested).toBe(true);
  });

  it("灶门 祢豆子 (009): BP+1000 on our turn while 灶门 炭治郎 is on our field", () => {
    const { a, act } = setup();
    const nezuko = field(a, "front", k("009"));
    refresh(act);
    expect(bpOf(ctx, nezuko)).toBe(1500);
    field(a, "energy", TANJIRO);
    refresh(act);
    expect(bpOf(ctx, nezuko)).toBe(2500);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, nezuko)).toBe(1500); // the opponent's turn
  });

  it("灶门 祢豆子 (010): on the front line with 炭治郎 on our field, BP-1000 to an opposing front-line character with BP 1500 or more", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, MURATA);
    field(a, "energy", TANJIRO);
    const big = field(b, "front", W0);
    const small = field(b, "front", MISHA);
    const mid = field(b, "front", FILLER);
    a.hand.push(k("010"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([big.uid, mid.uid]);
    pick(act, "a", [big.uid]);
    expect(bpOf(ctx, big)).toBe(1000);
    expect(bpOf(ctx, small)).toBe(1000);
    expect(bpOf(ctx, mid)).toBe(1500);
    expect(game.pending).toBeNull();

    // Without 灶门 炭治郎: nothing. On the energy line: nothing.
    const second = setup();
    energy(second.a, 2, MURATA);
    field(second.b, "front", W0);
    second.a.hand.push(k("010"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    const third = setup();
    energy(third.a, 2, MURATA);
    field(third.a, "front", TANJIRO);
    field(third.b, "front", W0);
    third.a.hand.push(k("010"));
    third.act("a", { type: "play", handIndex: 0, line: "energy" });
    expect(third.game.pending).toBeNull();
    expect(bpOf(ctx, third.b.front[0]!)).toBe(2000);
  });

  it("灶门 祢豆子 (011): +500 BP with 炭治郎 on our turn; attacking, may swap the front-line 炭治郎 with an energy-line character", () => {
    const { game, a, act } = setup("attack");
    const nezuko = field(a, "front", k("011"));
    const tanjiro = field(a, "front", TANJIRO);
    const keep = field(a, "energy", FILLER);
    const swap = field(a, "energy", W0);
    act("a", { type: "attack", attackerUid: nezuko.uid });
    expect(bpOf(ctx, nezuko)).toBe(4000);
    // The 炭治郎 is the only choice for the front line (no question); the energy line has two candidates.
    expect(choice(game, "a").options).toEqual([keep.uid, swap.uid]);
    pick(act, "a", [swap.uid]);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.front).toEqual([nezuko, swap]);
    expect(a.energy).toEqual([keep, tanjiro]);

    // Declining keeps the positions.
    const second = setup("attack");
    const n2 = field(second.a, "front", k("011"));
    const t2 = field(second.a, "front", TANJIRO);
    const e1 = field(second.a, "energy", FILLER);
    field(second.a, "energy", W0);
    second.act("a", { type: "attack", attackerUid: n2.uid });
    pick(second.act, "a", [e1.uid]);
    pick(second.act, "a", ["no"]);
    expect(second.a.front).toEqual([n2, t2]);

    // No 炭治郎 on the front line: nothing to swap.
    const third = setup("attack");
    const n3 = field(third.a, "front", k("011"));
    field(third.a, "energy", TANJIRO);
    third.act("a", { type: "attack", attackerUid: n3.uid });
    expect(third.game.pending).toMatchObject({ kind: "damage" });
  });

  it("不死川 玄弥 (012): only the keyword 冲击无效, which stops the attacker's Impact", () => {
    expect(KMY_1_ABILITIES[k("012")]).toEqual([]);
    expect(isAutomated(titleCard(k("012")))).toBe(true);
    const { game, a, b, act } = setup("attack");
    const inosuke = field(a, "front", k("015")); // BP2500, 冲击1
    const genya = field(b, "front", k("012")); // BP2000, 冲击无效
    act("a", { type: "attack", attackerUid: inosuke.uid });
    act("b", { type: "block", blockerUid: genya.uid });
    expect(b.sideline).toEqual([k("012")]);
    expect(game.pending).toBeNull(); // no Impact damage

    const second = setup("attack");
    const attacker = field(second.a, "front", k("015"));
    const plain = field(second.b, "front", FILLER);
    second.act("a", { type: "attack", attackerUid: attacker.uid });
    second.act("b", { type: "block", blockerUid: plain.uid });
    expect(second.game.pending).toMatchObject({ kind: "damage", amount: 1 });
  });

  it("不死川 玄弥 (013): on our turn, once, when an opposing front-line character leaves, may draw and then discard", () => {
    const { game, a, b, act } = setup();
    field(a, "front", k("013"));
    a.hand.push(NINE);
    const one = field(b, "front", FILLER);
    const two = field(b, "front", W0);
    sidelineManually(act, "a", "opponent", one.uid);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.hand).toEqual([NINE, FILLER]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([FILLER]);
    expect(a.sideline).toEqual([NINE]);
    // Once per turn: the second one asks nothing.
    sidelineManually(act, "a", "opponent", two.uid);
    expect(game.pending).toBeNull();
    expect(b.sideline).toEqual([FILLER, W0]);
    // The energy line does not count.
    const second = setup();
    field(second.a, "front", k("013"));
    const onEnergy = field(second.b, "energy", FILLER);
    sidelineManually(second.act, "a", "opponent", onEnergy.uid);
    expect(second.game.pending).toBeNull();
    // Answering no: nothing drawn.
    const third = setup();
    field(third.a, "front", k("013"));
    const target = field(third.b, "front", FILLER);
    third.a.hand.push(NINE);
    sidelineManually(third.act, "a", "opponent", target.uid);
    pick(third.act, "a", ["no"]);
    expect(third.a.hand).toEqual([NINE]);
    expect(third.game.pending).toBeNull();
  });

  it("不死川 玄弥 (013): not on the opponent's turn, and not for our own characters; a battle counts as well", () => {
    const { game, a, b, act } = setup("main", "b");
    field(a, "front", k("013"));
    const mine = field(b, "front", FILLER);
    sidelineManually(act, "b", "you", mine.uid);
    expect(game.pending).toBeNull();

    const second = setup();
    field(second.a, "front", k("013"));
    const own = field(second.a, "front", FILLER);
    sidelineManually(second.act, "a", "you", own.uid);
    expect(second.game.pending).toBeNull();

    // Battle: our attacker wins against a blocker.
    const third = setup("attack");
    field(third.a, "front", k("013"));
    const attacker = field(third.a, "front", W0);
    const blocker = field(third.b, "front", FILLER);
    third.act("a", { type: "attack", attackerUid: attacker.uid });
    third.act("b", { type: "block", blockerUid: blocker.uid });
    expect(third.b.sideline).toEqual([FILLER]);
    expect(choice(third.game, "a").purpose).toBe("confirm");
  });

  it("栗花落 香奈乎 (014): makes +1 yellow energy only while active", () => {
    const { a, act } = setup();
    const kanao = field(a, "energy", k("014"));
    refresh(act);
    expect(energyOf(ctx, a, "yellow")).toBe(2);
    kanao.rested = true;
    act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "rest" } }); // any action refreshes the continuous effects
    expect(energyOf(ctx, a, "yellow")).toBe(1);
  });

  it("嘴平 伊之助 (015): 冲击1; on the front line it leaves at the end of our attack phase while active", () => {
    const { a, act } = setup("attack");
    const inosuke = field(a, "front", k("015"));
    expect(impactOf(ctx, inosuke)).toBe(1);
    act("a", { type: "next_phase" });
    expect(a.front).toEqual([]);
    expect(a.sideline).toEqual([k("015")]);

    // Having attacked (resting) it stays.
    const second = setup("attack");
    const attacker = field(second.a, "front", k("015"));
    const genya = field(second.b, "front", k("012"));
    second.act("a", { type: "attack", attackerUid: attacker.uid });
    second.act("b", { type: "block", blockerUid: genya.uid });
    expect(second.game.pending).toBeNull();
    second.act("a", { type: "next_phase" });
    expect(second.a.front).toEqual([attacker]);

    // On the energy line it does not leave.
    const third = setup("attack");
    const resting = field(third.a, "energy", k("015"));
    third.act("a", { type: "next_phase" });
    expect(third.a.energy).toEqual([resting]);
  });

  it("嘴平 伊之助 (015): leaves when it loses a battle it attacked in; winning it stays", () => {
    const { a, b, act } = setup("attack");
    const inosuke = field(a, "front", k("015")); // BP2500
    const wall = field(b, "front", HOSHI); // BP4000
    act("a", { type: "attack", attackerUid: inosuke.uid });
    act("b", { type: "block", blockerUid: wall.uid });
    expect(a.front).toEqual([]);
    expect(a.sideline).toEqual([k("015")]);
    expect(b.front).toEqual([wall]);

    // Equal BP is a win for the attacker: it stays.
    const second = setup("attack");
    const same = field(second.a, "front", k("015"));
    const equal = field(second.b, "front", k("012"));
    equal.bpMod = 500; // 2500
    second.act("a", { type: "attack", attackerUid: same.uid });
    second.act("b", { type: "block", blockerUid: equal.uid });
    expect(second.a.front).toEqual([same]);
    expect(second.b.sideline).toEqual([k("012")]);
  });

  it("村田 (016): only the keyword 撤步 (front line to energy line in the movement phase)", () => {
    expect(KMY_1_ABILITIES[k("016")]).toEqual([]);
    expect(isAutomated(titleCard(k("016")))).toBe(true);
    const { a, act } = setup("movement");
    const murata = field(a, "front", k("016"));
    const plain = field(a, "front", FILLER);
    expect(() => act("a", { type: "move", toFront: [], toEnergy: [plain.uid], remove: [] })).toThrow("STEP_REQUIRED");
    act("a", { type: "move", toFront: [], toEnergy: [murata.uid], remove: [] });
    expect(a.energy).toEqual([murata]);
  });

  it("伊黑 小芭内 (017): draws a card, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 2, MURATA);
    a.library = [W0, GUARD];
    a.hand.push(k("017"), GUARD);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([W0]);
    expect(a.sideline).toEqual([GUARD]);
    expect(a.library).toEqual([GUARD]);
  });

  it("宇髓 天元 (018): only the keyword 撤步, and 2 yellow energy once it is on the energy line", () => {
    expect(KMY_1_ABILITIES[k("018")]).toEqual([]);
    expect(isAutomated(titleCard(k("018")))).toBe(true);
    const { a, act } = setup("movement");
    const tengen = field(a, "front", k("018"));
    expect(hasKeyword(ctx, tengen, "撤步")).toBe(true);
    act("a", { type: "move", toFront: [], toEnergy: [tengen.uid], remove: [] });
    expect(energyOf(ctx, a, "yellow")).toBe(2);
  });

  it("甘露寺 蜜璃 (019): returns another character of cost 1 or less to the hand, or else herself", () => {
    const { game, a, act } = setup();
    energy(a, 1, MURATA);
    const keep = field(a, "front", FILLER);
    const back = field(a, "front", W0);
    field(a, "energy", k("006")); // cost 3: not eligible
    a.hand.push(k("019"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([keep.uid, back.uid, ...a.energy.filter((card) => card.cardId === MURATA).map((card) => card.uid)]);
    pick(act, "a", [back.uid]);
    expect(a.hand).toEqual([W0]);
    expect(a.front.map((card) => card.cardId)).toEqual([FILLER, k("019")]);

    const second = setup();
    field(second.a, "energy", k("006")); // cost 3 (not eligible), makes the one energy needed
    second.a.hand.push(k("019"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([k("019")]);
  });

  describe("甘露寺 蜜璃 (020) and the 柱 count", () => {
    /** 甘露寺 is played from the hand; `pillars` 柱 (and 耀哉 when asked) are already on our field (the first three on the front line). */
    const board = (pillars: number, withOyakata: boolean, line: "front" | "energy" = "front") => {
      const s = setup();
      const support = [...(withOyakata ? [OYAKATA] : []), ...Array<string>(pillars).fill(PILLAR)];
      const onFront = line === "energy" ? 0 : Math.min(support.length, 3);
      support.forEach((cardId, index) => field(s.a, index < onFront ? "front" : "energy", cardId));
      if (line === "front") while (s.a.energy.length < 4) field(s.a, "energy", MURATA);
      const low = field(s.b, "front", W0);
      const mid = field(s.b, "front", GUARD);
      const high = field(s.b, "front", HOSHI);
      const huge = field(s.b, "front", GUARD);
      huge.bpMod = 1500; // 4500
      s.a.hand.push(k("020"));
      s.act("a", { type: "play", handIndex: 0, line });
      return { ...s, low, mid, high, huge };
    };

    it("fewer than 3 〈产屋敷 耀哉〉 and other 柱 (the card itself does not count): nothing", () => {
      const { game, b } = board(1, true);
      expect(game.pending).toBeNull();
      expect(b.sideline).toEqual([]);
    });

    it("3 to 5: sidelines up to one opposing front-line character with BP 3000 or less", () => {
      const { game, a, b, act, low, mid } = board(2, true);
      expect(a.front.map((card) => card.cardId)).toContain(k("020"));
      expect(choice(game, "a").options).toEqual([low.uid, mid.uid]);
      pick(act, "a", [mid.uid]);
      expect(b.sideline).toEqual([GUARD]);
    });

    it("3 to 5: choosing nobody is allowed", () => {
      const { game, b, act } = board(3, false);
      expect(choice(game, "a").options).toHaveLength(2);
      pick(act, "a", []);
      expect(b.sideline).toEqual([]);
    });

    it("6 or more: the range becomes BP 4000 or less", () => {
      const { game, a, b, act, low, mid, high } = board(5, true);
      expect(choice(game, "a").options).toEqual([low.uid, mid.uid, high.uid]); // not the BP 4500 one
      pick(act, "a", [high.uid]);
      expect(b.sideline).toEqual([HOSHI]);
      expect(a.sideline).toEqual([]);
    });

    it("only when it is on the front line", () => {
      const { game, b } = board(2, true, "energy");
      expect(game.pending).toBeNull();
      expect(b.sideline).toEqual([]);
    });
  });

  describe("蝴蝶 忍 (021)", () => {
    /** 蝴蝶 忍 in hand; `count` 〈产屋敷 耀哉〉 and other 柱 on our field (the first four on the energy line, which pays for her). */
    const start = (count: number) => {
      const s = setup();
      if (count === 0) energy(s.a, 3, MURATA);
      for (let index = 0; index < count; index += 1) field(s.a, index < 4 ? "energy" : "front", index === 0 ? OYAKATA : PILLAR);
      s.a.hand.push(k("021"));
      return s;
    };

    it("fewer than 6: chooses one of three effects (draw)", () => {
      const { game, a, act } = start(0);
      act("a", { type: "play", handIndex: 0, line: "front" });
      expect(choice(game, "a").labels).toHaveLength(3);
      pick(act, "a", ["m:0"]);
      expect(a.hand).toEqual([FILLER]);
      expect(game.pending).toBeNull();
    });

    it("fewer than 6: rest an opposing front-line character with BP 3000 or less", () => {
      const { game, b, a, act } = start(0);
      const wall = field(b, "front", HOSHI);
      const one = field(b, "front", FILLER);
      const two = field(b, "front", GUARD);
      act("a", { type: "play", handIndex: 0, line: "front" });
      pick(act, "a", ["m:1"]);
      expect(choice(game, "a").options).toEqual([one.uid, two.uid]);
      pick(act, "a", [two.uid]);
      expect(two.rested).toBe(true);
      expect(wall.rested).toBe(false);
      expect(a.hand).toEqual([]);
    });

    it("fewer than 6: BP+1000 to another of our characters", () => {
      const { game, a, act } = start(0);
      const first = field(a, "front", FILLER);
      const second = field(a, "energy", W0);
      act("a", { type: "play", handIndex: 0, line: "front" });
      pick(act, "a", ["m:2"]);
      expect(choice(game, "a").options).toEqual([...a.front, ...a.energy].filter((card) => card.cardId !== k("021")).map((card) => card.uid));
      expect(choice(game, "a").options).toContain(first.uid);
      pick(act, "a", [second.uid]);
      expect(bpOf(ctx, second)).toBe(3000);
      expect(a.hand).toEqual([]);
    });

    it("6 or more 〈产屋敷 耀哉〉 and other 柱: all three", () => {
      const { game, a, b, act } = start(6);
      const target = field(b, "front", FILLER);
      field(b, "front", HOSHI);
      const friend = a.front[0]!;
      expect(friend.cardId).toBe(PILLAR);
      act("a", { type: "play", handIndex: 0, line: "front" });
      expect(a.hand).toEqual([FILLER]); // drawn; no mode question
      pick(act, "a", [target.uid]);
      expect(target.rested).toBe(true);
      pick(act, "a", [friend.uid]);
      expect(friend.bpMod).toBe(1000);
      expect(game.pending).toBeNull();
    });
  });

  it("不死川 实弥 (022): 2次攻击 stays active after its first attack", () => {
    expect(KMY_1_ABILITIES[k("022")]).toEqual([]);
    expect(isAutomated(titleCard(k("022")))).toBe(true);
    const { a, act } = setup("attack");
    const sanemi = field(a, "front", k("022"));
    const plain = field(a, "front", FILLER);
    act("a", { type: "attack", attackerUid: sanemi.uid });
    expect(sanemi.rested).toBe(false);
    const second = setup("attack");
    const other = field(second.a, "front", FILLER);
    second.act("a", { type: "attack", attackerUid: other.uid });
    expect(other.rested).toBe(true);
    expect(plain.rested).toBe(false);
  });

  it("时透 无一郎 (023): costs 1 less while the opponent has a purple or red card", () => {
    const { game, a, b, players } = setup();
    expect(costOf(game, players, ctx, "a", k("023")).energy).toBe(3);
    field(b, "energy", GUARD); // blue
    field(b, "front", TANJIRO); // yellow
    expect(costOf(game, players, ctx, "a", k("023")).energy).toBe(3);
    field(b, "front", AMIYA); // purple
    expect(costOf(game, players, ctx, "a", k("023")).energy).toBe(2);
    b.front.pop();
    expect(costOf(game, players, ctx, "a", k("023")).energy).toBe(3);
    field(b, "front", NINE); // red
    expect(costOf(game, players, ctx, "a", k("023")).energy).toBe(2);
    // The opponent's own field does not matter for a card played by the other player.
    field(a, "front", NINE);
    expect(costOf(game, players, ctx, "b", k("023")).energy).toBe(2);
  });

  it("时透 无一郎 (024): 登场时 rests an opposing front-line character whose next activation fails; 退场时 rests one more", () => {
    const { game, a, b, act } = setup();
    energy(a, 5, MURATA);
    const first = field(b, "front", FILLER);
    const second = field(b, "front", W0);
    a.hand.push(k("024"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([first.uid, second.uid]);
    pick(act, "a", [first.uid]);
    expect(first.rested).toBe(true);
    expect(first.skipNextActivate).toBe(true);
    expect(second.rested).toBe(false);
    // 退场时: rest only, no freezing.
    const muichiro = a.front[0]!;
    sidelineManually(act, "a", "you", muichiro.uid);
    expect(choice(game, "a").options).toEqual([first.uid, second.uid]);
    pick(act, "a", [second.uid]);
    expect(second.rested).toBe(true);
    expect(second.skipNextActivate).toBe(false);
    // The frozen one does not wake at the start of its owner's next turn.
    act("a", { type: "end_turn" });
    expect(first.rested).toBe(true);
    expect(second.rested).toBe(false);
  });

  it("富冈 义勇 (025): draws a card when attacking", () => {
    const { a, act } = setup("attack");
    const giyu = field(a, "front", k("025"));
    act("a", { type: "attack", attackerUid: giyu.uid });
    expect(a.hand).toEqual([FILLER]);
  });

  it("悲鸣屿 行冥 (026): gets 冲击1 with 3 or more 〈产屋敷 耀哉〉 and other 柱 on our field", () => {
    const { a, act } = setup();
    const gyomei = field(a, "front", k("026"));
    field(a, "energy", OYAKATA);
    field(a, "energy", PILLAR);
    refresh(act);
    expect(impactOf(ctx, gyomei)).toBe(0); // 耀哉 + one 柱 (not itself) = 2
    field(a, "energy", PILLAR);
    refresh(act);
    expect(impactOf(ctx, gyomei)).toBe(1);

    // The opponent's 柱 and our non-柱 characters do not count; 柱 alone are enough.
    const second = setup();
    const lone = field(second.a, "front", k("026"));
    field(second.a, "energy", PILLAR);
    field(second.a, "energy", PILLAR);
    field(second.a, "energy", TANJIRO);
    field(second.b, "front", PILLAR);
    field(second.b, "front", OYAKATA);
    refresh(second.act);
    expect(impactOf(ctx, lone)).toBe(0);
    field(second.a, "front", PILLAR);
    refresh(second.act);
    expect(impactOf(ctx, lone)).toBe(1);
  });

  it("炼狱 杏寿郎 (027): gets 2次阻挡 with 3 or more 〈产屋敷 耀哉〉 and other 柱 on our field", () => {
    const { a, act } = setup();
    const rengoku = field(a, "front", k("027"));
    field(a, "energy", PILLAR);
    field(a, "energy", PILLAR);
    refresh(act);
    expect(hasKeyword(ctx, rengoku, "2次阻挡")).toBe(false);
    field(a, "energy", OYAKATA);
    act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "rest" } });
    expect(hasKeyword(ctx, rengoku, "2次阻挡")).toBe(true);
  });
});

describe("KMY batch 1: site and events", () => {
  it("蝴蝶屋 (028): rests and leaves to return up to two yellow characters of cost 3 or less from the sideline", () => {
    const { game, a, act } = setup();
    const house = field(a, "energy", k("028"));
    a.sideline.push(k("020"), TANJIRO, GUARD, k("006"), k("010"));
    act("a", { type: "activate", uid: house.uid, ability: 0 });
    expect(a.energy).toEqual([]);
    expect(choice(game, "a").options).toEqual(["s:1", "s:3", "s:4"]);
    expect(choice(game, "a").max).toBe(2);
    pick(act, "a", ["s:1", "s:4"]);
    expect(a.hand).toEqual([TANJIRO, k("010")]);
    expect(a.sideline).toEqual([k("020"), GUARD, k("006"), k("028")]);

    // Up to two: none is fine, and the site has still gone.
    const second = setup();
    const site = field(second.a, "energy", k("028"));
    second.a.sideline.push(TANJIRO, k("006"));
    second.act("a", { type: "activate", uid: site.uid, ability: 0 });
    pick(second.act, "a", []);
    expect(second.a.hand).toEqual([]);
    expect(second.a.sideline).toContain(k("028"));
  });

  it("全集中呼吸 (029): makes up to two AP cards active", () => {
    const { game, a, act } = setup();
    energy(a, 3, MURATA);
    a.ap.forEach((card) => { card.rested = true; });
    a.ap[2]!.rested = false;
    a.hand.push(k("029"));
    act("a", { type: "event", handIndex: 0 });
    expect(a.ap.every((card) => card.rested)).toBe(true); // 1 AP paid
    expect(choice(game, "a").max).toBe(2);
    pick(act, "a", ["ap:a:ap0", "ap:a:ap1"]);
    expect(a.ap.map((card) => card.rested)).toEqual([false, false, true]);
    expect(a.sideline).toEqual([k("029")]);

    // Up to two: none.
    const second = setup();
    energy(second.a, 3, MURATA);
    second.a.hand.push(k("029"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", []);
    expect(second.a.ap.filter((card) => card.rested)).toHaveLength(1);
  });

  it("柱合会议 (030): looks at 4, adds one to the hand, the rest go to the bottom; a revealed 柱 also readies an AP card", () => {
    const { game, a, act } = setup();
    energy(a, 2, MURATA);
    a.library = [GUARD, PILLAR, W0, NINE, TANJIRO];
    a.hand.push(k("030"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual(["l:0", "l:1", "l:2", "l:3"]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", ["l:1"]);
    pick(act, "a", ["l:2", "l:0", "l:1"]); // the rest in order: 九, Guard, W
    expect(a.hand).toEqual([PILLAR]);
    expect(a.library).toEqual([TANJIRO, NINE, GUARD, W0]);
    // It was a 柱: up to one AP card becomes active (one was rested to pay for the event).
    expect(a.ap.filter((card) => card.rested)).toHaveLength(1);
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, "a", ["ap:a:ap0"]);
    expect(a.ap.every((card) => !card.rested)).toBe(true);
    expect(a.sideline).toEqual([k("030")]);

    // A revealed card that is not a 柱: no AP question.
    const second = setup();
    energy(second.a, 2, MURATA);
    second.a.library = [GUARD, PILLAR, W0, NINE];
    second.a.hand.push(k("030"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", ["l:2"]);
    pick(second.act, "a", ["l:0", "l:1", "l:2"]);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([W0]);
    expect(second.a.ap.filter((card) => card.rested)).toHaveLength(1);

    // A revealed 柱 with the AP choice declined.
    const third = setup();
    energy(third.a, 2, MURATA);
    third.a.library = [PILLAR, GUARD, W0, NINE];
    third.a.hand.push(k("030"));
    third.act("a", { type: "event", handIndex: 0 });
    pick(third.act, "a", ["l:0"]);
    pick(third.act, "a", ["l:0", "l:1", "l:2"]);
    pick(third.act, "a", []);
    expect(third.a.ap.filter((card) => card.rested)).toHaveLength(1);
  });

  it("柱合审判 (031): sidelines an opposing front-line character with BP 3000 or less; with 3+ 〈产屋敷 耀哉〉 and 柱, BP 5000 or less", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, MURATA);
    field(a, "energy", OYAKATA);
    field(a, "front", PILLAR);
    const low = field(b, "front", W0);
    const mid = field(b, "front", GUARD);
    field(b, "front", HOSHI);
    a.hand.push(k("031"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([low.uid, mid.uid]); // 2 pillars so far: BP 3000
    pick(act, "a", [mid.uid]);
    expect(b.sideline).toEqual([GUARD]);

    const second = setup();
    energy(second.a, 3, MURATA);
    field(second.a, "energy", OYAKATA);
    field(second.a, "front", PILLAR);
    field(second.a, "front", PILLAR);
    const small = field(second.b, "front", W0);
    const wall = field(second.b, "front", HOSHI);
    const huge = field(second.b, "front", GUARD);
    huge.bpMod = 2500; // 5500
    second.a.hand.push(k("031"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(choice(second.game, "a").options).toEqual([small.uid, wall.uid]);
    pick(second.act, "a", [wall.uid]);
    expect(second.b.sideline).toEqual([HOSHI]);
  });

  it("判断太慢了 (032): rests an opposing front-line character and readies one of our 〈鳞泷 左近次〉", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, MURATA);
    const sakonji = field(a, "front", k("003"), true);
    const other = field(a, "energy", k("003"), true);
    const one = field(b, "front", FILLER);
    const two = field(b, "front", W0);
    a.hand.push(k("032"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([one.uid, two.uid]);
    pick(act, "a", [two.uid]);
    expect(two.rested).toBe(true);
    expect(choice(game, "a").options).toEqual([sakonji.uid, other.uid]);
    pick(act, "a", [other.uid]);
    expect(other.rested).toBe(false);
    expect(sakonji.rested).toBe(true);

    // Up to one: none.
    const second = setup();
    energy(second.a, 3, MURATA);
    const rest = field(second.a, "front", k("003"), true);
    field(second.b, "front", FILLER);
    field(second.b, "front", W0);
    second.a.hand.push(k("032"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", [second.b.front[0]!.uid]);
    pick(second.act, "a", []);
    expect(rest.rested).toBe(true);
  });

  it("水之呼吸 拾之型 生生流转 (033): sidelines BP 3000 or less; with 〈灶门 炭治郎〉 on our field BP 5000 or less", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, MURATA);
    const low = field(b, "front", W0);
    const mid = field(b, "front", GUARD);
    field(b, "front", HOSHI);
    a.hand.push(k("033"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([low.uid, mid.uid]);
    pick(act, "a", [low.uid]);
    expect(b.sideline).toEqual([W0]);

    const second = setup();
    energy(second.a, 3, MURATA);
    field(second.a, "energy", TANJIRO);
    const small = field(second.b, "front", W0);
    const wall = field(second.b, "front", HOSHI);
    const huge = field(second.b, "front", GUARD);
    huge.bpMod = 2500; // 5500
    second.a.hand.push(k("033"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(choice(second.game, "a").options).toEqual([small.uid, wall.uid]);
    pick(second.act, "a", [wall.uid]);
    expect(second.b.sideline).toEqual([HOSHI]);
  });
});
