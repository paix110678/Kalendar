import json
import sqlite3

import pytest
from pydantic import ValidationError

import database
from routers import plans, users
from routers.users import ApplyPlanPayload


def _plan_payload(days):
    return plans.PlanPayload(
        name="Wechseltage",
        days=days,
        hours_count=1,
        hours=[{"start_time": "08:00", "end_time": "08:45"}],
    )


def test_legacy_plan_days_are_migrated(tmp_path):
    database_path = tmp_path / "legacy-calendar.sqlite3"
    conn = sqlite3.connect(database_path)
    conn.executescript(
        """
        CREATE TABLE plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            start_day TEXT NOT NULL,
            end_day TEXT NOT NULL,
            hours_count INTEGER NOT NULL,
            hours_json TEXT NOT NULL,
            exclude_school_holidays INTEGER NOT NULL DEFAULT 0,
            exclude_public_holidays INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO plans (name, start_day, end_day, hours_count, hours_json)
        VALUES ('Alter Plan', 'Dienstag', 'Freitag', 1, '[]');
        """
    )
    conn.close()

    database.init_db(database_path)

    conn = database.get_db_connection(database_path)
    try:
        plan = conn.execute(
            """
            SELECT days_json, uniform_time, uniform_count, day_hours_json
            FROM plans WHERE name = 'Alter Plan'
            """
        ).fetchone()
    finally:
        conn.close()
    assert json.loads(plan["days_json"]) == ["Dienstag", "Mittwoch", "Donnerstag", "Freitag"]
    assert plan["uniform_time"] == 1
    assert plan["uniform_count"] == 1
    assert json.loads(plan["day_hours_json"]) == {}


def test_plan_crud_persists_arbitrary_selected_days(tmp_path):
    database_path = tmp_path / "plans.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        created = plans.create_plan(_plan_payload(["Freitag", "Montag", "Mittwoch"]))
        assert created["days"] == ["Montag", "Mittwoch", "Freitag"]

        updated = plans.update_plan(
            created["id"],
            plans.PlanPayload(
                name="Wechseltage",
                days=["Samstag", "Dienstag"],
                hours_count=2,
                hours=[
                    {"start_time": "08:00", "end_time": "08:45"},
                    {"start_time": "08:50", "end_time": "09:35"},
                ],
                uniform_time=False,
                uniform_count=False,
                day_hours={
                    "Dienstag": [{"start_time": "09:00", "end_time": "09:45"}],
                    "Samstag": [
                        {"start_time": "10:00", "end_time": "10:45"},
                        {"start_time": "11:00", "end_time": "11:45"},
                    ],
                },
            ),
        )

    assert updated["days"] == ["Dienstag", "Samstag"]
    assert updated["uniform_time"] is False
    assert updated["uniform_count"] is False
    assert updated["day_hours"]["Dienstag"] == [{"start_time": "09:00", "end_time": "09:45"}]


def test_apply_plan_creates_blocks_only_on_selected_days(tmp_path):
    database_path = tmp_path / "apply-plan.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        conn = database.get_db_connection()
        try:
            user_cursor = conn.execute(
                """
                INSERT INTO users (name, role, current_points, status_school, status_sport, color_code)
                VALUES ('Alex', 'child_10', 0, 'GREEN', 'BASE', '#228be6')
                """
            )
            user_id = user_cursor.lastrowid
            event_cursor = conn.execute(
                """
                INSERT INTO person_event_types (user_id, name, color)
                VALUES (?, 'Mathematik', '#228be6')
                """,
                (user_id,),
            )
            event_type_id = event_cursor.lastrowid
            conn.commit()
        finally:
            conn.close()

        plan = plans.create_plan(
            plans.PlanPayload(
                name="Wechseltage",
                days=["Mittwoch", "Montag"],
                hours_count=2,
                hours=[
                    {"start_time": "08:00", "end_time": "08:45"},
                    {"start_time": "08:50", "end_time": "09:35"},
                ],
                uniform_time=False,
                uniform_count=False,
                day_hours={
                    "Montag": [{"start_time": "07:00", "end_time": "07:45"}],
                    "Mittwoch": [
                        {"start_time": "09:00", "end_time": "09:45"},
                        {"start_time": "10:00", "end_time": "10:45"},
                    ],
                },
            ),
        )
        result = users.apply_plan(
            user_id,
            ApplyPlanPayload(
                plan_id=plan["id"],
                title="Stundenplan",
                subjects=[
                    {"day_of_week": "Montag", "period": 1, "event_type_id": event_type_id},
                    {"day_of_week": "Mittwoch", "period": 1, "event_type_id": event_type_id},
                    {"day_of_week": "Mittwoch", "period": 2, "event_type_id": event_type_id},
                ],
            ),
        )

        conn = database.get_db_connection()
        try:
            scheduled_blocks = [
                (row["day_of_week"], row["plan_period"], row["start_time"], row["end_time"])
                for row in conn.execute(
                    """
                    SELECT day_of_week, plan_period, start_time, end_time
                    FROM time_blocks WHERE user_id = ? ORDER BY day_of_week, plan_period
                    """,
                    (user_id,),
                ).fetchall()
            ]
        finally:
            conn.close()

    assert result["created_blocks"] == 3
    assert {
        (day, period): (start, end)
        for day, period, start, end in scheduled_blocks
    } == {
        ("Montag", 1): ("07:00", "07:45"),
        ("Mittwoch", 1): ("09:00", "09:45"),
        ("Mittwoch", 2): ("10:00", "10:45"),
    }


def test_plan_requires_at_least_one_day():
    with pytest.raises(ValidationError):
        _plan_payload([])


def test_plan_accepts_individual_times_with_uniform_hour_count():
    payload = plans.PlanPayload(
        name="Tischtennis Kay",
        days=["Montag", "Donnerstag"],
        hours_count=1,
        hours=[{"start_time": "08:00", "end_time": "08:45"}],
        uniform_time=False,
        uniform_count=True,
        day_hours={
            "Montag": [{"start_time": "19:00", "end_time": "22:00"}],
            "Donnerstag": [{"start_time": "19:00", "end_time": "21:00"}],
        },
    )

    assert payload.uniform_count is True
    assert payload.day_hours["Montag"][0].end_time == "22:00"
