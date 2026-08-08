import { RECIPES } from './config.js';

// ============================================================================
// Grid crafting (wishlist #8) — pure, headless-testable matching engine.
//
// A recipe's `grid` (config.js) is rows of cells; a cell is null or {id, n}.
// The player's craft grid is a flat array of 9 slots (row-major 3x3) holding
// {id, n} stacks. Matching is translation-invariant (patterns are compared
// after trimming empty border rows/cols) but not rotated or mirrored — the
// handbook shows the exact shape that works.
//
// A placed cell matches a pattern cell when the ids are equal and the placed
// stack holds AT LEAST the pattern count; crafting consumes exactly the
// pattern count per cell. Stacks bigger than needed stay put, so repeated
// output clicks craft repeatedly.
// ============================================================================

// 3x3 flat cells → { h, w, cells: [[{id,n}|null]] } trimmed to bounding box,
// or null when the grid is empty.
export function normalizeCells(cells) {
  const rows = [[], [], []];
  for (let i = 0; i < 9; i++) {
    const c = cells[i];
    rows[Math.floor(i / 3)][i % 3] = (c && c.n > 0) ? c : null;
  }
  return trim(rows);
}

// Recipe grid (1–3 rows of 1–3 cells, short rows allowed) → same trimmed form.
export function normalizeGrid(grid) {
  const rows = [[], [], []];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) rows[r][c] = (grid[r] && grid[r][c] && grid[r][c].n > 0) ? grid[r][c] : null;
  return trim(rows);
}

function trim(rows) {
  let r0 = 3, r1 = -1, c0 = 3, c1 = -1;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (rows[r][c]) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
  if (r1 < 0) return null;
  const cells = [];
  for (let r = r0; r <= r1; r++) {
    const row = [];
    for (let c = c0; c <= c1; c++) row.push(rows[r][c]);
    cells.push(row);
  }
  return { h: r1 - r0 + 1, w: c1 - c0 + 1, r0, c0, cells };
}

// Does the recipe pass its station/tier/research gates in this context?
export function recipeAvailable(r, ctx = {}) {
  if (r.smelt) return false;                       // furnace/kiln panels own smelting
  if (r.station === 'bench' && !ctx.nearBench) return false;
  if (r.tierUnlock && !(ctx.tiers?.has?.(r.tierUnlock))) return false;
  if (r.needsUnlock && !ctx.unlocks?.[r.needsUnlock]) return false;
  return true;
}

// Match the placed 3x3 against every gridded recipe. Returns
// { recipe, placed } where placed is the trimmed player pattern, or null.
export function matchGrid(cells, ctx = {}) {
  const placed = normalizeCells(cells);
  if (!placed) return null;
  for (const r of RECIPES) {
    if (!r.grid || !recipeAvailable(r, ctx)) continue;
    const want = normalizeGrid(r.grid);
    if (!want || want.h !== placed.h || want.w !== placed.w) continue;
    let ok = true;
    for (let i = 0; i < want.h && ok; i++)
      for (let j = 0; j < want.w && ok; j++) {
        const w = want.cells[i][j], p = placed.cells[i][j];
        if (!w !== !p) ok = false;
        else if (w && (p.id !== w.id || p.n < w.n)) ok = false;
      }
    if (ok) return { recipe: r, placed };
  }
  return null;
}

// Consume one craft's worth from the placed 3x3 (mutates `cells` in place).
// Assumes matchGrid(cells) just returned this recipe.
export function consumeGrid(cells, recipe) {
  const placed = normalizeCells(cells);
  const want = normalizeGrid(recipe.grid);
  if (!placed || !want) return false;
  for (let i = 0; i < want.h; i++)
    for (let j = 0; j < want.w; j++) {
      const w = want.cells[i][j];
      if (!w) continue;
      const idx = (placed.r0 + i) * 3 + (placed.c0 + j);
      const p = cells[idx];
      if (!p || p.id !== w.id || p.n < w.n) return false; // desync guard
      p.n -= w.n;
      if (p.n <= 0) cells[idx] = null;
    }
  return true;
}
