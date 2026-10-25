/**
 * The yellow cards' abilities (整合运动 / 雪怪小队): one test per card, set up as its printed text describes, checking the result against the
 * text. The card text was checked against the card images before these were written.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  beginFirstTurn,
  bpOf,
  canBlock,
  costOf,
  energyOf,
  hasKeyword,
  impactOf,
  newEngineGame,
  type EngineGame,
  type EnginePlayer
} from "../../../../Arknights/ArknightsWorkSpace/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaChoice, UnionArenaFieldCard } from "../../../../Arknights/ArknightsWorkSpace/src/shared/protocol.ts";
import { cardContext } from "../../../../Arknights/ArknightsWorkSpace/src/shared/abilities/registry.ts";
import { UNION_ARENA_CATALOG } from "../../../../Arknights/ArknightsWorkSpace/src/server/catalog.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx = cardContext((cardId) => byId.get(cardId));
const id = (number: string): string => UNION_ARENA_CATALOG.find((card) => card.number === number && card.imageAvailable)!.id;
const ark = (n: string): string => id(`UC01BT/ARK-1-${n}`);
const ex = (n: string): string => id(`UCEX01BT/ARK-2-${n}`);

// Helper cards without abilities.
const KS = ark("004"); // 弑君者: yellow, cost 0, BP1500, 整合运动
const W0 = ark("009"); // W: yellow, cost 0, BP2000
const NINE = ark("088"); // 九: red, cost 0, BP2000
const GUARD = id("UC01ST/ARK-1-103"); // Guard: blue, cost 3, BP3000
// Cards with abilities used as helpers.
const MISHA001 = ark("001"); // 米莎: yellow, cost 0, BP1000
const MISHA002 = ark("002"); // 米莎: yellow, cost 1, 【登场时】 BP+2000
const SUIGU = ark("007"); // 碎骨: yellow, cost 2 (0 in the sideline), Raid 米莎 / 亚历克斯
const SOLDIER = ark("022"); // 整合运动士兵: yellow, cost 0, BP1000
const YETI = ark("023"); // 雪怪小队: yellow, cost 0
const FROST024 = ark("024"); // 霜星: yellow, cost 0, BP1500, 雪怪小队
const HOSHI092 = ark("092"); // 星熊: red, BP4000
const SHUANGYE = ark("079"); // 霜叶: red, 【登场时】 chooses an opponent character
const CHIXIAO = ark("096"); // 赤霄・拔刀: red event
const MEPH = ex("008"); // 梅菲斯特: yellow, cost 0, draws when it leaves the field by our effect on our turn

function player(accountId: string): EnginePlayer {
  return { accountId, username: accountId.toUpperCase(), hand: [], library: Array(30).fill(KS), life: Array.from({ length: 7 }, (_, index) => ({ id: `${accountId}:life:${index}`, cardId: KS, faceUp: false })), apCount: 3, ap: [], front: [], energy: [], sideline: [], removal: [] };
}

let seq = 0;
function field(owner: EnginePlayer, line: "front" | "energy", cardId: string, rested = false): UnionArenaFieldCard {
  seq += 1;
  const card: UnionArenaFieldCard = { uid: `${owner.accountId}:t${seq}`, cardId, under: [], rested, bpMod: 0, energyMod: 0, grants: [], attacks: 0, blocks: 0, skipNextActivate: false, used: [] };
  owner[line].push(card);
  return card;
}
/** `count` energy-line cards; each generates 1 + `extra` energy of its colour. */
const energy = (owner: EnginePlayer, count: number, cardId = KS, extra = 0): void => { for (let index = 0; index < count; index += 1) field(owner, "energy", cardId).energyMod = extra; };

/** `first`'s turn, in the given phase, with three active AP cards. */
function setup(phase: "movement" | "main" | "attack" = "main", first: "a" | "b" = "a") {
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
const pick = (act: (who: string, action: UnionArenaAction) => void, who: string, picks: string[]): void => act(who, { type: "choose", picks });
const sidelineManually = (act: (who: string, action: UnionArenaAction) => void, card: UnionArenaFieldCard, who = "a"): void =>
  act(who, { type: "manual", manual: { op: "field", owner: "you", uid: card.uid, act: "sideline" } });

describe("整合运动 (UC01BT)", () => {
  it("亚历克斯 (1-003): 退场时 returns up to one character with Raid from the sideline to the hand", () => {
    const { game, a, act } = setup();
    const alex = field(a, "front", ark("003"));
    a.sideline.push(KS, ark("006"), ark("008"));
    sidelineManually(act, alex);
    expect(choice(game, "a").options).toEqual(["s:1", "s:2"]);
    pick(act, "a", ["s:1"]);
    expect(a.hand).toEqual([ark("006")]);
  });

  it("弑君者 (1-005): looks at three, reveals up to one 整合运动 card; only when one was added, puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1);
    a.library = [GUARD, SOLDIER, NINE, GUARD];
    a.hand.push(ark("005"), NINE);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual(["l:1"]);
    pick(act, "a", ["l:1"]);
    pick(act, "a", ["l:0", "l:1"]);
    expect(a.library).toEqual([GUARD, GUARD, NINE]);
    pick(act, "a", [`h:${a.hand.indexOf(NINE)}`]);
    expect(a.hand).toEqual([SOLDIER]);
    expect(a.sideline).toEqual([NINE]);

    const second = setup();
    energy(second.a, 1);
    second.a.library = [GUARD, NINE, GUARD];
    second.a.hand.push(ark("005"), NINE);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    // Nothing to reveal: only the order for the bottom is asked, and no discard.
    pick(second.act, "a", ["l:0", "l:1", "l:2"]);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([NINE]);
  });

  it("弑君者 (1-006): cannot be blocked by BP 2000 or less; unblocked, puts a cost-0 yellow character from hand onto the field", () => {
    const { game, a, b, act } = setup("attack");
    const kingslayer = field(a, "front", ark("006"));
    field(b, "front", NINE); // BP2000: cannot block
    a.hand.push(GUARD, SOLDIER);
    act("a", { type: "attack", attackerUid: kingslayer.uid });
    expect(choice(game, "a").options).toEqual(["h:1"]);
    pick(act, "a", ["h:1"]);
    pick(act, "a", ["line:front"]);
    const soldier = a.front.find((card) => card.cardId === SOLDIER)!;
    // 整合运动士兵 came onto the field by our effect: active, BP+2000.
    expect(soldier.rested).toBe(false);
    expect(bpOf(ctx, soldier)).toBe(3000);
    expect(game.pending).toMatchObject({ kind: "damage", amount: 1 });
  });

  it("弑君者 (1-006): resting three active characters makes it unblockable by BP 4000 or more this turn, once per turn", () => {
    const { game, a, b, act } = setup();
    const kingslayer = field(a, "front", ark("006"));
    const others = [field(a, "front", KS), field(a, "energy", KS), field(a, "energy", W0)];
    act("a", { type: "activate", uid: kingslayer.uid, ability: 2 });
    expect(choice(game).min).toBe(3);
    pick(act, "a", others.map((card) => card.uid));
    expect(others.every((card) => card.rested)).toBe(true);
    const big = field(b, "front", HOSHI092);
    const mid = field(b, "front", GUARD);
    expect(canBlock(ctx, kingslayer, big)).toBe(false);
    expect(canBlock(ctx, kingslayer, mid)).toBe(true);
    expect(() => act("a", { type: "activate", uid: kingslayer.uid, ability: 2 })).toThrow("ONCE_PER_TURN");

    // Fewer than three active characters: nothing happens.
    const second = setup();
    const other = field(second.a, "front", ark("006"));
    const helper = field(second.a, "front", KS);
    second.act("a", { type: "activate", uid: other.uid, ability: 2 });
    expect(helper.rested).toBe(false);
    expect(canBlock(ctx, other, field(second.b, "front", HOSHI092))).toBe(true);
  });

  it("碎骨 (1-007): BP+1500 on our turn only", () => {
    const { a, act } = setup();
    const suigu = field(a, "front", SUIGU);
    act("a", { type: "next_phase" });
    expect(bpOf(ctx, suigu)).toBe(4000);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, suigu)).toBe(2500);
  });

  it("碎骨 (1-007): 退场时 may activate its Raid source's 【登场时】 effect", () => {
    const { game, a, act } = setup();
    const suigu = field(a, "front", SUIGU);
    suigu.under = [MISHA002];
    const ks = field(a, "front", KS);
    sidelineManually(act, suigu);
    expect(choice(game).options).toEqual(["s:0"]);
    pick(act, "a", ["s:0"]);
    // 米莎 (1-002): choose up to one own character with required energy 2 or less, BP+2000.
    expect(choice(game).options).toEqual([ks.uid]);
    pick(act, "a", [ks.uid]);
    expect(bpOf(ctx, ks)).toBe(3500);
    expect(a.sideline).toEqual([MISHA002, SUIGU]);

    // Declining: nothing happens; without a Raid source there is nothing to ask.
    const second = setup();
    const other = field(second.a, "front", SUIGU);
    other.under = [MISHA002];
    sidelineManually(second.act, other);
    pick(second.act, "a", []);
    expect(second.game.pending).toBeNull();
    const third = setup();
    sidelineManually(third.act, field(third.a, "front", SUIGU));
    expect(third.game.pending).toBeNull();
  });

  it("碎骨 (1-008): 登场时 returns a cost-0 yellow character from the sideline (碎骨 1-007 costs 0 there)", () => {
    const { game, a, act } = setup();
    energy(a, 4);
    a.sideline.push(SUIGU, GUARD, FROST024, ark("002"));
    a.hand.push(ark("008"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual(["s:0", "s:2"]);
    pick(act, "a", ["s:0"]);
    expect(a.hand).toEqual([SUIGU]);
  });

  it("碎骨 (1-008): 攻击时 gives one cost-2-or-less character BP+2000, or up to two BP+1000", () => {
    const { game, a, act } = setup("attack");
    const suigu = field(a, "front", ark("008"));
    const ks = field(a, "front", KS);
    const w = field(a, "energy", W0);
    act("a", { type: "attack", attackerUid: suigu.uid });
    expect(choice(game).labels).toHaveLength(2);
    pick(act, "a", ["m:1"]);
    expect(choice(game).options).toEqual([ks.uid, w.uid]);
    pick(act, "a", [ks.uid, w.uid]);
    expect(bpOf(ctx, ks)).toBe(2500);
    expect(bpOf(ctx, w)).toBe(3000);
    expect(bpOf(ctx, suigu)).toBe(4000);
  });

  it("W (1-010): returns another own character with required energy 1 or less to the hand, or else itself", () => {
    const { game, a, act } = setup();
    energy(a, 1);
    const ks = field(a, "front", KS);
    a.hand.push(ark("010"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", [ks.uid]);
    expect(a.hand).toEqual([KS]);

    const second = setup();
    field(second.a, "energy", ark("013")); // 塔露拉: cost 3
    second.a.hand.push(ark("010"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([ark("010")]);
  });

  it("W (1-011): unblocked, may draw up to two cards in hand", () => {
    const { game, a, act } = setup("attack");
    const w = field(a, "front", ark("011"));
    act("a", { type: "attack", attackerUid: w.uid });
    expect(choice(game).purpose).toBe("confirm");
    pick(act, "a", ["yes"]);
    expect(a.hand).toHaveLength(2);

    const second = setup("attack");
    const other = field(second.a, "front", ark("011"));
    second.a.hand.push(NINE);
    second.act("a", { type: "attack", attackerUid: other.uid });
    pick(second.act, "a", ["no"]);
    expect(second.a.hand).toEqual([NINE]);

    const third = setup("attack");
    const full = field(third.a, "front", ark("011"));
    third.a.hand.push(NINE, NINE);
    third.act("a", { type: "attack", attackerUid: full.uid });
    expect(third.game.pending).toMatchObject({ kind: "damage" });
  });

  it("W (1-012): moving to the front returns a cost-0 yellow character from the sideline; moving back gives BP-500", () => {
    const { game, a, b, act } = setup("movement");
    const w = field(a, "energy", ark("012"));
    a.sideline.push(KS);
    act("a", { type: "move", toFront: [w.uid], toEnergy: [], remove: [] });
    pick(act, "a", ["s:0"]);
    expect(a.hand).toEqual([KS]);

    const second = setup("movement");
    const back = field(second.a, "front", ark("012"));
    const nine = field(second.b, "front", NINE);
    second.act("a", { type: "move", toFront: [], toEnergy: [back.uid], remove: [] });
    pick(second.act, "a", [nine.uid]);
    expect(bpOf(ctx, nine)).toBe(1500);
  });

  it("塔露拉 (1-013): switches an energy-line character to active or resting, once per turn", () => {
    const { game, a, act } = setup();
    const talulah = field(a, "front", ark("013"));
    const ks = field(a, "energy", KS);
    act("a", { type: "activate", uid: talulah.uid, ability: 0 });
    pick(act, "a", ["m:1"]);
    expect(ks.rested).toBe(true);
    expect(() => act("a", { type: "activate", uid: talulah.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });

  it("塔露拉 (1-015): 登场时 rests any own active characters, then sidelines an opponent with BP up to 1000 + 1000 each", () => {
    const { game, a, b, act } = setup();
    energy(a, 4, KS, 1);
    const resters = a.energy.slice(0, 2);
    field(b, "front", NINE);
    const guard = field(b, "front", GUARD);
    field(b, "front", HOSHI092);
    a.hand.push(ark("015"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", resters.map((card) => card.uid));
    expect(resters.every((card) => card.rested)).toBe(true);
    expect(choice(game).options).toHaveLength(2); // BP 3000 or less
    pick(act, "a", [guard.uid]);
    expect(b.sideline).toEqual([GUARD]);
  });

  it("塔露拉 (1-015): its Activate: Main sidelines own resting characters to widen the range", () => {
    const { game, a, b, act } = setup();
    const talulah = field(a, "front", ark("015"));
    const resting = field(a, "front", KS, true);
    field(a, "front", KS); // active: cannot be chosen
    field(b, "front", NINE);
    const guard = field(b, "front", GUARD);
    act("a", { type: "activate", uid: talulah.uid, ability: 1 });
    expect(choice(game).options).toEqual([resting.uid]);
    pick(act, "a", [resting.uid]);
    // BP 2000 or less: only 九 can be chosen, so it is chosen.
    expect(b.front).toEqual([guard]);
    expect(a.sideline).toEqual([KS]);
  });

  it("爱国者 (1-016): 伤害2 on our turn while the hand has three cards or fewer", () => {
    const { a, act } = setup();
    const patriot = field(a, "front", ark("016"));
    a.hand.push(NINE, NINE, NINE);
    act("a", { type: "manual", manual: { op: "draw" } });
    expect(hasKeyword(ctx, patriot, "伤害2")).toBe(false);
    act("a", { type: "manual", manual: { op: "hand", handIndex: 0, act: "sideline" } });
    expect(hasKeyword(ctx, patriot, "伤害2")).toBe(true);
    act("a", { type: "end_turn" });
    expect(hasKeyword(ctx, patriot, "伤害2")).toBe(false);
  });

  it("浮士德 (1-018): costs one less while the opponent has a blue or red card", () => {
    const { game, b, players } = setup();
    expect(costOf(game, players, ctx, "a", ark("018")).energy).toBe(3);
    field(b, "energy", NINE);
    expect(costOf(game, players, ctx, "a", ark("018")).energy).toBe(2);
  });

  it("浮士德 (1-019): puts an own character on the bottom of the deck for BP-1500; a 〈梅菲斯特〉 also readies an AP card and BP+500", () => {
    const { game, a, b, act } = setup();
    const faust = field(a, "front", ark("019"));
    const meph = field(a, "front", MEPH);
    const nine = field(b, "front", NINE);
    a.ap[0]!.rested = true;
    act("a", { type: "activate", uid: faust.uid, ability: 0 });
    pick(act, "a", [meph.uid]);
    expect(a.library[a.library.length - 1]).toBe(MEPH);
    pick(act, "a", [nine.uid]);
    expect(bpOf(ctx, nine)).toBe(500);
    pick(act, "a", ["a:ap0"].map((apId) => `ap:${apId}`));
    expect(a.ap.every((card) => !card.rested)).toBe(true);
    expect(bpOf(ctx, faust)).toBe(4000);
    // 梅菲斯特 (2-008) left the field by our effect on our turn: draw 1.
    expect(a.hand).toEqual([KS]);
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, faust)).toBe(4000);

    const second = setup();
    const other = field(second.a, "front", ark("019"));
    const ks = field(second.a, "front", KS);
    second.act("a", { type: "activate", uid: other.uid, ability: 0 });
    pick(second.act, "a", [ks.uid]);
    expect(second.game.pending).toBeNull(); // no opponent target, not 梅菲斯特
    expect(bpOf(ctx, other)).toBe(3500);
  });

  it("梅菲斯特 (1-020): rests for one more yellow energy this turn and is sidelined when the main phase ends", () => {
    const { a, act } = setup();
    const meph = field(a, "energy", ark("020"));
    act("a", { type: "activate", uid: meph.uid, ability: 0 });
    expect(energyOf(ctx, a, "yellow")).toBe(2);
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([ark("020")]);
  });

  it("梅菲斯特 (1-021): may discard a cost-1+ card to put a cost-0 yellow character from the sideline, removed when the attack phase ends", () => {
    const { game, a, act } = setup();
    const meph = field(a, "front", ark("021"));
    a.hand.push(GUARD);
    a.sideline.push(SOLDIER);
    act("a", { type: "activate", uid: meph.uid, ability: 0 });
    expect(meph.rested).toBe(true);
    pick(act, "a", ["yes"]);
    expect(choice(game).options).toEqual(["s:0"]);
    pick(act, "a", ["s:0"]);
    pick(act, "a", ["line:front"]);
    const soldier = a.front.find((card) => card.cardId === SOLDIER)!;
    // Put onto the field by 〈梅菲斯特〉: active, BP+3000.
    expect(soldier.rested).toBe(false);
    expect(bpOf(ctx, soldier)).toBe(4000);
    expect(a.sideline).toEqual([GUARD]);
    act("a", { type: "next_phase" });
    act("a", { type: "next_phase" });
    expect(a.removal).toEqual([SOLDIER]);
    expect(a.front).toEqual([meph]);
  });

  it("整合运动士兵 (1-022): played from the hand it stays resting with no BP change", () => {
    const { a, act } = setup();
    a.hand.push(SOLDIER);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.front[0]!.rested).toBe(true);
    expect(bpOf(ctx, a.front[0]!)).toBe(1000);
  });

  it("雪怪小队 (1-023): on the front line, own 〈霜星〉 cannot be chosen by characters without 雪怪小队 (events still can)", () => {
    const { game, a, b, act } = setup("main", "b");
    const yeti = field(a, "front", YETI);
    const frost = field(a, "front", FROST024);
    energy(b, 4, NINE);
    b.hand.push(SHUANGYE, CHIXIAO);
    act("b", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "b").options).toEqual([yeti.uid]);
    pick(act, "b", []);
    act("b", { type: "event", handIndex: 0 });
    expect(choice(game, "b").options).toEqual(expect.arrayContaining([frost.uid]));
  });

  it("雪怪小队 (1-023): on the energy line it protects nothing; on the front line it rests to ready a 〈霜星〉", () => {
    const { game, a, b, act } = setup();
    const frost = field(a, "front", FROST024, true);
    const yeti = field(a, "energy", YETI);
    expect(() => act("a", { type: "activate", uid: yeti.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    // Our own non-雪怪小队 character (塔露拉 1-013) can choose it while 雪怪小队 is not on the front line.
    const talulah = field(a, "front", ark("013"));
    a.energy.push(a.front.splice(a.front.indexOf(frost), 1)[0]!);
    act("a", { type: "activate", uid: talulah.uid, ability: 0 });
    expect(choice(game).options).toEqual([yeti.uid, frost.uid]);

    // With 雪怪小队 on the front line, our own 塔露拉 (no 雪怪小队) cannot choose the 〈霜星〉 on the energy line.
    const guarded = setup();
    field(guarded.a, "front", YETI);
    const energyFrost = field(guarded.a, "energy", FROST024);
    const ks = field(guarded.a, "energy", KS);
    const talulah2 = field(guarded.a, "front", ark("013"));
    guarded.act("a", { type: "activate", uid: talulah2.uid, ability: 0 });
    pick(guarded.act, "a", ["m:1"]); // 弑君者 was the only option
    expect(ks.rested).toBe(true);
    expect(energyFrost.rested).toBe(false);

    const second = setup();
    const frost2 = field(second.a, "front", FROST024, true);
    const yeti2 = field(second.a, "front", YETI);
    second.act("a", { type: "activate", uid: yeti2.uid, ability: 1 });
    expect(yeti2.rested).toBe(true);
    expect(frost2.rested).toBe(false);
  });

  it("霜星 (1-024): 登场时 draws one, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    a.hand.push(FROST024, NINE);
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", ["h:0"]);
    expect(a.hand).toEqual([KS]);
    expect(a.sideline).toEqual([NINE]);
  });

  it("霜星 (1-025): puts a 〈雪怪小队〉 from the hand or the sideline onto the field resting", () => {
    const { game, a, act } = setup();
    energy(a, 3);
    a.hand.push(ark("025"), YETI);
    a.sideline.push(YETI);
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", ["h:0"]);
    pick(act, "a", ["line:front"]);
    expect(a.front.map((card) => [card.cardId, card.rested])).toEqual([[ark("025"), true], [YETI, true]]);
    expect(a.sideline).toEqual([YETI]);

    const second = setup();
    energy(second.a, 3);
    second.a.hand.push(ark("025"), YETI);
    second.a.sideline.push(YETI);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    pick(second.act, "a", ["s:0"]);
    pick(second.act, "a", ["line:front"]);
    expect(second.a.sideline).toEqual([]);
    expect(second.a.hand).toEqual([YETI]);
  });

  it("霜星 (1-026): on the front line, rests itself to rest an opponent front character", () => {
    const { a, b, act } = setup();
    const frost = field(a, "front", ark("026"));
    const nine = field(b, "front", NINE);
    act("a", { type: "activate", uid: frost.uid, ability: 0 });
    expect(frost.rested).toBe(true);
    expect(nine.rested).toBe(true);
  });

  it("霜星 (1-027): comes onto the field active; at our main phase start, a life card or itself goes to the sideline", () => {
    const { a, act } = setup();
    energy(a, 4);
    a.hand.push(ark("027"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.front[0]!.rested).toBe(false);

    const second = setup("movement");
    const frost = field(second.a, "front", ark("027"));
    second.act("a", { type: "next_phase" });
    pick(second.act, "a", ["m:0"]);
    expect(second.a.life).toHaveLength(6);
    expect(second.a.sideline).toEqual([KS]);
    expect(second.a.front).toEqual([frost]);

    const third = setup("movement");
    field(third.a, "front", ark("027"));
    third.act("a", { type: "next_phase" });
    pick(third.act, "a", ["m:1"]);
    expect(third.a.front).toEqual([]);
    expect(third.a.sideline).toEqual([ark("027")]);
  });

  it("霜星 (1-027): putting the last life card into the sideline loses the game", () => {
    const { game, a, act } = setup("movement");
    field(a, "front", ark("027"));
    a.life = a.life.slice(0, 1);
    act("a", { type: "next_phase" });
    pick(act, "a", ["m:0"]);
    expect(a.life).toEqual([]);
    expect(game.step).toBe("over");
    expect(game.winnerId).toBe("b");
  });

  it("霜星 (1-027): rests up to two opponent front characters (not reactivated next time); once per turn for all 〈霜星〉 1-027", () => {
    const { game, a, b, act } = setup();
    const frost = field(a, "front", ark("027"));
    const otherFrost = field(a, "front", ark("027"));
    const targets = [field(b, "front", NINE), field(b, "front", GUARD), field(b, "front", NINE)];
    act("a", { type: "activate", uid: frost.uid, ability: 2 });
    pick(act, "a", [targets[0]!.uid, targets[1]!.uid]);
    expect(targets.map((card) => card.rested)).toEqual([true, true, false]);
    expect(() => act("a", { type: "activate", uid: otherFrost.uid, ability: 2 })).toThrow("ABILITY_CONDITION");
    act("a", { type: "end_turn" });
    expect(targets[0]!.rested).toBe(true); // the next switch to active did not happen
    expect(targets[2]!.rested).toBe(false);
  });

  it("源石碎片 (1-029): switches up to two AP cards to active", () => {
    const { a, act } = setup();
    energy(a, 3);
    a.ap[1]!.rested = true;
    a.ap[2]!.rested = true;
    a.hand.push(ark("029"));
    act("a", { type: "event", handIndex: 0 });
    pick(act, "a", ["ap:a:ap1", "ap:a:ap2"]);
    expect(a.ap.filter((card) => !card.rested)).toHaveLength(2);
  });

  it("烈焚灼息 (1-030): costs 1 AP less with 〈塔露拉〉 on the field; puts an opponent front character into the removal area", () => {
    const { game, a, b, players, act } = setup();
    expect(costOf(game, players, ctx, "a", ark("030")).ap).toBe(2);
    field(a, "energy", ark("013"), false).energyMod = 1; // 塔露拉: 3 yellow energy
    energy(a, 2, KS);
    expect(costOf(game, players, ctx, "a", ark("030")).ap).toBe(1);
    const nine = field(b, "front", NINE);
    a.hand.push(ark("030"));
    act("a", { type: "event", handIndex: 0 });
    expect(b.removal).toEqual([NINE]);
    expect(b.front).not.toContain(nine);
    expect(a.ap.filter((card) => card.rested)).toHaveLength(1);
  });

  it("Lullabye (1-031): rests a BP-5000-or-less opponent (not reactivated next time); with 〈霜星〉 it may sideline it instead", () => {
    const { game, a, b, act } = setup();
    energy(a, 4);
    const nine = field(b, "front", NINE);
    field(b, "front", id("UC01BT/ARK-1-086")).bpMod = 2000; // BP 6000
    a.hand.push(ark("031"), ark("031"));
    act("a", { type: "event", handIndex: 0 });
    expect(nine.rested).toBe(true);
    expect(nine.skipNextActivate).toBe(true);

    const second = setup();
    energy(second.a, 4);
    field(second.a, "front", FROST024);
    const target = field(second.b, "front", NINE);
    second.a.hand.push(ark("031"));
    second.act("a", { type: "event", handIndex: 0 });
    pick(second.act, "a", ["m:1"]);
    expect(second.b.front).not.toContain(target);
    expect(second.b.sideline).toEqual([NINE]);
  });

  it("整合运动 (1-032): up to two cost-2-or-less AP-1 yellow characters from hand / sideline are put onto the field or Raid; one may be readied", () => {
    const { game, a, act } = setup();
    energy(a, 3);
    const misha = field(a, "energy", MISHA002, true);
    a.hand.push(ark("032"), SUIGU, GUARD);
    a.sideline.push(SOLDIER);
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game).options).toEqual(["h:0"]);
    pick(act, "a", ["h:0"]); // 碎骨
    pick(act, "a", ["m:1"]); // Raid (onto the only 米莎)
    pick(act, "a", ["m:0"]); // move to the front line
    expect(misha.cardId).toBe(SUIGU);
    expect(misha.under).toEqual([MISHA002]);
    expect(a.front).toContain(misha);
    // Second card: nothing more in hand, so from the sideline.
    pick(act, "a", ["s:0"]);
    pick(act, "a", ["line:energy"]);
    const soldier = a.energy.find((card) => card.cardId === SOLDIER)!;
    expect(choice(game).options).toEqual([misha.uid, soldier.uid]);
    pick(act, "a", []);
    // 整合运动士兵's own 【登场时】: put onto the field by our effect.
    expect(soldier.rested).toBe(false);
    expect(a.sideline).toEqual([ark("032")]);
  });

  it("辣味糖 (1-033): readies an AP card; each player rests one own active front character (the opponent chooses theirs); a rested 〈霜星〉 comes back; one per turn", () => {
    const { game, a, b, players, act } = setup();
    energy(a, 4);
    const frost = field(a, "front", FROST024);
    const theirs = [field(b, "front", NINE), field(b, "front", GUARD)];
    a.ap[0]!.rested = true;
    a.hand.push(ark("033"), ark("033"));
    act("a", { type: "event", handIndex: 0 });
    pick(act, "a", ["ap:a:ap0"]);
    expect(choice(game, "b").options).toEqual(theirs.map((card) => card.uid));
    pick(act, "b", [theirs[1]!.uid]);
    expect(theirs.map((card) => card.rested)).toEqual([false, true]);
    expect(frost.rested).toBe(false);
    expect(costOf(game, players, ctx, "a", ark("033")).energy).toBe(4);
    expect(() => act("a", { type: "event", handIndex: 0 })).toThrow("EVENT_CONDITION");
  });
});

describe("Other yellow cards", () => {
  it("霜星 (ST 1-111): 攻击时 looks at as many cards as the opponent has resting characters, for a 雪怪小队 card", () => {
    const { game, a, b, act } = setup("attack");
    const frost = field(a, "front", id("UC01ST/ARK-1-111"));
    field(b, "energy", NINE, true);
    field(b, "energy", NINE, true);
    a.library = [GUARD, YETI, NINE];
    act("a", { type: "attack", attackerUid: frost.uid });
    expect(choice(game).options).toEqual(["l:1"]);
    pick(act, "a", ["l:1"]);
    expect(a.hand).toEqual([YETI]);
    expect(a.library).toEqual([NINE, GUARD]);
  });

  it("霜星 (ST 1-111): on the front line, discards one, once per turn, to rest an opponent energy-line character", () => {
    const { a, b, act } = setup();
    const frost = field(a, "front", id("UC01ST/ARK-1-111"));
    const nine = field(b, "energy", NINE);
    a.hand.push(GUARD);
    act("a", { type: "activate", uid: frost.uid, ability: 1 });
    expect(a.sideline).toEqual([GUARD]);
    expect(nine.rested).toBe(true);
    expect(() => act("a", { type: "activate", uid: frost.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
  });

  it("米莎 (2-001): may rest two active cost-0 characters; otherwise it returns to the hand", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.hand.push(ex("001"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", a.energy.map((card) => card.uid));
    expect(a.energy.every((card) => card.rested)).toBe(true);
    expect(a.front.map((card) => card.cardId)).toEqual([ex("001")]);

    const second = setup();
    energy(second.a, 2);
    second.a.hand.push(ex("001"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", [second.a.energy[0]!.uid]);
    expect(second.a.front).toEqual([]);
    expect(second.a.hand).toEqual([ex("001")]);
  });

  it("Guard (2-002): 登场时 draws one, then puts a hand card into the sideline", () => {
    const { a, act } = setup();
    energy(a, 3);
    a.hand.push(ex("002"), NINE);
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", ["h:0"]);
    expect(a.sideline).toEqual([NINE]);
  });

  it("W (2-003): on the front line, once per turn, swaps places with an energy-line character of cost 4 or less (its move abilities activate)", () => {
    const { game, a, b, act } = setup();
    const w = field(a, "front", ex("003"));
    const w012 = field(a, "energy", ark("012"));
    field(a, "energy", ark("015")); // cost 6
    const nine = field(b, "front", NINE);
    act("a", { type: "activate", uid: w.uid, ability: 0 });
    expect(a.front).toEqual([w012]);
    expect(a.energy).toContain(w);
    // W (1-012) moved to the front line (no cost-0 yellow card in the sideline): nothing to pick.
    expect(game.pending).toBeNull();
    expect(bpOf(ctx, nine)).toBe(2000);
    expect(() => act("a", { type: "activate", uid: w.uid, ability: 0 })).toThrow();
  });

  it("W (2-004): moving to the energy line, once per turn: sidelines up to one opponent front character and gives another BP-1000; 退场时 draws two", () => {
    const { game, a, b, act } = setup("movement");
    const w = field(a, "front", ex("004"));
    const nine = field(b, "front", NINE);
    const guard = field(b, "front", GUARD);
    act("a", { type: "move", toFront: [], toEnergy: [w.uid], remove: [] });
    pick(act, "a", [nine.uid]);
    expect(b.sideline).toEqual([NINE]);
    expect(choice(game).options).toEqual([guard.uid]);
    pick(act, "a", [guard.uid]);
    expect(bpOf(ctx, guard)).toBe(2000);
    sidelineManually(act, w);
    expect(a.hand).toEqual([KS, KS]);
  });

  it("塔露拉 (2-005): may rest up to two active characters; if it did, puts a cost-2-or-less AP-1 yellow character from hand", () => {
    const { game, a, act } = setup();
    energy(a, 3, KS, 1);
    a.hand.push(ex("005"), SOLDIER, GUARD);
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", [a.energy[0]!.uid]);
    expect(choice(game).options).toEqual(["h:0"]);
    pick(act, "a", ["h:0"]);
    pick(act, "a", ["line:front"]);
    const soldier = a.front.find((card) => card.cardId === SOLDIER)!;
    expect(soldier.rested).toBe(false);
    expect(bpOf(ctx, soldier)).toBe(3000);

    const second = setup();
    energy(second.a, 3, KS, 1);
    second.a.hand.push(ex("005"), SOLDIER);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    pick(second.act, "a", []);
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([SOLDIER]);
  });

  it("爱国者 (2-006): 登场时 the opponent rests two of their own active characters", () => {
    const { game, a, b, act } = setup();
    energy(a, 3);
    const theirs = [field(b, "front", NINE), field(b, "energy", GUARD), field(b, "energy", NINE)];
    a.hand.push(ex("006"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    const asked = choice(game, "b");
    expect(asked).toMatchObject({ min: 2, max: 2 });
    pick(act, "b", [theirs[1]!.uid, theirs[2]!.uid]);
    expect(theirs.map((card) => card.rested)).toEqual([false, true, true]);
  });

  it("爱国者 (2-007): 冲击1 and 伤害2 on our turn with two resting opponent characters; 登场时 / Activate: Main rest an energy-line character and give BP+1000", () => {
    const { game, a, b, act } = setup();
    const patriot = field(a, "front", ex("007"));
    const target = field(b, "energy", NINE);
    field(b, "front", NINE, true);
    expect(hasKeyword(ctx, patriot, "伤害2")).toBe(false);
    act("a", { type: "activate", uid: patriot.uid, ability: 2 });
    pick(act, "a", [target.uid]);
    expect(target.rested).toBe(true);
    expect(target.skipNextActivate).toBe(true);
    expect(bpOf(ctx, patriot)).toBe(5000);
    expect(hasKeyword(ctx, patriot, "伤害2")).toBe(true);
    expect(impactOf(ctx, patriot)).toBe(1);
    expect(() => act("a", { type: "activate", uid: patriot.uid, ability: 2 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "end_turn" });
    expect(hasKeyword(ctx, patriot, "伤害2")).toBe(false);
    expect(bpOf(ctx, patriot)).toBe(5000);
    expect(target.rested).toBe(true);

    const second = setup();
    energy(second.a, 4, KS, 1);
    second.a.hand.push(ex("007"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull(); // no opponent energy-line character
    expect(bpOf(ctx, second.a.front[0]!)).toBe(5000);
  });

  it("梅菲斯特 (2-008): draws when it leaves the field by our effect on our turn; not by battle, nor on the opponent's turn", () => {
    const { game, a, act } = setup();
    energy(a, 1);
    const returned = field(a, "front", MEPH);
    a.hand.push(ark("010"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    pick(act, "a", [returned.uid]);
    expect(a.hand).toEqual([MEPH, KS]);

    const second = setup("attack", "b");
    const attacker = field(second.b, "front", HOSHI092);
    const meph = field(second.a, "front", MEPH);
    second.act("b", { type: "attack", attackerUid: attacker.uid });
    second.act("a", { type: "block", blockerUid: meph.uid });
    expect(second.a.sideline).toEqual([MEPH]);
    expect(second.a.hand).toEqual([]);
  });

  it("梅菲斯特・歌者 (2-009): Activate: Main (front line, once per turn) and 退场时 give opponent front characters with BP 1500+ BP-1000", () => {
    const { a, b, act } = setup();
    const singer = field(a, "front", ex("009"));
    const nine = field(b, "front", NINE);
    const misha = field(b, "front", MISHA001);
    const guard = field(b, "front", GUARD);
    act("a", { type: "activate", uid: singer.uid, ability: 0 });
    expect([nine, misha, guard].map((card) => bpOf(ctx, card))).toEqual([1000, 1000, 2000]);
    expect(() => act("a", { type: "activate", uid: singer.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    sidelineManually(act, singer);
    expect([nine, misha, guard].map((card) => bpOf(ctx, card))).toEqual([1000, 1000, 1000]);
  });

  it("霜星 (2-010): 登场时 draws one card for every two resting opponent characters", () => {
    const { a, b, act } = setup();
    energy(a, 4);
    for (let index = 0; index < 5; index += 1) field(b, index < 3 ? "front" : "energy", NINE, true);
    a.hand.push(ex("010"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([KS, KS]);
  });

  it("活生生的怪物 (2-011): draws, readies every resting energy-line character; three or more readied also readies an AP card", () => {
    const { game, a, act } = setup();
    energy(a, 4);
    a.energy.slice(0, 3).forEach((card) => { card.rested = true; });
    a.ap[0]!.rested = true;
    a.hand.push(ex("011"));
    act("a", { type: "event", handIndex: 0 });
    expect(a.energy.every((card) => !card.rested)).toBe(true);
    pick(act, "a", ["ap:a:ap0"]);
    expect(a.ap[0]!.rested).toBe(false);
    expect(a.hand).toEqual([KS]);

    const second = setup();
    energy(second.a, 4);
    second.a.energy.slice(0, 3).forEach((card) => { card.rested = true; });
    second.a.energy[0]!.skipNextActivate = true;
    second.a.hand.push(ex("011"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.game.pending).toBeNull();
    expect(second.a.energy[0]!.rested).toBe(true);
  });

  it("被继承的意志 (2-012): a cost-1-or-less AP-1 yellow character from the sideline comes onto the field or Raids; then cost-2-or-less characters get BP+1000", () => {
    const { game, a, act } = setup();
    energy(a, 3);
    const alex = field(a, "front", ark("003"));
    a.sideline.push(GUARD, SUIGU, ark("013"));
    a.hand.push(ex("012"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game).options).toEqual(["s:1"]);
    pick(act, "a", ["s:1"]);
    pick(act, "a", ["m:1"]); // Raid onto 亚历克斯 (front line: no move question)
    expect(alex.cardId).toBe(SUIGU);
    expect(alex.rested).toBe(false);
    expect(bpOf(ctx, alex)).toBe(2500 + 1500 + 1000);
    expect(bpOf(ctx, a.energy[0]!)).toBe(2500); // 弑君者 (cost 0)
  });
});
