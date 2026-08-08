// Multi-cell furniture: doors stand 2 cells tall, beds lie 2 cells long.
// main.js owns the side effects (props, audio, drops) but every rule about
// WHICH cells belong together lives in multiblock.js, so it is testable here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { B, BLOCKS } from '../src/config.js';
import {
  doorParts, bedParts, bedHeadFor, yawToCardinal, upgradeEditsPlan, BED_DIR, MULTI_IDS,
} from '../src/multiblock.js';
import { makeEmptyWorld } from './helpers.js';

// The two writes main.js makes when a player toggles a door, driven off the
// pair — kept here so the world-level outcome is asserted, not just the math.
function toggleDoor(world, x, y, z) {
  const p = doorParts(world, x, y, z);
  if (!p || (p.base.id !== B.DOOR && p.base.id !== B.DOOR_OPEN)) return null;
  const open = p.base.id === B.DOOR_OPEN;
  world.set(p.base.x, p.base.y, p.base.z, open ? B.DOOR : B.DOOR_OPEN);
  if (p.top.id === B.DOOR_TOP || p.top.id === B.DOOR_TOP_OPEN)
    world.set(p.top.x, p.top.y, p.top.z, open ? B.DOOR_TOP : B.DOOR_TOP_OPEN);
  return p;
}

// The break branch: clear every cell of the pair that is really part of it.
function breakPair(world, x, y, z) {
  const door = doorParts(world, x, y, z);
  const bed = door ? null : bedParts(world, x, y, z);
  if (!door && !bed) return null;
  for (const c of door ? [door.base, door.top] : [bed.head, bed.foot]) {
    if (!c || !MULTI_IDS.has(c.id)) continue;
    world.set(c.x, c.y, c.z, B.AIR);
  }
  return 'b:' + (door ? B.DOOR : B.BED);
}

function hangDoor(world, x, y, z, open = false) {
  world.set(x, y, z, open ? B.DOOR_OPEN : B.DOOR);
  world.set(x, y + 1, z, open ? B.DOOR_TOP_OPEN : B.DOOR_TOP);
}

test('doorParts resolves the same pair from either cell', () => {
  const w = makeEmptyWorld();
  hangDoor(w, 10, 20, 10);
  const fromBase = doorParts(w, 10, 20, 10);
  const fromTop = doorParts(w, 10, 21, 10);
  for (const p of [fromBase, fromTop]) {
    assert.deepEqual([p.base.x, p.base.y, p.base.z, p.base.id], [10, 20, 10, B.DOOR]);
    assert.deepEqual([p.top.x, p.top.y, p.top.z, p.top.id], [10, 21, 10, B.DOOR_TOP]);
  }
  assert.equal(doorParts(w, 10, 22, 10), null, 'air is not a door');
  w.set(30, 20, 30, B.STONE);
  assert.equal(doorParts(w, 30, 20, 30), null, 'stone is not a door');
});

test('toggling from either cell swaps both halves, and an open door is passable throughout', () => {
  const w = makeEmptyWorld();
  hangDoor(w, 10, 20, 10);
  assert.ok(BLOCKS[w.get(10, 20, 10)].solid && BLOCKS[w.get(10, 21, 10)].solid, 'closed door blocks both cells');

  toggleDoor(w, 10, 21, 10); // clicked the upper half
  assert.equal(w.get(10, 20, 10), B.DOOR_OPEN);
  assert.equal(w.get(10, 21, 10), B.DOOR_TOP_OPEN);
  assert.ok(!BLOCKS[w.get(10, 20, 10)].solid && !BLOCKS[w.get(10, 21, 10)].solid, 'open door passable at head height too');

  toggleDoor(w, 10, 20, 10); // and back from the lower half
  assert.equal(w.get(10, 20, 10), B.DOOR);
  assert.equal(w.get(10, 21, 10), B.DOOR_TOP);
});

test('breaking either door cell clears both and yields one door item', () => {
  for (const clicked of [20, 21]) {
    const w = makeEmptyWorld();
    hangDoor(w, 10, 20, 10);
    const drop = breakPair(w, 10, clicked, 10);
    assert.equal(drop, 'b:' + B.DOOR);
    assert.equal(w.get(10, 20, 10), B.AIR, `base cleared (clicked y=${clicked})`);
    assert.equal(w.get(10, 21, 10), B.AIR, `top cleared (clicked y=${clicked})`);
  }
});

test('a legacy 1-tall door toggles and breaks without touching the block above', () => {
  const w = makeEmptyWorld();
  w.set(10, 20, 10, B.DOOR);
  w.set(10, 21, 10, B.STONE);        // old save: no headroom, no upper half
  const p = doorParts(w, 10, 20, 10);
  assert.equal(p.top.id, B.STONE, 'pair still resolves, top is not a door');

  toggleDoor(w, 10, 20, 10);
  assert.equal(w.get(10, 20, 10), B.DOOR_OPEN);
  assert.equal(w.get(10, 21, 10), B.STONE, 'the stone above is left alone');

  assert.equal(breakPair(w, 10, 20, 10), 'b:' + B.DOOR);
  assert.equal(w.get(10, 20, 10), B.AIR);
  assert.equal(w.get(10, 21, 10), B.STONE, 'break never eats the neighbor cell');
});

test('yawToCardinal follows the camera forward vector (-sin yaw, -cos yaw)', () => {
  assert.deepEqual(yawToCardinal(0), [0, -1]);
  assert.deepEqual(yawToCardinal(Math.PI), [0, 1]);
  assert.deepEqual(yawToCardinal(Math.PI / 2), [-1, 0]);
  assert.deepEqual(yawToCardinal(-Math.PI / 2), [1, 0]);
  // off-axis yaws snap to the dominant component
  assert.deepEqual(yawToCardinal(0.4), [0, -1]);
  assert.deepEqual(yawToCardinal(Math.PI / 2 + 0.4), [-1, 0]);
});

test('bedHeadFor and BED_DIR round-trip every cardinal', () => {
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const head = bedHeadFor(dx, dz);
    assert.deepEqual(BED_DIR[head], [dx, dz], `head ${head} points ${dx},${dz}`);
  }
  assert.equal(bedHeadFor(0, 1), B.BED, 'the plain BED id is the +z head');
});

test('all four orientations put the foot on the expected cell', () => {
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const w = makeEmptyWorld();
    const head = bedHeadFor(dx, dz);
    w.set(10, 20, 10, head);
    w.set(10 + dx, 20, 10 + dz, B.BED_FOOT);
    const p = bedParts(w, 10, 20, 10);
    assert.deepEqual([p.foot.x, p.foot.y, p.foot.z], [10 + dx, 20, 10 + dz]);
    assert.equal(p.foot.id, B.BED_FOOT);
    assert.deepEqual(bedParts(w, 10 + dx, 20, 10 + dz).head, { x: 10, y: 20, z: 10, id: head },
      'the foot resolves back to its own head');
  }
});

test('a foot between two parallel beds resolves its own head', () => {
  const w = makeEmptyWorld();
  w.set(10, 5, 10, B.BED); w.set(10, 5, 11, B.BED_FOOT);   // bed 1: head z=10, foot z=11
  w.set(10, 5, 12, B.BED); w.set(10, 5, 13, B.BED_FOOT);   // bed 2 right behind it
  const p = bedParts(w, 10, 5, 11);
  assert.deepEqual([p.head.x, p.head.y, p.head.z], [10, 5, 10], 'never claims the neighboring head');
  assert.deepEqual([bedParts(w, 10, 5, 13).head.x, bedParts(w, 10, 5, 13).head.z], [10, 12]);
});

test('breaking either bed cell clears both and yields one bed item', () => {
  for (const clicked of [[10, 10], [10, 11]]) {
    const w = makeEmptyWorld();
    w.set(10, 5, 10, B.BED); w.set(10, 5, 11, B.BED_FOOT);
    assert.equal(breakPair(w, clicked[0], 5, clicked[1]), 'b:' + B.BED);
    assert.equal(w.get(10, 5, 10), B.AIR);
    assert.equal(w.get(10, 5, 11), B.AIR);
  }
});

test('an orphaned bed foot removes only itself', () => {
  const w = makeEmptyWorld();
  w.set(10, 5, 11, B.BED_FOOT);
  w.set(10, 5, 10, B.STONE);
  const p = bedParts(w, 10, 5, 11);
  assert.equal(p.head, null);
  assert.equal(breakPair(w, 10, 5, 11), 'b:' + B.BED);
  assert.equal(w.get(10, 5, 11), B.AIR);
  assert.equal(w.get(10, 5, 10), B.STONE);
});

test('old saves grow their second cell only where it is free', () => {
  const w = makeEmptyWorld();
  w.set(10, 20, 10, B.DOOR);          // clear headroom -> grows
  w.set(14, 20, 10, B.DOOR_OPEN);     // clear headroom -> grows, open
  w.set(18, 20, 10, B.DOOR);          // boarded transom -> stays short
  w.set(18, 21, 10, B.WOOD_WALL);
  w.set(10, 20, 20, B.BED);           // clear floor at +z -> grows
  w.set(10, 20, 24, B.BED);           // wall at +z -> stays short
  w.set(10, 20, 25, B.STONE);

  const plan = upgradeEditsPlan(w, w.edits);
  assert.deepEqual(plan.sort((a, b) => a.x - b.x || a.z - b.z), [
    { x: 10, y: 21, z: 10, id: B.DOOR_TOP },
    { x: 10, y: 20, z: 21, id: B.BED_FOOT },
    { x: 14, y: 21, z: 10, id: B.DOOR_TOP_OPEN },
  ]);

  for (const u of plan) w.set(u.x, u.y, u.z, u.id);
  assert.equal(doorParts(w, 10, 20, 10).top.id, B.DOOR_TOP);
  assert.equal(bedParts(w, 10, 20, 20).foot.id, B.BED_FOOT);
  assert.equal(w.get(18, 21, 10), B.WOOD_WALL, 'a blocked door is left legacy-short');
  assert.equal(w.get(10, 20, 25), B.STONE, 'a blocked bed is left legacy-short');
});
