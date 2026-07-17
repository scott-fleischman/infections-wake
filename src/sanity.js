import { SANITY, BLOCKS, B } from './config.js';

// Sanity (§7): 0–100, strictly negative. Low sanity FALSIFIES presentation
// (false enemies, false alarms, phantom motion) but never corrupts authoritative
// simulation state, and never grants a benefit. Zero sanity does NOT drain health.

export class Sanity {
  constructor(game) {
    this.game = game;
    this.value = 80;
    this.band = 'stable';
    this.falseTimer = 3;
    this.alarmTimer = 8;
    this.phantomTimer = 5;
  }

  bandFor(v) {
    if (v >= SANITY.thresholds.stable) return 'stable';
    if (v >= SANITY.thresholds.unstable) return 'unstable';
    if (v >= SANITY.thresholds.hallucinating) return 'hallucinating';
    return 'collapse';
  }

  update(dt) {
    const g = this.game;
    const frac = g.dayFrac;
    const night = g.isNight();
    const light = g.playerLightLevel();     // 0 dark .. 1 bright
    let spores = this.sporeExposure();
    // a powered air scrubber nearby strips spores from the air (§7.3 clean air)
    const scrubbed = g.nearScrubber?.();
    if (scrubbed) spores *= 0.15;

    let delta = 0;
    if (!night && light > 0.5) delta += (SANITY.dayGain / 60) * dt;            // daylight recovery
    if (night) {
      const lampFactor = 0.3 + 0.7 * (1 - Math.min(1, light)); // lit shelter softens night loss
      delta -= (SANITY.nightLoss / 60) * dt * lampFactor;
      // §7.3: stable POWERED lighting actively restores at night, up to a floor
      if (this.value < 70 && this.underPoweredLamp()) delta += (SANITY.lampAura * 2 / 60) * dt;
    }
    if (light < 0.25) delta -= (SANITY.darkLoss / 60) * dt;                    // darkness
    if (spores > 0) delta -= (SANITY.sporeLoss / 60) * dt * spores;           // cyst/nest clouds
    if (scrubbed && this.value < 80) delta += (1.5 / 60) * dt;                 // clean filtered air
    // §7.3 sleep deprivation: past two full days awake, the debt drains you
    const daysAwake = g.day - (g.lastSleepDay ?? g.day);
    if (daysAwake >= 2) delta -= ((daysAwake - 1) * 1.2 / 60) * dt;

    this.value = Math.max(0, Math.min(SANITY.MAX, this.value + delta));

    const nb = this.bandFor(this.value);
    if (nb !== this.band) { this.onBandChange(this.band, nb); this.band = nb; }

    this.updateMisinformation(dt);
  }

  // Standing in the aura of a running powered lamp?
  underPoweredLamp() {
    const g = this.game;
    for (const m of g.machines.map.values()) {
      if (!m || m.type !== 'lamp' || !m.running) continue;
      if (Math.hypot(m.x - g.player.pos.x, m.y - g.player.pos.y, m.z - g.player.pos.z) < 7) return true;
    }
    return false;
  }

  // §7.3: severe injury shakes neural stability (called from player.damage)
  onInjury(amount) {
    if (amount >= 12) this.addSuppressant(-Math.min(6, amount * 0.25));
  }

  onBandChange(from, to) {
    const msgs = {
      unstable: ['Neural instability rising. Perception degrading.', 'bad'],
      hallucinating: ['Hallucinations likely. Trust verified instruments only.', 'bad'],
      collapse: ['Neural collapse. The valley is not what it seems.', 'bad'],
      stable: ['Stability restored.', 'important'],
    };
    const order = ['collapse', 'hallucinating', 'unstable', 'stable'];
    if (order.indexOf(to) < order.indexOf(from)) { /* worsening */ }
    const m = msgs[to];
    if (m) this.game.toast(m[0], m[1]);
    this.game.hud.updateSanityFx();
    if (to === 'stable' || to === 'unstable') this.game.infected.removeAllFalse();
  }

  sporeExposure() {
    const g = this.game, p = g.player;
    let n = 0;
    const px = Math.floor(p.pos.x), py = Math.floor(p.pos.y + 1), pz = Math.floor(p.pos.z);
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (let dz = -3; dz <= 3; dz++) {
          const id = g.world.get(px + dx, py + dy, pz + dz);
          if (id === B.CYST) n += 0.15;
          else if (id === B.NEST) n += 0.3;
          else if (id === B.COLONY) n += 0.1;
        }
    return Math.min(1.2, n);
  }

  updateMisinformation(dt) {
    const g = this.game;
    if (this.band === 'stable') return;
    const access = g.access || {};

    // §7.4 unstable band (26–50): occasional false SOUNDS and low-priority
    // alerts only — no false enemies yet.
    if (this.band === 'unstable') {
      this.phantomTimer -= dt;
      if (this.phantomTimer <= 0) {
        this.phantomTimer = 14 + Math.random() * 12;
        if (access.hallucinationAudio !== false) g.audio?.phantom();
        if (Math.random() < 0.35) g.toast('…did something move at the fence line? (unverified)', '');
      }
      return;
    }
    const intense = this.band === 'collapse';

    // False enemies among real threats (they deal no damage; vanish on verified hit).
    this.falseTimer -= dt;
    if (this.falseTimer <= 0) {
      this.falseTimer = intense ? 4 + Math.random() * 3 : 7 + Math.random() * 5;
      const maxFalse = intense ? 4 : 2;
      if (g.infected.countFalse() < maxFalse) this.spawnFalse();
    }

    // False generator/power alarm — contradicted by the physical readout, and
    // flagged outright when a powered field sensor is watching (§20.4).
    this.alarmTimer -= dt;
    if (this.alarmTimer <= 0) {
      this.alarmTimer = intense ? 10 + Math.random() * 8 : 18 + Math.random() * 10;
      const fakes = [
        'ALARM: generator overload detected.',
        'ALARM: coolant failure on furnace.',
        'Sensor: heat bloom to the north.',
        'Sensor: movement at the west wall.',
      ];
      const verified = g.hasRunningSensor?.();
      const suffix = verified ? ' — CONTRADICTED by field sensor.' : ' (unverified)';
      g.toast('⚠ ' + fakes[Math.floor(Math.random() * fakes.length)] + suffix, verified ? '' : 'bad');
      if (access.hallucinationAudio !== false) g.audio?.falseAlarm();
    }

    // Phantom motion / footsteps.
    this.phantomTimer -= dt;
    if (this.phantomTimer <= 0) {
      this.phantomTimer = intense ? 3 + Math.random() * 4 : 6 + Math.random() * 6;
      if (access.hallucinationAudio !== false) g.audio?.phantom();
    }
  }

  spawnFalse() {
    const g = this.game;
    const ang = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 8;
    const x = g.player.pos.x + Math.cos(ang) * r;
    const z = g.player.pos.z + Math.sin(ang) * r;
    const y = g.world.skyTop(Math.floor(x), Math.floor(z));
    const strain = Math.random() < 0.5 ? 'drifter' : 'runner';
    g.infected.spawn(strain, x, y, z, { isFalse: true });
  }

  onFalseDispelled() {
    this.game.toast('A phantom flickers out. It was never there.', 'important');
  }

  addSuppressant(amount) {
    this.value = Math.min(SANITY.MAX, this.value + amount);
    const nb = this.bandFor(this.value);
    if (nb !== this.band) { this.onBandChange(this.band, nb); this.band = nb; }
  }

  serialize() { return { value: this.value, lastSleepDay: this.game.lastSleepDay ?? null }; }
  load(d) {
    if (!d) return;
    this.value = d.value;
    this.band = this.bandFor(this.value);
    if (d.lastSleepDay != null) this.game.lastSleepDay = d.lastSleepDay;
  }
}
