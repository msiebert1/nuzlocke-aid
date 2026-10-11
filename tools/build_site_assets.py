#!/usr/bin/env python3
"""Build the art and data files the Nuzlocke Aid site loads.

    python3 tools/build_site_assets.py            # all games
    python3 tools/build_site_assets.py pt b2w2    # just these (plus shared files)

Writes, under docs/:
  data/species.json          [{dex, name}] up to #649
  data/styles.json           per game: name, layout numbers, wallpapers, trainers
  assets/common/             Oak sprites, link icons, font
  assets/<game>/textbox.png  the game's dialogue box with its text blanked out
  assets/<game>/bg.png       repeating background tile
  assets/<game>/walls/*.png  every PC box wallpaper, cropped to a sprite cell
  assets/<game>/trainers/*.png
  assets/<game>/sprites.png + sprites.json   every Pokémon sprite in one sheet

Everything is downloaded through the image generator's cache (soullink.py /
retro.py), so re-running is fast.
"""

import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pokedata  # noqa: E402
import retro  # noqa: E402
import soullink  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
SHEET_WIDTH = 1024

# Trainer sprites offered in the site's picker, beyond the two defaults
EXTRA_TRAINERS = {
    "rb": ["Blue"], "y": ["Blue"], "gs": ["Silver"], "c": ["Silver"],
    "rs": ["Wally"], "e": ["Wally"], "frlg": ["Blue"], "dp": ["Barry"], "pt": ["Barry"],
    "hgss": ["Silver"], "b2w2": ["Hugh", "Hilbert", "Hilda"],
}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("é", "e")).strip("-")


def save(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


def sprite_sheet(game: str, species: list[dict], out: Path) -> dict:
    """Pack every species' sprite into one sheet; returns {name: [x, y, w, h]}."""
    last_dex = soullink.SPRITE_SETS[game][1]
    sprites = []
    for s in species:
        if s["dex"] > last_dex:
            break
        img = soullink.sprite_by_dex(s["dex"], game)
        if img is None:
            print(f"  warning: no {game} sprite for {s['name']}", file=sys.stderr)
            continue
        sprites.append((s["name"], img))
    # simple shelf packing, tallest first
    order = sorted(sprites, key=lambda t: -t[1].height)
    x = y = shelf = 0
    places = {}
    for name, img in order:
        if x + img.width > SHEET_WIDTH:
            x, y, shelf = 0, y + shelf + 1, 0
        places[name] = [x, y, img.width, img.height]
        x += img.width + 1
        shelf = max(shelf, img.height)
    sheet = Image.new("RGBA", (SHEET_WIDTH, y + shelf))
    for name, img in sprites:
        px, py, _, _ = places[name]
        sheet.paste(img, (px, py))
    save(sheet, out / "sprites.png")
    (out / "sprites.json").write_text(json.dumps(places, ensure_ascii=False))
    return places


def build_game(key: str, species: list[dict]) -> dict:
    style = retro.STYLES[key]
    out = DOCS / "assets" / key
    r = retro.Renderer(style)
    save(r.box_src, out / "textbox.png")
    save(r.background, out / "bg.png")

    walls = {}
    for name in retro.wallpapers(style):
        file = f"walls/{slug(name)}.png"
        save(r.cell(name), out / file)
        walls[name] = file
    cell = r.cell(style.default_wallpapers[0] if walls else None).size

    trainers = {}
    for name in [*style.default_trainers, *EXTRA_TRAINERS.get(key, [])]:
        try:
            img = retro.trainer_sprite(style, name)
        except LookupError:
            print(f"  warning: no {key} trainer sprite {name!r}", file=sys.stderr)
            continue
        file = f"trainers/{slug(name)}.png"
        save(img, out / file)
        trainers[name] = file

    places = sprite_sheet(key, species, out)
    print(f"{key:5} {len(walls):2} wallpapers, {len(trainers)} trainers, {len(places)} sprites, "
          f"sheet {(out / 'sprites.png').stat().st_size // 1024} KB")
    return {
        "name": style.name,
        "lastDex": soullink.SPRITE_SETS[key][1],
        "border": list(style.border),
        "textboxSize": list(r.box_src.size),
        "bgSize": list(r.background.size),
        "tileBorder": style.tile_border,
        "textShadow": style.text_shadow,
        "cell": list(cell),
        "labelH": r.label_h,
        "titleH": r.title_h,
        "artInset": r.art_inset(),
        "walls": walls,
        "defaultWalls": list(style.default_wallpapers),
        "trainerWall": style.trainer_wallpaper,
        "trainers": trainers,
        "defaultTrainers": list(style.default_trainers),
    }


def build_common():
    out = DOCS / "assets" / "common"
    for name, file in (("oak_hgss", "Spr_HGSS_Oak.png"), ("oak_frlg", "Spr_FRLG_Oak.png")):
        save(soullink._trim(retro.asset(file)), out / f"{name}.png")
    for name in retro.LINK_CHOICES:
        save(retro.link_icon(name), out / f"link_{name}.png")
    fonts = out / "fonts"
    fonts.mkdir(parents=True, exist_ok=True)
    for f in ("PixelifySans.ttf", "PixelifySans-OFL.txt"):
        shutil.copy(ROOT / "fonts" / f, fonts / f)


def main():
    games = sys.argv[1:] or list(retro.STYLES)
    species = pokedata.species_table()
    data = DOCS / "data"
    data.mkdir(parents=True, exist_ok=True)
    (data / "species.json").write_text(json.dumps(
        [{"dex": s["dex"], "name": s["name"]} for s in species], ensure_ascii=False))
    build_common()
    styles_path = data / "styles.json"
    styles = json.loads(styles_path.read_text()) if styles_path.exists() else {}
    for key in games:
        styles[key] = build_game(key, species)
    # keep games in the generator's order
    styles = {k: styles[k] for k in retro.STYLES if k in styles}
    styles_path.write_text(json.dumps(styles, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
