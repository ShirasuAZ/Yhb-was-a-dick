/**
 * Printed card terms, normalized for the rules engine.
 *
 * Every UNION ARENA title prints the same keywords, but not with the same glyphs: the Arknights cards show `冲击1`
 * and `伤害2`, while the Japanese-printed cards show `冲击①` and `伤害②`. The engine compares keywords as plain
 * strings, so the circled digits have to become ASCII digits before a keyword can match.
 *
 * This is deliberately a small, explicit table rather than a global text replacement: the ability text a player reads
 * must stay exactly as printed (`abilityText`), and only the keyword tokens are normalized here.
 */

/** Circled digits ①–⑳ as printed on the Japanese cards. */
const CIRCLED_DIGITS: Readonly<Record<string, string>> = {
  "①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5", "⑥": "6", "⑦": "7", "⑧": "8", "⑨": "9", "⑩": "10",
  "⑪": "11", "⑫": "12", "⑬": "13", "⑭": "14", "⑮": "15", "⑯": "16", "⑰": "17", "⑱": "18", "⑲": "19", "⑳": "20"
};

/**
 * Keywords the engine understands, in the spelling it compares against (engine.ts: GRANTABLE_KEYWORDS and impactOf).
 * A printed keyword is mapped onto one of these, or left out entirely when the engine does not implement it.
 */
const CANONICAL_KEYWORDS: readonly string[] = [
  "冲击无效", "冲击1", "冲击2", "冲击3", "冲击+1", "冲击+2",
  "伤害2", "伤害+1", "瞄准攻击", "2次攻击", "2次阻挡", "撤步"
];

/**
 * The same keywords as the official English cards print them. The English text is what the AOT cards carry (that title
 * is only published in English), but the engine compares against the Chinese keywords above, so the English spelling has
 * to land on the same canonical keyword.
 */
const ENGLISH_KEYWORDS: Readonly<Record<string, string>> = {
  "nullify impact": "冲击无效",
  "impact (1)": "冲击1",
  "impact (2)": "冲击2",
  "impact (3)": "冲击3",
  "impact +1": "冲击+1",
  "impact+1": "冲击+1",
  "damage (2)": "伤害2",
  "damage +1": "伤害+1",
  "damage+1": "伤害+1",
  "snipe": "瞄准攻击",
  "double attack": "2次攻击",
  "double block": "2次阻挡",
  "step": "撤步"
};

/** Circled digits to ASCII, for a keyword token only. */
export function normalizeDigits(text: string): string {
  return text.replace(/[①-⑳]/g, (glyph) => CIRCLED_DIGITS[glyph] ?? glyph);
}

/**
 * The engine keyword a printed keyword token means, or null when the engine has no implementation of it.
 *
 * Called with the text inside the printed brackets, e.g. "冲击①" or "冲击无效（与此角色进行战斗的角色…）" — the
 * parenthesised reminder text is dropped before matching. `①`-style digits are normalized first.
 */
export function canonicalKeyword(printed: string): string | null {
  const head = normalizeDigits(printed.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "")).trim();
  if (!head) return null;
  if (CANONICAL_KEYWORDS.includes(head)) return head;
  const english = ENGLISH_KEYWORDS[head.toLowerCase()];
  if (english) return english;
  // "冲击N"-shaped printed keywords are already canonical after the digit normalization, but a card may print a
  // strength the engine folds into the generic keyword (冲击N is read by impactOf via /^冲击(\d+)$/).
  return /^冲击\d+$/.test(head) ? head : null;
}

/** Normalized keywords for a card's printed keyword list. Unknown ones are dropped: the engine cannot act on them. */
export function canonicalKeywords(printed: readonly string[]): string[] {
  const out: string[] = [];
  for (const keyword of printed) {
    const canonical = canonicalKeyword(keyword);
    if (canonical && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

/**
 * Keywords a card prints but the engine does not implement, so the detail view can say so instead of silently
 * behaving as if the card had no keyword. Returned as printed.
 */
export function unimplementedKeywords(printed: readonly string[]): string[] {
  return printed.filter((keyword) => canonicalKeyword(keyword) === null);
}
