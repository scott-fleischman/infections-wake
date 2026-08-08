// Progression: no tool tier may be gated behind itself.
//
// The bug this guards against is easy to reintroduce and impossible to notice
// from inside a single block definition: iron ore once carried `toolMin: 1`,
// but the iron pickaxe is bought with iron ingots smelted from that same ore,
// so the only way into the iron tier was salvaging random scrap in a ruin ~110
// blocks from spawn — and roughly one seed in ten never yielded the 3 ingots.
// Instead of asserting "IRON_ORE has no toolMin" (which just restates config),
// these tests walk the recipe graph down to the blocks it bottoms out in and
// check each tier is reachable with the tools of the tier below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, ITEMS, BLOCKS, B, canHarvestBlock } from '../src/config.js';

// Every item a recipe output depends on, transitively. Costs that name a block
// (`b:<id>`) or a leaf gathered in the world simply have no producing recipe
// and terminate the walk.
function chainInputs(rootItem) {
  const seen = new Set(), queue = [rootItem];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const r = RECIPES.find(r => r.out?.[id] != null);
    if (r) queue.push(...Object.keys(r.cost || {}));
  }
  seen.delete(rootItem);
  return [...seen];
}

// Where an item comes out of the ground: the ore it mirrors (`blockLike`) plus
// any never-depleting lode that yields it.
function blockSources(itemId) {
  const out = [];
  const like = ITEMS[itemId]?.blockLike;
  if (like != null) out.push(like);
  for (const [id, def] of Object.entries(BLOCKS)) if (def.lode === itemId) out.push(Number(id));
  return out;
}

// Harvestable by someone who has not yet reached tier `n` — bare hands, or any
// tool below that tier.
const reachableBelowTier = (blockId, n) =>
  canHarvestBlock(BLOCKS[blockId], null) ||
  Object.values(ITEMS).some(t => t.tool && t.tier < n && canHarvestBlock(BLOCKS[blockId], t));

const TOOLS = Object.entries(ITEMS).filter(([, d]) => d.tool && d.tier > 0);

test('every tool tier is reachable with the tools of the tier below it', () => {
  assert.ok(TOOLS.length >= 4, 'expected iron and steel tools to exist');
  for (const [itemId, def] of TOOLS) {
    for (const input of chainInputs(itemId)) {
      const sources = blockSources(input);
      if (!sources.length) continue; // crafted or gathered without a tool gate
      assert.ok(
        sources.some(b => reachableBelowTier(b, def.tier)),
        `${itemId} (tier ${def.tier}) needs "${input}", but every block that ` +
        `yields it requires a tier-${def.tier} tool — that tier gates itself`);
    }
  }
});

test('raw iron ore yields to a stone pickaxe, the iron lode does not', () => {
  const ore = BLOCKS[B.IRON_ORE], lode = BLOCKS[B.IRON_LODE];
  assert.equal(canHarvestBlock(ore, ITEMS.stone_pick), true, 'iron ore must bootstrap the tier');
  assert.equal(canHarvestBlock(ore, null), true, 'bare hands must work too, slowly');
  // the lode is what the iron pick buys — keep it behind the gate
  assert.equal(canHarvestBlock(lode, ITEMS.stone_pick), false);
  assert.equal(canHarvestBlock(lode, ITEMS.iron_pick), true);
  assert.equal(canHarvestBlock(lode, ITEMS.steel_pick), true, 'higher tiers still qualify');
});

test('mining iron ore with a stone pick stays a speed bump, not a wall', () => {
  // updateMining: time = hardness / speed, and a stone pick is the best a
  // pre-iron player has. Keep the whole trip to 3 ingots bearable for a kid.
  const seconds = BLOCKS[B.IRON_ORE].hardness / ITEMS.stone_pick.speed;
  assert.ok(seconds < 4, `iron ore takes ${seconds.toFixed(1)}s with a stone pick`);
  assert.ok(seconds > BLOCKS[B.IRON_ORE].hardness / ITEMS.iron_pick.speed,
    'the iron pick must still be a real upgrade');
});

test('canHarvestBlock gates on tool kind as well as tier', () => {
  const lode = BLOCKS[B.IRON_LODE];
  assert.equal(canHarvestBlock(lode, ITEMS.iron_axe), false, 'right tier, wrong kind');
  assert.equal(canHarvestBlock(lode, ITEMS.stone_axe), false);
  assert.equal(canHarvestBlock(BLOCKS[B.STONE], ITEMS.iron_axe), true, 'ungated blocks ignore the tool');
  assert.equal(canHarvestBlock(BLOCKS[B.DIRT], null), true);
  assert.equal(canHarvestBlock(undefined, ITEMS.iron_pick), true, 'unknown block must not throw');
});
