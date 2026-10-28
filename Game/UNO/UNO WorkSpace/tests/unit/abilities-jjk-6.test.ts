/**
 * JJK batch 6 (EX04BT/JJK-3-067 .. 073, UA02ST/JJK-1-044 .. 109, UA02NC/JJK-2-001 .. 011): one test per card, set up as its printed text describes
 * and checked against the text. Card text comes from Cards/cards.json (no card art on this machine).
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, energyOf, flagsOf, hasKeyword, impactOf, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { JJK_6_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-jjk-6.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";

const X = (suffix: string): string => `EX04BT/JJK-3-${suffix}`;
const S = (suffix: string): string => `UA02ST/JJK-1-${suffix}`;
const N = (suffix: string): string => `UA02NC/JJK-2-${suffix}`;
const J = (suffix: string): string => `UA02BT/JJK-1-${suffix}`;
// Helper cards without abilities (or with abilities that do not matter).
const KING = "UC01BT/ARK-1-004"; // yellow, cost 0, BP1500 (also the harness filler)
const W = "UC01BT/ARK-1-009"; // yellow, cost 0, BP2000
const STAR = "UC01BT/ARK-1-080"; // red, cost 1, BP2500
const GUARD = "UC01ST/ARK-1-103"; // blue, cost 3, BP3000, makes 2 blue energy
const BLUE2 = J("035"); // 家入 硝子: blue, makes 2 blue energy
const YELLOW2 = J("009"); // 五条 悟: yellow, makes 2 yellow energy
const PURPLE2 = J("092"); // 真人: purple, makes 2 purple energy, 咒灵
const RED2 = X("042"); // 虎杖 悠仁: "yellow" in the data, makes 2 red energy, 咒术师
const RED1 = X("040"); // 虎杖 悠仁: makes 1 red energy, BP1500, 咒术师
const SORCERER_4000 = X("043"); // 虎杖 悠仁: BP4000, 咒术师, red energy
const SORCERER_AP2 = X("051"); // 五条 悟: AP cost 2, 咒术师
const SWELL = X("060"); // 胀相 BP1500
const DECAY = X("058"); // 坏相 BP3500
const BLOOD = X("059"); // 血涂 BP3000
const YUJI_YELLOW = J("001"); // 虎杖 悠仁 BP1000
const KYOTO_A = J("079"); // 东堂 葵: purple, BP1500, 京都校
const KYOTO_B = J("080"); // 东堂 葵: purple, BP3500, 京都校
const CURSE = J("091"); // 真人: purple, BP1500, 咒灵
const FINGER = J("063"); // 宿傩的手指 (event)
const YELLOW_EVENT_0 = X("073"); // 领域展开: cost 0 event, "yellow" in the data
const YELLOW_EVENT_3 = J("100"); // 领域展开 (blue event)
const SHIKIGAMI = J("024"); // 玉犬:黑&白: yellow, 式神
const DOMAIN = J("027"); // 嵌合暗翳庭 (site)
const GOJO_RED = X("052"); // 五条 悟 (BP5000)

const BATCH = [
  X("067"), X("068"), X("069"), X("070"), X("071"), X("072"), X("073"),
  S("044"), S("056"), S("058"), S("101"), S("103"), S("104"), S("105"), S("107"), S("108"), S("109"),
  N("001"), N("002"), N("003"), N("004"), N("005"), N("006"), N("007"), N("008"), N("010"), N("011")
];

type Act = (who: string, action: UnionArenaAction) => void;
const pick = (act: Act, who: string, picks: string[]): void => act(who, { type: "choose", picks });
const yes = (act: Act, who = "a"): void => pick(act, who, ["yes"]);
const no = (act: Act, who = "a"): void => pick(act, who, ["no"]);
/** Any action ends in a recalculation of the continuous effects; this one changes nothing. */
const refresh = (act: Act, who = "a"): void => act(who, { type: "manual", manual: { op: "ap", apId: `${who}:ap0`, act: "activate" } });
/** Puts a card into the hand and plays it. */
function play(a: EnginePlayer, act: Act, number: string, line: "front" | "energy" = "front"): UnionArenaFieldCard {
  const handIndex = a.hand.push(number) - 1;
  act("a", { type: "play", handIndex, line });
  return a[line][a[line].length - 1]!;
}
const useEvent = (a: EnginePlayer, act: Act, number: string): void => act("a", { type: "event", handIndex: a.hand.push(number) - 1 });
const sidelineByHand = (act: Act, card: UnionArenaFieldCard, who = "a"): void => act(who, { type: "manual", manual: { op: "field", owner: "you", uid: card.uid, act: "sideline" } });
/** A card with its BP raised or lowered by `change` (this turn). */
function withBp(owner: EnginePlayer, line: "front" | "energy", number: string, change: number): UnionArenaFieldCard {
  const card = field(owner, line, number);
  card.bpMod = change;
  return card;
}
const activeAp = (player: EnginePlayer): number => player.ap.filter((card) => !card.rested).length;

describe("batch coverage", () => {
  it("every card of the batch has an entry in the ability table and plays entirely by itself", () => {
    for (const number of BATCH) {
      expect(JJK_6_ABILITIES[number], number).toBeDefined();
      expect(isAutomated(titleCard(number)), number).toBe(true);
    }
  });
});

describe("EX04BT (the extra booster)", () => {
  it("真人 (067): needs the front line and 5 or more energy produced; choosing 冲击① gives 【冲击①】 this turn, once per turn", () => {
    const { game, a, act } = setup();
    energy(a, 2, RED2);
    energy(a, 1, RED1); // 5 red energy
    expect(energyOf(ctx, a, "red")).toBe(5);
    const mahito = field(a, "front", X("067"));
    act("a", { type: "activate", uid: mahito.uid, ability: 0 });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    act("a", { type: "choose", picks: ["m:0"] });
    expect(game.pending).toBeNull();
    expect(hasKeyword(ctx, mahito, "冲击1")).toBe(true);
    expect(impactOf(ctx, mahito)).toBe(1);
    expect(() => act("a", { type: "activate", uid: mahito.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });

  it("真人 (067): with only 4 energy, or on the energy line, it cannot be used", () => {
    const low = setup();
    energy(low.a, 2, RED2); // 4
    const mahito = field(low.a, "front", X("067"));
    expect(() => low.act("a", { type: "activate", uid: mahito.uid, ability: 0 })).toThrow("ABILITY_CONDITION");

    const back = setup();
    energy(back.a, 3, RED2); // 6
    const away = field(back.a, "energy", X("067"));
    expect(() => back.act("a", { type: "activate", uid: away.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
  });

  it("真人 (067): choosing the second effect, we may sideline a character other than 〈真人〉, then draw 2 and sideline 1 card from the hand", () => {
    const { game, a, act } = setup();
    energy(a, 3, RED2);
    const mahito = field(a, "front", X("067"));
    const other = field(a, "front", KING);
    const twin = field(a, "front", X("067")); // another 〈真人〉: not allowed
    a.library = [W, STAR, "t1"];
    a.hand.push(KING);
    act("a", { type: "activate", uid: mahito.uid, ability: 0 });
    act("a", { type: "choose", picks: ["m:1"] });
    yes(act);
    const options = choice(game, "a").options;
    expect(options).toContain(other.uid);
    expect(options).not.toContain(mahito.uid); // 〈真人〉 itself and the other 〈真人〉 are not allowed
    expect(options).not.toContain(twin.uid);
    act("a", { type: "choose", picks: [other.uid] });
    expect(a.front.map((card) => card.uid)).toEqual([mahito.uid, twin.uid]);
    expect(a.sideline).toEqual([KING]);
    expect(a.hand).toEqual([KING, W, STAR]);
    expect(choice(game, "a").options).toHaveLength(3);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([W, STAR]);
    expect(a.sideline).toEqual([KING, KING]);
    expect(impactOf(ctx, mahito)).toBe(0); // the first effect was not chosen
  });

  it("真人 (067): the second effect can be declined (nothing happens) and does nothing without another character", () => {
    const { game, a, act } = setup();
    energy(a, 3, RED2);
    const mahito = field(a, "front", X("067"));
    const other = field(a, "front", KING);
    act("a", { type: "activate", uid: mahito.uid, ability: 0 });
    act("a", { type: "choose", picks: ["m:1"] });
    no(act);
    expect(game.pending).toBeNull();
    expect(a.front).toContain(other);
    expect(a.hand).toEqual([]);

    const alone = setup();
    energy(alone.a, 5, X("067")); // (a board that is too full to occur in play: it only checks that another 〈真人〉 is not a legal target)
    const lone = field(alone.a, "front", X("067"));
    alone.act("a", { type: "activate", uid: lone.uid, ability: 0 });
    alone.act("a", { type: "choose", picks: ["m:1"] });
    expect(alone.game.pending).toBeNull(); // not even asked
    expect(alone.a.front).toEqual([lone]);
  });

  it("地下铁路的站台 (068): the first 启动主要 rests it and mills the top card of the deck", () => {
    const { a, act } = setup();
    const site = field(a, "energy", X("068"));
    a.library = [W, STAR, KING];
    act("a", { type: "activate", uid: site.uid, ability: 0 });
    expect(site.rested).toBe(true);
    expect(a.sideline).toEqual([W]);
    expect(a.library).toEqual([STAR, KING]);
    expect(() => act("a", { type: "activate", uid: site.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("地下铁路的站台 (068): the second 启动主要 rests it and sidelines it to put 〈夏油 杰〉 / a 咒灵 / a 咒胎九相图 from the sideline on top of the deck", () => {
    const { game, a, act } = setup();
    const site = field(a, "energy", X("068"));
    a.sideline.push(KING, X("005"), CURSE, W, SWELL); // 夏油 杰, 咒灵, 咒胎九相图 are valid
    a.library = [STAR, "t1"];
    act("a", { type: "activate", uid: site.uid, ability: 1 });
    expect(a.energy).toEqual([]); // sidelined
    expect(choice(game, "a").options).toEqual(["s:1", "s:2", "s:4"]);
    act("a", { type: "choose", picks: ["s:2"] });
    expect(a.library).toEqual([CURSE, STAR, "t1"]);
    expect(a.sideline).toEqual([KING, X("005"), W, SWELL, X("068")]);

    // Nothing suitable in the sideline: it cannot be used. A resting site cannot pay either.
    const empty = setup();
    const lone = field(empty.a, "energy", X("068"));
    empty.a.sideline.push(KING, W);
    expect(() => empty.act("a", { type: "activate", uid: lone.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    const tired = setup();
    const resting = field(tired.a, "energy", X("068"), true);
    tired.a.sideline.push(SWELL);
    expect(() => tired.act("a", { type: "activate", uid: resting.uid, ability: 1 })).toThrow("ABILITY_COST");
  });

  it("黑闪 (069): costs 1 AP less while 〈虎杖 悠仁〉 is on our field", () => {
    const { game, a, players } = setup();
    expect(costOf(game, players, ctx, "a", X("069")).ap).toBe(2);
    field(a, "energy", YUJI_YELLOW);
    expect(costOf(game, players, ctx, "a", X("069")).ap).toBe(1);
  });

  it("黑闪 (069): sidelines an opposing front character with BP 5000 or less; with 2 or more opposing BP4000+ characters left, up to 2 BP4000+ 咒术师 get BP+2000", () => {
    const { game, a, b, act } = setup();
    const victim = field(b, "front", GOJO_RED); // BP5000
    const big1 = withBp(b, "front", W, 2000); // 4000
    const big2 = withBp(b, "front", STAR, 1500); // 4000
    const small = field(b, "front", KING);
    const tooBig = withBp(b, "front", GOJO_RED, 1); // 5001: cannot be chosen
    const mine1 = field(a, "front", SORCERER_4000); // 4000, 咒术师
    const mine2 = field(a, "energy", GOJO_RED); // 5000, 咒术师
    const mine3 = field(a, "front", RED1); // 1500, 咒术师: too weak
    const mine4 = field(a, "front", W); // not a 咒术师
    useEvent(a, act, X("069"));
    expect(choice(game, "a").options).toEqual([victim.uid, big1.uid, big2.uid, small.uid]);
    expect(activeAp(a)).toBe(2); // 虎杖 悠仁 (a 咒术师 of ours) is on the field: the event cost 1 AP only
    act("a", { type: "choose", picks: [victim.uid] });
    expect(b.sideline).toEqual([GOJO_RED]);
    expect(choice(game, "a").options).toEqual([mine1.uid, mine2.uid]);
    act("a", { type: "choose", picks: [mine1.uid, mine2.uid] });
    expect(bpOf(ctx, mine1)).toBe(6000);
    expect(bpOf(ctx, mine2)).toBe(7000);
    expect(bpOf(ctx, mine3)).toBe(1500);
    expect(bpOf(ctx, mine4)).toBe(2000);
    expect(bpOf(ctx, tooBig)).toBe(5001);
  });

  it("黑闪 (069): the second part needs 2 or more BP4000+ characters after the first part; it can also pick none, or choose no target at all", () => {
    const one = setup();
    const victim = withBp(one.b, "front", W, 2000); // 4000
    withBp(one.b, "front", STAR, 1500); // 4000: only one left after the removal
    const mine = field(one.a, "front", SORCERER_4000);
    useEvent(one.a, one.act, X("069"));
    one.act("a", { type: "choose", picks: [victim.uid] });
    expect(one.game.pending).toBeNull();
    expect(bpOf(ctx, mine)).toBe(4000);

    const none = setup();
    withBp(none.b, "front", W, 2000);
    withBp(none.b, "front", STAR, 1500);
    withBp(none.b, "front", KING, 2500);
    const keeper = field(none.a, "front", SORCERER_4000);
    useEvent(none.a, none.act, X("069"));
    none.act("a", { type: "choose", picks: [] }); // up to 1: none sidelined
    expect(none.b.front).toHaveLength(3); // still 3 BP4000 characters
    none.act("a", { type: "choose", picks: [] }); // up to 2: none boosted
    expect(bpOf(ctx, keeper)).toBe(4000);
  });

  it("狱门疆 (070): costs 1 AP less with 〈夏油 杰〉 or 2 cards with 咒灵 / 咒胎九相图 on our front line", () => {
    const base = setup();
    expect(costOf(base.game, base.players, ctx, "a", X("070")).ap).toBe(2);
    const geto = setup();
    field(geto.a, "front", X("005"));
    expect(costOf(geto.game, geto.players, ctx, "a", X("070")).ap).toBe(1);
    const getoBack = setup();
    field(getoBack.a, "energy", X("005")); // not on the front line
    expect(costOf(getoBack.game, getoBack.players, ctx, "a", X("070")).ap).toBe(2);

    const mixed = setup();
    field(mixed.a, "front", CURSE);
    expect(costOf(mixed.game, mixed.players, ctx, "a", X("070")).ap).toBe(2); // only one
    field(mixed.a, "front", SWELL); // 咒灵 + 咒胎九相图 = 2
    expect(costOf(mixed.game, mixed.players, ctx, "a", X("070")).ap).toBe(1);
    const twoBack = setup();
    field(twoBack.a, "front", CURSE);
    field(twoBack.a, "energy", SWELL);
    expect(costOf(twoBack.game, twoBack.players, ctx, "a", X("070")).ap).toBe(2);
  });

  it("狱门疆 (070): puts an opposing front character with BP 5000 or less into the removal area; a character with BP exactly 5000 also draws 1", () => {
    const { game, a, b, act } = setup();
    const exact = field(b, "front", GOJO_RED); // 5000
    const small = field(b, "front", KING);
    withBp(b, "front", GOJO_RED, 1); // cannot be chosen
    a.library = [W, STAR];
    useEvent(a, act, X("070"));
    expect(choice(game, "a").options).toEqual([exact.uid, small.uid]);
    act("a", { type: "choose", picks: [exact.uid] });
    expect(b.removal).toEqual([GOJO_RED]);
    expect(a.hand).toEqual([W]);

    const second = setup();
    const weak = field(second.b, "front", KING);
    second.a.library = [W];
    useEvent(second.a, second.act, X("070"));
    expect(second.game.pending).toBeNull(); // the only possible target is chosen by itself
    expect(second.b.removal).toEqual([KING]);
    expect(second.a.hand).toEqual([]);

    const lowered = setup();
    const reduced = withBp(lowered.b, "front", GOJO_RED, -1000); // 4000 now
    lowered.a.library = [W];
    useEvent(lowered.a, lowered.act, X("070"));
    expect(lowered.b.removal).toEqual([GOJO_RED]);
    expect(lowered.a.hand).toEqual([]);
    void reduced;
  });

  it("不存在的记忆 (071): each of 〈胀相〉〈坏相〉〈血涂〉〈虎杖 悠仁〉 on our front line can get BP+1000; with 〈胀相〉 and one more, 〈胀相〉 gets 【冲击+1】 (a 【冲击①】 without impact)", () => {
    const { game, a, act } = setup();
    const swell = field(a, "front", SWELL);
    const decay = field(a, "front", DECAY);
    const yuji = field(a, "front", YUJI_YELLOW);
    const backYuji = field(a, "energy", YUJI_YELLOW); // not on the front line
    a.library = [W];
    useEvent(a, act, X("071"));
    expect(choice(game, "a").options).toEqual([swell.uid]);
    act("a", { type: "choose", picks: [swell.uid] });
    expect(choice(game, "a").options).toEqual([decay.uid]);
    act("a", { type: "choose", picks: [decay.uid] });
    expect(choice(game, "a").options).toEqual([yuji.uid]); // no 〈血涂〉 on the field: that question is skipped
    act("a", { type: "choose", picks: [yuji.uid] });
    expect(bpOf(ctx, swell)).toBe(2500);
    expect(bpOf(ctx, decay)).toBe(4500);
    expect(bpOf(ctx, yuji)).toBe(2000);
    expect(bpOf(ctx, backYuji)).toBe(1000);
    expect(impactOf(ctx, swell)).toBe(1); // 3 chosen: 冲击+1 on a card without impact gives 冲击①
    expect(a.hand).toEqual([W]); // 3 or more including 〈胀相〉: draw 1
  });

  it("不存在的记忆 (071): 2 chosen with 〈胀相〉 gives the impact but no card; without 〈胀相〉 only the BP change", () => {
    const two = setup();
    const swell = field(two.a, "front", SWELL);
    const blood = field(two.a, "front", BLOOD);
    two.a.library = [W];
    useEvent(two.a, two.act, X("071"));
    two.act("a", { type: "choose", picks: [swell.uid] });
    two.act("a", { type: "choose", picks: [blood.uid] }); // no 〈坏相〉 and no 〈虎杖 悠仁〉: those questions are skipped
    expect(two.game.pending).toBeNull();
    expect(impactOf(ctx, swell)).toBe(1);
    expect(bpOf(ctx, blood)).toBe(4000);
    expect(two.a.hand).toEqual([]);

    const noSwell = setup();
    const decay = field(noSwell.a, "front", DECAY);
    const blood2 = field(noSwell.a, "front", BLOOD);
    const yuji = field(noSwell.a, "front", YUJI_YELLOW);
    noSwell.a.library = [W];
    useEvent(noSwell.a, noSwell.act, X("071"));
    noSwell.act("a", { type: "choose", picks: [decay.uid] });
    noSwell.act("a", { type: "choose", picks: [blood2.uid] });
    noSwell.act("a", { type: "choose", picks: [yuji.uid] });
    expect(bpOf(ctx, decay)).toBe(4500);
    expect(bpOf(ctx, blood2)).toBe(4000);
    expect(bpOf(ctx, yuji)).toBe(2000);
    expect(noSwell.a.hand).toEqual([]);
  });

  it("不存在的记忆 (071): a 〈胀相〉 that already has impact gets 1 more damage; choosing only 〈胀相〉 gives BP+1000 and nothing else", () => {
    const { a, act } = setup();
    const swell = field(a, "front", SWELL);
    const decay = field(a, "front", DECAY);
    swell.grants = ["冲击1"];
    a.library = [W];
    useEvent(a, act, X("071"));
    act("a", { type: "choose", picks: [swell.uid] });
    act("a", { type: "choose", picks: [decay.uid] });
    expect(impactOf(ctx, swell)).toBe(2);

    const only = setup();
    const lone = field(only.a, "front", SWELL);
    only.a.library = [W];
    useEvent(only.a, only.act, X("071"));
    only.act("a", { type: "choose", picks: [lone.uid] });
    expect(bpOf(ctx, lone)).toBe(2500);
    expect(impactOf(ctx, lone)).toBe(0);
    expect(only.a.hand).toEqual([]);
  });

  it("迷你机械丸 (072): costs [红×3] less while 〈五条 悟〉 is in our removal area", () => {
    const { game, a, players } = setup();
    // The card's data energy cost is 0, so the cut is checked through the ability itself.
    const ability = JJK_6_ABILITIES[X("072")]![0]!;
    expect(ability.kind).toBe("cost");
    const env = { game, players, ctx, owner: a, opponent: players[1]!, self: null, selfCardId: X("072"), vars: {}, cause: null };
    expect(ability.kind === "cost" && ability.condition?.(env)).toBe(false);
    a.removal.push(KING);
    expect(ability.kind === "cost" && ability.condition?.(env)).toBe(false);
    a.removal.push(GOJO_RED);
    expect(ability.kind === "cost" && ability.condition?.(env)).toBe(true);
    expect(ability.kind === "cost" && ability.energy).toBe(3);
  });

  it("迷你机械丸 (072): draws 1, then puts up to 2 red 咒术师 (cost 3 or less, AP 1) from the hand onto the field resting", () => {
    const { game, a, act } = setup();
    a.library = [RED1, KING];
    a.hand.push(SORCERER_AP2, STAR, SORCERER_4000, KING);
    useEvent(a, act, X("072"));
    expect(a.hand).toEqual([SORCERER_AP2, STAR, SORCERER_4000, KING, RED1]);
    expect(choice(game, "a").options).toEqual(["h:2", "h:4"]); // not the AP 2 card, the non-咒术师 or the plain one
    act("a", { type: "choose", picks: ["h:2"] });
    act("a", { type: "choose", picks: ["line:front"] });
    expect(a.front.map((card) => card.cardId)).toEqual([SORCERER_4000]);
    expect(a.front[0]!.rested).toBe(true);
    expect(choice(game, "a").options).toEqual(["h:3"]); // RED1 now sits at index 3
    act("a", { type: "choose", picks: ["h:3"] });
    act("a", { type: "choose", picks: ["line:energy"] });
    expect(a.energy.map((card) => card.cardId)).toEqual([RED1]);
    expect(a.energy[0]!.rested).toBe(true);
    expect(a.hand).toEqual([SORCERER_AP2, STAR, KING]);
    expect(game.pending).toBeNull();
  });

  it("迷你机械丸 (072): up to 2 means we can stop after one or take none", () => {
    const one = setup();
    one.a.library = [KING];
    one.a.hand.push(SORCERER_4000, RED1);
    useEvent(one.a, one.act, X("072"));
    one.act("a", { type: "choose", picks: ["h:0"] });
    one.act("a", { type: "choose", picks: ["line:front"] });
    one.act("a", { type: "choose", picks: [] }); // no second card
    expect(one.game.pending).toBeNull();
    expect(one.a.front).toHaveLength(1);
    expect(one.a.hand).toEqual([RED1, KING]);

    const none = setup();
    none.a.library = [KING];
    none.a.hand.push(SORCERER_4000);
    useEvent(none.a, none.act, X("072"));
    none.act("a", { type: "choose", picks: [] });
    expect(none.game.pending).toBeNull();
    expect(none.a.front).toEqual([]);
    expect(none.a.hand).toEqual([SORCERER_4000, KING]);
  });

  it("领域展开 (073): switches up to 2 of our AP cards to active", () => {
    const { game, a, act } = setup();
    a.ap[1]!.rested = true;
    a.ap[2]!.rested = true;
    a.hand.push(X("073"));
    act("a", { type: "event", handIndex: 0 });
    expect(activeAp(a)).toBe(0); // the event's own AP is paid
    const options = choice(game, "a").options;
    expect(options).toHaveLength(3); // every resting AP card is offered
    act("a", { type: "choose", picks: options.slice(0, 2) });
    expect(activeAp(a)).toBe(2);
  });
});

describe("UA02ST (starter deck)", () => {
  it("钉崎 野蔷薇 (ST 044): puts back another cost 1 or less character of ours; with none, it returns itself (reprint of the UA02BT card)", () => {
    const { game, a, act } = setup();
    energy(a, 2, BLUE2);
    const cheap = field(a, "front", KING);
    a.hand.push(S("044"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(game.pending).toBeNull(); // the only possible card is put back by itself
    expect(a.hand).toEqual([KING]);
    expect(a.front.map((card) => card.cardId)).toEqual([S("044")]);

    const alone = setup();
    energy(alone.a, 2, BLUE2);
    field(alone.a, "front", GUARD); // cost 3: not eligible
    alone.a.hand.push(S("044"));
    alone.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(alone.a.hand).toEqual([S("044")]);
  });

  it("伏黑 (ST 056): 登场时 gives an opposing character with BP 1500 or more BP-1000 this turn", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, BLUE2);
    const strong = field(b, "front", W); // 2000
    const weak = withBp(b, "energy", KING, -500); // 1000: not eligible
    a.hand.push(S("056"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([strong.uid]);
    act("a", { type: "choose", picks: [strong.uid] });
    expect(bpOf(ctx, strong)).toBe(1000);
    expect(bpOf(ctx, weak)).toBe(1000);
  });

  it("夜蛾 正道 (ST 058): 启动主要 rests it and gives another character of ours BP+1000", () => {
    const { game, a, act } = setup();
    const nuke = field(a, "front", S("058"));
    const other = field(a, "front", KING);
    act("a", { type: "activate", uid: nuke.uid, ability: 0 });
    expect(nuke.rested).toBe(true);
    expect(game.pending).toBeNull(); // the only other character is chosen by itself
    expect(bpOf(ctx, other)).toBe(2500);
  });

  it("虎杖 悠仁 (ST 101): BP+1000 in the opponent's turn while 〈宿傩的手指〉 is in our sideline", () => {
    const { a, act } = setup("main", "b");
    const yuji = field(a, "front", S("101"));
    refresh(act, "b");
    expect(bpOf(ctx, yuji)).toBe(3000);
    a.sideline.push(FINGER);
    refresh(act, "b");
    expect(bpOf(ctx, yuji)).toBe(4000);
    // Not in our own turn.
    const own = setup();
    const mine = field(own.a, "front", S("101"));
    own.a.sideline.push(FINGER);
    refresh(own.act);
    expect(bpOf(ctx, mine)).toBe(3000);
  });

  it("五条 悟 (ST 103): 登场时 on the front line, the opponent puts one of their own front characters back into their hand; on the energy line nothing happens", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, GUARD); // 6 blue energy
    const x = field(b, "front", KING);
    const y = field(b, "front", W);
    const z = field(b, "energy", STAR);
    a.hand.push(S("103"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "b").options).toEqual([x.uid, y.uid]); // the opponent chooses, front line only
    act("b", { type: "choose", picks: [y.uid] });
    expect(b.hand).toEqual([W]);
    expect(b.front).toEqual([x]);
    expect(b.energy).toEqual([z]);

    const back = setup();
    energy(back.a, 3, GUARD);
    field(back.b, "front", KING);
    back.a.hand.push(S("103"));
    back.act("a", { type: "play", handIndex: 0, line: "energy" });
    expect(back.game.pending).toBeNull();
    expect(back.b.hand).toEqual([]);
  });

  it("五条 悟 (ST 103): 【冲击①】 comes from the card data", () => {
    const { a } = setup();
    expect(impactOf(ctx, field(a, "front", S("103")))).toBe(1);
  });

  it("佐佐木&井口 (ST 104): 攻击时 draws 1, then sidelines 1 card from the hand", () => {
    const { game, a, act } = setup("attack");
    const attacker = field(a, "front", S("104"));
    a.library = [W, KING];
    a.hand.push(STAR);
    act("a", { type: "attack", attackerUid: attacker.uid });
    expect(a.hand).toEqual([STAR, W]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:1"] });
    expect(a.hand).toEqual([STAR]);
    expect(a.sideline).toEqual([W]);
  });

  it("宿傩 (ST 105): in our turn BP+1000 with 1 or more 〈宿傩的手指〉 in the sideline, and 【冲击①】 with 2 or more", () => {
    const { a, act } = setup();
    const sukuna = field(a, "front", S("105"));
    refresh(act);
    expect(bpOf(ctx, sukuna)).toBe(4000);
    expect(impactOf(ctx, sukuna)).toBe(0);
    a.sideline.push(FINGER);
    refresh(act);
    expect(bpOf(ctx, sukuna)).toBe(5000);
    expect(impactOf(ctx, sukuna)).toBe(0);
    a.sideline.push(FINGER);
    refresh(act);
    expect(bpOf(ctx, sukuna)).toBe(5000);
    expect(impactOf(ctx, sukuna)).toBe(1);

    // Not in the opponent's turn.
    const away = setup("main", "b");
    const theirs = field(away.a, "front", S("105"));
    away.a.sideline.push(FINGER, FINGER);
    refresh(away.act, "b");
    expect(bpOf(ctx, theirs)).toBe(4000);
    expect(impactOf(ctx, theirs)).toBe(0);
  });

  it("宿傩 (ST 105): 登场时 draws 2 and sidelines 1 card from the hand", () => {
    const { game, a, act } = setup();
    energy(a, 3, BLUE2);
    a.library = [W, KING, "t1"];
    a.hand.push(S("105"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([STAR, W, KING]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([W, KING]);
    expect(a.sideline).toEqual([STAR]);
  });

  it("伏黑 惠 (ST 107): 登场时 puts an opposing character with BP 3000 or less (either line) back into their hand; up to 1 means none is allowed", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, BLUE2);
    const front = field(b, "front", W);
    const back = field(b, "energy", STAR);
    const big = withBp(b, "front", W, 1500); // 3500
    a.hand.push(S("107"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([front.uid, back.uid]);
    act("a", { type: "choose", picks: [back.uid] });
    expect(b.hand).toEqual([STAR]);
    expect(b.front).toEqual([front, big]);

    const declined = setup();
    energy(declined.a, 4, BLUE2);
    const kept = field(declined.b, "front", W);
    declined.a.hand.push(S("107"));
    declined.act("a", { type: "play", handIndex: 0, line: "front" });
    declined.act("a", { type: "choose", picks: [] });
    expect(declined.b.front).toEqual([kept]);
    expect(declined.b.hand).toEqual([]);
  });

  it("东京都立咒术高等专门学校 (ST 108): enters active; 启动主要 only after we used an event this turn: all our characters get BP+1000, once per turn", () => {
    const { a, act } = setup();
    energy(a, 3, GUARD);
    const site = play(a, act, S("108"), "energy");
    expect(site.rested).toBe(false);
    const mine = field(a, "front", KING);
    const back = field(a, "energy", W);
    expect(() => act("a", { type: "activate", uid: site.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    useEvent(a, act, X("073"));
    act("a", { type: "choose", picks: [] });
    act("a", { type: "activate", uid: site.uid, ability: 1 });
    expect(site.rested).toBe(true);
    expect(bpOf(ctx, mine)).toBe(2500);
    expect(bpOf(ctx, back)).toBe(3000);
    expect(() => act("a", { type: "activate", uid: site.uid, ability: 1 })).toThrow();
  });

  it("咒术高专1年 (ST 109): draws 3 cards, then sidelines 2 cards from the hand", () => {
    const { game, a, act } = setup();
    energy(a, 2, GUARD);
    a.library = [W, KING, STAR, "t1"];
    a.hand.push(S("109"));
    act("a", { type: "event", handIndex: 0 });
    expect(a.hand).toEqual([W, KING, STAR]);
    expect(choice(game, "a").options).toHaveLength(3);
    act("a", { type: "choose", picks: ["h:0", "h:2"] });
    expect(a.hand).toEqual([KING]);
    expect(a.sideline).toEqual([W, STAR, S("109")]);
  });
});

describe("UA02NC", () => {
  it("家入 硝子 (2-001): looks at 4, may take 〈五条 悟〉 or 〈夏油 杰〉 into the hand, the rest go to the bottom, then 1 hand card is sidelined", () => {
    const { game, a, act } = setup();
    energy(a, 1, YELLOW2);
    a.library = [KING, J("009"), W, X("005"), STAR, "t1"]; // 五条 悟, 夏油 杰 among the first 4
    a.hand.push(N("001"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:1", "l:3"]);
    act("a", { type: "choose", picks: ["l:3"] });
    expect(a.hand).toEqual([STAR, X("005")]);
    act("a", { type: "choose", picks: ["l:2", "l:0", "l:1"] }); // W, KING, 五条 悟 to the bottom in this order
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([X("005")]);
    expect(a.sideline).toEqual([STAR]);
    expect(a.library).toEqual([STAR, "t1", W, KING, J("009")]);
  });

  it("家入 硝子 (2-001): taking none leaves the hand alone", () => {
    const { game, a, act } = setup();
    energy(a, 1, YELLOW2);
    a.library = [KING, J("009"), W, X("005"), STAR];
    a.hand.push(N("001"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    act("a", { type: "choose", picks: [] });
    act("a", { type: "choose", picks: ["l:0", "l:1", "l:2", "l:3"] });
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([STAR]);
    expect(a.sideline).toEqual([]);
  });

  it("钉崎 野蔷薇 (2-002): with a resting character on the opponent's field, takes up to 1 cost 2 or less yellow event from the sideline into the hand", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, YELLOW2);
    field(b, "energy", KING, true);
    a.sideline.push(J("034"), J("031"), J("100"), KING, FINGER); // yellow event cost 3; yellow event cost 2; blue event; a character; blue event 宿傩的手指
    a.hand.push(N("002"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["s:1"]); // only the yellow event with cost 2 or less
    act("a", { type: "choose", picks: ["s:1"] });
    expect(a.hand).toEqual([J("031")]);
    expect(a.sideline).toEqual([J("034"), J("100"), KING, FINGER]);
    expect(game.pending).toBeNull();
  });

  it("钉崎 野蔷薇 (2-002): nothing happens when the opponent has no resting character, and taking none is allowed", () => {
    const none = setup();
    energy(none.a, 3, YELLOW2);
    field(none.b, "front", KING); // active
    none.a.sideline.push(J("031"));
    none.a.hand.push(N("002"));
    none.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(none.game.pending).toBeNull();
    expect(none.a.hand).toEqual([]);

    const decline = setup();
    energy(decline.a, 3, YELLOW2);
    field(decline.b, "front", KING, true);
    decline.a.sideline.push(J("031"));
    decline.a.hand.push(N("002"));
    decline.act("a", { type: "play", handIndex: 0, line: "front" });
    decline.act("a", { type: "choose", picks: [] });
    expect(decline.a.hand).toEqual([]);
    expect(decline.a.sideline).toEqual([J("031")]);
  });

  it("夏油 杰 (2-003): in our turn on the front line with 〈五条 悟〉 on the same line, it and every 〈五条 悟〉 on our front line get BP+500", () => {
    const { a, act } = setup();
    const geto = field(a, "front", N("003"));
    refresh(act);
    expect(bpOf(ctx, geto)).toBe(4000);
    const gojo = field(a, "front", J("010"));
    const gojoBack = field(a, "energy", J("010"));
    const other = field(a, "front", KING);
    refresh(act);
    expect(bpOf(ctx, geto)).toBe(4500);
    expect(bpOf(ctx, gojo)).toBe(4000);
    expect(bpOf(ctx, gojoBack)).toBe(3500);
    expect(bpOf(ctx, other)).toBe(1500);

    // On the energy line (or with 〈五条 悟〉 on the other line) there is no bonus.
    const back = setup();
    const resting = field(back.a, "energy", N("003"));
    const gojoFront = field(back.a, "front", J("010"));
    refresh(back.act);
    expect(bpOf(ctx, resting)).toBe(4000);
    expect(bpOf(ctx, gojoFront)).toBe(3500);
    const separate = setup();
    const lone = field(separate.a, "front", N("003"));
    field(separate.a, "energy", J("010"));
    refresh(separate.act);
    expect(bpOf(ctx, lone)).toBe(4000);

    // Not in the opponent's turn.
    const away = setup("main", "b");
    const theirs = field(away.a, "front", N("003"));
    field(away.a, "front", J("010"));
    refresh(away.act, "b");
    expect(bpOf(ctx, theirs)).toBe(4000);
  });

  it("夏油 杰 (2-003): 启动主要 sidelines a hand card; this turn it also makes energy on the front line; once per turn", () => {
    const { game, a, act } = setup();
    const geto = field(a, "front", N("003"));
    a.hand.push(STAR, W);
    expect(energyOf(ctx, a, "yellow")).toBe(0);
    act("a", { type: "activate", uid: geto.uid, ability: 1 });
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.sideline).toEqual([STAR]);
    expect(flagsOf(geto)).toContain("energyOnFront");
    expect(energyOf(ctx, a, "yellow")).toBe(1);
    expect(() => act("a", { type: "activate", uid: geto.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
    // The effect lasts this turn only.
    act("a", { type: "end_turn" });
    expect(flagsOf(geto)).not.toContain("energyOnFront");
    expect(() => {
      const empty = setup();
      const bare = field(empty.a, "front", N("003"));
      empty.act("a", { type: "activate", uid: bare.uid, ability: 1 });
    }).toThrow("ABILITY_COST");
  });

  it("五条 悟 (2-004): in our turn on the front line with 〈夏油 杰〉 on the same line it has 【伤害②】", () => {
    const { a, act } = setup();
    const gojo = field(a, "front", N("004"));
    refresh(act);
    expect(hasKeyword(ctx, gojo, "伤害2")).toBe(false);
    field(a, "energy", N("003"));
    refresh(act);
    expect(hasKeyword(ctx, gojo, "伤害2")).toBe(false); // other line
    field(a, "front", X("005"));
    refresh(act);
    expect(hasKeyword(ctx, gojo, "伤害2")).toBe(true);

    const away = setup("main", "b");
    const theirs = field(away.a, "front", N("004"));
    field(away.a, "front", X("005"));
    refresh(away.act, "b");
    expect(hasKeyword(ctx, theirs, "伤害2")).toBe(false);
  });

  it("五条 悟 (2-004): 退场时 looks at 3, may take 〈五条 悟〉 / 〈家入 硝子〉 / 〈夏油 杰〉 into the hand, the rest go to the bottom, then 1 hand card is sidelined", () => {
    const { game, a, act } = setup();
    const gojo = field(a, "front", N("004"));
    a.library = [KING, X("002"), W, "t1", "t2"]; // 家入 硝子 (X002) among the first 3
    a.hand.push(STAR);
    sidelineByHand(act, gojo);
    expect(choice(game, "a").options).toEqual(["l:1"]);
    act("a", { type: "choose", picks: ["l:1"] });
    expect(a.hand).toEqual([STAR, X("002")]);
    act("a", { type: "choose", picks: ["l:1", "l:0"] }); // W, KING
    act("a", { type: "choose", picks: ["h:1"] });
    expect(a.hand).toEqual([STAR]);
    expect(a.sideline).toEqual([N("004"), X("002")]);
    expect(a.library).toEqual(["t1", "t2", W, KING]);
  });

  it("伏黑 惠 (2-005): looks at 4, may reveal a 式神 character or 〈嵌合暗翳庭〉 and put it on top of the deck, the rest go to the bottom", () => {
    const { game, a, act } = setup();
    energy(a, 2, YELLOW2);
    a.library = [KING, SHIKIGAMI, W, STAR, "t1"];
    a.hand.push(N("005"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:1"]);
    act("a", { type: "choose", picks: ["l:1"] });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    act("a", { type: "choose", picks: ["m:0"] });
    act("a", { type: "choose", picks: ["l:2", "l:0", "l:1"] }); // STAR, KING, W to the bottom in this order
    expect(game.pending).toBeNull();
    expect(a.library).toEqual([SHIKIGAMI, "t1", STAR, KING, W]);
    expect(a.sideline).toEqual([]);
    expect(a.hand).toEqual([]);
  });

  it("伏黑 惠 (2-005): the revealed card can go to the sideline instead; 〈嵌合暗翳庭〉 counts too; taking none puts all 4 at the bottom", () => {
    const side = setup();
    energy(side.a, 2, YELLOW2);
    side.a.library = [DOMAIN, KING, W, STAR, "t1"];
    side.a.hand.push(N("005"));
    side.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(side.game, "a").options).toEqual(["l:0"]);
    side.act("a", { type: "choose", picks: ["l:0"] });
    side.act("a", { type: "choose", picks: ["m:1"] });
    side.act("a", { type: "choose", picks: ["l:0", "l:1", "l:2"] });
    expect(side.a.sideline).toEqual([DOMAIN]);
    expect(side.a.library).toEqual(["t1", KING, W, STAR]);

    const none = setup();
    energy(none.a, 2, YELLOW2);
    none.a.library = [KING, SHIKIGAMI, W, STAR, "t1"];
    none.a.hand.push(N("005"));
    none.act("a", { type: "play", handIndex: 0, line: "front" });
    none.act("a", { type: "choose", picks: [] });
    none.act("a", { type: "choose", picks: ["l:3", "l:2", "l:1", "l:0"] });
    expect(none.game.pending).toBeNull();
    expect(none.a.library).toEqual(["t1", STAR, W, SHIKIGAMI, KING]);
  });

  it("虎杖 悠仁 (2-006): its energy generation is +1 while 〈宿傩的手指〉 is in our sideline", () => {
    const { a, act } = setup();
    field(a, "energy", N("006"));
    refresh(act);
    expect(energyOf(ctx, a, "blue")).toBe(1);
    a.sideline.push(FINGER);
    refresh(act);
    expect(energyOf(ctx, a, "blue")).toBe(2);
  });

  it("宿傩 (2-007): enters active, has 【2次阻挡】, and BP+500 in our turn", () => {
    const { a, act } = setup();
    energy(a, 4, GUARD);
    a.hand.push(N("007"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const sukuna = a.front[0]!;
    expect(sukuna.rested).toBe(false);
    expect(hasKeyword(ctx, sukuna, "2次阻挡")).toBe(true);
    expect(bpOf(ctx, sukuna)).toBe(4000);

    const away = setup("main", "b");
    const theirs = field(away.a, "front", N("007"));
    refresh(away.act, "b");
    expect(bpOf(ctx, theirs)).toBe(3500);
    expect(hasKeyword(ctx, theirs, "2次阻挡")).toBe(true);
  });

  it("宿傩 (2-007): 攻击时 gives up to 1 opposing character with BP 1500 or more BP-1000, +1 character per 〈宿傩的手指〉 in the sideline", () => {
    const zero = setup("attack");
    const attacker = field(zero.a, "front", N("007"));
    const x = field(zero.b, "front", KING);
    const y = field(zero.b, "energy", W);
    const low = withBp(zero.b, "front", KING, -600); // 900: not eligible
    zero.act("a", { type: "attack", attackerUid: attacker.uid });
    expect(choice(zero.game, "a").options).toEqual([x.uid, y.uid]);
    zero.act("a", { type: "choose", picks: [x.uid] });
    expect(bpOf(ctx, x)).toBe(500);
    expect(bpOf(ctx, y)).toBe(2000);
    expect(bpOf(ctx, low)).toBe(900);

    const two = setup("attack");
    const hitter = field(two.a, "front", N("007"));
    two.a.sideline.push(FINGER, FINGER);
    const t1 = field(two.b, "front", KING);
    const t2 = field(two.b, "front", W);
    const t3 = field(two.b, "energy", STAR);
    const t4 = field(two.b, "energy", GUARD);
    two.act("a", { type: "attack", attackerUid: hitter.uid });
    expect(choice(two.game, "a").options).toHaveLength(4);
    expect(choice(two.game, "a").max).toBe(3); // 1 + 2 fingers
    two.act("a", { type: "choose", picks: [t1.uid, t3.uid, t4.uid] });
    expect(bpOf(ctx, t1)).toBe(500);
    expect(bpOf(ctx, t2)).toBe(2000);
    expect(bpOf(ctx, t3)).toBe(1500);
    expect(bpOf(ctx, t4)).toBe(2000);
  });

  it("宿傩 (2-007): with 4 fingers it takes up to 5; choosing none is allowed", () => {
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", N("007"));
    a.sideline.push(FINGER, FINGER, FINGER, FINGER);
    const targets = [KING, W, STAR, GUARD, KING, W].map((number) => field(b, "front", number));
    act("a", { type: "attack", attackerUid: attacker.uid });
    expect(choice(game, "a").max).toBe(5);
    act("a", { type: "choose", picks: [] });
    for (const target of targets) expect(bpOf(ctx, target)).toBe(ctx.card(target.cardId)!.bp);
    expect(game.pending?.kind).toBe("block");
  });

  it("七海 建人 (2-008): 退场时 may mill the top card; then up to 1 character of ours gets BP+1000", () => {
    const { game, a, act } = setup();
    const nanami = field(a, "front", N("008"));
    const other = field(a, "front", KING);
    a.library = [W, STAR];
    sidelineByHand(act, nanami);
    yes(act);
    expect(a.sideline).toEqual([N("008"), W]);
    expect(a.library).toEqual([STAR]);
    expect(choice(game, "a").options).toEqual([other.uid]);
    act("a", { type: "choose", picks: [other.uid] });
    expect(bpOf(ctx, other)).toBe(2500);

    const declined = setup();
    const gone = field(declined.a, "front", N("008"));
    const kept = field(declined.a, "front", KING);
    declined.a.library = [W];
    sidelineByHand(declined.act, gone);
    no(declined.act);
    expect(declined.a.library).toEqual([W]);
    expect(bpOf(ctx, kept)).toBe(1500);

    const nobody = setup();
    const lone = field(nobody.a, "front", N("008"));
    const target = field(nobody.a, "energy", KING);
    nobody.a.library = [W];
    sidelineByHand(nobody.act, lone);
    yes(nobody.act);
    nobody.act("a", { type: "choose", picks: [] }); // up to 1: none
    expect(bpOf(ctx, target)).toBe(1500);
    expect(nobody.a.sideline).toEqual([N("008"), W]);
  });

  it("东堂 葵 (2-010): 启动主要 swaps places with a 京都校 character on the other line, once per turn", () => {
    const { game, a, act } = setup();
    const aoi = field(a, "front", N("010"));
    const sameLine = field(a, "front", KYOTO_A); // same line: not eligible
    const back = field(a, "energy", KYOTO_B);
    const plain = field(a, "energy", KING); // no 京都校
    act("a", { type: "activate", uid: aoi.uid, ability: 0 });
    expect(game.pending).toBeNull(); // the only possible partner is chosen by itself
    expect(a.front).toEqual([back, sameLine]);
    expect(a.energy).toEqual([aoi, plain]);
    expect(() => act("a", { type: "activate", uid: aoi.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });

  it("东堂 葵 (2-010): from the energy line it swaps with a 京都校 character on the front line; without a partner it cannot be used", () => {
    const { game, a, act } = setup();
    const aoi = field(a, "energy", N("010"));
    const front = field(a, "front", KYOTO_A);
    field(a, "front", KING);
    act("a", { type: "activate", uid: aoi.uid, ability: 0 });
    expect(game.pending).toBeNull();
    expect(a.front[0]).toBe(aoi);
    expect(a.energy[0]).toBe(front);

    const alone = setup();
    const lone = field(alone.a, "front", N("010"));
    field(alone.a, "front", KYOTO_A);
    field(alone.a, "energy", KING);
    expect(() => alone.act("a", { type: "activate", uid: lone.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
  });

  it("真人 (2-011): its energy generation is +1 in our turn once one of our characters was sidelined this turn", () => {
    const { a, act } = setup();
    const mahito = field(a, "energy", N("011"));
    const victim = field(a, "front", KING);
    refresh(act);
    expect(energyOf(ctx, a, "purple")).toBe(1);
    sidelineByHand(act, victim);
    refresh(act);
    expect(energyOf(ctx, a, "purple")).toBe(2);
    expect(bpOf(ctx, mahito)).toBe(2500);

    // The opponent's characters do not count.
    const theirs = setup();
    field(theirs.a, "energy", N("011"));
    const enemy = field(theirs.b, "front", KING);
    theirs.act("a", { type: "manual", manual: { op: "field", owner: "opponent", uid: enemy.uid, act: "sideline" } });
    refresh(theirs.act);
    expect(energyOf(ctx, theirs.a, "purple")).toBe(1);
  });

  it("真人 (2-011): 启动主要 sidelines a character other than 〈真人〉; if that happened, a 咒灵 / 改造人类 of ours gets BP+1000; once per turn", () => {
    const { game, a, act } = setup();
    const mahito = field(a, "front", N("011"));
    const fodder = field(a, "front", KING);
    const curse = field(a, "energy", X("010"));
    const plain = field(a, "energy", W);
    act("a", { type: "activate", uid: mahito.uid, ability: 1 });
    expect(choice(game, "a").options).toEqual([fodder.uid, curse.uid, plain.uid]); // not the 〈真人〉
    act("a", { type: "choose", picks: [fodder.uid] });
    expect(a.sideline).toEqual([KING]);
    expect(choice(game, "a").options).toEqual([curse.uid]); // only the 咒灵 card (the data lists no trait for this 〈真人〉)
    act("a", { type: "choose", picks: [curse.uid] });
    expect(bpOf(ctx, curse)).toBe(4000); // 虹龙 BP3000
    expect(bpOf(ctx, plain)).toBe(2000);
    expect(() => act("a", { type: "activate", uid: mahito.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
  });

  it("真人 (2-011): the BP boost can be skipped; with nothing else to sideline the ability cannot be used", () => {
    const skip = setup();
    const mahito = field(skip.a, "front", N("011"));
    const fodder = field(skip.a, "front", KING);
    const curse = field(skip.a, "energy", X("010"));
    skip.act("a", { type: "activate", uid: mahito.uid, ability: 1 });
    skip.act("a", { type: "choose", picks: [fodder.uid] });
    skip.act("a", { type: "choose", picks: [] });
    expect(bpOf(ctx, curse)).toBe(3000);

    const alone = setup();
    const lone = field(alone.a, "front", N("011"));
    field(alone.a, "energy", X("067")); // another 〈真人〉 does not count either
    expect(() => alone.act("a", { type: "activate", uid: lone.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
  });
});
