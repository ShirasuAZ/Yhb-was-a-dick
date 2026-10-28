/**
 * JJK batch 3 (purple UA02BT/JJK-1-070 ... 100, blue EX04BT/JJK-1-040, yellow EX04BT/JJK-3-001 ... 003): one test per card (more where a card has
 * several abilities), set up as its printed text describes and checked against the text. Card text comes from Cards/cards.json (no card art here).
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, damageOf, energyOf, hasKeyword, impactOf, type EngineGame, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { choice, ctx, energy, field, FILLER, setup } from "./ability-harness.ts";

const J = (n: string): string => `UA02BT/JJK-1-${n}`;
const K = (n: string): string => `EX04BT/JJK-3-${n}`;
const X40 = "EX04BT/JJK-1-040";
// Helper cards without abilities.
const GUARD = "UC01ST/ARK-1-103"; // blue, cost 3, BP3000
const BLUE0 = "UC01BT/ARK-1-039"; // 阿米娅: blue, cost 0, BP1500
const PURPLE0 = "UCEX01BT/ARK-2-047"; // 阿米娅: purple, cost 0, BP1500, makes 1 purple energy
const RED0 = "UC01BT/ARK-1-088"; // 九: red, cost 0, BP2000
const JUNPEI = J("073"); // 吉野 顺平:异形: purple, 改造人类, cost 1, BP2500, no ability
const MAHITO = J("091"); // 真人: purple, cost 0, BP1500, no ability
const MAHITO_2 = J("092"); // 真人: purple, cost 3, makes 2 purple energy
const ALINA = "UCEX01BT/ARK-2-025"; // 阿丽娜: 无法移动至前线

type Act = (who: string, action: UnionArenaAction) => void;
const pick = (act: Act, who: string, picks: string[]): void => act(who, { type: "choose", picks });
const refresh = (act: Act, who = "a"): void => act(who, { type: "manual", manual: { op: "ap", apId: `${who}:ap0`, act: "activate" } });
const sidelineByHand = (act: Act, card: UnionArenaFieldCard, who = "a"): void => act(who, { type: "manual", manual: { op: "field", owner: "you", uid: card.uid, act: "sideline" } });
const activeAp = (player: { ap: Array<{ rested: boolean }> }): number => player.ap.filter((card) => !card.rested).length;
const resolveDamage = (act: Act, attackerId: string, defender: EnginePlayer): void => {
  const lifeId = defender.life[0]!.id;
  act(attackerId, { type: "damage", lifeIds: [lifeId] });
  act(defender.accountId, { type: "trigger", lifeId, activate: false });
};
const names = (cardIds: Array<string | null>): string[] => cardIds.map((cardId) => (cardId ? ctx.card(cardId)?.name ?? "?" : "-"));
const sorted = (values: string[]): string[] => [...values].sort();
const cardsOf = (game: EngineGame): Array<string | null> => choice(game).cards;

/** Steps `who`'s turn forward until their attack phase has ended (and on through the end phase, so the turn passes). */
const leaveAttackPhase = (game: EngineGame, act: Act, who: string): void => {
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
  "UA02BT/JJK-1-070", "UA02BT/JJK-1-071", "UA02BT/JJK-1-072", "UA02BT/JJK-1-074", "UA02BT/JJK-1-075", "UA02BT/JJK-1-077", "UA02BT/JJK-1-078", "UA02BT/JJK-1-080",
  "UA02BT/JJK-1-081", "UA02BT/JJK-1-082", "UA02BT/JJK-1-083", "UA02BT/JJK-1-084", "UA02BT/JJK-1-085", "UA02BT/JJK-1-086", "UA02BT/JJK-1-087", "UA02BT/JJK-1-088",
  "UA02BT/JJK-1-089", "UA02BT/JJK-1-090", "UA02BT/JJK-1-092", "UA02BT/JJK-1-093", "UA02BT/JJK-1-094", "UA02BT/JJK-1-095", "UA02BT/JJK-1-096", "UA02BT/JJK-1-097",
  "UA02BT/JJK-1-098", "UA02BT/JJK-1-099", "UA02BT/JJK-1-100", "EX04BT/JJK-1-040", "EX04BT/JJK-3-001", "EX04BT/JJK-3-002", "EX04BT/JJK-3-003"
];

describe("JJK 3 batch", () => {
  it("every card of the batch plays automatically", () => {
    expect(BATCH).toHaveLength(31);
    for (const number of BATCH) expect(isAutomated(titleCard(number)), number).toBe(true);
  });

  it("虎杖 悠仁 (EX04BT 1-040): 登场时 returns up to one opposing front-line character of BP 4000 or less to the hand; also after a Raid", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, BLUE0);
    const t1 = field(b, "front", FILLER);
    const t2 = field(b, "front", GUARD);
    const big = field(b, "front", J("012")); // BP 5000
    const back = field(b, "energy", FILLER);
    a.hand.push(X40);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([t1.uid, t2.uid]));
    pick(act, "a", [t2.uid]);
    expect(b.hand).toEqual([GUARD]);
    expect(b.front).toEqual([t1, big]);
    expect(b.energy).toEqual([back]);

    // Raid onto 虎杖 悠仁; "最多1张": none may be picked.
    const second = setup();
    energy(second.a, 4, BLUE0);
    const base = field(second.a, "front", J("037"), true); // 虎杖 悠仁 (no Raid itself)
    const target = field(second.b, "front", FILLER);
    second.a.hand.push(X40);
    second.act("a", { type: "raid", handIndex: 0, targetUid: base.uid });
    expect(base.cardId).toBe(X40);
    expect(base.rested).toBe(false);
    expect(choice(second.game, "a").options).toEqual([target.uid]);
    pick(second.act, "a", []);
    expect(second.b.front).toEqual([target]);
    expect(second.b.hand).toEqual([]);
  });

  it("高田 (070): 登场时 returns another cost-1-or-less character to the hand; with none, returns itself", () => {
    const { game, a, act } = setup();
    energy(a, 1, MAHITO_2); // cost 3: not a candidate
    const c1 = field(a, "front", PURPLE0);
    const c2 = field(a, "energy", BLUE0);
    const big = field(a, "front", GUARD);
    a.hand.push(J("070"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([c1.uid, c2.uid]));
    pick(act, "a", [c1.uid]);
    expect(a.hand).toEqual([PURPLE0]);
    expect(a.front.map((card) => card.cardId)).toEqual([GUARD, J("070")]);
    expect(a.energy).toContain(c2);
    expect(a.front).toContain(big);

    const second = setup();
    energy(second.a, 1, MAHITO_2);
    field(second.a, "front", GUARD);
    second.a.hand.push(J("070"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([J("070")]);
    expect(second.a.front.map((card) => card.cardId)).toEqual([GUARD]);
  });

  it("吉野 顺平 (071): 启动主要 rests it for +1 purple energy this turn, once per turn; it is sidelined when the main phase ends", () => {
    const { game, a, act } = setup();
    const junpei = field(a, "energy", J("071"));
    expect(energyOf(ctx, a, "purple")).toBe(1);
    act("a", { type: "activate", uid: junpei.uid, ability: 0 });
    expect(junpei.rested).toBe(true);
    expect(energyOf(ctx, a, "purple")).toBe(2);
    expect(() => act("a", { type: "activate", uid: junpei.uid, ability: 0 })).toThrow();
    act("a", { type: "next_phase" });
    expect(game.pending).toBeNull();
    expect(a.energy).toHaveLength(0);
    expect(a.sideline).toEqual([J("071")]);

    // Not used: it stays.
    const second = setup();
    field(second.a, "energy", J("071"));
    second.act("a", { type: "next_phase" });
    expect(second.a.energy).toHaveLength(1);
    expect(second.a.sideline).toEqual([]);
  });

  it("被改造的人类 (072): 启动主要 rests and sidelines itself, then an opposing front-line character gets BP-1000 this turn", () => {
    const { game, a, b, act } = setup();
    const human = field(a, "energy", J("072"));
    const t1 = field(b, "front", FILLER);
    const t2 = field(b, "front", GUARD);
    const back = field(b, "energy", GUARD);
    act("a", { type: "activate", uid: human.uid, ability: 0 });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([J("072")]);
    expect(sorted(choice(game, "a").options)).toEqual(sorted([t1.uid, t2.uid]));
    pick(act, "a", [t2.uid]);
    expect(bpOf(ctx, t2)).toBe(2000);
    expect(bpOf(ctx, t1)).toBe(1500);
    expect(bpOf(ctx, back)).toBe(3000);
    // The BP reduction ends with the turn.
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, t2)).toBe(3000);

    // Nothing on their front line: the cost is still paid and nothing else happens.
    const second = setup();
    const h2 = field(second.a, "front", J("072"));
    second.act("a", { type: "activate", uid: h2.uid, ability: 0 });
    expect(second.game.pending).toBeNull();
    expect(second.a.sideline).toEqual([J("072")]);
  });

  it("究极 机械丸 (074): +1 purple energy while it is active", () => {
    const { a, act } = setup();
    const kokichi = field(a, "energy", J("074"));
    refresh(act);
    expect(energyOf(ctx, a, "purple")).toBe(2);
    kokichi.rested = true;
    refresh(act);
    expect(energyOf(ctx, a, "purple")).toBe(1);
  });

  it("庵 歌姬 (075): looks at 3, reveals up to one 京都校 into the hand, the rest go to the bottom, then a hand card is put into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1, PURPLE0);
    const rest = a.library.slice(5);
    a.library = [J("074"), GUARD, J("078"), FILLER, GUARD, ...rest];
    a.hand.push(J("075"), RED0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(names(choice(game, "a").cards)).toEqual(["究极 机械丸", "禅院 真依"]);
    expect(choice(game).options).toEqual(["l:0", "l:2"]);
    pick(act, "a", ["l:2"]);
    expect(a.hand).toEqual([RED0, J("078")]);
    pick(act, "a", ["l:1", "l:0"]); // the two left, in the order picked
    expect(a.library.slice(0, 2)).toEqual([FILLER, GUARD]);
    expect(a.library.slice(-2)).toEqual([GUARD, J("074")]);
    // 加入手牌的场合: one hand card goes to the sideline.
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([J("078")]);
    expect(a.sideline).toEqual([RED0]);

    // Revealing nothing: no hand card is put into the sideline.
    const second = setup();
    energy(second.a, 1, PURPLE0);
    second.a.library = [J("074"), GUARD, J("078"), ...second.a.library.slice(3)];
    second.a.hand.push(J("075"), RED0);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    pick(second.act, "a", ["l:0", "l:1", "l:2"]);
    expect(second.a.hand).toEqual([RED0]);
    expect(second.a.sideline).toEqual([]);
    expect(second.game.pending).toBeNull();

    // No 京都校 among the three: only the order is asked.
    const third = setup();
    energy(third.a, 1, PURPLE0);
    third.a.library = [GUARD, FILLER, GUARD, ...third.a.library.slice(3)];
    third.a.hand.push(J("075"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(third.game).options).toEqual(["l:0", "l:1", "l:2"]);
    pick(third.act, "a", ["l:0", "l:1", "l:2"]);
    expect(third.a.hand).toEqual([]);
  });

  it("加茂 宪纪 (077): 攻击时 gives up to one opposing front-line character BP-1000 this turn", () => {
    const { game, a, b, act } = setup("attack");
    const kamo = field(a, "front", J("077"));
    const t1 = field(b, "front", FILLER);
    const t2 = field(b, "front", GUARD);
    const back = field(b, "energy", FILLER);
    act("a", { type: "attack", attackerUid: kamo.uid });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([t1.uid, t2.uid]));
    expect(choice(game).options).not.toContain(back.uid);
    pick(act, "a", [t2.uid]);
    expect(bpOf(ctx, t2)).toBe(2000);
    expect(bpOf(ctx, t1)).toBe(1500);
    expect(game.pending?.kind).toBe("block");

    // "最多1张": none.
    const second = setup("attack");
    const k2 = field(second.a, "front", J("077"));
    const target = field(second.b, "front", GUARD);
    second.act("a", { type: "attack", attackerUid: k2.uid });
    pick(second.act, "a", []);
    expect(bpOf(ctx, target)).toBe(3000);
  });

  it("禅院 真依 (078): 登场时 gives up to one other character BP+1000 this turn", () => {
    const { game, a, act } = setup();
    const other = field(a, "front", FILLER);
    const back = field(a, "energy", BLUE0);
    a.hand.push(J("078"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const mai = a.front.find((card) => card.cardId === J("078"))!;
    expect(sorted(choice(game, "a").options)).toEqual(sorted([other.uid, back.uid]));
    pick(act, "a", [other.uid]);
    expect(bpOf(ctx, other)).toBe(2500);
    expect(bpOf(ctx, back)).toBe(1500);
    expect(bpOf(ctx, mai)).toBe(1000);

    const second = setup();
    const o2 = field(second.a, "front", FILLER);
    second.a.hand.push(J("078"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(bpOf(ctx, o2)).toBe(1500);
  });

  it("东堂 葵 (080): BP+500 with 〈高田〉 on our field; 启动主要 discards a card for 伤害2 this turn, once per turn", () => {
    const { a, b, act } = setup();
    const todo = field(a, "front", J("080"));
    refresh(act);
    expect(bpOf(ctx, todo)).toBe(3500);
    field(b, "front", J("070")); // the opponent's 高田 does not count
    refresh(act);
    expect(bpOf(ctx, todo)).toBe(3500);
    field(a, "energy", J("070"));
    refresh(act);
    expect(bpOf(ctx, todo)).toBe(4000);

    // No hand card to discard: cannot be used.
    expect(() => act("a", { type: "activate", uid: todo.uid, ability: 1 })).toThrow();
    a.hand.push(FILLER, GUARD);
    expect(damageOf(ctx, todo)).toBe(1);
    act("a", { type: "activate", uid: todo.uid, ability: 1 });
    pick(act, "a", ["h:1"]);
    expect(a.hand).toEqual([FILLER]);
    expect(a.sideline).toEqual([GUARD]);
    expect(hasKeyword(ctx, todo, "伤害2")).toBe(true);
    expect(damageOf(ctx, todo)).toBe(2);
    expect(() => act("a", { type: "activate", uid: todo.uid, ability: 1 })).toThrow();
    // 高田 leaves: back to 3500 (and the keyword ends with the turn).
    a.energy = [];
    refresh(act);
    expect(bpOf(ctx, todo)).toBe(3500);
    act("a", { type: "end_turn" });
    expect(damageOf(ctx, todo)).toBe(1);
  });

  it("东堂 葵 (081): 登场时 BP+2000, and may swap an opposing front-line and energy-line character", () => {
    const { game, a, b, act } = setup();
    energy(a, 5, PURPLE0);
    const bf = field(b, "front", GUARD);
    const be = field(b, "energy", FILLER);
    a.hand.push(J("081"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const todo = a.front.find((card) => card.cardId === J("081"))!;
    expect(bpOf(ctx, todo)).toBe(6000);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(game.pending).toBeNull(); // one card on each line: both are picked at once
    expect(b.front).toEqual([be]);
    expect(b.energy).toEqual([bf]);
    expect(a.front).toContain(todo); // our own field is untouched

    // Declined: the lines stay as they are (BP+2000 still applies).
    const second = setup();
    energy(second.a, 5, PURPLE0);
    const f2 = field(second.b, "front", GUARD);
    const e2 = field(second.b, "energy", FILLER);
    second.a.hand.push(J("081"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["no"]);
    expect(second.b.front).toEqual([f2]);
    expect(second.b.energy).toEqual([e2]);

    // With several on each line, we pick one on each.
    const third = setup();
    energy(third.a, 5, PURPLE0);
    const f3a = field(third.b, "front", GUARD);
    const f3b = field(third.b, "front", FILLER);
    const e3a = field(third.b, "energy", BLUE0);
    const e3b = field(third.b, "energy", RED0);
    third.a.hand.push(J("081"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", ["yes"]);
    expect(sorted(choice(third.game, "a").options)).toEqual(sorted([f3a.uid, f3b.uid]));
    pick(third.act, "a", [f3b.uid]);
    expect(sorted(choice(third.game, "a").options)).toEqual(sorted([e3a.uid, e3b.uid]));
    pick(third.act, "a", [e3a.uid]);
    expect(third.b.front).toEqual([f3a, e3a]);
    expect(third.b.energy).toEqual([f3b, e3b]); // each card takes the other one's place

    // No question when the swap is impossible: an empty energy line, or only a card that cannot go to the front line.
    const fourth = setup();
    energy(fourth.a, 5, PURPLE0);
    field(fourth.b, "front", GUARD);
    fourth.a.hand.push(J("081"));
    fourth.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(fourth.game.pending).toBeNull();
    const fifth = setup();
    energy(fifth.a, 5, PURPLE0);
    field(fifth.b, "front", GUARD);
    field(fifth.b, "energy", ALINA);
    fifth.a.hand.push(J("081"));
    fifth.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(fifth.game.pending).toBeNull();
  });

  it("东堂 葵 (081): the same happens after a Raid onto 〈东堂 葵〉", () => {
    const { game, a, b, act } = setup();
    energy(a, 5, PURPLE0);
    const base = field(a, "front", J("079"), true);
    const bf = field(b, "front", GUARD);
    const be = field(b, "energy", FILLER);
    a.hand.push(J("081"));
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid });
    expect(base.cardId).toBe(J("081"));
    expect(bpOf(ctx, base)).toBe(6000);
    expect(damageOf(ctx, base)).toBe(2);
    pick(act, "a", ["yes"]);
    expect(b.front).toEqual([be]);
    expect(b.energy).toEqual([bf]);
    expect(game.pending).toBeNull();
  });

  it("西宫 桃 (082): 登场时 puts a 京都校 card of cost 2 or less and AP 1 from the hand onto the field, resting", () => {
    const { game, a, act } = setup();
    energy(a, 3, PURPLE0);
    a.hand.push(J("082"), J("078"), J("080"), J("083"), GUARD, J("084"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    // 禅院 真依 (0) and 三轮 霞 (2) qualify; 东堂 葵 costs 3, 三轮 霞 (084) costs 4 and 2 AP, Guard has no 京都校.
    expect(names(choice(game, "a").cards)).toEqual(["禅院 真依", "三轮 霞"]);
    expect(choice(game).options).toEqual(["h:0", "h:2"]);
    pick(act, "a", ["h:2"]);
    expect(choice(game, "a").options).toEqual(["line:front", "line:energy"]);
    const library = a.library.length;
    pick(act, "a", ["line:energy"]);
    const kasumi = a.energy.find((card) => card.cardId === J("083"))!;
    expect(kasumi.rested).toBe(true);
    expect(a.library).toHaveLength(library - 1); // its own 登场时 (draw) happened
    expect(a.hand).toEqual([J("078"), J("080"), GUARD, J("084"), FILLER]);

    // Nothing qualifies: nothing happens.
    const second = setup();
    energy(second.a, 3, PURPLE0);
    second.a.hand.push(J("082"), GUARD, J("080"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([GUARD, J("080")]);
  });

  it("三轮 霞 (083): 登场时 draws a card", () => {
    const { game, a, act } = setup();
    energy(a, 2, PURPLE0);
    a.hand.push(J("083"));
    const library = a.library.length;
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(game.pending).toBeNull();
    expect(a.hand).toHaveLength(1);
    expect(a.library).toHaveLength(library - 1);
  });

  it("三轮 霞 (084): 登场时 gives an opposing front-line character BP-1000 for each other 京都校 on the same line", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, MAHITO_2); // 4 purple energy on two cards
    field(a, "front", J("078"));
    field(a, "front", J("083"));
    field(a, "front", PURPLE0); // not 京都校
    field(a, "energy", J("078")); // the other line does not count
    const target = field(b, "front", GUARD);
    const back = field(b, "energy", GUARD);
    a.hand.push(J("084"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([target.uid]);
    expect(damageOf(ctx, a.front.find((card) => card.cardId === J("084"))!)).toBe(1);
    pick(act, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(1000);
    expect(bpOf(ctx, back)).toBe(3000);

    // On the energy line only the energy line counts (one other 京都校 there).
    const second = setup();
    energy(second.a, 2, MAHITO_2);
    field(second.a, "front", J("078"));
    field(second.a, "front", J("083"));
    field(second.a, "energy", J("078"));
    const t2 = field(second.b, "front", GUARD);
    second.a.hand.push(J("084"));
    second.act("a", { type: "play", handIndex: 0, line: "energy" });
    pick(second.act, "a", [t2.uid]);
    expect(bpOf(ctx, t2)).toBe(2000);

    // No other 京都校 on that line: no reduction. "最多1张": may pick none.
    const third = setup();
    energy(third.a, 2, MAHITO_2);
    const t3 = field(third.b, "front", GUARD);
    third.a.hand.push(J("084"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", [t3.uid]);
    expect(bpOf(ctx, t3)).toBe(3000);
  });

  it("三轮 霞 (084): 必须尽可能阻挡 — it blocks at once when it can (no question), and 阻挡时 gives the attacker BP-1000 per other 京都校 on its line", () => {
    const { game, a, b, act } = setup("attack", "b");
    const kasumi = field(a, "front", J("084"));
    field(a, "front", J("078"));
    field(a, "front", J("083"));
    field(a, "front", GUARD); // another possible blocker is not asked about
    field(a, "energy", J("078")); // another line
    const attacker = field(b, "front", GUARD);
    const lives = a.life.length;
    act("b", { type: "attack", attackerUid: attacker.uid });
    expect(game.pending).toBeNull();
    expect(kasumi.blocks).toBe(1);
    expect(kasumi.rested).toBe(true);
    expect(bpOf(ctx, attacker)).toBe(1000); // 3000 - 2 * 1000
    expect(a.life).toHaveLength(lives);
    expect(b.front).toEqual([attacker]); // it lost the battle but is not sidelined by it
  });

  it("三轮 霞 (084): when it cannot block (resting) the defender is asked as usual", () => {
    const { game, a, b, act } = setup("attack", "b");
    const kasumi = field(a, "front", J("084"), true);
    const guard = field(a, "front", GUARD);
    const attacker = field(b, "front", FILLER);
    act("b", { type: "attack", attackerUid: attacker.uid });
    expect(game.pending?.kind).toBe("block");
    expect(game.pending?.playerId).toBe("a");
    act("a", { type: "block", blockerUid: null });
    expect(game.pending?.kind).toBe("damage");
    expect(kasumi.blocks).toBe(0);
    expect(guard.blocks).toBe(0);

    // Only it can block and it is active: it still blocks without the question; the attack cannot hit the player.
    const second = setup("attack", "b");
    const k2 = field(second.a, "front", J("084"));
    const atk = field(second.b, "front", FILLER);
    const life = second.a.life.length;
    second.act("b", { type: "attack", attackerUid: atk.uid });
    expect(second.game.pending).toBeNull();
    expect(k2.blocks).toBe(1);
    expect(bpOf(ctx, atk)).toBe(1500); // no other 京都校: no reduction
    expect(second.a.life).toHaveLength(life);
  });

  it("吉野 顺平&淀月 (085): 登场时 with 〈真人〉 on our field may put the top 3 cards of the deck into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1, PURPLE0);
    field(a, "energy", MAHITO);
    a.library = [GUARD, BLUE0, RED0, ...a.library];
    const library = a.library.length;
    a.hand.push(J("085"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.sideline).toEqual([GUARD, BLUE0, RED0]);
    expect(a.library).toHaveLength(library - 3);

    // "可以": declined.
    const second = setup();
    energy(second.a, 1, PURPLE0);
    field(second.a, "front", MAHITO);
    second.a.hand.push(J("085"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", ["no"]);
    expect(second.a.sideline).toEqual([]);

    // Without 〈真人〉 (the opponent's does not count): no question.
    const third = setup();
    energy(third.a, 1, PURPLE0);
    field(third.b, "front", MAHITO);
    third.a.hand.push(J("085"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(third.game.pending).toBeNull();
    expect(third.a.sideline).toEqual([]);
  });

  it("吉野 顺平&淀月 (085): 退场时 with 〈真人〉 on our field puts 〈吉野 顺平：异形〉 from the hand or sideline onto the field, resting", () => {
    const { game, a, act } = setup();
    const pair = field(a, "front", J("085"));
    field(a, "energy", MAHITO);
    a.hand.push(GUARD, JUNPEI);
    sidelineByHand(act, pair);
    expect(names(choice(game, "a").cards)).toEqual(["吉野 顺平:异形"]);
    pick(act, "a", ["h:1"]);
    expect(choice(game, "a").options).toEqual(["line:front", "line:energy"]);
    pick(act, "a", ["line:front"]);
    expect(a.front.map((card) => card.cardId)).toEqual([JUNPEI]);
    expect(a.front[0]!.rested).toBe(true);
    expect(a.hand).toEqual([GUARD]);

    // None in the hand: from the sideline.
    const second = setup();
    const p2 = field(second.a, "front", J("085"));
    field(second.a, "front", MAHITO);
    second.a.sideline.push(GUARD, JUNPEI);
    sidelineByHand(second.act, p2);
    expect(choice(second.game, "a").options).toEqual(["s:1"]);
    pick(second.act, "a", ["s:1"]);
    pick(second.act, "a", ["line:energy"]);
    expect(second.a.energy.map((card) => card.cardId)).toEqual([JUNPEI]);
    expect(second.a.sideline).toEqual([GUARD, J("085")]);

    // Without 〈真人〉 nothing happens.
    const third = setup();
    const p3 = field(third.a, "front", J("085"));
    third.a.hand.push(JUNPEI);
    sidelineByHand(third.act, p3);
    expect(third.game.pending).toBeNull();
    expect(third.a.hand).toEqual([JUNPEI]);
  });

  it("漏瑚 (086): 登场时 gives up to one opposing front-line character BP-1000 this turn", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, PURPLE0);
    const t1 = field(b, "front", GUARD);
    const back = field(b, "energy", GUARD);
    a.hand.push(J("086"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([t1.uid]);
    pick(act, "a", [t1.uid]);
    expect(bpOf(ctx, t1)).toBe(2000);
    expect(bpOf(ctx, back)).toBe(3000);
    const second = setup();
    energy(second.a, 3, PURPLE0);
    const t2 = field(second.b, "front", GUARD);
    second.a.hand.push(J("086"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(bpOf(ctx, t2)).toBe(3000);
  });

  it("漏瑚 (087): 登场时 sidelines up to one opposing front-line character of BP 3000 or less", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, PURPLE0);
    const small = field(b, "front", FILLER);
    const guard = field(b, "front", GUARD);
    const big = field(b, "front", J("012")); // BP 5000
    a.hand.push(J("087"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([small.uid, guard.uid]));
    pick(act, "a", [guard.uid]);
    expect(b.front).toEqual([small, big]);
    expect(b.sideline).toEqual([GUARD]);

    // Raid onto 漏瑚; "最多1张".
    const second = setup();
    energy(second.a, 4, PURPLE0);
    const base = field(second.a, "front", J("086"), true);
    const t2 = field(second.b, "front", GUARD);
    second.a.hand.push(J("087"));
    second.act("a", { type: "raid", handIndex: 0, targetUid: base.uid });
    pick(second.act, "a", []);
    expect(second.b.front).toEqual([t2]);
  });

  it("陀艮 (088): 退场时 draws a card", () => {
    const { game, a, act } = setup();
    const tongen = field(a, "front", J("088"));
    const library = a.library.length;
    sidelineByHand(act, tongen);
    expect(game.pending).toBeNull();
    expect(a.hand).toHaveLength(1);
    expect(a.library).toHaveLength(library - 1);
    expect(a.sideline).toEqual([J("088")]);
  });

  it("花御 (089): required energy -1 while the opponent has a yellow or blue card", () => {
    const { game, b, players } = setup();
    const cost = (): number => costOf(game, players, ctx, "a", J("089")).energy;
    expect(cost()).toBe(3);
    field(b, "front", PURPLE0);
    field(b, "energy", RED0);
    expect(cost()).toBe(3);
    field(b, "energy", BLUE0);
    expect(cost()).toBe(2);
    const second = setup();
    field(second.b, "front", FILLER); // yellow
    expect(costOf(second.game, second.players, ctx, "a", J("089")).energy).toBe(2);
    // Our own cards do not count.
    const third = setup();
    field(third.a, "front", FILLER);
    expect(costOf(third.game, third.players, ctx, "a", J("089")).energy).toBe(3);
  });

  it("花御 (090): only the 冲击无效 keyword line; the keyword comes from the card data", () => {
    expect(ctx.card(J("090"))!.keywords).toEqual(["冲击无效"]);
    expect(ctx.card(J("090"))!.abilities).toBeUndefined();
    expect(isAutomated(titleCard(J("090")))).toBe(true);
  });

  it("真人 (092): 启动主要 sidelines another character; then the deck may be milled by 3 and a 改造人类 character comes from the hand, active", () => {
    const { game, a, act } = setup();
    const mahito = field(a, "front", MAHITO_2);
    const v1 = field(a, "front", FILLER);
    const v2 = field(a, "energy", BLUE0);
    field(a, "front", MAHITO); // another 真人 cannot be picked either
    a.hand.push(GUARD, JUNPEI);
    a.library = [BLUE0, RED0, GUARD, ...a.library];
    const library = a.library.length;
    act("a", { type: "activate", uid: mahito.uid, ability: 0 });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([v1.uid, v2.uid]));
    pick(act, "a", [v1.uid]);
    expect(a.sideline).toEqual([FILLER]);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.sideline).toEqual([FILLER, BLUE0, RED0, GUARD]);
    expect(a.library).toHaveLength(library - 3);
    expect(names(choice(game, "a").cards)).toEqual(["吉野 顺平:异形"]);
    expect(choice(game).options).toEqual(["h:1"]);
    pick(act, "a", ["h:1"]);
    pick(act, "a", ["line:energy"]);
    const junpei = a.energy.find((card) => card.cardId === JUNPEI)!;
    expect(junpei.rested).toBe(false);
    expect(a.hand).toEqual([GUARD]);
    // 每回合1次.
    expect(() => act("a", { type: "activate", uid: mahito.uid, ability: 0 })).toThrow();
  });

  it("真人 (092): the milling is optional; a 改造人类 card can come from the sideline; nothing happens without a character to sideline", () => {
    const { game, a, act } = setup();
    const mahito = field(a, "front", MAHITO_2);
    field(a, "front", FILLER);
    field(a, "front", BLUE0);
    a.sideline.push(J("072"));
    const library = a.library.length;
    act("a", { type: "activate", uid: mahito.uid, ability: 0 });
    pick(act, "a", [a.front[1]!.uid]);
    pick(act, "a", ["no"]);
    expect(a.library).toHaveLength(library);
    // No 改造人类 in the hand: the sideline is offered.
    expect(names(choice(game, "a").cards)).toEqual(["被改造的人类"]);
    pick(act, "a", ["s:0"]);
    pick(act, "a", ["line:front"]);
    expect(a.front.map((card) => card.cardId)).toEqual([MAHITO_2, BLUE0, J("072")]);
    expect(a.front[2]!.rested).toBe(false);

    // Only 真人 on the field: there is nothing to sideline, so nothing else happens.
    const second = setup();
    const m2 = field(second.a, "front", MAHITO_2);
    second.a.hand.push(JUNPEI);
    second.act("a", { type: "activate", uid: m2.uid, ability: 0 });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([JUNPEI]);
    expect(second.a.front).toEqual([m2]);

    // Only usable on the front line.
    const third = setup();
    const m3 = field(third.a, "energy", MAHITO_2);
    field(third.a, "front", FILLER);
    expect(() => third.act("a", { type: "activate", uid: m3.uid, ability: 0 })).toThrow();
  });

  it("真人 (093): 登场时 gives an opposing front-line character BP-2500 and adds a 改造人类 card or 〈自闭圆顿里〉 from the sideline to the hand", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, PURPLE0);
    const target = field(b, "front", GUARD);
    a.sideline.push(GUARD, J("094"), J("072"), JUNPEI, MAHITO);
    a.hand.push(J("093"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", [target.uid]);
    expect(bpOf(ctx, target)).toBe(500);
    expect(names(choice(game, "a").cards)).toEqual(["自闭圆顿里", "被改造的人类", "吉野 顺平:异形"]);
    pick(act, "a", ["s:2"]);
    expect(a.hand).toEqual([J("072")]);
    expect(a.sideline).toEqual([GUARD, J("094"), JUNPEI, MAHITO]);

    // Both parts are optional.
    const second = setup();
    energy(second.a, 4, PURPLE0);
    const t2 = field(second.b, "front", GUARD);
    second.a.sideline.push(J("094"));
    second.a.hand.push(J("093"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    pick(second.act, "a", []);
    expect(bpOf(ctx, t2)).toBe(3000);
    expect(second.a.hand).toEqual([]);
    expect(second.a.sideline).toEqual([J("094")]);
  });

  it("自闭圆顿里 (094): when our 〈真人〉 attacks, may sideline another character, then a 改造人类 card from the hand or sideline comes in active; once per turn", () => {
    const { game, a, b, act } = setup("attack");
    const site = field(a, "energy", J("094"));
    const m1 = field(a, "front", MAHITO);
    const m2 = field(a, "front", MAHITO);
    const v1 = field(a, "front", FILLER);
    const v2 = field(a, "energy", BLUE0);
    a.hand.push(JUNPEI);
    act("a", { type: "attack", attackerUid: m1.uid });
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(sorted(choice(game, "a").options)).toEqual(sorted([v1.uid, v2.uid]));
    pick(act, "a", [v1.uid]);
    expect(a.sideline).toEqual([FILLER]);
    expect(names(choice(game, "a").cards)).toEqual(["吉野 顺平:异形"]);
    pick(act, "a", ["h:0"]);
    pick(act, "a", ["line:front"]);
    const junpei = a.front.find((card) => card.cardId === JUNPEI)!;
    expect(junpei.rested).toBe(false);
    expect(site.used).toContain(0);
    expect(game.pending?.kind).toBe("damage");
    resolveDamage(act, "a", b);
    // The second 〈真人〉: used up this turn.
    act("a", { type: "attack", attackerUid: m2.uid });
    expect(game.pending?.kind).toBe("damage");
    expect(a.energy).toContain(v2);
  });

  it("自闭圆顿里 (094): other attackers do not trigger it; declining keeps the use for a later 〈真人〉 attack", () => {
    const { game, a, b, act } = setup("attack");
    const site = field(a, "energy", J("094"));
    const plain = field(a, "front", FILLER);
    const m1 = field(a, "front", MAHITO);
    const m2 = field(a, "front", MAHITO);
    field(a, "front", BLUE0);
    act("a", { type: "attack", attackerUid: plain.uid });
    expect(game.pending?.kind).toBe("damage");
    resolveDamage(act, "a", b);
    expect(site.used ?? []).toEqual([]);
    act("a", { type: "attack", attackerUid: m1.uid });
    pick(act, "a", ["no"]);
    expect(site.used ?? []).toEqual([]);
    expect(game.pending?.kind).toBe("damage");
    resolveDamage(act, "a", b);
    act("a", { type: "attack", attackerUid: m2.uid });
    expect(choice(game, "a").purpose).toBe("confirm");
  });

  it("自闭圆顿里 (094): no question without a character other than 〈真人〉; only our own 〈真人〉 counts", () => {
    const { game, a, b, act } = setup("attack");
    field(a, "energy", J("094"));
    const m1 = field(a, "front", MAHITO);
    field(a, "energy", MAHITO_2);
    act("a", { type: "attack", attackerUid: m1.uid });
    expect(game.pending?.kind).toBe("damage");
    expect(b.life).toHaveLength(7);
  });

  it("火砾虫 (095): sidelines an opposing front-line character of BP 2500 or less; with 〈漏瑚〉 on our field it also draws", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, PURPLE0);
    field(a, "front", J("086")); // 漏瑚
    const t1 = field(b, "front", FILLER);
    const t2 = field(b, "front", BLUE0);
    const guard = field(b, "front", GUARD);
    a.hand.push(J("095"));
    const library = a.library.length;
    act("a", { type: "event", handIndex: 0 });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([t1.uid, t2.uid]));
    pick(act, "a", [t1.uid]);
    expect(b.front).toEqual([t2, guard]);
    expect(b.sideline).toEqual([FILLER]);
    expect(a.hand).toHaveLength(1);
    expect(a.library).toHaveLength(library - 1);

    // Without 〈漏瑚〉 (the opponent's does not count): no card is drawn.
    const second = setup();
    energy(second.a, 4, PURPLE0);
    field(second.b, "front", J("086"));
    const a1 = field(second.b, "front", FILLER);
    field(second.b, "front", BLUE0);
    second.a.hand.push(J("095"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", [a1.uid]);
    expect(second.a.hand).toEqual([]);
  });

  it("交流战 (096): adds a 京都校 character from the sideline to the hand, then puts an affordable AP-1 京都校 character from the hand onto the field, resting", () => {
    const { game, a, act } = setup();
    energy(a, 3, PURPLE0); // 3 purple: the event costs 3
    a.sideline.push(GUARD, J("078"), J("081"));
    a.hand.push(J("096"), J("083"), J("084"), J("081"), GUARD);
    act("a", { type: "event", handIndex: 0 });
    expect(names(choice(game, "a").cards)).toEqual(["禅院 真依", "东堂 葵"]);
    expect(choice(game).options).toEqual(["s:1", "s:2"]);
    pick(act, "a", ["s:1"]);
    expect(a.hand).toEqual([J("083"), J("084"), J("081"), GUARD, J("078")]);
    // Affordable (3 purple), AP 1, 京都校: 三轮 霞 (2) and 禅院 真依 (0). Not 三轮 霞 (4 energy, 2 AP), 东堂 葵 (5), Guard.
    expect(names(choice(game, "a").cards)).toEqual(["三轮 霞", "禅院 真依"]);
    pick(act, "a", ["h:4"]);
    expect(choice(game, "a").options).toEqual(["line:front", "line:energy"]);
    pick(act, "a", ["line:front"]);
    expect(a.front.map((card) => card.cardId)).toEqual([J("078")]);
    expect(a.front[0]!.rested).toBe(true);
    // The put card's own 登场时 (禅院 真依: BP+1000 to another character) happens.
    expect(choice(game, "a").sourceCardId).toBe(J("078"));
    pick(act, "a", []);
    expect(game.pending).toBeNull();
    expect(a.sideline).toEqual([GUARD, J("081"), J("096")]);

    // Both parts are optional.
    const second = setup();
    energy(second.a, 3, PURPLE0);
    second.a.sideline.push(J("078"));
    second.a.hand.push(J("096"), J("083"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", []);
    pick(second.act, "a", []);
    expect(second.a.hand).toEqual([J("083")]);
    expect(second.a.sideline).toEqual([J("078"), J("096")]);
    expect(second.a.front).toEqual([]);
  });

  it("交流战 (096): the hand card may Raid instead (resting is the other choice)", () => {
    const { game, a, act } = setup();
    energy(a, 5, PURPLE0);
    const base = field(a, "front", J("079"), true); // 东堂 葵 (cost 0)
    a.hand.push(J("096"), J("081"));
    act("a", { type: "event", handIndex: 0 });
    // Nothing in the sideline to take: no question about it.
    pick(act, "a", ["h:0"]);
    expect(choice(game, "a").labels).toEqual(["以休息状态登场", "发动突进"]);
    pick(act, "a", ["m:1"]);
    expect(base.cardId).toBe(J("081")); // the only target is picked at once
    expect(base.rested).toBe(false);
    expect(bpOf(ctx, base)).toBe(4000 + 2000);
    expect(a.hand).toEqual([]);
    expect(game.pending).toBeNull();

    // Resting is the other choice.
    const second = setup();
    energy(second.a, 5, PURPLE0);
    const b2 = field(second.a, "front", J("079"));
    second.a.hand.push(J("096"), J("081"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", ["h:0"]);
    pick(second.act, "a", ["m:0"]);
    pick(second.act, "a", ["line:front"]);
    expect(b2.cardId).toBe(J("079"));
    expect(second.a.front.map((card) => card.cardId)).toEqual([J("079"), J("081")]);
    expect(second.a.front[1]!.rested).toBe(true);
  });

  it("不存在的记忆 (097): BP+1000 for up to one 〈东堂 葵〉 and one other character; with both, 〈东堂 葵〉 also gains 冲击+1", () => {
    const { game, a, act } = setup();
    energy(a, 2, PURPLE0);
    const todo = field(a, "front", J("080"));
    const other = field(a, "front", FILLER);
    const back = field(a, "energy", BLUE0);
    a.hand.push(J("097"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual([todo.uid]);
    pick(act, "a", [todo.uid]);
    expect(choice(game, "a").options).toContain(other.uid);
    expect(choice(game).options).toContain(back.uid);
    expect(choice(game).options).not.toContain(todo.uid);
    pick(act, "a", [other.uid]);
    expect(bpOf(ctx, todo)).toBe(3500 + 1000);
    expect(bpOf(ctx, other)).toBe(2500);
    expect(bpOf(ctx, back)).toBe(1500);
    expect(impactOf(ctx, todo)).toBe(1);

    // Only 〈东堂 葵〉 picked: BP+1000 but no 冲击.
    const second = setup();
    energy(second.a, 2, PURPLE0);
    const t2 = field(second.a, "front", J("080"));
    const o2 = field(second.a, "front", FILLER);
    second.a.hand.push(J("097"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", [t2.uid]);
    pick(second.act, "a", []);
    expect(bpOf(ctx, t2)).toBe(4500);
    expect(bpOf(ctx, o2)).toBe(1500);
    expect(impactOf(ctx, t2)).toBe(0);

    // Only the other character picked.
    const third = setup();
    energy(third.a, 2, PURPLE0);
    const t3 = field(third.a, "front", J("080"));
    const o3 = field(third.a, "front", FILLER);
    third.a.hand.push(J("097"));
    third.act("a", { type: "event", handIndex: 0 });
    pick(third.act, "a", []);
    pick(third.act, "a", [o3.uid]);
    expect(bpOf(ctx, o3)).toBe(2500);
    expect(bpOf(ctx, t3)).toBe(3500);
    expect(impactOf(ctx, t3)).toBe(0);
  });

  it("不存在的记忆 (097): with a card that already has 冲击①, 冲击+1 raises it to 2", () => {
    const { a, act } = setup();
    energy(a, 2, PURPLE0);
    // 东堂 葵 (081) has 伤害2 only; 冲击+1 without 冲击 gives 冲击1.
    const todo = field(a, "front", J("081"));
    const other = field(a, "front", FILLER);
    a.hand.push(J("097"));
    act("a", { type: "event", handIndex: 0 });
    pick(act, "a", [todo.uid]);
    pick(act, "a", [other.uid]);
    expect(impactOf(ctx, todo)).toBe(1);
    expect(damageOf(ctx, todo)).toBe(2);
    expect(hasKeyword(ctx, todo, "冲击+1")).toBe(true);
  });

  it("不义游戏 (098): puts an opposing front-line character (BP 5000 or less) on the bottom of their deck; the opponent plays a cost-3-or-less character from their hand resting, without 登场时; draws with 〈东堂 葵〉", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, PURPLE0);
    field(a, "energy", J("079")); // 东堂 葵
    const t1 = field(b, "front", FILLER);
    const t2 = field(b, "front", GUARD);
    const strong = field(b, "front", J("012")); // BP 5000
    strong.bpMod = 500; // 5500: not allowed
    b.hand.push(GUARD, J("081"), J("083"), J("094"));
    a.hand.push(J("098"));
    const bLibrary = b.library.length;
    const aHand = a.hand.length - 1;
    act("a", { type: "event", handIndex: 0 });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([t1.uid, t2.uid]));
    pick(act, "a", [t2.uid]);
    expect(b.library[b.library.length - 1]).toBe(GUARD);
    expect(b.library).toHaveLength(bLibrary + 1);
    // Our draw (东堂 葵 on the field) and then the opponent's question, asked to the opponent about the opponent's hand.
    expect(a.hand).toHaveLength(aHand + 1);
    expect(choice(game, "b").playerId).toBe("b");
    expect(names(choice(game).cards)).toEqual(["Guard", "三轮 霞"]); // not 东堂 葵 (cost 5), not the site
    expect(choice(game).options).toEqual(["h:0", "h:2"]);
    pick(act, "b", ["h:2"]);
    const kasumi = b.front.find((card) => card.cardId === J("083"))!;
    expect(kasumi.rested).toBe(true);
    expect(b.hand).toEqual([GUARD, J("081"), J("094")]);
    // 通过此效果登场的角色不发动【登场时】效果: 三轮 霞 would draw a card.
    expect(b.library).toHaveLength(bLibrary + 1);
    expect(game.pending).toBeNull();
    expect(game.queue).toEqual([]);
    expect(a.sideline).toEqual([J("098")]);
  });

  it("不义游戏 (098): the opponent may play nothing; without 〈东堂 葵〉 there is no draw; nothing to play means no question", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, PURPLE0);
    const t1 = field(b, "front", FILLER);
    field(b, "front", GUARD);
    b.hand.push(GUARD);
    a.hand.push(J("098"));
    act("a", { type: "event", handIndex: 0 });
    pick(act, "a", [t1.uid]);
    expect(a.hand).toEqual([]);
    expect(choice(game, "b").options).toEqual(["h:0"]);
    pick(act, "b", []);
    expect(b.hand).toEqual([GUARD]);
    expect(b.front).toHaveLength(1);
    expect(game.pending).toBeNull();

    // The opponent's hand has nothing playable: no question, and the turn goes on.
    const second = setup();
    energy(second.a, 3, PURPLE0);
    const only = field(second.b, "front", FILLER);
    second.b.hand.push(J("081"), J("094"));
    second.a.hand.push(J("098"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.game.pending).toBeNull(); // the only target is picked at once
    expect(second.b.front).toEqual([]);
    expect(second.b.library[second.b.library.length - 1]).toBe(only.cardId);
    expect(second.b.hand).toEqual([J("081"), J("094")]);

    // Their played character goes onto the front line; with the front line otherwise full they would give up one first (4 cards max).
    const third = setup();
    energy(third.a, 3, PURPLE0);
    const tt = field(third.b, "front", FILLER);
    const keep = [field(third.b, "front", J("012")), field(third.b, "front", J("012")), field(third.b, "front", J("012"))];
    for (const card of keep) card.bpMod = 1000; // BP 6000: not a target
    third.b.hand.push(J("083"));
    third.a.hand.push(J("098"));
    third.act("a", { type: "event", handIndex: 0 });
    // 4 cards on the front line, one is the target: it leaves first, so there is room.
    expect(third.game.pending?.playerId).toBe("b");
    pick(third.act, "b", ["h:0"]);
    expect(third.b.front).toHaveLength(4);
    expect(third.b.front.some((card) => card.uid === tt.uid)).toBe(false);
    expect(third.b.removal).toEqual([]);
  });

  it("无为转变 (099): sidelines an opposing front-line character of BP 3000 or less; may mill 3; with 〈真人〉 on our field a 改造人类 card comes in active", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, PURPLE0);
    field(a, "front", MAHITO);
    const t1 = field(b, "front", FILLER);
    const t2 = field(b, "front", GUARD);
    const big = field(b, "front", J("012"));
    a.hand.push(J("099"), JUNPEI);
    a.library = [BLUE0, RED0, GUARD, ...a.library];
    const library = a.library.length;
    act("a", { type: "event", handIndex: 0 });
    expect(sorted(choice(game, "a").options)).toEqual(sorted([t1.uid, t2.uid]));
    pick(act, "a", [t2.uid]);
    expect(b.front).toEqual([t1, big]);
    expect(b.sideline).toEqual([GUARD]);
    expect(choice(game, "a").purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.library).toHaveLength(library - 3);
    expect(a.sideline).toEqual([BLUE0, RED0, GUARD]);
    expect(names(choice(game, "a").cards)).toEqual(["吉野 顺平:异形"]);
    pick(act, "a", ["h:0"]);
    pick(act, "a", ["line:front"]);
    const junpei = a.front.find((card) => card.cardId === JUNPEI)!;
    expect(junpei.rested).toBe(false);
    expect(game.pending).toBeNull();
  });

  it("无为转变 (099): the milling is optional; without 〈真人〉 no 改造人类 card comes in; without a sidelined opposing character neither does", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, PURPLE0);
    const t1 = field(b, "front", FILLER);
    field(b, "front", BLUE0);
    a.hand.push(J("099"), JUNPEI);
    const library = a.library.length;
    act("a", { type: "event", handIndex: 0 });
    pick(act, "a", [t1.uid]);
    pick(act, "a", ["no"]);
    expect(a.library).toHaveLength(library);
    expect(game.pending).toBeNull(); // no 真人: nothing more
    expect(a.front).toEqual([]);
    expect(a.hand).toEqual([JUNPEI]);

    // 〈真人〉 present but no opposing character to sideline: no 改造人类 card either (the milling is still offered).
    const second = setup();
    energy(second.a, 4, PURPLE0);
    field(second.a, "front", MAHITO);
    second.a.hand.push(J("099"), JUNPEI);
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", ["no"]);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([JUNPEI]);
    expect(second.a.front.map((card) => card.cardId)).toEqual([MAHITO]);
  });

  it("领域展开 (100): switches up to two of our AP cards to active", () => {
    const { game, a, act } = setup();
    energy(a, 3, PURPLE0);
    a.ap.forEach((card) => { card.rested = true; });
    a.ap.push({ id: "a:ap3", rested: true });
    a.hand.push(J("100"));
    a.ap[0]!.rested = false; // pays for the event
    act("a", { type: "event", handIndex: 0 });
    expect(activeAp(a)).toBe(0);
    expect(choice(game, "a").options).toHaveLength(4);
    pick(act, "a", ["ap:a:ap1", "ap:a:ap3"]);
    expect(activeAp(a)).toBe(2);
    expect(a.ap.find((card) => card.id === "a:ap0")!.rested).toBe(true);

    // "最多2张": none is fine.
    const second = setup();
    energy(second.a, 3, PURPLE0);
    second.a.hand.push(J("100"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", []);
    expect(activeAp(second.a)).toBe(2);
  });

  it("天内 理子 (EX04BT 3-001): moves to the front line when an attack phase ends and neither 〈五条 悟〉 nor 〈夏油 杰〉 is on our front line (also the opponent's)", () => {
    const { game, a, act } = setup();
    const riko = field(a, "energy", K("001"));
    const gojo = field(a, "front", J("009"));
    // Our own attack phase ends with 五条 悟 on the front line: she stays.
    leaveAttackPhase(game, act, "a");
    expect(a.energy).toEqual([riko]);
    expect(game.turnPlayerId).toBe("b");
    // 五条 悟 is gone: at the end of the opponent's attack phase she moves.
    a.front = a.front.filter((card) => card !== gojo);
    leaveAttackPhase(game, act, "b");
    expect(a.energy).toEqual([]);
    expect(a.front).toEqual([riko]);
  });

  it("天内 理子 (EX04BT 3-001): each of the two on the front line keeps her back; on the front line already she does nothing; our own attack phase works too", () => {
    for (const keeper of [J("009"), J("068")]) {
      const { a, act } = setup();
      const riko = field(a, "energy", K("001"));
      field(a, "front", keeper);
      act("a", { type: "next_phase" });
      act("a", { type: "next_phase" }); // the attack phase ends (and, with nothing to do, so does the turn)
      expect(a.energy).toEqual([riko]);
    }
    // 五条 悟 on the energy line does not count as "前线中".
    const second = setup();
    const riko = field(second.a, "energy", K("001"));
    field(second.a, "energy", J("009"));
    second.act("a", { type: "next_phase" });
    second.act("a", { type: "next_phase" });
    expect(second.a.energy).toHaveLength(1);
    expect(second.a.front).toEqual([riko]);
    // The opponent's 五条 悟 does not count.
    const third = setup();
    const r3 = field(third.a, "energy", K("001"));
    field(third.b, "front", J("009"));
    third.act("a", { type: "next_phase" });
    third.act("a", { type: "next_phase" });
    expect(third.a.front).toEqual([r3]);
  });

  it("天内 理子 (EX04BT 3-001): 启动主要 (energy line, rest, discard a card, once per turn) switches a 〈五条 悟〉 or 〈夏油 杰〉 of cost 5 or less to active", () => {
    const { game, a, act } = setup();
    const riko = field(a, "energy", K("001"));
    const gojo = field(a, "front", J("009"), true); // 五条 悟, cost 3
    const bigGojo = field(a, "front", J("012"), true); // 五条 悟, cost 6
    const geto = field(a, "energy", J("068"), true); // 夏油 杰, cost 2
    const other = field(a, "front", GUARD, true);
    a.hand.push(FILLER, BLUE0);
    act("a", { type: "activate", uid: riko.uid, ability: 1 });
    pick(act, "a", ["h:0"]); // the card put into the sideline
    expect(riko.rested).toBe(true);
    expect(a.sideline).toEqual([FILLER]);
    expect(sorted(choice(game, "a").options)).toEqual(sorted([gojo.uid, geto.uid]));
    expect(choice(game).options).not.toContain(bigGojo.uid);
    expect(choice(game).options).not.toContain(other.uid);
    pick(act, "a", [geto.uid]);
    expect(geto.rested).toBe(false);
    expect(gojo.rested).toBe(true);
    expect(() => act("a", { type: "activate", uid: riko.uid, ability: 1 })).toThrow();
  });

  it("天内 理子 (EX04BT 3-001): 启动主要 only works while she is on the energy line and needs a hand card", () => {
    const { a, act } = setup();
    const riko = field(a, "front", K("001"));
    field(a, "front", J("009"), true);
    a.hand.push(FILLER);
    expect(() => act("a", { type: "activate", uid: riko.uid, ability: 1 })).toThrow();
    const second = setup();
    const r2 = field(second.a, "energy", K("001"));
    field(second.a, "front", J("009"), true);
    expect(() => second.act("a", { type: "activate", uid: r2.uid, ability: 1 })).toThrow(); // no hand card
    expect(r2.rested).toBe(false);
  });

  it("家入 硝子 (EX04BT 3-002): 登场时 draws a card, then a hand card goes into the sideline", () => {
    const { game, a, act } = setup();
    a.hand.push(K("002"), GUARD);
    const library = a.library.length;
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.library).toHaveLength(library - 1);
    expect(a.hand).toHaveLength(2);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.hand).toHaveLength(1);
    expect(a.sideline).toEqual([GUARD]);
  });

  it("庵 歌姬 (EX04BT 3-003): 攻击时 looks at the top card and puts it back on top or on the bottom", () => {
    const { game, a, act } = setup("attack");
    const utahime = field(a, "front", K("003"));
    const rest = a.library.slice(1);
    a.library = [J("074"), ...rest];
    act("a", { type: "attack", attackerUid: utahime.uid });
    expect(choice(game, "a").labels).toEqual(["置于卡组最上方", "置于卡组最下方"]);
    pick(act, "a", ["m:0"]);
    expect(a.library[0]).toBe(J("074"));
    expect(a.library).toHaveLength(rest.length + 1);
    expect(game.pending?.kind).toBe("damage");

    const second = setup("attack");
    const u2 = field(second.a, "front", K("003"));
    const rest2 = second.a.library.slice(1);
    second.a.library = [J("074"), ...rest2];
    second.act("a", { type: "attack", attackerUid: u2.uid });
    pick(second.act, "a", ["m:1"]);
    expect(second.a.library[0]).toBe(rest2[0]);
    expect(second.a.library[second.a.library.length - 1]).toBe(J("074"));
    expect(second.a.library).toHaveLength(rest2.length + 1);
  });
});
