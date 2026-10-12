// Team, box and graveyard graphics drawn on a <canvas>: a port of retro.render
// from the desktop image generator, using the same built game assets.
// Everything is laid out at the game's native pixel size, scaled up by a whole
// number, and then the sprites are drawn at one shared whole-number scale.

import * as R from "./rules.js?v=e78cdade";
import { artKind, artUrl, esc, gameName, isModern, modal, monName, toast } from "./ui.js?v=e78cdade";

const MARGIN = 8, COL_GAP = 4, ROW_GAP = 22, GRID_GAP = 14;
const INK = "#383840", INK_SHADOW = "#d0d0d8", INK_LIGHT = "#686870";
const FONT_SIZE = 12, SMALL_FONT_SIZE = 11;
const FONT = (size) => `${size}px "Pixelify Sans"`;

const images = new Map();
function loadImage(src) {
  if (!images.has(src)) {
    images.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Couldn't load ${src}`));
      img.src = src;
    }));
  }
  return images.get(src);
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

// --- Nine-slice boxes -----------------------------------------------------------

/** Repeat a piece of an image over a rectangle (cropping the last tiles). */
function tilePiece(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
  for (let y = 0; y < dh; y += sh) {
    for (let x = 0; x < dw; x += sw) {
      const cw = Math.min(sw, dw - x), ch = Math.min(sh, dh - y);
      ctx.drawImage(img, sx, sy, cw, ch, dx + x, dy + y, cw, ch);
    }
  }
}

/** Draw a bordered box at any size without distorting its corners. */
function nineSlice(ctx, img, [l, t, r, b], dx, dy, w, h, tile) {
  const sw = img.width, sh = img.height;
  const xs = [[0, l, 0, l], [l, sw - r, l, w - r], [sw - r, sw, w - r, w]];
  const ys = [[0, t, 0, t], [t, sh - b, t, h - b], [sh - b, sh, h - b, h]];
  for (const [sx0, sx1, dx0, dx1] of xs) {
    for (const [sy0, sy1, dy0, dy1] of ys) {
      if (dx1 <= dx0 || dy1 <= dy0) continue;
      const args = [img, sx0, sy0, sx1 - sx0, sy1 - sy0, dx + dx0, dy + dy0, dx1 - dx0, dy1 - dy0];
      if (tile) tilePiece(ctx, ...args);
      else ctx.drawImage(...args);
    }
  }
}

// --- Pixel text -------------------------------------------------------------------

// The pixel font has no gender symbols, so draw them like the games do.
const GENDER_GLYPHS = {
  "♂": ["#3070f0", ["...###", ".....#", "....##", ".###.#", "#...#.", "#...#.", "#...#.", ".###.."]],
  "♀": ["#e84848", [".###.", "#...#", "#...#", "#...#", ".###.", "..#..", "#####", "..#..", "..#.."]],
};

function segments(text) {
  const out = [];
  let buf = "";
  for (const ch of text) {
    if (GENDER_GLYPHS[ch]) {
      if (buf) out.push(buf);
      out.push(ch);
      buf = "";
    } else buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

// Pre-drawn pixel font (built by tools/build_site_assets.py, exactly as the
// desktop generator draws it), so text looks the same in every browser:
// browsers rasterize fonts differently, and Safari's came out bold.
// {size: {char: [x, y, w, h, dx, dy, advance]}} plus a sheet of white glyphs.
let atlas = null;
const tinted = new Map(); // color -> glyph sheet in that color

async function loadFontAtlas() {
  if (!atlas) {
    atlas = Promise.all([
      fetch("assets/common/font/pixelify.json").then((r) => r.json()),
      loadImage("assets/common/font/pixelify.png"),
    ]).then(([glyphs, sheet]) => ({ glyphs, sheet }));
  }
  return atlas;
}

function tintedSheet(font, color) {
  if (!tinted.has(color)) {
    const [c, cctx] = canvas(font.sheet.width, font.sheet.height);
    cctx.drawImage(font.sheet, 0, 0);
    cctx.globalCompositeOperation = "source-in";
    cctx.fillStyle = color;
    cctx.fillRect(0, 0, c.width, c.height);
    tinted.set(color, c);
  }
  return tinted.get(color);
}

let FONT_ATLAS = null; // set by loadAssets before anything is drawn

/** Width of a run of plain text: pre-drawn glyph advances where we have them. */
function plainWidth(ctx, text, size) {
  const glyphs = FONT_ATLAS?.glyphs[size];
  let w = 0;
  for (const ch of text) {
    if (glyphs?.[ch]) w += glyphs[ch][6];
    else { ctx.font = FONT(size); w += ctx.measureText(ch).width; }
  }
  return w;
}

function textWidth(ctx, text, size) {
  return segments(text).reduce((w, s) =>
    w + (GENDER_GLYPHS[s] ? GENDER_GLYPHS[s][1][0].length + 2 : plainWidth(ctx, s, size)), 0);
}

function fitSize(ctx, text, maxW, size) {
  while (size > 8 && textWidth(ctx, text, size) > maxW) size--;
  return size;
}

/** Pixel text from the pre-drawn glyphs; any character missing from them
 *  falls back to the browser's font (snapped to whole pixels). */
function crispText(ctx, text, x, cy, size, color) {
  const glyphs = FONT_ATLAS?.glyphs[size];
  if (!glyphs) return browserText(ctx, text, x, cy, size, color);
  const sheet = tintedSheet(FONT_ATLAS, color);
  let pen = 0;
  for (const ch of text) {
    const g = glyphs[ch];
    if (g) {
      const [gx, gy, w, h, dx, dy, adv] = g;
      if (w) ctx.drawImage(sheet, gx, gy, w, h, Math.round(x + pen) + dx, Math.round(cy) + dy, w, h);
      pen += adv;
    } else {
      browserText(ctx, ch, x + pen, cy, size, color);
      ctx.font = FONT(size);
      pen += ctx.measureText(ch).width;
    }
  }
}

/** Browser-drawn text snapped to whole pixels (fallback only). */
function browserText(ctx, text, x, cy, size, color) {
  const w = Math.ceil(textWidth(ctx, text, size)) + 2, h = size * 2;
  const [c, cctx] = canvas(w, h);
  cctx.font = FONT(size);
  cctx.textBaseline = "middle";
  cctx.fillStyle = color;
  cctx.fillText(text, 0, h / 2);
  const data = cctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 3; i < px.length; i += 4) px[i] = px[i] >= 160 ? 255 : 0;
  cctx.putImageData(data, 0, 0);
  ctx.drawImage(c, Math.round(x), Math.round(cy - h / 2));
}

/** Centered text, optionally with the game's drop shadow. */
function shadowText(ctx, cx, cy, text, size, color, shadow) {
  let x = Math.round(cx - textWidth(ctx, text, size) / 2);
  for (const seg of segments(text)) {
    if (GENDER_GLYPHS[seg]) {
      const [glyphColor, rows] = GENDER_GLYPHS[seg];
      x += 1;
      const top = Math.round(cy - rows.length / 2);
      const layers = (shadow ? [[INK_SHADOW, 1]] : []).concat([[glyphColor, 0]]);
      for (const [col, d] of layers) {
        ctx.fillStyle = col;
        rows.forEach((row, j) => [...row].forEach((ch, i) => {
          if (ch === "#") ctx.fillRect(x + i + d, top + j + d, 1, 1);
        }));
      }
      x += rows[0].length + 1;
    } else {
      if (shadow) crispText(ctx, seg, x + 1, cy + 1, size, INK_SHADOW);
      crispText(ctx, seg, x, cy, size, color);
      x += plainWidth(ctx, seg, size);
    }
  }
}

// --- The renderer ---------------------------------------------------------------

class Painter {
  constructor(game, assets) {
    this.game = game;
    this.style = game.style;
    this.a = assets;
    this.labelH = this.style.labelH;
    this.titleH = this.style.titleH;
  }

  textBox(ctx, x, y, w, h, lines) {
    const [l, t, r, b] = this.style.border;
    nineSlice(ctx, this.a.textbox, this.style.border, x, y, w, h, this.style.tileBorder);
    const cx = x + Math.floor(w / 2), mid = y + Math.floor((t + h - b) / 2);
    const maxW = w - l - r - 4, shadow = this.style.textShadow;
    lines = lines.filter(Boolean);
    if (lines.length === 1) {
      shadowText(ctx, cx, mid + 2, lines[0], fitSize(ctx, lines[0], maxW, FONT_SIZE), INK, shadow);
    } else if (lines.length) {
      shadowText(ctx, cx, mid - 5, lines[0], fitSize(ctx, lines[0], maxW, FONT_SIZE), INK, shadow);
      shadowText(ctx, cx, mid + 7, lines[1], fitSize(ctx, lines[1], maxW, SMALL_FONT_SIZE), INK_LIGHT, shadow);
    }
  }

  cell(ctx, x, y, wall) {
    const [w, h] = this.style.cell;
    const img = this.a.walls[wall];
    if (img) ctx.drawImage(img, x, y);
    else nineSlice(ctx, this.a.textbox, this.style.border, x, y, w, h, this.style.tileBorder);
  }
}

async function loadAssets(game, run) {
  const style = game.style;
  const base = `assets/${game.key}/`;
  const wallNames = new Set([...(run.options?.wallpapers || style.defaultWalls), style.trainerWall]);
  const walls = {};
  await Promise.all([...wallNames].filter((w) => style.walls[w]).map(async (w) => {
    walls[w] = await loadImage(base + style.walls[w]);
  }));
  const trainers = await Promise.all(run.players.map((p) =>
    style.trainers[p.trainer] ? loadImage(base + style.trainers[p.trainer]) : null));
  const [textbox, bg, sheet, link] = await Promise.all([
    loadImage(base + "textbox.png"), loadImage(base + "bg.png"), loadImage(base + "sprites.png"),
    loadImage(`assets/common/link_${run.options?.link || "heart"}.png`),
  ]);
  await document.fonts.load(FONT(FONT_SIZE));
  FONT_ATLAS = await loadFontAtlas();
  return { textbox, bg, sheet, link, walls, trainers };
}

/** {species: image} of the run's chosen artwork for these units (empty for sprites). */
async function loadArtwork(session, units) {
  const kind = artKind(session.game, session.run);
  const out = {};
  const names = new Set(units.flatMap((e) => e.catches.map((c) => c.species)).filter(Boolean));
  await Promise.all([...names].map(async (name) => {
    const url = artUrl(session.game, name, kind);
    if (url) out[name] = await loadImage(url);
  }));
  return out;
}

/** Draw an image centered in a box: at a whole-number pixel scale `k` for
 *  sprites, or smoothly scaled to fit for artwork (k = null). */
function drawFitted(ctx, img, [sx, sy, sw, sh], [bx, by, bw, bh], k) {
  let w = sw * (k || 1), h = sh * (k || 1);
  if (!k) {
    const f = Math.min(bw / sw, bh / sh);
    w = Math.round(sw * f);
    h = Math.round(sh * f);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = !k;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, Math.round(bx + (bw - w) / 2), Math.round(by + (bh - h) / 2), w, h);
  ctx.restore();
}

/** Shared whole-number scale for sprites so all fit their boxes. */
function commonScale(rects, bw, bh) {
  if (!rects.length) return 1;
  return Math.max(1, Math.floor(Math.min(...rects.map(([, , w, h]) => Math.min(bw / w, bh / h)))));
}

function greyscale(img) {
  const [c, ctx] = canvas(img.width, img.height);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.round(0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]);
    px[i] = px[i + 1] = px[i + 2] = Math.min(255, v + 20);
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

/**
 * Lay out units (encounters) in a grid: each unit is a column with one row per
 * player (soul links joined by the link icon). Optionally a trainer column.
 */
async function draw(session, units, { title, perRow, trainers, grey = false, scale = 3 }) {
  const { run, game } = session;
  const [a, art] = await Promise.all([loadAssets(game, run), loadArtwork(session, units)]);
  const p = new Painter(game, a);
  const style = game.style;
  const [cellW, cellH] = style.cell;
  const players = R.playerCount(run);
  const walls = run.players.map((_, i) => run.options?.wallpapers?.[i] ?? style.defaultWalls[i]);
  const rowH = cellH + p.labelH;
  const blockH = players * rowH + (players - 1) * ROW_GAP;
  const cols = Math.max(1, Math.min(perRow, units.length));
  const gridRows = Math.max(1, Math.ceil(units.length / cols));
  // wide enough for the title at full size; a narrow grid is centered
  const [bl, , br] = style.border;
  const titleW = title ? Math.ceil(textWidth(canvas(1, 1)[1], title, FONT_SIZE)) + 18 + bl + br : 0;
  const gridW = (trainers ? cellW + COL_GAP : 0) + cols * cellW + (cols - 1) * COL_GAP;
  const W = Math.max(gridW, titleW) + 2 * MARGIN;
  const left = Math.floor((W - gridW) / 2);
  const firstCol = left + (trainers ? cellW + COL_GAP : 0);
  const top = MARGIN + (title ? p.titleH + 8 : 0);
  const H = top + gridRows * blockH + (gridRows - 1) * GRID_GAP + MARGIN;

  const [c, ctx] = canvas(W, H);
  tilePiece(ctx, a.bg, 0, 0, a.bg.width, a.bg.height, 0, 0, W, H);
  if (title) {
    p.textBox(ctx, Math.floor((W - titleW) / 2), MARGIN, titleW, p.titleH, [title]);
  }

  const inset = style.artInset;
  const jobs = []; // [image, sx, sy, sw, sh, box, group]
  const artBox = (x, y) => [x + inset, y + inset, cellW - 2 * inset, cellH - 2 * inset];

  if (trainers) {
    run.players.forEach((pl, i) => {
      const y = top + i * (rowH + ROW_GAP);
      p.cell(ctx, left, y, style.trainerWall);
      const t = a.trainers[i];
      if (t) jobs.push([t, 0, 0, t.width, t.height, artBox(left, y), "trainer"]);
      p.textBox(ctx, left, y + cellH, cellW, p.labelH, [pl.name || " "]);
    });
  }

  units.forEach((enc, n) => {
    const x = firstCol + (n % cols) * (cellW + COL_GAP);
    const y0 = top + Math.floor(n / cols) * (blockH + GRID_GAP);
    for (let i = 0; i < players; i++) {
      const catchI = enc.catches.find((cc) => cc.player === i);
      const y = y0 + i * (rowH + ROW_GAP);
      p.cell(ctx, x, y, walls[i]);
      const pic = catchI && art[catchI.species];
      const rect = catchI && game.sheet[catchI.species];
      if (pic) jobs.push([pic, 0, 0, pic.width, pic.height, artBox(x, y), "art"]);
      else if (rect) jobs.push([a.sheet, ...rect, artBox(x, y), "mon"]);
      const lines = catchI ? [monName(catchI), catchI.nickname ? catchI.species : ""] : ["—"];
      p.textBox(ctx, x, y + cellH, cellW, p.labelH, lines);
    }
    if (players === 2) {
      ctx.drawImage(a.link, x + Math.floor((cellW - a.link.width) / 2),
                    y0 + rowH + Math.floor(ROW_GAP / 2) - Math.floor(a.link.height / 2));
    }
  });

  // scale up, then draw sprites centered at one shared whole-number scale
  const [out, octx] = canvas(W * scale, H * scale);
  octx.drawImage(c, 0, 0, W * scale, H * scale);
  const boxW = (cellW - 2 * inset) * scale, boxH = (cellH - 2 * inset) * scale;
  const groupScale = {};
  for (const group of ["mon", "trainer"]) {
    const dims = jobs.filter((j) => j[6] === group);
    groupScale[group] = Math.max(1, Math.floor(Math.min(...dims.map((j) => Math.min(boxW / j[3], boxH / j[4])))));
  }
  const sheet = grey ? greyscale(a.sheet) : a.sheet;
  for (const [img, sx, sy, sw, sh, [bx, by, bw, bh], group] of jobs) {
    const box = [bx * scale, by * scale, bw * scale, bh * scale];
    if (group === "art") drawFitted(octx, grey ? greyscale(img) : img, [sx, sy, sw, sh], box, null);
    else drawFitted(octx, group === "mon" ? sheet : img, [sx, sy, sw, sh], box, groupScale[group]);
  }
  return out;
}

/** Render a graphic: "team", "box" or "graveyard". */
export async function renderGraphic(session, kind) {
  const { run } = session;
  const modern = isModern(session);
  if (kind === "team") {
    return modern
      ? drawModern(session, R.party(run), { title: run.name, perRow: 6, names: true })
      : draw(session, R.party(run), { title: run.name, perRow: 6, trainers: true });
  }
  const units = kind === "box" ? R.box(run) : R.graveyard(run);
  const opts = { title: `${run.name}: ${kind === "box" ? "Box" : "Graveyard"}`, perRow: 6,
                 grey: kind === "graveyard" };
  return modern ? drawModern(session, units, { ...opts, names: false })
                : draw(session, units, { ...opts, trainers: false });
}

// --- Modern look -------------------------------------------------------------------
// A port of the desktop generator's "modern" graphic: dark cards, one per unit,
// player 1 above player 2 with a chain between, blue / orange accent bars.

const M = {
  bg: "#181a21", card: "#262934", edge: "#3a3e4e", text: "#eceef4", sub: "#969caf",
  link: "#e65a6e", players: ["#60a5fa", "#fb923c"],
  cellW: 250, cellH: 270, labelH: 58, linkGap: 44, gap: 18, margin: 36, gridGap: 30,
  font: (size, bold = false) =>
    `${bold ? "700" : "400"} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A font that fits text within maxW, starting at `size`. */
function fitFont(ctx, text, maxW, size, bold) {
  while (size > 10) {
    ctx.font = M.font(size, bold);
    if (ctx.measureText(text).width <= maxW) break;
    size--;
  }
  return M.font(size, bold);
}

function chainIcon(ctx, cx, cy, s = 13) {
  const r = s / 1.6;
  ctx.strokeStyle = M.link;
  ctx.lineWidth = 4;
  for (const [a, b] of [[-2 * s, s / 3], [-s / 3, 2 * s]]) {
    roundRect(ctx, cx - r, cy + a, 2 * r, b - a, r);
    ctx.stroke();
  }
}

async function drawModern(session, units, { title, perRow, names, grey = false }) {
  const { run, game } = session;
  const [sheetImg, art] = await Promise.all([
    // a generic game has no sprite sheet (it always uses artwork)
    Object.keys(game.sheet).length ? loadImage(`assets/${game.key}/sprites.png`) : canvas(1, 1)[0],
    loadArtwork(session, units)]);
  const players = R.playerCount(run);
  const { cellW, cellH, labelH, linkGap, gap, margin } = M;
  const blockH = players * cellH + (players - 1) * linkGap;
  const cols = Math.max(1, Math.min(perRow, units.length));
  const gridRows = Math.max(1, Math.ceil(units.length / cols));

  const measure = canvas(1, 1)[1];
  measure.font = M.font(30, true);
  const gutter = names ? Math.max(...run.players.map((p) => measure.measureText(p.name).width)) + 40 : 0;
  measure.font = M.font(42, true);
  const titleW = title ? measure.measureText(title).width + 2 * margin : 0;
  const headerH = title ? 80 : 0;
  const gridW = gutter + cols * cellW + (cols - 1) * gap;
  const W = Math.ceil(Math.max(gridW + 2 * margin, titleW));
  const H = margin * 2 + headerH + gridRows * blockH + (gridRows - 1) * M.gridGap;
  const left = Math.floor((W - gridW) / 2);

  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = M.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (title) {
    ctx.font = M.font(42, true);
    ctx.fillStyle = M.text;
    ctx.fillText(title, W / 2, margin + 26);
  }
  const top = margin + headerH;
  const rowY = (row, i) => top + row * (blockH + M.gridGap) + i * (cellH + linkGap);

  if (names) {
    ctx.textAlign = "right";
    ctx.font = M.font(30, true);
    run.players.forEach((p, i) => {
      ctx.fillStyle = M.players[i];
      ctx.fillText(p.name, left + gutter - 30, rowY(0, i) + cellH / 2);
    });
    ctx.textAlign = "center";
  }

  // sprites share one whole-number scale; artwork is fitted to its box
  const boxSize = (bx0, by0, bx1, by1) => [bx0 + 10, by0 + 10, bx1 - bx0 - 20, by1 - by0 - 10 - labelH];
  const sample = boxSize(0, 0, cellW - 16, cellH - 10);
  const spriteRects = units.flatMap((e) => e.catches.map((cc) => !art[cc.species] && game.sheet[cc.species]))
    .filter(Boolean);
  const k = commonScale(spriteRects, sample[2], sample[3]);
  const sheet = grey ? greyscale(sheetImg) : sheetImg;

  units.forEach((enc, n) => {
    const x0 = left + gutter + (n % cols) * (cellW + gap);
    const row = Math.floor(n / cols);
    ctx.fillStyle = M.card;
    ctx.strokeStyle = M.edge;
    ctx.lineWidth = 2;
    roundRect(ctx, x0, rowY(row, 0), cellW, blockH, 18);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < players; i++) {
      const cc = enc.catches.find((x) => x.player === i);
      const [bx0, by0, bx1, by1] = [x0 + 8, rowY(row, i) + 6, x0 + cellW - 8, rowY(row, i) + cellH - 4];
      const box = boxSize(bx0, by0, bx1, by1);
      const pic = cc && art[cc.species];
      const rect = cc && game.sheet[cc.species];
      if (pic) drawFitted(ctx, grey ? greyscale(pic) : pic, [0, 0, pic.width, pic.height], box, null);
      else if (rect) drawFitted(ctx, sheet, rect, box, k);
      const label = cc ? monName(cc) : "—";
      const cx = (bx0 + bx1) / 2;
      ctx.fillStyle = M.text;
      ctx.font = fitFont(ctx, label, bx1 - bx0 - 12, 24, true);
      ctx.fillText(label, cx, by1 - labelH + 14);
      if (cc?.nickname) {
        ctx.fillStyle = M.sub;
        ctx.font = fitFont(ctx, cc.species, bx1 - bx0 - 12, 17, false);
        ctx.fillText(cc.species, cx, by1 - labelH + 37);
      }
      ctx.fillStyle = M.players[i];
      roundRect(ctx, bx0 + 30, by1 - 6, bx1 - bx0 - 60, 4, 2);
      ctx.fill();
    }
    if (players === 2) chainIcon(ctx, x0 + cellW / 2, rowY(row, 0) + cellH + linkGap / 2);
  });
  return c;
}

/** Render and show a graphic with Share / Download buttons. */
// Sharing: "Share" copies the picture and a ready-made post to the clipboard
// together (paste into a chat); "Save image" saves the picture. Browsers only
// allow copying during the tap itself, so each page draws its picture ahead
// of time (prepareGraphic) and the buttons use it straight away.

const prepared = new Map(); // kind -> {key, png: Promise<Blob>, blob (once drawn)}

/** Start drawing a graphic for the current run state (reused until it changes). */
export function prepareGraphic(session, kind) {
  const key = JSON.stringify([session.code, session.run.updatedAt, session.run.encounters.length, kind,
                              session.run.options, session.run.players, session.run.name]);
  const cached = prepared.get(kind);
  if (cached?.key === key) return cached.png;
  const png = renderGraphic(session, kind)
    .then((c) => new Promise((resolve) => c.toBlob(resolve, "image/png")));
  const entry = { key, png, blob: null };
  png.then((blob) => (entry.blob = blob), (err) => console.error(err));
  prepared.set(kind, entry);
  return png;
}

function postFor(session, kind) {
  return R.sharePost(session.run, kind, { game: gameName(session),
                                          site: `${location.origin}${location.pathname}` });
}

function fileName(session, kind) {
  return `${session.run.name.replace(/[^\w-]+/g, "_") || "nuzlocke"}_${kind}.png`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // older browsers: copy through a hidden text box
    const area = Object.assign(document.createElement("textarea"), { value: text });
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("copy failed");
  }
}

const NOUN = { team: "Team", box: "Box", graveyard: "Graveyard" };

/** Copy the picture and the post to the clipboard together. */
export async function shareGraphic(session, kind) {
  const png = prepareGraphic(session, kind);
  const post = postFor(session, kind);
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.share) {
    // Phones: the share sheet sends the picture and the post together (a
    // pasted clipboard only gives apps one of them). It must open during the
    // tap, so it uses the picture drawn when the page opened.
    const blob = prepared.get(kind)?.blob;
    if (!blob) {
      toast("Still drawing the picture: tap again in a moment");
      return;
    }
    const file = new File([blob], fileName(session, kind), { type: "image/png" });
    if (navigator.canShare?.({ files: [file], text: post })) {
      try {
        await navigator.share({ files: [file], text: post });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return; // closed the share sheet
        console.warn("Share sheet failed:", err);
      }
    }
  }
  // Computers (or no share sheet): copy the picture and the post
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      // both kinds of content in one clipboard item: apps paste the picture,
      // text boxes paste the post. The picture may still be drawing, so it's
      // passed as a promise (Safari requires the write to start during the tap).
      await navigator.clipboard.write([new ClipboardItem({
        "image/png": png,
        "text/plain": new Blob([post], { type: "text/plain" }),
      })]);
      toast(`${NOUN[kind]} picture and post copied: paste into a chat`);
      return;
    } catch (err) {
      console.warn("Couldn't copy the picture:", err);
    }
  }
  try {
    await copyText(post);
    toast("Post copied (this browser can't copy pictures: use Save image)");
  } catch {
    toast("Your browser didn't allow copying: use Save image");
  }
}

/** Save the picture: the share sheet on phones (Save Image puts it in
 *  Photos), a download on computers. */
export async function saveGraphic(session, kind) {
  let blob;
  try {
    blob = await prepareGraphic(session, kind);
  } catch (err) {
    toast(`Couldn't draw the picture: ${err.message}`);
    return;
  }
  const name = fileName(session, kind);
  const file = new File([blob], name, { type: "image/png" });
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return; // closed the share sheet
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast("Picture saved");
}

/** Show the picture full-size, with the same Copy and Save options. */
export async function viewGraphic(session, kind) {
  let blob;
  try {
    blob = await prepareGraphic(session, kind);
  } catch (err) {
    toast(`Couldn't draw the picture: ${err.message}`);
    return;
  }
  document.getElementById("toast").hidden = true; // clear any earlier message
  const url = URL.createObjectURL(blob);
  const touch = matchMedia("(pointer: coarse)").matches;
  const done = modal(`<h2>${esc(NOUN[kind])}</h2>
    <img class="graphic" src="${url}" alt="${esc(NOUN[kind])} picture">
    ${touch ? `<p class="muted" style="text-align:center"><small>Or press and hold the picture to save it.</small></p>` : ""}
    <div class="btn-row">
      <button class="primary" id="view-copy">📋 Share</button>
      <button id="view-save">💾 Save image</button>
    </div>
    <div class="btn-row" style="margin-top:8px"><button data-value="close">Close</button></div>`);
  document.getElementById("view-copy").addEventListener("click", () => shareGraphic(session, kind));
  document.getElementById("view-save").addEventListener("click", () => saveGraphic(session, kind));
  await done;
  URL.revokeObjectURL(url);
}
