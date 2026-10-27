/**
 * The red cards' abilities (龙门, 企鹅物流, 黑钢国际, red 罗德岛): one test per card, set up as its printed text describes, checking the result
 * against the text. The card text was checked against the card images before these were written.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  beginFirstTurn,
  bpOf,
  costOf,
  energyOf,
  flagsOf,
  hasKeyword,
  impactOf,
  newEngineGame,
  type EngineGame,
  type EnginePlayer
} from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaChoice, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { cardContext } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";
import { UNION_ARENA_CATALOG } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/catalog.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx = cardContext((cardId) => byId.get(cardId));
const id = (number: string): string => UNION_ARENA_CATALOG.find((card) => card.number === number && card.imageAvailable)!.id;
const ark = (n: string): string => id(`UC01BT/ARK-1-${n}`);
const ex = (n: string): string => id(`UCEX01BT/ARK-2-${n}`);

// Helper cards without abilities.
const NINE = ark("088"); // 九: red, BP2000, 龙门
const CHEN = ark("084"); // 陈: red, BP1500, 龙门
const TEXAS0 = ark("073"); // 德克萨斯: red, BP1500, 企鹅物流
const TEXAS = ark("074"); // 德克萨斯: red, cost 1, printed BP2500, AP1, 企鹅物流, 撤步
const HOSHI = ark("090"); // 星熊: red, BP2000, 2次阻挡, 龙门
const KINGSLAYER = ark("004"); // yellow
const GUARD = id("UC01ST/ARK-1-103"); // blue, BP3000
// Cards with abilities used as helpers.
const ANGEL071 = ark("071"); // 能天使: red, cost 2, printed BP2500, 企鹅物流
const CHEN086 = ark("086"); // 陈: BP4000, 伤害2
const HOSHI092 = ark("092"); // 星熊: BP4000
const CHIXIAO = ark("096"); // 赤霄・拔刀 (event)
const SHUANGYE = ark("079"); // 霜叶

function player(accountId: string): EnginePlayer {
  return { accountId, username: accountId.toUpperCase(), hand: [], library: Array(30).fill(KINGSLAYER), life: Array.from({ length: 7 }, (_, index) => ({ id: `${accountId}:life:${index}`, cardId: KINGSLAYER, faceUp: false })), apCount: 3, ap: [], front: [], energy: [], sideline: [], removal: [] };
}

let seq = 0;
function field(owner: EnginePlayer, line: "front" | "energy", cardId: string, rested = false): UnionArenaFieldCard {
  seq += 1;
  const card: UnionArenaFieldCard = { uid: `${owner.accountId}:t${seq}`, cardId, under: [], rested, bpMod: 0, energyMod: 0, grants: [], attacks: 0, blocks: 0, skipNextActivate: false, used: [] };
  owner[line].push(card);
  return card;
}
const energy = (owner: EnginePlayer, count: number, cardId = NINE): void => { for (let index = 0; index < count; index += 1) field(owner, "energy", cardId); };

/** `first`'s turn, in the given phase, with three active AP cards. */
function setup(phase: "main" | "attack" = "main", first: "a" | "b" = "a") {
  const a = player("a");
  const b = player("b");
  const game = newEngineGame(first, []);
  beginFirstTurn(game, [a, b]);
  const turn = first === "a" ? a : b;
  turn.ap = [0, 1, 2].map((index) => ({ id: `${first}:ap${index}`, rested: false }));
  const players = [a, b];
  const act = (who: string, action: UnionArenaAction): void => applyAction(game, players, ctx, who, action);
  while (game.phase !== phase) act(first, { type: "next_phase" });
  return { game, a, b, players, act };
}

const choice = (game: EngineGame, playerId?: string): UnionArenaChoice => {
  expect(game.pending?.kind).toBe("choose");
  if (playerId) expect(game.pending?.playerId).toBe(playerId);
  return game.pending as UnionArenaChoice;
};
const handIndexOf = (owner: EnginePlayer, cardId: string): number => owner.hand.indexOf(cardId);

describe("黑钢国际", () => {
  it("杰西卡 (1-067): rests itself, once per turn, to give one other printed-BP-2500 character BP+1500", () => {
    const { game, a, act } = setup();
    const jessica = field(a, "front", ark("067"));
    const texas = field(a, "front", TEXAS);
    field(a, "front", CHEN);
    act("a", { type: "activate", uid: jessica.uid, ability: 0 });
    expect(jessica.rested).toBe(true);
    expect(choice(game, "a").options).toEqual([texas.uid]);
    act("a", { type: "choose", picks: [texas.uid] });
    expect(bpOf(ctx, texas)).toBe(4000);
    expect(() => act("a", { type: "activate", uid: jessica.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });

  it("雷蛇 (1-069): 阻挡时, with a printed-BP-2500 character on the front line, gives one own character BP+500", () => {
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", NINE);
    const razor = field(b, "front", ark("069"));
    field(b, "front", TEXAS, true);
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: razor.uid });
    act("b", { type: "choose", picks: [choice(game, "b").options[0]!] });
    expect(bpOf(ctx, razor)).toBe(4500);
    expect(a.front).toHaveLength(1);
  });
});

describe("企鹅物流", () => {
  it("能天使 (1-070): 登场时 gives one printed-BP-2500 character BP+1500", () => {
    const { game, a, act } = setup();
    const texas = field(a, "energy", TEXAS);
    a.hand.push(ark("070"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual([texas.uid]);
    act("a", { type: "choose", picks: [texas.uid] });
    expect(bpOf(ctx, texas)).toBe(4000);
  });

  it("能天使 (1-071): once per turn switches itself to active with BP-2000 for the turn", () => {
    const { a, act } = setup();
    const angel = field(a, "front", ANGEL071, true);
    act("a", { type: "activate", uid: angel.uid, ability: 0 });
    expect(angel.rested).toBe(false);
    expect(bpOf(ctx, angel)).toBe(500);
    expect(() => act("a", { type: "activate", uid: angel.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });

  it("能天使 (1-072): when its attack ends, may rest an active printed-BP-2500 energy character to switch itself to active with BP-1500", () => {
    const { game, a, b, act } = setup("attack");
    const angel = field(a, "front", ark("072"));
    const texas = field(a, "energy", TEXAS);
    field(b, "front", NINE, true);
    act("a", { type: "attack", attackerUid: angel.uid });
    act("a", { type: "damage", lifeIds: [b.life[0]!.id] });
    act("b", { type: "trigger", lifeId: "b:life:0", activate: false });
    expect(choice(game, "a").purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(texas.rested).toBe(true);
    expect(angel.rested).toBe(false);
    expect(bpOf(ctx, angel)).toBe(1000);
  });

  it("德克萨斯 (1-075): 登场时 looks at five, reveals up to one red BP-2500 character other than 〈德克萨斯〉 into the hand, the rest to the bottom in a chosen order", () => {
    const { game, a, act } = setup();
    energy(a, 3);
    a.library = [TEXAS, ANGEL071, CHEN, NINE, KINGSLAYER, GUARD];
    a.hand.push(ark("075"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual(["l:1"]);
    act("a", { type: "choose", picks: ["l:1"] });
    expect(a.hand).toEqual([ANGEL071]);
    const order = choice(game);
    expect(order).toMatchObject({ ordered: true, min: 4, max: 4 });
    act("a", { type: "choose", picks: ["l:3", "l:2", "l:1", "l:0"] });
    expect(a.library).toEqual([GUARD, KINGSLAYER, NINE, CHEN, TEXAS]);
    expect(game.pending).toBeNull();
  });

  it("德克萨斯 (1-076): 登场时 puts a red BP-2500 AP-1 character from hand onto the field (active on the energy line); its Activate: Main gives BP+1500", () => {
    const { game, a, act } = setup();
    energy(a, 4);
    a.hand.push(ark("076"), TEXAS);
    act("a", { type: "play", handIndex: 0, line: "front" });
    act("a", { type: "choose", picks: [choice(game).options[0]!] }); // TEXAS from hand
    expect(choice(game).options).toEqual(["line:front", "line:energy"]);
    act("a", { type: "choose", picks: ["line:energy"] });
    // The energy line is full: one of its cards goes to the removal area first.
    const room = choice(game);
    act("a", { type: "choose", picks: [room.options[0]!] });
    const placed = a.energy.find((card) => card.cardId === TEXAS)!;
    expect(placed.rested).toBe(false);
    expect(a.removal).toEqual([NINE]);
    const texas076 = a.front[0]!;
    a.hand.push(CHEN);
    act("a", { type: "activate", uid: texas076.uid, ability: 1 });
    expect(a.sideline).toEqual([CHEN]);
    expect(bpOf(ctx, placed)).toBe(4000);
  });
});

describe("罗德岛 (red)", () => {
  it("阿米娅 (1-077): generates one more red energy while active", () => {
    const { a, act } = setup();
    const amiya = field(a, "energy", ark("077"));
    act("a", { type: "next_phase" });
    expect(energyOf(ctx, a, "red")).toBe(2);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: amiya.uid, act: "rest" } });
    expect(energyOf(ctx, a, "red")).toBe(1);
  });

  it("凯尔希 (1-078): costs one less while the opponent has a yellow or blue card", () => {
    const { game, b, players } = setup();
    const kaltsit = ark("078");
    expect(costOf(game, players, ctx, "a", kaltsit).energy).toBe(3);
    field(b, "energy", KINGSLAYER);
    expect(costOf(game, players, ctx, "a", kaltsit).energy).toBe(2);
  });

  it("霜叶 (1-079): the chosen opponent character cannot move and cannot be rested by its owner's effects until the start of our next turn", () => {
    const { game, a, b, act } = setup();
    energy(a, 3);
    const target = field(b, "energy", NINE);
    a.hand.push(SHUANGYE);
    act("a", { type: "play", handIndex: 0, line: "front" });
    act("a", { type: "choose", picks: [target.uid] });
    expect(flagsOf(target)).toEqual(expect.arrayContaining(["cannotMove", "noSelfRest"]));
    act("a", { type: "end_turn" });
    act("b", { type: "next_phase" });
    expect(() => act("b", { type: "move", toFront: [target.uid], toEnergy: [], remove: [] })).toThrow("CANNOT_MOVE");
    act("b", { type: "next_phase" });
    act("b", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("a");
    expect(flagsOf(target)).toEqual([]);
  });
});

describe("龙门", () => {
  it("魏彦吾 (1-081): looks at four, reveals up to one 龙门 card into the hand, the rest to the bottom, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 3);
    a.library = [KINGSLAYER, CHEN, GUARD, TEXAS0, KINGSLAYER];
    a.hand.push(ark("081"), TEXAS0);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual(["l:1"]);
    act("a", { type: "choose", picks: ["l:1"] });
    act("a", { type: "choose", picks: ["l:0", "l:1", "l:2"] });
    expect(a.library.slice(-3)).toEqual([KINGSLAYER, GUARD, TEXAS0]);
    // Added to the hand: one hand card goes to the sideline.
    act("a", { type: "choose", picks: [`h:${handIndexOf(a, TEXAS0)}`] });
    expect(a.hand).toEqual([CHEN]);
    expect(a.sideline).toEqual([TEXAS0]);
  });

  it("诗怀雅 (1-082): 登场时 draws one, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    a.library = [CHEN, KINGSLAYER];
    a.hand.push(ark("082"), NINE);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([CHEN]);
    expect(a.sideline).toEqual([NINE]);
  });

  it("陈 (1-085): once per turn may put two 龙门 hand cards into the sideline for BP+500 and 伤害2", () => {
    const { game, a, act } = setup();
    const chen = field(a, "front", ark("085"));
    a.hand.push(CHEN, KINGSLAYER, NINE);
    act("a", { type: "activate", uid: chen.uid, ability: 0 });
    expect(choice(game).purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.sideline).toEqual([CHEN, NINE]);
    expect(a.hand).toEqual([KINGSLAYER]);
    expect(bpOf(ctx, chen)).toBe(3000);
    expect(hasKeyword(ctx, chen, "伤害2")).toBe(true);
  });

  it("陈 (1-086): 退场时 returns up to one 〈赤霄・拔刀〉 or 2次阻挡 character from the sideline to the hand", () => {
    const { game, a, act } = setup();
    const chen = field(a, "front", CHEN086);
    a.sideline.push(CHIXIAO, NINE, HOSHI);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: chen.uid, act: "sideline" } });
    expect(choice(game).options).toEqual(["s:0", "s:2"]);
    act("a", { type: "choose", picks: ["s:0"] });
    expect(a.hand).toEqual([CHIXIAO]);
  });

  it("陈 (1-087): costs one less per own 2次阻挡 character; its Activate: Main gives BP+1000 and draws when the chosen one has 2次阻挡", () => {
    const { game, a, players, act } = setup();
    const chen087 = ark("087");
    expect(costOf(game, players, ctx, "a", chen087).energy).toBe(6);
    const hoshi = field(a, "front", HOSHI);
    field(a, "energy", HOSHI);
    expect(costOf(game, players, ctx, "a", chen087).energy).toBe(4);
    const chen = field(a, "front", chen087);
    act("a", { type: "activate", uid: chen.uid, ability: 1 });
    act("a", { type: "choose", picks: [hoshi.uid] });
    expect(bpOf(ctx, hoshi)).toBe(3000);
    expect(a.hand).toHaveLength(1);
  });

  it("文月 (1-089): rests itself for one more red energy this turn, and is sidelined when the main phase ends", () => {
    const { a, act } = setup();
    const wenyue = field(a, "energy", ark("089"));
    act("a", { type: "activate", uid: wenyue.uid, ability: 0 });
    expect(energyOf(ctx, a, "red")).toBe(2);
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([ark("089")]);
  });

  it("星熊 (1-091): sidelined by the opponent's effect, it sidelines an opponent front character with BP 3000 or less; not when it loses a battle", () => {
    const { game, a, b, act } = setup();
    energy(a, 4);
    const victim = field(a, "front", NINE);
    field(b, "front", ark("091"));
    a.hand.push(CHIXIAO);
    act("a", { type: "event", handIndex: 0 });
    // b's 星熊 was the only legal target; its ability asks b.
    act("b", { type: "choose", picks: [choice(game, "b").options[0]!] });
    expect(a.front).not.toContain(victim);

    const second = setup("attack");
    const attacker = field(second.a, "front", HOSHI092);
    const hoshi = field(second.b, "front", ark("091"));
    second.act("a", { type: "attack", attackerUid: attacker.uid });
    second.act("b", { type: "block", blockerUid: hoshi.uid });
    expect(second.b.sideline).toEqual([ark("091")]);
    expect(second.game.pending).toBeNull();
  });

  it("星熊 (1-092): gives BP+1000; if the chosen one has 伤害2 it gets BP+1000 itself until the start of our next turn", () => {
    const { game, a, act } = setup();
    const hoshi = field(a, "front", HOSHI092);
    const chen = field(a, "front", CHEN086);
    act("a", { type: "activate", uid: hoshi.uid, ability: 0 });
    act("a", { type: "choose", picks: [chen.uid] });
    expect(bpOf(ctx, chen)).toBe(5000);
    expect(bpOf(ctx, hoshi)).toBe(5000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, hoshi)).toBe(5000);
    act("b", { type: "next_phase" });
    act("b", { type: "next_phase" });
    act("b", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("a");
    expect(bpOf(ctx, hoshi)).toBe(4000);
  });

  it("米莎 (1-093): returns another own character with required energy 1 or less to the hand, or else itself", () => {
    const { game, a, act } = setup();
    field(a, "energy", NINE);
    const chen = field(a, "front", CHEN);
    a.hand.push(ark("093"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    act("a", { type: "choose", picks: [chen.uid] });
    expect(a.hand).toEqual([CHEN]);

    const second = setup();
    field(second.a, "energy", ANGEL071);
    second.a.hand.push(ark("093"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([ark("093")]);
    expect(second.a.front).toEqual([]);
  });

  it("林 (1-094): resting on the front line, the other front characters cannot be chosen by the opponent's character effects (events still can)", () => {
    const { game, a, b, act } = setup("main", "b");
    const lin = field(a, "front", ark("094"), true);
    const chen = field(a, "front", CHEN);
    energy(b, 4);
    b.hand.push(SHUANGYE, CHIXIAO);
    act("b", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "b").options).toEqual([lin.uid]);
    act("b", { type: "choose", picks: [] });
    act("b", { type: "event", handIndex: 0 });
    expect(choice(game, "b").options).toEqual(expect.arrayContaining([chen.uid]));
  });

  it("林 (1-094): in our end phase it may stay resting", () => {
    const { game, a, act } = setup();
    const lin = field(a, "front", ark("094"), true);
    act("a", { type: "end_turn" });
    expect(choice(game, "a").purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(lin.rested).toBe(true);
    expect(game.turnPlayerId).toBe("b");
  });

  it("龙门 (site, 1-095): rests and sidelines itself to give a 龙门 character 冲击+1 (Impact 1 when it has none)", () => {
    const { game, a, act } = setup();
    const site = field(a, "energy", ark("095"));
    const chen = field(a, "front", CHEN);
    act("a", { type: "activate", uid: site.uid, ability: 0 });
    expect(a.sideline).toEqual([ark("095")]);
    expect(choice(game).options).toContain(chen.uid);
    act("a", { type: "choose", picks: [chen.uid] });
    expect(impactOf(ctx, chen)).toBe(1);
  });

  it("陈 (ST 1-113): pays 1 AP once per turn for 伤害2; 攻击时 with a 2次阻挡 character it draws one and puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    const chen = field(a, "front", id("UC01ST/ARK-1-113"));
    act("a", { type: "activate", uid: chen.uid, ability: 0 });
    expect(a.ap.filter((card) => card.rested)).toHaveLength(1);
    expect(hasKeyword(ctx, chen, "伤害2")).toBe(true);
    field(a, "energy", HOSHI);
    a.hand.push(NINE);
    act("a", { type: "next_phase" });
    act("a", { type: "attack", attackerUid: chen.uid });
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.sideline).toEqual([NINE]);
    expect(a.hand).toEqual([KINGSLAYER]);
  });

  it("诗怀雅 (2-067): 退场时 gives another own character BP+3000", () => {
    const { game, a, act } = setup();
    const swire = field(a, "front", ex("067"));
    const chen = field(a, "front", CHEN);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: swire.uid, act: "sideline" } });
    act("a", { type: "choose", picks: [chen.uid] });
    expect(bpOf(ctx, chen)).toBe(4500);
    expect(game.pending).toBeNull();
  });

  it("陈 (2-068): 退场时 draws one", () => {
    const { a, act } = setup();
    const chen = field(a, "front", ex("068"));
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: chen.uid, act: "sideline" } });
    expect(a.hand).toEqual([KINGSLAYER]);
  });

  it("陈 (2-069): gains 伤害2 only with another 2次阻挡 character on its line", () => {
    const { a, act } = setup();
    const chen = field(a, "front", ex("069"));
    field(a, "energy", HOSHI);
    expect(() => act("a", { type: "activate", uid: chen.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    field(a, "front", HOSHI);
    act("a", { type: "activate", uid: chen.uid, ability: 0 });
    expect(hasKeyword(ctx, chen, "伤害2")).toBe(true);
  });

  it("星熊 (2-070): on the front line, once per turn, 2 or more damage at once may become 1", () => {
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", CHEN086);
    const second = field(a, "front", CHEN086);
    field(b, "front", ex("070"), true);
    act("a", { type: "attack", attackerUid: attacker.uid });
    expect(choice(game, "b").purpose).toBe("confirm");
    act("b", { type: "choose", picks: ["yes"] });
    expect(game.pending).toMatchObject({ kind: "damage", amount: 1 });
    act("a", { type: "damage", lifeIds: [b.life[0]!.id] });
    act("b", { type: "trigger", lifeId: "b:life:0", activate: false });
    // Used this turn: the next 2 damage stays 2.
    act("a", { type: "attack", attackerUid: second.uid });
    expect(game.pending).toMatchObject({ kind: "damage", amount: 2 });
  });

  it("星熊 (2-071): with opponent front characters, switches a 伤害2 character to active", () => {
    const { b, a, act } = setup();
    const hoshi = field(a, "front", ex("071"));
    const chen = field(a, "front", CHEN086, true);
    expect(() => act("a", { type: "activate", uid: hoshi.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    field(b, "front", NINE);
    act("a", { type: "activate", uid: hoshi.uid, ability: 0 });
    expect(chen.rested).toBe(false);
  });

  it("林 (2-072): resting on the front line, the other front characters cannot be chosen by the opponent's events (characters still can)", () => {
    const { game, a, b, act } = setup("main", "b");
    field(a, "front", ex("072"), true);
    const chen = field(a, "front", CHEN);
    energy(b, 4);
    b.hand.push(CHIXIAO, SHUANGYE);
    act("b", { type: "event", handIndex: 0 });
    expect(game.pending === null || !(game.pending as UnionArenaChoice).options.includes(chen.uid)).toBe(true);
    expect(a.front.map((card) => card.uid)).toContain(chen.uid);
    b.ap[0]!.rested = false;
    act("b", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "b").options).toContain(chen.uid);
  });
});

describe("Red events", () => {
  it("弹幕！ (1-097): BP 2000 or less, +1000 for each own printed-BP-2500 character", () => {
    const { a, b, act } = setup();
    energy(a, 3);
    field(a, "front", TEXAS);
    field(a, "front", ANGEL071);
    const small = field(b, "front", NINE);
    small.bpMod = 2000; // 4000
    const big = field(b, "front", NINE);
    big.bpMod = 2100; // 4100
    a.hand.push(ark("097"));
    act("a", { type: "event", handIndex: 0 });
    expect(b.front).toEqual([big]);
    expect(a.sideline).toEqual([ark("097")]);
  });

  it("企鹅物流 (1-098): looks at seven, reveals up to one 企鹅物流 card and up to one BP-2500 character (not the same card)", () => {
    const { game, a, act } = setup();
    energy(a, 3);
    a.library = [ANGEL071, TEXAS0, CHEN, NINE, KINGSLAYER, GUARD, TEXAS, CHEN];
    a.hand.push(ark("098"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game).options).toEqual(["l:0", "l:1", "l:6"]);
    act("a", { type: "choose", picks: ["l:0"] });
    expect(choice(game).options).toEqual(["l:6"]);
    act("a", { type: "choose", picks: ["l:6"] });
    expect(a.hand).toEqual([ANGEL071, TEXAS]);
    act("a", { type: "choose", picks: [...choice(game).options] });
    expect(a.library).toEqual([CHEN, TEXAS0, CHEN, NINE, KINGSLAYER, GUARD]);
  });

  it("龙门近卫局 (1-099): own 伤害2 / 2次阻挡 characters cannot be blocked by characters with BP 3000 or less this turn", () => {
    const { game, a, b, act } = setup();
    energy(a, 4);
    const chen = field(a, "front", CHEN086);
    const weak = field(b, "front", NINE);
    a.hand.push(ark("099"));
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "next_phase" });
    act("a", { type: "attack", attackerUid: chen.uid });
    // No blocker can block it: the attack hits straight away, for 2 (伤害2).
    expect(game.pending).toMatchObject({ kind: "damage", amount: 2 });
    expect(weak.rested).toBe(false);
  });

  it("龙门币 (1-100): switches up to two AP cards to active", () => {
    const { game, a, act } = setup();
    energy(a, 3);
    a.ap[1]!.rested = true;
    a.ap[2]!.rested = true;
    a.hand.push(ark("100"));
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "choose", picks: ["ap:a:ap1", "ap:a:ap2"] });
    expect(a.ap.filter((card) => !card.rested)).toHaveLength(2);
    expect(game.pending).toBeNull();
  });

  it("满是谜团的物流公司 (2-073): any red characters with total BP 7500 or less", () => {
    const { game, a, act } = setup();
    energy(a, 4);
    a.library = [TEXAS, ANGEL071, HOSHI092, CHEN, GUARD, NINE];
    a.hand.push(ex("073"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game).options).toEqual(["l:0", "l:1", "l:2", "l:3"]);
    expect(() => act("a", { type: "choose", picks: ["l:0", "l:1", "l:2"] })).toThrow("INVALID_CHOICE");
    act("a", { type: "choose", picks: ["l:0", "l:1", "l:3"] });
    expect(a.hand).toEqual([TEXAS, ANGEL071, CHEN]);
  });
});

describe("Other red cards", () => {
  it("能天使 (ST 1-112): moves itself to the other line once per turn; a full line gives up a card first", () => {
    const { game, a, act } = setup();
    const angel = field(a, "front", id("UC01ST/ARK-1-112"));
    energy(a, 4);
    act("a", { type: "activate", uid: angel.uid, ability: 0 });
    act("a", { type: "choose", picks: [choice(game).options[0]!] });
    expect(a.energy).toContain(angel);
    expect(a.front).toEqual([]);
    expect(a.removal).toEqual([NINE]);
  });

  it("莫斯提马 (2-062): opponent front characters that win a block this turn move to the energy line", () => {
    const { a, b, act } = setup();
    energy(a, 4);
    const attacker = field(a, "front", NINE);
    const blocker = field(b, "front", HOSHI092);
    a.hand.push(ex("062"));
    act("a", { type: "play", handIndex: 0, line: "energy", remove: a.energy[0]!.uid });
    act("a", { type: "next_phase" });
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: blocker.uid });
    expect(b.energy).toContain(blocker);
    expect(b.front).toEqual([]);
  });

  it("能天使 (2-063): BP-2000 on the front line during the opponent's turn; 退场时 looks at three for a 企鹅物流 or BP-2500 card", () => {
    const { game, a, act } = setup();
    const angel = field(a, "front", ex("063"));
    act("a", { type: "next_phase" });
    expect(bpOf(ctx, angel)).toBe(2500);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, angel)).toBe(500);

    const second = setup();
    const other = field(second.a, "front", ex("063"));
    second.a.library = [CHEN, ANGEL071, TEXAS0, NINE];
    second.act("a", { type: "manual", manual: { op: "field", owner: "you", uid: other.uid, act: "sideline" } });
    expect(choice(second.game, "a").options).toEqual(["l:1", "l:2"]);
    second.act("a", { type: "choose", picks: ["l:2"] });
    second.act("a", { type: "choose", picks: ["l:1", "l:0"] });
    expect(second.a.hand).toEqual([TEXAS0]);
    expect(second.a.library).toEqual([NINE, ANGEL071, CHEN]);
  });

  it("可颂 (2-064): 阻挡时 may rest another active printed-BP-2500 front character for BP+2500", () => {
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", NINE);
    attacker.bpMod = 2000; // 4000
    const croissant = field(b, "front", ex("064"));
    const texas = field(b, "front", TEXAS);
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: croissant.uid });
    act("b", { type: "choose", picks: ["yes"] });
    expect(texas.rested).toBe(true);
    expect(b.front).toContain(croissant);
    expect(game.pending).toBeNull();
  });

  it("空 (2-065): cannot attack; rests to give BP+500, or BP+1500 and return itself to the hand", () => {
    const { game, a, act } = setup();
    const sora = field(a, "front", ex("065"));
    const chen = field(a, "front", CHEN);
    act("a", { type: "activate", uid: sora.uid, ability: 1 });
    expect(choice(game).labels).toHaveLength(2);
    act("a", { type: "choose", picks: ["m:1"] });
    expect(bpOf(ctx, chen)).toBe(3000);
    expect(a.hand).toEqual([ex("065")]);

    const second = setup();
    const other = field(second.a, "front", ex("065"));
    second.act("a", { type: "next_phase" });
    expect(() => second.act("a", { type: "attack", attackerUid: other.uid })).toThrow("INVALID_ATTACKER");
  });

  it("德克萨斯 (2-066): costs 2 less with an empty field; 退场时 puts a red BP-2500 AP-1 character (not 〈德克萨斯〉) from hand onto the front line", () => {
    const { game, a, players, act } = setup();
    expect(costOf(game, players, ctx, "a", ex("066")).energy).toBe(0);
    const texas = field(a, "front", ex("066"));
    expect(costOf(game, players, ctx, "a", ex("066")).energy).toBe(2);
    a.hand.push(TEXAS, ANGEL071);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: texas.uid, act: "sideline" } });
    expect(choice(game).options).toEqual(["h:1"]);
    act("a", { type: "choose", picks: ["h:1"] });
    expect(a.front.map((card) => [card.cardId, card.rested])).toEqual([[ANGEL071, true]]);
  });
});
