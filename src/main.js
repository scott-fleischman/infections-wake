import * as THREE from 'three';
import { WORLD, TIME, B, BLOCKS, ITEMS, SCORE, SANITY, RECOVERY, PLAYER, STRAINS } from './config.js';
import { RNG } from './rng.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Inventory, itemDef } from './inventory.js';
import { Signature } from './signature.js';
import { InfectedManager } from './infected.js';
import { Machines } from './power.js';
import { Props } from './props.js';
import { buildGroundItem, buildBlockMesh, disposeGroup } from './models.js';
import { makeIcon } from './icons.js';
import { Director } from './director.js';
import { Sanity } from './sanity.js';
import { Recovery } from './recovery.js';
import { StoryLog, ARCHIVES } from './lore.js';
import { HUD } from './hud.js';
import { GameAudio } from './audio.js';
import { LightPool } from './light.js';
import { SaveStore } from './save.js';
import { SCENARIOS, applyScenario } from './scenarios.js';

const $ = (id) => document.getElementById(id);

class Game {
  constructor() {
    // three.js scaffolding
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    $('app').appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 320);
    this.sun = new THREE.DirectionalLight(0xffe8c0, 1.0);
    this.hemi = new THREE.HemisphereLight(0xbdd3e8, 0x3a3428, 0.9);
    this.scene.add(this.sun, this.hemi);
    this.scene.fog = new THREE.Fog(0x9db4c8, 40, 190);

    this.audio = new GameAudio();
    this.hud = new HUD(this);
    this.lights = new LightPool(this.scene, 18);

    this.state = 'menu';
    this.t = 0;
    this.day = 1;
    this.dayFrac = 0.3;
    this._prevFrac = 0.3;
    this.score = 0;
    this.valleyFlags = new Set();
    this.tiers = new Set();
    this.unlocks = { sigPanel: false, sigAll: false };
    this.beastSeen = new Set();
    this.bossDead = false;
    this.bossSpawned = false;
    this.boss = null;
    this.bossHpMarks = new Set();
    this.pickupsTaken = new Set();
    this.pickups = [];
    this.critters = [];
    this.effects = [];
    this.furnaces = new Map();
    this.attackCd = 0;
    this.autosaveT = 30;
    this.uiTick = 0;
    this.hintStage = 0;
    this.cystClickT = 2;

    this.bindInput();
    this.bindMenus();
    this.updateMenu();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
    // Watchdog: rAF stops in hidden/backgrounded tabs, and page timers get
    // intensively throttled. A Web Worker's timer is exempt — use it to keep
    // the simulation ticking so the world stays consistent and autosaves run.
    this._lastFrameAt = performance.now();
    const tick = () => { if (performance.now() - this._lastFrameAt > 120) this.frame(); };
    try {
      const src = 'setInterval(() => postMessage(0), 66)';
      const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = tick;
    } catch {
      setInterval(tick, 66);
    }

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('beforeunload', () => { if (this.state === 'play' || this.state === 'paused') SaveStore.write(this); });
  }

  // ------------------------------------------------------------------
  // World lifecycle
  // ------------------------------------------------------------------
  newWorld(hardcore = false, scenario = null, seed = null) {
    seed = seed || 'wake-' + Math.floor(Math.random() * 1e9);
    this.setupWorld(seed, hardcore, null, scenario);
  }

  continueWorld() {
    const data = SaveStore.read();
    if (!data) return this.newWorld(false);
    this.setupWorld(data.seed, data.hardcore, data);
  }

  setupWorld(seed, hardcore, data, scenario = null) {
    // clear any prior scene content (meshes AND GPU resources)
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    for (const p of this.pickups) if (p.mesh) { this.scene.remove(p.mesh); disposeGroup(p.mesh); }
    for (const c of this.critters) if (c.mesh) this.scene.remove(c.mesh);
    if (this.props) this.props.removeAll();
    if (this.infected) this.infected.removeAll();
    if (this.emergencyMesh) this.scene.remove(this.emergencyMesh);
    if (this.recovery) for (const gr of this.recovery.graves) if (gr.mesh) this.scene.remove(gr.mesh);
    for (const e of this.effects) this.scene.remove(e.mesh);
    if (this.boss) this.boss = null;
    this.lights.clear();
    this.effects = [];
    this.furnaces = new Map();
    this.blockHp = new Map();
    this._sleeping = false;
    this.hud.showAssaultBanner(false);
    $('night-fade').style.opacity = '0';

    this.seed = seed;
    this.rng = new RNG(seed);
    this.world = new World(seed);
    this.world.generate();
    this.scene.add(this.world.group);

    this.player = new Player(this);
    this.inv = new Inventory(this);
    this.sig = new Signature(this);
    this.props = new Props(this);
    this.infected = new InfectedManager(this);
    this.machines = new Machines(this);
    this.director = new Director(this);
    this.sanity = new Sanity(this);
    this.recovery = new Recovery(this, hardcore);
    this.story = new StoryLog(this);

    this.t = TIME.DAY_LENGTH * 0.30; // morning, day 1
    this.day = 1;
    this.score = 0;
    this.valleyFlags = new Set();
    this.tiers = new Set();
    this.unlocks = { sigPanel: false, sigAll: false };
    this.beastSeen = new Set();
    this.bossDead = false;
    this.bossSpawned = false;
    this.bossHpMarks = new Set();
    this.pickupsTaken = new Set();
    this.hintStage = 0;
    this.scenarioKey = scenario || null; // scenario saves are marked (see boot guard)
    this.specCrafts = new Set();

    this._loadedPlayerPos = false;
    if (data) this.loadInto(data);

    if (!this._loadedPlayerPos) this.player.spawnAt(this.world.spawnPoint());
    this.sig.scanWorld();
    this.props.scanWorld(); // prop meshes for model-rendered blocks (gen + saved edits)
    // restore lights for player-placed torches/campfires; a standing door
    // from an older save also satisfies the door objective
    for (const [k, v] of this.world.edits) {
      if (v === B.TORCH || v === B.CAMPFIRE) {
        const [x, y, z] = k.split(',').map(Number);
        this.refreshBlockLight(x, y, z, v);
      }
      if (v === B.DOOR || v === B.DOOR_OPEN) this.unlocks.doorHung = true;
    }
    this.spawnPickups();
    for (const pk of (this._pendingDropped || [])) this.dropItemAt({ x: pk.x, y: pk.y - 0.4, z: pk.z }, pk.item, pk.n);
    this._pendingDropped = null;
    this.spawnCritters();
    this.buildEmergencyPad();
    this.world.buildAll();

    this.state = 'play';
    this.hud.closeAll();
    this.hud.setHudVisible(true);
    this.hud.updateHotbar();
    this.hud.updateRecovery();
    this.hud.updateScore();
    this.hud.updateThreat();
    this.hud.updateSanityFx();
    this.requestLock();
    this.audio.ensure(); this.audio.resume();

    if (!data && scenario && applyScenario(this, scenario)) {
      // scenario worlds get their own toast; skip the newcomer intro
    } else if (!data) {
      this.toast("The valley is quiet. Gather loose stones and sticks.", 'important');
      setTimeout(() => this.toast('Craft tools with [E]. Night comes — and something forecasts with it.'), 4500);
    } else {
      this.toast('Recovered save. The valley remembers.', 'important');
    }
  }

  loadInto(d) {
    this.t = d.t;
    this.day = Math.floor(this.t / TIME.DAY_LENGTH) + 1; // threat scaling continuity
    this.score = d.score || 0;
    this.hintStage = d.hintStage ?? 0;
    this.scenarioKey = d.scenario || null;
    this.valleyFlags = new Set(d.valleyFlags || []);
    this.tiers = new Set(d.tiers || []);
    this.unlocks = d.unlocks || { sigPanel: false, sigAll: false };
    this.beastSeen = new Set(d.beastSeen || []);
    this.bossDead = d.bossDead || false;
    this.pickupsTaken = new Set(d.pickupsTaken || []);
    this.world.applyEdits(d.edits || []);
    if (d.player) {
      this.player.pos.set(d.player.x, d.player.y, d.player.z);
      this.player.yaw = d.player.yaw; this.player.pitch = d.player.pitch;
      this.player.health = d.player.health; this.player.hunger = d.player.hunger;
      this._loadedPlayerPos = true;
    }
    this.inv.load(d.inv || {});
    this.machines.load(d.machines || []);
    for (const f of (d.furnaces || [])) this.furnaces.set(`${f.x},${f.y},${f.z}`, f);
    this.sanity.load(d.sanity);
    this.director.load(d.director);
    this.story.load(d.story);
    this.recovery.load(d.recovery);
    this.infected.load(d.infected || []);
    // a colony host in the saved list IS the boss — rebind so it doesn't respawn
    const host = this.infected.list.find(i => i.strainKey === 'colony_host');
    if (host) {
      this.boss = host;
      this.bossSpawned = true;
      const hs = this.world.poi.colony.hostSpawn;
      host.home = { x: hs.x, y: hs.y, z: hs.z };
      for (const f of [0.75, 0.5, 0.25]) if (host.hp < host.s.hp * f) this.bossHpMarks.add(f);
    } else if (this.bossDead) {
      this.bossSpawned = true;
    }
    // dropped ground items (boss loot, spilled buffers) round-trip too;
    // applied after spawnPickups() resets the pickup list
    this._pendingDropped = d.dropped || [];
  }

  buildEmergencyPad() {
    const e = this.world.poi.emergency;
    const grp = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.22, 10),
      new THREE.MeshLambertMaterial({ color: 0x3a4a44 }));
    base.position.set(e.x + 0.5, e.y + 0.11, e.z + 0.5);
    grp.add(base);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 8),
      new THREE.MeshBasicMaterial({ color: 0x7fae62 }));
    core.position.set(e.x + 0.5, e.y + 0.45, e.z + 0.5);
    grp.add(core);
    this.scene.add(grp);
    this.emergencyMesh = grp;
    this.emergencyCore = core;
    if (this.recovery.emergencyUses > 0) {
      this.lights.set('emergency', e.x + 0.5, e.y + 0.8, e.z + 0.5, 0x7fae62, 0.5, 5);
    } else {
      core.material.color.setHex(0x3a3f3a);
    }
  }

  // Visual for a pickup: natural scatter lies on the ground as a real object,
  // block drops are mini blocks, everything else billboards its field-kit icon.
  pickupMesh(itemId, seed = 0) {
    const ground = buildGroundItem(itemId, seed);
    if (ground) { ground.userData.grounded = true; return ground; }
    const wrap = new THREE.Group();
    if (itemId.startsWith('b:')) {
      const mini = buildBlockMesh(Number(itemId.slice(2)));
      mini.scale.setScalar(0.26);
      mini.position.y = -0.13; // block mesh origin is its bottom; center it
      wrap.add(mini);
    } else {
      const tex = new THREE.CanvasTexture(makeIcon(itemDef(itemId), 64));
      tex.magFilter = THREE.NearestFilter;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      spr.scale.setScalar(0.5);
      wrap.add(spr);
    }
    return wrap;
  }

  spawnPickups() {
    this.pickups = [];
    this.world.pickups.forEach((p, i) => {
      if (this.pickupsTaken.has(i)) return;
      const mesh = this.pickupMesh(p.item, i);
      const grounded = !!mesh.userData.grounded;
      mesh.position.set(p.x, p.y, p.z);
      if (grounded) mesh.rotation.y = (i * 2.39996) % (Math.PI * 2); // vary the litter
      this.scene.add(mesh);
      this.pickups.push({ ...p, mesh, idx: i, bob: Math.random() * 6, grounded });
    });
  }

  dropItemAt(pos, id, n = 1) {
    const mesh = this.pickupMesh(id, (this._dropSeq = (this._dropSeq || 0) + 1));
    mesh.position.set(pos.x, pos.y + 0.4, pos.z);
    this.scene.add(mesh);
    const p = { x: pos.x, y: pos.y + 0.4, z: pos.z, item: id, n, mesh, idx: -1, bob: 0 };
    this.pickups.push(p);
    if (id === 'raw_meat') {
      // a carcass in the open smells — the emitter dies with the pickup
      p.sigKey = 'meat:' + (this._meatSeq = (this._meatSeq || 0) + 1);
      this.sig.setDynamic(p.sigKey, pos.x, pos.y, pos.z, { blood: 0.5 }, 12);
    }
    return p;
  }

  spawnCritters() {
    this.critters = [];
    const rng = this.rng.fork('critters');
    for (let i = 0; i < 10; i++) {
      const x = rng.range(8, WORLD.SIZE_X * 0.55);
      const z = rng.range(8, WORLD.SIZE_Z - 8);
      const y = this.world.skyTop(Math.floor(x), Math.floor(z));
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.7), new THREE.MeshLambertMaterial({ color: 0x9a8a72 }));
      body.position.y = 0.35;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: 0x8a7a62 }));
      head.position.set(0, 0.55, -0.4);
      grp.add(body, head);
      grp.position.set(x, y, z);
      this.scene.add(grp);
      this.critters.push({ pos: new THREE.Vector3(x, y, z), mesh: grp, hp: 5, dir: rng.range(0, Math.PI * 2), moveT: 0 });
    }
  }

  // ------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------
  bindInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      if (this.state === 'play' && !this.hud.isScreenOpen()) this.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this.state === 'play' && !this.hud.isScreenOpen()) {
        this.pause();
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.renderer.domElement && this.state === 'play')
        this.player.onMouseMove(e.movementX, e.movementY);
    });
    document.addEventListener('mousedown', (e) => {
      if (this.state !== 'play' || this.hud.isScreenOpen()) return;
      if (document.pointerLockElement !== this.renderer.domElement) return;
      if (e.button === 0) { this.onPrimary(); this.player.miningHeld = true; this._lmbDownAt = performance.now(); }
      if (e.button === 2) this.onSecondary();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !this.player) return;
      this.player.miningHeld = false;
      this.maybeHoldHint();
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    // losing focus must not leave movement/mining keys latched
    const releaseInputs = () => {
      if (!this.player) return;
      this.player.keys = {};
      this.player.sprinting = false;
      this.player.miningHeld = false;
    };
    window.addEventListener('blur', releaseInputs);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') releaseInputs(); });

    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (this.state === 'play' && !this.hud.isScreenOpen()) {
        this.player.keys[k] = true;
        if (k === 'shift') this.player.sprinting = true;
        if (k >= '1' && k <= '6') { this.inv.selected = Number(k) - 1; this.hud.updateHotbar(); }
        if (k === 'q') { this.inv.selected = (this.inv.selected + 1) % this.inv.hotbarCount; this.hud.updateHotbar(); }
        if (k === 'e') { this.openScreen('inv-screen'); return; }
        if (k === 'j') { this.openScreen('log-screen'); return; }
        if (k === 'f') this.interact();
        if (k === 'escape') this.pause();
      } else if (this.hud.isScreenOpen() && this.state === 'play') {
        if (k === 'escape' || (k === 'e' && this.hud.activeScreen === 'inv-screen') || (k === 'j' && this.hud.activeScreen === 'log-screen')) {
          this.hud.closeAll(); this.requestLock();
        }
      }
    });
    document.addEventListener('keyup', (e) => {
      if (!this.player) return;
      const k = e.key.toLowerCase();
      this.player.keys[k] = false;
      if (k === 'shift') this.player.sprinting = false;
    });
  }

  bindMenus() {
    $('btn-new').addEventListener('click', () => { SaveStore.clear(); this.newWorld(false); });
    $('btn-new-hardcore').addEventListener('click', () => { SaveStore.clear(); this.newWorld(true); });
    $('btn-continue').addEventListener('click', () => this.continueWorld());
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-savequit').addEventListener('click', () => {
      SaveStore.write(this);
      this.state = 'menu';
      this.hud.setHudVisible(false);
      this.updateMenu();
      this.hud.show('menu-screen');
    });
    $('btn-respawn').addEventListener('click', () => this.applyRespawn());
    $('btn-fail-menu').addEventListener('click', () => {
      this.state = 'menu';
      this.hud.setHudVisible(false);
      this.updateMenu();
      this.hud.show('menu-screen');
    });
    // dev scenarios: skip ahead to a story checkpoint with a matching world
    const list = $('scenario-list');
    for (const [key, sc] of Object.entries(SCENARIOS)) {
      const b = document.createElement('button');
      b.textContent = sc.name;
      b.title = sc.desc;
      b.addEventListener('click', () => { SaveStore.clear(); this.newWorld(false, key); });
      list.appendChild(b);
    }
    $('catalog-cancel').addEventListener('click', () => { this.hud.closeAll(); this.requestLock(); });
    $('catalog-confirm').addEventListener('click', () => {
      if (this.pendingArchive != null) {
        this.story.catalog(this.pendingArchive);
        this.audio.archive();
        this.pendingArchive = null;
      }
      this.hud.closeAll(); this.requestLock();
    });
  }

  updateMenu() {
    $('btn-continue').classList.toggle('hidden', !SaveStore.has());
  }

  openScreen(id) {
    this.hud.show(id);
    if (id === 'inv-screen') this.hud.renderInventory();
    if (id === 'log-screen') this.hud.renderLog();
  }

  requestLock() {
    if (this.state === 'play') this.renderer.domElement.requestPointerLock?.();
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    SaveStore.write(this);
    this.hud.show('pause-screen');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'play';
    this.hud.closeAll();
    this.requestLock();
  }

  // ------------------------------------------------------------------
  // Primary / secondary / interact
  // ------------------------------------------------------------------
  // A quick tap on a breakable block usually means the player expected a
  // click-to-break interaction — teach hold-to-mine, at most twice.
  maybeHoldHint() {
    if (this.state !== 'play' || (this._holdHints || 0) >= 2) return;
    if (!this._lmbDownAt || performance.now() - this._lmbDownAt > 350) return;
    if (this.attackCd > 0) return; // that tap was a hit on a creature
    const hit = this.player.raycast();
    if (!hit) return;
    const def = BLOCKS[hit.id];
    if (!def || def.hardness == null || def.hardness === Infinity || def.interact || def.archive) return;
    this._holdHints = (this._holdHints || 0) + 1;
    this.toast('Hold LMB to break blocks — the ring at your crosshair fills as it cracks.', 'important');
  }

  onPrimary() {
    this.audio.resume();
    if (this.attackCd > 0) return;
    const origin = this.player.eyePos;
    const dir = this.player.forwardVec().normalize();
    const held = this.player.heldItem();
    const reach = held?.def?.reach || 3.2;
    // enemies first
    const enemy = this.infected.raycast(origin, dir, reach);
    // don't hit through walls
    if (enemy) {
      const blockHit = this.player.raycast(reach);
      const eDist = origin.distanceTo(new THREE.Vector3(enemy.pos.x, enemy.pos.y + 0.9, enemy.pos.z));
      if (!blockHit || blockHit.dist > eDist - 0.4) {
        const dmg = held?.def?.dmg || 1;
        enemy.takeHit(dmg, true);
        this.audio.hitEnemy();
        this.inv.useToolDurability(1);
        this.attackCd = 0.45;
        return;
      }
    }
    // critters
    const critter = this.raycastCritter(origin, dir, reach);
    if (critter) {
      critter.hp -= held?.def?.dmg || 1;
      this.audio.hitEnemy();
      this.sig.addBlood(critter.pos.x, critter.pos.y + 0.3, critter.pos.z, 0.8);
      critter.fleeing = 6;
      this.attackCd = 0.45;
      if (critter.hp <= 0) this.killCritter(critter);
      return;
    }
  }

  raycastCritter(origin, dir, reach) {
    for (const c of this.critters) {
      const toC = new THREE.Vector3(c.pos.x, c.pos.y + 0.4, c.pos.z).sub(origin);
      const t = toC.dot(dir);
      if (t < 0 || t > reach) continue;
      const closest = origin.clone().add(dir.clone().multiplyScalar(t));
      if (closest.distanceTo(new THREE.Vector3(c.pos.x, c.pos.y + 0.4, c.pos.z)) < 0.6) return c;
    }
    return null;
  }

  killCritter(c) {
    this.scene.remove(c.mesh);
    this.critters = this.critters.filter(x => x !== c);
    this.dropItemAt(c.pos, 'raw_meat', 1 + (Math.random() < 0.4 ? 1 : 0));
    this.toast('Fresh meat. Fresh blood — the smell carries.', '');
  }

  onSecondary() {
    const held = this.player.heldItem();
    if (!held) return;
    const def = held.def;
    // consumables
    if (def.food) {
      this.player.feed(def.food);
      if (def.sanity) this.sanity.addSuppressant(def.sanity);
      if (held.id === 'raw_meat') { this.sanity.addSuppressant(-3); this.toast('Raw. Your gut will complain.'); }
      this.inv.remove(held.id, 1);
      this.audio.eat();
      this.hud.updateHotbar();
      return;
    }
    if (held.id === 'suppressant') {
      this.sanity.addSuppressant(ITEMS.suppressant.sanity);
      this.inv.remove('suppressant', 1);
      this.audio.eat();
      this.toast('Neural suppressant administered.');
      this.hud.updateHotbar();
      return;
    }
    // block placement
    if (def.block != null) {
      const hit = this.player.raycast();
      if (!hit) return;
      const bd = BLOCKS[def.block];
      let tx = hit.x + hit.face[0], ty = hit.y + hit.face[1], tz = hit.z + hit.face[2];
      // torches / wires can replace air only; solid blocks must not intersect entities
      if (!this.world.inBounds(tx, ty, tz)) return; // world.set would no-op — don't eat the item
      if (this.world.get(tx, ty, tz) !== B.AIR) return;
      if (bd.solid && this.wouldCollide(tx, ty, tz)) { this.toast('Blocked.'); return; }
      this.placeBlock(tx, ty, tz, def.block);
      this.inv.remove(held.id, 1);
      this.hud.updateHotbar();
    }
  }

  wouldCollide(x, y, z) {
    const p = this.player.pos;
    const r = PLAYER.radius;
    if (x + 1 > p.x - r && x < p.x + r && y + 1 > p.y && y < p.y + PLAYER.height && z + 1 > p.z - r && z < p.z + r) return true;
    for (const inf of this.infected.list) {
      if (inf.dead || inf.isFalse) continue;
      if (x + 1 > inf.pos.x - 0.4 && x < inf.pos.x + 0.4 && y + 1 > inf.pos.y && y < inf.pos.y + 1.8 && z + 1 > inf.pos.z - 0.4 && z < inf.pos.z + 0.4) return true;
    }
    return false;
  }

  placeBlock(x, y, z, id) {
    this.world.set(x, y, z, id);
    this.blockHp.delete(`${x},${y},${z}`); // fresh block, fresh HP
    this.sig.onBlockChanged(x, y, z, id);
    this.props.onBlockChanged(x, y, z, id);
    this.audio.place();
    const def = BLOCKS[id];
    if (def.machine) {
      const m = this.machines.add(x, y, z, id);
      if (def.machine === 'drill' && !this.machines.findOre(m)) this.toast('Drill has no ore body. Place it against ore.', 'important');
      if (def.machine === 'beacon') this.toast('Beacon placed. Register it and load an ampoule.', 'important');
    }
    if (id === B.FURNACE) this.furnaces.set(`${x},${y},${z}`, { x, y, z, type: 'furnace', fuel: 0, queue: [], progress: 0, out: {} });
    if (id === B.TORCH || id === B.CAMPFIRE) this.refreshBlockLight(x, y, z, id);
    if (id === B.DOOR) this.unlocks.doorHung = true; // objectives (persisted via save)
  }

  refreshBlockLight(x, y, z, id) {
    const key = `BL${x},${y},${z}`;
    if (id === B.TORCH) this.lights.set(key, x + 0.5, y + 0.4, z + 0.5, 0xffb347, 0.9, 9);
    else if (id === B.CAMPFIRE) this.lights.set(key, x + 0.5, y + 0.6, z + 0.5, 0xff9040, 1.3, 12);
    else this.lights.remove(key);
  }

  // Shared teardown when a block cell stops being what it was (mined or breached).
  clearBlockCell(x, y, z, id) {
    const key = `${x},${y},${z}`;
    this.blockHp.delete(key);
    this.sig.onBlockChanged(x, y, z, B.AIR);
    this.props.onBlockChanged(x, y, z, B.AIR);
    this.refreshBlockLight(x, y, z, B.AIR);
    if (BLOCKS[id]?.machine) this.machines.remove(x, y, z);
    if (id === B.FURNACE) {
      const f = this.furnaces.get(key);
      if (f) {
        // stop its emitter/light and spill contents rather than voiding them
        this.sig.removeDynamic('F' + key);
        this.lights.remove('F' + key);
        for (const job of f.queue) this.dropItemAt({ x: x + 0.5, y, z: z + 0.5 }, job.from, 1);
        for (const [iid, n] of Object.entries(f.out || {})) if (n > 0) this.dropItemAt({ x: x + 0.5, y, z: z + 0.5 }, iid, n);
        this.furnaces.delete(key);
      }
    }
  }

  breakBlock(x, y, z, held) {
    const id = this.world.get(x, y, z);
    const def = BLOCKS[id];
    if (!def) return;
    this.world.set(x, y, z, B.AIR);
    this.clearBlockCell(x, y, z, id);
    this.audio.breakBlock();
    this.inv.useToolDurability(1);
    // drops
    const drop = this.dropFor(id);
    if (drop) {
      const overflow = this.inv.add(drop.id, drop.n);
      if (overflow > 0) this.dropItemAt({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, drop.id, overflow);
      this.audio.pickup(); this.hud.updateHotbar();
    }
    // digging up turf sometimes yields plant fiber alongside the dirt
    if (id === B.GRASS && Math.random() < 0.3) {
      const over = this.inv.add('fiber', 1);
      if (over > 0) this.dropItemAt({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 'fiber', over);
      this.hud.updateHotbar();
    }
    // falling blocks above (sand/gravel) — settle the whole column
    let fy = y;
    while (BLOCKS[this.world.get(x, fy + 1, z)]?.falls) {
      const above = this.world.get(x, fy + 1, z);
      this.world.set(x, fy + 1, z, B.AIR);
      this.world.set(x, fy, z, above);
      fy++;
    }
  }

  dropFor(id) {
    switch (id) {
      case B.STONE: return { id: 'stone_shard', n: 1 };
      case B.IRON_ORE: return { id: 'iron_ore_raw', n: 1 };
      case B.COAL_ORE: return { id: 'coal', n: 1 + (Math.random() < 0.5 ? 1 : 0) };
      case B.GRASS: case B.DIRT: return { id: 'b:' + B.DIRT, n: 1 };
      // renewable gathering (Vintage Story style): foliage sheds sticks/fiber,
      // gravel hides knappable shards
      case B.LEAVES: return Math.random() < 0.4 ? { id: Math.random() < 0.6 ? 'stick' : 'fiber', n: 1 } : null;
      case B.GRAVEL: return Math.random() < 0.45 ? { id: 'stone_shard', n: 1 } : { id: 'b:' + B.GRAVEL, n: 1 };
      case B.COLONY: return Math.random() < 0.25 ? { id: 'iron_ampoule', n: 1 } : null;
      default:
        if (def2(id)?.drop != null) return { id: 'b:' + def2(id).drop, n: 1 };
        return null;
    }
  }

  interact() {
    const hit = this.player.raycast(PLAYER.reach);
    if (!hit) { this.tryEmergencyInteract(); return; }
    const def = BLOCKS[hit.id];
    if (def.archive) {
      if (this.story.isCataloged(def.archive)) { this.toast('Already cataloged. Duplicates add nothing.'); return; }
      this.pendingArchive = def.archive;
      const a = ARCHIVES[def.archive];
      $('catalog-title').textContent = a.title;
      const body = $('catalog-body');
      body.textContent = '';
      const meta = document.createElement('div'); meta.className = 'doc-meta'; meta.textContent = a.meta;
      const text = document.createElement('div'); text.textContent = a.body;
      body.appendChild(meta); body.appendChild(text);
      this.hud.show('catalog-card');
      return;
    }
    switch (def.interact) {
      case 'door': {
        const open = hit.id === B.DOOR_OPEN;
        if (open && this.wouldCollide(hit.x, hit.y, hit.z)) { this.toast('Something is in the doorway.'); return; }
        const newId = open ? B.DOOR : B.DOOR_OPEN;
        this.world.set(hit.x, hit.y, hit.z, newId);
        this.props.onBlockChanged(hit.x, hit.y, hit.z, newId); // swing the slab
        this.audio.place();
        return;
      }
      case 'bed': return this.trySleep();
      case 'campfire': return this.useCampfire();
      case 'bench': { this.openScreen('inv-screen'); return; }
      case 'furnace': {
        const f = this.furnaces.get(`${hit.x},${hit.y},${hit.z}`);
        if (f) this.hud.openMachine(f);
        return;
      }
      case 'machine': {
        const m = this.machines.get(hit.x, hit.y, hit.z);
        if (m) this.hud.openMachine(m);
        return;
      }
    }
    this.tryEmergencyInteract();
  }

  tryEmergencyInteract() {
    const e = this.world.poi.emergency;
    const d = Math.hypot(e.x + 0.5 - this.player.pos.x, e.y - this.player.pos.y, e.z + 0.5 - this.player.pos.z);
    if (d < 2.2) {
      const left = this.recovery.emergencyUses;
      this.toast(left > 0
        ? 'Emergency recovery pad: intact. One stabilization remaining.'
        : 'Emergency recovery pad: spent. It will not fire again.', left > 0 ? 'important' : 'bad');
    }
  }

  useCampfire() {
    if (this.inv.count('raw_meat') > 0) {
      this.inv.remove('raw_meat', 1);
      this.inv.add('cooked_meat', 1);
      this.audio.eat();
      this.toast('Cooked meat over the fire.');
      this.hud.updateHotbar();
    } else {
      this.toast('The fire is warm. Warmth is a signature.');
    }
  }

  trySleep() {
    if (this._sleeping) return;
    const frac = this.dayFrac;
    const night = frac >= TIME.DUSK || frac < TIME.DAWN;
    if (!night) { this.toast('You can only sleep at night.'); return; }
    if (this.director.assaultActive) { this.toast('Not during an assault.', 'bad'); return; }
    // the forecast major assault must be faced, not slept through (§6.2, §8.3)
    if (!this.director.assaultDoneForNight && frac >= TIME.DUSK) {
      this.toast('The forecast says something is coming. Sleep will not come first.', 'bad');
      return;
    }
    // nearby threats block sleep (§8.3)
    for (const inf of this.infected.list) {
      if (!inf.isFalse && !inf.dead && inf.pos.distanceTo(this.player.pos) < 18) {
        this.toast('Something is close. Sleep will not come.', 'bad');
        return;
      }
    }
    this._sleeping = true;
    $('night-fade').style.opacity = '1';
    setTimeout(() => {
      this._sleeping = false;
      $('night-fade').style.opacity = '0';
      if (this.state !== 'play') return; // died/paused/quit during the fade
      // advance to dawn
      const day0 = Math.floor(this.t / TIME.DAY_LENGTH);
      this.t = (day0 + 1) * TIME.DAY_LENGTH + TIME.DAWN * TIME.DAY_LENGTH + 1;
      this.sanity.addSuppressant(SANITY.sleepGain);
      this.player.hunger = Math.max(5, this.player.hunger - 8);
      this.director.onDawn();
      this.onNewDay();
      this.toast('You slept. Stability restored. A new day.', 'important');
    }, 900);
  }

  // ------------------------------------------------------------------
  // Furnace block-entity
  // ------------------------------------------------------------------
  furnaceAddFuel(f) {
    if (this.inv.count('coal') > 0) { this.inv.remove('coal', 1); f.fuel += 8; this.toast('Coal in the firebox.'); }
    else if (this.inv.count('b:' + B.LOG) > 0) { this.inv.remove('b:' + B.LOG, 1); f.fuel += 4; this.toast('Log in the firebox.'); }
    else this.toast('No fuel (coal or logs).');
  }
  furnaceAddJob(f, from, to) {
    if (this.inv.count(from) <= 0) { this.toast(`No ${itemDef(from)?.name}.`); return; }
    this.inv.remove(from, 1);
    f.queue.push({ from, to });
  }
  furnaceTake(f) {
    let any = false, stuck = false;
    for (const [id, n] of Object.entries(f.out || {})) {
      if (n > 0) {
        const overflow = this.inv.add(id, n);
        if (overflow < n) any = true;
        if (overflow > 0) stuck = true;
        f.out[id] = overflow;
      }
    }
    this.toast(stuck ? 'Inventory full — output left in the furnace.' : any ? 'Took furnace output.' : 'Nothing to take.');
  }
  updateFurnaces(dt) {
    for (const f of this.furnaces.values()) {
      const burning = f.fuel > 0 && f.queue.length > 0;
      const key = 'F' + f.x + ',' + f.y + ',' + f.z;
      if (burning) {
        f.fuel = Math.max(0, f.fuel - dt);
        f.progress += dt;
        this.sig.setDynamic(key, f.x, f.y, f.z, { heat: 0.55, light: 0.2 }, 12);
        this.lights.set(key, f.x + 0.5, f.y + 0.6, f.z + 0.5, 0xff7030, 0.7, 7);
        if (f.progress >= 4) {
          f.progress = 0;
          const job = f.queue.shift();
          f.out[job.to] = (f.out[job.to] || 0) + 1;
          if (job.to === 'iron_ingot') this.maybeReachIron();
        }
      } else {
        f.progress = 0;
        this.sig.removeDynamic(key);
        this.lights.remove(key);
      }
    }
  }

  maybeReachIron() {
    if (this.tiers.has('iron')) return;
    this.tiers.add('iron');
    this.addValley('ironTier');
    this.toast('IRON FOUNDATION reached. New fabrication available: combat, defense, or productivity.', 'important');
  }

  // ------------------------------------------------------------------
  // Combat / world callbacks
  // ------------------------------------------------------------------
  blockHp = new Map();

  // `amount` is damage in HP (callers pre-multiply by dt for per-second rates)
  infectedAttackBlock(x, y, z, amount, inf) {
    const id = this.world.get(x, y, z);
    const def = BLOCKS[id];
    if (!def || !def.solid) return;
    if (def.hardness === Infinity) return;
    const key = `${x},${y},${z}`;
    const maxHp = (def.armor || 1) * (def.hardness || 1) * 8;
    const hp = (this.blockHp.get(key) ?? maxHp) - amount;
    if (hp <= 0) {
      this.world.set(x, y, z, B.AIR);
      this.clearBlockCell(x, y, z, id);
      this.toast(def.machine ? `${def.name} destroyed!` : `${def.name} breached!`, 'bad');
      this.audio.breakBlock();
    } else {
      this.blockHp.set(key, hp);
      if (Math.random() < 0.05) this.audio.dig();
    }
  }

  onInfectedKilled(inf) {
    this.score += SCORE.perKill[inf.strainKey] || 5;
    this.hud.updateScore();
    if (inf.strainKey === 'colony_host') this.onBossKilled(inf);
  }

  onPlayerHurt(cause) {
    this.audio.hurt();
    this.hud.updateBars();
  }

  onAssaultCleared() {
    this.score += SCORE.perAssault;
    this.addValley('firstAssault');
    this.hud.updateScore();
  }

  addScore(n) { this.score += n; this.hud.updateScore(); }

  addValley(flag) {
    if (this.valleyFlags.has(flag)) return;
    this.valleyFlags.add(flag);
    this.hud.updateScore();
  }

  get valleyRecovery() {
    let v = 0;
    for (const f of this.valleyFlags) {
      if (f.startsWith('archive')) v += SCORE.valley.archive;
      else v += SCORE.valley[f] || 0;
    }
    return Math.min(100, v);
  }

  onCrafted(r) {
    if (r.spec && !this.specCrafts.has(r.spec)) {
      this.specCrafts.add(r.spec);
      this.toast(`Specialization forged: ${r.spec}.`, 'important');
    }
    if (r.id === 'beacon') this.toast('Place the beacon, power it, register it, and load an ampoule.', 'important');
  }

  onArchiveCataloged(a) {
    this.addValley('archive' + a.id);
    if (a.overlay === 'heat') { this.unlocks.sigPanel = true; }
    if (a.overlay === 'all') { this.unlocks.sigPanel = true; this.unlocks.sigAll = true; }
    if (a.id === 3 && !this.bossDead) {
      const c = this.world.poi.colony;
      const dx = c.x - this.player.pos.x, dz = c.z - this.player.pos.z;
      const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : (dz > 0 ? 'south' : 'north');
      this.toast(`A mineralized colony seals an iron seam ${dir} of here, underground. Purge it.`, 'important');
    }
  }

  // ---------------- boss ----------------
  maybeSpawnBoss() {
    if (this.bossDead || this.bossSpawned) return;
    const c = this.world.poi.colony;
    const d = Math.hypot(c.x - this.player.pos.x, c.y - this.player.pos.y, c.z - this.player.pos.z);
    if (d < 22) {
      const s = c.hostSpawn;
      this.boss = this.infected.spawn('colony_host', s.x, s.y, s.z, {});
      this.boss.home = { x: s.x, y: s.y, z: s.z };
      this.bossSpawned = true;
      this.beastSeen.add('colony_host');
      this.audio.bossRoar();
      this.toast('The wall is breathing. A colony host wakes.', 'bad');
    }
  }

  onBossDamaged(boss) {
    const fracs = [0.75, 0.5, 0.25];
    for (const f of fracs) {
      if (boss.hp < boss.s.hp * f && !this.bossHpMarks.has(f)) {
        this.bossHpMarks.add(f);
        for (let i = 0; i < 2; i++) {
          const ang = Math.random() * Math.PI * 2;
          this.infected.spawn('drifter', boss.pos.x + Math.cos(ang) * 2, boss.pos.y, boss.pos.z + Math.sin(ang) * 2, {});
        }
        this.toast('The colony sheds defenders!', 'bad');
      }
    }
  }

  onBossKilled(inf) {
    this.bossDead = true;
    this.boss = null;
    this.addValley('miniboss');
    // The location changes: mineralized colony crumbles, exposing the seam (§11.3).
    const c = this.world.poi.colony;
    let cleared = 0;
    for (let x = c.x - 6; x <= c.x + 8; x++)
      for (let y = c.y - 4; y <= c.y + 4; y++)
        for (let z = c.z - 6; z <= c.z + 6; z++) {
          if (this.world.get(x, y, z) === B.COLONY) { this.world.set(x, y, z, B.GRAVEL); cleared++; }
        }
    this.dropItemAt({ x: inf.pos.x, y: inf.pos.y, z: inf.pos.z }, 'iron_ampoule', 2);
    this.dropItemAt({ x: inf.pos.x + 0.6, y: inf.pos.y, z: inf.pos.z }, 'suppressant', 2);
    this.toast('The colony collapses into brittle mineral. The iron seam is exposed.', 'important');
    this.audio.bossRoar();
  }

  // ---------------- death & recovery ----------------
  onPlayerDeath(cause) {
    if (this.state !== 'play') return;
    this.state = 'dead';
    this.player.miningHeld = false;
    this.audio.die();
    // The ladder is evaluated NOW — power validity at the moment of death (§13.2).
    this.deathResult = this.recovery.resolve();
    const body = $('death-body');
    body.textContent = '';
    const p1 = document.createElement('p');
    p1.textContent = `You were lost to ${cause || 'the valley'}.`;
    body.appendChild(p1);
    const p2 = document.createElement('p');
    p2.style.marginTop = '10px';
    if (this.deathResult) {
      const kindText = {
        cradle: 'The Lazarus Cradle spins up. Continuity holds.',
        beacon: 'A field beacon fires its ampoule. Continuity holds — one charge spent.',
        emergency: 'The refuge emergency pad fires. It will never fire again.',
      }[this.deathResult.kind];
      p2.textContent = kindText + ' Your kit remains at your body.';
    } else {
      p2.textContent = 'No cradle. No charged beacon. Nothing left to catch you.';
    }
    body.appendChild(p2);
    this.hud.show('death-screen');
    $('btn-respawn').textContent = this.deathResult ? 'Stabilize' : 'Accept';
  }

  applyRespawn() {
    if (!this.deathResult) {
      // Run failure (§13.3): archive the world; save is no longer active.
      SaveStore.archiveFailed();
      const fb = $('fail-body');
      fb.textContent = '';
      const mk = (t) => { const p = document.createElement('p'); p.style.marginTop = '8px'; p.textContent = t; fb.appendChild(p); };
      mk(`The valley keeps what it takes. Days survived: ${this.day}. Score: ${this.score}. Valley recovery: ${this.valleyRecovery}%.`);
      mk('Every recovery layer was unavailable. The run has failed; the world is archived.');
      this.hud.show('fail-screen');
      this.state = 'failed';
      this.updateMenu();
      return;
    }
    const r = this.deathResult.respawn;
    this.player.health = RECOVERY.respawnHealth;
    this.player.hunger = 60;
    this.sanity.value = Math.max(this.sanity.value, RECOVERY.respawnSanity);
    this.player.spawnAt(r);
    if (this.deathResult.kind === 'emergency' && this.emergencyCore) {
      this.emergencyCore.material.color.setHex(0x3a3f3a);
      this.lights.remove('emergency');
    }
    this.state = 'play';
    this.hud.closeAll();
    this.hud.updateRecovery();
    this.hud.updateBars();
    this.audio.recover();
    this.requestLock();
    SaveStore.write(this);
  }

  // ------------------------------------------------------------------
  // Effects
  // ------------------------------------------------------------------
  spawnTracer(a, b, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.effects.push({ mesh: line, ttl: 0.09 });
    this.audio.turret();
  }

  spawnHitSpark(pos, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    m.position.set(pos.x, pos.y + 1, pos.z);
    this.scene.add(m);
    this.effects.push({ mesh: m, ttl: 0.25 });
  }

  setMineOverlay(hit, progress = 0) {
    if (!this._mineBox) {
      this._mineBox = new THREE.Mesh(
        new THREE.BoxGeometry(1.02, 1.02, 1.02),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }));
      this._mineBox.visible = false;
      this.scene.add(this._mineBox);
    }
    if (!hit) { this._mineBox.visible = false; this.hud.mineRing(null); return; }
    this._mineBox.visible = true;
    this._mineBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this._mineBox.material.opacity = 0.3 + progress * 0.6;
    this.hud.mineRing(progress);
    if (Math.random() < 0.3) this.audio.dig();
  }

  onWorldEditVisual() { /* chunk remesh handled by flushDirty */ }

  toast(msg, cls) { this.hud.toast(msg, cls); }

  // ------------------------------------------------------------------
  // Environment queries
  // ------------------------------------------------------------------
  isNight() { return this.dayFrac >= TIME.DUSK || this.dayFrac < TIME.DAWN; }

  daylight() {
    // 0 at midnight, 1 at noon; smooth ramps at dawn/dusk
    const f = this.dayFrac;
    if (f < TIME.DAWN - 0.04 || f > TIME.NIGHT) return 0.02;
    if (f < TIME.DAWN_END) return 0.02 + 0.98 * ((f - (TIME.DAWN - 0.04)) / (TIME.DAWN_END - TIME.DAWN + 0.04));
    if (f > TIME.DUSK) return Math.max(0.02, 1 - (f - TIME.DUSK) / (TIME.NIGHT - TIME.DUSK));
    return 1;
  }

  playerLightLevel() {
    const p = this.player.pos;
    const underSky = this.world.skyTop(Math.floor(p.x), Math.floor(p.z)) <= Math.floor(p.y + 1.6);
    let level = this.daylight() * (underSky ? 1 : 0.15);
    // nearby artificial lights
    for (const e of this.lights.emitters.values()) {
      const d = Math.hypot(e.x - p.x, e.y - (p.y + 1), e.z - p.z);
      if (d < e.range) level = Math.max(level, 0.9 * (1 - d / e.range));
    }
    return Math.min(1, level);
  }

  nearStation(type) {
    const p = this.player.pos;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    const want = type === 'bench' ? B.BENCH : B.FURNACE;
    for (let dx = -4; dx <= 4; dx++)
      for (let dy = -2; dy <= 3; dy++)
        for (let dz = -4; dz <= 4; dz++)
          if (this.world.get(px + dx, py + dy, pz + dz) === want) return true;
    return false;
  }

  // ------------------------------------------------------------------
  // Day/night visuals + clock
  // ------------------------------------------------------------------
  updateSky() {
    const dl = this.daylight();
    const f = this.dayFrac;
    const sunAngle = (f - 0.25) * Math.PI * 2;
    this.sun.position.set(Math.cos(sunAngle) * 80, Math.sin(sunAngle) * 100, 30);
    this.sun.intensity = Math.max(0.02, dl) * 1.15;
    this.hemi.intensity = 0.18 + dl * 0.85;
    const day = new THREE.Color(0x9db4c8);
    const dusk = new THREE.Color(0x8a5a48);
    const night = new THREE.Color(0x0a0f1a);
    let sky;
    if (f > TIME.DUSK && f < TIME.NIGHT) {
      sky = dusk.clone().lerp(night, (f - TIME.DUSK) / (TIME.NIGHT - TIME.DUSK));
    } else if (dl <= 0.05) sky = night;
    else if (f > TIME.DAWN - 0.04 && f < TIME.DAWN_END) sky = night.clone().lerp(day, dl);
    else sky = day;
    this.scene.fog.color.copy(sky);
    this.renderer.setClearColor(sky);
    // subtle night fear: fog closes in
    this.scene.fog.near = 30 + dl * 25;
    this.scene.fog.far = 110 + dl * 110;
  }

  onNewDay() {
    this.day = Math.floor(this.t / TIME.DAY_LENGTH) + 1;
    this.score += SCORE.perDay;
    this.addValley('firstNightSurvived');
    this.hud.updateScore();
    SaveStore.write(this);
  }

  // ------------------------------------------------------------------
  // Frame loop
  // ------------------------------------------------------------------
  frame() {
    this._lastFrameAt = performance.now();
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.state === 'play') this.update(dt);
    if (this.world) this.world.flushDirty(8);
    this.lights.update(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    this.t += dt;
    const prevFrac = this.dayFrac;
    this.dayFrac = (this.t % TIME.DAY_LENGTH) / TIME.DAY_LENGTH;
    // dawn crossing → new day bookkeeping
    if (prevFrac < TIME.DAWN && this.dayFrac >= TIME.DAWN) {
      this.director.onDawn();
      this.onNewDay();
      this.toast(`Dawn. Day ${this.day}.`, 'important');
    }

    this.attackCd = Math.max(0, this.attackCd - dt);

    this.player.update(dt);
    this.sig.update(dt);
    this.machines.update(dt);
    this.props.update(dt);
    this.updateFurnaces(dt);
    this.infected.update(dt);
    this.director.update(dt, this.dayFrac);
    this.sanity.update(dt);
    this.recovery.update(dt);
    this.updatePickups(dt);
    this.updateCritters(dt);
    this.updateEffects(dt);
    this.maybeSpawnBoss();
    if (this.boss && !this.boss.dead) this.onBossDamaged(this.boss);
    this.updateSky();
    this.updateHints();

    // track newly seen strains for the bestiary
    for (const inf of this.infected.list) if (!inf.isFalse) this.beastSeen.add(inf.strainKey);

    // ambient cyst clicking when spores are near (readable pre-breach cue, §5.5)
    this.cystClickT -= dt;
    if (this.cystClickT <= 0) {
      this.cystClickT = 1.5 + Math.random() * 3;
      if (this.sanity.sporeExposure() > 0.05) this.audio.cystClick();
    }

    // discovering the buried lab (valley recovery §14 + objective)
    if (!this.valleyFlags.has('labFound') && this.world.poi.lab) {
      const L = this.world.poi.lab;
      if (Math.abs(this.player.pos.x - L.x) < 8 && Math.abs(this.player.pos.z - L.z) < 8
        && Math.abs(this.player.pos.y - L.y) < 5) {
        this.addValley('labFound');
        this.toast('A Project Lazarus site. Catalog what remains.', 'important');
      }
    }

    // generator ambience
    let genRunning = false;
    for (const m of this.machines.map.values()) if (m && m.type === 'generator' && m.running) genRunning = true;
    if (genRunning && !this.unlocks.genRan) this.unlocks.genRan = true; // persisted via save
    const nearGen = genRunning && [...this.machines.map.values()].some(m => m && m.type === 'generator' && m.running &&
      Math.hypot(m.x - this.player.pos.x, m.z - this.player.pos.z) < 14);
    this.audio.setHum(nearGen, 0.05);

    // power warnings
    const np = this.machines.networkPower;
    this.hud.powerWarning(np.demand > np.capacity && np.demand > 0 ? `POWER SHORTFALL: ${np.demand}kW needed / ${np.capacity}kW available` : null);

    // a machine panel open for a machine that no longer exists must close
    // (destroyed while the player was reading it — no stale duplication)
    if (this.hud.activeScreen === 'machine-screen' && this.hud.machineOpen) {
      const m = this.hud.machineOpen;
      const alive = m.type === 'furnace'
        ? this.furnaces.get(`${m.x},${m.y},${m.z}`) === m
        : this.machines.get(m.x, m.y, m.z) === m;
      if (!alive) {
        this.hud.closeAll();
        this.toast('The machine is gone.', 'bad');
        this.requestLock();
      }
    }

    // interact prompt
    this.uiTick -= dt;
    if (this.uiTick <= 0) {
      this.uiTick = 0.12;
      this.updatePrompt();
      this.hud.updateBars();
      this.hud.updateClock();
      this.hud.updateThreat();
      this.hud.updateSigPanel();
      this.hud.updateRecovery();
      this.hud.updateSanityFx();
      this.hud.updateObjectives();
    }

    // autosave
    this.autosaveT -= dt;
    if (this.autosaveT <= 0) { this.autosaveT = 30; SaveStore.write(this); }
  }

  updatePrompt() {
    const hit = this.player.raycast(PLAYER.reach);
    let text = null;
    if (hit) {
      const def = BLOCKS[hit.id];
      if (def.archive) text = this.story.isCataloged(def.archive) ? `${def.name} (cataloged)` : `[F] Examine document — ${def.name}`;
      else if (def.interact === 'door') text = '[F] Open / close door';
      else if (def.interact === 'bed') text = '[F] Sleep (night only, when safe)';
      else if (def.interact === 'campfire') text = '[F] Cook / warm up';
      else if (def.interact === 'bench') text = '[F] Use crafting bench';
      else if (def.interact === 'furnace') text = '[F] Use furnace';
      else if (def.interact === 'machine') text = `[F] ${def.name}`;
      else if (def.hardness != null && def.hardness !== Infinity && !this.player.miningHeld) {
        // mineable readout: name + how to break it + best tool
        const verbs = { pick: 'mine', axe: 'chop', shovel: 'dig' };
        const names = { pick: 'pickaxe', axe: 'axe', shovel: 'shovel' };
        const held = this.player.heldItem();
        let hint = `hold LMB to ${verbs[def.tool] || 'break'}`;
        if (def.toolMin != null && !(held?.def?.tool === def.tool && held.def.tier >= def.toolMin))
          hint = `needs an iron ${names[def.tool]}`;
        else if (def.tool && held?.def?.tool !== def.tool)
          hint += ` (${names[def.tool]} is faster)`;
        text = `${def.name} — ${hint}`;
      }
    } else {
      const e = this.world.poi.emergency;
      if (Math.hypot(e.x + 0.5 - this.player.pos.x, e.z + 0.5 - this.player.pos.z) < 2.2 && Math.abs(e.y - this.player.pos.y) < 2)
        text = '[F] Emergency recovery pad';
    }
    this.hud.prompt(text);
  }

  updatePickups(dt) {
    const p = this.player.pos;
    for (const pk of this.pickups) {
      pk.bob += dt * 2;
      if (!pk.grounded) { // scatter litter lies still until magnetized
        pk.mesh.position.y = pk.y + Math.sin(pk.bob) * 0.08;
        pk.mesh.rotation.y += dt;
      }
      const d = Math.hypot(pk.x - p.x, pk.y - (p.y + 0.8), pk.z - p.z);
      if (d < 2.0) { // magnet
        pk.grounded = false;
        pk.x += (p.x - pk.x) * 6 * dt;
        pk.y += (p.y + 0.8 - pk.y) * 6 * dt;
        pk.z += (p.z - pk.z) * 6 * dt;
        pk.mesh.position.set(pk.x, pk.y, pk.z);
      }
      if (d < 0.9) {
        const overflow = this.inv.add(pk.item, pk.n);
        if (overflow < pk.n) { this.audio.pickup(); this.hud.updateHotbar(); }
        pk.n = overflow; // whatever didn't fit stays on the ground — no duplication
        if (overflow === 0) {
          pk.taken = true;
          if (pk.idx >= 0) this.pickupsTaken.add(pk.idx);
          if (pk.sigKey) this.sig.removeDynamic(pk.sigKey);
          this.scene.remove(pk.mesh);
          disposeGroup(pk.mesh);
        }
      }
    }
    this.pickups = this.pickups.filter(pk => !pk.taken);
  }

  updateCritters(dt) {
    const p = this.player.pos;
    for (const c of this.critters) {
      c.moveT -= dt;
      const dp = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if (dp < 7) { c.fleeing = 2; c.dir = Math.atan2(c.pos.x - p.x, c.pos.z - p.z); }
      if (c.fleeing > 0) c.fleeing -= dt;
      if (c.moveT <= 0) { c.moveT = 1 + Math.random() * 3; c.dir = Math.random() * Math.PI * 2; }
      const speed = c.fleeing > 0 ? 4.5 : 0.8;
      const nx = c.pos.x + Math.sin(c.dir) * speed * dt;
      const nz = c.pos.z + Math.cos(c.dir) * speed * dt;
      if (nx > 1 && nx < WORLD.SIZE_X - 1 && nz > 1 && nz < WORLD.SIZE_Z - 1) {
        const gy = this.world.skyTop(Math.floor(nx), Math.floor(nz));
        if (Math.abs(gy - c.pos.y) < 1.6) { c.pos.x = nx; c.pos.z = nz; c.pos.y = gy; }
        else c.dir += Math.PI / 2;
      } else c.dir += Math.PI;
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.y = c.dir;
    }
  }

  updateEffects(dt) {
    for (const e of this.effects) {
      e.ttl -= dt;
      if (e.ttl <= 0) { this.scene.remove(e.mesh); e.done = true; }
    }
    this.effects = this.effects.filter(e => !e.done);
  }

  updateHints() {
    // tiny staged guidance — enough to teach, never a tutorial wall
    const stage = this.hintStage;
    if (stage === 0 && (this.inv.count('stone_shard') >= 2 && this.inv.count('stick') >= 2)) {
      this.hintStage++;
      this.toast('You have enough for a tool. Open [E] and craft a pickaxe or axe.', 'important');
    } else if (stage === 1 && this.dayFrac > TIME.DUSK - 0.1 && this.dayFrac < TIME.DUSK) {
      this.hintStage++;
      this.toast('Dusk soon. Walls, a roof, and a door. The forecast will tell you what is coming.', 'important');
    } else if (stage === 2 && this.tiers.has('iron')) {
      this.hintStage++;
      this.toast('Iron opens the field beacon — your first rebuildable recovery. And the generator. Mind its signature.', 'important');
    }
  }
}

function def2(id) { return BLOCKS[id]; }

// boot
const game = new Game();
window.__game = game; // debugging hook

// ?scenario=<key>[&seed=<any>][&hardcore=1] — jump straight into a checkpoint
// world (see scenarios.js). Used for playtesting story sections and e2e tests.
// A real (non-scenario) save is never overwritten from a URL: that path needs
// an explicit click on the menu's DEV SCENARIOS buttons.
const params = new URLSearchParams(location.search);
const scenarioKey = params.get('scenario');
if (scenarioKey && SCENARIOS[scenarioKey]) {
  const existing = SaveStore.read();
  if (existing && !existing.scenario) {
    console.warn('Refusing to replace a real save from a ?scenario= link. Use the DEV SCENARIOS menu buttons.');
  } else {
    SaveStore.clear();
    game.newWorld(params.get('hardcore') === '1', scenarioKey, params.get('seed'));
    // strip the param so a reload continues the (autosaved) scenario world
    // instead of wiping it and rolling a fresh seed
    history.replaceState(null, '', location.pathname);
  }
} else if (scenarioKey) {
  console.warn(`Unknown scenario "${scenarioKey}". Valid: ${Object.keys(SCENARIOS).join(', ')}`);
}
