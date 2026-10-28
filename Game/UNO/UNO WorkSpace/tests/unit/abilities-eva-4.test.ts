/**
 * EVA batch 4 (UC03BT/EVA-1-089 ... 100 and UC03ST/EVA-1-101 ... 113): one test per card (more for cards with several abilities), set up as the
 * printed text describes and checked against it. Cards are addressed by card number through the shared harness.
 */
import { describe, expect, it } from "vitest";
import { applyAction, bpOf, costOf, damageOf, hasKeyword, impactOf } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { EVA_4_ABILITIES } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/cards-eva-4.ts";
import type { UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { choice, ctx, energy, field, setup } from "./ability-harness.ts";
import { loadTitleCards } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";

const bt = (n: string): string => `UC03BT/EVA-1-${n}`;
const st = (n: string): string => `UC03ST/EVA-1-${n}`;
const PE = "UCEX01BT/ARK-2-055"; // a purple site that makes 1 energy (see `power`)
const KING = "UC01BT/ARK-1-004"; // yellow, cost 0, BP1500, trigger 获得, no ability (also the filler card)
const NINE = "UC01BT/ARK-1-088"; // red, cost 0, BP2000, trigger 抽卡
const HOSHIGUMA = "UC01BT/ARK-1-090"; // red, cost 0, BP2000, NO trigger (only 《2次阻挡》)
const MEDIC = "UC01ST/ARK-1-105"; // blue, cost 0, BP2000, NO trigger, no text
const FILLER = KING;

const NERV = st("108"); // a yellow site without a trigger
const SHINJI = st("103"); // 碇 真嗣, yellow, BP2500, no trigger
const REI_YELLOW = st("110"); // 绫波 零, yellow, cost 0, BP1000, 获得
const UNIT01 = st("104"); // 新世纪福音战士初号机, yellow, BP4000, cost 0, raids 碇 真嗣
const UNIT00 = st("105"); // 新世纪福音战士零号机
const EVA13 = bt("034"); // 新世纪福音战士13号机, purple, BP4000
const SHIKINAMI_PURPLE = st("113");
const RAIDER_2 = bt("041"); // 新世纪福音战士改2号机 (raids 式波·明日香·兰格雷, cost 4 purple)

type Harness = ReturnType<typeof setup>;
const cards = loadTitleCards();
const titleCard = (number: string) => cards.find((entry) => entry.number === number)!;

/** `count` purple energy: one purple site on the energy line whose energy is raised. */
function power(h: Harness, count: number): UnionArenaFieldCard {
  const site = field(h.a, "energy", PE);
  site.energyMod = count - 1;
  return site;
}
/** Puts `number` into the hand and plays it from there; returns the field card. */
function play(h: Harness, number: string, line: "front" | "energy" = "front"): UnionArenaFieldCard {
  h.a.hand.push(number);
  h.act("a", { type: "play", handIndex: h.a.hand.length - 1, line });
  return h.a[line][h.a[line].length - 1]!;
}
/** Uses the event in the hand. */
function useEvent(h: Harness, number: string): void {
  h.a.hand.push(number);
  h.act("a", { type: "event", handIndex: h.a.hand.length - 1 });
}
const pick = (h: Harness, who: "a" | "b", picks: string[]): void => h.act(who, { type: "choose", picks });
const sidelineManually = (h: Harness, uid: string): void => h.act("a", { type: "manual", manual: { op: "field", owner: "you", uid, act: "sideline" } });

describe("EVA batch 4: the table", () => {
  it("lists every encoded card as automated; the keyword-only cards need no entry; the names the filters rely on", () => {
    expect(Object.keys(EVA_4_ABILITIES)).toHaveLength(22);
    for (const number of [...Object.keys(EVA_4_ABILITIES), st("101"), st("103")]) expect(isAutomated(titleCard(number)), number).toBe(true);
    expect(titleCard(st("102")).name).toBe("绫波 零");
    expect(titleCard(st("103")).name).toBe("碇 真嗣");
    expect(titleCard(st("104")).name).toContain("初号机");
    expect(titleCard(bt("034")).name).toBe("新世纪福音战士13号机");
    expect(titleCard(bt("091")).stats!.abilityText).toContain("2号机");
    expect(ctx.card(MEDIC)!.trigger).toBeNull();
    expect(ctx.card(HOSHIGUMA)!.trigger).toBeNull();
    expect(ctx.card(KING)!.trigger).not.toBeNull();
  });
});

describe("片片", () => {
  it("089: 登场时 gives up to 1 other character of ours BP+1000 for the turn (not itself; picking none changes nothing)", () => {
    const h = setup();
    const ally = field(h.a, "front", KING);
    const unit = play(h, bt("089"));
    expect(choice(h.game, "a").options).toEqual([ally.uid]);
    pick(h, "a", [ally.uid]);
    expect(bpOf(ctx, ally)).toBe(2500);
    expect(bpOf(ctx, unit)).toBe(1000);
    // up to 1: none
    const none = setup();
    const other = field(none.a, "front", KING);
    play(none, bt("089"));
    pick(none, "a", []);
    expect(bpOf(ctx, other)).toBe(1500);
    // lasts for the turn only
    h.act("a", { type: "end_turn" });
    expect(bpOf(ctx, ally)).toBe(1500);
  });
});

describe("真希波·真理·伊拉丝多莉亚斯 (090, 091, 092)", () => {
  it("090: 登场时 looks at 2; puts up to 1 red card without a trigger into the sideline; the rest go back on top in the order chosen", () => {
    const h = setup();
    h.a.library = [HOSHIGUMA, NINE, MEDIC, ...Array(27).fill(FILLER)];
    play(h, bt("090"));
    // 九 is red but has a trigger: only 星熊 qualifies
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([HOSHIGUMA]);
    expect(options.min).toBe(0);
    pick(h, "a", ["l:0"]);
    expect(h.a.sideline).toEqual([HOSHIGUMA]);
    expect(h.game.pending).toBeNull(); // one card left: no question about the order
    expect(h.a.library.slice(0, 2)).toEqual([NINE, MEDIC]);
    expect(h.a.library).toHaveLength(29);
  });

  it("090: picking none lets the player order both cards on top; no red card without a trigger → straight to the order", () => {
    const h = setup();
    h.a.library = [HOSHIGUMA, MEDIC, ...Array(28).fill(FILLER)];
    play(h, bt("090"));
    pick(h, "a", []);
    const order = choice(h.game, "a");
    expect(order.cards).toEqual([HOSHIGUMA, MEDIC]);
    pick(h, "a", ["l:1", "l:0"]);
    expect(h.a.library.slice(0, 2)).toEqual([MEDIC, HOSHIGUMA]);
    expect(h.a.sideline).toEqual([]);

    const none = setup();
    none.a.library = [NINE, MEDIC, ...Array(28).fill(FILLER)]; // blue 医疗 and triggered 九: nothing to sideline
    play(none, bt("090"));
    expect(choice(none.game, "a").purpose).toBe("target"); // only the order is asked
    pick(none, "a", ["l:1", "l:0"]);
    expect(none.a.library.slice(0, 2)).toEqual([MEDIC, NINE]);
    expect(none.a.sideline).toEqual([]);
  });

  it("091: 登场时 looks at 3; adds up to 1 character named …2号机… or without a trigger to the hand (a site without a trigger does not count), the rest go to the bottom, then discard 1", () => {
    const h = setup();
    h.a.library = [NERV, bt("081"), KING, ...Array(27).fill(FILLER)]; // 081: 新世纪福音战士2号机 (has a trigger)
    h.a.hand.push(NINE);
    play(h, bt("091"));
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([bt("081")]);
    pick(h, "a", ["l:1"]);
    const order = choice(h.game, "a"); // NERV and KING go to the bottom in an order of the player's choice
    expect(order.cards).toEqual([NERV, KING]);
    pick(h, "a", ["l:1", "l:0"]);
    expect(h.a.library.slice(-2)).toEqual([KING, NERV]);
    expect(h.a.hand).toEqual([NINE, bt("081")]);
    pick(h, "a", ["h:0"]); // 加入手牌的场合，将我方的1张手牌置于场外
    expect(h.a.hand).toEqual([bt("081")]);
    expect(h.a.sideline).toEqual([NINE]);
  });

  it("091: a character without a trigger is eligible too; picking none adds nothing and discards nothing", () => {
    const h = setup();
    h.a.library = [MEDIC, KING, NINE, ...Array(27).fill(FILLER)];
    h.a.hand.push(NINE);
    play(h, bt("091"));
    expect(choice(h.game, "a").cards).toEqual([MEDIC]);
    pick(h, "a", []);
    pick(h, "a", ["l:0", "l:1", "l:2"]);
    expect(h.a.hand).toEqual([NINE]);
    expect(h.a.sideline).toEqual([]);
    expect(h.game.pending).toBeNull();
    expect(h.a.library.slice(-3)).toEqual([MEDIC, KING, NINE]);
  });

  it("092: 登场时 draws 1 and puts 1 hand card into the sideline", () => {
    const h = setup();
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    h.a.hand.push(KING);
    play(h, bt("092"));
    pick(h, "a", ["h:0"]);
    expect(h.a.hand).toEqual([NINE]);
    expect(h.a.sideline).toEqual([KING]);
  });

  /**
   * b is the turn player. a has 092 and `others` more cards on its field; b's attacker is not blocked, and picks a's first life card (`lifeCard`).
   * Returns once a has declined the life card's own trigger.
   */
  function lifeCardSidelined(others: string[], lifeCard: string, options: { extraMari?: boolean } = {}) {
    const h = setup("attack", "b");
    const mari = field(h.a, "front", bt("092"));
    const second = options.extraMari ? field(h.a, "front", bt("092")) : null;
    for (const number of others) field(h.a, number === NERV ? "energy" : "front", number);
    h.a.life[0]!.cardId = lifeCard;
    const attacker = field(h.b, "front", KING);
    h.act("b", { type: "attack", attackerUid: attacker.uid });
    h.act("a", { type: "block", blockerUid: null });
    const life = h.a.life[0]!;
    h.act("b", { type: "damage", lifeIds: [life.id] });
    h.act("a", { type: "trigger", lifeId: life.id, activate: false });
    return { h, mari, second };
  }

  it("092: opponent's turn, a life card without a trigger goes to the sideline and we have 4+ cards without a trigger → may rest it to add that card to the hand", () => {
    const { h, mari } = lifeCardSidelined([MEDIC, HOSHIGUMA, NERV], MEDIC);
    expect(choice(h.game, "a").purpose).toBe("confirm");
    expect(h.a.sideline).toEqual([MEDIC]);
    pick(h, "a", ["yes"]);
    expect(mari.rested).toBe(true);
    expect(h.a.hand).toEqual([MEDIC]);
    expect(h.a.sideline).toEqual([]);
    expect(h.game.pending).toBeNull();
  });

  it("092: answering no leaves the card in the sideline and the character active", () => {
    const { h, mari } = lifeCardSidelined([MEDIC, HOSHIGUMA, NERV], MEDIC);
    pick(h, "a", ["no"]);
    expect(mari.rested).toBe(false);
    expect(h.a.hand).toEqual([]);
    expect(h.a.sideline).toEqual([MEDIC]);
  });

  it("092: not with fewer than 4 cards without a trigger on our field (a card with a trigger does not count), for a life card with a trigger, or when it is resting", () => {
    const few = lifeCardSidelined([MEDIC, KING, NERV], MEDIC); // 092, 医疗, 弑君者(trigger), NERV → only 3 without a trigger
    expect(few.h.game.pending).toBeNull();
    expect(few.h.a.sideline).toEqual([MEDIC]);

    const triggered = lifeCardSidelined([MEDIC, HOSHIGUMA, NERV], NINE); // 九 has a trigger
    expect(triggered.h.game.pending).toBeNull();
    expect(triggered.h.a.sideline).toEqual([NINE]);

    const h = setup("attack", "b");
    const tired = field(h.a, "front", bt("092"), true);
    for (const number of [MEDIC, HOSHIGUMA]) field(h.a, "front", number);
    field(h.a, "energy", NERV);
    h.a.life[0]!.cardId = MEDIC;
    const attacker = field(h.b, "front", KING);
    h.act("b", { type: "attack", attackerUid: attacker.uid });
    h.act("a", { type: "block", blockerUid: null });
    const life = h.a.life[0]!;
    h.act("b", { type: "damage", lifeIds: [life.id] });
    h.act("a", { type: "trigger", lifeId: life.id, activate: false });
    expect(h.game.pending).toBeNull(); // 092 is resting: it cannot be rested again
    expect(tired.rested).toBe(true);
    expect(h.a.hand).toEqual([]);
    expect(h.a.sideline).toEqual([MEDIC]);
  });

  it("092: only once per turn (by name): a second 〈真希波·真理·伊拉丝多莉亚斯〉 cannot use it after the first did", () => {
    const h = setup("attack", "b");
    const first = field(h.a, "front", bt("092"));
    const second = field(h.a, "front", bt("092"));
    for (const number of [MEDIC, HOSHIGUMA]) field(h.a, "front", number);
    // two life cards without a trigger are hit at once (the attacker has 伤害②)
    h.a.life[0]!.cardId = MEDIC;
    h.a.life[1]!.cardId = HOSHIGUMA;
    const attacker = field(h.b, "front", KING);
    attacker.grants.push("伤害2");
    h.act("b", { type: "attack", attackerUid: attacker.uid });
    h.act("a", { type: "block", blockerUid: null });
    expect(damageOf(ctx, attacker)).toBe(2);
    h.act("b", { type: "damage", lifeIds: [h.a.life[0]!.id, h.a.life[1]!.id] });
    const [one, two] = h.game.pending && h.game.pending.kind === "triggers" ? h.game.pending.revealed : [];
    h.act("a", { type: "trigger", lifeId: one!.id, activate: false });
    // the first card went to the sideline → both characters hear it, one at a time
    for (let guard = 0; guard < 4 && h.game.pending?.kind === "choose"; guard += 1) {
      const pending = choice(h.game, "a");
      pick(h, "a", [pending.purpose === "confirm" ? "yes" : pending.options[0]!]);
    }
    h.act("a", { type: "trigger", lifeId: two!.id, activate: false });
    for (let guard = 0; guard < 4 && h.game.pending?.kind === "choose"; guard += 1) {
      const pending = choice(h.game, "a");
      pick(h, "a", [pending.purpose === "confirm" ? "yes" : pending.options[0]!]);
    }
    expect([first.rested, second.rested].filter(Boolean)).toHaveLength(1); // only one of them rested
    expect(h.a.hand).toHaveLength(1); // and only one card was added to the hand
    expect(h.a.sideline).toHaveLength(1);
  });
});

describe("作战室（屋岛作战）", () => {
  it("093: 登场时 looks at 5; adds up to 1 character named …零号机… / …初号机… to the hand, the rest go to the bottom", () => {
    const h = setup();
    // eligible: 零号机 080, 初号机 拟神化 079, 初号机 104; not: 2号机 081, 弑君者
    h.a.library = [bt("080"), bt("081"), KING, bt("079"), UNIT01, ...Array(25).fill(FILLER)];
    play(h, bt("093"), "energy");
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([bt("080"), bt("079"), UNIT01]);
    pick(h, "a", ["l:4"]);
    expect(h.a.hand).toEqual([UNIT01]);
    const order = choice(h.game, "a");
    expect(order.cards).toEqual([bt("080"), bt("081"), KING, bt("079")]);
    pick(h, "a", ["l:3", "l:2", "l:1", "l:0"]);
    expect(h.a.library.slice(-4)).toEqual([bt("079"), KING, bt("081"), bt("080")]);
    expect(h.a.library).toHaveLength(29);
  });

  it("093: picking none adds nothing", () => {
    const h = setup();
    h.a.library = [bt("080"), ...Array(29).fill(FILLER)];
    play(h, bt("093"), "energy");
    pick(h, "a", []);
    pick(h, "a", ["l:0", "l:1", "l:2", "l:3", "l:4"]);
    expect(h.a.hand).toEqual([]);
    expect(h.a.library).toHaveLength(30);
    expect(h.a.library.slice(-5)).toEqual([bt("080"), FILLER, FILLER, FILLER, FILLER]);
  });

  it("093: 启动主要 (once per turn) switches a card of our energy line to active", () => {
    const h = setup();
    const site = field(h.a, "energy", bt("093"));
    const tired = field(h.a, "energy", KING, true);
    field(h.a, "front", NINE, true); // not on the energy line
    h.act("a", { type: "activate", uid: site.uid, ability: 1 });
    const options = choice(h.game, "a");
    expect(options.options).toEqual([site.uid, tired.uid]);
    expect(options.min).toBe(1);
    pick(h, "a", [tired.uid]);
    expect(tired.rested).toBe(false);
    expect(h.a.front[0]!.rested).toBe(true);
    expect(() => h.act("a", { type: "activate", uid: site.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
  });
});

describe("events", () => {
  it("094: only usable while 〈碇 真嗣〉 or a character named …初号机… is on our field", () => {
    const h = setup();
    field(h.b, "front", KING);
    h.a.hand.push(bt("094"));
    expect(() => h.act("a", { type: "event", handIndex: 0 })).toThrow("EVENT_CONDITION");
    field(h.a, "front", KING);
    expect(() => h.act("a", { type: "event", handIndex: 0 })).toThrow("EVENT_CONDITION");
    field(h.a, "front", NINE);
    // 〈碇 真嗣〉 on the energy line counts as on the field
    field(h.a, "energy", SHINJI);
    h.act("a", { type: "event", handIndex: 0 });
    expect(h.game.pending).toBeNull();
  });

  it("094: sidelines an opposing front-line character with BP 5000 or less, then puts up to 1 〈绫波 零〉 from the sideline face down under a 〈碇 真嗣〉 with nothing face down", () => {
    const h = setup();
    const shinji = field(h.a, "front", SHINJI);
    const withUnder = field(h.a, "front", SHINJI);
    withUnder.faceDown = [KING];
    h.a.sideline.push(KING, REI_YELLOW, bt("070"), NINE); // 070 is another yellow 绫波 零
    const weak = field(h.b, "front", bt("033")); // BP5000
    const strong = field(h.b, "front", bt("033"));
    strong.bpMod = 1;
    useEvent(h, bt("094"));
    expect(h.b.front).toEqual([strong]);
    expect(h.b.sideline).toEqual([bt("033")]);
    expect(weak.uid).not.toBe(strong.uid);
    const rei = choice(h.game, "a");
    expect(rei.cards).toEqual([REI_YELLOW, bt("070")]);
    expect(rei.min).toBe(0);
    pick(h, "a", ["s:1"]);
    // only one 碇 真嗣 has no face-down card: no question
    expect(h.game.pending).toBeNull();
    expect(shinji.faceDown).toEqual([REI_YELLOW]);
    expect(withUnder.faceDown).toEqual([KING]);
    expect(h.a.sideline).toEqual([KING, bt("070"), NINE, bt("094")]);
  });

  it("094: picking no 〈绫波 零〉 does nothing more; with every 〈碇 真嗣〉 already holding a face-down card there is no question", () => {
    const h = setup();
    const shinji = field(h.a, "front", SHINJI);
    h.a.sideline.push(REI_YELLOW);
    field(h.b, "front", KING);
    useEvent(h, bt("094"));
    pick(h, "a", []);
    expect(shinji.faceDown ?? []).toEqual([]);
    expect(h.a.sideline).toEqual([REI_YELLOW, bt("094")]);

    const full = setup();
    const loaded = field(full.a, "front", SHINJI);
    loaded.faceDown = [KING];
    full.a.sideline.push(REI_YELLOW);
    field(full.b, "front", KING);
    useEvent(full, bt("094"));
    expect(full.game.pending).toBeNull();
    expect(full.b.front).toEqual([]);
    expect(loaded.faceDown).toEqual([KING]);
    expect(full.a.sideline).toEqual([REI_YELLOW, bt("094")]);
  });

  it("095: BP 3000 or less; BP 5000 or less while 〈碇 真嗣〉 or a …初号机… character is on our field", () => {
    const small = setup();
    const three = field(small.b, "front", st("102")); // BP3000
    const four = field(small.b, "front", st("104")); // BP4000
    useEvent(small, bt("095"));
    expect(small.game.pending).toBeNull(); // only one candidate: picked at once
    expect(small.b.front).toEqual([four]);
    expect(three.uid).not.toBe(four.uid);

    const big = setup();
    field(big.a, "front", UNIT01);
    const a3 = field(big.b, "front", st("102"));
    const a4 = field(big.b, "front", st("104"));
    const a6 = field(big.b, "front", st("104"));
    a6.bpMod = 1001; // BP5001: out of range
    useEvent(big, bt("095"));
    expect(choice(big.game, "a").options).toEqual([a3.uid, a4.uid]);
    pick(big, "a", [a4.uid]);
    expect(big.b.front).toEqual([a3, a6]);
    expect(big.b.sideline).toEqual([st("104")]);
  });

  it("096: activates one of our characters that has 突进 and is not in the raid state; BP+1000 and 瞄准攻击 for the turn", () => {
    const h = setup();
    power(h, 1);
    const free = field(h.a, "front", UNIT01, true);
    const raided = field(h.a, "front", UNIT01, true);
    raided.under = [SHINJI];
    field(h.a, "front", KING, true); // no 突进
    const another = field(h.a, "energy", UNIT00, true);
    useEvent(h, bt("096"));
    expect(choice(h.game, "a").options).toEqual([free.uid, another.uid]);
    pick(h, "a", [another.uid]);
    expect(another.rested).toBe(false);
    expect(bpOf(ctx, another)).toBe(5000);
    expect(hasKeyword(ctx, another, "瞄准攻击")).toBe(true);
    expect(free.rested).toBe(true);
    expect(raided.rested).toBe(true);
    h.act("a", { type: "end_turn" });
    expect(bpOf(ctx, another)).toBe(4000);
    expect(hasKeyword(ctx, another, "瞄准攻击")).toBe(false);
  });

  for (const number of [bt("097"), bt("100")]) {
    it(`${number.slice(-3)}: switches up to 2 of our AP cards to active (picking fewer is allowed)`, () => {
      const h = setup();
      h.a.ap[1]!.rested = true;
      h.a.ap[2]!.rested = true;
      useEvent(h, number); // pays 1 AP: ap0 rests
      const options = choice(h.game, "a");
      expect(options.options).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
      expect(options.max).toBe(2);
      pick(h, "a", ["ap:a:ap0", "ap:a:ap2"]);
      expect(h.a.ap.map((card) => card.rested)).toEqual([false, true, false]);
      expect(h.a.sideline).toEqual([number]);

      const none = setup();
      useEvent(none, number);
      pick(none, "a", []);
      expect(none.a.ap.filter((card) => !card.rested)).toHaveLength(2);
    });
  }

  it("098: BP 2000 or less, +1000 for every card without a trigger on our field (any card counts, cards with a trigger do not)", () => {
    const zero = setup();
    field(zero.a, "front", KING);
    const nine = field(zero.b, "front", NINE); // BP2000
    field(zero.b, "front", st("104")); // BP4000
    useEvent(zero, bt("098"));
    expect(zero.game.pending).toBeNull(); // 弑君者 has a trigger: only 九 is in range
    expect(zero.b.front.map((card) => card.cardId)).toEqual([st("104")]);
    expect(nine.uid).toBeTruthy();

    const h = setup();
    field(h.a, "front", MEDIC);
    field(h.a, "energy", NERV); // a site counts too
    field(h.a, "front", KING);
    const two = field(h.b, "front", NINE);
    const four = field(h.b, "front", st("104"));
    const five = field(h.b, "front", st("104"));
    five.bpMod = 1000; // BP5000: out of range even with two cards (limit 4000)
    useEvent(h, bt("098"));
    expect(choice(h.game, "a").options).toEqual([two.uid, four.uid]);
    pick(h, "a", [four.uid]);
    expect(h.b.front).toEqual([two, five]);
  });

  it("099: draws 2; with 4 or more cards without a trigger on our field draws 1 more", () => {
    const three = setup();
    h3(three);
    useEvent(three, bt("099"));
    expect(three.a.hand).toHaveLength(2);

    const four = setup();
    h3(four);
    field(four.a, "energy", NERV);
    useEvent(four, bt("099"));
    expect(four.a.hand).toHaveLength(3);
    expect(four.a.library).toHaveLength(27);

    function h3(h: Harness): void {
      field(h.a, "front", MEDIC);
      field(h.a, "front", HOSHIGUMA);
      field(h.a, "front", bt("089"));
      field(h.a, "front", KING); // has a trigger: not counted
    }
  });
});

describe("keyword-only cards", () => {
  it("101, 103: 【撤步】 only — automatic without a table entry", () => {
    for (const number of [st("101"), st("103")]) {
      expect(isAutomated(titleCard(number)), number).toBe(true);
      expect(ctx.card(number)!.keywords).toContain("撤步");
    }
  });
});

describe("绫波 零 (102)", () => {
  it("102: 登场时 looks at 2; any number go on top in the order chosen, the rest into the sideline", () => {
    const h = setup();
    h.a.library = [NINE, MEDIC, KING, ...Array(27).fill(FILLER)];
    play(h, st("102"));
    const keep = choice(h.game, "a");
    expect(keep.cards).toEqual([NINE, MEDIC]);
    expect(keep.min).toBe(0);
    expect(keep.max).toBe(2);
    pick(h, "a", ["l:0", "l:1"]);
    const order = choice(h.game, "a");
    pick(h, "a", [order.options[1]!, order.options[0]!]);
    expect(h.a.library.slice(0, 3)).toEqual([MEDIC, NINE, KING]);
    expect(h.a.sideline).toEqual([]);
    expect(h.a.library).toHaveLength(30);
  });

  it("102: keeping 1 puts it on top and the other into the sideline; keeping none sidelines both", () => {
    const one = setup();
    one.a.library = [NINE, MEDIC, KING, ...Array(27).fill(FILLER)];
    play(one, st("102"));
    pick(one, "a", ["l:1"]);
    expect(one.game.pending).toBeNull();
    expect(one.a.library.slice(0, 2)).toEqual([MEDIC, KING]);
    expect(one.a.sideline).toEqual([NINE]);

    const none = setup();
    none.a.library = [NINE, MEDIC, KING, ...Array(27).fill(FILLER)];
    play(none, st("102"));
    pick(none, "a", []);
    expect(none.a.library.slice(0, 1)).toEqual([KING]);
    expect(none.a.sideline).toEqual([NINE, MEDIC]);
    expect(none.a.library).toHaveLength(28);
  });
});

describe("新世纪福音战士初号机 (104)", () => {
  /** 初号机 attacks with the given energy line (cards: [number, rested]); returns the pending question's options. */
  function attack(line: Array<[string, boolean]>) {
    const h = setup("attack");
    const unit = field(h.a, "front", UNIT01);
    const cardsOnLine = line.map(([number, rested]) => field(h.a, "energy", number, rested));
    h.act("a", { type: "attack", attackerUid: unit.uid });
    return { h, unit, cardsOnLine };
  }

  it("104: has 突进 on 〈碇 真嗣〉 and 冲击①", () => {
    expect(ctx.card(UNIT01)!.raid?.targets).toEqual(["碇 真嗣"]);
    const h = setup();
    expect(impactOf(ctx, field(h.a, "front", UNIT01))).toBe(1);
  });

  it("104: 攻击时 rests any number of active energy-line cards; total required energy 4 or more → BP+3000", () => {
    // required energy: 绫波 零 EVA-1-002 = 4, 绫波 零 EVA-1-004 = 2, 绫波 零 EVA-1-003 = 1
    const { h, unit, cardsOnLine } = attack([[bt("002"), false], [bt("004"), false], [bt("003"), true]]);
    const options = choice(h.game, "a");
    expect(options.options).toEqual([cardsOnLine[0]!.uid, cardsOnLine[1]!.uid]); // the resting one is not offered
    expect(options.min).toBe(0);
    pick(h, "a", [cardsOnLine[0]!.uid]);
    expect(cardsOnLine[0]!.rested).toBe(true);
    expect(cardsOnLine[1]!.rested).toBe(false);
    expect(bpOf(ctx, unit)).toBe(7000);
    expect(damageOf(ctx, unit)).toBe(1);
  });

  it("104: 8 or more → BP+3000 and 伤害②; below 4 → nothing; picking none rests nothing", () => {
    const eight = attack([[bt("002"), false], [bt("002"), false], [bt("004"), false]]);
    const ids = eight.cardsOnLine.map((card) => card.uid);
    pick(eight.h, "a", [ids[0]!, ids[1]!]);
    expect(bpOf(ctx, eight.unit)).toBe(7000); // BP+3000 only once
    expect(damageOf(ctx, eight.unit)).toBe(2);
    expect(eight.cardsOnLine[2]!.rested).toBe(false);

    const three = attack([[bt("004"), false], [bt("003"), false]]); // 2 + 1 = 3
    pick(three.h, "a", three.cardsOnLine.map((card) => card.uid));
    expect(three.cardsOnLine.every((card) => card.rested)).toBe(true);
    expect(bpOf(ctx, three.unit)).toBe(4000);
    expect(damageOf(ctx, three.unit)).toBe(1);

    const nothing = attack([[bt("002"), false]]);
    pick(nothing.h, "a", []);
    expect(nothing.cardsOnLine[0]!.rested).toBe(false);
    expect(bpOf(ctx, nothing.unit)).toBe(4000);
  });
});

describe("新世纪福音战士零号机 (105)", () => {
  /** A red 绫波 零 with required energy 1 does not exist in the data; this test card is a copy of the yellow one with those two fields changed. */
  const RED_REI = "TEST/RED-REI";
  const redCtx = { card: (cardId: string) => (cardId === RED_REI ? { ...ctx.card(REI_YELLOW)!, color: "red", energyCost: 1 } : ctx.card(cardId)) };

  it("105: has 2次阻挡 and 突进 on 〈绫波 零〉", () => {
    expect(ctx.card(UNIT00)!.keywords).toContain("2次阻挡");
    expect(ctx.card(UNIT00)!.raid?.targets).toEqual(["绫波 零"]);
  });

  it("105: 退场时 draws 2, then may discard 1 hand card to put a red 〈绫波 零〉 (cost 1 or less) from the sideline onto the field resting", () => {
    const h = setup();
    const unit = field(h.a, "front", UNIT00);
    h.a.sideline.push(REI_YELLOW, RED_REI);
    h.a.library = [NINE, MEDIC, ...Array(28).fill(FILLER)];
    const act = (who: string, action: Parameters<typeof applyAction>[4]): void => applyAction(h.game, h.players, redCtx, who, action);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: unit.uid, act: "sideline" } });
    expect(h.a.hand).toEqual([NINE, MEDIC]);
    expect(choice(h.game, "a").purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    act("a", { type: "choose", picks: ["h:0"] }); // discard 九
    const options = choice(h.game, "a");
    expect(options.cards).toEqual([RED_REI]); // the yellow one is not red
    act("a", { type: "choose", picks: ["s:1"] });
    act("a", { type: "choose", picks: ["line:front"] });
    const rei = h.a.front[h.a.front.length - 1]!;
    expect(rei.cardId).toBe(RED_REI);
    expect(rei.rested).toBe(true);
    expect(h.a.hand).toEqual([MEDIC]);
    expect(h.a.sideline).toEqual([REI_YELLOW, UNIT00, NINE]);
  });

  it("105: answering no only draws; a yellow 〈绫波 零〉 is not eligible, nothing is put onto the field", () => {
    const h = setup();
    const unit = field(h.a, "front", UNIT00);
    h.a.library = [NINE, MEDIC, ...Array(28).fill(FILLER)];
    sidelineManually(h, unit.uid);
    pick(h, "a", ["no"]);
    expect(h.a.hand).toEqual([NINE, MEDIC]);
    expect(h.a.front).toEqual([]);

    const yellow = setup();
    const other = field(yellow.a, "front", UNIT00);
    yellow.a.sideline.push(REI_YELLOW);
    yellow.a.library = [NINE, ...Array(29).fill(FILLER)];
    sidelineManually(yellow, other.uid);
    pick(yellow, "a", ["yes"]);
    pick(yellow, "a", ["h:0"]);
    expect(yellow.game.pending).toBeNull(); // no eligible card: no question
    expect(yellow.a.front).toEqual([]);
    expect(yellow.a.hand).toHaveLength(1);
  });
});

describe("式波·明日香·兰格雷 (106)", () => {
  it("106: gets 冲击① while we have 4 or more cards without a trigger on the field (it has a trigger itself: not counted)", () => {
    const h = setup();
    const unit = field(h.a, "front", st("106"));
    expect(hasKeyword(ctx, unit, "冲击无效")).toBe(true);
    for (const number of [MEDIC, HOSHIGUMA, NERV]) field(h.a, number === NERV ? "energy" : "front", number);
    h.act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "activate" } }); // recompute
    expect(impactOf(ctx, unit)).toBe(0);
    field(h.a, "front", SHINJI);
    h.act("a", { type: "manual", manual: { op: "ap", apId: "a:ap0", act: "activate" } });
    expect(impactOf(ctx, unit)).toBe(1);
    expect(hasKeyword(ctx, unit, "冲击1")).toBe(true);
  });
});

describe("特务机关 NERV", () => {
  it("108: 登场时 may discard 1 hand card to draw 2", () => {
    const h = setup();
    h.a.library = [NINE, MEDIC, ...Array(28).fill(FILLER)];
    h.a.hand.push(KING);
    play(h, NERV, "energy");
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    expect(h.a.hand).toEqual([NINE, MEDIC]);
    expect(h.a.sideline).toEqual([KING]);

    const no = setup();
    no.a.hand.push(KING);
    play(no, NERV, "energy");
    pick(no, "a", ["no"]);
    expect(no.a.hand).toEqual([KING]);

    const empty = setup(); // no hand card to discard: nothing is asked
    play(empty, NERV, "energy");
    expect(empty.game.pending).toBeNull();
    expect(empty.a.hand).toEqual([]);
  });

  it("108: 启动主要 rests it and sidelines it as the cost, then draws 1", () => {
    const h = setup();
    const site = field(h.a, "energy", NERV);
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    h.act("a", { type: "activate", uid: site.uid, ability: 1 });
    expect(h.a.energy).toEqual([]);
    expect(h.a.sideline).toEqual([NERV]);
    expect(h.a.hand).toEqual([NINE]);

    const tired = setup();
    const resting = field(tired.a, "energy", NERV, true);
    expect(() => tired.act("a", { type: "activate", uid: resting.uid, ability: 1 })).toThrow();
  });
});

describe("你不会死的。我会保护你的 (109)", () => {
  it("109: up to 1 〈碇 真嗣〉 / …初号机… gets BP+3000 until our next turn begins; may rest an active 〈绫波 零〉 to draw 1", () => {
    const h = setup();
    const shinji = field(h.a, "front", SHINJI);
    const unit = field(h.a, "front", UNIT01);
    field(h.a, "front", KING); // not eligible
    const rei = field(h.a, "energy", REI_YELLOW);
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    useEvent(h, st("109"));
    const options = choice(h.game, "a");
    expect(options.options).toEqual([shinji.uid, unit.uid]);
    expect(options.min).toBe(0);
    pick(h, "a", [unit.uid]);
    expect(bpOf(ctx, unit)).toBe(7000);
    expect(choice(h.game, "a").purpose).toBe("confirm");
    pick(h, "a", ["yes"]);
    expect(rei.rested).toBe(true);
    expect(h.a.hand).toEqual([NINE]);
    // the bonus outlasts this turn: still there on the opponent's turn, gone once our next turn has begun
    h.act("a", { type: "end_turn" });
    expect(bpOf(ctx, unit)).toBe(7000);
    for (let guard = 0; guard < 8 && !(h.game.turnPlayerId === "a" && h.game.phase === "main"); guard += 1) {
      const turn = h.game.turnPlayerId as "a" | "b";
      h.act(turn, { type: turn === "b" && h.game.phase === "main" ? "end_turn" : "next_phase" });
    }
    expect(h.game.turnPlayerId).toBe("a");
    expect(bpOf(ctx, unit)).toBe(4000);
  });

  it("109: picking none, or answering no, changes nothing; a resting 〈绫波 零〉 is not enough", () => {
    const h = setup();
    const shinji = field(h.a, "front", SHINJI);
    const rei = field(h.a, "energy", REI_YELLOW);
    useEvent(h, st("109"));
    pick(h, "a", []);
    expect(bpOf(ctx, shinji)).toBe(2500);
    pick(h, "a", ["no"]);
    expect(rei.rested).toBe(false);
    expect(h.a.hand).toEqual([]);

    const tired = setup();
    field(tired.a, "front", SHINJI);
    field(tired.a, "energy", REI_YELLOW, true);
    useEvent(tired, st("109"));
    pick(tired, "a", []);
    expect(tired.game.pending).toBeNull(); // no active 绫波 零: not even asked
  });
});

describe("绫波 零 (110) and 真希波 (111)", () => {
  it("110: 退场时 draws 1", () => {
    const h = setup();
    const rei = field(h.a, "front", REI_YELLOW);
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    sidelineManually(h, rei.uid);
    expect(h.a.hand).toEqual([NINE]);
    expect(h.a.sideline).toEqual([REI_YELLOW]);
  });

  it("111: 登场时 draws 1 and puts 1 hand card into the sideline", () => {
    const h = setup();
    energy(h.a, 2, REI_YELLOW);
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    h.a.hand.push(KING);
    play(h, st("111"));
    pick(h, "a", ["h:0"]);
    expect(h.a.hand).toEqual([NINE]);
    expect(h.a.sideline).toEqual([KING]);
  });

  it("111: 启动主要 rests it to give another character of ours BP+1000 for the turn", () => {
    const h = setup();
    const mari = field(h.a, "front", st("111"));
    const ally = field(h.a, "front", KING);
    const other = field(h.a, "energy", NINE);
    h.act("a", { type: "activate", uid: mari.uid, ability: 1 });
    expect(mari.rested).toBe(true);
    expect(choice(h.game, "a").options).toEqual([ally.uid, other.uid]); // not itself
    pick(h, "a", [other.uid]);
    expect(bpOf(ctx, other)).toBe(3000);
    expect(bpOf(ctx, ally)).toBe(1500);
    expect(() => h.act("a", { type: "activate", uid: mari.uid, ability: 1 })).toThrow(); // already resting
  });
});

describe("渚 薰 (112)", () => {
  it("112: costs [紫×2] less while our field has no card at all", () => {
    const h = setup();
    h.a.hand.push(st("112"));
    expect(costOf(h.game, h.players, ctx, "a", st("112")).energy).toBe(0);
    field(h.a, "energy", NINE);
    expect(costOf(h.game, h.players, ctx, "a", st("112")).energy).toBe(2);
  });

  it("112: 启动主要 rests it and puts it face down under our 〈新世纪福音战士13号机〉; then draws 2 and puts 1 hand card into the sideline", () => {
    const h = setup();
    const kaoru = field(h.a, "front", st("112"));
    const unit = field(h.a, "front", EVA13);
    h.a.library = [NINE, MEDIC, ...Array(28).fill(FILLER)];
    h.a.hand.push(KING);
    h.act("a", { type: "activate", uid: kaoru.uid, ability: 1 });
    expect(h.a.front).toEqual([unit]); // it left the field
    expect(unit.faceDown).toEqual([st("112")]);
    expect(h.a.hand).toEqual([KING, NINE, MEDIC]);
    pick(h, "a", ["h:0"]);
    expect(h.a.hand).toEqual([NINE, MEDIC]);
    expect(h.a.sideline).toEqual([KING]);
  });

  it("112: without a 13号机 the cost is paid but nothing else happens", () => {
    const h = setup();
    const kaoru = field(h.a, "energy", st("112"));
    field(h.a, "front", UNIT01);
    h.a.library = [NINE, MEDIC, ...Array(28).fill(FILLER)];
    h.act("a", { type: "activate", uid: kaoru.uid, ability: 1 });
    expect(kaoru.rested).toBe(true);
    expect(h.a.energy).toEqual([kaoru]);
    expect(h.a.hand).toEqual([]);
    expect(h.game.pending).toBeNull();
  });
});

describe("式波·明日香·兰格雷 (113)", () => {
  /** 改2号机 raids the purple 式波 in the front line (it needs 4 purple energy); b has front-line characters to lower. */
  function raided() {
    const h = setup();
    power(h, 4);
    const base = field(h.a, "front", SHIKINAMI_PURPLE);
    const foe = field(h.b, "front", st("104"));
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    h.a.hand.push(RAIDER_2);
    h.act("a", { type: "raid", handIndex: 0, targetUid: base.uid });
    return { h, base, foe };
  }

  it("113: when this character is raided, choose: draw 1", () => {
    const { h, base } = raided();
    expect(base.cardId).toBe(RAIDER_2);
    expect(base.under).toEqual([SHIKINAMI_PURPLE]);
    // the Raid card's own 登场时 (BP-1000) and this effect are both waiting: the player orders them
    let guard = 0;
    while (h.game.pending && guard < 6) {
      guard += 1;
      const pending = choice(h.game, "a");
      if (pending.options.includes("m:0")) { pick(h, "a", ["m:0"]); continue; }
      pick(h, "a", [pending.options[0]!]);
    }
    expect(h.a.hand).toEqual([NINE]);
  });

  it("113: or choose: up to 1 front-line character of the opponent gets BP-1000 for the turn", () => {
    const { h, foe } = raided();
    let guard = 0;
    while (h.game.pending && guard < 6) {
      guard += 1;
      const pending = choice(h.game, "a");
      if (pending.options.includes("m:1")) { pick(h, "a", ["m:1"]); continue; }
      pick(h, "a", [pending.options.includes(foe.uid) ? foe.uid : pending.options[0]!]);
    }
    // BP-1000 from this effect and BP-1000 from 改2号机's own 登场时 (both picked the only foe)
    expect(bpOf(ctx, foe)).toBe(2000);
    expect(h.a.hand).toEqual([]);
  });

  it("113: nothing happens when it is merely played (it is not raided)", () => {
    const h = setup();
    h.a.library = [NINE, ...Array(29).fill(FILLER)];
    energy(h.a, 2, REI_YELLOW);
    h.a.hand.push(SHIKINAMI_PURPLE);
    power(h, 2);
    h.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(h.game.pending).toBeNull();
    expect(h.a.hand).toEqual([]);
  });
});
