import json
import sqlite3
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator

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


class FamilyTaskCommentPayload(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("Der Kommentar darf nicht leer sein.")
        return text


WEEKDAYS = (
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
)


class FamilyTaskSeriesPayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    member_id: int = Field(..., ge=1)
    start_date: date
    repeat_weekdays: list[str] = Field(..., min_length=1, max_length=7)
    end_date: date | None = None
    points: int = Field(default=0, ge=0, le=10000)
    existing_task_id: int | None = Field(default=None, ge=1)

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Der Aufgabentitel darf nicht leer sein.")
        return title

    @field_validator("repeat_weekdays")
    @classmethod
    def validate_repeat_weekdays(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or any(day not in WEEKDAYS for day in value):
            raise ValueError("Bitte wähle gültige, unterschiedliche Wochentage aus.")
        return sorted(value, key=WEEKDAYS.index)

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("Das Ende der Wiederholung muss am oder nach dem Start liegen.")
        return self


def serialize_family_task_comment(row: sqlite3.Row, actor: AccountContext) -> dict:
    comment = {
        "id": row["id"],
        "text": row["text"],
        "createdAt": row["created_at"],
        "author": row["author"],
        "can_edit": row["author_account_id"] == actor.id
        or actor.role in {"admin", "adult"},
    }
    if row["updated_at"] is not None:
        comment["updatedAt"] = row["updated_at"]
    return comment


def get_task_comments(
    conn: sqlite3.Connection,
    task_id: int,
    actor: AccountContext,
) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM family_task_comments WHERE task_id = ? ORDER BY created_at, id",
        (task_id,),
    ).fetchall()
    return [serialize_family_task_comment(row, actor) for row in rows]


def get_accessible_task(
    conn: sqlite3.Connection,
    task_id: int,
    actor: AccountContext,
) -> sqlite3.Row:
    task = conn.execute(
        "SELECT * FROM family_tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    if task is None or (
        actor.role not in {"admin", "adult"} and task["member_id"] != actor.profile_id
    ):
        raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden.")
    return task


def get_editable_comment(
    conn: sqlite3.Connection,
    task_id: int,
    comment_id: int,
    actor: AccountContext,
) -> sqlite3.Row:
    comment = conn.execute(
        "SELECT * FROM family_task_comments WHERE id = ? AND task_id = ?",
        (comment_id, task_id),
    ).fetchone()
    if comment is None or (
        comment["author_account_id"] != actor.id
        and actor.role not in {"admin", "adult"}
    ):
        raise HTTPException(status_code=404, detail="Kommentar nicht gefunden.")
    return comment


def serialize_family_task(
    row: sqlite3.Row,
    comments: list[dict] | None = None,
) -> dict:
    task = dict(row)
    task["due_date"] = str(task["due_date"])
    task["completed"] = bool(task["completed"])
    task["points_awarded"] = bool(task["points_awarded"])
    task["comments"] = comments or []
    return task


def ensure_series_occurrences(
    conn: sqlite3.Connection,
    series_id: int,
    through_date: date,
) -> None:
    series = conn.execute(
        "SELECT * FROM family_task_series WHERE id = ?",
        (series_id,),
    ).fetchone()
    if series is None:
        return
    start_date = date.fromisoformat(series["start_date"])
    target_date = max(through_date, start_date)
    if series["end_date"] is not None:
        target_date = min(target_date, date.fromisoformat(series["end_date"]))
    if series["generated_through"] is None:
        next_date = start_date
    else:
        generated_through = date.fromisoformat(series["generated_through"])
        if generated_through >= target_date:
            return
        next_date = max(start_date, generated_through + timedelta(days=1))
    weekdays = set(json.loads(series["repeat_weekdays"]))
    while next_date <= target_date:
        if WEEKDAYS[next_date.weekday()] in weekdays:
            conn.execute(
                """
                INSERT OR IGNORE INTO family_tasks
                    (title, member_id, due_date, points, series_id)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    series["title"],
                    series["member_id"],
                    next_date.isoformat(),
                    series["points"],
                    series_id,
                ),
            )
        next_date += timedelta(days=1)
    conn.execute(
        "UPDATE family_task_series SET generated_through = ? WHERE id = ?",
        (target_date.isoformat(), series_id),
    )


def get_family_tasks(
    conn: sqlite3.Connection,
    actor: AccountContext,
    through_date: date | None = None,
) -> list[dict]:
    ensure_through = max(through_date or date.today(), date.today() + timedelta(days=365))
    for row in conn.execute("SELECT id FROM family_task_series").fetchall():
        ensure_series_occurrences(conn, row["id"], ensure_through)
    rows = conn.execute(
        "SELECT * FROM family_tasks ORDER BY due_date, member_id, parent_id, id"
    ).fetchall()
    tasks = [serialize_family_task(row) for row in rows]
    series_by_id = {
        row["id"]: row
        for row in conn.execute("SELECT * FROM family_task_series").fetchall()
    }
    if actor.role in {"admin", "adult"}:
        visible_tasks = tasks
    elif actor.profile_id is None:
        visible_tasks = []
    else:
        visible_tasks = [task for task in tasks if task["member_id"] == actor.profile_id]
    for task in visible_tasks:
        series_id = task.get("series_id")
        if series_id is not None and series_id in series_by_id:
            series = series_by_id[series_id]
            task["repeat_weekdays"] = json.loads(series["repeat_weekdays"])
            task["series_start_date"] = series["start_date"]
            task["series_end_date"] = series["end_date"]
        task["comments"] = get_task_comments(conn, task["id"], actor)
    return visible_tasks


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


def delete_task_with_subtasks(conn: sqlite3.Connection, task_id: int) -> None:
    conn.execute(
        """
        DELETE FROM family_task_comments
        WHERE task_id = ? OR task_id IN (
            SELECT id FROM family_tasks WHERE parent_id = ?
        )
        """,
        (task_id, task_id),
    )
    conn.execute("DELETE FROM family_tasks WHERE parent_id = ?", (task_id,))
    conn.execute("DELETE FROM family_tasks WHERE id = ?", (task_id,))


@router.get("")
def list_family_tasks(
    actor: AccountContext = Depends(require_authenticated),
    through: date | None = None,
):
    if through is not None and through > date.today() + timedelta(days=365 * 5):
        raise HTTPException(
            status_code=422,
            detail="Wiederkehrende Aufgaben können höchstens fünf Jahre im Voraus geladen werden.",
        )
    conn = database.get_db_connection()
    try:
        tasks = get_family_tasks(conn, actor, through)
        conn.commit()
        return tasks
    finally:
        conn.close()


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin", "adult"))],
)
def create_family_task(
    payload: FamilyTaskPayload,
    actor: AccountContext = Depends(require_authenticated),
):
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
        return serialize_family_task(row, get_task_comments(conn, row["id"], actor))
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.put(
    "/{task_id}",
    dependencies=[Depends(require_roles("admin", "adult"))],
)
def update_family_task(
    task_id: int,
    payload: FamilyTaskPayload,
    actor: AccountContext = Depends(require_authenticated),
):
    conn = database.get_db_connection()
    try:
        current = conn.execute(
            "SELECT * FROM family_tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden.")
        if current["series_id"] is not None:
            raise HTTPException(
                status_code=409,
                detail="Diese Aufgabe gehört zu einer Wiederholung. Bitte bearbeite die Wiederholung.",
            )
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
        return serialize_family_task(row, get_task_comments(conn, task_id, actor))
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
        recurring = conn.execute(
            "SELECT series_id FROM family_tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if recurring and recurring["series_id"] is not None:
            raise HTTPException(
                status_code=409,
                detail="Diese Aufgabe gehört zu einer Wiederholung. Bitte lösche die Wiederholung.",
            )
        delete_task_with_subtasks(conn, task_id)
        if task["parent_id"] is not None:
            refresh_parent_completion(conn, task["parent_id"])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return None


def validate_series_payload(
    conn: sqlite3.Connection,
    payload: FamilyTaskSeriesPayload,
) -> None:
    validate_relations(
        conn,
        FamilyTaskPayload(
            title=payload.title,
            member_id=payload.member_id,
            due_date=payload.start_date,
            points=payload.points,
        ),
    )
    if payload.existing_task_id is not None:
        existing_task = conn.execute(
            "SELECT * FROM family_tasks WHERE id = ?",
            (payload.existing_task_id,),
        ).fetchone()
        if existing_task is None:
            raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden.")
        if (
            existing_task["series_id"] is not None
            or existing_task["parent_id"] is not None
            or existing_task["completed"]
            or existing_task["member_id"] != payload.member_id
            or existing_task["due_date"] != payload.start_date.isoformat()
            or WEEKDAYS[payload.start_date.weekday()] not in payload.repeat_weekdays
        ):
            raise HTTPException(
                status_code=422,
                detail="Die bestehende Aufgabe muss offen sein und am Starttag der Wiederholung liegen.",
            )


def family_task_series_result(
    conn: sqlite3.Connection,
    actor: AccountContext,
    series_id: int,
) -> dict:
    tasks = get_family_tasks(conn, actor)
    conn.commit()
    return {
        "series_id": series_id,
        "tasks": tasks,
    }


@router.post(
    "/recurrences",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin", "adult"))],
)
def create_family_task_series(
    payload: FamilyTaskSeriesPayload,
    actor: AccountContext = Depends(require_authenticated),
):
    conn = database.get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        validate_series_payload(conn, payload)
        cursor = conn.execute(
            """
            INSERT INTO family_task_series
                (title, member_id, start_date, repeat_weekdays, end_date, points)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                payload.title,
                payload.member_id,
                payload.start_date.isoformat(),
                json.dumps(payload.repeat_weekdays),
                payload.end_date.isoformat() if payload.end_date else None,
                payload.points,
            ),
        )
        series_id = cursor.lastrowid
        if payload.existing_task_id is not None:
            conn.execute(
                """
                UPDATE family_tasks
                SET title = ?, points = ?, series_id = ?
                WHERE id = ?
                """,
                (payload.title, payload.points, series_id, payload.existing_task_id),
            )
        ensure_series_occurrences(
            conn,
            series_id,
            max(date.today() + timedelta(days=365), payload.start_date),
        )
        conn.commit()
        return family_task_series_result(conn, actor, series_id)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.put(
    "/recurrences/{series_id}",
    dependencies=[Depends(require_roles("admin", "adult"))],
)
def update_family_task_series(
    series_id: int,
    payload: FamilyTaskSeriesPayload,
    actor: AccountContext = Depends(require_authenticated),
):
    conn = database.get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        series = conn.execute(
            "SELECT * FROM family_task_series WHERE id = ?",
            (series_id,),
        ).fetchone()
        if series is None:
            raise HTTPException(status_code=404, detail="Wiederholung nicht gefunden.")
        validate_series_payload(conn, payload)
        today = date.today()
        conn.execute(
            """
            UPDATE family_tasks SET series_id = NULL
            WHERE series_id = ? AND (due_date < ? OR completed = 1)
            """,
            (series_id, today.isoformat()),
        )
        selected_weekdays = set(payload.repeat_weekdays)
        future_tasks = conn.execute(
            """
            SELECT id, due_date FROM family_tasks
            WHERE series_id = ? AND completed = 0 AND due_date >= ?
            """,
            (series_id, today.isoformat()),
        ).fetchall()
        for task in future_tasks:
            due_date = date.fromisoformat(task["due_date"])
            is_still_scheduled = (
                due_date >= payload.start_date
                and (payload.end_date is None or due_date <= payload.end_date)
                and WEEKDAYS[due_date.weekday()] in selected_weekdays
            )
            if is_still_scheduled:
                conn.execute(
                    """
                    UPDATE family_tasks SET title = ?, member_id = ?, points = ?
                    WHERE id = ?
                    """,
                    (payload.title, payload.member_id, payload.points, task["id"]),
                )
                conn.execute(
                    "UPDATE family_tasks SET member_id = ? WHERE parent_id = ?",
                    (payload.member_id, task["id"]),
                )
            else:
                delete_task_with_subtasks(conn, task["id"])
        conn.execute(
            """
            UPDATE family_task_series
            SET title = ?, member_id = ?, start_date = ?, repeat_weekdays = ?,
                end_date = ?, points = ?, generated_through = ?
            WHERE id = ?
            """,
            (
                payload.title,
                payload.member_id,
                payload.start_date.isoformat(),
                json.dumps(payload.repeat_weekdays),
                payload.end_date.isoformat() if payload.end_date else None,
                payload.points,
                (today - timedelta(days=1)).isoformat(),
                series_id,
            ),
        )
        target_date = max(date.today() + timedelta(days=365), payload.start_date)
        if series["generated_through"] is not None:
            target_date = max(
                target_date,
                date.fromisoformat(series["generated_through"]),
            )
        ensure_series_occurrences(
            conn,
            series_id,
            target_date,
        )
        conn.commit()
        return family_task_series_result(conn, actor, series_id)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.delete(
    "/recurrences/{series_id}",
)
def delete_family_task_series(
    series_id: int,
    actor: AccountContext = Depends(require_authenticated),
):
    if actor.role not in {"admin", "adult"}:
        raise HTTPException(status_code=403, detail="Keine Berechtigung.")
    conn = database.get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        series = conn.execute(
            "SELECT id FROM family_task_series WHERE id = ?",
            (series_id,),
        ).fetchone()
        if series is None:
            raise HTTPException(status_code=404, detail="Wiederholung nicht gefunden.")
        today = date.today().isoformat()
        conn.execute(
            """
            UPDATE family_tasks SET series_id = NULL
            WHERE series_id = ? AND (due_date < ? OR completed = 1)
            """,
            (series_id, today),
        )
        occurrences = conn.execute(
            "SELECT id FROM family_tasks WHERE series_id = ?",
            (series_id,),
        ).fetchall()
        for occurrence in occurrences:
            delete_task_with_subtasks(conn, occurrence["id"])
        conn.execute(
            "DELETE FROM family_task_series WHERE id = ?",
            (series_id,),
        )
        conn.commit()
        tasks = get_family_tasks(conn, actor)
        conn.commit()
        return tasks
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.post(
    "/{task_id}/comments",
    status_code=status.HTTP_201_CREATED,
)
def create_family_task_comment(
    task_id: int,
    payload: FamilyTaskCommentPayload,
    actor: AccountContext = Depends(require_authenticated),
):
    conn = database.get_db_connection()
    try:
        get_accessible_task(conn, task_id, actor)
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        cursor = conn.execute(
            """
            INSERT INTO family_task_comments
                (task_id, author_account_id, author, text, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (task_id, actor.id, actor.display_name, payload.text, created_at),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM family_task_comments WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return serialize_family_task_comment(row, actor)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.put("/{task_id}/comments/{comment_id}")
def update_family_task_comment(
    task_id: int,
    comment_id: int,
    payload: FamilyTaskCommentPayload,
    actor: AccountContext = Depends(require_authenticated),
):
    conn = database.get_db_connection()
    try:
        get_accessible_task(conn, task_id, actor)
        get_editable_comment(conn, task_id, comment_id, actor)
        updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        conn.execute(
            "UPDATE family_task_comments SET text = ?, updated_at = ? WHERE id = ?",
            (payload.text, updated_at, comment_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM family_task_comments WHERE id = ?",
            (comment_id,),
        ).fetchone()
        return serialize_family_task_comment(row, actor)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.delete(
    "/{task_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_family_task_comment(
    task_id: int,
    comment_id: int,
    actor: AccountContext = Depends(require_authenticated),
):
    conn = database.get_db_connection()
    try:
        get_accessible_task(conn, task_id, actor)
        get_editable_comment(conn, task_id, comment_id, actor)
        conn.execute(
            "DELETE FROM family_task_comments WHERE id = ?",
            (comment_id,),
        )
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
