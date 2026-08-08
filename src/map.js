import { WORLD, B } from './config.js';

// The valley map [M] (§16.2–16.3 map annotations, §13.4 body markers).
// A canvas top-down render of the heightmap, annotated with everything the
// player has actually learned: surveyed regions, cataloged-archive markers,
// known bodies, and reclamation state. Knowledge is equipment — the map only
// shows what the run has earned.

// canvas pixels per world cell — adaptive so the map stays ~512px however
// large the world grows
const SCALE = Math.max(2, Math.floor(512 / WORLD.SIZE_X));

const SURF_COLORS = {
  [B.GRASS]: [79, 122, 58], [B.SAND]: [191, 168, 120], [B.WATER]: [44, 93, 138],
  [B.STONE]: [116, 120, 127], [B.DIRT]: [90, 70, 52], [B.LEAVES]: [62, 107, 52],
  [B.LOG]: [107, 78, 46], [B.RUIN_FLOOR]: [94, 91, 86], [B.RUIN_WALL]: [110, 106, 100],
  [B.TRANSIT_HULL]: [78, 90, 98], [B.LAB_WALL]: [90, 96, 102], [B.WOOD_WALL]: [107, 84, 47],
  [B.PLANK]: [138, 106, 62], [B.STONE_BRICK]: [101, 107, 114],
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
    const w = WORLD.SIZE_X, h = WORLD.SIZE_Z;
    this.canvas.width = w * SCALE;
    this.canvas.height = h * SCALE;
    const ctx = this.canvas.getContext('2d');

    // terrain: top surface block color, shaded by height
    const img = ctx.createImageData(w, h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const top = g.world.skyTop(x, z);
        let id = g.world.get(x, top - 1, z);
        if (id === B.AIR) id = B.STONE;
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

    // annotations
    const poi = g.world.poi;
    const flags = g.valleyFlags;
    const mark = (x, z, label, color) => {
      const px = x * SCALE, pz = z * SCALE;
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(5,7,10,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, pz, 5, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
      ctx.font = 'bold 11px "IBM Plex Mono", monospace';
      ctx.strokeText(label, px + 8, pz + 4);
      ctx.fillText(label, px + 8, pz + 4);
    };

    mark(Math.floor(poi.spawn.x), Math.floor(poi.spawn.z), 'REFUGE', '#e0a83e');
    if (flags.has('labFound') || g.story.cataloged.size > 0) mark(poi.lab.x, poi.lab.z, 'LAZARUS ANNEX', '#86d4d0');
    if (flags.has('survey:colony') || g.story.isCataloged(3)) mark(poi.colony.x, poi.colony.z, g.bossDead ? 'SEAM (purged)' : 'COLONY SEAM', '#b5c98a');
    if (flags.has('survey:ruin')) mark(poi.ruin.x, poi.ruin.z, g.bossState.kiln.dead ? 'FOUNDRY (restored)' : 'INDUSTRIAL RUIN', '#c9a58a');
    if (flags.has('survey:annex')) mark(poi.annex.x, poi.annex.z, g.bossState.pump.dead ? 'ANNEX (drained)' : 'FLOODED ANNEX', '#6aa4c4');
    if (flags.has('survey:settlement')) mark(poi.settlement.x, poi.settlement.z, 'SETTLEMENT', '#a8a094');
    if (flags.has('survey:transit') || g.story.isCataloged(3)) mark(poi.transit.x, poi.transit.z, g.transit.restored ? 'TRANSIT (live)' : 'TRANSIT STATION', '#e0a83e');
    // §16.3 facility diagram: the Deep Site galleries appear once the rail runs
    if (g.transit.restored) {
      const d = poi.deep;
      mark(d.entry.x, d.entry.z, 'DEEP SITE', '#d94f4f');
      for (const v of d.valves) mark(v.x, v.z, `V${v.index}${g.deep.valves[v.index - 1] ? ' ✓' : ''}`, g.deep.valves[v.index - 1] ? '#7fae62' : '#d94f4f');
      mark(d.roane.x, d.roane.z, g.deep.purged ? 'RESERVOIR (silent)' : 'RESERVOIR', g.deep.purged ? '#7fae62' : '#d94f4f');
    }
    // ore hills discovered on foot (wishlist #4)
    (poi.mines || []).forEach((m, i) => {
      if (g.minesSeen?.has(i)) mark(m.x, m.z, m.kind === 'iron' ? 'IRON HILL' : 'COAL HILL', m.kind === 'iron' ? '#c9a58a' : '#8a8f96');
    });
    // §19 reclamation targets, once surveyed
    for (const r of poi.reservoirs || []) {
      if (flags.has('reclaim:' + r.id)) mark(r.x, r.z, 'STERILIZED', '#7fae62');
      else if (flags.has('survey:' + r.id)) mark(r.x, r.z, 'RESERVOIR SITE', '#c06a8a');
    }
    // §13.4: the map marks known body locations
    for (const grave of g.recovery.graves) mark(grave.x, grave.z, 'YOUR BODY', '#c9a58a');

    // player arrow
    const p = g.player;
    const px = p.pos.x * SCALE, pz = p.pos.z * SCALE;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#cfe3d4';
    ctx.strokeStyle = 'rgba(5,7,10,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
  }
}
