// Landing page: Professor Oak with two random Pokémon, start or continue a run.

import { store, recentRuns, forgetRun } from "../store.js?v=9ac6b15c";
import { applyTheme, esc, loadGame, loadStyles, sprite } from "../ui.js?v=9ac6b15c";

const DS_GAMES = ["dp", "pt", "hgss", "b2w2"];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export async function show(app) {
  const styles = await loadStyles();
  const recent = recentRuns();
  // a random game's look and two random Pokémon from it, new on every visit
  const key = pick(Object.keys(styles));
  const game = await loadGame(key);
  applyTheme(key, game.style);
  const names = Object.keys(game.sheet);
  let a = pick(names), b = pick(names);
  while (b === a && names.length > 1) b = pick(names);
  const oak = DS_GAMES.includes(key) ? "oak_hgss" : "oak_frlg";
  const db = await store();

  app.innerHTML = `
    <div class="oak-scene">
      ${sprite(game, a, 2)}
      <img class="oak" src="assets/common/${oak}.png" alt="Professor Oak">
      ${sprite(game, b, 2)}
    </div>
    <div class="box">
      <p><b>OAK:</b> Hello there! Welcome to the world of POKéMON!</p>
      <p>This is your NUZLOCKE AID. Log every encounter and keep track of your team.</p>
    </div>
    <div class="btn-row" style="margin-bottom:12px">
      <a class="btn primary" href="#/new">New run</a>
    </div>
    <form class="box" id="join">
      <label for="code" style="margin-top:0">Join a run with its code</label>
      <div class="btn-row">
        <input id="code" name="code" autocomplete="off" autocapitalize="none" spellcheck="false"
               placeholder="e.g. k7f3q9xa2m" style="flex:2">
        <button type="submit">Open</button>
      </div>
    </form>
    ${recent.length ? `<div class="box recent"><h2>Continue</h2>
      ${recent.map((r) => `<a href="#/run/${esc(r.code)}/log">
        <span><b>${esc(r.name)}</b><br><small>${esc(r.gameName || styles[r.game]?.name || "Other game")} ·
          ${r.mode === "soul" ? "Soul link" : "Nuzlocke"}</small></span>
        <button class="small" data-forget="${esc(r.code)}" aria-label="Remove from this list">✕</button>
      </a>`).join("")}</div>` : ""}
    ${db.shared ? "" : `<p class="box"><small class="warn">Runs are saved on this device only
      (shared saves aren't set up yet).</small></p>`}
  `;

  app.querySelector("#join").addEventListener("submit", (e) => {
    e.preventDefault();
    let code = e.target.code.value.trim().toLowerCase();
    code = code.match(/#\/run\/([a-z0-9]+)/)?.[1] || code; // accept a pasted link
    if (code) location.hash = `#/run/${code}/log`;
  });
  app.querySelectorAll("[data-forget]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      forgetRun(btn.dataset.forget);
      show(app);
    }));
}
