// Threat director: forecast selection by dominant signature channel, day
// scaling of the composition, and serialize/load round-tripping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Director } from '../src/director.js';
import { THREAT } from '../src/config.js';
import { makeStubGame } from './helpers.js';

// Stub only what the director reads from game.sig: sampled totals around the
// player, the dominant channel, and the outdoor magnitude.
function rig({ totals = {}, day = 1, sanity = 100, outdoor = 0 } = {}) {
  const game = makeStubGame({ day });
  game.sanity.value = sanity;
  game.sig = {
    sampleTotals: () => ({ ...totals }),
    dominantChannel(t) {
      let best = null, bestV = 0.05;
      for (const ch in t) if (t[ch] > bestV) { bestV = t[ch]; best = ch; }
      return best;
    },
    outdoorMagnitude: () => outdoor,
  };
  game.infected = { list: [], spawnWave: () => 0, countReal: () => 0 };
  const director = new Director(game);
  game.director = director;
  return { game, director };
}

test('buildForecast picks the assault matching the dominant channel', () => {
  const cases = [
    [{ electrical: 1.0, heat: 0.2 }, 'live_wire'],
    [{ heat: 0.9, co2: 0.1 }, 'warm_tracks'],
    [{ blood: 0.7 }, 'blood_run'],
  ];
  for (const [totals, expectedId] of cases) {
    const { director } = rig({ totals });
    director.buildForecast();
    const expected = THREAT.assaults.find(a => a.id === expectedId);
    assert.equal(director.forecast.tag, expected.tag, JSON.stringify(totals));
    assert.equal(director.forecast.dominant, expected.dominant);
    assert.equal(director.forecast.forecastText, expected.forecast);
  }
});

test('no dominant channel falls back to the baseline assault', () => {
  const { director } = rig({ totals: { heat: 0.01 } }); // below 0.05 floor
  director.buildForecast();
  const baseline = THREAT.assaults.find(a => a.dominant === null);
  assert.equal(director.forecast.tag, baseline.tag);
  assert.equal(director.forecast.dominant, null);
});

test('composition counts scale with game.day', () => {
  const totals = { electrical: 1.0 };
  const { director: d1 } = rig({ totals, day: 1 });
  d1.buildForecast();
  const { director: d5 } = rig({ totals, day: 5 });
  d5.buildForecast();

  assert.ok(d5.forecast.total > d1.forecast.total,
    `day 5 total ${d5.forecast.total} should exceed day 1 total ${d1.forecast.total}`);
  // per-strain: machine_eater grows by floor(1.1 * day) for live_wire
  const assault = THREAT.assaults.find(a => a.id === 'live_wire');
  assert.equal(d1.forecast.comp.machine_eater,
    assault.base.machine_eater + Math.floor(assault.perDay.machine_eater * 1));
  assert.equal(d5.forecast.comp.machine_eater,
    assault.base.machine_eater + Math.floor(assault.perDay.machine_eater * 5));
});

test('scaleComp leaves the base table untouched (pure)', () => {
  const { director } = rig();
  const assault = THREAT.assaults[0];
  const before = JSON.stringify(assault.base);
  director.scaleComp(assault, 7);
  assert.equal(JSON.stringify(assault.base), before);
});

test('low sanity degrades forecast confidence', () => {
  const { director: stable } = rig({ totals: { heat: 1 }, sanity: 100 });
  stable.buildForecast();
  const { director: shaky } = rig({ totals: { heat: 1 }, sanity: 20 });
  shaky.buildForecast();
  assert.ok(shaky.forecast.confidence < stable.forecast.confidence);
  assert.ok(shaky.forecast.confidence >= 0.25, 'confidence is floored');
});

test('serialize()/load() round-trips forecast + assault flags', () => {
  const { director } = rig({ totals: { electrical: 1.0 }, day: 3 });
  director.buildForecast();
  director.assaultActive = true;
  director.assaultDoneForNight = true;
  const data = JSON.parse(JSON.stringify(director.serialize()));

  const { director: fresh } = rig();
  fresh.load(data);
  assert.equal(fresh.assaultActive, true);
  assert.equal(fresh.assaultDoneForNight, true);
  assert.deepEqual(fresh.forecast, director.forecast);
});

test('load(null) leaves a fresh director untouched', () => {
  const { director } = rig();
  director.load(null);
  assert.equal(director.forecast, null);
  assert.equal(director.assaultActive, false);
});

test('onDawn clears the forecast and re-arms the nightly assault', () => {
  const { director } = rig({ totals: { heat: 1 } });
  director.buildForecast();
  director.assaultDoneForNight = true;
  director.onDawn();
  assert.equal(director.forecast, null);
  assert.equal(director.assaultDoneForNight, false);
  assert.equal(director.assaultActive, false);
});
