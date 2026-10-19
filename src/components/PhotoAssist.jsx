import { useEffect, useRef, useState } from 'react';
import { readImage, useVoice } from '../lib.js';
import { ErrorMessage, Field } from './UI.jsx';

export function PhotoAssist({ onAnalysis, onBusyChange, onGeotag }) {
  const { api } = useVoice();
  const [file, setFile] = useState(null), [preview, setPreview] = useState('');
  const [result, setResult] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const request = useRef(0), encoded = useRef(''), input = useRef(null);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { onBusyChange(!!busy); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function inspect(file, analyze = false) {
    const id = ++request.current;
    setError(''); setBusy('Screening photo and suggesting a category…');
    try {
      const data = analyze ? encoded.current : await readImage(file);
      if (id !== request.current) return;
      encoded.current = data;
      const next = await api('/api/photos/inspect', { method: 'POST', body: { data, analyze } });
      if (id !== request.current) return;
      setResult(next); setError(next.ai_error);
      onAnalysis(next);
    } catch (e) { if (id === request.current) setError(e.message); }
    finally { if (id === request.current) setBusy(''); }
  }

  function selectPhoto(e) {
    const next = e.target.files[0];
    request.current++; encoded.current = ''; setResult(null); setError(''); setBusy(''); setFile(next || null);
    onAnalysis(null);
    if (next) inspect(next);
  }

  function removePhoto() {
    input.current.value = '';
    selectPhoto({ target: input.current });
  }

  return <section className="photo-assist" aria-label="Photo assistance">
    <p className="meta">Selected photos are automatically sent to Gemini for content screening, category suggestions, and a description draft. GPS and other metadata are removed first. AI cannot verify whether a report is true.</p>
    <Field label="Evidence photo (optional)" help="PNG or JPEG, up to 2 MB. Your evidence stays restricted to you and admins.">
      <input ref={input} name="image" type="file" accept="image/png,image/jpeg" onChange={selectPhoto}/>
    </Field>
    {preview && result?.screening?.status === 'appropriate' && <img className="photo-preview" src={preview} alt="Selected evidence preview"/>}
    {file && result?.screening?.status !== 'appropriate' && <div className="photo-concealed">Photo preview hidden until content screening clears it.</div>}
    {file && <button type="button" className="btn link" onClick={removePhoto}>Remove photo</button>}
    {busy && <p className="meta" role="status">{busy}</p>}
    {result && <>
      <p className={`photo-screening ${result.screening.status}`} role="status"><strong>{({ appropriate: 'No content concern flagged', needs_review: 'Needs manual review', rejected: 'Photo blocked', unverified: 'Screening unavailable' })[result.screening.status]}.</strong> {result.screening.reason}{result.screening.status === 'rejected' ? ' Remove or replace this photo to continue.' : result.screening.status !== 'appropriate' ? ' The photo will stay hidden until a reviewer chooses to open it.' : ' An admin still needs to validate the report.'}</p>
      <p className="meta">{result.gps ? `Photo GPS: ${result.gps.latitude.toFixed(6)}, ${result.gps.longitude.toFixed(6)}. Confirm this is where the concern occurred.` : 'No GPS geotag found in this photo. Select the location on the map.'}</p>
      {result.gps && onGeotag && <button type="button" className="btn" onClick={() => onGeotag(result.gps)}>Use photo geotag</button>}
      <button type="button" className="btn primary" disabled={!!busy || !result.ai_available} onClick={() => inspect(file, true)}>Check photo again</button>
      <p className="meta">{result.ai_available ? 'Check again to retry screening and category analysis.' : 'Gemini is not configured yet. You can still use photo GPS and choose the category manually.'}</p>
      {result.reason && <p className="notice" role="status"><strong>{result.title || 'Photo analysis'} · {result.categories?.join(' · ') || result.category || 'Category unclear'}.</strong> {result.reason} Review the title, categories, and editable description before submitting. The suggestion is saved with your photo for admin review.</p>}
    </>}
    <ErrorMessage>{error}</ErrorMessage>
  </section>;
}
