import { describe, expect, it } from "vitest";
import { UnoGame } from "../../server/game/game.ts";
import { makePlayers, seededRandom } from "./helpers.ts";

function playToCompletion(playerCount: number, seed: number): UnoGame {
  const game = new UnoGame(makePlayers(playerCount), {
    gameKey: `full-${playerCount}-${seed}`,
    random: seededRandom(seed)
  });
  for (let turn = 0; turn < 12_000; turn += 1) {
    if (game.status === "finished") {
      game.verify();
      return game;
    }
    if (game.pendingPenalty) {
      game.respondPenalty(game.pendingPenalty.targetId, "accept");
      game.verify();
      continue;
    }
    if (game.pendingUno) {
      game.declareUno(game.pendingUno.playerId);
      game.verify();
      continue;
    }

    const current = game.currentPlayer;
    const playable = game.playableCardIdsFor(current.id);
    if (playable.length > 0) {
      const cardId = playable[0]!;
      const card = current.hand.find((candidate) => candidate.id === cardId);
      if (!card) {
        throw new Error("Playable card is missing from the current hand");
      }
      game.playCard(
        current.id,
        card.id,
        card.kind === "wild" || card.kind === "wild4" ? "blue" : undefined
      );
    } else if (game.drawnCardId) {
      game.endTurn(current.id);
    } else {
      game.drawCard(current.id);
    }
    game.verify();
  }
  throw new Error(`Game ${playerCount}p did not finish`);
}

describe("complete games", () => {
  it.each([
    [2, 11],
    [2, 29],
    [3, 37],
    [3, 73],
    [6, 101],
    [6, 211]
  ])("finishes a %i-player game with seed %i", (playerCount, seed) => {
    const game = playToCompletion(playerCount, seed);
    expect(game.status).toBe("finished");
    expect(game.winnerId).not.toBeNull();
    expect(game.players).toHaveLength(playerCount);
    expect(
      [...game.deck, ...game.discard, ...game.players.flatMap((player) => player.hand)]
    ).toHaveLength(109);
  });
});
