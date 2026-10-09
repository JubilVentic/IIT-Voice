import test from 'node:test';
import assert from 'node:assert/strict';
import { priorityOrder } from '../src/lib.js';

test('review queue orders by urgency, then oldest within the same priority', () => {
  const reports = [
    { id: 1, priority: 'normal', created_at: '2026-10-01' },
    { id: 2, priority: 'urgent', created_at: '2026-10-08' },
    { id: 3, priority: 'low', created_at: '2026-09-01' },
    { id: 4, priority: 'high', created_at: '2026-10-02' },
    { id: 5, priority: 'urgent', created_at: '2026-10-07' },
  ];
  assert.deepEqual(reports.sort(priorityOrder).map(r => r.id), [5, 2, 4, 1, 3]);
});
