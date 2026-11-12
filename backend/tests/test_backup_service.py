import json
import sqlite3
from datetime import datetime, timezone

import auth_database
import backup_service
import database
import pytest


def _insert_profile(conn, profile_id, name, role):
    conn.execute(
        """
        INSERT INTO users (id, name, role, current_points, status_school, status_sport, color_code)
        VALUES (?, ?, ?, 0, 'GREEN', 'BASE', '#228be6')
        """,
        (profile_id, name, role),
    )


def _create_account(conn, family_id, account_id, email, profile_id):
    conn.execute(
        """
        INSERT INTO accounts (
            id, family_id, email, display_name, password_hash, role,
            profile_id, email_verified, is_active, is_platform_admin, created_at
        ) VALUES (?, ?, ?, ?, ?, 'adult', ?, 1, 1, 0, ?)
        """,
        (
            account_id,
            family_id,
            email,
            email.split("@")[0],
            f"private-password-hash-{account_id}",
            profile_id,
            datetime.now(timezone.utc).isoformat(),
        ),
    )


def test_restore_preserves_family_profile_links_without_exporting_accounts(tmp_path, monkeypatch):
    live_db = tmp_path / "calendar.sqlite3"
    auth_db = tmp_path / "auth.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(live_db))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", auth_db)
    monkeypatch.setattr(auth_database, "TENANT_DB_DIR", tmp_path / "families")
    database.init_db()

    live_calendar = database.get_db_connection()
    try:
        _insert_profile(live_calendar, 1, "Kay", "adult")
        _insert_profile(live_calendar, 2, "Caro", "adult")
        _insert_profile(live_calendar, 3, "Old person", "child_10")
        live_calendar.commit()
    finally:
        live_calendar.close()

    auth_database.init_auth_db()
    auth_conn = auth_database.get_auth_connection()
    try:
        family = auth_conn.execute(
            "SELECT id FROM families WHERE db_key = 'default'"
        ).fetchone()
        _create_account(auth_conn, family["id"], 1, "kay@example.invalid", 1)
        _create_account(auth_conn, family["id"], 2, "caro@example.invalid", 2)
        _create_account(auth_conn, family["id"], 3, "old@example.invalid", 3)
        auth_conn.commit()
    finally:
        auth_conn.close()

    source_db = tmp_path / "source-calendar.sqlite3"
    database.init_db(str(source_db))
    source = database.get_db_connection(source_db)
    try:
        _insert_profile(source, 1, "Kay", "adult")
        _insert_profile(source, 12, "Caro", "adult")
        _insert_profile(source, 13, "New person", "child_14")
        source.commit()
        payload = backup_service._serialize_connection(
            source,
            datetime.now(timezone.utc).isoformat(),
        )
    finally:
        source.close()

    assert all(table["name"] != "accounts" for table in payload["tables"])
    assert all(
        "private-password-hash" not in json.dumps(table)
        for table in payload["tables"]
    )

    backup_service._restore_validated_payload(payload, "uploaded-test-backup")

    auth_conn = auth_database.get_auth_connection()
    try:
        accounts = {
            row["email"]: row
            for row in auth_conn.execute(
                """
                SELECT email, password_hash, profile_id
                FROM accounts ORDER BY id
                """
            )
        }
    finally:
        auth_conn.close()

    assert accounts["kay@example.invalid"]["profile_id"] == 1
    assert accounts["caro@example.invalid"]["profile_id"] == 12
    assert accounts["old@example.invalid"]["profile_id"] is None
    assert accounts["kay@example.invalid"]["password_hash"] == "private-password-hash-1"
    assert accounts["caro@example.invalid"]["password_hash"] == "private-password-hash-2"

    restored_calendar = database.get_db_connection()
    try:
        restored_people = {
            row["name"]: row["id"]
            for row in restored_calendar.execute("SELECT id, name FROM users")
        }
    finally:
        restored_calendar.close()
    assert restored_people == {"Kay": 1, "Caro": 12, "New person": 13}


def test_validate_backup_rejects_authentication_tables():
    payload = {
        "format": backup_service.BACKUP_FORMAT,
        "version": backup_service.BACKUP_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "database": {"user_version": 0, "application_id": 0},
        "schema": [{
            "type": "table",
            "name": "accounts",
            "tbl_name": "accounts",
            "sql": "CREATE TABLE accounts (id INTEGER PRIMARY KEY)",
        }],
        "tables": [{
            "name": "accounts",
            "columns": ["id"],
            "rows": [],
        }],
        "sequences": [],
    }

    with pytest.raises(
        backup_service.InvalidBackupError,
        match="keine Login- oder Authentifizierungsdaten",
    ):
        backup_service._validate_backup(payload)
