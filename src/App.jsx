import { useCallback, useEffect, useRef, useState } from 'react';
import campusPhoto from './assets/msu-iit-campus.png';
import systemQr from './assets/iit-voice-qr.svg';
import systemQrPng from './assets/iit-voice-qr.png';
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

function Auth({ signIn, api }) {
  const [mode, setMode] = useState('access'),
    [demoAccounts, setDemoAccounts] = useState([]),
    [demoMode, setDemoMode] = useState('local'),
    [googleEnabled, setGoogleEnabled] = useState(false),
    [googleProfile, setGoogleProfile] = useState(null),
    [googleError, setGoogleError] = useState(''),
    [googleReturn] = useState(() => window.location.search);
  const googleProfileStep = mode === 'google';
  const anonymous = mode === 'anonymous';
  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams(googleReturn);
    const completeGoogle = query.get('google') === 'complete';
    if (query.has('google_error')) setGoogleError(query.get('google_error'));
    if (query.has('google') || query.has('google_error')) {
      query.delete('google');
      query.delete('google_error');
      window.history.replaceState(
        null,
        '',
        window.location.pathname + (query.size ? `?${query}` : '') + window.location.hash
      );
    }
    api('/api/auth/options')
      .then((result) => {
        if (alive) setGoogleEnabled(result.google);
      })
      .catch(() => {});
    if (completeGoogle)
      api('/api/auth/google/profile')
        .then((profile) => {
          if (alive) {
            setGoogleProfile(profile);
            setMode('google');
          }
        })
        .catch((error) => {
          if (alive) setGoogleError(error.message);
        });
    api('/api/demo/accounts')
      .then((result) => {
        if (alive) {
          setDemoAccounts(result.accounts);
          setDemoMode(result.mode || 'local');
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, googleReturn]);
  const action = useAction();
  const submit = (e) => {
    e.preventDefault();
    const values = formValues(e.currentTarget);
    action.run(() => signIn(values, googleProfileStep ? 'google' : 'anonymous'));
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
          <h2>
            {anonymous
              ? 'Report anonymously'
              : googleProfileStep
                ? 'Complete your profile'
                : 'Welcome to IIT Voice.'}
          </h2>
          <p className="muted">
            {anonymous
              ? 'No account or university email needed. Choose how you are connected to the campus.'
              : googleProfileStep
                ? 'Google confirmed your university email. Choose your campus affiliation to start reporting immediately.'
                : 'Continue with your university Google account or report anonymously.'}
          </p>
          <ErrorMessage id="auth-error">{action.error}</ErrorMessage>
          <ErrorMessage>{googleError}</ErrorMessage>
          {(anonymous || googleProfileStep) && (
            <form id="auth-form" key={mode} onSubmit={submit}>
              {googleProfileStep && (
                <p className="notice">Google account: {googleProfile?.email}</p>
              )}
              {anonymous && (
                <Field
                  label="Reporter role"
                  help="Self-declared affiliation; this does not grant staff or admin permissions."
                >
                  <select name="affiliation" required defaultValue="">
                    <option value="" disabled>
                      Choose your role
                    </option>
                    {['Student', 'Faculty', 'Staff', 'Visitor'].map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                  </select>
                </Field>
              )}
              {googleProfileStep && (
                <>
                  <Field label="Full name">
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={100}
                      autoComplete="name"
                      defaultValue={googleProfile?.name || ''}
                    />
                  </Field>
                  <Field label="Campus affiliation">
                    <select name="affiliation" required defaultValue="">
                      <option value="" disabled>
                        Choose your affiliation
                      </option>
                      <option>Student</option>
                      <option>Faculty</option>
                      <option>Staff</option>
                    </select>
                  </Field>
                </>
              )}
              <button className="btn solid" type="submit" disabled={action.busy}>
                {action.busy
                  ? 'Please wait…'
                  : `${anonymous ? 'Start anonymous report' : 'Continue to IIT Voice'} →`}
              </button>
            </form>
          )}
          {!anonymous && !googleProfileStep && (
            <section className="google-access" aria-label="Google sign-in">
              <button
                type="button"
                className="btn google-sign-in"
                disabled={action.busy || !googleEnabled}
                aria-describedby="google-access-help"
                onClick={() =>
                  action.run(async () => {
                    setGoogleError('');
                    const result = await api('/api/auth/google/start', {
                      method: 'POST',
                      body: {},
                    });
                    window.location.assign(result.url);
                  })
                }
              >
                <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.25 5.48-4.76 7.18l7.73 6c4.51-4.18 7.07-10.36 7.07-17.65Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59A14.41 14.41 0 0 1 9.77 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
                  />
                </svg>
                Continue with Google
              </button>
              <p id="google-access-help" className="meta">
                {googleEnabled
                  ? 'Use your @g.msuiit.edu.ph university Google account. New reporters can start immediately without Main Admin approval.'
                  : 'Google sign-in needs one-time setup. You can continue anonymously while it is unavailable.'}
              </p>
            </section>
          )}
          <div className="notice">
            {anonymous
              ? 'Your role is visible to reviewers, but no name or email is collected. Follow your reports in this browser for up to 12 hours. Signing out, clearing cookies, or changing devices loses access.'
              : googleProfileStep
                ? 'Your affiliation describes your reporter profile and does not grant admin permissions.'
                : 'Students and campus members enter the campus app. Staff accounts enter their assigned workspace.'}
          </div>
          {!googleProfileStep && (
            <div className="anonymous-access">
              <button
                type="button"
                className="btn"
                disabled={action.busy}
                onClick={() => setMode(anonymous ? 'access' : 'anonymous')}
              >
                {anonymous ? 'Back to access options' : 'Continue anonymously'}
              </button>
              {!anonymous && (
                <p className="meta">
                  For students, faculty, staff, and visitors. You can also sign in and choose
                  anonymous reporting when submitting.
                </p>
              )}
            </div>
          )}
          {mode === 'access' && demoAccounts.length > 0 && (
            <section className="demo-accounts" aria-label="Demo accounts">
              <h3>Try a demo account</h3>
              <p className="meta">
                {demoMode === 'online'
                  ? 'Shared demo workspace. Use test information only; regular accounts and reports are separate.'
                  : 'One-click access with isolated local test data.'}
              </p>
              <div className="demo-grid">
                {demoAccounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    className="btn demo-account"
                    data-demo-account={account.id}
                    disabled={action.busy}
                    onClick={() => action.run(() => signIn({ account_id: account.id }, 'demo'))}
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
          {mode === 'access' && (
            <section className="auth-qr" aria-label="Open IIT Voice on your phone">
              <a href="https://iit-voice.vercel.app/" target="_blank" rel="noreferrer">
                <img
                  src={systemQr}
                  width="112"
                  height="112"
                  alt="QR code linking to https://iit-voice.vercel.app/"
                />
              </a>
              <div>
                <h3>Open on your phone</h3>
                <p className="meta">Scan to visit the live IIT Voice site.</p>
                <a href={systemQrPng} download="iit-voice-qr.png">
                  Download QR code
                </a>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('iit-voice-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('iit-voice-sidebar-collapsed', String(sidebarCollapsed));
    } catch {
      /* Navigation still works when browser storage is unavailable. */
    }
  }, [sidebarCollapsed]);
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
    <div className={`shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <Brand />
          <button
            type="button"
            className="btn sidebar-toggle"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
            aria-controls="desktop-navigation"
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <Icon name="sidebar" />
          </button>
        </div>
        <div className="campus">
          MSU–IIT<small>Iligan City, Philippines</small>
        </div>
        <nav className="nav" id="desktop-navigation" aria-label="Main navigation">
          {nav
            .filter(([id]) => id !== 'notifications')
            .map(([id, label, icon]) => (
              <button
                type="button"
                key={id}
                data-page={id}
                className={id === page ? 'active' : ''}
                aria-current={id === page ? 'page' : undefined}
                aria-label={label}
                title={label}
                onClick={() => setPage(id)}
              >
                <Icon name={icon} />
                <span className="nav-label">{label}</span>
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-copy">
            A better campus starts
            <br />
            with a voice.
            <br />
          </span>
          <button
            className="btn link"
            data-logout
            aria-label="Sign out"
            title="Sign out"
            onClick={logout}
          >
            <Icon name="logout" /> <span className="nav-label">Sign out</span>
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
                <small>
                  {user.is_guest ? `${user.affiliation} · Anonymous` : labels[user.role]}
                </small>
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
        <main id="main">
          {Boolean(user.is_guest) && (
            <div className="notice" role="status">
              Anonymous reporting · {user.affiliation} (self-declared). Your reports are available
              only in this browser session, for up to 12 hours. Signing out loses access.
            </div>
          )}
          {data.demo_mode === 'online' && (
            <div className="notice" role="status">
              Demo workspace · Shared test data only. Your changes do not affect regular IIT Voice
              records.
            </div>
          )}
          {children}
        </main>
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
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('The server is unavailable. Please try again shortly.');
    }
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
  async function signIn(values, mode) {
    const session = await api(
      mode === 'demo'
        ? '/api/demo/login'
        : mode === 'google'
          ? '/api/auth/google/complete'
          : '/api/anonymous',
      {
        method: 'POST',
        body: values,
      }
    );
    csrf.current = session.csrf;
    setUser(session.user);
    setPage('overview');
    setBootError('');
    await refresh();
    if (session.user.is_guest) setModal({ type: 'new' });
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
        <Auth signIn={signIn} api={api} />
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
        <Dialog
          className={modal.type === 'new' ? 'report-dialog' : ''}
          onClose={() => setModal(null)}
        >
          {modal.type === 'new' ? <NewReport /> : <ReportDetails key={modal.id} id={modal.id} />}
        </Dialog>
      )}
      <div id="toast" role="status" aria-live="polite" hidden={!message}>
        {message}
      </div>
    </VoiceContext.Provider>
  );
}
