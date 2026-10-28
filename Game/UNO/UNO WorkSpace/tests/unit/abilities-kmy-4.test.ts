/**
 * KMY (鬼灭之刃) cards, batch 4 (EX05BT/KMY-1-022, 1-026 and EX05BT/KMY-3-001 .. 032): one test per card, set up as its printed text
 * describes and checked against the text. Card text comes from `Cards/cards.json` (no card images exist on this machine).
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, damageOf, energyOf, flagsOf, hasKeyword, impactOf, sidelineByEffect } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { markChosenByKatana } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/dsl.ts";
import type { AbilityEnv, Step } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/types.ts";
import { KMY_4_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-kmy-4.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import type { UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, energy, field, FILLER, setup } from "./ability-harness.ts";

const e = (n: string): string => `EX05BT/KMY-3-${n}`;
const u = (n: string): string => `UA05BT/KMY-1-${n}`;
type Act = (who: string, action: Parameters<ReturnType<typeof setup>["act"]>[1]) => void;
const pick = (act: Act, who: string, picks: string[]): void => act(who, { type: "choose", picks });
/** Lets the continuous abilities settle and resolves anything queued (the harness puts cards on the field directly): any action runs the engine's drain. */
const refresh = (act: Act): void => act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "activate" } });
/** Picks every option of the pending choice, in the order offered (the order for the bottom of the deck). */
const pickAll = (game: ReturnType<typeof setup>["game"], act: Act, who = "a"): void => pick(act, who, [...choice(game, who).options]);

// Helper cards.
const W0 = "UC01BT/ARK-1-009"; // yellow, cost 0, BP2000, makes one yellow energy, no text
const GUARD = "UC01ST/ARK-1-103"; // blue, cost 3, BP3000, makes two blue energy, no text
const MISHA = "UC01BT/ARK-1-001"; // BP1000
const HOSHI = "UC01BT/ARK-1-092"; // BP4000
const TANJIRO = u("005"); // 灶门 炭治郎: yellow, no ability
const SPARE_TANJIRO = u("092"); // 炭子, regarded as 〈灶门 炭治郎〉
const PILLAR2 = u("024"); // 时透 无一郎: 柱, AP 2
const PILLAR1 = u("018"); // 宇髓 天元: 柱, AP 1, 撤步 only
const IMPACT_PILLAR = "UA05ST/KMY-1-107"; // 富冈 义勇: 柱, AP 2, 冲击①
const UNKNOWN_TECH = "UC01BT/ARK-1-065"; // 未知技术: returns a character with cost 3 or less

/** The effect of a “特征：日轮刀” card choosing `card` (kmy-5's sites run `markChosenByKatana` after their choose step). */
function chosenByKatana(setupResult: ReturnType<typeof setup>, card: UnionArenaFieldCard): void {
  const step = markChosenByKatana("t") as Extract<Step, { do: "run" }>;
  step.fn({ game: setupResult.game, players: setupResult.players, ctx, owner: setupResult.a, opponent: setupResult.b, self: null, selfCardId: "", vars: { t: [card.uid] }, cause: null } as AbilityEnv);
  refresh(setupResult.act);
}

describe("KMY batch 4: the table", () => {
  it("has every card automated and the names the filters rely on", () => {
    for (const number of Object.keys(KMY_4_ABILITIES)) expect(isAutomated(titleCard(number)), number).toBe(true);
    expect(Object.keys(KMY_4_ABILITIES)).toHaveLength(32);
    expect(titleCard(e("001")).name).toBe("产屋敷 耀哉");
    expect(titleCard(e("005")).name).toBe("珠世");
    expect(titleCard(e("016")).name).toBe("灶门 炭治郎");
    expect(titleCard(e("018")).name).toBe("灶门 祢豆子");
    expect(titleCard(e("041")).name).toBe("日轮刀(灶门 炭治郎)");
    expect(titleCard(e("041")).stats.affinities).toEqual(["日轮刀"]);
    expect(titleCard(e("025")).stats.affinities).toEqual(["刀匠村"]);
    expect(titleCard(e("007")).stats.affinities).toEqual(["柱"]);
  });
});

describe("KMY batch 4: reprints and keyword-only cards", () => {
  it("不死川 实弥 (EX05BT 1-022): only the keyword 2次攻击", () => {
    expect(KMY_4_ABILITIES["EX05BT/KMY-1-022"]).toEqual([]);
    const { a } = setup();
    const card = field(a, "front", "EX05BT/KMY-1-022");
    expect(hasKeyword(ctx, card, "2次攻击")).toBe(true);
  });

  it("悲鸣屿 行冥 (EX05BT 1-026): 冲击① with 〈产屋敷 耀哉〉 and other 柱 totalling 3, the card itself not counted", () => {
    const { a, act } = setup();
    const gyomei = field(a, "front", "EX05BT/KMY-1-026");
    field(a, "energy", e("001")); // 耀哉
    field(a, "energy", PILLAR1);
    refresh(act);
    expect(impactOf(ctx, gyomei)).toBe(0); // 耀哉 + 1 other pillar = 2
    field(a, "energy", PILLAR1);
    refresh(act);
    expect(impactOf(ctx, gyomei)).toBe(1);
    // 3 pillars but only 2 others: the card itself does not count.
    const second = setup();
    const lone = field(second.a, "front", "EX05BT/KMY-1-026");
    field(second.a, "energy", PILLAR1);
    field(second.a, "energy", PILLAR1);
    refresh(second.act);
    expect(impactOf(ctx, lone)).toBe(0);
  });

  it("不死川 玄弥 (023) and 甘露寺 蜜璃 (030): only the keyword 冲击无效", () => {
    for (const number of [e("023"), e("030")]) {
      expect(KMY_4_ABILITIES[number]).toEqual([]);
      const { a } = setup();
      expect(hasKeyword(ctx, field(a, "front", number), "冲击无效")).toBe(true);
    }
  });
});

describe("KMY batch 4: yellow", () => {
  it("产屋敷 耀哉 (001): rests and leaves to make a 柱 active; cannot be used when already resting", () => {
    const { game, a, act } = setup();
    const oyakata = field(a, "energy", e("001"));
    const pillar = field(a, "front", e("007"), true);
    const plain = field(a, "front", W0, true);
    act("a", { type: "activate", uid: oyakata.uid, ability: 0 });
    expect(a.energy).toEqual([]); // 将此角色退场 is a cost
    expect(a.sideline).toEqual([e("001")]);
    // Only [特征:柱] characters can be chosen: there is exactly one, so it is chosen without a question.
    expect(game.pending).toBeNull();
    expect(pillar.rested).toBe(false);
    expect(plain.rested).toBe(true);

    // Two pillars: asked. Resting is a cost.
    const second = setup();
    const o2 = field(second.a, "energy", e("001"));
    const p1 = field(second.a, "front", e("007"), true);
    const p2 = field(second.a, "energy", PILLAR1, true);
    field(second.a, "front", W0, true);
    second.act("a", { type: "activate", uid: o2.uid, ability: 0 });
    expect(choice(second.game, "a").options).toEqual([p1.uid, p2.uid]);
    expect(choice(second.game, "a").min).toBe(1);
    pick(second.act, "a", [p2.uid]);
    expect(p2.rested).toBe(false);
    expect(p1.rested).toBe(true);
    const third = setup();
    const tired = field(third.a, "energy", e("001"), true);
    expect(() => third.act("a", { type: "activate", uid: tired.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("灶门 炭治郎 (002): protects our 〈灶门 祢豆子〉 from the opponent's effects on our turn while on the front line", () => {
    const { a, act } = setup();
    const tanjiro = field(a, "front", e("002"));
    const nezuko = field(a, "energy", e("003"));
    const other = field(a, "energy", W0);
    refresh(act);
    expect(flagsOf(nezuko)).toContain("untargetable:character");
    expect(flagsOf(nezuko)).toContain("noTriggerTarget"); // 触发的效果 too
    expect(flagsOf(other)).not.toContain("untargetable:character");
    // The opponent's turn: no protection.
    act("a", { type: "end_turn" });
    expect(flagsOf(nezuko)).not.toContain("untargetable:character");
    expect(flagsOf(nezuko)).not.toContain("noTriggerTarget");

    // On the energy line (not on the front line) it protects nobody.
    const second = setup();
    field(second.a, "energy", e("002"));
    const nez = field(second.a, "front", e("003"));
    refresh(second.act);
    expect(flagsOf(nez)).not.toContain("untargetable:character");
    expect(tanjiro.uid).toBeTruthy();
  });

  it("灶门 炭治郎 (002): may rest an active front-line 〈灶门 祢豆子〉 to make itself active", () => {
    const { game, a, act } = setup();
    energy(a, 4, W0);
    const nezuko = field(a, "front", e("003")); // active
    const nezukoToo = field(a, "front", e("003")); // active
    const restingNezuko = field(a, "front", e("003"), true);
    const energyNezuko = field(a, "energy", e("003"));
    a.hand.push(e("002"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const tanjiro = a.front[3]!;
    expect(tanjiro.cardId).toBe(e("002"));
    expect(tanjiro.rested).toBe(true);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(choice(game, "a").options).toEqual([nezuko.uid, nezukoToo.uid]); // active, on the front line
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [nezuko.uid]);
    expect(nezuko.rested).toBe(true);
    expect(nezukoToo.rested).toBe(false);
    expect(tanjiro.rested).toBe(false);
    expect(restingNezuko.rested).toBe(true);
    expect(energyNezuko.rested).toBe(false);

    // Answering no changes nothing.
    const second = setup();
    energy(second.a, 4, W0);
    const nz = field(second.a, "front", e("003"));
    second.a.hand.push(e("002"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["no"]);
    expect(nz.rested).toBe(false);
    expect(second.a.front[1]!.rested).toBe(true);

    // No active 〈灶门 祢豆子〉 on the front line: nothing is asked.
    const third = setup();
    energy(third.a, 4, W0);
    field(third.a, "front", e("003"), true);
    field(third.a, "energy", e("003"));
    third.a.hand.push(e("002"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(third.game.pending).toBeNull();
    expect(third.a.front[1]!.rested).toBe(true);
  });

  it("灶门 祢豆子 (003): draws one card, then puts one hand card into the sideline", () => {
    const { game, a, act } = setup();
    a.library = [W0, GUARD, HOSHI];
    a.hand.push(e("003"), MISHA);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([MISHA, W0]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([W0]);
    expect(a.sideline).toEqual([MISHA]);
    expect(a.library).toEqual([GUARD, HOSHI]);
  });

  it("神崎 葵 (004): may put a hand card into the sideline, then add up to one yellow character with cost 3 or less from the sideline", () => {
    const setupAoi = () => {
      const s = setup();
      energy(s.a, 1, W0);
      // yellow characters cost 0 and 4, a blue one, a yellow event
      s.a.sideline.push(e("003"), e("010"), e("012"), e("011"));
      s.a.hand.push(e("004"), W0, GUARD);
      s.act("a", { type: "play", handIndex: 0, line: "front" });
      return s;
    };
    const { game, a, act } = setupAoi();
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]); // W0 (yellow, cost 0) goes to the sideline
    // The sideline now has the yellow characters 003, W0 (cost 0) but not 010 (cost 4), the blue 012 or the event.
    expect(a.sideline).toEqual([e("003"), e("010"), e("012"), e("011"), W0]);
    expect(choice(game, "a").options).toEqual(["s:0", "s:4"]);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", ["s:0"]);
    expect(a.hand).toEqual([GUARD, e("003")]);
    expect(a.sideline).toEqual([e("010"), e("012"), e("011"), W0]);

    // No: nothing happens. Up to one: after paying, choosing nothing.
    const second = setupAoi();
    pick(second.act, "a", ["no"]);
    expect(second.a.hand).toEqual([W0, GUARD]);
    expect(second.game.pending).toBeNull();
    const third = setupAoi();
    pick(third.act, "a", ["yes"]);
    pick(third.act, "a", ["h:1"]);
    pick(third.act, "a", []);
    expect(third.a.sideline).toHaveLength(5);
    expect(third.a.hand).toEqual([W0]);

    // An empty hand: nothing is asked.
    const fourth = setup();
    energy(fourth.a, 1, W0);
    fourth.a.hand.push(e("004"));
    fourth.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(fourth.game.pending).toBeNull();
  });

  it("珠世 (005): the opponent puts 1 card of their own sideline into the removal area (2 with 10 or more there)", () => {
    const { game, a, b, act } = setup();
    const tamayo = field(a, "energy", e("005"));
    b.sideline.push(W0, GUARD, HOSHI);
    a.sideline.push(MISHA);
    act("a", { type: "activate", uid: tamayo.uid, ability: 0 });
    expect(tamayo.rested).toBe(true);
    // The opponent chooses, among their own sideline.
    expect(choice(game, "b").options).toEqual(["os:0", "os:1", "os:2"]);
    expect(choice(game, "b").min).toBe(1);
    expect(choice(game, "b").max).toBe(1);
    pick(act, "b", ["os:1"]);
    expect(b.removal).toEqual([GUARD]);
    expect(b.sideline).toEqual([W0, HOSHI]);
    expect(a.sideline).toEqual([MISHA]); // ours is untouched
    expect(a.removal).toEqual([]);
    expect(() => act("a", { type: "activate", uid: tamayo.uid, ability: 0 })).toThrow("ABILITY_COST"); // resting is a cost

    // 10 or more cards: 2 of them.
    const second = setup();
    const t2 = field(second.a, "energy", e("005"));
    const ten = [W0, GUARD, HOSHI, MISHA, FILLER, e("003"), e("004"), e("006"), e("007"), e("008")];
    second.b.sideline.push(...ten);
    second.act("a", { type: "activate", uid: t2.uid, ability: 0 });
    expect(choice(second.game, "b").min).toBe(2);
    expect(choice(second.game, "b").max).toBe(2);
    expect(choice(second.game, "b").options).toHaveLength(10);
    pick(second.act, "b", ["os:0", "os:3"]);
    expect(second.b.removal).toEqual([W0, MISHA]);
    expect(second.b.sideline).toHaveLength(8);
    // 9 cards: only 1.
    const third = setup();
    const t3 = field(third.a, "energy", e("005"));
    third.b.sideline.push(...ten.slice(0, 9));
    third.act("a", { type: "activate", uid: t3.uid, ability: 0 });
    expect(choice(third.game, "b").max).toBe(1);

    // A single card is taken without a question; an empty sideline does nothing.
    const fourth = setup();
    const t4 = field(fourth.a, "energy", e("005"));
    fourth.b.sideline.push(W0);
    fourth.act("a", { type: "activate", uid: t4.uid, ability: 0 });
    expect(fourth.game.pending).toBeNull();
    expect(fourth.b.removal).toEqual([W0]);
    const fifth = setup();
    const t5 = field(fifth.a, "energy", e("005"));
    fifth.act("a", { type: "activate", uid: t5.uid, ability: 0 });
    expect(fifth.game.pending).toBeNull();
    expect(fifth.b.removal).toEqual([]);
  });

  it("愈史郎 (006): BP+1000 while 〈珠世〉 is on our field", () => {
    const { a, act } = setup();
    const yushiro = field(a, "front", e("006"));
    refresh(act);
    expect(bpOf(ctx, yushiro)).toBe(2000);
    field(a, "energy", e("005"));
    refresh(act);
    expect(bpOf(ctx, yushiro)).toBe(3000);
    // The opponent's 珠世 does not count.
    const second = setup();
    const lone = field(second.a, "front", e("006"));
    field(second.b, "energy", e("005"));
    refresh(second.act);
    expect(bpOf(ctx, lone)).toBe(2000);
  });

  it("甘露寺 蜜璃 (007): from the front line, discards a card to make a 柱 with AP cost 2 active, once per turn", () => {
    const { game, a, act } = setup();
    const mitsuri = field(a, "front", e("007"));
    const two = field(a, "front", e("010"), true); // 柱, AP 2
    const two2 = field(a, "energy", PILLAR2, true); // 柱, AP 2
    const one = field(a, "energy", PILLAR1, true); // 柱, AP 1
    const noPillar = field(a, "energy", e("024"), true); // AP 2, not a 柱
    a.hand.push(GUARD, MISHA);
    act("a", { type: "activate", uid: mitsuri.uid, ability: 0 });
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]); // the discard is chosen first
    pick(act, "a", ["h:0"]);
    expect(a.sideline).toEqual([GUARD]);
    expect(choice(game, "a").options).toEqual([two.uid, two2.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [two2.uid]);
    expect(two2.rested).toBe(false);
    expect([two.rested, one.rested, noPillar.rested]).toEqual([true, true, true]);
    expect(() => act("a", { type: "activate", uid: mitsuri.uid, ability: 0 })).toThrow("ONCE_PER_TURN");

    // Not on the front line; no hand card to discard.
    const second = setup();
    const back = field(second.a, "energy", e("007"));
    second.a.hand.push(GUARD);
    expect(() => second.act("a", { type: "activate", uid: back.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    const third = setup();
    const front = field(third.a, "front", e("007"));
    expect(() => third.act("a", { type: "activate", uid: front.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("蝴蝶 忍 (008): 撤步; may draw a card when it loses an attack battle", () => {
    const attackWithShinobu = () => {
      const s = setup("attack");
      const shinobu = field(s.a, "front", e("008")); // BP2500
      const wall = field(s.b, "front", HOSHI); // BP4000
      s.a.library = [W0, GUARD];
      s.act("a", { type: "attack", attackerUid: shinobu.uid });
      s.act("b", { type: "block", blockerUid: wall.uid });
      return { ...s, shinobu };
    };
    const yes = attackWithShinobu();
    expect(hasKeyword(ctx, yes.shinobu, "撤步")).toBe(true);
    expect(choice(yes.game, "a").purpose).toBe("confirm");
    pick(yes.act, "a", ["yes"]);
    expect(yes.a.hand).toEqual([W0]); // 1 card only: losing the battle itself is not a draw reason for 【退场时】
    const no = attackWithShinobu();
    pick(no.act, "a", ["no"]);
    expect(no.a.hand).toEqual([]);

    // Winning the battle: nothing.
    const won = setup("attack");
    const attacker = field(won.a, "front", e("008"));
    const weak = field(won.b, "front", W0);
    won.a.library = [W0, GUARD];
    won.act("a", { type: "attack", attackerUid: attacker.uid });
    won.act("b", { type: "block", blockerUid: weak.uid });
    expect(won.game.pending).toBeNull();
    expect(won.a.hand).toEqual([]);
  });

  it("蝴蝶 忍 (008): draws a card when sidelined by BP 0 or less or by the opponent's effect, not by our own effect", () => {
    const bpZero = setup();
    const s1 = field(bpZero.a, "front", e("008"));
    bpZero.a.library = [W0, GUARD];
    s1.bpMod = -2500;
    refresh(bpZero.act);
    expect(bpZero.a.sideline).toEqual([e("008")]);
    expect(bpZero.a.hand).toEqual([W0]);

    const byOpponent = setup();
    const s2 = field(byOpponent.a, "front", e("008"));
    byOpponent.a.library = [W0, GUARD];
    sidelineByEffect(byOpponent.game, ctx, byOpponent.a, s2.uid, "b");
    refresh(byOpponent.act);
    expect(byOpponent.a.sideline).toEqual([e("008")]);
    expect(byOpponent.a.hand).toEqual([W0]);

    const byOwn = setup();
    const s3 = field(byOwn.a, "front", e("008"));
    byOwn.a.library = [W0, GUARD];
    sidelineByEffect(byOwn.game, ctx, byOwn.a, s3.uid, "a");
    refresh(byOwn.act);
    expect(byOwn.a.sideline).toEqual([e("008")]);
    expect(byOwn.a.hand).toEqual([]);
  });

  it("时透 无一郎 (009): from the front line, a 柱 with AP cost 2 gets 冲击+1 this turn, once per turn", () => {
    const { game, a, act } = setup();
    const muichiro = field(a, "front", e("009"));
    const plain = field(a, "energy", e("010")); // 柱, AP 2, no 冲击
    const sharp = field(a, "energy", IMPACT_PILLAR); // 柱, AP 2, 冲击①
    const one = field(a, "energy", PILLAR1); // AP 1
    act("a", { type: "activate", uid: muichiro.uid, ability: 0 });
    expect(choice(game, "a").options).toEqual([plain.uid, sharp.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [sharp.uid]);
    expect(impactOf(ctx, sharp)).toBe(2);
    expect(impactOf(ctx, plain)).toBe(0);
    expect(impactOf(ctx, one)).toBe(0);
    expect(() => act("a", { type: "activate", uid: muichiro.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "end_turn" });
    expect(impactOf(ctx, sharp)).toBe(1);

    const second = setup();
    const target = field(second.a, "energy", e("010"));
    const m2 = field(second.a, "front", e("009"));
    second.act("a", { type: "activate", uid: m2.uid, ability: 0 });
    expect(second.game.pending).toBeNull(); // the only choice
    expect(impactOf(ctx, target)).toBe(1); // no 冲击 of its own: it gets 冲击①
    const third = setup();
    const back = field(third.a, "energy", e("009"));
    expect(() => third.act("a", { type: "activate", uid: back.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
  });

  it("富冈 义勇 (010): AP cost -1 in the hand with 3 or more 〈产屋敷 耀哉〉 / 柱 on our field", () => {
    const { game, players, a } = setup();
    const apCost = (): number => costOf(game, players, ctx, "a", e("010")).ap;
    expect(apCost()).toBe(2);
    field(a, "energy", e("001")); // 耀哉
    field(a, "energy", PILLAR1);
    expect(apCost()).toBe(2); // 2 so far
    field(a, "front", e("007"));
    expect(apCost()).toBe(1);
    field(a, "front", W0); // not counted
    expect(apCost()).toBe(1);
    expect(costOf(game, players, ctx, "a", e("010")).energy).toBe(4);
  });

  it("富冈 义勇 (010): when attacking with 6 or more 耀哉 / 柱 (itself included), up to one other 柱 gets BP+1500", () => {
    const attackWith = (others: number) => {
      const s = setup("attack");
      const giyu = field(s.a, "front", e("010"));
      const pillars: UnionArenaFieldCard[] = [];
      for (let index = 0; index < others; index += 1) pillars.push(field(s.a, index === 0 ? "energy" : index < 4 ? "front" : "energy", index === 0 ? e("001") : PILLAR1));
      const plain = field(s.a, "energy", W0);
      const wall = field(s.b, "front", HOSHI);
      s.act("a", { type: "attack", attackerUid: giyu.uid });
      return { ...s, giyu, pillars, plain, wall };
    };
    // 6 in total (itself + 耀哉 + 4 pillars).
    const six = attackWith(5);
    expect(choice(six.game, "a").options).toHaveLength(4); // other 柱 only: not 耀哉, not itself, not the plain character
    expect(choice(six.game, "a").options).not.toContain(six.giyu.uid);
    expect(choice(six.game, "a").options).not.toContain(six.pillars[0]!.uid);
    expect(choice(six.game, "a").options).not.toContain(six.plain.uid);
    expect(choice(six.game, "a").min).toBe(0);
    const target = six.pillars[1]!;
    pick(six.act, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(3000 + 1500);
    expect(bpOf(ctx, six.giyu)).toBe(4000);
    // Up to one: none.
    const none = attackWith(5);
    pick(none.act, "a", []);
    expect(none.pillars.map((card) => bpOf(ctx, card))).toEqual([1000, 3000, 3000, 3000, 3000]);
    // Only 5 in total: no effect, the attack goes on to the block.
    const five = attackWith(4);
    expect(five.game.pending?.kind).toBe("block");
  });

  it("看护 (011): adds a character card from the sideline to the hand", () => {
    const { game, a, act } = setup();
    energy(a, 2, W0);
    a.sideline.push(e("003"), e("044"), e("040"), GUARD);
    a.hand.push(e("011"));
    act("a", { type: "event", handIndex: 0 });
    // Characters only (not the event, not the site).
    expect(choice(game, "a").options).toEqual(["s:0", "s:3"]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", ["s:3"]);
    expect(a.hand).toEqual([GUARD]);
    expect(a.sideline).toEqual([e("003"), e("044"), e("040"), e("011")]);

    // Exactly one character: taken without a question. None: nothing happens.
    const second = setup();
    energy(second.a, 2, W0);
    second.a.sideline.push(e("044"), GUARD);
    second.a.hand.push(e("011"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([GUARD]);
    const third = setup();
    energy(third.a, 2, W0);
    third.a.hand.push(e("011"));
    third.act("a", { type: "event", handIndex: 0 });
    expect(third.game.pending).toBeNull();
    expect(third.a.hand).toEqual([]);
  });
});

describe("KMY batch 4: blue", () => {
  it("隐 (012): first mode moves up to one of our characters to the other line", () => {
    const { game, a, act } = setup();
    energy(a, 1, GUARD);
    const front = field(a, "front", W0);
    a.hand.push(e("012"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const kakushi = a.front[1]!;
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    expect(choice(game, "a").options).toEqual([front.uid, kakushi.uid, a.energy[0]!.uid]); // any of our characters
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [front.uid]);
    expect(a.front).toEqual([kakushi]);
    expect(a.energy.map((card) => card.uid)).toContain(front.uid);

    // From the energy line to the front line; and choosing nothing.
    const second = setup();
    energy(second.a, 1, GUARD);
    const guard = second.a.energy[0]!;
    second.a.hand.push(e("012"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["m:0"]);
    pick(second.act, "a", [guard.uid]);
    expect(second.a.front.map((card) => card.uid)).toContain(guard.uid);
    const third = setup();
    energy(third.a, 1, GUARD);
    third.a.hand.push(e("012"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", ["m:0"]);
    pick(third.act, "a", []);
    expect(third.a.front).toHaveLength(1);
    expect(third.a.energy).toHaveLength(1);
  });

  it("隐 (012): second mode may swap a front-line character with an energy-line character", () => {
    const { game, a, act } = setup();
    energy(a, 1, GUARD);
    const guard = a.energy[0]!;
    const spareEnergy = field(a, "energy", FILLER);
    const front = field(a, "front", W0);
    const other = field(a, "front", FILLER);
    a.hand.push(e("012"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const kakushi = a.front[2]!;
    pick(act, "a", ["m:1"]);
    expect(choice(game, "a").options).toEqual([front.uid, other.uid, kakushi.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [front.uid]);
    expect(choice(game, "a").options).toEqual([guard.uid, spareEnergy.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [guard.uid]);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.front.map((card) => card.uid)).toEqual([guard.uid, other.uid, kakushi.uid]);
    expect(a.energy.map((card) => card.uid)).toEqual([front.uid, spareEnergy.uid]);

    // "可以": answering no leaves the positions.
    const second = setup();
    energy(second.a, 1, GUARD);
    const g2 = second.a.energy[0]!;
    const f2 = field(second.a, "front", W0);
    field(second.a, "energy", FILLER);
    second.a.hand.push(e("012"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["m:1"]);
    pick(second.act, "a", [f2.uid]);
    pick(second.act, "a", [g2.uid]);
    pick(second.act, "a", ["no"]);
    expect(second.a.front.map((card) => card.uid)).toContain(f2.uid);
    expect(second.a.energy.map((card) => card.uid)).toContain(g2.uid);
    expect(second.a.energy).toHaveLength(2);
  });

  it("鎹鸦 (013): once per turn rests for +1 blue energy this turn and leaves when the main phase ends", () => {
    const { a, act } = setup();
    const crow = field(a, "energy", e("013"));
    expect(energyOf(ctx, a, "blue")).toBe(1);
    act("a", { type: "activate", uid: crow.uid, ability: 0 });
    expect(crow.rested).toBe(true);
    expect(energyOf(ctx, a, "blue")).toBe(2);
    expect(() => act("a", { type: "activate", uid: crow.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([e("013")]);
  });

  it("灶门 炭治郎 (015): once per turn, BP+500 when chosen by a 日轮刀 effect", () => {
    const s = setup();
    const tanjiro = field(s.a, "front", e("015"));
    expect(bpOf(ctx, tanjiro)).toBe(2500);
    chosenByKatana(s, tanjiro);
    expect(bpOf(ctx, tanjiro)).toBe(3000);
    chosenByKatana(s, tanjiro); // once per turn
    expect(bpOf(ctx, tanjiro)).toBe(3000);
    s.act("a", { type: "end_turn" });
    expect(bpOf(ctx, tanjiro)).toBe(2500);
    // Chosen by something else (not 日轮刀): no reaction.
    const other = setup();
    const t2 = field(other.a, "front", e("015"));
    refresh(other.act);
    expect(bpOf(ctx, t2)).toBe(2500);
  });

  it("灶门 炭治郎 (016): chosen by a 日轮刀 effect, up to one 〈灶门 祢豆子〉 gets BP+1000 (once per turn)", () => {
    const s = setup();
    const tanjiro = field(s.a, "front", e("016"));
    const nezuko = field(s.a, "energy", e("018"));
    const nezuko2 = field(s.a, "front", e("019"));
    const other = field(s.a, "front", W0);
    chosenByKatana(s, tanjiro);
    expect(choice(s.game, "a").options).toEqual([nezuko2.uid, nezuko.uid]); // the front line is listed first
    expect(choice(s.game, "a").min).toBe(0);
    pick(s.act, "a", [nezuko2.uid]);
    expect(bpOf(ctx, nezuko2)).toBe(3000);
    expect(bpOf(ctx, nezuko)).toBe(2000);
    expect(bpOf(ctx, other)).toBe(2000);
    chosenByKatana(s, tanjiro);
    expect(s.game.pending).toBeNull(); // once per turn

    // Up to one: choosing nobody.
    const second = setup();
    const t2 = field(second.a, "front", e("016"));
    const n2 = field(second.a, "energy", e("018"));
    field(second.a, "energy", e("019"));
    chosenByKatana(second, t2);
    pick(second.act, "a", []);
    expect(bpOf(ctx, n2)).toBe(2000);
  });

  it("灶门 炭治郎 (016): from the front line, pays 1 AP once per turn to give a 〈灶门 祢豆子〉 BP+1000", () => {
    const { game, a, act } = setup();
    const tanjiro = field(a, "front", e("016"));
    const nezuko = field(a, "energy", e("018"));
    const nezuko2 = field(a, "front", e("019"));
    field(a, "front", W0);
    act("a", { type: "activate", uid: tanjiro.uid, ability: 1 });
    expect(a.ap.filter((card) => card.rested)).toHaveLength(1);
    expect(choice(game, "a").options).toEqual([nezuko2.uid, nezuko.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [nezuko.uid]);
    expect(bpOf(ctx, nezuko)).toBe(3000);
    expect(() => act("a", { type: "activate", uid: tanjiro.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, nezuko)).toBe(2000);

    // Energy line: not usable. No active AP: cannot pay.
    const second = setup();
    const back = field(second.a, "energy", e("016"));
    expect(() => second.act("a", { type: "activate", uid: back.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    const third = setup();
    const front = field(third.a, "front", e("016"));
    third.a.ap.forEach((card) => { card.rested = true; });
    expect(() => third.act("a", { type: "activate", uid: front.uid, ability: 1 })).toThrow("ABILITY_COST");
  });

  it("灶门 炭治郎 (017): chosen by a 日轮刀 effect, gains 冲击① this turn (once per turn)", () => {
    const s = setup();
    const tanjiro = field(s.a, "front", e("017"));
    expect(impactOf(ctx, tanjiro)).toBe(0);
    chosenByKatana(s, tanjiro);
    expect(impactOf(ctx, tanjiro)).toBe(1);
    s.act("a", { type: "end_turn" });
    expect(impactOf(ctx, tanjiro)).toBe(0);
    expect(titleCard(e("017")).stats.raid).toBeTruthy(); // 【突进】〈灶门 炭治郎〉
  });

  it("灶门 炭治郎 (017): may return a 〈灶门 祢豆子〉 to the hand, then discard a card and sideline an enemy with BP 4000 or less", () => {
    const build = () => {
      const s = setup();
      energy(s.a, 2, GUARD);
      const nezuko = field(s.a, "front", e("018"));
      field(s.a, "energy", W0);
      const small = field(s.b, "front", GUARD); // 3000
      const four = field(s.b, "front", HOSHI); // 4000
      const big = field(s.b, "front", W0);
      big.bpMod = 3000; // 5000
      s.a.hand.push(e("017"), MISHA, FILLER);
      s.act("a", { type: "play", handIndex: 0, line: "front" });
      return { ...s, nezuko, small, four, big };
    };
    const yes = build();
    expect(choice(yes.game, "a").purpose).toBe("confirm");
    pick(yes.act, "a", ["yes"]);
    // The only 〈灶门 祢豆子〉 is taken without a question; then a hand card is discarded (the returned card is in the hand too).
    expect(yes.a.hand).toEqual([MISHA, FILLER, e("018")]);
    expect(yes.a.front.map((card) => card.uid)).not.toContain(yes.nezuko.uid);
    expect(choice(yes.game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    pick(yes.act, "a", ["h:1"]);
    expect(yes.a.sideline).toEqual([FILLER]);
    expect(choice(yes.game, "a").options).toEqual([yes.small.uid, yes.four.uid]);
    expect(choice(yes.game, "a").min).toBe(0);
    pick(yes.act, "a", [yes.four.uid]);
    expect(yes.b.sideline).toEqual([HOSHI]);
    expect(yes.b.front).toHaveLength(2);

    // No: nothing happens.
    const no = build();
    pick(no.act, "a", ["no"]);
    expect(no.a.hand).toEqual([MISHA, FILLER]);
    expect(no.b.front).toHaveLength(3);
    expect(no.a.front.map((card) => card.uid)).toContain(no.nezuko.uid);

    // Up to one: nothing is chosen after the cost was paid.
    const none = build();
    pick(none.act, "a", ["yes"]);
    pick(none.act, "a", ["h:0"]);
    pick(none.act, "a", []);
    expect(none.b.front).toHaveLength(3);
    expect(none.a.hand).toEqual([FILLER, e("018")]);

    // Without a 〈灶门 祢豆子〉 on our field: nothing is asked.
    const lone = setup();
    energy(lone.a, 2, GUARD);
    lone.a.hand.push(e("017"));
    lone.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(lone.game.pending).toBeNull();
  });

  it("灶门 祢豆子 (018): looks at the top card and puts it on top or on the bottom of the deck", () => {
    const { game, a, act } = setup();
    a.library = [W0, GUARD, HOSHI];
    a.hand.push(e("018"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    expect(a.library).toEqual([W0, GUARD, HOSHI]);
    expect(game.looking).toBeNull();

    const second = setup();
    second.a.library = [W0, GUARD, HOSHI];
    second.a.hand.push(e("018"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["m:1"]);
    expect(second.a.library).toEqual([GUARD, HOSHI, W0]);

    // An empty deck: nothing to look at.
    const third = setup();
    third.a.library = [];
    third.a.hand.push(e("018"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(third.game.pending).toBeNull();
  });

  it("灶门 祢豆子 (019): draws a card, then puts a hand card on top or on the bottom of the deck", () => {
    const build = () => {
      const s = setup();
      energy(s.a, 1, GUARD);
      s.a.library = [W0, GUARD, HOSHI];
      s.a.hand.push(e("019"), MISHA);
      s.act("a", { type: "play", handIndex: 0, line: "front" });
      return s;
    };
    const top = build();
    expect(top.a.hand).toEqual([MISHA, W0]);
    expect(choice(top.game, "a").options).toEqual(["h:0", "h:1"]);
    expect(choice(top.game, "a").min).toBe(1);
    pick(top.act, "a", ["h:1"]);
    expect(choice(top.game, "a").options).toEqual(["m:0", "m:1"]);
    pick(top.act, "a", ["m:0"]);
    expect(top.a.hand).toEqual([MISHA]);
    expect(top.a.library).toEqual([W0, GUARD, HOSHI]);

    const bottom = build();
    pick(bottom.act, "a", ["h:0"]);
    pick(bottom.act, "a", ["m:1"]);
    expect(bottom.a.hand).toEqual([W0]);
    expect(bottom.a.library).toEqual([GUARD, HOSHI, MISHA]);
    expect(bottom.a.sideline).toEqual([]);
  });

  it("灶门 祢豆子 (020): attacking, looks at the top card; a 〈灶门 炭治郎〉 / 〈日轮刀(灶门 炭治郎)〉 may be revealed for BP+1000; the card stays on top", () => {
    for (const top of [TANJIRO, SPARE_TANJIRO, e("041")]) {
      const { game, a, b, act } = setup("attack");
      const nezuko = field(a, "front", e("020"));
      field(b, "front", HOSHI);
      a.library = [top, W0, GUARD];
      act("a", { type: "attack", attackerUid: nezuko.uid });
      expect(choice(game, "a").purpose).toBe("confirm");
      pick(act, "a", ["yes"]);
      expect(bpOf(ctx, nezuko)).toBe(4000);
      expect(a.library).toEqual([top, W0, GUARD]);
      expect(a.hand).toEqual([]);
      expect(game.looking).toBeNull();
    }
    // No (or another card): no bonus; the card stays on top.
    const no = setup("attack");
    const n2 = field(no.a, "front", e("020"));
    field(no.b, "front", HOSHI);
    no.a.library = [TANJIRO, W0];
    no.act("a", { type: "attack", attackerUid: n2.uid });
    pick(no.act, "a", ["no"]);
    expect(bpOf(ctx, n2)).toBe(3000);
    expect(no.a.library).toEqual([TANJIRO, W0]);
    const plain = setup("attack");
    const n3 = field(plain.a, "front", e("020"));
    field(plain.b, "front", HOSHI);
    plain.a.library = [W0, TANJIRO];
    plain.act("a", { type: "attack", attackerUid: n3.uid });
    expect(plain.game.pending?.kind).toBe("block"); // nothing to reveal: no question
    expect(bpOf(ctx, n3)).toBe(3000);
    expect(plain.a.library).toEqual([W0, TANJIRO]);
  });

  it("灶门 祢豆子 (021): the Raid source goes to the hand with her when she is returned from the field", () => {
    expect(titleCard(e("021")).stats.raid).toBeTruthy();
    const { game, a, act } = setup();
    energy(a, 2, GUARD);
    const nezuko = field(a, "front", e("021"));
    nezuko.under = [e("018")];
    const spare = field(a, "front", e("019")); // cost 1: not a legal pick in the way
    a.library = [W0, GUARD, HOSHI];
    a.hand.push(UNKNOWN_TECH);
    refresh(act);
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([nezuko.uid, spare.uid, ...a.energy.map((card) => card.uid)]); // every character with cost 3 or less
    pick(act, "a", [nezuko.uid]);
    expect(a.hand).toEqual([e("018"), e("021"), W0, GUARD, HOSHI]); // the Raid source with her, then the three cards drawn
    expect(a.sideline).toEqual([UNKNOWN_TECH]); // the Raid source did not go to the sideline

    // Another character with a Raid source is still sidelined with it going to the sideline.
    const second = setup();
    energy(second.a, 2, GUARD);
    const plain = field(second.a, "front", e("019"));
    plain.under = [e("018")];
    second.a.library = [W0, GUARD, HOSHI];
    second.a.hand.push(UNKNOWN_TECH);
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", [plain.uid]);
    expect(second.a.hand).toEqual([e("019"), W0, GUARD, HOSHI]);
    expect(second.a.sideline).toEqual([e("018"), UNKNOWN_TECH]);

    // Sidelined (not returned): the source goes to the sideline as always.
    const third = setup();
    const n3 = field(third.a, "front", e("021"));
    n3.under = [e("018")];
    sidelineByEffect(third.game, ctx, third.a, n3.uid, "b");
    refresh(third.act);
    expect(third.a.hand).toEqual([]);
    expect(third.a.sideline).toEqual([e("018"), e("021")]);
  });

  it("灶门 祢豆子 (021): BP+500 on our turn with 〈灶门 炭治郎〉 (or 炭子) on our field", () => {
    const { a, act } = setup();
    const nezuko = field(a, "front", e("021"));
    refresh(act);
    expect(bpOf(ctx, nezuko)).toBe(3500);
    field(a, "energy", TANJIRO);
    refresh(act);
    expect(bpOf(ctx, nezuko)).toBe(4000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, nezuko)).toBe(3500); // the opponent's turn

    const second = setup();
    const n2 = field(second.a, "front", e("021"));
    field(second.a, "energy", SPARE_TANJIRO);
    refresh(second.act);
    expect(bpOf(ctx, n2)).toBe(4000);
  });

  it("灶门 祢豆子 (021): when played with 〈灶门 炭治郎〉 draws 1; with the 日轮刀 card too, may draw 2 and put a hand card on the deck instead", () => {
    const build = (tanjiro: string | null, sword: boolean) => {
      const s = setup();
      energy(s.a, 2, GUARD);
      if (tanjiro) field(s.a, "energy", tanjiro);
      if (sword) field(s.a, "energy", e("041"));
      s.a.library = [W0, GUARD, HOSHI];
      s.a.hand.push(e("021"), MISHA);
      s.act("a", { type: "play", handIndex: 0, line: "front" });
      return s;
    };
    // No 〈灶门 炭治郎〉: nothing (even with the 日轮刀).
    const none = build(null, true);
    expect(none.game.pending).toBeNull();
    expect(none.a.hand).toEqual([MISHA]);
    // 〈灶门 炭治郎〉 only: draws 1 with no question.
    const one = build(TANJIRO, false);
    expect(one.game.pending).toBeNull();
    expect(one.a.hand).toEqual([MISHA, W0]);
    // 炭子 counts as 〈灶门 炭治郎〉.
    const spare = build(SPARE_TANJIRO, false);
    expect(spare.a.hand).toEqual([MISHA, W0]);
    // Both: the replacement is optional. Yes: draws 2, then one hand card on the bottom of the deck.
    const yes = build(TANJIRO, true);
    expect(choice(yes.game, "a").purpose).toBe("confirm");
    pick(yes.act, "a", ["yes"]);
    expect(yes.a.hand).toEqual([MISHA, W0, GUARD]);
    expect(choice(yes.game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    pick(yes.act, "a", ["h:0"]);
    pick(yes.act, "a", ["m:1"]);
    expect(yes.a.hand).toEqual([W0, GUARD]);
    expect(yes.a.library).toEqual([HOSHI, MISHA]);
    // Yes, top of the deck.
    const top = build(TANJIRO, true);
    pick(top.act, "a", ["yes"]);
    pick(top.act, "a", ["h:2"]);
    pick(top.act, "a", ["m:0"]);
    expect(top.a.hand).toEqual([MISHA, W0]);
    expect(top.a.library).toEqual([GUARD, HOSHI]);
    // No: the normal draw of 1.
    const no = build(TANJIRO, true);
    pick(no.act, "a", ["no"]);
    expect(no.game.pending).toBeNull();
    expect(no.a.hand).toEqual([MISHA, W0]);
    expect(no.a.library).toEqual([GUARD, HOSHI]);
  });

  it("不死川 玄弥 (024): enters active; when sidelined may add itself to the hand", () => {
    const { game, a, act } = setup();
    energy(a, 2, GUARD);
    a.hand.push(e("024"), W0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    const genya = a.front[0]!;
    expect(genya.rested).toBe(false);
    expect(a.ap.filter((card) => card.rested)).toHaveLength(2); // 2 AP
    // Another character enters resting.
    a.hand.push(FILLER);
    act("a", { type: "play", handIndex: 1, line: "front" });
    expect(a.front[1]!.rested).toBe(true);
    sidelineByEffect(game, ctx, a, genya.uid, "b");
    refresh(act);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.hand).toEqual([W0, e("024")]);
    expect(a.sideline).toEqual([]);

    // No: it stays in the sideline.
    const second = setup();
    const g2 = field(second.a, "front", e("024"));
    sidelineByEffect(second.game, ctx, second.a, g2.uid, "b");
    refresh(second.act);
    pick(second.act, "a", ["no"]);
    expect(second.a.hand).toEqual([]);
    expect(second.a.sideline).toEqual([e("024")]);

    // Sidelined by BP 0 or less in battle terms too (any cause).
    const third = setup();
    const g3 = field(third.a, "front", e("024"));
    g3.bpMod = -4000;
    refresh(third.act);
    pick(third.act, "a", ["yes"]);
    expect(third.a.hand).toEqual([e("024")]);
  });

  it("钢铁冢 萤 (025): first mode looks at 7 and adds up to one 日轮刀 card to the hand", () => {
    const build = () => {
      const s = setup();
      energy(s.a, 2, GUARD);
      s.a.library = [W0, e("041"), GUARD, e("042"), FILLER, HOSHI, MISHA, TANJIRO];
      s.a.hand.push(e("025"));
      s.act("a", { type: "play", handIndex: 0, line: "front" });
      return s;
    };
    const { game, a, act } = build();
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    expect(choice(game, "a").options).toEqual(["l:1", "l:3"]); // the 日轮刀 sites among the top 7
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", ["l:3"]);
    expect(a.hand).toEqual([e("042")]);
    // The rest go to the bottom, in the order chosen.
    expect(choice(game, "a").options).toHaveLength(6);
    pick(act, "a", ["l:5", "l:0", "l:1", "l:2", "l:3", "l:4"]);
    expect(a.library.slice(0, 1)).toEqual([TANJIRO]);
    expect(a.library.slice(1, 7)).toEqual([MISHA, W0, e("041"), GUARD, FILLER, HOSHI].map((card, index, list) => list[index]));
    // Up to one: none.
    const none = build();
    pick(none.act, "a", ["m:0"]);
    pick(none.act, "a", []);
    pickAll(none.game, none.act);
    expect(none.a.hand).toEqual([]);
    expect(none.a.library).toHaveLength(8);
  });

  it("钢铁冢 萤 (025): second mode draws a card only if a 日轮刀 card is on our field", () => {
    const build = (sword: boolean) => {
      const s = setup();
      energy(s.a, 2, GUARD);
      if (sword) field(s.a, "energy", e("043"));
      s.a.library = [W0, GUARD];
      s.a.hand.push(e("025"));
      s.act("a", { type: "play", handIndex: 0, line: "front" });
      pick(s.act, "a", ["m:1"]);
      return s;
    };
    expect(build(true).a.hand).toEqual([W0]);
    expect(build(false).a.hand).toEqual([]);
  });

  it("铁穴森 钢藏 (026): one more blue energy while active", () => {
    const { a, act } = setup();
    const hagane = field(a, "energy", e("026"));
    refresh(act);
    expect(energyOf(ctx, a, "blue")).toBe(2);
    hagane.rested = true;
    refresh(act);
    expect(energyOf(ctx, a, "blue")).toBe(1);
  });

  it("小铁 (027): returns another character of cost 1 or less to the hand, or else himself", () => {
    const { game, a, act } = setup();
    const keep = field(a, "front", FILLER);
    const back = field(a, "front", W0);
    a.hand.push(e("027"));
    energy(a, 1, GUARD);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([keep.uid, back.uid]);
    expect(choice(game, "a").options).not.toContain(a.front[2]!.uid); // not himself
    expect(choice(game, "a").options).not.toContain(a.energy[0]!.uid); // Guard costs 3
    pick(act, "a", [back.uid]);
    expect(a.hand).toEqual([W0]);
    expect(a.front.map((card) => card.cardId)).toEqual([FILLER, e("027")]);

    // Only an expensive other character: he returns himself.
    const second = setup();
    field(second.a, "front", GUARD);
    energy(second.a, 1, GUARD);
    second.a.hand.push(e("027"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([e("027")]);
    expect(second.a.front.map((card) => card.cardId)).toEqual([GUARD]);
  });

  it("铁地河源 铁珍 (028): looks at 4, adds up to one 刀匠村 / 日轮刀 card to the hand, then discards a card", () => {
    const build = () => {
      const s = setup();
      s.a.library = [W0, e("026"), GUARD, e("041"), HOSHI, MISHA];
      s.a.hand.push(e("028"), FILLER);
      s.act("a", { type: "play", handIndex: 0, line: "front" });
      return s;
    };
    const { game, a, act } = build();
    expect(choice(game, "a").options).toEqual(["l:1", "l:3"]); // 刀匠村 and 日轮刀, within the top 4
    pick(act, "a", ["l:3"]);
    expect(a.hand).toEqual([FILLER, e("041")]);
    pick(act, "a", ["l:2", "l:0", "l:1"]);
    expect(a.library).toEqual([HOSHI, MISHA, GUARD, W0, e("026")]);
    // Added: one hand card goes to the sideline.
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([e("041")]);
    expect(a.sideline).toEqual([FILLER]);

    // Up to one: adding nothing means no discard.
    const none = build();
    pick(none.act, "a", []);
    pickAll(none.game, none.act);
    expect(none.game.pending).toBeNull();
    expect(none.a.hand).toEqual([FILLER]);
    expect(none.a.sideline).toEqual([]);
  });

  it("缘壹零式 (029): when sidelined, first mode looks at 7 for up to one 日轮刀 card", () => {
    const build = () => {
      const s = setup();
      const yoriichi = field(s.a, "front", e("029"));
      s.a.library = [W0, e("041"), GUARD, HOSHI, MISHA, FILLER, TANJIRO, e("042")];
      sidelineByEffect(s.game, ctx, s.a, yoriichi.uid, "b");
      refresh(s.act);
      return s;
    };
    const { game, a, act } = build();
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    expect(choice(game, "a").options).toEqual(["l:1"]); // the 8th card is not looked at
    pick(act, "a", ["l:1"]);
    expect(a.hand).toEqual([e("041")]);
    pickAll(game, act);
    expect(a.library).toEqual([e("042"), W0, GUARD, HOSHI, MISHA, FILLER, TANJIRO]);
    const none = build();
    pick(none.act, "a", ["m:0"]);
    pick(none.act, "a", []);
    pickAll(none.game, none.act);
    expect(none.a.hand).toEqual([]);
  });

  it("缘壹零式 (029): second mode adds up to one 日轮刀 card from the sideline", () => {
    const build = () => {
      const s = setup();
      const yoriichi = field(s.a, "front", e("029"));
      s.a.sideline.push(W0, e("041"), e("043"), GUARD);
      sidelineByEffect(s.game, ctx, s.a, yoriichi.uid, "b");
      refresh(s.act);
      pick(s.act, "a", ["m:1"]);
      return s;
    };
    const { game, a, act } = build();
    expect(choice(game, "a").options).toEqual(["s:1", "s:2"]);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", ["s:2"]);
    expect(a.hand).toEqual([e("043")]);
    expect(a.sideline).toEqual([W0, e("041"), GUARD, e("029")]);
    const none = build();
    pick(none.act, "a", []);
    expect(none.a.hand).toEqual([]);
  });

  it("甘露寺 蜜璃 (031): when sidelined, up to one of our characters gets BP+1000 this turn", () => {
    const build = () => {
      const s = setup();
      const mitsuri = field(s.a, "front", e("031"));
      const front = field(s.a, "front", W0);
      const back = field(s.a, "energy", GUARD);
      sidelineByEffect(s.game, ctx, s.a, mitsuri.uid, "b");
      refresh(s.act);
      return { ...s, front, back };
    };
    const { game, a, act, front, back } = build();
    expect(choice(game, "a").options).toEqual([front.uid, back.uid]);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [back.uid]);
    expect(bpOf(ctx, back)).toBe(4000);
    expect(bpOf(ctx, front)).toBe(2000);
    expect(a.sideline).toEqual([e("031")]);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, back)).toBe(3000);
    const none = build();
    pick(none.act, "a", []);
    expect(bpOf(ctx, none.front)).toBe(2000);
    expect(bpOf(ctx, none.back)).toBe(3000);
  });

  it("甘露寺 蜜璃 (032): on our turn, once per turn, gains 伤害② this turn when chosen by a 日轮刀 effect", () => {
    const s = setup();
    const mitsuri = field(s.a, "front", e("032"));
    expect(damageOf(ctx, mitsuri)).toBe(1);
    chosenByKatana(s, mitsuri);
    expect(damageOf(ctx, mitsuri)).toBe(2);
    s.act("a", { type: "end_turn" });
    expect(damageOf(ctx, mitsuri)).toBe(1);

    // On the opponent's turn it does not apply.
    const second = setup();
    const m2 = field(second.a, "front", e("032"));
    second.game.turnPlayerId = "b";
    chosenByKatana(second, m2);
    expect(damageOf(ctx, m2)).toBe(1);
  });
});
