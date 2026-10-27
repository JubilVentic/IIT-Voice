import { matchesCategory } from './lib.js';

export const categoryPins = {
  'Facilities, Infrastructure & Maintenance': { color: '#95612b', symbol: '1' },
  'Safety, Security & Risk': { color: '#b62f46', symbol: '2' },
  'Environmental, Aesthetics & Landscaping': { color: '#357554', symbol: '3' },
  'ICT, Internet & Digital Services': { color: '#326fb0', symbol: '4' },
  'Student Needs & Learning Environment': { color: '#8055a1', symbol: '5' },
  'Academic, Research & Innovation Enterprises': { color: '#277c83', symbol: '6' },
  'Administrative, HR & Workplace': { color: '#9c476c', symbol: '7' },
  'Procurement, Property & Finance': { color: '#70752e', symbol: '8' },
  'Public Information, Policy & Legal': { color: '#535f91', symbol: '9' },
};

export const priorityPins = {
  low: { color: '#65758a', symbol: 'L' },
  normal: { color: '#326fb0', symbol: 'N' },
  high: { color: '#aa701b', symbol: 'H' },
  urgent: { color: '#b62f46', symbol: 'U' },
};

export const pinAppearance = (report, colorBy) =>
  (colorBy === 'category' ? categoryPins[report.category] : priorityPins[report.priority]) || {
    color: '#7a203c',
    symbol: '?',
  };
export const hasMapPin = (report) =>
  Number.isFinite(report.latitude) && Number.isFinite(report.longitude);

export function filterMapReports(reports, { category = '', priority = '', status = '' } = {}) {
  return reports.filter(
    (report) =>
      hasMapPin(report) &&
      matchesCategory(report, category) &&
      (!priority || report.priority === priority) &&
      (!status || report.status === status)
  );
}
