// List tab: every logged encounter with status and place; tap one to edit.

import * as R from "../rules.js?v=3438c4d6";
import { closeModal, confirmBox, esc, modal, monImage, monName, removeEncounter, toast } from "../ui.js?v=3438c4d6";

const PLACE_LABEL = { party: "Party", box: "Box", grave: "Graveyard", none: "" };

/** Encounters in the order they were logged. */
function ordered(session) {
  // in the order they were logged (encounters are stored as they're added;
  // createdAt keeps that order however the list was saved)
  return session.run.encounters
    .map((e, i) => [e, i])
    .sort(([a, i], [b, j]) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || i - j)
    .map(([e]) => e);
}

export function render(session) {
  const { run, game } = session;
  const encs = ordered(session);
  if (!encs.length) return `<div class="box"><h2>Encounters</h2><p>Nothing logged yet.</p></div>`;
  const caught = encs.filter((e) => R.isUsable(run, e)).length;
  return `<div class="box"><h2>Encounters</h2>
    <p class="muted"><small>${encs.length} locations logged · ${caught} usable · tap one to edit, ✕ to remove</small></p>
    ${encs.map((e) => `<div class="list-row" data-edit="${esc(e.id)}" role="button" tabindex="0">
      <div class="list-head">
        <span class="where">${esc(e.location)}</span>
        ${PLACE_LABEL[e.place] ? `<span class="tag">${PLACE_LABEL[e.place]}</span>` : ""}
        <button type="button" class="small remove" data-remove="${esc(e.id)}" aria-label="Remove the ${esc(e.location)} encounter">✕</button>
      </div>
      ${run.players.map((p, i) => {
        const c = e.catches.find((x) => x.player === i);
        const who = run.mode === "soul" ? `<span class="who-name">${esc(p.name)}</span>` : "";
        if (!c) return `<div class="list-catch">${who}<i class="muted">not logged</i></div>`;
        return `<div class="list-catch">${who}
          ${c.species ? monImage(session, c.species, { scale: 1, size: 40 }) : ""}
          <span class="list-text"><span>${esc(monName(c))}</span>${c.nickname && c.species ? ` <small class="muted">${esc(c.species)}</small>` : ""}
            <span class="status-${c.status}">${c.status}</span>${c.caughtAs ? ` <small class="muted">(caught as ${esc(c.caughtAs)})</small>` : ""}</span>
        </div>`;
      }).join("")}</div>`).join("")}
  </div>`;
}

export function bind(root, session) {
  root.querySelectorAll("[data-edit]").forEach((row) =>
    row.addEventListener("click", () => edit(session, row.dataset.edit)));
  root.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation(); // not the row's edit
    removeEncounter(session, b.dataset.remove, R.deleteEncounter);
  }));
}

async function edit(session, id) {
  const { run, game } = session;
  const enc = run.encounters.find((e) => e.id === id);
  const speciesOptions = game.species.map((s) => `<option value="${esc(s.name)}">`).join("");
  const players = run.players.map((p, i) => [p, i, enc.catches.find((c) => c.player === i)]);
  const choice = await modal(`<form id="edit-enc"><h2>${esc(enc.location)}</h2>
    <datalist id="all-species">${speciesOptions}</datalist>
    ${players.map(([p, i, c]) => c ? `
      ${run.mode === "soul" ? `<h3 style="margin-top:12px">${esc(p.name)}</h3>` : ""}
      <label>Pokémon</label><input name="species${i}" list="all-species" value="${esc(c.species)}">
      <label>Nickname</label><input name="nick${i}" maxlength="20" value="${esc(c.nickname)}">
      <label>Status</label><select name="status${i}">
        ${R.STATUSES.map((s) => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}</select>
      ${run.mode === "soul" ? `<button type="button" class="small" data-value="del${i}" style="margin-top:6px">
        Remove ${esc(p.name)}'s entry</button>` : ""}`
      : `${run.mode === "soul" ? `<h3 style="margin-top:12px">${esc(p.name)}</h3>` : ""}
         <p class="muted">Not logged yet: use the Log tab.</p>`).join("")}
    <div class="btn-row" style="margin-top:14px">
      <button type="button" data-value="delete">Delete</button>
      <button type="button" data-value="">Cancel</button>
      <button type="submit" class="primary">Save</button></div></form>`);

  if (choice === "delete") {
    if (await confirmBox(`Delete the ${esc(enc.location)} encounter? The location goes back on the list.`, "Delete")) {
      await session.update((r) => R.deleteEncounter(r, id));
      toast("Encounter deleted");
    }
  } else if (choice?.startsWith("del")) {
    const player = Number(choice.slice(3));
    await session.update((r) => R.deleteCatch(r, id, player));
    toast("Entry removed");
  } else if (choice?.startsWith("{")) {
    const changes = JSON.parse(choice);
    await session.update((r) => {
      for (const [player, ch] of Object.entries(changes)) r = R.editCatch(r, id, Number(player), ch);
      return r;
    });
    toast("Saved");
  }
}

// Saving the edit form closes the modal with the changes as JSON
document.addEventListener("submit", (e) => {
  if (e.target.id !== "edit-enc") return;
  e.preventDefault();
  const f = e.target;
  const changes = {};
  for (const i of [0, 1]) {
    if (!f[`species${i}`]) continue;
    changes[i] = { species: f[`species${i}`].value.trim(), nickname: f[`nick${i}`].value.trim(),
                   status: f[`status${i}`].value };
  }
  closeModal(JSON.stringify(changes));
});
