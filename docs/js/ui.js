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
  const [styles, species, locations, sheet, art, evolutions, badges] = await Promise.all([
    loadStyles(), loadSpecies(), generic ? [] : loadLocations(game), generic ? {} : loadSheet(game),
    loadArt(), getJSON("data/evolutions.json").catch(() => ({})),
    getJSON("data/badges.json").catch(() => ({})),
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
    evolutions, // {species: [what it evolves into]}
    // badges, Elite Four and Champion, in the order they're earned
    milestones: badges[game] || badges.generic || [],
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
export function monImage(session, name, { scale = 1, size = 64, cls = "", fit = null } = {}) {
  const url = artUrl(session.game, name, artKind(session.game, session.run));
  if (fit) return fittedImage(session.game, name, url, fit, cls);
  if (!url) return sprite(session.game, name, scale, cls);
  return `<img class="art ${cls}" src="${url}" alt="${esc(name)}" loading="lazy"
    style="width:${size}px;height:${size}px">`;
}

/** How the team picture sizes Pokémon in a box, so the pages can match it:
 *  the box is `refW` x `refH` picture pixels, artwork fills `areaW` x
 *  `areaH`, and every sprite is scaled by the same whole number `k` (the
 *  largest at which all of `names` fit), keeping their relative sizes. */
export function boxFit(session, names) {
  const { game } = session;
  const kind = artKind(game, session.run);
  const modern = isModern(session);
  const [refW, refH] = modern ? [234, 212] : game.style.cell;
  const inset = modern ? 10 : game.style.artInset;
  const areaW = refW - 2 * inset, areaH = refH - 2 * inset;
  const rects = names.filter((n) => !artUrl(game, n, kind)).map((n) => game.sheet[n]).filter(Boolean);
  const k = rects.length
    ? Math.max(1, Math.floor(Math.min(...rects.map(([, , w, h]) => Math.min(areaW / w, areaH / h)))))
    : 1;
  return { k, refW, refH, areaW, areaH };
}

/** A Pokémon sized as a share of its box (CSS container units), matching the picture. */
function fittedImage(game, name, url, { k, refW, areaW, areaH }, cls) {
  const u = (px) => `${((px / refW) * 100).toFixed(3)}cqw`;
  if (url) {
    return `<img class="art ${cls}" src="${url}" alt="${esc(name)}" loading="lazy"
      style="width:${u(areaW)};height:${u(areaH)}">`;
  }
  const rect = game.sheet[name];
  if (!rect) return `<span class="spr missing ${cls}">?</span>`;
  const [x, y, w, h] = rect;
  return `<span class="spr ${cls}" role="img" aria-label="${esc(name)}" style="` +
    `width:${u(w * k)};height:${u(h * k)};` +
    `background-image:url(assets/${game.key}/sprites.png);` +
    `background-position:${u(-x * k)} ${u(-y * k)};` +
    `background-size:${u(1024 * k)} auto"></span>`;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Pixelify Sans is drawn on a 12-pixel grid, so it only renders evenly when
 *  each font pixel covers a whole number of screen pixels; otherwise strokes
 *  come out a mix of 1 and 2 pixels wide and look smeared or bold. Pick the
 *  text sizes for this screen's pixel density: about 1.5 CSS px per font
 *  pixel for body text (18px on most phones, 16px on 3x screens) and 2 for
 *  headings (24px). */
function setPixelFontSizes() {
  const dpr = window.devicePixelRatio || 1;
  const size = (cssPerFontPixel) => (Math.max(1, Math.round(cssPerFontPixel * dpr)) / dpr) * 12;
  const root = document.documentElement.style;
  root.setProperty("--fs", `${size(1.5)}px`);
  root.setProperty("--fl", `${size(2)}px`);
}

/** Dress the page in a game's look (or clear it with null). `look` is
 *  "game" (the game's art) or "modern" (clean cards, no game art). */
export function applyTheme(game, style, look = "game") {
  const body = document.body;
  body.dataset.look = style?.generic ? "modern" : look;
  setPixelFontSizes();
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
/** A short message at the bottom of the screen, optionally with a button:
 *  toast("Logged", {label: "Undo", run: () => ...}). */
export function toast(message, action = null) {
  const el = document.getElementById("toast");
  el.textContent = "";
  el.append(Object.assign(document.createElement("span"), { textContent: message }));
  if (action) {
    const btn = Object.assign(document.createElement("button"), { type: "button", textContent: action.label });
    btn.className = "toast-action";
    btn.addEventListener("click", () => {
      el.hidden = true;
      action.run();
    }, { once: true });
    el.append(btn);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 6000 : 2600);
}

/** Remove an encounter after asking; its location goes back on the list. */
export async function removeEncounter(session, id, removeRule) {
  const enc = session.run.encounters.find((e) => e.id === id);
  if (!enc) return false;
  const names = enc.catches.map((c) => (c.nickname && c.species ? `${c.nickname} (${c.species})` : monName(c)))
    .filter((n) => n !== "—");
  const what = names.length ? ` (${names.join(" and ")})` : "";
  const ok = await confirmBox(`Remove the <b>${esc(enc.location)}</b> encounter${esc(what)}?
    It's deleted${session.run.mode === "soul" ? " for both players" : ""}, and ${esc(enc.location)}
    goes back on the list of locations.`, "Remove");
  if (!ok) return false;
  await session.update((r) => removeRule(r, id));
  toast(`Removed: ${enc.location} is back on the list`);
  return true;
}

/** Display name for a catch: nickname, else species. */
export function monName(c) {
  return c.nickname || c.species || "—";
}

/** The run's badges and League progress as a row of icons; earned ones in
 *  colour, the rest greyed out. */
export function badgeRow(session, { size = 34, tappable = false } = {}) {
  const { run, game } = session;
  const items = game.milestones;
  if (!items.length) return "";
  const icon = (m) => {
    const earned = !!run.progress?.[m.key];
    const title = `${m.name}${m.leader ? ` (${m.leader})` : ""}${earned ? "" : ": not yet"}`;
    const inner = `<img src="assets/${m.icon}" alt="${esc(title)}" title="${esc(title)}"
        style="width:${size}px;height:${size}px">${m.number ? `<span class="badge-num">${m.number}</span>` : ""}`;
    return tappable
      ? `<button type="button" class="badge ${earned ? "earned" : ""}" data-milestone="${esc(m.key)}">${inner}</button>`
      : `<span class="badge ${earned ? "earned" : ""}">${inner}</span>`;
  };
  return `<div class="badge-row">${items.map(icon).join("")}</div>`;
}

export function badgeCount(session) {
  const badges = session.game.milestones.filter((m) => m.kind === "badge");
  return { earned: badges.filter((m) => session.run.progress?.[m.key]).length, total: badges.length };
}
