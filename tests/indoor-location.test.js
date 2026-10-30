import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildingPin,
  campusImagePoint,
  hasIndoorPoint,
  indoorBuildings,
  indoorArea,
  indoorLabel,
} from '../src/indoor-location.js';
import { planPosition } from '../src/campus-plan.js';
import samples from './indoor-area-samples.json' with { type: 'json' };

test('Supported campus buildings have valid map footprints and only available floors', () => {
  assert.equal(new Set(indoorBuildings.map((b) => b.id)).size, indoorBuildings.length);
  for (const building of indoorBuildings) {
    assert.ok(building.outline.length >= 3);
    for (const point of [...building.outline, building.anchor])
      assert.ok(point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
    if (building.id !== 'old-cass') {
      assert.deepEqual(building.floors, []);
      assert.equal(
        hasIndoorPoint({ building_id: building.id, floor_id: 'ground', x: 0.5, y: 0.5 }),
        false
      );
    }
  }
});

test('Old CASS has four floors and a campus anchor independent of its indoor point', () => {
  const building = indoorBuildings.find((item) => item.id === 'old-cass');
  assert.deepEqual(
    building.floors.map((floor) => floor.id),
    ['ground', 'second', 'third', 'fourth']
  );
  const expected = campusImagePoint(building.anchor),
    actual = planPosition(buildingPin(building));
  assert.ok(Math.hypot(expected[0] - actual[0], expected[1] - actual[1]) < 0.3);
  const point = { building_id: 'old-cass', floor_id: 'second', x: 0.25, y: 0.8 };
  assert.equal(indoorLabel(point), 'Old CASS Building · Second floor');
  assert.equal(hasIndoorPoint(point), true);
  for (const invalid of [
    null,
    { ...point, floor_id: 'missing' },
    { ...point, x: null },
    { ...point, y: NaN },
    { ...point, x: 1.1 },
  ]) {
    assert.equal(hasIndoorPoint(invalid), false);
  }
});

test('Indoor pin names come from the containing labeled room or area on each floor', () => {
  for (const [floor, x, y, name] of samples) {
    const point = { building_id: 'old-cass', floor_id: floor, x: x / 1448, y: y / 1086 };
    assert.equal(indoorArea(point)?.name || null, name, `${floor} at ${x},${y}`);
    assert.equal(
      indoorLabel(point).split(' · ').at(-1),
      name ||
        indoorBuildings[0].floors
          .find((f) => f.id === floor)
          .name.split(' · ')
          .at(-1)
    );
  }
  assert.equal(indoorArea({ building_id: 'old-cass', floor_id: 'ground', x: null, y: null }), null);
  for (const floor of indoorBuildings[0].floors) {
    assert.equal(new Set(floor.areas.map((a) => a.id)).size, floor.areas.length);
    for (const area of floor.areas) {
      assert.ok(area.name && area.outline.length >= 3);
      assert.ok(
        area.outline.every((point) => point.every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
      );
    }
  }
});
