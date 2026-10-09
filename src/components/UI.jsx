import { useEffect, useRef } from 'react';
import { date, priorities, statusLabels, useVoice } from '../lib.js';

const shapes = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  report: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h4"/></>,
  map: <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>,
  users: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m4 11v-3a6 6 0 0 0-4-5"/></>,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
  history: <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>,
  star: <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></>,
  logout: <path d="M9 3H4v18h5m5-14 5 5-5 5m-5-5h10"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
};

export const Icon = ({ name }) => <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">{shapes[name] || shapes.report}</svg>;
export const Brand = () => <div className="brand">iit<span>voice</span><small>CAMPUS CONCERNS</small></div>;
export const Badge = ({ value = '', children }) => <span className={`badge ${priorities[value] ? 'priority' : ''} ${value}`}>{children || priorities[value]?.label || statusLabels[value] || value}</span>;
export const Field = ({ label, help, children }) => <label className="field">{label}{children}{help && <small>{help}</small>}</label>;
export const ErrorMessage = ({ children, id }) => <p id={id} className="inline-error" role="alert">{children}</p>;
export const Panel = ({ title, detail, children, className = '' }) => <section className={`panel ${className}`}>{title && <div className="panel-head"><h2>{title}</h2>{detail && <small>{detail}</small>}</div>}{children}</section>;
export function Hero({ title, question, sub, action }) {
  const { user } = useVoice();
  return <div className="hero"><div><div className="eyebrow">{user.role === 'student' ? 'CAMPUS COMMUNITY' : (user.role === 'admin' ? 'MAIN ADMIN' : 'VALIDATOR ADMIN') + ' DASHBOARD'}</div><h1>{title}</h1><div className="question">{question}</div><p>{sub}</p></div>{action || <div className="orb" aria-hidden="true"><Icon name="star"/></div>}</div>;
}
export const Stats = ({ values }) => <div className="stats">{values.map(([label, value, sub]) => <div className="stat" key={label}><span className="label">{label}</span><strong>{value}</strong><small>{sub}</small></div>)}</div>;
export function ReportList({ reports }) {
  const { openReport } = useVoice();
  return reports.length ? reports.map(r => <div className="list-row" key={r.id}><div className="rowtop"><h3>{r.title}</h3><div className="badges"><Badge value={r.status}/><Badge value={r.priority}/></div></div><div className="meta">IV-{String(r.id).padStart(4, '0')} · {r.location}<br/>{r.category} · {date(r.updated_at)}</div><button type="button" className="btn link" data-report={r.id} onClick={() => openReport(r.id)}>View concern →</button></div>) : <div className="empty">No concerns here yet.</div>;
}
export function Dialog({ children, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} id="modal" aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); onClose(); }}><button type="button" className="dialog-close" aria-label="Close dialog" onClick={onClose}>×</button><div id="modal-content">{children}</div></dialog>;
}
