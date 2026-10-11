#!/usr/bin/env python3
"""Stamp the site's scripts and stylesheet with a version, so phones load an
update as soon as it's published instead of reusing cached files.

    python3 tools/stamp_version.py        # run before committing a site change

The version is a hash of the code itself, so it only changes when the code
does. It's added to every relative import in docs/js ("./ui.js?v=1a2b3c4d")
and to the stylesheet and script in docs/index.html. GitHub Pages lets
browsers cache each file for 10 minutes, and phones (especially home-screen
web apps) can hold them longer or mix old and new files; a new address per
version avoids both.
"""

import hashlib
import re
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
VERSIONED = re.compile(r"""(["'])((?:\.{1,2}/)[^"'?]+\.(?:js|css))(?:\?v=[0-9a-f]+)?\1""")


def strip(text: str) -> str:
    return re.sub(r"\?v=[0-9a-f]+", "", text)


def main():
    code = sorted(DOCS.glob("js/**/*.js")) + [DOCS / "firebase-config.js", DOCS / "app.css"]
    digest = hashlib.sha1()
    for path in code:
        digest.update(strip(path.read_text()).encode())
    version = digest.hexdigest()[:8]

    changed = 0
    for path in sorted(DOCS.glob("js/**/*.js")):
        text = path.read_text()
        new = VERSIONED.sub(lambda m: f"{m[1]}{m[2]}?v={version}{m[1]}", text)
        if new != text:
            path.write_text(new)
            changed += 1
    index = DOCS / "index.html"
    html = index.read_text()
    new_html = re.sub(r'href="app\.css(?:\?v=[0-9a-f]+)?"', f'href="app.css?v={version}"', html)
    new_html = re.sub(r'src="js/app\.js(?:\?v=[0-9a-f]+)?"', f'src="js/app.js?v={version}"', new_html)
    if new_html != html:
        index.write_text(new_html)
        changed += 1
    print(f"version {version}: {changed} file(s) updated")


if __name__ == "__main__":
    main()
