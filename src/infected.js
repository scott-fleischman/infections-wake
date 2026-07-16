import * as THREE from 'three';
import { STRAINS, BLOCKS, B, WORLD, SCORE } from './config.js';

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
    this.buildMesh();
  }

  buildMesh() {
    const s = this.s;
    const g = new THREE.Group();
    const col = new THREE.Color(s.color);
    const bodyMat = new THREE.MeshLambertMaterial({ color: col });
    const scale = s.scale;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6 * scale, 1.1 * scale, 0.4 * scale), bodyMat);
    body.position.y = 0.55 * scale + 0.2;
    g.add(body);
    const headMat = new THREE.MeshLambertMaterial({ color: col.clone().offsetHSL(0, 0, -0.08) });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42 * scale, 0.42 * scale, 0.42 * scale), headMat);
    head.position.y = 1.1 * scale + 0.35;
    g.add(head);
    // glowing eyes so the "head turns toward stimulus" reads clearly
    const eyeMat = new THREE.MeshBasicMaterial({ color: this.s.boss ? 0xff5a3a : 0xd94f4f });
    const eyeGeo = new THREE.BoxGeometry(0.08 * scale, 0.08 * scale, 0.05 * scale);
    for (const ex of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(ex * scale, 1.1 * scale + 0.37, -0.22 * scale);
      g.add(eye);
    }
    this.mesh = g;
    this.headMesh = head;
    this.bodyMat = bodyMat;
    this.game.scene.add(g);
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

    // attack player if adjacent
    const dToPlayer = this.pos.distanceTo(p.pos);
    if (this.targetIsPlayer && dToPlayer < 1.4) {
      if (this.attackCd <= 0) { p.damage(this.s.dmg, this.s.name); this.attackCd = 1.0; this.lunge = 0.15; }
    }

    // Arrived at a non-player stimulus that is a physical block (machine, fire,
    // warm wall): chew it. This is how machine eaters destroy generators.
    if (this.target && !this.targetIsPlayer) {
      const bx = Math.floor(this.target.x), by = Math.floor(this.target.y), bz = Math.floor(this.target.z);
      const d3 = Math.hypot(this.target.x - this.pos.x, this.target.y - (this.pos.y + 0.9), this.target.z - this.pos.z);
      if (d3 < 2.1) {
        const id = this.game.world.get(bx, by, bz);
        const def = BLOCKS[id];
        if (def && def.solid && def.hardness !== Infinity) {
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
          this.game.infectedAttackBlock(fx, fy, fz, this.s.blockDmg * dt, this);
          this._stuckT = 0;
          this.syncMesh(dt);
          return;
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
      const speed = this.s.speed * (this.state === 'investigate' ? 0.65 : 1);
      const stepX = dir.x * speed * dt;
      const stepZ = dir.z * speed * dt;
      this.tryMove(stepX, stepZ);
      this.facing = Math.atan2(dir.x, dir.z);
    } else if (this.state === 'wander') {
      // idle drift
      this.facing += (Math.random() - 0.5) * dt;
      this.tryMove(Math.sin(this.facing) * 0.4 * dt, Math.cos(this.facing) * 0.4 * dt);
    }

    // gravity clamp to ground
    const gy = this.groundY(this.pos.x, this.pos.z);
    if (this.pos.y > gy + 0.1) this.pos.y = Math.max(gy, this.pos.y - 12 * dt);
    else this.pos.y = gy;

    this.syncMesh(dt);
  }

  tryMove(dx, dz) {
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
    // blocked by a barrier — attack the obstructing block (breach / eat machine)
    const ty = blockHead ? feetY + 1 : feetY;
    this.game.infectedAttackBlock(Math.floor(nx), ty, Math.floor(nz), this.s.blockDmg * (this._dt || 0.016), this);
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
  }

  takeHit(dmg, verified = true) {
    if (this.isFalse) {
      if (verified) { this.game.spawnHitSpark(this.pos, 0x9d8fd4); this.remove(); this.game.sanity.onFalseDispelled(); }
      return;
    }
    this.hp -= dmg;
    this.flash();
    this.game.sig.addBlood(this.pos.x, this.pos.y + 0.5, this.pos.z, 0.4);
    // aggro on being hit
    this.target = { x: this.game.player.pos.x, y: this.game.player.pos.y, z: this.game.player.pos.z };
    this.targetIsPlayer = true; this.state = 'pursue';
    if (this.hp <= 0) this.die();
  }

  flash() {
    this.bodyMat.emissive = new THREE.Color(0x882222);
    this.bodyMat.emissiveIntensity = 1;
    setTimeout(() => { if (this.bodyMat) { this.bodyMat.emissive = new THREE.Color(0x000000); } }, 90);
  }

  die() {
    this.game.onInfectedKilled(this);
    this.game.sig.addBlood(this.pos.x, this.pos.y + 0.3, this.pos.z, 1.2);
    this.remove();
  }

  remove() {
    this.game.scene.remove(this.mesh);
    this.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
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
