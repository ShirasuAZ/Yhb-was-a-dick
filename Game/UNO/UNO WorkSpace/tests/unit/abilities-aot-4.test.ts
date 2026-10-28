/**
 * AOT (进击的巨人) batch 4: UE10ST/AOT-1-075 … 113 (starter deck) and UEPR/AOT-1-001 … 023 (promo reprints of the blue cards). One test (or more) per
 * card, set up as the printed English text describes and checked against it. Cards are addressed by number through the shared harness.
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, energyOf, flagsOf, hasKeyword, impactOf, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { CARD_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";

const ST = (suffix: string): string => `UE10ST/AOT-1-${suffix}`;
const PR = (suffix: string): string => `UEPR/AOT-1-${suffix}`;
const BT = (suffix: string): string => `UE10BT/AOT-1-${suffix}`;

// Energy sources and helper cards without abilities.
const RED_E = "UC01BT/ARK-1-088"; // 九: red, cost 0, BP 2000, makes 1 red energy (not a [104th Cadet Corps])
const BLUE_E = BT("002"); // Erwin Smith: blue, cost 3, makes 2 blue energy (never a cheap bounce candidate)
const GREEN_E3 = BT("060"); // Reiner Braun: green, makes 3 green energy (its only ability is a When Played)
const GREEN_E1 = BT("045"); // Zeke Jaeger (0): green, makes 1 green energy, no text
const ANNIE = ST("101"); // Annie Leonhart: red, cost 0, AP 1, BP 2000, [104th Cadet Corps], no text
const BERTHOLDT = ST("102"); // Bertholdt Hoover: red, cost 3, AP 1, BP 3000, [104th Cadet Corps], no text
const EREN_0 = ST("090"); // Eren Jaeger: red, cost 0, BP 1500, [104th Cadet Corps／Levi Squad／Inheritor of the Titan], no text
const MIKASA_0 = ST("085"); // Mikasa Ackermann: red, cost 0, BP 2000, [104th Cadet Corps／Levi Squad], no text
const YMIR_0 = PR("012"); // Ymir: blue, cost 0, BP 1500, [104th Cadet Corps／Inheritor of the Titan], no text
const HISTORIA_0 = PR("019"); // Historia Reiss: blue, cost 0, BP 1500, no text
const LEVI_0 = PR("007"); // Levi: blue, cost 0, BP 1500, [Levi Squad], no text
const TITAN = BT("042"); // Pure Titan: green, cost 0, BP 2000, no text
const KINGSLAYER = "UC01BT/ARK-1-004"; // yellow, cost 0, BP 1500 (the harness filler)
const TEXAS = "UC01BT/ARK-1-074"; // cost 1, BP 2500
const GUARD = "UC01ST/ARK-1-103"; // cost 3, BP 3000
const TALULAH = "UC01ST/ARK-1-110"; // cost 5, BP 4000
const MON3TR = "UC01BT/ARK-1-054"; // cost 7, BP 4500
const EVENT_A = BT("032"); // Bombs (blue event)
const FILLER = KINGSLAYER;

type Game = ReturnType<typeof setup>;
const red = (owner: EnginePlayer, count: number): void => energy(owner, count, RED_E);
const blue = (owner: EnginePlayer, count: number): void => energy(owner, count, BLUE_E);
const green = (owner: EnginePlayer, count: number): void => energy(owner, count, GREEN_E3);
const pick = (g: Game, picks: string[], who = "a"): void => g.act(who, { type: "choose", picks });
const yes = (g: Game): void => { choice(g.game, "a"); pick(g, ["yes"]); };
const no = (g: Game): void => { choice(g.game, "a"); pick(g, ["no"]); };
/** Puts `number` into hand and plays it. */
function play(g: Game, number: string, line: "front" | "energy" = "front"): void {
  g.a.hand.push(number);
  g.act("a", { type: "play", handIndex: g.a.hand.length - 1, line });
}
const useEvent = (g: Game, number: string): void => { g.a.hand.push(number); g.act("a", { type: "event", handIndex: g.a.hand.length - 1 }); };
const front = (g: Game, number: string, rested = false): UnionArenaFieldCard => field(g.a, "front", number, rested);
/** A harmless manual operation: the engine recomputes continuous effects after every action. */
const refresh = (g: Game): void => g.act("a", { type: "manual", manual: { op: "draw" } });
const attack = (g: Game, uid: string): void => g.act("a", { type: "attack", attackerUid: uid } as UnionArenaAction);
const apRested = (g: Game): number => g.a.ap.filter((card) => card.rested).length;
const activeAp = (owner: EnginePlayer): number => owner.ap.filter((card) => !card.rested).length;
const library = (owner: EnginePlayer, top: string[]): void => { owner.library = [...top, ...Array(30 - top.length).fill(FILLER)]; };
const sorted = (list: string[]): string[] => [...list].sort();

describe("AOT batch 4: every card is automatic", () => {
  const stNumbers = [75, 84, 85, 87, 90, 91, 97, 101, 102, 104, 105, 106, 107, 108, 109, 110, 111, 112].map((n) => ST(String(n).padStart(3, "0")));
  const prNumbers = ["001", "003", "004", "005", "006", "007", "008", "012", "013", "015", "016", "019", "020", "023"].map(PR);
  it("has an ability entry (or is keyword-only / printed '-') for the 32 automated cards", () => {
    expect(stNumbers.length + prNumbers.length).toBe(32);
    for (const number of [...stNumbers, ...prNumbers]) expect(isAutomated(titleCard(number)), number).toBe(true);
  });
  it("Colossal Titan 113 is left out (it changes the front-line limit), so it stays manual", () => {
    expect(CARD_ABILITIES[ST("113")]).toBeUndefined();
    expect(isAutomated(titleCard(ST("113")))).toBe(false);
  });
  it("cards printed with '-' have an empty entry (or none) and playing one does nothing", () => {
    for (const number of [ST("085"), ST("090"), ST("101"), ST("102"), PR("001"), PR("007"), PR("012"), PR("019")]) {
      expect(titleCard(number).stats.abilityText).toBe("-");
      expect(CARD_ABILITIES[number] ?? [], number).toEqual([]);
      const g = setup("main");
      red(g.a, 3);
      play(g, number);
      expect(g.game.pending, number).toBeNull();
      expect(g.a.front).toHaveLength(1);
    }
  });
});

describe("Armin Arlelt ST-075", () => {
  it("When Played: draws a card, then one card from hand is placed into the sideline (the drawn one can be chosen)", () => {
    const g = setup("main");
    library(g.a, [EVENT_A]);
    g.a.hand = [ST("075"), TEXAS];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(g.a.hand).toEqual([TEXAS, EVENT_A]);
    expect(choice(g.game, "a").options).toEqual(["h:0", "h:1"]);
    pick(g, ["h:1"]);
    expect(g.a.sideline).toEqual([EVENT_A]);
    expect(g.a.hand).toEqual([TEXAS]);
    expect(g.a.library).toHaveLength(29);
  });
});

describe("Jean Kirschtein ST-084", () => {
  it("Activate: Main (rest): one other character gains 1000 BP; it cannot be Jean himself, and Jean must be active", () => {
    const g = setup("main");
    const jean = front(g, ST("084"));
    const mikasa = front(g, MIKASA_0);
    const nine = front(g, RED_E);
    g.act("a", { type: "activate", uid: jean.uid, ability: 0 });
    expect(jean.rested).toBe(true);
    expect(sorted(choice(g.game, "a").options)).toEqual(sorted([mikasa.uid, nine.uid]));
    pick(g, [mikasa.uid]);
    expect(bpOf(ctx, mikasa)).toBe(3000);
    expect(bpOf(ctx, nine)).toBe(2000);
    expect(bpOf(ctx, jean)).toBe(2000);
    expect(() => g.act("a", { type: "activate", uid: jean.uid, ability: 0 })).toThrow(); // already resting
  });
  it("the bonus lasts until the end of the turn", () => {
    const g = setup("main");
    const jean = front(g, ST("084"));
    const mikasa = front(g, MIKASA_0);
    g.act("a", { type: "activate", uid: jean.uid, ability: 0 }); // Mikasa is the only other character: chosen at once
    expect(bpOf(ctx, mikasa)).toBe(3000);
    g.act("a", { type: "end_turn" });
    expect(bpOf(ctx, mikasa)).toBe(2000);
  });
});

describe("Mikasa Ackermann ST-087", () => {
  it("If this character is active, it gains Red energy generation (rested: the printed 1 only)", () => {
    const g = setup("main");
    const mikasa = field(g.a, "energy", ST("087"));
    refresh(g);
    expect(energyOf(ctx, g.a, "red")).toBe(2);
    mikasa.rested = true;
    refresh(g);
    expect(energyOf(ctx, g.a, "red")).toBe(1);
  });
});

describe("Eren Jaeger ST-091", () => {
  it("has Step", () => {
    expect(hasKeyword(ctx, field(setup("main").a, "front", ST("091")), "撤步")).toBe(true);
  });
  it("Activate: Main (front line, once per turn): a life card goes to the hand and Eren gains 1000 BP", () => {
    const g = setup("main");
    g.a.life[0]!.cardId = EVENT_A;
    const eren = front(g, ST("091"));
    g.act("a", { type: "activate", uid: eren.uid, ability: 0 });
    expect(g.a.life).toHaveLength(6);
    expect(g.a.hand).toEqual([EVENT_A]);
    expect(bpOf(ctx, eren)).toBe(4000);
    expect(() => g.act("a", { type: "activate", uid: eren.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });
  it("only works on the front line", () => {
    const g = setup("main");
    const eren = field(g.a, "energy", ST("091"));
    expect(() => g.act("a", { type: "activate", uid: eren.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    expect(g.a.life).toHaveLength(7);
    expect(g.a.hand).toEqual([]);
  });
});

describe("Dedicate Your Heart!! ST-097", () => {
  it("switches up to two of your AP cards to active", () => {
    const g = setup("main");
    useEvent(g, ST("097")); // pays 1 AP
    g.a.ap[1]!.rested = true;
    expect(activeAp(g.a)).toBe(1);
    expect(choice(g.game, "a").options).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
    pick(g, ["ap:a:ap0", "ap:a:ap1"]);
    expect(activeAp(g.a)).toBe(3);
  });
  it("'up to' lets you pick one or none", () => {
    const g = setup("main");
    useEvent(g, ST("097"));
    pick(g, ["ap:a:ap0"]);
    expect(activeAp(g.a)).toBe(3);
    const h = setup("main");
    useEvent(h, ST("097"));
    pick(h, []);
    expect(activeAp(h.a)).toBe(2);
  });
});

describe("Armin Arlelt ST-104", () => {
  const MODES = ["m:0", "m:1"];
  it("When Played on the energy line: choose one of two effects", () => {
    const g = setup("main");
    red(g.a, 3);
    play(g, ST("104"), "energy");
    expect(choice(g.game, "a").options).toEqual(MODES);
  });
  it("When Played on the front line: nothing happens", () => {
    const g = setup("main");
    red(g.a, 3);
    play(g, ST("104"), "front");
    expect(g.game.pending).toBeNull();
    expect(g.a.hand).toEqual([]);
  });
  it("mode 1: looks at the top 3, takes up to one [104th Cadet Corps] card with 3 or less required energy, the rest go to the bottom in order", () => {
    const g = setup("main");
    red(g.a, 3);
    // Offered: Bertholdt (cadet, cost 3). Not offered: Reiner 060 (cadet, cost 5), 九 (cost 0 but not a cadet).
    library(g.a, [RED_E, BERTHOLDT, GREEN_E3]);
    play(g, ST("104"), "energy");
    pick(g, ["m:0"]);
    expect(choice(g.game, "a").options).toEqual(["l:1"]);
    pick(g, ["l:1"]);
    expect(g.a.hand).toEqual([BERTHOLDT]);
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1"]); // the two left: 九 and Reiner
    pick(g, ["l:1", "l:0"]);
    expect(g.a.library).toHaveLength(29);
    expect(g.a.library.slice(-2)).toEqual([GREEN_E3, RED_E]);
    expect(g.game.pending).toBeNull();
  });
  it("mode 1: 'up to one' allows taking none", () => {
    const g = setup("main");
    red(g.a, 3);
    library(g.a, [ANNIE, BERTHOLDT, EREN_0]);
    play(g, ST("104"), "energy");
    pick(g, ["m:0"]);
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1", "l:2"]);
    pick(g, []);
    pick(g, ["l:0", "l:1", "l:2"]);
    expect(g.a.hand).toEqual([]);
    expect(g.a.library.slice(-3)).toEqual([ANNIE, BERTHOLDT, EREN_0]);
  });
  it("mode 2: plays a red [104th Cadet Corps] card (3 or less energy, 1 AP) from the hand onto the front line, active; it returns to the hand when the attack phase ends", () => {
    const g = setup("main");
    red(g.a, 3);
    // Offered: Annie, Bertholdt. Not offered: 九 (not a cadet), Ymir (blue), Mikasa 105 (cost 4, AP 2).
    g.a.hand = [ST("104"), ANNIE, BERTHOLDT, RED_E, YMIR_0, ST("105")];
    g.act("a", { type: "play", handIndex: 0, line: "energy" });
    pick(g, ["m:1"]);
    expect(sorted(choice(g.game, "a").options)).toEqual(["h:0", "h:1"]);
    pick(g, ["h:0"]);
    const annie = g.a.front.find((card) => card.cardId === ANNIE)!;
    expect(annie).toBeDefined();
    expect(annie.rested).toBe(false); // set to active
    expect(g.a.hand).toEqual([BERTHOLDT, RED_E, YMIR_0, ST("105")]);
    expect(g.a.energy.some((card) => card.cardId === ST("104"))).toBe(true); // Armin himself stays
    g.act("a", { type: "next_phase" }); // movement/main -> attack
    expect(g.game.phase).toBe("attack");
    expect(g.a.front).toContain(annie);
    g.act("a", { type: "next_phase" }); // the attack phase ends
    expect(g.a.front.map((card) => card.cardId)).not.toContain(ANNIE);
    expect(g.a.hand).toContain(ANNIE);
    expect(g.a.energy.some((card) => card.cardId === ST("104"))).toBe(true);
  });
  it("mode 2: 'up to one' allows playing none, and nothing returns", () => {
    const g = setup("main");
    red(g.a, 3);
    g.a.hand = [ST("104"), ANNIE];
    g.act("a", { type: "play", handIndex: 0, line: "energy" });
    pick(g, ["m:1"]);
    pick(g, []);
    expect(g.a.front).toHaveLength(0);
    expect(g.a.hand).toEqual([ANNIE]);
  });
});

describe("Mikasa Ackermann ST-105", () => {
  it("has Impact (1)", () => {
    const g = setup("main");
    const mikasa = front(g, ST("105"));
    refresh(g);
    expect(impactOf(ctx, mikasa)).toBe(1);
  });
  it("is played active when a character with 'Eren Jaeger' in its name is on your field", () => {
    const g = setup("main");
    red(g.a, 4);
    field(g.a, "energy", EREN_0);
    play(g, ST("105"));
    const mikasa = g.a.front[0]!;
    expect(mikasa.cardId).toBe(ST("105"));
    expect(mikasa.rested).toBe(false);
  });
  it("...also for an Eren with a longer name (a name containing 'Eren Jaeger')", () => {
    const g = setup("main");
    red(g.a, 4);
    front(g, ST("107"));
    play(g, ST("105"));
    expect(g.a.front.find((card) => card.cardId === ST("105"))!.rested).toBe(false);
  });
  it("is played resting otherwise (no Eren, or only the opponent has one)", () => {
    const none = setup("main");
    red(none.a, 4);
    play(none, ST("105"));
    expect(none.a.front[0]!.rested).toBe(true);
    const theirs = setup("main");
    red(theirs.a, 4);
    field(theirs.b, "front", EREN_0);
    play(theirs, ST("105"));
    expect(theirs.a.front[0]!.rested).toBe(true);
  });
});

describe("Eren Jaeger ST-106", () => {
  it("gains 1000 BP when you have 3 or less life", () => {
    const g = setup("main");
    const eren = front(g, ST("106"));
    refresh(g);
    expect(bpOf(ctx, eren)).toBe(3000);
    g.a.life = g.a.life.slice(0, 4);
    refresh(g);
    expect(bpOf(ctx, eren)).toBe(3000); // 4 life: not yet
    g.a.life = g.a.life.slice(0, 3);
    refresh(g);
    expect(bpOf(ctx, eren)).toBe(4000);
    g.a.life = g.a.life.slice(0, 1);
    refresh(g);
    expect(bpOf(ctx, eren)).toBe(4000);
  });
  it("the opponent's life does not count", () => {
    const g = setup("main");
    const eren = front(g, ST("106"));
    g.b.life = g.b.life.slice(0, 2);
    refresh(g);
    expect(bpOf(ctx, eren)).toBe(3000);
  });
});

describe("Eren Jaeger ST-107", () => {
  it("Raid <Eren Jaeger>; When Played: draws a card", () => {
    const g = setup("main");
    red(g.a, 6);
    const base = front(g, EREN_0);
    g.a.hand = [ST("107")];
    library(g.a, [EVENT_A]);
    g.act("a", { type: "raid", handIndex: 0, targetUid: base.uid });
    expect(base.cardId).toBe(ST("107"));
    expect(g.a.hand).toEqual([EVENT_A]);
  });
  it("Activate: Main (front line): a life card goes into the sideline, then up to one AP card is switched to active", () => {
    const g = setup("main");
    g.a.life[0]!.cardId = EVENT_A;
    g.a.ap[0]!.rested = true;
    g.a.ap[1]!.rested = true;
    const eren = front(g, ST("107"));
    g.act("a", { type: "activate", uid: eren.uid, ability: 1 });
    expect(g.a.life).toHaveLength(6);
    expect(g.a.sideline).toEqual([EVENT_A]);
    expect(choice(g.game, "a").options).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
    pick(g, ["ap:a:ap1"]);
    expect(g.a.ap.map((card) => card.rested)).toEqual([true, false, false]);
  });
  it("'up to one' AP card: choosing none leaves them resting, but the life card is already placed", () => {
    const g = setup("main");
    g.a.ap[0]!.rested = true;
    const eren = front(g, ST("107"));
    g.act("a", { type: "activate", uid: eren.uid, ability: 1 });
    pick(g, []);
    expect(g.a.life).toHaveLength(6);
    expect(g.a.ap[0]!.rested).toBe(true);
  });
  it("can only be activated from the front line", () => {
    const g = setup("main");
    const eren = field(g.a, "energy", ST("107"));
    expect(() => g.act("a", { type: "activate", uid: eren.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    expect(g.a.life).toHaveLength(7);
  });
  it("this <Eren Jaeger> ability can only be activated one time each turn (even by a second copy), and again the next turn", () => {
    const g = setup("main");
    const first = front(g, ST("107"));
    const second = front(g, ST("107"));
    g.act("a", { type: "activate", uid: first.uid, ability: 1 });
    pick(g, []);
    expect(() => g.act("a", { type: "activate", uid: second.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    expect(() => g.act("a", { type: "activate", uid: first.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    expect(g.a.life).toHaveLength(6);
    g.game.turn += 2; // the owner's next turn (the once-per-turn marks are per turn number)
    g.act("a", { type: "activate", uid: second.uid, ability: 1 });
    expect(g.a.life).toHaveLength(5);
  });
});

describe("Cadet Corps Grounds ST-108 (site)", () => {
  const cadets = (g: Game, count: number): void => { for (let index = 0; index < count; index += 1) field(g.a, index < 3 ? "front" : "energy", ANNIE); };
  it("is played active with five or more [104th Cadet Corps] cards on your field", () => {
    const g = setup("main");
    cadets(g, 5);
    play(g, ST("108"), "energy");
    const site = g.a.energy.find((card) => card.cardId === ST("108"))!;
    expect(site.rested).toBe(false);
  });
  it("is played resting with four or fewer (non-cadets do not count)", () => {
    const g = setup("main");
    cadets(g, 4);
    front(g, RED_E);
    play(g, ST("108"), "energy");
    expect(g.a.energy.find((card) => card.cardId === ST("108"))!.rested).toBe(true);
  });
  it("Activate: Main (rest, sideline this card): all [104th Cadet Corps] cards on your field gain 1000 BP", () => {
    const g = setup("main");
    const annie = front(g, ANNIE);
    const eren = field(g.a, "energy", EREN_0);
    const nine = front(g, RED_E);
    const theirs = field(g.b, "front", ANNIE);
    const site = field(g.a, "energy", ST("108"));
    g.act("a", { type: "activate", uid: site.uid, ability: 1 });
    expect(g.a.sideline).toEqual([ST("108")]);
    expect(g.a.energy).not.toContain(site);
    expect(bpOf(ctx, annie)).toBe(3000);
    expect(bpOf(ctx, eren)).toBe(2500);
    expect(bpOf(ctx, nine)).toBe(2000); // not a cadet
    expect(bpOf(ctx, theirs)).toBe(2000); // the opponent's field is not affected
  });
  it("cannot be activated while resting", () => {
    const g = setup("main");
    front(g, ANNIE);
    const site = field(g.a, "energy", ST("108"), true);
    expect(() => g.act("a", { type: "activate", uid: site.uid, ability: 1 })).toThrow();
    expect(g.a.sideline).toEqual([]);
  });
});

describe("104th Cadet Corps ST-109 (event)", () => {
  it("sidelines an opponent front-line character with BP at most 1000 x the number of [104th Cadet Corps] cards on your field", () => {
    const g = setup("main");
    front(g, ANNIE);
    field(g.a, "energy", EREN_0);
    front(g, RED_E); // not a cadet
    const nine = field(g.b, "front", RED_E); // 2000
    const texas = field(g.b, "front", TEXAS); // 2500
    const kingslayer = field(g.b, "front", KINGSLAYER); // 1500
    useEvent(g, ST("109"));
    expect(sorted(choice(g.game, "a").options)).toEqual(sorted([nine.uid, kingslayer.uid]));
    expect(choice(g.game).options).not.toContain(texas.uid);
    pick(g, [nine.uid]);
    expect(g.b.sideline).toEqual([RED_E]);
    expect(g.b.front.map((card) => card.uid)).toEqual([texas.uid, kingslayer.uid]);
  });
  it("counts cards on the field only (not the sideline), so more cadets raise the limit", () => {
    const g = setup("main");
    front(g, ANNIE);
    g.a.sideline = [ANNIE, ANNIE, ANNIE];
    field(g.a, "energy", EREN_0);
    field(g.a, "energy", MIKASA_0);
    const texas = field(g.b, "front", TEXAS);
    const guard = field(g.b, "front", GUARD);
    useEvent(g, ST("109"));
    // 3 cadets on the field: 3000
    expect(sorted(choice(g.game, "a").options)).toEqual(sorted([texas.uid, guard.uid]));
    pick(g, [guard.uid]);
    expect(g.b.sideline).toEqual([GUARD]);
  });
  it("only the opponent's front line is chosen from, and with nothing in range nothing happens", () => {
    const g = setup("main");
    front(g, ANNIE); // limit 1000
    field(g.b, "energy", KINGSLAYER);
    const guard = field(g.b, "front", GUARD);
    useEvent(g, ST("109"));
    expect(g.game.pending).toBeNull();
    expect(g.b.sideline).toEqual([]);
    expect(g.b.front).toContain(guard);
  });
});

describe("Levi ST-110", () => {
  it("When Played: an opponent front-line character with 2500 or more BP loses 2000 BP this turn", () => {
    const g = setup("main");
    blue(g.a, 5);
    const nine = field(g.b, "front", RED_E); // 2000: not offered
    const texas = field(g.b, "front", TEXAS); // 2500
    const mon3tr = field(g.b, "front", MON3TR); // 4500
    const energyLine = field(g.b, "energy", GUARD); // not on the front line
    play(g, ST("110"));
    expect(sorted(choice(g.game, "a").options)).toEqual(sorted([texas.uid, mon3tr.uid]));
    expect(choice(g.game).options).not.toContain(nine.uid);
    expect(choice(g.game).options).not.toContain(energyLine.uid);
    pick(g, [mon3tr.uid]);
    expect(bpOf(ctx, mon3tr)).toBe(2500);
    expect(bpOf(ctx, texas)).toBe(2500);
    g.act("a", { type: "end_turn" });
    expect(bpOf(ctx, mon3tr)).toBe(4500);
  });
  it("When Played: 'up to one' allows choosing none", () => {
    const g = setup("main");
    blue(g.a, 5);
    const texas = field(g.b, "front", TEXAS);
    play(g, ST("110"));
    pick(g, []);
    expect(bpOf(ctx, texas)).toBe(2500);
  });
  it("Raid <Levi>", () => {
    const g = setup("main");
    blue(g.a, 5);
    const base = front(g, LEVI_0);
    g.a.hand = [ST("110")];
    g.act("a", { type: "raid", handIndex: 0, targetUid: base.uid });
    expect(base.cardId).toBe(ST("110"));
  });
  it("When Attacking: pay 1 AP, then an opponent front-line character with 2000 or less BP returns to its hand", () => {
    const g = setup("attack");
    const levi = front(g, ST("110"));
    const nine = field(g.b, "front", RED_E, true); // 2000
    const kingslayer = field(g.b, "front", KINGSLAYER, true); // 1500
    const texas = field(g.b, "front", TEXAS, true); // 2500: not offered
    attack(g, levi.uid);
    yes(g);
    expect(apRested(g)).toBe(1);
    expect(sorted(choice(g.game, "a").options)).toEqual(sorted([nine.uid, kingslayer.uid]));
    expect(choice(g.game).options).not.toContain(texas.uid);
    pick(g, [nine.uid]);
    expect(g.b.hand).toEqual([RED_E]);
    expect(g.b.front.map((card) => card.uid)).toEqual([kingslayer.uid, texas.uid]);
  });
  it("When Attacking: declining the payment (or choosing none) changes nothing", () => {
    const declined = setup("attack");
    const levi = front(declined, ST("110"));
    field(declined.b, "front", RED_E, true);
    attack(declined, levi.uid);
    no(declined);
    expect(apRested(declined)).toBe(0);
    expect(declined.b.hand).toEqual([]);
    const none = setup("attack");
    const levi2 = front(none, ST("110"));
    field(none.b, "front", RED_E, true);
    attack(none, levi2.uid);
    yes(none);
    pick(none, []);
    expect(apRested(none)).toBe(1);
    expect(none.b.hand).toEqual([]);
  });
  it("When Attacking: not offered without an active AP card", () => {
    const g = setup("attack");
    g.a.ap.forEach((card) => { card.rested = true; });
    const levi = front(g, ST("110"));
    field(g.b, "front", RED_E, true);
    attack(g, levi.uid);
    expect(g.game.pending?.kind === "choose" && (g.game.pending as { options: string[] }).options.includes("yes")).toBe(false);
    expect(g.b.hand).toEqual([]);
  });
});

describe("Erwin Smith ST-111", () => {
  it("If on the Front Line: at the start of your attack phase, if active, one AP card may be switched to active", () => {
    const g = setup("main");
    g.a.ap[0]!.rested = true;
    front(g, ST("111"));
    g.act("a", { type: "next_phase" });
    expect(g.game.phase).toBe("attack");
    expect(choice(g.game, "a").options).toContain("ap:a:ap0");
    pick(g, ["ap:a:ap0"]);
    expect(g.a.ap[0]!.rested).toBe(false);
  });
  it("...up to one: choosing none leaves it resting", () => {
    const g = setup("main");
    g.a.ap[0]!.rested = true;
    front(g, ST("111"));
    g.act("a", { type: "next_phase" });
    pick(g, []);
    expect(g.a.ap[0]!.rested).toBe(true);
  });
  it("...but not when it is resting or not on the front line", () => {
    const rested = setup("main");
    rested.a.ap[0]!.rested = true;
    front(rested, ST("111"), true);
    rested.act("a", { type: "next_phase" });
    expect(rested.game.pending).toBeNull();
    const back = setup("main");
    back.a.ap[0]!.rested = true;
    field(back.a, "energy", ST("111"));
    back.act("a", { type: "next_phase" });
    expect(back.game.pending).toBeNull();
    expect(back.a.ap[0]!.rested).toBe(true);
  });
  it("When Attacking: pay 1 AP, then this character gains 500 BP until the end of the turn", () => {
    const g = setup("attack");
    const erwin = front(g, ST("111"));
    attack(g, erwin.uid);
    yes(g);
    expect(apRested(g)).toBe(1);
    expect(bpOf(ctx, erwin)).toBe(4000);
  });
  it("When Attacking: declining gives nothing", () => {
    const g = setup("attack");
    const erwin = front(g, ST("111"));
    attack(g, erwin.uid);
    no(g);
    expect(apRested(g)).toBe(0);
    expect(bpOf(ctx, erwin)).toBe(3500);
  });
});

describe("Armored Titan ST-112", () => {
  const targets = () => {
    const g = setup("main");
    const nine = field(g.b, "front", RED_E); // 2000
    const texas = field(g.b, "front", TEXAS); // 2500
    const talulah = field(g.b, "front", TALULAH); // 4000
    const mon3tr = field(g.b, "front", MON3TR); // 4500
    return { g, nine, texas, talulah, mon3tr };
  };
  it("When Played: sidelines an opponent front-line character with 2000 or less BP (with less than 8 energy generation)", () => {
    const { g, nine, texas } = targets();
    green(g.a, 2);
    field(g.a, "energy", GREEN_E1); // 7 green
    expect(energyOf(ctx, g.a, "green")).toBe(7);
    play(g, ST("112"));
    expect(choice(g.game, "a").options).toEqual([nine.uid]);
    expect(choice(g.game).options).not.toContain(texas.uid);
    pick(g, [nine.uid]);
    expect(g.b.sideline).toEqual([RED_E]);
  });
  it("When Played: with 8 or more energy generation the limit is 4000 instead", () => {
    const { g, nine, texas, talulah, mon3tr } = targets();
    green(g.a, 2);
    field(g.a, "energy", GREEN_E1);
    field(g.a, "energy", GREEN_E1); // 8 green
    expect(energyOf(ctx, g.a, "green")).toBe(8);
    play(g, ST("112"));
    expect(sorted(choice(g.game, "a").options)).toEqual(sorted([nine.uid, texas.uid, talulah.uid]));
    expect(choice(g.game).options).not.toContain(mon3tr.uid);
    pick(g, [talulah.uid]);
    expect(g.b.sideline).toEqual([TALULAH]);
  });
  it("When Played: counts all colours of energy generation, and 'up to one' allows none", () => {
    const { g, nine } = targets();
    green(g.a, 2); // 6 green
    blue(g.a, 1); // + 2 blue = 8
    play(g, ST("112"));
    expect(choice(g.game, "a").options).toHaveLength(3);
    pick(g, []);
    expect(g.b.sideline).toEqual([]);
    expect(g.b.front).toContain(nine);
  });
  it("During Opponent's Turn: an ability of the opponent's character or event cannot choose it unless they pay 1 AP more", () => {
    const g = setup("main");
    const titan = field(g.b, "front", ST("112"));
    field(g.a, "front", BT("045")); // Zeke Jaeger on my field: Perfect Game may take BP 5000 or less
    useEvent(g, BT("066"));
    // The Armored Titan is the only candidate: chosen at once, and 1 AP is paid on top of the event's 1 AP.
    expect(g.game.pending).toBeNull();
    expect(g.b.sideline).toEqual([ST("112")]);
    expect(g.b.front).not.toContain(titan);
    expect(activeAp(g.a)).toBe(1);
  });
  it("During Opponent's Turn: the mark only exists in the opponent's turn", () => {
    const { g } = (() => {
      const game = setup("main", "b");
      return { g: game };
    })();
    const titan = field(g.b, "front", ST("112"));
    expect(flagsOf(titan)).not.toContain("taxAp:character");
    g.act("b", { type: "end_turn" });
    expect(g.game.turnPlayerId).toBe("a");
    expect(flagsOf(titan)).toContain("taxAp:character");
    expect(flagsOf(titan)).toContain("taxAp:event");
  });
});

describe("Colossal Titan ST-113", () => {
  it("is not automated (it changes the number of cards that can be placed onto the front line)", () => {
    expect(isAutomated(titleCard(ST("113")))).toBe(false);
  });
});

describe("Hange Zoë PR-003", () => {
  const prepare = () => {
    const g = setup("main");
    blue(g.a, 2);
    const titan = field(g.a, "energy", TITAN);
    const ymir = field(g.b, "front", YMIR_0);
    const restedEren = field(g.b, "front", EREN_0, true);
    g.a.hand = [PR("003")];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    return { g, titan, ymir, restedEren };
  };
  it("may rest an active Inheritor/Titan card on either field; the opponent's owner draws", () => {
    const { g, titan, ymir, restedEren } = prepare();
    expect(choice(g.game, "a").options).toEqual(["yes", "no"]);
    pick(g, ["yes"]);
    expect(sorted(choice(g.game, "a").options)).toEqual(sorted([titan.uid, ymir.uid]));
    expect(choice(g.game).options).not.toContain(restedEren.uid);
    pick(g, [ymir.uid]);
    expect(ymir.rested).toBe(true);
    expect(g.b.hand).toHaveLength(1);
    expect(g.a.hand).toHaveLength(0);
  });
  it("choosing one's own card: you draw; declining does nothing", () => {
    const own = prepare();
    pick(own.g, ["yes"]);
    pick(own.g, [own.titan.uid]);
    expect(own.titan.rested).toBe(true);
    expect(own.g.a.hand).toHaveLength(1);
    const declined = prepare();
    pick(declined.g, ["no"]);
    expect(declined.titan.rested).toBe(false);
    expect(declined.g.a.hand).toHaveLength(0);
    expect(declined.g.b.hand).toHaveLength(0);
  });
});

describe("Eld Gin PR-004", () => {
  it("During Your Turn: gains 2000 BP once you paid an AP cost during the attack phase this turn", () => {
    const g = setup("attack");
    const eld = front(g, PR("004"));
    const levi = front(g, PR("008"));
    refresh(g);
    expect(bpOf(ctx, eld)).toBe(1500);
    attack(g, levi.uid);
    yes(g); // Levi's 1 AP
    expect(bpOf(ctx, eld)).toBe(3500);
    const lifeId = g.b.life[0]!.id;
    g.act("a", { type: "damage", lifeIds: [lifeId] });
    g.act("b", { type: "trigger", lifeId, activate: false });
    g.act("a", { type: "end_turn" });
    expect(g.game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, eld)).toBe(1500);
  });
  it("no bonus without having paid", () => {
    const g = setup("attack");
    const eld = front(g, PR("004"));
    refresh(g);
    expect(bpOf(ctx, eld)).toBe(1500);
  });
});

describe("Oruo Bozad PR-005", () => {
  it("Activate: Main (rest, once per turn): +1 blue energy this turn; sidelined at the end of the main phase", () => {
    const g = setup("main");
    const oruo = field(g.a, "energy", PR("005"));
    expect(energyOf(ctx, g.a, "blue")).toBe(1);
    g.act("a", { type: "activate", uid: oruo.uid, ability: 0 });
    expect(oruo.rested).toBe(true);
    expect(energyOf(ctx, g.a, "blue")).toBe(2);
    expect(() => g.act("a", { type: "activate", uid: oruo.uid, ability: 0 })).toThrow();
    g.act("a", { type: "next_phase" });
    expect(g.a.energy).toHaveLength(0);
    expect(g.a.sideline).toEqual([PR("005")]);
  });
  it("is not sidelined if never activated", () => {
    const g = setup("main");
    field(g.a, "energy", PR("005"));
    g.act("a", { type: "next_phase" });
    expect(g.a.energy).toHaveLength(1);
  });
});

describe("Petra Rall PR-006", () => {
  it("When Played: at the start of the attack phase this turn, one AP card may be switched to active", () => {
    const g = setup("main");
    blue(g.a, 3);
    play(g, PR("006"));
    expect(apRested(g)).toBe(1);
    expect(g.game.pending).toBeNull();
    g.act("a", { type: "next_phase" });
    expect(g.game.phase).toBe("attack");
    expect(choice(g.game, "a").options).toContain("ap:a:ap0");
    pick(g, ["ap:a:ap0"]);
    expect(apRested(g)).toBe(0);
  });
  it("'up to one': choosing none leaves it resting", () => {
    const g = setup("main");
    blue(g.a, 3);
    play(g, PR("006"));
    g.act("a", { type: "next_phase" });
    pick(g, []);
    expect(apRested(g)).toBe(1);
  });
});

describe("Levi PR-008", () => {
  it("When Attacking: pay 1 AP, then draw a card and gain 500 BP until the end of the turn", () => {
    const g = setup("attack");
    const levi = front(g, PR("008"));
    library(g.a, [EVENT_A]);
    attack(g, levi.uid);
    yes(g);
    expect(apRested(g)).toBe(1);
    expect(g.a.hand).toEqual([EVENT_A]);
    expect(bpOf(ctx, levi)).toBe(3000);
  });
  it("When Attacking: declining gives nothing", () => {
    const g = setup("attack");
    const levi = front(g, PR("008"));
    attack(g, levi.uid);
    no(g);
    expect(apRested(g)).toBe(0);
    expect(g.a.hand).toEqual([]);
    expect(bpOf(ctx, levi)).toBe(2500);
  });
});

describe("Ymir PR-013", () => {
  it("During Opponent's Turn: gains 1000 BP while <Historia Reiss> is on your field", () => {
    const g = setup("main");
    const ymir = front(g, PR("013"));
    const historia = front(g, HISTORIA_0);
    refresh(g);
    expect(bpOf(ctx, ymir)).toBe(3000); // my own turn
    g.act("a", { type: "end_turn" });
    expect(g.game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, ymir)).toBe(4000);
    g.a.front = g.a.front.filter((card) => card !== historia);
    g.act("b", { type: "manual", manual: { op: "draw" } });
    expect(bpOf(ctx, ymir)).toBe(3000);
  });
});

describe("Armin Arlelt PR-015", () => {
  it("When Played: returns one other character with 1 or less required energy (the owner chooses among them)", () => {
    const g = setup("main");
    blue(g.a, 1);
    const cheap1 = front(g, YMIR_0);
    const cheap2 = front(g, HISTORIA_0);
    const costly = front(g, BT("026")); // cost 2
    play(g, PR("015"));
    expect(sorted(choice(g.game, "a").options)).toEqual(sorted([cheap1.uid, cheap2.uid]));
    pick(g, [cheap2.uid]);
    expect(g.a.hand).toEqual([HISTORIA_0]);
    expect(g.a.front.map((card) => card.uid)).toContain(costly.uid);
    expect(g.a.front.some((card) => card.cardId === PR("015"))).toBe(true);
  });
  it("When Played: if it cannot, it returns itself to the hand", () => {
    const g = setup("main");
    blue(g.a, 1);
    front(g, BT("026")); // cost 2: no candidate
    play(g, PR("015"));
    expect(g.a.hand).toEqual([PR("015")]);
    expect(g.a.front.some((card) => card.cardId === PR("015"))).toBe(false);
  });
});

describe("Conny Springer PR-016", () => {
  it("1 less required energy in hand while the opponent has a green or red card on the field", () => {
    const g = setup("main");
    expect(costOf(g.game, g.players, ctx, "a", PR("016")).energy).toBe(3);
    field(g.b, "front", YMIR_0); // blue: no change
    expect(costOf(g.game, g.players, ctx, "a", PR("016")).energy).toBe(3);
    field(g.b, "energy", EREN_0); // red
    expect(costOf(g.game, g.players, ctx, "a", PR("016")).energy).toBe(2);
    const h = setup("main");
    field(h.b, "front", TITAN); // green
    expect(costOf(h.game, h.players, ctx, "a", PR("016")).energy).toBe(2);
    blue(h.a, 2);
    play(h, PR("016")); // playable with only 2 blue energy
    expect(h.a.front).toHaveLength(1);
  });
});

describe("Historia Reiss PR-020", () => {
  const A = BT("032");
  const B = BT("030");
  const C = BT("029");
  it("When Played (no Ymir): looks at 2 and puts them back on top in the order chosen", () => {
    const g = setup("main");
    blue(g.a, 1);
    library(g.a, [A, B, C]);
    play(g, PR("020"));
    expect(choice(g.game, "a").options).toEqual(["l:0", "l:1"]);
    pick(g, ["l:1", "l:0"]);
    expect(g.a.library.slice(0, 3)).toEqual([B, A, C]);
    expect(g.a.sideline).toEqual([]);
  });
  it("When Played (a character with 'Ymir' in its name on your field): any number on top in order, the rest to the sideline", () => {
    const g = setup("main");
    blue(g.a, 1);
    front(g, PR("013")); // Ymir
    library(g.a, [A, B, C]);
    play(g, PR("020"));
    pick(g, ["l:1"]);
    pick(g, []);
    expect(g.a.library.slice(0, 2)).toEqual([B, C]);
    expect(g.a.sideline).toEqual([A]);
  });
});

describe("Mikasa Ackermann PR-023", () => {
  it("When Played: draws a card, then one card from hand is placed into the sideline", () => {
    const g = setup("main");
    library(g.a, [EVENT_A]);
    g.a.hand = [PR("023"), TEXAS];
    g.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(g.a.hand).toEqual([TEXAS, EVENT_A]);
    pick(g, ["h:0"]);
    expect(g.a.sideline).toEqual([TEXAS]);
    expect(g.a.hand).toEqual([EVENT_A]);
  });
});
