/**
 * AOT (进击的巨人) batch 3: UE10BT/AOT-1-070 … 100 (the red 104th Cadet Corps cards and the Basement / Eren events) and UE10ST/AOT-1-068, 070.
 * One test (or more) per card, set up as the printed English text describes and checked against it. Cards are addressed by card number
 * (the image-free catalog); the text in `cards.json` is the source of truth.
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, damageOf, energyOf, flagsOf, hasKeyword, impactOf, type EngineContext, type EngineGame, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";

const N = (n: number): string => `UE10BT/AOT-1-${String(n).padStart(3, "0")}`;
const ST = (n: number): string => `UE10ST/AOT-1-${String(n).padStart(3, "0")}`;
/** Red energy: Levi (073) makes 1 red energy and costs 5, so it is never a candidate for the "1 or less required energy" bounce effects; on the energy line (placed by the harness) it has no effect of its own. */
const LEVI5 = N(73);
const red = (owner: EnginePlayer, count: number): void => energy(owner, count, LEVI5);
/** Bertholdt Hoover (ST 102): red, cost 3, makes 2 red energy. */
const RED6 = ST(102);
// Helper cards without abilities.
const NINE = "UC01BT/ARK-1-088"; // red, cost 0, BP2000
const KINGSLAYER = "UC01BT/ARK-1-004"; // yellow, cost 0, BP1500 (the harness filler)
const GUARD = "UC01ST/ARK-1-103"; // blue, cost 3, BP3000
const MON3TR = "UC01BT/ARK-1-054"; // blue, cost 7, BP4500
const TALULAH = "UC01ST/ARK-1-110"; // yellow, cost 5, BP4000
const TITAN = N(42); // Pure Titan: green, cost 0, BP2000, no text
const JEAN0 = N(83); // Jean: red, cost 0, BP2000, [104th Cadet Corps／Levi Squad], no text
const CONNY = N(79); // Conny: red, cost 1, BP2500, [104th Cadet Corps／Levi Squad], no text
const MIKASA0 = N(85); // Mikasa: red, cost 0, BP2000, [104th Cadet Corps／Levi Squad], no text
const EREN0 = N(90); // Eren Jaeger: red, cost 0, BP1500, [104th Cadet Corps／Levi Squad／Inheritor of the Titan], no text
const FILLER = KINGSLAYER;

type Act = (who: string, action: UnionArenaAction) => void;
const play = (act: Act, handIndex = 0, line: "front" | "energy" = "front"): void => act("a", { type: "play", handIndex, line });
const pick = (act: Act, ...picks: string[]): void => act("a", { type: "choose", picks });
const useEvent = (act: Act, handIndex = 0): void => act("a", { type: "event", handIndex });
const activate = (act: Act, card: UnionArenaFieldCard, ability: number): void => act("a", { type: "activate", uid: card.uid, ability });
/** Answers an ordered "put the rest on the bottom" question with the options as they are listed. */
const keepOrder = (game: EngineGame, act: Act): void => { const options = [...choice(game, "a").options]; pick(act, ...options); };
const activeAp = (owner: { ap: Array<{ rested: boolean }> }): number => owner.ap.filter((card) => !card.rested).length;
/** Any action ends in a recalculation of the continuous effects; this one changes nothing. */
const refresh = (act: Act): void => act("a", { type: "manual", manual: { op: "draw" } });
/** Sets the top of the turn player's deck. */
const topOfDeck = (owner: EnginePlayer, top: string[]): void => { owner.library = [...top, ...Array(30 - top.length).fill(FILLER)]; };
/** The attacked player takes damage from the first life card and does not use its trigger. */
const resolveDamage = (act: Act, defender: EnginePlayer, amount = 1): void => {
  const lifeIds = defender.life.slice(0, amount).map((slot) => slot.id);
  act("a", { type: "damage", lifeIds });
  for (const lifeId of lifeIds) act(defender.accountId, { type: "trigger", lifeId, activate: false });
};
const names = (cardIds: string[]): string[] => cardIds.map((cardId) => ctx.card(cardId)?.name ?? "?");

const BATCH = [...Array.from({ length: 31 }, (_, index) => N(70 + index)), ST(68), ST(70)];

describe("AOT batch 3: every card is automatic", () => {
  it("each card of the batch plays by itself (an ability table entry, or no ability text)", () => {
    for (const number of BATCH) expect(isAutomated(titleCard(number)), number).toBe(true);
  });

  it.each([79, 83, 85, 90])("AOT-1-%i prints '-' (no ability text) and the engine plays it by itself", (n) => {
    expect(titleCard(N(n)).stats.abilityText).toBe("-");
    expect(isAutomated(titleCard(N(n)))).toBe(true);
  });
});

describe("AOT-1-070 and UE10ST/AOT-1-070 Hannes", () => {
  it.each([[N(70)], [ST(70)]])("%s: returns the one other character with 1 or less required energy (the 3-cost one stays)", (hannes) => {
    const { game, a, act } = setup();
    red(a, 1);
    field(a, "front", NINE);
    const guard = field(a, "front", GUARD);
    a.hand.push(hannes);
    play(act);
    expect(game.pending).toBeNull(); // only one candidate: no question
    expect(a.hand).toEqual([NINE]);
    expect(a.front.map((card) => card.cardId)).toEqual([GUARD, hannes]);
    expect(a.front[0]).toBe(guard);
  });

  it("with two candidates the player picks; a character with 2 or more energy is not offered", () => {
    const { game, a, act } = setup();
    red(a, 1);
    const nine = field(a, "front", NINE);
    const conny = field(a, "front", CONNY);
    field(a, "front", GUARD);
    a.hand.push(N(70));
    play(act);
    expect([...choice(game, "a").options].sort()).toEqual([nine.uid, conny.uid].sort());
    pick(act, conny.uid);
    expect(a.hand).toEqual([CONNY]);
    expect(a.front.map((card) => card.uid)).toContain(nine.uid);
  });

  it("with no candidate, Hannes returns himself", () => {
    const { game, a, act } = setup();
    red(a, 1);
    field(a, "front", GUARD);
    a.hand.push(ST(70));
    play(act);
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([ST(70)]);
    expect(a.front.map((card) => card.cardId)).toEqual([GUARD]);
  });
});

describe("AOT-1-071 Eren Kruger", () => {
  it("Activate: Main: rests and sidelines itself; only if <Grisha Jaeger> is on the field; draw two, then place one card from the hand into the sideline", () => {
    const { game, a, act } = setup();
    const kruger = field(a, "energy", N(71));
    field(a, "front", N(72));
    a.hand.push(NINE, TITAN);
    activate(act, kruger, 0);
    expect(a.sideline).toEqual([N(71)]);
    expect(a.energy).toHaveLength(0);
    expect(a.hand).toHaveLength(4);
    expect(choice(game, "a").options).toHaveLength(4);
    pick(act, "h:0");
    expect(a.sideline).toEqual([N(71), NINE]);
    expect(a.hand).toHaveLength(3);
  });

  it("cannot be activated without <Grisha Jaeger> on the field, and nothing is paid then", () => {
    const { game, a, act } = setup();
    const kruger = field(a, "energy", N(71));
    field(a, "front", NINE);
    expect(() => activate(act, kruger, 0)).toThrow("ABILITY_CONDITION");
    expect(kruger.rested).toBe(false);
    expect(a.energy).toHaveLength(1);
    expect(a.sideline).toEqual([]);
    expect(game.pending).toBeNull();
  });
});

describe("AOT-1-072 Grisha Jaeger", () => {
  const library = [N(26), EREN0, NINE, N(98), GUARD];
  it("When Played: offers a red character with 'Eren Jaeger' in its name or <Key to the Basement>; adds it, rest to the bottom, then discard one", () => {
    const { game, a, act } = setup();
    red(a, 1);
    topOfDeck(a, library);
    a.hand.push(N(72), NINE);
    play(act);
    // The blue Eren Jaeger (026) and the red non-Eren (九) are not offered.
    expect([...choice(game, "a").options].sort()).toEqual(["l:1", "l:3"]);
    pick(act, "l:1");
    keepOrder(game, act);
    expect(names(a.library.slice(-4))).toEqual(names([N(26), NINE, N(98), GUARD]));
    expect(a.hand).toEqual([NINE, EREN0]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "h:1");
    expect(a.sideline).toEqual([EREN0]);
    expect(a.hand).toEqual([NINE]);
  });

  it("can reveal <Key to the Basement> instead; only one card in total", () => {
    const { game, a, act } = setup();
    red(a, 1);
    topOfDeck(a, library);
    a.hand.push(N(72), NINE);
    play(act);
    expect(() => pick(act, "l:1", "l:3")).toThrow("INVALID_CHOICE");
    pick(act, "l:3");
    keepOrder(game, act);
    expect(a.hand).toEqual([NINE, N(98)]);
    pick(act, "h:0");
    expect(a.sideline).toEqual([NINE]);
  });

  it("revealing nothing means nothing is discarded", () => {
    const { game, a, act } = setup();
    red(a, 1);
    topOfDeck(a, library);
    a.hand.push(N(72), NINE);
    play(act);
    pick(act);
    keepOrder(game, act);
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([NINE]);
    expect(a.sideline).toEqual([]);
    expect(a.library.slice(-5)).toHaveLength(5);
  });
});

describe("AOT-1-073 Levi", () => {
  it("is played set to active and has Double Attack; costs 2 AP", () => {
    const { a, act } = setup();
    energy(a, 3, RED6);
    a.hand.push(N(73), NINE);
    play(act);
    const levi = a.front[0]!;
    expect(levi.rested).toBe(false);
    expect(hasKeyword(ctx, levi, "2次攻击")).toBe(true);
    expect(activeAp(a)).toBe(1);
    play(act); // a card without that text enters resting
    expect(a.front[1]!.rested).toBe(true);
  });
});

describe("AOT-1-074 Ymir", () => {
  it("costs 《Red×1》 less while a blue or green card is on the opponent's field", () => {
    const { game, a, b, players } = setup();
    const cost = (): number => costOf(game, players, ctx, "a", N(74)).energy;
    expect(cost()).toBe(3);
    field(b, "front", NINE);
    expect(cost()).toBe(3); // red
    field(a, "front", GUARD);
    expect(cost()).toBe(3); // our own blue card does not count
    const blue = field(b, "energy", GUARD);
    expect(cost()).toBe(2);
    b.energy.splice(b.energy.indexOf(blue), 1);
    expect(cost()).toBe(3);
    field(b, "energy", TITAN); // green
    expect(cost()).toBe(2);
  });
});

describe("AOT-1-075 Armin Arlelt", () => {
  it("When Played: draw a card, then place one card from the hand into the sideline", () => {
    const { game, a, act } = setup();
    a.hand.push(N(75), NINE, GUARD);
    const library = a.library.length;
    play(act);
    expect(a.library).toHaveLength(library - 1);
    expect(a.hand).toHaveLength(3);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    pick(act, "h:1");
    expect(a.sideline).toEqual([GUARD]);
    expect(a.hand).toEqual([NINE, FILLER]);
  });
});

describe("AOT-1-076 Armin Arlelt", () => {
  /** Armin (076) on the field; Hannes in the hand returns him. */
  const bounced = (hand: string[] = []) => {
    const g = setup();
    red(g.a, 1);
    const armin = field(g.a, "front", N(76));
    g.a.hand.push(N(70), ...hand);
    play(g.act);
    return { ...g, armin };
  };

  it("When returned to the hand during your turn: may place a red <Armin Arlelt> with 1 required energy from the hand into the sideline; then draw two, place one", () => {
    const { game, a, act } = bounced([NINE]);
    expect(a.hand).toEqual([NINE, N(76)]);
    expect(choice(game, "a").options).toEqual(["yes", "no"]);
    pick(act, "yes");
    // The returned Armin is the only red <Armin Arlelt> with 1 energy in the hand: no question.
    expect(a.sideline).toEqual([N(76)]);
    expect(a.hand).toHaveLength(3);
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, "h:0");
    expect(a.sideline).toEqual([N(76), NINE]);
    expect(a.hand).toEqual([FILLER, FILLER]);
  });

  it("declining leaves the card in the hand and draws nothing", () => {
    const { game, a, act } = bounced([NINE]);
    pick(act, "no");
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([NINE, N(76)]);
    expect(a.sideline).toEqual([]);
  });

  it("only a red <Armin Arlelt> with exactly 1 required energy qualifies (the 0-cost and 4-cost ones do not); with two the player picks", () => {
    const { game, a, act } = bounced([N(75), N(77), N(76)]);
    pick(act, "yes");
    expect([...choice(game, "a").options].sort()).toEqual(["h:2", "h:3"]); // the Armin 076 copy and the returned one
    pick(act, "h:2");
    expect(a.sideline).toEqual([N(76)]);
    expect(a.hand).toEqual([N(75), N(77), N(76), FILLER, FILLER]);
    pick(act, "h:3"); // the card placed after drawing two
    expect(a.sideline).toEqual([N(76), FILLER]);
    expect(a.hand).toEqual([N(75), N(77), N(76), FILLER]);
  });

  it("does not activate during the opponent's turn", () => {
    const { game, a, act } = setup("main", "b");
    const armin = field(a, "front", N(76));
    a.hand.push(NINE);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: armin.uid, act: "hand" } });
    expect(a.hand).toEqual([NINE, N(76)]);
    expect(game.pending).toBeNull();
  });
});

describe("AOT-1-077 Armin Arlelt", () => {
  it("When Played, first option: up to one other character gains 1000 BP (not himself)", () => {
    const { game, a, act } = setup();
    red(a, 4);
    const nine = field(a, "front", NINE);
    a.hand.push(N(77));
    play(act);
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "m:0");
    // Every other character on the field is offered (the Levi energy cards too), but not Armin himself.
    expect(choice(game, "a").options).toContain(nine.uid);
    expect(choice(game, "a").options).not.toContain(a.front[1]!.uid);
    pick(act, nine.uid);
    expect(bpOf(ctx, nine)).toBe(3000);
    expect(bpOf(ctx, a.front[1]!)).toBe(3000);
  });

  it("first option: choosing nobody is allowed", () => {
    const { game, a, act } = setup();
    red(a, 4);
    const nine = field(a, "front", NINE);
    a.hand.push(N(77));
    play(act);
    pick(act, "m:0");
    pick(act);
    expect(bpOf(ctx, nine)).toBe(2000);
    expect(game.pending).toBeNull();
  });

  it("second option: the next BP-range choice this turn gets 1000 more, once (Mikasa 089 chooses 3500 or less -> 4500)", () => {
    const { game, a, b, act } = setup();
    red(a, 4);
    field(a, "front", EREN0); // a character with "Eren Jaeger" in its name for Mikasa
    const big = field(b, "front", MON3TR); // BP 4500
    const big2 = field(b, "front", MON3TR);
    a.hand.push(N(77), N(89), N(89));
    play(act);
    pick(act, "m:1");
    expect(game.pending).toBeNull();
    play(act); // Mikasa 089
    expect(choice(game, "a").options.sort()).toEqual([big.uid, big2.uid].sort());
    pick(act, big.uid);
    expect(b.sideline).toEqual([MON3TR]);
    // The raise is used up: the second Mikasa cannot choose the 4500 character.
    play(act);
    expect(game.pending).toBeNull();
    expect(b.front.map((card) => card.uid)).toEqual([big2.uid]);
  });

  it("second option: without it, Mikasa 089 cannot choose a 4500 BP character", () => {
    const { game, a, b, act } = setup();
    red(a, 4);
    field(a, "front", EREN0);
    field(b, "front", MON3TR);
    a.hand.push(N(89));
    play(act);
    expect(game.pending).toBeNull();
    expect(b.front).toHaveLength(1);
  });

  it("second option: a choice with no BP range does not use it up", () => {
    const { game, a, b, act } = setup();
    red(a, 4);
    const eren = field(a, "front", EREN0);
    field(b, "front", MON3TR);
    a.hand.push(N(77), N(78), N(89));
    play(act);
    pick(act, "m:1");
    play(act); // Christa: chooses "one other character" (no BP range)
    expect([...choice(game, "a").options]).toContain(eren.uid);
    pick(act, eren.uid);
    play(act); // Mikasa 089: still raised
    expect(choice(game, "a").options).toHaveLength(1);
  });

  it("Activate: Main (front line, once per turn): activates the When Played ability again", () => {
    const { game, a, act } = setup();
    red(a, 4);
    const nine = field(a, "front", NINE);
    a.hand.push(N(77));
    play(act);
    pick(act, "m:0");
    pick(act, nine.uid);
    const armin = a.front[1]!;
    activate(act, armin, 1);
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "m:0");
    pick(act, nine.uid);
    expect(bpOf(ctx, nine)).toBe(4000);
    expect(() => activate(act, armin, 1)).toThrow("ONCE_PER_TURN");
  });

  it("Activate: Main needs the front line", () => {
    const { a, act } = setup();
    const armin = field(a, "energy", N(77));
    expect(() => activate(act, armin, 1)).toThrow("ABILITY_CONDITION");
  });
});

describe("AOT-1-078 Christa Lenz", () => {
  it("When Played: up to one other character gains 1000 BP; nobody is also fine", () => {
    const { game, a, act } = setup();
    const nine = field(a, "front", NINE);
    a.hand.push(N(78), N(78));
    play(act);
    expect(choice(game, "a").options).toEqual([nine.uid]);
    pick(act, nine.uid);
    expect(bpOf(ctx, nine)).toBe(3000);
    expect(bpOf(ctx, a.front[1]!)).toBe(500);
    play(act);
    pick(act);
    expect(bpOf(ctx, nine)).toBe(3000);
    expect(game.pending).toBeNull();
  });
});

describe("AOT-1-080 Sasha Braus", () => {
  it("When Played: reveals up to one [Food] card among the top seven, rest to the bottom, then discard one", () => {
    const { game, a, act } = setup();
    red(a, 1);
    topOfDeck(a, [NINE, GUARD, N(100), MON3TR, N(98), TALULAH, TITAN]);
    a.hand.push(N(80), NINE);
    play(act);
    expect(choice(game, "a").options).toEqual(["l:2"]); // only A Steamed Potato, Sir! has [Food]
    pick(act, "l:2");
    keepOrder(game, act);
    expect(names(a.library.slice(-6))).toEqual(names([NINE, GUARD, MON3TR, N(98), TALULAH, TITAN]));
    expect(a.hand).toEqual([NINE, N(100)]);
    pick(act, "h:0");
    expect(a.sideline).toEqual([NINE]);
  });

  it("revealing nothing means no discard", () => {
    const { game, a, act } = setup();
    red(a, 1);
    topOfDeck(a, [NINE, GUARD, N(100), MON3TR, N(98), TALULAH, TITAN]);
    a.hand.push(N(80), NINE);
    play(act);
    pick(act);
    keepOrder(game, act);
    expect(a.hand).toEqual([NINE]);
    expect(a.sideline).toEqual([]);
  });
});

describe("AOT-1-081 Sasha Braus", () => {
  it("During your turn, after you used a [Food] card this turn: +500 BP and Impact (1); not before, not on the opponent's turn", () => {
    const { game, a, act } = setup();
    const sasha = field(a, "front", N(81));
    a.hand.push(N(100), NINE);
    refresh(act);
    expect(bpOf(ctx, sasha)).toBe(3500);
    expect(impactOf(ctx, sasha)).toBe(0);
    // Using a non-Food event does not count (A Steamed Potato is the only [Food] card here).
    useEvent(act); // A Steamed Potato, Sir!
    pick(act); // place no card on the bottom
    pick(act); // no AP card
    expect(game.pending).toBeNull();
    expect(bpOf(ctx, sasha)).toBe(4000);
    expect(impactOf(ctx, sasha)).toBe(1);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, sasha)).toBe(3500);
    expect(impactOf(ctx, sasha)).toBe(0);
  });

  it("an event without [Food] does not turn it on", () => {
    const { a, act } = setup();
    const sasha = field(a, "front", N(81));
    a.hand.push(N(97));
    useEvent(act); // Dedicate Your Heart!!
    pick(act);
    expect(bpOf(ctx, sasha)).toBe(3500);
  });
});

describe("AOT-1-082 Sasha Braus", () => {
  it("When Played: up to one [104th Cadet Corps] card gains 1000 BP; this character stays resting without a [Food] card used", () => {
    const { game, a, act } = setup();
    red(a, 2);
    const jean = field(a, "front", JEAN0);
    field(a, "front", GUARD);
    a.hand.push(N(82));
    play(act);
    // Sasha herself is a [104th Cadet Corps] card too; the 3-cost Guard is not.
    expect([...choice(game, "a").options].sort()).toEqual([jean.uid, a.front[2]!.uid].sort());
    pick(act, jean.uid);
    expect(bpOf(ctx, jean)).toBe(3000);
    expect(a.front[2]!.rested).toBe(true);
  });

  it("with a [Food] card used this turn she is switched to active; choosing nobody is allowed", () => {
    const { game, a, act } = setup();
    red(a, 2);
    field(a, "front", JEAN0);
    a.hand.push(N(100), N(82));
    useEvent(act);
    pick(act);
    pick(act);
    play(act);
    pick(act);
    expect(game.pending).toBeNull();
    expect(a.front[1]!.rested).toBe(false);
    expect(bpOf(ctx, a.front[0]!)).toBe(2000);
  });
});

describe("AOT-1-084 Jean Kirschtein", () => {
  it("Activate: Main, switch to resting: one other character gains 1000 BP (not himself); may be repeated only if he is active", () => {
    const { game, a, act } = setup();
    const jean = field(a, "front", N(84));
    const nine = field(a, "front", NINE);
    activate(act, jean, 0);
    expect(jean.rested).toBe(true);
    expect(game.pending).toBeNull(); // the only other character is chosen by itself
    expect(bpOf(ctx, nine)).toBe(3000);
    expect(bpOf(ctx, jean)).toBe(2000);
    expect(() => activate(act, jean, 0)).toThrow();
  });

  it("with two others the player picks", () => {
    const { game, a, act } = setup();
    const jean = field(a, "front", N(84));
    const nine = field(a, "front", NINE);
    const guard = field(a, "energy", GUARD);
    activate(act, jean, 0);
    expect([...choice(game, "a").options].sort()).toEqual([nine.uid, guard.uid].sort());
    pick(act, guard.uid);
    expect(bpOf(ctx, guard)).toBe(4000);
    expect(bpOf(ctx, nine)).toBe(2000);
  });
});

describe("AOT-1-086 Mikasa Ackermann", () => {
  it("During your turn, with five or more other [104th Cadet Corps] cards on the field: +1000 BP", () => {
    const { a, act } = setup();
    const mikasa = field(a, "front", N(86));
    for (let index = 0; index < 3; index += 1) field(a, "front", JEAN0);
    field(a, "energy", JEAN0);
    refresh(act);
    expect(bpOf(ctx, mikasa)).toBe(3000); // four others
    field(a, "energy", MIKASA0);
    refresh(act);
    expect(bpOf(ctx, mikasa)).toBe(4000); // five others
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, mikasa)).toBe(3000); // the opponent's turn
  });

  it("a non-[104th Cadet Corps] card does not count", () => {
    const { a, act } = setup();
    const mikasa = field(a, "front", N(86));
    for (let index = 0; index < 3; index += 1) field(a, "front", JEAN0);
    field(a, "energy", NINE);
    field(a, "energy", NINE);
    refresh(act);
    expect(bpOf(ctx, mikasa)).toBe(3000);
  });
});

describe("AOT-1-087 Mikasa Ackermann", () => {
  it("if active, gains 《Red》 energy generation", () => {
    const { a, act } = setup();
    const mikasa = field(a, "energy", N(87));
    refresh(act);
    expect(energyOf(ctx, a, "red")).toBe(2);
    mikasa.rested = true;
    refresh(act);
    expect(energyOf(ctx, a, "red")).toBe(1);
  });
});

describe("AOT-1-088 Mikasa Ackermann", () => {
  it("During your turn, with five or more other [104th Cadet Corps] cards on the field: +500 BP", () => {
    const { a, act } = setup();
    const mikasa = field(a, "front", N(88));
    for (let index = 0; index < 3; index += 1) field(a, "front", JEAN0);
    field(a, "energy", JEAN0);
    refresh(act);
    expect(bpOf(ctx, mikasa)).toBe(3500);
    field(a, "energy", JEAN0);
    refresh(act);
    expect(bpOf(ctx, mikasa)).toBe(4000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, mikasa)).toBe(3500);
  });

  /** Event 099 puts Mikasa 088 onto the front line; at the end of the attack phase she is returned to the hand. */
  const returnedAtAttackEnd = (filler: number) => {
    const g = setup();
    // (no energy is needed: the event puts the card onto the field)
    g.a.hand.push(N(99), N(88));
    useEvent(g.act);
    pick(g.act, "h:0"); // Mikasa 088 (cost 3, AP 1); no other card qualifies for the second question
    for (let index = g.a.hand.length - 1; index >= 0; index -= 1) {
      if (g.a.hand.length > filler) g.act("a", { type: "manual", manual: { op: "hand", handIndex: index, act: "sideline" } });
    }
    g.act("a", { type: "next_phase" });
    g.act("a", { type: "next_phase" }); // the attack phase ends
    return g;
  };

  it("During your turn, if she would be returned to the hand: may place one card from the hand into the sideline instead; she stays", () => {
    const { game, a, act } = returnedAtAttackEnd(2);
    const question = choice(game, "a");
    expect(question.options).toEqual(["yes", "no"]);
    expect(question.prompt).toContain("放回手牌");
    expect(a.front.map((card) => card.cardId)).toEqual([N(88)]); // still on the field until answered
    pick(act, "yes");
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "h:0");
    expect(a.front.map((card) => card.cardId)).toEqual([N(88)]);
    expect(a.sideline).toEqual([N(99), FILLER]); // the used event, then the card placed instead
    expect(a.hand).toEqual([FILLER]);
    expect(a.hand).not.toContain(N(88));
  });

  it("declining the replacement returns her to the hand as usual", () => {
    const { game, a, act } = returnedAtAttackEnd(2);
    pick(act, "no");
    expect(game.pending?.kind === "choose" ? game.pending.purpose : null).not.toBe("confirm");
    expect(a.front).toEqual([]);
    expect(a.hand).toContain(N(88));
    expect(a.sideline).toEqual([N(99)]); // only the used event
  });

  it("with no card in the hand there is nothing to place instead: she is returned", () => {
    const { game, a } = returnedAtAttackEnd(0);
    expect(game.pending).toBeNull();
    expect(a.front).toEqual([]);
    expect(a.hand).toEqual([N(88)]);
  });

  it("also replaces a return caused by the opponent's trigger while she attacks", () => {
    const { game, a, b, act } = setup("attack");
    const mikasa = field(a, "front", N(88));
    a.hand.push(NINE, TITAN);
    b.life[0]!.cardId = N(9); // 《COLOR》 Choose one character with 3500 or less BP on your opponent's front line and return it to their hand.
    act("a", { type: "attack", attackerUid: mikasa.uid });
    const lifeId = b.life[0]!.id;
    act("a", { type: "damage", lifeIds: [lifeId] });
    act("b", { type: "trigger", lifeId, activate: true, targetUid: mikasa.uid });
    expect(choice(game, "a").options).toEqual(["yes", "no"]);
    pick(act, "yes");
    pick(act, "h:1");
    expect(a.front.map((card) => card.uid)).toEqual([mikasa.uid]);
    expect(a.sideline).toEqual([TITAN]);
    expect(b.sideline).toContain(N(9));
  });

  it("without the replacement (other characters) the same trigger returns the character", () => {
    const { a, b, act } = setup("attack");
    const nine = field(a, "front", NINE);
    b.life[0]!.cardId = N(9);
    act("a", { type: "attack", attackerUid: nine.uid });
    const lifeId = b.life[0]!.id;
    act("a", { type: "damage", lifeIds: [lifeId] });
    act("b", { type: "trigger", lifeId, activate: true, targetUid: nine.uid });
    expect(a.front).toEqual([]);
    expect(a.hand).toContain(NINE);
  });
});

describe("AOT-1-089 Mikasa Ackermann", () => {
  it("When Played: with a character named 'Eren Jaeger' on the field, up to one 3500-or-less BP opposing front-line character is sidelined", () => {
    const { game, a, b, act } = setup();
    red(a, 4);
    field(a, "front", N(93)); // "Eren Jaeger (Attack Titan)" counts
    const guard = field(b, "front", GUARD);
    field(b, "front", TALULAH);
    a.hand.push(N(89));
    play(act);
    expect(choice(game, "a").options).toEqual([guard.uid]);
    pick(act, guard.uid);
    expect(b.sideline).toEqual([GUARD]);
  });

  it("choosing nobody is allowed", () => {
    const { game, a, b, act } = setup();
    red(a, 4);
    field(a, "energy", EREN0);
    field(b, "front", GUARD);
    a.hand.push(N(89));
    play(act);
    pick(act);
    expect(b.front).toHaveLength(1);
    expect(game.pending).toBeNull();
  });

  it("does nothing without a character named 'Eren Jaeger' on our field", () => {
    const { game, a, b, act } = setup();
    red(a, 4);
    field(a, "front", NINE);
    field(b, "front", GUARD);
    a.hand.push(N(89));
    play(act);
    expect(game.pending).toBeNull();
    expect(b.front).toHaveLength(1);
  });
});

describe("AOT-1-091 Eren Jaeger", () => {
  it("Activate: Main (front line, once per turn): add one card from the life area to the hand; this character gains 1000 BP", () => {
    const { game, a, act } = setup();
    const eren = field(a, "front", N(91));
    const life = a.life.length;
    const top = a.life[0]!.cardId;
    activate(act, eren, 0);
    expect(a.life).toHaveLength(life - 1);
    expect(a.hand).toEqual([top]);
    expect(bpOf(ctx, eren)).toBe(4000);
    expect(game.pending).toBeNull();
    expect(() => activate(act, eren, 0)).toThrow("ONCE_PER_TURN");
  });

  it("needs the front line", () => {
    const { a, act } = setup();
    const eren = field(a, "energy", N(91));
    expect(() => activate(act, eren, 0)).toThrow("ABILITY_CONDITION");
    expect(a.hand).toEqual([]);
  });

  it("has Step", () => {
    expect(ctx.card(N(91))!.keywords).toContain("撤步");
  });
});

describe("AOT-1-092 Eren Jaeger", () => {
  const prepare = () => {
    const g = setup("attack");
    const eren = field(g.a, "front", N(92));
    const jean = field(g.a, "front", JEAN0);
    const conny = field(g.a, "front", CONNY);
    const nine = field(g.a, "front", NINE);
    g.a.hand.push(MIKASA0, NINE, GUARD);
    return { ...g, eren, jean, conny, nine };
  };

  it("has Impact (1)", () => {
    const { a, act, eren } = prepare();
    refresh(act);
    expect(hasKeyword(ctx, eren, "冲击1")).toBe(true);
    expect(impactOf(ctx, eren)).toBe(1);
    expect(a.front).toHaveLength(4);
  });

  it("When Attacking: puts another [104th Cadet Corps] card from the front line on top of the deck, then plays a red cadet card (<=3 energy, 1 AP) from the hand set to active; it returns to the hand when the attack phase ends", () => {
    const { game, a, b, act, eren, jean, conny, nine } = prepare();
    act("a", { type: "attack", attackerUid: eren.uid });
    // Eren himself and the non-cadet 九 are not offered.
    expect([...choice(game, "a").options].sort()).toEqual([jean.uid, conny.uid].sort());
    pick(act, jean.uid);
    expect(a.library[0]).toBe(JEAN0);
    expect(a.front.map((card) => card.uid)).toEqual([eren.uid, conny.uid, nine.uid]);
    // Only Mikasa (085) in the hand is a red [104th Cadet Corps] card with 3 or less energy and 1 AP (九 is not a cadet, Guard is blue).
    expect(choice(game, "a").options).toEqual(["h:0"]);
    pick(act, "h:0");
    const placed = a.front[3]!;
    expect(placed.cardId).toBe(MIKASA0);
    expect(placed.rested).toBe(false);
    expect(a.hand).toEqual([NINE, GUARD]);
    expect(game.pending?.kind).toBe("damage");
    resolveDamage(act, b);
  });

  it("the played character returns to the hand at the end of the attack phase", () => {
    const g = prepare();
    g.act("a", { type: "attack", attackerUid: g.eren.uid });
    pick(g.act, g.jean.uid);
    pick(g.act, "h:0");
    resolveDamage(g.act, g.b);
    expect(g.a.front.map((card) => card.cardId)).toContain(MIKASA0);
    g.act("a", { type: "end_turn" });
    expect(g.a.front.map((card) => card.cardId)).not.toContain(MIKASA0);
    expect(g.a.hand).toContain(MIKASA0);
  });

  it("choosing nobody to put on the deck keeps the front line full: no card is played", () => {
    const g = prepare();
    g.act("a", { type: "attack", attackerUid: g.eren.uid });
    pick(g.act);
    expect(g.game.pending?.kind).toBe("damage");
    expect(g.a.front).toHaveLength(4);
    expect(g.a.hand).toEqual([MIKASA0, NINE, GUARD]);
  });

  it("with the front line not full to begin with, a card is still played (up to one: it may be declined)", () => {
    const g = prepare();
    g.a.front.pop();
    g.act("a", { type: "attack", attackerUid: g.eren.uid });
    pick(g.act); // nobody to the deck
    expect(choice(g.game, "a").options).toEqual(["h:0"]);
    pick(g.act);
    expect(g.a.hand).toEqual([MIKASA0, NINE, GUARD]);
    expect(g.game.pending?.kind).toBe("damage");
  });
});

describe("AOT-1-093 Eren Jaeger (Attack Titan)", () => {
  const prepare = (life = 7, hand: string[] = [NINE, TITAN]) => {
    const g = setup("attack");
    const eren = field(g.a, "front", N(93));
    g.a.life = g.a.life.slice(0, life);
    g.a.hand.push(...hand);
    return { ...g, eren };
  };

  it("has Damage (2) and gains 1000 BP during your turn only", () => {
    const { a, act, eren } = prepare();
    refresh(act);
    expect(damageOf(ctx, eren)).toBe(2);
    expect(bpOf(ctx, eren)).toBe(5000);
    expect(a.life).toHaveLength(7);
  });

  it("When Attacking, first option: draw a card", () => {
    const { game, a, act, eren } = prepare();
    const hand = a.hand.length;
    act("a", { type: "attack", attackerUid: eren.uid });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "m:0");
    expect(a.hand).toHaveLength(hand + 1);
    expect(game.pending?.kind).toBe("damage");
  });

  it("second option with 3 or less life: may place two cards from the hand into the sideline; then sidelines an opposing front-line character with 2000 or less BP", () => {
    const { game, a, b, act, eren } = prepare(3);
    const nine = field(b, "front", NINE, true);
    field(b, "front", GUARD, true);
    act("a", { type: "attack", attackerUid: eren.uid });
    pick(act, "m:1");
    expect(choice(game, "a").options).toEqual(["yes", "no"]);
    pick(act, "yes");
    expect(choice(game, "a").options).toEqual([nine.uid]); // Guard (3000) is too strong
    pick(act, nine.uid);
    expect(a.sideline).toEqual([NINE, TITAN]);
    expect(a.hand).toEqual([]);
    expect(b.sideline).toEqual([NINE]);
    expect(b.front).toHaveLength(1);
  });

  it("declining the 'may' places nothing", () => {
    const { game, a, b, act, eren } = prepare(3);
    field(b, "front", NINE, true);
    act("a", { type: "attack", attackerUid: eren.uid });
    pick(act, "m:1");
    pick(act, "no");
    expect(a.hand).toHaveLength(2);
    expect(a.sideline).toEqual([]);
    expect(b.front).toHaveLength(1);
    expect(game.pending?.kind).toBe("damage");
  });

  it("second option does nothing with 4 or more life, or with fewer than two cards in the hand", () => {
    const four = prepare(4);
    field(four.b, "front", NINE, true);
    four.act("a", { type: "attack", attackerUid: four.eren.uid });
    pick(four.act, "m:1");
    expect(four.game.pending?.kind).toBe("damage");
    expect(four.b.front).toHaveLength(1);
    expect(four.a.hand).toHaveLength(2);

    const one = prepare(3, [NINE]);
    field(one.b, "front", NINE, true);
    one.act("a", { type: "attack", attackerUid: one.eren.uid });
    pick(one.act, "m:1");
    expect(one.game.pending?.kind).toBe("damage");
    expect(one.b.front).toHaveLength(1);
  });

  it("second option: up to one, so no target may be chosen", () => {
    const { game, a, b, act, eren } = prepare(3);
    field(b, "front", NINE, true);
    act("a", { type: "attack", attackerUid: eren.uid });
    pick(act, "m:1");
    pick(act, "yes");
    pick(act);
    expect(a.sideline).toEqual([NINE, TITAN]); // the cards were already placed
    expect(b.front).toHaveLength(1);
    expect(game.pending?.kind).toBe("damage");
  });
});

describe("AOT-1-094 Eren Jaeger (Attack Titan)", () => {
  const prepare = (life = 7, phase: "main" | "attack" = "attack") => {
    const g = setup(phase);
    const eren = field(g.a, "front", N(94));
    g.a.life = g.a.life.slice(0, life);
    return { ...g, eren };
  };

  it("has Damage (2)", () => {
    const { act, eren } = prepare();
    refresh(act);
    expect(damageOf(ctx, eren)).toBe(2);
  });

  it("Activate: Main (front line, once per turn): sidelines up to one opposing front-line character with 2000 or less BP", () => {
    const { game, b, act, eren } = prepare(7, "main");
    const nine = field(b, "front", NINE);
    field(b, "front", GUARD);
    activate(act, eren, 1);
    expect(choice(game, "a").options).toEqual([nine.uid]);
    pick(act, nine.uid);
    expect(b.sideline).toEqual([NINE]);
    expect(() => activate(act, eren, 1)).toThrow("ONCE_PER_TURN");
  });

  it("Activate: Main needs the front line, and may choose nobody", () => {
    const g = prepare(7, "main");
    const back = field(g.a, "energy", N(94));
    expect(() => activate(g.act, back, 1)).toThrow("ABILITY_CONDITION");
    field(g.b, "front", NINE);
    activate(g.act, g.eren, 1);
    pick(g.act);
    expect(g.b.front).toHaveLength(1);
  });

  it("When Attacking, first option: gains Impact (1) until the end of the turn", () => {
    const { game, act, eren } = prepare();
    act("a", { type: "attack", attackerUid: eren.uid });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "m:0");
    expect(impactOf(ctx, eren)).toBe(1);
  });

  it("second option with 3 or less life: switches this character to active; once per turn, so the next attack asks nothing", () => {
    const g = prepare(3);
    g.act("a", { type: "attack", attackerUid: g.eren.uid });
    expect(g.eren.rested).toBe(true);
    pick(g.act, "m:1");
    expect(g.eren.rested).toBe(false);
    resolveDamage(g.act, g.b, 2); // Damage (2)
    g.act("a", { type: "attack", attackerUid: g.eren.uid });
    expect(g.game.pending?.kind).toBe("damage"); // no second question this turn
    expect(g.eren.rested).toBe(true);
  });

  it("second option with 4 or more life does nothing", () => {
    const g = prepare(4);
    g.act("a", { type: "attack", attackerUid: g.eren.uid });
    pick(g.act, "m:1");
    expect(g.eren.rested).toBe(true);
  });
});

describe("AOT-1-095 Basement", () => {
  const priced = (cost: number): EngineContext => ({
    card: (cardId) => { const card = ctx.card(cardId); return card && cardId === N(95) ? { ...card, energyCost: cost } : card; }
  });

  it("costs 《Red×2》 less while a <Key to the Basement> is in our sideline (the card data prints 0, so a priced copy shows it)", () => {
    const { game, a, b, players } = setup();
    expect(costOf(game, players, priced(4), "a", N(95)).energy).toBe(4);
    b.sideline.push(N(98)); // the opponent's sideline does not count
    expect(costOf(game, players, priced(4), "a", N(95)).energy).toBe(4);
    a.sideline.push(N(98));
    expect(costOf(game, players, priced(4), "a", N(95)).energy).toBe(2);
    expect(costOf(game, players, priced(1), "a", N(95)).energy).toBe(0);
    expect(costOf(game, players, ctx, "a", N(95)).energy).toBe(0);
  });

  it("When Played: draw a card, then place one card from the hand into the sideline", () => {
    const { game, a, act } = setup();
    a.hand.push(N(95), NINE);
    play(act, 0, "energy");
    expect(a.energy.map((card) => card.cardId)).toEqual([N(95)]);
    expect(a.hand).toHaveLength(2);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "h:0");
    expect(a.sideline).toEqual([NINE]);
    expect(a.hand).toEqual([FILLER]);
  });
});

describe("AOT-1-096 Hardened Punch", () => {
  const prepare = () => {
    const g = setup();
    const raided = field(g.a, "front", N(93));
    raided.under = [EREN0];
    const plain = field(g.a, "front", N(93));
    g.a.hand.push(N(96));
    return { ...g, raided, plain };
  };

  it("costs 1 AP less while a character with 'Eren Jaeger' in its name is on our field", () => {
    const { game, a, players } = setup();
    expect(costOf(game, players, ctx, "a", N(96)).ap).toBe(2);
    field(a, "energy", NINE);
    expect(costOf(game, players, ctx, "a", N(96)).ap).toBe(2);
    field(a, "energy", EREN0);
    expect(costOf(game, players, ctx, "a", N(96)).ap).toBe(1);
  });

  it("sidelines up to one 5000-or-less BP opposing front-line character, and marks one Raided Eren Jaeger (Attack Titan) of ours", () => {
    const { game, a, b, act, raided, plain } = prepare();
    const talulah = field(b, "front", TALULAH);
    field(b, "front", MON3TR);
    const ap = activeAp(a);
    useEvent(act);
    expect(activeAp(a)).toBe(ap - 1);
    expect([...choice(game, "a").options].sort()).toEqual([...b.front.map((card) => card.uid)].sort());
    pick(act, talulah.uid);
    expect(b.sideline).toEqual([TALULAH]);
    // Only the Raided one (a card under it) is offered, not the plain one.
    expect(choice(game, "a").options).toEqual([raided.uid]);
    pick(act, raided.uid);
    expect(flagsOf(raided)).toContain("specialTriggerToHand");
    expect(flagsOf(plain)).not.toContain("specialTriggerToHand");
    expect(a.sideline).toEqual([N(96)]);
  });

  it("choosing nobody on both questions is allowed", () => {
    const { game, a, b, act, raided } = prepare();
    field(b, "front", TALULAH);
    useEvent(act);
    pick(act);
    pick(act);
    expect(b.front).toHaveLength(1);
    expect(flagsOf(raided)).not.toContain("specialTriggerToHand");
    expect(game.pending).toBeNull();
  });

  it("the marked character is not sidelined by the opponent's Special Trigger; the trigger card goes to their hand instead", () => {
    const { game, a, b, act, raided } = prepare();
    const attacker = field(a, "front", NINE);
    useEvent(act); // the opponent has no front-line character: only the second question
    pick(act, raided.uid);
    act("a", { type: "next_phase" });
    b.life[0]!.cardId = N(99); // 《SPECIAL》 Choose one character on your opponent's front line and sideline it.
    act("a", { type: "attack", attackerUid: attacker.uid });
    const lifeId = b.life[0]!.id;
    act("a", { type: "damage", lifeIds: [lifeId] });
    act("b", { type: "trigger", lifeId, activate: true, targetUid: raided.uid });
    expect(a.front.map((card) => card.uid)).toContain(raided.uid);
    expect(b.hand).toContain(N(99));
    expect(b.sideline).not.toContain(N(99));
    expect(game.pending).toBeNull();
  });

  it("an unmarked character is sidelined by that Special Trigger as usual", () => {
    const { a, b, act, plain } = prepare();
    const attacker = field(a, "front", NINE);
    void plain;
    act("a", { type: "next_phase" });
    b.life[0]!.cardId = N(99);
    act("a", { type: "attack", attackerUid: attacker.uid });
    const lifeId = b.life[0]!.id;
    act("a", { type: "damage", lifeIds: [lifeId] });
    act("b", { type: "trigger", lifeId, activate: true, targetUid: plain.uid });
    expect(a.front.map((card) => card.uid)).not.toContain(plain.uid);
    expect(b.sideline).toContain(N(99));
    expect(b.hand).not.toContain(N(99));
  });
});

describe("AOT-1-097 Dedicate Your Heart!!", () => {
  it("switches up to two of our AP cards to active (choosing fewer is allowed)", () => {
    const { game, a, act } = setup();
    a.ap.forEach((card) => { card.rested = true; });
    a.hand.push(N(97), N(97));
    // Paying the event's own AP needs an active AP card.
    a.ap[2]!.rested = false;
    useEvent(act);
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, "ap:a:ap0", "ap:a:ap1");
    expect(activeAp(a)).toBe(2);
    a.ap.forEach((card) => { card.rested = true; });
    a.ap[0]!.rested = false;
    useEvent(act);
    pick(act, "ap:a:ap1");
    expect(activeAp(a)).toBe(1);
    a.ap.forEach((card) => { card.rested = true; });
    a.ap[2]!.rested = false;
    a.hand.push(N(97));
    useEvent(act);
    expect(() => pick(act, "ap:a:ap2", "ap:a:ap0", "ap:a:ap1")).toThrow("INVALID_CHOICE"); // at most two
  });
});

describe("AOT-1-098 Key to the Basement", () => {
  const deck = [NINE, N(93), N(95), EREN0, GUARD];
  const use = (cards: string[]) => {
    const g = setup();
    topOfDeck(g.a, cards);
    g.a.hand.push(N(98));
    g.a.ap[1]!.rested = true;
    g.a.ap[2]!.rested = true;
    useEvent(g.act);
    return g;
  };

  it("offers <Basement> and [Inheritor of the Titan] cards among the top five; a revealed card with 6+ base required energy lets us activate an AP card", () => {
    const { game, a, act } = use(deck);
    expect([...choice(game, "a").options].sort()).toEqual(["l:1", "l:2", "l:3"]);
    pick(act, "l:1"); // Eren Jaeger (Attack Titan), cost 6
    keepOrder(game, act);
    expect(a.hand).toEqual([N(93)]);
    expect(names(a.library.slice(-4))).toEqual(names([NINE, N(95), EREN0, GUARD]));
    expect(activeAp(a)).toBe(0);
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, "ap:a:ap1");
    expect(activeAp(a)).toBe(1);
  });

  it("a revealed card with less than 6 required energy gives no AP question", () => {
    const { game, a, act } = use(deck);
    pick(act, "l:3"); // Eren Jaeger (cost 0, Inheritor of the Titan)
    keepOrder(game, act);
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([EREN0]);
    expect(activeAp(a)).toBe(0);
  });

  it("<Basement> (printed cost 0) can be revealed too; revealing nothing is allowed and gives no AP", () => {
    const { game, a, act } = use(deck);
    pick(act, "l:2");
    keepOrder(game, act);
    expect(a.hand).toEqual([N(95)]);
    expect(game.pending).toBeNull();

    const none = use(deck);
    pick(none.act);
    keepOrder(none.game, none.act);
    expect(none.game.pending).toBeNull();
    expect(none.a.hand).toEqual([]);
    expect(activeAp(none.a)).toBe(0);
  });
});

describe("AOT-1-099 Omni-Directional Mobility Gear", () => {
  it("draws two cards, then plays up to two red [104th Cadet Corps] cards (<=3 energy, 1 AP) from the hand set to active; they return to the hand at the end of the attack phase", () => {
    const { game, a, act } = setup();
    const library = a.library.length;
    a.hand.push(N(99), JEAN0, MIKASA0, NINE, GUARD);
    useEvent(act);
    expect(a.library).toHaveLength(library - 2);
    // 九 is not a cadet, the Guard is blue.
    expect([...choice(game, "a").options].sort()).toEqual(["h:0", "h:1"]);
    pick(act, "h:0");
    expect([...choice(game, "a").options]).toEqual(["h:0"]); // the second question: Mikasa is the only one left
    pick(act, "h:0");
    expect(a.front.map((card) => card.cardId)).toEqual([JEAN0, MIKASA0]);
    expect(a.front.every((card) => !card.rested)).toBe(true);
    expect(a.hand).toEqual([NINE, GUARD, FILLER, FILLER]);
    act("a", { type: "next_phase" });
    act("a", { type: "next_phase" });
    // Both characters have the ability: the player picks which resolves first.
    expect(choice(game, "a").purpose).toBe("order");
    pick(act, choice(game, "a").options[0]!);
    expect(a.front).toEqual([]);
    expect(a.hand).toEqual(expect.arrayContaining([JEAN0, MIKASA0]));
  });

  it("'up to two': both may be declined; a third card is not played", () => {
    const { game, a, act } = setup();
    a.hand.push(N(99), JEAN0, MIKASA0, N(86));
    useEvent(act);
    pick(act);
    pick(act);
    expect(a.front).toEqual([]);
    expect(game.pending).toBeNull();

    const two = setup();
    two.a.hand.push(N(99), JEAN0, MIKASA0, CONNY);
    useEvent(two.act);
    pick(two.act, "h:0");
    pick(two.act, "h:0");
    expect(two.a.front).toHaveLength(2);
    expect(two.game.pending).toBeNull();
    expect(two.a.hand).toContain(CONNY);
  });

  it("only cards with 3 or less required energy and 1 AP qualify", () => {
    const { game, a, act } = setup();
    a.hand.push(N(99), N(89), N(92), N(87)); // cost 4, cost 4, cost 2 (only Mikasa 087 qualifies)
    useEvent(act);
    expect(choice(game, "a").options).toContain("h:2");
    expect(choice(game, "a").options).not.toContain("h:0");
    expect(choice(game, "a").options).not.toContain("h:1");
  });
});

describe("AOT-1-100 A Steamed Potato, Sir!", () => {
  it("places up to three cards from the hand on the bottom of the deck in the order picked, draws as many, then may switch one AP card to active", () => {
    const { game, a, act } = setup();
    a.hand.push(N(100), NINE, GUARD, TALULAH, MON3TR);
    const library = [...a.library];
    useEvent(act);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1", "h:2", "h:3"]);
    pick(act, "h:2", "h:0");
    expect(a.library.slice(-2)).toEqual([TALULAH, NINE]);
    expect(a.library).toHaveLength(library.length); // two placed, two drawn
    expect(a.hand).toEqual([GUARD, MON3TR, library[0], library[1]]);
    expect(activeAp(a)).toBe(2);
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, "ap:a:ap0");
    expect(activeAp(a)).toBe(3);
  });

  it("placing nothing draws nothing; at most three cards", () => {
    const { game, a, act } = setup();
    a.hand.push(N(100), NINE, GUARD, TALULAH, MON3TR);
    useEvent(act);
    expect(() => pick(act, "h:0", "h:1", "h:2", "h:3")).toThrow("INVALID_CHOICE");
    pick(act);
    expect(a.hand).toHaveLength(4);
    pick(act);
    expect(game.pending).toBeNull();
  });
});

describe("UE10ST/AOT-1-068 Carla Jaeger", () => {
  it("Activate: Main, switch to resting, once per turn: gains 《Red》 energy generation this turn; sidelined at the end of the main phase", () => {
    const { game, a, act } = setup();
    const carla = field(a, "energy", ST(68));
    expect(energyOf(ctx, a, "red")).toBe(1);
    activate(act, carla, 0);
    expect(carla.rested).toBe(true);
    expect(energyOf(ctx, a, "red")).toBe(2);
    expect(() => activate(act, carla, 0)).toThrow();
    act("a", { type: "next_phase" });
    expect(game.pending).toBeNull();
    expect(a.energy).toHaveLength(0);
    expect(a.sideline).toEqual([ST(68)]);
  });

  it("stays on the field if not activated", () => {
    const { a, act } = setup();
    field(a, "energy", ST(68));
    act("a", { type: "next_phase" });
    expect(a.energy).toHaveLength(1);
  });
});
