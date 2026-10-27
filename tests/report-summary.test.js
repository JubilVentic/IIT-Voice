import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateWindow,
  filterSummaryReports,
  reportHotspots,
  submissionDay,
  submissionTrend,
  summarizeReports,
} from '../src/report-summary.js';

const facilities = 'Facilities, Infrastructure & Maintenance',
  safety = 'Safety, Security & Risk';
const reports = [
  {
    id: 1,
    created_at: '2026-10-25T16:00:00Z',
    category: facilities,
    categories: [facilities, safety],
    office_id: 2,
    status: 'in_progress',
    priority: 'urgent',
    latitude: 8.2411,
    longitude: 124.2431,
  },
  {
    id: 2,
    created_at: '2026-10-26T15:59:59Z',
    category: safety,
    office_id: 2,
    status: 'closed',
    priority: 'urgent',
    latitude: 8.2412,
    longitude: 124.2432,
  },
  {
    id: 3,
    created_at: '2026-10-26T16:00:00Z',
    category: safety,
    office_id: null,
    status: 'submitted',
    priority: 'normal',
    latitude: null,
    longitude: null,
  },
  {
    id: 4,
    created_at: '2026-10-24T12:00:00Z',
    category: facilities,
    office_id: 4,
    status: 'rejected',
    priority: 'low',
    latitude: 8.25,
    longitude: 124.25,
  },
];

test('summary filters use inclusive Philippine dates and combine office, priority, status and additional categories', () => {
  assert.equal(submissionDay(reports[0].created_at), '2026-10-26');
  assert.equal(submissionDay('not a date'), '');
  assert.deepEqual(dateWindow('7', '2026-10-27'), { from: '2026-10-21', through: '2026-10-27' });
  assert.deepEqual(dateWindow('year', '2026-10-27'), { from: '2026-01-01', through: '2026-10-27' });
  assert.deepEqual(
    filterSummaryReports(reports, {
      from: '2026-10-26',
      through: '2026-10-26',
      category: safety,
      office: '2',
      priority: 'urgent',
    }).map((r) => r.id),
    [1, 2]
  );
  assert.deepEqual(
    filterSummaryReports(reports, { category: safety, status: 'in_progress' }).map((r) => r.id),
    [1]
  );
  assert.deepEqual(
    filterSummaryReports(reports, { office: 'unassigned' }).map((r) => r.id),
    [3]
  );
  assert.deepEqual(
    filterSummaryReports(reports, { from: '2026-10-27', through: '2026-10-26' }),
    []
  );
});

test('summary totals count overlapping categories once and distinguish active, completed and rejected work', () => {
  const summary = summarizeReports(
    reports,
    [facilities, safety],
    [
      { id: 2, name: 'Physical Plant' },
      { id: 4, name: 'ICT' },
    ]
  );
  assert.deepEqual(
    [summary.total, summary.active, summary.completed, summary.urgent],
    [4, 2, 1, 1]
  );
  assert.equal(summary.categories.find((row) => row.name === safety).count, 3);
  assert.equal(summary.categories.find((row) => row.name === facilities).count, 2);
  assert.equal(
    Object.values(summary.statuses).reduce((sum, count) => sum + count, 0),
    summary.total
  );
  assert.deepEqual(
    summary.offices.find((office) => office.id === 2),
    { id: 2, name: 'Physical Plant', count: 2, active: 1, completed: 1 }
  );
  assert.equal(summary.offices.find((office) => office.id === 'unassigned').active, 1);
  assert.equal(summarizeReports([], [safety], []).total, 0);
});

test('submission trends fill empty dates, include period boundaries, and aggregate longer ranges without losing reports', () => {
  const daily = submissionTrend(reports, '2026-10-24', '2026-10-27', '2026-10-27');
  assert.equal(daily.grain, 'day');
  assert.deepEqual(
    daily.bins.map((bin) => bin.count),
    [1, 0, 2, 1]
  );
  assert.equal(submissionTrend(reports, '2026-10-01', '2026-12-01').grain, 'week');
  const monthly = submissionTrend(reports, '2026-01-15', '2026-12-31');
  assert.equal(monthly.grain, 'month');
  assert.equal(monthly.bins[0].from, '2026-01-15');
  assert.equal(
    monthly.bins.reduce((sum, bin) => sum + bin.count, 0),
    4
  );
  assert.equal(submissionTrend(reports, '2020-01-01', '2026-12-31').grain, 'year');
  assert.deepEqual(submissionTrend([], '2026-10-27', '2026-10-26').bins, []);
  assert.deepEqual(
    submissionTrend([], '2026-10-26', '2026-10-27').bins.map((bin) => bin.count),
    [0, 0]
  );
});

test('hotspots group nearby pins consistently and leave unpinned reports out of map counts only', () => {
  const cells = reportHotspots([...reports, { id: 5, latitude: NaN, longitude: 124.24 }]);
  assert.equal(cells.length, 2);
  assert.deepEqual(
    cells[0].reports.map((r) => r.id),
    [1, 2]
  );
  assert.equal(cells[0].count, 2);
  assert.ok(Math.abs(cells[0].latitude - 8.24115) < 1e-8);
  assert.equal(
    cells.reduce((sum, cell) => sum + cell.count, 0),
    3
  );
  assert.equal(reportHotspots(filterSummaryReports(reports, { office: 'unassigned' })).length, 0);
});
