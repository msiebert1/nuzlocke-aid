// A run's pages: header, bottom tab bar, and the current tab.

import * as R from "../rules.js?v=04cba4ac";
import { esc, gameName, resultBanner, resultLabel } from "../ui.js?v=04cba4ac";
import * as log from "./log.js?v=04cba4ac";
import * as units from "./units.js?v=04cba4ac";
import * as list from "./list.js?v=04cba4ac";
import * as settings from "./settings.js?v=04cba4ac";

const TABS = {
  log: { label: "Log", page: log },
  team: { label: "Team", page: units.team },
  box: { label: "Box", page: units.box },
  grave: { label: "Grave", page: units.grave },
  list: { label: "List", page: list },
  settings: { label: "Settings", page: settings, hidden: true },
};

export function show(app, session) {
  const { run, code, db } = session;
  const tab = TABS[session.tab] ? session.tab : "log";
  const counts = {
    team: `${R.party(run).length}/${R.PARTY_SIZE}`,
    box: R.box(run).length,
    grave: R.graveyard(run).length,
    list: run.encounters.length,
  };
  const who = run.players.map((p) => esc(p.name)).join(" &amp; ");
  app.innerHTML = `
    <div class="topbar">
      <a class="btn" href="#/" aria-label="All runs">‹</a>
      <div class="box title">
        <h1>${esc(run.name)}</h1>
        <small>${esc(gameName(session))} · ${run.mode === "soul" ? "Soul link" : "Nuzlocke"}${R.isRandomizer(run) ? " · Randomizer" : ""} · ${who}${R.isOver(run) ? ` · ${resultLabel(run)}` : ""}</small>
        ${run.share?.on && run.share.code
          ? `<a class="summary-link" href="#/view/${esc(run.share.code)}" target="_blank" rel="noopener">👁 Live summary</a>`
          : db.saveView ? `<a class="summary-link" href="#/run/${code}/settings" data-goto="viewshare">👁 Share run</a>` : ""}
      </div>
      <a class="btn" href="#/run/${code}/settings" aria-label="Settings">⚙</a>
    </div>
    <main id="page">${tab === "settings" ? "" : resultBanner(run)}${TABS[tab].page.render(session)}</main>
    <nav class="tabbar">
      ${Object.entries(TABS).filter(([, t]) => !t.hidden).map(([key, t]) => `
        <a href="#/run/${code}/${key}" class="${key === tab ? "on" : ""}">
          ${t.label}${counts[key] !== undefined ? `<span class="count">${counts[key]}</span>` : ""}
        </a>`).join("")}
    </nav>`;
  TABS[tab].page.bind?.(app.querySelector("#page"), session);
  // "Share run" in the header jumps to the sharing section of Settings
  if (tab === "settings" && session.scrollTo) {
    const target = session.scrollTo;
    session.scrollTo = null;
    // after the page switch has scrolled to the top
    setTimeout(() => app.querySelector(`#${target}`)?.scrollIntoView({ block: "start" }), 60);
  }
  app.querySelector("[data-goto]")?.addEventListener("click", (e) => (session.scrollTo = e.currentTarget.dataset.goto));
}
