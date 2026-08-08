import { WORLD, B, BLOCKS } from './config.js';
import { BED_DIR } from './multiblock.js';
import { buildProp, animateProp, disposeGroup } from './models.js';

// prop kinds whose animation state follows a machine entry (queried per frame)
const MACHINE_KINDS = new Set(['generator', 'drill', 'lamp', 'beacon', 'turret', 'cradle',
  'battery', 'switch', 'scrubber', 'uv', 'vibturret', 'sensor', 'maint', 'transit_panel']);

// Prop meshes for model-rendered blocks (config `model:` flag). The world data
// still holds the block id — collision, mining, chewing and power all work on
// the voxel grid; this manager only owns the detailed visual standing in the
// cell, plus its animation state (turret aim, generator flywheel, fire).

export class Props {
  constructor(game) {
    this.game = game;
    this.map = new Map(); // "x,y,z" -> { group, kind, x, y, z, id }
    this.t = 0;
  }

  key(x, y, z) { return `${x},${y},${z}`; }

  // One-time scan after generation + saved-edit replay. Worldgen only puts
  // model-rendered blocks inside the story core (benches, doors, archives,
  // the kiln...); anything the player built out in the wilderness lives in
  // the edit log, so core rect + edits covers every prop in the world.
  scanWorld() {
    this.removeAll();
    const { CORE_X, CORE_Z, HEIGHT } = WORLD;
    const w = this.game.world;
    for (let x = 0; x < CORE_X; x++)
      for (let z = 0; z < CORE_Z; z++)
        for (let y = 0; y < HEIGHT; y++) {
          const id = w.get(x, y, z);
          if (BLOCKS[id]?.model) this.add(x, y, z, id);
        }
    for (const [k, id] of w.edits) {
      if (!BLOCKS[id]?.model) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (x >= 0 && x < CORE_X && z >= 0 && z < CORE_Z) continue; // already scanned
      this.add(x, y, z, id);
    }
  }

  add(x, y, z, id) {
    const def = BLOCKS[id];
    // 'none' = the far cell of a multi-block; its owner's prop covers both
    if (!def?.model || def.model === 'none') return;
    const k = this.key(x, y, z);
    if (this.map.has(k)) this.remove(x, y, z);
    const opts = {};
    if (def.model === 'door') {
      opts.open = id === B.DOOR_OPEN;
      opts.axis = this.doorAxis(x, y, z);
      const above = this.game.world.get(x, y + 1, z);
      opts.tall = above === B.DOOR_TOP || above === B.DOOR_TOP_OPEN;
    }
    if (def.model === 'bed') {
      const d = BED_DIR[id];
      opts.dir = d;
      opts.long = this.game.world.get(x + d[0], y, z + d[1]) === B.BED_FOOT;
    }
    if (def.model === 'archive') opts.tint = Array.isArray(def.col) ? def.col[0] : def.col;
    if (def.model === 'valve') {
      const v = (this.game.world.poi.deep?.valves || []).find(v => v.x === x && v.y === y && v.z === z);
      opts.open = v ? !!this.game.deep?.valves?.[v.index - 1] : false;
    }
    if (def.model === 'transit_gate') opts.open = !!this.game.transit?.restored;
    const group = buildProp(def.model, opts);
    group.position.set(x + 0.5, y, z + 0.5);
    group.userData.sweepSeed = (x * 7 + z * 13) % 10;
    // props sit in the sun's shadow pass (glow parts are MeshBasic — unlit,
    // so casting is what matters visually). Slim props (torches, wires,
    // sensors) skip casting: invisible shadows, real draw calls.
    if (!def.slim) {
      group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    }
    this.game.scene.add(group);
    this.map.set(k, { group, kind: def.model, x, y, z, id });
  }

  // Orient a door slab across the doorway: if the wall runs along X (solid
  // neighbors at x±1), the slab spans X; otherwise it spans Z.
  doorAxis(x, y, z) {
    const solid = (dx, dz) => BLOCKS[this.game.world.get(x + dx, y, z + dz)]?.solid;
    if (solid(1, 0) || solid(-1, 0)) return 'x';
    if (solid(0, 1) || solid(0, -1)) return 'z';
    return 'x';
  }

  remove(x, y, z) {
    const k = this.key(x, y, z);
    const e = this.map.get(k);
    if (!e) return;
    this.game.scene.remove(e.group);
    disposeGroup(e.group);
    this.map.delete(k);
  }

  onBlockChanged(x, y, z, id) {
    this.remove(x, y, z);
    if (BLOCKS[id]?.model) this.add(x, y, z, id);
  }

  removeAll() {
    for (const e of this.map.values()) {
      this.game.scene.remove(e.group);
      disposeGroup(e.group);
    }
    this.map.clear();
  }

  update(dt) {
    this.t += dt;
    const g = this.game;
    const p = g.player?.pos;
    for (const e of this.map.values()) {
      // distance cull: a fog-shrouded prop 100+ blocks out costs draw calls
      // (and a shadow-pass draw) for nothing. Simulation is unaffected —
      // machines/furnaces run on world data, this is only their visual.
      if (p) {
        const vis = Math.abs(e.x + 0.5 - p.x) < 104 && Math.abs(e.z + 0.5 - p.z) < 104;
        if (e.group.visible !== vis) e.group.visible = vis;
        if (!vis) continue;
      }
      const state = { dt, running: true, aimYaw: null };
      if (MACHINE_KINDS.has(e.kind)) {
        const m = g.machines.get(e.x, e.y, e.z);
        state.running = !!(m && m.running);
        if (e.kind === 'beacon' && m) state.running = !!(m.running && m.registered && m.charges > 0);
        if (e.kind === 'switch' && m) state.running = !!m.on; // lever + lamp follow the circuit
        if (e.kind === 'turret' || e.kind === 'vibturret') {
          if (m && m._aim) state.aimYaw = Math.atan2(m._aim.x - (e.x + 0.5), m._aim.z - (e.z + 0.5));
          else if (!state.running) state.aimYaw = 0; // dead turret rests, no idle sweep
        }
      } else if (e.kind === 'furnace' || e.kind === 'kiln') {
        const f = g.furnaces.get(this.key(e.x, e.y, e.z));
        state.running = !!(f && f.fuel > 0 && f.queue.length > 0);
      }
      animateProp(e.group, this.t, state);
    }
  }
}
