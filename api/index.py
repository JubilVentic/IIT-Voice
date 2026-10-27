"""Vercel entrypoint; business rules remain in the shared Python handler."""

from urllib.parse import parse_qs, urlsplit

import server


class handler(server.Handler):
    def demo_enabled(self):
        return False

    def dispatch(self, method):
        if not server.DATABASE_URL:
            self.send(
                503, {"error": "Online database is not configured. Set DATABASE_URL in Vercel."}
            )
            return
        path = urlsplit(self.path)
        # Vercel may expose the rewritten destination or the original URL.
        if path.path in ("/api", "/api/", "/api/index", "/api/index.py"):
            route = parse_qs(path.query).get("route", [""])[0]
            self.path = "/api/" + route.lstrip("/")
        super().dispatch(method)
