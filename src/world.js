import * as THREE from 'three';
import { WORLD, B, BLOCKS, WORLDGEN } from './config.js';
import { RNG, fbm2, noise3, noise2 } from './rng.js';
import { getBlockAtlas } from './textures.js';

const { CHUNK, CHUNKS_X, CHUNKS_Z, HEIGHT, SIZE_X, SIZE_Z, SURFACE, SEA_LEVEL } = WORLD;

// Face geometry: for each of 6 directions, the 4 corner offsets (CCW) and the
// AO sampling offsets (2 sides + corner per vertex, in the neighbor plane).
const FACES = [
  { // +X
    dir: [1, 0, 0], nrm: [1, 0, 0], shade: 0.72,
    corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]],
    ao: [ [[1,-1,0],[1,0,-1],[1,-1,-1]], [[1,1,0],[1,0,-1],[1,1,-1]], [[1,1,0],[1,0,1],[1,1,1]], [[1,-1,0],[1,0,1],[1,-1,1]] ],
  },
  { // -X
    dir: [-1, 0, 0], nrm: [-1, 0, 0], shade: 0.72,
    corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
    ao: [ [[-1,-1,0],[-1,0,1],[-1,-1,1]], [[-1,1,0],[-1,0,1],[-1,1,1]], [[-1,1,0],[-1,0,-1],[-1,1,-1]], [[-1,-1,0],[-1,0,-1],[-1,-1,-1]] ],
  },
  { // +Y (top)
    dir: [0, 1, 0], nrm: [0, 1, 0], shade: 1.0,
    corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]],
    ao: [ [[-1,1,0],[0,1,1],[-1,1,1]], [[1,1,0],[0,1,1],[1,1,1]], [[1,1,0],[0,1,-1],[1,1,-1]], [[-1,1,0],[0,1,-1],[-1,1,-1]] ],
  },
  { // -Y (bottom)
    dir: [0, -1, 0], nrm: [0, -1, 0], shade: 0.5,
    corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]],
    ao: [ [[-1,-1,0],[0,-1,-1],[-1,-1,-1]], [[1,-1,0],[0,-1,-1],[1,-1,-1]], [[1,-1,0],[0,-1,1],[1,-1,1]], [[-1,-1,0],[0,-1,1],[-1,-1,1]] ],
  },
  { // +Z
    dir: [0, 0, 1], nrm: [0, 0, 1], shade: 0.86,
    corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]],
    ao: [ [[1,-1,1],[0,-1,1],[1,0,1]], [[1,1,1],[0,1,1],[1,0,1]], [[-1,1,1],[0,1,1],[-1,0,1]], [[-1,-1,1],[0,-1,1],[-1,0,1]] ],
  },
  { // -Z
    dir: [0, 0, -1], nrm: [0, 0, -1], shade: 0.6,
    corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]],
    ao: [ [[-1,-1,-1],[0,-1,-1],[-1,0,-1]], [[-1,1,-1],[0,1,-1],[-1,0,-1]], [[1,1,-1],[0,1,-1],[1,0,-1]], [[1,-1,-1],[0,-1,-1],[1,0,-1]] ],
  },
];

const AO_LEVELS = [0.5, 0.68, 0.84, 1.0];

// The block layout of one tree with the given trunk height, as offsets from
// the ground cell. Shared by worldgen (stamping) and the gallery (preview) —
// deterministic given `th`, so extracting it does not disturb gen RNG order.
export function treeShape(th) {
  const blocks = [];
  for (let y = 1; y <= th; y++) blocks.push({ dx: 0, dy: y, dz: 0, id: B.LOG });
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++)
      for (let dy = 0; dy <= 2; dy++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (dy === 2 && (Math.abs(dx) > 1 || Math.abs(dz) > 1)) continue;
        if (dx === 0 && dz === 0 && th - 1 + dy <= th) continue; // trunk occupies
        blocks.push({ dx, dy: th - 1 + dy, dz, id: B.LEAVES });
      }
  return blocks;
}

export class World {
  constructor(seed) {
    this.seed = seed;
    this.rng = new RNG(seed);
    this.data = new Uint16Array(SIZE_X * HEIGHT * SIZE_Z);
    this.heightMap = new Int16Array(SIZE_X * SIZE_Z); // highest opaque block +1
    this.dirty = new Set();
    this.meshes = new Map();          // chunkKey -> {opaque:Mesh, trans:Mesh}
    this.edits = new Map();           // "x,y,z" -> id  (diffs for save)
    this.group = new THREE.Group();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.transMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide });
    // procedural texture atlas (wishlist #6) — null under headless tests;
    // the map multiplies the baked vertex colors, so lighting is untouched
    this.atlas = getBlockAtlas();
    if (this.atlas) {
      this.material.map = this.atlas.texture;
      this.transMaterial.map = this.atlas.texture;
    }
    // Points of interest discovered during generation.
    this.poi = {};
  }

  idx(x, y, z) { return (y * SIZE_Z + z) * SIZE_X + x; }
  inBounds(x, y, z) { return x >= 0 && x < SIZE_X && y >= 0 && y < HEIGHT && z >= 0 && z < SIZE_Z; }

  get(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    if (x < 0 || x >= SIZE_X || z < 0 || z >= SIZE_Z) return B.BEDROCK; // containing wall
    return this.data[this.idx(x, y, z)];
  }

  // Raw setter used during generation (no dirty/edit tracking).
  _set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.idx(x, y, z)] = id;
  }

  chunkKey(cx, cz) { return cx + ',' + cz; }
  chunkOf(x, z) { return [Math.floor(x / CHUNK), Math.floor(z / CHUNK)]; }

  markDirty(x, z) {
    const [cx, cz] = this.chunkOf(x, z);
    this.dirty.add(this.chunkKey(cx, cz));
    // Neighboring chunks need re-mesh when edits happen on a border.
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    if (lx === 0) this.dirty.add(this.chunkKey(cx - 1, cz));
    if (lx === CHUNK - 1) this.dirty.add(this.chunkKey(cx + 1, cz));
    if (lz === 0) this.dirty.add(this.chunkKey(cx, cz - 1));
    if (lz === CHUNK - 1) this.dirty.add(this.chunkKey(cx, cz + 1));
  }

  // Public edit: tracks diff + dirties chunk + maintains heightmap.
  set(x, y, z, id, track = true) {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.idx(x, y, z)] = id;
    if (track) this.edits.set(`${x},${y},${z}`, id);
    this.updateHeight(x, z);
    this.markDirty(x, z);
  }

  updateHeight(x, z) {
    let top = 0;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const d = BLOCKS[this.data[this.idx(x, y, z)]];
      if (d && d.opaque) { top = y + 1; break; }
    }
    this.heightMap[z * SIZE_X + x] = top;
  }

  skyTop(x, z) {
    if (x < 0 || x >= SIZE_X || z < 0 || z >= SIZE_Z) return HEIGHT;
    return this.heightMap[z * SIZE_X + x];
  }

  // ---------------- Generation ----------------
  generate() {
    // hashed numeric seed — passing the raw string coerces to 0 inside the
    // noise hashers and every string seed would share one terrain shape
    const s = this.rng.seed;
    for (let x = 0; x < SIZE_X; x++) {
      for (let z = 0; z < SIZE_Z; z++) {
        // Height: forest rolling toward flat plains at high x.
        const plainsMix = Math.min(1, Math.max(0, (x - SIZE_X * 0.55) / (SIZE_X * 0.4)));
        const h1 = fbm2(x / 46, z / 46, s, 4) * 10;
        const h2 = fbm2(x / 18, z / 18, s + 99, 3) * 4 * (1 - plainsMix);
        let surf = Math.floor(SURFACE + h1 + h2 - plainsMix * 3);
        surf = Math.max(SEA_LEVEL - 2, Math.min(HEIGHT - 12, surf));
        for (let y = 0; y <= surf; y++) {
          let id = B.STONE;
          if (y === 0) id = B.BEDROCK;
          else if (y > surf - 4) id = (y === surf) ? B.GRASS : B.DIRT;
          this._set(x, y, z, id);
        }
        // water fills low basins
        for (let y = surf + 1; y <= SEA_LEVEL; y++) this._set(x, y, z, B.WATER);
        // beach sand near water line
        if (surf <= SEA_LEVEL + 1) {
          this._set(x, surf, z, B.SAND);
          if (surf - 1 > 0) this._set(x, surf - 1, z, B.SAND);
        }
      }
    }

    this.carveCaves();
    this.placeOres();
    this.placeOreHills();
    this.placeTrees();
    this.scatterSurface();
    this.buildLab();
    this.buildColonySeam();
    this.placeStartRefuge();
    // full-game regions (§4.3, §17–18). Each uses its own forked RNG so the
    // original terrain/structures above keep their exact per-seed layout.
    this.placeNests();
    this.buildIndustrialRuin();
    this.buildFloodedAnnex();
    this.buildSettlement();
    this.buildTransitAndDeepSite();
    this.placeSecondaryReservoirs();
    this.addLabServiceTunnel();

    for (let x = 0; x < SIZE_X; x++)
      for (let z = 0; z < SIZE_Z; z++) this.updateHeight(x, z);

    // Everything dirty initially.
    for (let cx = 0; cx < CHUNKS_X; cx++)
      for (let cz = 0; cz < CHUNKS_Z; cz++) this.dirty.add(this.chunkKey(cx, cz));
  }

  carveCaves() {
    const s = this.rng.seed + 4001;
    for (let x = 1; x < SIZE_X - 1; x++) {
      for (let z = 1; z < SIZE_Z - 1; z++) {
        const surf = this.surfaceY(x, z);
        for (let y = 2; y < surf - 2; y++) {
          const n = noise3(x / 14, y / 10, z / 14, s);
          const n2 = noise3(x / 7, y / 6, z / 7, s + 21);
          // worm-ish caves: two overlapping thresholds
          if (n > 0.72 || (n > 0.62 && n2 > 0.6)) {
            if (this.get(x, y, z) === B.STONE || this.get(x, y, z) === B.DIRT) this._set(x, y, z, B.AIR);
          }
        }
      }
    }
  }

  surfaceY(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const id = this.get(x, y, z);
      if (id === B.GRASS || id === B.DIRT || id === B.STONE || id === B.SAND) return y;
    }
    return SURFACE;
  }

  placeOres() {
    const rng = this.rng.fork('ore');
    // iron veins deeper, coal shallower; density holds constant per area
    const veins = Math.round(90 * WORLD.AREA_SCALE);
    for (let i = 0; i < veins; i++) {
      const isIron = i % 2 === 0;
      const cx = rng.int(2, SIZE_X - 3);
      const cz = rng.int(2, SIZE_Z - 3);
      const surf = this.surfaceY(cx, cz);
      const cy = isIron ? rng.int(3, Math.min(surf - 3, 16)) : rng.int(6, Math.max(7, surf - 3));
      const size = rng.int(4, 9);
      for (let k = 0; k < size; k++) {
        const x = cx + rng.int(-1, 1), y = cy + rng.int(-1, 1), z = cz + rng.int(-1, 1);
        if (this.get(x, y, z) === B.STONE) this._set(x, y, z, isIron ? B.IRON_ORE : B.COAL_ORE);
      }
    }
  }

  // Ore hills (wishlist #4): visible mounds you can walk into, their interior
  // chambers lined with dense FINITE ore. Mining one out empties it forever —
  // the Factorio loop of find deposit → extract → deposit runs dry.
  placeOreHills() {
    const rng = this.rng.fork('orehill');
    this.poi.mines = [];
    const cfg = WORLDGEN.oreHills;
    const want = Math.round(cfg.count * WORLD.AREA_SCALE);
    // structure sites are placed later at these fixed fractions (buildLab,
    // placeStartRefuge, ...) — hills must leave them room
    const avoid = [
      [0.78, 0.5], [0.28, 0.7], [0.28, 0.28], [0.6, 0.75],
      [0.68, 0.32], [0.42, 0.6], [0.62, 0.18], [0.15, 0.85], [0.88, 0.78],
    ].map(([fx, fz]) => ({ x: Math.floor(SIZE_X * fx), z: Math.floor(SIZE_Z * fz) }));
    for (let attempt = 0; attempt < want * 40 && this.poi.mines.length < want; attempt++) {
      const r = rng.int(cfg.radiusMin, cfg.radiusMax);
      const cx = rng.int(r + 4, SIZE_X - r - 5);
      const cz = rng.int(r + 4, SIZE_Z - r - 5);
      if (avoid.some(a => Math.hypot(a.x - cx, a.z - cz) < cfg.clearance)) continue;
      if (this.poi.mines.some(m => Math.hypot(m.x - cx, m.z - cz) < cfg.spacing)) continue;
      const surf = this.surfaceY(cx, cz);
      if (surf <= SEA_LEVEL || surf > WORLD.HEIGHT - 12) continue; // dry, buildable ground
      const isIron = this.poi.mines.length % 2 === 0;
      const placed = this.buildOreHill(rng, cx, cz, surf, r, isIron);
      this.poi.mines.push({ x: cx, y: surf, z: cz, kind: isIron ? 'iron' : 'coal', ore: placed });
    }
  }

  buildOreHill(rng, cx, cz, surf, r, isIron) {
    const cfg = WORLDGEN.oreHills;
    const ore = isIron ? B.IRON_ORE : B.COAL_ORE;
    const hillH = rng.int(4, 6);
    const cr = Math.max(2, r - 3); // interior chamber radius
    // stone dome over the site (paraboloid cap, grass-dressed skirt); the dome
    // is clamped to at least one solid layer above the chamber it will roof
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > r) continue;
        const h = Math.max(d <= cr + 1 ? 3 : 0, Math.round(hillH * (1 - (d / r) ** 2)));
        const x = cx + dx, z = cz + dz;
        const base = this.surfaceY(x, z);
        for (let y = base + 1; y <= surf + h; y++) this._set(x, y, z, B.STONE);
        if (h <= 1 && this.get(x, Math.max(base, surf + h), z) === B.STONE)
          this._set(x, Math.max(base, surf + h), z, B.GRASS);
      }
    // interior chamber at ground level
    for (let dx = -cr; dx <= cr; dx++)
      for (let dz = -cr; dz <= cr; dz++) {
        if (Math.hypot(dx, dz) > cr) continue;
        for (let y = surf + 1; y <= surf + 2; y++) this._set(cx + dx, y, cz + dz, B.AIR);
      }
    // entrance first: a 2-tall, 2-wide mouth from the south face into the
    // chamber (carved before ore so the ore count stays exact), with a solid
    // walkable floor patched under it on sloped ground
    for (let dz = cr; dz <= r + 1; dz++)
      for (const ex of [cx, cx + 1]) {
        for (let y = surf + 1; y <= surf + 2; y++) this._set(ex, y, cz + dz, B.AIR);
        if (!BLOCKS[this.get(ex, surf, cz + dz)]?.solid) this._set(ex, surf, cz + dz, B.DIRT);
      }
    // ore body: chamber walls/floor + a buried core beneath
    let placed = 0;
    const tryOre = (x, y, z) => {
      const id = this.get(x, y, z);
      if (id === B.STONE || id === B.DIRT) { this._set(x, y, z, ore); placed++; }
    };
    for (let dx = -cr - 1; dx <= cr + 1; dx++)
      for (let dz = -cr - 1; dz <= cr + 1; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > cr + 1) continue;
        const x = cx + dx, z = cz + dz;
        if (d > cr - 1) { // chamber wall ring
          for (let y = surf + 1; y <= surf + 2; y++) if (rng.chance(0.7)) tryOre(x, y, z);
        }
        if (rng.chance(0.6)) tryOre(x, surf, z);           // chamber floor
        for (let y = surf - 2; y < surf; y++) if (rng.chance(0.45)) tryOre(x, y, z); // buried core
      }
    // top up to the guaranteed minimum from the core region
    for (let attempt = 0; attempt < 200 && placed < cfg.minOre; attempt++) {
      tryOre(cx + rng.int(-cr, cr), surf - 2 + rng.int(0, 4), cz + rng.int(-cr, cr));
    }
    // visible outcrops on the dome flank — the deposit reads from outside
    for (let i = 0; i < cfg.outcrops; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dd = rng.range(r * 0.45, r * 0.85);
      const x = cx + Math.round(Math.cos(ang) * dd), z = cz + Math.round(Math.sin(ang) * dd);
      for (let y = surf + hillH; y >= surf; y--) {
        if (this.get(x, y, z) === B.STONE || this.get(x, y, z) === B.GRASS) {
          this._set(x, y, z, ore); placed++;
          break;
        }
      }
    }
    return placed;
  }

  placeTrees() {
    const rng = this.rng.fork('tree');
    for (let x = 3; x < SIZE_X - 3; x++) {
      for (let z = 3; z < SIZE_Z - 3; z++) {
        const plainsMix = Math.min(1, Math.max(0, (x - SIZE_X * 0.55) / (SIZE_X * 0.4)));
        const density = 0.035 * (1 - plainsMix * 0.85);
        if (!rng.chance(density)) continue;
        // keep ore-hill mouths and flanks readable — no trunks on the skirt
        if (this.poi.mines?.some(m => Math.hypot(m.x - x, m.z - z) < WORLDGEN.oreHills.radiusMax + 3)) continue;
        const surf = this.surfaceY(x, z);
        if (this.get(x, surf, z) !== B.GRASS) continue;
        const th = rng.int(4, 6);
        for (const b of treeShape(th)) {
          const bx = x + b.dx, by = surf + b.dy, bz = z + b.dz;
          // leaves only fill air; trunk always stamps (matches original gen)
          if (b.id === B.LOG || this.get(bx, by, bz) === B.AIR) this._set(bx, by, bz, b.id);
        }
      }
    }
  }

  // Loose stones/sticks: represented as pickup entities, generated by the
  // scene from these locations. We just record spawn points.
  scatterSurface() {
    const rng = this.rng.fork('scatter');
    this.pickups = [];
    for (let x = 2; x < SIZE_X - 2; x++) {
      for (let z = 2; z < SIZE_Z - 2; z++) {
        const surf = this.surfaceY(x, z);
        const top = this.get(x, surf, z);
        if (top !== B.GRASS && top !== B.SAND) continue;
        if (this.get(x, surf + 1, z) !== B.AIR) continue;
        // y = top face of the surface block: litter lies ON the ground
        if (rng.chance(0.012)) this.pickups.push({ x: x + 0.5, y: surf + 1.02, z: z + 0.5, item: 'stone_shard', n: rng.int(1, 2) });
        else if (rng.chance(0.012)) this.pickups.push({ x: x + 0.5, y: surf + 1.02, z: z + 0.5, item: 'stick', n: rng.int(1, 2) });
        else if (rng.chance(0.006)) this.pickups.push({ x: x + 0.5, y: surf + 1.02, z: z + 0.5, item: 'fiber', n: rng.int(1, 3) });
      }
    }
  }

  // Small Project Lazarus laboratory dug into a hillside on the plains edge.
  buildLab() {
    const rng = this.rng.fork('lab');
    const lx = Math.floor(SIZE_X * 0.78);
    const lz = Math.floor(SIZE_Z * 0.5);
    const surf = this.surfaceY(lx, lz);
    const floor = surf - 4;
    const w = 9, d = 11, h = 5;
    const x0 = lx - Math.floor(w / 2), z0 = lz - Math.floor(d / 2);
    for (let x = x0 - 1; x <= x0 + w; x++)
      for (let z = z0 - 1; z <= z0 + d; z++)
        for (let y = floor - 1; y <= floor + h; y++) {
          const edge = x === x0 - 1 || x === x0 + w || z === z0 - 1 || z === z0 + d || y === floor - 1 || y === floor + h;
          if (edge) this._set(x, y, z, y === floor - 1 ? B.LAB_FLOOR : B.LAB_WALL);
          else this._set(x, y, z, B.AIR);
        }
    // floor plating
    for (let x = x0; x < x0 + w; x++)
      for (let z = z0; z < z0 + d; z++) this._set(x, floor - 1, z, B.LAB_FLOOR);
    // lights
    for (let x = x0 + 1; x < x0 + w; x += 3)
      for (let z = z0 + 1; z < z0 + d; z += 4) this._set(x, floor + h - 1, z, B.LAB_LIGHT);
    // entrance corridor up to the surface (breach the roof/side toward -z)
    const ex = lx, ez = z0 - 1;
    for (let y = floor; y <= surf + 1; y++) { this._set(ex, y, ez, B.AIR); this._set(ex, y, ez - 1, B.AIR); }
    for (let z = ez; z >= ez - 2; z--) this._set(ex, floor, z, B.LAB_FLOOR);
    // three archive fragments placed on the floor, spaced through the room
    this._set(x0 + 1, floor, z0 + 1, B.ARCHIVE_1);
    this._set(x0 + w - 2, floor, z0 + 2, B.ARCHIVE_2);
    this._set(lx, floor, z0 + d - 2, B.ARCHIVE_3);
    // some contamination + a suppressant cache
    for (let i = 0; i < 8; i++) {
      const x = rng.int(x0, x0 + w - 1), z = rng.int(z0, z0 + d - 1);
      if (this.get(x, floor, z) === B.AIR) this._set(x, floor, z, B.CYST);
    }
    this.poi.lab = { x: lx, y: floor, z: lz, x0, z0, w, d, floor };
  }

  // Miniboss: a mineralized colony encasing a rich iron seam in a cave pocket.
  buildColonySeam() {
    const cx = Math.floor(SIZE_X * 0.28);
    const cz = Math.floor(SIZE_Z * 0.7);
    const surf = this.surfaceY(cx, cz);
    const cy = Math.max(6, surf - 12);
    // hollow a pocket
    for (let x = cx - 4; x <= cx + 4; x++)
      for (let z = cz - 4; z <= cz + 4; z++)
        for (let y = cy - 3; y <= cy + 3; y++) {
          if ((x-cx)**2 + ((y-cy)*1.4)**2 + (z-cz)**2 < 20) {
            if (this.get(x, y, z) !== B.BEDROCK) this._set(x, y, z, B.AIR);
          }
        }
    // colony wall on the far side encasing an iron-rich seam
    for (let x = cx + 2; x <= cx + 4; x++)
      for (let z = cz - 3; z <= cz + 3; z++)
        for (let y = cy - 2; y <= cy + 2; y++) {
          if (this.get(x, y, z) === B.AIR) this._set(x, y, z, B.COLONY);
        }
    // rich iron behind the colony
    for (let x = cx + 5; x <= cx + 7; x++)
      for (let z = cz - 2; z <= cz + 2; z++)
        for (let y = cy - 2; y <= cy + 2; y++) {
          if (this.get(x, y, z) === B.STONE) this._set(x, y, z, B.IRON_ORE);
        }
    // a tunnel hint from surface down toward the pocket
    let tx = cx, tz = cz - 5;
    for (let y = surf; y >= cy; y--) {
      this._set(tx, y, tz, B.AIR); this._set(tx, y, tz + 1, B.AIR);
      if (y % 3 === 0 && tz < cz - 1) tz++;
    }
    this.poi.colony = { x: cx, y: cy, z: cz, hostSpawn: { x: cx + 0.5, y: cy - 1, z: cz + 0.5 } };
  }

  // Starting refuge: a small ruined shack holding the one-time emergency
  // recovery pad (§13.2 — it protects the first learning cycle only).
  placeStartRefuge() {
    const sx = Math.floor(SIZE_X * 0.28);
    const sz = Math.floor(SIZE_Z * 0.28);
    // flatten a 7x7 pad
    let surf = SURFACE;
    let acc = 0, n = 0;
    for (let x = sx - 3; x <= sx + 3; x++)
      for (let z = sz - 3; z <= sz + 3; z++) { acc += this.surfaceY(x, z); n++; }
    surf = Math.round(acc / n);
    for (let x = sx - 3; x <= sx + 3; x++)
      for (let z = sz - 3; z <= sz + 3; z++) {
        for (let y = surf + 1; y <= surf + 6; y++) this._set(x, y, z, B.AIR);
        this._set(x, surf, z, B.GRASS);
        for (let y = surf - 3; y < surf; y++) if (this.get(x, y, z) === B.AIR) this._set(x, y, z, B.DIRT);
      }
    // shack: 5x5 timber walls, 3 high, doorway south, half-collapsed corner
    const x0 = sx - 2, z0 = sz - 2, x1 = sx + 2, z1 = sz + 2;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        if (!isWall) continue;
        for (let y = 1; y <= 3; y++) {
          // collapsed corner (weathered opening the player must repair)
          if (x === x1 && z === z1 && y > 1) continue;
          this._set(x, surf + y, z, B.WOOD_WALL);
        }
      }
    // doorway (open — the player learns to craft a door)
    this._set(sx, surf + 1, z0, B.AIR);
    this._set(sx, surf + 2, z0, B.AIR);
    // partial roof
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        if ((x + z) % 3 !== 0) this._set(x, surf + 4, z, B.PLANK);
    // a crafting bench inside, and the dusty shortwave set (§15.8)
    this._set(sx - 1, surf + 1, sz + 1, B.BENCH);
    this._set(sx + 1, surf + 1, sz, B.RADIO);
    this.poi.spawn = { x: sx + 0.5, y: surf + 1, z: sz + 0.5 };
    this.poi.emergency = { x: sx + 1, y: surf + 1, z: sz + 1 };
  }

  spawnPoint() { return this.poi.spawn; }

  // ---------------- Full-game regions (§4.3, §17–18) ----------------

  // Infected nests seeded through the cave network (§4.3). The director treats
  // an unresolved nest near the player as an incursion source (§6.3).
  placeNests() {
    const rng = this.rng.fork('nest');
    this.poi.nests = [];
    // nest count scales with the world's linear size (per-area would flood
    // the director's incursion sources on big maps)
    const want = Math.round(5 * Math.sqrt(WORLD.AREA_SCALE));
    for (let attempt = 0; attempt < 60 * WORLD.AREA_SCALE && this.poi.nests.length < want; attempt++) {
      const x = rng.int(8, SIZE_X - 9), z = rng.int(8, SIZE_Z - 9);
      const surf = this.surfaceY(x, z);
      // find a cave pocket: air with solid floor, well below the surface
      let found = null;
      for (let y = 6; y < surf - 6; y++) {
        if (this.get(x, y, z) === B.AIR && this.get(x, y - 1, z) !== B.AIR) { found = y; break; }
      }
      if (found == null) continue;
      // keep nests out of the shack's backyard
      const s = this.poi.spawn;
      if (Math.hypot(x - s.x, z - s.z) < 22) continue;
      const y = found;
      this._set(x, y, z, B.NEST);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (rng.chance(0.7) && this.get(x + dx, y, z + dz) === B.AIR) this._set(x + dx, y, z + dz, rng.chance(0.4) ? B.NEST : B.CYST);
      }
      this.poi.nests.push({ x, y, z });
    }
  }

  // Industrial ruin (§4.3): a collapsed foundry. The kiln is occupied by a
  // tissue-fused host (§11.3) — purging it restores steel production at scale.
  buildIndustrialRuin() {
    const rng = this.rng.fork('ruin');
    const cx = Math.floor(SIZE_X * 0.6), cz = Math.floor(SIZE_Z * 0.75);
    const surf = this.surfaceY(cx, cz);
    const x0 = cx - 6, x1 = cx + 6, z0 = cz - 5, z1 = cz + 5;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        for (let y = surf + 1; y <= surf + 6; y++) this._set(x, y, z, B.AIR);
        this._set(x, surf, z, B.RUIN_FLOOR);
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        if (isWall) {
          // weathered perimeter: broken to uneven heights, with gaps
          const h = rng.chance(0.2) ? 0 : rng.int(1, 3);
          for (let y = 1; y <= h; y++) this._set(x, surf + y, z, B.RUIN_WALL);
        }
      }
    // the kiln stack against the north wall
    const kx = cx, kz = z0 + 1;
    this._set(kx, surf + 1, kz, B.KILN);
    this._set(kx, surf + 2, kz, B.RUIN_WALL);
    this._set(kx, surf + 3, kz, B.RUIN_WALL);
    // salvage: machine scrap piles (source of control relays)
    for (let i = 0; i < 9; i++) {
      const x = rng.int(x0 + 1, x1 - 1), z = rng.int(z0 + 1, z1 - 1);
      if (this.get(x, surf + 1, z) === B.AIR) this._set(x, surf + 1, z, B.SCRAP);
    }
    for (let i = 0; i < 5; i++) {
      const x = rng.int(x0 + 1, x1 - 1), z = rng.int(z0 + 1, z1 - 1);
      if (this.get(x, surf + 1, z) === B.AIR) this._set(x, surf + 1, z, B.CYST);
    }
    this.poi.ruin = { x: cx, z: cz, surf, kiln: { x: kx, y: surf + 1, z: kz }, hostSpawn: { x: cx + 0.5, y: surf + 1, z: cz + 2.5 } };
  }

  // Flooded laboratory annex (§11.3): a pump organism blocks a drowned pump
  // gallery. Purging it drains the annex and exposes the filtration stores.
  buildFloodedAnnex() {
    const cx = Math.floor(SIZE_X * 0.68), cz = Math.floor(SIZE_Z * 0.32);
    const surf = this.surfaceY(cx, cz);
    const floor = surf - 7;
    const w = 7, d = 9, h = 5;
    const x0 = cx - Math.floor(w / 2), z0 = cz - Math.floor(d / 2);
    for (let x = x0 - 1; x <= x0 + w; x++)
      for (let z = z0 - 1; z <= z0 + d; z++)
        for (let y = floor - 1; y <= floor + h; y++) {
          const edge = x === x0 - 1 || x === x0 + w || z === z0 - 1 || z === z0 + d || y === floor - 1 || y === floor + h;
          if (edge) this._set(x, y, z, y === floor - 1 ? B.LAB_FLOOR : B.LAB_WALL);
          else this._set(x, y, z, B.WATER); // drowned until the pump host dies
        }
    // access shaft down the north side — drowned to the room's water line
    for (let y = floor; y <= surf + 1; y++) this._set(cx, y, z0 - 1, y <= floor + h - 2 ? B.WATER : B.AIR);
    // above-water headroom strip at the ceiling so the fight is survivable
    for (let x = x0; x < x0 + w; x++)
      for (let z = z0; z < z0 + d; z++) this._set(x, floor + h - 1, z, B.AIR);
    // filtration stores: pickups on the annex floor, reachable once drained
    this.pickups.push(
      { x: x0 + 1.5, y: floor + 0.02, z: z0 + 1.5, item: 'filter_unit', n: 2 },
      { x: x0 + w - 1.5, y: floor + 0.02, z: z0 + d - 1.5, item: 'filter_unit', n: 1 },
      { x: cx + 0.5, y: floor + 0.02, z: z0 + 1.5, item: 'relay_module', n: 1 },
    );
    this.poi.annex = { x: cx, z: cz, surf, floor, x0, z0, w, d, h, hostSpawn: { x: cx + 0.5, y: floor, z: cz + 0.5 } };
  }

  // Abandoned settlement (§4.3): ruined concrete husks — dense salvage, human
  // traces, interior cyst contamination, and a marked supply cache (§15.8).
  buildSettlement() {
    const rng = this.rng.fork('settlement');
    const cx = Math.floor(SIZE_X * 0.42), cz = Math.floor(SIZE_Z * 0.6);
    const husks = [[-8, -6, 5, 5], [2, -4, 4, 6], [-3, 4, 6, 4]];
    for (const [ox, oz, w, d] of husks) {
      const x0 = cx + ox, z0 = cz + oz;
      const surf = this.surfaceY(x0 + Math.floor(w / 2), z0 + Math.floor(d / 2));
      for (let x = x0; x < x0 + w; x++)
        for (let z = z0; z < z0 + d; z++) {
          for (let y = surf + 1; y <= surf + 4; y++) this._set(x, y, z, B.AIR);
          this._set(x, surf, z, B.RUIN_FLOOR);
          const isWall = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
          if (isWall && rng.chance(0.75)) {
            const h = rng.int(1, 3);
            for (let y = 1; y <= h; y++) this._set(x, surf + y, z, B.RUIN_WALL);
          }
        }
      // interior traces: scrap + cyst film
      for (let i = 0; i < 3; i++) {
        const x = rng.int(x0 + 1, x0 + w - 2), z = rng.int(z0 + 1, z0 + d - 2);
        if (this.get(x, surf + 1, z) === B.AIR) this._set(x, surf + 1, z, rng.chance(0.5) ? B.SCRAP : B.CYST);
      }
    }
    // someone passed through recently: a marked cache (§15.8)
    const surf = this.surfaceY(cx, cz);
    this.pickups.push(
      { x: cx + 0.5, y: surf + 1.02, z: cz + 0.5, item: 'cooked_meat', n: 2 },
      { x: cx + 1.5, y: surf + 1.02, z: cz + 0.5, item: 'iron_ampoule', n: 1 },
    );
    this.poi.settlement = { x: cx, z: cz, surf };
  }

  // Regional containment transit (§17) + the Lazarus Deep Site beneath (§18):
  // a hardened surface relay station whose pressure rail drops into a buried
  // complex — entry hall, three purge galleries, and the reservoir vault.
  buildTransitAndDeepSite() {
    // --- surface station ---
    const sx = Math.floor(SIZE_X * 0.62), sz = Math.floor(SIZE_Z * 0.18);
    let surf = this.surfaceY(sx, sz);
    for (let x = sx - 4; x <= sx + 4; x++)
      for (let z = sz - 3; z <= sz + 3; z++) {
        for (let y = surf + 1; y <= surf + 6; y++) this._set(x, y, z, B.AIR);
        this._set(x, surf, z, B.RUIN_FLOOR);
      }
    const x0 = sx - 3, x1 = sx + 3, z0 = sz - 2, z1 = sz + 2;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        for (let y = 1; y <= 3; y++) if (isWall) this._set(x, surf + y, z, B.TRANSIT_HULL);
        this._set(x, surf + 4, z, B.TRANSIT_HULL); // roof — hardened, sealed
      }
    // doorway south
    this._set(sx, surf + 1, z1, B.AIR);
    this._set(sx, surf + 2, z1, B.AIR);
    // controls on the north wall: panel + rail gate, duty log beside them
    const panel = { x: sx - 1, y: surf + 1, z: z0 + 1 };
    const gate = { x: sx + 1, y: surf + 1, z: z0 + 1 };
    this._set(panel.x, panel.y, panel.z, B.TRANSIT_PANEL);
    this._set(gate.x, gate.y, gate.z, B.TRANSIT_GATE);
    this._set(sx, surf + 1, z0 + 1, B.ARCHIVE_4);
    this._set(sx - 2, surf + 3, z0 + 1, B.LAB_LIGHT);
    this.poi.transit = { x: sx, z: sz, surf, panel, gate };

    // --- buried Deep Site: entry + three galleries + vault, chained east ---
    const floor = 4, top = floor + 5;
    const zc0 = 8, zc1 = 20; // room z-range
    const rooms = [
      { x0: 78, x1: 85, kind: 'entry' },
      { x0: 86, x1: 93, kind: 'gallery', valve: 1 },
      { x0: 94, x1: 101, kind: 'gallery', valve: 2 },
      { x0: 102, x1: 109, kind: 'gallery', valve: 3 },
      { x0: 110, x1: 124, kind: 'vault' },
    ];
    const shell = (x, y, z, isFloor) => this._set(x, y, z, isFloor ? B.DEEP_FLOOR : B.DEEP_WALL);
    for (const r of rooms) {
      const rz0 = r.kind === 'vault' ? zc0 - 2 : zc0, rz1 = r.kind === 'vault' ? zc1 + 2 : zc1;
      for (let x = r.x0 - 1; x <= r.x1 + 1; x++)
        for (let z = rz0 - 1; z <= rz1 + 1; z++)
          for (let y = floor - 1; y <= top; y++) {
            const edge = x === r.x0 - 1 || x === r.x1 + 1 || z === rz0 - 1 || z === rz1 + 1 || y === floor - 1 || y === top;
            if (edge) shell(x, y, z, y === floor - 1);
            else this._set(x, y, z, B.AIR);
          }
      // sparse hardened lighting
      for (let x = r.x0 + 2; x < r.x1; x += 4) { this._set(x, top - 1, zc0 + 2, B.DEEP_LIGHT); this._set(x, top - 1, zc1 - 2, B.DEEP_LIGHT); }
    }
    // doorways between consecutive rooms (z 13..15, two tall)
    for (let i = 0; i < rooms.length - 1; i++) {
      const wallX = rooms[i].x1 + 1;
      for (let z = 13; z <= 15; z++) for (let y = floor; y <= floor + 2; y++) this._set(wallX, y, z, B.AIR);
    }
    const valves = [];
    for (const r of rooms) {
      if (r.kind !== 'gallery') continue;
      const v = { x: r.x1, y: floor + 1, z: 10, index: r.valve };
      this._set(v.x, v.y, v.z, B.VALVE);
      valves.push(v);
      // gallery contamination scales with depth into the complex
      for (let i = 0; i < 3 + r.valve * 2; i++) {
        const x = r.x0 + 1 + ((i * 3 + r.valve) % (r.x1 - r.x0 - 1));
        const z = zc0 + 1 + ((i * 5 + r.valve * 2) % (zc1 - zc0 - 1));
        if (this.get(x, floor, z) === B.AIR) this._set(x, floor, z, i % 3 === 0 ? B.NEST : B.CYST);
      }
    }
    // Venn's remains rest at gallery one — she opened the first valve (§15.6)
    this._set(88, floor, 18, B.ARCHIVE_5);
    // the rail terminus in the entry hall — the ride back to the surface
    this._set(80, floor, 10, B.TRANSIT_GATE);
    // vault: reservoir growth clusters + Roane's outline (tragic evidence)
    const vault = rooms[4];
    const clusters = [];
    const spots = [[113, 10], [113, 19], [117, 8], [121, 14], [117, 21]];
    for (const [cxx, czz] of spots) {
      const cells = [];
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          if (Math.abs(dx) + Math.abs(dz) === 2) continue;
          for (let dy = 0; dy <= (dx === 0 && dz === 0 ? 2 : 0); dy++) {
            const x = cxx + dx, y = floor + dy, z = czz + dz;
            if (this.get(x, y, z) === B.AIR) { this._set(x, y, z, B.RESERVOIR_TISSUE); cells.push([x, y, z]); }
          }
        }
      clusters.push({ x: cxx, y: floor, z: czz, cells });
    }
    this.poi.deep = {
      floor, top, x0: 78, x1: 124, z0: zc0 - 2, z1: zc1 + 2,
      floodX0: rooms[3].x0, // valve-three flood starts at gallery three
      entry: { x: 81, y: floor, z: 14 }, valves, clusters,
      gate: { x: 80, y: floor, z: 10 },
      roane: { x: 118, y: floor, z: 14 },
      vault: { x0: vault.x0, x1: vault.x1, z0: zc0 - 2, z1: zc1 + 2 },
    };
    // the vault holds a continuity core cache — reward beyond the objective
    this.pickups.push({ x: 122.5, y: floor + 0.02, z: 14.5, item: 'continuity_core', n: 1 });
  }

  // Alternate lab access (§11.2): an excavated service tunnel, collapsed and
  // plugged with gravel — a low-signature dig route beside the main corridor.
  addLabServiceTunnel() {
    const L = this.poi.lab;
    if (!L) return;
    const tx = L.x0 - 1, floor = L.floor;
    // breach the west bulkhead at floor level (two tall)
    this._set(tx, floor, L.z0 + Math.floor(L.d / 2), B.AIR);
    this._set(tx, floor + 1, L.z0 + Math.floor(L.d / 2), B.AIR);
    // a short corridor west, then a gravel-choked shaft to the surface
    const tz = L.z0 + Math.floor(L.d / 2);
    for (let x = tx - 1; x >= tx - 3; x--) { this._set(x, floor, tz, B.AIR); this._set(x, floor + 1, tz, B.AIR); }
    const sxx = tx - 4;
    const surf = this.surfaceY(sxx, tz);
    for (let y = floor; y <= surf; y++) this._set(sxx, y, tz, B.GRAVEL); // dig down to enter
    this.poi.labTunnel = { x: sxx, z: tz, surf };
  }

  // Secondary reservoirs (§19): post-game reclamation targets. Sterilizing one
  // permanently reduces regional pressure.
  placeSecondaryReservoirs() {
    this.poi.reservoirs = [];
    const sites = [
      { x: Math.floor(SIZE_X * 0.15), z: Math.floor(SIZE_Z * 0.85), id: 'res1' },
      { x: Math.floor(SIZE_X * 0.88), z: Math.floor(SIZE_Z * 0.78), id: 'res2' },
    ];
    for (const s of sites) {
      const surf = this.surfaceY(s.x, s.z);
      const cy = Math.max(6, surf - 9);
      for (let x = s.x - 3; x <= s.x + 3; x++)
        for (let z = s.z - 3; z <= s.z + 3; z++)
          for (let y = cy - 2; y <= cy + 2; y++) {
            if ((x - s.x) ** 2 + ((y - cy) * 1.5) ** 2 + (z - s.z) ** 2 < 12 && this.get(x, y, z) !== B.BEDROCK) this._set(x, y, z, B.AIR);
          }
      this._set(s.x, cy - 1, s.z, B.NEST);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        this._set(s.x + dx, cy - 1, s.z + dz, B.RESERVOIR_TISSUE);
        this._set(s.x + dx, cy, s.z + dz, B.CYST);
      }
      // a shaft hint from the surface
      for (let y = surf; y >= cy; y--) this._set(s.x, y, s.z - 4, B.AIR);
      this.poi.reservoirs.push({ x: s.x, y: cy, z: s.z, id: s.id });
    }
  }

  // ---------------- Meshing ----------------
  vColorFor(id, face, x, y, z) {
    const def = BLOCKS[id];
    let col = def.col;
    let base;
    if (Array.isArray(col)) base = face.dir[1] === 1 ? col[0] : face.dir[1] === -1 ? col[2] : col[1];
    else base = col;
    return base;
  }

  aoAt(x, y, z, offs) {
    const s1 = BLOCKS[this.get(x + offs[0][0], y + offs[0][1], z + offs[0][2])]?.opaque ? 1 : 0;
    const s2 = BLOCKS[this.get(x + offs[1][0], y + offs[1][1], z + offs[1][2])]?.opaque ? 1 : 0;
    const c = BLOCKS[this.get(x + offs[2][0], y + offs[2][1], z + offs[2][2])]?.opaque ? 1 : 0;
    if (s1 && s2) return 0;
    return 3 - (s1 + s2 + c);
  }

  skyLightAt(x, y, z) {
    // fraction of the 4 columns around this point that are open above y
    let open = 0;
    for (const [dx, dz] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
      if (this.skyTop(x + dx, z + dz) <= y) open++;
    }
    return 0.15 + 0.85 * (open / 4); // floor keeps caves/interiors readable
  }

  occludes(nid, selfId) {
    const nd = BLOCKS[nid];
    if (!nd) return true;               // out-of-range containing wall
    if (nd.opaque) return true;
    if (nd.transparent && nid === selfId) return true;
    return false;
  }

  buildChunkGeometry(cx, cz) {
    const op = { pos: [], col: [], nrm: [], idx: [], uv: [] };
    const tr = { pos: [], col: [], nrm: [], idx: [], uv: [] };
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (let x = x0; x < x0 + CHUNK; x++) {
      for (let z = z0; z < z0 + CHUNK; z++) {
        for (let y = 0; y < HEIGHT; y++) {
          const id = this.get(x, y, z);
          if (id === B.AIR) continue;
          const def = BLOCKS[id];
          if (!def || def.render === false) continue;
          if (def.model) continue; // rendered as a detailed prop mesh (props.js)
          const target = (def.transparent || def.liquid) ? tr : op;
          if (def.slim) { this.emitSlim(target, x, y, z, id, def); continue; }
          for (const face of FACES) {
            const nid = this.get(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
            if (this.occludes(nid, id)) continue;
            this.emitFace(target, face, x, y, z, id, def);
          }
        }
      }
    }
    return { op, tr };
  }

  emitFace(t, face, x, y, z, id, def) {
    const baseCol = new THREE.Color(this.vColorFor(id, face, x, y, z));
    const start = t.pos.length / 3;
    const aoVals = [];
    // atlas rect for this face; sides map v to world-Y (grass fringe on top),
    // horizontal faces map u,v to X,Z
    let rect = null;
    if (this.atlas) {
      const fname = face.dir[1] === 1 ? 'top' : face.dir[1] === -1 ? 'bottom' : 'side';
      rect = this.atlas.tileUV(id, fname);
    }
    for (let i = 0; i < 4; i++) {
      const c = face.corners[i];
      t.pos.push(x + c[0], y + c[1], z + c[2]);
      t.nrm.push(face.nrm[0], face.nrm[1], face.nrm[2]);
      const ao = AO_LEVELS[this.aoAt(x, y, z, face.ao[i])];
      const sky = 0.30 + 0.70 * this.skyLightAt(x + c[0], y + c[1], z + c[2]);
      const emit = def.light ? Math.min(1, def.light / 14) * 0.9 : 0;
      const lum = Math.max(emit, face.shade * ao * sky);
      t.col.push(baseCol.r * lum, baseCol.g * lum, baseCol.b * lum);
      if (rect) {
        const u = face.dir[1] === 0 ? (face.dir[0] !== 0 ? c[2] : c[0]) : c[0];
        const v = face.dir[1] === 0 ? c[1] : c[2];
        t.uv.push(rect[0] + u * (rect[2] - rect[0]), rect[1] + v * (rect[3] - rect[1]));
      }
      aoVals.push(ao);
    }
    // flip quad to reduce AO gradient artifacts
    if (aoVals[0] + aoVals[2] < aoVals[1] + aoVals[3])
      t.idx.push(start + 1, start + 2, start + 3, start + 1, start + 3, start + 0);
    else
      t.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  emitSlim(t, x, y, z, id, def) {
    const s = def.slim;
    const lowered = def.wire ? true : false;
    const cy = lowered ? 0.08 : 0.5;
    const hy = lowered ? 0.08 : s;
    const col = new THREE.Color(Array.isArray(def.col) ? def.col[1] : def.col);
    const sky = 0.4 + 0.6 * this.skyLightAt(x, y + 1, z);
    const lum = def.light ? 1.0 : 0.85 * sky;
    const rect = this.atlas ? this.atlas.tileUV(id, 'side') : null;
    for (const face of FACES) {
      const start = t.pos.length / 3;
      for (const c of face.corners) {
        const px = x + 0.5 + (c[0] - 0.5) * (s * 2);
        const py = y + cy + (c[1] - 0.5) * (hy * 2);
        const pz = z + 0.5 + (c[2] - 0.5) * (s * 2);
        t.pos.push(px, py, pz);
        t.nrm.push(face.nrm[0], face.nrm[1], face.nrm[2]);
        t.col.push(col.r * lum, col.g * lum, col.b * lum);
        if (rect) {
          // same per-face rule as emitFace, so no face collapses to a 1-D smear
          const u = face.dir[1] === 0 ? (face.dir[0] !== 0 ? c[2] : c[0]) : c[0];
          const v = face.dir[1] === 0 ? c[1] : c[2];
          t.uv.push(rect[0] + u * (rect[2] - rect[0]), rect[1] + v * (rect[3] - rect[1]));
        }
      }
      t.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }

  makeMesh(geoData, mat) {
    if (geoData.pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(geoData.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(geoData.col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(geoData.nrm, 3));
    if (geoData.uv && geoData.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(geoData.uv, 2));
    g.setIndex(geoData.idx);
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = true;
    // only opaque terrain casts/receives the sun shadow (transparent water
    // and cyst film shadowing itself reads as dirt on the lens)
    if (mat === this.material) { m.castShadow = true; m.receiveShadow = true; }
    return m;
  }

  rebuildChunk(key) {
    const [cx, cz] = key.split(',').map(Number);
    if (cx < 0 || cx >= CHUNKS_X || cz < 0 || cz >= CHUNKS_Z) return;
    const old = this.meshes.get(key);
    if (old) {
      if (old.opaque) { this.group.remove(old.opaque); old.opaque.geometry.dispose(); }
      if (old.trans) { this.group.remove(old.trans); old.trans.geometry.dispose(); }
    }
    const { op, tr } = this.buildChunkGeometry(cx, cz);
    const opaque = this.makeMesh(op, this.material);
    const trans = this.makeMesh(tr, this.transMaterial);
    if (opaque) this.group.add(opaque);
    if (trans) this.group.add(trans);
    this.meshes.set(key, { opaque, trans });
  }

  // Rebuild dirty chunks; cap per-frame work to keep the frame budget.
  flushDirty(limit = 64) {
    let n = 0;
    for (const key of this.dirty) {
      this.rebuildChunk(key);
      this.dirty.delete(key);
      if (++n >= limit) break;
    }
    return this.dirty.size;
  }

  buildAll() {
    for (const key of this.dirty) this.rebuildChunk(key);
    this.dirty.clear();
  }

  // Serialize edits (diff from generated baseline) for saving.
  serializeEdits() {
    const arr = [];
    for (const [k, v] of this.edits) { const [x, y, z] = k.split(',').map(Number); arr.push([x, y, z, v]); }
    return arr;
  }
  applyEdits(arr) {
    for (const [x, y, z, v] of arr) { this._set(x, y, z, v); this.edits.set(`${x},${y},${z}`, v); }
    for (let x = 0; x < SIZE_X; x++) for (let z = 0; z < SIZE_Z; z++) this.updateHeight(x, z);
    for (let cx = 0; cx < CHUNKS_X; cx++) for (let cz = 0; cz < CHUNKS_Z; cz++) this.dirty.add(this.chunkKey(cx, cz));
  }
}
