import json
import re
import sqlite3

import auth_database
import database
import main
from fastapi.testclient import TestClient
from routers.error_reports import ErrorReportPayload, ReportDiagnostics, create_error_report


def _payload():
    return ErrorReportPayload(
        description="Ein Fehler in der Anwendung",
        diagnostics=ReportDiagnostics(
            browser="Testbrowser",
            platform="Testsystem",
            language="de-DE",
            timezone="Europe/Berlin",
            route="/kalender",
            viewport_width=1280,
            viewport_height=720,
            screen_width=1280,
            screen_height=720,
            device_pixel_ratio=1,
            color_depth=24,
        ),
    )


def test_error_report_is_stored_in_central_database(tmp_path, monkeypatch):
    family_db = tmp_path / "calendar.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(family_db))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", tmp_path / "auth.sqlite3")
    monkeypatch.setattr(auth_database, "TENANT_DB_DIR", tmp_path / "families")
    database.init_db()
    auth_database.init_auth_db()

    with database.use_database_file(family_db):
        response = create_error_report(_payload())

    central = auth_database.get_auth_connection()
    try:
        report = central.execute(
            "SELECT description, diagnostics FROM error_reports WHERE id = ?",
            (response["id"],),
        ).fetchone()
    finally:
        central.close()
    assert report["description"] == "Ein Fehler in der Anwendung"
    assert json.loads(report["diagnostics"])["route"] == "/kalender"

    family = database.get_db_connection(family_db)
    try:
        assert family.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'error_reports'"
        ).fetchone() is None
    finally:
        family.close()


def test_legacy_family_error_reports_are_moved_to_central_database(
    tmp_path, monkeypatch
):
    family_db = tmp_path / "calendar.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(family_db))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", tmp_path / "auth.sqlite3")
    monkeypatch.setattr(auth_database, "TENANT_DB_DIR", tmp_path / "families")
    database.init_db()

    legacy = sqlite3.connect(family_db)
    legacy.execute(
        """
        CREATE TABLE error_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            diagnostics TEXT NOT NULL,
            screenshot BLOB,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    legacy.execute(
        "INSERT INTO error_reports (description, diagnostics) VALUES (?, ?)",
        ("Ein alter Fehlerbericht", '{"route":"/kalender"}'),
    )
    legacy.commit()
    legacy.close()

    auth_database.init_auth_db()

    central = auth_database.get_auth_connection()
    try:
        report = central.execute(
            """
            SELECT description, source_db_key, source_report_id
            FROM error_reports
            """
        ).fetchone()
    finally:
        central.close()
    assert report["description"] == "Ein alter Fehlerbericht"
    assert report["source_db_key"] == "default"
    assert report["source_report_id"] == 1

    legacy = sqlite3.connect(family_db)
    try:
        assert legacy.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'error_reports'"
        ).fetchone() is None
    finally:
        legacy.close()


def test_authenticated_error_report_api_uses_central_database(tmp_path, monkeypatch):
    family_db = tmp_path / "calendar.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(family_db))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", tmp_path / "auth.sqlite3")
    monkeypatch.setattr(auth_database, "TENANT_DB_DIR", tmp_path / "families")
    monkeypatch.setenv("KALENDAR_COOKIE_SECURE", "false")
    monkeypatch.setenv("KALENDAR_SMTP_HOST", "mail.invalid")
    monkeypatch.setenv("KALENDAR_SMTP_FROM", "calendar@example.invalid")
    monkeypatch.setenv("KALENDAR_PUBLIC_URL", "http://testserver")

    sent_emails = []
    monkeypatch.setattr(
        "routers.auth._send_email",
        lambda recipient, subject, body: sent_emails.append(body),
    )

    with TestClient(main.app) as client:
        registration = client.post(
            "/api/auth/register",
            json={
                "family_name": "Testfamilie",
                "display_name": "Admin",
                "email": "reporter@example.invalid",
                "password": "A-strong-password-123",
            },
        )
        assert registration.status_code == 202
        token = re.search(r"token=([A-Za-z0-9_-]+)", sent_emails[-1])
        assert token is not None
        assert client.post(
            "/api/auth/verify-email", json={"token": token.group(1)}
        ).status_code == 200
        assert client.post(
            "/api/auth/login",
            json={
                "email": "reporter@example.invalid",
                "password": "A-strong-password-123",
            },
        ).status_code == 200

        screenshot = "data:image/jpeg;base64,/9h0ZXN0/9k="
        report_payload = _payload().model_dump(mode="json")
        report_payload["screenshot"] = screenshot
        response = client.post(
            "/api/error-reports",
            json=report_payload,
            headers={"X-CSRF-Token": client.cookies.get("kalendar_csrf") or ""},
        )

    assert response.status_code == 200, response.text
    central = auth_database.get_auth_connection()
    try:
        report = central.execute(
            "SELECT description, screenshot FROM error_reports WHERE id = ?",
            (response.json()["id"],),
        ).fetchone()
    finally:
        central.close()
    assert report["description"] == "Ein Fehler in der Anwendung"
    assert report["screenshot"] == b"\xff\xd8test\xff\xd9"
