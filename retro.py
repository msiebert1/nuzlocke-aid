"""Game-styled themes (Red/Blue through Black 2/White 2) for the Soul Link graphic.

Everything visual comes from the games themselves (via Bulbagarden Archives):
the party screen's background and dialogue text box, PC box wallpapers behind
each row (Generation III onward), and trainer sprites. Generation I-II games
have no box wallpapers, so their boxes use the game's own text-box frame.
The one exception is the font: the game fonts aren't available, so a free
pixel font (Pixelify Sans, bundled in fonts/) stands in.

Each graphic is laid out at the game's native pixel size and then scaled up by
a whole number, so pixel art stays crisp.
"""

import json
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import soullink

UI_CACHE = soullink.CACHE_DIR / "ui"
FONT_PATH = Path(__file__).resolve().parent / "fonts" / "PixelifySans.ttf"


@dataclass(frozen=True)
class GameStyle:
    name: str                          # shown in the GUI
    sprite_game: str                   # key in soullink.SPRITE_SETS
    screenshot: str                    # party screen on the Archives
    text_box: tuple                    # crop of the dialogue box in the screenshot
    border: tuple                      # its left, top, right, bottom border widths
    background: tuple                  # crop of a repeating background tile, or an RGB color
    trainer_prefixes: tuple            # trainer sprite files are <prefix><Name>.png
    default_trainers: tuple
    wallpaper_category: str | None = None   # None: boxes use the text-box frame
    default_wallpapers: tuple = ()
    trainer_wallpaper: str = ""
    cell: tuple = (112, 114)           # one box holding a sprite, in native pixels
    text_shadow: bool = True
    tile_border: bool = False          # repeat (not stretch) a patterned border


GB_WHITE = (248, 248, 248)
GEN1_BOX, GEN1_BORDER = (0, 96, 160, 144), (7, 7, 7, 7)

STYLES = {
    "rb": GameStyle("Red / Blue", "rb", "RB_Party.png", GEN1_BOX, GEN1_BORDER, GB_WHITE,
                    ("Spr_RB_", "Spr_Y_"), ("Red", "Blue"), cell=(96, 72), text_shadow=False),
    "y": GameStyle("Yellow", "y", "Y_Party.png", GEN1_BOX, GEN1_BORDER, GB_WHITE,
                   ("Spr_Y_",), ("Red", "Blue"), cell=(96, 72), text_shadow=False),
    "gs": GameStyle("Gold / Silver", "gs", "GSC_party.png", (0, 113, 160, 144), (5, 6, 6, 5),
                    GB_WHITE, ("Spr_GS_", "Spr_C_"), ("Ethan", "Kris"), cell=(96, 72),
                    text_shadow=False),
    "c": GameStyle("Crystal", "c", "GSC_party.png", (0, 113, 160, 144), (5, 6, 6, 5),
                   GB_WHITE, ("Spr_C_", "Spr_GS_"), ("Ethan", "Kris"), cell=(96, 72),
                   text_shadow=False),
    "rs": GameStyle("Ruby / Sapphire", "rs", "RS_Party.png", (0, 128, 192, 160), (7, 7, 7, 7),
                    (56, 120, 64, 128), ("Spr_RS_", "Spr_E_"), ("Brendan", "May"),
                    "Ruby_and_Sapphire_Box_wallpapers", ("Snow", "Beach"), "Plain",
                    cell=(112, 104), tile_border=True),
    "e": GameStyle("Emerald", "e", "RS_Party.png", (0, 128, 192, 160), (7, 7, 7, 7),
                   (56, 120, 64, 128), ("Spr_E_", "Spr_RS_"), ("Brendan", "May"),
                   "Emerald_Box_wallpapers", ("Snow", "Beach"), "Simple", cell=(112, 104), tile_border=True),
    "frlg": GameStyle("FireRed / LeafGreen", "frlg", "FRLG_Party.png", (2, 130, 182, 158),
                      (3, 3, 3, 3), (56, 120, 64, 128), ("Spr_FRLG_",), ("Red", "Leaf"),
                      "FireRed_and_LeafGreen_Box_wallpapers", ("Snow", "Beach"), "Simple",
                      cell=(112, 104)),
    "dp": GameStyle("Diamond / Pearl", "dp", "DP_Party.png", (3, 162, 197, 190), (7, 2, 18, 2),
                    (56, 150, 64, 160), ("Spr_DP_",), ("Lucas", "Dawn"),
                    "Diamond_and_Pearl_Box_wallpapers", ("Snow", "Beach"), "Simple",
                    cell=(120, 112)),
    "pt": GameStyle("Platinum", "pt", "Pt_Party.png", (3, 163, 197, 191), (7, 5, 17, 5),
                    (56, 150, 64, 160), ("Spr_Pt_", "Spr_DP_"), ("Lucas", "Dawn"),
                    "Platinum_Box_wallpapers", ("Snow", "Beach"), "Simple", cell=(120, 112)),
    "hgss": GameStyle("HeartGold / SoulSilver", "hgss", "HGSS_Party.png", (4, 353, 196, 383),
                      (8, 5, 20, 6), (136, 216, 216), ("Spr_HGSS_",), ("Ethan", "Lyra"),
                      "HeartGold_and_SoulSilver_Box_wallpapers", ("Snow", "Beach"), "Simple",
                      cell=(120, 112)),
    "b2w2": GameStyle("Black 2 / White 2", "b2w2", "B2W2_Party.png", (2, 354, 184, 384),
                      (2, 4, 4, 6), (64, 64, 96, 96), ("Spr_B2W2_", "Spr_BW_"),
                      ("Nate", "Rosa"), "Black_2_and_White_2_Box_wallpapers",
                      ("Snow", "Beach"), "Simple", cell=(112, 114)),
}

SPLICERS = "Bag_DNA_Splicers_Sprite.png"

# Icon joining each linked pair: a pixel-art heart, or the DNA Splicers item.
# Pixel art below: K = outline, other letters = palette.
LINK_PALETTE = {"K": (40, 40, 48), "R": (232, 64, 80), "r": (168, 32, 56),
                "P": (255, 176, 184)}
LINK_ICONS = {
    "heart": [
        "..KKK...KKK..",
        ".KRRRK.KRRRK.",
        "KRPPRRKRRRRRK",
        "KRPRRRRRRRRRK",
        "KRPRRRRRRRRRK",
        "KRRRRRRRRRRrK",
        ".KRRRRRRRRrK.",
        "..KRRRRRRrK..",
        "...KRRRRrK...",
        "....KRRrK....",
        ".....KrK.....",
        "......K......",
    ],
}
LINK_CHOICES = ["heart", "splicers"]

# Text colors: darker than the games' for readability, with a faint shadow
INK = (56, 56, 64)
INK_SHADOW = (208, 208, 216)
INK_LIGHT = (104, 104, 112)
FONT_SIZE, SMALL_FONT_SIZE = 12, 11
BOX_FILL = (248, 248, 248, 255)

# Layout, in native pixels
ROW_GAP = 22                          # space between the rows (link icon goes here)
COL_GAP = 4
MARGIN = 8


def asset(filename: str) -> Image.Image:
    """Download (once) and open a file from Bulbagarden Archives."""
    filename = filename.replace(" ", "_")
    UI_CACHE.mkdir(parents=True, exist_ok=True)
    dest = UI_CACHE / filename
    if not dest.exists():
        data = soullink._api(soullink.ARCHIVES_API, action="query", titles=f"File:{filename}",
                             prop="imageinfo", iiprop="url")
        page = data["query"]["pages"][0]
        if page.get("missing") or "imageinfo" not in page:
            raise LookupError(f"Couldn't find File:{filename} on Bulbagarden Archives.")
        soullink._download(page["imageinfo"][0]["url"], dest)
    return Image.open(dest).convert("RGBA")


def wallpapers(style: GameStyle) -> dict[str, str]:
    """Display name -> file for the game's PC box wallpapers (cached)."""
    if not style.wallpaper_category:
        return {}
    UI_CACHE.mkdir(parents=True, exist_ok=True)
    cache = UI_CACHE / f"wallpapers_{style.wallpaper_category}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    data = soullink._api(soullink.ARCHIVES_API, action="query", list="categorymembers",
                         cmtitle=f"Category:{style.wallpaper_category}", cmlimit=500,
                         cmnamespace=6)
    walls = {}
    for member in data["query"]["categorymembers"]:
        filename = member["title"].removeprefix("File:")
        # "Box Poké Center V.png" -> "Poké Center": drop "Box " and the game suffix
        name = filename.removeprefix("Box ").rsplit(".", 1)[0].rsplit(" ", 1)[0]
        walls[name] = filename
    cache.write_text(json.dumps(walls, indent=1, ensure_ascii=False))
    return walls


def trainer_sprite(style: GameStyle, name: str) -> Image.Image | None:
    """A trainer sprite by name ("Lucas", "Ace Trainer F", ...), or None for none."""
    if not name or name.lower() == "none":
        return None
    stem = name.strip().replace(" ", "_")
    for prefix in style.trainer_prefixes:
        data = soullink._api(soullink.ARCHIVES_API, action="query", list="allimages",
                             aiprefix=f"{prefix}{stem}", ailimit=50)
        names = [img["name"] for img in data["query"]["allimages"]]
        # skip Game Boy / Japanese / beta variants; prefer the plainest name,
        # e.g. "Spr_RB_Red_2.png" for Red, "Spr_Y_Blue_1.png" for Blue
        names = [n for n in names if n[len(prefix) + len(stem):] in (".png",) or
                 n[len(prefix) + len(stem):].removesuffix(".png").lstrip("_").isdigit()]
        if names:
            return soullink._trim(asset(min(names, key=len)))
    raise LookupError(f"No trainer sprite named {name!r} for {style.name}.")


def link_icon(name: str) -> Image.Image:
    if name == "splicers":
        return asset(SPLICERS)
    rows = LINK_ICONS[name]
    img = Image.new("RGBA", (len(rows[0]), len(rows)))
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            if c != ".":
                img.putpixel((x, y), LINK_PALETTE[c] + (255,))
    return img


def font(size: int = FONT_SIZE) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size)


def _tile(piece: Image.Image, w: int, h: int) -> Image.Image:
    out = Image.new("RGBA", (w, h))
    for x in range(0, w, piece.width):
        for y in range(0, h, piece.height):
            out.paste(piece, (x, y))
    return out


def nine_slice(src: Image.Image, border: tuple[int, int, int, int], w: int, h: int,
               tile: bool = False) -> Image.Image:
    """Resize a bordered box to w x h without distorting its corners. Edges are
    stretched, or repeated (`tile`) so patterned borders keep their pattern."""
    l, t, r, b = border
    sw, sh = src.size
    out = Image.new("RGBA", (w, h))
    xs = [(0, l, 0, l), (l, sw - r, l, w - r), (sw - r, sw, w - r, w)]
    ys = [(0, t, 0, t), (t, sh - b, t, h - b), (sh - b, sh, h - b, h)]
    for sx0, sx1, dx0, dx1 in xs:
        for sy0, sy1, dy0, dy1 in ys:
            if dx1 > dx0 and dy1 > dy0:
                piece = src.crop((sx0, sy0, sx1, sy1))
                size = (dx1 - dx0, dy1 - dy0)
                out.paste(_tile(piece, *size) if tile else piece.resize(size, Image.NEAREST),
                          (dx0, dy0))
    return out


# The pixel font has no gender symbols, so draw them like the game does:
# small colored glyphs (blue for male, red for female).
GENDER_GLYPHS = {
    "♂": ((48, 112, 240), ["...###", ".....#", "....##", ".###.#", "#...#.", "#...#.",
                           "#...#.", ".###.."]),
    "♀": ((232, 72, 72), [".###.", "#...#", "#...#", "#...#", ".###.", "..#..", "#####",
                          "..#..", "..#.."]),
}


def _segments(text):
    """Split text into runs of plain text and gender symbols."""
    out, buf = [], ""
    for ch in text:
        if ch in GENDER_GLYPHS:
            if buf:
                out.append(buf)
            out.append(ch)
            buf = ""
        else:
            buf += ch
    return out + ([buf] if buf else [])


def text_width(draw, text, f) -> int:
    return int(sum(len(GENDER_GLYPHS[s][1][0]) + 2 if s in GENDER_GLYPHS
                   else draw.textlength(s, font=f) for s in _segments(text)))


def shadow_text(draw: ImageDraw.ImageDraw, xy, text, f, fill=INK, shadow=True):
    """Centered text, optionally with a drop shadow."""
    cx, cy = xy
    x = cx - text_width(draw, text, f) // 2
    for seg in _segments(text):
        if seg in GENDER_GLYPHS:
            color, rows = GENDER_GLYPHS[seg]
            x += 1  # breathing room after the name
            top = cy - len(rows) // 2
            layers = ([(INK_SHADOW, (1, 1))] if shadow else []) + [(color, (0, 0))]
            for color_, (dx, dy) in layers:
                for j, row in enumerate(rows):
                    for i, c in enumerate(row):
                        if c == "#":
                            draw.point((x + i + dx, top + j + dy), fill=color_)
            x += len(rows[0]) + 1
        else:
            if shadow:
                draw.text((x + 1, cy + 1), seg, font=f, fill=INK_SHADOW, anchor="lm")
            draw.text((x, cy), seg, font=f, fill=fill, anchor="lm")
            x += draw.textlength(seg, font=f)


def fit_font(draw, text, max_w, size=FONT_SIZE):
    f = font(size)
    while size > 8 and text_width(draw, text, f) > max_w:
        size -= 1
        f = font(size)
    return f


class Renderer:
    """Holds one style's prepared assets and draws its boxes."""

    def __init__(self, style: GameStyle):
        self.style = style
        shot = asset(style.screenshot)
        self.box_src = shot.crop(style.text_box)
        # blank out the screenshot's "Choose a Pokémon." text, keeping the border
        l, t, r, b = style.border
        ImageDraw.Draw(self.box_src).rectangle(
            (l, t, self.box_src.width - r - 1, self.box_src.height - b - 1), fill=BOX_FILL)
        bg = style.background
        self.background = shot.crop(bg) if len(bg) == 4 else Image.new("RGBA", (8, 8), bg)
        # Label boxes hold two lines of text inside the border
        self.label_h = max(34, t + b + 24)
        self.title_h = max(26, t + b + 14)

    def text_box(self, canvas, x, y, w, h, lines):
        """Draw the game's dialogue box with up to two lines of text."""
        l, t, r, b = self.style.border
        canvas.alpha_composite(nine_slice(self.box_src, self.style.border, w, h, self.style.tile_border), (x, y))
        draw = ImageDraw.Draw(canvas)
        draw.fontmode = "1"  # no anti-aliasing: real pixel text
        cx, mid = x + w // 2, y + (t + h - b) // 2
        shadow = self.style.text_shadow
        lines = [line for line in lines if line]
        if len(lines) == 1:
            shadow_text(draw, (cx, mid + 2), lines[0], fit_font(draw, lines[0], w - l - r - 4),
                        shadow=shadow)
        elif lines:
            shadow_text(draw, (cx, mid - 5), lines[0], fit_font(draw, lines[0], w - l - r - 4),
                        shadow=shadow)
            shadow_text(draw, (cx, mid + 7), lines[1],
                        fit_font(draw, lines[1], w - l - r - 4, SMALL_FONT_SIZE),
                        fill=INK_LIGHT, shadow=shadow)

    def cell(self, wallpaper: str | None) -> Image.Image:
        """The box behind a sprite: a wallpaper, or the text-box frame (Gen I-II)."""
        w, h = self.style.cell
        if not self.style.wallpaper_category:
            return nine_slice(self.box_src, self.style.border, w, h, self.style.tile_border)
        img = asset(wallpapers(self.style)[wallpaper])
        # The wallpaper is a name plate, a transparent gap, then the opaque
        # body (sometimes with a transparent edge): use the longest opaque run
        alpha = img.getchannel("A")
        opaque = [all(alpha.getpixel((x, y)) == 255 for x in range(img.width))
                  for y in range(img.height)]
        best, start = (0, 0), None
        for y, op in enumerate(opaque + [False]):
            if op and start is None:
                start = y
            elif not op and start is not None:
                best = max(best, (y - start, start))
                start = None
        length, top = best
        body = img.crop((0, top, img.width, top + length))
        x0 = (body.width - w) // 2
        return body.crop((x0, 0, x0 + w, min(h, body.height)))

    def art_inset(self) -> int:
        return 4 if self.style.wallpaper_category else max(self.style.border) + 1


def render(pairs, images, players, title, out: Path, *, style="b2w2", scale=3,
           wallpapers=None, trainers=None, link="heart", **_):
    """Render a game-styled graphic.

    `images` holds one (img, img) per pair: pixel sprites, or official artwork
    (which is drawn at full resolution).
    """
    style = STYLES[style]
    r = Renderer(style)
    wallpapers = wallpapers or style.default_wallpapers or (None, None)
    trainers = trainers if trainers is not None else style.default_trainers
    icon = link_icon(link)
    cells = [r.cell(w) for w in wallpapers]
    trainer_cell = r.cell(style.trainer_wallpaper or None)
    trainer_imgs = [trainer_sprite(style, t) for t in trainers]
    cell_w, cell_h = cells[0].size

    n = len(pairs)
    has_gutter = bool(players) or any(trainer_imgs)
    row_h = cell_h + r.label_h
    first_col = MARGIN + ((cell_w + COL_GAP) if has_gutter else 0)
    W = first_col + n * cell_w + (n - 1) * COL_GAP + MARGIN
    H = MARGIN + (r.title_h + 8 if title else 0) + 2 * row_h + ROW_GAP + MARGIN

    canvas = Image.new("RGBA", (W, H))
    canvas.paste(_tile(r.background, W, H), (0, 0))

    if title:
        draw = ImageDraw.Draw(canvas)
        l, _, rb, _ = style.border
        tw = text_width(draw, title, font()) + 18 + l + rb
        r.text_box(canvas, (W - tw) // 2, MARGIN, tw, r.title_h, [title])

    top = MARGIN + (r.title_h + 8 if title else 0)
    row_y = [top, top + row_h + ROW_GAP]

    # Sprites and artwork are drawn after upscaling, centered in their boxes.
    # All Pokémon sprites share one scale so their relative sizes stay correct;
    # the trainer sprites get their own.
    jobs = []  # (image, native-pixel box, pixel scale)
    inset = r.art_inset()

    def art_box(x, y):
        return (x + inset, y + inset, x + cell_w - inset, y + cell_h - inset)

    box_w, box_h = (cell_w - 2 * inset) * scale, (cell_h - 2 * inset) * scale

    # Trainer column: plain box with the trainer sprite, name below
    if has_gutter:
        names = (list(players) + ["", ""])[:2]
        trainer_scale = soullink.common_pixel_scale([t for t in trainer_imgs if t], box_w, box_h)
        for y, sprite, name in zip(row_y, trainer_imgs, names):
            canvas.alpha_composite(trainer_cell, (MARGIN, y))
            if sprite:
                jobs.append((sprite, art_box(MARGIN, y), trainer_scale))
            r.text_box(canvas, MARGIN, y + cell_h, cell_w, r.label_h, [name or " "])

    # Pairs: player 1 on top, player 2 below, link icon between them
    mon_scale = soullink.common_pixel_scale([img for pair in images for img in pair], box_w, box_h)
    for i, (pair, imgs) in enumerate(zip(pairs, images)):
        x = first_col + i * (cell_w + COL_GAP)
        for mon, img, y, cell in zip(pair, imgs, row_y, cells):
            canvas.alpha_composite(cell, (x, y))
            jobs.append((img, art_box(x, y), mon_scale))
            r.text_box(canvas, x, y + cell_h, cell_w, r.label_h, [mon.label, mon.sublabel])
        canvas.alpha_composite(icon, (x + (cell_w - icon.width) // 2,
                                      row_y[1] - ROW_GAP // 2 - icon.height // 2))

    canvas = canvas.resize((W * scale, H * scale), Image.NEAREST)
    for img, (x0, y0, x1, y1), pixel_scale in jobs:
        soullink.paste_fit(canvas, img, (x0 * scale, y0 * scale, x1 * scale, y1 * scale),
                           pixel_scale)

    canvas.convert("RGB").save(out)
    print(f"Saved {out}", file=sys.stderr)
