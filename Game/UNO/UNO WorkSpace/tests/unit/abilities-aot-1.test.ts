/**
 * AOT (进击的巨人) batch 1: UE10BT/AOT-1-001 … 035 (blue cards, plus Kenny). One test per card (several for cards with several abilities), set up as the
 * printed text describes and checked against it. Cards are addressed by number through the shared harness (no card art needed).
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, energyOf, hasKeyword, impactOf, raidTargetMatches, triggerNeeds, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { CARD_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";

const n = (suffix: string): string => `UE10BT/AOT-1-${suffix}`;
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

describe("AOT batch 1: every card is automatic", () => {
  const numbers = [...Array(16).keys()].map((index) => n(String(index + 1).padStart(3, "0"))).concat([...Array(17).keys()].map((index) => n(String(index + 19).padStart(3, "0"))));
  it("has an ability entry (or is keyword-only) for all 33 cards", () => {
    expect(numbers).toHaveLength(33);
    for (const number of numbers) expect(isAutomated(titleCard(number)), number).toBe(true);
  });
  it("cards printed with '-' are empty entries, and playing one does nothing", () => {
    for (const number of ["001", "007", "012", "019"]) {
      expect(CARD_ABILITIES[n(number)], number).toEqual([]);
      const g = setup("main");
      playFront(g, n(number));
      expect(g.game.pending, number).toBeNull();
      expect(g.a.front).toHaveLength(1);
    }
  });
});

describe("Erwin Smith 002", () => {
  it("When Played: takes a <Levi> from the top 3, the rest go to the bottom in order, then one card from hand is sidelined", () => {
    const g = setup("main");
    blue(g.a, 2);
    library(g.a, [n("034"), n("008"), n("029")]);
    g.a.hand = [n("002"), EVENT_A];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(g.game, "a").options).toEqual(["l:1"]); // only <Levi> (not "Levi's Barrage")
    pick(g, ["l:1"]);
    expect(g.a.hand).toEqual([EVENT_A, n("008")]);
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1"]); // order of the rest
    pick(g, ["l:1", "l:0"]);
    expect(g.a.library).toHaveLength(29);
    expect(g.a.library.slice(-2)).toEqual([n("029"), n("034")]);
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1"]); // "place one card from your hand into your sideline"
    pick(g, ["h:1"]);
    expect(g.a.sideline).toEqual([n("008")]);
    expect(g.a.hand).toEqual([EVENT_A]);
  });
  it("When Played: no <Levi> added means nothing is sidelined (all three go to the bottom)", () => {
    const g = setup("main");
    blue(g.a, 2);
    library(g.a, [n("034"), n("029"), n("032")]);
    g.a.hand = [n("002"), EVENT_A];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    // no <Levi> among the three: nothing to take, only the order for the bottom of the deck is asked
    pick(g, ["l:2", "l:0", "l:1"]);
    expect(g.game.pending).toBeNull();
    expect(g.a.hand).toEqual([EVENT_A]);
    expect(g.a.sideline).toEqual([]);
    expect(g.a.library.slice(-3)).toEqual([n("032"), n("034"), n("029")]);
  });
  it("Activate: Main (pay 1 AP, once per turn): +1 blue energy this turn, and at the start of the attack phase one AP card becomes active", () => {
    const g = setup("main");
    const erwin = field(g.a, "energy", n("002"));
    expect(energyOf(ctx, g.a, "blue")).toBe(2);
    g.act("a", { type: "activate", uid: erwin.uid, ability: 1 });
    expect(apRested(g)).toBe(1);
    expect(energyOf(ctx, g.a, "blue")).toBe(3);
    expect(() => g.act("a", { type: "activate", uid: erwin.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
    g.act("a", { type: "next_phase" }); // main -> attack
    expect(g.game.phase).toBe("attack");
    expect(choice(g.game, "a").options).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
    pick(g, ["ap:a:ap0"]);
    expect(apRested(g)).toBe(0);
  });
  it("Activate: Main: choosing no AP card at the start of the attack phase leaves it resting (also when the turn ends from the main phase)", () => {
    const g = setup("main");
    const erwin = field(g.a, "front", n("002"));
    g.act("a", { type: "activate", uid: erwin.uid, ability: 1 });
    g.act("a", { type: "end_turn" });
    choice(g.game, "a");
    pick(g, []);
    expect(apRested(g)).toBe(1);
    expect(g.game.turnPlayerId).toBe("b");
  });
});

describe("Hange Zoë 003", () => {
  const prepare = () => {
    const g = setup("main");
    blue(g.a, 2);
    const titan = field(g.a, "energy", TITAN); // own active [Pure Titan]
    const ymir = field(g.b, "front", YMIR_VANILLA); // opponent's active [Inheritor of the Titan]
    const restedEren = field(g.b, "front", n("090"), true); // not active
    const mikasa = field(g.b, "front", n("085")); // active, 104th Cadet Corps／Levi Squad: neither affinity
    g.a.hand = [n("003")];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    return { g, titan, ymir, restedEren, mikasa };
  };
  it("may rest an active Inheritor/Titan card on either field (only active ones with those affinities); its owner draws", () => {
    const { g, titan, ymir, restedEren, mikasa } = prepare();
    expect(choice(g.game, "a").options).toEqual(["yes", "no"]);
    pick(g, ["yes"]);
    const options = choice(g.game, "a").options;
    expect(options.sort()).toEqual([titan.uid, ymir.uid].sort());
    expect(options).not.toContain(restedEren.uid);
    expect(options).not.toContain(mikasa.uid);
    const handBefore = g.b.hand.length;
    pick(g, [ymir.uid]);
    expect(ymir.rested).toBe(true);
    expect(g.b.hand).toHaveLength(handBefore + 1); // the opponent drew, not the player of Hange
    expect(g.a.hand).toHaveLength(0);
  });
  it("choosing one's own card: the player of Hange draws", () => {
    const { g, titan, ymir } = prepare();
    pick(g, ["yes"]);
    pick(g, [titan.uid]);
    expect(titan.rested).toBe(true);
    expect(ymir.rested).toBe(false);
    expect(g.a.hand).toHaveLength(1);
    expect(g.b.hand).toHaveLength(0);
  });
  it("declining does nothing; with no active Inheritor/Titan card there is no question", () => {
    const { g, titan, ymir } = prepare();
    pick(g, ["no"]);
    expect(titan.rested || ymir.rested).toBe(false);
    expect(g.a.hand).toHaveLength(0);
    const empty = setup("main");
    blue(empty.a, 2);
    playFront(empty, n("003"));
    expect(empty.game.pending).toBeNull();
  });
});

describe("Eld Gin 004", () => {
  it("gains 2000 BP during your turn once you paid an AP cost in the attack phase (not before, not for AP paid in the main phase)", () => {
    const g = setup("main");
    const erwin = field(g.a, "front", n("002"));
    const eld = front(g, n("004"));
    const levi = front(g, n("008"));
    g.act("a", { type: "activate", uid: erwin.uid, ability: 1 }); // pays 1 AP in the main phase
    refresh(g);
    expect(bpOf(ctx, eld)).toBe(1500);
    g.act("a", { type: "next_phase" });
    pick(g, []); // Erwin's attack-start AP choice
    attack(g, levi.uid);
    expect(bpOf(ctx, eld)).toBe(1500);
    yes(g); // Levi pays 1 AP in the attack phase
    expect(bpOf(ctx, eld)).toBe(3500);
    finishDamage(g);
    g.act("a", { type: "end_turn" });
    expect(g.game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, eld)).toBe(1500); // a new turn: no longer
  });
  it("declining the payment gives no bonus", () => {
    const g = setup("attack");
    const eld = front(g, n("004"));
    const levi = front(g, n("008"));
    attack(g, levi.uid);
    no(g);
    expect(bpOf(ctx, eld)).toBe(1500);
  });
});

describe("Oruo Bozad 005", () => {
  it("Activate: Main (rest, once per turn): +1 blue energy this turn; sidelined at the end of the main phase", () => {
    const g = setup("main");
    const oruo = field(g.a, "energy", n("005"));
    expect(energyOf(ctx, g.a, "blue")).toBe(1);
    g.act("a", { type: "activate", uid: oruo.uid, ability: 0 });
    expect(oruo.rested).toBe(true);
    expect(energyOf(ctx, g.a, "blue")).toBe(2);
    expect(() => g.act("a", { type: "activate", uid: oruo.uid, ability: 0 })).toThrow();
    g.act("a", { type: "next_phase" });
    expect(g.a.energy).toHaveLength(0);
    expect(g.a.sideline).toEqual([n("005")]);
  });
  it("does nothing special if it is not activated", () => {
    const g = setup("main");
    field(g.a, "energy", n("005"));
    g.act("a", { type: "next_phase" });
    expect(g.a.energy).toHaveLength(1);
  });
});

describe("Petra Rall 006", () => {
  it("When Played: at the start of the attack phase, one AP card may be switched to active", () => {
    const g = setup("main");
    blue(g.a, 2);
    playFront(g, n("006"));
    expect(apRested(g)).toBe(1);
    expect(g.game.pending).toBeNull(); // nothing yet
    g.act("a", { type: "next_phase" });
    expect(g.game.phase).toBe("attack");
    expect(choice(g.game, "a").options).toContain("ap:a:ap0");
    pick(g, ["ap:a:ap0"]);
    expect(apRested(g)).toBe(0);
  });
  it("declining (up to one) leaves the AP resting; ending the turn from the main phase also starts the attack phase", () => {
    const g = setup("main");
    blue(g.a, 2);
    playFront(g, n("006"));
    g.act("a", { type: "end_turn" });
    choice(g.game, "a");
    pick(g, []);
    expect(apRested(g)).toBe(1);
  });
});

describe("Levi 008 / 009 (When Attacking: pay 1 AP)", () => {
  for (const [number, bonus, base] of [["008", 500, 2500], ["009", 1000, 3000]] as const) {
    it(`${number}: paying 1 AP draws a card and gives +${bonus} BP this turn`, () => {
      const g = setup("attack");
      const levi = front(g, n(number));
      attack(g, levi.uid);
      expect(choice(g.game, "a").options).toEqual(["yes", "no"]);
      pick(g, ["yes"]);
      expect(apRested(g)).toBe(1);
      expect(g.a.hand).toHaveLength(1);
      expect(bpOf(ctx, levi)).toBe(base + bonus);
    });
    it(`${number}: declining costs and gives nothing; with no active AP there is no question`, () => {
      const g = setup("attack");
      const levi = front(g, n(number));
      attack(g, levi.uid);
      no(g);
      expect(apRested(g)).toBe(0);
      expect(g.a.hand).toHaveLength(0);
      expect(bpOf(ctx, levi)).toBe(base);
      const broke = setup("attack");
      broke.a.ap.forEach((card) => { card.rested = true; });
      const attacker = front(broke, n(number));
      attack(broke, attacker.uid);
      expect(broke.game.pending?.kind).toBe("damage"); // straight to the damage, no payment offered
    });
  }
  it("009's COLOR trigger returns an opponent's front-line character with 3500 or less BP", () => {
    expect(ctx.card(n("009"))?.trigger?.label).toBe("色彩");
    expect(ctx.card(n("009"))?.trigger?.text).toContain("BP不高于3500");
    expect(ctx.card(n("009"))?.trigger?.text).toContain("放回手牌");
  });
});

describe("Levi 010", () => {
  it("If on the Front Line: at the start of your attack phase, if active, one AP card may be switched to active", () => {
    const g = setup("main");
    g.a.ap[0]!.rested = true;
    front(g, n("010"));
    g.act("a", { type: "next_phase" });
    expect(choice(g.game, "a").options).toContain("ap:a:ap0");
    pick(g, ["ap:a:ap0"]);
    expect(g.a.ap[0]!.rested).toBe(false);
  });
  it("...but not when it is resting or not on the front line", () => {
    const rested = setup("main");
    rested.a.ap[0]!.rested = true;
    front(rested, n("010"), true);
    rested.act("a", { type: "next_phase" });
    expect(rested.game.pending).toBeNull();
    const back = setup("main");
    back.a.ap[0]!.rested = true;
    field(back.a, "energy", n("010"));
    back.act("a", { type: "next_phase" });
    expect(back.game.pending).toBeNull();
    expect(back.a.ap[0]!.rested).toBe(true);
  });
  it("When Attacking: pay 1 AP, then a chosen character gets +1000 BP and cannot be chosen by the opponent's trigger abilities", () => {
    const g = setup("attack");
    const levi = front(g, n("010"));
    const eren = front(g, EREN_RED);
    g.b.life[0]!.cardId = n("034"); // a [SPECIAL] life card: "Choose one character on your opponent's front line and sideline it"
    attack(g, levi.uid);
    pick(g, ["yes"]);
    expect(apRested(g)).toBe(1);
    const options = choice(g.game, "a").options;
    expect(options).toEqual(expect.arrayContaining([levi.uid, eren.uid]));
    pick(g, [eren.uid]);
    expect(bpOf(ctx, eren)).toBe(2500);
    g.act("a", { type: "damage", lifeIds: [g.b.life[0]!.id] });
    const lifeId = (g.game.pending as { revealed: Array<{ id: string }> }).revealed[0]!.id;
    expect(triggerNeeds(ctx, g.b, g.a, n("034")).targets).toEqual([levi.uid]); // Eren is protected
    expect(() => g.act("b", { type: "trigger", lifeId, activate: true, targetUid: eren.uid })).toThrow("TRIGGER_TARGET_INVALID");
    g.act("b", { type: "trigger", lifeId, activate: true, targetUid: levi.uid });
    expect(g.a.front.map((card) => card.uid)).toEqual([eren.uid]);
  });
  it("When Attacking: declining the payment (or choosing no one) gives nothing", () => {
    const g = setup("attack");
    const levi = front(g, n("010"));
    const eren = front(g, EREN_RED);
    attack(g, levi.uid);
    no(g);
    expect(bpOf(ctx, eren)).toBe(1500);
    expect(apRested(g)).toBe(0);
    const h = setup("attack");
    const attacker = front(h, n("010"));
    const other = front(h, EREN_RED);
    attack(h, attacker.uid);
    pick(h, ["yes"]);
    pick(h, []);
    expect(bpOf(ctx, other)).toBe(1500);
    expect(bpOf(ctx, attacker)).toBe(4000);
    expect(apRested(h)).toBe(1); // the payment was made
  });
});

describe("Levi 011", () => {
  /** Levi 011 by Raid on a Levi, so it is active; b has a resting character that cannot block. */
  function raided() {
    const g = setup("main");
    blue(g.a, 3);
    const base = front(g, n("008"));
    const victim = field(g.b, "front", EREN_RED, true);
    expect(raidTargetMatches(ctx, ctx.card(n("011"))!, base)).toBe(true);
    g.a.hand = [n("011")];
    g.act("a", { type: "raid", handIndex: 0, targetUid: base.uid });
    return { g, levi: base, victim };
  }
  it("Raid + When Played: +1000 BP and Double Attack until the end of the turn", () => {
    const { g, levi } = raided();
    expect(levi.cardId).toBe(n("011"));
    expect(levi.rested).toBe(false);
    expect(bpOf(ctx, levi)).toBe(5000);
    expect(hasKeyword(ctx, levi, "2次攻击")).toBe(true);
    expect(hasKeyword(ctx, levi, "瞄准攻击")).toBe(false);
  });
  it("attacks three times: Double Attack on the first, 1 AP at the end of the second, and the third attack can Snipe", () => {
    const { g, levi, victim } = raided();
    g.act("a", { type: "next_phase" });
    // attack 1: Double Attack switches it to active at once
    attack(g, levi.uid);
    finishDamage(g);
    expect(levi.rested).toBe(false);
    no(g); // "At the end of this character's attack, you may pay 1 AP": declined, so the once-per-turn use is kept
    expect(apRested(g)).toBe(1); // only the Raid's AP
    expect(() => attack(g, levi.uid, victim.uid)).toThrow("SNIPE_REQUIRED"); // not the third attack yet
    // attack 2
    attack(g, levi.uid);
    finishDamage(g);
    expect(levi.rested).toBe(true);
    yes(g);
    expect(apRested(g)).toBe(2);
    expect(levi.rested).toBe(false);
    // attack 3: Snipe
    expect(hasKeyword(ctx, levi, "瞄准攻击")).toBe(true);
    const lifeBefore = g.b.life.length;
    attack(g, levi.uid, victim.uid);
    expect(g.b.front).toHaveLength(0); // the targeted character was sidelined, nobody could block
    expect(g.b.sideline).toContain(EREN_RED);
    expect(g.b.life).toHaveLength(lifeBefore);
    expect(g.game.pending).toBeNull(); // the once-per-turn ability is spent: no second question
    expect(levi.rested).toBe(true);
  });
  it("the AP payment is optional and needs an active AP card", () => {
    const { g, levi } = raided();
    g.a.ap.forEach((card) => { card.rested = true; });
    g.act("a", { type: "next_phase" });
    attack(g, levi.uid);
    finishDamage(g);
    expect(g.game.pending).toBeNull(); // no AP to pay: no question
    expect(levi.rested).toBe(false); // Double Attack
  });
});

describe("Ymir 013 / 014", () => {
  it("013: +1000 BP during the opponent's turn while <Historia Reiss> is on your field", () => {
    const g = setup("main");
    const ymir = front(g, n("013"));
    const historia = front(g, HISTORIA_VANILLA);
    refresh(g);
    expect(bpOf(ctx, ymir)).toBe(3000); // my own turn
    g.act("a", { type: "end_turn" });
    expect(g.game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, ymir)).toBe(4000);
    g.a.front = g.a.front.filter((card) => card !== historia);
    g.act("b", { type: "manual", manual: { op: "draw" } });
    expect(bpOf(ctx, ymir)).toBe(3000);
  });
  it("014: Raid target is <Ymir>", () => {
    const g = setup("main");
    const ymir = front(g, YMIR_VANILLA);
    expect(raidTargetMatches(ctx, ctx.card(n("014"))!, ymir)).toBe(true);
    expect(raidTargetMatches(ctx, ctx.card(n("014"))!, front(g, HISTORIA_VANILLA))).toBe(false);
  });
  it("014 When Attacking (once per turn): draw, sideline a card from hand, and with 6+ events in the sideline may switch to active", () => {
    const g = setup("attack");
    const ymir = front(g, n("014"));
    sidelineEvents(g.a, 6);
    g.a.hand = [MIKASA_LOW];
    attack(g, ymir.uid);
    expect(g.a.hand).toHaveLength(2);
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1"]);
    pick(g, ["h:0"]);
    expect(g.a.sideline).toHaveLength(7);
    expect(g.a.hand).toHaveLength(1);
    expect(ymir.rested).toBe(true);
    yes(g);
    expect(ymir.rested).toBe(false);
    finishDamage(g);
    // second attack: once per turn, nothing happens
    attack(g, ymir.uid);
    expect(g.game.pending?.kind).toBe("damage");
  });
  it("014: with fewer than 6 events in the sideline (or declining) it stays resting", () => {
    const few = setup("attack");
    const ymir = front(few, n("014"));
    sidelineEvents(few.a, 5);
    few.a.hand = [MIKASA_LOW];
    attack(few, ymir.uid);
    pick(few, ["h:0"]);
    expect(few.game.pending?.kind).toBe("damage");
    expect(ymir.rested).toBe(true);
    const many = setup("attack");
    const other = front(many, n("014"));
    sidelineEvents(many.a, 6);
    many.a.hand = [MIKASA_LOW];
    attack(many, other.uid);
    pick(many, ["h:1"]);
    no(many);
    expect(other.rested).toBe(true);
  });
});

describe("Armin Arlelt 015", () => {
  it("When Played: returns one other character with 1 or less required energy (the owner chooses among them)", () => {
    const g = setup("main");
    blue(g.a, 1);
    const cheap1 = front(g, YMIR_VANILLA);
    const cheap2 = front(g, HISTORIA_VANILLA);
    const costly = front(g, n("026")); // cost 2
    playFront(g, n("015"));
    expect(choice(g.game, "a").options.sort()).toEqual([cheap1.uid, cheap2.uid].sort());
    pick(g, [cheap2.uid]);
    expect(g.a.hand).toEqual([HISTORIA_VANILLA]);
    expect(g.a.front.map((card) => card.uid)).toContain(costly.uid);
    expect(g.a.front.some((card) => card.cardId === n("015"))).toBe(true);
  });
  it("When Played: a single candidate is returned at once", () => {
    const g = setup("main");
    blue(g.a, 1);
    front(g, YMIR_VANILLA);
    playFront(g, n("015"));
    expect(g.game.pending).toBeNull();
    expect(g.a.hand).toEqual([YMIR_VANILLA]);
  });
  it("When Played: if it cannot, it returns itself to the hand", () => {
    const g = setup("main");
    blue(g.a, 1);
    front(g, n("026")); // cost 2: not eligible
    playFront(g, n("015"));
    expect(g.a.hand).toEqual([n("015")]);
    expect(g.a.front).toHaveLength(1);
    const alone = setup("main");
    blue(alone.a, 1);
    playFront(alone, n("015"));
    expect(alone.a.hand).toEqual([n("015")]);
  });
});

describe("Conny Springer 016 / Kenny Ackermann 035 (cost reduction in hand)", () => {
  it("016: 1 less required energy while the opponent has a green or red card on the field", () => {
    const g = setup("main");
    expect(costOf(g.game, g.players, ctx, "a", n("016")).energy).toBe(3);
    field(g.b, "front", YMIR_VANILLA); // blue: no change
    expect(costOf(g.game, g.players, ctx, "a", n("016")).energy).toBe(3);
    field(g.b, "energy", EREN_RED);
    expect(costOf(g.game, g.players, ctx, "a", n("016")).energy).toBe(2);
    const h = setup("main");
    field(h.b, "front", TITAN);
    expect(costOf(h.game, h.players, ctx, "a", n("016")).energy).toBe(2);
    // and it can really be played with the reduced energy
    h.a.hand = [n("016")];
    blue(h.a, 1); // 2 blue energy
    h.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(h.a.front).toHaveLength(1);
  });
  it("035: 1 less required energy while the opponent has a blue or red card on the field", () => {
    const g = setup("main");
    expect(costOf(g.game, g.players, ctx, "a", n("035")).energy).toBe(3);
    field(g.b, "front", TITAN); // green: no change
    expect(costOf(g.game, g.players, ctx, "a", n("035")).energy).toBe(3);
    field(g.b, "front", YMIR_VANILLA);
    expect(costOf(g.game, g.players, ctx, "a", n("035")).energy).toBe(2);
    const h = setup("main");
    field(h.b, "energy", EREN_RED);
    expect(costOf(h.game, h.players, ctx, "a", n("035")).energy).toBe(2);
    // played with 2 green energy
    h.a.hand = [n("035")];
    energy(h.a, 2, GREEN_ENERGY);
    h.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(h.a.front).toHaveLength(1);
  });
});

describe("Historia Reiss 020", () => {
  const A = n("032");
  const B = n("030");
  const C = n("029");
  it("When Played (no Ymir): look at 2 and put them back on top in the order chosen", () => {
    const g = setup("main");
    blue(g.a, 1);
    library(g.a, [A, B, C]);
    playFront(g, n("020"));
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1"]);
    pick(g, ["l:1", "l:0"]);
    expect(g.a.library.slice(0, 3)).toEqual([B, A, C]);
    expect(g.a.sideline).toEqual([]);
    expect(g.a.library).toHaveLength(30);
  });
  it("When Played (Ymir on the field, a name containing 'Ymir'): any number go on top in order, the rest to the sideline", () => {
    const g = setup("main");
    blue(g.a, 1);
    front(g, n("014")); // "Ymir (Jaw Titan)"
    library(g.a, [A, B, C]);
    playFront(g, n("020"));
    pick(g, ["l:1"]); // top card
    pick(g, ["l:0"]); // second
    expect(g.a.library.slice(0, 3)).toEqual([B, A, C]);
    expect(g.a.sideline).toEqual([]);
  });
  it("...one card kept on top, the other sidelined; or none kept", () => {
    const one = setup("main");
    blue(one.a, 1);
    front(one, n("013"));
    library(one.a, [A, B, C]);
    playFront(one, n("020"));
    pick(one, ["l:1"]);
    pick(one, []);
    expect(one.a.library.slice(0, 2)).toEqual([B, C]);
    expect(one.a.sideline).toEqual([A]);
    const none = setup("main");
    blue(none.a, 1);
    front(none, n("013"));
    library(none.a, [A, B, C]);
    playFront(none, n("020"));
    pick(none, []);
    expect(none.game.pending).toBeNull();
    expect(none.a.library[0]).toBe(C);
    expect(none.a.sideline).toEqual([A, B]);
  });
});

describe("Historia Reiss 021", () => {
  it("+500 BP while a character with 'Ymir' in its name is on your field", () => {
    const g = setup("main");
    const historia = front(g, n("021"));
    refresh(g);
    expect(bpOf(ctx, historia)).toBe(2500);
    front(g, n("014"));
    refresh(g);
    expect(bpOf(ctx, historia)).toBe(3000);
  });
  it("When Played: with an event used this turn, one AP card may become active; only once per turn for <Historia Reiss>", () => {
    const g = setup("main");
    blue(g.a, 3);
    useEvent(g, n("030")); // "choose up to two AP cards": choose none
    pick(g, []);
    expect(apRested(g)).toBe(1);
    playFront(g, n("021"));
    expect(choice(g.game, "a").options).toContain("ap:a:ap0");
    pick(g, ["ap:a:ap0"]);
    expect(apRested(g)).toBe(1); // one rested for the first play... the event and Historia each paid 1, then one switched back
    // a second copy: the ability cannot be activated again this turn
    playFront(g, n("021"));
    expect(g.game.pending).toBeNull();
  });
  it("When Played: with no event used this turn nothing happens", () => {
    const g = setup("main");
    blue(g.a, 2);
    playFront(g, n("021"));
    expect(g.game.pending).toBeNull();
    expect(apRested(g)).toBe(1);
  });
});

describe("Historia Reiss 022", () => {
  it("Raid onto a <Historia Reiss>", () => {
    const g = setup("main");
    expect(raidTargetMatches(ctx, ctx.card(n("022"))!, front(g, HISTORIA_VANILLA))).toBe(true);
    expect(raidTargetMatches(ctx, ctx.card(n("022"))!, front(g, YMIR_VANILLA))).toBe(false);
  });
  it("2+ events in the sideline: When Attacking, another [104th Cadet Corps] card gets +1000 BP (not with fewer events)", () => {
    const g = setup("attack");
    const historia = front(g, n("022"));
    const mikasa = front(g, EREN_RED); // 104th Cadet Corps／Levi Squad／Inheritor of the Titan
    const titan = field(g.a, "energy", TITAN); // not 104th
    sidelineEvents(g.a, 2);
    attack(g, historia.uid);
    const options = choice(g.game, "a").options;
    expect(options).toContain(mikasa.uid);
    expect(options).not.toContain(historia.uid);
    expect(options).not.toContain(titan.uid);
    pick(g, [mikasa.uid]);
    expect(bpOf(ctx, mikasa)).toBe(2500);
    const few = setup("attack");
    const other = front(few, n("022"));
    front(few, EREN_RED);
    sidelineEvents(few.a, 1);
    attack(few, other.uid);
    expect(few.game.pending?.kind).toBe("damage");
  });
  it("4+ events: Activate: Main (on the front line, once per turn): with an event used this turn, an AP card becomes active", () => {
    const g = setup("main");
    const historia = front(g, n("022"));
    sidelineEvents(g.a, 4);
    g.act("a", { type: "activate", uid: historia.uid, ability: 1 }); // no event used yet: nothing to choose
    expect(g.game.pending).toBeNull();
    expect(() => g.act("a", { type: "activate", uid: historia.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
    const h = setup("main");
    const other = front(h, n("022"));
    sidelineEvents(h.a, 4);
    useEvent(h, n("030"));
    pick(h, []);
    h.act("a", { type: "activate", uid: other.uid, ability: 1 });
    expect(choice(h.game, "a").options).toContain("ap:a:ap0");
    pick(h, ["ap:a:ap0"]);
    expect(h.a.ap[0]!.rested).toBe(false);
  });
  it("...not with fewer than 4 events, and not from the energy line", () => {
    const few = setup("main");
    const historia = front(few, n("022"));
    sidelineEvents(few.a, 3);
    expect(() => few.act("a", { type: "activate", uid: historia.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    const back = setup("main");
    const onEnergy = field(back.a, "energy", n("022"));
    sidelineEvents(back.a, 5);
    expect(() => back.act("a", { type: "activate", uid: onEnergy.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
  });
  it("6+ events: gains Impact (1)", () => {
    const g = setup("main");
    const historia = front(g, n("022"));
    sidelineEvents(g.a, 5);
    refresh(g);
    expect(impactOf(ctx, historia)).toBe(0);
    sidelineEvents(g.a, 6);
    refresh(g);
    expect(impactOf(ctx, historia)).toBe(1);
  });
});

describe("Mikasa Ackermann 023 / 024 / 025", () => {
  it("023 When Played: draw a card, then sideline one card from hand", () => {
    const g = setup("main");
    g.a.hand = [n("023"), EVENT_A];
    g.a.library = [EVENT_B, ...Array(29).fill(FILLER)];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(g.a.hand).toEqual([EVENT_A, EVENT_B]);
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1"]);
    pick(g, ["h:0"]);
    expect(g.a.sideline).toEqual([EVENT_A]);
    expect(g.a.hand).toEqual([EVENT_B]);
  });
  it("024: 2+ events in the sideline: +1 blue energy; 4+ events: +1000 BP", () => {
    const g = setup("main");
    const mikasa = field(g.a, "energy", n("024"));
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
  it("025 When Played: returns one character with 4000 or less BP from the opponent's front line (up to one)", () => {
    const g = setup("main");
    blue(g.a, 2);
    const small = field(g.b, "front", JEAN_RED);
    const big = field(g.b, "front", n("010"));
    big.bpMod = 1000; // 5000
    const back = field(g.b, "energy", EREN_RED); // not on the front line
    playFront(g, n("025"));
    expect(choice(g.game, "a").options).toEqual([small.uid]);
    expect(choice(g.game, "a").options).not.toContain(back.uid);
    pick(g, [small.uid]);
    expect(g.b.hand).toEqual([JEAN_RED]);
    expect(g.b.front.map((card) => card.uid)).toEqual([big.uid]);
  });
  it("025 When Played: choosing nobody leaves the field alone", () => {
    const g = setup("main");
    blue(g.a, 2);
    field(g.b, "front", JEAN_RED);
    playFront(g, n("025"));
    pick(g, []);
    expect(g.b.front).toHaveLength(1);
    expect(g.b.hand).toHaveLength(0);
  });
  it("025: the opponent cannot activate an Active trigger on damage dealt by it (other triggers still work)", () => {
    const run = (attackerNumber: string, lifeCard: string) => {
      const g = setup("attack");
      const attacker = front(g, attackerNumber);
      const defender = field(g.b, "front", EREN_RED, true);
      g.b.life[0]!.cardId = lifeCard;
      attack(g, attacker.uid);
      const lifeId = g.b.life[0]!.id;
      g.act("a", { type: "damage", lifeIds: [lifeId] });
      g.act("b", { type: "trigger", lifeId, activate: true, targetUid: defender.uid });
      return { g, defender };
    };
    const blocked = run(n("025"), n("001")); // 001's trigger is 《Active》
    expect(bpOf(ctx, blocked.defender)).toBe(1500);
    expect(blocked.g.b.sideline).toContain(n("001"));
    expect(blocked.defender.rested).toBe(true); // not switched to active
    const normal = run(TITAN, n("001")); // any other attacker: the trigger works
    expect(bpOf(ctx, normal.defender)).toBe(4500);
    expect(normal.defender.rested).toBe(false);
    // a different trigger on the same attacker is not affected (the Draw trigger of 023)
    const draws = run(n("025"), n("023"));
    expect(draws.g.b.hand).toHaveLength(1);
  });
});

describe("Eren Jaeger 026 / 027", () => {
  it("026: generates an extra blue energy only while active", () => {
    const g = setup("main");
    const eren = field(g.a, "energy", n("026"));
    refresh(g);
    expect(energyOf(ctx, g.a, "blue")).toBe(2);
    eren.rested = true;
    refresh(g);
    expect(energyOf(ctx, g.a, "blue")).toBe(1);
  });
  it("027 When Played: takes a blue event from the top 5 and then sidelines a card; non-blue events and characters do not qualify", () => {
    const g = setup("main");
    blue(g.a, 2);
    library(g.a, [YELLOW_EVENT, n("008"), EVENT_A, n("034"), FILLER]);
    g.a.hand = [n("027"), MIKASA_LOW];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(g.game, "a").options).toEqual(["l:2", "l:3"]); // Bombs and Levi's Barrage
    pick(g, ["l:3"]);
    expect(g.a.hand).toEqual([MIKASA_LOW, n("034")]);
    choice(g.game, "a"); // order of the remaining four
    pick(g, ["l:0", "l:1", "l:2", "l:3"]);
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1"]);
    pick(g, ["h:0"]);
    expect(g.a.sideline).toEqual([MIKASA_LOW]);
    expect(g.a.hand).toEqual([n("034")]);
    expect(g.a.library).toHaveLength(29);
  });
  it("027 When Played: no blue event in the top 5, or none chosen: nothing is sidelined", () => {
    const g = setup("main");
    blue(g.a, 2);
    library(g.a, [YELLOW_EVENT, n("008"), FILLER, FILLER, FILLER]);
    g.a.hand = [n("027"), MIKASA_LOW];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    choice(g.game, "a"); // the order of the five cards (nothing to take)
    pick(g, ["l:0", "l:1", "l:2", "l:3", "l:4"]);
    expect(g.game.pending).toBeNull();
    expect(g.a.hand).toEqual([MIKASA_LOW]);
    expect(g.a.sideline).toEqual([]);
    expect(hasKeyword(ctx, g.a.front[0]!, "冲击无效")).toBe(true);
  });
});

describe("Former Headquarters of the Scout Regiment 028", () => {
  const activateSite = (top: string) => {
    const g = setup("main");
    const site = field(g.a, "energy", n("028"));
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

describe("Events 029 - 034", () => {
  it("029 Memory: draw a card, sideline one card from hand, then up to one AP card becomes active", () => {
    const g = setup("main");
    g.a.library = [EVENT_A, ...Array(29).fill(FILLER)];
    g.a.hand = [n("029"), MIKASA_LOW];
    g.act("a", { type: "event", handIndex: 0 });
    expect(g.a.hand).toEqual([MIKASA_LOW, EVENT_A]);
    pick(g, ["h:0"]);
    expect(g.a.sideline).toEqual([MIKASA_LOW]);
    expect(choice(g.game, "a").options).toContain("ap:a:ap0");
    pick(g, ["ap:a:ap0"]);
    expect(apRested(g)).toBe(0);
    expect(g.a.sideline).toEqual([MIKASA_LOW, n("029")]); // the event goes to the sideline after it resolved
  });
  it("029: choosing no AP card leaves it resting", () => {
    const g = setup("main");
    g.a.hand = [n("029"), MIKASA_LOW];
    g.act("a", { type: "event", handIndex: 0 });
    pick(g, ["h:0"]);
    pick(g, []);
    expect(apRested(g)).toBe(1);
  });
  it("030: up to two AP cards become active; the trigger is FINAL", () => {
    const g = setup("main");
    g.a.ap[1]!.rested = true;
    g.a.ap[2]!.rested = true;
    g.a.hand = [n("030")];
    g.act("a", { type: "event", handIndex: 0 }); // pays the last active AP
    const c = choice(g.game, "a");
    expect(c.max).toBe(2);
    expect(c.min).toBe(0);
    pick(g, ["ap:a:ap0", "ap:a:ap2"]);
    expect(g.a.ap.map((card) => card.rested)).toEqual([false, true, false]);
    expect(ctx.card(n("030"))?.trigger?.label).toBe("最终");
  });
  it("030: picking only one (up to two) is allowed", () => {
    const g = setup("main");
    g.a.ap[1]!.rested = true;
    g.a.ap[2]!.rested = true;
    g.a.hand = [n("030")];
    g.act("a", { type: "event", handIndex: 0 });
    pick(g, ["ap:a:ap1"]);
    expect(g.a.ap.map((card) => card.rested)).toEqual([true, false, true]);
  });
  it("031 Cleanup: look at 2, put any number on top in any order, sideline the rest, then draw 2", () => {
    const g = setup("main");
    library(g.a, [EVENT_A, EVENT_B, EVENT_C, n("034")]);
    g.a.hand = [n("031")];
    g.act("a", { type: "event", handIndex: 0 });
    pick(g, ["l:1"]); // EVENT_B on top
    pick(g, ["l:0"]); // then EVENT_A
    expect(g.a.hand).toEqual([EVENT_B, EVENT_A]); // drew the two
    expect(g.a.sideline).toEqual([n("031")]);
    expect(g.a.library[0]).toBe(EVENT_C);
  });
  it("031: keeping only one on top; the other goes to the sideline", () => {
    const g = setup("main");
    library(g.a, [EVENT_A, EVENT_B, EVENT_C, n("034")]);
    g.a.hand = [n("031")];
    g.act("a", { type: "event", handIndex: 0 });
    pick(g, ["l:0"]);
    pick(g, []);
    expect(g.a.hand).toEqual([EVENT_A, EVENT_C]);
    expect(g.a.sideline).toEqual([EVENT_B, n("031")]);
  });
  it("032 Bombs: returns one opponent front-line character with 3500 or less BP (up to one)", () => {
    const g = setup("main");
    const small = field(g.b, "front", JEAN_RED);
    const big = field(g.b, "front", n("010")); // 4000
    const onEnergy = field(g.b, "energy", EREN_RED);
    g.a.hand = [n("032")];
    g.act("a", { type: "event", handIndex: 0 });
    expect(choice(g.game, "a").options).toEqual([small.uid]);
    pick(g, [small.uid]);
    expect(g.b.hand).toEqual([JEAN_RED]);
    expect(g.b.front.map((card) => card.uid)).toEqual([big.uid]);
    expect(g.b.energy.map((card) => card.uid)).toEqual([onEnergy.uid]);
    const none = setup("main");
    field(none.b, "front", JEAN_RED);
    none.a.hand = [n("032")];
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
      g.a.hand = [n("033")];
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
      g.a.hand = [n("033")];
      g.act("a", { type: "event", handIndex: 0 });
      expect(g.game.pending).toBeNull();
      expect(g.b.front).toHaveLength(0);
      expect(g.b.sideline).toEqual([n("004")]);
      expect(only.cardId).toBe(n("004"));
      const empty = setup("main");
      field(empty.b, "front", n("010"));
      empty.a.hand = [n("033")];
      empty.act("a", { type: "event", handIndex: 0 });
      expect(empty.game.pending).toBeNull();
      expect(empty.b.front).toHaveLength(1);
    });
  });
  describe("034 Levi's Barrage", () => {
    it("3000 or less BP; 5000 or less while <Levi> is on your field", () => {
      const g = setup("main");
      const small = field(g.b, "front", n("026")); // 2500
      const three = field(g.b, "front", n("002")); // 2500... use bpMod for exact values below
      three.bpMod = 500; // 3000
      const four = field(g.b, "front", n("025")); // 4000
      const five = field(g.b, "front", n("010"));
      five.bpMod = 1000; // 5000
      const six = field(g.b, "front", n("011"));
      six.bpMod = 1000; // 5000? (4000 + 1000)
      g.a.hand = [n("034"), n("034")];
      g.act("a", { type: "event", handIndex: 0 });
      expect(choice(g.game, "a").options.sort()).toEqual([small.uid, three.uid].sort());
      pick(g, [small.uid]);
      expect(g.b.sideline).toEqual([n("026")]);
      // now with <Levi> on the field
      front(g, n("008"));
      g.act("a", { type: "event", handIndex: 0 });
      expect(choice(g.game, "a").options.sort()).toEqual([three.uid, four.uid, five.uid, six.uid].sort());
    });
    it("is a 'choose one': a single candidate is sidelined at once", () => {
      const g = setup("main");
      field(g.b, "front", n("004"));
      g.a.hand = [n("034")];
      g.act("a", { type: "event", handIndex: 0 });
      expect(g.game.pending).toBeNull();
      expect(g.b.front).toHaveLength(0);
    });
  });
  it("034 and 033 have the [SPECIAL] trigger (sideline an opponent's front-line character)", () => {
    expect(ctx.card(n("034"))?.trigger?.label).toBe("特殊");
    expect(ctx.card(n("033"))?.trigger?.label).toBe("特殊");
  });
});
