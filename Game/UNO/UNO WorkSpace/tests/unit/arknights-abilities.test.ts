import { describe, expect, it } from "vitest";
import {
  applyAction,
  beginFirstTurn,
  bpOf,
  costOf,
  energyOf,
  hasKeyword,
  newEngineGame,
  type EngineContext,
  type EngineGame,
  type EnginePlayer
} from "../../../../Arknights/ArknightsWorkSpace/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaCardStats, UnionArenaChoice, UnionArenaFieldCard } from "../../../../Arknights/ArknightsWorkSpace/src/shared/protocol.ts";
import { cardContext } from "../../../../Arknights/ArknightsWorkSpace/src/shared/abilities/registry.ts";
import { draw, may, onPlay, onSidelined, bp } from "../../../../Arknights/ArknightsWorkSpace/src/shared/abilities/dsl.ts";
import type { Ability } from "../../../../Arknights/ArknightsWorkSpace/src/shared/abilities/types.ts";
import { cloneMatch } from "../../../../Arknights/ArknightsWorkSpace/src/shared/ai/match.ts";
import { UNION_ARENA_CATALOG } from "../../../../Arknights/ArknightsWorkSpace/src/server/catalog.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx = cardContext((id) => byId.get(id));
const id = (number: string): string => UNION_ARENA_CATALOG.find((card) => card.number === number && card.imageAvailable)!.id;

const MISCHA_SIDELINED = id("UC01BT/ARK-1-001");
const MISCHA_PLAY = id("UC01BT/ARK-1-002");
const TALULAH_ENERGY = id("UC01BT/ARK-1-014");
const PATRIOT = id("UC01BT/ARK-1-017");
const RUINED_CITY = id("UC01BT/ARK-1-028");
const FRANKA = id("UC01BT/ARK-1-068");
const SWIRE = id("UC01BT/ARK-1-083");
const CHIXIAO = id("UC01BT/ARK-1-096");
const NEARL = id("UC01ST/ARK-1-104");
const CHEN = id("UC01BT/ARK-1-084"); // 陈, BP1500, no ability
const NINE = id("UC01BT/ARK-1-088"); // red, BP2000, no ability
const TEXAS_2500 = id("UC01BT/ARK-1-074"); // red, printed BP 2500
const KINGSLAYER = id("UC01BT/ARK-1-004"); // yellow, BP1500, generates yellow

function player(accountId: string): EnginePlayer {
  return { accountId, username: accountId.toUpperCase(), hand: [], library: Array(30).fill(NINE), life: Array.from({ length: 7 }, (_, index) => ({ id: `${accountId}:life:${index}`, cardId: NINE, faceUp: false })), apCount: 3, ap: [], front: [], energy: [], sideline: [], removal: [] };
}

let fieldSeq = 0;
function field(owner: EnginePlayer, line: "front" | "energy", cardId: string, rested = false): UnionArenaFieldCard {
  fieldSeq += 1;
  const card: UnionArenaFieldCard = { uid: `${owner.accountId}:t${fieldSeq}`, cardId, under: [], rested, bpMod: 0, energyMod: 0, grants: [], attacks: 0, blocks: 0, skipNextActivate: false, used: [] };
  owner[line].push(card);
  return card;
}

/** Player a's turn, in the given phase, with three active AP cards. */
function setup(phase: "main" | "attack" = "main", context: EngineContext = ctx) {
  const a = player("a");
  const b = player("b");
  const game = newEngineGame("a", []);
  beginFirstTurn(game, [a, b]);
  a.ap = [0, 1, 2].map((index) => ({ id: `a:ap${index}`, rested: false }));
  const players = [a, b];
  const act = (who: string, action: UnionArenaAction): void => applyAction(game, players, context, who, action);
  while (game.phase !== phase) act("a", { type: "next_phase" });
  return { game, a, b, players, act };
}

const choice = (game: EngineGame): UnionArenaChoice => {
  expect(game.pending?.kind).toBe("choose");
  return game.pending as UnionArenaChoice;
};

describe("Card abilities: When Played and When Sidelined", () => {
  it("米莎 (002): 登场时 gives one chosen own character with required energy 2 or less BP+2000 for the turn", () => {
    const { game, a, act } = setup();
    field(a, "energy", KINGSLAYER);
    const target = field(a, "front", CHEN);
    a.hand.push(MISCHA_PLAY);
    act("a", { type: "play", handIndex: 0, line: "front" });
    const ask = choice(game);
    expect(ask).toMatchObject({ playerId: "a", purpose: "target", min: 0, max: 1 });
    expect(ask.options).toContain(target.uid);
    act("a", { type: "choose", picks: [target.uid] });
    expect(bpOf(ctx, target)).toBe(1500 + 2000);
    expect(game.pending).toBeNull();
    // "最多1张": choosing nothing is allowed too.
    a.ap[1]!.rested = false;
    a.hand.push(MISCHA_PLAY);
    act("a", { type: "play", handIndex: 0, line: "front" });
    act("a", { type: "choose", picks: [] });
    expect(game.pending).toBeNull();
    // The bonus ends with the turn.
    act("a", { type: "end_turn" });
    expect(bpOf(ctx, target)).toBe(1500);
  });

  it("米莎 (001): 退场时 its owner draws one, then puts one hand card into the sideline — during the opponent's attack, before the attack goes on", () => {
    const { game, a, b, act } = setup("attack");
    const attacker = field(a, "front", NINE);
    const mischa = field(b, "front", MISCHA_SIDELINED);
    b.hand.push(CHEN, CHEN);
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: mischa.uid });
    // 2000 vs 1000: 米莎 is sidelined and its ability asks its owner (b) which card to put into the sideline.
    const ask = choice(game);
    expect(ask.playerId).toBe("b");
    expect(b.hand).toHaveLength(3);
    act("b", { type: "choose", picks: ["h:0"] });
    expect(b.hand).toHaveLength(2);
    expect(b.sideline).toEqual([MISCHA_SIDELINED, CHEN]);
    expect(game.pending).toBeNull();
    expect(game.phase).toBe("attack");
  });

  it("临光: 登场时 / 阻挡时 / 退场时 all other own front characters get BP+1000 for the turn", () => {
    const { game, a, act } = setup();
    a.energy.push(...Array.from({ length: 4 }, () => field(a, "energy", id("UC01ST/ARK-1-105")))); // blue energy
    a.energy.splice(4);
    const other = field(a, "front", CHEN);
    a.hand.push(NEARL);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(bpOf(ctx, other)).toBe(2500);
    expect(game.pending).toBeNull();
  });

  it("诗怀雅: 登场时 chooses up to one other own character (not itself)", () => {
    const { game, a, act } = setup();
    field(a, "energy", NINE);
    field(a, "energy", NINE);
    const other = field(a, "front", CHEN);
    a.hand.push(SWIRE);
    act("a", { type: "play", handIndex: 0, line: "energy" });
    const ask = choice(game);
    expect(ask.options).toEqual([other.uid, ...a.energy.filter((card) => card.cardId === NINE).map((card) => card.uid)]);
    act("a", { type: "choose", picks: [other.uid] });
    expect(bpOf(ctx, other)).toBe(2500);
  });
});

describe("Card abilities: attacking and blocking", () => {
  it("芙兰卡: 攻击时 with a printed-BP-2500 character on the front line gains BP+2000 and 冲击1; without one nothing happens", () => {
    const { game, a, b, act } = setup("attack");
    const franka = field(a, "front", FRANKA);
    field(a, "front", TEXAS_2500, true);
    const wall = field(b, "front", id("UC01BT/ARK-1-090")); // 星熊 BP2000
    act("a", { type: "attack", attackerUid: franka.uid });
    expect(bpOf(ctx, franka)).toBe(6000);
    expect(hasKeyword(ctx, franka, "冲击1")).toBe(true);
    act("b", { type: "block", blockerUid: wall.uid });
    // It won the battle: 冲击1 deals one damage.
    expect(game.pending).toMatchObject({ kind: "damage", amount: 1 });

    const second = setup("attack");
    const alone = field(second.a, "front", FRANKA);
    second.act("a", { type: "attack", attackerUid: alone.uid });
    expect(bpOf(ctx, alone)).toBe(4000);
  });

  it("芙兰卡: 阻挡时 it gets BP-2000 for the turn, before the battle", () => {
    const { a, b, act } = setup("attack");
    const attacker = field(a, "front", id("UC01BT/ARK-1-090")); // 2000
    const franka = field(b, "front", FRANKA); // 4000 - 2000 = 2000: the attacker wins on equal BP
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: franka.uid });
    expect(b.front).toHaveLength(0);
    expect(b.sideline).toEqual([FRANKA]);
  });
});

describe("Card abilities: Activate: Main, continuous effects and cost changes", () => {
  it("废城: pays its costs (rest itself, put a hand card into the sideline) only when the opponent has two resting characters, then activates a chosen character", () => {
    const { game, a, b, act } = setup();
    const city = field(a, "energy", RUINED_CITY);
    const tired = field(a, "front", CHEN, true);
    field(a, "front", NINE);
    a.hand.push(NINE);
    expect(() => act("a", { type: "activate", uid: city.uid, ability: 0 })).toThrow("ABILITY_CONDITION");
    field(b, "front", NINE, true);
    field(b, "front", NINE, true);
    act("a", { type: "activate", uid: city.uid, ability: 0 });
    expect(city.rested).toBe(true);
    // First the cost: the only hand card is taken without asking; then the target.
    expect(a.hand).toEqual([]);
    expect(a.sideline).toEqual([NINE]);
    const ask = choice(game);
    expect(ask.min).toBe(1);
    act("a", { type: "choose", picks: [tired.uid] });
    expect(tired.rested).toBe(false);
    // Rested, it cannot pay again.
    a.hand.push(NINE);
    expect(() => act("a", { type: "activate", uid: city.uid, ability: 0 })).toThrow("ABILITY_COST");
  });

  it("爱国者: costs 4 less while the opponent has two resting characters; its Activate: Main gives 伤害2 once per turn", () => {
    const { game, a, b, players, act } = setup();
    a.hand.push(PATRIOT);
    expect(costOf(game, players, ctx, "a", PATRIOT).energy).toBe(8);
    field(b, "front", NINE, true);
    field(b, "front", NINE, true);
    expect(costOf(game, players, ctx, "a", PATRIOT).energy).toBe(4);
    for (let index = 0; index < 4; index += 1) field(a, "energy", KINGSLAYER);
    act("a", { type: "play", handIndex: 0, line: "front" });
    const patriot = a.front[0]!;
    a.hand.push(NINE, NINE);
    act("a", { type: "activate", uid: patriot.uid, ability: 1 });
    act("a", { type: "choose", picks: ["h:0"] });
    expect(hasKeyword(ctx, patriot, "伤害2")).toBe(true);
    expect(() => act("a", { type: "activate", uid: patriot.uid, ability: 1 })).toThrow("ONCE_PER_TURN");
  });

  it("塔露拉 (014): generates one more yellow energy while it is active", () => {
    const { game, a, act } = setup();
    const talulah = field(a, "energy", TALULAH_ENERGY);
    act("a", { type: "next_phase" }); // any action refreshes continuous effects
    expect(energyOf(ctx, a, "yellow")).toBe(2);
    talulah.rested = true;
    act("a", { type: "end_turn" });
    expect(game.turnPlayerId).toBe("b");
    // Its own end phase made it active again.
    expect(energyOf(ctx, a, "yellow")).toBe(2);
  });
});

describe("Card abilities: events", () => {
  it("赤霄・拔刀: sidelines an opponent front character with BP 3000 or less, 5000 or less with 〈陈〉 on the field; then goes to the sideline", () => {
    const { game, a, b, act } = setup();
    for (let index = 0; index < 4; index += 1) field(a, "energy", NINE);
    const small = field(b, "front", NINE);
    const big = field(b, "front", id("UC01BT/ARK-1-092")); // 星熊 BP4000
    a.hand.push(CHIXIAO);
    act("a", { type: "event", handIndex: 0 });
    // Only one legal target: chosen without asking.
    expect(b.front).toEqual([big]);
    expect(b.sideline).toEqual([NINE]);
    expect(a.sideline).toEqual([CHIXIAO]);
    expect(game.pending).toBeNull();

    a.ap[0]!.rested = false;
    field(a, "front", CHEN);
    a.hand.push(CHIXIAO);
    act("a", { type: "event", handIndex: 0 });
    expect(b.front).toEqual([]);
    expect(small).toBeTruthy();
  });
});

describe("Ability framework", () => {
  // Made-up cards to exercise the framework itself.
  const base: UnionArenaCardStats = { type: "character", color: "red", energyCost: 0, apCost: 1, bp: 1000, energyGen: 1, energyGenColor: "red", energyGenPlus: false, affinities: [], raid: null, keywords: [], abilityText: "", trigger: null };
  const custom: Record<string, Ability[]> = {
    twin: [onSidelined(draw(1)), onSidelined(bp(() => [], 0))],
    optional: [onPlay(may("是否抽 1 张卡？", draw(1)))]
  };
  const test: EngineContext = { card: (cardId) => ({ ...base, name: cardId, number: cardId, abilities: custom[cardId] ?? [] }) };

  it("asks the owner which of several simultaneous abilities resolves first", () => {
    const { game, a, b, act } = setup("attack", test);
    const attacker = field(a, "front", "plain");
    attacker.bpMod = 5000;
    const twin = field(b, "front", "twin");
    act("a", { type: "attack", attackerUid: attacker.uid });
    act("b", { type: "block", blockerUid: twin.uid });
    const ask = choice(game);
    expect(ask).toMatchObject({ purpose: "order", playerId: "b" });
    expect(ask.options).toHaveLength(2);
    const handBefore = b.hand.length;
    act("b", { type: "choose", picks: [ask.options[0]!] });
    expect(b.hand).toHaveLength(handBefore + 1);
    expect(game.pending).toBeNull();
  });

  it("asks before an optional part (可以……) and skips it on no", () => {
    const { game, a, act } = setup("main", test);
    a.hand.push("optional", "optional");
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game)).toMatchObject({ purpose: "confirm", options: ["yes", "no"] });
    const handSize = a.hand.length;
    act("a", { type: "choose", picks: ["no"] });
    expect(a.hand).toHaveLength(handSize);
    act("a", { type: "play", handIndex: 0, line: "front" });
    act("a", { type: "choose", picks: ["yes"] });
    expect(a.hand).toHaveLength(handSize);
  });

  it("refuses other moves while an ability waits for a choice, and a game can be copied in the middle of one", () => {
    const { game, a, b, players, act } = setup();
    field(a, "energy", KINGSLAYER);
    field(a, "front", CHEN);
    a.hand.push(MISCHA_PLAY, NINE);
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(() => act("a", { type: "next_phase" })).toThrow("NOT_NOW");
    expect(() => act("b", { type: "choose", picks: [] })).toThrow("WAITING_FOR_OPPONENT");
    expect(() => act("a", { type: "choose", picks: ["nonsense"] })).toThrow("INVALID_CHOICE");
    const copy = cloneMatch({ game, players: [a, b], rng: { state: 1 } });
    applyAction(copy.game, copy.players, ctx, "a", { type: "choose", picks: [] });
    expect(copy.game.pending).toBeNull();
    expect(game.pending?.kind).toBe("choose");
    void players;
  });
});
