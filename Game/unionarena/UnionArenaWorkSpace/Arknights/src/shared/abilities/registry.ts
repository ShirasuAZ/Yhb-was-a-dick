/** Joins the card catalog with the ability table into the rules engine's view of the cards. */
import type { UnionArenaCardStats } from "../protocol.ts";
import type { EngineCard, EngineContext } from "../engine.ts";
import { CARD_ABILITIES } from "./cards.ts";
import { canonicalKeywords, unimplementedKeywords } from "../keywords.ts";

export interface CatalogCard { stats: UnionArenaCardStats | null; name: string; number: string; }

/** Abilities the engine runs for a card number, if any. */
export function abilitiesFor(number: string): EngineCard["abilities"] {
  return CARD_ABILITIES[number];
}

/** Whether a printed line is nothing but a keyword with its reminder text, e.g. 《冲击无效》（…）or 《Nullify Impact》(…). */
const KEYWORD_LINE = /^《[^》]+》\s*(?:（[^）]*）|\([^)]*\))?$/;

/**
 * Whether the engine plays a card entirely by itself: no ability text beyond keyword lines, or an entry in the ability
 * table. Only such cards can be used by the computer players.
 *
 * A keyword counts as handled only when the engine has an implementation of it: a card printing a keyword the engine
 * does not know (e.g. 《During Your Turn》), or printing one without its reminder text, is not automatic — the computer
 * would otherwise ignore part of what the card says.
 */
export function isAutomated(card: CatalogCard): boolean {
  if (!card.stats) return false;
  if (CARD_ABILITIES[card.number]) return true;
  const lines = card.stats.abilityText.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.every((line) => KEYWORD_LINE.test(line))) return false;
  // Every printed keyword must map onto one the engine implements.
  const printed = card.stats.keywords;
  if (unimplementedKeywords(printed).length > 0) return false;
  return canonicalKeywords(printed).length === printed.length;
}

/** The engine context for a catalog: printed data, name, number and abilities by card id (looked up once per id). */
export function cardContext(get: (cardId: string) => CatalogCard | undefined): EngineContext {
  const cache = new Map<string, EngineCard | null>();
  return {
    card(cardId) {
      const cached = cache.get(cardId);
      if (cached !== undefined) return cached;
      const record = get(cardId);
      // Printed keywords are normalized to the spelling the engine compares against (冲击① -> 冲击1, Impact (1) -> 冲击1).
      const value: EngineCard | null = record?.stats
        ? { ...record.stats, keywords: canonicalKeywords(record.stats.keywords), name: record.name, number: record.number, abilities: CARD_ABILITIES[record.number] }
        : null;
      cache.set(cardId, value);
      return value;
    }
  };
}
