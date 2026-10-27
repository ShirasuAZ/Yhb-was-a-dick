#!/usr/bin/env python3
"""Fetch printed card data for Attack on Titan (UE10BT / UEX07BT / UEPR / UE10ST) from the official English site.

AOT is not on the Chinese site, so its printed text is English. This writes
`AttackOnTitan/Cards/cards.json` in the same shape the other titles use, so the catalog and the rules engine
read every title the same way.

Usage:
    python ../../unionarena/UnionArenaWorkSpace/tools/fetch_aot_cards.py
"""
import csv
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TITLE = "AttackOnTitan"
BASE = "https://www.unionarena-tcg.com/na/cardlist/detail_iframe.php?card_no="

COLOURS = {"yellow": "yellow", "red": "red", "blue": "blue", "purple": "purple", "green": "green"}
TYPES = {"character": "character", "site": "site", "event": "event"}
WORDS = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}


def get(url, tries=3):
    last = None
    for _ in range(tries):
        try:
            result = subprocess.run(["curl", "-sSL", "--ssl-no-revoke", "-A", "Mozilla/5.0", "--max-time", "40", url],
                                    capture_output=True, check=True)
            return result.stdout.decode("utf-8", "replace")
        except Exception as error:  # noqa: BLE001
            last = error
            time.sleep(1.5)
    raise last


def plain(html):
    """Icon alt text becomes a bracket marker (the icons are where 【登场时】 and friends live), <br> a newline."""
    html = re.sub(r"<img[^>]*alt=\"([^\"]*)\"[^>]*>", lambda m: f"《{m.group(1)}》", html)
    html = re.sub(r"<br\s*/?>", "\n", html)
    html = re.sub(r"<[^>]+>", "", html)
    html = html.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&quot;", '"').replace("&#039;", "'")
    return "\n".join(line.strip() for line in html.split("\n") if line.strip())


def field(html, css_class):
    match = re.search(rf'class="[^"]*{css_class}[^"]*".*?</d[dt]>', html, re.S)
    return match.group(0) if match else ""


def energy_need(html):
    """The required-energy icon: alt "Blue3" = 3 blue, alt "Blue-" = 0."""
    match = re.search(r'need/ico_character_energy_[a-z]+(\d*)\.png" alt="([A-Za-z]+)(\d*|-)', html)
    if not match:
        return "blue", 0
    colour = COLOURS.get(match.group(2).lower())
    count = match.group(3)
    return colour, (int(count) if count.isdigit() else 0)


def energy_generated(html):
    """The generated-energy icon. Its alt spells the icons out: "Blue" = 1, "Blue+" = 1 and Plus, "BlueBlue" = 2,
    "BlueBlue+" = 2 and Plus, "GreenGreenGreen" = 3. The number in the file name is not the count."""
    match = re.search(r'resource/ico_resource_energy_[a-z0-9]+\.png" alt="([A-Za-z+]+)"', html)
    if not match:
        return 0, None, False
    alt = match.group(1)
    plus = alt.endswith("+")
    body = alt[:-1] if plus else alt
    # "BlueBlue" is Blue twice. Find the colour whose name the alt repeats exactly, rather than matching it greedily.
    for name, key in COLOURS.items():
        if set(name) & set(body) and body.lower() == (name * (len(body) // len(name))).lower():
            return len(body) // len(name), key, plus
    return 0, None, False


def parse(html):
    name = re.search(r'<h2 class="cardNameCol">\s*(.*?)\s*</h2>', html, re.S)
    number = re.search(r'<span class="cardNumData">(.*?)</span>', html, re.S)
    if not number:
        return None
    type_text = re.search(r'cardTypeData.*?<dd class="cardDataContents">(.*?)</dd>', html, re.S)
    if not type_text:
        match = re.search(r'categoryData.*?<dd class="cardDataContents">(.*?)</dd>', html, re.S)
        type_text = match
    bp = re.search(r'bpData.*?<dd class="cardDataContents">(.*?)</dd>', html, re.S)
    ap = re.search(r'apData.*?<dd class="cardDataContents">(.*?)</dd>', html, re.S)
    need = re.search(r'needEnergyData.*?<dd class="cardDataContents">(.*?)</dd>', html, re.S)
    affinity = re.search(r'attributeData.*?<dd class="cardDataContents">(.*?)</dd>', html, re.S)
    generated = re.search(r'generatedEnergyData.*?<dd class="cardDataContents">(.*?)</dd>', html, re.S)
    effect = re.search(r'effectData.*?<dd class="cardDataContents">(.*?)</dd>', html, re.S)
    trigger = re.search(r'triggerData.*?<dd class="cardDataContents">(.*?)</dd>', html, re.S)

    colour, energy_count = energy_need(html)
    generated_count, generated_colour, generated_plus = energy_generated(html)

    effect_text = plain(effect.group(1)) if effect else ""
    trigger_text = plain(trigger.group(1)) if trigger else ""

    # The effect block opens each line with its keyword icon: 《When Played》, 《Activate: Main》, 《Raid》, …
    # 《Raid》 <Levi> Switch to active. May move to the front line.  — the target is in angle brackets, or an [affinity].
    ABILITY_WORDS = ("when played", "activate: main", "raid", "pay 1 ap", "once per turn", "during your turn",
                     "during your turn,", "during opponent's turn", "blue", "red", "yellow", "green", "purple")
    keywords, raid, raid_line = [], None, None
    for line in effect_text.split("\n"):
        match = re.match(r"^《([^》]+)》(.*)$", line)
        if not match:
            continue
        head, rest = match.group(1), match.group(2)
        if head.lower() == "raid":
            raid_line = line
            break
        # A keyword is a name plus its parenthesised reminder text, e.g. 《Impact (1)》 (when this …).
        if head.lower() not in ABILITY_WORDS and not re.match(r"^(blue|red|yellow|green|purple)$", head.strip(), re.I):
            if re.match(r"^[^(]*\(\s*\d+\s*\)\s*$", head.strip()) or re.match(r"^[A-Z][A-Za-z'’ -]+$", head.strip()):
                keywords.append(head.strip())
    if raid_line:
        targets = [a or f"[{b}]" for a, b in re.findall(r"<([^>]+)>|\[([^\]]+)\]", raid_line)]
        if targets:
            raid = {
                "targets": targets,
                "text": re.sub(r"^《Raid》\s*(?:<[^>]+>|\[[^\]]+\])?\s*", "", raid_line).strip(),
            }

    trigger_label = None
    if trigger_text:
        first = re.match(r"^《([^》]+)》", trigger_text)
        if first:
            trigger_label = first.group(1)

    # A site or event prints "-" for BP; a conditional character prints "1500+" — the base is the number.
    bp_match = re.search(r"(\d+)", bp.group(1)) if bp else None
    bp_value = int(bp_match.group(1)) if bp_match and type_text and "character" in type_text.group(1).lower() else None

    return {
        "number": number.group(1).strip(),
        "name": name.group(1).strip() if name else "",
        "type": TYPES.get((type_text.group(1).strip().lower() if type_text else "character"), "character"),
        "color": colour or "blue",
        "energyCost": energy_count,
        "apCost": int(ap.group(1).strip()) if (ap and ap.group(1).strip().isdigit()) else 0,
        "bp": bp_value,
        "energyGen": generated_count,
        "energyGenColor": generated_colour,
        "energyGenPlus": generated_plus,
        "affinities": [] if not affinity or affinity.group(1).strip() in ("-", "") else [affinity.group(1).strip()],
        "raid": raid,
        "keywords": keywords,
        "abilityText": effect_text,
        "trigger": {"label": trigger_label, "text": trigger_text} if trigger_text else None,
    }


def main():
    index = os.path.join(ROOT, TITLE, "Cards", "images", "_index.csv")
    rows = list(csv.DictReader(open(index, encoding="utf-8-sig")))
    numbers = []
    for row in rows:
        number = row["number"]
        if number not in numbers:
            numbers.append(number)
    records = []
    for position, number in enumerate(numbers, 1):
        html = get(BASE + urllib.parse.quote(number))
        parsed = parse(html)
        if not parsed:
            print(f"  ! {number} not found", file=sys.stderr)
            continue
        records.append(parsed)
        if position % 25 == 0:
            print(f"  {position}/{len(numbers)}", file=sys.stderr)
    out = os.path.join(ROOT, TITLE, "Cards", "cards.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(records, handle, ensure_ascii=False, indent=1)
    print(f"{TITLE}: {len(records)} card numbers -> {out}")


if __name__ == "__main__":
    main()
