import * as THREE from 'three';
import { STRAINS, BLOCKS, B, WORLD, SCORE, COMBAT, canInfectedBreakBlock } from './config.js';
import { buildInfectedMesh } from './models.js';

let _uid = 1;

export class Infected {
  constructor(game, strainKey, x, y, z, opts = {}) {
    this.game = game;
    this.id = _uid++;
    this.strainKey = strainKey;
    this.s = STRAINS[strainKey];
    this.hp = this.s.hp;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.state = 'wander';
    this.target = null;          // {x,y,z} world point
    this.targetIsPlayer = false;
    this.retarget = Math.random() * 0.4;
    this.attackCd = 0;
    this.isFalse = !!opts.isFalse;   // hallucination
    this.fromAssault = !!opts.fromAssault;
    this.flickerT = 0;
    this.facing = Math.random() * Math.PI * 2;
    this.kb = new THREE.Vector3();   // transient knockback shove (not serialized)
    this.buildMesh();
  }

  buildMesh() {
    // distinct per-strain silhouette (models.js — shared with the gallery)
    const { group, head, mats } = buildInfectedMesh(this.strainKey);
    this.mesh = group;
    this.headMesh = head;
    this.bodyMats = mats;
    this.bodyMat = mats[0];
    group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.game.scene.add(group);
  }

  groundY(x, z) {
    // first solid top at/below current y, else scan down whole column
    const startY = Math.min(WORLD.HEIGHT - 1, Math.floor(this.pos.y + 2));
    for (let y = startY; y >= 0; y--) {
      const d = BLOCKS[this.game.world.get(Math.floor(x), y, Math.floor(z))];
      if (d && d.solid) return y + 1;
    }
    return 0;
  }

  solidAt(x, y, z) {
    const d = BLOCKS[this.game.world.get(Math.floor(x), Math.floor(y), Math.floor(z))];
    return d && d.solid;
  }

  chooseTarget() {
    const p = this.game.player;
    // leashed guardians (the colony host) return home when drawn too far
    if (this.home) {
      const dHome = Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z);
      if (dHome > 11) {
        this.target = { ...this.home };
        this.targetIsPlayer = false;
        this.state = 'pursue';
        return;
      }
    }
    const dToPlayer = this.pos.distanceTo(p.pos);
    // Direct line of sight to a close player overrides gradient (sensed living target).
    if (dToPlayer < 18) {
      const clear = this.game.sig.wallAtten(this.pos.x, this.pos.y + 1, this.pos.z, p.pos.x, p.pos.y + 1, p.pos.z);
      // direct sight requires a truly clear line (one wall attenuates to 0.55);
      // very close contact is felt regardless
      if (clear > 0.7 || dToPlayer < 4) {
        this.target = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
        this.targetIsPlayer = true;
        this.state = 'pursue';
        return;
      }
    }
    // Otherwise follow the strongest signature it can sense (skipping any
    // stimulus it recently gave up on).
    if (this.ignored) for (const [k, until] of this.ignored) if (this.game.t > until) this.ignored.delete(k);
    const stim = this.game.sig.bestStimulus(this.pos.x, this.pos.y + 1, this.pos.z, this.s.senses, this.s.thresholds.investigate, true, this.ignored ? new Set(this.ignored.keys()) : null);
    if (stim) {
      const key = this.game.sig.emitterKey(stim.emitter);
      if (key !== this._targetKey) { this._targetKey = key; this._bestD = Infinity; this._stuckT = 0; }
      this.target = { x: stim.x, y: stim.y, z: stim.z };
      this.targetIsPlayer = stim.emitter.isPlayer === true;
      // §5.4 frenzy: an overwhelming stimulus tips the colony into overdrive
      this.frenzied = this.s.thresholds.frenzy != null && stim.score > this.s.thresholds.frenzy;
      this.state = stim.score > this.s.thresholds.pursue ? 'pursue' : 'investigate';
    } else {
      this.targetIsPlayer = false;
      this._targetKey = null;
      if (this.state !== 'wander') this.state = 'wander';
    }
  }

  update(dt) {
    this._dt = dt;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.retarget -= dt;
    if (this.retarget <= 0) { this.chooseTarget(); this.retarget = 0.35 + Math.random() * 0.3; }

    if (this.isFalse) { this.updateFalse(dt); return; }

    const p = this.game.player;
    let dir = new THREE.Vector3();
    if (this.target) dir.set(this.target.x - this.pos.x, 0, this.target.z - this.pos.z);
    const horizDist = dir.length();

    // knockback shove FIRST — it must interrupt chewing/spitting, not queue
    // behind their early returns. Decays fast, respects collision, and never
    // triggers block attacks (noAttack).
    if (this.kb.lengthSq() > 0.02) {
      this.tryMove(this.kb.x * dt, this.kb.z * dt, true);
      this.kb.multiplyScalar(Math.max(0, 1 - COMBAT.kbDecay * dt));
    }

    // §12.3 #4: retaliate against a defensive system that just hurt it
    if (this.retaliate) {
      this.target = { x: this.retaliate.x + 0.5, y: this.retaliate.y + 0.5, z: this.retaliate.z + 0.5 };
      this.targetIsPlayer = false;
      this.state = 'pursue';
      this.retaliateT -= dt;
      if (this.retaliateT <= 0) this.retaliate = null;
    }

    // attack player if adjacent — a landed hit shoves the player back
    const dToPlayer = this.pos.distanceTo(p.pos);
    if (this.targetIsPlayer && dToPlayer < 1.4) {
      if (this.attackCd <= 0) {
        const landed = p.damage(this.s.dmg, this.s.name);
        if (landed !== false) p.applyKnockback?.(this.pos);
        this.attackCd = 1.0; this.lunge = 0.15;
      }
    }

    // §12.2 ranged infected: hold distance and spit contaminated fluid
    if (this.s.ranged && this.target) {
      this.spitCd = Math.max(0, (this.spitCd || 0) - dt);
      const dTarget = this.targetIsPlayer ? dToPlayer
        : Math.hypot(this.target.x - this.pos.x, this.target.y - (this.pos.y + 0.9), this.target.z - this.pos.z);
      if (dTarget < this.s.ranged.range && this.spitCd <= 0) {
        const aim = this.targetIsPlayer ? { x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z } : this.target;
        const clear = this.game.sig.wallAtten(this.pos.x, this.pos.y + 1, this.pos.z, aim.x, aim.y, aim.z);
        if (clear > 0.7) {
          this.spitCd = this.s.ranged.cooldown;
          this.facing = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z);
          this.game.spawnSpit(this, aim);
          this.syncMesh(dt);
          return; // rearing to spit — no movement this frame
        }
      }
      // spitters keep their distance from the player once in range
      if (this.targetIsPlayer && dToPlayer < this.s.ranged.range * 0.6) {
        this.tryMove((this.pos.x - p.pos.x) * 0.4 * dt, (this.pos.z - p.pos.z) * 0.4 * dt);
      }
    }

    // §12.2 cyst carrier: seeds cyst film on the ground as it walks; the film
    // keeps emitting spores after the carrier is gone (vent/contamination route)
    if (this.s.carrier) {
      this.cystT = (this.cystT ?? 4) - dt;
      if (this.cystT <= 0) {
        this.cystT = 5 + Math.random() * 4;
        const bx = Math.floor(this.pos.x), by = Math.floor(this.pos.y), bz = Math.floor(this.pos.z);
        if (this.game.world.get(bx, by, bz) === B.AIR && this.game.world.get(bx, by - 1, bz) !== B.AIR) {
          this.game.placeContamination(bx, by, bz);
        }
      }
    }

    // Arrived at a non-player stimulus that is a physical block (machine, fire,
    // warm wall): chew it. This is how machine eaters destroy generators.
    if (this.target && !this.targetIsPlayer) {
      const bx = Math.floor(this.target.x), by = Math.floor(this.target.y), bz = Math.floor(this.target.z);
      const d3 = Math.hypot(this.target.x - this.pos.x, this.target.y - (this.pos.y + 0.9), this.target.z - this.pos.z);
      if (d3 < 2.1) {
        const id = this.game.world.get(bx, by, bz);
        const def = BLOCKS[id];
        // only machine eaters chew, and only machine blocks (incl. non-solid
        // cables) — everyone else falls through to the frustration timer
        if (def && (def.solid || def.wire) && def.hardness !== Infinity && canInfectedBreakBlock(this.s, def)) {
          this.game.infectedAttackBlock(bx, by, bz, this.s.blockDmg * dt, this);
          this.facing = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
          this._stuckT = 0;
          this.syncMesh(dt);
          return;
        }
      }
      // Stimulus directly below (it climbed a tree/roof above the source):
      // tear through whatever it stands on to get down to it.
      const dxz = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      if (dxz < 1.3 && this.pos.y - this.target.y > 1.5) {
        const fx = Math.floor(this.pos.x), fz = Math.floor(this.pos.z);
        const fy = Math.floor(this.pos.y) - 1;
        const under = this.game.world.get(fx, fy, fz);
        const ud = BLOCKS[under];
        if (ud && ud.solid && ud.hardness !== Infinity) {
          // burrowers dig down through soil (movement); machine eaters chew a
          // machine they stand on; every other pairing gives up via frustration
          if (this.s.burrows && this.isSoft(fx, fy, fz)) {
            this.game.infectedDigSoft?.(fx, fy, fz, this.s.blockDmg * 4 * dt, this);
            this._stuckT = 0;
            this.syncMesh(dt);
            return;
          }
          if (canInfectedBreakBlock(this.s, ud)) {
            this.game.infectedAttackBlock(fx, fy, fz, this.s.blockDmg * dt, this);
            this._stuckT = 0;
            this.syncMesh(dt);
            return;
          }
        }
      }
      // Frustration: no progress toward this stimulus → give up on it a while.
      const dNow = Math.hypot(this.target.x - this.pos.x, this.target.y - this.pos.y, this.target.z - this.pos.z);
      if (dNow < (this._bestD ?? Infinity) - 0.25) { this._bestD = dNow; this._stuckT = 0; }
      else {
        this._stuckT = (this._stuckT || 0) + dt;
        if (this._stuckT > 9 && this._targetKey) {
          if (!this.ignored) this.ignored = new Map();
          this.ignored.set(this._targetKey, this.game.t + 30);
          this._targetKey = null; this.target = null; this.state = 'wander'; this._stuckT = 0;
          this.retarget = 0;
        }
      }
    }

    if (horizDist > 0.05 && this.state !== 'wander') {
      dir.normalize();
      let speed = this.s.speed * (this.state === 'investigate' ? 0.65 : 1);
      if (this.frenzied) speed *= 1.35; // §5.4 frenzy state
      const stepX = dir.x * speed * dt;
      const stepZ = dir.z * speed * dt;
      this.tryMove(stepX, stepZ);
      this.facing = Math.atan2(dir.x, dir.z);
    } else if (this.state === 'wander') {
      // idle drift
      this.facing += (Math.random() - 0.5) * dt;
      this.tryMove(Math.sin(this.facing) * 0.4 * dt, Math.cos(this.facing) * 0.4 * dt);
    }

    // climbers cling briefly after leaving a face; everyone else falls hard
    if (this.climbingT > 0) this.climbingT -= dt;

    // gravity clamp to ground (skipped on a frame spent actively climbing)
    if (!this._climbedNow) {
      const gy = this.groundY(this.pos.x, this.pos.z);
      if (this.pos.y > gy + 0.1) {
        const fall = this.climbingT > 0 ? 2.5 : 12;
        this.pos.y = Math.max(gy, this.pos.y - fall * dt);
      } else this.pos.y = gy;
    }
    this._climbedNow = false;

    this.syncMesh(dt);
  }

  // Is this block soft ground a burrower can push through (§12.2)?
  isSoft(x, y, z) {
    const id = this.game.world.get(Math.floor(x), Math.floor(y), Math.floor(z));
    return id === B.DIRT || id === B.GRASS || id === B.SAND || id === B.GRAVEL;
  }

  tryMove(dx, dz, noAttack = false) {
    const nx = this.pos.x + dx, nz = this.pos.z + dz;
    const feetY = Math.floor(this.pos.y);
    // blocked?
    const blockFeet = this.solidAt(nx, feetY, nz);
    const blockHead = this.solidAt(nx, feetY + 1, nz);
    if (!blockFeet && !blockHead) { this.pos.x = nx; this.pos.z = nz; return; }
    // can step up one block?
    if (blockFeet && !blockHead && !this.solidAt(nx, feetY + 2, nz)) {
      this.pos.x = nx; this.pos.z = nz; this.pos.y = feetY + 1; return;
    }
    // §12.2 burrower: pushes straight through soil/gravel, leaving readable
    // disturbance (grass churned to dirt). This is movement, not an attack —
    // it routes around the machine-eater-only breaking rule via infectedDigSoft.
    if (this.s.burrows && !noAttack) {
      const bx = Math.floor(nx), bz = Math.floor(nz);
      const ty = blockHead ? feetY + 1 : feetY;
      if (this.isSoft(bx, ty, bz)) {
        this.game.infectedDigSoft?.(bx, ty, bz, this.s.blockDmg * 8 * (this._dt || 0.016), this);
        this.game.leaveDisturbance(bx, bz);
        return;
      }
    }
    // §12.2 climber: blocked by a face → scale it instead of chewing it
    // (not while being flung — a shove must not convert into a climb boost)
    if (this.s.climbs && !noAttack && blockHead && !this.solidAt(this.pos.x, feetY + 2, this.pos.z)) {
      this.pos.y += 3.2 * (this._dt || 0.016);
      this._climbedNow = true;   // defeat gravity for this frame
      this.climbingT = 0.5;      // brief cling so it can crest the edge
      return;
    }
    // blocked by a barrier — only a machine eater blocked by a machine block
    // attacks it; everyone else is simply stopped (knockback never attacks)
    if (noAttack) return;
    const ty = blockHead ? feetY + 1 : feetY;
    const bDef = BLOCKS[this.game.world.get(Math.floor(nx), ty, Math.floor(nz))];
    if (canInfectedBreakBlock(this.s, bDef)) {
      this.game.infectedAttackBlock(Math.floor(nx), ty, Math.floor(nz), this.s.blockDmg * (this._dt || 0.016), this);
    }
  }

  // Melee shove away from `fromPos`. Heavier frames resist; encounter bosses
  // are immune (a jugglable colony host trivializes the fight).
  applyKnockback(fromPos, power) {
    if (this.s.boss || this.isFalse) return;
    const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    const p = power / (this.s.scale * this.s.scale);
    this.kb.set(dx / len * p, 0, dz / len * p);
  }

  updateFalse(dt) {
    // false enemies advance toward the player but never deal damage
    const p = this.game.player;
    const dir = new THREE.Vector3(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z);
    const d = dir.length();
    if (d > 1.6) { dir.normalize(); this.tryMoveGhost(dir.x * this.s.speed * dt, dir.z * this.s.speed * dt); this.facing = Math.atan2(dir.x, dir.z); }
    const gy = this.groundY(this.pos.x, this.pos.z);
    this.pos.y = gy;
    this.flickerT += dt;
    this.syncMesh(dt);
    // subtle flicker so an attentive player can tell (verification cue, §7.5)
    const flick = 0.55 + 0.45 * Math.abs(Math.sin(this.flickerT * 7));
    this.mesh.traverse(o => { if (o.material && 'opacity' in o.material) { o.material.transparent = true; o.material.opacity = flick; } });
  }

  tryMoveGhost(dx, dz) {
    // ghosts ignore walls partly but still ride terrain
    const nx = this.pos.x + dx, nz = this.pos.z + dz;
    if (!this.solidAt(nx, Math.floor(this.pos.y) + 1, nz)) { this.pos.x = nx; this.pos.z = nz; }
  }

  syncMesh(dt) {
    this.mesh.position.copy(this.pos);
    // smooth turn toward facing
    let d = this.facing - this.mesh.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.mesh.rotation.y += d * Math.min(1, 10 * dt);
    if (this.lunge > 0) { this.lunge -= dt; this.mesh.position.y += 0.1; }
    // §5.5 early cue: while the body idles, the head still tracks the stimulus
    if (this.headMesh && this.target && this.state !== 'wander') {
      const want = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z) - this.mesh.rotation.y;
      let hd = want - this.headMesh.rotation.y;
      while (hd > Math.PI) hd -= Math.PI * 2;
      while (hd < -Math.PI) hd += Math.PI * 2;
      const lim = Math.PI * 0.45;
      this.headMesh.rotation.y = Math.max(-lim, Math.min(lim, this.headMesh.rotation.y + hd * Math.min(1, 5 * dt)));
    }
  }

  takeHit(dmg, verified = true, source = null) {
    if (this.isFalse) {
      if (verified) { this.game.spawnHitSpark(this.pos, 0x9d8fd4); this.remove(); this.game.sanity.onFalseDispelled(); }
      return;
    }
    this.hp -= dmg;
    this.flash();
    this.game.sig.addBlood(this.pos.x, this.pos.y + 0.5, this.pos.z, 0.4);
    if (source && this.s.targetsMachines) {
      // §12.3 #4: hit by a defensive system — turn on the machine, not the
      // player. Only machine eaters can actually hurt it; anyone else would
      // camp a turret they cannot damage, so they hunt the player instead.
      this.retaliate = source;
      this.retaliateT = 6;
    } else {
      // aggro on being hit by hand
      this.target = { x: this.game.player.pos.x, y: this.game.player.pos.y, z: this.game.player.pos.z };
      this.targetIsPlayer = true; this.state = 'pursue';
    }
    if (this.hp <= 0) this.die();
  }

  flash() {
    for (const m of (this.bodyMats || [this.bodyMat])) {
      m.emissive = new THREE.Color(0x882222);
      m.emissiveIntensity = 1;
    }
    setTimeout(() => {
      for (const m of (this.bodyMats || [this.bodyMat])) if (m) m.emissive = new THREE.Color(0x000000);
    }, 90);
  }

  die() {
    this.game.onInfectedKilled(this);
    this.game.sig.addBlood(this.pos.x, this.pos.y + 0.3, this.pos.z, 1.2);
    // a carrier bursts: the film it dies in keeps working (§12.2)
    if (this.s.carrier) {
      const bx = Math.floor(this.pos.x), by = Math.floor(this.pos.y), bz = Math.floor(this.pos.z);
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (Math.random() < 0.6) this.game.placeContamination(bx + dx, by, bz + dz);
      }
      this.game.toast('The carrier bursts — cyst film takes hold where it fell.', 'bad');
    }
    this.remove();
  }

  remove() {
    this.game.scene.remove(this.mesh);
    this.mesh.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
    this.dead = true;
  }
}

export class InfectedManager {
  constructor(game) { this.game = game; this.list = []; }

  spawn(strainKey, x, y, z, opts) {
    const inf = new Infected(this.game, strainKey, x, y, z, opts);
    this.list.push(inf);
    return inf;
  }

  // Find a valid spawn: sky-exposed solid ground in a ring around the player,
  // guaranteeing an outdoor route (no spawns sealed inside rooms, §4.1 WORLD-005).
  findValidSpawn(minR = 16, maxR = 30) {
    const p = this.game.player;
    for (let attempt = 0; attempt < 40; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const x = Math.floor(p.pos.x + Math.cos(ang) * r);
      const z = Math.floor(p.pos.z + Math.sin(ang) * r);
      if (x < 1 || x >= WORLD.SIZE_X - 1 || z < 1 || z >= WORLD.SIZE_Z - 1) continue;
      const top = this.game.world.skyTop(x, z); // open to sky here
      const groundId = this.game.world.get(x, top - 1, z);
      const gd = BLOCKS[groundId];
      if (!gd || !gd.solid || gd.hardness === Infinity) continue;
      if (this.game.world.get(x, top, z) !== B.AIR) continue;
      // not on water
      if (groundId === B.WATER) continue;
      return { x: x + 0.5, y: top, z: z + 0.5 };
    }
    return null;
  }

  spawnWave(strainKey, count, opts) {
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const loc = this.findValidSpawn();
      if (!loc) continue;
      this.spawn(strainKey, loc.x, loc.y, loc.z, opts);
      spawned++;
    }
    return spawned;
  }

  update(dt) {
    for (const inf of this.list) if (!inf.dead) inf.update(dt);
    this.list = this.list.filter(i => !i.dead);
  }

  countReal(assaultOnly = false) {
    return this.list.filter(i => !i.isFalse && !i.dead && (!assaultOnly || i.fromAssault)).length;
  }
  countFalse() { return this.list.filter(i => i.isFalse && !i.dead).length; }
  removeAllFalse() { for (const i of this.list) if (i.isFalse) i.remove(); this.list = this.list.filter(i => !i.dead); }
  removeAll() { for (const i of this.list) i.remove(); this.list = []; }

  // nearest infected intersected by a ray from origin/dir within reach (melee)
  raycast(origin, dir, reach, includeFalse = true) {
    let best = null, bestT = reach;
    for (const inf of this.list) {
      if (inf.dead) continue;
      if (inf.isFalse && !includeFalse) continue;
      const toC = new THREE.Vector3(inf.pos.x, inf.pos.y + 0.9, inf.pos.z).sub(origin);
      const t = toC.dot(dir);
      if (t < 0 || t > bestT) continue;
      const closest = origin.clone().add(dir.clone().multiplyScalar(t));
      const d = closest.distanceTo(new THREE.Vector3(inf.pos.x, inf.pos.y + 0.9, inf.pos.z));
      if (d < 0.7 * inf.s.scale + 0.3) { best = inf; bestT = t; }
    }
    return best;
  }

  serialize() {
    return this.list.filter(i => !i.isFalse).map(i => ({ k: i.strainKey, x: i.pos.x, y: i.pos.y, z: i.pos.z, hp: i.hp, a: i.fromAssault }));
  }
  load(arr) {
    this.removeAll();
    for (const e of arr) { const inf = this.spawn(e.k, e.x, e.y, e.z, { fromAssault: e.a }); inf.hp = e.hp; }
  }
}
