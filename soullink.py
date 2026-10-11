#!/usr/bin/env python3
"""Generate a team graphic for a Pokémon Soul Link nuzlocke.

Artwork is the primary (official) image from each Pokémon's Bulbapedia page.

Pairs are written as "Player1Mon / Player2Mon". Nicknames go in parentheses,
and regional/alternate forms use a hyphen suffix (or "Alolan X" etc.):

    python3 soullink.py "Pikachu (Sparky) / Eevee" "Raichu-Alola / Mr. Mime" \
        --players Matt Alex -o team.png

    python3 soullink.py -f pairs.txt -o team.png

A game's look (its text boxes, PC box wallpapers and trainer sprites) with that
game's pixel sprites, e.g. Platinum or Black 2/White 2:

    python3 soullink.py -f pairs.txt --theme pt --sprites
    python3 soullink.py -f pairs.txt --theme b2w2 --sprites --wallpapers Snow Beach

A pairs file has one pair per line; blank lines and lines starting with # are
ignored. Lines of the form "players: A, B" and "title: ..." set those options.
"""

import argparse
import io
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

import requests
from PIL import Image, ImageDraw, ImageFont

BULBAPEDIA_API = "https://bulbapedia.bulbagarden.net/w/api.php"
ARCHIVES_API = "https://archives.bulbagarden.net/w/api.php"
USER_AGENT = "soul-link-team-graphic/1.0 (personal nuzlocke tool)"
CACHE_DIR = Path(__file__).resolve().parent / ".artwork_cache"

# "Alolan Vulpix" -> "Vulpix-Alola", etc.
REGIONAL_PREFIXES = {
    "alolan": "Alola",
    "galarian": "Galar",
    "hisuian": "Hisui",
    "paldean": "Paldea",
    "mega": "Mega",
}

# Colors
BG = (24, 26, 33)
CARD = (38, 41, 52)
CARD_EDGE = (58, 62, 78)
TEXT = (236, 238, 244)
SUBTEXT = (150, 156, 175)
LINK = (230, 90, 110)
PLAYER_COLORS = [(96, 165, 250), (251, 146, 60)]

session = requests.Session()
session.headers["User-Agent"] = USER_AGENT


# --------------------------------------------------------------------------
# Input parsing
# --------------------------------------------------------------------------

class Mon:
    def __init__(self, raw: str):
        raw = raw.strip()
        m = re.match(r"^(.*?)\s*\((.+)\)\s*$", raw)
        self.nickname = m.group(2).strip() if m else None
        self.name = (m.group(1) if m else raw).strip()
        if not self.name:
            raise ValueError(f"Empty Pokémon name in {raw!r}")

    @property
    def label(self) -> str:
        return self.nickname or self.name

    @property
    def sublabel(self) -> str | None:
        return self.name if self.nickname else None


def parse_pair(line: str) -> tuple[Mon, Mon]:
    parts = [p for p in re.split(r"\s*[/|]\s*", line.strip()) if p]
    if len(parts) != 2:
        raise ValueError(f"Expected 'Mon A / Mon B', got: {line!r}")
    return Mon(parts[0]), Mon(parts[1])


def read_team_file(path: Path) -> tuple[str | None, list[str] | None, list[str]]:
    """Read a team file: returns (title, players, pair lines)."""
    title = players = None
    lines = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition(":")
        if key.strip().lower() == "players":
            players = [p.strip() for p in re.split(r"[,/|]", value) if p.strip()]
        elif key.strip().lower() == "title":
            title = value.strip()
        else:
            lines.append(line)
    return title, players, lines


def format_mon(name: str, nickname: str | None = None) -> str:
    return f"{name} ({nickname})" if nickname else name


def write_team_file(path: Path, title: str, players: list[str], pair_lines: list[str]):
    """Write a team file that read_team_file (and -f) can load."""
    out = ["# Soul Link team: one pair per line, \"Trainer 1's Pokémon / Trainer 2's Pokémon\"",
           "# Nicknames go in parentheses, e.g. Pikachu (Sparky) / Eevee"]
    if title:
        out.append(f"title: {title}")
    if any(players):
        out.append(f"players: {', '.join(players)}")
    path.write_text("\n".join(out + pair_lines) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------
# Artwork lookup (Bulbapedia)
# --------------------------------------------------------------------------

def _api(url: str, **params) -> dict:
    params.update(format="json", formatversion=2)
    r = session.get(url, params=params, timeout=20)
    r.raise_for_status()
    return r.json()


def _title_variants(name: str) -> list[str]:
    name = re.sub(r"\s+", " ", name.strip())
    variants = [name[:1].upper() + name[1:]]
    # Capitalize after spaces, periods, colons and hyphens ("ho-oh" -> "Ho-Oh")
    variants.append(re.sub(r"(^|[\s.:\-])([a-z])", lambda m: m.group(1) + m.group(2).upper(), name))
    variants.append(name.title())
    return list(dict.fromkeys(variants))


def species_page_image(name: str) -> tuple[str, str, str] | None:
    """Return (page title, image filename, image url) of a species page's primary image."""
    titles = [f"{v} (Pokémon)" for v in _title_variants(name)]
    data = _api(BULBAPEDIA_API, action="query", titles="|".join(titles),
                prop="pageimages", piprop="original|name", redirects=1)
    for page in data["query"]["pages"]:
        if not page.get("missing") and "original" in page:
            return page["title"], page["pageimage"], page["original"]["source"]

    # Fall back to a search for things like odd capitalization or typos.
    data = _api(BULBAPEDIA_API, action="opensearch", search=f"{name} (Pokémon)",
                namespace=0, limit=5, redirects="resolve")
    for title in data[1]:
        if title.endswith("(Pokémon)"):
            return species_page_image_exact(title)
    return None


def species_page_image_exact(title: str) -> tuple[str, str, str] | None:
    data = _api(BULBAPEDIA_API, action="query", titles=title,
                prop="pageimages", piprop="original|name", redirects=1)
    page = data["query"]["pages"][0]
    if page.get("missing") or "original" not in page:
        return None
    return page["title"], page["pageimage"], page["original"]["source"]


def form_artwork_url(stem: str, form: str) -> str | None:
    """Find "<stem>-<form>.png" on the Archives, e.g. 0006Charizard-Mega_X.png."""
    data = _api(ARCHIVES_API, action="query", list="allimages",
                aiprefix=f"{stem}-", ailimit=100)
    want = re.sub(r"[^a-z0-9]", "", form.lower())
    for img in data["query"]["allimages"]:
        suffix = img["name"][len(stem) + 1:].rsplit(".", 1)[0]
        if re.sub(r"[^a-z0-9]", "", suffix.lower()) == want:
            return img["url"]
    return None


def species_names() -> list[str]:
    """All species names on Bulbapedia (cached), for search/autocomplete."""
    cache = CACHE_DIR / "species.json"
    if cache.exists():
        return json.loads(cache.read_text())
    names, params = [], dict(action="query", list="categorymembers", cmlimit=500,
                             cmtitle="Category:Pokémon", cmnamespace=0)
    while True:
        data = _api(BULBAPEDIA_API, **params)
        names += [m["title"].removesuffix(" (Pokémon)") for m in data["query"]["categorymembers"]
                  if m["title"].endswith(" (Pokémon)")]
        if "continue" not in data:
            break
        params.update(data["continue"])
    CACHE_DIR.mkdir(exist_ok=True)
    cache.write_text(json.dumps(names, ensure_ascii=False))
    return names


def normalize_name(name: str) -> str:
    words = name.split()
    if len(words) > 1 and words[0].lower() in REGIONAL_PREFIXES:
        return f"{' '.join(words[1:])}-{REGIONAL_PREFIXES[words[0].lower()]}"
    return name


def find_artwork(name: str) -> dict:
    """Look a Pokémon up on Bulbapedia.

    Returns {"url": artwork url, "display": canonical name, "dex": number,
    "form": form name or ""}.
    """
    name = normalize_name(name)

    def result(url, species, form=""):
        species = species.removesuffix(" (Pokémon)")
        dex = int(re.match(r"\d+", url.rsplit("/", 1)[1]).group())
        display = f"{species}-{form[:1].upper()}{form[1:]}" if form else species
        return {"url": url, "display": display, "dex": dex, "form": form}

    # Whole name first, so species like Ho-Oh / Porygon-Z / Jangmo-o work. Only
    # accept an exact title match: form names like "Raichu-Alola" redirect to
    # the base species page, whose image is the default form.
    found = species_page_image(name)
    if found and found[0].removesuffix(" (Pokémon)").lower() == name.lower():
        return result(found[2], found[0])

    # Otherwise split off a form: "Raichu-Alola" -> 0026Raichu-Alola.png,
    # "Charizard-Mega-X" -> 0006Charizard-Mega_X.png
    parts = name.split("-")
    for i in range(len(parts) - 1, 0, -1):
        species, form = "-".join(parts[:i]), "-".join(parts[i:])
        base = species_page_image(species)
        if not base or base[0].removesuffix(" (Pokémon)").lower() != species.lower():
            continue
        stem = base[1].rsplit(".", 1)[0]
        url = form_artwork_url(stem, form)
        if not url and "-" in stem:  # default art is itself a form, e.g. 0413Wormadam-Plant
            url = form_artwork_url(stem.rsplit("-", 1)[0], form)
        if url:
            return result(url, base[0], form)
        print(f"  warning: no artwork found for form '{form}' of {species}; "
              f"using the default form.", file=sys.stderr)
        return result(base[2], base[0])

    if found:  # close match via search/redirect, e.g. a typo
        return result(found[2], found[0])
    raise LookupError(f"Couldn't find '{name}' on Bulbapedia.")


def _cache_key(name: str) -> str:
    name = normalize_name(name).lower().replace("♀", " f").replace("♂", " m")  # the Nidorans
    return re.sub(r"[^a-z0-9]+", "_", name).strip("_")


def lookup(name: str) -> dict:
    """find_artwork(), cached in .artwork_cache/names.json."""
    CACHE_DIR.mkdir(exist_ok=True)
    index_path = CACHE_DIR / "names.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    key = _cache_key(name)
    if not isinstance(index.get(key), dict):
        index[key] = find_artwork(name)
        index_path.write_text(json.dumps(index, indent=1, ensure_ascii=False))
    return index[key]


def _download(url: str, dest: Path) -> Image.Image:
    if not dest.exists():
        r = session.get(url, timeout=30)
        r.raise_for_status()
        Image.open(io.BytesIO(r.content)).convert("RGBA").save(dest)
    return Image.open(dest).convert("RGBA")


def _trim(img: Image.Image) -> Image.Image:
    bbox = img.getbbox()  # trim transparent padding so sizes are consistent
    return img.crop(bbox) if bbox else img


def load_artwork(name: str) -> tuple[Image.Image, str]:
    """Return (trimmed official artwork, canonical display name)."""
    info = lookup(name)
    dest = CACHE_DIR / f"{_cache_key(name)}.png"
    if not dest.exists():
        print(f"  {name}: {info['url']}", file=sys.stderr)
    return _trim(_download(info["url"], dest)), info["display"]


# Sprite files on Bulbagarden Archives are named "Spr_<code>_<dex><form>[_m|_f][_s][_variant].png",
# e.g. "Spr_4p_479W.png" (Wash Rotom in Platinum) or "Spr_1b_025_GBC.png".
# Each game lists the codes to try in order: later games on the Archives only
# have the sprites that changed, so they fall back to the earlier game's.
SPRITE_SETS = {
    #        codes to try           last dex  preferred variant
    "rb":   (["1y"],                151,      None),   # Yellow's: R/B's GBC colors are one tint
    "y":    (["1y"],                151,      None),
    "gs":   (["2g", "2s"],          251,      None),
    "c":    (["2c"],                251,      None),
    "rs":   (["3r"],                386,      None),
    "e":    (["3e", "3r"],          386,      None),
    "frlg": (["3f", "3r"],          386,      None),
    "dp":   (["4d"],                493,      None),
    "pt":   (["4p", "4d"],          493,      None),
    "hgss": (["4h", "4p", "4d"],    493,      None),
    "b2w2": (["5b2", "5b"],         649,      None),
}

# Forms are marked with a letter, usually the form's first letter; these are
# the exceptions (same letters in Generations IV and V).
FORM_LETTERS = {
    479: {"heat": "O", "wash": "W", "frost": "R", "fan": "F", "mow": "L"},  # Rotom
    412: {"plant": "", "sandy": "G", "trash": "S"},                          # Burmy
    413: {"plant": "", "sandy": "G", "trash": "S"},                          # Wormadam
}


def archive_files(prefix: str) -> dict[str, str]:
    """{filename: url} for every Archives file starting with `prefix`, cached on disk.

    Listing a whole sprite set (e.g. "Spr_4p_") once is far fewer requests
    than searching for each Pokémon.
    """
    index_dir = CACHE_DIR / "archive_index"
    dest = index_dir / f"{prefix}.json"
    if dest.exists():
        return json.loads(dest.read_text())
    files, params = {}, dict(action="query", list="allimages", aiprefix=prefix, ailimit=500,
                             aiprop="url")
    while True:
        data = _api(ARCHIVES_API, **params)
        files.update((img["name"], img["url"]) for img in data["query"]["allimages"])
        if "continue" not in data:
            break
        params.update(data["continue"])
    index_dir.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(files))
    return files


def sprite_by_dex(dex: int, game: str = "b2w2", letter: str = "") -> Image.Image | None:
    """The game's sprite for a National Dex number (and form letter), or None."""
    codes, last_dex, variant = SPRITE_SETS[game]
    if dex > last_dex:  # Pokémon is newer than the game
        return None
    # cache by sprite source (not style) so changing a game's sprite set refetches
    dest = CACHE_DIR / f"sprite_{'-'.join(codes)}{variant or ''}_{dex:03d}{letter}.png"
    if dest.exists():
        return _trim(Image.open(dest).convert("RGBA"))

    candidates = []
    for rank, code in enumerate(codes):
        pattern = re.compile(rf"Spr_{code}_{dex:03d}([A-Za-z]*?)(?:_([mf]))?(_s)?(?:_(\w+))?\.png")
        for filename, url in archive_files(f"Spr_{code}_").items():
            m = pattern.fullmatch(filename)
            if not m or m.group(3) or m.group(1) != letter:
                continue
            if m.group(4) not in (variant, None):  # e.g. a "_GB" when we want "_GBC"
                continue
            # prefer earlier codes, then the wanted variant, then male/genderless
            candidates.append(((rank, m.group(4) != variant, m.group(2) == "f"), url))
    if not candidates:
        return None
    url = min(candidates)[1]
    print(f"  #{dex:03d}{letter} ({game}): {url}", file=sys.stderr)
    return _trim(_download(url, dest))


def load_sprite(name: str, game: str = "b2w2") -> tuple[Image.Image, str] | None:
    """Return (the game's sprite, display name), or None if the game has none."""
    info = lookup(name)
    dex, form = info["dex"], info["form"].lower()
    letter = FORM_LETTERS.get(dex, {}).get(form, form[:1].upper())
    sprite = sprite_by_dex(dex, game, letter)
    if sprite is None and letter:  # form isn't in this game (e.g. Wash Rotom in Diamond/Pearl)
        species = info["display"].rsplit("-", 1)[0]
        found = load_sprite(species, game)
        if found:
            print(f"  warning: {info['display']} has no sprite in this game; "
                  f"using {species}.", file=sys.stderr)
        return found
    return (sprite, info["display"]) if sprite else None


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

FONT_CANDIDATES = {
    True: [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ],
    False: [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ],
}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES[bold]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def fit_text(draw, text, max_width, size, bold=False):
    while size > 10:
        f = font(size, bold)
        if draw.textlength(text, font=f) <= max_width:
            return f
        size -= 1
    return font(size, bold)


def is_sprite(img: Image.Image) -> bool:
    """Pixel sprites are small; official artwork is hundreds of pixels across."""
    return max(img.size) < 200


def common_pixel_scale(images, w: int, h: int) -> int | None:
    """Largest whole-number scale at which every sprite fits a w x h box.

    Scaling all sprites by the same factor keeps their relative sizes (a
    Magnemite stays smaller than a Ho-Oh) while filling the boxes as much as
    possible. Returns None if there are no sprites.
    """
    sprites = [img for img in images if is_sprite(img)]
    if not sprites:
        return None
    return max(1, int(min(min(w / img.width, h / img.height) for img in sprites)))


def paste_fit(canvas: Image.Image, art: Image.Image, box: tuple[int, int, int, int],
              pixel_scale: int | None = None):
    """Center art in box. Artwork is scaled to fill the box; sprites are scaled
    by `pixel_scale` (whole number, crisp pixels), or by the most that fits."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    scale = min(w / art.width, h / art.height)
    if is_sprite(art):
        scale = pixel_scale or max(1, int(scale))
        art = art.resize((art.width * scale, art.height * scale), Image.NEAREST)
    else:
        art = art.resize((max(1, int(art.width * scale)), max(1, int(art.height * scale))),
                         Image.LANCZOS)
    canvas.alpha_composite(art, (x0 + (w - art.width) // 2, y0 + (h - art.height) // 2))


def draw_link_icon(draw: ImageDraw.ImageDraw, cx: int, cy: int, s: int = 14,
                   vertical: bool = False):
    """Two interlocking chain links, side by side or stacked."""
    r = s // 1.6
    for a, b in ((-2 * s, s // 3), (-(s // 3), 2 * s)):
        box = (cx - r, cy + a, cx + r, cy + b) if vertical else (cx + a, cy - r, cx + b, cy + r)
        draw.rounded_rectangle(box, radius=r, outline=LINK, width=4)


MON_LABEL_H, MON_ART_PAD = 58, 10


def draw_mon(canvas, draw, mon: Mon, art, box, accent, pixel_scale=None):
    x0, y0, x1, y1 = box
    label_h = MON_LABEL_H
    paste_fit(canvas, art, (x0 + MON_ART_PAD, y0 + MON_ART_PAD, x1 - MON_ART_PAD, y1 - label_h),
              pixel_scale)
    cx = (x0 + x1) // 2
    f = fit_text(draw, mon.label, x1 - x0 - 12, 24, bold=True)
    draw.text((cx, y1 - label_h + 14), mon.label, font=f, fill=TEXT, anchor="mm")
    if mon.sublabel:
        f2 = fit_text(draw, mon.sublabel, x1 - x0 - 12, 17)
        draw.text((cx, y1 - label_h + 37), mon.sublabel, font=f2, fill=SUBTEXT, anchor="mm")
    draw.rounded_rectangle((x0 + 30, y1 - 6, x1 - 30, y1 - 2), radius=2, fill=accent)


def render(pairs, arts, players, title, out: Path):
    """Player 1's team on the top row, player 2's on the bottom, links aligned."""
    n = len(pairs)
    cell_w, cell_h = 250, 270      # one Pokémon
    link_gap = 44                  # space between the rows for the link icon
    gap, margin = 18, 36
    gutter = 0
    if players:
        names = (players + ["", ""])[:2]
        gutter = int(max(ImageDraw.Draw(Image.new("RGB", (1, 1))).textlength(p, font=font(30, True))
                         for p in names)) + 40
    header_h = 80 if title else 0

    W = margin * 2 + gutter + n * cell_w + (n - 1) * gap
    H = margin * 2 + header_h + 2 * cell_h + link_gap
    canvas = Image.new("RGBA", (W, H), BG + (255,))
    draw = ImageDraw.Draw(canvas)
    # one shared scale for all sprites, sized to the art area inside draw_mon
    pixel_scale = common_pixel_scale([img for pair in arts for img in pair],
                                     cell_w - 16 - 2 * MON_ART_PAD,
                                     cell_h - 10 - MON_ART_PAD - MON_LABEL_H)

    if title:
        draw.text((W // 2, margin + 26), title, font=font(42, True), fill=TEXT, anchor="mm")

    top = margin + header_h
    row_y = [top, top + cell_h + link_gap]
    if players:
        for name, y, color in zip(names, row_y, PLAYER_COLORS):
            draw.text((margin + gutter - 30, y + cell_h // 2), name, font=font(30, True),
                      fill=color, anchor="rm")

    for i, (pair, pair_arts) in enumerate(zip(pairs, arts)):
        x0 = margin + gutter + i * (cell_w + gap)
        # One tall card per linked pair, so the link reads vertically.
        draw.rounded_rectangle((x0, top, x0 + cell_w, top + 2 * cell_h + link_gap), radius=18,
                               fill=CARD, outline=CARD_EDGE, width=2)
        for mon, art, y, color in zip(pair, pair_arts, row_y, PLAYER_COLORS):
            draw_mon(canvas, draw, mon, art, (x0 + 8, y + 6, x0 + cell_w - 8, y + cell_h - 4), color,
                     pixel_scale)
        draw_link_icon(draw, x0 + cell_w // 2, top + cell_h + link_gap // 2, 13, vertical=True)

    canvas.convert("RGB").save(out)
    print(f"Saved {out}", file=sys.stderr)


def make_graphic(pairs: list[tuple[Mon, Mon]], players: list[str], title: str, out: Path,
                 theme: str = "modern", sprites: bool = False, sprite_game: str = "b2w2",
                 **theme_options):
    """Fetch images for every pair and save the team graphic to `out`.

    theme is "modern" or a game style key from retro.STYLES ("rb", "pt", "b2w2", ...).
    sprites=True uses that game's pixel sprites (the modern theme uses
    `sprite_game`'s), falling back to official artwork for Pokémon the game
    doesn't have. theme_options go to retro.render (scale, wallpapers,
    trainers, link).
    """
    import retro
    if theme in retro.STYLES:
        sprite_game = retro.STYLES[theme].sprite_game
    print("Fetching images...", file=sys.stderr)
    images = []
    for pair in pairs:
        row = []
        for mon in pair:
            found = load_sprite(mon.name, sprite_game) if sprites else None
            if sprites and not found:
                print(f"  note: {mon.name} has no sprite in this game; using official artwork.",
                      file=sys.stderr)
            img, mon.name = found or load_artwork(mon.name)
            row.append(img)
        images.append(row)
    if theme in retro.STYLES:
        retro.render(pairs, images, players, title, out, style=theme, **theme_options)
    else:
        render(pairs, images, players, title, out)


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pairs", nargs="*", help='pairs like "Pikachu (Sparky) / Eevee"')
    ap.add_argument("-f", "--file", type=Path, help="read pairs from a text file")
    ap.add_argument("-p", "--players", nargs=2, metavar=("P1", "P2"), help="player names")
    ap.add_argument("-t", "--title", help="title text (default: 'Soul Link')")
    ap.add_argument("-o", "--output", type=Path, default=Path("soul_link_team.png"))
    import retro
    ap.add_argument("--theme", choices=["modern", *retro.STYLES], default="modern",
                    help="modern, or a game style built from that game's art: "
                         + ", ".join(f"{k} ({v.name})" for k, v in retro.STYLES.items()))
    ap.add_argument("--sprites", action="store_true",
                    help="use the game's pixel sprites instead of official artwork")
    ap.add_argument("--sprite-game", choices=list(SPRITE_SETS), default="b2w2",
                    help="modern theme: which game's sprites --sprites uses (default b2w2)")
    ap.add_argument("--wallpapers", nargs=2, metavar=("W1", "W2"),
                    help="game themes: PC box wallpaper for each row (default: Snow Beach)")
    ap.add_argument("--trainer-sprites", nargs=2, metavar=("T1", "T2"),
                    help="game themes: trainer sprite per player, e.g. Lucas Dawn, or none "
                         "(default: the game's two player characters)")
    ap.add_argument("--scale", type=int, default=3, help="game themes: pixel scale (default 3)")
    ap.add_argument("--link", choices=retro.LINK_CHOICES, default="heart",
                    help="game themes: icon joining each pair (default heart)")
    args = ap.parse_args()

    lines = list(args.pairs)
    if args.file:
        title, players, file_lines = read_team_file(args.file)
        lines += file_lines
        args.title = args.title if args.title is not None else title
        args.players = args.players or players
    if not lines:
        ap.error("no pairs given")
    if len(lines) > 6:
        print(f"note: {len(lines)} pairs given; a team is normally 6.", file=sys.stderr)
    if args.title is None:
        args.title = "Soul Link"

    try:
        options = {}
        if args.theme in retro.STYLES:
            style = retro.STYLES[args.theme]
            options.update(scale=args.scale, link=args.link)
            if args.wallpapers:
                walls = retro.wallpapers(style)
                if not walls:
                    ap.error(f"{style.name} has no box wallpapers")
                bad = [w for w in args.wallpapers if w not in walls]
                if bad:
                    ap.error(f"unknown wallpaper {bad[0]!r}; choose from: " + ", ".join(walls))
                options["wallpapers"] = args.wallpapers
            if args.trainer_sprites:
                options["trainers"] = args.trainer_sprites
        make_graphic([parse_pair(line) for line in lines], args.players or [],
                     args.title, args.output, theme=args.theme, sprites=args.sprites,
                     sprite_game=args.sprite_game, **options)
    except (ValueError, LookupError, requests.RequestException) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
