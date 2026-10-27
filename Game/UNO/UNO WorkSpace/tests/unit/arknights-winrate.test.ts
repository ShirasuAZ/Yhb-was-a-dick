import { describe, expect, it } from "vitest";
import { actingPlayerId, applyAction, type EngineContext } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { chooseHeuristic } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/heuristic.ts";
import { cloneMatch, createMatch, dealMatch, makeRng, shuffle, wantsMulligan } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/match.ts";
import { deckCards, PRESET_DECKS } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/decks.ts";
import { estimateWinRate, loadWinRate, type WinRateWeightsJson } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/winrate.ts";
import weights from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/winrate-weights.json";
import { UNION_ARENA_CATALOG } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/catalog.ts";
import { UnionArenaRoom } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/rooms.ts";
import type { UnionArenaAccount, UnionArenaAuthProvider } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { cardContext } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/abilities/registry.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx: EngineContext = cardContext((id) => byId.get(id));
const model = loadWinRate(weights as unknown as WinRateWeightsJson);
const seats = (): Parameters<typeof createMatch>[0] => [
  { id: "a", name: "A", deck: deckCards(PRESET_DECKS[0]!) },
  { id: "b", name: "B", deck: deckCards(PRESET_DECKS[1]!) }
];

/** A heuristic game played `moves` actions in. */
function playedMatch(moves: number, seed = 5) {
  const match = createMatch(seats(), seed, { mulligan: (player) => wantsMulligan(ctx, player.hand) });
  const rng = makeRng(seed);
  for (let step = 0; step < moves && match.game.step === "turn"; step += 1) {
    const actor = actingPlayerId(match.game)!;
    applyAction(match.game, match.players, ctx, actor, chooseHeuristic(match, ctx, actor, "normal", rng)!);
  }
  return match;
}

describe("Arknights win-rate estimate", () => {
  it("gives each player a chance between 0 and 1 during a game, and none before or after it", () => {
    expect(estimateWinRate(model, dealMatch(seats(), 3).game, dealMatch(seats(), 3).players, ctx, "a")).toBeNull();
    for (const moves of [0, 40, 120]) {
      const match = playedMatch(moves);
      for (const viewer of ["a", "b"]) {
        const rate = estimateWinRate(model, match.game, match.players, ctx, viewer)!;
        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThan(1);
      }
    }
    const finished = playedMatch(3000);
    expect(finished.game.step).toBe("over");
    expect(estimateWinRate(model, finished.game, finished.players, ctx, "a")).toBeNull();
  });

  it("uses only what the viewer can see: the opponent's hand and both decks do not change it", () => {
    const match = playedMatch(60);
    const before = estimateWinRate(model, match.game, match.players, ctx, "a");
    const changed = cloneMatch(match);
    const opponent = changed.players.find((player) => player.accountId === "b")!;
    const pool = shuffle(makeRng(9), [...opponent.hand, ...opponent.library]);
    opponent.hand = pool.slice(0, opponent.hand.length);
    opponent.library = pool.slice(opponent.hand.length);
    const mine = changed.players.find((player) => player.accountId === "a")!;
    mine.library = shuffle(makeRng(10), mine.library);
    expect(estimateWinRate(model, changed.game, changed.players, ctx, "a")).toBe(before);
  });

  it("is sent to each player of a Players vs Players room, for that player", () => {
    const accounts: UnionArenaAccount[] = [{ id: "a", username: "A", avatarUrl: null }, { id: "b", username: "B", avatarUrl: null }];
    const auth: UnionArenaAuthProvider = { verifyToken: () => null, findAccount: (id) => accounts.find((account) => account.id === id) ?? null };
    const room = new UnionArenaRoom("WINR01", UNION_ARENA_CATALOG, new Set(UNION_ARENA_CATALOG.map((card) => card.id)), auth);
    const [a, b] = accounts.map((account, index) => room.add(account, { id: `s${index}`, data: {}, join: () => undefined } as never));
    room.updateDeck(a!, deckCards(PRESET_DECKS[0]!), 3);
    room.updateDeck(b!, deckCards(PRESET_DECKS[1]!), 3);
    a!.ready = true;
    b!.ready = true;
    room.startGame();
    expect(room.stateFor(a!).game!.winRate).toBeNull();
    const first = room.stateFor(a!).game!.firstPlayerId === "a" ? a! : b!;
    room.mulligan(first, false);
    room.mulligan(first === a ? b! : a!, false);
    const mine = room.stateFor(a!).game!.winRate!;
    const theirs = room.stateFor(b!).game!.winRate!;
    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThan(1);
    expect(theirs).toBeGreaterThan(0);
    expect(theirs).toBeLessThan(1);
    expect(mine).toBe(estimateWinRate(model, room.game!, room.players, room["ctx"], "a"));
  });
});
