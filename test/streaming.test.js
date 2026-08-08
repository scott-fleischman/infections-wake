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

// ---------------- review regressions (2026-08-08 streamed-world audit) ----

test('scanWorld re-registers wilderness emitters (edit-pinned chunks survive load)', async () => {
  const { Signature } = await import('../src/signature.js');
  const w2 = generated('sig-wild');
  // a player campfire 700 blocks out, applied exactly the way a reload does
  const ex = 700, ey = 30, ez = 700;
  w2.applyEdits([[ex, ey, ez, B.CAMPFIRE]]);
  const sig = new Signature({ world: w2 });
  sig.scanWorld();
  assert.ok(sig.staticEm.has(`${ex},${ey},${ez}`),
    'player-placed wilderness campfire is registered after scanWorld');

  // a streamed chunk with a generated nest keeps its emitters through a rescan
  let nest = null;
  for (let cx = 14; cx < 120 && !nest; cx++)
    for (let cz = 14; cz < 40 && !nest; cz++) {
      const stamp = w2.featureStamp(cx, cz);
      if (stamp.nests.length) { w2.ensureChunkData(cx, cz); nest = stamp.nests[0]; }
    }
  assert.ok(nest, 'search window contains at least one stamped nest');
  sig.scanWorld();
  assert.ok(sig.staticEm.has(`${nest.x},${nest.y},${nest.z}`),
    'streamed nest emitter survives scanWorld');
});

test('active-assault mobs are exempt from the distance despawn', async () => {
  const { InfectedManager } = await import('../src/infected.js');
  const { Signature } = await import('../src/signature.js');
  const { makeStubGame } = await import('./helpers.js');
  const w2 = generated('despawn-siege');
  const game = makeStubGame({ world: w2 });
  game.player.pos.set(96, 30, 96);
  game.sig = new Signature(game);
  game.director = { assaultActive: true };
  const inf = new InfectedManager(game);
  game.infected = inf;
  const sieger = inf.spawn('drifter', 400, 30, 400, { fromAssault: true });
  const stray = inf.spawn('drifter', 410, 30, 410, {});
  inf.update(0.05);
  assert.ok(!sieger.dead, 'assault member 300 blocks out survives while the assault runs');
  assert.ok(stray.dead, 'ordinary wanderer at the same range still despawns');
  game.director.assaultActive = false;
  inf.update(0.05);
  assert.ok(sieger.dead, 'a leftover sieger is reclaimed once the assault ends');
});

test('a body in a not-yet-streamed chunk freezes instead of levitating', async () => {
  const { InfectedManager } = await import('../src/infected.js');
  const { Signature } = await import('../src/signature.js');
  const { makeStubGame } = await import('./helpers.js');
  const w2 = generated('freeze-far');
  const game = makeStubGame({ world: w2 });
  game.player.pos.set(96, 30, 96);
  game.sig = new Signature(game);
  game.director = { assaultActive: true };
  const inf = new InfectedManager(game);
  game.infected = inf;
  // restored from a save far outside the generation ring: its chunk is absent,
  // so get() serves BEDROCK stand-ins — the body must hold position, not rise
  const host = inf.spawn('drifter', 400, 30, 400, { fromAssault: true });
  const y0 = host.pos.y;
  for (let i = 0; i < 20; i++) inf.update(0.05);
  assert.equal(host.pos.y, y0, 'no ceiling levitation on bedrock stand-ins');
  // once the ground streams in it settles onto terrain (up or down —
  // the column may hold an ore-hill dome) and stays put
  w2.ensureChunkData(Math.floor(400 / WORLD.CHUNK), Math.floor(400 / WORLD.CHUNK));
  for (let i = 0; i < 20; i++) inf.update(0.05);
  const y1 = host.pos.y;
  for (let i = 0; i < 20; i++) inf.update(0.05);
  assert.ok(Math.abs(host.pos.y - y1) < 2.5, 'settled on terrain, not ratcheting upward');
  assert.ok(host.pos.y < WORLD.HEIGHT - 8, 'nowhere near the world ceiling');
});

test('no wilderness trunks within 2 blocks of the story core (canopy seam guard)', () => {
  const { CORE_X, CORE_Z } = WORLD;
  for (let z = -2; z < CORE_Z + 2; z++)
    for (const x of [-2, -1, CORE_X, CORE_X + 1])
      assert.equal(w.treeAt(x, z), false, `no trunk at ${x},${z}`);
  for (let x = -2; x < CORE_X + 2; x++)
    for (const z of [-2, -1, CORE_Z, CORE_Z + 1])
      assert.equal(w.treeAt(x, z), false, `no trunk at ${x},${z}`);
});
