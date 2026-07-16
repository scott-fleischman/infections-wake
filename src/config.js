// ============================================================================
// Data-driven configuration (spec §22).
// Everything tunable lives here: blocks, items, recipes, machines, strains,
// threat compositions, sanity/signature constants. Core code reads from these
// tables and must not hard-code the values.
// ============================================================================

export const WORLD = {
  CHUNK: 16,
  CHUNKS_X: 8,
  CHUNKS_Z: 8,
  HEIGHT: 56,
  SEA_LEVEL: 20,
  SURFACE: 24,
};
WORLD.SIZE_X = WORLD.CHUNK * WORLD.CHUNKS_X;
WORLD.SIZE_Z = WORLD.CHUNK * WORLD.CHUNKS_Z;

// Day length in real seconds (tunable, §27). One full day = DAY_LENGTH seconds.
export const TIME = {
  DAY_LENGTH: 300,      // 5 real minutes per full cycle
  DAWN: 0.24,           // fraction of day where dawn begins
  DUSK: 0.72,           // fraction where dusk begins
  NIGHT: 0.80,          // fraction where full night begins
  DAWN_END: 0.30,
};

// --- Block registry ------------------------------------------------------
// id -> definition. Colors are [top, side, bottom] hex or single value.
// flags: solid (collision), opaque (culls faces / blocks light+sight),
// light (emitted light level), tool (best tool class), hardness (break time mult).
export const B = {
  AIR: 0, BEDROCK: 1, STONE: 2, DIRT: 3, GRASS: 4, SAND: 5, GRAVEL: 6,
  LOG: 7, LEAVES: 8, IRON_ORE: 9, COAL_ORE: 10, WATER: 11,
  PLANK: 12, STONE_BRICK: 13, IRON_BLOCK: 14, GLASS: 15,
  BENCH: 16, CAMPFIRE: 17, FURNACE: 18, DOOR: 19, DOOR_OPEN: 20,
  BED: 21, GENERATOR: 22, WIRE: 23, LAMP: 24, DRILL: 25, TURRET: 26,
  BEACON: 27, CRADLE: 28,
  LAB_WALL: 29, LAB_FLOOR: 30, LAB_LIGHT: 31,
  COLONY: 32, CYST: 33, NEST: 34,
  ARCHIVE_1: 35, ARCHIVE_2: 36, ARCHIVE_3: 37,
  TORCH: 38, WOOD_WALL: 39,
};

// Reverse lookup for debugging.
export const B_NAME = Object.fromEntries(Object.entries(B).map(([k, v]) => [v, k]));

// Per-block definitions.
export const BLOCKS = {
  [B.AIR]:        { name: 'air', solid: false, opaque: false },
  [B.BEDROCK]:    { name: 'Bedrock', solid: true, opaque: true, col: [0x2a2d33,0x24272c,0x1d2024], hardness: Infinity },
  [B.STONE]:      { name: 'Stone', solid: true, opaque: true, col: 0x74787f, hardness: 2.2, tool: 'pick', drop: B.STONE },
  [B.DIRT]:       { name: 'Dirt', solid: true, opaque: true, col: 0x5a4634, hardness: 0.8, tool: 'shovel', drop: B.DIRT },
  [B.GRASS]:      { name: 'Grass', solid: true, opaque: true, col: [0x4f7a3a,0x5a4634,0x5a4634], hardness: 0.9, tool: 'shovel', drop: B.DIRT },
  [B.SAND]:       { name: 'Sand', solid: true, opaque: true, col: 0xbfa878, hardness: 0.6, tool: 'shovel', drop: B.SAND, falls: true },
  [B.GRAVEL]:     { name: 'Gravel', solid: true, opaque: true, col: 0x6c6a66, hardness: 0.8, tool: 'shovel', drop: B.GRAVEL, falls: true },
  [B.LOG]:        { name: 'Log', solid: true, opaque: true, col: [0x6b4e2e,0x4d3a22,0x6b4e2e], hardness: 1.4, tool: 'axe', drop: B.LOG, flammable: true },
  [B.LEAVES]:     { name: 'Leaves', solid: true, opaque: true, col: 0x3e6b34, hardness: 0.3, tool: 'axe', drop: null, flammable: true },
  [B.IRON_ORE]:   { name: 'Iron ore', solid: true, opaque: true, col: 0x8a8079, accent: 0xc9a58a, hardness: 3.4, tool: 'pick', toolMin: 1, drop: B.IRON_ORE },
  [B.COAL_ORE]:   { name: 'Coal ore', solid: true, opaque: true, col: 0x5c5a58, accent: 0x201f1e, hardness: 2.8, tool: 'pick', drop: B.COAL_ORE },
  [B.WATER]:      { name: 'Water', solid: false, opaque: false, col: 0x2c5d8a, liquid: true, transparent: true },

  [B.PLANK]:      { name: 'Wood plank', solid: true, opaque: true, col: 0x8a6a3e, hardness: 1.0, tool: 'axe', drop: B.PLANK, flammable: true, place: true },
  [B.WOOD_WALL]:  { name: 'Timber wall', solid: true, opaque: true, col: [0x6b542f,0x7a6236,0x6b542f], hardness: 1.6, tool: 'axe', drop: B.WOOD_WALL, flammable: true, place: true },
  [B.STONE_BRICK]:{ name: 'Reinforced wall', solid: true, opaque: true, col: 0x656b72, hardness: 3.0, tool: 'pick', drop: B.STONE_BRICK, place: true, armor: 2 },
  [B.IRON_BLOCK]: { name: 'Iron plating', solid: true, opaque: true, col: 0x9aa0a6, accent: 0xcfd3d6, hardness: 4.0, tool: 'pick', drop: B.IRON_BLOCK, place: true, armor: 3, metal: true },
  [B.GLASS]:      { name: 'Window', solid: true, opaque: false, transparent: true, col: 0x9fd4e0, hardness: 0.4, drop: null, place: true },

  [B.BENCH]:      { name: 'Crafting bench', solid: true, opaque: true, col: [0x8a6a3e,0x6b4e2e,0x6b4e2e], hardness: 1.0, drop: B.BENCH, place: true, interact: 'bench' },
  [B.CAMPFIRE]:   { name: 'Campfire', solid: true, opaque: false, col: 0xd8863a, light: 11, hardness: 0.4, drop: B.CAMPFIRE, place: true, interact: 'campfire', emits: { heat: 0.6, light: 0.9 } },
  [B.FURNACE]:    { name: 'Furnace', solid: true, opaque: true, col: [0x585858,0x4a4a4a,0x3a3a3a], hardness: 2.6, drop: B.FURNACE, place: true, interact: 'furnace' },
  [B.DOOR]:       { name: 'Door', solid: true, opaque: true, col: 0x7a5a30, hardness: 1.2, drop: B.DOOR, place: true, interact: 'door', armor: 1 },
  [B.DOOR_OPEN]:  { name: 'Door', solid: false, opaque: false, col: 0x7a5a30, hardness: 1.2, drop: B.DOOR, interact: 'door' },
  [B.BED]:        { name: 'Bed', solid: true, opaque: false, col: [0x9a3b34,0x6a4a3a,0x5a4634], hardness: 0.5, drop: B.BED, place: true, interact: 'bed' },

  [B.GENERATOR]:  { name: 'Fuel generator', solid: true, opaque: true, col: [0x3a4048,0x2f353c,0x24282e], accent: 0xe0a83e, hardness: 3.2, drop: B.GENERATOR, place: true, interact: 'machine', machine: 'generator' },
  [B.WIRE]:       { name: 'Power cable', solid: false, opaque: false, col: 0xc07a2a, hardness: 0.3, drop: B.WIRE, place: true, wire: true, transparent: true, slim: 0.12 },
  [B.LAMP]:       { name: 'Powered lamp', solid: true, opaque: false, col: 0x2a2e33, accent: 0xffe9a8, hardness: 0.8, drop: B.LAMP, place: true, machine: 'lamp' },
  [B.DRILL]:      { name: 'Mining drill', solid: true, opaque: true, col: [0x4a4e54,0x3a3e44,0x2f333a], accent: 0xc9524a, hardness: 3.2, drop: B.DRILL, place: true, interact: 'machine', machine: 'drill' },
  [B.TURRET]:     { name: 'Warm-body turret', solid: true, opaque: true, col: [0x44484f,0x393d44,0x2f333a], accent: 0x74c7c4, hardness: 3.2, drop: B.TURRET, place: true, interact: 'machine', machine: 'turret' },
  [B.BEACON]:     { name: 'Field recovery beacon', solid: true, opaque: true, col: [0x3a4a44,0x2f3c38,0x24302c], accent: 0x7fae62, hardness: 3.0, drop: B.BEACON, place: true, interact: 'machine', machine: 'beacon' },
  [B.CRADLE]:     { name: 'Lazarus cradle', solid: true, opaque: true, col: [0x40404a,0x34343e,0x282832], accent: 0x9d8fd4, hardness: 4.0, place: true, interact: 'machine', machine: 'cradle' },

  [B.LAB_WALL]:   { name: 'Lab bulkhead', solid: true, opaque: true, col: [0x5a6066,0x4e545a,0x42484e], hardness: Infinity },
  [B.LAB_FLOOR]:  { name: 'Lab plating', solid: true, opaque: true, col: [0x484e54,0x3e444a,0x363c42], hardness: Infinity },
  [B.LAB_LIGHT]:  { name: 'Lab light', solid: true, opaque: false, col: 0xbfe6ff, light: 13, hardness: Infinity, emits: { light: 0.3 } },

  [B.COLONY]:     { name: 'Mineralized colony', solid: true, opaque: true, col: [0x7a6a4a,0x63543a,0x4e4230], accent: 0xb5c98a, hardness: 6.0, tool: 'pick', drop: null, colony: true },
  [B.CYST]:       { name: 'Cyst film', solid: true, opaque: false, transparent: true, col: 0xa8b06a, hardness: 0.4, drop: null, emits: { spores: 0.5 } },
  [B.NEST]:       { name: 'Infected nest', solid: true, opaque: true, col: [0x5a4a5a,0x4a3c4a,0x3a2e3a], accent: 0xc06a8a, hardness: 2.0, drop: null, emits: { spores: 0.7, blood: 0.3 } },

  [B.ARCHIVE_1]:  { name: 'Ward Seven fragment', solid: false, opaque: false, transparent: true, col: 0xe8d8a8, light: 8, hardness: 0.2, archive: 1, interact: 'archive', slim: 0.28 },
  [B.ARCHIVE_2]:  { name: 'Ventilation incident log', solid: false, opaque: false, transparent: true, col: 0xd8e0a8, light: 8, hardness: 0.2, archive: 2, interact: 'archive', slim: 0.28 },
  [B.ARCHIVE_3]:  { name: "Venn's reservoir protocol", solid: false, opaque: false, transparent: true, col: 0xe8b878, light: 8, hardness: 0.2, archive: 3, interact: 'archive', slim: 0.28 },

  [B.TORCH]:      { name: 'Torch', solid: false, opaque: false, transparent: true, col: 0xffb347, light: 12, hardness: 0.1, drop: B.TORCH, place: true, emits: { light: 0.4, heat: 0.15 }, slim: 0.1 },
};

// --- Item registry -------------------------------------------------------
// Items that are not placeable blocks (tools, materials, consumables).
// Placeable blocks are auto-registered as items sharing the block id space
// under the `block:` namespace by the inventory module.
export const ITEMS = {
  stick:        { name: 'Stick', color: 0x8a6a3e, stack: 99 },
  stone_shard:  { name: 'Stone', color: 0x8a8f96, stack: 99 },
  fiber:        { name: 'Plant fiber', color: 0x8fae5a, stack: 99 },
  iron_ore_raw: { name: 'Raw iron ore', color: 0xc9a58a, stack: 99, blockLike: B.IRON_ORE },
  iron_ingot:   { name: 'Iron ingot', color: 0xd0d4d8, stack: 99 },
  coal:         { name: 'Coal', color: 0x2a2a2a, stack: 99, blockLike: B.COAL_ORE, fuel: 8 },
  raw_meat:     { name: 'Raw meat', color: 0xb5564e, stack: 20, food: 8, emits: { blood: 0.5 } },
  cooked_meat:  { name: 'Cooked meat', color: 0x9a6a3a, stack: 20, food: 22, sanity: 4 },

  // tools: kind (pick/axe/shovel/sword), tier, speed, damage, durability
  stone_pick:   { name: 'Stone pickaxe', color: 0x8a8f96, tool: 'pick', tier: 0, speed: 2.2, dmg: 2, stack: 1, dur: 60 },
  stone_axe:    { name: 'Stone axe', color: 0x8a8f96, tool: 'axe', tier: 0, speed: 2.2, dmg: 3, stack: 1, dur: 60 },
  stone_shovel: { name: 'Stone shovel', color: 0x8a8f96, tool: 'shovel', tier: 0, speed: 2.4, dmg: 1, stack: 1, dur: 60 },
  stone_spear:  { name: 'Stone spear', color: 0x8a8f96, tool: 'sword', tier: 0, speed: 1, dmg: 5, stack: 1, dur: 50, reach: 4.2 },

  iron_pick:    { name: 'Iron pickaxe', color: 0xd0d4d8, tool: 'pick', tier: 1, speed: 4.0, dmg: 4, stack: 1, dur: 220 },
  iron_axe:     { name: 'Iron axe', color: 0xd0d4d8, tool: 'axe', tier: 1, speed: 4.0, dmg: 5, stack: 1, dur: 220 },
  iron_blade:   { name: 'Iron blade', color: 0xe0e4e8, tool: 'sword', tier: 1, speed: 1, dmg: 9, stack: 1, dur: 200, reach: 4.0, spec: 'combat' },
  iron_ampoule: { name: 'Biotic ampoule', color: 0x7fae62, stack: 8, desc: 'Continuity charge for a field beacon.' },
  suppressant:  { name: 'Neural suppressant', color: 0x86d4d0, stack: 8, sanity: 30, desc: 'Restores neural stability.' },
  turret_ammo:  { name: 'Turret slugs', color: 0xc9a58a, stack: 99 },
  continuity_core:{ name: 'Continuity core', color: 0x9d8fd4, stack: 1, desc: 'Rare component. Powers a Lazarus Cradle.' },
};

// Tool tier names for messaging.
export const TOOL_TIER = ['stone', 'iron', 'steel'];

// --- Crafting recipes ----------------------------------------------------
// station: null (hand), 'bench', 'furnace'. cost: {itemOrBlock: n}. out: {id, n}.
// Block ids are referenced as `b:<id>`; items by their key.
export const RECIPES = [
  // hand
  { id: 'stone_pick', station: null, cost: { stone_shard: 2, stick: 2 }, out: { stone_pick: 1 } },
  { id: 'stone_axe', station: null, cost: { stone_shard: 3, stick: 2 }, out: { stone_axe: 1 } },
  { id: 'stone_shovel', station: null, cost: { stone_shard: 1, stick: 2 }, out: { stone_shovel: 1 } },
  { id: 'stone_spear', station: null, cost: { stone_shard: 2, stick: 2, fiber: 1 }, out: { stone_spear: 1 } },
  { id: 'plank', station: null, cost: { 'b:7': 1 }, out: { 'b:12': 4 }, label: 'Wood planks' },
  { id: 'stick2', station: null, cost: { 'b:12': 1 }, out: { stick: 4 }, label: 'Sticks' },
  { id: 'bench', station: null, cost: { 'b:12': 4 }, out: { 'b:16': 1 }, label: 'Crafting bench' },
  { id: 'campfire', station: null, cost: { stick: 5, stone_shard: 3 }, out: { 'b:17': 1 }, label: 'Campfire' },
  { id: 'torch', station: null, cost: { stick: 1, coal: 1 }, out: { 'b:38': 4 }, label: 'Torch' },

  // bench — structures & tier progression
  { id: 'wood_wall', station: 'bench', cost: { 'b:12': 2 }, out: { 'b:39': 4 }, label: 'Timber walls' },
  { id: 'door', station: 'bench', cost: { 'b:12': 6 }, out: { 'b:19': 1 }, label: 'Door' },
  { id: 'furnace', station: 'bench', cost: { stone_shard: 8 }, out: { 'b:18': 1 }, label: 'Furnace' },
  { id: 'bed', station: 'bench', cost: { 'b:12': 3, fiber: 4 }, out: { 'b:21': 1 }, label: 'Bed' },
  { id: 'stone_brick', station: 'bench', cost: { stone_shard: 4 }, out: { 'b:13': 4 }, label: 'Reinforced walls' },
  { id: 'glass', station: 'bench', cost: { 'b:5': 2 }, out: { 'b:15': 2 }, label: 'Windows (from sand)' },

  // iron tier (needs iron ingots, at bench)
  { id: 'iron_pick', station: 'bench', cost: { iron_ingot: 3, stick: 2 }, out: { iron_pick: 1 }, tierUnlock: 'iron' },
  { id: 'iron_axe', station: 'bench', cost: { iron_ingot: 3, stick: 2 }, out: { iron_axe: 1 }, tierUnlock: 'iron' },
  { id: 'iron_blade', station: 'bench', cost: { iron_ingot: 4, stick: 1 }, out: { iron_blade: 1 }, tierUnlock: 'iron', spec: 'Combat specialization' },
  { id: 'iron_block', station: 'bench', cost: { iron_ingot: 4 }, out: { 'b:14': 1 }, label: 'Iron plating', tierUnlock: 'iron', spec: 'Defense specialization' },
  { id: 'ampoule', station: 'bench', cost: { iron_ingot: 1, fiber: 3 }, out: { iron_ampoule: 1 }, label: 'Biotic ampoule', tierUnlock: 'iron' },

  // power tier (needs iron + at bench; conceptually steel-lite for the slice)
  { id: 'generator', station: 'bench', cost: { iron_ingot: 5, 'b:13': 2 }, out: { 'b:22': 1 }, label: 'Fuel generator', tierUnlock: 'iron', spec: 'Mechanical productivity' },
  { id: 'wire', station: 'bench', cost: { iron_ingot: 1 }, out: { 'b:23': 8 }, label: 'Power cable', tierUnlock: 'iron' },
  { id: 'lamp', station: 'bench', cost: { iron_ingot: 1, coal: 1 }, out: { 'b:24': 2 }, label: 'Powered lamp', tierUnlock: 'iron' },
  { id: 'drill', station: 'bench', cost: { iron_ingot: 6, 'b:23': 2 }, out: { 'b:25': 1 }, label: 'Mining drill', tierUnlock: 'iron' },
  { id: 'turret', station: 'bench', cost: { iron_ingot: 6, 'b:23': 2 }, out: { 'b:26': 1 }, label: 'Warm-body turret', tierUnlock: 'iron', spec: 'Powered defense' },
  { id: 'turret_ammo', station: 'bench', cost: { stone_shard: 4 }, out: { turret_ammo: 8 }, label: 'Turret slugs', tierUnlock: 'iron' },
  { id: 'beacon', station: 'bench', cost: { iron_ingot: 8, 'b:23': 4 }, out: { 'b:27': 1 }, label: 'Field recovery beacon', tierUnlock: 'iron' },

  // furnace smelting
  { id: 'smelt_iron', station: 'furnace', cost: { iron_ore_raw: 1 }, out: { iron_ingot: 1 }, smelt: true },
  { id: 'cook_meat', station: 'furnace', cost: { raw_meat: 1 }, out: { cooked_meat: 1 }, smelt: true },
];

// --- Machine behavior ----------------------------------------------------
export const MACHINES = {
  generator: {
    powerOutput: 12, fuelCapacity: 40, fuelPerSec: 0.08,
    emits: { heat: 0.75, vibration: 0.45, electrical: 0.7, light: 0.1 },
    radius: 42,
  },
  lamp:  { powerDraw: 1, light: 14, emits: { light: 0.5, electrical: 0.15 }, radius: 26, sanityAura: 6 },
  drill: { powerDraw: 4, orePerSec: 0.5, emits: { heat: 0.2, vibration: 0.9, electrical: 0.4 }, radius: 36 },
  turret: {
    powerDraw: 3, range: 14, fireRate: 0.55, dmg: 6, heatPerShot: 0.09, heatCool: 0.14, heatMax: 1,
    emits: { heat: 0.25, electrical: 0.5, vibration: 0.15 }, radius: 24,
  },
  beacon: { powerDraw: 2, emits: { electrical: 0.3 }, radius: 18 },
  cradle: { powerDraw: 5, emits: { electrical: 0.6, heat: 0.2 }, radius: 22 },
};

// --- Signature channels & propagation (§5) ------------------------------
export const SIGNATURE = {
  channels: ['heat', 'light', 'vibration', 'co2', 'blood', 'electrical', 'spores'],
  // How far a unit source spreads and how quickly it falls off.
  falloff: 1.0,
  // Player passive emissions (breath + warmth), scaled by activity.
  playerBase: { heat: 0.25, co2: 0.3 },
  playerSprint: { heat: 0.4, co2: 0.5, vibration: 0.2 },
  bloodDecay: 0.06,   // organic scent left by combat decays per second
  // Insulation: opaque solid blocks between source and sampler attenuate.
  wallAttenuation: 0.55,
};

// --- Strain sensory profiles (§5.4) -------------------------------------
// Each strain weights signature channels. Thresholds gate behavior states.
export const STRAINS = {
  drifter: {
    name: 'Drifter', hp: 14, speed: 2.2, dmg: 6, color: 0x6a7a5a, scale: 1.0,
    senses: { heat: 0.8, co2: 0.6, blood: 0.7, vibration: 0.2, light: 0.3, electrical: 0.1, spores: 0 },
    thresholds: { investigate: 0.12, pursue: 0.3 }, blockDmg: 4, climbs: false,
    desc: 'Standard infected body. Follows warmth, breath, and fresh blood. Batters accessible barriers.',
  },
  runner: {
    name: 'Runner', hp: 8, speed: 4.4, dmg: 4, color: 0x8a6a4a, scale: 0.85,
    senses: { heat: 0.5, co2: 0.4, blood: 1.0, vibration: 0.7, light: 0.6, electrical: 0.2, spores: 0 },
    thresholds: { investigate: 0.1, pursue: 0.22 }, blockDmg: 2, climbs: false,
    desc: 'Fast and fragile. Strongly responsive to movement and blood. Pressures exposed players and open doors.',
  },
  machine_eater: {
    name: 'Machine eater', hp: 22, speed: 2.0, dmg: 7, color: 0x5a5a6a, scale: 1.15,
    senses: { heat: 0.7, co2: 0.1, blood: 0.2, vibration: 0.8, light: 0.2, electrical: 1.0, spores: 0 },
    thresholds: { investigate: 0.1, pursue: 0.25 }, blockDmg: 6, climbs: false, targetsMachines: true,
    desc: 'Follows heat, electrical fields, metal chemistry, and machine vibration. Prioritizes running machinery.',
  },
  // vertical-slice miniboss: a mobile colony host that guards the iron seam.
  colony_host: {
    name: 'Colony host', hp: 220, speed: 1.1, dmg: 14, color: 0x8a9a5a, scale: 1.8,
    senses: { heat: 0.6, co2: 0.4, blood: 0.6, vibration: 0.5, light: 0.2, electrical: 0.4, spores: 0 },
    thresholds: { investigate: 0.08, pursue: 0.18 }, blockDmg: 10, climbs: false, boss: true,
    desc: 'A tissue-fused colony host mineralized into the cave wall. Removing it exposes the iron seam.',
  },
};

// --- Threat director / night assault (§6) -------------------------------
export const THREAT = {
  // Base assault composition scales with day count.
  duskWarnFrac: 0.68,        // when the forecast becomes available
  incursionCooldown: 60,     // seconds between possible conditional incursions
  incursionSigThreshold: 1.6,// combined outdoor signature to trigger an incursion
  // A major assault's composition is a "question" chosen by dominant signature.
  assaults: [
    { id: 'warm_tracks', tag: 'Heat-seekers', dominant: 'heat',
      base: { drifter: 5, runner: 2, machine_eater: 1 }, perDay: { drifter: 1.4, machine_eater: 0.5 },
      forecast: 'Warm tracks in the frost — bodies drawn to your heat.' },
    { id: 'live_wire', tag: 'Machine eaters', dominant: 'electrical',
      base: { drifter: 3, runner: 2, machine_eater: 3 }, perDay: { machine_eater: 1.1, drifter: 0.8 },
      forecast: 'Field-sensitive strains converging on live circuits.' },
    { id: 'blood_run', tag: 'Runners', dominant: 'blood',
      base: { drifter: 3, runner: 6 }, perDay: { runner: 1.6, drifter: 0.6 },
      forecast: 'Scent of blood on the wind — a fast, fragile swarm.' },
    { id: 'baseline', tag: 'Mixed drift', dominant: null,
      base: { drifter: 5, runner: 2 }, perDay: { drifter: 1.2, runner: 0.5 },
      forecast: 'Scattered drift toward the strongest signals.' },
  ],
  maxTier: 3,
};

// --- Sanity (§7) ---------------------------------------------------------
export const SANITY = {
  MAX: 100,
  dayGain: 3.2,          // per minute in daylight, sheltered
  nightLoss: 4.5,        // per minute exposed at night
  darkLoss: 2.0,         // in darkness
  sporeLoss: 6.0,        // near cysts/nests/reservoir
  sleepGain: 40,
  lampAura: 0.5,         // multiplier reducing night loss under powered light
  thresholds: { stable: 51, unstable: 26, hallucinating: 1 },
  // presentation intensities per band
};

// --- Recovery ladder (§13) ----------------------------------------------
export const RECOVERY = {
  emergencyUses: 1,          // starting refuge, one-time
  beaconChargePerAmpoule: 1,
  respawnHealth: 60,
  respawnSanity: 55,
};

// --- Scoring / valley recovery (§14) ------------------------------------
export const SCORE = {
  perDay: 100,
  perKill: { drifter: 5, runner: 6, machine_eater: 10, colony_host: 400 },
  perAssault: 150,
  valley: {
    archive: 8,        // each of 3
    miniboss: 20,
    firstAssault: 12,
    ironTier: 8,
    labFound: 6,
    firstNightSurvived: 6,
  },
};

export const PLAYER = {
  maxHealth: 100, maxHunger: 100,
  reach: 5.0,
  height: 1.7, radius: 0.35, eye: 1.55,
  walk: 4.4, sprint: 7.0, jump: 8.4, gravity: 26,
  hungerPerSec: 0.10, starveDmg: 1.2,
  regenAtHunger: 40, regenRate: 1.5,
};
