// World generation: deterministic per seed, POIs present and in bounds,
// unique archive fragments, colony seam contents, and edit round-tripping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { WORLD, B } from '../src/config.js';
import { hashU16 } from './helpers.js';

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
  assert.equal(w.data.length, w2.data.length);
  assert.equal(hashU16(w.data), hashU16(w2.data));
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
  const counts = { [B.ARCHIVE_1]: 0, [B.ARCHIVE_2]: 0, [B.ARCHIVE_3]: 0 };
  for (let i = 0; i < w.data.length; i++) {
    if (w.data[i] in counts) counts[w.data[i]]++;
  }
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
  assert.equal(hashU16(a.data), hashU16(b.data));
});

test('set() tracks edits and re-serializes the same diff', () => {
  const a = generated();
  a.set(10, 45, 10, B.LAMP);
  a.set(10, 45, 10, B.AIR); // overwrite: diff keeps only the latest value
  const arr = a.serializeEdits();
  assert.equal(arr.length, 1);
  assert.deepEqual(arr[0], [10, 45, 10, B.AIR]);
});

test('get() outside the grid returns containing walls', () => {
  assert.equal(w.get(-1, 10, 0), B.BEDROCK);
  assert.equal(w.get(0, -1, 0), B.BEDROCK);
  assert.equal(w.get(0, WORLD.HEIGHT, 0), B.AIR);
  assert.equal(w.get(WORLD.SIZE_X, 10, 0), B.BEDROCK);
});
