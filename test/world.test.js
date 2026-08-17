// World generation: deterministic per seed, POIs present and in bounds,
// unique archive fragments, colony seam contents, and edit round-tripping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { WORLD, B } from '../src/config.js';
import { hashWorld, countBlocks } from './helpers.js';

function generated(seed = 'test-seed') {
  const w = new World(seed);
  w.generate();
  return w;
}

// one shared instance for the read-only assertions (generation is the
// expensive part; ~1s total for the file is fine)
const w = generated();

test('same seed generates byte-identical block data', () => {
  const w2 = generated();
  assert.equal(w.chunks.size, w2.chunks.size);
  assert.equal(hashWorld(w), hashWorld(w2));
});

test('POIs exist and are in bounds', () => {
  for (const key of ['lab', 'colony', 'spawn', 'emergency']) {
    const p = w.poi[key];
    assert.ok(p, `poi.${key} missing`);
    assert.ok(w.inBounds(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
      `poi.${key} out of bounds: ${p.x},${p.y},${p.z}`);
  }
});

test('each archive block appears exactly once', () => {
  const counts = countBlocks(w, [B.ARCHIVE_1, B.ARCHIVE_2, B.ARCHIVE_3]);
  assert.equal(counts[B.ARCHIVE_1], 1, 'ARCHIVE_1 count');
  assert.equal(counts[B.ARCHIVE_2], 1, 'ARCHIVE_2 count');
  assert.equal(counts[B.ARCHIVE_3], 1, 'ARCHIVE_3 count');
});

test('colony pocket holds COLONY blocks with IRON_ORE behind the seam', () => {
  const { x: cx, y: cy, z: cz } = w.poi.colony;
  let colony = 0, iron = 0;
  for (let x = cx - 5; x <= cx + 8; x++)
    for (let z = cz - 5; z <= cz + 5; z++)
      for (let y = cy - 4; y <= cy + 4; y++) {
        const id = w.get(x, y, z);
        if (id === B.COLONY) colony++;
        if (id === B.IRON_ORE) iron++;
      }
  assert.ok(colony > 0, 'no COLONY blocks near poi.colony');
  assert.ok(iron > 0, 'no IRON_ORE near the colony seam');
});

test('spawn refuge stands on solid ground with air above', () => {
  const s = w.poi.spawn;
  const x = Math.floor(s.x), y = Math.floor(s.y), z = Math.floor(s.z);
  assert.equal(w.get(x, y, z), B.AIR, 'spawn cell should be air');
  assert.notEqual(w.get(x, y - 1, z), B.AIR, 'block under spawn should be solid');
});

test('serializeEdits/applyEdits round-trips edits onto a fresh same-seed world', () => {
  const a = generated();
  const edits = [
    [5, 30, 5, B.PLANK],
    [64, 40, 64, B.STONE_BRICK],
    [100, 10, 100, B.AIR],
    [30, 25, 90, B.IRON_BLOCK],
  ];
  for (const [x, y, z, id] of edits) a.set(x, y, z, id);
  const serialized = a.serializeEdits();
  assert.equal(serialized.length, edits.length);

  const b = generated();
  b.applyEdits(serialized);
  for (const [x, y, z, id] of edits) {
    assert.equal(b.get(x, y, z), id, `edited cell ${x},${y},${z}`);
  }
  // full grids now agree byte-for-byte
  assert.equal(hashWorld(a), hashWorld(b));
});

test('set() tracks edits and re-serializes the same diff', () => {
  const a = generated();
  a.set(10, 45, 10, B.LAMP);
  a.set(10, 45, 10, B.AIR); // overwrite: diff keeps only the latest value
  const arr = a.serializeEdits();
  assert.equal(arr.length, 1);
  assert.deepEqual(arr[0], [10, 45, 10, B.AIR]);
});

// ---------------- starting refuge (2026-08-17) ----------------
// The refuge grew from a 5x5 shack in a thicket to a 9x9 shack standing in a
// cleared glade. Generation is the expensive part, so the extra seeds are
// materialized once here and shared by the assertions below.
const refuges = ['refuge-a', 'refuge-b', 'refuge-c'].map(generated);

test('the refuge is cleared of trees for 10 blocks in every direction', () => {
  for (const rw of refuges) {
    const s = rw.poi.spawn;
    const sx = Math.floor(s.x), sz = Math.floor(s.z);
    for (let dx = -10; dx <= 10; dx++)
      for (let dz = -10; dz <= 10; dz++) {
        if (Math.hypot(dx, dz) > 10) continue;
        const x = sx + dx, z = sz + dz;
        for (let y = 0; y < WORLD.HEIGHT; y++) {
          const id = rw.get(x, y, z);
          assert.notEqual(id, B.LOG, `log at ${x},${y},${z}`);
          assert.notEqual(id, B.LEAVES, `leaves at ${x},${y},${z}`);
        }
      }
  }
});

test('the refuge shack is 9x9 and stands 4 high', () => {
  const s = refuges[0].poi.spawn;
  const sx = Math.floor(s.x), sz = Math.floor(s.z), surf = s.y - 1;
  // the north wall runs the full 9-block span, broken only by the 2-wide doorway
  let wall = 0;
  for (let x = sx - 4; x <= sx + 4; x++)
    if (refuges[0].get(x, surf + 1, sz - 4) === B.WOOD_WALL) wall++;
  assert.equal(wall, 7, `9 timbers less the 2-cell doorway, found ${wall}`);
  assert.equal(refuges[0].get(sx - 4, surf + 4, sz - 4), B.WOOD_WALL, 'walls stand 4 high');
  // and the interior is genuinely open floor, not the old 3x3 closet
  assert.equal(refuges[0].get(sx - 3, surf + 1, sz - 3), B.AIR, 'interior corner is open');
});

test('the shack crate is recorded in poi so the game can register it as a container', () => {
  // worldgen writes the crate with _set(), which bypasses Game.placeBlock() —
  // the only thing that adds an entry to game.chests. Without this poi record
  // setupWorld has nothing to adopt and the crate is a dead [F] prompt.
  for (const rw of refuges) {
    const c = rw.poi.crate;
    assert.ok(c, 'placeStartRefuge records the crate cell');
    assert.equal(rw.get(c.x, c.y, c.z), B.CHEST, 'and the cell really holds the crate');
  }
});

test('the emergency recovery pad cell stays clear inside the bigger shack', () => {
  for (const rw of refuges) {
    const e = rw.poi.emergency;
    assert.equal(rw.get(e.x, e.y, e.z), B.AIR, 'the pad cell must be empty');
    assert.equal(rw.get(e.x, e.y + 1, e.z), B.AIR, 'and so must its headroom');
  }
});

test('growing the refuge does not disturb the index-stable pickup list', () => {
  // pickupsTaken in the save file is a Set of INDICES into world.pickups, so
  // the glade sweep must clear blocks only — never touch this list.
  const a = refuges[0];
  const b = generated('refuge-a');
  assert.equal(a.pickups.length, b.pickups.length, 'worldgen stays deterministic');
  assert.ok(a.pickups.length > 0);
  for (let i = 0; i < a.pickups.length; i++) assert.deepEqual(a.pickups[i], b.pickups[i], `pickup ${i}`);
});

test('the get() contract: vertical caps, unstreamed chunks, and the rim', () => {
  assert.equal(w.get(0, -1, 0), B.BEDROCK, 'below the world is bedrock');
  assert.equal(w.get(0, WORLD.HEIGHT, 0), B.AIR, 'above the world is air');
  // un-streamed wilderness reads as solid (nothing falls through), until
  // the chunk generates and becomes real terrain
  assert.equal(w.get(-1, 10, 0), B.BEDROCK, 'unstreamed chunk reads solid');
  w.ensureChunkData(-1, 0);
  assert.notEqual(w.get(-8, w.surfOf(-8, 8), 8), B.BEDROCK, 'streamed-in wilderness is real terrain');
  // beyond the containment rim is bedrock forever, resident chunk or not
  const beyond = WORLD.CENTER_X + WORLD.HALF_SPAN + 1;
  assert.equal(w.get(beyond, 10, 0), B.BEDROCK, 'beyond the rim is walled');
});
