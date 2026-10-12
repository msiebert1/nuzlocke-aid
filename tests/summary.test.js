import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../docs/js/rules.js";
import * as Sum from "../docs/js/summary.js";

const T0 = Date.UTC(2026, 9, 10, 12);
const H = 60 * 60 * 1000;

function soulRun() {
  return { name: "Test", game: "b2w2", mode: "soul", createdAt: T0,
           players: [{ name: "Matt" }, { name: "Callie" }],
           options: {}, customLocations: [], encounters: [] };
}

function catchPair(run, location, a, b, now, nick = "") {
  const res = R.logEncounter(run, { location, status: "caught", now,
    catches: [{ player: 0, species: a, nickname: nick }, { player: 1, species: b }] });
  return { run: R.place(res.run, res.id, "party", null, now), id: res.id };
}

test("history records catches, team moves, evolutions, faints and badges", () => {
  let { run, id } = catchPair(soulRun(), "Starter", "Snivy", "Tepig", T0, "Ivy");
  run = R.evolveCatch(run, id, 0, "Servine");
  run = R.setMilestone(run, "basic", true, T0 + H);
  const second = catchPair(run, "Route 19", "Patrat", "Purrloin", T0 + 2 * H);
  run = R.faint(second.run, second.id, { where: "Route 20", now: T0 + 3 * H });
  assert.deepEqual(run.events.map((e) => e.type), ["encounter", "party", "evolve", "milestone", "encounter", "party", "faint"]);
  // names are kept as they were at the time
  assert.deepEqual(run.events[1].names, ["Ivy (Snivy)", "Tepig"]);
  assert.equal(run.encounters.find((e) => e.id === second.id).diedAt, "Route 20");
});

test("corrections leave no history", () => {
  let { run, id } = catchPair(soulRun(), "Starter", "Snivy", "Tepig", T0);
  run = R.faint(run, id, { where: "Route 19" });
  run = R.setPlace(run, id, "box"); // undo the faint
  assert.ok(!run.events.some((e) => e.type === "faint"));
  assert.equal(run.encounters[0].diedAt, undefined);
  run = R.deleteEncounter(run, id);
  assert.equal(run.events.length, 0);
  run = R.setMilestone(R.setMilestone(run, "basic", true), "basic", false);
  assert.equal(run.events.length, 0);
  assert.equal(R.hasMilestone(run, "basic"), false);
});

test("timeline reads like a story, newest first, grouped by day", () => {
  let { run, id } = catchPair(soulRun(), "Starter", "Snivy", "Tepig", T0, "Ivy");
  run = R.setMilestone(run, "basic", true, T0 + H);
  run = R.faint(run, id, { where: "Virbank Gym", now: T0 + 26 * H });
  const milestones = { basic: { name: "Basic Badge", leader: "Cheren", kind: "badge" } };
  const days = Sum.timeline(run, milestones, { now: T0 + 26 * H, locale: "en-GB" });
  assert.equal(days[0].day, "Today");
  assert.equal(days[0].entries[0].text, "Ivy (Snivy) & Tepig fell together at Virbank Gym");
  assert.equal(days[1].day, "Yesterday");
  assert.deepEqual(days[1].entries.map((e) => e.text), [
    "Earned the Basic Badge from Cheren",
    "Caught Ivy (Snivy) & Tepig at Starter", // joining the party straight away isn't listed separately
  ]);
});

test("runs from before history was kept still get a timeline", () => {
  const run = soulRun();
  run.encounters = [{ id: "a", location: "Route 1", createdAt: T0, place: "none",
                      catches: [{ player: 0, species: "Rattata", status: "failed" }, { player: 1, species: "", status: "failed" }] }];
  const days = Sum.timeline(run, {}, { now: T0 });
  assert.equal(days[0].entries[0].text, "Route 1: Rattata got away");
});

test("stats", () => {
  let { run, id } = catchPair(soulRun(), "Starter", "Snivy", "Tepig", T0);
  run = catchPair(run, "Route 19", "Patrat", "Purrloin", T0).run;
  run = R.faint(run, id);
  run = R.logEncounter(run, { location: "Route 20", status: "failed",
    catches: [{ player: 0, species: "" }, { player: 1, species: "" }] }).run;
  const s = Sum.stats(run, T0 + 50 * H);
  assert.deepEqual([s.logged, s.caught, s.lost, s.alive, s.failed, s.party, s.survival, s.days],
                   [3, 2, 1, 1, 1, 1, 50, 3]);
});
