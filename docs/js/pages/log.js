// Log tab: pick the next location, each player's Pokémon, and one
// Caught / Failed / Invalid for the whole encounter (both players in a soul link).

import * as R from "../rules.js?v=779ab299";
import { closeModal, esc, modal, monImage, monName, toast } from "../ui.js?v=779ab299";
import { placeNew } from "./units.js?v=779ab299";

const CUSTOM = "__custom__";
const forms = new Map(); // run code -> in-progress form, kept across live updates

function form(session) {
  if (!forms.has(session.code)) {
    forms.set(session.code, { location: "", picks: [{}, {}] }); // picks[player] = {species, nickname, search}
  }
  return forms.get(session.code);
}

function clearForm(f) {
  f.location = "";
  f.picks = [{}, {}];
}

function searchResults(session, query, exclude) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const starts = [], contains = [];
  for (const s of session.game.species) {
    const n = s.name.toLowerCase();
    if (exclude.includes(s.name)) continue;
    if (n.startsWith(q)) starts.push(s.name);
    else if (n.includes(q)) contains.push(s.name);
  }
  return [...starts, ...contains].slice(0, 10);
}

function pickButtons(session, player, names, chosen) {
  return names.map((n) => `<button type="button" class="pick ${n === chosen ? "on" : ""}"
      data-player="${player}" data-species="${esc(n)}">
    ${monImage(session, n, { scale: 1, size: 40 })}<span>${esc(n)}</span></button>`).join("");
}

function pendingHTML(session) {
  const { run } = session;
  const waiting = run.encounters.filter((e) => R.isUsable(run, e) && e.place === "none");
  if (!waiting.length) return "";
  return `<div class="box pending"><h3>Needs a place</h3>
    ${waiting.map((e) => `<div class="enc-row"><div class="what">
      <b>${esc(e.catches.map(monName).join(" & "))}</b> <small class="muted">${esc(e.location)}</small></div>
      <button class="small" data-place="${esc(e.id)}">Place</button></div>`).join("")}</div>`;
}

/** One player's Pokémon picker. */
function pickerHTML(session, player, loc) {
  const { run } = session;
  const f = form(session);
  const p = f.picks[player];
  const locSpecies = loc?.species || [];
  const results = searchResults(session, p.search, locSpecies);
  const soul = run.mode === "soul";
  return `<div class="picker ${soul ? "soul" : ""}">
    ${soul ? `<h3>${esc(run.players[player].name)}'s Pokémon</h3>` : `<label>Pokémon</label>`}
    ${locSpecies.length ? `<div class="picks" aria-label="Found here">${pickButtons(session, player, locSpecies, p.species)}</div>` : ""}
    <input type="search" data-search="${player}" placeholder="Search any Pokémon…" value="${esc(p.search || "")}"
           style="margin-top:8px" enterkeyhint="search" autocomplete="off">
    ${results.length ? `<div class="picks">${pickButtons(session, player, results, p.species)}</div>` : ""}
    ${p.species ? `<div class="chosen">${monImage(session, p.species, { scale: 2, size: 72 })}<b>${esc(p.species)}</b></div>` : ""}
    <label for="nick${player}">Nickname <small class="muted">(optional)</small></label>
    <input id="nick${player}" data-nick="${player}" maxlength="20" value="${esc(p.nickname || "")}" autocapitalize="words">
  </div>`;
}

export function render(session) {
  const { run, game } = session;
  const f = form(session);
  const players = Array.from({ length: R.playerCount(run) }, (_, i) => i);
  const open = R.remainingLocations(run, game.locations);
  if (f.location && !open.some((l) => l.name === f.location)) f.location = "";
  const loc = open.find((l) => l.name === f.location);

  return `
    ${pendingHTML(session)}
    <form class="box" id="log" autocomplete="off">
      <h2>Log an encounter</h2>
      ${game.style.generic && !open.length && !run.encounters.length ? `<p class="muted"><small>
        Add your game's locations in <a href="#/run/${session.code}/settings">Settings</a>
        (paste the whole list), or one at a time with "+ Add a location…" below.</small></p>` : ""}
      <label for="loc">Location <small class="muted">(${open.length} left)</small></label>
      <select id="loc" name="loc">
        <option value="">Choose a location…</option>
        ${open.map((l) => `<option value="${esc(l.name)}" ${l.name === f.location ? "selected" : ""}>${esc(l.name)}</option>`).join("")}
        <option value="${CUSTOM}">+ Add a location…</option>
      </select>
      ${players.map((p) => pickerHTML(session, p, loc)).join("")}
      <div class="status-buttons">
        <button type="button" class="primary status-caught" data-status="caught">Caught</button>
        <button type="button" class="status-failed" data-status="failed">Failed</button>
        <button type="button" class="status-invalid" data-status="invalid">Invalid</button>
      </div>
      <p class="muted" style="margin-top:8px"><small>Failed: it fled or fainted. Invalid: doesn't count
        (e.g. a dupe clause, or an area you skipped).${run.mode === "soul" ? " The status applies to both players." : ""}</small></p>
    </form>`;
}

/** Fill the form from anything already logged at this location (older runs
 *  could log one player at a time). */
function prefill(session, f) {
  const enc = R.encounterAt(session.run, f.location);
  f.picks = [0, 1].map((p) => {
    const c = enc?.catches.find((x) => x.player === p);
    return c ? { species: c.species, nickname: c.nickname } : {};
  });
}

export function bind(root, session) {
  const f = form(session);
  const el = root.querySelector("#log");

  el.loc.addEventListener("change", async () => {
    if (el.loc.value === CUSTOM) {
      const name = await askLocation();
      if (name) {
        await session.update((r) => R.addCustomLocation(r, name));
        f.location = name.trim();
      }
    } else {
      f.location = el.loc.value;
    }
    prefill(session, f);
    session.refresh();
  });
  el.querySelectorAll("[data-species]").forEach((b) => b.addEventListener("click", () => {
    const p = f.picks[Number(b.dataset.player)];
    p.species = b.dataset.species;
    p.search = "";
    session.refresh();
  }));
  el.querySelectorAll("[data-search]").forEach((input) => input.addEventListener("input", () => {
    const player = input.dataset.search;
    f.picks[Number(player)].search = input.value;
    // redraw the results, keeping the keyboard up
    const pos = input.selectionStart;
    session.refresh();
    const again = root.ownerDocument.querySelector(`[data-search="${player}"]`);
    again.focus();
    again.setSelectionRange(pos, pos);
  }));
  el.querySelectorAll("[data-nick]").forEach((input) =>
    input.addEventListener("input", () => (f.picks[Number(input.dataset.nick)].nickname = input.value)));
  el.addEventListener("submit", (e) => e.preventDefault());

  el.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", async () => {
    const status = b.dataset.status;
    if (!f.location) return toast("Choose a location first");
    const catches = Array.from({ length: R.playerCount(session.run) }, (_, player) => ({
      player, species: f.picks[player].species || "", nickname: f.picks[player].nickname || "",
    }));
    let result;
    try {
      result = await session.update((r) => R.logEncounter(r, { location: f.location, catches, status }));
    } catch {
      return; // the error was shown as a toast
    }
    const where = f.location;
    const who = catches.map((c) => c.nickname || c.species).filter(Boolean).join(" & ");
    clearForm(f);
    toast(status === "caught" ? `${who} logged at ${where}` : `${where}: ${status}`);
    if (result.needsPlacement) await placeNew(session, result.id, result.run);
    else session.refresh();
  }));

  root.querySelectorAll("[data-place]").forEach((b) =>
    b.addEventListener("click", () => placeNew(session, b.dataset.place)));
}

async function askLocation() {
  return modal(`<form id="custom-loc"><h2>Add a location</h2>
    <p>For anywhere the list is missing (a gift, an event, a hidden area).</p>
    <input name="locname" maxlength="40" required placeholder="Location name">
    <div class="btn-row" style="margin-top:10px"><button type="button" data-value="">Cancel</button>
    <button class="primary" type="submit">Add</button></div></form>`);
}

// The custom-location form submits by closing the modal with its text
document.addEventListener("submit", (e) => {
  if (e.target.id !== "custom-loc") return;
  e.preventDefault();
  closeModal(e.target.locname.value.trim() || null);
});
