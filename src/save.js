// Persistence (§21): seed + chunk diffs + entity/system state to localStorage.
// Autosaves happen at safe boundaries (pause, interval, dawn).

const KEY = 'infections-wake-save-v1';
const FAILED_KEY = 'infections-wake-failed-v1';

export const SaveStore = {
  has() { return localStorage.getItem(KEY) != null; },

  write(game) {
    try {
      const data = {
        version: 1,
        savedAt: Date.now(),
        seed: game.seed,
        hardcore: game.recovery.hardcore,
        t: game.t,
        score: game.score,
        valleyFlags: [...game.valleyFlags],
        tiers: [...game.tiers],
        unlocks: game.unlocks,
        beastSeen: [...game.beastSeen],
        bossDead: game.bossDead,
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
      };
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('save failed', e);
      return false;
    }
  },

  read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
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
