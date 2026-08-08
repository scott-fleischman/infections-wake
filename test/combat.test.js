// Wishlist mechanics: machine-eater-only block breaking, knockback, and the
// 15-minute day halves. Same rig style as sim.test.js — real World/Signature/
// InfectedManager on a stub game that records attackedBlocks / dugSoft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Signature } from '../src/signature.js';
import { InfectedManager } from '../src/infected.js';
import { Machines } from '../src/power.js';
import { B, BLOCKS, TIME, STRAINS, canInfectedBreakBlock } from '../src/config.js';
import { makeStubGame, makeEmptyWorld, buildFloor } from './helpers.js';

function rig() {
  const world = makeEmptyWorld();
  buildFloor(world, 20, 70, 10, 40, 20); // ground level y=21 on the slab
  const game = makeStubGame({ world });
  game.player.pos.set(500, 21, 500); // no line-of-sight pursuit
  const sig = new Signature(game);
  game.sig = sig;
  const inf = new InfectedManager(game);
  game.infected = inf;
  return { world, game, sig, inf };
}

// a 2-tall wall across x=wallX spanning the whole slab, so nothing can walk
// around it within the sim window
function buildWall(world, wallX, id) {
  for (let z = 10; z <= 40; z++) {
    world.set(wallX, 21, z, id);
    world.set(wallX, 22, z, id);
  }
}

// ---------------- who may break what (wishlist #2) ----------------

test('canInfectedBreakBlock: only machine eaters, only machine blocks', () => {
  const wall = BLOCKS[B.WOOD_WALL], door = BLOCKS[B.DOOR];
  const generator = BLOCKS[B.GENERATOR], wire = BLOCKS[B.WIRE];
  assert.equal(canInfectedBreakBlock(STRAINS.machine_eater, generator), true);
  assert.equal(canInfectedBreakBlock(STRAINS.machine_eater, wire), true, 'chewed cables are their signature move');
  assert.equal(canInfectedBreakBlock(STRAINS.machine_eater, wall), false, 'even eaters cannot break walls');
  assert.equal(canInfectedBreakBlock(STRAINS.machine_eater, door), false);
  for (const key of ['drifter', 'runner', 'brute', 'climber', 'burrower', 'spitter', 'elite', 'colony_host']) {
    assert.equal(canInfectedBreakBlock(STRAINS[key], generator), false, `${key} must not break machines`);
    assert.equal(canInfectedBreakBlock(STRAINS[key], wall), false, `${key} must not break walls`);
  }
});

test('a drifter blocked by a timber wall never attacks it', () => {
  const { world, game, sig, inf } = rig();
  buildWall(world, 45, B.WOOD_WALL);
  // a warm body signature behind the wall — exactly what used to draw chewing
  sig.setDynamic('bait', 50, 21, 25, { heat: 0.8, co2: 0.6 }, 40);
  const drifter = inf.spawn('drifter', 38.5, 21, 25.5, {});
  const dt = 0.05;
  for (let step = 0; step < 400; step++) { game.t += dt; inf.update(dt); }
  assert.ok(drifter.pos.x > 42, `must actually reach the wall (x=${drifter.pos.x.toFixed(1)}) for the test to mean anything`);
  assert.equal(game.attackedBlocks.length, 0, 'walls are safe from non-eaters');
  assert.equal(game.dugSoft.length, 0);
});

test('a machine eater blocked by a timber wall never attacks it either', () => {
  const { world, game, sig, inf } = rig();
  buildWall(world, 45, B.WOOD_WALL);
  sig.setDynamic('M-test', 50, 21, 25, { electrical: 0.7, vibration: 0.45 }, 40);
  inf.spawn('machine_eater', 38.5, 21, 25.5, {});
  const dt = 0.05;
  for (let step = 0; step < 400; step++) { game.t += dt; inf.update(dt); }
  assert.equal(game.attackedBlocks.length, 0, 'a wall is not a machine block');
});

test('a burrower routes soil through infectedDigSoft, never block attacks', () => {
  const { world, game, sig, inf } = rig();
  buildWall(world, 45, B.DIRT); // an earth bank in its path
  sig.setDynamic('thump', 50, 21, 25, { vibration: 0.9 }, 40);
  inf.spawn('burrower', 40.5, 21, 25.5, {});
  const dt = 0.05;
  for (let step = 0; step < 400; step++) { game.t += dt; inf.update(dt); }
  assert.ok(game.dugSoft.length > 0, 'burrower must keep tunneling through soil');
  assert.equal(game.attackedBlocks.length, 0, 'soil passage is movement, not block damage');
  for (const d of game.dugSoft) {
    const id = world.get(d.x, d.y, d.z);
    assert.ok([B.DIRT, B.GRASS, B.SAND, B.GRAVEL].includes(id), 'digSoft only ever targets soft ground');
  }
});

test('hit by a machine, a drifter hunts the player; an eater retaliates on the machine', () => {
  const { inf } = rig();
  const drifter = inf.spawn('drifter', 40.5, 21, 25.5, {});
  drifter.takeHit(2, true, { x: 42, y: 21, z: 25 }); // e.g. turret fire
  assert.equal(drifter.retaliate, undefined, 'cannot damage the turret, so no point camping it');
  assert.equal(drifter.targetIsPlayer, true);

  const eater = inf.spawn('machine_eater', 40.5, 21, 25.5, {});
  eater.takeHit(2, true, { x: 42, y: 21, z: 25 });
  assert.deepEqual(eater.retaliate, { x: 42, y: 21, z: 25 }, 'eaters turn on the machine (§12.3)');
});

// ---------------- knockback (wishlist #3) ----------------

test('melee knockback shoves an infected away and decays', () => {
  const { game, inf } = rig();
  const drifter = inf.spawn('drifter', 45.5, 21, 25.5, {});
  drifter.applyKnockback({ x: 40, y: 21, z: 25.5 }, 12); // hit from the west
  const startX = drifter.pos.x;
  const dt = 0.05;
  for (let step = 0; step < 40; step++) { game.t += dt; inf.update(dt); } // 2s
  assert.ok(drifter.pos.x - startX > 1, `shoved east, got ${(drifter.pos.x - startX).toFixed(2)}`);
  assert.ok(drifter.kb.length() < 0.15, 'shove decays away');
  // never ends inside a solid cell
  assert.equal(drifter.solidAt(drifter.pos.x, drifter.pos.y, drifter.pos.z), false);
});

test('knockback respects walls and never chews them', () => {
  const { world, game, inf } = rig();
  buildWall(world, 47, B.WOOD_WALL);
  const drifter = inf.spawn('drifter', 45.5, 21, 25.5, {});
  drifter.applyKnockback({ x: 40, y: 21, z: 25.5 }, 14); // flung at the wall
  const dt = 0.05;
  for (let step = 0; step < 30; step++) { game.t += dt; inf.update(dt); }
  assert.ok(drifter.pos.x < 47, 'stopped by the wall');
  assert.equal(game.attackedBlocks.length, 0, 'being flung into a wall is not an attack');
});

test('knockback interrupts a machine eater mid-chew', () => {
  const { world, game, sig, inf } = rig();
  world.set(50, 21, 25, B.GENERATOR);
  sig.setDynamic('M-test', 50, 21, 25, { electrical: 0.7, vibration: 0.45 }, 40);
  const eater = inf.spawn('machine_eater', 48.6, 21, 25.5, {});
  const dt = 0.05;
  for (let i = 0; i < 120; i++) { game.t += dt; inf.update(dt); }
  assert.ok(game.attackedBlocks.length > 0, 'sanity: it is chewing the generator');
  const x0 = eater.pos.x;
  eater.applyKnockback({ x: 52, y: 21, z: 25.5 }, 10); // struck from the east
  // it gets shoved west, then legitimately walks back to resume — assert the
  // peak displacement, not the settled position
  let minX = x0;
  for (let i = 0; i < 10; i++) { game.t += dt; inf.update(dt); minX = Math.min(minX, eater.pos.x); }
  assert.ok(minX < x0 - 0.35,
    `the shove must land even while chewing (peak ${(x0 - minX).toFixed(2)} west)`);
});

test('a shoved climber is stopped by the wall — the shove never converts to a climb boost', () => {
  const { world, inf } = rig();
  buildWall(world, 47, B.WOOD_WALL);
  const climber = inf.spawn('climber', 46.8, 21, 25.5, {});
  climber._dt = 0.05;
  climber.tryMove(0.4, 0, true); // knockback path: into the wall, noAttack
  assert.equal(climber.pos.y, 21, 'no lift from a shove');
  assert.ok(!climber._climbedNow, 'no gravity-defeat frame from a shove');
  climber.tryMove(0.4, 0); // normal AI movement into the wall still climbs
  assert.ok(climber._climbedNow, 'deliberate movement climbs as designed');
});

test('encounter bosses are immune to knockback', () => {
  const { inf } = rig();
  const host = inf.spawn('colony_host', 45.5, 21, 25.5, {});
  host.applyKnockback({ x: 40, y: 21, z: 25.5 }, 14);
  assert.equal(host.kb.length(), 0);
});

// ---------------- machine knockback (§12, wishlist #3 every source) -------

test('a gun turret shoves a non-boss infected it fires on', () => {
  const { game, inf } = rig();
  const machines = new Machines(game);
  const turret = machines.add(40, 21, 25, B.TURRET);
  turret.ammo = 5;
  const drifter = inf.spawn('drifter', 45.5, 21, 25.5, {});
  const hp0 = drifter.hp;
  machines.updateTurret(turret, 0.1, true);
  assert.ok(drifter.hp < hp0, 'turret hit landed');
  assert.ok(drifter.kb.length() > 0, 'turret fire shoves the target');
});

test('a vibration turret shoves a non-boss infected it fires on', () => {
  const { game, inf } = rig();
  const machines = new Machines(game);
  const vib = machines.add(40, 21, 25, B.VIB_TURRET);
  const drifter = inf.spawn('drifter', 45.5, 21, 25.5, {});
  const hp0 = drifter.hp;
  machines.updateVibTurret(vib, 0.1, true);
  assert.ok(drifter.hp < hp0, 'vibration turret hit landed');
  assert.ok(drifter.kb.length() > 0, 'vibration turret fire shoves the target');
});

test('a gun turret still cannot budge an encounter boss', () => {
  const { game, inf } = rig();
  const machines = new Machines(game);
  const turret = machines.add(40, 21, 25, B.TURRET);
  turret.ammo = 5;
  const host = inf.spawn('colony_host', 45.5, 21, 25.5, {});
  machines.updateTurret(turret, 0.1, true);
  assert.equal(host.kb.length(), 0, 'boss immunity holds through the machine path too');
});

// ---------------- day halves (wishlist #5) ----------------

test('days are symmetric 15-minute halves', () => {
  assert.equal(TIME.DAY_LENGTH, 1800, '30 real minutes per full cycle');
  assert.equal(TIME.DUSK - TIME.DAWN, 0.5, 'day half is exactly half the cycle');
  const nightFrac = 1 - (TIME.DUSK - TIME.DAWN);
  assert.equal(nightFrac * TIME.DAY_LENGTH, 900, 'night half is 15 minutes');
  // ordering contracts other systems rely on
  assert.ok(TIME.DAWN < TIME.DAWN_END, 'dawn ramp inside the day');
  assert.ok(TIME.DUSK < TIME.NIGHT, 'dusk ramp precedes full night');
});
