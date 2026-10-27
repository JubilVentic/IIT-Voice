import test from 'node:test';
import assert from 'node:assert/strict';
import { planPosition, gpsPosition, isOnPlan, planSize } from '../src/campus-plan.js';

test('site-plan alignment matches campus landmarks and round-trips stored GPS pins', () => {
  // PDF x/y measured on the supplied 1191 x 842 page; GPS from the local snapshot.
  const landmarks = [
    [8.242668905, 124.244100415, 850, 539], // Gymnasium
    [8.239335839, 124.244113462, 128, 542], // Administration
    [8.239857123, 124.244197511, 247, 564], // Main Library
    [8.242435098, 124.243338688, 797, 359], // College of Education
    [8.24125794, 124.244710375, 586, 663], // CCS
    [8.241020662, 124.243841909, 489, 478], // TBI
    [8.243636213, 124.243126273, 1040, 316], // Bahay Alumni
    [8.243235192, 124.242674926, 969, 223], // PRISM
    [8.240565449, 124.243052311, 396, 310], // New CASS
  ];
  for (const [latitude, longitude, x, y] of landmarks) {
    const [py, px] = planPosition({ latitude, longitude });
    assert.ok(Math.hypot(px - x, planSize.height - py - y) < 25);
    const gps = gpsPosition({ lat: py, lng: px });
    assert.ok(Math.abs(gps.latitude - latitude) < 0.000001);
    assert.ok(Math.abs(gps.longitude - longitude) < 0.000001);
    assert.equal(isOnPlan(gps), true);
  }
  assert.equal(isOnPlan({ latitude: 8.24, longitude: 124.24 }), false);
  assert.equal(isOnPlan({ latitude: NaN, longitude: 124.244 }), false);
});
