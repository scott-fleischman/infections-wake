import { SIGNATURE, BLOCKS, B, WORLD, PLAYER } from './config.js';

// The signature field: combines emitters (fires, machines, the player, blood,
// cysts) into local values per channel. Infected sense the world only through
// this service — they never query hidden asset positions directly (§23.1).

export class Signature {
  constructor(game) {
    this.game = game;
    this.staticEm = new Map();   // "x,y,z" -> emitter  (fires, cysts, nests, torches)
    this.dynamicEm = new Map();  // machine key -> emitter (only while running)
    this.blood = [];             // transient organic scent {x,y,z,amount,r}
    this.playerEm = { x: 0, y: 0, z: 0, e: {}, r: 18, isPlayer: true };
  }

  key(x, y, z) { return `${x},${y},${z}`; }

  // Scan the resident story core once for blocks that emit signatures.
  // Streamed wilderness chunks register/unregister via scanChunk/unscanChunk
  // as they come and go around the player.
  scanWorld() {
    this.staticEm.clear();
    const { CORE_X, CORE_Z, HEIGHT } = WORLD;
    for (let x = 0; x < CORE_X; x++)
      for (let z = 0; z < CORE_Z; z++)
        for (let y = 0; y < HEIGHT; y++) {
          const id = this.game.world.get(x, y, z);
          const def = BLOCKS[id];
          if (def && def.emits) this.addStaticBlock(x, y, z, def);
        }
  }

  // Register every emitting block in a freshly streamed-in chunk (nests,
  // cyst film). Chunk objects carry their own data, so this also works for
  // unscan after the chunk left the world map.
  scanChunk(chunk) {
    this._eachEmitter(chunk, (x, y, z, def) => this.addStaticBlock(x, y, z, def));
  }
  unscanChunk(chunk) {
    this._eachEmitter(chunk, (x, y, z) => this.removeStaticBlock(x, y, z));
  }
  _eachEmitter(chunk, fn) {
    const { CHUNK, HEIGHT } = WORLD;
    const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
    for (let lx = 0; lx < CHUNK; lx++)
      for (let lz = 0; lz < CHUNK; lz++)
        for (let y = 0; y < HEIGHT; y++) {
          const id = chunk.data[(y * CHUNK + lz) * CHUNK + lx];
          if (id === 0) continue;
          const def = BLOCKS[id];
          if (def && def.emits) fn(x0 + lx, y, z0 + lz, def);
        }
  }

  addStaticBlock(x, y, z, def) {
    const mag = Math.max(...Object.values(def.emits));
    this.staticEm.set(this.key(x, y, z), { x: x + 0.5, y: y + 0.5, z: z + 0.5, e: def.emits, r: 8 + mag * 22 });
  }
  removeStaticBlock(x, y, z) { this.staticEm.delete(this.key(x, y, z)); }

  onBlockChanged(x, y, z, id) {
    const def = BLOCKS[id];
    if (def && def.emits) this.addStaticBlock(x, y, z, def);
    else this.removeStaticBlock(x, y, z);
  }

  setDynamic(key, x, y, z, emits, r) {
    this.dynamicEm.set(key, { x: x + 0.5, y: y + 0.5, z: z + 0.5, e: emits, r, key });
  }
  removeDynamic(key) { this.dynamicEm.delete(key); }

  addBlood(x, y, z, amount = 1) {
    this.blood.push({ x, y, z, amount, r: 10 + amount * 8 });
    if (this.blood.length > 60) this.blood.shift();
  }

  update(dt) {
    const p = this.game.player;
    // player emissions scale with activity
    const e = {};
    const base = p.sprinting && (Math.abs(p.vel.x) + Math.abs(p.vel.z) > 1) ? SIGNATURE.playerSprint : SIGNATURE.playerBase;
    for (const [k, v] of Object.entries(base)) e[k] = v;
    if (p.miningHeld) e.vibration = (e.vibration || 0) + 0.3;
    // low sanity increases the player's bacterial shedding signature (§7.4)
    const san = this.game.sanity ? this.game.sanity.value : 100;
    if (san < 50) { const boost = (50 - san) / 50; e.co2 = (e.co2 || 0) + boost * 0.4; e.blood = (e.blood || 0) + boost * 0.3; }
    // a running scrubber strips breath from the local air (§9.4 filtered vent)
    if (e.co2 && this.game.nearScrubber?.()) e.co2 *= 0.35;
    this.playerEm.x = p.pos.x; this.playerEm.y = p.pos.y + 1; this.playerEm.z = p.pos.z;
    this.playerEm.e = e;

    // decay blood
    for (const b of this.blood) b.amount -= SIGNATURE.bloodDecay * dt;
    this.blood = this.blood.filter(b => b.amount > 0.05);
  }

  *emitters(includePlayer = true) {
    for (const e of this.staticEm.values()) yield e;
    for (const e of this.dynamicEm.values()) yield e;
    for (const b of this.blood) yield { x: b.x, y: b.y, z: b.z, e: { blood: b.amount }, r: b.r };
    if (includePlayer) yield this.playerEm;
  }

  falloff(dist, r) { return Math.max(0, 1 - dist / r); }

  // Coarse wall attenuation: count opaque blocks along the segment.
  wallAtten(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    const steps = Math.min(16, Math.ceil(dist));
    if (steps <= 1) return 1;
    let walls = 0;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.floor(ax + dx * t), y = Math.floor(ay + dy * t), z = Math.floor(az + dz * t);
      const d = BLOCKS[this.game.world.get(x, y, z)];
      // senseOpaque: prop-rendered blocks (doors, furnaces) that still block
      // senses like a wall even though the mesher treats them as see-through
      if (d && (d.opaque || d.senseOpaque)) walls++;
      else if (d && d.liquid) walls += 0.5; // water damps but does not seal (§5.3)
    }
    return Math.pow(SIGNATURE.wallAttenuation, Math.min(walls, 4));
  }

  emitterKey(em) {
    if (em.isPlayer) return 'player';
    return `${Math.round(em.x)},${Math.round(em.y)},${Math.round(em.z)}`;
  }

  // Strongest stimulus an entity with the given sense weights can detect.
  // Returns {emitter, score, x,y,z} or null. `excluded` is a Set of emitter
  // keys the caller has given up on (frustration memory).
  bestStimulus(x, y, z, senses, investigateThreshold, cheapWalls = true, excluded = null) {
    let best = null, bestScore = investigateThreshold;
    for (const em of this.emitters(true)) {
      if (excluded && excluded.has(this.emitterKey(em))) continue;
      let raw = 0;
      for (const ch in em.e) raw += (senses[ch] || 0) * em.e[ch];
      if (raw <= 0) continue;
      const dx = em.x - x, dy = em.y - y, dz = em.z - z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > em.r) continue;
      let atten = this.falloff(dist, em.r);
      if (atten <= 0) continue;
      if (cheapWalls) atten *= this.wallAtten(x, y, z, em.x, em.y, em.z);
      const score = raw * atten;
      if (score > bestScore) { bestScore = score; best = { emitter: em, score, x: em.x, y: em.y, z: em.z }; }
    }
    return best;
  }

  // Aggregate signature values at a point (for UI overlays & director).
  sampleTotals(x, y, z, includePlayer = true) {
    const totals = {};
    for (const ch of SIGNATURE.channels) totals[ch] = 0;
    for (const em of this.emitters(includePlayer)) {
      const dist = Math.hypot(em.x - x, em.y - y, em.z - z);
      if (dist > em.r) continue;
      const f = this.falloff(dist, em.r);
      for (const ch in em.e) totals[ch] = (totals[ch] || 0) + em.e[ch] * f;
    }
    return totals;
  }

  dominantChannel(totals) {
    let best = null, bestV = 0.05;
    for (const ch in totals) if (totals[ch] > bestV) { bestV = totals[ch]; best = ch; }
    return best;
  }

  // Combined outdoor signature magnitude around the player (incursion trigger).
  outdoorMagnitude() {
    const p = this.game.player;
    const t = this.sampleTotals(p.pos.x, p.pos.y + 1, p.pos.z, true);
    return Object.values(t).reduce((a, b) => a + b, 0);
  }
}
