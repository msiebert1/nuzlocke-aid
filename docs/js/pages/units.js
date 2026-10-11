// Team, Box and Graveyard tabs, plus the shared "where does this catch go?" step.
// A unit is one encounter: a single Pokémon, or a soul-linked pair.

import * as R from "../rules.js?v=4774e07b";
import { cellStyle, confirmBox, esc, isModern, linkIcon, modal, monImage, monName, spriteScale, toast } from "../ui.js?v=4774e07b";
import { prepareGraphic, shareGraphic, viewGraphic } from "../render.js?v=4774e07b";

/** All sprite names on a page, for one shared scale. */
function namesOf(encs) {
  return encs.flatMap((e) => e.catches.map((c) => c.species));
}

export function monHTML(session, c, scale, size, { grey = false } = {}) {
  const { game, run } = session;
  const wall = run.options?.wallpapers?.[c.player] ?? game.style.defaultWalls[c.player];
  const cell = isModern(session)
    ? { cls: `cell plain p${c.player}`, style: "" } : cellStyle(game, wall);
  return `<div class="mon">
    <div class="${cell.cls}" style="${cell.style}">${monImage(session, c.species, { scale, size, cls: grey ? "grey" : "" })}</div>
    <div class="name">${esc(monName(c))}</div>
    ${c.nickname ? `<div class="species">${esc(c.species)}</div>` : ""}
  </div>`;
}

export function unitHTML(session, enc, scale, size, opts = {}) {
  const parts = enc.catches.map((c) => monHTML(session, c, scale, size, opts));
  const modern = isModern(session);
  const link = session.run.mode !== "soul" ? ""
    : modern ? `<span class="link chain" aria-label="linked">🔗</span>` : linkIcon(session.run.options?.link);
  return `<div class="unit">${parts.join(link)}</div>`;
}

/** Place a newly usable encounter: into the party if there's room, otherwise
 *  ask who to swap out (or send it to the box). */
export async function placeNew(session, id, run = session.run) {
  // `run` is the freshest copy we have: right after a save, the save's own
  // result (the live update from the server may not have arrived yet)
  const enc = run.encounters.find((e) => e.id === id);
  if (!enc) return;
  const party = R.party(run);
  const label = enc.catches.map(monName).join(" & ");
  if (party.length < R.PARTY_SIZE) {
    await session.update((r) => R.place(r, id, "party"));
    toast(`${label} joined the party`);
    return;
  }
  const scale = spriteScale(session.game, namesOf(party), 64);
  const choice = await modal(`
    <h2>Party is full</h2>
    <p>Swap <b>${esc(label)}</b> in for a party member (they go to the box), or box it.</p>
    ${party.map((p) => `<button data-value="${esc(p.id)}" style="width:100%;margin-bottom:6px;justify-content:flex-start">
      ${p.catches.map((c) => monImage(session, c.species, { scale, size: 48 })).join("")}
      <span>${esc(p.catches.map(monName).join(" & "))}</span></button>`).join("")}
    <div class="btn-row"><button class="primary" data-value="box">Send to box</button></div>`);
  if (choice === "box" || choice === null) {
    await session.update((r) => R.place(r, id, "box"));
    toast(`${label} went to the box`);
  } else {
    await session.update((r) => R.place(r, id, "party", choice));
    toast(`${label} joined the party`);
  }
}

const SHARE_LABEL = { team: "Share team", box: "Share box", graveyard: "Share graveyard" };
const VIEW_LABEL = { team: "View team image", box: "View box image", graveyard: "View graveyard image" };

// Saving lives in the image viewer
function graphicButton(kind) {
  return `<div class="btn-row" style="margin-bottom:12px">
    <button class="primary" data-share="${kind}" title="Copies the picture and a post to paste into a chat">📋 ${SHARE_LABEL[kind]}</button>
    <button data-view="${kind}">🖼 ${VIEW_LABEL[kind]}</button></div>`;
}

function bindGraphic(root, session) {
  const share = root.querySelector("[data-share]");
  if (!share) return;
  const kind = share.dataset.share;
  prepareGraphic(session, kind); // draw ahead so the buttons work instantly
  share.addEventListener("click", () => shareGraphic(session, kind));
  root.querySelector("[data-view]").addEventListener("click", () => viewGraphic(session, kind));
}

// --- Team ---------------------------------------------------------------------

export const team = {
  render(session) {
    const party = R.party(session.run);
    if (!party.length) {
      return `<div class="box"><h2>Team</h2><p>No one in your party yet. Log a catch and it
        joins the party automatically.</p></div>`;
    }
    const soul = session.run.mode === "soul";
    const size = soul ? 120 : 100;
    const scale = spriteScale(session.game, namesOf(party), size);
    return `${graphicButton("team")}
      ${party.map((enc, i) => `<div class="box unit-card team-card ${soul ? "soul" : ""}">
        ${unitHTML(session, enc, scale, size)}
        <div class="btn-row actions">
          <button class="small" data-up="${esc(enc.id)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button>
          <button class="small" data-down="${esc(enc.id)}" ${i === party.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
          <button class="small" data-tobox="${esc(enc.id)}">To box</button>
          <button class="small" data-faint="${esc(enc.id)}">Fainted</button>
        </div></div>`).join("")}`;
  },
  bind(root, session) {
    bindGraphic(root, session);
    root.querySelectorAll("[data-up]").forEach((b) =>
      b.addEventListener("click", () => session.update((r) => R.movePartySlot(r, b.dataset.up, -1))));
    root.querySelectorAll("[data-down]").forEach((b) =>
      b.addEventListener("click", () => session.update((r) => R.movePartySlot(r, b.dataset.down, 1))));
    root.querySelectorAll("[data-tobox]").forEach((b) =>
      b.addEventListener("click", () => session.update((r) => R.place(r, b.dataset.tobox, "box"))));
    root.querySelectorAll("[data-faint]").forEach((b) =>
      b.addEventListener("click", async () => {
        const enc = session.run.encounters.find((e) => e.id === b.dataset.faint);
        const who = enc.catches.map(monName).join(" & ");
        const linked = session.run.mode === "soul" ? " Its soul-linked partner goes with it." : "";
        if (await confirmBox(`Did <b>${esc(who)}</b> faint? It moves to the graveyard.${linked}`, "Fainted")) {
          await session.update((r) => R.faint(r, enc.id));
          toast(`Rest in peace, ${who}`);
        }
      }));
  },
};

// --- Box ----------------------------------------------------------------------

export const box = {
  render(session) {
    const boxed = R.box(session.run);
    if (!boxed.length) return `<div class="box"><h2>Box</h2><p>The box is empty.</p></div>`;
    const soul = session.run.mode === "soul";
    const size = soul ? 64 : 80;
    const scale = spriteScale(session.game, namesOf(boxed), size);
    return `${graphicButton("box")}
      <div class="grid ${soul ? "" : "single"}">
      ${boxed.map((enc) => `<div class="box unit-card">
        ${unitHTML(session, enc, scale, size)}
        <div class="actions"><button class="small" style="width:100%" data-party="${esc(enc.id)}">To party</button></div>
      </div>`).join("")}</div>`;
  },
  bind(root, session) {
    bindGraphic(root, session);
    root.querySelectorAll("[data-party]").forEach((b) =>
      b.addEventListener("click", () => placeNew(session, b.dataset.party)));
  },
};

// --- Graveyard ----------------------------------------------------------------

export const grave = {
  render(session) {
    const dead = R.graveyard(session.run);
    if (!dead.length) return `<div class="box"><h2>Graveyard</h2><p>No losses yet. Keep it that way!</p></div>`;
    const soul = session.run.mode === "soul";
    const size = soul ? 64 : 80;
    const scale = spriteScale(session.game, namesOf(dead), size);
    return `${graphicButton("graveyard")}
      <div class="grid ${soul ? "" : "single"}">
      ${dead.map((enc) => `<div class="box unit-card">
        ${unitHTML(session, enc, scale, size, { grey: true })}
        <div class="muted" style="text-align:center"><small>${esc(enc.location)}</small></div>
        <div class="actions"><button class="small" style="width:100%" data-revive="${esc(enc.id)}">Undo (to box)</button></div>
      </div>`).join("")}</div>`;
  },
  bind(root, session) {
    bindGraphic(root, session);
    root.querySelectorAll("[data-revive]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (await confirmBox("Move this back to the box? Only for fixing mistakes.", "Move to box")) {
          await session.update((r) => R.setPlace(r, b.dataset.revive, "box"));
        }
      }));
  },
};
