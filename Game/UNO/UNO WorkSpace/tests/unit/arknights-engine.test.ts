import { describe, expect, it } from "vitest";
import {
  applyAction,
  beginFirstTurn,
  bpOf,
  newEngineGame,
  type EngineContext,
  type EngineGame,
  type EnginePlayer
} from "../../../../Arknights/ArknightsWorkSpace/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaCardStats, UnionArenaFieldCard } from "../../../../Arknights/ArknightsWorkSpace/src/shared/protocol.ts";
import { UNION_ARENA_CATALOG } from "../../../../Arknights/ArknightsWorkSpace/src/server/catalog.ts";
import { checkUnionArenaDeck } from "../../../../Arknights/ArknightsWorkSpace/src/server/types.ts";

// Card ids are made-up names; each one maps to printed data built for the rule being tested.
const base: UnionArenaCardStats = { type: "character", color: "yellow", energyCost: 0, apCost: 1, bp: 1000, energyGen: 1, energyGenColor: "yellow", energyGenPlus: false, affinities: [], raid: null, keywords: [], abilityText: "", trigger: null };
const cards: Record<string, UnionArenaCardStats & { name: string }> = {
  filler: { ...base, name: "填充" },
  gen1: { ...base, name: "黄能量", bp: 1500 },
  blue: { ...base, name: "蓝卡", color: "blue", energyGenColor: "blue" },
  cost2: { ...base, name: "要2黄", energyCost: 2, bp: 3000 },
  ap2: { ...base, name: "AP2", apCost: 2, bp: 2500 },
  big: { ...base, name: "大", bp: 4000 },
  impact: { ...base, name: "冲击", bp: 3000, keywords: ["冲击1"] },
  nullify: { ...base, name: "冲击无效", bp: 1000, keywords: ["冲击无效"] },
  dmg2: { ...base, name: "伤害2", bp: 2000, keywords: ["伤害2"] },
  step: { ...base, name: "撤步", keywords: ["撤步"] },
  snipe: { ...base, name: "瞄准", bp: 3000, keywords: ["瞄准攻击"] },
  double: { ...base, name: "2次攻击", bp: 3000, keywords: ["2次攻击"] },
  wall: { ...base, name: "2次阻挡", bp: 5000, keywords: ["2次阻挡"] },
  site: { ...base, name: "场地", type: "site", bp: null },
  event: { ...base, name: "事件", type: "event", bp: null, energyGen: 0, energyGenColor: null },
  raider: { ...base, name: "突进者", energyCost: 1, bp: 4000, raid: { targets: ["黄能量"], text: "转为活跃状态，并可以移动至前线" } },
  tDraw: { ...base, name: "抽卡触发", trigger: { label: "抽卡", text: "抽取1张卡牌。" } },
  tGet: { ...base, name: "获得触发", trigger: { label: "获得", text: "此卡牌加入手牌。" } },
  tActive: { ...base, name: "激活触发", trigger: { label: "激活", text: "选择我方场上的1张角色，转为活跃状态，本回合中，BP+3000。" } },
  tSpecial: { ...base, name: "特殊触发", trigger: { label: "特殊", text: "选择对方前线中的1张角色退场。" } },
  tColorKill: { ...base, name: "色彩退场", trigger: { label: "色彩", text: "选择对方前线中的1张BP不高于2500的角色退场。" } },
  tColorRest: { ...base, name: "色彩休息", trigger: { label: "色彩", text: "选择对方前线中的1张角色，转为休息状态。该角色下一次转为活跃状态无效。" } },
  tFinal: { ...base, name: "最终触发", trigger: { label: "最终", text: "我方没有生命卡牌的场合，将我方卡组最上方的1张卡牌置于我方生命区中。" } },
  tRaid: { ...base, name: "突进触发", energyCost: 1, bp: 4000, raid: { targets: ["黄能量"], text: "" }, trigger: { label: "突进", text: "此卡牌加入手牌，或在满足所需能量的场合进行突进。" } }
};
const ctx: EngineContext = { card: (id) => cards[id.split("#")[0]!] ?? null };

function player(id: string, library: string[] = Array(30).fill("filler")): EnginePlayer {
  return { accountId: id, username: id.toUpperCase(), hand: [], library: [...library], life: Array.from({ length: 7 }, (_, index) => ({ id: `${id}:life:${index}`, cardId: "filler", faceUp: false })), apCount: 3, ap: [], front: [], energy: [], sideline: [], removal: [] };
}

function setup(): { game: EngineGame; a: EnginePlayer; b: EnginePlayer; players: EnginePlayer[] } {
  const a = player("a");
  const b = player("b");
  const game = newEngineGame("a", []);
  beginFirstTurn(game, [a, b]);
  return { game, a, b, players: [a, b] };
}

let fieldSeq = 0;
function field(owner: EnginePlayer, line: "front" | "energy", cardId: string, rested = false): UnionArenaFieldCard {
  fieldSeq += 1;
  const card: UnionArenaFieldCard = { uid: `${owner.accountId}:t${fieldSeq}`, cardId, under: [], rested, bpMod: 0, energyMod: 0, grants: [], attacks: 0, blocks: 0, skipNextActivate: false };
  owner[line].push(card);
  return card;
}

const act = (game: EngineGame, players: EnginePlayer[], who: string, action: UnionArenaAction): void => applyAction(game, players, ctx, who, action);
const toPhase = (game: EngineGame, players: EnginePlayer[], who: string, phase: string): void => { while (game.phase !== phase) act(game, players, who, { type: "next_phase" }); };
/** Plays the rest of the current turn and the opponent's turn without doing anything, back to `who`'s start phase. */
function passRound(game: EngineGame, players: EnginePlayer[], who: string, other: string): void {
  toPhase(game, players, who, "main");
  act(game, players, who, { type: "end_turn" });
  toPhase(game, players, other, "main");
  act(game, players, other, { type: "end_turn" });
}

describe("Arknights rules engine: start phase and AP", () => {
  it("gives Player One 1 AP and no draw on the first turn, Player Two 2 AP and a draw, then 2 and 3 AP", () => {
    const { game, a, b, players } = setup();
    expect(game).toMatchObject({ step: "turn", turn: 1, turnPlayerId: "a", phase: "start" });
    expect(a.ap).toHaveLength(1);
    expect(a.hand).toHaveLength(0);
    toPhase(game, players, "a", "main");
    act(game, players, "a", { type: "end_turn" });
    expect(game).toMatchObject({ turn: 2, turnPlayerId: "b", phase: "start" });
    expect(b.ap).toHaveLength(2);
    expect(b.hand).toHaveLength(1);
    toPhase(game, players, "b", "main");
    act(game, players, "b", { type: "end_turn" });
    expect(a.ap).toHaveLength(2);
    expect(a.hand).toHaveLength(1);
    passRound(game, players, "a", "b");
    expect(b.ap).toHaveLength(2);
    expect(a.ap).toHaveLength(3);
    passRound(game, players, "a", "b");
    expect(b.ap).toHaveLength(3);
    expect(a.ap).toHaveLength(3);
  });

  it("allows one extra draw per turn for 1 AP, Player One's first turn included", () => {
    const { game, a, players } = setup();
    act(game, players, "a", { type: "extra_draw" });
    expect(a.hand).toHaveLength(1);
    expect(a.ap.filter((card) => card.rested)).toHaveLength(1);
    expect(() => act(game, players, "a", { type: "extra_draw" })).toThrow("NOT_NOW");
  });

  it("switches resting characters, sites and AP cards to active at the start of the turn; the end phase leaves AP resting", () => {
    const { game, a, players } = setup();
    const card = field(a, "energy", "gen1", true);
    toPhase(game, players, "a", "main");
    a.ap[0]!.rested = true;
    act(game, players, "a", { type: "end_turn" });
    expect(card.rested).toBe(false);
    expect(a.ap[0]!.rested).toBe(true);
    card.rested = true;
    toPhase(game, players, "b", "main");
    act(game, players, "b", { type: "end_turn" });
    expect(card.rested).toBe(false);
    expect(a.ap.every((ap) => !ap.rested)).toBe(true);
  });

  it("loses the game when the deck is empty at the start phase draw", () => {
    const { game, b, players } = setup();
    b.library = [];
    toPhase(game, players, "a", "main");
    act(game, players, "a", { type: "end_turn" });
    expect(game).toMatchObject({ step: "over", winnerId: "a" });
  });

  it("only lets the turn player act, phase by phase", () => {
    const { game, a, players } = setup();
    a.hand.push("gen1");
    expect(() => act(game, players, "b", { type: "next_phase" })).toThrow("NOT_YOUR_TURN");
    expect(() => act(game, players, "a", { type: "play", handIndex: 0, line: "energy" })).toThrow("NOT_NOW");
    toPhase(game, players, "a", "attack");
    expect(() => act(game, players, "a", { type: "play", handIndex: 0, line: "energy" })).toThrow("NOT_NOW");
  });
});

describe("Arknights rules engine: using cards", () => {
  it("plays a character resting onto either line after checking the required energy and paying its AP", () => {
    const { game, a, players } = setup();
    a.hand.push("gen1", "cost2");
    toPhase(game, players, "a", "main");
    act(game, players, "a", { type: "play", handIndex: 0, line: "energy" });
    expect(a.energy).toHaveLength(1);
    expect(a.energy[0]).toMatchObject({ cardId: "gen1", rested: true });
    expect(a.ap.every((card) => card.rested)).toBe(true);
    // The energy line makes 1 yellow; the card needs 2.
    a.ap[0]!.rested = false;
    expect(() => act(game, players, "a", { type: "play", handIndex: 0, line: "front" })).toThrow("NOT_ENOUGH_ENERGY");
    field(a, "energy", "gen1");
    act(game, players, "a", { type: "play", handIndex: 0, line: "front" });
    expect(a.front[0]).toMatchObject({ cardId: "cost2", rested: true });
  });

  it("counts energy only from the energy line and only in the card's colour", () => {
    const { game, a, players } = setup();
    field(a, "front", "gen1");
    field(a, "front", "gen1");
    field(a, "energy", "blue");
    field(a, "energy", "blue");
    a.hand.push("cost2");
    toPhase(game, players, "a", "main");
    expect(() => act(game, players, "a", { type: "play", handIndex: 0, line: "front" })).toThrow("NOT_ENOUGH_ENERGY");
  });

  it("refuses a card whose AP cost is more than the active AP cards", () => {
    const { game, a, players } = setup();
    a.hand.push("ap2");
    toPhase(game, players, "a", "main");
    expect(() => act(game, players, "a", { type: "play", handIndex: 0, line: "front" })).toThrow("NOT_ENOUGH_AP");
    expect(a.hand).toEqual(["ap2"]);
  });

  it("plays sites onto the energy line only, and puts a card of a full line into the removal area first", () => {
    const { game, a, players } = setup();
    a.hand.push("site");
    toPhase(game, players, "a", "main");
    expect(() => act(game, players, "a", { type: "play", handIndex: 0, line: "front" })).toThrow("SITE_ENERGY_LINE_ONLY");
    const full = [field(a, "energy", "filler"), field(a, "energy", "filler"), field(a, "energy", "filler"), field(a, "energy", "filler")];
    expect(() => act(game, players, "a", { type: "play", handIndex: 0, line: "energy" })).toThrow("LINE_FULL");
    act(game, players, "a", { type: "play", handIndex: 0, line: "energy", remove: full[1]!.uid });
    expect(a.energy).toHaveLength(4);
    expect(a.removal).toEqual(["filler"]);
  });

  it("uses an event, then puts it into the sideline", () => {
    const { game, a, players } = setup();
    a.hand.push("event");
    toPhase(game, players, "a", "main");
    act(game, players, "a", { type: "event", handIndex: 0 });
    expect(a.sideline).toEqual(["event"]);
    expect(a.hand).toEqual([]);
  });

  it("raids onto a named character: stacked, switched to active, may move to the front line", () => {
    const { game, a, players } = setup();
    const target = field(a, "energy", "gen1", true);
    a.hand.push("raider");
    toPhase(game, players, "a", "main");
    act(game, players, "a", { type: "raid", handIndex: 0, targetUid: target.uid, toFront: true });
    expect(a.energy).toHaveLength(0);
    expect(a.front[0]).toMatchObject({ cardId: "raider", under: ["gen1"], rested: false });
    // A card that has Raid cannot itself be raided onto.
    a.hand.push("raider");
    a.ap[0]!.rested = false;
    expect(() => act(game, players, "a", { type: "raid", handIndex: 0, targetUid: target.uid })).toThrow("RAID_TARGET_INVALID");
  });
});

describe("Arknights rules engine: movement", () => {
  it("moves characters to the front line, never sites, and only 撤步 characters back", () => {
    const { game, a, players } = setup();
    const mover = field(a, "energy", "gen1");
    const site = field(a, "energy", "site");
    const stepper = field(a, "front", "step");
    const stayer = field(a, "front", "filler");
    toPhase(game, players, "a", "movement");
    expect(() => act(game, players, "a", { type: "move", toFront: [site.uid], toEnergy: [], remove: [] })).toThrow("SITE_CANNOT_MOVE");
    expect(() => act(game, players, "a", { type: "move", toFront: [], toEnergy: [stayer.uid], remove: [] })).toThrow("STEP_REQUIRED");
    act(game, players, "a", { type: "move", toFront: [mover.uid], toEnergy: [stepper.uid], remove: [] });
    expect(a.front.map((card) => card.uid)).toEqual([stayer.uid, mover.uid]);
    expect(a.energy.map((card) => card.uid)).toEqual([site.uid, stepper.uid]);
    expect(game.phase).toBe("main");
  });
});

describe("Arknights rules engine: attacks", () => {
  function attackSetup() {
    const s = setup();
    toPhase(s.game, s.players, "a", "attack");
    return s;
  }

  it("deals 1 damage to an unblocked attack; the attacker picks the life card and the defender checks its trigger", () => {
    const { game, a, b, players } = attackSetup();
    const attacker = field(a, "front", "gen1");
    act(game, players, "a", { type: "attack", attackerUid: attacker.uid });
    expect(attacker.rested).toBe(true);
    expect(game.pending).toMatchObject({ kind: "damage", playerId: "a", amount: 1 });
    act(game, players, "a", { type: "damage", lifeIds: [b.life[3]!.id] });
    expect(b.life).toHaveLength(6);
    expect(game.pending).toMatchObject({ kind: "triggers", playerId: "b" });
    act(game, players, "b", { type: "trigger", lifeId: "b:life:3", activate: false });
    expect(b.sideline).toEqual(["filler"]);
    expect(game.pending).toBeNull();
  });

  it("deals 2 damage with 伤害2; rested characters cannot attack", () => {
    const { game, a, players } = attackSetup();
    const attacker = field(a, "front", "dmg2");
    const tired = field(a, "front", "dmg2", true);
    expect(() => act(game, players, "a", { type: "attack", attackerUid: tired.uid })).toThrow("INVALID_ATTACKER");
    act(game, players, "a", { type: "attack", attackerUid: attacker.uid });
    expect(game.pending).toMatchObject({ kind: "damage", amount: 2 });
  });

  it("lets the defender block with an active front character; the higher (or equal) BP wins and only a losing defender is sidelined", () => {
    const { game, a, b, players } = attackSetup();
    const attacker = field(a, "front", "impact");
    const blocker = field(b, "front", "gen1");
    act(game, players, "a", { type: "attack", attackerUid: attacker.uid });
    expect(game.pending).toMatchObject({ kind: "block", playerId: "b" });
    expect(() => act(game, players, "a", { type: "block", blockerUid: null })).toThrow("WAITING_FOR_OPPONENT");
    act(game, players, "b", { type: "block", blockerUid: blocker.uid });
    expect(b.front).toHaveLength(0);
    expect(b.sideline).toEqual(["gen1"]);
    // 冲击1: winning an attacking battle deals 1 damage.
    expect(game.pending).toMatchObject({ kind: "damage", amount: 1 });
  });

  it("does not sideline an attacker that loses, and 冲击无效 takes Impact away", () => {
    const { game, a, b, players } = attackSetup();
    const weak = field(a, "front", "gen1");
    const wall = field(b, "front", "big");
    act(game, players, "a", { type: "attack", attackerUid: weak.uid });
    act(game, players, "b", { type: "block", blockerUid: wall.uid });
    expect(a.front).toHaveLength(1);
    expect(b.front).toHaveLength(1);
    expect(game.pending).toBeNull();
    const impact = field(a, "front", "impact");
    const nullify = field(b, "front", "nullify");
    act(game, players, "a", { type: "attack", attackerUid: impact.uid });
    act(game, players, "b", { type: "block", blockerUid: nullify.uid });
    expect(b.sideline).toEqual(["nullify"]);
    expect(game.pending).toBeNull();
  });

  it("treats equal BP as an attacker win", () => {
    const { game, a, b, players } = attackSetup();
    const attacker = field(a, "front", "gen1");
    const blocker = field(b, "front", "gen1");
    act(game, players, "a", { type: "attack", attackerUid: attacker.uid });
    act(game, players, "b", { type: "block", blockerUid: blocker.uid });
    expect(b.front).toHaveLength(0);
  });

  it("瞄准攻击 attacks a front character directly and cannot be blocked", () => {
    const { game, a, b, players } = attackSetup();
    const sniper = field(a, "front", "snipe");
    const target = field(b, "front", "gen1", true);
    field(b, "front", "big");
    const plain = field(a, "front", "gen1");
    expect(() => act(game, players, "a", { type: "attack", attackerUid: plain.uid, targetUid: target.uid })).toThrow("SNIPE_REQUIRED");
    act(game, players, "a", { type: "attack", attackerUid: sniper.uid, targetUid: target.uid });
    expect(b.front.map((card) => card.cardId)).toEqual(["big"]);
    expect(game.pending).toBeNull();
  });

  it("2次攻击 and 2次阻挡 switch back to active after the first attack or block of the turn", () => {
    const { game, a, b, players } = attackSetup();
    const attacker = field(a, "front", "double");
    const wall = field(b, "front", "wall");
    act(game, players, "a", { type: "attack", attackerUid: attacker.uid });
    expect(attacker.rested).toBe(false);
    act(game, players, "b", { type: "block", blockerUid: wall.uid });
    expect(wall.rested).toBe(false);
    act(game, players, "a", { type: "attack", attackerUid: attacker.uid });
    expect(attacker.rested).toBe(true);
    act(game, players, "b", { type: "block", blockerUid: wall.uid });
    expect(wall.rested).toBe(true);
  });

  it("wins when the opponent has no life left after the trigger checks", () => {
    const { game, a, b, players } = attackSetup();
    b.life = b.life.slice(0, 1);
    const attacker = field(a, "front", "gen1");
    act(game, players, "a", { type: "attack", attackerUid: attacker.uid });
    act(game, players, "a", { type: "damage", lifeIds: [b.life[0]!.id] });
    expect(game.step).toBe("turn");
    act(game, players, "b", { type: "trigger", lifeId: "b:life:0", activate: false });
    expect(game).toMatchObject({ step: "over", winnerId: "a" });
    expect(() => act(game, players, "a", { type: "end_turn" })).toThrow("GAME_OVER");
  });
});

describe("Arknights rules engine: triggers", () => {
  function revealed(cardId: string) {
    const s = setup();
    toPhase(s.game, s.players, "a", "attack");
    s.b.life[0]!.cardId = cardId;
    const attacker = field(s.a, "front", "gen1");
    act(s.game, s.players, "a", { type: "attack", attackerUid: attacker.uid });
    act(s.game, s.players, "a", { type: "damage", lifeIds: [s.b.life[0]!.id] });
    return { ...s, attacker, lifeId: "b:life:0" };
  }

  it("抽卡 draws, 获得 adds the card to the hand", () => {
    const draw = revealed("tDraw");
    act(draw.game, draw.players, "b", { type: "trigger", lifeId: draw.lifeId, activate: true });
    expect(draw.b.hand).toHaveLength(1);
    expect(draw.b.sideline).toEqual(["tDraw"]);
    const get = revealed("tGet");
    act(get.game, get.players, "b", { type: "trigger", lifeId: get.lifeId, activate: true });
    expect(get.b.hand).toEqual(["tGet"]);
    expect(get.b.sideline).toEqual([]);
  });

  it("激活 switches one of the owner's characters to active with BP+3000 for the turn", () => {
    const s = revealed("tActive");
    const own = field(s.b, "front", "gen1", true);
    expect(() => act(s.game, s.players, "b", { type: "trigger", lifeId: s.lifeId, activate: true })).toThrow("TRIGGER_TARGET_REQUIRED");
    act(s.game, s.players, "b", { type: "trigger", lifeId: s.lifeId, activate: true, targetUid: own.uid });
    expect(own.rested).toBe(false);
    expect(bpOf(ctx, own)).toBe(4500);
    act(s.game, s.players, "a", { type: "end_turn" });
    expect(bpOf(ctx, own)).toBe(1500);
  });

  it("特殊 sidelines an attacking player's front character; 色彩 follows its printed BP limit", () => {
    const special = revealed("tSpecial");
    act(special.game, special.players, "b", { type: "trigger", lifeId: special.lifeId, activate: true, targetUid: special.attacker.uid });
    expect(special.a.front).toHaveLength(0);
    const color = revealed("tColorKill");
    const strong = field(color.a, "front", "big");
    expect(() => act(color.game, color.players, "b", { type: "trigger", lifeId: color.lifeId, activate: true, targetUid: strong.uid })).toThrow("TRIGGER_TARGET_INVALID");
    act(color.game, color.players, "b", { type: "trigger", lifeId: color.lifeId, activate: true, targetUid: color.attacker.uid });
    expect(color.a.front.map((card) => card.cardId)).toEqual(["big"]);
  });

  it("色彩 (rest) keeps the character resting through its next switch to active", () => {
    const s = revealed("tColorRest");
    const other = field(s.a, "front", "big");
    act(s.game, s.players, "b", { type: "trigger", lifeId: s.lifeId, activate: true, targetUid: other.uid });
    expect(other).toMatchObject({ rested: true, skipNextActivate: true });
    act(s.game, s.players, "a", { type: "end_turn" });
    expect(other.rested).toBe(true);
    toPhase(s.game, s.players, "b", "main");
    act(s.game, s.players, "b", { type: "end_turn" });
    expect(other.rested).toBe(false);
  });

  it("最终 puts the top card of the deck into an empty life area", () => {
    const s = revealed("tFinal");
    s.b.life = [];
    act(s.game, s.players, "b", { type: "trigger", lifeId: s.lifeId, activate: true });
    expect(s.b.life).toHaveLength(1);
    expect(s.game.step).toBe("turn");
  });

  it("突进 adds the card to the hand or raids without paying AP", () => {
    const s = revealed("tRaid");
    const target = field(s.b, "energy", "gen1", true);
    act(s.game, s.players, "b", { type: "trigger", lifeId: s.lifeId, activate: true, raid: { targetUid: target.uid } });
    expect(s.b.energy[0]).toMatchObject({ cardId: "tRaid", under: ["gen1"], rested: false });
  });
});

describe("Arknights rules engine: end phase", () => {
  it("keeps eight cards in hand and puts the rest into the removal area", () => {
    const { game, a, players } = setup();
    a.hand.push(...Array(10).fill("filler"));
    toPhase(game, players, "a", "main");
    act(game, players, "a", { type: "end_turn" });
    expect(game.pending).toMatchObject({ kind: "discard", playerId: "a" });
    expect(() => act(game, players, "a", { type: "discard", keep: [0, 1, 2] })).toThrow("INVALID_DISCARD");
    act(game, players, "a", { type: "discard", keep: [0, 1, 2, 3, 4, 5, 6, 7] });
    expect(a.hand).toHaveLength(8);
    expect(a.removal).toHaveLength(2);
    expect(game.turnPlayerId).toBe("b");
  });
});

describe("Arknights card data", () => {
  it("has printed data for every card with an image", () => {
    const usable = UNION_ARENA_CATALOG.filter((card) => card.imageAvailable);
    expect(usable).toHaveLength(252);
    expect(usable.filter((card) => !card.stats)).toEqual([]);
    for (const card of usable) {
      expect(["character", "site", "event"]).toContain(card.stats!.type);
      if (card.stats!.type === "character") expect(card.stats!.bp).toBeGreaterThan(0);
    }
  });

  it("limits 特殊, 色彩 and 最终 triggers to four cards each", () => {
    const specials = UNION_ARENA_CATALOG.filter((card) => card.imageAvailable && card.stats?.trigger?.label === "特殊" && card.sourceMaterialCode === "ARK");
    const deck = [...specials.slice(0, 5).map((card) => card.id)];
    const filler = UNION_ARENA_CATALOG.filter((card) => card.imageAvailable && !card.stats?.trigger);
    const counts = new Map<string, number>();
    for (const card of filler) {
      if (deck.length >= 50) break;
      const used = counts.get(card.number) ?? 0;
      if (used >= 4) continue;
      const add = Math.min(4 - used, 50 - deck.length);
      deck.push(...Array<string>(add).fill(card.id));
      counts.set(card.number, used + add);
    }
    expect(checkUnionArenaDeck(deck, 3, UNION_ARENA_CATALOG).issues).toContain("【特殊】触发的卡共 5 张，超过每种 4 张上限");
  });
});
