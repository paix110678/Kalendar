import re
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import auth_database
import backup_service
import database
import main


def test_existing_invitations_get_history_fields(tmp_path, monkeypatch):
    database_path = tmp_path / "calendar.sqlite3"
    auth_path = tmp_path / "auth.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(database_path))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", auth_path)
    monkeypatch.setattr(auth_database, "TENANT_DB_DIR", tmp_path / "families")
    database.init_db()

    created_at = datetime.now(timezone.utc)
    conn = sqlite3.connect(auth_path)
    conn.executescript(
        """
        CREATE TABLE families (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, db_key TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );
        CREATE TABLE accounts (
            id INTEGER PRIMARY KEY, family_id TEXT NOT NULL, email TEXT NOT NULL,
            display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL,
            profile_id INTEGER, email_verified INTEGER NOT NULL, is_active INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE invitations (
            token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, email TEXT NOT NULL,
            role TEXT NOT NULL, profile_id INTEGER, created_by INTEGER NOT NULL,
            expires_at TEXT NOT NULL, consumed_at TEXT
        );
        """
    )
    conn.execute(
        "INSERT INTO families VALUES ('family', 'Family', 'family-key', ?)",
        (created_at.isoformat(),),
    )
    conn.execute(
        """
        INSERT INTO accounts VALUES
            (1, 'family', 'admin@example.invalid', 'Admin', 'hash', 'admin',
             1, 1, 1, ?)
        """,
        (created_at.isoformat(),),
    )
    conn.execute(
        """
        INSERT INTO invitations VALUES
            ('token-hash', 'family', 'invite@example.invalid', 'child', 2, 1, ?, NULL)
        """,
        ((created_at + timedelta(days=7)).isoformat(),),
    )
    conn.commit()
    conn.close()

    auth_database.init_auth_db()

    conn = auth_database.get_auth_connection()
    try:
        invitation = conn.execute(
            "SELECT invitation_id, created_at FROM invitations"
        ).fetchone()
    finally:
        conn.close()
    assert invitation["invitation_id"]
    assert datetime.fromisoformat(invitation["created_at"]) == created_at


def _token_from_email(email_body: str) -> str:
    match = re.search(r"token=([A-Za-z0-9_-]+)", email_body)
    assert match is not None
    return match.group(1)


def _register_admin(client: TestClient, email: str, family_name: str, sent_emails: list[str]):
    response = client.post(
        "/api/auth/register",
        json={
            "family_name": family_name,
            "display_name": "Family Admin",
            "email": email,
            "password": "A-strong-password-123",
        },
    )
    assert response.status_code == 202
    verify_token = _token_from_email(sent_emails[-1])
    assert client.post("/api/auth/verify-email", json={"token": verify_token}).status_code == 200
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": "A-strong-password-123"},
    )
    assert response.status_code == 200
    assert response.headers["X-CSRF-Token"] == client.cookies.get("kalendar_csrf")
    return response.json()


def test_family_isolation_roles_and_csrf(tmp_path, monkeypatch):
    database_path = tmp_path / "calendar.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(database_path))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", tmp_path / "auth.sqlite3")
    monkeypatch.setattr(auth_database, "TENANT_DB_DIR", tmp_path / "families")
    monkeypatch.setenv("KALENDAR_COOKIE_SECURE", "false")
    monkeypatch.setenv("KALENDAR_SMTP_HOST", "mail.invalid")
    monkeypatch.setenv("KALENDAR_SMTP_FROM", "calendar@example.invalid")
    monkeypatch.setenv("KALENDAR_PUBLIC_URL", "http://testserver")

    sent_emails: list[str] = []
    monkeypatch.setattr(
        "routers.auth._send_email",
        lambda recipient, subject, body: sent_emails.append(body),
    )

    with TestClient(main.app) as client:
        assert client.get("/api/users").status_code == 401
        admin = _register_admin(client, "admin@example.invalid", "One Family", sent_emails)
        csrf = client.cookies.get("kalendar_csrf")
        assert csrf
        assert client.get("/api/auth/me").headers["X-CSRF-Token"] == csrf

        assert client.post(
            "/api/users",
            json={"name": "Child", "role": "child_10"},
        ).status_code == 403
        response = client.post(
            "/api/users",
            json={"name": "Child", "role": "child_10"},
            headers={"X-CSRF-Token": csrf},
        )
        assert response.status_code == 200
        child_profile_id = response.json()["user_id"]

        assert client.post(
            "/api/blocks",
            json={
                "user_id": admin["profile_id"],
                "title": "Adult private item",
                "day_of_week": "Montag",
                "start_time": "09:00",
                "end_time": "10:00",
                "type": "school",
            },
            headers={"X-CSRF-Token": csrf},
        ).status_code == 200
        assert client.post(
            "/api/blocks",
            json={
                "user_id": child_profile_id,
                "title": "Child private item",
                "day_of_week": "Montag",
                "start_time": "10:00",
                "end_time": "11:00",
                "type": "school",
            },
            headers={"X-CSRF-Token": csrf},
        ).status_code == 200
        categories = client.get("/api/blocks/categories").json()
        assert categories
        task = client.post(
            "/api/tasks",
            json={
                "title": "Family task",
                "color": "#228be6",
                "category_id": categories[0]["id"],
                "member_ids": [admin["profile_id"], child_profile_id],
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert task.status_code == 201

        invite = client.post(
            "/api/auth/invitations",
            json={
                "email": "child@example.invalid",
                "role": "child",
                "profile_id": child_profile_id,
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert invite.status_code == 201
        invitation = client.get("/api/auth/invitations")
        assert invitation.status_code == 200
        invitation_record = invitation.json()[0]
        assert invitation_record["email"] == "child@example.invalid"
        assert invitation_record["role"] == "child"
        assert invitation_record["profile_name"] == "Child"
        assert invitation_record["status"] == "pending"

        resent = client.post(
            f"/api/auth/invitations/{invitation_record['id']}/resend",
            headers={"X-CSRF-Token": csrf},
        )
        assert resent.status_code == 200
        original_invitation_token = _token_from_email(sent_emails[-2])
        invitation_token = _token_from_email(sent_emails[-1])

        child_client = TestClient(main.app)
        assert child_client.post(
            "/api/auth/accept-invitation",
            json={
                "token": original_invitation_token,
                "display_name": "Child Login",
                "password": "Another-strong-password-456",
            },
        ).status_code == 400
        accepted = child_client.post(
            "/api/auth/accept-invitation",
            json={
                "token": invitation_token,
                "display_name": "Child Login",
                "password": "Another-strong-password-456",
            },
        )
        assert accepted.status_code == 201
        assert client.get("/api/auth/invitations").json()[0]["status"] == "accepted"
        login = child_client.post(
            "/api/auth/login",
            json={
                "email": "child@example.invalid",
                "password": "Another-strong-password-456",
            },
        )
        assert login.status_code == 200
        child_csrf = child_client.cookies.get("kalendar_csrf")

        visible_users = child_client.get("/api/users").json()
        assert [user["id"] for user in visible_users] == [child_profile_id]
        visible_blocks = child_client.get("/api/blocks/all").json()
        assert [block["title"] for block in visible_blocks] == ["Child private item"]
        visible_tasks = child_client.get("/api/tasks").json()
        assert [item["title"] for item in visible_tasks] == ["Family task"]
        assert visible_tasks[0]["member_ids"] == [child_profile_id]
        assert child_client.get(f"/api/blocks/{admin['profile_id']}").status_code == 404
        assert child_client.get("/api/plans").status_code == 403
        assert child_client.get("/api/config/settings").status_code == 403
        assert child_client.post(
            "/api/users",
            json={"name": "Unauthorized", "role": "child_10"},
            headers={"X-CSRF-Token": child_csrf or ""},
        ).status_code == 403
        assert client.put(
            f"/api/users/{child_profile_id}/status-school",
            json={"status": "RED"},
            headers={"X-CSRF-Token": csrf},
        ).status_code == 200
        assert child_client.post(
            "/api/blocks",
            json={
                "user_id": child_profile_id,
                "title": "Restricted item",
                "day_of_week": "Dienstag",
                "start_time": "10:00",
                "end_time": "11:00",
                "type": "school",
            },
            headers={"X-CSRF-Token": child_csrf or ""},
        ).status_code == 403

        second_client = TestClient(main.app)
        _register_admin(second_client, "second@example.invalid", "Other Family", sent_emails)
        second_users = second_client.get("/api/users").json()
        assert [user["name"] for user in second_users] == ["Family Admin"]
        assert second_client.get("/api/blocks/all").json() == []
        assert second_client.get("/api/auth/accounts").json()[0]["email"] == "second@example.invalid"
        assert second_client.get("/api/auth/invitations").json() == []


def test_legacy_calendar_requires_bootstrap_token(tmp_path, monkeypatch):
    database_path = tmp_path / "calendar.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(database_path))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", tmp_path / "auth.sqlite3")
    monkeypatch.setattr(auth_database, "TENANT_DB_DIR", tmp_path / "families")
    monkeypatch.setenv("KALENDAR_COOKIE_SECURE", "false")
    monkeypatch.setenv("KALENDAR_SMTP_HOST", "mail.invalid")
    monkeypatch.setenv("KALENDAR_SMTP_FROM", "calendar@example.invalid")
    monkeypatch.setenv("KALENDAR_BOOTSTRAP_TOKEN", "a-legacy-calendar-bootstrap-secret")

    sent_emails: list[str] = []
    monkeypatch.setattr(
        "routers.auth._send_email",
        lambda recipient, subject, body: sent_emails.append(body),
    )

    database.init_db()
    conn = database.get_db_connection()
    conn.execute("INSERT INTO users (name, role) VALUES ('Existing Adult', 'adult')")
    conn.commit()
    conn.close()

    with TestClient(main.app) as client:
        payload = {
            "family_name": "Existing Family",
            "display_name": "Owner",
            "email": "owner@example.invalid",
            "password": "A-strong-password-123",
        }
        assert client.post("/api/auth/register", json=payload).status_code == 403
        payload["bootstrap_token"] = "a-legacy-calendar-bootstrap-secret"
        assert client.post("/api/auth/register", json=payload).status_code == 202


def test_password_reset_revokes_sessions_and_token_is_single_use(tmp_path, monkeypatch):
    database_path = tmp_path / "calendar.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(database_path))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", tmp_path / "auth.sqlite3")
    monkeypatch.setattr(auth_database, "TENANT_DB_DIR", tmp_path / "families")
    monkeypatch.setenv("KALENDAR_COOKIE_SECURE", "false")
    monkeypatch.setenv("KALENDAR_SMTP_HOST", "mail.invalid")
    monkeypatch.setenv("KALENDAR_SMTP_FROM", "calendar@example.invalid")

    sent_emails: list[str] = []
    monkeypatch.setattr(
        "routers.auth._send_email",
        lambda recipient, subject, body: sent_emails.append(body),
    )

    with TestClient(main.app) as client:
        _register_admin(client, "admin@example.invalid", "One Family", sent_emails)
        csrf = client.cookies.get("kalendar_csrf")
        request_reset = client.post(
            "/api/auth/request-password-reset",
            json={"email": "admin@example.invalid"},
        )
        assert request_reset.status_code == 200
        reset_token = _token_from_email(sent_emails[-1])

        updated_password = "A-different-password-789"
        reset_response = client.post(
            "/api/auth/reset-password",
            json={"token": reset_token, "password": updated_password},
        )
        assert reset_response.status_code == 200
        assert client.get("/api/auth/me").status_code == 401
        assert client.post(
            "/api/auth/reset-password",
            json={"token": reset_token, "password": "Third-strong-password-012"},
        ).status_code == 400
        assert client.post(
            "/api/auth/login",
            json={
                "email": "admin@example.invalid",
                "password": "A-strong-password-123",
            },
        ).status_code == 401
        assert client.post(
            "/api/auth/login",
            json={"email": "admin@example.invalid", "password": updated_password},
        ).status_code == 200
        assert client.post(
            "/api/auth/logout",
            headers={"X-CSRF-Token": client.cookies.get("kalendar_csrf") or csrf or ""},
        ).status_code == 200


def test_family_backup_directories_are_isolated(tmp_path, monkeypatch):
    database_path = tmp_path / "calendar.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(database_path))

    with database.use_database_file(database_path):
        default_backup_dir = backup_service.get_backup_directory()
    with database.use_database_file(tmp_path / "families" / "first.sqlite3"):
        first_backup_dir = backup_service.get_backup_directory()
    with database.use_database_file(tmp_path / "families" / "second.sqlite3"):
        second_backup_dir = backup_service.get_backup_directory()

    assert default_backup_dir == tmp_path / "backups"
    assert first_backup_dir != second_backup_dir
