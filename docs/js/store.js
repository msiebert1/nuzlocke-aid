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

import { firebaseConfig } from "../firebase-config.js?v=9ac6b15c";

const FIREBASE = "https://www.gstatic.com/firebasejs/10.12.2";

/** Unguessable 10-character share code (no look-alike characters). */
export function newCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
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
    for (const cb of listeners.get(code) || []) cb(read(code));
  };
  channel?.addEventListener("message", (e) => notify(e.data));
  addEventListener("storage", (e) => {
    if (e.key?.startsWith("nuzlocke-run:")) notify(e.key.slice("nuzlocke-run:".length));
  });

  return {
    shared: false,
    async createRun(run) {
      const code = newCode();
      localStorage.setItem(key(code), JSON.stringify({ ...run, updatedAt: Date.now() }));
      return code;
    },
    watchRun(code, callback) {
      if (!listeners.has(code)) listeners.set(code, new Set());
      listeners.get(code).add(callback);
      queueMicrotask(() => callback(read(code)));
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
  await auth.signInAnonymously(auth.getAuth(app));
  const db = fs.initializeFirestore(app, {
    // keep a copy on the phone so runs load instantly and edits made without
    // signal are sent when it comes back
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const ref = (code) => fs.doc(db, "runs", code);

  return {
    shared: true,
    async createRun(run) {
      const code = newCode();
      await fs.setDoc(ref(code), { ...run, updatedAt: Date.now() });
      return code;
    },
    watchRun(code, callback) {
      return fs.onSnapshot(ref(code), (snap) => callback(snap.exists() ? snap.data() : null),
                           () => callback(null));
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
export async function store() {
  if (backend) return backend;
  if (firebaseConfig) {
    try {
      backend = await firebaseBackend(firebaseConfig);
      return backend;
    } catch (err) {
      console.error("Firebase unavailable; saving in this browser only.", err);
    }
  }
  backend = localBackend();
  return backend;
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
                  mode: run.mode, seen: Date.now() };
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
