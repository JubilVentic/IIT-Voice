import { useCallback, useEffect, useRef, useState } from 'react';
import {
  campusReports,
  date,
  reportCategories,
  formValues,
  labels,
  priorities,
  statusLabels,
  transitions,
  uploadEvidence,
  useAction,
  useVoice,
  validateImage,
} from '../lib.js';
import { Badge, ErrorMessage, Field, ReportList } from '../components/UI.jsx';
import { FloorPlan, ReportLocationPicker } from '../components/FloorPlans.jsx';
import { hasIndoorPoint, indoorLabel } from '../indoor-location.js';
import { pinnedLocation } from '../campus-location.js';
import { CategoryFields } from '../components/Categories.jsx';
import { PhotoAssist, CompletionCheck } from '../components/PhotoAssist.jsx';

export function NewReport() {
  const { user, data, api, refresh, toast, openReport, closeModal } = useVoice();
  const [pin, setPin] = useState(null),
    [indoor, setIndoor] = useState(null),
    [location, setLocation] = useState(''),
    [category, setCategory] = useState(data.categories[0]),
    [categories, setCategories] = useState([data.categories[0]]),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [photoAnalysis, setPhotoAnalysis] = useState(null),
    [photoBusy, setPhotoBusy] = useState(false),
    action = useAction();
  const previousDraft = useRef(''),
    photoAssist = useRef(null);
  const [photoError, setPhotoError] = useState('');
  const descriptionEdited = photoAnalysis && description !== (photoAnalysis.description || '');
  function applyPhotoAnalysis(result) {
    setPhotoAnalysis(result);
    if (result?.description) {
      const previous = previousDraft.current;
      setDescription((current) =>
        !current.trim() || current === previous ? result.description : current
      );
      previousDraft.current = result.description;
    }
    if (result?.category) {
      setCategory(result.category);
      setCategories(result.categories?.length ? result.categories : [result.category]);
    }
    if (result?.title || result?.category) setTitle(result.title || result.category);
  }
  function pickLocation(point) {
    setPin({ latitude: point.latitude, longitude: point.longitude });
    setIndoor(point.indoor_location || null);
    setLocation(
      point.indoor_location
        ? indoorLabel(point.indoor_location)
        : point.location || pinnedLocation(point)
    );
  }
  function submit(e) {
    e.preventDefault();
    const values = formValues(e.currentTarget);
    action.run(async () => {
      if (photoBusy || photoAnalysis?.screening?.status === 'rejected')
        throw new Error('Remove or replace the blocked photo before submitting.');
      if (indoor && !hasIndoorPoint(indoor))
        throw new Error('Select the exact concern location on the floor plan before submitting.');
      const file = values.image;
      if (file?.size) validateImage(file);
      const body = {};
      for (const key of [
        'title',
        'description',
        'category',
        'location',
        'location_details',
        'priority',
      ])
        body[key] = values[key];
      body.categories = categories;
      body.latitude = pin?.latitude ?? null;
      body.longitude = pin?.longitude ?? null;
      body.indoor_location = indoor;
      const created = await api('/api/reports', { method: 'POST', body });
      let warning = '';
      if (file?.size) {
        try {
          await uploadEvidence(api, created.id, file, photoAnalysis?.analysis_token || '');
        } catch (e) {
          warning = `Report saved; evidence upload failed: ${e.message}. Retry from this report.`;
        }
      }
      try {
        await refresh();
      } catch (e) {
        warning = `Report saved. Unable to refresh the list: ${e.message}`;
      }
      openReport(created.id);
      toast(warning || 'Report submitted for validation.');
    });
  }
  return (
    <>
      <div className="eyebrow">NEW CAMPUS CONCERN</div>
      <h2 id="modal-title">What needs attention?</h2>
      <p className="muted">
        Your submission stays private until reviewed. Evidence stays restricted.
      </p>
      <form id="report-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Title">
            <input
              name="title"
              required
              minLength={5}
              maxLength={150}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Broken walkway light"
            />
          </Field>
          <CategoryFields
            analysis={photoAnalysis}
            disabled={photoBusy}
            primary={category}
            categories={categories}
            onChange={(primary, selected) => {
              setCategory(primary);
              setCategories(selected);
            }}
          />
          <Field
            label="Campus location"
            help={
              indoor
                ? 'Filled from the building, floor, and mapped area under your pin. Add corrections in Location details.'
                : 'Filled from your pin. Edit the building name if needed.'
            }
          >
            <input
              name="location"
              required
              minLength={3}
              maxLength={200}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Select a pin or enter a campus location"
            />
          </Field>
          <Field label="Location details (optional)" help="Visible to you and the review team.">
            <input
              name="location_details"
              maxLength={500}
              placeholder="e.g. 2nd floor, Room 204, beside the stairs"
            />
          </Field>
          {user.role !== 'student' && (
            <Field label="Suggested priority">
              <select name="priority">
                <option value="normal">Normal</option>
                <option value="low">Low</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
          )}
        </div>
        <div className="field description-editor">
          <div className="description-heading">
            <label htmlFor="report-description">Describe what you observed</label>
            {descriptionEdited && (
              <span id="description-recheck">
                <button
                  type="button"
                  className="btn solid"
                  disabled={photoBusy || !photoAnalysis.ai_available}
                  onClick={() => photoAssist.current?.recheck()}
                >
                  {photoBusy ? 'Checking photo…' : 'Check photo again'}
                </button>
              </span>
            )}
          </div>
          <textarea
            id="report-description"
            name="description"
            aria-describedby="description-help"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            minLength={10}
            maxLength={5000}
            placeholder="What happened? When did you observe it?"
          />
          <small id="description-help">
            {descriptionEdited
              ? 'Your description was edited. Rechecking analyzes the photo only and keeps your wording.'
              : 'AI can draft this from your photo. Review and edit it, and add when you observed the concern.'}
          </small>
          {descriptionEdited && (
            <>
              <p className="meta" role="status">
                {photoBusy
                  ? 'Rechecking the photo. Your description will stay unchanged.'
                  : !photoAnalysis.ai_available
                    ? 'Gemini is not configured. You can edit the report manually.'
                    : ''}
              </p>
              <ErrorMessage>{photoError}</ErrorMessage>
            </>
          )}
        </div>
        {photoAnalysis?.description && description !== photoAnalysis.description && (
          <button
            type="button"
            className="btn link"
            onClick={() => {
              setDescription(photoAnalysis.description);
              previousDraft.current = photoAnalysis.description;
            }}
          >
            Use AI description draft
          </button>
        )}
        <PhotoAssist
          ref={photoAssist}
          onAnalysis={applyPhotoAnalysis}
          onBusyChange={setPhotoBusy}
          onErrorChange={setPhotoError}
          onGeotag={(point) => {
            if (!indoor) pickLocation(point);
          }}
        />
        <h3>Pin the location (optional)</h3>
        <p className="meta">
          Tap a building to select it, or place an outdoor pin. Drag the pin to refine its position.
        </p>
        <ReportLocationPicker pin={pin} indoor={indoor} onPick={pickLocation} />
        <p id="pin-label" className="map-caption">
          {pin
            ? `Selected: ${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`
            : 'No pin selected.'}
        </p>
        <button
          type="button"
          className="btn link"
          id="clear-pin"
          onClick={() => {
            setPin(null);
            setIndoor(null);
            setLocation('');
          }}
        >
          Clear pin
        </button>
        <details>
          <summary>Check for existing approved concerns</summary>
          <ReportList reports={campusReports(data.reports).slice(0, 6)} />
        </details>
        <div className="notice">
          Immediate danger? Use the campus emergency channel directly. An urgent label does not
          replace emergency response.
        </div>
        <ErrorMessage id="report-error">{action.error}</ErrorMessage>
        <div className="actions">
          <button
            className="btn solid"
            type="submit"
            disabled={action.busy || photoBusy || photoAnalysis?.screening?.status === 'rejected'}
          >
            Submit for validation
          </button>
          <button
            className="btn"
            type="button"
            id="cancel-report"
            disabled={action.busy}
            onClick={closeModal}
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}

function PriorityAssessment({ priority, onChange }) {
  return (
    <fieldset className="priority-assessment">
      <legend>Priority assessment</legend>
      <p className="meta">
        Choose based on impact and urgency. Explain your assessment in the decision note.
      </p>
      <div className="priority-options">
        {Object.entries(priorities).map(([value, option]) => (
          <label key={value} className={`priority-choice ${priority === value ? 'selected' : ''}`}>
            <input
              type="radio"
              name="priority"
              value={value}
              checked={priority === value}
              onChange={() => onChange(value)}
              aria-label={option.label}
            />
            <span>
              <Badge value={value} />
              <small>{option.guidance}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ReviewForm({ report, onSaved }) {
  const { data, api, toast } = useVoice(),
    action = useAction();
  const [priority, setPriority] = useState(report.priority);
  const [category, setCategory] = useState(report.category),
    [categories, setCategories] = useState(reportCategories(report));
  const officeDefault =
    report.office_id || data.routing.find((x) => x.category === category)?.office_id || '';
  const [officeId, setOfficeId] = useState(officeDefault);
  const [status, setStatus] = useState(report.status);
  const needsPhoto =
    ['resolved', 'closed'].includes(status) &&
    (!report.has_completion_evidence || Number(officeId) !== report.office_id);
  function submit(e) {
    e.preventDefault();
    const body = formValues(e.currentTarget);
    body.category = category;
    body.categories = categories;
    for (const key of ['office_id', 'assigned_to', 'duplicate_of'])
      body[key] = body[key] ? Number(body[key]) : null;
    action.run(async () => {
      await api(`/api/reports/${report.id}`, { method: 'PATCH', body });
      await onSaved();
      toast('Report updated.');
    });
  }
  return (
    <section className="panel">
      <h3>
        {['submitted', 'needs_information'].includes(report.status)
          ? 'Review decision'
          : 'Manage progress'}
      </h3>
      <form id="review-form" onSubmit={submit}>
        <CategoryFields
          primary={category}
          categories={categories}
          onChange={(primary, selected) => {
            setCategory(primary);
            setCategories(selected);
          }}
        />
        <Field label="Status">
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value={report.status}>{statusLabels[report.status]} (current)</option>
            {(transitions[report.status] || []).map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
        </Field>
        <PriorityAssessment priority={priority} onChange={setPriority} />
        <Field label="Responsible office">
          <select name="office_id" value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
            <option value="">Not assigned</option>
            {data.offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assigned admin">
          <select key={officeId} name="assigned_to" defaultValue={report.assigned_to || ''}>
            <option value="">Not assigned</option>
            {data.admins
              .filter((a) => a.role === 'admin' || a.office_id === Number(officeId))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {labels[a.role]}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Visibility">
          <select name="visibility" defaultValue={report.visibility}>
            <option value="restricted">Restricted</option>
            <option value="campus">Campus-visible summary</option>
          </select>
        </Field>
        <Field label="Reviewed public title" help="Required for campus visibility.">
          <input
            name="public_title"
            maxLength={150}
            defaultValue={report.public_title}
            placeholder="A title without personal information"
          />
        </Field>
        <Field
          label="Reviewed public summary"
          help="Exclude personal information and sensitive details. Required for campus visibility."
        >
          <textarea name="public_summary" maxLength={3000} defaultValue={report.public_summary} />
        </Field>
        <Field label="Duplicate of report ID (if applicable)">
          <input
            name="duplicate_of"
            type="number"
            min={1}
            defaultValue={report.duplicate_of || ''}
          />
        </Field>
        <Field label="Decision / progress note" help="The reporter can read this note.">
          <textarea
            name="note"
            required
            minLength={2}
            maxLength={2000}
            placeholder="Explain the decision or action taken"
          />
        </Field>
        <ErrorMessage id="review-error">{action.error}</ErrorMessage>
        {needsPhoto && (
          <p className="notice" role="status">
            Upload an after-work photo for the current assignment before resolving or closing this
            concern. <a href="#evidence-form">Add completion evidence</a>
          </p>
        )}
        <button className="btn solid" type="submit" disabled={action.busy || needsPhoto}>
          Save decision
        </button>
      </form>
    </section>
  );
}

function ValidationForm({ report, onSaved }) {
  const { data, api, toast } = useVoice(),
    action = useAction();
  const [decision, setDecision] = useState('validated');
  const [priority, setPriority] = useState(report.priority);
  const [office, setOffice] = useState(
    String(
      report.office_id ||
        data.routing.find((rule) => rule.category === report.category)?.office_id ||
        ''
    )
  );
  const [assigned, setAssigned] = useState('');
  const admins = data.admins.filter(
    (account) =>
      account.role === 'admin' ||
      (account.role === 'office' && account.office_id === Number(office))
  );
  function submit(e) {
    e.preventDefault();
    const values = formValues(e.currentTarget);
    action.run(async () => {
      await api(`/api/reports/${report.id}`, {
        method: 'PATCH',
        body: {
          status: decision,
          priority: values.priority,
          note: values.note,
          office_id: decision === 'validated' ? Number(office) : null,
          assigned_to: decision === 'validated' ? Number(assigned) : null,
        },
      });
      await onSaved();
      toast('Validation submitted.');
    });
  }
  return (
    <section className="panel">
      <h3>Validate concern</h3>
      <p className="meta">
        Check the evidence, assess urgency, decide whether the concern is valid, and assign valid
        concerns for action.
      </p>
      <form id="validation-form" onSubmit={submit}>
        <Field label="Validation decision">
          <select name="status" value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="validated">Valid — assign for action</option>
            <option value="rejected">Not valid — reject concern</option>
          </select>
        </Field>
        <PriorityAssessment priority={priority} onChange={setPriority} />
        {decision === 'validated' && (
          <>
            <Field label="Responsible office">
              <select
                name="office_id"
                required
                value={office}
                onChange={(e) => {
                  setOffice(e.target.value);
                  setAssigned('');
                }}
              >
                <option value="">Choose an office</option>
                {data.offices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assigned admin">
              <select
                name="assigned_to"
                required
                value={assigned}
                onChange={(e) => setAssigned(e.target.value)}
              >
                <option value="">Choose an assigned admin</option>
                {admins.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {labels[account.role]}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Field
          label="Validation note"
          help="Explain your decision. The reporter can read this note."
        >
          <textarea name="note" required minLength={2} maxLength={2000} />
        </Field>
        <ErrorMessage>{action.error}</ErrorMessage>
        <button className="btn solid" disabled={action.busy}>
          Submit validation
        </button>
      </form>
    </section>
  );
}

function OfficeProgressForm({ report, onSaved }) {
  const { api, toast } = useVoice(),
    action = useAction();
  function submit(e) {
    e.preventDefault();
    const values = formValues(e.currentTarget),
      status = e.nativeEvent.submitter?.value;
    if (!status) return;
    action.run(async () => {
      await api(`/api/reports/${report.id}`, {
        method: 'PATCH',
        body: { status, note: values.note },
      });
      await onSaved();
      toast(
        status === 'resolved'
          ? 'Work marked complete. Sent to Main Admin for closure.'
          : 'Work started.'
      );
    });
  }
  return (
    <section className="panel">
      <h3>Work progress</h3>
      <p className="meta">
        Current status: <Badge value={report.status} />
      </p>
      <form id="office-progress-form" onSubmit={submit}>
        <Field
          label="Progress note"
          help="Describe the action taken. For notes without a status change, use Post update."
        >
          <textarea name="note" required minLength={2} maxLength={2000} />
        </Field>
        {!report.has_completion_evidence && (
          <p className="notice" role="status">
            Choose a fresh after-work photo, then click Upload evidence before marking work
            complete. <a href="#evidence-form">Add completion evidence</a>
          </p>
        )}
        <ErrorMessage>{action.error}</ErrorMessage>
        <div className="actions">
          {report.status === 'validated' && (
            <button
              type="submit"
              name="status"
              value="in_progress"
              className="btn"
              disabled={action.busy}
            >
              Start work
            </button>
          )}
          <button
            type="submit"
            name="status"
            value="resolved"
            className="btn solid"
            disabled={action.busy || !report.has_completion_evidence}
          >
            Mark work complete
          </button>
        </div>
      </form>
    </section>
  );
}

function CommentForm({ report, admin, onSaved }) {
  const { api, toast } = useVoice(),
    action = useAction();
  function submit(e) {
    e.preventDefault();
    const form = e.currentTarget,
      values = formValues(form);
    action.run(async () => {
      await api(`/api/reports/${report.id}/comments`, {
        method: 'POST',
        body: { message: values.message, internal: values.internal === 'on' },
      });
      form.reset();
      await onSaved();
      toast('Update posted.');
    });
  }
  return (
    <form id="comment-form" onSubmit={submit}>
      <Field label={admin ? 'Add an update' : 'Add information for the review team'}>
        <textarea name="message" required minLength={2} maxLength={2000} />
      </Field>
      {admin && (
        <label className="check">
          <input type="checkbox" name="internal" />
          Internal staff note (hidden from reporter)
        </label>
      )}
      <ErrorMessage id="comment-error">{action.error}</ErrorMessage>
      <button className="btn primary" type="submit" disabled={action.busy}>
        Post update
      </button>
    </form>
  );
}

function EvidenceForm({ report, onSaved }) {
  const { user, api, toast } = useVoice(),
    action = useAction();
  const [analysis, setAnalysis] = useState(null),
    [photoBusy, setPhotoBusy] = useState(false);
  const canAddAfter =
    ['admin', 'office'].includes(user.role) &&
    ['validated', 'in_progress', 'resolved', 'closed'].includes(report.status);
  const [stage, setStage] = useState(canAddAfter ? 'after' : 'before');
  const blocked =
    photoBusy ||
    analysis?.screening?.status === 'rejected' ||
    (stage === 'after' &&
      (analysis?.screening?.status !== 'appropriate' ||
        analysis?.completion_check?.status !== 'supports_completion'));
  function submit(e) {
    e.preventDefault();
    const file = e.currentTarget.elements.image.files[0];
    action.run(async () => {
      if (!file) throw new Error('Choose an evidence photo first.');
      if (blocked)
        throw new Error(
          'Choose a photo that passes safety and concern-specific completion checks.'
        );
      await uploadEvidence(api, report.id, file, analysis?.analysis_token || '', stage);
      await onSaved();
      toast('Evidence uploaded.');
    });
  }
  return (
    <form id="evidence-form" onSubmit={submit}>
      {canAddAfter && (
        <Field
          label="Evidence type"
          help="After-work evidence is required before resolving or closing a concern."
        >
          <select name="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="after">After — completed work</option>
            <option value="before">Before — reported condition</option>
          </select>
        </Field>
      )}
      <PhotoAssist
        key={`${report.attachments.length}-${stage}`}
        reportId={stage === 'after' ? report.id : undefined}
        label={stage === 'after' ? 'After-work photo (required to complete)' : 'Before photo'}
        onAnalysis={setAnalysis}
        onBusyChange={setPhotoBusy}
      />
      <ErrorMessage id="evidence-error">{action.error}</ErrorMessage>
      <button className="btn" type="submit" disabled={action.busy || blocked}>
        {action.busy ? 'Checking and uploading…' : 'Upload evidence'}
      </button>
    </form>
  );
}

function EvidenceComparison({ report, onSaved }) {
  const before = report.attachments.filter((a) => a.metadata?.stage !== 'after');
  const after = report.attachments.filter((a) => a.metadata?.stage === 'after');
  const current = (a) =>
    a.metadata.evidence_round === report.evidence_round &&
    a.metadata.office_id === report.office_id;
  const previous = after.filter((a) => !current(a));
  return (
    <section className="full" aria-label="Before and after evidence">
      <h3>Before and after evidence</h3>
      <p className="meta">
        Restricted photos for comparison. Review the photos to confirm the work.
      </p>
      <div className="evidence-comparison">
        {[
          ['Before — reported condition', before],
          ['After — completed work', after.filter(current)],
        ].map(([label, photos]) => (
          <section key={label}>
            <h4>{label}</h4>
            <div className="evidence">
              {photos.length ? (
                photos.map((a) => (
                  <EvidenceCard
                    key={a.id}
                    attachment={a}
                    reportId={report.id}
                    canCheck={current(a)}
                    onSaved={onSaved}
                  />
                ))
              ) : (
                <p className="meta">
                  {label.startsWith('Before')
                    ? 'No original photo was provided.'
                    : 'An after-work photo is required before completion.'}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
      {previous.length > 0 && (
        <details>
          <summary>Previous completion photos</summary>
          <div className="evidence">
            {previous.map((a) => (
              <EvidenceCard
                key={a.id}
                attachment={a}
                reportId={report.id}
                canCheck={current(a)}
                onSaved={onSaved}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function EvidenceCard({ attachment: a, reportId, onSaved, canCheck }) {
  const metadata = a.metadata || {},
    gps = metadata.gps,
    pin = metadata.report_pin;
  const { user, api, toast } = useVoice(),
    action = useAction();
  const [revealed, setRevealed] = useState(false);
  const screening = metadata.screening || {
    status: 'unverified',
    reason: 'This photo has not been automatically screened.',
  };
  const visible = screening.status === 'appropriate' || revealed;
  return (
    <figure className="evidence-card">
      {visible ? (
        <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener">
          <img
            src={`/api/attachments/${a.id}`}
            alt={metadata.title || `Evidence image for report ${reportId}`}
            loading="lazy"
          />
        </a>
      ) : (
        <div className="photo-concealed">
          <p>Photo hidden pending manual review.</p>
          <button type="button" className="btn" onClick={() => setRevealed(true)}>
            Show photo for review
          </button>
        </div>
      )}
      {revealed && screening.status !== 'appropriate' && (
        <button type="button" className="btn link" onClick={() => setRevealed(false)}>
          Hide photo
        </button>
      )}
      <figcaption>
        {a.completion_issue && (
          <p className="inline-error" role="status">
            <strong>Does not count as completion evidence.</strong> {a.completion_issue}
          </p>
        )}
        {metadata.stage === 'after' && (
          <>
            <CompletionCheck check={metadata.completion_check} />
            {canCheck && ['admin', 'office'].includes(user.role) && (
              <button
                type="button"
                className="btn"
                disabled={action.busy}
                onClick={() =>
                  action.run(async () => {
                    const result = await api(`/api/attachments/${a.id}/check`, {
                      method: 'POST',
                      body: {},
                    });
                    await onSaved();
                    toast(
                      result.status === 'supports_completion'
                        ? 'Evidence supports completion. Main Admin review is still required.'
                        : 'This photo does not establish completion of this concern.'
                    );
                  })
                }
              >
                {action.busy ? 'Comparing with concern…' : 'Check concern match again'}
              </button>
            )}
            <ErrorMessage>{action.error}</ErrorMessage>
          </>
        )}
        <p className={`photo-screening ${screening.status}`}>
          <strong>
            {
              {
                appropriate:
                  metadata.stage === 'after'
                    ? 'Content safety only: no issue flagged'
                    : 'No content concern flagged',
                needs_review: 'Needs manual review',
                rejected: 'Photo blocked',
                unverified: 'Unverified photo',
              }[screening.status]
            }
            .
          </strong>{' '}
          {screening.reason}
        </p>
        <strong>{a.filename || `Evidence image ${a.id}`}</strong>
        {metadata.analyzed_at && (
          <>
            <p>
              <strong>AI title:</strong> {metadata.title || 'No clear title'}
            </p>
            <p>
              <strong>AI categories:</strong>{' '}
              {metadata.categories?.join(' · ') || metadata.category || 'Unclear'}
            </p>
            <p>{metadata.reason}</p>
            {metadata.description && (
              <p className="report-description">
                <strong>AI description draft:</strong> {metadata.description}
              </p>
            )}
            <small>Gemini suggestion · {date(metadata.analyzed_at)} · Requires verification</small>
          </>
        )}
        <p>
          <strong>Photo geotag:</strong>{' '}
          {gps ? `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}` : 'No GPS metadata'}
        </p>
        {pin && (
          <p>
            <strong>Report pin:</strong> {pin.latitude.toFixed(6)}, {pin.longitude.toFixed(6)}{' '}
            <small>(selected by reporter)</small>
          </p>
        )}
      </figcaption>
    </figure>
  );
}

export function ReportDetails({ id }) {
  const { user, api, refresh } = useVoice();
  const [report, setReport] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(`/api/reports/${id}`)
      .then((r) => {
        if (active) setReport(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, api]);
  const onSaved = useCallback(async () => {
    const r = await api(`/api/reports/${id}`);
    setReport(r);
    await refresh();
  }, [id, api, refresh]);
  if (error)
    return (
      <>
        <h2 id="modal-title">Concern unavailable</h2>
        <ErrorMessage>{error}</ErrorMessage>
      </>
    );
  if (!report) return <h2 id="modal-title">Loading concern…</h2>;
  const r = report,
    admin = user.role !== 'student';
  const pending = ['submitted', 'needs_information'].includes(r.status);
  const canUpdate = user.role === 'admin';
  return (
    <>
      <div className="eyebrow">CONCERN · IV-{String(r.id).padStart(4, '0')}</div>
      <h2 id="modal-title">{r.title}</h2>
      <div className="badges">
        <Badge value={r.status} />
        <Badge value={r.priority} />
        <Badge>{r.visibility === 'campus' ? 'Campus summary' : 'Restricted'}</Badge>
      </div>
      {r.indoor_location && (
        <section className="panel" aria-label="Reported indoor location">
          <h3>Indoor location</h3>
          <FloorPlan location={r.indoor_location} />
        </section>
      )}
      <div className="columns">
        <section>
          <p className="report-description">{r.description}</p>
          <div className="details-card">
            <p>
              <strong>Categories:</strong> {reportCategories(r).join(' · ')}
              <small>Primary: {r.category}</small>
            </p>
            <p>
              <strong>Location:</strong> {r.location}
            </p>
            {r.location_details && (
              <p className="report-description">
                <strong>Location details:</strong> {r.location_details}
              </p>
            )}
            <p>
              <strong>Office:</strong> {r.office || 'Awaiting assignment'}
            </p>
            <p>
              <strong>Submitted:</strong> {date(r.created_at)}
            </p>
            {r.reporter && (
              <p>
                <strong>Assigned admin:</strong> {r.assigned_admin?.name || 'Not assigned'}
              </p>
            )}
            {r.reporter && (
              <p>
                <strong>Reporter:</strong> {r.reporter.name} · {r.reporter.affiliation}
              </p>
            )}
            {r.duplicate_of && <p>Linked to report #{r.duplicate_of}</p>}
          </div>
          {r.reporter && <EvidenceComparison report={r} onSaved={onSaved} />}
          <h3 className="full">Report activity</h3>
          <div className="timeline">
            {r.events.length ? (
              r.events.map((e) => (
                <div className="event" key={e.id}>
                  {e.message}
                  {e.internal ? (
                    <>
                      {' '}
                      <Badge>Internal</Badge>
                    </>
                  ) : null}
                  <small>
                    {e.actor} · {date(e.created_at)}
                  </small>
                </div>
              ))
            ) : (
              <p className="muted">No updates yet.</p>
            )}
          </div>
          {user.role !== 'validator' && (r.is_mine || admin) && (
            <>
              <CommentForm report={r} admin={admin} onSaved={onSaved} />
              <EvidenceForm key={`${r.id}-${r.status}`} report={r} onSaved={onSaved} />
            </>
          )}
        </section>
        {canUpdate ? (
          <ReviewForm key={`${r.id}-${r.status}-${r.updated_at}`} report={r} onSaved={onSaved} />
        ) : user.role === 'validator' && pending ? (
          <ValidationForm report={r} onSaved={onSaved} />
        ) : user.role === 'office' && ['validated', 'in_progress'].includes(r.status) ? (
          <OfficeProgressForm report={r} onSaved={onSaved} />
        ) : admin ? (
          <section className="panel">
            <h3>
              {user.role === 'validator'
                ? 'Validation submitted'
                : r.has_completion_evidence
                  ? 'Work completed'
                  : 'Completion photo required'}
            </h3>
            <p className="meta">
              {user.role === 'validator'
                ? 'The responsible office handles work progress. Main Admin oversees closure.'
                : r.has_completion_evidence
                  ? 'Main Admin handles final closure and reopening.'
                  : 'Upload an after-work photo below so Main Admin can verify completion.'}
            </p>
          </section>
        ) : null}
      </div>
    </>
  );
}
