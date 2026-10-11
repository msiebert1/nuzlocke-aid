// Log tab: pick the next location, the Pokémon, and Caught / Failed / Invalid.

import * as R from "../rules.js";
import { esc, modal, monName, sprite, toast } from "../ui.js";
import { placeNew } from "./units.js";

const CUSTOM = "__custom__";
const forms = new Map(); // run code -> in-progress form, kept across live updates

function form(session) {
  if (!forms.has(session.code)) {
    forms.set(session.code, { location: "", player: null, species: "", nickname: "", search: "" });
  }
  const f = forms.get(session.code);
  if (f.player === null || f.player >= R.playerCount(session.run)) f.player = session.me;
  return f;
}

function clearForm(f) {
  Object.assign(f, { location: "", species: "", nickname: "", search: "" });
}

/** Locations this player can still log, in game order. */
function openFor(session, player) {
  return R.remainingLocations(session.run, session.game.locations)
    .filter((l) => l.waiting.includes(player));
}

function searchResults(session, query, exclude) {
  const q = query.trim().toLowerCase();
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

function pickButtons(session, names, chosen) {
  return names.map((n) => `<button type="button" class="pick ${n === chosen ? "on" : ""}" data-species="${esc(n)}">
    ${sprite(session.game, n, 1)}<span>${esc(n)}</span></button>`).join("");
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

export function render(session) {
  const { run, game } = session;
  const f = form(session);
  const soul = run.mode === "soul";
  const open = openFor(session, f.player);
  if (f.location && f.location !== CUSTOM && !open.some((l) => l.name === f.location)) f.location = "";
  const loc = open.find((l) => l.name === f.location);
  const other = soul ? 1 - f.player : null;
  const partner = (l) => {
    if (!soul) return "";
    const enc = R.encounterAt(run, l.name);
    const c = enc?.catches.find((x) => x.player === other);
    return c ? ` — ${run.players[other].name}: ${c.species || c.status}` : "";
  };
  const locSpecies = loc?.species || [];
  const results = searchResults(session, f.search, locSpecies);
  const remainingCount = R.remainingLocations(run, game.locations).length;

  return `
    ${pendingHTML(session)}
    <form class="box" id="log" autocomplete="off">
      <h2>Log an encounter</h2>
      ${soul ? `<div class="who">${run.players.map((p, i) => `
        <button type="button" class="${i === f.player ? "on" : ""}" data-player="${i}">${esc(p.name)}</button>`).join("")}</div>` : ""}
      <label for="loc">Location <small class="muted">(${remainingCount} left)</small></label>
      <select id="loc" name="loc">
        <option value="">Choose a location…</option>
        ${open.map((l) => `<option value="${esc(l.name)}" ${l.name === f.location ? "selected" : ""}>${esc(l.name)}${esc(partner(l))}</option>`).join("")}
        <option value="${CUSTOM}">+ Add a location…</option>
      </select>

      <label>Pokémon</label>
      ${locSpecies.length ? `<div class="picks" aria-label="Found here">${pickButtons(session, locSpecies, f.species)}</div>` : ""}
      <input id="search" name="search" type="search" placeholder="Search any Pokémon…" value="${esc(f.search)}"
             style="margin-top:8px" enterkeyhint="search">
      ${results.length ? `<div class="picks">${pickButtons(session, results, f.species)}</div>` : ""}
      ${f.species ? `<div class="chosen">${sprite(game, f.species, 2)}<b>${esc(f.species)}</b></div>` : ""}

      <label for="nick">Nickname <small class="muted">(optional)</small></label>
      <input id="nick" name="nick" maxlength="20" value="${esc(f.nickname)}" autocapitalize="words">

      <div class="status-buttons">
        <button type="button" class="primary status-caught" data-status="caught">Caught</button>
        <button type="button" class="status-failed" data-status="failed">Failed</button>
        <button type="button" class="status-invalid" data-status="invalid">Invalid</button>
      </div>
      <p class="muted" style="margin-top:8px"><small>Failed: it fled or fainted. Invalid: doesn't count
        (e.g. a dupe clause, or an area you skipped).</small></p>
    </form>`;
}

export function bind(root, session) {
  const f = form(session);
  const el = root.querySelector("#log");

  el.querySelectorAll("[data-player]").forEach((b) => b.addEventListener("click", () => {
    f.player = Number(b.dataset.player);
    session.setMe(f.player);
  }));
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
    f.species = "";
    session.refresh();
  });
  el.querySelectorAll("[data-species]").forEach((b) => b.addEventListener("click", () => {
    f.species = b.dataset.species;
    f.search = "";
    session.refresh();
  }));
  el.search.addEventListener("input", () => {
    f.search = el.search.value;
    // redraw just the results, keeping the keyboard up
    const pos = el.search.selectionStart;
    session.refresh();
    const s = root.ownerDocument.getElementById("search");
    s.focus();
    s.setSelectionRange(pos, pos);
  });
  el.nick.addEventListener("input", () => (f.nickname = el.nick.value));
  el.addEventListener("submit", (e) => e.preventDefault());

  el.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", async () => {
    const status = b.dataset.status;
    if (!f.location) return toast("Choose a location first");
    if (status === "caught" && !f.species) return toast("Choose the Pokémon you caught");
    const entry = { location: f.location, player: f.player, species: f.species,
                    nickname: f.nickname, status };
    const result = await session.update((r) => R.logCatch(r, entry));
    const who = entry.nickname || entry.species || "Encounter";
    clearForm(f);
    toast(status === "caught" ? `${who} logged at ${entry.location}` : `${entry.location}: ${status}`);
    if (result.needsPlacement) await placeNew(session, result.id);
    else session.refresh();
  }));

  root.querySelectorAll("[data-place]").forEach((b) =>
    b.addEventListener("click", () => placeNew(session, b.dataset.place)));
}

async function askLocation() {
  const v = await modal(`<form id="custom-loc"><h2>Add a location</h2>
    <p>For anywhere the list is missing (a gift, an event, a hidden area).</p>
    <input name="locname" maxlength="40" required placeholder="Location name">
    <div class="btn-row" style="margin-top:10px"><button type="button" data-value="">Cancel</button>
    <button class="primary" type="submit">Add</button></div></form>`);
  return v;
}

// The custom-location form submits by closing the modal with its text
document.addEventListener("submit", (e) => {
  if (e.target.id !== "custom-loc") return;
  e.preventDefault();
  const name = e.target.locname.value.trim();
  import("../ui.js").then(({ closeModal }) => closeModal(name || null));
});
