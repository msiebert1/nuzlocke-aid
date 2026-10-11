"""Shared data helpers for the site build scripts: cached PokeAPI requests and
the species table (National Dex number, PokeAPI slug, Bulbapedia display name).
"""

import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import soullink  # noqa: E402

POKEAPI = "https://pokeapi.co/api/v2"
POKEAPI_CACHE = soullink.CACHE_DIR / "pokeapi"
LAST_DEX = 1025  # through Generation IX (games use their own lower limit)


def pokeapi(path: str) -> dict:
    """GET a PokeAPI resource ("location/route-19" or a full URL), cached on disk."""
    path = path.removeprefix(POKEAPI + "/").strip("/")
    dest = POKEAPI_CACHE / (re.sub(r"[^\w.-]+", "_", path) + ".json")
    if dest.exists():
        return json.loads(dest.read_text())
    for attempt in range(4):
        r = soullink.session.get(f"{POKEAPI}/{path}/", timeout=30)
        if r.status_code == 404:
            data = {}
            break
        if r.ok:
            data = r.json()
            break
        time.sleep(2 ** attempt)
    else:
        r.raise_for_status()
    POKEAPI_CACHE.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data))
    return data


def normalize(name: str) -> str:
    """Comparable form of a Pokémon name: "Nidoran♀" -> "nidoranf", "Mr. Mime" -> "mrmime"."""
    name = name.lower().replace("♀", "f").replace("♂", "m").replace("é", "e")
    return re.sub(r"[^a-z0-9]", "", name)


def species_table() -> list[dict]:
    """[{dex, slug, name}] for every species up to LAST_DEX, in Pokédex order.

    Names are Bulbapedia's (the same names the image generator uses).
    """
    data = pokeapi(f"pokemon-species?limit={LAST_DEX}")
    bulba = {normalize(n): n for n in soullink.species_names()}
    table = []
    for i, entry in enumerate(data["results"], 1):
        name = bulba.get(normalize(entry["name"]))
        if not name:
            raise LookupError(f"No Bulbapedia name for PokeAPI species {entry['name']!r}")
        table.append({"dex": i, "slug": entry["name"], "name": name})
    return table


def species_for_pokemon(slug: str, species_slugs: set[str]) -> str | None:
    """PokeAPI Pokémon slug (may include a form) -> species slug.

    "basculin-red-striped" -> "basculin"; "porygon-z" stays "porygon-z".
    """
    if slug in species_slugs:
        return slug
    parts = slug.split("-")
    for i in range(len(parts) - 1, 0, -1):
        if "-".join(parts[:i]) in species_slugs:
            return "-".join(parts[:i])
    return None
