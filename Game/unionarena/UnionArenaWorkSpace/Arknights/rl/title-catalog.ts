/**
 * Every title's cards, straight from each title's `Cards/cards.json` — no pictures, no `_index.csv`. For tests and training, which only
 * need the printed data: a card's id here is its card number (unique across titles), so nothing depends on the card art being
 * on this machine (the art is not in the repository).
 *
 * The site's own catalog (src/server/catalog.ts) keeps record ids and pictures; both give the same `cardContext` stats.
 */
import { readFileSync } from "node:fs";
import type { UnionArenaCardStats } from "../src/shared/protocol.ts";
import { IPS, ipOfNumber, type IpId } from "../src/shared/ips.ts";
import { cardContext, isAutomated, type CatalogCard } from "../src/shared/abilities/registry.ts";
import type { EngineContext } from "../src/shared/engine.ts";

export interface TitleCard extends CatalogCard {
  /** The card number, which is also its id here. */
  id: string;
  ipId: IpId;
  /** The card's source material code (the work code in its number), which a deck may only have one of. */
  work: string;
  stats: UnionArenaCardStats;
}

type Entry = UnionArenaCardStats & Record<string, unknown> & { number: string; name: string };

const TITLES_ROOT = new URL("../../", import.meta.url);

/** The cards of the given titles (default: all), one record per card number, in file order. */
export function loadTitleCards(ipIds: readonly IpId[] = IPS.map((ip) => ip.id)): TitleCard[] {
  const cards: TitleCard[] = [];
  for (const ip of IPS) {
    if (!ipIds.includes(ip.id)) continue;
    const file = new URL(`${ip.directory.replaceAll(" ", "%20")}/Cards/cards.json`, TITLES_ROOT);
    let entries: Entry[];
    try { entries = JSON.parse(readFileSync(file, "utf8")) as Entry[]; } catch { continue; }
    const seen = new Set<string>();
    for (const { number, name, works: _works, _goodsId, _image, ...stats } of entries) {
      if (seen.has(number)) continue;
      seen.add(number);
      cards.push({ id: number, number, name, ipId: ipOfNumber(number) ?? ip.id, work: number.slice(number.indexOf("/") + 1).split("-")[0]!, stats: stats as unknown as UnionArenaCardStats });
    }
  }
  return cards;
}

export const TITLE_CARDS: readonly TitleCard[] = loadTitleCards();
const BY_ID = new Map(TITLE_CARDS.map((card) => [card.id, card]));

/** The engine context over every title's cards (card ids are card numbers). */
export const titleContext: EngineContext = cardContext((id) => BY_ID.get(id));

export const titleCard = (number: string): TitleCard => BY_ID.get(number) ?? (() => { throw new Error(`no card ${number}`); })();

/** The cards of one title that the engine plays entirely by itself. */
export function automatedCards(ipId: IpId): TitleCard[] {
  return TITLE_CARDS.filter((card) => card.ipId === ipId && isAutomated(card));
}
