import { campusImagePoint, indoorBuildings } from './indoor-location.js';
import { planPosition } from './campus-plan.js';
import campus from './campus-buildings.json' with { type: 'json' };
import { isActiveReport, isCompletedReport, reportCategories, statusLabels } from './lib.js';

// Match saved building IDs or exact building names; never infer a floor from GPS or prose.
export const summaryBuildings = [...indoorBuildings];
for (const building of campus.buildings) {
  if (!summaryBuildings.some((known) => known.name === building.name)) {
    if (building.name === 'MSU-IIT Gymnasium') continue;
    summaryBuildings.push({ id: `named:${building.name}`, name: building.name, floors: [] });
  }
}
summaryBuildings.sort((a, b) => a.name.localeCompare(b.name));
summaryBuildings.push({ id: 'unmapped', name: 'Other / unspecified building', floors: [] });

export function summaryBuildingOutline(id) {
  const building = summaryBuildings.find((b) => b.id === id);
  if (!building || id === 'unmapped') return null;
  const outline = building.outline
    ? building.outline.map(campusImagePoint)
    : campus.buildings
        .find((b) => b.name === building.name)
        ?.outline.map(([latitude, longitude]) => planPosition({ latitude, longitude }));
  const holes = building.holes?.map((ring) => ring.map(campusImagePoint));
  return outline ? { id: building.id, name: building.name, outline, holes } : null;
}

export function reportBuildingLocation(report) {
  const indoor = report.indoor_location;
  const name = (report.location || '').split(' · ')[0].trim().toLowerCase();
  const building =
    summaryBuildings.find((b) => b.id === indoor?.building_id) ||
    summaryBuildings.find((b) => b.name.toLowerCase() === name) ||
    (name === 'msu-iit gymnasium' ? summaryBuildings.find((b) => b.id === 'gymnasium') : null) ||
    summaryBuildings.at(-1);
  const floor = building.floors.find((f) => f.id === indoor?.floor_id);
  return {
    buildingId: building.id,
    building: building.name,
    floorId: floor?.id || 'unspecified',
    floor: floor?.name || 'Floor not recorded',
  };
}

const counts = () => ({ count: 0, active: 0, completed: 0, other: 0, urgent: 0 });
export function summarizeBuildings(reports) {
  const buildings = new Map(
    summaryBuildings.map((b) => [
      b.id,
      {
        id: b.id,
        name: b.name,
        ...counts(),
        floors: [...b.floors, { id: 'unspecified', name: 'Floor not recorded' }].map((f) => ({
          ...f,
          ...counts(),
        })),
      },
    ])
  );
  for (const report of reports) {
    const location = reportBuildingLocation(report);
    const building = buildings.get(location.buildingId);
    const floor = building.floors.find((f) => f.id === location.floorId);
    for (const row of [building, floor]) {
      row.count++;
      if (isActiveReport(report)) row.active++;
      else if (isCompletedReport(report)) row.completed++;
      else row.other++;
      if (isActiveReport(report) && report.priority === 'urgent') row.urgent++;
    }
  }
  return [...buildings.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Quote every text cell and neutralize spreadsheet formulas in user-entered fields.
export function reportCsv(rows) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            if (typeof value === 'number') return String(value);
            let text = String(value ?? '');
            if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
            return `"${text.replaceAll('"', '""')}"`;
          })
          .join(',')
      )
      .join('\r\n') +
    '\r\n'
  );
}

export function buildingExportRows(reports, details = false) {
  if (!details)
    return [
      [
        'Building',
        'Floor',
        'Reports',
        'Active',
        'Resolved / closed',
        'Rejected / duplicate',
        'Urgent active',
      ],
      ...summarizeBuildings(reports).flatMap((building) =>
        building.floors
          .filter((floor) => floor.count)
          .map((floor) => [
            building.name,
            floor.name,
            floor.count,
            floor.active,
            floor.completed,
            floor.other,
            floor.urgent,
          ])
      ),
    ];
  return [
    [
      'Report ID',
      'Title',
      'Building',
      'Floor',
      'Written location',
      'Location details',
      'Categories',
      'Status',
      'Priority',
      'Responsible office',
      'Submitted (Asia/Manila)',
    ],
    ...reports.map((report) => {
      const location = reportBuildingLocation(report);
      return [
        `IV-${String(report.id).padStart(4, '0')}`,
        report.title,
        location.building,
        location.floor,
        report.location,
        report.location_details,
        reportCategories(report).join(' · '),
        statusLabels[report.status],
        report.priority,
        report.office || 'Not assigned',
        new Date(report.created_at).toLocaleString('en-CA', {
          timeZone: 'Asia/Manila',
          hour12: false,
        }),
      ];
    }),
  ];
}
