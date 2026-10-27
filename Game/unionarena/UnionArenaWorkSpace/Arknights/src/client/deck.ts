/**
 * The player's own decks, shared by Players vs Players and the vs-computer page: the deck rules, quick fill, starting
 * from a preset deck, and keeping the decks in this browser (per account) so they survive a reload. The server checks
 * the same rules for Players vs Players and has the last word.
 *
 * A player can keep one deck per title (and more than one of a title). Every deck belongs to exactly one title, decided
 * by its cards — a deck never changes title behind the player's back, and switching the title shown in the catalog does
 * not touch a saved deck.
 */
import { useEffect, useMemo, useState } from "react";
import { deckCards, type PresetDeck } from "../shared/ai/decks.ts";
import { DEFAULT_IP_ID, IPS, ipById, ipName, type IpId } from "../shared/ips.ts";
import type { CardRecord } from "./cards.ts";

/** Deck rules from the rule manual ("Decks"): exactly 50 cards plus three AP cards, one title, at most four copies per card number,
 * at most four cards for each the 特殊 / 色彩 / 最终 trigger types. */
export const DECK_SIZE = 50;
export const AP_COUNT = 3;
export const MAX_COPIES = 4;
const LIMITED_TRIGGERS: readonly string[] = ["特殊", "色彩", "最终"];

/** The title a list of cards belongs to, from the cards themselves. Null when empty, mixed, or holding an unknown card. */
export function titleOfCards(cards: readonly CardRecord[]): IpId | null {
  const titles = new Set<IpId>();
  for (const card of cards) {
    if (!card.ipId) return null;
    titles.add(card.ipId);
    if (titles.size > 1) return null;
  }
  return titles.size === 1 ? [...titles][0]! : null;
}

/** One saved deck. `cards` is card id -> copies; every id in it belongs to `ipId`. */
export interface SavedDeck {
  id: string;
  name: string;
  /** Null only for a deck whose cards could not be read (an old deck naming cards this browser cannot load). */
  ipId: IpId | null;
  cards: Readonly<Record<string, number>>;
}

interface StoredDecks {
  version: 2;
  decks: SavedDeck[];
  activeId: string | null;
}

const storageKey = (accountId: string): string => `ua-decks:${accountId}`;
/** The key the single-deck version wrote, kept only so its decks can be migrated. */
const legacyStorageKey = (accountId: string): string => `ua-deck:${accountId}`;

const newDeckId = (): string => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** A deck's cards from a flat id list. */
function countsOf(ids: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

function readLegacy(accountId: string): SavedDeck | null {
  try {
    const ids = JSON.parse(localStorage.getItem(legacyStorageKey(accountId)) ?? "null") as unknown;
    if (!Array.isArray(ids)) return null;
    const cardIds = ids.filter((id): id is string => typeof id === "string");
    if (!cardIds.length) return null;
    return { id: newDeckId(), name: "我的牌组", ipId: null, cards: countsOf(cardIds) };
  } catch { return null; }
}

/**
 * The saved decks, migrated from the old single-deck format when needed. The old format was a bare list of card ids
 * with no title and no name: it becomes one deck, and its title is settled later from the cards themselves (this
 * function runs before the catalog has loaded, so it cannot decide yet). Nothing is deleted while migrating: the old
 * key keeps its value until the first save overwrites the new one.
 */
function loadDecks(accountId: string): StoredDecks {
  try {
    const raw = localStorage.getItem(storageKey(accountId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredDecks>;
      if (parsed && parsed.version === 2 && Array.isArray(parsed.decks)) {
        const decks = parsed.decks.filter((deck): deck is SavedDeck =>
          !!deck && typeof deck.id === "string" && typeof deck.name === "string" && typeof deck.cards === "object" && deck.cards !== null);
        const activeId = decks.some((deck) => deck.id === parsed.activeId) ? parsed.activeId! : (decks[0]?.id ?? null);
        return { version: 2, decks, activeId };
      }
    }
  } catch { /* fall through to the legacy read */ }
  const legacy = readLegacy(accountId);
  return { version: 2, decks: legacy ? [legacy] : [], activeId: legacy?.id ?? null };
}

export interface DeckState {
  /** Every saved deck, in the order the player made them. */
  decks: readonly SavedDeck[];
  /** The deck being built or edited. Null before the player has one. */
  active: SavedDeck | null;
  /** The title of the active deck, once its cards are known. */
  ipId: IpId | null;
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
  /** Switches to another saved deck. */
  selectDeck: (deckId: string) => void;
  /** A new, empty deck for a title (named after it, numbered if that name is taken). Returns its id. */
  createDeck: (ipId: IpId, name?: string) => string;
  /** A deck's title, as shown next to its name. */
  labelOf: (deck: SavedDeck) => string;
}

export function useDeck(cards: readonly CardRecord[], cardsById: ReadonlyMap<string, CardRecord>, accountId: string): DeckState {
  const [stored, setStored] = useState<StoredDecks>(() => loadDecks(accountId));

  // A different account means different decks.
  useEffect(() => { setStored(loadDecks(accountId)); }, [accountId]);

  /**
   * Settles each deck's title from its cards once the catalog is in. A migrated deck starts with no title; it becomes
   * the title of the cards it holds, and a deck that turns out to mix titles is left without one (never silently
   * re-labelled) so the deck rules refuse it and the player sees why.
   */
  useEffect(() => {
    if (!cards.length) return;
    setStored((current) => {
      let changed = false;
      const decks = current.decks.map((deck) => {
        if (deck.ipId) return deck;
        const resolved = titleOfCards(Object.keys(deck.cards).map((id) => cardsById.get(id)).filter((card): card is CardRecord => !!card));
        if (!resolved) return deck;
        changed = true;
        return { ...deck, ipId: resolved };
      });
      return changed ? { ...current, decks } : current;
    });
  }, [cards.length, cardsById]);

  // Keep them in this browser (per account) so a reload does not lose the work.
  useEffect(() => {
    try { localStorage.setItem(storageKey(accountId), JSON.stringify(stored)); } catch { /* not kept */ }
  }, [stored, accountId]);

  const active = stored.decks.find((deck) => deck.id === stored.activeId) ?? stored.decks[0] ?? null;
  const deck: ReadonlyMap<string, number> = useMemo(
    () => new Map(Object.entries(active?.cards ?? {})),
    [active]
  );

  const key = [...deck].filter(([, copies]) => copies > 0).map(([id, copies]) => `${id}x${copies}`).sort().join(",");
  const total = [...deck.values()].reduce((sum, copies) => sum + copies, 0);
  const numberCopies = new Map<string, number>();
  const triggerCopies = new Map<string, number>();
  let source: string | null = null;
  let deckIpId: IpId | null = active?.ipId ?? null;
  let unknown = false;
  for (const [id, copies] of deck) {
    const card = cardsById.get(id);
    if (!card) { unknown = cards.length > 0; continue; }
    if (copies <= 0) continue;
    numberCopies.set(card.number, (numberCopies.get(card.number) ?? 0) + copies);
    const trigger = card.stats?.trigger?.label;
    if (trigger) triggerCopies.set(trigger, (triggerCopies.get(trigger) ?? 0) + copies);
    source ??= card.sourceMaterialCode;
    deckIpId ??= card.ipId;
  }
  const triggerFull = (card: CardRecord, triggers: ReadonlyMap<string, number>): boolean => {
    const label = card.stats?.trigger?.label;
    return label !== undefined && LIMITED_TRIGGERS.includes(label) && (triggers.get(label) ?? 0) >= MAX_COPIES;
  };
  // A card may only join a deck of its own title: the deck's title comes from the cards already in it.
  const canAdd = (card: CardRecord): boolean =>
    card.imageAvailable && total < DECK_SIZE && (numberCopies.get(card.number) ?? 0) < MAX_COPIES
    && (deckIpId === null || deckIpId === card.ipId) && !triggerFull(card, triggerCopies);
  const complete = total === DECK_SIZE && !unknown && [...numberCopies.values()].every((copies) => copies <= MAX_COPIES)
    && LIMITED_TRIGGERS.every((label) => (triggerCopies.get(label) ?? 0) <= MAX_COPIES)
    && new Set([...deck.keys()].map((id) => cardsById.get(id)?.ipId)).size === 1;

  /** Writes the active deck's cards, leaving every other deck untouched. */
  const writeCards = (next: Map<string, number>): void => {
    setStored((current) => {
      const target = current.activeId ?? current.decks[0]?.id ?? null;
      if (!target) {
        // No deck yet: one is made for the card's title, so the first card adds cleanly.
        const created: SavedDeck = { id: newDeckId(), name: "我的牌组", ipId: null, cards: Object.fromEntries(next) };
        return { version: 2, decks: [created], activeId: created.id };
      }
      return {
        ...current,
        decks: current.decks.map((deck) => deck.id === target ? { ...deck, cards: Object.fromEntries(next) } : deck)
      };
    });
  };

  const setCopies = (card: CardRecord, copies: number): void => {
    const next = new Map(deck);
    if (copies > 0) next.set(card.id, copies); else next.delete(card.id);
    writeCards(next);
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
      if (deckIpId !== null && card.ipId !== deckIpId) continue;
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
    writeCards(next);
  };
  const fromPreset = (preset: PresetDeck): void => {
    const next = new Map<string, number>();
    for (const id of deckCards(preset)) next.set(id, (next.get(id) ?? 0) + 1);
    writeCards(next);
  };
  const clear = (): void => writeCards(new Map());

  const selectDeck = (deckId: string): void => {
    setStored((current) => current.decks.some((deck) => deck.id === deckId) ? { ...current, activeId: deckId } : current);
  };
  const createDeck = (ipId: IpId, name?: string): string => {
    const base = name?.trim() || ipName(ipId);
    let candidate = base;
    for (let index = 2; stored.decks.some((deck) => deck.name === candidate); index += 1) candidate = `${base} ${index}`;
    const created: SavedDeck = { id: newDeckId(), name: candidate, ipId, cards: {} };
    setStored((current) => ({ version: 2, decks: [...current.decks, created], activeId: created.id }));
    return created.id;
  };
  /** "牌组名 · 作品名" — the deck list shows both, so a player cannot pick the wrong title's deck. */
  const labelOf = (entry: SavedDeck): string => `${entry.name} · ${entry.ipId ? ipName(entry.ipId) : "作品未定"}`;

  return {
    decks: stored.decks,
    active,
    ipId: active?.ipId ?? null,
    deck, key, total, source,
    complete,
    canAdd, setCopies, quickFill, fromPreset, clear,
    selectDeck, createDeck, labelOf,
    cardIds: [...deck].flatMap(([id, copies]) => Array<string>(copies).fill(id))
  };
}

/** The titles a deck may be made for, in the order the pickers show them. */
export const DECK_TITLES = IPS.map((ip) => ({ id: ip.id, name: ip.name }));
export { DEFAULT_IP_ID };
