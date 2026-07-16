// Inventory: stacking limits, overflow, counting, crafting (costs, block-id
// costs, tier gating), and tool durability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, itemDef } from '../src/inventory.js';
import { RECIPES, ITEMS } from '../src/config.js';
import { makeStubGame } from './helpers.js';

const recipe = (id) => RECIPES.find(r => r.id === id);

function rig(size = 30) {
  const game = makeStubGame();
  const inv = new Inventory(game, size);
  game.inv = inv;
  return { game, inv };
}

test('add() stacks up to the stack limit before opening new slots', () => {
  const { inv } = rig();
  assert.equal(inv.add('stone_shard', 250), 0); // stack 99
  const stacks = inv.slots.filter(Boolean);
  assert.deepEqual(stacks.map(s => s.n), [99, 99, 52]);
  assert.ok(stacks.every(s => s.id === 'stone_shard'));
  assert.equal(inv.count('stone_shard'), 250);
});

test('tools do not stack (stack: 1)', () => {
  const { inv } = rig();
  inv.add('stone_pick', 3);
  const stacks = inv.slots.filter(Boolean);
  assert.equal(stacks.length, 3);
  assert.ok(stacks.every(s => s.n === 1));
});

test('add() returns the overflow that did not fit', () => {
  const { inv } = rig(2); // two slots only
  const overflow = inv.add('coal', 250);
  assert.equal(overflow, 250 - 2 * 99);
  assert.equal(inv.count('coal'), 198);
  // a full inventory rejects everything
  assert.equal(inv.add('coal', 5), 5);
});

test('remove() takes across stacks and reports success', () => {
  const { inv } = rig();
  inv.add('stick', 120); // 99 + 21
  assert.equal(inv.remove('stick', 100), true);
  assert.equal(inv.count('stick'), 20);
  assert.equal(inv.remove('stick', 25), false, 'cannot remove more than held');
  assert.equal(inv.count('stick'), 0, 'failed remove still drains what it found');
  assert.ok(inv.slots.every(s => s === null));
});

test('craft() consumes costs and produces the output', () => {
  const { inv } = rig();
  const r = recipe('stone_pick'); // { stone_shard: 2, stick: 2 } -> stone_pick
  assert.equal(inv.craft(r), false, 'cannot craft with an empty inventory');
  inv.add('stone_shard', 2);
  inv.add('stick', 2);
  assert.equal(inv.craft(r), true);
  assert.equal(inv.count('stone_pick'), 1);
  assert.equal(inv.count('stone_shard'), 0);
  assert.equal(inv.count('stick'), 0);
});

test("craft() handles 'b:<id>' block costs and outputs", () => {
  const { inv } = rig();
  const r = recipe('plank'); // cost { 'b:7': 1 (log) } -> { 'b:12': 4 (planks) }
  inv.add('b:7', 1);
  assert.equal(inv.craft(r), true);
  assert.equal(inv.count('b:7'), 0);
  assert.equal(inv.count('b:12'), 4);
});

test('tierUnlock gates a recipe until the tier is reached', () => {
  const { game, inv } = rig();
  const r = recipe('iron_pick'); // tierUnlock: 'iron'
  inv.add('iron_ingot', 3);
  inv.add('stick', 2);
  assert.equal(inv.craft(r), false, 'recipe must be rejected before the iron tier');
  assert.equal(inv.count('iron_ingot'), 3, 'rejected craft must not consume materials');
  game.tiers.add('iron');
  assert.equal(inv.craft(r), true);
  assert.equal(inv.count('iron_pick'), 1);
  assert.equal(inv.count('iron_ingot'), 0);
});

test('craft() overflow drops at the player instead of vanishing', () => {
  const { game, inv } = rig(1); // single slot: the log occupies it, planks overflow
  const r = recipe('plank');
  inv.add('b:7', 2); // one log consumed, one keeps the only slot...
  // slot: {b:7 n:2} -> craft removes 1 -> {b:7 n:1}; 4 planks can't fit
  assert.equal(inv.craft(r), true);
  assert.equal(inv.count('b:12'), 0);
  assert.equal(game.dropped.length, 1);
  assert.deepEqual({ id: game.dropped[0].id, n: game.dropped[0].n }, { id: 'b:12', n: 4 });
});

test('useToolDurability wears and destroys the selected tool at 0', () => {
  const { inv } = rig();
  inv.add('stone_pick', 1); // dur 60
  inv.selected = 0;
  assert.equal(inv.useToolDurability(1), false);
  assert.equal(inv.slots[0].dur, ITEMS.stone_pick.dur - 1);
  assert.equal(inv.useToolDurability(ITEMS.stone_pick.dur - 1), true, 'tool breaks at 0');
  assert.equal(inv.slots[0], null, 'broken tool leaves the slot empty');
});

test('useToolDurability ignores non-tools and empty hands', () => {
  const { inv } = rig();
  assert.equal(inv.useToolDurability(), false); // empty hand
  inv.add('coal', 5);
  inv.selected = 0;
  assert.equal(inv.useToolDurability(), false); // not a tool
  assert.equal(inv.count('coal'), 5);
});

test('itemDef resolves both item keys and block ids', () => {
  const pick = itemDef('stone_pick');
  assert.equal(pick.tool, 'pick');
  const plank = itemDef('b:12');
  assert.equal(plank.block, 12);
  assert.equal(plank.name, 'Wood plank');
  assert.equal(itemDef('no_such_item'), null);
  assert.equal(itemDef(null), null);
});

test('serialize/load round-trips slots and selection', () => {
  const { inv } = rig();
  inv.add('stone_shard', 10);
  inv.add('stone_pick', 1);
  inv.selected = 1;
  const data = inv.serialize();
  const { inv: inv2 } = rig();
  inv2.load(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(inv2.slots.filter(Boolean), inv.slots.filter(Boolean));
  assert.equal(inv2.selected, 1);
});
