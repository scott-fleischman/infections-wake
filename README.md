# Infection's Wake

A 3D voxel survival sandbox in the browser. Begin as a scavenger in a ruined
valley, build an industrial refuge — and learn that every fire, lamp, drill,
and generator you run makes you *louder* to a blind bacterial ecology that
hunts by heat, breath, blood, vibration, electrical current, and exposed metal.

This is the **full campaign** defined in
[`Infections_Wake_Spec_v2_3D.md`](Infections_Wake_Spec_v2_3D.md): primitive →
iron → steel & electricity → regional containment. Restore the buried transit
line, survive its startup siege, descend into the Lazarus Deep Site, open the
three purge galleries, and silence the reservoir — then keep playing into the
reclamation endgame at a fixed maximum enemy tier.

**Latest build** (the huge-world update): the valley now sits inside a
**16,384×16,384-block streamed world** — walk in any direction and new
forests, lakes, caves, infected nests, and finite walk-in **ore hills**
generate around you, chunk by chunk, out to a containment rim of mountains at
the edge of the region. The hand-authored story valley (0..192) is generated
whole and never unloads, so every campaign site behaves exactly as before;
the wilderness is deterministic per seed (leave and return — same hills, same
trees) and saves stay tiny (seed + your edits). Everything from the wishlist
update is still here: 30-minute days in two 15-minute halves, melee
**knockback** both ways, **only machine eaters break blocks — and only
machine blocks**, Vintage-Story-style **click-to-move inventory**, **3×3 grid
crafting**, the searchable **Handbook `[H]`**, procedurally **textured
blocks**, sun shadows, ACES tone mapping, and the gradient sky with sun,
moon, and stars.

## Run it

```bash
npm install
npm run dev      # then open http://localhost:5173
npm test         # headless test suite (node --test, no browser needed)
```

Chromium-based browsers and Firefox work; WebGL required.

**Play online:** every push to `main` deploys the game to GitHub Pages
(`.github/workflows/deploy.yml` — tests must pass first):
<https://scott-fleischman.github.io/infections-wake/>

**Play offline on Windows 10:** `npm run dist:win` produces a self-contained
`Infections-Wake-Windows/` folder (built game + a zero-dependency local
server). Copy or zip it to any Windows 10 machine and double-click
`Play-InfectionsWake.bat` — it serves the game locally and opens your browser.
It uses Node.js if present, otherwise a pure PowerShell server that ships with
Windows, so **nothing needs to be installed**. (A local server is required
because ES-module browser games can't run from a `file://` page.) The launcher
sources live in `windows/`; the assembler is `scripts/build-windows-dist.mjs`.

**Model archive:** `/gallery.html` (linked from the start menu) is a viewer
for every model in the game — machines, infected specimens, blocks, ground
litter, item icons, seeded tree generation, wild **ore-hill landforms**, and
an **atmosphere deck** (the game's sky dome at dawn, noon, dusk and night) —
rendered with the exact same builders, texture atlas, tone mapping and
shadows the game uses (`src/models.js`, `treeShape()`, `oreHillShape()`,
`sky.js`), on a drag-to-rotate turntable under a camera-tracking studio rig.

**Field manual:** `/docs.html` renders this README, the full design spec, and
the original project input in the browser (no innerHTML — a small markdown
renderer in `src/markdown.js`), with a PLAY NOW link back to the game.

**Dev scenarios:** the start menu's DEV SCENARIOS strip (or
`?scenario=<tooled|miner|fortified|frontier|ironage|powered|lab|boss|steel|transit|deepsite|endgame>[&seed=…]`)
jumps to a story checkpoint with a matching world — tools granted, machines
placed and fueled, campaign flags set, player teleported. Scenario links never
overwrite a real save; that takes an explicit menu click.

## Controls

| Input | Action |
| --- | --- |
| WASD / mouse | Move / look (click to capture the mouse) |
| Space / Shift | Jump / sprint |
| LMB (hold) | Break block (crosshair ring fills) / attack |
| RMB | Place block / eat / use item |
| 1–6, Q | Select hotbar slot |
| E | Field kit — click an item, click where it goes; 3×3 craft grid + quick craft |
| H | Handbook — every recipe drawn as its grid pattern, searchable, with auto-arrange |
| F | Interact — doors, machines, archives, beds, campfires, valves, the radio |
| J | Story Log & bestiary |
| M | Valley map — marks appear as you survey |
| Esc | Pause (accessibility options live here) |

## How to survive

1. **Day 1:** grab loose stones, sticks, and fiber. Craft tools, chop wood,
   wall up the ruined shack. The forecast panel warns you at dusk.
2. **Night:** one major assault per night. Its composition answers whatever
   signature you broadcast loudest — blood draws runners, current draws
   machine eaters. Your walls and doors hold: **only machine eaters can break
   blocks, and only machine blocks** (machines and cables). Climbers still
   climb, spitters still arc over, burrowers still push through loose soil —
   the threat moved from your walls to your gaps.
3. **Iron:** find an **ore hill** — stone mounds with ore showing on their
   flanks and a chamber inside; every deposit is finite, so mine it out and
   move on (drills parked on a deposit eat through it too). Smelt at a
   furnace. Iron opens the field beacon (a rebuildable recovery point),
   weapons, plating, and the power tier: generator, cables, lamps, drill,
   turret. Discovered hills are marked on the map `[M]`.
4. **Mind the ladder:** the shack's emergency pad recovers you **once**.
   A field beacon needs power, registration, and a biotic ampoule — and it
   must be powered *at the moment you die*. If every layer is gone, the run
   fails.
5. **The lab:** a buried Project Lazarus annex holds three archive fragments.
   Cataloging them updates the bestiary, unlocks signature instruments, and
   assembles the story of the First Wake. A collapsed service tunnel offers a
   quieter way in for those who look.
6. **The colony:** somewhere underground, a mineralized colony host seals a
   rich iron seam. Purging it changes the place — and drops what beacons need.
7. **Steel:** an industrial ruin's kiln is fused shut with living tissue.
   Purge the kiln host and steel smelts at scale — batteries, switches,
   sensors, vibration turrets, and the Lazarus Cradle open up. Filtration
   (scrubbers, UV, field sterilizers) is recovered from the flooded annex,
   where a pump organism holds the drowned gallery.
8. **The transit line:** a hardened relay station on the north plains still
   holds rail pressure. Two control relays, one filtration cartridge, 8 kW to
   the intake — and a startup loud enough that everything in the valley
   answers. Hold the platform.
9. **The Deep Site:** ride the rail down with portable power and filtration.
   Three purge valves, in sequence: heat regulation fails (everything warm
   becomes a torch), sterilant floods the galleries (power down or lose your
   electronics), then the reservoir floods. What remains is Reservoir
   Viability — burn it out while the vault answers back.
10. **Reclamation:** the purge halves regional pressure permanently and enemy
    tiers stay capped. Two secondary reservoirs remain on the map for field
    sterilizers, and someone on a ridge keeps broadcasting.

Sanity is purely a liability. Darkness, night exposure, and spores erode it;
below 25 you'll see enemies that were never there (one verified hit dispels
them), hear alarms your voltmeter contradicts, and shed enough of a signature
to draw daytime attention. Sleep, light, and suppressants restore it.

## Architecture

Systems map 1:1 onto the spec's module list (§23):

| File | System |
| --- | --- |
| `src/config.js` | All data-driven tunables: blocks, items, recipes (with grid patterns), machines, strain sense profiles, threat compositions (§22) |
| `src/crafting.js` | Grid-crafting matcher: translation-invariant pattern matching + consumption (pure, headless-tested) |
| `src/world.js` | Streamed chunk world: pinned story core + deterministic position-hashed wilderness (terrain, caves, veins, trees, nests, ore hills), budgeted per-frame gen/mesh/evict, meshing with AO + sky-light shading + texture-atlas UVs |
| `src/textures.js` | Runtime canvas texture atlas — neutral-luminance tiles multiplied over the vertex-color light bake |
| `src/sky.js` | Sky dome, sun/moon discs, starfield |
| `src/models.js` | Model registry: machine props, infected bodies, block display meshes — shared by game + gallery |
| `src/props.js` | In-world prop lifecycle + animation (turret aim, flywheels, fire flicker) |
| `src/icons.js` | Canvas item-icon painter — shared by HUD + gallery |
| `src/gallery.js` | `/gallery.html` model archive viewer |
| `src/scenarios.js` | Dev checkpoints: story-stage worlds for playtesting |
| `src/map.js` | Valley map `[M]` — earned annotations, body markers, facility diagrams |
| `src/markdown.js` | Markdown → DOM renderer (no innerHTML) for the docs page |
| `src/docs.js` | `/docs.html` field manual (README, spec, project input) |
| `src/player.js` | First-person controller, AABB physics, DDA raycast |
| `src/signature.js` | The signature field — emitters, propagation, sampling (§5) |
| `src/infected.js` | Gradient-following infected AI; three roles + colony host (§12) |
| `src/director.js` | Day/night threat director: forecast, major assault, incursions (§6) |
| `src/power.js` | Generators, wire networks, lamp/drill/turret/beacon (§10) |
| `src/sanity.js` | Purely-negative sanity + hallucination presentation (§7) |
| `src/recovery.js` | Staged death recovery + gravestone retrieval (§13) |
| `src/lore.js` | Archive fragments, Story Log, First Wake synthesis (§15–16) |
| `src/hud.js` / `src/dom.js` | Instrument-panel HUD, menus, forecast display (§20) |
| `src/save.js` | localStorage persistence of world diffs + all system state (§21) |
| `src/main.js` | Game orchestrator, loop, input, interactions |

Boundary rules from §23.1 hold: infected read the world only through the
signature service; the director *requests* spawns that are validated against
sky-exposed routes (nothing appears inside a sealed room); sanity falsifies
presentation only, never simulation state.

## Testing

`npm test` runs 170+ headless tests (Node's built-in runner, no browser):
movement math, worldgen determinism and structure placement (including the
transit station, Deep Site galleries, industrial ruin, flooded annex, and
secondary reservoirs on multiple seeds), signature falloff/wall attenuation,
the power solver (switches, batteries, fuses, player priorities, target-class
rules), the recovery ladder, crafting, the threat director, an integration
test where a machine eater gradient-follows an electrical emitter in pure
Node, every dev scenario applied against real generated terrain, and the
markdown renderer against the actual project documents. The sim layer never
touches the DOM, so most behavior is checkable without playtesting;
the browser is only needed to validate rendering and input.
