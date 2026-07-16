// Signature field: distance falloff, wall attenuation, and stimulus selection
// (sense weights, investigate threshold, exclusion memory). Uses a real World
// (ungenerated = all air, a deterministic empty canvas) and a real Signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Signature } from '../src/signature.js';
import { SIGNATURE, B } from '../src/config.js';
import { makeStubGame, makeEmptyWorld } from './helpers.js';

function makeSig() {
  const world = makeEmptyWorld();
  const game = makeStubGame({ world });
  game.player.pos.set(500, 500, 500); // park the player far outside every radius
  const sig = new Signature(game);
  game.sig = sig;
  return { sig, world, game };
}

test('static emitter strength decreases monotonically with distance', () => {
  const { sig } = makeSig();
  sig.addStaticBlock(30, 10, 30, { emits: { heat: 0.6 } }); // r = 8 + 0.6*22 = 21.2
  let prev = Infinity;
  for (let d = 1; d <= 19; d += 2) {
    const totals = sig.sampleTotals(30.5 + d, 10.5, 30.5, false);
    assert.ok(totals.heat > 0, `no signal at distance ${d}`);
    assert.ok(totals.heat < prev, `strength did not decrease at distance ${d}`);
    prev = totals.heat;
  }
  // beyond the radius: nothing
  const far = sig.sampleTotals(30.5 + 25, 10.5, 30.5, false);
  assert.equal(far.heat, 0);
});

test('wallAtten: 1.0 through clear air', () => {
  const { sig } = makeSig();
  assert.equal(sig.wallAtten(10.5, 5.5, 10.5, 16.5, 5.5, 10.5), 1);
});

test('wallAtten: one opaque block attenuates to ~0.55', () => {
  const { sig, world } = makeSig();
  // segment (10.5..16.5) samples cell centers x=11.5..15.5; exactly one hits stone
  world.set(13, 5, 10, B.STONE);
  const a = sig.wallAtten(10.5, 5.5, 10.5, 16.5, 5.5, 10.5);
  assert.ok(Math.abs(a - SIGNATURE.wallAttenuation) < 1e-12,
    `expected ${SIGNATURE.wallAttenuation}, got ${a}`);
  assert.ok(Math.abs(a - 0.55) < 1e-12);
});

test('wallAtten: attenuation compounds per wall and is capped', () => {
  const { sig, world } = makeSig();
  world.set(12, 5, 10, B.STONE);
  world.set(14, 5, 10, B.STONE);
  const two = sig.wallAtten(10.5, 5.5, 10.5, 16.5, 5.5, 10.5);
  assert.ok(Math.abs(two - 0.55 ** 2) < 1e-12, `two walls: ${two}`);
});

test('bestStimulus respects sense weights over proximity', () => {
  const { sig } = makeSig();
  // electrical source is closer, heat source farther
  sig.setDynamic('elec', 36, 10, 30, { electrical: 0.8 }, 25);
  sig.setDynamic('heat', 40, 10, 30, { heat: 0.8 }, 25);

  const heatSeeker = sig.bestStimulus(30.5, 10.5, 30.5, { heat: 1, electrical: 0 }, 0.05);
  assert.ok(heatSeeker, 'heat seeker found nothing');
  assert.equal(heatSeeker.x, 40.5, 'heat seeker should ignore the closer electrical source');

  const elecSeeker = sig.bestStimulus(30.5, 10.5, 30.5, { heat: 0.1, electrical: 1 }, 0.05);
  assert.ok(elecSeeker, 'electrical seeker found nothing');
  assert.equal(elecSeeker.x, 36.5);
});

test('bestStimulus enforces the investigate threshold', () => {
  const { sig } = makeSig();
  sig.setDynamic('heat', 50, 10, 30, { heat: 0.8 }, 25);
  // sample 20 blocks away: score = 0.8 * (1 - 20/25) = 0.16
  const weak = sig.bestStimulus(30.5, 10.5, 30.5, { heat: 1 }, 0.5);
  assert.equal(weak, null, 'score below threshold must return null');
  const strongEnough = sig.bestStimulus(30.5, 10.5, 30.5, { heat: 1 }, 0.1);
  assert.ok(strongEnough, 'score above threshold must be detected');
  assert.ok(Math.abs(strongEnough.score - 0.16) < 1e-9);
});

test('bestStimulus skips excluded emitter keys (frustration memory)', () => {
  const { sig } = makeSig();
  sig.setDynamic('near', 36, 10, 30, { heat: 0.8 }, 30);
  sig.setDynamic('far', 44, 10, 30, { heat: 0.8 }, 30);

  const senses = { heat: 1 };
  const first = sig.bestStimulus(30.5, 10.5, 30.5, senses, 0.05);
  assert.equal(first.x, 36.5, 'nearest should win at equal emission');

  const excluded = new Set([sig.emitterKey(first.emitter)]);
  const second = sig.bestStimulus(30.5, 10.5, 30.5, senses, 0.05, true, excluded);
  assert.ok(second, 'second emitter should still be sensed');
  assert.equal(second.x, 44.5, 'excluded emitter must be skipped');

  excluded.add(sig.emitterKey(second.emitter));
  const none = sig.bestStimulus(30.5, 10.5, 30.5, senses, 0.05, true, excluded);
  assert.equal(none, null, 'all emitters excluded -> null');
});

test('bestStimulus applies wall attenuation to the score', () => {
  const { sig, world } = makeSig();
  sig.setDynamic('heat', 40, 10, 30, { heat: 0.8 }, 25);
  const open = sig.bestStimulus(30.5, 10.5, 30.5, { heat: 1 }, 0.05);
  world.set(35, 10, 30, B.STONE); // one wall across the line
  const walled = sig.bestStimulus(30.5, 10.5, 30.5, { heat: 1 }, 0.05);
  assert.ok(walled.score < open.score, 'wall must reduce the score');
  assert.ok(Math.abs(walled.score - open.score * 0.55) < 1e-9);
});
