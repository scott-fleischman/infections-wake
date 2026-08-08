// Grid crafting engine (wishlist #7/#8): pure matcher + inventory click-move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES } from '../src/config.js';
import { normalizeCells, normalizeGrid, matchGrid, consumeGrid, recipeAvailable } from '../src/crafting.js';
import { Inventory } from '../src/inventory.js';

const stubGame = { tiers: new Set(), unlocks: {}, toast() {}, dropItemAt() {} };

// place a recipe's trimmed pattern into a flat 3x3 at a row/col offset,
// multiplying counts by `mult`
function placeAt(recipe, r0, c0, mult = 1) {
  const cells = new Array(9).fill(null);
  recipe.grid.forEach((row, i) => (row || []).forEach((cell, j) => {
    if (cell) cells[(r0 + i) * 3 + (c0 + j)] = { id: cell.id, n: cell.n * mult };
  }));
  return cells;
}

const ctxAll = { nearBench: true, tiers: new Set(['iron', 'steel']), unlocks: { filtration: true } };
const gridded = RECIPES.filter(r => r.grid);

test('every gridded recipe matches its own pattern (and translated copies)', () => {
  assert.ok(gridded.length > 30, `grids are authored (${gridded.length} found)`);
  for (const r of gridded) {
    const want = normalizeGrid(r.grid);
    for (const [r0, c0] of [[0, 0], [3 - want.h, 3 - want.w]]) {
      const m = matchGrid(placeAt(r, r0, c0), ctxAll);
      assert.ok(m, `${r.id} matches at offset ${r0},${c0}`);
      // identical patterns may legitimately resolve to an earlier recipe;
      // what must hold is that the matched pattern is the same shape
      assert.deepEqual(normalizeGrid(m.recipe.grid).cells, want.cells,
        `${r.id} at ${r0},${c0} resolved to an identical pattern`);
    }
  }
});

test('oversized stacks in cells still match; crafting consumes only the pattern count', () => {
  const pick = RECIPES.find(r => r.id === 'stone_pick');
  const cells = placeAt(pick, 0, 0, 3); // triple quantities
  const m = matchGrid(cells, ctxAll);
  assert.equal(m.recipe.id, 'stone_pick');
  assert.ok(consumeGrid(cells, m.recipe));
  // one craft's worth consumed — two more crafts remain in the grid
  const m2 = matchGrid(cells, ctxAll);
  assert.equal(m2?.recipe.id, 'stone_pick', 'remainder still matches');
  let total = 0;
  for (const c of cells) if (c) total += c.n;
  const costTotal = Object.values(pick.cost).reduce((a, b) => a + b, 0);
  assert.equal(total, costTotal * 2, 'exactly one craft consumed');
});

test('bench recipes refuse to match away from a bench; tiers and research gate too', () => {
  const door = RECIPES.find(r => r.id === 'door');
  assert.equal(matchGrid(placeAt(door, 0, 0), { ...ctxAll, nearBench: false }), null);
  assert.equal(matchGrid(placeAt(door, 0, 0), ctxAll)?.recipe.id, 'door');

  const steel = RECIPES.find(r => r.id === 'steel_pick');
  assert.equal(matchGrid(placeAt(steel, 0, 0), { ...ctxAll, tiers: new Set(['iron']) }), null, 'steel tier gated');
  const scrub = RECIPES.find(r => r.id === 'scrubber');
  if (scrub?.grid) {
    assert.equal(matchGrid(placeAt(scrub, 0, 0), { ...ctxAll, unlocks: {} }), null, 'research gated');
  }
});

test('empty and wrong grids match nothing', () => {
  assert.equal(matchGrid(new Array(9).fill(null), ctxAll), null);
  assert.equal(normalizeCells(new Array(9).fill(null)), null);
  // a lone item that is no single-cell recipe's whole pattern
  const cells = new Array(9).fill(null);
  cells[4] = { id: 'turret_ammo', n: 1 };
  assert.equal(matchGrid(cells, ctxAll), null);
});

test('smelt recipes never participate in grid matching', () => {
  for (const r of RECIPES.filter(r => r.smelt)) {
    assert.equal(recipeAvailable(r, ctxAll), false, `${r.id} stays on its machine panel`);
  }
});

// ---------------- click-move (wishlist #7) ----------------

test('moveSlot: move to empty, merge with remainder, swap, self no-op', () => {
  const inv = new Inventory(stubGame);
  inv.slots[0] = { id: 'stick', n: 10 };
  inv.moveSlot(0, 8);
  assert.equal(inv.slots[0], null);
  assert.deepEqual(inv.slots[8], { id: 'stick', n: 10 });

  inv.slots[0] = { id: 'stick', n: 95 };
  inv.moveSlot(8, 0); // merge 10 into 95, capped at 99
  assert.deepEqual(inv.slots[0], { id: 'stick', n: 99 });
  assert.deepEqual(inv.slots[8], { id: 'stick', n: 6 }, 'remainder stays at source');

  inv.slots[1] = { id: 'coal', n: 3 };
  inv.moveSlot(1, 0); // different ids swap
  assert.equal(inv.slots[0].id, 'coal');
  assert.equal(inv.slots[1].id, 'stick');

  const before = JSON.stringify(inv.slots);
  inv.moveSlot(3, 3);
  assert.equal(JSON.stringify(inv.slots), before, 'self-move is a no-op');
});

test('moveSlot preserves tool durability and never merges tools', () => {
  const inv = new Inventory(stubGame);
  inv.slots[0] = { id: 'iron_pick', n: 1, dur: 37 };
  inv.slots[1] = { id: 'iron_pick', n: 1, dur: 200 };
  inv.moveSlot(0, 1); // same id but dur-carrying: must swap, not merge
  assert.equal(inv.slots[0].dur, 200);
  assert.equal(inv.slots[1].dur, 37);
  inv.moveSlot(1, 5);
  assert.equal(inv.slots[5].dur, 37, 'durability rides along on a move');
});
