// Shared page helpers: data loading, game theming, sprites, modal, toast.

// CSS pixels per game pixel for borders and backgrounds: 2, except for the DS
// games' text boxes, whose thick decorative caps would crowd a phone screen
const uiScale = (style) => (Math.max(...style.border) <= 8 ? 2 : 1);

const cache = new Map();
function getJSON(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(url);
}

export const loadStyles = () => getJSON("data/styles.json");
export const loadSpecies = () => getJSON("data/species.json");
export const loadLocations = (game) => getJSON(`data/locations/${game}.json`).then((d) => d.locations);
export const loadSheet = (game) => getJSON(`assets/${game}/sprites.json`);
// which species have official / early artwork: {official: [dex], sugimori: [dex]}
export const loadArt = () => getJSON("data/art.json").catch(() => ({}));

// "Other game": any game, including ones without built-in data. The player
// supplies the locations; every Pokémon (#1-1025) is available; it always uses
// the modern look with artwork, since there are no game sprites or art for it.
export const GENERIC = "generic";
export const GENERIC_STYLE = {
  name: "Other game", generic: true, lastDex: 1025,
  border: [2, 4, 4, 6], tileBorder: false, textShadow: true, cell: [112, 114],
  labelH: 34, titleH: 26, artInset: 4,
  walls: {}, defaultWalls: [], trainerWall: "", trainers: {}, defaultTrainers: [],
};
// customLocations is capped by the database rules
export const MAX_CUSTOM_LOCATIONS = 100;

/** Everything a game's pages need, loaded once. */
export async function loadGame(game) {
  const generic = game === GENERIC;
  const [styles, species, locations, sheet, art] = await Promise.all([
    loadStyles(), loadSpecies(), generic ? [] : loadLocations(game), generic ? {} : loadSheet(game),
    loadArt(),
  ]);
  const style = generic ? GENERIC_STYLE : styles[game];
  return {
    key: game,
    style,
    locations,
    sheet,
    species: species.filter((s) => s.dex <= style.lastDex),
    dex: Object.fromEntries(species.map((s) => [s.name, s.dex])),
    art: Object.fromEntries(Object.entries(art).map(([k, list]) => [k, new Set(list)])),
  };
}

export const ART_CHOICES = {
  sprites: "Game sprites",
  official: "Official artwork",
  sugimori: "Early Sugimori artwork (#1–251)",
};

/** The run's Pokémon art choice (a generic game has no sprites). */
export function artKind(game, run) {
  const kind = run?.options?.art || "sprites";
  return game.style.generic && kind === "sprites" ? "official" : kind;
}

/** Whether a run uses the modern look (always, for a generic game). */
export function isModern(session) {
  return !!session.game?.style.generic || session.run?.options?.look === "modern";
}

/** Display name of a run's game. */
export function gameName(session) {
  return (session.game.style.generic && session.run.gameName) || session.game.style.name;
}

/** URL of a Pokémon's artwork, or null to use its sprite. Early artwork only
 *  exists for #1-251; later Pokémon use their official artwork. */
export function artUrl(game, name, kind) {
  const dex = game.dex[name];
  if (!dex || kind === "sprites" || !kind) return null;
  if (kind === "sugimori" && game.art.sugimori?.has(dex)) return `assets/art/sugimori/${dex}.webp`;
  if (game.art.official?.has(dex)) return `assets/art/official/${dex}.webp`;
  return null;
}

/** A Pokémon in the run's chosen art: a sprite at `scale`, or artwork fitted
 *  to a `size` px square. */
export function monImage(session, name, { scale = 1, size = 64, cls = "" } = {}) {
  const url = artUrl(session.game, name, artKind(session.game, session.run));
  if (!url) return sprite(session.game, name, scale, cls);
  return `<img class="art ${cls}" src="${url}" alt="${esc(name)}" loading="lazy"
    style="width:${size}px;height:${size}px">`;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Dress the page in a game's look (or clear it with null). `look` is
 *  "game" (the game's art) or "modern" (clean cards, no game art). */
export function applyTheme(game, style, look = "game") {
  const body = document.body;
  body.dataset.look = style?.generic ? "modern" : look;
  if (!game || style.generic) {
    if (style?.generic) body.dataset.game = game;
    else delete body.dataset.game;
    body.removeAttribute("style");
    return;
  }
  const [l, t, r, b] = style.border;
  const [bw, bh] = style.bgSize;
  const U = uiScale(style);
  body.dataset.game = game;
  body.style.setProperty("--bg-img", `url(assets/${game}/bg.png)`);
  body.style.setProperty("--bg-size", `${bw * U}px ${bh * U}px`);
  body.style.setProperty("--tb-img", `url(assets/${game}/textbox.png)`);
  body.style.setProperty("--tb-slice", `${t} ${r} ${b} ${l} fill`);
  body.style.setProperty("--tb-border", `${t * U}px ${r * U}px ${b * U}px ${l * U}px`);
  // small buttons use the border at 1x so their labels fit
  body.style.setProperty("--tb-border-sm", `${t}px ${r}px ${b}px ${l}px`);
  body.style.setProperty("--tb-repeat", style.tileBorder ? "round" : "stretch");
}

/** Largest whole-number scale at which all these sprites fit a size x size box,
 *  so they keep their relative sizes (like the team graphic). */
export function spriteScale(game, names, size) {
  const dims = names.map((n) => game.sheet[n]).filter(Boolean);
  if (!dims.length) return 1;
  return Math.max(1, Math.floor(Math.min(...dims.map(([, , w, h]) => size / Math.max(w, h)))));
}

/** A sprite from the game's sheet as HTML. */
export function sprite(game, name, scale = 1, cls = "") {
  const rect = game.sheet[name];
  if (!rect) {
    return `<span class="spr missing ${cls}" style="width:${40 * scale}px;height:${40 * scale}px">?</span>`;
  }
  const [x, y, w, h] = rect;
  return `<span class="spr ${cls}" role="img" aria-label="${esc(name)}" style="` +
    `width:${w * scale}px;height:${h * scale}px;` +
    `background-image:url(assets/${game.key}/sprites.png);` +
    `background-position:${-x * scale}px ${-y * scale}px;` +
    `background-size:${1024 * scale}px auto"></span>`;
}

/** The box behind a sprite: a wallpaper, or the text-box frame in Gen I-II. */
export function cellStyle(game, wallpaper) {
  const file = game.style.walls[wallpaper];
  return file
    ? { cls: "cell", style: `background-image:url(assets/${game.key}/${file})` }
    : { cls: "cell frame", style: "" };
}

export function trainerImg(game, name, height = 112) {
  const file = game.style.trainers[name];
  return file ? `<img src="assets/${game.key}/${file}" alt="${esc(name)}" style="height:${height}px">` : "";
}

export function linkIcon(name = "heart", size = 26) {
  return `<img class="link" src="assets/common/link_${name}.png" alt="linked" style="width:${size}px">`;
}

// --- Modal ------------------------------------------------------------------

let modalResolve = null;

/** Show a modal; resolves with the data-value of the button pressed (or null). */
export function modal(html) {
  const el = document.getElementById("modal");
  el.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
  el.hidden = false;
  return new Promise((resolve) => {
    modalResolve = resolve;
    el.onclick = (e) => {
      const btn = e.target.closest("[data-value]");
      if (btn) closeModal(btn.dataset.value);
      else if (e.target === el) closeModal(null);
    };
  });
}

export function closeModal(value = null) {
  const el = document.getElementById("modal");
  el.hidden = true;
  el.innerHTML = "";
  modalResolve?.(value);
  modalResolve = null;
}

export async function confirmBox(message, yes = "Yes", no = "Cancel") {
  const v = await modal(`<p>${message}</p><div class="btn-row">
    <button data-value="no">${esc(no)}</button>
    <button class="primary" data-value="yes">${esc(yes)}</button></div>`);
  return v === "yes";
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

/** Display name for a catch: nickname, else species. */
export function monName(c) {
  return c.nickname || c.species || "—";
}
