/**
 * The player's own deck, shared by Players vs Players and the vs-computer page: the deck rules, quick fill, starting from a preset deck,
 * and keeping the deck in this browser (per account) so it survives a reload. The server checks the same rules for Players vs Players and
 * has the last word.
 */
import { useEffect, useState } from "react";
import { deckCards, type PresetDeck } from "../shared/ai/decks.ts";
import type { CardRecord } from "./cards.ts";

/** Deck rules from the rule manual ("Decks"): exactly 50 cards plus three AP cards, one source material code, at most four copies per card number,
 * at most four cards for each of the 特殊 / 色彩 / 最终 trigger types. */
export const DECK_SIZE = 50;
export const AP_COUNT = 3;
export const MAX_COPIES = 4;
const LIMITED_TRIGGERS: readonly string[] = ["特殊", "色彩", "最终"];

const storageKey = (accountId: string): string => `ua-deck:${accountId}`;

function loadDeck(accountId: string): ReadonlyMap<string, number> {
  try {
    const ids = JSON.parse(localStorage.getItem(storageKey(accountId)) ?? "[]") as unknown;
    const deck = new Map<string, number>();
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") deck.set(id, (deck.get(id) ?? 0) + 1);
    return deck;
  } catch { return new Map(); }
}

export interface DeckState {
  deck: ReadonlyMap<string, number>;
  /** The deck as a sorted "id x copies" list, to tell whether it changed since it was submitted. */
  key: string;
  total: number;
  /** All 50 card ids, in the deck's order. */
  cardIds: string[];
  /** The deck's work (source material code), once it has a card. */
  source: string | null;
  /** 50 cards that keep every rule. */
  complete: boolean;
  canAdd: (card: CardRecord) => boolean;
  setCopies: (card: CardRecord, copies: number) => void;
  clear: () => void;
  /** Tops the deck up to 50 with four copies of each card number in catalog order, from the deck's work (or `fallback`'s). */
  quickFill: (fallback?: CardRecord | null) => void;
  /** Replaces the deck with a preset deck. */
  fromPreset: (preset: PresetDeck) => void;
}

export function useDeck(cards: readonly CardRecord[], cardsById: ReadonlyMap<string, CardRecord>, accountId: string): DeckState {
  const [deck, setDeck] = useState<ReadonlyMap<string, number>>(() => loadDeck(accountId));
  useEffect(() => {
    try { localStorage.setItem(storageKey(accountId), JSON.stringify([...deck].flatMap(([id, copies]) => Array<string>(copies).fill(id)))); } catch { /* not kept */ }
  }, [deck, accountId]);

  const key = [...deck].filter(([, copies]) => copies > 0).map(([id, copies]) => `${id}x${copies}`).sort().join(",");
  const total = [...deck.values()].reduce((sum, copies) => sum + copies, 0);
  const numberCopies = new Map<string, number>();
  const triggerCopies = new Map<string, number>();
  let source: string | null = null;
  let unknown = false;
  for (const [id, copies] of deck) {
    const card = cardsById.get(id);
    if (!card) { unknown = cards.length > 0; continue; }
    if (copies <= 0) continue;
    numberCopies.set(card.number, (numberCopies.get(card.number) ?? 0) + copies);
    const trigger = card.stats?.trigger?.label;
    if (trigger) triggerCopies.set(trigger, (triggerCopies.get(trigger) ?? 0) + copies);
    source ??= card.sourceMaterialCode;
  }
  const triggerFull = (card: CardRecord, triggers: ReadonlyMap<string, number>): boolean => {
    const label = card.stats?.trigger?.label;
    return label !== undefined && LIMITED_TRIGGERS.includes(label) && (triggers.get(label) ?? 0) >= MAX_COPIES;
  };
  const canAdd = (card: CardRecord): boolean =>
    card.imageAvailable && total < DECK_SIZE && (numberCopies.get(card.number) ?? 0) < MAX_COPIES && (source === null || source === card.sourceMaterialCode) && !triggerFull(card, triggerCopies);
  const complete = total === DECK_SIZE && !unknown && [...numberCopies.values()].every((copies) => copies <= MAX_COPIES)
    && LIMITED_TRIGGERS.every((label) => (triggerCopies.get(label) ?? 0) <= MAX_COPIES)
    && new Set([...deck.keys()].map((id) => cardsById.get(id)?.sourceMaterialCode)).size === 1;

  const setCopies = (card: CardRecord, copies: number): void => {
    const next = new Map(deck);
    if (copies > 0) next.set(card.id, copies); else next.delete(card.id);
    setDeck(next);
  };
  const quickFill = (fallback?: CardRecord | null): void => {
    const work = source ?? fallback?.sourceMaterialCode ?? cards.find((card) => card.imageAvailable)?.sourceMaterialCode;
    if (!work) return;
    const next = new Map(deck);
    const numbers = new Map(numberCopies);
    const triggers = new Map(triggerCopies);
    let count = total;
    for (const card of cards) {
      if (count >= DECK_SIZE) break;
      if (!card.imageAvailable || card.sourceMaterialCode !== work) continue;
      const have = numbers.get(card.number) ?? 0;
      const label = card.stats?.trigger?.label;
      const triggerRoom = label && LIMITED_TRIGGERS.includes(label) ? MAX_COPIES - (triggers.get(label) ?? 0) : MAX_COPIES;
      const add = Math.min(MAX_COPIES - have, DECK_SIZE - count, triggerRoom);
      if (add <= 0) continue;
      next.set(card.id, (next.get(card.id) ?? 0) + add);
      numbers.set(card.number, have + add);
      if (label) triggers.set(label, (triggers.get(label) ?? 0) + add);
      count += add;
    }
    setDeck(next);
  };
  const fromPreset = (preset: PresetDeck): void => {
    const next = new Map<string, number>();
    for (const id of deckCards(preset)) next.set(id, (next.get(id) ?? 0) + 1);
    setDeck(next);
  };
  return {
    deck, key, total, source, complete, canAdd, setCopies, quickFill, fromPreset,
    cardIds: [...deck].flatMap(([id, copies]) => Array<string>(copies).fill(id)),
    clear: () => setDeck(new Map())
  };
}
