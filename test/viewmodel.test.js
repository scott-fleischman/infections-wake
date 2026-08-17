// The swing math is pure so it can be tested without a WebGL context. The
// Viewmodel class itself is browser-only (it owns a Scene + Camera and reads
// window dimensions); only swingPose and SWING are imported here, which is
// exactly why swingPose must stay free of side effects and of `this`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swingPose, SWING } from '../src/viewmodel.js';

test('a swing starts and ends at rest', () => {
  // the pose is an OFFSET from the rest pose, so a non-zero value at either end
  // would leave the tool parked crooked after the animation finished
  for (const kind of ['mine', 'attack']) {
    const a = swingPose(kind, 0), b = swingPose(kind, 1);
    assert.ok(Math.abs(a.pitch) < 1e-6, `${kind} starts at rest pitch`);
    assert.ok(Math.abs(b.pitch) < 1e-6, `${kind} ends at rest pitch`);
    assert.ok(Math.abs(a.yaw) < 1e-6 && Math.abs(b.yaw) < 1e-6);
  }
});

test('a mine swing is a downward chop', () => {
  // peak of the chop drives the tool head DOWN (positive pitch = tip toward the floor)
  const peak = swingPose('mine', 0.35);
  assert.ok(peak.pitch > 0.6, `expected a deep chop, got ${peak.pitch}`);
  assert.ok(peak.push > 0, 'the chop reaches forward as it falls');
});

test('an attack swing is a faster, wider slash than a mine chop', () => {
  const attack = swingPose('attack', 0.3), mine = swingPose('mine', 0.3);
  assert.ok(Math.abs(attack.yaw) > Math.abs(mine.yaw), 'the slash sweeps sideways');
  assert.ok(SWING.attack < SWING.mine, 'the slash is the shorter animation');
});

test('swing phase clamps outside 0..1', () => {
  // update() divides elapsed time by the duration, so the last frame of a swing
  // routinely overshoots 1 — that must read as "finished", not as a wild pose
  assert.deepEqual(swingPose('mine', -0.5), swingPose('mine', 0));
  assert.deepEqual(swingPose('mine', 4), swingPose('mine', 1));
});

test('an unknown swing kind falls back to the chop', () => {
  // update() resolves the duration with `SWING[kind] ?? SWING.mine`; the pose
  // has to fall back the same way or a typo'd kind would freeze the tool flat
  assert.deepEqual(swingPose('bogus', 0.35), swingPose('mine', 0.35));
  assert.deepEqual(swingPose(undefined, 0.35), swingPose('mine', 0.35));
});

test('the chop bites on the way down and recovers slowly', () => {
  // asymmetric ease: fast fall, slow lift. Sampling either side of the impact
  // frame proves the animation is not just a symmetric sine both tasks share.
  const peak = swingPose('mine', 0.4);
  assert.ok(swingPose('mine', 0.2).pitch < peak.pitch, 'still falling before impact');
  assert.ok(swingPose('mine', 0.7).pitch < peak.pitch, 'lifting again after impact');
  // the recovery half is longer than the fall, so the same offset from the peak
  // has recovered less than the fall had covered
  assert.ok(swingPose('mine', 0.6).pitch > swingPose('mine', 0.2).pitch,
    'the lift is slower than the fall');
});

test('every pose value stays finite across the whole sweep', () => {
  // a NaN anywhere in here propagates straight into root.position/rotation and
  // silently blanks the entire viewmodel, so guard the full range
  for (const kind of ['mine', 'attack']) {
    for (let u = -0.5; u <= 1.5; u += 0.05) {
      const p = swingPose(kind, u);
      for (const k of ['pitch', 'yaw', 'roll', 'push'])
        assert.ok(Number.isFinite(p[k]), `${kind} @ ${u.toFixed(2)}: ${k} is ${p[k]}`);
    }
  }
});

test('SWING lists a positive duration for every animation', () => {
  for (const [kind, dur] of Object.entries(SWING)) {
    assert.equal(typeof dur, 'number', `${kind} duration is a number`);
    assert.ok(dur > 0 && dur < 2, `${kind} duration ${dur} is a plausible swing`);
  }
});
