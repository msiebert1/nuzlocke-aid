// Settings: share link, player names and sprites, wallpapers, link icon.

import { canWin, endRun, isOver, isWipedOut, parseLocationList, reopenRun, setCustomLocations } from "../rules.js?v=1863fb15";
import { forgetRun, newCode } from "../store.js?v=1863fb15";
import { ART_CHOICES, MAX_CUSTOM_LOCATIONS, closeModal, confirmBox, esc, modal, resultBanner, toast, trainerImg } from "../ui.js?v=1863fb15";

function shareLink(code) {
  return `${location.origin}${location.pathname}#/run/${code}/log`;
}

const NO_NOTE = "__none__";

// The abandon form submits by closing the dialog with the reason (or a marker for none)
document.addEventListener("submit", (e) => {
  if (e.target.id !== "abandon-form") return;
  e.preventDefault();
  closeModal(e.target.note.value.trim() || NO_NOTE);
});

function viewLink(code) {
  return `${location.origin}${location.pathname}#/view/${code}`;
}

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast(text);
  }
}

export function render(session) {
  const { run, game, code, db } = session;
  const style = game.style;
  const walls = Object.keys(style.walls);
  const trainers = Object.keys(style.trainers);
  const soul = run.mode === "soul";
  const generic = !!style.generic;
  const arts = Object.entries(ART_CHOICES).filter(([k]) => !(generic && k === "sprites"));
  const art = run.options?.art && !(generic && run.options.art === "sprites") ? run.options.art
    : generic ? "official" : "sprites";
  return `
    <div class="box">
      <h2>${soul ? "Invite your partner" : "Continue on another device"} <small class="muted">(can edit)</small></h2>
      ${db.shared
        ? `<p>${soul ? "Send this link to your partner so you both log to this run." :
            "Open this link on any device to continue this run."} Anyone with it can change the run.</p>`
        : `<p class="warn"><small>Shared saves aren't set up yet, so this run lives on this device only.</small></p>`}
      <p class="share-code">${esc(code)}</p>
      <div class="btn-row"><button type="button" id="copy">Copy link</button>
        ${navigator.share ? `<button type="button" id="share">Share…</button>` : ""}</div>
    </div>
    <div class="box" id="viewshare">
      <h2>Share run <small class="muted">(view only)</small></h2>
      ${!db.saveView ? `<p class="muted"><small>Needs shared saves, which aren't connected.</small></p>`
        : run.share?.on ? `
          <p>Anyone with this link sees a live summary of the run (team, badges, history, graveyard),
             but can't change anything.</p>
          <p class="share-code" style="font-size:16px;overflow-wrap:anywhere">${esc(viewLink(run.share.code))}</p>
          <div class="btn-row">
            <button type="button" class="primary" id="view-copy">Copy link</button>
            ${navigator.share ? `<button type="button" id="view-share">Share…</button>` : ""}
            <a class="btn" href="#/view/${esc(run.share.code)}" target="_blank" rel="noopener">Open</a>
          </div>
          <div class="btn-row" style="margin-top:8px">
            <button type="button" class="small" id="view-new">New link</button>
            <button type="button" class="small danger" id="view-stop">Stop sharing</button>
          </div>`
        : `<p>Make a link to a live, read-only summary of the run to show friends or viewers:
             your team, badges, history and graveyard.</p>
           <button type="button" class="primary" id="view-start" style="width:100%">👁 Share run</button>`}
    </div>
    <form class="box" id="look">
      <h2>Look</h2>
      ${generic ? `<p class="muted"><small>Other games use the modern look.</small></p>` : `<div class="choice">
        <label><input type="radio" name="look" value="game" ${run.options?.look !== "modern" ? "checked" : ""}>
          <span>${esc(style.name)}</span></label>
        <label><input type="radio" name="look" value="modern" ${run.options?.look === "modern" ? "checked" : ""}>
          <span>Modern</span></label>
      </div>`}
      <label for="art">Pokémon art</label>
      <select id="art" name="art">
        ${arts.map(([k, v]) => `<option value="${k}" ${art === k ? "selected" : ""}>${esc(v)}</option>`).join("")}
      </select>
      <p class="muted"><small>Applies to every page and graphic for this run, on every device.</small></p>
    </form>
    <form class="box" id="settings">
      <h2>Run</h2>
      <label for="runname">Run name</label>
      <input id="runname" name="runname" maxlength="60" value="${esc(run.name)}">
      ${generic ? `<label for="gamename">Game</label>
        <input id="gamename" name="gamename" maxlength="40" value="${esc(run.gameName || "")}">` : ""}
      ${run.players.map((p, i) => `
        <h3 style="margin-top:14px">${soul ? `Player ${i + 1}` : "Player"}</h3>
        <label for="pn${i}">Name</label>
        <input id="pn${i}" name="pn${i}" maxlength="24" value="${esc(p.name)}">
        ${trainers.length ? `<label for="tr${i}">Trainer sprite</label>
        <div class="btn-row" style="align-items:center">
          <select id="tr${i}" name="tr${i}" style="flex:3">
            ${trainers.map((t) => `<option ${t === p.trainer ? "selected" : ""}>${esc(t)}</option>`).join("")}
            <option value="" ${!p.trainer ? "selected" : ""}>None</option></select>
          <span style="flex:1;text-align:center">${trainerImg(game, p.trainer, 56)}</span>
        </div>` : ""}
        ${walls.length ? `<label for="wall${i}">Box wallpaper</label>
          <select id="wall${i}" name="wall${i}">
            ${walls.map((w) => `<option ${w === run.options?.wallpapers?.[i] ? "selected" : ""}>${esc(w)}</option>`).join("")}
          </select>` : ""}`).join("")}
      ${soul ? `<label for="link">Link icon</label>
        <select id="link" name="link">
          <option value="heart" ${run.options?.link !== "splicers" ? "selected" : ""}>Heart</option>
          <option value="splicers" ${run.options?.link === "splicers" ? "selected" : ""}>DNA Splicers</option>
        </select>` : ""}
      <div style="margin-top:14px"><button class="primary" type="submit" style="width:100%">Save</button></div>
    </form>
    <form class="box" id="randomizer">
      <h2>Randomizer</h2>
      <label class="check"><input type="checkbox" name="randomizer" ${run.options?.randomizer ? "checked" : ""}>
          <span>Randomizer <small class="muted">(the Pokémon found on each route are shuffled, so
          the Log page won't suggest them)</small></span></label>
    </form>
    <form class="box" id="locations">
      <h2>${generic ? "Locations" : "Extra locations"}</h2>
      <p class="muted"><small>${generic
        ? "This game's locations, in the order you reach them, one per line."
        : "Places to add after the game's own list (gifts, events, anything missing), one per line."}
        Removing one doesn't remove anything already logged there.</small></p>
      <textarea name="list" rows="${generic ? 10 : 4}">${esc(run.customLocations.join("\n"))}</textarea>
      <div style="margin-top:10px"><button class="primary" type="submit" style="width:100%">Save locations</button></div>
    </form>
    ${isOver(run) ? `${resultBanner(run)}<div class="box">
        <p>Ended by mistake? Reopening lets you keep logging.</p>
        <button type="button" id="reopen" style="width:100%">↩ Reopen run</button></div>`
      : `<div class="box" id="ending">
        <h2>End the run</h2>
        <div class="btn-row">
          <button type="button" class="primary" id="end-victory" ${canWin(run) ? "" : "disabled"}>🏆 Victory</button>
          ${isWipedOut(run) ? `<button type="button" id="end-wipe">💀 Defeat</button>` : ""}
          <button type="button" id="end-abandon">🏳️ Abandon</button>
        </div>
        <p class="muted" style="margin-top:6px"><small>${canWin(run)
          ? "You've beaten the Champion: record your victory."
          : "Victory unlocks once the Champion badge is marked on the Team page."}
          A defeat is offered when nobody's left alive; abandoning ends the run any time.</small></p>
      </div>`}
    <div class="box">
      <h2>On this device</h2>
      <p><small>Removes this run from the start page's list here. ${db.shared ? "The run itself is kept: open the link again to get back to it." : "<b>This deletes the run</b>, since it's only saved here."}</small></p>
      <button type="button" id="forget">Remove from this device</button>
    </div>`;
}

export function bind(root, session) {
  const { code, run } = session;
  root.querySelector("#copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareLink(code));
      toast("Link copied");
    } catch {
      toast(shareLink(code));
    }
  });
  root.querySelector("#share")?.addEventListener("click", () =>
    navigator.share({ title: run.name, text: `Join my ${run.mode === "soul" ? "soul link" : "nuzlocke"}: ${run.name}`,
                      url: shareLink(code) }).catch(() => {}));
  // --- read-only view link
  const startSharing = async (oldCode) => {
    const viewCode = newCode(12);
    if (oldCode) await session.db.deleteView(oldCode).catch(() => {});
    // the update below also creates the view copy (app.js keeps it in sync)
    await session.update((r) => ({ ...r, share: { on: true, code: viewCode },
      editors: [...new Set([...(r.editors || []), session.db.uid])] }));
  };
  root.querySelector("#view-start")?.addEventListener("click", async () => {
    await startSharing();
    toast("Share link ready");
  });
  root.querySelector("#view-copy")?.addEventListener("click", () =>
    copy(viewLink(run.share.code), "View link copied"));
  root.querySelector("#view-share")?.addEventListener("click", () =>
    navigator.share({ title: run.name, text: `Follow my ${run.mode === "soul" ? "soul link" : "nuzlocke"}: ${run.name}`,
                      url: viewLink(run.share.code) }).catch(() => {}));
  root.querySelector("#view-new")?.addEventListener("click", async () => {
    if (!(await confirmBox("Make a new view link? The old link stops working.", "New link"))) return;
    await startSharing(run.share.code);
    toast("New view link ready");
  });
  root.querySelector("#view-stop")?.addEventListener("click", async () => {
    if (!(await confirmBox("Stop sharing? The view link stops working. (You can share again later with a new link.)", "Stop sharing"))) return;
    const old = run.share.code;
    await session.update((r) => ({ ...r, share: { on: false } }));
    await session.db.deleteView(old).catch(() => {});
    toast("Sharing stopped");
  });

  // look and art apply as soon as they're picked
  const look = root.querySelector("#look");
  look.addEventListener("change", async () => {
    await session.update((r) => ({ ...r, options: { ...r.options,
      look: look.look ? look.look.value : "modern", art: look.art.value } }));
    toast("Saved");
  });

  const form = root.querySelector("#settings");
  form.querySelectorAll("select[name^=tr]").forEach((s) => s.addEventListener("change", () => {
    // preview the sprite without saving yet
    s.closest(".btn-row").querySelector("span").innerHTML = trainerImg(session.game, s.value, 56);
  }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await session.update((r) => {
      r = structuredClone(r);
      r.name = form.runname.value.trim() || r.name;
      r.players = r.players.map((p, i) => ({
        name: form[`pn${i}`].value.trim() || p.name,
        trainer: form[`tr${i}`]?.value ?? p.trainer,
      }));
      if (form.gamename) r.gameName = form.gamename.value.trim() || r.gameName;
      r.options = { ...r.options };
      if (form.wall0) r.options.wallpapers = r.players.map((_, i) => form[`wall${i}`].value);
      if (form.link) r.options.link = form.link.value;
      return r;
    });
    toast("Saved");
  });

  const rando = root.querySelector("#randomizer");
  rando.addEventListener("change", async () => {
    const on = rando.randomizer.checked;
    await session.update((r) => ({ ...r, options: { ...r.options, randomizer: on } }));
    toast(on ? "Randomizer on: route suggestions hidden" : "Randomizer off");
  });

  // --- ending the run
  const finish = async (outcome, reason, question, done) => {
    if (!(await confirmBox(question, outcome === "victory" ? "🏆 Record victory" : "End the run"))) return;
    await session.update((r) => endRun(r, outcome, reason));
    toast(done);
  };
  root.querySelector("#end-victory")?.addEventListener("click", () =>
    finish("victory", "champion", "Record a <b>victory</b>? This ends the run.", "🏆 Victory recorded. Congratulations!"));
  root.querySelector("#end-wipe")?.addEventListener("click", () =>
    finish("defeat", "wipe", "Nobody's left alive. Record a <b>defeat</b>? This ends the run.", "💀 Defeat recorded"));
  root.querySelector("#end-abandon")?.addEventListener("click", async () => {
    const note = await modal(`<form id="abandon-form"><h2>🏳️ Abandon this run?</h2>
      <p>It's recorded as a defeat and ends the run.</p>
      <label for="abandon-note">Why? <small class="muted">(optional, shown in the history)</small></label>
      <input id="abandon-note" name="note" maxlength="80" placeholder="e.g. Lost to the Champion">
      <div class="btn-row" style="margin-top:12px"><button type="button" data-value="">Cancel</button>
        <button class="primary" type="submit">Abandon run</button></div></form>`);
    if (note === null || note === "") return;
    await session.update((r) => endRun(r, "defeat", "abandoned", undefined, note === NO_NOTE ? "" : note));
    toast("🏳️ Run abandoned");
  });
  root.querySelector("#reopen")?.addEventListener("click", async () => {
    if (!(await confirmBox("Reopen this run? Its ending is removed.", "Reopen"))) return;
    await session.update((r) => reopenRun(r));
    toast("Run reopened");
  });

  const locs = root.querySelector("#locations");
  locs.addEventListener("submit", async (e) => {
    e.preventDefault();
    const names = parseLocationList(locs.list.value, MAX_CUSTOM_LOCATIONS);
    await session.update((r) => setCustomLocations(r, names));
    toast(`Saved ${names.length} location${names.length === 1 ? "" : "s"}`);
  });

  root.querySelector("#forget").addEventListener("click", async () => {
    const message = session.db.shared
      ? "Remove this run from this device's list?"
      : "This run is only saved on this device. Removing it <b>deletes it</b>. Continue?";
    if (!(await confirmBox(message, "Remove"))) return;
    forgetRun(code);
    if (!session.db.shared) localStorage.removeItem(`nuzlocke-run:${code}`);
    location.hash = "#/";
  });
}
