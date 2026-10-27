/**
 * The blue-b cards' abilities (UC01ST ARK-1 blue and UCEX01BT ARK-2 blue 罗德岛 cards): one test per card, set up as its printed text
 * describes, checking the result against the text. The card text was checked against the card images before these were written.
 * Ace (UC01ST/ARK-1-106), a replacement for another card's sidelining, is tested in arknights-abilities-replacement.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  beginFirstTurn,
  bpOf,
  energyOf,
  hasKeyword,
  impactOf,
  newEngineGame,
  type EngineGame,
  type EnginePlayer
} from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaChoice, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { cardContext } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { legalActions } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/legal.ts";
import { UNION_ARENA_CATALOG } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/catalog.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx = cardContext((cardId) => byId.get(cardId));
const id = (number: string): string => UNION_ARENA_CATALOG.find((card) => card.number === number && card.imageAvailable)!.id;
const st = (n: string): string => id(`UC01ST/ARK-1-${n}`);
const ex = (n: string): string => id(`UCEX01BT/ARK-2-${n}`);

// Helper cards without abilities.
const KINGSLAYER = id("UC01BT/ARK-1-004"); // 弑君者: yellow, BP1500, 整合运动
const W = id("UC01BT/ARK-1-009"); // W: yellow, BP2000
const NINE = id("UC01BT/ARK-1-088"); // 九: red, BP2000, 龙门
const MEDIC = st("105"); // Medic: blue, cost 0, BP2000, 罗德岛, makes 1 blue
const GUARD = st("103"); // Guard: blue, cost 3, BP3000, 罗德岛, makes 2 blue
const MON3TR = id("UC01BT/ARK-1-054"); // Mon3tr: blue, cost 7, BP4500
const TALULAH = st("110"); // 塔露拉: yellow, cost 5, BP4000
const AMIYA0 = st("039"); // 阿米娅: blue, cost 0, BP1500
const ROSE0 = ex("021"); // 迷迭香: blue, cost 0, BP1500
// Cards with abilities used as helpers.
const AMIYA101 = st("101"); // 阿米娅: cost 3, BP3000 (+1000 in our turn)
const KALTSIT046 = st("046"); // 凯尔希: cost 2

function player(accountId: string): EnginePlayer {
  return { accountId, username: accountId.toUpperCase(), hand: [], library: Array(30).fill(KINGSLAYER), life: Array.from({ length: 7 }, (_, index) => ({ id: `${accountId}:life:${index}`, cardId: KINGSLAYER, faceUp: false })), apCount: 3, ap: [], front: [], energy: [], sideline: [], removal: [] };
}

let seq = 0;
function field(owner: EnginePlayer, line: "front" | "energy", cardId: string, rested = false): UnionArenaFieldCard {
  seq += 1;
  const card: UnionArenaFieldCard = { uid: `${owner.accountId}:t${seq}`, cardId, under: [], rested, bpMod: 0, energyMod: 0, grants: [], attacks: 0, blocks: 0, skipNextActivate: false, used: [] };
  owner[line].push(card);
  return card;
}
const energy = (owner: EnginePlayer, count: number, cardId = GUARD): void => { for (let index = 0; index < count; index += 1) field(owner, "energy", cardId); };

/** `first`'s turn, in the given phase, with three active AP cards. */
function setup(phase: "movement" | "main" | "attack" = "main", first: "a" | "b" = "a") {
  const a = player("a");
  const b = player("b");
  const game = newEngineGame(first, []);
  beginFirstTurn(game, [a, b]);
  const turn = first === "a" ? a : b;
  turn.ap = [0, 1, 2].map((index) => ({ id: `${first}:ap${index}`, rested: false }));
  const players = [a, b];
  const act = (who: string, action: UnionArenaAction): void => applyAction(game, players, ctx, who, action);
  while (game.phase !== phase) act(first, { type: "next_phase" });
  return { game, a, b, players, act };
}

const choice = (game: EngineGame, playerId?: string): UnionArenaChoice => {
  expect(game.pending?.kind).toBe("choose");
  if (playerId) expect(game.pending?.playerId).toBe(playerId);
  return game.pending as UnionArenaChoice;
};

describe("UC01ST blue", () => {
  it("芙兰卡 (ST 1-035): once per turn BP+1500, and it is sidelined when the attack phase ends", () => {
    const { game, a, act } = setup();
    const franka = field(a, "front", st("035"));
    act("a", { type: "activate", uid: franka.uid, ability: 0 });
    expect(bpOf(ctx, franka)).toBe(4000);
    expect(() => act("a", { type: "activate", uid: franka.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "next_phase" });
    expect(a.front).toEqual([franka]); // still there during the attack phase
    act("a", { type: "next_phase" });
    expect(a.front).toEqual([]);
    expect(a.sideline).toEqual([st("035")]);
    expect(game.turnPlayerId).toBe("b");

    // Ending the turn from the main phase also ends the (skipped) attack phase.
    const second = setup();
    const other = field(second.a, "front", st("035"));
    const untouched = field(second.a, "front", st("035"));
    second.act("a", { type: "activate", uid: other.uid, ability: 0 });
    second.act("a", { type: "end_turn" });
    expect(second.a.front).toEqual([untouched]);
    expect(second.game.turnPlayerId).toBe("b");
  });

  it("雷蛇 (ST 1-036): 阻挡时 gives up to one own character BP+500 (no 2500 condition on this printing)", () => {
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", KINGSLAYER);
    const razor = field(b, "front", st("036"));
    const medic = field(b, "energy", MEDIC);
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: razor.uid });
    expect(choice(game, "b").options).toEqual([razor.uid, medic.uid]);
    act("b", { type: "choose", picks: [razor.uid] });
    expect(bpOf(ctx, razor)).toBe(2000);
    expect(b.front).toEqual([razor]);

    // 最多: choosing none.
    const second = setup("attack");
    const other = field(second.a, "front", KINGSLAYER);
    const razor2 = field(second.b, "front", st("036"));
    second.act("a", { type: "attack", attackerUid: other.uid });
    second.act("b", { type: "block", blockerUid: razor2.uid });
    second.act("b", { type: "choose", picks: [] });
    expect(second.b.sideline).toEqual([st("036")]);
  });

  it("凯尔希 (ST 1-046): one more blue energy while active", () => {
    const { a, act } = setup();
    const kaltsit = field(a, "energy", KALTSIT046);
    act("a", { type: "next_phase" });
    expect(energyOf(ctx, a, "blue")).toBe(2);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: kaltsit.uid, act: "rest" } });
    expect(energyOf(ctx, a, "blue")).toBe(1);
  });

  it("杜宾 (ST 1-049): returns another own character with required energy 1 or less to the hand, or else itself", () => {
    const { game, a, act } = setup();
    energy(a, 1, MEDIC);
    const amiya = field(a, "front", AMIYA0);
    field(a, "front", GUARD);
    a.hand.push(st("049"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual([amiya.uid, a.energy[0]!.uid]);
    act("a", { type: "choose", picks: [amiya.uid] });
    expect(a.hand).toEqual([AMIYA0]);
    expect(a.front.map((card) => card.cardId)).toEqual([GUARD, st("049")]);

    const second = setup();
    energy(second.a, 1, GUARD);
    second.a.hand.push(st("049"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([st("049")]);
    expect(second.a.front).toEqual([]);
  });

  it("杜宾 (ST 1-050): on the front line, our other cost-3 characters (not 〈杜宾〉) get BP+1000", () => {
    const { b, a, act } = setup();
    const dobermann = field(a, "front", st("050"));
    const guard = field(a, "energy", GUARD);
    const medic = field(a, "front", MEDIC);
    const other = field(a, "front", st("050"));
    const theirs = field(b, "front", GUARD);
    act("a", { type: "next_phase" });
    expect(bpOf(ctx, guard)).toBe(5000); // +1000 from each 〈杜宾〉
    expect(bpOf(ctx, medic)).toBe(2000);
    expect(bpOf(ctx, dobermann)).toBe(3500);
    expect(bpOf(ctx, other)).toBe(3500);
    expect(bpOf(ctx, theirs)).toBe(3000);

    const second = setup();
    field(second.a, "energy", st("050"));
    const guard2 = field(second.a, "front", GUARD);
    second.act("a", { type: "next_phase" });
    expect(bpOf(ctx, guard2)).toBe(3000);
  });

  it("博士 (ST 1-051): cannot be played onto or moved to the front line; rests for one more blue energy and is sidelined at the end of the main phase", () => {
    const { game, a, players, act } = setup();
    a.hand.push(st("051"));
    expect(() => act("a", { type: "play", handIndex: 0, line: "front" })).toThrow("ENERGY_LINE_ONLY");
    expect(legalActions(game, players, ctx, "a")).not.toContainEqual({ type: "play", handIndex: 0, line: "front" });
    expect(legalActions(game, players, ctx, "a")).toContainEqual({ type: "play", handIndex: 0, line: "energy" });
    act("a", { type: "play", handIndex: 0, line: "energy" });
    const doctor = a.energy[0]!;
    doctor.rested = false;
    act("a", { type: "activate", uid: doctor.uid, ability: 1 });
    expect(doctor.rested).toBe(true);
    expect(energyOf(ctx, a, "blue")).toBe(2);
    expect(() => act("a", { type: "activate", uid: doctor.uid, ability: 1 })).toThrow();
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([st("051")]);

    const second = setup("movement");
    const doctor2 = field(second.a, "energy", st("051"));
    second.act("a", { type: "manual", manual: { op: "draw" } }); // continuous abilities are recomputed after each action
    expect(() => second.act("a", { type: "move", toFront: [doctor2.uid], toEnergy: [], remove: [] })).toThrow("CANNOT_MOVE");
  });

  it("应急理智加强剂 (ST 1-062): switches up to two AP cards to active", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.ap[1]!.rested = true;
    a.ap[2]!.rested = true;
    a.hand.push(st("062"));
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "choose", picks: ["ap:a:ap0", "ap:a:ap2"] });
    expect(a.ap.map((card) => card.rested)).toEqual([false, true, false]);
    expect(a.sideline).toEqual([st("062")]);
    expect(game.pending).toBeNull();
  });

  it("精神爆发 (ST 1-064): sidelines an opponent front character with BP 3000 or less, 5000 or less with 〈阿米娅〉", () => {
    const { game, a, b, act } = setup();
    energy(a, 2);
    const small = field(b, "front", GUARD);
    const big = field(b, "front", MON3TR);
    a.hand.push(st("064"), st("064"));
    act("a", { type: "event", handIndex: 0 });
    expect(b.front).toEqual([big]);
    expect(b.sideline).toEqual([GUARD]);
    void small;

    const second = setup();
    energy(second.a, 2);
    field(second.a, "front", AMIYA0);
    const target = field(second.b, "front", MON3TR);
    target.bpMod = 500; // 5000
    const tooBig = field(second.b, "front", MON3TR);
    tooBig.bpMod = 600;
    second.a.hand.push(st("064"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.b.front).toEqual([tooBig]);
    expect(second.game.pending).toBeNull();
    void game;
  });

  it("阿米娅 (ST 1-101): BP+1000 during our turn only", () => {
    const { a, act } = setup();
    const amiya = field(a, "front", AMIYA101);
    act("a", { type: "next_phase" });
    expect(bpOf(ctx, amiya)).toBe(4000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, amiya)).toBe(3000);
  });

  it("阿米娅 (ST 1-102): 登场时 picks up to two options, each working only when its BP-4000 condition holds", () => {
    const { game, a, b, act } = setup();
    energy(a, 2);
    a.energy[0]!.bpMod = 1000; // a BP-4000 character on the energy line
    const w = field(b, "front", W);
    const kingslayer = field(b, "front", KINGSLAYER);
    a.hand.push(st("102"));
    act("a", { type: "play", handIndex: 0, line: "front" }); // itself: BP 4000 on the front line
    const modes = choice(game);
    expect(modes).toMatchObject({ min: 0, max: 2 });
    expect(modes.labels).toHaveLength(2);
    act("a", { type: "choose", picks: ["m:0", "m:1"] });
    expect(choice(game).options).toEqual([w.uid]); // BP 2000 or more
    act("a", { type: "choose", picks: [w.uid] });
    expect(bpOf(ctx, w)).toBe(500);
    expect(choice(game).options).toEqual([w.uid, kingslayer.uid]); // BP 2000 or less
    act("a", { type: "choose", picks: [kingslayer.uid] });
    expect(b.front).toEqual([w]);
    expect(game.pending).toBeNull();

    // No BP-4000 character on the energy line: the second option does nothing; picking none does nothing.
    const second = setup();
    energy(second.a, 2);
    const other = field(second.b, "front", KINGSLAYER);
    second.a.hand.push(st("102"), st("102"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: ["m:1"] });
    expect(second.game.pending).toBeNull();
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: [] });
    expect(second.game.pending).toBeNull();
    expect(second.b.front).toEqual([other]);
  });

  it("煌 (ST 1-107): 冲击1 in our turn with another BP-4000 front character, 2次阻挡 in theirs with another BP-4000 energy character", () => {
    const { game, a, act } = setup();
    const blaze = field(a, "front", st("107"));
    field(a, "front", AMIYA101); // BP 4000 only through its own continuous ability, and placed after 煌
    act("a", { type: "next_phase" });
    expect(impactOf(ctx, blaze)).toBe(1);
    expect(hasKeyword(ctx, blaze, "2次阻挡")).toBe(false);
    act("a", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("b");
    expect(impactOf(ctx, blaze)).toBe(0); // 阿米娅 is BP 3000 in their turn, and it is not our turn anyway
    expect(hasKeyword(ctx, blaze, "2次阻挡")).toBe(false);
    field(a, "energy", TALULAH);
    act("b", { type: "next_phase" });
    expect(hasKeyword(ctx, blaze, "2次阻挡")).toBe(true);

    // Itself does not count.
    const second = setup();
    const alone = field(second.a, "front", st("107"));
    second.act("a", { type: "next_phase" });
    expect(impactOf(ctx, alone)).toBe(0);
  });

  it("罗德岛制药公司 (site, ST 1-108): enters active; rests to give every 罗德岛 character BP+500", () => {
    const { a, act } = setup();
    energy(a, 1);
    const guard = a.energy[0]!;
    const medic = field(a, "front", MEDIC);
    const nine = field(a, "front", NINE);
    a.hand.push(st("108"));
    act("a", { type: "play", handIndex: 0, line: "energy" });
    const site = a.energy[1]!;
    expect(site.rested).toBe(false);
    act("a", { type: "activate", uid: site.uid, ability: 1 });
    expect(site.rested).toBe(true);
    expect(bpOf(ctx, medic)).toBe(2500);
    expect(bpOf(ctx, guard)).toBe(3500);
    expect(bpOf(ctx, nine)).toBe(2000);
  });

  it("开始行动 (ST 1-109): up to three options, in order; the BP+2000 can meet a later option's BP-4000 condition", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    const guard = field(a, "front", GUARD);
    a.hand.push(st("109"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game)).toMatchObject({ min: 0, max: 3 });
    act("a", { type: "choose", picks: ["m:0", "m:1", "m:2"] });
    act("a", { type: "choose", picks: [guard.uid] });
    expect(bpOf(ctx, guard)).toBe(5000);
    // The front line now has BP 5000: one card; the energy line has no BP-4000 character: none.
    expect(a.hand).toEqual([KINGSLAYER]);
    expect(game.pending).toBeNull();

    const second = setup();
    energy(second.a, 2);
    second.a.energy[0]!.bpMod = 1000;
    second.a.hand.push(st("109"));
    second.act("a", { type: "event", handIndex: 0 });
    second.act("a", { type: "choose", picks: ["m:1", "m:2"] });
    expect(second.a.hand).toEqual([KINGSLAYER]);
  });
});

describe("UCEX01BT blue", () => {
  it("盾卫 (2-013): looks at four, reveals up to one 〈迷迭香〉 into the hand, the rest to the bottom, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1);
    a.library = [MEDIC, ROSE0, GUARD, W, NINE];
    a.hand.push(ex("013"), MON3TR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual(["l:1"]);
    act("a", { type: "choose", picks: ["l:1"] });
    act("a", { type: "choose", picks: ["l:0", "l:1", "l:2"] });
    expect(a.library).toEqual([NINE, MEDIC, GUARD, W]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([ROSE0]);
    expect(a.sideline).toEqual([MON3TR]);

    // Nothing added: no discard.
    const second = setup();
    energy(second.a, 1);
    second.a.library = [MEDIC, GUARD, W, NINE];
    second.a.hand.push(ex("013"), MON3TR);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: ["l:0", "l:1", "l:2", "l:3"] });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([MON3TR]);
  });

  it("阿米娅 (2-014): must attack if it can; 登场时 active with a BP-4000 energy character; 攻击时 skips its next activation or sidelines one own character", () => {
    const { game, a, players, act } = setup();
    energy(a, 3);
    a.energy[0]!.bpMod = 1000;
    a.hand.push(ex("014"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const amiya = a.front[0]!;
    expect(amiya.rested).toBe(false);
    expect(() => act("a", { type: "end_turn" })).toThrow("MUST_ATTACK");
    expect(legalActions(game, players, ctx, "a")).not.toContainEqual({ type: "end_turn" });
    act("a", { type: "next_phase" });
    expect(() => act("a", { type: "end_turn" })).toThrow("MUST_ATTACK");
    expect(() => act("a", { type: "next_phase" })).toThrow("MUST_ATTACK");
    expect(legalActions(game, players, ctx, "a")).toEqual([{ type: "attack", attackerUid: amiya.uid }]);
    act("a", { type: "attack", attackerUid: amiya.uid });
    expect(choice(game).labels).toHaveLength(2);
    act("a", { type: "choose", picks: ["m:0"] });
    expect(amiya.skipNextActivate).toBe(true);
    act("a", { type: "damage", lifeIds: ["b:life:0"] });
    act("b", { type: "trigger", lifeId: "b:life:0", activate: false });
    act("a", { type: "end_turn" });
    // Its next switch to active (our end phase) did not happen: it stays resting through their turn.
    expect(game.turnPlayerId).toBe("b");
    expect(amiya.rested).toBe(true);
    expect(amiya.skipNextActivate).toBe(false);

    // Without a BP-4000 energy character it stays resting (and so need not attack); the other option sidelines an own character.
    const second = setup();
    energy(second.a, 3);
    second.a.hand.push(ex("014"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    const other = second.a.front[0]!;
    expect(other.rested).toBe(true);
    second.act("a", { type: "end_turn" });
    expect(second.game.turnPlayerId).toBe("b");

    const third = setup("attack");
    const amiya3 = field(third.a, "front", ex("014"));
    const medic = field(third.a, "front", MEDIC);
    third.act("a", { type: "attack", attackerUid: amiya3.uid });
    third.act("a", { type: "choose", picks: ["m:1"] });
    expect(choice(third.game).options).toEqual([amiya3.uid, medic.uid]);
    third.act("a", { type: "choose", picks: [medic.uid] });
    expect(third.a.sideline).toEqual([MEDIC]);
  });

  it("极境 (2-015): rests to look at three for a 罗德岛 card, is sidelined at the end of the main phase; once per turn per name", () => {
    const { game, a, act } = setup();
    const exusiai = field(a, "front", ex("015"));
    const second = field(a, "front", ex("015"));
    a.library = [NINE, MEDIC, W, GUARD];
    act("a", { type: "activate", uid: exusiai.uid, ability: 0 });
    expect(exusiai.rested).toBe(true);
    expect(choice(game).options).toEqual(["l:1"]);
    act("a", { type: "choose", picks: ["l:1"] });
    act("a", { type: "choose", picks: ["l:1", "l:0"] });
    expect(a.hand).toEqual([MEDIC]);
    expect(a.library).toEqual([GUARD, W, NINE]);
    // 〈极境〉's effect: only once per turn, even from another copy.
    expect(() => act("a", { type: "activate", uid: second.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    act("a", { type: "next_phase" });
    expect(a.front).toEqual([second]);
    expect(a.sideline).toEqual([ex("015")]);
  });

  it("凯尔希 (2-016): looks at three, puts up to one into the sideline and the rest back on top in a chosen order", () => {
    const { game, a, act } = setup();
    a.library = [NINE, MEDIC, W, GUARD];
    a.hand.push(ex("016"));
    field(a, "energy", MEDIC);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual(["l:0", "l:1", "l:2"]);
    act("a", { type: "choose", picks: ["l:1"] });
    expect(a.sideline).toEqual([MEDIC]);
    expect(choice(game)).toMatchObject({ ordered: true, min: 2, max: 2 });
    act("a", { type: "choose", picks: ["l:1", "l:0"] });
    expect(a.library).toEqual([W, NINE, GUARD]);
    expect(game.pending).toBeNull();
  });

  it("凯尔希 (2-017): returns a non-〈凯尔希〉 character with cost 3 or less from the sideline, or by paying 1 AP one with cost 4 or more", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.sideline.push(MEDIC, GUARD, MON3TR, KALTSIT046, st("062"));
    a.hand.push(ex("017"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["no"] });
    expect(choice(game).options).toEqual(["s:0", "s:1"]);
    act("a", { type: "choose", picks: ["s:1"] });
    expect(a.hand).toEqual([GUARD]);
    expect(a.ap.filter((card) => !card.rested)).toHaveLength(2);

    const second = setup();
    energy(second.a, 2);
    second.a.sideline.push(MEDIC, GUARD, MON3TR);
    second.a.hand.push(ex("017"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: ["yes"] });
    expect(second.a.ap.filter((card) => !card.rested)).toHaveLength(1);
    expect(choice(second.game).options).toEqual(["s:2"]);
    second.act("a", { type: "choose", picks: ["s:2"] });
    expect(second.a.hand).toEqual([MON3TR]);
  });

  it("临光 (2-018): 退场时 with 6 life or less, may put a hand card into the sideline to put itself face up into the life area", () => {
    const { game, a, act } = setup();
    a.life.pop();
    const nearl = field(a, "front", ex("018"));
    a.hand.push(MEDIC);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: nearl.uid, act: "sideline" } });
    expect(choice(game).purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.hand).toEqual([]);
    expect(a.sideline).toEqual([MEDIC]);
    expect(a.life).toHaveLength(7);
    expect(a.life[6]).toMatchObject({ cardId: ex("018"), faceUp: true });

    // Seven life: nothing happens.
    const second = setup();
    const other = field(second.a, "front", ex("018"));
    second.a.hand.push(MEDIC);
    second.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: other.uid, act: "sideline" } });
    expect(second.game.pending).toBeNull();
    expect(second.a.sideline).toEqual([ex("018")]);

    // Declining keeps it in the sideline.
    const third = setup();
    third.a.life.splice(0, 3);
    const nearl3 = field(third.a, "front", ex("018"));
    third.a.hand.push(MEDIC);
    third.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: nearl3.uid, act: "sideline" } });
    third.act("a", { type: "choose", picks: ["no"] });
    expect(third.a.life).toHaveLength(4);
    expect(third.a.hand).toEqual([MEDIC]);
  });

  it("华法琳 (2-019): rests, once per turn, for BP+2000 on another character and itself; sidelined at the end of the main phase", () => {
    const { game, a, act } = setup();
    const warfarin = field(a, "front", ex("019"));
    const medic = field(a, "front", MEDIC);
    act("a", { type: "activate", uid: warfarin.uid, ability: 0 });
    expect(choice(game).options).toEqual([medic.uid]);
    act("a", { type: "choose", picks: [medic.uid] });
    expect(bpOf(ctx, medic)).toBe(4000);
    expect(bpOf(ctx, warfarin)).toBe(4000);
    expect(warfarin.rested).toBe(true);
    act("a", { type: "next_phase" });
    expect(a.front).toEqual([medic]);
    expect(a.sideline).toEqual([ex("019")]);
  });

  it("煌 (2-020): 攻击时 may put a hand card into the sideline to sideline an opponent front character with BP 1000 or less", () => {
    const { game, a, b, act } = setup("attack");
    const blaze = field(a, "front", ex("020"));
    const weak = field(b, "front", KINGSLAYER, true);
    weak.bpMod = -500;
    field(b, "front", W, true);
    a.hand.push(MEDIC);
    act("a", { type: "attack", attackerUid: blaze.uid });
    expect(choice(game).purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.sideline).toEqual([MEDIC]);
    act("a", { type: "choose", picks: [weak.uid] });
    expect(b.sideline).toEqual([KINGSLAYER]);

    // No hand card: nothing to ask.
    const second = setup("attack");
    const blaze2 = field(second.a, "front", ex("020"));
    second.act("a", { type: "attack", attackerUid: blaze2.uid });
    expect(second.game.pending).toMatchObject({ kind: "damage" });
  });

  it("迷迭香 (2-022): 攻击时 rests up to one opponent front character with BP 1500 or less", () => {
    const { game, a, b, act } = setup("attack");
    const rosmontis = field(a, "front", ex("022"));
    const small = field(b, "front", KINGSLAYER);
    field(b, "front", W);
    act("a", { type: "attack", attackerUid: rosmontis.uid });
    expect(choice(game).options).toEqual([small.uid]);
    act("a", { type: "choose", picks: [small.uid] });
    expect(small.rested).toBe(true);
    expect(game.pending).toMatchObject({ kind: "block", playerId: "b" });
  });

  it("迷迭香 (2-023): 登场时 rests an opponent front character that skips its next activation; Activate: Main draws and gives BP-2000 to their BP-2500+ front characters", () => {
    const { game, a, b, act } = setup();
    energy(a, 3);
    const target = field(b, "front", MON3TR);
    const small = field(b, "front", KINGSLAYER);
    const back = field(b, "energy", GUARD);
    a.hand.push(ex("023"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    act("a", { type: "choose", picks: [target.uid] });
    expect(target.rested).toBe(true);
    expect(target.skipNextActivate).toBe(true);
    const rosmontis = a.front[0]!;
    act("a", { type: "activate", uid: rosmontis.uid, ability: 1 });
    expect(a.hand).toEqual([KINGSLAYER]);
    expect(bpOf(ctx, target)).toBe(2500);
    expect(bpOf(ctx, small)).toBe(1500);
    expect(bpOf(ctx, back)).toBe(3000);
    expect(() => act("a", { type: "activate", uid: rosmontis.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "end_turn" });
    expect(target.rested).toBe(true); // b's start phase did not switch it to active

    const second = setup();
    const onEnergy = field(second.a, "energy", ex("023"));
    expect(() => second.act("a", { type: "activate", uid: onEnergy.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
  });

  it("如你所愿 (2-024): returns an opponent front character with BP 5000 or less to the hand, or sidelines it with 〈迷迭香〉", () => {
    const { a, b, act } = setup();
    energy(a, 2);
    const target = field(b, "front", MON3TR);
    a.hand.push(ex("024"));
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "choose", picks: [target.uid] });
    expect(b.front).toEqual([]);
    expect(b.hand).toEqual([MON3TR]);

    const second = setup();
    energy(second.a, 2);
    field(second.a, "energy", ROSE0);
    const target2 = field(second.b, "front", MON3TR);
    const tooBig = field(second.b, "front", MON3TR);
    tooBig.bpMod = 1000;
    second.a.hand.push(ex("024"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(choice(second.game).options).toEqual([target2.uid]);
    second.act("a", { type: "choose", picks: [target2.uid] });
    expect(second.b.sideline).toEqual([MON3TR]);
    expect(second.b.front).toEqual([tooBig]);
  });
});
