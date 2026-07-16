import * as THREE from 'three';
import { B, BLOCKS, MACHINES, ITEMS } from './config.js';

// Machine + power-network manager. Generators burn fuel to produce power;
// wires connect them into networks; consumers (lamp/drill/turret/beacon) draw
// from a network by priority. Running machines emit signatures (§10.2).

const PRIORITY = { cradle: 0, beacon: 1, turret: 2, lamp: 3, drill: 4 };

export class Machines {
  constructor(game) {
    this.game = game;
    this.map = new Map();   // "x,y,z" -> machine state
    this.networkPower = { capacity: 0, demand: 0 };
  }

  key(x, y, z) { return `${x},${y},${z}`; }

  add(x, y, z, id) {
    const def = BLOCKS[id];
    const type = def.machine;
    if (!type) return;
    const m = { x, y, z, id, type, on: false, running: false };
    if (type === 'generator') { m.fuel = 0; m.enabled = true; }
    if (type === 'drill') { m.buffer = {}; m.oreTarget = null; m.progress = 0; }
    if (type === 'turret') { m.heat = 0; m.ammo = 0; m.cd = 0; m.overheat = false; }
    if (type === 'beacon') { m.charges = 0; m.registered = false; }
    if (type === 'cradle') { m.core = false; }
    this.map.set(this.key(x, y, z), m);
    return m;
  }

  remove(x, y, z) {
    const k = this.key(x, y, z);
    const m = this.map.get(k);
    if (m) {
      this.game.sig.removeDynamic('M' + k);
      this.game.lights.remove('M' + k);
      // drop machine contents
      if (m.buffer) for (const [id, n] of Object.entries(m.buffer)) if (n > 0) this.game.dropItemAt({ x: x + 0.5, y: y + 1, z: z + 0.5 }, id, n);
      this.map.delete(k);
    }
  }

  get(x, y, z) { return this.map.get(this.key(x, y, z)); }

  // Is this cell a power conductor (wire) or a machine block?
  isWire(x, y, z) { return this.game.world.get(x, y, z) === B.WIRE; }

  // Build wire networks and distribute generator power to consumers.
  solvePower() {
    // reset
    for (const m of this.map.values()) if (m) m.powered = false;

    // Find connected wire components via BFS.
    const wireComp = new Map(); // "x,y,z" -> compId
    let compId = 0;
    const world = this.game.world;
    const visitWire = (sx, sy, sz, id) => {
      const stack = [[sx, sy, sz]];
      while (stack.length) {
        const [x, y, z] = stack.pop();
        const k = this.key(x, y, z);
        if (wireComp.has(k)) continue;
        if (world.get(x, y, z) !== B.WIRE) continue;
        wireComp.set(k, id);
        stack.push([x+1,y,z],[x-1,y,z],[x,y+1,z],[x,y-1,z],[x,y,z+1],[x,y,z-1]);
      }
    };
    // Wire networks are discovered by flooding out from each machine's adjacent
    // wires — every powered link necessarily touches a machine at both ends.
    const seedWiresAround = (x, y, z) => {
      for (const [dx, dy, dz] of NEIGHBORS) {
        if (world.get(x+dx, y+dy, z+dz) === B.WIRE) {
          const k = this.key(x+dx, y+dy, z+dz);
          if (!wireComp.has(k)) { visitWire(x+dx, y+dy, z+dz, compId++); }
        }
      }
    };
    for (const m of this.map.values()) if (m) seedWiresAround(m.x, m.y, m.z);

    // A generator touching several wire components merges them into one
    // network — output must not be double-counted per component.
    const parent = new Map();
    const find = (a) => { while (parent.get(a) !== a) a = parent.get(a); return a; };
    const union = (a, b) => { parent.set(find(a), find(b)); };
    for (const c of new Set(wireComp.values())) parent.set(c, c);

    const directLinks = []; // [generator, consumer] adjacency without wires
    const genComps = [];
    for (const m of this.map.values()) {
      if (!m || m.type !== 'generator') continue;
      m.running = m.enabled && m.fuel > 0;
      if (!m.running) continue;
      const comps = [...this.adjacentComps(m, wireComp)];
      if (comps.length === 0) {
        // no wires: still power directly adjacent consumers
        for (const c of this.adjacentConsumers(m)) directLinks.push([m, c, MACHINES.generator.powerOutput]);
      } else {
        for (let i = 1; i < comps.length; i++) union(comps[0], comps[i]);
        genComps.push([m, comps[0]]);
      }
    }
    // capacity per merged network
    const capacity = new Map();
    for (const [, c] of genComps) {
      const root = find(c);
      capacity.set(root, (capacity.get(root) || 0) + MACHINES.generator.powerOutput);
    }
    const compOf = (c) => find(c);

    // consumers per merged network (deduped — a consumer may touch many wires)
    const consumersByComp = new Map();
    for (const m of this.map.values()) {
      if (!m || m.type === 'generator') continue;
      const roots = new Set([...this.adjacentComps(m, wireComp)].map(compOf));
      for (const c of roots) {
        if (!consumersByComp.has(c)) consumersByComp.set(c, []);
        consumersByComp.get(c).push(m);
      }
    }

    // distribute per component by priority
    let totalCap = 0, totalDem = 0;
    for (const [c, cons] of consumersByComp) {
      let cap = capacity.get(c) || 0;
      totalCap += cap;
      cons.sort((a, b) => (PRIORITY[a.type] ?? 9) - (PRIORITY[b.type] ?? 9));
      for (const m of cons) {
        const draw = MACHINES[m.type].powerDraw;
        totalDem += draw;
        if (cap >= draw) { m.powered = true; cap -= draw; }
      }
    }
    // direct links (no wire): each generator's output is a real budget too
    const directByGen = new Map();
    for (const [gen, c] of directLinks) {
      if (!directByGen.has(gen)) directByGen.set(gen, []);
      directByGen.get(gen).push(c);
    }
    for (const [gen, cons] of directByGen) {
      let cap = MACHINES.generator.powerOutput;
      totalCap += cap;
      cons.sort((a, b) => (PRIORITY[a.type] ?? 9) - (PRIORITY[b.type] ?? 9));
      for (const c of cons) {
        if (c.powered) continue; // already fed by a wire network
        const draw = MACHINES[c.type].powerDraw;
        totalDem += draw;
        if (cap >= draw) { c.powered = true; cap -= draw; }
      }
    }

    this.networkPower = { capacity: totalCap, demand: totalDem };
  }

  adjacentComps(m, wireComp) {
    const set = new Set();
    for (const [dx, dy, dz] of NEIGHBORS) {
      const k = this.key(m.x+dx, m.y+dy, m.z+dz);
      if (wireComp.has(k)) set.add(wireComp.get(k));
    }
    return set;
  }
  adjacentConsumers(gen) {
    const out = [];
    for (const [dx, dy, dz] of NEIGHBORS) {
      const c = this.get(gen.x+dx, gen.y+dy, gen.z+dz);
      if (c && c.type !== 'generator') out.push(c);
    }
    return out;
  }

  update(dt) {
    this.solvePower();
    for (const m of this.map.values()) if (m) this.updateMachine(m, dt);
  }

  updateMachine(m, dt) {
    const key = 'M' + this.key(m.x, m.y, m.z);
    const cfg = MACHINES[m.type];
    let running = false;

    if (m.type === 'generator') {
      running = m.running;
      if (running) { m.fuel = Math.max(0, m.fuel - cfg.fuelPerSec * dt); if (m.fuel === 0) this.game.toast('Generator ran dry.', 'important'); }
    } else {
      running = m.powered;
    }
    m.running = running;

    // signature + light emission
    if (running && cfg.emits) {
      this.game.sig.setDynamic(key, m.x, m.y, m.z, cfg.emits, cfg.radius);
    } else {
      this.game.sig.removeDynamic(key);
    }

    // type-specific behavior
    if (m.type === 'lamp') {
      if (running) this.game.lights.set(key, m.x + 0.5, m.y + 0.5, m.z + 0.5, 0xffe6a8, 1.5, cfg.light);
      else this.game.lights.remove(key);
    } else if (m.type === 'generator') {
      if (running) this.game.lights.set(key, m.x + 0.5, m.y + 1.2, m.z + 0.5, 0xe0a83e, 0.8, 8);
      else this.game.lights.remove(key);
    } else if (m.type === 'drill') {
      this.updateDrill(m, dt, running);
    } else if (m.type === 'turret') {
      this.updateTurret(m, dt, running);
    } else if (m.type === 'beacon') {
      if (running) this.game.lights.set(key, m.x + 0.5, m.y + 1, m.z + 0.5, 0x7fae62, 0.6, 6);
      else this.game.lights.remove(key);
    }
  }

  updateDrill(m, dt, running) {
    if (!running) return;
    // find/keep an ore target below or adjacent
    if (!m.oreTarget || !this.isOre(m.oreTarget)) {
      m.oreTarget = this.findOre(m);
      m.progress = 0;
    }
    if (!m.oreTarget) return;
    m.progress += MACHINES.drill.orePerSec * dt;
    if (m.progress >= 1) {
      m.progress = 0;
      const { x, y, z, id } = m.oreTarget;
      const itemId = id === B.IRON_ORE ? 'iron_ore_raw' : id === B.COAL_ORE ? 'coal' : 'stone_shard';
      m.buffer[itemId] = (m.buffer[itemId] || 0) + 1;
      this.game.world.set(x, y, z, B.AIR);
      this.game.onWorldEditVisual(x, y, z);
      m.oreTarget = null;
    }
  }
  isOre(t) { const id = this.game.world.get(t.x, t.y, t.z); return id === B.IRON_ORE || id === B.COAL_ORE; }
  findOre(m) {
    const cand = [[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,1],[0,-1,-1]];
    for (const [dx, dy, dz] of cand) {
      const x = m.x+dx, y = m.y+dy, z = m.z+dz;
      const id = this.game.world.get(x, y, z);
      if (id === B.IRON_ORE || id === B.COAL_ORE) return { x, y, z, id };
    }
    return null;
  }

  updateTurret(m, dt, running) {
    m.cd = Math.max(0, m.cd - dt);
    const cfg = MACHINES.turret;
    if (m.heat > 0) m.heat = Math.max(0, m.heat - cfg.heatCool * dt);
    if (m.overheat && m.heat < cfg.heatMax * 0.4) m.overheat = false;
    if (!running || m.overheat || m.ammo <= 0) return;
    if (m.cd > 0) return;
    // acquire nearest infected in range with line of sight
    const origin = new THREE.Vector3(m.x + 0.5, m.y + 0.9, m.z + 0.5);
    let best = null, bestD = cfg.range;
    for (const inf of this.game.infected.list) {
      if (inf.dead || inf.isFalse) continue;
      const d = origin.distanceTo(new THREE.Vector3(inf.pos.x, inf.pos.y + 0.8, inf.pos.z));
      if (d > bestD) continue;
      const clear = this.game.sig.wallAtten(origin.x, origin.y, origin.z, inf.pos.x, inf.pos.y + 0.8, inf.pos.z);
      if (clear < 0.95) continue; // needs true line of sight (§9.4 blocked LOS limits turrets)
      best = inf; bestD = d;
    }
    if (best) {
      best.takeHit(cfg.dmg, true);
      m.ammo--; m.cd = cfg.fireRate; m.heat += cfg.heatPerShot;
      if (m.heat >= cfg.heatMax) { m.overheat = true; this.game.toast('Turret overheated.', 'important'); }
      this.game.spawnTracer(origin, new THREE.Vector3(best.pos.x, best.pos.y + 0.8, best.pos.z), 0x74c7c4);
    }
  }

  loadFuel(m, inv) {
    // load one coal
    if (inv.count('coal') <= 0) { this.game.toast('No coal to load.'); return; }
    if (m.fuel >= MACHINES.generator.fuelCapacity) { this.game.toast('Generator full.'); return; }
    inv.remove('coal', 1);
    m.fuel = Math.min(MACHINES.generator.fuelCapacity, m.fuel + (ITEMS.coal.fuel || 8));
    this.game.toast('Loaded coal.');
  }
  loadAmmo(m, inv) {
    const n = inv.count('turret_ammo');
    if (n <= 0) { this.game.toast('No turret slugs.'); return; }
    const put = Math.min(n, 40 - m.ammo);
    inv.remove('turret_ammo', put); m.ammo += put;
    this.game.toast(`Loaded ${put} slugs.`);
  }
  loadCharge(m, inv) {
    if (inv.count('iron_ampoule') <= 0) { this.game.toast('No biotic ampoule.'); return; }
    inv.remove('iron_ampoule', 1); m.charges++;
    this.game.toast(`Beacon charged (${m.charges}).`, 'important');
  }
  collect(m, inv) {
    let any = false, stuck = false;
    for (const [id, n] of Object.entries(m.buffer || {})) {
      if (n > 0) {
        const overflow = inv.add(id, n);   // anything that doesn't fit stays in the buffer
        if (overflow < n) any = true;
        if (overflow > 0) stuck = true;
        m.buffer[id] = overflow;
      }
    }
    if (stuck) this.game.toast('Inventory full — some output left in the drill.');
    else if (any) this.game.toast('Collected drill output.');
    else this.game.toast('Drill buffer empty.');
  }

  serialize() {
    return [...this.map.values()].filter(Boolean).map(m => ({ ...m }));
  }
  load(arr) {
    this.map.clear();
    for (const m of arr) this.map.set(this.key(m.x, m.y, m.z), m);
  }
}

const NEIGHBORS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
