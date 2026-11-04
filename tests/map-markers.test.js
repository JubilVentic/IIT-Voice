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
  assert.deepEqual(pinAppearance(reports[0], 'category'), {
    ...categoryPins[facilities],
    completed: false,
  });
  assert.deepEqual(pinAppearance(reports[0], 'priority'), {
    ...priorityPins.urgent,
    completed: false,
  });
  assert.equal(new Set(Object.values(categoryPins).map((pin) => pin.symbol)).size, 9);
  assert.equal(new Set(Object.values(priorityPins).map((pin) => pin.color)).size, 4);
});

test('active and completed map filters preserve report positions and completion keeps the chosen color', () => {
  const reports = [
    'submitted',
    'needs_information',
    'validated',
    'in_progress',
    'resolved',
    'closed',
    'rejected',
    'duplicate',
  ].map((status, id) => ({
    id,
    status,
    latitude: 8.24,
    longitude: 124.24,
    priority: 'high',
    category: 'Safety, Security & Risk',
    indoor_location: { building_id: 'old-cass', floor_id: 'ground', x: 0.25, y: 0.8 },
  }));
  const original = structuredClone(reports);
  assert.deepEqual(
    filterMapReports(reports, { status: 'active' }).map((r) => r.status),
    ['submitted', 'needs_information', 'validated', 'in_progress']
  );
  assert.deepEqual(
    filterMapReports(reports, { status: 'completed' }).map((r) => r.status),
    ['resolved', 'closed']
  );
  assert.equal(filterMapReports(reports, { status: 'closed' })[0], reports[5]);
  assert.equal(filterMapReports(reports, { status: '' }).length, 8);
  for (const report of reports) {
    const completed = ['resolved', 'closed'].includes(report.status);
    assert.deepEqual(pinAppearance(report, 'priority'), { ...priorityPins.high, completed });
    assert.deepEqual(pinAppearance(report, 'category'), {
      ...categoryPins[report.category],
      completed,
    });
  }
  assert.deepEqual(reports, original);
});
