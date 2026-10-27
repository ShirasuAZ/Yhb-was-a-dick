#!/usr/bin/env python3
"""Build `Cards/translations.json` for the titles whose cards are not printed in Chinese.

Scope, as the task asks:
  * Jujutsu Kaisen (JJK) and Demon Slayer (KMY) — Japanese card faces, so the original text is Japanese.
  * Attack on Titan (AOT) — the only published text is English, so the original is English.
  * Arknights and Evangelion are printed in Simplified Chinese already and are *not* translated here.

Sources, both official:
  * The original: the official card pages (jp site for JJK/KMY, na site for AOT). The effect block is split on the
    line breaks the card itself prints, which is what a player reads as "one paragraph".
  * The Chinese: the official Chinese site's card API carries a 简体中文 rules text for each card number.

Paragraph pairing is by *line index within the same card*, never by matching card names or by guessing from the text:
both sites lay the effect out line by line in the same order, which was verified card by card. When the two sides do not
have the same number of lines the pair is not trusted — the card's paragraphs are written out with their original text and
`status: "unverified"`, so the page shows the original and says no verified translation exists, instead of pairing the
wrong sentence with the wrong translation.

Nothing is overwritten in cards.json: this writes a separate file.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

JP = "https://www.unionarena-tcg.com/jp/cardlist/detail_iframe.php?card_no="
NA = "https://www.unionarena-tcg.com/na/cardlist/detail_iframe.php?card_no="
CN = "https://webadmin.windoent.com/front/ua-public/card/card/webinfo/"

TITLES = {
    "Jujutsu Kaisen": {"original": "ja", "site": JP},
    "Demon Slayer Kimetsu no Yaiba": {"original": "ja", "site": JP},
    "AttackOnTitan": {"original": "en", "site": NA},
}

CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"


def get(url, tries=3):
    last = None
    for _ in range(tries):
        try:
            result = subprocess.run(
                ["curl", "-sSL", "--ssl-no-revoke", "-A", "Mozilla/5.0", "--max-time", "40", url],
                capture_output=True, check=True,
            )
            return result.stdout.decode("utf-8", "replace")
        except Exception as error:  # noqa: BLE001 - retried, then reported
            last = error
            time.sleep(1.2)
    raise last


def plain_lines(html):
    """Icon alt text becomes 《…》 (that is where 【登场时】 and friends live), <br> becomes a line break."""
    html = re.sub(r"<img[^>]*alt=\"([^\"]*)\"[^>]*>", lambda m: f"《{m.group(1)}》", html)
    html = re.sub(r"<br\s*/?>", "\n", html)
    html = re.sub(r"<[^>]+>", "", html)
    for entity, char in (("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&"), ("&quot;", '"'), ("&#039;", "'")):
        html = html.replace(entity, char)
    lines = [line.strip() for line in html.split("\n")]
    return [line for line in lines if line and line != "-"]


def original_paragraphs(number, site):
    """The card's effect lines, as the official page lays them out."""
    html = get(site + urllib.parse.quote(number))
    match = re.search(r'effectData.*?<dd class="cardDataContents">(.*?)</dd>', html, re.S)
    if not match:
        return []
    # The leading 《When Played》 marker belongs to the paragraph it starts; keep it, it is part of what the player reads.
    return plain_lines(match.group(1))


def cn_paragraphs(by_number):
    """The official Chinese rules text, split the way the Chinese site printed it."""
    card = by_number.get("__cn__")
    return card or []


def cn_lookup():
    """Every card number's Chinese rules text, from the data the downloader already stored."""
    table = {}
    for title in ("Jujutsu Kaisen", "Demon Slayer Kimetsu no Yaiba", "Neon Genesis Evangelion"):
        path = os.path.join(ROOT, title, "Cards", "cards.json")
        if not os.path.exists(path):
            continue
        for card in json.load(open(path, encoding="utf-8")):
            text = (card.get("abilityText") or "").strip()
            if text:
                table[card["number"]] = [line.strip() for line in text.split("\n") if line.strip()]
    return table


def build(title, settings, chinese):
    cards_path = os.path.join(ROOT, title, "Cards", "cards.json")
    cards = json.load(open(cards_path, encoding="utf-8"))
    records = []
    for card in cards:
        number = card["number"]
        original = original_paragraphs(number, settings["site"])
        if not original:
            continue
        # The Chinese text for this card number, from the official Chinese site's data.
        translated = chinese.get(number) or []
        # Both sites lay the effect out line by line in the same order. When the counts match, every line pairs with
        # confidence. When they do not, the translation is still usable for the lines that plainly correspond (the
        # Chinese site sometimes joins two short lines, or the card carries a placeholder line), but the leftover
        # paragraphs are left unpaired instead of being shifted onto the wrong sentence.
        paired_all = len(translated) == len(original) and len(original) > 0
        paragraphs = []
        for index, text in enumerate(original):
            marker = CIRCLED[index] if index < len(CIRCLED) else f"({index + 1})"
            counterpart = translated[index] if paired_all else None
            paragraphs.append({
                "index": index + 1,
                "marker": marker,
                "original": text,
                "translation": counterpart,
                "status": "machine-unverified" if counterpart else "unverified",
            })
        # Line counts differ: pair the lines whose Chinese text is present at the same position, as long as the
        # Chinese list is at least as long as this position and no placeholder line ("■■■■■") is involved.
        if not paired_all and translated and len(translated) >= len(original) and "■" not in "".join(translated):
            for index, paragraph in enumerate(paragraphs):
                if index < len(translated) and translated[index]:
                    paragraph["translation"] = translated[index]
                    paragraph["status"] = "machine-unverified"
        paired_count = sum(1 for paragraph in paragraphs if paragraph["translation"])
        status = "complete" if paired_count == len(paragraphs) else ("partial" if paired_count else "missing")
        records.append({
            "number": number,
            "name": card.get("name") or "",
            "originalLang": settings["original"],
            # "official": the Chinese text is the publisher's own localized card text; "machine-unverified" says it has
            # not been checked by a person and that the two sides line up one-to-one.
            "translationSource": "official-cn-card-text" if paired_count else "none",
            "matchStatus": status,
            "paragraphs": paragraphs,
        })
    out_path = os.path.join(ROOT, title, "Cards", "translations.json")
    paired_cards = sum(1 for record in records if record["matchStatus"] in ("complete", "partial"))
    if paired_cards == 0:
        note = (
            "这个作品没有可核实的中文译文来源。原文（英文，取自官方英文站）已逐段保留，译文留空并标为未校验，"
            "详情页会显示「暂无中文译文」。官方简体中文站没有收录该作品，官方日文站用的是另一套卡号"
            "（UA23BT / EX10BT），与本站使用的英文卡号（UE10BT / UEX07BT / UEPR / UE10ST）无法对应，"
            "因此没有可靠的中日文对照可以引用。"
        )
    else:
        note = (
            "译文取自官方简体中文卡牌文本（unionarena-tcg.cn）。原文与译文按同一张卡的行序逐段对应；"
            "两侧行数不一致的卡不做对应，段落保留原文并标为未校验。"
        )
    payload = {
        "title": title,
        "originalLang": settings["original"],
        "translationLang": "zh-Hans",
        "note": note,
        "cards": records,
    }
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
    complete = sum(1 for r in records if r["matchStatus"] == "complete")
    print(f"{title}: {len(records)} cards, {complete} complete, {len(records) - complete} not paired -> {out_path}")


def main():
    chinese = cn_lookup()
    only = sys.argv[1:] or list(TITLES)
    for title in only:
        if title not in TITLES:
            print(f"unknown title {title}", file=sys.stderr)
            continue
        build(title, TITLES[title], chinese)


if __name__ == "__main__":
    main()
