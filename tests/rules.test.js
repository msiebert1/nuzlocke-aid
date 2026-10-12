import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../docs/js/rules.js";

const LOCS = [
  { name: "Starter", species: ["Snivy"] },
  { name: "Route 19", species: ["Patrat"] },
  { name: "Route 20", species: ["Lillipup"] },
];

function newRun(mode = "single") {
  return {
    name: "Test", game: "b2w2", mode,
    players: mode === "soul" ? [{ name: "Matt" }, { name: "Callie" }] : [{ name: "Matt" }],
    options: {}, customLocations: [], encounters: [],
  };
}

function catchAt(run, location, species, opts = {}) {
  return R.logCatch(run, { location, player: 0, species, status: "caught", ...opts });
}

test("logging a location removes it from the pool", () => {
  let { run } = catchAt(newRun(), "Starter", "Snivy");
  assert.deepEqual(R.remainingLocations(run, LOCS).map((l) => l.name), ["Route 19", "Route 20"]);
});

test("soul link: a location stays open until both players log it", () => {
  let run = newRun("soul");
  ({ run } = R.logCatch(run, { location: "Route 19", player: 0, species: "Patrat", status: "caught" }));
  const r19 = R.remainingLocations(run, LOCS).find((l) => l.name === "Route 19");
  assert.deepEqual(r19.waiting, [1]);
  let needs;
  ({ run, needsPlacement: needs } = R.logCatch(run, { location: "Route 19", player: 1, species: "Purrloin", status: "caught" }));
  assert.equal(needs, true);
  assert.ok(!R.remainingLocations(run, LOCS).some((l) => l.name === "Route 19"));
  assert.equal(run.encounters.length, 1);
  assert.equal(run.encounters[0].catches.length, 2);
});

test("soul link: logEncounter logs both players with one status", () => {
  let res = R.logEncounter(newRun("soul"), {
    location: "Route 19", status: "caught",
    catches: [{ player: 0, species: "Patrat", nickname: "Pat" }, { player: 1, species: "Purrloin" }],
  });
  assert.equal(res.needsPlacement, true);
  assert.equal(res.run.encounters.length, 1);
  assert.deepEqual(res.run.encounters[0].catches.map((c) => [c.species, c.status]),
                   [["Patrat", "caught"], ["Purrloin", "caught"]]);
  assert.ok(!R.remainingLocations(res.run, LOCS).some((l) => l.name === "Route 19"));

  res = R.logEncounter(res.run, { location: "Route 20", status: "failed",
                                  catches: [{ player: 0, species: "" }, { player: 1, species: "" }] });
  assert.equal(res.needsPlacement, false);
  assert.ok(res.run.encounters[1].catches.every((c) => c.status === "failed"));

  // caught needs both Pokémon; and both players must be included
  assert.throws(() => R.logEncounter(newRun("soul"), { location: "Starter", status: "caught",
    catches: [{ player: 0, species: "Snivy" }, { player: 1, species: "" }] }), /Callie/);
  assert.throws(() => R.logEncounter(newRun("soul"), { location: "Starter", status: "caught",
    catches: [{ player: 0, species: "Snivy" }] }), R.RuleError);
});

test("first catch needs placement; failed and invalid ones never do", () => {
  let run = newRun();
  let res = catchAt(run, "Starter", "Snivy");
  assert.equal(res.needsPlacement, true);
  res = R.logCatch(res.run, { location: "Route 19", player: 0, species: "Patrat", status: "failed" });
  assert.equal(res.needsPlacement, false);
  res = R.logCatch(res.run, { location: "Route 20", player: 0, species: "", status: "invalid" });
  assert.equal(res.needsPlacement, false);
  assert.throws(() => R.place(res.run, res.id, "party"), R.RuleError);
});

test("soul link pair with one failure can't be placed", () => {
  let run = newRun("soul");
  let res = R.logCatch(run, { location: "Route 19", player: 0, species: "Patrat", status: "caught" });
  res = R.logCatch(res.run, { location: "Route 19", player: 1, species: "Purrloin", status: "failed" });
  assert.equal(res.needsPlacement, false);
  assert.throws(() => R.place(res.run, res.id, "box"), R.RuleError);
});

test("party holds six; a seventh needs a swap or goes to the box", () => {
  let run = newRun();
  const ids = [];
  for (let i = 0; i < 7; i++) {
    const res = catchAt(run, `Spot ${i}`, `Mon ${i}`);
    run = res.run;
    ids.push(res.id);
  }
  for (const id of ids.slice(0, 6)) run = R.place(run, id, "party");
  assert.equal(R.party(run).length, 6);
  assert.throws(() => R.place(run, ids[6], "party"), /full/);

  const boxed = R.place(run, ids[6], "box");
  assert.equal(R.box(boxed).length, 1);

  const swapped = R.place(run, ids[6], "party", ids[2]);
  assert.equal(R.party(swapped).length, 6);
  assert.deepEqual(R.box(swapped).map((e) => e.id), [ids[2]]);
  // the newcomer takes the swapped member's slot
  assert.equal(R.party(swapped)[2].id, ids[6]);
});

test("box <-> party swap", () => {
  let run = newRun();
  const ids = [];
  for (let i = 0; i < 7; i++) {
    const res = catchAt(run, `Spot ${i}`, `Mon ${i}`);
    run = res.run;
    ids.push(res.id);
    run = R.place(run, res.id, i < 6 ? "party" : "box");
  }
  run = R.place(run, ids[6], "party", ids[0]);
  assert.equal(R.party(run)[0].id, ids[6]);
  assert.deepEqual(R.box(run).map((e) => e.id), [ids[0]]);
});

test("fainting moves the whole soul-linked pair to the graveyard", () => {
  let run = newRun("soul");
  let res = R.logCatch(run, { location: "Route 19", player: 0, species: "Patrat", status: "caught" });
  res = R.logCatch(res.run, { location: "Route 19", player: 1, species: "Purrloin", status: "caught" });
  run = R.place(res.run, res.id, "party");
  run = R.faint(run, res.id);
  assert.equal(R.party(run).length, 0);
  assert.equal(R.graveyard(run).length, 1);
  assert.equal(R.graveyard(run)[0].catches.length, 2);
  assert.throws(() => R.faint(run, res.id), R.RuleError);
});

test("party slots stay compact after fainting", () => {
  let run = newRun();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const res = catchAt(run, `Spot ${i}`, `Mon ${i}`);
    run = R.place(res.run, res.id, "party");
    ids.push(res.id);
  }
  run = R.faint(run, ids[0]);
  assert.deepEqual(R.party(run).map((e) => e.partySlot), [0, 1]);
  assert.deepEqual(R.party(run).map((e) => e.id), [ids[1], ids[2]]);
});

test("custom locations join the pool after the game's", () => {
  let run = R.addCustomLocation(newRun(), "Hidden Grotto ");
  run = R.addCustomLocation(run, "Hidden Grotto");
  const names = R.remainingLocations(run, LOCS).map((l) => l.name);
  assert.deepEqual(names, ["Starter", "Route 19", "Route 20", "Hidden Grotto"]);
  assert.throws(() => R.addCustomLocation(run, "  "), R.RuleError);
});

test("deleting an encounter returns its location to the pool", () => {
  let res = catchAt(newRun(), "Route 19", "Patrat");
  let run = R.place(res.run, res.id, "party");
  run = R.deleteEncounter(run, res.id);
  assert.ok(R.remainingLocations(run, LOCS).some((l) => l.name === "Route 19"));
  assert.equal(R.party(run).length, 0);
});

test("deleting one soul-link catch reopens the location for that player only", () => {
  let res = R.logCatch(newRun("soul"), { location: "Route 19", player: 0, species: "Patrat", status: "caught" });
  res = R.logCatch(res.run, { location: "Route 19", player: 1, species: "Purrloin", status: "caught" });
  const run = R.deleteCatch(res.run, res.id, 1);
  assert.deepEqual(R.remainingLocations(run, LOCS).find((l) => l.name === "Route 19").waiting, [1]);
});

test("editing a party member's catch to failed removes it from the party", () => {
  let res = catchAt(newRun(), "Route 19", "Patrat");
  let run = R.place(res.run, res.id, "party");
  run = R.editCatch(run, res.id, 0, { status: "failed" });
  assert.equal(R.party(run).length, 0);
  assert.equal(run.encounters[0].place, "none");
});

test("re-logging a player's catch replaces it", () => {
  let res = catchAt(newRun(), "Route 19", "Patrat");
  res = catchAt(res.run, "Route 19", "Purrloin", { nickname: " Sly " });
  assert.equal(res.run.encounters[0].catches.length, 1);
  assert.equal(res.run.encounters[0].catches[0].species, "Purrloin");
  assert.equal(res.run.encounters[0].catches[0].nickname, "Sly");
});

test("rules never mutate the run they're given", () => {
  const run = newRun();
  const before = JSON.stringify(run);
  catchAt(run, "Route 19", "Patrat");
  R.addCustomLocation(run, "X");
  assert.equal(JSON.stringify(run), before);
});

test("bad input is rejected", () => {
  assert.throws(() => R.logCatch(newRun(), { location: "A", player: 0, species: "X", status: "maybe" }), R.RuleError);
  assert.throws(() => R.logCatch(newRun(), { location: "A", player: 1, species: "X", status: "caught" }), R.RuleError);
  assert.throws(() => R.logCatch(newRun(), { location: "A", player: 0, species: "", status: "caught" }), R.RuleError);
  assert.throws(() => R.logCatch(newRun(), { location: "", player: 0, species: "X", status: "caught" }), R.RuleError);
});

test("movePartySlot reorders the party", () => {
  let run = newRun();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const res = catchAt(run, `Spot ${i}`, `Mon ${i}`);
    run = R.place(res.run, res.id, "party");
    ids.push(res.id);
  }
  run = R.movePartySlot(run, ids[2], -1);
  assert.deepEqual(R.party(run).map((e) => e.id), [ids[0], ids[2], ids[1]]);
  run = R.movePartySlot(run, ids[0], -1); // already first: no change
  assert.deepEqual(R.party(run).map((e) => e.id), [ids[0], ids[2], ids[1]]);
});

test("pasted location lists: trimmed, blank and repeated lines dropped, capped", () => {
  assert.deepEqual(R.parseLocationList(" Starter\n\nRoute 1\r\nroute 1\n  Route 2  \n"),
                   ["Starter", "Route 1", "Route 2"]);
  assert.equal(R.parseLocationList(Array.from({ length: 150 }, (_, i) => `Spot ${i}`).join("\n")).length, 100);
});

test("a generic game's locations come only from the run", () => {
  let run = R.setCustomLocations(newRun(), ["Starter", "Route 1"]);
  assert.deepEqual(R.remainingLocations(run, []).map((l) => l.name), ["Starter", "Route 1"]);
  run = R.logEncounter(run, { location: "Starter", status: "caught",
                              catches: [{ player: 0, species: "Sprigatito" }] }).run;
  assert.deepEqual(R.remainingLocations(run, []).map((l) => l.name), ["Route 1"]);
  // removing a logged location from the list keeps its encounter
  run = R.setCustomLocations(run, ["Route 1"]);
  assert.equal(run.encounters.length, 1);
});

test("added locations are capped", () => {
  let run = R.setCustomLocations(newRun(), Array.from({ length: 100 }, (_, i) => `Spot ${i}`));
  assert.throws(() => R.addCustomLocation(run, "One more"), /at most 100/);
  run = R.addCustomLocation(run, "Spot 3"); // already there: fine
  assert.equal(run.customLocations.length, 100);
});

test("share post lists the team and the run's tally", () => {
  let run = newRun("soul");
  let res = R.logEncounter(run, { location: "Starter", status: "caught",
    catches: [{ player: 0, species: "Snivy", nickname: "Ivy" }, { player: 1, species: "Tepig" }] });
  run = R.place(res.run, res.id, "party");
  res = R.logEncounter(run, { location: "Route 19", status: "failed",
    catches: [{ player: 0, species: "" }, { player: 1, species: "" }] });
  run = res.run;
  const post = R.sharePost(run, "team", { game: "Black 2 / White 2", site: "https://example.com/" });
  assert.match(post, /^🔗 Soul link: Test \(Black 2 \/ White 2\)/);
  assert.match(post, /Matt & Callie's team:\n• Ivy \(Snivy\) 🔗 Tepig/);
  assert.match(post, /📍 2 encounters · ✅ 1 caught · 🪦 0 lost/);
  assert.match(post, /https:\/\/example\.com\/$/);
  assert.match(R.sharePost(run, "graveyard", { game: "X" }), /In memory of:\n\(none yet\)/);
});

test("evolving keeps the nickname, link and place, and remembers the original", () => {
  let res = R.logEncounter(newRun("soul"), { location: "Starter", status: "caught",
    catches: [{ player: 0, species: "Snivy", nickname: "Ivy" }, { player: 1, species: "Tepig" }] });
  let run = R.place(res.run, res.id, "party");
  run = R.evolveCatch(run, res.id, 0, "Servine");
  run = R.evolveCatch(run, res.id, 0, "Serperior");
  const [a, b] = run.encounters[0].catches;
  assert.deepEqual([a.species, a.nickname, a.caughtAs], ["Serperior", "Ivy", "Snivy"]);
  assert.deepEqual([b.species, b.caughtAs], ["Tepig", undefined]);
  assert.equal(R.party(run).length, 1);
  assert.throws(() => R.evolveCatch(run, res.id, 1, ""), R.RuleError);
});

test("evolution options leave out Pokémon the game doesn't have", () => {
  const evo = { Eevee: ["Vaporeon", "Jolteon", "Flareon", "Espeon", "Umbreon"] };
  const gen1 = new Set(["Vaporeon", "Jolteon", "Flareon"]);
  assert.deepEqual(R.evolutionOptions("Eevee", evo, (n) => gen1.has(n)), ["Vaporeon", "Jolteon", "Flareon"]);
  assert.deepEqual(R.evolutionOptions("Mew", evo), []);
});

test("randomizer runs are flagged in the share post", () => {
  const run = { ...newRun(), options: { randomizer: true } };
  assert.equal(R.isRandomizer(run), true);
  assert.equal(R.isRandomizer(newRun()), false);
  assert.match(R.sharePost(run, "team", { game: "Emerald" }), /^⚔️ Nuzlocke \(randomizer\): Test \(Emerald\)/);
});

test("victory needs the Champion; an ended run is frozen until reopened", () => {
  let run = newRun();
  assert.throws(() => R.endRun(run, "victory"), /Champion/);
  run = R.setMilestone(run, "champion", true);
  run = R.endRun(run, "victory");
  assert.equal(R.isOver(run), true);
  assert.deepEqual([run.result.outcome, run.result.reason], ["victory", "champion"]);
  assert.throws(() => R.logEncounter(run, { location: "Route 19", status: "caught",
    catches: [{ player: 0, species: "Patrat" }] }), /ended/);
  assert.match(R.sharePost(run, "team", { game: "X" }), /Victory/);
  run = R.reopenRun(run);
  assert.equal(R.isOver(run), false);
  assert.ok(!run.events.some((e) => e.type === "end"));
});

test("defeat: wiped out only when nobody is left; abandoning any time", () => {
  let res = R.logEncounter(newRun(), { location: "Starter", status: "caught", catches: [{ player: 0, species: "Snivy" }] });
  let run = R.place(res.run, res.id, "party");
  assert.equal(R.isWipedOut(run), false);
  assert.throws(() => R.endRun(run, "defeat", "wipe"), /still Pokémon/);
  run = R.faint(run, res.id);
  assert.equal(R.isWipedOut(run), true);
  const lost = R.endRun(run, "defeat", "wipe");
  assert.deepEqual([lost.result.outcome, lost.result.reason], ["defeat", "wipe"]);
  assert.equal(R.endRun(newRun(), "defeat", "abandoned").result.reason, "abandoned");
  assert.equal(R.isWipedOut(newRun()), false); // nothing caught yet isn't a wipe
});
