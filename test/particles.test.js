// The pool math is pure so it runs headless. Particles class construction needs
// a THREE.Scene only, which is Node-safe (no WebGLRenderer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { stepParticle, Particles, PARTICLE_MAX } from '../src/particles.js';

test('a particle falls, slows and expires', () => {
  const p = { x: 0, y: 10, z: 0, vx: 2, vy: 0, vz: 0, ttl: 1, life: 1 };
  stepParticle(p, 0.1);
  assert.ok(p.y < 10, 'gravity pulls it down');
  assert.ok(p.vx < 2 && p.vx > 0, 'horizontal drag bleeds speed without reversing it');
  assert.ok(Math.abs(p.ttl - 0.9) < 1e-9);
});

test('a particle stops falling below its ttl', () => {
  const p = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, ttl: 0.05, life: 1 };
  stepParticle(p, 0.1);
  assert.ok(p.ttl <= 0, 'expired');
});

test('the pool recycles instead of growing', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  for (let i = 0; i < PARTICLE_MAX * 3; i++) fx.spawn(0, 0, 0, 0xffffff, {});
  assert.ok(fx.live.length <= PARTICLE_MAX, `pool capped at ${PARTICLE_MAX}, got ${fx.live.length}`);
});

test('a burst emits many particles at once and they all expire', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  fx.burstBlock(3, 4, 5, 0x7f8a6a);
  assert.ok(fx.live.length >= 8, `a break should throw a visible spray, got ${fx.live.length}`);
  for (let i = 0; i < 200; i++) fx.update(0.05);   // 10 seconds
  assert.equal(fx.live.length, 0, 'everything expires — no leak');
});

test('a death burst is bigger than a block break', () => {
  const scene = new THREE.Scene();
  const a = new Particles(scene); a.burstBlock(0, 0, 0, 0x888888);
  const b = new Particles(scene); b.burstDeath({ x: 0, y: 0, z: 0 }, 0x8a4a5a, 1);
  assert.ok(b.live.length > a.live.length, 'a death reads louder than a mined block');
});

// ---------------- allocation discipline (the whole point of the pool) -------

// Combat on a streamed 16k world cannot afford a GC hitch every time something
// dies, so the particle records themselves are allocated ONCE and recycled.
// Identity is the only observable proof: a slot that expired must come back as
// the same object, not a fresh literal.
test('expired particle records are reused, never reallocated', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  fx.spawn(0, 0, 0, 0xffffff, { life: 0.1 });
  const first = fx.live[0];
  fx.update(0.2);                       // outlives its ttl, slot goes back to the free list
  assert.equal(fx.live.length, 0);
  fx.spawn(1, 2, 3, 0x00ff00, { life: 1 });
  assert.equal(fx.live[0], first, 'the recycled slot is the SAME object');
  assert.equal(fx.live[0].x, 1, 'and it was fully re-initialised');
});

// Overflow must steal the oldest slot rather than grow: `live` is capped and the
// stolen record is reused in place.
test('overflowing the pool steals the oldest slot instead of allocating', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  for (let i = 0; i < PARTICLE_MAX; i++) fx.spawn(i, 0, 0, 0xffffff, { life: 5 });
  const oldest = fx.live[0];
  fx.spawn(999, 0, 0, 0xff0000, { life: 5 });
  assert.equal(fx.live.length, PARTICLE_MAX, 'still capped');
  assert.equal(fx.live[PARTICLE_MAX - 1], oldest, 'the oldest record became the newest');
  assert.equal(fx.live[PARTICLE_MAX - 1].x, 999);
});

// The instanced mesh is the single GPU-side allocation; it must exist up front
// at full capacity so no frame ever resizes a buffer.
test('one instanced mesh is allocated up front at full capacity', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  assert.ok(fx.mesh.isInstancedMesh, 'a single InstancedMesh carries every particle');
  assert.equal(fx.mesh.instanceMatrix.count, PARTICLE_MAX, 'sized for the whole pool at build time');
  assert.equal(scene.children.length, 1, 'exactly one object added to the scene');
  fx.burstDeath({ x: 0, y: 0, z: 0 }, 0x8a4a5a, 1);
  fx.update(0.016);
  assert.equal(scene.children.length, 1, 'and never a second one');
  assert.equal(fx.mesh.instanceMatrix.count, PARTICLE_MAX, 'the buffer is never resized');
});

// A dead particle must not be left drawn at full size somewhere in the world.
// Two things keep that true: mesh.count stops the draw at the live tally, and
// every unused slot holds a zero-scale matrix. (Measured off the basis vectors
// rather than Matrix4.decompose — decompose reports scale 1,1,1 for a
// degenerate matrix, so it cannot tell a hidden instance from a unit one.)
const basisLen = (m) => Math.hypot(m.elements[0], m.elements[1], m.elements[2]);

test('unused instances are scaled to zero, not left floating', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  fx.burstBlock(3, 4, 5, 0x7f8a6a);
  fx.update(0.016);
  assert.equal(fx.mesh.count, fx.live.length, 'only the live shards are drawn');
  const m = new THREE.Matrix4();
  fx.mesh.getMatrixAt(PARTICLE_MAX - 1, m);         // far past the live count
  assert.equal(basisLen(m), 0, 'a dead slot draws nothing');
  fx.mesh.getMatrixAt(0, m);
  assert.ok(basisLen(m) > 0, 'a live slot has real size');
});

test('a drained pool draws no instances at all', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  fx.burstBlock(3, 4, 5, 0x7f8a6a);
  for (let i = 0; i < 200; i++) fx.update(0.05);
  assert.equal(fx.mesh.count, 0, 'an idle pool costs zero instances');
});

// instanceColor is allocated lazily by the FIRST setColorAt(). three treats
// that null -> non-null flip as a program change, so leaving it lazy makes the
// player's first block break pay a Lambert shader recompile mid-frame. Priming
// it in the constructor moves that compile to load time.
test('instanceColor exists before a single particle has ever spawned', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  assert.ok(fx.mesh.instanceColor, 'the colour attribute is primed at construction');
  assert.equal(fx.mesh.instanceColor.count, PARTICLE_MAX, 'sized for the whole pool');
});

// frustumCulled is off, so the renderer re-uploads BOTH instance buffers in
// full on any frame where needsUpdate was raised — 38 KB even with nothing
// alive. An idle pool must not flag anything.
test('an idle pool does not re-upload its instance buffers', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  fx.burstBlock(3, 4, 5, 0x7f8a6a);
  for (let i = 0; i < 200; i++) fx.update(0.05);   // drain it completely
  assert.equal(fx.mesh.count, 0);
  const mv = fx.mesh.instanceMatrix.version, cv = fx.mesh.instanceColor.version;
  for (let i = 0; i < 10; i++) fx.update(0.016);
  assert.equal(fx.mesh.instanceMatrix.version, mv, 'no matrix upload while idle');
  assert.equal(fx.mesh.instanceColor.version, cv, 'no colour upload while idle');
  // ...but a live frame still uploads, or nothing would ever be drawn
  fx.burstBlock(3, 4, 5, 0x7f8a6a);
  fx.update(0.016);
  assert.ok(fx.mesh.instanceMatrix.version > mv, 'a live frame uploads');
  assert.ok(fx.mesh.instanceColor.version > cv, 'and so do its colours');
});

test('dispose detaches the mesh and drops every live particle', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  fx.burstDeath({ x: 0, y: 0, z: 0 }, 0x8a4a5a, 1);
  fx.dispose();
  assert.equal(scene.children.length, 0, 'nothing left in the scene');
  assert.equal(fx.live.length, 0);
});
