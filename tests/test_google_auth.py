"""Google/Supabase protocol boundaries. No live identities, credentials, or network."""

import base64
import hashlib
import io
import json
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import google_auth


class GoogleAuthTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://project-ref.supabase.co",
                "SUPABASE_PUBLISHABLE_KEY": "publishable-test-key",
                "IIT_VOICE_PUBLIC_URL": "http://127.0.0.1:5173",
                "VERCEL": "",
            },
        )
        environment.start()
        self.addCleanup(environment.stop)

    def test_configuration_is_explicit_and_redirect_uses_only_the_configured_origin(self):
        self.assertTrue(google_auth.configured())
        verifier = "server-only-verifier"
        query = parse_qs(urlsplit(google_auth.authorize_url(verifier, "browser-flow")).query)
        self.assertEqual(
            query["redirect_to"],
            ["http://127.0.0.1:5173/api/auth/google/callback?flow=browser-flow"],
        )
        self.assertEqual(
            query["code_challenge"],
            [
                base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
                .decode()
                .rstrip("=")
            ],
        )
        self.assertEqual(query["code_challenge_method"], ["s256"])
        self.assertEqual(query["hd"], ["*"])
        self.assertNotIn(verifier, google_auth.authorize_url(verifier, "browser-flow"))
        for changes in (
            {"SUPABASE_PUBLISHABLE_KEY": ""},
            {"SUPABASE_PUBLISHABLE_KEY": "sb_secret_private"},
            {"SUPABASE_URL": "https://supabase.co.attacker.example"},
            {"IIT_VOICE_PUBLIC_URL": "https://app.example/bad-path"},
            {"VERCEL": "1"},
        ):
            with patch.dict(os.environ, changes):
                self.assertFalse(google_auth.configured())

    def test_google_is_queried_directly_and_managed_domain_is_required(self):
        profile = {
            "sub": "google-subject",
            "email": "PERSON@G.MSUIIT.EDU.PH",
            "name": "Campus Person",
            "email_verified": True,
            "hd": "msuiit.edu.ph",
        }
        with patch(
            "google_auth.request_json",
            side_effect=[{"provider_token": "provider-test-token"}, profile],
        ) as request:
            identity = google_auth.exchange_identity("one-use-code", "server-only-verifier")
            self.assertEqual(identity["email"], "person@g.msuiit.edu.ph")
            token_request, user_request = [call.args[0] for call in request.call_args_list]
            self.assertEqual(
                json.loads(token_request.data),
                {"auth_code": "one-use-code", "code_verifier": "server-only-verifier"},
            )
            self.assertEqual(
                user_request.full_url, "https://openidconnect.googleapis.com/v1/userinfo"
            )
            self.assertEqual(user_request.get_header("Authorization"), "Bearer provider-test-token")
        for bad in (
            {"email": "person@gmail.com"},
            {"email": "person@msuiit.edu.ph"},
            {"email": "person@g.msuiit.edu.ph.evil.example"},
            {"email": "person@other.msuiit.edu.ph"},
            {"email_verified": False},
            {"email_verified": "true"},
            {"hd": None},
            {"hd": "evil.example"},
            {"hd": "g.msuiit.edu.ph.evil.example"},
            {"hd": "other.msuiit.edu.ph"},
            {"sub": ""},
        ):
            with patch(
                "google_auth.request_json",
                side_effect=[{"provider_token": "provider-test-token"}, {**profile, **bad}],
            ):
                with self.assertRaises(google_auth.GoogleSignInError):
                    google_auth.exchange_identity("code", "verifier")
        with patch("google_auth.request_json", return_value={"user": {"user_metadata": profile}}):
            with self.assertRaises(google_auth.GoogleSignInError):
                google_auth.exchange_identity("code", "verifier")

        for hosted_domain in ("msuiit.edu.ph", "g.msuiit.edu.ph"):
            with self.subTest(hosted_domain=hosted_domain), patch(
                "google_auth.request_json",
                side_effect=[
                    {"provider_token": "provider-test-token"},
                    {**profile, "email": "PERSON@G.MSUIIT.EDU.PH", "hd": hosted_domain},
                ],
            ):
                self.assertEqual(
                    google_auth.exchange_identity("code", "verifier")["email"],
                    "person@g.msuiit.edu.ph",
                )

    def test_provider_errors_do_not_disclose_keys_or_tokens(self):
        error = HTTPError(
            "https://project-ref.supabase.co/auth/v1/token",
            400,
            "private-token",
            {},
            io.BytesIO(b'{"error":"private-key"}'),
        )
        with patch("google_auth.urlopen", side_effect=error):
            with self.assertRaises(google_auth.GoogleSignInError) as raised:
                google_auth.exchange_identity("code", "verifier")
        self.assertNotIn("private", str(raised.exception))
