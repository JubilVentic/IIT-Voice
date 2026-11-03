"""Supabase-managed Google OAuth with server-side PKCE and Google identity checks."""

import base64
import hashlib
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


class GoogleSignInError(Exception):
    pass


def configuration():
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
    origin = os.environ.get("IIT_VOICE_PUBLIC_URL", "").strip().rstrip("/")
    project, site = urlsplit(url), urlsplit(origin)
    local = site.scheme == "http" and site.hostname in ("localhost", "127.0.0.1", "::1")
    if not (
        project.scheme == "https"
        and project.hostname
        and project.hostname.endswith(".supabase.co")
        and not project.username
        and not project.path
        and not project.query
        and not project.fragment
        and key
        and not key.startswith("sb_secret_")
        and site.netloc
        and not site.username
        and not site.path
        and not site.query
        and not site.fragment
        and (site.scheme == "https" or (local and os.environ.get("VERCEL") != "1"))
    ):
        raise GoogleSignInError(
            "Google sign-in is not configured yet. Use email and password or continue anonymously."
        )
    return url, key, origin


def configured():
    try:
        configuration()
        return True
    except GoogleSignInError:
        return False


def authorize_url(verifier, flow):
    url, _, origin = configuration()
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    return (
        url
        + "/auth/v1/authorize?"
        + urlencode(
            {
                "provider": "google",
                "redirect_to": origin + "/api/auth/google/callback?" + urlencode({"flow": flow}),
                "code_challenge": challenge,
                "code_challenge_method": "s256",
                "scopes": "openid email profile",
                "hd": "*",
                "prompt": "select_account",
            }
        )
    )


def request_json(request):
    try:
        with urlopen(request, timeout=15) as response:
            body = response.read(65537)
        if len(body) > 65536:
            raise ValueError("Response too large")
        result = json.loads(body)
        if not isinstance(result, dict):
            raise ValueError("Expected object")
        return result
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        # Provider responses can contain tokens and internal configuration. Never echo them.
        raise GoogleSignInError(
            "Google sign-in could not be completed. Please try again or use another sign-in option."
        ) from None


def exchange_identity(code, verifier):
    url, key, _ = configuration()
    tokens = request_json(
        Request(
            url + "/auth/v1/token?grant_type=pkce",
            data=json.dumps({"auth_code": code, "code_verifier": verifier}).encode(),
            headers={"Content-Type": "application/json", "apikey": key},
            method="POST",
        )
    )
    provider_token = tokens.get("provider_token")
    if (
        not isinstance(provider_token, str)
        or not provider_token
        or "\n" in provider_token
        or "\r" in provider_token
    ):
        raise GoogleSignInError(
            "Google did not provide a verifiable identity. Start Google sign-in again."
        )
    # Ask Google directly; never trust browser-supplied claims or editable user metadata.
    identity = request_json(
        Request(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": "Bearer " + provider_token},
        )
    )
    email, subject = identity.get("email"), identity.get("sub")
    if not (
        identity.get("email_verified") is True
        and identity.get("hd") in ("msuiit.edu.ph", "g.msuiit.edu.ph")
        and isinstance(email, str)
        and re.fullmatch(r"[^\s@]+@g\.msuiit\.edu\.ph", email, re.I)
        and isinstance(subject, str)
        and 0 < len(subject) <= 255
    ):
        raise GoogleSignInError(
            "Choose your @g.msuiit.edu.ph university Google account. Personal Google accounts cannot sign in here."
        )
    name = identity.get("name")
    return {
        "email": email.lower(),
        "sub": subject,
        "name": name[:100] if isinstance(name, str) else "",
    }
