// Saving and loading runs.
//
// Two interchangeable backends with the same interface:
//   - Firebase Firestore (when docs/firebase-config.js is filled in): runs are
//     shared between phones, update live, and work offline.
//   - This browser only (localStorage), used until Firebase is set up.
//
// Interface:
//   createRun(run) -> code
//   watchRun(code, callback) -> unsubscribe     callback(run | null) on every change
//   updateRun(code, fn) -> result               fn(run) returns {run, ...result}; applied atomically
//   shared                                      true when runs are shared between devices
// Firebase only (sharing a read-only view of a run):
//   uid                                         this device's anonymous user id
//   saveView(viewCode, run), deleteView(viewCode), watchView(viewCode, callback)

import { firebaseConfig } from "../firebase-config.js?v=1863fb15";

const FIREBASE = "https://www.gstatic.com/firebasejs/10.12.2";

/** Unguessable share code (no look-alike characters): 10 characters for a
 *  run's edit link, 12 for its read-only view link. */
export function newCode(length = 10) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// ---------------------------------------------------------------------------
// This browser only

function localBackend() {
  const key = (code) => `nuzlocke-run:${code}`;
  const channel = "BroadcastChannel" in self ? new BroadcastChannel("nuzlocke-runs") : null;
  const listeners = new Map(); // code -> Set(callback)

  const read = (code) => {
    const raw = localStorage.getItem(key(code));
    return raw ? JSON.parse(raw) : null;
  };
  const notify = (code) => {
    for (const cb of listeners.get(code) || []) cb(code.startsWith("view:") ? undefined : read(code));
  };
  channel?.addEventListener("message", (e) => notify(e.data));
  addEventListener("storage", (e) => {
    if (e.key?.startsWith("nuzlocke-run:")) notify(e.key.slice("nuzlocke-run:".length));
    if (e.key?.startsWith("nuzlocke-view:")) notify(`view:${e.key.slice("nuzlocke-view:".length)}`);
  });

  const viewKey = (code) => `nuzlocke-view:${code}`;
  return {
    shared: false,
    uid: "this-device",
    // a view link only works on this device here; it's for trying things out
    async saveView(code, run) {
      localStorage.setItem(viewKey(code), JSON.stringify({ ...run, updatedAt: Date.now() }));
      notify(`view:${code}`);
      channel?.postMessage(`view:${code}`);
    },
    async deleteView(code) {
      localStorage.removeItem(viewKey(code));
      notify(`view:${code}`);
    },
    watchView(code, callback) {
      const key = `view:${code}`;
      const cb = () => {
        const raw = localStorage.getItem(viewKey(code));
        callback(raw ? JSON.parse(raw) : null, { from: "device" });
      };
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(cb);
      queueMicrotask(cb);
      return () => listeners.get(key).delete(cb);
    },
    async createRun(run) {
      const code = newCode();
      localStorage.setItem(key(code), JSON.stringify({ ...run, updatedAt: Date.now() }));
      return code;
    },
    watchRun(code, callback) {
      if (!listeners.has(code)) listeners.set(code, new Set());
      listeners.get(code).add(callback);
      queueMicrotask(() => callback(read(code), { from: "device" }));
      return () => listeners.get(code).delete(callback);
    },
    async updateRun(code, fn) {
      const run = read(code);
      if (!run) throw new Error("Run not found");
      const result = fn(run);
      localStorage.setItem(key(code), JSON.stringify({ ...result.run, updatedAt: Date.now() }));
      notify(code);
      channel?.postMessage(code);
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Firebase Firestore

async function firebaseBackend(config) {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${FIREBASE}/firebase-app.js`),
    import(`${FIREBASE}/firebase-auth.js`),
    import(`${FIREBASE}/firebase-firestore.js`),
  ]);
  const app = initializeApp(config);
  // Invisible anonymous sign-in: lets the security rules require a signed-in
  // app user without anyone making an account.
  const signedIn = await auth.signInAnonymously(auth.getAuth(app));
  const db = fs.initializeFirestore(app, {
    // keep a copy on the phone so runs load instantly and edits made without
    // signal are sent when it comes back
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const ref = (code) => fs.doc(db, "runs", code);
  const viewRef = (code) => fs.doc(db, "views", code);

  return {
    shared: true,
    uid: signedIn.user.uid,
    saveView(code, run) {
      return fs.setDoc(viewRef(code), { ...run, updatedAt: Date.now() });
    },
    deleteView(code) {
      return fs.deleteDoc(viewRef(code));
    },
    watchView(code, callback) {
      return fs.onSnapshot(viewRef(code), { includeMetadataChanges: true }, (snap) => {
        const from = snap.metadata.fromCache ? "cache" : "server";
        if (!snap.exists() && from === "cache") return callback(undefined, { from, waiting: true });
        callback(snap.exists() ? snap.data() : null, { from });
      }, (err) => callback(undefined, { error: err.code || err.message || "unknown error" }));
    },
    async createRun(run) {
      const code = newCode();
      await fs.setDoc(ref(code), { ...run, updatedAt: Date.now() });
      return code;
    },
    watchRun(code, callback) {
      // callback(run, status): status.from is "server" or "cache"; status.error
      // is set if the run couldn't be loaded. A run missing from this phone's
      // copy may just not have downloaded yet, so wait for the server.
      return fs.onSnapshot(ref(code), { includeMetadataChanges: true }, (snap) => {
        const from = snap.metadata.fromCache ? "cache" : "server";
        if (!snap.exists() && from === "cache") return callback(undefined, { from, waiting: true });
        callback(snap.exists() ? snap.data() : null, { from });
      }, (err) => callback(undefined, { error: err.code || err.message || "unknown error" }));
    },
    async updateRun(code, fn) {
      if (!navigator.onLine) {
        // transactions need the server; offline, apply to the cached copy and
        // let Firestore send the write when the phone is back online
        const snap = await fs.getDocFromCache(ref(code));
        const result = fn(snap.data());
        fs.setDoc(ref(code), { ...result.run, updatedAt: Date.now() });
        return result;
      }
      // a transaction re-runs fn if the other player saved at the same moment
      return fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref(code));
        if (!snap.exists()) throw new Error("Run not found");
        const result = fn(snap.data());
        tx.set(ref(code), { ...result.run, updatedAt: Date.now() });
        return result;
      });
    },
  };
}

// ---------------------------------------------------------------------------

let backend = null;

/** The active backend: Firebase if configured and reachable, else this browser. */
export let storeError = null; // why shared saves couldn't be reached, if they couldn't

export async function store() {
  if (backend) return backend;
  // "?local" in the address: save in this browser only (for trying things out)
  const forceLocal = new URLSearchParams(location.search).has("local");
  if (firebaseConfig && !forceLocal) {
    try {
      backend = await firebaseBackend(firebaseConfig);
      storeError = null;
      return backend;
    } catch (err) {
      console.error("Firebase unavailable; saving in this browser only.", err);
      storeError = err?.code || err?.message || "couldn't connect";
    }
  }
  backend = localBackend();
  return backend;
}

/** Forget a failed connection so the next store() tries Firebase again. */
export function resetStore() {
  if (backend && !backend.shared) backend = null;
}

// Runs this device has opened, newest first (for the landing page's Continue list)
const RECENT = "nuzlocke-recent";

export function recentRuns() {
  try {
    return JSON.parse(localStorage.getItem(RECENT)) || [];
  } catch {
    return [];
  }
}

export function rememberRun(code, run) {
  const entry = { code, name: run.name, game: run.game, gameName: run.gameName || "",
                  mode: run.mode, outcome: run.result?.outcome || "", reason: run.result?.reason || "",
                  seen: Date.now() };
  const list = [entry, ...recentRuns().filter((r) => r.code !== code)].slice(0, 12);
  try {
    localStorage.setItem(RECENT, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the list is only a convenience */
  }
}

export function forgetRun(code) {
  try {
    localStorage.setItem(RECENT, JSON.stringify(recentRuns().filter((r) => r.code !== code)));
  } catch {
    /* ignore */
  }
}
