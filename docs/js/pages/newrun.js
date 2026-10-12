// Start a run: name, game, single nuzlocke or soul link, players.
// "Other game" runs any game: the players supply its name and locations.

import { parseLocationList } from "../rules.js?v=61b824e3";
import { store } from "../store.js?v=61b824e3";
import {
  ART_CHOICES, GENERIC, MAX_CUSTOM_LOCATIONS, applyTheme, esc, loadGame, loadStyles, toast, trainerImg,
} from "../ui.js?v=61b824e3";

export async function show(app) {
  const styles = await loadStyles();
  const keys = Object.keys(styles);
  const state = { game: "b2w2", mode: "single", name: "", players: ["", ""], trainers: [],
                  look: "game", art: "sprites", gameName: "", locations: "", randomizer: false };

  async function render() {
    const game = await loadGame(state.game);
    const generic = !!game.style.generic;
    if (generic && state.art === "sprites") state.art = "official";
    applyTheme(state.game, game.style, state.look);
    const trainerNames = Object.keys(game.style.trainers);
    if (!state.trainers.length || !state.trainers.every((t) => !t || trainerNames.includes(t))) {
      state.trainers = [...game.style.defaultTrainers];
    }
    const players = state.mode === "soul" ? [0, 1] : [0];
    const arts = Object.entries(ART_CHOICES).filter(([k]) => !(generic && k === "sprites"));
    app.innerHTML = `
      <div class="topbar"><a class="btn" href="#/" aria-label="Back">‹</a>
        <div class="box title"><h1>New run</h1></div></div>
      <form class="box" id="new">
        <label for="runname">Run name</label>
        <input id="runname" name="runname" maxlength="60" required value="${esc(state.name)}"
               placeholder="e.g. Platinum soul link">
        <label for="game">Game</label>
        <select id="game" name="game">
          ${keys.map((k) => `<option value="${k}" ${k === state.game ? "selected" : ""}>${esc(styles[k].name)}</option>`).join("")}
          <option value="${GENERIC}" ${generic ? "selected" : ""}>Other game (your own locations)</option>
        </select>
        ${generic ? `
          <label for="gamename">Which game?</label>
          <input id="gamename" name="gamename" maxlength="40" value="${esc(state.gameName)}"
                 placeholder="e.g. Pokémon Scarlet, or a ROM hack">
          <label for="locations">Locations <small class="muted">(in order, one per line;
            you can add more any time)</small></label>
          <textarea id="locations" name="locations" rows="6"
            placeholder="Starter&#10;Route 1&#10;Route 2&#10;…">${esc(state.locations)}</textarea>
          <p class="muted"><small>Every Pokémon from all nine generations is available. Other games
            use the modern look with official artwork.</small></p>` : ""}
        <label>Mode</label>
        <div class="choice">
          <label><input type="radio" name="mode" value="single" ${state.mode === "single" ? "checked" : ""}><span>Nuzlocke</span></label>
          <label><input type="radio" name="mode" value="soul" ${state.mode === "soul" ? "checked" : ""}><span>Soul link</span></label>
        </div>
        <label class="check"><input type="checkbox" name="randomizer" ${state.randomizer ? "checked" : ""}>
          <span>Randomizer <small class="muted">(the Pokémon found on each route are shuffled, so
          the Log page won't suggest them)</small></span></label>
        ${generic ? "" : `<label>Look</label>
        <div class="choice">
          <label><input type="radio" name="look" value="game" ${state.look === "game" ? "checked" : ""}><span>${esc(game.style.name)}</span></label>
          <label><input type="radio" name="look" value="modern" ${state.look === "modern" ? "checked" : ""}><span>Modern</span></label>
        </div>`}
        <label for="art">Pokémon art</label>
        <select id="art" name="art">
          ${arts.map(([k, v]) => `<option value="${k}" ${state.art === k ? "selected" : ""}>${esc(v)}</option>`).join("")}
        </select>
        ${players.map((p) => `
          <label for="p${p}">${state.mode === "soul" ? `Player ${p + 1}` : "Your name"}</label>
          <input id="p${p}" name="p${p}" maxlength="24" required value="${esc(state.players[p])}">
          ${trainerNames.length ? `<label for="t${p}">Trainer sprite</label>
          <div class="btn-row" style="align-items:center">
            <select id="t${p}" name="t${p}" style="flex:3">
              ${trainerNames.map((t) => `<option ${t === state.trainers[p] ? "selected" : ""}>${esc(t)}</option>`).join("")}
              <option value="" ${!state.trainers[p] ? "selected" : ""}>None</option>
            </select>
            <span style="flex:1;text-align:center">${trainerImg(game, state.trainers[p], 56)}</span>
          </div>` : ""}`).join("")}
        <div style="margin-top:16px"><button class="primary" type="submit" style="width:100%">Start run</button></div>
      </form>`;

    const form = app.querySelector("#new");
    const read = () => {
      state.name = form.runname.value;
      state.players = [form.p0.value, form.p1?.value ?? state.players[1]];
      state.trainers = [form.t0?.value ?? "", form.t1?.value ?? state.trainers[1] ?? ""];
      state.art = form.art.value;
      state.randomizer = form.randomizer.checked;
      if (form.gamename) state.gameName = form.gamename.value;
      if (form.locations) state.locations = form.locations.value;
    };
    form.game.addEventListener("change", () => { read(); state.game = form.game.value; state.trainers = []; render(); });
    form.querySelectorAll("[name=mode]").forEach((r) =>
      r.addEventListener("change", () => { read(); state.mode = r.value; render(); }));
    form.querySelectorAll("[name=look]").forEach((r) =>
      r.addEventListener("change", () => { read(); state.look = r.value; render(); }));
    form.querySelectorAll("select[name^=t]").forEach((s) => s.addEventListener("change", () => { read(); render(); }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      read();
      const count = state.mode === "soul" ? 2 : 1;
      const locations = generic ? parseLocationList(state.locations, MAX_CUSTOM_LOCATIONS) : [];
      const run = {
        name: state.name.trim(),
        game: state.game,
        mode: state.mode,
        players: Array.from({ length: count }, (_, i) => ({
          name: state.players[i].trim(), trainer: state.trainers[i] || "",
        })),
        options: { wallpapers: [...game.style.defaultWalls], link: "heart",
                   look: generic ? "modern" : state.look, art: state.art, randomizer: state.randomizer },
        customLocations: locations,
        encounters: [],
        createdAt: Date.now(),
      };
      if (generic) run.gameName = state.gameName.trim() || "Other game";
      form.querySelector("button[type=submit]").disabled = true;
      try {
        const code = await (await store()).createRun(run);
        location.hash = `#/run/${code}/${state.mode === "soul" ? "settings" : "log"}`;
        toast(state.mode === "soul" ? "Run started: share the link with your partner" : "Run started");
      } catch (err) {
        form.querySelector("button[type=submit]").disabled = false;
        toast(`Couldn't create the run: ${err.message}`);
      }
    });
  }
  await render();
}
