#!/usr/bin/env python3
"""Build each game's badges and League milestones for the Nuzlocke Aid site.

    python3 tools/build_badges.py

Johto games (Gold/Silver/Crystal/HeartGold/SoulSilver) also list the rest of
the game, marked "goal": "full": the Kanto badges, the Elite Four and Champion
rematches, and Red. A run's goal setting decides which count.

Writes docs/data/badges.json: {game: [{key, name, leader, kind, icon}]} in the
order they're earned (kind is "badge", "elite4", "champion" or "red"), and the
icons in docs/assets/badges/. Badge art is the official art from Bulbapedia;
the Elite Four and Champion icons are drawn here in pixel art.
"""

import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import soullink  # noqa: E402

DOCS = Path(__file__).resolve().parent.parent / "docs"
OUT = DOCS / "assets" / "badges"
CACHE = soullink.CACHE_DIR / "badges"
SIZE = 64
BULBAPEDIA_API = "https://bulbapedia.bulbagarden.net/w/api.php"

KANTO = [("Boulder", "Brock"), ("Cascade", "Misty"), ("Thunder", "Lt. Surge"), ("Rainbow", "Erika"),
         ("Soul", "Koga"), ("Marsh", "Sabrina"), ("Volcano", "Blaine"), ("Earth", "Giovanni")]
KANTO_GSC = [("Boulder", "Brock"), ("Cascade", "Misty"), ("Thunder", "Lt. Surge"), ("Rainbow", "Erika"),
             ("Soul", "Janine"), ("Marsh", "Sabrina"), ("Volcano", "Blaine"), ("Earth", "Blue")]
JOHTO = [("Zephyr", "Falkner"), ("Hive", "Bugsy"), ("Plain", "Whitney"), ("Fog", "Morty"),
         ("Storm", "Chuck"), ("Mineral", "Jasmine"), ("Glacier", "Pryce"), ("Rising", "Clair")]
HOENN = [("Stone", "Roxanne"), ("Knuckle", "Brawly"), ("Dynamo", "Wattson"), ("Heat", "Flannery"),
         ("Balance", "Norman"), ("Feather", "Winona"), ("Mind", "Tate & Liza"), ("Rain", "Wallace")]
HOENN_E = HOENN[:7] + [("Rain", "Juan")]
SINNOH_DP = [("Coal", "Roark"), ("Forest", "Gardenia"), ("Cobble", "Maylene"), ("Fen", "Crasher Wake"),
             ("Relic", "Fantina"), ("Mine", "Byron"), ("Icicle", "Candice"), ("Beacon", "Volkner")]
SINNOH_PT = [("Coal", "Roark"), ("Forest", "Gardenia"), ("Relic", "Fantina"), ("Cobble", "Maylene"),
             ("Fen", "Crasher Wake"), ("Mine", "Byron"), ("Icicle", "Candice"), ("Beacon", "Volkner")]
UNOVA_B2W2 = [("Basic", "Cheren"), ("Toxic", "Roxie"), ("Insect", "Burgh"), ("Bolt", "Elesa"),
              ("Quake", "Clay"), ("Jet", "Skyla"), ("Legend", "Drayden"), ("Wave", "Marlon")]

# game: (badges in order, Elite Four, Champion, [after the League: more badges])
GAMES = {
    "rb": (KANTO, "Lorelei, Bruno, Agatha & Lance", "Blue", []),
    "y": (KANTO, "Lorelei, Bruno, Agatha & Lance", "Blue", []),
    "frlg": (KANTO, "Lorelei, Bruno, Agatha & Lance", "Blue", []),
    "gs": (JOHTO, "Will, Koga, Bruno & Karen", "Lance", KANTO_GSC),
    "c": (JOHTO, "Will, Koga, Bruno & Karen", "Lance", KANTO_GSC),
    "hgss": (JOHTO, "Will, Koga, Bruno & Karen", "Lance", KANTO_GSC),
    "rs": (HOENN, "Sidney, Phoebe, Glacia & Drake", "Steven", []),
    "e": (HOENN_E, "Sidney, Phoebe, Glacia & Drake", "Wallace", []),
    "dp": (SINNOH_DP, "Aaron, Bertha, Flint & Lucian", "Cynthia", []),
    "pt": (SINNOH_PT, "Aaron, Bertha, Flint & Lucian", "Cynthia", []),
    "b2w2": (UNOVA_B2W2, "Shauntal, Marshal, Grimsley & Caitlin", "Iris", []),
    # any other game: eight numbered badges
    "generic": ([(str(i), "") for i in range(1, 9)], "", "", []),
}

# Pixel-art icons (K outline, Y gold, y dark gold, W shine, R red, B blue, S silver)
PALETTE = {"K": (40, 40, 48), "Y": (248, 200, 48), "y": (200, 136, 24), "W": (255, 248, 200),
           "R": (224, 56, 72), "B": (72, 120, 232), "b": (40, 72, 168), "S": (200, 208, 224),
           "s": (128, 136, 160)}
TROPHY = [
    "..KKKKKKKKKK..",
    "KKKYYWWYYYYKKK",
    "KYKYWYYYYYyKYK",
    "KYKYWYYYYYyKYK",
    "KYKYYYYYYYyKYK",
    ".KKYYYYYYYyKK.",
    "...KYYYYYyK...",
    "....KYYYyK....",
    ".....KYyK.....",
    ".....KYyK.....",
    "....KKYyKK....",
    "...KYYYYyyK...",
    "...KKKKKKKK...",
]
STAR = [  # Elite Four: a silver medal with a blue ribbon
    "..KKK...KKK...",
    "..KBBK.KBbK...",
    "...KBBKBbK....",
    "....KBBbK.....",
    "....KKKKK.....",
    "...KSSSSsK....",
    "..KSSWSSSsK...",
    "..KSWSSSSsK...",
    "..KSSSSSSsK...",
    "..KSSSSSssK...",
    "...KsSSssK....",
    "....KKKKK.....",
]
NUMBERED = [  # a plain badge for "Other game" runs; its number is drawn on the page
    "....KKKKKK....",
    "..KKYYYYYYKK..",
    ".KYYWWYYYYyyK.",
    ".KYWYYYYYYYyK.",
    "KYYYYYYYYYYyyK",
    "KYYYYYYYYYYYyK",
    "KYYYYYYYYYYYyK",
    "KYYYYYYYYYYyyK",
    ".KYYYYYYYYyyK.",
    ".KyYYYYYYyyyK.",
    "..KKyyyyyyKK..",
    "....KKKKKK....",
]


def pixel_icon(rows, scale=4):
    img = Image.new("RGBA", (len(rows[0]), len(rows)))
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            if c != ".":
                img.putpixel((x, y), PALETTE[c] + (255,))
    return img.resize((img.width * scale, img.height * scale), Image.NEAREST)


def badge_art(name: str) -> Image.Image:
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / f"{name}_Badge.png"
    if not dest.exists():
        r = soullink.session.get(BULBAPEDIA_API, params=dict(
            action="query", prop="imageinfo", iiprop="url", titles=f"File:{name} Badge.png",
            format="json", formatversion=2), timeout=30)
        page = r.json()["query"]["pages"][0]
        if "imageinfo" not in page:
            raise LookupError(f"No badge art for {name} Badge")
        img = soullink.session.get(page["imageinfo"][0]["url"], timeout=30)
        img.raise_for_status()
        dest.write_bytes(img.content)
    img = soullink._trim(Image.open(io.BytesIO(dest.read_bytes())).convert("RGBA"))
    scale = SIZE / max(img.size)
    return img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)


def red_icon() -> Image.Image:
    """Red's HeartGold/SoulSilver trainer sprite, for the final battle."""
    dest = CACHE / "Spr_HGSS_Red.png"
    if not dest.exists():
        r = soullink.session.get(BULBAPEDIA_API, params=dict(
            action="query", prop="imageinfo", iiprop="url", titles="File:Spr HGSS Red.png",
            format="json", formatversion=2), timeout=30)
        url = r.json()["query"]["pages"][0]["imageinfo"][0]["url"]
        dest.write_bytes(soullink.session.get(url, timeout=30).content)
    img = soullink._trim(Image.open(dest).convert("RGBA"))
    k = max(1, SIZE // max(img.size))
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    pixel_icon(TROPHY).save(OUT / "champion.png", optimize=True)
    pixel_icon(STAR).save(OUT / "elite-four.png", optimize=True)
    pixel_icon(NUMBERED).save(OUT / "badge.png", optimize=True)
    red_icon().save(OUT / "red.png", optimize=True)
    data = {}
    for game, (badges, e4, champion, after) in GAMES.items():
        items = []
        def add_badges(lst, region="", goal=None):
            for name, leader in lst:
                if game == "generic":
                    items.append({"key": f"badge{name}", "name": f"Badge {name}", "leader": "",
                                  "kind": "badge", "icon": "badges/badge.png", "number": int(name)})
                    continue
                file = f"badges/{slug(name)}.png"
                if not (DOCS / "assets" / file).exists():
                    badge_art(name).save(DOCS / "assets" / file, optimize=True)
                items.append({"key": f"{region}{slug(name)}", "name": f"{name} Badge", "leader": leader,
                              "kind": "badge", "icon": file, **({"goal": goal} if goal else {})})
        add_badges(badges)
        items.append({"key": "elite4", "name": "Elite Four", "leader": e4, "kind": "elite4",
                      "icon": "badges/elite-four.png"})
        items.append({"key": "champion", "name": "Champion", "leader": champion, "kind": "champion",
                      "icon": "badges/champion.png"})
        if after:  # the rest of the game, for runs that go all the way to Red
            add_badges(after, "kanto-", "full")
            items.append({"key": "elite4-2", "name": "Elite Four rematch", "leader": e4, "kind": "elite4",
                          "icon": "badges/elite-four.png", "goal": "full", "rematch": True})
            items.append({"key": "champion-2", "name": "Champion rematch", "leader": champion, "kind": "champion",
                          "icon": "badges/champion.png", "goal": "full", "rematch": True})
            items.append({"key": "red", "name": "Red", "leader": "Red, at Mt. Silver", "kind": "red",
                          "icon": "badges/red.png", "goal": "full"})
        data[game] = items
        print(f"{game:7} {sum(i['kind'] == 'badge' for i in items)} badges + League")
    (DOCS / "data" / "badges.json").write_text(json.dumps(data, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
