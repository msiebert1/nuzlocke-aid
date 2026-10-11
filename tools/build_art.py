#!/usr/bin/env python3
"""Build the Pokémon artwork the Nuzlocke Aid site can show instead of sprites.

    python3 tools/build_art.py                 # both sets
    python3 tools/build_art.py official        # just one

Writes docs/assets/art/<set>/<dex>.webp (at most 256px, transparent background)
and docs/data/art.json: {"official": [dex, ...], "sugimori": [dex, ...]}.

  official   Bulbapedia's main image for each species (#1-649), through the
             image generator's cache (soullink.load_artwork).
  sugimori   Ken Sugimori's early artwork from the Red/Green and Gold/Silver
             era (#1-251) from pokemondb.net, whose white backgrounds are
             made transparent. Later Pokémon have no early art; the site uses
             their official artwork instead.
"""

import io
import json
import sys
import time
from collections import deque
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pokedata  # noqa: E402
import soullink  # noqa: E402

DOCS = Path(__file__).resolve().parent.parent / "docs"
MAX_SIZE = 256
POKEMONDB = "https://img.pokemondb.net/artwork/original/{slug}-gen{gen}.jpg"
SUGIMORI_CACHE = soullink.CACHE_DIR / "sugimori"


def shrink(img: Image.Image) -> Image.Image:
    img = soullink._trim(img.convert("RGBA"))
    scale = min(1, MAX_SIZE / max(img.size))
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    return img


def remove_white_background(img: Image.Image, threshold: int = 232) -> Image.Image:
    """Make the near-white background connected to the image's edges transparent
    (white inside the Pokémon, like eyes, is kept), and soften the edge."""
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    light = lambda p: min(p[0], p[1], p[2]) >= threshold
    seen = bytearray(w * h)
    queue = deque((x, y) for x in range(w) for y in (0, h - 1))
    queue.extend((x, y) for y in range(h) for x in (0, w - 1))
    while queue:
        x, y = queue.popleft()
        i = y * w + x
        if seen[i] or not light(px[x, y]):
            continue
        seen[i] = 1
        px[x, y] = (255, 255, 255, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                queue.append((nx, ny))
    # anti-alias: pale pixels touching the cleared background become partly transparent
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            touching = any(0 <= nx < w and 0 <= ny < h and seen[ny * w + nx]
                           for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
            if touching:
                lightness = min(r, g, b)
                px[x, y] = (r, g, b, max(0, min(255, int((255 - lightness) * 255 / (255 - 150)))))
    return img


def save(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=82, method=6)


def build_official(species) -> list[int]:
    done = []
    for s in species:
        out = DOCS / "assets" / "art" / "official" / f"{s['dex']}.webp"
        if not out.exists():
            try:
                art, _ = soullink.load_artwork(s["name"])
            except Exception as e:  # keep going; the site falls back to sprites
                print(f"  warning: no official art for {s['name']}: {e}", file=sys.stderr)
                continue
            save(shrink(art), out)
        done.append(s["dex"])
    return done


def build_sugimori(species) -> list[int]:
    done = []
    SUGIMORI_CACHE.mkdir(parents=True, exist_ok=True)
    for s in species:
        if s["dex"] > 251:
            break
        out = DOCS / "assets" / "art" / "sugimori" / f"{s['dex']}.webp"
        if not out.exists():
            raw = SUGIMORI_CACHE / f"{s['slug']}.jpg"
            if not raw.exists():
                url = POKEMONDB.format(slug=s["slug"], gen=1 if s["dex"] <= 151 else 2)
                r = soullink.session.get(url, timeout=30)
                time.sleep(2)  # pokemondb.net asks crawlers to wait 2s between requests
                if r.status_code != 200:
                    print(f"  warning: no early art for {s['name']} ({r.status_code})", file=sys.stderr)
                    continue
                raw.write_bytes(r.content)
                print(f"  {s['name']}: {url}", file=sys.stderr)
            save(shrink(remove_white_background(Image.open(io.BytesIO(raw.read_bytes())))), out)
        done.append(s["dex"])
    return done


def main():
    sets = sys.argv[1:] or ["official", "sugimori"]
    species = pokedata.species_table()
    index_path = DOCS / "data" / "art.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    if "official" in sets:
        index["official"] = build_official(species)
    if "sugimori" in sets:
        index["sugimori"] = build_sugimori(species)
    index_path.write_text(json.dumps(index))
    for name, dexes in index.items():
        size = sum(f.stat().st_size for f in (DOCS / "assets" / "art" / name).glob("*.webp"))
        print(f"{name}: {len(dexes)} images, {size // 1024} KB")


if __name__ == "__main__":
    main()
