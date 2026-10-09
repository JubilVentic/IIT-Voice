import { useCallback, useEffect, useState } from 'react';
import { campusReports, date, formValues, labels, priorities, statusLabels, transitions, uploadEvidence, useAction, useVoice, validateImage } from '../lib.js';
import { Badge, ErrorMessage, Field, ReportList } from '../components/UI.jsx';
import { ReportMap } from '../components/Maps.jsx';
import { pinnedLocation } from '../campus-location.js';

export function NewReport() {
  const { user, data, api, refresh, toast, openReport, closeModal } = useVoice();
  const [pin, setPin] = useState(null), [location, setLocation] = useState(''), action = useAction();
  function pickLocation(point) {
    setPin(point);
    setLocation(pinnedLocation(point));
  }
  function submit(e) {
    e.preventDefault(); const values = formValues(e.currentTarget);
    action.run(async () => {
      const file = values.image;
      if (file?.size) validateImage(file);
      const body = {};
      for (const key of ['title', 'description', 'category', 'location', 'location_details', 'priority']) body[key] = values[key];
      body.latitude = pin?.latitude ?? null; body.longitude = pin?.longitude ?? null;
      const created = await api('/api/reports', { method: 'POST', body });
      let warning = '';
      if (file?.size) { try { await uploadEvidence(api, created.id, file); } catch (e) { warning = `Report saved; evidence upload failed: ${e.message}. Retry from this report.`; } }
      try { await refresh(); } catch (e) { warning = `Report saved. Unable to refresh the list: ${e.message}`; }
      openReport(created.id); toast(warning || 'Report submitted for validation.');
    });
  }
  return <><div className="eyebrow">NEW CAMPUS CONCERN</div><h2 id="modal-title">What needs attention?</h2><p className="muted">Your submission stays private until reviewed. Evidence stays restricted.</p><form id="report-form" onSubmit={submit}><div className="form-grid"><Field label="Title"><input name="title" required minLength={5} maxLength={150} placeholder="e.g. Broken walkway light"/></Field><Field label="Category"><select name="category">{data.categories.map(c => <option key={c}>{c}</option>)}</select></Field><Field label="Campus location" help="Filled from your pin. Edit the building name if needed."><input name="location" required minLength={3} maxLength={200} value={location} onChange={e => setLocation(e.target.value)} placeholder="Select a pin or enter a campus location"/></Field><Field label="Location details (optional)" help="Visible to you and the review team."><input name="location_details" maxLength={500} placeholder="e.g. 2nd floor, Room 204, beside the stairs"/></Field>{user.role !== 'student' && <Field label="Suggested priority"><select name="priority"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field>}</div><Field label="Describe what you observed"><textarea name="description" required minLength={10} maxLength={5000} placeholder="What happened? When did you observe it?"/></Field><h3>Pin the location (optional)</h3><p className="meta">Use your current location or click the map. Drag the pin to refine its position.</p><ReportMap pick pin={pin} onPick={pickLocation}/><p id="pin-label" className="map-caption">{pin ? `Selected: ${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}` : 'No pin selected.'}</p><button type="button" className="btn link" id="clear-pin" onClick={() => { setPin(null); setLocation(''); }}>Clear pin</button><Field label="Evidence image (optional)" help="PNG or JPEG, up to 2 MB. Available only to you and admins."><input name="image" type="file" accept="image/png,image/jpeg"/></Field><details><summary>Check for existing approved concerns</summary><ReportList reports={campusReports(data.reports).slice(0, 6)}/></details><div className="notice">Immediate danger? Use the campus emergency channel directly. An urgent label does not replace emergency response.</div><ErrorMessage id="report-error">{action.error}</ErrorMessage><div className="actions"><button className="btn solid" type="submit" disabled={action.busy}>Submit for validation</button><button className="btn" type="button" id="cancel-report" disabled={action.busy} onClick={closeModal}>Cancel</button></div></form></>;
}

function ReviewForm({ report, onSaved }) {
  const { data, api, toast } = useVoice(), action = useAction();
  const [priority, setPriority] = useState(report.priority);
  const officeDefault = report.office_id || data.routing.find(x => x.category === report.category)?.office_id || '';
  function submit(e) {
    e.preventDefault(); const body = formValues(e.currentTarget);
    for (const key of ['office_id', 'assigned_to', 'duplicate_of']) body[key] = body[key] ? Number(body[key]) : null;
    action.run(async () => { await api(`/api/reports/${report.id}`, { method: 'PATCH', body }); await onSaved(); toast('Report updated.'); });
  }
  return <section className="panel"><h3>{['submitted', 'needs_information'].includes(report.status) ? 'Review decision' : 'Manage progress'}</h3><form id="review-form" onSubmit={submit}><Field label="Status"><select name="status" defaultValue={report.status}><option value={report.status}>{statusLabels[report.status]} (current)</option>{(transitions[report.status] || []).map(s => <option key={s} value={s}>{statusLabels[s]}</option>)}</select></Field><fieldset className="priority-assessment"><legend>Priority assessment</legend><p className="meta">Choose based on impact and urgency. Explain your assessment in the decision note.</p><div className="priority-options">{Object.entries(priorities).map(([value, option]) => <label key={value} className={`priority-choice ${priority === value ? 'selected' : ''}`}><input type="radio" name="priority" value={value} checked={priority === value} onChange={() => setPriority(value)} aria-label={option.label}/><span><Badge value={value}/><small>{option.guidance}</small></span></label>)}</div></fieldset><Field label="Responsible office"><select name="office_id" defaultValue={officeDefault}><option value="">Not assigned</option>{data.offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field><Field label="Assigned admin"><select name="assigned_to" defaultValue={report.assigned_to || ''}><option value="">Not assigned</option>{data.admins.map(a => <option key={a.id} value={a.id}>{a.name} · {labels[a.role]}</option>)}</select></Field><Field label="Visibility"><select name="visibility" defaultValue={report.visibility}><option value="restricted">Restricted</option><option value="campus">Campus-visible summary</option></select></Field><Field label="Reviewed public title" help="Required for campus visibility."><input name="public_title" maxLength={150} defaultValue={report.public_title} placeholder="A title without personal information"/></Field><Field label="Reviewed public summary" help="Exclude personal information and sensitive details. Required for campus visibility."><textarea name="public_summary" maxLength={3000} defaultValue={report.public_summary}/></Field><Field label="Duplicate of report ID (if applicable)"><input name="duplicate_of" type="number" min={1} defaultValue={report.duplicate_of || ''}/></Field><Field label="Decision / progress note" help="The reporter can read this note."><textarea name="note" required minLength={2} maxLength={2000} placeholder="Explain the decision or action taken"/></Field><ErrorMessage id="review-error">{action.error}</ErrorMessage><button className="btn solid" type="submit" disabled={action.busy}>Save decision</button></form></section>;
}

function CommentForm({ report, admin, onSaved }) {
  const { api, toast } = useVoice(), action = useAction();
  function submit(e) {
    e.preventDefault(); const form = e.currentTarget, values = formValues(form);
    action.run(async () => { await api(`/api/reports/${report.id}/comments`, { method: 'POST', body: { message: values.message, internal: values.internal === 'on' } }); form.reset(); await onSaved(); toast('Update posted.'); });
  }
  return <form id="comment-form" onSubmit={submit}><Field label={admin ? 'Add an update' : 'Add information for the review team'}><textarea name="message" required minLength={2} maxLength={2000}/></Field>{admin && <label className="check"><input type="checkbox" name="internal"/>Internal admin note (hidden from reporter)</label>}<ErrorMessage id="comment-error">{action.error}</ErrorMessage><button className="btn primary" type="submit" disabled={action.busy}>Post update</button></form>;
}

function EvidenceForm({ report, onSaved }) {
  const { api, toast } = useVoice(), action = useAction();
  function submit(e) {
    e.preventDefault(); const form = e.currentTarget, file = form.elements.image.files[0];
    action.run(async () => { await uploadEvidence(api, report.id, file); form.reset(); await onSaved(); toast('Evidence uploaded.'); });
  }
  return <form id="evidence-form" onSubmit={submit}><Field label="Attach evidence (PNG / JPEG, up to 2 MB)" help="Evidence stays restricted to you and admins. Up to three images."><input name="image" type="file" accept="image/png,image/jpeg" required/></Field><ErrorMessage id="evidence-error">{action.error}</ErrorMessage><button className="btn" type="submit" disabled={action.busy}>Upload evidence</button></form>;
}

export function ReportDetails({ id }) {
  const { user, api, refresh } = useVoice();
  const [report, setReport] = useState(null), [error, setError] = useState('');
  useEffect(() => { let active = true; api(`/api/reports/${id}`).then(r => { if (active) setReport(r); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [id, api]);
  const onSaved = useCallback(async () => { const r = await api(`/api/reports/${id}`); setReport(r); await refresh(); }, [id, api, refresh]);
  if (error) return <><h2 id="modal-title">Concern unavailable</h2><ErrorMessage>{error}</ErrorMessage></>;
  if (!report) return <h2 id="modal-title">Loading concern…</h2>;
  const r = report, admin = user.role !== 'student';
  const canUpdate = user.role === 'admin' || (user.role === 'validator' && ['submitted', 'needs_information'].includes(r.status));
  return <><div className="eyebrow">CONCERN · IV-{String(r.id).padStart(4, '0')}</div><h2 id="modal-title">{r.title}</h2><div className="badges"><Badge value={r.status}/><Badge value={r.priority}/><Badge>{r.visibility === 'campus' ? 'Campus summary' : 'Restricted'}</Badge></div><div className="columns"><section><p className="report-description">{r.description}</p><div className="details-card"><p><strong>Category:</strong> {r.category}</p><p><strong>Location:</strong> {r.location}</p>{r.location_details && <p className="report-description"><strong>Location details:</strong> {r.location_details}</p>}<p><strong>Office:</strong> {r.office || 'Awaiting assignment'}</p><p><strong>Submitted:</strong> {date(r.created_at)}</p>{r.reporter && <p><strong>Reporter:</strong> {r.reporter.name} · {r.reporter.affiliation}</p>}{r.duplicate_of && <p>Linked to report #{r.duplicate_of}</p>}</div>{r.attachments.length > 0 && <><h3 className="full">Restricted evidence</h3><div className="evidence">{r.attachments.map(a => <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noopener"><img src={`/api/attachments/${a.id}`} alt={`Evidence image for report ${r.id}`} loading="lazy"/></a>)}</div></>}<h3 className="full">Report activity</h3><div className="timeline">{r.events.length ? r.events.map(e => <div className="event" key={e.id}>{e.message}{e.internal ? <> <Badge>Internal</Badge></> : null}<small>{e.actor} · {date(e.created_at)}</small></div>) : <p className="muted">No updates yet.</p>}</div>{(r.is_mine || admin) && <><CommentForm report={r} admin={admin} onSaved={onSaved}/><EvidenceForm report={r} onSaved={onSaved}/></>}</section>{canUpdate ? <ReviewForm key={`${r.id}-${r.status}-${r.updated_at}`} report={r} onSaved={onSaved}/> : admin ? <section className="panel"><h3>Validation complete</h3><p className="meta">Main Admin manages progress and resolution. You can add internal notes or evidence.</p></section> : null}</div></>;
}
