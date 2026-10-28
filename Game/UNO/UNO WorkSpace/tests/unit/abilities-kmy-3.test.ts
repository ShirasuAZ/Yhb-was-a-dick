/**
 * KMY (鬼灭之刃) cards, batch 3 (UA05BT/KMY-1-066 .. 100 and EX05BT/KMY-1-017): one test per card, set up as its printed text describes and
 * checked against the text. Card text comes from `Cards/cards.json` (no card images exist on this machine).
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, damageOf, energyOf, hasKeyword, impactOf } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { KMY_3_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-kmy-3.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { choice, ctx, energy, field, FILLER, setup } from "./ability-harness.ts";

const k = (n: string): string => (n === "99" ? "UA05BT/KMY-1-99" : `UA05BT/KMY-1-${n}`);
type Act = (who: string, action: Parameters<ReturnType<typeof setup>["act"]>[1]) => void;
const pick = (act: Act, who: string, picks: string[]): void => act(who, { type: "choose", picks });
/** Lets the continuous abilities settle (the harness puts cards on the field directly): any action runs the engine's refresh. */
const refresh = (act: Act): void => act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "activate" } });

// Helper cards.
const MURATA = "UA05BT/KMY-1-016"; // yellow, cost 0, makes one yellow energy on the energy line
const TANJIRO = "UA05BT/KMY-1-005"; // 灶门 炭治郎: yellow, no ability
const INOSUKE = k("077"); // 嘴平 伊之助 (BP2500; its own ability only reacts to moving)
const ZENITSU = k("069"); // 我妻 善逸
const TENGEN = "UA05BT/KMY-1-018"; // 宇髓 天元: 柱, 撤步 only
const GYUTARO = "UA05BT/KMY-1-053"; // 妓夫太郎
const W0 = "UC01BT/ARK-1-009"; // yellow, BP2000
const MISHA = "UC01BT/ARK-1-001"; // BP1000
const GUARD = "UC01ST/ARK-1-103"; // BP3000
const HOSHI = "UC01BT/ARK-1-092"; // BP4000
const AMIYA = "UCEX01BT/ARK-2-047"; // purple, cost 0, makes one purple energy

describe("KMY batch 3: the table", () => {
  it("has every card automated and the names the filters rely on", () => {
    for (const number of Object.keys(KMY_3_ABILITIES)) expect(isAutomated(titleCard(number)), number).toBe(true);
    expect(Object.keys(KMY_3_ABILITIES)).toHaveLength(32);
    expect(titleCard(k("053")).name).toBe("妓夫太郎");
    expect(titleCard(k("069")).name).toBe("我妻 善逸");
    expect(titleCard(k("072")).name).toBe("灶门 炭治郎");
    expect(titleCard(k("077")).name).toBe("嘴平 伊之助");
    expect(titleCard(k("086")).name).toBe("宇髓 天元");
    expect(titleCard(k("083")).stats.affinities).toEqual(["天元的妻子"]);
    expect(titleCard(k("093")).stats.affinities).toEqual(["变装"]);
  });
});

describe("KMY batch 3: events", () => {
  it("飞血镰 (066): sidelines a front-line character with BP 3000 or less; with 〈妓夫太郎〉 on our field BP 5000 or less", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, AMIYA);
    const low = field(b, "front", W0);
    const mid = field(b, "front", GUARD);
    field(b, "front", HOSHI);
    a.hand.push(k("066"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([low.uid, mid.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [mid.uid]);
    expect(b.sideline).toEqual([GUARD]);
    expect(a.sideline).toEqual([k("066")]);

    const second = setup();
    energy(second.a, 4, AMIYA);
    field(second.a, "energy", GYUTARO);
    const small = field(second.b, "front", W0);
    const wall = field(second.b, "front", HOSHI);
    const huge = field(second.b, "front", GUARD);
    huge.bpMod = 2500; // 5500
    second.a.hand.push(k("066"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(choice(second.game, "a").options).toEqual([small.uid, wall.uid]);
    pick(second.act, "a", [wall.uid]);
    expect(second.b.sideline).toEqual([HOSHI]);
  });

  it("无惨的血 (067): makes up to two AP cards active", () => {
    const { game, a, act } = setup();
    energy(a, 3, AMIYA);
    a.ap.forEach((card) => { card.rested = true; });
    a.ap[2]!.rested = false;
    a.hand.push(k("067"));
    act("a", { type: "event", handIndex: 0 });
    expect(a.ap.every((card) => card.rested)).toBe(true); // 1 AP paid
    expect(choice(game, "a").max).toBe(2);
    pick(act, "a", ["ap:a:ap0", "ap:a:ap1"]);
    expect(a.ap.map((card) => card.rested)).toEqual([false, false, true]);
    expect(a.sideline).toEqual([k("067")]);

    const second = setup();
    energy(second.a, 3, AMIYA);
    second.a.hand.push(k("067"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", []);
    expect(second.a.ap.filter((card) => card.rested)).toHaveLength(1);
  });

  it("好吃！好吃！好吃！ (095): draws two cards, then puts one hand card into the sideline", () => {
    const { game, a, act } = setup();
    a.library = [W0, GUARD, HOSHI];
    a.hand.push(k("095"), MISHA);
    act("a", { type: "event", handIndex: 0 });
    expect(a.hand).toEqual([MISHA, W0, GUARD]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    pick(act, "a", ["h:1"]);
    expect(a.hand).toEqual([MISHA, GUARD]);
    expect(a.sideline).toEqual([W0, k("095")]);
    expect(a.library).toEqual([HOSHI]);
  });

  it("音之呼吸 伍之型 鸣弦奏奏 (096): BP limit is 1000 per 〈宇髓 天元〉 / 天元的妻子 / 变装 card on our field", () => {
    const { game, a, b, act } = setup();
    field(a, "front", k("086")); // 宇髓 天元
    field(a, "energy", k("083")); // 雏鹤 (天元的妻子)
    field(a, "energy", k("093")); // 善子 (变装)
    field(a, "energy", W0); // not counted
    const one = field(b, "front", MISHA); // 1000
    const two = field(b, "front", W0); // 2000
    const three = field(b, "front", GUARD); // 3000
    field(b, "front", HOSHI); // 4000
    a.hand.push(k("096"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([one.uid, two.uid, three.uid]);
    pick(act, "a", [three.uid]);
    expect(b.sideline).toEqual([GUARD]);

    // A card with two of the traits is one card; nobody there means nothing can be chosen.
    const second = setup();
    field(second.a, "energy", k("091")); // 猪子 (变装)
    const small = field(second.b, "front", MISHA);
    field(second.b, "front", W0);
    second.a.hand.push(k("096"));
    second.act("a", { type: "event", handIndex: 0 });
    // Only one card qualifies: it is chosen without a question.
    expect(second.game.pending).toBeNull();
    expect(second.b.sideline).toContain(MISHA); // (米莎's own 退场时 then draws and discards)
    expect(second.b.front.map((card) => card.uid)).not.toContain(small.uid);
    expect(second.b.front).toHaveLength(1);
    const third = setup();
    field(third.b, "front", MISHA);
    third.a.hand.push(k("096"));
    third.act("a", { type: "event", handIndex: 0 });
    expect(third.game.pending).toBeNull();
    expect(third.b.front).toHaveLength(1);
  });

  it("雷之呼吸 壹之型 霹雳一闪 (097): sidelines BP 3000 or less; with 〈我妻 善逸〉 (or 善子) on our field BP 5000 or less", () => {
    const { game, a, b, act } = setup();
    const low = field(b, "front", W0);
    const mid = field(b, "front", GUARD);
    field(b, "front", HOSHI);
    a.hand.push(k("097"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([low.uid, mid.uid]);
    pick(act, "a", [low.uid]);
    expect(b.sideline).toEqual([W0]);

    for (const helper of [ZENITSU, k("093")]) {
      const second = setup();
      field(second.a, "energy", helper);
      const small = field(second.b, "front", W0);
      const wall = field(second.b, "front", HOSHI);
      const huge = field(second.b, "front", GUARD);
      huge.bpMod = 2500; // 5500
      second.a.hand.push(k("097"));
      second.act("a", { type: "event", handIndex: 0 });
      expect(choice(second.game, "a").options).toEqual([small.uid, wall.uid]);
      pick(second.act, "a", [wall.uid]);
      expect(second.b.sideline).toEqual([HOSHI]);
    }
  });

  it("兽之呼吸 伍之牙 狂乱撕扯 (098): +2000 to a front-line character; a 〈嘴平 伊之助〉 also gets 冲击+1 (so does 猪子)", () => {
    const { game, a, act } = setup();
    const plain = field(a, "front", W0);
    const inosuke = field(a, "front", INOSUKE);
    field(a, "energy", MISHA); // not on the front line
    a.hand.push(k("098"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([plain.uid, inosuke.uid]);
    pick(act, "a", [plain.uid]);
    expect(bpOf(ctx, plain)).toBe(4000);
    expect(impactOf(ctx, plain)).toBe(0);

    const second = setup();
    const target = field(second.a, "front", INOSUKE);
    field(second.a, "front", W0);
    second.a.hand.push(k("098"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(4500);
    expect(impactOf(ctx, target)).toBe(1); // no Impact of its own: it gets Impact 1
    second.act("a", { type: "end_turn" });
    expect(bpOf(ctx, target)).toBe(2500);
    expect(impactOf(ctx, target)).toBe(0);

    // 猪子 counts as 〈嘴平 伊之助〉; a card that already has Impact 1 reaches 2.
    const third = setup();
    const boar = field(third.a, "front", k("091"));
    const impact = field(third.a, "front", k("078")); // 嘴平 伊之助 with 冲击①
    refresh(third.act);
    third.a.hand.push(k("098"), k("098"));
    third.act("a", { type: "event", handIndex: 0 });
    pick(third.act, "a", [boar.uid]);
    expect(impactOf(ctx, boar)).toBe(1);
    third.act("a", { type: "event", handIndex: 0 });
    pick(third.act, "a", [impact.uid]);
    expect(impactOf(ctx, impact)).toBe(2);
  });

  it("全集中呼吸 (99): makes up to two AP cards active", () => {
    const { game, a, act } = setup();
    a.ap.forEach((card) => { card.rested = true; });
    a.ap[1]!.rested = false;
    a.hand.push(k("99"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").max).toBe(2);
    pick(act, "a", ["ap:a:ap0", "ap:a:ap1"]);
    expect(a.ap.map((card) => card.rested)).toEqual([false, false, true]);
    expect(a.sideline).toEqual([k("99")]);

    const second = setup();
    second.a.hand.push(k("99"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", []);
    expect(second.a.ap.filter((card) => card.rested)).toHaveLength(1);
  });

  it("猪突猛进 (100): +3000 BP this turn to a front-line character", () => {
    const { game, a, act } = setup();
    const front = field(a, "front", W0);
    const second = field(a, "front", MISHA);
    field(a, "energy", MISHA); // not on the front line
    a.hand.push(k("100"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([front.uid, second.uid]);
    pick(act, "a", [front.uid]);
    expect(bpOf(ctx, front)).toBe(5000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, front)).toBe(2000);
  });
});

describe("KMY batch 3: yellow characters", () => {
  it("我妻 善逸 (069): looks at 7, reveals up to one card with 突进 to the hand, the rest to the bottom, then discards a card", () => {
    const { game, a, act } = setup();
    a.library = [GUARD, k("071"), W0, k("079"), FILLER, FILLER, FILLER, HOSHI];
    a.hand.push(k("069"), GUARD);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:1", "l:3"]); // only the Raid cards
    pick(act, "a", ["l:1"]);
    pick(act, "a", ["l:2", "l:0", "l:1", "l:3", "l:4", "l:5"]);
    expect(a.library).toEqual([HOSHI, k("079"), GUARD, W0, FILLER, FILLER, FILLER]);
    // The card was added: one hand card goes to the sideline.
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([k("071")]);
    expect(a.sideline).toEqual([GUARD]);

    // Up to one: revealing nothing means no discard.
    const second = setup();
    second.a.library = [k("071"), GUARD, W0];
    second.a.hand.push(k("069"), W0);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1", "l:2"]);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([W0]);
    expect(second.a.sideline).toEqual([]);
  });

  it("我妻 善逸 (070): returns up to one character other than 〈我妻 善逸〉 from the sideline; has 撤步", () => {
    const { game, a, act } = setup();
    energy(a, 0, MURATA);
    a.sideline.push(k("069"), k("095"), W0, k("094"), GUARD, k("093"));
    a.hand.push(k("070"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["s:2", "s:4"]); // not 善逸 (nor 善子, who is regarded as 善逸), not the event or the site
    pick(act, "a", ["s:4"]);
    expect(a.hand).toEqual([GUARD]);
    expect(a.sideline).toEqual([k("069"), k("095"), W0, k("094"), k("093")]);
    expect(hasKeyword(ctx, a.front[0]!, "撤步")).toBe(true);

    const second = setup();
    second.a.sideline.push(W0);
    second.a.hand.push(k("070"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.a.hand).toEqual([]);
    expect(second.a.sideline).toEqual([W0]);
  });

  it("我妻 善逸 (071): 伤害② while 〈灶门 炭治郎〉 is on our field; on entering with 〈嘴平 伊之助〉 draws 2 and discards 1", () => {
    const { a, act } = setup();
    const zenitsu = field(a, "front", k("071"));
    refresh(act);
    expect(damageOf(ctx, zenitsu)).toBe(1);
    field(a, "energy", TANJIRO);
    refresh(act);
    expect(damageOf(ctx, zenitsu)).toBe(2);

    // 炭子 is regarded as 〈灶门 炭治郎〉.
    const second = setup();
    const other = field(second.a, "front", k("071"));
    field(second.a, "energy", k("092"));
    refresh(second.act);
    expect(damageOf(ctx, other)).toBe(2);

    // The 【登场时】 (entered by Raid onto 〈我妻 善逸〉).
    const third = setup();
    const base = field(third.a, "energy", ZENITSU, true);
    field(third.a, "energy", INOSUKE);
    third.a.library = [W0, GUARD, HOSHI];
    third.a.hand.push(k("071"));
    third.act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(third.a.hand).toEqual([W0, GUARD]);
    expect(choice(third.game, "a").options).toEqual(["h:0", "h:1"]);
    pick(third.act, "a", ["h:0"]);
    expect(third.a.hand).toEqual([GUARD]);
    expect(third.a.sideline).toEqual([W0]);

    // Without 〈嘴平 伊之助〉: nothing is drawn.
    const fourth = setup();
    const plain = field(fourth.a, "energy", ZENITSU, true);
    fourth.a.library = [W0, GUARD];
    fourth.a.hand.push(k("071"));
    fourth.act("a", { type: "raid", handIndex: 0, targetUid: plain.uid, toFront: true });
    expect(fourth.game.pending).toBeNull();
    expect(fourth.a.hand).toEqual([]);
    // 猪子 counts as 〈嘴平 伊之助〉.
    const fifth = setup();
    const base5 = field(fifth.a, "energy", ZENITSU, true);
    field(fifth.a, "energy", k("091"));
    fifth.a.library = [W0, GUARD];
    fifth.a.hand.push(k("071"));
    fifth.act("a", { type: "raid", handIndex: 0, targetUid: base5.uid, toFront: true });
    expect(fifth.a.hand).toEqual([W0, GUARD]);
  });

  it("灶门 炭治郎 (072): rests to give another character BP+1000 this turn", () => {
    const { game, a, act } = setup();
    const tanjiro = field(a, "front", k("072"));
    const one = field(a, "front", W0);
    const two = field(a, "energy", MISHA);
    act("a", { type: "activate", uid: tanjiro.uid, ability: 0 });
    expect(tanjiro.rested).toBe(true);
    expect(choice(game, "a").options).toEqual([one.uid, two.uid]); // not itself
    pick(act, "a", [two.uid]);
    expect(bpOf(ctx, two)).toBe(2000);
    expect(bpOf(ctx, tanjiro)).toBe(2500);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, two)).toBe(1000);
    // Resting is a cost.
    const second = setup();
    const used = field(second.a, "front", k("072"), true);
    expect(() => second.act("a", { type: "activate", uid: used.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("灶门 炭治郎 (073): +1000 on our turn with 〈嘴平 伊之助〉 on our field, +1000 on the opponent's turn with 〈我妻 善逸〉", () => {
    const { a, act } = setup();
    const tanjiro = field(a, "front", k("073"));
    refresh(act);
    expect(bpOf(ctx, tanjiro)).toBe(2500);
    field(a, "energy", ZENITSU);
    refresh(act);
    expect(bpOf(ctx, tanjiro)).toBe(2500); // 善逸 only helps on the opponent's turn
    const inosuke = field(a, "energy", INOSUKE);
    refresh(act);
    expect(bpOf(ctx, tanjiro)).toBe(3500);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, tanjiro)).toBe(3500); // opponent's turn: 善逸 is on the field

    const second = setup();
    const lone = field(second.a, "front", k("073"));
    field(second.a, "energy", INOSUKE);
    refresh(second.act);
    expect(bpOf(ctx, lone)).toBe(3500);
    second.act("a", { type: "end_turn" });
    expect(bpOf(ctx, lone)).toBe(2500); // opponent's turn: 伊之助 does not count
    expect(inosuke.uid).toBeTruthy();

    // 猪子 counts as 〈嘴平 伊之助〉, 善子 as 〈我妻 善逸〉.
    const third = setup();
    const t3 = field(third.a, "front", k("073"));
    field(third.a, "energy", k("091"));
    refresh(third.act);
    expect(bpOf(ctx, t3)).toBe(3500);
    const fourth = setup();
    const t4 = field(fourth.a, "front", k("073"));
    field(fourth.a, "energy", k("093"));
    refresh(fourth.act);
    expect(bpOf(ctx, t4)).toBe(2500);
    fourth.act("a", { type: "end_turn" });
    expect(bpOf(ctx, t4)).toBe(3500);
  });

  it("灶门 祢豆子 (074): one more red energy while active", () => {
    const { a, act } = setup();
    const nezuko = field(a, "energy", k("074"));
    refresh(act);
    expect(energyOf(ctx, a, "red")).toBe(2);
    nezuko.rested = true;
    refresh(act);
    expect(energyOf(ctx, a, "red")).toBe(1);
  });

  it("啾太郎 (075): once per turn rests for +1 red energy this turn and leaves when the main phase ends", () => {
    const { a, act } = setup();
    const chutaro = field(a, "energy", k("075"));
    expect(energyOf(ctx, a, "red")).toBe(1);
    act("a", { type: "activate", uid: chutaro.uid, ability: 0 });
    expect(chutaro.rested).toBe(true);
    expect(energyOf(ctx, a, "red")).toBe(2);
    expect(() => act("a", { type: "activate", uid: chutaro.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([k("075")]);
  });

  it("嘴平 伊之助 (077): BP+500 for the rest of the turn once it has moved", () => {
    const { a, act } = setup("movement");
    const inosuke = field(a, "energy", INOSUKE);
    const still = field(a, "energy", INOSUKE);
    refresh(act);
    expect(bpOf(ctx, inosuke)).toBe(2500);
    act("a", { type: "move", toFront: [inosuke.uid], toEnergy: [], remove: [] });
    expect(a.front).toEqual([inosuke]);
    expect(bpOf(ctx, inosuke)).toBe(3000);
    expect(bpOf(ctx, still)).toBe(2500); // only the card that moved
    act("a", { type: "next_phase" });
    expect(bpOf(ctx, inosuke)).toBe(3000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, inosuke)).toBe(2500);
  });

  it("嘴平 伊之助 (078): enters active with 冲击① and 伤害②, and leaves when our attack phase ends", () => {
    const { a, act } = setup();
    a.hand.push(k("078"), W0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    const inosuke = a.front[0]!;
    expect(inosuke.rested).toBe(false);
    expect(a.ap.filter((card) => card.rested)).toHaveLength(2); // costs 2 AP
    expect(impactOf(ctx, inosuke)).toBe(1);
    expect(damageOf(ctx, inosuke)).toBe(2);
    act("a", { type: "play", handIndex: 0, line: "front" });
    const ordinary = a.front[1]!;
    expect(ordinary.rested).toBe(true); // other cards still enter resting
    act("a", { type: "next_phase" }); // attack phase
    expect(a.front).toContain(inosuke);
    act("a", { type: "next_phase" }); // attack phase ends
    expect(a.front).toEqual([ordinary]);
    expect(a.sideline).toEqual([k("078")]);
  });

  it("嘴平 伊之助 (079): 冲击① with 〈灶门 炭治郎〉; on entering with 〈我妻 善逸〉 up to one other character becomes active", () => {
    const { game, a, act } = setup();
    const inosuke = field(a, "front", k("079"));
    refresh(act);
    expect(impactOf(ctx, inosuke)).toBe(0);
    field(a, "energy", k("092")); // 炭子 is regarded as 灶门 炭治郎
    refresh(act);
    expect(impactOf(ctx, inosuke)).toBe(1);

    const second = setup();
    const base = field(second.a, "energy", INOSUKE, true);
    const tired = field(second.a, "front", W0, true);
    const tired2 = field(second.a, "energy", MISHA, true);
    field(second.a, "energy", ZENITSU);
    second.a.hand.push(k("079"));
    second.act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(base.cardId).toBe(k("079"));
    expect(choice(second.game, "a").options).not.toContain(base.uid); // other characters only
    expect(choice(second.game, "a").options).toContain(tired.uid);
    pick(second.act, "a", [tired2.uid]);
    expect(tired2.rested).toBe(false);
    expect(tired.rested).toBe(true);

    // Up to one: none; and with no 〈我妻 善逸〉 there is no question.
    const third = setup();
    const base3 = field(third.a, "energy", INOSUKE, true);
    const sleeper = field(third.a, "front", W0, true);
    field(third.a, "energy", k("093")); // 善子 counts as 善逸
    third.a.hand.push(k("079"));
    third.act("a", { type: "raid", handIndex: 0, targetUid: base3.uid, toFront: true });
    pick(third.act, "a", []);
    expect(sleeper.rested).toBe(true);
    const fourth = setup();
    const base4 = field(fourth.a, "energy", INOSUKE, true);
    field(fourth.a, "front", W0, true);
    fourth.a.hand.push(k("079"));
    fourth.act("a", { type: "raid", handIndex: 0, targetUid: base4.uid, toFront: true });
    expect(fourth.game.pending).toBeNull();
    expect(game.pending).toBeNull();
  });

  it("肌肉鼠 (080): its required energy is reduced by 1 (never below 0) while the opponent has a yellow or purple card", () => {
    const abilities = KMY_3_ABILITIES[k("080")]!;
    expect(abilities).toHaveLength(1);
    const cost = abilities[0]!;
    expect(cost.kind).toBe("cost");
    const { game, players, a, b } = setup();
    const env = { game, players, ctx, owner: a, opponent: b, self: null, selfCardId: k("080"), vars: {}, cause: null };
    const condition = (cost as { condition?: (e: typeof env) => boolean }).condition!;
    expect(condition(env)).toBe(false);
    field(b, "energy", HOSHI); // red
    expect(condition(env)).toBe(false);
    field(b, "front", GUARD); // blue
    expect(condition(env)).toBe(false);
    const purple = field(b, "front", AMIYA);
    expect(condition(env)).toBe(true);
    b.front = b.front.filter((card) => card !== purple);
    field(b, "front", W0); // yellow
    expect(condition(env)).toBe(true);
    expect((cost as { energy?: number }).energy).toBe(1);
    // The printed cost is 0, so it stays 0.
    expect(costOf(game, players, ctx, "a", k("080")).energy).toBe(0);
  });

  it("炼狱 千寿郎 (081): up to one other character gets BP+1000 this turn", () => {
    const { game, a, act } = setup();
    const other = field(a, "front", W0);
    const far = field(a, "energy", MISHA);
    a.hand.push(k("081"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([other.uid, far.uid]); // not itself
    pick(act, "a", [far.uid]);
    expect(bpOf(ctx, far)).toBe(2000);
    expect(bpOf(ctx, other)).toBe(2000);
    expect(bpOf(ctx, a.front[1]!)).toBe(2000);

    const second = setup();
    const w = field(second.a, "front", W0);
    second.a.hand.push(k("081"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(bpOf(ctx, w)).toBe(2000);
  });

  it("雏鹤 (083): when sidelined, returns up to one 〈宇髓 天元〉 from the sideline to the hand", () => {
    const sideline = (first: string[]) => {
      const t = setup("attack", "b");
      t.a.sideline.push(...first);
      const blocker = field(t.a, "front", k("083")); // BP3000
      const attacker = field(t.b, "front", HOSHI); // BP4000: the blocker loses
      t.act("b", { type: "attack", attackerUid: attacker.uid });
      t.act("a", { type: "block", blockerUid: blocker.uid });
      return t;
    };
    const { game, a, act } = sideline([k("086"), W0, k("087")]);
    expect(a.sideline).toContain(k("083"));
    expect(choice(game, "a").options).toEqual(["s:0", "s:2"]);
    pick(act, "a", ["s:2"]);
    expect(a.hand).toEqual([k("087")]);

    // Up to one.
    const second = sideline([k("086")]);
    pick(second.act, "a", []);
    expect(second.a.hand).toEqual([]);

    // Nothing to return: no question.
    const third = sideline([W0]);
    expect(third.game.pending).toBeNull();
    expect(third.a.sideline).toContain(k("083"));
  });

  it("槙於 (084): BP+500 on our turn while 〈宇髓 天元〉 is on our field", () => {
    const { a, act } = setup();
    const makio = field(a, "front", k("084"));
    refresh(act);
    expect(bpOf(ctx, makio)).toBe(2500);
    field(a, "energy", TENGEN);
    refresh(act);
    expect(bpOf(ctx, makio)).toBe(3000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, makio)).toBe(2500);
  });

  it("宇髓 天元 (086): looks at 4, reveals up to one 天元的妻子 / 变装 card to the hand, the rest to the bottom", () => {
    const { game, a, act } = setup();
    a.library = [GUARD, k("083"), k("091"), W0, HOSHI];
    a.hand.push(k("086"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:1", "l:2"]);
    pick(act, "a", ["l:2"]);
    pick(act, "a", ["l:2", "l:0", "l:1"]);
    expect(a.hand).toEqual([k("091")]);
    expect(a.library).toEqual([HOSHI, W0, GUARD, k("083")]);
    expect(game.pending).toBeNull();

    const second = setup();
    second.a.library = [k("083"), GUARD];
    second.a.hand.push(k("086"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1"]);
    expect(second.a.hand).toEqual([]);
    expect(second.a.library).toEqual([k("083"), GUARD]);
  });

  it("宇髓 天元 (087): enters with 2次攻击 this turn; once per turn the 天元的妻子 and 变装 characters get BP+500", () => {
    const { a, act } = setup();
    const base = field(a, "energy", k("086"), true);
    const wife = field(a, "front", k("083"));
    const disguise = field(a, "energy", k("091"));
    const plain = field(a, "energy", W0);
    a.hand.push(k("087"));
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(base.cardId).toBe(k("087"));
    expect(hasKeyword(ctx, base, "2次攻击")).toBe(true);
    act("a", { type: "activate", uid: base.uid, ability: 0 });
    expect(bpOf(ctx, wife)).toBe(3500);
    expect(bpOf(ctx, disguise)).toBe(3500);
    expect(bpOf(ctx, plain)).toBe(2000);
    expect(bpOf(ctx, base)).toBe(4000); // 宇髓 天元 himself is neither
    expect(() => act("a", { type: "activate", uid: base.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, wife)).toBe(3000);
    expect(hasKeyword(ctx, base, "2次攻击")).toBe(false);
  });

  it("炼狱 杏寿郎 (088): returns another character of cost 1 or less to the hand, or else himself", () => {
    const { game, a, act } = setup();
    const keep = field(a, "front", FILLER);
    const back = field(a, "front", W0);
    field(a, "energy", k("089")); // cost 0 as well
    a.hand.push(k("088"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toContain(keep.uid);
    expect(choice(game, "a").options).not.toContain(a.front[2]!.uid); // not himself
    pick(act, "a", [back.uid]);
    expect(a.hand).toEqual([W0]);
    expect(a.front.map((card) => card.cardId)).toEqual([FILLER, k("088")]);

    // Only an expensive other character: he returns himself.
    const second = setup();
    field(second.a, "front", GUARD); // cost 3
    second.a.hand.push(k("088"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([k("088")]);
    expect(second.a.front.map((card) => card.cardId)).toEqual([GUARD]);
  });

  it("炼狱 杏寿郎 (089): from the front line, discards a card to give all our characters BP+500, once per turn", () => {
    const { game, a, b, act } = setup();
    const kyojuro = field(a, "front", k("089"));
    const other = field(a, "energy", W0);
    const enemy = field(b, "front", W0);
    a.hand.push(GUARD, MISHA);
    act("a", { type: "activate", uid: kyojuro.uid, ability: 0 });
    // The discard is chosen first.
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.sideline).toEqual([GUARD]);
    expect(bpOf(ctx, kyojuro)).toBe(4000);
    expect(bpOf(ctx, other)).toBe(2500);
    expect(bpOf(ctx, enemy)).toBe(2000);
    expect(kyojuro.rested).toBe(false); // resting is not a cost
    expect(() => act("a", { type: "activate", uid: kyojuro.uid, ability: 0 })).toThrow("ONCE_PER_TURN");

    // Not on the front line: cannot be used. Without a hand card: cannot pay.
    const second = setup();
    const back = field(second.a, "energy", k("089"));
    second.a.hand.push(GUARD);
    expect(() => second.act("a", { type: "activate", uid: back.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    const third = setup();
    const front = field(third.a, "front", k("089"));
    expect(() => third.act("a", { type: "activate", uid: front.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("炼狱 杏寿郎 (090): enters active; may discard a card to sideline an enemy with BP 3000 or less; gets 冲击① this turn", () => {
    const { game, a, b, act } = setup();
    const low = field(b, "front", GUARD);
    field(b, "front", HOSHI);
    a.hand.push(k("090"), MISHA, W0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    const kyojuro = a.front[0]!;
    expect(kyojuro.rested).toBe(false);
    expect(impactOf(ctx, kyojuro)).toBe(0); // the keyword is granted when the 【登场时】 resolves
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(choice(game, "a").options).toEqual([low.uid]);
    pick(act, "a", [low.uid]);
    expect(b.sideline).toEqual([GUARD]);
    expect(a.sideline).toEqual([MISHA]);
    expect(impactOf(ctx, kyojuro)).toBe(1);
    act("a", { type: "end_turn" });
    expect(impactOf(ctx, kyojuro)).toBe(0);
  });

  it("炼狱 杏寿郎 (090): answering no keeps the hand and the enemy, but 冲击① is still gained; an empty hand asks nothing", () => {
    const { game, a, b, act } = setup();
    const enemy = field(b, "front", GUARD);
    a.hand.push(k("090"), MISHA);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["no"]);
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([MISHA]);
    expect(b.front).toEqual([enemy]);
    expect(impactOf(ctx, a.front[0]!)).toBe(1);

    const second = setup();
    const target = field(second.b, "front", GUARD);
    second.a.hand.push(k("090"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(second.b.front).toEqual([target]);
    expect(impactOf(ctx, second.a.front[0]!)).toBe(1);

    // Up to one: the discard is paid, nothing is chosen.
    const third = setup();
    const kept = field(third.b, "front", GUARD);
    third.a.hand.push(k("090"), MISHA, W0);
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", ["yes"]);
    pick(third.act, "a", ["h:0"]);
    pick(third.act, "a", []);
    expect(third.a.sideline).toEqual([MISHA]);
    expect(third.b.front).toEqual([kept]);
  });

  it("猪子 (091): regarded as 〈嘴平 伊之助〉 (a Raid onto it by 伊之助 works), and has 撤步", () => {
    const { a, act } = setup();
    const boar = field(a, "front", k("091"));
    const tanjiro = field(a, "front", k("073"));
    refresh(act);
    expect(hasKeyword(ctx, boar, "撤步")).toBe(true);
    expect(bpOf(ctx, tanjiro)).toBe(3500); // 灶门 炭治郎 (073) counts it as 嘴平 伊之助
    a.energy.push(boar);
    a.front = a.front.filter((card) => card !== boar);
    a.hand.push(k("079"));
    act("a", { type: "raid", handIndex: 0, targetUid: boar.uid, toFront: true });
    expect(boar.cardId).toBe(k("079"));
  });

  it("炭子 (092): regarded as 〈灶门 炭治郎〉, and has 冲击无效", () => {
    const { a, act } = setup();
    const sumiko = field(a, "front", k("092"));
    const inosuke = field(a, "front", k("079"));
    refresh(act);
    expect(hasKeyword(ctx, sumiko, "冲击无效")).toBe(true);
    expect(impactOf(ctx, inosuke)).toBe(1); // 嘴平 伊之助 (079) has 冲击① with 灶门 炭治郎
    // A Raid onto 灶门 炭治郎 works with it.
    a.energy.push(sumiko);
    a.front = a.front.filter((card) => card !== sumiko);
    energy(a, 2, TENGEN);
    a.hand.push(k("008"));
    a.sideline.push(k("009"));
    act("a", { type: "raid", handIndex: 0, targetUid: sumiko.uid, toFront: true });
    expect(sumiko.cardId).toBe(k("008"));
  });

  it("善子 (093): regarded as 〈我妻 善逸〉; looks at the top card and puts it back on top or on the bottom", () => {
    const { game, a, act } = setup();
    a.library = [GUARD, W0, HOSHI];
    a.hand.push(k("093"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    expect(a.library).toEqual([GUARD, W0, HOSHI]);
    expect(game.looking?.cards ?? []).toEqual([]);

    const second = setup();
    second.a.library = [GUARD, W0, HOSHI];
    second.a.hand.push(k("093"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["m:1"]);
    expect(second.a.library).toEqual([W0, HOSHI, GUARD]);
    expect(second.game.pending).toBeNull();

    // As 〈我妻 善逸〉 it satisfies 〈我妻 善逸〉 conditions (灶门 炭治郎 073, on the opponent's turn).
    const third = setup();
    const tanjiro = field(third.a, "front", k("073"));
    field(third.a, "energy", k("093"));
    refresh(third.act);
    expect(bpOf(ctx, tanjiro)).toBe(2500);
    third.act("a", { type: "end_turn" });
    expect(bpOf(ctx, tanjiro)).toBe(3500);
  });

  it("伊黑 小芭内 (EX05BT/KMY-1-017): draws a card, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 2, MURATA);
    a.library = [W0, GUARD];
    a.hand.push("EX05BT/KMY-1-017", GUARD);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([W0]);
    expect(a.sideline).toEqual([GUARD]);
    expect(a.library).toEqual([GUARD]);
  });
});

describe("KMY batch 3: site", () => {
  it("便当 (094): enters active; rests to give a character BP+1000 this turn", () => {
    const { game, a, act } = setup();
    a.hand.push(k("094"));
    act("a", { type: "play", handIndex: 0, line: "energy" });
    const bento = a.energy[0]!;
    expect(bento.rested).toBe(false);
    const target = field(a, "front", W0);
    const far = field(a, "energy", MISHA);
    act("a", { type: "activate", uid: bento.uid, ability: 0 });
    expect(bento.rested).toBe(true);
    expect(choice(game, "a").options).toEqual([target.uid, far.uid]); // characters only
    pick(act, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(3000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, target)).toBe(2000);
    // Resting is a cost: once rested it cannot be used again this turn.
    const second = setup();
    const tired = field(second.a, "energy", k("094"), true);
    expect(() => second.act("a", { type: "activate", uid: tired.uid, ability: 0 })).toThrow("ABILITY_COST");
  });
});
