// ============================================================================
// Runtime-generated block texture atlas.
//
// The terrain mesher (world.js) draws with a vertex-colored MeshLambertMaterial
// and sets this atlas as `material.map`, so the shader computes
//
//     final = map(uv) * vertexColor
//
// The vertex color already carries the block's hue, its AO, and its light
// level. This atlas therefore contributes SURFACE DETAIL ONLY: every tile is
// painted in near-white grayscale (base ~1.0, detail ~0.75-0.95, a few
// near-white highlights) so multiplying it never re-tints or crushes a block.
// The one deliberate exception is `accent` detail — ore flecks, organic
// nodules, rust specks — which carries the block def's own accent hue, because
// that is what finally makes iron and coal ore readable in the world.
//
// No image assets: everything is drawn with the 2D canvas API at first use.
// Nothing here touches the DOM at import time — the headless node tests import
// world.js, and getBlockAtlas() simply returns null when there is no document.
// ============================================================================

import * as THREE from 'three';
import { B, BLOCKS } from './config.js';
import { mulberry32, hashSeed } from './rng.js';

// --- atlas geometry --------------------------------------------------------
const TILE = 32;                  // px per tile
const COLS = 16, ROWS = 16;       // 256 slots — far more than the ~30 we use
const ATLAS_W = TILE * COLS;      // 512
const ATLAS_H = TILE * ROWS;      // 512

// ---------------------------------------------------------------------------
// Paint helpers. `l` is a luminance in 0..1; everything grayscale is clamped
// into NEUTRAL_MIN..1 so the multiply can never darken a block past recognition.
// ---------------------------------------------------------------------------
const NEUTRAL_MIN = 0.70;

function gray(l) {
  const v = Math.round(Math.min(1, Math.max(NEUTRAL_MIN, l)) * 255);
  return `rgb(${v},${v},${v})`;
}

function rgbOf(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }
function relLum(hex) {
  const [r, g, b] = rgbOf(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// An accent hex re-balanced for a MULTIPLY blend: keep the accent's hue
// direction (normalize so its brightest channel is full) and then scale it to
// an explicit brightness. A literal hex would be darkened twice — once by its
// own value, once by the block's vertex color — and read as mud.
function accentCss(hex, brightness) {
  const [r, g, b] = rgbOf(hex);
  const k = (255 / Math.max(r, g, b, 1)) * brightness;
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

// Bright accents (iron tan, spore green) become highlight-bright flecks; dark
// accents (coal) stay dark so they still read as coal. Hue is preserved either
// way; a dark accent's hue normalizes to near-neutral, which is correct.
function accentPair(hex) {
  if (hex === undefined || hex === null) return [gray(0.86), gray(0.76)];
  const dark = relLum(hex) <= 0.35;
  return [
    accentCss(hex, dark ? 0.44 : 0.98),
    accentCss(hex, dark ? 0.32 : 0.72),
  ];
}

const rf = (rnd, a, b) => a + rnd() * (b - a);
const ri = (rnd, a, b) => Math.floor(a + rnd() * (b - a + 1));
const wrap = (v) => ((v % TILE) + TILE) % TILE;

function fillTile(ctx, ox, oy, l) {
  ctx.fillStyle = gray(l);
  ctx.fillRect(ox, oy, TILE, TILE);
}

// A single (wrapping) dot, so scattered detail never runs into the next slot.
function dot(ctx, ox, oy, x, y, l, s = 1) {
  ctx.fillStyle = gray(l);
  ctx.fillRect(ox + wrap(x), oy + wrap(y), s, s);
}

function speckle(ctx, ox, oy, rnd, count, lo, hi, s = 1) {
  for (let i = 0; i < count; i++) {
    dot(ctx, ox, oy, ri(rnd, 0, TILE - 1), ri(rnd, 0, TILE - 1), rf(rnd, lo, hi), s);
  }
}

function disc(ctx, ox, oy, cx, cy, r, style) {
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.arc(ox + cx, oy + cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx, ox, oy, cx, cy, r, style, w = 1) {
  ctx.strokeStyle = style;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(ox + cx + 0.5, oy + cy + 0.5, Math.max(0.5, r), 0, Math.PI * 2);
  ctx.stroke();
}

// A 1px random walk — cracks, veins, grain.
function walk(ctx, ox, oy, rnd, x, y, dx, dy, steps, l, jitter = 1.4) {
  ctx.fillStyle = gray(l);
  let cx = x, cy = y;
  for (let i = 0; i < steps; i++) {
    ctx.fillRect(ox + Math.round(cx), oy + Math.round(cy), 1, 1);
    cx += dx + (rnd() - 0.5) * jitter;
    cy += dy + (rnd() - 0.5) * jitter;
    if (cx < -3 || cx > TILE + 3 || cy < -3 || cy > TILE + 3) break;
  }
}

// An irregular angular chip — ore flecks, scrap plate corners.
function chip(ctx, ox, oy, rnd, cx, cy, r, fillStyle, strokeStyle) {
  const n = ri(rnd, 4, 6);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rf(rnd, -0.35, 0.35);
    const rr = r * rf(rnd, 0.6, 1.15);
    const px = ox + cx + Math.cos(a) * rr;
    const py = oy + cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.lineWidth = 1; ctx.stroke(); }
}

// A rivet: a slightly darker stud with a top highlight and a bottom shadow.
function rivet(ctx, ox, oy, cx, cy, r = 1.8) {
  disc(ctx, ox, oy, cx, cy, r, gray(0.85));
  ctx.fillStyle = gray(1.0);
  ctx.fillRect(ox + Math.round(cx - r * 0.6), oy + Math.round(cy - r * 0.7), 1, 1);
  ctx.fillStyle = gray(0.78);
  ctx.fillRect(ox + Math.round(cx), oy + Math.round(cy + r * 0.5), 1, 1);
}

// ---------------------------------------------------------------------------
// Painters. Signature: (ctx, ox, oy, rnd, def) drawing into the 32x32 tile at
// (ox, oy). Canvas row 0 of the tile is the TOP of the block face — see the
// flipY note on tileUV() below.
// ---------------------------------------------------------------------------

function paintGeneric(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.98);
  speckle(ctx, ox, oy, rnd, 110, 0.88, 0.96);
  speckle(ctx, ox, oy, rnd, 34, 0.99, 1.0);
}

function paintStone(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.96);
  for (let i = 0; i < 8; i++) {
    disc(ctx, ox, oy, rf(rnd, 0, TILE), rf(rnd, 0, TILE), rf(rnd, 3.5, 8),
      gray(rnd() < 0.3 ? rf(rnd, 0.97, 1.0) : rf(rnd, 0.87, 0.93)));
  }
  speckle(ctx, ox, oy, rnd, 170, 0.86, 0.95);
  for (let i = 0; i < 3; i++) {
    const vertical = rnd() < 0.5;
    walk(ctx, ox, oy, rnd, ri(rnd, 2, 29), ri(rnd, 2, 29),
      vertical ? rf(rnd, -0.3, 0.3) : rf(rnd, 0.7, 1.1),
      vertical ? rf(rnd, 0.7, 1.1) : rf(rnd, -0.3, 0.3),
      ri(rnd, 9, 18), 0.78);
  }
  speckle(ctx, ox, oy, rnd, 26, 0.99, 1.0);
}

function paintBedrock(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.90);
  speckle(ctx, ox, oy, rnd, 430, 0.72, 0.86);
  for (let i = 0; i < 5; i++) {
    disc(ctx, ox, oy, rf(rnd, 0, TILE), rf(rnd, 0, TILE), rf(rnd, 2, 4.5), gray(rf(rnd, 0.74, 0.80)));
  }
  speckle(ctx, ox, oy, rnd, 70, 0.92, 0.99);
}

function paintDirt(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.96);
  speckle(ctx, ox, oy, rnd, 230, 0.82, 0.92);
  speckle(ctx, ox, oy, rnd, 90, 0.86, 0.93, 2);   // coarse granules
  speckle(ctx, ox, oy, rnd, 60, 0.97, 1.0);
  for (let i = 0; i < 9; i++) {                    // tiny stones
    const x = ri(rnd, 1, TILE - 4), y = ri(rnd, 1, TILE - 4);
    const w = ri(rnd, 2, 3), h = ri(rnd, 2, 3);
    ctx.fillStyle = gray(rf(rnd, 0.96, 1.0));
    ctx.fillRect(ox + x, oy + y, w, h);
    ctx.fillStyle = gray(0.80);
    ctx.fillRect(ox + x, oy + y + h, w, 1);        // underside shadow
  }
}

function paintGrassTop(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.97);
  speckle(ctx, ox, oy, rnd, 400, 0.84, 0.96);
  speckle(ctx, ox, oy, rnd, 120, 0.97, 1.0);
  for (let i = 0; i < 26; i++) {                   // short blade dashes
    const x = ri(rnd, 0, TILE - 1), y = ri(rnd, 0, TILE - 4);
    const len = ri(rnd, 2, 4), lean = rnd() < 0.5 ? 0 : (rnd() < 0.5 ? -1 : 1);
    const l = rnd() < 0.72 ? rf(rnd, 0.79, 0.87) : 1.0;
    for (let s = 0; s < len; s++) dot(ctx, ox, oy, x + lean * s, y + s, l);
  }
}

function paintGrassSide(ctx, ox, oy, rnd) {
  paintDirt(ctx, ox, oy, rnd);
  // Darker grass fringe across the top quarter, with a ragged lower edge that
  // hangs into the dirt. Canvas row 0 == the top of the block face.
  for (let x = 0; x < TILE; x++) {
    const d = ri(rnd, 5, 9);
    ctx.fillStyle = gray(rf(rnd, 0.83, 0.89));
    ctx.fillRect(ox + x, oy, 1, d);
    ctx.fillStyle = gray(0.78);
    ctx.fillRect(ox + x, oy + d - 1, 1, 1);        // dark lip at the soil line
    if (rnd() < 0.22) {                            // a blade hanging lower
      ctx.fillStyle = gray(0.81);
      ctx.fillRect(ox + x, oy + d, 1, ri(rnd, 1, 3));
    }
  }
  for (let i = 0; i < 34; i++) dot(ctx, ox, oy, ri(rnd, 0, TILE - 1), ri(rnd, 0, 7), rf(rnd, 0.90, 1.0));
}

function paintSand(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.99);
  speckle(ctx, ox, oy, rnd, 520, 0.90, 0.97);
  speckle(ctx, ox, oy, rnd, 150, 0.98, 1.0);
  for (let i = 0; i < 4; i++) {                    // faint wind ripples
    const base = ri(rnd, 2, TILE - 3), amp = rf(rnd, 1.2, 2.6), ph = rf(rnd, 0, 6.28);
    for (let x = 0; x < TILE; x++) {
      const y = Math.round(base + Math.sin(x * 0.35 + ph) * amp);
      dot(ctx, ox, oy, x, y, 0.92);
      dot(ctx, ox, oy, x, y - 1, 1.0);
    }
  }
}

function paintGravel(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.93);
  speckle(ctx, ox, oy, rnd, 210, 0.84, 0.91);
  for (let i = 0; i < 15; i++) {                   // pebbles with dark outlines
    const cx = rf(rnd, 1, TILE - 1), cy = rf(rnd, 1, TILE - 1), r = rf(rnd, 2.4, 4.6);
    disc(ctx, ox, oy, cx, cy, r, gray(rf(rnd, 0.90, 1.0)));
    ring(ctx, ox, oy, cx - 0.5, cy - 0.5, r, gray(0.77));
    dot(ctx, ox, oy, Math.round(cx - r * 0.4), Math.round(cy - r * 0.4), 1.0);
  }
  speckle(ctx, ox, oy, rnd, 60, 0.86, 0.94);
}

function paintOre(ctx, ox, oy, rnd, def) {
  paintStone(ctx, ox, oy, rnd);
  const [face, edge] = accentPair(def && def.accent);
  const dark = def && def.accent !== undefined && relLum(def.accent) <= 0.35;
  const n = ri(rnd, 5, 8);
  for (let i = 0; i < n; i++) {
    const cx = rf(rnd, 5, TILE - 5), cy = rf(rnd, 5, TILE - 5), r = rf(rnd, 2.2, 4.0);
    chip(ctx, ox, oy, rnd, cx, cy, r, face, edge);
    // Coal's accent is near-black: without a glint the fleck vanishes into the
    // block's own dark vertex color.
    ctx.fillStyle = dark ? gray(1.0) : gray(0.99);
    ctx.fillRect(ox + Math.round(cx - r * 0.35), oy + Math.round(cy - r * 0.45), 1, 1);
  }
}

function paintLogTop(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.97);
  const cx = 16 + rf(rnd, -1.5, 1.5), cy = 16 + rf(rnd, -1.5, 1.5);
  for (let r = 21; r > 1.5; r -= rf(rnd, 1.8, 3.0)) {
    ring(ctx, ox, oy, cx, cy, r, gray(rnd() < 0.5 ? rf(rnd, 0.82, 0.87) : rf(rnd, 0.92, 0.97)));
  }
  disc(ctx, ox, oy, cx, cy, 1.6, gray(0.80));      // heartwood
  speckle(ctx, ox, oy, rnd, 130, 0.90, 0.99);
  for (let i = 0; i < 2; i++)                      // radial checks
    walk(ctx, ox, oy, rnd, cx, cy, rf(rnd, -1.1, 1.1), rf(rnd, -1.1, 1.1), 14, 0.84, 0.7);
}

function paintLogSide(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.96);
  let x = 0;
  while (x < TILE) {                               // vertical bark striations
    const w = ri(rnd, 1, 3);
    const l = rf(rnd, 0.80, 0.93);
    for (let y = 0; y < TILE; y++) {
      const jx = x + (Math.sin(y * 0.4 + x) > 0.75 ? 1 : 0);
      ctx.fillStyle = gray(l + (rnd() - 0.5) * 0.05);
      ctx.fillRect(ox + wrap(jx), oy + y, w, 1);
    }
    x += w + ri(rnd, 1, 3);
  }
  for (let i = 0; i < 5; i++) {                    // near-white ridge highlights
    const hx = ri(rnd, 0, TILE - 1);
    for (let y = 0; y < TILE; y++) dot(ctx, ox, oy, hx, y, rnd() < 0.8 ? 1.0 : 0.95);
  }
  speckle(ctx, ox, oy, rnd, 90, 0.86, 0.94);
}

// Horizontal boards (PLANK) or vertical timbers (WOOD_WALL).
function paintBoards(ctx, ox, oy, rnd, vertical) {
  fillTile(ctx, ox, oy, 0.97);
  const seams = [10, 21];
  const bands = [[0, 10], [11, 21], [22, 32]];
  for (const [a, b] of bands) {
    const base = rf(rnd, 0.93, 1.0);
    for (let i = a; i < b; i++) {
      ctx.fillStyle = gray(base);
      if (vertical) ctx.fillRect(ox + i, oy, 1, TILE);
      else ctx.fillRect(ox, oy + i, TILE, 1);
    }
    for (let g = 0; g < 3; g++) {                  // grain lines
      const off = ri(rnd, a + 1, b - 2), l = rf(rnd, 0.84, 0.90);
      for (let t = 0; t < TILE; t++) {
        const w = Math.sin(t * 0.28 + g * 2.1) > 0.6 ? 1 : 0;
        if (vertical) dot(ctx, ox, oy, off + w, t, l);
        else dot(ctx, ox, oy, t, off + w, l);
      }
    }
    for (let k = 0; k < 2; k++) {                  // peg / knot
      const p = ri(rnd, a + 2, b - 3), q = ri(rnd, 3, TILE - 4);
      if (vertical) { dot(ctx, ox, oy, p, q, 0.79, 2); dot(ctx, ox, oy, p, q, 1.0); }
      else { dot(ctx, ox, oy, q, p, 0.79, 2); dot(ctx, ox, oy, q, p, 1.0); }
    }
  }
  for (const s of seams) {                         // seam shadow + lit edge
    ctx.fillStyle = gray(0.76);
    if (vertical) ctx.fillRect(ox + s, oy, 1, TILE); else ctx.fillRect(ox, oy + s, TILE, 1);
    ctx.fillStyle = gray(1.0);
    if (vertical) ctx.fillRect(ox + s + 1, oy, 1, TILE); else ctx.fillRect(ox, oy + s + 1, TILE, 1);
  }
  speckle(ctx, ox, oy, rnd, 70, 0.88, 0.96);
}

function paintPlank(ctx, ox, oy, rnd) { paintBoards(ctx, ox, oy, rnd, false); }
function paintTimber(ctx, ox, oy, rnd) { paintBoards(ctx, ox, oy, rnd, true); }

function paintLeaves(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.95);
  for (let i = 0; i < 34; i++) {                   // clumps
    disc(ctx, ox, oy, rf(rnd, 0, TILE), rf(rnd, 0, TILE), rf(rnd, 1.8, 4.2),
      gray(rnd() < 0.35 ? rf(rnd, 0.97, 1.0) : rf(rnd, 0.86, 0.94)));
  }
  speckle(ctx, ox, oy, rnd, 220, 0.84, 0.97);
  for (let i = 0; i < 7; i++) {                    // darker gaps between leaves
    disc(ctx, ox, oy, rf(rnd, 0, TILE), rf(rnd, 0, TILE), rf(rnd, 1.0, 2.2), gray(rf(rnd, 0.74, 0.80)));
  }
  speckle(ctx, ox, oy, rnd, 40, 0.99, 1.0);
}

// 2x2 bricks in an offset bond. `heavy` widens and darkens the mortar (kiln).
function paintBrick(ctx, ox, oy, rnd, heavy) {
  const mortar = heavy ? 0.76 : 0.83;
  const mw = heavy ? 2 : 1;
  fillTile(ctx, ox, oy, mortar);
  const rows = [[0, 15], [17, TILE]];
  const splits = [7, 23];                          // offset bond
  for (let r = 0; r < rows.length; r++) {
    const [y0, y1] = rows[r];
    const s = splits[r];
    const spans = [[0, s - mw], [s, TILE]];
    for (const [x0, x1] of spans) {
      if (x1 - x0 <= 0) continue;
      const l = rf(rnd, 0.92, 1.0);                // per-brick luminance variance
      ctx.fillStyle = gray(l);
      ctx.fillRect(ox + x0, oy + y0, x1 - x0, y1 - y0);
      for (let i = 0; i < 40; i++)                 // brick grit
        dot(ctx, ox, oy, ri(rnd, x0, x1 - 1), ri(rnd, y0, y1 - 1), l - rf(rnd, 0.02, 0.10));
      ctx.fillStyle = gray(Math.min(1, l + 0.04)); // lit top edge
      ctx.fillRect(ox + x0, oy + y0, x1 - x0, 1);
    }
  }
  ctx.fillStyle = gray(mortar - 0.03);
  ctx.fillRect(ox, oy + 15, TILE, mw + 1);         // the bed joint reads darkest
  speckle(ctx, ox, oy, rnd, 60, 0.88, 0.97);
}

function paintConcrete(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.95);
  for (let i = 0; i < 11; i++) {
    disc(ctx, ox, oy, rf(rnd, 0, TILE), rf(rnd, 0, TILE), rf(rnd, 3, 8),
      gray(rnd() < 0.35 ? rf(rnd, 0.97, 1.0) : rf(rnd, 0.87, 0.93)));
  }
  speckle(ctx, ox, oy, rnd, 190, 0.85, 0.95);
  // one long crack right across, with two short branches
  const startX = rf(rnd, 0, TILE), dx = rf(rnd, -0.5, 0.5);
  walk(ctx, ox, oy, rnd, startX, 0, dx, 1.0, 34, 0.76, 1.8);
  for (let i = 0; i < 2; i++)
    walk(ctx, ox, oy, rnd, rf(rnd, 4, TILE - 4), rf(rnd, 6, TILE - 6),
      rf(rnd, -1.1, 1.1), rf(rnd, -1.1, 1.1), ri(rnd, 5, 10), 0.79);
  for (let i = 0; i < 6; i++) {                    // edge chips
    const edge = ri(rnd, 0, 3), t = ri(rnd, 2, TILE - 5), w = ri(rnd, 2, 4);
    ctx.fillStyle = gray(rf(rnd, 0.79, 0.85));
    if (edge === 0) ctx.fillRect(ox + t, oy, w, ri(rnd, 1, 3));
    else if (edge === 1) ctx.fillRect(ox + t, oy + TILE - 2, w, 2);
    else if (edge === 2) ctx.fillRect(ox, oy + t, ri(rnd, 1, 3), w);
    else ctx.fillRect(ox + TILE - 2, oy + t, 2, w);
  }
  speckle(ctx, ox, oy, rnd, 40, 0.98, 1.0);
}

// Clean metal panelling. `plates` = 1 (one panel, walls) or 2 (2x2, floors).
function paintPanel(ctx, ox, oy, rnd, plates) {
  fillTile(ctx, ox, oy, 0.99);
  speckle(ctx, ox, oy, rnd, 120, 0.95, 0.99);
  const step = TILE / plates;
  for (let px = 0; px < plates; px++) {
    for (let py = 0; py < plates; py++) {
      const x0 = px * step, y0 = py * step;
      const inset = plates === 1 ? 2 : 1;
      const w = step - inset * 2, h = step - inset * 2;
      ctx.strokeStyle = gray(0.86);                // thin panel seam
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + x0 + inset + 0.5, oy + y0 + inset + 0.5, w - 1, h - 1);
      ctx.strokeStyle = gray(1.0);                 // lit inner lip
      ctx.strokeRect(ox + x0 + inset + 1.5, oy + y0 + inset + 1.5, w - 3, h - 3);
      const r = plates === 1 ? 1.8 : 1.2;
      const pad = plates === 1 ? 5 : 3.5;
      rivet(ctx, ox, oy, x0 + pad, y0 + pad, r);
      rivet(ctx, ox, oy, x0 + step - pad, y0 + pad, r);
      rivet(ctx, ox, oy, x0 + pad, y0 + step - pad, r);
      rivet(ctx, ox, oy, x0 + step - pad, y0 + step - pad, r);
    }
  }
  if (plates > 1) {                                // plate joint cross
    ctx.fillStyle = gray(0.88);
    ctx.fillRect(ox, oy + step - 1, TILE, 1);
    ctx.fillRect(ox + step - 1, oy, 1, TILE);
  }
}

function paintBrushed(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.98);
  for (let i = 0; i < 110; i++) {                  // brushed horizontal strokes
    const x = ri(rnd, 0, TILE - 1), y = ri(rnd, 0, TILE - 1), len = ri(rnd, 5, 20);
    ctx.fillStyle = gray(rnd() < 0.7 ? rf(rnd, 0.89, 0.96) : rf(rnd, 0.99, 1.0));
    for (let s = 0; s < len; s++) ctx.fillRect(ox + wrap(x + s), oy + y, 1, 1);
  }
  for (const [cx, cy] of [[4.5, 4.5], [27.5, 4.5], [4.5, 27.5], [27.5, 27.5]]) rivet(ctx, ox, oy, cx, cy, 2.2);
  ctx.strokeStyle = gray(0.90);                    // plate edge
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, TILE - 1, TILE - 1);
}

function paintScrap(ctx, ox, oy, rnd, def) {
  fillTile(ctx, ox, oy, 0.93);
  speckle(ctx, ox, oy, rnd, 140, 0.84, 0.92);
  for (let i = 0; i < 11; i++) {                   // chaotic overlapping plates
    const x = ri(rnd, -4, TILE - 5), y = ri(rnd, -4, TILE - 5);
    const w = ri(rnd, 6, 14), h = ri(rnd, 4, 12);
    const l = rf(rnd, 0.86, 0.98);
    ctx.fillStyle = gray(l);
    ctx.fillRect(ox + x, oy + y, w, h);
    for (let k = 0; k < w * h * 0.28; k++)         // grit, so no plate is flat
      dot(ctx, ox, oy, x + ri(rnd, 0, w - 1), y + ri(rnd, 0, h - 1), l - rf(rnd, 0.01, 0.08));
    ctx.fillStyle = gray(0.78);                    // shadowed bottom / right lip
    ctx.fillRect(ox + x, oy + y + h - 1, w, 1);
    ctx.fillRect(ox + x + w - 1, oy + y, 1, h);
    ctx.fillStyle = gray(Math.min(1, l + 0.05));   // lit top edge
    ctx.fillRect(ox + x, oy + y, w, 1);
    if (rnd() < 0.55) rivet(ctx, ox, oy, x + rf(rnd, 2, w - 2), y + rf(rnd, 2, h - 2), 1.4);
  }
  for (let i = 0; i < 6; i++) chip(ctx, ox, oy, rnd, rf(rnd, 2, TILE - 2), rf(rnd, 2, TILE - 2), rf(rnd, 1.5, 3), gray(rf(rnd, 0.86, 0.94)), gray(0.78));
  const [rust, rustEdge] = accentPair(def && def.accent);   // rust / wire specks
  for (let i = 0; i < 14; i++) {
    const x = ri(rnd, 0, TILE - 2), y = ri(rnd, 0, TILE - 2), s = rnd() < 0.7 ? 1 : 2;
    ctx.fillStyle = rnd() < 0.3 ? rustEdge : rust;
    ctx.fillRect(ox + x, oy + y, s, s);
  }
}

function paintWater(ctx, ox, oy, rnd) {
  // Deliberately very low contrast: water is a transparent, animated-feeling
  // surface and heavy detail reads as dirt on the lens.
  fillTile(ctx, ox, oy, 0.99);
  for (let i = 0; i < 6; i++) {
    const base = i * 5 + ri(rnd, 0, 3), amp = rf(rnd, 0.8, 2.0), ph = rf(rnd, 0, 6.28);
    const h = ri(rnd, 2, 4), l = rf(rnd, 0.94, 0.97);
    for (let x = 0; x < TILE; x++) {
      const y = Math.round(base + Math.sin(x * 0.22 + ph) * amp);
      for (let k = 0; k < h; k++) dot(ctx, ox, oy, x, y + k, l);
      dot(ctx, ox, oy, x, y - 1, 1.0);             // crest
    }
  }
  speckle(ctx, ox, oy, rnd, 40, 0.96, 1.0);
}

function paintGlass(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 0.96);
  ctx.strokeStyle = gray(0.86);                    // frame
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, TILE - 1, TILE - 1);
  ctx.strokeStyle = gray(0.92);
  ctx.strokeRect(ox + 2.5, oy + 2.5, TILE - 5, TILE - 5);
  for (let i = 0; i < 18; i++) {                   // the diagonal glint
    ctx.fillStyle = gray(1.0);
    ctx.fillRect(ox + 6 + i, oy + 24 - i, 2, 1);
  }
  for (let i = 0; i < 8; i++) {                    // its thin trailing streak
    ctx.fillStyle = gray(0.995);
    ctx.fillRect(ox + 14 + i, oy + 26 - i, 1, 1);
  }
  speckle(ctx, ox, oy, rnd, 26, 0.94, 0.99);
}

function paintOrganic(ctx, ox, oy, rnd, def) {
  fillTile(ctx, ox, oy, 0.96);
  for (let i = 0; i < 10; i++) {                   // overlapping blob outlines
    const cx = rf(rnd, 0, TILE), cy = rf(rnd, 0, TILE), r = rf(rnd, 3.5, 9);
    disc(ctx, ox, oy, cx, cy, r, gray(rf(rnd, 0.93, 1.0)));
    ring(ctx, ox, oy, cx, cy, r, gray(rf(rnd, 0.80, 0.87)));
  }
  for (let i = 0; i < 6; i++)                      // vein squiggles
    walk(ctx, ox, oy, rnd, rf(rnd, 0, TILE), rf(rnd, 0, TILE),
      rf(rnd, -1.0, 1.0), rf(rnd, -1.0, 1.0), ri(rnd, 8, 16), 0.80, 2.0);
  speckle(ctx, ox, oy, rnd, 120, 0.88, 0.97);
  const [node, nodeEdge] = accentPair(def && def.accent);
  for (let i = 0; i < 7; i++) {                    // accent nodules
    const cx = rf(rnd, 3, TILE - 3), cy = rf(rnd, 3, TILE - 3), r = rf(rnd, 1.3, 2.6);
    disc(ctx, ox, oy, cx, cy, r, node);
    ring(ctx, ox, oy, cx - 0.5, cy - 0.5, r, nodeEdge);
    ctx.fillStyle = gray(1.0);
    ctx.fillRect(ox + Math.round(cx - r * 0.4), oy + Math.round(cy - r * 0.5), 1, 1);
  }
}

function paintLamp(ctx, ox, oy, rnd) {
  fillTile(ctx, ox, oy, 1.0);
  ctx.fillStyle = gray(0.96);
  for (let i = 8; i < TILE; i += 8) {              // faint diffuser grid
    ctx.fillRect(ox + i, oy, 1, TILE);
    ctx.fillRect(ox, oy + i, TILE, 1);
  }
  ctx.strokeStyle = gray(0.93);
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 1.5, oy + 1.5, TILE - 3, TILE - 3);
  speckle(ctx, ox, oy, rnd, 30, 0.97, 1.0);
}

// ---------------------------------------------------------------------------
// Painter registry. `accent: true` means the tile varies with the block def's
// accent color, so tiles are cached per (painter, accent) instead of per
// painter — blocks sharing an accent still share a tile.
// ---------------------------------------------------------------------------
const PAINTERS = {
  generic:     { fn: paintGeneric },
  stone:       { fn: paintStone },
  bedrock:     { fn: paintBedrock },
  dirt:        { fn: paintDirt },
  grass_top:   { fn: paintGrassTop },
  grass_side:  { fn: paintGrassSide },
  sand:        { fn: paintSand },
  gravel:      { fn: paintGravel },
  ore:         { fn: paintOre, accent: true },
  log_top:     { fn: paintLogTop },
  log_side:    { fn: paintLogSide },
  plank:       { fn: paintPlank },
  timber:      { fn: paintTimber },
  leaves:      { fn: paintLeaves },
  brick:       { fn: (c, x, y, r) => paintBrick(c, x, y, r, false) },
  brick_heavy: { fn: (c, x, y, r) => paintBrick(c, x, y, r, true) },
  concrete:    { fn: paintConcrete },
  panel:       { fn: (c, x, y, r) => paintPanel(c, x, y, r, 1) },
  panel_floor: { fn: (c, x, y, r) => paintPanel(c, x, y, r, 2) },
  brushed:     { fn: paintBrushed },
  scrap:       { fn: paintScrap, accent: true },
  water:       { fn: paintWater },
  glass:       { fn: paintGlass },
  organic:     { fn: paintOrganic, accent: true },
  lamp:        { fn: paintLamp },
};

// Block id -> painter key per face. Anything absent falls back to `generic`
// (torches, wires, doors, archives and the rest are drawn as prop meshes by
// models.js, so their cube tile is never really seen).
const ALL = (k) => ({ top: k, side: k, bottom: k });

const FAMILIES = {
  [B.BEDROCK]:          ALL('bedrock'),
  [B.STONE]:            ALL('stone'),
  [B.DIRT]:             ALL('dirt'),
  [B.GRASS]:            { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  [B.SAND]:             ALL('sand'),
  [B.GRAVEL]:           ALL('gravel'),
  [B.LOG]:              { top: 'log_top', side: 'log_side', bottom: 'log_top' },
  [B.LEAVES]:           ALL('leaves'),
  [B.IRON_ORE]:         ALL('ore'),
  [B.COAL_ORE]:         ALL('ore'),
  [B.WATER]:            ALL('water'),
  [B.PLANK]:            ALL('plank'),
  [B.WOOD_WALL]:        { top: 'plank', side: 'timber', bottom: 'plank' },
  [B.STONE_BRICK]:      ALL('brick'),
  [B.IRON_BLOCK]:       ALL('brushed'),
  [B.STEEL_BLOCK]:      ALL('brushed'),
  [B.GLASS]:            ALL('glass'),
  [B.LAB_WALL]:         ALL('panel'),
  [B.LAB_FLOOR]:        { top: 'panel_floor', side: 'panel', bottom: 'panel_floor' },
  [B.LAB_LIGHT]:        ALL('lamp'),
  [B.LAMP]:             ALL('lamp'),
  [B.COLONY]:           ALL('organic'),
  [B.CYST]:             ALL('organic'),
  [B.NEST]:             ALL('organic'),
  [B.TRANSIT_HULL]:     ALL('panel'),
  [B.DEEP_WALL]:        ALL('panel'),
  [B.DEEP_FLOOR]:       { top: 'panel_floor', side: 'panel', bottom: 'panel_floor' },
  [B.DEEP_LIGHT]:       ALL('lamp'),
  [B.RESERVOIR_TISSUE]: ALL('organic'),
  [B.RUIN_WALL]:        ALL('concrete'),
  [B.RUIN_FLOOR]:       ALL('concrete'),
  [B.SCRAP]:            ALL('scrap'),
  [B.KILN]:             ALL('brick_heavy'),
};

function tileKey(name, def) {
  const p = PAINTERS[name];
  if (!p) return 'generic';
  if (!p.accent) return name;
  const a = def && def.accent;
  return `${name}:${a === undefined || a === null ? 'none' : a.toString(16)}`;
}

// ---------------------------------------------------------------------------
// Atlas construction (lazy, once).
// ---------------------------------------------------------------------------
let atlas = null;
let attempted = false;

function buildAtlas() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return null;

  // White background everywhere: unused slots multiply to 1, and the mip chain
  // (which inevitably blends whole neighborhoods of the atlas together at
  // distance) then converges on neutral instead of darkening the terrain.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);

  const rects = new Map();   // tileKey -> [u0, v0, u1, v1]
  let next = 0;

  const HALF_U = 0.5 / ATLAS_W;
  const HALF_V = 0.5 / ATLAS_H;

  function ensureTile(key, name, def) {
    const cached = rects.get(key);
    if (cached) return cached;
    if (next >= COLS * ROWS) return rects.get('generic');
    const slot = next++;
    const ox = (slot % COLS) * TILE;
    const oy = Math.floor(slot / COLS) * TILE;

    // Clip so no painter can ever spill into a neighboring tile.
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, TILE, TILE);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, oy, TILE, TILE);
    // Seeded on the tile key alone, so a tile looks identical no matter which
    // slot it lands in or what order the table is walked.
    const rnd = mulberry32(hashSeed('iw-atlas:' + key));
    (PAINTERS[name] || PAINTERS.generic).fn(ctx, ox, oy, rnd, def);
    ctx.restore();

    // CanvasTexture.flipY defaults to true, so the image rows are uploaded
    // bottom-up: v = 1 - canvasY / height. The tile's canvas TOP row therefore
    // maps to the LARGER v (v1) — which is what a side face wants, since v1 is
    // the top edge of the quad. Inset by half a texel on all four sides so
    // bilinear taps at the border never reach the neighboring tile.
    const rect = [
      ox / ATLAS_W + HALF_U,
      1 - (oy + TILE) / ATLAS_H + HALF_V,
      (ox + TILE) / ATLAS_W - HALF_U,
      1 - oy / ATLAS_H - HALF_V,
    ];
    rects.set(key, rect);
    return rect;
  }

  // Fallback first so it always owns slot 0.
  const genericRect = ensureTile('generic', 'generic', null);
  // Sorted ids: slot assignment (and therefore the atlas image) is stable.
  for (const id of Object.keys(FAMILIES).map(Number).sort((a, b) => a - b)) {
    const fam = FAMILIES[id];
    const def = BLOCKS[id];
    for (const face of ['top', 'side', 'bottom']) {
      const name = fam[face];
      ensureTile(tileKey(name, def), name, def);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.userData.shared = true; // singleton — disposeGroup must skip it
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return {
    texture,
    // face: 'top' | 'side' | 'bottom' -> [u0, v0, u1, v1], half-texel inset.
    // (u0, v0) is the min corner (left, BOTTOM of the face); (u1, v1) is the
    // max corner (right, TOP of the face).
    tileUV(blockId, face) {
      const fam = FAMILIES[blockId];
      if (!fam) return genericRect;
      const name = fam[face] || fam.side;
      return rects.get(tileKey(name, BLOCKS[blockId])) || genericRect;
    },
  };
}

/**
 * The block texture atlas, built on first call.
 * Returns null when there is no document (headless node tests import world.js,
 * which must not crash), otherwise the same singleton every time.
 */
export function getBlockAtlas() {
  if (atlas) return atlas;
  if (attempted) return null;
  attempted = true;
  try {
    atlas = buildAtlas();
  } catch {
    atlas = null;   // never let a texture problem take the game down
  }
  return atlas;
}
