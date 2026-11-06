import sqlite3
from typing import List

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator

import database

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])


class TaskPayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    color: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    category_id: int = Field(..., ge=1)
    member_ids: List[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_task(self):
        if self.title != self.title.strip():
            raise ValueError("Der Titel darf nicht mit Leerzeichen beginnen oder enden.")
        if len(set(self.member_ids)) != len(self.member_ids):
            raise ValueError("Ein Mitglied darf nicht mehrfach ausgewählt werden.")
        return self


def validate_relations(conn: sqlite3.Connection, payload: TaskPayload) -> None:
    if conn.execute("SELECT id FROM categories WHERE id = ?", (payload.category_id,)).fetchone() is None:
        raise HTTPException(status_code=422, detail="Die ausgewählte Kategorie existiert nicht.")

    if not payload.member_ids:
        return

    placeholders = ",".join("?" for _ in payload.member_ids)
    rows = conn.execute(
        f"SELECT id FROM users WHERE id IN ({placeholders})",
        payload.member_ids,
    ).fetchall()
    if len(rows) != len(payload.member_ids):
        raise HTTPException(status_code=422, detail="Mindestens ein ausgewähltes Mitglied existiert nicht.")


def serialize_task(conn: sqlite3.Connection, task_id: int) -> dict:
    row = conn.execute(
        """
        SELECT tasks.id, tasks.title, tasks.color, tasks.category_id,
               categories.label AS category_label
        FROM tasks
        JOIN categories ON categories.id = tasks.category_id
        WHERE tasks.id = ?
        """,
        (task_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Task nicht gefunden.")
    task = dict(row)
    task["member_ids"] = [
        row["user_id"]
        for row in conn.execute(
            "SELECT user_id FROM task_participants WHERE task_id = ? ORDER BY user_id",
            (task_id,),
        ).fetchall()
    ]
    return task


def sync_task_event_types(
    conn: sqlite3.Connection,
    task_id: int,
    title: str,
    color: str,
    member_ids: List[int],
) -> None:
    for user_id in member_ids:
        event_type = conn.execute(
            """
            SELECT person_event_types.id, person_event_types.name, person_event_types.color
            FROM task_event_type_migrations
            JOIN person_event_types
                ON person_event_types.id = task_event_type_migrations.event_type_id
            WHERE task_event_type_migrations.task_id = ?
              AND person_event_types.user_id = ?
            """,
            (task_id, user_id),
        ).fetchone()

        if event_type is None:
            event_type = conn.execute(
                """
                SELECT id, name, color FROM person_event_types
                WHERE user_id = ? AND name = ? AND color = ?
                """,
                (user_id, title, color),
            ).fetchone()
            if event_type is not None:
                existing_link = conn.execute(
                    "SELECT task_id FROM task_event_type_migrations WHERE event_type_id = ?",
                    (event_type["id"],),
                ).fetchone()
                if existing_link is not None and existing_link["task_id"] != task_id:
                    raise HTTPException(
                        status_code=409,
                        detail=f"„{title}“ ist für dieses Mitglied bereits als anderer Task verknüpft.",
                    )
            else:
                try:
                    cursor = conn.execute(
                        "INSERT INTO person_event_types (user_id, name, color) VALUES (?, ?, ?)",
                        (user_id, title, color),
                    )
                except sqlite3.IntegrityError as error:
                    raise HTTPException(
                        status_code=409,
                        detail="Das Fach konnte für ein teilnehmendes Mitglied nicht angelegt werden.",
                    ) from error
                event_type = {
                    "id": cursor.lastrowid,
                    "name": title,
                    "color": color,
                }

            conn.execute(
                "INSERT INTO task_event_type_migrations (event_type_id, task_id) VALUES (?, ?)",
                (event_type["id"], task_id),
            )

        if event_type["name"] != title or event_type["color"] != color:
            try:
                conn.execute(
                    """
                    UPDATE person_event_types SET name = ?, color = ?
                    WHERE id = ? AND user_id = ?
                    """,
                    (title, color, event_type["id"], user_id),
                )
            except sqlite3.IntegrityError as error:
                raise HTTPException(
                    status_code=409,
                    detail=f"Das Fach „{title}“ existiert für ein teilnehmendes Mitglied bereits.",
                ) from error
            conn.execute(
                """
                UPDATE time_blocks
                SET title = ?, short_title = ?, color = ?
                WHERE user_id = ? AND person_event_type_id = ?
                """,
                (title, title[:6], color, user_id, event_type["id"]),
            )

        conn.execute(
            "INSERT OR IGNORE INTO task_participants (task_id, user_id) VALUES (?, ?)",
            (task_id, user_id),
        )


@router.get("")
def get_tasks():
    conn = database.get_db_connection()
    try:
        rows = conn.execute("SELECT id FROM tasks ORDER BY title COLLATE NOCASE, id").fetchall()
        return [serialize_task(conn, row["id"]) for row in rows]
    finally:
        conn.close()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskPayload):
    conn = database.get_db_connection()
    try:
        validate_relations(conn, payload)
        cursor = conn.execute(
            "INSERT INTO tasks (title, color, category_id) VALUES (?, ?, ?)",
            (payload.title.strip(), payload.color, payload.category_id),
        )
        task_id = cursor.lastrowid
        sync_task_event_types(conn, task_id, payload.title.strip(), payload.color, payload.member_ids)
        conn.commit()
        return serialize_task(conn, task_id)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.put("/{task_id}")
def update_task(task_id: int, payload: TaskPayload):
    conn = database.get_db_connection()
    try:
        if conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Task nicht gefunden.")
        validate_relations(conn, payload)
        conn.execute(
            "UPDATE tasks SET title = ?, color = ?, category_id = ? WHERE id = ?",
            (payload.title.strip(), payload.color, payload.category_id, task_id),
        )
        sync_task_event_types(conn, task_id, payload.title.strip(), payload.color, payload.member_ids)
        if payload.member_ids:
            placeholders = ",".join("?" for _ in payload.member_ids)
            conn.execute(
                f"DELETE FROM task_participants WHERE task_id = ? AND user_id NOT IN ({placeholders})",
                [task_id, *payload.member_ids],
            )
        else:
            conn.execute("DELETE FROM task_participants WHERE task_id = ?", (task_id,))
        conn.commit()
        return serialize_task(conn, task_id)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int):
    conn = database.get_db_connection()
    try:
        if conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Task nicht gefunden.")
        conn.execute("DELETE FROM task_participants WHERE task_id = ?", (task_id,))
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return None
