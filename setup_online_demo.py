"""Create isolated demo tables in the existing Supabase project.

Uses the private DATABASE_URL already saved locally. Does not print credentials,
change regular records, or expose schemas through Supabase's browser Data API.
"""

import os
import secrets
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from dotenv import dotenv_values

import server
from database import DEMO_ROLE, DEMO_SCHEMA, connect_postgres


def demo_url(owner_url, password):
    parts = urlsplit(owner_url)
    username = unquote(parts.username or "")
    # Supabase's shared pooler uses ROLE.PROJECT_REF as the username.
    suffix = "." + username.split(".", 1)[1] if "." in username else ""
    host = parts.netloc.rsplit("@", 1)[-1]
    netloc = quote(DEMO_ROLE + suffix, safe="") + ":" + quote(password, safe="") + "@" + host
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def demo_migration():
    source = (server.ROOT / "supabase/migrations/202610270001_iit_voice.sql").read_text()
    # Reuse the application schema. The setup transaction creates the demo schema
    # with its restricted owner before switching role to create the tables.
    source = source.replace("iit_voice", DEMO_SCHEMA)
    excluded = {"BEGIN;", "COMMIT;", "CREATE SCHEMA IF NOT EXISTS " + DEMO_SCHEMA + ";"}
    return "\n".join(line for line in source.splitlines() if line.strip() not in excluded)


def setup():
    if not server.DATABASE_URL:
        raise RuntimeError("Save the existing Supabase DATABASE_URL in .env.local first.")
    config = server.ROOT / ".env.demo.local"
    if config.exists():
        url = dotenv_values(config).get("DEMO_DATABASE_URL", "")
        if not url:
            raise RuntimeError("The existing .env.demo.local has no demo connection setting.")
    else:
        from psycopg import sql

        password = secrets.token_urlsafe(36)
        url = demo_url(server.DATABASE_URL, password)
        # Check the destination can be saved before creating any cloud objects.
        fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with connect_postgres(server.DATABASE_URL) as admin:
                raw = admin.connection
                exists = raw.execute(
                    "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=%s) "
                    "OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s) AS found",
                    (DEMO_SCHEMA, DEMO_ROLE),
                ).fetchone()["found"]
                if exists:
                    raise RuntimeError(
                        "Demo schema or role already exists; refusing to overwrite it."
                    )
                raw.execute(
                    sql.SQL(
                        "CREATE ROLE {} LOGIN PASSWORD {} NOINHERIT NOSUPERUSER "
                        "NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
                    ).format(sql.Identifier(DEMO_ROLE), sql.Literal(password))
                )
                raw.execute(sql.SQL("GRANT {} TO CURRENT_USER").format(sql.Identifier(DEMO_ROLE)))
                raw.execute(
                    sql.SQL("CREATE SCHEMA {} AUTHORIZATION {}").format(
                        sql.Identifier(DEMO_SCHEMA), sql.Identifier(DEMO_ROLE)
                    )
                )
                raw.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(DEMO_ROLE)))
                raw.execute(demo_migration())
            # Keep the restricted credential even if subsequent pooler login or
            # sample-account initialization fails, so setup can be resumed.
            os.write(fd, ("DEMO_DATABASE_URL=" + url + "\n").encode())
        except Exception:
            os.close(fd)
            if config.stat().st_size == 0:
                config.unlink()
            raise
        else:
            os.close(fd)

    factory = lambda: connect_postgres(url, DEMO_SCHEMA)
    with factory() as c:
        server.initialize_defaults(c)
    server.ensure_demo_accounts(connect_db=factory)
    with factory() as c:
        users = c.execute("SELECT count(*) AS count FROM users WHERE is_demo=1").fetchone()["count"]
        reports = c.execute("SELECT count(*) AS count FROM reports").fetchone()["count"]
    print("Online demo prepared in iit_voice_demo with a restricted database role.")
    print("Demo accounts: %s; existing demo reports: %s." % (users, reports))
    print("Private connection saved in .env.demo.local. Regular tables were not modified.")


if __name__ == "__main__":
    try:
        setup()
    except Exception as error:
        # Driver messages may contain connection details. Never echo them.
        print("Demo setup did not finish (%s). No credentials were printed." % type(error).__name__)
        raise SystemExit(1)
