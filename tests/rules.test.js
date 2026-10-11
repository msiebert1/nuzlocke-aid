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
