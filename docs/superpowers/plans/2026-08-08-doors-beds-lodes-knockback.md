# Tall Doors, Long Beds, Infinite Ore Lodes, Universal Knockback — Implementation Plan

> **For agentic workers:** Execute your assigned task section fully: implement + tests, run `npm test` until green, do NOT commit. Match existing code style (comment density, naming). The repo is /Users/scottfleischman/GitHub/scott-fleischman/infections-wake.

**Goal:** Doors occupy 2 vertical cells, beds occupy 2 horizontal cells, ore hills gain never-depleting "lode" blocks, and every damage source applies knockback to infected.

**Architecture:** The world remains a flat per-cell array of block ids (no metadata). Multi-cell objects are id-pairs: doors get a top-half id per state; beds encode facing in the head id + one shared foot id. A new pure module `src/multiblock.js` holds pair math so Node tests can cover it (main.js is browser-only). Lodes are new block ids with a `lode: '<itemId>'` def field meaning "yields the item, block persists." Knockback reuses the existing `Infected.applyKnockback(fromPos, power)` (bosses/hallucinations already immune inside it).

**Tech stack:** Plain JS + Three.js + Vite; node:test suite (`npm test`, currently 174 passing).

**Block id allocation** (current max is `DOC_SHELF: 65` in src/config.js — VERIFY no higher id exists before using these):

| Id | Name | Meaning |
|----|------|---------|
| 66 | `DOOR_TOP` | closed door, upper cell (solid) |
| 67 | `DOOR_TOP_OPEN` | open door, upper cell (passable) |
| 68 | `BED_FOOT` | bed second cell (any direction) |
| 69 | `BED_N` | bed head, foot at −z |
| 70 | `BED_E` | bed head, foot at +x |
| 71 | `BED_W` | bed head, foot at −x |
| 72 | `IRON_LODE` | infinite iron ore block |
| 73 | `COAL_LODE` | infinite coal ore block |

Existing `BED: 21` becomes "bed head, foot at +z" (its model already has the headboard at −z). Existing `DOOR: 19` / `DOOR_OPEN: 20` stay the lower/base cell.

---

## Task A — Doors are 2 blocks tall

**Files:** Create `src/multiblock.js`, `test/multiblock.test.js`. Modify `src/config.js`, `src/main.js`, `src/models.js`, `src/props.js`, `src/scenarios.js`, `src/gallery.js`, `test/scenarios.test.js`.

### A1. config.js — new defs (next to DOOR at config.js:124-125)

```js
[B.DOOR_TOP]:      { name: 'Door', solid: true,  opaque: false, senseOpaque: true, model: 'none', col: 0x7a5a30, hardness: 1.2, drop: null, interact: 'door', armor: 1 },
[B.DOOR_TOP_OPEN]: { name: 'Door', solid: false, opaque: false, model: 'none', col: 0x7a5a30, hardness: 1.2, drop: null, interact: 'door' },
```

`model: 'none'` = mesher skips it (any truthy `model` does, world.js:1405) AND props renders nothing: add an early return at the top of `Props.add()` (props.js:44): `if (BLOCKS[id]?.model === 'none') return;`. Match the lower ids: `DOOR_TOP` mirrors `DOOR` (solid + senseOpaque), `DOOR_TOP_OPEN` mirrors `DOOR_OPEN` (passable, NO senseOpaque — open doors leak senses today; keep that). `interact: 'door'` on both so clicking the top half toggles and so `player.raycast` targets the open-top (player.js:191 targets any def with truthy `interact`).

### A2. src/multiblock.js — pure pair helpers (new module, importable in Node)

```js
// Multi-cell block pair math. Pure functions over a world's get() — main.js
// owns the side effects (props, audio, drops); tests drive these directly.
import { B, BLOCKS } from './config.js';

const DOOR_IDS = () => new Set([B.DOOR, B.DOOR_OPEN, B.DOOR_TOP, B.DOOR_TOP_OPEN]);

// Any door id at (x,y,z) -> { base:{x,y,z,id}, top:{x,y,z,id} } | null
export function doorParts(world, x, y, z) {
  const id = world.get(x, y, z);
  if (id === B.DOOR_TOP || id === B.DOOR_TOP_OPEN) {
    const baseId = world.get(x, y - 1, z);
    return { base: { x, y: y - 1, z, id: baseId }, top: { x, y, z, id } };
  }
  if (id === B.DOOR || id === B.DOOR_OPEN) {
    const topId = world.get(x, y + 1, z);
    return { base: { x, y, z, id }, top: { x, y: y + 1, z, id: topId } };
  }
  return null;
}

// Head id -> foot direction. BED faces +z (headboard model sits at -z).
export const BED_DIR = { [B.BED]: [0, 1], [B.BED_N]: [0, -1], [B.BED_E]: [1, 0], [B.BED_W]: [-1, 0] };

export function bedHeadFor(dx, dz) {
  if (dx === 1) return B.BED_E;
  if (dx === -1) return B.BED_W;
  if (dz === -1) return B.BED_N;
  return B.BED;
}

// Snap a yaw to the cardinal the player faces: forward = (-sin yaw, -cos yaw).
export function yawToCardinal(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx) || 1, 0] : [0, Math.sign(fz) || 1];
}

// Any bed id at (x,y,z) -> { head:{x,y,z,id}, foot:{x,y,z,id} } | null.
// A foot resolves its owner by scanning for the adjacent head whose direction
// points back at it — exact even with beds placed side by side.
export function bedParts(world, x, y, z) {
  const id = world.get(x, y, z);
  const dir = BED_DIR[id];
  if (dir) return { head: { x, y, z, id }, foot: { x: x + dir[0], y, z: z + dir[1], id: world.get(x + dir[0], y, z + dir[1]) } };
  if (id === B.BED_FOOT) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const hid = world.get(x + dx, y, z + dz);
      const hd = BED_DIR[hid];
      if (hd && hd[0] === -dx && hd[1] === -dz)
        return { head: { x: x + dx, y, z: z + dz, id: hid }, foot: { x, y, z, id } };
    }
    return { head: null, foot: { x, y, z, id } }; // orphan (shouldn't happen)
  }
  return null;
}
```

### A3. main.js — placement (onSecondary, main.js:781-794)

Insert a door special-case before the generic single-cell path:

```js
if (def.block === B.DOOR) {
  if (!this.world.inBounds(tx, ty, tz) || !this.world.inBounds(tx, ty + 1, tz)) return;
  if (this.world.get(tx, ty, tz) !== B.AIR || this.world.get(tx, ty + 1, tz) !== B.AIR) { this.toast('Needs two blocks of clearance.'); return; }
  if (this.wouldCollide(tx, ty, tz) || this.wouldCollide(tx, ty + 1, tz)) { this.toast('Blocked.'); return; }
  this.placeBlock(tx, ty, tz, B.DOOR);
  this.placeBlock(tx, ty + 1, tz, B.DOOR_TOP);
  this.inv.remove(held.id, 1);
  this.hud.updateHotbar();
  return;
}
```

(`placeBlock` already fires `unlocks.doorHung` for B.DOOR and notifies sig/props per cell; the top cell's props add() no-ops via `model:'none'`.)

### A4. main.js — toggle (interact 'door' case, main.js:959-968)

Rework to operate on the pair (import `doorParts`):

```js
case 'door': {
  const p = doorParts(this.world, hit.x, hit.y, hit.z);
  if (!p) return;
  const open = p.base.id === B.DOOR_OPEN;
  if (open && (this.wouldCollide(p.base.x, p.base.y, p.base.z) || this.wouldCollide(p.top.x, p.top.y, p.top.z))) { this.toast('Something is in the doorway.'); return; }
  this.world.set(p.base.x, p.base.y, p.base.z, open ? B.DOOR : B.DOOR_OPEN);
  // legacy 1-tall doors (old saves, blocked headroom) have no top half
  if (p.top.id === B.DOOR_TOP || p.top.id === B.DOOR_TOP_OPEN)
    this.world.set(p.top.x, p.top.y, p.top.z, open ? B.DOOR_TOP : B.DOOR_TOP_OPEN);
  this.props.onBlockChanged(p.base.x, p.base.y, p.base.z, open ? B.DOOR : B.DOOR_OPEN);
  this.audio.place();
  return;
}
```

### A5. main.js — breaking (breakBlock, main.js:872)

At the top of `breakBlock`, after `const def = BLOCKS[id]`, handle door pairs (bed pairs are Task B — write one shared branch using `doorParts`/`bedParts`): remove BOTH cells (`world.set(...,B.AIR)` + `clearBlockCell` + the top cell needs no props call but the base does — `clearBlockCell` already calls `props.onBlockChanged`), play sound, `useToolDurability(1)`, drop exactly one `{ id: 'b:' + B.DOOR, n: 1 }` via the same inv.add/overflow path the generic branch uses, then `return`. A legacy door (top cell not a door id) just removes its own cell + drops one door.

### A6. props.js + models.js — 2-tall model with legacy fallback

- `Props.add` door branch (props.js:50-53): add `opts.tall = [B.DOOR_TOP, B.DOOR_TOP_OPEN].includes(this.game.world.get(x, y + 1, z));`
- `buildDoor(opts)` (models.js:210-230): when `opts.tall`, stretch to 2 cells — posts `box(g, 0.07, 2.0, 0.16, frame, ±0.465, 1.0, 0)`, lintel at `y=1.97`, slab `0.86 × 1.94` centered `y=1.0` (hinge/slab group structure unchanged), 4 panel insets (two per column at y≈0.4/0.9/1.4 spacing — pick heights that look right), handle at `y≈0.95`. `!opts.tall` keeps today's geometry exactly (legacy doors under low headroom).
- gallery.js door entries (gallery.js:34-35): add `tall: true` to both `opts` so the archive shows the new door.

### A7. Old-save reconciliation + scenario

- main.js constructor (the edits scan at main.js:227-235): after that loop, collect upgrades then apply (don't mutate `world.edits` mid-iteration): for each edit `v === B.DOOR|DOOR_OPEN` with `world.get(x,y+1,z) === B.AIR` → `world.set(x, y+1, z, v === B.DOOR ? B.DOOR_TOP : B.DOOR_TOP_OPEN)`. (Bed variant in Task B, same loop.) Must run BEFORE `props.scanWorld()`.
- scenarios.js fortified (scenarios.js:30-31): replace the WOOD_WALL transom with the top half:

```js
placeIfAir(g, sx, surf + 1, sz - 2, B.DOOR);
placeIfAir(g, sx, surf + 2, sz - 2, B.DOOR_TOP);   // was: WOOD_WALL transom
```

- test/scenarios.test.js:62-69: additionally assert `B.DOOR_TOP` at `surf+2`.

### A8. Tests (test/multiblock.test.js, using test/helpers.js makeStubGame or a bare World)

1. `doorParts` from base and from top resolve the same pair; non-door id → null.
2. Toggle semantics at world level: set DOOR+DOOR_TOP, simulate the toggle writes, assert both ids swap; open pair is non-solid at both cells (`BLOCKS[id].solid`).
3. Pair-break: from either cell, both cells end AIR (test via the same helper main.js uses, or replicate the two writes and assert the drop id computed once).
4. Legacy: lone DOOR with solid above → doorParts returns pair with non-door top; toggle only swaps base.
5. Reconciliation rule: given edits map + world where above is AIR, upgrade list contains the top id (test the pure decision, e.g. extract `upgradeEditsPlan(world, edits)` into multiblock.js if convenient).

---

## Task B — Beds are 2 blocks long

**Files:** Same modules as Task A (extend `src/multiblock.js` + `test/multiblock.test.js`). Modify `src/config.js`, `src/main.js`, `src/models.js`, `src/props.js`, `src/gallery.js`.

### B1. config.js — defs

Keep `[B.BED]` as-is (it's now "head, foot +z"). Add (all drop `B.BED` via pair-break, so `drop: null` on the new ids is fine — the pair branch drops one `b:21`):

```js
[B.BED_N]:    { name: 'Bed', solid: true, opaque: false, model: 'bed', col: [0x9a3b34,0x6a4a3a,0x5a4634], hardness: 0.5, drop: null, interact: 'bed' },
[B.BED_E]:    { ...same as BED_N },
[B.BED_W]:    { ...same as BED_N },
[B.BED_FOOT]: { name: 'Bed', solid: true, opaque: false, model: 'none', col: [0x9a3b34,0x6a4a3a,0x5a4634], hardness: 0.5, drop: null, interact: 'bed' },
```

(`interact: 'bed'` on the foot means sleeping works from either end — interact dispatch main.js:969 is def-driven. `model:'none'` on the foot reuses the Task A props guard. Recipe unchanged: output stays `b:21` ×1.)

### B2. main.js — placement (onSecondary, alongside the door case)

```js
if (def.block === B.BED) {
  const [dx, dz] = yawToCardinal(this.player.yaw);          // foot extends away from the player
  const fx = tx + dx, fz = tz + dz;
  if (!this.world.inBounds(tx, ty, tz) || !this.world.inBounds(fx, ty, fz)) return;
  if (this.world.get(tx, ty, tz) !== B.AIR || this.world.get(fx, ty, fz) !== B.AIR) { this.toast('Needs two blocks of floor space.'); return; }
  if (this.wouldCollide(tx, ty, tz) || this.wouldCollide(fx, ty, fz)) { this.toast('Blocked.'); return; }
  this.placeBlock(tx, ty, tz, bedHeadFor(dx, dz));
  this.placeBlock(fx, ty, fz, B.BED_FOOT);
  this.inv.remove(held.id, 1);
  this.hud.updateHotbar();
  return;
}
```

### B3. main.js — breaking

Extend the Task A pair branch: `bedParts` hit → remove head+foot cells, drop one `{ id: 'b:' + B.BED, n: 1 }`. An orphan foot (no owning head) just removes itself, drop one bed.

### B4. models.js + props.js — long model with legacy fallback

- `Props.add`: bed branch — `const d = BED_DIR[id]; opts.long = this.game.world.get(x + d[0], y, z + d[1]) === B.BED_FOOT; opts.dir = d;`
- `buildBed(opts)` (models.js:232-242): when `opts.long`, geometry extends from `z=-0.5` to `z=+1.45` (head cell + foot cell): frame `0.9 × 0.14 × 1.94` centered `z≈0.48`, 4 corner legs at `z≈-0.44` and `z≈+1.4`, mattress `0.82 × 0.1 × 1.86`, blanket covering the foot half (`z≈0.6..1.4`), pillow + headboard stay at the −z end. Then orient: `const a = { '0,1': 0, '1,0': Math.PI/2, '-1,0': -Math.PI/2, '0,-1': Math.PI }[opts.dir.join(',')]; g.rotation.y = a;` (rotating (0,0,1) by yaw θ gives (sinθ, 0, cosθ) — verify each direction lands the foot on the right cell). `!opts.long` keeps today's 1-cell geometry.
- gallery.js bed entry (gallery.js:36): `opts: { long: true, dir: [0, 1] }`.

### B5. Reconciliation

Same loop as A7: for edits with `v === B.BED` where `world.get(x, y, z+1) === B.AIR` → `world.set(x, y, z+1, B.BED_FOOT)`. (B.BED's dir is +z, so legacy beds upgrade in place; blocked ones stay short.)

### B6. Tests (extend test/multiblock.test.js)

1. `yawToCardinal`: yaw 0 → [0,−1] (forward is (−sin, −cos)); yaw π → [0,1]; yaw ±π/2 → [∓1,0] — derive from the formula, don't guess.
2. `bedHeadFor`/`BED_DIR` round-trip for all four directions.
3. `bedParts` from head and from foot agree; the side-by-side disambiguation case: two parallel beds (H1 at (10,5,10) foot (10,5,11), H2 at (10,5,12) foot (10,5,13)) — `bedParts` at F1=(10,5,11) must return H1, never H2.
4. Pair placement writes both ids; pair break clears both and yields exactly one bed item id.
5. All four orientations place the foot on the expected cell.

---

## Task C — Ore hills gain infinite lode blocks

**Files:** Modify `src/config.js`, `src/world.js`, `src/main.js`, `src/power.js`, `src/textures.js`, `src/scenarios.js`, `test/mines.test.js`, `test/streaming.test.js` (+ a small new test block in power2 or mines for the drill).

### C1. config.js — defs (next to the ores, config.js:108-109)

```js
[B.IRON_LODE]: { name: 'Iron lode', solid: true, opaque: true, col: 0x93857a, accent: 0xe6bd94, hardness: 4.5, tool: 'pick', toolMin: 1, lode: 'iron_ore_raw' },
[B.COAL_LODE]: { name: 'Coal lode', solid: true, opaque: true, col: 0x53514f, accent: 0x191817, hardness: 3.8, tool: 'pick', lode: 'coal' },
```

New def field `lode: '<itemId>'` = harvesting yields that item and the block NEVER disappears. No `drop` field (nothing consumes it). Infected immunity is automatic (no machine/wire flags).

### C2. world.js — stamp the lode heart

In `stampOreHill` (world.js:523-580), right after the chamber carve and entrance loops, BEFORE the ore fill (so `tryOre` never overwrites it and `placed`/minOre accounting is untouched):

```js
// the heart of the hill: a lode cluster that never runs out (kid rule)
const lode = hill.isIron ? B.IRON_LODE : B.COAL_LODE;
for (const [lx, lz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]])
  write(cx + lx, surf, cz + lz, lode);
```

(`tryOre` only converts STONE/DIRT, so the lode cells are naturally skipped by every later pass.) Mirror the same 4-cell cluster in `buildOreHill` (world.js:839-905, the story-core twin — keep both implementations in lockstep; it writes via `this._set`).

### C3. Harvesting — main.js breakBlock (main.js:872)

Before the `world.set(x,y,z,B.AIR)` line:

```js
if (def.lode) {
  // lodes yield but never deplete — hold LMB to keep extracting
  this.audio.breakBlock();
  this.inv.useToolDurability(1);
  const overflow = this.inv.add(def.lode, 1);
  if (overflow > 0) this.dropItemAt({ x: x + 0.5, y: y + 1.2, z: z + 0.5 }, def.lode, overflow);
  this.audio.pickup(); this.hud.updateHotbar();
  return;
}
```

(`updateMining` in player.js resets `mineProgress` after each break and the block is still there, so holding LMB keeps yielding — no player.js change needed. `toolMin` gating already applies via `canHarvest`.)

### C4. Drill — power.js

- `isOre` (power.js): also return true for `B.IRON_LODE`/`B.COAL_LODE`.
- `findOre` (power.js): accept the two lode ids in the id guard.
- `updateDrill` (power.js:~300): when the target block's def has `lode`, buffer `def.lode` instead of the hard-coded ternary, do NOT `world.set(...AIR)`, do NOT null `m.oreTarget` (keep drilling the same block forever):

```js
const tdef = BLOCKS[id];
const itemId = tdef?.lode || (id === B.IRON_ORE ? 'iron_ore_raw' : id === B.COAL_ORE ? 'coal' : 'stone_shard');
m.buffer[itemId] = (m.buffer[itemId] || 0) + 1;
if (!tdef?.lode) {
  this.game.world.set(x, y, z, B.AIR);
  this.game.onWorldEditVisual(x, y, z);
  m.oreTarget = null;
}
```

### C5. Textures + flavor

- textures.js: add a `lode` painter — clone `paintOre` but denser flecks (`n = ri(rnd, 10, 14)`) so lodes read as richer; register `PAINTERS.lode = { fn: paintLode, accent: true }` and `FAMILIES[B.IRON_LODE] = ALL('lode')`, `FAMILIES[B.COAL_LODE] = ALL('lode')`.
- scenarios.js miner desc (scenarios.js:~107): update to mention the lode at the heart never runs out (e.g. `'Standing on the nearest ore hill with picks and torches. The lode at its heart never runs out.'`).
- Gallery needs NO code: blocks auto-list from `B`, and the hill landform survey renders whatever ids the stamp writes via per-id InstancedMesh.

### C6. Tests

1. test/mines.test.js: every core hill's 5-block-radius around `(m.x, m.y, m.z)` contains ≥3 blocks of the matching lode id (4 written; allow 1 lost to terrain edge cases).
2. test/streaming.test.js (extend the wild-hill test at :100-128): the materialized wild hill contains ≥3 lode blocks of the matching kind near its center; keep the existing finite-ore assertions passing (lodes must not eat into `minOre`).
3. Drill: place a drill adjacent to a `B.IRON_LODE` block (pattern of test/power2.test.js:104-115, calling `machines.updateDrill(m, dt, true)` directly): after many ticks, buffer grows AND `world.get` of the lode cell is still `B.IRON_LODE`; also `m.full` still trips at 24.
4. `oreHillShape('seed', true)` blocks map contains `B.IRON_LODE` entries (gallery survey path).

---

## Task D — Knockback on every damage source

**Files:** Modify `src/config.js`, `src/power.js`, `src/main.js`, `test/combat.test.js` (or a new small test file).

Facts: only player melee pairs `takeHit` with `applyKnockback` (main.js:710-712). `applyKnockback(fromPos, power)` (infected.js:314-322) already handles boss/hallucination immunity and scale² resistance. `COMBAT.kbDecay = 6`.

### D1. Config knobs (config.js)

- `MACHINES.turret.kb: 4`, `MACHINES.vibturret.kb: 3.5` (vibration shoving is thematically perfect), `MACHINES.uv.kb: 1.5`.
- `COMBAT.trapKb: 2`, `COMBAT.sterilantKb: 8`.

### D2. Discrete hits — full shove

- power.js gun turret (updateTurret, :491): after `best.takeHit(...)` add `best.applyKnockback?.({ x: m.x, z: m.z }, cfg.kb);`
- power.js vibration turret (updateVibTurret, :358): same with its cfg.kb.
- main.js sterilant burst (applySterilant, :1123): after `inf.takeHit(...)` add `inf.applyKnockback?.({ x: (d.x0 + d.x1) / 2, z: (d.z0 + d.z1) / 2 }, COMBAT.sterilantKb);`

### D3. Continuous damage — gentle push that never stomps a big shove

UV (power.js updateUV :377) and spike traps (main.js updateTraps :1809) tick every frame; a full shove per tick would stunlock. Apply a soft repulsion only when the current kb is nearly spent:

```js
if (inf.kb.lengthSq() < 0.4) inf.applyKnockback?.(sourcePos, gentlePower);
```

(UV: sourcePos = machine cell, power `cfg.kb`. Trap: sourcePos = `{ x: x + 0.5, z: z + 0.5 }` of the trap cell, power `COMBAT.trapKb` — with kbDecay 6 this displaces ~power/6 blocks per pulse, a stagger-wiggle, not an ejection.)

### D4. Tests

1. Gun turret: build a stub machine `{ x, y, z, cd: 0, ammo: 5, heat: 0, ... }` + a real non-boss Infected via makeStubGame (pattern: combat tests construct Infected directly; power2 tests call machine updates directly). After `machines.updateTurret(m, dt)` (or the vib variant), assert `inf.kb.length() > 0` and hp dropped.
2. Vibration turret: same shape.
3. Boss: same setup with `colony_host` → `kb.length() === 0` (immunity preserved through the new path).
4. Existing knockback tests (combat.test.js:97-158) must keep passing untouched.

---

## Cross-task notes

- **Id collisions:** Tasks A/B/C all add ids to `B` in config.js — use EXACTLY the table above so parallel work can't collide.
- **`model: 'none'` guard** in props.js is written once (Task A) and reused by Task B's foot.
- **Pair-break branch** in main.js breakBlock is written once covering doors AND beds (Task A writes it with door logic + a bedParts hook; Task B fills the bed arm).
- **Do not renumber existing ids, do not touch the recipes' grids** (test/recipes.test.js enforces grid sums == cost; neither recipe's cost changes).
- **Never import main.js/hud.js/dom.js/audio.js/save.js in tests** (browser-only). Pure logic goes in multiblock.js / world.js / power.js / config.js.
- Run `npm test` after each task; all pre-existing tests must pass except the deliberately-updated fortified-scenario assertion.
