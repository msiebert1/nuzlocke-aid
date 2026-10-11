#!/usr/bin/env python3
"""Developer helper for the retro game styles.

    python3 tools/check_styles.py              # check every style's assets exist
    python3 tools/check_styles.py runs FILE.png row 142   # color runs along row 142
    python3 tools/check_styles.py runs FILE.png col 60    # color runs down column 60

"runs" prints each stretch of identical pixels as (start, end, color), which is
how the text-box border widths and crop boxes in retro.py were measured.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import retro  # noqa: E402
import soullink  # noqa: E402


def runs(file, axis, index):
    img = retro.asset(file).convert("RGB")
    n = img.width if axis == "row" else img.height
    px = [img.getpixel((i, index) if axis == "row" else (index, i)) for i in range(n)]
    start = 0
    for i in range(1, n + 1):
        if i == n or px[i] != px[start]:
            print(f"{start:4}-{i - 1:<4} {px[start]}")
            start = i


def check():
    ok = True
    for key, style in retro.STYLES.items():
        problems = []
        try:
            retro.asset(style.screenshot)
        except Exception as e:
            problems.append(f"screenshot: {e}")
        for trainer in style.default_trainers:
            try:
                retro.trainer_sprite(style, trainer)
            except Exception as e:
                problems.append(f"trainer {trainer}: {e}")
        if style.wallpaper_category:
            try:
                walls = retro.wallpapers(style)
                for w in (*style.default_wallpapers, style.trainer_wallpaper):
                    if w not in walls:
                        problems.append(f"wallpaper {w!r} not in {sorted(walls)}")
            except Exception as e:
                problems.append(f"wallpapers: {e}")
        for mon in ("Pikachu", "Gengar"):
            if not soullink.load_sprite(mon, style.sprite_game):
                problems.append(f"no sprite for {mon}")
        print(f"{key:5} {style.name:24} {'OK' if not problems else ''}")
        for p in problems:
            print(f"        {p}")
        ok &= not problems
    return ok


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "runs":
        runs(sys.argv[2], sys.argv[3], int(sys.argv[4]))
    else:
        sys.exit(0 if check() else 1)
