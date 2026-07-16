import * as THREE from 'three';
import { WORLD, B, BLOCKS } from './config.js';
import { RNG, fbm2, noise3, noise2 } from './rng.js';

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
    const s = this.seed;
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
    this.placeTrees();
    this.scatterSurface();
    this.buildLab();
    this.buildColonySeam();
    this.placeStartRefuge();

    for (let x = 0; x < SIZE_X; x++)
      for (let z = 0; z < SIZE_Z; z++) this.updateHeight(x, z);

    // Everything dirty initially.
    for (let cx = 0; cx < CHUNKS_X; cx++)
      for (let cz = 0; cz < CHUNKS_Z; cz++) this.dirty.add(this.chunkKey(cx, cz));
  }

  carveCaves() {
    const s = this.seed + 4001;
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
    // iron veins deeper, coal shallower
    const veins = 90;
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

  placeTrees() {
    const rng = this.rng.fork('tree');
    for (let x = 3; x < SIZE_X - 3; x++) {
      for (let z = 3; z < SIZE_Z - 3; z++) {
        const plainsMix = Math.min(1, Math.max(0, (x - SIZE_X * 0.55) / (SIZE_X * 0.4)));
        const density = 0.035 * (1 - plainsMix * 0.85);
        if (!rng.chance(density)) continue;
        const surf = this.surfaceY(x, z);
        if (this.get(x, surf, z) !== B.GRASS) continue;
        const th = rng.int(4, 6);
        for (let y = 1; y <= th; y++) this._set(x, surf + y, z, B.LOG);
        const top = surf + th;
        for (let dx = -2; dx <= 2; dx++)
          for (let dz = -2; dz <= 2; dz++)
            for (let dy = 0; dy <= 2; dy++) {
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
              const lx = x + dx, ly = top - 1 + dy, lz = z + dz;
              if (dy === 2 && (Math.abs(dx) > 1 || Math.abs(dz) > 1)) continue;
              if (this.get(lx, ly, lz) === B.AIR) this._set(lx, ly, lz, B.LEAVES);
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
        if (rng.chance(0.012)) this.pickups.push({ x: x + 0.5, y: surf + 1.3, z: z + 0.5, item: 'stone_shard', n: rng.int(1, 2) });
        else if (rng.chance(0.012)) this.pickups.push({ x: x + 0.5, y: surf + 1.3, z: z + 0.5, item: 'stick', n: rng.int(1, 2) });
        else if (rng.chance(0.006)) this.pickups.push({ x: x + 0.5, y: surf + 1.3, z: z + 0.5, item: 'fiber', n: rng.int(1, 3) });
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
    // a crafting bench inside
    this._set(sx - 1, surf + 1, sz + 1, B.BENCH);
    this.poi.spawn = { x: sx + 0.5, y: surf + 1, z: sz + 0.5 };
    this.poi.emergency = { x: sx + 1, y: surf + 1, z: sz + 1 };
  }

  spawnPoint() { return this.poi.spawn; }

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
    const op = { pos: [], col: [], nrm: [], idx: [] };
    const tr = { pos: [], col: [], nrm: [], idx: [] };
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (let x = x0; x < x0 + CHUNK; x++) {
      for (let z = z0; z < z0 + CHUNK; z++) {
        for (let y = 0; y < HEIGHT; y++) {
          const id = this.get(x, y, z);
          if (id === B.AIR) continue;
          const def = BLOCKS[id];
          if (!def || def.render === false) continue;
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
    for (let i = 0; i < 4; i++) {
      const c = face.corners[i];
      t.pos.push(x + c[0], y + c[1], z + c[2]);
      t.nrm.push(face.nrm[0], face.nrm[1], face.nrm[2]);
      const ao = AO_LEVELS[this.aoAt(x, y, z, face.ao[i])];
      const sky = 0.30 + 0.70 * this.skyLightAt(x + c[0], y + c[1], z + c[2]);
      const emit = def.light ? Math.min(1, def.light / 14) * 0.9 : 0;
      const lum = Math.max(emit, face.shade * ao * sky);
      t.col.push(baseCol.r * lum, baseCol.g * lum, baseCol.b * lum);
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
    for (const face of FACES) {
      const start = t.pos.length / 3;
      for (const c of face.corners) {
        const px = x + 0.5 + (c[0] - 0.5) * (s * 2);
        const py = y + cy + (c[1] - 0.5) * (hy * 2);
        const pz = z + 0.5 + (c[2] - 0.5) * (s * 2);
        t.pos.push(px, py, pz);
        t.nrm.push(face.nrm[0], face.nrm[1], face.nrm[2]);
        t.col.push(col.r * lum, col.g * lum, col.b * lum);
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
    g.setIndex(geoData.idx);
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = true;
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
