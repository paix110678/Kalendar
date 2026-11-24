from datetime import date

import pytest
from fastapi import HTTPException

import database
from routers import family_tasks
from security import AccountContext


def _actor(db_path, role="adult", profile_id=1):
    return AccountContext(
        id=1,
        family_id="family",
        email="adult@example.invalid",
        display_name="Adult",
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
        parent = family_tasks.create_family_task(_payload("Zimmer aufräumen", points=5))
        child = family_tasks.create_family_task(
            _payload("Spielzeug wegräumen", parent_id=parent["id"], points=2)
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
        parent = family_tasks.create_family_task(_payload("Hausaufgabe"))

        with pytest.raises(HTTPException) as error:
            family_tasks.create_family_task(
                _payload("Unteraufgabe", member_id=second_member_id, parent_id=parent["id"])
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
        parent = family_tasks.create_family_task(_payload("Aufgabe"))
        child = family_tasks.create_family_task(
            _payload("Unteraufgabe", parent_id=parent["id"])
        )

        family_tasks.delete_family_task(parent["id"])

        assert family_tasks.list_family_tasks(_actor(db_path)) == []
        assert child["parent_id"] == parent["id"]
