// Death & staged recovery ladder (§13): cradle → beacon → one-time emergency
// → run failure. Power/charges must be valid at the moment of death.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Recovery } from '../src/recovery.js';
import { RECOVERY } from '../src/config.js';
import { makeStubGame } from './helpers.js';

function rig({ hardcore = false } = {}) {
  const game = makeStubGame({
    world: { poi: { emergency: { x: 36, y: 25, z: 36 } } },
    inv: { slots: new Array(10).fill(null), add: () => 0 },
  });
  game.player.pos = new THREE.Vector3(50.2, 21, 50.7);
  const recovery = new Recovery(game, hardcore);
  game.recovery = recovery;
  return { game, recovery };
}

function addMachine(game, m) {
  game.machines.map.set(`${m.x},${m.y},${m.z}`, m);
  return m;
}

const beaconStub = (over = {}) => ({
  type: 'beacon', x: 10, y: 21, z: 10,
  registered: true, running: true, charges: 1, ...over,
});

test('no options: resolve() returns null (run failure)', () => {
  const { recovery } = rig();
  recovery.emergencyUses = 0;
  assert.equal(recovery.bestOption(), null);
  assert.equal(recovery.resolve(), null);
});

test('registered + running beacon with charges is chosen and decrements', () => {
  const { game, recovery } = rig();
  const beacon = addMachine(game, beaconStub({ charges: 2 }));
  const opt = recovery.bestOption();
  assert.equal(opt.kind, 'beacon');
  const res = recovery.resolve();
  assert.equal(res.kind, 'beacon');
  assert.equal(beacon.charges, 1, 'resolve must consume one charge');
  assert.deepEqual(res.respawn, { x: beacon.x + 0.5, y: beacon.y + 1, z: beacon.z + 1.5 });
});

test('beacon unpowered at the moment of death is skipped', () => {
  const { game, recovery } = rig();
  addMachine(game, beaconStub({ running: false }));
  const opt = recovery.bestOption();
  assert.equal(opt.kind, 'emergency', 'ladder must fall through to the emergency pad');
});

test('beacon with zero charges is skipped', () => {
  const { game, recovery } = rig();
  addMachine(game, beaconStub({ charges: 0 }));
  assert.equal(recovery.bestOption().kind, 'emergency');
});

test('unregistered beacon is skipped', () => {
  const { game, recovery } = rig();
  addMachine(game, beaconStub({ registered: false }));
  assert.equal(recovery.bestOption().kind, 'emergency');
});

test('powered cradle with a core outranks a valid beacon', () => {
  const { game, recovery } = rig();
  addMachine(game, beaconStub());
  addMachine(game, { type: 'cradle', x: 20, y: 21, z: 20, core: true, running: true });
  assert.equal(recovery.bestOption().kind, 'cradle');
});

test('emergency pad works once, then is exhausted', () => {
  const { game, recovery } = rig();
  assert.equal(recovery.emergencyUses, RECOVERY.emergencyUses);
  const res = recovery.resolve();
  assert.equal(res.kind, 'emergency');
  const e = game.world.poi.emergency;
  assert.deepEqual(res.respawn, { x: e.x + 0.5, y: e.y, z: e.z + 0.5 });
  assert.equal(recovery.emergencyUses, 0);
  assert.equal(recovery.resolve(), null, 'second death has no recovery left');
});

test('hardcore starts with zero emergency uses', () => {
  const { recovery } = rig({ hardcore: true });
  assert.equal(recovery.emergencyUses, 0);
  assert.equal(recovery.bestOption(), null);
});

test('dropGrave empties the inventory into a grave at the death position', () => {
  const { game, recovery } = rig();
  game.inv.slots[0] = { id: 'stone_pick', n: 1, dur: 42 };
  game.inv.slots[3] = { id: 'b:12', n: 30 };
  recovery.dropGrave(game.player.pos.clone());

  assert.ok(game.inv.slots.every(s => s === null), 'inventory must be emptied');
  assert.equal(recovery.graves.length, 1);
  const grave = recovery.graves[0];
  assert.equal(grave.x, 50);
  assert.equal(grave.y, 21);
  assert.equal(grave.z, 50);
  assert.deepEqual(
    grave.items.map(i => ({ id: i.id, n: i.n })),
    [{ id: 'stone_pick', n: 1 }, { id: 'b:12', n: 30 }],
  );
  assert.equal(grave.items[0].dur, 42, 'tool durability rides along');
  assert.ok(grave.mesh, 'grave mesh created via game.scene stub');
});

test('empty inventory leaves no grave', () => {
  const { recovery } = rig();
  recovery.dropGrave(new THREE.Vector3(1, 2, 3));
  assert.equal(recovery.graves.length, 0);
});

test('serialize/load round-trips uses and grave contents', () => {
  const { game, recovery } = rig();
  game.inv.slots[0] = { id: 'coal', n: 7 };
  recovery.resolve(); // emergency use + grave drop
  const data = recovery.serialize();

  const { recovery: r2 } = rig();
  r2.load(data);
  assert.equal(r2.emergencyUses, 0);
  assert.equal(r2.hardcore, false);
  assert.equal(r2.graves.length, 1);
  assert.deepEqual(r2.graves[0].items, [{ id: 'coal', n: 7 }]);
});
