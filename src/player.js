import * as THREE from 'three';
import { PLAYER, BLOCKS, B, COMBAT, canHarvestBlock } from './config.js';

// First-person controller: pointer-lock look, WASD move, AABB voxel collision,
// and a DDA raycast for break/place/interact targeting.

// Rotate a local movement input (mx = right, mz = back) into world space by
// yaw. Must agree with forwardVec(): local -Z maps to (-sin yaw, -cos yaw).
// Pure — unit-tested headlessly in test/movement.test.js.
export function moveBasis(mx, mz, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return { x: mx * c + mz * s, z: -mx * s + mz * c };
}

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3(0, 40, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.health = PLAYER.maxHealth;
    this.hunger = PLAYER.maxHunger;
    this.sprinting = false;
    this.keys = {};
    this.mineTarget = null;
    this.mineProgress = 0;
    this.hurtCooldown = 0;
    this.lastDamageT = 0;
    this.headBob = 0;
    this.kbT = 0; // knockback window: reduced input authority while shoved
  }

  spawnAt(p) {
    this.pos.set(p.x, p.y + 0.02, p.z);
    this.vel.set(0, 0, 0);
    this._fallStart = null;   // no phantom fall damage carried across a respawn
    this.onGround = false;
    this.miningHeld = false;
  }

  get eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + PLAYER.eye, this.pos.z); }
  forwardVec() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  isSolid(x, y, z) {
    const d = BLOCKS[this.game.world.get(Math.floor(x), Math.floor(y), Math.floor(z))];
    return d && d.solid;
  }

  // AABB overlaps any solid voxel?
  overlaps(px, py, pz) {
    const r = PLAYER.radius, h = PLAYER.height;
    const x0 = Math.floor(px - r), x1 = Math.floor(px + r);
    const y0 = Math.floor(py), y1 = Math.floor(py + h - 0.001);
    const z0 = Math.floor(pz - r), z1 = Math.floor(pz + r);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const d = BLOCKS[this.game.world.get(x, y, z)];
          if (d && d.solid) return true;
        }
    return false;
  }

  moveAxis(axis, amount) {
    const p = this.pos;
    const before = p[axis];
    p[axis] += amount;
    if (this.overlaps(p.x, p.y, p.z)) {
      p[axis] = before;
      if (axis === 'y') { if (amount < 0) this.onGround = true; this.vel.y = 0; }
      else this.vel[axis] = 0;
      return true;
    }
    return false;
  }

  update(dt) {
    const g = this.game;
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);

    // swimming: body immersed in water changes the whole movement model
    const feetId = g.world.get(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z));
    this.inWater = feetId === B.WATER;

    // --- desired horizontal movement ---
    let speed = this.sprinting && this.hunger > 5 ? PLAYER.sprint : PLAYER.walk;
    if (this.inWater) speed *= 0.55;
    let mx = 0, mz = 0;
    if (this.keys['w']) mz -= 1;
    if (this.keys['s']) mz += 1;
    if (this.keys['a']) mx -= 1;
    if (this.keys['d']) mx += 1;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;
    const w = moveBasis(mx, mz, this.yaw);
    const targetVx = w.x * speed, targetVz = w.z * speed;
    // smooth accel — a fresh shove briefly overrides input authority so the
    // impulse isn't instantly steered away
    this.kbT = Math.max(0, this.kbT - dt);
    let accel = this.onGround ? 14 : this.inWater ? 8 : 4;
    if (this.kbT > 0) accel *= COMBAT.playerKbAccelMul;
    this.vel.x += (targetVx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (targetVz - this.vel.z) * Math.min(1, accel * dt);

    // jump / swim
    if (this.inWater) {
      // buoyant: sink slowly, hold space to swim up; no fall damage in water
      this.vel.y += (this.keys[' '] ? 5.5 : -2.5 - this.vel.y) * Math.min(1, 6 * dt);
      this.vel.y = Math.max(-3, Math.min(4, this.vel.y));
      this._fallStart = null;
    } else {
      if (this.keys[' '] && this.onGround) { this.vel.y = PLAYER.jump; this.onGround = false; }
      this.vel.y -= PLAYER.gravity * dt;
      if (this.vel.y < -55) this.vel.y = -55;
    }

    this.onGround = false;
    // substep to avoid tunneling
    const steps = Math.max(1, Math.ceil((Math.abs(this.vel.y) * dt) / 0.4));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.moveAxis('x', this.vel.x * sdt);
      this.moveAxis('z', this.vel.z * sdt);
      this.moveAxis('y', this.vel.y * sdt);
    }

    // fall damage
    if (this.onGround && this._fallStart != null) {
      const fell = this._fallStart - this.pos.y;
      if (fell > 5) this.damage((fell - 5) * 3.5, 'the fall');
      this._fallStart = null;
    }
    if (!this.onGround && this.vel.y < 0 && this._fallStart == null) this._fallStart = this.pos.y;
    if (this.vel.y > 0) this._fallStart = null;

    // head bob
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    this.headBob += hspeed * dt * 1.6;

    // hunger + regen
    this.hunger = Math.max(0, this.hunger - PLAYER.hungerPerSec * dt * (this.sprinting ? 1.6 : 1));
    if (this.hunger <= 0) this.damage(PLAYER.starveDmg * dt, 'starvation', true);
    else if (this.hunger > PLAYER.regenAtHunger && this.health < PLAYER.maxHealth && g.t - this.lastDamageT > 6)
      this.health = Math.min(PLAYER.maxHealth, this.health + PLAYER.regenRate * dt);

    // drowning-ish: if head underwater, mild
    const headBlock = g.world.get(Math.floor(this.pos.x), Math.floor(this.pos.y + PLAYER.eye), Math.floor(this.pos.z));
    if (headBlock === B.WATER) this.damage(2 * dt, 'drowning', true);

    if (this.pos.y < -8) this.damage(9999, 'the void');

    this.updateCamera();
    this.updateMining(dt);
  }

  updateCamera() {
    const cam = this.game.camera;
    const bob = Math.sin(this.headBob) * 0.04 * (this.onGround ? 1 : 0);
    cam.position.set(this.pos.x, this.pos.y + PLAYER.eye + bob, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  onMouseMove(dx, dy) {
    const sens = 0.0024;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  // DDA voxel raycast from eye along view direction.
  raycast(maxDist = PLAYER.reach, wantInteractable = false) {
    const origin = this.eyePos;
    const dir = this.forwardVec().normalize();
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tMaxX = stepX > 0 ? (x + 1 - origin.x) / dir.x : stepX < 0 ? (x - origin.x) / dir.x : Infinity;
    let tMaxY = stepY > 0 ? (y + 1 - origin.y) / dir.y : stepY < 0 ? (y - origin.y) / dir.y : Infinity;
    let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) / dir.z : stepZ < 0 ? (z - origin.z) / dir.z : Infinity;
    let face = [0, 0, 0];
    let t = 0;
    for (let i = 0; i < 200; i++) {
      const id = this.game.world.get(x, y, z);
      const d = BLOCKS[id];
      if (id !== B.AIR && id !== B.WATER && d && (d.solid || d.interact || d.archive || d.slim)) {
        return { x, y, z, id, face, dist: t };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0]; }
      else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0]; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ]; }
      if (t > maxDist) break;
    }
    return null;
  }

  heldItem() { return this.game.inv.selectedItem(); }

  updateMining(dt) {
    if (!this.miningHeld) { this.mineProgress = 0; this.mineTarget = null; this.game.setMineOverlay(null); return; }
    const hit = this.raycast();
    if (!hit) { this.mineProgress = 0; this.mineTarget = null; this.game.setMineOverlay(null); return; }
    const key = `${hit.x},${hit.y},${hit.z}`;
    if (this.mineTarget !== key) { this.mineTarget = key; this.mineProgress = 0; }
    const def = BLOCKS[hit.id];
    if (!def || def.hardness === Infinity || def.hardness == null) {
      this.game.toast('That cannot be broken by hand.');
      this.miningHeld = false; return;
    }
    // tool speed
    const held = this.heldItem();
    let speed = 1;
    if (def.tool) {
      if (held && held.def.tool === def.tool) speed = held.def.speed || 1;
      else speed = 0.5;
    } else if (held && held.def.tool) speed = (held.def.speed || 1) * 0.8;
    const canHarvest = canHarvestBlock(def, held?.def);
    const time = def.hardness / speed;
    this.mineProgress += dt / time;
    this.game.setMineOverlay(hit, this.mineProgress);
    if (this.mineProgress >= 1) {
      this.mineProgress = 0;
      if (!canHarvest) { this.game.toast(`Need a better ${def.tool} for ${def.name}.`, 'important'); this.miningHeld = false; return; }
      this.game.breakBlock(hit.x, hit.y, hit.z, held);
    }
  }

  // Shoved by an infected's landed hit: horizontal impulse away from the
  // attacker plus a small pop when grounded (fall-damage risk is the cost of
  // fighting on a roofline).
  applyKnockback(fromPos) {
    const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.vel.x += dx / len * COMBAT.playerKb;
    this.vel.z += dz / len * COMBAT.playerKb;
    if (this.onGround) this.vel.y = Math.max(this.vel.y, COMBAT.playerKbUp);
    this.kbT = COMBAT.playerKbT;
  }

  // Returns false when the hit was absorbed by i-frames (callers use this to
  // decide whether to apply knockback).
  damage(amount, cause = '', silent = false) {
    if (this.game.state !== 'play') return false;
    if (this.hurtCooldown > 0 && !silent) return false;
    // §11.1 combat branch: a carried iron harness absorbs part of each hit
    // and wears out doing it (only real hits, not starvation/drowning ticks)
    if (!silent && amount > 1) {
      const worn = this.game.inv?.wearArmor?.(amount);
      if (worn) amount *= (1 - worn);
    }
    this.health -= amount;
    this.lastDamageT = this.game.t;
    if (!silent) {
      this.hurtCooldown = 0.4;
      this.game.onPlayerHurt(cause);
      this.game.sanity?.onInjury?.(amount); // §7.3 severe injury shakes stability
    }
    if (this.health <= 0) { this.health = 0; this.game.onPlayerDeath(cause); }
    return true;
  }

  heal(a) { this.health = Math.min(PLAYER.maxHealth, this.health + a); }
  feed(a) { this.hunger = Math.min(PLAYER.maxHunger, this.hunger + a); }
}
