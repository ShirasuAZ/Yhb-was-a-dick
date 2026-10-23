import { describe, expect, it } from "vitest";
import { UnoGame } from "../../server/game/game.ts";
import {
  IDENTITY_RANDOM,
  buildOrderedDeck,
  cardOfKind,
  makePlayers
} from "./helpers.ts";

function gameWithOpening(kind: Parameters<typeof buildOrderedDeck>[0]) {
  const built = buildOrderedDeck(kind, 2);
  return new UnoGame(makePlayers(2), {
    gameKey: "opening-test",
    random: IDENTITY_RANDOM,
    deck: built.cards,
    plus10CardId: built.plus10CardId,
    allCardIds: built.allCardIds
  });
}

describe("opening card rules", () => {
  it("redraws wild opening cards without losing them", () => {
    const game = gameWithOpening("wild10");
    expect(game.discard).toHaveLength(1);
    expect(game.discard[0]?.kind).not.toBe("wild10");
    expect(game.deck.some((card) => card.kind === "wild10")).toBe(true);
    expect(game.currentPlayerId).toBe("p1");
    game.verify();
  });

  it("applies skip to the first player", () => {
    const game = gameWithOpening("skip");
    expect(game.currentPlayerId).toBe("p2");
    expect(game.direction).toBe(1);
    game.verify();
  });

  it("reverses the direction and starts with the previous seat", () => {
    const game = gameWithOpening("reverse");
    expect(game.currentPlayerId).toBe("p2");
    expect(game.direction).toBe(-1);
    game.verify();
  });

  it("applies draw two to the first player and skips them", () => {
    const game = gameWithOpening("draw2");
    expect(game.currentPlayerId).toBe("p2");
    expect(game.players[0]?.hand).toHaveLength(9);
    expect(game.players[1]?.hand).toHaveLength(7);
    game.verify();
  });

  it("starts with the first player after a number opening", () => {
    const game = gameWithOpening("number");
    expect(game.currentPlayerId).toBe("p1");
    const top = game.discard[game.discard.length - 1]!;
    expect(top.kind).toBe("number");
    expect(top.color).not.toBeNull();
    game.verify();
  });

  it("always leaves the 109-card identity set intact", () => {
    const game = gameWithOpening("number");
    const ids = [
      ...game.deck,
      ...game.discard,
      ...game.players.flatMap((player) => player.hand)
    ].map((card) => card.id);
    expect(ids).toHaveLength(109);
    expect(new Set(ids).size).toBe(109);
    expect(cardOfKind(game, "wild10").id).toBe(game.plus10CardId);
  });
});
