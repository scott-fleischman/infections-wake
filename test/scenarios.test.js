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

// The regression these two guard: placeStartRefuge grew the shack from 5x5 to
// 9x9 and scenarios.js kept its hard-coded 5x5 offsets, so "sealed" scenarios
// hung a door in the middle of the room and left the real doorway wide open.
// Both tests therefore derive everything from poi.spawn and assert the shape of
// the shack, never a copied literal.

test('fortified genuinely seals the shack — no gap left in the wall ring', () => {
  const game = makeScenarioGame('scn-door');
  applyScenario(game, 'fortified');
  const s = game.world.poi.spawn;
  const sx = Math.floor(s.x), sz = Math.floor(s.z), surf = s.y - 1;
  const x0 = sx - 4, z0 = sz - 4, x1 = sx + 4, z1 = sz + 4;

  // both columns of the 2-wide doorway carry a full-height door
  for (const dx of [0, 1]) {
    assert.equal(game.world.get(sx + dx, surf + 1, z0), B.DOOR, `door fills doorway column ${dx}`);
    assert.equal(game.world.get(sx + dx, surf + 2, z0), B.DOOR_TOP, `column ${dx} stands two cells tall`);
  }
  // the collapsed SE corner is timbered back up to the wall top
  assert.equal(game.world.get(x1, surf + 4, z1), B.WOOD_WALL, 'collapsed corner repaired to full height');

  // The whole invariant: after sealing, the only air left in the wall ring is
  // the west window slot worldgen deliberately carves at (x0, surf+2, sz-1..+1).
  const leaks = [];
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      if (!(x === x0 || x === x1 || z === z0 || z === z1)) continue;   // interior
      for (let y = surf + 1; y <= surf + 4; y++) {
        if (game.world.get(x, y, z) !== B.AIR) continue;
        const isWindow = x === x0 && y === surf + 2 && Math.abs(z - sz) <= 1;
        if (!isWindow) leaks.push(`(${x - sx},${y - surf},${z - sz})`);
      }
    }
  assert.deepEqual(leaks, [], `wall ring still open at ${leaks.join(' ')}`);
  assert.ok(game.unlocks.doorHung, 'door objective satisfied');
});

test('powered scenario wires a generator network outside the shack', () => {
  const game = makeScenarioGame('scn-power');
  applyScenario(game, 'powered');
  const s = game.world.poi.spawn;
  const sx = Math.floor(s.x), sz = Math.floor(s.z);
  const ids = game.placed.map(p => p.id);
  const spine = new Set([B.GENERATOR, B.WIRE, B.LAMP, B.TURRET, B.BEACON]);
  for (const want of spine) assert.ok(ids.includes(want), `placed block ${want}`);
  // "outside the shack" is the point of the scenario, not decoration: a turret
  // behind timber never clears power.js's wallAtten gate, so it cannot fire on
  // anything it is supposed to be guarding. The wall ring sits at sx/sz ± 4.
  for (const p of game.placed) {
    if (!spine.has(p.id)) continue;
    const cheb = Math.max(Math.abs(p.x - sx), Math.abs(p.z - sz));
    assert.ok(cheb > 4, `${BLOCKS[p.id].name} at (${p.x - sx},${p.z - sz}) is inside the shack`);
  }
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
