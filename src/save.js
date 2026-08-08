// Persistence (§21): seed + chunk diffs + entity/system state to localStorage.
// Autosaves happen at safe boundaries (pause, interval, dawn). Writes go
// through a shadow key first so a crash mid-write can't corrupt the only copy.

import { WORLD, TIME } from './config.js';

const KEY = 'infections-wake-save-v1';
const SHADOW_KEY = 'infections-wake-save-shadow';
const FAILED_KEY = 'infections-wake-failed-v1';
const OLD_WORLD_KEY = 'infections-wake-save-oldworld';
const VERSION = 4;

export const SaveStore = {
  // A save "exists" only if it is loadable — read() archives incompatible
  // ones as a side effect, so the Continue button never leads to a surprise
  // fresh world.
  has() { return this.read() != null; },

  write(game) {
    try {
      const data = {
        version: VERSION,
        savedAt: Date.now(),
        // world identity: terrain regenerates from seed under this worldgen
        // scheme, so a save is only valid for the scheme it was written at
        world: { mode: 'stream1', core: WORLD.CORE_X, span: WORLD.HALF_SPAN, h: WORLD.HEIGHT },
        dayLen: TIME.DAY_LENGTH,
        seed: game.seed,
        hardcore: game.recovery.hardcore,
        t: game.t,
        score: game.score,
        hintStage: game.hintStage,
        scenario: game.scenarioKey || null,
        valleyFlags: [...game.valleyFlags],
        tiers: [...game.tiers],
        unlocks: game.unlocks,
        beastSeen: [...game.beastSeen],
        bossDead: game.bossDead,
        bossState: game.bossState,
        transit: { restored: game.transit.restored },
        deep: {
          valves: game.deep.valves, heatFailed: game.deep.heatFailed,
          flooded: game.deep.flooded, purged: game.deep.purged,
        },
        stats: { powerUptime: game.stats.powerUptime, highestNight: game.stats.highestNight },
        lastSleepDay: game.lastSleepDay,
        radioHeard: game.radioHeard,
        docTaken: [...game.docTaken],
        // keyed by deposit id and carrying coordinates, so discovered mines
        // stay on the map even when their chunk is unloaded
        minesSeen: [...game.minesSeen.entries()].map(([k, m]) => ({ k, x: m.x, z: m.z, kind: m.kind })),
        wildTaken: [...game.wildTaken],
        craftGrid: game.craftGrid,
        chests: [...game.chests.entries()].map(([k, c]) => {
          const [x, y, z] = k.split(',').map(Number);
          return { x, y, z, items: c.items };
        }),
        blockHp: Object.fromEntries(game.blockHp),   // damage scars persist (§6.7)
        edits: game.world.serializeEdits(),
        player: {
          x: game.player.pos.x, y: game.player.pos.y, z: game.player.pos.z,
          yaw: game.player.yaw, pitch: game.player.pitch,
          health: game.player.health, hunger: game.player.hunger,
        },
        inv: game.inv.serialize(),
        machines: game.machines.serialize(),
        furnaces: [...game.furnaces.values()],
        sanity: game.sanity.serialize(),
        director: game.director.serialize(),
        story: game.story.serialize(),
        recovery: game.recovery.serialize(),
        infected: game.infected.serialize(),
        pickupsTaken: [...game.pickupsTaken],
        dropped: game.pickups.filter(p => p.idx === -1 && !p.wildKey)
          .map(p => ({ x: p.x, y: p.y, z: p.z, item: p.item, n: p.n })),
      };
      // shadow write → verify parse → promote. A quota/JSON failure here
      // leaves the previous good save untouched.
      const raw = JSON.stringify(data);
      localStorage.setItem(SHADOW_KEY, raw);
      JSON.parse(localStorage.getItem(SHADOW_KEY));
      localStorage.setItem(KEY, raw);
      localStorage.removeItem(SHADOW_KEY);
      return true;
    } catch (e) {
      console.error('save failed', e);
      return false;
    }
  },

  read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || data.seed == null) return null;
      // v1 → v2 migration: new systems default in loadInto; only the boss
      // bookkeeping changed shape.
      if ((data.version || 1) < 2) {
        data.bossState = { kiln: {}, pump: {} };
        data.version = 2;
      }
      // v4: saves carry the worldgen scheme. A save written under a different
      // scheme (including every fixed-size v3 world) would replay its edit
      // diffs onto different terrain — archive it untouched rather than
      // corrupt it (the menu then offers a fresh world).
      const w = data.world;
      if (!w || w.mode !== 'stream1' || w.core !== WORLD.CORE_X || w.span !== WORLD.HALF_SPAN || w.h !== WORLD.HEIGHT) {
        console.warn('Save from an older world version — archived, starting fresh worlds from now on.');
        localStorage.setItem(OLD_WORLD_KEY, raw);
        localStorage.removeItem(KEY);
        return null;
      }
      // day-length rescale keeps day count / time-of-day continuous if the
      // cycle length is ever retuned again
      if (data.dayLen && data.dayLen !== TIME.DAY_LENGTH) {
        data.t = data.t / data.dayLen * TIME.DAY_LENGTH;
        data.dayLen = TIME.DAY_LENGTH;
      }
      return data;
    } catch { return null; }
  },

  clear() { localStorage.removeItem(KEY); },

  // Run failure: archive the world for viewing, then remove the active save (§13.3).
  archiveFailed() {
    const raw = localStorage.getItem(KEY);
    if (raw) localStorage.setItem(FAILED_KEY, raw);
    localStorage.removeItem(KEY);
  },
};
