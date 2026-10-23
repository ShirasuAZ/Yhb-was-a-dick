export interface UnionArenaCardRecord {
  id: string;
  number: string;
  name: string;
  rarity: string;
  file: string;
  sourceMaterialCode: string;
  parallelIds: string[];
  imageAvailable: boolean;
}

export interface DeckCheck {
  structuralOk: boolean;
  issues: string[];
}

export function checkUnionArenaDeck(
  cardIds: readonly string[],
  apCount: number,
  catalog: readonly UnionArenaCardRecord[],
  availableIds: ReadonlySet<string> = new Set(catalog.filter((card) => card.imageAvailable).map((card) => card.id))
): DeckCheck {
  const issues: string[] = [];
  if (cardIds.length !== 50) issues.push(`主牌组为 ${cardIds.length}/50 张`);
  if (apCount !== 3) issues.push(`AP 卡为 ${apCount}/3 张`);
  const byId = new Map(catalog.map((card) => [card.id, card]));
  const counts = new Map<string, number>();
  const sources = new Set<string>();
  for (const id of cardIds) {
    const card = byId.get(id);
    if (!card || !availableIds.has(id)) {
      issues.push(`卡牌记录 ${id} 无法使用`);
      continue;
    }
    counts.set(card.number, (counts.get(card.number) ?? 0) + 1);
    sources.add(card.sourceMaterialCode);
  }
  if (sources.size > 1) issues.push("同一副牌不能混用不同作品代码");
  for (const [number, count] of counts) {
    if (count > 4) issues.push(`${number} 共投入 ${count} 张，超过同卡号 4 张上限`);
  }
  return { structuralOk: issues.length === 0, issues };
}

export function buildUnionArenaCatalog(
  rows: Array<Omit<UnionArenaCardRecord, "parallelIds" | "sourceMaterialCode" | "imageAvailable">>,
  availableFiles: ReadonlySet<string>
): UnionArenaCardRecord[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) groups.set(row.number, [...(groups.get(row.number) ?? []), row.id]);
  return rows.map((row) => ({
    ...row,
    sourceMaterialCode: row.number.split("/")[1]?.split("-")[0] ?? "",
    parallelIds: groups.get(row.number) ?? [],
    imageAvailable: availableFiles.has(row.file)
  }));
}
