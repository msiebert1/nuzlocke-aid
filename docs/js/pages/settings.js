// Settings: share link, player names and sprites, wallpapers, link icon.

import { parseLocationList, setCustomLocations } from "../rules.js?v=f4e42bf0";
import { forgetRun } from "../store.js?v=f4e42bf0";
import { ART_CHOICES, MAX_CUSTOM_LOCATIONS, confirmBox, esc, toast, trainerImg } from "../ui.js?v=f4e42bf0";

function shareLink(code) {
  return `${location.origin}${location.pathname}#/run/${code}/log`;
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
      <h2>Share</h2>
      ${db.shared
        ? `<p>${soul ? "Send this link to your partner so you both log to this run." :
            "Open this link on any device to continue this run."}</p>`
        : `<p class="warn"><small>Shared saves aren't set up yet, so this run lives on this device only.</small></p>`}
      <p class="share-code">${esc(code)}</p>
      <div class="btn-row"><button type="button" id="copy">Copy link</button>
        ${navigator.share ? `<button type="button" id="share">Share…</button>` : ""}</div>
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
