// Nuzlocke rules: pure functions over a run object. Nothing here touches the
// network or the page, so it is shared by every page and unit tested
// (tests/rules.test.js).
//
// A run:
//   { name, game, mode: "single" | "soul", players: [{name, trainer}],
//     options: {...}, customLocations: [name],
//     encounters: [{ id, location, place: "party" | "box" | "grave" | "none",
//                    partySlot, createdAt,
//                    catches: [{player, species, nickname, status}] }] }
//
// An encounter is one location. In a soul link it holds both players'
// catches, and it is placed (party / box / graveyard) as one unit, so linked
// Pokémon always move together.

export const PARTY_SIZE = 6;
export const STATUSES = ["caught", "failed", "invalid"];
export const PLACES = ["party", "box", "grave", "none"];

export class RuleError extends Error {}

/** A randomizer run: what's found where is shuffled, so the game's encounter
 *  data isn't suggested. */
export function isRandomizer(run) {
  return !!run.options?.randomizer;
}

export function playerCount(run) {
  return run.mode === "soul" ? 2 : 1;
}

function clone(run) {
  return structuredClone(run);
}

function find(run, id) {
  const enc = run.encounters.find((e) => e.id === id);
  if (!enc) throw new RuleError(`No encounter ${id}`);
  return enc;
}

// --- History -------------------------------------------------------------------
// run.events is the run's story, newest last: {t, type, ...}. Each entry keeps
// the names as they were at the time, so evolutions don't rewrite the past.
//   encounter {id, location, status, catches: [{player, species, nickname}]}
//   party / box {id, names}            joined the party / went to the box
//   faint {id, names, where}           fainted (where it happened, if given)
//   evolve {id, player, nickname, from, to}
//   milestone {key}                    a badge, the Elite Four or the Champion
// Corrections (removing an encounter, undoing a faint) remove their entries.
export const MAX_EVENTS = 600;

function addEvent(run, event, now) {
  run.events = [...(run.events || []), { t: now ?? Date.now(), ...event }].slice(-MAX_EVENTS);
}

function dropEvents(run, test) {
  if (run.events) run.events = run.events.filter((e) => !test(e));
}

/** Names of an encounter's Pokémon as shown in history ("Ember (Charmander)"). */
export function unitNames(enc) {
  return enc.catches.filter((c) => c.species)
    .map((c) => (c.nickname ? `${c.nickname} (${c.species})` : c.species));
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function encounterAt(run, location) {
  return run.encounters.find((e) => e.location === location) || null;
}

/** Every player has logged this encounter. */
export function isComplete(run, enc) {
  for (let p = 0; p < playerCount(run); p++) {
    if (!enc.catches.some((c) => c.player === p)) return false;
  }
  return true;
}

/** Complete and every catch was caught: allowed in the party or box. */
export function isUsable(run, enc) {
  return isComplete(run, enc) && enc.catches.every((c) => c.status === "caught");
}

/** Locations still open for logging, in game order, then custom ones.
 *  `gameLocations` is the game's [{name, species}] list. Each result says
 *  which players still need to log there (soul link: one may have already). */
export function remainingLocations(run, gameLocations) {
  const all = [
    ...gameLocations,
    ...run.customLocations
      .filter((name) => !gameLocations.some((l) => l.name === name))
      .map((name) => ({ name, species: [], custom: true })),
  ];
  const out = [];
  for (const loc of all) {
    const enc = encounterAt(run, loc.name);
    const waiting = [];
    for (let p = 0; p < playerCount(run); p++) {
      if (!enc || !enc.catches.some((c) => c.player === p)) waiting.push(p);
    }
    if (waiting.length) out.push({ ...loc, waiting });
  }
  return out;
}

export function party(run) {
  return run.encounters
    .filter((e) => e.place === "party")
    .sort((a, b) => a.partySlot - b.partySlot);
}

export function box(run) {
  return run.encounters.filter((e) => e.place === "box");
}

export function graveyard(run) {
  return run.encounters.filter((e) => e.place === "grave");
}

/** Keep the run consistent after any change: unusable encounters can't be
 *  placed, and party slots are numbered 0..n-1 in order. */
function normalize(run) {
  for (const enc of run.encounters) {
    if (!isUsable(run, enc) && enc.place !== "grave") enc.place = "none";
    if (enc.place !== "party") enc.partySlot = null;
  }
  party(run).forEach((enc, i) => (enc.partySlot = i));
  return run;
}

/** A pasted list of locations, one per line, in order: trimmed, blank lines
 *  and repeats dropped, at most `max`. */
export function parseLocationList(text, max = 100) {
  const seen = new Set();
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const name = line.trim().slice(0, 40);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, max);
}

/** Replace the run's own locations (the generic game's list, or extras added
 *  to a supported game). Encounters already logged are kept either way. */
export function setCustomLocations(run, names) {
  run = clone(run);
  run.customLocations = [...names];
  return run;
}

export function addCustomLocation(run, name, max = 100) {
  name = name.trim();
  if (!name) throw new RuleError("Location name is empty");
  if (!run.customLocations.includes(name) && run.customLocations.length >= max) {
    throw new RuleError(`A run can have at most ${max} added locations`);
  }
  run = clone(run);
  if (!run.customLocations.includes(name)) run.customLocations.push(name);
  return run;
}

/** Log (or re-log) one player's catch at a location.
 *  Returns {run, id, needsPlacement}: needsPlacement is true when the
 *  encounter just became usable and hasn't been placed yet. */
export function logCatch(run, { location, player, species, nickname = "", status, id, now }) {
  if (!STATUSES.includes(status)) throw new RuleError(`Bad status ${status}`);
  if (player < 0 || player >= playerCount(run)) throw new RuleError(`Bad player ${player}`);
  if (!location) throw new RuleError("Choose a location");
  if (status === "caught" && !species) throw new RuleError("Choose a Pokémon");
  run = clone(run);
  let enc = encounterAt(run, location);
  if (!enc) {
    enc = { id: id || newId(), location, place: "none", partySlot: null,
            createdAt: now ?? Date.now(), catches: [] };
    run.encounters.push(enc);
  }
  enc.catches = enc.catches.filter((c) => c.player !== player);
  enc.catches.push({ player, species: species || "", nickname: nickname.trim(), status });
  enc.catches.sort((a, b) => a.player - b.player);
  normalize(run);
  return { run, id: enc.id, needsPlacement: isUsable(run, enc) && enc.place === "none" };
}

/** Log a whole encounter at once: every player's Pokémon at a location with
 *  one shared status (soul link: both players log together).
 *  `catches` is [{player, species, nickname}]. Returns like logCatch. */
export function logEncounter(run, { location, catches, status, id, now }) {
  assertOpen(run);
  if (!STATUSES.includes(status)) throw new RuleError(`Bad status ${status}`);
  if (catches.length !== playerCount(run)) throw new RuleError("Log every player's Pokémon");
  if (status === "caught") {
    const missing = catches.find((c) => !c.species);
    if (missing) throw new RuleError(`Choose ${run.players[missing.player]?.name || "the"}'s Pokémon`);
  }
  let result = { run, id };
  for (const c of catches) {
    result = logCatch(result.run, { location, player: c.player, species: c.species,
                                    nickname: c.nickname, status, id: result.id || id, now });
  }
  dropEvents(result.run, (e) => e.type === "encounter" && e.id === result.id); // re-logged
  addEvent(result.run, { type: "encounter", id: result.id, location, status,
    catches: catches.map((c) => ({ player: c.player, species: c.species || "",
                                   nickname: (c.nickname || "").trim() })) }, now);
  return result;
}

/** Put a usable encounter in the party or box. Adding to a full party needs
 *  `swapWith`: that party member goes to the box and this one takes its slot. */
export function place(run, id, target, swapWith = null, now) {
  assertOpen(run);
  if (!["party", "box"].includes(target)) throw new RuleError(`Bad place ${target}`);
  run = clone(run);
  const enc = find(run, id);
  if (!isUsable(run, enc)) throw new RuleError("Only caught Pokémon can join the party or box");
  if (enc.place !== target) addEvent(run, { type: target, id, names: unitNames(enc) }, now);
  if (target === "box") {
    enc.place = "box";
  } else if (enc.place !== "party") {
    const members = party(run);
    if (members.length < PARTY_SIZE) {
      enc.place = "party";
      enc.partySlot = members.length;
    } else {
      if (!swapWith) throw new RuleError("Party is full: choose who to swap out");
      const out = find(run, swapWith);
      if (out.place !== "party") throw new RuleError("Can only swap with a party member");
      enc.place = "party";
      enc.partySlot = out.partySlot;
      out.place = "box";
      addEvent(run, { type: "box", id: out.id, names: unitNames(out) }, now);
    }
  }
  return normalize(run);
}

/** A party member fainted: it (and its soul-linked partner) go to the graveyard. */
export function faint(run, id, { where = "", now } = {}) {
  assertOpen(run);
  run = clone(run);
  const enc = find(run, id);
  if (enc.place !== "party") throw new RuleError("Only party Pokémon can faint");
  enc.place = "grave";
  enc.diedAt = String(where || "").trim().slice(0, 40);
  enc.diedTime = now ?? Date.now();
  addEvent(run, { type: "faint", id, names: unitNames(enc), where: enc.diedAt }, now);
  return normalize(run);
}

/** Undo a mistake: move any encounter to any place the rules allow. */
export function setPlace(run, id, target) {
  if (!PLACES.includes(target)) throw new RuleError(`Bad place ${target}`);
  if (target === "party" || target === "box") {
    // undoing a faint: it never happened
    run = clone(run);
    const enc = find(run, id);
    if (enc.place === "grave") {
      delete enc.diedAt;
      delete enc.diedTime;
      dropEvents(run, (e) => e.type === "faint" && e.id === id);
      enc.place = "none";
    }
    return place(run, id, target);
  }
  run = clone(run);
  find(run, id).place = target;
  return normalize(run);
}

/** Move a party member up or down one slot. */
export function movePartySlot(run, id, delta) {
  assertOpen(run);
  run = clone(run);
  const members = party(run);
  const i = members.findIndex((e) => e.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= members.length) return run;
  [members[i].partySlot, members[j].partySlot] = [members[j].partySlot, members[i].partySlot];
  return normalize(run);
}

/** Change a logged catch's species, nickname or status. */
export function editCatch(run, id, player, changes) {
  if (changes.status && !STATUSES.includes(changes.status)) {
    throw new RuleError(`Bad status ${changes.status}`);
  }
  run = clone(run);
  const c = find(run, id).catches.find((c) => c.player === player);
  if (!c) throw new RuleError("Nothing logged for that player");
  Object.assign(c, changes);
  return normalize(run);
}

/** Delete an encounter: its location goes back into the pool. */
export function deleteEncounter(run, id) {
  run = clone(run);
  find(run, id);
  run.encounters = run.encounters.filter((e) => e.id !== id);
  dropEvents(run, (e) => e.id === id); // a mistake leaves no history
  return normalize(run);
}

/** Remove one player's catch (soul link): the location reopens for them. */
export function deleteCatch(run, id, player) {
  run = clone(run);
  const enc = find(run, id);
  enc.catches = enc.catches.filter((c) => c.player !== player);
  if (!enc.catches.length) {
    run.encounters = run.encounters.filter((e) => e.id !== id);
    dropEvents(run, (e) => e.id === id);
  }
  return normalize(run);
}

/** The run's tally: locations logged, usable catches, and losses. */
export function tally(run) {
  return {
    logged: run.encounters.length,
    caught: run.encounters.filter((e) => isUsable(run, e)).length,
    lost: graveyard(run).length,
  };
}

/** A short post to share with a graphic: what the run is, who's in the
 *  team / box / graveyard, and the run's tally. `kind` is "team", "box" or
 *  "graveyard"; `game` is the game's display name. */
export function sharePost(run, kind, { game, site }) {
  const soul = run.mode === "soul";
  const names = run.players.map((p) => p.name).filter(Boolean);
  const whose = names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}'s`
    : names.length ? `${names[0]}'s` : "My";
  const label = (c) => (c.nickname && c.species ? `${c.nickname} (${c.species})` : c.nickname || c.species || "?");
  const unit = (e) => e.catches.map(label).join(soul ? " 🔗 " : ", ");
  const list = { team: party(run), box: box(run), graveyard: graveyard(run) }[kind] || [];
  const heading = {
    team: `${whose} team`,
    box: `${whose} box`,
    graveyard: "🪦 In memory of",
  }[kind];
  const { logged, caught, lost } = tally(run);
  const lines = [
    `${soul ? "🔗 Soul link" : "⚔️ Nuzlocke"}${isRandomizer(run) ? " (randomizer)" : ""}: ${run.name} (${game})`,
    "",
    `${heading}:`,
    ...(list.length ? list.map((e) => `• ${unit(e)}`) : ["(none yet)"]),
    "",
    `📍 ${logged} encounter${logged === 1 ? "" : "s"} · ✅ ${caught} caught · 🪦 ${lost} lost`,
  ];
  if (run.result?.outcome === "victory") lines.splice(1, 0, "🏆 Victory! Champion defeated.");
  if (run.result?.outcome === "defeat") {
    lines.splice(1, 0, run.result.reason === "abandoned"
      ? `🏳️ Run abandoned${run.result.note ? `: ${run.result.note}` : "."}` : "💀 Defeat: wiped out.");
  }
  if (site) lines.push(`Made with Nuzlocke Aid: ${site}`);
  return lines.join("\n");
}

/** Evolve one player's Pokémon: its species changes; the nickname, soul
 *  link and place stay. The species it was caught as is remembered. */
export function evolveCatch(run, id, player, species) {
  assertOpen(run);
  species = String(species || "").trim();
  if (!species) throw new RuleError("Choose what it evolved into");
  run = clone(run);
  const c = find(run, id).catches.find((x) => x.player === player);
  if (!c || !c.species) throw new RuleError("Nothing to evolve");
  if (c.species === species) return run;
  if (!c.caughtAs) c.caughtAs = c.species;
  addEvent(run, { type: "evolve", id, player, nickname: c.nickname || "", from: c.species, to: species });
  c.species = species;
  return run;
}

/** What a Pokémon can evolve into in this game: `evolutions` is the
 *  {species: [next stages]} table; `inGame(name)` says if the game has it. */
export function evolutionOptions(species, evolutions, inGame = () => true) {
  return (evolutions[species] || []).filter(inGame);
}

// --- Badges and the League -------------------------------------------------------
// run.progress = {milestoneKey: time earned}. The milestones (badges, Elite
// Four, Champion) for each game are in data/badges.json.

export function hasMilestone(run, key) {
  return !!run.progress?.[key];
}

/** Earn (or un-earn, to fix a mistake) a badge or League milestone. */
export function setMilestone(run, key, earned, now) {
  assertOpen(run);
  run = clone(run);
  run.progress = { ...(run.progress || {}) };
  if (earned && !run.progress[key]) {
    run.progress[key] = now ?? Date.now();
    addEvent(run, { type: "milestone", key }, now);
  } else if (!earned && run.progress[key]) {
    delete run.progress[key];
    dropEvents(run, (e) => e.type === "milestone" && e.key === key);
  }
  return run;
}

// --- The end of a run ------------------------------------------------------------
// run.result = {outcome: "victory" | "defeat", reason, t}
//   victory  reason "champion": only once the Champion has been beaten
//   defeat   reason "wipe": nobody left alive in the party or box
//            reason "abandoned": the players gave up
// An ended run is frozen (no logging, team moves, evolutions or badges)
// until it's reopened.

export function isOver(run) {
  return !!run.result?.outcome;
}

function assertOpen(run) {
  if (isOver(run)) throw new RuleError("This run has ended. Reopen it in Settings to make changes.");
}

export function canWin(run) {
  return hasMilestone(run, "champion");
}

/** Nobody usable is left: the party and box are empty after a loss. */
export function isWipedOut(run) {
  return !party(run).length && !box(run).length && graveyard(run).length > 0;
}

export function endRun(run, outcome, reason, now, note = "") {
  assertOpen(run);
  if (outcome === "victory") {
    if (!canWin(run)) throw new RuleError("Victory needs the Champion beaten first");
    reason = "champion";
  } else if (outcome === "defeat") {
    if (!["wipe", "abandoned"].includes(reason)) throw new RuleError(`Bad reason ${reason}`);
    if (reason === "wipe" && !isWipedOut(run)) throw new RuleError("There are still Pokémon left to battle with");
  } else {
    throw new RuleError(`Bad outcome ${outcome}`);
  }
  run = clone(run);
  note = String(note || "").trim().slice(0, 80);
  run.result = { outcome, reason, t: now ?? Date.now(), ...(note ? { note } : {}) };
  addEvent(run, { type: "end", outcome, reason, ...(note ? { note } : {}) }, now);
  return run;
}

/** Undo an ending recorded by mistake. */
export function reopenRun(run) {
  run = clone(run);
  delete run.result;
  dropEvents(run, (e) => e.type === "end");
  return run;
}
