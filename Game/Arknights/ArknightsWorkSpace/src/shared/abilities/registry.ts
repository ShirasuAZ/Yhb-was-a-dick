/** Joins the card catalog with the ability table into the rules engine's view of the cards. */
import type { UnionArenaCardStats } from "../protocol.ts";
import type { EngineCard, EngineContext } from "../engine.ts";
import { CARD_ABILITIES } from "./cards.ts";

export interface CatalogCard { stats: UnionArenaCardStats | null; name: string; number: string; }

/** Abilities the engine runs for a card number, if any. */
export function abilitiesFor(number: string): EngineCard["abilities"] {
  return CARD_ABILITIES[number];
}

/**
 * Whether the engine plays a card entirely by itself: no ability text beyond keyword lines, or an entry in the ability table. Only such
 * cards can be used by the computer players.
 */
export function isAutomated(card: CatalogCard): boolean {
  if (!card.stats) return false;
  if (CARD_ABILITIES[card.number]) return true;
  return card.stats.abilityText.split("\n").map((line) => line.trim()).filter(Boolean).every((line) => /^《[^》]+》（[^）]*）$/.test(line));
}

/** The engine context for a catalog: printed data, name, number and abilities by card id (looked up once per id). */
export function cardContext(get: (cardId: string) => CatalogCard | undefined): EngineContext {
  const cache = new Map<string, EngineCard | null>();
  return {
    card(cardId) {
      const cached = cache.get(cardId);
      if (cached !== undefined) return cached;
      const record = get(cardId);
      const value: EngineCard | null = record?.stats ? { ...record.stats, name: record.name, number: record.number, abilities: CARD_ABILITIES[record.number] } : null;
      cache.set(cardId, value);
      return value;
    }
  };
}
