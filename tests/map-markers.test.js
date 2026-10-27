import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryPins, priorityPins, pinAppearance, filterMapReports } from '../src/map-markers.js';

test('map filters combine additional categories, priority and status without duplicating reports or adding unpinned concerns', () => {
  const safety = 'Safety, Security & Risk',
    facilities = 'Facilities, Infrastructure & Maintenance';
  const reports = [
    {
      id: 1,
      category: facilities,
      categories: [facilities, safety],
      priority: 'urgent',
      status: 'in_progress',
      latitude: 8.24,
      longitude: 124.24,
    },
    {
      id: 2,
      category: safety,
      priority: 'normal',
      status: 'resolved',
      latitude: 8.25,
      longitude: 124.25,
    },
    {
      id: 3,
      category: safety,
      priority: 'urgent',
      status: 'in_progress',
      latitude: null,
      longitude: null,
    },
    {
      id: 4,
      category: safety,
      priority: 'urgent',
      status: 'in_progress',
      latitude: NaN,
      longitude: 124.24,
    },
  ];
  assert.deepEqual(
    filterMapReports(reports, { category: safety }).map((r) => r.id),
    [1, 2]
  );
  assert.deepEqual(
    filterMapReports(reports, { category: safety, priority: 'urgent', status: 'in_progress' }).map(
      (r) => r.id
    ),
    [1]
  );
  assert.deepEqual(filterMapReports(reports, { category: facilities, priority: 'normal' }), []);
  assert.equal(pinAppearance(reports[0], 'category'), categoryPins[facilities]);
  assert.equal(pinAppearance(reports[0], 'priority'), priorityPins.urgent);
  assert.equal(new Set(Object.values(categoryPins).map((pin) => pin.symbol)).size, 9);
  assert.equal(new Set(Object.values(priorityPins).map((pin) => pin.color)).size, 4);
});
