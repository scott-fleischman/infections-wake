import * as THREE from 'three';
import { B, BLOCKS, STRAINS } from './config.js';

// ============================================================================
// Model registry. Every non-cube visual in the game is built here so the
// world (props.js), the infected (infected.js) and the gallery page share one
// source of truth.
//
// Conventions:
//  - build*() returns a THREE.Group whose origin is the CENTER-BOTTOM of the
//    occupied cell: place it at (x + 0.5, y, z + 0.5).
//  - Fresh geometries/materials per call — safe to dispose per instance.
//  - group.userData carries animation hooks consumed by animateProp():
//      spin:   [{ mesh, axis, rate }]   rotate while "running"
//      head:   Object3D                 turret yaw aim (forward = +Z)
//      glow:   [{ mat, on, off }]       color swap with power state
//      flames: [{ mesh, seed }]         always-on fire flicker
//      pulse:  [{ mat, seed }]          gentle opacity sine (transparent mats)
// ============================================================================

const P = {
  steel: 0x3a4048, steelDark: 0x24282e, steelLight: 0x565e68,
  amber: 0xe0a83e, amberHot: 0xffcf6e,
  red: 0xc9524a, teal: 0x74c7c4, green: 0x7fae62, violet: 0x9d8fd4,
  wood: 0x8a6a3e, woodDark: 0x6b4e2e, woodDeep: 0x4d3a22,
  stoneDark: 0x4a4a4a,
  off: 0x2a2620,
};

const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
const glowMat = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, ...opts });

function box(parent, w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cyl(parent, rTop, rBot, h, mat, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cone(parent, r, h, mat, x = 0, y = 0, z = 0, seg = 6) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function ud(g) {
  g.userData.spin = g.userData.spin || [];
  g.userData.glow = g.userData.glow || [];
  g.userData.flames = g.userData.flames || [];
  g.userData.pulse = g.userData.pulse || [];
  return g.userData;
}

// ---------------------------------------------------------------------------
// Machines & structures
// ---------------------------------------------------------------------------

function buildGenerator() {
  const g = new THREE.Group(); const u = ud(g);
  box(g, 0.92, 0.1, 0.72, lambert(P.steelDark), 0, 0.05, 0);                 // skid
  box(g, 0.55, 0.44, 0.5, lambert(P.steel), -0.08, 0.36, 0);                 // engine block
  box(g, 0.62, 0.1, 0.56, lambert(P.steelLight), -0.08, 0.62, 0);           // head
  box(g, 0.08, 0.06, 0.08, lambert(P.amber), -0.24, 0.7, 0.12);             // fuel cap
  cyl(g, 0.05, 0.05, 0.5, lambert(P.steelDark), 0.3, 0.82, -0.2);           // exhaust stack
  cyl(g, 0.06, 0.06, 0.06, lambert(0x151515), 0.3, 1.09, -0.2);             // stack tip
  const wheel = cyl(g, 0.2, 0.2, 0.07, lambert(P.amber), 0.31, 0.34, 0.14); // flywheel
  wheel.rotation.z = Math.PI / 2;
  box(g, 0.03, 0.34, 0.03, lambert(P.steelDark), 0.36, 0.34, 0.14);         // wheel spoke guard
  const strip = box(g, 0.32, 0.05, 0.02, glowMat(P.off), -0.08, 0.28, 0.26);// status strip
  u.spin.push({ mesh: wheel, axis: 'x', rate: 7 });
  u.glow.push({ mat: strip.material, on: P.amberHot, off: P.off });
  return g;
}

function buildDrill() {
  const g = new THREE.Group(); const u = ud(g);
  box(g, 0.86, 0.08, 0.86, lambert(P.steelDark), 0, 0.04, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    box(g, 0.08, 0.62, 0.08, lambert(P.steel), sx * 0.35, 0.39, sz * 0.35); // frame legs
  box(g, 0.54, 0.06, 0.54, lambert(P.amber), 0, 0.7, 0);                    // hazard band
  box(g, 0.5, 0.28, 0.5, lambert(P.steel), 0, 0.87, 0);                     // gearbox
  const bit = cyl(g, 0.15, 0.03, 0.56, lambert(P.steelLight), 0, 0.4, 0);   // bit (tip down)
  const lampBox = box(g, 0.14, 0.1, 0.03, glowMat(P.off), 0, 0.9, 0.26);    // status lamp
  u.spin.push({ mesh: bit, axis: 'y', rate: 12 });
  u.glow.push({ mat: lampBox.material, on: 0xff6a5a, off: P.off });
  return g;
}

function buildTurret() {
  const g = new THREE.Group(); const u = ud(g);
  box(g, 0.66, 0.14, 0.66, lambert(P.steelDark), 0, 0.07, 0);               // plinth
  cyl(g, 0.13, 0.17, 0.3, lambert(P.steel), 0, 0.29, 0);                    // pedestal
  const head = new THREE.Group();
  head.position.set(0, 0.55, 0);
  g.add(head);
  box(head, 0.38, 0.22, 0.42, lambert(P.steel), 0, 0, 0);                   // head body
  for (const sx of [-1, 1]) {
    const barrel = cyl(head, 0.035, 0.035, 0.44, lambert(P.steelDark), sx * 0.09, 0.02, 0.3);
    barrel.rotation.x = Math.PI / 2;                                         // barrels → +Z
    cyl(head, 0.05, 0.05, 0.05, lambert(0x151515), sx * 0.09, 0.02, 0.5).rotation.x = Math.PI / 2;
  }
  const eye = box(head, 0.12, 0.05, 0.03, glowMat(0x1c2a2a), 0, 0.1, 0.22); // sensor eye
  box(head, 0.3, 0.05, 0.3, lambert(P.steelDark), 0, 0.14, -0.04);          // top plate
  u.head = head;
  u.glow.push({ mat: eye.material, on: P.teal, off: 0x1c2a2a });
  return g;
}

function buildLamp() {
  const g = new THREE.Group(); const u = ud(g);
  box(g, 0.26, 0.06, 0.26, lambert(P.steelDark), 0, 0.03, 0);
  cyl(g, 0.035, 0.05, 0.76, lambert(P.steel), 0, 0.42, 0);
  box(g, 0.32, 0.12, 0.32, lambert(P.steelDark), 0, 0.88, 0);               // housing
  const panel = box(g, 0.26, 0.05, 0.26, glowMat(P.off), 0, 0.8, 0);        // light panel
  box(g, 0.12, 0.05, 0.12, lambert(P.steelDark), 0, 0.96, 0);               // cap
  u.glow.push({ mat: panel.material, on: 0xffe9a8, off: P.off });
  return g;
}

function buildBeacon() {
  const g = new THREE.Group(); const u = ud(g);
  for (let i = 0; i < 3; i++) {                                             // tripod
    const a = (i / 3) * Math.PI * 2;
    const leg = box(g, 0.06, 0.52, 0.06, lambert(P.steelDark), Math.cos(a) * 0.27, 0.24, Math.sin(a) * 0.27);
    leg.rotation.y = -a;
    leg.rotation.z = 0.4;
  }
  cyl(g, 0.08, 0.11, 0.6, lambert(0x2f3c38), 0, 0.46, 0);                   // column
  cyl(g, 0.015, 0.015, 0.42, lambert(P.steelLight), 0, 0.95, 0);            // antenna
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), glowMat(0x27331f, { transparent: true, opacity: 0.9 }));
  tip.position.set(0, 1.18, 0); g.add(tip);
  const ring = new THREE.Group(); ring.position.y = 0.62; g.add(ring);      // rotating scan ring
  const torus = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.018, 6, 20), lambert(P.green));
  torus.rotation.x = Math.PI / 2; ring.add(torus);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    box(ring, 0.05, 0.05, 0.05, lambert(0xb5e69a), Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24);
  }
  u.spin.push({ mesh: ring, axis: 'y', rate: 1.6 });
  u.glow.push({ mat: tip.material, on: 0xb5e69a, off: 0x27331f });
  u.pulse.push({ mat: tip.material, seed: 1 });
  return g;
}

function buildBench() {
  const g = new THREE.Group();
  box(g, 0.96, 0.08, 0.7, lambert(P.wood), 0, 0.58, 0);                     // top
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    box(g, 0.08, 0.56, 0.08, lambert(P.woodDark), sx * 0.4, 0.28, sz * 0.26);
  box(g, 0.8, 0.06, 0.5, lambert(P.woodDeep), 0, 0.5, 0);                   // apron shelf
  box(g, 0.14, 0.1, 0.1, lambert(P.steelDark), 0.32, 0.67, 0.18);           // vise
  box(g, 0.2, 0.04, 0.08, lambert(P.amber), -0.2, 0.64, -0.12);             // tool on top
  box(g, 0.06, 0.04, 0.22, lambert(0x9aa0a6), -0.02, 0.64, 0.12);           // blade stock
  return g;
}

function buildFurnace() {
  const g = new THREE.Group(); const u = ud(g);
  box(g, 0.9, 0.9, 0.9, lambert(P.stoneDark), 0, 0.45, 0);                  // body
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    box(g, 0.14, 0.94, 0.14, lambert(0x5a5a5a), sx * 0.39, 0.47, sz * 0.39);// corner stones
  box(g, 0.36, 0.32, 0.06, lambert(0x141210), 0, 0.26, 0.44);               // mouth
  const ember = box(g, 0.28, 0.18, 0.04, glowMat(0x1a1210), 0, 0.22, 0.46); // firebox glow
  box(g, 0.24, 0.34, 0.24, lambert(0x3a3a3a), 0.2, 1.03, -0.2);             // chimney
  u.glow.push({ mat: ember.material, on: 0xff7030, off: 0x1a1210 });
  u.pulse.push({ mat: ember.material, seed: 2 });
  ember.material.transparent = true;
  return g;
}

function buildCampfire() {
  const g = new THREE.Group(); const u = ud(g);
  cyl(g, 0.22, 0.22, 0.04, lambert(0x2a2a2a), 0, 0.02, 0, 10);              // ash bed
  for (let i = 0; i < 6; i++) {                                             // stone ring
    const a = (i / 6) * Math.PI * 2;
    const s = box(g, 0.16, 0.1, 0.11, lambert(0x6c6a66), Math.cos(a) * 0.36, 0.05, Math.sin(a) * 0.36);
    s.rotation.y = -a;
  }
  for (let i = 0; i < 3; i++) {                                             // crossed logs
    const l = box(g, 0.52, 0.09, 0.09, lambert(P.woodDeep), 0, 0.1, 0);
    l.rotation.y = i * 2.1; l.rotation.z = 0.08;
  }
  const flames = [
    cone(g, 0.11, 0.38, glowMat(0xff9040, { transparent: true, opacity: 0.85 }), 0, 0.3, 0),
    cone(g, 0.07, 0.26, glowMat(P.amberHot, { transparent: true, opacity: 0.8 }), 0.09, 0.24, 0.05),
    cone(g, 0.06, 0.22, glowMat(P.amberHot, { transparent: true, opacity: 0.8 }), -0.08, 0.22, -0.06),
  ];
  flames.forEach((f, i) => u.flames.push({ mesh: f, seed: i * 2.1 }));
  return g;
}

function buildTorch() {
  const g = new THREE.Group(); const u = ud(g);
  const stick = box(g, 0.05, 0.42, 0.05, lambert(P.woodDark), 0, 0.21, 0);
  stick.rotation.z = 0.06;
  box(g, 0.075, 0.09, 0.075, lambert(P.woodDeep), 0.01, 0.4, 0);            // wrap
  const ember = box(g, 0.1, 0.11, 0.1, glowMat(0xffb347, { transparent: true, opacity: 0.95 }), 0.02, 0.49, 0);
  u.flames.push({ mesh: ember, seed: 0.7 });
  u.pulse.push({ mat: ember.material, seed: 0.7 });
  return g;
}

// opts: { open: bool, axis: 'x' | 'z' } — axis is the direction the wall runs
function buildDoor(opts = {}) {
  const g = new THREE.Group();
  const frame = lambert(P.woodDeep);
  box(g, 0.07, 1.0, 0.16, frame, -0.465, 0.5, 0);                           // hinge post
  box(g, 0.07, 1.0, 0.16, frame, 0.465, 0.5, 0);                            // latch post
  box(g, 1.0, 0.06, 0.16, frame, 0, 0.97, 0);                               // lintel
  const hinge = new THREE.Group();                                          // slab pivots here
  hinge.position.set(-0.43, 0, 0);
  g.add(hinge);
  const slab = new THREE.Group(); slab.position.set(0.43, 0, 0); hinge.add(slab);
  box(slab, 0.86, 0.94, 0.09, lambert(P.wood), 0, 0.5, 0);
  for (const sz of [-1, 1]) {                                               // panel insets
    box(slab, 0.6, 0.3, 0.02, lambert(P.woodDark), 0, 0.7, sz * 0.05);
    box(slab, 0.6, 0.3, 0.02, lambert(P.woodDark), 0, 0.28, sz * 0.05);
  }
  box(slab, 0.06, 0.06, 0.14, lambert(P.amber), 0.34, 0.5, 0);              // handle
  if (opts.open) hinge.rotation.y = 1.45;
  if (opts.axis === 'z') g.rotation.y = Math.PI / 2;
  return g;
}

function buildBed() {
  const g = new THREE.Group();
  box(g, 0.9, 0.14, 0.98, lambert(P.woodDark), 0, 0.13, 0);                 // frame
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    box(g, 0.08, 0.12, 0.08, lambert(P.woodDeep), sx * 0.4, 0.06, sz * 0.44);
  box(g, 0.82, 0.1, 0.9, lambert(0xcfc7b0), 0, 0.25, 0);                    // mattress
  box(g, 0.84, 0.07, 0.56, lambert(0x9a3b34), 0, 0.3, 0.18);                // blanket
  box(g, 0.5, 0.09, 0.24, lambert(0xe8e0cc), 0, 0.32, -0.32);               // pillow
  box(g, 0.9, 0.3, 0.06, lambert(P.woodDark), 0, 0.3, -0.47);               // headboard
  return g;
}

// opts: { tint: color of the archive slate }
function buildArchive(opts = {}) {
  const g = new THREE.Group(); const u = ud(g);
  const tint = opts.tint ?? 0xe8d8a8;
  box(g, 0.34, 0.34, 0.34, lambert(P.steelDark), 0, 0.17, 0);               // pedestal
  box(g, 0.42, 0.04, 0.42, lambert(P.steel), 0, 0.36, 0);                   // top plate
  const holo = new THREE.Group(); holo.position.y = 0.66; g.add(holo);
  const slate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.04),
    glowMat(tint, { transparent: true, opacity: 0.85 }));
  slate.rotation.x = -0.12; holo.add(slate);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 18),
    glowMat(tint, { transparent: true, opacity: 0.4 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.24; holo.add(ring);
  u.spin.push({ mesh: holo, axis: 'y', rate: 0.7 });
  u.pulse.push({ mat: slate.material, seed: 0 });
  return g;
}

function buildCradle() {
  const g = new THREE.Group(); const u = ud(g);
  box(g, 0.92, 0.2, 0.72, lambert(P.steelDark), 0, 0.1, 0);
  box(g, 0.64, 0.46, 0.52, lambert(0x34343e), 0, 0.43, 0);                  // pod
  const canopy = box(g, 0.5, 0.3, 0.4, glowMat(0x2f2a3a, { transparent: true, opacity: 0.7 }), 0, 0.68, 0);
  const strip = box(g, 0.6, 0.05, 0.02, glowMat(0x2f2a3a), 0, 0.3, 0.27);
  u.glow.push({ mat: canopy.material, on: 0x6a5aa8, off: 0x2f2a3a });
  u.glow.push({ mat: strip.material, on: P.violet, off: 0x2f2a3a });
  return g;
}

const BUILDERS = {
  generator: buildGenerator, drill: buildDrill, turret: buildTurret,
  lamp: buildLamp, beacon: buildBeacon, bench: buildBench, furnace: buildFurnace,
  campfire: buildCampfire, torch: buildTorch, door: buildDoor, bed: buildBed,
  archive: buildArchive, cradle: buildCradle,
};

export function buildProp(kind, opts = {}) {
  const fn = BUILDERS[kind];
  const g = fn ? fn(opts) : new THREE.Group();
  ud(g);
  g.userData.kind = kind;
  return g;
}

export const PROP_KINDS = Object.keys(BUILDERS);

// ---------------------------------------------------------------------------
// Infected bodies — one distinct silhouette per strain
// ---------------------------------------------------------------------------

export function buildInfectedMesh(strainKey) {
  const s = STRAINS[strainKey];
  const g = new THREE.Group();
  const mats = [];
  const M = (c) => { const m = lambert(c); mats.push(m); return m; };
  const col = new THREE.Color(s.color);
  const dark = col.clone().offsetHSL(0, 0, -0.09).getHex();
  const darker = col.clone().offsetHSL(0, -0.05, -0.16).getHex();
  const eyeMat = glowMat(s.boss ? 0xff5a3a : 0xd94f4f);
  let head = null;

  if (strainKey === 'runner') {
    for (const sx of [-1, 1]) {
      const leg = box(g, 0.1, 0.62, 0.1, M(dark), sx * 0.1, 0.31, -0.02);
      leg.rotation.x = -0.12;
    }
    const torso = box(g, 0.34, 0.56, 0.22, M(s.color), 0, 0.84, 0.08);
    torso.rotation.x = 0.55;                                   // deep forward lean
    for (const sx of [-1, 1]) {
      const arm = box(g, 0.08, 0.5, 0.08, M(dark), sx * 0.24, 0.72, 0.3);
      arm.rotation.x = 0.8;
    }
    head = box(g, 0.24, 0.22, 0.3, M(darker), 0, 1.08, 0.34);
    box(g, 0.18, 0.08, 0.22, M(dark), 0, 0.96, 0.4);           // jaw
    for (const sx of [-1, 1]) box(g, 0.06, 0.045, 0.02, eyeMat, sx * 0.06, 1.1, 0.5);
  } else if (strainKey === 'machine_eater') {
    for (const sx of [-1, 1]) box(g, 0.16, 0.42, 0.16, M(dark), sx * 0.17, 0.21, 0);
    box(g, 0.66, 0.6, 0.46, M(s.color), 0, 0.72, 0);           // bulk torso
    box(g, 0.5, 0.3, 0.34, M(darker), 0, 1.06, -0.12);         // back hump
    for (const sx of [-1, 1]) {
      box(g, 0.2, 0.28, 0.08, M(0x3a3a44), sx * 0.36, 0.96, 0.06); // shoulder plate
      box(g, 0.15, 0.58, 0.15, M(dark), sx * 0.44, 0.62, 0.04);    // heavy arm
    }
    head = box(g, 0.3, 0.26, 0.3, M(darker), 0, 1.14, 0.16);
    for (const sx of [-1, 1]) {                                // mandibles
      const m = box(g, 0.06, 0.2, 0.16, M(0x3a3a44), sx * 0.15, 1.02, 0.28);
      m.rotation.z = -sx * 0.35;
    }
    for (const sx of [-1, 1]) {                                // field-sensing antennae
      const a = cyl(g, 0.012, 0.012, 0.28, M(dark), sx * 0.1, 1.38, 0.1);
      a.rotation.z = -sx * 0.3;
      box(g, 0.045, 0.045, 0.045, glowMat(P.teal), sx * 0.14, 1.5, 0.1);
    }
    for (const sx of [-1, 1]) box(g, 0.06, 0.045, 0.02, eyeMat, sx * 0.08, 1.16, 0.32);
  } else if (strainKey === 'colony_host') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      box(g, 0.2, 0.3, 0.2, M(darker), sx * 0.3, 0.15, sz * 0.22);   // stumpy legs
    box(g, 0.92, 0.9, 0.76, M(s.color), 0, 0.68, 0);                 // main mass
    box(g, 0.5, 0.5, 0.5, M(dark), 0.34, 1.12, 0.06);                // fused lump
    box(g, 0.46, 0.4, 0.5, M(darker), -0.32, 1.0, -0.14);            // fused lump
    for (let i = 0; i < 4; i++) {                                    // mineral spikes
      const sp = cone(g, 0.09, 0.34, M(0x7a6a4a), -0.3 + i * 0.2, 1.3 + (i % 2) * 0.1, -0.1 + (i % 2) * 0.2);
      sp.rotation.z = (i - 1.5) * 0.3;
    }
    box(g, 0.4, 0.18, 0.06, M(0x241d14), 0, 0.5, 0.39);              // maw
    for (let i = 0; i < 5; i++) {                                    // glowing pustules
      const pu = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5),
        glowMat(0xb5c98a, { transparent: true, opacity: 0.9 }));
      pu.position.set(Math.sin(i * 2.4) * 0.42, 0.5 + i * 0.16, Math.cos(i * 1.9) * 0.34);
      g.add(pu);
      ud(g).pulse.push({ mat: pu.material, seed: i * 1.3 });
    }
    head = g.children[4];
    for (const sx of [-1, 1]) box(g, 0.09, 0.06, 0.02, eyeMat, sx * 0.15, 0.92, 0.39);
  } else { // drifter (default silhouette)
    for (const sx of [-1, 1]) box(g, 0.14, 0.5, 0.14, M(dark), sx * 0.12, 0.25, 0);
    const torso = box(g, 0.5, 0.6, 0.32, M(s.color), 0, 0.78, 0.02);
    torso.rotation.x = 0.24;                                   // hunch
    for (const sx of [-1, 1]) {
      const arm = box(g, 0.11, 0.6, 0.11, M(dark), sx * 0.33, 0.62, 0.12);
      arm.rotation.x = 0.35;
    }
    head = box(g, 0.34, 0.3, 0.34, M(darker), 0, 1.14, 0.16);
    head.rotation.x = 0.28;                                    // drooped
    for (const sx of [-1, 1]) box(g, 0.07, 0.05, 0.02, eyeMat, sx * 0.08, 1.12, 0.34);
  }

  g.scale.setScalar(s.scale);
  ud(g);
  return { group: g, head, mats };
}

// ---------------------------------------------------------------------------
// Single-voxel display mesh (gallery): a cube shaded like the world mesher
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ground litter — natural scatter items rendered as recognizable objects
// lying on the ground (Vintage Story style) instead of floating cubes.
// Origin: center-bottom of the pile. `seed` gives deterministic variety.
// ---------------------------------------------------------------------------

function litterRng(seed) {
  let s = (seed * 2654435761 + 1013904223) >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function buildSticks(seed) {
  const g = new THREE.Group();
  const r = litterRng(seed);
  const bark = lambert(0x7a5c34), dark = lambert(0x5d4526);
  const a = box(g, 0.55, 0.045, 0.05, bark, 0, 0.025, 0);
  a.rotation.y = 0.4 + r() * 0.6;
  const b = box(g, 0.42, 0.04, 0.045, dark, 0.09, 0.02, 0.1);
  b.rotation.y = -0.6 - r() * 0.6;
  const twig = box(g, 0.16, 0.03, 0.035, dark, -0.15, 0.055, 0.06);
  twig.rotation.y = 1.1 + r() * 0.5;
  return g;
}

function buildStones(seed) {
  const g = new THREE.Group();
  const r = litterRng(seed + 7);
  const cols = [0x8a8f96, 0x74787f, 0x666a70];
  for (let i = 0; i < 3; i++) {
    const rad = 0.09 + r() * 0.05;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(rad, 0), lambert(cols[i]));
    m.scale.y = 0.55 + r() * 0.2;
    m.position.set((r() - 0.5) * 0.34, rad * m.scale.y * 0.8, (r() - 0.5) * 0.34);
    m.rotation.set(r() * Math.PI, r() * Math.PI, r() * Math.PI);
    g.add(m);
  }
  return g;
}

function buildFiberTuft(seed) {
  const g = new THREE.Group();
  const r = litterRng(seed + 13);
  const cols = [lambert(0x8fae5a), lambert(0x6d8a44), lambert(0xa5bd6e)];
  for (let i = 0; i < 6; i++) {
    const h = 0.2 + r() * 0.14;
    const blade = box(g, 0.028, h, 0.02, cols[i % 3], 0, h / 2, 0);
    const a = (i / 6) * Math.PI * 2 + r() * 0.8;
    blade.position.x = Math.cos(a) * 0.07;
    blade.position.z = Math.sin(a) * 0.07;
    blade.rotation.z = Math.cos(a) * (0.25 + r() * 0.3);
    blade.rotation.x = -Math.sin(a) * (0.25 + r() * 0.3);
  }
  return g;
}

// Returns a lying-on-the-ground mesh for natural scatter items, or null if
// this item has no ground form (caller falls back to icon sprite/mini block).
export function buildGroundItem(itemId, seed = 0) {
  if (itemId === 'stick') return buildSticks(seed);
  if (itemId === 'stone_shard') return buildStones(seed);
  if (itemId === 'fiber') return buildFiberTuft(seed);
  return null;
}

export function buildBlockMesh(id) {
  const def = BLOCKS[id];
  const g = new THREE.Group();
  if (!def) return g;
  if (def.model) { const p = buildProp(def.model, { tint: def.col }); g.add(p); return g; }
  const top = Array.isArray(def.col) ? def.col[0] : def.col;
  const side = Array.isArray(def.col) ? def.col[1] : def.col;
  const bottom = Array.isArray(def.col) ? def.col[2] : def.col;
  const opts = def.transparent || def.liquid ? { transparent: true, opacity: 0.72 } : {};
  if (def.slim) {                                              // wire & co: flat strip
    box(g, 0.7, 0.14, 0.24, lambert(side, opts), 0, 0.07, 0);
    box(g, 0.24, 0.14, 0.7, lambert(side, opts), 0, 0.07, 0);
    return g;
  }
  const mats = [side, side, top, bottom, side, side].map(c => lambert(c, opts));
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats);
  m.position.y = 0.5;
  g.add(m);
  if (def.accent) {                                            // ore flecks
    for (let i = 0; i < 7; i++) {
      const a = i * 2.39996;
      const f = box(g, 0.12, 0.12, 0.02, lambert(def.accent), Math.cos(a) * 0.3, 0.35 + (i % 3) * 0.18, 0.505);
      if (i % 2) { f.position.set(0.505, 0.35 + (i % 3) * 0.18, Math.sin(a) * 0.3); f.rotation.y = Math.PI / 2; }
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Shared animation + teardown
// ---------------------------------------------------------------------------

// state: { running: bool, dt: seconds, aimYaw: number|null (turrets; null = idle sweep) }
export function animateProp(group, t, state = {}) {
  const u = group.userData;
  const dt = state.dt ?? 0.016;
  const running = state.running ?? true;
  if (u.spin) for (const s of u.spin) if (running) s.mesh.rotation[s.axis] += s.rate * dt;
  if (u.glow) for (const gl of u.glow) gl.mat.color.setHex(running ? gl.on : gl.off);
  if (u.flames) for (const f of u.flames) {
    f.mesh.scale.y = 0.8 + 0.25 * Math.sin(t * 11 + f.seed * 7) + 0.1 * Math.sin(t * 23 + f.seed * 13);
    f.mesh.rotation.y += dt * 2;
  }
  if (u.pulse) for (const p of u.pulse) {
    if (p.mat.transparent) p.mat.opacity = 0.6 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.4 + p.seed * 3));
  }
  if (u.head) {
    const target = state.aimYaw ?? Math.sin(t * 0.6 + (u.sweepSeed || 0)) * 1.1;
    let d = target - u.head.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    u.head.rotation.y += d * Math.min(1, 6 * dt);
  }
}

export function disposeGroup(group) {
  const disposeMat = (m) => { if (m.map) m.map.dispose(); m.dispose(); };
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(disposeMat);
      else disposeMat(o.material);
    }
  });
}
