/**
 * KMY (鬼灭之刃) cards, batch 6 (EX05BT/KMY-3-067 .. 073, UA05ST/KMY-1-xxx and UA01NC/KMY-2-xxx): one test per card, set up as its printed text
 * describes and checked against the text. Card text comes from `Cards/cards.json` (no card images exist on this machine).
 */
import { describe, expect, it } from "vitest";
import { bpOf, energyOf, flagsOf, hasKeyword, impactOf } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { KMY_6_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-kmy-6.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { choice, ctx, energy, field, FILLER, setup } from "./ability-harness.ts";

const e = (n: string): string => `EX05BT/KMY-3-${n}`;
const s = (n: string): string => `UA05ST/KMY-1-${n}`;
const c = (n: string): string => `UA01NC/KMY-2-${n}`;
const bt = (n: string): string => `UA05BT/KMY-1-${n}`;
type Act = (who: string, action: Parameters<ReturnType<typeof setup>["act"]>[1]) => void;
const pick = (act: Act, who: string, picks: string[]): void => act(who, { type: "choose", picks });
const sidelineManually = (act: Act, who: string, owner: "you" | "opponent", uid: string): void => act(who, { type: "manual", manual: { op: "field", owner, uid, act: "sideline" } });
/** Lets the continuous abilities settle (the harness puts cards on the field directly): any action runs the engine's refresh. */
const refresh = (act: Act): void => act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "activate" } });

// Helper cards.
const MURATA = bt("016"); // 村田: yellow, cost 0, makes one yellow energy, 撤步
const TANJIRO = bt("005"); // 灶门 炭治郎: yellow, cost 0, BP1500, no ability
const NEZUKO = bt("009"); // 灶门 祢豆子: yellow, cost 0, BP1500, no ability
const OYAKATA = bt("002"); // 产屋敷 耀哉
const OBANAI = bt("017"); // 伊黑 小芭内: 柱, cost 2, AP 1, 登场时 draws 1 and discards 1
const MITSURI = bt("019"); // 甘露寺 蜜璃: 柱, cost 1
const TENGEN = bt("086"); // 宇髓 天元: 柱, yellow, cost 0, BP2000, no 登场时 that matters here
const HINATSURU = bt("083"); // 雏鹤: 天元的妻子, BP3000
const MAKIO = bt("084"); // 槙於: 天元的妻子
const BOAR = bt("091"); // 猪子: regarded as 〈嘴平 伊之助〉, 变装
const SUMIKO = bt("092"); // 炭子: regarded as 〈灶门 炭治郎〉, 变装
const ZENKO = bt("093"); // 善子: regarded as 〈我妻 善逸〉, 变装
const W0 = "UC01BT/ARK-1-009"; // W: yellow, cost 0, BP2000
const MISHA = "UC01BT/ARK-1-001"; // BP1000
const GUARD = "UC01ST/ARK-1-103"; // BP3000, cost 3
const HOSHI = "UC01BT/ARK-1-092"; // BP4000, cost 4
const PILLARS = [bt("017"), bt("018"), bt("019"), bt("021"), bt("024"), bt("025"), bt("026"), bt("027")]; // 柱

const BATCH = [
  e("067"), e("068"), e("069"), e("070"), e("071"), e("072"), e("073"),
  s("001"), s("003"), s("004"), s("014"), s("015"), s("033"), s("102"), s("103"), s("104"), s("105"), s("107"), s("108"), s("109"),
  c("001"), c("002"), c("004"), c("005"), c("006"), c("007"), c("008"), c("009"), c("010"), c("011")
];

describe("KMY batch 6: the table", () => {
  it("has every card of the batch automated (102 is a keyword line only) and the names the filters rely on", () => {
    expect(BATCH).toHaveLength(30);
    for (const number of BATCH) expect(isAutomated(titleCard(number)), number).toBe(true);
    for (const number of Object.keys(KMY_6_ABILITIES)) expect(BATCH, number).toContain(number);
    expect(Object.keys(KMY_6_ABILITIES)).toHaveLength(29);
    expect(KMY_6_ABILITIES[s("102")]).toBeUndefined();
    expect(titleCard(e("072")).name).toBe("炼狱 杏寿郎");
    expect(titleCard(c("011")).name).toBe("炼狱 杏寿郎");
    expect(titleCard(c("010")).name).toBe("宇髓 天元");
    expect(titleCard(c("009")).name).toBe("悲鸣屿 行冥");
    expect(titleCard(e("068")).stats.affinities).toEqual(["天元的妻子"]);
    expect(titleCard(bt("002")).name).toBe("产屋敷 耀哉");
    expect(titleCard(MITSURI).stats.affinities).toEqual(["柱"]);
  });
});

describe("KMY batch 6: EX05BT 炼狱 family", () => {
  it("炼狱 瑠火 (067): draws when put into the sideline from the hand by an event card", () => {
    const { game, a, act } = setup();
    a.library = [W0, GUARD, HOSHI];
    a.hand.push(e("073"), e("067"));
    act("a", { type: "event", handIndex: 0 });
    // 炎之呼吸 draws W0, then asks which card to put into the sideline.
    expect(a.hand).toEqual([e("067"), W0]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.sideline).toContain(e("067"));
    expect(a.hand).toEqual([W0, GUARD]); // 瑠火's own draw
    expect(a.library).toEqual([HOSHI]);
  });

  it("炼狱 瑠火 (067): draws when put into the sideline from the hand by a 〈炼狱 杏寿郎〉 effect; not by other cards", () => {
    const { game, a, act } = setup();
    a.library = [W0, GUARD, HOSHI];
    a.hand.push(e("070"), e("067"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([e("067"), W0]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([W0, GUARD]);
    expect(a.library).toEqual([HOSHI]);

    // 伊黑 小芭内 makes the same draw-and-discard, but is not 〈炼狱 杏寿郎〉 or an event card.
    const second = setup();
    energy(second.a, 2, MURATA);
    second.a.library = [W0, GUARD, HOSHI];
    second.a.hand.push(OBANAI, e("067"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([e("067"), W0]);
    pick(second.act, "a", ["h:0"]);
    expect(second.a.sideline).toEqual([e("067")]);
    expect(second.a.hand).toEqual([W0]);
    expect(second.a.library).toEqual([GUARD, HOSHI]);
    expect(second.game.pending).toBeNull();
  });

  it("炼狱 瑠火 (067): does not draw when discarded as a cost, or when sidelined from the field, or when another card was the one discarded", () => {
    // 炼狱 杏寿郎 (071) pays [将1张手牌置于场外]: a cost is not an effect.
    const { a, act } = setup();
    const kyojuro = field(a, "front", e("071"));
    a.hand.push(e("067"));
    act("a", { type: "activate", uid: kyojuro.uid, ability: 0 });
    expect(a.sideline).toEqual([e("067")]);
    expect(a.hand).toEqual([]);
    expect(a.library).toHaveLength(30);

    // Sidelined from the field.
    const second = setup();
    const rukia = field(second.a, "front", e("067"));
    sidelineManually(second.act, "a", "you", rukia.uid);
    expect(second.a.sideline).toEqual([e("067")]);
    expect(second.a.hand).toEqual([]);

    // The event discards a different card; 瑠火 stays in the hand.
    const third = setup();
    third.a.library = [W0, GUARD, HOSHI];
    third.a.hand.push(e("073"), e("067"));
    third.act("a", { type: "event", handIndex: 0 });
    pick(third.act, "a", ["h:1"]); // W0
    expect(third.a.hand).toEqual([e("067")]);
    expect(third.a.sideline).toContain(W0);
    expect(third.a.library).toEqual([GUARD, HOSHI]);
  });

  it("炼狱 瑠火 (067): each copy discarded by the same effect draws once", () => {
    const { game, a, b, act } = setup();
    const target = field(b, "front", W0);
    a.library = [W0, GUARD, HOSHI];
    a.hand.push(e("072"), e("067"), e("067"), MISHA);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    pick(act, "a", ["h:0", "h:1"]); // both 瑠火
    expect(a.sideline).toEqual([e("067"), e("067")]);
    expect(choice(game, "a").options).toEqual([target.uid]);
    pick(act, "a", []);
    // Once 杏寿郎's ability has resolved, each 瑠火 draws a card (two abilities at once: we choose the order).
    expect(choice(game, "a").purpose).toBe("order");
    pick(act, "a", [choice(game, "a").options[0]!]);
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([MISHA, W0, GUARD]);
    expect(a.library).toEqual([HOSHI]);
  });

  it("须磨&槙於&雏鹤 (068): BP+500 in our turn while 〈宇髓 天元〉 is on our field", () => {
    const { a, act } = setup();
    const suma = field(a, "front", e("068"));
    refresh(act);
    expect(bpOf(ctx, suma)).toBe(3500);
    field(a, "energy", TENGEN);
    refresh(act);
    expect(bpOf(ctx, suma)).toBe(4000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, suma)).toBe(3500); // opponent's turn
  });

  it("须磨&槙於&雏鹤 (068): moving in our attack phase gives BP+1000 to a 〈宇髓 天元〉 or 变装 character", () => {
    // 祢豆子 (UA01NC 002) swaps with 须磨 when the attack phase starts, which is a move of 须磨.
    const { game, a, act } = setup();
    const suma = field(a, "front", e("068"));
    const nezuko = field(a, "energy", c("002"));
    const tengen = field(a, "energy", TENGEN);
    const disguise = field(a, "energy", ZENKO);
    field(a, "energy", MAKIO); // 天元的妻子 but not 变装 or 天元: not offered
    act("a", { type: "next_phase" });
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.front).toEqual([nezuko]);
    expect(a.energy.slice(0, 2)).toEqual([suma, tengen]);
    expect(choice(game, "a").options).toEqual([tengen.uid, disguise.uid]);
    pick(act, "a", [disguise.uid]);
    expect(bpOf(ctx, disguise)).toBe(3500);
    expect(bpOf(ctx, tengen)).toBe(2000);
    expect(game.pending).toBeNull();

    // Up to one: choosing nobody is fine.
    const second = setup();
    field(second.a, "front", e("068"));
    field(second.a, "energy", c("002"));
    const t2 = field(second.a, "energy", TENGEN);
    second.act("a", { type: "next_phase" });
    pick(second.act, "a", ["yes"]);
    pick(second.act, "a", []);
    expect(bpOf(ctx, t2)).toBe(2000); // nobody was chosen: unchanged
  });

  it("须磨&槙於&雏鹤 (068): a move outside the attack phase does nothing", () => {
    const { game, a, act } = setup("movement");
    const suma = field(a, "energy", e("068"));
    const tengen = field(a, "front", TENGEN);
    act("a", { type: "move", toFront: [suma.uid], toEnergy: [], remove: [] });
    expect(a.front).toContain(suma);
    expect(game.pending).toBeNull();
    expect(bpOf(ctx, tengen)).toBe(2000);
  });

  it("宇髓 天元 (069): 撤步; BP+1000 in our turn with 3 or more 天元的妻子 / 变装 characters on our field", () => {
    const { a, act } = setup();
    const tengen = field(a, "front", e("069"));
    expect(hasKeyword(ctx, tengen, "撤步")).toBe(true);
    field(a, "energy", HINATSURU);
    field(a, "energy", MAKIO);
    refresh(act);
    expect(bpOf(ctx, tengen)).toBe(3000);
    field(a, "energy", ZENKO); // 变装
    refresh(act);
    expect(bpOf(ctx, tengen)).toBe(4000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, tengen)).toBe(3000);

    // Other characters, 〈宇髓 天元〉 himself and pillars are not counted.
    const second = setup();
    const lone = field(second.a, "front", e("069"));
    field(second.a, "energy", HINATSURU);
    field(second.a, "energy", TENGEN);
    field(second.a, "energy", bt("018"));
    field(second.a, "energy", W0);
    refresh(second.act);
    expect(bpOf(ctx, lone)).toBe(3000);
  });

  it("炼狱 杏寿郎 (070): draws a card, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    a.library = [W0, GUARD];
    a.hand.push(e("070"), MISHA);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([MISHA, W0]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([W0]);
    expect(a.sideline).toEqual([MISHA]);
    expect(a.library).toEqual([GUARD]);
  });

  it("炼狱 杏寿郎 (071): [discard 1][once per turn] the next BP-range choice this turn is raised by 1000", () => {
    const { game, a, b, act } = setup();
    const kyojuro = field(a, "front", e("071"));
    const mid = field(b, "front", GUARD); // 3000
    const midPlus = field(b, "front", GUARD);
    midPlus.bpMod = 2500; // 5500
    const wall = field(b, "front", HOSHI); // 4000
    const huge = field(b, "front", HOSHI);
    huge.bpMod = 3500; // 7500
    a.hand.push(e("073"), e("073"), W0);
    // The cost is a hand card.
    act("a", { type: "activate", uid: kyojuro.uid, ability: 0 });
    expect(choice(game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    pick(act, "a", ["h:2"]);
    expect(a.sideline).toEqual([W0]);
    expect(() => act("a", { type: "activate", uid: kyojuro.uid, ability: 0 })).toThrow();
    // 不知火 with 〈炼狱 杏寿郎〉 on our field: 5000 + 1000.
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([mid.uid, midPlus.uid, wall.uid]);
    pick(act, "a", [midPlus.uid]);
    expect(b.sideline).toEqual([GUARD]);
    // It was used up by that choice: the second event has the plain range of 5000.
    expect(a.hand).toHaveLength(2); // the second event and the card drawn
    const second = a.hand.indexOf(e("073"));
    pick(act, "a", ["h:" + (second === 0 ? 1 : 0)]); // discard the other card of the first event
    act("a", { type: "event", handIndex: a.hand.indexOf(e("073")) });
    expect(choice(game, "a").options).toEqual([mid.uid, wall.uid]);
    expect(choice(game, "a").options).not.toContain(huge.uid);
  });

  it("炼狱 杏寿郎 (071): without a discard cost it cannot be used", () => {
    const { a, act } = setup();
    const kyojuro = field(a, "front", e("071"));
    expect(() => act("a", { type: "activate", uid: kyojuro.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("炼狱 杏寿郎 (072): discards any number of cards; each adds 500 to the BP limit of the sidelined character; gets BP+500 and 冲击① this turn", () => {
    const { game, a, b, act } = setup();
    const low = field(b, "front", GUARD); // 3000
    const mid = field(b, "front", GUARD);
    mid.bpMod = 500; // 3500
    const wall = field(b, "front", HOSHI); // 4000
    const high = field(b, "front", HOSHI);
    high.bpMod = 500; // 4500
    a.hand.push(e("072"), W0, MISHA, GUARD);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    expect(choice(game, "a").min).toBe(0);
    expect(choice(game, "a").max).toBe(3);
    pick(act, "a", ["h:0", "h:1"]);
    expect(a.sideline).toEqual([W0, MISHA]);
    expect(a.hand).toEqual([GUARD]);
    // Two cards discarded: BP 4000 or less.
    expect(choice(game, "a").options).toEqual([low.uid, mid.uid, wall.uid]);
    pick(act, "a", [wall.uid]);
    expect(b.sideline).toEqual([HOSHI]);
    const kyojuro = a.front[0]!;
    expect(bpOf(ctx, kyojuro)).toBe(5000);
    expect(impactOf(ctx, kyojuro)).toBe(1);
    // Only in our turn, and only for this turn.
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, kyojuro)).toBe(4500);
    expect(impactOf(ctx, kyojuro)).toBe(0);
    while (game.phase !== "attack") act("b", { type: "next_phase" });
    act("b", { type: "end_turn" });
    expect(bpOf(ctx, kyojuro)).toBe(4500);
    expect(impactOf(ctx, kyojuro)).toBe(0);
  });

  it("炼狱 杏寿郎 (072): with no card discarded the limit is 3000 and it gets no bonus; the character is optional", () => {
    const { game, a, b, act } = setup();
    const low = field(b, "front", GUARD); // 3000
    field(b, "front", HOSHI);
    a.hand.push(e("072"), W0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", []);
    expect(a.hand).toEqual([W0]);
    expect(choice(game, "a").options).toEqual([low.uid]);
    pick(act, "a", []);
    expect(b.sideline).toEqual([]);
    expect(b.front).toHaveLength(2);
    const kyojuro = a.front[0]!;
    expect(bpOf(ctx, kyojuro)).toBe(4500);
    expect(impactOf(ctx, kyojuro)).toBe(0);

    // An empty hand: nothing is asked about discarding.
    const second = setup();
    const only = field(second.b, "front", W0);
    second.a.hand.push(e("072"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(second.game, "a").options).toEqual([only.uid]);
  });

  it("炼狱 杏寿郎 (072): BP+500 and 冲击① after an event card or 〈炼狱 杏寿郎〉 put a hand card into the sideline this turn, but not after a cost", () => {
    // An event card does it.
    const { a, act } = setup();
    const kyojuro = field(a, "front", e("072"));
    a.library = [W0, GUARD];
    a.hand.push(e("073"), MISHA);
    refresh(act);
    expect(bpOf(ctx, kyojuro)).toBe(4500);
    act("a", { type: "event", handIndex: 0 });
    pick(act, "a", ["h:0"]);
    expect(bpOf(ctx, kyojuro)).toBe(5000);
    expect(impactOf(ctx, kyojuro)).toBe(1);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, kyojuro)).toBe(4500);

    // Another 〈炼狱 杏寿郎〉 does it.
    const second = setup();
    const raised = field(second.a, "front", e("072"));
    second.a.library = [W0, GUARD];
    second.a.hand.push(e("070"), MISHA);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["h:0"]);
    expect(bpOf(ctx, raised)).toBe(5000);

    // A discard paid as a cost (071) is not an effect; a card that is not 杏寿郎 or an event does not count.
    const third = setup();
    const base = field(third.a, "front", e("072"));
    const paid = field(third.a, "front", e("071"));
    third.a.hand.push(MISHA);
    third.act("a", { type: "activate", uid: paid.uid, ability: 0 });
    expect(third.a.sideline).toEqual([MISHA]);
    expect(bpOf(ctx, base)).toBe(4500);
    const fourth = setup();
    energy(fourth.a, 2, MURATA);
    const plain = field(fourth.a, "front", e("072"));
    fourth.a.library = [W0, GUARD];
    fourth.a.hand.push(OBANAI, MISHA);
    fourth.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(fourth.act, "a", ["h:0"]);
    expect(fourth.a.sideline).toEqual([MISHA]);
    expect(bpOf(ctx, plain)).toBe(4500);
  });

  it("炼狱 杏寿郎 (072): is a Raid card that raids onto 〈炼狱 杏寿郎〉", () => {
    const { a, act } = setup();
    const base = field(a, "energy", e("070"), true);
    a.hand.push(e("072"));
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(a.front.map((card) => card.cardId)).toEqual([e("072")]);
    expect(a.front[0]!.rested).toBe(false); // 突进: activated
  });

  it("炎之呼吸 壹之型 不知火 (073): sidelines a front-line character with BP 3000 or less (5000 with 〈炼狱 杏寿郎〉), then draws 1 and discards 1", () => {
    const { game, a, b, act } = setup();
    const low = field(b, "front", W0);
    const mid = field(b, "front", GUARD);
    field(b, "front", HOSHI);
    const away = field(b, "energy", W0);
    a.library = [GUARD, HOSHI];
    a.hand.push(e("073"), MISHA);
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([low.uid, mid.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [mid.uid]);
    expect(b.sideline).toEqual([GUARD]);
    expect(b.energy).toEqual([away]);
    expect(a.hand).toEqual([MISHA, GUARD]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([GUARD]);
    expect(a.sideline).toContain(MISHA);
    expect(a.sideline).toContain(e("073"));

    const second = setup();
    field(second.a, "energy", e("070"));
    const small = field(second.b, "front", W0);
    const wall = field(second.b, "front", HOSHI);
    const huge = field(second.b, "front", GUARD);
    huge.bpMod = 2500; // 5500
    second.a.hand.push(e("073"), MISHA);
    second.act("a", { type: "event", handIndex: 0 });
    expect(choice(second.game, "a").options).toEqual([small.uid, wall.uid]);
    pick(second.act, "a", [wall.uid]);
    expect(second.b.sideline).toEqual([HOSHI]);
  });

  it("炎之呼吸 壹之型 不知火 (073): with nobody to sideline it still draws 1 and discards 1", () => {
    const { game, a, act } = setup();
    a.library = [GUARD];
    a.hand.push(e("073"));
    act("a", { type: "event", handIndex: 0 });
    // The single hand card is put into the sideline without a question.
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([]);
    expect(a.sideline).toContain(GUARD);
  });
});

describe("KMY batch 6: UA05ST starter deck", () => {
  it("我妻 善逸 (001): looks at 4, reveals up to one 炭治郎 / 祢豆子 / 伊之助 (猪子 and 炭子 included), discards a card if one was added", () => {
    const { game, a, act } = setup();
    energy(a, 2, MURATA);
    a.library = [W0, NEZUKO, ZENKO, BOAR, TANJIRO, FILLER];
    a.hand.push(s("001"), GUARD);
    act("a", { type: "play", handIndex: 0, line: "front" });
    // Only the first 4 cards are looked at; 善子 is regarded as 〈我妻 善逸〉, which is not on the list.
    expect(choice(game, "a").options).toEqual(["l:1", "l:3"]);
    expect(choice(game, "a").max).toBe(1);
    pick(act, "a", ["l:3"]);
    pick(act, "a", ["l:0", "l:1", "l:2"]);
    expect(a.library).toEqual([TANJIRO, FILLER, W0, NEZUKO, ZENKO]);
    expect(a.hand).toEqual([GUARD, BOAR]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([BOAR]);
    expect(a.sideline).toEqual([GUARD]);

    // Up to one: nothing revealed, nothing discarded.
    const second = setup();
    energy(second.a, 2, MURATA);
    second.a.library = [W0, NEZUKO, GUARD, HOSHI];
    second.a.hand.push(s("001"), GUARD);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1", "l:2", "l:3"]);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([GUARD]);
    expect(second.a.library.slice(0, 30)).toEqual(expect.arrayContaining([W0]));

    // A 炭子 counts as 〈灶门 炭治郎〉.
    const third = setup();
    energy(third.a, 2, MURATA);
    third.a.library = [W0, SUMIKO, GUARD, HOSHI];
    third.a.hand.push(s("001"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(third.game, "a").options).toEqual(["l:1"]);
  });

  it("鳞泷 左近次 (003): [rest] +1000 BP this turn to another character on our field", () => {
    const { game, a, act } = setup();
    const sakonji = field(a, "energy", s("003"));
    const front = field(a, "front", W0);
    const back = field(a, "energy", MISHA);
    act("a", { type: "activate", uid: sakonji.uid, ability: 0 });
    expect(sakonji.rested).toBe(true);
    expect(choice(game, "a").options).toEqual([front.uid, back.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [front.uid]);
    expect(bpOf(ctx, front)).toBe(3000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, front)).toBe(2000);
  });

  it("鎹鸦 (004): once per turn rests for +1 yellow energy this turn and leaves when the main phase ends", () => {
    const { a, act } = setup();
    const crow = field(a, "energy", s("004"));
    expect(energyOf(ctx, a, "yellow")).toBe(1);
    act("a", { type: "activate", uid: crow.uid, ability: 0 });
    expect(crow.rested).toBe(true);
    expect(energyOf(ctx, a, "yellow")).toBe(2);
    expect(() => act("a", { type: "activate", uid: crow.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([s("004")]);
  });

  it("栗花落 香奈乎 (014): makes +1 yellow energy only while active", () => {
    const { a, act } = setup();
    const kanao = field(a, "energy", s("014"));
    refresh(act);
    expect(energyOf(ctx, a, "yellow")).toBe(2);
    kanao.rested = true;
    act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "rest" } });
    expect(energyOf(ctx, a, "yellow")).toBe(1);
  });

  it("嘴平 伊之助 (015): 冲击1; on the front line it leaves at the end of our attack phase while active, and when it loses an attack", () => {
    const { a, act } = setup("attack");
    const inosuke = field(a, "front", s("015"));
    expect(impactOf(ctx, inosuke)).toBe(1);
    act("a", { type: "next_phase" });
    expect(a.front).toEqual([]);
    expect(a.sideline).toEqual([s("015")]);

    const second = setup("attack");
    const attacker = field(second.a, "front", s("015")); // BP2500
    const wall = field(second.b, "front", HOSHI);
    second.act("a", { type: "attack", attackerUid: attacker.uid });
    second.act("b", { type: "block", blockerUid: wall.uid });
    expect(second.a.front).toEqual([]);
    expect(second.a.sideline).toEqual([s("015")]);

    // On the energy line it does not leave.
    const third = setup("attack");
    const resting = field(third.a, "energy", s("015"));
    third.act("a", { type: "next_phase" });
    expect(third.a.energy).toEqual([resting]);
  });

  it("水之呼吸 拾之型 生生流转 (033): sidelines a front-line character with BP 3000 or less; with 〈灶门 炭治郎〉 (or 炭子) on our field 5000 or less", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, MURATA);
    const low = field(b, "front", W0);
    const mid = field(b, "front", GUARD);
    field(b, "front", HOSHI);
    a.hand.push(s("033"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([low.uid, mid.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [mid.uid]);
    expect(b.sideline).toEqual([GUARD]);
    expect(a.sideline).toEqual([s("033")]);

    for (const helper of [TANJIRO, SUMIKO]) {
      const second = setup();
      energy(second.a, 4, MURATA);
      field(second.a, "energy", helper);
      const small = field(second.b, "front", W0);
      const wall = field(second.b, "front", HOSHI);
      const huge = field(second.b, "front", GUARD);
      huge.bpMod = 2500; // 5500
      second.a.hand.push(s("033"));
      second.act("a", { type: "event", handIndex: 0 });
      expect(choice(second.game, "a").options).toEqual([small.uid, wall.uid]);
      pick(second.act, "a", [wall.uid]);
      expect(second.b.sideline).toEqual([HOSHI]);
    }
  });

  it("灶门 炭治郎 (102): only the keyword 撤步", () => {
    expect(KMY_6_ABILITIES[s("102")]).toBeUndefined();
    expect(isAutomated(titleCard(s("102")))).toBe(true);
    const { a, act } = setup("movement");
    const tanjiro = field(a, "front", s("102"));
    act("a", { type: "move", toFront: [], toEnergy: [tanjiro.uid], remove: [] });
    expect(a.energy).toEqual([tanjiro]);
  });

  it("灶门 炭治郎 (103): with 〈灶门 祢豆子〉 on our field it gets BP+500 and 冲击① until our next turn starts", () => {
    const { game, a, act } = setup();
    energy(a, 4, MURATA);
    field(a, "energy", NEZUKO);
    a.hand.push(s("103"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const tanjiro = a.front[0]!;
    expect(bpOf(ctx, tanjiro)).toBe(4500);
    expect(impactOf(ctx, tanjiro)).toBe(1);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, tanjiro)).toBe(4500); // still the opponent's turn
    while (game.phase !== "attack") act("b", { type: "next_phase" });
    act("b", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("a");
    expect(bpOf(ctx, tanjiro)).toBe(4000);
    expect(impactOf(ctx, tanjiro)).toBe(0);

    // Without 〈灶门 祢豆子〉 nothing happens.
    const second = setup();
    energy(second.a, 4, MURATA);
    field(second.a, "energy", TANJIRO);
    second.a.hand.push(s("103"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(bpOf(ctx, second.a.front[0]!)).toBe(4000);
    expect(impactOf(ctx, second.a.front[0]!)).toBe(0);
  });

  it("灶门 祢豆子 (104): sidelines up to one opposing front-line character that needs 3 energy or less", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, MURATA);
    const cheap = field(b, "front", GUARD); // cost 3
    const free = field(b, "front", W0); // cost 0
    field(b, "front", HOSHI); // cost 4
    const away = field(b, "energy", MISHA);
    a.hand.push(s("104"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([cheap.uid, free.uid]);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [cheap.uid]);
    expect(b.sideline).toEqual([GUARD]);
    expect(b.energy).toEqual([away]);

    // Up to one.
    const second = setup();
    energy(second.a, 4, MURATA);
    field(second.b, "front", W0);
    second.a.hand.push(s("104"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.b.front).toHaveLength(1);
  });

  it("锖兔 (105): +1000 BP this turn to up to one other character on our field", () => {
    const { game, a, act } = setup();
    energy(a, 1, MURATA);
    const front = field(a, "front", W0);
    a.hand.push(s("105"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const sabito = a.front.find((card) => card.cardId === s("105"))!;
    const options = choice(game, "a").options;
    expect(options).toContain(front.uid);
    expect(options).not.toContain(sabito.uid);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [front.uid]);
    expect(bpOf(ctx, front)).toBe(3000);
    expect(bpOf(ctx, sabito)).toBe(2000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, front)).toBe(2000);
  });

  it("富冈 义勇 (107): rests up to one opposing front-line character, then draws a card; has 冲击1", () => {
    const { game, a, b, act } = setup();
    energy(a, 5, MURATA);
    const target = field(b, "front", W0);
    const other = field(b, "front", GUARD);
    const away = field(b, "energy", MISHA);
    a.library = [GUARD, HOSHI];
    a.hand.push(s("107"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(impactOf(ctx, a.front[0]!)).toBe(1);
    expect(choice(game, "a").options).toEqual([target.uid, other.uid]);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [target.uid]);
    expect(target.rested).toBe(true);
    expect(other.rested).toBe(false);
    expect(away.rested).toBe(false);
    expect(a.hand).toEqual([GUARD]);

    // Up to one: none rested, the card is still drawn.
    const second = setup();
    energy(second.a, 5, MURATA);
    field(second.b, "front", W0);
    second.a.library = [GUARD];
    second.a.hand.push(s("107"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.b.front[0]!.rested).toBe(false);
    expect(second.a.hand).toEqual([GUARD]);
  });

  it("巨大的岩石 (108): [rest][sideline this card] all our characters get BP+1000 this turn", () => {
    const { a, b, act } = setup();
    const rock = field(a, "energy", s("108"));
    const front = field(a, "front", W0);
    const back = field(a, "energy", MISHA);
    const theirs = field(b, "front", W0);
    act("a", { type: "activate", uid: rock.uid, ability: 0 });
    expect(a.sideline).toEqual([s("108")]);
    expect(bpOf(ctx, front)).toBe(3000);
    expect(bpOf(ctx, back)).toBe(2000);
    expect(bpOf(ctx, theirs)).toBe(2000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, front)).toBe(2000);
    expect(bpOf(ctx, back)).toBe(1000);

    // A rested site cannot pay the cost.
    const second = setup();
    const tired = field(second.a, "energy", s("108"), true);
    expect(() => second.act("a", { type: "activate", uid: tired.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("伙伴 (109): looks at 5, reveals up to two 炭治郎 / 祢豆子 / 善逸 / 伊之助 (and their 変装 cards) into the hand", () => {
    const { game, a, act } = setup();
    energy(a, 2, MURATA);
    a.library = [W0, NEZUKO, ZENKO, TANJIRO, bt("077"), GUARD];
    a.hand.push(s("109"));
    act("a", { type: "event", handIndex: 0 });
    // The 6th card is not looked at; 善子 is regarded as 〈我妻 善逸〉.
    expect(choice(game, "a").options).toEqual(["l:1", "l:2", "l:3", "l:4"]);
    expect(choice(game, "a").max).toBe(2);
    pick(act, "a", ["l:1", "l:3"]);
    expect(choice(game, "a").purpose).toBe("target");
    pick(act, "a", ["l:0", "l:1", "l:2"]); // the three cards left, renumbered
    expect(a.hand).toEqual([NEZUKO, TANJIRO]);
    expect(a.library.slice(0, 1)).toEqual([GUARD]);
    expect(a.library.slice(-3)).toEqual([W0, ZENKO, bt("077")]);

    // Up to two: none is fine.
    const second = setup();
    energy(second.a, 2, MURATA);
    second.a.library = [NEZUKO, TANJIRO];
    second.a.hand.push(s("109"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1"]);
    expect(second.a.hand).toEqual([]);
  });
});

describe("KMY batch 6: UA01NC", () => {
  it("灶门 炭治郎 (2-001): once per turn, when one of our characters moves in the attack phase, +1000 BP to up to one character", () => {
    const { game, a, act } = setup();
    const tanjiro = field(a, "front", c("001"));
    const other = field(a, "front", W0);
    const nezuko = field(a, "energy", c("002"));
    act("a", { type: "next_phase" }); // 祢豆子 may swap with a front-line character
    pick(act, "a", [tanjiro.uid]); // (the front-line character to swap with)
    pick(act, "a", ["yes"]);
    // Both 炭治郎 and 祢豆子 moved, which is one trigger for 炭治郎 (once per turn).
    expect(a.front).toEqual([nezuko, other]);
    expect(a.energy).toEqual([tanjiro]);
    expect(choice(game, "a").options.sort()).toEqual([tanjiro.uid, other.uid, nezuko.uid].sort());
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [other.uid]);
    expect(game.pending).toBeNull();
    expect(bpOf(ctx, other)).toBe(3000);
    expect(tanjiro.used).toContain(0);
  });

  it("灶门 炭治郎 (2-001): moves in the movement phase, or none chosen, do nothing", () => {
    const { game, a, act } = setup("movement");
    const tanjiro = field(a, "front", c("001"));
    const back = field(a, "energy", W0);
    act("a", { type: "move", toFront: [back.uid], toEnergy: [], remove: [] });
    expect(game.pending).toBeNull();
    expect(tanjiro.used).toEqual([]);
    expect(bpOf(ctx, back)).toBe(2000);
  });

  it("灶门 祢豆子 (2-002): on the energy line, when our attack phase starts, may swap places with a front-line character", () => {
    const { game, a, act } = setup();
    const front = field(a, "front", W0);
    const other = field(a, "front", MISHA);
    const nezuko = field(a, "energy", c("002"));
    act("a", { type: "next_phase" });
    expect(choice(game, "a").options).toEqual([front.uid, other.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [other.uid]);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.front).toEqual([front, nezuko]);
    expect(a.energy).toEqual([other]);

    // Declining leaves everything in place.
    const second = setup();
    const f2 = field(second.a, "front", W0);
    const n2 = field(second.a, "energy", c("002"));
    second.act("a", { type: "next_phase" });
    pick(second.act, "a", ["no"]);
    expect(second.a.front).toEqual([f2]);
    expect(second.a.energy).toEqual([n2]);

    // On the front line it does nothing; with an empty front line there is nobody to swap with.
    const third = setup();
    field(third.a, "front", c("002"));
    field(third.a, "energy", W0);
    third.act("a", { type: "next_phase" });
    expect(third.game.pending).toBeNull();
    const fourth = setup();
    field(fourth.a, "energy", c("002"));
    fourth.act("a", { type: "next_phase" });
    expect(fourth.game.pending).toBeNull();
    expect(fourth.a.energy).toHaveLength(1);
  });

  it("灶门 祢豆子 (2-002): does not act in the opponent's attack phase", () => {
    const { game, a, b, act } = setup("main", "b");
    const front = field(a, "front", W0);
    const nezuko = field(a, "energy", c("002"));
    field(b, "front", MISHA);
    act("b", { type: "next_phase" }); // the opponent's attack phase starts
    expect(game.phase).toBe("attack");
    expect(game.pending).toBeNull();
    expect(a.front).toEqual([front]);
    expect(a.energy).toEqual([nezuko]);
  });

  it("甘露寺 蜜璃 (2-004): [pay 1 AP][once per turn] this character gets BP+2500 this turn", () => {
    const { a, act } = setup();
    const mitsuri = field(a, "front", c("004"));
    act("a", { type: "activate", uid: mitsuri.uid, ability: 0 });
    expect(a.ap.filter((card) => card.rested)).toHaveLength(1);
    expect(bpOf(ctx, mitsuri)).toBe(4000);
    expect(() => act("a", { type: "activate", uid: mitsuri.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, mitsuri)).toBe(1500);

    // The AP cannot be paid.
    const second = setup();
    const broke = field(second.a, "front", c("004"));
    second.a.ap.forEach((card) => { card.rested = true; });
    expect(() => second.act("a", { type: "activate", uid: broke.uid, ability: 0 })).toThrow();
  });

  it("蝴蝶 忍 (2-005): [on the front line][once per turn] BP-1000 this turn to up to one opposing front-line character with BP 1500 or more", () => {
    const { game, a, b, act } = setup();
    const shinobu = field(a, "front", c("005"));
    const weak = field(b, "front", MISHA); // 1000
    const edge = field(b, "front", bt("005")); // 1500
    const strong = field(b, "front", HOSHI);
    field(b, "energy", GUARD);
    act("a", { type: "activate", uid: shinobu.uid, ability: 0 });
    expect(shinobu.rested).toBe(false); // no rest cost
    expect(choice(game, "a").options).toEqual([edge.uid, strong.uid]);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [strong.uid]);
    expect(bpOf(ctx, strong)).toBe(3000);
    expect(bpOf(ctx, weak)).toBe(1000);
    expect(() => act("a", { type: "activate", uid: shinobu.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, strong)).toBe(4000);

    // Not on the front line.
    const second = setup();
    const back = field(second.a, "energy", c("005"));
    field(second.b, "front", HOSHI);
    expect(() => second.act("a", { type: "activate", uid: back.uid, ability: 0 })).toThrow();
  });

  it("不死川 实弥 (2-006): BP+500 in our turn with 3 or more 〈产屋敷 耀哉〉 and other 柱; on entering with 6 or more it becomes active", () => {
    const { a, act } = setup();
    const sanemi = field(a, "front", c("006"));
    field(a, "energy", OYAKATA);
    field(a, "energy", MITSURI);
    refresh(act);
    expect(bpOf(ctx, sanemi)).toBe(3500);
    field(a, "energy", bt("018"));
    refresh(act);
    expect(bpOf(ctx, sanemi)).toBe(4000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, sanemi)).toBe(3500);

    // He does not count himself; a non-柱 does not count.
    const second = setup();
    const alone = field(second.a, "front", c("006"));
    field(second.a, "energy", OYAKATA);
    field(second.a, "energy", W0);
    refresh(second.act);
    expect(bpOf(ctx, alone)).toBe(3500);

    // 【登场时】: 6 characters needed (the played 实弥 is not one of them).
    const third = setup();
    energy(third.a, 3, MURATA);
    for (const pillar of PILLARS.slice(0, 5)) field(third.a, "energy", pillar);
    third.a.hand.push(c("006"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(third.a.front[0]!.rested).toBe(true);
    const fourth = setup();
    energy(fourth.a, 3, MURATA);
    field(fourth.a, "energy", OYAKATA);
    for (const pillar of PILLARS.slice(0, 5)) field(fourth.a, "energy", pillar);
    fourth.a.hand.push(c("006"));
    fourth.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(fourth.a.front[0]!.rested).toBe(false);
  });

  it("时透 无一郎 (2-007): makes +1 yellow energy with 3 or more 〈产屋敷 耀哉〉 and other 柱 on our field", () => {
    const { a, act } = setup();
    field(a, "energy", c("007"));
    refresh(act);
    expect(energyOf(ctx, a, "yellow")).toBe(1);
    field(a, "front", OYAKATA);
    field(a, "front", MITSURI);
    refresh(act);
    expect(energyOf(ctx, a, "yellow")).toBe(1);
    field(a, "front", bt("018"));
    refresh(act);
    expect(energyOf(ctx, a, "yellow")).toBe(2);
  });

  it("富冈 义勇 (2-008): 冲击无效; on entering it cannot be sidelined by the opponent's character or event effects until our next turn starts", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, MURATA);
    a.hand.push(c("008"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const giyu = a.front[0]!;
    expect(hasKeyword(ctx, giyu, "冲击无效")).toBe(true);
    expect(flagsOf(giyu)).toContain("noSidelineByOppEffect");
    act("a", { type: "end_turn" });
    // The opponent uses 不知火 (BP 5000 or less with 〈炼狱 杏寿郎〉 on their field) on it.
    field(b, "energy", e("070"));
    b.ap = [0, 1, 2].map((index) => ({ id: `b:ap${index}`, rested: false }));
    b.hand.push(e("073"));
    while (game.phase !== "main") act("b", { type: "next_phase" });
    act("b", { type: "event", handIndex: b.hand.indexOf(e("073")) });
    expect(a.front).toEqual([giyu]);
    expect(a.sideline).toEqual([]);
    pick(act, "b", [choice(game, "b").options[0]!]); // 不知火 goes on: draw 1, discard 1
    // Our next turn: the protection is gone.
    while (game.turnPlayerId !== "a") act("b", { type: "end_turn" });
    expect(flagsOf(giyu)).not.toContain("noSidelineByOppEffect");

    // A 〈富冈 义勇〉 that did not just enter (no protection) is sidelined by the same event.
    const second = setup();
    const plain = field(second.a, "front", c("008"));
    second.act("a", { type: "end_turn" });
    field(second.b, "energy", e("070"));
    second.b.ap = [0, 1, 2].map((index) => ({ id: `b:ap${index}`, rested: false }));
    second.b.hand.push(e("073"));
    while (second.game.phase !== "main") second.act("b", { type: "next_phase" });
    second.act("b", { type: "event", handIndex: second.b.hand.indexOf(e("073")) });
    expect(second.a.front).toEqual([]);
    expect(second.a.sideline).toEqual([c("008")]);
    expect(plain.cardId).toBe(c("008"));
  });

  it("富冈 义勇 (2-008): sidelined normally by battle during the protected time", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, MURATA);
    a.hand.push(c("008"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const giyu = a.front[0]!;
    giyu.bpMod = -3500; // BP500: loses the battle it is blocked in...
    act("a", { type: "end_turn" });
    const attacker = field(b, "front", HOSHI);
    while (game.phase !== "attack") act("b", { type: "next_phase" });
    act("b", { type: "attack", attackerUid: attacker.uid });
    act("a", { type: "block", blockerUid: giyu.uid });
    expect(a.sideline).toContain(c("008"));
    expect(a.front).toEqual([]);
  });

  it("悲鸣屿 行冥 (2-009): may discard a card, then put a non-行冥 柱 with AP cost 1 that we can pay for from the hand onto the field, resting", () => {
    const { game, a, act } = setup();
    energy(a, 5, MURATA);
    a.hand.push(c("009"), OBANAI, c("009"), e("034"), bt("020"), W0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1", "h:2", "h:3", "h:4"]);
    pick(act, "a", ["h:4"]); // W0
    expect(a.sideline).toEqual([W0]);
    // 伊黑 小芭内 only: the other 〈悲鸣屿 行冥〉 is excluded, the blue 蜜璃 needs blue energy, the other 蜜璃 costs 2 AP.
    expect(a.hand).toEqual([OBANAI, c("009"), e("034"), bt("020")]);
    expect(choice(game, "a").options).toEqual(["h:0"]);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", ["h:0"]);
    expect(choice(game, "a").options).toEqual(["line:front", "line:energy"]);
    pick(act, "a", ["line:front"]); // (the energy line is full)
    expect(a.front.map((card) => card.cardId)).toEqual([c("009"), OBANAI]);
    expect(a.front[1]!.rested).toBe(true);
    // (伊黑 小芭内's own 登场时 draws a card and asks for a discard.)
    expect(a.hand).toEqual([c("009"), e("034"), bt("020"), FILLER]);
    expect(choice(game, "a").purpose).toBe("target");

    // Declining the discard, or choosing nobody.
    const second = setup();
    energy(second.a, 5, MURATA);
    second.a.hand.push(c("009"), OBANAI);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["no"]);
    expect(second.a.hand).toEqual([OBANAI]);
    expect(second.a.sideline).toEqual([]);
    const third = setup();
    energy(third.a, 5, MURATA);
    third.a.hand.push(c("009"), OBANAI, W0);
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", ["yes"]);
    pick(third.act, "a", ["h:1"]);
    pick(third.act, "a", []);
    expect(third.a.hand).toEqual([OBANAI]);
    expect(third.a.sideline).toEqual([W0]);

    // An empty hand: nothing to ask.
    const fourth = setup();
    energy(fourth.a, 5, MURATA);
    fourth.a.hand.push(c("009"));
    fourth.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(fourth.game.pending).toBeNull();
  });

  it("宇髓 天元 (2-010): enters active; when attacking may swap a front-line 天元的妻子 with an energy-line 〈宇髓 天元〉 or 天元的妻子", () => {
    const { game, a, act } = setup();
    a.hand.push(c("010"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.front[0]!.rested).toBe(false);

    const second = setup("attack");
    const tengen = field(second.a, "front", c("010"));
    const wife = field(second.a, "front", HINATSURU);
    const first = field(second.a, "energy", MAKIO);
    const alsoTengen = field(second.a, "energy", TENGEN);
    field(second.a, "energy", W0);
    second.act("a", { type: "attack", attackerUid: tengen.uid });
    // Front-line choice: only 雏鹤 (天元 himself is not 天元的妻子) -> chosen without a question; the energy line offers two.
    expect(choice(second.game, "a").options).toEqual([first.uid, alsoTengen.uid]);
    expect(choice(second.game, "a").min).toBe(1);
    pick(second.act, "a", [alsoTengen.uid]);
    expect(choice(second.game, "a").purpose).toBe("confirm");
    pick(second.act, "a", ["yes"]);
    expect(second.a.front).toEqual([tengen, alsoTengen]);
    expect(second.a.energy.slice(0, 2)).toEqual([first, wife]);
    void game;
  });

  it("宇髓 天元 (2-010): declining keeps the positions; moving a 须磨&槙於&雏鹤 in our attack phase triggers its +1000 BP", () => {
    const { game, a, act } = setup("attack");
    const tengen = field(a, "front", c("010"));
    const wife = field(a, "front", HINATSURU);
    const back = field(a, "energy", MAKIO);
    act("a", { type: "attack", attackerUid: tengen.uid });
    pick(act, "a", ["no"]);
    expect(a.front).toEqual([tengen, wife]);
    expect(a.energy).toEqual([back]);

    const second = setup("attack");
    const attacker = field(second.a, "front", c("010"));
    const suma = field(second.a, "front", e("068"));
    const makio = field(second.a, "energy", MAKIO);
    second.act("a", { type: "attack", attackerUid: attacker.uid });
    pick(second.act, "a", ["yes"]);
    expect(second.a.front).toEqual([attacker, makio]);
    expect(second.a.energy).toEqual([suma]);
    // 须磨 moved: BP+1000 to 〈宇髓 天元〉 (the attacker) or a 变装 character.
    expect(choice(second.game, "a").options).toEqual([attacker.uid]);
    pick(second.act, "a", [attacker.uid]);
    expect(bpOf(ctx, attacker)).toBe(5000); // 4000 + 1000
    void game;
  });

  it("炼狱 杏寿郎 (2-011): 冲击无效; others cannot be targeted by 瞄准攻击 while it is on the front line; 退场时 gives another character BP+1000", () => {
    const { game, a, b, act } = setup();
    const kyojuro = field(a, "front", c("011"));
    const friend = field(a, "front", W0);
    const away = field(a, "energy", MISHA);
    refresh(act);
    expect(hasKeyword(ctx, kyojuro, "冲击无效")).toBe(true);
    expect(flagsOf(friend)).toContain("unsnipeable");
    expect(flagsOf(away)).toContain("unsnipeable");
    expect(flagsOf(kyojuro)).not.toContain("unsnipeable");
    const sniper = field(b, "front", HOSHI);
    act("a", { type: "end_turn" });
    while (game.phase !== "attack") act("b", { type: "next_phase" });
    sniper.grants.push("瞄准攻击");
    kyojuro.bpMod = 2000; // it wins the battle and stays
    expect(() => act("b", { type: "attack", attackerUid: sniper.uid, targetUid: friend.uid })).toThrow("INVALID_TARGET");
    act("b", { type: "attack", attackerUid: sniper.uid, targetUid: kyojuro.uid });
    expect(game.pending).toBeNull();

    // Only while on the front line.
    const second = setup();
    const tucked = field(second.a, "energy", c("011"));
    const other = field(second.a, "front", W0);
    refresh(second.act);
    expect(flagsOf(other)).not.toContain("unsnipeable");
    expect(flagsOf(tucked)).not.toContain("unsnipeable");

    // 退场时.
    const third = setup();
    const dying = field(third.a, "front", c("011"));
    const twin = field(third.a, "front", c("011"));
    const target = field(third.a, "energy", W0);
    sidelineManually(third.act, "a", "you", dying.uid);
    expect(choice(third.game, "a").options).toEqual([target.uid]); // not the other 〈炼狱 杏寿郎〉
    expect(choice(third.game, "a").min).toBe(0);
    pick(third.act, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(3000);
    expect(bpOf(ctx, twin)).toBe(4000);
    third.act("a", { type: "end_turn" });
    expect(bpOf(ctx, target)).toBe(2000);
    void FILLER;
  });
});
