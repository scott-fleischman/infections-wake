// Shared test scaffolding: a stub `game` object exposing the minimal surface
// the simulation modules touch, plus small world-building utilities.
// Real subsystems (World, Signature, Machines, ...) are preferred over stubs;
// this factory only fakes the presentation-side services (toasts, lights,
// scene, HUD) that headless Node cannot and need not provide.
import * as THREE from 'three';
import { World } from '../src/world.js';
import { B } from '../src/config.js';

export function makeStubGame(overrides = {}) {
  const game = {
    t: 0,
    day: 1,
    state: 'play',
    tiers: new Set(),

    // recorded side effects, for assertions
    toasts: [],
    dropped: [],
    attackedBlocks: [],

    toast(msg, cls) { game.toasts.push({ msg, cls }); },
    dropItemAt(pos, id, n = 1) { game.dropped.push({ pos: { ...pos }, id, n }); },
    infectedAttackBlock(x, y, z, amount, inf) {
      game.attackedBlocks.push({ x, y, z, amount, inf });
    },

    scene: { add() {}, remove() {} },
    lights: { set() {}, remove() {} },
    hud: {
      updateThreat() {}, showAssaultBanner() {},
      updateAssaultRemaining() {}, flashIncursion() {},
    },
    audio: null,

    onWorldEditVisual() {},
    spawnTracer() {},
    spawnHitSpark() {},
    onInfectedKilled() {},
    onAssaultCleared() {},
    onPlayerHurt() {},
    onPlayerDeath() {},
    setMineOverlay() {},

    sanity: { value: 100, onFalseDispelled() {} },

    player: {
      pos: new THREE.Vector3(0, 30, 0),
      vel: new THREE.Vector3(),
      sprinting: false,
      miningHeld: false,
      damage() {},
    },

    // no-op signature service; tests that need the real thing override it
    sig: {
      setDynamic() {}, removeDynamic() {}, addBlood() {},
      wallAtten: () => 1,
      bestStimulus: () => null,
      sampleTotals: () => ({}),
      dominantChannel: () => null,
      outdoorMagnitude: () => 0,
      emitterKey: () => 'stub',
    },

    // recovery iterates machines.map; tests using real Machines override this
    machines: { map: new Map() },
    infected: { list: [] },
  };
  return Object.assign(game, overrides);
}

// A real World left ungenerated: every cell is AIR (Uint16Array zero-fill),
// giving tests a deterministic empty canvas.
export function makeEmptyWorld(seed = 'test') {
  return new World(seed);
}

// Lay a solid stone slab so entities have ground to stand on. Uses the raw
// setter (no edit tracking / meshing needed headlessly).
export function buildFloor(world, x0, x1, z0, z1, y = 20, id = B.STONE) {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      world._set(x, y, z, id);
}

// FNV-1a rolling hash over a Uint16Array — cheap byte-identity fingerprint.
export function hashU16(arr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i] & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (arr[i] >>> 8) & 0xff;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function approxEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}
