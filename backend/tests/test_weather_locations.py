import sqlite3
from pathlib import Path

import auth_database
import database
import pytest
from routers import config
from security import AccountContext


def test_weather_location_migration_removes_name_and_provider_columns(tmp_path):
    database_path = tmp_path / "calendar.sqlite3"
    conn = sqlite3.connect(database_path)
    conn.executescript(
        """
        CREATE TABLE weather_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            weather_city TEXT NOT NULL DEFAULT '',
            weather_plz TEXT NOT NULL DEFAULT '',
            weather_service TEXT NOT NULL DEFAULT 'open_meteo',
            api_key TEXT NOT NULL DEFAULT '',
            weather_latitude REAL,
            weather_longitude REAL,
            is_active INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO weather_locations
            (id, name, weather_city, weather_plz, weather_service, api_key,
             weather_latitude, weather_longitude, is_active)
        VALUES (7, 'Duplicate city label', 'Berlin', '10115', 'weather_api',
                'internal-key', 52.532, 13.384, 1);
        """
    )
    conn.commit()
    conn.close()

    database.init_db(str(database_path))

    conn = sqlite3.connect(database_path)
    try:
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(weather_locations)")
        }
        location = conn.execute(
            "SELECT id, weather_city, weather_plz, weather_latitude, weather_longitude "
            "FROM weather_locations WHERE id = 7"
        ).fetchone()
    finally:
        conn.close()

    assert columns == {
        "id",
        "weather_city",
        "weather_plz",
        "weather_latitude",
        "weather_longitude",
        "is_active",
    }
    assert location == (7, "Berlin", "10115", 52.532, 13.384)


def test_weather_location_migration_removes_legacy_provider_columns_without_name(
    tmp_path,
):
    database_path = tmp_path / "calendar.sqlite3"
    conn = sqlite3.connect(database_path)
    conn.executescript(
        """
        CREATE TABLE weather_locations (
            id INTEGER PRIMARY KEY,
            weather_city TEXT NOT NULL DEFAULT '',
            weather_plz TEXT NOT NULL DEFAULT '',
            weather_service TEXT NOT NULL DEFAULT 'open_meteo',
            api_key TEXT NOT NULL DEFAULT '',
            weather_latitude REAL,
            weather_longitude REAL,
            is_active INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    conn.commit()
    conn.close()

    database.init_db(str(database_path))

    conn = sqlite3.connect(database_path)
    try:
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(weather_locations)")
        }
    finally:
        conn.close()

    assert "weather_service" not in columns
    assert "api_key" not in columns


def test_account_weather_location_column_is_migrated(tmp_path, monkeypatch):
    calendar_path = tmp_path / "calendar.sqlite3"
    auth_path = tmp_path / "auth.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(calendar_path))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", auth_path)
    database.init_db()

    conn = sqlite3.connect(auth_path)
    conn.execute(
        """
        CREATE TABLE accounts (
            id INTEGER PRIMARY KEY,
            family_id TEXT NOT NULL,
            email TEXT NOT NULL,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            profile_id INTEGER,
            email_verified INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            is_platform_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()

    auth_database.init_auth_db()

    conn = sqlite3.connect(auth_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(accounts)")}
    finally:
        conn.close()
    assert "weather_location_id" in columns


def test_profile_weather_location_is_per_account_and_api_hides_secrets(tmp_path, monkeypatch):
    calendar_path = tmp_path / "family.sqlite3"
    auth_path = tmp_path / "auth.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(calendar_path))
    monkeypatch.setattr(auth_database, "AUTH_DB_FILE", auth_path)
    database.init_db()
    auth_database.init_auth_db()

    calendar_conn = database.get_db_connection(calendar_path)
    try:
        calendar_conn.execute(
            """
            INSERT INTO weather_locations (
                weather_city, weather_plz, weather_latitude, weather_longitude, is_active
            ) VALUES ('Hamburg', '20095', 53.55, 10.0, 0)
            """
        )
        calendar_conn.commit()
    finally:
        calendar_conn.close()

    auth_conn = auth_database.get_auth_connection()
    try:
        auth_conn.execute(
            "INSERT INTO families (id, name, db_key, created_at) VALUES (?, ?, ?, ?)",
            ("family-id", "Testfamilie", "a" * 32, "2026-01-01T00:00:00+00:00"),
        )
        auth_conn.execute(
            """
            INSERT INTO accounts (
                id, family_id, email, display_name, password_hash, role, profile_id,
                email_verified, is_active, is_platform_admin, created_at
            ) VALUES (1, 'family-id', 'account@example.invalid', 'Account', 'hash',
                      'adult', 1, 1, 1, 0, '2026-01-01T00:00:00+00:00')
            """
        )
        auth_conn.commit()
    finally:
        auth_conn.close()

    actor = AccountContext(
        id=1,
        family_id="family-id",
        email="account@example.invalid",
        display_name="Account",
        role="adult",
        profile_id=1,
        is_platform_admin=False,
        db_file=Path(calendar_path),
    )

    def fake_weather(location):
        return {
            "weather_city": location["weather_city"],
            "weather_plz": location["weather_plz"],
            "weather_latitude": location["weather_latitude"],
            "weather_longitude": location["weather_longitude"],
            "live_temp": "12",
            "live_rain": "0%",
            "high_temp": "14",
            "low_temp": "8",
        }

    monkeypatch.setattr(config, "fetch_live_weather_pure_ram", fake_weather)
    with database.use_database_file(calendar_path):
        initial = config.get_profile_weather(actor)
        updated = config.update_profile_weather(
            config.ProfileWeatherSelection(location_id=2),
            actor,
        )

    assert initial["selected_location_id"] == 1
    assert updated["selected_location_id"] == 2
    assert updated["weather_city"] == "Hamburg"
    assert "api_key" not in updated
    assert "weather_service" not in updated
    assert all("name" not in location for location in updated["locations"])
    assert all("api_key" not in location for location in updated["locations"])

    auth_conn = auth_database.get_auth_connection()
    try:
        selected_id = auth_conn.execute(
            "SELECT weather_location_id FROM accounts WHERE id = 1"
        ).fetchone()[0]
    finally:
        auth_conn.close()
    assert selected_id == 2


def test_weather_location_create_accepts_only_postal_code(tmp_path, monkeypatch):
    database_path = tmp_path / "family.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(database_path))
    database.init_db()
    monkeypatch.setattr(
        config,
        "_lookup_weather_location",
        lambda _: ("Dresden", 51.05, 13.74),
    )

    with database.use_database_file(database_path):
        location = config.create_weather_location(
            config.WeatherLocationCreate(weather_plz="01067")
        )

    assert location == {
        "id": 2,
        "weather_city": "Dresden",
        "weather_plz": "01067",
        "weather_latitude": 51.05,
        "weather_longitude": 13.74,
        "location_error": None,
    }


def test_postal_code_lookup_falls_back_when_primary_coordinates_are_invalid(monkeypatch):
    responses = [
        {
            "places": [
                {
                    "place name": "Bremen",
                    "latitude": "04011",
                    "longitude": "53.1728",
                }
            ]
        },
        [
            {
                "lat": "53.1515687",
                "lon": "8.7094980",
                "address": {
                    "postcode": "28719",
                    "city": "Bremen",
                    "country_code": "de",
                },
            }
        ],
    ]
    calls = []

    class FakeResponse:
        def __init__(self, data):
            self.data = data

        def raise_for_status(self):
            return None

        def json(self):
            return self.data

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        return FakeResponse(responses.pop(0))

    monkeypatch.setattr(config.requests, "get", fake_get)

    assert config._lookup_weather_location("28719") == (
        "Bremen",
        53.1515687,
        8.709498,
    )
    assert len(calls) == 2
    assert calls[1][0] == "https://nominatim.openstreetmap.org/search"
    assert calls[1][1]["params"]["postalcode"] == "28719"


def test_weather_location_is_not_created_when_postal_code_cannot_be_resolved(
    tmp_path, monkeypatch
):
    database_path = tmp_path / "family.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(database_path))
    database.init_db()

    def failed_lookup(_):
        raise config.LocationLookupError("PLZ nicht gefunden")

    monkeypatch.setattr(config, "_lookup_weather_location", failed_lookup)

    with database.use_database_file(database_path):
        with pytest.raises(config.HTTPException) as error:
            config.create_weather_location(
                config.WeatherLocationCreate(weather_plz="99999")
            )

        conn = database.get_db_connection()
        try:
            location_count = conn.execute(
                "SELECT COUNT(*) FROM weather_locations"
            ).fetchone()[0]
        finally:
            conn.close()

    assert error.value.status_code == 502
    assert location_count == 1
