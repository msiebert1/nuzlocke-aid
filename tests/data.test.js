// Checks the built site data (docs/data, docs/assets) is complete and consistent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const docs = new URL("../docs/", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, docs)));

const styles = json("data/styles.json");
const species = json("data/species.json");
const names = new Set(species.map((s) => s.name));

test("artwork: official for every species, early art for #1-251", () => {
  const art = json("data/art.json");
  assert.equal(art.official.length, species.length, "species missing official artwork");
  assert.equal(art.sugimori.length, 251, "species missing early artwork");
  for (const [set, dexes] of Object.entries(art)) {
    for (const dex of dexes) {
      assert.ok(existsSync(new URL(`assets/art/${set}/${dex}.webp`, docs)), `${set}/${dex}.webp missing`);
    }
  }
});

test("eleven game styles", () => {
  assert.deepEqual(Object.keys(styles),
    ["rb", "y", "gs", "c", "rs", "e", "frlg", "dp", "pt", "hgss", "b2w2"]);
});

for (const [game, style] of Object.entries(styles)) {
  test(`${game}: locations`, () => {
    const { locations } = json(`data/locations/${game}.json`);
    assert.ok(locations.length > 40, "suspiciously few locations");
    assert.equal(locations[0].name, "Starter");
    const seen = new Set();
    for (const loc of locations) {
      assert.ok(!seen.has(loc.name), `duplicate location ${loc.name}`);
      seen.add(loc.name);
      assert.ok(loc.species.length, `${loc.name} has no species`);
      for (const s of loc.species) assert.ok(names.has(s), `${loc.name}: unknown species ${s}`);
    }
  });

  test(`${game}: every species in the game has a sprite`, () => {
    const sheet = json(`assets/${game}/sprites.json`);
    const missing = species.filter((s) => s.dex <= style.lastDex && !sheet[s.name]).map((s) => s.name);
    assert.deepEqual(missing, []);
  });

  test(`${game}: assets exist`, () => {
    for (const file of ["textbox.png", "bg.png", "sprites.png",
                        ...Object.values(style.walls), ...Object.values(style.trainers)]) {
      assert.ok(existsSync(new URL(`assets/${game}/${file}`, docs)), `${game}/${file} missing`);
    }
    for (const t of style.defaultTrainers) assert.ok(style.trainers[t], `default trainer ${t} missing`);
    for (const w of style.defaultWalls) assert.ok(style.walls[w], `default wallpaper ${w} missing`);
  });
}

test("pre-drawn pixel font covers the graphics' text sizes and letters", () => {
  const font = json("assets/common/font/pixelify.json");
  assert.ok(existsSync(new URL("assets/common/font/pixelify.png", docs)));
  for (const size of [8, 9, 10, 11, 12]) {
    for (const ch of "AZaz09 .'-&é") assert.ok(font[size]?.[ch], `size ${size} missing ${JSON.stringify(ch)}`);
  }
});
