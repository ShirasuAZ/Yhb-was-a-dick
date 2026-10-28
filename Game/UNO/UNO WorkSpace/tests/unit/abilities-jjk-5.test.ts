/**
 * JJK batch 5 (EX04BT/JJK-3-036 ... 066, except 040, 045, 047, 060 and the manual 039): one test per card (more where a card has several abilities),
 * set up as its printed text describes and checked against the text. Card text comes from Cards/cards.json (no card art here).
 * Every card of the batch costs 0 energy, so the batch's own cards are played without energy; events and helper cards of other colours need theirs.
 */
import { describe, expect, it } from "vitest";
import { bpOf, energyOf, hasKeyword } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { choice, ctx, energy, field, FILLER, setup } from "./ability-harness.ts";

const J = (n: string): string => `UA02BT/JJK-1-${n}`;
const K = (n: string): string => `EX04BT/JJK-3-${n}`;
// Helper cards without abilities (or whose abilities do not matter here).
const GUARD = "UC01ST/ARK-1-103"; // blue, cost 3, BP3000
const BLUE0 = "UC01BT/ARK-1-039"; // 阿米娅: blue, cost 0, BP1500, makes 1 blue energy
const PURPLE0 = "UCEX01BT/ARK-2-047"; // 阿米娅: purple, cost 0, BP1500, makes 1 purple energy
const RED0 = "UC01BT/ARK-1-088"; // 九: red, cost 0, BP2000, makes 1 red energy
const COST1 = "UC01BT/ARK-1-080"; // 陨星: red, cost 1, BP2500
const BIGS = [K("043"), K("053"), K("057"), K("062")]; // BP 4000, passive when merely put on the field
const SORCERER_A = K("041"); // 虎杖 悠仁: 咒术师, BP3000 (keywords only)
const SORCERER_B = K("044"); // 狗巻 棘: 咒术师, BP2500
const SORCERER_C = K("050"); // 日下部 笃也: 咒术师, BP3000
const CURSE = K("063"); // 蝗GUY: 咒灵
const BAD_PHASE = K("058"); // 坏相 (咒胎九相图), BP3500
const BLOOD = K("059"); // 血涂 (咒胎九相图), BP3000
const SWELL = K("061"); // 胀相 (咒胎九相图), BP2000

type Act = (who: string, action: UnionArenaAction) => void;
const pick = (act: Act, who: string, picks: string[]): void => act(who, { type: "choose", picks });
const sorted = (values: string[]): string[] => [...values].sort();
const names = (cardIds: Array<string | null>): string[] => cardIds.map((cardId) => (cardId ? ctx.card(cardId)?.name ?? "?" : "-"));
const redEnergy = (count: number, owner: Parameters<typeof energy>[0]): void => energy(owner, count, RED0);
const library = (player: { library: string[] }, ...top: string[]): void => { player.library = [...top, ...player.library.slice(top.length)]; };
const refresh = (act: Act, who = "a"): void => act(who, { type: "manual", manual: { op: "ap", apId: `${who}:ap0`, act: "activate" } });
const sidelineByHand = (act: Act, card: UnionArenaFieldCard, who = "a"): void => act(who, { type: "manual", manual: { op: "field", owner: "you", uid: card.uid, act: "sideline" } });

/** Steps `who`'s turn forward until their attack phase has ended (and on through the end phase, so the turn passes). */
const leaveAttackPhase = (game: ReturnType<typeof setup>["game"], act: Act, who: string): void => {
  while (game.turnPlayerId === who) {
    const phase = game.phase;
    if (phase === "end") { act(who, { type: "end_turn" }); return; }
    act(who, { type: "next_phase" });
    if (phase === "attack") {
      if (game.turnPlayerId === who && game.phase === "end") act(who, { type: "end_turn" });
      return;
    }
  }
};

const BATCH = [
  "036", "037", "038", "041", "042", "043", "044", "046", "048", "049", "050", "051", "052", "053", "054", "055", "056", "057", "058", "059", "061", "062",
  "063", "064", "065", "066"
];

describe("JJK 5 batch", () => {
  it("every card of the batch plays automatically", () => {
    expect(BATCH).toHaveLength(26);
    for (const number of BATCH) expect(isAutomated(titleCard(K(number))), number).toBe(true);
  });

  it("大祓炮 (036): removes an opposing front-line character of BP 3000 or less; of BP 5000 or less while our field has 究极 机械丸 / 绝对形态 / a card counted as one", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, PURPLE0);
    const small = field(b, "front", FILLER);
    const three = field(b, "front", GUARD);
    const four = field(b, "front", K("043"));
    const five = field(b, "front", J("012"));
    const back = field(b, "energy", FILLER);
    a.hand.push(K("036"));
    act("a", { type: "event", handIndex: 0 });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([small.uid, three.uid]));
    expect(choice(game).options).not.toContain(back.uid);
    pick(act, "a", [three.uid]);
    expect(b.front).toEqual([small, four, five]);
    expect(b.sideline).toEqual([GUARD]);

    for (const helper of [J("074"), K("027"), K("029")]) {
      const second = setup();
      energy(second.a, 4, PURPLE0);
      field(second.a, "energy", helper);
      const s1 = field(second.b, "front", FILLER);
      const s4 = field(second.b, "front", K("043"));
      const s5 = field(second.b, "front", J("012"));
      const s6 = field(second.b, "front", J("087")); // 4000... and a card above 5000 is not offered
      second.a.hand.push(K("036"));
      second.act("a", { type: "event", handIndex: 0 });
      expect(sorted(choice(second.game, "a").options), helper).toEqual(sorted([s1.uid, s4.uid, s5.uid, s6.uid]));
      pick(second.act, "a", [s5.uid]);
      expect(second.b.front, helper).toEqual([s1, s4, s6]);
    }

    // The opponent's 究极 机械丸 does not count.
    const third = setup();
    energy(third.a, 4, PURPLE0);
    field(third.b, "energy", J("074"));
    const t4 = field(third.b, "front", K("043"));
    const t1 = field(third.b, "front", FILLER);
    third.a.hand.push(K("036"));
    third.act("a", { type: "event", handIndex: 0 });
    expect(third.game.pending).toBeNull(); // the only target (BP 3000 or less) is taken at once
    expect(third.b.front).toEqual([t4]);
    expect(third.b.sideline).toEqual([FILLER]);
    void t1;
  });

  it("夏油 杰 (037): looks at 2, puts any number of 咒灵 / 咒胎九相图 into the sideline, the rest go back on top in the order picked", () => {
    const { game, a, act } = setup();
    library(a, CURSE, BAD_PHASE);
    a.hand.push(K("037"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(names(choice(game, "a").cards)).toEqual(["蝗GUY", "坏相"]);
    expect(choice(game).options).toEqual(["l:0", "l:1"]);
    pick(act, "a", ["l:0"]);
    expect(a.sideline).toEqual([CURSE]);
    expect(game.pending).toBeNull();
    expect(a.library.slice(0, 2)).toEqual([BAD_PHASE, FILLER]);

    // Both, or none (then the order of the two is asked).
    const second = setup();
    library(second.a, CURSE, BAD_PHASE);
    second.a.hand.push(K("037"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["l:0", "l:1"]);
    expect(second.a.sideline).toEqual([CURSE, BAD_PHASE]);
    expect(second.a.library[0]).toBe(FILLER);
    expect(second.game.pending).toBeNull();

    const third = setup();
    library(third.a, CURSE, BAD_PHASE);
    third.a.hand.push(K("037"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", []);
    expect(choice(third.game, "a").options).toEqual(["l:0", "l:1"]);
    pick(third.act, "a", ["l:1", "l:0"]);
    expect(third.a.library.slice(0, 2)).toEqual([BAD_PHASE, CURSE]);
    expect(third.a.sideline).toEqual([]);

    // Cards that are neither trait: only the order is asked.
    const fourth = setup();
    library(fourth.a, GUARD, RED0);
    fourth.a.hand.push(K("037"));
    fourth.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(fourth.game, "a").options).toEqual(["l:0", "l:1"]);
    pick(fourth.act, "a", ["l:1", "l:0"]);
    expect(fourth.a.library.slice(0, 2)).toEqual([RED0, GUARD]);
    expect(fourth.a.sideline).toEqual([]);
  });

  it("夏油 杰 (038): looks at 3, reveals up to one 咒灵 / 咒胎九相图 into the hand, the rest go to the bottom; a hand card goes to the sideline only if one was added", () => {
    const { game, a, act } = setup();
    library(a, CURSE, GUARD, BAD_PHASE);
    a.hand.push(K("038"), RED0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:0", "l:2"]);
    pick(act, "a", ["l:2"]);
    expect(a.hand).toEqual([RED0, BAD_PHASE]);
    pick(act, "a", ["l:1", "l:0"]);
    expect(a.library.slice(-2)).toEqual([GUARD, CURSE]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([BAD_PHASE]);
    expect(a.sideline).toEqual([RED0]);

    const second = setup();
    library(second.a, CURSE, GUARD, BAD_PHASE);
    second.a.hand.push(K("038"), RED0);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1", "l:2"]);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([RED0]);
    expect(second.a.sideline).toEqual([]);
  });

  it("虎杖 悠仁 (041) and 熊猫 (054): keyword-only cards are automatic and carry their keywords", () => {
    expect(ctx.card(K("041"))?.keywords).toEqual(expect.arrayContaining(["撤步", "冲击无效"]));
    expect(ctx.card(K("054"))?.keywords).toContain("冲击无效");
    expect(isAutomated(titleCard(K("041")))).toBe(true);
    expect(isAutomated(titleCard(K("054")))).toBe(true);
  });

  it("虎杖 悠仁 (042): 启动主要 gives BP+1000 for 2+ opposing front-line BP4000+ characters and also 冲击① for 4+, once per turn, front line only", () => {
    const run = (bigs: number, extra: (setupResult: ReturnType<typeof setup>) => void = () => {}) => {
      const result = setup();
      const itadori = field(result.a, "front", K("042"));
      for (let index = 0; index < bigs; index += 1) field(result.b, "front", BIGS[index]!);
      field(result.b, "front", GUARD);
      extra(result);
      result.act("a", { type: "activate", uid: itadori.uid, ability: 0 });
      return { ...result, itadori };
    };
    const none = run(1);
    expect(bpOf(ctx, none.itadori)).toBe(3000);
    expect(hasKeyword(ctx, none.itadori, "冲击1")).toBe(false);
    expect(() => none.act("a", { type: "activate", uid: none.itadori.uid, ability: 0 })).toThrow();

    const two = run(2);
    expect(bpOf(ctx, two.itadori)).toBe(4000);
    expect(hasKeyword(ctx, two.itadori, "冲击1")).toBe(false);

    const three = run(3);
    expect(bpOf(ctx, three.itadori)).toBe(4000);
    expect(hasKeyword(ctx, three.itadori, "冲击1")).toBe(false);

    const four = run(4);
    expect(bpOf(ctx, four.itadori)).toBe(4000);
    expect(hasKeyword(ctx, four.itadori, "冲击1")).toBe(true);

    // Big characters on the energy line do not count; the character must be on the front line.
    const energyLine = run(1, ({ b }) => { field(b, "energy", BIGS[1]!); field(b, "energy", BIGS[2]!); });
    expect(bpOf(ctx, energyLine.itadori)).toBe(3000);
    const { a, act } = setup();
    const back = field(a, "energy", K("042"));
    expect(() => act("a", { type: "activate", uid: back.uid, ability: 0 })).toThrow();
  });

  it("虎杖 悠仁 (043): 攻击时, with 3+ other 咒术师, picks 冲击① or (may) BP-2000 and becomes active; once per turn, not used up when the condition fails", () => {
    const attackWith = (others: string[]) => {
      const result = setup("attack");
      const itadori = field(result.a, "front", K("043"));
      for (const cardId of others) field(result.a, "energy", cardId);
      field(result.b, "front", FILLER);
      result.act("a", { type: "attack", attackerUid: itadori.uid });
      return { ...result, itadori };
    };
    const three = [SORCERER_A, SORCERER_B, SORCERER_C];

    const first = attackWith(three);
    expect(choice(first.game, "a").options).toEqual(["m:0", "m:1"]);
    pick(first.act, "a", ["m:0"]);
    expect(hasKeyword(ctx, first.itadori, "冲击1")).toBe(true);
    expect(first.itadori.used).toEqual([0]);
    expect(first.game.pending?.kind).toBe("block");

    const second = attackWith(three);
    pick(second.act, "a", ["m:1"]);
    expect(choice(second.game, "a").purpose).toBe("confirm");
    expect(second.itadori.rested).toBe(true);
    pick(second.act, "a", ["yes"]);
    expect(bpOf(ctx, second.itadori)).toBe(2000);
    expect(second.itadori.rested).toBe(false);
    expect(hasKeyword(ctx, second.itadori, "冲击1")).toBe(false);

    const third = attackWith(three);
    pick(third.act, "a", ["m:1"]);
    pick(third.act, "a", ["no"]);
    expect(bpOf(ctx, third.itadori)).toBe(4000);
    expect(third.itadori.rested).toBe(true);

    // Only 2 others (the card itself does not count; 咒术师 on the opponent's side neither): nothing happens, the once-per-turn is kept.
    const fourth = (() => {
      const result = setup("attack");
      const itadori = field(result.a, "front", K("043"));
      for (const cardId of [SORCERER_A, SORCERER_B]) field(result.a, "energy", cardId);
      field(result.b, "energy", SORCERER_C);
      field(result.b, "front", FILLER);
      result.act("a", { type: "attack", attackerUid: itadori.uid });
      return { ...result, itadori };
    })();
    expect(fourth.game.pending?.kind).toBe("block");
    expect(fourth.itadori.used).toEqual([]);
    expect(hasKeyword(ctx, fourth.itadori, "冲击1")).toBe(false);

    // Already used this turn.
    const fifth = setup("attack");
    const itadori = field(fifth.a, "front", K("043"));
    itadori.used = [0];
    for (const cardId of three) field(fifth.a, "energy", cardId);
    field(fifth.b, "front", FILLER);
    fifth.act("a", { type: "attack", attackerUid: itadori.uid });
    expect(fifth.game.pending?.kind).toBe("block");
  });

  it("狗巻 棘 (044): makes +1 red energy while active", () => {
    const { a, act } = setup();
    const inu = field(a, "energy", K("044"));
    refresh(act);
    expect(energyOf(ctx, a, "red")).toBe(2);
    inu.rested = true;
    refresh(act);
    expect(energyOf(ctx, a, "red")).toBe(1);
  });

  it("忧忧 (046): 登场时 returns another character of cost 1 or less to the hand; with none, returns itself", () => {
    const { game, a, act } = setup();
    const cheap = field(a, "front", FILLER);
    const costOne = field(a, "energy", COST1);
    field(a, "front", GUARD); // cost 3: not a candidate
    a.hand.push(K("046"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([cheap.uid, costOne.uid]));
    pick(act, "a", [costOne.uid]);
    expect(a.hand).toEqual([COST1]);
    expect(a.energy).toEqual([]);
    expect(a.front.map((card) => card.cardId)).toEqual([FILLER, GUARD, K("046")]);

    const second = setup();
    field(second.a, "front", GUARD);
    second.a.hand.push(K("046"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([K("046")]);
    expect(second.a.front.map((card) => card.cardId)).toEqual([GUARD]);
  });

  it("钉崎 野蔷薇 (048): 登场时 gives up to one other 咒术师 BP+500, or BP+1500 when the opposing front line has 2+ BP4000+ characters", () => {
    const { game, a, act } = setup();
    const sorcerer = field(a, "front", SORCERER_A);
    const other = field(a, "energy", SORCERER_B);
    const plain = field(a, "front", FILLER);
    field(a, "front", GUARD);
    field(a, "energy", RED0);
    a.hand.push(K("048"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([sorcerer.uid, other.uid]));
    expect(choice(game).options).not.toContain(plain.uid);
    pick(act, "a", [other.uid]);
    expect(bpOf(ctx, other)).toBe(3000);
    expect(bpOf(ctx, sorcerer)).toBe(3000);

    const second = setup();
    const target = field(second.a, "front", SORCERER_A);
    field(second.b, "front", K("043"));
    field(second.b, "front", K("053"));
    field(second.b, "front", GUARD);
    second.a.hand.push(K("048"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(4500);

    // One big character is not enough; "最多1张": none.
    const third = setup();
    const t3 = field(third.a, "front", SORCERER_A);
    field(third.b, "front", K("043"));
    field(third.b, "energy", K("053"));
    third.a.hand.push(K("048"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", [t3.uid]);
    expect(bpOf(ctx, t3)).toBe(3500);
    const fourth = setup();
    const t4 = field(fourth.a, "front", SORCERER_A);
    fourth.a.hand.push(K("048"));
    fourth.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(fourth.act, "a", []);
    expect(bpOf(ctx, t4)).toBe(3000);
    expect(fourth.game.pending).toBeNull();
  });

  it("钉崎 野蔷薇 (049): 登场时 draws, puts a hand card into the sideline; a 咒术师 lets us give BP-3000 to a character of the same cost or printed BP", () => {
    const { game, a, b, act } = setup();
    library(a, GUARD);
    const sameBp = field(b, "front", J("087")); // cost 4, BP 4000
    const sameCost = field(b, "front", FILLER); // cost 0, BP 1500
    const neither = field(b, "front", J("009")); // cost 3, BP 3000
    const back = field(b, "energy", FILLER);
    a.hand.push(K("049"), K("053")); // 七海 建人: 咒术师, cost 0, BP 4000
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([K("053"), GUARD]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.sideline).toEqual([K("053")]);
    expect(sorted(choice(game, "a").options)).toEqual(sorted([sameBp.uid, sameCost.uid]));
    expect(choice(game).options).not.toContain(neither.uid);
    expect(choice(game).options).not.toContain(back.uid);
    pick(act, "a", [sameBp.uid]);
    expect(bpOf(ctx, sameBp)).toBe(1000);
    expect(bpOf(ctx, sameCost)).toBe(1500);

    // Not a 咒术师 (Guard): nothing more; "最多1张": none.
    const second = setup();
    library(second.a, RED0);
    field(second.b, "front", FILLER);
    second.a.hand.push(K("049"), GUARD);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["h:0"]);
    expect(second.a.sideline).toEqual([GUARD]);
    expect(second.game.pending).toBeNull();

    const third = setup();
    library(third.a, RED0);
    const t3 = field(third.b, "front", FILLER);
    third.a.hand.push(K("049"), SORCERER_A);
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", ["h:0"]);
    pick(third.act, "a", []);
    expect(bpOf(ctx, t3)).toBe(1500);
  });

  it("钉崎 野蔷薇 (049): 启动主要 puts a hand card into the sideline to give a 咒术师 BP+500, once per turn", () => {
    const { game, a, act } = setup();
    const nobara = field(a, "front", K("049"));
    const sorcerer = field(a, "energy", SORCERER_A);
    const plain = field(a, "front", FILLER);
    a.hand.push(RED0, GUARD);
    act("a", { type: "activate", uid: nobara.uid, ability: 1 });
    pick(act, "a", ["h:0"]);
    expect(a.sideline).toEqual([RED0]);
    expect(sorted(choice(game, "a").options)).toEqual(sorted([nobara.uid, sorcerer.uid]));
    expect(choice(game).options).not.toContain(plain.uid);
    pick(act, "a", [sorcerer.uid]);
    expect(bpOf(ctx, sorcerer)).toBe(3500);
    expect(() => act("a", { type: "activate", uid: nobara.uid, ability: 1 })).toThrow();

    // Without a hand card the cost cannot be paid.
    const second = setup();
    const n2 = field(second.a, "front", K("049"));
    expect(() => second.act("a", { type: "activate", uid: n2.uid, ability: 1 })).toThrow();
  });

  it("日下部 笃也 (050): cannot be chosen by an opposing character of BP4000+, but by weaker characters, events and our own effects", () => {
    // BP 4000 character (漏瑚, cost 4): only the other target is offered.
    const big = setup();
    energy(big.a, 4, PURPLE0);
    field(big.b, "front", K("050"));
    const guard = field(big.b, "front", GUARD);
    big.a.hand.push(J("087"));
    big.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(big.game, "a").options).toEqual([guard.uid]);

    // BP 3000 character (漏瑚, cost 3): 日下部 is offered.
    const small = setup();
    energy(small.a, 3, PURPLE0);
    const kusakabe = field(small.b, "front", K("050"));
    const guard2 = field(small.b, "front", GUARD);
    small.a.hand.push(J("086"));
    small.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(sorted(choice(small.game, "a").options)).toEqual(sorted([kusakabe.uid, guard2.uid]));

    // An event (迳庭拳, BP5000 or less) can choose it.
    const event = setup();
    energy(event.a, 4, BLUE0);
    const k4 = field(event.b, "front", K("050"));
    event.a.hand.push(J("062"));
    event.act("a", { type: "event", handIndex: 0 });
    expect(event.game.pending).toBeNull(); // 迳庭拳 had to choose the only target: 日下部 (returned to the hand)
    expect(event.b.hand).toEqual([K("050")]);
    expect(event.b.front).not.toContain(k4);

    // Our own effects can (钉崎 野蔷薇 chooses our 咒术师).
    const own = setup();
    const mine = field(own.a, "front", K("050"));
    own.a.hand.push(K("048"));
    own.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(own.game, "a").options).toEqual([mine.uid]);
  });

  it("五条 悟 (051): enters active with 伤害②, and is put into the removal area when the opponent's attack phase ends (not ours)", () => {
    // Control: a character played normally enters resting.
    const control = setup();
    control.a.hand.push(K("055"));
    control.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(control.a.front[0]!.rested).toBe(true);

    const { game, a, act } = setup();
    a.hand.push(K("051"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const gojo = a.front[0]!;
    expect(a.hand).toEqual([]);
    expect(gojo.rested).toBe(false);
    expect(bpOf(ctx, gojo)).toBe(5000);
    expect(hasKeyword(ctx, gojo, "伤害2")).toBe(true);
    // Our own attack phase ends: it stays.
    leaveAttackPhase(game, act, "a");
    expect(game.turnPlayerId).toBe("b");
    expect(a.front).toEqual([gojo]);
    // The opponent's attack phase ends: it goes to the removal area (not the sideline).
    leaveAttackPhase(game, act, "b");
    expect(a.front).toEqual([]);
    expect(a.removal).toEqual([K("051")]);
    expect(a.sideline).toEqual([]);
  });

  it("五条 悟 (052): when the opponent's attack phase ends with 2+ BP4000 characters or a 〈夏油 杰〉 on their front line, it goes to the removal area and we search 4 for up to 2 咒术师", () => {
    const { game, a, b, act } = setup();
    field(a, "front", K("052"));
    field(b, "front", K("043"));
    field(b, "front", K("053"));
    library(a, K("055"), GUARD, K("051"), SORCERER_A);
    // Our own attack phase ending does nothing, even with the condition met.
    leaveAttackPhase(game, act, "a");
    expect(a.front).toHaveLength(1);
    leaveAttackPhase(game, act, "b");
    expect(a.front).toEqual([]);
    expect(a.removal).toEqual([K("052")]);
    expect(names(choice(game, "a").cards)).toEqual(["伏黑 惠", "虎杖 悠仁"]);
    expect(choice(game).options).toEqual(["l:0", "l:3"]); // 五条 悟 is excluded
    pick(act, "a", ["l:0", "l:3"]);
    expect(a.hand).toEqual([K("055"), SORCERER_A]);
    pick(act, "a", ["l:1", "l:0"]);
    expect(a.library.slice(-2)).toEqual([K("051"), GUARD]);
    expect(a.sideline).toEqual([]);
    // Our next turn has begun meanwhile (a card drawn); no hand card was put into the sideline.
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([K("055"), SORCERER_A, FILLER]);

    // 〈夏油 杰〉 on the front line is enough; none picked is allowed.
    const second = setup();
    field(second.a, "front", K("052"));
    field(second.b, "front", J("068"));
    library(second.a, SORCERER_A, GUARD, GUARD, GUARD);
    leaveAttackPhase(second.game, second.act, "a");
    leaveAttackPhase(second.game, second.act, "b");
    expect(second.a.removal).toEqual([K("052")]);
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1", "l:2", "l:3"]);
    expect(second.a.hand).toEqual([FILLER]); // only the card drawn at the start of our next turn

    // One big character only, or the 〈夏油 杰〉 on the energy line: nothing happens.
    const third = setup();
    const keeper = field(third.a, "front", K("052"));
    field(third.b, "front", K("043"));
    field(third.b, "front", GUARD);
    field(third.b, "energy", J("068"));
    field(third.b, "energy", K("053"));
    leaveAttackPhase(third.game, third.act, "a");
    leaveAttackPhase(third.game, third.act, "b");
    expect(third.a.front).toEqual([keeper]);
    expect(third.a.removal).toEqual([]);
  });

  it("七海 建人 (053): 退场时 looks at 4, reveals up to one 〈虎杖 悠仁〉 into the hand, the rest go to the bottom, then a hand card goes to the sideline", () => {
    const { game, a, act } = setup();
    const nanami = field(a, "front", K("053"));
    library(a, GUARD, K("042"), RED0, SORCERER_A);
    a.hand.push(BLUE0);
    sidelineByHand(act, nanami);
    expect(names(choice(game, "a").cards)).toEqual(["虎杖 悠仁", "虎杖 悠仁"]);
    expect(choice(game).options).toEqual(["l:1", "l:3"]);
    pick(act, "a", ["l:3"]);
    expect(a.hand).toEqual([BLUE0, SORCERER_A]);
    pick(act, "a", ["l:0", "l:2", "l:1"]);
    expect(a.library.slice(-3)).toEqual([GUARD, RED0, K("042")]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([SORCERER_A]);
    expect(a.sideline).toEqual([K("053"), BLUE0]);

    const second = setup();
    const n2 = field(second.a, "front", K("053"));
    library(second.a, GUARD, K("042"), RED0, SORCERER_A);
    second.a.hand.push(BLUE0);
    sidelineByHand(second.act, n2);
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1", "l:2", "l:3"]);
    expect(second.a.hand).toEqual([BLUE0]);
    expect(second.a.sideline).toEqual([K("053")]);
    expect(second.game.pending).toBeNull();
  });

  it("伏黑 惠 (055): 登场时 draws a card, then a hand card is put into the sideline", () => {
    const { game, a, act } = setup();
    library(a, GUARD);
    a.hand.push(K("055"), RED0);
    const deck = a.library.length;
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.library).toHaveLength(deck - 1);
    expect(a.hand).toEqual([RED0, GUARD]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:1"]);
    expect(a.hand).toEqual([RED0]);
    expect(a.sideline).toEqual([GUARD]);
  });

  it("伏黑 惠 (056): 启动主要 gives a chosen 咒术师 BP+500, or BP+1500 against 2+ BP4000+ opposing front-line characters; once per turn, front line only", () => {
    const { game, a, act } = setup();
    const megumi = field(a, "front", K("056"));
    const sorcerer = field(a, "energy", SORCERER_A);
    const plain = field(a, "front", FILLER);
    act("a", { type: "activate", uid: megumi.uid, ability: 0 });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([megumi.uid, sorcerer.uid]));
    expect(choice(game).options).not.toContain(plain.uid);
    pick(act, "a", [sorcerer.uid]);
    expect(bpOf(ctx, sorcerer)).toBe(3500);
    expect(() => act("a", { type: "activate", uid: megumi.uid, ability: 0 })).toThrow();

    const second = setup();
    const m2 = field(second.a, "front", K("056"));
    field(second.b, "front", K("043"));
    field(second.b, "front", K("053"));
    second.act("a", { type: "activate", uid: m2.uid, ability: 0 });
    expect(second.game.pending).toBeNull(); // the only 咒术师 is chosen at once
    expect(bpOf(ctx, m2)).toBe(5000);

    const third = setup();
    const back = field(third.a, "energy", K("056"));
    expect(() => third.act("a", { type: "activate", uid: back.uid, ability: 0 })).toThrow();
  });

  it("冥冥 (057): BP+1000 during our turn only; 伤害② is her keyword", () => {
    const { game, a, act } = setup();
    const mei = field(a, "front", K("057"));
    refresh(act);
    expect(bpOf(ctx, mei)).toBe(5000);
    expect(hasKeyword(ctx, mei, "伤害2")).toBe(true);
    leaveAttackPhase(game, act, "a");
    expect(game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, mei)).toBe(4000);
  });

  it("坏相 (058) / 血涂 (059): 攻击时, with the other two 咒胎九相图 on the same line, draw a card, put a hand card into the sideline and gain BP+1000", () => {
    for (const [card, partners, bpValue] of [[BAD_PHASE, [SWELL, BLOOD], 3500], [BLOOD, [SWELL, BAD_PHASE], 3000]] as const) {
      const { game, a, b, act } = setup("attack");
      const attacker = field(a, "front", card);
      for (const partner of partners) field(a, "front", partner);
      field(b, "front", FILLER);
      library(a, GUARD);
      a.hand.push(RED0);
      act("a", { type: "attack", attackerUid: attacker.uid });
      expect(a.hand).toEqual([RED0, GUARD]);
      pick(act, "a", ["h:1"]);
      expect(a.sideline).toEqual([GUARD]);
      expect(bpOf(ctx, attacker)).toBe(bpValue + 1000);
      expect(game.pending?.kind).toBe("block");
    }

    // One partner missing, the partner on the energy line, or only the opponent's: nothing happens.
    const cases: Array<(r: ReturnType<typeof setup>) => UnionArenaFieldCard> = [
      ({ a }) => { const c = field(a, "front", BAD_PHASE); field(a, "front", SWELL); return c; },
      ({ a }) => { const c = field(a, "front", BAD_PHASE); field(a, "front", SWELL); field(a, "energy", BLOOD); return c; },
      ({ a, b }) => { const c = field(a, "front", BAD_PHASE); field(a, "front", SWELL); field(b, "front", BLOOD); return c; }
    ];
    for (const build of cases) {
      const result = setup("attack");
      const attacker = build(result);
      field(result.b, "front", FILLER);
      result.a.hand.push(RED0);
      result.act("a", { type: "attack", attackerUid: attacker.uid });
      expect(result.a.hand).toEqual([RED0]);
      expect(bpOf(ctx, attacker)).toBe(3500);
      expect(result.game.pending?.kind).toBe("block");
    }
  });

  it("胀相 (061): 登场时 puts 0 to 2 of the deck's top cards into the sideline, then may add a 坏相 / 血涂 from the sideline to the hand (and put a hand card into the sideline)", () => {
    const { game, a, act } = setup();
    library(a, BAD_PHASE, BLOOD);
    a.hand.push(SWELL, RED0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1", "m:2"]);
    pick(act, "a", ["m:0"]);
    expect(a.sideline).toEqual([BAD_PHASE, BLOOD]);
    expect(names(choice(game, "a").cards)).toEqual(["坏相", "血涂"]);
    pick(act, "a", ["s:1"]);
    expect(a.hand).toEqual([RED0, BLOOD]);
    pick(act, "a", ["h:0"]);
    expect(a.sideline).toEqual([BAD_PHASE, RED0]);
    expect(a.hand).toEqual([BLOOD]);

    // One card only; and a 坏相 already in the sideline may be taken without milling anything.
    const second = setup();
    library(second.a, BAD_PHASE, BLOOD);
    second.a.sideline.push(BLOOD);
    second.a.hand.push(SWELL);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["m:1"]);
    expect(second.a.sideline).toEqual([BLOOD, BAD_PHASE]);
    expect(second.a.library[0]).toBe(BLOOD);
    pick(second.act, "a", []);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([]);

    const third = setup();
    library(third.a, GUARD, GUARD);
    third.a.sideline.push(BAD_PHASE);
    third.a.hand.push(SWELL, RED0);
    const deck = third.a.library.length;
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", ["m:2"]); // up to 2: none
    expect(third.a.library).toHaveLength(deck);
    expect(third.a.sideline).toEqual([BAD_PHASE]);
    pick(third.act, "a", ["s:0"]);
    expect(third.a.hand).toEqual([RED0, BAD_PHASE]);
    pick(third.act, "a", ["h:1"]);
    expect(third.a.sideline).toEqual([BAD_PHASE]);
  });

  it("胀相 (062): 登场时 draws and may put a 坏相 / 血涂 from the hand onto the field resting; 启动主要 gives all our 坏相 and 血涂 BP+500 with both on the same line", () => {
    const { game, a, act } = setup();
    library(a, GUARD);
    a.hand.push(K("062"), BAD_PHASE, BLOOD, RED0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([BAD_PHASE, BLOOD, RED0, GUARD]);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:1"]);
    expect(choice(game, "a").options).toEqual(["line:front", "line:energy"]);
    pick(act, "a", ["line:front"]);
    const blood = a.front.find((card) => card.cardId === BLOOD)!;
    expect(blood.rested).toBe(true);
    expect(a.hand).toEqual([BAD_PHASE, RED0, GUARD]);

    const second = setup();
    library(second.a, GUARD);
    second.a.hand.push(K("062"), BAD_PHASE);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.a.front.map((card) => card.cardId)).toEqual([K("062")]);

    // 启动主要.
    const third = setup();
    const swell = field(third.a, "front", K("062"));
    const badPhase = field(third.a, "front", BAD_PHASE);
    const bloodCard = field(third.a, "energy", BLOOD); // on the energy line: still "our field", BP raised
    const frontBlood = field(third.a, "front", BLOOD);
    const plain = field(third.a, "front", FILLER);
    third.act("a", { type: "activate", uid: swell.uid, ability: 1 });
    expect(bpOf(ctx, badPhase)).toBe(4000);
    expect(bpOf(ctx, bloodCard)).toBe(3500);
    expect(bpOf(ctx, frontBlood)).toBe(3500);
    expect(bpOf(ctx, swell)).toBe(4000);
    expect(bpOf(ctx, plain)).toBe(1500);
    expect(() => third.act("a", { type: "activate", uid: swell.uid, ability: 1 })).toThrow();

    // Without both of them on the same line nothing happens (the once-per-turn is spent).
    const fourth = setup();
    const s4 = field(fourth.a, "front", K("062"));
    const b4 = field(fourth.a, "front", BAD_PHASE);
    field(fourth.a, "energy", BLOOD);
    fourth.act("a", { type: "activate", uid: s4.uid, ability: 1 });
    expect(bpOf(ctx, b4)).toBe(3500);
    // Not on the front line: cannot be used.
    const fifth = setup();
    const s5 = field(fifth.a, "energy", K("062"));
    expect(() => fifth.act("a", { type: "activate", uid: s5.uid, ability: 1 })).toThrow();
  });

  it("蝗GUY (063): 启动主要 rests it for +1 red energy this turn, once per turn; it is sidelined when the main phase ends", () => {
    const { game, a, act } = setup();
    const guy = field(a, "energy", K("063"));
    const before = energyOf(ctx, a, "red");
    act("a", { type: "activate", uid: guy.uid, ability: 0 });
    expect(guy.rested).toBe(true);
    expect(energyOf(ctx, a, "red")).toBe(before + 1);
    expect(() => act("a", { type: "activate", uid: guy.uid, ability: 0 })).toThrow();
    act("a", { type: "next_phase" });
    expect(game.pending).toBeNull();
    expect(a.energy).toHaveLength(0);
    expect(a.sideline).toEqual([K("063")]);

    // Not used: it stays.
    const second = setup();
    field(second.a, "energy", K("063"));
    second.act("a", { type: "next_phase" });
    expect(second.a.energy).toHaveLength(1);
    expect(second.a.sideline).toEqual([]);
  });

  it("漏瑚 (064): 启动主要 needs 5+ energy; gives 伤害② or an 攻击时 ability (discard 2 to remove an opposing BP2000-or-less front-line character) for the turn", () => {
    // Fewer than 5 energy: cannot be activated.
    const poor = setup();
    redEnergy(4, poor.a);
    const lone = field(poor.a, "front", K("064"));
    expect(() => poor.act("a", { type: "activate", uid: lone.uid, ability: 0 })).toThrow();

    const { game, a, act } = setup();
    redEnergy(5, a);
    const kuruma = field(a, "front", K("064"));
    act("a", { type: "activate", uid: kuruma.uid, ability: 0 });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    expect(hasKeyword(ctx, kuruma, "伤害2")).toBe(true);
    expect(() => act("a", { type: "activate", uid: kuruma.uid, ability: 0 })).toThrow();

    // The second option: 【攻击时】 ability.
    const second = setup();
    redEnergy(5, second.a);
    const k2 = field(second.a, "front", K("064"));
    const weak = field(second.b, "front", FILLER);
    const nine = field(second.b, "front", RED0); // BP 2000: still offered
    const strong = field(second.b, "front", GUARD);
    second.a.hand.push(BLUE0, GUARD, RED0);
    second.act("a", { type: "activate", uid: k2.uid, ability: 0 });
    pick(second.act, "a", ["m:1"]);
    expect(hasKeyword(ctx, k2, "伤害2")).toBe(false);
    second.act("a", { type: "next_phase" });
    second.act("a", { type: "attack", attackerUid: k2.uid });
    expect(choice(second.game, "a").purpose).toBe("confirm");
    pick(second.act, "a", ["yes"]);
    expect(choice(second.game, "a").options).toEqual(["h:0", "h:1", "h:2"]);
    expect(choice(second.game).min).toBe(2);
    pick(second.act, "a", ["h:0", "h:2"]);
    expect(second.a.sideline).toEqual([BLUE0, RED0]);
    expect(second.a.hand).toEqual([GUARD]);
    expect(sorted(choice(second.game, "a").options)).toEqual(sorted([weak.uid, nine.uid]));
    expect(choice(second.game).options).not.toContain(strong.uid);
    pick(second.act, "a", [nine.uid]);
    expect(second.b.front).toEqual([weak, strong]);
    expect(second.b.sideline).toEqual([RED0]);

    // Declining, or having fewer than 2 hand cards, does nothing.
    const third = setup();
    redEnergy(5, third.a);
    const k3 = field(third.a, "front", K("064"));
    field(third.b, "front", FILLER);
    third.a.hand.push(BLUE0, GUARD);
    third.act("a", { type: "activate", uid: k3.uid, ability: 0 });
    pick(third.act, "a", ["m:1"]);
    third.act("a", { type: "next_phase" });
    third.act("a", { type: "attack", attackerUid: k3.uid });
    pick(third.act, "a", ["no"]);
    expect(third.a.hand).toEqual([BLUE0, GUARD]);
    expect(third.game.pending?.kind).toBe("block");

    const fourth = setup();
    redEnergy(5, fourth.a);
    const k4 = field(fourth.a, "front", K("064"));
    field(fourth.b, "front", FILLER);
    fourth.a.hand.push(BLUE0);
    fourth.act("a", { type: "activate", uid: k4.uid, ability: 0 });
    pick(fourth.act, "a", ["m:1"]);
    fourth.act("a", { type: "next_phase" });
    fourth.act("a", { type: "attack", attackerUid: k4.uid });
    expect(fourth.game.pending?.kind).toBe("block");
    expect(fourth.a.hand).toEqual([BLUE0]);
  });

  it("陀艮 (065): 启动主要 needs 5+ energy; may put a hand card into the sideline to become active", () => {
    const poor = setup();
    redEnergy(4, poor.a);
    const lone = field(poor.a, "front", K("065"), true);
    poor.a.hand.push(BLUE0);
    expect(() => poor.act("a", { type: "activate", uid: lone.uid, ability: 0 })).toThrow();

    const { game, a, act } = setup();
    redEnergy(5, a);
    const togo = field(a, "front", K("065"), true);
    a.hand.push(BLUE0, GUARD);
    act("a", { type: "activate", uid: togo.uid, ability: 0 });
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    pick(act, "a", ["h:1"]);
    expect(a.sideline).toEqual([GUARD]);
    expect(togo.rested).toBe(false);
    expect(() => act("a", { type: "activate", uid: togo.uid, ability: 0 })).toThrow();

    // No: it stays resting, nothing is put into the sideline.
    const second = setup();
    redEnergy(5, second.a);
    const t2 = field(second.a, "front", K("065"), true);
    second.a.hand.push(BLUE0);
    second.act("a", { type: "activate", uid: t2.uid, ability: 0 });
    pick(second.act, "a", ["no"]);
    expect(t2.rested).toBe(true);
    expect(second.a.hand).toEqual([BLUE0]);

    // An empty hand: nothing is asked.
    const third = setup();
    redEnergy(5, third.a);
    const t3 = field(third.a, "front", K("065"), true);
    third.act("a", { type: "activate", uid: t3.uid, ability: 0 });
    expect(third.game.pending).toBeNull();
    expect(t3.rested).toBe(true);
  });

  it("花御 (066): 启动主要 needs 5+ energy; BP+1000 this turn, or BP+1000 during the opponent's next turn only", () => {
    const poor = setup();
    redEnergy(4, poor.a);
    const lone = field(poor.a, "front", K("066"));
    expect(() => poor.act("a", { type: "activate", uid: lone.uid, ability: 0 })).toThrow();

    const { game, a, act } = setup();
    redEnergy(5, a);
    const kasumi = field(a, "front", K("066"));
    act("a", { type: "activate", uid: kasumi.uid, ability: 0 });
    expect(choice(game, "a").options).toEqual(["m:0", "m:1"]);
    pick(act, "a", ["m:0"]);
    expect(bpOf(ctx, kasumi)).toBe(4000);
    leaveAttackPhase(game, act, "a");
    expect(game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, kasumi)).toBe(3000);

    const second = setup();
    redEnergy(5, second.a);
    const k2 = field(second.a, "front", K("066"));
    second.act("a", { type: "activate", uid: k2.uid, ability: 0 });
    pick(second.act, "a", ["m:1"]);
    expect(bpOf(ctx, k2)).toBe(3000); // not in our own turn
    leaveAttackPhase(second.game, second.act, "a");
    expect(second.game.turnPlayerId).toBe("b");
    expect(bpOf(ctx, k2)).toBe(4000);
    leaveAttackPhase(second.game, second.act, "b");
    expect(second.game.turnPlayerId).toBe("a");
    expect(bpOf(ctx, k2)).toBe(3000);
  });
});
