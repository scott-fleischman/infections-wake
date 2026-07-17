// Steel-tier power behavior (§10.1–10.2): switches gate conductors, batteries
// buffer and bridge, sustained overload blows fuses, player priorities beat
// type defaults, and the drill stops when full. Real Machines + real World.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machines } from '../src/power.js';
import { B, MACHINES, FUSE } from '../src/config.js';
import { makeStubGame, makeEmptyWorld, buildFloor } from './helpers.js';

function rig() {
  const world = makeEmptyWorld();
  const game = makeStubGame({ world });
  const machines = new Machines(game);
  game.machines = machines;
  game.blockHp = new Map();
  return { world, game, machines };
}

function place(world, machines, x, y, z, blockId) {
  world.set(x, y, z, blockId);
  return machines.add(x, y, z, blockId);
}

test('a closed switch conducts; opening it cuts the branch', () => {
  const { world, machines } = rig();
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  gen.fuel = 10;
  world.set(11, 2, 10, B.WIRE);
  const sw = place(world, machines, 12, 2, 10, B.SWITCH);
  world.set(13, 2, 10, B.WIRE);
  const lamp = place(world, machines, 14, 2, 10, B.LAMP);
  machines.solvePower();
  assert.equal(lamp.powered, true, 'closed switch conducts');
  sw.on = false;
  machines.solvePower();
  assert.equal(!!lamp.powered, false, 'open switch cuts the run');
});

test('a battery charges from surplus and bridges a generator outage', () => {
  const { world, machines } = rig();
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  gen.fuel = 100;
  world.set(11, 2, 10, B.WIRE);
  const bat = place(world, machines, 12, 2, 10, B.BATTERY);
  world.set(13, 2, 10, B.WIRE);
  const lamp = place(world, machines, 14, 2, 10, B.LAMP);
  // charge for 10 seconds of frames
  for (let i = 0; i < 100; i++) machines.solvePower(0.1);
  assert.ok(bat.charge > 20, `battery charged from surplus (${bat.charge.toFixed(1)})`);
  // generator dies; the lamp should ride the battery
  gen.fuel = 0;
  machines.solvePower(0.1);
  assert.equal(lamp.powered, true, 'battery bridges the outage');
  assert.equal(lamp.onBattery, true);
  // and the battery actually drains
  const c0 = bat.charge;
  for (let i = 0; i < 20; i++) machines.solvePower(0.1);
  assert.ok(bat.charge < c0, 'discharging while bridging');
});

test('sustained overload with unserved demand blows the fuse; replaceFuse restores', () => {
  const { world, game, machines } = rig();
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  gen.fuel = 100;
  // machines do not conduct — every drill must touch the wire spine itself
  for (let x = 11; x <= 20; x++) world.set(x, 2, 11, B.WIRE);
  world.set(10, 2, 11, B.WIRE); // spine touches the generator
  for (let i = 0; i < 5; i++) place(world, machines, 12 + i * 2, 2, 10, B.DRILL);
  // demand 20kW vs 12kW capacity → ratio 1.67 > 1.25 with unserved consumers
  for (let i = 0; i < Math.ceil((FUSE.overloadSeconds + 1) / 0.25); i++) machines.solvePower(0.25);
  assert.equal(gen.fuseBlown, true, 'fuse blows after sustained overload');
  machines.solvePower(0.1);
  assert.equal(gen.running, false, 'blown fuse stops the generator');
  // replace and recover
  const inv = { count: () => 5, remove: () => true };
  machines.replaceFuse(gen, inv);
  assert.equal(gen.fuseBlown, false);
  machines.solvePower(0.1);
  assert.equal(gen.running, true);
});

test('player priority override beats type defaults under starvation', () => {
  const { world, machines } = rig();
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  gen.fuel = 100;
  // shared spine — consumers hang off it individually (machines don't conduct)
  for (let x = 10; x <= 18; x++) world.set(x, 2, 11, B.WIRE);
  const turret = place(world, machines, 12, 2, 10, B.TURRET); // draw 3, default prio 2
  const drill1 = place(world, machines, 14, 2, 10, B.DRILL);  // draw 4, default prio 4
  const drill2 = place(world, machines, 16, 2, 10, B.DRILL);
  const drill3 = place(world, machines, 18, 2, 10, B.DRILL);
  // capacity 12: turret(3) + 2 drills (8) = 11 fits; third drill starves
  machines.solvePower();
  assert.equal(turret.powered, true);
  assert.equal(!!drill3.powered, false, 'lowest machine starves by default');
  // pin drill3 CRITICAL and drop the turret to LOW → drill3 eats first
  drill3.prio = 0;
  turret.prio = 9;
  machines.solvePower();
  assert.equal(drill3.powered, true, 'critical override feeds the pinned drill');
  assert.ok(machines.prioName(drill3) === 'CRITICAL');
});

test('a full drill stops mining until collected', () => {
  const { world, game, machines } = rig();
  buildFloor(world, 8, 14, 8, 14, 1);
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  gen.fuel = 100;
  const drill = place(world, machines, 11, 2, 10, B.DRILL);
  world.set(11, 1, 10, B.IRON_ORE); // fresh ore keeps appearing below
  drill.buffer = { iron_ore_raw: 24 };
  machines.solvePower();
  machines.updateDrill(drill, 5, true);
  assert.equal(drill.full, true, 'buffer at 24 halts the drill');
  assert.equal(drill.buffer.iron_ore_raw, 24, 'nothing mined while full');
});

test('warm-body turret ignores cold cyst carriers; vibration turret does not', () => {
  const { world, game, machines } = rig();
  buildFloor(world, 8, 20, 8, 20, 1);
  const gen = place(world, machines, 10, 3, 10, B.GENERATOR);
  gen.fuel = 100;
  const turret = place(world, machines, 11, 3, 10, B.TURRET);
  turret.ammo = 10;
  const vib = place(world, machines, 9, 3, 10, B.VIB_TURRET);
  const hits = [];
  game.infected.list = [{
    dead: false, isFalse: false,
    pos: { x: 13.5, y: 2, z: 10.5 },
    s: { cold: true },
    takeHit(dmg, v, src) { hits.push({ dmg, src }); },
  }];
  machines.solvePower(0.1);
  machines.updateTurret(turret, 0.1, true);
  assert.equal(hits.length, 0, 'warm turret cannot see a cold carrier');
  machines.updateVibTurret(vib, 0.1, true);
  assert.equal(hits.length, 1, 'vibration turret reads its movement anyway');
  assert.ok(hits[0].src, 'hit carries a source for retaliation (§12.3)');
});
