import sqlite3
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator

import database
from security import AccountContext, require_authenticated, require_roles

router = APIRouter(prefix="/api/family-tasks", tags=["Family Tasks"])


class FamilyTaskPayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    member_id: int = Field(..., ge=1)
    due_date: date
    parent_id: int | None = Field(default=None, ge=1)
    points: int = Field(default=0, ge=0, le=10000)

    @model_validator(mode="after")
    def validate_title(self):
        if self.title != self.title.strip():
            raise ValueError("Der Titel darf nicht mit Leerzeichen beginnen oder enden.")
        return self


class FamilyTaskCompletion(BaseModel):
    completed: bool


def serialize_family_task(row: sqlite3.Row) -> dict:
    task = dict(row)
    task["due_date"] = str(task["due_date"])
    task["completed"] = bool(task["completed"])
    task["points_awarded"] = bool(task["points_awarded"])
    return task


def get_family_tasks(conn: sqlite3.Connection, actor: AccountContext) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM family_tasks ORDER BY due_date, member_id, parent_id, id"
    ).fetchall()
    tasks = [serialize_family_task(row) for row in rows]
    if actor.role in {"admin", "adult"}:
        return tasks
    if actor.profile_id is None:
        return []
    return [task for task in tasks if task["member_id"] == actor.profile_id]


def validate_relations(
    conn: sqlite3.Connection,
    payload: FamilyTaskPayload,
    task_id: int | None = None,
) -> None:
    member = conn.execute(
        "SELECT id FROM users WHERE id = ? AND is_active = 1",
        (payload.member_id,),
    ).fetchone()
    if member is None:
        raise HTTPException(status_code=422, detail="Das ausgewählte Familienmitglied ist nicht verfügbar.")

    current = None
    if task_id is not None:
        current = conn.execute(
            "SELECT id, parent_id FROM family_tasks WHERE id = ?",
            (task_id,),
        ).fetchone()

    if payload.parent_id is None:
        return
    if payload.parent_id == task_id:
        raise HTTPException(status_code=422, detail="Eine Aufgabe kann nicht ihr eigenes übergeordnetes Element sein.")

    parent = conn.execute(
        "SELECT id, member_id, due_date, parent_id FROM family_tasks WHERE id = ?",
        (payload.parent_id,),
    ).fetchone()
    if parent is None:
        raise HTTPException(status_code=422, detail="Die übergeordnete Aufgabe ist nicht verfügbar.")
    if parent["parent_id"] is not None:
        raise HTTPException(status_code=422, detail="Unteraufgaben können keine weiteren Unteraufgaben haben.")
    if parent["member_id"] != payload.member_id or parent["due_date"] != payload.due_date.isoformat():
        raise HTTPException(
            status_code=422,
            detail="Unteraufgaben müssen zum selben Familienmitglied und Fälligkeitstag gehören.",
        )
    if current is not None and current["parent_id"] is None and conn.execute(
        "SELECT 1 FROM family_tasks WHERE parent_id = ? LIMIT 1",
        (task_id,),
    ).fetchone():
        raise HTTPException(status_code=422, detail="Eine Aufgabe mit Unteraufgaben kann nicht selbst zur Unteraufgabe werden.")


def award_task_points_once(conn: sqlite3.Connection, task_id: int) -> None:
    task = conn.execute(
        "SELECT member_id, points, points_awarded FROM family_tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    if task is None or task["points_awarded"]:
        return
    if task["points"] > 0:
        conn.execute(
            "UPDATE users SET current_points = current_points + ? WHERE id = ?",
            (task["points"], task["member_id"]),
        )
    conn.execute(
        "UPDATE family_tasks SET points_awarded = 1 WHERE id = ?",
        (task_id,),
    )


def refresh_parent_completion(conn: sqlite3.Connection, parent_id: int) -> None:
    children = conn.execute(
        "SELECT id, completed FROM family_tasks WHERE parent_id = ?",
        (parent_id,),
    ).fetchall()
    completed = bool(children) and all(child["completed"] for child in children)
    conn.execute(
        "UPDATE family_tasks SET completed = ? WHERE id = ?",
        (int(completed), parent_id),
    )
    if completed:
        award_task_points_once(conn, parent_id)


@router.get("")
def list_family_tasks(actor: AccountContext = Depends(require_authenticated)):
    conn = database.get_db_connection()
    try:
        return get_family_tasks(conn, actor)
    finally:
        conn.close()


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin", "adult"))],
)
def create_family_task(payload: FamilyTaskPayload):
    conn = database.get_db_connection()
    try:
        validate_relations(conn, payload)
        cursor = conn.execute(
            """
            INSERT INTO family_tasks (title, member_id, due_date, parent_id, points)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                payload.title,
                payload.member_id,
                payload.due_date.isoformat(),
                payload.parent_id,
                payload.points,
            ),
        )
        if payload.parent_id is not None:
            conn.execute(
                "UPDATE family_tasks SET completed = 0 WHERE id = ?",
                (payload.parent_id,),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM family_tasks WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return serialize_family_task(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.put(
    "/{task_id}",
    dependencies=[Depends(require_roles("admin", "adult"))],
)
def update_family_task(task_id: int, payload: FamilyTaskPayload):
    conn = database.get_db_connection()
    try:
        current = conn.execute(
            "SELECT * FROM family_tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden.")
        validate_relations(conn, payload, task_id)
        has_children = conn.execute(
            "SELECT 1 FROM family_tasks WHERE parent_id = ? LIMIT 1",
            (task_id,),
        ).fetchone() is not None
        if has_children and payload.parent_id is not None:
            raise HTTPException(status_code=422, detail="Eine Aufgabe mit Unteraufgaben muss übergeordnet bleiben.")

        conn.execute(
            """
            UPDATE family_tasks
            SET title = ?, member_id = ?, due_date = ?, parent_id = ?, points = ?
            WHERE id = ?
            """,
            (
                payload.title,
                payload.member_id,
                payload.due_date.isoformat(),
                payload.parent_id,
                payload.points,
                task_id,
            ),
        )
        if has_children:
            conn.execute(
                "UPDATE family_tasks SET member_id = ?, due_date = ? WHERE parent_id = ?",
                (payload.member_id, payload.due_date.isoformat(), task_id),
            )
        if current["parent_id"] is not None and current["parent_id"] != payload.parent_id:
            refresh_parent_completion(conn, current["parent_id"])
        if payload.parent_id is not None:
            conn.execute(
                "UPDATE family_tasks SET completed = 0 WHERE id = ?",
                (payload.parent_id,),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM family_tasks WHERE id = ?", (task_id,)).fetchone()
        return serialize_family_task(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("admin", "adult"))],
)
def delete_family_task(task_id: int):
    conn = database.get_db_connection()
    try:
        task = conn.execute(
            "SELECT parent_id FROM family_tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if task is None:
            raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden.")
        if task["parent_id"] is None:
            conn.execute("DELETE FROM family_tasks WHERE parent_id = ?", (task_id,))
        conn.execute("DELETE FROM family_tasks WHERE id = ?", (task_id,))
        if task["parent_id"] is not None:
            refresh_parent_completion(conn, task["parent_id"])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return None


@router.put("/{task_id}/completion")
def update_family_task_completion(
    task_id: int,
    payload: FamilyTaskCompletion,
    actor: AccountContext = Depends(require_authenticated),
):
    conn = database.get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        task = conn.execute(
            "SELECT * FROM family_tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if task is None or (
            actor.role not in {"admin", "adult"} and task["member_id"] != actor.profile_id
        ):
            raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden.")
        if conn.execute(
            "SELECT 1 FROM family_tasks WHERE parent_id = ? LIMIT 1",
            (task_id,),
        ).fetchone():
            raise HTTPException(
                status_code=409,
                detail="Diese Aufgabe wird erst abgeschlossen, wenn alle Unteraufgaben erledigt sind.",
            )

        if bool(task["completed"]) != payload.completed:
            conn.execute(
                "UPDATE family_tasks SET completed = ? WHERE id = ?",
                (int(payload.completed), task_id),
            )
            if payload.completed:
                award_task_points_once(conn, task_id)
            if task["parent_id"] is not None:
                refresh_parent_completion(conn, task["parent_id"])

        current_points = conn.execute(
            "SELECT current_points FROM users WHERE id = ?",
            (task["member_id"],),
        ).fetchone()["current_points"]
        tasks = get_family_tasks(conn, actor)
        conn.commit()
        return {
            "tasks": tasks,
            "member_id": task["member_id"],
            "current_points": current_points,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
