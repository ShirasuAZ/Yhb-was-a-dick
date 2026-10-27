/**
 * The purple cards' abilities (整合运动, purple 罗德岛, 陈, 阿丽娜...): one test per card, set up as its printed text describes, checking the
 * result against the text. The card text was checked against the card images before these were written.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  beginFirstTurn,
  bpOf,
  costOf,
  damageOf,
  energyOf,
  hasKeyword,
  impactOf,
  newEngineGame,
  raidTargetMatches,
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
const CHEN = ark("084"); // 陈: red, BP1500
const KINGSLAYER = ark("004"); // yellow
const AMIYA = ex("047"); // 阿米娅: purple, cost 0, BP1500, 罗德岛制药公司
const ROSE = ex("054"); // 迷迭香: purple, cost 0, BP2000, 罗德岛制药公司
const SITE = ark("095"); // 龙门 (site)
// Purple cards with abilities used as helpers.
const KALTSIT = ex("052"); // 凯尔希: generates 2 purple energy while active
const INO = ex("028"); // 伊诺: purple, cost 0, BP1000
const TALULAH = ex("039"); // 斗士塔露拉: purple, BP1000, 整合运动
const KOSCHEI = ex("030");
const FIRE = ex("057"); // 不息恶火 (event, [特殊] trigger)

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
const W = ex("032"); // W: generates 2 purple energy (only a 登场时 ability)
/** Purple energy: 2 per card. */
const energy = (owner: EnginePlayer, count: number, cardId = W): void => { for (let index = 0; index < count; index += 1) field(owner, "energy", cardId); };

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
const sidelineByHand = (act: (who: string, action: UnionArenaAction) => void, card: UnionArenaFieldCard): void =>
  act("a", { type: "manual", manual: { op: "field", owner: "you", uid: card.uid, act: "sideline" } });

describe("阿丽娜", () => {
  it("阿丽娜 (2-025): only on the energy line, cannot move to the front; rests for +1 purple energy and is sidelined when the main phase ends", () => {
    const { a, act } = setup();
    a.hand.push(ex("025"));
    expect(() => act("a", { type: "play", handIndex: 0, line: "front" })).toThrow("ENERGY_LINE_ONLY");
    act("a", { type: "play", handIndex: 0, line: "energy" });
    const alina = a.energy[0]!;
    alina.rested = false;
    expect(energyOf(ctx, a, "purple")).toBe(1);
    act("a", { type: "activate", uid: alina.uid, ability: 1 });
    expect(alina.rested).toBe(true);
    expect(energyOf(ctx, a, "purple")).toBe(2);
    expect(() => act("a", { type: "activate", uid: alina.uid, ability: 1 })).toThrow();
    act("a", { type: "next_phase" });
    expect(a.energy).toEqual([]);
    expect(a.sideline).toEqual([ex("025")]);

    const second = setup("main", "b");
    const other = field(second.a, "energy", ex("025"));
    second.act("b", { type: "end_turn" });
    second.act("a", { type: "next_phase" });
    expect(() => second.act("a", { type: "move", toFront: [other.uid], toEnergy: [], remove: [] })).toThrow("CANNOT_MOVE");
  });

  it("阿丽娜 (2-026): returns another own character with required energy 1 or less to the hand, or else itself", () => {
    const { a, act } = setup();
    energy(a, 1);
    field(a, "front", AMIYA);
    a.hand.push(ex("026"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([AMIYA]);
    expect(a.front.map((card) => card.cardId)).toEqual([ex("026")]);

    const second = setup();
    energy(second.a, 1);
    second.a.hand.push(ex("026"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.a.hand).toEqual([ex("026")]);
    expect(second.a.front).toEqual([]);
  });

  it("阿丽娜 (2-027): on the energy line, when our attack phase ends it may swap with a front character with BP 1500 or more", () => {
    const { game, a, act } = setup();
    const alina = field(a, "energy", ex("027"));
    const rose = field(a, "front", ROSE);
    field(a, "front", INO); // BP 1000: not a choice
    act("a", { type: "end_turn" });
    expect(choice(game, "a").purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.front[0]).toBe(alina);
    expect(a.energy[0]).toBe(rose);
    expect(game.turnPlayerId).toBe("b");

    // Declining keeps the lines; no front character with BP 1500 or more: no question.
    const second = setup();
    const other = field(second.a, "energy", ex("027"));
    field(second.a, "front", ROSE);
    second.act("a", { type: "end_turn" });
    second.act("a", { type: "choose", picks: ["no"] });
    expect(second.a.energy).toEqual([other]);
    const third = setup();
    field(third.a, "energy", ex("027"));
    field(third.a, "front", INO);
    third.act("a", { type: "end_turn" });
    expect(third.game.turnPlayerId).toBe("b");
  });

  it("阿丽娜 (2-027): 退场时 draws one and puts the top three cards of the deck into the sideline", () => {
    const { a, act } = setup();
    const alina = field(a, "energy", ex("027"));
    a.library = [CHEN, NINE, ROSE, AMIYA, KINGSLAYER];
    sidelineByHand(act, alina);
    expect(a.hand).toEqual([CHEN]);
    expect(a.sideline).toEqual([ex("027"), NINE, ROSE, AMIYA]);
    expect(a.library).toEqual([KINGSLAYER]);
  });
});

describe("整合运动 and others", () => {
  it("伊诺 (2-028): 退场时 draws one, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    const ino = field(a, "front", INO);
    a.hand.push(NINE);
    a.library = [CHEN];
    sidelineByHand(act, ino);
    expect(choice(game).options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([CHEN]);
    expect(a.sideline).toEqual([INO, NINE]);
  });

  it("皇帝的利刃 (2-029): 登场时 draws one, then sidelines up to one opponent site", () => {
    const { game, a, b, act } = setup();
    energy(a, 2);
    const site = field(b, "energy", SITE);
    field(b, "energy", NINE);
    a.hand.push(ex("029"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([KINGSLAYER]);
    expect(choice(game).options).toEqual([site.uid]);
    act("a", { type: "choose", picks: [site.uid] });
    expect(b.sideline).toEqual([SITE]);

    const second = setup();
    energy(second.a, 2);
    field(second.b, "energy", SITE);
    second.a.hand.push(ex("029"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: [] });
    expect(second.b.energy).toHaveLength(1);
  });

  it("科西切 (2-030): on the front line, once per turn, lets another character generate energy on the front line this turn", () => {
    const { a, act } = setup();
    const koschei = field(a, "front", KOSCHEI);
    field(a, "front", ROSE);
    expect(energyOf(ctx, a, "purple")).toBe(0);
    act("a", { type: "activate", uid: koschei.uid, ability: 0 });
    expect(energyOf(ctx, a, "purple")).toBe(1);
    expect(() => act("a", { type: "activate", uid: koschei.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "end_turn" });
    expect(energyOf(ctx, a, "purple")).toBe(0);
  });

  it("科西切 (2-030): 退场时 may go face down under a 塔露拉 character; then the top three cards go to the sideline", () => {
    const { game, a, act } = setup();
    const koschei = field(a, "front", KOSCHEI);
    const talulah = field(a, "energy", TALULAH);
    a.library = [CHEN, NINE, ROSE, AMIYA];
    sidelineByHand(act, koschei);
    expect(choice(game).purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    expect(talulah.faceDown).toEqual([KOSCHEI]);
    expect(a.sideline).toEqual([CHEN, NINE, ROSE]);
    expect(a.library).toEqual([AMIYA]);

    const second = setup();
    const other = field(second.a, "front", KOSCHEI);
    field(second.a, "energy", TALULAH);
    sidelineByHand(second.act, other);
    second.act("a", { type: "choose", picks: ["no"] });
    expect(second.a.sideline).toEqual([KOSCHEI]);
    // Without a 塔露拉 nothing is asked.
    const third = setup();
    sidelineByHand(third.act, field(third.a, "front", KOSCHEI));
    expect(third.game.pending).toBeNull();
  });

  it("萨沙 (2-031): looks at the top card and puts it back on top or into the sideline", () => {
    const { game, a, act } = setup();
    const sasha = field(a, "front", ex("031"));
    a.library = [CHEN, NINE];
    act("a", { type: "activate", uid: sasha.uid, ability: 0 });
    expect(choice(game).options).toEqual(["l:0"]);
    act("a", { type: "choose", picks: [] });
    expect(a.library).toEqual([CHEN, NINE]);
    expect(() => act("a", { type: "activate", uid: sasha.uid, ability: 0 })).toThrow("ONCE_PER_TURN");

    const second = setup();
    const other = field(second.a, "front", ex("031"));
    second.a.library = [CHEN, NINE];
    second.act("a", { type: "activate", uid: other.uid, ability: 0 });
    second.act("a", { type: "choose", picks: ["l:0"] });
    expect(second.a.sideline).toEqual([CHEN]);
    expect(second.a.library).toEqual([NINE]);
    // Only on the front line.
    const third = setup();
    const back = field(third.a, "energy", ex("031"));
    expect(() => third.act("a", { type: "activate", uid: back.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
  });

  it("W (2-032): with 15+ sideline cards gives an 整合运动 character 冲击+1; the 罗德岛 mode needs 9+ cards in the removal area", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.sideline = Array(15).fill(NINE);
    const talulah = field(a, "front", TALULAH);
    field(a, "front", ROSE);
    a.hand.push(ex("032"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).labels).toHaveLength(2);
    act("a", { type: "choose", picks: ["m:0"] });
    expect(choice(game).options).toEqual([talulah.uid]);
    act("a", { type: "choose", picks: [talulah.uid] });
    expect(impactOf(ctx, talulah)).toBe(1);

    const second = setup();
    energy(second.a, 2);
    second.a.removal = Array(8).fill(NINE);
    const rose = field(second.a, "front", ROSE);
    second.a.hand.push(ex("032"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: ["m:1"] });
    expect(second.game.pending).toBeNull();
    expect(impactOf(ctx, rose)).toBe(0);
  });

  it("W (2-033): may put a revealed [特殊] hand card face down under itself to switch to active, plus the top card; 退场时 they return to the hand", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.hand.push(ex("033"), FIRE, NINE);
    a.library = [CHEN, KINGSLAYER];
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).purpose).toBe("confirm");
    act("a", { type: "choose", picks: ["yes"] });
    const w = a.front[0]!;
    expect(w.rested).toBe(false);
    expect(w.faceDown).toEqual([FIRE, CHEN]);
    expect(a.hand).toEqual([NINE]);
    sidelineByHand(act, w);
    expect(a.hand).toEqual([NINE, FIRE, CHEN]);
    expect(a.sideline).toEqual([ex("033")]);

    // Declining: it stays resting with nothing under it.
    const second = setup();
    energy(second.a, 2);
    second.a.hand.push(ex("033"), FIRE);
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: ["no"] });
    expect(second.a.front[0]!.rested).toBe(true);
    expect(second.a.hand).toEqual([FIRE]);
  });
});

describe("陈", () => {
  it("陈 (2-034): 登场时 draws one, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    a.hand.push(ex("034"), NINE);
    a.library = [CHEN];
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual(["h:0", "h:1"]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([CHEN]);
    expect(a.sideline).toEqual([NINE]);
  });

  it("陈 (2-035): puts up to one sideline card into the removal area; with 3+ there, gives a character BP+1000", () => {
    const { game, a, act } = setup();
    energy(a, 1);
    a.sideline = [NINE];
    a.removal = [NINE, NINE];
    const rose = field(a, "front", ROSE);
    a.hand.push(ex("035"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    act("a", { type: "choose", picks: ["s:0"] });
    expect(a.removal).toHaveLength(3);
    act("a", { type: "choose", picks: [rose.uid] });
    expect(bpOf(ctx, rose)).toBe(3000);

    const second = setup();
    energy(second.a, 1);
    second.a.sideline = [NINE];
    second.a.removal = [NINE, NINE];
    second.a.hand.push(ex("035"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    second.act("a", { type: "choose", picks: [] });
    expect(second.game.pending).toBeNull();
  });

  it("陈 (2-036): during our turn, with 3+ cards in the removal area, has 伤害+1", () => {
    const { a, act } = setup();
    const chen = field(a, "front", ex("036"));
    a.removal = [NINE, NINE];
    act("a", { type: "manual", manual: { op: "draw" } });
    expect(damageOf(ctx, chen)).toBe(1);
    a.removal.push(NINE);
    act("a", { type: "manual", manual: { op: "draw" } });
    expect(damageOf(ctx, chen)).toBe(2);
    act("a", { type: "end_turn" });
    expect(damageOf(ctx, chen)).toBe(1);
  });

  it("陈 (2-037): on the front line, once per turn, puts one sideline card into the removal area", () => {
    const { a, act } = setup();
    const chen = field(a, "front", ex("037"));
    a.sideline = [NINE];
    act("a", { type: "activate", uid: chen.uid, ability: 0 });
    expect(a.removal).toEqual([NINE]);
    expect(a.sideline).toEqual([]);
    expect(() => act("a", { type: "activate", uid: chen.uid, ability: 0 })).toThrow("ONCE_PER_TURN");
  });

  it("陈 (2-038): one 伤害+1 per three removal cards, once per turn for every 〈陈〉 with this effect; draws and removes a sideline card", () => {
    const { game, a, act } = setup();
    const chen = field(a, "front", ex("038"));
    const twin = field(a, "front", ex("038"));
    a.removal = Array(7).fill(NINE);
    act("a", { type: "activate", uid: chen.uid, ability: 0 });
    expect(damageOf(ctx, chen)).toBe(3);
    expect(() => act("a", { type: "activate", uid: twin.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    a.sideline = [CHEN];
    act("a", { type: "activate", uid: chen.uid, ability: 1 });
    expect(a.hand).toEqual([KINGSLAYER]);
    act("a", { type: "choose", picks: ["s:0"] });
    expect(a.removal).toHaveLength(8);
    expect(() => act("a", { type: "activate", uid: chen.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
    act("a", { type: "end_turn" });
    expect(damageOf(ctx, chen)).toBe(1);
    expect(game.turnPlayerId).toBe("b");
  });
});

describe("塔露拉", () => {
  it("斗士塔露拉 (2-039): with 15+ sideline cards it is named 〈不死的黑蛇 塔露拉〉 (a Raid target) and generates one more purple energy", () => {
    const { a, act } = setup();
    const talulah = field(a, "energy", TALULAH);
    const blackSnake = ctx.card(ex("044"))!;
    a.sideline = Array(14).fill(NINE);
    act("a", { type: "manual", manual: { op: "draw" } });
    expect(energyOf(ctx, a, "purple")).toBe(1);
    expect(raidTargetMatches(ctx, blackSnake, talulah)).toBe(false);
    a.sideline.push(NINE);
    act("a", { type: "manual", manual: { op: "draw" } });
    expect(energyOf(ctx, a, "purple")).toBe(2);
    expect(raidTargetMatches(ctx, blackSnake, talulah)).toBe(true);
  });

  it("斗士塔露拉 (2-040): on the energy line puts a hand card into the sideline; a 〈科西切〉 may then go under a 塔露拉", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    const talulah = field(a, "front", TALULAH);
    a.hand.push(ex("040"), NINE, KOSCHEI);
    a.library = [CHEN, ROSE, AMIYA, KINGSLAYER];
    act("a", { type: "play", handIndex: 0, line: "energy", remove: a.energy[0]!.uid });
    act("a", { type: "choose", picks: ["h:1"] }); // 科西切
    act("a", { type: "choose", picks: ["yes"] });
    act("a", { type: "choose", picks: [talulah.uid] });
    expect(talulah.faceDown).toEqual([KOSCHEI]);
    expect(a.hand).toEqual([NINE]);
    expect(a.sideline).toEqual([CHEN, ROSE, AMIYA]);

    // Another card: just discarded. On the front line: nothing happens.
    const second = setup();
    energy(second.a, 2);
    second.a.hand.push(ex("040"), NINE);
    second.act("a", { type: "play", handIndex: 0, line: "energy", remove: second.a.energy[0]!.uid });
    expect(second.a.sideline).toEqual([NINE]);
    expect(second.game.pending).toBeNull();
    const third = setup();
    energy(third.a, 2);
    third.a.hand.push(ex("040"), NINE);
    third.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(third.a.hand).toEqual([NINE]);
  });

  it("斗士塔露拉 (2-041): rests to move a character with BP 1000 or less to the other line (阿丽娜 2-025 cannot go to the front)", () => {
    const { game, a, act } = setup();
    const talulah = field(a, "front", ex("041"));
    field(a, "energy", ex("025"));
    const ino = field(a, "energy", INO);
    field(a, "energy", ROSE);
    act("a", { type: "activate", uid: talulah.uid, ability: 1 });
    expect(talulah.rested).toBe(true);
    expect(choice(game).options).toEqual([ino.uid]);
    act("a", { type: "choose", picks: [ino.uid] });
    expect(a.front).toContain(ino);
  });

  it("斗士塔露拉 (2-042): 登场时 draws; 攻击时 (once per turn) may rest a front BP≤1000 character to switch to active, then an energy one to draw", () => {
    const { game, a, b, act } = setup();
    energy(a, 3);
    a.hand.push(ex("042"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(a.hand).toEqual([KINGSLAYER]);
    const talulah = a.front[0]!;
    talulah.rested = false;
    const ino = field(a, "front", INO);
    const back = field(a, "energy", TALULAH);
    act("a", { type: "next_phase" });
    act("a", { type: "attack", attackerUid: talulah.uid });
    act("a", { type: "choose", picks: ["yes"] });
    expect(ino.rested).toBe(true);
    expect(talulah.rested).toBe(false);
    act("a", { type: "choose", picks: ["yes"] });
    expect(back.rested).toBe(true);
    expect(a.hand).toHaveLength(2);
    act("a", { type: "damage", lifeIds: [b.life[0]!.id] });
    act("b", { type: "trigger", lifeId: "b:life:0", activate: false });
    // Second attack: the ability was used this turn.
    act("a", { type: "attack", attackerUid: talulah.uid });
    expect(game.pending).toMatchObject({ kind: "damage" });
  });

  it("爱国者 (2-043): on the front line, own characters with printed BP 1000 or less are not affected by BP reductions", () => {
    const { game, a, b, act } = setup("main", "b");
    field(a, "front", ex("043"));
    const ino = field(a, "front", INO);
    const rose = field(a, "front", ROSE);
    energy(b, 3);
    b.hand.push(FIRE, FIRE);
    act("b", { type: "event", handIndex: 0 });
    act("b", { type: "choose", picks: [ino.uid] });
    expect(bpOf(ctx, ino)).toBe(1000);
    expect(a.front).toContain(ino);
    act("b", { type: "event", handIndex: 0 });
    act("b", { type: "choose", picks: [rose.uid] });
    expect(a.front).not.toContain(rose);
    expect(game.pending).toBeNull();

    // On the energy line it does nothing.
    const second = setup("main", "b");
    field(second.a, "energy", ex("043"));
    const other = field(second.a, "front", INO);
    energy(second.b, 3);
    second.b.hand.push(FIRE);
    second.act("b", { type: "event", handIndex: 0 });
    expect(second.a.front).not.toContain(other);
  });

  it("不死的黑蛇 塔露拉 (2-044): 登场时 BP-5000; with face-down cards under it, gives BP-2000 until our next turn", () => {
    const { game, a, b, act } = setup();
    energy(a, 4);
    const nine = field(b, "front", NINE);
    const guard = field(b, "front", NINE);
    guard.bpMod = 6000; // 8000
    a.hand.push(ex("044"));
    act("a", { type: "play", handIndex: 0, line: "front", remove: a.energy[0]!.uid });
    act("a", { type: "choose", picks: [nine.uid] });
    expect(b.front).toEqual([guard]);
    const snake = a.front[0]!;
    expect(hasKeyword(ctx, snake, "2次攻击")).toBe(true);
    expect(() => act("a", { type: "activate", uid: snake.uid, ability: 1 })).toThrow("ABILITY_CONDITION");
    snake.faceDown = [KOSCHEI];
    act("a", { type: "activate", uid: snake.uid, ability: 1 });
    expect(bpOf(ctx, guard)).toBe(6000);
    expect(guard.lasting).toEqual([expect.objectContaining({ bp: -2000, untilTurnOf: "a" })]);
    expect(() => act("a", { type: "activate", uid: snake.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
    expect(game.pending).toBeNull();
  });

  it("霜星 (2-045): BP+500 for every five sideline cards", () => {
    const { a, act } = setup();
    const frostnova = field(a, "front", ex("045"));
    a.sideline = Array(14).fill(NINE);
    act("a", { type: "manual", manual: { op: "draw" } });
    expect(bpOf(ctx, frostnova)).toBe(3000);
  });

  it("霜星 (2-046): this turn the next BP≤1000 character played from the hand costs 1 AP less", () => {
    const { game, a, players, act } = setup();
    energy(a, 2);
    a.hand.push(ex("046"), ROSE, INO, INO);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(costOf(game, players, ctx, "a", ROSE).ap).toBe(1);
    expect(costOf(game, players, ctx, "a", INO).ap).toBe(0);
    act("a", { type: "play", handIndex: 1, line: "front" });
    expect(a.ap.filter((card) => card.rested)).toHaveLength(1);
    expect(costOf(game, players, ctx, "a", INO).ap).toBe(1);
  });
});

describe("罗德岛 (purple)", () => {
  it("阿米娅 (2-048): with 〈陈〉 on the field, draws one or puts up to two sideline cards into the removal area", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    field(a, "front", CHEN);
    a.sideline = [NINE, ROSE, AMIYA];
    a.hand.push(ex("048"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    act("a", { type: "choose", picks: ["m:1"] });
    act("a", { type: "choose", picks: ["s:0", "s:2"] });
    expect(a.removal).toEqual([NINE, AMIYA]);

    const second = setup();
    energy(second.a, 2);
    second.a.hand.push(ex("048"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(second.game.pending).toBeNull();
    expect(second.a.hand).toEqual([]);
  });

  it("阿米娅 (2-049): looks at three, reveals up to one 罗德岛制药公司 card or 〈陈〉 into the hand, then puts a hand card into the sideline", () => {
    const { game, a, act } = setup();
    energy(a, 1);
    a.library = [NINE, CHEN, ROSE, KINGSLAYER];
    a.hand.push(ex("049"), NINE);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual(["l:1", "l:2"]);
    act("a", { type: "choose", picks: ["l:1"] });
    act("a", { type: "choose", picks: ["l:0", "l:1"] });
    expect(a.library).toEqual([KINGSLAYER, NINE, ROSE]);
    act("a", { type: "choose", picks: ["h:0"] });
    expect(a.hand).toEqual([CHEN]);
    expect(a.sideline).toEqual([NINE]);
  });

  it("阿米娅 (2-050): 登场时 draws, then puts a purple AP-1 character costing ≤1 (≤3 with 3+ removal cards) from hand onto the field resting", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.library = [ex("027")];
    a.hand.push(ex("050"), INO);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual(["h:0"]); // 伊诺, not 阿丽娜 (cost 3)
    act("a", { type: "choose", picks: ["h:0"] });
    act("a", { type: "choose", picks: ["line:front"] });
    expect(a.front.find((card) => card.cardId === INO)?.rested).toBe(true);

    const second = setup();
    energy(second.a, 2);
    second.a.removal = [NINE, NINE, NINE];
    second.a.library = [ex("025")];
    second.a.hand.push(ex("050"), ex("027"));
    second.act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(second.game).options).toEqual(["h:0", "h:1"]);
    // 阿丽娜 (2-025) can only go onto the energy line: no line question.
    second.act("a", { type: "choose", picks: ["h:1"] });
    expect(second.game.pending).toBeNull();
    expect(second.a.energy.at(-1)).toMatchObject({ cardId: ex("025"), rested: true });
  });

  it("阿米娅 (2-050): once per turn, attacking unblocked, puts up to one sideline card into the removal area", () => {
    const { game, a, act } = setup("attack");
    const amiya = field(a, "front", ex("050"));
    a.sideline = [NINE];
    act("a", { type: "attack", attackerUid: amiya.uid });
    act("a", { type: "choose", picks: ["s:0"] });
    expect(a.removal).toEqual([NINE]);
    expect(game.pending).toMatchObject({ kind: "damage" });
  });

  it("阿米娅 (2-051): 3+ removal: 登场时 sidelines an opponent BP≤3000; 6+: 冲击1; 9+: BP+1000 and 伤害+1 for a chosen 〈陈〉", () => {
    const { game, a, b, act } = setup();
    energy(a, 3);
    a.removal = Array(3).fill(NINE);
    const weak = field(b, "front", NINE);
    field(b, "front", NINE).bpMod = 1500;
    a.hand.push(ex("051"));
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game).options).toEqual([weak.uid]);
    act("a", { type: "choose", picks: [weak.uid] });
    expect(b.front).toHaveLength(1);
    const amiya = a.front[0]!;
    expect(impactOf(ctx, amiya)).toBe(0);
    expect(() => act("a", { type: "activate", uid: amiya.uid, ability: 2 })).toThrow("ABILITY_CONDITION");
    a.removal = Array(9).fill(NINE);
    const chen = field(a, "front", CHEN);
    act("a", { type: "manual", manual: { op: "draw" } });
    expect(impactOf(ctx, amiya)).toBe(1);
    act("a", { type: "activate", uid: amiya.uid, ability: 2 });
    act("a", { type: "choose", picks: [chen.uid] });
    expect(bpOf(ctx, amiya)).toBe(5000);
    expect(damageOf(ctx, amiya)).toBe(2);
  });

  it("凯尔希 (2-052): generates one more purple energy while active", () => {
    const { a, act } = setup();
    const kaltsit = field(a, "energy", KALTSIT);
    act("a", { type: "manual", manual: { op: "draw" } });
    expect(energyOf(ctx, a, "purple")).toBe(2);
    act("a", { type: "manual", manual: { op: "field", owner: "you", uid: kaltsit.uid, act: "rest" } });
    expect(energyOf(ctx, a, "purple")).toBe(1);
  });
});

describe("Purple site and events", () => {
  it("切尔诺伯格 (site, 2-055): is put onto the field active; rests to give a character BP+1000", () => {
    const { game, a, act } = setup();
    energy(a, 1);
    const rose = field(a, "front", ROSE);
    field(a, "front", INO);
    a.hand.push(ex("055"));
    act("a", { type: "play", handIndex: 0, line: "energy" });
    const site = a.energy.at(-1)!;
    expect(site.rested).toBe(false);
    act("a", { type: "activate", uid: site.uid, ability: 1 });
    expect(site.rested).toBe(true);
    act("a", { type: "choose", picks: [rose.uid] });
    expect(bpOf(ctx, rose)).toBe(3000);
    expect(game.pending).toBeNull();
  });

  it("决战 (2-056): switches up to two AP cards to active", () => {
    const { a, act } = setup();
    energy(a, 2);
    a.ap[1]!.rested = true;
    a.ap[2]!.rested = true;
    a.hand.push(ex("056"));
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "choose", picks: ["ap:a:ap1", "ap:a:ap2"] });
    expect(a.ap.filter((card) => !card.rested)).toHaveLength(2);
  });

  it("不息恶火 (2-057): BP-4000 to one opponent front character; with 〈不死的黑蛇 塔露拉〉, also BP-1000 to all of them", () => {
    const { a, b, act } = setup();
    energy(a, 3);
    const big = field(b, "front", NINE);
    big.bpMod = 4000; // 6000
    const other = field(b, "front", NINE);
    other.bpMod = 2000; // 4000
    a.hand.push(FIRE, FIRE);
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "choose", picks: [big.uid] });
    expect(bpOf(ctx, big)).toBe(2000);
    expect(bpOf(ctx, other)).toBe(4000);
    // 斗士塔露拉 named 〈不死的黑蛇 塔露拉〉 (15+ sideline cards) counts.
    field(a, "front", TALULAH);
    a.sideline = Array(15).fill(NINE);
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "choose", picks: [other.uid] });
    // 4000 - 4000 - 1000: sidelined; the other one 2000 - 1000.
    expect(b.front.map((card) => card.uid)).toEqual([big.uid]);
    expect(bpOf(ctx, big)).toBe(1000);
  });

  it("赤霄＆影霄 (2-058): sidelines up to one opponent front character with BP ≤3000, ≤4000 with 〈阿米娅〉 or 〈陈〉, ≤5000 with both", () => {
    const run = (own: string[]): string[] => {
      const { game, a, b, act } = setup();
      energy(a, 2);
      for (const cardId of own) field(a, "front", cardId);
      for (const bonus of [1000, 2000, 3000]) field(b, "front", NINE).bpMod = bonus; // 3000, 4000, 5000
      a.hand.push(ex("058"));
      act("a", { type: "event", handIndex: 0 });
      const options = choice(game).options.map((uid) => bpOf(ctx, b.front.find((card) => card.uid === uid)!));
      act("a", { type: "choose", picks: [] });
      return options.map(String);
    };
    expect(run([])).toEqual(["3000"]);
    expect(run([AMIYA])).toEqual(["3000", "4000"]);
    expect(run([AMIYA, CHEN])).toEqual(["3000", "4000", "5000"]);
  });

  it("久远的回忆 (2-059): looks at four, up to two into the hand, the rest into the removal area", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.library = [NINE, CHEN, ROSE, AMIYA, KINGSLAYER];
    a.hand.push(ex("059"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game).max).toBe(2);
    act("a", { type: "choose", picks: ["l:1", "l:3"] });
    expect(a.hand).toEqual([CHEN, AMIYA]);
    expect(a.removal).toEqual([NINE, ROSE]);
    expect(a.library).toEqual([KINGSLAYER]);
    expect(a.sideline).toEqual([ex("059")]);
  });

  it("不屈 (2-060): returns up to one character card from the sideline to the hand; draws one with a 塔露拉 character on the field", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.sideline = [FIRE, ROSE];
    a.library = [CHEN];
    a.hand.push(ex("060"));
    act("a", { type: "event", handIndex: 0 });
    expect(choice(game).options).toEqual(["s:1"]);
    act("a", { type: "choose", picks: ["s:1"] });
    expect(a.hand).toEqual([ROSE]);

    const second = setup();
    energy(second.a, 2);
    field(second.a, "front", TALULAH);
    second.a.library = [CHEN];
    second.a.hand.push(ex("060"));
    second.act("a", { type: "event", handIndex: 0 });
    expect(second.a.hand).toEqual([CHEN]);
  });

  it("烈焰之中 (2-061): only usable with no character card in our sideline; draws three, or gives an 〈阿米娅〉 BP+1000 and 冲击+3", () => {
    const { game, a, act } = setup();
    energy(a, 2);
    a.sideline = [ROSE];
    a.hand.push(ex("061"));
    expect(() => act("a", { type: "event", handIndex: 0 })).toThrow("EVENT_CONDITION");
    expect(a.hand).toEqual([ex("061")]);
    a.sideline = [FIRE];
    const amiya = field(a, "front", AMIYA);
    act("a", { type: "event", handIndex: 0 });
    act("a", { type: "choose", picks: ["m:1"] });
    act("a", { type: "choose", picks: [amiya.uid] });
    expect(bpOf(ctx, amiya)).toBe(2500);
    expect(impactOf(ctx, amiya)).toBe(3);
    expect(game.pending).toBeNull();

    const second = setup();
    energy(second.a, 2);
    second.a.hand.push(ex("061"));
    second.act("a", { type: "event", handIndex: 0 });
    second.act("a", { type: "choose", picks: ["m:0"] });
    expect(second.a.hand).toHaveLength(3);
  });
});
