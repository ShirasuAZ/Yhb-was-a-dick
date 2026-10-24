/**
 * The blue-a cards' abilities (UC01BT ARK-1 blue: 罗德岛制药公司, 企鹅物流, 黑钢国际, 整合运动): one test per card (more where a card has several
 * abilities), set up as its printed text describes and checked against the text. The card text was checked against the card images first.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  beginFirstTurn,
  bpOf,
  costOf,
  energyOf,
  flagsOf,
  hasKeyword,
  newEngineGame,
  type EngineGame,
  type EnginePlayer
} from "../../../../Arknights/ArknightsWorkSpace/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaChoice, UnionArenaFieldCard } from "../../../../Arknights/ArknightsWorkSpace/src/shared/protocol.ts";
import { cardContext } from "../../../../Arknights/ArknightsWorkSpace/src/shared/abilities/registry.ts";
import { UNION_ARENA_CATALOG } from "../../../../Arknights/ArknightsWorkSpace/src/server/catalog.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx = cardContext((cardId) => byId.get(cardId));
const id = (number: string): string => UNION_ARENA_CATALOG.find((card) => card.number === number && card.imageAvailable)!.id;
const ark = (n: string): string => id(`UC01BT/ARK-1-${n}`);

// Helper cards without abilities.
const NINE = ark("088"); // 九: red, BP2000
const CHEN = ark("084"); // 陈: red, BP1500
const KINGSLAYER = ark("004"); // yellow
const AMIYA0 = ark("039"); // 阿米娅: blue, cost 0, BP1500
const GRAY0 = ark("043"); // 灰喉: blue, cost 0, BP2000
const KAL0 = ark("045"); // 凯尔希: blue, cost 0, BP1500, energy 1
const MON3TR = ark("054"); // Mon3tr: blue, cost 7, BP4500, AP1
const GUARD = id("UC01ST/ARK-1-103"); // Guard: blue, cost 3, BP3000, AP1, energy 2
// Cards of this group used as helpers.
const DOCTOR051 = ark("051"); // 博士: blue, cost 0, BP1000
const RED = ark("055"); // 红: blue, cost 3, BP4500, AP1
const HUANG057 = ark("057"); // 煌: blue, cost 0, BP1500
const UNKNOWN_TECH = ark("065"); // 未知技术 (event)

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
/** Blue energy: each Guard on the energy line generates 2. */
const energy = (owner: EnginePlayer, count: number, cardId = GUARD): void => { for (let index = 0; index < count; index += 1) field(owner, "energy", cardId); };

/** `first`'s turn, in the given phase, with three active AP cards. */
function setup(phase: "main" | "attack" = "main", first: "a" | "b" = "a") {
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
const handIndexOf = (owner: EnginePlayer, cardId: string): number => owner.hand.indexOf(cardId);
const play = (act: (who: string, action: UnionArenaAction) => void, owner: EnginePlayer, cardId: string, line: "front" | "energy"): void =>
  act(owner.accountId, { type: "play", handIndex: handIndexOf(owner, cardId), line });

describe("Characters (UC01BT ARK-1 blue)", () => {
  it("霜星 (1-034): 登场时 gains “sidelined when the main phase ends”", () => {
    const { a, act } = setup();
    energy(a, 1);
    a.hand.push(ark("034"));
    play(act, a, ark("034"), "front");
    expect(a.front).toHaveLength(1);
    act("a", { type: "next_phase" });
    expect(a.front).toEqual([]);
    expect(a.sideline).toEqual([ark("034")]);
  });

  it("芙兰卡 (1-035): once per turn BP+1500, then sidelined when the attack phase ends (also when the turn ends from the main phase)", () => {
    const { game, a, act } = setup();
    const franka = field(a, "front", ark("035"));
    act("a", { type: "activate", uid: franka.uid, ability: 0 });
    expect(bpOf(ctx, franka)).toBe(4000);
    expect(() => act("a", { type: "activate", uid: franka.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "next_phase" });
    expect(a.front).toContain(franka); // still there during the attack phase
    act("a", { type: "next_phase" });
    expect(a.sideline).toEqual([ark("035")]);
    expect(game.turnPlayerId).toBe("b");

    const second = setup();
    const other = field(second.a, "front", ark("035"));
    const untouched = field(second.a, "front", ark("035"));
    second.act("a", { type: "activate", uid: other.uid, ability: 0 });
    second.act("a", { type: "end_turn" });
    expect(second.a.sideline).toEqual([ark("035")]);
    expect(second.a.front).toEqual([untouched]);
  });

  it("雷蛇 (1-036): 阻挡时 gives up to one own character BP+500 (or none)", () => {
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", CHEN); // 1500
    const razor = field(b, "front", ark("036")); // 1500
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: razor.uid });
    expect(choice(game, "b").options).toEqual([razor.uid]);
    act("b", { type: "choose", picks: [razor.uid] });
    expect(bpOf(ctx, razor)).toBe(2000);
    expect(b.front).toContain(razor);

    const second = setup("attack");
    const attacker2 = field(second.a, "front", CHEN);
    const razor2 = field(second.b, "front", ark("036"));
    second.act("a", { type: "attack", attackerUid: attacker2.uid });
    second.act("b", { type: "block", blockerUid: razor2.uid });
    second.act("b", { type: "choose", picks: [] });
    expect(second.b.sideline).toEqual([ark("036")]);
  });

  it("能天使 (1-037): costs one less while the opponent has a yellow or red card", () => {
    const { game, b, players } = setup();
    const angel = ark("037");
    expect(costOf(game, players, ctx, "a", angel).energy).toBe(3);
    field(b, "energy", GUARD);
    expect(costOf(game, players, ctx, "a", angel).energy).toBe(3);
    field(b, "energy", NINE);
    expect(costOf(game, players, ctx, "a", angel).energy).toBe(2);
    b.energy = [];
    field(b, "energy", KINGSLAYER);
    expect(costOf(game, players, ctx, "a", angel).energy).toBe(2);
  });

  it("德克萨斯 (1-038): 登场时 draws one", () => {
    const { a, act } = setup();
    energy(a, 1);
    a.hand.push(ark("038"));
    play(act, a, ark("038"), "front");
    expect(a.hand).toEqual([KINGSLAYER]);
  });

  it("阿米娅 (1-040): discards a card, once per turn, so an energy-line character is not sidelined this turn", () => {
    const { game, a, act } = setup();
    const amiya = field(a, "front", ark("040"));
    const doctor = field(a, "energy", DOCTOR051);
    field(a, "energy", KAL0);
    a.hand.push(NINE);
    act("a", { type: "activate", uid: doctor.uid, ability: 1 }); // 博士: sidelined when the main phase ends
    act("a", { type: "activate", uid: amiya.uid, ability: 0 });
    expect(a.sideline).toEqual([NINE]);
    expect(choice(game).options).toHaveLength(2); // energy line only
    act("a", { type: "choose", picks: [doctor.uid] });
    expect(flagsOf(doctor)).toContain("cannotSideline");
    expect(() => act("a", { type: "activate", uid: amiya.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "next_phase" });
    expect(a.energy).toContain(doctor);
    // BP 0 or less does not sideline it either.
    doctor.bpMod = -5000;
    act("a", { type: "next_phase" });
    expect(game.turnPlayerId).toBe("b");
    expect(flagsOf(doctor)).toEqual(expect.not.arrayContaining(["cannotSideline"]));
  });

  it("阿米娅 (1-041): 登场时 may sideline an opponent front character with BP 4000 or less; doing so, it is sidelined when the main phase ends", () => {
    const { game, a, b, act } = setup();
    energy(a, 2);
    const small = field(b, "front", NINE);
    const big = field(b, "front", NINE);
    big.bpMod = 3000; // 5000
    a.hand.push(ark("041"));
    play(act, a, ark("041"), "front");
    expect(choice(game).purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(b.front).toEqual([big]);
    expect(b.sideline).toEqual([NINE]);
    expect(small.uid).not.toBe(big.uid);
    act("a", { type: "next_phase" });
    expect(a.front).toEqual([]);
    expect(a.sideline).toEqual([ark("041")]);

    // Declining: nothing is sidelined, and it stays.
    const second = setup();
    energy(second.a, 2);
    field(second.b, "front", NINE);
    second.a.hand.push(ark("041"));
    play(second.act, second.a, ark("041"), "front");
    second.act("a", { type: "choose", picks: ["no"] });
    second.act("a", { type: "next_phase" });
    expect(second.a.front).toHaveLength(1);
    expect(second.b.front).toHaveLength(1);

    // No target: no question.
    const third = setup();
    energy(third.a, 2);
    third.a.hand.push(ark("041"));
    play(third.act, third.a, ark("041"), "front");
    expect(third.game.pending).toBeNull();
  });

  it("阿米娅 (1-042): during our turn, on the front line, our energy-line characters are not sidelined", () => {
    const { game, a, act } = setup();
    field(a, "front", ark("042"));
    const doctor = field(a, "energy", DOCTOR051);
    const gray = field(a, "energy", GRAY0);
    act("a", { type: "activate", uid: doctor.uid, ability: 1 });
    act("a", { type: "next_phase" }); // main phase ends: 博士 would be sidelined
    expect(a.energy).toContain(doctor);
    gray.bpMod = -3000;
    act("a", { type: "next_phase" });
    expect(game.turnPlayerId).toBe("b");
    expect(a.energy).toContain(gray); // its BP change ended with the turn

    // On the energy line itself, or during the opponent's turn, it does nothing.
    const second = setup("main", "b");
    field(second.a, "front", ark("042"));
    const weak = field(second.a, "energy", GRAY0);
    expect(flagsOf(weak)).toEqual([]);
    const third = setup();
    field(third.a, "energy", ark("042"));
    const other = field(third.a, "energy", GRAY0);
    other.bpMod = -3000;
    third.act("a", { type: "next_phase" });
    expect(third.a.energy).not.toContain(other);
  });

  it("灰喉 (1-044): 登场时 gives up to one opponent front character with BP 1500 or more BP-1000", () => {
    const { game, a, b, act } = setup();
    energy(a, 2);
    const nine = field(b, "front", NINE);
    const weak = field(b, "front", NINE);
    weak.bpMod = -1000; // 1000
    field(b, "energy", NINE);
    a.hand.push(ark("044"));
    play(act, a, ark("044"), "front");
    expect(choice(game).options).toEqual([nine.uid]);
    act("a", { type: "choose", picks: [nine.uid] });
    expect(bpOf(ctx, nine)).toBe(1000);
  });

  it("凯尔希 (1-046): generates one more blue energy while active", () => {
    const { a, act } = setup();
    const kaltsit = field(a, "energy", ark("046"));
    act("a", { type: "next_phase" });
    expect(energyOf(ctx, a, "blue")).toBe(2);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: kaltsit.uid, act: "rest" } });
    expect(energyOf(ctx, a, "blue")).toBe(1);
  });

  it("凯尔希 (1-047): on the energy line, looks at seven for a BP-4500 character, then puts a blue BP-4500 AP-1 character from hand onto the field resting", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.library = [MON3TR, GUARD, RED, NINE, KINGSLAYER, CHEN, AMIYA0, KAL0];
    a.hand.push(ark("047"));
    play(act, a, ark("047"), "energy");
    expect(choice(game).options).toEqual(["l:0", "l:2"]);
    act("a", { type: "choose", picks: ["l:2"] });
    expect(a.hand).toEqual([RED]);
    act("a", { type: "choose", picks: [...choice(game).options] });
    expect(a.library).toEqual([KAL0, MON3TR, GUARD, NINE, KINGSLAYER, CHEN, AMIYA0]);
    // Up to one: the 红 just added.
    expect(choice(game).options).toEqual(["h:0"]);
    act("a", { type: "choose", picks: ["h:0"] });
    act("a", { type: "choose", picks: ["line:front"] });
    expect(a.front.map((card) => [card.cardId, card.rested])).toEqual([[RED, true]]);
    expect(game.pending).toBeNull();

    // Played onto the front line: nothing happens.
    const second = setup();
    energy(second.a, 2);
    second.a.library = [MON3TR, GUARD];
    second.a.hand.push(ark("047"));
    play(second.act, second.a, ark("047"), "front");
    expect(second.game.pending).toBeNull();
    expect(second.a.library).toEqual([MON3TR, GUARD]);
  });

  it("凯尔希 (1-048): 登场时 draws one; on the energy line it rests and discards to return a cost-3-or-less character, then puts a blue BP-4500 AP-1 character on active", () => {
    const { a, act } = setup();
    energy(a, 3);
    a.hand.push(ark("048"));
    play(act, a, ark("048"), "energy");
    expect(a.hand).toEqual([KINGSLAYER]);

    const second = setup();
    const kaltsit = field(second.a, "energy", ark("048"));
    const guard = field(second.a, "front", GUARD);
    field(second.a, "front", MON3TR);
    second.a.hand.push(NINE, MON3TR);
    second.act("a", { type: "activate", uid: kaltsit.uid, ability: 1 });
    expect(kaltsit.rested).toBe(true);
    second.act("a", { type: "choose", picks: [`h:${handIndexOf(second.a, NINE)}`] });
    expect(second.a.sideline).toEqual([NINE]);
    // The Guard is the only character costing 3 or less: it goes back without a question.
    expect(second.a.front).not.toContain(guard);
    expect(second.a.hand).toEqual([MON3TR, GUARD]);
    expect(choice(second.game).options).toEqual(["h:0"]);
    second.act("a", { type: "choose", picks: ["h:0"] });
    second.act("a", { type: "choose", picks: ["line:front"] });
    const placed = second.a.front.at(-1)!;
    expect([placed.cardId, placed.rested]).toEqual([MON3TR, false]);
    expect(second.a.hand).toEqual([GUARD]);

    const third = setup();
    const onFront = field(third.a, "front", ark("048"));
    third.a.hand.push(NINE);
    expect(() => third.act("a", { type: "activate", uid: onFront.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
  });

  it("杜宾 (1-049): returns another own character with required energy 1 or less to the hand, or else itself", () => {
    const { game, a, act } = setup();
    energy(a, 1);
    const amiya = field(a, "front", AMIYA0);
    a.hand.push(ark("049"));
    const amiya2 = field(a, "front", AMIYA0);
    play(act, a, ark("049"), "front");
    expect(choice(game).options).toEqual([amiya.uid, amiya2.uid]);
    act("a", { type: "choose", picks: [amiya.uid] });
    expect(a.hand).toEqual([AMIYA0]);
    expect(a.front).toContain(amiya2);

    const second = setup();
    energy(second.a, 1);
    second.a.hand.push(ark("049"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([ark("049")]);
    expect(second.a.front).toEqual([]);
  });

  it("杜宾 (1-050): on the front line, our characters with required energy 3 other than 〈杜宾〉 get BP+1000", () => {
    const { a, b, act } = setup();
    const dobermann = field(a, "front", ark("050"));
    const guard = field(a, "energy", GUARD);
    const other = field(a, "front", ark("050"));
    const cheap = field(a, "front", ark("049"));
    const theirs = field(b, "front", GUARD);
    act("a", { type: "next_phase" });
    expect(bpOf(ctx, guard)).toBe(5000); // two 〈杜宾〉: +1000 each
    expect(bpOf(ctx, other)).toBe(3500);
    expect(bpOf(ctx, cheap)).toBe(1500);
    expect(bpOf(ctx, theirs)).toBe(3000);
    expect(bpOf(ctx, dobermann)).toBe(3500);
  });

  it("博士 (1-051): cannot be played onto or moved to the front line; rests for one more blue energy, then is sidelined when the main phase ends", () => {
    const { a, act } = setup();
    a.hand.push(DOCTOR051);
    expect(() => act("a", { type: "play", handIndex: 0, line: "front" })).toThrow();
    act("a", { type: "play", handIndex: 0, line: "energy" });
    const doctor = a.energy[0]!;
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: doctor.uid, act: "activate" } });
    act("a", { type: "activate", uid: doctor.uid, ability: 1 });
    expect(doctor.rested).toBe(true);
    expect(energyOf(ctx, a, "blue")).toBe(2);
    expect(() => act("a", { type: "activate", uid: doctor.uid, ability: 1 })).toThrow();
    act("a", { type: "next_phase" });
    expect(a.sideline).toEqual([DOCTOR051]);

    const second = setup("main", "b");
    const stays = field(second.a, "energy", DOCTOR051);
    second.act("b", { type: "end_turn" });
    second.act("a", { type: "next_phase" });
    expect(() => second.act("a", { type: "move", toFront: [stays.uid], toEnergy: [], remove: [] })).toThrow("CANNOT_MOVE");
  });

  it("博士 (1-052): rests and discards, once per turn, to look at five and put a blue cost-3-or-less AP-1 character other than 〈博士〉 onto the field resting; sidelined when the main phase ends", () => {
    const { game, a, act } = setup();
    const doctor = field(a, "energy", ark("052"));
    a.library = [DOCTOR051, GUARD, MON3TR, HUANG057, KINGSLAYER, NINE];
    a.hand.push(NINE);
    act("a", { type: "activate", uid: doctor.uid, ability: 1 });
    expect(a.sideline).toEqual([NINE]);
    expect(choice(game).options).toEqual(["l:1", "l:3"]);
    act("a", { type: "choose", picks: ["l:1"] });
    act("a", { type: "choose", picks: ["line:energy"] });
    const placed = a.energy.at(-1)!;
    expect([placed.cardId, placed.rested]).toEqual([GUARD, true]);
    act("a", { type: "choose", picks: ["l:3", "l:2", "l:1", "l:0"] });
    expect(a.library).toEqual([NINE, KINGSLAYER, HUANG057, MON3TR, DOCTOR051]);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: doctor.uid, act: "activate" } });
    expect(() => act("a", { type: "activate", uid: doctor.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([placed]);
    expect(a.sideline).toEqual([NINE, ark("052")]);
  });

  it("红 (1-055): BP-2500 during the opponent's turn", () => {
    const { a, act } = setup();
    const red = field(a, "front", RED);
    expect(bpOf(ctx, red)).toBe(4500);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, red)).toBe(2000);
  });

  it("红 (1-055): returned to the hand during our turn, the next blue 〈红〉 played from the hand this turn costs 1 AP less and comes in active (once per turn)", () => {
    const { game, a, players, act } = setup();
    energy(a, 3);
    const red = field(a, "front", RED);
    a.hand.push(UNKNOWN_TECH);
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "choose", picks: [red.uid] });
    expect(a.hand).toEqual([RED, KINGSLAYER, KINGSLAYER, KINGSLAYER]);
    expect(costOf(game, players, ctx, "a", RED).ap).toBe(0);
    const apBefore = a.ap.filter((card) => !card.rested).length;
    play(act, a, RED, "front");
    expect(a.ap.filter((card) => !card.rested).length).toBe(apBefore);
    const replayed = a.front.at(-1)!;
    expect([replayed.cardId, replayed.rested]).toEqual([RED, false]);
    // Spent, and the effect works only once per turn.
    expect(costOf(game, players, ctx, "a", RED).ap).toBe(1);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: replayed.uid, act: "hand" } });
    expect(costOf(game, players, ctx, "a", RED).ap).toBe(1);

    // Returned during the opponent's turn: nothing.
    const second = setup("main", "b");
    const theirs = field(second.a, "front", RED);
    second.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: theirs.uid, act: "hand" } });
    second.act("b", { type: "end_turn" });
    expect(costOf(second.game, second.players, ctx, "a", RED).ap).toBe(1);
  });

  it("煌 (1-057): 登场时 draws one, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    a.library = [CHEN, KINGSLAYER];
    a.hand.push(HUANG057, NINE);
    play(act, a, HUANG057, "front");
    expect(choice(game).options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([CHEN]);
    expect(a.sideline).toEqual([NINE]);
  });

  it("煌 (1-058): 登场时 makes up to one energy-line character not be sidelined this turn", () => {
    const { game, a, act } = setup();
    energy(a, 1);
    const doctor = field(a, "energy", DOCTOR051);
    const gray = field(a, "front", GRAY0);
    a.hand.push(ark("058"));
    play(act, a, ark("058"), "front");
    expect(choice(game).options).toEqual([a.energy[0]!.uid, doctor.uid]);
    expect(choice(game).options).not.toContain(gray.uid);
    act("a", { type: "choose", picks: [doctor.uid] });
    doctor.bpMod = -2000;
    act("a", { type: "next_phase" });
    expect(a.energy).toContain(doctor);

    const second = setup();
    energy(second.a, 1);
    second.a.hand.push(ark("058"));
    play(second.act, second.a, ark("058"), "front");
    second.act("a", { type: "choose", picks: [] });
    expect(flagsOf(second.a.energy[0]!)).toEqual([]);
  });

  it("迷迭香 (1-060): BP-1000 on the front line; 登场时 opponent front characters with BP 1500+ get BP-500 (BP-1000 with a BP-4000+ energy character)", () => {
    const { a, b, act } = setup();
    energy(a, 3);
    const nine = field(b, "front", NINE);
    const chen = field(b, "front", CHEN);
    const weak = field(b, "front", NINE);
    weak.bpMod = -1000; // 1000
    const back = field(b, "energy", NINE);
    a.hand.push(ark("060"));
    play(act, a, ark("060"), "front");
    expect(bpOf(ctx, a.front[0]!)).toBe(3500);
    expect([bpOf(ctx, nine), bpOf(ctx, chen), bpOf(ctx, weak), bpOf(ctx, back)]).toEqual([1500, 1000, 1000, 2000]);

    const second = setup();
    energy(second.a, 3);
    field(second.a, "energy", MON3TR);
    const nine2 = field(second.b, "front", NINE);
    const chen2 = field(second.b, "front", CHEN);
    second.a.hand.push(ark("060"));
    play(second.act, second.a, ark("060"), "front");
    expect([bpOf(ctx, nine2), bpOf(ctx, chen2)]).toEqual([1000, 500]);
  });

  it("迷迭香 (1-060): once per turn returns a cost-3-or-less character to the hand to use its 登场时 effect again", () => {
    const { game, a, b, act } = setup();
    const rosmontis = field(a, "front", ark("060"));
    const guard = field(a, "energy", GUARD);
    const nine = field(b, "front", NINE);
    const amiya = field(a, "energy", AMIYA0);
    act("a", { type: "activate", uid: rosmontis.uid, ability: 2 });
    expect(choice(game).options).toEqual([guard.uid, amiya.uid]);
    act("a", { type: "choose", picks: [guard.uid] });
    expect(a.hand).toEqual([GUARD]);
    expect(bpOf(ctx, nine)).toBe(1500);
    expect(() => act("a", { type: "activate", uid: rosmontis.uid, ability: 2 })).toThrow("ONCE_PER_TURN");
  });
});

describe("Site and events (UC01BT ARK-1 blue)", () => {
  it("PRTS (1-061): 登场时 looks at four, reveals up to one 罗德岛制药公司 card into the hand, the rest to the bottom", () => {
    const { game, a, act } = setup();
    energy(a, 1);
    a.library = [NINE, GUARD, KINGSLAYER, MON3TR, CHEN];
    a.hand.push(ark("061"));
    play(act, a, ark("061"), "energy");
    expect(choice(game).options).toEqual(["l:1", "l:3"]);
    act("a", { type: "choose", picks: [] });
    act("a", { type: "choose", picks: ["l:0", "l:1", "l:2", "l:3"] });
    expect(a.hand).toEqual([]);
    expect(a.library).toEqual([CHEN, NINE, GUARD, KINGSLAYER, MON3TR]);
  });

  it("应急理智加强剂 (1-062): switches up to two AP cards to active", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.ap[1]!.rested = true;
    a.ap[2]!.rested = true;
    a.hand.push(ark("062"));
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "choose", picks: ["ap:a:ap1", "ap:a:ap2"] });
    expect(a.ap.filter((card) => !card.rested)).toHaveLength(2);
    expect(a.sideline).toEqual([ark("062")]);
    expect(game.pending).toBeNull();
  });

  it("指令：熔毁 (1-063): mode 1 sidelines up to one opponent front character with BP 4000 or less", () => {
    const { game, a, b, act } = setup();
    energy(a, 3);
    const nine = field(b, "front", NINE);
    const big = field(b, "front", NINE);
    big.bpMod = 2500; // 4500
    a.hand.push(ark("063"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game).labels).toHaveLength(2);
    act("a", { type: "choose", picks: ["m:0"] });
    expect(choice(game).options).toEqual([nine.uid]);
    act("a", { type: "choose", picks: [nine.uid] });
    expect(b.front).toEqual([big]);
  });

  it("指令：熔毁 (1-063): mode 2 returns a cost-3-or-less character, then puts a blue BP-4500 AP-1 character on active with BP+1000 and 瞄准攻击", () => {
    const { game, a, act } = setup();
    energy(a, 3);
    const guard = a.energy[0]!;
    a.hand.push(ark("063"), MON3TR);
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "choose", picks: ["m:1"] });
    act("a", { type: "choose", picks: [guard.uid] });
    expect(choice(game).options).toEqual(["h:0"]);
    act("a", { type: "choose", picks: ["h:0"] });
    act("a", { type: "choose", picks: ["line:front"] });
    const placed = a.front[0]!;
    expect([placed.cardId, placed.rested]).toEqual([MON3TR, false]);
    expect(bpOf(ctx, placed)).toBe(5500);
    expect(hasKeyword(ctx, placed, "瞄准攻击")).toBe(true);
    expect(a.hand).toEqual([GUARD]);
  });

  it("精神爆发 (1-064): BP 3000 or less, 5000 or less with 〈阿米娅〉 on our field", () => {
    const { a, b, act } = setup();
    energy(a, 2);
    const mid = field(b, "front", NINE);
    mid.bpMod = 2000; // 4000
    a.hand.push(ark("064"));
    act("a", { type: "event", handIndex: 0 });
    expect(b.front).toEqual([mid]); // no legal target

    const second = setup();
    energy(second.a, 2);
    field(second.a, "front", AMIYA0);
    const mid2 = field(second.b, "front", NINE);
    mid2.bpMod = 2000;
    second.a.hand.push(ark("064"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.b.front).toEqual([]);
    expect(second.b.sideline).toEqual([NINE]);
  });

  it("未知技术 (1-065): returns a cost-3-or-less character to the hand and draws three; with none, nothing", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    const amiya = field(a, "front", AMIYA0);
    field(a, "front", MON3TR);
    a.hand.push(UNKNOWN_TECH);
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game).options).toEqual(expect.arrayContaining([amiya.uid]));
    expect(choice(game).options).toHaveLength(3); // the two Guards and 阿米娅, not Mon3tr
    act("a", { type: "choose", picks: [amiya.uid] });
    expect(a.hand).toEqual([AMIYA0, KINGSLAYER, KINGSLAYER, KINGSLAYER]);

    // Only characters costing more than 3 on the field: nothing to return, no draw.
    const second = setup();
    field(second.a, "energy", ark("047")); // 凯尔希: cost 4, 2 blue energy
    field(second.a, "energy", ark("047"));
    second.a.hand.push(UNKNOWN_TECH);
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([]);
    expect(second.a.sideline).toEqual([UNKNOWN_TECH]);
  });

  it("抓紧我的手！！ (1-066): puts a blue cost-3-or-less AP-1 character from the sideline onto the energy line resting; 〈博士〉 comes in active", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.sideline.push(MON3TR, DOCTOR051, GUARD, NINE);
    a.hand.push(ark("066"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game).options).toEqual(["s:1", "s:2"]);
    act("a", { type: "choose", picks: ["s:1"] });
    const doctor = a.energy.at(-1)!;
    expect([doctor.cardId, doctor.rested]).toEqual([DOCTOR051, false]);

    const second = setup();
    energy(second.a, 2);
    second.a.sideline.push(DOCTOR051, GUARD);
    second.a.hand.push(ark("066"));
    second.act("a", { type: "event", handIndex: 0 });
    second.act("a", { type: "choose", picks: ["s:1"] });
    const guard = second.a.energy.at(-1)!;
    expect([guard.cardId, guard.rested]).toEqual([GUARD, true]);
    expect(second.a.sideline).toEqual([DOCTOR051, ark("066")]);
  });
});
