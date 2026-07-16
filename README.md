# Infection's Wake

A 3D voxel survival sandbox in the browser. Begin as a scavenger in a ruined
valley, build an industrial refuge — and learn that every fire, lamp, drill,
and generator you run makes you *louder* to a blind bacterial ecology that
hunts by heat, breath, blood, vibration, and electrical current.

This is the playable **vertical slice** defined in
[`Infections_Wake_Spec_v2_3D.md`](Infections_Wake_Spec_v2_3D.md) (§24):
it exists to answer one question — *does a generator make you meaningfully
safer while, for understandable biological reasons, making survival more
dangerous?*

## Run it

```bash
npm install
npm run dev      # then open http://localhost:5173
```

Chromium-based browsers and Firefox work; WebGL required.

## Controls

| Input | Action |
| --- | --- |
| WASD / mouse | Move / look (click to capture the mouse) |
| Space / Shift | Jump / sprint |
| LMB | Mine block / attack |
| RMB | Place block / eat / use item |
| 1–6, Q | Select hotbar slot |
| E | Field kit (inventory + fabrication) |
| F | Interact — doors, machines, archives, beds, campfires |
| J | Story Log & bestiary |
| Esc | Pause |

## How to survive

1. **Day 1:** grab loose stones, sticks, and fiber. Craft tools, chop wood,
   wall up the ruined shack. The forecast panel warns you at dusk.
2. **Night:** one major assault per night. Its composition answers whatever
   signature you broadcast loudest — blood draws runners, current draws
   machine eaters.
3. **Iron:** mine coal + iron in the caves, smelt at a furnace. Iron opens
   the field beacon (a rebuildable recovery point), weapons, plating, and
   the power tier: generator, cables, lamps, drill, turret.
4. **Mind the ladder:** the shack's emergency pad recovers you **once**.
   A field beacon needs power, registration, and a biotic ampoule — and it
   must be powered *at the moment you die*. If every layer is gone, the run
   fails.
5. **The lab:** a buried Project Lazarus annex holds three archive fragments.
   Cataloging them updates the bestiary, unlocks signature instruments, and
   assembles the story of the First Wake.
6. **The colony:** somewhere underground, a mineralized colony host seals a
   rich iron seam. Purging it changes the place — and drops what beacons need.

Sanity is purely a liability. Darkness, night exposure, and spores erode it;
below 25 you'll see enemies that were never there (one verified hit dispels
them), hear alarms your voltmeter contradicts, and shed enough of a signature
to draw daytime attention. Sleep, light, and suppressants restore it.

## Architecture

Systems map 1:1 onto the spec's module list (§23):

| File | System |
| --- | --- |
| `src/config.js` | All data-driven tunables: blocks, items, recipes, machines, strain sense profiles, threat compositions (§22) |
| `src/world.js` | Chunked voxel world, generation, meshing with AO + sky-light shading |
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
