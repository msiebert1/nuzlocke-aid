// Team, box and graveyard graphics drawn on a <canvas>: a port of retro.render
// from the desktop image generator, using the same built game assets.
// Everything is laid out at the game's native pixel size, scaled up by a whole
// number, and then the sprites are drawn at one shared whole-number scale.

import * as R from "./rules.js";
import { esc, modal, monName, toast } from "./ui.js";

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

function textWidth(ctx, text, size) {
  ctx.font = FONT(size);
  return segments(text).reduce((w, s) =>
    w + (GENDER_GLYPHS[s] ? GENDER_GLYPHS[s][1][0].length + 2 : ctx.measureText(s).width), 0);
}

function fitSize(ctx, text, maxW, size) {
  while (size > 8 && textWidth(ctx, text, size) > maxW) size--;
  return size;
}

/** Text with no anti-aliasing: drawn, then every pixel snapped on or off. */
function crispText(ctx, text, x, cy, size, color) {
  const w = Math.ceil(textWidth(ctx, text, size)) + 2, h = size * 2;
  const [c, cctx] = canvas(w, h);
  cctx.font = FONT(size);
  cctx.textBaseline = "middle";
  cctx.fillStyle = color;
  cctx.fillText(text, 0, h / 2);
  const data = cctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 3; i < px.length; i += 4) px[i] = px[i] >= 110 ? 255 : 0;
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
      ctx.font = FONT(size);
      x += ctx.measureText(seg).width;
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
  return { textbox, bg, sheet, link, walls, trainers };
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
  const a = await loadAssets(game, run);
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
      const rect = catchI && game.sheet[catchI.species];
      if (rect) jobs.push([a.sheet, ...rect, artBox(x, y), "mon"]);
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
    const k = groupScale[group];
    const src = group === "mon" ? sheet : img;
    octx.drawImage(src, sx, sy, sw, sh,
                   bx * scale + Math.floor((bw * scale - sw * k) / 2),
                   by * scale + Math.floor((bh * scale - sh * k) / 2), sw * k, sh * k);
  }
  return out;
}

/** Render a graphic: "team", "box" or "graveyard". */
export async function renderGraphic(session, kind) {
  const { run } = session;
  if (kind === "team") {
    return draw(session, R.party(run), { title: run.name, perRow: 6, trainers: true });
  }
  const units = kind === "box" ? R.box(run) : R.graveyard(run);
  const label = kind === "box" ? "Box" : "Graveyard";
  return draw(session, units, { title: `${run.name}: ${label}`, perRow: 6, trainers: false,
                                grey: kind === "graveyard" });
}

/** Render and show a graphic with Share / Download buttons. */
export async function showGraphic(session, kind) {
  toast("Drawing…");
  let blob;
  try {
    const c = await renderGraphic(session, kind);
    blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
  } catch (err) {
    console.error(err);
    toast(`Couldn't draw the graphic: ${err.message}`);
    return;
  }
  const url = URL.createObjectURL(blob);
  const name = `${session.run.name.replace(/[^\w-]+/g, "_")}_${kind}.png`;
  const file = new File([blob], name, { type: "image/png" });
  const canShare = navigator.canShare?.({ files: [file] });
  const choice = modal(`<h2>${esc(kind[0].toUpperCase() + kind.slice(1))}</h2>
    <img class="graphic" src="${url}" alt="${esc(kind)} graphic">
    <div class="btn-row">
      ${canShare ? `<button class="primary" id="share-graphic">Share…</button>` : ""}
      <a class="btn ${canShare ? "" : "primary"}" href="${url}" download="${esc(name)}">Download</a>
      <button data-value="close">Close</button></div>`);
  document.getElementById("share-graphic")?.addEventListener("click", () =>
    navigator.share({ files: [file], title: session.run.name }).catch(() => {}));
  await choice;
  URL.revokeObjectURL(url);
}
