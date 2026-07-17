// Persistence (§21): seed + chunk diffs + entity/system state to localStorage.
// Autosaves happen at safe boundaries (pause, interval, dawn). Writes go
// through a shadow key first so a crash mid-write can't corrupt the only copy.

const KEY = 'infections-wake-save-v1';
const SHADOW_KEY = 'infections-wake-save-shadow';
const FAILED_KEY = 'infections-wake-failed-v1';
const VERSION = 2;

export const SaveStore = {
  has() { return localStorage.getItem(KEY) != null; },

  write(game) {
    try {
      const data = {
        version: VERSION,
        savedAt: Date.now(),
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
        dropped: game.pickups.filter(p => p.idx === -1)
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
