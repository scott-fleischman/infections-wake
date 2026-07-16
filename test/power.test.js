// Power network solver: direct adjacency, wire runs, merged components not
// double-counting a generator, priority under starvation, and dry generators.
// Real Machines over a real (empty) World; machine blocks placed via world.set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machines } from '../src/power.js';
import { B, MACHINES } from '../src/config.js';
import { makeStubGame, makeEmptyWorld } from './helpers.js';

function rig() {
  const world = makeEmptyWorld();
  const game = makeStubGame({ world });
  const machines = new Machines(game);
  game.machines = machines;
  return { world, game, machines };
}

// place the block in the world AND register the machine entity
function place(world, machines, x, y, z, blockId) {
  world.set(x, y, z, blockId);
  return machines.add(x, y, z, blockId);
}

test('(a) fueled generator powers an adjacent lamp without wires', () => {
  const { world, machines } = rig();
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  const lamp = place(world, machines, 11, 2, 10, B.LAMP);
  gen.fuel = 10;
  machines.solvePower();
  assert.equal(lamp.powered, true);
  assert.equal(gen.running, true);
  assert.equal(machines.networkPower.capacity, MACHINES.generator.powerOutput);
});

test('(b) a wire run connects a distant lamp', () => {
  const { world, machines } = rig();
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  gen.fuel = 10;
  for (let x = 11; x <= 20; x++) world.set(x, 2, 10, B.WIRE);
  const lamp = place(world, machines, 21, 2, 10, B.LAMP);
  machines.solvePower();
  assert.equal(lamp.powered, true, 'lamp at the end of a 10-wire run should be powered');
});

test('(b2) a lamp with no wire path and no adjacency stays dark', () => {
  const { world, machines } = rig();
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  gen.fuel = 10;
  const lamp = place(world, machines, 21, 2, 10, B.LAMP); // 11 blocks away, no wires
  machines.solvePower();
  assert.equal(!!lamp.powered, false);
});

test('(c) one generator touching two wire components does not double capacity', () => {
  const { world, machines } = rig();
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  gen.fuel = 10;
  // component A east of the generator, component B west — both touch it
  world.set(11, 2, 10, B.WIRE);
  world.set(12, 2, 10, B.WIRE);
  const lampA = place(world, machines, 13, 2, 10, B.LAMP);
  world.set(9, 2, 10, B.WIRE);
  world.set(8, 2, 10, B.WIRE);
  const lampB = place(world, machines, 7, 2, 10, B.LAMP);
  machines.solvePower();
  assert.equal(lampA.powered, true);
  assert.equal(lampB.powered, true);
  assert.equal(machines.networkPower.capacity, MACHINES.generator.powerOutput,
    'merged network must count the generator once');
});

test('(d) priority when starved: beacon fed before drills', () => {
  const { world, machines } = rig();
  // generator (12 output) + beacon (2) + 3 drills (4 each) = 14 demand
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  gen.fuel = 10;
  const beacon = place(world, machines, 11, 2, 10, B.BEACON);
  const drills = [
    place(world, machines, 9, 2, 10, B.DRILL),
    place(world, machines, 10, 2, 11, B.DRILL),
    place(world, machines, 10, 2, 9, B.DRILL),
  ];
  machines.solvePower();
  assert.equal(beacon.powered, true, 'beacon (higher priority) must be powered first');
  const poweredDrills = drills.filter(d => d.powered).length;
  assert.equal(poweredDrills, 2, 'remaining 10 capacity feeds exactly two 4-draw drills');
  assert.equal(machines.networkPower.demand, 2 + 3 * 4);
});

test('(e) generator with fuel=0 powers nothing', () => {
  const { world, machines } = rig();
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  const lamp = place(world, machines, 11, 2, 10, B.LAMP);
  gen.fuel = 0;
  machines.solvePower();
  assert.equal(gen.running, false);
  assert.equal(!!lamp.powered, false);
  assert.equal(machines.networkPower.capacity, 0);
});

test('update() burns generator fuel over time and lights the lamp meanwhile', () => {
  const { world, machines } = rig();
  const gen = place(world, machines, 10, 2, 10, B.GENERATOR);
  const lamp = place(world, machines, 11, 2, 10, B.LAMP);
  gen.fuel = 1;
  machines.update(1); // one second
  assert.equal(lamp.powered, true);
  assert.ok(gen.fuel < 1, 'fuel must burn down');
  assert.ok(Math.abs(gen.fuel - (1 - MACHINES.generator.fuelPerSec)) < 1e-9);
  // burn it dry
  for (let i = 0; i < 20; i++) machines.update(1);
  assert.equal(gen.fuel, 0);
  machines.update(1);
  assert.equal(!!lamp.powered, false, 'dry generator stops powering the lamp');
});
