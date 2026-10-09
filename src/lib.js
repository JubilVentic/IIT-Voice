import { createContext, useContext, useState } from 'react';

export const VoiceContext = createContext(null);
export const useVoice = () => useContext(VoiceContext);
export const labels = { student: 'Campus member', validator: 'Validator Admin', admin: 'Main Admin' };
export const priorities = {
  low: { label: 'Low', rank: 3, guidance: 'Can be scheduled; little disruption.' },
  normal: { label: 'Normal', rank: 2, guidance: 'Routine concern; review in the regular queue.' },
  high: { label: 'High', rank: 1, guidance: 'Address soon; significant disruption or risk.' },
  urgent: { label: 'Urgent', rank: 0, guidance: 'Immediate attention; serious risk or critical disruption.' },
};
export const priorityOrder = (a, b) => priorities[a.priority].rank - priorities[b.priority].rank || new Date(a.created_at) - new Date(b.created_at);
export const statusLabels = { submitted: 'Under review', needs_information: 'Needs information', validated: 'Validated', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed', rejected: 'Rejected', duplicate: 'Duplicate' };
export const transitions = { submitted: ['validated', 'needs_information', 'rejected', 'duplicate'], needs_information: ['validated', 'rejected', 'duplicate'], validated: ['in_progress', 'resolved'], in_progress: ['resolved'], resolved: ['closed', 'in_progress'], closed: ['in_progress'], rejected: [], duplicate: [] };
export const campusEmbedUrl = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d5064.310003467271!2d124.2407855759709!3d8.240974100824124!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x325576785fc4d679%3A0x73c07711931c8cce!2sMindanao%20State%20University%20-%20Iligan%20Institute%20of%20Technology!5e1!3m2!1sen!2sph!4v1791521860975!5m2!1sen!2sph';
export const date = value => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const campusReports = reports => reports.filter(r => r.visibility === 'campus' && ['validated', 'in_progress', 'resolved', 'closed'].includes(r.status));
export const formValues = form => Object.fromEntries(new FormData(form));

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return { busy, error, run };
}

export async function uploadEvidence(api, id, file) {
  validateImage(file);
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
  await api(`/api/reports/${id}/attachments`, { method: 'POST', body: { data } });
}

export function validateImage(file) {
  if (!file || !file.size) throw new Error('Choose an image.');
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('Choose a PNG or JPEG image under 2 MB.');
}
