/**
 * The last three cards: the sideline replacements of Ace (UC01ST/ARK-1-106) and 煌 (UC01BT/ARK-1-059), "可以改为……" asked of the owner before
 * the character leaves, and 博士 (UCEX01BT/ARK-2-053), whose ability activates whenever it is put into the sideline from anywhere.
 */
import { describe, expect, it } from "vitest";
import { applyAction, beginFirstTurn, hasKeyword, newEngineGame, type EngineGame, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaChoice, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { cardContext, isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { legalActions } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/legal.ts";
import { UNION_ARENA_CATALOG } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/catalog.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx = cardContext((cardId) => byId.get(cardId));
const id = (number: string): string => UNION_ARENA_CATALOG.find((card) => card.number === number && card.imageAvailable)!.id;

const ACE = id("UC01ST/ARK-1-106");
const HUANG = id("UC01BT/ARK-1-059");
const DOCTOR = id("UCEX01BT/ARK-2-053");
const KINGSLAYER = id("UC01BT/ARK-1-004"); // yellow, BP1500
const NINE = id("UC01BT/ARK-1-088"); // red, BP2000
const HOSHI = id("UC01BT/ARK-1-092"); // red, BP4000
const CHIXIAO = id("UC01BT/ARK-1-096"); // 赤霄・拔刀: event, trigger 特殊
const CHEN_PURPLE = id("UCEX01BT/ARK-2-034"); // 陈: purple, BP1500
const GUARD = id("UC01ST/ARK-1-103"); // blue, BP3000

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

/** `first`'s turn, in the given phase, with three active AP cards. */
function setup(phase: "main" | "attack" = "main", first: "a" | "b" = "a") {
  const a = player("a");
  const b = player("b");
  const game = newEngineGame(first, []);
  beginFirstTurn(game, [a, b]);
  (first === "a" ? a : b).ap = [0, 1, 2].map((index) => ({ id: `${first}:ap${index}`, rested: false }));
  const players = [a, b];
  const act = (who: string, action: UnionArenaAction): void => applyAction(game, players, ctx, who, action);
  while (game.phase !== phase) act(first, { type: "next_phase" });
  return { game, a, b, players, act };
}

const confirm = (game: EngineGame, playerId: string): UnionArenaChoice => {
  expect(game.pending).toMatchObject({ kind: "choose", purpose: "confirm", playerId });
  return game.pending as UnionArenaChoice;
};

it("all three are now automated", () => {
  for (const cardId of [ACE, HUANG, DOCTOR]) expect(isAutomated(byId.get(cardId)!)).toBe(true);
});

describe("Ace (ST 1-106)", () => {
  /** b blocks a's 4000 attacker with a 2000 character while b's Ace is on the front line. */
  function blockedBattle(aceLine: "front" | "energy" = "front") {
    const setupResult = setup("attack");
    const { a, b, act } = setupResult;
    const attacker = field(a, "front", HOSHI);
    const ace = field(b, aceLine, ACE);
    const blocker = field(b, "front", NINE);
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: blocker.uid });
    return { ...setupResult, ace, blocker };
  }

  it("asks its owner whether Ace leaves instead of the character that lost the battle", () => {
    const { game, b, ace, blocker, act, players } = blockedBattle();
    expect(confirm(game, "b").prompt).toContain("Ace");
    expect(legalActions(game, players, ctx, "b")).toHaveLength(2);
    act("b", { type: "choose", picks: ["yes"] });
    expect(b.front).toEqual([blocker]);
    expect(b.sideline).toEqual([ACE]);
    expect(b.front).not.toContain(ace);
  });

  it("declined, the character is sidelined as usual", () => {
    const { game, b, ace, act } = blockedBattle();
    confirm(game, "b");
    act("b", { type: "choose", picks: ["no"] });
    expect(b.front).toEqual([ace]);
    expect(b.sideline).toEqual([NINE]);
    expect(game.pending?.kind === "choose" && (game.pending as UnionArenaChoice).purpose === "confirm").toBe(false);
  });

  it("only works from the front line, and not for BP 0 or less", () => {
    const { game, b } = blockedBattle("energy");
    expect(game.pending?.kind === "choose").toBe(false);
    expect(b.sideline).toEqual([NINE]);

    const second = setup();
    field(second.b, "front", ACE);
    const weak = field(second.b, "front", NINE);
    weak.bpMod = -5000;
    second.act("a", { type: "next_phase" });
    expect(second.b.sideline).toEqual([NINE]);
    expect(second.game.pending).toBeNull();
  });
});

describe("煌 (1-059)", () => {
  /** a attacks with 煌 (a Raid with one card under it); b's revealed life card is 赤霄・拔刀, whose 特殊 trigger sidelines 煌. */
  function hitBySpecial() {
    const setupResult = setup("attack");
    const { a, b, act } = setupResult;
    const huang = field(a, "front", HUANG);
    huang.under = [GUARD];
    b.life[0]!.cardId = CHIXIAO;
    act("a", { type: "attack", attackerUid: huang.uid });
    act("a", { type: "damage", lifeIds: [b.life[0]!.id] });
    act("b", { type: "trigger", lifeId: "b:life:0", activate: true, targetUid: huang.uid });
    return { ...setupResult, huang };
  }

  it("in our turn, puts its Raid source into the sideline and draws instead of leaving", () => {
    const { game, a, huang, act } = hitBySpecial();
    confirm(game, "a");
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.front).toEqual([huang]);
    expect(huang.under).toEqual([]);
    expect(a.sideline).toEqual([GUARD]);
    expect(a.hand).toEqual([KINGSLAYER]);
  });

  it("needs a Raid source, and works once per turn", () => {
    const first = hitBySpecial();
    first.act("a", { type: "choose", picks: ["yes"] });
    // Once used this turn, the next sidelining goes ahead.
    first.huang.under = [GUARD];
    const nextLife = first.b.life[0]!;
    nextLife.cardId = CHIXIAO;
    first.huang.rested = false;
    first.huang.attacks = 0;
    first.act("a", { type: "attack", attackerUid: first.huang.uid });
    first.act("a", { type: "damage", lifeIds: [nextLife.id] });
    first.act("b", { type: "trigger", lifeId: nextLife.id, activate: true, targetUid: first.huang.uid });
    expect(first.a.front).toEqual([]);

    const { a, b, act, game } = setup("attack");
    const bare = field(a, "front", HUANG);
    b.life[0]!.cardId = CHIXIAO;
    act("a", { type: "attack", attackerUid: bare.uid });
    act("a", { type: "damage", lifeIds: [b.life[0]!.id] });
    act("b", { type: "trigger", lifeId: "b:life:0", activate: true, targetUid: bare.uid });
    expect(a.sideline).toEqual([HUANG]);
    expect(game.pending?.kind === "choose").toBe(false);
  });

  it("gets 《伤害2》 with another BP-4000 character on both the front line and the energy line", () => {
    const { a, act } = setup();
    const huang = field(a, "front", HUANG);
    field(a, "front", HOSHI);
    act("a", { type: "next_phase" });
    expect(hasKeyword(ctx, huang, "伤害2")).toBe(false);
    field(a, "energy", HOSHI);
    act("a", { type: "next_phase" });
    expect(hasKeyword(ctx, huang, "伤害2")).toBe(true);
  });
});

describe("博士 (2-053)", () => {
  it("put into the sideline from the hand, may go to the removal area and use its 【登场时】", () => {
    const { game, a, act } = setup();
    const chen = field(a, "front", CHEN_PURPLE);
    a.hand.push(DOCTOR);
    act("a", { type: "manual", manual: { op: "hand", handIndex: 0, act: "sideline" } });
    confirm(game, "a");
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.sideline).toEqual([]);
    expect(a.removal).toEqual([DOCTOR]);
    expect((game.pending as UnionArenaChoice).options).toEqual([chen.uid]);
    act("a", { type: "choose", picks: [chen.uid] });
    expect(chen.bpMod).toBe(1000);
  });

  it("declined, it stays in the sideline and is not asked about again", () => {
    const { game, a, act } = setup();
    a.hand.push(DOCTOR);
    act("a", { type: "manual", manual: { op: "hand", handIndex: 0, act: "sideline" } });
    act("a", { type: "choose", picks: ["no"] });
    expect(a.sideline).toEqual([DOCTOR]);
    act("a", { type: "next_phase" });
    expect(game.pending).toBeNull();
  });

  it("also when it leaves the field, and it cannot be played to the front line", () => {
    const { game, a, act } = setup();
    const doctor = field(a, "energy", DOCTOR);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: doctor.uid, act: "sideline" } });
    confirm(game, "a");
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.removal).toEqual([DOCTOR]);

    const second = setup();
    for (let index = 0; index < 3; index += 1) field(second.a, "energy", CHEN_PURPLE);
    second.a.hand.push(DOCTOR);
    expect(() => second.act("a", { type: "play", handIndex: 0, line: "front" })).toThrow("ENERGY_LINE_ONLY");
  });
});
