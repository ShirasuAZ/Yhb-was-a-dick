/**
 * AOT (进击的巨人) batch 2, UE10BT/AOT-1-036 … 069: one test (or more) per card, set up as the printed English text describes and
 * checked against it. Cards are addressed by card number (the image-free catalog); the text in `cards.json` is the source of truth.
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, damageOf, energyOf, flagsOf, hasKeyword, impactOf, type EngineGame } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import type { UnionArenaAction } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";

const N = (n: number): string => `UE10BT/AOT-1-${String(n).padStart(3, "0")}`;
/** Green energy: 3 per card (Reiner Braun 060, whose only ability is a 登场时 one; placed straight on the field here). */
const GREEN3 = N(60);
// Helper cards without abilities (Arknights).
const NINE = "UC01BT/ARK-1-088"; // 九: red, cost 0, BP2000, makes 1 red energy
const KINGSLAYER = "UC01BT/ARK-1-004"; // yellow, cost 0, BP1500
const GUARD = "UC01ST/ARK-1-103"; // Guard: cost 3, BP3000
const MON3TR = "UC01BT/ARK-1-054"; // cost 7, BP4500
const TALULAH = "UC01ST/ARK-1-110"; // cost 5, BP4000
const TEXAS = "UC01BT/ARK-1-074"; // 德克萨斯: cost 1, BP2500
const ZEKE0 = N(45); // Zeke Jaeger (cost 0, Marleyan Warrior／Inheritor of the Titan, no ability text)
const PEERING = N(42); // Pure Titan, cost 0, BP2000
const BEARDED = N(43); // Pure Titan, cost 1, BP2500
const REISS = N(37); // Rod Reiss, cost 0, BP500
const REINER0 = N(58); // Reiner Braun, cost 0, no ability text

type Act = (who: string, action: UnionArenaAction) => void;
const play = (act: Act, handIndex = 0, line: "front" | "energy" = "front"): void => act("a", { type: "play", handIndex, line });
const pick = (act: Act, ...picks: string[]): void => act("a", { type: "choose", picks });
const useEvent = (act: Act, handIndex = 0): void => act("a", { type: "event", handIndex });
/** Answers an ordered "put the rest on the bottom" question with the options as they are listed. */
const keepOrder = (game: EngineGame, act: Act): void => { const options = [...choice(game, "a").options]; pick(act, ...options); };
const activeAp = (owner: { ap: Array<{ rested: boolean }> }): number => owner.ap.filter((card) => !card.rested).length;
const sidelineManually = (act: Act, uid: string): void => act("a", { type: "manual", manual: { op: "field", owner: "you", uid, act: "sideline" } });

describe("cards with no ability text", () => {
  it.each([42, 43, 45, 58])("AOT-1-%i has no ability text and the engine plays it by itself", (n) => {
    expect(titleCard(N(n)).stats.abilityText).toBe("-");
    expect(isAutomated(titleCard(N(n)))).toBe(true);
  });
});

describe("AOT-1-036 Kenny Ackermann", () => {
  it("first ability: only on the turn he is played; sidelines an opponent front-line character with BP equal to or less than his; once per turn", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GREEN3);
    const nine = field(b, "front", NINE);
    const guard = field(b, "front", GUARD);
    const mon3tr = field(b, "front", MON3TR);
    a.hand.push(N(36));
    play(act);
    const kenny = a.front[0]!;
    expect(game.pending).toBeNull();
    act("a", { type: "activate", uid: kenny.uid, ability: 0 });
    // BP 3000: the 4500 character is not offered.
    expect([...choice(game, "a").options].sort()).toEqual([nine.uid, guard.uid].sort());
    expect(choice(game).options).not.toContain(mon3tr.uid);
    pick(act, guard.uid);
    expect(b.sideline).toEqual([GUARD]);
    expect(b.front.map((card) => card.cardId)).toEqual([NINE, MON3TR]);
    expect(() => act("a", { type: "activate", uid: kenny.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });

  it("first ability: cannot be activated when he was not played this turn", () => {
    const { game, a, b, act } = setup();
    const kenny = field(a, "front", N(36));
    field(b, "front", NINE);
    expect(() => act("a", { type: "activate", uid: kenny.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    expect(b.front).toHaveLength(1);
    expect(game.pending).toBeNull();
  });

  it("first ability: compares with his current BP, so the second ability can raise him to a target's BP", () => {
    const { a, b, act } = setup();
    energy(a, 2, GREEN3);
    const talulah = field(b, "front", TALULAH); // BP4000
    a.hand.push(N(36), KINGSLAYER, KINGSLAYER);
    play(act);
    const kenny = a.front[0]!;
    // +1000 BP from the second ability (discarding a card from the hand) -> exactly 4000.
    act("a", { type: "activate", uid: kenny.uid, ability: 1 });
    pick(act, "h:0");
    expect(bpOf(ctx, kenny)).toBe(4000);
    act("a", { type: "activate", uid: kenny.uid, ability: 0 });
    expect(b.front).toEqual([]);
    expect(b.sideline).toEqual([talulah.cardId]);
  });

  it("first ability: with no character of low enough BP nothing is sidelined", () => {
    const { a, b, act } = setup();
    energy(a, 2, GREEN3);
    field(b, "front", TALULAH);
    a.hand.push(N(36));
    play(act);
    act("a", { type: "activate", uid: a.front[0]!.uid, ability: 0 });
    expect(b.front).toHaveLength(1);
    expect(b.sideline).toEqual([]);
  });

  it("second ability: place 1 card from hand into the sideline as the cost; +1000 BP; can be repeated; needs a card in hand", () => {
    const { game, a, act } = setup();
    const kenny = field(a, "front", N(36));
    expect(() => act("a", { type: "activate", uid: kenny.uid, ability: 1 })).toThrow("ABILITY_COST");
    a.hand.push(NINE, KINGSLAYER);
    act("a", { type: "activate", uid: kenny.uid, ability: 1 });
    pick(act, "h:0");
    expect(a.sideline).toEqual([NINE]);
    expect(bpOf(ctx, kenny)).toBe(4000);
    act("a", { type: "activate", uid: kenny.uid, ability: 1 });
    expect(game.pending).toBeNull();
    expect(a.sideline).toEqual([NINE, KINGSLAYER]);
    expect(bpOf(ctx, kenny)).toBe(5000);
  });
});

describe("AOT-1-037 Rod Reiss", () => {
  it("When Played: up to one other character on the field gains 1000 BP", () => {
    const { game, a, act } = setup();
    const nine = field(a, "front", NINE);
    a.hand.push(REISS);
    play(act);
    expect(choice(game, "a").options).toEqual([nine.uid]); // not Rod Reiss himself
    pick(act, nine.uid);
    expect(bpOf(ctx, nine)).toBe(3000);
    expect(bpOf(ctx, a.front[1]!)).toBe(500);
  });

  it("When Played: 'up to' lets the player choose nobody", () => {
    const { game, a, act } = setup();
    const nine = field(a, "front", NINE);
    a.hand.push(REISS);
    play(act);
    choice(game, "a");
    pick(act);
    expect(bpOf(ctx, nine)).toBe(2000);
    expect(game.pending).toBeNull();
  });
});

describe("AOT-1-038 Rod Reiss (Titan)", () => {
  it("During Your Turn: +2000 BP, and Damage (2) while an opponent front-line character is active", () => {
    const { game, a, b, act } = setup();
    const titan = field(a, "front", N(38));
    const foe = field(b, "front", NINE);
    act("a", { type: "next_phase" }); // refreshes the continuous effects
    expect(bpOf(ctx, titan)).toBe(6000);
    expect(damageOf(ctx, titan)).toBe(2);
    foe.rested = true;
    act("a", { type: "end_turn" }); // refreshes again; it is the opponent's turn now
    expect(game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, titan)).toBe(4000);
    expect(damageOf(ctx, titan)).toBe(1);
  });

  it("During Your Turn: no Damage (2) when every opponent front-line character is resting (or there is none)", () => {
    const { a, b, act } = setup();
    const titan = field(a, "front", N(38));
    field(b, "front", NINE, true);
    field(b, "energy", NINE); // an active character on the energy line does not count
    act("a", { type: "next_phase" });
    expect(bpOf(ctx, titan)).toBe(6000);
    expect(damageOf(ctx, titan)).toBe(1);
  });

  it("When Sidelined: draw a card", () => {
    const { a, act } = setup();
    const titan = field(a, "front", N(38));
    sidelineManually(act, titan.uid);
    expect(a.sideline).toEqual([N(38)]);
    expect(a.hand).toHaveLength(1);
    expect(a.library).toHaveLength(29);
  });

  it("Raid <Rod Reiss>: raids onto Rod Reiss", () => {
    const { a, act } = setup();
    energy(a, 2, GREEN3);
    const reiss = field(a, "energy", REISS, true);
    a.hand.push(N(38));
    act("a", { type: "raid", handIndex: 0, targetUid: reiss.uid });
    expect(reiss.cardId).toBe(N(38));
    expect(reiss.rested).toBe(false);
    expect(reiss.under).toEqual([REISS]);
  });
});

describe("AOT-1-039 Cart Titan", () => {
  it("When Played: returns another character with 1 or less required energy to the hand", () => {
    const { a, act } = setup();
    energy(a, 1, GREEN3);
    field(a, "front", TEXAS);
    field(a, "front", GUARD); // cost 3: not offered
    a.hand.push(N(39));
    play(act);
    expect(a.hand).toEqual([TEXAS]);
    expect(a.front.map((card) => card.cardId)).toEqual([GUARD, N(39)]);
  });

  it("When Played: with no such character, this character returns to the hand", () => {
    const { a, act } = setup();
    energy(a, 1, GREEN3);
    field(a, "front", GUARD);
    a.hand.push(N(39));
    play(act);
    expect(a.hand).toEqual([N(39)]);
    expect(a.front.map((card) => card.cardId)).toEqual([GUARD]);
  });

  it("When Played: with several candidates the player picks", () => {
    const { game, a, act } = setup();
    energy(a, 1, GREEN3);
    const nine = field(a, "front", NINE);
    field(a, "front", TEXAS);
    a.hand.push(N(39));
    play(act);
    expect(choice(game, "a").options).toHaveLength(2);
    pick(act, nine.uid);
    expect(a.hand).toEqual([NINE]);
    expect(a.front.map((card) => card.cardId)).toEqual([TEXAS, N(39)]);
  });
});

describe("AOT-1-040 Pure Titan (Small Titan)", () => {
  it("When Played: draw a card", () => {
    const { a, act } = setup();
    energy(a, 1, GREEN3);
    a.hand.push(N(40));
    play(act);
    expect(a.hand).toHaveLength(1);
    expect(a.library).toHaveLength(29);
  });
});

describe("AOT-1-041 Pure Titans (Zeke's Titans)", () => {
  it("When Played: draw a card, then place one card from the hand into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1, GREEN3);
    a.hand.push(N(41), NINE, TEXAS);
    play(act);
    expect(a.hand).toHaveLength(3); // NINE, TEXAS and the drawn card
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, "h:1");
    expect(a.sideline).toEqual([TEXAS]);
    expect(a.hand).toHaveLength(2);
  });
});

describe("AOT-1-046 Zeke Jaeger", () => {
  it("Activate: Main, switch to resting: a [Pure Titan] affinity card on the field gains 1000 BP", () => {
    const { game, a, act } = setup();
    const zeke = field(a, "front", N(46));
    const titan = field(a, "front", PEERING);
    const nine = field(a, "energy", NINE);
    act("a", { type: "activate", uid: zeke.uid, ability: 0 });
    expect(zeke.rested).toBe(true);
    // Only the Pure Titan card is a legal target (the only option is taken automatically).
    expect(game.pending).toBeNull();
    expect(bpOf(ctx, titan)).toBe(3000);
    expect(bpOf(ctx, nine)).toBe(2000);
    expect(() => act("a", { type: "activate", uid: zeke.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("Activate: Main: with several [Pure Titan] cards the player picks one", () => {
    const { game, a, act } = setup();
    const zeke = field(a, "front", N(46));
    const first = field(a, "front", PEERING);
    const second = field(a, "energy", BEARDED);
    act("a", { type: "activate", uid: zeke.uid, ability: 0 });
    expect([...choice(game, "a").options].sort()).toEqual([first.uid, second.uid].sort());
    pick(act, second.uid);
    expect(bpOf(ctx, second)).toBe(3500);
    expect(bpOf(ctx, first)).toBe(2000);
  });
});

describe("AOT-1-047 Zeke Jaeger", () => {
  it("During Your Turn: +1500 BP with three or more [Pure Titan] cards on the field", () => {
    const two = setup();
    const zeke2 = field(two.a, "front", N(47));
    field(two.a, "front", PEERING);
    field(two.a, "energy", PEERING);
    field(two.a, "front", ZEKE0); // not a Pure Titan
    two.act("a", { type: "next_phase" });
    expect(bpOf(ctx, zeke2)).toBe(2500);

    const { a, act } = setup();
    const zeke = field(a, "front", N(47));
    field(a, "front", PEERING);
    field(a, "energy", PEERING);
    field(a, "energy", BEARDED);
    act("a", { type: "next_phase" });
    expect(bpOf(ctx, zeke)).toBe(4000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, zeke)).toBe(2500); // not during the opponent's turn
  });

  it("When Played: plays a card with 2 or less required energy, 1 AP cost and [Pure Titan] affinity from the hand, resting", () => {
    const { game, a, act } = setup();
    energy(a, 1, GREEN3);
    // BEARDED costs 1, AP 1 (offered); N(49) costs 3 (not offered); NINE is not a Pure Titan.
    a.hand.push(N(47), BEARDED, N(49), NINE);
    play(act);
    expect(choice(game, "a").options).toEqual(["h:0"]);
    pick(act, "h:0");
    pick(act, "line:energy");
    expect(a.energy[a.energy.length - 1]!.cardId).toBe(BEARDED);
    expect(a.energy[a.energy.length - 1]!.rested).toBe(true);
    expect(a.hand).toEqual([N(49), NINE]);
    expect(activeAp(a)).toBe(2); // only the Zeke's AP was paid
  });

  it("When Played: the player may play nothing", () => {
    const { a, act } = setup();
    energy(a, 1, GREEN3);
    a.hand.push(N(47), BEARDED);
    play(act);
    pick(act);
    expect(a.hand).toEqual([BEARDED]);
    expect(a.energy.filter((card) => card.cardId === BEARDED)).toEqual([]);
  });
});

describe("AOT-1-048 Zeke Jaeger (Beast Titan)", () => {
  it("required energy is reduced by 1 for each [Pure Titan] card on the field while in the hand", () => {
    const { game, players, a } = setup();
    expect(costOf(game, players, ctx, "a", N(48)).energy).toBe(7);
    field(a, "front", PEERING);
    field(a, "energy", BEARDED);
    field(a, "energy", ZEKE0); // not a Pure Titan
    expect(costOf(game, players, ctx, "a", N(48)).energy).toBe(5);
    field(a, "energy", N(49)); // "Pure Titan／Abnormal Titan" counts too
    expect(costOf(game, players, ctx, "a", N(48)).energy).toBe(4);
  });

  it("Raid <Zeke Jaeger>; When Played: all [Pure Titan] cards on the field gain 1000 BP", () => {
    const { a, act } = setup();
    energy(a, 2, GREEN3); // 6 green; the Raid costs 7 - 2
    const titan1 = field(a, "front", PEERING);
    const titan2 = field(a, "energy", BEARDED);
    const nine = field(a, "front", NINE);
    const zeke = field(a, "front", ZEKE0, true);
    a.hand.push(N(48));
    act("a", { type: "raid", handIndex: 0, targetUid: zeke.uid });
    expect(zeke.cardId).toBe(N(48));
    expect(zeke.rested).toBe(false);
    expect(bpOf(ctx, titan1)).toBe(3000);
    expect(bpOf(ctx, titan2)).toBe(3500);
    expect(bpOf(ctx, nine)).toBe(2000);
  });

  it("Activate: Main, once per turn: a [Pure Titan] card gains Impact (1); on the front line all [Pure Titan] cards gain 1000 BP", () => {
    const { game, a, act } = setup();
    const zeke = field(a, "front", N(48));
    const titan1 = field(a, "front", PEERING);
    const titan2 = field(a, "energy", BEARDED);
    act("a", { type: "activate", uid: zeke.uid, ability: 2 });
    expect([...choice(game, "a").options].sort()).toEqual([titan1.uid, titan2.uid].sort());
    pick(act, titan2.uid);
    expect(impactOf(ctx, titan2)).toBe(1);
    expect(impactOf(ctx, titan1)).toBe(0);
    expect(bpOf(ctx, titan1)).toBe(3000);
    expect(bpOf(ctx, titan2)).toBe(3500);
    expect(bpOf(ctx, zeke)).toBe(4000);
    expect(() => act("a", { type: "activate", uid: zeke.uid, ability: 2 })).toThrow("ONCE_PER_TURN");
  });

  it("Activate: Main: on the energy line only the Impact is given; choosing nobody is allowed", () => {
    const { game, a, act } = setup();
    const zeke = field(a, "energy", N(48));
    const titan = field(a, "front", PEERING);
    act("a", { type: "activate", uid: zeke.uid, ability: 2 });
    choice(game, "a");
    pick(act, titan.uid);
    expect(impactOf(ctx, titan)).toBe(1);
    expect(bpOf(ctx, titan)).toBe(2000);

    const second = setup();
    const other = field(second.a, "front", PEERING);
    const zeke2 = field(second.a, "front", N(48));
    second.act("a", { type: "activate", uid: zeke2.uid, ability: 2 });
    pick(second.act);
    expect(impactOf(ctx, other)).toBe(0);
    expect(bpOf(ctx, other)).toBe(3000); // zeke2 is on the front line: the BP still comes
  });
});

describe("AOT-1-049 Pure Titan (Relaxing Titan)", () => {
  it("When Sidelined: plays a card with 2 or less required energy, 1 AP cost and [Pure Titan] affinity from the hand, resting", () => {
    const { game, a, act } = setup();
    const relaxing = field(a, "front", N(49));
    a.hand.push(BEARDED, PEERING, N(49), NINE); // BEARDED, PEERING are offered; the second Relaxing Titan costs 3
    sidelineManually(act, relaxing.uid);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "h:1");
    pick(act, "line:front");
    const played = a.front[a.front.length - 1]!;
    expect(played.cardId).toBe(PEERING);
    expect(played.rested).toBe(true);
    expect(a.hand).toEqual([BEARDED, N(49), NINE]);
    expect(a.sideline).toEqual([N(49)]);
  });
});

describe("AOT-1-050 Annie Leonhart", () => {
  it("When Played: draw a card, then place one card from the hand into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1, GREEN3);
    a.hand.push(N(50), NINE);
    play(act);
    expect(choice(game, "a").options).toHaveLength(2);
    pick(act, "h:0");
    expect(a.sideline).toEqual([NINE]);
    expect(a.hand).toHaveLength(1);
    expect(a.library).toHaveLength(29);
  });
});

describe("AOT-1-051 Annie Leonhart", () => {
  it("When Played: looks at 3, adds a [Marleyan Warrior] / [Pure Titan] card, rest to the bottom in order, then places a card from the hand into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1, GREEN3);
    a.library = [NINE, ZEKE0, KINGSLAYER, ...a.library.slice(3)];
    a.hand.push(N(51), TEXAS);
    play(act);
    expect(choice(game, "a").options).toEqual(["l:1"]); // only Zeke Jaeger (Marleyan Warrior)
    pick(act, "l:1");
    const rest = [...choice(game, "a").options];
    expect(rest).toHaveLength(2);
    pick(act, rest[1]!, rest[0]!); // KINGSLAYER first, then NINE
    expect(a.hand).toEqual([TEXAS, ZEKE0]);
    expect(choice(game, "a").options).toHaveLength(2);
    pick(act, "h:0");
    expect(a.sideline).toEqual([TEXAS]);
    expect(a.library.slice(-2)).toEqual([KINGSLAYER, NINE]);
    expect(a.library).toHaveLength(29);
  });

  it("When Played: a [Pure Titan] card also qualifies; adding nothing means no discard", () => {
    const { game, a, act } = setup();
    energy(a, 1, GREEN3);
    a.library = [PEERING, NINE, KINGSLAYER, ...a.library.slice(3)];
    a.hand.push(N(51), TEXAS);
    play(act);
    expect(choice(game, "a").options).toEqual(["l:0"]);
    pick(act); // up to one: none
    keepOrder(game, act);
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([TEXAS]);
    expect(a.sideline).toEqual([]);
    expect(a.library.slice(-3)).toEqual([PEERING, NINE, KINGSLAYER]);
  });
});

describe("AOT-1-052 Annie Leonhart", () => {
  it("If active, it gains Green energy generation", () => {
    const active = setup();
    field(active.a, "energy", N(52));
    active.act("a", { type: "next_phase" });
    expect(energyOf(ctx, active.a, "green")).toBe(2);
    const resting = setup();
    field(resting.a, "energy", N(52), true);
    resting.act("a", { type: "next_phase" });
    expect(energyOf(ctx, resting.a, "green")).toBe(1);
  });
});

describe("AOT-1-053 Annie Leonhart (Female Titan)", () => {
  it("If on the Front Line: a [Marleyan Warrior] card performing Raid from the hand costs 1 less (only then)", () => {
    const { game, players, a, act } = setup();
    const female = field(a, "energy", N(53));
    act("a", { type: "next_phase" });
    expect(costOf(game, players, ctx, "a", N(61), true).energy).toBe(7); // on the energy line: no effect
    a.energy.splice(a.energy.indexOf(female), 1);
    a.front.push(female);
    act("a", { type: "next_phase" }); // refreshes (the attack phase begins; the cost is read at any time)
    expect(costOf(game, players, ctx, "a", N(61), true).energy).toBe(6); // Reiner Braun (Armored Titan): Marleyan Warrior
    expect(costOf(game, players, ctx, "a", N(61)).energy).toBe(7); // played normally: no reduction
    expect(costOf(game, players, ctx, "a", N(38), true).energy).toBe(4); // Rod Reiss (Titan) has no [Marleyan Warrior] affinity
  });

  it("If on the Front Line: lets a Raid be paid with one energy less", () => {
    const { a, act } = setup();
    energy(a, 2, GREEN3); // 6 green
    const reiner = field(a, "front", REINER0, true);
    a.hand.push(N(61));
    expect(() => act("a", { type: "raid", handIndex: 0, targetUid: reiner.uid })).toThrow("NOT_ENOUGH_ENERGY");
    field(a, "front", N(53));
    act("a", { type: "raid", handIndex: 0, targetUid: reiner.uid });
    expect(reiner.cardId).toBe(N(61));
    expect(reiner.under).toEqual([REINER0]);
  });

  it("When Played: plays a green character card with 3 or less required energy and 1 AP cost from the hand, resting", () => {
    const { game, a, act } = setup();
    energy(a, 2, GREEN3);
    // Offered: Zeke's Titans (cost 2). Not offered: Rod Reiss (Titan) cost 4, 九 (red), Kenny (AP 2).
    a.hand.push(N(53), N(41), N(38), NINE, N(36));
    // The Female Titan is played by raiding onto Annie Leonhart (cost 5 => 6 energy is enough).
    const annie = field(a, "front", N(50), true);
    act("a", { type: "raid", handIndex: 0, targetUid: annie.uid });
    expect(choice(game, "a").options).toEqual(["h:0"]);
    pick(act, "h:0");
    pick(act, "line:energy");
    const played = a.energy[a.energy.length - 1]!;
    expect(played.cardId).toBe(N(41));
    expect(played.rested).toBe(true);
  });

  it("When Sidelined: returns up to one base card of this Raided character to the hand", () => {
    const { game, a, act } = setup();
    energy(a, 2, GREEN3);
    const annie = field(a, "front", N(50), true);
    a.hand.push(N(53));
    act("a", { type: "raid", handIndex: 0, targetUid: annie.uid });
    expect(game.pending).toBeNull();
    sidelineManually(act, annie.uid);
    expect(a.sideline).toEqual([N(50), N(53)]);
    expect(choice(game, "a").options).toEqual(["s:0"]);
    pick(act, "s:0");
    expect(a.hand).toEqual([N(50)]);
    expect(a.sideline).toEqual([N(53)]);
  });

  it("When Sidelined: 'up to one' allows none, and a character that was not Raided has no base card", () => {
    const first = setup();
    energy(first.a, 2, GREEN3);
    const annie = field(first.a, "front", N(50), true);
    first.a.hand.push(N(53));
    first.act("a", { type: "raid", handIndex: 0, targetUid: annie.uid });
    sidelineManually(first.act, annie.uid);
    choice(first.game, "a");
    pick(first.act);
    expect(first.a.hand).toEqual([]);
    expect(first.a.sideline).toEqual([N(50), N(53)]);

    const second = setup();
    second.a.sideline.push(N(50));
    const plain = field(second.a, "front", N(53));
    sidelineManually(second.act, plain.uid);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([]);
  });
});

describe("AOT-1-054 Bertholdt Hoover", () => {
  it("Activate: Main, switch to resting, once per turn: gains Green energy generation; sidelined at the end of the main phase", () => {
    const { game, a, act } = setup();
    const bertholdt = field(a, "energy", N(54));
    expect(energyOf(ctx, a, "green")).toBe(1);
    act("a", { type: "activate", uid: bertholdt.uid, ability: 0 });
    expect(bertholdt.rested).toBe(true);
    expect(energyOf(ctx, a, "green")).toBe(2);
    expect(() => act("a", { type: "activate", uid: bertholdt.uid, ability: 0 })).toThrow();
    act("a", { type: "next_phase" });
    expect(game.phase).toBe("attack");
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([N(54)]);
    expect(energyOf(ctx, a, "green")).toBe(0);
  });
});

describe("AOT-1-055 Bertholdt Hoover", () => {
  it("When Played: draws a card if you have 6 or more energy generation", () => {
    const { a, act } = setup();
    energy(a, 2, GREEN3); // 6
    a.hand.push(N(55));
    play(act);
    expect(a.hand).toHaveLength(1);
    expect(a.library).toHaveLength(29);
  });

  it("When Played: no card with 5 or less energy generation", () => {
    const { a, act } = setup();
    energy(a, 1, GREEN3); // 3
    field(a, "energy", NINE); // +1 red: 4 in all
    field(a, "energy", NINE); // 5
    a.hand.push(N(55));
    play(act);
    expect(a.hand).toEqual([]);
    expect(a.library).toHaveLength(30);
  });
});

describe("AOT-1-056 Bertholdt Hoover", () => {
  it("generates energy even if it is on the front line, while another front-line character makes none", () => {
    const { a, act } = setup();
    const bertholdt = field(a, "front", N(56));
    field(a, "front", N(54)); // an ordinary character on the front line makes nothing
    act("a", { type: "next_phase" });
    expect(flagsOf(bertholdt)).toContain("energyOnFront");
    expect(energyOf(ctx, a, "green")).toBe(1);
    const plain = setup();
    field(plain.a, "front", N(54));
    plain.act("a", { type: "next_phase" });
    expect(energyOf(ctx, plain.a, "green")).toBe(0);
  });
});

describe("AOT-1-059 Reiner Braun", () => {
  it("gains 1000 BP while you have 6 or more energy generation (at any time)", () => {
    const { a, act } = setup();
    const reiner = field(a, "front", N(59));
    energy(a, 1, GREEN3);
    act("a", { type: "next_phase" });
    expect(bpOf(ctx, reiner)).toBe(3000);
    energy(a, 1, GREEN3); // 6
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, reiner)).toBe(4000); // also during the opponent's turn
  });
});

describe("AOT-1-060 Reiner Braun", () => {
  it("When Played: draw two cards, then place one card from the hand into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 2, GREEN3);
    a.hand.push(N(60), NINE);
    play(act);
    expect(a.hand).toHaveLength(3);
    expect(a.library).toHaveLength(28);
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, "h:0");
    expect(a.sideline).toEqual([NINE]);
    expect(a.hand).toHaveLength(2);
  });
});

describe("AOT-1-061 Reiner Braun (Armored Titan)", () => {
  it("has Impact (1) and Nullify Impact, and Raid <Reiner Braun>", () => {
    const { a, act } = setup();
    const reiner = field(a, "front", REINER0);
    energy(a, 3, GREEN3);
    a.hand.push(N(61));
    act("a", { type: "raid", handIndex: 0, targetUid: reiner.uid });
    expect(reiner.cardId).toBe(N(61));
    expect(impactOf(ctx, reiner)).toBe(1);
    expect(hasKeyword(ctx, reiner, "冲击无效")).toBe(true);
    expect(damageOf(ctx, reiner)).toBe(1);
  });

  it("During Opponent's Turn: the opponent's event cannot choose it without paying 1 AP (it is paid when chosen)", () => {
    const { game, a, b, act } = setup();
    const reiner = field(b, "front", N(61));
    field(a, "front", ZEKE0); // 5000 or less BP
    a.hand.push(N(66));
    useEvent(act);
    // Reiner is the only candidate: chosen automatically, and 1 AP is paid on top of the event's 1 AP.
    expect(game.pending).toBeNull();
    expect(b.sideline).toEqual([N(61)]);
    expect(b.front).not.toContain(reiner);
    expect(activeAp(a)).toBe(1);
  });

  it("During Opponent's Turn: without an active AP card it cannot be chosen at all", () => {
    const { a, b, act } = setup();
    a.ap = [{ id: "a:ap0", rested: false }];
    field(b, "front", N(61));
    field(a, "front", ZEKE0);
    a.hand.push(N(66));
    useEvent(act); // pays the only AP
    expect(activeAp(a)).toBe(0);
    expect(b.front).toHaveLength(1);
    expect(b.sideline).toEqual([]);
  });

  it("During Opponent's Turn: choosing another character costs nothing; choosing Reiner costs 1 AP", () => {
    const first = setup();
    const nine = field(first.b, "front", NINE);
    field(first.b, "front", N(61));
    field(first.a, "front", ZEKE0);
    first.a.hand.push(N(66));
    useEvent(first.act);
    expect(choice(first.game, "a").options).toHaveLength(2);
    pick(first.act, nine.uid);
    expect(activeAp(first.a)).toBe(2);
    expect(first.b.sideline).toEqual([NINE]);

    const second = setup();
    field(second.b, "front", NINE);
    const reiner = field(second.b, "front", N(61));
    field(second.a, "front", ZEKE0);
    second.a.hand.push(N(66));
    useEvent(second.act);
    pick(second.act, reiner.uid);
    expect(activeAp(second.a)).toBe(1);
    expect(second.b.sideline).toEqual([N(61)]);
  });

  it("During Opponent's Turn: the AP tax only applies in the opponent's turn, not in its owner's turn", () => {
    const { a, b, act } = setup("main", "b");
    const reiner = field(b, "front", N(61));
    act("b", { type: "next_phase" });
    expect(flagsOf(reiner)).not.toContain("taxAp:character");
    act("b", { type: "end_turn" });
    expect(a).toBeDefined();
    expect(flagsOf(reiner)).toContain("taxAp:character");
    expect(flagsOf(reiner)).toContain("taxAp:event");
  });
});

describe("AOT-1-062 Titan Forest", () => {
  it("Activate: Main, switch to resting + place 1 card from hand into the sideline, once per turn: gains Green energy generation", () => {
    const { a, act } = setup();
    const forest = field(a, "energy", N(62));
    expect(energyOf(ctx, a, "green")).toBe(2);
    expect(() => act("a", { type: "activate", uid: forest.uid, ability: 0 })).toThrow("ABILITY_COST"); // no card in hand
    a.hand.push(NINE);
    act("a", { type: "activate", uid: forest.uid, ability: 0 });
    expect(forest.rested).toBe(true);
    expect(a.sideline).toEqual([NINE]);
    expect(energyOf(ctx, a, "green")).toBe(3);
    a.hand.push(NINE);
    expect(() => act("a", { type: "activate", uid: forest.uid, ability: 0 })).toThrow();
  });
});

describe("AOT-1-063 Titan Injection", () => {
  it("looks at 4, adds a card to the hand, the rest to the bottom; a [Pure Titan] card also switches one AP card to active", () => {
    const { game, a, act } = setup();
    a.library = [NINE, KINGSLAYER, PEERING, TEXAS, ...a.library.slice(4)];
    a.hand.push(N(63));
    useEvent(act);
    const restedBefore = a.ap.find((card) => card.rested)!;
    expect(choice(game, "a").options).toHaveLength(4);
    pick(act, "l:2"); // Pure Titan (Peering Titan)
    keepOrder(game, act);
    // Choose up to one AP card: all three are listed.
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, `ap:${restedBefore.id}`);
    expect(activeAp(a)).toBe(3);
    expect(a.hand).toEqual([PEERING]);
    expect(a.library.slice(-3)).toEqual([NINE, KINGSLAYER, TEXAS]);
    expect(a.sideline).toEqual([N(63)]);
  });

  it("a card with 'Rod Reiss' or 'Zeke Jaeger' in its name also switches an AP card to active (and may choose none)", () => {
    const first = setup();
    first.a.library = [NINE, N(38), TEXAS, KINGSLAYER, ...first.a.library.slice(4)];
    first.a.hand.push(N(63));
    useEvent(first.act);
    pick(first.act, "l:1"); // Rod Reiss (Titan)
    keepOrder(first.game, first.act);
    expect(choice(first.game, "a").options).toHaveLength(3);
    pick(first.act); // up to one: none
    expect(activeAp(first.a)).toBe(2);
    expect(first.a.hand).toEqual([N(38)]);

    const second = setup();
    second.a.library = [ZEKE0, NINE, TEXAS, KINGSLAYER, ...second.a.library.slice(4)];
    second.a.hand.push(N(63));
    useEvent(second.act);
    pick(second.act, "l:0"); // Zeke Jaeger
    keepOrder(second.game, second.act);
    expect(choice(second.game, "a").options).toHaveLength(3);
  });

  it("any other revealed card: no AP card is switched to active", () => {
    const { game, a, act } = setup();
    a.library = [NINE, KINGSLAYER, TEXAS, REINER0, ...a.library.slice(4)];
    a.hand.push(N(63));
    useEvent(act);
    pick(act, "l:0"); // 九: no Pure Titan, name without Rod Reiss / Zeke Jaeger
    keepOrder(game, act);
    expect(game.pending).toBeNull();
    expect(activeAp(a)).toBe(2);
    expect(a.hand).toEqual([NINE]);
  });
});

describe("AOT-1-064 We Fight Now!! We Decide This Right Here!!", () => {
  const prepareLibrary = (library: string[]): string[] => [...library, ...Array(30).fill(KINGSLAYER)];

  it("choose one: look at 7, reveal up to two green character cards, the rest on the bottom", () => {
    const { game, a, act } = setup();
    a.library = prepareLibrary([NINE, PEERING, KINGSLAYER, BEARDED, TEXAS, N(41), N(36)]);
    a.hand.push(N(64));
    useEvent(act);
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "m:0");
    expect(choice(game, "a").options).toEqual(["l:1", "l:3", "l:5", "l:6"]);
    pick(act, "l:1", "l:5");
    keepOrder(game, act);
    expect(a.hand).toEqual([PEERING, N(41)]);
    expect(a.library.slice(-5)).toEqual([NINE, KINGSLAYER, BEARDED, TEXAS, N(36)]);
  });

  it("choose one: play up to two green characters with 4+ required energy and 1 AP cost onto the front line (active) or Raid with them", () => {
    const { game, a, act } = setup();
    // Rod Reiss (Titan) (cost 4) Raids onto Rod Reiss on the energy line; Zeke Jaeger (Beast Titan) (cost 7) has no target and is put on the front line.
    const reiss = field(a, "energy", REISS);
    a.hand.push(N(64), N(38), N(48), N(60) /* AP 2: not offered */, N(41) /* cost 2: not offered */);
    useEvent(act);
    pick(act, "m:1");
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "h:0"); // Rod Reiss (Titan)
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]); // enter the front line / Raid
    pick(act, "m:1");
    pick(act, "m:0"); // move to the front line
    expect(reiss.cardId).toBe(N(38));
    expect(a.front).toContain(reiss);
    expect(reiss.rested).toBe(false);
    expect(reiss.under).toEqual([REISS]);
    // Second card: Zeke Jaeger (Beast Titan) has no Raid target: it simply enters the front line, active.
    expect(choice(game, "a").options).toEqual(["h:0"]);
    pick(act, "h:0");
    const zeke = a.front[a.front.length - 1]!;
    expect(zeke.cardId).toBe(N(48));
    expect(zeke.rested).toBe(false);
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([N(60), N(41)]);
  });

  it("choose one: the green character may also enter the front line instead of Raiding; up to two means one or none is fine", () => {
    const { game, a, act } = setup();
    field(a, "energy", REISS);
    a.hand.push(N(64), N(38));
    useEvent(act);
    pick(act, "m:1");
    pick(act, "h:0");
    pick(act, "m:0"); // enter the front line (not Raid)
    expect(a.front.map((card) => card.cardId)).toEqual([N(38)]);
    expect(a.energy.map((card) => card.cardId)).toEqual([REISS]);
    expect(game.pending).toBeNull(); // nothing else to offer

    const second = setup();
    second.a.hand.push(N(64), N(38));
    useEvent(second.act);
    pick(second.act, "m:1");
    pick(second.act); // play nothing
    expect(second.a.front).toEqual([]);
    expect(second.a.hand).toEqual([N(38)]);
  });

  it("with a character with 'Reiner Braun' in its card name on your field, choose all: look and then play", () => {
    const { game, a, act } = setup();
    field(a, "energy", REINER0);
    a.library = prepareLibrary([N(41), NINE, N(36)]);
    a.hand.push(N(64), N(61));
    useEvent(act);
    // No mode question: first the look at 7.
    expect(choice(game, "a").options.every((key) => key.startsWith("l:"))).toBe(true);
    pick(act, "l:0", "l:2");
    keepOrder(game, act);
    expect(a.hand).toEqual([N(61), N(41), N(36)]);
    // Then play: Reiner Braun (Armored Titan) (cost 7) may Raid onto the Reiner Braun on the energy line.
    pick(act, "h:0");
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "m:1");
    pick(act, "m:1"); // stay on the energy line
    expect(a.energy[0]!.cardId).toBe(N(61));
    expect(a.energy[0]!.under).toEqual([REINER0]);
    expect(a.front).toEqual([]);
    // Kenny (cost 4, AP 2) is not offered and nothing else qualifies.
    expect(game.pending).toBeNull();
  });
});

describe("AOT-1-065 Marleyan Warriors", () => {
  it("switches up to two of your AP cards to active", () => {
    const { game, a, act } = setup();
    a.ap[1]!.rested = true;
    a.ap[2]!.rested = true;
    a.hand.push(N(65));
    useEvent(act); // pays with the first AP card
    expect(activeAp(a)).toBe(0);
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, `ap:${a.ap[0]!.id}`, `ap:${a.ap[1]!.id}`);
    expect(a.ap.map((card) => card.rested)).toEqual([false, false, true]);
    expect(a.sideline).toEqual([N(65)]);
  });

  it("up to two: may choose none", () => {
    const { a, act } = setup();
    a.hand.push(N(65));
    useEvent(act);
    pick(act);
    expect(activeAp(a)).toBe(2);
  });
});

describe("AOT-1-066 I'm Going For a Perfect Game.", () => {
  it("sidelines an opponent front-line character with 3000 or less BP", () => {
    const { game, a, b, act } = setup();
    const nine = field(b, "front", NINE);
    const guard = field(b, "front", GUARD);
    field(b, "front", TALULAH); // 4000: too strong
    field(b, "energy", NINE); // not on the front line
    a.hand.push(N(66));
    useEvent(act);
    expect([...choice(game, "a").options].sort()).toEqual([nine.uid, guard.uid].sort());
    pick(act, guard.uid);
    expect(b.sideline).toEqual([GUARD]);
    expect(activeAp(a)).toBe(2);
    expect(a.sideline).toEqual([N(66)]);
  });

  it("with a character with 'Zeke Jaeger' in its card name on your field, 5000 or less BP instead", () => {
    const { game, a, b, act } = setup();
    field(a, "energy", N(48));
    const talulah = field(b, "front", TALULAH);
    const mon3tr = field(b, "front", MON3TR);
    field(b, "front", N(61)); // 5000 BP too: playable, but it is taxed (not relevant here, only its BP)
    a.hand.push(N(66));
    useEvent(act);
    expect(choice(game, "a").options).toContain(talulah.uid);
    expect(choice(game, "a").options).toContain(mon3tr.uid);
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, mon3tr.uid);
    expect(b.sideline).toEqual([MON3TR]);
  });

  it("with only too strong characters, nothing happens", () => {
    const { a, b, act } = setup();
    field(b, "front", TALULAH);
    a.hand.push(N(66));
    useEvent(act);
    expect(b.front).toHaveLength(1);
    expect(a.sideline).toEqual([N(66)]);
  });
});

describe("AOT-1-067 Are We Doing It?! Now...?! Here?!", () => {
  it("a card on your field gains Green Green energy generation for the turn (even a card of another colour)", () => {
    const { game, a, act } = setup();
    const nine = field(a, "energy", NINE);
    const forest = field(a, "energy", N(62));
    a.hand.push(N(67));
    useEvent(act);
    expect(choice(game, "a").options.sort()).toEqual([forest.uid, nine.uid].sort()); // sites too
    expect(energyOf(ctx, a, "green")).toBe(2);
    pick(act, nine.uid);
    expect(energyOf(ctx, a, "green")).toBe(4);
    expect(energyOf(ctx, a, "red")).toBe(1);
    expect(activeAp(a)).toBe(2); // no Bertholdt: no AP switched
  });

  it("with a character with 'Bertholdt Hoover' in its name on your field, up to one AP card is switched to active", () => {
    const { game, a, act } = setup();
    field(a, "front", N(54));
    const forest = field(a, "energy", N(62));
    a.hand.push(N(67));
    useEvent(act);
    pick(act, forest.uid);
    expect(energyOf(ctx, a, "green")).toBe(4);
    expect(choice(game, "a").options).toHaveLength(3);
    pick(act, `ap:${a.ap[0]!.id}`);
    expect(activeAp(a)).toBe(3);
  });

  it("only one card of this name may be used per turn", () => {
    const { game, a, act } = setup();
    field(a, "energy", NINE);
    field(a, "energy", NINE);
    a.hand.push(N(67), N(67));
    useEvent(act);
    pick(act, a.energy[0]!.uid);
    expect(game.pending).toBeNull();
    expect(() => useEvent(act)).toThrow("EVENT_CONDITION");
    expect(a.hand).toEqual([N(67)]);
  });
});

describe("AOT-1-068 Carla Jaeger", () => {
  it("Activate: Main, switch to resting, once per turn: gains Red energy generation; sidelined at the end of the main phase", () => {
    const { a, act } = setup();
    const carla = field(a, "energy", N(68));
    expect(energyOf(ctx, a, "red")).toBe(1);
    act("a", { type: "activate", uid: carla.uid, ability: 0 });
    expect(carla.rested).toBe(true);
    expect(energyOf(ctx, a, "red")).toBe(2);
    expect(() => act("a", { type: "activate", uid: carla.uid, ability: 0 })).toThrow();
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([N(68)]);
  });
});

describe("AOT-1-069 Hange Zoë", () => {
  it("When Played: draws a card if you have an [Inheritor of the Titan] card on your field", () => {
    const { a, act } = setup();
    energy(a, 3, NINE); // 3 red
    field(a, "front", ZEKE0); // Marleyan Warrior／Inheritor of the Titan
    a.hand.push(N(69));
    play(act);
    expect(a.hand).toHaveLength(1);
    expect(a.library).toHaveLength(29);
  });

  it("When Played: no card without one", () => {
    const { a, act } = setup();
    energy(a, 3, NINE);
    field(a, "front", PEERING); // Pure Titan only
    a.hand.push(N(69));
    play(act);
    expect(a.hand).toEqual([]);
    expect(a.library).toHaveLength(30);
  });
});
