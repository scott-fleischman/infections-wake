// Crafting grids: every non-smelt recipe carries a hand-authored 3x3 pattern
// whose per-id totals are exactly its cost. These are data invariants — a
// mistyped cell would otherwise surface as an uncraftable recipe in game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES } from '../src/config.js';
import { itemDef } from '../src/inventory.js';

const MAX = 3;

// Grids are stored ragged (short rows imply trailing nulls).
const cellAt = (grid, r, c) => (grid[r] && grid[r][c]) || null;
const width = (grid) => Math.max(...grid.map(row => row.length));

function filledCells(grid) {
  const out = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < width(grid); c++) {
      const cell = cellAt(grid, r, c);
      if (cell) out.push({ r, c, cell });
    }
  }
  return out;
}

// Sum `n` per id across the whole pattern.
function tally(grid) {
  const sums = {};
  for (const { cell } of filledCells(grid)) sums[cell.id] = (sums[cell.id] || 0) + cell.n;
  return sums;
}

// itemDef throws on a 'b:<id>' referencing a block that does not exist.
function resolves(id) {
  try { return itemDef(id) != null; } catch { return false; }
}

const withGrid = RECIPES.filter(r => !r.smelt);

test('non-smelt recipes declare a grid; smelt recipes do not', () => {
  for (const r of RECIPES) {
    if (r.smelt) {
      assert.equal(r.grid, undefined, `smelt recipe ${r.id} must not have a grid`);
    } else {
      assert.ok(Array.isArray(r.grid), `recipe ${r.id} is missing its grid`);
    }
  }
  assert.ok(withGrid.length > 0, 'expected at least one grid recipe');
});

test('grids are at most 3 rows of at most 3 cells', () => {
  for (const r of withGrid) {
    assert.ok(r.grid.length >= 1 && r.grid.length <= MAX, `${r.id}: ${r.grid.length} rows`);
    for (const row of r.grid) {
      assert.ok(Array.isArray(row), `${r.id}: every row must be an array`);
      assert.ok(row.length >= 1 && row.length <= MAX, `${r.id}: row of ${row.length} cells`);
    }
  }
});

test('every cell is null or a { id, n } with a positive integer count', () => {
  for (const r of withGrid) {
    for (const row of r.grid) {
      for (const cell of row) {
        if (cell === null) continue;
        assert.equal(typeof cell, 'object', `${r.id}: cell must be null or an object`);
        assert.equal(typeof cell.id, 'string', `${r.id}: cell id must be a string`);
        assert.ok(Number.isInteger(cell.n) && cell.n >= 1, `${r.id}: bad cell count for ${cell.id}`);
      }
    }
  }
});

test('grids hold at least one item and are trimmed to their bounding box', () => {
  for (const r of withGrid) {
    const filled = filledCells(r.grid);
    assert.ok(filled.length > 0, `${r.id}: grid is empty`);
    const w = width(r.grid);
    const rows = r.grid.length;
    // boundary rows and columns must carry something — patterns are stored
    // trimmed because the matcher is translation-invariant.
    assert.ok(filled.some(f => f.r === 0), `${r.id}: leading row is all null`);
    assert.ok(filled.some(f => f.r === rows - 1), `${r.id}: trailing row is all null`);
    assert.ok(filled.some(f => f.c === 0), `${r.id}: leading column is all null`);
    assert.ok(filled.some(f => f.c === w - 1), `${r.id}: trailing column is all null`);
  }
});

test('every grid cell id resolves to a real item or block', () => {
  for (const r of withGrid) {
    for (const { cell } of filledCells(r.grid)) {
      assert.ok(resolves(cell.id), `${r.id}: grid cell id "${cell.id}" does not resolve`);
    }
  }
});

test('grid cell totals equal the recipe cost exactly', () => {
  for (const r of withGrid) {
    const sums = tally(r.grid);
    for (const [id, n] of Object.entries(r.cost)) {
      assert.equal(sums[id], n, `${r.id}: grid holds ${sums[id] ?? 0} of "${id}", cost wants ${n}`);
    }
    for (const id of Object.keys(sums)) {
      assert.ok(id in r.cost, `${r.id}: grid holds "${id}", which is not in the cost`);
    }
    assert.deepEqual(Object.keys(sums).sort(), Object.keys(r.cost).sort(), `${r.id}: cost/grid id mismatch`);
  }
});

test('every recipe output id resolves to a real item or block', () => {
  for (const r of RECIPES) {
    const outs = Object.keys(r.out);
    assert.ok(outs.length > 0, `${r.id}: no output`);
    for (const id of outs) assert.ok(resolves(id), `${r.id}: output id "${id}" does not resolve`);
  }
});

test('no two recipes share the same pattern of ids', () => {
  // Same-cost pairs (pick/axe, drill/turret, bricks/slugs) must be told apart
  // by shape alone, so the layout of ids — ignoring counts — has to be unique.
  const seen = new Map();
  for (const r of withGrid) {
    const key = filledCells(r.grid).map(f => `${f.r},${f.c}:${f.cell.id}`).join('|');
    assert.equal(seen.get(key), undefined, `${r.id} has the same pattern as ${seen.get(key)}`);
    seen.set(key, r.id);
  }
});
