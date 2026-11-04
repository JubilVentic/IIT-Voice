import test from 'node:test';
import assert from 'node:assert/strict';
import { reportTracking, trackingSteps } from '../src/report-tracker.js';

test('reporter tracking follows the work lifecycle without treating resolved or rejected as closed', () => {
  assert.equal(trackingSteps.length, 5);
  for (const [status, step] of Object.entries({
    submitted: 1,
    needs_information: 1,
    validated: 2,
    in_progress: 2,
    resolved: 3,
    closed: 4,
    rejected: 1,
    duplicate: 1,
  })) {
    const progress = reportTracking({ status });
    assert.equal(progress.step, step, status);
    assert.equal(progress.closed, status === 'closed');
    assert.equal(progress.stopped, ['rejected', 'duplicate'].includes(status));
    assert.equal(progress.needsInformation, status === 'needs_information');
  }
  assert.equal(
    reportTracking({ status: 'in_progress' }).closed,
    false,
    'Reopened work returns to office action'
  );
  assert.match(reportTracking({ status: 'resolved' }).description, /still needs to review/);
  const visible = { id: 1, message: 'Please add the room number.' };
  assert.equal(
    reportTracking({
      status: 'needs_information',
      events: [visible, { id: 2, internal: true, message: 'Private staff note' }],
    }).latest,
    visible
  );
  assert.equal(reportTracking({ status: 'unknown' }).closed, false);
});
