/**
 * AOT (进击的巨人) batch 6: UEX07BT/AOT-2-001 … 036 (the yellow "Rumbling" deck) and UEPR/AOT-2-068. One test (or more) per card, set up as the printed
 * English text describes and checked against it. Cards are addressed by card number through the shared harness (no card art needed); the text in
 * `cards.json` is the source of truth.
 *
 * Reading used for "four or more yellow characters without [Rumbling] affinity whose card names are unique": four DIFFERENT card names among the
 * yellow characters without the [Rumbling] affinity on your field. The tests build that with the four vanilla names below.
 */
import { describe, expect, it } from "vitest";
import { bpOf, canBlock, costOf, energyOf, flagsOf, hasKeyword, impactOf, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { CARD_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards.ts";
import { legalActions } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/legal.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";

const N = (n: number): string => `UEX07BT/AOT-2-${String(n).padStart(3, "0")}`;
const OLD = (n: number): string => `UE10BT/AOT-1-${String(n).padStart(3, "0")}`;

// Yellow, non-Rumbling helper cards whose only abilities are When Played ones (placed straight on the field they do nothing).
const GABI = N(3); // Gabi Braun: cost 3, makes 2 yellow energy (never a bounce candidate for cost <= 1)
const KIYOMI = N(4); // Kiyomi Azumabito: cost 1, makes 2 yellow energy -- the energy source of these tests (one name, whatever the number of copies)
const ARMIN0 = N(11); // Armin Arlelt, cost 0
const ARMIN3 = N(12); // Armin Arlelt, cost 3 (same name as ARMIN0)
const ANNIE = N(10); // Annie Leonhart, cost 0
const FALCO0 = N(15); // Falco Grice, cost 0
const TOM = N(30); // Tom Ksaver, cost 0
const ONYAN = N(2); // Onyankopon, cost 3
const HANGE = N(7);
// Rumbling vanilla cards (printed "-").
const EREN0 = N(20); // Eren Jaeger, cost 0, [Rumbling／Inheritor of the Titan]
const ZEKE0 = N(23); // Zeke Jaeger, cost 0, [Rumbling／Inheritor of the Titan]
const ZEKE1 = N(24);
const ZEKE_BEAST = N(25);
const YMIR = N(31);
// Opponent / filler cards from Arknights and AOT-1.
const NINE = "UC01BT/ARK-1-088"; // red, cost 0, BP 2000
const GUARD = "UC01ST/ARK-1-103"; // cost 3, BP 3000
const TALULAH = "UC01ST/ARK-1-110"; // cost 5, BP 4000
const MON3TR = "UC01BT/ARK-1-054"; // cost 7, BP 4500
const KINGSLAYER = "UC01BT/ARK-1-004"; // yellow, cost 0, BP 1500 (the harness filler)
const BLUE_E = OLD(2); // Erwin Smith: blue, makes 2 blue energy
const GREYTHROAT = "UC01BT/ARK-1-044"; // blue, cost 3: When Played, an opposing front-line character with 1500 or more BP gets BP-1000

type Game = ReturnType<typeof setup>;
const pick = (g: Game, ...picks: string[]): void => g.act("a", { type: "choose", picks });
/** Answers "which ability first" questions with the first one offered, until nothing is pending. */
const settle = (g: Game): void => { while (g.game.pending?.kind === "choose" && g.game.pending.purpose === "order") pick(g, g.game.pending.options[0]!); };
const yellow = (owner: EnginePlayer, copies: number): void => energy(owner, copies, KIYOMI);
const front = (owner: EnginePlayer, ...numbers: string[]): UnionArenaFieldCard[] => numbers.map((number) => field(owner, "front", number));
const playHand = (g: Game, number: string, line: "front" | "energy" = "front"): void => { g.a.hand.push(number); g.act("a", { type: "play", handIndex: g.a.hand.length - 1, line }); };
const useEvent = (g: Game, number: string): void => { g.a.hand.push(number); g.act("a", { type: "event", handIndex: g.a.hand.length - 1 }); };
const library = (owner: EnginePlayer, top: string[]): void => { owner.library = [...top, ...Array(30 - top.length).fill(KINGSLAYER)]; };
const activeAp = (owner: EnginePlayer): number => owner.ap.filter((card) => !card.rested).length;
/** A harmless manual operation: the engine recomputes continuous effects after every action. */
const refresh = (g: Game): void => g.act("a", { type: "manual", manual: { op: "draw" } });
const attack = (g: Game, uid: string, targetUid?: string): void => g.act("a", { type: "attack", attackerUid: uid, ...(targetUid ? { targetUid } : {}) } as UnionArenaAction);
const sidelineManually = (g: Game, uid: string): void => g.act("a", { type: "manual", manual: { op: "field", owner: "you", uid, act: "sideline" } });
describe("batch 6: every card is automatic except the two Colossal Titans", () => {
  const encoded = [68, ...[...Array(36).keys()].map((index) => index + 1).filter((n) => ![13, 18, 29].includes(n))]; // there is no 018 in this set
  it("has an ability entry (or prints '-') for all cards but 013 and 029", () => {
    for (const n of encoded) {
      const number = n === 68 ? "UEPR/AOT-2-068" : N(n);
      expect(isAutomated(titleCard(number)), number).toBe(true);
    }
  });
  it("leaves out the two Colossal Titans that reduce the front line limit (they stay manual)", () => {
    expect(CARD_ABILITIES[N(13)]).toBeUndefined();
    expect(CARD_ABILITIES[N(29)]).toBeUndefined();
    expect(isAutomated(titleCard(N(13)))).toBe(false);
    expect(isAutomated(titleCard(N(29)))).toBe(false);
  });
  it.each([20, 23])("AOT-2-%i prints '-' and the engine plays it by itself", (n) => {
    expect(titleCard(N(n)).stats.abilityText).toBe("-");
  });
});

describe("UEPR/AOT-2-068 Armin Arlelt", () => {
  const COLOSSAL = N(13);
  it("cuts the required energy of <Armin Arlelt (Colossal Titan)> performing Raid by 2 while it is on the field", () => {
    const g = setup("main");
    expect(costOf(g.game, g.players, ctx, "a", COLOSSAL, true).energy).toBe(9);
    field(g.a, "front", "UEPR/AOT-2-068");
    expect(costOf(g.game, g.players, ctx, "a", COLOSSAL, true).energy).toBe(7);
    // Only a Raid: the cost to play it from the hand is unchanged; other cards' Raid costs too.
    expect(costOf(g.game, g.players, ctx, "a", COLOSSAL, false).energy).toBe(9);
    expect(costOf(g.game, g.players, ctx, "a", N(17), true).energy).toBe(4);
  });
  it("lets the Raid be performed with 7 energy (and not with 6)", () => {
    const six = setup("main");
    yellow(six.a, 3);
    const armin6 = field(six.a, "front", "UEPR/AOT-2-068");
    six.a.hand.push(COLOSSAL);
    expect(() => six.act("a", { type: "raid", handIndex: 0, targetUid: armin6.uid })).toThrow("NOT_ENOUGH_ENERGY");
    const eight = setup("main");
    yellow(eight.a, 4);
    const armin = field(eight.a, "front", "UEPR/AOT-2-068");
    eight.a.hand.push(COLOSSAL);
    eight.act("a", { type: "raid", handIndex: 0, targetUid: armin.uid });
    expect(armin.cardId).toBe(COLOSSAL);
  });
});

describe("AOT-2-001 Yelena", () => {
  it("gains Yellow energy generation while active", () => {
    const g = setup("main");
    const active = field(g.a, "energy", N(1));
    refresh(g);
    expect(energyOf(ctx, g.a, "yellow")).toBe(2);
    active.rested = true;
    refresh(g);
    expect(energyOf(ctx, g.a, "yellow")).toBe(1);
  });
});

describe("AOT-2-002 Onyankopon", () => {
  const prepare = () => {
    const g = setup("main");
    yellow(g.a, 2);
    field(g.a, "front", ARMIN0);
    g.a.hand = [ONYAN, FALCO0, EREN0, HANGE, ARMIN3, NINE, N(21)];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    return g;
  };
  it("offers only yellow characters with 3 or less required energy, 1 AP cost, no [Rumbling] and a card name not on your field; plays one resting", () => {
    const g = prepare();
    // FALCO0 only: EREN0 and N(21) are [Rumbling], HANGE costs 5 / 2 AP, ARMIN3 shares a name with a card on the field, NINE is red.
    expect(choice(g.game, "a").options).toEqual(["h:0"]);
    pick(g, "h:0");
    pick(g, "line:front");
    const falco = g.a.front.find((card) => card.cardId === FALCO0)!;
    expect(falco.rested).toBe(true);
    expect(g.a.hand).toEqual([EREN0, HANGE, ARMIN3, NINE, N(21)]);
  });
  it("'up to one': playing nothing is allowed", () => {
    const g = prepare();
    choice(g.game, "a");
    pick(g);
    expect(g.a.front.map((card) => card.cardId)).toEqual([ARMIN0, ONYAN]);
    expect(g.a.hand).toHaveLength(6);
  });
  it("does nothing when there is no card to play", () => {
    const g = setup("main");
    yellow(g.a, 2);
    g.a.hand = [ONYAN, EREN0];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(g.game.pending).toBeNull();
  });
});

describe("AOT-2-003 Gabi Braun", () => {
  it("with four unique yellow names: another character gains 1500 BP until the end of the turn (not Gabi herself)", () => {
    const g = setup("main");
    yellow(g.a, 2); // one name: Kiyomi
    const [annie, falco] = front(g.a, ANNIE, FALCO0);
    playHand(g, N(3)); // Kiyomi, Annie, Falco, Gabi = four names
    const gabi = g.a.front[2]!;
    const options = choice(g.game, "a").options;
    expect(options).toContain(annie!.uid);
    expect(options).not.toContain(gabi.uid);
    pick(g, falco!.uid);
    expect(bpOf(ctx, falco!)).toBe(2000);
    expect(bpOf(ctx, annie!)).toBe(1000);
    expect(bpOf(ctx, gabi)).toBe(2500);
  });
  it("'up to one': choosing nobody is allowed", () => {
    const g = setup("main");
    yellow(g.a, 2);
    front(g.a, ANNIE, FALCO0);
    playHand(g, N(3));
    choice(g.game, "a");
    pick(g);
    expect(g.game.pending).toBeNull();
    expect(g.a.front.map((card) => bpOf(ctx, card))).toEqual([1000, 500, 2500]);
  });
  it("with three names, two copies of a name, or a [Rumbling] card in the count there is nothing to choose", () => {
    const three = setup("main");
    yellow(three.a, 2);
    front(three.a, ANNIE);
    playHand(three, N(3));
    expect(three.game.pending).toBeNull();
    const twins = setup("main");
    yellow(twins.a, 2);
    front(twins.a, ARMIN0, ARMIN3); // five characters, but only Kiyomi / Armin / Gabi = three names
    playHand(twins, N(3));
    expect(twins.game.pending).toBeNull();
    const rumbling = setup("main");
    yellow(rumbling.a, 2);
    front(rumbling.a, ANNIE, EREN0); // Eren Jaeger is [Rumbling]
    playHand(rumbling, N(3));
    expect(rumbling.game.pending).toBeNull();
  });
});

describe("AOT-2-004 Kiyomi Azumabito", () => {
  it("returns the only other character with 1 or less required energy to the hand", () => {
    const g = setup("main");
    energy(g.a, 1, GABI);
    const annie = field(g.a, "front", ANNIE);
    playHand(g, KIYOMI);
    expect(g.a.hand).toEqual([ANNIE]);
    expect(g.a.front.map((card) => card.cardId)).toEqual([KIYOMI]);
    expect(g.a.front[0]!.uid).not.toBe(annie.uid);
  });
  it("asks which one when there are several; characters with 2 or more required energy are not offered", () => {
    const g = setup("main");
    energy(g.a, 1, GABI);
    const [annie, falco] = front(g.a, ANNIE, FALCO0);
    const pieck = field(g.a, "front", N(14)); // cost 2
    playHand(g, KIYOMI);
    const options = choice(g.game, "a").options;
    expect(options).toContain(annie!.uid);
    expect(options).toContain(falco!.uid);
    expect(options).not.toContain(pieck.uid);
    pick(g, falco!.uid);
    expect(g.a.hand).toEqual([FALCO0]);
  });
  it("returns itself when it cannot return another character", () => {
    const g = setup("main");
    energy(g.a, 1, GABI);
    field(g.a, "front", N(14)); // cost 2: not eligible
    playHand(g, KIYOMI);
    expect(g.a.hand).toEqual([KIYOMI]);
    expect(g.a.front.map((card) => card.cardId)).toEqual([N(14)]);
  });
});

describe("AOT-2-005 Conny Springer", () => {
  it("gains 1000 BP with four unique yellow names, not with three", () => {
    const g = setup("main");
    const conny = field(g.a, "front", N(5));
    front(g.a, ANNIE, FALCO0);
    refresh(g);
    expect(bpOf(ctx, conny)).toBe(2000);
    field(g.a, "front", TOM);
    refresh(g);
    expect(bpOf(ctx, conny)).toBe(3000);
  });
  it("counts different names only: a second Falco Grice or a [Rumbling] card does not make four", () => {
    const g = setup("main");
    const conny = field(g.a, "front", N(5));
    front(g.a, FALCO0, N(16), ANNIE);
    field(g.a, "energy", EREN0);
    refresh(g);
    expect(bpOf(ctx, conny)).toBe(2000); // Conny, Falco, Annie = three names
  });
});

describe("AOT-2-006 Jean Kirschtein", () => {
  it("During Your Turn: gains 1500 BP with four unique yellow names; not on the opponent's turn, not with three", () => {
    const g = setup("main");
    const jean = field(g.a, "front", N(6));
    front(g.a, ANNIE, FALCO0);
    refresh(g);
    expect(bpOf(ctx, jean)).toBe(2500);
    field(g.a, "front", TOM);
    refresh(g);
    expect(bpOf(ctx, jean)).toBe(4000);
    // The opponent's Jean during MY turn is "not during its owner's turn".
    const theirs = field(g.b, "front", N(6));
    front(g.b, ANNIE, FALCO0, TOM);
    refresh(g);
    expect(bpOf(ctx, theirs)).toBe(2500);
  });
});

describe("AOT-2-007 Hange Zoë", () => {
  const withTwo = () => {
    const g = setup("main");
    yellow(g.a, 3);
    front(g.a, ANNIE, FALCO0);
    return g;
  };
  it("is played set to active; with four unique yellow names it gains 2000 BP and Snipe until the end of the turn", () => {
    const g = withTwo();
    playHand(g, HANGE);
    settle(g);
    const hange = g.a.front[2]!;
    expect(hange.rested).toBe(false);
    expect(bpOf(ctx, hange)).toBe(6000);
    expect(hasKeyword(ctx, hange, "瞄准攻击")).toBe(true);
    expect(g.a.ap.filter((card) => card.rested)).toHaveLength(2); // 2 AP
  });
  it("without four unique names it is only set to active", () => {
    const g = setup("main");
    yellow(g.a, 3);
    front(g.a, ANNIE);
    playHand(g, HANGE);
    settle(g);
    const hange = g.a.front[1]!;
    expect(hange.rested).toBe(false);
    expect(bpOf(ctx, hange)).toBe(4000);
    expect(hasKeyword(ctx, hange, "瞄准攻击")).toBe(false);
  });
  it("At the end of your opponent's attack phase, sideline this character (not at the end of your own)", () => {
    const g = setup("main");
    const hange = field(g.a, "front", HANGE);
    g.act("a", { type: "next_phase" });
    g.act("a", { type: "end_turn" }); // end of my own attack phase
    expect(g.a.front).toContain(hange);
    g.act("b", { type: "next_phase" }); // start -> movement
    g.act("b", { type: "next_phase" }); // movement -> main
    g.act("b", { type: "next_phase" }); // main -> attack
    expect(g.a.front).toContain(hange);
    g.act("b", { type: "next_phase" }); // the opponent's attack phase ends
    expect(g.a.front).not.toContain(hange);
    expect(g.a.sideline).toEqual([HANGE]);
  });
  it("the opponent ending its turn straight from the main phase also ends its (skipped) attack phase: she is sidelined", () => {
    const g = setup("main");
    const hange = field(g.a, "front", HANGE);
    g.act("a", { type: "end_turn" }); // from the main phase
    expect(g.a.front).toContain(hange);
    g.act("b", { type: "next_phase" });
    g.act("b", { type: "next_phase" });
    g.act("b", { type: "end_turn" }); // from the main phase
    expect(g.a.front).not.toContain(hange);
    expect(g.a.sideline).toEqual([HANGE]);
  });
  it("Once Per Turn: wins an attack against a character with 5000 or more BP: switches to active and loses Snipe", () => {
    const g = withTwo();
    playHand(g, HANGE);
    settle(g);
    const hange = g.a.front[2]!;
    const big = field(g.b, "front", TALULAH);
    big.bpMod = 1000; // 5000 BP
    g.act("a", { type: "next_phase" });
    attack(g, hange.uid, big.uid); // Snipe: no block
    expect(g.b.front).toEqual([]);
    expect(hange.rested).toBe(false); // switched to active
    expect(hasKeyword(ctx, hange, "瞄准攻击")).toBe(false);
    expect(hange.used).toContain(2);
  });
  it("Once Per Turn: it works only once; a second win against a 5000+ BP blocker does not switch it to active again", () => {
    const g = withTwo();
    playHand(g, HANGE);
    settle(g);
    const hange = g.a.front[2]!;
    const big = field(g.b, "front", TALULAH);
    big.bpMod = 1000;
    const blocker = field(g.b, "front", TALULAH);
    blocker.bpMod = 1000;
    g.act("a", { type: "next_phase" });
    attack(g, hange.uid, big.uid);
    expect(hange.rested).toBe(false);
    attack(g, hange.uid); // no Snipe any more: the opponent may block
    g.act("b", { type: "block", blockerUid: blocker.uid });
    expect(g.b.front).toEqual([]);
    expect(hange.rested).toBe(true);
  });
  it("a win against a character with less than 5000 BP does nothing, and does not use up the 'once per turn'", () => {
    const g = withTwo();
    playHand(g, HANGE);
    settle(g);
    const hange = g.a.front[2]!;
    const small = field(g.b, "front", TALULAH); // 4000
    g.act("a", { type: "next_phase" });
    attack(g, hange.uid, small.uid);
    expect(g.b.front).toEqual([]);
    expect(hange.rested).toBe(true);
    expect(hasKeyword(ctx, hange, "瞄准攻击")).toBe(true);
    expect(hange.used ?? []).not.toContain(2);
  });
});

describe("AOT-2-008 Mikasa Ackermann", () => {
  it("cannot be blocked by a character with 5000 or more BP", () => {
    const g = setup("main");
    const mikasa = field(g.a, "front", N(8));
    const big = field(g.b, "front", MON3TR);
    big.bpMod = 500; // 5000
    const small = field(g.b, "front", TALULAH); // 4000
    refresh(g);
    expect(canBlock(ctx, mikasa, big)).toBe(false);
    expect(canBlock(ctx, mikasa, small)).toBe(true);
    big.bpMod = 499; // 4999
    expect(canBlock(ctx, mikasa, big)).toBe(true);
  });
  it("gains Impact (1) only if the opponent has exactly 1 life", () => {
    const g = setup("main");
    const mikasa = field(g.a, "front", N(8));
    refresh(g);
    expect(impactOf(ctx, mikasa)).toBe(0);
    g.b.life = g.b.life.slice(0, 2);
    refresh(g);
    expect(impactOf(ctx, mikasa)).toBe(0);
    g.b.life = g.b.life.slice(0, 1);
    refresh(g);
    expect(impactOf(ctx, mikasa)).toBe(1);
  });
  it("When Played: with four unique yellow names and the opponent at 5 or less life it switches to active; once per turn for <Mikasa Ackermann>", () => {
    const g = setup("main");
    yellow(g.a, 4); // 8 energy for two Mikasa
    front(g.a, ANNIE, FALCO0);
    g.b.life = g.b.life.slice(0, 5);
    playHand(g, N(8));
    expect(g.a.front[2]!.rested).toBe(false);
    playHand(g, N(8)); // the second <Mikasa Ackermann> in the same turn: the ability cannot be activated again
    expect(g.a.front[3]!.rested).toBe(true);
  });
  it("When Played: stays resting with 6 life, or without four unique names", () => {
    const life = setup("main");
    yellow(life.a, 2);
    front(life.a, ANNIE, FALCO0);
    playHand(life, N(8));
    expect(life.b.life).toHaveLength(7);
    expect(life.a.front[2]!.rested).toBe(true);
    const names = setup("main");
    yellow(names.a, 2);
    front(names.a, ANNIE);
    names.b.life = names.b.life.slice(0, 5);
    playHand(names, N(8));
    expect(names.a.front[1]!.rested).toBe(true);
  });
  it("When Played: the one-time limit is used even when the effect found its condition false", () => {
    const g = setup("main");
    yellow(g.a, 4);
    front(g.a, ANNIE, FALCO0);
    playHand(g, N(8)); // 7 life: nothing happens, but the ability was activated
    g.b.life = g.b.life.slice(0, 5);
    playHand(g, N(8));
    expect(g.a.front[3]!.rested).toBe(true);
  });
});

describe("AOT-2-009 Levi", () => {
  const prepare = (rested = true) => {
    const g = setup("main");
    front(g.a, ANNIE, FALCO0, TOM);
    const levi = field(g.a, "front", N(9), rested);
    return { g, levi };
  };
  it("During Your Turn: gains 1000 BP", () => {
    const g = setup("main");
    const mine = field(g.a, "front", N(9));
    const theirs = field(g.b, "front", N(9));
    refresh(g);
    expect(bpOf(ctx, mine)).toBe(5000);
    expect(bpOf(ctx, theirs)).toBe(4000);
  });
  it("Activate: Main needs four unique yellow names (Levi included)", () => {
    const g = setup("main");
    front(g.a, ANNIE, FALCO0);
    const levi = field(g.a, "front", N(9), true);
    expect(() => g.act("a", { type: "activate", uid: levi.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    expect(activeAp(g.a)).toBe(3);
  });
  it("pays 1 AP and chooses ONE ability: switch to active", () => {
    const { g, levi } = prepare();
    g.act("a", { type: "activate", uid: levi.uid, ability: 1 });
    expect(activeAp(g.a)).toBe(2);
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1"]); // empty hand: no card to place into the sideline, so only one ability
    pick(g, "m:0");
    expect(levi.rested).toBe(false);
    expect(hasKeyword(ctx, levi, "2次攻击")).toBe(false);
  });
  it("or the other one: gains Double Attack until the end of the turn", () => {
    const { g, levi } = prepare();
    g.act("a", { type: "activate", uid: levi.uid, ability: 1 });
    pick(g, "m:1");
    expect(levi.rested).toBe(true);
    expect(hasKeyword(ctx, levi, "2次攻击")).toBe(true);
  });
  it("may place one card from the hand into the sideline: if so, BOTH abilities", () => {
    const { g, levi } = prepare();
    g.a.hand = [NINE];
    g.act("a", { type: "activate", uid: levi.uid, ability: 1 });
    expect(choice(g.game, "a").options).toEqual(["yes", "no"]);
    pick(g, "yes");
    expect(g.a.sideline).toEqual([NINE]);
    expect(g.a.hand).toEqual([]);
    expect(levi.rested).toBe(false);
    expect(hasKeyword(ctx, levi, "2次攻击")).toBe(true);
    expect(g.game.pending).toBeNull();
  });
  it("declining the sideline card leaves a single choice, and the card stays in hand", () => {
    const { g, levi } = prepare();
    g.a.hand = [NINE];
    g.act("a", { type: "activate", uid: levi.uid, ability: 1 });
    pick(g, "no");
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1"]);
    pick(g, "m:1");
    expect(g.a.hand).toEqual([NINE]);
    expect(levi.rested).toBe(true);
  });
  it("<Levi> can only activate this ability one time each turn, whichever copy", () => {
    const { g, levi } = prepare();
    const other = field(g.a, "front", N(9), true);
    g.act("a", { type: "activate", uid: levi.uid, ability: 1 });
    pick(g, "m:1");
    expect(() => g.act("a", { type: "activate", uid: levi.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    expect(() => g.act("a", { type: "activate", uid: other.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    expect(activeAp(g.a)).toBe(2);
  });
});

/** Answers an ordered "put the rest on the bottom" question with the options as they are listed. */
const keepOrder = (g: Game): void => { const options = [...choice(g.game, "a").options]; pick(g, ...options); };

describe("AOT-2-010 Annie Leonhart", () => {
  it("Activate: Main (switch to resting, once per turn): +1 Yellow energy this turn and she is sidelined at the end of the main phase", () => {
    const g = setup("main");
    const annie = field(g.a, "energy", ANNIE);
    refresh(g);
    expect(energyOf(ctx, g.a, "yellow")).toBe(1);
    g.act("a", { type: "activate", uid: annie.uid, ability: 0 });
    expect(annie.rested).toBe(true);
    expect(energyOf(ctx, g.a, "yellow")).toBe(2);
    annie.rested = false;
    expect(() => g.act("a", { type: "activate", uid: annie.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    expect(g.a.energy).toContain(annie);
    g.act("a", { type: "next_phase" }); // the main phase ends
    expect(g.a.energy).not.toContain(annie);
    expect(g.a.sideline).toEqual([ANNIE]);
  });
  it("the end of the main phase also comes when the turn is ended from the main phase", () => {
    const g = setup("main");
    const annie = field(g.a, "energy", ANNIE);
    g.act("a", { type: "activate", uid: annie.uid, ability: 0 });
    g.act("a", { type: "end_turn" });
    expect(g.a.energy).not.toContain(annie);
    expect(g.a.sideline).toEqual([ANNIE]);
  });
  it("stays on the field when the ability is not used", () => {
    const g = setup("main");
    field(g.a, "energy", ANNIE);
    g.act("a", { type: "next_phase" });
    expect(g.a.energy).toHaveLength(1);
  });
});

describe("AOT-2-011 Armin Arlelt", () => {
  it("When Played: draw a card, then place one card from your hand into your sideline", () => {
    const g = setup("main");
    library(g.a, [N(21)]);
    g.a.hand = [ARMIN0, NINE, TALULAH];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(g.a.hand).toEqual([NINE, TALULAH, N(21)]);
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    pick(g, "h:2");
    expect(g.a.hand).toEqual([NINE, TALULAH]);
    expect(g.a.sideline).toEqual([N(21)]);
  });
});

describe("AOT-2-012 Armin Arlelt", () => {
  it("When Played: draw a card, then place one card from your hand into your sideline", () => {
    const g = setup("main");
    yellow(g.a, 2);
    front(g.a, ANNIE);
    library(g.a, [N(21)]);
    g.a.hand = [ARMIN3, NINE];
    g.act("a", { type: "play", handIndex: 0, line: "front" }); // Kiyomi, Annie, Armin = three names
    expect(g.a.hand).toEqual([NINE, N(21)]);
    pick(g, "h:0");
    expect(g.a.sideline).toEqual([NINE]);
    expect(g.a.hand).toEqual([N(21)]);
  });
  it("with four unique yellow names it only draws a card", () => {
    const g = setup("main");
    yellow(g.a, 2);
    front(g.a, ANNIE, FALCO0);
    library(g.a, [N(21)]);
    g.a.hand = [ARMIN3, NINE];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(g.game.pending).toBeNull();
    expect(g.a.hand).toEqual([NINE, N(21)]);
    expect(g.a.sideline).toEqual([]);
  });
});

describe("AOT-2-014 Pieck Finger", () => {
  it("When Played on the energy line with four unique yellow names: switches to active", () => {
    const g = setup("main");
    yellow(g.a, 1);
    front(g.a, ANNIE, FALCO0);
    playHand(g, N(14), "energy"); // Kiyomi, Annie, Falco, Pieck
    expect(g.a.energy[1]!.rested).toBe(false);
  });
  it("When Played on the front line, or without four unique names: stays resting", () => {
    const onFront = setup("main");
    yellow(onFront.a, 1);
    front(onFront.a, ANNIE, FALCO0);
    playHand(onFront, N(14), "front");
    expect(onFront.a.front[2]!.rested).toBe(true);
    const three = setup("main");
    yellow(three.a, 1);
    front(three.a, ANNIE);
    playHand(three, N(14), "energy");
    expect(three.a.energy[1]!.rested).toBe(true);
  });
  it("Activate: Main (switch to resting): another character gains 1000 BP until the end of the turn", () => {
    const g = setup("main");
    const pieck = field(g.a, "front", N(14));
    const [annie] = front(g.a, ANNIE);
    g.act("a", { type: "activate", uid: pieck.uid, ability: 1 });
    expect(pieck.rested).toBe(true);
    expect(bpOf(ctx, annie!)).toBe(2000);
    expect(bpOf(ctx, pieck)).toBe(2000); // not Pieck herself
  });
});

describe("AOT-2-015 Falco Grice", () => {
  it("When Played: up to one other character gains 1000 BP until the end of the turn", () => {
    const g = setup("main");
    const [annie] = front(g.a, ANNIE);
    playHand(g, FALCO0);
    expect(choice(g.game, "a").options).toEqual([annie!.uid]); // not Falco himself
    pick(g, annie!.uid);
    expect(bpOf(ctx, annie!)).toBe(2000);
    expect(bpOf(ctx, g.a.front[1]!)).toBe(500);
  });
  it("'up to one': choosing nobody is allowed", () => {
    const g = setup("main");
    const [annie] = front(g.a, ANNIE);
    playHand(g, FALCO0);
    pick(g);
    expect(bpOf(ctx, annie!)).toBe(1000);
  });
});

describe("AOT-2-016 Falco Grice", () => {
  it("When Played: reveals up to one character without [Rumbling] among the top 3, then places a hand card into the sideline", () => {
    const g = setup("main");
    yellow(g.a, 1);
    library(g.a, [EREN0, N(33), ARMIN0]);
    g.a.hand = [N(16), NINE];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    // Eren Jaeger is [Rumbling], the event is no character: only Armin.
    expect(choice(g.game, "a").options).toEqual(["l:2"]);
    pick(g, "l:2");
    keepOrder(g); // the rest go to the bottom
    expect(g.a.library.slice(-2)).toEqual([EREN0, N(33)]);
    expect(g.a.hand).toEqual([NINE, ARMIN0]);
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1"]); // a card added: place one from the hand
    pick(g, "h:0");
    expect(g.a.sideline).toEqual([NINE]);
    expect(g.a.hand).toEqual([ARMIN0]);
  });
  it("adding nothing: no card is placed into the sideline", () => {
    const g = setup("main");
    yellow(g.a, 1);
    library(g.a, [EREN0, N(33), ARMIN0]);
    g.a.hand = [N(16), NINE];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(g);
    keepOrder(g);
    expect(g.a.hand).toEqual([NINE]);
    expect(g.a.sideline).toEqual([]);
    expect(g.a.library.slice(-3)).toEqual([EREN0, N(33), ARMIN0]);
  });
});

describe("AOT-2-017 Falco Grice (Jaw Titan)", () => {
  const prepare = () => {
    const g = setup("main");
    yellow(g.a, 2);
    const [annie, armin] = front(g.a, ANNIE, ARMIN0, EREN0);
    const hange = field(g.a, "energy", HANGE); // cost 5: never eligible
    g.a.sideline = [FALCO0, ARMIN3, ZEKE0, N(32), HANGE];
    g.a.hand = [N(17)];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    return { g, annie: annie!, armin: armin!, hange };
  };
  it("has Step", () => {
    const { g } = prepare();
    expect(hasKeyword(ctx, g.a.front.find((card) => card.cardId === N(17))!, "撤步")).toBe(true);
  });
  it("When Played: up to three characters (field, then sideline), cost 3 or less, unique names, no [Rumbling], go face down under it", () => {
    const { g, annie, armin, hange } = prepare();
    const first = choice(g.game, "a").options;
    expect(first).toContain(annie.uid);
    expect(first).toContain(armin.uid);
    expect(first).not.toContain(hange.uid); // cost 5
    expect(first).not.toContain(g.a.front[2]!.uid); // Eren Jaeger is [Rumbling]
    pick(g, annie.uid, armin.uid);
    // Sideline: Falco (cost 0) and the second Armin Arlelt are offered; [Rumbling], event and cost 5 are not.
    expect(choice(g.game, "a").options).toEqual(["s:0", "s:1"]);
    expect(() => pick(g, "s:1")).toThrow("INVALID_CHOICE"); // a second <Armin Arlelt>: names must be unique
    pick(g, "s:0");
    const jaw = g.a.front.find((card) => card.cardId === N(17))!;
    expect(jaw.faceDown).toEqual([ANNIE, ARMIN0, FALCO0]);
    expect(g.a.front.map((card) => card.cardId)).not.toContain(ANNIE);
    expect(g.a.sideline).toEqual([ARMIN3, ZEKE0, N(32), HANGE]);
  });
  it("no more than three cards in total", () => {
    const { g, annie, armin } = prepare();
    const kiyomi = g.a.energy.find((card) => card.cardId === KIYOMI)!;
    pick(g, annie.uid, armin.uid, kiyomi.uid);
    expect(() => pick(g, "s:0")).toThrow("INVALID_CHOICE"); // a fourth one
    pick(g);
    const jaw = g.a.front.find((card) => card.cardId === N(17))!;
    expect(jaw.faceDown).toEqual([ANNIE, ARMIN0, KIYOMI]);
  });
  it("cards with the same name cannot both be chosen from the field", () => {
    const { g } = prepare();
    const [k1, k2] = g.a.energy.filter((card) => card.cardId === KIYOMI);
    expect(() => pick(g, k1!.uid, k2!.uid)).toThrow("INVALID_CHOICE");
  });
  it("Activate: Main (switch to resting): look at the face-down cards and add up to one of them to your hand; the others stay face down", () => {
    const { g, annie, armin } = prepare();
    pick(g, annie.uid, armin.uid);
    pick(g, "s:0");
    const jaw = g.a.front.find((card) => card.cardId === N(17))!;
    jaw.rested = false;
    g.act("a", { type: "activate", uid: jaw.uid, ability: 2 });
    expect(jaw.rested).toBe(true);
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1", "l:2"]);
    pick(g, "l:1");
    expect(g.a.hand).toEqual([ARMIN0]);
    expect(jaw.faceDown).toEqual([ANNIE, FALCO0]);
    expect(g.game.looking?.cards ?? []).toEqual([]);
    expect(g.a.library).toHaveLength(30);
  });
  it("Activate: Main: taking nothing leaves every card face down", () => {
    const { g, annie, armin } = prepare();
    pick(g, annie.uid, armin.uid);
    pick(g, "s:0");
    const jaw = g.a.front.find((card) => card.cardId === N(17))!;
    jaw.rested = false;
    g.act("a", { type: "activate", uid: jaw.uid, ability: 2 });
    pick(g);
    expect(g.a.hand).toEqual([]);
    expect(jaw.faceDown).toEqual([ANNIE, ARMIN0, FALCO0]);
  });
});

describe("AOT-2-019 Reiner Braun (Armored Titan)", () => {
  const REINER_RAID = N(19);
  it("has Nullify Impact, and Raid <Reiner Braun>", () => {
    const g = setup("main");
    yellow(g.a, 3);
    const reiner = field(g.a, "front", "UE10BT/AOT-1-058");
    g.a.hand.push(REINER_RAID);
    g.act("a", { type: "raid", handIndex: 0, targetUid: reiner.uid });
    expect(reiner.cardId).toBe(REINER_RAID);
    expect(hasKeyword(ctx, reiner, "冲击无效")).toBe(true);
  });
  it("When Played with four unique yellow names: +1000 BP, Impact (1) and an AP tax on the opponent's choices, until the start of your next turn", () => {
    const g = setup("main");
    yellow(g.a, 3);
    front(g.a, ANNIE, FALCO0);
    g.a.hand = [REINER_RAID];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    const reiner = g.a.front[2]!;
    expect(bpOf(ctx, reiner)).toBe(5000);
    expect(impactOf(ctx, reiner)).toBe(1);
    expect(flagsOf(reiner)).toEqual(expect.arrayContaining(["taxAp:character", "taxAp:event"]));
    // It lasts through the opponent's turn: an opponent event that chooses it costs the opponent 1 AP on top of its own.
    g.act("a", { type: "end_turn" });
    g.act("b", { type: "next_phase" });
    g.act("b", { type: "next_phase" });
    expect(g.game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, reiner)).toBe(5000);
    field(g.b, "front", ZEKE0);
    g.b.hand = [OLD(66)]; // I'm Going For a Perfect Game.: 5000 or less BP with a "Zeke Jaeger" on the field
    g.act("b", { type: "event", handIndex: 0 });
    expect(g.b.ap.filter((card) => !card.rested)).toHaveLength(1); // the event's AP
    g.act("b", { type: "choose", picks: [reiner.uid] });
    expect(g.a.sideline).toContain(REINER_RAID);
    expect(g.b.ap.filter((card) => !card.rested)).toHaveLength(0); // plus 1 AP for choosing Reiner
  });
  it("When Played without four unique names: nothing", () => {
    const g = setup("main");
    yellow(g.a, 3);
    front(g.a, ANNIE);
    playHand(g, REINER_RAID);
    const reiner = g.a.front[1]!;
    expect(bpOf(ctx, reiner)).toBe(4000);
    expect(impactOf(ctx, reiner)).toBe(0);
    expect(flagsOf(reiner)).toEqual([]);
  });
});

describe("AOT-2-021 Eren Jaeger", () => {
  it("gains Yellow energy generation if <Ymir, Our Founder> is in your sideline", () => {
    const g = setup("main");
    field(g.a, "energy", N(21));
    refresh(g);
    expect(energyOf(ctx, g.a, "yellow")).toBe(1);
    g.a.sideline.push(YMIR);
    refresh(g);
    expect(energyOf(ctx, g.a, "yellow")).toBe(2);
  });
  it("gains it if <Ymir, Our Founder> is on your field (Ymir herself makes 2 more)", () => {
    const g = setup("main");
    field(g.a, "energy", N(21));
    field(g.a, "energy", YMIR);
    refresh(g);
    expect(energyOf(ctx, g.a, "yellow")).toBe(1 + 1 + 2);
  });
  it("does not gain it for Ymir in the opponent's sideline", () => {
    const g = setup("main");
    field(g.a, "energy", N(21));
    g.b.sideline.push(YMIR);
    refresh(g);
    expect(energyOf(ctx, g.a, "yellow")).toBe(1);
  });
});

describe("AOT-2-022 Eren Jaeger (Doomsday Titan)", () => {
  const DOOMSDAY = N(22);
  const JAW = N(26);
  const BEAST = N(27);
  const WAR_HAMMER = N(28);
  it("reduces its required energy by 5 while a character with Zeke in its name is on your field and no Doomsday Titan is", () => {
    const g = setup("main");
    expect(costOf(g.game, g.players, ctx, "a", DOOMSDAY).energy).toBe(13);
    const zeke = field(g.a, "front", ZEKE0);
    expect(costOf(g.game, g.players, ctx, "a", DOOMSDAY).energy).toBe(8);
    field(g.a, "front", DOOMSDAY);
    expect(costOf(g.game, g.players, ctx, "a", DOOMSDAY).energy).toBe(13);
    zeke.cardId = EREN0; // no longer a Zeke
    expect(costOf(g.game, g.players, ctx, "a", DOOMSDAY).energy).toBe(13);
  });
  it("has Impact (1) and cannot block a character with Impact", () => {
    const g = setup("main");
    const doom = field(g.a, "front", DOOMSDAY);
    const striker = field(g.b, "front", NINE);
    refresh(g);
    expect(impactOf(ctx, doom)).toBe(1);
    expect(canBlock(ctx, striker, doom)).toBe(true);
    striker.grants = ["冲击1"];
    expect(canBlock(ctx, striker, doom)).toBe(false);
  });
  it("When Played: plays up to one [Nine Titans] card from the hand set to active", () => {
    const g = setup("main");
    yellow(g.a, 4);
    field(g.a, "front", ZEKE0);
    g.a.hand = [DOOMSDAY, JAW, BEAST, NINE];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1"]); // Jaw Titan and Beast Titan, not the red character
    pick(g, "h:1");
    pick(g, "line:front");
    const beast = g.a.front.find((card) => card.cardId === BEAST)!;
    expect(beast.rested).toBe(false);
    expect(g.a.hand).toEqual([JAW, NINE]);
  });
  it("When Played: or from the sideline, when none is taken from the hand", () => {
    const g = setup("main");
    yellow(g.a, 4);
    field(g.a, "front", ZEKE0);
    g.a.hand = [DOOMSDAY, JAW];
    g.a.sideline = [NINE, WAR_HAMMER];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(g); // nothing from the hand
    expect(choice(g.game, "a").options).toEqual(["s:1"]);
    pick(g, "s:1");
    pick(g, "line:front");
    const hammer = g.a.front.find((card) => card.cardId === WAR_HAMMER)!;
    expect(hammer.rested).toBe(false);
    expect(g.a.sideline).toEqual([NINE]);
    expect(g.a.hand).toEqual([JAW]);
  });
  it("When Played: with no [Nine Titans] card in hand or sideline nothing is asked", () => {
    const g = setup("main");
    yellow(g.a, 4);
    field(g.a, "front", ZEKE0);
    g.a.hand = [DOOMSDAY, NINE];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(g.game.pending).toBeNull();
  });
  it("Activate: Main (pay 1 AP, once per turn): activates its When Played ability again", () => {
    const g = setup("main");
    const doom = field(g.a, "front", DOOMSDAY);
    g.a.hand = [JAW];
    g.act("a", { type: "activate", uid: doom.uid, ability: 3 });
    expect(activeAp(g.a)).toBe(2);
    expect(choice(g.game, "a").options).toEqual(["h:0"]);
    pick(g, "h:0");
    pick(g, "line:front");
    expect(g.a.front.find((card) => card.cardId === JAW)!.rested).toBe(false);
    g.a.hand = [BEAST];
    expect(() => g.act("a", { type: "activate", uid: doom.uid, ability: 3 })).toThrow("ONCE_PER_TURN");
  });
  it("Activate: Main cannot be used on the turn this character is played (played or by Raid)", () => {
    const played = setup("main");
    yellow(played.a, 4);
    field(played.a, "front", ZEKE0);
    played.a.hand = [DOOMSDAY];
    played.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(played.game.pending).toBeNull();
    const doom = played.a.front[1]!;
    expect(() => played.act("a", { type: "activate", uid: doom.uid, ability: 3 })).toThrow("ABILITY_CONDITION");
    const raided = setup("main");
    yellow(raided.a, 4);
    const eren = field(raided.a, "front", EREN0);
    field(raided.a, "front", ZEKE0);
    raided.a.hand = [DOOMSDAY];
    raided.act("a", { type: "raid", handIndex: 0, targetUid: eren.uid });
    expect(raided.game.pending).toBeNull(); // nothing to play
    expect(eren.cardId).toBe(DOOMSDAY);
    expect(() => raided.act("a", { type: "activate", uid: eren.uid, ability: 3 })).toThrow("ABILITY_CONDITION");
  });
});

describe("AOT-2-024 Zeke Jaeger", () => {
  it("When Played, first mode: looks at the top 3, places up to one into the sideline, the rest on the bottom", () => {
    const g = setup("main");
    yellow(g.a, 1);
    library(g.a, [NINE, TALULAH, GUARD]);
    playHand(g, ZEKE1);
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1"]);
    pick(g, "m:0");
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1", "l:2"]);
    pick(g, "l:1");
    keepOrder(g);
    expect(g.a.sideline).toEqual([TALULAH]);
    expect(g.a.library.slice(-2)).toEqual([NINE, GUARD]);
    expect(g.a.hand).toEqual([]);
  });
  it("first mode: 'up to one' lets all three go to the bottom", () => {
    const g = setup("main");
    yellow(g.a, 1);
    library(g.a, [NINE, TALULAH, GUARD]);
    playHand(g, ZEKE1);
    pick(g, "m:0");
    pick(g);
    keepOrder(g);
    expect(g.a.sideline).toEqual([]);
    expect(g.a.library.slice(-3)).toEqual([NINE, TALULAH, GUARD]);
  });
  it("second mode: no card is drawn when it was played from the hand", () => {
    const g = setup("main");
    yellow(g.a, 1);
    playHand(g, ZEKE1);
    pick(g, "m:1");
    expect(g.a.hand).toEqual([]);
    expect(g.a.library).toHaveLength(30);
  });
  it("second mode: a card is drawn when it was played from the sideline", () => {
    const g = setup("main");
    const ymir = field(g.a, "energy", YMIR);
    g.a.hand = [NINE, NINE];
    g.a.sideline = [ZEKE1];
    g.act("a", { type: "activate", uid: ymir.uid, ability: 2 }); // plays it from the sideline (Ymir, Our Founder)
    pick(g, "line:front");
    pick(g, "m:1");
    expect(g.a.front.map((card) => card.cardId)).toEqual([ZEKE1]);
    expect(g.a.hand).toEqual([KINGSLAYER]);
  });
});

describe("AOT-2-025 Zeke Jaeger (Beast Titan)", () => {
  const BEAST = N(25);
  const prepare = (withEren: boolean, withYmir: boolean) => {
    const g = setup("main");
    yellow(g.a, 3);
    if (withEren) field(g.a, "energy", EREN0);
    if (withYmir) g.a.sideline.push(YMIR);
    const guard = field(g.b, "front", GUARD); // 3000
    const talulah = field(g.b, "front", TALULAH); // 4000
    const mon3tr = field(g.b, "front", MON3TR); // 4500
    g.a.hand = [BEAST];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    return { g, guard, talulah, mon3tr };
  };
  it("When Played: gains Impact (1) until the end of the turn; sidelines a front-line character with 3000 or less BP", () => {
    const { g, guard, talulah } = prepare(false, false);
    expect(impactOf(ctx, g.a.front[0]!)).toBe(1);
    expect(choice(g.game, "a").options).toEqual([guard.uid]);
    pick(g, guard.uid);
    expect(g.b.sideline).toEqual([GUARD]);
    expect(g.b.front).toContain(talulah);
  });
  it("'up to one': choosing nobody sidelines nobody", () => {
    const { g } = prepare(false, false);
    pick(g);
    expect(g.b.front).toHaveLength(3);
  });
  it.each([[true, false], [false, true]])("only Eren (%s) or only Ymir (%s): still 3000", (withEren, withYmir) => {
    const { g, guard } = prepare(withEren, withYmir);
    expect(choice(g.game, "a").options).toEqual([guard.uid]);
  });
  it("with a character with Eren in its name on your field and Ymir in your sideline: 4000 or less BP", () => {
    const { g, guard, talulah, mon3tr } = prepare(true, true);
    const options = choice(g.game, "a").options;
    expect(options.sort()).toEqual([guard.uid, talulah.uid].sort());
    expect(options).not.toContain(mon3tr.uid);
    pick(g, talulah.uid);
    expect(g.b.sideline).toEqual([TALULAH]);
  });
});

describe("AOT-2-026 Jaw Titan", () => {
  it("with an Eren and a Zeke on your field it generates energy even on the front line", () => {
    const g = setup("main");
    field(g.a, "front", N(26));
    refresh(g);
    expect(energyOf(ctx, g.a, "yellow")).toBe(0);
    field(g.a, "front", EREN0);
    refresh(g);
    expect(energyOf(ctx, g.a, "yellow")).toBe(0); // no Zeke yet
    field(g.a, "front", ZEKE0);
    refresh(g);
    expect(energyOf(ctx, g.a, "yellow")).toBe(1);
  });
});

describe("AOT-2-027 Beast Titan", () => {
  it("has Step, and during your turn gains 1500 BP with an Eren and a Zeke on your field", () => {
    const g = setup("main");
    const beast = field(g.a, "front", N(27));
    expect(hasKeyword(ctx, beast, "撤步")).toBe(true);
    refresh(g);
    expect(bpOf(ctx, beast)).toBe(2500);
    field(g.a, "front", EREN0);
    refresh(g);
    expect(bpOf(ctx, beast)).toBe(2500);
    field(g.a, "energy", ZEKE0);
    refresh(g);
    expect(bpOf(ctx, beast)).toBe(4000);
  });
  it("not during the opponent's turn", () => {
    const g = setup("main");
    const theirs = field(g.b, "front", N(27));
    field(g.b, "front", EREN0);
    field(g.b, "front", ZEKE0);
    refresh(g);
    expect(bpOf(ctx, theirs)).toBe(2500);
  });
});

describe("AOT-2-028 War Hammer Titan", () => {
  it("with an Eren and a Zeke on your field it gains Double Block and the opponent-character immunity", () => {
    const g = setup("main");
    const hammer = field(g.a, "front", N(28));
    refresh(g);
    expect(hasKeyword(ctx, hammer, "2次阻挡")).toBe(false);
    expect(flagsOf(hammer)).toEqual([]);
    field(g.a, "front", EREN0);
    field(g.a, "front", ZEKE0);
    refresh(g);
    expect(hasKeyword(ctx, hammer, "2次阻挡")).toBe(true);
    expect(flagsOf(hammer)).toContain("immuneOppCharacter");
  });
  it("the opponent's character abilities can neither sideline it nor reduce its BP, but their events can sideline it", () => {
    const g = setup("main", "b");
    // b is the turn player; a owns the War Hammer Titan (BP 4000) with Eren and Zeke.
    const hammer = field(g.a, "front", N(28));
    field(g.a, "front", EREN0);
    field(g.a, "front", ZEKE0);
    energy(g.b, 2, BLUE_E); // 4 blue energy
    field(g.b, "front", EREN0);
    g.b.sideline.push(YMIR);
    refreshFor(g, "b");
    // Greythroat (a character): BP-1000 on a front-line character with 1500 or more BP.
    g.b.hand = [GREYTHROAT];
    g.act("b", { type: "play", handIndex: 0, line: "front" });
    g.act("b", { type: "choose", picks: [hammer.uid] });
    expect(bpOf(ctx, hammer)).toBe(4000);
    // Zeke Jaeger (Beast Titan) (a character) with Eren + Ymir: sidelines a character with 4000 or less BP.
    yellow(g.b, 3);
    g.b.hand = [N(25)];
    g.act("b", { type: "play", handIndex: 0, line: "front" });
    g.act("b", { type: "choose", picks: [hammer.uid] });
    expect(g.a.front).toContain(hammer);
    expect(g.a.sideline).toEqual([]);
    // Levi's Barrage (an event) with a Levi on the field: sidelines it.
    field(g.b, "energy", OLD(7));
    g.b.hand = [OLD(34)];
    g.act("b", { type: "event", handIndex: 0 });
    g.act("b", { type: "choose", picks: [hammer.uid] });
    expect(g.a.front).not.toContain(hammer);
    expect(g.a.sideline).toEqual([N(28)]);
  });
  it("without an Eren and a Zeke on your field the same character abilities do work", () => {
    const g = setup("main", "b");
    const hammer = field(g.a, "front", N(28));
    energy(g.b, 2, BLUE_E);
    g.b.hand = [GREYTHROAT];
    g.act("b", { type: "play", handIndex: 0, line: "front" });
    g.act("b", { type: "choose", picks: [hammer.uid] });
    expect(bpOf(ctx, hammer)).toBe(3000);
    yellow(g.b, 3);
    g.b.hand = [N(25)];
    g.act("b", { type: "play", handIndex: 0, line: "front" });
    g.act("b", { type: "choose", picks: [hammer.uid] }); // 3000 or less BP now
    expect(g.a.front).toEqual([]);
    expect(g.a.sideline).toEqual([N(28)]);
  });
});

/** Like `refresh`, for the turn player "b". */
function refreshFor(g: Game, who: "a" | "b"): void { g.act(who, { type: "manual", manual: { op: "draw" } }); }

describe("AOT-2-030 Tom Ksaver", () => {
  it("When Played: reveals the top 2 cards, adds up to one with Zeke in its name to your hand, the rest go to the sideline, then place a hand card into the sideline", () => {
    const g = setup("main");
    library(g.a, [ZEKE0, NINE]);
    g.a.hand = [TOM, TALULAH];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(g.game, "a").options).toEqual(["l:0"]); // only the Zeke
    pick(g, "l:0");
    expect(g.a.hand).toEqual([TALULAH, ZEKE0]);
    expect(g.a.sideline).toEqual([NINE]);
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1"]);
    pick(g, "h:0");
    expect(g.a.sideline).toEqual([NINE, TALULAH]);
    expect(g.a.hand).toEqual([ZEKE0]);
    expect(g.a.library).toHaveLength(28);
  });
  it("adding nothing: both cards go to the sideline and no hand card is placed", () => {
    const g = setup("main");
    library(g.a, [ZEKE0, NINE]);
    g.a.hand = [TOM, TALULAH];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(g);
    expect(g.a.sideline).toEqual([ZEKE0, NINE]);
    expect(g.a.hand).toEqual([TALULAH]);
    expect(g.game.pending).toBeNull();
  });
  it("When Sidelined: does the same", () => {
    const g = setup("main");
    const tom = field(g.a, "front", TOM);
    library(g.a, [NINE, ZEKE1]);
    g.a.hand = [GUARD];
    sidelineManually(g, tom.uid);
    expect(choice(g.game, "a").options).toEqual(["l:1"]);
    pick(g, "l:1");
    expect(g.a.hand).toEqual([GUARD, ZEKE1]);
    pick(g, "h:1");
    expect(g.a.sideline).toEqual([TOM, NINE, ZEKE1]);
    expect(g.a.hand).toEqual([GUARD]);
  });
});

describe("AOT-2-031 Ymir, Our Founder", () => {
  it("can only be played if a character with Jaeger in its card name is on your field", () => {
    const g = setup("main");
    g.a.hand = [YMIR];
    expect(() => g.act("a", { type: "play", handIndex: 0, line: "energy" })).toThrow("PLAY_CONDITION");
    expect(legalActions(g.game, g.players, ctx, "a").some((action) => action.type === "play")).toBe(false);
    expect(g.a.hand).toEqual([YMIR]);
    field(g.a, "front", ANNIE); // not a Jaeger
    expect(() => g.act("a", { type: "play", handIndex: 0, line: "energy" })).toThrow("PLAY_CONDITION");
    field(g.a, "front", EREN0);
    expect(legalActions(g.game, g.players, ctx, "a").some((action) => action.type === "play" && action.handIndex === 0)).toBe(true);
    library(g.a, []);
    g.act("a", { type: "play", handIndex: 0, line: "energy" });
    expect(g.a.energy.map((card) => card.cardId)).toEqual([YMIR]);
  });
  it("When Played: reveals up to one [Inheritor of the Titan] card among the top 4, then places a hand card into the sideline", () => {
    const g = setup("main");
    field(g.a, "front", EREN0);
    library(g.a, [ARMIN0, NINE, FALCO0, ONYAN]);
    g.a.hand = [YMIR, TALULAH];
    g.act("a", { type: "play", handIndex: 0, line: "energy" });
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:2"]); // Armin and Falco have the affinity, Onyankopon and the red character do not
    pick(g, "l:2");
    keepOrder(g);
    expect(g.a.library.slice(-3)).toEqual([ARMIN0, NINE, ONYAN]);
    expect(g.a.hand).toEqual([TALULAH, FALCO0]);
    pick(g, "h:0");
    expect(g.a.sideline).toEqual([TALULAH]);
  });
  it("When Played: adding nothing places no hand card", () => {
    const g = setup("main");
    field(g.a, "front", EREN0);
    library(g.a, [ARMIN0, NINE, FALCO0, ONYAN]);
    g.a.hand = [YMIR, TALULAH];
    g.act("a", { type: "play", handIndex: 0, line: "energy" });
    pick(g);
    keepOrder(g);
    expect(g.a.hand).toEqual([TALULAH]);
    expect(g.a.sideline).toEqual([]);
  });
  it("Activate: Main (rest, place 2 hand cards into the sideline, pay 1 AP): plays a yellow character with 2 or less required energy and Jaeger in its name from the sideline resting", () => {
    const g = setup("main");
    const ymir = field(g.a, "energy", YMIR);
    g.a.sideline = [ANNIE, ZEKE_BEAST, EREN0, ZEKE1, HANGE]; // Annie: no Jaeger; Beast Titan: cost 6; Hange: no Jaeger
    g.a.hand = [NINE, TALULAH, GUARD];
    g.act("a", { type: "activate", uid: ymir.uid, ability: 2 });
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    pick(g, "h:0", "h:2");
    expect(ymir.rested).toBe(true);
    expect(activeAp(g.a)).toBe(2);
    expect(g.a.hand).toEqual([TALULAH]);
    expect(choice(g.game, "a").options).toEqual(["s:2", "s:3"]); // Eren Jaeger and Zeke Jaeger (cost 1)
    pick(g, "s:2");
    pick(g, "line:front");
    const eren = g.a.front[0]!;
    expect(eren.cardId).toBe(EREN0);
    expect(eren.rested).toBe(true);
    expect(g.a.sideline).toEqual([ANNIE, ZEKE_BEAST, ZEKE1, HANGE, NINE, GUARD]);
  });
  it("Activate: Main needs 2 hand cards, 1 AP and an active site", () => {
    const g = setup("main");
    const ymir = field(g.a, "energy", YMIR);
    g.a.hand = [NINE];
    expect(() => g.act("a", { type: "activate", uid: ymir.uid, ability: 2 })).toThrow("ABILITY_COST");
    expect(ymir.rested).toBe(false);
  });
});

describe("AOT-2-032 I Hope You're Watching, Mister Ksaver!!", () => {
  const prepare = () => {
    const g = setup("main");
    const zeke = field(g.a, "front", ZEKE1);
    const guard = field(g.b, "front", GUARD);
    const talulah = field(g.b, "front", TALULAH);
    const big = field(g.b, "front", MON3TR);
    big.bpMod = 500; // 5000: still allowed
    const bigger = field(g.b, "front", MON3TR);
    bigger.bpMod = 501; // 5001: too much
    g.a.hand = [N(32)];
    g.act("a", { type: "event", handIndex: 0 });
    return { g, zeke, guard, talulah, big, bigger };
  };
  it("sidelines your yellow Zeke character, then an opposing front-line character with 5000 or less BP", () => {
    const { g, zeke, guard, talulah, big, bigger } = prepare();
    expect(g.a.front).not.toContain(zeke);
    expect(g.a.sideline).toContain(ZEKE1);
    const options = choice(g.game, "a").options;
    expect(options.sort()).toEqual([guard.uid, talulah.uid, big.uid].sort());
    expect(options).not.toContain(bigger.uid);
    pick(g, talulah.uid);
    expect(g.b.sideline).toEqual([TALULAH]);
  });
  it("then up to one of the following: look at the top 7 and reveal <Ymir, Our Founder> into your hand", () => {
    const { g, talulah } = prepare();
    library(g.a, [NINE, NINE, NINE, YMIR]);
    pick(g, talulah.uid);
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1"]);
    pick(g, "m:0");
    expect(choice(g.game, "a").options).toEqual(["l:3"]);
    pick(g, "l:3");
    keepOrder(g);
    expect(g.a.hand).toEqual([YMIR]);
    expect(g.a.library.slice(-6)).toEqual([NINE, NINE, NINE, KINGSLAYER, KINGSLAYER, KINGSLAYER]);
  });
  it("or: with <Ymir, Our Founder> in your sideline, plays a yellow <Zeke Jaeger> without Raid from the sideline resting", () => {
    const { g, talulah } = prepare();
    g.a.sideline.push(YMIR, ZEKE_BEAST, ZEKE0, N(21), ANNIE);
    pick(g, talulah.uid);
    pick(g, "m:1");
    // Zeke Jaeger (cost 1, just sidelined) and Zeke Jaeger (cost 0): both are <Zeke Jaeger>; the Beast Titan has Raid.
    expect(choice(g.game, "a").options).toEqual(["s:0", "s:3"]);
    pick(g, "s:3");
    pick(g, "line:energy");
    const played = g.a.energy[0]!;
    expect(played.cardId).toBe(ZEKE0);
    expect(played.rested).toBe(true);
  });
  it("or: without <Ymir, Our Founder> on the field or in the sideline the second mode does nothing", () => {
    const { g, talulah } = prepare();
    pick(g, talulah.uid);
    pick(g, "m:1");
    expect(g.game.pending).toBeNull();
    expect(g.a.front).toEqual([]);
  });
  it("'up to one': choosing neither mode is allowed", () => {
    const { g, talulah } = prepare();
    g.a.sideline.push(YMIR);
    pick(g, talulah.uid);
    pick(g);
    expect(g.game.pending).toBeNull();
    expect(g.a.hand).toEqual([]);
  });
  it("without a yellow character with Zeke in its name on your field nothing else happens", () => {
    const g = setup("main");
    field(g.a, "front", EREN0);
    const target = field(g.b, "front", GUARD);
    g.a.hand = [N(32)];
    g.act("a", { type: "event", handIndex: 0 });
    expect(g.game.pending).toBeNull();
    expect(g.b.front).toContain(target);
    expect(g.a.sideline).toEqual([N(32)]);
  });
});

describe.each([33, 35])("AOT-2-0%i (choose up to two of your AP cards and switch them to active)", (n) => {
  it("switches up to two chosen resting AP cards to active", () => {
    const g = setup("main");
    g.a.ap.forEach((card) => { card.rested = true; });
    g.a.ap[2]!.rested = false;
    useEvent(g, N(n)); // pays the last active AP
    expect(activeAp(g.a)).toBe(0);
    expect(choice(g.game, "a").options).toHaveLength(3);
    pick(g, "ap:a:ap0", "ap:a:ap2");
    expect(activeAp(g.a)).toBe(2);
    expect(g.a.ap[1]!.rested).toBe(true);
  });
  it("'up to two': choosing one or none is allowed", () => {
    const g = setup("main");
    useEvent(g, N(n));
    expect(activeAp(g.a)).toBe(2); // the event's own AP
    pick(g, `ap:${g.a.ap.find((card) => card.rested)!.id}`);
    expect(activeAp(g.a)).toBe(3);
    const none = setup("main");
    useEvent(none, N(n));
    pick(none);
    expect(activeAp(none.a)).toBe(2);
  });
});

describe("AOT-2-034 Rumbling", () => {
  const prepare = (hand: string[] = [N(34), NINE, TALULAH]) => {
    const g = setup("main");
    const eren = field(g.a, "front", EREN0);
    field(g.a, "front", ZEKE0);
    g.a.hand = hand;
    return { g, eren };
  };
  it("can only be used with an Eren and a Zeke on your field and two or more OTHER cards in your hand", () => {
    const noZeke = setup("main");
    field(noZeke.a, "front", EREN0);
    noZeke.a.hand = [N(34), NINE, TALULAH];
    expect(() => noZeke.act("a", { type: "event", handIndex: 0 })).toThrow("EVENT_CONDITION");
    const { g } = prepare([N(34), NINE]);
    expect(() => g.act("a", { type: "event", handIndex: 0 })).toThrow("EVENT_CONDITION");
    expect(legalActions(g.game, g.players, ctx, "a").some((action) => action.type === "event")).toBe(false);
    expect(g.a.hand).toEqual([N(34), NINE]);
    const enough = prepare();
    expect(legalActions(enough.g.game, enough.g.players, ctx, "a").some((action) => action.type === "event")).toBe(true);
  });
  it("places all the cards in your hand into your sideline and sidelines every opposing front-line character with 5000 or less BP", () => {
    const { g } = prepare();
    const low = field(g.b, "front", GUARD);
    const edge = field(g.b, "front", MON3TR);
    edge.bpMod = 500; // exactly 5000
    const over = field(g.b, "front", MON3TR);
    over.bpMod = 501; // 5001
    const rested = field(g.b, "front", TALULAH, true); // a resting character counts as well
    const energyLine = field(g.b, "energy", NINE); // not on the front line
    g.act("a", { type: "event", handIndex: 0 });
    expect(g.a.hand).toEqual([]);
    expect(g.a.sideline).toEqual([NINE, TALULAH, N(34)]);
    expect(g.b.front).toEqual([over]);
    expect(g.b.sideline).toEqual(expect.arrayContaining([GUARD, MON3TR, TALULAH]));
    expect(g.b.sideline).toHaveLength(3);
    expect(g.b.energy).toEqual([energyLine]);
    expect([low, edge, rested].every((card) => !g.b.front.includes(card))).toBe(true);
  });
  it("you cannot attack with characters other than <Eren Jaeger (Doomsday Titan)> until the end of the turn", () => {
    const { g } = prepare();
    const doom = field(g.a, "front", N(22));
    const annie = field(g.a, "front", ANNIE);
    g.act("a", { type: "event", handIndex: 0 });
    g.act("a", { type: "next_phase" }); // attack phase
    expect(() => attack(g, annie.uid)).toThrow("INVALID_ATTACKER");
    expect(() => attack(g, g.a.front[0]!.uid)).toThrow("INVALID_ATTACKER");
    expect(legalActions(g.game, g.players, ctx, "a").filter((action) => action.type === "attack").map((action) => (action as { attackerUid: string }).attackerUid)).toEqual([doom.uid]);
    attack(g, doom.uid); // the opponent has no blocker left
    expect(g.game.pending?.kind).toBe("damage");
  });
  it("a character that enters the field later in the turn is held back too; the next turn is free again", () => {
    const { g } = prepare();
    g.act("a", { type: "event", handIndex: 0 });
    const late = field(g.a, "front", ANNIE);
    refresh(g);
    expect(flagsOf(late)).toContain("cannotAttack");
    g.act("a", { type: "end_turn" });
    g.act("b", { type: "next_phase" });
    g.act("b", { type: "next_phase" });
    g.act("b", { type: "end_turn" });
    expect(g.game.turnPlayerId).toBe("a");
    expect(flagsOf(late)).not.toContain("cannotAttack");
  });
});

describe("AOT-2-036 We're Going. Now. To Save the World", () => {
  it("looks at the top 5 and reveals up to three characters with unique names and without [Rumbling]; the rest go to the bottom", () => {
    const g = setup("main");
    library(g.a, [ARMIN0, ARMIN3, FALCO0, EREN0, N(33)]);
    useEvent(g, N(36));
    // Rumbling Eren and the event cannot be taken.
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1", "l:2"]);
    expect(() => pick(g, "l:0", "l:1")).toThrow("INVALID_CHOICE"); // two Armin Arlelt
    pick(g, "l:0", "l:2");
    keepOrder(g);
    expect(g.a.hand).toEqual([ARMIN0, FALCO0]);
    expect(g.a.library.slice(-3)).toEqual([ARMIN3, EREN0, N(33)]);
    expect(g.game.pending).toBeNull();
  });
  it("up to three, and up to is also none", () => {
    const g = setup("main");
    library(g.a, [ARMIN0, FALCO0, ANNIE, TOM, N(33)]);
    useEvent(g, N(36));
    expect(() => pick(g, "l:0", "l:1", "l:2", "l:3")).toThrow();
    pick(g, "l:0", "l:1", "l:3");
    keepOrder(g);
    expect(g.a.hand).toEqual([ARMIN0, FALCO0, TOM]);
    const none = setup("main");
    library(none.a, [ARMIN0, FALCO0, ANNIE, TOM, N(33)]);
    useEvent(none, N(36));
    pick(none);
    keepOrder(none);
    expect(none.a.hand).toEqual([]);
    expect(none.a.library.slice(-5)).toEqual([ARMIN0, FALCO0, ANNIE, TOM, N(33)]);
  });
});
