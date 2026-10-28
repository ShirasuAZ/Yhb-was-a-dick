/**
 * Jujutsu Kaisen cards UA02BT/JJK-1-036 ... 069 (batch jjk-2): one test per card, set up as the printed text describes and checked against it.
 * Cards are addressed by card number (see ability-harness.ts); there is no card art on this machine, so the text in cards.json is the source.
 */
import { describe, expect, it } from "vitest";
import { bpOf, damageOf, energyOf, hasKeyword, impactOf, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { JJK_2_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-jjk-2.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";

const n = (suffix: string): string => `UA02BT/JJK-1-${suffix}`;
// Helper cards without abilities.
const KING = "UC01BT/ARK-1-004"; // 弑君者: yellow, cost 0, BP1500 (also the harness filler)
const W = "UC01BT/ARK-1-009"; // W: yellow, cost 0, BP2000
const STAR = "UC01BT/ARK-1-080"; // 陨星: red, cost 1, BP2500
const GUARD = "UC01ST/ARK-1-103"; // Guard: blue, cost 3, BP3000, makes 2 blue energy
const ITADORI = n("037"); // 虎杖 悠仁: blue, cost 0, BP1500
const NANAMI = n("051"); // 七海 建人: blue, cost 0, BP1500
const FINGER = n("063"); // 宿傩的手指 (event)
const SHRINE = n("061"); // 伏魔御厨子 (site)
const JUNPEI = n("073"); // 吉野 顺平:异形: purple, BP2500 (no ability)
const MAHITO = n("091"); // 真人: purple, 咒灵, BP1500
const HANAMI = n("090"); // 花御: purple, 咒灵, BP2000
const JOGO = n("086"); // 漏瑚: purple, 咒灵
const MAHITO_2 = n("092"); // 真人: purple, makes 2 purple energy
const TOOL = n("066"); // 游云 (event, 特征：咒具)

const BATCH = ["036", "038", "039", "040", "041", "043", "044", "045", "046", "047", "048", "049", "050", "052", "053", "054", "055", "056", "057", "058", "059", "060", "061", "062", "063", "064", "065", "066", "067", "068", "069"];

type Act = (who: string, action: UnionArenaAction) => void;
/** Puts a card into the hand and plays it. */
function play(a: EnginePlayer, act: Act, number: string, line: "front" | "energy" = "front"): UnionArenaFieldCard {
  const handIndex = a.hand.push(number) - 1;
  act("a", { type: "play", handIndex, line });
  return a[line][a[line].length - 1]!;
}
/** Uses the event in the hand. */
function useEvent(a: EnginePlayer, act: Act, number: string): void {
  act("a", { type: "event", handIndex: a.hand.push(number) - 1 });
}
const sidelineByHand = (act: Act, card: UnionArenaFieldCard, who: "you" | "opponent" = "you", by = "a"): void =>
  act(by, { type: "manual", manual: { op: "field", owner: who, uid: card.uid, act: "sideline" } });
/** A card with BP raised or lowered by `change` (this turn). */
function withBp(owner: EnginePlayer, line: "front" | "energy", number: string, change: number): UnionArenaFieldCard {
  const card = field(owner, line, number);
  card.bpMod = change;
  return card;
}
/** Statics are recomputed after every action: a harmless action lets a test read the continuous effects. */
const refresh = (act: Act): void => act("a", { type: "next_phase" });

describe("batch coverage", () => {
  it("every card of the batch has an entry in the ability table and plays entirely by itself", () => {
    for (const suffix of BATCH) {
      expect(JJK_2_ABILITIES[n(suffix)], suffix).toBeDefined();
      expect(isAutomated(titleCard(n(suffix))), suffix).toBe(true);
    }
  });
});

describe("blue characters", () => {
  it("伊地知 洁高 (036): rests for +1 blue energy once per turn and is sidelined when the main phase ends", () => {
    const { a, act } = setup();
    const ijichi = field(a, "energy", n("036"));
    expect(energyOf(ctx, a, "blue")).toBe(1);
    act("a", { type: "activate", uid: ijichi.uid, ability: 0 });
    expect(ijichi.rested).toBe(true);
    expect(energyOf(ctx, a, "blue")).toBe(2);
    expect(() => act("a", { type: "activate", uid: ijichi.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([n("036")]);

    // Not used: stays on the field when the main phase ends.
    const second = setup();
    const unused = field(second.a, "energy", n("036"));
    second.act("a", { type: "next_phase" });
    expect(second.a.energy).toEqual([unused]);
  });

  it("虎杖 悠仁 (038): 登场时 looks at 5, may take a 〈宿傩的手指〉, rest to the bottom in the chosen order, then a hand card to the bottom", () => {
    const { game, a, act } = setup();
    energy(a, 1, GUARD);
    a.library = [KING, FINGER, W, STAR, KING, "tail1", "tail2"];
    a.hand.push(n("038"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:1"]); // only the finger can be taken
    act("a", { type: "choose", picks: ["l:1"] });
    expect(a.hand).toEqual([STAR, FINGER]);
    expect(choice(game, "a").options).toHaveLength(4);
    act("a", { type: "choose", picks: ["l:2", "l:0", "l:1", "l:3"] }); // STAR, KING, W, KING to the bottom in this order
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:0"] }); // the hand card STAR goes to the bottom last
    expect(a.hand).toEqual([FINGER]);
    expect(a.library).toEqual(["tail1", "tail2", STAR, KING, W, KING, STAR]);
  });

  it("虎杖 悠仁 (038): with no 〈宿傩的手指〉 in the top 5 nothing is added and no hand card goes to the bottom", () => {
    const { game, a, act } = setup();
    energy(a, 1, GUARD);
    a.library = [KING, W, STAR, KING, W, "tail"];
    a.hand.push(n("038"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toHaveLength(5); // straight to ordering the five cards
    act("a", { type: "choose", picks: ["l:0", "l:1", "l:2", "l:3", "l:4"] });
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([STAR]);
    expect(a.library).toEqual(["tail", KING, W, STAR, KING, W]);

    // Declining a finger that is there also leaves the hand alone.
    const second = setup();
    energy(second.a, 1, GUARD);
    second.a.library = [FINGER, KING, W, STAR, KING, "tail"];
    second.a.hand.push(n("038"), STAR);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: [] });
    second.act("a", { type: "choose", picks: ["l:0", "l:1", "l:2", "l:3", "l:4"] });
    expect(second.a.hand).toEqual([STAR]);
  });

  it("虎杖 悠仁 (039): 登场时 returns the chosen BP 3500 or less front character with 1-2 fingers in the sideline, sidelines it with 3 or more, nothing with none", () => {
    const run = (fingers: number, pick: boolean = true) => {
      const { game, a, b, act } = setup();
      energy(a, 2, GUARD);
      a.sideline.push(...Array(fingers).fill(FINGER));
      const target = field(b, "front", W);
      const strong = withBp(b, "front", W, 1600); // BP 3600: not a legal choice
      const away = field(b, "energy", KING); // energy line: not a front-line choice
      a.hand.push(n("039"));
      act("a", { type: "play", handIndex: 0, line: "front" });
      expect(choice(game, "a").options).toEqual([target.uid]);
      act("a", { type: "choose", picks: pick ? [target.uid] : [] });
      return { a, b, target, strong, away };
    };
    const none = run(0);
    expect(none.b.front).toContain(none.target);
    expect(none.b.hand).toEqual([]);
    const one = run(1);
    expect(one.b.front).not.toContain(one.target);
    expect(one.b.hand).toEqual([W]);
    const two = run(2);
    expect(two.b.hand).toEqual([W]);
    expect(two.b.sideline).toEqual([]);
    const three = run(3);
    expect(three.b.hand).toEqual([]);
    expect(three.b.sideline).toEqual([W]);
    const skipped = run(3, false);
    expect(skipped.b.front).toContain(skipped.target);
    expect(skipped.b.sideline).toEqual([]);
  });

  it("虎杖 悠仁 (040): 登场时 returns a front character with BP 4000 or less to the hand; it also works through Raid", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GUARD);
    const small = withBp(b, "front", W, 2000); // BP 4000
    withBp(b, "front", W, 2100); // BP 4100: not a legal choice
    a.hand.push(n("040"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([small.uid]);
    act("a", { type: "choose", picks: [small.uid] });
    expect(b.hand).toEqual([W]);

    // Raid onto 〈虎杖 悠仁〉: its 登场时 ability activates as well.
    const second = setup();
    energy(second.a, 2, GUARD);
    const base = field(second.a, "energy", ITADORI);
    const victim = field(second.b, "front", STAR);
    second.a.hand.push(n("040"));
    second.act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(second.a.front).toEqual([base]);
    expect(base.cardId).toBe(n("040"));
    second.act("a", { type: "choose", picks: [victim.uid] });
    expect(second.b.hand).toEqual([STAR]);
  });

  it("狗卷 棘 (041): on the front line, once per turn, BP -500 to an opponent character with BP 1000 or more on either line", () => {
    const { game, a, b, act } = setup();
    const inumaki = field(a, "front", n("041"));
    const front = field(b, "front", W);
    const back = field(b, "energy", KING);
    const weak = withBp(b, "front", KING, -600); // BP 900
    act("a", { type: "activate", uid: inumaki.uid, ability: 0 });
    expect(choice(game, "a").options.sort()).toEqual([front.uid, back.uid].sort());
    act("a", { type: "choose", picks: [back.uid] });
    expect(bpOf(ctx, back)).toBe(1000);
    expect(bpOf(ctx, front)).toBe(2000);
    expect(bpOf(ctx, weak)).toBe(900);
    expect(() => act("a", { type: "activate", uid: inumaki.uid, ability: 0 })).toThrow("ONCE_PER_TURN");

    // Not on the front line: cannot be used. Choosing nobody is allowed.
    const second = setup();
    const resting = field(second.a, "energy", n("041"));
    expect(() => second.act("a", { type: "activate", uid: resting.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    const third = setup();
    const ok = field(third.a, "front", n("041"));
    const target = field(third.b, "front", W);
    third.act("a", { type: "activate", uid: ok.uid, ability: 0 });
    third.act("a", { type: "choose", picks: [] });
    expect(bpOf(ctx, target)).toBe(2000);
  });

  it("钉崎 野蔷薇 (043): 登场时 draws one, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    a.library = [W, KING];
    a.hand.push(n("043"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([STAR, W]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([W]);
    expect(a.sideline).toEqual([STAR]);
  });

  it("钉崎 野蔷薇 (044): 登场时 returns another own character with required energy 1 or less to the hand, otherwise itself", () => {
    const { a, act } = setup();
    energy(a, 1, GUARD);
    const other = field(a, "front", KING);
    a.hand.push(n("044"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([KING]);
    expect(a.front.map((card) => card.cardId)).toEqual([n("044")]);
    expect(a.front).not.toContain(other);

    const second = setup(); // the only other card costs 3: 044 returns itself
    energy(second.a, 1, GUARD);
    second.a.hand.push(n("044"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([n("044")]);
    expect(second.a.front).toEqual([]);

    const third = setup(); // two candidates: asked which
    energy(third.a, 1, GUARD);
    const first = field(third.a, "front", KING);
    const star = field(third.a, "front", STAR);
    third.a.hand.push(n("044"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(third.game, "a").options.sort()).toEqual([first.uid, star.uid].sort());
    third.act("a", { type: "choose", picks: [star.uid] });
    expect(third.a.hand).toEqual([STAR]);
  });

  it("五条 悟 (045): makes +1 blue energy only while it is active", () => {
    const { a, act } = setup();
    const gojo = field(a, "energy", n("045"));
    refresh(act);
    expect(energyOf(ctx, a, "blue")).toBe(2);

    const second = setup();
    const resting = field(second.a, "energy", n("045"), true);
    refresh(second.act);
    expect(resting.rested).toBe(true);
    expect(energyOf(ctx, second.a, "blue")).toBe(1);
    expect(gojo.rested).toBe(false);
  });

  it("五条 悟 (046): 攻击时 draws a card", () => {
    const { a, act } = setup("attack");
    const gojo = field(a, "front", n("046"));
    a.library = [W, KING];
    act("a", { type: "attack", attackerUid: gojo.uid });
    expect(a.hand).toEqual([W]);
  });

  it("宿傩 (047): 登场时 rests an opponent front character whose next activation fails, then may take a 〈宿傩的手指〉 or 〈伏魔御厨子〉", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, GUARD);
    const victim = field(b, "front", W);
    const spared = field(b, "front", KING);
    a.library = [KING, FINGER, SHRINE, STAR, W, "tail"];
    a.hand.push(n("047"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options.sort()).toEqual([victim.uid, spared.uid].sort());
    act("a", { type: "choose", picks: [victim.uid] });
    expect(victim.rested).toBe(true);
    expect(victim.skipNextActivate).toBe(true);
    expect(spared.rested).toBe(false);
    expect(choice(game, "a").options).toEqual(["l:1", "l:2"]); // the finger and the shrine, not the other cards
    act("a", { type: "choose", picks: ["l:2"] });
    expect(a.hand).toEqual([SHRINE]);
    act("a", { type: "choose", picks: ["l:0", "l:1", "l:2", "l:3"] });
    expect(a.library).toEqual(["tail", KING, FINGER, STAR, W]);
    // The opponent's turn begins: the character stays resting once, then wakes up on the turn after.
    act("a", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("b");
    expect(victim.rested).toBe(true);
    expect(spared.rested).toBe(false);
    expect(victim.skipNextActivate).toBe(false);
  });

  it("宿傩 (047): without an opponent front character, or choosing nobody, it only looks at the deck", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, GUARD);
    a.library = [KING, KING, KING, KING, KING];
    a.hand.push(n("047"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toHaveLength(5); // straight to the order of the five cards
    act("a", { type: "choose", picks: ["l:0", "l:1", "l:2", "l:3", "l:4"] });
    expect(b.front).toEqual([]);

    const second = setup();
    energy(second.a, 3, GUARD);
    const victim = field(second.b, "front", W);
    second.a.hand.push(n("047"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: [] });
    expect(victim.rested).toBe(false);
  });

  it("宿傩 (048): 登场时 the opponent picks one of their own front characters to return; 2-3 fingers: two; 4 or more: three", () => {
    const run = (fingers: number, frontCards: number, play048 = true) => {
      const { game, a, b, act } = setup();
      energy(a, 3, GUARD);
      a.sideline.push(...Array(fingers).fill(FINGER));
      const cards = [W, KING, STAR, GUARD].slice(0, frontCards).map((number) => field(b, "front", number));
      a.hand.push(n("048"));
      act("a", { type: "play", handIndex: 0, line: "front" });
      return { game, a, b, act, cards, play048 };
    };
    // One character, chosen by the opponent.
    const one = run(0, 3);
    expect(choice(one.game, "b").options.sort()).toEqual(one.cards.map((card) => card.uid).sort());
    expect(choice(one.game, "b").max).toBe(1);
    one.act("b", { type: "choose", picks: [one.cards[1]!.uid] });
    expect(one.b.hand).toEqual([KING]);
    expect(one.b.front).toHaveLength(2);
    // 2~3 fingers: two characters.
    for (const fingers of [2, 3]) {
      const two = run(fingers, 3);
      expect(choice(two.game, "b").min).toBe(2);
      expect(choice(two.game, "b").max).toBe(2);
      two.act("b", { type: "choose", picks: [two.cards[0]!.uid, two.cards[2]!.uid] });
      expect(two.b.hand).toEqual([W, STAR]);
      expect(two.b.front.map((card) => card.cardId)).toEqual([KING]);
    }
    // 4 or more: three characters (all of them when there are only three).
    const three = run(4, 4);
    expect(choice(three.game, "b").min).toBe(3);
    three.act("b", { type: "choose", picks: three.cards.slice(1).map((card) => card.uid) });
    expect(three.b.hand).toEqual([KING, STAR, GUARD]);
    const all = run(5, 3);
    expect(all.game.pending).toBeNull();
    expect(all.b.front).toEqual([]);
    expect(all.b.hand).toHaveLength(3);
    // Nothing on their front line: nothing happens (an energy-line character is not affected).
    const empty = run(0, 0);
    expect(empty.game.pending).toBeNull();
    // Only works while 宿傩 is on the front line: on the energy line the ability does nothing.
    const { game, a, b, act } = setup();
    energy(a, 3, GUARD);
    field(b, "front", W);
    a.hand.push(n("048"));
    act("a", { type: "play", handIndex: 0, line: "energy" });
    expect(game.pending).toBeNull();
    expect(b.front).toHaveLength(1);
    expect(b.hand).toEqual([]);
    expect(hasKeyword(ctx, a.energy[3]!, "冲击1")).toBe(true);
  });

  it("禅院 真希 (049): BP +1000 while the sideline holds a 呪具 card or 4 or more events", () => {
    const { a, act } = setup();
    const maki = field(a, "front", n("049"));
    refresh(act);
    expect(bpOf(ctx, maki)).toBe(3000);
    const second = setup();
    const withTool = field(second.a, "front", n("049"));
    second.a.sideline.push(KING, TOOL);
    refresh(second.act);
    expect(bpOf(ctx, withTool)).toBe(4000);

    const third = setup();
    const events = field(third.a, "front", n("049"));
    third.a.sideline.push(n("067"), n("067"), FINGER);
    refresh(third.act);
    expect(bpOf(ctx, events)).toBe(3000); // three events: not enough
    const fourth = setup();
    const fourEvents = field(fourth.a, "front", n("049"));
    fourth.a.sideline.push(n("067"), n("067"), FINGER, n("062"));
    refresh(fourth.act);
    expect(bpOf(ctx, fourEvents)).toBe(4000);
  });

  it("禅院 真希 (050): +1500 BP in the opponent's turn only, with a 呪具 card or 4 events in the sideline", () => {
    const { game, a, act } = setup();
    const maki = field(a, "front", n("050"));
    a.sideline.push(TOOL);
    refresh(act);
    expect(bpOf(ctx, maki)).toBe(1500); // our own turn
    act("a", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, maki)).toBe(3000);

    // Three events are not enough (nor is an empty sideline): no bonus in the opponent's turn either; the fourth makes it 3000.
    const second = setup();
    const plain = field(second.a, "front", n("050"));
    second.a.sideline.push(n("067"), n("067"), FINGER);
    second.act("a", { type: "end_turn" });
    expect(second.game.turnPlayerId).toBe("b");
    second.act("b", { type: "next_phase" });
    expect(bpOf(ctx, plain)).toBe(1500);
    second.a.sideline.push(n("062"));
    second.act("b", { type: "next_phase" });
    expect(bpOf(ctx, plain)).toBe(3000);
  });

  it("禅院 真希 (050): 登场时 takes one of the top two cards into the hand and puts the other into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1, GUARD);
    a.library = [KING, W, STAR];
    a.hand.push(n("050"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:0", "l:1"]);
    expect(choice(game, "a").min).toBe(1);
    act("a", { type: "choose", picks: ["l:1"] });
    expect(a.hand).toEqual([W]);
    expect(a.sideline).toEqual([KING]);
    expect(a.library).toEqual([STAR]);
  });

  it("七海 建人 (052): 攻击时 may put the top card into the sideline, then BP -1500 to an opponent character with BP 1500 or more", () => {
    const { game, a, b, act } = setup("attack");
    const nanami = field(a, "front", n("052"));
    const target = field(b, "front", W);
    const back = field(b, "energy", KING);
    const weak = withBp(b, "front", KING, -600); // BP 900: not a legal choice
    a.library = [STAR, KING];
    act("a", { type: "attack", attackerUid: nanami.uid });
    expect(choice(game, "a").purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.sideline).toEqual([STAR]);
    expect(choice(game, "a").options.sort()).toEqual([target.uid, back.uid].sort());
    act("a", { type: "choose", picks: [target.uid] });
    expect(bpOf(ctx, target)).toBe(500);
    expect(bpOf(ctx, weak)).toBe(900);
    expect(bpOf(ctx, back)).toBe(1500);

    // Declining: nothing is put into the sideline and nothing changes.
    const second = setup("attack");
    const attacker = field(second.a, "front", n("052"));
    const other = field(second.b, "front", W);
    second.a.library = [STAR];
    second.act("a", { type: "attack", attackerUid: attacker.uid });
    second.act("a", { type: "choose", picks: ["no"] });
    expect(second.a.sideline).toEqual([]);
    expect(bpOf(ctx, other)).toBe(2000);

    // An empty deck: no question.
    const third = setup("attack");
    const empty = field(third.a, "front", n("052"));
    field(third.b, "front", W);
    third.a.library = [];
    third.act("a", { type: "attack", attackerUid: empty.uid });
    expect(third.game.pending?.kind).toBe("block");
  });

  it("七海 建人 (053): gets 冲击① while the deck has 15 or fewer cards", () => {
    const { a, act } = setup();
    const nanami = field(a, "front", n("053"));
    a.library = Array(15).fill(KING);
    refresh(act);
    expect(impactOf(ctx, nanami)).toBe(1);
    const second = setup();
    const full = field(second.a, "front", n("053"));
    second.a.library = Array(16).fill(KING);
    refresh(second.act);
    expect(impactOf(ctx, full)).toBe(0);
  });

  it("七海 建人 (053): 登场时 may remove 7 cards of the sideline from the game to draw 3", () => {
    const { game, a, act } = setup();
    energy(a, 2, GUARD);
    a.sideline = [KING, W, STAR, KING, W, STAR, KING, "left"];
    a.library = [W, W, W, KING];
    a.hand.push(n("053"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(choice(game, "a").min).toBe(7);
    act("a", { type: "choose", picks: ["s:0", "s:1", "s:2", "s:3", "s:4", "s:5", "s:6"] });
    expect(a.removal).toEqual([KING, W, STAR, KING, W, STAR, KING]);
    expect(a.sideline).toEqual(["left"]);
    expect(a.hand).toEqual([W, W, W]);

    // Declined: nothing moves. Fewer than 7 cards: no question.
    const second = setup();
    energy(second.a, 2, GUARD);
    second.a.sideline = Array(7).fill(KING);
    second.a.hand.push(n("053"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: ["no"] });
    expect(second.a.removal).toEqual([]);
    expect(second.a.hand).toEqual([]);
    const third = setup();
    energy(third.a, 2, GUARD);
    third.a.sideline = Array(6).fill(KING);
    third.a.hand.push(n("053"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(third.game.pending).toBeNull();
  });

  it("七海 建人 (054): with 15 or fewer cards in the deck BP +1000 and 冲击① and 伤害②", () => {
    const { a, act } = setup();
    const nanami = field(a, "front", n("054"));
    a.library = Array(15).fill(KING);
    refresh(act);
    expect(bpOf(ctx, nanami)).toBe(5000);
    expect(impactOf(ctx, nanami)).toBe(1);
    expect(damageOf(ctx, nanami)).toBe(2);
    const second = setup();
    const full = field(second.a, "front", n("054"));
    second.a.library = Array(16).fill(KING);
    refresh(second.act);
    expect(bpOf(ctx, full)).toBe(4000);
    expect(impactOf(ctx, full)).toBe(0);
    expect(damageOf(ctx, full)).toBe(1);
  });

  it("七海 建人 (054): 退场时 may put the top 2 cards into the sideline to rest an opponent front character", () => {
    const { game, a, b, act } = setup();
    const nanami = field(a, "front", n("054"));
    const target = field(b, "front", W);
    const spare = field(b, "front", KING);
    a.library = [STAR, KING, W];
    sidelineByHand(act, nanami);
    expect(choice(game, "a").purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.sideline).toEqual([n("054"), STAR, KING]);
    expect(choice(game, "a").options.sort()).toEqual([target.uid, spare.uid].sort());
    act("a", { type: "choose", picks: [target.uid] });
    expect(target.rested).toBe(true);
    expect(spare.rested).toBe(false);

    // Declined, or fewer than 2 cards in the deck: nothing.
    const second = setup();
    const keeper = field(second.a, "front", n("054"));
    const unaffected = field(second.b, "front", W);
    second.a.library = [STAR, KING];
    sidelineByHand(second.act, keeper);
    second.act("a", { type: "choose", picks: ["no"] });
    expect(second.a.library).toEqual([STAR, KING]);
    expect(unaffected.rested).toBe(false);
    const third = setup();
    const lonely = field(third.a, "front", n("054"));
    field(third.b, "front", W);
    third.a.library = [STAR];
    sidelineByHand(third.act, lonely);
    expect(third.game.pending).toBeNull();
  });

  it("熊猫 (055): its 冲击无效 keyword works even though the card text is in 【】", () => {
    expect(isAutomated(titleCard(n("055")))).toBe(true);
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", n("069")); // BP 4000, 冲击①
    const panda = field(b, "front", n("055")); // BP 2500
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: panda.uid });
    expect(b.sideline).toEqual([n("055")]);
    expect(game.pending).toBeNull(); // no impact damage

    // The same fight against a blocker without 冲击无效 does hurt.
    const second = setup("attack");
    const hitter = field(second.a, "front", n("069"));
    const wall = field(second.b, "front", STAR);
    second.act("a", { type: "attack", attackerUid: hitter.uid });
    second.act("b", { type: "block", blockerUid: wall.uid });
    expect(second.game.pending?.kind).toBe("damage");
  });

  it("伏黑 惠 (056): 登场时 BP -1000 to an opponent character with BP 1500 or more on either line", () => {
    const { game, a, b, act } = setup();
    energy(a, 1, GUARD);
    const front = field(b, "front", W);
    const back = field(b, "energy", STAR);
    const weak = withBp(b, "front", KING, -600); // BP 900
    a.hand.push(n("056"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options.sort()).toEqual([front.uid, back.uid].sort());
    act("a", { type: "choose", picks: [back.uid] });
    expect(bpOf(ctx, back)).toBe(1500);
    expect(bpOf(ctx, front)).toBe(2000);
    expect(bpOf(ctx, weak)).toBe(900);

    const second = setup();
    energy(second.a, 1, GUARD);
    const untouched = field(second.b, "front", W);
    second.a.hand.push(n("056"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: [] });
    expect(bpOf(ctx, untouched)).toBe(2000);
  });

  it("伏黑 惠 (057): 登场时 puts an opponent site on the bottom of their deck", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GUARD);
    const site = field(b, "energy", SHRINE);
    field(b, "energy", KING);
    b.library = [W, STAR];
    a.hand.push(n("057"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([site.uid]); // sites only
    act("a", { type: "choose", picks: [site.uid] });
    expect(b.energy.map((card) => card.cardId)).toEqual([KING]);
    expect(b.library).toEqual([W, STAR, SHRINE]);
    expect(b.sideline).toEqual([]);

    // Choosing nobody, and no site at all.
    const second = setup();
    energy(second.a, 2, GUARD);
    const keep = field(second.b, "energy", SHRINE);
    second.a.hand.push(n("057"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: [] });
    expect(second.b.energy).toEqual([keep]);
    const third = setup();
    energy(third.a, 2, GUARD);
    field(third.b, "front", W);
    third.a.hand.push(n("057"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(third.game.pending).toBeNull();
  });

  it("夜蛾 正道 (058): resting it gives another own character BP +1000 this turn", () => {
    const { game, a, act } = setup();
    const yaga = field(a, "front", n("058"));
    const first = field(a, "front", KING);
    const second = field(a, "energy", W);
    act("a", { type: "activate", uid: yaga.uid, ability: 0 });
    expect(yaga.rested).toBe(true);
    expect(choice(game, "a").options.sort()).toEqual([first.uid, second.uid].sort()); // not itself
    act("a", { type: "choose", picks: [second.uid] });
    expect(bpOf(ctx, second)).toBe(3000);
    expect(bpOf(ctx, first)).toBe(1500);
    expect(bpOf(ctx, yaga)).toBe(2500);
    expect(() => act("a", { type: "activate", uid: yaga.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("吉野 顺平 (059): 退场时 draws a card", () => {
    const { a, act } = setup();
    const junpei = field(a, "front", n("059"));
    a.library = [W, KING];
    sidelineByHand(act, junpei);
    expect(a.hand).toEqual([W]);
    expect(a.sideline).toEqual([n("059")]);
  });

  it("东堂 葵 (060): 攻击时 may swap a front character with an energy-line character (their move abilities activate)", () => {
    const { game, a, b, act } = setup("attack");
    const todo = field(a, "front", n("060"));
    const star = field(a, "front", STAR);
    const wicked = field(a, "energy", "UCEX01BT/ARK-2-004"); // W: 撤步, 从前线移动至能量线时 sidelines an opponent front character
    const king = field(a, "energy", KING);
    const victim = field(b, "front", W);
    act("a", { type: "attack", attackerUid: todo.uid });
    expect(choice(game, "a").purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(choice(game, "a").options.sort()).toEqual([todo.uid, star.uid].sort());
    act("a", { type: "choose", picks: [star.uid] });
    expect(choice(game, "a").options.sort()).toEqual([wicked.uid, king.uid].sort());
    act("a", { type: "choose", picks: [king.uid] });
    expect(a.front).toEqual([todo, king]);
    expect(a.energy).toEqual([wicked, star]);
    expect(game.pending?.kind).toBe("block");
    expect(victim.cardId).toBe(W);

    // The other way round: the swapped-in W goes to the energy line and its 当此角色从前线移动至能量线时 ability activates.
    const second = setup("attack");
    const attacker = field(second.a, "front", n("060"));
    const moving = field(second.a, "front", "UCEX01BT/ARK-2-004");
    const idle = field(second.a, "energy", KING);
    const enemy = field(second.b, "front", W);
    second.act("a", { type: "attack", attackerUid: attacker.uid });
    second.act("a", { type: "choose", picks: ["yes"] });
    second.act("a", { type: "choose", picks: [moving.uid] });
    expect(second.a.energy).toEqual([moving]);
    expect(second.a.front).toEqual([attacker, idle]);
    expect(choice(second.game, "a").options).toEqual([enemy.uid]);

    // Declined: the lines stay as they are.
    const third = setup("attack");
    const stay = field(third.a, "front", n("060"));
    const rear = field(third.a, "energy", KING);
    third.act("a", { type: "attack", attackerUid: stay.uid });
    third.act("a", { type: "choose", picks: ["no"] });
    expect(third.a.front).toEqual([stay]);
    expect(third.a.energy).toEqual([rear]);
  });

  it("东堂 葵 (060): no question when one line has no character that can be swapped (a card that only lives on the energy line cannot go to the front)", () => {
    const { game, a, act } = setup("attack");
    const todo = field(a, "front", n("060"));
    act("a", { type: "attack", attackerUid: todo.uid });
    expect(game.pending?.kind).toBe("damage"); // empty energy line: no question (b has no blockers, so the attack goes through)
    const second = setup("attack");
    const attacker = field(second.a, "front", n("060"));
    field(second.a, "energy", "UCEX01BT/ARK-2-025"); // 阿丽娜: 无法移动至前线
    second.act("a", { type: "attack", attackerUid: attacker.uid });
    expect(second.game.pending?.kind).not.toBe("choose");
  });

  it("伏魔御厨子 (061): comes onto the field active and can be used at once; 宿傩 gets 伤害②, 瞄准攻击, 冲击+1 by 2, 3, 4 or more fingers", () => {
    const { a, act } = setup();
    energy(a, 2, GUARD);
    const sukuna = field(a, "front", n("047"));
    const shrine = play(a, act, SHRINE, "energy");
    expect(shrine.rested).toBe(false);
    a.sideline.push(FINGER);
    act("a", { type: "activate", uid: shrine.uid, ability: 1 }); // one finger: nothing yet
    expect(shrine.rested).toBe(true);
    expect(damageOf(ctx, sukuna)).toBe(1);
    expect(impactOf(ctx, sukuna)).toBe(0);

    const levels: Array<[number, boolean, boolean, boolean]> = [[2, true, false, false], [3, true, true, false], [4, true, true, true], [0, false, false, false]];
    for (const [fingers, damage, snipe, impact] of levels) {
      const t = setup();
      const target = field(t.a, "front", n("047"));
      const site = field(t.a, "energy", SHRINE);
      t.a.sideline.push(...Array(fingers).fill(FINGER));
      t.act("a", { type: "activate", uid: site.uid, ability: 1 });
      expect(damageOf(ctx, target), `${fingers} fingers`).toBe(damage ? 2 : 1);
      expect(hasKeyword(ctx, target, "瞄准攻击"), `${fingers} fingers`).toBe(snipe);
      expect(impactOf(ctx, target), `${fingers} fingers`).toBe(impact ? 1 : 0);
    }
  });

  it("伏魔御厨子 (061): picks which 〈宿傩〉 when there are several; a resting site cannot be used", () => {
    const { game, a, act } = setup();
    const site = field(a, "energy", SHRINE);
    const first = field(a, "front", n("047"));
    const second = field(a, "front", n("048"));
    field(a, "front", KING);
    a.sideline.push(FINGER, FINGER);
    act("a", { type: "activate", uid: site.uid, ability: 1 });
    expect(choice(game, "a").options.sort()).toEqual([first.uid, second.uid].sort());
    act("a", { type: "choose", picks: [second.uid] });
    expect(damageOf(ctx, second)).toBe(2);
    expect(damageOf(ctx, first)).toBe(1);
    expect(() => act("a", { type: "activate", uid: site.uid, ability: 1 })).toThrow("ABILITY_COST");
  });
});

describe("blue events", () => {
  it("迳庭拳 (062): returns a front character with BP 5000 or less to the hand; with 〈虎杖 悠仁〉 on the field sidelines it instead", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GUARD);
    const small = field(b, "front", W);
    const another = field(b, "front", STAR);
    const big = withBp(b, "front", STAR, 2600); // BP 5100: not a legal choice
    field(b, "energy", KING);
    a.hand.push(n("062"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options.sort()).toEqual([small.uid, another.uid].sort());
    act("a", { type: "choose", picks: [small.uid] });
    expect(b.hand).toEqual([W]);
    expect(b.sideline).toEqual([]);
    expect(b.front).toContain(big);
    expect(a.sideline).toEqual([n("062")]);

    const second = setup();
    energy(second.a, 2, GUARD);
    field(second.a, "front", ITADORI);
    const target = field(second.b, "front", W);
    second.a.hand.push(n("062"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.b.front).not.toContain(target);
    expect(second.b.sideline).toEqual([W]);
    expect(second.b.hand).toEqual([]);
  });

  it("宿傩的手指 (063): pays one life, then draws a card and makes an AP card active", () => {
    const { game, a, act } = setup();
    energy(a, 1, GUARD);
    a.library = [W, KING];
    a.hand.push(FINGER);
    act("a", { type: "event", handIndex: 0 });
    expect(a.life).toHaveLength(6);
    expect(a.sideline).toHaveLength(1); // the life card (the event follows once resolved)
    expect(a.hand).toEqual([W]);
    const rested = a.ap.find((card) => card.rested)!;
    expect(choice(game, "a").options).toContain(`ap:${rested.id}`);
    expect(choice(game, "a").min).toBe(0); // up to one
    act("a", { type: "choose", picks: [`ap:${rested.id}`] });
    expect(a.ap.every((card) => !card.rested)).toBe(true);
    expect(a.sideline[a.sideline.length - 1]).toBe(FINGER);

    // Choosing no AP card leaves it resting.
    const second = setup();
    energy(second.a, 1, GUARD);
    second.a.hand.push(FINGER);
    second.act("a", { type: "event", handIndex: 0 });
    second.act("a", { type: "choose", picks: [] });
    expect(second.a.ap.filter((card) => card.rested)).toHaveLength(1);
  });

  it("宿傩的手指 (063): can instead rest an active 〈虎杖 悠仁〉; with both possible the user picks", () => {
    const { game, a, act } = setup();
    energy(a, 1, GUARD);
    const itadori = field(a, "front", ITADORI);
    a.hand.push(FINGER);
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    act("a", { type: "choose", picks: ["m:1"] });
    expect(itadori.rested).toBe(true);
    expect(a.life).toHaveLength(7);
    act("a", { type: "choose", picks: [] }); // no AP card

    const second = setup();
    energy(second.a, 1, GUARD);
    const ready = field(second.a, "front", ITADORI);
    second.a.hand.push(FINGER);
    second.act("a", { type: "event", handIndex: 0 });
    second.act("a", { type: "choose", picks: ["m:0"] });
    expect(ready.rested).toBe(false);
    expect(second.a.life).toHaveLength(6);

    // No life left: the 〈虎杖 悠仁〉 is the only way and needs no question.
    const third = setup();
    energy(third.a, 1, GUARD);
    third.a.life = [];
    const only = field(third.a, "energy", ITADORI);
    third.a.hand.push(FINGER);
    third.act("a", { type: "event", handIndex: 0 });
    expect(only.rested).toBe(true);
    expect(third.game.step).toBe("turn");
  });

  it("宿傩的手指 (063): cannot be used with neither a life card nor an active 〈虎杖 悠仁〉", () => {
    const { a, act } = setup();
    energy(a, 1, GUARD);
    a.life = [];
    field(a, "front", ITADORI, true); // resting
    a.hand.push(FINGER);
    expect(() => act("a", { type: "event", handIndex: 0 })).toThrow("EVENT_CONDITION");
    expect(a.hand).toEqual([FINGER]);
    // Paying the last life card ends the game as damage to the last one would.
    const second = setup();
    energy(second.a, 1, GUARD);
    second.a.life = second.a.life.slice(0, 1);
    second.a.hand.push(FINGER);
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.game.step).toBe("over");
    expect(second.game.winnerId).toBe("b");
  });

  it("十画咒法「瓦落瓦落」 (064): the opponent chooses top or bottom of their deck for the character", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GUARD);
    const target = field(b, "front", W);
    withBp(b, "front", STAR, 2600); // BP 5100: not a legal choice
    b.library = [KING, STAR];
    a.hand.push(n("064"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "b").options).toEqual(["m:0", "m:1"]); // the opponent is asked
    act("b", { type: "choose", picks: ["m:0"] });
    expect(b.front).not.toContain(target);
    expect(b.library).toEqual([W, KING, STAR]);
    expect(b.hand).toEqual([]);

    const second = setup();
    energy(second.a, 2, GUARD);
    field(second.b, "front", W);
    second.b.library = [KING, STAR];
    second.a.hand.push(n("064"));
    second.act("a", { type: "event", handIndex: 0 });
    second.act("b", { type: "choose", picks: ["m:1"] });
    expect(second.b.library).toEqual([KING, STAR, W]);
  });

  it("十画咒法「瓦落瓦落」 (064): with 〈七海 建人〉 on our field we choose; a choice of targets is ours too", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GUARD);
    field(a, "front", NANAMI);
    const first = field(b, "front", W);
    const second = field(b, "front", STAR);
    b.library = [KING];
    a.hand.push(n("064"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options.sort()).toEqual([first.uid, second.uid].sort());
    act("a", { type: "choose", picks: [second.uid] });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]); // we are asked
    act("a", { type: "choose", picks: ["m:0"] });
    expect(b.library).toEqual([STAR, KING]);
    expect(b.front).toEqual([first]);
    expect(a.sideline).toEqual([n("064")]);

    // No legal target: nobody is asked.
    const third = setup();
    energy(third.a, 2, GUARD);
    third.a.hand.push(n("064"));
    third.act("a", { type: "event", handIndex: 0 });
    expect(third.game.pending).toBeNull();
  });

  it("屠坐魔 (065): BP +2000 to an own front character this turn, and draws a card", () => {
    const { game, a, act } = setup();
    energy(a, 1, GUARD);
    const first = field(a, "front", KING);
    const second = field(a, "front", W);
    const back = field(a, "energy", STAR);
    a.library = [W, KING];
    a.hand.push(n("065"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options.sort()).toEqual([first.uid, second.uid].sort()); // front line only
    act("a", { type: "choose", picks: [first.uid] });
    expect(bpOf(ctx, first)).toBe(3500);
    expect(bpOf(ctx, second)).toBe(2000);
    expect(bpOf(ctx, back)).toBe(2500);
    expect(a.hand).toEqual([W]);
    expect(a.sideline).toEqual([n("065")]);
  });

  it("游云 (066): sidelines an opponent front character with BP 2500 or less", () => {
    const { game, a, b, act } = setup();
    energy(a, 1, GUARD);
    const first = field(b, "front", W);
    const second = field(b, "front", STAR);
    const strong = withBp(b, "front", STAR, 100); // BP 2600
    a.hand.push(n("066"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options.sort()).toEqual([first.uid, second.uid].sort());
    act("a", { type: "choose", picks: [second.uid] });
    expect(b.front).toEqual([first, strong]);
    expect(b.sideline).toEqual([STAR]);
  });

  it("领域展开 (067): makes up to 2 AP cards active", () => {
    const { game, a, act } = setup();
    energy(a, 2, GUARD);
    a.ap.forEach((card) => { card.rested = true; });
    a.ap[2]!.rested = false;
    a.hand.push(n("067"));
    act("a", { type: "event", handIndex: 0 }); // pays 1 AP: all three rest
    expect(a.ap.every((card) => card.rested)).toBe(true);
    expect(choice(game, "a").max).toBe(2);
    expect(choice(game, "a").min).toBe(0);
    act("a", { type: "choose", picks: [`ap:${a.ap[0]!.id}`, `ap:${a.ap[1]!.id}`] });
    expect(a.ap.map((card) => card.rested)).toEqual([false, false, true]);

    const second = setup(); // up to two: choosing none is fine
    energy(second.a, 2, GUARD);
    second.a.hand.push(n("067"));
    second.act("a", { type: "event", handIndex: 0 });
    second.act("a", { type: "choose", picks: [] });
    expect(second.a.ap.filter((card) => card.rested)).toHaveLength(1);
  });
});

describe("夏油 杰", () => {
  it("夏油 杰 (068): 登场时 may sideline another own character, then take up to 2 〈咒灵〉 from the top 6 and put the rest into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1, MAHITO_2);
    a.library = [MAHITO, HANAMI, KING, W, JOGO, STAR, "tail"];
    a.hand.push(n("068"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.energy).toEqual([]); // the only other character was sidelined
    expect(choice(game, "a").options).toEqual(["l:0", "l:1", "l:4"]);
    expect(choice(game, "a").max).toBe(2);
    act("a", { type: "choose", picks: ["l:0", "l:4"] });
    expect(a.hand).toEqual([MAHITO, JOGO]);
    expect(a.sideline).toEqual([MAHITO_2, HANAMI, KING, W, STAR]);
    expect(a.library).toEqual(["tail"]);
  });

  it("夏油 杰 (068): declining does nothing; with several other characters we choose which; up to 2 includes taking none", () => {
    const { a, act } = setup();
    energy(a, 1, MAHITO_2);
    a.library = [MAHITO, KING];
    a.hand.push(n("068"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    act("a", { type: "choose", picks: ["no"] });
    expect(a.energy).toHaveLength(1);
    expect(a.sideline).toEqual([]);
    expect(a.library).toEqual([MAHITO, KING]);

    const second = setup();
    energy(second.a, 1, MAHITO_2);
    const keep = field(second.a, "front", KING);
    second.a.library = [MAHITO, KING, W, STAR, KING, W];
    second.a.hand.push(n("068"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: ["yes"] });
    expect(choice(second.game, "a").options).toHaveLength(2);
    second.act("a", { type: "choose", picks: [keep.uid] });
    expect(second.a.front).not.toContain(keep);
    second.act("a", { type: "choose", picks: [] }); // take no 咒灵
    expect(second.a.hand).toEqual([]);
    expect(second.a.sideline).toEqual([KING, MAHITO, KING, W, STAR, KING, W]);
  });

  it("夏油 杰 (069): 登场时 may sideline another own character", () => {
    const { game, a, act } = setup();
    energy(a, 2, MAHITO_2);
    a.hand.push(n("069"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(choice(game, "a").options).toHaveLength(2);
    act("a", { type: "choose", picks: [a.energy[0]!.uid] });
    expect(a.energy).toHaveLength(1);
    expect(a.sideline).toEqual([MAHITO_2]);
    expect(impactOf(ctx, a.front[0]!)).toBe(1);

    const second = setup();
    energy(second.a, 2, MAHITO_2);
    second.a.hand.push(n("069"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: ["no"] });
    expect(second.a.energy).toHaveLength(2);
  });

  it("夏油 杰 (069): 启动主要 only once one of our characters was sidelined this turn: the opponent sidelines a character of their own choice", () => {
    const { game, a, b, act } = setup();
    const geto = field(a, "front", n("069"));
    const ally = field(a, "front", KING);
    const keep = field(b, "front", W);
    const lose = field(b, "energy", STAR);
    expect(() => act("a", { type: "activate", uid: geto.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    // The opponent's character being sidelined does not count for us.
    sidelineByHand(act, keep, "opponent");
    expect(() => act("a", { type: "activate", uid: geto.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    field(b, "front", W);
    sidelineByHand(act, ally);
    act("a", { type: "activate", uid: geto.uid, ability: 1 });
    expect(geto.rested).toBe(true);
    expect(choice(game, "b").options).toHaveLength(2); // the opponent picks among their own characters
    act("b", { type: "choose", picks: [lose.uid] });
    expect(b.energy).toEqual([]);
    expect(b.sideline).toEqual([W, STAR]);
    expect(() => act("a", { type: "activate", uid: geto.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
  });

  it("夏油 杰 (069): a sacrifice made by another 夏油's 登场时 effect counts; the record is for the turn only", () => {
    const first = setup();
    energy(first.a, 2, MAHITO_2);
    const veteran = field(first.a, "front", n("069"));
    const foe = field(first.b, "front", W);
    first.a.hand.push(n("069"));
    first.act("a", { type: "play", handIndex: 0, line: "front" });
    first.act("a", { type: "choose", picks: ["yes"] });
    first.act("a", { type: "choose", picks: [first.a.energy[0]!.uid] }); // sidelined by an effect
    first.act("a", { type: "activate", uid: veteran.uid, ability: 1 });
    expect(first.b.front).not.toContain(foe);
    expect(first.b.sideline).toEqual([W]);

    const { game, a, b, act } = setup();
    const geto = field(a, "front", n("069"));
    const lost = field(a, "energy", KING);
    const enemy = field(b, "front", W);
    sidelineByHand(act, lost);
    act("a", { type: "activate", uid: geto.uid, ability: 1 });
    expect(game.pending).toBeNull(); // a single card: no choice
    expect(b.front).not.toContain(enemy);
    expect(b.sideline).toEqual([W]);

    // A new turn (the opponent's, then ours): nothing was sidelined yet this turn.
    act("a", { type: "end_turn" });
    for (const who of ["b", "a"]) {
      act(who, { type: "next_phase" });
      act(who, { type: "next_phase" });
      if (who === "b") act(who, { type: "end_turn" });
    }
    expect(game.turnPlayerId).toBe("a");
    expect(game.phase).toBe("main");
    expect(geto.rested).toBe(false);
    expect(() => act("a", { type: "activate", uid: geto.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
  });
});
