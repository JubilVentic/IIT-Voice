import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { readImage, useVoice } from '../lib.js';
import { ErrorMessage, Field } from './UI.jsx';

export function CompletionCheck({ check }) {
  const labels = {
    supports_completion: 'Supports completion of this concern',
    unrelated: 'Not related to this concern',
    still_unresolved: 'The reported problem is still visible',
    unclear: 'Completion is inconclusive',
    unavailable: 'Completion check unavailable',
  };
  return (
    <p className={`notice completion-check ${check?.status || 'unclear'}`} role="status">
      <strong>Concern match: {labels[check?.status] || 'Not checked against this concern'}.</strong>{' '}
      {check?.reason || 'Check this photo against the report and before evidence.'}{' '}
      {check?.status === 'supports_completion'
        ? 'Main Admin must still review before closure.'
        : 'This photo cannot count as completion evidence.'}
    </p>
  );
}

export function PhotoAssist({
  ref,
  onAnalysis,
  onBusyChange,
  onErrorChange,
  onGeotag,
  reportId,
  label = 'Evidence photo (optional)',
}) {
  const { api } = useVoice();
  const [file, setFile] = useState(null),
    [preview, setPreview] = useState('');
  const [result, setResult] = useState(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const request = useRef(0),
    encoded = useRef(''),
    input = useRef(null);
  useEffect(
    () => () => {
      request.current++;
    },
    []
  );
  useEffect(() => {
    onBusyChange(!!busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    onErrorChange?.(error);
  }, [error, onErrorChange]);
  useImperativeHandle(ref, () => ({ recheck }));
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function inspect(file, analyze = false) {
    const id = ++request.current;
    setError('');
    setBusy(
      reportId
        ? 'Checking photo safety and comparing it with this concern…'
        : 'Screening photo and suggesting a category…'
    );
    try {
      const data = analyze ? encoded.current : await readImage(file);
      if (id !== request.current) return;
      encoded.current = data;
      const next = await api('/api/photos/inspect', {
        method: 'POST',
        body: { data, analyze, ...(reportId ? { report_id: reportId } : {}) },
      });
      if (id !== request.current) return;
      setResult(next);
      setError(next.ai_error);
      onAnalysis(next);
    } catch (e) {
      if (id === request.current) setError(e.message);
    } finally {
      if (id === request.current) setBusy('');
    }
  }

  function recheck() {
    if (file && !busy && result?.ai_available) return inspect(file, true);
  }

  function selectPhoto(e) {
    const next = e.target.files[0];
    request.current++;
    encoded.current = '';
    setResult(null);
    setError('');
    setBusy('');
    setFile(next || null);
    onAnalysis(null);
    if (next) inspect(next);
  }

  function removePhoto() {
    input.current.value = '';
    selectPhoto({ target: input.current });
  }

  return (
    <section className="photo-assist" aria-label="Photo assistance">
      <p className="meta">
        {reportId
          ? 'Gemini screens this photo and compares it with the report title, description, categories and screened before photos. It must relate to this concern and visibly support completed work. GPS and device metadata are removed first. Main Admin reviews final closure.'
          : 'Selected photos are automatically sent to Gemini for content screening, category suggestions, and a description draft. GPS and other metadata are removed first. AI cannot verify whether a report is true.'}
      </p>
      <Field
        label={label}
        help="PNG or JPEG, up to 2 MB. Evidence stays restricted to you, administrators and the assigned office."
      >
        <input
          ref={input}
          name="image"
          type="file"
          accept="image/png,image/jpeg"
          onChange={selectPhoto}
        />
      </Field>
      {preview && result?.screening?.status === 'appropriate' && (
        <img className="photo-preview" src={preview} alt="Selected evidence preview" />
      )}
      {file && result?.screening?.status !== 'appropriate' && (
        <div className="photo-concealed">
          Photo preview hidden until content screening clears it.
        </div>
      )}
      {file && (
        <button type="button" className="btn link" onClick={removePhoto}>
          Remove photo
        </button>
      )}
      {busy && (
        <p className="meta" role="status">
          {busy}
        </p>
      )}
      {result && (
        <>
          <p className={`photo-screening ${result.screening.status}`} role="status">
            <strong>
              {
                {
                  appropriate: reportId
                    ? 'Content safety only: no issue flagged'
                    : 'No content concern flagged',
                  needs_review: 'Needs manual review',
                  rejected: 'Photo blocked',
                  unverified: 'Screening unavailable',
                }[result.screening.status]
              }
              .
            </strong>{' '}
            {result.screening.reason}
            {result.screening.status === 'rejected'
              ? ' Remove or replace this photo to continue.'
              : result.screening.status !== 'appropriate'
                ? ' The photo will stay hidden until a reviewer chooses to open it.'
                : reportId
                  ? ' Relevance and completion are checked separately below.'
                  : ' An admin still needs to validate the report.'}
          </p>
          {reportId && <CompletionCheck check={result.completion_check} />}
          <p className="meta">
            {result.gps
              ? `Photo GPS: ${result.gps.latitude.toFixed(6)}, ${result.gps.longitude.toFixed(6)}. Confirm this is where the concern occurred.`
              : 'No GPS geotag found in this photo. Select the location on the map.'}
          </p>
          {result.gps && onGeotag && (
            <button type="button" className="btn" onClick={() => onGeotag(result.gps)}>
              Use photo geotag
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={!!busy || !result.ai_available}
            onClick={recheck}
          >
            Check photo again
          </button>
          <p className="meta">
            {result.ai_available
              ? reportId
                ? 'Check again to retry safety and concern-specific comparison.'
                : 'Check again to retry screening and category analysis.'
              : 'Gemini is not configured yet. You can still use photo GPS and choose the category manually.'}
          </p>
          {result.reason && (
            <p className="notice" role="status">
              <strong>
                {result.title || 'Photo analysis'}
                {' · '}
                {result.categories?.join(' · ') || result.category || 'Category unclear'}.
              </strong>{' '}
              {result.reason}{' '}
              {reportId
                ? 'This describes the photo; the concern-match check determines whether it can be used as completion evidence.'
                : 'Review the title, categories, and editable description before submitting. The suggestion is saved with your photo for admin review.'}
            </p>
          )}
        </>
      )}
      <ErrorMessage>{error}</ErrorMessage>
    </section>
  );
}
