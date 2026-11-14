import logging
import os
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import database


AUTH_DB_FILE = Path(
    os.environ.get(
        "KALENDAR_AUTH_DB_PATH",
        str(Path(database.DB_FILE).resolve().parent / "auth.sqlite3"),
    )
)
TENANT_DB_DIR = Path(
    os.environ.get(
        "KALENDAR_TENANT_DB_DIR",
        str(Path(database.DB_FILE).resolve().parent / "families"),
    )
)
_DB_KEY_PATTERN = re.compile(r"^[0-9a-f]{32}$")
logger = logging.getLogger(__name__)


def get_auth_connection():
    AUTH_DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(AUTH_DB_FILE, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_auth_db():
    conn = get_auth_connection()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS families (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                db_key TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                family_id TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'adult', 'teen', 'child', 'guest')),
                profile_id INTEGER,
                weather_location_id INTEGER,
                email_verified INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                is_platform_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(family_id) REFERENCES families(id)
            );
            CREATE INDEX IF NOT EXISTS idx_accounts_family ON accounts(family_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_family_profile
                ON accounts(family_id, profile_id) WHERE profile_id IS NOT NULL;
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                account_id INTEGER NOT NULL,
                csrf_hash TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
            CREATE TABLE IF NOT EXISTS email_tokens (
                token_hash TEXT PRIMARY KEY,
                account_id INTEGER NOT NULL,
                purpose TEXT NOT NULL CHECK(purpose IN ('verify', 'reset')),
                expires_at TEXT NOT NULL,
                consumed_at TEXT,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_email_tokens_account
                ON email_tokens(account_id, purpose);
            CREATE TABLE IF NOT EXISTS invitations (
                    invitation_id TEXT NOT NULL,
                token_hash TEXT PRIMARY KEY,
                family_id TEXT NOT NULL,
                email TEXT NOT NULL COLLATE NOCASE,
                role TEXT NOT NULL CHECK(role IN ('admin', 'adult', 'teen', 'child', 'guest')),
                profile_id INTEGER,
                created_by INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                consumed_at TEXT,
                revoked_at TEXT,
                FOREIGN KEY(family_id) REFERENCES families(id),
                FOREIGN KEY(created_by) REFERENCES accounts(id)
            );
            CREATE TABLE IF NOT EXISTS auth_rate_limits (
                key_hash TEXT PRIMARY KEY,
                window_started INTEGER NOT NULL,
                attempts INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS error_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                diagnostics TEXT NOT NULL,
                screenshot BLOB,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                source_db_key TEXT,
                source_report_id INTEGER
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_error_reports_legacy_source
                ON error_reports(source_db_key, source_report_id)
                WHERE source_db_key IS NOT NULL AND source_report_id IS NOT NULL;
            """
        )
        _migrate_invitation_history(conn)
        _migrate_platform_admin(conn)
        _migrate_account_weather_location(conn)
        conn.commit()
        _migrate_existing_calendar(conn)
        _migrate_legacy_error_reports(conn)
    finally:
        conn.close()


def _migrate_invitation_history(conn):
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(invitations)").fetchall()
    }
    if "invitation_id" not in columns:
        conn.execute("ALTER TABLE invitations ADD COLUMN invitation_id TEXT")
    if "created_at" not in columns:
        conn.execute("ALTER TABLE invitations ADD COLUMN created_at TEXT")
    if "revoked_at" not in columns:
        conn.execute("ALTER TABLE invitations ADD COLUMN revoked_at TEXT")

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_id ON invitations(invitation_id)"
    )
    rows = conn.execute(
        """
        SELECT rowid, invitation_id, created_at, expires_at
        FROM invitations
        WHERE invitation_id IS NULL OR created_at IS NULL
        """
    ).fetchall()
    for row in rows:
        expires_at = datetime.fromisoformat(row["expires_at"])
        conn.execute(
            """
            UPDATE invitations
            SET invitation_id = COALESCE(invitation_id, ?),
                created_at = COALESCE(created_at, ?)
            WHERE rowid = ?
            """,
            (
                uuid.uuid4().hex,
                (expires_at - timedelta(days=7)).isoformat(),
                row["rowid"],
            ),
        )


def _migrate_platform_admin(conn):
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(accounts)").fetchall()
    }
    if "is_platform_admin" not in columns:
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0"
        )


def _migrate_account_weather_location(conn):
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(accounts)").fetchall()
    }
    if "weather_location_id" not in columns:
        conn.execute("ALTER TABLE accounts ADD COLUMN weather_location_id INTEGER")


def _migrate_existing_calendar(auth_conn):
    if auth_conn.execute(
        "SELECT 1 FROM families WHERE db_key = 'default'"
    ).fetchone():
        return

    calendar_conn = database.get_db_connection(database.DB_FILE)
    try:
        has_existing_data = any(
            calendar_conn.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone()
            for table in ("users", "time_blocks", "tasks", "rewards")
        )
    finally:
        calendar_conn.close()

    if has_existing_data:
        auth_conn.execute(
            "INSERT INTO families (id, name, db_key, created_at) VALUES (?, ?, 'default', ?)",
            (uuid.uuid4().hex, "Familienkalender", _now()),
        )
        auth_conn.commit()


def _migrate_legacy_error_reports(auth_conn):
    family_db_keys = [
        row["db_key"]
        for row in auth_conn.execute(
            "SELECT db_key FROM families ORDER BY created_at"
        ).fetchall()
    ]
    family_db_keys = list(dict.fromkeys(["default", *family_db_keys]))

    for db_key in family_db_keys:
        if db_key != "default" and not _DB_KEY_PATTERN.fullmatch(db_key):
            logger.warning(
                "Fehlerberichte für ungültigen Familiendatenbankschlüssel %r "
                "konnten nicht migriert werden.",
                db_key,
            )
            continue
        calendar_path = get_family_db_path(db_key)
        if not calendar_path.is_file():
            continue

        auth_conn.execute(
            "ATTACH DATABASE ? AS legacy_calendar", (str(calendar_path),)
        )
        try:
            table_exists = auth_conn.execute(
                """
                SELECT 1
                FROM legacy_calendar.sqlite_master
                WHERE type = 'table' AND name = 'error_reports'
                """
            ).fetchone()
            if table_exists is None:
                continue

            auth_conn.execute("BEGIN IMMEDIATE")
            auth_conn.execute(
                """
                INSERT OR IGNORE INTO error_reports (
                    description, diagnostics, screenshot, created_at,
                    source_db_key, source_report_id
                )
                SELECT description, diagnostics, screenshot, created_at, ?, id
                FROM legacy_calendar.error_reports
                """,
                (db_key,),
            )
            auth_conn.execute("DROP TABLE legacy_calendar.error_reports")
            auth_conn.commit()
        except sqlite3.Error:
            auth_conn.rollback()
            raise
        finally:
            auth_conn.execute("DETACH DATABASE legacy_calendar")


def get_family_db_path(db_key: str) -> Path:
    if db_key == "default":
        return Path(database.DB_FILE).resolve()
    if not _DB_KEY_PATTERN.fullmatch(db_key):
        raise ValueError("Invalid family database key")
    return TENANT_DB_DIR.resolve() / f"{db_key}.sqlite3"


def get_family(family_id: str):
    conn = get_auth_connection()
    try:
        return conn.execute(
            "SELECT id, name, db_key FROM families WHERE id = ?",
            (family_id,),
        ).fetchone()
    finally:
        conn.close()


def list_family_db_paths() -> list[Path]:
    conn = get_auth_connection()
    try:
        rows = conn.execute("SELECT db_key FROM families ORDER BY created_at").fetchall()
        return [get_family_db_path(row["db_key"]) for row in rows]
    finally:
        conn.close()


def _now():
    return datetime.now(timezone.utc).isoformat()
