import { THREAT, TIME, SANITY } from './config.js';

// Threat director (§6): one telegraphed major assault per night, plus
// conditional incursions when the player's signature spikes. It only *requests*
// spawns from the infected manager, which validates routes (§23.1).

const LEVEL_NAMES = ['DORMANT', 'LOW', 'GUARDED', 'ELEVATED', 'SEVERE', 'CRITICAL'];

export class Director {
  constructor(game) {
    this.game = game;
    this.forecast = null;         // {tag, dominant, comp, assaultFrac, level, confidence, forecastText, strains}
    this.assaultActive = false;
    this.assaultDoneForNight = false;
    this.incursionCd = THREAT.incursionCooldown;
    this.dayPressureCd = 20;
    this.remaining = 0;
  }

  reset() { this.forecast = null; this.assaultActive = false; this.assaultDoneForNight = false; }

  scaleComp(assault, day) {
    const comp = {};
    for (const [k, v] of Object.entries(assault.base)) comp[k] = v;
    if (assault.perDay) for (const [k, v] of Object.entries(assault.perDay)) comp[k] = (comp[k] || 0) + Math.floor(v * day);
    return comp;
  }

  buildForecast() {
    const g = this.game;
    // dominant signature around the base at dusk picks the "question".
    const totals = g.sig.sampleTotals(g.player.pos.x, g.player.pos.y + 1, g.player.pos.z, true);
    const dom = g.sig.dominantChannel(totals);
    let assault = THREAT.assaults.find(a => a.dominant === dom) || THREAT.assaults.find(a => a.dominant === null);
    const day = g.day;
    const comp = this.scaleComp(assault, day);
    const total = Object.values(comp).reduce((a, b) => a + b, 0);
    let level = Math.min(5, 1 + Math.floor(day / 2) + (total > 12 ? 1 : 0) + (totals[dom] > 0.8 ? 1 : 0));
    // confidence degraded by low sanity (unreliable instruments, §6.6)
    let confidence = 0.85;
    if (g.sanity.value < SANITY.thresholds.stable) confidence -= 0.2;
    if (g.sanity.value < SANITY.thresholds.unstable) confidence -= 0.3;
    confidence = Math.max(0.25, confidence);
    const assaultFrac = 0.85;
    const strains = Object.keys(comp).filter(k => comp[k] > 0);
    this.forecast = {
      tag: assault.tag, dominant: dom, comp, assaultFrac, level,
      confidence, forecastText: assault.forecast, strains, total,
    };
    g.toast(`Dusk forecast: ${assault.tag}. ${assault.forecast}`, 'important');
    g.hud.updateThreat();
  }

  triggerAssault() {
    const g = this.game;
    if (!this.forecast) this.buildForecast();
    const comp = this.forecast.comp;
    let spawned = 0;
    for (const [strain, count] of Object.entries(comp)) {
      spawned += g.infected.spawnWave(strain, count, { fromAssault: true });
    }
    this.assaultActive = true;
    this.assaultDoneForNight = true;
    this.remaining = spawned;
    this._bannerShown = true;
    g.hud.showAssaultBanner(true);
    g.toast(`MAJOR ASSAULT — ${this.forecast.tag}`, 'bad');
    g.audio?.assault();
  }

  endAssault(cleared) {
    if (!this.assaultActive) return;
    this.assaultActive = false;
    this._bannerShown = false;
    this.game.hud.showAssaultBanner(false);
    if (cleared) {
      this.game.toast('Assault repelled. The valley quiets.', 'important');
      this.game.onAssaultCleared();
    }
  }

  // frac in [0,1) within the current day
  update(dt, frac) {
    const g = this.game;
    const isNight = frac >= TIME.DUSK || frac < TIME.DAWN;

    // Forecast becomes available at dusk.
    if (frac >= THREAT.duskWarnFrac && frac < TIME.DAWN + 1 && !this.forecast && !this.assaultDoneForNight) {
      this.buildForecast();
    }

    // Trigger the scheduled assault.
    if (this.forecast && !this.assaultDoneForNight && frac >= this.forecast.assaultFrac) {
      this.triggerAssault();
    }

    // Assault bookkeeping.
    if (this.assaultActive) {
      if (!this._bannerShown) { g.hud.showAssaultBanner(true); this._bannerShown = true; }
      this.remaining = g.infected.countReal(true);
      g.hud.updateAssaultRemaining(this.remaining);
      if (this.remaining <= 0) this.endAssault(true);
    }

    // Conditional incursion: a strong outdoor signature draws a focused group.
    this.incursionCd -= dt;
    if (this.incursionCd <= 0 && !this.assaultActive) {
      this.incursionCd = THREAT.incursionCooldown;
      const mag = g.sig.outdoorMagnitude();
      if (mag > THREAT.incursionSigThreshold) {
        const dom = g.sig.dominantChannel(g.sig.sampleTotals(g.player.pos.x, g.player.pos.y + 1, g.player.pos.z, true));
        const strain = dom === 'electrical' || dom === 'vibration' ? 'machine_eater' : dom === 'blood' ? 'runner' : 'drifter';
        const n = g.infected.spawnWave(strain, 2 + Math.floor(mag), { fromAssault: false });
        if (n > 0) { g.hud.flashIncursion(); g.toast('Incursion — your signature drew a probe.', 'bad'); }
      }
    }

    // Daytime pressure at low sanity (§7.4): draw from valid outdoor routes.
    this.dayPressureCd -= dt;
    if (this.dayPressureCd <= 0) {
      this.dayPressureCd = 18;
      if (!isNight && g.sanity.value < SANITY.thresholds.unstable) {
        const strain = g.sanity.value < SANITY.thresholds.hallucinating + 1 ? 'machine_eater' : 'drifter';
        g.infected.spawnWave(strain, 1, { fromAssault: false });
      }
    }
  }

  onDawn() {
    // dawn ends scheduled pressure but not lingering infected (§6.2)
    if (this.assaultActive) this.endAssault(false);
    this.forecast = null;
    this.assaultDoneForNight = false;
    this.game.hud.updateThreat();
  }

  levelName() { return LEVEL_NAMES[this.forecast ? this.forecast.level : 0]; }

  serialize() {
    return { assaultDone: this.assaultDoneForNight, active: this.assaultActive, forecast: this.forecast };
  }
  load(d) {
    if (!d) return;
    this.assaultDoneForNight = d.assaultDone;
    this.forecast = d.forecast || null;
    // a save made mid-assault resumes the assault (banner re-shown on update)
    this.assaultActive = !!d.active;
    this._bannerShown = false;
  }
}
