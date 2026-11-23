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


def test_plan_update_saves_added_and_empty_task_slots(tmp_path):
    database_path = tmp_path / "plan-task-slots.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        created = plans.create_plan(
            plans.PlanPayload(
                name="Task-Slots",
                days=["Montag"],
                hours_count=1,
                hours=[{"start_time": "08:00", "end_time": "08:45"}],
                uniform_activities=False,
                activity_subjects={"Montag": [41]},
            ),
        )
        updated = plans.update_plan(
            created["id"],
            plans.PlanPayload(
                name="Task-Slots",
                days=["Montag"],
                hours_count=2,
                hours=[
                    {"start_time": "08:00", "end_time": "08:45"},
                    {"start_time": "08:50", "end_time": "09:35"},
                ],
                uniform_activities=False,
                activity_subjects={"Montag": [41, 0]},
            ),
        )

    assert updated["hours_count"] == 2
    assert updated["activity_subjects"] == {"Montag": [41, 0]}


def test_apply_plan_does_not_create_blocks_for_unassigned_slots(tmp_path):
    database_path = tmp_path / "empty-plan-slots.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        conn = database.get_db_connection()
        try:
            user_id = conn.execute(
                """
                INSERT INTO users (name, role, current_points, status_school, status_sport, color_code)
                VALUES ('Alex', 'child_10', 0, 'GREEN', 'BASE', '#228be6')
                """
            ).lastrowid
            category_id = conn.execute(
                "INSERT INTO categories (value, label, color, default_short) VALUES (?, ?, ?, ?)",
                ("plan-empty-slot", "Plan-Empty-Slot", "#228be6", "PES"),
            ).lastrowid
            task_id = conn.execute(
                "INSERT INTO tasks (title, color, category_id) VALUES (?, ?, ?)",
                ("Mathematik", "#228be6", category_id),
            ).lastrowid
            conn.commit()
        finally:
            conn.close()

        plan = plans.create_plan(
            plans.PlanPayload(
                name="Teilweise befüllt",
                days=["Montag"],
                hours_count=2,
                hours=[
                    {"start_time": "08:00", "end_time": "08:45"},
                    {"start_time": "08:50", "end_time": "09:35"},
                ],
                uniform_activities=False,
                activity_subjects={"Montag": [task_id, 0]},
            ),
        )
        result = users.apply_plan(
            user_id,
            ApplyPlanPayload(plan_id=plan["id"], title=plan["name"], subjects=[]),
        )

        conn = database.get_db_connection()
        try:
            blocks = conn.execute(
                """
                SELECT plan_period, title
                FROM time_blocks
                WHERE user_id = ? AND plan_assignment_id = ?
                """,
                (user_id, result["assignment_id"]),
            ).fetchall()
        finally:
            conn.close()

    assert result["created_blocks"] == 1
    assert [(block["plan_period"], block["title"]) for block in blocks] == [(1, "Mathematik")]


def test_applying_plan_without_tasks_creates_no_calendar_blocks(tmp_path):
    database_path = tmp_path / "plan-without-tasks.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        conn = database.get_db_connection()
        try:
            user_id = conn.execute(
                """
                INSERT INTO users (name, role, current_points, status_school, status_sport, color_code)
                VALUES ('Alex', 'child_10', 0, 'GREEN', 'BASE', '#228be6')
                """
            ).lastrowid
            conn.commit()
        finally:
            conn.close()
        plan = plans.create_plan(
            plans.PlanPayload(
                name="Ohne Tasks",
                days=["Montag"],
                hours_count=1,
                hours=[{"start_time": "08:00", "end_time": "08:45"}],
                uniform_activities=True,
                uniform_task_id=None,
            ),
        )
        result = users.apply_plan(
            user_id,
            ApplyPlanPayload(plan_id=plan["id"], title=plan["name"], subjects=[]),
        )
        conn = database.get_db_connection()
        try:
            block_count = conn.execute(
                "SELECT COUNT(*) FROM time_blocks WHERE plan_assignment_id = ?",
                (result["assignment_id"],),
            ).fetchone()[0]
        finally:
            conn.close()

    assert result["created_blocks"] == 0
    assert block_count == 0


def test_updating_plan_tasks_updates_assigned_blocks_and_removes_empty_slots(tmp_path):
    database_path = tmp_path / "updated-plan-tasks.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        conn = database.get_db_connection()
        try:
            user_id = conn.execute(
                """
                INSERT INTO users (name, role, current_points, status_school, status_sport, color_code)
                VALUES ('Alex', 'child_10', 0, 'GREEN', 'BASE', '#228be6')
                """
            ).lastrowid
            category_id = conn.execute(
                "INSERT INTO categories (value, label, color, default_short) VALUES (?, ?, ?, ?)",
                ("plan-updated-task", "Plan-Updated-Task", "#228be6", "PUT"),
            ).lastrowid
            first_task_id = conn.execute(
                "INSERT INTO tasks (title, color, category_id) VALUES (?, ?, ?)",
                ("Altes Fach", "#228be6", category_id),
            ).lastrowid
            second_task_id = conn.execute(
                "INSERT INTO tasks (title, color, category_id) VALUES (?, ?, ?)",
                ("Neues Fach", "#40c057", category_id),
            ).lastrowid
            conn.commit()
        finally:
            conn.close()

        plan = plans.create_plan(
            plans.PlanPayload(
                name="Aktualisierbarer Plan",
                days=["Montag"],
                hours_count=1,
                hours=[{"start_time": "08:00", "end_time": "08:45"}],
                uniform_activities=False,
                activity_subjects={"Montag": [first_task_id]},
            ),
        )
        users.apply_plan(
            user_id,
            ApplyPlanPayload(plan_id=plan["id"], title=plan["name"], subjects=[]),
        )

        plans.update_plan(
            plan["id"],
            plans.PlanPayload(
                name=plan["name"],
                days=["Montag"],
                hours_count=2,
                hours=[
                    {"start_time": "08:00", "end_time": "08:45"},
                    {"start_time": "08:50", "end_time": "09:35"},
                ],
                uniform_activities=False,
                activity_subjects={"Montag": [second_task_id, 0]},
            ),
        )

        conn = database.get_db_connection()
        try:
            blocks = conn.execute(
                """
                SELECT time_blocks.plan_period, time_blocks.title,
                       time_blocks.person_event_type_id, user_plan_assignments.id AS assignment_id
                FROM time_blocks
                JOIN user_plan_assignments
                  ON user_plan_assignments.id = time_blocks.plan_assignment_id
                WHERE time_blocks.user_id = ? AND user_plan_assignments.plan_id = ?
                """,
                (user_id, plan["id"]),
            ).fetchall()
            task_mapping = conn.execute(
                """
                SELECT event_type_id FROM task_event_type_migrations
                WHERE task_id = ? AND event_type_id = ?
                """,
                (second_task_id, blocks[0]["person_event_type_id"] if blocks else -1),
            ).fetchone()
        finally:
            conn.close()

    assert [(block["plan_period"], block["title"]) for block in blocks] == [(1, "Neues Fach")]
    assert task_mapping is not None


def test_updating_plan_creates_blocks_for_new_assigned_slots(tmp_path):
    database_path = tmp_path / "new-plan-task-slot.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        conn = database.get_db_connection()
        try:
            user_id = conn.execute(
                """
                INSERT INTO users (name, role, current_points, status_school, status_sport, color_code)
                VALUES ('Alex', 'child_10', 0, 'GREEN', 'BASE', '#228be6')
                """
            ).lastrowid
            category_id = conn.execute(
                "INSERT INTO categories (value, label, color, default_short) VALUES (?, ?, ?, ?)",
                ("plan-new-slot", "Plan-New-Slot", "#228be6", "PNS"),
            ).lastrowid
            first_task_id = conn.execute(
                "INSERT INTO tasks (title, color, category_id) VALUES (?, ?, ?)",
                ("Mathematik", "#228be6", category_id),
            ).lastrowid
            second_task_id = conn.execute(
                "INSERT INTO tasks (title, color, category_id) VALUES (?, ?, ?)",
                ("Deutsch", "#40c057", category_id),
            ).lastrowid
            conn.commit()
        finally:
            conn.close()

        plan = plans.create_plan(
            plans.PlanPayload(
                name="Erweiterbarer Plan",
                days=["Montag"],
                hours_count=1,
                hours=[{"start_time": "08:00", "end_time": "08:45"}],
                uniform_activities=False,
                activity_subjects={"Montag": [first_task_id]},
            ),
        )
        users.apply_plan(
            user_id,
            ApplyPlanPayload(plan_id=plan["id"], title=plan["name"], subjects=[]),
        )

        plans.update_plan(
            plan["id"],
            plans.PlanPayload(
                name=plan["name"],
                days=["Montag"],
                hours_count=2,
                hours=[
                    {"start_time": "08:00", "end_time": "08:45"},
                    {"start_time": "08:50", "end_time": "09:35"},
                ],
                uniform_activities=False,
                activity_subjects={"Montag": [first_task_id, second_task_id]},
            ),
        )

        conn = database.get_db_connection()
        try:
            blocks = conn.execute(
                """
                SELECT plan_period, title, short_title
                FROM time_blocks
                WHERE user_id = ? AND plan_assignment_id = (
                    SELECT id FROM user_plan_assignments WHERE user_id = ? AND plan_id = ?
                )
                ORDER BY plan_period
                """,
                (user_id, user_id, plan["id"]),
            ).fetchall()
        finally:
            conn.close()

    assert [(block["plan_period"], block["title"], block["short_title"]) for block in blocks] == [
        (1, "Mathematik", "Mathematik"[:6]),
        (2, "Deutsch", "Deutsch"[:6]),
    ]


def test_get_user_plan_assignment_filters_by_plan_id(tmp_path):
    database_path = tmp_path / "multiple-plan-assignments.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        first_plan = plans.create_plan(_plan_payload(["Montag"]))
        second_plan = plans.create_plan(_plan_payload(["Dienstag"]))
        conn = database.get_db_connection()
        try:
            user_id = conn.execute(
                """
                INSERT INTO users (name, role, current_points, status_school, status_sport, color_code)
                VALUES ('Alex', 'child_10', 0, 'GREEN', 'BASE', '#228be6')
                """
            ).lastrowid
            conn.executemany(
                """
                INSERT INTO user_plan_assignments (user_id, plan_id, title)
                VALUES (?, ?, ?)
                """,
                [
                    (user_id, first_plan["id"], first_plan["name"]),
                    (user_id, second_plan["id"], second_plan["name"]),
                ],
            )
            conn.commit()
        finally:
            conn.close()

        assignment = users.get_user_plan_assignment(
            user_id,
            plan_id=second_plan["id"],
            actor=None,
        )

    assert assignment["plan_id"] == second_plan["id"]
    assert assignment["title"] == second_plan["name"]


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


def test_apply_plan_keeps_a_members_other_plan_assignment(tmp_path):
    database_path = tmp_path / "multiple-applied-plans.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        conn = database.get_db_connection()
        try:
            user_id = conn.execute(
                """
                INSERT INTO users (name, role, current_points, status_school, status_sport, color_code)
                VALUES ('Alex', 'child_10', 0, 'GREEN', 'BASE', '#228be6')
                """
            ).lastrowid
            event_type_id = conn.execute(
                """
                INSERT INTO person_event_types (user_id, name, color)
                VALUES (?, 'Mathematik', '#228be6')
                """,
                (user_id,),
            ).lastrowid
            conn.commit()
        finally:
            conn.close()

        first_plan = plans.create_plan(_plan_payload(["Montag"]))
        second_plan = plans.create_plan(_plan_payload(["Dienstag"]))
        for plan, day in ((first_plan, "Montag"), (second_plan, "Dienstag")):
            result = users.apply_plan(
                user_id,
                ApplyPlanPayload(
                    plan_id=plan["id"],
                    title=plan["name"],
                    subjects=[{
                        "day_of_week": day,
                        "period": 1,
                        "event_type_id": event_type_id,
                        "visible": True,
                    }],
                ),
            )
            assert result["status"] == "success"

        assignments = users.get_user_plan_assignments(user_id, actor=None)

    assert {assignment["plan_id"] for assignment in assignments} == {
        first_plan["id"],
        second_plan["id"],
    }


def test_apply_uniform_task_adds_member_and_fills_every_plan_slot(tmp_path):
    database_path = tmp_path / "apply-uniform-task.sqlite3"
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
            category_cursor = conn.execute(
                "INSERT INTO categories (value, label, color, default_short) VALUES (?, ?, ?, ?)",
                ("plan-test-school", "Plan-Test", "#228be6", "PT"),
            )
            task_cursor = conn.execute(
                "INSERT INTO tasks (title, color, category_id) VALUES (?, ?, ?)",
                ("Mathematik", "#228be6", category_cursor.lastrowid),
            )
            task_id = task_cursor.lastrowid
            conn.commit()
        finally:
            conn.close()

        plan = plans.create_plan(
            plans.PlanPayload(
                name="Einheitlicher Plan",
                days=["Montag", "Mittwoch"],
                hours_count=2,
                hours=[
                    {"start_time": "08:00", "end_time": "08:45"},
                    {"start_time": "08:50", "end_time": "09:35"},
                ],
                uniform_activities=True,
                uniform_task_id=task_id,
            ),
        )
        result = users.apply_plan(
            user_id,
            ApplyPlanPayload(plan_id=plan["id"], title="Stundenplan", subjects=[]),
        )

        conn = database.get_db_connection()
        try:
            scheduled_blocks = conn.execute(
                """
                SELECT day_of_week, plan_period, title, person_event_type_id
                FROM time_blocks
                WHERE user_id = ?
                ORDER BY
                    CASE day_of_week WHEN 'Montag' THEN 1 WHEN 'Mittwoch' THEN 2 END,
                    plan_period
                """,
                (user_id,),
            ).fetchall()
            participant = conn.execute(
                "SELECT 1 FROM task_participants WHERE task_id = ? AND user_id = ?",
                (task_id, user_id),
            ).fetchone()
        finally:
            conn.close()

    assert result["created_blocks"] == 4
    assert [(row["day_of_week"], row["plan_period"], row["title"]) for row in scheduled_blocks] == [
        ("Montag", 1, "Mathematik"),
        ("Montag", 2, "Mathematik"),
        ("Mittwoch", 1, "Mathematik"),
        ("Mittwoch", 2, "Mathematik"),
    ]
    assert all(row["person_event_type_id"] for row in scheduled_blocks)
    assert participant is not None


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
