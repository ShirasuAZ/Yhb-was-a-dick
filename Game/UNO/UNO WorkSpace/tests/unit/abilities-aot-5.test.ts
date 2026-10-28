/**
 * AOT (进击的巨人) batch 5: the UEPR/AOT-1-0xx promo prints of UE10BT/AOT-1 cards (024 … 071). They print the same text as their originals, so most
 * of these tests are the originals' scenarios (abilities-aot-1 / abilities-aot-2) re-run on the promo card numbers: the card under test is always
 * the UEPR print (`p("…")` / `P(…)`), the helper cards are the UE10BT ones. 070 and 071 are encoded here and have their own tests at the end.
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, damageOf, energyOf, flagsOf, hasKeyword, impactOf, raidTargetMatches, triggerNeeds, type EngineGame, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { CARD_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";

/** The UEPR print under test, and the UE10BT print used for helper cards. */
const p = (suffix: string): string => `UEPR/AOT-1-${suffix}`;
const P = (num: number): string => `UEPR/AOT-1-${String(num).padStart(3, "0")}`;
const n = (suffix: string): string => `UE10BT/AOT-1-${suffix}`;
const N = (num: number): string => `UE10BT/AOT-1-${String(num).padStart(3, "0")}`;

describe("scenarios of the blue / event cards (as in batch 1)", () => {
  // Helper cards without abilities (or with ones that do not matter here).
  const ENERGY2 = n("002"); // Erwin Smith: blue, generates 2 blue energy, cost 3 (never a bounce candidate for cost <= 1)
  const MIKASA_LOW = n("023"); // Mikasa (cost 0, BP 1500, 104th Cadet Corps／Levi Squad); 023 has a When Played, so only used from the hand
  const YMIR_VANILLA = n("012"); // Ymir: blue, cost 0, BP 1500, 104th Cadet Corps／Inheritor of the Titan, no ability
  const HISTORIA_VANILLA = n("019"); // Historia Reiss: blue, cost 0, BP 1500, no ability
  const TITAN = n("042"); // Pure Titan (Peering Titan): green, cost 0, BP 2000, [Pure Titan], no ability
  const EREN_RED = n("090"); // Eren Jaeger: red, cost 0, BP 1500, no ability
  const JEAN_RED = n("083"); // Jean: red, cost 0, BP 2000, no ability
  const GREEN_ENERGY = n("042");
  const EVENT_A = n("032"); // Bombs (blue event)
  const EVENT_B = n("030"); // You Call That Clean?! (blue event)
  const EVENT_C = n("029"); // Memory (blue event)
  const YELLOW_EVENT = "UC01BT/ARK-1-029"; // a non-blue event (Arknights)
  const FILLER = "UC01BT/ARK-1-004";

  type Game = ReturnType<typeof setup>;
  const blue = (owner: EnginePlayer, count: number): void => energy(owner, count, ENERGY2);
  /** Puts `number` into hand and plays it onto the front line. */
  function playFront(g: Game, number: string, who: "a" | "b" = "a"): void {
    const owner = who === "a" ? g.a : g.b;
    owner.hand.push(number);
    g.act(who, { type: "play", handIndex: owner.hand.length - 1, line: "front" });
  }
  const useEvent = (g: Game, number: string): void => { g.a.hand.push(number); g.act("a", { type: "event", handIndex: g.a.hand.length - 1 }); };
  const pick = (g: Game, picks: string[], who = "a"): void => g.act(who, { type: "choose", picks });
  const yes = (g: Game): void => { choice(g.game, "a"); pick(g, ["yes"]); };
  const no = (g: Game): void => { choice(g.game, "a"); pick(g, ["no"]); };
  /** A harmless manual operation: the engine recomputes continuous effects after every action. */
  const refresh = (g: Game): void => g.act("a", { type: "manual", manual: { op: "draw" } });
  /** The attacker (player a) deals its damage to player b and b declines the trigger. */
  function finishDamage(g: Game, count = 1): void {
    const ids = g.b.life.slice(0, count).map((slot) => slot.id);
    g.act("a", { type: "damage", lifeIds: ids });
    for (const id of ids) g.act("b", { type: "trigger", lifeId: id, activate: false });
  }
  const attack = (g: Game, uid: string, targetUid?: string): void => g.act("a", { type: "attack", attackerUid: uid, ...(targetUid ? { targetUid } : {}) } as UnionArenaAction);
  const apRested = (g: Game): number => g.a.ap.filter((card) => card.rested).length;
  const sidelineEvents = (owner: EnginePlayer, count: number): void => { owner.sideline = Array.from({ length: count }, (_, index) => [EVENT_A, EVENT_B, EVENT_C][index % 3]!); };
  const library = (owner: EnginePlayer, top: string[]): void => { owner.library = [...top, ...Array(30 - top.length).fill(FILLER)]; };
  const front = (g: Game, number: string, rested = false): UnionArenaFieldCard => field(g.a, "front", number, rested);

  describe("Kenny Ackermann 035 (UEPR)", () => {
    it("035: 1 less required energy while the opponent has a blue or red card on the field", () => {
      const g = setup("main");
      expect(costOf(g.game, g.players, ctx, "a", p("035")).energy).toBe(3);
      field(g.b, "front", TITAN); // green: no change
      expect(costOf(g.game, g.players, ctx, "a", p("035")).energy).toBe(3);
      field(g.b, "front", YMIR_VANILLA);
      expect(costOf(g.game, g.players, ctx, "a", p("035")).energy).toBe(2);
      const h = setup("main");
      field(h.b, "energy", EREN_RED);
      expect(costOf(h.game, h.players, ctx, "a", p("035")).energy).toBe(2);
      // played with 2 green energy
      h.a.hand = [p("035")];
      energy(h.a, 2, GREEN_ENERGY);
      h.act("a", { type: "play", handIndex: 0, line: "front" });
      expect(h.a.front).toHaveLength(1);
    });
  });

  describe("Mikasa Ackermann 024 (UEPR)", () => {
    it("024: 2+ events in the sideline: +1 blue energy; 4+ events: +1000 BP", () => {
      const g = setup("main");
      const mikasa = field(g.a, "energy", p("024"));
      refresh(g);
      expect(energyOf(ctx, g.a, "blue")).toBe(1);
      expect(bpOf(ctx, mikasa)).toBe(3000);
      sidelineEvents(g.a, 1);
      refresh(g);
      expect(energyOf(ctx, g.a, "blue")).toBe(1);
      sidelineEvents(g.a, 2);
      refresh(g);
      expect(energyOf(ctx, g.a, "blue")).toBe(2);
      expect(bpOf(ctx, mikasa)).toBe(3000);
      sidelineEvents(g.a, 3);
      refresh(g);
      expect(bpOf(ctx, mikasa)).toBe(3000);
      sidelineEvents(g.a, 4);
      refresh(g);
      expect(energyOf(ctx, g.a, "blue")).toBe(2);
      expect(bpOf(ctx, mikasa)).toBe(4000);
      // cards that are not events do not count
      g.a.sideline = Array(6).fill(MIKASA_LOW);
      refresh(g);
      expect(bpOf(ctx, mikasa)).toBe(3000);
    });
  });
  describe("Eren Jaeger 026 (UEPR)", () => {
    it("026: generates an extra blue energy only while active", () => {
      const g = setup("main");
      const eren = field(g.a, "energy", p("026"));
      refresh(g);
      expect(energyOf(ctx, g.a, "blue")).toBe(2);
      eren.rested = true;
      refresh(g);
      expect(energyOf(ctx, g.a, "blue")).toBe(1);
    });
  });
  describe("Former Headquarters of the Scout Regiment 028", () => {
    const activateSite = (top: string) => {
      const g = setup("main");
      const site = field(g.a, "energy", p("028"));
      library(g.a, [top]);
      g.act("a", { type: "activate", uid: site.uid, ability: 0 });
      return { g, site };
    };
    it("adds a blue character with 3 or less required energy from the top of the deck to the hand (and rests)", () => {
      const { g, site } = activateSite(n("015"));
      expect(g.a.hand).toEqual([n("015")]);
      expect(g.a.library).toHaveLength(29);
      expect(site.rested).toBe(true);
      expect(() => g.act("a", { type: "activate", uid: site.uid, ability: 0 })).toThrow("ABILITY_COST");
    });
    it("otherwise the card stays on top of the deck", () => {
      for (const top of [n("025") /* blue, cost 4 */, TITAN /* green */, EVENT_A /* blue event */, n("028") /* blue site */]) {
        const { g } = activateSite(top);
        expect(g.a.hand, top).toEqual([]);
        expect(g.a.library[0], top).toBe(top);
        expect(g.a.library, top).toHaveLength(30);
      }
    });
  });

  describe("Events 029 - 033 (UEPR)", () => {
    it("029 Memory: draw a card, sideline one card from hand, then up to one AP card becomes active", () => {
      const g = setup("main");
      g.a.library = [EVENT_A, ...Array(29).fill(FILLER)];
      g.a.hand = [p("029"), MIKASA_LOW];
      g.act("a", { type: "event", handIndex: 0 });
      expect(g.a.hand).toEqual([MIKASA_LOW, EVENT_A]);
      pick(g, ["h:0"]);
      expect(g.a.sideline).toEqual([MIKASA_LOW]);
      expect(choice(g.game, "a").options).toContain("ap:a:ap0");
      pick(g, ["ap:a:ap0"]);
      expect(apRested(g)).toBe(0);
      expect(g.a.sideline).toEqual([MIKASA_LOW, p("029")]); // the event goes to the sideline after it resolved
    });
    it("029: choosing no AP card leaves it resting", () => {
      const g = setup("main");
      g.a.hand = [p("029"), MIKASA_LOW];
      g.act("a", { type: "event", handIndex: 0 });
      pick(g, ["h:0"]);
      pick(g, []);
      expect(apRested(g)).toBe(1);
    });
    it("030: up to two AP cards become active; the trigger is FINAL", () => {
      const g = setup("main");
      g.a.ap[1]!.rested = true;
      g.a.ap[2]!.rested = true;
      g.a.hand = [p("030")];
      g.act("a", { type: "event", handIndex: 0 }); // pays the last active AP
      const c = choice(g.game, "a");
      expect(c.max).toBe(2);
      expect(c.min).toBe(0);
      pick(g, ["ap:a:ap0", "ap:a:ap2"]);
      expect(g.a.ap.map((card) => card.rested)).toEqual([false, true, false]);
      expect(ctx.card(p("030"))?.trigger?.label).toBe("最终");
    });
    it("030: picking only one (up to two) is allowed", () => {
      const g = setup("main");
      g.a.ap[1]!.rested = true;
      g.a.ap[2]!.rested = true;
      g.a.hand = [p("030")];
      g.act("a", { type: "event", handIndex: 0 });
      pick(g, ["ap:a:ap1"]);
      expect(g.a.ap.map((card) => card.rested)).toEqual([true, false, true]);
    });
    it("031 Cleanup: look at 2, put any number on top in any order, sideline the rest, then draw 2", () => {
      const g = setup("main");
      library(g.a, [EVENT_A, EVENT_B, EVENT_C, n("034")]);
      g.a.hand = [p("031")];
      g.act("a", { type: "event", handIndex: 0 });
      pick(g, ["l:1"]); // EVENT_B on top
      pick(g, ["l:0"]); // then EVENT_A
      expect(g.a.hand).toEqual([EVENT_B, EVENT_A]); // drew the two
      expect(g.a.sideline).toEqual([p("031")]);
      expect(g.a.library[0]).toBe(EVENT_C);
    });
    it("031: keeping only one on top; the other goes to the sideline", () => {
      const g = setup("main");
      library(g.a, [EVENT_A, EVENT_B, EVENT_C, n("034")]);
      g.a.hand = [p("031")];
      g.act("a", { type: "event", handIndex: 0 });
      pick(g, ["l:0"]);
      pick(g, []);
      expect(g.a.hand).toEqual([EVENT_A, EVENT_C]);
      expect(g.a.sideline).toEqual([EVENT_B, p("031")]);
    });
    it("032 Bombs: returns one opponent front-line character with 3500 or less BP (up to one)", () => {
      const g = setup("main");
      const small = field(g.b, "front", JEAN_RED);
      const big = field(g.b, "front", n("010")); // 4000
      const onEnergy = field(g.b, "energy", EREN_RED);
      g.a.hand = [p("032")];
      g.act("a", { type: "event", handIndex: 0 });
      expect(choice(g.game, "a").options).toEqual([small.uid]);
      pick(g, [small.uid]);
      expect(g.b.hand).toEqual([JEAN_RED]);
      expect(g.b.front.map((card) => card.uid)).toEqual([big.uid]);
      expect(g.b.energy.map((card) => card.uid)).toEqual([onEnergy.uid]);
      const none = setup("main");
      field(none.b, "front", JEAN_RED);
      none.a.hand = [p("032")];
      none.act("a", { type: "event", handIndex: 0 });
      pick(none, []);
      expect(none.b.front).toHaveLength(1);
    });
    describe("033 Historia's Resolve", () => {
      const setupResolve = (withHistoria: boolean, events: number) => {
        const g = setup("main");
        const low = field(g.b, "front", JEAN_RED); // 2000
        const mid = field(g.b, "front", n("004")); // 1500
        const high = field(g.b, "front", n("026")); // 2500
        const higher = field(g.b, "front", n("010")); // 4000
        const highest = field(g.b, "energy", n("010")); // not on the front line
        if (withHistoria) front(g, HISTORIA_VANILLA);
        sidelineEvents(g.a, events);
        g.a.hand = [p("033")];
        g.act("a", { type: "event", handIndex: 0 });
        return { g, low, mid, high, higher, highest };
      };
      it("2000 or less BP without <Historia Reiss> (the sideline's events do not matter)", () => {
        const { g, low, mid } = setupResolve(false, 3);
        expect(choice(g.game, "a").options.sort()).toEqual([low.uid, mid.uid].sort());
        pick(g, [low.uid]);
        expect(g.b.sideline).toEqual([JEAN_RED]);
      });
      it("with <Historia Reiss>: +1000 BP range for each event card in your sideline (the event being used is not counted)", () => {
        const { g, low, mid, high, higher, highest } = setupResolve(true, 2);
        const options = choice(g.game, "a").options;
        expect(options.sort()).toEqual([low.uid, mid.uid, high.uid, higher.uid].sort()); // 4000 or less: a 4000 BP character is included
        expect(options).not.toContain(highest.uid);
      });
      it("one event: 3000 or less", () => {
        const { g, higher } = setupResolve(true, 1);
        const options = choice(g.game, "a").options;
        expect(options).toHaveLength(3);
        expect(options).not.toContain(higher.uid);
      });
      it("is a 'choose one': with a single candidate it is sidelined at once; none means nothing happens", () => {
        const g = setup("main");
        const only = field(g.b, "front", n("004"));
        g.a.hand = [p("033")];
        g.act("a", { type: "event", handIndex: 0 });
        expect(g.game.pending).toBeNull();
        expect(g.b.front).toHaveLength(0);
        expect(g.b.sideline).toEqual([n("004")]);
        expect(only.cardId).toBe(n("004"));
        const empty = setup("main");
        field(empty.b, "front", n("010"));
        empty.a.hand = [p("033")];
        empty.act("a", { type: "event", handIndex: 0 });
        expect(empty.game.pending).toBeNull();
        expect(empty.b.front).toHaveLength(1);
      });
    });
  });
});

describe("scenarios of the green / red cards (as in batch 2)", () => {
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


  describe("AOT-1-039 Cart Titan", () => {
    it("When Played: returns another character with 1 or less required energy to the hand", () => {
      const { a, act } = setup();
      energy(a, 1, GREEN3);
      field(a, "front", TEXAS);
      field(a, "front", GUARD); // cost 3: not offered
      a.hand.push(P(39));
      play(act);
      expect(a.hand).toEqual([TEXAS]);
      expect(a.front.map((card) => card.cardId)).toEqual([GUARD, P(39)]);
    });

    it("When Played: with no such character, this character returns to the hand", () => {
      const { a, act } = setup();
      energy(a, 1, GREEN3);
      field(a, "front", GUARD);
      a.hand.push(P(39));
      play(act);
      expect(a.hand).toEqual([P(39)]);
      expect(a.front.map((card) => card.cardId)).toEqual([GUARD]);
    });

    it("When Played: with several candidates the player picks", () => {
      const { game, a, act } = setup();
      energy(a, 1, GREEN3);
      const nine = field(a, "front", NINE);
      field(a, "front", TEXAS);
      a.hand.push(P(39));
      play(act);
      expect(choice(game, "a").options).toHaveLength(2);
      pick(act, nine.uid);
      expect(a.hand).toEqual([NINE]);
      expect(a.front.map((card) => card.cardId)).toEqual([TEXAS, P(39)]);
    });
  });


  describe("AOT-1-040 Pure Titan (Small Titan)", () => {
    it("When Played: draw a card", () => {
      const { a, act } = setup();
      energy(a, 1, GREEN3);
      a.hand.push(P(40));
      play(act);
      expect(a.hand).toHaveLength(1);
      expect(a.library).toHaveLength(29);
    });
  });

  describe("AOT-1-041 Pure Titans (Zeke's Titans)", () => {
    it("When Played: draw a card, then place one card from the hand into the sideline", () => {
      const { game, a, act } = setup();
      energy(a, 1, GREEN3);
      a.hand.push(P(41), NINE, TEXAS);
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
      const zeke = field(a, "front", P(46));
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
      const zeke = field(a, "front", P(46));
      const first = field(a, "front", PEERING);
      const second = field(a, "energy", BEARDED);
      act("a", { type: "activate", uid: zeke.uid, ability: 0 });
      expect([...choice(game, "a").options].sort()).toEqual([first.uid, second.uid].sort());
      pick(act, second.uid);
      expect(bpOf(ctx, second)).toBe(3500);
      expect(bpOf(ctx, first)).toBe(2000);
    });
  });


  describe("AOT-1-049 Pure Titan (Relaxing Titan)", () => {
    it("When Sidelined: plays a card with 2 or less required energy, 1 AP cost and [Pure Titan] affinity from the hand, resting", () => {
      const { game, a, act } = setup();
      const relaxing = field(a, "front", P(49));
      a.hand.push(BEARDED, PEERING, P(49), NINE); // BEARDED, PEERING are offered; the second Relaxing Titan costs 3
      sidelineManually(act, relaxing.uid);
      expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
      pick(act, "h:1");
      pick(act, "line:front");
      const played = a.front[a.front.length - 1]!;
      expect(played.cardId).toBe(PEERING);
      expect(played.rested).toBe(true);
      expect(a.hand).toEqual([BEARDED, P(49), NINE]);
      expect(a.sideline).toEqual([P(49)]);
    });
  });


  describe("AOT-1-050 Annie Leonhart", () => {
    it("When Played: draw a card, then place one card from the hand into the sideline", () => {
      const { game, a, act } = setup();
      energy(a, 1, GREEN3);
      a.hand.push(P(50), NINE);
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
      a.hand.push(P(51), TEXAS);
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
      a.hand.push(P(51), TEXAS);
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
      field(active.a, "energy", P(52));
      active.act("a", { type: "next_phase" });
      expect(energyOf(ctx, active.a, "green")).toBe(2);
      const resting = setup();
      field(resting.a, "energy", P(52), true);
      resting.act("a", { type: "next_phase" });
      expect(energyOf(ctx, resting.a, "green")).toBe(1);
    });
  });


  describe("AOT-1-054 Bertholdt Hoover", () => {
    it("Activate: Main, switch to resting, once per turn: gains Green energy generation; sidelined at the end of the main phase", () => {
      const { game, a, act } = setup();
      const bertholdt = field(a, "energy", P(54));
      expect(energyOf(ctx, a, "green")).toBe(1);
      act("a", { type: "activate", uid: bertholdt.uid, ability: 0 });
      expect(bertholdt.rested).toBe(true);
      expect(energyOf(ctx, a, "green")).toBe(2);
      expect(() => act("a", { type: "activate", uid: bertholdt.uid, ability: 0 })).toThrow();
      act("a", { type: "next_phase" });
      expect(game.phase).toBe("attack");
      expect(a.energy).toEqual([]);
      expect(a.sideline).toEqual([P(54)]);
      expect(energyOf(ctx, a, "green")).toBe(0);
    });
  });


  describe("AOT-1-055 Bertholdt Hoover", () => {
    it("When Played: draws a card if you have 6 or more energy generation", () => {
      const { a, act } = setup();
      energy(a, 2, GREEN3); // 6
      a.hand.push(P(55));
      play(act);
      expect(a.hand).toHaveLength(1);
      expect(a.library).toHaveLength(29);
    });

    it("When Played: no card with 5 or less energy generation", () => {
      const { a, act } = setup();
      energy(a, 1, GREEN3); // 3
      field(a, "energy", NINE); // +1 red: 4 in all
      field(a, "energy", NINE); // 5
      a.hand.push(P(55));
      play(act);
      expect(a.hand).toEqual([]);
      expect(a.library).toHaveLength(30);
    });
  });


  describe("AOT-1-059 Reiner Braun", () => {
    it("gains 1000 BP while you have 6 or more energy generation (at any time)", () => {
      const { a, act } = setup();
      const reiner = field(a, "front", P(59));
      energy(a, 1, GREEN3);
      act("a", { type: "next_phase" });
      expect(bpOf(ctx, reiner)).toBe(3000);
      energy(a, 1, GREEN3); // 6
      act("a", { type: "end_turn" });
      expect(bpOf(ctx, reiner)).toBe(4000); // also during the opponent's turn
    });
  });


  describe("AOT-1-062 Titan Forest", () => {
    it("Activate: Main, switch to resting + place 1 card from hand into the sideline, once per turn: gains Green energy generation", () => {
      const { a, act } = setup();
      const forest = field(a, "energy", P(62));
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
      a.hand.push(P(63));
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
      expect(a.sideline).toEqual([P(63)]);
    });

    it("a card with 'Rod Reiss' or 'Zeke Jaeger' in its name also switches an AP card to active (and may choose none)", () => {
      const first = setup();
      first.a.library = [NINE, N(38), TEXAS, KINGSLAYER, ...first.a.library.slice(4)];
      first.a.hand.push(P(63));
      useEvent(first.act);
      pick(first.act, "l:1"); // Rod Reiss (Titan)
      keepOrder(first.game, first.act);
      expect(choice(first.game, "a").options).toHaveLength(3);
      pick(first.act); // up to one: none
      expect(activeAp(first.a)).toBe(2);
      expect(first.a.hand).toEqual([N(38)]);

      const second = setup();
      second.a.library = [ZEKE0, NINE, TEXAS, KINGSLAYER, ...second.a.library.slice(4)];
      second.a.hand.push(P(63));
      useEvent(second.act);
      pick(second.act, "l:0"); // Zeke Jaeger
      keepOrder(second.game, second.act);
      expect(choice(second.game, "a").options).toHaveLength(3);
    });

    it("any other revealed card: no AP card is switched to active", () => {
      const { game, a, act } = setup();
      a.library = [NINE, KINGSLAYER, TEXAS, REINER0, ...a.library.slice(4)];
      a.hand.push(P(63));
      useEvent(act);
      pick(act, "l:0"); // 九: no Pure Titan, name without Rod Reiss / Zeke Jaeger
      keepOrder(game, act);
      expect(game.pending).toBeNull();
      expect(activeAp(a)).toBe(2);
      expect(a.hand).toEqual([NINE]);
    });
  });


  describe("AOT-1-065 Marleyan Warriors", () => {
    it("switches up to two of your AP cards to active", () => {
      const { game, a, act } = setup();
      a.ap[1]!.rested = true;
      a.ap[2]!.rested = true;
      a.hand.push(P(65));
      useEvent(act); // pays with the first AP card
      expect(activeAp(a)).toBe(0);
      expect(choice(game, "a").options).toHaveLength(3);
      pick(act, `ap:${a.ap[0]!.id}`, `ap:${a.ap[1]!.id}`);
      expect(a.ap.map((card) => card.rested)).toEqual([false, false, true]);
      expect(a.sideline).toEqual([P(65)]);
    });

    it("up to two: may choose none", () => {
      const { a, act } = setup();
      a.hand.push(P(65));
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
      a.hand.push(P(66));
      useEvent(act);
      expect([...choice(game, "a").options].sort()).toEqual([nine.uid, guard.uid].sort());
      pick(act, guard.uid);
      expect(b.sideline).toEqual([GUARD]);
      expect(activeAp(a)).toBe(2);
      expect(a.sideline).toEqual([P(66)]);
    });

    it("with a character with 'Zeke Jaeger' in its card name on your field, 5000 or less BP instead", () => {
      const { game, a, b, act } = setup();
      field(a, "energy", N(48));
      const talulah = field(b, "front", TALULAH);
      const mon3tr = field(b, "front", MON3TR);
      field(b, "front", N(61)); // 5000 BP too: playable, but it is taxed (not relevant here, only its BP)
      a.hand.push(P(66));
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
      a.hand.push(P(66));
      useEvent(act);
      expect(b.front).toHaveLength(1);
      expect(a.sideline).toEqual([P(66)]);
    });
  });


  describe("AOT-1-067 Are We Doing It?! Now...?! Here?!", () => {
    it("a card on your field gains Green Green energy generation for the turn (even a card of another colour)", () => {
      const { game, a, act } = setup();
      const nine = field(a, "energy", NINE);
      const forest = field(a, "energy", N(62));
      a.hand.push(P(67));
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
      a.hand.push(P(67));
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
      a.hand.push(P(67), P(67));
      useEvent(act);
      pick(act, a.energy[0]!.uid);
      expect(game.pending).toBeNull();
      expect(() => useEvent(act)).toThrow("EVENT_CONDITION");
      expect(a.hand).toEqual([P(67)]);
    });
  });


  describe("AOT-1-068 Carla Jaeger", () => {
    it("Activate: Main, switch to resting, once per turn: gains Red energy generation; sidelined at the end of the main phase", () => {
      const { a, act } = setup();
      const carla = field(a, "energy", P(68));
      expect(energyOf(ctx, a, "red")).toBe(1);
      act("a", { type: "activate", uid: carla.uid, ability: 0 });
      expect(carla.rested).toBe(true);
      expect(energyOf(ctx, a, "red")).toBe(2);
      expect(() => act("a", { type: "activate", uid: carla.uid, ability: 0 })).toThrow();
      act("a", { type: "next_phase" });
      expect(a.energy).toEqual([]);
      expect(a.sideline).toEqual([P(68)]);
    });
  });


});

// ---- Coverage of the whole batch ----
const BATCH = ["024", "026", "028", "029", "030", "031", "032", "033", "035", "037", "039", "040", "041", "042", "043", "045", "046", "049", "050", "051", "052", "054", "055", "058", "059", "062", "063", "065", "066", "067", "068", "070", "071"];

describe("AOT batch 5: every card is automatic", () => {
  it("all 33 cards of the batch are automatic (an ability entry, or keyword/'-' only)", () => {
    expect(BATCH).toHaveLength(33);
    for (const suffix of BATCH) expect(isAutomated(titleCard(p(suffix))), p(suffix)).toBe(true);
  });
  it("042, 043, 045, 058 print '-' and need no ability entry; playing one does nothing", () => {
    for (const suffix of ["042", "043", "045", "058"]) {
      expect(titleCard(p(suffix)).stats.abilityText, suffix).toBe("-");
      expect(CARD_ABILITIES[p(suffix)] ?? [], suffix).toEqual([]); // none, or the empty entry of its original (reprint alias)
      const g = setup("main");
      energy(g.a, 1, "UE10BT/AOT-1-060");
      g.a.hand = [p(suffix)];
      g.act("a", { type: "play", handIndex: 0, line: "front" });
      expect(g.game.pending, suffix).toBeNull();
      expect(g.a.front, suffix).toHaveLength(1);
    }
  });
  it("every promo print with an entry has the same printed text and the same abilities as its UE10BT original (070, 071 are encoded on their own)", () => {
    for (const suffix of BATCH) {
      if (["042", "043", "045", "058", "070", "071"].includes(suffix)) continue;
      expect(titleCard(p(suffix)).stats.abilityText, suffix).toBe(titleCard(n(suffix)).stats.abilityText);
      expect(CARD_ABILITIES[p(suffix)], suffix).toBeDefined();
      expect(CARD_ABILITIES[p(suffix)], suffix).toBe(CARD_ABILITIES[n(suffix)]);
    }
  });
  it("the life-card triggers of the promo prints are the originals' (033 / 066 SPECIAL, 030 / 065 FINAL, 029 Draw, 062 Get)", () => {
    expect(ctx.card(p("033"))?.trigger?.label).toBe("特殊");
    expect(ctx.card(p("066"))?.trigger?.label).toBe("特殊");
    expect(ctx.card(p("030"))?.trigger?.label).toBe("最终");
    expect(ctx.card(p("065"))?.trigger?.label).toBe("最终");
    expect(ctx.card(p("029"))?.trigger?.label).toBe("抽卡");
  });
});

// ---- 070 and 071 (encoded in cards-aot-5.ts itself) ----
describe("Hannes 070", () => {
  const RED3 = "UE10ST/AOT-1-102"; // Bertholdt Hoover: red, cost 3, makes 2 red energy, no ability
  const NINE = "UC01BT/ARK-1-088"; // 九: red, cost 0, BP2000, makes 1 red energy
  const TEXAS = "UC01BT/ARK-1-074"; // 德克萨斯: red, cost 1, BP2500
  const GUARD = "UC01ST/ARK-1-103"; // Guard: cost 3, BP3000
  const play = (g: ReturnType<typeof setup>): void => g.act("a", { type: "play", handIndex: g.a.hand.length - 1, line: "front" });

  it("When Played: returns one other character with 1 or less required energy to the hand (a single candidate at once)", () => {
    const g = setup("main");
    energy(g.a, 1, RED3);
    field(g.a, "front", TEXAS);
    field(g.a, "front", GUARD); // cost 3: not a candidate
    g.a.hand = [p("070")];
    play(g);
    expect(g.game.pending).toBeNull();
    expect(g.a.hand).toEqual([TEXAS]);
    expect(g.a.front.map((card) => card.cardId)).toEqual([GUARD, p("070")]);
  });
  it("When Played: with several candidates the owner picks (including one on the energy line); Hannes stays", () => {
    const g = setup("main");
    energy(g.a, 1, RED3);
    const nine = field(g.a, "energy", NINE);
    const texas = field(g.a, "front", TEXAS);
    g.a.hand = [p("070")];
    play(g);
    expect([...choice(g.game, "a").options].sort()).toEqual([nine.uid, texas.uid].sort());
    g.act("a", { type: "choose", picks: [nine.uid] });
    expect(g.a.hand).toEqual([NINE]);
    expect(g.a.energy.map((card) => card.cardId)).toEqual([RED3]);
    expect(g.a.front.map((card) => card.cardId)).toEqual([TEXAS, p("070")]);
  });
  it("When Played: the opponent's characters are not candidates, and the card itself is not either", () => {
    const g = setup("main");
    energy(g.a, 1, RED3);
    field(g.b, "front", NINE);
    g.a.hand = [p("070")];
    play(g);
    // nothing else of ours with 1 or less required energy: Hannes returns to the hand
    expect(g.a.hand).toEqual([p("070")]);
    expect(g.a.front).toEqual([]);
    expect(g.b.front.map((card) => card.cardId)).toEqual([NINE]);
    expect(g.b.hand).toEqual([]);
  });
  it("When Played: with no such character, Hannes returns to the hand", () => {
    const g = setup("main");
    energy(g.a, 1, RED3);
    field(g.a, "front", GUARD);
    g.a.hand = [p("070")];
    play(g);
    expect(g.a.hand).toEqual([p("070")]);
    expect(g.a.front.map((card) => card.cardId)).toEqual([GUARD]);
  });
});

describe("Eren Kruger 071", () => {
  const GRISHA = "UE10BT/AOT-1-072"; // Grisha Jaeger (its When Played does not run when placed straight onto the field)
  const KING = "UC01BT/ARK-1-004";
  const withLibrary = (g: ReturnType<typeof setup>, top: string[]): void => { g.a.library = [...top, ...Array(30 - top.length).fill(KING)]; };

  it("Activate: Main, with <Grisha Jaeger> on your field: rests and sidelines itself, draws two cards, then one card from hand is sidelined", () => {
    const g = setup("main");
    const kruger = field(g.a, "front", p("071"));
    field(g.a, "energy", GRISHA);
    withLibrary(g, [n("029"), n("030")]);
    g.a.hand = [n("032")];
    g.act("a", { type: "activate", uid: kruger.uid, ability: 0 });
    expect(g.a.front).toEqual([]); // sidelined as a cost
    expect(g.a.sideline).toEqual([p("071")]);
    expect(g.a.hand).toEqual([n("032"), n("029"), n("030")]);
    expect(g.a.library).toHaveLength(28);
    expect([...choice(g.game, "a").options]).toEqual(["h:0", "h:1", "h:2"]);
    g.act("a", { type: "choose", picks: ["h:1"] });
    expect(g.a.hand).toEqual([n("032"), n("030")]);
    expect(g.a.sideline).toEqual([p("071"), n("029")]);
    expect(g.game.pending).toBeNull();
  });
  it("only while <Grisha Jaeger> is on YOUR field: not with none, not with only the opponent's", () => {
    const g = setup("main");
    const kruger = field(g.a, "front", p("071"));
    expect(() => g.act("a", { type: "activate", uid: kruger.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    field(g.b, "front", GRISHA);
    expect(() => g.act("a", { type: "activate", uid: kruger.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    expect(g.a.front).toHaveLength(1);
    expect(g.a.hand).toEqual([]);
    expect(g.a.sideline).toEqual([]);
  });
  it("needs to be active to pay 'Switch to Resting'", () => {
    const g = setup("main");
    const kruger = field(g.a, "front", p("071"), true);
    field(g.a, "front", GRISHA);
    expect(() => g.act("a", { type: "activate", uid: kruger.uid, ability: 0 })).toThrow("ABILITY_COST");
    expect(g.a.front).toHaveLength(2);
    expect(g.a.hand).toEqual([]);
  });
});
