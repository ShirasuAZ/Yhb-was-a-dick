/**
 * JJK batch 4 (EX04BT/JJK-3-004 .. 035, the yellow / blue / purple cards of the extra booster): one test per card, set up as its printed text
 * describes and checked against the text. Card text comes from Cards/cards.json (no card art on this machine).
 */
import { describe, expect, it } from "vitest";
import { abilitiesOf, bpOf, costOf, energyOf, flagsOf, hasKeyword, impactOf, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import type { AbilityEnv, CostAbility } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/types.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { JJK_4_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-jjk-4.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";

const n = (suffix: string): string => `EX04BT/JJK-3-${suffix}`;
const J = (suffix: string): string => `UA02BT/JJK-1-${suffix}`;
// Helper cards without abilities (or with abilities that do not matter).
const KING = "UC01BT/ARK-1-004"; // yellow, cost 0, BP1500 (also the harness filler)
const W = "UC01BT/ARK-1-009"; // yellow, cost 0, BP2000
const STAR = "UC01BT/ARK-1-080"; // red, cost 1, BP2500
const GUARD = "UC01ST/ARK-1-103"; // blue, cost 3, BP3000, makes 2 blue energy
const GEN2 = J("003"); // yellow, makes 2 yellow energy
const PUR2 = J("092"); // 真人: purple, makes 2 purple energy
const RIKO = n("001"); // 天内 理子
const OKINAWA = n("011"); // 冲绳旅行 (event, 抽卡 trigger)
const SOU = n("012"); // 术式顺转「苍」 (event)
const FINGER = J("063"); // 宿傩的手指 (event)
const SUKUNA_OLD = J("047"); // 宿傩: blue, cost 5
const SHIKIGAMI_A = J("024"); // 玉犬:黑&白: yellow, 式神
const SHIKIGAMI_B = J("026"); // 鵺: yellow, 式神
const DOMAIN = J("027"); // 嵌合暗翳庭 (site)
const MIWA_OLD = J("083"); // 三轮 霞: purple, cost 2, 京都校, 登场时 draws 1
const MECHAMARU = J("074"); // 究极 机械丸: purple, cost 2, 京都校
const NANAMI_BASE = J("051"); // 七海 建人: blue, cost 0
const MAHITO_BASE = J("091"); // 真人: purple, cost 0, 咒灵

const BATCH = ["004", "005", "006", "007", "008", "009", "010", "011", "012", "013", "014", "015", "016", "017", "018", "019", "021", "022", "023", "024", "025", "026", "027", "028", "029", "030", "031", "032", "033", "034", "035"];

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
const returnByHand = (act: Act, card: UnionArenaFieldCard): void => act("a", { type: "manual", manual: { op: "field", owner: "you", uid: card.uid, act: "hand" } });
/** A card with its BP raised or lowered by `change` (this turn). */
function withBp(owner: EnginePlayer, line: "front" | "energy", number: string, change: number): UnionArenaFieldCard {
  const card = field(owner, line, number);
  card.bpMod = change;
  return card;
}
const activeAp = (player: EnginePlayer): number => player.ap.filter((card) => !card.rested).length;
/** A hand-made ability environment (for conditions the cost abilities of a 0-cost card hide). */
const envOf = (setupResult: ReturnType<typeof setup>, cardId: string): AbilityEnv => ({
  game: setupResult.game, players: setupResult.players, ctx, owner: setupResult.a, opponent: setupResult.b, self: null, selfCardId: cardId, vars: {}, cause: null
});

describe("batch coverage", () => {
  it("every card of the batch has an entry in the ability table and plays entirely by itself", () => {
    for (const suffix of BATCH) {
      expect(JJK_4_ABILITIES[n(suffix)], suffix).toBeDefined();
      expect(isAutomated(titleCard(n(suffix))), suffix).toBe(true);
    }
  });
});

describe("yellow", () => {
  it("黑井 美里 (004): 登场时 looks at 5, may take 〈天内 理子〉/〈冲绳旅行〉, rest to the bottom in the chosen order, then a hand card is sidelined", () => {
    const { game, a, act } = setup();
    a.library = [KING, RIKO, W, OKINAWA, STAR, "t1", "t2"];
    a.hand.push(n("004"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:1", "l:3"]);
    act("a", { type: "choose", picks: ["l:3"] });
    expect(a.hand).toEqual([STAR, OKINAWA]);
    expect(choice(game, "a").options).toHaveLength(4);
    act("a", { type: "choose", picks: ["l:3", "l:0", "l:1", "l:2"] }); // STAR, KING, RIKO, W to the bottom in this order
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]); // 加入手牌的场合: one hand card to the sideline
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([OKINAWA]);
    expect(a.sideline).toEqual([STAR]);
    expect(a.library).toEqual(["t1", "t2", STAR, KING, RIKO, W]);
  });

  it("黑井 美里 (004): nothing to take, or taking none, leaves the hand alone", () => {
    const { game, a, act } = setup();
    a.library = [KING, W, STAR, KING, W, "t1"];
    a.hand.push(n("004"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toHaveLength(5); // straight to ordering the five cards
    act("a", { type: "choose", picks: ["l:0", "l:1", "l:2", "l:3", "l:4"] });
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([STAR]);
    expect(a.sideline).toEqual([]);

    const second = setup();
    second.a.library = [RIKO, KING, W, STAR, KING, "t1"];
    second.a.hand.push(n("004"), STAR);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: [] }); // may take none
    second.act("a", { type: "choose", picks: ["l:0", "l:1", "l:2", "l:3", "l:4"] });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([STAR]);
    expect(second.a.sideline).toEqual([]);
  });

  it("夏油 杰 (005): BP+1000 in our turn on the front line with 〈五条 悟〉 on the same line, or with 〈天内 理子〉 in the sideline", () => {
    const { a, act } = setup();
    const geto = field(a, "front", n("005"));
    refresh(act);
    expect(bpOf(ctx, geto)).toBe(3000);
    const gojo = field(a, "energy", n("006")); // 五条 悟 on the other line: no
    refresh(act);
    expect(bpOf(ctx, geto)).toBe(3000);
    a.energy = [];
    field(a, "front", n("006"));
    refresh(act);
    expect(bpOf(ctx, geto)).toBe(4000);
    void gojo;

    const second = setup();
    const lone = field(second.a, "front", n("005"));
    second.a.sideline.push(RIKO);
    refresh(second.act);
    expect(bpOf(ctx, lone)).toBe(4000);

    // Only on the front line: with 理子 in the sideline but on the energy line, no bonus.
    const third = setup();
    const back = field(third.a, "energy", n("005"));
    third.a.sideline.push(RIKO);
    refresh(third.act);
    expect(bpOf(ctx, back)).toBe(3000);

    // Not in the opponent's turn.
    const fourth = setup("main", "b");
    const away = field(fourth.a, "front", n("005"));
    fourth.a.sideline.push(RIKO);
    refresh(fourth.act, "b");
    expect(bpOf(ctx, away)).toBe(3000);
  });

  it("夏油 杰 (005): 登场时 may pay 1 AP to put a cost 3 or less, AP 1 yellow 咒灵 from the sideline onto the field resting", () => {
    const { game, a, act } = setup();
    energy(a, 2, GEN2);
    a.sideline.push(n("010"), n("031"), W); // 虹龙 (yellow 咒灵, cost 2), 漏瑚 (purple 咒灵: wrong colour), a plain card
    a.hand.push(n("005"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["yes", "no"]);
    yes(act);
    expect(choice(game, "a").options).toEqual(["line:front", "line:energy"]);
    act("a", { type: "choose", picks: ["line:front"] });
    expect(a.front.map((card) => card.cardId)).toEqual([n("005"), n("010")]);
    expect(a.front[1]!.rested).toBe(true);
    expect(a.sideline).toEqual([n("031"), W]);
    expect(activeAp(a)).toBe(1); // 1 AP to play, 1 AP paid
  });

  it("夏油 杰 (005): declining the payment, or having no active AP left, does nothing", () => {
    const { game, a, act } = setup();
    energy(a, 2, GEN2);
    a.sideline.push(n("010"));
    a.hand.push(n("005"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    no(act);
    expect(game.pending).toBeNull();
    expect(a.sideline).toEqual([n("010")]);
    expect(activeAp(a)).toBe(2);

    const second = setup();
    energy(second.a, 2, GEN2);
    second.a.sideline.push(n("010"));
    second.a.ap[1]!.rested = true;
    second.a.ap[2]!.rested = true;
    second.a.hand.push(n("005"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull(); // no AP left: not even asked
    expect(second.a.sideline).toEqual([n("010")]);
  });

  it("五条 悟 (006): BP+1000 and 【冲击①】 in our turn on the front line with 〈夏油 杰〉 on the same line or 〈天内 理子〉 in the sideline", () => {
    const { a, act } = setup();
    const gojo = field(a, "front", n("006"));
    refresh(act);
    expect(bpOf(ctx, gojo)).toBe(4000);
    expect(impactOf(ctx, gojo)).toBe(0);
    field(a, "front", n("005"));
    refresh(act);
    expect(bpOf(ctx, gojo)).toBe(5000);
    expect(impactOf(ctx, gojo)).toBe(1);

    const second = setup();
    const alone = field(second.a, "front", n("006"));
    second.a.sideline.push(RIKO);
    refresh(second.act);
    expect(bpOf(ctx, alone)).toBe(5000);
    expect(impactOf(ctx, alone)).toBe(1);

    const third = setup();
    const back = field(third.a, "energy", n("006"));
    field(third.a, "energy", n("005"));
    refresh(third.act);
    expect(bpOf(ctx, back)).toBe(4000);
    expect(impactOf(ctx, back)).toBe(0);
  });

  it("五条 悟 (006): 登场时 looks at 3, may take 〈术式顺转「苍」〉/〈术式反转「赫」〉/〈虚式「茈」〉 and then sidelines a hand card", () => {
    const { game, a, act } = setup();
    energy(a, 3, GEN2);
    a.library = [SOU, KING, J("029"), "t1"];
    a.hand.push(n("006"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:0", "l:2"]);
    act("a", { type: "choose", picks: ["l:2"] });
    expect(a.hand).toEqual([STAR, J("029")]);
    act("a", { type: "choose", picks: ["l:1", "l:0"] }); // 苍 and KING to the bottom: KING first
    act("a", { type: "choose", picks: ["h:1"] }); // the card taken is sidelined itself
    expect(a.hand).toEqual([STAR]);
    expect(a.sideline).toEqual([J("029")]);
    expect(a.library).toEqual(["t1", KING, SOU]);
  });

  it("伏黑 惠 (007): 登场时 sidelines an opposing front character with BP at most (式神 and 〈嵌合暗翳庭〉 on our field)×1000", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GEN2);
    field(a, "energy", n("008")); // 脱兔: 式神
    field(a, "energy", DOMAIN);
    const small = field(b, "front", W); // BP 2000
    const tiny = field(b, "front", KING); // BP 1500
    field(b, "front", STAR); // BP 2500: too strong
    field(b, "energy", KING); // not on the front line
    a.hand.push(n("007"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options.sort()).toEqual([small.uid, tiny.uid].sort());
    act("a", { type: "choose", picks: [small.uid] });
    expect(b.front).not.toContain(small);
    expect(b.sideline).toEqual([W]);

    // No 式神 or site: the limit is 0, nothing can be chosen.
    const second = setup();
    energy(second.a, 2, GEN2);
    field(second.b, "front", KING);
    second.a.hand.push(n("007"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(second.b.front).toHaveLength(1);

    // May choose nobody.
    const third = setup();
    energy(third.a, 2, GEN2);
    field(third.a, "energy", DOMAIN);
    withBp(third.b, "front", KING, -500); // BP 1000
    third.a.hand.push(n("007"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    third.act("a", { type: "choose", picks: [] });
    expect(third.b.front).toHaveLength(1);
  });

  it("伏黑 惠 (007): when our 〈嵌合暗翳庭〉's 启动主要 is used, every 〈伏黑 惠〉 gets BP+1000 this turn, once per card per turn", () => {
    const { game, a, act } = setup();
    const megumi = field(a, "front", n("007"));
    const unrelated = field(a, "front", KING);
    const first = field(a, "energy", DOMAIN);
    const second = field(a, "energy", DOMAIN);
    // Another card's 启动主要 does not count.
    const yuji = field(a, "energy", J("001"));
    act("a", { type: "activate", uid: yuji.uid, ability: 0 });
    expect(bpOf(ctx, megumi)).toBe(4000);
    act("a", { type: "activate", uid: first.uid, ability: 0 });
    expect(game.pending).toBeNull();
    expect(bpOf(ctx, megumi)).toBe(5000);
    expect(bpOf(ctx, unrelated)).toBe(1500);
    // The second 〈嵌合暗翳庭〉 does not give it again (每回合1次).
    act("a", { type: "activate", uid: second.uid, ability: 0 });
    expect(bpOf(ctx, megumi)).toBe(5000);

    // All 〈伏黑 惠〉 on the field (either line) get the bonus; two of them each have the ability, so we order them.
    const two = setup();
    const m1 = field(two.a, "front", n("007"));
    const m2 = field(two.a, "energy", n("007"));
    const site = field(two.a, "energy", DOMAIN);
    two.act("a", { type: "activate", uid: site.uid, ability: 0 });
    expect(choice(two.game, "a").options).toHaveLength(2);
    two.act("a", { type: "choose", picks: [choice(two.game, "a").options[0]!] });
    expect(two.game.pending).toBeNull();
    expect(bpOf(ctx, m1)).toBe(6000); // each 〈伏黑 惠〉's ability gives every 〈伏黑 惠〉 +1000: 4000 + 2 x 1000
    expect(bpOf(ctx, m2)).toBe(6000);
    // A second 〈嵌合暗翳庭〉 in the same turn: both already used it, nothing is queued, nothing to order.
    const again = field(two.a, "energy", DOMAIN);
    two.act("a", { type: "activate", uid: again.uid, ability: 0 });
    expect(two.game.pending).toBeNull();
    expect(bpOf(ctx, m1)).toBe(6000);
    expect(bpOf(ctx, m2)).toBe(6000);
  });

  it("脱兔 (008): when it is put back into the hand from the field, we may switch one of our 式神 to active", () => {
    const { game, a, act } = setup();
    const hare = field(a, "front", n("008"));
    const dog = field(a, "energy", SHIKIGAMI_A, true);
    const plain = field(a, "energy", KING, true);
    returnByHand(act, hare);
    expect(a.hand).toEqual([n("008")]);
    expect(choice(game, "a").options).toEqual([dog.uid]); // only a 式神 can be chosen
    act("a", { type: "choose", picks: [dog.uid] });
    expect(dog.rested).toBe(false);
    expect(plain.rested).toBe(true);

    // Choosing nobody is allowed.
    const second = setup();
    const hare2 = field(second.a, "front", n("008"));
    const dog2 = field(second.a, "energy", SHIKIGAMI_A, true);
    returnByHand(second.act, hare2);
    second.act("a", { type: "choose", picks: [] });
    expect(dog2.rested).toBe(true);
  });

  it("满象 (009): produces energy on the front line as well", () => {
    const { a, act } = setup();
    const elephant = field(a, "front", n("009"));
    refresh(act);
    expect(flagsOf(elephant)).toContain("energyOnFront");
    expect(energyOf(ctx, a, "yellow")).toBe(1);
    a.front = [];
    field(a, "front", KING);
    refresh(act);
    expect(energyOf(ctx, a, "yellow")).toBe(0);
  });

  it("满象 (009): 登场时 puts one other 式神 back into the hand; with none, it returns itself (and 脱兔 reacts to being returned)", () => {
    const { game, a, act } = setup();
    energy(a, 2, GEN2);
    const dogA = field(a, "front", SHIKIGAMI_A);
    field(a, "front", SHIKIGAMI_B);
    field(a, "front", KING); // not a 式神
    a.hand.push(n("009"));
    act("a", { type: "play", handIndex: 0, line: "energy" });
    expect(choice(game, "a").options).toHaveLength(2);
    act("a", { type: "choose", picks: [dogA.uid] });
    expect(a.hand).toEqual([SHIKIGAMI_A]);
    expect(a.energy.map((card) => card.cardId)).toContain(n("009")); // 满象 itself stays

    const second = setup();
    energy(second.a, 2, GEN2);
    field(second.a, "front", KING);
    second.a.hand.push(n("009"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([n("009")]);
    expect(second.a.front.map((card) => card.cardId)).toEqual([KING]);

    // 脱兔 returned this way switches a resting 式神 to active.
    const third = setup();
    energy(third.a, 2, GEN2);
    third.a.energy.forEach((card) => { card.rested = false; });
    field(third.a, "front", n("008"));
    const resting = field(third.a, "front", SHIKIGAMI_B, true);
    third.a.hand.push(n("009"));
    third.act("a", { type: "play", handIndex: 0, line: "energy" });
    // 脱兔 is the only other 式神 besides 鵺 (two options): return 脱兔.
    const hare = third.a.front.find((card) => card.cardId === n("008"))!;
    third.act("a", { type: "choose", picks: [hare.uid] });
    expect(third.a.hand).toEqual([n("008")]);
    expect(resting.rested).toBe(true);
    // The ability of 脱兔 now asks which 式神 to switch to active: 鵺 or 满象.
    const options = choice(third.game, "a").options;
    expect(options).toContain(resting.uid);
    third.act("a", { type: "choose", picks: [resting.uid] });
    expect(resting.rested).toBe(false);
  });

  it("虹龙 (010): BP+1000 in the opponent's turn while 〈夏油 杰〉 is on our field", () => {
    const { a, act } = setup("main", "b");
    const dragon = field(a, "front", n("010"));
    refresh(act, "b");
    expect(bpOf(ctx, dragon)).toBe(3000);
    field(a, "energy", n("005"));
    refresh(act, "b");
    expect(bpOf(ctx, dragon)).toBe(4000);

    // In our own turn, no bonus.
    const second = setup();
    const own = field(second.a, "front", n("010"));
    field(second.a, "energy", n("005"));
    refresh(second.act);
    expect(bpOf(ctx, own)).toBe(3000);
  });

  it("冲绳旅行 (011): looks at 5, takes up to 2 of 〈五条 悟〉/〈夏油 杰〉/〈天内 理子〉, the rest goes to the bottom in the chosen order", () => {
    const { game, a, act } = setup();
    energy(a, 2, GEN2);
    a.library = [n("006"), KING, n("005"), RIKO, W, "t1"];
    useEvent(a, act, OKINAWA);
    expect(choice(game, "a").options).toEqual(["l:0", "l:2", "l:3"]);
    act("a", { type: "choose", picks: ["l:0", "l:3"] });
    expect(a.hand).toEqual([n("006"), RIKO]);
    expect(choice(game, "a").options).toHaveLength(3);
    act("a", { type: "choose", picks: ["l:2", "l:1", "l:0"] }); // W, 夏油, KING
    expect(a.library).toEqual(["t1", W, n("005"), KING]);

    // Only one, or none, can be taken as well.
    const second = setup();
    energy(second.a, 2, GEN2);
    second.a.library = [n("006"), KING, W, STAR, KING, "t1"];
    useEvent(second.a, second.act, OKINAWA);
    second.act("a", { type: "choose", picks: [] });
    second.act("a", { type: "choose", picks: ["l:0", "l:1", "l:2", "l:3", "l:4"] });
    expect(second.a.hand).toEqual([]);
  });

  it("术式顺转「苍」 (012): moves an opposing energy-line character with energy generation 1 or less to the front line, then we draw 1", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GEN2);
    const first = field(b, "energy", KING);
    const second = field(b, "energy", W);
    field(b, "energy", GUARD); // makes 2 energy: not a legal choice
    useEvent(a, act, SOU);
    expect(choice(game, "a").options.sort()).toEqual([first.uid, second.uid].sort());
    act("a", { type: "choose", picks: [second.uid] });
    expect(b.front).toEqual([second]);
    expect(b.energy).toHaveLength(2);
    expect(a.hand).toHaveLength(1); // drew 1 (nobody was removed)
  });

  it("术式顺转「苍」 (012): with a full front line the opponent first puts one of their front cards into the removal area, and we draw nothing", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GEN2);
    const target = field(b, "energy", KING);
    const f = [field(b, "front", W), field(b, "front", STAR), field(b, "front", KING), field(b, "front", W)];
    field(b, "energy", KING);
    useEvent(a, act, SOU);
    act("a", { type: "choose", picks: [target.uid] });
    expect(choice(game, "b").options).toHaveLength(4); // the opponent chooses the card for the removal area
    act("b", { type: "choose", picks: [f[1]!.uid] });
    expect(b.removal).toEqual([STAR]);
    expect(b.front).toHaveLength(4);
    expect(b.front).toContain(target);
    expect(a.hand).toEqual([]);
  });

  it("术式顺转「苍」 (012): only one may be used per turn", () => {
    const { a, b, act } = setup();
    energy(a, 2, GEN2);
    field(b, "energy", KING);
    useEvent(a, act, SOU);
    expect(a.hand).toHaveLength(1);
    expect(() => useEvent(a, act, SOU)).toThrow("EVENT_CONDITION");
  });
});

describe("blue", () => {
  it("虎杖 悠仁 (013): in our turn on the front line, 〈宿傩〉 in the hand costs 1 less with 1 or more 〈宿傩的手指〉 in the sideline, 2 less with 4 or more", () => {
    const s = setup();
    const { game, a, players } = s;
    const yuji = field(a, "front", n("013"));
    a.hand.push(SUKUNA_OLD, KING);
    const cost = (card = SUKUNA_OLD): number => costOf(game, players, ctx, "a", card).energy;
    expect(cost()).toBe(5);
    a.sideline.push(FINGER);
    expect(cost()).toBe(4);
    a.sideline.push(FINGER, FINGER);
    expect(cost()).toBe(4); // 3 fingers
    a.sideline.push(FINGER);
    expect(cost()).toBe(3); // 4 fingers
    expect(cost(KING)).toBe(0); // only 〈宿傩〉
    expect(costOf(game, players, ctx, "a", SUKUNA_OLD, true).energy).toBe(3); // also for a Raid from the hand
    // Not on the front line: no cut.
    a.front = [];
    a.energy.push(yuji);
    expect(cost()).toBe(5);

    // Not in our turn.
    const second = setup("main", "b");
    field(second.a, "front", n("013"));
    second.a.hand.push(SUKUNA_OLD);
    second.a.sideline.push(FINGER);
    expect(costOf(second.game, second.players, ctx, "a", SUKUNA_OLD).energy).toBe(5);
  });

  it("虎杖 悠仁 (013): 登场时 draws 1, then sidelines a hand card", () => {
    const { game, a, act } = setup();
    energy(a, 3, GUARD);
    a.library = [W, KING];
    a.hand.push(n("013"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([STAR, W]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([W]);
    expect(a.sideline).toEqual([STAR]);
  });

  it("狗巻 棘 (014): only 【冲击无效】, which comes from the card data", () => {
    const { a } = setup();
    const inumaki = field(a, "front", n("014"));
    expect(JJK_4_ABILITIES[n("014")]).toEqual([]);
    expect(hasKeyword(ctx, inumaki, "冲击无效")).toBe(true);
  });

  it("宿傩 (015): 登场时 with fewer than 3 fingers picks 1 of the 3 effects (抽卡/BP-2000/退场)", () => {
    const run = (mode: string) => {
      const s = setup();
      const strong = withBp(s.b, "front", STAR, 0); // BP 2500
      const mid = withBp(s.b, "front", W, 1500); // BP 3500
      const weak = field(s.b, "front", KING); // BP 1500
      const big = withBp(s.b, "front", STAR, 2000); // BP 4500
      s.a.library = [W, KING];
      s.a.hand.push(n("015"), STAR);
      s.act("a", { type: "play", handIndex: 0, line: "front" });
      expect(choice(s.game, "a").options).toEqual(["m:0", "m:1", "m:2"]);
      s.act("a", { type: "choose", picks: [mode] });
      return { ...s, strong, mid, weak, big };
    };
    const draws = run("m:0");
    expect(draws.a.hand).toEqual([STAR, W]);
    draws.act("a", { type: "choose", picks: ["h:0"] });
    expect(draws.a.hand).toEqual([W]);
    expect(draws.a.sideline).toEqual([STAR]);
    expect(bpOf(ctx, draws.strong)).toBe(2500);

    const lowers = run("m:1");
    expect(bpOf(ctx, lowers.strong)).toBe(500);
    expect(bpOf(ctx, lowers.mid)).toBe(1500);
    expect(bpOf(ctx, lowers.weak)).toBe(1500); // BP below 2500: not affected
    expect(bpOf(ctx, lowers.big)).toBe(2500);
    expect(lowers.game.pending).toBeNull();

    const sidelines = run("m:2");
    expect(choice(sidelines.game, "a").options.sort()).toEqual([sidelines.strong.uid, sidelines.mid.uid, sidelines.weak.uid].sort()); // BP at most 3500
    sidelines.act("a", { type: "choose", picks: [sidelines.mid.uid] });
    expect(sidelines.b.front).not.toContain(sidelines.mid);
    expect(sidelines.b.sideline).toEqual([W]);
  });

  it("宿傩 (015): with 3 fingers it picks 2 effects, run in printed order (the BP cut first, so a 5000 BP character can then be sidelined)", () => {
    const { game, a, b, act } = setup();
    a.sideline.push(FINGER, FINGER, FINGER);
    const huge = withBp(b, "front", STAR, 2500); // BP 5000: 3000 after the cut
    const weak = field(b, "front", KING);
    a.hand.push(n("015"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1", "m:2"]);
    expect(() => act("a", { type: "choose", picks: ["m:1"] })).toThrow(); // exactly 2 are required
    act("a", { type: "choose", picks: ["m:2", "m:1"] });
    expect(bpOf(ctx, huge)).toBe(3000);
    expect(choice(game, "a").options.sort()).toEqual([huge.uid, weak.uid].sort());
    act("a", { type: "choose", picks: [huge.uid] });
    expect(b.front).toEqual([weak]);
    expect(b.sideline).toEqual([STAR]);
  });

  it("宿傩 (015): with 4 fingers it does all three, without being asked which", () => {
    const { game, a, b, act } = setup();
    a.sideline.push(FINGER, FINGER, FINGER, FINGER);
    const target = withBp(b, "front", STAR, 500); // BP 3000: 1000 after the cut, still sidelinable
    withBp(b, "front", STAR, 3000); // BP 5500: 3500 after the cut, still sidelinable
    a.library = [W, KING];
    a.hand.push(n("015"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([STAR, W]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]); // the draw-and-discard effect first
    act("a", { type: "choose", picks: ["h:1"] });
    expect(a.sideline).toContain(W);
    expect(bpOf(ctx, target)).toBe(1000);
    expect(choice(game, "a").options).toHaveLength(2);
    act("a", { type: "choose", picks: [target.uid] });
    expect(b.front).toHaveLength(1);
  });

  it("宿傩 (015): Raid onto 〈虎杖 悠仁〉 activates it and its 登场时 runs", () => {
    const { game, a, act } = setup();
    const base = field(a, "energy", J("037"), true);
    a.hand.push(n("015"));
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(base.cardId).toBe(n("015"));
    expect(base.rested).toBe(false);
    expect(choice(game, "a").options).toEqual(["m:0", "m:1", "m:2"]);
  });

  it("禅院 直毘人 (016): 登场时 looks at 2 and puts any number on top in the chosen order and the rest at the bottom", () => {
    const run = (picks: string[], bottom?: string[]) => {
      const { game, a, act } = setup();
      energy(a, 2, GUARD);
      a.library = [KING, W, STAR, GUARD];
      a.hand.push(n("016"));
      act("a", { type: "play", handIndex: 0, line: "front" });
      expect(choice(game, "a").options).toEqual(["l:0", "l:1"]);
      act("a", { type: "choose", picks });
      if (bottom) act("a", { type: "choose", picks: bottom });
      expect(game.pending).toBeNull();
      return a.library;
    };
    expect(run(["l:1", "l:0"])).toEqual([W, KING, STAR, GUARD]); // both on top, 先点的在最上面
    expect(run(["l:0", "l:1"])).toEqual([KING, W, STAR, GUARD]);
    expect(run(["l:1"])).toEqual([W, STAR, GUARD, KING]); // the other one goes to the bottom
    expect(run([], ["l:1", "l:0"])).toEqual([STAR, GUARD, W, KING]); // none on top: both to the bottom in the chosen order
  });

  it("禅院 真希 (017): 登场时 takes an event from the sideline without 特殊/最终 trigger into the hand", () => {
    const { game, a, act } = setup();
    energy(a, 2, GUARD);
    // 冲绳旅行 (抽卡), 虚式「茈」 (特殊), 术式反转「赫」 (激活), a character, 刍灵咒法「簪」 (no trigger), 大祓炮 (特殊)
    a.sideline.push(OKINAWA, J("029"), J("030"), KING, J("031"), n("036"));
    a.hand.push(n("017"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["s:0", "s:2", "s:4"]);
    act("a", { type: "choose", picks: ["s:4"] });
    expect(a.hand).toEqual([J("031")]);
    expect(a.sideline).toEqual([OKINAWA, J("029"), J("030"), KING, n("036")]);

    // Taking none is allowed.
    const second = setup();
    energy(second.a, 2, GUARD);
    second.a.sideline.push(OKINAWA);
    second.a.hand.push(n("017"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: [] });
    expect(second.a.hand).toEqual([]);
  });

  it("七海 建人 (018): in the opponent's turn with 15 or fewer cards in the deck, BP+1000 and 【冲击无效】", () => {
    const { a, act } = setup("main", "b");
    const nanami = field(a, "front", n("018"));
    a.library = Array(16).fill(KING);
    refresh(act, "b");
    expect(bpOf(ctx, nanami)).toBe(3000);
    expect(hasKeyword(ctx, nanami, "冲击无效")).toBe(false);
    a.library = Array(15).fill(KING);
    refresh(act, "b");
    expect(bpOf(ctx, nanami)).toBe(4000);
    expect(hasKeyword(ctx, nanami, "冲击无效")).toBe(true);

    // Not in our own turn.
    const second = setup();
    const own = field(second.a, "front", n("018"));
    second.a.library = Array(10).fill(KING);
    refresh(second.act);
    expect(bpOf(ctx, own)).toBe(3000);
    expect(hasKeyword(ctx, own, "冲击无效")).toBe(false);
  });

  it("七海 建人 (018): 登场时 may put the top card of the deck into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1, GUARD);
    a.library = [W, KING, STAR];
    a.hand.push(n("018"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["yes", "no"]);
    yes(act);
    expect(a.library).toEqual([KING, STAR]);
    expect(a.sideline).toEqual([W]);
    expect(game.pending).toBeNull();

    const second = setup();
    energy(second.a, 1, GUARD);
    second.a.library = [W, KING];
    second.a.hand.push(n("018"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    no(second.act);
    expect(second.a.library).toEqual([W, KING]);
    expect(second.a.sideline).toEqual([]);
  });

  it("七海 建人 (019): 登场时 the chosen opposing front character cannot attack until our next turn starts", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GUARD);
    const target = field(b, "front", W);
    const other = field(b, "front", KING);
    a.hand.push(n("019"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options.sort()).toEqual([target.uid, other.uid].sort());
    act("a", { type: "choose", picks: [target.uid] });
    expect(flagsOf(target)).toContain("cannotAttack");
    expect(flagsOf(other)).not.toContain("cannotAttack");
    // It really cannot attack in the opponent's turn, and the mark is gone when our next turn starts.
    act("a", { type: "end_turn" });
    while (game.phase !== "attack") act("b", { type: "next_phase" });
    expect(() => act("b", { type: "attack", attackerUid: target.uid })).toThrow("INVALID_ATTACKER");
    act("b", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("a");
    expect(flagsOf(target)).not.toContain("cannotAttack");
  });

  it("七海 建人 (019): 攻击时 mills 1; with 15 or fewer cards left, draws 1 and opposing front characters with BP 1500 or more get BP-1000", () => {
    const { game, a, b, act } = setup("attack");
    const nanami = field(a, "front", n("019"));
    const x = field(b, "front", KING); // 1500
    const y = field(b, "front", W); // 2000
    const z = withBp(b, "front", KING, -600); // 900
    const away = field(b, "energy", W);
    a.library = Array(16).fill(KING);
    act("a", { type: "attack", attackerUid: nanami.uid });
    yes(act); // mill: 15 left
    yes(act); // draw
    expect(a.library).toHaveLength(14);
    expect(a.sideline).toHaveLength(1);
    expect(a.hand).toHaveLength(1);
    expect(bpOf(ctx, x)).toBe(500);
    expect(bpOf(ctx, y)).toBe(1000);
    expect(bpOf(ctx, z)).toBe(900);
    expect(bpOf(ctx, away)).toBe(2000); // only the front line
    expect(game.pending?.kind).toBe("block");
  });

  it("七海 建人 (019): with 17 cards in the deck, milling leaves 16 and nothing else happens; declining the mill with 15 cards still draws", () => {
    const { game, a, b, act } = setup("attack");
    const nanami = field(a, "front", n("019"));
    const x = field(b, "front", W);
    a.library = Array(17).fill(KING);
    act("a", { type: "attack", attackerUid: nanami.uid });
    yes(act);
    expect(a.library).toHaveLength(16);
    expect(a.hand).toHaveLength(0);
    expect(bpOf(ctx, x)).toBe(2000);
    expect(game.pending?.kind).toBe("block");

    const second = setup("attack");
    const attacker = field(second.a, "front", n("019"));
    const victim = field(second.b, "front", W);
    second.a.library = Array(15).fill(KING);
    second.act("a", { type: "attack", attackerUid: attacker.uid });
    no(second.act); // keeps the top card
    yes(second.act); // draw (15 or fewer)
    expect(second.a.library).toHaveLength(14);
    expect(second.a.sideline).toHaveLength(0);
    expect(second.a.hand).toHaveLength(1);
    expect(bpOf(ctx, victim)).toBe(1000);
  });

  it("灰原 雄 (021): 退场时 we may draw 1 while 〈七海 建人〉 is on our field", () => {
    const { game, a, act } = setup();
    const haibara = field(a, "front", n("021"));
    field(a, "energy", NANAMI_BASE);
    a.library = [W, KING];
    sidelineByHand(act, haibara);
    expect(choice(game, "a").options).toEqual(["yes", "no"]);
    yes(act);
    expect(a.hand).toEqual([W]);
    expect(game.pending).toBeNull();

    const second = setup();
    const gone = field(second.a, "front", n("021"));
    field(second.a, "energy", NANAMI_BASE);
    sidelineByHand(second.act, gone);
    no(second.act);
    expect(second.a.hand).toEqual([]);

    // Without 〈七海 建人〉 nothing happens.
    const third = setup();
    const alone = field(third.a, "front", n("021"));
    sidelineByHand(third.act, alone);
    expect(third.game.pending).toBeNull();
    expect(third.a.hand).toEqual([]);
  });

  it("灰原 雄 (022): 启动主要 rests it and sidelines it to take 〈七海 建人〉 from the sideline into the hand", () => {
    const { game, a, act } = setup();
    const haibara = field(a, "energy", n("022"));
    a.sideline.push(NANAMI_BASE, KING);
    act("a", { type: "activate", uid: haibara.uid, ability: 0 });
    expect(a.energy).toEqual([]);
    expect(choice(game, "a").options).toEqual(["s:0"]); // only 〈七海 建人〉
    act("a", { type: "choose", picks: ["s:0"] });
    expect(a.hand).toEqual([NANAMI_BASE]);
    expect(a.sideline).toEqual([KING, n("022")]);

    // Cannot be used while resting.
    const second = setup();
    const tired = field(second.a, "energy", n("022"), true);
    expect(() => second.act("a", { type: "activate", uid: tired.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("伏黑 惠 (023): BP+500 in our turn once a hand or deck card has been sidelined by our effect this turn", () => {
    const { game, a, act } = setup();
    energy(a, 2, PUR2);
    const megumi = field(a, "front", n("023"));
    refresh(act);
    expect(bpOf(ctx, megumi)).toBe(3500);
    // Playing a plain card does not count; 三轮 霞's draw-and-sideline does.
    a.library = [W, KING];
    a.hand.push(n("028"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(bpOf(ctx, megumi)).toBe(3500);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(game.pending).toBeNull();
    expect(bpOf(ctx, megumi)).toBe(4000);

    // Milling the deck by our effect counts as well (七海 建人's 登场时).
    const second = setup();
    energy(second.a, 1, GUARD);
    const other = field(second.a, "front", n("023"));
    second.a.hand.push(n("018"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(bpOf(ctx, other)).toBe(3500);
    yes(second.act);
    expect(bpOf(ctx, other)).toBe(4000);

    // Not in the opponent's turn.
    const third = setup("main", "b");
    const away = field(third.a, "front", n("023"));
    third.game.turnMarks = [`${third.game.turn}:a:handDeckSidelined`];
    refresh(third.act, "b");
    expect(bpOf(ctx, away)).toBe(3500);
  });

  it("骄傲吧 你很强 (024): costs [蓝×2] less with 〈宿傩〉 on our front line; sidelines an opposing front character with printed BP 4000 or more and draws 2", () => {
    const s = setup();
    const env = envOf(s, n("024"));
    const cut = abilitiesOf(ctx, n("024")).find((ability) => ability.kind === "cost") as CostAbility;
    expect(cut.energy).toBe(2);
    expect(cut.condition!(env)).toBe(false);
    field(s.a, "energy", n("015"));
    expect(cut.condition!(env)).toBe(false); // on the energy line
    field(s.a, "front", n("015"));
    expect(cut.condition!(env)).toBe(true);

    const { game, a, b, act } = setup();
    const huge = field(b, "front", n("015")); // BP 5000
    const big = field(b, "front", SUKUNA_OLD); // BP 4000
    field(b, "front", W).bpMod = 3000; // printed BP 2000 only
    a.library = [W, KING, STAR];
    useEvent(a, act, n("024"));
    expect(choice(game, "a").options.sort()).toEqual([huge.uid, big.uid].sort());
    act("a", { type: "choose", picks: [big.uid] });
    expect(b.front).not.toContain(big);
    expect(b.sideline).toEqual([SUKUNA_OLD]);
    expect(a.hand).toEqual([W, KING]);
  });
});

describe("purple", () => {
  it("夏油 杰 (025): 登场时 puts a cost 2 or less, AP 1 咒灵 from the hand onto the field resting", () => {
    const { game, a, act } = setup();
    energy(a, 2, PUR2);
    // 漏瑚 (cost 1) and 陀艮 (cost 0) qualify; 陀艮 (cost 3), 虹龙 (yellow 咒灵) and a non-咒灵 do not ("子色" is read as 紫色).
    a.hand.push(n("025"), n("031"), n("033"), n("032"), n("010"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["h:0", "h:2"]); // 漏瑚 and 陀艮 (cost 0)
    act("a", { type: "choose", picks: ["h:2"] });
    expect(choice(game, "a").options).toEqual(["line:front", "line:energy"]);
    act("a", { type: "choose", picks: ["line:energy"] });
    expect(a.energy.map((card) => card.cardId)).toContain(n("032"));
    expect(a.energy[a.energy.length - 1]!.rested).toBe(true);
    expect(a.hand).toEqual([n("031"), n("033"), n("010"), STAR]);
  });

  it("夏油 杰 (025): nothing eligible in the hand does nothing", () => {
    const { game, a, act } = setup();
    energy(a, 2, PUR2);
    a.hand.push(n("025"), n("033"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(game.pending).toBeNull();
    expect(a.front).toHaveLength(1);
  });

  it("伏黑 甚尔 (026): enters active, BP+1000 in our turn, gets 【冲击①】 and 【瞄准攻击】 for the turn", () => {
    const { a, act } = setup();
    const plain = play(a, act, KING);
    expect(plain.rested).toBe(true); // a normal character comes in resting
    const toji = play(a, act, n("026"));
    expect(toji.rested).toBe(false);
    expect(bpOf(ctx, toji)).toBe(5000);
    expect(impactOf(ctx, toji)).toBe(1);
    expect(hasKeyword(ctx, toji, "瞄准攻击")).toBe(true);
    expect(activeAp(a)).toBe(0); // AP cost 2 + 1

    // Not in the opponent's turn; the keywords last this turn only.
    const second = setup();
    const own = play(second.a, second.act, n("026"));
    second.act("a", { type: "end_turn" });
    expect(second.game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, own)).toBe(4000);
    expect(hasKeyword(ctx, own, "瞄准攻击")).toBe(false);
    expect(impactOf(ctx, own)).toBe(0);
  });

  it("伏黑 甚尔 (026): the card in hand costs [紫×2] less while our and the opponent's life total 4 or fewer", () => {
    const s = setup();
    const cut = abilitiesOf(ctx, n("026")).find((ability) => ability.kind === "cost") as CostAbility;
    const env = envOf(s, n("026"));
    expect(cut.energy).toBe(2);
    expect(cut.condition!(env)).toBe(false);
    s.a.life.length = 2;
    s.b.life.length = 3;
    expect(cut.condition!(env)).toBe(false); // 5
    s.b.life.length = 2;
    expect(cut.condition!(env)).toBe(true); // 4
  });

  it("究极 机械丸 绝对形态 (027): gets 【冲击①】 with 5 or more other 京都校 / 〈三轮 霞〉 on our field", () => {
    const { a, act } = setup();
    const body = field(a, "front", n("027"));
    for (let index = 0; index < 3; index += 1) field(a, "front", MIWA_OLD);
    field(a, "energy", MECHAMARU);
    refresh(act);
    expect(impactOf(ctx, body)).toBe(0); // 4 others
    field(a, "energy", n("028")); // 三轮 霞 again
    refresh(act);
    expect(impactOf(ctx, body)).toBe(1); // 5 others
    field(a, "energy", KING);
    expect(impactOf(ctx, body)).toBe(1);
  });

  it("究极 机械丸 绝对形态 (027): Raid onto 〈究极 机械丸〉 or 〈与 幸吉〉; 登场时 picks 'sideline a BP 3500 or less front character' or 'sideline a site'", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, PUR2);
    const base = field(a, "energy", MECHAMARU, true);
    const small = field(b, "front", W);
    withBp(b, "front", W, 2000); // BP 4000: too strong
    a.hand.push(n("027"));
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(base.cardId).toBe(n("027"));
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    act("a", { type: "choose", picks: ["m:0"] });
    expect(choice(game, "a").options).toEqual([small.uid]);
    act("a", { type: "choose", picks: [small.uid] });
    expect(b.sideline).toEqual([W]);

    // The site mode.
    const second = setup();
    energy(second.a, 3, PUR2);
    const base2 = field(second.a, "energy", n("029"), true); // 与 幸吉 counts as 〈究极 机械丸〉
    refresh(second.act); // (continuous effects are recalculated after every action)
    const site = field(second.b, "energy", DOMAIN);
    field(second.b, "energy", KING);
    second.a.hand.push(n("027"));
    second.act("a", { type: "raid", handIndex: 0, targetUid: base2.uid, toFront: false });
    second.act("a", { type: "choose", picks: ["m:1"] });
    expect(choice(second.game, "a").options).toEqual([site.uid]); // only the site
    second.act("a", { type: "choose", picks: [site.uid] });
    expect(second.b.energy.map((card) => card.cardId)).toEqual([KING]);
    expect(second.b.sideline).toEqual([DOMAIN]);

    // Anything else cannot be Raided.
    const third = setup();
    energy(third.a, 3, PUR2);
    const wrong = field(third.a, "energy", MIWA_OLD);
    third.a.hand.push(n("027"));
    expect(() => third.act("a", { type: "raid", handIndex: 0, targetUid: wrong.uid, toFront: true })).toThrow("RAID_TARGET_INVALID");
  });

  it("三轮 霞 (028): 登场时 draws 1, then sidelines a hand card", () => {
    const { game, a, act } = setup();
    energy(a, 2, PUR2);
    a.library = [W, KING];
    a.hand.push(n("028"), STAR);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([STAR, W]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:1"] });
    expect(a.sideline).toEqual([W]);
    expect(a.hand).toEqual([STAR]);
  });

  it("与 幸吉 (029): also counts as 〈究极 机械丸〉 (the Raid target name)", () => {
    const { a, act } = setup();
    const koukichi = field(a, "front", n("029"));
    refresh(act);
    expect(flagsOf(koukichi)).toContain("name:究极 机械丸");
    expect(ctx.card(n("029"))!.abilities).toHaveLength(1);
  });

  it("与 幸吉 (030): 登场时 with 5 or more other 京都校 / 〈三轮 霞〉 on our field, an opposing front character gets BP-1000 this turn", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, PUR2);
    for (let index = 0; index < 2; index += 1) field(a, "front", MIWA_OLD);
    for (let index = 0; index < 3; index += 1) field(a, "energy", n("028"));
    const victim = field(b, "front", W);
    const other = field(b, "front", KING);
    a.hand.push(n("030"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options.sort()).toEqual([victim.uid, other.uid].sort());
    act("a", { type: "choose", picks: [victim.uid] });
    expect(bpOf(ctx, victim)).toBe(1000);
    expect(bpOf(ctx, other)).toBe(1500);

    // With only 4 others (it does not count itself) nothing happens.
    const second = setup();
    energy(second.a, 2, PUR2);
    for (let index = 0; index < 2; index += 1) field(second.a, "front", MIWA_OLD);
    for (let index = 0; index < 2; index += 1) field(second.a, "energy", n("028"));
    const safe = field(second.b, "front", W);
    second.a.hand.push(n("030"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(bpOf(ctx, safe)).toBe(2000);
  });

  it("漏瑚 (031): BP+1000 in our turn once a character was sidelined by BP 0 or by an effect this turn", () => {
    const { game, a, b, act } = setup();
    const jogo = field(a, "front", n("031"));
    refresh(act);
    expect(bpOf(ctx, jogo)).toBe(2000);
    // Sidelined by hand: no.
    const manual = field(b, "front", KING);
    sidelineByHand(act, manual, "b");
    expect(bpOf(ctx, jogo)).toBe(2000);
    // Sidelined by an effect (骄傲吧 你很强).
    const target = field(b, "front", n("015"));
    useEvent(a, act, n("024"));
    expect(b.front).not.toContain(target);
    expect(bpOf(ctx, jogo)).toBe(3000);

    // BP 0 or less.
    const second = setup();
    const jogo2 = field(second.a, "front", n("031"));
    withBp(second.b, "front", W, -2500);
    refresh(second.act);
    expect(second.b.front).toHaveLength(0);
    expect(bpOf(ctx, jogo2)).toBe(3000);

    // Not in the opponent's turn.
    const third = setup("main", "b");
    const away = field(third.a, "front", n("031"));
    third.game.turnMarks = [`${third.game.turn}:bpOrEffectSidelined`];
    refresh(third.act, "b");
    expect(bpOf(ctx, away)).toBe(2000);
    void game;
  });

  it("陀艮 (032): 退场时 puts the top 2 cards of our deck into the sideline", () => {
    const { a, act } = setup();
    const tour = field(a, "front", n("032"));
    a.library = [W, KING, STAR];
    sidelineByHand(act, tour);
    expect(a.sideline).toEqual([n("032"), W, KING]);
    expect(a.library).toEqual([STAR]);
  });

  it("陀艮 (033): 攻击时 may sideline a hand card to put a cost 2 or less, AP 1 purple character from the sideline onto the field resting, without its 登场时", () => {
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", n("033"));
    field(b, "front", KING);
    a.sideline.push(MIWA_OLD, n("031"), STAR); // 三轮 霞 (登场时: draw 1), 漏瑚; STAR is not purple
    a.hand.push(KING, W);
    a.library = [STAR, STAR];
    act("a", { type: "attack", attackerUid: attacker.uid });
    expect(choice(game, "a").options).toEqual(["yes", "no"]);
    yes(act);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(choice(game, "a").options).toEqual(["s:0", "s:1"]);
    act("a", { type: "choose", picks: ["s:0"] }); // 三轮 霞
    act("a", { type: "choose", picks: ["line:front"] });
    const placed = a.front.find((card) => card.cardId === MIWA_OLD)!;
    expect(placed.rested).toBe(true);
    expect(a.hand).toEqual([W]); // 三轮 霞's 登场时 draw did not happen
    expect(a.library).toHaveLength(2);
    expect(a.sideline).toEqual([n("031"), STAR, KING]);
    expect(game.pending?.kind).toBe("block");
  });

  it("陀艮 (033): declining, or having no hand card, does nothing", () => {
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", n("033"));
    field(b, "front", KING);
    a.sideline.push(MIWA_OLD);
    a.hand.push(KING);
    act("a", { type: "attack", attackerUid: attacker.uid });
    no(act);
    expect(a.hand).toEqual([KING]);
    expect(a.sideline).toEqual([MIWA_OLD]);
    expect(game.pending?.kind).toBe("block");

    const second = setup("attack");
    const empty = field(second.a, "front", n("033"));
    field(second.b, "front", KING);
    second.a.sideline.push(MIWA_OLD);
    second.act("a", { type: "attack", attackerUid: empty.uid });
    expect(second.game.pending?.kind).toBe("block"); // not even asked
  });

  it("花御 (034): only 【冲击无效】, which comes from the card data", () => {
    const { a } = setup();
    const hanami = field(a, "front", n("034"));
    expect(JJK_4_ABILITIES[n("034")]).toEqual([]);
    expect(hasKeyword(ctx, hanami, "冲击无效")).toBe(true);
  });

  it("真人 (035): 登场时 may sideline 2 other characters with different names, then draws 2 and gives an opposing front character BP-4000", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, PUR2);
    const base = field(a, "energy", MAHITO_BASE, true);
    const miwaA = field(a, "front", MIWA_OLD);
    const miwaB = field(a, "front", MIWA_OLD); // same name as miwaA
    const kyoto = field(a, "front", MECHAMARU);
    const victim = withBp(b, "front", STAR, 3500); // BP 6000
    a.library = [W, KING, STAR];
    a.hand.push(n("035"));
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    expect(choice(game, "a").options).toEqual(["yes", "no"]);
    yes(act);
    expect(choice(game, "a").options.sort()).toEqual([miwaA.uid, miwaB.uid, kyoto.uid].sort()); // not the 〈真人〉 itself
    expect(() => act("a", { type: "choose", picks: [miwaA.uid, miwaB.uid] })).toThrow("INVALID_CHOICE"); // same name
    expect(() => act("a", { type: "choose", picks: [miwaA.uid] })).toThrow("INVALID_CHOICE"); // exactly 2
    act("a", { type: "choose", picks: [miwaA.uid, kyoto.uid] });
    expect(a.sideline.sort()).toEqual([MIWA_OLD, MECHAMARU].sort());
    expect(a.hand).toEqual([W, KING]); // drew 2
    expect(choice(game, "a").options).toEqual([victim.uid]);
    act("a", { type: "choose", picks: [victim.uid] });
    expect(bpOf(ctx, victim)).toBe(2000);
    expect(a.front.map((card) => card.uid)).toContain(miwaB.uid);
  });

  it("真人 (035): declining does nothing; without two differently named other characters it is not even asked", () => {
    const { game, a, act } = setup();
    energy(a, 3, PUR2);
    const base = field(a, "energy", MAHITO_BASE, true);
    field(a, "front", MIWA_OLD);
    field(a, "front", MECHAMARU);
    a.hand.push(n("035"));
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid, toFront: true });
    no(act);
    expect(game.pending).toBeNull();
    expect(a.front).toHaveLength(3);
    expect(a.sideline).toEqual([]);
    expect(a.hand).toEqual([]);

    const second = setup();
    energy(second.a, 3, PUR2);
    const base2 = field(second.a, "energy", MAHITO_BASE, true);
    field(second.a, "front", MIWA_OLD);
    field(second.a, "front", MIWA_OLD); // same names only
    second.a.hand.push(n("035"));
    second.act("a", { type: "raid", handIndex: 0, targetUid: base2.uid, toFront: true });
    expect(second.game.pending).toBeNull();
    expect(second.a.front).toHaveLength(3);
  });
});
