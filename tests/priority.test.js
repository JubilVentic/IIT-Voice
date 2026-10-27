import test from 'node:test';
import assert from 'node:assert/strict';
import { priorityOrder, newestFirst, matchesCategory, matchesArea } from '../src/lib.js';

test('optional urgent-first sort orders by urgency, then oldest within the same priority', () => {
  const reports = [
    { id: 1, priority: 'normal', created_at: '2026-10-01' },
    { id: 2, priority: 'urgent', created_at: '2026-10-08' },
    { id: 3, priority: 'low', created_at: '2026-09-01' },
    { id: 4, priority: 'high', created_at: '2026-10-02' },
    { id: 5, priority: 'urgent', created_at: '2026-10-07' },
  ];
  assert.deepEqual(
    reports.sort(priorityOrder).map((r) => r.id),
    [5, 2, 4, 1, 3]
  );
});

test('newest sort uses submission time with a stable ID tie-break, and overlap filters count one report', () => {
  const reports = [
    {
      id: 1,
      category: 'Safety',
      categories: ['Safety', 'Maintenance'],
      created_at: '2026-10-10',
      updated_at: '2026-10-14',
    },
    {
      id: 2,
      category: 'Digital',
      categories: ['Digital'],
      created_at: '2026-10-12',
      updated_at: '2026-10-12',
    },
    { id: 3, category: 'Safety', categories: ['Safety', 'Digital'], created_at: '2026-10-12' },
  ];
  assert.deepEqual(
    [...reports].sort(newestFirst).map((r) => r.id),
    [3, 2, 1]
  );
  assert.deepEqual(
    reports.filter((r) => matchesCategory(r, 'Maintenance')).map((r) => r.id),
    [1]
  );
  assert.deepEqual(
    reports.filter((r) => matchesCategory(r, 'Safety')).map((r) => r.id),
    [1, 3]
  );
  assert.deepEqual(
    reports
      .filter((r) =>
        matchesArea(r, 'Physical', [{ name: 'Physical', categories: ['Safety', 'Maintenance'] }])
      )
      .map((r) => r.id),
    [1, 3]
  );
  assert.equal(matchesCategory({ category: 'Safety' }, 'Safety'), true);
});
