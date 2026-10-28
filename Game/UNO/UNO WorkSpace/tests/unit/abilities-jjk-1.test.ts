/**
 * JJK batch 1 (UA02BT/JJK-1-001 .. 035, yellow plus the blue 家入 硝子): one test per card, set up as its printed text describes and checked
 * against the text. Card text comes from Cards/cards.json (no card art on this machine).
 */
import { describe, expect, it } from "vitest";
import { bpOf, costOf, damageOf, energyOf, flagsOf, hasKeyword, type EngineGame, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { isAutomated } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { titleCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";
import { choice, ctx, energy, field, FILLER, setup } from "./ability-harness.ts";

const J = (n: string): string => `UA02BT/JJK-1-${n}`;
/** A yellow card that makes 2 yellow energy (on the energy line two of them pay for a 4-cost card and leave room for a site). */
const GEN2 = J("003");
const GUARD = "UC01ST/ARK-1-103"; // blue, cost 3, BP3000, no ability
const BLUE0 = "UC01BT/ARK-1-039"; // 阿米娅: blue, cost 0, BP1500, no ability
const PURPLE0 = "UCEX01BT/ARK-2-047"; // 阿米娅: purple, cost 0, BP1500, no ability
const RED0 = "UC01BT/ARK-1-088"; // 九: red, cost 0, BP2000, no ability
const FROST = "UC01BT/ARK-1-026"; // 霜星: 【启动主要】 rests one opposing front-line character (a character ability that chooses)

type Act = (who: string, action: UnionArenaAction) => void;
const pick = (act: Act, who: string, picks: string[]): void => act(who, { type: "choose", picks });
/** Any action ends in a recalculation of the continuous effects; this one changes nothing. */
const refresh = (act: Act, who = "a"): void => act(who, { type: "manual", manual: { op: "ap", apId: `${who}:ap0`, act: "activate" } });
const sidelineByHand = (act: Act, card: UnionArenaFieldCard, who = "a"): void => act(who, { type: "manual", manual: { op: "field", owner: "you", uid: card.uid, act: "sideline" } });
const activeAp = (player: { ap: Array<{ rested: boolean }> }): number => player.ap.filter((card) => !card.rested).length;
/** The attacked player picks a life card, and does not use a trigger. */
const resolveDamage = (act: Act, defender: EnginePlayer): void => {
  const lifeId = defender.life[0]!.id;
  act("a", { type: "damage", lifeIds: [lifeId] });
  act(defender.accountId, { type: "trigger", lifeId, activate: false });
};
const names = (game: EngineGame, cardIds: Array<string | null>): string[] => cardIds.map((cardId) => (cardId ? ctx.card(cardId)?.name ?? "?" : "-"));

const BATCH = ["001", "002", "003", "004", "005", "007", "008", "009", "010", "011", "012", "014", "015", "016", "017", "018", "020", "021", "022", "024", "025", "026", "027", "028", "029", "030", "031", "032", "033", "034", "035"];

describe("JJK 1 batch", () => {
  it("every card of the batch plays automatically", () => {
    for (const number of BATCH) expect(isAutomated(titleCard(J(number))), number).toBe(true);
  });

  it("虎杖 悠仁 (001): 启动主要 rests it for +1 yellow energy this turn, once per turn; it is sidelined when the main phase ends", () => {
    const { game, a, act } = setup();
    const yuji = field(a, "energy", J("001"));
    expect(energyOf(ctx, a, "yellow")).toBe(1);
    act("a", { type: "activate", uid: yuji.uid, ability: 0 });
    expect(yuji.rested).toBe(true);
    expect(energyOf(ctx, a, "yellow")).toBe(2);
    expect(() => act("a", { type: "activate", uid: yuji.uid, ability: 0 })).toThrow();
    act("a", { type: "next_phase" }); // the main phase ends
    expect(game.pending).toBeNull();
    expect(a.energy).toHaveLength(0);
    expect(a.sideline).toEqual([J("001")]);
  });

  it("虎杖 悠仁 (001): without the activation it stays on the field when the main phase ends", () => {
    const { a, act } = setup();
    field(a, "energy", J("001"));
    act("a", { type: "next_phase" });
    expect(a.energy).toHaveLength(1);
    expect(a.sideline).toEqual([]);
  });

  it("虎杖 悠仁 (002), 熊猫 (015, 016): only keyword lines; the keyword comes from the card data", () => {
    expect(ctx.card(J("002"))!.keywords).toEqual(["冲击无效"]);
    expect(ctx.card(J("015"))!.keywords).toEqual(["撤步"]);
    expect(ctx.card(J("016"))!.keywords).toEqual(["撤步"]);
    expect(ctx.card(J("002"))!.abilities).toEqual([]);
  });

  it("狗巻 棘 (003): returns another cost-1-or-less character to the hand; with none, returns itself", () => {
    const { game, a, act } = setup();
    energy(a, 1, FILLER);
    const energyCard = a.energy[0]!;
    const extra = field(a, "front", BLUE0);
    const big = field(a, "front", GUARD);
    a.hand.push(J("003"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const options = choice(game, "a").options;
    expect(options).toContain(energyCard.uid);
    expect(options).toContain(extra.uid);
    expect(options).not.toContain(big.uid);
    expect(options).toHaveLength(2);
    pick(act, "a", [extra.uid]);
    expect(a.hand).toEqual([BLUE0]);
    expect(a.front.map((card) => card.cardId)).toEqual([GUARD, J("003")]);

    // No other character of cost 1 or less (the energy source costs 3): the card returns itself.
    const second = setup();
    field(second.a, "energy", J("025"));
    field(second.a, "front", GUARD);
    second.a.hand.push(J("003"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([J("003")]);
    expect(second.a.front.map((card) => card.cardId)).toEqual([GUARD]);
  });

  it("狗巻 棘 (004): 退场时 rests up to one opposing front-line character", () => {
    const { game, a, b, act } = setup();
    const inumaki = field(a, "front", J("004"));
    const t1 = field(b, "front", FILLER);
    const t2 = field(b, "front", GUARD);
    const back = field(b, "energy", FILLER);
    sidelineByHand(act, inumaki);
    expect(choice(game, "a").options.sort()).toEqual([t1.uid, t2.uid].sort());
    expect(choice(game).options).not.toContain(back.uid);
    pick(act, "a", [t2.uid]);
    expect(t2.rested).toBe(true);
    expect(t1.rested).toBe(false);
    expect(back.rested).toBe(false);

    // "最多1张": it may rest none.
    const second = setup();
    const k = field(second.a, "front", J("004"));
    const target = field(second.b, "front", FILLER);
    sidelineByHand(second.act, k);
    pick(second.act, "a", []);
    expect(target.rested).toBe(false);
  });

  it("狗巻 棘 (005): 启动主要 for 1 AP gives every front-line character BP+1000 this turn, once per turn", () => {
    const { a, b, act } = setup();
    const inumaki = field(a, "front", J("005"));
    const other = field(a, "front", FILLER);
    const back = field(a, "energy", FILLER);
    const foe = field(b, "front", FILLER);
    act("a", { type: "activate", uid: inumaki.uid, ability: 0 });
    expect(activeAp(a)).toBe(2);
    expect(bpOf(ctx, inumaki)).toBe(2000 + 1000);
    expect(bpOf(ctx, other)).toBe(1500 + 1000);
    expect(bpOf(ctx, back)).toBe(1500);
    expect(bpOf(ctx, foe)).toBe(1500);
    expect(() => act("a", { type: "activate", uid: inumaki.uid, ability: 0 })).toThrow();
  });

  it("狗巻 棘 (005): needs an active AP card", () => {
    const { a, act } = setup();
    const inumaki = field(a, "front", J("005"));
    a.ap.forEach((card) => { card.rested = true; });
    expect(() => act("a", { type: "activate", uid: inumaki.uid, ability: 0 })).toThrow();
    expect(bpOf(ctx, inumaki)).toBe(2000);
  });

  it("钉崎 野蔷薇 (007): while on the front line, rests itself to rest up to one opposing front-line character", () => {
    const { game, a, b, act } = setup();
    const nobara = field(a, "front", J("007"));
    const t1 = field(b, "front", FILLER);
    const t2 = field(b, "front", GUARD);
    const back = field(b, "energy", FILLER);
    act("a", { type: "activate", uid: nobara.uid, ability: 0 });
    expect(nobara.rested).toBe(true);
    expect(choice(game, "a").options.sort()).toEqual([t1.uid, t2.uid].sort());
    expect(choice(game).options).not.toContain(back.uid);
    pick(act, "a", [t1.uid]);
    expect(t1.rested).toBe(true);
    expect(t2.rested).toBe(false);

    // Not on the front line: it cannot be used. Resting costs, so a resting card cannot either.
    const second = setup();
    const onEnergy = field(second.a, "energy", J("007"));
    expect(() => second.act("a", { type: "activate", uid: onEnergy.uid, ability: 0 })).toThrow();
    expect(onEnergy.rested).toBe(false);

    // "最多1张": picking none still costs the rest.
    const third = setup();
    const n3 = field(third.a, "front", J("007"));
    const t3 = field(third.b, "front", FILLER);
    third.act("a", { type: "activate", uid: n3.uid, ability: 0 });
    pick(third.act, "a", []);
    expect(n3.rested).toBe(true);
    expect(t3.rested).toBe(false);
  });

  it("钉崎 野蔷薇 (008): 启动主要 for 1 AP gives it 伤害2 this turn, once per turn", () => {
    const { a, act } = setup();
    const nobara = field(a, "front", J("008"));
    expect(damageOf(ctx, nobara)).toBe(1);
    act("a", { type: "activate", uid: nobara.uid, ability: 0 });
    expect(activeAp(a)).toBe(2);
    expect(hasKeyword(ctx, nobara, "伤害2")).toBe(true);
    expect(damageOf(ctx, nobara)).toBe(2);
    expect(() => act("a", { type: "activate", uid: nobara.uid, ability: 0 })).toThrow();
  });

  it("钉崎 野蔷薇 (008): 登场时 rests up to one opposing front-line character whose next switch to active does not happen", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, FILLER);
    const t1 = field(b, "front", FILLER);
    const t2 = field(b, "front", GUARD);
    a.hand.push(J("008"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options.sort()).toEqual([t1.uid, t2.uid].sort());
    pick(act, "a", [t1.uid]);
    expect(t1.rested).toBe(true);
    expect(t1.skipNextActivate).toBe(true);
    expect(t2.rested).toBe(false);
    expect(t2.skipNextActivate).toBe(false);
    // The opponent's start phase: t1 does not switch to active this time.
    act("a", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("b");
    expect(t1.rested).toBe(true);
    expect(t1.skipNextActivate).toBe(false);
  });

  it("钉崎 野蔷薇 (008): the 登场时 also happens when it Raids 钉崎 野蔷薇, and may rest none", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, FILLER);
    const base = field(a, "front", J("007"), true);
    const target = field(b, "front", FILLER);
    a.hand.push(J("008"));
    act("a", { type: "raid", handIndex: 0, targetUid: base.uid });
    expect(base.cardId).toBe(J("008"));
    expect(base.rested).toBe(false);
    expect(choice(game, "a").options).toEqual([target.uid]);
    pick(act, "a", []);
    expect(target.rested).toBe(false);
    expect(target.skipNextActivate).toBe(false);
  });

  it("五条 悟 (009): required energy -1 while the opponent has a blue or purple card", () => {
    const { game, a, b, players } = setup();
    const cost = (): number => costOf(game, players, ctx, "a", J("009")).energy;
    expect(cost()).toBe(3);
    field(b, "front", FILLER);
    field(b, "front", RED0);
    expect(cost()).toBe(3);
    field(b, "energy", BLUE0);
    expect(cost()).toBe(2);

    const second = setup();
    field(second.b, "front", PURPLE0);
    expect(costOf(second.game, second.players, ctx, "a", J("009")).energy).toBe(2);
  });

  it("五条 悟 (010): 登场时 puts up to one opposing site on the bottom of the opponent's deck", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, FILLER);
    const site = field(b, "energy", J("027"));
    field(b, "front", FILLER);
    field(a, "energy", J("028")); // our own site is not offered
    a.hand.push(J("010"));
    const before = b.library.length;
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([site.uid]);
    pick(act, "a", [site.uid]);
    expect(b.energy.map((card) => card.cardId)).toEqual([]);
    expect(b.front).toHaveLength(1);
    expect(b.library).toHaveLength(before + 1);
    expect(b.library[b.library.length - 1]).toBe(J("027"));
    expect(a.energy.some((card) => card.cardId === J("028"))).toBe(true);

    // "最多1张": it may choose none.
    const second = setup();
    energy(second.a, 4, FILLER);
    const keep = field(second.b, "energy", J("027"));
    second.a.hand.push(J("010"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.b.energy).toEqual([keep]);
  });

  it("五条 悟 (011): during the opponent's turn it cannot be chosen by a character's effect unless 1 AP is paid", () => {
    // Our turn: no tax on the card; the opponent's turn: the tax mark.
    const ours = setup("main", "a");
    const mine = field(ours.a, "front", J("011"));
    refresh(ours.act, "a");
    expect(flagsOf(mine)).not.toContain("taxAp:character");

    const { game, a, b, act } = setup("main", "b");
    const gojo = field(a, "front", J("011"));
    const frost = field(b, "front", FROST);
    refresh(act, "b");
    expect(flagsOf(gojo)).toEqual(expect.arrayContaining(["taxAp:character", "taxAp:event"]));
    // The opponent's 霜星 can only choose 五条 悟: it is chosen and the opponent's AP card rests.
    act("b", { type: "activate", uid: frost.uid, ability: 0 });
    expect(game.pending).toBeNull();
    expect(gojo.rested).toBe(true);
    expect(activeAp(b)).toBe(2);

    // No active AP card to pay with: it cannot be chosen at all.
    const broke = setup("main", "b");
    const gojo2 = field(broke.a, "front", J("011"));
    const frost2 = field(broke.b, "front", FROST);
    refresh(broke.act, "b");
    broke.b.ap.forEach((card) => { card.rested = true; });
    broke.act("b", { type: "activate", uid: frost2.uid, ability: 0 });
    expect(gojo2.rested).toBe(false);
  });

  it("五条 悟 (011): the same for an event card's effect (虚式「茈」 removes it only when 1 AP is left to pay)", () => {
    const rich = setup("main", "b");
    const gojo = field(rich.a, "front", J("011"));
    energy(rich.b, 5, FILLER);
    rich.b.hand.push(J("029"));
    refresh(rich.act, "b");
    rich.act("b", { type: "event", handIndex: 0 }); // 2 AP for the event, 1 AP for the tax
    expect(rich.game.pending).toBeNull();
    expect(rich.a.front).toEqual([]);
    expect(rich.a.removal).toEqual([J("011")]);
    expect(activeAp(rich.b)).toBe(0);
    expect(gojo.cardId).toBe(J("011"));

    const poor = setup("main", "b");
    const other = field(poor.a, "front", FILLER);
    const gojo2 = field(poor.a, "front", J("011"));
    energy(poor.b, 5, FILLER);
    poor.b.hand.push(J("029"));
    poor.b.ap[2]!.rested = true; // only 2 AP cards left: the event takes both
    refresh(poor.act, "b");
    poor.act("b", { type: "event", handIndex: 0 });
    // 五条 悟 cannot be chosen (no AP left to pay with): the other character is the only target.
    expect(poor.a.front).toEqual([gojo2]);
    expect(poor.a.removal).toEqual([FILLER]);
    expect(other.cardId).toBe(FILLER);
  });

  it("五条 悟 (012): 登场时 draws a card; the next card used from the hand other than 〈五条 悟〉 costs 1 AP less (this turn only)", () => {
    const { game, a, players, act } = setup();
    energy(a, 6, FILLER);
    a.hand.push(J("012"), J("009"), FILLER, FILLER);
    const library = a.library.length;
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(activeAp(a)).toBe(1); // the card itself costs 2 AP
    expect(a.library).toHaveLength(library - 1);
    expect(a.hand).toEqual([J("009"), FILLER, FILLER, FILLER]);
    expect(costOf(game, players, ctx, "a", FILLER).ap).toBe(0);
    expect(costOf(game, players, ctx, "a", J("009")).ap).toBe(1);
    // Another 五条 悟 does not use the discount up.
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(activeAp(a)).toBe(0);
    expect(costOf(game, players, ctx, "a", FILLER).ap).toBe(0);
    act("a", { type: "play", handIndex: 0, line: "front" }); // free of AP thanks to the discount
    expect(a.front).toHaveLength(3);
    expect(activeAp(a)).toBe(0);
    // Used up: the next card costs its 1 AP, which is not there.
    expect(costOf(game, players, ctx, "a", FILLER).ap).toBe(1);
    expect(() => act("a", { type: "play", handIndex: 0, line: "front" })).toThrow();
  });

  it("五条 悟 (012): the discount also applies to an event, and only lasts for the turn", () => {
    const { game, a, players, act } = setup();
    energy(a, 9, FILLER);
    a.hand.push(J("012"), J("034"), J("034"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(costOf(game, players, ctx, "a", J("034")).ap).toBe(0);
    act("a", { type: "event", handIndex: 0 });
    expect(game.pending?.kind).toBe("choose");
    pick(act, "a", []);
    expect(activeAp(a)).toBe(1);
    expect(costOf(game, players, ctx, "a", J("034")).ap).toBe(1);

    // An unused discount does not carry over to another turn.
    const second = setup();
    energy(second.a, 6, FILLER);
    second.a.hand.push(J("012"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(costOf(second.game, second.players, ctx, "a", FILLER).ap).toBe(0);
    second.game.turn += 2;
    expect(costOf(second.game, second.players, ctx, "a", FILLER).ap).toBe(1);
  });

  it("禅院 真希 (014): produces +1 yellow energy while active", () => {
    const { a, act } = setup();
    const maki = field(a, "energy", J("014"));
    refresh(act);
    expect(energyOf(ctx, a, "yellow")).toBe(2);
    maki.rested = true;
    refresh(act);
    expect(energyOf(ctx, a, "yellow")).toBe(1);
  });

  it("熊猫 (017): BP+1000 (4000 in all); keywords and Raid come from the card data", () => {
    const { a, act } = setup();
    const panda = field(a, "front", J("017"));
    refresh(act);
    expect(bpOf(ctx, panda)).toBe(4000);
    for (const keyword of ["撤步", "2次阻挡", "冲击1"]) expect(hasKeyword(ctx, panda, keyword)).toBe(true);
    expect(ctx.card(J("017"))!.raid!.targets).toEqual(["熊猫"]);
  });

  it("伏黑 津美纪 (018): 登场时 gives up to one other character BP+1000 this turn", () => {
    const { game, a, act } = setup();
    const other = field(a, "front", FILLER);
    a.hand.push(J("018"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual([other.uid]); // not itself
    pick(act, "a", [other.uid]);
    expect(bpOf(ctx, other)).toBe(2500);

    const second = setup();
    const o2 = field(second.a, "energy", FILLER);
    second.a.hand.push(J("018"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(bpOf(ctx, o2)).toBe(1500);
    expect(bpOf(ctx, second.a.front[0]!)).toBe(500);
  });

  it("伏黑 惠 (020): looks at five, reveals up to one 式神 into the hand, the rest go to the bottom in the chosen order", () => {
    const { game, a, act } = setup();
    energy(a, 3, FILLER);
    const rest = a.library.slice(5);
    a.library = [GUARD, J("024"), J("026"), FILLER, J("025"), ...rest];
    a.hand.push(J("020"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toEqual(["l:1", "l:2", "l:4"]);
    pick(act, "a", ["l:2"]);
    expect(a.hand).toEqual([J("026")]);
    // The four left, in an order of our choosing.
    pick(act, "a", ["l:3", "l:0", "l:2", "l:1"]);
    expect(a.library.slice(0, rest.length)).toEqual(rest);
    expect(a.library.slice(rest.length)).toEqual([J("025"), GUARD, FILLER, J("024")]);

    // No 式神 among the five: nothing to reveal.
    const second = setup();
    energy(second.a, 3, FILLER);
    const rest2 = second.a.library.slice(5);
    second.a.library = [GUARD, FILLER, GUARD, FILLER, GUARD, ...rest2];
    second.a.hand.push(J("020"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(second.game).options).toEqual(["l:0", "l:1", "l:2", "l:3", "l:4"]); // only the order is asked
    pick(second.act, "a", ["l:4", "l:3", "l:2", "l:1", "l:0"]);
    expect(second.a.hand).toEqual([]);
    expect(second.a.library.slice(rest2.length)).toEqual([GUARD, FILLER, GUARD, FILLER, GUARD]);

    // Up to one: it may be declined.
    const third = setup();
    energy(third.a, 3, FILLER);
    const rest3 = third.a.library.slice(5);
    third.a.library = [J("024"), GUARD, GUARD, GUARD, GUARD, ...rest3];
    third.a.hand.push(J("020"));
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(third.act, "a", []);
    pick(third.act, "a", ["l:0", "l:1", "l:2", "l:3", "l:4"]);
    expect(third.a.hand).toEqual([]);
    expect(third.a.library.slice(rest3.length)[0]).toBe(J("024"));
  });

  it("伏黑 惠 (021): 登场时 puts a 式神 of cost 3 or less and AP 1 from the hand onto the field, active", () => {
    const { game, a, act } = setup();
    energy(a, 3, FILLER);
    a.sideline.push(J("026"));
    a.hand.push(J("021"), GUARD, J("024"), J("025"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(names(game, choice(game, "a").cards)).toEqual(["玉犬:黑&白", "玉犬:浑"]);
    pick(act, "a", ["h:1"]);
    expect(choice(game, "a").options.sort()).toEqual(["line:energy", "line:front"]);
    pick(act, "a", ["line:front"]);
    const dog = a.front.find((card) => card.cardId === J("024"))!;
    expect(dog.rested).toBe(false);
    expect(a.hand).toEqual([GUARD, J("025")]);
    expect(a.sideline).toEqual([J("026")]);
    expect(game.pending).toBeNull();
  });

  it("伏黑 惠 (021): when none is taken from the hand, one can be taken from the sideline; or none at all", () => {
    const { game, a, act } = setup();
    energy(a, 3, FILLER);
    a.sideline.push(J("026"), GUARD);
    a.hand.push(J("021"), GUARD);
    act("a", { type: "play", handIndex: 0, line: "front" });
    // Nothing suitable in the hand (so no question there): the sideline is asked.
    expect(choice(game, "a").options).toEqual(["s:0"]);
    pick(act, "a", ["s:0"]);
    pick(act, "a", ["line:energy"]);
    const nue = a.energy.find((card) => card.cardId === J("026"))!;
    expect(nue.rested).toBe(false);
    expect(a.sideline).toEqual([GUARD]);

    const second = setup();
    energy(second.a, 3, FILLER);
    second.a.sideline.push(J("026"));
    second.a.hand.push(J("021"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.game.pending).toBeNull();
    expect(second.a.sideline).toEqual([J("026")]);
    expect(second.a.front.map((card) => card.cardId)).toEqual([J("021")]);
  });

  it("伏黑 惠 (022): Raiding 伏黑 惠; 登场时 reveals a 式神 or 〈嵌合暗翳庭〉, then puts an affordable AP-1 式神 from the hand onto the field resting", () => {
    const { game, a, act } = setup();
    energy(a, 4, FILLER);
    const megumi = field(a, "front", J("020"), true);
    const rest = a.library.slice(5);
    a.library = [GUARD, J("027"), J("024"), FILLER, GUARD, ...rest];
    a.hand.push(J("022"), J("085"), J("025"), J("026"), GUARD);
    act("a", { type: "raid", handIndex: 0, targetUid: megumi.uid });
    expect(megumi.cardId).toBe(J("022"));
    expect(megumi.rested).toBe(false);
    expect(choice(game, "a").options).toEqual(["l:1", "l:2"]); // the site and the 式神, not the others
    pick(act, "a", ["l:1"]);
    expect(a.hand).toContain(J("027"));
    pick(act, "a", ["l:3", "l:2", "l:1", "l:0"]);
    expect(a.library.slice(rest.length)).toEqual([GUARD, FILLER, J("024"), GUARD]);
    // 吉野 顺平&淀月 (purple 式神) is not affordable with yellow energy only; the site and 阿米娅-like cards are not 式神 characters.
    const options = choice(game, "a").options;
    expect(names(game, choice(game).cards).sort()).toEqual(["玉犬:浑", "鵺"].sort());
    expect(options).toHaveLength(2);
    pick(act, "a", [options[0]!]);
    pick(act, "a", ["line:front"]);
    const placed = a.front.find((card) => card.uid !== megumi.uid && card.cardId !== J("020"))!;
    expect(placed.rested).toBe(true);
    expect(["玉犬:浑", "鵺"]).toContain(ctx.card(placed.cardId)!.name);
    expect(game.pending).toBeNull();
  });

  it("伏黑 惠 (022): may reveal nothing and put nothing", () => {
    const { game, a, act } = setup();
    energy(a, 4, FILLER);
    const megumi = field(a, "energy", J("021"), true);
    a.library = [GUARD, GUARD, J("024"), GUARD, GUARD, ...a.library.slice(5)];
    a.hand.push(J("022"), J("026"));
    act("a", { type: "raid", handIndex: 0, targetUid: megumi.uid, toFront: true });
    expect(a.front).toContain(megumi);
    pick(act, "a", []);
    pick(act, "a", ["l:0", "l:1", "l:2", "l:3", "l:4"]);
    pick(act, "a", []);
    expect(game.pending).toBeNull();
    expect(a.hand).toEqual([J("026")]);
    expect(a.front).toEqual([megumi]);
  });

  it("玉犬:黑&白 (024): 攻击时 gives up to one other character BP+500", () => {
    const { game, a, act } = setup("attack");
    const dog = field(a, "front", J("024"));
    const other = field(a, "front", FILLER);
    act("a", { type: "attack", attackerUid: dog.uid });
    expect(choice(game, "a").options).toEqual([other.uid]);
    pick(act, "a", [other.uid]);
    expect(bpOf(ctx, other)).toBe(2000);
    expect(bpOf(ctx, dog)).toBe(2000);
    expect(game.pending?.kind).toBe("damage");

    const second = setup("attack");
    const d2 = field(second.a, "front", J("024"));
    const o2 = field(second.a, "front", FILLER);
    second.act("a", { type: "attack", attackerUid: d2.uid });
    pick(second.act, "a", []);
    expect(bpOf(ctx, o2)).toBe(1500);
  });

  it("玉犬:浑 (025): has 伤害2 while 〈玉犬:黑&白〉 is in our sideline", () => {
    const { a, b, act } = setup();
    const kon = field(a, "front", J("025"));
    refresh(act);
    expect(damageOf(ctx, kon)).toBe(1);
    b.sideline.push(J("024")); // the opponent's sideline does not count
    a.sideline.push(J("026"));
    refresh(act);
    expect(damageOf(ctx, kon)).toBe(1);
    a.sideline.push(J("024"));
    refresh(act);
    expect(hasKeyword(ctx, kon, "伤害2")).toBe(true);
    expect(damageOf(ctx, kon)).toBe(2);
    a.sideline = [];
    refresh(act);
    expect(damageOf(ctx, kon)).toBe(1);
  });

  it("鵺 (026): 攻击时 draws a card, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup("attack");
    const nue = field(a, "front", J("026"));
    a.hand.push(GUARD);
    const library = a.library.length;
    act("a", { type: "attack", attackerUid: nue.uid });
    expect(a.library).toHaveLength(library - 1);
    expect(choice(game, "a").options).toEqual(["h:0", "h:1"]);
    pick(act, "a", ["h:0"]);
    expect(a.sideline).toEqual([GUARD]);
    expect(a.hand).toEqual([FILLER]);
  });

  it("嵌合暗翳庭 (027): 启动主要 for 1 AP gives all our 式神 on the field BP+1000 this turn, once per turn", () => {
    const { a, b, act } = setup();
    const site = field(a, "energy", J("027"));
    const dog = field(a, "front", J("024"));
    const nue = field(a, "energy", J("026"));
    const plain = field(a, "front", FILLER);
    const foeDog = field(b, "front", J("024"));
    act("a", { type: "activate", uid: site.uid, ability: 0 });
    expect(activeAp(a)).toBe(2);
    expect(bpOf(ctx, dog)).toBe(3000);
    expect(bpOf(ctx, nue)).toBe(3000);
    expect(bpOf(ctx, plain)).toBe(1500);
    expect(bpOf(ctx, foeDog)).toBe(2000);
    expect(() => act("a", { type: "activate", uid: site.uid, ability: 0 })).toThrow();
  });

  it("嵌合暗翳庭 (027): when our 〈伏黑 恵〉 attacks, switches up to one front-line 式神 to active, once per turn; other attackers do nothing", () => {
    const { game, a, b, act } = setup("attack");
    const site = field(a, "energy", J("027"));
    const megumiA = field(a, "front", J("020"));
    const megumiB = field(a, "front", J("020"));
    const dog = field(a, "front", J("024"), true);
    const plain = field(a, "front", FILLER);
    const nueBack = field(a, "energy", J("026"), true);
    // Another attacker: nothing happens and the once-per-turn use stays.
    act("a", { type: "attack", attackerUid: plain.uid });
    expect(game.pending?.kind).toBe("damage");
    resolveDamage(act, b);
    expect(dog.rested).toBe(true);
    // 伏黑 惠 attacks: the front-line 式神 may be switched to active (not the one on the energy line, not the non-式神).
    act("a", { type: "attack", attackerUid: megumiA.uid });
    expect(choice(game, "a").options).toEqual([dog.uid]);
    pick(act, "a", [dog.uid]);
    expect(dog.rested).toBe(false);
    expect(nueBack.rested).toBe(true);
    expect(game.pending?.kind).toBe("damage");
    resolveDamage(act, b);
    // Second 伏黑 惠: once per turn, so no question.
    dog.rested = true;
    act("a", { type: "attack", attackerUid: megumiB.uid });
    expect(game.pending?.kind).toBe("damage");
    expect(dog.rested).toBe(true);
    expect(site.used).toContain(1);
  });

  it("嵌合暗翳庭 (027): the question may be answered with none", () => {
    const { game, a, act } = setup("attack");
    field(a, "energy", J("027"));
    const megumi = field(a, "front", J("020"));
    const dog = field(a, "front", J("024"), true);
    act("a", { type: "attack", attackerUid: megumi.uid });
    pick(act, "a", []);
    expect(dog.rested).toBe(true);
    expect(game.pending?.kind).toBe("damage");
  });

  it("无量空处 (028): 登场时 rests an opposing front-line character that does not switch to active in start and end phases while the site stays; the site leaves when no 〈五条 悟〉 is on our front line", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GEN2);
    field(a, "front", J("009")); // 五条 悟
    a.hand.push(J("028"));
    const target = field(b, "front", GUARD);
    const other = field(b, "front", FILLER, true);
    act("a", { type: "play", handIndex: 0, line: "energy" });
    expect(choice(game, "a").options.sort()).toEqual([target.uid, other.uid].sort());
    pick(act, "a", [target.uid]);
    expect(target.rested).toBe(true);
    const site = a.energy.find((card) => card.cardId === J("028"))!;
    // Our turn ends: 五条 悟 is on the front line, so the site stays; the opponent's start phase does not wake the target.
    act("a", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("b");
    expect(a.energy).toContain(site);
    expect(target.rested).toBe(true);
    expect(other.rested).toBe(false);
    // The opponent's end phase: still no. Other resting characters do switch to active.
    other.rested = true;
    act("b", { type: "next_phase" });
    act("b", { type: "next_phase" });
    act("b", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("a");
    expect(a.energy).toContain(site); // their attack phase ended too, 五条 悟 is still there
    expect(target.rested).toBe(true);
    expect(other.rested).toBe(false);
    // Our next turn: 五条 悟 is gone, so at the end of the attack phase the site is sidelined and the target wakes up in their next start phase.
    a.front = a.front.filter((card) => card.cardId !== J("009"));
    act("a", { type: "next_phase" });
    act("a", { type: "next_phase" });
    act("a", { type: "end_turn" });
    expect(a.energy).not.toContain(site);
    expect(a.sideline).toContain(J("028"));
    expect(game.turnPlayerId).toBe("b");
    expect(target.rested).toBe(false);
  });

  it("无量空处 (028): with no 〈五条 悟〉 on the front line it is sidelined at the end of the attack phase at once; the choice may be none", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, GEN2);
    a.hand.push(J("028"));
    const target = field(b, "front", GUARD);
    act("a", { type: "play", handIndex: 0, line: "energy" });
    pick(act, "a", [target.uid]);
    expect(target.rested).toBe(true);
    act("a", { type: "end_turn" });
    expect(a.sideline).toContain(J("028"));
    expect(game.turnPlayerId).toBe("b");
    expect(target.rested).toBe(false); // nothing holds it any more

    const second = setup();
    energy(second.a, 2, GEN2);
    second.a.hand.push(J("028"));
    const t2 = field(second.b, "front", GUARD);
    second.act("a", { type: "play", handIndex: 0, line: "energy" });
    pick(second.act, "a", []);
    expect(t2.rested).toBe(false);
    expect(t2.lasting ?? []).toEqual([]);
  });

  it("虚式「茈」 (029): costs 1 AP less with 〈五条 悟〉 on our field; puts an opposing front-line character into the removal area", () => {
    const { game, a, b, players, act } = setup();
    energy(a, 5, FILLER);
    a.hand.push(J("029"));
    const t1 = field(b, "front", FILLER);
    const t2 = field(b, "front", GUARD);
    expect(costOf(game, players, ctx, "a", J("029")).ap).toBe(2);
    field(a, "energy", J("009"));
    expect(costOf(game, players, ctx, "a", J("029")).ap).toBe(1);
    act("a", { type: "event", handIndex: 0 });
    expect(activeAp(a)).toBe(2);
    expect(choice(game, "a").options.sort()).toEqual([t1.uid, t2.uid].sort());
    pick(act, "a", [t2.uid]);
    expect(b.front).toEqual([t1]);
    expect(b.removal).toEqual([GUARD]);
    expect(a.sideline).toEqual([J("029")]);
  });

  it("术式反转「赫」 (030): moves an opposing front-line character of BP 4000 or less to the energy line", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, FILLER);
    a.hand.push(J("030"));
    const t1 = field(b, "front", FILLER);
    const strong = field(b, "front", J("012")); // BP5000
    const t2 = field(b, "front", GUARD);
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options.sort()).toEqual([t1.uid, t2.uid].sort());
    pick(act, "a", [t2.uid]);
    expect(b.front).toEqual([t1, strong]);
    expect(b.energy).toEqual([t2]);
  });

  it("术式反转「赫」 (030): with no room on the energy line, its owner (the opponent) puts one card there into the removal area first", () => {
    const { game, a, b, act } = setup();
    energy(a, 3, FILLER);
    a.hand.push(J("030"));
    const t1 = field(b, "front", FILLER);
    energy(b, 4, FILLER);
    const victim = b.energy[1]!;
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "b").options).toEqual(b.energy.map((card) => card.uid));
    pick(act, "b", [victim.uid]);
    expect(b.removal).toEqual([FILLER]);
    expect(b.energy).toHaveLength(4);
    expect(b.energy).toContain(t1);
    expect(b.energy).not.toContain(victim);
    expect(b.front).toEqual([]);
  });

  it("刍灵咒法「簪」 (031): sidelines an opposing front-line character that is resting", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, FILLER);
    a.hand.push(J("031"));
    const active = field(b, "front", FILLER);
    const r1 = field(b, "front", GUARD, true);
    const r2 = field(b, "front", RED0, true);
    const restingBack = field(b, "energy", FILLER, true);
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options.sort()).toEqual([r1.uid, r2.uid].sort());
    pick(act, "a", [r2.uid]);
    expect(b.sideline).toEqual([RED0]);
    expect(b.front).toEqual([active, r1]);
    expect(b.energy).toEqual([restingBack]);
  });

  it("刍灵咒法「簪」 (031): with no resting character on their front line nothing happens", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, FILLER);
    a.hand.push(J("031"));
    field(b, "front", FILLER);
    act("a", { type: "event", handIndex: 0 });
    expect(game.pending).toBeNull();
    expect(b.sideline).toEqual([]);
    expect(a.sideline).toEqual([J("031")]);
  });

  it("刍灵咒法「共鸣」 (032): rests an active front-line character of ours and one of theirs; with 〈钉崎 野蔷薇〉 on our field, an AP card switches to active", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, FILLER);
    a.hand.push(J("032"));
    field(a, "front", GUARD, true); // resting: not chosen
    const mine = field(a, "front", FILLER);
    field(a, "energy", J("007")); // 钉崎 野蔷薇 (on the energy line, so not a front-line choice)
    const t1 = field(b, "front", RED0);
    const t2 = field(b, "front", GUARD);
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options.sort()).toEqual([t1.uid, t2.uid].sort());
    pick(act, "a", [t1.uid]);
    expect(mine.rested).toBe(true);
    expect(t1.rested).toBe(true);
    expect(t2.rested).toBe(false);
    // The event cost 1 AP; it is switched back.
    expect(activeAp(a)).toBe(2);
    expect(choice(game, "a").options).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
    pick(act, "a", ["ap:a:ap0"]);
    expect(activeAp(a)).toBe(3);
  });

  it("刍灵咒法「共鸣」 (032): without 〈钉崎 野蔷薇〉 there is no AP effect", () => {
    const { game, a, b, act } = setup();
    energy(a, 2, FILLER);
    a.hand.push(J("032"));
    const mine = field(a, "front", FILLER);
    const t1 = field(b, "front", RED0);
    act("a", { type: "event", handIndex: 0 });
    expect(game.pending).toBeNull();
    expect(mine.rested).toBe(true);
    expect(t1.rested).toBe(true);
    expect(activeAp(a)).toBe(2);
  });

  it("十种影法术 (033): draws a card, puts a 式神 (cost 3 or less, AP 1) from the hand onto the front line resting; active with 〈伏黑 恵〉 on our field", () => {
    const { game, a, act } = setup();
    energy(a, 3, FILLER);
    a.hand.push(J("033"), GUARD, J("024"), J("021"));
    const library = a.library.length;
    act("a", { type: "event", handIndex: 0 });
    expect(a.library).toHaveLength(library - 1);
    expect(names(game, choice(game, "a").cards)).toEqual(["玉犬:黑&白"]); // 伏黑 惠 (021) and 阿米娅-like cards are not 式神
    pick(act, "a", ["h:1"]);
    expect(game.pending).toBeNull();
    expect(a.front.map((card) => card.cardId)).toEqual([J("024")]);
    expect(a.front[0]!.rested).toBe(true);

    const second = setup();
    energy(second.a, 3, FILLER);
    field(second.a, "energy", J("020")); // 伏黑 惠
    second.a.hand.push(J("033"), J("025"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", ["h:0"]);
    const kon = second.a.front.find((card) => card.cardId === J("025"))!;
    expect(kon.rested).toBe(false);
  });

  it("十种影法术 (033): a 式神 from the sideline when none is taken from the hand; or none at all", () => {
    const { game, a, act } = setup();
    energy(a, 3, FILLER);
    a.sideline.push(J("026"), GUARD);
    a.hand.push(J("033"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game, "a").options).toEqual(["s:0"]);
    pick(act, "a", ["s:0"]);
    expect(a.front.map((card) => card.cardId)).toEqual([J("026")]);
    expect(a.front[0]!.rested).toBe(true);
    expect(a.sideline).toEqual([GUARD, J("033")]); // the event itself goes to the sideline after it resolves

    const second = setup();
    energy(second.a, 3, FILLER);
    second.a.sideline.push(J("026"));
    second.a.hand.push(J("033"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", []);
    expect(second.a.front).toEqual([]);
    expect(second.a.sideline).toEqual([J("026"), J("033")]);
  });

  it("领域展开 (034): switches up to two of our AP cards to active", () => {
    const { game, a, act } = setup();
    energy(a, 3, FILLER);
    a.ap[1]!.rested = true;
    a.hand.push(J("034"));
    act("a", { type: "event", handIndex: 0 });
    expect(a.ap.map((card) => card.rested)).toEqual([true, true, false]);
    expect(choice(game, "a").options).toEqual(["ap:a:ap0", "ap:a:ap1", "ap:a:ap2"]);
    expect(choice(game).max).toBe(2);
    pick(act, "a", ["ap:a:ap0", "ap:a:ap1"]);
    expect(a.ap.map((card) => card.rested)).toEqual([false, false, false]);

    const second = setup();
    energy(second.a, 3, FILLER);
    second.a.hand.push(J("034"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", ["ap:a:ap0"]);
    expect(second.a.ap.map((card) => card.rested)).toEqual([false, false, false]);

    const third = setup();
    energy(third.a, 3, FILLER);
    third.a.hand.push(J("034"));
    third.act("a", { type: "event", handIndex: 0 });
    pick(third.act, "a", []);
    expect(third.a.ap.map((card) => card.rested)).toEqual([true, false, false]);
  });

  it("家入 硝子 (035): required energy -1 while the opponent has a yellow or purple card", () => {
    const { game, b, players } = setup();
    const cost = (): number => costOf(game, players, ctx, "a", J("035")).energy;
    expect(cost()).toBe(3);
    field(b, "front", BLUE0);
    field(b, "energy", RED0);
    expect(cost()).toBe(3);
    field(b, "energy", FILLER);
    expect(cost()).toBe(2);

    const second = setup();
    field(second.b, "front", PURPLE0);
    expect(costOf(second.game, second.players, ctx, "a", J("035")).energy).toBe(2);
  });
});
