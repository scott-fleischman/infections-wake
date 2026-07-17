// Full-game worldgen (§4.3, §17–18): every new region generates with its
// contract intact — on multiple seeds, since structure placement negotiates
// with real terrain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { B } from '../src/config.js';

for (const seed of ['alpha', 'wake-42', 'zzz']) {
  test(`[seed ${seed}] all full-game POIs generate`, () => {
    const w = new World(seed);
    w.generate();
    for (const k of ['nests', 'ruin', 'annex', 'settlement', 'transit', 'deep', 'reservoirs', 'labTunnel'])
      assert.ok(w.poi[k], `poi.${k} exists`);
    assert.ok(w.poi.nests.length >= 1, 'at least one cave nest');
    assert.equal(w.poi.reservoirs.length, 2, 'two secondary reservoirs');
  });

  test(`[seed ${seed}] transit station: hull, panel, gate, duty log`, () => {
    const w = new World(seed);
    w.generate();
    const t = w.poi.transit;
    assert.equal(w.get(t.panel.x, t.panel.y, t.panel.z), B.TRANSIT_PANEL);
    assert.equal(w.get(t.gate.x, t.gate.y, t.gate.z), B.TRANSIT_GATE);
    // ARCHIVE_4 sits between them on the north wall
    assert.equal(w.get(t.x, t.surf + 1, t.z - 1), B.ARCHIVE_4);
    // the doorway is passable
    assert.equal(w.get(t.x, t.surf + 1, t.z + 2), B.AIR);
    assert.equal(w.get(t.x, t.surf + 2, t.z + 2), B.AIR);
  });

  test(`[seed ${seed}] deep site: entry standable, 3 sequential valves, gate home, tissue clusters, Venn's note`, () => {
    const w = new World(seed);
    w.generate();
    const d = w.poi.deep;
    assert.equal(d.valves.length, 3);
    assert.deepEqual(d.valves.map(v => v.index).sort(), [1, 2, 3]);
    for (const v of d.valves) assert.equal(w.get(v.x, v.y, v.z), B.VALVE, `valve ${v.index} placed`);
    // entry cell is standable (feet+head air, floor below)
    assert.equal(w.get(d.entry.x, d.entry.y, d.entry.z), B.AIR);
    assert.equal(w.get(d.entry.x, d.entry.y + 1, d.entry.z), B.AIR);
    assert.notEqual(w.get(d.entry.x, d.entry.y - 1, d.entry.z), B.AIR);
    // the return gate exists in the entry hall
    assert.equal(w.get(d.gate.x, d.gate.y, d.gate.z), B.TRANSIT_GATE);
    // doorways between all five rooms are open at the walk line
    for (const wx of [86, 94, 102, 110]) assert.equal(w.get(wx, d.floor, 14), B.AIR, `doorway open at x=${wx}`);
    // tissue clusters populate the vault
    assert.equal(d.clusters.length, 5);
    const total = d.clusters.reduce((a, c) => a + c.cells.length, 0);
    assert.ok(total >= 20, `substantial reservoir growth (${total} cells)`);
    for (const c of d.clusters)
      for (const [x, y, z] of c.cells) assert.equal(w.get(x, y, z), B.RESERVOIR_TISSUE);
    // Venn's remains note in gallery one
    assert.equal(w.get(88, d.floor, 18), B.ARCHIVE_5);
    // continuity core cache pickup in the vault
    assert.ok(w.pickups.some(p => p.item === 'continuity_core'), 'vault holds a continuity core');
  });

  test(`[seed ${seed}] industrial ruin holds the kiln and salvageable scrap`, () => {
    const w = new World(seed);
    w.generate();
    const r = w.poi.ruin;
    assert.equal(w.get(r.kiln.x, r.kiln.y, r.kiln.z), B.KILN);
    let scrap = 0;
    for (let x = r.x - 6; x <= r.x + 6; x++)
      for (let z = r.z - 5; z <= r.z + 5; z++)
        for (let y = r.surf; y <= r.surf + 3; y++)
          if (w.get(x, y, z) === B.SCRAP) scrap++;
    assert.ok(scrap >= 3, `machine scrap to salvage (${scrap})`);
  });

  test(`[seed ${seed}] flooded annex is drowned and stocks filtration`, () => {
    const w = new World(seed);
    w.generate();
    const a = w.poi.annex;
    assert.equal(w.get(Math.floor(a.hostSpawn.x), a.hostSpawn.y, Math.floor(a.hostSpawn.z)), B.WATER, 'host spawns underwater');
    // headroom strip above the water line
    assert.equal(w.get(a.x0 + 1, a.floor + a.h - 1, a.z0 + 1), B.AIR, 'air pocket at the ceiling');
    const filters = w.pickups.filter(p => p.item === 'filter_unit').reduce((s, p) => s + p.n, 0);
    assert.ok(filters >= 3, `filtration cartridges stocked (${filters})`);
  });

  test(`[seed ${seed}] lab service tunnel gives a diggable second route (§11.2)`, () => {
    const w = new World(seed);
    w.generate();
    const t = w.poi.labTunnel;
    // the shaft is gravel from lab floor to the surface — a dig route
    assert.equal(w.get(t.x, w.poi.lab.floor + 2, t.z), B.GRAVEL);
    // the west bulkhead breach is open
    const L = w.poi.lab;
    assert.equal(w.get(L.x0 - 1, L.floor, L.z0 + Math.floor(L.d / 2)), B.AIR);
  });

  test(`[seed ${seed}] secondary reservoirs hold nests + tissue with a shaft hint`, () => {
    const w = new World(seed);
    w.generate();
    for (const r of w.poi.reservoirs) {
      assert.equal(w.get(r.x, r.y - 1, r.z), B.NEST, `${r.id} nest core`);
      let tissue = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (w.get(r.x + dx, r.y - 1, r.z + dz) === B.RESERVOIR_TISSUE) tissue++;
      assert.ok(tissue >= 2, `${r.id} tissue ring`);
    }
  });

  test(`[seed ${seed}] the shack radio is present (§15.8)`, () => {
    const w = new World(seed);
    w.generate();
    const s = w.poi.spawn;
    assert.equal(w.get(Math.floor(s.x) + 1, s.y, Math.floor(s.z)), B.RADIO);
  });
}
