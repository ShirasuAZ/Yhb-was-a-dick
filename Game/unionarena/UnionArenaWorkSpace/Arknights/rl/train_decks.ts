/**
 * Decks for training and evaluation, in the image-free catalog's id space (a card's id is its card number; see title-catalog.ts).
 *
 * `randomTitleDeck` builds a random legal deck of ONE title (a deck may only hold one source material code) from the cards the engine
 * plays entirely by itself: one or two of the title's colours, at most four copies per card number and four of each 特殊 / 色彩 / 最终
 * trigger, with about a quarter of the deck needing no energy so it can get going. Games between two such decks are usually between two
 * different titles, which the game allows.
 */
import { nextRandom, randomInt, shuffle, type Rng } from "../src/shared/ai/match.ts";
import { PRESET_DECKS, deckCards } from "../src/shared/ai/decks.ts";
import { UNION_ARENA_CATALOG } from "../src/server/catalog.ts";
import { IPS, type IpId } from "../src/shared/ips.ts";
import { TITLE_CARDS, titleContext, automatedCards, type TitleCard } from "./title-catalog.ts";

const LIMITED_TRIGGERS = ["特殊", "色彩", "最终"];

/** Preset decks as card numbers. A preset whose card records this machine does not know (a title without its `_index.csv`) is left out. */
export const PRESET_NUMBER_DECKS: readonly string[][] = (() => {
  const numberOf = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card.number]));
  const decks: string[][] = [];
  for (const preset of PRESET_DECKS) {
    const numbers = deckCards(preset).map((id) => numberOf.get(id));
    if (numbers.every((number): number is string => !!number)) decks.push(numbers);
  }
  return decks;
})();

/** A random preset deck (as card numbers). */
export const presetNumberDeck = (rng: Rng): string[] => [...PRESET_NUMBER_DECKS[randomInt(rng, PRESET_NUMBER_DECKS.length)]!];

/**
 * A character the data gives neither a required energy nor any energy generation (EVA's red cards are listed as yellow, cost 0, no energy
 * icon): its numbers are wrong, so random decks leave it out rather than learn from free cards that can never pay for anything.
 */
const dataLooksBroken = (card: TitleCard): boolean =>
  card.stats.type === "character" && card.stats.energyCost === 0 && card.stats.energyGen === 0 && !card.stats.energyGenColor;

/** The titles that have enough automated cards to build decks from (at least 25 automated characters). */
export function playableTitles(): IpId[] {
  return IPS.map((ip) => ip.id).filter((id) => automatedCards(id).filter((card) => card.stats.type === "character" && !dataLooksBroken(card)).length >= 25);
}

/** Whether `deck` keeps the deck rules (50 cards, four copies at most, one work, four of each limited trigger at most). */
export function deckIsLegal(deck: readonly string[]): boolean {
  if (deck.length !== 50) return false;
  const copies = new Map<string, number>();
  const triggers = new Map<string, number>();
  const works = new Set<string>();
  for (const number of deck) {
    const card = TITLE_CARDS.find((entry) => entry.id === number);
    if (!card) return false;
    copies.set(number, (copies.get(number) ?? 0) + 1);
    works.add(card.work);
    const label = titleContext.card(number)?.trigger?.label ?? "";
    if (LIMITED_TRIGGERS.includes(label)) triggers.set(label, (triggers.get(label) ?? 0) + 1);
  }
  return works.size === 1 && [...copies.values()].every((count) => count <= 4) && [...triggers.values()].every((count) => count <= 4);
}

/** A random legal deck of one title (a random preset deck in the unlikely case the random one breaks a rule). */
export function randomTitleDeck(rng: Rng, titles: readonly IpId[] = playableTitles()): string[] {
  const ip = titles[randomInt(rng, titles.length)]!;
  const pool: TitleCard[] = automatedCards(ip).filter((card) => !dataLooksBroken(card));
  const colors = [...new Set(pool.map((card) => card.stats.color))];
  const chosen = shuffle(rng, colors).slice(0, nextRandom(rng) < 0.4 ? 1 : 2);
  const candidates = shuffle(rng, pool.filter((card) => chosen.includes(card.stats.color)));
  const deck: string[] = [];
  const triggers: Record<string, number> = {};
  const add = (card: TitleCard, count: number): void => {
    const label = titleContext.card(card.id)?.trigger?.label ?? "";
    const limited = LIMITED_TRIGGERS.includes(label);
    const room = Math.min(count, 50 - deck.length, limited ? 4 - (triggers[label] ?? 0) : count);
    for (let index = 0; index < room; index += 1) deck.push(card.id);
    if (limited) triggers[label] = (triggers[label] ?? 0) + Math.max(0, room);
  };
  for (const card of candidates.filter((entry) => entry.stats.type === "character" && entry.stats.energyCost === 0).slice(0, 3)) add(card, 4);
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
  if (deckIsLegal(deck)) return deck;
  return PRESET_NUMBER_DECKS.length ? presetNumberDeck(rng) : deck;
}

/** The deck a training / evaluation game gives a side: a random deck of a random title with probability `randomShare`, else a preset deck. */
export function pickDeck(rng: Rng, randomShare: number): string[] {
  return nextRandom(rng) < randomShare || !PRESET_NUMBER_DECKS.length ? randomTitleDeck(rng) : presetNumberDeck(rng);
}
