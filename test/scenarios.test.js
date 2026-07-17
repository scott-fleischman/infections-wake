import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { B, BLOCKS, ITEMS, TIME } from '../src/config.js';
import { SCENARIOS, applyScenario } from '../src/scenarios.js';
import { makeStubGame } from './helpers.js';

// Run each scenario against a REAL generated world and a recording stub game.
// This validates the whole contract: item ids exist, blocks land in air on
// real terrain, and teleport destinations are standable.

function makeScenarioGame(seed) {
  const world = new World(seed);
  world.generate();
  const game = makeStubGame({ world });
  game.unlocks = { sigPanel: false, sigAll: false };
  game.valleyFlags = new Set();
  game.hintStage = 0;
  game.addValley = (f) => game.valleyFlags.add(f);
  game.placed = [];
  game.placeBlock = (x, y, z, id) => { world.set(x, y, z, id); game.placed.push({ x, y, z, id }); };
  game.inv = { added: [], add(id, n) { this.added.push({ id, n }); return 0; } };
  game.machines = { map: new Map(), get: () => null };
  game.hud.updateHotbar = () => {};
  // full-game campaign state the late scenarios drive (matches main.js defaults)
  game.bossState = { kiln: {}, pump: {} };
  game.transit = { restored: false, siegeActive: false };
  game.deep = { valves: [false, false, false], heatFailed: false, flooded: false, purged: false };
  game.sig.onBlockChanged = () => {};
  return game;
}

const validItemId = (id) =>
  ITEMS[id] != null || (id.startsWith('b:') && BLOCKS[Number(id.slice(2))] != null);

for (const [key, sc] of Object.entries(SCENARIOS)) {
  test(`scenario "${key}" applies cleanly on real terrain`, () => {
    assert.ok(sc.name && sc.desc && typeof sc.apply === 'function');
    const game = makeScenarioGame('scn-' + key);
    assert.ok(applyScenario(game, key), 'applyScenario returns true');

    for (const { id } of game.inv.added) assert.ok(validItemId(id), `unknown item id ${id}`);
    for (const { id } of game.placed) assert.ok(BLOCKS[id], `unknown block id ${id}`);

    // time lands inside the world clock's range, day agrees, hints are muted
    assert.ok(game.t > 0 && game.t < TIME.DAY_LENGTH * 10, `sane time ${game.t}`);
    assert.equal(game.day, Math.floor(game.t / TIME.DAY_LENGTH) + 1, 'day matches t');
    assert.equal(game.hintStage, 3);

    // nothing may occupy the emergency recovery pad cell — respawn depends on it
    const e = game.world.poi.emergency;
    assert.equal(game.world.get(e.x, e.y, e.z), B.AIR, 'emergency pad cell stays clear');
    assert.equal(game.world.get(e.x, e.y + 1, e.z), B.AIR, 'emergency pad headroom stays clear');
  });
}

test('unknown scenario key is rejected', () => {
  const game = makeScenarioGame('scn-none');
  assert.equal(applyScenario(game, 'nope'), false);
});

test('fortified hangs a real door in the shack doorway', () => {
  const game = makeScenarioGame('scn-door');
  applyScenario(game, 'fortified');
  const s = game.world.poi.spawn;
  const sx = Math.floor(s.x), surf = s.y - 1, z0 = Math.floor(s.z) - 2;
  assert.equal(game.world.get(sx, surf + 1, z0), B.DOOR, 'door fills the doorway');
  assert.ok(game.unlocks.doorHung, 'door objective satisfied');
});

test('powered scenario wires a generator network outside the shack', () => {
  const game = makeScenarioGame('scn-power');
  applyScenario(game, 'powered');
  const ids = game.placed.map(p => p.id);
  for (const want of [B.GENERATOR, B.WIRE, B.LAMP, B.TURRET, B.BEACON])
    assert.ok(ids.includes(want), `placed block ${want}`);
  assert.ok(game.unlocks.genRan, 'generator objective pre-satisfied');
});

test('lab scenario teleports inside the lab volume', () => {
  const game = makeScenarioGame('scn-lab');
  applyScenario(game, 'lab');
  const L = game.world.poi.lab;
  const p = game.player.pos;
  assert.ok(Math.abs(p.x - (L.x + 0.5)) < 0.01 && Math.abs(p.z - (L.z + 0.5)) < 0.01);
  const feet = game.world.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const head = game.world.get(Math.floor(p.x), Math.floor(p.y) + 1, Math.floor(p.z));
  assert.equal(feet, B.AIR, 'feet in air');
  assert.equal(head, B.AIR, 'head in air');
});

test('deepsite scenario drops the player standing in the entry hall with the rail open', () => {
  const game = makeScenarioGame('scn-deep');
  applyScenario(game, 'deepsite');
  assert.equal(game.transit.restored, true, 'rail is open');
  const d = game.world.poi.deep;
  const p = game.player.pos;
  assert.ok(Math.abs(p.x - (d.entry.x + 0.5)) < 0.01 && Math.abs(p.z - (d.entry.z + 0.5)) < 0.01);
  assert.equal(game.world.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), B.AIR, 'feet in air');
  assert.equal(game.world.get(Math.floor(p.x), Math.floor(p.y) + 1, Math.floor(p.z)), B.AIR, 'head in air');
});

test('endgame scenario arrives purged: valves open, tissue gone, pressure flags set', () => {
  const game = makeScenarioGame('scn-end');
  applyScenario(game, 'endgame');
  assert.deepEqual(game.deep.valves, [true, true, true]);
  assert.equal(game.deep.purged, true);
  assert.equal(game.deep.tissueLeft, 0);
  for (const c of game.world.poi.deep.clusters)
    for (const [x, y, z] of c.cells)
      assert.equal(game.world.get(x, y, z), B.AIR, 'vault tissue burned out');
  assert.ok(game.valleyFlags.has('deepPurged') && game.valleyFlags.has('transitRestored'));
});

test('boss scenario finds a standable pocket near the colony', () => {
  const game = makeScenarioGame('scn-boss');
  applyScenario(game, 'boss');
  const c = game.world.poi.colony;
  const p = game.player.pos;
  const dist = Math.max(Math.abs(p.x - c.x), Math.abs(p.z - c.z));
  assert.ok(dist >= 6 && dist <= 16, `outside the chamber but near the colony (${dist.toFixed(1)} cells)`);
  const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
  assert.equal(game.world.get(fx, fy, fz), B.AIR, 'feet in air');
  assert.equal(game.world.get(fx, fy + 1, fz), B.AIR, 'head in air');
  assert.notEqual(game.world.get(fx, fy - 1, fz), B.AIR, 'ground below');
});
