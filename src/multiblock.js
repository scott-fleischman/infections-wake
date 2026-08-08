// Multi-cell block pair math. Pure functions over a world's get() — main.js
// owns the side effects (props, audio, drops); tests drive these directly.
import { B } from './config.js';

// Every id that belongs to a pair. Guards the break path against clearing a
// neighbor cell that merely happens to sit where a partner would.
export const MULTI_IDS = new Set([B.DOOR, B.DOOR_OPEN, B.DOOR_TOP, B.DOOR_TOP_OPEN,
  B.BED, B.BED_N, B.BED_E, B.BED_W, B.BED_FOOT]);

// Any door id at (x,y,z) -> { base:{x,y,z,id}, top:{x,y,z,id} } | null.
// A legacy 1-tall door still resolves; its `top` is whatever sits above.
export function doorParts(world, x, y, z) {
  const id = world.get(x, y, z);
  if (id === B.DOOR_TOP || id === B.DOOR_TOP_OPEN) {
    return { base: { x, y: y - 1, z, id: world.get(x, y - 1, z) }, top: { x, y, z, id } };
  }
  if (id === B.DOOR || id === B.DOOR_OPEN) {
    return { base: { x, y, z, id }, top: { x, y: y + 1, z, id: world.get(x, y + 1, z) } };
  }
  return null;
}

// Head id -> foot direction. BED faces +z (its headboard model sits at -z).
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
  if (dir) {
    const fx = x + dir[0], fz = z + dir[1];
    return { head: { x, y, z, id }, foot: { x: fx, y, z: fz, id: world.get(fx, y, fz) } };
  }
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

// Old saves stored doors and beds as single cells. Returns the writes that
// grow each one into its second cell where that cell is free — a blocked one
// stays legacy-short, and the models fall back to the 1-cell shape. Returned
// as a plan so the caller can write without mutating the edits map mid-scan.
export function upgradeEditsPlan(world, edits) {
  const plan = [];
  for (const [k, v] of edits) {
    const [x, y, z] = k.split(',').map(Number);
    if (v === B.DOOR || v === B.DOOR_OPEN) {
      if (world.get(x, y + 1, z) === B.AIR)
        plan.push({ x, y: y + 1, z, id: v === B.DOOR ? B.DOOR_TOP : B.DOOR_TOP_OPEN });
    } else if (v === B.BED) {
      const [dx, dz] = BED_DIR[B.BED];
      if (world.get(x + dx, y, z + dz) === B.AIR)
        plan.push({ x: x + dx, y, z: z + dz, id: B.BED_FOOT });
    }
  }
  return plan;
}
