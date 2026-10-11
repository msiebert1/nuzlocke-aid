// Nuzlocke Aid: hash router and run session.
//   #/                     landing (Professor Oak)
//   #/new                  start a run
//   #/run/<code>/<tab>     a run: log | team | box | grave | list | settings

import { store, rememberRun } from "./store.js?v=4774e07b";
import { applyTheme, esc, loadGame, toast } from "./ui.js?v=4774e07b";
import * as landing from "./pages/landing.js?v=4774e07b";
import * as newRun from "./pages/newrun.js?v=4774e07b";
import * as runPages from "./pages/run.js?v=4774e07b";

const app = document.getElementById("app");
let session = null; // the open run: {code, run, game, db, me, update}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "new") return { page: "new" };
  if (parts[0] === "run" && parts[1]) return { page: "run", code: parts[1].toLowerCase(), tab: parts[2] || "log" };
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

function closeSession() {
  session?.unsubscribe?.();
  session = null;
}

async function openRun(code, tab) {
  if (session?.code === code) {
    session.tab = tab;
    renderRun();
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
      return result;
    } catch (err) {
      toast(err.message);
      throw err;
    }
  };
  session.refresh = () => runPages.show(app, session); // page-driven redraw

  app.innerHTML = `<p class="loading">Loading run…</p>`;
  current.unsubscribe = db.watchRun(code, async (run) => {
    if (session !== current) return;
    if (!run) {
      app.innerHTML = `<div class="box"><h2>Run not found</h2>
        <p>No run with code <b>${esc(code)}</b>${db.shared ? "" : " on this device"}.</p>
        <p><a class="btn" href="#/">Back to start</a></p></div>`;
      return;
    }
    if (!current.game || current.game.key !== run.game) {
      current.game = await loadGame(run.game);
    }
    applyTheme(run.game, current.game.style, run.options?.look || "game");
    current.run = run;
    rememberRun(code, run);
    renderRun();
  });
}

/** Re-render the open run, but not while someone is typing: a live update
 *  from the other player waits until the input loses focus. */
function renderRun() {
  if (!session?.run) return;
  const active = document.activeElement;
  if (active && app.contains(active) && active.matches("input, select") && session.rendered) {
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
