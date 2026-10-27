import { matchesCategory, reportCategories, statusLabels } from './lib.js';
import { hasMapPin } from './map-markers.js';

const dayMs = 86400000;
const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export const isActiveReport = (report) =>
  !['resolved', 'closed', 'rejected', 'duplicate'].includes(report.status);
export const isCompletedReport = (report) => ['resolved', 'closed'].includes(report.status);

export function submissionDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(
    calendar.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dateWindow(period, today = submissionDay(new Date())) {
  if (period === 'all' || period === 'custom') return { from: '', through: '' };
  const from =
    period === 'year'
      ? `${today.slice(0, 4)}-01-01`
      : new Date(Date.parse(`${today}T00:00:00Z`) - (Number(period) - 1) * dayMs)
          .toISOString()
          .slice(0, 10);
  return { from, through: today };
}

export function filterSummaryReports(
  reports,
  { from = '', through = '', category = '', office = '', status = '', priority = '' } = {}
) {
  if (from && through && from > through) return [];
  return reports.filter((report) => {
    const day = submissionDay(report.created_at);
    return (
      (!from || day >= from) &&
      (!through || (day && day <= through)) &&
      matchesCategory(report, category) &&
      (!office ||
        (office === 'unassigned'
          ? report.office_id == null
          : report.office_id === Number(office))) &&
      (!status || report.status === status) &&
      (!priority || report.priority === priority)
    );
  });
}

export function summarizeReports(reports, categories, offices) {
  const categoryCounts = new Map(categories.map((category) => [category, 0]));
  const statusCounts = Object.fromEntries(Object.keys(statusLabels).map((status) => [status, 0]));
  const officeCounts = new Map([
    ...offices.map((office) => [
      String(office.id),
      { ...office, count: 0, active: 0, completed: 0 },
    ]),
    ['unassigned', { id: 'unassigned', name: 'Not assigned', count: 0, active: 0, completed: 0 }],
  ]);
  let active = 0,
    completed = 0,
    urgent = 0;
  for (const report of reports) {
    if (isActiveReport(report)) {
      active++;
      if (report.priority === 'urgent') urgent++;
    }
    if (isCompletedReport(report)) completed++;
    statusCounts[report.status] = (statusCounts[report.status] || 0) + 1;
    for (const category of new Set(reportCategories(report)))
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    const office = officeCounts.get(String(report.office_id ?? 'unassigned'));
    if (office) {
      office.count++;
      if (isActiveReport(report)) office.active++;
      if (isCompletedReport(report)) office.completed++;
    }
  }
  return {
    total: reports.length,
    active,
    completed,
    urgent,
    statuses: statusCounts,
    categories: [...categoryCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    offices: [...officeCounts.values()].sort(
      (a, b) => b.active - a.active || b.count - a.count || a.name.localeCompare(b.name)
    ),
  };
}

export function submissionTrend(reports, from, through, today = submissionDay(new Date())) {
  const days = reports
    .map((report) => submissionDay(report.created_at))
    .filter(Boolean)
    .sort();
  const start = from || days[0] || today,
    end = through || [today, days.at(-1) || today].sort().at(-1);
  const startMs = Date.parse(`${start}T00:00:00Z`),
    endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs)
    return { grain: 'day', bins: [] };
  const span = (endMs - startMs) / dayMs + 1;
  const grain = span > 1096 ? 'year' : span > 120 ? 'month' : span > 31 ? 'week' : 'day';
  const key = (day) =>
    grain === 'year'
      ? day.slice(0, 4)
      : grain === 'month'
        ? day.slice(0, 7)
        : grain === 'week'
          ? String(Math.floor((Date.parse(`${day}T00:00:00Z`) - startMs) / (7 * dayMs)))
          : day;
  const counts = new Map();
  for (const day of days)
    if (day >= start && day <= end) counts.set(key(day), (counts.get(key(day)) || 0) + 1);
  const bins = [];
  for (let cursor = startMs; cursor <= endMs;) {
    const date = new Date(cursor),
      first = date.toISOString().slice(0, 10);
    const next =
      grain === 'year'
        ? Date.UTC(date.getUTCFullYear() + 1, 0, 1)
        : grain === 'month'
          ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
          : cursor + (grain === 'week' ? 7 : 1) * dayMs;
    bins.push({
      from: first,
      through: new Date(Math.min(endMs, next - dayMs)).toISOString().slice(0, 10),
      count: counts.get(key(first)) || 0,
    });
    cursor = next;
  }
  return { grain, bins };
}

// A fixed geographic grid groups nearby pins consistently at every map zoom.
export function reportHotspots(reports) {
  const cells = new Map();
  for (const report of reports.filter(hasMapPin)) {
    const key = `${Math.floor(report.latitude / 0.0005)}:${Math.floor(report.longitude / 0.0005)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(report);
  }
  return [...cells].map(([key, reports]) => ({
    key,
    reports,
    count: reports.length,
    latitude: reports.reduce((sum, report) => sum + report.latitude, 0) / reports.length,
    longitude: reports.reduce((sum, report) => sum + report.longitude, 0) / reports.length,
  }));
}
