#!/usr/bin/env python3
"""Fetch printed card data (type, colour, cost, BP, trigger, effect text) for the CN UNION ARENA titles.

The official CN site (unionarena-tcg.cn) is a Vue SPA over this public JSON API. It carries the localized
(简体中文 for EVA, 日文 for JJK / DMS) effect text, which is what the game shows in the card detail view and
what the translation layer pairs against the Chinese translation.

Usage (from Game/UNO/UNO WorkSpace or anywhere):
    python ../../unionarena/UnionArenaWorkSpace/tools/fetch_cn_cards.py

Writes `<Title>/Cards/cards.json` next to the images, in the same shape Arknights uses, so the catalog and the
rules engine read every title the same way.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

BASE = "https://webadmin.windoent.com/front/ua-public"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Our folder name -> the CN products (goods ids) that make up that title.
TITLES = {
    "Jujutsu Kaisen": [51, 86, 39, 71],
    "Demon Slayer Kimetsu no Yaiba": [45, 91, 34, 70],
    "Neon Genesis Evangelion": [135, 134],
}

# curl, not urllib: this host drops Python's TLS handshake (see the card-download notes) but answers curl fine.
def get(url, tries=3):
    last = None
    for _ in range(tries):
        try:
            result = subprocess.run(
                ["curl", "-sS", "--ssl-no-revoke", "-A", "Mozilla/5.0", "--max-time", "40", url],
                capture_output=True, check=True,
            )
            return json.loads(result.stdout.decode("utf-8"))
        except Exception as error:  # noqa: BLE001 - retried below, then reported
            last = error
            time.sleep(1.5)
    raise last


def card_ids(product_name):
    ids, page = [], 1
    while True:
        data = get(f"{BASE}/card/card/weblist?good={urllib.parse.quote(product_name)}&page={page}&limit=100")
        page_data = data["page"]
        ids += [entry["id"] for entry in page_data["list"]]
        if page >= page_data["totalPage"]:
            return ids
        page += 1


# ---- The API speaks in image URLs; these turn them into the engine's own fields. ----

COLOURS = {"yellow": "yellow", "red": "red", "blue": "blue", "purple": "purple", "green": "green"}
TYPES = {"角色": "character", "场地": "site", "事件": "event"}
ENERGY_COUNT = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8}


def colour_of(url):
    if not url:
        return None
    match = re.search(r"/([a-z]+)_\w+_(?:role|site|event|)\w*\.png", url)
    if not match:
        match = re.search(r"/(yellow|red|blue|purple|green)_", url)
    return COLOURS.get(match.group(1)) if match else None


def energy_cost_of(card):
    """`energy` looks like .../energy/yellow_four_role.png -> 4. Events and sites use the same naming."""
    url = card.get("energy") or ""
    match = re.search(r"_([a-z]+)_(?:role|site|event|none)", url) or re.search(r"_([a-z]+)_", url)
    if not match:
        return 0
    return ENERGY_COUNT.get(match.group(1), 0)


def energy_gen_of(card):
    """`energyNum` .../energynum/yellow_one_plus.png -> (1, "yellow", True); .../yellow_zero.png -> (0, None, False)."""
    url = card.get("energyNum") or ""
    match = re.search(r"/([a-z]+)_([a-z]+?)(_plus)?\.png", url)
    if not match:
        return 0, None, False
    colour, count, plus = match.group(1), match.group(2), bool(match.group(3))
    return ENERGY_COUNT.get(count, 0), (COLOURS.get(colour) if count != "zero" else None), plus


# Keywords the game engine implements. A printed bracketed term is only a *keyword* when it is one of these AND
# carries reminder text in parentheses — that pair is exactly how a keyword is printed, and it keeps 【登场时】 and
# 【启动主要】 (timings) from being mistaken for keywords.
ENGINE_KEYWORDS = {
    "冲击无效", "冲击1", "冲击2", "冲击3", "冲击+1", "冲击+2", "伤害2", "伤害+1",
    "瞄准攻击", "2次攻击", "2次阻挡", "撤步",
}
CIRCLED = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
# A keyword line: 【keyword】（reminder text）[，more of the line]
KEYWORD_LINE = re.compile(r"^【([^】]+)】（([^）]*)）")


def keywords_of(text):
    """The keyword abilities a card always has, taken from the 【…】（…） pairs at the start of its lines."""
    found = []
    for line in text.split("\n"):
        match = KEYWORD_LINE.match(line.strip())
        if not match:
            continue
        raw = "".join(CIRCLED.get(glyph, glyph) for glyph in match.group(1)).strip()
        if raw in ENGINE_KEYWORDS and raw not in found:
            found.append(raw)
    return found


# 【突进】〈弑君者〉转为活跃状态，并可以移动至前线  — the target of a Raid is printed in 〈〉 (a name) or
# ［…］ / […] (an affinity). The reminder text after the target describes what the Raid does.
RAID_LINE = re.compile(r"^【突进】\s*(.*)$")


def raid_of(text):
    for line in text.split("\n"):
        match = RAID_LINE.match(line.strip())
        if not match:
            continue
        rest = match.group(1).strip()
        targets = [m.group(1) for m in re.finditer(r"〈([^〉]+)〉", rest)]
        targets += [f"[{m.group(1)}]" for m in re.finditer(r"[［\[]([^］\]]+)[］\]]", rest)]
        if not targets:
            continue
        # Drop the target that opens the reminder text, leaving what the Raid itself does.
        reminder = re.sub(r"^(?:〈[^〉]+〉|[［\[]([^］\]]+)[］\]])\s*", "", rest).strip()
        return {"targets": targets, "text": reminder}
    return None


def trigger_of(card):
    text = (card.get("triggerDetail") or "").strip()
    if not text:
        return None
    # The label is not a separate field; it is the icon in front of the text on the card, which the CN API does
    # not carry. Read the label off the wording each trigger type uses in Chinese card text.
    label = None
    for candidate, pattern in (
        ("抽卡", r"抽"), ("获得", r"加入手牌|加入卡牌"), ("激活", r"转为活跃|变为活跃"),
        ("特殊", r"^选择|^将|^此角色|^此卡牌"), ("色彩", r"^BP"), ("最终", r"^"),
    ):
        if re.search(pattern, text):
            label = candidate
            break
    return {"label": label or "特殊", "text": text}


def bp_of(card):
    """A character prints its BP as "4000", or "4000+" when an ability raises it. The base is the number in both cases;
    a site or an event prints "-" and has no BP at all."""
    if (card.get("cardType") or "") != "角色":
        return None
    match = re.search(r"\d+", card.get("bp") or "")
    return int(match.group(0)) if match else None


def to_stats(card):
    energy_gen, gen_colour, gen_plus = energy_gen_of(card)
    ability_text = (card.get("effectDescrible") or "").replace("\r\n", "\n").strip()
    return {
        "number": card["number"],
        "name": card["name"],
        "type": TYPES.get(card.get("cardType") or "", "character"),
        "color": colour_of(card.get("energy")) or "yellow",
        "energyCost": energy_cost_of(card),
        "apCost": int(card["consumerAp"]) if (card.get("consumerAp") or "").isdigit() else 0,
        "bp": bp_of(card),
        "energyGen": energy_gen,
        "energyGenColor": gen_colour,
        "energyGenPlus": gen_plus,
        "affinities": [card["detailFeature"]] if card.get("detailFeature") else [],
        "raid": raid_of(ability_text),
        "keywords": keywords_of(ability_text),
        "abilityText": ability_text,
        "trigger": trigger_of(card),
        "works": card.get("works"),
        "_goodsId": card.get("goodsId"),
        "_image": card.get("image"),
    }


def main():
    goods = {entry["id"]: entry["name"] for entry in get(f"{BASE}/card/card/attrweblist")["data"]["goods"]}
    for title, product_ids in TITLES.items():
        records = {}
        for product_id in product_ids:
            name = goods.get(product_id)
            if not name:
                print(f"  ! product {product_id} missing", file=sys.stderr)
                continue
            for card_id in card_ids(name):
                data = get(f"{BASE}/card/card/webinfo/{card_id}")
                if data.get("code") != 0:
                    continue
                stats = to_stats(data["data"])
                # One record per card *number*: parallel prints share the printed data.
                records.setdefault(stats["number"], stats)
        out = os.path.join(ROOT, title, "Cards", "cards.json")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as handle:
            json.dump(list(records.values()), handle, ensure_ascii=False, indent=1)
        print(f"{title}: {len(records)} card numbers -> {out}")


if __name__ == "__main__":
    main()
