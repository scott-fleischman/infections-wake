import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { B, B_NAME, BLOCKS, ITEMS, STRAINS, MACHINES, TIME, WORLDGEN } from './config.js';
import { buildProp, buildInfectedMesh, buildBlockMesh, buildGroundItem, animateProp, disposeGroup } from './models.js';
import { treeShape, oreHillShape } from './world.js';
import { Sky } from './sky.js';
import { RNG } from './rng.js';
import { makeIcon } from './icons.js';
import { itemDef } from './inventory.js';
import { el, clear } from './dom.js';

const $ = (id) => document.getElementById(id);

// ============================================================================
// Model archive: every prop, specimen, block, item and tree in one viewer.
// Reuses the exact builders the game renders with (models.js / world.js).
// ============================================================================

// ---------- catalog ----------

const fmtEmits = (e) => e ? Object.entries(e).map(([k, v]) => `${k} ${v}`).join(' · ') : '—';

const MACHINE_ENTRIES = [
  { key: 'generator', name: 'Fuel generator', kind: 'generator', desc: 'Burns coal into 12 kW. Its heat, vibration and electrical field carry over 40 blocks — a running generator is the loudest thing you own.' },
  { key: 'drill', name: 'Mining drill', kind: 'drill', desc: 'Chews an adjacent ore body into its buffer. Steady vibration; vibration-sensitive strains follow it home.' },
  { key: 'turret', name: 'Warm-body turret', kind: 'turret', desc: 'Tracks warm bodies with true line of sight. Heat per shot; blind behind walls.' },
  { key: 'lamp', name: 'Powered lamp', kind: 'lamp', desc: 'Steady light that slows sanity loss at night — and a small electrical signature that never sleeps.' },
  { key: 'beacon', name: 'Field recovery beacon', kind: 'beacon', desc: 'Registered + powered + charged, it catches you at the moment of death. Power loss at the wrong moment is your problem.' },
  { key: 'cradle', name: 'Lazarus cradle', kind: 'cradle', desc: 'Full continuity of consciousness. Steel-tier; the valley has not seen a working one in years.' },
  { key: 'bench', name: 'Crafting bench', kind: 'bench', desc: 'Fabrication surface. Everything past stone tools starts here.' },
  { key: 'furnace', name: 'Furnace', kind: 'furnace', desc: 'Smelts raw iron; cooks meat. A burning furnace is warm — warmth is a signature.' },
  { key: 'campfire', name: 'Campfire', kind: 'campfire', desc: 'Cooking, warmth, morale. Emits heat and light all night. Everything that emits is a beacon.' },
  { key: 'torch', name: 'Torch', kind: 'torch', desc: 'Cheap light, small heat. Cheap enough to line a perimeter — noticeable enough to matter.' },
  { key: 'door', name: 'Door (closed)', kind: 'door', opts: {}, desc: 'Blocks bodies and blunts your signature. Drifters batter it; keep a spare.' },
  { key: 'door_open', name: 'Door (open)', kind: 'door', opts: { open: true }, desc: 'An open door is a corridor for smell, warmth and runners.' },
  { key: 'bed', name: 'Bed', kind: 'bed', desc: 'Sleep through a quiet night and restore stability. The forecast assault will not be slept through.' },
  { key: 'archive', name: 'Archive pedestal', kind: 'archive', opts: { tint: 0xe8d8a8 }, desc: 'A Project Lazarus record. Catalog it — duplicates add nothing; the record is never lost.' },
  // steel tier (§11.1)
  { key: 'battery', name: 'Battery bank', kind: 'battery', desc: 'Buffers surplus and bridges outages — scheduled operation. Stored metal has a chemistry signature; a full bank is a target.' },
  { key: 'switch', name: 'Circuit switch', kind: 'switch', desc: 'Gates a cable run. Open the circuit and everything downstream goes dark — and quiet.' },
  { key: 'scrubber', name: 'Air scrubber', kind: 'scrubber', desc: 'Strips spores and breath from the local air. Clean air steadies the mind and starves the CO₂ gradient.' },
  { key: 'uv', name: 'UV sterilizer', kind: 'uv', desc: 'Burns exposed cyst film and tissue in line of sight. Limited against deep growth; useless through walls.' },
  { key: 'vibturret', name: 'Vibration turret', kind: 'vibturret', desc: 'Reads movement through the ground — sees burrowers before they surface, and cold bodies the warm turret cannot.' },
  { key: 'sensor', name: 'Field sensor', kind: 'sensor', desc: 'Steadies the dusk forecast and contradicts hallucinated alarms. Trust the instrument.' },
  { key: 'maint', name: 'Maintenance bench', kind: 'maint', desc: 'Slowly heals damaged structures nearby from stocked planks. Manual repair stays faster in an emergency.' },
  { key: 'chest', name: 'Sealed crate', kind: 'chest', desc: 'Sealed storage. What goes in stops smelling like food.' },
  { key: 'trap', name: 'Spike trap', kind: 'trap', desc: 'A predictable surface approach deserves a predictable answer. Wears out; friendly feet beware.' },
  // regional containment (§17–18)
  { key: 'transit_panel', name: 'Transit control panel', kind: 'transit_panel', desc: 'The intake bus for the pressure rail: two relays, one filter cartridge, 8 kW — then a very loud startup.' },
  { key: 'transit_gate', name: 'Pressure rail gate', kind: 'transit_gate', opts: { open: true }, desc: 'Hardened against contamination, blast, flood and collapse. It runs one place only: down.' },
  { key: 'valve', name: 'Purge valve', kind: 'valve', desc: 'Three of these, in sequence: heat regulation, sterilant, flood. Venn opened the first. It reset.' },
  { key: 'kiln', name: 'Industrial kiln', kind: 'kiln', desc: 'Restored foundry infrastructure — steel at scale, heat and exhaust to match. Not a machine you hide.' },
  { key: 'radio', name: 'Shortwave radio', kind: 'radio', desc: 'Someone on a ridge, still broadcasting. Regional recovery matters to more people than you.' },
  { key: 'roane', name: 'Subject L-01 (evidence)', kind: 'roane', desc: 'Elias Roane. What remains is scaffolding for a colony — whatever person he was is absent. Not an enemy. Evidence.' },
];

const machineStats = (key) => {
  const cfg = MACHINES[key];
  if (!cfg) return [];
  const rows = [];
  if (cfg.powerOutput) rows.push(['Output', `${cfg.powerOutput} kW`]);
  if (cfg.powerDraw) rows.push(['Draw', `${cfg.powerDraw} kW`]);
  if (cfg.range) rows.push(['Range', `${cfg.range} blocks`]);
  if (cfg.dmg) rows.push(['Damage', String(cfg.dmg)]);
  if (cfg.fuelCapacity) rows.push(['Fuel capacity', String(cfg.fuelCapacity)]);
  if (cfg.orePerSec) rows.push(['Ore rate', `${cfg.orePerSec}/s`]);
  if (cfg.emits) rows.push(['Emits', fmtEmits(cfg.emits)]);
  if (cfg.radius) rows.push(['Signature radius', `${cfg.radius} blocks`]);
  return rows;
};

const BLOCK_IDS = Object.values(B).filter(id => id !== B.AIR);

const CATS = {
  machines: { title: 'FABRICATION', mode: '3d' },
  infected: { title: 'SPECIMENS', mode: '3d' },
  blocks: { title: 'MATERIALS', mode: '3d' },
  items: { title: 'FIELD KIT', mode: 'icons' },
  trees: { title: 'FLORA', mode: 'trees' },
  atmosphere: { title: 'ATMOSPHERE', mode: '3d' },
};

// ---------- three.js viewer ----------

const viewport = $('g-viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// the exact grade the game renders with: filmic tone mapping + soft shadows
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35; // brighter grade than in-game: dark-steel props on a black stage
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
// studio rig: warm key (shadow-casting), cool rim, soft fill — retuned for
// ACES, which pulls mids down compared to the old linear output
const LIGHTS = { sun: 3.2, back: 1.2, fill: 0.9, hemi: 2.0 };
const sun = new THREE.DirectionalLight(0xffe8c0, LIGHTS.sun);
sun.position.set(4, 7, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
const back = new THREE.DirectionalLight(0x74c7c4, LIGHTS.back);
back.position.set(-5, 4, -5);
const fill = new THREE.DirectionalLight(0xcfe3d4, LIGHTS.fill);
fill.position.set(-3, 2, 6);
const hemi = new THREE.HemisphereLight(0xbdd3e8, 0x4a4438, LIGHTS.hemi);
scene.add(sun, sun.target, back, fill, hemi);

const ground = new THREE.Group();
const disc = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48),
  new THREE.MeshBasicMaterial({ color: 0x0a120d, transparent: true, opacity: 0.85 }));
disc.rotation.x = -Math.PI / 2;
disc.position.y = -0.012;
const catcher = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48),
  new THREE.ShadowMaterial({ opacity: 0.34 }));
catcher.rotation.x = -Math.PI / 2;
catcher.position.y = -0.006;
catcher.receiveShadow = true;
const polar = new THREE.PolarGridHelper(2.6, 8, 5, 48, 0x2a4034, 0x18241c);
polar.position.y = -0.01;
ground.add(disc, catcher, polar);
scene.add(ground);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.6;

function resize() {
  const w = viewport.clientWidth || 1, h = viewport.clientHeight || 1;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let current = null;          // displayed THREE.Group
let currentAnim = null;      // { running } for animateProp

function showObject(group, { groundScale = 1, animState = { running: true } } = {}) {
  if (skyView) leaveSkyView();
  if (current) { scene.remove(current); disposeGroup(current); }
  current = group;
  currentAnim = animState;
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(group);
  ground.scale.setScalar(groundScale);
  // frame it
  const bb = new THREE.Box3().setFromObject(group);
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z, 0.6);
  controls.target.copy(center);
  camera.position.set(center.x + r * 1.9, center.y + r * 1.1, center.z + r * 1.9);
  camera.near = r / 50; camera.far = r * 60;
  camera.updateProjectionMatrix();
  // the key light tracks the subject so its shadow frustum stays tight;
  // its per-frame position follows the camera (see frame()) so the facing
  // side is always the lit side — the turntable spins, the studio doesn't
  modelR = r;
  sun.target.position.copy(center);
  const sc = sun.shadow.camera;
  sc.left = -r * 2; sc.right = r * 2; sc.top = r * 2; sc.bottom = -r * 2;
  sc.near = 0.1; sc.far = r * 12;
  sc.updateProjectionMatrix();
}

let modelR = 1; // framing radius of the current subject, for the key light

// ---------- atmosphere (the game's sky dome, dawn to night) ----------

let gallerySky = null;   // lazy Sky instance (dome + discs + starfield)
let skyView = null;      // { sunAngle, daylight, horizon } while active

// mirrors Game.daylight() and updateSky()'s palette for a given day fraction
function skyStateAt(f) {
  let dl;
  if (f < TIME.DAWN - 0.04 || f > TIME.NIGHT) dl = 0.02;
  else if (f < TIME.DAWN_END) dl = 0.02 + 0.98 * ((f - (TIME.DAWN - 0.04)) / (TIME.DAWN_END - TIME.DAWN + 0.04));
  else if (f > TIME.DUSK) dl = Math.max(0.02, 1 - (f - TIME.DUSK) / (TIME.NIGHT - TIME.DUSK));
  else dl = 1;
  const day = new THREE.Color(0x9db4c8), duskC = new THREE.Color(0x8a5a48), night = new THREE.Color(0x0a0f1a);
  let horizon;
  if (f > TIME.DUSK && f < TIME.NIGHT) horizon = duskC.clone().lerp(night, (f - TIME.DUSK) / (TIME.NIGHT - TIME.DUSK));
  else if (dl <= 0.05) horizon = night;
  else if (f > TIME.DAWN - 0.04 && f < TIME.DAWN_END) horizon = night.clone().lerp(day, dl);
  else horizon = day;
  return { sunAngle: (f - 0.25) * Math.PI * 2, daylight: dl, horizon };
}

const SKY_PRESETS = {
  dawn: { f: 0.27, name: 'Dawn', sub: 'day begins', desc: 'First light over the valley. The forecast panel resets; whatever the night left standing is yours again.' },
  noon: { f: 0.5, name: 'Noon', sub: 'full light', desc: 'The sun disc rides a camera-locked dome — the same gradient, sun, moon and starfield the game renders, drawn here for inspection.' },
  dusk: { f: 0.78, name: 'Dusk', sub: 'forecast hour', desc: 'The horizon band reddens as daylight ramps down. In the valley this is when the dusk forecast calls tonight\'s assault.' },
  night: { f: 0.95, name: 'Night', sub: 'starfield', desc: 'Full dark: 450 fixed stars fade in and the moon takes the sun\'s track. Fog closes in with the light.' },
};

function showSky(key) {
  const p = SKY_PRESETS[key];
  if (current) { scene.remove(current); disposeGroup(current); current = null; }
  if (!gallerySky) gallerySky = new Sky(scene);
  skyView = skyStateAt(p.f);
  ground.scale.setScalar(3);
  // stand on the survey pad and look around from just above it
  controls.target.set(0, 2.2, 0);
  camera.position.set(7, 3.6, 7);
  camera.near = 0.1; camera.far = 600;
  camera.updateProjectionMatrix();
  sun.position.set(Math.cos(skyView.sunAngle) * 30, Math.sin(skyView.sunAngle) * 34, 12);
  sun.target.position.set(0, 0, 0);
  const sc = sun.shadow.camera;
  sc.left = -10; sc.right = 10; sc.top = 10; sc.bottom = -10;
  sc.near = 0.1; sc.far = 120;
  sc.updateProjectionMatrix();
  sun.intensity = Math.max(0.04, skyView.daylight) * 2.0;
  hemi.intensity = 0.25 + skyView.daylight * 1.2;
  back.intensity = 0.15 + skyView.daylight * 0.6;
  fill.intensity = 0.1 + skyView.daylight * 0.45;
  setCard('ATMOSPHERE RECORD', p.name, p.desc, [
    ['Day fraction', p.f.toFixed(2)],
    ['Daylight', skyView.daylight.toFixed(2)],
    ['Horizon', '#' + skyView.horizon.getHexString()],
    ['Renderer', 'sky.js — dome + discs + 450 stars'],
  ]);
}

function leaveSkyView() {
  skyView = null;
  if (gallerySky) gallerySky.setVisible(false);
  sun.intensity = LIGHTS.sun;
  back.intensity = LIGHTS.back;
  fill.intensity = LIGHTS.fill;
  hemi.intensity = LIGHTS.hemi;
}

// ---------- category content ----------

let activeCat = 'machines';
let activeKey = null;

function setCard(tag, name, desc, stats = [], senses = null) {
  $('g-card-tag').textContent = tag;
  $('g-card-name').textContent = name;
  $('g-card-desc').textContent = desc || '';
  const wrap = $('g-card-stats');
  clear(wrap);
  for (const [k, v] of stats) {
    const row = el('div', 'g-stat');
    row.appendChild(el('span', null, k));
    row.appendChild(el('span', null, v));
    wrap.appendChild(row);
  }
  if (senses) {
    for (const [ch, v] of Object.entries(senses).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])) {
      const row = el('div', 'g-sense-row');
      row.appendChild(el('span', null, ch));
      const bar = el('div', 'g-sense-bar');
      const fill = el('div');
      fill.style.width = `${Math.min(100, v * 100)}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      wrap.appendChild(row);
    }
  }
}

function showMachine(entry) {
  showObject(buildProp(entry.kind, entry.opts || {}));
  setCard('FABRICATION RECORD', entry.name, entry.desc, machineStats(entry.key));
}

function showStrain(key) {
  const s = STRAINS[key];
  const { group } = buildInfectedMesh(key);
  showObject(group, { groundScale: 1.2 * s.scale });
  setCard('SPECIMEN RECORD', s.name, s.desc, [
    ['Integrity', String(s.hp)],
    ['Speed', `${s.speed} m/s`],
    ['Attack', String(s.dmg)],
    ['Structure damage', `${s.blockDmg}/s`],
    ['Investigate ≥', String(s.thresholds.investigate)],
    ['Pursue ≥', String(s.thresholds.pursue)],
  ], s.senses);
}

const LITTER = [
  ['stick', 'Fallen sticks'],
  ['stone_shard', 'Loose stones'],
  ['fiber', 'Fiber tuft'],
];

function showLitter(key) {
  const name = LITTER.find(([k]) => k === key)[1];
  const g = buildGroundItem(key, 3);
  const pad = buildBlockMesh(B.GRASS);
  pad.position.y = -1;
  g.add(pad);
  showObject(g);
  setCard('SURFACE SURVEY', name, 'Natural scatter — walk over it to collect. The same builder renders it in-world, lying where it fell.', [
    ['Collect', 'walk over'],
    ['Also from', key === 'stick' ? 'chopping leaves' : key === 'stone_shard' ? 'digging gravel · mining stone' : 'leaves · digging turf'],
  ]);
}

function showBlock(id) {
  const def = BLOCKS[id];
  showObject(buildBlockMesh(id));
  const stats = [
    ['Registry', B_NAME[id]],
    ['Solid', def.solid ? 'yes' : 'no'],
    ['Breakable', def.hardness === Infinity ? 'no — indestructible' : `hardness ${def.hardness ?? '—'}`],
  ];
  if (def.tool) stats.push(['Best tool', def.tool + (def.toolMin ? ` (tier ${def.toolMin}+)` : '')]);
  if (def.armor) stats.push(['Armor', `×${def.armor}`]);
  if (def.light) stats.push(['Light level', String(def.light)]);
  if (def.emits) stats.push(['Emits', fmtEmits(def.emits)]);
  setCard('MATERIAL RECORD', def.name, blockDesc(def), stats);
}

function blockDesc(def) {
  if (def.emits) return 'This block emits a signature. Whatever senses that channel can find it.';
  if (def.armor) return 'Reinforced. Infected chew through it slower than through timber.';
  if (def.falls) return 'Unsupported columns collapse.';
  return '';
}

function growTrees(seedStr) {
  const rng = new RNG(seedStr).fork('tree');
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const th = rng.int(4, 6);
    const tree = new THREE.Group();
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const pad = buildBlockMesh(B.GRASS);
        pad.position.set(dx, -1, dz);
        tree.add(pad);
      }
    for (const b of treeShape(th)) {
      const cube = buildBlockMesh(b.id);
      cube.position.set(b.dx, b.dy, b.dz);
      tree.add(cube);
    }
    tree.position.x = (i - 1) * 6.5;
    group.add(tree);
  }
  showObject(group, { groundScale: 4.2 });
  setCard('FLORA RECORD', `Trees — seed "${seedStr}"`,
    'Three growths from this seed, produced by the same treeShape() generator the world stamps during terrain generation.',
    [['Trunk height', '4–6 blocks'], ['Canopy', '5×5×3, corners clipped'], ['Drops', 'logs · sticks · fiber']]);
}

// One InstancedMesh per block id — a few hundred cubes in two or three draws
function instancedBlocks(id, cells) {
  const proto = buildBlockMesh(id).children[0];
  const inst = new THREE.InstancedMesh(proto.geometry, proto.material, cells.length);
  const m4 = new THREE.Matrix4();
  cells.forEach((c, i) => { m4.makeTranslation(c[0], c[1] + 0.5, c[2]); inst.setMatrixAt(i, m4); });
  inst.castShadow = inst.receiveShadow = true;
  inst.frustumCulled = false; // culling would use the base cube's bounds, not the instances'
  return inst;
}

function growHill(kind) {
  const seedStr = $('g-seed').value || 'wake-042';
  const isIron = kind === 'iron';
  const { blocks, r, placed } = oreHillShape(seedStr + ':' + kind, isIron);
  const group = new THREE.Group();
  const cells = new Map(); // id -> [[x,y,z], ...]
  const put = (id, c) => { (cells.get(id) || cells.set(id, []).get(id)).push(c); };
  const padR = r + 3;
  for (let x = -padR; x <= padR; x++)
    for (let z = -padR; z <= padR; z++)
      if (Math.hypot(x, z) <= padR && !blocks.has(x + ',0,' + z)) put(B.GRASS, [x, 0, z]);
  for (const [k, id] of blocks) {
    if (id === B.AIR) continue;
    const [x, y, z] = k.split(',').map(Number);
    if (y < 0) continue; // the buried part of the deposit stays buried
    put(id, [x, y, z]);
  }
  for (const [id, list] of cells) group.add(instancedBlocks(id, list));
  // instanced bounds aren't seen by Box3.setFromObject — give it the extents
  const extent = new THREE.Mesh(new THREE.BoxGeometry(padR * 2 + 1, 9, padR * 2 + 1),
    new THREE.MeshBasicMaterial({ visible: false }));
  extent.position.y = 3.5;
  group.add(extent);
  showObject(group, { groundScale: 5 });
  const cfg = WORLDGEN.oreHills;
  setCard('SURFACE SURVEY', `Wild ore hill — ${isIron ? 'iron' : 'coal'}`,
    'A walk-in ore dome, stamped by the same generator the wilderness streams in. Ore shows on the flanks, the chamber inside holds the seam, and part of the deposit runs under the floor. Every deposit is finite.',
    [
      ['Radius', `${cfg.radiusMin}–${cfg.radiusMax} blocks`],
      ['Guaranteed ore', `≥ ${cfg.minOre} blocks (this stamp: ${placed})`],
      ['Flank outcrops', String(cfg.outcrops)],
      ['Frequency', `~${Math.round(WORLDGEN.wild.hillChance * 100)}% of each ${WORLDGEN.wild.hillCell}×${WORLDGEN.wild.hillCell} wilderness cell`],
      ['Seed', seedStr],
    ]);
}

// ---------- sidebar ----------

function buildCats() {
  const nav = $('g-cats');
  clear(nav);
  for (const [key, c] of Object.entries(CATS)) {
    const b = el('div', 'g-cat' + (key === activeCat ? ' active' : ''), c.title);
    b.addEventListener('click', () => selectCat(key));
    nav.appendChild(b);
  }
}

function listItem(name, sub, onclick, active) {
  const it = el('div', 'g-item' + (active ? ' active' : ''));
  it.appendChild(el('span', null, name));
  if (sub) it.appendChild(el('span', 'g-item-sub', sub));
  it.addEventListener('click', onclick);
  return it;
}

function buildList() {
  const list = $('g-list');
  clear(list);
  if (activeCat === 'machines') {
    for (const e of MACHINE_ENTRIES)
      list.appendChild(listItem(e.name, MACHINES[e.key] ? 'powered' : '', () => select(e.key), activeKey === e.key));
  } else if (activeCat === 'infected') {
    for (const k of Object.keys(STRAINS))
      list.appendChild(listItem(STRAINS[k].name, STRAINS[k].boss ? 'boss' : '', () => select(k), activeKey === k));
  } else if (activeCat === 'blocks') {
    for (const id of BLOCK_IDS)
      list.appendChild(listItem(BLOCKS[id].name, B_NAME[id].toLowerCase(), () => select(String(id)), activeKey === String(id)));
    for (const [key, name] of LITTER)
      list.appendChild(listItem(name, 'ground litter', () => select('litter:' + key), activeKey === 'litter:' + key));
  } else if (activeCat === 'items') {
    for (const k of Object.keys(ITEMS))
      list.appendChild(listItem(ITEMS[k].name, ITEMS[k].tool || '', () => select(k), activeKey === k));
  } else if (activeCat === 'trees') {
    list.appendChild(listItem('Growth preview', 'seeded', () => select('trees'), activeKey === 'trees'));
    list.appendChild(listItem('Wild ore hill — iron', 'landform', () => select('hill:iron'), activeKey === 'hill:iron'));
    list.appendChild(listItem('Wild ore hill — coal', 'landform', () => select('hill:coal'), activeKey === 'hill:coal'));
  } else if (activeCat === 'atmosphere') {
    for (const [k, p] of Object.entries(SKY_PRESETS))
      list.appendChild(listItem(p.name, p.sub, () => select(k), activeKey === k));
  }
}

function buildIconGrid() {
  const grid = $('g-icons');
  clear(grid);
  for (const k of Object.keys(ITEMS)) {
    const def = itemDef(k);
    const cell = el('div', 'g-icon-cell' + (activeKey === k ? ' active' : ''));
    cell.appendChild(makeIcon(def, 64));
    cell.appendChild(el('div', 'g-icon-name', def.name));
    cell.addEventListener('click', () => select(k));
    grid.appendChild(cell);
  }
}

function itemStats(def) {
  const rows = [['Stack size', String(def.stack || 1)]];
  if (def.tool) rows.push(['Tool class', `${def.tool} · tier ${def.tier}`], ['Speed', `×${def.speed}`], ['Damage', String(def.dmg)], ['Durability', String(def.dur)]);
  if (def.reach) rows.push(['Reach', `${def.reach} m`]);
  if (def.food) rows.push(['Nutrition', String(def.food)]);
  if (def.sanity) rows.push(['Stability', `+${def.sanity}`]);
  if (def.fuel) rows.push(['Fuel value', `${def.fuel}s`]);
  if (def.emits) rows.push(['Emits', fmtEmits(def.emits)]);
  return rows;
}

function selectCat(cat) {
  activeCat = cat;
  activeKey = null;
  const iconMode = CATS[cat].mode === 'icons';
  $('g-icons').classList.toggle('hidden', !iconMode);
  $('g-viewport').classList.toggle('hidden', iconMode);
  $('g-tree-controls').classList.toggle('hidden', CATS[cat].mode !== 'trees');
  buildCats();
  // default selection
  if (cat === 'machines') select(MACHINE_ENTRIES[0].key);
  else if (cat === 'infected') select(Object.keys(STRAINS)[0]);
  else if (cat === 'blocks') select(String(B.GRASS));
  else if (cat === 'items') { buildIconGrid(); select(Object.keys(ITEMS)[0]); }
  else if (cat === 'trees') select('trees');
  else if (cat === 'atmosphere') select('noon');
}

function select(key) {
  activeKey = key;
  if (activeCat === 'machines') showMachine(MACHINE_ENTRIES.find(e => e.key === key));
  else if (activeCat === 'infected') showStrain(key);
  else if (activeCat === 'blocks' && key.startsWith('litter:')) showLitter(key.slice(7));
  else if (activeCat === 'blocks') showBlock(Number(key));
  else if (activeCat === 'items') {
    const def = itemDef(key);
    setCard('FIELD KIT RECORD', def.name, def.desc || '', itemStats(def));
    buildIconGrid();
  } else if (activeCat === 'trees' && key.startsWith('hill:')) growHill(key.slice(5));
  else if (activeCat === 'trees') growTrees($('g-seed').value || 'wake-042');
  else if (activeCat === 'atmosphere') showSky(key);
  buildList();
}

// GROW / RANDOM / Enter re-roll whatever seeded preview is active
const regrow = () => select(activeKey && activeKey.startsWith('hill:') ? activeKey : 'trees');
$('g-grow').addEventListener('click', regrow);
$('g-random').addEventListener('click', () => {
  $('g-seed').value = 'wake-' + Math.floor(Math.random() * 1e6);
  regrow();
});
$('g-seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') regrow(); });

// ---------- frame loop (worker watchdog keeps hidden tabs rendering) ----------

const clock = new THREE.Clock();
let t = 0;
let lastFrame = performance.now();
function frame() {
  lastFrame = performance.now();
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;
  if (current) current.traverse(o => {
    const u = o.userData;
    if (u && (u.spin?.length || u.glow?.length || u.flames?.length || u.pulse?.length || u.head))
      animateProp(o, t, { running: currentAnim?.running ?? true, dt, aimYaw: null });
  });
  controls.update();
  if (skyView) {
    // the dome, discs and stars ride the camera — keep them glued while orbiting
    if (gallerySky) gallerySky.update(camera, skyView.sunAngle, skyView.daylight, skyView.horizon);
  } else {
    // key over the camera's right shoulder, fill low over the left: with
    // autorotate this reads as the model turning under a fixed studio rig,
    // and the camera-facing side is always shaped by light
    const dx = camera.position.x - controls.target.x;
    const dz = camera.position.z - controls.target.z;
    const yaw = Math.atan2(dx, dz);
    const R = modelR * 2.4;
    sun.position.set(
      controls.target.x + Math.sin(yaw + 0.55) * R,
      controls.target.y + R * 1.15,
      controls.target.z + Math.cos(yaw + 0.55) * R);
    fill.position.set(
      controls.target.x + Math.sin(yaw - 0.95) * R,
      controls.target.y + R * 0.45,
      controls.target.z + Math.cos(yaw - 0.95) * R);
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);
try {
  const src = 'setInterval(() => postMessage(0), 66)';
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  worker.onmessage = () => { if (performance.now() - lastFrame > 120) frame(); };
} catch { /* rAF only */ }

// ---------- boot ----------
resize();
buildCats();
selectCat('machines');
