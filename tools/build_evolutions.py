#!/usr/bin/env python3
"""Build docs/data/evolutions.json: what each species can evolve into next.

    python3 tools/build_evolutions.py

{"Charmander": ["Charmeleon"], "Eevee": ["Vaporeon", "Jolteon", ...], ...}
using Bulbapedia display names, from PokeAPI's evolution chains (cached).
The site leaves out evolutions newer than the run's game.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pokedata  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "evolutions.json"


def main():
    names = {s["slug"]: s["name"] for s in pokedata.species_table()}
    chains = pokedata.pokeapi("evolution-chain?limit=1000")["results"]
    evolves = {}

    def walk(link):
        frm = names.get(link["species"]["name"])
        for nxt in link["evolves_to"]:
            to = names.get(nxt["species"]["name"])
            if frm and to:
                evolves.setdefault(frm, [])
                if to not in evolves[frm]:
                    evolves[frm].append(to)
            walk(nxt)

    for i, entry in enumerate(chains, 1):
        chain = pokedata.pokeapi(entry["url"])
        if chain:
            walk(chain["chain"])
        if i % 100 == 0:
            print(f"  {i}/{len(chains)} chains", file=sys.stderr)
    dex = {s["name"]: s["dex"] for s in pokedata.species_table()}
    evolves = {k: sorted(v, key=dex.get) for k, v in sorted(evolves.items(), key=lambda kv: dex[kv[0]])}
    OUT.write_text(json.dumps(evolves, ensure_ascii=False))
    print(f"{len(evolves)} species can evolve; e.g. Eevee -> {evolves.get('Eevee')}")


if __name__ == "__main__":
    main()
