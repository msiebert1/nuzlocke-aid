// Start a run: name, game, single nuzlocke or soul link, players.

import { store } from "../store.js";
import { applyTheme, esc, loadGame, loadStyles, toast, trainerImg } from "../ui.js";

export async function show(app) {
  const styles = await loadStyles();
  const keys = Object.keys(styles);
  const state = { game: "b2w2", mode: "single", name: "", players: ["", ""], trainers: [] };

  async function render() {
    const game = await loadGame(state.game);
    applyTheme(state.game, game.style);
    const trainerNames = Object.keys(game.style.trainers);
    if (!state.trainers.length || !state.trainers.every((t) => !t || trainerNames.includes(t))) {
      state.trainers = [...game.style.defaultTrainers];
    }
    const players = state.mode === "soul" ? [0, 1] : [0];
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
        </select>
        <label>Mode</label>
        <div class="choice">
          <label><input type="radio" name="mode" value="single" ${state.mode === "single" ? "checked" : ""}><span>Nuzlocke</span></label>
          <label><input type="radio" name="mode" value="soul" ${state.mode === "soul" ? "checked" : ""}><span>Soul link</span></label>
        </div>
        ${players.map((p) => `
          <label for="p${p}">${state.mode === "soul" ? `Player ${p + 1}` : "Your name"}</label>
          <input id="p${p}" name="p${p}" maxlength="24" required value="${esc(state.players[p])}">
          <label for="t${p}">Trainer sprite</label>
          <div class="btn-row" style="align-items:center">
            <select id="t${p}" name="t${p}" style="flex:3">
              ${trainerNames.map((t) => `<option ${t === state.trainers[p] ? "selected" : ""}>${esc(t)}</option>`).join("")}
              <option value="" ${!state.trainers[p] ? "selected" : ""}>None</option>
            </select>
            <span style="flex:1;text-align:center">${trainerImg(game, state.trainers[p], 56)}</span>
          </div>`).join("")}
        <div style="margin-top:16px"><button class="primary" type="submit" style="width:100%">Start run</button></div>
      </form>`;

    const form = app.querySelector("#new");
    const read = () => {
      state.name = form.runname.value;
      state.players = [form.p0.value, form.p1?.value ?? state.players[1]];
      state.trainers = [form.t0.value, form.t1?.value ?? state.trainers[1]];
    };
    form.game.addEventListener("change", () => { read(); state.game = form.game.value; state.trainers = []; render(); });
    form.querySelectorAll("[name=mode]").forEach((r) =>
      r.addEventListener("change", () => { read(); state.mode = r.value; render(); }));
    form.querySelectorAll("select[name^=t]").forEach((s) => s.addEventListener("change", () => { read(); render(); }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      read();
      const count = state.mode === "soul" ? 2 : 1;
      const run = {
        name: state.name.trim(),
        game: state.game,
        mode: state.mode,
        players: Array.from({ length: count }, (_, i) => ({
          name: state.players[i].trim(), trainer: state.trainers[i] || "",
        })),
        options: { wallpapers: [...game.style.defaultWalls], link: "heart" },
        customLocations: [],
        encounters: [],
        createdAt: Date.now(),
      };
      form.querySelector("button[type=submit]").disabled = true;
      try {
        const code = await (await store()).createRun(run);
        localStorage.setItem(`nuzlocke-me:${code}`, "0");
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
