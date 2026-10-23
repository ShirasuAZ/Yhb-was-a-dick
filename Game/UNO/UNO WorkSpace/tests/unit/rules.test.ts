import { describe, expect, it } from "vitest";
import { GameError } from "../../server/game/game.ts";
import {
  cardOfKind,
  extractCard,
  makeGame,
  moveDeckToPlayer,
  putOnDeckTop,
  setCurrent,
  setHand,
  setTop
} from "./helpers.ts";

function expectGameError(action: () => void, code: string): void {
  try {
    action();
    throw new Error(`Expected GameError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(GameError);
    expect((error as GameError).code).toBe(code);
  }
}

describe("two-player turn rules", () => {
  it("treats reverse as skip and keeps the same player", () => {
    const game = makeGame(2);
    const reverse = cardOfKind(game, "reverse", "red");
    const top = cardOfKind(game, "number", "blue", 9);
    setHand(game, 0, [
      reverse,
      cardOfKind(game, "number", "yellow", 5),
      cardOfKind(game, "number", "green", 6)
    ]);
    setTop(game, top.id, "red");
    setCurrent(game, 0);
    game.direction = 1;

    game.playCard("p1", reverse.id);

    expect(game.currentPlayerId).toBe("p1");
    expect(game.direction).toBe(-1);
    expect(game.pendingUno).toBeNull();
    game.verify();
  });

  it("treats skip as giving the same player another turn", () => {
    const game = makeGame(2);
    const skip = cardOfKind(game, "skip", "red");
    const top = cardOfKind(game, "number", "blue", 9);
    setHand(game, 0, [skip, cardOfKind(game, "number", "yellow", 5)]);
    setTop(game, top.id, "red");
    setCurrent(game, 0);
    game.direction = 1;

    game.playCard("p1", skip.id);

    expect(game.currentPlayerId).toBe("p1");
    game.verify();
  });

  it("draw two makes the opponent draw and skip", () => {
    const game = makeGame(2);
    const draw2 = cardOfKind(game, "draw2", "red");
    const top = cardOfKind(game, "number", "blue", 9);
    setHand(game, 0, [draw2, cardOfKind(game, "number", "yellow", 5)]);
    setTop(game, top.id, "red");
    setCurrent(game, 0);
    game.direction = 1;
    const before = game.players[1]!.hand.length;

    game.playCard("p1", draw2.id);

    expect(game.pendingPenalty?.targetId).toBe("p2");
    expect(game.pendingPenalty?.total).toBe(2);
    expect(game.currentPlayerId).toBe("p2");
    game.respondPenalty("p2", "accept");
    expect(game.players[1]!.hand).toHaveLength(before + 2);
    expect(game.currentPlayerId).toBe("p1");
    game.verify();
  });

  it("wild draw four also gives the same player the next turn after acceptance", () => {
    const game = makeGame(2);
    const wild4 = cardOfKind(game, "wild4");
    const top = cardOfKind(game, "number", "red", 9);
    setHand(game, 0, [
      wild4,
      cardOfKind(game, "number", "blue", 5),
      cardOfKind(game, "number", "green", 5)
    ]);
    setTop(game, top.id, "red");
    setCurrent(game, 0);
    game.direction = 1;
    const before = game.players[1]!.hand.length;

    game.playCard("p1", wild4.id, "yellow");
    expect(game.pendingPenalty?.targetId).toBe("p2");
    expect(game.pendingPenalty?.total).toBe(4);
    game.respondPenalty("p2", "accept");

    expect(game.players[1]!.hand).toHaveLength(before + 4);
    expect(game.currentPlayerId).toBe("p1");
    game.verify();
  });
});

describe("penalty stacking", () => {
  it("waits for the target to stack or accept a +2", () => {
    const game = makeGame(3);
    const draw2 = cardOfKind(game, "draw2", "red");
    setHand(game, 0, [
      draw2,
      cardOfKind(game, "number", "yellow", 5),
      cardOfKind(game, "number", "green", 6)
    ]);
    setHand(game, 1, [
      cardOfKind(game, "number", "blue", 1),
      cardOfKind(game, "number", "yellow", 2)
    ]);
    setHand(game, 2, [
      cardOfKind(game, "number", "green", 3),
      cardOfKind(game, "number", "blue", 4)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setCurrent(game, 0);
    game.direction = 1;
    const targetBefore = game.players[1]!.hand.length;

    game.playCard("p1", draw2.id);

    expect(game.pendingPenalty).toMatchObject({
      attackerId: "p1",
      targetId: "p2",
      total: 2,
      lastKind: "draw2"
    });
    expect(game.currentPlayerId).toBe("p2");
    expect(game.players[1]!.hand).toHaveLength(targetBefore);
    expect(game.playableCardIdsFor("p2")).toEqual([]);

    game.respondPenalty("p2", "accept");
    expect(game.players[1]!.hand).toHaveLength(targetBefore + 2);
    expect(game.currentPlayerId).toBe("p3");
    game.verify();
  });

  it("lets both players stack +2 cards until one player accepts the total", () => {
    const game = makeGame(3);
    const first = cardOfKind(game, "draw2", "red");
    const second = cardOfKind(game, "draw2", "blue");
    setHand(game, 0, [
      first,
      cardOfKind(game, "number", "yellow", 5)
    ]);
    setHand(game, 1, [
      second,
      cardOfKind(game, "number", "green", 6)
    ]);
    setHand(game, 2, [
      cardOfKind(game, "number", "blue", 1),
      cardOfKind(game, "number", "yellow", 2)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setCurrent(game, 0);
    game.direction = 1;
    const p3Before = game.players[2]!.hand.length;

    game.playCard("p1", first.id);
    expect(game.pendingPenalty?.total).toBe(2);
    game.playCard("p2", second.id);
    expect(game.pendingPenalty).toMatchObject({
      attackerId: "p2",
      targetId: "p3",
      total: 4
    });

    game.respondPenalty("p3", "accept");
    expect(game.players[2]!.hand).toHaveLength(p3Before + 4);
    expect(game.currentPlayerId).toBe("p1");
    game.verify();
  });

  it("supports mixed stacking and a successful challenge of the last +4", () => {
    const game = makeGame(3);
    const draw2 = cardOfKind(game, "draw2", "red");
    const wild4 = cardOfKind(game, "wild4");
    setHand(game, 0, [
      draw2,
      cardOfKind(game, "number", "yellow", 5)
    ]);
    setHand(game, 1, [
      wild4,
      cardOfKind(game, "number", "red", 5),
      cardOfKind(game, "number", "green", 6)
    ]);
    setHand(game, 2, [
      cardOfKind(game, "number", "blue", 1),
      cardOfKind(game, "number", "yellow", 2)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setCurrent(game, 0);
    game.direction = 1;
    const p2BeforeStack = game.players[1]!.hand.length;

    game.playCard("p1", draw2.id);
    game.playCard("p2", wild4.id, "green");
    expect(game.pendingPenalty).toMatchObject({
      attackerId: "p2",
      targetId: "p3",
      total: 6,
      lastKind: "wild4",
      matchingColorAtPlay: true
    });

    const result = game.respondPenalty("p3", "challenge");
    expect(result.challengeSucceeded).toBe(true);
    expect(game.players[1]!.hand).toHaveLength(p2BeforeStack - 1 + 6);
    expect(game.currentPlayerId).toBe("p3");
    game.verify();
  });

  it("adds the two-card failed-challenge penalty to the accumulated stack", () => {
    const game = makeGame(3);
    const draw2 = cardOfKind(game, "draw2", "red");
    const wild4 = cardOfKind(game, "wild4");
    setHand(game, 0, [
      draw2,
      cardOfKind(game, "number", "yellow", 5)
    ]);
    setHand(game, 1, [
      wild4,
      cardOfKind(game, "number", "blue", 5),
      cardOfKind(game, "number", "green", 6)
    ]);
    setHand(game, 2, [
      cardOfKind(game, "number", "blue", 1),
      cardOfKind(game, "number", "yellow", 2)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setCurrent(game, 0);
    game.direction = 1;
    const p3Before = game.players[2]!.hand.length;

    game.playCard("p1", draw2.id);
    game.playCard("p2", wild4.id, "green");
    expect(game.pendingPenalty?.matchingColorAtPlay).toBe(false);
    const result = game.respondPenalty("p3", "challenge");

    expect(result.challengeSucceeded).toBe(false);
    expect(game.players[2]!.hand).toHaveLength(p3Before + 8);
    expect(game.currentPlayerId).toBe("p1");
    game.verify();
  });
});

describe("multi-player turn order", () => {
  it("moves through six seats in order", () => {
    const game = makeGame(6);
    setCurrent(game, 0);
    game.direction = 1;
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setHand(game, 0, [
      cardOfKind(game, "number", "red", 5),
      cardOfKind(game, "number", "blue", 5),
      cardOfKind(game, "number", "green", 5)
    ]);
    game.playCard("p1", game.players[0]!.hand[0]!.id);
    expect(game.currentPlayerId).toBe("p2");

    setHand(game, 1, [
      cardOfKind(game, "number", "red", 6),
      cardOfKind(game, "number", "blue", 6),
      cardOfKind(game, "number", "green", 6)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    game.playCard("p2", game.players[1]!.hand[0]!.id);
    expect(game.currentPlayerId).toBe("p3");

    setCurrent(game, 3);
    setHand(game, 3, [
      cardOfKind(game, "number", "red", 7),
      cardOfKind(game, "number", "blue", 7),
      cardOfKind(game, "number", "green", 7)
    ]);
    game.playCard("p4", game.players[3]!.hand[0]!.id);
    expect(game.currentPlayerId).toBe("p5");
    game.verify();
  });

  it("reverses direction around a three-player table", () => {
    const game = makeGame(3);
    setCurrent(game, 0);
    game.direction = 1;
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setHand(game, 0, [
      cardOfKind(game, "reverse", "red"),
      cardOfKind(game, "number", "blue", 5),
      cardOfKind(game, "number", "green", 5)
    ]);
    game.playCard("p1", game.players[0]!.hand[0]!.id);
    expect(game.direction).toBe(-1);
    expect(game.currentPlayerId).toBe("p3");
    game.verify();
  });
});

describe("wild draw four", () => {
  it("records an illegal bluff that can be caught by a challenge", () => {
    const game = makeGame(2);
    const wild4 = cardOfKind(game, "wild4");
    setHand(game, 0, [
      wild4,
      cardOfKind(game, "number", "red", 5),
      cardOfKind(game, "number", "blue", 5)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setCurrent(game, 0);
    game.direction = 1;

    game.playCard("p1", wild4.id, "green");
    expect(game.pendingPenalty?.matchingColorAtPlay).toBe(true);
    const result = game.respondPenalty("p2", "challenge");
    expect(result.challengeSucceeded).toBe(true);
    expect(game.players[0]!.hand).toHaveLength(6);
    expect(game.currentPlayerId).toBe("p2");
    game.verify();
  });

  it("lets the next player challenge and penalizes a losing challenge", () => {
    const game = makeGame(3);
    const wild4 = cardOfKind(game, "wild4");
    setHand(game, 0, [
      wild4,
      cardOfKind(game, "number", "blue", 5),
      cardOfKind(game, "number", "green", 5)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setCurrent(game, 0);
    game.direction = 1;
    const before = game.players[1]!.hand.length;

    game.playCard("p1", wild4.id, "yellow");
    const result = game.respondPenalty("p2", "challenge");

    expect(result.challengeSucceeded).toBe(false);
    expect(game.players[1]!.hand).toHaveLength(before + 6);
    expect(game.currentPlayerId).toBe("p3");
    game.verify();
  });

  it("supports the challenge-success branch without duplicating cards", () => {
    const game = makeGame(3);
    const wild4 = cardOfKind(game, "wild4");
    setHand(game, 0, [
      wild4,
      cardOfKind(game, "number", "blue", 5),
      cardOfKind(game, "number", "green", 5)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setCurrent(game, 0);
    game.direction = 1;
    const before = game.players[0]!.hand.length;
    game.playCard("p1", wild4.id, "yellow");
    game.pendingPenalty!.matchingColorAtPlay = true;

    const result = game.respondPenalty("p2", "challenge");

    expect(result.challengeSucceeded).toBe(true);
    expect(game.players[0]!.hand).toHaveLength(before - 1 + 4);
    expect(game.currentPlayerId).toBe("p2");
    game.verify();
  });
});

describe("UNO declaration window", () => {
  it("allows the player who just played to declare UNO", () => {
    const game = makeGame(3);
    setCurrent(game, 0);
    game.direction = 1;
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setHand(game, 0, [
      cardOfKind(game, "number", "red", 5),
      cardOfKind(game, "number", "blue", 5)
    ]);
    game.playCard("p1", game.players[0]!.hand[0]!.id);

    expect(game.pendingUno?.playerId).toBe("p1");
    expect(game.publicView("p1").pendingUno?.canDeclare).toBe(true);
    game.declareUno("p1");
    expect(game.pendingUno).toBeNull();
    expect(game.publicView("p2").pendingUno).toBeNull();
    expect(game.publicView("p1").playableCardIds.length).toBeGreaterThanOrEqual(0);
    game.verify();
  });

  it("penalizes a missed declaration when another player catches it", () => {
    const game = makeGame(3);
    setCurrent(game, 0);
    game.direction = 1;
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setHand(game, 0, [
      cardOfKind(game, "number", "red", 5),
      cardOfKind(game, "number", "blue", 5)
    ]);
    game.playCard("p1", game.players[0]!.hand[0]!.id);

    game.catchUno("p3", "p1");
    expect(game.players[0]!.hand).toHaveLength(3);
    expect(game.pendingUno).toBeNull();
    expect(game.lastEvent?.type).toBe("uno_caught");
    game.verify();
  });

  it("closes the catch window when the next player acts", () => {
    const game = makeGame(3);
    setCurrent(game, 0);
    game.direction = 1;
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setHand(game, 0, [
      cardOfKind(game, "number", "red", 5),
      cardOfKind(game, "number", "blue", 5)
    ]);
    game.playCard("p1", game.players[0]!.hand[0]!.id);

    game.drawCard("p2");
    expectGameError(() => game.catchUno("p3", "p1"), "UNO_NOT_CATCHABLE");
    game.verify();
  });

  it("does not close the window on an invalid play attempt", () => {
    const game = makeGame(3);
    setCurrent(game, 0);
    game.direction = 1;
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setHand(game, 0, [
      cardOfKind(game, "number", "red", 5),
      cardOfKind(game, "number", "blue", 5)
    ]);
    game.playCard("p1", game.players[0]!.hand[0]!.id);
    setHand(game, 1, [
      cardOfKind(game, "number", "blue", 2),
      cardOfKind(game, "number", "green", 3),
      cardOfKind(game, "number", "yellow", 4)
    ]);
    const nextPlayerCard = game.players[1]!.hand[0]!;

    expectGameError(
      () => game.playCard("p2", nextPlayerCard.id),
      "ILLEGAL_PLAY"
    );
    expect(game.pendingUno?.playerId).toBe("p1");
    game.catchUno("p3", "p1");
    expect(game.players[0]!.hand).toHaveLength(3);
    game.verify();
  });
});

describe("drawing and discard recycling", () => {
  it("lets a player play the card they just drew or end the turn", () => {
    const game = makeGame(2);
    const drawn = cardOfKind(game, "number", "blue", 5);
    const top = cardOfKind(game, "number", "blue", 9);
    setCurrent(game, 0);
    setTop(game, top.id, "blue");
    setHand(game, 0, [
      cardOfKind(game, "number", "red", 5),
      cardOfKind(game, "number", "green", 5),
      cardOfKind(game, "number", "yellow", 5)
    ]);
    putOnDeckTop(game, drawn.id);
    const result = game.drawCard("p1");
    expect(result.playable).toBe(true);
    expect(game.drawnCardId).toBe(drawn.id);

    const otherCard = game.players[0]!.hand.find((card) => card.id !== drawn.id)!;
    expectGameError(
      () => game.playCard("p1", otherCard.id),
      "MUST_PLAY_DRAWN_CARD"
    );
    game.playCard("p1", drawn.id);
    expect(game.discard.at(-1)?.id).toBe(drawn.id);
    game.verify();
  });

  it("ends the turn automatically when the drawn card cannot be played", () => {
    const game = makeGame(2);
    const drawn = cardOfKind(game, "number", "red", 5);
    const top = cardOfKind(game, "number", "blue", 9);
    setCurrent(game, 0);
    setTop(game, top.id, "blue");
    putOnDeckTop(game, drawn.id);
    const before = game.players[0]!.hand.length;

    const result = game.drawCard("p1");

    expect(result.playable).toBe(false);
    expect(game.players[0]!.hand).toHaveLength(before + 1);
    expect(game.currentPlayerId).toBe("p2");
    game.verify();
  });

  it("recycles the discard pile while preserving its top card", () => {
    const game = makeGame(2);
    moveDeckToPlayer(game, 1);
    const top = game.discard.at(-1)!;
    const extra1 = game.players[1]!.hand.pop()!;
    const extra2 = game.players[1]!.hand.pop()!;
    game.discard.push(extra1, extra2);
    game.deck = [];

    const result = game.drawInto(game.players[0]!, 1);

    expect(result.shortage).toBe(0);
    expect(result.recycled).toBe(2);
    expect(game.discard).toHaveLength(1);
    expect(game.discard[0]?.id).toBe(extra2.id);
    expect(game.discard[0]?.id).not.toBe(top.id);
    game.verify();
  });

  it("keeps a previously played +10 permanently out of the draw pile", () => {
    const game = makeGame(2);
    moveDeckToPlayer(game, 1);
    const plus10 = extractCard(game, game.plus10CardId);
    game.discard.splice(game.discard.length - 1, 0, plus10);
    const extra = game.players[1]!.hand.pop()!;
    game.discard.push(extra);
    game.deck = [];

    game.drawInto(game.players[0]!, 1);

    expect(game.discard.some((card) => card.id === game.plus10CardId)).toBe(true);
    expect(game.deck.some((card) => card.id === game.plus10CardId)).toBe(false);
    expect(game.players.flatMap((player) => player.hand).some((card) => card.id === game.plus10CardId)).toBe(false);
    expect(game.discard.at(-1)?.id).toBe(extra.id);
    game.verify();
  });
});

describe("+10 card", () => {
  it("moves one server-generated +10 card from hand to discard", () => {
    const game = makeGame(2);
    const plus10 = cardOfKind(game, "wild10");
    setHand(game, 0, [
      plus10,
      cardOfKind(game, "number", "blue", 5),
      cardOfKind(game, "number", "green", 5)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    setCurrent(game, 0);
    game.direction = 1;
    const before = game.players[1]!.hand.length;

    game.playCard("p1", plus10.id);

    expect(game.discard.at(-1)?.id).toBe(plus10.id);
    expect(game.players[0]!.hand.some((card) => card.id === plus10.id)).toBe(false);
    expect(game.deck.some((card) => card.id === plus10.id)).toBe(false);
    expect(game.players[1]!.hand).toHaveLength(before + 10);
    expect(["red", "yellow", "green", "blue"]).toContain(game.currentColor);
    expect(game.currentPlayerId).toBe("p1");
    expect(game.publicView("p1").currentColor).toBe(game.currentColor);
    expect(game.publicView("p2").currentColor).toBe(game.currentColor);
    game.verify();
  });

  it("draws as many cards as possible and never duplicates when the deck cannot supply 10", () => {
    const game = makeGame(2);
    moveDeckToPlayer(game, 1);
    const plus10 = cardOfKind(game, "wild10");
    setHand(game, 0, [
      plus10,
      cardOfKind(game, "number", "blue", 5),
      cardOfKind(game, "number", "green", 5)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    moveDeckToPlayer(game, 1);
    setCurrent(game, 0);
    game.direction = 1;
    const before = game.players[1]!.hand.length;

    game.playCard("p1", plus10.id);

    expect(game.players[1]!.hand.length).toBeLessThan(before + 10);
    expect(game.players[1]!.hand.length).toBeGreaterThanOrEqual(before);
    expect(game.lastEvent?.type).toBe("deck_shortage");
    expect(game.lastEvent?.requestedCount).toBe(10);
    expect(game.lastEvent?.shortage).toBeGreaterThan(0);
    expect(game.currentPlayerId).toBe("p1");
    game.verify();
  });

  it("recycles the discard pile to complete the 10-card penalty", () => {
    const game = makeGame(2);
    moveDeckToPlayer(game, 1);
    const plus10 = cardOfKind(game, "wild10");
    setHand(game, 0, [
      plus10,
      cardOfKind(game, "number", "blue", 5),
      cardOfKind(game, "number", "green", 5)
    ]);
    setTop(game, cardOfKind(game, "number", "red", 9).id, "red");
    moveDeckToPlayer(game, 1);
    const recyclable = game.players[1]!.hand.splice(0, 29);
    game.discard.splice(game.discard.length - 1, 0, ...recyclable);
    setCurrent(game, 0);
    game.direction = 1;
    const targetBefore = game.players[1]!.hand.length;

    game.playCard("p1", plus10.id);

    expect(game.lastEvent?.drawnCount).toBe(10);
    expect(game.lastEvent?.shortage ?? 0).toBe(0);
    expect(game.players[1]!.hand).toHaveLength(targetBefore + 10);
    expect(game.discard).toHaveLength(1);
    expect(game.discard[0]?.id).toBe(plus10.id);
    expect(game.deck.length).toBeGreaterThan(0);
    game.verify();
  });
});
