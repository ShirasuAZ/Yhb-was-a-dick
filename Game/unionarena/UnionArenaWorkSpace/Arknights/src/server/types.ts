import type { UnionArenaCardStats } from "../shared/protocol.ts";
import { ipName, ipOfNumber, type IpId } from "../shared/ips.ts";

export interface UnionArenaCardRecord {
  id: string;
  number: string;
  name: string;
  rarity: string;
  file: string;
  /**
   * The card's printed work code (`ARK`, `AOT`, …), taken from the card number. Kept for the deck rule that a deck uses
   * one work; `ipId` below is the same fact as a title the client can name.
   */
  sourceMaterialCode: string;
  /** The title this card belongs to, derived from the card number. Null when the number carries an unknown code. */
  ipId: IpId | null;
  parallelIds: string[];
  imageAvailable: boolean;
  /** Printed data from Cards/cards.json, shared by every print of the card number; null when not transcribed. */
  stats: UnionArenaCardStats | null;
}

/** Trigger types limited to four cards each per deck (rule manual, "Decks"). */
export const LIMITED_TRIGGERS = ["特殊", "色彩", "最终"] as const;

export interface DeckCheck {
  structuralOk: boolean;
  issues: string[];
}

/**
 * The deck rules from the rule manual ("Decks"), checked on the server: 50 main cards plus 3 AP cards, one work, at
 * most four copies per card number (parallel art shares a number, so it cannot be used to go over the limit), and at
 * most four cards for each 特殊 / 色彩 / 最终 trigger.
 *
 * `declaredIpId` is what the client says the deck is for. It is only ever a check against the cards themselves — the
 * cards decide, and a deck whose cards disagree with the declaration is refused rather than silently re-labelled.
 */
export function checkUnionArenaDeck(
  cardIds: readonly string[],
  apCount: number,
  catalog: readonly UnionArenaCardRecord[],
  availableIds: ReadonlySet<string> = new Set(catalog.filter((card) => card.imageAvailable).map((card) => card.id)),
  declaredIpId?: IpId | null
): DeckCheck {
  const issues: string[] = [];
  if (cardIds.length !== 50) issues.push(`主牌组为 ${cardIds.length}/50 张`);
  if (apCount !== 3) issues.push(`AP 卡为 ${apCount}/3 张`);
  const byId = new Map(catalog.map((card) => [card.id, card]));
  const counts = new Map<string, number>();
  const works = new Set<string>();
  const titles = new Set<IpId>();
  let unknownTitle = 0;
  for (const id of cardIds) {
    const card = byId.get(id);
    if (!card || !availableIds.has(id)) {
      issues.push(`卡牌记录 ${id} 无法使用`);
      continue;
    }
    counts.set(card.number, (counts.get(card.number) ?? 0) + 1);
    works.add(card.sourceMaterialCode);
    if (card.ipId) titles.add(card.ipId);
    else unknownTitle += 1;
  }
  if (works.size > 1) issues.push("同一副牌不能混用不同作品代码");
  if (titles.size > 1) issues.push(`同一副牌不能混用不同 IP：${[...titles].map((id) => ipName(id)).join("、")}`);
  if (unknownTitle > 0) issues.push(`有 ${unknownTitle} 张卡牌的作品无法识别，不能用于牌组`);
  if (declaredIpId && titles.size === 1 && !titles.has(declaredIpId)) {
    issues.push(`牌组所属 IP 为${ipName([...titles][0])}，与提交的${ipName(declaredIpId)}不一致`);
  }
  for (const [number, count] of counts) {
    if (count > 4) issues.push(`${number} 共投入 ${count} 张，超过同卡号 4 张上限`);
  }
  for (const label of LIMITED_TRIGGERS) {
    const count = cardIds.filter((id) => byId.get(id)?.stats?.trigger?.label === label).length;
    if (count > 4) issues.push(`【${label}】触发的卡共 ${count} 张，超过每种 4 张上限`);
  }
  return { structuralOk: issues.length === 0, issues };
}

/** One title's contribution to the catalog: its index rows, its card data keyed by number, and its image files. */
export interface UnionArenaTitleSource {
  rows: Array<{ id: string; number: string; name: string; rarity: string; file: string }>;
  statsByNumber: ReadonlyMap<string, UnionArenaCardStats>;
  availableFiles: ReadonlySet<string>;
}
/**
 * One catalog out of every title's rows. The card's own number decides its title, so a row cannot be filed under the
 * wrong title by a caller.
 */
export function buildUnionArenaCatalog(
  rows: Array<Omit<UnionArenaCardRecord, "parallelIds" | "sourceMaterialCode" | "ipId" | "imageAvailable" | "stats">>,
  availableFiles: ReadonlySet<string>,
  statsByNumber: ReadonlyMap<string, UnionArenaCardStats> = new Map()
): UnionArenaCardRecord[] {
  return assembleCatalog([{ rows, statsByNumber, availableFiles }]);
}

/** Merges several titles' sources into one catalog, keeping each title's own image availability and card data. */
export function assembleCatalog(sources: readonly UnionArenaTitleSource[]): UnionArenaCardRecord[] {
  const groups = new Map<string, string[]>();
  const records: UnionArenaCardRecord[] = [];
  for (const source of sources) {
    for (const row of source.rows) {
      groups.set(row.number, [...(groups.get(row.number) ?? []), row.id]);
      records.push({
        ...row,
        sourceMaterialCode: row.number.split("/")[1]?.split("-")[0] ?? "",
        ipId: ipOfNumber(row.number),
        parallelIds: [],
        imageAvailable: source.availableFiles.has(row.file),
        stats: source.statsByNumber.get(row.number) ?? null
      });
    }
  }
  for (const record of records) record.parallelIds = groups.get(record.number) ?? [record.id];
  return records;
}
