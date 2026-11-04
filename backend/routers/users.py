import json
import sqlite3

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from typing import List, Literal, Optional
import database

router = APIRouter(prefix="/api/users", tags=["Users"])

class UserCreate(BaseModel):
    name: str
    role: str = Field(..., pattern="^(adult|child_10|child_14|patchwork_guest)$")
    color_code: str = "#228be6"

class UserUpdate(BaseModel):
    name: str
    role: str = Field(..., pattern="^(adult|child_10|child_14|patchwork_guest)$")
    color_code: str = "#228be6" # Miterfasst

class StatusSchoolUpdate(BaseModel):
    status: str = Field(..., pattern="^(GREEN|RED)$")

class StatusSportUpdate(BaseModel):
    status: str = Field(..., pattern="^(BASE|SILBER)$")

# NEU: Pydantic-Modell für das permanente Sortier-Binding
class UserOrderPayload(BaseModel):
    user_ids: List[int]

class UserProfileUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    role: str = Field(..., pattern="^(adult|child_10|child_14|patchwork_guest)$")
    color_code: str
    current_points: int = Field(..., ge=0)
    status_school: str = Field(..., pattern="^(GREEN|RED)$")
    status_sport: str = Field(..., pattern="^(BASE|SILBER)$")

class PlanSubject(BaseModel):
    day_of_week: str = Field(..., pattern="^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)$")
    period: int = Field(..., ge=1, le=24)
    event_type_id: int = Field(..., ge=1)
    visible: bool = True

class PersonEventTypePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")

    @model_validator(mode="after")
    def validate_name(self):
        if self.name != self.name.strip():
            raise ValueError("Der Name darf nicht mit Leerzeichen beginnen oder enden.")
        return self

class PlanConflictResolution(BaseModel):
    block_id: int
    action: Literal["delete", "move"]
    day_of_week: Optional[str] = Field(default=None, pattern="^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)$")
    start_time: Optional[str] = Field(default=None, pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$")
    end_time: Optional[str] = Field(default=None, pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$")

class ApplyPlanPayload(BaseModel):
    plan_id: int
    title: str = Field(..., min_length=1, max_length=100)
    subjects: List[PlanSubject]
    resolutions: List[PlanConflictResolution] = Field(default_factory=list)

def serialize_person_event_type(row):
    return {"id": row["id"], "user_id": row["user_id"], "name": row["name"], "color": row["color"]}


@router.get("/{user_id}/event-types")
def get_person_event_types(user_id: int):
    conn = database.get_db_connection()
    try:
        if conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden.")
        rows = conn.execute(
            "SELECT id, user_id, name, color FROM person_event_types WHERE user_id = ? ORDER BY id",
            (user_id,),
        ).fetchall()
        return [serialize_person_event_type(row) for row in rows]
    finally:
        conn.close()


@router.post("/{user_id}/event-types", status_code=status.HTTP_201_CREATED)
def create_person_event_type(user_id: int, payload: PersonEventTypePayload):
    conn = database.get_db_connection()
    try:
        if conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden.")
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Der Name darf nicht leer sein.")
        try:
            cursor = conn.execute(
                "INSERT INTO person_event_types (user_id, name, color) VALUES (?, ?, ?)",
                (user_id, name, payload.color),
            )
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="Dieses Fach mit dieser Farbe existiert bereits.") from error
        conn.commit()
        row = conn.execute(
            "SELECT id, user_id, name, color FROM person_event_types WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return serialize_person_event_type(row)
    finally:
        conn.close()


@router.put("/{user_id}/event-types/{event_type_id}")
def update_person_event_type(user_id: int, event_type_id: int, payload: PersonEventTypePayload):
    conn = database.get_db_connection()
    try:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Der Name darf nicht leer sein.")
        try:
            cursor = conn.execute(
                """
                UPDATE person_event_types SET name = ?, color = ?
                WHERE id = ? AND user_id = ?
                """,
                (name, payload.color, event_type_id, user_id),
            )
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="Dieses Fach mit dieser Farbe existiert bereits.") from error
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Persönliches Fach nicht gefunden.")
        conn.execute(
            """
            UPDATE time_blocks
            SET title = ?, short_title = ?, color = ?
            WHERE user_id = ? AND person_event_type_id = ?
            """,
            (name, name[:6], payload.color, user_id, event_type_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, user_id, name, color FROM person_event_types WHERE id = ?",
            (event_type_id,),
        ).fetchone()
        return serialize_person_event_type(row)
    finally:
        conn.close()


@router.delete("/{user_id}/event-types/{event_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_person_event_type(user_id: int, event_type_id: int):
    conn = database.get_db_connection()
    try:
        event_type = conn.execute(
            "SELECT id FROM person_event_types WHERE id = ? AND user_id = ?",
            (event_type_id, user_id),
        ).fetchone()
        if event_type is None:
            raise HTTPException(status_code=404, detail="Persönliches Fach nicht gefunden.")
        usage = conn.execute(
            """
            SELECT 1 FROM time_blocks
            WHERE user_id = ? AND person_event_type_id = ? LIMIT 1
            """,
            (user_id, event_type_id),
        ).fetchone()
        if usage:
            raise HTTPException(
                status_code=409,
                detail="Dieses Fach wird noch im persönlichen Stundenplan verwendet.",
            )
        conn.execute(
            "DELETE FROM person_event_types WHERE id = ? AND user_id = ?",
            (event_type_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()


@router.get("/{user_id}/plan-assignment")
def get_user_plan_assignment(user_id: int):
    conn = database.get_db_connection()
    try:
        assignment = conn.execute(
            "SELECT * FROM user_plan_assignments WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if assignment is None:
            return None
        events = conn.execute(
            """
            SELECT time_blocks.id, time_blocks.plan_period AS period,
                   COALESCE(person_event_types.name, time_blocks.title) AS title,
                   time_blocks.day_of_week, time_blocks.start_time, time_blocks.end_time,
                   COALESCE(person_event_types.color, time_blocks.color) AS color,
                   time_blocks.person_event_type_id AS event_type_id,
                   time_blocks.is_visible AS visible
            FROM time_blocks
            LEFT JOIN person_event_types
                ON person_event_types.id = time_blocks.person_event_type_id
               AND person_event_types.user_id = time_blocks.user_id
            WHERE plan_assignment_id = ?
            ORDER BY time_blocks.day_of_week, time_blocks.plan_period, time_blocks.id
            """,
            (assignment["id"],),
        ).fetchall()
        return {
            "id": assignment["id"],
            "user_id": assignment["user_id"],
            "plan_id": assignment["plan_id"],
            "title": assignment["title"],
            "events": [dict(event) for event in events],
        }
    finally:
        conn.close()


@router.get("")
def get_users():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    # Sicherstellen, dass die Spalte existiert (Migrationsschutz beim ersten Start)
    cursor.execute("PRAGMA table_info(users)")
    columns = [row["name"] for row in cursor.fetchall()]
    if "sort_order" not in columns:
        cursor.execute("ALTER TABLE users ADD COLUMN sort_order INTEGER DEFAULT 0")
        conn.commit()

    # KORREKTUR: Sortiert die Benutzerliste beim Auslesen knallhart nach der permanenten Reihenfolge!
    users = conn.execute("SELECT * FROM users ORDER BY sort_order ASC").fetchall()
    conn.close()
    return [dict(u) for u in users]

@router.put("/{user_id}/profile")
def update_user_profile(user_id: int, payload: UserProfileUpdate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Der Name darf nicht leer sein.")

    conn = database.get_db_connection()
    try:
        user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")

        previous_school_status = user["status_school"]
        previous_sport_status = user["status_sport"]
        conn.execute(
            """
            UPDATE users
            SET name = ?, role = ?, color_code = ?, current_points = ?,
                status_school = ?, status_sport = ?
            WHERE id = ?
            """,
            (
                name,
                payload.role,
                payload.color_code,
                payload.current_points,
                payload.status_school,
                payload.status_sport,
                user_id,
            ),
        )
        blocks_changed = False
        if payload.status_school == "RED" and previous_school_status != "RED":
            for day in ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"):
                exists = conn.execute(
                    "SELECT id FROM time_blocks WHERE user_id = ? AND day_of_week = ? AND title = 'Hausaufgaben'",
                    (user_id, day),
                ).fetchone()
                if not exists:
                    conn.execute(
                        """
                        INSERT INTO time_blocks
                            (user_id, title, day_of_week, start_time, end_time, type, is_locked)
                        VALUES (?, 'Hausaufgaben', ?, '14:30', '15:30', 'duty', 1)
                        """,
                        (user_id, day),
                    )
                    blocks_changed = True
        if payload.status_sport == "SILBER" and previous_sport_status != "SILBER":
            sport_blocks = conn.execute(
                "SELECT id FROM time_blocks WHERE user_id = ? AND type = 'sport' ORDER BY id ASC",
                (user_id,),
            ).fetchall()
            for extra_block in sport_blocks[1:]:
                conn.execute("DELETE FROM time_blocks WHERE id = ?", (extra_block["id"],))
                blocks_changed = True
            conn.execute("UPDATE users SET current_points = current_points + 20 WHERE id = ?", (user_id,))
        conn.commit()
        updated_user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return {"user": dict(updated_user), "blocks_changed": blocks_changed}
    finally:
        conn.close()

@router.post("/{user_id}/apply-plan")
def apply_plan(user_id: int, payload: ApplyPlanPayload):
    conn = database.get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        assignment_title = payload.title.strip()
        if not assignment_title:
            raise HTTPException(status_code=422, detail="Der Titel der Plan-Zuordnung darf nicht leer sein.")

        user = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")

        plan = conn.execute("SELECT * FROM plans WHERE id = ?", (payload.plan_id,)).fetchone()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan nicht gefunden")

        days = ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")
        if plan["start_day"] not in days or plan["end_day"] not in days:
            raise HTTPException(status_code=422, detail="Der Plan enthält einen ungültigen Wochentagsbereich.")
        first_day = days.index(plan["start_day"])
        last_day = days.index(plan["end_day"])
        if first_day > last_day:
            raise HTTPException(status_code=422, detail="Der Plan enthält einen ungültigen Wochentagsbereich.")

        try:
            hours = json.loads(plan["hours_json"])
        except (TypeError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=422, detail="Der Plan enthält keine gültigen Stunden.") from error
        if not isinstance(hours, list) or not hours or len(hours) != plan["hours_count"]:
            raise HTTPException(status_code=422, detail="Der Plan enthält keine vollständige Stundenliste.")
        scheduled_days = days[first_day:last_day + 1]
        subjects_by_slot = {}
        for subject in payload.subjects:
            key = (subject.day_of_week, subject.period)
            if key in subjects_by_slot:
                raise HTTPException(status_code=422, detail="Für eine Stunde wurde mehr als ein Fach angegeben.")
            event_type = conn.execute(
                """
                SELECT id, name, color FROM person_event_types
                WHERE id = ? AND user_id = ?
                """,
                (subject.event_type_id, user_id),
            ).fetchone()
            if event_type is None:
                raise HTTPException(status_code=422, detail="Das ausgewählte Fach gehört nicht zu dieser Person.")
            subjects_by_slot[key] = {
                "event_type_id": event_type["id"],
                "title": event_type["name"],
                "color": event_type["color"],
                "visible": subject.visible,
            }

        expected_slots = {(day, period) for day in scheduled_days for period in range(1, len(hours) + 1)}
        if set(subjects_by_slot) != expected_slots:
            raise HTTPException(status_code=422, detail="Bitte für jede Stunde des Plans ein Fach angeben.")

        planned_blocks = []
        for day in scheduled_days:
            for period, hour in enumerate(hours, start=1):
                start_time = hour["start_time"]
                end_time = hour["end_time"]
                if end_time <= start_time:
                    raise HTTPException(status_code=422, detail="Der Plan enthält ein ungültiges Stundenzeitfenster.")
                planned_blocks.append({
                    "day_of_week": day,
                    "period": period,
                    "start_time": start_time,
                    "end_time": end_time,
                    **subjects_by_slot[(day, period)],
                })

        for index, planned in enumerate(planned_blocks):
            for other in planned_blocks[index + 1:]:
                if (
                    planned["day_of_week"] == other["day_of_week"]
                    and planned["start_time"] < other["end_time"]
                    and planned["end_time"] > other["start_time"]
                ):
                    raise HTTPException(
                        status_code=409,
                        detail={"message": "Der ausgewählte Plan enthält sich überschneidende Stundenzeiten.", "conflicts": []},
                    )

        current_assignment = conn.execute(
            "SELECT id FROM user_plan_assignments WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        current_assignment_id = current_assignment["id"] if current_assignment else None
        existing_blocks = [
            dict(block)
            for block in conn.execute(
                """
                SELECT * FROM time_blocks
                WHERE user_id = ?
                  AND (plan_assignment_id IS NULL OR plan_assignment_id != ?)
                """,
                (user_id, current_assignment_id or -1),
            ).fetchall()
        ]

        def overlaps(first, second):
            return (
                first["day_of_week"] == second["day_of_week"]
                and first["start_time"] < second["end_time"]
                and first["end_time"] > second["start_time"]
            )

        resolution_by_id = {resolution.block_id: resolution for resolution in payload.resolutions}
        if len(resolution_by_id) != len(payload.resolutions):
            raise HTTPException(status_code=422, detail="Jeder Konflikt darf nur einmal gelöst werden.")
        block_by_id = {block["id"]: block for block in existing_blocks}
        if set(resolution_by_id) - set(block_by_id):
            raise HTTPException(status_code=409, detail="Ein betroffener Zeitblock wurde inzwischen geändert oder gelöscht.")

        eligible_resolution_ids = {
            block["id"]
            for block in existing_blocks
            if any(overlaps(block, planned) for planned in planned_blocks)
        }
        for resolution in payload.resolutions:
            if resolution.action != "move":
                continue
            if not resolution.day_of_week or not resolution.start_time or not resolution.end_time:
                raise HTTPException(status_code=422, detail="Für verschobene Zeitblöcke sind Tag, Beginn und Ende erforderlich.")
            if resolution.end_time <= resolution.start_time:
                raise HTTPException(status_code=422, detail="Das Ende eines verschobenen Zeitblocks muss nach dem Beginn liegen.")
            moved_block = {
                **block_by_id[resolution.block_id],
                "day_of_week": resolution.day_of_week,
                "start_time": resolution.start_time,
                "end_time": resolution.end_time,
            }
            if any(overlaps(moved_block, planned) for planned in planned_blocks):
                eligible_resolution_ids.add(resolution.block_id)
            for other in existing_blocks:
                if other["id"] != resolution.block_id and overlaps(moved_block, other):
                    eligible_resolution_ids.update((resolution.block_id, other["id"]))
        resolution_by_id = {
            block_id: resolution
            for block_id, resolution in resolution_by_id.items()
            if block_id in eligible_resolution_ids
        }

        blocks_after_resolution = []
        for block in existing_blocks:
            resolution = resolution_by_id.get(block["id"])
            if resolution and resolution.action == "delete":
                continue
            if resolution and resolution.action == "move":
                if not resolution.day_of_week or not resolution.start_time or not resolution.end_time:
                    raise HTTPException(status_code=422, detail="Für verschobene Zeitblöcke sind Tag, Beginn und Ende erforderlich.")
                if resolution.end_time <= resolution.start_time:
                    raise HTTPException(status_code=422, detail="Das Ende eines verschobenen Zeitblocks muss nach dem Beginn liegen.")
                block = {
                    **block,
                    "day_of_week": resolution.day_of_week,
                    "start_time": resolution.start_time,
                    "end_time": resolution.end_time,
                }
            blocks_after_resolution.append({
                **block,
                "_moved_for_plan": bool(resolution and resolution.action == "move"),
            })

        plan_conflicts = {
            block["id"]
            for block in blocks_after_resolution
            if any(overlaps(block, planned) for planned in planned_blocks)
        }
        additional_conflicts = set()
        for index, block in enumerate(blocks_after_resolution):
            for other in blocks_after_resolution[index + 1:]:
                if (block["_moved_for_plan"] or other["_moved_for_plan"]) and overlaps(block, other):
                    additional_conflicts.update((block["id"], other["id"]))

        required_resolution_ids = plan_conflicts | additional_conflicts
        if required_resolution_ids:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": (
                        "Vor dem Befüllen müssen alle Überschneidungen gelöst werden. "
                        "Verschiebe oder lösche jeden betroffenen Zeitblock."
                    ),
                    "conflicts": [block_by_id[block_id] for block_id in sorted(required_resolution_ids)],
                },
            )

        for resolution in payload.resolutions:
            if resolution.action == "delete":
                conn.execute(
                    "DELETE FROM time_blocks WHERE id = ? AND user_id = ?",
                    (resolution.block_id, user_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE time_blocks SET day_of_week = ?, start_time = ?, end_time = ?
                    WHERE id = ? AND user_id = ?
                    """,
                    (
                        resolution.day_of_week,
                        resolution.start_time,
                        resolution.end_time,
                        resolution.block_id,
                        user_id,
                    ),
                )

        if current_assignment_id is not None:
            conn.execute(
                "DELETE FROM time_blocks WHERE plan_assignment_id = ?",
                (current_assignment_id,),
            )
            conn.execute(
                "DELETE FROM user_plan_assignments WHERE id = ?",
                (current_assignment_id,),
            )
        assignment_cursor = conn.execute(
            """
            INSERT INTO user_plan_assignments (user_id, plan_id, title)
            VALUES (?, ?, ?)
            """,
            (user_id, payload.plan_id, assignment_title),
        )
        assignment_id = assignment_cursor.lastrowid

        for planned in planned_blocks:
            title = planned["title"]
            conn.execute(
                """
                INSERT INTO time_blocks
                    (user_id, title, short_title, day_of_week, start_time, end_time, type,
                     is_locked, color, plan_assignment_id, plan_period, is_visible, person_event_type_id)
                VALUES (?, ?, ?, ?, ?, ?, 'school', 0, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    title,
                    title[:6],
                    planned["day_of_week"],
                    planned["start_time"],
                    planned["end_time"],
                    planned["color"],
                    assignment_id,
                    planned["period"],
                    int(planned["visible"]),
                    planned["event_type_id"],
                ),
            )

        conn.execute("UPDATE users SET assigned_plan_id = ? WHERE id = ?", (payload.plan_id, user_id))
        conn.commit()
        return {
            "status": "success",
            "created_blocks": len(planned_blocks),
            "assigned_plan_id": payload.plan_id,
            "assignment_id": assignment_id,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

# NEU: Der unzerstörbare Endpunkt für das datenbankbasierte Drag-and-Drop
@router.put("/reorder")
def reorder_users(payload: UserOrderPayload):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        # Jede ID aus dem Frontend bekommt ihre fortlaufende Platzierungs-Zahl (0, 1, 2...)
        for position, user_id in enumerate(payload.user_ids):
            cursor.execute("UPDATE users SET sort_order = ? WHERE id = ?", (position, user_id))
        conn.commit()
        return {"status": "success", "message": "Reihenfolge permanent in kalender.db gespeichert"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Datenbankfehler beim Sortieren: {e}")
    finally:
        conn.close()

@router.post("")
def create_user(payload: UserCreate):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO users (name, role, current_points, color_code) VALUES (?, ?, 0, ?)", (payload.name, payload.role, payload.color_code))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return {"status": "success", "user_id": new_id}

@router.put("/{user_id}")
def update_user(user_id: int, payload: UserUpdate):
    conn = database.get_db_connection()
    conn.execute("UPDATE users SET name = ?, role = ?, color_code = ? WHERE id = ?", (payload.name, payload.role, payload.color_code, user_id))
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.delete("/{user_id}")
def delete_user(user_id: int):
    conn = database.get_db_connection()
    assignment = conn.execute(
        "SELECT id FROM user_plan_assignments WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if assignment:
        conn.execute("DELETE FROM time_blocks WHERE plan_assignment_id = ?", (assignment["id"],))
        conn.execute("DELETE FROM user_plan_assignments WHERE id = ?", (assignment["id"],))
    conn.execute("DELETE FROM person_event_types WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.execute("DELETE FROM time_blocks WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.put("/{user_id}/status-school")
def update_school_status(user_id: int, payload: StatusSchoolUpdate):
    conn = database.get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")

    conn.execute("UPDATE users SET status_school = ? WHERE id = ?", (payload.status, user_id))
    if payload.status == "RED":
        tage = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag']
        for tag in tage:
            exists = conn.execute("SELECT id FROM time_blocks WHERE user_id = ? AND day_of_week = ? AND title = 'Hausaufgaben'", (user_id, tag)).fetchone()
            if not exists:
                conn.execute("INSERT INTO time_blocks (user_id, title, day_of_week, start_time, end_time, type, is_locked) VALUES (?, 'Hausaufgaben', ?, '14:30', '15:30', 'duty', 1)", (user_id, tag))
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.put("/{user_id}/status-sport")
def update_sport_status(user_id: int, payload: StatusSportUpdate):
    conn = database.get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")

    conn.execute("UPDATE users SET status_sport = ? WHERE id = ?", (payload.status, user_id))
    if payload.status == "SILBER":
        sport_blocks = conn.execute("SELECT id FROM time_blocks WHERE user_id = ? AND type = 'sport' ORDER BY id ASC", (user_id,)).fetchall()
        if len(sport_blocks) > 1:
            for extra_block in sport_blocks[1:]:
                conn.execute("DELETE FROM time_blocks WHERE id = ?", (extra_block["id"],))
        conn.execute("UPDATE users SET current_points = current_points + 20 WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.post("/{user_id}/tuev-passed")
def final_tuev_passed(user_id: int):
    conn = database.get_db_connection()
    conn.execute("UPDATE users SET current_points = current_points + 10 WHERE id = ?", (user_id,))
    user = conn.execute("SELECT current_points FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.commit()
    conn.close()
    if not user:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    return {"status": "success", "current_points": user["current_points"]}
