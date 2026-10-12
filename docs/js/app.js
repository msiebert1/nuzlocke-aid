// Nuzlocke Aid: hash router and run session.
//   #/                     landing (Professor Oak)
//   #/new                  start a run
//   #/run/<code>/<tab>     a run: log | team | box | grave | list | settings
//   #/view/<code>          a run's read-only summary (its "share run" link)

import { store, rememberRun, resetStore, storeError } from "./store.js?v=3438c4d6";
import { applyTheme, esc, loadGame, toast } from "./ui.js?v=3438c4d6";
import * as landing from "./pages/landing.js?v=3438c4d6";
import * as newRun from "./pages/newrun.js?v=3438c4d6";
import * as viewPage from "./pages/view.js?v=3438c4d6";
import * as runPages from "./pages/run.js?v=3438c4d6";

const app = document.getElementById("app");
let session = null; // the open run: {code, run, game, db, me, update}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "new") return { page: "new" };
  if (parts[0] === "run" && parts[1]) return { page: "run", code: parts[1].toLowerCase(), tab: parts[2] || "log" };
  if (parts[0] === "view" && parts[1]) return { page: "view", code: parts[1].toLowerCase() };
  return { page: "landing" };
}

async function route() {
  const r = parseHash();
  if (r.page !== "run") closeSession();
  try {
    if (r.page === "new") {
      applyTheme(null);
      await newRun.show(app);
    } else if (r.page === "run") {
      await openRun(r.code, r.tab);
    } else if (r.page === "view") {
      closeView();
      viewUnsubscribe = await viewPage.show(app, r.code);
    } else {
      await landing.show(app);
    }
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="box"><h2>Something went wrong</h2><p>${esc(err.message)}</p>
      <p><a class="btn" href="#/">Back to start</a></p></div>`;
  }
  window.scrollTo(0, 0);
}

let viewUnsubscribe = null;
function closeView() {
  viewUnsubscribe?.();
  viewUnsubscribe = null;
}

function closeSession() {
  session?.unsubscribe?.();
  session = null;
  closeView();
}

/** Keep the run's read-only view copy (its "share run" link) up to date. Best
 *  effort: the view is a convenience, so a failed sync never blocks a save. */
let lastSynced = null; // the run version last copied to its view, from this device
function syncView(db, run) {
  if (!db.saveView || !run.share?.on || !run.share.code) return;
  const version = `${run.share.code}:${run.updatedAt}`;
  if (version === lastSynced) return;
  lastSynced = version;
  db.saveView(run.share.code, run).catch((err) => console.warn("Couldn't update the shared view:", err));
}

async function openRun(code, tab) {
  if (session?.code === code) {
    session.tab = tab;
    // switching tabs always redraws, even if a search box still has focus
    if (session.run) runPages.show(app, session);
    return;
  }
  closeSession();
  const db = await store();
  session = { code, db, tab, run: null, game: null, pendingRender: false };
  const current = session;

  session.update = async (fn) => {
    // fn(run) -> run or {run, ...}; saved atomically, then the page re-renders
    try {
      const result = await db.updateRun(code, (run) => {
        const out = fn(run);
        return out && out.run ? out : { run: out };
      });
      // show the saved run right away; the live update from the server
      // (same data) can arrive a moment later
      if (session === current) {
        current.run = result.run;
        renderRun();
      }
      syncView(db, result.run);
      return result;
    } catch (err) {
      toast(err.message);
      throw err;
    }
  };
  session.refresh = () => runPages.show(app, session); // page-driven redraw

  app.innerHTML = `<p class="loading">Loading run…</p>`;
  const problem = (title, text) => {
    app.innerHTML = `<div class="box"><h2>${title}</h2>${text}
      <div class="btn-row" style="margin-top:10px">
        <button class="primary" id="retry">Try again</button>
        <a class="btn" href="#/">Back to start</a></div></div>`;
    app.querySelector("#retry").addEventListener("click", () => {
      closeSession();
      resetStore();
      openRun(code, session?.tab || tab);
    });
  };
  const connectionHelp = `<p><small class="muted">Check the phone is online. Ad or content blockers
    (and some apps' built-in browsers) can block the save server: try opening the link in
    Safari or Chrome, or turning the blocker off for this site.</small></p>`;

  // A run you were given a link to can only be found if shared saves connect
  if (!db.shared && storeError && !localStorage.getItem(`nuzlocke-run:${code}`)) {
    problem("Couldn't connect", `<p>The shared save server couldn't be reached
      (${esc(storeError)}), so run <b>${esc(code)}</b> can't be opened.</p>${connectionHelp}`);
    return;
  }
  let loaded = false;
  const slow = setTimeout(() => {
    if (session === current && !loaded) {
      problem("Still connecting…", `<p>Run <b>${esc(code)}</b> hasn't loaded yet.</p>${connectionHelp}`);
    }
  }, 12000);

  current.unsubscribe = db.watchRun(code, async (run, status = {}) => {
    if (session !== current) return;
    if (status.error) {
      clearTimeout(slow);
      problem("Couldn't load the run", `<p>Run <b>${esc(code)}</b> couldn't be loaded
        (${esc(status.error)}).</p>${connectionHelp}`);
      return;
    }
    if (run === undefined) return; // still waiting for the server
    if (!run) {
      clearTimeout(slow);
      app.innerHTML = `<div class="box"><h2>Run not found</h2>
        <p>No run with code <b>${esc(code)}</b>${db.shared ? "" : " on this device"}.
        Check the link or code is complete.</p>
        <p><a class="btn" href="#/">Back to start</a></p></div>`;
      return;
    }
    loaded = true;
    clearTimeout(slow);
    if (!current.game || current.game.key !== run.game) {
      current.game = await loadGame(run.game);
    }
    applyTheme(run.game, current.game.style, run.options?.look || "game");
    current.run = run;
    rememberRun(code, run);
    renderRun();
    // copy changes from either player to the shared view, so it stays current
    // even if the other player's device can't update it yet
    if (status.from === "server" || !db.shared) syncView(db, run);
    // this device can edit the run, so it may also update its shared view
    if (db.shared && db.uid && !(run.editors || []).includes(db.uid) && !current.joining) {
      current.joining = true;
      session.update((r) => ({ ...r, editors: [...new Set([...(r.editors || []), db.uid])].slice(-40) }))
        .catch(() => {});
    }
  });
}

/** Re-render the open run, but not while someone is typing: a live update
 *  from the other player waits until the input loses focus. */
function renderRun() {
  if (!session?.run) return;
  const active = document.activeElement;
  // (only fields you type into: a checkbox, radio button or menu change is
  // complete as soon as it's made, so the page should show it right away)
  const typing = "textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])";
  if (active && app.contains(active) && active.matches(typing) && session.rendered) {
    if (!session.pendingRender) {
      session.pendingRender = true;
      active.addEventListener("blur", () => {
        session && (session.pendingRender = false);
        setTimeout(renderRun, 150); // let a tap on a button land first
      }, { once: true });
    }
    return;
  }
  runPages.show(app, session);
  session.rendered = true;
}

addEventListener("hashchange", route);
route();
