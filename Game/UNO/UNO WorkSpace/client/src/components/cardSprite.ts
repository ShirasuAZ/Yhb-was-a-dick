import type { Card, CardColor } from "@shared/protocol.ts";

export const UNO_DECK_SPRITE = "/assets/uno/uno-cards-deck.svg";
export const UNO_PLUS10_IMAGE = "/assets/uno/plus10.svg";
export const UNO_CARD_BACK_IMAGE = "/assets/uno/card-back.svg";

const COLOR_ROW: Record<CardColor, number> = {
  red: 0,
  yellow: 1,
  green: 2,
  blue: 3
};

export interface CardSpritePosition {
  src: string;
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export function cardSpritePosition(card: Card): CardSpritePosition {
  if (card.kind === "wild10") {
    return {
      src: UNO_PLUS10_IMAGE,
      col: 0,
      row: 0,
      cols: 1,
      rows: 1
    };
  }
  if (card.kind === "wild4") {
    return {
      src: UNO_DECK_SPRITE,
      col: 13,
      row: 4,
      cols: 14,
      rows: 8
    };
  }
  const row = card.color ? COLOR_ROW[card.color] : 0;
  let col = 13;
  if (card.kind === "number") {
    col = card.value ?? 0;
  } else if (card.kind === "skip") {
    col = 10;
  } else if (card.kind === "reverse") {
    col = 11;
  } else if (card.kind === "draw2") {
    col = 12;
  }
  return {
    src: UNO_DECK_SPRITE,
    col,
    row,
    cols: 14,
    rows: 8
  };
}
