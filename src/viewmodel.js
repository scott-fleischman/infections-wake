import * as THREE from 'three';
import { buildToolMesh, disposeGroup } from './models.js';

// ============================================================================
// First-person viewmodel: the tool in your own hands.
//
// It renders in a SECOND pass over a cleared depth buffer (see render()), not
// as a child of the world camera. That is the only reliable way to keep a
// hand-held model from clipping into a wall you are standing against — the
// world pass finishes, the depth buffer is wiped, and the viewmodel draws on
// top of everything at its own tiny scale. A child-of-the-camera viewmodel sits
// inside world space, so the first block face you press your chest against
// swallows it.
//
// The overlay scene carries its OWN light rig for the same reason: the world is
// lit by a day/night sun and a pool of point lights, and at midnight in a mine
// a tool parented to that scene is a black silhouette. Here it is always lit.
//
// swingPose() is pure and lives here so the animation can be unit-tested in
// Node without a WebGL context — nothing in it touches `this`, the scene, or
// the clock.
// ============================================================================

// swing durations in seconds. Mining is a deliberate chop you can watch land;
// an attack has to resolve before the next click, so it is much shorter.
export const SWING = { mine: 0.42, attack: 0.26 };

// Rest pose of the held tool in the viewmodel camera's local space: down and to
// the right, angled so the head reads against the crosshair without covering it.
// Metres and radians; every swingPose value below is an offset FROM this.
const REST = { x: 0.32, y: -0.34, z: -0.62, pitch: -0.5, yaw: -0.35, roll: 0.15 };

// Pose offsets for a swing at normalized phase u (0 = start, 1 = finished).
// Returns radians + a forward push in metres, all relative to REST. Both ends
// must land on exactly zero or the tool would settle crooked after a swing.
export function swingPose(kind, u) {
  const t = Math.max(0, Math.min(1, u));   // the last frame of a swing overshoots 1
  if (kind === 'attack') {
    // fast diagonal slash: one symmetric sweep across and back, so a burst of
    // clicks reads as repeated strikes rather than one long wind-up
    const s = Math.sin(Math.PI * t);
    return { pitch: s * 0.85, yaw: s * 0.95, roll: -s * 0.5, push: s * 0.2 };
  }
  // mine (and any unknown kind — update() resolves durations the same way): a
  // chop that falls hard through the first 40% and recovers over the slower
  // remaining 60%. The asymmetry is what makes the impact frame readable.
  const fall = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
  const e = fall * fall * (3 - 2 * fall);            // smoothstep
  return { pitch: e * 1.15, yaw: e * 0.18, roll: e * 0.1, push: e * 0.16 };
}

export class Viewmodel {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    // Its own camera, with a near/far pair sized for objects a hand's length
    // away. The world camera's 0.08 near plane would slice the tool in half.
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

    // Everything that moves hangs off one root: the swing and the walk sway are
    // applied once, to the group, instead of to each mesh.
    this.root = new THREE.Group();
    this.scene.add(this.root);
    // The hand is built once and stays forever — bare hands are a valid hotbar
    // selection, so it must NOT be created lazily by setItem().
    this.hand = this._buildHand();
    this.root.add(this.hand);
    this.itemId = null;
    this.tool = null;
    this.swing = null;       // { kind, t } while an animation is playing
    this.bob = 0;
    this.visible = true;     // cleared while a full-screen UI is open
  }

  // Rebuild only when the selected item actually changes — setItem() runs every
  // frame from the update loop, and buildToolMesh allocates geometry.
  setItem(itemId) {
    if (itemId === this.itemId) return;
    this.itemId = itemId;
    if (this.tool) { this.root.remove(this.tool); disposeGroup(this.tool); this.tool = null; }
    // buildToolMesh returns null for anything that is not a tool (blocks, ore,
    // food), which is exactly the "empty hand" case — no branch needed here.
    const mesh = itemId ? buildToolMesh(itemId) : null;
    if (mesh) {
      // tools are authored at world scale (a pick is ~1.2 blocks long); shrink
      // to hand scale so the head reads big without filling the viewport
      mesh.scale.setScalar(0.62);
      this.tool = mesh;
      this.root.add(mesh);
    }
  }

  // A simple gloved forearm so a bare hand still reads as a hand, and so a held
  // tool looks gripped rather than floating. Parented to the root, so it swings
  // with the tool.
  _buildHand() {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0x8a6a52 });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x4a5240 });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.34), sleeve);
    arm.position.set(0.02, -0.09, 0.13);   // runs back toward the camera
    g.add(arm);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.12), skin);
    fist.position.set(0.02, -0.04, -0.03); // closes around the haft at the origin
    g.add(fist);
    return g;
  }

  // Restarts the animation from zero: a fresh click always replays the swing
  // rather than continuing a half-finished one.
  startSwing(kind) { this.swing = { kind, t: 0 }; }

  // state: { moving: bool, mining: bool }
  update(dt, state = {}) {
    if (!this.root) return;
    // hold-to-mine loops the chop for as long as the button is down; starting a
    // new one only when idle keeps the loop at the animation's own cadence
    if (state.mining && !this.swing) this.startSwing('mine');

    let pose = { pitch: 0, yaw: 0, roll: 0, push: 0 };
    if (this.swing) {
      this.swing.t += dt;
      const dur = SWING[this.swing.kind] ?? SWING.mine;
      pose = swingPose(this.swing.kind, this.swing.t / dur);
      if (this.swing.t >= dur) this.swing = null;
    }

    // walking sway — a figure-eight, damped so standing still is nearly dead
    // still (a fully frozen tool looks like the game hung, so idle keeps a
    // trace of breathing)
    this.bob += dt * (state.moving ? 9 : 2.5);
    const amp = state.moving ? 1 : 0.15;
    const bobX = Math.sin(this.bob) * 0.012 * amp;
    const bobY = Math.abs(Math.cos(this.bob)) * 0.014 * amp;

    // the swing drags the whole hand, not just its rotation: a chop that only
    // rotated would pivot in place instead of driving down and forward
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
  // wall the player is pressed against, but keep the colour buffer so the world
  // frame survives underneath. Must run AFTER the world render.
  render(renderer) {
    if (!this.visible) return;
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;      // do NOT wipe the world we just drew
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAuto;   // leave the renderer exactly as we found it
  }

  dispose() {
    if (this.tool) { this.root.remove(this.tool); disposeGroup(this.tool); this.tool = null; }
    if (this.hand) { this.root.remove(this.hand); disposeGroup(this.hand); this.hand = null; }
    this.itemId = null;
  }
}
