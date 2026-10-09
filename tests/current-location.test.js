import test from 'node:test';
import assert from 'node:assert/strict';
import { currentLocation } from '../src/current-location.js';

test('uses standard accuracy first and retries a timed-out request', async () => {
  const options = [], position = { coords: { latitude: 8.2417, longitude: 124.2439, accuracy: 20 } };
  let retries = 0;
  const result = await currentLocation({ getCurrentPosition(success, failure, settings) {
    options.push(settings);
    if (options.length === 1) failure({ code: 3 }); else success(position);
  } }, () => retries++);
  assert.equal(result, position);
  assert.equal(retries, 1);
  assert.equal(options[0].enableHighAccuracy, false);
  assert.equal(options[1].enableHighAccuracy, true);
});

test('permission denial is reported without requesting again', async () => {
  let attempts = 0;
  await assert.rejects(currentLocation({ getCurrentPosition(success, failure) {
    attempts++; failure({ code: 1 });
  } }, () => assert.fail('must not retry permission denial')), error => error.code === 1);
  assert.equal(attempts, 1);
});

test('reports failure if both location providers cannot resolve a position', async () => {
  let attempts = 0;
  await assert.rejects(currentLocation({ getCurrentPosition(success, failure) {
    attempts++; failure({ code: 2 });
  } }, () => {}), error => error.code === 2);
  assert.equal(attempts, 2);
});
