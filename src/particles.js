import * as THREE from 'three';

// ============================================================================
// Pooled particle system.
//
// One InstancedMesh of small cubes, allocated ONCE. On a streamed 16k world
// every per-hit allocation shows up as a GC hitch during combat, so nothing
// here allocates after construction: the particle records themselves are
// pre-built and recycled through a free list, the burst helpers write into a
// scratch options object instead of a fresh literal, and the per-frame maths
// reuses the scratch Matrix4/Quaternion/Vector3/Color hung off `this`.
//
// Cubes (not sprites) on purpose — the game is voxel-shaded, and a shard of a
// broken block should look like a small piece of that block.
// ============================================================================

export const PARTICLE_MAX = 512;
const GRAVITY = 18;
const DRAG = 3.2;

// Tumble axis. Shared by every particle: a single skewed axis reads as chaotic
// tumbling once each shard carries its own spin rate and phase, and it costs
// one setFromAxisAngle per particle instead of a full random basis.
const AXIS = new THREE.Vector3(0.4, 0.8, 0.45).normalize();

// Integrate one particle. Pure — unit-tested headlessly. Returns false once the
// particle has outlived its ttl so the caller can reclaim the slot.
export function stepParticle(p, dt) {
  p.ttl -= dt;
  p.vy -= GRAVITY * dt;
  const k = Math.max(0, 1 - DRAG * dt);
  p.vx *= k; p.vz *= k;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  return p.ttl > 0;
}

export class Particles {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // vertexColors stays off: the per-shard tint rides on InstancedMesh's
    // instanceColor attribute (USE_INSTANCING_COLOR), not on the geometry.
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, PARTICLE_MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;   // particles live wherever the action is
    this.mesh.count = 0;               // drawn instance count, raised per frame
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    // The pool. `live` holds the active records oldest-first; `_free` is the
    // stack of parked ones. live.length + _free.length is always PARTICLE_MAX,
    // so spawn() never has to build a record.
    this.live = [];
    this._free = [];
    for (let i = 0; i < PARTICLE_MAX; i++)
      this._free.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ttl: 0, life: 1, size: 0.05, color: 0xffffff, spin: 0, rot: 0 });

    // per-frame scratch — never allocate inside update()
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    // scratch spawn options, so the burst helpers below emit dozens of
    // particles without leaving dozens of throwaway object literals behind
    this._o = { spread: 0, up: 0, size: 0, life: 0 };
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    // Park every instance at zero scale up front. Because mesh.count tracks the
    // live tally we never draw past it, but a zeroed buffer means a slot can
    // never flash a stale shard if that ever changes.
    for (let i = 0; i < PARTICLE_MAX; i++) this.mesh.setMatrixAt(i, this._hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    // Prime instanceColor NOW. InstancedMesh allocates that attribute lazily on
    // the first setColorAt(), and the renderer treats null -> non-null as a
    // program change (instancingColor is part of the program cache key), so the
    // player's very first block break would otherwise trigger a full Lambert
    // shader compile + link inside that frame — the same frame that already
    // carries the streaming budget. One write here moves the compile to load
    // time. The value is irrelevant: nothing past mesh.count is ever drawn.
    this.mesh.setColorAt(0, this._c);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // Was anything live last frame? Gates the buffer re-upload below.
    this._wasLive = false;
  }

  // opts: { spread, up, size, life } — all optional.
  spawn(x, y, z, color, opts = {}) {
    // Recycle a parked record; if the pool is saturated the OLDEST live shard
    // yields its slot (shift reorders in place, it does not allocate) because
    // the burst the player is watching right now matters more than one that is
    // already fading out.
    const p = this._free.length ? this._free.pop() : this.live.shift();
    p.x = x; p.y = y; p.z = z;
    const spread = opts.spread ?? 2.6;
    p.vx = (Math.random() - 0.5) * spread;
    p.vy = (opts.up ?? 3) * (0.55 + Math.random() * 0.9);
    p.vz = (Math.random() - 0.5) * spread;
    p.life = opts.life ?? (0.5 + Math.random() * 0.5);
    p.ttl = p.life;
    p.size = opts.size ?? (0.05 + Math.random() * 0.05);
    p.color = color;
    p.spin = (Math.random() - 0.5) * 9;
    p.rot = Math.random() * 6.28;
    this.live.push(p);
    return p;
  }

  // Shards of a block the player just finished mining. (x, y, z) is the block
  // cell, so the spray is centred on the cube that vanished.
  burstBlock(x, y, z, color) {
    const o = this._o;
    for (let i = 0; i < 14; i++) {
      o.spread = 2.4; o.up = 2.6; o.size = 0.06 + Math.random() * 0.05; o.life = undefined;
      this.spawn(x + 0.5 + (Math.random() - 0.5) * 0.7, y + 0.35 + Math.random() * 0.5,
        z + 0.5 + (Math.random() - 0.5) * 0.7, color, o);
    }
  }

  // An infected coming apart: body-coloured chunks plus a slow spore drift.
  // `scale` is the strain's own scale, so a brute sprays wider than a drifter.
  burstDeath(pos, color, scale = 1) {
    const o = this._o;
    const n = Math.round(22 * scale);
    for (let i = 0; i < n; i++) {
      o.spread = 3.4 * scale; o.up = 3.6;
      o.size = (0.05 + Math.random() * 0.07) * scale;
      o.life = 0.6 + Math.random() * 0.6;
      this.spawn(pos.x + (Math.random() - 0.5) * 0.5 * scale, pos.y + 0.5 * scale + Math.random() * 0.6 * scale,
        pos.z + (Math.random() - 0.5) * 0.5 * scale, color, o);
    }
    for (let i = 0; i < 10; i++) {     // spores hang in the air
      o.spread = 0.7; o.up = 0.5; o.size = 0.035; o.life = 1.4 + Math.random();
      this.spawn(pos.x + (Math.random() - 0.5) * 0.8, pos.y + 0.7 * scale, pos.z + (Math.random() - 0.5) * 0.8,
        0xb5c98a, o);
    }
  }

  // A small spark where a hit landed — short-lived, so repeated swings read as
  // separate impacts instead of one smear.
  burstHit(pos, color) {
    const o = this._o;
    for (let i = 0; i < 7; i++) {
      o.spread = 2.2; o.up = 2; o.size = 0.04; o.life = 0.3;
      this.spawn(pos.x, pos.y + 1, pos.z, color, o);
    }
  }

  update(dt) {
    // compact in place: survivors slide down, expired records go back on the
    // free stack. No filter/splice — both allocate.
    let w = 0;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      p.rot += p.spin * dt;
      if (stepParticle(p, dt)) this.live[w++] = p;
      else this._free.push(p);
    }
    this.live.length = w;

    for (let i = 0; i < w; i++) {
      const p = this.live[i];
      const fade = Math.min(1, p.ttl / (p.life * 0.4));   // shrink out over the last 40%
      this._v.set(p.x, p.y, p.z);
      this._q.setFromAxisAngle(AXIS, p.rot);
      this._s.setScalar(p.size * fade);
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      this._c.setHex(p.color);
      this.mesh.setColorAt(i, this._c);                   // attribute was primed in the constructor
    }
    // Draw exactly the live shards. Cheaper than zero-scaling the tail every
    // frame, and it means an idle pool costs no instances at all.
    this.mesh.count = w;
    // Only flag a re-upload when a frame actually wrote something. frustumCulled
    // is off, so WebGLObjects.update() visits this mesh every single frame, and
    // a raised needsUpdate makes it bufferSubData the WHOLE instance buffer —
    // 32 KB of matrices plus 6 KB of colours — with no updateRanges to narrow
    // it. Unconditional flags meant an idle pool (mesh.count === 0, nothing
    // drawn) still burned ~2.3 MB/s of upload bandwidth. The frame that drains
    // the pool still uploads, because the surviving shards moved before the
    // last one expired: hence _wasLive, not `w > 0` alone.
    if (w > 0 || this._wasLive) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
    this._wasLive = w > 0;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    for (let i = 0; i < this.live.length; i++) this._free.push(this.live[i]);
    this.live.length = 0;
    this.mesh.count = 0;
  }
}
