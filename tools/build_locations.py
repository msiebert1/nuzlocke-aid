#!/usr/bin/env python3
"""Build each game's encounter-location list for the Nuzlocke Aid site.

    python3 tools/build_locations.py            # all games
    python3 tools/build_locations.py pt b2w2    # just these

For every game this writes docs/data/locations/<game>.json:

    {"game": "b2w2", "locations": [{"name": "Starter", "species": [...]},
                                   {"name": "Route 19", "species": [...]}, ...]}

Locations are the places with wild Pokémon in that game's versions (from
PokeAPI), ordered by when the Bulbapedia walkthrough first reaches them.
Wild locations the walkthrough never names go at the end. The output is meant
to be committed and can be edited by hand.
"""

import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pokedata  # noqa: E402
import soullink  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "data" / "locations"
BULBAPEDIA_API = "https://bulbapedia.bulbagarden.net/w/api.php"

# game key -> (walkthrough title, PokeAPI regions, PokeAPI versions, starters)
GAMES = {
    "rb": ("Red and Blue", ["kanto"], ["red", "blue"],
           ["Bulbasaur", "Charmander", "Squirtle"]),
    "y": ("Yellow", ["kanto"], ["yellow"], ["Pikachu"]),
    "gs": ("Gold and Silver", ["johto", "kanto"], ["gold", "silver"],
           ["Chikorita", "Cyndaquil", "Totodile"]),
    "c": ("Crystal", ["johto", "kanto"], ["crystal"], ["Chikorita", "Cyndaquil", "Totodile"]),
    "rs": ("Ruby and Sapphire", ["hoenn"], ["ruby", "sapphire"], ["Treecko", "Torchic", "Mudkip"]),
    "e": ("Emerald", ["hoenn"], ["emerald"], ["Treecko", "Torchic", "Mudkip"]),
    "frlg": ("FireRed and LeafGreen", ["kanto"], ["firered", "leafgreen"],
             ["Bulbasaur", "Charmander", "Squirtle"]),
    "dp": ("Diamond and Pearl", ["sinnoh"], ["diamond", "pearl"], ["Turtwig", "Chimchar", "Piplup"]),
    "pt": ("Platinum", ["sinnoh"], ["platinum"], ["Turtwig", "Chimchar", "Piplup"]),
    "hgss": ("HeartGold and SoulSilver", ["johto", "kanto"], ["heartgold", "soulsilver"],
             ["Chikorita", "Cyndaquil", "Totodile"]),
    "b2w2": ("Black 2 and White 2", ["unova"], ["black-2", "white-2"],
             ["Snivy", "Tepig", "Oshawott"]),
}


def bulbapedia(**params) -> dict:
    params.update(format="json")
    r = soullink.session.get(BULBAPEDIA_API, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def walkthrough_headings(title: str) -> list[str]:
    """Every section heading of the game's walkthrough parts, in order."""
    found = bulbapedia(action="query", list="prefixsearch", pssearch=f"Walkthrough:Pokémon {title}/",
                       pslimit=100)["query"]["prefixsearch"]
    parts = sorted((p["title"] for p in found if re.search(r"/Part \d+$", p["title"])),
                   key=lambda t: int(t.rsplit(" ", 1)[1]))
    headings = []
    for part in parts:
        sections = bulbapedia(action="parse", page=part, prop="sections")["parse"]["sections"]
        headings += [html.unescape(re.sub(r"<[^>]+>", "", s["line"])) for s in sections]
    return headings


REGIONS = ("Kanto", "Johto", "Hoenn", "Sinnoh", "Unova")


def display_name(pokeapi_name: str) -> str | None:
    """Name as the games show it, or None for PokeAPI pseudo-locations.

    "Sea Route 19" -> "Route 19", "Kanto Power Plant" -> "Power Plant";
    "Roaming Johto" and "Unknown; all Rattata" are dropped.
    """
    name = pokeapi_name.strip()
    if name.startswith(("Roaming ", "Unknown")) or ";" in name:
        return None
    name = name.removeprefix("Sea ")
    for region in REGIONS:
        if name.startswith(region + " ") and not name.startswith(region + " Route"):
            name = name.removeprefix(region + " ")
    return name


def heading_variants(heading: str) -> list[str]:
    """A heading plus each route it names: "Routes 132, 133 and 134" also
    gives "Route 132", "Route 133" and "Route 134"."""
    variants = [heading]
    for m in re.finditer(r"Routes? ((?:\d+(?:,? (?:and|&) |, |/| ?- ?)?)+)", heading):
        variants += [f"Route {n}" for n in re.findall(r"\d+", m.group(1))]
    return variants


def key(name: str) -> str:
    return " " + re.sub(r"[^a-z0-9]+", " ", name.lower().replace("é", "e")).strip() + " "


def wild_locations(regions, versions, species_slugs, names_by_slug):
    """{English location name: set of species names} for places with wild
    Pokémon in any of `versions`. Multi-area places are merged."""
    found = {}
    for region in regions:
        for loc in pokedata.pokeapi(f"region/{region}")["locations"]:
            location = pokedata.pokeapi(loc["url"])
            name = next((n["name"] for n in location.get("names", [])
                         if n["language"]["name"] == "en"), None)
            name = name and display_name(name)
            if not name:
                continue
            for area in location.get("areas", []):
                for enc in pokedata.pokeapi(area["url"]).get("pokemon_encounters", []):
                    if not any(v["version"]["name"] in versions for v in enc["version_details"]):
                        continue
                    species = pokedata.species_for_pokemon(enc["pokemon"]["name"], species_slugs)
                    if species:
                        found.setdefault(name, set()).add(names_by_slug[species])
    return found


def build(game: str, species_table) -> dict:
    title, regions, versions, starters = GAMES[game]
    names_by_slug = {s["slug"]: s["name"] for s in species_table}
    dex_of = {s["name"]: s["dex"] for s in species_table}
    wild = wild_locations(regions, versions, set(names_by_slug), names_by_slug)

    # Order by first mention in the walkthrough; a heading like "Viridian City
    # (revisited)" counts for the longest location name it contains.
    by_length = sorted(wild, key=len, reverse=True)
    order = []
    for heading in walkthrough_headings(title):
        for variant in heading_variants(heading):
            h = key(variant)
            match = next((n for n in by_length if key(n) in h), None)
            if match and match not in order:
                order.append(match)
    unmentioned = sorted(set(wild) - set(order), key=lambda n: [int(t) if t.isdigit() else t
                                                                for t in re.split(r"(\d+)", n)])
    locations = [{"name": "Starter", "species": starters}]
    for name in order + unmentioned:
        locations.append({"name": name, "species": sorted(wild[name], key=dex_of.get)})
    return {"game": game, "locations": locations, "walkthrough_order": len(order)}


def main():
    games = sys.argv[1:] or list(GAMES)
    table = pokedata.species_table()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for game in games:
        data = build(game, table)
        ordered = data.pop("walkthrough_order")
        (OUT_DIR / f"{game}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False))
        names = [loc["name"] for loc in data["locations"]]
        print(f"{game:5} {len(names):3} locations ({ordered} in walkthrough order, "
              f"{len(names) - 1 - ordered} appended)")
        print("      " + " > ".join(names[:15]))


if __name__ == "__main__":
    main()
