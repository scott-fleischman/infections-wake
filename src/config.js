// ============================================================================
// Data-driven configuration (spec §22).
// Everything tunable lives here: blocks, items, recipes, machines, strains,
// threat compositions, sanity/signature constants. Core code reads from these
// tables and must not hard-code the values.
// ============================================================================

export const WORLD = {
  CHUNK: 16,
  HEIGHT: 56,
  SEA_LEVEL: 20,
  SURFACE: 24,
  // Story core: the hand-authored valley (spawn shack, lab, transit, Deep
  // Site, ...). Generated whole at world start with the legacy sequential
  // generator, pinned in memory for the whole session, coordinates 0..CORE.
  CORE_X: 192,
  CORE_Z: 192,
  // The world is otherwise unbounded wilderness, streamed in chunks out to a
  // containment rim HALF_SPAN blocks (Chebyshev) from the core's center —
  // a 16384×16384-block region. Beyond the rim reads as bedrock.
  HALF_SPAN: 8192,
  // Streaming radii (in chunks) and per-frame budgets (generate/mesh ms).
  VIEW: { mesh: 7, data: 13, genPerFrame: 3, genMs: 6, meshMs: 7 },
};
WORLD.CORE_CHUNKS_X = WORLD.CORE_X / WORLD.CHUNK;
WORLD.CORE_CHUNKS_Z = WORLD.CORE_Z / WORLD.CHUNK;
WORLD.CENTER_X = WORLD.CORE_X / 2;
WORLD.CENTER_Z = WORLD.CORE_Z / 2;
// The legacy core generator's densities were tuned per-area at 128x128.
WORLD.CORE_AREA_SCALE = (WORLD.CORE_X * WORLD.CORE_Z) / (128 * 128);

// Day length in real seconds (tunable, §27). One full day = DAY_LENGTH seconds.
// Day runs DAWN→DUSK and night DUSK→DAWN — symmetric fractions make each half
// exactly DAY_LENGTH/2 (15 real minutes).
export const TIME = {
  DAY_LENGTH: 1800,     // 30 real minutes per full cycle: 15-minute halves
  DAWN: 0.25,           // fraction of day where dawn begins
  DUSK: 0.75,           // fraction where dusk begins
  NIGHT: 0.82,          // fraction where full night begins
  DAWN_END: 0.30,
};

// --- Worldgen (§4) --------------------------------------------------------
// Ore hills (wishlist #4): walk-in mounds whose interiors hold dense, FINITE
// ore bodies — deposits you can see, walk to, and exhaust, Factorio-style.
export const WORLDGEN = {
  oreHills: {
    count: 4,          // per original 128x128 area — core scales with CORE_AREA_SCALE
    radiusMin: 5,
    radiusMax: 8,
    clearance: 26,     // min distance from structure sites & the spawn shack
    spacing: 22,       // min distance between hills
    minOre: 45,        // guaranteed ore blocks per hill
    outcrops: 5,       // ore cells exposed on the flank so the deposit reads from outside
  },
  // Streamed wilderness densities (position-hashed, order-independent).
  wild: {
    hillCell: 64,      // one candidate ore hill per 64x64 cell...
    hillChance: 0.7,   // ...that actually forms this often (≈ core density)
    veinChance: 0.4,   // per-chunk chance of a second ore vein (first is guaranteed)
    nestChance: 0.045, // per-chunk chance of an infected nest in a cave pocket
    treeDensity: 0.035,// per-column, scaled down on plains (matches the core)
    rimStart: 48,      // rim mountains begin this far inside the world border
    rimHeight: 24,     // how far the containment rim swells above the terrain
  },
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
  // steel & electricity tier (§11.1)
  STEEL_BLOCK: 40, BATTERY: 41, SWITCH: 42, SCRUBBER: 43, UV_EMITTER: 44,
  VIB_TURRET: 45, SENSOR: 46, MAINT_BENCH: 47, CHEST: 48, TRAP: 49,
  // regional containment transit + Deep Site (§17–18)
  TRANSIT_HULL: 50, TRANSIT_PANEL: 51, TRANSIT_GATE: 52,
  DEEP_WALL: 53, DEEP_FLOOR: 54, DEEP_LIGHT: 55, VALVE: 56, RESERVOIR_TISSUE: 57,
  // industrial ruins / settlement (§4.3)
  RUIN_WALL: 58, RUIN_FLOOR: 59, SCRAP: 60, KILN: 61,
  ARCHIVE_4: 62, ARCHIVE_5: 63, RADIO: 64, DOC_SHELF: 65,
  // second cells of multi-block furniture (pair math lives in multiblock.js):
  // doors stand 2 tall, beds lie 2 long with the facing encoded in the head id
  DOOR_TOP: 66, DOOR_TOP_OPEN: 67, BED_FOOT: 68, BED_N: 69, BED_E: 70, BED_W: 71,
  // the heart of an ore hill: never-depleting lode blocks (`lode:` field below)
  IRON_LODE: 72, COAL_LODE: 73,
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
  // deliberately NO `toolMin` on raw ore: the iron pickaxe is bought with iron
  // ingots, so gating the ore behind an iron pick locks the tier against
  // itself. A stone pick digs it out (bare hands too, at a crawl) and the iron
  // pick is a speed reward rather than a key. test/progression.test.js proves
  // every tier is reachable from the one below — do not add `toolMin` here.
  [B.IRON_ORE]:   { name: 'Iron ore', solid: true, opaque: true, col: 0x8a8079, accent: 0xc9a58a, hardness: 3.4, tool: 'pick', drop: B.IRON_ORE },
  [B.COAL_ORE]:   { name: 'Coal ore', solid: true, opaque: true, col: 0x5c5a58, accent: 0x201f1e, hardness: 2.8, tool: 'pick', drop: B.COAL_ORE },
  // `lode:` — the block yields that item on every harvest and never breaks
  // (no `drop`, nothing consumes it): the never-depleting heart of a hill.
  // The iron lode DOES keep `toolMin` — it is the reward the iron pick buys,
  // and the finite ore around it is what bootstraps you to that pick.
  [B.IRON_LODE]:  { name: 'Iron lode', solid: true, opaque: true, col: 0x93857a, accent: 0xe6bd94, hardness: 4.5, tool: 'pick', toolMin: 1, lode: 'iron_ore_raw' },
  [B.COAL_LODE]:  { name: 'Coal lode', solid: true, opaque: true, col: 0x53514f, accent: 0x191817, hardness: 3.8, tool: 'pick', lode: 'coal' },
  [B.WATER]:      { name: 'Water', solid: false, opaque: false, col: 0x2c5d8a, liquid: true, transparent: true },

  [B.PLANK]:      { name: 'Wood plank', solid: true, opaque: true, col: 0x8a6a3e, hardness: 1.0, tool: 'axe', drop: B.PLANK, flammable: true, place: true },
  [B.WOOD_WALL]:  { name: 'Timber wall', solid: true, opaque: true, col: [0x6b542f,0x7a6236,0x6b542f], hardness: 1.6, tool: 'axe', drop: B.WOOD_WALL, flammable: true, place: true },
  [B.STONE_BRICK]:{ name: 'Reinforced wall', solid: true, opaque: true, col: 0x656b72, hardness: 3.0, tool: 'pick', drop: B.STONE_BRICK, place: true, armor: 2 },
  [B.IRON_BLOCK]: { name: 'Iron plating', solid: true, opaque: true, col: 0x9aa0a6, accent: 0xcfd3d6, hardness: 4.0, tool: 'pick', drop: B.IRON_BLOCK, place: true, armor: 3, metal: true, emits: { metal: 0.08 } },
  [B.GLASS]:      { name: 'Window', solid: true, opaque: false, transparent: true, col: 0x9fd4e0, hardness: 0.4, drop: null, place: true },

  // `model:` — rendered as a detailed prop mesh (models.js) instead of a cube;
  // these must be non-opaque so the mesher still draws neighbor faces behind
  // them. `senseOpaque:` — still blocks signatures/sight like a wall (§5).
  [B.BENCH]:      { name: 'Crafting bench', solid: true, opaque: false, model: 'bench', col: [0x8a6a3e,0x6b4e2e,0x6b4e2e], hardness: 1.0, drop: B.BENCH, place: true, interact: 'bench' },
  [B.CAMPFIRE]:   { name: 'Campfire', solid: true, opaque: false, model: 'campfire', col: 0xd8863a, light: 11, hardness: 0.4, drop: B.CAMPFIRE, place: true, interact: 'campfire', emits: { heat: 0.6, light: 0.9 } },
  [B.FURNACE]:    { name: 'Furnace', solid: true, opaque: false, senseOpaque: true, model: 'furnace', col: [0x585858,0x4a4a4a,0x3a3a3a], hardness: 2.6, drop: B.FURNACE, place: true, interact: 'furnace' },
  [B.DOOR]:       { name: 'Door', solid: true, opaque: false, senseOpaque: true, model: 'door', col: 0x7a5a30, hardness: 1.2, drop: B.DOOR, place: true, interact: 'door', armor: 1 },
  [B.DOOR_OPEN]:  { name: 'Door', solid: false, opaque: false, model: 'door', col: 0x7a5a30, hardness: 1.2, drop: B.DOOR, interact: 'door' },
  [B.BED]:        { name: 'Bed', solid: true, opaque: false, model: 'bed', col: [0x9a3b34,0x6a4a3a,0x5a4634], hardness: 0.5, drop: B.BED, place: true, interact: 'bed' },

  // `model: 'none'` — the far cell of a multi-block. The owner cell's prop
  // already spans both, so the mesher and props.js draw nothing here; the id
  // still carries collision, senses and interaction. Never held as an item:
  // breaking either cell drops one B.DOOR / B.BED (main.js breakBlock).
  [B.DOOR_TOP]:     { name: 'Door', solid: true, opaque: false, senseOpaque: true, model: 'none', col: 0x7a5a30, hardness: 1.2, drop: null, interact: 'door', armor: 1 },
  [B.DOOR_TOP_OPEN]:{ name: 'Door', solid: false, opaque: false, model: 'none', col: 0x7a5a30, hardness: 1.2, drop: null, interact: 'door' },
  // BED itself is the head facing +z; these three cover the other cardinals
  [B.BED_N]:      { name: 'Bed', solid: true, opaque: false, model: 'bed', col: [0x9a3b34,0x6a4a3a,0x5a4634], hardness: 0.5, drop: null, interact: 'bed' },
  [B.BED_E]:      { name: 'Bed', solid: true, opaque: false, model: 'bed', col: [0x9a3b34,0x6a4a3a,0x5a4634], hardness: 0.5, drop: null, interact: 'bed' },
  [B.BED_W]:      { name: 'Bed', solid: true, opaque: false, model: 'bed', col: [0x9a3b34,0x6a4a3a,0x5a4634], hardness: 0.5, drop: null, interact: 'bed' },
  [B.BED_FOOT]:   { name: 'Bed', solid: true, opaque: false, model: 'none', col: [0x9a3b34,0x6a4a3a,0x5a4634], hardness: 0.5, drop: null, interact: 'bed' },

  [B.GENERATOR]:  { name: 'Fuel generator', solid: true, opaque: false, model: 'generator', col: [0x3a4048,0x2f353c,0x24282e], accent: 0xe0a83e, hardness: 3.2, drop: B.GENERATOR, place: true, interact: 'machine', machine: 'generator' },
  [B.WIRE]:       { name: 'Power cable', solid: false, opaque: false, col: 0xc07a2a, hardness: 0.3, drop: B.WIRE, place: true, wire: true, transparent: true, slim: 0.12 },
  [B.LAMP]:       { name: 'Powered lamp', solid: true, opaque: false, model: 'lamp', col: 0x2a2e33, accent: 0xffe9a8, hardness: 0.8, drop: B.LAMP, place: true, machine: 'lamp' },
  [B.DRILL]:      { name: 'Mining drill', solid: true, opaque: false, model: 'drill', col: [0x4a4e54,0x3a3e44,0x2f333a], accent: 0xc9524a, hardness: 3.2, drop: B.DRILL, place: true, interact: 'machine', machine: 'drill' },
  [B.TURRET]:     { name: 'Warm-body turret', solid: true, opaque: false, model: 'turret', col: [0x44484f,0x393d44,0x2f333a], accent: 0x74c7c4, hardness: 3.2, drop: B.TURRET, place: true, interact: 'machine', machine: 'turret' },
  [B.BEACON]:     { name: 'Field recovery beacon', solid: true, opaque: false, model: 'beacon', col: [0x3a4a44,0x2f3c38,0x24302c], accent: 0x7fae62, hardness: 3.0, drop: B.BEACON, place: true, interact: 'machine', machine: 'beacon' },
  [B.CRADLE]:     { name: 'Lazarus cradle', solid: true, opaque: false, senseOpaque: true, model: 'cradle', col: [0x40404a,0x34343e,0x282832], accent: 0x9d8fd4, hardness: 4.0, drop: B.CRADLE, place: true, interact: 'machine', machine: 'cradle' },

  [B.LAB_WALL]:   { name: 'Lab bulkhead', solid: true, opaque: true, col: [0x5a6066,0x4e545a,0x42484e], hardness: Infinity },
  [B.LAB_FLOOR]:  { name: 'Lab plating', solid: true, opaque: true, col: [0x484e54,0x3e444a,0x363c42], hardness: Infinity },
  [B.LAB_LIGHT]:  { name: 'Lab light', solid: true, opaque: false, col: 0xbfe6ff, light: 13, hardness: Infinity, emits: { light: 0.3 } },

  [B.COLONY]:     { name: 'Mineralized colony', solid: true, opaque: true, col: [0x7a6a4a,0x63543a,0x4e4230], accent: 0xb5c98a, hardness: 6.0, tool: 'pick', drop: null, colony: true },
  [B.CYST]:       { name: 'Cyst film', solid: true, opaque: false, transparent: true, col: 0xa8b06a, hardness: 0.4, drop: null, emits: { spores: 0.5 } },
  [B.NEST]:       { name: 'Infected nest', solid: true, opaque: true, col: [0x5a4a5a,0x4a3c4a,0x3a2e3a], accent: 0xc06a8a, hardness: 2.0, drop: null, emits: { spores: 0.7, blood: 0.3 } },

  // Archives are indestructible: cataloged, never consumed or lost (§16.1).
  // (`slim` is kept alongside `model` so the raycaster still targets them.)
  [B.ARCHIVE_1]:  { name: 'Ward Seven fragment', solid: false, opaque: false, transparent: true, col: 0xe8d8a8, light: 8, hardness: Infinity, archive: 1, interact: 'archive', slim: 0.28, model: 'archive' },
  [B.ARCHIVE_2]:  { name: 'Ventilation incident log', solid: false, opaque: false, transparent: true, col: 0xd8e0a8, light: 8, hardness: Infinity, archive: 2, interact: 'archive', slim: 0.28, model: 'archive' },
  [B.ARCHIVE_3]:  { name: "Venn's reservoir protocol", solid: false, opaque: false, transparent: true, col: 0xe8b878, light: 8, hardness: Infinity, archive: 3, interact: 'archive', slim: 0.28, model: 'archive' },

  [B.TORCH]:      { name: 'Torch', solid: false, opaque: false, transparent: true, col: 0xffb347, light: 12, hardness: 0.1, drop: B.TORCH, place: true, emits: { light: 0.4, heat: 0.15 }, slim: 0.1, model: 'torch' },

  // --- steel & electricity tier (§11.1) ---
  // Exposed metal has a chemistry signature (§5.2 metal channel).
  [B.STEEL_BLOCK]:{ name: 'Steel plating', solid: true, opaque: true, col: 0x7e8894, accent: 0xaeb8c4, hardness: 5.0, tool: 'pick', toolMin: 1, drop: B.STEEL_BLOCK, place: true, armor: 5, metal: true, emits: { metal: 0.1 } },
  [B.BATTERY]:    { name: 'Battery bank', solid: true, opaque: false, model: 'battery', col: [0x3a4048,0x30363e,0x262b31], accent: 0x74c7c4, hardness: 3.4, drop: B.BATTERY, place: true, interact: 'machine', machine: 'battery' },
  [B.SWITCH]:     { name: 'Circuit switch', solid: false, opaque: false, transparent: true, col: 0xc07a2a, hardness: 0.4, drop: B.SWITCH, place: true, interact: 'switch', machine: 'switch', slim: 0.16, model: 'switch' },
  [B.SCRUBBER]:   { name: 'Air scrubber', solid: true, opaque: false, model: 'scrubber', col: [0x44504c,0x3a4440,0x2f3835], accent: 0x86d4d0, hardness: 3.0, drop: B.SCRUBBER, place: true, interact: 'machine', machine: 'scrubber' },
  [B.UV_EMITTER]: { name: 'UV sterilizer', solid: true, opaque: false, model: 'uv', col: [0x3e3a4e,0x343044,0x2a2738], accent: 0x8a5ad4, hardness: 3.0, drop: B.UV_EMITTER, place: true, interact: 'machine', machine: 'uv' },
  [B.VIB_TURRET]: { name: 'Vibration turret', solid: true, opaque: false, model: 'vibturret', col: [0x4f4a44,0x443f3a,0x38342f], accent: 0xe0a83e, hardness: 3.2, drop: B.VIB_TURRET, place: true, interact: 'machine', machine: 'vibturret' },
  [B.SENSOR]:     { name: 'Field sensor', solid: false, opaque: false, transparent: true, col: 0x74c7c4, hardness: 1.0, drop: B.SENSOR, place: true, interact: 'machine', machine: 'sensor', slim: 0.14, model: 'sensor' },
  [B.MAINT_BENCH]:{ name: 'Maintenance bench', solid: true, opaque: false, model: 'maint', col: [0x5a5244,0x4c4538,0x3e392e], accent: 0xc9a58a, hardness: 2.4, drop: B.MAINT_BENCH, place: true, interact: 'machine', machine: 'maint' },
  [B.CHEST]:      { name: 'Sealed crate', solid: true, opaque: false, model: 'chest', col: [0x6b542f,0x5d4526,0x4d3a22], hardness: 1.6, drop: B.CHEST, place: true, interact: 'chest' },
  [B.TRAP]:       { name: 'Spike trap', solid: false, opaque: false, transparent: true, col: 0x8a8f96, hardness: 0.6, drop: B.TRAP, place: true, slim: 0.3, model: 'trap' },

  // --- regional containment transit (§17) — hardened, indestructible ---
  [B.TRANSIT_HULL]: { name: 'Containment hull', solid: true, opaque: true, col: [0x4e5a62,0x424e56,0x36424a], hardness: Infinity },
  [B.TRANSIT_PANEL]:{ name: 'Transit control panel', solid: true, opaque: false, senseOpaque: true, model: 'transit_panel', col: [0x3a4048,0x2f353c,0x24282e], accent: 0xe0a83e, hardness: Infinity, interact: 'transit', machine: 'transit' },
  [B.TRANSIT_GATE]: { name: 'Pressure rail gate', solid: true, opaque: false, senseOpaque: true, model: 'transit_gate', col: [0x4e5a62,0x424e56,0x36424a], accent: 0xd94f4f, hardness: Infinity, interact: 'gate' },

  // --- Lazarus Deep Site (§18) ---
  [B.DEEP_WALL]:  { name: 'Deep Site bulkhead', solid: true, opaque: true, col: [0x3e4a54,0x34404a,0x2a3640], hardness: Infinity },
  [B.DEEP_FLOOR]: { name: 'Deep Site plating', solid: true, opaque: true, col: [0x323e48,0x2a343e,0x242e36], hardness: Infinity },
  [B.DEEP_LIGHT]: { name: 'Deep Site light', solid: true, opaque: false, col: 0x9fc4d4, light: 12, hardness: Infinity, emits: { light: 0.25 } },
  [B.VALVE]:      { name: 'Purge valve', solid: true, opaque: false, senseOpaque: true, model: 'valve', col: [0x5a5244,0x4c4538,0x3e392e], accent: 0x7fae62, hardness: Infinity, interact: 'valve' },
  [B.RESERVOIR_TISSUE]: { name: 'Reservoir growth', solid: true, opaque: true, col: [0x8a9a6a,0x74845a,0x5e6c48], accent: 0xd4e0a8, hardness: 4.5, tool: 'pick', drop: null, tissue: true, emits: { heat: 0.35, spores: 0.5 } },

  // --- industrial ruins & abandoned settlement (§4.3) ---
  [B.RUIN_WALL]:  { name: 'Ruined concrete', solid: true, opaque: true, col: [0x6e6a64,0x625e58,0x54514c], hardness: 3.4, tool: 'pick', drop: B.RUIN_WALL },
  [B.RUIN_FLOOR]: { name: 'Cracked slab', solid: true, opaque: true, col: [0x5e5b56,0x54514c,0x4a4742], hardness: 3.2, tool: 'pick', drop: null },
  [B.SCRAP]:      { name: 'Machine scrap', solid: true, opaque: true, col: [0x5a5450,0x4e4844,0x423e3a], accent: 0x8a6a3e, hardness: 2.2, tool: 'pick', drop: null, scrap: true, emits: { metal: 0.15 } },
  [B.KILN]:       { name: 'Industrial kiln', solid: true, opaque: false, senseOpaque: true, model: 'kiln', col: [0x6a4a3a,0x5a3e30,0x4a3226], accent: 0xff7030, hardness: Infinity, interact: 'kiln' },

  // late archives (indestructible, cataloged like the lab set)
  [B.ARCHIVE_4]:  { name: 'Relay station duty log', solid: false, opaque: false, transparent: true, col: 0xa8c4e0, light: 8, hardness: Infinity, archive: 4, interact: 'archive', slim: 0.28, model: 'archive' },
  [B.ARCHIVE_5]:  { name: "Venn's last entry", solid: false, opaque: false, transparent: true, col: 0xe0a8a8, light: 8, hardness: Infinity, archive: 5, interact: 'archive', slim: 0.28, model: 'archive' },

  // shortwave radio (§15.8 emotional continuity) — lives in the starting shack
  [B.RADIO]:      { name: 'Shortwave radio', solid: false, opaque: false, transparent: true, col: 0xc9a58a, hardness: 0.8, drop: B.RADIO, place: true, interact: 'radio', slim: 0.24, model: 'radio' },
  // cataloged documents can be kept and shelved (§16.1)
  [B.DOC_SHELF]:  { name: 'Cataloged document', solid: false, opaque: false, transparent: true, col: 0xe8d8a8, hardness: 0.2, drop: B.DOC_SHELF, place: true, slim: 0.22, model: 'archive' },
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
  stone_spear:  { name: 'Stone spear', color: 0x8a8f96, tool: 'sword', tier: 0, speed: 1, dmg: 5, stack: 1, dur: 50, reach: 4.2, kb: 5 },

  iron_pick:    { name: 'Iron pickaxe', color: 0xd0d4d8, tool: 'pick', tier: 1, speed: 4.0, dmg: 4, stack: 1, dur: 220 },
  iron_axe:     { name: 'Iron axe', color: 0xd0d4d8, tool: 'axe', tier: 1, speed: 4.0, dmg: 5, stack: 1, dur: 220 },
  iron_blade:   { name: 'Iron blade', color: 0xe0e4e8, tool: 'sword', tier: 1, speed: 1, dmg: 9, stack: 1, dur: 200, reach: 4.0, spec: 'combat', kb: 6 },
  iron_ampoule: { name: 'Biotic ampoule', color: 0x7fae62, stack: 8, desc: 'Continuity charge for a field beacon.' },
  suppressant:  { name: 'Neural suppressant', color: 0x86d4d0, stack: 8, sanity: 30, desc: 'Restores neural stability.' },
  turret_ammo:  { name: 'Turret slugs', color: 0xc9a58a, stack: 99 },
  continuity_core:{ name: 'Continuity core', color: 0x9d8fd4, stack: 1, desc: 'Rare component. Powers a Lazarus Cradle.' },

  // steel & advanced containment (§11.1)
  steel_ingot:  { name: 'Steel ingot', color: 0x9aa4b0, stack: 99, desc: 'Smelted at the restored industrial kiln.' },
  steel_pick:   { name: 'Steel pickaxe', color: 0x9aa4b0, tool: 'pick', tier: 2, speed: 6.0, dmg: 5, stack: 1, dur: 480 },
  steel_blade:  { name: 'Steel blade', color: 0xaeb8c4, tool: 'sword', tier: 2, speed: 1, dmg: 14, stack: 1, dur: 420, reach: 4.0, spec: 'combat', kb: 7 },
  iron_armor:   { name: 'Iron harness', color: 0xb8bcc0, stack: 1, armor: 0.3, dur: 160, desc: 'Worn while carried. Absorbs a third of each hit.' },
  hide:         { name: 'Animal hide', color: 0x9a8a72, stack: 20 },
  relay_module: { name: 'Control relay', color: 0xe0a83e, stack: 8, desc: 'Transit restoration component. Salvaged from machine scrap and laboratories.' },
  filter_unit:  { name: 'Filtration cartridge', color: 0x86d4d0, stack: 8, desc: 'For scrubbers and the transit intake. Found where the pumps drowned.' },
  sterilizer_charge: { name: 'Field sterilizer', color: 0xd4e0a8, stack: 8, desc: 'Use [RMB] on nests, cysts, and reservoir growth to sterilize a zone.' },
};

// Tool tier names for messaging.
export const TOOL_TIER = ['stone', 'iron', 'steel'];

// Harvest gate. A block carrying `toolMin` yields nothing unless the held tool
// is the right kind AND at least that tier; everything else always yields (bare
// hands included — just slowly). Keep this the only implementation: the mining
// loop and the look-at prompt both read it, and test/progression.test.js walks
// the recipe graph through it to prove no tier is gated behind itself.
export function canHarvestBlock(def, toolDef) {
  if (def?.toolMin == null) return true;
  return !!toolDef && toolDef.tool === def.tool && (toolDef.tier ?? -1) >= def.toolMin;
}

// --- Crafting recipes ----------------------------------------------------
// station: null (hand), 'bench', 'furnace'. cost: {itemOrBlock: n}. out: {id, n}.
// Block ids are referenced as `b:<id>`; items by their key.
//
// `grid` — the hand-authored crafting pattern for grid crafting. 1-3 rows of
// 1-3 cells; a cell is `null` (empty) or `{ id, n }` using the same id space as
// `cost`. Contract (enforced by test/recipes.test.js):
//   * summing `n` per id over every cell must EXACTLY equal `cost`;
//   * patterns are stored trimmed to their bounding box — the matcher is
//     translation-invariant, so only the shape matters, not where it sits in
//     the 3x3. Interior holes (the furnace ring, the cradle core) are shape;
//   * a cell may carry n > 1: some recipes cost more than 9 items (beacon,
//     cradle, maint bench, battery) and a few shapes read better with a
//     doubled tip (the drill bit, the turret barrel);
//   * recipes sharing a cost map (pick/axe, drill/turret, bricks/slugs) must
//     have distinct shapes — that difference is the whole point of the grid;
//   * smelting recipes (`smelt: true`) have NO grid — they take a single input.
export const RECIPES = [
  // hand
  { id: 'stone_pick', station: null, cost: { stone_shard: 2, stick: 2 }, out: { stone_pick: 1 },
    // two heads over a handle
    grid: [[{ id: 'stone_shard', n: 1 }, { id: 'stone_shard', n: 1 }],
           [null, { id: 'stick', n: 1 }],
           [null, { id: 'stick', n: 1 }]] },
  { id: 'stone_axe', station: null, cost: { stone_shard: 3, stick: 2 }, out: { stone_axe: 1 },
    // head in an L against the handle
    grid: [[{ id: 'stone_shard', n: 1 }, { id: 'stone_shard', n: 1 }],
           [{ id: 'stone_shard', n: 1 }, { id: 'stick', n: 1 }],
           [null, { id: 'stick', n: 1 }]] },
  { id: 'stone_shovel', station: null, cost: { stone_shard: 1, stick: 2 }, out: { stone_shovel: 1 },
    // one blade above two handle sticks
    grid: [[{ id: 'stone_shard', n: 1 }], [{ id: 'stick', n: 1 }], [{ id: 'stick', n: 1 }]] },
  { id: 'stone_spear', station: null, cost: { stone_shard: 2, stick: 2, fiber: 1 }, out: { stone_spear: 1 },
    // leaning shaft, lashing where the point meets the wood
    grid: [[null, null, { id: 'stone_shard', n: 1 }],
           [null, { id: 'fiber', n: 1 }, { id: 'stone_shard', n: 1 }],
           [{ id: 'stick', n: 1 }, { id: 'stick', n: 1 }, null]] },
  { id: 'plank', station: null, cost: { 'b:7': 1 }, out: { 'b:12': 4 }, label: 'Wood planks',
    grid: [[{ id: 'b:7', n: 1 }]] },
  { id: 'stick2', station: null, cost: { 'b:12': 1 }, out: { stick: 4 }, label: 'Sticks',
    grid: [[{ id: 'b:12', n: 1 }]] },
  { id: 'bench', station: null, cost: { 'b:12': 4 }, out: { 'b:16': 1 }, label: 'Crafting bench',
    // the classic 2x2 of planks
    grid: [[{ id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }],
           [{ id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }]] },
  { id: 'campfire', station: null, cost: { stick: 5, stone_shard: 3 }, out: { 'b:17': 1 }, label: 'Campfire',
    // sticks stacked over a stone hearth, flame gap at the top
    grid: [[{ id: 'stick', n: 1 }, null, { id: 'stick', n: 1 }],
           [{ id: 'stick', n: 1 }, { id: 'stick', n: 1 }, { id: 'stick', n: 1 }],
           [{ id: 'stone_shard', n: 1 }, { id: 'stone_shard', n: 1 }, { id: 'stone_shard', n: 1 }]] },
  { id: 'torch', station: null, cost: { stick: 1, coal: 1 }, out: { 'b:38': 4 }, label: 'Torch',
    // coal on a stick
    grid: [[{ id: 'coal', n: 1 }], [{ id: 'stick', n: 1 }]] },

  // bench — structures & tier progression
  { id: 'wood_wall', station: 'bench', cost: { 'b:12': 2 }, out: { 'b:39': 4 }, label: 'Timber walls',
    // a standing pair
    grid: [[{ id: 'b:12', n: 1 }], [{ id: 'b:12', n: 1 }]] },
  { id: 'door', station: 'bench', cost: { 'b:12': 6 }, out: { 'b:19': 1 }, label: 'Door',
    // 2 wide x 3 tall — the door shape itself
    grid: [[{ id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }],
           [{ id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }],
           [{ id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }]] },
  { id: 'furnace', station: 'bench', cost: { stone_shard: 8 }, out: { 'b:18': 1 }, label: 'Furnace',
    // eight stones ringing an empty firebox
    grid: [[{ id: 'stone_shard', n: 1 }, { id: 'stone_shard', n: 1 }, { id: 'stone_shard', n: 1 }],
           [{ id: 'stone_shard', n: 1 }, null, { id: 'stone_shard', n: 1 }],
           [{ id: 'stone_shard', n: 1 }, { id: 'stone_shard', n: 1 }, { id: 'stone_shard', n: 1 }]] },
  { id: 'bed', station: 'bench', cost: { 'b:12': 3, fiber: 4 }, out: { 'b:21': 1 }, label: 'Bed',
    // bedding over a plank frame; the doubled fiber is the pillow
    grid: [[{ id: 'fiber', n: 2 }, { id: 'fiber', n: 1 }, { id: 'fiber', n: 1 }],
           [{ id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }]] },
  { id: 'stone_brick', station: 'bench', cost: { stone_shard: 4 }, out: { 'b:13': 4 }, label: 'Reinforced walls',
    // 2x2 of stone
    grid: [[{ id: 'stone_shard', n: 1 }, { id: 'stone_shard', n: 1 }],
           [{ id: 'stone_shard', n: 1 }, { id: 'stone_shard', n: 1 }]] },
  { id: 'glass', station: 'bench', cost: { 'b:5': 2 }, out: { 'b:15': 2 }, label: 'Windows (from sand)',
    // two sand melted side by side into a pane
    grid: [[{ id: 'b:5', n: 1 }, { id: 'b:5', n: 1 }]] },

  // iron tier (needs iron ingots, at bench)
  { id: 'iron_pick', station: 'bench', cost: { iron_ingot: 3, stick: 2 }, out: { iron_pick: 1 }, tierUnlock: 'iron',
    // head across the top, handle down the middle
    grid: [[{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }],
           [null, { id: 'stick', n: 1 }, null],
           [null, { id: 'stick', n: 1 }, null]] },
  { id: 'iron_axe', station: 'bench', cost: { iron_ingot: 3, stick: 2 }, out: { iron_axe: 1 }, tierUnlock: 'iron',
    // same cost as the pick — the L-shaped head is what tells them apart
    grid: [[{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }],
           [{ id: 'iron_ingot', n: 1 }, { id: 'stick', n: 1 }],
           [null, { id: 'stick', n: 1 }]] },
  { id: 'iron_blade', station: 'bench', cost: { iron_ingot: 4, stick: 1 }, out: { iron_blade: 1 }, tierUnlock: 'iron', spec: 'Combat specialization',
    // a diagonal edge with the grip at its base
    grid: [[null, null, { id: 'iron_ingot', n: 1 }],
           [null, { id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }],
           [{ id: 'stick', n: 1 }, { id: 'iron_ingot', n: 1 }, null]] },
  { id: 'iron_block', station: 'bench', cost: { iron_ingot: 4 }, out: { 'b:14': 1 }, label: 'Iron plating', tierUnlock: 'iron', spec: 'Defense specialization',
    // 2x2 of ingots
    grid: [[{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }],
           [{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }]] },
  { id: 'ampoule', station: 'bench', cost: { iron_ingot: 1, fiber: 3 }, out: { iron_ampoule: 1 }, label: 'Biotic ampoule', tierUnlock: 'iron',
    // metal cap packed round with fiber
    grid: [[{ id: 'fiber', n: 1 }, { id: 'iron_ingot', n: 1 }, { id: 'fiber', n: 1 }],
           [null, { id: 'fiber', n: 1 }, null]] },

  // power tier (needs iron + at bench; conceptually steel-lite for the slice)
  { id: 'generator', station: 'bench', cost: { iron_ingot: 5, 'b:13': 2 }, out: { 'b:22': 1 }, label: 'Fuel generator', tierUnlock: 'iron', spec: 'Mechanical productivity',
    // an iron housing standing on two reinforced feet
    grid: [[{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }],
           [{ id: 'iron_ingot', n: 1 }, null, { id: 'iron_ingot', n: 1 }],
           [{ id: 'b:13', n: 1 }, null, { id: 'b:13', n: 1 }]] },
  { id: 'wire', station: 'bench', cost: { iron_ingot: 1 }, out: { 'b:23': 8 }, label: 'Power cable', tierUnlock: 'iron',
    grid: [[{ id: 'iron_ingot', n: 1 }]] },
  { id: 'lamp', station: 'bench', cost: { iron_ingot: 1, coal: 1 }, out: { 'b:24': 2 }, label: 'Powered lamp', tierUnlock: 'iron',
    // iron hood above the burning element
    grid: [[{ id: 'iron_ingot', n: 1 }], [{ id: 'coal', n: 1 }]] },
  { id: 'drill', station: 'bench', cost: { iron_ingot: 6, 'b:23': 2 }, out: { 'b:25': 1 }, label: 'Mining drill', tierUnlock: 'iron',
    // heavy housing up top, cabling at the sides, the bit hanging DOWN
    grid: [[{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }],
           [{ id: 'b:23', n: 1 }, { id: 'iron_ingot', n: 1 }, { id: 'b:23', n: 1 }],
           [null, { id: 'iron_ingot', n: 2 }, null]] },
  { id: 'turret', station: 'bench', cost: { iron_ingot: 6, 'b:23': 2 }, out: { 'b:26': 1 }, label: 'Warm-body turret', tierUnlock: 'iron', spec: 'Powered defense',
    // the drill flipped: base on the ground, barrel pointing UP
    grid: [[null, { id: 'iron_ingot', n: 2 }, null],
           [{ id: 'b:23', n: 1 }, { id: 'iron_ingot', n: 1 }, { id: 'b:23', n: 1 }],
           [{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }]] },
  { id: 'turret_ammo', station: 'bench', cost: { stone_shard: 4 }, out: { turret_ammo: 8 }, label: 'Turret slugs', tierUnlock: 'iron',
    // two slugs standing apart — not the brick's 2x2
    grid: [[{ id: 'stone_shard', n: 1 }, null, { id: 'stone_shard', n: 1 }],
           [{ id: 'stone_shard', n: 1 }, null, { id: 'stone_shard', n: 1 }]] },
  { id: 'beacon', station: 'bench', cost: { iron_ingot: 8, 'b:23': 4 }, out: { 'b:27': 1 }, label: 'Field recovery beacon', tierUnlock: 'iron',
    // iron ring around a bundled cable core
    grid: [[{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }],
           [{ id: 'iron_ingot', n: 1 }, { id: 'b:23', n: 4 }, { id: 'iron_ingot', n: 1 }],
           [{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }]] },

  // primitive extras
  { id: 'trap', station: null, cost: { stick: 3, stone_shard: 4 }, out: { 'b:49': 2 }, label: 'Spike traps',
    // spikes rising from a stick frame
    grid: [[{ id: 'stone_shard', n: 1 }, null, { id: 'stone_shard', n: 1 }],
           [{ id: 'stone_shard', n: 1 }, null, { id: 'stone_shard', n: 1 }],
           [{ id: 'stick', n: 1 }, { id: 'stick', n: 1 }, { id: 'stick', n: 1 }]] },
  { id: 'chest', station: 'bench', cost: { 'b:12': 6, fiber: 2 }, out: { 'b:48': 1 }, label: 'Sealed crate', desc: 'Sealed storage hides the scent of what is inside.',
    // hollow plank box, fiber sealing the lid and the base
    grid: [[{ id: 'b:12', n: 1 }, { id: 'fiber', n: 1 }, { id: 'b:12', n: 1 }],
           [{ id: 'b:12', n: 1 }, null, { id: 'b:12', n: 1 }],
           [{ id: 'b:12', n: 1 }, { id: 'fiber', n: 1 }, { id: 'b:12', n: 1 }]] },
  { id: 'iron_armor', station: 'bench', cost: { iron_ingot: 5, hide: 2 }, out: { iron_armor: 1 }, tierUnlock: 'iron', spec: 'Combat specialization',
    // shoulders, chest plate, and two hide straps
    grid: [[{ id: 'iron_ingot', n: 1 }, null, { id: 'iron_ingot', n: 1 }],
           [{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }],
           [{ id: 'hide', n: 1 }, null, { id: 'hide', n: 1 }]] },
  { id: 'maint_bench', station: 'bench', cost: { iron_ingot: 4, 'b:12': 6 }, out: { 'b:47': 1 }, label: 'Maintenance bench', tierUnlock: 'iron', spec: 'Defense specialization',
    // iron worktop with a heavy vise, plank body beneath
    grid: [[{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 2 }, { id: 'iron_ingot', n: 1 }],
           [{ id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }],
           [{ id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }, { id: 'b:12', n: 1 }]] },
  { id: 'radio', station: 'bench', cost: { iron_ingot: 2, 'b:23': 1 }, out: { 'b:64': 1 }, label: 'Shortwave radio', tierUnlock: 'iron',
    // a set with an aerial off one corner
    grid: [[{ id: 'b:23', n: 1 }, null],
           [{ id: 'iron_ingot', n: 1 }, { id: 'iron_ingot', n: 1 }]] },

  // steel tier — steel itself smelts only at the restored industrial kiln (§11.3)
  { id: 'steel_pick', station: 'bench', cost: { steel_ingot: 3, stick: 2 }, out: { steel_pick: 1 }, tierUnlock: 'steel',
    // same silhouette as the iron pick, better metal
    grid: [[{ id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }],
           [null, { id: 'stick', n: 1 }, null],
           [null, { id: 'stick', n: 1 }, null]] },
  { id: 'steel_blade', station: 'bench', cost: { steel_ingot: 4, stick: 1 }, out: { steel_blade: 1 }, tierUnlock: 'steel', spec: 'Combat specialization',
    // the iron blade's diagonal, in steel
    grid: [[null, null, { id: 'steel_ingot', n: 1 }],
           [null, { id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }],
           [{ id: 'stick', n: 1 }, { id: 'steel_ingot', n: 1 }, null]] },
  { id: 'steel_block', station: 'bench', cost: { steel_ingot: 3 }, out: { 'b:40': 2 }, label: 'Steel plating', tierUnlock: 'steel',
    // three ingots rolled flat into a sheet
    grid: [[{ id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }]] },
  { id: 'battery', station: 'bench', cost: { steel_ingot: 4, iron_ingot: 4, 'b:23': 2 }, out: { 'b:41': 1 }, label: 'Battery bank', tierUnlock: 'steel', spec: 'Automation',
    // terminals on top, steel casing walls, stacked iron cells between
    grid: [[{ id: 'b:23', n: 1 }, null, { id: 'b:23', n: 1 }],
           [{ id: 'steel_ingot', n: 1 }, { id: 'iron_ingot', n: 2 }, { id: 'steel_ingot', n: 1 }],
           [{ id: 'steel_ingot', n: 1 }, { id: 'iron_ingot', n: 2 }, { id: 'steel_ingot', n: 1 }]] },
  { id: 'switch', station: 'bench', cost: { iron_ingot: 1, 'b:23': 1 }, out: { 'b:42': 2 }, label: 'Circuit switch', tierUnlock: 'steel', spec: 'Automation',
    // a lever sitting on the line
    grid: [[{ id: 'iron_ingot', n: 1 }], [{ id: 'b:23', n: 1 }]] },
  { id: 'scrubber', station: 'bench', cost: { steel_ingot: 4, filter_unit: 1 }, out: { 'b:43': 1 }, label: 'Air scrubber', tierUnlock: 'steel', spec: 'Filtration', needsUnlock: 'filtration',
    // steel intake with the cartridge slotted into the top
    grid: [[{ id: 'steel_ingot', n: 1 }, { id: 'filter_unit', n: 1 }, { id: 'steel_ingot', n: 1 }],
           [{ id: 'steel_ingot', n: 1 }, null, { id: 'steel_ingot', n: 1 }]] },
  { id: 'uv', station: 'bench', cost: { steel_ingot: 3, 'b:15': 2 }, out: { 'b:44': 1 }, label: 'UV sterilizer', tierUnlock: 'steel', spec: 'Filtration', needsUnlock: 'filtration',
    // a steel fixture with two glass tubes hanging under it
    grid: [[{ id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }],
           [{ id: 'b:15', n: 1 }, null, { id: 'b:15', n: 1 }]] },
  { id: 'vibturret', station: 'bench', cost: { steel_ingot: 5, 'b:23': 2 }, out: { 'b:45': 1 }, label: 'Vibration turret', tierUnlock: 'steel', spec: 'Powered defense',
    // turret silhouette in steel: barrel up, wide base
    grid: [[null, { id: 'steel_ingot', n: 1 }, null],
           [{ id: 'b:23', n: 1 }, { id: 'steel_ingot', n: 1 }, { id: 'b:23', n: 1 }],
           [{ id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }]] },
  { id: 'sensor', station: 'bench', cost: { steel_ingot: 2, 'b:23': 1 }, out: { 'b:46': 2 }, label: 'Field sensor', tierUnlock: 'steel', spec: 'Sensing',
    // a listening head on a single lead
    grid: [[{ id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }],
           [{ id: 'b:23', n: 1 }, null]] },
  { id: 'cradle', station: 'bench', cost: { steel_ingot: 8, continuity_core: 1, 'b:23': 4 }, out: { 'b:28': 1 }, label: 'Lazarus cradle', tierUnlock: 'steel',
    // heavy steel corner pillars, cable through every edge, core at the heart
    grid: [[{ id: 'steel_ingot', n: 2 }, { id: 'b:23', n: 1 }, { id: 'steel_ingot', n: 2 }],
           [{ id: 'b:23', n: 1 }, { id: 'continuity_core', n: 1 }, { id: 'b:23', n: 1 }],
           [{ id: 'steel_ingot', n: 2 }, { id: 'b:23', n: 1 }, { id: 'steel_ingot', n: 2 }]] },
  { id: 'sterilizer_charge', station: 'bench', cost: { steel_ingot: 1, iron_ampoule: 1, coal: 2 }, out: { sterilizer_charge: 2 }, label: 'Field sterilizers', tierUnlock: 'steel', needsUnlock: 'filtration',
    // ampoule flanked by its charge, steel nozzle below
    grid: [[{ id: 'coal', n: 1 }, { id: 'iron_ampoule', n: 1 }, { id: 'coal', n: 1 }],
           [null, { id: 'steel_ingot', n: 1 }, null]] },
  { id: 'relay_module', station: 'bench', cost: { steel_ingot: 2, 'b:23': 2 }, out: { relay_module: 1 }, label: 'Control relay', tierUnlock: 'steel',
    // steel body over a pair of leads
    grid: [[{ id: 'steel_ingot', n: 1 }, { id: 'steel_ingot', n: 1 }],
           [{ id: 'b:23', n: 1 }, { id: 'b:23', n: 1 }]] },
  { id: 'filter_unit', station: 'bench', cost: { steel_ingot: 1, fiber: 6 }, out: { filter_unit: 1 }, label: 'Filtration cartridge', tierUnlock: 'steel', needsUnlock: 'filtration',
    // steel cap over a block of packed fiber
    grid: [[null, { id: 'steel_ingot', n: 1 }, null],
           [{ id: 'fiber', n: 1 }, { id: 'fiber', n: 1 }, { id: 'fiber', n: 1 }],
           [{ id: 'fiber', n: 1 }, { id: 'fiber', n: 1 }, { id: 'fiber', n: 1 }]] },

  // furnace smelting
  { id: 'smelt_iron', station: 'furnace', cost: { iron_ore_raw: 1 }, out: { iron_ingot: 1 }, smelt: true },
  { id: 'cook_meat', station: 'furnace', cost: { raw_meat: 1 }, out: { cooked_meat: 1 }, smelt: true },
  // kiln smelting (restored industrial infrastructure, §10.3/§11.3)
  { id: 'smelt_steel', station: 'kiln', cost: { iron_ingot: 1, coal: 2 }, out: { steel_ingot: 1 }, smelt: true },
];

// --- Combat feel (§12) ----------------------------------------------------
// Knockback: melee hits shove the target. Weapon `kb` overrides handKb;
// infected shove the player on a landed hit. Bosses are immune.
export const COMBAT = {
  handKb: 2.5,       // bare-hand / non-weapon knockback power
  kbDecay: 6,        // per-second exponential decay of an infected's shove
  playerKb: 6.5,     // horizontal impulse on the player when an infected connects
  playerKbUp: 3.0,   // small upward pop (grounded hits only)
  playerKbAccelMul: 0.3, // input authority while being shoved (kbT window)
  playerKbT: 0.25,
  trapKb: 2,          // spike traps: gentle stagger-wiggle, not an ejection
  sterilantKb: 8,     // valve two: exposed tissue gets flung off the vent
};

// Which infected may damage which blocks (wishlist rule): ONLY machine-eater
// strains break blocks, and ONLY machine blocks (powered machinery + cables).
// Everything else — walls, doors, terrain — is safe from infected. Burrowers
// still push through loose soil, but that routes through infectedDigSoft as
// movement, not block damage.
export function canInfectedBreakBlock(strain, blockDef) {
  return !!(strain?.targetsMachines && blockDef && (blockDef.machine || blockDef.wire));
}

// --- Machine behavior ----------------------------------------------------
export const MACHINES = {
  generator: {
    powerOutput: 12, fuelCapacity: 40, fuelPerSec: 0.08,
    // exhaust reads on the CO2 channel — combustion breathes out, loudly
    emits: { heat: 0.75, vibration: 0.45, electrical: 0.7, light: 0.1, co2: 0.5 },
    radius: 42,
  },
  lamp:  { powerDraw: 1, light: 14, emits: { light: 0.5, electrical: 0.15 }, radius: 26, sanityAura: 6 },
  drill: { powerDraw: 4, orePerSec: 0.5, emits: { heat: 0.2, vibration: 0.9, electrical: 0.4 }, radius: 36 },
  turret: {
    powerDraw: 3, range: 14, fireRate: 0.55, dmg: 6, heatPerShot: 0.09, heatCool: 0.14, heatMax: 1, kb: 4,
    emits: { heat: 0.25, electrical: 0.5, vibration: 0.15 }, radius: 24,
  },
  beacon: { powerDraw: 2, emits: { electrical: 0.3 }, radius: 18 },
  cradle: { powerDraw: 5, emits: { electrical: 0.6, heat: 0.2 }, radius: 22 },

  // steel tier
  battery: { capacity: 60, chargeRate: 4, dischargeRate: 8, emits: { metal: 0.4, electrical: 0.2 }, radius: 20 },
  switch:  { powerDraw: 0 },
  scrubber:{ powerDraw: 2, radius: 22, cleanRadius: 9, emits: { electrical: 0.2 } },
  uv:      { powerDraw: 2, range: 6, dps: 4, cystPerSec: 0.4, kb: 1.5, emits: { light: 0.3, electrical: 0.2 }, radius: 18 },
  vibturret:{ powerDraw: 3, range: 10, fireRate: 0.8, dmg: 4, kb: 3.5, emits: { vibration: 0.6, electrical: 0.4 }, radius: 26 },
  sensor:  { powerDraw: 1, confidenceBonus: 0.15, emits: { electrical: 0.1 }, radius: 12 },
  maint:   { powerDraw: 0, repairPerSec: 6, radius: 8, plankPerRepair: 40 },
  transit: { powerDraw: 8, relaysNeeded: 2, filtersNeeded: 1, emits: { electrical: 0.5, metal: 0.3 }, radius: 30 },
};

// Overload protection (§10.1 fuses): sustained demand above capacity blows the
// network's fuse — everything stops until it is replaced at a generator.
export const FUSE = { overloadRatio: 1.25, overloadSeconds: 8, repairCost: { iron_ingot: 1 } };

// --- Signature channels & propagation (§5) ------------------------------
export const SIGNATURE = {
  // all 8 spec channels (§5.2): metal = exposed iron/steel/batteries/scrap
  channels: ['heat', 'light', 'vibration', 'co2', 'blood', 'electrical', 'spores', 'metal'],
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
    senses: { heat: 0.7, co2: 0.1, blood: 0.2, vibration: 0.8, light: 0.2, electrical: 1.0, spores: 0, metal: 0.9 },
    thresholds: { investigate: 0.1, pursue: 0.25, frenzy: 0.85 }, blockDmg: 6, climbs: false, targetsMachines: true,
    desc: 'Follows heat, electrical fields, metal chemistry, and machine vibration. Prioritizes running machinery.',
  },
  // full-game roles (§12.2)
  brute: {
    name: 'Brute', hp: 64, speed: 1.3, dmg: 13, color: 0x7a6a4a, scale: 1.5, minDay: 4,
    senses: { heat: 0.5, co2: 0.3, blood: 0.3, vibration: 0.7, light: 0.1, electrical: 0.2, spores: 0, metal: 0.4 },
    thresholds: { investigate: 0.1, pursue: 0.25 }, blockDmg: 26, climbs: false,
    desc: 'Slow, mineralized, and indifferent to you until the wall is gone. Damages foundations and reinforced blocks.',
  },
  climber: {
    name: 'Climber', hp: 10, speed: 3.0, dmg: 5, color: 0x6a5a7a, scale: 0.9, minDay: 3,
    senses: { heat: 0.4, co2: 0.6, blood: 0.4, vibration: 0.2, light: 0.9, electrical: 0.1, spores: 0 },
    thresholds: { investigate: 0.1, pursue: 0.22, frenzy: 0.9 }, blockDmg: 2, climbs: true,
    desc: 'Hardened fingers and altered joints. Reads lit windows and rooflines as invitations; walls are a route, not a barrier.',
  },
  burrower: {
    name: 'Burrower', hp: 16, speed: 2.2, dmg: 6, color: 0x6a5434, scale: 1.05, minDay: 4,
    senses: { heat: 0.2, co2: 0.2, blood: 0.1, vibration: 1.0, light: 0, electrical: 0.3, spores: 0 },
    thresholds: { investigate: 0.08, pursue: 0.2 }, blockDmg: 5, climbs: false, burrows: true,
    desc: 'Blind even by their standards. Follows sustained vibration through soil and gravel, leaving a line of disturbed earth.',
  },
  cyst_carrier: {
    name: 'Cyst carrier', hp: 14, speed: 1.7, dmg: 3, color: 0x8a8a4a, scale: 1.05, minDay: 5, cold: true,
    senses: { heat: 0.4, co2: 0.9, blood: 0.3, vibration: 0.1, light: 0.2, electrical: 0, spores: 0 },
    thresholds: { investigate: 0.1, pursue: 0.24 }, blockDmg: 2, climbs: false, carrier: true,
    desc: 'A body given over to spore packaging. Cold enough that warm-body turrets cannot see it. Seeds cyst film as it walks — and when it bursts.',
  },
  spitter: {
    name: 'Spitter', hp: 12, speed: 2.0, dmg: 4, color: 0x7a8a4a, scale: 1.0, minDay: 5,
    senses: { heat: 0.6, co2: 0.3, blood: 0.4, vibration: 0.2, light: 0.7, electrical: 0.4, spores: 0 },
    thresholds: { investigate: 0.1, pursue: 0.22 }, blockDmg: 2, climbs: false,
    ranged: { range: 11, cooldown: 2.4, dmg: 7, sanityHit: 2 },
    desc: 'Expels contaminated fluid in a slow arc. Punishes exposed firing platforms and anything silhouetted against light.',
  },
  elite: {
    name: 'Elite strain', hp: 90, speed: 3.4, dmg: 11, color: 0x8a4a5a, scale: 1.3, minDay: 8,
    senses: { heat: 0.8, co2: 0.6, blood: 0.8, vibration: 0.6, light: 0.5, electrical: 0.7, spores: 0, metal: 0.5 },
    thresholds: { investigate: 0.08, pursue: 0.18, frenzy: 0.7 }, blockDmg: 12, climbs: true, elite: true,
    desc: 'Two strains fused into one competent body. Appears only where the ecology is loud enough to feed it.',
  },
  // ecological encounter hosts (§11.3) — location problems, not monsters with keys
  colony_host: {
    name: 'Colony host', hp: 220, speed: 1.1, dmg: 14, color: 0x8a9a5a, scale: 1.8,
    senses: { heat: 0.6, co2: 0.4, blood: 0.6, vibration: 0.5, light: 0.2, electrical: 0.4, spores: 0 },
    thresholds: { investigate: 0.08, pursue: 0.18 }, blockDmg: 10, climbs: false, boss: true,
    desc: 'A tissue-fused colony host mineralized into the cave wall. Removing it exposes the iron seam.',
  },
  kiln_host: {
    name: 'Kiln host', hp: 300, speed: 1.2, dmg: 16, color: 0x9a6a4a, scale: 1.9,
    senses: { heat: 0.8, co2: 0.4, blood: 0.5, vibration: 0.5, light: 0.3, electrical: 0.4, spores: 0, metal: 0.6 },
    thresholds: { investigate: 0.08, pursue: 0.18 }, blockDmg: 14, climbs: false, boss: true,
    desc: 'Tissue fused through an industrial kiln, cooking its own colony air. Purging it restores steel production at scale.',
  },
  pump_host: {
    name: 'Pump host', hp: 180, speed: 1.4, dmg: 11, color: 0x5a8a8a, scale: 1.6,
    senses: { heat: 0.5, co2: 0.6, blood: 0.6, vibration: 0.6, light: 0.2, electrical: 0.5, spores: 0 },
    thresholds: { investigate: 0.08, pursue: 0.18 }, blockDmg: 8, climbs: false, boss: true,
    desc: 'A colony grown through a flooded pump gallery. Purging it drains the annex and exposes the filtration stores.',
  },
};

// --- Threat director / night assault (§6) -------------------------------
export const THREAT = {
  // Base assault composition scales with day count.
  duskWarnFrac: 0.68,        // when the forecast becomes available
  incursionCooldown: 60,     // seconds between possible conditional incursions
  incursionSigThreshold: 1.6,// combined outdoor signature to trigger an incursion
  scoutCooldown: 90,         // daytime scouts investigate a specific signature (§6.4)
  nestIncursionRange: 26,    // an unresolved nest this close can seed an incursion
  // A major assault's composition is a "question" (§6.5) chosen by dominant
  // signature, gated by minDay and optional signature requirements (§22.2).
  assaults: [
    { id: 'warm_tracks', tag: 'Heat-seekers', dominant: 'heat', minDay: 1,
      forecastTags: ['warm_tracks', 'condensation', 'heat_seekers'],
      base: { drifter: 5, runner: 2, machine_eater: 1 }, perDay: { drifter: 1.4, machine_eater: 0.5 },
      forecast: 'Warm tracks in the frost — bodies drawn to your heat.' },
    { id: 'live_wire', tag: 'Machine eaters', dominant: 'electrical', minDay: 1,
      forecastTags: ['field_static', 'chewed_cable', 'machine_eaters'],
      base: { drifter: 3, runner: 2, machine_eater: 3 }, perDay: { machine_eater: 1.1, drifter: 0.8 },
      forecast: 'Field-sensitive strains converging on live circuits.' },
    { id: 'blood_run', tag: 'Runners', dominant: 'blood', minDay: 1,
      forecastTags: ['blood_scent', 'fast_movers'],
      base: { drifter: 3, runner: 6 }, perDay: { runner: 1.6, drifter: 0.6 },
      forecast: 'Scent of blood on the wind — a fast, fragile swarm.' },
    { id: 'wall_walkers', tag: 'Climbers', dominant: 'light', minDay: 3,
      forecastTags: ['scratched_bark', 'roofline_shadows', 'climbers'],
      base: { climber: 4, runner: 2, drifter: 2 }, perDay: { climber: 1.2, drifter: 0.5 },
      forecast: 'Shapes on the treeline moving hand over hand. Check your roof.' },
    { id: 'ground_swell', tag: 'Burrowers', dominant: 'vibration', minDay: 4,
      requirements: { vibration: 0.35 },
      forecastTags: ['disturbed_soil', 'subsonic', 'burrowers'],
      base: { burrower: 3, drifter: 3, machine_eater: 1 }, perDay: { burrower: 0.9, drifter: 0.8 },
      forecast: 'Lines of disturbed soil, all pointing here. They are under the grass.' },
    { id: 'spore_bloom', tag: 'Cyst carriers', dominant: 'co2', minDay: 5,
      forecastTags: ['spore_haze', 'cold_bodies', 'carriers'],
      base: { cyst_carrier: 3, drifter: 4, climber: 1 }, perDay: { cyst_carrier: 0.8, drifter: 0.8 },
      forecast: 'A haze of spores rides the evening air. Cold bodies walk beneath it — your turrets will not see them.' },
    { id: 'siege', tag: 'Brutes', dominant: 'metal', minDay: 5,
      forecastTags: ['deep_footfalls', 'brutes', 'suppressors'],
      base: { brute: 2, drifter: 4, spitter: 2 }, perDay: { brute: 0.6, spitter: 0.6, drifter: 0.8 },
      forecast: 'Heavy footfalls. Mineralized frames drawn to worked metal — they will test your foundations.' },
    { id: 'baseline', tag: 'Mixed drift', dominant: null, minDay: 1,
      forecastTags: ['scattered_drift'],
      base: { drifter: 5, runner: 2 }, perDay: { drifter: 1.2, runner: 0.5 },
      forecast: 'Scattered drift toward the strongest signals.' },
  ],
  // §6.4 reservoir migration: rare, high-tier, forecast a day ahead.
  migration: {
    minDay: 8, chance: 0.35,
    comp: { drifter: 6, runner: 3, brute: 2, elite: 1, machine_eater: 2 },
    forecast: 'RESERVOIR MIGRATION — a mass movement from a contaminated site. This is not an ordinary night.',
  },
  maxTier: 3,
  // §19: after the reservoir is purged, regional pressure falls and enemy
  // stats stay capped at the designed maximum — reclamation, not escalation.
  postPurgePressure: 0.5,
};

// --- Sanity (§7) ---------------------------------------------------------
// Per-minute rates retuned for 30-minute days (a 15-minute night at the old
// 4.5/min would strip 67 sanity — the same per-night pressure now spreads
// across the longer half).
export const SANITY = {
  MAX: 100,
  dayGain: 1.2,          // per minute in daylight, sheltered
  nightLoss: 1.6,        // per minute exposed at night
  darkLoss: 0.8,         // in darkness
  sporeLoss: 6.0,        // near cysts/nests/reservoir (location hazard — unchanged)
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
  perKill: {
    drifter: 5, runner: 6, machine_eater: 10, brute: 14, climber: 7,
    burrower: 9, cyst_carrier: 8, spitter: 9, elite: 40,
    colony_host: 400, kiln_host: 500, pump_host: 350,
  },
  perAssault: 150,
  cleanDefense: 120,   // assault repelled with zero breached blocks (§14.2)
  // Valley Recovery dimensions (§14.1). archive/survey flags are per-instance.
  valley: {
    archive: 5,          // each of 5
    miniboss: 8,         // colony host
    kilnRestored: 8,     // kiln host purged — steel at scale
    annexDrained: 6,     // pump host purged — filtration recovered
    firstAssault: 5,
    ironTier: 4,
    steelTier: 5,
    labFound: 3,
    survey: 2,           // each surveyed region (survey:<key> flags)
    powerUptime: 4,      // 5 cumulative minutes of stable generator power
    transitRestored: 10,
    deepPurged: 20,
    reclaim: 4,          // each secondary site sterilized (reclaim:<id> flags)
    nightScale: 1,       // × highest defended night, capped at 10
  },
};

// --- Deep Site purge sequence (§18) --------------------------------------
export const DEEP = {
  tissueClusters: 5,          // reservoir growth clusters = the viability meter
  sterilantMachineDisableSec: 45, // valve 2 knocks running machines offline nearby
  sterilantRadius: 30,
  defendersPerCluster: 2,     // local tissue response when a cluster dies
};

// --- Accessibility defaults (§7.5) — persisted in localStorage ------------
export const ACCESS_DEFAULTS = {
  reduceDistortion: false,   // caps the sanity overlay intensity
  noFlashing: false,         // disables jitter/flash effects
  hallucinationAudio: true,  // separate toggle for phantom audio
  shadows: true,             // sun shadow maps (off = faster on old machines)
  fancySky: true,            // gradient sky, sun/moon discs, stars
};

export const PLAYER = {
  maxHealth: 100, maxHunger: 100,
  reach: 5.0,
  height: 1.7, radius: 0.35, eye: 1.55,
  walk: 4.4, sprint: 7.0, jump: 8.4, gravity: 26,
  hungerPerSec: 0.055, starveDmg: 1.2, // ~1 full bar per 30-minute day
  regenAtHunger: 40, regenRate: 1.5,
};
