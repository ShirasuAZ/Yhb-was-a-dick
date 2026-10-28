/**
 * KMY (鬼灭之刃) cards, batch 5 (EX05BT/KMY-3-033 .. 066: blue 柱 and 日轮刀 sites, purple 上弦之鬼, yellow 炭治郎 team): one test per card, set up as
 * its printed text describes and checked against the text. Card text comes from `Cards/cards.json` (no card images exist on this machine).
 */
import { describe, expect, it } from "vitest";
import { bpOf, canBlock, costOf, energyOf, flagsOf, hasKeyword, impactOf } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { KMY_5_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-kmy-5.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { choice, ctx, energy, field, FILLER, setup } from "./ability-harness.ts";

const k3 = (n: string): string => `EX05BT/KMY-3-${n}`;
const k1 = (n: string): string => `UA05BT/KMY-1-${n}`;
type Act = (who: string, action: Parameters<ReturnType<typeof setup>["act"]>[1]) => void;
const pick = (act: Act, who: string, picks: string[]): void => act(who, { type: "choose", picks });
const sidelineManually = (act: Act, who: string, owner: "you" | "opponent", uid: string): void => act(who, { type: "manual", manual: { op: "field", owner, uid, act: "sideline" } });
/** Lets the continuous abilities settle (the harness puts cards on the field directly): any action runs the engine's refresh. */
const refresh = (act: Act): void => act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "activate" } });
/** Ability indexes: a site has "此场地以活跃状态登场" (onPlay) first, then its 【启动主要】. */
const SITE_ACTIVATE = 1;

// Helper cards.
const BLUE_E = "UC01BT/ARK-1-039"; // 阿米娅: blue, cost 0, makes one blue energy
const AMIYA = "UCEX01BT/ARK-2-047"; // 阿米娅: purple, cost 0, makes one purple energy
const E2 = k1("050"); // 累: purple, makes two purple energy (a line holds at most 4 cards, so 5 energy needs these)
const W0 = "UC01BT/ARK-1-009"; // W: yellow, cost 0, BP2000
const MISHA = "UC01BT/ARK-1-001"; // 米莎: BP1000
const GUARD = "UC01ST/ARK-1-103"; // Guard: BP3000
const HOSHI = "UC01BT/ARK-1-092"; // 星熊: BP4000
// Cards of this title used as helpers.
const TANJIRO_BLUE = k3("014"); // 灶门 炭治郎 (blue, BP1500, no ability)
const MITSURI_BLUE = k3("030"); // 甘露寺 蜜璃 (blue, BP2000; only the keyword 冲击无效)
const MUICHIRO_BLUE = k3("035"); // 时透 无一郎 (blue, BP1500, no ability)
const TANJIRO_YELLOW = k1("005"); // 灶门 炭治郎 (yellow, BP1500, no ability)
const INOSUKE_YELLOW = k1("076"); // 嘴平 伊之助 (BP1500, no ability)
const ZENITSU_YELLOW = k1("068"); // 我妻 善逸 (BP1500, no ability)
const TANJIRO_SITE = k3("041");
const MITSURI_SITE = k3("042");
const MUICHIRO_SITE = k3("043");
const NEZUKO_BLUE = k3("018");
const FORGE_A = k3("028"); // 铁地河源 铁珍: 刀匠村
const FORGE_B = k3("025"); // 钢铁冢 萤: 刀匠村
const SUMIKO = k1("092"); // 炭子: also regarded as 〈灶门 炭治郎〉
const BOAR_GIRL = k1("091"); // 猪子: also regarded as 〈嘴平 伊之助〉
const ZENKO = k1("093"); // 善子: also regarded as 〈我妻 善逸〉
const WARIBIME = k1("060"); // 蕨姬: also regarded as 〈堕姬〉
const DAKI_RAID = k1("059"); // 堕姬 with 【突进】
const DAKI_PLAIN = k1("057"); // 堕姬 without 【突进】
const GIYUTARO = k1("053"); // 妓夫太郎
const RAIDED = (card: { under: string[] }): void => { card.under.push(FILLER); }; // makes a character 突进状态

/** Activates the 日轮刀 site `site` (already on the field) and answers nothing: the caller handles questions. */
const useSite = (act: Act, siteUid: string): void => act("a", { type: "activate", uid: siteUid, ability: SITE_ACTIVATE });

describe("KMY batch 5: the table", () => {
  it("has every card automated and the names the filters rely on", () => {
    for (const number of Object.keys(KMY_5_ABILITIES)) expect(isAutomated(titleCard(number)), number).toBe(true);
    expect(Object.keys(KMY_5_ABILITIES)).toHaveLength(32);
    expect(titleCard(MITSURI_SITE).name).toBe("日轮刀(甘露寺 蜜璃)");
    expect(titleCard(TANJIRO_SITE).name).toBe("日轮刀(灶门 炭治郎)");
    expect(titleCard(MITSURI_SITE).stats.affinities).toEqual(["日轮刀"]);
    expect(titleCard(k3("040")).stats.affinities).toEqual(["刀匠村"]);
    expect(titleCard(k3("049")).name).toBe("鬼舞辻 无惨");
    expect(titleCard(k3("060")).name).toBe("憎珀天");
    expect(titleCard(k1("060")).name).toBe("蕨姬");
  });
});

describe("KMY batch 5: blue 柱", () => {
  it("甘露寺 蜜璃 (033): makes one more blue energy while 〈日轮刀(甘露寺 蜜璃)〉 is on our field", () => {
    const { a, act } = setup();
    field(a, "energy", k3("033"));
    refresh(act);
    expect(energyOf(ctx, a, "blue")).toBe(1);
    field(a, "energy", MITSURI_SITE); // the site makes one blue energy itself
    refresh(act);
    expect(energyOf(ctx, a, "blue")).toBe(3);

    // Another 日轮刀 site does not count.
    const second = setup();
    field(second.a, "energy", k3("033"));
    field(second.a, "energy", TANJIRO_SITE);
    refresh(second.act);
    expect(energyOf(ctx, second.a, "blue")).toBe(2);
    // 2次阻挡 comes from the card data.
    expect(hasKeyword(ctx, second.a.energy[0]!, "2次阻挡")).toBe(true);
  });

  it("甘露寺 蜜璃 (034): 冲击无效; the opponent returns a card of their own front line; attacking, +1000 BP to another character; a 日轮刀 choice gives BP+1000 until our next turn", () => {
    const { game, a, b, act } = setup();
    energy(a, 5, BLUE_E);
    const first = field(b, "front", W0);
    const second = field(b, "front", GUARD);
    a.hand.push(k3("034"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    // The opponent picks which of their own front-line characters returns.
    expect(choice(game, "b").options).toEqual([first.uid, second.uid]);
    expect(choice(game, "b").min).toBe(1);
    pick(act, "b", [second.uid]);
    expect(b.hand).toEqual([GUARD]);
    expect(b.front).toEqual([first]);
    const mitsuri = a.front[0]!;
    expect(hasKeyword(ctx, mitsuri, "冲击无效")).toBe(true);

    // 【攻击时】: up to one other character gets BP+1000 (not itself).
    const t = setup("attack");
    const attacker = field(t.a, "front", k3("034"));
    const friend = field(t.a, "energy", W0);
    t.act("a", { type: "attack", attackerUid: attacker.uid });
    expect(choice(t.game, "a").options).toEqual([friend.uid]);
    pick(t.act, "a", [friend.uid]);
    expect(bpOf(ctx, friend)).toBe(3000);
    expect(bpOf(ctx, attacker)).toBe(4000);

    // Chosen by 日轮刀(甘露寺 蜜璃): site +1000, and its own reaction +1000 until our next turn.
    const u = setup();
    const target = field(u.a, "front", k3("034"));
    const site = field(u.a, "energy", MITSURI_SITE);
    useSite(u.act, site.uid);
    expect(site.rested).toBe(true);
    expect(bpOf(ctx, target)).toBe(6000);
    u.act("a", { type: "end_turn" });
    expect(bpOf(ctx, target)).toBe(5000); // the site's +1000 ended with the turn, the reaction lasts
  });

  it("时透 无一郎 (036): attacking, draws a card and then puts a hand card into the sideline", () => {
    const { game, a, act } = setup("attack");
    const muichiro = field(a, "front", k3("036"));
    a.library = [W0, GUARD];
    a.hand.push(MISHA);
    act("a", { type: "attack", attackerUid: muichiro.uid });
    expect(a.hand).toEqual([MISHA, W0]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([W0]);
    expect(a.sideline).toEqual([MISHA]);
  });

  it("时透 无一郎 (037): after a 日轮刀 effect chose it, moves to the other line once per turn; not otherwise", () => {
    const { a, act } = setup();
    const muichiro = field(a, "front", k3("037"));
    // Not chosen yet.
    expect(() => act("a", { type: "activate", uid: muichiro.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    const site = field(a, "energy", MUICHIRO_SITE);
    useSite(act, site.uid);
    act("a", { type: "activate", uid: muichiro.uid, ability: 0 });
    expect(a.front).toEqual([]);
    expect(a.energy).toContain(muichiro);
    expect(() => act("a", { type: "activate", uid: muichiro.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });

  it("时透 无一郎 (038): attacking after being chosen by a 日轮刀 effect, picks one of two debuffs; without it, nothing happens", () => {
    // Mode 1: one BP2500+ character gets BP-2000.
    const { game, a, b, act } = setup();
    const muichiro = field(a, "front", k3("038"));
    const site = field(a, "energy", MUICHIRO_SITE);
    const big = field(b, "front", GUARD); // 3000
    const mid = field(b, "front", W0); // 2000
    field(b, "front", MISHA); // 1000
    useSite(act, site.uid);
    act("a", { type: "next_phase" }); // attack phase
    act("a", { type: "attack", attackerUid: muichiro.uid });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    expect(choice(game, "a").options).toEqual([big.uid]);
    pick(act, "a", [big.uid]);
    expect(bpOf(ctx, big)).toBe(1000);
    expect(bpOf(ctx, mid)).toBe(2000);

    // Mode 2: up to two BP1500+ characters get BP-1000.
    const t = setup();
    const m2 = field(t.a, "front", k3("038"));
    const s2 = field(t.a, "energy", MUICHIRO_SITE);
    const x = field(t.b, "front", GUARD);
    const y = field(t.b, "front", W0);
    const z = field(t.b, "front", MISHA);
    useSite(t.act, s2.uid);
    t.act("a", { type: "next_phase" });
    t.act("a", { type: "attack", attackerUid: m2.uid });
    pick(t.act, "a", ["m:1"]);
    expect(choice(t.game, "a").options).toEqual([x.uid, y.uid]);
    expect(choice(t.game, "a").max).toBe(2);
    pick(t.act, "a", [x.uid, y.uid]);
    expect(bpOf(ctx, x)).toBe(2000);
    expect(bpOf(ctx, y)).toBe(1000);
    expect(bpOf(ctx, z)).toBe(1000);

    // Never chosen by a 日轮刀 effect: no question.
    const u = setup("attack");
    const m3 = field(u.a, "front", k3("038"));
    field(u.b, "front", GUARD);
    u.act("a", { type: "attack", attackerUid: m3.uid });
    expect(u.game.pending).toMatchObject({ kind: "block" });
  });

  it("时透 无一郎 (039): BP-2000 on entering; draws and BP-1000 on attacking; a 日轮刀 choice protects it until our next turn", () => {
    const { game, a, b, act } = setup();
    energy(a, 5, BLUE_E);
    const low = field(b, "front", MISHA); // 1000: too low
    const high = field(b, "front", GUARD);
    a.hand.push(k3("039"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([high.uid]);
    pick(act, "a", [high.uid]);
    expect(bpOf(ctx, high)).toBe(1000);
    expect(bpOf(ctx, low)).toBe(1000);

    const t = setup("attack");
    const attacker = field(t.a, "front", k3("039"));
    const enemy = field(t.b, "front", W0);
    t.a.library = [GUARD];
    t.act("a", { type: "attack", attackerUid: attacker.uid });
    expect(t.a.hand).toEqual([GUARD]);
    expect(choice(t.game, "a").options).toEqual([enemy.uid]);
    pick(t.act, "a", [enemy.uid]);
    expect(bpOf(ctx, enemy)).toBe(1000);

    // Chosen by 日轮刀(时透 无一郎).
    const u = setup();
    const target = field(u.a, "front", k3("039"));
    const site = field(u.a, "energy", MUICHIRO_SITE);
    useSite(u.act, site.uid);
    expect(flagsOf(target)).toEqual(expect.arrayContaining(["unblockableBpAtMost:3000", "untargetable:character", "unsnipeable"]));
    const weak = field(u.b, "front", GUARD); // BP3000
    const strong = field(u.b, "front", HOSHI); // BP4000
    expect(canBlock(ctx, target, weak)).toBe(false);
    expect(canBlock(ctx, target, strong)).toBe(true);
    // On the opponent's turn it still holds: a sniper cannot pick it.
    u.act("a", { type: "end_turn" });
    while (u.game.phase !== "attack") u.act("b", { type: "next_phase" });
    strong.grants = ["瞄准攻击"];
    expect(() => u.act("b", { type: "attack", attackerUid: strong.uid, targetUid: target.uid })).toThrow("INVALID_TARGET");
  });
});

describe("KMY batch 5: the 日轮刀 sites and 刀匠村", () => {
  it("刀匠村 (040): enters active; rests to look at 2 cards, may take one 刀匠村 / 日轮刀 card, the rest go to the bottom, then discards a card", () => {
    const { game, a, act } = setup();
    energy(a, 3, BLUE_E);
    a.hand.push(k3("040"));
    act("a", { type: "play", handIndex: 0, line: "energy" });
    const site = a.energy[a.energy.length - 1]!;
    expect(site.cardId).toBe(k3("040"));
    expect(site.rested).toBe(false);

    a.library = [GUARD, FORGE_A, W0];
    a.hand = [MISHA];
    useSite(act, site.uid);
    expect(site.rested).toBe(true);
    // Only the 刀匠村 / 日轮刀 cards can be revealed.
    expect(choice(game, "a").options).toEqual(["l:1"]);
    expect(choice(game, "a").max).toBe(1);
    pick(act, "a", ["l:1"]);
    // The other looked-at card goes to the bottom; adding a card means putting one hand card into the sideline.
    expect(a.hand).toEqual([MISHA, FORGE_A]);
    expect(a.library).toEqual([W0, GUARD]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([FORGE_A]);
    expect(a.sideline).toEqual([MISHA]);
    expect(() => useSite(act, site.uid)).toThrow("ABILITY_COST");

    // A 日轮刀 card counts too; taking none puts both at the bottom and discards nothing.
    const t = setup();
    const s2 = field(t.a, "energy", k3("040"));
    t.a.library = [TANJIRO_SITE, GUARD, W0];
    t.a.hand = [MISHA];
    useSite(t.act, s2.uid);
    expect(choice(t.game, "a").options).toEqual(["l:0"]);
    pick(t.act, "a", []);
    // Both cards go to the bottom in a chosen order.
    pick(t.act, "a", ["l:1", "l:0"]);
    expect(t.a.hand).toEqual([MISHA]);
    expect(t.a.library).toEqual([W0, GUARD, TANJIRO_SITE]);
    expect(t.a.sideline).toEqual([]);
  });

  it("日轮刀(灶门 炭治郎) (041): +1000 to a 〈灶门 炭治郎〉 (炭子 counts), then may look at the top card and put it on top or bottom; cannot pick a character already chosen", () => {
    const { game, a, act } = setup();
    const site = field(a, "energy", TANJIRO_SITE);
    const tanjiro = field(a, "front", TANJIRO_BLUE);
    const sumiko = field(a, "front", SUMIKO);
    field(a, "front", W0);
    a.library = [GUARD, HOSHI];
    useSite(act, site.uid);
    expect(choice(game, "a").options).toEqual([tanjiro.uid, sumiko.uid]);
    expect(choice(game, "a").min).toBe(1);
    pick(act, "a", [sumiko.uid]);
    expect(bpOf(ctx, sumiko)).toBe(3000);
    expect(bpOf(ctx, tanjiro)).toBe(1500);
    // 那之后，可以确认……
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:1"]);
    expect(a.library).toEqual([HOSHI, GUARD]); // the top card went to the bottom

    // A second site cannot pick the character already chosen by a 日轮刀 effect this turn.
    const site2 = field(a, "energy", TANJIRO_SITE);
    useSite(act, site2.uid); // the only candidate left is the other 炭治郎: chosen without a question
    expect(bpOf(ctx, tanjiro)).toBe(2500);
    pick(act, "a", ["no"]);
    const site3 = field(a, "energy", TANJIRO_SITE);
    expect(() => useSite(act, site3.uid)).toThrow("ABILITY_CONDITION");

    // Declining the look keeps the deck; with the card on top it stays on top.
    const t = setup();
    const s = field(t.a, "energy", TANJIRO_SITE);
    field(t.a, "front", TANJIRO_BLUE);
    t.a.library = [GUARD, HOSHI];
    useSite(t.act, s.uid);
    pick(t.act, "a", ["no"]);
    expect(t.a.library).toEqual([GUARD, HOSHI]);
    const u = setup();
    const s2 = field(u.a, "energy", TANJIRO_SITE);
    field(u.a, "front", TANJIRO_BLUE);
    u.a.library = [GUARD, HOSHI];
    useSite(u.act, s2.uid);
    pick(u.act, "a", ["yes"]);
    pick(u.act, "a", ["m:0"]);
    expect(u.a.library).toEqual([GUARD, HOSHI]);
    // No 炭治郎: the ability cannot be used.
    const v = setup();
    const s3 = field(v.a, "energy", TANJIRO_SITE);
    field(v.a, "front", W0);
    expect(() => useSite(v.act, s3.uid)).toThrow("ABILITY_CONDITION");
  });

  it("日轮刀(甘露寺 蜜璃) (042): BP+1000 to a 〈甘露寺 蜜璃〉; discarding a hand card makes it BP+2000 instead", () => {
    const { game, a, act } = setup();
    const site = field(a, "energy", MITSURI_SITE);
    const mitsuri = field(a, "front", MITSURI_BLUE);
    a.hand = [MISHA, W0];
    useSite(act, site.uid);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.sideline).toEqual([MISHA]);
    expect(bpOf(ctx, mitsuri)).toBe(4000);
    expect(flagsOf(mitsuri)).toContain("katanaChosen");

    const t = setup();
    const s2 = field(t.a, "energy", MITSURI_SITE);
    const m2 = field(t.a, "front", MITSURI_BLUE);
    t.a.hand = [MISHA];
    useSite(t.act, s2.uid);
    pick(t.act, "a", ["no"]);
    expect(bpOf(ctx, m2)).toBe(3000);
    expect(t.a.hand).toEqual([MISHA]);

    // No hand card: no question, BP+1000.
    const u = setup();
    const s3 = field(u.a, "energy", MITSURI_SITE);
    const m3 = field(u.a, "front", MITSURI_BLUE);
    useSite(u.act, s3.uid);
    expect(u.game.pending).toBeNull();
    expect(bpOf(ctx, m3)).toBe(3000);
    // Not usable without a 〈甘露寺 蜜璃〉.
    const v = setup();
    const s4 = field(v.a, "energy", MITSURI_SITE);
    field(v.a, "front", TANJIRO_BLUE);
    expect(() => useSite(v.act, s4.uid)).toThrow("ABILITY_CONDITION");
  });

  it("日轮刀(时透 无一郎) (043): BP+1000 and cannot be blocked by BP2000 or lower this turn", () => {
    const { a, b, act } = setup();
    const site = field(a, "energy", MUICHIRO_SITE);
    const muichiro = field(a, "front", MUICHIRO_BLUE);
    const weak = field(b, "front", W0); // 2000
    const stronger = field(b, "front", GUARD); // 3000
    useSite(act, site.uid);
    expect(bpOf(ctx, muichiro)).toBe(2500);
    expect(canBlock(ctx, muichiro, weak)).toBe(false);
    expect(canBlock(ctx, muichiro, stronger)).toBe(true);
    // Chosen once: the same character cannot be chosen again by another site.
    const site2 = field(a, "energy", MUICHIRO_SITE);
    expect(() => useSite(act, site2.uid)).toThrow("ABILITY_CONDITION");
    act("a", { type: "end_turn" });
    expect(flagsOf(muichiro)).not.toContain("unblockableBpAtMost:2000");
  });
});

describe("KMY batch 5: blue events", () => {
  it("斑纹 (044): makes up to two AP cards active", () => {
    const { game, a, act } = setup();
    energy(a, 3, BLUE_E);
    a.ap.forEach((card) => { card.rested = true; });
    a.ap[2]!.rested = false;
    a.hand.push(k3("044"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").max).toBe(2);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", ["ap:a:ap0", "ap:a:ap1"]);
    expect(a.ap.map((card) => card.rested)).toEqual([false, false, true]);
    expect(a.sideline).toEqual([k3("044")]);

    const t = setup();
    energy(t.a, 3, BLUE_E);
    t.a.hand.push(k3("044"));
    t.act("a", { type: "event", handIndex: 0 });
    pick(t.act, "a", []);
    expect(t.a.ap.filter((card) => card.rested)).toHaveLength(1);
  });

  it("圆舞一闪 (045): sidelines a front-line character with BP 3000 or less; 4000 with 〈灶门 炭治郎〉 (炭子 counts); 5000 with 〈日轮刀(灶门 炭治郎)〉 too", () => {
    const build = (setupMore: (t: ReturnType<typeof setup>) => void) => {
      const t = setup();
      energy(t.a, 3, BLUE_E);
      setupMore(t);
      const three = field(t.b, "front", GUARD);
      const four = field(t.b, "front", HOSHI);
      const five = field(t.b, "front", HOSHI);
      five.bpMod = 1000;
      const six = field(t.b, "front", HOSHI);
      six.bpMod = 2000;
      t.a.hand.push(k3("045"));
      t.act("a", { type: "event", handIndex: 0 });
      return { ...t, three, four, five, six };
    };
    // Only one character can be chosen (BP3000): it is chosen without a question and sidelined.
    const base = build(() => {});
    expect(base.game.pending).toBeNull();
    expect(base.b.sideline).toEqual([GUARD]);
    expect(base.a.sideline).toEqual([k3("045")]);

    const withTanjiro = build((t) => { field(t.a, "front", SUMIKO); });
    expect(choice(withTanjiro.game, "a").options).toEqual([withTanjiro.three.uid, withTanjiro.four.uid]);

    // The site alone does not raise it.
    const siteOnly = build((t) => { field(t.a, "energy", TANJIRO_SITE); });
    expect(siteOnly.game.pending).toBeNull();
    expect(siteOnly.b.sideline).toEqual([GUARD]);

    const both = build((t) => { field(t.a, "front", TANJIRO_BLUE); field(t.a, "energy", TANJIRO_SITE); });
    expect(choice(both.game, "a").options).toEqual([both.three.uid, both.four.uid, both.five.uid]);
    pick(both.act, "a", [both.five.uid]);
    expect(both.b.sideline).toEqual([HOSHI]);
  });

  it("赫刀 (046): only for a character a 日轮刀 effect chose this turn: BP+1000, 冲击+1 or 伤害+1 of our choice, draw a card", () => {
    const { game, a, act } = setup();
    energy(a, 2, BLUE_E);
    const site = field(a, "energy", MITSURI_SITE);
    const mitsuri = field(a, "front", MITSURI_BLUE);
    const other = field(a, "front", W0);
    a.library = [GUARD];
    a.hand.push(k3("046"));
    // Before any 日轮刀 choice there is no legal target: the event cannot be used.
    expect(() => act("a", { type: "event", handIndex: 0 })).toThrow("EVENT_CONDITION");
    useSite(act, site.uid);
    pick(act, "a", ["no"]); // no discard: BP+1000
    act("a", { type: "event", handIndex: 0 });
    // The only chosen character is picked without a question; then the keyword.
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:1"]);
    expect(bpOf(ctx, mitsuri)).toBe(4000); // 2000 + site 1000 + 赫刀 1000
    expect(hasKeyword(ctx, mitsuri, "伤害+1")).toBe(true);
    expect(hasKeyword(ctx, mitsuri, "冲击+1")).toBe(false);
    expect(bpOf(ctx, other)).toBe(2000);
    expect(a.hand).toEqual([GUARD]);
    expect(a.sideline).toEqual([k3("046")]);

    // 冲击+1 gives 冲击① to a character without Impact.
    const t = setup();
    energy(t.a, 2, BLUE_E);
    const s2 = field(t.a, "energy", MITSURI_SITE);
    const m2 = field(t.a, "front", MITSURI_BLUE);
    t.a.library = [GUARD];
    t.a.hand.push(k3("046"));
    useSite(t.act, s2.uid);
    pick(t.act, "a", ["no"]);
    t.act("a", { type: "event", handIndex: 0 });
    pick(t.act, "a", ["m:0"]);
    expect(impactOf(ctx, m2)).toBe(1);
  });

  it("霞之呼吸 伍之型 霞云之海 (047): AP cost 1 less with 〈时透 无一郎〉; puts a front-line character with BP 5000 or less on the bottom of the opponent's deck", () => {
    const { game, a, b, players, act } = setup();
    expect(costOf(game, players, ctx, "a", k3("047")).ap).toBe(2);
    field(a, "energy", MUICHIRO_BLUE);
    expect(costOf(game, players, ctx, "a", k3("047")).ap).toBe(1);
    energy(a, 4, BLUE_E);
    const low = field(b, "front", HOSHI); // 4000
    const high = field(b, "front", HOSHI);
    high.bpMod = 1500; // 5500: too high
    b.library = [W0, MISHA];
    a.hand.push(k3("047"));
    act("a", { type: "event", handIndex: 0 });
    expect(a.ap.filter((card) => card.rested)).toHaveLength(1);
    // The only character that can be chosen (BP4000) is chosen without a question.
    expect(game.pending).toBeNull();
    expect(low.cardId).toBe(HOSHI);
    expect(b.library).toEqual([W0, MISHA, HOSHI]);
    expect(b.front).toEqual([high]);
    expect(b.sideline).toEqual([]);

    // Without 〈时透 无一郎〉 it costs 2 AP.
    const t = setup();
    energy(t.a, 4, BLUE_E);
    field(t.b, "front", MISHA);
    t.a.hand.push(k3("047"));
    t.act("a", { type: "event", handIndex: 0 });
    expect(t.a.ap.filter((card) => card.rested)).toHaveLength(2);
  });

  it("恋之呼吸 壹之型 初恋的战栗 (048): returns a front-line character with BP 5000 or less; with 〈甘露寺 蜜璃〉 draws a card and gives one 冲击+1", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, BLUE_E);
    const mitsuri = field(a, "front", MITSURI_BLUE);
    const other = field(a, "front", MITSURI_BLUE);
    const small = field(b, "front", GUARD);
    const big = field(b, "front", HOSHI);
    big.bpMod = 1500; // 5500: too high
    a.library = [W0];
    a.hand.push(k3("048"));
    act("a", { type: "event", handIndex: 0 });
    // The only character that can be chosen (BP3000) is returned without a question.
    expect(small.cardId).toBe(GUARD);
    expect(b.hand).toEqual([GUARD]);
    expect(a.hand).toEqual([W0]);
    expect(choice(game, "a").options).toEqual([mitsuri.uid, other.uid]);
    pick(act, "a", [other.uid]);
    expect(impactOf(ctx, other)).toBe(1);
    expect(impactOf(ctx, mitsuri)).toBe(0);

    // Without 〈甘露寺 蜜璃〉: only the return.
    const t = setup();
    energy(t.a, 4, BLUE_E);
    field(t.a, "front", W0);
    field(t.b, "front", GUARD);
    t.a.library = [W0];
    t.a.hand.push(k3("048"));
    t.act("a", { type: "event", handIndex: 0 });
    expect(t.b.hand).toEqual([GUARD]);
    expect(t.a.hand).toEqual([]);
    expect(t.game.pending).toBeNull();
  });
});

describe("KMY batch 5: purple", () => {
  it("鬼舞辻 无惨 (049): 冲击① with 15+ cards in the sideline; may sideline any number of other characters and draw as many; then once per turn puts a cheap purple character rested", () => {
    // Static 冲击①.
    const s = setup();
    const muzan = field(s.a, "front", k3("049"));
    s.a.sideline = Array(14).fill(FILLER);
    refresh(s.act);
    expect(impactOf(ctx, muzan)).toBe(0);
    s.a.sideline = Array(15).fill(FILLER);
    refresh(s.act);
    expect(impactOf(ctx, muzan)).toBe(1);

    const { game, a, act } = setup();
    energy(a, 3, E2);
    const one = field(a, "front", W0);
    const two = field(a, "front", MISHA);
    const three = field(a, "energy", GUARD);
    a.library = [HOSHI, W0, MISHA, GUARD];
    a.hand = [k3("049"), AMIYA, GUARD];
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(choice(game, "a").min).toBe(0);
    // Every other character on our field, but not the card itself.
    const muzanOnField = a.front[a.front.length - 1]!;
    expect(choice(game, "a").options).toEqual([...a.front, ...a.energy].filter((card) => card !== muzanOnField).map((card) => card.uid));
    expect(choice(game, "a").options).toEqual(expect.arrayContaining([one.uid, two.uid, three.uid]));
    pick(act, "a", [one.uid, three.uid]);
    expect(a.sideline).toEqual([W0, GUARD]);
    expect(a.hand).toEqual([AMIYA, GUARD, HOSHI, W0]); // two cards drawn
    const muzanCard = a.front[a.front.length - 1]!;
    expect(muzanCard.cardId).toBe(k3("049"));

    // 【启动主要】: now usable; the hand card must be a purple character, cost 3 or less, AP 1 (not GUARD).
    const candidates = a.hand.map((id, index) => (id === AMIYA ? `h:${index}` : null)).filter(Boolean);
    act("a", { type: "activate", uid: muzanCard.uid, ability: 2 });
    // The only legal card (the purple character) is chosen without a question; GUARD (blue) and HOSHI do not qualify.
    expect(candidates).toHaveLength(1);
    expect(choice(game, "a").options).toEqual(["line:front", "line:energy"]);
    pick(act, "a", ["line:front"]);
    const placed = a.front[a.front.length - 1]!;
    expect(placed.cardId).toBe(AMIYA);
    expect(placed.rested).toBe(true);
    expect(() => act("a", { type: "activate", uid: muzanCard.uid, ability: 2 })).toThrow("ONCE_PER_TURN");

    // Sidelining nobody (or declining) does not open the 【启动主要】.
    const t = setup();
    energy(t.a, 3, E2);
    field(t.a, "front", W0);
    t.a.hand = [k3("049"), AMIYA];
    t.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(t.act, "a", ["yes"]);
    pick(t.act, "a", []);
    expect(t.a.hand).toEqual([AMIYA]);
    const played = t.a.front[t.a.front.length - 1]!;
    expect(() => t.act("a", { type: "activate", uid: played.uid, ability: 2 })).toThrow("ABILITY_CONDITION");
    const u = setup();
    energy(u.a, 3, E2);
    u.a.hand = [k3("049")];
    u.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(u.act, "a", ["no"]);
    expect(u.a.sideline).toEqual([]);
  });

  it("妓夫太郎 (050): with 〈堕姬〉 on our field (蕨姬 counts), BP-1000 to a BP1500+ front-line character", () => {
    const { game, a, b, act } = setup();
    energy(a, 1, AMIYA);
    field(a, "energy", WARIBIME);
    const low = field(b, "front", MISHA); // 1000: not allowed
    const target = field(b, "front", W0);
    a.hand.push(k3("050"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([target.uid]);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(1000);
    expect(bpOf(ctx, low)).toBe(1000);

    // The real 堕姬 works as well; without one nothing happens.
    const t = setup();
    energy(t.a, 1, AMIYA);
    field(t.a, "energy", DAKI_PLAIN);
    const e1 = field(t.b, "front", W0);
    t.a.hand.push(k3("050"));
    t.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(t.act, "a", [e1.uid]);
    expect(bpOf(ctx, e1)).toBe(1000);
    const u = setup();
    energy(u.a, 1, AMIYA);
    field(u.b, "front", W0);
    u.a.hand.push(k3("050"));
    u.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(u.game.pending).toBeNull();
  });

  it("玉壶 (051): draws a card, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    a.library = [W0];
    a.hand = [k3("051"), MISHA];
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([MISHA, W0]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:1"]);
    expect(a.sideline).toEqual([W0]);
    expect(a.hand).toEqual([MISHA]);
  });

  it("玉壶 (052): entering, BP-1500 (BP-2500 if a character was sidelined this turn); attacking, draws and discards", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, AMIYA);
    const enemy = field(b, "front", HOSHI);
    a.hand.push(k3("052"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [enemy.uid]);
    expect(bpOf(ctx, enemy)).toBe(2500);

    const t = setup();
    energy(t.a, 4, AMIYA);
    const victim = field(t.b, "front", MISHA);
    const enemy2 = field(t.b, "front", HOSHI);
    sidelineManually(t.act, "a", "opponent", victim.uid);
    t.a.hand.push(k3("052"));
    t.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(t.act, "a", [enemy2.uid]);
    expect(bpOf(ctx, enemy2)).toBe(1500);

    const u = setup("attack");
    const attacker = field(u.a, "front", k3("052"));
    u.a.library = [GUARD];
    u.a.hand = [MISHA];
    u.act("a", { type: "attack", attackerUid: attacker.uid });
    expect(u.a.hand).toEqual([MISHA, GUARD]);
    pick(u.act, "a", ["h:0"]);
    expect(u.a.sideline).toEqual([MISHA]);
  });

  it("堕姬 (053): turns a front-line 堕姬 with 【突进】 that is not in Raid state active and goes under it (making it 突进状态)", () => {
    const { game, a, act } = setup();
    const self = field(a, "energy", k3("053"));
    const raidable = field(a, "front", DAKI_RAID, true);
    field(a, "front", DAKI_PLAIN); // no 【突进】
    const raided = field(a, "front", DAKI_RAID);
    RAIDED(raided); // already in Raid state
    act("a", { type: "activate", uid: self.uid, ability: 0 });
    // The only valid card is chosen without a question.
    expect(game.pending).toBeNull();
    expect(raidable.rested).toBe(false);
    expect(raidable.under).toEqual([k3("053")]);
    expect(a.energy).not.toContain(self);
    expect(a.front).toContain(raidable);

    // Nothing valid: cannot be used.
    const t = setup();
    const s2 = field(t.a, "front", k3("053"));
    field(t.a, "front", DAKI_PLAIN);
    const r2 = field(t.a, "front", DAKI_RAID);
    RAIDED(r2);
    expect(() => t.act("a", { type: "activate", uid: s2.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    // Two valid ones: asked.
    const u = setup();
    const s3 = field(u.a, "front", k3("053"));
    const x = field(u.a, "front", DAKI_RAID);
    const y = field(u.a, "front", DAKI_RAID);
    u.act("a", { type: "activate", uid: s3.uid, ability: 0 });
    expect(choice(u.game, "a").options).toEqual([x.uid, y.uid]);
    pick(u.act, "a", [y.uid]);
    expect(y.under).toEqual([k3("053")]);
    expect(x.under).toEqual([]);
  });

  it("堕姬 (054): with 〈妓夫太郎〉 BP-1000 to a BP1500+ character on entering; from the front line pays 1 AP once per turn to give a 〈妓夫太郎〉 冲击+1", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, AMIYA);
    field(a, "energy", GIYUTARO);
    const target = field(b, "front", W0);
    field(b, "front", MISHA);
    a.hand.push(k3("054"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([target.uid]);
    pick(act, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(1000);

    // 【启动主要】
    const t = setup();
    const daki = field(t.a, "front", k3("054"));
    const g = field(t.a, "energy", GIYUTARO);
    t.act("a", { type: "activate", uid: daki.uid, ability: 1 });
    expect(t.a.ap.filter((card) => card.rested)).toHaveLength(1);
    expect(t.game.pending).toBeNull(); // the only 妓夫太郎 is chosen
    expect(impactOf(ctx, g)).toBe(1);
    expect(() => t.act("a", { type: "activate", uid: daki.uid, ability: 1 })).toThrow("ONCE_PER_TURN");

    // On the energy line it cannot be used; no 妓夫太郎 on entering: nothing.
    const u = setup();
    const back = field(u.a, "energy", k3("054"));
    field(u.a, "front", GIYUTARO);
    expect(() => u.act("a", { type: "activate", uid: back.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    const v = setup();
    energy(v.a, 4, AMIYA);
    field(v.b, "front", W0);
    v.a.hand.push(k3("054"));
    v.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(v.game.pending).toBeNull();
  });

  it("半天狗 (055): when sidelined, takes one each of 哀绝 / 空喜 / 可乐 / 积怒 from the sideline, up to two enter rested, the rest go to the hand", () => {
    const { game, a, act } = setup();
    const hantengu = field(a, "front", k3("055"));
    const aizetsu = k3("056");
    const sekido = k3("057");
    const karaku = k3("058");
    const urogi = k3("059");
    a.sideline = [FILLER, aizetsu, aizetsu, sekido, FILLER, karaku, urogi];
    sidelineManually(act, "a", "you", hantengu.uid);
    // Two 哀绝 in the sideline: asked which one; the rest are chosen without a question.
    expect(choice(game, "a").options).toEqual(["s:1", "s:2"]);
    pick(act, "a", ["s:2"]);
    // Up to two of the four enter the field.
    expect(choice(game, "a").options).toEqual(["l:0", "l:1", "l:2", "l:3"]);
    expect(choice(game, "a").max).toBe(1);
    pick(act, "a", ["l:1"]); // 空喜
    expect(choice(game, "a").options).toEqual(["l:0", "l:2", "l:3"]);
    pick(act, "a", ["l:3"]); // 积怒
    // Each is put on a line of our choice, rested.
    pick(act, "a", ["line:energy"]);
    pick(act, "a", ["line:front"]);
    const onField = [...a.front, ...a.energy].map((card) => card.cardId).sort();
    expect(onField).toEqual([sekido, urogi].sort());
    expect([...a.front, ...a.energy].every((card) => card.rested)).toBe(true);
    // The other two go to the hand; the extra copy of 哀绝 and the other cards stay in the sideline.
    expect([...a.hand].sort()).toEqual([aizetsu, karaku].sort());
    expect(a.sideline.filter((id) => id === aizetsu)).toHaveLength(1);
    expect(a.sideline).toContain(k3("055"));

    // Taking none: all four go to the hand.
    const t = setup();
    const h2 = field(t.a, "front", k3("055"));
    t.a.sideline = [aizetsu, sekido, karaku, urogi];
    sidelineManually(t.act, "a", "you", h2.uid);
    pick(t.act, "a", []);
    pick(t.act, "a", []);
    expect([...t.a.hand].sort()).toEqual([aizetsu, sekido, karaku, urogi].sort());
    expect([...t.a.front, ...t.a.energy]).toEqual([]);

    // Only some of them in the sideline.
    const u = setup();
    const h3 = field(u.a, "front", k3("055"));
    u.a.sideline = [karaku, FILLER];
    sidelineManually(u.act, "a", "you", h3.uid);
    pick(u.act, "a", ["l:0"]);
    pick(u.act, "a", ["line:front"]);
    expect(u.a.front.map((card) => card.cardId)).toEqual([karaku]);
    expect(u.a.hand).toEqual([]);
    expect(u.game.pending).toBeNull();
  });

  it("哀绝 (056): sidelined by our effect, BP-1000 to a front-line character; not when sidelined by a manual operation", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, AMIYA);
    const aizetsu = field(a, "front", k3("056"));
    const enemy = field(b, "front", W0);
    a.hand.push(k1("064")); // 肃清: sidelines one of our characters
    act("a", { type: "event", handIndex: 0 });
    pick(act, "a", [aizetsu.uid]);
    pick(act, "a", ["ap:a:ap2"]); // 肃清's own second sentence: an AP card becomes active
    expect(choice(game, "a").options).toEqual([enemy.uid]);
    expect(choice(game, "a").min).toBe(0);
    pick(act, "a", [enemy.uid]);
    expect(bpOf(ctx, enemy)).toBe(1000);

    const t = setup();
    const z = field(t.a, "front", k3("056"));
    field(t.b, "front", W0);
    sidelineManually(t.act, "a", "you", z.uid);
    expect(t.game.pending).toBeNull();
  });

  it("空喜 (057): sidelined by our effect, draws a card; not when sidelined by a manual operation", () => {
    const { a, act } = setup();
    energy(a, 2, AMIYA);
    const sekido = field(a, "front", k3("057"));
    a.library = [W0, GUARD, MISHA];
    a.hand.push(k1("064"));
    act("a", { type: "event", handIndex: 0 });
    pick(act, "a", [sekido.uid]);
    pick(act, "a", ["ap:a:ap2"]);
    // 肃清 draws 2, then 空喜 (sidelined by our effect) draws 1.
    expect(a.hand).toEqual([W0, GUARD, MISHA]);
    expect(a.library).toEqual([]);
    const t = setup();
    const z = field(t.a, "front", k3("057"));
    t.a.library = [W0, GUARD];
    sidelineManually(t.act, "a", "you", z.uid);
    expect(t.a.hand).toEqual([]);
    expect(t.a.library).toEqual([W0, GUARD]);
  });

  it("可乐 (058): puts the top card of the deck into the sideline when it leaves; makes an AP card active only when 憎珀天 sidelined it", () => {
    const { game, a, act } = setup();
    const karaku = field(a, "front", k3("058"));
    a.library = [W0, GUARD];
    a.ap.forEach((card) => { card.rested = true; });
    sidelineManually(act, "a", "you", karaku.uid);
    expect(a.sideline).toEqual([k3("058"), W0]);
    expect(a.library).toEqual([GUARD]);
    expect(game.pending).toBeNull(); // not by 憎珀天: no AP question
  });

  it("憎珀天 (060): puts 哀绝 / 空喜 / 可乐 under itself face down, their 退场时 get the 憎珀天 bonuses, and it grows with the cards under it", () => {
    const { game, a, b, act } = setup();
    energy(a, 5, AMIYA);
    const aizetsu = field(a, "front", k3("056"));
    const sekido = field(a, "front", k3("057"));
    const karaku = field(a, "front", k3("058"));
    const enemy = field(b, "front", HOSHI);
    a.library = [W0, GUARD, MISHA, HOSHI];
    a.hand.push(k3("060"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    a.ap.forEach((card) => { card.rested = true; }); // 可乐 will make one AP card active again
    expect(choice(game, "a").options).toEqual([aizetsu.uid]);
    pick(act, "a", [aizetsu.uid]);
    pick(act, "a", [sekido.uid]);
    pick(act, "a", [karaku.uid]);
    const zohakuten = a.front[a.front.length - 1]!;
    expect(zohakuten.cardId).toBe(k3("060"));
    expect(zohakuten.faceDown).toEqual([k3("056"), k3("057"), k3("058")]);
    // They are not in the sideline: they are under the 憎珀天.
    expect(a.sideline.filter((id) => id === k3("056") || id === k3("057"))).toEqual([]);
    // 退场时 abilities, with the 憎珀天 bonuses: 哀绝 BP-2000, 空喜 draws 2, 可乐 mills 1 and makes an AP card active.
    const answered: string[] = [];
    for (let guard = 0; guard < 6 && game.pending; guard += 1) {
      const pending = choice(game, "a");
      if (pending.options.includes(enemy.uid)) { pick(act, "a", [enemy.uid]); answered.push("enemy"); }
      else if (pending.options.some((option) => option.startsWith("ap:"))) { pick(act, "a", [pending.options[0]!]); answered.push("ap"); }
      else pick(act, "a", [pending.options[0]!]);
    }
    expect(answered.sort()).toEqual(["ap", "enemy"]);
    expect(bpOf(ctx, enemy)).toBe(2000);
    expect(a.hand).toHaveLength(2); // 空喜 drew 2 (the library had 4)
    expect(a.library).toHaveLength(1); // 可乐 put one more card of the deck into the sideline
    expect(a.sideline).toHaveLength(1);
    expect([...a.hand, ...a.sideline, ...a.library].sort()).toEqual([W0, GUARD, MISHA, HOSHI].sort());
    expect(a.ap.filter((card) => !card.rested)).toHaveLength(1);
    // Three cards under it: BP+500, 伤害②, 2次阻挡 and 2次攻击.
    refresh(act);
    expect(bpOf(ctx, zohakuten)).toBe(4500);
    expect(hasKeyword(ctx, zohakuten, "伤害2")).toBe(true);
    expect(hasKeyword(ctx, zohakuten, "2次阻挡")).toBe(true);
    expect(hasKeyword(ctx, zohakuten, "2次攻击")).toBe(true);
  });

  it("憎珀天 (060): the effects come with the number of cards under it (1: 退场时 may re-enter rested; 2: 伤害② and 2次阻挡; 3: BP+500 and 2次攻击)", () => {
    const { game, a, act } = setup();
    const z = field(a, "front", k3("060"));
    refresh(act);
    expect(bpOf(ctx, z)).toBe(4000);
    expect(hasKeyword(ctx, z, "伤害2")).toBe(false);
    z.faceDown = [k3("056")];
    refresh(act);
    expect(hasKeyword(ctx, z, "伤害2")).toBe(false);
    z.faceDown = [k3("056"), k3("057")];
    refresh(act);
    expect(hasKeyword(ctx, z, "伤害2")).toBe(true);
    expect(hasKeyword(ctx, z, "2次阻挡")).toBe(true);
    expect(hasKeyword(ctx, z, "2次攻击")).toBe(false);
    expect(bpOf(ctx, z)).toBe(4000);
    z.faceDown = [k3("056"), k3("057"), k3("058")];
    refresh(act);
    expect(hasKeyword(ctx, z, "2次攻击")).toBe(true);
    expect(bpOf(ctx, z)).toBe(4500);

    // 退场时 with at least one card under it: may re-enter rested (the cards under it stay in the sideline).
    z.faceDown = [k3("056")];
    sidelineManually(act, "a", "you", z.uid);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    pick(act, "a", ["line:front"]);
    expect(a.front.map((card) => card.cardId)).toEqual([k3("060")]);
    expect(a.front[0]!.rested).toBe(true);
    expect(a.sideline).toEqual([k3("056")]);

    // Declining; and with nothing under it there is no question.
    const t = setup();
    const z2 = field(t.a, "front", k3("060"));
    z2.faceDown = [k3("057")];
    sidelineManually(t.act, "a", "you", z2.uid);
    pick(t.act, "a", ["no"]);
    expect(t.a.front).toEqual([]);
    expect(t.a.sideline).toEqual([k3("057"), k3("060")]);
    const u = setup();
    const z3 = field(u.a, "front", k3("060"));
    sidelineManually(u.act, "a", "you", z3.uid);
    expect(u.game.pending).toBeNull();
  });

  it("憎珀天 (060): picking only some (or none) of 哀绝 / 空喜 / 可乐; those that stay are not put under it", () => {
    const { game, a, act } = setup();
    energy(a, 5, AMIYA);
    const sekido = field(a, "front", k3("057"));
    a.library = [W0, GUARD, MISHA];
    a.hand.push(k3("060"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", [sekido.uid]);
    const z = a.front[a.front.length - 1]!;
    expect(z.faceDown).toEqual([k3("057")]);
    // Only 空喜 was there: its 退场时 (by 憎珀天) draws 2.
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([W0, GUARD]);

    const t = setup();
    energy(t.a, 5, AMIYA);
    field(t.a, "front", k3("056"));
    t.a.hand.push(k3("060"));
    t.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(t.act, "a", []);
    expect(t.a.front[t.a.front.length - 1]!.faceDown ?? []).toEqual([]);
    expect(t.a.front.map((card) => card.cardId)).toEqual([k3("056"), k3("060")]);
  });

  it("无惨的研究 (061): sidelines a front-line character with BP 3000 or less; 5000 with 5+ cards in our sideline", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, AMIYA);
    a.sideline = Array(4).fill(FILLER);
    const three = field(b, "front", GUARD);
    field(b, "front", HOSHI);
    a.hand.push(k3("061"));
    act("a", { type: "event", handIndex: 0 });
    // Only the BP3000 character can be chosen: no question.
    expect(game.pending).toBeNull();
    expect(three.cardId).toBe(GUARD);
    expect(b.sideline).toEqual([GUARD]);

    const t = setup();
    energy(t.a, 4, AMIYA);
    t.a.sideline = Array(5).fill(FILLER);
    const x = field(t.b, "front", GUARD);
    const y = field(t.b, "front", HOSHI);
    const z = field(t.b, "front", HOSHI);
    z.bpMod = 1500;
    t.a.hand.push(k3("061"));
    t.act("a", { type: "event", handIndex: 0 });
    expect(choice(t.game, "a").options).toEqual([x.uid, y.uid]);
    pick(t.act, "a", [y.uid]);
    expect(t.b.sideline).toEqual([HOSHI]);
  });
});

describe("KMY batch 5: yellow", () => {
  it("我妻 善逸 (062): BP+1000 while a 突进状态 〈灶门 炭治郎〉 or 〈嘴平 伊之助〉 is on our field", () => {
    const { a, act } = setup();
    const zenitsu = field(a, "front", k3("062"));
    refresh(act);
    expect(bpOf(ctx, zenitsu)).toBe(3000);
    const tanjiro = field(a, "front", TANJIRO_YELLOW); // not in Raid state
    refresh(act);
    expect(bpOf(ctx, zenitsu)).toBe(3000);
    RAIDED(tanjiro);
    refresh(act);
    expect(bpOf(ctx, zenitsu)).toBe(4000);

    const t = setup();
    const z2 = field(t.a, "front", k3("062"));
    const inosuke = field(t.a, "energy", INOSUKE_YELLOW);
    RAIDED(inosuke);
    refresh(t.act);
    expect(bpOf(ctx, z2)).toBe(4000);

    // 炭子 / 猪子 count by name; a Raided 善逸 does not.
    const u = setup();
    const z3 = field(u.a, "front", k3("062"));
    const boar = field(u.a, "front", BOAR_GIRL);
    RAIDED(boar);
    refresh(u.act);
    expect(bpOf(ctx, z3)).toBe(4000);
    const v = setup();
    const z4 = field(v.a, "front", k3("062"));
    const other = field(v.a, "front", ZENITSU_YELLOW);
    RAIDED(other);
    refresh(v.act);
    expect(bpOf(ctx, z4)).toBe(3000);
  });

  it("灶门 炭治郎 (063): rests and sidelines itself to give a 突进状态 〈我妻 善逸〉 冲击+1, or a 突进状态 〈嘴平 伊之助〉 伤害+1", () => {
    const { game, a, act } = setup();
    const tanjiro = field(a, "front", k3("063"));
    const zenitsu = field(a, "front", ZENITSU_YELLOW);
    RAIDED(zenitsu);
    const plain = field(a, "front", ZENITSU_YELLOW); // not Raided
    act("a", { type: "activate", uid: tanjiro.uid, ability: 0 });
    // Resting and leaving the field are the costs.
    expect(a.sideline).toEqual([k3("063")]);
    expect(a.front).not.toContain(tanjiro);
    expect(game.pending).toBeNull(); // the only 突进状态 善逸 is chosen
    expect(impactOf(ctx, zenitsu)).toBe(1);
    expect(impactOf(ctx, plain)).toBe(0);

    const t = setup();
    const t2 = field(t.a, "front", k3("063"));
    const inosuke = field(t.a, "front", INOSUKE_YELLOW);
    RAIDED(inosuke);
    const zenko = field(t.a, "energy", ZENKO); // 善子 counts as 善逸 but is not Raided: ability 0 cannot be used
    expect(() => t.act("a", { type: "activate", uid: t2.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    t.act("a", { type: "activate", uid: t2.uid, ability: 1 });
    expect(hasKeyword(ctx, inosuke, "伤害+1")).toBe(true);
    expect(zenko.cardId).toBe(ZENKO);

    // 善子 in Raid state counts as 〈我妻 善逸〉; a resting 炭治郎 cannot pay.
    const u = setup();
    const t3 = field(u.a, "front", k3("063"));
    const zenko2 = field(u.a, "front", ZENKO);
    RAIDED(zenko2);
    u.act("a", { type: "activate", uid: t3.uid, ability: 0 });
    expect(impactOf(ctx, zenko2)).toBe(1);
    const v = setup();
    const tired = field(v.a, "front", k3("063"), true);
    const zenitsu2 = field(v.a, "front", ZENITSU_YELLOW);
    RAIDED(zenitsu2);
    expect(() => v.act("a", { type: "activate", uid: tired.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("灶门 炭治郎 (064): looks at 5, takes up to one 〈我妻 善逸〉 and one 〈嘴平 伊之助〉 (善子 counts), discards a card if it took two; rests for BP+2000 to each", () => {
    const { game, a, act } = setup();
    a.library = [W0, ZENKO, GUARD, INOSUKE_YELLOW, MISHA, HOSHI];
    a.hand = [k3("064"), FILLER];
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:1"]);
    pick(act, "a", ["l:1"]);
    expect(choice(game, "a").options).toEqual(["l:3"]);
    pick(act, "a", ["l:3"]);
    expect(a.hand).toEqual([FILLER, ZENKO, INOSUKE_YELLOW]);
    // The other three look-at cards go to the bottom in the chosen order.
    pick(act, "a", ["l:2", "l:0", "l:1"]);
    expect(a.library).toEqual([HOSHI, MISHA, W0, GUARD]);
    // Two cards were added: a hand card goes to the sideline.
    expect(choice(game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    pick(act, "a", ["h:0"]);
    expect(a.sideline).toEqual([FILLER]);

    // Only one found: nothing to discard.
    const t = setup();
    t.a.library = [W0, ZENKO, GUARD, MISHA, HOSHI];
    t.a.hand = [k3("064")];
    t.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(t.act, "a", ["l:1"]); // no 〈嘴平 伊之助〉 among the 5 cards: nothing to choose for it
    pick(t.act, "a", ["l:3", "l:0", "l:1", "l:2"]);
    expect(t.a.hand).toEqual([ZENKO]);
    expect(t.game.pending).toBeNull();
    expect(t.a.library).toEqual([HOSHI, W0, GUARD, MISHA]);

    // 【启动主要】 from the front line: rests, BP+2000 to up to one of each.
    const u = setup();
    const tanjiro = field(u.a, "front", k3("064"));
    const zenitsu = field(u.a, "energy", ZENITSU_YELLOW);
    const inosuke = field(u.a, "energy", BOAR_GIRL);
    field(u.a, "energy", W0);
    u.act("a", { type: "activate", uid: tanjiro.uid, ability: 1 });
    expect(tanjiro.rested).toBe(true);
    pick(u.act, "a", [zenitsu.uid]);
    pick(u.act, "a", [inosuke.uid]);
    expect(bpOf(ctx, zenitsu)).toBe(3500);
    expect(bpOf(ctx, inosuke)).toBe(5000);
    expect(bpOf(ctx, tanjiro)).toBe(4000);
    // Not on the front line: refused.
    const v = setup();
    const back = field(v.a, "energy", k3("064"));
    expect(() => v.act("a", { type: "activate", uid: back.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    // Picking none is allowed.
    const w = setup();
    const t5 = field(w.a, "front", k3("064"));
    const z5 = field(w.a, "front", ZENITSU_YELLOW);
    w.act("a", { type: "activate", uid: t5.uid, ability: 1 });
    pick(w.act, "a", []);
    expect(bpOf(ctx, z5)).toBe(1500);
  });

  it("嘴平 伊之助 (065): enters active when a 突进状态 〈灶门 炭治郎〉 or 〈我妻 善逸〉 is on our field; otherwise it stays resting", () => {
    const { a, act } = setup();
    const tanjiro = field(a, "front", SUMIKO);
    RAIDED(tanjiro);
    a.hand.push(k3("065"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.front[a.front.length - 1]!.cardId).toBe(k3("065"));
    expect(a.front[a.front.length - 1]!.rested).toBe(false);

    const t = setup();
    const z = field(t.a, "front", ZENITSU_YELLOW);
    RAIDED(z);
    t.a.hand.push(k3("065"));
    t.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(t.a.front[t.a.front.length - 1]!.rested).toBe(false);

    // Not in Raid state / the wrong character: stays resting.
    const u = setup();
    field(u.a, "front", TANJIRO_YELLOW);
    const other = field(u.a, "front", INOSUKE_YELLOW);
    RAIDED(other);
    u.a.hand.push(k3("065"));
    u.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(u.a.front[u.a.front.length - 1]!.rested).toBe(true);
  });

  it("炼狱 槙寿郎 (066): attacking after a hand card was put into the sideline by an event or 〈炼狱 杏寿郎〉, BP+1000 or draw a card; not after other effects", () => {
    // By an event (好吃！好吃！好吃！: draws 2, discards 1).
    const { game, a, act } = setup();
    const makio = field(a, "front", k3("066"));
    a.library = [W0, GUARD, MISHA];
    a.hand = [k1("095"), HOSHI];
    act("a", { type: "event", handIndex: 0 });
    pick(act, "a", ["h:0"]);
    act("a", { type: "next_phase" });
    act("a", { type: "attack", attackerUid: makio.uid });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    expect(bpOf(ctx, makio)).toBe(4000);
    expect(a.hand).toHaveLength(2);

    // The draw option.
    const t = setup();
    const m2 = field(t.a, "front", k3("066"));
    t.a.library = [W0, GUARD, MISHA];
    t.a.hand = [k1("095"), HOSHI];
    t.act("a", { type: "event", handIndex: 0 });
    pick(t.act, "a", ["h:0"]);
    t.act("a", { type: "next_phase" });
    t.act("a", { type: "attack", attackerUid: m2.uid });
    const before = t.a.hand.length;
    pick(t.act, "a", ["m:1"]);
    expect(t.a.hand.length).toBe(before + 1);

    // By 〈炼狱 杏寿郎〉's own effect (entering: may discard a card to sideline an enemy).
    const u = setup();
    const m3 = field(u.a, "front", k3("066"));
    u.a.hand = [k1("090"), HOSHI];
    u.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(u.act, "a", ["yes"]); // the only hand card is put into the sideline
    expect(u.a.sideline).toEqual([HOSHI]);
    u.act("a", { type: "next_phase" });
    u.act("a", { type: "attack", attackerUid: m3.uid });
    expect(choice(u.game, "a").options).toEqual(["m:0", "m:1"]);

    // By the effect of another character (玉壶 draws and discards): does not count.
    const v = setup();
    const m4 = field(v.a, "front", k3("066"));
    v.a.library = [W0];
    v.a.hand = [k3("051"), MISHA];
    v.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(v.act, "a", ["h:0"]);
    v.act("a", { type: "next_phase" });
    v.act("a", { type: "attack", attackerUid: m4.uid });
    expect(v.game.pending).toMatchObject({ kind: "damage" });

    // Nothing discarded at all.
    const w = setup("attack");
    const m5 = field(w.a, "front", k3("066"));
    w.act("a", { type: "attack", attackerUid: m5.uid });
    expect(w.game.pending).toMatchObject({ kind: "damage" });
  });
});
