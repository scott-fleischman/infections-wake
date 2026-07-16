// Deterministic, seedable RNG + value noise.
// Reproducibility matters: the save stores only a seed, and world generation
// must reproduce the exact same terrain (SAVE requirements, §21).

// mulberry32 — small, fast, good enough for a game.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a string seed to a 32-bit int (xfnv1a).
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed) {
    this.seed = typeof seed === 'string' ? hashSeed(seed) : (seed >>> 0);
    this.next = mulberry32(this.seed);
  }
  float() { return this.next(); }
  range(min, max) { return min + this.next() * (max - min); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  // A fresh independent stream derived from this seed + a salt.
  fork(salt) { return new RNG((this.seed ^ hashSeed(String(salt))) >>> 0); }
}

// --- Value noise (deterministic, tileable-ish 2D + 3D) ---

function hash2(ix, iy, seed) {
  let h = seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(ix, iy, iz, seed) {
  let h = seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const v00 = hash2(ix, iy, seed), v10 = hash2(ix + 1, iy, seed);
  const v01 = hash2(ix, iy + 1, seed), v11 = hash2(ix + 1, iy + 1, seed);
  const sx = smooth(fx), sy = smooth(fy);
  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}

export function noise3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = smooth(fx), sy = smooth(fy), sz = smooth(fz);
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
  const x00 = lerp(c(0,0,0), c(1,0,0), sx), x10 = lerp(c(0,1,0), c(1,1,0), sx);
  const x01 = lerp(c(0,0,1), c(1,0,1), sx), x11 = lerp(c(0,1,1), c(1,1,1), sx);
  return lerp(lerp(x00, x10, sy), lerp(x01, x11, sy), sz);
}

// Fractal brownian motion over value noise.
export function fbm2(x, y, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
