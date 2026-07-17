import { THREAT, TIME, SANITY, STRAINS, B } from './config.js';

// Threat director (§6): one telegraphed major assault per night, plus
// conditional incursions when the player's signature spikes, daytime scouts
// probing the loudest emitter, unresolved-nest pressure, and the rare
// reservoir migration. It only *requests* spawns from the infected manager,
// which validates routes (§23.1).

const LEVEL_NAMES = ['DORMANT', 'LOW', 'GUARDED', 'ELEVATED', 'SEVERE', 'CRITICAL'];

export class Director {
  constructor(game) {
    this.game = game;
    this.forecast = null;         // {tag, dominant, comp, assaultFrac, level, confidence, forecastText, strains}
    this.assaultActive = false;
    this.assaultDoneForNight = false;
    this.incursionCd = THREAT.incursionCooldown;
    this.scoutCd = THREAT.scoutCooldown;
    this.dayPressureCd = 20;
    this.remaining = 0;
    this.migrationArmed = false;  // forecast the night before it happens (§6.4)
  }

  reset() { this.forecast = null; this.assaultActive = false; this.assaultDoneForNight = false; }

  // Campaign stage (§6.3): tech tiers and story beats raise the baseline.
  stage() {
    const g = this.game;
    let s = 0;
    if (g.tiers.has('iron')) s++;
    if (g.tiers.has('steel')) s++;
    if (g.transit?.restored) s++;
    return s;
  }

  // §19: post-purge, regional pressure falls and compositions stay capped.
  pressureScale() { return this.game.deep?.purged ? THREAT.postPurgePressure : 1; }

  scaleComp(assault, day) {
    const comp = {};
    const scale = this.pressureScale();
    for (const [k, v] of Object.entries(assault.base)) comp[k] = Math.max(1, Math.round(v * scale));
    if (assault.perDay) for (const [k, v] of Object.entries(assault.perDay)) comp[k] = (comp[k] || 0) + Math.floor(v * Math.min(day, 10) * scale);
    return comp;
  }

  // Assault selection (§22.2): filter by minDay + signature requirements, then
  // match the dominant channel; fall back to the baseline question.
  pickAssault(totals, dom, day) {
    const eligible = THREAT.assaults.filter(a => {
      if ((a.minDay || 1) > day) return false;
      if (a.requirements) for (const [ch, min] of Object.entries(a.requirements)) if ((totals[ch] || 0) < min) return false;
      return true;
    });
    return eligible.find(a => a.dominant === dom) || eligible.find(a => a.dominant === null) || THREAT.assaults.find(a => a.dominant === null);
  }

  // A powered field sensor steadies the forecast (§20.3 instruments).
  sensorBonus() {
    for (const m of this.game.machines.map.values())
      if (m && m.type === 'sensor' && m.running) return true;
    return false;
  }

  buildForecast() {
    const g = this.game;
    const day = g.day;
    // dominant signature around the base at dusk picks the "question".
    const totals = g.sig.sampleTotals(g.player.pos.x, g.player.pos.y + 1, g.player.pos.z, true);
    const dom = g.sig.dominantChannel(totals);

    // §6.4 reservoir migration: rare, armed a day ahead, overrides the question
    let assault, migration = false;
    if (this.migrationArmed && !g.deep?.purged) {
      migration = true;
      this.migrationArmed = false;
      assault = { tag: 'RESERVOIR MIGRATION', dominant: dom, base: THREAT.migration.comp, perDay: {}, forecast: THREAT.migration.forecast, forecastTags: ['mass_movement'] };
    } else {
      assault = this.pickAssault(totals, dom, day);
    }
    const comp = this.scaleComp(assault, day);
    // strains below their minimum day don't appear even in a matched question
    for (const k of Object.keys(comp)) {
      if ((STRAINS[k]?.minDay || 1) > day) delete comp[k];
    }
    const total = Object.values(comp).reduce((a, b) => a + b, 0);
    let level = Math.min(5, 1 + Math.floor(day / 2) + this.stage() + (total > 12 ? 1 : 0) + (totals[dom] > 0.8 ? 1 : 0) - (g.deep?.purged ? 2 : 0));
    level = Math.max(1, level);
    // confidence: degraded by low sanity, steadied by a powered sensor (§6.6)
    let confidence = 0.85;
    if (g.sanity.value < SANITY.thresholds.stable) confidence -= 0.2;
    if (g.sanity.value < SANITY.thresholds.unstable) confidence -= 0.3;
    if (this.sensorBonus()) confidence += 0.15;
    confidence = Math.max(0.25, Math.min(0.98, confidence));
    const assaultFrac = 0.85;
    const strains = Object.keys(comp).filter(k => comp[k] > 0);
    this.forecast = {
      tag: assault.tag, dominant: dom, comp, assaultFrac, level, migration,
      confidence, forecastText: assault.forecast, strains, total,
      tags: assault.forecastTags || [],
    };
    g.toast(`Dusk forecast: ${assault.tag}. ${assault.forecast}`, migration ? 'bad' : 'important');
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

    // Conditional incursion: a strong outdoor signature — or an unresolved
    // nest close to the player (§6.3) — draws a focused group.
    this.incursionCd -= dt;
    if (this.incursionCd <= 0 && !this.assaultActive) {
      this.incursionCd = THREAT.incursionCooldown;
      const mag = g.sig.outdoorMagnitude();
      const nest = this.nearbyNest();
      if (mag > THREAT.incursionSigThreshold || nest) {
        const dom = g.sig.dominantChannel(g.sig.sampleTotals(g.player.pos.x, g.player.pos.y + 1, g.player.pos.z, true));
        const strain = dom === 'electrical' || dom === 'vibration' ? 'machine_eater' : dom === 'blood' ? 'runner' : 'drifter';
        const n = g.infected.spawnWave(strain, 2 + Math.floor(mag), { fromAssault: false });
        if (n > 0) {
          g.hud.flashIncursion();
          g.toast(nest && mag <= THREAT.incursionSigThreshold
            ? 'Incursion — the nest nearby is still seeding bodies. Resolve it.'
            : 'Incursion — your signature drew a probe.', 'bad');
        }
      }
    }

    // §6.4 scouts: small daytime groups that investigate a specific signature,
    // testing whether the player reads causal feedback. Rarer and gentler than
    // incursions — one or two bodies drifting toward the loudest emitter.
    this.scoutCd -= dt;
    if (this.scoutCd <= 0 && !this.assaultActive && !isNight) {
      this.scoutCd = THREAT.scoutCooldown;
      const mag = g.sig.outdoorMagnitude();
      if (mag > 0.7 && Math.random() < 0.5) {
        const n = g.infected.spawnWave('drifter', 1 + (mag > 1.4 ? 1 : 0), { fromAssault: false });
        if (n > 0) g.toast('Movement at the treeline — something is investigating your noise.', '');
      }
    }

    // Daytime pressure at low sanity (§7.4): draw from valid outdoor routes.
    this.dayPressureCd -= dt;
    if (this.dayPressureCd <= 0) {
      this.dayPressureCd = 18;
      if (!isNight && g.sanity.value < SANITY.thresholds.unstable) {
        // collapse state may pull a max-tier answer if the campaign feeds it (§7.4)
        const collapse = g.sanity.value < SANITY.thresholds.hallucinating + 1;
        const strain = collapse ? (g.day >= (STRAINS.elite.minDay || 8) ? 'elite' : 'machine_eater') : 'drifter';
        g.infected.spawnWave(strain, 1, { fromAssault: false });
      }
    }
  }

  // An unresolved nest block still standing near the player (§6.3).
  nearbyNest() {
    const g = this.game;
    for (const n of (g.world.poi.nests || [])) {
      if (g.world.get(n.x, n.y, n.z) !== B.NEST) continue;
      if (Math.hypot(n.x - g.player.pos.x, n.z - g.player.pos.z) < THREAT.nestIncursionRange) return n;
    }
    return null;
  }

  onDawn() {
    // dawn ends scheduled pressure but not lingering infected (§6.2)
    if (this.assaultActive) this.endAssault(false);
    this.forecast = null;
    this.assaultDoneForNight = false;
    // arm tomorrow's migration? forecast through environmental signs (§6.4)
    if (!this.migrationArmed && this.game.day >= THREAT.migration.minDay && !this.game.deep?.purged
      && Math.random() < THREAT.migration.chance) {
      this.migrationArmed = true;
      this.game.toast('The birds are gone. Tracks — hundreds — all moving the same direction. Something is coming tonight.', 'bad');
    }
    this.game.hud.updateThreat();
  }

  levelName() { return LEVEL_NAMES[this.forecast ? this.forecast.level : 0]; }

  serialize() {
    return { assaultDone: this.assaultDoneForNight, active: this.assaultActive, forecast: this.forecast, migration: this.migrationArmed };
  }
  load(d) {
    if (!d) return;
    this.assaultDoneForNight = d.assaultDone;
    this.forecast = d.forecast || null;
    this.migrationArmed = !!d.migration;
    // a save made mid-assault resumes the assault (banner re-shown on update)
    this.assaultActive = !!d.active;
    this._bannerShown = false;
  }
}
