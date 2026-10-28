"""Postgres transaction-pooler and Vercel routing contracts; no cloud credentials used."""

import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import server
from api.index import handler
from database import DEMO_ROLE, DEMO_SCHEMA, PostgresConnection, connect_postgres, insert_id
from setup_online_demo import demo_migration, demo_url


class DatabaseTests(unittest.TestCase):
    def test_demo_connection_requires_a_role_that_cannot_access_regular_data(self):
        import psycopg

        role = {
            "name": DEMO_ROLE,
            "rolsuper": False,
            "rolcreatedb": False,
            "rolcreaterole": False,
            "rolreplication": False,
            "rolbypassrls": False,
            "live_access": False,
            "memberships": False,
        }
        raw = Mock()
        raw.execute.return_value.fetchone.return_value = role
        with patch.object(psycopg, "connect", return_value=raw):
            connection = connect_postgres("postgresql://demo-placeholder", DEMO_SCHEMA)
            self.assertEqual(connection.schema, DEMO_SCHEMA)
            for invalid in (
                {**role, "name": "postgres"},
                {**role, "live_access": True},
                {**role, "memberships": True},
                {**role, "rolcreaterole": True},
            ):
                raw.execute.return_value.fetchone.return_value = invalid
                with self.assertRaises(RuntimeError):
                    connect_postgres("postgresql://demo-placeholder", DEMO_SCHEMA)
                raw.close.assert_called()
        with self.assertRaises(ValueError):
            PostgresConnection(raw, Mock(), "iit_voice; DROP SCHEMA public")

    def test_demo_setup_targets_only_the_separate_schema(self):
        migration = demo_migration()
        self.assertIn("SET LOCAL search_path TO iit_voice_demo", migration)
        self.assertNotIn("TO iit_voice;", migration)
        self.assertNotIn("BEGIN;", migration)
        self.assertNotIn("COMMIT;", migration)
        self.assertEqual(
            demo_url(
                "postgresql://postgres.example:unused@pooler.example:6543/postgres?sslmode=require",
                "a+b@c",
            ),
            "postgresql://iit_voice_demo_app.example:a%2Bb%40c@pooler.example:6543/postgres?sslmode=require",
        )

    def test_bound_parameters_and_schema_are_restored_after_each_commit(self):
        raw = Mock()
        raw.info.transaction_status = 0

        def execute(query, parameters=None):
            raw.info.transaction_status = 2
            return Mock()

        raw.execute.side_effect = execute
        raw.commit.side_effect = lambda: setattr(raw.info, "transaction_status", 0)
        driver = SimpleNamespace(
            pq=SimpleNamespace(TransactionStatus=SimpleNamespace(IDLE=0)),
            IntegrityError=type("IntegrityError", (Exception,), {}),
        )
        connection = PostgresConnection(raw, driver)
        malicious = "student'); DROP TABLE users; --"
        photo = b"\x00\xffimage"
        connection.execute("SELECT * FROM users WHERE email=? AND name LIKE 'A%'", (malicious,))
        connection.execute("SELECT ? AS photo", (photo,))
        connection.commit()
        connection.execute("SELECT 1")
        calls = raw.execute.call_args_list
        self.assertEqual(
            sum(call.args[0] == "SET LOCAL search_path TO iit_voice" for call in calls), 2
        )
        self.assertEqual(
            calls[1].args, ("SELECT * FROM users WHERE email=%s AND name LIKE 'A%%'", (malicious,))
        )
        self.assertEqual(calls[2].args, ("SELECT %s AS photo", (photo,)))
        self.assertNotIn(malicious, calls[1].args[0])
        raw.execute.side_effect = driver.IntegrityError("private database detail")
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute("INSERT INTO users VALUES(?)", ("duplicate",))

    def test_inserted_ids_are_returned_for_both_databases(self):
        with sqlite3.connect(":memory:") as connection:
            connection.execute("CREATE TABLE reports(id INTEGER PRIMARY KEY, title TEXT)")
            self.assertEqual(
                insert_id(connection, "INSERT INTO reports(title) VALUES(?)", ("One",)), 1
            )
        postgres = Mock()
        postgres.execute.return_value.fetchone.return_value = {"id": 42}
        self.assertEqual(insert_id(postgres, "INSERT INTO reports(title) VALUES(?)", ("Two",)), 42)
        postgres.execute.assert_called_once_with(
            "INSERT INTO reports(title) VALUES(?) RETURNING id", ("Two",)
        )

    def test_vercel_rewrites_preserve_the_shared_authorization_handler(self):
        request = handler.__new__(handler)
        request.send = Mock()
        with patch.object(server, "DATABASE_URL", ""):
            request.dispatch("GET")
        self.assertEqual(request.send.call_args.args[0], 503)
        with patch.object(server, "DEMO_DATABASE_URL", ""):
            self.assertFalse(request.demo_enabled())
        with (
            patch.object(server, "DATABASE_URL", "regular"),
            patch.object(server, "DEMO_DATABASE_URL", "demo"),
        ):
            self.assertTrue(request.demo_enabled())
        with (
            patch.object(server, "DATABASE_URL", "configured"),
            patch.object(server.Handler, "dispatch") as dispatch,
        ):
            for incoming, expected in (
                ("/api?route=reports/17/attachments", "/api/reports/17/attachments"),
                ("/api/index?route=me", "/api/me"),
                ("/api/login", "/api/login"),
            ):
                request.path = incoming
                request.dispatch("POST")
                self.assertEqual(request.path, expected)
                dispatch.assert_called_with("POST")


if __name__ == "__main__":
    unittest.main()
