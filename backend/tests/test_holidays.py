import database
from routers import holidays


def test_delete_holiday_state_unlinks_members_in_that_state(tmp_path, monkeypatch):
    database_path = tmp_path / "calendar.sqlite3"
    monkeypatch.setattr(database, "DB_FILE", str(database_path))
    database.init_db()

    conn = database.get_db_connection()
    try:
        conn.executemany(
            "INSERT INTO users (name, role, state_code) VALUES (?, ?, ?)",
            [
                ("Berlin member", "adult", "BE"),
                ("Bavaria member", "adult", "BY"),
                ("Unassigned member", "adult", None),
            ],
        )
        conn.execute(
            "INSERT INTO holiday_states (state_code, added_at) VALUES (?, ?)",
            ("BE", "2026-01-01T00:00:00+00:00"),
        )
        conn.execute(
            """
            INSERT INTO holidays (state_code, year, holiday_type, name, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("BE", 2026, "school", "Winterferien", "2026-02-02", "2026-02-07"),
        )
        conn.commit()
    finally:
        conn.close()

    holidays.delete_holiday_state("BE")

    conn = database.get_db_connection()
    try:
        members = conn.execute(
            "SELECT name, state_code FROM users ORDER BY name"
        ).fetchall()
        remaining_holidays = conn.execute(
            "SELECT COUNT(*) FROM holidays WHERE state_code = ?", ("BE",)
        ).fetchone()[0]
        remaining_states = conn.execute(
            "SELECT COUNT(*) FROM holiday_states WHERE state_code = ?", ("BE",)
        ).fetchone()[0]
    finally:
        conn.close()

    assert [(member["name"], member["state_code"]) for member in members] == [
        ("Bavaria member", "BY"),
        ("Berlin member", None),
        ("Unassigned member", None),
    ]
    assert remaining_holidays == 0
    assert remaining_states == 0
