// Team, Box and Graveyard tabs, plus the shared "where does this catch go?" step.
// A unit is one encounter: a single Pokémon, or a soul-linked pair.

import * as R from "../rules.js?v=61b824e3";
import { cellStyle, closeModal, confirmBox, esc, isModern, linkIcon, modal, monImage, monName, removeEncounter, spriteScale, toast, boxFit, badgeRow, badgeCount } from "../ui.js?v=61b824e3";
import { prepareGraphic, shareGraphic, viewGraphic } from "../render.js?v=61b824e3";

/** All sprite names on a page, for one shared scale. */
function namesOf(encs) {
  return encs.flatMap((e) => e.catches.map((c) => c.species));
}

export function monHTML(session, c, scale, size, { grey = false, evolveId = null, fit = null } = {}) {
  const { game, run } = session;
  const wall = run.options?.wallpapers?.[c.player] ?? game.style.defaultWalls[c.player];
  const cell = isModern(session)
    ? { cls: `cell plain p${c.player}`, style: "" } : cellStyle(game, wall);
  // boxes keep the picture's shape, so Pokémon fill them the same way
  const shape = fit ? `aspect-ratio:${fit.refW} / ${fit.refH};` : "";
  const inner = `
    <div class="${cell.cls}" style="${cell.style};${shape}">${monImage(session, c.species, { scale, size, fit, cls: grey ? "grey" : "" })}</div>
    <div class="name">${esc(monName(c))}</div>
    ${c.nickname ? `<div class="species">${esc(c.species)}</div>` : ""}`;
  // on the Team and Box pages, tapping a Pokémon evolves it
  return evolveId
    ? `<button type="button" class="mon mon-tap" data-evolve="${esc(evolveId)}" data-player="${c.player}"
         aria-label="Evolve ${esc(monName(c))}">${inner}</button>`
    : `<div class="mon">${inner}</div>`;
}

export function unitHTML(session, enc, scale, size, opts = {}) {
  // size Pokémon relative to their box the same way the team picture does
  if (!opts.fit && opts.fitNames) opts = { ...opts, fit: boxFit(session, opts.fitNames) };
  const parts = enc.catches.map((c) => monHTML(session, c, scale, size,
    { ...opts, evolveId: opts.evolvable ? enc.id : null }));
  const modern = isModern(session);
  const link = session.run.mode !== "soul" ? ""
    : modern ? `<span class="link chain" aria-label="linked">🔗</span>` : linkIcon(session.run.options?.link);
  return `<div class="unit">${parts.join(link)}</div>`;
}

/** Place a newly usable encounter: into the party if there's room, otherwise
 *  ask who to swap out (or send it to the box). */
export async function placeNew(session, id, run = session.run, undo = null) {
  // `run` is the freshest copy we have: right after a save, the save's own
  // result (the live update from the server may not have arrived yet)
  const enc = run.encounters.find((e) => e.id === id);
  if (!enc) return;
  const party = R.party(run);
  const label = enc.catches.map(monName).join(" & ");
  if (party.length < R.PARTY_SIZE) {
    await session.update((r) => R.place(r, id, "party"));
    toast(`${label} joined the party`, undo);
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
    toast(`${label} went to the box`, undo);
  } else {
    await session.update((r) => R.place(r, id, "party", choice));
    toast(`${label} joined the party`, undo);
  }
}

const SHARE_LABEL = { team: "Share team", box: "Share box", graveyard: "Share graveyard" };
const VIEW_LABEL = { team: "View team image", box: "View box image", graveyard: "View graveyard image" };

// Saving lives in the image viewer
function graphicButton(kind, over = false) {
  return `<div class="btn-row" style="margin-bottom:${kind === "graveyard" ? 12 : 6}px">
    <button class="primary" data-share="${kind}" title="Copies the picture and a post to paste into a chat">📋 ${SHARE_LABEL[kind]}</button>
    <button data-view="${kind}">🖼 ${VIEW_LABEL[kind]}</button></div>
    ${kind === "graveyard" || over ? "" : `<p class="tap-hint"><small>Tap a Pokémon to evolve or remove it.</small></p>`}`;
}

// --- Evolving -----------------------------------------------------------------

const REMOVE = "__remove__";
const FAINT_NOWHERE = "__nowhere__";

// The faint form submits by closing the dialog with the place (or a marker for none)
document.addEventListener("submit", (e) => {
  if (e.target.id !== "faint-form") return;
  e.preventDefault();
  closeModal(e.target.where.value.trim() || FAINT_NOWHERE);
});

/** Offer to record the end of the run when it looks over: a victory after
 *  beating the Champion, a defeat when nobody's left. It always asks, in case
 *  the log is just behind the game. */
export async function offerEnding(session, run, outcome) {
  const victory = outcome === "victory";
  const ok = await modal(`<div style="text-align:center"><div class="result-icon">${victory ? "🏆" : "💀"}</div>
    <h2>${victory ? "You're the Champion!" : "No Pokémon left"}</h2>
    <p>${victory ? "Record a victory? This ends the run."
      : "Nobody is left alive in the party or box. Record a defeat? This ends the run."}</p></div>
    <div class="btn-row"><button data-value="">Not yet</button>
      <button class="primary" data-value="yes">${victory ? "🏆 Record victory" : "💀 Record defeat"}</button></div>`);
  if (ok !== "yes") return;
  await session.update((r) => R.endRun(r, outcome, victory ? "champion" : "wipe"));
  toast(victory ? "🏆 Victory recorded. Congratulations!" : "💀 Defeat recorded. Rest in peace.");
}

/** Earn a badge / League milestone, or take it back if tapped by mistake. */
async function milestoneDialog(session, key) {
  const m = session.game.milestones.find((x) => x.key === key);
  if (!m) return;
  const earned = R.hasMilestone(session.run, key);
  const what = m.kind === "champion" ? "Champion" : m.kind === "elite4" ? "the Elite Four" : `the ${m.name}`;
  const ok = await confirmBox(earned
    ? `Remove ${esc(what)} from your progress? (Only if it was marked by mistake.)`
    : `<img src="assets/${esc(m.icon)}" alt="" style="width:56px;height:56px;display:block;margin:0 auto 8px">
       ${m.kind === "champion" ? "Did you become the <b>Champion</b>" : m.kind === "elite4" ? "Did you beat the <b>Elite Four</b>"
         : `Did you earn the <b>${esc(m.name)}</b>`}${m.leader ? ` (${esc(m.leader)})` : ""}?`,
    earned ? "Remove" : "Yes!");
  if (!ok) return;
  const { run } = await session.update((r) => R.setMilestone(r, key, !earned));
  if (!earned && m.kind === "champion") await offerEnding(session, run, "victory");
  if (!earned) toast(m.kind === "champion" ? "🏆 Champion!" : m.kind === "elite4" ? "⭐ Elite Four beaten!" : `🏅 ${m.name} earned!`);
}

/** A Pokémon's menu: evolve it (its next stages in this game, or any other
 *  Pokémon by name), or remove its encounter if it was logged by mistake. */
async function evolveDialog(session, id, player) {
  const { game, run } = session;
  const enc = run.encounters.find((e) => e.id === id);
  const c = enc?.catches.find((x) => x.player === player);
  if (!c?.species) return;
  const options = R.evolutionOptions(c.species, game.evolutions || {}, (n) => !!game.dex[n] && game.dex[n] <= game.style.lastDex);
  const who = c.nickname ? `${c.nickname} (${c.species})` : c.species;
  const choice = await modal(`<h2>${esc(who)}</h2>
    <h3>Evolve</h3>
    ${options.length ? `<p>What did it evolve into?</p>
      <div class="evolve-options">${options.map((n) => `<button data-value="${esc(n)}">
        ${monImage(session, n, { scale: 1, size: 56 })}<span>${esc(n)}</span></button>`).join("")}</div>`
      : `<p class="muted">${esc(c.species)} doesn't evolve in this game.</p>`}
    <form id="evolve-other" style="margin-top:10px">
      <label for="evolve-into">${options.length ? "Something else?" : "Evolved into something else?"}</label>
      <div class="btn-row">
        <input id="evolve-into" name="into" list="evolve-species" placeholder="Pokémon name" style="flex:2" autocomplete="off">
        <button type="submit">Evolve</button></div>
      <datalist id="evolve-species">${game.species.map((sp) => `<option value="${esc(sp.name)}">`).join("")}</datalist>
    </form>
    <h3 style="margin-top:16px">Logged by mistake?</h3>
    <div class="btn-row"><button class="danger" data-value="${REMOVE}">🗑 Remove encounter</button></div>
    <div class="btn-row" style="margin-top:10px"><button data-value="">Cancel</button></div>`);
  if (!choice) return;
  if (choice === REMOVE) return removeEncounter(session, id, R.deleteEncounter);
  const into = game.species.find((sp) => sp.name.toLowerCase() === choice.trim().toLowerCase())?.name;
  if (!into) return toast(`No Pokémon called "${choice}"`);
  await session.update((r) => R.evolveCatch(r, id, player, into));
  toast(`${c.nickname || c.species} evolved into ${into}!`);
}

// "Something else?" submits by closing the dialog with the typed name
document.addEventListener("submit", (e) => {
  if (e.target.id !== "evolve-other") return;
  e.preventDefault();
  const name = e.target.into.value.trim();
  if (name) closeModal(name);
});

function bindEvolve(root, session) {
  root.querySelectorAll("[data-evolve]").forEach((b) => b.addEventListener("click", () =>
    evolveDialog(session, b.dataset.evolve, Number(b.dataset.player))));
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
    const over = R.isOver(session.run);
    const party = R.party(session.run);
    const { earned, total } = badgeCount(session);
    const badges = session.game.milestones.length ? `<div class="box badges-box">
      <div class="badges-head"><h3>Badges <small class="muted">${earned}/${total}</small></h3>
        ${over ? "" : `<small class="muted">Tap one you've earned</small>`}</div>
      ${badgeRow(session, { tappable: !over })}</div>` : "";
    if (!party.length) {
      const text = over ? "Nobody was left in the party."
        : R.graveyard(session.run).length || R.box(session.run).length
          ? "No one in the party right now. Move someone in from the box, or log a new catch."
          : "No one in your party yet. Log a catch and it joins the party automatically.";
      return `${badges}<div class="box"><h2>Team</h2><p>${text}</p></div>`;
    }
    const soul = session.run.mode === "soul";
    const size = soul ? 120 : 100;
    const scale = spriteScale(session.game, namesOf(party), size);
    const names = namesOf(party); // one shared sprite scale per page, like the picture
    return `${badges}${graphicButton("team", over)}
      ${party.map((enc, i) => `<div class="box unit-card team-card ${soul ? "soul" : ""}">
        ${unitHTML(session, enc, scale, size, { evolvable: !over, fitNames: names })}
        ${over ? "" : `<div class="btn-row actions">
          <button class="small" data-up="${esc(enc.id)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button>
          <button class="small" data-down="${esc(enc.id)}" ${i === party.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
          <button class="small" data-tobox="${esc(enc.id)}">To box</button>
          <button class="small" data-faint="${esc(enc.id)}">Fainted</button>
        </div>`}</div>`).join("")}`;
  },
  bind(root, session) {
    bindGraphic(root, session);
    bindEvolve(root, session);
    root.querySelectorAll("[data-milestone]").forEach((b) =>
      b.addEventListener("click", () => milestoneDialog(session, b.dataset.milestone)));
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
        // suggest the most recent location logged as where it happened
        const recent = [...session.run.encounters].sort((a, c) => (c.createdAt || 0) - (a.createdAt || 0))[0];
        const where = await modal(`<form id="faint-form"><h2>Fainted?</h2>
          <p>Did <b>${esc(who)}</b> faint? It moves to the graveyard.${linked}</p>
          <label for="faint-where">Where? <small class="muted">(optional, for the history)</small></label>
          <input id="faint-where" name="where" maxlength="40" value="${esc(recent?.location || "")}"
                 placeholder="e.g. Route 6, or the Gym">
          <div class="btn-row" style="margin-top:12px"><button type="button" data-value="">Cancel</button>
            <button class="primary" type="submit">Fainted</button></div></form>`);
        if (where === null || where === "") return;
        const { run } = await session.update((r) => R.faint(r, enc.id, { where: where === FAINT_NOWHERE ? "" : where }));
        if (R.isWipedOut(run)) return offerEnding(session, run, "defeat");
        toast(`Rest in peace, ${who}`);
      }));
  },
};

// --- Box ----------------------------------------------------------------------

export const box = {
  render(session) {
    const over = R.isOver(session.run);
    const boxed = R.box(session.run);
    if (!boxed.length) return `<div class="box"><h2>Box</h2><p>The box is empty.</p></div>`;
    const soul = session.run.mode === "soul";
    const size = soul ? 64 : 80;
    const scale = spriteScale(session.game, namesOf(boxed), size);
    const names = namesOf(boxed); // one shared sprite scale per page, like the picture
    return `${graphicButton("box", over)}
      <div class="grid ${soul ? "" : "single"}">
      ${boxed.map((enc) => `<div class="box unit-card">
        ${unitHTML(session, enc, scale, size, { evolvable: !over, fitNames: names })}
        ${over ? "" : `<div class="actions"><button class="small" style="width:100%" data-party="${esc(enc.id)}">To party</button></div>`}
      </div>`).join("")}</div>`;
  },
  bind(root, session) {
    bindGraphic(root, session);
    bindEvolve(root, session);
    root.querySelectorAll("[data-party]").forEach((b) =>
      b.addEventListener("click", () => placeNew(session, b.dataset.party)));
  },
};

// --- Graveyard ----------------------------------------------------------------

export const grave = {
  render(session) {
    const over = R.isOver(session.run);
    const dead = R.graveyard(session.run);
    if (!dead.length) return `<div class="box"><h2>Graveyard</h2><p>No losses yet. Keep it that way!</p></div>`;
    const soul = session.run.mode === "soul";
    const size = soul ? 64 : 80;
    const scale = spriteScale(session.game, namesOf(dead), size);
    const names = namesOf(dead); // one shared sprite scale per page, like the picture
    return `${graphicButton("graveyard")}
      <div class="grid ${soul ? "" : "single"}">
      ${dead.map((enc) => `<div class="box unit-card">
        ${unitHTML(session, enc, scale, size, { grey: true, fitNames: names })}
        <div class="muted" style="text-align:center"><small>${esc(enc.location)}</small></div>
        ${over ? "" : `<div class="actions"><button class="small" style="width:100%" data-revive="${esc(enc.id)}">Undo (to box)</button></div>`}
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
