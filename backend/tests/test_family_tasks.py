from datetime import date, timedelta

import pytest
from fastapi import HTTPException

import database
from routers import family_tasks
from security import AccountContext


def _actor(db_path, role="adult", profile_id=1, account_id=1, display_name="Adult"):
    return AccountContext(
        id=account_id,
        family_id="family",
        email=f"account-{account_id}@example.invalid",
        display_name=display_name,
        role=role,
        profile_id=profile_id,
        is_platform_admin=False,
        db_file=db_path,
    )


def _create_member(name):
    conn = database.get_db_connection()
    try:
        cursor = conn.execute(
            "INSERT INTO users (name, role, color_code) VALUES (?, 'child_10', '#228be6')",
            (name,),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def _payload(title, member_id=1, due_date=date(2026, 11, 23), parent_id=None, points=0):
    return family_tasks.FamilyTaskPayload(
        title=title,
        member_id=member_id,
        due_date=due_date,
        parent_id=parent_id,
        points=points,
    )


def test_family_task_subtasks_gate_parent_completion_and_award_points_once(tmp_path):
    db_path = tmp_path / "family-tasks.sqlite3"
    database.init_db(db_path)
    with database.use_database_file(db_path):
        _create_member("Kind")
        actor = _actor(db_path)
        parent = family_tasks.create_family_task(
            _payload("Zimmer aufräumen", points=5),
            actor,
        )
        child = family_tasks.create_family_task(
            _payload("Spielzeug wegräumen", parent_id=parent["id"], points=2),
            actor,
        )

        with pytest.raises(HTTPException) as error:
            family_tasks.update_family_task_completion(
                parent["id"],
                family_tasks.FamilyTaskCompletion(completed=True),
                actor,
            )
        assert error.value.status_code == 409

        result = family_tasks.update_family_task_completion(
            child["id"],
            family_tasks.FamilyTaskCompletion(completed=True),
            actor,
        )
        by_id = {task["id"]: task for task in result["tasks"]}
        assert by_id[child["id"]]["completed"] is True
        assert by_id[parent["id"]]["completed"] is True
        assert result["current_points"] == 7

        family_tasks.update_family_task_completion(
            child["id"],
            family_tasks.FamilyTaskCompletion(completed=False),
            actor,
        )
        completed_again = family_tasks.update_family_task_completion(
            child["id"],
            family_tasks.FamilyTaskCompletion(completed=True),
            actor,
        )
        assert completed_again["current_points"] == 7


def test_family_tasks_validate_parent_scope_and_limit_member_visibility(tmp_path):
    db_path = tmp_path / "family-task-scope.sqlite3"
    database.init_db(db_path)
    with database.use_database_file(db_path):
        _create_member("Erstes Kind")
        second_member_id = _create_member("Zweites Kind")
        actor = _actor(db_path)
        parent = family_tasks.create_family_task(_payload("Hausaufgabe"), actor)

        with pytest.raises(HTTPException) as error:
            family_tasks.create_family_task(
                _payload("Unteraufgabe", member_id=second_member_id, parent_id=parent["id"]),
                actor,
            )
        assert error.value.status_code == 422

        child_actor = _actor(db_path, role="child_10", profile_id=1)
        assert [task["id"] for task in family_tasks.list_family_tasks(child_actor)] == [parent["id"]]

        with pytest.raises(HTTPException) as error:
            family_tasks.update_family_task_completion(
                parent["id"],
                family_tasks.FamilyTaskCompletion(completed=True),
                _actor(db_path, role="child_10", profile_id=second_member_id),
            )
        assert error.value.status_code == 404


def test_deleting_parent_removes_subtasks(tmp_path):
    db_path = tmp_path / "family-task-delete.sqlite3"
    database.init_db(db_path)
    with database.use_database_file(db_path):
        _create_member("Kind")
        actor = _actor(db_path)
        parent = family_tasks.create_family_task(_payload("Aufgabe"), actor)
        child = family_tasks.create_family_task(
            _payload("Unteraufgabe", parent_id=parent["id"]),
            actor,
        )
        family_tasks.create_family_task_comment(
            child["id"],
            family_tasks.FamilyTaskCommentPayload(text="Kommentar zur Unteraufgabe"),
            actor,
        )

        family_tasks.delete_family_task(parent["id"])

        assert family_tasks.list_family_tasks(_actor(db_path)) == []
        assert child["parent_id"] == parent["id"]
        conn = database.get_db_connection()
        try:
            assert conn.execute("SELECT COUNT(*) FROM family_task_comments").fetchone()[0] == 0
        finally:
            conn.close()


def test_family_task_comments_persist_and_only_author_or_adult_can_edit(tmp_path):
    db_path = tmp_path / "family-task-comments.sqlite3"
    database.init_db(db_path)
    with database.use_database_file(db_path):
        _create_member("Kind")
        other_member_id = _create_member("Anderes Kind")
        adult = _actor(db_path)
        author = _actor(
            db_path, role="child_10", account_id=2, display_name="Alex", profile_id=1
        )
        other_child = _actor(
            db_path, role="child_10", account_id=3, display_name="Sam", profile_id=1
        )
        outsider = _actor(
            db_path,
            role="child_10",
            account_id=4,
            display_name="Kim",
            profile_id=other_member_id,
        )
        task = family_tasks.create_family_task(_payload("Hausaufgabe"), adult)

        with pytest.raises(HTTPException) as error:
            family_tasks.create_family_task_comment(
                task["id"],
                family_tasks.FamilyTaskCommentPayload(text="Nicht für mich"),
                outsider,
            )
        assert error.value.status_code == 404

        comment = family_tasks.create_family_task_comment(
            task["id"],
            family_tasks.FamilyTaskCommentPayload(text="  Matheheft liegt bereit.  "),
            author,
        )
        assert comment["text"] == "Matheheft liegt bereit."
        assert comment["author"] == "Alex"
        assert comment["can_edit"] is True

        listed_task = family_tasks.list_family_tasks(author)[0]
        assert listed_task["comments"] == [comment]

        with pytest.raises(HTTPException) as error:
            family_tasks.update_family_task_comment(
                task["id"],
                comment["id"],
                family_tasks.FamilyTaskCommentPayload(text="Geändert"),
                other_child,
            )
        assert error.value.status_code == 404

        updated = family_tasks.update_family_task_comment(
            task["id"],
            comment["id"],
            family_tasks.FamilyTaskCommentPayload(text="Bitte auch den Atlas mitnehmen."),
            author,
        )
        assert updated["text"] == "Bitte auch den Atlas mitnehmen."
        assert updated["updatedAt"] is not None
        assert family_tasks.list_family_tasks(adult)[0]["comments"] == [updated]

        family_tasks.delete_family_task_comment(task["id"], comment["id"], adult)
        assert family_tasks.list_family_tasks(adult)[0]["comments"] == []


def test_recurring_family_tasks_create_independent_weekly_occurrences_and_delete_future(tmp_path):
    db_path = tmp_path / "family-task-recurrence.sqlite3"
    database.init_db(db_path)
    with database.use_database_file(db_path):
        _create_member("Kind")
        actor = _actor(db_path)
        start = date.today() + timedelta(days=1)
        weekday = family_tasks.WEEKDAYS[start.weekday()]
        result = family_tasks.create_family_task_series(
            family_tasks.FamilyTaskSeriesPayload(
                title="Zimmer aufräumen",
                member_id=1,
                start_date=start,
                repeat_weekdays=[weekday],
                end_date=start + timedelta(days=14),
                points=4,
            ),
            actor,
        )

        occurrences = [
            task for task in result["tasks"]
            if task["series_id"] == result["series_id"]
        ]
        assert [task["due_date"] for task in occurrences] == [
            start.isoformat(),
            (start + timedelta(days=7)).isoformat(),
            (start + timedelta(days=14)).isoformat(),
        ]
        assert all(task["repeat_weekdays"] == [weekday] for task in occurrences)

        completed = family_tasks.update_family_task_completion(
            occurrences[0]["id"],
            family_tasks.FamilyTaskCompletion(completed=True),
            actor,
        )
        completed_by_id = {task["id"]: task for task in completed["tasks"]}
        assert completed_by_id[occurrences[0]["id"]]["completed"] is True
        assert completed_by_id[occurrences[1]["id"]]["completed"] is False
        assert completed["current_points"] == 4

        remaining = family_tasks.delete_family_task_series(
            result["series_id"],
            actor,
        )
        assert len(remaining) == 1
        assert remaining[0]["id"] == occurrences[0]["id"]
        assert remaining[0]["series_id"] is None
        assert remaining[0]["completed"] is True


def test_existing_task_can_be_converted_to_a_weekly_recurrence(tmp_path):
    db_path = tmp_path / "family-task-recurrence-convert.sqlite3"
    database.init_db(db_path)
    with database.use_database_file(db_path):
        _create_member("Kind")
        actor = _actor(db_path)
        start = date.today() + timedelta(days=1)
        weekday = family_tasks.WEEKDAYS[start.weekday()]
        task = family_tasks.create_family_task(
            _payload("Lesen", due_date=start),
            actor,
        )

        result = family_tasks.create_family_task_series(
            family_tasks.FamilyTaskSeriesPayload(
                title="Lesen",
                member_id=1,
                start_date=start,
                repeat_weekdays=[weekday],
                end_date=start + timedelta(days=7),
                points=0,
                existing_task_id=task["id"],
            ),
            actor,
        )

        occurrences = [
            item for item in result["tasks"]
            if item["series_id"] == result["series_id"]
        ]
        assert len(occurrences) == 2
        assert occurrences[0]["id"] == task["id"]


def test_recurrence_updates_preserve_matching_occurrences_and_comments(tmp_path):
    db_path = tmp_path / "family-task-recurrence-update.sqlite3"
    database.init_db(db_path)
    with database.use_database_file(db_path):
        _create_member("Kind")
        actor = _actor(db_path)
        start = date.today() + timedelta(days=1)
        weekday = family_tasks.WEEKDAYS[start.weekday()]
        created = family_tasks.create_family_task_series(
            family_tasks.FamilyTaskSeriesPayload(
                title="Lesen",
                member_id=1,
                start_date=start,
                repeat_weekdays=[weekday],
                end_date=start + timedelta(days=14),
            ),
            actor,
        )
        occurrences = [
            task for task in created["tasks"]
            if task["series_id"] == created["series_id"]
        ]
        comment = family_tasks.create_family_task_comment(
            occurrences[1]["id"],
            family_tasks.FamilyTaskCommentPayload(text="Buch liegt bereit."),
            actor,
        )

        updated = family_tasks.update_family_task_series(
            created["series_id"],
            family_tasks.FamilyTaskSeriesPayload(
                title="Buch lesen",
                member_id=1,
                start_date=start,
                repeat_weekdays=[weekday],
                end_date=start + timedelta(days=14),
            ),
            actor,
        )

        updated_occurrence = next(
            task for task in updated["tasks"]
            if task["id"] == occurrences[1]["id"]
        )
        assert updated_occurrence["title"] == "Buch lesen"
        assert updated_occurrence["comments"] == [comment]


def test_calendar_load_generates_recurrences_through_the_requested_date(tmp_path):
    db_path = tmp_path / "family-task-recurrence-calendar-range.sqlite3"
    database.init_db(db_path)
    with database.use_database_file(db_path):
        _create_member("Kind")
        actor = _actor(db_path)
        start = date.today() + timedelta(days=400)
        weekday = family_tasks.WEEKDAYS[start.weekday()]
        created = family_tasks.create_family_task_series(
            family_tasks.FamilyTaskSeriesPayload(
                title="Lesen",
                member_id=1,
                start_date=start,
                repeat_weekdays=[weekday],
            ),
            actor,
        )

        loaded = family_tasks.list_family_tasks(
            actor,
            through=start + timedelta(days=14),
        )
        occurrences = [
            task for task in loaded
            if task["series_id"] == created["series_id"]
        ]
        assert [task["due_date"] for task in occurrences] == [
            start.isoformat(),
            (start + timedelta(days=7)).isoformat(),
            (start + timedelta(days=14)).isoformat(),
        ]
