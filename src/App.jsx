import { useCallback, useEffect, useRef, useState } from 'react';
import campusPhoto from './assets/msu-iit-campus.png';
import { VoiceContext, labels, useAction, useVoice, formValues } from './lib.js';
import { Brand, Dialog, ErrorMessage, Field, Icon } from './components/UI.jsx';
import {
  Overview,
  ReportsPage,
  MapPage,
  NotificationsPage,
  UsersPage,
  RoutingPage,
  AuditPage,
} from './pages/Dashboards.jsx';
import { NewReport, ReportDetails } from './pages/ReportForms.jsx';

function Auth({ signIn, api, toast }) {
  const [register, setRegister] = useState(false),
    [demoAccounts, setDemoAccounts] = useState([]);
  useEffect(() => {
    let alive = true;
    api('/api/demo/accounts')
      .then((result) => {
        if (alive) setDemoAccounts(result.accounts);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);
  const action = useAction();
  const submit = (e) => {
    e.preventDefault();
    const values = formValues(e.currentTarget);
    action.run(async () => {
      if (register) {
        const result = await api('/api/register', { method: 'POST', body: values });
        setRegister(false);
        toast(result.message);
      } else await signIn(values);
    });
  };
  return (
    <div className="auth-page">
      <img
        className="auth-campus-photo"
        src={campusPhoto}
        alt="MSU–IIT campus building framed by trees"
        fetchPriority="high"
      />
      <div className="auth-wrap">
        <section className="auth-story">
          <Brand />
          <div className="auth-story-copy">
            <h1>
              A better campus starts <span>with a voice.</span>
            </h1>
            <p>
              Report a concern, pin its location, and follow the progress. Together, let’s make
              MSU–IIT a safer, better place.
            </p>
            <span className="access-pill">
              <Icon name="lock" /> Verified campus access
            </span>
          </div>
        </section>
        <section className="auth-card">
          <div className="auth-tabs">
            <button
              type="button"
              data-auth="login"
              className={!register ? 'active' : ''}
              onClick={() => setRegister(false)}
            >
              Sign in
            </button>
            <button
              type="button"
              data-auth="register"
              className={register ? 'active' : ''}
              onClick={() => setRegister(true)}
            >
              Request an account
            </button>
          </div>
          <h2>{register ? 'Join IIT Voice' : 'Welcome back.'}</h2>
          <p className="muted">
            {register
              ? 'Your affiliation will be reviewed by a Main Admin.'
              : 'Sign in to your campus workspace.'}
          </p>
          <form id="auth-form" key={String(register)} onSubmit={submit}>
            {register && (
              <>
                <Field label="Full name">
                  <input name="name" required minLength={2} maxLength={100} autoComplete="name" />
                </Field>
                <Field label="Campus affiliation">
                  <select name="affiliation">
                    <option>Student</option>
                    <option>Faculty</option>
                    <option>Staff</option>
                  </select>
                </Field>
              </>
            )}
            <Field label="Email address">
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                maxLength={254}
                placeholder="you@university.edu"
              />
            </Field>
            <Field label="Password" help="At least 12 characters.">
              <input
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete={register ? 'new-password' : 'current-password'}
              />
            </Field>
            <ErrorMessage id="auth-error">{action.error}</ErrorMessage>
            <button className="btn solid" type="submit" disabled={action.busy}>
              {action.busy ? 'Please wait…' : `${register ? 'Request campus access' : 'Sign in'} →`}
            </button>
          </form>
          <div className="notice">
            {register
              ? 'Registration never grants admin permissions.'
              : 'Students and campus members enter the campus app. Staff accounts enter their assigned workspace.'}
          </div>
          {!register && demoAccounts.length > 0 && (
            <section className="demo-accounts" aria-label="Demo accounts">
              <h3>Try a demo account</h3>
              <p className="meta">One-click access for local testing.</p>
              <div className="demo-grid">
                {demoAccounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    className="btn demo-account"
                    data-demo-account={account.id}
                    disabled={action.busy}
                    onClick={() => action.run(() => signIn({ account_id: account.id }, true))}
                  >
                    <strong>
                      {account.role === 'student'
                        ? account.affiliation
                        : account.role === 'office'
                          ? account.office_name
                          : labels[account.role] || account.role}
                    </strong>
                    <span>{account.name} →</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </section>
      </div>
    </div>
  );
}

function navigation(user) {
  const notifications = ['notifications', 'Notifications', 'bell'];
  if (user.role === 'student')
    return [
      ['overview', 'Campus feed', 'grid'],
      ['map', 'Campus map', 'map'],
      ['mine', 'My reports', 'report'],
      notifications,
    ];
  if (user.role === 'office')
    return [
      ['overview', 'Office overview', 'grid'],
      ['reports', 'Assigned concerns', 'report'],
      ['map', 'Office concern map', 'map'],
      notifications,
    ];
  if (user.role === 'validator')
    return [
      ['overview', 'Review overview', 'grid'],
      ['queue', 'Review queue', 'report'],
      ['map', 'Campus map', 'map'],
      ['reports', 'Reports', 'history'],
      notifications,
    ];
  return [
    ['overview', 'Overview', 'grid'],
    ['reports', 'All reports', 'report'],
    ['map', 'Campus map', 'map'],
    ['users', 'Users & access', 'users'],
    ['routing', 'Categories & routing', 'settings'],
    ['audit', 'Audit log', 'history'],
    notifications,
  ];
}

function Shell({ children, logout }) {
  const { user, data, page, setPage } = useVoice();
  const nav = navigation(user),
    mobileMenu = useRef(null);
  const unread = data.notifications.filter((n) => !n.is_read).length;
  const notificationBadge = unread > 0 && (
    <span className="notification-count" aria-hidden="true">
      {unread > 99 ? '99+' : unread}
    </span>
  );
  function navigate(id) {
    setPage(id);
    mobileMenu.current.open = false;
    mobileMenu.current.querySelector('summary').focus({ preventScroll: true });
  }
  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('');
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <div className="campus">
          MSU–IIT<small>Iligan City, Philippines</small>
        </div>
        <nav className="nav" aria-label="Main navigation">
          {nav
            .filter(([id]) => id !== 'notifications')
            .map(([id, label, icon]) => (
              <button
                type="button"
                key={id}
                data-page={id}
                className={id === page ? 'active' : ''}
                aria-current={id === page ? 'page' : undefined}
                onClick={() => setPage(id)}
              >
                <Icon name={icon} />
                {label}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          A better campus starts
          <br />
          with a voice.
          <br />
          <button className="btn link" data-logout onClick={logout}>
            <Icon name="logout" /> Sign out
          </button>
        </div>
      </aside>
      <div className="workspace">
        <div className="workspace-header">
          <header className="topbar">
            <div className="mobile-brand">
              <Brand />
            </div>
            <span className="workspace-context">
              {user.role === 'student'
                ? 'Campus community'
                : user.role === 'office'
                  ? 'Office workspace'
                  : 'Administration'}
              {' / '}
              {labels[user.role]}
            </span>
            <div className="account">
              <span className="avatar">{initials}</span>
              <div>
                {user.name}
                <small>{labels[user.role]}</small>
              </div>
            </div>
            <button
              type="button"
              className={`btn notification-trigger ${page === 'notifications' ? 'active' : ''}`}
              data-page="notifications"
              aria-current={page === 'notifications' ? 'page' : undefined}
              aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications, no unread'}
              title={unread ? `${unread} unread notifications` : 'Notifications'}
              onClick={() => navigate('notifications')}
            >
              <Icon name="bell" />
              {notificationBadge}
            </button>
            <button className="btn link" data-logout aria-label="Sign out" onClick={logout}>
              <Icon name="logout" />
            </button>
          </header>
          <details
            className="mobile-menu"
            ref={mobileMenu}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                navigate(page);
              }
            }}
          >
            <summary>
              <Icon name="menu" />
              <span>{nav.find(([id]) => id === page)?.[1]}</span>
              <Icon name="chevron" />
            </summary>
            <nav className="mobile-nav" aria-label="Mobile navigation">
              {nav.map(([id, label, icon]) => (
                <button
                  type="button"
                  className={`btn ${id === page ? 'active' : ''}`}
                  key={id}
                  data-page={id}
                  aria-current={id === page ? 'page' : undefined}
                  onClick={() => navigate(id)}
                >
                  <Icon name={icon} />
                  {label}
                  {id === 'notifications' && notificationBadge}
                </button>
              ))}
            </nav>
          </details>
        </div>
        <main id="main">{children}</main>
        <footer className="footer">
          <span>MSU–IIT · IIT Voice</span>
          <span>Campus reporting pilot · Philippine time</span>
        </footer>
      </div>
    </div>
  );
}

function CurrentPage() {
  const { page, user } = useVoice();
  if (page === 'map') return <MapPage />;
  if (['reports', 'queue', 'mine'].includes(page)) return <ReportsPage key={page} />;
  if (page === 'notifications') return <NotificationsPage />;
  if (user.role === 'admin') {
    if (page === 'users') return <UsersPage />;
    if (page === 'routing') return <RoutingPage />;
    if (page === 'audit') return <AuditPage />;
  }
  return <Overview />;
}

export default function App() {
  const [user, setUser] = useState(null),
    [data, setData] = useState(null),
    [page, setPage] = useState('overview');
  const [loading, setLoading] = useState(true),
    [bootError, setBootError] = useState(''),
    [message, setMessage] = useState(''),
    [modal, setModal] = useState(null);
  const csrf = useRef(''),
    toastTimer = useRef(null);
  const toast = useCallback((text) => {
    setMessage(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(''), 5000);
  }, []);
  const api = useCallback(async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf.current ? { 'X-CSRF-Token': csrf.current } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        csrf.current = '';
        setUser(null);
        setData(null);
        setModal(null);
      }
      throw new Error(result.error || 'Unable to complete request.');
    }
    return result;
  }, []);
  const refresh = useCallback(async () => {
    const result = await api('/api/bootstrap');
    setData(result);
    return result;
  }, [api]);
  useEffect(() => {
    let alive = true;
    async function boot() {
      try {
        const session = await api('/api/me');
        if (!alive) return;
        csrf.current = session.csrf;
        setUser(session.user);
        const result = await api('/api/bootstrap');
        if (alive) setData(result);
      } catch (e) {
        if (alive && e.message !== 'Sign in to continue.') setBootError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    boot();
    return () => {
      alive = false;
    };
  }, [api]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  async function signIn(values, demo = false) {
    const session = await api(demo ? '/api/demo/login' : '/api/login', {
      method: 'POST',
      body: values,
    });
    csrf.current = session.csrf;
    setUser(session.user);
    setPage('overview');
    setBootError('');
    await refresh();
  }
  async function logout() {
    try {
      await api('/api/logout', { method: 'POST', body: {} });
      csrf.current = '';
      setModal(null);
      setUser(null);
      setData(null);
    } catch (e) {
      toast(e.message);
    }
  }
  const value = {
    user,
    data,
    page,
    setPage,
    api,
    refresh,
    toast,
    openReport: (id) => setModal({ type: 'report', id }),
    newReport: () => setModal({ type: 'new' }),
    closeModal: () => setModal(null),
  };
  return (
    <VoiceContext.Provider value={value}>
      {loading ? (
        <div className="loading">Loading IIT Voice…</div>
      ) : !user ? (
        <Auth signIn={signIn} api={api} toast={toast} />
      ) : !data ? (
        <div className="loading">
          <p role="alert">{bootError || 'Unable to load your campus workspace.'}</p>
          <button
            className="btn primary"
            onClick={() => refresh().catch((e) => setBootError(e.message))}
          >
            Try again
          </button>
          <button className="btn" onClick={logout}>
            Sign out
          </button>
        </div>
      ) : (
        <Shell logout={logout}>
          <CurrentPage key={page} />
        </Shell>
      )}
      {modal && user && data && (
        <Dialog onClose={() => setModal(null)}>
          {modal.type === 'new' ? <NewReport /> : <ReportDetails key={modal.id} id={modal.id} />}
        </Dialog>
      )}
      <div id="toast" role="status" aria-live="polite" hidden={!message}>
        {message}
      </div>
    </VoiceContext.Provider>
  );
}
