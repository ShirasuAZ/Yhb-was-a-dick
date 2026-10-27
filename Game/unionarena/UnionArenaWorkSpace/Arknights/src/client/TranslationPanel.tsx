/**
 * The original text / Chinese translation panel in a card's detail view.
 *
 * Only cards whose printed text is not Chinese get a panel: a card already printed in Simplified Chinese is shown exactly
 * as before, with no empty box under it. The decision is made from the card's own text (kana and Latin letters), never from
 * which title the card belongs to — a title can publish cards in more than one language.
 *
 * Each paragraph is one unit: the original line and its Chinese line share a number (①, ②, …) and a matching tint, so a
 * reader can see which translation belongs to which sentence. Desktop puts the two columns side by side, a phone stacks
 * them under the same number.
 */
import { useEffect, useState } from "react";
import { translationsUrl, type CardTranslation, type TranslationParagraph } from "../shared/translations.ts";
import type { IpId } from "../shared/ips.ts";

/**
 * Whether a card's printed text is already Simplified Chinese, so it needs no translation panel.
 *
 * The decision is made from the letters and characters the text actually contains: kana means Japanese; otherwise Han
 * characters mean Chinese and Latin letters mean English. A line of nothing but numbers, costs and symbols (`BP4000`,
 * `AP1`) says nothing about the language, so it is not counted either way — only real words are.
 */
export function isChineseText(text: string): boolean {
  const kana = (text.match(/[぀-ヿ]/g) ?? []).length;
  if (kana > 1) return false;
  // Latin *words* only: a bare "BP" or "AP" in front of a number is a cost label, not English text.
  const latinWords = (text.match(/[A-Za-z]{2,}/g) ?? []).filter((word) => !/^(bp|ap)$/i.test(word)).length;
  const han = (text.match(/[一-鿿]/g) ?? []).length;
  if (latinWords === 0 && han === 0) return true;
  return han >= latinWords;
}

/** The language a card's text is printed in, for the panel's heading. */
export function textLanguage(text: string): "zh" | "ja" | "en" {
  if ((text.match(/[぀-ヿ]/g) ?? []).length > 1) return "ja";
  return isChineseText(text) ? "zh" : "en";
}

const LANGUAGE_NAME = { zh: "简体中文", ja: "日文", en: "英文" } as const;

/** One fetch per title, shared by every card opened from it: opening a second card does not ask again. */
const cache = new Map<string, Promise<CardTranslation[]>>();

function loadTranslations(ipId: IpId): Promise<CardTranslation[]> {
  const cached = cache.get(ipId);
  if (cached) return cached;
  const request = fetch(translationsUrl(ipId))
    .then((response) => (response.ok ? response.json() : { cards: [] }))
    .then((data: { cards?: CardTranslation[] }) => data.cards ?? [])
    .catch(() => []);
  cache.set(ipId, request);
  return request;
}

export interface TranslationPanelProps {
  /** The card's number, which is how its translation is found. */
  number: string;
  /** The card's printed ability text, used to decide whether a panel is needed at all. */
  abilityText: string;
  /** The card's title, for the file to read. */
  ipId: IpId | null;
}

export function TranslationPanel({ number, abilityText, ipId }: TranslationPanelProps) {
  const [entry, setEntry] = useState<CardTranslation | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready">("idle");
  const needed = !!abilityText.trim() && !isChineseText(abilityText);

  // A new card starts from nothing: the previous card's translation must never be shown under this one.
  useEffect(() => {
    setEntry(null);
    setState(needed && ipId ? "loading" : "idle");
    if (!needed || !ipId) return undefined;
    let active = true;
    void loadTranslations(ipId).then((cards) => {
      if (!active) return;
      setEntry(cards.find((card) => card.number === number) ?? null);
      setState("ready");
    });
    return () => { active = false; };
  }, [number, needed, ipId]);

  if (!needed) return null;
  if (state === "loading") return <section className="ua-tr" aria-label="原文与译文">
    <p className="ua-tr-loading">正在读取原文与译文…</p>
  </section>;
  if (!entry) return <section className="ua-tr" aria-label="原文与译文">
    <header className="ua-tr-head"><strong>原文与译文</strong><span>{LANGUAGE_NAME[textLanguage(abilityText)]}原文</span></header>
    <p className="ua-tr-missing" role="status">暂无中文译文，下面保留卡面原文。</p>
    <p className="ua-tr-original ua-tr-plain">{abilityText}</p>
  </section>;

  const language = entry.originalLang === "ja" ? "日文" : entry.originalLang === "en" ? "英文" : "原文";
  const unpaired = entry.paragraphs.filter((paragraph) => !paragraph.translation);
  return <section className="ua-tr" aria-label="原文与译文">
    <header className="ua-tr-head">
      <strong>原文与译文</strong>
      <span>{language}原文 · 官方简体中文译文</span>
    </header>
    <ol className="ua-tr-list">
      {entry.paragraphs.map((paragraph) => <TranslationParagraphView key={paragraph.index} paragraph={paragraph} />)}
    </ol>
    {unpaired.length ? <p className="ua-tr-missing" role="status">
      其中 {unpaired.length} 段暂无中文译文，已保留原文。
    </p> : null}
  </section>;
}

function TranslationParagraphView({ paragraph }: { paragraph: TranslationParagraph }) {
  return <li className="ua-tr-item" data-paired={paragraph.translation ? "true" : undefined}>
    <div className="ua-tr-cell">
      <span className="ua-tr-marker" aria-hidden="true">{paragraph.marker}</span>
      <div className="ua-tr-text">
        <small className="ua-tr-label">原文</small>
        <p className="ua-tr-original" lang={paragraph.status === "unverified" ? undefined : "ja"}>{paragraph.original}</p>
      </div>
    </div>
    <div className="ua-tr-cell">
      <span className="ua-tr-marker" aria-hidden="true">{paragraph.marker}</span>
      <div className="ua-tr-text">
        <small className="ua-tr-label">中文</small>
        {paragraph.translation
          ? <p className="ua-tr-translated">{paragraph.translation}</p>
          : <p className="ua-tr-untranslated">暂无中文译文</p>}
      </div>
    </div>
  </li>;
}
