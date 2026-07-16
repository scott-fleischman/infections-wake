// Determinism guarantees the save system relies on: same seed reproduces the
// exact stream, forks are salt-derived (independent of parent draw order).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG, mulberry32, hashSeed, noise2, noise3, fbm2 } from '../src/rng.js';

const draws = (rng, n = 100) => Array.from({ length: n }, () => rng.float());

test('same seed produces identical sequences', () => {
  assert.deepEqual(draws(new RNG('alpha')), draws(new RNG('alpha')));
  assert.deepEqual(draws(new RNG(12345)), draws(new RNG(12345)));
});

test('different seeds diverge', () => {
  const a = draws(new RNG('alpha'));
  const b = draws(new RNG('beta'));
  assert.notDeepEqual(a, b);
  // stronger: they should differ in most positions, not just one
  const same = a.filter((v, i) => v === b[i]).length;
  assert.ok(same < 5, `sequences share ${same}/100 positions`);
});

test('all draws are in [0, 1)', () => {
  const r = new RNG('range-check');
  for (let i = 0; i < 1000; i++) {
    const v = r.float();
    assert.ok(v >= 0 && v < 1, `draw ${v} out of range`);
  }
});

test("fork('x') streams are deterministic", () => {
  const f1 = draws(new RNG('seed').fork('x'));
  const f2 = draws(new RNG('seed').fork('x'));
  assert.deepEqual(f1, f2);
});

test('fork streams are independent of parent draw order', () => {
  const p1 = new RNG('seed');
  const early = draws(p1.fork('x'));       // fork before any parent draws

  const p2 = new RNG('seed');
  draws(p2, 57);                            // burn parent draws first
  const late = draws(p2.fork('x'));         // fork after
  assert.deepEqual(early, late);
});

test('forks with different salts diverge from each other and the parent', () => {
  const parent = new RNG('seed');
  const x = draws(parent.fork('x'));
  const y = draws(parent.fork('y'));
  assert.notDeepEqual(x, y);
  assert.notDeepEqual(x, draws(new RNG('seed')));
});

test('hashSeed is stable and int-valued', () => {
  assert.equal(hashSeed('test-seed'), hashSeed('test-seed'));
  assert.notEqual(hashSeed('a'), hashSeed('b'));
  const h = hashSeed('anything');
  assert.equal(h, h >>> 0);
});

test('mulberry32 streams repeat for equal integer seeds', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test('noise/fbm functions are pure and deterministic', () => {
  assert.equal(noise2(3.7, -1.2, 99), noise2(3.7, -1.2, 99));
  assert.equal(noise3(0.5, 8.1, -2.2, 7), noise3(0.5, 8.1, -2.2, 7));
  assert.equal(fbm2(12.34, 56.78, 11), fbm2(12.34, 56.78, 11));
  // different seeds change the field
  assert.notEqual(noise2(3.7, -1.2, 99), noise2(3.7, -1.2, 100));
});
