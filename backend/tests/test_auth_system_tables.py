from pathlib import Path

import auth_database
import database
from routers import auth
from security import AccountContext


def test_system_table_inspector_scopes_rows_and_redacts_secrets(tmp_path, monkeypatch):
    database_path = tmp_path / "calendar.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(database_path))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", tmp_path / "auth.sqlite3")
    monkeypatch.setattr(auth_database, "TENANT_DB_DIR", tmp_path / "families")
    database.init_db(database_path)
    auth_database.init_auth_db()

    conn = auth_database.get_auth_connection()
    try:
        conn.executemany(
            "INSERT INTO families (id, name, db_key, created_at) VALUES (?, ?, ?, ?)",
            [
                ("family-one", "Familie Eins", "default", "2026-01-01"),
                ("family-two", "Familie Zwei", "a" * 32, "2026-01-02"),
            ],
        )
        conn.executemany(
            """
            INSERT INTO accounts (id, family_id, email, display_name, password_hash, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (1, "family-one", "one@example.invalid", "Eins", "hash-one", "admin", "2026-01-01"),
                (2, "family-two", "two@example.invalid", "Zwei", "hash-two", "adult", "2026-01-02"),
            ],
        )
        conn.execute(
            """
            INSERT INTO sessions (token_hash, account_id, csrf_hash, expires_at, created_at)
            VALUES ('session-secret', 1, 'csrf-secret', '2027-01-01', '2026-01-01')
            """
        )
        conn.commit()
    finally:
        conn.close()

    actor = AccountContext(
        id=1,
        family_id="family-one",
        email="one@example.invalid",
        display_name="Eins",
        role="admin",
        profile_id=1,
        is_platform_admin=False,
        db_file=Path(database_path),
    )

    table_names = auth.list_system_tables(actor)
    accounts = auth.get_system_table_data("accounts", actor)
    sessions = auth.get_system_table_data("sessions", actor)
    rate_limits = auth.get_system_table_data("auth_rate_limits", actor)

    assert {"families", "accounts", "sessions", "invitations"} <= set(table_names)
    assert [row["email"] for row in accounts["rows"]] == ["one@example.invalid"]
    assert accounts["rows"][0]["password_hash"] == "[ausgeblendet]"
    assert sessions["rows"][0]["token_hash"] == "[ausgeblendet]"
    assert sessions["rows"][0]["csrf_hash"] == "[ausgeblendet]"
    assert rate_limits["rows"] == []
