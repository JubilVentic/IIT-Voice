"""End-to-end HTTP tests against an isolated SQLite database."""
import base64
import http.cookiejar
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class Client:
    def __init__(self, base):
        self.base, self.csrf = base, ''
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, method='GET', body=None, csrf=True):
        headers = {'Content-Type': 'application/json'}
        if csrf:
            headers['X-CSRF-Token'] = self.csrf
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
        self.student, self.other, self.validator, self.admin = [Client(self.base) for _ in range(4)]
        self.student.login('student@test.local')
        self.other.login('other@test.local')
        self.validator.login('validator@test.local')
        self.admin.login('admin@test.local')

    def report(self, **extra):
        status, result = self.student.request('/api/reports', 'POST', {'title': '<script>Broken light</script>', 'description': 'The light is broken. Reporter private details.', 'category': 'Safety', 'location': 'Campus walkway', 'latitude': 8.2415, 'longitude': 124.243, **extra})
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
        png = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'test bytes').decode()
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
        code, _ = self.student.request('/api/reports', 'POST', {'title': 'Long location details', 'description': 'A sufficiently detailed report.', 'category': 'Safety', 'location': 'Walkway', 'location_details': 'x' * 501})
        self.assertEqual(code, 400)
        code, _ = self.student.request('/api/reports', 'POST', {'title': 'Invalid location', 'description': 'A sufficiently detailed report.', 'category': 'Safety', 'location': 'Walkway', 'latitude': 95, 'longitude': 124})
        self.assertEqual(code, 400)
        rid = self.report()
        self.assertEqual(self.student.request('/api/reports/' + str(rid) + '/attachments', 'POST', {'data': base64.b64encode(b'<svg>test</svg>').decode()})[0], 400)
        self.assertEqual(Client(self.base).request('/server.py')[0], 404)
        self.assertEqual(Client(self.base).request('/')[0], 200)


if __name__ == '__main__':
    unittest.main()
