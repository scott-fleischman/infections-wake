import * as THREE from 'three';
import { B, BLOCKS, MACHINES, ITEMS, FUSE } from './config.js';

// Machine + power-network manager. Generators burn fuel to produce power;
// wires (and closed switches) connect them into networks; consumers draw from
// a network by priority, batteries buffer the difference, and sustained
// overload blows a fuse (§10.1–10.2). Running machines emit signatures.

const PRIORITY = {
  cradle: 0, beacon: 1, transit: 1, turret: 2, vibturret: 2, sensor: 2,
  lamp: 3, scrubber: 3, uv: 3, drill: 4,
};
const PRIO_NAMES = { 0: 'CRITICAL', 5: 'NORMAL', 9: 'LOW' };

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
    if (type === 'generator') { m.fuel = 0; m.enabled = true; m.fuseBlown = false; m.overloadT = 0; }
    if (type === 'drill') { m.buffer = {}; m.oreTarget = null; m.progress = 0; }
    if (type === 'turret') { m.heat = 0; m.ammo = 0; m.cd = 0; m.overheat = false; }
    if (type === 'vibturret') { m.cd = 0; }
    if (type === 'beacon') { m.charges = 0; m.registered = false; }
    if (type === 'cradle') { m.core = false; m.selected = true; }
    if (type === 'switch') { m.on = true; }
    if (type === 'battery') { m.charge = 0; }
    if (type === 'maint') { m.bank = 0; }  // repair-HP bank, loaded from planks
    if (type === 'uv') { m.cystT = 1; }
    if (type === 'transit') { m.relays = 0; m.filters = 0; }
    this.map.set(this.key(x, y, z), m);
    return m;
  }

  // Cycle a machine's power priority (§10.2 priority groups): the player can
  // pin critical systems ahead of comfort loads. Persisted with the machine.
  cyclePriority(m) {
    const cur = m.prio ?? 5;
    m.prio = cur === 5 ? 0 : cur === 0 ? 9 : 5;
    return PRIO_NAMES[m.prio];
  }
  prioOf(m) { return m.prio ?? PRIORITY[m.type] ?? 5; }
  prioName(m) { return m.prio != null ? PRIO_NAMES[m.prio] : 'AUTO'; }

  remove(x, y, z) {
    const k = this.key(x, y, z);
    const m = this.map.get(k);
    if (m) {
      this.game.sig.removeDynamic('M' + k);
      this.game.sig.removeDynamic('X' + k);   // exposed-cable hum dies with its generator
      this.game.lights.remove('M' + k);
      this.game.lights.remove('UVM' + k);     // UV emitter light
      // drop machine contents
      if (m.buffer) for (const [id, n] of Object.entries(m.buffer)) if (n > 0) this.game.dropItemAt({ x: x + 0.5, y: y + 1, z: z + 0.5 }, id, n);
      // a broken cradle gives its continuity core back — it is too rare to void
      if (m.type === 'cradle' && m.core) this.game.dropItemAt({ x: x + 0.5, y: y + 1, z: z + 0.5 }, 'continuity_core', 1);
      this.map.delete(k);
    }
  }

  get(x, y, z) { return this.map.get(this.key(x, y, z)); }

  // Is this cell a power conductor? Wires always; switches only while closed.
  isConductor(x, y, z) {
    const id = this.game.world.get(x, y, z);
    if (id === B.WIRE) return true;
    if (id === B.SWITCH) { const m = this.get(x, y, z); return !!(m && m.on); }
    return false;
  }

  // Build conductor networks and distribute power: generators feed consumers
  // by priority, batteries absorb surplus and cover deficits, and sustained
  // overload blows the network's generator fuses (§10.1).
  solvePower(dt = 0) {
    // reset
    for (const m of this.map.values()) if (m) m.powered = false;

    // Find connected conductor components via BFS.
    const wireComp = new Map(); // "x,y,z" -> compId
    const exposedByComp = new Map(); // compId -> sky-exposed wire count
    let compId = 0;
    const world = this.game.world;
    const visitWire = (sx, sy, sz, id) => {
      const stack = [[sx, sy, sz]];
      let exposed = 0;
      while (stack.length) {
        const [x, y, z] = stack.pop();
        const k = this.key(x, y, z);
        if (wireComp.has(k)) continue;
        if (!this.isConductor(x, y, z)) continue;
        wireComp.set(k, id);
        // §10.2: exposed cable is a readable electrical signature; buried
        // (covered) runs are quiet. Count open-sky conductor cells.
        if (world.skyTop(x, z) <= y) exposed++;
        stack.push([x+1,y,z],[x-1,y,z],[x,y+1,z],[x,y-1,z],[x,y,z+1],[x,y,z-1]);
      }
      exposedByComp.set(id, exposed);
    };
    // Networks are discovered by flooding out from each machine's adjacent
    // conductors — every powered link necessarily touches a machine somewhere.
    const seedWiresAround = (x, y, z) => {
      for (const [dx, dy, dz] of NEIGHBORS) {
        if (this.isConductor(x+dx, y+dy, z+dz)) {
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
      m.running = m.enabled && m.fuel > 0 && !m.fuseBlown;
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
    // capacity + generator list per merged network
    const capacity = new Map();
    const gensByRoot = new Map();
    for (const [g, c] of genComps) {
      const root = find(c);
      capacity.set(root, (capacity.get(root) || 0) + MACHINES.generator.powerOutput);
      if (!gensByRoot.has(root)) gensByRoot.set(root, []);
      gensByRoot.get(root).push(g);
    }
    const compOf = (c) => find(c);

    // consumers + batteries per merged network (deduped)
    const consumersByComp = new Map();
    const batteriesByComp = new Map();
    for (const m of this.map.values()) {
      if (!m || m.type === 'generator') continue;
      const roots = new Set([...this.adjacentComps(m, wireComp)].map(compOf));
      for (const c of roots) {
        const bucket = m.type === 'battery' ? batteriesByComp : consumersByComp;
        if (!bucket.has(c)) bucket.set(c, []);
        bucket.get(c).push(m);
      }
    }

    // distribute per component: generators first, then battery discharge
    let totalCap = 0, totalDem = 0, totalStored = 0;
    const roots = new Set([...consumersByComp.keys(), ...batteriesByComp.keys()]);
    for (const root of roots) {
      const cons = consumersByComp.get(root) || [];
      const bats = batteriesByComp.get(root) || [];
      let cap = capacity.get(root) || 0;
      const genCap = cap;
      totalCap += cap;
      let batAvail = 0;
      for (const b of bats) if (b.charge > 0.5) batAvail += Math.min(MACHINES.battery.dischargeRate, b.charge);
      let batDrawn = 0, unserved = 0;
      cons.sort((a, b) => this.prioOf(a) - this.prioOf(b));
      let demand = 0;
      for (const m of cons) {
        if (m.sterilizedT > 0) continue; // corroded offline (§18.3 valve 2)
        const draw = MACHINES[m.type].powerDraw;
        demand += draw;
        if (cap >= draw) { m.powered = true; cap -= draw; }
        else if (batAvail - batDrawn >= draw) { m.powered = true; m.onBattery = true; batDrawn += draw; }
        else unserved += draw;
      }
      totalDem += demand;
      // integrate battery charge/discharge over this frame
      if (dt > 0 && bats.length) {
        if (batDrawn > 0) {
          // drain proportionally from charged banks
          let remaining = batDrawn * dt;
          for (const b of bats) {
            if (remaining <= 0 || b.charge <= 0) continue;
            const take = Math.min(b.charge, remaining);
            b.charge -= take; remaining -= take;
          }
        } else if (cap > 0) {
          for (const b of bats) {
            if (cap <= 0) break;
            const room = MACHINES.battery.capacity - b.charge;
            if (room <= 0) continue;
            const rate = Math.min(MACHINES.battery.chargeRate, cap);
            b.charge = Math.min(MACHINES.battery.capacity, b.charge + rate * dt);
            cap -= rate;
          }
        }
      }
      for (const b of bats) totalStored += b.charge;
      // §10.1 overload protection: consumers left unserved while demand far
      // exceeds generation (batteries can't bridge it) blows the fuses.
      const gens = gensByRoot.get(root) || [];
      const overloaded = genCap > 0 && unserved > 0 && demand > genCap * FUSE.overloadRatio;
      for (const g of gens) {
        if (overloaded) {
          g.overloadT = (g.overloadT || 0) + dt;
          if (g.overloadT > FUSE.overloadSeconds && !g.fuseBlown) {
            g.fuseBlown = true;
            this.game.toast('FUSE BLOWN — generator overloaded. Replace the fuse at the generator.', 'bad');
          }
        } else g.overloadT = 0;
      }
      // exposed cable hums: the network's electrical signature scales with
      // how much of its run is open to the sky (bury cable to silence it)
      if (gens.length) {
        let exposed = 0;
        for (const [c, n] of exposedByComp) if (find(c) === root) exposed += n;
        const g0 = gens[0];
        const key = 'X' + this.key(g0.x, g0.y, g0.z);
        if (exposed > 0) this.game.sig.setDynamic(key, g0.x, g0.y + 1, g0.z, { electrical: Math.min(0.6, exposed * 0.04) }, 34);
        else this.game.sig.removeDynamic(key);
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
      cons.sort((a, b) => this.prioOf(a) - this.prioOf(b));
      for (const c of cons) {
        if (c.powered) continue; // already fed by a wire network
        const draw = MACHINES[c.type].powerDraw;
        totalDem += draw;
        if (cap >= draw) { c.powered = true; cap -= draw; }
      }
    }

    this.networkPower = { capacity: totalCap, demand: totalDem, stored: Math.round(totalStored) };
  }

  replaceFuse(m, inv) {
    if (!m.fuseBlown) { this.game.toast('Fuse intact.'); return; }
    const [id, n] = Object.entries(FUSE.repairCost)[0];
    if (inv.count(id) < n) { this.game.toast(`Need ${n}× ${ITEMS[id].name} for a fuse.`); return; }
    inv.remove(id, n);
    m.fuseBlown = false; m.overloadT = 0;
    this.game.toast('Fuse replaced. Mind the load this time.', 'important');
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
    this.solvePower(dt);
    for (const m of this.map.values()) if (m) this.updateMachine(m, dt);
  }

  updateMachine(m, dt) {
    const key = 'M' + this.key(m.x, m.y, m.z);
    const cfg = MACHINES[m.type];
    let running = false;
    if (m.sterilizedT > 0) m.sterilizedT = Math.max(0, m.sterilizedT - dt);

    if (m.type === 'generator') {
      running = m.running;
      if (running) { m.fuel = Math.max(0, m.fuel - cfg.fuelPerSec * dt); if (m.fuel === 0) this.game.toast('Generator ran dry.', 'important'); }
      if (!running) this.game.sig.removeDynamic('X' + this.key(m.x, m.y, m.z)); // exposed-cable hum dies with it
    } else if (m.type === 'switch') {
      running = m.on; // conductor state, not a power draw
    } else if (m.type === 'battery') {
      running = m.charge > 0.5;
    } else {
      running = m.powered;
    }
    m.running = running;

    // signature + light emission. §18.3 valve 1: failed heat regulation makes
    // every warm machine louder until the reservoir is purged.
    if (running && cfg.emits) {
      let emits = cfg.emits;
      if (this.game.deep?.heatFailed && !this.game.deep?.purged && emits.heat) {
        emits = { ...emits, heat: emits.heat * 1.5 };
      }
      this.game.sig.setDynamic(key, m.x, m.y, m.z, emits, cfg.radius);
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
    } else if (m.type === 'vibturret') {
      this.updateVibTurret(m, dt, running);
    } else if (m.type === 'uv') {
      this.updateUV(m, dt, running);
    } else if (m.type === 'maint') {
      this.updateMaint(m, dt);
    } else if (m.type === 'beacon') {
      if (running) this.game.lights.set(key, m.x + 0.5, m.y + 1, m.z + 0.5, 0x7fae62, 0.6, 6);
      else this.game.lights.remove(key);
    }
    // scrubber/sensor/transit effects are queried by main.js/director — the
    // solver already set their running state and emitters above
  }

  // Vibration turret (§9.4): senses movement through the ground — no line of
  // sight needed, and it is the only defense that reads burrowers underground.
  updateVibTurret(m, dt, running) {
    m.cd = Math.max(0, m.cd - dt);
    if (!running) { m._aim = null; return; }
    const cfg = MACHINES.vibturret;
    const origin = new THREE.Vector3(m.x + 0.5, m.y + 0.6, m.z + 0.5);
    let best = null, bestD = cfg.range;
    for (const inf of this.game.infected.list) {
      if (inf.dead || inf.isFalse) continue;
      const d = origin.distanceTo(new THREE.Vector3(inf.pos.x, inf.pos.y + 0.5, inf.pos.z));
      if (d < bestD) { best = inf; bestD = d; }
    }
    m._aim = best ? { x: best.pos.x, y: best.pos.y + 0.5, z: best.pos.z } : null;
    if (best && m.cd <= 0) {
      best.takeHit(cfg.dmg, true, { x: m.x, y: m.y, z: m.z });
      m.cd = cfg.fireRate;
      this.game.spawnHitSpark(best.pos, 0xe0a83e);
    }
  }

  // UV sterilizer (§9.4): burns exposed colony film and nearby infected with
  // line of sight. Limited against deep tissue; useless through walls.
  updateUV(m, dt, running) {
    const key = 'M' + this.key(m.x, m.y, m.z);
    if (!running) { this.game.lights.remove('UV' + key); return; }
    const cfg = MACHINES.uv;
    this.game.lights.set('UV' + key, m.x + 0.5, m.y + 1, m.z + 0.5, 0x8a5ad4, 0.7, cfg.range + 2);
    const origin = new THREE.Vector3(m.x + 0.5, m.y + 1, m.z + 0.5);
    for (const inf of this.game.infected.list) {
      if (inf.dead || inf.isFalse) continue;
      const d = origin.distanceTo(new THREE.Vector3(inf.pos.x, inf.pos.y + 0.8, inf.pos.z));
      if (d > cfg.range) continue;
      if (this.game.sig.wallAtten(origin.x, origin.y, origin.z, inf.pos.x, inf.pos.y + 0.8, inf.pos.z) < 0.95) continue;
      inf.takeHit(cfg.dps * dt, true, { x: m.x, y: m.y, z: m.z }); // burned → attack the burner (§12.3)
    }
    // erode one cyst film block at a time within range
    m.cystT -= dt;
    if (m.cystT <= 0) {
      m.cystT = 1 / cfg.cystPerSec;
      const r = cfg.range;
      outer:
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -2; dy <= 2; dy++)
          for (let dz = -r; dz <= r; dz++) {
            const x = m.x + dx, y = m.y + dy, z = m.z + dz;
            if (this.game.world.get(x, y, z) !== B.CYST) continue;
            if (this.game.sig.wallAtten(origin.x, origin.y, origin.z, x + 0.5, y + 0.5, z + 0.5) < 0.95) continue;
            this.game.world.set(x, y, z, B.AIR);
            this.game.clearBlockCell(x, y, z, B.CYST);
            break outer;
          }
    }
  }

  // Maintenance bench (§6.7): slowly heals damaged (not destroyed) structures
  // nearby from a plank-fed repair bank. Manual emergency repair stays faster.
  updateMaint(m, dt) {
    if (m.bank <= 0) return;
    const cfg = MACHINES.maint;
    const g = this.game;
    let budget = cfg.repairPerSec * dt;
    for (const [key, hp] of g.blockHp) {
      if (budget <= 0 || m.bank <= 0) break;
      const [x, y, z] = key.split(',').map(Number);
      if (Math.abs(x - m.x) > cfg.radius || Math.abs(y - m.y) > 4 || Math.abs(z - m.z) > cfg.radius) continue;
      const def = BLOCKS[g.world.get(x, y, z)];
      if (!def || !def.solid) { g.blockHp.delete(key); continue; }
      const maxHp = (def.armor || 1) * (def.hardness || 1) * 8;
      const heal = Math.min(budget, m.bank, maxHp - hp);
      if (heal <= 0) { g.blockHp.delete(key); continue; }
      budget -= heal; m.bank -= heal;
      const nhp = hp + heal;
      if (nhp >= maxHp) g.blockHp.delete(key); else g.blockHp.set(key, nhp);
    }
  }

  loadPlanks(m, inv) {
    if (inv.count('b:' + B.PLANK) <= 0) { this.game.toast('No planks to stock.'); return; }
    inv.remove('b:' + B.PLANK, 1);
    m.bank += MACHINES.maint.plankPerRepair;
    this.game.toast('Maintenance stock loaded.');
  }

  updateDrill(m, dt, running) {
    if (!running) return;
    // §10.3: a drill stops when full — output must be collected or it idles
    const buffered = Object.values(m.buffer || {}).reduce((a, b) => a + b, 0);
    if (buffered >= 24) { m.full = true; return; }
    m.full = false;
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
  // Nearest ore in a small working radius (Factorio-style): a drill parked on
  // a dense hill deposit eats through the local body, nearest block first,
  // then idles when the deposit is spent.
  findOre(m) {
    let best = null, bestD = Infinity;
    for (let dy = -2; dy <= 1; dy++)
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          if (!dx && !dy && !dz) continue;
          const x = m.x + dx, y = m.y + dy, z = m.z + dz;
          const id = this.game.world.get(x, y, z);
          if (id !== B.IRON_ORE && id !== B.COAL_ORE) continue;
          const d = dx * dx + dy * dy * 0.5 + dz * dz; // slight preference downward
          if (d < bestD) { bestD = d; best = { x, y, z, id }; }
        }
    return best;
  }

  updateTurret(m, dt, running) {
    m.cd = Math.max(0, m.cd - dt);
    const cfg = MACHINES.turret;
    if (m.heat > 0) m.heat = Math.max(0, m.heat - cfg.heatCool * dt);
    if (m.overheat && m.heat < cfg.heatMax * 0.4) m.overheat = false;
    if (!running) { m._aim = null; return; }
    // acquire nearest infected in range with line of sight — done every frame
    // (even while cooling down) so the visual head tracks its target
    const origin = new THREE.Vector3(m.x + 0.5, m.y + 0.9, m.z + 0.5);
    let best = null, bestD = cfg.range;
    for (const inf of this.game.infected.list) {
      if (inf.dead || inf.isFalse) continue;
      if (inf.s.cold) continue; // §9.4 target-class rule: cold cyst masses are invisible to a warm-body turret
      const d = origin.distanceTo(new THREE.Vector3(inf.pos.x, inf.pos.y + 0.8, inf.pos.z));
      if (d > bestD) continue;
      const clear = this.game.sig.wallAtten(origin.x, origin.y, origin.z, inf.pos.x, inf.pos.y + 0.8, inf.pos.z);
      if (clear < 0.95) continue; // needs true line of sight (§9.4 blocked LOS limits turrets)
      best = inf; bestD = d;
    }
    m._aim = best ? { x: best.pos.x, y: best.pos.y + 0.8, z: best.pos.z } : null;
    if (m.overheat || m.ammo <= 0 || m.cd > 0) return;
    if (best) {
      best.takeHit(cfg.dmg, true, { x: m.x, y: m.y, z: m.z }); // source → retaliation target (§12.3)
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
  // Install the rare continuity component in a cradle (§13.2).
  loadCore(m, inv) {
    if (m.core) { this.game.toast('Continuity core already seated.'); return; }
    if (inv.count('continuity_core') <= 0) { this.game.toast('No continuity core. The reservoir vault held one.'); return; }
    inv.remove('continuity_core', 1);
    m.core = true;
    // §13.2: only one cradle is active at a time — seating a core selects it
    this.selectCradle(m);
    this.game.toast('Continuity core seated. Keep it powered — at the moment you die, not after.', 'important');
    this.game.hud.updateRecovery();
  }
  selectCradle(m) {
    for (const o of this.map.values()) if (o && o.type === 'cradle') o.selected = o === m;
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
