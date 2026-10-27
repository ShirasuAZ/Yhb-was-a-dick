/**
 * The shape of `Cards/translations.json`, and where the client reads it.
 *
 * The file sits next to each title's card data and is served by the room service, so a card's translation is one small
 * request per title rather than a field repeated on every card record.
 */
import { ipById, type IpId } from "./ips.ts";

/** One paragraph pair: the original line and the Chinese line that translates it. */
export interface TranslationParagraph {
  /** 1-based position within the card. */
  index: number;
  /** The number shown beside both lines, ① for the first. */
  marker: string;
  /** The text as printed on the card. */
  original: string;
  /** The Chinese text, or null when no verified translation exists for this paragraph. */
  translation: string | null;
  /** "machine-unverified": aligned but not checked by a person. "unverified": not paired at all. */
  status: string;
}

export interface CardTranslation {
  number: string;
  name: string;
  originalLang: string;
  /** Where the Chinese text came from: "official-cn-card-text", or "none" when there is none. */
  translationSource: string;
  /** "complete": every paragraph paired. "partial": some. "missing": none. */
  matchStatus: string;
  paragraphs: TranslationParagraph[];
}

export interface TranslationsFile {
  title: string;
  originalLang: string;
  translationLang: string;
  note?: string;
  cards: CardTranslation[];
}

/** Where a title's translations are served from. */
export function translationsUrl(ipId: IpId): string {
  const title = ipById(ipId);
  if (!title) return "/assets/union-arena/translations/none.json";
  return `/assets/union-arena/translations/${encodeURIComponent(title.code.toLowerCase())}.json`;
}

/** Titles whose cards need a translation panel. Arknights and Evangelion are printed in Simplified Chinese. */
export const TRANSLATED_TITLES: readonly IpId[] = ["jjk", "kmy", "aot"];
