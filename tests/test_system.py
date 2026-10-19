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
from test_photo_analysis import sample_photo


class Client:
    def __init__(self, base):
        self.base, self.csrf = base, ''
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, method='GET', body=None, csrf=True, extra_headers=None):
        headers = {'Content-Type': 'application/json'}
        if csrf:
            headers['X-CSRF-Token'] = self.csrf
        headers.update(extra_headers or {})
        req = Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        try:
            result = self.opener.open(req)
        except HTTPError as e:
            result = e
        payload = result.read()
        data = json.loads(payload) if result.headers.get_content_type() == 'application/json' else payload
        return result.code, data

    def login(self, email):
        status, result = self.request('/api/login', 'POST', {'email': email, 'password': 'test-password-for-iit-voice'})
        assert status == 200, result
        self.csrf = result['csrf']
        return result['user']


class SystemTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.DATA = Path(cls.temp.name)
        server.DB = server.DATA / 'test.sqlite3'
        server.initialize()
        for email, role in [('admin@test.local', 'admin'), ('validator@test.local', 'validator'), ('student@test.local', 'student'), ('other@test.local', 'student')]:
            server.create_account(email, email.split('@')[0], role, 'test-password-for-iit-voice', 'Student' if role == 'student' else 'Staff')
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.http.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def setUp(self):
        demo_patch = patch('server.DEMO_LOGIN', False)
        demo_patch.start()
        self.addCleanup(demo_patch.stop)
        self.ai_patch = patch('server.suggest_category', return_value={'category': 'Safety, Security & Risk', 'title': 'Visible campus hazard', 'reason': 'Test evidence.', 'screening': {'status': 'appropriate', 'reason': 'Plausible campus evidence.'}})
        self.ai = self.ai_patch.start()
        self.addCleanup(self.ai_patch.stop)
        env_patch = patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'})
        env_patch.start()
        self.addCleanup(env_patch.stop)
        with server.connect() as c:
            c.execute('DELETE FROM photo_analyses')
            c.execute("DELETE FROM login_limits WHERE key LIKE 'photo-ai:%'")
        self.student, self.other, self.validator, self.admin = [Client(self.base) for _ in range(4)]
        self.student.login('student@test.local')
        self.other.login('other@test.local')
        self.validator.login('validator@test.local')
        self.admin.login('admin@test.local')

    def report(self, **extra):
        status, result = self.student.request('/api/reports', 'POST', {'title': '<script>Broken light</script>', 'description': 'The light is broken. Reporter private details.', 'category': 'Safety, Security & Risk', 'location': 'Campus walkway', 'latitude': 8.2415, 'longitude': 124.243, **extra})
        self.assertEqual(status, 201, result)
        return result['id']

    def review(self, rid, **extra):
        return self.validator.request('/api/reports/' + str(rid), 'PATCH', {'status': 'validated', 'visibility': 'campus', 'public_title': 'Broken walkway light', 'public_summary': 'Walkway light needs repair.', 'office_id': 1, 'note': 'Location verified and assigned.', **extra})

    def test_registration_cannot_grant_admin_and_requires_verification(self):
        client = Client(self.base)
        status, result = client.request('/api/register', 'POST', {'name': 'Pending Person', 'email': 'pending@test.local', 'password': 'test-password-for-iit-voice', 'affiliation': 'Student', 'role': 'admin', 'verified': 1})
        self.assertEqual(status, 201, result)
        status, result = client.request('/api/login', 'POST', {'email': 'pending@test.local', 'password': 'test-password-for-iit-voice'})
        self.assertEqual(status, 403)
        status, users = self.admin.request('/api/admin/users')
        pending = next(u for u in users if u['email'] == 'pending@test.local')
        self.assertEqual(pending['role'], 'student')
        self.assertEqual(pending['verified'], 0)
        status, _ = self.admin.request('/api/admin/users/' + str(pending['id']), 'PATCH', {'verified': 1})
        self.assertEqual(status, 200)
        client.login('pending@test.local')
        self.assertEqual(client.request('/api/admin/users')[0], 403)

    def test_role_and_csrf_enforcement(self):
        self.assertEqual(self.student.request('/api/admin/users')[0], 403)
        self.assertEqual(self.validator.request('/api/admin/users')[0], 403)
        self.assertEqual(self.validator.request('/api/admin/audit')[0], 403)
        self.assertEqual(self.student.request('/api/reports', 'POST', {'title': 'Test'}, csrf=False)[0], 403)
        self.assertEqual(Client(self.base).request('/api/bootstrap')[0], 401)
        rid = self.report()
        self.assertEqual(self.student.request('/api/reports/' + str(rid), 'PATCH', {'status': 'validated'})[0], 403)

    def test_auth_rejects_other_origins_and_accepts_same_origin(self):
        credentials = {'email': 'student@test.local', 'password': 'test-password-for-iit-voice'}
        client = Client(self.base)
        self.assertEqual(client.request('/api/login', 'POST', credentials, extra_headers={'Origin': 'https://other.example'})[0], 403)
        self.assertEqual(client.request('/api/register', 'POST', {}, extra_headers={'Origin': 'https://other.example'})[0], 403)
        self.assertEqual(client.request('/api/login', 'POST', credentials, extra_headers={'Origin': self.base})[0], 200)

    def test_demo_sign_in_is_opt_in_local_and_uses_existing_permissions(self):
        client = Client(self.base)
        self.assertEqual(client.request('/api/demo/accounts')[1], {'accounts': []})
        self.assertEqual(client.request('/api/demo/login', 'POST', {'account_id': 1})[0], 403)
        staff_id = server.create_account('demo-staff@test.local', 'Demo Staff', 'student', 'test-password-for-iit-voice', 'Staff', demo=True)
        with server.connect() as c:
            student_id = c.execute("SELECT id FROM users WHERE email='student@test.local'").fetchone()[0]
            other_id = c.execute("SELECT id FROM users WHERE email='other@test.local'").fetchone()[0]
            c.execute('UPDATE users SET is_demo=1 WHERE id=?', (student_id,))
        with patch('server.DEMO_LOGIN', True):
            accounts = client.request('/api/demo/accounts')[1]['accounts']
            self.assertEqual({a['id'] for a in accounts}, {student_id, staff_id})
            self.assertNotIn('password', json.dumps(accounts))
            self.assertNotIn('email', json.dumps(accounts))
            code, session = client.request('/api/demo/login', 'POST', {'account_id': student_id, 'role': 'admin'})
            self.assertEqual(code, 200)
            self.assertEqual(session['user']['role'], 'student')
            client.csrf = session['csrf']
            self.assertEqual(client.request('/api/me')[0], 200)
            self.assertEqual(client.request('/api/admin/users')[0], 403)
            self.assertEqual(client.request('/api/logout', 'POST', {})[0], 200)
            self.assertEqual(client.request('/api/demo/login', 'POST', {'account_id': other_id})[0], 404)
            self.assertEqual(client.request('/api/demo/login', 'POST', {'account_id': student_id}, extra_headers={'Origin': 'https://other.example'})[0], 403)
            self.assertEqual(client.request('/api/demo/login', 'POST', {'account_id': student_id}, extra_headers={'Host': 'public.example'})[0], 403)
            self.assertEqual(client.request('/api/demo/accounts', extra_headers={'Host': 'public.example'})[1]['accounts'], [])
            with patch('server.ipaddress.ip_address') as address:
                address.return_value.is_loopback = False
                self.assertEqual(client.request('/api/demo/login', 'POST', {'account_id': student_id})[0], 403)
            with server.connect() as c:
                c.execute('UPDATE users SET active=0 WHERE id=?', (staff_id,))
            self.assertEqual(client.request('/api/demo/login', 'POST', {'account_id': staff_id})[0], 403)
            self.assertNotIn(staff_id, [a['id'] for a in client.request('/api/demo/accounts')[1]['accounts']])
            with server.connect() as c:
                c.execute('UPDATE users SET active=1,verified=0 WHERE id=?', (staff_id,))
            self.assertEqual(client.request('/api/demo/login', 'POST', {'account_id': staff_id})[0], 403)

    def test_photo_inspection_is_private_automatic_and_cached(self):
        body = {'data': sample_photo({1: 'N', 2: (8, 14, 30), 3: 'E', 4: (124, 14, 38)})}
        self.assertEqual(Client(self.base).request('/api/photos/inspect', 'POST', body)[0], 401)
        self.assertEqual(self.student.request('/api/photos/inspect', 'POST', body, csrf=False)[0], 403)
        code, result = self.student.request('/api/photos/inspect', 'POST', body)
        self.assertEqual(code, 200)
        self.assertEqual(result['gps']['latitude'], 8.241667)
        self.assertEqual(result['screening']['status'], 'appropriate')
        self.ai.assert_called_once()
        self.student.request('/api/photos/inspect', 'POST', body)
        self.ai.assert_called_once()
        self.student.request('/api/photos/inspect', 'POST', {**body, 'analyze': True})
        self.assertEqual(self.ai.call_count, 2)
        self.assertEqual(self.student.request('/api/photos/inspect', 'POST', {'data': 'bad'})[0], 400)

    def test_evidence_preserves_server_analysis_and_protects_metadata(self):
        photo = sample_photo({1: 'N', 2: (8, 14, 30), 3: 'E', 4: (124, 14, 38)})
        with patch('server.suggest_category', return_value={'category': 'Safety, Security & Risk', 'reason': 'Visible hazard.', 'title': 'Blocked fire exit', 'description': 'An obstruction is visible across the fire exit.', 'screening': {'status': 'appropriate', 'reason': 'Campus hazard.'}}):
            code, result = self.student.request('/api/photos/inspect', 'POST', {'data': photo, 'analyze': True})
        self.assertEqual(code, 200)
        token = result['analysis_token']
        rid = self.report()
        path = '/api/reports/' + str(rid)
        upload = {'data': photo, 'filename': 'exit-photo.jpg', 'analysis_token': token}
        self.assertEqual(self.validator.request(path + '/attachments', 'POST', upload)[0], 400)
        self.assertEqual(self.student.request(path + '/attachments', 'POST', {**upload, 'data': sample_photo()})[0], 400)
        self.assertEqual(self.student.request(path + '/attachments', 'POST', upload)[0], 201)
        evidence = self.validator.request(path)[1]['attachments'][0]
        self.assertEqual(evidence['filename'], 'exit-photo.jpg')
        self.assertEqual(evidence['metadata']['title'], 'Blocked fire exit')
        self.assertEqual(evidence['metadata']['description'], 'An obstruction is visible across the fire exit.')
        self.assertEqual(evidence['metadata']['category'], 'Safety, Security & Risk')
        self.assertEqual(evidence['metadata']['gps']['latitude'], 8.241667)
        self.assertEqual(evidence['metadata']['report_pin']['latitude'], 8.2415)
        self.assertEqual(self.student.request(path + '/attachments', 'POST', {'data': photo, 'filename': 'manual.jpg', 'category': 'Safety, Security & Risk', 'title': 'Forged AI title'})[0], 201)
        self.assertEqual(self.validator.request(path)[1]['attachments'][1]['metadata']['title'], 'Blocked fire exit')
        self.assertEqual(self.review(rid)[0], 200)
        self.assertEqual(self.other.request(path)[1]['attachments'], [])

    def test_blocked_photo_cannot_bypass_server_screening(self):
        path = '/api/reports/' + str(self.report())
        self.ai.return_value = {'category': None, 'title': None, 'reason': '',
            'screening': {'status': 'rejected', 'reason': 'Blocked by content screening.'}}
        photo = sample_photo()
        # A direct upload cannot supply a forged clearance or skip screening.
        code, _ = self.student.request(path + '/attachments', 'POST', {'data': photo, 'screening': {'status': 'appropriate'}})
        self.assertEqual(code, 422)
        code, result = self.student.request('/api/photos/inspect', 'POST', {'data': photo})
        self.assertEqual(result['screening']['status'], 'rejected')
        code, _ = self.student.request(path + '/attachments', 'POST', {'data': photo, 'analysis_token': result['analysis_token']})
        self.assertEqual(code, 422)
        self.assertEqual(self.validator.request(path)[1]['attachments'], [])
        with server.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM attachments WHERE report_id=?', (int(path.split('/')[-1]),)).fetchone()[0], 0)
        self.ai.assert_called_once()  # Cached rejection also blocks re-upload.

    def test_questionable_photo_is_saved_for_private_manual_review(self):
        self.ai.return_value = {'category': None, 'title': None, 'reason': '',
            'screening': {'status': 'needs_review', 'reason': 'Relevance is unclear.'}}
        rid = self.report()
        path = '/api/reports/' + str(rid)
        self.assertEqual(self.student.request(path + '/attachments', 'POST', {'data': sample_photo()})[0], 201)
        metadata = self.validator.request(path)[1]['attachments'][0]['metadata']
        self.assertEqual(metadata['screening']['status'], 'needs_review')
        self.assertEqual(metadata['screening']['reason'], 'Relevance is unclear.')
        self.assertEqual(self.review(rid)[0], 200)
        self.assertEqual(self.other.request(path)[1]['attachments'], [])

    def test_ai_failure_is_unverified_and_retry_can_clear_it(self):
        photo = sample_photo()
        path = '/api/reports/' + str(self.report())
        with patch('server.suggest_category', side_effect=RuntimeError('Gemini quota reached.')) as ai:
            code, result = self.student.request('/api/photos/inspect', 'POST', {'data': photo})
            self.assertEqual(code, 200)
            self.assertEqual(result['screening']['status'], 'unverified')
            self.assertIsNone(result['category'])
            self.assertEqual(self.student.request(path + '/attachments', 'POST', {'data': photo})[0], 201)
            ai.assert_called_once()
        self.assertEqual(self.validator.request(path)[1]['attachments'][0]['metadata']['screening']['status'], 'unverified')
        result = self.student.request('/api/photos/inspect', 'POST', {'data': photo, 'analyze': True})[1]
        self.assertEqual(result['screening']['status'], 'appropriate')

    def test_rate_limit_never_marks_an_unscreened_photo_as_safe(self):
        with server.connect() as c:
            uid = c.execute("SELECT id FROM users WHERE email='student@test.local'").fetchone()[0]
            c.execute('INSERT INTO login_limits VALUES(?,20,?)', ('photo-ai:' + str(uid), server.time.time()))
        result = self.student.request('/api/photos/inspect', 'POST', {'data': sample_photo()})[1]
        self.assertEqual(result['screening']['status'], 'unverified')
        self.assertIn('limit reached', result['ai_error'])
        self.ai.assert_not_called()

    def test_multiple_categories_are_validated_saved_and_reclassified(self):
        primary = 'Facilities, Infrastructure & Maintenance'
        safety = 'Safety, Security & Risk'
        digital = 'ICT, Internet & Digital Services'
        rid = self.report(category=primary, categories=[primary, safety, digital, safety])
        path = '/api/reports/' + str(rid)
        detail = self.validator.request(path)[1]
        self.assertEqual(detail['categories'], [primary, safety, digital])
        self.assertEqual(detail['category'], primary)
        code, _ = self.validator.request(path, 'PATCH', {'category': safety, 'categories': [safety, digital], 'note': 'Hazard and connectivity impact verified.'})
        self.assertEqual(code, 200)
        detail = self.student.request(path)[1]
        self.assertEqual(detail['categories'], [safety, digital])
        self.assertEqual(detail['category'], safety)
        self.assertIn('Categories changed', detail['events'][-1]['message'])
        self.assertEqual(self.student.request(path, 'PATCH', {'categories': [primary], 'note': 'Change categories'})[0], 403)
        self.assertEqual(self.review(rid)[0], 200)
        self.assertEqual(self.other.request(path)[1]['categories'], [safety, digital])
        boot = self.validator.request('/api/bootstrap')[1]
        self.assertEqual(len(boot['categories']), 9)
        self.assertEqual(len(boot['category_groups']), 3)
        self.assertEqual(len([report for report in boot['reports'] if report['id'] == rid]), 1)

    def test_invalid_category_arrays_cannot_change_a_report(self):
        rid = self.report()
        path = '/api/reports/' + str(rid)
        for categories in ('Safety', None, ['Invented'], [{'category': 'Safety'}], ['Safety'] * 10):
            self.assertEqual(self.student.request('/api/reports', 'POST', {'title': 'Invalid categories', 'description': 'Invalid test categories must be rejected.', 'location': 'Library', 'category': 'Safety', 'categories': categories})[0], 400)
            self.assertEqual(self.validator.request(path, 'PATCH', {'categories': categories, 'note': 'Invalid categories check.'})[0], 400)
        self.assertEqual(self.student.request(path)[1]['categories'], ['Safety, Security & Risk'])

    def test_existing_category_names_and_custom_routing_migrate_idempotently(self):
        rid = self.report()
        with server.connect() as c:
            c.execute("UPDATE reports SET category='Safety',categories='[]',office_id=2 WHERE id=?", (rid,))
            c.execute("DELETE FROM routing WHERE category='Safety, Security & Risk'")
            c.execute("INSERT INTO routing VALUES('Safety',4)")
        server.initialize()
        server.initialize()
        detail = self.student.request('/api/reports/' + str(rid))[1]
        self.assertEqual(detail['category'], 'Safety, Security & Risk')
        self.assertEqual(detail['categories'], ['Safety, Security & Risk'])
        self.assertEqual(detail['office_id'], 2)
        with server.connect() as c:
            self.assertEqual(c.execute("SELECT office_id FROM routing WHERE category='Safety, Security & Risk'").fetchone()[0], 4)
            self.assertEqual(c.execute('SELECT count(*) FROM routing').fetchone()[0], 9)
            self.assertEqual(c.execute("SELECT count(*) FROM routing WHERE category='Safety'").fetchone()[0], 0)

    def test_report_order_is_submission_time_not_last_update(self):
        older, newer = self.report(), self.report()
        with server.connect() as c:
            c.execute("UPDATE reports SET created_at='2026-10-01T00:00:00+00:00',updated_at='2026-10-14T00:00:00+00:00' WHERE id=?", (older,))
            c.execute("UPDATE reports SET created_at='2026-10-12T00:00:00+00:00',updated_at='2026-10-12T00:00:00+00:00' WHERE id=?", (newer,))
        reports = self.student.request('/api/bootstrap')[1]['reports']
        ids = [report['id'] for report in reports]
        self.assertLess(ids.index(newer), ids.index(older))

    def test_student_priority_is_set_by_admin(self):
        rid = self.report(priority='urgent')
        path = '/api/reports/' + str(rid)
        self.assertEqual(self.student.request(path)[1]['priority'], 'normal')
        self.assertEqual(self.review(rid, priority='high')[0], 200)
        self.assertEqual(self.student.request(path)[1]['priority'], 'high')

    def test_validation_privacy_and_resolution_lifecycle(self):
        rid = self.report(location_details='Second floor, Room 204, beside the stairs')
        path = '/api/reports/' + str(rid)
        self.assertEqual(self.student.request(path)[1]['location_details'], 'Second floor, Room 204, beside the stairs')
        self.assertEqual(self.validator.request(path)[1]['location_details'], 'Second floor, Room 204, beside the stairs')
        self.assertEqual(self.other.request(path)[0], 404)
        code, boot = self.other.request('/api/bootstrap')
        self.assertNotIn(rid, [r['id'] for r in boot['reports']])
        png = sample_photo()
        code, attachment = self.student.request(path + '/attachments', 'POST', {'data': png})
        self.assertEqual(code, 201)
        self.assertEqual(self.review(rid)[0], 200)
        self.validator.request(path + '/comments', 'POST', {'message': 'Private investigation detail.', 'internal': True})
        code, public = self.other.request(path)
        self.assertEqual(code, 200)
        self.assertEqual(public['description'], 'Walkway light needs repair.')
        self.assertEqual(public['title'], 'Broken walkway light')
        self.assertNotIn('reporter', public)
        self.assertNotIn('location_details', public)
        self.assertEqual(public['attachments'], [])
        self.assertNotIn('Private investigation', json.dumps(public))
        self.assertEqual(self.other.request('/api/attachments/' + str(attachment['id']))[0], 404)
        self.assertEqual(self.student.request('/api/attachments/' + str(attachment['id']))[0], 200)
        self.assertEqual(self.other.request(path + '/comments', 'POST', {'message': 'Not my report'})[0], 403)
        self.assertEqual(self.validator.request(path, 'PATCH', {'status': 'resolved', 'note': 'Fixed the light'})[0], 403)
        for status in ('in_progress', 'resolved', 'closed', 'in_progress'):
            code, result = self.admin.request(path, 'PATCH', {'status': status, 'note': 'Work status checked.'})
            self.assertEqual(code, 200, result)
        code, boot = self.student.request('/api/bootstrap')
        self.assertTrue(any(n['report_id'] == rid for n in boot['notifications']))
        self.assertNotIn('Private investigation', json.dumps(self.student.request(path)[1]))

    def test_invalid_decisions_and_duplicate_link(self):
        rid = self.report()
        self.assertEqual(self.review(rid, public_summary='')[0], 400)
        self.assertEqual(self.review(rid, office_id=None)[0], 400)
        self.assertEqual(self.review(rid, status='resolved')[0], 400)
        self.assertEqual(self.review(rid)[0], 200)
        duplicate = self.report()
        code, result = self.validator.request('/api/reports/' + str(duplicate), 'PATCH', {'status': 'duplicate', 'visibility': 'restricted', 'duplicate_of': rid, 'note': 'Same light, linked to existing report.'})
        self.assertEqual(code, 200, result)
        self.assertEqual(result['duplicate_of'], rid)
        self.assertEqual(self.other.request('/api/reports/' + str(duplicate))[0], 404)

    def test_access_revocation_and_audit(self):
        client = Client(self.base)
        user = client.login('other@test.local')
        code, _ = self.admin.request('/api/admin/users/' + str(user['id']), 'PATCH', {'active': 0})
        self.assertEqual(code, 200)
        self.assertEqual(client.request('/api/bootstrap')[0], 401)
        self.admin.request('/api/admin/users/' + str(user['id']), 'PATCH', {'active': 1})
        code, audit = self.admin.request('/api/admin/audit')
        self.assertEqual(code, 200)
        self.assertTrue(any(a['action'] == 'user.access_changed' for a in audit))

    def test_coordinates_upload_rejection_and_static_paths(self):
        code, _ = self.student.request('/api/reports', 'POST', {'title': 'Long location details', 'description': 'A sufficiently detailed report.', 'category': 'Safety, Security & Risk', 'location': 'Walkway', 'location_details': 'x' * 501})
        self.assertEqual(code, 400)
        code, _ = self.student.request('/api/reports', 'POST', {'title': 'Invalid location', 'description': 'A sufficiently detailed report.', 'category': 'Safety, Security & Risk', 'location': 'Walkway', 'latitude': 95, 'longitude': 124})
        self.assertEqual(code, 400)
        rid = self.report()
        self.assertEqual(self.student.request('/api/reports/' + str(rid) + '/attachments', 'POST', {'data': base64.b64encode(b'<svg>test</svg>').decode()})[0], 400)
        self.assertEqual(Client(self.base).request('/server.py')[0], 404)
        self.assertEqual(Client(self.base).request('/')[0], 200)


if __name__ == '__main__':
    unittest.main()
