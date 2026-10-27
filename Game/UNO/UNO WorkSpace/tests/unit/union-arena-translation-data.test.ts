import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TranslationsFile } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/translations.ts";
import { UNION_ARENA_CATALOG } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/catalog.ts";

const ROOT = path.resolve(process.cwd(), "../../unionarena/UnionArenaWorkSpace");
const FILES: Array<[string, string]> = [
  ["Jujutsu Kaisen", "jjk"],
  ["Demon Slayer Kimetsu no Yaiba", "kmy"],
  ["AttackOnTitan", "aot"]
];

const read = (title: string): TranslationsFile =>
  JSON.parse(readFileSync(path.join(ROOT, title, "Cards", "translations.json"), "utf8")) as TranslationsFile;

describe("card translation data", () => {
  it("exists for every title that needs one, and never for the titles printed in Chinese", () => {
    for (const [title] of FILES) {
      expect(existsSync(path.join(ROOT, title, "Cards", "translations.json")), title).toBe(true);
    }
    // Arknights and Evangelion cards are printed in Simplified Chinese; they get no translation file at all.
    expect(existsSync(path.join(ROOT, "Arknights", "Cards", "translations.json"))).toBe(false);
    expect(existsSync(path.join(ROOT, "Neon Genesis Evangelion", "Cards", "translations.json"))).toBe(false);
  });

  it("keys every entry by a real card number of that title, and separates the translation from the card data", () => {
    for (const [title, ipId] of FILES) {
      const file = read(title);
      const numbers = new Set(UNION_ARENA_CATALOG.filter((card) => card.ipId === ipId).map((card) => card.number));
      expect(file.cards.length, title).toBeGreaterThan(0);
      for (const entry of file.cards) {
        expect(numbers.has(entry.number), `${title} ${entry.number}`).toBe(true);
      }
      // The file is its own document: the card records keep their printed text untouched.
      for (const card of UNION_ARENA_CATALOG.filter((c) => c.ipId === ipId)) {
        expect(card.stats === null || typeof card.stats.abilityText === "string").toBe(true);
      }
    }
  });

  it("numbers every paragraph, and pairs a translation only where one was verified", () => {
    for (const [title] of FILES) {
      const file = read(title);
      for (const entry of file.cards) {
        expect(entry.paragraphs.length).toBeGreaterThan(0);
        entry.paragraphs.forEach((paragraph, index) => {
          expect(paragraph.index).toBe(index + 1);
          expect(paragraph.marker.length).toBeGreaterThan(0);
          expect(paragraph.original.trim().length).toBeGreaterThan(0);
          // A paragraph either has a translation and says where it came from, or has none and is marked unverified.
          if (paragraph.translation === null) expect(paragraph.status).toBe("unverified");
          else expect(paragraph.translation.trim().length).toBeGreaterThan(0);
        });
        // matchStatus describes the paragraphs truthfully.
        const translated = entry.paragraphs.filter((paragraph) => paragraph.translation).length;
        if (entry.matchStatus === "complete") expect(translated).toBe(entry.paragraphs.length);
        if (entry.matchStatus === "missing") expect(translated).toBe(0);
        if (entry.matchStatus === "partial") expect(translated).toBeGreaterThan(0);
      }
    }
  });

  it("gives each of the two Japanese titles a verified Chinese translation for most cards", () => {
    // These are the official Chinese card texts, paired line by line. The bar is deliberately below 100%: a card whose
    // two printings do not line up is left unpaired rather than paired wrongly.
    for (const [title, expected] of [["Jujutsu Kaisen", 170], ["Demon Slayer Kimetsu no Yaiba", 170]] as const) {
      const file = read(title);
      const complete = file.cards.filter((entry) => entry.matchStatus === "complete").length;
      expect(complete, title).toBeGreaterThanOrEqual(expected);
      // Every paragraph carries the original, whatever its translation status.
      expect(file.cards.every((entry) => entry.paragraphs.every((paragraph) => paragraph.original))).toBe(true);
    }
  });

  it("keeps Attack on Titan's original text with no invented translation", () => {
    // AOT is printed in English and no official Chinese card text exists for these card numbers, so the file must say
    // exactly that: the English is kept, nothing is made up.
    const file = read("AttackOnTitan");
    expect(file.originalLang).toBe("en");
    expect(file.cards.length).toBeGreaterThan(0);
    for (const entry of file.cards) {
      expect(entry.translationSource).toBe("none");
      expect(entry.matchStatus).toBe("missing");
      expect(entry.paragraphs.every((paragraph) => paragraph.translation === null)).toBe(true);
      expect(entry.paragraphs.every((paragraph) => paragraph.status === "unverified")).toBe(true);
    }
    // And the file explains why, rather than looking like an oversight.
    expect(file.note).toMatch(/没有.*中文译文/);
  });
});
