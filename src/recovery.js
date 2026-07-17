import * as THREE from 'three';
import { RECOVERY, PLAYER } from './config.js';

// Death & staged recovery (§13). The ladder is checked in order:
//   Lazarus cradle (powered+core) → field beacon (powered+charge+registered)
//   → one-time emergency refuge recovery → run failure.
// Power must be valid at the MOMENT of death — no hidden reserve (§13.2).

export class Recovery {
  constructor(game, hardcore = false) {
    this.game = game;
    this.hardcore = hardcore;
    this.emergencyUses = hardcore ? 0 : RECOVERY.emergencyUses;
    this.graves = [];
  }

  // Evaluate the best currently-valid recovery option.
  bestOption() {
    const g = this.game;
    // cradle — steel-tier spawn machine (§13.2). Only the SELECTED cradle is
    // active; it must hold a core and be powered at the moment of death.
    for (const m of g.machines.map.values()) {
      if (m && m.type === 'cradle' && m.core && m.running && m.selected !== false) return { kind: 'cradle', m };
    }
    // beacon
    for (const m of g.machines.map.values()) {
      if (m && m.type === 'beacon' && m.registered && m.running && m.charges > 0) return { kind: 'beacon', m };
    }
    if (this.emergencyUses > 0) return { kind: 'emergency' };
    return null;
  }

  statusLine() {
    const g = this.game;
    // cradle present?
    let cradle = null, beacon = null;
    for (const m of g.machines.map.values()) {
      if (!m) continue;
      if (m.type === 'cradle' && (!cradle || m.selected !== false)) cradle = m;
      if (m.type === 'beacon' && m.registered) beacon = m;
    }
    if (cradle) {
      if (cradle.core && cradle.running) return { text: 'Recovery secured: Lazarus Cradle powered', cls: 'rec-ok' };
      if (cradle.core) return { text: 'Recovery at risk: cradle offline', cls: 'rec-bad' };
    }
    if (beacon) {
      if (beacon.running && beacon.charges > 0) return { text: `Field beacon available: ${beacon.charges} charge${beacon.charges > 1 ? 's' : ''}`, cls: 'rec-ok' };
      if (beacon.charges > 0) return { text: 'Field beacon unpowered', cls: 'rec-warn' };
      return { text: 'Field beacon: no charge', cls: 'rec-warn' };
    }
    if (this.emergencyUses > 0) return { text: 'Emergency refuge recovery unused', cls: 'rec-warn' };
    return { text: 'No recovery available', cls: 'rec-bad' };
  }

  // Called on death. Returns {respawn:{x,y,z}} or null (=> run failure).
  resolve() {
    const g = this.game;
    const opt = this.bestOption();
    const deathPos = g.player.pos.clone();
    // drop full inventory into a gravestone at the death location
    this.dropGrave(deathPos);

    if (!opt) return null;

    let respawn;
    if (opt.kind === 'cradle') { respawn = { x: opt.m.x + 0.5, y: opt.m.y + 1, z: opt.m.z + 1.5 }; }
    else if (opt.kind === 'beacon') { opt.m.charges--; respawn = { x: opt.m.x + 0.5, y: opt.m.y + 1, z: opt.m.z + 1.5 }; }
    else { this.emergencyUses--; const e = g.world.poi.emergency; respawn = { x: e.x + 0.5, y: e.y, z: e.z + 0.5 }; }
    return { kind: opt.kind, respawn };
  }

  dropGrave(pos) {
    const g = this.game;
    const items = g.inv.slots.filter(Boolean).map(s => ({ ...s }));
    // clear inventory (inventory recovery from a persistent body, §13.4)
    for (let i = 0; i < g.inv.slots.length; i++) g.inv.slots[i] = null;
    if (items.length === 0) return;
    const grave = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), items };
    grave.mesh = this.makeGraveMesh(grave);
    this.graves.push(grave);
    g.toast('Your kit remains at your body. Marked on the world.', 'important');
  }

  makeGraveMesh(grave) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xc9a58a });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshLambertMaterial({ color: 0x6a5a4a }));
    box.position.set(grave.x + 0.5, grave.y + 0.35, grave.z + 0.5);
    grp.add(box);
    // beacon of light so it's findable
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 30, 6),
      new THREE.MeshBasicMaterial({ color: 0xc9a58a, transparent: true, opacity: 0.35 }));
    beam.position.set(grave.x + 0.5, grave.y + 15, grave.z + 0.5);
    grp.add(beam);
    this.game.scene.add(grp);
    return grp;
  }

  update(dt) {
    const p = this.game.player.pos;
    for (const grave of this.graves) {
      const d = Math.hypot(grave.x + 0.5 - p.x, grave.y + 0.5 - p.y, grave.z + 0.5 - p.z);
      if (d < 1.6) this.collectGrave(grave);
    }
    this.graves = this.graves.filter(gr => !gr.collected);
  }

  collectGrave(grave) {
    const g = this.game;
    const remaining = [];
    for (const it of grave.items) {
      const overflow = g.inv.add(it.id, it.n);
      if (overflow > 0) remaining.push({ ...it, n: overflow });
    }
    if (remaining.length > 0) {
      grave.items = remaining;
      grave._fullWarned = grave._fullWarned || 0;
      if (g.t - grave._fullWarned > 5) {
        grave._fullWarned = g.t;
        g.toast('Inventory full — part of your kit stays with the body.', 'important');
      }
      return;
    }
    grave.collected = true;
    g.scene.remove(grave.mesh);
    g.toast('Recovered your kit from your body.', 'important');
  }

  serialize() {
    return {
      emergencyUses: this.emergencyUses, hardcore: this.hardcore,
      graves: this.graves.map(gr => ({ x: gr.x, y: gr.y, z: gr.z, items: gr.items })),
    };
  }
  load(d) {
    if (!d) return;
    this.emergencyUses = d.emergencyUses;
    this.hardcore = d.hardcore;
    this.graves = [];
    for (const gr of (d.graves || [])) {
      const grave = { ...gr };
      grave.mesh = this.makeGraveMesh(grave);
      this.graves.push(grave);
    }
  }
}
