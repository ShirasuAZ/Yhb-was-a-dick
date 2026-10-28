/**
 * Random legal decks for training and agent games: one or two colours from the fully automated cards, at most four copies per card number
 * and four of each 特殊 / 色彩 / 最终 trigger, with about a quarter of the deck needing no energy so the deck can get going.
 */
import { nextRandom, randomInt, shuffle, type Rng } from "../src/shared/ai/match.ts";
import { deckCards, PRESET_DECKS } from "../src/shared/ai/decks.ts";
import { UNION_ARENA_CATALOG } from "../src/server/catalog.ts";
import { checkUnionArenaDeck } from "../src/server/types.ts";
import { isAutomated } from "../src/shared/abilities/registry.ts";

/** One card id per automated card number. */
const POOL = [...new Map(UNION_ARENA_CATALOG.filter((card) => card.imageAvailable && card.stats && isAutomated(card)).map((card) => [card.number, card])).values()];
const COLORS = ["yellow", "red", "blue", "purple"] as const;
const LIMITED_TRIGGERS = ["特殊", "色彩", "最终"];

/** A legal 50-card deck (a preset deck in the unlikely case the random one breaks a rule). */
export function randomDeck(rng: Rng): string[] {
  const colors = shuffle(rng, COLORS).slice(0, nextRandom(rng) < 0.4 ? 1 : 2);
  const candidates = shuffle(rng, POOL.filter((card) => colors.includes(card.stats!.color as (typeof COLORS)[number])));
  const deck: string[] = [];
  const triggers: Record<string, number> = {};
  const add = (card: (typeof POOL)[number], copies: number): void => {
    const label = card.stats!.trigger?.label ?? "";
    const allowed = LIMITED_TRIGGERS.includes(label) ? Math.min(copies, 4 - (triggers[label] ?? 0)) : copies;
    const count = Math.min(allowed, 50 - deck.length);
    for (let index = 0; index < count; index += 1) deck.push(card.id);
    if (LIMITED_TRIGGERS.includes(label)) triggers[label] = (triggers[label] ?? 0) + Math.max(0, count);
  };
  for (const card of candidates.filter((entry) => entry.stats!.type === "character" && entry.stats!.energyCost === 0).slice(0, 3)) add(card, 4);
  for (const card of candidates) {
    if (deck.length >= 50) break;
    if (deck.includes(card.id)) continue;
    add(card, 2 + randomInt(rng, 3));
  }
  // Too few distinct cards in the colours: top up with copies of what is already there (at most four of each).
  for (const card of candidates) {
    if (deck.length >= 50) break;
    add(card, 4 - deck.filter((id) => id === card.id).length);
  }
  return checkUnionArenaDeck(deck, 3, UNION_ARENA_CATALOG).structuralOk ? deck : deckCards(PRESET_DECKS[randomInt(rng, PRESET_DECKS.length)]!);
}

/** A deck by name: a preset deck id ("rhodes", "lungmen", "reunion", "chernobog") or "random". */
export function deckByName(name: string, rng: Rng): string[] {
  if (name === "random") return randomDeck(rng);
  const preset = PRESET_DECKS.find((deck) => deck.id === name);
  if (!preset) throw new Error(`unknown deck "${name}" (use ${PRESET_DECKS.map((deck) => deck.id).join(", ")} or random)`);
  return deckCards(preset);
}
