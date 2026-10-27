#!/usr/bin/env python3
"""Repair `bp` in the titles fetched from the Chinese site.

A character whose printed BP is conditional (`4000+`) has that BP written with a trailing plus in the source. The first
version of the fetcher only accepted a bare number and so stored null, which made those characters unusable (a character
with no BP cannot be played or battled). This reads the source value again and fills the base number in, leaving every
other field untouched.

Run once, after fetch_cn_cards.py has been fixed; re-fetching everything works too but costs a few hundred requests.
"""
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://webadmin.windoent.com/front/ua-public/card/card/webinfo/"
TITLES = ["Jujutsu Kaisen", "Demon Slayer Kimetsu no Yaiba", "Neon Genesis Evangelion"]

# Card id -> card number is in each title's index; the API wants the card *id*.
import csv


def get(url, tries=3):
    last = None
    for _ in range(tries):
        try:
            result = subprocess.run(["curl", "-sS", "--ssl-no-revoke", "-A", "Mozilla/5.0", "--max-time", "30", url],
                                    capture_output=True, check=True)
            return json.loads(result.stdout.decode("utf-8"))
        except Exception as error:  # noqa: BLE001
            last = error
            time.sleep(1)
    raise last


def main():
    for title in TITLES:
        cards_path = os.path.join(ROOT, title, "Cards", "cards.json")
        index_path = os.path.join(ROOT, title, "Cards", "images", "_index.csv")
        if not os.path.exists(cards_path) or not os.path.exists(index_path):
            print(f"skip {title}", file=sys.stderr)
            continue
        cards = json.load(open(cards_path, encoding="utf-8"))
        by_number = {card["number"]: card for card in cards}
        # One representative card id per number is enough: the printed data is shared by every print.
        first_id = {}
        for row in csv.DictReader(open(index_path, encoding="utf-8-sig")):
            first_id.setdefault(row["number"], row["id"])
        fixed = 0
        for number, card in by_number.items():
            if card.get("type") != "character" or card.get("bp") is not None:
                continue
            card_id = first_id.get(number)
            if not card_id:
                continue
            data = get(BASE + card_id)
            if data.get("code") != 0:
                continue
            stats = data["data"]
            match = re.search(r"\d+", stats.get("bp") or "")
            if match and (stats.get("cardType") or "") == "角色":
                card["bp"] = int(match.group(0))
                fixed += 1
        json.dump(cards, open(cards_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        remaining = sum(1 for card in cards if card.get("type") == "character" and card.get("bp") is None)
        print(f"{title}: repaired {fixed}, still missing {remaining}")


if __name__ == "__main__":
    main()
