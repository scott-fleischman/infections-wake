// Integration: real World + real Signature + real InfectedManager on a stub
// game. A machine eater placed on flat ground must follow the signature
// gradient to an electrical/vibration emitter ~15 blocks away and either
// close within 3 blocks or start chewing the machine block there.
// Infected uses Math.random internally, so assertions are on robust outcomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Signature } from '../src/signature.js';
import { InfectedManager } from '../src/infected.js';
import { B } from '../src/config.js';
import { makeStubGame, makeEmptyWorld, buildFloor } from './helpers.js';

function rig() {
  const world = makeEmptyWorld();
  // flat stone slab: ground level is y = 21 everywhere on it
  buildFloor(world, 20, 70, 10, 40, 20);
  const game = makeStubGame({ world });
  // park the player far away so direct line-of-sight pursuit never triggers
  game.player.pos.set(500, 21, 500);
  const sig = new Signature(game);
  game.sig = sig;
  const inf = new InfectedManager(game);
  game.infected = inf;
  return { world, game, sig, inf };
}

test('machine eater follows the signature gradient to the emitter and chews', () => {
  const { world, game, sig, inf } = rig();

  // a "running machine": solid generator block + its dynamic signature
  const mx = 50, my = 21, mz = 25;
  world.set(mx, my, mz, B.GENERATOR);
  sig.setDynamic('M-test', mx, my, mz, { electrical: 0.7, vibration: 0.45 }, 40);
  const emitter = { x: mx + 0.5, y: my + 0.5, z: mz + 0.5 };

  // spawn ~15 blocks west of the machine, on the ground
  const eater = inf.spawn('machine_eater', 35.5, 21, 25.5, {});
  const distTo = (e) => Math.hypot(
    emitter.x - e.pos.x, emitter.y - e.pos.y, emitter.z - e.pos.z);
  const startDist = distTo(eater);
  assert.ok(startDist > 12, `sanity: starts far away (${startDist})`);

  // step the sim: up to ~30 simulated seconds at 20 Hz
  const dt = 0.05;
  let arrived = false;
  for (let step = 0; step < 600; step++) {
    game.t += dt;
    inf.update(dt);
    if (distTo(eater) < 3 || game.attackedBlocks.length > 0) { arrived = true; break; }
  }

  const endDist = distTo(eater);
  assert.ok(arrived,
    `gradient following failed: dist ${startDist.toFixed(1)} -> ${endDist.toFixed(1)}, ` +
    `state=${eater.state}, attacks=${game.attackedBlocks.length}`);
  assert.ok(endDist < startDist, 'distance to the emitter must shrink');

  // if it got adjacent it should be gnawing at the machine block itself
  if (game.attackedBlocks.length > 0) {
    const hit = game.attackedBlocks[game.attackedBlocks.length - 1];
    assert.deepEqual({ x: hit.x, y: hit.y, z: hit.z }, { x: mx, y: my, z: mz });
  }
});

test('with no stimulus in range the eater only wanders nearby', () => {
  const { game, inf } = rig();
  const eater = inf.spawn('machine_eater', 45.5, 21, 25.5, {});
  const start = { x: eater.pos.x, z: eater.pos.z };
  const dt = 0.05;
  for (let step = 0; step < 200; step++) { // 10 simulated seconds
    game.t += dt;
    inf.update(dt);
  }
  assert.equal(eater.state, 'wander');
  const drift = Math.hypot(eater.pos.x - start.x, eater.pos.z - start.z);
  assert.ok(drift < 8, `wander drift should stay small, got ${drift.toFixed(1)}`);
  assert.equal(eater.dead, undefined, 'still alive');
});

test('removing the emitter mid-pursuit drops the eater back to wander', () => {
  const { world, game, sig, inf } = rig();
  world.set(50, 21, 25, B.GENERATOR);
  sig.setDynamic('M-test', 50, 21, 25, { electrical: 0.7, vibration: 0.45 }, 40);
  const eater = inf.spawn('machine_eater', 38.5, 21, 25.5, {});

  const dt = 0.05;
  for (let step = 0; step < 40; step++) { game.t += dt; inf.update(dt); }
  assert.notEqual(eater.state, 'wander', 'should be tracking the emitter');

  sig.removeDynamic('M-test'); // machine powered down
  for (let step = 0; step < 40; step++) { game.t += dt; inf.update(dt); }
  assert.equal(eater.state, 'wander', 'no stimulus left to follow');
});
