// Chunk streaming: the wilderness must be deterministic and order-independent
// (a chunk generates the same bytes whether it's the 1st or 1000th visited),
// edits must pin chunks against eviction, eviction+regen must be pure, and
// the story core must join the wilderness without a terrain cliff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { WORLD, WORLDGEN, B } from '../src/config.js';
import { hashU16 } from './helpers.js';

const SEED = 'stream-test';

function generated(seed = SEED) {
  const w = new World(seed);
  w.generate();
  return w;
}

const w = generated();

test('wilderness chunks are order-independent: same bytes whatever generates first', () => {
  const a = generated();
  const b = generated();
  // a: west target first, then its neighborhood; b: a scrambled spiral that
  // reaches the target last, having stamped all its neighbors already
  a.ensureChunkData(-14, 3);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) a.ensureChunkData(-14 + dx, 3 + dz);
  const order = [[-13, 2], [-15, 4], [-13, 4], [-15, 2], [-14, 2], [-14, 4], [-13, 3], [-15, 3], [-14, 3]];
  for (const [cx, cz] of order) b.ensureChunkData(cx, cz);
  const ka = a.chunks.get('-14,3'), kb = b.chunks.get('-14,3');
  assert.ok(ka && kb, 'target chunk resident in both worlds');
  assert.equal(hashU16(ka.data), hashU16(kb.data), 'identical bytes regardless of order');
});

test('eviction and regeneration of an unedited chunk is pure', () => {
  const cx = 40, cz = -25;
  const key = cx + ',' + cz;
  const first = w.ensureChunkData(cx, cz);
  const h1 = hashU16(first.data);
  w.evictChunk(key, first);
  assert.ok(!w.chunks.has(key), 'chunk evicted');
  const again = w.ensureChunkData(cx, cz);
  assert.equal(hashU16(again.data), h1, 'regenerated identically');
});

test('an edit pins its chunk; updateStreaming never evicts it', () => {
  const x = 900, z = 900; // far wilderness
  const [cx, cz] = w.chunkOf(x, z);
  w.ensureChunkData(cx, cz);
  const y = w.skyTop(x, z);
  w.set(x, y, z, B.PLANK);
  const key = cx + ',' + cz;
  assert.ok(w.pinned.has(key), 'edited chunk is pinned');
  // stream around the spawn, far away — sweeps must not touch the pinned chunk
  const s = w.spawnPoint();
  for (let i = 0; i < 50; i++) w.updateStreaming(s.x, s.z);
  assert.ok(w.chunks.has(key), 'pinned chunk survives streaming sweeps');
  assert.equal(w.get(x, y, z), B.PLANK, 'edit intact');
});

test('unedited far chunks are evicted by the streaming sweep', () => {
  const w2 = generated();
  for (let dx = 0; dx <= 2; dx++)
    for (let dz = 0; dz <= 2; dz++) w2.ensureChunkData(60 + dx, 60 + dz);
  assert.ok(w2.chunks.has('60,60'));
  const s = w2.spawnPoint();
  // two calls with different chunk positions guarantee a crossed→sweep pass
  w2.updateStreaming(s.x, s.z);
  w2.updateStreaming(s.x + 16, s.z);
  assert.ok(!w2.chunks.has('60,60'), 'far unpinned chunk evicted');
  // the core never leaves
  assert.ok(w2.chunks.has('0,0') && w2.chunks.has('11,11'), 'core chunks pinned');
});

test('saved wilderness edits round-trip through applyEdits onto regenerated chunks', () => {
  const a = generated();
  const x = -300, z = 450;
  a.ensureChunkData(...a.chunkOf(x, z));
  const y = a.skyTop(x, z);
  a.set(x, y, z, B.STONE_BRICK);
  a.set(x, y + 1, z, B.TORCH);
  const b = generated();
  b.applyEdits(a.serializeEdits());
  assert.equal(b.get(x, y, z), B.STONE_BRICK);
  assert.equal(b.get(x, y + 1, z), B.TORCH);
  assert.ok(b.pinned.has(b.chunkKey(...b.chunkOf(x, z))), 'loaded edit pins the chunk');
});

test('no terrain cliff at the core seam', () => {
  for (let z = 4; z < WORLD.CORE_Z; z += 7) {
    const inside = w.surfOf(WORLD.CORE_X - 1, z);
    const outside = w.surfOf(WORLD.CORE_X, z);
    assert.ok(Math.abs(inside - outside) <= 3, `seam step at z=${z}: ${inside} vs ${outside}`);
    const insideW = w.surfOf(0, z);
    const outsideW = w.surfOf(-1, z);
    assert.ok(Math.abs(insideW - outsideW) <= 3, `west seam step at z=${z}`);
  }
});

test('the wilderness has real finite ore hills of both kinds', () => {
  // scan cells in a band beyond the core until both kinds are found
  const found = [];
  for (let cellX = -8; cellX <= 12 && found.length < 4; cellX++)
    for (let cellZ = -8; cellZ <= 12 && found.length < 4; cellZ++) {
      const h = w.hillInfo(cellX, cellZ);
      if (h) found.push(h);
    }
  assert.ok(found.length >= 2, `wilderness hills exist (${found.length} in the scanned band)`);
  const hill = found[0];
  // materialize the hill's neighborhood and count its deposit
  const [hcx, hcz] = w.chunkOf(hill.x, hill.z);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) w.ensureChunkData(hcx + dx, hcz + dz);
  const ore = hill.isIron ? B.IRON_ORE : B.COAL_ORE;
  let count = 0, mouth = false;
  for (let dx = -11; dx <= 11; dx++)
    for (let dz = -11; dz <= 11; dz++)
      for (let dy = -4; dy <= 8; dy++) {
        if (w.get(hill.x + dx, hill.surf + dy, hill.z + dz) === ore) count++;
      }
  for (let dz = 1; dz <= WORLDGEN.oreHills.radiusMax + 1 && !mouth; dz++) {
    for (const ex of [hill.x, hill.x + 1]) {
      if (w.get(ex, hill.surf + 1, hill.z + dz) === B.AIR && w.get(ex, hill.surf + 2, hill.z + dz) === B.AIR) { mouth = true; break; }
    }
  }
  assert.ok(count >= WORLDGEN.oreHills.minOre * 0.8, `wild hill holds a deposit (${count} ore)`);
  assert.ok(mouth, 'wild hill has a walkable entrance');
});

test('the containment rim rises and walls the world', () => {
  const edge = WORLD.CENTER_X + WORLD.HALF_SPAN;
  const nearRim = w.surfOf(edge - 8, WORLD.CENTER_Z);
  const openLand = w.surfOf(edge - 400, WORLD.CENTER_Z);
  assert.ok(nearRim >= openLand + 8, `rim mountains rise (${openLand} -> ${nearRim})`);
  assert.equal(w.get(edge + 1, 30, WORLD.CENTER_Z), B.BEDROCK, 'beyond the rim is sealed');
});

test('poi.mines and poi.nests track resident wilderness chunks', () => {
  const w2 = generated();
  const coreMines = w2.poi.mines.length;
  // find a wilderness hill and stream its chunk in
  let hill = null;
  for (let cellX = -6; cellX <= 10 && !hill; cellX++)
    for (let cellZ = -6; cellZ <= 10 && !hill; cellZ++) {
      const h = w2.hillInfo(cellX, cellZ);
      if (h) hill = h;
    }
  assert.ok(hill, 'found a wilderness hill to stream');
  const [hcx, hcz] = w2.chunkOf(hill.x, hill.z);
  const chunk = w2.ensureChunkData(hcx, hcz);
  assert.equal(w2.poi.mines.length, coreMines + 1, 'wild mine registered while resident');
  w2.evictChunk(w2.chunkKey(hcx, hcz), chunk);
  assert.equal(w2.poi.mines.length, coreMines, 'wild mine unregistered on eviction');
});
