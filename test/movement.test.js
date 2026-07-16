// moveBasis must agree with the camera convention: Player.forwardVec() maps
// forward (local -Z) to (-sin yaw, 0, -cos yaw) at pitch 0. This pins a
// just-fixed bug, so assertions are strict (epsilon 1e-9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveBasis } from '../src/player.js';

const EPS = 1e-9;
const YAWS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI, 2.5];

function assertVec(actual, ex, ez, msg) {
  assert.ok(Math.abs(actual.x - ex) <= EPS, `${msg}: x ${actual.x} != ${ex}`);
  assert.ok(Math.abs(actual.z - ez) <= EPS, `${msg}: z ${actual.z} != ${ez}`);
}

test('W (mz=-1) moves along forward = (-sin yaw, -cos yaw)', () => {
  for (const yaw of YAWS) {
    const v = moveBasis(0, -1, yaw);
    assertVec(v, -Math.sin(yaw), -Math.cos(yaw), `yaw=${yaw}`);
  }
});

test('S (mz=+1) is the exact negation of W', () => {
  for (const yaw of YAWS) {
    const w = moveBasis(0, -1, yaw);
    const s = moveBasis(0, 1, yaw);
    assertVec(s, -w.x, -w.z, `yaw=${yaw}`);
  }
});

test('D (mx=+1) moves along right = (cos yaw, -sin yaw) = forward rotated -90°', () => {
  for (const yaw of YAWS) {
    const v = moveBasis(1, 0, yaw);
    assertVec(v, Math.cos(yaw), -Math.sin(yaw), `yaw=${yaw}`);
    // right must equal forward rotated -90° about +Y: (x,z) -> (-z, x)
    const f = moveBasis(0, -1, yaw);
    assertVec(v, -f.z, f.x, `yaw=${yaw} (rotation identity)`);
  }
});

test('A (mx=-1) is the exact negation of D', () => {
  for (const yaw of YAWS) {
    const d = moveBasis(1, 0, yaw);
    const a = moveBasis(-1, 0, yaw);
    assertVec(a, -d.x, -d.z, `yaw=${yaw}`);
  }
});

test('rotation is an isometry: input magnitude preserved', () => {
  const inputs = [[1, 0], [0, -1], [0.6, -0.8], [1, 1], [-0.3, 0.7], [-1, -1]];
  for (const yaw of YAWS) {
    for (const [mx, mz] of inputs) {
      const v = moveBasis(mx, mz, yaw);
      const inMag = Math.hypot(mx, mz);
      const outMag = Math.hypot(v.x, v.z);
      assert.ok(Math.abs(inMag - outMag) <= EPS,
        `yaw=${yaw} input=(${mx},${mz}): |out|=${outMag} != |in|=${inMag}`);
    }
  }
});

test('yaw=0 sanity: W is -Z, D is +X', () => {
  assertVec(moveBasis(0, -1, 0), 0, -1, 'W at yaw=0');
  assertVec(moveBasis(1, 0, 0), 1, 0, 'D at yaw=0');
});
