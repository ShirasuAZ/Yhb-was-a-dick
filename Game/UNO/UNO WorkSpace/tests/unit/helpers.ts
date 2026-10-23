import { UnoGame } from "../../server/game/game.ts";
import { createDeck, type BuiltDeck } from "../../server/game/deck.ts";
import type { Card, CardKind } from "../../shared/protocol.ts";

export const IDENTITY_RANDOM = (): number => 0.999999;

export function seededRandom(seed = 123456789): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

export function makePlayers(count: number): Array<{ id: string; name: string }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `玩家${index + 1}`
  }));
}

export function makeGame(count = 2, random = seededRandom()): UnoGame {
  return new UnoGame(makePlayers(count), {
    gameKey: "test-game",
    random,
    createId: () => "fixed-plus10-id"
  });
}

export function cardOfKind(
  game: UnoGame,
  kind: CardKind,
  color?: Card["color"],
  value?: number
): Card {
  const card = allCards(game).find(
    (candidate) =>
      candidate.kind === kind &&
      (color === undefined || candidate.color === color) &&
      (value === undefined || candidate.value === value)
  );
  if (!card) {
    throw new Error(`Unable to find ${kind} card`);
  }
  return card;
}

export function allCards(game: UnoGame): Card[] {
  return [
    ...game.deck,
    ...game.discard,
    ...game.players.flatMap((player) => player.hand)
  ];
}

export function extractCard(game: UnoGame, cardId: string): Card {
  for (const player of game.players) {
    const index = player.hand.findIndex((card) => card.id === cardId);
    if (index >= 0) {
      return player.hand.splice(index, 1)[0]!;
    }
  }
  const deckIndex = game.deck.findIndex((card) => card.id === cardId);
  if (deckIndex >= 0) {
    return game.deck.splice(deckIndex, 1)[0]!;
  }
  const discardIndex = game.discard.findIndex((card) => card.id === cardId);
  if (discardIndex >= 0) {
    return game.discard.splice(discardIndex, 1)[0]!;
  }
  throw new Error(`Unable to extract card ${cardId}`);
}

export function setHand(
  game: UnoGame,
  playerIndex: number,
  cards: Card[]
): void {
  const player = game.players[playerIndex]!;
  game.deck.push(...player.hand.splice(0));
  const desiredIds = new Set(cards.map((card) => card.id));
  const extracted = [...desiredIds].map((id) => extractCard(game, id));
  player.hand.push(...extracted);
}

export function setTop(
  game: UnoGame,
  cardId: string,
  color?: Card["color"]
): Card {
  const card = extractCard(game, cardId);
  game.discard.push(card);
  game.currentColor = color ?? card.color ?? game.currentColor;
  return card;
}

export function putOnDeckTop(game: UnoGame, cardId: string): Card {
  const card = extractCard(game, cardId);
  game.deck.push(card);
  return card;
}

export function moveDeckToPlayer(game: UnoGame, playerIndex: number): void {
  game.players[playerIndex]!.hand.push(...game.deck.splice(0));
}

export function setCurrent(game: UnoGame, playerIndex: number): void {
  game.currentIndex = playerIndex;
}

export function buildOrderedDeck(
  openingKind?: CardKind,
  playerCount = 2
): BuiltDeck {
  const built = createDeck("opening-test", () => "opening-plus10");
  if (!openingKind) {
    return built;
  }
  const cards = [...built.cards];
  const openingIndex = cards.length - playerCount * 7 - 1;
  const sourceIndex = cards.findIndex(
    (card) =>
      card.kind === openingKind &&
      (openingKind === "number" || openingKind === "wild" || openingKind === "wild4" || openingKind === "wild10"
        ? true
        : card.color === "red")
  );
  const [opening] = cards.splice(sourceIndex, 1);
  cards.splice(openingIndex, 0, opening!);
  return { ...built, cards };
}

export function cardIds(cards: Card[]): string[] {
  return cards.map((card) => card.id).sort();
}
