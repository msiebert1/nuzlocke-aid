// The read-only summary page behind a run's "share run" link (#/view/<code>):
// live updates of the team, badges, history, graveyard and box. It reads only
// the run's view copy, so it never sees (or needs) the run's edit code.

import * as R from "../rules.js?v=e78cdade";
import { store } from "../store.js?v=e78cdade";
import * as Sum from "../summary.js?v=e78cdade";
import { applyTheme, badgeCount, badgeRow, esc, gameName, loadGame, monName, resultBanner, trainerImg } from "../ui.js?v=e78cdade";
import { unitHTML } from "./units.js?v=e78cdade";

const TIMELINE_STEP = 25;

function ago(t, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function dateText(t) {
  return t ? new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
}

function tiles(s) {
  const tile = (n, label, cls = "") => `<div class="tile ${cls}"><b>${n}</b><span>${label}</span></div>`;
  return `<div class="tiles">
    ${tile(s.logged, "encounters")}
    ${tile(s.caught, "caught")}
    ${tile(s.alive, "still alive", "good")}
    ${tile(s.lost, "lost", s.lost ? "bad" : "")}
    ${tile(s.survival === null ? "—" : `${s.survival}%`, "survival")}
    ${tile(s.days, s.days === 1 ? "day" : "days")}
  </div>`;
}

function header(session, now) {
  const { run } = session;
  const mode = run.mode === "soul" ? "Soul link" : "Nuzlocke";
  return `<div class="box view-head">
    <div class="view-trainers">${run.players.map((p) => `<div class="view-trainer">
      ${trainerImg(session.game, p.trainer, 72) || ""}<b>${esc(p.name)}</b></div>`).join(run.mode === "soul" ? `<span class="view-link">🔗</span>` : "")}</div>
    <h1>${esc(run.name)}</h1>
    <p class="muted">${esc(gameName(session))} · ${mode}${R.isRandomizer(run) ? " · Randomizer" : ""}</p>
    <p class="view-live">${R.isOver(run) ? "Finished" : `<span class="live-dot"></span> Live`} · updated ${ago(run.updatedAt || now, now)}
      ${run.createdAt ? ` · started ${dateText(run.createdAt)}` : ""}</p>
  </div>`;
}

function badgesBox(session) {
  if (!session.game.milestones.length) return "";
  const { earned, total } = badgeCount(session);
  const champ = R.hasMilestone(session.run, "champion");
  const red = R.goal(session.run) === "full" && R.hasMilestone(session.run, "red");
  return `<div class="box">
    <h2>Badges <small class="muted">${earned} / ${total}${red ? " · 🔴 Red defeated" : champ ? " · 🏆 Champion" : ""}</small></h2>
    ${badgeRow(session, { size: 40 })}
  </div>`;
}

function teamBox(session) {
  const { run } = session;
  const party = R.party(run);
  if (!party.length) return `<div class="box"><h2>Current team</h2><p class="muted">No one in the party right now.</p></div>`;
  const names = party.flatMap((e) => e.catches.map((c) => c.species));
  const soul = run.mode === "soul";
  // an abandoned run's team is shown greyed out, as it ended (not in the graveyard)
  const abandoned = run.result?.reason === "abandoned";
  return `<div class="box"><h2>${abandoned ? "Final team" : "Current team"} <small class="muted">${party.length} / ${R.PARTY_SIZE}</small></h2>
    <div class="view-team ${soul ? "soul" : ""}">
      ${party.map((enc) => `<div class="view-member">
        ${unitHTML(session, enc, 1, 96, { fitNames: names, grey: abandoned })}
        <div class="view-origin">${esc(enc.location)}${enc.catches.some((c) => c.caughtAs)
          ? ` · evolved from ${esc(enc.catches.filter((c) => c.caughtAs).map((c) => c.caughtAs).join(" & "))}` : ""}</div>
      </div>`).join("")}
    </div></div>`;
}

function journeyBox(session, shown) {
  const days = Sum.timeline(session.run, Object.fromEntries(session.game.milestones.map((m) => [m.key, m])));
  const total = days.reduce((n, d) => n + d.entries.length, 0);
  if (!total) return `<div class="box"><h2>Journey</h2><p class="muted">Nothing logged yet.</p></div>`;
  let left = shown;
  const parts = [];
  for (const day of days) {
    if (left <= 0) break;
    const entries = day.entries.slice(0, left);
    left -= entries.length;
    parts.push(`<h3 class="journey-day">${esc(day.day)}</h3><ul class="journey">
      ${entries.map((e) => `<li><span class="j-icon">${e.icon}</span><span>${esc(e.text)}</span></li>`).join("")}</ul>`);
  }
  return `<div class="box"><h2>Journey</h2>${parts.join("")}
    ${total > shown ? `<button type="button" class="small" id="more" style="width:100%;margin-top:8px">
      Show more (${total - shown} older)</button>` : ""}</div>`;
}

function miniGrid(session, units, { grey = false, caption }) {
  const names = units.flatMap((e) => e.catches.map((c) => c.species));
  return `<div class="mini-grid ${session.run.mode === "soul" ? "soul" : ""}">
    ${units.map((enc) => `<div class="mini">
      ${unitHTML(session, enc, 1, 48, { grey, fitNames: names })}
      ${caption ? `<div class="view-origin">${esc(caption(enc))}</div>` : ""}</div>`).join("")}</div>`;
}

function graveBox(session) {
  const dead = Sum.memorial(session.run);
  return `<div class="box"><h2>🪦 Graveyard <small class="muted">${dead.length}</small></h2>
    ${dead.length ? miniGrid(session, dead, { grey: true,
      caption: (e) => (e.diedAt ? `fell at ${e.diedAt}` : `from ${e.location}`) })
      : `<p class="muted">No losses yet.</p>`}</div>`;
}

function boxBox(session) {
  const boxed = R.box(session.run);
  if (!boxed.length) return "";
  return `<details class="box"><summary><h2 style="display:inline">📦 Box <small class="muted">${boxed.length}</small></h2></summary>
    ${miniGrid(session, boxed, { caption: (e) => e.location })}</details>`;
}

function routeBox(session) {
  const rows = Sum.route(session.run);
  if (!rows.length) return "";
  const icon = { party: "⭐", box: "📦", caught: "🟢", lost: "🪦", failed: "❌", invalid: "⛔" };
  return `<details class="box"><summary><h2 style="display:inline">🗺 Every encounter <small class="muted">${rows.length}</small></h2></summary>
    <ul class="route-list">${rows.map(({ enc, result }) => `<li>
      <span class="j-icon">${icon[result]}</span><b>${esc(enc.location)}</b>
      <span class="muted">${esc(enc.catches.map((c) => c.species ? monName(c) : c.status).join(" & "))}</span></li>`).join("")}</ul>
  </details>`;
}

/** Show the summary for a view code; returns a function that stops the live updates. */
export async function show(app, code) {
  app.innerHTML = `<p class="loading">Loading…</p>`;
  const db = await store();
  if (!db.watchView) {
    app.innerHTML = `<div class="box"><h2>Couldn't connect</h2><p>This summary is loaded from the
      shared save server, which couldn't be reached. Check the connection (or a content blocker) and
      reload.</p></div>`;
    return () => {};
  }
  const state = { shown: TIMELINE_STEP, game: null, openDetails: new Set() };
  document.body.classList.add("viewing");
  const stop = db.watchView(code, async (run, status = {}) => {
    if (status.error) {
      app.innerHTML = `<div class="box"><h2>Couldn't load</h2><p>(${esc(status.error)})</p></div>`;
      return;
    }
    if (run === undefined) return; // waiting for the server
    if (!run) {
      app.innerHTML = `<div class="box"><h2>Not shared</h2><p>This run isn't being shared any more,
        or the link is incomplete.</p><p><a class="btn" href="#/">Nuzlocke Aid home</a></p></div>`;
      return;
    }
    if (!state.game || state.game.key !== run.game) state.game = await loadGame(run.game);
    const session = { run, game: state.game, code: null };
    applyTheme(run.game, state.game.style, run.options?.look || "game");
    document.title = `${run.name} · Nuzlocke Aid`;
    // keep any sections the reader opened
    app.querySelectorAll("details[data-key]").forEach((d) => d.open ? state.openDetails.add(d.dataset.key) : state.openDetails.delete(d.dataset.key));
    const now = Date.now();
    app.innerHTML = `<div class="view">
      <div class="view-main">
        <div class="v-head">${header(session, now)}${resultBanner(run)}</div>
        <div class="v-team">${teamBox(session)}</div>
        <div class="v-journey">${journeyBox(session, state.shown)}</div>
      </div>
      <div class="view-side">
        <div class="v-badges">${badgesBox(session)}</div>
        <div class="v-stats"><div class="box"><h2>Summary</h2>${tiles(Sum.stats(run, now))}</div></div>
        <div class="v-rest">${graveBox(session)}${boxBox(session)}${routeBox(session)}</div>
      </div>
    </div>
    <p class="view-foot"><small>Made with <a href="#/">Nuzlocke Aid</a>: track your own nuzlocke or soul link.</small></p>`;
    app.querySelectorAll("details.box").forEach((d, i) => {
      d.dataset.key = String(i);
      if (state.openDetails.has(d.dataset.key)) d.open = true;
    });
    const more = () => {
      state.shown += 50;
      app.querySelector("#more").closest(".box").outerHTML = journeyBox(session, state.shown);
      app.querySelector("#more")?.addEventListener("click", more);
    };
    app.querySelector("#more")?.addEventListener("click", more);
  });
  return () => {
    stop();
    document.body.classList.remove("viewing");
  };
}
