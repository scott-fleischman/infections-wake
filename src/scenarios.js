import { B, TIME } from './config.js';

// ============================================================================
// Dev scenarios — jump to a story checkpoint with a matching world state.
// Each `apply(game)` runs at the END of setupWorld() on a fresh world: the
// terrain is generated, systems are live, and placeBlock() goes through the
// normal machine/prop/signature hooks, so a scenario world behaves exactly
// like one a player built. Reached from the start menu (DEV SCENARIOS) or
// `?scenario=<key>` (optionally with `&seed=<any-string>`).
// ============================================================================

const give = (g, items) => { for (const [id, n] of Object.entries(items)) g.inv.add(id, n); };
// day is only recomputed on dawn crossings (main.js onNewDay) — set it directly
const setTime = (g, day, frac) => { g.t = TIME.DAY_LENGTH * (day - 1 + frac); g.day = day; g.dayFrac = frac; };

const placeIfAir = (g, x, y, z, id) => {
  if (g.world.get(x, y, z) === B.AIR) { g.placeBlock(x, y, z, id); return true; }
  return false;
};

// The starter shack around the spawn point (world.js placeStartRefuge):
// 5x5 walls centered on spawn, doorway at (sx, surf+1..2, sz-2).
const shackOf = (g) => {
  const s = g.world.poi.spawn;
  return { sx: Math.floor(s.x), sz: Math.floor(s.z), surf: s.y - 1 };
};

function sealShack(g) {
  const { sx, sz, surf } = shackOf(g);
  placeIfAir(g, sx, surf + 1, sz - 2, B.DOOR);           // hang a door
  placeIfAir(g, sx, surf + 2, sz - 2, B.WOOD_WALL);      // board the transom
  placeIfAir(g, sx + 2, surf + 2, sz + 2, B.WOOD_WALL);  // repair collapsed corner
  placeIfAir(g, sx + 2, surf + 3, sz + 2, B.WOOD_WALL);
  placeIfAir(g, sx - 1, surf + 1, sz - 1, B.CAMPFIRE);   // hearth inside
  placeIfAir(g, sx + 1, surf + 2, sz, B.TORCH);
  g.unlocks.doorHung = true;
}

function ironKit(g) {
  give(g, {
    iron_pick: 1, iron_axe: 1, iron_blade: 1,
    iron_ingot: 8, coal: 12, stick: 8, fiber: 6,
    'b:12': 24, 'b:38': 6, cooked_meat: 6,
  });
  g.tiers.add('iron');
  const { sx, sz, surf } = shackOf(g);
  // NE interior corner — (sx+1, sz+1) is the emergency recovery pad cell and
  // must stay clear or respawn breaks
  placeIfAir(g, sx + 1, surf + 1, sz - 1, B.FURNACE);
}

// Steel-age loadout: the kiln host is already purged, filtration research is
// open, and the pack holds the loud half of the tech tree.
function steelKit(g) {
  g.bossState.kiln.dead = true;
  g.unlocks.kilnRestored = true;
  g.unlocks.filtration = true;
  g.tiers.add('steel');
  g.addValley('kilnRestored');
  give(g, {
    steel_ingot: 10, steel_pick: 1, steel_blade: 1, iron_armor: 1,
    'b:40': 8, 'b:41': 1, 'b:42': 2, 'b:46': 2, continuity_core: 1,
  });
}

// Find (or carve) a standable air pocket near an underground point.
// minDist keeps the drop-in outside the colony chamber — closer spawns put
// the tester in the host's reach before they can orient (died in playtest)
function standableNear(g, cx, cy, cz, minDist = 7, maxDist = 14) {
  const w = g.world;
  const ok = (x, y, z) =>
    w.get(x, y, z) === B.AIR && w.get(x, y + 1, z) === B.AIR && w.get(x, y - 1, z) !== B.AIR;
  for (let r = minDist; r <= maxDist; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (let dy = -2; dy <= 2; dy++)
          if (ok(cx + dx, cy + dy, cz + dz)) return { x: cx + dx, y: cy + dy, z: cz + dz };
      }
  // no pocket — carve an alcove west of the point
  const x = cx - minDist - 1, y = cy, z = cz;
  w.set(x, y, z, B.AIR); w.set(x, y + 1, z, B.AIR);
  if (w.get(x, y - 1, z) === B.AIR) w.set(x, y - 1, z, B.STONE);
  return { x, y, z };
}

export const SCENARIOS = {
  tooled: {
    name: 'Day 1 — tooled up',
    desc: 'Stone tools and gathered materials, morning of the first day.',
    apply(g) {
      give(g, { stone_pick: 1, stone_axe: 1, stone_shovel: 1, stone_spear: 1, stick: 6, stone_shard: 4, fiber: 6, raw_meat: 2 });
      setTime(g, 1, 0.35);
    },
  },
  fortified: {
    name: 'Dusk of day 1 — shack sealed',
    desc: 'Door hung, walls repaired, fire lit. The first assault forecast is minutes out.',
    apply(g) {
      give(g, { stone_pick: 1, stone_axe: 1, stone_spear: 1, 'b:12': 10, 'b:38': 4, cooked_meat: 4 });
      sealShack(g);
      setTime(g, 1, TIME.DUSK - 0.04);
    },
  },
  ironage: {
    name: 'Day 2 — iron age',
    desc: 'Furnace running, iron tools in hand, the power tier within reach.',
    apply(g) {
      give(g, { stone_spear: 1 });
      sealShack(g);
      ironKit(g);
      g.addValley('firstAssault');
      setTime(g, 2, 0.3);
    },
  },
  powered: {
    name: 'Day 3 — powered compound',
    desc: 'Generator, lamps, and a turret wired up outside the shack. Louder than ever.',
    apply(g) {
      sealShack(g);
      ironKit(g);
      give(g, { coal: 20, turret_ammo: 60, iron_ampoule: 2, 'b:23': 8, 'b:14': 8 });
      const { sx, sz, surf } = shackOf(g);
      // wire spine along the flattened row in front of the shack (wires are
      // walkable, so it may cross the doorway path). Consumers must touch a
      // spine wire: a wired generator powers nothing by direct adjacency.
      placeIfAir(g, sx + 3, surf + 1, sz - 3, B.GENERATOR);
      for (const dx of [2, 1, 0, -1]) placeIfAir(g, sx + dx, surf + 1, sz - 3, B.WIRE);
      placeIfAir(g, sx + 2, surf + 2, sz - 3, B.LAMP);      // lamp above the wire
      placeIfAir(g, sx - 2, surf + 1, sz - 3, B.TURRET);
      // beacon placed but unwired: registering + charging it is the tester's
      // first task (matches the open objective)
      placeIfAir(g, sx - 3, surf + 1, sz - 3, B.BEACON);
      const gen = g.machines.get(sx + 3, surf + 1, sz - 3);
      if (gen) gen.fuel = 40; // the compound arrives live — and loud
      g.addValley('firstAssault');
      g.unlocks.genRan = true;
      setTime(g, 3, 0.55);
    },
  },
  lab: {
    name: 'The buried lab',
    desc: 'Inside the Project Lazarus annex, three archives waiting to be cataloged.',
    apply(g) {
      sealShack(g);
      ironKit(g);
      give(g, { 'b:38': 8, suppressant: 2 });
      g.addValley('firstAssault');
      const L = g.world.poi.lab;
      g.player.pos.set(L.x + 0.5, L.floor + 1.01, L.z + 0.5);
      g.player.vel.set(0, 0, 0);
      setTime(g, 2, 0.5);
    },
  },
  boss: {
    name: 'Purge the colony',
    desc: 'Underground at the mineralized colony, blade in hand. The host is home.',
    apply(g) {
      sealShack(g);
      ironKit(g);
      give(g, { 'b:14': 10, 'b:38': 10, suppressant: 3, iron_ampoule: 1, cooked_meat: 6 });
      g.addValley('firstAssault');
      const c = g.world.poi.colony;
      const spot = standableNear(g, c.x, c.y, c.z);
      g.player.pos.set(spot.x + 0.5, spot.y + 0.01, spot.z + 0.5);
      g.player.vel.set(0, 0, 0);
      setTime(g, 3, 0.4);
    },
  },
  steel: {
    name: 'Day 4 — steel age',
    desc: 'Kiln reclaimed, steel in hand, filtration research open. The loud half of the tech tree begins.',
    apply(g) {
      sealShack(g);
      ironKit(g);
      steelKit(g);
      g.addValley('firstAssault');
      setTime(g, 4, 0.3);
    },
  },
  transit: {
    name: 'Day 5 — at the relay station',
    desc: 'Relays and a filter in the pack, standing at the transit panel. Start the line when your defenses are ready.',
    apply(g) {
      sealShack(g);
      ironKit(g);
      steelKit(g);
      give(g, { relay_module: 2, filter_unit: 1, 'b:22': 1, 'b:23': 12, coal: 20, turret_ammo: 80, 'b:26': 2, 'b:13': 20 });
      g.addValley('firstAssault');
      const t = g.world.poi.transit;
      g.player.pos.set(t.x + 0.5, t.surf + 1.02, t.z + 0.5);
      g.player.vel.set(0, 0, 0);
      setTime(g, 5, 0.3);
    },
  },
  deepsite: {
    name: 'The Deep Site expedition',
    desc: 'The rail runs. Standing in the entry hall with portable power and filtration — three galleries ahead.',
    apply(g) {
      sealShack(g);
      ironKit(g);
      steelKit(g);
      g.transit.restored = true;
      g.addValley('transitRestored');
      g.addValley('firstAssault');
      give(g, { 'b:41': 2, 'b:22': 1, 'b:23': 16, 'b:24': 4, coal: 24, 'b:44': 1, 'b:43': 1, sterilizer_charge: 4, suppressant: 4, cooked_meat: 8, 'b:38': 12, turret_ammo: 60, 'b:26': 1 });
      const d = g.world.poi.deep;
      g.player.pos.set(d.entry.x + 0.5, d.entry.y + 0.02, d.entry.z + 0.5);
      g.player.vel.set(0, 0, 0);
      setTime(g, 6, 0.35);
    },
  },
  endgame: {
    name: 'Reclamation — after the purge',
    desc: 'The reservoir is silent and the valley is quieter. Two secondary sites remain on the map.',
    apply(g) {
      sealShack(g);
      ironKit(g);
      steelKit(g);
      g.transit.restored = true;
      g.deep.valves = [true, true, true];
      // the vault growth is already burned out
      for (const c of g.world.poi.deep.clusters) {
        for (const [x, y, z] of c.cells) {
          if (g.world.get(x, y, z) !== 0) { g.world.set(x, y, z, 0); g.sig.onBlockChanged(x, y, z, 0); }
        }
        c.live = 0;
      }
      g.deep.tissueLeft = 0;
      g.deep.purged = true;
      for (const f of ['transitRestored', 'deepPurged', 'firstAssault']) g.addValley(f);
      give(g, { sterilizer_charge: 6, suppressant: 4, cooked_meat: 8, continuity_core: 1, 'b:28': 1 });
      setTime(g, 9, 0.32);
    },
  },
};

export function applyScenario(game, key) {
  const sc = SCENARIOS[key];
  if (!sc) return false;
  sc.apply(game);
  game.hintStage = 3; // playtesters don't need the newcomer guidance
  game.hud.updateHotbar();
  game.toast(`Scenario: ${sc.name}`, 'important');
  return true;
}
