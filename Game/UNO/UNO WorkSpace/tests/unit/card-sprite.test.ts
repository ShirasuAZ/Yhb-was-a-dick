import { describe, expect, it } from "vitest";
import type { Card, CardColor, CardKind } from "../../shared/protocol.ts";
import {
  UNO_DECK_SPRITE,
  UNO_PLUS10_IMAGE,
  cardSpritePosition
} from "../../client/src/components/cardSprite.ts";

function card(
  kind: CardKind,
  color: CardColor | null,
  value?: number
): Card {
  return {
    id: `${kind}-${color}-${value ?? "x"}`,
    kind,
    color,
    ...(value === undefined ? {} : { value })
  };
}

describe("card sprite mapping", () => {
  it("maps number cards to the source deck rows and columns", () => {
    expect(cardSpritePosition(card("number", "red", 0))).toMatchObject({
      src: UNO_DECK_SPRITE,
      row: 0,
      col: 0,
      cols: 14,
      rows: 8
    });
    expect(cardSpritePosition(card("number", "yellow", 9))).toMatchObject({
      row: 1,
      col: 9
    });
    expect(cardSpritePosition(card("number", "green", 5))).toMatchObject({
      row: 2,
      col: 5
    });
    expect(cardSpritePosition(card("number", "blue", 1))).toMatchObject({
      row: 3,
      col: 1
    });
  });

  it("maps action cards to columns 10, 11, and 12", () => {
    expect(cardSpritePosition(card("skip", "green"))).toMatchObject({
      row: 2,
      col: 10
    });
    expect(cardSpritePosition(card("reverse", "blue"))).toMatchObject({
      row: 3,
      col: 11
    });
    expect(cardSpritePosition(card("draw2", "red"))).toMatchObject({
      row: 0,
      col: 12
    });
  });

  it("maps wild cards and the standalone +10 image", () => {
    expect(cardSpritePosition(card("wild", null))).toMatchObject({
      src: UNO_DECK_SPRITE,
      row: 0,
      col: 13
    });
    expect(cardSpritePosition(card("wild4", null))).toMatchObject({
      src: UNO_DECK_SPRITE,
      row: 4,
      col: 13
    });
    expect(cardSpritePosition(card("wild10", null))).toEqual({
      src: UNO_PLUS10_IMAGE,
      row: 0,
      col: 0,
      cols: 1,
      rows: 1
    });
  });
});
