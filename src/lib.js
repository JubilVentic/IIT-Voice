import { createContext, useContext, useState } from 'react';

export const VoiceContext = createContext(null);
export const useVoice = () => useContext(VoiceContext);
export const labels = {
  student: 'Campus member',
  validator: 'Validator Admin',
  admin: 'Main Admin',
  office: 'Responsible Office',
};
export const priorities = {
  low: { label: 'Low', rank: 3, guidance: 'Can be scheduled; little disruption.' },
  normal: { label: 'Normal', rank: 2, guidance: 'Routine concern; review in the regular queue.' },
  high: { label: 'High', rank: 1, guidance: 'Address soon; significant disruption or risk.' },
  urgent: {
    label: 'Urgent',
    rank: 0,
    guidance: 'Immediate attention; serious risk or critical disruption.',
  },
};
export const reportCategories = (report) =>
  report.categories?.length ? report.categories : [report.category];
export const matchesCategory = (report, category) =>
  !category || reportCategories(report).includes(category);
export const matchesArea = (report, area, groups) =>
  !area ||
  groups
    .find((group) => group.name === area)
    ?.categories.some((category) => matchesCategory(report, category));
export const newestFirst = (a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id;
export const priorityOrder = (a, b) =>
  priorities[a.priority].rank - priorities[b.priority].rank ||
  new Date(a.created_at) - new Date(b.created_at);
export const statusLabels = {
  submitted: 'Under review',
  needs_information: 'Needs information',
  validated: 'Validated',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  rejected: 'Rejected',
  duplicate: 'Duplicate',
};
export const transitions = {
  submitted: ['validated', 'needs_information', 'rejected', 'duplicate'],
  needs_information: ['validated', 'rejected', 'duplicate'],
  validated: ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
  rejected: [],
  duplicate: [],
};
export const date = (value) =>
  new Date(value).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const campusReports = (reports) =>
  reports.filter(
    (r) =>
      r.visibility === 'campus' &&
      ['validated', 'in_progress', 'resolved', 'closed'].includes(r.status)
  );
export const formValues = (form) => Object.fromEntries(new FormData(form));

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function readImage(file) {
  validateImage(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadEvidence(api, id, file, analysisToken = '', stage = 'before') {
  const data = await readImage(file);
  await api(`/api/reports/${id}/attachments`, {
    method: 'POST',
    body: { data, filename: file.name, analysis_token: analysisToken, stage },
  });
}

export function validateImage(file) {
  if (!file || !file.size) throw new Error('Choose an image.');
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024)
    throw new Error('Choose a PNG or JPEG image under 2 MB.');
}
