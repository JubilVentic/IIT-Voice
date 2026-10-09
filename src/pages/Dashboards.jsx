import { useEffect, useState } from 'react';
import { campusReports, date, labels, priorities, priorityOrder, statusLabels, useAction, useVoice } from '../lib.js';
import { ErrorMessage, Hero, Icon, Panel, ReportList, Stats } from '../components/UI.jsx';
import { CampusMap } from '../components/Maps.jsx';

const isOpen = r => !['closed', 'resolved', 'rejected', 'duplicate'].includes(r.status);
const isPending = r => ['submitted', 'needs_information'].includes(r.status);

export function Overview() {
  const { user, data, newReport, setPage } = useVoice();
  const reports = data.reports, mine = reports.filter(r => r.is_mine), open = reports.filter(isOpen), pending = reports.filter(isPending), shared = campusReports(reports);
  const name = user.name.split(' ')[0];
  if (user.role === 'student') return <><Hero title={`Hello, ${name}.`} question="How can we improve your campus?" sub="Report a concern and follow the progress." action={<button className="btn primary" data-new onClick={newReport}><Icon name="plus"/> Report a concern</button>}/><Stats values={[[ 'My active reports', mine.filter(isOpen).length, 'Your submissions' ], ['Campus concerns', shared.length, 'Approved shared summaries'], ['Resolved concerns', shared.filter(r => ['resolved', 'closed'].includes(r.status)).length, 'Visible to campus members']]}/><div className="columns"><Panel title={<><Icon name="map"/> Campus map</>} detail="MSU–IIT"><CampusMap reports={shared}/></Panel><Panel title="My latest reports" detail={`${mine.length} submitted`}><ReportList reports={mine.slice(0, 4)}/></Panel></div><div className="notice">Immediate danger? Contact campus security or emergency services directly. Routine report review may take time.</div></>;
  const validator = user.role === 'validator';
  const high = open.filter(r => ['urgent', 'high'].includes(r.priority));
  const max = Math.max(1, ...data.categories.map(cat => open.filter(r => r.category === cat).length));
  return <><Hero title={`Good day, ${name}.`} question={validator ? 'Which concern can we verify next?' : 'What needs your attention today?'} sub={validator ? 'Review evidence, protect identities, and route valid concerns.' : 'Track campus concerns, manage access, and coordinate resolution.'}/><Stats values={validator ? [['Awaiting review', pending.filter(r => r.status === 'submitted').length, 'New concerns'], ['Needs information', pending.filter(r => r.status === 'needs_information').length, 'Waiting for reporter updates'], ['High-priority queue', pending.filter(r => ['urgent', 'high'].includes(r.priority)).length, 'Review urgent concerns first']] : [['Open concerns', open.length, 'Across all categories'], ['Awaiting validation', pending.length, 'Under review or needs information'], ['Resolved concerns', reports.filter(r => ['resolved', 'closed'].includes(r.status)).length, 'Resolved and closed reports']]}/>{validator ? <div className="columns"><Panel title="Review queue" detail={`${pending.length} concerns`}><ReportList reports={[...pending].sort(priorityOrder).slice(0, 5)}/></Panel><Panel title="A careful review, every time."><div className="list-row"><h3>1. Verify the concern</h3><p className="meta">Check location, supporting evidence, and nearby existing reports.</p></div><div className="list-row"><h3>2. Choose appropriate visibility</h3><p className="meta">Campus summaries should exclude personal or sensitive information. Evidence stays restricted.</p></div><div className="list-row"><h3>3. Route and explain the decision</h3><p className="meta">Assign a responsible office. Request information or record a reason when rejecting.</p></div><div className="notice">Validation does not mean resolution. Main Admin manages progress and closure after validation.</div></Panel></div> : <><div className="columns"><Panel title="Open concerns by category">{data.categories.map(cat => { const count = open.filter(r => r.category === cat).length; return <div className="barrow" key={cat}><div className="barlabel"><span>{cat}</span><span>{count}</span></div><div className="track"><div className="fill" style={{ width: `${count / max * 100}%` }}/></div></div>; })}<h2 className="full">Responsible offices</h2>{data.offices.map(o => <div className="list-row" key={o.id}><div className="rowtop"><h3>{o.name}</h3><small>{open.filter(r => r.office_id === o.id).length} open</small></div></div>)}</Panel><Panel title="Priority concerns" detail={`${high.length} active`}><ReportList reports={high.sort(priorityOrder).slice(0, 4)}/></Panel></div><Panel title="Administration" detail="Main Admin only" className="full"><div className="actions"><button className="btn primary" onClick={() => setPage('users')}>Manage users & validators</button><button className="btn" onClick={() => setPage('routing')}>Routing rules</button><button className="btn" onClick={() => setPage('audit')}>Audit history</button></div></Panel></>}</>;
}

export function ReportsPage() {
  const { data, page, user, newReport } = useVoice();
  const [q, setQ] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState(''), [priority, setPriority] = useState('');
  const reports = data.reports.filter(r => (page !== 'mine' || r.is_mine) && (page !== 'queue' || isPending(r)) && (!category || r.category === category) && (!status || r.status === status) && (!priority || r.priority === priority) && (!q || `${r.title} ${r.location} ${r.id}`.toLowerCase().includes(q.toLowerCase())));
  if (page === 'queue') reports.sort(priorityOrder);
  return <><Hero title={page === 'mine' ? 'My reports' : page === 'queue' ? 'Review queue' : 'Campus reports'} question="Every concern has a next step." sub={page === 'mine' ? 'Track your submissions, add evidence, and respond to requests for information.' : 'Search concerns and open a report to review its details.'} action={user.role === 'student' ? <button className="btn primary" data-new onClick={newReport}>+ Report a concern</button> : undefined}/><Panel><div className="filters"><label className="sr-only" htmlFor="search">Search reports</label><input id="search" placeholder="Search title, location, or report number" value={q} onChange={e => setQ(e.target.value)}/><label className="sr-only" htmlFor="filter-category">Category</label><select id="filter-category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{data.categories.map(c => <option key={c}>{c}</option>)}</select><label className="sr-only" htmlFor="filter-status">Status</label><select id="filter-status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(statusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><label className="sr-only" htmlFor="filter-priority">Priority</label><select id="filter-priority" value={priority} onChange={e => setPriority(e.target.value)}><option value="">All priorities</option>{Object.entries(priorities).map(([v, p]) => <option key={v} value={v}>{p.label}</option>)}</select></div><div id="report-results"><p className="page-count">{reports.length} concerns{page === 'queue' ? ' · Urgent first, oldest first within each priority' : ''}</p><ReportList reports={reports}/></div></Panel></>;
}

export function MapPage() {
  const { user, data } = useVoice();
  const reports = user.role === 'student' ? campusReports(data.reports) : data.reports;
  return <><Hero title="Campus map" question="See where a concern begins." sub={user.role === 'student' ? 'Explore the campus or view approved IIT Voice report pins.' : 'Explore the campus or view submitted and validated report pins.'}/><Panel><CampusMap reports={reports} large/></Panel><Panel title="Reports without a map pin" className="full"><ReportList reports={reports.filter(r => r.latitude === null)}/></Panel></>;
}

export function NotificationsPage() {
  const { data, api, refresh, openReport } = useVoice();
  const action = useAction();
  return <><Hero title="Your notifications" question="Stay in the loop." sub="Updates on reports and review activity."/><Panel title="Recent activity" detail={<button className="btn" disabled={action.busy} onClick={() => action.run(async () => { await api('/api/notifications/read', { method: 'POST', body: {} }); await refresh(); })}>Mark all read</button>}><ErrorMessage>{action.error}</ErrorMessage>{data.notifications.length ? data.notifications.map(n => <div className={`list-row ${n.is_read ? '' : 'notification-unread'}`} key={n.id}><h3>{n.message}</h3><div className="meta">{date(n.created_at)}</div>{n.report_id && <button className="btn link" data-report={n.report_id} onClick={() => openReport(n.report_id)}>Open report →</button>}</div>) : <div className="empty">You’re all caught up.</div>}</Panel></>;
}

function useRemote(path) {
  const { api, data } = useVoice();
  const [result, setResult] = useState(null), [error, setError] = useState('');
  useEffect(() => { let active = true; setError(''); api(path).then(r => { if (active) setResult(r); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [path, api, data]);
  return { result, error };
}

function UserRow({ account }) {
  const { user, api, refresh, toast } = useVoice();
  const [role, setRole] = useState(account.role), [verified, setVerified] = useState(!!account.verified), [active, setActive] = useState(!!account.active);
  const action = useAction(), self = user.id === account.id;
  async function save() {
    if (!window.confirm(`Save access for ${account.name}? Role: ${labels[role]}. Verified: ${verified ? 'Yes' : 'No'}. Active: ${active ? 'Yes' : 'No'}. Confirm affiliation and authorization before proceeding.`)) return;
    action.run(async () => { await api(`/api/admin/users/${account.id}`, { method: 'PATCH', body: { role, verified, active } }); await refresh(); toast('Access updated.'); });
  }
  return <tr data-user={account.id}><td><strong>{account.name}</strong><br/><small>{account.email}</small><ErrorMessage>{action.error}</ErrorMessage></td><td>{account.affiliation}</td><td><select name="role" aria-label={`Role for ${account.name}`} value={role} disabled={self || action.busy} onChange={e => setRole(e.target.value)}>{Object.entries(labels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td><td><input type="checkbox" name="verified" aria-label={`Verified affiliation for ${account.name}`} checked={verified} disabled={self || action.busy} onChange={e => setVerified(e.target.checked)}/></td><td><input type="checkbox" name="active" aria-label={`Active account for ${account.name}`} checked={active} disabled={self || action.busy} onChange={e => setActive(e.target.checked)}/></td><td>{self ? <small>Your account</small> : <button className="btn primary" disabled={action.busy} data-save-user onClick={save}>Save access</button>}</td></tr>;
}

export function UsersPage() {
  const { result: users, error } = useRemote('/api/admin/users');
  return <><Hero title="Users & access" question="The right access, for the right people." sub="Verify affiliation through the university-approved process before activating campus access."/><div className="notice">Faculty and staff use the campus app unless explicitly granted an admin role. Validator Admins cannot manage users. Changing access signs that user out.</div><Panel title="Campus accounts" detail={users ? `${users.filter(u => !u.verified).length} pending verification` : 'Loading…'}><ErrorMessage>{error}</ErrorMessage>{users && <div className="table-wrap"><table><thead><tr><th>Account</th><th>Affiliation</th><th>Role</th><th>Verified</th><th>Active</th><th>Action</th></tr></thead><tbody>{users.map(u => <UserRow key={`${u.id}-${u.role}-${u.verified}-${u.active}`} account={u}/>)}</tbody></table></div>}</Panel></>;
}

function RoutingForm({ rule }) {
  const { data, api, refresh, toast } = useVoice();
  const [office, setOffice] = useState(rule.office_id), action = useAction();
  return <form className="routing-form list-row" data-category={rule.category} onSubmit={e => { e.preventDefault(); action.run(async () => { await api('/api/admin/routing', { method: 'PATCH', body: { category: rule.category, office_id: office } }); await refresh(); toast('Routing saved.'); }); }}><label className="field">{rule.category}<select name="office_id" value={office} onChange={e => setOffice(Number(e.target.value))}>{data.offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><ErrorMessage>{action.error}</ErrorMessage><button type="submit" className="btn primary" disabled={action.busy}>Save routing</button></form>;
}

export function RoutingPage() {
  const { data } = useVoice();
  return <><Hero title="Categories & routing" question="Send each concern to the right office." sub="Defaults guide validation; the reviewing admin can choose another office for a specific report."/><Panel title="Default responsible offices">{data.routing.map(r => <RoutingForm key={`${r.category}-${r.office_id}`} rule={r}/>)}</Panel><div className="notice">Office routing is a proposed configuration. Confirm participating offices and escalation procedures with the university.</div></>;
}

export function AuditPage() {
  const { result: items, error } = useRemote('/api/admin/audit');
  return <><Hero title="Audit history" question="Every decision leaves a record." sub="Recent account, routing, and report activity. Audit records cannot be edited through the application."/><Panel><ErrorMessage>{error}</ErrorMessage>{items ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>{items.map(a => <tr key={a.id}><td>{date(a.created_at)}</td><td>{a.actor || 'System'}</td><td>{a.action}</td><td>{a.entity}</td><td>{a.detail}</td></tr>)}</tbody></table></div> : <p className="muted">Loading activity…</p>}</Panel></>;
}
