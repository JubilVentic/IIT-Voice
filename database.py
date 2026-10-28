"""Small Postgres bridge for the SQL shared with the local SQLite pilot."""

import sqlite3

DEMO_SCHEMA = "iit_voice_demo"
DEMO_ROLE = "iit_voice_demo_app"


class PostgresConnection:
    def __init__(self, connection, driver, schema="iit_voice"):
        if schema not in ("iit_voice", DEMO_SCHEMA):
            raise ValueError("Unsupported application schema.")
        self.connection = connection
        self.driver = driver
        self.schema = schema

    def __enter__(self):
        self.connection.__enter__()
        return self

    def __exit__(self, *args):
        return self.connection.__exit__(*args)

    def execute(self, query, parameters=None):
        try:
            # Transaction pooling may hand us a different physical connection
            # after each commit. Never rely on a session-level search_path.
            if self.connection.info.transaction_status == self.driver.pq.TransactionStatus.IDLE:
                self.connection.execute("SET LOCAL search_path TO " + self.schema)
            if parameters is not None:
                # Shared application SQL uses ? placeholders, with no literal ?.
                # Values stay separately bound by psycopg, including image bytes.
                query = query.replace("%", "%%").replace("?", "%s")
            return self.connection.execute(query, parameters)
        except self.driver.IntegrityError as error:
            raise sqlite3.IntegrityError("Record constraint violated") from error

    def commit(self):
        self.connection.commit()


def connect_postgres(url, schema="iit_voice"):
    if schema not in ("iit_voice", DEMO_SCHEMA):
        raise ValueError("Unsupported application schema.")
    if not url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError(
            "DATABASE_URL must be the PostgreSQL connection URI from Supabase Connect."
        )
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError:
        raise RuntimeError("Install requirements.txt to enable Supabase Postgres.") from None
    try:
        connection = psycopg.connect(
            url,
            row_factory=dict_row,
            connect_timeout=10,
            sslmode="require",
            prepare_threshold=None,
        )
    except psycopg.OperationalError:
        raise RuntimeError(
            "Could not connect to Supabase. Check the pooler host, database password, URL encoding and project availability."
        ) from None
    if schema == DEMO_SCHEMA:
        try:
            role = connection.execute(
                "SELECT current_user AS name, r.rolsuper, r.rolcreatedb, r.rolcreaterole, "
                "r.rolreplication, r.rolbypassrls, "
                "has_schema_privilege(current_user, 'iit_voice', 'USAGE') AS live_access, "
                "EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS memberships "
                "FROM pg_roles r WHERE r.rolname=current_user"
            ).fetchone()
            if (
                not role
                or role["name"] != DEMO_ROLE
                or any(
                    role[key]
                    for key in (
                        "rolsuper",
                        "rolcreatedb",
                        "rolcreaterole",
                        "rolreplication",
                        "rolbypassrls",
                        "live_access",
                        "memberships",
                    )
                )
            ):
                raise RuntimeError("Demo connection requires its restricted database role.")
            connection.commit()
        except Exception:
            connection.close()
            raise
    return PostgresConnection(connection, psycopg, schema)


def insert_id(connection, query, parameters):
    if isinstance(connection, sqlite3.Connection):
        return connection.execute(query, parameters).lastrowid
    return connection.execute(query + " RETURNING id", parameters).fetchone()["id"]
