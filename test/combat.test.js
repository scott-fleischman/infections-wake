// Wishlist mechanics: machine-eater-only block breaking, knockback, and the
// 15-minute day halves. Same rig style as sim.test.js — real World/Signature/
// InfectedManager on a stub game that records attackedBlocks / dugSoft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Signature } from '../src/signature.js';
import { InfectedManager } from '../src/infected.js';
import { Machines } from '../src/power.js';
import { B, BLOCKS, TIME, STRAINS, COMBAT, canInfectedBreakBlock } from '../src/config.js';
import { makeStubGame, makeEmptyWorld, buildFloor } from './helpers.js';

function rig() {
  const world = makeEmptyWorld();
  buildFloor(world, 20, 70, 10, 40, 20); // ground level y=21 on the slab
  const game = makeStubGame({ world });
  game.player.pos.set(500, 21, 500); // no line-of-sight pursuit
  const sig = new Signature(game);
  game.sig = sig;
  const inf = new InfectedManager(game);
  game.infected = inf;
  return { world, game, sig, inf };
}

// a 2-tall wall across x=wallX spanning the whole slab, so nothing can walk
// around it within the sim window
function buildWall(world, wallX, id) {
  for (let z = 10; z <= 40; z++) {
    world.set(wallX, 21, z, id);
    world.set(wallX, 22, z, id);
  }
}

// ---------------- who may break what (wishlist #2) ----------------

test('canInfectedBreakBlock: only machine eaters, only machine blocks', () => {
  const wall = BLOCKS[B.WOOD_WALL], door = BLOCKS[B.DOOR];
  const generator = BLOCKS[B.GENERATOR], wire = BLOCKS[B.WIRE];
  assert.equal(canInfectedBreakBlock(STRAINS.machine_eater, generator), true);
  assert.equal(canInfectedBreakBlock(STRAINS.machine_eater, wire), true, 'chewed cables are their signature move');
  assert.equal(canInfectedBreakBlock(STRAINS.machine_eater, wall), false, 'even eaters cannot break walls');
  assert.equal(canInfectedBreakBlock(STRAINS.machine_eater, door), false);
  for (const key of ['drifter', 'runner', 'brute', 'climber', 'burrower', 'spitter', 'elite', 'colony_host']) {
    assert.equal(canInfectedBreakBlock(STRAINS[key], generator), false, `${key} must not break machines`);
    assert.equal(canInfectedBreakBlock(STRAINS[key], wall), false, `${key} must not break walls`);
  }
});

test('a drifter blocked by a timber wall never attacks it', () => {
  const { world, game, sig, inf } = rig();
  buildWall(world, 45, B.WOOD_WALL);
  // a warm body signature behind the wall — exactly what used to draw chewing
  sig.setDynamic('bait', 50, 21, 25, { heat: 0.8, co2: 0.6 }, 40);
  const drifter = inf.spawn('drifter', 38.5, 21, 25.5, {});
  const dt = 0.05;
  for (let step = 0; step < 400; step++) { game.t += dt; inf.update(dt); }
  assert.ok(drifter.pos.x > 42, `must actually reach the wall (x=${drifter.pos.x.toFixed(1)}) for the test to mean anything`);
  assert.equal(game.attackedBlocks.length, 0, 'walls are safe from non-eaters');
  assert.equal(game.dugSoft.length, 0);
});

test('a machine eater blocked by a timber wall never attacks it either', () => {
  const { world, game, sig, inf } = rig();
  buildWall(world, 45, B.WOOD_WALL);
  sig.setDynamic('M-test', 50, 21, 25, { electrical: 0.7, vibration: 0.45 }, 40);
  inf.spawn('machine_eater', 38.5, 21, 25.5, {});
  const dt = 0.05;
  for (let step = 0; step < 400; step++) { game.t += dt; inf.update(dt); }
  assert.equal(game.attackedBlocks.length, 0, 'a wall is not a machine block');
});

test('a burrower routes soil through infectedDigSoft, never block attacks', () => {
  const { world, game, sig, inf } = rig();
  buildWall(world, 45, B.DIRT); // an earth bank in its path
  sig.setDynamic('thump', 50, 21, 25, { vibration: 0.9 }, 40);
  inf.spawn('burrower', 40.5, 21, 25.5, {});
  const dt = 0.05;
  for (let step = 0; step < 400; step++) { game.t += dt; inf.update(dt); }
  assert.ok(game.dugSoft.length > 0, 'burrower must keep tunneling through soil');
  assert.equal(game.attackedBlocks.length, 0, 'soil passage is movement, not block damage');
  for (const d of game.dugSoft) {
    const id = world.get(d.x, d.y, d.z);
    assert.ok([B.DIRT, B.GRASS, B.SAND, B.GRAVEL].includes(id), 'digSoft only ever targets soft ground');
  }
});

test('hit by a machine, a drifter hunts the player; an eater retaliates on the machine', () => {
  const { inf } = rig();
  const drifter = inf.spawn('drifter', 40.5, 21, 25.5, {});
  drifter.takeHit(2, true, { x: 42, y: 21, z: 25 }); // e.g. turret fire
  assert.equal(drifter.retaliate, undefined, 'cannot damage the turret, so no point camping it');
  assert.equal(drifter.targetIsPlayer, true);

  const eater = inf.spawn('machine_eater', 40.5, 21, 25.5, {});
  eater.takeHit(2, true, { x: 42, y: 21, z: 25 });
  assert.deepEqual(eater.retaliate, { x: 42, y: 21, z: 25 }, 'eaters turn on the machine (§12.3)');
});

// ---------------- knockback (wishlist #3) ----------------

test('melee knockback shoves an infected away and decays', () => {
  const { game, inf } = rig();
  const drifter = inf.spawn('drifter', 45.5, 21, 25.5, {});
  drifter.applyKnockback({ x: 40, y: 21, z: 25.5 }, 12); // hit from the west
  const startX = drifter.pos.x;
  const dt = 0.05;
  for (let step = 0; step < 40; step++) { game.t += dt; inf.update(dt); } // 2s
  assert.ok(drifter.pos.x - startX > 1, `shoved east, got ${(drifter.pos.x - startX).toFixed(2)}`);
  assert.ok(drifter.kb.length() < 0.15, 'shove decays away');
  // never ends inside a solid cell
  assert.equal(drifter.solidAt(drifter.pos.x, drifter.pos.y, drifter.pos.z), false);
});

test('knockback respects walls and never chews them', () => {
  const { world, game, inf } = rig();
  buildWall(world, 47, B.WOOD_WALL);
  const drifter = inf.spawn('drifter', 45.5, 21, 25.5, {});
  drifter.applyKnockback({ x: 40, y: 21, z: 25.5 }, 14); // flung at the wall
  const dt = 0.05;
  for (let step = 0; step < 30; step++) { game.t += dt; inf.update(dt); }
  assert.ok(drifter.pos.x < 47, 'stopped by the wall');
  assert.equal(game.attackedBlocks.length, 0, 'being flung into a wall is not an attack');
});

test('knockback interrupts a machine eater mid-chew', () => {
  const { world, game, sig, inf } = rig();
  world.set(50, 21, 25, B.GENERATOR);
  sig.setDynamic('M-test', 50, 21, 25, { electrical: 0.7, vibration: 0.45 }, 40);
  const eater = inf.spawn('machine_eater', 48.6, 21, 25.5, {});
  const dt = 0.05;
  for (let i = 0; i < 120; i++) { game.t += dt; inf.update(dt); }
  assert.ok(game.attackedBlocks.length > 0, 'sanity: it is chewing the generator');
  const x0 = eater.pos.x;
  eater.applyKnockback({ x: 52, y: 21, z: 25.5 }, 10); // struck from the east
  // it gets shoved west, then legitimately walks back to resume — assert the
  // peak displacement, not the settled position
  let minX = x0;
  for (let i = 0; i < 10; i++) { game.t += dt; inf.update(dt); minX = Math.min(minX, eater.pos.x); }
  assert.ok(minX < x0 - 0.35,
    `the shove must land even while chewing (peak ${(x0 - minX).toFixed(2)} west)`);
});

test('a shoved climber is stopped by the wall — the shove never converts to a climb boost', () => {
  const { world, inf } = rig();
  buildWall(world, 47, B.WOOD_WALL);
  const climber = inf.spawn('climber', 46.8, 21, 25.5, {});
  climber._dt = 0.05;
  climber.tryMove(0.4, 0, true); // knockback path: into the wall, noAttack
  assert.equal(climber.pos.y, 21, 'no lift from a shove');
  assert.ok(!climber._climbedNow, 'no gravity-defeat frame from a shove');
  climber.tryMove(0.4, 0); // normal AI movement into the wall still climbs
  assert.ok(climber._climbedNow, 'deliberate movement climbs as designed');
});

test('encounter bosses are immune to knockback', () => {
  const { inf } = rig();
  const host = inf.spawn('colony_host', 45.5, 21, 25.5, {});
  host.applyKnockback({ x: 40, y: 21, z: 25.5 }, 14);
  assert.equal(host.kb.length(), 0);
});

// ---------------- machine knockback (§12, wishlist #3 every source) -------

test('a gun turret shoves a non-boss infected it fires on', () => {
  const { game, inf } = rig();
  const machines = new Machines(game);
  const turret = machines.add(40, 21, 25, B.TURRET);
  turret.ammo = 5;
  const drifter = inf.spawn('drifter', 45.5, 21, 25.5, {});
  const hp0 = drifter.hp;
  machines.updateTurret(turret, 0.1, true);
  assert.ok(drifter.hp < hp0, 'turret hit landed');
  assert.ok(drifter.kb.length() > 0, 'turret fire shoves the target');
});

test('a vibration turret shoves a non-boss infected it fires on', () => {
  const { game, inf } = rig();
  const machines = new Machines(game);
  const vib = machines.add(40, 21, 25, B.VIB_TURRET);
  const drifter = inf.spawn('drifter', 45.5, 21, 25.5, {});
  const hp0 = drifter.hp;
  machines.updateVibTurret(vib, 0.1, true);
  assert.ok(drifter.hp < hp0, 'vibration turret hit landed');
  assert.ok(drifter.kb.length() > 0, 'vibration turret fire shoves the target');
});

test('a gun turret still cannot budge an encounter boss', () => {
  const { game, inf } = rig();
  const machines = new Machines(game);
  const turret = machines.add(40, 21, 25, B.TURRET);
  turret.ammo = 5;
  const host = inf.spawn('colony_host', 45.5, 21, 25.5, {});
  machines.updateTurret(turret, 0.1, true);
  assert.equal(host.kb.length(), 0, 'boss immunity holds through the machine path too');
});

// ---------------- knockback actually displaces (2026-08-17) ----------------

// Knockback used to be an impulse in invented units, and locomotion simply ate
// it: a runner (speed 4.4) CLOSED distance while "knocked back". It is now a
// DISTANCE IN BLOCKS plus a short stagger window (COMBAT.kbStun) during which
// the body cannot walk, chew or swing.
//
// Every rig below puts the striker directly in the body's path and leaves the
// body actively pursuing it — the hardest case, because everything the body
// wants to do works against the shove. A rig where the body just stands there
// would pass whether or not the stagger exists.
function kbRig(strainKey) {
  const { game, sig, inf } = rig();        // rig() already lays the slab at y=20
  game.player.pos.set(30, 21, 25);         // the striker, four blocks due west
  sig.setDynamic('bait', 30, 21, 25, { heat: 0.9, co2: 0.8 }, 40);
  const body = inf.spawn(strainKey, 34, 21, 25, {});
  body.target = { x: 30, y: 21, z: 25 };
  body.targetIsPlayer = true;
  body.state = 'pursue';                   // already closing when the hit lands
  return { game, inf, body };
}

// Shove east (away from the striker) and report the PEAK displacement as well
// as where the body ends up. The peak is what the player reads as "it got
// knocked back"; the settled value is the rig's own liveness check — a body
// wedged on geometry would never walk back in, and a displacement assertion
// would then pass for entirely the wrong reason.
function shove(strainKey, dist, opts, frames = 60) {
  const { game, inf, body } = kbRig(strainKey);
  const x0 = body.pos.x;
  body.applyKnockback({ x: 30, z: 25 }, dist, opts);
  const stunAfterHit = body.stunT, kbAfterHit = body.kb.length();
  let peak = -Infinity;
  for (let i = 0; i < frames; i++) {
    game.t += 1 / 60; inf.update(1 / 60);
    peak = Math.max(peak, body.pos.x - x0);
  }
  return { game, inf, body, stunAfterHit, kbAfterHit, peak, end: body.pos.x - x0 };
}

test('a bare-hand shove displaces a pursuing drifter about a quarter block', () => {
  // COMBAT.handKb is 0.25 BLOCKS. The peak lands at the close of the stagger
  // window, by which point ~86% of the exponential has been spent (kbStun 0.3s
  // against kbDecay 6/s); the remaining tail is burned fighting the walk the
  // body immediately resumes. Measured 0.216 — the band brackets the feel, not
  // the float, so retuning kbStun by a few hundredths does not fail the suite.
  const r = shove('drifter', COMBAT.handKb);
  assert.equal(r.stunAfterHit, COMBAT.kbStun, 'a full shove opens the stagger window');
  assert.ok(r.peak > 0.19 && r.peak < 0.30, `expected ~0.25 blocks back, got ${r.peak.toFixed(3)}`);
  assert.ok(r.end < -0.5, `rig liveness: it must walk back in afterwards, got ${r.end.toFixed(3)}`);
});

test('a weapon shove displaces a drifter twice as far as a bare hand', () => {
  const hand = shove('drifter', COMBAT.handKb);
  const weapon = shove('drifter', 0.5);   // every weapon's kb is 0.5 blocks
  assert.ok(weapon.peak > 0.40 && weapon.peak < 0.58, `expected ~0.5 blocks back, got ${weapon.peak.toFixed(3)}`);
  // The sharp invariant, independent of how the stagger is tuned: displacement
  // is LINEAR in the configured distance, so doubling `kb` doubles the shove.
  // This is what "kb is measured in blocks" actually means.
  const ratio = weapon.peak / hand.peak;
  assert.ok(Math.abs(ratio - 0.5 / COMBAT.handKb) < 0.02, `shove must scale with kb, ratio ${ratio.toFixed(3)}`);
});

test('a runner cannot out-walk its own stagger', () => {
  // The original bug in one comparison. A runner covers 4.4 blocks/s, so over
  // the third of a second sampled here an unshoved one closes ~1.47 blocks.
  // Shoved, it has to be FURTHER away than it started, not nearer.
  const shoved = shove('runner', 0.5, undefined, 20);
  const free = kbRig('runner');
  const fx0 = free.body.pos.x;
  for (let i = 0; i < 20; i++) { free.game.t += 1 / 60; free.inf.update(1 / 60); }
  const closed = free.body.pos.x - fx0;
  assert.ok(closed < -1.2, `control: an unshoved runner sprints in, got ${closed.toFixed(3)}`);
  assert.ok(shoved.end > 0.3, `a shoved runner must end up further away, got ${shoved.end.toFixed(3)}`);
});

// A machine eater that has already walked up to a generator and settled into
// chewing it — the state the stagger has to interrupt.
function chewingEaterRig() {
  const { world, game, sig, inf } = rig();
  world.set(50, 21, 25, B.GENERATOR);
  sig.setDynamic('M-test', 50, 21, 25, { electrical: 0.7, vibration: 0.45 }, 40);
  const eater = inf.spawn('machine_eater', 48.6, 21, 25.5, {});
  for (let i = 0; i < 120; i++) { game.t += 0.05; inf.update(0.05); }
  return { game, inf, eater };
}

test('a staggered machine eater cannot chew during the window', () => {
  // Subject and control take the IDENTICAL shove; only the stun flag differs.
  // That isolates the stagger from the displacement — otherwise "it stopped
  // chewing" could just mean "it got pushed out of reach of the generator".
  const struck = (opts, frames) => {
    const { game, inf, eater } = chewingEaterRig();
    const before = game.attackedBlocks.length;
    assert.ok(before > 0, 'sanity: the eater is already chewing the generator');
    eater.applyKnockback({ x: 52, z: 25.5 }, 0.5, opts);   // struck from the east
    for (let i = 0; i < frames; i++) { game.t += 1 / 60; inf.update(1 / 60); }
    return { game, inf, eater, before, bites: game.attackedBlocks.length - before };
  };
  const nudged = struck({ stun: false }, 10);
  assert.ok(nudged.bites > 0, `control: the same shove without a stagger keeps chewing, got ${nudged.bites}`);

  const staggered = struck(undefined, 10);   // 0.167s — inside the 0.3s window
  assert.equal(staggered.bites, 0, 'a staggered eater must not chew');
  assert.ok(staggered.eater.stunT > 0, 'stagger window still open');

  // ...and it is a stagger, not a lobotomy: the appetite comes back.
  for (let i = 0; i < 90; i++) { staggered.game.t += 1 / 60; staggered.inf.update(1 / 60); }
  assert.ok(staggered.game.attackedBlocks.length > staggered.before + 10,
    'chewing resumes once the window closes');
});

test('continuous nudges (UV, spike traps) never stagger — no stunlock', () => {
  const { game, inf, body } = kbRig('drifter');
  const x0 = body.pos.x;
  body.applyKnockback({ x: 30, z: 25 }, COMBAT.trapKb, { stun: false });
  assert.ok(body.kb.length() > 0, 'the nudge still shoves — it is just not a stagger');
  assert.equal(body.stunT, 0, 'trap nudges must leave the body free to act');
  for (let i = 0; i < 30; i++) { game.t += 1 / 60; inf.update(1 / 60); }
  // half a second of unimpeded walking at drifter speed 2.2 nets ~1 block of
  // closing, less the 0.12-block wiggle. A stunlocked body would sit still.
  assert.ok(body.pos.x < x0 - 0.8, `a nudged body still closes on its target, got ${(body.pos.x - x0).toFixed(3)}`);
});

test('bosses are immune to knockback and to the stagger', () => {
  // A jugglable colony host trivializes an encounter that is supposed to be a
  // location problem, so the immunity covers the stagger too — not just the kb.
  const r = shove('colony_host', 0.5, undefined, 30);
  assert.equal(r.stunAfterHit, 0, 'no stagger window to juggle a host with');
  assert.equal(r.kbAfterHit, 0, 'no shove either');
  assert.ok(r.peak <= 0.01, `a boss never gets pushed back, peak ${r.peak.toFixed(3)}`);
  assert.ok(r.end < -0.3, 'it just keeps walking in the whole time');
});

// ---------------- day halves (wishlist #5) ----------------

test('days are symmetric 15-minute halves', () => {
  assert.equal(TIME.DAY_LENGTH, 1800, '30 real minutes per full cycle');
  assert.equal(TIME.DUSK - TIME.DAWN, 0.5, 'day half is exactly half the cycle');
  const nightFrac = 1 - (TIME.DUSK - TIME.DAWN);
  assert.equal(nightFrac * TIME.DAY_LENGTH, 900, 'night half is 15 minutes');
  // ordering contracts other systems rely on
  assert.ok(TIME.DAWN < TIME.DAWN_END, 'dawn ramp inside the day');
  assert.ok(TIME.DUSK < TIME.NIGHT, 'dusk ramp precedes full night');
});
