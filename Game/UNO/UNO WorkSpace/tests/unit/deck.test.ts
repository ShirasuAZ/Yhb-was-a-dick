import { describe, expect, it } from "vitest";
import {
  GAME_CARD_COUNT,
  STANDARD_CARD_COUNT,
  createDeck
} from "../../server/game/deck.ts";

describe("deck construction", () => {
  it("builds the standard 108-card deck plus one unique +10 card", () => {
    const deck = createDeck("deck-test", () => "unique-1");
    expect(deck.cards).toHaveLength(GAME_CARD_COUNT);
    expect(GAME_CARD_COUNT).toBe(109);

    const standard = deck.cards.filter((card) => card.kind !== "wild10");
    expect(standard).toHaveLength(STANDARD_CARD_COUNT);
    expect(new Set(deck.cards.map((card) => card.id)).size).toBe(109);

    for (const color of ["red", "yellow", "green", "blue"] as const) {
      const colored = standard.filter((card) => card.color === color);
      expect(colored).toHaveLength(25);
      expect(colored.filter((card) => card.kind === "number")).toHaveLength(19);
      expect(
        colored.filter((card) => card.kind === "skip")
      ).toHaveLength(2);
      expect(
        colored.filter((card) => card.kind === "reverse")
      ).toHaveLength(2);
      expect(
        colored.filter((card) => card.kind === "draw2")
      ).toHaveLength(2);
      expect(
        colored.filter(
          (card) => card.kind === "number" && card.value === 0
        )
      ).toHaveLength(1);
      for (let value = 1; value <= 9; value += 1) {
        expect(
          colored.filter(
            (card) => card.kind === "number" && card.value === value
          )
        ).toHaveLength(2);
      }
    }
    expect(standard.filter((card) => card.kind === "wild")).toHaveLength(4);
    expect(standard.filter((card) => card.kind === "wild4")).toHaveLength(4);

    const plus10 = deck.cards.filter((card) => card.kind === "wild10");
    expect(plus10).toHaveLength(1);
    expect(plus10[0]?.id).toBe(deck.plus10CardId);
    expect(plus10[0]?.id).toBe("deck-test:plus10:unique-1");
    expect(plus10[0]?.color).toBeNull();
  });
});
