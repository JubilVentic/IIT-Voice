import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildingExportRows,
  reportBuildingLocation,
  reportCsv,
  summarizeBuildings,
  summaryBuildingOutline,
} from '../src/building-reports.js';
import { filterSummaryReports } from '../src/report-summary.js';
import { campusImagePoint, indoorBuildings } from '../src/indoor-location.js';
import { planPosition } from '../src/campus-plan.js';
import campus from '../src/campus-buildings.json' with { type: 'json' };

test('building previews use the saved campus outlines and never invent unknown locations', () => {
  for (const building of indoorBuildings) {
    assert.deepEqual(summaryBuildingOutline(building.id), {
      id: building.id,
      name: building.name,
      outline: building.outline.map(campusImagePoint),
    });
  }
  const legacy = campus.buildings.find((b) => b.name === 'New CASS Building');
  assert.deepEqual(
    summaryBuildingOutline(`named:${legacy.name}`).outline,
    legacy.outline.map(([latitude, longitude]) => planPosition({ latitude, longitude }))
  );
  assert.equal(summaryBuildingOutline('unmapped'), null);
  assert.equal(summaryBuildingOutline('unknown'), null);
  assert.equal(summaryBuildingOutline(''), null);
});

const reports = [
  {
    id: 1,
    title: 'Ceiling leak',
    category: 'Safety',
    categories: ['Safety', 'Maintenance'],
    status: 'submitted',
    priority: 'urgent',
    location: 'Old CASS Building · Ground floor',
    indoor_location: { building_id: 'old-cass', floor_id: 'ground' },
    created_at: '2026-11-02T16:00:00Z',
  },
  {
    id: 2,
    title: 'Chair repaired',
    category: 'Maintenance',
    status: 'closed',
    priority: 'normal',
    location: 'Old CASS Building',
    indoor_location: { building_id: 'old-cass', floor_id: 'second' },
    created_at: '2026-11-03T03:00:00Z',
  },
  {
    id: 3,
    title: 'Written floor note',
    category: 'Maintenance',
    status: 'rejected',
    priority: 'low',
    location: 'Old CASS Building',
    location_details: '3rd floor',
    created_at: '2026-11-03T05:00:00Z',
  },
  {
    id: 4,
    title: 'Outdoor concern',
    category: 'Safety',
    status: 'in_progress',
    priority: 'high',
    location: 'Near Old CASS Building',
    created_at: '2026-11-03T06:00:00Z',
  },
  {
    id: 5,
    title: 'Library concern',
    category: 'Maintenance',
    status: 'validated',
    priority: 'normal',
    location: 'Main Library Building',
    created_at: '2026-11-03T07:00:00Z',
  },
];

test('building and floor counts reconcile once per report, include missing floors and preserve zero-floor counts', () => {
  const buildings = summarizeBuildings(reports);
  assert.equal(
    buildings.reduce((sum, b) => sum + b.count, 0),
    5
  );
  const cass = buildings.find((b) => b.id === 'old-cass');
  assert.deepEqual(
    [cass.count, cass.active, cass.completed, cass.other, cass.urgent],
    [3, 1, 1, 1, 1]
  );
  assert.deepEqual(
    cass.floors.map((f) => f.count),
    [1, 1, 0, 0, 1]
  );
  assert.equal(
    cass.floors.reduce((sum, f) => sum + f.count, 0),
    cass.count
  );
  assert.equal(reportBuildingLocation(reports[3]).buildingId, 'unmapped');
  assert.equal(reportBuildingLocation(reports[4]).buildingId, 'main-library');
  assert.equal(reportBuildingLocation(reports[2]).floorId, 'unspecified');
  assert.equal(
    summarizeBuildings([]).every((b) => b.count === 0),
    true
  );
});

test('building and floor filters combine with dates, categories and statuses without leaking another floor', () => {
  assert.deepEqual(
    filterSummaryReports(reports, { building: 'old-cass' }).map((r) => r.id),
    [1, 2, 3]
  );
  assert.deepEqual(
    filterSummaryReports(reports, {
      building: 'old-cass',
      floor: 'second',
      status: 'closed',
      category: 'Maintenance',
      from: '2026-11-03',
      through: '2026-11-03',
    }).map((r) => r.id),
    [2]
  );
  assert.deepEqual(
    filterSummaryReports(reports, { building: 'old-cass', floor: 'unspecified' }).map((r) => r.id),
    [3]
  );
  assert.equal(filterSummaryReports(reports, { building: 'old-cass', floor: 'third' }).length, 0);
  assert.deepEqual(
    filterSummaryReports(reports, { building: 'unmapped' }).map((r) => r.id),
    [4]
  );
});

test('summary and detail exports reconcile with selected reports and keep metadata out of account data', () => {
  const selected = filterSummaryReports(reports, { building: 'old-cass', floor: 'ground' });
  const summary = buildingExportRows(selected);
  assert.deepEqual(summary[1], ['Old CASS Building', 'Ground floor', 1, 1, 0, 0, 1]);
  assert.equal(
    buildingExportRows(reports)
      .slice(1)
      .reduce((sum, row) => sum + row[2], 0),
    reports.length
  );
  const details = buildingExportRows(selected, true);
  assert.equal(details.length, 2);
  assert.equal(details[1][0], 'IV-0001');
  assert.equal(details[1][6], 'Safety · Maintenance');
  assert.match(details[1][10], /2026-11-03/);
  assert.equal(
    details[0].some((heading) => /email|reporter|password/i.test(heading)),
    false
  );
  assert.equal(buildingExportRows([]).length, 1);
});

test('CSV downloads preserve Unicode, commas, quotes, line breaks and numeric counts while escaping formulas', () => {
  const csv = reportCsv([
    ['MSU–IIT', 'A, "quoted" room\nnext line', '=1+1', ' \t@SUM(A1)', '-2+3', '+cmd', 3],
  ]);
  assert.equal(
    csv,
    '\uFEFF"MSU–IIT","A, ""quoted"" room\nnext line","\'=1+1","\' \t@SUM(A1)","\'-2+3","\'+cmd",3\r\n'
  );
});
