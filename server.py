"""IIT Voice local pilot. Python 3.9+; see requirements.txt."""

import argparse
import base64
import hashlib
import hmac
import json
import ipaddress
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
from dotenv import load_dotenv
from database import DEMO_SCHEMA, connect_postgres, insert_id
from photo_analysis import prepare_photo, suggest_category, assess_completion
from report_categories import (
    CATEGORIES,
    CATEGORY_GROUPS,
    DEFAULT_OFFICES,
    LEGACY_CATEGORIES,
    normalize_categories,
)

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env.local", override=False)
load_dotenv(ROOT / ".env.demo.local", override=False)
DATA = Path(os.environ.get("IIT_VOICE_DATA", str(ROOT / "data")))
DB = DATA / "iit-voice.sqlite3"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DEMO_DATABASE_URL = os.environ.get("DEMO_DATABASE_URL", "").strip()
ROLES = ("student", "validator", "admin", "office")
STATUSES = (
    "submitted",
    "needs_information",
    "validated",
    "in_progress",
    "resolved",
    "closed",
    "rejected",
    "duplicate",
)
TRANSITIONS = {
    "submitted": {"validated", "needs_information", "rejected", "duplicate"},
    "needs_information": {"validated", "rejected", "duplicate"},
    "validated": {"in_progress", "resolved"},
    "in_progress": {"resolved"},
    "resolved": {"closed", "in_progress"},
    "closed": {"in_progress"},
    "rejected": set(),
    "duplicate": set(),
}
MAX_BODY = 4 * 1024 * 1024
SECURE = os.environ.get("IIT_VOICE_SECURE_COOKIE") == "1" or os.environ.get("VERCEL") == "1"
DEMO_LOGIN = os.environ.get("IIT_VOICE_DEMO_LOGIN") == "1"


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class DatabaseConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect(online_demo=False):
    if online_demo:
        if not DEMO_DATABASE_URL:
            raise RuntimeError("Online demo database is not configured.")
        return connect_postgres(DEMO_DATABASE_URL, DEMO_SCHEMA)
    if DATABASE_URL:
        return connect_postgres(DATABASE_URL)
    c = sqlite3.connect(DB, timeout=15, factory=DatabaseConnection)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 260000).hex()
    return salt + ":" + digest


def password_matches(password, stored):
    return hmac.compare_digest(password_hash(password, stored.split(":")[0]), stored)


def initialize():
    if DATABASE_URL:
        with connect() as c:
            # The checked-in SQL is also runnable in Supabase's SQL Editor.
            c.connection.autocommit = True
            c.connection.execute(
                (ROOT / "supabase/migrations/202610270001_iit_voice.sql").read_text()
            )
            c.connection.autocommit = False
            initialize_defaults(c)
        return
    DATA.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        schema = c.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
        ).fetchone()
        if schema and "'office'" not in schema["sql"]:
            # Rebuild only users to expand its CHECK constraint, preserving IDs and all columns.
            new_sql = schema["sql"].replace(
                "('student','validator','admin')", "('student','validator','admin','office')"
            )
            check(new_sql != schema["sql"], "Unable to migrate the account role constraint.")
            new_sql = re.sub(
                r'CREATE TABLE\s+"?users"?', "CREATE TABLE users_new", new_sql, count=1, flags=re.I
            )
            c.execute("PRAGMA foreign_keys=OFF")
            try:
                c.execute("BEGIN IMMEDIATE")
                c.execute(new_sql)
                c.execute("INSERT INTO users_new SELECT * FROM users")
                c.execute("DROP TABLE users")
                c.execute("ALTER TABLE users_new RENAME TO users")
                check(
                    not c.execute("PRAGMA foreign_key_check").fetchall(),
                    "Account migration found invalid references.",
                )
                c.commit()
            except Exception:
                c.rollback()
                raise
            finally:
                c.execute("PRAGMA foreign_keys=ON")
        c.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','validator','admin','office')),
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
        CREATE TABLE IF NOT EXISTS photo_analyses (
          token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          photo_hash TEXT NOT NULL, metadata TEXT NOT NULL, created_at REAL NOT NULL);
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
        """)
        if "is_demo" not in [r["name"] for r in c.execute("PRAGMA table_info(users)")]:
            c.execute("ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0")
            # Recognize the four previously seeded sample identities, not arbitrary registrations.
            for email, name in (
                ("admin@iitvoice.local", "Morgan Lee"),
                ("validator@iitvoice.local", "Sam Cruz"),
                ("student@iitvoice.local", "Alex Reyes"),
                ("faculty@iitvoice.local", "Jamie Santos"),
            ):
                c.execute("UPDATE users SET is_demo=1 WHERE email=? AND name=?", (email, name))
        if "office_id" not in [r["name"] for r in c.execute("PRAGMA table_info(users)")]:
            c.execute("ALTER TABLE users ADD COLUMN office_id INTEGER REFERENCES offices(id)")
        if "public_title" not in [r["name"] for r in c.execute("PRAGMA table_info(reports)")]:
            c.execute("ALTER TABLE reports ADD COLUMN public_title TEXT NOT NULL DEFAULT ''")
        if "location_details" not in [r["name"] for r in c.execute("PRAGMA table_info(reports)")]:
            c.execute("ALTER TABLE reports ADD COLUMN location_details TEXT NOT NULL DEFAULT ''")
        if "evidence_round" not in [r["name"] for r in c.execute("PRAGMA table_info(reports)")]:
            c.execute("ALTER TABLE reports ADD COLUMN evidence_round INTEGER NOT NULL DEFAULT 0")
        attachment_columns = {r["name"] for r in c.execute("PRAGMA table_info(attachments)")}
        for name, default in (("filename", ""), ("metadata", "{}")):
            if name not in attachment_columns:
                c.execute(
                    "ALTER TABLE attachments ADD COLUMN %s TEXT NOT NULL DEFAULT '%s'"
                    % (name, default)
                )
        if "categories" not in [r["name"] for r in c.execute("PRAGMA table_info(reports)")]:
            c.execute("ALTER TABLE reports ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'")
        # Preserve existing routing customizations while renaming the old categories.
        for old, new in LEGACY_CATEGORIES.items():
            c.execute(
                "INSERT OR IGNORE INTO routing SELECT ?,office_id FROM routing WHERE category=?",
                (new, old),
            )
            c.execute("DELETE FROM routing WHERE category=?", (old,))
            c.execute("UPDATE reports SET category=? WHERE category=?", (new, old))
        for r in c.execute("SELECT id,category FROM reports WHERE categories='[]'").fetchall():
            c.execute(
                "UPDATE reports SET categories=? WHERE id=?", (json.dumps([r["category"]]), r["id"])
            )
        initialize_defaults(c)


def initialize_defaults(c):
    for name in ("Security & Investigation", "Physical Plant", "Student Services", "ICT"):
        c.execute("INSERT INTO offices(name) VALUES(?) ON CONFLICT DO NOTHING", (name,))
    for cat, office in DEFAULT_OFFICES.items():
        c.execute("INSERT INTO offices(name) VALUES(?) ON CONFLICT DO NOTHING", (office,))
        c.execute(
            "INSERT INTO routing VALUES (?,(SELECT id FROM offices WHERE name=?)) ON CONFLICT DO NOTHING",
            (cat, office),
        )


def audit(c, actor, action, entity, detail=""):
    c.execute(
        "INSERT INTO audit(actor_id,action,entity,detail,created_at) VALUES(?,?,?,?,?)",
        (actor, action, entity, detail, now()),
    )


def event(c, report, actor, kind, message, internal=False):
    c.execute(
        "INSERT INTO events(report_id,actor_id,kind,message,internal,created_at) VALUES(?,?,?,?,?,?)",
        (report, actor, kind, message, int(internal), now()),
    )


def notify(c, user, report, message):
    c.execute(
        "INSERT INTO notifications(user_id,report_id,message,created_at) VALUES(?,?,?,?)",
        (user, report, message, now()),
    )


def user_json(u):
    return {
        k: u[k]
        for k in (
            "id",
            "name",
            "email",
            "role",
            "affiliation",
            "verified",
            "active",
            "created_at",
            "office_id",
        )
    }


class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def check(condition, message, status=400):
    if not condition:
        raise APIError(status, message)


def field(body, name, minimum=1, maximum=200):
    value = body.get(name, "")
    check(isinstance(value, str), name + " must be text.")
    value = value.strip()
    check(
        minimum <= len(value) <= maximum,
        "%s must have %s–%s characters." % (name, minimum, maximum),
    )
    return value


def report_categories(body, primary):
    try:
        return normalize_categories(primary, body.get("categories", [primary]))
    except ValueError as error:
        raise APIError(400, str(error))


def analysis_categories(result):
    # Cached analyses from the previous taxonomy still work with current forms.
    if result.get("category"):
        result["category"], result["categories"] = normalize_categories(
            result["category"], result.get("categories", [result["category"]])
        )
    else:
        result["categories"] = []
    return result


def consume_photo_limit(c, u):
    limit_key = "photo-ai:" + str(u["id"])
    limit = c.execute("SELECT * FROM login_limits WHERE key=?", (limit_key,)).fetchone()
    if limit and limit["start"] >= time.time() - 3600 and limit["attempts"] >= 20:
        raise RuntimeError(
            "Photo analysis limit reached. Try again later. This photo needs manual review."
        )
    if os.environ.get("GEMINI_API_KEY"):
        stamp = time.time()
        c.execute(
            "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.start<? THEN 1 ELSE login_limits.attempts+1 END, start=CASE WHEN login_limits.start<? THEN excluded.start ELSE login_limits.start END",
            (limit_key, stamp, stamp - 3600, stamp - 3600),
        )
        c.commit()


def inspect_photo(c, u, encoded, force=False):
    """Screen every upload; cache only server results bound to user and exact bytes."""
    try:
        gps, image = prepare_photo(encoded)
    except ValueError as error:
        raise APIError(400, str(error))
    photo_hash = hashlib.sha256(base64.b64decode(encoded)).hexdigest()
    cached = c.execute(
        "SELECT * FROM photo_analyses WHERE user_id=? AND photo_hash=? AND created_at>? ORDER BY created_at DESC LIMIT 1",
        (u["id"], photo_hash, time.time() - 86400),
    ).fetchone()
    if cached and not force:
        metadata = json.loads(cached["metadata"])
        if metadata.get("screening") and (
            "description" in metadata
            or metadata["screening"]["status"] in ("rejected", "unverified")
        ):
            return {
                **analysis_categories(metadata),
                "analysis_token": cached["token"],
                "ai_available": bool(os.environ.get("GEMINI_API_KEY")),
            }
    result = {
        "gps": gps,
        "category": None,
        "categories": [],
        "title": None,
        "description": None,
        "reason": "",
        "ai_error": "",
        "screening": {
            "status": "unverified",
            "reason": "Automatic screening unavailable. The photo needs manual review.",
        },
    }
    try:
        consume_photo_limit(c, u)
        result.update(analysis_categories(suggest_category(image)))
        result.update(
            model=os.environ.get("IIT_VOICE_AI_MODEL", "gemini-3.5-flash-lite"), analyzed_at=now()
        )
    except RuntimeError as error:
        result["ai_error"] = str(error)
    token = secrets.token_urlsafe(24)
    c.execute("DELETE FROM photo_analyses WHERE created_at<?", (time.time() - 86400,))
    c.execute(
        "INSERT INTO photo_analyses VALUES(?,?,?,?,?)",
        (token, u["id"], photo_hash, json.dumps(result), time.time()),
    )
    c.commit()  # Keep screening results even when the subsequent upload is rejected.
    return {
        **result,
        "analysis_token": token,
        "ai_available": bool(os.environ.get("GEMINI_API_KEY")),
    }


def can_read(u, r):
    if u["role"] == "office":
        return (
            u["office_id"] is not None
            and r["office_id"] == u["office_id"]
            and r["status"] in ("validated", "in_progress", "resolved", "closed")
        )
    return (
        u["role"] in ("admin", "validator")
        or r["reporter_id"] == u["id"]
        or (
            r["visibility"] == "campus"
            and r["status"] in ("validated", "in_progress", "resolved", "closed")
        )
    )


def photo_fingerprint(content):
    # Compare the displayed photo, ignoring filenames and EXIF/GPS changes.
    try:
        _, image = prepare_photo(base64.b64encode(content).decode())
        return hashlib.sha256(image.encode()).hexdigest()
    except ValueError:
        return hashlib.sha256(content).hexdigest()


def completion_context(c, r):
    concern = {
        "title": r["title"],
        "description": r["description"],
        "categories": json.loads(r["categories"]),
    }
    references, before_images = [], []
    for row in c.execute(
        "SELECT id,content,metadata FROM attachments WHERE report_id=? ORDER BY id", (r["id"],)
    ):
        metadata = json.loads(row["metadata"])
        if metadata.get("stage") == "after":
            continue
        references.append([row["id"], hashlib.sha256(row["content"]).hexdigest()])
        if metadata.get("screening", {}).get("status") == "appropriate":
            try:
                before_images.append(prepare_photo(base64.b64encode(row["content"]).decode())[1])
            except ValueError:
                pass
    context = [1, r["id"], r["office_id"], r["evidence_round"], concern, references]
    return (
        hashlib.sha256(json.dumps(context, sort_keys=True).encode()).hexdigest(),
        before_images,
        concern,
    )


def inspect_completion(c, u, r, encoded, force=False, attachment_id=None):
    check(
        u["role"] in ("admin", "office")
        and can_read(u, r)
        and r["status"] in ("validated", "in_progress", "resolved", "closed"),
        "Only Main Admin or the assigned office can check completion evidence.",
        403,
    )
    try:
        _, image = prepare_photo(encoded)
        content = base64.b64decode(encoded)
    except ValueError as error:
        raise APIError(400, str(error))
    fingerprint = photo_fingerprint(content)
    check(
        not any(
            photo_fingerprint(row["content"]) == fingerprint
            for row in c.execute(
                "SELECT content FROM attachments WHERE report_id=? AND id!=?",
                (r["id"], attachment_id or 0),
            )
        ),
        "This is the same photo as earlier evidence. Upload a fresh photo showing the completed work.",
        422,
    )
    context, before_images, concern = completion_context(c, r)
    photo_hash = hashlib.sha256(content).hexdigest()
    if not force:
        for cached in c.execute(
            "SELECT * FROM photo_analyses WHERE user_id=? AND photo_hash=? AND created_at>? ORDER BY created_at DESC",
            (u["id"], photo_hash, time.time() - 86400),
        ):
            metadata = json.loads(cached["metadata"])
            if metadata.get("completion_context") == context and metadata.get("completion_check"):
                return {
                    **metadata,
                    "analysis_token": cached["token"],
                    "ai_available": bool(os.environ.get("GEMINI_API_KEY")),
                }
    result = inspect_photo(c, u, encoded, force)
    verdict = {
        "status": "unclear",
        "reason": "Content screening must clear this photo before its relevance can be checked.",
    }
    if result["screening"]["status"] == "appropriate":
        try:
            consume_photo_limit(c, u)
            verdict = assess_completion(image, before_images, concern)
        except RuntimeError as error:
            verdict = {
                "status": "unavailable",
                "reason": "Completion could not be checked. " + str(error),
            }
    verdict = {**verdict, "checked_at": now()}
    result.update(completion_check=verdict, completion_context=context)
    metadata = {
        key: value for key, value in result.items() if key not in ("analysis_token", "ai_available")
    }
    token = secrets.token_urlsafe(24)
    c.execute(
        "INSERT INTO photo_analyses VALUES(?,?,?,?,?)",
        (token, u["id"], photo_hash, json.dumps(metadata), time.time()),
    )
    c.commit()
    return {**result, "analysis_token": token}


def report_evidence(c, r):
    attachments, seen = [], set()
    context = completion_context(c, r)[0]
    for row in c.execute(
        "SELECT id,mime,filename,metadata,created_at,content FROM attachments WHERE report_id=? ORDER BY id",
        (r["id"],),
    ):
        item = dict(row)
        fingerprint = photo_fingerprint(item.pop("content"))
        metadata = item["metadata"] = json.loads(item["metadata"])
        after = metadata.get("stage") == "after"
        item["completion_issue"] = (
            "This reuses an earlier evidence photo. Upload a fresh photo of the completed work."
            if after and fingerprint in seen
            else ""
        )
        comparison = metadata.get("completion_check", {})
        if after and not item["completion_issue"]:
            if metadata.get("completion_context") != context:
                item["completion_issue"] = (
                    "This photo has not been checked against the current concern. Check its relevance before completion."
                )
            elif comparison.get("status") != "supports_completion":
                item["completion_issue"] = (
                    comparison.get("reason")
                    or "This photo does not establish completion of this concern."
                )
        item["completion_eligible"] = (
            after
            and not item["completion_issue"]
            and metadata.get("evidence_round") == r["evidence_round"]
            and metadata.get("office_id") == r["office_id"]
            and metadata.get("screening", {}).get("status") == "appropriate"
        )
        attachments.append(item)
        seen.add(fingerprint)
    return attachments


def has_completion_evidence(c, r):
    return any(item["completion_eligible"] for item in report_evidence(c, r))


def report_json(c, u, r, detail=False):
    privileged = u["role"] in ("admin", "validator", "office") or r["reporter_id"] == u["id"]
    keys = [
        "id",
        "title",
        "category",
        "location",
        "latitude",
        "longitude",
        "priority",
        "status",
        "visibility",
        "public_summary",
        "created_at",
        "updated_at",
        "office_id",
    ]
    result = {k: r[k] for k in keys}
    result["categories"] = json.loads(r["categories"]) or [r["category"]]
    result["public_title"] = r["public_title"]
    if not privileged:
        result["title"] = r["public_title"] or "Campus concern"
    result["description"] = r["description"] if privileged else r["public_summary"]
    result["is_mine"] = r["reporter_id"] == u["id"]
    office = c.execute("SELECT name FROM offices WHERE id=?", (r["office_id"],)).fetchone()
    result["office"] = office["name"] if office else None
    if privileged:
        result["evidence_round"] = r["evidence_round"]
        result["location_details"] = r["location_details"]
        result["reporter"] = dict(
            c.execute(
                "SELECT id,name,email,affiliation FROM users WHERE id=?", (r["reporter_id"],)
            ).fetchone()
        )
        result["assigned_to"] = r["assigned_to"]
        assigned = c.execute(
            "SELECT id,name,role FROM users WHERE id=?", (r["assigned_to"],)
        ).fetchone()
        result["assigned_admin"] = dict(assigned) if assigned else None
        result["duplicate_of"] = r["duplicate_of"]
    if detail:
        # Attachments stay private even when the campus summary is published.
        result["attachments"] = report_evidence(c, r) if privileged else []
        result["has_completion_evidence"] = any(
            item["completion_eligible"] for item in result["attachments"]
        )
        events = c.execute(
            "SELECT e.*,u.name FROM events e JOIN users u ON u.id=e.actor_id WHERE report_id=? ORDER BY e.id",
            (r["id"],),
        ).fetchall()
        result["events"] = []
        for e in events:
            if e["internal"] and u["role"] == "student":
                continue
            # Campus viewers see status changes, not reporter comments or staff notes.
            if not privileged and e["kind"] != "status":
                continue
            result["events"].append(
                {
                    "id": e["id"],
                    "kind": e["kind"],
                    "message": e["message"]
                    if privileged
                    else "Status updated: " + e["message"].split(" — ")[0],
                    "actor": e["name"] if privileged else "IIT Voice team",
                    "internal": e["internal"],
                    "created_at": e["created_at"],
                }
            )
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "IITVoice"

    def log_message(self, fmt, *args):
        # Do not log query strings, request bodies, or credentials.
        print("%s %s" % (self.command, urlsplit(self.path).path))

    def send(self, status, value, content_type="application/json", extra=None):
        payload = json.dumps(value).encode() if content_type == "application/json" else value
        # Persist successful mutations before clients receive the response and
        # start their next request on another HTTP worker.
        if status < 400 and getattr(self, "_db", None) is not None:
            self._db.commit()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: blob: https://tile.openstreetmap.org; frame-src https://www.google.com/maps/embed; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        )
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def body(self):
        check(
            self.headers.get("Content-Type", "").split(";")[0] == "application/json",
            "Use application/json.",
            415,
        )
        try:
            length = int(self.headers.get("Content-Length", "0"))
            check(0 < length <= MAX_BODY, "Request too large or empty.", 413)
            result = json.loads(self.rfile.read(length))
            check(isinstance(result, dict), "Expected a JSON object.")
            return result
        except (ValueError, UnicodeError):
            raise APIError(400, "Invalid JSON request.")

    def authenticate(self, c, write=False):
        token = self.session_token()
        hashed = hashlib.sha256(token.encode()).hexdigest()
        session = c.execute(
            "SELECT * FROM sessions WHERE token_hash=? AND expires>?", (hashed, time.time())
        ).fetchone()
        check(session, "Sign in to continue.", 401)
        u = c.execute(
            "SELECT * FROM users WHERE id=? AND active=1 AND verified=1", (session["user_id"],)
        ).fetchone()
        check(u, "Your account is pending verification or inactive.", 403)
        if write:
            check(
                hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), session["csrf"]),
                "Invalid security token. Refresh and try again.",
                403,
            )
        return u, session

    def session_token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            raise APIError(401, "Sign in to continue.")
        return cookie["iit_session"].value if "iit_session" in cookie else ""

    def online_demo_enabled(self):
        # Local demo mode deliberately has no cloud DATABASE_URL.
        return bool(DATABASE_URL and DEMO_DATABASE_URL)

    def uses_online_demo(self, path):
        if path in ("/api/login", "/api/register"):
            return False
        if path in ("/api/demo/accounts", "/api/demo/login"):
            return self.online_demo_enabled()
        if self.session_token().startswith("demo."):
            check(self.online_demo_enabled(), "Demo session unavailable. Sign in again.", 401)
            return True
        return False

    def cookie(self, token, age=43200):
        return "iit_session=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%s%s" % (
            token,
            age,
            "; Secure" if SECURE else "",
        )

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PATCH(self):
        self.dispatch("PATCH")

    def dispatch(self, method):
        self._db = None
        self._online_demo = False
        try:
            path = urlsplit(self.path).path
            if path == "/api/health" and method == "GET":
                # Process readiness must not depend on a cloud database round trip.
                self.send(200, {"ok": True})
                return
            if not path.startswith("/api/"):
                check(method == "GET", "Method not allowed.", 405)
                # Serve only the compiled React entry and build assets, never
                # source code, database files, or arbitrary project paths.
                webroot = (ROOT / "dist").resolve()
                check(path == "/" or path.startswith("/assets/"), "Not found.", 404)
                f = (webroot / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
                check(
                    webroot in f.parents and f.is_file(),
                    "Frontend not built. Run npm run build." if path == "/" else "Not found.",
                    503 if path == "/" else 404,
                )
                self.send(200, f.read_bytes(), mimetypes.guess_type(str(f))[0] or "text/plain")
                return
            self._online_demo = self.uses_online_demo(path)
            connection = connect(online_demo=True) if self._online_demo else connect()
            with connection as c:
                self._db = c
                self.api(c, method, path)
        except APIError as e:
            self.send(e.status, {"error": e.message})
        except sqlite3.IntegrityError:
            self.send(409, {"error": "This record already exists or references an invalid record."})
        except Exception as e:
            print("Request failed:", type(e).__name__)
            self.send(500, {"error": "Unable to complete the request. Please try again."})
        finally:
            self._db = None

    def demo_enabled(self):
        if self.online_demo_enabled():
            return True
        hostname = urlsplit("http://" + self.headers.get("Host", "")).hostname
        return (
            DEMO_LOGIN
            and ipaddress.ip_address(self.client_address[0]).is_loopback
            and ipaddress.ip_address(self.server.server_address[0]).is_loopback
            and hostname in ("127.0.0.1", "localhost", "::1")
        )

    def sign_in(self, c, u):
        check(
            u["role"] != "office" or u["office_id"] is not None,
            "Your office membership needs to be configured by Main Admin.",
            403,
        )
        check(
            u["active"] and u["verified"], "Your account is pending verification or inactive.", 403
        )
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        if self._online_demo:
            token = "demo." + token
        c.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
        c.execute(
            "INSERT INTO sessions VALUES(?,?,?,?)",
            (hashlib.sha256(token.encode()).hexdigest(), u["id"], csrf, time.time() + 43200),
        )
        self.send(
            200, {"user": user_json(u), "csrf": csrf}, extra={"Set-Cookie": self.cookie(token)}
        )

    def api(self, c, method, path):
        if path == "/api/demo/accounts" and method == "GET":
            accounts = (
                [
                    dict(account)
                    for account in c.execute(
                        "SELECT u.id,u.name,u.role,u.affiliation,u.office_id,o.name AS office_name FROM users u LEFT JOIN offices o ON o.id=u.office_id WHERE u.is_demo=1 AND u.active=1 AND u.verified=1 ORDER BY u.id"
                    )
                ]
                if self.demo_enabled()
                else []
            )
            result = {"accounts": accounts}
            if accounts:
                result["mode"] = "online" if self._online_demo else "local"
            self.send(200, result)
            return
        if path == "/api/demo/login" and method == "POST":
            check(self.demo_enabled(), "Demo sign-in is unavailable.", 403)
            origin = self.headers.get("Origin")
            check(
                not origin or urlsplit(origin).netloc == self.headers.get("Host"),
                "Cross-origin request denied.",
                403,
            )
            account_id = self.body().get("account_id")
            check(type(account_id) is int, "Choose a demo account.")
            u = c.execute("SELECT * FROM users WHERE id=? AND is_demo=1", (account_id,)).fetchone()
            check(u, "Demo account unavailable.", 404)
            self.sign_in(c, u)
            return
        if method == "POST" and path in ("/api/login", "/api/register"):
            origin = self.headers.get("Origin")
            check(
                not origin or urlsplit(origin).netloc == self.headers.get("Host"),
                "Cross-origin request denied.",
                403,
            )
            b = self.body()
            email = field(b, "email", 3, 254).lower()
            password = field(b, "password", 12, 128)
            check(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email), "Enter a valid email address.")
            if path == "/api/register":
                name = field(b, "name", 2, 100)
                affiliation = field(b, "affiliation", 2, 100)
                check(
                    affiliation in ("Student", "Faculty", "Staff"), "Choose a campus affiliation."
                )
                c.execute(
                    "INSERT INTO users(name,email,password,role,affiliation,created_at) VALUES(?,?,?,'student',?,?)",
                    (name, email, password_hash(password), affiliation, now()),
                )
                self.send(
                    201,
                    {
                        "message": "Account created. A Main Admin must verify your campus affiliation before you can sign in."
                    },
                )
                return
            limit_key = hashlib.sha256((self.client_address[0] + email).encode()).hexdigest()
            limit = c.execute("SELECT * FROM login_limits WHERE key=?", (limit_key,)).fetchone()
            check(
                not limit or limit["start"] < time.time() - 900 or limit["attempts"] < 10,
                "Too many sign-in attempts. Try again in 15 minutes.",
                429,
            )
            c.execute(
                "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.start<? THEN 1 ELSE login_limits.attempts+1 END, start=CASE WHEN login_limits.start<? THEN excluded.start ELSE login_limits.start END",
                (limit_key, time.time(), time.time() - 900, time.time() - 900),
            )
            c.commit()  # Failed attempts must persist even when authentication raises.
            u = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            dummy = "00" * 16 + ":" + "00" * 32
            valid = password_matches(password, u["password"] if u else dummy)
            check(u and valid, "Email or password is incorrect.", 401)
            c.execute("DELETE FROM login_limits WHERE key=?", (limit_key,))
            self.sign_in(c, u)
            return

        u, session = self.authenticate(c, method != "GET")
        if path == "/api/photos/inspect" and method == "POST":
            check(u["role"] != "validator", "Validators can only submit validation decisions.", 403)
            b = self.body()
            check(type(b.get("analyze", False)) is bool, "Invalid analysis option.")
            if "report_id" in b:
                check(type(b["report_id"]) is int, "Invalid report.")
                r = c.execute("SELECT * FROM reports WHERE id=?", (b["report_id"],)).fetchone()
                check(r and can_read(u, r), "Report not found.", 404)
                result = inspect_completion(
                    c, u, r, b.get("data", ""), force=b.get("analyze", False)
                )
            else:
                result = inspect_photo(c, u, b.get("data", ""), force=b.get("analyze", False))
            self.send(200, result)
            return
        if path == "/api/me" and method == "GET":
            self.send(200, {"user": user_json(u), "csrf": session["csrf"]})
            return
        if path == "/api/logout" and method == "POST":
            c.execute("DELETE FROM sessions WHERE token_hash=?", (session["token_hash"],))
            self.send(200, {"ok": True}, extra={"Set-Cookie": self.cookie("", 0)})
            return
        if path == "/api/bootstrap" and method == "GET":
            reports = [
                report_json(c, u, r)
                for r in c.execute("SELECT * FROM reports ORDER BY created_at DESC,id DESC")
                if can_read(u, r)
            ]
            notifications = []
            for n in c.execute(
                "SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100", (u["id"],)
            ):
                report = (
                    c.execute("SELECT * FROM reports WHERE id=?", (n["report_id"],)).fetchone()
                    if n["report_id"]
                    else None
                )
                if n["report_id"] and (not report or not can_read(u, report)):
                    continue
                notifications.append(dict(n))
            offices = [dict(r) for r in c.execute("SELECT * FROM offices")]
            routing = (
                [dict(r) for r in c.execute("SELECT * FROM routing")]
                if u["role"] in ("admin", "validator")
                else []
            )
            if u["role"] == "office":
                offices = [o for o in offices if o["id"] == u["office_id"]]
            # Approximate view center. This is not an authoritative campus boundary.
            self.send(
                200,
                {
                    "demo_mode": "online"
                    if self._online_demo
                    else ("local" if DEMO_LOGIN else None),
                    "reports": reports,
                    "offices": offices,
                    "routing": routing,
                    "notifications": notifications,
                    "categories": CATEGORIES,
                    "category_groups": CATEGORY_GROUPS,
                    "map": {"center": [8.2415, 124.2430], "zoom": 17},
                    "admins": [
                        dict(r)
                        for r in c.execute(
                            "SELECT id,name,role,office_id FROM users WHERE active=1 AND verified=1 AND role IN ('admin','office')"
                        )
                    ]
                    if u["role"] in ("admin", "validator")
                    else [],
                },
            )
            return
        if path == "/api/reports" and method == "POST":
            check(u["role"] in ("student", "admin"), "This role cannot submit campus reports.", 403)
            b = self.body()
            title, description = field(b, "title", 5, 150), field(b, "description", 10, 5000)
            category, categories = report_categories(b, field(b, "category"))
            location = field(b, "location", 3, 200)
            location_details = field(b, "location_details", 0, 500)
            priority = "normal" if u["role"] == "student" else b.get("priority", "normal")
            check(
                category in CATEGORIES and priority in ("low", "normal", "high", "urgent"),
                "Invalid category or priority.",
            )
            lat, lng = b.get("latitude"), b.get("longitude")
            check((lat is None) == (lng is None), "Provide both map coordinates.")
            if lat is not None:
                check(
                    type(lat) in (int, float)
                    and type(lng) in (int, float)
                    and math.isfinite(lat)
                    and math.isfinite(lng)
                    and -90 <= lat <= 90
                    and -180 <= lng <= 180,
                    "Invalid location coordinates.",
                )
            stamp = now()
            rid = insert_id(
                c,
                "INSERT INTO reports(reporter_id,title,description,category,location,location_details,latitude,longitude,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    u["id"],
                    title,
                    description,
                    category,
                    location,
                    location_details,
                    lat,
                    lng,
                    priority,
                    stamp,
                    stamp,
                ),
            )
            c.execute("UPDATE reports SET categories=? WHERE id=?", (json.dumps(categories), rid))
            event(c, rid, u["id"], "created", "Report submitted for validation.")
            audit(c, u["id"], "report.created", str(rid))
            for admin in c.execute(
                "SELECT id FROM users WHERE role IN ('admin','validator') AND verified=1 AND active=1"
            ).fetchall():
                notify(c, admin["id"], rid, "New report awaiting review: " + title)
            self.send(201, {"id": rid})
            return
        match = re.fullmatch(r"/api/reports/(\d+)(?:/(comments|attachments))?", path)
        if match:
            rid, sub = int(match[1]), match[2]
            r = c.execute("SELECT * FROM reports WHERE id=?", (rid,)).fetchone()
            check(r and can_read(u, r), "Report not found.", 404)
            if method == "GET" and not sub:
                self.send(200, report_json(c, u, r, True))
                return
            if method == "POST" and sub == "comments":
                check(
                    u["role"] != "validator"
                    and (u["role"] != "student" or r["reporter_id"] == u["id"]),
                    "Validators only submit validation decisions; updates are for the reporter, Main Admin and assigned office.",
                    403,
                )
                b = self.body()
                message = field(b, "message", 2, 2000)
                internal = b.get("internal", False)
                check(type(internal) is bool, "Invalid internal flag.")
                check(not internal or u["role"] != "student", "Internal notes are for admins.", 403)
                event(c, rid, u["id"], "comment", message, internal)
                c.execute("UPDATE reports SET updated_at=? WHERE id=?", (now(), rid))
                if not internal and u["id"] != r["reporter_id"]:
                    notify(c, r["reporter_id"], rid, "New update on " + r["title"])
                if u["role"] == "student":
                    for admin in c.execute(
                        "SELECT id FROM users WHERE active=1 AND verified=1 AND role IN ('admin','validator')"
                    ).fetchall():
                        notify(c, admin["id"], rid, "Reporter added information: " + r["title"])
                audit(
                    c,
                    u["id"],
                    "report.comment",
                    str(rid),
                    "internal" if internal else "reporter-visible",
                )
                self.send(201, {"ok": True})
                return
            if method == "POST" and sub == "attachments":
                check(
                    u["role"] != "validator"
                    and (r["reporter_id"] == u["id"] or u["role"] in ("admin", "office")),
                    "You cannot upload evidence here.",
                    403,
                )
                b = self.body()
                stage = b.get("stage", "before")
                check(stage in ("before", "after"), "Choose before or after evidence.")
                if stage == "after":
                    check(
                        u["role"] in ("admin", "office")
                        and r["status"] in ("validated", "in_progress", "resolved", "closed"),
                        "Only Main Admin or the assigned office can add after-work evidence after validation.",
                        403,
                    )
                existing = report_evidence(c, r)
                count = sum(
                    item["metadata"].get("stage", "before") == "before"
                    if stage == "before"
                    else item["completion_eligible"]
                    for item in existing
                )
                check(
                    count < 3, "Maximum three before photos and three after photos per work round."
                )
                try:
                    content = base64.b64decode(b.get("data", ""), validate=True)
                except (ValueError, TypeError):
                    raise APIError(400, "Invalid image data.")
                check(0 < len(content) <= 2 * 1024 * 1024, "Image must be under 2 MB.")
                mime = (
                    "image/png"
                    if content.startswith(b"\x89PNG\r\n\x1a\n")
                    else "image/jpeg"
                    if content.startswith(b"\xff\xd8\xff")
                    else None
                )
                check(mime, "Only PNG or JPEG evidence is supported.")
                if stage == "after":
                    fingerprint = photo_fingerprint(content)
                    check(
                        not any(
                            photo_fingerprint(row["content"]) == fingerprint
                            for row in c.execute(
                                "SELECT content FROM attachments WHERE report_id=?", (rid,)
                            )
                        ),
                        "This is the same photo as earlier evidence. Upload a fresh photo showing the completed work.",
                        422,
                    )
                filename = field(b, "filename", 0, 200)
                token = field(b, "analysis_token", 0, 120)
                metadata = None
                if token:
                    analysis = c.execute(
                        "SELECT * FROM photo_analyses WHERE token=? AND created_at>?",
                        (token, time.time() - 86400),
                    ).fetchone()
                    check(
                        analysis and analysis["user_id"] == u["id"],
                        "Photo analysis is unavailable. Check this photo again.",
                    )
                    check(
                        analysis["photo_hash"] == hashlib.sha256(content).hexdigest(),
                        "This analysis belongs to a different photo. Check the selected photo again.",
                    )
                    metadata = analysis_categories(json.loads(analysis["metadata"]))
                if not metadata or not metadata.get("screening"):
                    metadata = inspect_photo(c, u, b["data"])
                check(
                    metadata["screening"]["status"] != "rejected",
                    "This photo was blocked by content safety screening. Replace it with a non-explicit campus photo or submit without a photo.",
                    422,
                )
                if stage == "after":
                    metadata = inspect_completion(c, u, r, b["data"])
                    comparison = metadata["completion_check"]
                    check(
                        comparison["status"] == "supports_completion",
                        "Cannot use this as completion evidence. " + comparison["reason"],
                        503 if comparison["status"] == "unavailable" else 422,
                    )
                metadata = {
                    key: value
                    for key, value in metadata.items()
                    if key not in ("analysis_token", "ai_available")
                }
                metadata.update(
                    stage=stage,
                    evidence_round=r["evidence_round"],
                    office_id=r["office_id"],
                    uploaded_by=u["id"],
                )
                metadata["report_pin"] = (
                    {"latitude": r["latitude"], "longitude": r["longitude"]}
                    if r["latitude"] is not None
                    else None
                )
                aid = insert_id(
                    c,
                    "INSERT INTO attachments(report_id,content,mime,filename,metadata,created_at) VALUES(?,?,?,?,?,?)",
                    (rid, content, mime, filename, json.dumps(metadata), now()),
                )
                audit(c, u["id"], "report.evidence", str(rid))
                self.send(201, {"id": aid})
                return
            if method == "PATCH" and not sub:
                check(u["role"] in ("admin", "validator", "office"), "Staff access required.", 403)
                b = self.body()
                if u["role"] in ("validator", "office"):
                    validator = u["role"] == "validator"
                    allowed = (
                        {"status", "note", "office_id", "assigned_to", "priority"}
                        if validator
                        else {"status", "note"}
                    )
                    check(not set(b) - allowed, "This role cannot change those report fields.", 403)
                    status, note = b.get("status"), field(b, "note", 2, 2000)
                    office, assigned = r["office_id"], r["assigned_to"]
                    priority = r["priority"]
                    if validator:
                        check(
                            r["status"] in ("submitted", "needs_information"),
                            "This concern has already been reviewed.",
                            403,
                        )
                        check(status in ("validated", "rejected"), "Choose valid or not valid.")
                        priority = b.get("priority", r["priority"])
                        check(
                            priority in ("low", "normal", "high", "urgent"),
                            "Choose Low, Normal, High or Urgent.",
                        )
                        office, assigned = b.get("office_id"), b.get("assigned_to")
                        if status == "validated":
                            check(
                                type(office) is int
                                and c.execute(
                                    "SELECT 1 FROM offices WHERE id=?", (office,)
                                ).fetchone(),
                                "Choose a responsible office.",
                            )
                            check(
                                type(assigned) is int
                                and c.execute(
                                    "SELECT 1 FROM users WHERE id=? AND active=1 AND verified=1 AND (role='admin' OR (role='office' AND office_id=?))",
                                    (assigned, office),
                                ).fetchone(),
                                "Choose an active assigned admin for this office or a Main Admin.",
                            )
                        else:
                            office, assigned = None, None
                    else:
                        check(
                            r["status"] in ("validated", "in_progress")
                            and status in ("in_progress", "resolved"),
                            "Office users can start assigned work or mark it resolved. Main Admin handles closure and reopening.",
                            403,
                        )
                        check(
                            status in TRANSITIONS[r["status"]],
                            "Work is already in progress. Use Post update for notes, or Mark work complete when finished.",
                        )
                        check(
                            status != "resolved" or has_completion_evidence(c, r),
                            "Upload an after-work evidence photo before marking this concern resolved.",
                        )
                    c.execute(
                        "UPDATE reports SET status=?,priority=?,office_id=?,assigned_to=?,updated_at=? WHERE id=?",
                        (status, priority, office, assigned, now(), rid),
                    )
                    priority_note = (
                        ("Priority changed from %s to %s. " % (r["priority"], priority))
                        if priority != r["priority"]
                        else ""
                    )
                    event(c, rid, u["id"], "status", status + " — " + priority_note + note)
                    audit(
                        c,
                        u["id"],
                        "report.validated" if validator else "report.progress",
                        str(rid),
                        json.dumps(
                            {
                                "from": r["status"],
                                "to": status,
                                "office_id": office,
                                "assigned_to": assigned,
                                "from_priority": r["priority"],
                                "to_priority": priority,
                            }
                        ),
                    )
                    notify(
                        c,
                        r["reporter_id"],
                        rid,
                        "Report #"
                        + str(rid)
                        + " is now "
                        + status.replace("_", " ")
                        + "."
                        + (" Priority: " + priority + "." if priority != r["priority"] else ""),
                    )
                    if not validator:
                        for coordinator in c.execute(
                            "SELECT id FROM users WHERE role='admin' AND active=1 AND verified=1"
                        ):
                            notify(
                                c,
                                coordinator["id"],
                                rid,
                                "Office progress on "
                                + r["title"]
                                + ": "
                                + status.replace("_", " "),
                            )
                    if validator and status == "validated":
                        recipients = {
                            row["id"]
                            for row in c.execute(
                                "SELECT id FROM users WHERE active=1 AND verified=1 AND (role='admin' OR (role='office' AND office_id=?))",
                                (office,),
                            )
                        }
                        for recipient in recipients:
                            notify(
                                c,
                                recipient,
                                rid,
                                "Validated concern assigned to your office: "
                                + r["title"]
                                + " · Priority: "
                                + priority,
                            )
                    self.send(
                        200,
                        report_json(
                            c,
                            u,
                            c.execute("SELECT * FROM reports WHERE id=?", (rid,)).fetchone(),
                            True,
                        ),
                    )
                    return
                category, categories = (
                    report_categories(b, b.get("category", r["category"]))
                    if "category" in b or "categories" in b
                    else (r["category"], json.loads(r["categories"]))
                )
                status = b.get("status", r["status"])
                check(status in STATUSES, "Invalid status.")
                check(
                    status == r["status"] or status in TRANSITIONS[r["status"]],
                    "This status transition is not allowed.",
                )
                note = field(b, "note", 2, 2000)
                visibility = b.get("visibility", r["visibility"])
                summary = b.get("public_summary", r["public_summary"])
                public_title = b.get("public_title", r["public_title"])
                check(visibility in ("campus", "restricted"), "Invalid visibility.")
                check(
                    isinstance(summary, str) and len(summary) <= 3000, "Public summary is too long."
                )
                check(
                    isinstance(public_title, str) and len(public_title) <= 150,
                    "Public title is too long.",
                )
                check(
                    visibility != "campus" or len(summary.strip()) >= 10,
                    "A reviewed public summary is required for campus visibility.",
                )
                check(
                    visibility != "campus" or len(public_title.strip()) >= 5,
                    "A reviewed public title is required for campus visibility.",
                )
                check(
                    status not in ("submitted", "needs_information", "rejected", "duplicate")
                    or visibility == "restricted",
                    "Unvalidated, rejected, and duplicate reports must stay restricted.",
                )
                priority = b.get("priority", r["priority"])
                check(priority in ("low", "normal", "high", "urgent"), "Invalid priority.")
                office = b.get("office_id", r["office_id"])
                check(
                    office is None
                    or c.execute("SELECT 1 FROM offices WHERE id=?", (office,)).fetchone(),
                    "Invalid office.",
                )
                check(
                    status not in ("validated", "in_progress", "resolved", "closed")
                    or office is not None,
                    "Assign a responsible office before validation.",
                )
                reset_evidence = office != r["office_id"] or (
                    r["status"] in ("resolved", "closed") and status == "in_progress"
                )
                context_report = {
                    **dict(r),
                    "categories": json.dumps(categories),
                    "office_id": office,
                }
                check(
                    status not in ("resolved", "closed")
                    or (not reset_evidence and has_completion_evidence(c, context_report)),
                    "Upload or recheck an after-work photo against the current concern before resolving or closing it.",
                )
                assigned = b.get("assigned_to", r["assigned_to"])
                check(
                    assigned is None
                    or c.execute(
                        "SELECT 1 FROM users WHERE id=? AND active=1 AND verified=1 AND (role='admin' OR (role='office' AND office_id=?))",
                        (assigned, office),
                    ).fetchone(),
                    "Invalid assigned admin.",
                )
                duplicate = b.get("duplicate_of", r["duplicate_of"])
                if status == "duplicate":
                    check(
                        duplicate
                        and duplicate != rid
                        and c.execute(
                            "SELECT 1 FROM reports WHERE id=? AND status IN ('validated','in_progress','resolved','closed')",
                            (duplicate,),
                        ).fetchone(),
                        "Link to an existing validated report.",
                    )
                else:
                    duplicate = None
                c.execute(
                    "UPDATE reports SET category=?,categories=?,status=?,visibility=?,public_summary=?,public_title=?,priority=?,office_id=?,assigned_to=?,duplicate_of=?,updated_at=? WHERE id=?",
                    (
                        category,
                        json.dumps(categories),
                        status,
                        visibility,
                        summary.strip(),
                        public_title.strip(),
                        priority,
                        office,
                        assigned,
                        duplicate,
                        now(),
                        rid,
                    ),
                )
                if reset_evidence:
                    c.execute(
                        "UPDATE reports SET evidence_round=evidence_round+1 WHERE id=?", (rid,)
                    )
                priority_note = (
                    ("Priority changed from %s to %s. " % (r["priority"], priority))
                    if priority != r["priority"]
                    else ""
                )
                category_note = (
                    ("Categories changed to %s. " % ", ".join(categories))
                    if categories != json.loads(r["categories"])
                    else ""
                )
                event(
                    c, rid, u["id"], "status", status + " — " + priority_note + category_note + note
                )
                audit(
                    c,
                    u["id"],
                    "report.updated",
                    str(rid),
                    json.dumps(
                        {
                            "from": r["status"],
                            "to": status,
                            "visibility": visibility,
                            "from_priority": r["priority"],
                            "to_priority": priority,
                            "from_categories": json.loads(r["categories"]),
                            "to_categories": categories,
                        }
                    ),
                )
                message = (
                    "priority is now " + priority
                    if status == r["status"] and priority != r["priority"]
                    else "is now " + status.replace("_", " ")
                )
                notify(c, r["reporter_id"], rid, "Report #" + str(rid) + " " + message + ".")
                if assigned and assigned != u["id"]:
                    notify(c, assigned, rid, "You were assigned: " + r["title"])
                self.send(
                    200,
                    report_json(
                        c, u, c.execute("SELECT * FROM reports WHERE id=?", (rid,)).fetchone(), True
                    ),
                )
                return
        match = re.fullmatch(r"/api/attachments/(\d+)/check", path)
        if method == "POST" and match:
            a = c.execute("SELECT * FROM attachments WHERE id=?", (int(match[1]),)).fetchone()
            check(a, "Not found.", 404)
            r = c.execute("SELECT * FROM reports WHERE id=?", (a["report_id"],)).fetchone()
            check(can_read(u, r), "Not found.", 404)
            metadata = json.loads(a["metadata"])
            check(
                metadata.get("stage") == "after"
                and metadata.get("evidence_round") == r["evidence_round"]
                and metadata.get("office_id") == r["office_id"],
                "Only completion evidence for the current work assignment can be checked.",
                403,
            )
            result = inspect_completion(
                c, u, r, base64.b64encode(a["content"]).decode(), force=True, attachment_id=a["id"]
            )
            metadata.update(
                completion_check=result["completion_check"],
                completion_context=result["completion_context"],
                screening=result["screening"],
            )
            c.execute(
                "UPDATE attachments SET metadata=? WHERE id=?", (json.dumps(metadata), a["id"])
            )
            audit(
                c,
                u["id"],
                "evidence.relevance_checked",
                str(a["id"]),
                result["completion_check"]["status"],
            )
            self.send(200, result["completion_check"])
            return
        match = re.fullmatch(r"/api/attachments/(\d+)", path)
        if method == "GET" and match:
            a = c.execute("SELECT * FROM attachments WHERE id=?", (int(match[1]),)).fetchone()
            check(a, "Not found.", 404)
            r = c.execute("SELECT * FROM reports WHERE id=?", (a["report_id"],)).fetchone()
            check(
                can_read(u, r) and (u["role"] != "student" or r["reporter_id"] == u["id"]),
                "Not found.",
                404,
            )
            self.send(200, a["content"], a["mime"])
            return
        if path == "/api/notifications/read" and method == "POST":
            c.execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (u["id"],))
            self.send(200, {"ok": True})
            return
        if path.startswith("/api/admin/"):
            check(u["role"] == "admin", "Main Admin access required.", 403)
            if path == "/api/admin/users" and method == "GET":
                self.send(
                    200,
                    [
                        user_json(x)
                        for x in c.execute("SELECT * FROM users ORDER BY verified,created_at DESC")
                    ],
                )
                return
            match = re.fullmatch(r"/api/admin/users/(\d+)", path)
            if match and method == "PATCH":
                target_id = int(match[1])
                target = c.execute("SELECT * FROM users WHERE id=?", (target_id,)).fetchone()
                check(target, "User not found.", 404)
                check(target_id != u["id"], "You cannot change your own access.")
                b = self.body()
                role = b.get("role", target["role"])
                verified, active = (
                    b.get("verified", target["verified"]),
                    b.get("active", target["active"]),
                )
                check(
                    role in ROLES
                    and type(verified) in (int, bool)
                    and verified in (0, 1)
                    and type(active) in (int, bool)
                    and active in (0, 1),
                    "Invalid access settings.",
                )
                office = b.get("office_id", target["office_id"]) if role == "office" else None
                check(
                    role != "office"
                    or (
                        type(office) is int
                        and c.execute("SELECT 1 FROM offices WHERE id=?", (office,)).fetchone()
                    ),
                    "Choose an office for this account.",
                )
                c.execute(
                    "UPDATE users SET role=?,verified=?,active=?,office_id=? WHERE id=?",
                    (role, int(verified), int(active), office, target_id),
                )
                c.execute("DELETE FROM sessions WHERE user_id=?", (target_id,))
                audit(
                    c,
                    u["id"],
                    "user.access_changed",
                    str(target_id),
                    json.dumps(
                        {"role": role, "verified": verified, "active": active, "office_id": office}
                    ),
                )
                self.send(200, {"ok": True})
                return
            if path == "/api/admin/routing" and method == "PATCH":
                b = self.body()
                check(
                    b.get("category") in CATEGORIES
                    and c.execute(
                        "SELECT 1 FROM offices WHERE id=?", (b.get("office_id"),)
                    ).fetchone(),
                    "Invalid routing.",
                )
                c.execute(
                    "UPDATE routing SET office_id=? WHERE category=?",
                    (b["office_id"], b["category"]),
                )
                audit(c, u["id"], "routing.changed", b["category"], str(b["office_id"]))
                self.send(200, {"ok": True})
                return
            if path == "/api/admin/audit" and method == "GET":
                self.send(
                    200,
                    [
                        dict(x)
                        for x in c.execute(
                            "SELECT a.*,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200"
                        )
                    ],
                )
                return
        raise APIError(404, "Endpoint not found.")


def create_account(
    email, name, role, password, affiliation="Staff", demo=False, office_id=None, connect_db=None
):
    check(role in ROLES, "Invalid role.")
    check(len(password) >= 12, "Use a password of at least 12 characters.")
    with (connect_db or connect)() as c:
        check(
            role != "office"
            or (
                type(office_id) is int
                and c.execute("SELECT 1 FROM offices WHERE id=?", (office_id,)).fetchone()
            ),
            "Office accounts need a valid office.",
        )
        uid = insert_id(
            c,
            "INSERT INTO users(name,email,password,role,affiliation,verified,created_at) VALUES(?,?,?,?,?,1,?)",
            (name, email.lower(), password_hash(password), role, affiliation, now()),
        )
        if role == "office":
            c.execute("UPDATE users SET office_id=? WHERE id=?", (office_id, uid))
        if demo:
            c.execute("UPDATE users SET is_demo=1 WHERE id=?", (uid,))
        audit(c, uid, "account.bootstrapped", str(uid), role)
        return uid


def ensure_demo_accounts(connect_db=None):
    """Add missing sample identities without changing existing accounts or reports."""
    check(
        not DATABASE_URL or connect_db is not None,
        "Demo accounts require an isolated demo database.",
    )
    factory = connect_db or connect
    with factory() as c:
        check(
            getattr(c, "schema", None) in (None, DEMO_SCHEMA),
            "Cannot seed regular Postgres tables.",
        )
    for email, name, role, affiliation in (
        ("admin@iitvoice.local", "Morgan Lee", "admin", "Staff"),
        ("validator@iitvoice.local", "Sam Cruz", "validator", "Staff"),
        ("student@iitvoice.local", "Alex Reyes", "student", "Student"),
        ("faculty@iitvoice.local", "Jamie Santos", "student", "Faculty"),
    ):
        with factory() as c:
            exists = c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone()
        if not exists:
            create_account(
                email,
                name,
                role,
                secrets.token_urlsafe(24),
                affiliation,
                demo=True,
                connect_db=factory,
            )
    ensure_office_demos(connect_db=factory)


def ensure_office_demos(password=None, connect_db=None):
    with (connect_db or connect)() as c:
        if not c.execute(
            "SELECT 1 FROM users WHERE is_demo=1 AND email='admin@iitvoice.local'"
        ).fetchone():
            return
        for email, name, office in [
            ("plant@iitvoice.local", "Physical Plant Demo", "Physical Plant"),
            ("ict@iitvoice.local", "ICT Demo", "ICT"),
        ]:
            if not c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                office_id = c.execute("SELECT id FROM offices WHERE name=?", (office,)).fetchone()[
                    "id"
                ]
                c.execute(
                    "INSERT INTO users(name,email,password,role,affiliation,verified,active,created_at,is_demo,office_id) VALUES(?,?,?,'office','Staff',1,1,?,1,?)",
                    (
                        name,
                        email,
                        password_hash(password or secrets.token_urlsafe(20)),
                        now(),
                        office_id,
                    ),
                )


def seed_demo():
    with connect() as c:
        check(
            c.execute("SELECT count(*) AS count FROM users").fetchone()["count"] == 0,
            "Demo seeding requires an empty database.",
        )
    password = secrets.token_urlsafe(15)
    admin = create_account("admin@iitvoice.local", "Morgan Lee", "admin", password, demo=True)
    validator = create_account(
        "validator@iitvoice.local", "Sam Cruz", "validator", password, demo=True
    )
    student = create_account(
        "student@iitvoice.local", "Alex Reyes", "student", password, "Student", demo=True
    )
    create_account(
        "faculty@iitvoice.local", "Jamie Santos", "student", password, "Faculty", demo=True
    )
    ensure_office_demos(password)
    examples = [
        (
            "Ceiling leak near classroom",
            "Water drips near the classroom entrance after heavy rain. The wet flooring may cause slipping.",
            "Repair & maintenance",
            "Academic building · Floor 2",
            8.242,
            124.243,
            "high",
            "in_progress",
            "campus",
            2,
        ),
        (
            "Walkway lighting outage",
            "Several walkway lights are not working during the evening. Please inspect the electrical supply.",
            "Safety",
            "Campus walkway",
            8.241,
            124.2428,
            "urgent",
            "submitted",
            "restricted",
            1,
        ),
        (
            "Unstable Wi-Fi connection",
            "The campus network frequently disconnects while studying in the reading area.",
            "Student needs",
            "Library · Reading area",
            8.2414,
            124.2435,
            "normal",
            "submitted",
            "restricted",
            4,
        ),
        (
            "Water dispenser restored",
            "The dispenser stopped providing drinking water. Replacement parts have now been installed.",
            "Student needs",
            "Student services area",
            8.2422,
            124.2424,
            "normal",
            "resolved",
            "campus",
            3,
        ),
    ]
    with connect() as c:
        for (
            title,
            description,
            cat,
            loc,
            lat,
            lng,
            priority,
            status,
            visibility,
            office,
        ) in examples:
            cat, categories = normalize_categories(cat, [cat])
            stamp = now()
            rid = insert_id(
                c,
                "INSERT INTO reports(reporter_id,title,description,category,location,latitude,longitude,priority,status,visibility,public_summary,office_id,assigned_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    student,
                    title,
                    description,
                    cat,
                    loc,
                    lat,
                    lng,
                    priority,
                    status,
                    visibility,
                    description if visibility == "campus" else "",
                    office,
                    c.execute(
                        "SELECT id FROM users WHERE role='office' AND office_id=?", (office,)
                    ).fetchone()["id"]
                    if office in (2, 4)
                    else admin,
                    stamp,
                    stamp,
                ),
            )
            c.execute(
                "UPDATE reports SET public_title=?,categories=? WHERE id=?",
                (title if visibility == "campus" else "", json.dumps(categories), rid),
            )
            event(c, rid, student, "created", "Report submitted for review.")
            if status != "submitted":
                event(
                    c,
                    rid,
                    admin,
                    "status",
                    status
                    + " — "
                    + (
                        "Initial inspection completed. Repair is scheduled."
                        if status == "in_progress"
                        else "Service restored. Please confirm the issue is fixed."
                    ),
                )
            notify(c, student, rid, "Demo report: " + title)
    print("Demo accounts created. Password for all demo accounts: " + password)
    print(
        "admin@iitvoice.local | validator@iitvoice.local | student@iitvoice.local | faculty@iitvoice.local"
    )
    print("These are sample accounts, locations, and concerns. They are not university records.")


def main():
    global DEMO_LOGIN, DATABASE_URL, DATA, DB
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--demo-login",
        action="store_true",
        help="Enable one-click sample account sign-in on loopback only",
    )
    parser.add_argument("--seed-demo", action="store_true")
    parser.add_argument(
        "--init-db", action="store_true", help="Initialize database tables and routing, then exit"
    )
    parser.add_argument("--create-admin", metavar="EMAIL")
    args = parser.parse_args()
    DEMO_LOGIN = DEMO_LOGIN or args.demo_login
    if DEMO_LOGIN and args.host not in ("127.0.0.1", "localhost", "::1"):
        parser.error(
            "Demo sign-in requires a loopback host. Disable IIT_VOICE_DEMO_LOGIN for public hosting."
        )
    if DEMO_LOGIN and not (args.init_db or args.create_admin or args.seed_demo):
        # Demo sessions must never grant access to the configured live Supabase database.
        DATABASE_URL = ""
        DATA = Path(os.environ.get("IIT_VOICE_DATA", str(ROOT / "data" / "demo")))
        DB = DATA / "iit-voice.sqlite3"
    initialize()
    if args.init_db:
        print("Database initialized: " + ("Supabase Postgres" if DATABASE_URL else "local SQLite"))
        return
    if args.seed_demo:
        seed_demo()
        return
    if args.create_admin:
        import getpass

        create_account(
            args.create_admin,
            input("Name: ").strip(),
            "admin",
            getpass.getpass("Password (12+ characters): "),
        )
        print("Main Admin created.")
        return
    if DEMO_LOGIN:
        ensure_demo_accounts()
    print("IIT Voice running at http://%s:%s" % (args.host, args.port))
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
