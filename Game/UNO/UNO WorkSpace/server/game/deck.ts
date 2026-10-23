import { randomInt, randomUUID } from "node:crypto";
import type { Card, CardColor, CardKind } from "../../shared/protocol.ts";

export const COLORS: readonly CardColor[] = ["red", "yellow", "green", "blue"];

export const STANDARD_CARD_COUNT = 108;
export const GAME_CARD_COUNT = 109;
export const HAND_SIZE = 7;

export type RandomSource = () => number;

export function secureRandom(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32;
}

export interface BuiltDeck {
  cards: Card[];
  plus10CardId: string;
  allCardIds: ReadonlySet<string>;
}

export function createDeck(
  gameKey: string,
  createId: () => string = () => randomUUID()
): BuiltDeck {
  const cards: Card[] = [];
  let serial = 0;

  const add = (
    kind: CardKind,
    color: CardColor | null,
    value?: number
  ): Card => {
    serial += 1;
    const card: Card = {
      id: `${gameKey}:card:${String(serial).padStart(3, "0")}`,
      kind,
      color,
      ...(value === undefined ? {} : { value })
    };
    cards.push(card);
    return card;
  };

  for (const color of COLORS) {
    add("number", color, 0);
    for (let value = 1; value <= 9; value += 1) {
      add("number", color, value);
      add("number", color, value);
    }
    for (const kind of ["skip", "reverse", "draw2"] as const) {
      add(kind, color);
      add(kind, color);
    }
  }

  for (let index = 0; index < 4; index += 1) {
    add("wild", null);
  }
  for (let index = 0; index < 4; index += 1) {
    add("wild4", null);
  }

  const plus10Id = `${gameKey}:plus10:${createId()}`;
  const plus10: Card = { id: plus10Id, kind: "wild10", color: null };
  cards.push(plus10);

  if (cards.length !== GAME_CARD_COUNT) {
    throw new Error(`Deck size invariant failed: ${cards.length}`);
  }

  return {
    cards,
    plus10CardId: plus10Id,
    allCardIds: new Set(cards.map((card) => card.id))
  };
}

export function shuffle<T>(items: T[], random: RandomSource): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index];
    const swapped = result[swapIndex];
    if (current === undefined || swapped === undefined) {
      throw new Error("Shuffle index invariant failed");
    }
    result[index] = swapped;
    result[swapIndex] = current;
  }
  return result;
}

export function randomColor(random: RandomSource): CardColor {
  const index = Math.min(3, Math.max(0, Math.floor(random() * COLORS.length)));
  const color = COLORS[index];
  if (!color) {
    throw new Error("Random color invariant failed");
  }
  return color;
}

export function matchesColorOrFace(
  card: Card,
  top: Card,
  currentColor: CardColor
): boolean {
  if (card.kind === "wild" || card.kind === "wild4" || card.kind === "wild10") {
    return true;
  }
  if (card.color === currentColor) {
    return true;
  }
  if (card.kind === "number" && top.kind === "number") {
    return card.value === top.value;
  }
  return card.kind === top.kind && card.kind !== "number";
}

export function isCardPlayable(
  card: Card,
  top: Card,
  currentColor: CardColor,
  _hand: readonly Card[]
): boolean {
  return matchesColorOrFace(card, top, currentColor);
}

export function cardLabel(card: Card): string {
  if (card.kind === "number") {
    return String(card.value);
  }
  switch (card.kind) {
    case "skip":
      return "跳过";
    case "reverse":
      return "反转";
    case "draw2":
      return "+2";
    case "wild":
      return "万能";
    case "wild4":
      return "+4";
    case "wild10":
      return "+10";
  }
}
