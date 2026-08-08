// Ore hills (wishlist #4): worldgen invariants across seeds. Each hill must
// be a real, findable, finite deposit — enough ore, some of it visible from
// outside, well clear of the story structures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { WORLD, WORLDGEN, B } from '../src/config.js';

const SEEDS = ['wake-mines-a', 'wake-mines-b', 'wake-mines-c'];

function oreNear(w, m, radius = 11) {
  const ore = m.kind === 'iron' ? B.IRON_ORE : B.COAL_ORE;
  let count = 0, exposed = 0;
  for (let dx = -radius; dx <= radius; dx++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dy = -4; dy <= 8; dy++) {
        const x = m.x + dx, y = m.y + dy, z = m.z + dz;
        if (w.get(x, y, z) !== ore) continue;
        count++;
        for (const [ox, oy, oz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          if (w.get(x + ox, y + oy, z + oz) === B.AIR) { exposed++; break; }
        }
      }
  return { count, exposed };
}

for (const seed of SEEDS) {
  test(`ore hills are real deposits (seed ${seed})`, () => {
    const w = new World(seed);
    w.generate();
    const mines = w.poi.mines;
    const want = Math.round(WORLDGEN.oreHills.count * WORLD.CORE_AREA_SCALE);
    assert.ok(mines.length >= want * 0.6, `enough hills placed: ${mines.length}/${want}`);
    assert.ok(mines.some(m => m.kind === 'iron') && mines.some(m => m.kind === 'coal'),
      'both ore kinds represented');

    for (const m of mines) {
      assert.ok(m.x > 4 && m.x < WORLD.CORE_X - 4 && m.z > 4 && m.z < WORLD.CORE_Z - 4, 'in the core');
      const { count, exposed } = oreNear(w, m);
      assert.ok(count >= WORLDGEN.oreHills.minOre * 0.8,
        `hill at ${m.x},${m.z} holds a real deposit (${count} ore)`);
      assert.ok(exposed >= 3,
        `deposit at ${m.x},${m.z} is visible/reachable (${exposed} exposed faces)`);
    }

    // hills keep their distance from each other and from the story structures
    for (let i = 0; i < mines.length; i++)
      for (let j = i + 1; j < mines.length; j++) {
        const d = Math.hypot(mines[i].x - mines[j].x, mines[i].z - mines[j].z);
        assert.ok(d >= WORLDGEN.oreHills.spacing - 1, `hills ${i},${j} spaced (${d.toFixed(0)})`);
      }
    const structures = [
      [w.poi.spawn.x, w.poi.spawn.z], [w.poi.lab.x, w.poi.lab.z],
      [w.poi.ruin.x, w.poi.ruin.z], [w.poi.annex.x, w.poi.annex.z],
      [w.poi.transit.x, w.poi.transit.z], [w.poi.settlement.x, w.poi.settlement.z],
    ];
    for (const m of mines)
      for (const [sx, sz] of structures) {
        const d = Math.hypot(m.x - sx, m.z - sz);
        assert.ok(d >= 14, `hill at ${m.x},${m.z} clear of structure at ${sx},${sz} (${d.toFixed(0)})`);
      }
  });
}

test('each hill chamber is enterable: a 2-tall air mouth exists on the south face', () => {
  const w = new World(SEEDS[0]);
  w.generate();
  for (const m of w.poi.mines) {
    let mouth = false;
    for (let dz = 1; dz <= WORLDGEN.oreHills.radiusMax + 1 && !mouth; dz++) {
      for (const ex of [m.x, m.x + 1]) {
        if (w.get(ex, m.y + 1, m.z + dz) === B.AIR && w.get(ex, m.y + 2, m.z + dz) === B.AIR) { mouth = true; break; }
      }
    }
    assert.ok(mouth, `hill at ${m.x},${m.z} has a walkable entrance`);
  }
});
