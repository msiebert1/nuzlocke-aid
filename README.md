# NuzLog

A free, mobile-friendly website for running a Pokémon nuzlocke or soul link:
log one encounter per location (in game order), track your party, box and
graveyard, and share team graphics, all in the look of the game you're playing
(Red/Blue through Black 2/White 2).

The site lives in `docs/` and is plain HTML/CSS/JavaScript, hosted free on
GitHub Pages. Shared saves (so both soul-link players can log to one run) use
Google Firebase's free tier. Until Firebase is set up, runs are saved in the
browser only.

The Python tools in the root are the original desktop team-graphic generator
(`soullink.py`, `retro.py`, `soullink_gui.py`) and the scripts that build the
site's data and art.

## One-time setup

### 1. Firebase (shared saves): about 10 minutes, free, no credit card

1. Go to <https://console.firebase.google.com> and click **Create a project**.
   Name it (e.g. `nuzlocke-aid`), turn **off** Google Analytics, and create it.
   Note the **project ID** (shown under the project name and in the address
   bar, e.g. `nuzlocke-aid-1a2b3`). The console's menus move around, so the
   steps below link straight to each page; replace `PROJECT_ID` with yours.
2. **Anonymous sign-in:** open
   `https://console.firebase.google.com/project/PROJECT_ID/authentication/providers`
   (click **Get started** if shown), choose **Anonymous → Enable → Save**.
   Nobody makes an account; the app signs in invisibly.
3. **Firestore:** open `https://console.firebase.google.com/project/PROJECT_ID/firestore`,
   click **Create database**, pick a location near you, choose
   **Start in production mode**, and create it.
4. In Firestore, open the **Rules** tab, replace everything with the contents
   of [`firestore.rules`](firestore.rules), and click **Publish**.
5. Click the gear → **Project settings → General → Your apps → Web (`</>`)**.
   Give it a nickname, leave "Firebase Hosting" unticked, and **Register app**.
   Copy the `firebaseConfig = { ... }` object it shows into
   [`docs/firebase-config.js`](docs/firebase-config.js), so that file reads:
   ```js
   export const firebaseConfig = {
     apiKey: "…",
     authDomain: "…",
     projectId: "…",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…",
   };
   ```
   (These values are meant to be public; the security rules protect the data.)

### 2. GitHub Pages (hosting)

1. Create a **public** repository at <https://github.com/new> (e.g.
   `nuzlocke-aid`), without a README.
2. Push this folder:
   ```bash
   git remote add origin https://github.com/<your-username>/nuzlocke-aid.git
   git push -u origin main
   ```
3. In the repository: **Settings → Pages → Build and deployment → Deploy from a
   branch → `main` / `/docs` → Save.** After a minute the site is live at
   `https://<your-username>.github.io/nuzlocke-aid/`.
   (Firebase's "authorized domains" list doesn't need changing: it only
   applies to sign-in pop-ups, and this app signs in anonymously.)

On your phone, open the site and use **Share → Add to Home Screen** to get an
app icon.

## Using it

- **New run:** pick the game, Nuzlocke or Soul link, and your names.
- **Other games:** choose **Other game (your own locations)** for any game,
  including newer games and ROM hacks. Name the game and paste its locations
  (one per line, in order); edit them any time in **Settings**. Every Pokémon
  from all nine generations is available, shown in the modern look with
  official artwork.
- **Soul link:** open **Settings (⚙)** and send your partner the link. Both
  phones see each other's logs live.
- **Log:** choose the next location, tap the Pokémon (the ones found there are
  listed first; in a soul link, pick both players' Pokémon), add nicknames,
  and tap **Caught**, **Failed** or **Invalid** once for the encounter.
  Caught Pokémon join the party; if it's full you choose who to swap out.
- **Randomizer:** tick **Randomizer** when starting a run, or switch it on in
  **Settings**. The Log page then stops suggesting the game's Pokémon for
  each location (search still finds any Pokémon).
- **Look:** in **Settings**, switch any run between the game's look and a
  **Modern** look, and choose the Pokémon art: game sprites, official artwork,
  or Ken Sugimori's early artwork (#1–251; later Pokémon use official art).
- **Evolving:** on the Team or Box page, tap a Pokémon and pick what it evolved
  into (only evolutions that exist in your game are listed; **Something
  else?** covers anything unusual). The List page remembers what it was
  caught as.
- **Badges:** the Team page shows the game's badges (greyed out until
  earned), the Elite Four and the Champion. Tap one when you earn it.
- **Johto games (Gold, Silver, Crystal, HeartGold, SoulSilver):** choose a
  **Goal** when starting (or in Settings): the **Johto League** (8 badges,
  Elite Four, Champion Lance) or the **Full game** (plus the 8 Kanto badges,
  the Elite Four and Champion again, then Red). Victory comes at the goal's
  final battle.
- **Ending a run:** marking the Champion offers to record a **victory**; a
  faint that leaves nobody alive in the party or box offers to record a
  **defeat**; **Settings → Abandon** ends it any time. An ended run is frozen
  (Settings → **Reopen run** undoes a mistake).
- **Share run (view only):** in **Settings**, **👁 Share run** makes a link to
  a live, read-only summary: your team, badges, stats, the run's history,
  graveyard and box. Viewers can't change anything. **New link** or **Stop
  sharing** at any time.
- **Team / Box / Grave:** move Pokémon between them; a faint takes the whole
  soul-linked pair to the graveyard. Each has a graphic button to share an image.
- **List:** every encounter; tap one to fix a mistake, or ✕ to remove it.
- **Removing a mistake:** tap **Undo** on the message right after logging,
  tap the Pokémon on the Team or Box page → **Remove encounter**, or use ✕ on
  the List page. The whole encounter (both players' in a soul link) is
  deleted and its location goes back on the list.

## Development

```bash
python3 -m http.server -d docs 8000        # then open http://localhost:8000
npm test                                   # rules + data tests (needs Node 20+)
python3 tools/stamp_version.py             # before committing a site change (see below)
```

`tools/stamp_version.py` tags the site's scripts and stylesheet with a hash of
the code (`app.js?v=1a2b3c4d`), so phones load an update as soon as it's
published instead of reusing cached copies. Run it after editing anything in
`docs/js` or `docs/app.css`.

Rebuilding the data and art (downloads from Bulbapedia, PokeAPI and
Bulbagarden Archives, cached in `.artwork_cache/`):

```bash
python3 tools/build_locations.py        # docs/data/locations/<game>.json
python3 tools/build_site_assets.py      # sprites, text boxes, wallpapers, styles.json
python3 tools/build_art.py              # official (Bulbapedia) + early Sugimori (pokemondb) artwork
python3 tools/build_evolutions.py       # what each Pokémon evolves into (PokeAPI)
python3 tools/build_badges.py           # each game's badges, Elite Four and Champion
python3 tools/check_styles.py           # checks every game style's art still resolves
```

Location lists come from each game's Bulbapedia walkthrough order and PokeAPI
encounter data. They're plain JSON, so fix any mistakes by editing
`docs/data/locations/<game>.json` (or add missing places in the app with
**+ Add a location…**).

Pokémon names, sprites and art are © Nintendo / Game Freak / The Pokémon Company.
Art is from Bulbagarden Archives. This is a free fan tool, not affiliated with them.
Pixelify Sans is licensed under the SIL Open Font License (see `fonts/`).
