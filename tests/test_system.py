"""End-to-end HTTP tests against an isolated SQLite database."""

import base64
import http.cookiejar
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

# Integration tests always use disposable SQLite, even when local cloud settings exist.
server.DATABASE_URL = ""
from test_photo_analysis import sample_photo


class Client:
    def __init__(self, base):
        self.base, self.csrf = base, ""
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, method="GET", body=None, csrf=True, extra_headers=None):
        headers = {"Content-Type": "application/json"}
        if csrf:
            headers["X-CSRF-Token"] = self.csrf
        headers.update(extra_headers or {})
        req = Request(
            self.base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
            method=method,
        )
        try:
            result = self.opener.open(req)
        except HTTPError as e:
            result = e
        payload = result.read()
        data = (
            json.loads(payload)
            if result.headers.get_content_type() == "application/json"
            else payload
        )
        return result.code, data

    def login(self, email):
        status, result = self.request(
            "/api/login", "POST", {"email": email, "password": "test-password-for-iit-voice"}
        )
        assert status == 200, result
        self.csrf = result["csrf"]
        return result["user"]


class SchemaMigrationTests(unittest.TestCase):
    def test_role_upgrade_preserves_accounts_passwords_sessions_and_report_references(self):
        original_data, original_db = server.DATA, server.DB
        with tempfile.TemporaryDirectory() as directory:
            try:
                server.DATA, server.DB = Path(directory), Path(directory) / "migration.sqlite3"
                server.initialize()
                uid = server.create_account(
                    "migration@test.local",
                    "Existing Student",
                    "student",
                    "test-password-for-iit-voice",
                    "Student",
                    demo=True,
                )
                with server.connect() as c:
                    stamp = server.now()
                    rid = c.execute(
                        "INSERT INTO reports(reporter_id,title,description,category,location,created_at,updated_at) VALUES(?, 'Existing report','Existing private description','Safety','Campus',?,?)",
                        (uid, stamp, stamp),
                    ).lastrowid
                    c.execute(
                        "INSERT INTO attachments(report_id,content,mime,created_at) VALUES(?,?,'image/jpeg',?)",
                        (rid, base64.b64decode(sample_photo()), stamp),
                    )
                    server.event(c, rid, uid, "created", "Existing history")
                    c.execute(
                        "INSERT INTO sessions VALUES(?,?,?,?)",
                        ("old-session-hash", uid, "old-csrf", server.time.time() + 1000),
                    )
                    password = c.execute(
                        "SELECT password FROM users WHERE id=?", (uid,)
                    ).fetchone()[0]
                    schema = c.execute(
                        "SELECT sql FROM sqlite_master WHERE name='users'"
                    ).fetchone()[0]
                    old_schema = schema.replace(
                        "('student','validator','admin','office')",
                        "('student','validator','admin')",
                    ).replace("CREATE TABLE users", "CREATE TABLE users_old")
                    c.commit()
                    c.execute("PRAGMA foreign_keys=OFF")
                    c.execute("BEGIN IMMEDIATE")
                    c.execute(old_schema)
                    c.execute("INSERT INTO users_old SELECT * FROM users")
                    c.execute("DROP TABLE users")
                    c.execute("ALTER TABLE users_old RENAME TO users")
                    c.commit()
                server.initialize()
                server.initialize()
                office_uid = server.create_account(
                    "office-migration@test.local",
                    "New Office",
                    "office",
                    "test-password-for-iit-voice",
                    office_id=2,
                )
                with server.connect() as c:
                    self.assertEqual(
                        c.execute("SELECT password FROM users WHERE id=?", (uid,)).fetchone()[0],
                        password,
                    )
                    self.assertEqual(
                        c.execute("SELECT is_demo FROM users WHERE id=?", (uid,)).fetchone()[0], 1
                    )
                    self.assertEqual(
                        c.execute("SELECT reporter_id FROM reports WHERE id=?", (rid,)).fetchone()[
                            0
                        ],
                        uid,
                    )
                    self.assertEqual(c.execute("SELECT user_id FROM sessions").fetchone()[0], uid)
                    self.assertEqual(c.execute("SELECT count(*) FROM attachments").fetchone()[0], 1)
                    self.assertEqual(c.execute("SELECT actor_id FROM events").fetchone()[0], uid)
                    self.assertEqual(
                        c.execute(
                            "SELECT office_id FROM users WHERE id=?", (office_uid,)
                        ).fetchone()[0],
                        2,
                    )
                    self.assertEqual(c.execute("PRAGMA foreign_key_check").fetchall(), [])
            finally:
                server.DATA, server.DB = original_data, original_db


class SystemTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.DATA = Path(cls.temp.name)
        server.DB = server.DATA / "test.sqlite3"
        server.initialize()
        for email, role in [
            ("admin@test.local", "admin"),
            ("validator@test.local", "validator"),
            ("student@test.local", "student"),
            ("other@test.local", "student"),
        ]:
            server.create_account(
                email,
                email.split("@")[0],
                role,
                "test-password-for-iit-voice",
                "Student" if role == "student" else "Staff",
            )
        server.create_account(
            "plant@test.local", "Plant Admin", "office", "test-password-for-iit-voice", office_id=2
        )
        server.create_account(
            "ict@test.local", "ICT Admin", "office", "test-password-for-iit-voice", office_id=4
        )
        cls.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:" + str(cls.http.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def test_health_does_not_wait_for_the_cloud_database(self):
        with patch("server.connect", side_effect=RuntimeError("Database unavailable")):
            status, result = Client(self.base).request("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(result, {"ok": True})

    def setUp(self):
        demo_patch = patch("server.DEMO_LOGIN", False)
        demo_patch.start()
        self.addCleanup(demo_patch.stop)
        self.ai_patch = patch(
            "server.suggest_category",
            return_value={
                "category": "Safety, Security & Risk",
                "title": "Visible campus hazard",
                "reason": "Test evidence.",
                "screening": {"status": "appropriate", "reason": "Plausible campus evidence."},
            },
        )
        self.ai = self.ai_patch.start()
        self.addCleanup(self.ai_patch.stop)
        completion_patch = patch(
            "server.assess_completion",
            return_value={
                "status": "supports_completion",
                "reason": "The same reported subject is shown with the visible defect repaired.",
            },
        )
        self.completion_ai = completion_patch.start()
        self.addCleanup(completion_patch.stop)
        env_patch = patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"})
        env_patch.start()
        self.addCleanup(env_patch.stop)
        with server.connect() as c:
            c.execute("DELETE FROM photo_analyses")
            c.execute("DELETE FROM login_limits WHERE key LIKE 'photo-ai:%'")
        self.student, self.other, self.validator, self.admin = [Client(self.base) for _ in range(4)]
        self.student.login("student@test.local")
        self.other.login("other@test.local")
        self.validator.login("validator@test.local")
        self.admin.login("admin@test.local")
        self.plant, self.ict = Client(self.base), Client(self.base)
        self.plant_user = self.plant.login("plant@test.local")
        self.ict_user = self.ict.login("ict@test.local")

    def report(self, **extra):
        status, result = self.student.request(
            "/api/reports",
            "POST",
            {
                "title": "<script>Broken light</script>",
                "description": "The light is broken. Reporter private details.",
                "category": "Safety, Security & Risk",
                "location": "Campus walkway",
                "latitude": 8.2415,
                "longitude": 124.243,
                **extra,
            },
        )
        self.assertEqual(status, 201, result)
        return result["id"]

    def review(self, rid, **extra):
        return self.admin.request(
            "/api/reports/" + str(rid),
            "PATCH",
            {
                "status": "validated",
                "visibility": "campus",
                "public_title": "Broken walkway light",
                "public_summary": "Walkway light needs repair.",
                "office_id": 1,
                "note": "Location verified and assigned.",
                **extra,
            },
        )

    def test_registration_cannot_grant_admin_and_requires_verification(self):
        client = Client(self.base)
        status, result = client.request(
            "/api/register",
            "POST",
            {
                "name": "Pending Person",
                "email": "pending@test.local",
                "password": "test-password-for-iit-voice",
                "affiliation": "Student",
                "role": "admin",
                "verified": 1,
            },
        )
        self.assertEqual(status, 201, result)
        status, result = client.request(
            "/api/login",
            "POST",
            {"email": "pending@test.local", "password": "test-password-for-iit-voice"},
        )
        self.assertEqual(status, 403)
        status, users = self.admin.request("/api/admin/users")
        pending = next(u for u in users if u["email"] == "pending@test.local")
        self.assertEqual(pending["role"], "student")
        self.assertEqual(pending["verified"], 0)
        status, _ = self.admin.request(
            "/api/admin/users/" + str(pending["id"]), "PATCH", {"verified": 1}
        )
        self.assertEqual(status, 200)
        client.login("pending@test.local")
        self.assertEqual(client.request("/api/admin/users")[0], 403)

    def test_role_and_csrf_enforcement(self):
        self.assertEqual(self.student.request("/api/admin/users")[0], 403)
        self.assertEqual(self.validator.request("/api/admin/users")[0], 403)
        self.assertEqual(self.validator.request("/api/admin/audit")[0], 403)
        self.assertEqual(
            self.student.request("/api/reports", "POST", {"title": "Test"}, csrf=False)[0], 403
        )
        self.assertEqual(Client(self.base).request("/api/bootstrap")[0], 401)
        rid = self.report()
        self.assertEqual(
            self.student.request("/api/reports/" + str(rid), "PATCH", {"status": "validated"})[0],
            403,
        )

    def test_auth_rejects_other_origins_and_accepts_same_origin(self):
        credentials = {"email": "student@test.local", "password": "test-password-for-iit-voice"}
        client = Client(self.base)
        self.assertEqual(
            client.request(
                "/api/login", "POST", credentials, extra_headers={"Origin": "https://other.example"}
            )[0],
            403,
        )
        self.assertEqual(
            client.request(
                "/api/register", "POST", {}, extra_headers={"Origin": "https://other.example"}
            )[0],
            403,
        )
        self.assertEqual(
            client.request("/api/login", "POST", credentials, extra_headers={"Origin": self.base})[
                0
            ],
            200,
        )

    def test_demo_sign_in_is_opt_in_local_and_uses_existing_permissions(self):
        client = Client(self.base)
        self.assertEqual(client.request("/api/demo/accounts")[1], {"accounts": []})
        self.assertEqual(client.request("/api/demo/login", "POST", {"account_id": 1})[0], 403)
        staff_id = server.create_account(
            "demo-staff@test.local",
            "Demo Staff",
            "student",
            "test-password-for-iit-voice",
            "Staff",
            demo=True,
        )
        with server.connect() as c:
            student_id = c.execute(
                "SELECT id FROM users WHERE email='student@test.local'"
            ).fetchone()[0]
            other_id = c.execute("SELECT id FROM users WHERE email='other@test.local'").fetchone()[
                0
            ]
            c.execute("UPDATE users SET is_demo=1 WHERE id=?", (student_id,))
        with patch("server.DEMO_LOGIN", True):
            accounts = client.request("/api/demo/accounts")[1]["accounts"]
            self.assertEqual({a["id"] for a in accounts}, {student_id, staff_id})
            self.assertNotIn("password", json.dumps(accounts))
            self.assertNotIn("email", json.dumps(accounts))
            code, session = client.request(
                "/api/demo/login", "POST", {"account_id": student_id, "role": "admin"}
            )
            self.assertEqual(code, 200)
            self.assertEqual(session["user"]["role"], "student")
            client.csrf = session["csrf"]
            self.assertEqual(client.request("/api/me")[0], 200)
            self.assertEqual(client.request("/api/admin/users")[0], 403)
            self.assertEqual(client.request("/api/logout", "POST", {})[0], 200)
            self.assertEqual(
                client.request("/api/demo/login", "POST", {"account_id": other_id})[0], 404
            )
            self.assertEqual(
                client.request(
                    "/api/demo/login",
                    "POST",
                    {"account_id": student_id},
                    extra_headers={"Origin": "https://other.example"},
                )[0],
                403,
            )
            self.assertEqual(
                client.request(
                    "/api/demo/login",
                    "POST",
                    {"account_id": student_id},
                    extra_headers={"Host": "public.example"},
                )[0],
                403,
            )
            self.assertEqual(
                client.request("/api/demo/accounts", extra_headers={"Host": "public.example"})[1][
                    "accounts"
                ],
                [],
            )
            with patch("server.ipaddress.ip_address") as address:
                address.return_value.is_loopback = False
                self.assertEqual(
                    client.request("/api/demo/login", "POST", {"account_id": student_id})[0], 403
                )
            with server.connect() as c:
                c.execute("UPDATE users SET active=0 WHERE id=?", (staff_id,))
            self.assertEqual(
                client.request("/api/demo/login", "POST", {"account_id": staff_id})[0], 403
            )
            self.assertNotIn(
                staff_id, [a["id"] for a in client.request("/api/demo/accounts")[1]["accounts"]]
            )
            with server.connect() as c:
                c.execute("UPDATE users SET active=1,verified=0 WHERE id=?", (staff_id,))
            self.assertEqual(
                client.request("/api/demo/login", "POST", {"account_id": staff_id})[0], 403
            )

    def test_photo_inspection_is_private_automatic_and_cached(self):
        body = {"data": sample_photo({1: "N", 2: (8, 14, 30), 3: "E", 4: (124, 14, 38)})}
        self.assertEqual(Client(self.base).request("/api/photos/inspect", "POST", body)[0], 401)
        self.assertEqual(
            self.student.request("/api/photos/inspect", "POST", body, csrf=False)[0], 403
        )
        code, result = self.student.request("/api/photos/inspect", "POST", body)
        self.assertEqual(code, 200)
        self.assertEqual(result["gps"]["latitude"], 8.241667)
        self.assertEqual(result["screening"]["status"], "appropriate")
        self.ai.assert_called_once()
        self.student.request("/api/photos/inspect", "POST", body)
        self.ai.assert_called_once()
        self.student.request("/api/photos/inspect", "POST", {**body, "analyze": True})
        self.assertEqual(self.ai.call_count, 2)
        self.assertEqual(
            self.student.request("/api/photos/inspect", "POST", {"data": "bad"})[0], 400
        )

    def test_evidence_preserves_server_analysis_and_protects_metadata(self):
        photo = sample_photo({1: "N", 2: (8, 14, 30), 3: "E", 4: (124, 14, 38)})
        with patch(
            "server.suggest_category",
            return_value={
                "category": "Safety, Security & Risk",
                "reason": "Visible hazard.",
                "title": "Blocked fire exit",
                "description": "An obstruction is visible across the fire exit.",
                "screening": {"status": "appropriate", "reason": "Campus hazard."},
            },
        ):
            code, result = self.student.request(
                "/api/photos/inspect", "POST", {"data": photo, "analyze": True}
            )
        self.assertEqual(code, 200)
        token = result["analysis_token"]
        rid = self.report()
        path = "/api/reports/" + str(rid)
        upload = {"data": photo, "filename": "exit-photo.jpg", "analysis_token": token}
        self.assertEqual(self.validator.request(path + "/attachments", "POST", upload)[0], 403)
        self.assertEqual(
            self.student.request(path + "/attachments", "POST", {**upload, "data": sample_photo()})[
                0
            ],
            400,
        )
        self.assertEqual(self.student.request(path + "/attachments", "POST", upload)[0], 201)
        evidence = self.validator.request(path)[1]["attachments"][0]
        self.assertEqual(evidence["filename"], "exit-photo.jpg")
        self.assertEqual(evidence["metadata"]["title"], "Blocked fire exit")
        self.assertEqual(
            evidence["metadata"]["description"], "An obstruction is visible across the fire exit."
        )
        self.assertEqual(evidence["metadata"]["category"], "Safety, Security & Risk")
        self.assertEqual(evidence["metadata"]["gps"]["latitude"], 8.241667)
        self.assertEqual(evidence["metadata"]["report_pin"]["latitude"], 8.2415)
        self.assertEqual(
            self.student.request(
                path + "/attachments",
                "POST",
                {
                    "data": photo,
                    "filename": "manual.jpg",
                    "category": "Safety, Security & Risk",
                    "title": "Forged AI title",
                },
            )[0],
            201,
        )
        self.assertEqual(
            self.validator.request(path)[1]["attachments"][1]["metadata"]["title"],
            "Blocked fire exit",
        )
        self.assertEqual(self.review(rid)[0], 200)
        self.assertEqual(self.other.request(path)[1]["attachments"], [])

    def test_blocked_photo_cannot_bypass_server_screening(self):
        path = "/api/reports/" + str(self.report())
        self.ai.return_value = {
            "category": None,
            "title": None,
            "reason": "",
            "screening": {"status": "rejected", "reason": "Blocked by content screening."},
        }
        photo = sample_photo()
        # A direct upload cannot supply a forged clearance or skip screening.
        code, _ = self.student.request(
            path + "/attachments", "POST", {"data": photo, "screening": {"status": "appropriate"}}
        )
        self.assertEqual(code, 422)
        code, result = self.student.request("/api/photos/inspect", "POST", {"data": photo})
        self.assertEqual(result["screening"]["status"], "rejected")
        code, _ = self.student.request(
            path + "/attachments",
            "POST",
            {"data": photo, "analysis_token": result["analysis_token"]},
        )
        self.assertEqual(code, 422)
        self.assertEqual(self.validator.request(path)[1]["attachments"], [])
        with server.connect() as c:
            self.assertEqual(
                c.execute(
                    "SELECT count(*) FROM attachments WHERE report_id=?",
                    (int(path.split("/")[-1]),),
                ).fetchone()[0],
                0,
            )
        self.ai.assert_called_once()  # Cached rejection also blocks re-upload.

    def test_questionable_photo_is_saved_for_private_manual_review(self):
        self.ai.return_value = {
            "category": None,
            "title": None,
            "reason": "",
            "screening": {"status": "needs_review", "reason": "Relevance is unclear."},
        }
        rid = self.report()
        path = "/api/reports/" + str(rid)
        self.assertEqual(
            self.student.request(path + "/attachments", "POST", {"data": sample_photo()})[0], 201
        )
        metadata = self.validator.request(path)[1]["attachments"][0]["metadata"]
        self.assertEqual(metadata["screening"]["status"], "needs_review")
        self.assertEqual(metadata["screening"]["reason"], "Relevance is unclear.")
        self.assertEqual(self.review(rid)[0], 200)
        self.assertEqual(self.other.request(path)[1]["attachments"], [])

    def test_ai_failure_is_unverified_and_retry_can_clear_it(self):
        photo = sample_photo()
        path = "/api/reports/" + str(self.report())
        with patch(
            "server.suggest_category", side_effect=RuntimeError("Gemini quota reached.")
        ) as ai:
            code, result = self.student.request("/api/photos/inspect", "POST", {"data": photo})
            self.assertEqual(code, 200)
            self.assertEqual(result["screening"]["status"], "unverified")
            self.assertIsNone(result["category"])
            self.assertEqual(
                self.student.request(path + "/attachments", "POST", {"data": photo})[0], 201
            )
            ai.assert_called_once()
        self.assertEqual(
            self.validator.request(path)[1]["attachments"][0]["metadata"]["screening"]["status"],
            "unverified",
        )
        result = self.student.request(
            "/api/photos/inspect", "POST", {"data": photo, "analyze": True}
        )[1]
        self.assertEqual(result["screening"]["status"], "appropriate")

    def test_rate_limit_never_marks_an_unscreened_photo_as_safe(self):
        with server.connect() as c:
            uid = c.execute("SELECT id FROM users WHERE email='student@test.local'").fetchone()[0]
            c.execute(
                "INSERT INTO login_limits VALUES(?,20,?)",
                ("photo-ai:" + str(uid), server.time.time()),
            )
        result = self.student.request("/api/photos/inspect", "POST", {"data": sample_photo()})[1]
        self.assertEqual(result["screening"]["status"], "unverified")
        self.assertIn("limit reached", result["ai_error"])
        self.ai.assert_not_called()

    def test_multiple_categories_are_validated_saved_and_reclassified(self):
        primary = "Facilities, Infrastructure & Maintenance"
        safety = "Safety, Security & Risk"
        digital = "ICT, Internet & Digital Services"
        rid = self.report(category=primary, categories=[primary, safety, digital, safety])
        path = "/api/reports/" + str(rid)
        detail = self.validator.request(path)[1]
        self.assertEqual(detail["categories"], [primary, safety, digital])
        self.assertEqual(detail["category"], primary)
        code, _ = self.admin.request(
            path,
            "PATCH",
            {
                "category": safety,
                "categories": [safety, digital],
                "note": "Hazard and connectivity impact verified.",
            },
        )
        self.assertEqual(code, 200)
        detail = self.student.request(path)[1]
        self.assertEqual(detail["categories"], [safety, digital])
        self.assertEqual(detail["category"], safety)
        self.assertIn("Categories changed", detail["events"][-1]["message"])
        self.assertEqual(
            self.student.request(
                path, "PATCH", {"categories": [primary], "note": "Change categories"}
            )[0],
            403,
        )
        self.assertEqual(self.review(rid)[0], 200)
        self.assertEqual(self.other.request(path)[1]["categories"], [safety, digital])
        boot = self.validator.request("/api/bootstrap")[1]
        self.assertEqual(len(boot["categories"]), 9)
        self.assertEqual(len(boot["category_groups"]), 3)
        self.assertEqual(len([report for report in boot["reports"] if report["id"] == rid]), 1)

    def test_invalid_category_arrays_cannot_change_a_report(self):
        rid = self.report()
        path = "/api/reports/" + str(rid)
        for categories in ("Safety", None, ["Invented"], [{"category": "Safety"}], ["Safety"] * 10):
            self.assertEqual(
                self.student.request(
                    "/api/reports",
                    "POST",
                    {
                        "title": "Invalid categories",
                        "description": "Invalid test categories must be rejected.",
                        "location": "Library",
                        "category": "Safety",
                        "categories": categories,
                    },
                )[0],
                400,
            )
            self.assertEqual(
                self.admin.request(
                    path, "PATCH", {"categories": categories, "note": "Invalid categories check."}
                )[0],
                400,
            )
        self.assertEqual(self.student.request(path)[1]["categories"], ["Safety, Security & Risk"])

    def test_existing_category_names_and_custom_routing_migrate_idempotently(self):
        rid = self.report()
        with server.connect() as c:
            c.execute(
                "UPDATE reports SET category='Safety',categories='[]',office_id=2 WHERE id=?",
                (rid,),
            )
            c.execute("DELETE FROM routing WHERE category='Safety, Security & Risk'")
            c.execute("INSERT INTO routing VALUES('Safety',4)")
        server.initialize()
        server.initialize()
        detail = self.student.request("/api/reports/" + str(rid))[1]
        self.assertEqual(detail["category"], "Safety, Security & Risk")
        self.assertEqual(detail["categories"], ["Safety, Security & Risk"])
        self.assertEqual(detail["office_id"], 2)
        with server.connect() as c:
            self.assertEqual(
                c.execute(
                    "SELECT office_id FROM routing WHERE category='Safety, Security & Risk'"
                ).fetchone()[0],
                4,
            )
            self.assertEqual(c.execute("SELECT count(*) FROM routing").fetchone()[0], 9)
            self.assertEqual(
                c.execute("SELECT count(*) FROM routing WHERE category='Safety'").fetchone()[0], 0
            )

    def test_report_order_is_submission_time_not_last_update(self):
        older, newer = self.report(), self.report()
        with server.connect() as c:
            c.execute(
                "UPDATE reports SET created_at='2026-10-01T00:00:00+00:00',updated_at='2026-10-14T00:00:00+00:00' WHERE id=?",
                (older,),
            )
            c.execute(
                "UPDATE reports SET created_at='2026-10-12T00:00:00+00:00',updated_at='2026-10-12T00:00:00+00:00' WHERE id=?",
                (newer,),
            )
        reports = self.student.request("/api/bootstrap")[1]["reports"]
        ids = [report["id"] for report in reports]
        self.assertLess(ids.index(newer), ids.index(older))

    def validate_for(self, rid, office, assigned):
        return self.validator.request(
            "/api/reports/" + str(rid),
            "PATCH",
            {
                "status": "validated",
                "office_id": office,
                "assigned_to": assigned,
                "note": "Concern verified and assigned for action.",
            },
        )

    def test_validator_only_validates_and_requires_office_and_admin(self):
        rid = self.report()
        path = "/api/reports/" + str(rid)
        base = {
            "status": "validated",
            "note": "Evidence verified.",
            "office_id": 2,
            "assigned_to": self.plant_user["id"],
        }
        for field, value in [
            ("category", "Safety"),
            ("visibility", "campus"),
            ("public_summary", "Unreviewed summary"),
            ("duplicate_of", 1),
        ]:
            self.assertEqual(self.validator.request(path, "PATCH", {**base, field: value})[0], 403)
        self.assertEqual(
            self.validator.request(path, "PATCH", {**base, "assigned_to": None})[0], 400
        )
        self.assertEqual(self.validator.request(path, "PATCH", {**base, "office_id": None})[0], 400)
        self.assertEqual(self.validate_for(rid, 2, self.ict_user["id"])[0], 400)
        validator_id = self.validator.request("/api/me")[1]["user"]["id"]
        self.assertEqual(self.validate_for(rid, 2, validator_id)[0], 400)
        self.assertEqual(self.validator.request("/api/reports", "POST", {})[0], 403)
        self.assertEqual(
            self.validator.request(path + "/comments", "POST", {"message": "Not allowed"})[0], 403
        )
        self.assertEqual(
            self.validator.request(path + "/attachments", "POST", {"data": sample_photo()})[0], 403
        )
        self.assertEqual(
            self.validator.request("/api/photos/inspect", "POST", {"data": sample_photo()})[0], 403
        )
        self.assertEqual(self.validate_for(rid, 2, self.plant_user["id"])[0], 200)
        self.assertEqual(self.student.request(path)[1]["priority"], "normal")
        self.assertEqual(self.student.request(path)[1]["visibility"], "restricted")
        self.assertEqual(self.validator.request(path, "PATCH", base)[0], 403)
        invalid = self.report()
        self.assertEqual(
            self.validator.request(
                "/api/reports/" + str(invalid),
                "PATCH",
                {"status": "rejected", "note": "No supporting evidence was found."},
            )[0],
            200,
        )
        self.assertEqual(self.plant.request("/api/reports/" + str(invalid))[0], 404)

    def test_validator_assesses_urgency_only_when_submitting_validation(self):
        for priority in ("low", "normal", "high", "urgent"):
            rid = self.report()
            path = "/api/reports/" + str(rid)
            decision = {
                "status": "validated",
                "note": "Impact and response urgency assessed.",
                "office_id": 2,
                "assigned_to": self.plant_user["id"],
                "priority": priority,
            }
            for invalid in ("critical", "", None, ["urgent"]):
                self.assertEqual(
                    self.validator.request(path, "PATCH", {**decision, "priority": invalid})[0], 400
                )
                self.assertEqual(self.student.request(path)[1]["status"], "submitted")
            code, result = self.validator.request(path, "PATCH", decision)
            self.assertEqual(code, 200, result)
            self.assertEqual(result["priority"], priority)
            self.assertEqual(self.student.request(path)[1]["priority"], priority)
            self.assertEqual(self.plant.request(path)[1]["priority"], priority)
            audit = next(
                row
                for row in self.admin.request("/api/admin/audit")[1]
                if row["action"] == "report.validated" and row["entity"] == str(rid)
            )
            self.assertEqual(json.loads(audit["detail"])["to_priority"], priority)
            if priority != "normal":
                self.assertTrue(
                    any(
                        "Priority changed from normal to " + priority in event["message"]
                        for event in result["events"]
                    )
                )
            self.assertEqual(
                self.validator.request(path, "PATCH", {**decision, "priority": "low"})[0], 403
            )

    def test_office_isolation_includes_maps_evidence_notifications_and_progress(self):
        plant, ict, pending = self.report(), self.report(), self.report()
        plant_path, ict_path = "/api/reports/" + str(plant), "/api/reports/" + str(ict)
        code, attachment = self.student.request(
            plant_path + "/attachments", "POST", {"data": sample_photo()}
        )
        self.assertEqual(code, 201)
        self.assertEqual(self.plant.request(plant_path)[0], 404)
        self.assertEqual(self.validate_for(plant, 2, self.plant_user["id"])[0], 200)
        self.assertEqual(self.validate_for(ict, 4, self.ict_user["id"])[0], 200)
        # Public campus visibility must never bypass office membership.
        self.assertEqual(self.review(ict, office_id=4, assigned_to=self.ict_user["id"])[0], 200)
        self.assertEqual(self.plant.request(ict_path)[0], 404)
        self.assertEqual(self.ict.request(plant_path)[0], 404)
        self.assertEqual(self.ict.request("/api/attachments/" + str(attachment["id"]))[0], 404)
        self.assertEqual(self.plant.request("/api/attachments/" + str(attachment["id"]))[0], 200)
        for client in (self.plant, self.ict):
            self.assertEqual(client.request("/api/admin/users")[0], 403)
            self.assertEqual(client.request("/api/admin/audit")[0], 403)
            self.assertEqual(client.request("/api/reports", "POST", {})[0], 403)
        boot = self.plant.request("/api/bootstrap")[1]
        self.assertIn(plant, [r["id"] for r in boot["reports"]])
        self.assertNotIn(ict, [r["id"] for r in boot["reports"]])
        self.assertNotIn(pending, [r["id"] for r in boot["reports"]])
        self.assertEqual(boot["admins"], [])
        for body in (
            {"office_id": 4},
            {"priority": "urgent"},
            {"assigned_to": self.ict_user["id"]},
            {"category": "Safety"},
            {"visibility": "campus"},
        ):
            self.assertEqual(
                self.plant.request(
                    plant_path,
                    "PATCH",
                    {"status": "in_progress", "note": "Work is starting.", **body},
                )[0],
                403,
            )
        self.assertEqual(
            self.plant.request(
                plant_path, "PATCH", {"status": "in_progress", "note": "Work is starting."}
            )[0],
            200,
        )
        event_count = len(self.plant.request(plant_path)[1]["events"])
        self.assertEqual(
            self.plant.request(
                plant_path, "PATCH", {"status": "in_progress", "note": "Work is starting."}
            )[0],
            400,
        )
        self.assertEqual(len(self.plant.request(plant_path)[1]["events"]), event_count)
        self.assertEqual(
            self.plant.request(
                plant_path + "/comments", "POST", {"message": "Parts have arrived."}
            )[0],
            201,
        )
        self.assertEqual(
            self.plant.request(
                plant_path + "/attachments",
                "POST",
                {"data": sample_photo(color="gray"), "stage": "after"},
            )[0],
            201,
        )
        self.assertEqual(
            self.plant.request(
                plant_path, "PATCH", {"status": "resolved", "note": "Repair completed and checked."}
            )[0],
            200,
        )
        self.assertEqual(
            self.plant.request(
                plant_path, "PATCH", {"status": "closed", "note": "Closing this concern."}
            )[0],
            403,
        )
        self.assertEqual(
            self.admin.request(
                plant_path,
                "PATCH",
                {
                    "status": "in_progress",
                    "office_id": 4,
                    "assigned_to": self.ict_user["id"],
                    "note": "Transferred for further ICT inspection.",
                },
            )[0],
            200,
        )
        self.assertEqual(self.plant.request(plant_path)[0], 404)
        self.assertEqual(self.plant.request("/api/attachments/" + str(attachment["id"]))[0], 404)
        boot = self.plant.request("/api/bootstrap")[1]
        self.assertNotIn(plant, [r["id"] for r in boot["reports"]])
        self.assertNotIn(plant, [n["report_id"] for n in boot["notifications"]])
        self.assertEqual(self.ict.request(plant_path)[0], 200)

    def test_completion_requires_staff_after_photo_for_current_work_round(self):
        rid = self.report()
        path = "/api/reports/" + str(rid)
        before = {"data": sample_photo(), "stage": "before"}
        after = {"data": sample_photo(color="gray"), "stage": "after"}
        self.assertEqual(self.admin.request(path + "/attachments", "POST", after)[0], 403)
        for _ in range(3):
            self.assertEqual(self.student.request(path + "/attachments", "POST", before)[0], 201)
        self.assertEqual(self.student.request(path + "/attachments", "POST", before)[0], 400)
        self.assertEqual(self.validate_for(rid, 2, self.plant_user["id"])[0], 200)
        self.assertEqual(self.student.request(path + "/attachments", "POST", after)[0], 403)
        self.assertEqual(self.ict.request(path + "/attachments", "POST", after)[0], 404)
        decision = {"status": "resolved", "note": "Work completed and inspected."}
        self.assertEqual(self.plant.request(path, "PATCH", decision)[0], 400)
        self.assertEqual(self.admin.request(path, "PATCH", decision)[0], 400)
        self.assertEqual(self.plant.request(path)[1]["status"], "validated")
        self.assertFalse(self.plant.request(path)[1]["has_completion_evidence"])
        self.ai.return_value = {
            "category": None,
            "title": None,
            "reason": "",
            "screening": {"status": "rejected", "reason": "Blocked test verdict."},
        }
        self.assertEqual(self.plant.request(path + "/attachments", "POST", after)[0], 422)
        self.assertFalse(self.plant.request(path)[1]["has_completion_evidence"])
        self.ai.return_value = {
            "category": "Safety, Security & Risk",
            "title": "Completed repair",
            "reason": "Test evidence.",
            "screening": {"status": "appropriate", "reason": "Plausible campus evidence."},
        }
        after["data"] = sample_photo(color="silver")
        # Three original photos must not prevent a completion photo upload.
        self.assertEqual(self.plant.request(path + "/attachments", "POST", after)[0], 201)
        detail = self.plant.request(path)[1]
        self.assertTrue(detail["has_completion_evidence"])
        self.assertEqual(
            [a["metadata"]["stage"] for a in detail["attachments"]], ["before"] * 3 + ["after"]
        )
        self.assertEqual(
            detail["attachments"][-1]["metadata"]["uploaded_by"], self.plant_user["id"]
        )
        self.assertEqual(self.plant.request(path, "PATCH", decision)[0], 200)
        self.assertEqual(
            self.admin.request(
                path, "PATCH", {"status": "closed", "note": "Compared before and after photos."}
            )[0],
            200,
        )
        self.assertEqual(
            self.admin.request(
                path, "PATCH", {"status": "in_progress", "note": "Repair needs another inspection."}
            )[0],
            200,
        )
        self.assertFalse(self.plant.request(path)[1]["has_completion_evidence"])
        self.assertEqual(self.plant.request(path, "PATCH", decision)[0], 400)
        after["data"] = sample_photo(color="gold")
        self.assertEqual(self.plant.request(path + "/attachments", "POST", after)[0], 201)
        self.assertTrue(self.plant.request(path)[1]["has_completion_evidence"])
        # Reassignment also invalidates the previous office's completion photo.
        self.assertEqual(
            self.admin.request(
                path, "PATCH", {**decision, "office_id": 4, "assigned_to": self.ict_user["id"]}
            )[0],
            400,
        )
        self.assertEqual(
            self.admin.request(
                path,
                "PATCH",
                {
                    "status": "in_progress",
                    "office_id": 4,
                    "assigned_to": self.ict_user["id"],
                    "note": "ICT must finish this repair.",
                },
            )[0],
            200,
        )
        self.assertFalse(self.ict.request(path)[1]["has_completion_evidence"])
        self.assertEqual(self.ict.request(path, "PATCH", decision)[0], 400)
        after["data"] = sample_photo(color="pink")
        self.assertEqual(self.ict.request(path + "/attachments", "POST", after)[0], 201)
        self.assertEqual(self.ict.request(path, "PATCH", decision)[0], 200)

    def test_reused_completion_photos_are_rejected_and_legacy_copies_do_not_count(self):
        rid = self.report()
        path = "/api/reports/" + str(rid)
        original = sample_photo()
        self.assertEqual(
            self.student.request(
                path + "/attachments", "POST", {"data": original, "filename": "before.jpg"}
            )[0],
            201,
        )
        self.assertEqual(self.validate_for(rid, 2, self.plant_user["id"])[0], 200)
        for content in (original, sample_photo({1: "N", 2: (8, 14, 30), 3: "E", 4: (124, 14, 38)})):
            code, result = self.plant.request(
                path + "/attachments",
                "POST",
                {"data": content, "filename": "renamed-after.jpg", "stage": "after"},
            )
            self.assertEqual(code, 422, result)
            self.assertIn("same photo", result["error"])
        # Preserve copies accepted by the older version, but do not let them unlock completion
        # or use up the three slots for genuine after-work photos.
        with server.connect() as c:
            metadata = json.dumps(
                {
                    "stage": "after",
                    "office_id": 2,
                    "evidence_round": 0,
                    "screening": {"status": "appropriate"},
                }
            )
            for _ in range(3):
                c.execute(
                    "INSERT INTO attachments(report_id,content,mime,filename,metadata,created_at) VALUES(?,?,?,?,?,?)",
                    (
                        rid,
                        base64.b64decode(original),
                        "image/jpeg",
                        "old-copy.jpg",
                        metadata,
                        server.now(),
                    ),
                )
        detail = self.plant.request(path)[1]
        self.assertFalse(detail["has_completion_evidence"])
        self.assertTrue(all(a["completion_issue"] for a in detail["attachments"][1:]))
        self.assertEqual(
            self.plant.request(
                path, "PATCH", {"status": "resolved", "note": "Attempt with the original picture."}
            )[0],
            400,
        )
        self.assertEqual(
            self.plant.request(
                path + "/attachments",
                "POST",
                {
                    "data": sample_photo(color="gray"),
                    "filename": "fresh-after.jpg",
                    "stage": "after",
                },
            )[0],
            201,
        )
        self.assertTrue(self.plant.request(path)[1]["has_completion_evidence"])
        self.assertEqual(
            self.plant.request(
                path, "PATCH", {"status": "resolved", "note": "Fresh completion photo uploaded."}
            )[0],
            200,
        )

    def test_safe_but_unrelated_or_unresolved_photos_cannot_be_completion_evidence(self):
        rid = self.report(
            title="Water stains on ceiling",
            description="Brown stains surround the ceiling light.",
            category="Facilities, Infrastructure & Maintenance",
        )
        path = "/api/reports/" + str(rid)
        self.assertEqual(
            self.student.request(path + "/attachments", "POST", {"data": sample_photo()})[0], 201
        )
        self.assertEqual(self.validate_for(rid, 2, self.plant_user["id"])[0], 200)
        body = {"data": sample_photo(color="gray"), "report_id": rid}
        for verdict in ("unrelated", "still_unresolved", "unclear", "unavailable"):
            self.completion_ai.side_effect = (
                RuntimeError("Provider unavailable.") if verdict == "unavailable" else None
            )
            self.completion_ai.return_value = {
                "status": verdict,
                "reason": "The dashboard does not show the reported ceiling repair.",
            }
            code, analysis = self.plant.request(
                "/api/photos/inspect", "POST", {**body, "analyze": True}
            )
            self.assertEqual(code, 200, analysis)
            self.assertEqual(analysis["screening"]["status"], "appropriate")
            self.assertEqual(analysis["completion_check"]["status"], verdict)
            code, result = self.plant.request(
                path + "/attachments",
                "POST",
                {
                    **body,
                    "stage": "after",
                    "analysis_token": analysis["analysis_token"],
                    "completion_check": {"status": "supports_completion"},
                },
            )
            self.assertEqual(code, 503 if verdict == "unavailable" else 422, result)
            detail = self.plant.request(path)[1]
            self.assertFalse(detail["has_completion_evidence"])
            self.assertEqual(len(detail["attachments"]), 1)
        self.completion_ai.side_effect = None
        self.completion_ai.return_value = {
            "status": "supports_completion",
            "reason": "The repaired ceiling is clearly shown.",
        }
        code, analysis = self.plant.request(
            "/api/photos/inspect", "POST", {**body, "analyze": True}
        )
        self.assertEqual(code, 200, analysis)
        self.completion_ai.reset_mock()
        self.assertEqual(
            self.plant.request(
                path + "/attachments",
                "POST",
                {**body, "stage": "after", "analysis_token": analysis["analysis_token"]},
            )[0],
            201,
        )
        self.completion_ai.assert_not_called()  # The exact photo/report comparison is cached.
        self.assertEqual(
            self.plant.request(
                path, "PATCH", {"status": "resolved", "note": "Ceiling repair evidence checked."}
            )[0],
            200,
        )

    def test_completion_comparison_is_bound_to_report_and_updated_context(self):
        first, second = self.report(), self.report()
        path = "/api/reports/" + str(first)
        for rid in (first, second):
            self.assertEqual(self.validate_for(rid, 2, self.plant_user["id"])[0], 200)
        photo = sample_photo(color="gray")
        analysis = self.plant.request(
            "/api/photos/inspect", "POST", {"data": photo, "report_id": first}
        )[1]
        self.assertEqual(
            self.plant.request(
                path + "/attachments",
                "POST",
                {"data": photo, "stage": "after", "analysis_token": analysis["analysis_token"]},
            )[0],
            201,
        )
        attachment = self.plant.request(path)[1]["attachments"][0]
        self.completion_ai.return_value = {"status": "unrelated", "reason": "Different concern."}
        self.assertEqual(
            self.plant.request(
                "/api/reports/" + str(second) + "/attachments",
                "POST",
                {"data": photo, "stage": "after", "analysis_token": analysis["analysis_token"]},
            )[0],
            422,
        )
        self.assertFalse(
            self.plant.request("/api/reports/" + str(second))[1]["has_completion_evidence"]
        )
        updated = ["Safety, Security & Risk", "ICT, Internet & Digital Services"]
        # Changing context and resolving in the same request cannot reuse a prior verdict.
        self.assertEqual(
            self.admin.request(
                path,
                "PATCH",
                {
                    "status": "resolved",
                    "categories": updated,
                    "note": "Try changing context and resolving.",
                },
            )[0],
            400,
        )
        self.assertEqual(
            self.admin.request(
                path,
                "PATCH",
                {
                    "status": "validated",
                    "categories": updated,
                    "note": "Additional concern identified.",
                },
            )[0],
            200,
        )
        self.assertFalse(self.plant.request(path)[1]["has_completion_evidence"])
        check_path = "/api/attachments/" + str(attachment["id"]) + "/check"
        self.assertEqual(self.student.request(check_path, "POST", {})[0], 403)
        self.assertEqual(self.validator.request(check_path, "POST", {})[0], 403)
        self.assertEqual(self.ict.request(check_path, "POST", {})[0], 404)
        code, result = self.plant.request(check_path, "POST", {})
        self.assertEqual(code, 200, result)
        self.assertEqual(result["status"], "unrelated")
        self.assertFalse(self.plant.request(path)[1]["has_completion_evidence"])
        self.completion_ai.return_value = {
            "status": "supports_completion",
            "reason": "The relevant repair is visible.",
        }
        self.assertEqual(self.plant.request(check_path, "POST", {})[0], 200)
        self.assertTrue(self.plant.request(path)[1]["has_completion_evidence"])

    def test_main_admin_assigns_office_membership_and_revokes_old_sessions(self):
        user = self.other.request("/api/me")[1]["user"]
        path = "/api/admin/users/" + str(user["id"])
        self.assertEqual(
            self.admin.request(path, "PATCH", {"role": "office", "office_id": None})[0], 400
        )
        self.assertEqual(
            self.admin.request(path, "PATCH", {"role": "office", "office_id": 4})[0], 200
        )
        self.assertEqual(self.other.request("/api/bootstrap")[0], 401)
        changed = self.other.login("other@test.local")
        self.assertEqual(changed["role"], "office")
        self.assertEqual(changed["office_id"], 4)
        self.assertEqual(self.admin.request(path, "PATCH", {"role": "student"})[0], 200)
        self.assertIsNone(self.other.login("other@test.local")["office_id"])

    def test_student_priority_is_set_by_admin(self):
        rid = self.report(priority="urgent")
        path = "/api/reports/" + str(rid)
        self.assertEqual(self.student.request(path)[1]["priority"], "normal")
        self.assertEqual(self.review(rid, priority="high")[0], 200)
        self.assertEqual(self.student.request(path)[1]["priority"], "high")

    def test_validation_privacy_and_resolution_lifecycle(self):
        rid = self.report(location_details="Second floor, Room 204, beside the stairs")
        path = "/api/reports/" + str(rid)
        self.assertEqual(
            self.student.request(path)[1]["location_details"],
            "Second floor, Room 204, beside the stairs",
        )
        self.assertEqual(
            self.validator.request(path)[1]["location_details"],
            "Second floor, Room 204, beside the stairs",
        )
        self.assertEqual(self.other.request(path)[0], 404)
        code, boot = self.other.request("/api/bootstrap")
        self.assertNotIn(rid, [r["id"] for r in boot["reports"]])
        png = sample_photo()
        code, attachment = self.student.request(path + "/attachments", "POST", {"data": png})
        self.assertEqual(code, 201)
        self.assertEqual(self.review(rid)[0], 200)
        self.admin.request(
            path + "/comments",
            "POST",
            {"message": "Private investigation detail.", "internal": True},
        )
        code, public = self.other.request(path)
        self.assertEqual(code, 200)
        self.assertEqual(public["description"], "Walkway light needs repair.")
        self.assertEqual(public["title"], "Broken walkway light")
        self.assertNotIn("reporter", public)
        self.assertNotIn("location_details", public)
        self.assertEqual(public["attachments"], [])
        self.assertNotIn("Private investigation", json.dumps(public))
        self.assertEqual(self.other.request("/api/attachments/" + str(attachment["id"]))[0], 404)
        self.assertEqual(self.student.request("/api/attachments/" + str(attachment["id"]))[0], 200)
        self.assertEqual(
            self.other.request(path + "/comments", "POST", {"message": "Not my report"})[0], 403
        )
        self.assertEqual(
            self.validator.request(
                path, "PATCH", {"status": "resolved", "note": "Fixed the light"}
            )[0],
            403,
        )
        self.assertEqual(
            self.admin.request(
                path + "/attachments",
                "POST",
                {"data": sample_photo(color="gray"), "stage": "after"},
            )[0],
            201,
        )
        for status in ("in_progress", "resolved", "closed", "in_progress"):
            code, result = self.admin.request(
                path, "PATCH", {"status": status, "note": "Work status checked."}
            )
            self.assertEqual(code, 200, result)
        code, boot = self.student.request("/api/bootstrap")
        self.assertTrue(any(n["report_id"] == rid for n in boot["notifications"]))
        self.assertNotIn("Private investigation", json.dumps(self.student.request(path)[1]))

    def test_invalid_decisions_and_duplicate_link(self):
        rid = self.report()
        self.assertEqual(self.review(rid, public_summary="")[0], 400)
        self.assertEqual(self.review(rid, office_id=None)[0], 400)
        self.assertEqual(self.review(rid, status="resolved")[0], 400)
        self.assertEqual(self.review(rid)[0], 200)
        duplicate = self.report()
        code, result = self.admin.request(
            "/api/reports/" + str(duplicate),
            "PATCH",
            {
                "status": "duplicate",
                "visibility": "restricted",
                "duplicate_of": rid,
                "note": "Same light, linked to existing report.",
            },
        )
        self.assertEqual(code, 200, result)
        self.assertEqual(result["duplicate_of"], rid)
        self.assertEqual(self.other.request("/api/reports/" + str(duplicate))[0], 404)

    def test_access_revocation_and_audit(self):
        client = Client(self.base)
        user = client.login("other@test.local")
        code, _ = self.admin.request("/api/admin/users/" + str(user["id"]), "PATCH", {"active": 0})
        self.assertEqual(code, 200)
        self.assertEqual(client.request("/api/bootstrap")[0], 401)
        self.admin.request("/api/admin/users/" + str(user["id"]), "PATCH", {"active": 1})
        code, audit = self.admin.request("/api/admin/audit")
        self.assertEqual(code, 200)
        self.assertTrue(any(a["action"] == "user.access_changed" for a in audit))

    def test_coordinates_upload_rejection_and_static_paths(self):
        code, _ = self.student.request(
            "/api/reports",
            "POST",
            {
                "title": "Long location details",
                "description": "A sufficiently detailed report.",
                "category": "Safety, Security & Risk",
                "location": "Walkway",
                "location_details": "x" * 501,
            },
        )
        self.assertEqual(code, 400)
        code, _ = self.student.request(
            "/api/reports",
            "POST",
            {
                "title": "Invalid location",
                "description": "A sufficiently detailed report.",
                "category": "Safety, Security & Risk",
                "location": "Walkway",
                "latitude": 95,
                "longitude": 124,
            },
        )
        self.assertEqual(code, 400)
        rid = self.report()
        self.assertEqual(
            self.student.request(
                "/api/reports/" + str(rid) + "/attachments",
                "POST",
                {"data": base64.b64encode(b"<svg>test</svg>").decode()},
            )[0],
            400,
        )
        self.assertEqual(Client(self.base).request("/server.py")[0], 404)
        self.assertEqual(Client(self.base).request("/")[0], 200)


if __name__ == "__main__":
    unittest.main()
