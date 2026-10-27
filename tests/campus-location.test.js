import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedLocation } from '../src/campus-location.js';

test('pin detects a mapped building and preserves unmapped coordinates', () => {
  assert.equal(pinnedLocation({ latitude: 8.24175844, longitude: 124.24389112 }), 'COE Building');
  assert.equal(
    pinnedLocation({ latitude: 8.23985595, longitude: 124.24419623 }),
    'Main Library Building'
  );
  assert.equal(
    pinnedLocation({ latitude: 8.24, longitude: 124.24 }),
    'Map pin: 8.240000, 124.240000'
  );
});
