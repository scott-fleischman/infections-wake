// models.js is headless-safe (Three.js runs in Node; only WebGLRenderer does
// not). These lock the contracts other modules rely on: limb capture for the
// walk cycle, and a tool mesh for every tool item in the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildInfectedMesh, buildToolMesh, buildPlayerMesh, buildGroundItem } from '../src/models.js';
import { STRAINS, ITEMS, PLAYER } from '../src/config.js';

// ---------------- limb capture for the walk cycle (Task B) ----------------

test('every strain exposes swingable legs for the walk cycle', () => {
  for (const key of Object.keys(STRAINS)) {
    const { group, limbs } = buildInfectedMesh(key);
    assert.ok(group.isObject3D, `${key} builds a group`);
    assert.ok(limbs, `${key} exposes limbs`);
    assert.ok(limbs.legs.length >= 2, `${key} needs at least 2 legs to swing, got ${limbs.legs.length}`);
    for (const l of limbs.legs) assert.equal(typeof l.rest, 'number', `${key} leg records its rest rotation`);
  }
});

test('limb rest angles capture the authored pose, not zero', () => {
  // the runner's legs are authored with rotation.x = -0.12 (forward lean)
  const { limbs } = buildInfectedMesh('runner');
  assert.ok(limbs.legs.some(l => Math.abs(l.rest + 0.12) < 1e-6), 'runner leg rest must be the authored -0.12');
});

test('captured limbs are real children of the body, and arms record their rest too', () => {
  // syncMesh writes straight to limb.mesh.rotation.x — if a limb were a stray
  // mesh that never got parented, the walk cycle would animate nothing.
  const { group, limbs } = buildInfectedMesh('drifter');
  assert.equal(limbs.arms.length, 2, 'a drifter swings two arms');
  for (const l of [...limbs.legs, ...limbs.arms]) {
    assert.ok(l.mesh.isMesh, 'a limb record points at a mesh');
    assert.equal(l.mesh.parent, group, 'the limb is parented to the body group');
    assert.equal(l.rest, l.mesh.rotation.x, 'rest is the pose as authored');
  }
});

test('limb capture does not disturb the index-addressed heads', () => {
  // colony_host and kiln_host pick their head out of g.children by INDEX.
  // Wrapping legs must return the mesh, never re-add or reorder it.
  for (const key of ['colony_host', 'kiln_host']) {
    const { group, head } = buildInfectedMesh(key);
    assert.ok(head && head.isMesh, `${key} still resolves a head mesh`);
    assert.ok(group.children.includes(head), `${key} head is still a child`);
  }
});

// ---------------- tool & weapon models (Task C) ----------------

test('every tool and weapon has a 3D model', () => {
  const toolIds = Object.keys(ITEMS).filter(id => ITEMS[id].tool);
  assert.ok(toolIds.length >= 9, `expected the full tool set, found ${toolIds.length}`);
  for (const id of toolIds) {
    const g = buildToolMesh(id);
    assert.ok(g && g.isObject3D, `${id} builds a mesh`);
    let meshes = 0;
    g.traverse(o => { if (o.isMesh) meshes++; });
    assert.ok(meshes >= 2, `${id} needs a haft and a head, got ${meshes} meshes`);
  }
});

test('buildToolMesh returns null for non-tools', () => {
  assert.equal(buildToolMesh('coal'), null);
  assert.equal(buildToolMesh('not_a_real_item'), null);
});

test('tools stand on their handle butt so the hand can grip at the origin', () => {
  const g = buildToolMesh('iron_pick');
  const box3 = new THREE.Box3().setFromObject(g);
  assert.ok(box3.min.y >= -0.02, `handle butt sits at the origin, min.y=${box3.min.y}`);
  assert.ok(box3.max.y > 0.4, 'tool extends upward');
});

test('every tool sits on its butt and reads as a distinct silhouette', () => {
  // The viewmodel grips at (0,0,0) and the gallery frames from the origin up,
  // so a tool whose geometry hangs below y=0 would float in the hand.
  const shape = {};
  for (const id of Object.keys(ITEMS).filter(i => ITEMS[i].tool)) {
    const b = new THREE.Box3().setFromObject(buildToolMesh(id));
    assert.ok(b.min.y >= -0.02, `${id} butt sits at the origin, min.y=${b.min.y}`);
    assert.ok(b.max.y > 0.4, `${id} extends upward, max.y=${b.max.y}`);
    shape[ITEMS[id].tool] = b;
  }
  // a pick's head runs fore-and-aft; a shovel's blade is wide; an axe bit is
  // deep on one side only; a blade is tall and narrow. Different tools must
  // not collapse onto the same box.
  assert.ok(shape.pick.max.z - shape.pick.min.z > 0.5, 'a pick head spans front to back');
  assert.ok(shape.shovel.max.x - shape.shovel.min.x > 0.2, 'a shovel blade is wide');
  assert.ok(shape.axe.max.z > 0.25, 'an axe bit juts forward');
  assert.ok(shape.sword.max.y > 0.8, 'a blade runs long');
});

test('a spear is longer than a hand blade', () => {
  const spear = new THREE.Box3().setFromObject(buildToolMesh('stone_spear'));
  const blade = new THREE.Box3().setFromObject(buildToolMesh('iron_blade'));
  assert.ok(spear.max.y > blade.max.y, 'the spear reaches further than the blade');
});

test('a dropped tool lies on its side instead of standing on end', () => {
  const g = buildGroundItem('iron_pick', 3);
  assert.ok(g && g.isObject3D, 'a dropped pick has a ground form');
  const b = new THREE.Box3().setFromObject(g);
  assert.ok(b.max.y < 0.4, `a fallen tool stays low, max.y=${b.max.y}`);
  assert.ok(b.max.x - b.min.x > 0.4 || b.max.z - b.min.z > 0.4, 'it lies out along the ground');
});

test('buildGroundItem still returns null for items with no ground form', () => {
  assert.equal(buildGroundItem('iron_ingot', 0), null);
});

// ---------------- the player's own body (Task E) ----------------

test('the player body exposes named parts and swingable legs', () => {
  const { group, parts, limbs } = buildPlayerMesh();
  assert.ok(group.isObject3D);
  assert.ok(parts.head && parts.head.isObject3D, 'head is addressable so first-person can hide it');
  assert.equal(parts.arms.length, 2, 'both arms are addressable');
  assert.equal(limbs.legs.length, 2, 'two legs to swing');
});

test('the player body head sits below eye height so it never fills the camera', () => {
  const { parts } = buildPlayerMesh();
  // PLAYER.eye is 1.55; the head centre must sit under it
  assert.ok(parts.head.position.y < PLAYER.eye, `head at ${parts.head.position.y} must clear the eye`);
});

test('the player torso is the real torso mesh, not whatever child index 4 happens to be', () => {
  // main.js hides the head and arms in first person; the torso is what you
  // actually see looking down, so it must be the widest chest box.
  const { group, parts } = buildPlayerMesh();
  assert.ok(parts.torso && parts.torso.isMesh, 'torso is a mesh');
  assert.equal(parts.torso.parent, group, 'torso is a child of the body');
  const g = parts.torso.geometry.parameters;
  assert.ok(g.width > 0.3 && g.height > 0.4, `torso is chest-sized, got ${g.width}x${g.height}`);
  assert.ok(parts.torso.position.y > 0.8 && parts.torso.position.y < parts.head.position.y,
    'the torso sits between the legs and the head');
  assert.ok(!parts.arms.includes(parts.torso), 'the torso is not an arm');
});

test('the player body stands on the ground with its origin at the feet', () => {
  // main.js sets group.position to player.pos (feet), so nothing may hang below 0
  const { group } = buildPlayerMesh();
  const b = new THREE.Box3().setFromObject(group);
  assert.ok(b.min.y >= -0.02, `feet sit at the origin, min.y=${b.min.y}`);
  assert.ok(b.max.y < PLAYER.height + 0.1, `body fits the collider, max.y=${b.max.y}`);
});
