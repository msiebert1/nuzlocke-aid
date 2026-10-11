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
  return result;
}

/** Put a usable encounter in the party or box. Adding to a full party needs
 *  `swapWith`: that party member goes to the box and this one takes its slot. */
export function place(run, id, target, swapWith = null) {
  if (!["party", "box"].includes(target)) throw new RuleError(`Bad place ${target}`);
  run = clone(run);
  const enc = find(run, id);
  if (!isUsable(run, enc)) throw new RuleError("Only caught Pokémon can join the party or box");
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
    }
  }
  return normalize(run);
}

/** A party member fainted: it (and its soul-linked partner) go to the graveyard. */
export function faint(run, id) {
  run = clone(run);
  const enc = find(run, id);
  if (enc.place !== "party") throw new RuleError("Only party Pokémon can faint");
  enc.place = "grave";
  return normalize(run);
}

/** Undo a mistake: move any encounter to any place the rules allow. */
export function setPlace(run, id, target) {
  if (!PLACES.includes(target)) throw new RuleError(`Bad place ${target}`);
  if (target === "party" || target === "box") return place(run, id, target);
  run = clone(run);
  find(run, id).place = target;
  return normalize(run);
}

/** Move a party member up or down one slot. */
export function movePartySlot(run, id, delta) {
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
  return normalize(run);
}

/** Remove one player's catch (soul link): the location reopens for them. */
export function deleteCatch(run, id, player) {
  run = clone(run);
  const enc = find(run, id);
  enc.catches = enc.catches.filter((c) => c.player !== player);
  if (!enc.catches.length) run.encounters = run.encounters.filter((e) => e.id !== id);
  return normalize(run);
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
  const logged = run.encounters.length;
  const caught = run.encounters.filter((e) => isUsable(run, e)).length;
  const lost = graveyard(run).length;
  const lines = [
    `${soul ? "🔗 Soul link" : "⚔️ Nuzlocke"}: ${run.name} (${game})`,
    "",
    `${heading}:`,
    ...(list.length ? list.map((e) => `• ${unit(e)}`) : ["(none yet)"]),
    "",
    `📍 ${logged} encounter${logged === 1 ? "" : "s"} · ✅ ${caught} caught · 🪦 ${lost} lost`,
  ];
  if (site) lines.push(`Made with Nuzlocke Aid: ${site}`);
  return lines.join("\n");
}
