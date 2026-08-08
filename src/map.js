import { WORLD, B } from './config.js';

// The valley map [M] (§16.2–16.3 map annotations, §13.4 body markers).
// The world is now effectively unbounded, so the map is a player-centered
// window: real loaded terrain where chunks are resident, pure-terrain
// estimates beyond (streamed worldgen is a deterministic function of
// position, so the estimate IS the terrain — just without player edits).
// Story POIs the run has earned clamp to the window's edge as bearings.

const VIEW = 384;   // window span in world blocks
const SCALE = 2;    // canvas pixels per block

const SURF_COLORS = {
  [B.GRASS]: [79, 122, 58], [B.SAND]: [191, 168, 120], [B.WATER]: [44, 93, 138],
  [B.STONE]: [116, 120, 127], [B.DIRT]: [90, 70, 52], [B.LEAVES]: [62, 107, 52],
  [B.LOG]: [107, 78, 46], [B.RUIN_FLOOR]: [94, 91, 86], [B.RUIN_WALL]: [110, 106, 100],
  [B.TRANSIT_HULL]: [78, 90, 98], [B.LAB_WALL]: [90, 96, 102], [B.WOOD_WALL]: [107, 84, 47],
  [B.PLANK]: [138, 106, 62], [B.STONE_BRICK]: [101, 107, 114],
  [B.IRON_ORE]: [201, 165, 138], [B.COAL_ORE]: [42, 42, 42],
};

export class ValleyMap {
  constructor(game) {
    this.game = game;
    this.canvas = null;
  }

  ensureCanvas() {
    if (this.canvas) return;
    this.canvas = document.getElementById('map-canvas');
  }

  render() {
    this.ensureCanvas();
    if (!this.canvas) return;
    const g = this.game;
    const p = g.player;
    const w = VIEW, h = VIEW;
    const x0 = Math.floor(p.pos.x) - w / 2;
    const z0 = Math.floor(p.pos.z) - h / 2;
    this.canvas.width = w * SCALE;
    this.canvas.height = h * SCALE;
    const ctx = this.canvas.getContext('2d');

    // terrain: top surface block color, shaded by height
    const img = ctx.createImageData(w, h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const wx = x0 + x, wz = z0 + z;
        let id, top;
        if (!g.world.inWorld(wx, wz)) {
          id = B.STONE; top = WORLD.HEIGHT; // the containment rim
        } else if (g.world.hasDataAt(wx, wz)) {
          top = g.world.skyTop(wx, wz);
          id = g.world.get(wx, top - 1, wz);
          if (id === B.AIR) id = B.STONE;
        } else {
          const surf = g.world.surfOf(wx, wz);
          top = surf + 1;
          id = surf + 1 <= WORLD.SEA_LEVEL ? B.WATER : g.world.terrainIdAt(wx, surf, wz, surf);
        }
        const c = SURF_COLORS[id] || [100, 100, 104];
        const shade = 0.6 + 0.4 * Math.min(1, Math.max(0, (top - 16) / 20));
        const i = (z * w + x) * 4;
        img.data[i] = c[0] * shade; img.data[i + 1] = c[1] * shade; img.data[i + 2] = c[2] * shade; img.data[i + 3] = 255;
      }
    }
    // draw scaled up
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, w * SCALE, h * SCALE);

    // annotations. `clampEdge` markers stay visible as bearings on the rim of
    // the window when their site lies beyond it.
    const poi = g.world.poi;
    const flags = g.valleyFlags;
    const mark = (wx, wz, label, color, clampEdge = false) => {
      let px = (wx - x0) * SCALE, pz = (wz - z0) * SCALE;
      const inWin = px >= 0 && px <= w * SCALE && pz >= 0 && pz <= h * SCALE;
      if (!inWin) {
        if (!clampEdge) return;
        px = Math.max(10, Math.min(w * SCALE - 10, px));
        pz = Math.max(10, Math.min(h * SCALE - 10, pz));
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(5,7,10,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, pz, 5, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
      ctx.font = 'bold 11px "IBM Plex Mono", monospace';
      const lx = Math.min(px + 8, w * SCALE - 90);
      ctx.strokeText(label, lx, pz + 4);
      ctx.fillText(label, lx, pz + 4);
    };

    mark(Math.floor(poi.spawn.x), Math.floor(poi.spawn.z), 'REFUGE', '#e0a83e', true);
    if (flags.has('labFound') || g.story.cataloged.size > 0) mark(poi.lab.x, poi.lab.z, 'LAZARUS ANNEX', '#86d4d0', true);
    if (flags.has('survey:colony') || g.story.isCataloged(3)) mark(poi.colony.x, poi.colony.z, g.bossDead ? 'SEAM (purged)' : 'COLONY SEAM', '#b5c98a', true);
    if (flags.has('survey:ruin')) mark(poi.ruin.x, poi.ruin.z, g.bossState.kiln.dead ? 'FOUNDRY (restored)' : 'INDUSTRIAL RUIN', '#c9a58a', true);
    if (flags.has('survey:annex')) mark(poi.annex.x, poi.annex.z, g.bossState.pump.dead ? 'ANNEX (drained)' : 'FLOODED ANNEX', '#6aa4c4', true);
    if (flags.has('survey:settlement')) mark(poi.settlement.x, poi.settlement.z, 'SETTLEMENT', '#a8a094', true);
    if (flags.has('survey:transit') || g.story.isCataloged(3)) mark(poi.transit.x, poi.transit.z, g.transit.restored ? 'TRANSIT (live)' : 'TRANSIT STATION', '#e0a83e', true);
    // §16.3 facility diagram: the Deep Site galleries appear once the rail runs
    if (g.transit.restored) {
      const d = poi.deep;
      mark(d.entry.x, d.entry.z, 'DEEP SITE', '#d94f4f', true);
      for (const v of d.valves) mark(v.x, v.z, `V${v.index}${g.deep.valves[v.index - 1] ? ' ✓' : ''}`, g.deep.valves[v.index - 1] ? '#7fae62' : '#d94f4f');
      mark(d.roane.x, d.roane.z, g.deep.purged ? 'RESERVOIR (silent)' : 'RESERVOIR', g.deep.purged ? '#7fae62' : '#d94f4f');
    }
    // ore deposits discovered on foot (wishlist #4) — remembered by
    // coordinates, so they stay marked however far the chunk has unloaded
    for (const m of (g.minesSeen?.values?.() || [])) {
      mark(m.x, m.z, m.kind === 'iron' ? 'IRON HILL' : 'COAL HILL', m.kind === 'iron' ? '#c9a58a' : '#8a8f96');
    }
    // §19 reclamation targets, once surveyed
    for (const r of poi.reservoirs || []) {
      if (flags.has('reclaim:' + r.id)) mark(r.x, r.z, 'STERILIZED', '#7fae62', true);
      else if (flags.has('survey:' + r.id)) mark(r.x, r.z, 'RESERVOIR SITE', '#c06a8a', true);
    }
    // §13.4: the map marks known body locations
    for (const grave of g.recovery.graves) mark(grave.x, grave.z, 'YOUR BODY', '#c9a58a', true);

    // player arrow (window center)
    ctx.save();
    ctx.translate((p.pos.x - x0) * SCALE, (p.pos.z - z0) * SCALE);
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#cfe3d4';
    ctx.strokeStyle = 'rgba(5,7,10,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
  }
}
