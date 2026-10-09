"""IIT Voice local pilot. Python 3.9+, standard library only."""
import argparse
import base64
import hashlib
import hmac
import json
import math
import mimetypes
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('IIT_VOICE_DATA', str(ROOT / 'data')))
DB = DATA / 'iit-voice.sqlite3'
ROLES = ('student', 'validator', 'admin')
CATEGORIES = ('Safety', 'Repair & maintenance', 'Student needs')
STATUSES = ('submitted', 'needs_information', 'validated', 'in_progress', 'resolved', 'closed', 'rejected', 'duplicate')
TRANSITIONS = {
    'submitted': {'validated', 'needs_information', 'rejected', 'duplicate'},
    'needs_information': {'validated', 'rejected', 'duplicate'},
    'validated': {'in_progress', 'resolved'},
    'in_progress': {'resolved'}, 'resolved': {'closed', 'in_progress'},
    'closed': {'in_progress'}, 'rejected': set(), 'duplicate': set(),
}
MAX_BODY = 4 * 1024 * 1024
SECURE = os.environ.get('IIT_VOICE_SECURE_COOKIE') == '1'


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


class DatabaseConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect():
    c = sqlite3.connect(DB, timeout=15, factory=DatabaseConnection)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    return c


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 260000).hex()
    return salt + ':' + digest


def password_matches(password, stored):
    return hmac.compare_digest(password_hash(password, stored.split(':')[0]), stored)


def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','validator','admin')),
          affiliation TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          csrf TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS offices (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS routing (
          category TEXT PRIMARY KEY, office_id INTEGER NOT NULL REFERENCES offices(id));
        CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY, reporter_id INTEGER NOT NULL REFERENCES users(id),
          title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
          location TEXT NOT NULL, latitude REAL, longitude REAL, priority TEXT NOT NULL DEFAULT 'normal',
          status TEXT NOT NULL DEFAULT 'submitted', visibility TEXT NOT NULL DEFAULT 'restricted',
          public_summary TEXT NOT NULL DEFAULT '', office_id INTEGER REFERENCES offices(id),
          assigned_to INTEGER REFERENCES users(id), duplicate_of INTEGER REFERENCES reports(id),
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES reports(id),
          actor_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
          message TEXT NOT NULL, internal INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS attachments (
          id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES reports(id),
          content BLOB NOT NULL, mime TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          report_id INTEGER REFERENCES reports(id), message TEXT NOT NULL,
          is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id),
          action TEXT NOT NULL, entity TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS login_limits (
          key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, start REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS reports_visibility ON reports(visibility,status);
        CREATE INDEX IF NOT EXISTS reports_reporter ON reports(reporter_id);
        ''')
        if 'public_title' not in [r['name'] for r in c.execute('PRAGMA table_info(reports)')]:
            c.execute("ALTER TABLE reports ADD COLUMN public_title TEXT NOT NULL DEFAULT ''")
        if 'location_details' not in [r['name'] for r in c.execute('PRAGMA table_info(reports)')]:
            c.execute("ALTER TABLE reports ADD COLUMN location_details TEXT NOT NULL DEFAULT ''")
        for name in ('Security & Investigation', 'Physical Plant', 'Student Services', 'ICT'):
            c.execute('INSERT OR IGNORE INTO offices(name) VALUES(?)', (name,))
        for cat, office in zip(CATEGORIES, ('Security & Investigation', 'Physical Plant', 'Student Services')):
            c.execute('INSERT OR IGNORE INTO routing VALUES (?,(SELECT id FROM offices WHERE name=?))', (cat, office))


def audit(c, actor, action, entity, detail=''):
    c.execute('INSERT INTO audit(actor_id,action,entity,detail,created_at) VALUES(?,?,?,?,?)', (actor, action, entity, detail, now()))


def event(c, report, actor, kind, message, internal=False):
    c.execute('INSERT INTO events(report_id,actor_id,kind,message,internal,created_at) VALUES(?,?,?,?,?,?)', (report, actor, kind, message, int(internal), now()))


def notify(c, user, report, message):
    c.execute('INSERT INTO notifications(user_id,report_id,message,created_at) VALUES(?,?,?,?)', (user, report, message, now()))


def user_json(u):
    return {k: u[k] for k in ('id', 'name', 'email', 'role', 'affiliation', 'verified', 'active', 'created_at')}


class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def check(condition, message, status=400):
    if not condition:
        raise APIError(status, message)


def field(body, name, minimum=1, maximum=200):
    value = body.get(name, '')
    check(isinstance(value, str), name + ' must be text.')
    value = value.strip()
    check(minimum <= len(value) <= maximum, '%s must have %s–%s characters.' % (name, minimum, maximum))
    return value


def can_read(u, r):
    return u['role'] in ('admin', 'validator') or r['reporter_id'] == u['id'] or (r['visibility'] == 'campus' and r['status'] in ('validated', 'in_progress', 'resolved', 'closed'))


def report_json(c, u, r, detail=False):
    privileged = u['role'] in ('admin', 'validator') or r['reporter_id'] == u['id']
    keys = ['id', 'title', 'category', 'location', 'latitude', 'longitude', 'priority', 'status', 'visibility', 'public_summary', 'created_at', 'updated_at', 'office_id']
    result = {k: r[k] for k in keys}
    result['public_title'] = r['public_title']
    if not privileged:
        result['title'] = r['public_title'] or 'Campus concern'
    result['description'] = r['description'] if privileged else r['public_summary']
    result['is_mine'] = r['reporter_id'] == u['id']
    office = c.execute('SELECT name FROM offices WHERE id=?', (r['office_id'],)).fetchone()
    result['office'] = office['name'] if office else None
    if privileged:
        result['location_details'] = r['location_details']
        result['reporter'] = dict(c.execute('SELECT id,name,email,affiliation FROM users WHERE id=?', (r['reporter_id'],)).fetchone())
        result['assigned_to'] = r['assigned_to']
        result['duplicate_of'] = r['duplicate_of']
    if detail:
        # Attachments stay private even when the campus summary is published.
        result['attachments'] = [dict(x) for x in c.execute('SELECT id,mime,created_at FROM attachments WHERE report_id=?', (r['id'],))] if privileged else []
        events = c.execute('SELECT e.*,u.name FROM events e JOIN users u ON u.id=e.actor_id WHERE report_id=? ORDER BY e.id', (r['id'],)).fetchall()
        result['events'] = []
        for e in events:
            if e['internal'] and u['role'] == 'student':
                continue
            # Campus viewers see status changes, not reporter comments or staff notes.
            if not privileged and e['kind'] != 'status':
                continue
            result['events'].append({'id': e['id'], 'kind': e['kind'], 'message': e['message'] if privileged else 'Status updated: ' + e['message'].split(' — ')[0], 'actor': e['name'] if privileged else 'IIT Voice team', 'internal': e['internal'], 'created_at': e['created_at']})
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = 'IITVoice'

    def log_message(self, fmt, *args):
        # Do not log query strings, request bodies, or credentials.
        print('%s %s' % (self.command, urlsplit(self.path).path))

    def send(self, status, value, content_type='application/json', extra=None):
        payload = json.dumps(value).encode() if content_type == 'application/json' else value
        # Persist successful mutations before clients receive the response and
        # start their next request on another HTTP worker.
        if status < 400 and getattr(self, '_db', None) is not None:
            self._db.commit()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://tile.openstreetmap.org; frame-src https://www.google.com/maps/embed; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def body(self):
        check(self.headers.get('Content-Type', '').split(';')[0] == 'application/json', 'Use application/json.', 415)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            check(0 < length <= MAX_BODY, 'Request too large or empty.', 413)
            result = json.loads(self.rfile.read(length))
            check(isinstance(result, dict), 'Expected a JSON object.')
            return result
        except (ValueError, UnicodeError):
            raise APIError(400, 'Invalid JSON request.')

    def authenticate(self, c, write=False):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
        except Exception:
            raise APIError(401, 'Sign in to continue.')
        token = cookie['iit_session'].value if 'iit_session' in cookie else ''
        hashed = hashlib.sha256(token.encode()).hexdigest()
        session = c.execute('SELECT * FROM sessions WHERE token_hash=? AND expires>?', (hashed, time.time())).fetchone()
        check(session, 'Sign in to continue.', 401)
        u = c.execute('SELECT * FROM users WHERE id=? AND active=1 AND verified=1', (session['user_id'],)).fetchone()
        check(u, 'Your account is pending verification or inactive.', 403)
        if write:
            check(hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), session['csrf']), 'Invalid security token. Refresh and try again.', 403)
        return u, session

    def cookie(self, token, age=43200):
        return 'iit_session=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%s%s' % (token, age, '; Secure' if SECURE else '')

    def do_GET(self):
        self.dispatch('GET')

    def do_POST(self):
        self.dispatch('POST')

    def do_PATCH(self):
        self.dispatch('PATCH')

    def dispatch(self, method):
        self._db = None
        try:
            path = urlsplit(self.path).path
            if not path.startswith('/api/'):
                check(method == 'GET', 'Method not allowed.', 405)
                # Serve only the compiled React entry and build assets, never
                # source code, database files, or arbitrary project paths.
                webroot = (ROOT / 'dist').resolve()
                check(path == '/' or path.startswith('/assets/'), 'Not found.', 404)
                f = (webroot / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
                check(webroot in f.parents and f.is_file(), 'Frontend not built. Run npm run build.' if path == '/' else 'Not found.', 503 if path == '/' else 404)
                self.send(200, f.read_bytes(), mimetypes.guess_type(str(f))[0] or 'text/plain')
                return
            with connect() as c:
                self._db = c
                self.api(c, method, path)
        except APIError as e:
            self.send(e.status, {'error': e.message})
        except sqlite3.IntegrityError:
            self.send(409, {'error': 'This record already exists or references an invalid record.'})
        except Exception as e:
            print('Request failed:', type(e).__name__)
            self.send(500, {'error': 'Unable to complete the request. Please try again.'})
        finally:
            self._db = None

    def api(self, c, method, path):
        if method == 'POST' and path in ('/api/login', '/api/register'):
            origin = self.headers.get('Origin')
            check(not origin or urlsplit(origin).netloc == self.headers.get('Host'), 'Cross-origin request denied.', 403)
            b = self.body()
            email = field(b, 'email', 3, 254).lower()
            password = field(b, 'password', 12, 128)
            check(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email), 'Enter a valid email address.')
            if path == '/api/register':
                name = field(b, 'name', 2, 100)
                affiliation = field(b, 'affiliation', 2, 100)
                check(affiliation in ('Student', 'Faculty', 'Staff'), 'Choose a campus affiliation.')
                c.execute('INSERT INTO users(name,email,password,role,affiliation,created_at) VALUES(?,?,?,\'student\',?,?)', (name, email, password_hash(password), affiliation, now()))
                self.send(201, {'message': 'Account created. A Main Admin must verify your campus affiliation before you can sign in.'})
                return
            limit_key = hashlib.sha256((self.client_address[0] + email).encode()).hexdigest()
            limit = c.execute('SELECT * FROM login_limits WHERE key=?', (limit_key,)).fetchone()
            check(not limit or limit['start'] < time.time() - 900 or limit['attempts'] < 10, 'Too many sign-in attempts. Try again in 15 minutes.', 429)
            c.execute('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN start<? THEN 1 ELSE attempts+1 END, start=CASE WHEN start<? THEN excluded.start ELSE start END', (limit_key, time.time(), time.time()-900, time.time()-900))
            c.commit()  # Failed attempts must persist even when authentication raises.
            u = c.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
            dummy = '00' * 16 + ':' + '00' * 32
            valid = password_matches(password, u['password'] if u else dummy)
            check(u and valid, 'Email or password is incorrect.', 401)
            check(u['active'] and u['verified'], 'Your account is pending verification or inactive.', 403)
            c.execute('DELETE FROM login_limits WHERE key=?', (limit_key,))
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
            c.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
            c.execute('INSERT INTO sessions VALUES(?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), u['id'], csrf, time.time()+43200))
            self.send(200, {'user': user_json(u), 'csrf': csrf}, extra={'Set-Cookie': self.cookie(token)})
            return

        u, session = self.authenticate(c, method != 'GET')
        if path == '/api/me' and method == 'GET':
            self.send(200, {'user': user_json(u), 'csrf': session['csrf']})
            return
        if path == '/api/logout' and method == 'POST':
            c.execute('DELETE FROM sessions WHERE token_hash=?', (session['token_hash'],))
            self.send(200, {'ok': True}, extra={'Set-Cookie': self.cookie('', 0)})
            return
        if path == '/api/bootstrap' and method == 'GET':
            reports = [report_json(c, u, r) for r in c.execute('SELECT * FROM reports ORDER BY updated_at DESC') if can_read(u, r)]
            notifications = [dict(r) for r in c.execute('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', (u['id'],))]
            offices = [dict(r) for r in c.execute('SELECT * FROM offices')]
            routing = [dict(r) for r in c.execute('SELECT * FROM routing')]
            # Approximate view center. This is not an authoritative campus boundary.
            self.send(200, {'reports': reports, 'offices': offices, 'routing': routing, 'notifications': notifications, 'categories': CATEGORIES, 'map': {'center': [8.2415, 124.2430], 'zoom': 17}, 'admins': [dict(r) for r in c.execute("SELECT id,name,role FROM users WHERE active=1 AND verified=1 AND role IN ('admin','validator')")] if u['role'] != 'student' else []})
            return
        if path == '/api/reports' and method == 'POST':
            b = self.body()
            title, description = field(b, 'title', 5, 150), field(b, 'description', 10, 5000)
            category, location = field(b, 'category'), field(b, 'location', 3, 200)
            location_details = field(b, 'location_details', 0, 500)
            priority = 'normal' if u['role'] == 'student' else b.get('priority', 'normal')
            check(category in CATEGORIES and priority in ('low', 'normal', 'high', 'urgent'), 'Invalid category or priority.')
            lat, lng = b.get('latitude'), b.get('longitude')
            check((lat is None) == (lng is None), 'Provide both map coordinates.')
            if lat is not None:
                check(type(lat) in (int, float) and type(lng) in (int, float) and math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180, 'Invalid location coordinates.')
            stamp = now()
            rid = c.execute('INSERT INTO reports(reporter_id,title,description,category,location,location_details,latitude,longitude,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', (u['id'], title, description, category, location, location_details, lat, lng, priority, stamp, stamp)).lastrowid
            event(c, rid, u['id'], 'created', 'Report submitted for validation.')
            audit(c, u['id'], 'report.created', str(rid))
            for admin in c.execute("SELECT id FROM users WHERE role IN ('admin','validator') AND verified=1 AND active=1").fetchall():
                notify(c, admin['id'], rid, 'New report awaiting review: ' + title)
            self.send(201, {'id': rid})
            return
        match = re.fullmatch(r'/api/reports/(\d+)(?:/(comments|attachments))?', path)
        if match:
            rid, sub = int(match[1]), match[2]
            r = c.execute('SELECT * FROM reports WHERE id=?', (rid,)).fetchone()
            check(r and can_read(u, r), 'Report not found.', 404)
            if method == 'GET' and not sub:
                self.send(200, report_json(c, u, r, True))
                return
            if method == 'POST' and sub == 'comments':
                check(u['role'] != 'student' or r['reporter_id'] == u['id'], 'Only the reporter or an admin can add updates.', 403)
                b = self.body()
                message = field(b, 'message', 2, 2000)
                internal = b.get('internal', False)
                check(type(internal) is bool, 'Invalid internal flag.')
                check(not internal or u['role'] != 'student', 'Internal notes are for admins.', 403)
                event(c, rid, u['id'], 'comment', message, internal)
                c.execute('UPDATE reports SET updated_at=? WHERE id=?', (now(), rid))
                if not internal and u['id'] != r['reporter_id']:
                    notify(c, r['reporter_id'], rid, 'New update on ' + r['title'])
                if u['role'] == 'student':
                    for admin in c.execute("SELECT id FROM users WHERE active=1 AND verified=1 AND role IN ('admin','validator')").fetchall():
                        notify(c, admin['id'], rid, 'Reporter added information: ' + r['title'])
                audit(c, u['id'], 'report.comment', str(rid), 'internal' if internal else 'reporter-visible')
                self.send(201, {'ok': True})
                return
            if method == 'POST' and sub == 'attachments':
                check(r['reporter_id'] == u['id'] or u['role'] != 'student', 'You cannot upload evidence here.', 403)
                b = self.body()
                check(c.execute('SELECT count(*) FROM attachments WHERE report_id=?', (rid,)).fetchone()[0] < 3, 'Maximum three evidence images per report.')
                try:
                    content = base64.b64decode(b.get('data', ''), validate=True)
                except (ValueError, TypeError):
                    raise APIError(400, 'Invalid image data.')
                check(0 < len(content) <= 2 * 1024 * 1024, 'Image must be under 2 MB.')
                mime = 'image/png' if content.startswith(b'\x89PNG\r\n\x1a\n') else 'image/jpeg' if content.startswith(b'\xff\xd8\xff') else None
                check(mime, 'Only PNG or JPEG evidence is supported.')
                aid = c.execute('INSERT INTO attachments(report_id,content,mime,created_at) VALUES(?,?,?,?)', (rid, content, mime, now())).lastrowid
                audit(c, u['id'], 'report.evidence', str(rid))
                self.send(201, {'id': aid})
                return
            if method == 'PATCH' and not sub:
                check(u['role'] in ('admin', 'validator'), 'Admin access required.', 403)
                b = self.body()
                status = b.get('status', r['status'])
                check(status in STATUSES, 'Invalid status.')
                check(status == r['status'] or status in TRANSITIONS[r['status']], 'This status transition is not allowed.')
                if u['role'] == 'validator':
                    check(r['status'] in ('submitted', 'needs_information') and status in ('submitted', 'needs_information', 'validated', 'rejected', 'duplicate'), 'Validators handle initial review. Main Admin manages resolution.', 403)
                note = field(b, 'note', 2, 2000)
                visibility = b.get('visibility', r['visibility'])
                summary = b.get('public_summary', r['public_summary'])
                public_title = b.get('public_title', r['public_title'])
                check(visibility in ('campus', 'restricted'), 'Invalid visibility.')
                check(isinstance(summary, str) and len(summary) <= 3000, 'Public summary is too long.')
                check(isinstance(public_title, str) and len(public_title) <= 150, 'Public title is too long.')
                check(visibility != 'campus' or len(summary.strip()) >= 10, 'A reviewed public summary is required for campus visibility.')
                check(visibility != 'campus' or len(public_title.strip()) >= 5, 'A reviewed public title is required for campus visibility.')
                check(status not in ('submitted', 'needs_information', 'rejected', 'duplicate') or visibility == 'restricted', 'Unvalidated, rejected, and duplicate reports must stay restricted.')
                priority = b.get('priority', r['priority'])
                check(priority in ('low', 'normal', 'high', 'urgent'), 'Invalid priority.')
                office = b.get('office_id', r['office_id'])
                check(office is None or c.execute('SELECT 1 FROM offices WHERE id=?', (office,)).fetchone(), 'Invalid office.')
                check(status not in ('validated', 'in_progress', 'resolved', 'closed') or office is not None, 'Assign a responsible office before validation.')
                assigned = b.get('assigned_to', r['assigned_to'])
                check(assigned is None or c.execute("SELECT 1 FROM users WHERE id=? AND role IN ('admin','validator') AND active=1 AND verified=1", (assigned,)).fetchone(), 'Invalid assigned admin.')
                duplicate = b.get('duplicate_of', r['duplicate_of'])
                if status == 'duplicate':
                    check(duplicate and duplicate != rid and c.execute("SELECT 1 FROM reports WHERE id=? AND status IN ('validated','in_progress','resolved','closed')", (duplicate,)).fetchone(), 'Link to an existing validated report.')
                else:
                    duplicate = None
                c.execute('UPDATE reports SET status=?,visibility=?,public_summary=?,public_title=?,priority=?,office_id=?,assigned_to=?,duplicate_of=?,updated_at=? WHERE id=?', (status, visibility, summary.strip(), public_title.strip(), priority, office, assigned, duplicate, now(), rid))
                priority_note = ('Priority changed from %s to %s. ' % (r['priority'], priority)) if priority != r['priority'] else ''
                event(c, rid, u['id'], 'status', status + ' — ' + priority_note + note)
                audit(c, u['id'], 'report.updated', str(rid), json.dumps({'from': r['status'], 'to': status, 'visibility': visibility, 'from_priority': r['priority'], 'to_priority': priority}))
                message = 'priority is now ' + priority if status == r['status'] and priority != r['priority'] else 'is now ' + status.replace('_', ' ')
                notify(c, r['reporter_id'], rid, 'Report #' + str(rid) + ' ' + message + '.')
                if assigned and assigned != u['id']:
                    notify(c, assigned, rid, 'You were assigned: ' + r['title'])
                self.send(200, report_json(c, u, c.execute('SELECT * FROM reports WHERE id=?', (rid,)).fetchone(), True))
                return
        match = re.fullmatch(r'/api/attachments/(\d+)', path)
        if method == 'GET' and match:
            a = c.execute('SELECT * FROM attachments WHERE id=?', (int(match[1]),)).fetchone()
            check(a, 'Not found.', 404)
            r = c.execute('SELECT * FROM reports WHERE id=?', (a['report_id'],)).fetchone()
            check(u['role'] != 'student' or r['reporter_id'] == u['id'], 'Not found.', 404)
            self.send(200, a['content'], a['mime'])
            return
        if path == '/api/notifications/read' and method == 'POST':
            c.execute('UPDATE notifications SET is_read=1 WHERE user_id=?', (u['id'],))
            self.send(200, {'ok': True})
            return
        if path.startswith('/api/admin/'):
            check(u['role'] == 'admin', 'Main Admin access required.', 403)
            if path == '/api/admin/users' and method == 'GET':
                self.send(200, [user_json(x) for x in c.execute('SELECT * FROM users ORDER BY verified,created_at DESC')])
                return
            match = re.fullmatch(r'/api/admin/users/(\d+)', path)
            if match and method == 'PATCH':
                target_id = int(match[1])
                target = c.execute('SELECT * FROM users WHERE id=?', (target_id,)).fetchone()
                check(target, 'User not found.', 404)
                check(target_id != u['id'], 'You cannot change your own access.')
                b = self.body()
                role = b.get('role', target['role'])
                verified, active = b.get('verified', target['verified']), b.get('active', target['active'])
                check(role in ROLES and type(verified) in (int, bool) and verified in (0, 1) and type(active) in (int, bool) and active in (0, 1), 'Invalid access settings.')
                c.execute('UPDATE users SET role=?,verified=?,active=? WHERE id=?', (role, int(verified), int(active), target_id))
                c.execute('DELETE FROM sessions WHERE user_id=?', (target_id,))
                audit(c, u['id'], 'user.access_changed', str(target_id), json.dumps({'role': role, 'verified': verified, 'active': active}))
                self.send(200, {'ok': True})
                return
            if path == '/api/admin/routing' and method == 'PATCH':
                b = self.body()
                check(b.get('category') in CATEGORIES and c.execute('SELECT 1 FROM offices WHERE id=?', (b.get('office_id'),)).fetchone(), 'Invalid routing.')
                c.execute('UPDATE routing SET office_id=? WHERE category=?', (b['office_id'], b['category']))
                audit(c, u['id'], 'routing.changed', b['category'], str(b['office_id']))
                self.send(200, {'ok': True})
                return
            if path == '/api/admin/audit' and method == 'GET':
                self.send(200, [dict(x) for x in c.execute('SELECT a.*,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200')])
                return
        raise APIError(404, 'Endpoint not found.')


def create_account(email, name, role, password, affiliation='Staff'):
    check(role in ROLES, 'Invalid role.')
    check(len(password) >= 12, 'Use a password of at least 12 characters.')
    with connect() as c:
        uid = c.execute('INSERT INTO users(name,email,password,role,affiliation,verified,created_at) VALUES(?,?,?,?,?,1,?)', (name, email.lower(), password_hash(password), role, affiliation, now())).lastrowid
        audit(c, uid, 'account.bootstrapped', str(uid), role)
        return uid


def seed_demo():
    with connect() as c:
        check(c.execute('SELECT count(*) FROM users').fetchone()[0] == 0, 'Demo seeding requires an empty database.')
    password = secrets.token_urlsafe(15)
    admin = create_account('admin@iitvoice.local', 'Morgan Lee', 'admin', password)
    validator = create_account('validator@iitvoice.local', 'Sam Cruz', 'validator', password)
    student = create_account('student@iitvoice.local', 'Alex Reyes', 'student', password, 'Student')
    create_account('faculty@iitvoice.local', 'Jamie Santos', 'student', password, 'Faculty')
    examples = [
        ('Ceiling leak near classroom', 'Water drips near the classroom entrance after heavy rain. The wet flooring may cause slipping.', 'Repair & maintenance', 'Academic building · Floor 2', 8.242, 124.243, 'high', 'in_progress', 'campus', 2),
        ('Walkway lighting outage', 'Several walkway lights are not working during the evening. Please inspect the electrical supply.', 'Safety', 'Campus walkway', 8.241, 124.2428, 'urgent', 'submitted', 'restricted', 1),
        ('Unstable Wi-Fi connection', 'The campus network frequently disconnects while studying in the reading area.', 'Student needs', 'Library · Reading area', 8.2414, 124.2435, 'normal', 'submitted', 'restricted', 4),
        ('Water dispenser restored', 'The dispenser stopped providing drinking water. Replacement parts have now been installed.', 'Student needs', 'Student services area', 8.2422, 124.2424, 'normal', 'resolved', 'campus', 3),
    ]
    with connect() as c:
        for title, description, cat, loc, lat, lng, priority, status, visibility, office in examples:
            stamp = now()
            rid = c.execute('INSERT INTO reports(reporter_id,title,description,category,location,latitude,longitude,priority,status,visibility,public_summary,office_id,assigned_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (student, title, description, cat, loc, lat, lng, priority, status, visibility, description if visibility == 'campus' else '', office, validator, stamp, stamp)).lastrowid
            c.execute('UPDATE reports SET public_title=? WHERE id=?', (title if visibility == 'campus' else '', rid))
            event(c, rid, student, 'created', 'Report submitted for review.')
            if status != 'submitted':
                event(c, rid, admin, 'status', status + ' — ' + ('Initial inspection completed. Repair is scheduled.' if status == 'in_progress' else 'Service restored. Please confirm the issue is fixed.'))
            notify(c, student, rid, 'Demo report: ' + title)
    print('Demo accounts created. Password for all four accounts: ' + password)
    print('admin@iitvoice.local | validator@iitvoice.local | student@iitvoice.local | faculty@iitvoice.local')
    print('These are sample accounts, locations, and concerns. They are not university records.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--seed-demo', action='store_true')
    parser.add_argument('--create-admin', metavar='EMAIL')
    args = parser.parse_args()
    initialize()
    if args.seed_demo:
        seed_demo()
        return
    if args.create_admin:
        import getpass
        create_account(args.create_admin, input('Name: ').strip(), 'admin', getpass.getpass('Password (12+ characters): '))
        print('Main Admin created.')
        return
    print('IIT Voice running at http://%s:%s' % (args.host, args.port))
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
