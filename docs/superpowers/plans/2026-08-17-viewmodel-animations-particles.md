# Held Tools, Animations, Particles & Real Knockback — Implementation Plan

> **For agentic workers:** Execute your assigned task section fully: implement + tests, run `npm test` until green, do NOT commit unless the task says to. Match existing code style (comment density, naming, no TypeScript). The repo is /Users/scottfleischman/GitHub/scott-fleischman/infections-wake.

**Goal:** Enemies visibly move backward when hit; the player sees the tool in their own hands and their own legs; every tool and weapon has a real 3D model; enemies walk, lunge and flinch; blocks and dying enemies throw particles; the starting refuge is bigger with a cleared 10-block radius around it.

**Architecture:** Six mostly-independent seams. (1) Knockback becomes *distance in blocks* in config, with a short stagger window on `Infected` that suppresses its own locomotion so the shove is not immediately walked off. (2) A new `src/viewmodel.js` renders the held tool in a **second render pass** with a cleared depth buffer, so it can never clip into world geometry. (3) `src/models.js` gains `buildToolMesh()` and `buildPlayerMesh()`, keeping its role as the single source of truth for non-cube visuals. (4) A new `src/particles.js` owns one pooled `InstancedMesh` — no per-hit allocation, which matters on a streamed 16k world. (5) Infected limb animation rides on named limb arrays captured at build time, animated in `syncMesh` — **no structural change to the mesh hierarchy**, because `facing` already owns `mesh.rotation.y`. (6) `placeStartRefuge` grows the shack and sweeps vegetation.

**Tech Stack:** Plain JS (no TypeScript) + Three.js + Vite; `node:test` suite via `npm test` (currently 195 passing). Three.js is headless-safe except `WebGLRenderer` — **never import `src/main.js`, `hud.js`, `dom.js`, `audio.js`, `save.js` in Node tests**. `src/models.js`, `src/particles.js` and the pure exports of `src/viewmodel.js` ARE headless-safe and must stay that way.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/config.js` | Modify | `COMBAT` knockback distances/stagger constants; per-weapon `kb:` values become blocks |
| `src/infected.js` | Modify | Stagger window, distance-based `applyKnockback`, limb/flinch animation, death particles |
| `src/models.js` | Modify | `buildToolMesh()`, `buildPlayerMesh()`, limb capture in `buildInfectedMesh()` |
| `src/viewmodel.js` | **Create** | Held-tool overlay scene + swing animation. Pure `swingPose()` is Node-testable |
| `src/particles.js` | **Create** | Pooled instanced particle system + pure `stepParticle()` |
| `src/main.js` | Modify | Wire viewmodel, particles, player body into the frame loop and the break/attack hooks |
| `src/player.js` | Modify | Expose `isMoving`/`swing` state the viewmodel reads |
| `src/world.js` | Modify | Bigger `placeStartRefuge()` + radius-10 vegetation sweep |
| `src/gallery.js` | Modify | New TOOLS section rendering `buildToolMesh()` |
| `test/combat.test.js` | Modify | Knockback distance + stagger regression tests |
| `test/models.test.js` | **Create** | `buildToolMesh` / `buildPlayerMesh` / limb capture contracts |
| `test/viewmodel.test.js` | **Create** | Pure `swingPose()` contract |
| `test/particles.test.js` | **Create** | Pure `stepParticle()` + pool recycling contract |
| `test/world.test.js` | Modify | Refuge size + cleared-radius regression tests |

**Save compatibility constraint (do not violate):** `world.pickups` is an **index-stable** array — `pickupsTaken` in the save file is a `Set` of indices into it. Task H must NOT add, remove, or reorder entries in `world.pickups`, or every existing save will mark the wrong items as collected. Clear vegetation *blocks* only.

---

## Task A — Knockback that actually moves them

**Files:**
- Modify: `src/config.js:501-511` (COMBAT), `src/config.js:239,243,252` (weapon `kb:`), `src/config.js:534,544,545` (machine `kb:`)
- Modify: `src/infected.js:25` (constructor), `src/infected.js:99-265` (update), `src/infected.js:316-322` (applyKnockback)
- Modify: `src/main.js:718`, `src/main.js:1198`, `src/main.js:1888`, `src/power.js:359,381,503`
- Test: `test/combat.test.js`

### A1. Write the failing tests

Append to `test/combat.test.js`:

```js
// ---------------- knockback actually displaces (2026-08-17) ----------------

// A shove must move the body BACKWARD even though it is actively pursuing.
// Before the stagger window existed, pursue speed cancelled the shove and a
// runner (speed 4.4) closed distance while "knocked back".
function kbRig(strainKey) {
  const { world, game, sig, inf } = rig();
  buildFloor(world, 20, 70, 10, 40, 20);
  // player stands on the slab so the body pursues along -x toward it
  game.player.pos.set(30, 21, 25);
  sig.setDynamic('bait', 30, 21, 25, { heat: 0.9, co2: 0.8 }, 40);
  const body = inf.spawn(strainKey, 34, 21, 25, {});
  body.target = { x: 30, y: 21, z: 25 };
  body.targetIsPlayer = true;
  body.state = 'pursue';
  return { game, inf, body };
}

test('a bare-hand shove moves a drifter ~0.25 blocks away from the striker', () => {
  const { inf, body } = kbRig('drifter');
  const x0 = body.pos.x;
  body.applyKnockback({ x: 30, z: 25 }, COMBAT.handKb);
  for (let i = 0; i < 60; i++) inf.update(1 / 60); // one full second
  const moved = body.pos.x - x0;
  assert.ok(moved > 0.20 && moved < 0.32, `expected ~0.25 blocks back, got ${moved.toFixed(3)}`);
});

test('a weapon shove moves a drifter ~0.5 blocks away from the striker', () => {
  const { inf, body } = kbRig('drifter');
  const x0 = body.pos.x;
  body.applyKnockback({ x: 30, z: 25 }, 0.5);
  for (let i = 0; i < 60; i++) inf.update(1 / 60);
  const moved = body.pos.x - x0;
  assert.ok(moved > 0.42 && moved < 0.60, `expected ~0.5 blocks back, got ${moved.toFixed(3)}`);
});

test('a runner cannot out-walk its own stagger', () => {
  // the original bug: runner speed 4.4 > shove speed, so it closed distance
  const { inf, body } = kbRig('runner');
  const x0 = body.pos.x;
  body.applyKnockback({ x: 30, z: 25 }, 0.5);
  for (let i = 0; i < 20; i++) inf.update(1 / 60); // sample inside the stagger
  assert.ok(body.pos.x > x0 + 0.2, `runner must be pushed back, got ${(body.pos.x - x0).toFixed(3)}`);
});

test('a staggered body cannot attack or chew during the window', () => {
  const { game, inf, body } = kbRig('machine_eater');
  body.target = { x: 34, y: 21, z: 25 };  // a block right where it stands
  body.targetIsPlayer = false;
  body.applyKnockback({ x: 30, z: 25 }, 0.5);
  const before = game.attackedBlocks.length;
  for (let i = 0; i < 10; i++) inf.update(1 / 60); // 0.167s — inside the 0.3s window
  assert.equal(game.attackedBlocks.length, before, 'a staggered eater must not chew');
  assert.ok(body.stunT > 0, 'stagger window still open');
});

test('continuous nudges (UV, traps) never stagger — no stunlock', () => {
  const { inf, body } = kbRig('drifter');
  body.applyKnockback({ x: 30, z: 25 }, COMBAT.trapKb, { stun: false });
  assert.equal(body.stunT, 0, 'trap nudges must leave the body free to act');
  for (let i = 0; i < 30; i++) inf.update(1 / 60);
  assert.ok(body.pos.x < 34.2, 'a nudged body still closes on its target');
});

test('bosses are immune to knockback and stagger', () => {
  const { inf, body } = kbRig('colony_host');
  const x0 = body.pos.x;
  body.applyKnockback({ x: 30, z: 25 }, 0.5);
  assert.equal(body.stunT, 0);
  assert.equal(body.kb.lengthSq(), 0);
  for (let i = 0; i < 30; i++) inf.update(1 / 60);
  assert.ok(body.pos.x <= x0 + 0.01, 'a boss never gets shoved');
});
```

Add `COMBAT` to the existing config import at the top of `test/combat.test.js`:

```js
import { B, BLOCKS, TIME, STRAINS, COMBAT, canInfectedBreakBlock } from '../src/config.js';
```

- [ ] **Step 1: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -30`
Expected: FAIL — `body.stunT` is `undefined`, and the displacement assertions miss because pursue cancels the shove.

### A2. config.js — knockback becomes distance in blocks

Replace the `COMBAT` block at `src/config.js:501-511`:

```js
// Knockback: every damage source shoves the target. `kb` fields are DISTANCE
// IN BLOCKS travelled by an unarmoured (scale 1) body — the impulse is derived
// as distance * kbDecay, because the integral of v0*e^(-decay*t) is v0/decay.
// Full shoves also open a short stagger window (kbStun) during which the body
// cannot walk, chew or attack; without it the body simply walks the shove off
// (a runner at speed 4.4 used to CLOSE distance while "knocked back").
export const COMBAT = {
  handKb: 0.25,      // bare-hand / non-weapon shove, in blocks
  kbDecay: 6,        // per-second exponential decay of an infected's shove
  kbCutoff: 0.05,    // shove ends below this speed (keeps travel ≈ the configured distance)
  kbStun: 0.3,       // stagger window opened by a full shove, seconds
  flinchT: 0.18,     // visual recoil on taking a hit, seconds
  playerKb: 6.5,     // horizontal impulse on the player when an infected connects
  playerKbUp: 3.0,   // small upward pop (grounded hits only)
  playerKbAccelMul: 0.3, // input authority while being shoved (kbT window)
  playerKbT: 0.25,
  trapKb: 0.12,       // spike traps: gentle stagger-wiggle, not an ejection
  sterilantKb: 0.5,   // valve two: exposed tissue gets flung off the vent
```

> Keep every line after `sterilantKb` in the existing `COMBAT` object exactly as it is. `playerKb`/`playerKbUp` are **player** impulses in a different unit system — do not convert them.

Change the three weapon `kb:` values (they are all "everything else" = 0.5 blocks):

- `src/config.js:239` `stone_spear`: `kb: 5` → `kb: 0.5`
- `src/config.js:243` `iron_blade`: `kb: 6` → `kb: 0.5`
- `src/config.js:252` `steel_blade`: `kb: 7` → `kb: 0.5`

Change the three machine `kb:` values:

- `src/config.js:534` turret: `kb: 4` → `kb: 0.5`
- `src/config.js:544` `uv`: `kb: 1.5` → `kb: 0.12`
- `src/config.js:545` `vibturret`: `kb: 3.5` → `kb: 0.5`

### A3. infected.js — stagger state

At `src/infected.js:25`, after the `this.kb` line, add:

```js
    this.kb = new THREE.Vector3();   // transient knockback shove (not serialized)
    this.stunT = 0;                  // stagger window: no walking/chewing/attacking
    this.flinchT = 0;                // visual recoil timer (syncMesh only)
    this.walkPhase = Math.random() * 6.28; // limb swing phase
```

Replace `applyKnockback` at `src/infected.js:316-322`:

```js
  // Shove away from `fromPos` by `dist` BLOCKS. Heavier frames resist (scale,
  // not scale² — a brute must still visibly move). A full shove also opens the
  // stagger window; continuous sources (UV, spike traps) pass { stun: false }
  // so they wiggle a body without ever stunlocking it. Encounter bosses are
  // immune (a jugglable colony host trivializes the fight).
  applyKnockback(fromPos, dist, opts = {}) {
    if (this.s.boss || this.isFalse) return;
    const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    const v0 = (dist * COMBAT.kbDecay) / this.s.scale;
    this.kb.set(dx / len * v0, 0, dz / len * v0);
    if (opts.stun !== false) this.stunT = COMBAT.kbStun;
  }
```

### A4. infected.js — the stagger window suppresses locomotion

First extract gravity so the stagger path can reuse it. Replace `src/infected.js:254-262` (the `if (!this._climbedNow) { ... }` block plus the reset line) with a call:

```js
    this.applyGravity(dt);

    this.syncMesh(dt);
  }

  // Ride the ground; climbers cling briefly instead of dropping at full speed.
  applyGravity(dt) {
    if (!this._climbedNow) {
      const gy = this.groundY(this.pos.x, this.pos.z);
      if (this.pos.y > gy + 0.1) {
        const fall = this.climbingT > 0 ? 2.5 : 12;
        this.pos.y = Math.max(gy, this.pos.y - fall * dt);
      } else this.pos.y = gy;
    }
    this._climbedNow = false;
  }
```

> The `if (this.climbingT > 0) this.climbingT -= dt;` line at `src/infected.js:252` stays where it is, in `update`.

Then replace the knockback block at `src/infected.js:118-124` with the shove **plus** the stagger early-return:

```js
    // knockback shove FIRST — it must interrupt chewing/spitting, not queue
    // behind their early returns. Decays fast, respects collision, and never
    // triggers block attacks (noAttack).
    if (this.kb.lengthSq() > COMBAT.kbCutoff * COMBAT.kbCutoff) {
      this.tryMove(this.kb.x * dt, this.kb.z * dt, true);
      this.kb.multiplyScalar(Math.max(0, 1 - COMBAT.kbDecay * dt));
    } else if (this.kb.lengthSq() > 0) this.kb.set(0, 0, 0);

    // Staggered: the body is along for the ride. It does not walk, chew, spit
    // or swing until the window closes — this is what makes the shove read as
    // "it got knocked back" instead of "it kept coming".
    if (this.stunT > 0) {
      this.stunT = Math.max(0, this.stunT - dt);
      this.applyGravity(dt);
      this.syncMesh(dt);
      return;
    }
```

### A5. Update every caller to pass distances

The signature is unchanged in shape (`fromPos, dist`), so only the **nudge** call sites need the new third argument:

- `src/main.js:718` — leave as is (`held?.def?.kb || COMBAT.handKb`), the values are now distances.
- `src/main.js:1198` — leave as is (`COMBAT.sterilantKb`).
- `src/main.js:1888` (spike trap) — change to:
  ```js
      if (inf.kb.lengthSq() < 0.4) inf.applyKnockback?.({ x: x + 0.5, z: z + 0.5 }, COMBAT.trapKb, { stun: false });
  ```
- `src/power.js:381` (UV) — change to:
  ```js
      if (inf.kb.lengthSq() < 0.4) inf.applyKnockback?.({ x: m.x, z: m.z }, cfg.kb, { stun: false });
  ```
- `src/power.js:359` and `src/power.js:503` (gun turret / vibration turret) — leave as is; those are discrete shots and SHOULD stagger.

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, total count 195 → 201.

- [ ] **Step 3: Commit**

```bash
git add src/config.js src/infected.js src/main.js src/power.js test/combat.test.js
git commit -m "feat: knockback is distance-in-blocks with a stagger window so shoves actually land"
```

---

## Task B — Enemies walk, lunge and flinch

**Files:**
- Modify: `src/models.js:575-798` (`buildInfectedMesh`)
- Modify: `src/infected.js:29-38` (`buildMesh`), `src/infected.js:345-362` (`syncMesh`), `src/infected.js:364-384` (`takeHit`)
- Test: Create `test/models.test.js`

### B1. Write the failing test

Create `test/models.test.js`:

```js
// models.js is headless-safe (Three.js runs in Node; only WebGLRenderer does
// not). These lock the contracts other modules rely on: limb capture for the
// walk cycle, and a tool mesh for every tool item in the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInfectedMesh, buildToolMesh, buildPlayerMesh } from '../src/models.js';
import { STRAINS, ITEMS } from '../src/config.js';

test('every strain exposes swingable legs for the walk cycle', () => {
  for (const key of Object.keys(STRAINS)) {
    const { group, limbs } = buildInfectedMesh(key);
    assert.ok(group.isObject3D, `${key} builds a group`);
    assert.ok(limbs, `${key} exposes limbs`);
    assert.ok(limbs.legs.length >= 2, `${key} needs at least 2 legs to swing, got ${limbs.legs.length}`);
    for (const l of limbs.legs) assert.equal(typeof l.rest, 'number', `${key} leg records its rest rotation`);
  }
});

test('limb rest angles capture the authored pose, not zero', () => {
  // the runner's legs are authored with rotation.x = -0.12 (forward lean)
  const { limbs } = buildInfectedMesh('runner');
  assert.ok(limbs.legs.some(l => Math.abs(l.rest + 0.12) < 1e-6), 'runner leg rest must be the authored -0.12');
});
```

- [ ] **Step 1: Run to verify it fails**

Run: `node --test test/models.test.js 2>&1 | tail -20`
Expected: FAIL — `buildToolMesh` / `buildPlayerMesh` are not exported, `limbs` is undefined.

### B2. models.js — capture limbs as they are authored

Add these helpers directly after `ud()` at `src/models.js:59`:

```js
// Limb capture for the walk cycle. Each strain authors its legs/arms with a
// rest pose (some lean forward); we record that rest angle so animation can
// swing AROUND it instead of snapping every body upright.
function limbRec(mesh) { return { mesh, rest: mesh.rotation.x }; }
```

In `buildInfectedMesh` (`src/models.js:575`), declare the collectors next to `mats`:

```js
export function buildInfectedMesh(strainKey) {
  const s = STRAINS[strainKey];
  const g = new THREE.Group();
  const mats = [];
  const limbs = { legs: [], arms: [] };
  const LEG = (m) => { limbs.legs.push(limbRec(m)); return m; };
  const ARM = (m) => { limbs.arms.push(limbRec(m)); return m; };
```

Now wrap every leg and arm mesh in each strain branch. **The wrap must happen AFTER any `rotation.x` is assigned**, so the rest angle is recorded correctly. Apply this pattern in every branch:

```js
  // runner (src/models.js:586-599)
  if (strainKey === 'runner') {
    for (const sx of [-1, 1]) {
      const leg = box(g, 0.1, 0.62, 0.1, M(dark), sx * 0.1, 0.31, -0.02);
      leg.rotation.x = -0.12;
      LEG(leg);                                                // <-- add
    }
    const torso = box(g, 0.34, 0.56, 0.22, M(s.color), 0, 0.84, 0.08);
    torso.rotation.x = 0.55;                                   // deep forward lean
    for (const sx of [-1, 1]) {
      const arm = box(g, 0.08, 0.5, 0.08, M(dark), sx * 0.24, 0.72, 0.3);
      arm.rotation.x = 0.8;
      ARM(arm);                                                // <-- add
    }
```

```js
  // machine_eater (src/models.js:600-618)
    for (const sx of [-1, 1]) LEG(box(g, 0.16, 0.42, 0.16, M(dark), sx * 0.17, 0.21, 0));
    ...
      ARM(box(g, 0.15, 0.58, 0.15, M(dark), sx * 0.44, 0.62, 0.04));    // heavy arm
```

```js
  // colony_host (src/models.js:619-638) — four stumpy legs, no arms
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      LEG(box(g, 0.2, 0.3, 0.2, M(darker), sx * 0.3, 0.15, sz * 0.22));
```

```js
  // brute (src/models.js:639+)
    for (const sx of [-1, 1]) LEG(box(g, 0.22, 0.4, 0.22, M(darker), sx * 0.22, 0.2, 0));
```

**Do the same for the remaining branches** (`drifter`, `climber`, `burrower`, `cyst_carrier`, `spitter`, `elite`, `kiln_host`, `pump_host`): find the `for (const sx of [-1, 1])` loop that creates the leg boxes (they are always the first meshes in the branch, positioned near `y ≈ 0.2–0.35`) and wrap with `LEG(...)`; wrap the arm boxes (positioned near `y ≈ 0.6–0.8` with `sx * 0.2..0.45` offsets) with `ARM(...)`. If a strain authors fewer than 2 legs, add a fallback after the branch chain rather than restructuring that strain.

Then, immediately before the return at `src/models.js:795-797`, add the fallback and extend the return:

```js
  // every body needs something to swing; a legless silhouette borrows its
  // lowest two meshes so the walk cycle is never a no-op
  if (limbs.legs.length < 2) {
    const low = g.children.filter(c => c.isMesh).sort((a, b) => a.position.y - b.position.y).slice(0, 2);
    for (const m of low) limbs.legs.push(limbRec(m));
  }

  g.scale.setScalar(s.scale);
  ud(g);
  return { group: g, head, mats, limbs };
}
```

### B3. infected.js — store the limbs

Replace `src/infected.js:29-38`:

```js
  buildMesh() {
    // distinct per-strain silhouette (models.js — shared with the gallery)
    const { group, head, mats, limbs } = buildInfectedMesh(this.strainKey);
    this.mesh = group;
    this.headMesh = head;
    this.bodyMats = mats;
    this.bodyMat = mats[0];
    this.limbs = limbs;
    group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.game.scene.add(group);
  }
```

### B4. infected.js — animate in syncMesh

Replace `src/infected.js:345-362`:

```js
  syncMesh(dt) {
    this.mesh.position.copy(this.pos);
    // smooth turn toward facing
    let d = this.facing - this.mesh.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.mesh.rotation.y += d * Math.min(1, 10 * dt);
    if (this.lunge > 0) { this.lunge -= dt; this.mesh.position.y += 0.1; }

    // ---- walk cycle: legs counter-swing, arms mirror them ----
    // phase advances with the distance actually covered, so a staggered or
    // blocked body stops stepping instead of moon-walking in place.
    const moved = Math.hypot(this.pos.x - (this._lastX ?? this.pos.x), this.pos.z - (this._lastZ ?? this.pos.z));
    this._lastX = this.pos.x; this._lastZ = this.pos.z;
    this.walkPhase += moved * 5.5;
    const swing = Math.sin(this.walkPhase) * 0.5;
    const lunging = this.lunge > 0;
    if (this.limbs) {
      const legs = this.limbs.legs;
      for (let i = 0; i < legs.length; i++)
        legs[i].mesh.rotation.x = legs[i].rest + swing * (i % 2 === 0 ? 1 : -1);
      const arms = this.limbs.arms;
      for (let i = 0; i < arms.length; i++) {
        // a lunging body throws BOTH arms forward; otherwise they counter the legs
        arms[i].mesh.rotation.x = lunging
          ? arms[i].rest - 1.1
          : arms[i].rest - swing * (i % 2 === 0 ? 1 : -1) * 0.7;
      }
    }

    // ---- hit flinch: recoil away from the facing + a brief swell ----
    if (this.flinchT > 0) {
      this.flinchT = Math.max(0, this.flinchT - dt);
      const k = this.flinchT / COMBAT.flinchT;
      this.mesh.position.x -= Math.sin(this.facing) * 0.14 * k;
      this.mesh.position.z -= Math.cos(this.facing) * 0.14 * k;
      this.mesh.scale.setScalar(this.s.scale * (1 + 0.09 * k));
    } else if (this.mesh.scale.x !== this.s.scale) {
      this.mesh.scale.setScalar(this.s.scale);
    }

    // §5.5 early cue: while the body idles, the head still tracks the stimulus
    if (this.headMesh && this.target && this.state !== 'wander') {
      const want = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z) - this.mesh.rotation.y;
      let hd = want - this.headMesh.rotation.y;
      while (hd > Math.PI) hd -= Math.PI * 2;
      while (hd < -Math.PI) hd += Math.PI * 2;
      const lim = Math.PI * 0.45;
      this.headMesh.rotation.y = Math.max(-lim, Math.min(lim, this.headMesh.rotation.y + hd * Math.min(1, 5 * dt)));
    }
  }
```

### B5. infected.js — set the flinch on being hit

In `takeHit` at `src/infected.js:369-371`, after `this.flash();` add:

```js
    this.hp -= dmg;
    this.flash();
    this.flinchT = COMBAT.flinchT;
```

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: the two `test/models.test.js` limb tests PASS; the `buildToolMesh`/`buildPlayerMesh` import still fails until Tasks C and E. If the import error blocks the file, temporarily import only `buildInfectedMesh` and restore the full import in Task C.

- [ ] **Step 3: Commit**

```bash
git add src/models.js src/infected.js test/models.test.js
git commit -m "feat: infected walk cycle, lunge arms and hit flinch"
```

---

## Task C — 3D models for every tool and weapon

**Files:**
- Modify: `src/models.js:1-3` (imports), append `buildToolMesh`, extend `buildGroundItem` at `src/models.js:861-866`
- Modify: `src/gallery.js:78-83` (sections) + the entry list
- Test: `test/models.test.js`

### C1. Write the failing test

Append to `test/models.test.js`:

```js
test('every tool and weapon has a 3D model', () => {
  const toolIds = Object.keys(ITEMS).filter(id => ITEMS[id].tool);
  assert.ok(toolIds.length >= 9, `expected the full tool set, found ${toolIds.length}`);
  for (const id of toolIds) {
    const g = buildToolMesh(id);
    assert.ok(g && g.isObject3D, `${id} builds a mesh`);
    let meshes = 0;
    g.traverse(o => { if (o.isMesh) meshes++; });
    assert.ok(meshes >= 2, `${id} needs a haft and a head, got ${meshes} meshes`);
  }
});

test('buildToolMesh returns null for non-tools', () => {
  assert.equal(buildToolMesh('coal'), null);
  assert.equal(buildToolMesh('not_a_real_item'), null);
});

test('tools stand on their handle butt so the hand can grip at the origin', () => {
  const g = buildToolMesh('iron_pick');
  const box3 = new (require('three').Box3)().setFromObject(g);
  assert.ok(box3.min.y >= -0.02, `handle butt sits at the origin, min.y=${box3.min.y}`);
  assert.ok(box3.max.y > 0.4, 'tool extends upward');
});
```

> Replace the `require` in that last test with a top-level `import * as THREE from 'three';` and use `new THREE.Box3()` — the test files are ESM.

### C2. models.js — build the tools

Extend the config import at `src/models.js:2`:

```js
import { B, BLOCKS, STRAINS, ITEMS } from './config.js';
```

Append before the "Shared animation + teardown" section at `src/models.js:920`:

```js
// ---------------------------------------------------------------------------
// Tools & weapons — one model per tool item, shared by the first-person
// viewmodel, ground drops and the gallery. Origin is the BUTT OF THE HAFT with
// the tool pointing +Y, so a hand grips at (0,0,0) and the head reads forward.
// ---------------------------------------------------------------------------

function buildToolHead(g, kind, metal, dark, hafts) {
  const top = hafts;                                     // y of the haft tip
  if (kind === 'pick') {
    const head = box(g, 0.07, 0.07, 0.62, metal, 0, top, 0);
    head.rotation.x = 0.16;
    box(g, 0.075, 0.09, 0.1, dark, 0, top, 0);           // eye/collar over the haft
    const t1 = cone(g, 0.05, 0.13, metal, 0, top + 0.02, 0.33, 4);
    t1.rotation.x = Math.PI / 2 + 0.16;                  // forward point
    const t2 = cone(g, 0.05, 0.13, metal, 0, top - 0.02, -0.33, 4);
    t2.rotation.x = -Math.PI / 2 + 0.16;                 // rear point
  } else if (kind === 'axe') {
    box(g, 0.075, 0.1, 0.1, dark, 0, top, 0);            // collar
    const bit = box(g, 0.05, 0.3, 0.3, metal, 0, top - 0.02, 0.19);
    bit.rotation.x = 0.1;
    const edge = box(g, 0.03, 0.34, 0.07, metal, 0, top - 0.02, 0.35);
    edge.rotation.x = 0.1;                               // flared cutting edge
    box(g, 0.05, 0.12, 0.1, metal, 0, top + 0.02, -0.1); // poll
  } else if (kind === 'shovel') {
    box(g, 0.075, 0.09, 0.09, dark, 0, top, 0);          // socket
    const blade = box(g, 0.28, 0.32, 0.035, metal, 0, top + 0.14, 0.02);
    blade.rotation.x = -0.08;
    const tip = box(g, 0.22, 0.09, 0.03, metal, 0, top + 0.31, 0.03);
    tip.rotation.x = -0.08;                              // rounded digging lip
  } else { // sword / spear
    box(g, 0.13, 0.05, 0.05, dark, 0, top, 0);           // cross guard
    box(g, 0.085, 0.52, 0.028, metal, 0, top + 0.28, 0); // blade
    cone(g, 0.045, 0.14, metal, 0, top + 0.6, 0, 4);     // point
  }
}

export function buildToolMesh(itemId) {
  const def = ITEMS[itemId];
  if (!def || !def.tool) return null;
  const g = new THREE.Group();
  const metal = lambert(def.color ?? 0x8a8f96);
  const dark = lambert(new THREE.Color(def.color ?? 0x8a8f96).offsetHSL(0, 0, -0.14).getHex());
  const haft = lambert(P.woodDark);
  const grip = lambert(0x4a3a24);
  // spears run long and thin; blades keep a short hilt; diggers sit in between
  const len = def.tool === 'sword' ? (itemId === 'stone_spear' ? 0.78 : 0.3) : 0.56;
  cyl(g, 0.026, 0.032, len, haft, 0, len / 2, 0, 6);
  cyl(g, 0.034, 0.034, 0.12, grip, 0, 0.07, 0, 6);       // wrapped grip
  buildToolHead(g, def.tool, metal, dark, len);
  return g;
}
```

### C3. models.js — dropped tools use the same mesh

Replace `src/models.js:861-866`:

```js
export function buildGroundItem(itemId, seed = 0) {
  if (itemId === 'stick') return buildSticks(seed);
  if (itemId === 'stone_shard') return buildStones(seed);
  if (itemId === 'fiber') return buildFiberTuft(seed);
  // a dropped tool lies on its side where it fell
  const tool = buildToolMesh(itemId);
  if (tool) {
    const g = new THREE.Group();
    tool.rotation.z = Math.PI / 2;
    tool.rotation.y = (seed % 7) * 0.4;
    tool.position.y = 0.05;
    g.add(tool);
    return g;
  }
  return null;
}
```

### C4. gallery.js — a TOOLS section

Add to the sections map at `src/gallery.js:78-83`, after `blocks`:

```js
  tools: { title: 'TOOLS', mode: 'tools' },
```

Find the renderer that handles `mode: '3d'` and add a `tools` branch that builds each entry with `buildToolMesh(entry.key)` instead of `buildProp(entry.kind)`, framing it the same way. The entry list is every `ITEMS` key with a truthy `.tool`, with the item's `name` as the label and a short description drawn from its stats:

```js
const TOOL_ENTRIES = Object.keys(ITEMS)
  .filter(id => ITEMS[id].tool)
  .map(id => ({
    key: id,
    name: ITEMS[id].name,
    desc: `${ITEMS[id].tool} · tier ${ITEMS[id].tier} · ${ITEMS[id].dmg} dmg`
      + (ITEMS[id].kb ? ` · ${ITEMS[id].kb} block knockback` : '')
      + ` · ${ITEMS[id].dur} durability`,
  }));
```

Import `buildToolMesh` and `ITEMS` in `src/gallery.js`.

- [ ] **Step 1: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: the tool model tests PASS.

- [ ] **Step 2: Verify the gallery renders**

Run the dev server via the `.claude/launch.json` config `infections-wake` (port 5199) and open `/gallery.html`. Screenshot the TOOLS section. Every tool must be recognizable at a glance: a pick reads as a pick, a shovel as a shovel.

- [ ] **Step 3: Commit**

```bash
git add src/models.js src/gallery.js test/models.test.js
git commit -m "feat: 3D models for every tool and weapon, shared by drops and the gallery"
```

---

## Task D — The held tool in your hands, with swing animations

**Files:**
- Create: `src/viewmodel.js`, `test/viewmodel.test.js`
- Modify: `src/main.js` (construct, resize, frame, hooks), `src/player.js` (swing triggers)

### D1. Write the failing test

Create `test/viewmodel.test.js`:

```js
// The swing math is pure so it can be tested without a WebGL context. The
// Viewmodel class itself is browser-only (it owns a Scene + Camera); only
// swingPose is imported here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swingPose, SWING } from '../src/viewmodel.js';

test('a swing starts and ends at rest', () => {
  for (const kind of ['mine', 'attack']) {
    const a = swingPose(kind, 0), b = swingPose(kind, 1);
    assert.ok(Math.abs(a.pitch) < 1e-6, `${kind} starts at rest pitch`);
    assert.ok(Math.abs(b.pitch) < 1e-6, `${kind} ends at rest pitch`);
    assert.ok(Math.abs(a.yaw) < 1e-6 && Math.abs(b.yaw) < 1e-6);
  }
});

test('a mine swing is a downward chop', () => {
  // peak of the chop drives the tool head DOWN (positive pitch = tip toward the floor)
  const peak = swingPose('mine', 0.35);
  assert.ok(peak.pitch > 0.6, `expected a deep chop, got ${peak.pitch}`);
  assert.ok(peak.push > 0, 'the chop reaches forward as it falls');
});

test('an attack swing is a faster, wider slash than a mine chop', () => {
  const attack = swingPose('attack', 0.3), mine = swingPose('mine', 0.3);
  assert.ok(Math.abs(attack.yaw) > Math.abs(mine.yaw), 'the slash sweeps sideways');
  assert.ok(SWING.attack < SWING.mine, 'the slash is the shorter animation');
});

test('swing phase clamps outside 0..1', () => {
  assert.deepEqual(swingPose('mine', -0.5), swingPose('mine', 0));
  assert.deepEqual(swingPose('mine', 4), swingPose('mine', 1));
});
```

- [ ] **Step 1: Run to verify it fails**

Run: `node --test test/viewmodel.test.js 2>&1 | tail -20`
Expected: FAIL — `src/viewmodel.js` does not exist.

### D2. Create `src/viewmodel.js`

```js
import * as THREE from 'three';
import { buildToolMesh, disposeGroup } from './models.js';
import { ITEMS } from './config.js';

// ============================================================================
// First-person viewmodel: the tool in your own hands.
//
// It renders in a SECOND pass over a cleared depth buffer (see render()), not
// as a child of the world camera. That is the only reliable way to keep a
// hand-held model from clipping into a wall you are standing against — the
// world pass finishes, the depth buffer is wiped, and the viewmodel draws on
// top of everything at its own tiny scale.
//
// swingPose() is pure and lives here so the animation can be unit-tested in
// Node without a WebGL context.
// ============================================================================

// swing durations in seconds
export const SWING = { mine: 0.42, attack: 0.26 };

// Rest pose of the held tool in the viewmodel camera's local space.
const REST = { x: 0.32, y: -0.34, z: -0.62, pitch: -0.5, yaw: -0.35, roll: 0.15 };

// Pose offsets for a swing at normalized phase u (0 = start, 1 = finished).
// Returns radians + a forward push in metres, all relative to REST.
export function swingPose(kind, u) {
  const t = Math.max(0, Math.min(1, u));
  if (kind === 'attack') {
    // fast diagonal slash: sweeps across and returns
    const s = Math.sin(Math.PI * t);
    return { pitch: s * 0.85, yaw: s * 0.95, roll: -s * 0.5, push: s * 0.2 };
  }
  // mine: a chop that falls hard and recovers slowly (asymmetric ease)
  const fall = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
  const e = fall * fall * (3 - 2 * fall);            // smoothstep
  return { pitch: e * 1.15, yaw: e * 0.18, roll: e * 0.1, push: e * 0.16 };
}

export class Viewmodel {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 4);
    // the viewmodel carries its own light rig so it reads the same at noon and
    // at midnight — a pitch-black tool in your hand is worse than a lit one
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xfff2dd, 1.5);
    key.position.set(0.6, 1.2, 0.8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db4c8, 0.5);
    rim.position.set(-0.8, 0.2, -0.6);
    this.scene.add(rim);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.itemId = null;
    this.tool = null;
    this.hand = null;
    this.swing = null;       // { kind, t }
    this.bob = 0;
    this.visible = true;
  }

  // Rebuild only when the selected item actually changes.
  setItem(itemId) {
    if (itemId === this.itemId) return;
    this.itemId = itemId;
    if (this.tool) { this.root.remove(this.tool); disposeGroup(this.tool); this.tool = null; }
    if (!this.hand) this.hand = this._buildHand();
    const mesh = itemId ? buildToolMesh(itemId) : null;
    if (mesh) {
      mesh.scale.setScalar(0.62);
      this.tool = mesh;
      this.root.add(mesh);
    }
    this.root.visible = true;
  }

  // A simple gloved forearm so a bare hand still reads as a hand.
  _buildHand() {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0x8a6a52 });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x4a5240 });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.34), sleeve);
    arm.position.set(0.02, -0.09, 0.13);
    g.add(arm);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.12), skin);
    fist.position.set(0.02, -0.04, -0.03);
    g.add(fist);
    this.root.add(g);
    return g;
  }

  startSwing(kind) { this.swing = { kind, t: 0 }; }

  // state: { moving: bool, mining: bool }
  update(dt, state = {}) {
    if (!this.root) return;
    // hold-to-mine loops the chop for as long as the button is down
    if (state.mining && !this.swing) this.startSwing('mine');

    let pose = { pitch: 0, yaw: 0, roll: 0, push: 0 };
    if (this.swing) {
      this.swing.t += dt;
      const dur = SWING[this.swing.kind] ?? SWING.mine;
      pose = swingPose(this.swing.kind, this.swing.t / dur);
      if (this.swing.t >= dur) this.swing = null;
    }

    // walking sway — a figure-eight, damped so standing still is dead still
    this.bob += dt * (state.moving ? 9 : 2.5);
    const amp = state.moving ? 1 : 0.15;
    const bobX = Math.sin(this.bob) * 0.012 * amp;
    const bobY = Math.abs(Math.cos(this.bob)) * 0.014 * amp;

    this.root.position.set(
      REST.x + bobX - pose.yaw * 0.1,
      REST.y - bobY - pose.pitch * 0.12,
      REST.z + pose.push,
    );
    this.root.rotation.set(REST.pitch + pose.pitch, REST.yaw + pose.yaw, REST.roll + pose.roll);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // Second render pass: wipe depth so the viewmodel is never occluded by the
  // wall the player is pressed against. Must run AFTER the world render.
  render(renderer) {
    if (!this.visible || !this.root.visible) return;
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAuto;
  }

  dispose() {
    if (this.tool) disposeGroup(this.tool);
    if (this.hand) disposeGroup(this.hand);
  }
}
```

### D3. main.js — wire it up

Import at the top of `src/main.js` alongside the other model imports:

```js
import { Viewmodel } from './viewmodel.js';
```

In the constructor, right after the camera is created (`src/main.js:53`):

```js
    this.viewmodel = new Viewmodel(this);
```

In the resize handler at `src/main.js:126-127`, add:

```js
      this.viewmodel.onResize();
```

In `frame()`, replace the final render line:

```js
    this.lights.update(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.viewmodel.render(this.renderer);
```

In `update(dt)`, right after `this.player.update(dt);`:

```js
    // the viewmodel tracks the hotbar selection and the player's own motion
    const held = this.player.heldItem();
    this.viewmodel.setItem(held?.id ?? null);
    this.viewmodel.update(dt, {
      moving: this.player.onGround && (this.player.vel.x ** 2 + this.player.vel.z ** 2) > 0.6,
      mining: !!this.player.miningHeld && !!this.player.mineTarget,
    });
```

> `heldItem()` returns the inventory slot object. Confirm the id field name by reading `Inventory.selectedItem()` in `src/inventory.js` and use whatever it actually is (`.id` or `.item`) — do not guess.

In `onPrimary()` at `src/main.js:715`, after the enemy hit lands, and again after the critter hit at `src/main.js:729`, add:

```js
        this.viewmodel.startSwing('attack');
```

Hide the viewmodel whenever a full-screen UI is open. In `openScreen` (`src/main.js:661` area) set `this.viewmodel.visible = false;` and restore `this.viewmodel.visible = true;` in `hud.closeAll()`'s caller / the escape path that returns to `state === 'play'`.

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: `test/viewmodel.test.js` PASSES (4 new tests).

- [ ] **Step 3: Verify in the browser**

Start the dev server (`.claude/launch.json` config `infections-wake`, port 5199), boot `?scenario=tooled`, and confirm:
- a tool is visible in the lower right and changes when you scroll the hotbar
- holding LMB on a block loops a chop
- clicking an enemy plays the faster slash
- standing against a wall does NOT clip the tool away
- the tool is still lit at night

Screenshot it.

- [ ] **Step 4: Commit**

```bash
git add src/viewmodel.js src/main.js test/viewmodel.test.js
git commit -m "feat: first-person held-tool viewmodel with mine and attack swings"
```

---

## Task E — Your own body, visible when you look down

**Files:**
- Modify: `src/models.js` (add `buildPlayerMesh`), `src/main.js` (spawn + per-frame sync)
- Test: `test/models.test.js`

### E1. Write the failing test

Append to `test/models.test.js`:

```js
test('the player body exposes named parts and swingable legs', () => {
  const { group, parts, limbs } = buildPlayerMesh();
  assert.ok(group.isObject3D);
  assert.ok(parts.head && parts.head.isObject3D, 'head is addressable so first-person can hide it');
  assert.equal(parts.arms.length, 2, 'both arms are addressable');
  assert.equal(limbs.legs.length, 2, 'two legs to swing');
});

test('the player body head sits below eye height so it never fills the camera', () => {
  const { parts } = buildPlayerMesh();
  // PLAYER.eye is 1.55; the head centre must sit under it
  assert.ok(parts.head.position.y < 1.55, `head at ${parts.head.position.y} must clear the eye`);
});
```

### E2. models.js — build the body

Append after `buildToolMesh`:

```js
// ---------------------------------------------------------------------------
// The player's own body. Rendered in the WORLD scene at the player's feet, with
// the head and arms hidden in first person — that is what makes looking down
// show your legs and torso instead of empty air. Origin: centre-bottom.
// ---------------------------------------------------------------------------

export function buildPlayerMesh() {
  const g = new THREE.Group();
  const coat = lambert(0x4a5240);       // field jacket
  const coatDark = lambert(0x3a4132);
  const trouser = lambert(0x3d3a34);
  const boot = lambert(0x241f1a);
  const skin = lambert(0x8a6a52);
  const limbs = { legs: [], arms: [] };

  for (const sx of [-1, 1]) {
    const leg = box(g, 0.15, 0.72, 0.17, trouser, sx * 0.11, 0.4, 0);
    limbs.legs.push(limbRec(leg));
    box(g, 0.17, 0.1, 0.22, boot, sx * 0.11, 0.05, 0.02);
  }
  box(g, 0.42, 0.6, 0.24, coat, 0, 1.06, 0);            // torso
  box(g, 0.44, 0.12, 0.26, coatDark, 0, 1.3, 0);        // shoulder yoke
  box(g, 0.2, 0.22, 0.12, coatDark, 0, 0.95, 0.15);     // chest pouch
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = box(g, 0.12, 0.54, 0.14, coat, sx * 0.27, 1.05, 0);
    limbs.arms.push(limbRec(arm));
    arms.push(arm);
    box(g, 0.12, 0.1, 0.14, skin, sx * 0.27, 0.75, 0);  // hand
  }
  const head = box(g, 0.26, 0.26, 0.26, skin, 0, 1.49, 0);
  box(g, 0.28, 0.1, 0.28, coatDark, 0, 1.62, 0);        // cap
  head.add(box(new THREE.Group(), 0, 0, 0, skin));      // no-op keeps head a Group-safe parent

  return { group: g, parts: { head, arms, torso: g.children[4] }, limbs };
}
```

> Delete the `head.add(box(...))` no-op line — it is a placeholder that does nothing. The head is already a `Mesh`, which is a valid `Object3D`.

### E3. main.js — attach and drive the body

In `setupWorld` (near where `roaneMesh` is built), add:

```js
    // the player's own body, so looking down shows legs instead of nothing
    if (this.playerBody) { this.scene.remove(this.playerBody.group); disposeGroup(this.playerBody.group); }
    this.playerBody = buildPlayerMesh();
    // first person: the head and arms would fill the camera / clip through it.
    // The viewmodel supplies the arms you actually see.
    this.playerBody.parts.head.visible = false;
    for (const a of this.playerBody.parts.arms) a.visible = false;
    this.playerBody.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(this.playerBody.group);
```

Import `buildPlayerMesh` from `./models.js`.

In `update(dt)`, after the viewmodel block:

```js
    // body follows the player; only yaw (pitch would tip your own legs)
    if (this.playerBody) {
      const b = this.playerBody;
      b.group.position.set(this.player.pos.x, this.player.pos.y, this.player.pos.z);
      b.group.rotation.y = this.player.yaw;
      const spd = Math.hypot(this.player.vel.x, this.player.vel.z);
      this._bodyPhase = (this._bodyPhase || 0) + spd * dt * 2.2;
      const swing = Math.sin(this._bodyPhase) * Math.min(0.6, spd * 0.12);
      b.limbs.legs[0].mesh.rotation.x = b.limbs.legs[0].rest + swing;
      b.limbs.legs[1].mesh.rotation.x = b.limbs.legs[1].rest - swing;
    }
```

- [ ] **Step 1: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 2: Verify in the browser**

Boot the game, look straight down. You must see your own torso and legs, and they must swing as you walk. Confirm the body never blocks the crosshair when looking forward.

- [ ] **Step 3: Commit**

```bash
git add src/models.js src/main.js test/models.test.js
git commit -m "feat: the player has a body you can see when you look down"
```

---

## Task F — Particles for block breaks and enemy deaths

**Files:**
- Create: `src/particles.js`, `test/particles.test.js`
- Modify: `src/main.js` (construct, update, break hook, kill hook), `src/infected.js` (`die`)

### F1. Write the failing test

Create `test/particles.test.js`:

```js
// The pool math is pure so it runs headless. Particles class construction needs
// a THREE.Scene only, which is Node-safe (no WebGLRenderer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { stepParticle, Particles, PARTICLE_MAX } from '../src/particles.js';

test('a particle falls, slows and expires', () => {
  const p = { x: 0, y: 10, z: 0, vx: 2, vy: 0, vz: 0, ttl: 1, life: 1 };
  stepParticle(p, 0.1);
  assert.ok(p.y < 10, 'gravity pulls it down');
  assert.ok(p.vx < 2 && p.vx > 0, 'horizontal drag bleeds speed without reversing it');
  assert.ok(Math.abs(p.ttl - 0.9) < 1e-9);
});

test('a particle stops falling below its ttl', () => {
  const p = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, ttl: 0.05, life: 1 };
  stepParticle(p, 0.1);
  assert.ok(p.ttl <= 0, 'expired');
});

test('the pool recycles instead of growing', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  for (let i = 0; i < PARTICLE_MAX * 3; i++) fx.spawn(0, 0, 0, 0xffffff, {});
  assert.ok(fx.live.length <= PARTICLE_MAX, `pool capped at ${PARTICLE_MAX}, got ${fx.live.length}`);
});

test('a burst emits many particles at once and they all expire', () => {
  const scene = new THREE.Scene();
  const fx = new Particles(scene);
  fx.burstBlock(3, 4, 5, 0x7f8a6a);
  assert.ok(fx.live.length >= 8, `a break should throw a visible spray, got ${fx.live.length}`);
  for (let i = 0; i < 200; i++) fx.update(0.05);   // 10 seconds
  assert.equal(fx.live.length, 0, 'everything expires — no leak');
});

test('a death burst is bigger than a block break', () => {
  const scene = new THREE.Scene();
  const a = new Particles(scene); a.burstBlock(0, 0, 0, 0x888888);
  const b = new Particles(scene); b.burstDeath({ x: 0, y: 0, z: 0 }, 0x8a4a5a, 1);
  assert.ok(b.live.length > a.live.length, 'a death reads louder than a mined block');
});
```

- [ ] **Step 1: Run to verify it fails**

Run: `node --test test/particles.test.js 2>&1 | tail -20`
Expected: FAIL — `src/particles.js` does not exist.

### F2. Create `src/particles.js`

```js
import * as THREE from 'three';

// ============================================================================
// Pooled particle system.
//
// One InstancedMesh of small cubes, allocated ONCE. On a streamed 16k world
// every per-hit allocation shows up as a GC hitch during combat, so nothing
// here allocates after construction: dead slots are recycled and expired
// instances are scaled to zero rather than removed.
//
// Cubes (not sprites) on purpose — the game is voxel-shaded, and a shard of a
// broken block should look like a small piece of that block.
// ============================================================================

export const PARTICLE_MAX = 512;
const GRAVITY = 18;
const DRAG = 3.2;

// Integrate one particle. Pure — unit-tested headlessly.
export function stepParticle(p, dt) {
  p.ttl -= dt;
  p.vy -= GRAVITY * dt;
  const k = Math.max(0, 1 - DRAG * dt);
  p.vx *= k; p.vz *= k;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  return p.ttl > 0;
}

export class Particles {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, PARTICLE_MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;   // particles live wherever the action is
    this.mesh.count = PARTICLE_MAX;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.live = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < PARTICLE_MAX; i++) this.mesh.setMatrixAt(i, this._hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // opts: { spread, up, size, life }
  spawn(x, y, z, color, opts = {}) {
    if (this.live.length >= PARTICLE_MAX) this.live.shift();   // oldest yields its slot
    const spread = opts.spread ?? 2.6;
    const life = opts.life ?? (0.5 + Math.random() * 0.5);
    this.live.push({
      x, y, z,
      vx: (Math.random() - 0.5) * spread,
      vy: (opts.up ?? 3) * (0.55 + Math.random() * 0.9),
      vz: (Math.random() - 0.5) * spread,
      ttl: life, life,
      size: opts.size ?? (0.05 + Math.random() * 0.05),
      color,
      spin: (Math.random() - 0.5) * 9,
      rot: Math.random() * 6.28,
    });
  }

  // Shards of a block the player just finished mining.
  burstBlock(x, y, z, color) {
    for (let i = 0; i < 14; i++) {
      this.spawn(x + 0.5 + (Math.random() - 0.5) * 0.7, y + 0.35 + Math.random() * 0.5,
        z + 0.5 + (Math.random() - 0.5) * 0.7, color, { spread: 2.4, up: 2.6, size: 0.06 + Math.random() * 0.05 });
    }
  }

  // An infected coming apart: body-coloured chunks plus a slow spore drift.
  burstDeath(pos, color, scale = 1) {
    const n = Math.round(22 * scale);
    for (let i = 0; i < n; i++) {
      this.spawn(pos.x + (Math.random() - 0.5) * 0.5 * scale, pos.y + 0.5 * scale + Math.random() * 0.6 * scale,
        pos.z + (Math.random() - 0.5) * 0.5 * scale, color,
        { spread: 3.4 * scale, up: 3.6, size: (0.05 + Math.random() * 0.07) * scale, life: 0.6 + Math.random() * 0.6 });
    }
    for (let i = 0; i < 10; i++) {     // spores hang in the air
      this.spawn(pos.x + (Math.random() - 0.5) * 0.8, pos.y + 0.7 * scale, pos.z + (Math.random() - 0.5) * 0.8,
        0xb5c98a, { spread: 0.7, up: 0.5, size: 0.035, life: 1.4 + Math.random() });
    }
  }

  // A small spark where a hit landed.
  burstHit(pos, color) {
    for (let i = 0; i < 7; i++)
      this.spawn(pos.x, pos.y + 1, pos.z, color, { spread: 2.2, up: 2, size: 0.04, life: 0.3 });
  }

  update(dt) {
    let w = 0;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      p.rot += p.spin * dt;
      if (stepParticle(p, dt)) this.live[w++] = p;
    }
    this.live.length = w;
    if (!this.mesh.setMatrixAt) return;   // safety for stub scenes
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      const fade = Math.min(1, p.ttl / (p.life * 0.4));   // shrink out over the last 40%
      this._v.set(p.x, p.y, p.z);
      this._q.setFromAxisAngle(AXIS, p.rot);
      this._s.setScalar(p.size * fade);
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      this._c.setHex(p.color);
      this.mesh.setColorAt(i, this._c);
    }
    for (let i = this.live.length; i < PARTICLE_MAX; i++) this.mesh.setMatrixAt(i, this._hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.live.length = 0;
  }
}

const AXIS = new THREE.Vector3(0.4, 0.8, 0.45).normalize();
```

> `setColorAt` allocates `instanceColor` lazily on first call — that is a one-time allocation at startup, not per frame. Move the `AXIS` const above the class if the linter objects to use-before-define; it is only read inside `update()`, which cannot run before module evaluation finishes.

### F3. main.js — wire the emitters

Import and construct after the scene exists:

```js
import { Particles } from './particles.js';
// ...
    this.particles = new Particles(this.scene);
```

In `update(dt)`, next to `this.updateEffects(dt);`:

```js
    this.particles.update(dt);
```

In `breakBlock` (`src/main.js:908`), right before/after `this.audio.breakBlock();` at `src/main.js:945` (the path that actually removes a block), add:

```js
      const bdef = BLOCKS[id];
      const bcol = Array.isArray(bdef?.col) ? bdef.col[0] : (bdef?.col ?? 0x8a8f96);
      this.particles.burstBlock(x, y, z, bcol);
```

> Read `breakBlock` first and place this where the block id is still known (before the world write), on **every** branch that destroys a block. Use the local variable name that holds the id in that scope.

In `onInfectedKilled(inf)` (`src/main.js:1558`):

```js
    this.particles.burstDeath(inf.pos, inf.s.color, inf.s.scale);
```

In `onPrimary`, after `enemy.takeHit(...)`:

```js
        this.particles.burstHit(enemy.pos, 0xc9524a);
```

Add `particles: { burstBlock() {}, burstDeath() {}, burstHit() {}, update() {} }` to `makeStubGame` in `test/helpers.js` so headless sims that call these hooks keep working.

- [ ] **Step 1: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS (5 new tests).

- [ ] **Step 2: Verify in the browser**

Mine a block — coloured chunks spray out. Kill an infected — a bigger burst in the strain colour plus drifting green spores. Kill several at once and confirm the frame time does not spike (the pool caps at 512).

- [ ] **Step 3: Commit**

```bash
git add src/particles.js src/main.js test/particles.test.js test/helpers.js
git commit -m "feat: pooled particle system for block breaks, hits and enemy deaths"
```

---

## Task G — Dropped items read as pickups

**Files:** Modify `src/main.js:2233-2280` (`updatePickups`)

Dropped items already bob and spin (`src/main.js:2236-2240`) — but only when `!pk.grounded`, and the amplitude is small. Grounded ground-litter (sticks, stones, fiber) lies flat **on purpose** and must keep doing so.

- [ ] **Step 1: Raise the amplitude of the existing bob and add a slow sway to litter**

Replace `src/main.js:2236-2240`:

```js
      pk.bob += dt * 2;
      if (!pk.grounded) {          // dropped items float and turn
        pk.mesh.position.y = pk.y + 0.06 + Math.sin(pk.bob) * 0.14;
        pk.mesh.rotation.y += dt * 1.4;
      } else {                     // scatter litter lies still, but catches the eye
        pk.mesh.rotation.y = (pk.rotBase ??= Math.random() * 6.28) + Math.sin(pk.bob * 0.5) * 0.06;
      }
```

- [ ] **Step 2: Verify in the browser** — break a block and confirm the drop floats and turns visibly. Confirm sticks/stones on the ground still lie flat.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: dropped items float and turn so they read as pickups"
```

---

## Task H — A bigger refuge with a cleared 10-block radius

**Files:**
- Modify: `src/world.js:1032-1071` (`placeStartRefuge`)
- Test: `test/world.test.js`

**Constraints (both are enforced by existing tests — do not break them):**
1. The emergency pad cell `(spawn.x + 1, surf + 1, spawn.z + 1)` must stay clear of blocks (see `test/scenarios.test.js`).
2. `world.pickups` is index-stable and its indices are persisted in saves as `pickupsTaken`. **Do not add, remove or reorder entries.** Clear vegetation *blocks* only.

### H1. Write the failing tests

Append to `test/world.test.js` (match the file's existing world-construction helper — read the top of the file and reuse it rather than inventing a new rig):

```js
// ---------------- starting refuge (2026-08-17) ----------------

test('the refuge is cleared of trees for 10 blocks in every direction', () => {
  for (const seed of ['refuge-a', 'refuge-b', 'refuge-c']) {
    const w = buildFullWorld(seed);          // reuse this file's existing full-world helper
    const s = w.poi.spawn;
    for (let dx = -10; dx <= 10; dx++)
      for (let dz = -10; dz <= 10; dz++) {
        if (Math.hypot(dx, dz) > 10) continue;
        const x = Math.floor(s.x) + dx, z = Math.floor(s.z) + dz;
        for (let y = 0; y < WORLD.HEIGHT; y++) {
          const id = w.get(x, y, z);
          assert.notEqual(id, B.LOG, `log at ${x},${y},${z} (seed ${seed})`);
          assert.notEqual(id, B.LEAVES, `leaves at ${x},${y},${z} (seed ${seed})`);
        }
      }
  }
});

test('the refuge shack is 9x9 and stands 4 high', () => {
  const w = buildFullWorld('refuge-a');
  const s = w.poi.spawn;
  const sx = Math.floor(s.x), sz = Math.floor(s.z), surf = s.y - 1;
  // north wall runs the full 9-block span
  let wall = 0;
  for (let x = sx - 4; x <= sx + 4; x++) if (w.get(x, surf + 1, sz - 4) !== B.AIR) wall++;
  assert.ok(wall >= 8, `north wall should span the shack, found ${wall} solid cells`);
  assert.notEqual(w.get(sx - 4, surf + 4, sz - 4), B.AIR, 'walls stand 4 high');
});

test('the emergency recovery pad cell stays clear inside the bigger shack', () => {
  const w = buildFullWorld('refuge-a');
  const e = w.poi.emergency;
  assert.equal(w.get(e.x, e.y, e.z), B.AIR, 'the pad cell must be empty');
});

test('growing the refuge does not disturb the index-stable pickup list', () => {
  const a = buildFullWorld('refuge-a');
  const b = buildFullWorld('refuge-a');
  assert.equal(a.pickups.length, b.pickups.length, 'worldgen stays deterministic');
  assert.ok(a.pickups.length > 0);
});
```

- [ ] **Step 1: Run to verify it fails**

Run: `node --test test/world.test.js 2>&1 | tail -20`
Expected: FAIL — trees remain within 10 blocks and the shack is 5×5.

### H2. world.js — grow the shack and sweep the clearing

Replace `src/world.js:1032-1071` entirely:

```js
  // Starting refuge: a ruined shack holding the one-time emergency recovery
  // pad (§13.2 — it protects the first learning cycle only), standing in a
  // cleared glade. Runs AFTER placeTrees(), so the sweep can simply delete the
  // canopy that landed here. NOTE: it must never touch this.pickups — those
  // indices are persisted in saves as `pickupsTaken`.
  placeStartRefuge() {
    const sx = Math.floor(CORE_X * 0.28);
    const sz = Math.floor(CORE_Z * 0.28);
    const CLEAR_R = 10;   // glade radius the kid asked for: nothing standing within 10
    const PAD = 5;        // flattened building pad half-width (9x9 shack + 1 margin)

    // flatten an 11x11 pad
    let acc = 0, n = 0;
    for (let x = sx - PAD; x <= sx + PAD; x++)
      for (let z = sz - PAD; z <= sz + PAD; z++) { acc += this.surfaceY(x, z); n++; }
    const surf = Math.round(acc / n);
    for (let x = sx - PAD; x <= sx + PAD; x++)
      for (let z = sz - PAD; z <= sz + PAD; z++) {
        for (let y = surf + 1; y <= surf + 8; y++) this._set(x, y, z, B.AIR);
        this._set(x, surf, z, B.GRASS);
        for (let y = surf - 3; y < surf; y++) if (this.get(x, y, z) === B.AIR) this._set(x, y, z, B.DIRT);
      }

    // the glade: strip every trunk, canopy and loose boulder in a 10-block
    // disc so the shack is never buried in forest
    for (let x = sx - CLEAR_R; x <= sx + CLEAR_R; x++)
      for (let z = sz - CLEAR_R; z <= sz + CLEAR_R; z++) {
        if (Math.hypot(x - sx, z - sz) > CLEAR_R) continue;
        const top = this.surfaceY(x, z);
        for (let y = top; y < WORLD.HEIGHT; y++) {
          const id = this.get(x, y, z);
          if (id === B.LOG || id === B.LEAVES) this._set(x, y, z, B.AIR);
        }
      }

    // shack: 9x9 timber walls, 4 high, doorway south, half-collapsed corner
    const x0 = sx - 4, z0 = sz - 4, x1 = sx + 4, z1 = sz + 4;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const isWall = x === x0 || x === x1 || z === z0 || z === z1;
        if (!isWall) continue;
        for (let y = 1; y <= 4; y++) {
          // collapsed corner (weathered opening the player must repair)
          if (x >= x1 - 1 && z >= z1 - 1 && y > 1) continue;
          this._set(x, surf + y, z, B.WOOD_WALL);
        }
      }
    // doorway, 2 wide (open — the player learns to craft doors)
    for (const dx of [0, 1]) {
      this._set(sx + dx, surf + 1, z0, B.AIR);
      this._set(sx + dx, surf + 2, z0, B.AIR);
    }
    // a shuttered window on the west wall so the interior is not a black box
    for (const dz of [-1, 0, 1]) this._set(x0, surf + 2, sz + dz, B.AIR);
    // partial roof
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        if ((x + z) % 3 !== 0) this._set(x, surf + 5, z, B.PLANK);
    // furnishings — the pad cell (sx+1, sz+1) stays deliberately empty
    this._set(sx - 2, surf + 1, sz + 2, B.BENCH);
    this._set(sx + 2, surf + 1, sz, B.RADIO);
    this._set(sx - 3, surf + 1, sz - 3, B.CHEST);
    this.poi.spawn = { x: sx + 0.5, y: surf + 1, z: sz + 0.5 };
    this.poi.emergency = { x: sx + 1, y: surf + 1, z: sz + 1 };
  }
```

> Verify `B.CHEST` exists in `src/config.js` before using it (the gallery lists a `chest` prop). If the id is named differently, use the real name or drop that line — do **not** invent a block id.

> `WORLDGEN.oreHills.clearance` is 26 and the avoid list already includes `[0.28, 0.28]`, so a hill can never land inside the new 10-block glade. No change needed there.

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS. If `test/scenarios.test.js` fails on the emergency-pad assertion, the furnishing placement is wrong — fix the furnishings, not the test.

- [ ] **Step 3: Verify in the browser** — start a new game and confirm you spawn in a roomy shack standing in an open glade.

- [ ] **Step 4: Commit**

```bash
git add src/world.js test/world.test.js
git commit -m "feat: bigger start refuge standing in a cleared 10-block glade"
```

---

## Task I — Full verification

- [ ] **Step 1: Full suite**

Run: `npm test 2>&1 | tail -15`
Expected: all tests pass. Baseline was 195; this plan adds roughly 22 (6 knockback, 5 models, 4 viewmodel, 5 particles, 4 world).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build, no unresolved imports.

- [ ] **Step 3: Play-test the scenarios**

Boot `?scenario=tooled`, `?scenario=ironage` and `?scenario=boss`. Confirm:
- the held tool is visible and swings for both mining and attacking
- hitting a drifter with a bare hand pushes it back a noticeable fraction of a block; hitting with a blade pushes it about half a block, and it visibly staggers
- a Runner cannot walk through its own stagger
- a boss does not budge
- enemies' legs swing while walking and they flinch red when hit
- blocks throw shards, deaths throw a burst
- looking down shows your legs

- [ ] **Step 4: Screenshot** the viewmodel, a death burst and the new refuge for the record.

---

## Self-Review Notes

- **Spec coverage:** knockback → Task A; hands + held tool → Task D; body when looking down → Task E; tool/weapon models → Task C; enemy walk/lunge/flinch → Task B; block-break particles → Task F; enemy-death particles → Task F; item spin/bob → Task G; bigger refuge + 10-block clearing → Task H. Third-person camera is **deliberately out of scope** per the 2026-08-17 decision.
- **Naming consistency check:** `COMBAT.kbStun` / `COMBAT.kbCutoff` / `COMBAT.flinchT` (A2) are consumed in A4/B4/B5. `Infected.stunT`, `.flinchT`, `.walkPhase`, `.limbs` declared in A3/B3, consumed in A4/B4. `limbRec()` (B2) is reused by `buildPlayerMesh` (E2). `buildToolMesh` (C2) is consumed by `buildGroundItem` (C3), `Viewmodel.setItem` (D2) and the gallery (C4). `stepParticle`/`Particles`/`PARTICLE_MAX` (F2) match the test imports (F1).
- **Known judgement calls flagged for the user:** (1) ground-scatter pickups near the refuge are kept, because removing them would shift the index-stable `world.pickups` array and corrupt `pickupsTaken` in existing saves; (2) `heldItem()`'s id field name must be read from `src/inventory.js` rather than assumed; (3) the exact per-strain limb wrapping in B2 is spelled out for four strains and described for the rest — the implementer must read each branch.
