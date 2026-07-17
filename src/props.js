import { WORLD, B, BLOCKS } from './config.js';
import { buildProp, animateProp, disposeGroup } from './models.js';

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

  // One-time scan after generation + saved-edit replay.
  scanWorld() {
    this.removeAll();
    const { SIZE_X, SIZE_Z, HEIGHT } = WORLD;
    const w = this.game.world;
    for (let x = 0; x < SIZE_X; x++)
      for (let z = 0; z < SIZE_Z; z++)
        for (let y = 0; y < HEIGHT; y++) {
          const id = w.get(x, y, z);
          if (BLOCKS[id]?.model) this.add(x, y, z, id);
        }
  }

  add(x, y, z, id) {
    const def = BLOCKS[id];
    if (!def?.model) return;
    const k = this.key(x, y, z);
    if (this.map.has(k)) this.remove(x, y, z);
    const opts = {};
    if (def.model === 'door') {
      opts.open = id === B.DOOR_OPEN;
      opts.axis = this.doorAxis(x, y, z);
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
    const MACHINE_KINDS = new Set(['generator', 'drill', 'lamp', 'beacon', 'turret', 'cradle',
      'battery', 'switch', 'scrubber', 'uv', 'vibturret', 'sensor', 'maint', 'transit_panel']);
    for (const e of this.map.values()) {
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
