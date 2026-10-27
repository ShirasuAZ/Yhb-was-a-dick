import { describe, expect, it } from "vitest";
import { isChineseText, textLanguage } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/client/TranslationPanel.tsx";
import { TRANSLATED_TITLES, translationsUrl } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/translations.ts";

describe("card text language", () => {
  it("recognises a card that is already Simplified Chinese", () => {
    // The Arknights and Evangelion cards are printed in Chinese: they must not get a translation panel.
    expect(isChineseText("【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）")).toBe(true);
    expect(isChineseText("此角色不被BP不高于2000的角色阻挡。")).toBe(true);
    expect(isChineseText("")).toBe(true);
    // Nothing but numbers, costs and symbols says nothing about the language.
    expect(isChineseText("BP4000 AP1")).toBe(true);
  });

  it("recognises Japanese card text", () => {
    expect(isChineseText("《登場時》自分の場外からカードを3枚引く。")).toBe(false);
    expect(textLanguage("《登場時》自分の場外からカードを3枚引く。")).toBe("ja");
    expect(textLanguage("このキャラはBP+1000。")).toBe("ja");
  });

  it("recognises English card text", () => {
    expect(isChineseText("《When Played》 Draw a card, then place one card from your hand into your sideline.")).toBe(false);
    expect(textLanguage("《When Played》 Draw a card, then place one card from your hand into your sideline.")).toBe("en");
    expect(textLanguage("《Impact (1)》 (When this character attacks and wins a battle, deal 1 damage.)")).toBe("en");
  });

  it("does not judge by the title, only by the text", () => {
    // A Japanese card of a title that also prints Chinese cards is still Japanese.
    expect(textLanguage("《レイド》〈真人〉アクティブにし、フロントLに移動できる")).toBe("ja");
    // And a Chinese card is Chinese whatever title it is in.
    expect(textLanguage("【突进】〈真人〉转为活跃状态，并可以移动至前线")).toBe("zh");
  });
});

describe("translation sources", () => {
  it("asks for a translation file per title, and only for the titles that need one", () => {
    // Arknights and Evangelion are printed in Chinese, so they are not in the translated set.
    expect(TRANSLATED_TITLES).toEqual(["jjk", "kmy", "aot"]);
    expect(translationsUrl("jjk")).toBe("/assets/union-arena/translations/jjk.json");
    expect(translationsUrl("kmy")).toBe("/assets/union-arena/translations/kmy.json");
    expect(translationsUrl("aot")).toBe("/assets/union-arena/translations/aot.json");
    // The same title always maps to the same file, so the browser cache actually gets used.
    expect(translationsUrl("jjk")).toBe(translationsUrl("jjk"));
  });
});
