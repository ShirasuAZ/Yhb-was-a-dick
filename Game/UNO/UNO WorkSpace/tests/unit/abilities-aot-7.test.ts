/**
 * AOT (进击的巨人) batch 7: UEX07BT/AOT-2-037 … 073 (blue, green and red cards). One test (or more) per card, set up as the printed English text
 * describes and checked against it. Cards are addressed by number through the shared harness (no card art needed); `cards.json` is the source of truth.
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, energyOf, hasKeyword, impactOf, raidTargetMatches, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { legalActions } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/legal.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { CARD_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";

const U = (n: number): string => `UEX07BT/AOT-2-${String(n).padStart(3, "0")}`;
const BT = (n: number): string => `UE10BT/AOT-1-${String(n).padStart(3, "0")}`;
const ST = (n: number): string => `UE10ST/AOT-1-${String(n).padStart(3, "0")}`;

// Energy sources (placed straight on the energy line, so their own text never matters).
const BLUE_E = U(41); // Levi: blue, makes 2 blue energy
const GREEN_E = U(50); // Gabi Braun: green, makes 2 green energy
const RED_E = U(64); // Jean Kirschtein: red, makes 2 red energy
// Helper cards without abilities.
const KINGSLAYER = "UC01BT/ARK-1-004"; // yellow, cost 0, BP 1500 (the harness filler)
const PIECK0 = U(54); // Pieck Finger: green, cost 0, BP 1500, [Marleyan Warrior／Inheritor of the Titan], no text
const PORCO0 = U(57); // Porco Galliard: green, cost 0, BP 2000, [Marleyan Warrior／Inheritor of the Titan], no text
const ZEKE0 = U(23); // Zeke Jaeger: yellow, cost 0, BP 1500, no text
const EREN0 = U(20); // Eren Jaeger: yellow, cost 0, BP 1500, no text
const REINER0 = U(18); // Reiner Braun: yellow, BP 1500 (a Raid target named "Reiner Braun")
const MIKASA_RED = ST(85); // Mikasa Ackermann: red, cost 0, BP 2000, [104th Cadet Corps／Levi Squad], no text
const PURE_TITAN = BT(42); // Pure Titan: green, cost 0, BP 2000, [Pure Titan], no text
const PURE_TITAN_B = BT(43); // Pure Titan: green, cost 1, BP 2500, [Pure Titan], no text
const SASHA_BLUE = U(43); // Sasha Braus: blue, cost 2, [104th Cadet Corps]
const SASHA_RED = U(65); // Sasha Braus: red, cost 4, [104th Cadet Corps]
const HISTORIA_BLUE = U(44); // Historia Reiss 044: blue, cost 0, [104th Cadet Corps]
const EVENT = U(49); // Thunder Spears (blue event)
const SEAFOOD = U(73); // Seafood: [Food] event, AP 1

type Game = ReturnType<typeof setup>;
const pick = (g: Game, ...picks: string[]): void => g.act("a", { type: "choose", picks });
const yes = (g: Game): void => { expect(choice(g.game, "a").options).toEqual(["yes", "no"]); pick(g, "yes"); };
const no = (g: Game): void => { expect(choice(g.game, "a").options).toEqual(["yes", "no"]); pick(g, "no"); };
const attack = (g: Game, uid: string, targetUid?: string): void => g.act("a", { type: "attack", attackerUid: uid, ...(targetUid ? { targetUid } : {}) } as UnionArenaAction);
const apRested = (g: Game): number => g.a.ap.filter((card) => card.rested).length;
const front = (g: Game, number: string, rested = false): UnionArenaFieldCard => field(g.a, "front", number, rested);
/** Puts `number` into the hand and plays it. */
function playCard(g: Game, number: string, line: "front" | "energy" = "front"): void {
  g.a.hand.push(number);
  g.act("a", { type: "play", handIndex: g.a.hand.length - 1, line });
}
function useEvent(g: Game, number: string): void {
  g.a.hand.push(number);
  g.act("a", { type: "event", handIndex: g.a.hand.length - 1 });
}
/** Puts `number` into the hand and performs Raid with it onto `target`. */
function raidOnto(g: Game, number: string, target: UnionArenaFieldCard): void {
  g.a.hand.push(number);
  g.act("a", { type: "raid", handIndex: g.a.hand.length - 1, targetUid: target.uid });
}
/** Gives the field card exactly this BP (this turn). */
function setBp(card: UnionArenaFieldCard, value: number): UnionArenaFieldCard {
  card.bpMod += value - bpOf(ctx, card);
  return card;
}
/** An opponent character on a line with the given BP. */
const foe = (g: Game, value: number, line: "front" | "energy" = "front"): UnionArenaFieldCard => setBp(field(g.b, line, KINGSLAYER), value);
const library = (owner: EnginePlayer, top: string[]): void => { owner.library = [...top, ...Array(30 - top.length).fill(KINGSLAYER)]; };
const sidelineEvents = (owner: EnginePlayer, count: number): void => { owner.sideline = Array(count).fill(EVENT); };
/** A harmless manual operation: the engine recomputes continuous effects after every action. */
const refresh = (g: Game): void => g.act("a", { type: "manual", manual: { op: "draw" } });

describe("AOT batch 7: every card is automatic", () => {
  const numbers = [...Array(37).keys()].map((index) => index + 37).filter((n) => n !== 63 && n !== 68 && n !== 69);
  it("has an ability entry (or is keyword-only / printed '-') for all cards of the batch", () => {
    expect(numbers).toHaveLength(34);
    for (const n of numbers) expect(isAutomated(titleCard(U(n))), U(n)).toBe(true);
  });
  it("cards printed with '-' are empty entries, and playing one does nothing", () => {
    for (const n of [54, 57]) {
      expect(titleCard(U(n)).stats.abilityText).toBe("-");
      const g = setup("main");
      playCard(g, U(n));
      expect(g.game.pending, U(n)).toBeNull();
      expect(g.a.front).toHaveLength(1);
    }
  });
  it("Armin Arlelt (Colossal Titan) 069 changes the line limit and stays manual", () => {
    expect(CARD_ABILITIES[U(69)]).toBeUndefined();
    expect(isAutomated(titleCard(U(69)))).toBe(false);
  });
});

describe("AOT-2-037 I'll Do It. Everyone Cover Me", () => {
  it("reduces its AP cost by 1 with four yellow characters (no [Rumbling]) whose card names are all different", () => {
    const g = setup("main");
    expect(costOf(g.game, g.players, ctx, "a", U(37)).ap).toBe(2);
    for (const n of [1, 2, 3]) field(g.a, "front", U(n)); // Yelena, Onyankopon, Gabi Braun: three names
    expect(costOf(g.game, g.players, ctx, "a", U(37)).ap).toBe(2);
    field(g.a, "energy", U(11)); // Armin Arlelt: the fourth name
    expect(costOf(g.game, g.players, ctx, "a", U(37)).ap).toBe(1);
    field(g.a, "energy", U(12)); // a second Armin Arlelt changes nothing
    expect(costOf(g.game, g.players, ctx, "a", U(37)).ap).toBe(1);
  });
  it("does not count the same name twice, [Rumbling] characters or non-yellow characters", () => {
    const g = setup("main");
    for (const n of [1, 2]) field(g.a, "front", U(n));
    field(g.a, "front", U(11));
    field(g.a, "front", U(12)); // same name as 011
    field(g.a, "energy", U(20)); // Eren Jaeger, yellow but [Rumbling／Inheritor of the Titan]
    field(g.a, "energy", U(38)); // Hange Zoë, blue
    expect(costOf(g.game, g.players, ctx, "a", U(37)).ap).toBe(2);
    field(g.a, "energy", U(4)); // Kiyomi Azumabito: a fourth name
    expect(costOf(g.game, g.players, ctx, "a", U(37)).ap).toBe(1);
  });
  it("sidelines one opponent front-line character with 5000 or less BP", () => {
    const g = setup("main");
    const small = foe(g, 3000);
    const edge = foe(g, 5000);
    const big = foe(g, 5500);
    const bench = foe(g, 1000, "energy");
    useEvent(g, U(37));
    expect([...choice(g.game, "a").options].sort()).toEqual([edge.uid, small.uid].sort());
    expect(choice(g.game).options).not.toContain(big.uid);
    expect(choice(g.game).options).not.toContain(bench.uid);
    pick(g, edge.uid);
    expect(g.b.front.map((card) => card.uid)).toEqual([small.uid, big.uid]);
    expect(g.b.sideline).toEqual([KINGSLAYER]);
    expect(apRested(g)).toBe(2);
    expect(g.a.sideline).toEqual([U(37)]);
  });
  it("with <Mikasa Ackermann> on the field the limit is 8000", () => {
    const g = setup("main");
    front(g, U(46)); // Mikasa Ackermann
    const eight = foe(g, 8000);
    const nine = foe(g, 9000);
    foe(g, 2000);
    useEvent(g, U(37));
    expect(choice(g.game, "a").options).toContain(eight.uid);
    expect(choice(g.game).options).not.toContain(nine.uid);
    expect(choice(g.game).options).toHaveLength(2);
  });
});

describe("AOT-2-038 Hange Zoë", () => {
  it("When Played: up to one other character on the field gains 1000 BP (not itself, may choose none)", () => {
    const g = setup("main");
    energy(g.a, 1, BLUE_E);
    const mate = front(g, KINGSLAYER);
    playCard(g, U(38));
    const hange = g.a.front[1]!;
    expect(choice(g.game, "a").options).toContain(mate.uid);
    expect(choice(g.game).options).not.toContain(hange.uid); // not itself (the energy-line source card is a character too)
    pick(g, mate.uid);
    expect(bpOf(ctx, mate)).toBe(2500);
    expect(bpOf(ctx, hange)).toBe(2000);
    const second = setup("main");
    energy(second.a, 1, BLUE_E);
    const other = front(second, KINGSLAYER);
    playCard(second, U(38));
    pick(second);
    expect(bpOf(ctx, other)).toBe(1500);
  });
});

describe("AOT-2-039 Hange Zoë", () => {
  it("When Played: a character with 2500 or more BP on the opponent's front line loses 2000 BP", () => {
    const g = setup("main");
    energy(g.a, 2, BLUE_E);
    const low = foe(g, 2000);
    const edge = foe(g, 2500);
    const high = foe(g, 4000);
    const bench = foe(g, 3000, "energy");
    playCard(g, U(39));
    expect([...choice(g.game, "a").options].sort()).toEqual([edge.uid, high.uid].sort());
    expect(choice(g.game).options).not.toContain(low.uid);
    expect(choice(g.game).options).not.toContain(bench.uid);
    pick(g, high.uid);
    expect(bpOf(ctx, high)).toBe(2000);
    expect(bpOf(ctx, edge)).toBe(2500);
  });
  it("up to one: choosing none changes nothing; no character with 2500 BP means no question", () => {
    const g = setup("main");
    energy(g.a, 2, BLUE_E);
    const high = foe(g, 4000);
    playCard(g, U(39));
    pick(g);
    expect(bpOf(ctx, high)).toBe(4000);
    const none = setup("main");
    energy(none.a, 2, BLUE_E);
    foe(none, 2400);
    playCard(none, U(39));
    expect(none.game.pending).toBeNull();
  });
});

describe("AOT-2-040 Levi", () => {
  it("Activate: Main (rest, once per turn): switches an active front-line character to resting and gains Blue energy generation", () => {
    const g = setup("main");
    const levi = field(g.a, "energy", U(40));
    const mate = front(g, KINGSLAYER);
    const resting = front(g, KINGSLAYER, true);
    const bench = field(g.a, "energy", KINGSLAYER);
    refresh(g);
    expect(energyOf(ctx, g.a, "blue")).toBe(1);
    g.act("a", { type: "activate", uid: levi.uid, ability: 0 });
    // only the active front-line character is offered (not the resting one, not the energy line)
    expect(g.game.pending).toBeNull();
    expect(mate.rested).toBe(true);
    expect(resting.rested).toBe(true);
    expect(bench.rested).toBe(false);
    expect(levi.rested).toBe(true);
    expect(energyOf(ctx, g.a, "blue")).toBe(2);
    expect(() => g.act("a", { type: "activate", uid: levi.uid, ability: 0 })).toThrow();
  });
  it("with several active front-line characters the player chooses which one", () => {
    const g = setup("main");
    const levi = field(g.a, "energy", U(40));
    const one = front(g, KINGSLAYER);
    const two = front(g, KINGSLAYER);
    g.act("a", { type: "activate", uid: levi.uid, ability: 0 });
    expect([...choice(g.game, "a").options].sort()).toEqual([one.uid, two.uid].sort());
    pick(g, two.uid);
    expect(two.rested).toBe(true);
    expect(one.rested).toBe(false);
    expect(energyOf(ctx, g.a, "blue")).toBe(2);
  });
  it("with no active character on the front line nothing is switched and no energy is gained", () => {
    const g = setup("main");
    const levi = field(g.a, "energy", U(40));
    g.act("a", { type: "activate", uid: levi.uid, ability: 0 });
    expect(energyOf(ctx, g.a, "blue")).toBe(1);
  });
  it("cannot be activated while it is already resting", () => {
    const g = setup("main");
    const levi = field(g.a, "energy", U(40), true);
    front(g, KINGSLAYER);
    expect(() => g.act("a", { type: "activate", uid: levi.uid, ability: 0 })).toThrow("ABILITY_COST");
  });
});

describe("AOT-2-041 Levi", () => {
  it("has Nullify Impact", () => {
    const g = setup("main");
    expect(hasKeyword(ctx, front(g, U(41)), "冲击无效")).toBe(true);
  });
  it("When Attacking: paying 1 AP lets up to two characters gain 1500 BP each", () => {
    const g = setup("attack");
    const levi = front(g, U(41));
    const one = front(g, KINGSLAYER);
    const two = field(g.a, "energy", KINGSLAYER);
    const three = front(g, KINGSLAYER);
    attack(g, levi.uid);
    yes(g);
    expect(apRested(g)).toBe(1);
    expect(choice(g.game, "a").options).toHaveLength(4);
    pick(g, one.uid, two.uid);
    expect(bpOf(ctx, one)).toBe(3000);
    expect(bpOf(ctx, two)).toBe(3000);
    expect(bpOf(ctx, three)).toBe(1500);
    expect(bpOf(ctx, levi)).toBe(3000);
  });
  it("it can include itself, and choosing none still costs the AP that was paid", () => {
    const g = setup("attack");
    const levi = front(g, U(41));
    front(g, KINGSLAYER);
    attack(g, levi.uid);
    yes(g);
    pick(g, levi.uid);
    expect(bpOf(ctx, levi)).toBe(4500);
    const none = setup("attack");
    const other = front(none, U(41));
    front(none, KINGSLAYER);
    attack(none, other.uid);
    yes(none);
    pick(none);
    expect(apRested(none)).toBe(1);
    expect(bpOf(ctx, other)).toBe(3000);
  });
  it("declining the payment gives nothing and costs nothing", () => {
    const g = setup("attack");
    const levi = front(g, U(41));
    front(g, KINGSLAYER);
    attack(g, levi.uid);
    no(g);
    expect(apRested(g)).toBe(0);
    expect(bpOf(ctx, levi)).toBe(3000);
    expect(g.game.pending?.kind).toBe("damage");
  });
});

describe("AOT-2-042 Levi", () => {
  it("Raid <Levi>: can be performed onto a character named Levi", () => {
    const g = setup("main");
    energy(g.a, 3, BLUE_E);
    const target = front(g, U(40), true);
    raidOnto(g, U(42), target);
    expect(target.cardId).toBe(U(42));
    expect(target.rested).toBe(false);
    expect(target.under).toEqual([U(40)]);
  });
  it("When Played: draws a card, may place one hand card into the sideline, and then switches an AP card to active", () => {
    const g = setup("main");
    energy(g.a, 3, BLUE_E);
    const target = front(g, U(40));
    g.a.hand = [KINGSLAYER];
    raidOnto(g, U(42), target);
    expect(g.a.hand).toHaveLength(2); // KINGSLAYER + the drawn card
    yes(g);
    pick(g, "h:0");
    expect(g.a.sideline).toEqual([KINGSLAYER]);
    const spent = g.a.ap.find((ap) => ap.rested)!;
    expect([...choice(g.game, "a").options].sort()).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
    pick(g, `ap:${spent.id}`);
    expect(apRested(g)).toBe(0);
  });
  it("When Played: declining the sideline costs nothing and gives no AP; the draw still happens", () => {
    const g = setup("main");
    energy(g.a, 3, BLUE_E);
    const target = front(g, U(40));
    raidOnto(g, U(42), target);
    expect(g.a.hand).toHaveLength(1);
    no(g);
    expect(g.game.pending).toBeNull();
    expect(g.a.sideline).toEqual([]);
    expect(apRested(g)).toBe(1);
  });
  it("When Played: with the AP switch left unchosen, the sideline cost stays paid", () => {
    const g = setup("main");
    energy(g.a, 3, BLUE_E);
    const target = front(g, U(40));
    raidOnto(g, U(42), target);
    yes(g);
    expect(g.a.sideline).toHaveLength(1);
    pick(g);
    expect(apRested(g)).toBe(1);
  });
  it("When Attacking: pay 1 AP, then draw a card and gain 1000 BP", () => {
    const g = setup("attack");
    const levi = front(g, U(42));
    attack(g, levi.uid);
    yes(g);
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1"]);
    pick(g, "m:0");
    expect(g.a.hand).toHaveLength(1);
    expect(bpOf(ctx, levi)).toBe(5000);
    expect(impactOf(ctx, levi)).toBe(0);
    expect(apRested(g)).toBe(1);
  });
  it("When Attacking: or gain 1000 BP and Impact (1) without drawing", () => {
    const g = setup("attack");
    const levi = front(g, U(42));
    attack(g, levi.uid);
    yes(g);
    pick(g, "m:1");
    expect(g.a.hand).toHaveLength(0);
    expect(bpOf(ctx, levi)).toBe(5000);
    expect(impactOf(ctx, levi)).toBe(1);
  });
  it("When Attacking: declining the payment does nothing", () => {
    const g = setup("attack");
    const levi = front(g, U(42));
    attack(g, levi.uid);
    no(g);
    expect(bpOf(ctx, levi)).toBe(4000);
    expect(apRested(g)).toBe(0);
  });
});

describe("AOT-2-043 Sasha Braus", () => {
  it("When Played: draws a card, then places one card from the hand into the sideline", () => {
    const g = setup("main");
    energy(g.a, 1, BLUE_E);
    g.a.hand = [KINGSLAYER];
    playCard(g, U(43));
    expect(choice(g.game, "a").options).toHaveLength(2);
    pick(g, "h:0");
    expect(g.a.sideline).toEqual([KINGSLAYER]);
    expect(g.a.hand).toHaveLength(1);
    expect(g.a.library).toHaveLength(29);
  });
});

describe("AOT-2-044 Historia Reiss", () => {
  it("Activate: Main (rest): only with six or more event cards in the sideline; another [104th Cadet Corps] card gains 1000 BP", () => {
    const g = setup("main");
    const historia = front(g, U(44));
    const cadet = front(g, SASHA_BLUE);
    const cadet2 = front(g, SASHA_RED);
    const other = front(g, KINGSLAYER);
    sidelineEvents(g.a, 5);
    expect(() => g.act("a", { type: "activate", uid: historia.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    sidelineEvents(g.a, 6);
    g.act("a", { type: "activate", uid: historia.uid, ability: 0 });
    expect(historia.rested).toBe(true);
    expect([...choice(g.game, "a").options].sort()).toEqual([cadet.uid, cadet2.uid].sort()); // not herself, not Kingslayer
    pick(g, cadet2.uid);
    expect(bpOf(ctx, cadet2)).toBe(4000 + 1000);
    expect(bpOf(ctx, cadet)).toBe(3000);
    expect(bpOf(ctx, other)).toBe(1500);
  });
  it("cannot be activated while resting", () => {
    const g = setup("main");
    const historia = front(g, U(44), true);
    front(g, SASHA_BLUE);
    sidelineEvents(g.a, 6);
    expect(() => g.act("a", { type: "activate", uid: historia.uid, ability: 0 })).toThrow("ABILITY_COST");
  });
});

describe("AOT-2-045 Historia Reiss", () => {
  const start = (events: number): Game => {
    const g = setup("main");
    energy(g.a, 2, BLUE_E);
    sidelineEvents(g.a, events);
    g.a.hand = [KINGSLAYER];
    playCard(g, U(45));
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1", "m:2"]);
    return g;
  };
  it("mode 1: draw a card, then place one card from the hand into the sideline (no event condition)", () => {
    const g = start(0);
    pick(g, "m:0");
    expect(g.a.hand).toHaveLength(2);
    pick(g, "h:1");
    expect(g.a.hand).toHaveLength(1);
    expect(g.a.sideline).toHaveLength(1);
    expect(g.a.library).toHaveLength(29);
  });
  it("mode 2: draws a card with two or more event cards in the sideline, nothing with one", () => {
    const enough = start(2);
    pick(enough, "m:1");
    expect(enough.a.hand).toHaveLength(2);
    expect(enough.game.pending).toBeNull();
    const few = start(1);
    pick(few, "m:1");
    expect(few.a.hand).toHaveLength(1);
  });
  it("mode 3: with six or more event cards draw two, then place one card into the sideline; with five nothing happens", () => {
    const enough = start(6);
    pick(enough, "m:2");
    expect(enough.a.hand).toHaveLength(3);
    pick(enough, "h:0");
    expect(enough.a.hand).toHaveLength(2);
    expect(enough.a.sideline).toHaveLength(7);
    const few = start(5);
    pick(few, "m:2");
    expect(few.a.hand).toHaveLength(1);
    expect(few.game.pending).toBeNull();
  });
});

describe("AOT-2-046 Mikasa Ackermann", () => {
  it("gains 1000 BP with two or more event cards in the sideline and Nullify Impact with four or more", () => {
    const g = setup("main");
    const mikasa = front(g, U(46));
    refresh(g);
    expect(bpOf(ctx, mikasa)).toBe(2000);
    expect(hasKeyword(ctx, mikasa, "冲击无效")).toBe(false);
    sidelineEvents(g.a, 1);
    refresh(g);
    expect(bpOf(ctx, mikasa)).toBe(2000);
    sidelineEvents(g.a, 2);
    refresh(g);
    expect(bpOf(ctx, mikasa)).toBe(3000);
    expect(hasKeyword(ctx, mikasa, "冲击无效")).toBe(false);
    sidelineEvents(g.a, 3);
    refresh(g);
    expect(hasKeyword(ctx, mikasa, "冲击无效")).toBe(false);
    sidelineEvents(g.a, 4);
    refresh(g);
    expect(bpOf(ctx, mikasa)).toBe(3000);
    expect(hasKeyword(ctx, mikasa, "冲击无效")).toBe(true);
  });
  it("only event cards count, not other cards in the sideline", () => {
    const g = setup("main");
    const mikasa = front(g, U(46));
    g.a.sideline = [KINGSLAYER, KINGSLAYER, EVENT];
    refresh(g);
    expect(bpOf(ctx, mikasa)).toBe(2000);
  });
});

describe("AOT-2-047 Armin Arlelt", () => {
  it("When Played: up to one event card among the top two goes to the sideline, the other goes back on top", () => {
    const g = setup("main");
    energy(g.a, 1, BLUE_E);
    library(g.a, [PIECK0, EVENT, ZEKE0]);
    playCard(g, U(47));
    expect(choice(g.game, "a").options).toEqual(["l:1"]); // only the event is offered; the third card is not looked at
    pick(g, "l:1");
    expect(g.game.pending).toBeNull(); // one card left: no order to choose
    expect(g.a.sideline).toEqual([EVENT]);
    expect(g.a.library.slice(0, 2)).toEqual([PIECK0, ZEKE0]);
    expect(g.a.library).toHaveLength(29);
  });
  it("without taking an event, both cards go back on top in the order chosen", () => {
    const g = setup("main");
    energy(g.a, 1, BLUE_E);
    library(g.a, [PIECK0, ZEKE0, EREN0]);
    playCard(g, U(47));
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1"]); // the order of the two
    pick(g, "l:1", "l:0");
    expect(g.a.library.slice(0, 3)).toEqual([ZEKE0, PIECK0, EREN0]);
    expect(g.a.sideline).toEqual([]);
    expect(g.a.library).toHaveLength(30);
  });
  it("two events: only one of them can be placed in the sideline (up to one, or none)", () => {
    const g = setup("main");
    energy(g.a, 1, BLUE_E);
    library(g.a, [EVENT, SEAFOOD, ZEKE0]);
    playCard(g, U(47));
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1"]);
    expect(choice(g.game).max).toBe(1);
    pick(g, "l:0");
    expect(g.a.sideline).toEqual([EVENT]);
    expect(g.a.library.slice(0, 2)).toEqual([SEAFOOD, ZEKE0]);
    const none = setup("main");
    energy(none.a, 1, BLUE_E);
    library(none.a, [EVENT, SEAFOOD, ZEKE0]);
    playCard(none, U(47));
    pick(none);
    pick(none, "l:0", "l:1");
    expect(none.a.sideline).toEqual([]);
    expect(none.a.library.slice(0, 3)).toEqual([EVENT, SEAFOOD, ZEKE0]);
  });
});

describe("AOT-2-048 Sweet Candy", () => {
  it("looks at the top four, adds a character card, the rest go to the bottom, then plays a small blue 1-AP character from the hand resting", () => {
    const g = setup("main");
    library(g.a, [U(38), EVENT, PIECK0, EREN0]);
    useEvent(g, U(48));
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:2", "l:3"]); // character cards only
    pick(g, "l:0");
    const rest = [...choice(g.game, "a").options];
    expect(rest).toHaveLength(3);
    pick(g, rest[2]!, rest[0]!, rest[1]!);
    // the remaining cards are l:0 EVENT, l:1 PIECK0, l:2 EREN0; the chosen order puts l:2 first, then l:0, then l:1
    expect(rest).toEqual(["l:0", "l:1", "l:2"]);
    expect(g.a.library.slice(-3)).toEqual([EREN0, EVENT, PIECK0]);
    expect(g.a.library).toHaveLength(29);
  });
  it("the added card can be the one played; a non-blue or too expensive card is not offered; the Hange's own When Played still happens", () => {
    const g = setup("main");
    library(g.a, [U(38), EVENT, PIECK0, EREN0]);
    g.a.hand = [U(39), PIECK0]; // blue but cost 4; green
    front(g, KINGSLAYER);
    useEvent(g, U(48));
    pick(g, "l:0");
    pick(g, ...choice(g.game, "a").options);
    expect(choice(g.game, "a").options).toEqual(["h:2"]); // Hange Zoë (cost 1, AP 1, blue) just added
    pick(g, "h:2");
    expect(choice(g.game, "a").options).toEqual(["line:front", "line:energy"]);
    pick(g, "line:energy");
    const played = g.a.energy[g.a.energy.length - 1]!;
    expect(played.cardId).toBe(U(38));
    expect(played.rested).toBe(true);
    // Hange's When Played: up to one other character gains 1000 BP
    expect(choice(g.game, "a").options.length).toBeGreaterThan(0);
    pick(g);
    expect(g.a.hand).toEqual([U(39), PIECK0]);
  });
  it("up to one: choosing no character and playing nothing is allowed", () => {
    const g = setup("main");
    library(g.a, [U(38), EVENT, PIECK0, EREN0]);
    useEvent(g, U(48));
    pick(g);
    pick(g, ...choice(g.game, "a").options);
    expect(g.a.hand).toEqual([]);
    expect(g.game.pending).toBeNull();
    expect(g.a.library).toHaveLength(30);
  });
  it("a blue character with required energy 3 (cost 3) is offered, one with cost 4 is not", () => {
    const g = setup("main");
    library(g.a, [PIECK0, KINGSLAYER, KINGSLAYER, KINGSLAYER]);
    g.a.hand = [U(41), U(39), U(50)]; // Levi (blue, 3), Hange (blue, 4), Gabi (green, 3)
    useEvent(g, U(48));
    pick(g);
    pick(g, ...choice(g.game, "a").options);
    expect(choice(g.game, "a").options).toEqual(["h:0"]);
  });
});

describe("AOT-2-049 Thunder Spears", () => {
  it("sidelines one opponent front-line character with 2500 or less BP or 4500 or more BP", () => {
    const g = setup("main");
    const low = foe(g, 2500);
    const mid = foe(g, 3000);
    const mid2 = foe(g, 4400);
    const high = foe(g, 4500);
    const bench = foe(g, 1000, "energy");
    useEvent(g, U(49));
    expect([...choice(g.game, "a").options].sort()).toEqual([low.uid, high.uid].sort());
    expect(choice(g.game).options).not.toContain(mid.uid);
    expect(choice(g.game).options).not.toContain(mid2.uid);
    expect(choice(g.game).options).not.toContain(bench.uid);
    pick(g, high.uid);
    expect(g.b.front.map((card) => card.uid)).toEqual([low.uid, mid.uid, mid2.uid]);
    expect(g.b.sideline).toHaveLength(1);
    expect(apRested(g)).toBe(1);
  });
  it("with only mid-BP characters nothing can be chosen", () => {
    const g = setup("main");
    const mid = foe(g, 3500);
    useEvent(g, U(49));
    expect(g.game.pending).toBeNull();
    expect(g.b.front).toEqual([mid]);
  });
});

describe("AOT-2-050 Gabi Braun", () => {
  it("When Attacking: another [Marleyan Warrior] card gains 1000 BP", () => {
    const g = setup("attack");
    const gabi = front(g, U(50));
    const pieck = front(g, PIECK0);
    const stranger = front(g, KINGSLAYER);
    attack(g, gabi.uid);
    expect(choice(g.game, "a").options).toEqual([pieck.uid]); // not herself, not the non-[Marleyan Warrior]
    pick(g, pieck.uid);
    expect(bpOf(ctx, pieck)).toBe(2500);
    expect(bpOf(ctx, gabi)).toBe(2000);
    expect(bpOf(ctx, stranger)).toBe(1500);
  });
  it("When Attacking: if the chosen character is Raided, it and Gabi gain 2000 BP instead", () => {
    const g = setup("attack");
    const gabi = front(g, U(50));
    const porco = front(g, PORCO0);
    porco.under = [PIECK0]; // Raided
    const pieck = front(g, PIECK0);
    attack(g, gabi.uid);
    expect(choice(g.game, "a").options).toHaveLength(2);
    pick(g, porco.uid);
    expect(bpOf(ctx, porco)).toBe(4000);
    expect(bpOf(ctx, gabi)).toBe(4000);
    expect(bpOf(ctx, pieck)).toBe(1500);
  });
  it("up to one: choosing none changes nothing", () => {
    const g = setup("attack");
    const gabi = front(g, U(50));
    const pieck = front(g, PIECK0);
    attack(g, gabi.uid);
    pick(g);
    expect(bpOf(ctx, pieck)).toBe(1500);
    expect(bpOf(ctx, gabi)).toBe(2000);
  });
});

describe("AOT-2-051 Falco Grice", () => {
  it("When Played, on the energy line: switches itself to active", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    playCard(g, U(51), "energy");
    expect(g.a.energy[g.a.energy.length - 1]!.rested).toBe(false);
  });
  it("When Played, on the front line: stays resting", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    playCard(g, U(51), "front");
    expect(g.a.front[0]!.rested).toBe(true);
  });
  it("Activate: Main (rest, place 1 hand card into the sideline): another [Marleyan Warrior] gains 1000 BP", () => {
    const g = setup("main");
    const falco = front(g, U(51));
    const pieck = front(g, PIECK0);
    front(g, KINGSLAYER);
    g.a.hand = [KINGSLAYER];
    g.act("a", { type: "activate", uid: falco.uid, ability: 1 });
    expect(falco.rested).toBe(true);
    expect(g.a.sideline).toEqual([KINGSLAYER]); // the only hand card is the cost
    expect(g.a.hand).toEqual([]);
    expect(g.game.pending).toBeNull(); // Pieck Finger is the only other [Marleyan Warrior]
    expect(bpOf(ctx, pieck)).toBe(2500);
  });
  it("Activate: Main: a Raided [Marleyan Warrior] gains 2000 BP instead", () => {
    const g = setup("main");
    const falco = front(g, U(51));
    const porco = front(g, PORCO0);
    porco.under = [PIECK0];
    front(g, PIECK0);
    g.a.hand = [KINGSLAYER, KINGSLAYER];
    g.act("a", { type: "activate", uid: falco.uid, ability: 1 });
    pick(g, "h:1");
    expect(choice(g.game, "a").options).toHaveLength(2);
    pick(g, porco.uid);
    expect(bpOf(ctx, porco)).toBe(4000);
  });
  it("Activate: Main needs a card in the hand to pay and is not usable while resting", () => {
    const g = setup("main");
    const falco = front(g, U(51));
    front(g, PIECK0);
    expect(() => g.act("a", { type: "activate", uid: falco.uid, ability: 1 })).toThrow("ABILITY_COST");
    const resting = setup("main");
    const tired = front(resting, U(51), true);
    resting.a.hand = [KINGSLAYER];
    expect(() => resting.act("a", { type: "activate", uid: tired.uid, ability: 1 })).toThrow("ABILITY_COST");
  });
});

describe("AOT-2-052 Zeke Jaeger", () => {
  it("When Played: takes up to one [Pure Titan] card from the top five, the rest go to the bottom in order", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    library(g.a, [KINGSLAYER, PURE_TITAN, PIECK0, PURE_TITAN_B, EREN0]);
    playCard(g, U(52));
    expect(choice(g.game, "a").options).toEqual(["l:1", "l:3"]); // [Pure Titan] cards only
    pick(g, "l:3");
    expect(g.a.hand).toEqual([PURE_TITAN_B]);
    const rest = [...choice(g.game, "a").options];
    expect(rest).toHaveLength(4);
    pick(g, rest[3]!, rest[2]!, rest[1]!, rest[0]!);
    expect(g.a.library.slice(-4)).toEqual([EREN0, PIECK0, PURE_TITAN, KINGSLAYER]);
    expect(g.a.library).toHaveLength(29);
  });
  it("When Played: up to one - taking none is allowed; no [Pure Titan] means only the order is asked", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    library(g.a, [KINGSLAYER, PURE_TITAN, PIECK0, PURE_TITAN_B, EREN0]);
    playCard(g, U(52));
    pick(g);
    pick(g, ...choice(g.game, "a").options);
    expect(g.a.hand).toEqual([]);
    const none = setup("main");
    energy(none.a, 2, GREEN_E);
    library(none.a, [KINGSLAYER, PIECK0, ZEKE0, EREN0, KINGSLAYER]);
    playCard(none, U(52));
    expect(choice(none.game, "a").options).toHaveLength(5); // the order of the five
  });
});

describe("AOT-2-053 Zeke Jaeger (Beast Titan)", () => {
  const raid = (g: Game): void => {
    energy(g.a, 3, GREEN_E);
    raidOnto(g, U(53), front(g, ZEKE0, true));
  };
  it("Raid <Zeke Jaeger>: can only be performed onto a character named Zeke Jaeger", () => {
    const g = setup("main");
    energy(g.a, 3, GREEN_E);
    g.a.hand.push(U(53));
    expect(() => g.act("a", { type: "raid", handIndex: 0, targetUid: front(g, KINGSLAYER).uid })).toThrow("RAID_TARGET_INVALID");
    const target = front(g, ZEKE0, true);
    g.act("a", { type: "raid", handIndex: 0, targetUid: target.uid });
    expect(target.cardId).toBe(U(53));
  });
  it("When Played: sidelines a character with 3000 or less BP on the opponent's front line, then may pay 1 AP to play a [Pure Titan] from the sideline resting", () => {
    const g = setup("main");
    const small = foe(g, 3000);
    const big = foe(g, 3001);
    const bench = foe(g, 1000, "energy");
    g.a.sideline = [KINGSLAYER, PURE_TITAN, PIECK0, PURE_TITAN_B];
    raid(g);
    expect([...choice(g.game, "a").options]).toEqual([small.uid]);
    expect(choice(g.game).options).not.toContain(big.uid);
    expect(choice(g.game).options).not.toContain(bench.uid);
    pick(g, small.uid);
    expect(g.b.sideline).toEqual([KINGSLAYER]);
    yes(g);
    expect(apRested(g)).toBe(2); // the Raid and the effect
    expect(choice(g.game, "a").options).toEqual(["s:1", "s:3"]);
    pick(g, "s:3");
    pick(g, "line:front");
    const played = g.a.front[g.a.front.length - 1]!;
    expect(played.cardId).toBe(PURE_TITAN_B);
    expect(played.rested).toBe(true);
    expect(g.a.sideline).toEqual([KINGSLAYER, PURE_TITAN, PIECK0]);
  });
  it("When Played: declining the AP payment, or choosing no [Pure Titan], plays nothing", () => {
    const g = setup("main");
    const small = foe(g, 2000);
    g.a.sideline = [PURE_TITAN];
    raid(g);
    pick(g, small.uid);
    no(g);
    expect(apRested(g)).toBe(1);
    expect(g.a.sideline).toEqual([PURE_TITAN]);
    const second = setup("main");
    const target = foe(second, 2000);
    second.a.sideline = [PURE_TITAN];
    raid(second);
    pick(second, target.uid);
    yes(second);
    pick(second);
    expect(second.a.sideline).toEqual([PURE_TITAN]);
    expect(second.a.front).toHaveLength(1);
  });
  it("When Played: with no character sidelined there is no AP payment offered (up to one: none chosen)", () => {
    const g = setup("main");
    foe(g, 2000);
    g.a.sideline = [PURE_TITAN];
    raid(g);
    pick(g);
    expect(g.game.pending).toBeNull();
    expect(g.b.sideline).toEqual([]);
    expect(apRested(g)).toBe(1);
  });
});

describe("AOT-2-055 Pieck Finger", () => {
  it("When Played: another [Marleyan Warrior] gains 1000 BP", () => {
    const g = setup("main");
    energy(g.a, 1, GREEN_E);
    const porco = front(g, PORCO0);
    front(g, KINGSLAYER);
    playCard(g, U(55));
    const options = choice(g.game, "a").options;
    expect(options).toContain(porco.uid);
    expect(options).not.toContain(g.a.front[g.a.front.length - 1]!.uid); // not itself
    expect(options).toHaveLength(2); // Porco Galliard and the energy-line source card (a [Marleyan Warrior] too); not Kingslayer
    pick(g, porco.uid);
    expect(bpOf(ctx, porco)).toBe(3000);
  });
  it("When Played: a Raided [Marleyan Warrior] gains 2000 BP instead; none chosen changes nothing", () => {
    const g = setup("main");
    energy(g.a, 1, GREEN_E);
    const porco = front(g, PORCO0);
    porco.under = [PIECK0];
    playCard(g, U(55));
    pick(g, porco.uid);
    expect(bpOf(ctx, porco)).toBe(4000);
    const none = setup("main");
    energy(none.a, 1, GREEN_E);
    const other = front(none, PORCO0);
    playCard(none, U(55));
    pick(none);
    expect(bpOf(ctx, other)).toBe(2000);
  });
});

describe("AOT-2-056 Pieck Finger (Cart Titan)", () => {
  it("If on the Front Line: gains Impact (1) while it was played this turn", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    const pieck = front(g, PIECK0, true);
    raidOnto(g, U(56), pieck);
    no(g);
    refresh(g);
    expect(impactOf(ctx, pieck)).toBe(1);
    // a Cart Titan that was not played this turn has none
    const old = front(g, U(56));
    refresh(g);
    expect(impactOf(ctx, old)).toBe(0);
  });
  it("on the energy line it has no Impact even when played this turn", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    const pieck = field(g.a, "energy", PIECK0, true);
    raidOnto(g, U(56), pieck);
    no(g);
    refresh(g);
    expect(impactOf(ctx, pieck)).toBe(0);
  });
  it("When Played: may reduce its BP by 2000; then it can attack from the energy line with Snipe", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    const pieck = field(g.a, "energy", PIECK0, true);
    const foeFront = foe(g, 2000);
    foe(g, 1500);
    raidOnto(g, U(56), pieck);
    yes(g);
    expect(bpOf(ctx, pieck)).toBe(2000);
    expect(hasKeyword(ctx, pieck, "瞄准攻击")).toBe(true);
    expect(g.a.energy).toContain(pieck);
    g.act("a", { type: "next_phase" });
    attack(g, pieck.uid, foeFront.uid);
    expect(pieck.rested).toBe(true);
    expect(g.game.log.some((line) => line.includes("瞄准攻击"))).toBe(true);
    expect(g.game.pending?.kind).not.toBe("block"); // Snipe: the opponent cannot block
  });
  it("declining the BP reduction keeps the BP and gives no energy-line attack and no Snipe", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    const pieck = field(g.a, "energy", PIECK0, true);
    raidOnto(g, U(56), pieck);
    no(g);
    expect(bpOf(ctx, pieck)).toBe(4000);
    expect(hasKeyword(ctx, pieck, "瞄准攻击")).toBe(false);
    g.act("a", { type: "next_phase" });
    expect(() => attack(g, pieck.uid)).toThrow("INVALID_ATTACKER");
  });
  it("a character on the energy line cannot attack without the mark", () => {
    const g = setup("attack");
    const energyChar = field(g.a, "energy", KINGSLAYER);
    expect(() => attack(g, energyChar.uid)).toThrow("INVALID_ATTACKER");
    expect(legalActions(g.game, g.players, ctx, "a").some((action) => action.type === "attack" && action.attackerUid === energyChar.uid)).toBe(false);
  });
  it("the computer players may use the attack from the energy line too (only while the mark lasts)", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    const pieck = field(g.a, "energy", PIECK0, true);
    raidOnto(g, U(56), pieck);
    yes(g);
    g.act("a", { type: "next_phase" });
    expect(legalActions(g.game, g.players, ctx, "a").filter((action) => action.type === "attack" && action.attackerUid === pieck.uid).length).toBeGreaterThan(0);
  });
  it("When Sidelined: returns up to one base card of this Raided character to the hand", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    const pieck = front(g, PIECK0, true);
    raidOnto(g, U(56), pieck);
    no(g);
    g.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: pieck.uid, act: "sideline" } });
    expect(g.a.sideline).toEqual([PIECK0, U(56)]);
    expect(choice(g.game, "a").options).toEqual(["s:0"]);
    pick(g, "s:0");
    expect(g.a.hand).toEqual([PIECK0]);
    expect(g.a.sideline).toEqual([U(56)]);
  });
  it("When Sidelined: choosing none leaves it in the sideline; a Cart Titan that was never Raided has no base card", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    const pieck = front(g, PIECK0, true);
    raidOnto(g, U(56), pieck);
    no(g);
    g.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: pieck.uid, act: "sideline" } });
    pick(g);
    expect(g.a.hand).toEqual([]);
    const plain = setup("main");
    const lone = front(plain, U(56));
    plain.a.sideline = [PIECK0];
    plain.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: lone.uid, act: "sideline" } });
    expect(plain.game.pending).toBeNull();
  });
});

describe("AOT-2-058 Porco Galliard (Jaw Titan)", () => {
  it("Raid <Porco Galliard>; When Played: takes up to one [Marleyan Warrior] card from the top four, the rest go to the bottom in order", () => {
    const g = setup("main");
    energy(g.a, 2, GREEN_E);
    library(g.a, [KINGSLAYER, PIECK0, ZEKE0, PORCO0]);
    raidOnto(g, U(58), front(g, PORCO0, true));
    expect(choice(g.game, "a").options).toEqual(["l:1", "l:3"]); // Zeke 023 is not [Marleyan Warrior]
    pick(g, "l:1");
    expect(g.a.hand).toEqual([PIECK0]);
    pick(g, ...choice(g.game, "a").options);
    expect(g.a.library).toHaveLength(29);
    expect(g.a.library.slice(-3)).toEqual([KINGSLAYER, ZEKE0, PORCO0]);
  });
  it("When Attacking: draws a card with 6000 or more BP, nothing below", () => {
    const strong = setup("attack");
    const jaw = front(strong, U(58));
    setBp(jaw, 6000);
    attack(strong, jaw.uid);
    expect(strong.a.hand).toHaveLength(1);
    const weak = setup("attack");
    const jaw2 = front(weak, U(58));
    setBp(jaw2, 5999);
    attack(weak, jaw2.uid);
    expect(weak.a.hand).toHaveLength(0);
  });
});

describe("AOT-2-059 Reiner, Bertholdt, & Annie", () => {
  it("is also treated as <Reiner Braun>, <Bertholdt Hoover> and <Annie Leonhart>: those Raid cards can be performed onto it", () => {
    const g = setup("main");
    const trio = front(g, U(59));
    refresh(g);
    expect(raidTargetMatches(ctx, ctx.card(U(60))!, trio)).toBe(true); // Reiner Braun (Armored Titan): Raid <Reiner Braun>
    expect(raidTargetMatches(ctx, ctx.card(BT(53))!, trio)).toBe(true); // Annie Leonhart (Female Titan): Raid <Annie Leonhart>
    expect(raidTargetMatches(ctx, ctx.card(BT(57))!, trio)).toBe(true); // Bertholdt Hoover (Colossal Titan): Raid <Bertholdt Hoover>
    expect(raidTargetMatches(ctx, ctx.card(U(58))!, trio)).toBe(false); // Raid <Porco Galliard>
  });
  it("the Raid really happens onto it", () => {
    const g = setup("main");
    energy(g.a, 3, GREEN_E);
    const trio = front(g, U(59), true);
    refresh(g);
    raidOnto(g, U(60), trio);
    expect(trio.cardId).toBe(U(60));
    expect(trio.under).toEqual([U(59)]);
  });
  it("without the card on the field the name marks do not exist", () => {
    const g = setup("main");
    const plain = front(g, PIECK0);
    refresh(g);
    expect(raidTargetMatches(ctx, ctx.card(U(60))!, plain)).toBe(false);
  });
});

describe("AOT-2-060 Reiner Braun (Armored Titan)", () => {
  it("has Nullify Impact", () => {
    const g = setup("main");
    const reiner = front(g, U(60));
    refresh(g);
    expect(hasKeyword(ctx, reiner, "冲击无效")).toBe(true);
  });
  it("When Played: may place one hand card into the sideline to gain 2000 BP this turn", () => {
    const g = setup("main");
    energy(g.a, 3, GREEN_E);
    g.a.hand = [KINGSLAYER];
    const target = front(g, REINER0, true);
    raidOnto(g, U(60), target);
    yes(g);
    expect(g.a.sideline).toEqual([KINGSLAYER]); // the only hand card: no choice
    expect(bpOf(ctx, target)).toBe(6000);
  });
  it("When Played: declining gives nothing; with an empty hand there is no question", () => {
    const g = setup("main");
    energy(g.a, 3, GREEN_E);
    g.a.hand = [KINGSLAYER];
    const target = front(g, REINER0, true);
    raidOnto(g, U(60), target);
    no(g);
    expect(g.a.hand).toEqual([KINGSLAYER]);
    expect(bpOf(ctx, target)).toBe(4000);
    const empty = setup("main");
    energy(empty.a, 3, GREEN_E);
    raidOnto(empty, U(60), front(empty, REINER0, true));
    expect(empty.game.pending).toBeNull();
  });
  it("When Attacking: with 6000 or more BP draws a card and gains Impact (1)", () => {
    const g = setup("main");
    energy(g.a, 3, GREEN_E);
    g.a.hand = [KINGSLAYER];
    const target = front(g, REINER0, true);
    raidOnto(g, U(60), target);
    yes(g); // BP 6000
    g.act("a", { type: "next_phase" });
    attack(g, target.uid);
    expect(g.a.hand).toHaveLength(1);
    expect(impactOf(ctx, target)).toBe(1);
  });
  it("When Attacking: with less than 6000 BP nothing happens", () => {
    const g = setup("attack");
    const reiner = front(g, U(60));
    attack(g, reiner.uid);
    expect(g.a.hand).toHaveLength(0);
    expect(impactOf(ctx, reiner)).toBe(0);
  });
});

describe("AOT-2-061 Sneak Attack", () => {
  it("sidelines your own Pieck Finger, which raises the limit to 5000, and then returns a Pieck Finger from the sideline to the hand", () => {
    const g = setup("main");
    const pieck = front(g, U(55));
    front(g, KINGSLAYER);
    const three = foe(g, 3000);
    const five = foe(g, 5000);
    const six = foe(g, 6000);
    useEvent(g, U(61));
    expect(choice(g.game, "a").options).toEqual([pieck.uid]);
    pick(g, pieck.uid);
    expect([...choice(g.game, "a").options].sort()).toEqual([three.uid, five.uid].sort());
    expect(choice(g.game).options).not.toContain(six.uid);
    pick(g, five.uid);
    expect(g.b.sideline).toEqual([KINGSLAYER]);
    expect(choice(g.game, "a").options).toEqual(["s:0"]);
    pick(g, "s:0");
    expect(g.a.hand).toEqual([U(55)]);
    expect(g.a.front).toHaveLength(1);
    expect(g.a.sideline).toEqual([U(61)]);
  });
  it("without sidelining your own: the limit is 3000 and nothing is returned", () => {
    const g = setup("main");
    const pieck = front(g, U(55));
    const three = foe(g, 3000);
    foe(g, 3001);
    useEvent(g, U(61));
    pick(g); // sideline none of your own
    expect(choice(g.game, "a").options).toEqual([three.uid]);
    pick(g, three.uid);
    expect(g.game.pending).toBeNull();
    expect(g.a.front).toEqual([pieck]);
    expect(g.a.hand).toEqual([]);
  });
  it("a Pieck Finger already in the sideline raises the limit to 5000, but nothing returns when none of yours was sidelined with it", () => {
    const g = setup("main");
    g.a.sideline = [PIECK0];
    const five = foe(g, 5000);
    foe(g, 5001);
    useEvent(g, U(61));
    expect(choice(g.game, "a").options).toEqual([five.uid]);
    pick(g, five.uid);
    expect(g.a.hand).toEqual([]);
    expect(g.a.sideline).toEqual([PIECK0, U(61)]);
  });
  it("only characters with Pieck Finger in the name can be sidelined from your field", () => {
    const g = setup("main");
    const pieck = front(g, PIECK0);
    const cart = front(g, U(56));
    front(g, PORCO0);
    useEvent(g, U(61));
    expect([...choice(g.game, "a").options].sort()).toEqual([pieck.uid, cart.uid].sort());
  });
  it("up to one: with no opposing target the own character is still sidelined and returned", () => {
    const g = setup("main");
    const pieck = front(g, PIECK0);
    useEvent(g, U(61));
    pick(g, pieck.uid);
    pick(g, "s:0");
    expect(g.a.hand).toEqual([PIECK0]);
  });
});

describe("AOT-2-062 Nicolo", () => {
  it("When Played: the next [Food] affinity card you use this turn costs 1 less AP", () => {
    const g = setup("main");
    energy(g.a, 2, RED_E);
    expect(costOf(g.game, g.players, ctx, "a", SEAFOOD).ap).toBe(1);
    playCard(g, U(62));
    expect(costOf(g.game, g.players, ctx, "a", SEAFOOD).ap).toBe(0);
    useEvent(g, SEAFOOD);
    expect(apRested(g)).toBe(1); // only Nicolo cost AP
    expect(costOf(g.game, g.players, ctx, "a", SEAFOOD).ap).toBe(1); // used up
  });
  it("a card without [Food] does not use the reduction up and is not cheaper", () => {
    const g = setup("main");
    energy(g.a, 2, RED_E);
    playCard(g, U(62));
    expect(costOf(g.game, g.players, ctx, "a", EVENT).ap).toBe(1);
    expect(costOf(g.game, g.players, ctx, "a", KINGSLAYER).ap).toBe(1);
    useEvent(g, EVENT);
    expect(apRested(g)).toBe(2);
    expect(costOf(g.game, g.players, ctx, "a", SEAFOOD).ap).toBe(0);
  });
  it("two Nicolo reduce the next two [Food] cards, one each", () => {
    const g = setup("main");
    energy(g.a, 4, RED_E);
    playCard(g, U(62));
    playCard(g, U(62));
    expect(apRested(g)).toBe(2);
    useEvent(g, SEAFOOD);
    expect(costOf(g.game, g.players, ctx, "a", SEAFOOD).ap).toBe(0);
  });
});

describe("AOT-2-064 Jean Kirschtein", () => {
  it("When Attacking: looks at the top three cards and puts them back on top in any order", () => {
    const g = setup("attack");
    library(g.a, [PIECK0, ZEKE0, EREN0, REINER0]);
    const jean = front(g, U(64));
    attack(g, jean.uid);
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1", "l:2"]);
    pick(g, "l:2", "l:0", "l:1");
    expect(g.a.library.slice(0, 4)).toEqual([EREN0, PIECK0, ZEKE0, REINER0]);
    expect(g.a.library).toHaveLength(30);
    expect(g.a.hand).toEqual([]);
  });
});

describe("AOT-2-065 Sasha Braus", () => {
  /** Uses Seafood (a [Food] event): mode 3 (three characters), choosing none. */
  const eatFood = (g: Game): void => { useEvent(g, SEAFOOD); pick(g, "m:2"); pick(g); };
  it("When Played: with a [Food] card used this turn it switches to active", () => {
    const g = setup("main");
    energy(g.a, 2, RED_E);
    eatFood(g);
    playCard(g, SASHA_RED);
    expect(g.a.front[0]!.rested).toBe(false);
  });
  it("without a [Food] card used this turn it stays resting", () => {
    const g = setup("main");
    energy(g.a, 2, RED_E);
    playCard(g, SASHA_RED);
    expect(g.a.front[0]!.rested).toBe(true);
  });
  it("only one <Sasha Braus> ability activates per turn: the second Sasha stays resting", () => {
    const g = setup("main");
    energy(g.a, 2, RED_E);
    eatFood(g);
    playCard(g, SASHA_RED);
    playCard(g, SASHA_RED);
    expect(g.a.front.map((card) => card.rested)).toEqual([false, true]);
  });
  it("the opponent's [Food] card does not count", () => {
    const g = setup("main");
    energy(g.a, 2, RED_E);
    g.b.sideline = [SEAFOOD];
    playCard(g, SASHA_RED);
    expect(g.a.front[0]!.rested).toBe(true);
  });
});

describe("AOT-2-066 Mikasa Ackermann", () => {
  /** An attack phase in which a red [104th Cadet Corps] card (Mikasa, ST-085) returned from the field to the hand; ends the turn. */
  function endAfterReturn(returned: string | null, copies = 1): Game {
    const g = setup("attack");
    g.a.hand = Array(copies).fill(U(66));
    if (returned) {
      const card = front(g, returned);
      g.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: card.uid, act: "hand" } });
    }
    g.act("a", { type: "end_turn" });
    return g;
  }
  it("at the start of your end phase: after a red [104th Cadet Corps] card returned to the hand in the attack phase, it may be played resting onto the front line", () => {
    const g = endAfterReturn(MIKASA_RED);
    expect(g.game.phase).toBe("end");
    yes(g);
    expect(g.a.front.map((card) => card.cardId)).toEqual([U(66)]);
    expect(g.a.hand).toEqual([MIKASA_RED]);
    expect(g.game.log.some((line) => line.includes("以休息状态登场到前线"))).toBe(true);
  });
  it("declining keeps it in the hand", () => {
    const g = endAfterReturn(MIKASA_RED);
    no(g);
    expect(g.a.front).toEqual([]);
    expect(g.a.hand).toEqual([U(66), MIKASA_RED]);
  });
  it("nothing happens when no card returned, or the returned card is not red or not [104th Cadet Corps]", () => {
    const none = endAfterReturn(null);
    expect(none.game.pending).toBeNull();
    expect(none.a.hand).toEqual([U(66)]);
    const yellow = endAfterReturn(KINGSLAYER); // yellow, not a cadet
    expect(yellow.game.pending).toBeNull();
    const blueCadet = endAfterReturn(SASHA_BLUE); // blue [104th Cadet Corps]
    expect(blueCadet.game.pending).toBeNull();
    const redCadet = endAfterReturn(U(64)); // Jean Kirschtein: red [104th Cadet Corps]
    expect(redCadet.game.pending?.kind).toBe("choose");
  });
  it("works with the intended source: a card played by Omni-Directional Mobility Gear returns at the end of the attack phase", () => {
    const g = setup("main");
    g.a.hand = [U(66), MIKASA_RED];
    useEvent(g, BT(99)); // draws two, plays up to two red 104th Cadet Corps cards (cost <= 3, AP 1) active; they return at the end of the attack phase
    expect(choice(g.game, "a").options).toContain("h:1");
    pick(g, "h:1");
    if (g.game.pending) pick(g); // the second card: none
    expect(g.a.front.map((card) => card.cardId)).toEqual([MIKASA_RED]);
    g.act("a", { type: "end_turn" });
    expect(g.a.front).toEqual([]);
    expect(g.game.phase).toBe("end");
    yes(g);
    expect(g.a.front.map((card) => card.cardId)).toEqual([U(66)]);
  });
  it("a return in the main phase does not count", () => {
    const g = setup("main");
    g.a.hand = [U(66)];
    const card = front(g, MIKASA_RED);
    g.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: card.uid, act: "hand" } });
    g.act("a", { type: "end_turn" }); // ends the main phase; the attack phase passes with no attack, then the end phase
    expect(g.game.pending).toBeNull();
    expect(g.game.turnPlayerId).toBe("b");
    expect(g.a.front).toEqual([]);
  });
  it("once per turn: with two copies in the hand only one is offered", () => {
    const g = endAfterReturn(MIKASA_RED, 2);
    expect(choice(g.game, "a").options).toHaveLength(2); // which copy's ability resolves first
    pick(g, choice(g.game).options[0]!);
    yes(g);
    pick(g, "h:0"); // either copy
    expect(g.game.pending).toBeNull(); // the second ability finds the once-per-turn mark and does nothing
    expect(g.a.front).toHaveLength(1);
    expect(g.a.hand.filter((cardId) => cardId === U(66))).toHaveLength(1);
  });
});

describe("AOT-2-067 Mikasa Ackermann", () => {
  it("can only be played by an ability or by performing Raid with it: a normal play is refused and the computer players never try it", () => {
    const g = setup("main");
    energy(g.a, 2, RED_E);
    g.a.hand = [U(67)];
    expect(() => g.act("a", { type: "play", handIndex: 0, line: "front" })).toThrow("PLAY_ONLY_BY_ABILITY");
    expect(() => g.act("a", { type: "play", handIndex: 0, line: "energy" })).toThrow("PLAY_ONLY_BY_ABILITY");
    expect(legalActions(g.game, g.players, ctx, "a").filter((action) => action.type === "play")).toEqual([]);
    expect(legalActions(g.game, g.players, ctx, "a").filter((action) => action.type === "raid")).toEqual([]); // no Mikasa on the field yet
    const target = front(g, U(66), true);
    expect(legalActions(g.game, g.players, ctx, "a").some((action) => action.type === "raid" && action.targetUid === target.uid)).toBe(true);
    g.act("a", { type: "raid", handIndex: 0, targetUid: target.uid });
    expect(target.cardId).toBe(U(67));
  });
  it("an ability can still play it: Omni-Directional Mobility Gear puts it onto the front line from the hand", () => {
    const g = setup("main");
    g.a.hand = [U(67)];
    useEvent(g, BT(99)); // draws two cards, then plays up to two red 104th Cadet Corps cards with 3 or less required energy and 1 AP cost
    expect(choice(g.game, "a").options).toEqual(["h:0"]);
    pick(g, "h:0");
    expect(g.a.front.map((card) => card.cardId)).toEqual([U(67)]);
    expect(g.a.front[0]!.rested).toBe(false);
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1"]); // its When Played
  });
  const raidMikasa = (g: Game): UnionArenaFieldCard => {
    energy(g.a, 2, RED_E);
    const target = front(g, U(66), true);
    raidOnto(g, U(67), target);
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1"]);
    return target;
  };
  it("When Played, mode 1: adds a card with 3 or less required energy, [104th Cadet Corps] and without Raid from the sideline to the hand", () => {
    const g = setup("main");
    g.a.sideline = [KINGSLAYER, SASHA_BLUE, SASHA_RED, U(67), U(42), MIKASA_RED, BT(89)];
    raidMikasa(g);
    pick(g, "m:0");
    // Sasha (cost 2) and Mikasa (cost 0) qualify; Sasha red costs 4, Kingslayer is not a cadet, 067 / Levi 042 / Mikasa 089 have Raid
    expect(choice(g.game, "a").options).toEqual(["s:1", "s:5"]);
    pick(g, "s:5");
    expect(g.a.hand).toEqual([MIKASA_RED]);
  });
  it("When Played, mode 1: choosing none adds nothing", () => {
    const g = setup("main");
    g.a.sideline = [SASHA_BLUE];
    raidMikasa(g);
    pick(g, "m:0");
    pick(g);
    expect(g.a.hand).toEqual([]);
    expect(g.a.sideline).toEqual([SASHA_BLUE]);
  });
  it("When Played, mode 2: a target with 5000 or more BP is sidelined by placing two hand cards into the sideline", () => {
    const g = setup("main");
    g.a.hand = [KINGSLAYER, EVENT, SEAFOOD];
    const big = foe(g, 5000);
    foe(g, 4999);
    raidMikasa(g);
    pick(g, "m:1");
    expect(choice(g.game, "a").options).toHaveLength(2);
    pick(g, big.uid);
    yes(g);
    expect(choice(g.game, "a").options).toHaveLength(3);
    pick(g, "h:0", "h:2");
    expect(g.a.sideline).toEqual([KINGSLAYER, SEAFOOD]);
    expect(g.b.sideline).toEqual([KINGSLAYER]);
    expect(g.b.front).toHaveLength(1);
  });
  it("When Played, mode 2: declining the payment keeps everything; a target below 5000 BP, or fewer than two hand cards, means no question", () => {
    const g = setup("main");
    g.a.hand = [KINGSLAYER, EVENT];
    const big = foe(g, 6000);
    raidMikasa(g);
    pick(g, "m:1");
    expect(g.game.pending?.kind).toBe("choose");
    pick(g, big.uid);
    no(g);
    expect(g.b.front).toEqual([big]);
    expect(g.a.sideline).toEqual([]);
    const small = setup("main");
    small.a.hand = [KINGSLAYER, EVENT];
    const low = foe(small, 4000);
    raidMikasa(small);
    pick(small, "m:1");
    pick(small, low.uid);
    expect(small.game.pending).toBeNull();
    expect(small.b.front).toEqual([low]);
    const poor = setup("main");
    poor.a.hand = [KINGSLAYER];
    const target = foe(poor, 6000);
    foe(poor, 2000);
    raidMikasa(poor);
    pick(poor, "m:1");
    pick(poor, target.uid);
    expect(poor.game.pending).toBeNull();
    expect(poor.b.front).toHaveLength(2);
  });
});

describe("AOT-2-069 Armin Arlelt (Colossal Titan)", () => {
  it("is left out: the front-line size limit is a global engine rule", () => {
    expect(CARD_ABILITIES[U(69)]).toBeUndefined();
  });
});

describe("AOT-2-070 Eren Jaeger", () => {
  it("When Played: takes up to one [104th Cadet Corps] card from the top three, the rest to the bottom in order, then places one hand card into the sideline", () => {
    const g = setup("main");
    energy(g.a, 1, RED_E);
    library(g.a, [PIECK0, MIKASA_RED, ZEKE0]);
    g.a.hand = [KINGSLAYER];
    playCard(g, U(70));
    expect(choice(g.game, "a").options).toEqual(["l:1"]);
    pick(g, "l:1");
    const rest = [...choice(g.game, "a").options];
    expect(rest).toHaveLength(2);
    pick(g, rest[1]!, rest[0]!);
    expect(g.a.library.slice(-2)).toEqual([ZEKE0, PIECK0]);
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1"]);
    pick(g, "h:1");
    expect(g.a.sideline).toEqual([MIKASA_RED]);
    expect(g.a.hand).toEqual([KINGSLAYER]);
    expect(g.a.library).toHaveLength(29);
  });
  it("When Played: adding nothing means no sideline", () => {
    const g = setup("main");
    energy(g.a, 1, RED_E);
    library(g.a, [PIECK0, MIKASA_RED, ZEKE0]);
    g.a.hand = [KINGSLAYER];
    playCard(g, U(70));
    pick(g);
    pick(g, ...choice(g.game, "a").options);
    expect(g.game.pending).toBeNull();
    expect(g.a.hand).toEqual([KINGSLAYER]);
    expect(g.a.sideline).toEqual([]);
  });
});

describe("AOT-2-071 Eren Jaeger", () => {
  it("has Nullify Impact", () => {
    const g = setup("main");
    expect(hasKeyword(ctx, front(g, U(71)), "冲击无效")).toBe(true);
  });
  it("Activate: Main (once per turn): adds a card from the life area to the hand and gains Impact (1) this turn", () => {
    const g = setup("main");
    const eren = front(g, U(71));
    g.act("a", { type: "activate", uid: eren.uid, ability: 0 });
    expect(g.a.life).toHaveLength(6);
    expect(g.a.hand).toHaveLength(1);
    expect(impactOf(ctx, eren)).toBe(1);
    expect(() => g.act("a", { type: "activate", uid: eren.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });
  it("Activate: Main works from the energy line too and costs no AP", () => {
    const g = setup("main");
    const eren = field(g.a, "energy", U(71));
    g.act("a", { type: "activate", uid: eren.uid, ability: 0 });
    expect(apRested(g)).toBe(0);
    expect(g.a.life).toHaveLength(6);
  });
  it("When Attacking, more than 3 life: a top card with 3 or less required energy and [104th Cadet Corps] may be added to the hand", () => {
    const g = setup("attack");
    library(g.a, [MIKASA_RED]);
    const eren = front(g, U(71));
    attack(g, eren.uid);
    expect(choice(g.game, "a").options).toEqual(["l:0"]);
    pick(g, "l:0");
    expect(g.a.hand).toEqual([MIKASA_RED]);
    expect(g.a.library).toHaveLength(29);
    expect(g.game.pending?.kind).toBe("damage");
  });
  it("When Attacking: declining a qualifying card, or a top card that does not qualify, puts it on the top or bottom of the deck", () => {
    const top = setup("attack");
    library(top.a, [MIKASA_RED, PIECK0]);
    attack(top, front(top, U(71)).uid);
    pick(top);
    expect(choice(top.game, "a").options).toEqual(["m:0", "m:1"]);
    pick(top, "m:0");
    expect(top.a.library.slice(0, 2)).toEqual([MIKASA_RED, PIECK0]);
    expect(top.a.hand).toEqual([]);
    const bottom = setup("attack");
    library(bottom.a, [PIECK0, MIKASA_RED]);
    attack(bottom, front(bottom, U(71)).uid);
    expect(choice(bottom.game, "a").options).toEqual(["m:0", "m:1"]); // Pieck Finger is not [104th Cadet Corps]: nothing to take
    pick(bottom, "m:1");
    expect(bottom.a.library[0]).toBe(MIKASA_RED);
    expect(bottom.a.library.at(-1)).toBe(PIECK0);
    expect(bottom.a.library).toHaveLength(30);
  });
  it("When Attacking: a [104th Cadet Corps] card with required energy 4 does not qualify", () => {
    const g = setup("attack");
    library(g.a, [SASHA_RED]);
    attack(g, front(g, U(71)).uid);
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1"]);
  });
  it("When Attacking, 3 or less life: draws a card instead of looking at the top card", () => {
    const g = setup("attack");
    g.a.life = g.a.life.slice(0, 3);
    library(g.a, [MIKASA_RED]);
    attack(g, front(g, U(71)).uid);
    expect(g.a.hand).toEqual([MIKASA_RED]);
    expect(g.a.library).toHaveLength(29);
    expect(g.game.pending?.kind).toBe("damage");
  });
  it("When Attacking: with exactly 4 life it still looks at the top card", () => {
    const g = setup("attack");
    g.a.life = g.a.life.slice(0, 4);
    library(g.a, [MIKASA_RED]);
    attack(g, front(g, U(71)).uid);
    expect(choice(g.game, "a").options).toEqual(["l:0"]);
  });
});

describe("AOT-2-072 Eren Jaeger (Attack Titan)", () => {
  const raid = (g: Game): UnionArenaFieldCard => {
    energy(g.a, 4, RED_E);
    const target = front(g, EREN0, true);
    raidOnto(g, U(72), target);
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1", "m:2"]);
    return target;
  };
  it("Raid <Eren Jaeger>; When Played: gains 1000 BP until the start of your next turn", () => {
    const g = setup("main");
    const eren = raid(g);
    pick(g, "m:0");
    expect(bpOf(ctx, eren)).toBe(5000);
    expect(g.game.pending).toBeNull(); // no opposing character
    expect(eren.lasting?.some((entry) => entry.bp === 1000)).toBe(true);
  });
  it("mode 1: sidelines a character with 3000 or less BP on the opponent's front line", () => {
    const g = setup("main");
    const small = foe(g, 3000);
    const big = foe(g, 3500);
    raid(g);
    pick(g, "m:0");
    expect(choice(g.game, "a").options).toEqual([small.uid]);
    pick(g, small.uid);
    expect(g.b.front).toEqual([big]);
    expect(g.a.life).toHaveLength(7);
  });
  it("mode 2: adds one card from the life area to the hand, then sidelines a character with 5000 or less BP", () => {
    const g = setup("main");
    const five = foe(g, 5000);
    const six = foe(g, 5500);
    raid(g);
    pick(g, "m:1");
    expect(g.a.life).toHaveLength(6);
    expect(g.a.hand).toHaveLength(1);
    expect(choice(g.game, "a").options).toEqual([five.uid]);
    pick(g, five.uid);
    expect(g.b.front).toEqual([six]);
  });
  it("mode 3: with 3 or less life sidelines a character with 5000 or less BP; with more life nothing happens", () => {
    const g = setup("main");
    g.a.life = g.a.life.slice(0, 3);
    const five = foe(g, 5000);
    foe(g, 5500);
    raid(g);
    pick(g, "m:2");
    expect(choice(g.game, "a").options).toEqual([five.uid]);
    pick(g, five.uid);
    expect(g.b.front).toHaveLength(1);
    expect(g.a.life).toHaveLength(3);
    const many = setup("main");
    foe(many, 5000);
    foe(many, 1000);
    raid(many);
    pick(many, "m:2");
    expect(many.game.pending).toBeNull();
    expect(many.b.front).toHaveLength(2);
  });
  it("up to one: choosing none sidelines nothing, but mode 2 still moved the life card", () => {
    const g = setup("main");
    foe(g, 5000);
    foe(g, 2000);
    raid(g);
    pick(g, "m:1");
    pick(g);
    expect(g.b.front).toHaveLength(2);
    expect(g.a.life).toHaveLength(6);
  });
});

describe("AOT-2-073 Seafood", () => {
  const start = (): { g: Game; one: UnionArenaFieldCard; two: UnionArenaFieldCard; three: UnionArenaFieldCard; four: UnionArenaFieldCard } => {
    const g = setup("main");
    const cards = [front(g, KINGSLAYER), front(g, KINGSLAYER), field(g.a, "energy", KINGSLAYER), field(g.a, "energy", KINGSLAYER)] as const;
    useEvent(g, SEAFOOD);
    expect(choice(g.game, "a").options).toEqual(["m:0", "m:1", "m:2"]);
    return { g, one: cards[0], two: cards[1], three: cards[2], four: cards[3] };
  };
  it("mode 1: up to one character gains 1000 BP and you draw two cards", () => {
    const { g, one, two } = start();
    pick(g, "m:0");
    expect(choice(g.game, "a").options).toHaveLength(4);
    expect(choice(g.game).max).toBe(1);
    pick(g, two.uid);
    expect(bpOf(ctx, two)).toBe(2500);
    expect(bpOf(ctx, one)).toBe(1500);
    expect(g.a.hand).toHaveLength(2);
  });
  it("mode 2: up to two characters gain 1000 BP each and you draw a card", () => {
    const { g, one, two, three } = start();
    pick(g, "m:1");
    expect(choice(g.game).max).toBe(2);
    pick(g, one.uid, three.uid);
    expect(bpOf(ctx, one)).toBe(2500);
    expect(bpOf(ctx, three)).toBe(2500);
    expect(bpOf(ctx, two)).toBe(1500);
    expect(g.a.hand).toHaveLength(1);
  });
  it("mode 3: up to three characters gain 1000 BP each and nothing is drawn", () => {
    const { g, one, two, three, four } = start();
    pick(g, "m:2");
    expect(choice(g.game).max).toBe(3);
    pick(g, one.uid, two.uid, four.uid);
    expect([one, two, four].map((card) => bpOf(ctx, card))).toEqual([2500, 2500, 2500]);
    expect(bpOf(ctx, three)).toBe(1500);
    expect(g.a.hand).toHaveLength(0);
  });
  it("up to: choosing nobody still draws the cards of that mode", () => {
    const { g, one } = start();
    pick(g, "m:0");
    pick(g);
    expect(bpOf(ctx, one)).toBe(1500);
    expect(g.a.hand).toHaveLength(2);
    expect(g.a.sideline).toEqual([SEAFOOD]);
  });
});
