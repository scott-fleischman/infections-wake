import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { B, B_NAME, BLOCKS, ITEMS, STRAINS, MACHINES } from './config.js';
import { buildProp, buildInfectedMesh, buildBlockMesh, animateProp, disposeGroup } from './models.js';
import { treeShape } from './world.js';
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
};

// ---------- three.js viewer ----------

const viewport = $('g-viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
const sun = new THREE.DirectionalLight(0xffe8c0, 1.7);
sun.position.set(4, 7, 3);
const back = new THREE.DirectionalLight(0x74c7c4, 0.7);
back.position.set(-5, 4, -5);
const fill = new THREE.DirectionalLight(0xcfe3d4, 0.5);
fill.position.set(-3, 2, 6);
scene.add(sun, back, fill, new THREE.HemisphereLight(0xbdd3e8, 0x4a4438, 1.25));

const ground = new THREE.Group();
const disc = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48),
  new THREE.MeshBasicMaterial({ color: 0x0a120d, transparent: true, opacity: 0.85 }));
disc.rotation.x = -Math.PI / 2;
disc.position.y = -0.012;
const polar = new THREE.PolarGridHelper(2.6, 8, 5, 48, 0x2a4034, 0x18241c);
polar.position.y = -0.01;
ground.add(disc, polar);
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
  if (current) { scene.remove(current); disposeGroup(current); }
  current = group;
  currentAnim = animState;
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
  } else if (activeCat === 'items') {
    for (const k of Object.keys(ITEMS))
      list.appendChild(listItem(ITEMS[k].name, ITEMS[k].tool || '', () => select(k), activeKey === k));
  } else if (activeCat === 'trees') {
    list.appendChild(listItem('Growth preview', 'seeded', () => select('trees'), true));
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
}

function select(key) {
  activeKey = key;
  if (activeCat === 'machines') showMachine(MACHINE_ENTRIES.find(e => e.key === key));
  else if (activeCat === 'infected') showStrain(key);
  else if (activeCat === 'blocks') showBlock(Number(key));
  else if (activeCat === 'items') {
    const def = itemDef(key);
    setCard('FIELD KIT RECORD', def.name, def.desc || '', itemStats(def));
    buildIconGrid();
  } else if (activeCat === 'trees') growTrees($('g-seed').value || 'wake-042');
  buildList();
}

$('g-grow').addEventListener('click', () => select('trees'));
$('g-random').addEventListener('click', () => {
  $('g-seed').value = 'wake-' + Math.floor(Math.random() * 1e6);
  select('trees');
});
$('g-seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') select('trees'); });

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
