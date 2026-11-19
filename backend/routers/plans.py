import json
import database
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from security import require_roles

router = APIRouter(
    prefix="/api/plans",
    tags=["Pläne"],
    dependencies=[Depends(require_roles("admin", "adult"))],
)

DAYS_OF_WEEK = (
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
)


class PlanHour(BaseModel):
    start_time: str = Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
    end_time: str = Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")

    @model_validator(mode="after")
    def validate_time_range(self):
        if self.end_time <= self.start_time:
            raise ValueError("Das Ende einer Stunde muss nach ihrem Beginn liegen.")
        return self


class PlanPayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    days: list[str] = Field(min_length=1, max_length=7)
    hours_count: int = Field(ge=1, le=24)
    hours: list[PlanHour]
    uniform_time: bool = True
    uniform_count: bool = True
    uniform_activities: bool = True
    uniform_task_id: int | None = None
    activity_subjects: dict[str, list[int]] = Field(default_factory=dict)
    day_hours: dict[str, list[PlanHour]] = Field(default_factory=dict)
    exclude_school_holidays: bool = False
    exclude_public_holidays: bool = False

    @model_validator(mode="after")
    def validate_plan(self):
        if self.name != self.name.strip():
            raise ValueError("Der Planname darf nicht mit Leerzeichen beginnen oder enden.")
        if not self.name:
            raise ValueError("Der Planname darf nicht leer sein.")
        if any(day not in DAYS_OF_WEEK for day in self.days):
            raise ValueError("Bitte gültige Wochentage auswählen.")
        if len(set(self.days)) != len(self.days):
            raise ValueError("Ein Wochentag darf nur einmal ausgewählt werden.")
        if len(self.hours) != self.hours_count:
            raise ValueError("Die Anzahl der Zeitstunden stimmt nicht mit der Stundenliste überein.")
        for index, hour in enumerate(self.hours):
            if any(
                hour.start_time < other.end_time and hour.end_time > other.start_time
                for other in self.hours[index + 1:]
            ):
                raise ValueError("Die Stundenzeiten eines Plans dürfen sich nicht überschneiden.")
        if self.uniform_time and self.uniform_count and self.day_hours:
            raise ValueError("Einheitliche Stunden dürfen keine einzelnen Tageszeiten enthalten.")
        if not (self.uniform_time and self.uniform_count):
            if set(self.day_hours) != set(self.days):
                raise ValueError("Für jeden ausgewählten Wochentag müssen Stundenzeiten angegeben werden.")
            if any(not hours or len(hours) > 24 for hours in self.day_hours.values()):
                raise ValueError("Pro Wochentag muss mindestens eine und höchstens 24 Stunden angegeben werden.")
            if max(len(hours) for hours in self.day_hours.values()) != self.hours_count:
                raise ValueError("Die maximale Stundenanzahl stimmt nicht mit der Stundenliste überein.")
            if self.uniform_count and any(
                len(hours) != self.hours_count for hours in self.day_hours.values()
            ):
                raise ValueError("Die einheitliche Stundenanzahl muss für alle Wochentage gleich sein.")
            if self.uniform_time and any(
                hours != self.hours[:len(hours)] for hours in self.day_hours.values()
            ):
                raise ValueError("Die einheitlichen Stundenzeiten müssen für alle Wochentage gleich sein.")
            for hours in self.day_hours.values():
                for index, hour in enumerate(hours):
                    if any(
                        hour.start_time < other.end_time and hour.end_time > other.start_time
                        for other in hours[index + 1:]
                    ):
                        raise ValueError("Die Stundenzeiten eines Wochentags dürfen sich nicht überschneiden.")
        return self


def ordered_days(days: list[str]) -> list[str]:
    return [day for day in DAYS_OF_WEEK if day in days]


def plan_days_from_row(row) -> list[str]:
    stored_days = json.loads(row["days_json"])
    if not isinstance(stored_days, list):
        raise ValueError("Der Plan enthält keine gültige Wochentagsliste.")
    if stored_days:
        if (
            any(day not in DAYS_OF_WEEK for day in stored_days)
            or len(set(stored_days)) != len(stored_days)
        ):
            raise ValueError("Der Plan enthält ungültige Wochentage.")
        return ordered_days(stored_days)

    start_day = row["start_day"]
    end_day = row["end_day"]
    if start_day in DAYS_OF_WEEK and end_day in DAYS_OF_WEEK:
        first_day = DAYS_OF_WEEK.index(start_day)
        last_day = DAYS_OF_WEEK.index(end_day)
        if first_day <= last_day:
            return list(DAYS_OF_WEEK[first_day:last_day + 1])
    return []


def serialize_plan(row):
    days = plan_days_from_row(row)
    day_hours = json.loads(row["day_hours_json"])
    if not isinstance(day_hours, dict):
        raise ValueError("Der Plan enthält keine gültigen Tageszeiten.")
    return {
        "id": row["id"],
        "name": row["name"],
        "days": days,
        "start_day": days[0] if days else row["start_day"],
        "end_day": days[-1] if days else row["end_day"],
        "hours_count": row["hours_count"],
        "hours": json.loads(row["hours_json"]),
        "uniform_time": bool(row["uniform_time"]),
        "uniform_count": bool(row["uniform_count"]),
        "uniform_activities": bool(row["uniform_activities"]),
        "uniform_task_id": row["uniform_task_id"],
        "activity_subjects": json.loads(row["activity_subjects_json"]),
        "day_hours": day_hours,
        "exclude_school_holidays": bool(row["exclude_school_holidays"]),
        "exclude_public_holidays": bool(row["exclude_public_holidays"]),
    }


def get_plan_or_404(conn, plan_id: int):
    row = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan nicht gefunden.")
    return serialize_plan(row)


@router.get("")
def get_plans():
    conn = database.get_db_connection()
    try:
        rows = conn.execute("SELECT * FROM plans ORDER BY id").fetchall()
        return [serialize_plan(row) for row in rows]
    finally:
        conn.close()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_plan(payload: PlanPayload):
    conn = database.get_db_connection()
    try:
        scheduled_days = ordered_days(payload.days)
        cursor = conn.execute(
            """
            INSERT INTO plans (
                name, start_day, end_day, days_json, hours_count, hours_json,
                uniform_time, uniform_count, uniform_activities, day_hours_json,
                uniform_task_id, activity_subjects_json,
                exclude_school_holidays, exclude_public_holidays
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.name.strip(),
                scheduled_days[0],
                scheduled_days[-1],
                json.dumps(scheduled_days),
                payload.hours_count,
                json.dumps([hour.model_dump() for hour in payload.hours]),
                payload.uniform_time,
                payload.uniform_count,
                payload.uniform_activities,
                json.dumps(
                    {
                        day: [hour.model_dump() for hour in hours]
                        for day, hours in payload.day_hours.items()
                    } if not (payload.uniform_time and payload.uniform_count) else {}
                ),
                payload.uniform_task_id,
                json.dumps(payload.activity_subjects),
                payload.exclude_school_holidays,
                payload.exclude_public_holidays,
            ),
        )
        conn.commit()
        return get_plan_or_404(conn, cursor.lastrowid)
    finally:
        conn.close()


@router.put("/{plan_id}")
def update_plan(plan_id: int, payload: PlanPayload):
    conn = database.get_db_connection()
    try:
        scheduled_days = ordered_days(payload.days)
        current_plan = conn.execute("SELECT id FROM plans WHERE id = ?", (plan_id,)).fetchone()
        if current_plan is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan nicht gefunden.")

        scheduled_slots = [
            {
                "day_of_week": day,
                "period": period,
                "start_time": hour.start_time,
                "end_time": hour.end_time,
            }
            for day in scheduled_days
            for period, hour in enumerate(
                payload.hours
                if payload.uniform_time and payload.uniform_count
                else payload.day_hours[day],
                start=1,
            )
        ]

        assignments = conn.execute(
            """
            SELECT user_plan_assignments.id, user_plan_assignments.user_id, users.name AS user_name
            FROM user_plan_assignments
            JOIN users ON users.id = user_plan_assignments.user_id
            WHERE user_plan_assignments.plan_id = ?
            """,
            (plan_id,),
        ).fetchall()
        conflicts = []
        existing_by_assignment = {}
        for assignment in assignments:
            assignment_id = assignment["id"]
            user_id = assignment["user_id"]
            existing_blocks = conn.execute(
                "SELECT * FROM time_blocks WHERE plan_assignment_id = ?",
                (assignment_id,),
            ).fetchall()
            existing_by_assignment[assignment_id] = {
                (block["day_of_week"], block["plan_period"]): block
                for block in existing_blocks
            }
            other_blocks = conn.execute(
                """
                SELECT id, title, day_of_week, start_time, end_time
                FROM time_blocks
                WHERE user_id = ? AND (plan_assignment_id IS NULL OR plan_assignment_id != ?)
                """,
                (user_id, assignment_id),
            ).fetchall()
            for planned in scheduled_slots:
                for block in other_blocks:
                    if (
                        block["day_of_week"] == planned["day_of_week"]
                        and block["start_time"] < planned["end_time"]
                        and block["end_time"] > planned["start_time"]
                    ):
                        conflicts.append({
                            "user_name": assignment["user_name"],
                            "title": block["title"],
                            "day_of_week": planned["day_of_week"],
                        })

        if conflicts:
            conflict_summary = ", ".join(
                f'{conflict["user_name"]}: {conflict["title"]} ({conflict["day_of_week"]})'
                for conflict in conflicts
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": (
                        "Die geänderten Planzeiten überschneiden sich mit bestehenden Zeitblöcken. "
                        f"Bitte löse zuerst: {conflict_summary}"
                    ),
                    "conflicts": conflicts,
                },
            )

        cursor = conn.execute(
            """
            UPDATE plans
            SET name = ?, start_day = ?, end_day = ?, days_json = ?,
                hours_count = ?, hours_json = ?, uniform_time = ?, uniform_count = ?, uniform_activities = ?,
                day_hours_json = ?,
                uniform_task_id = ?, activity_subjects_json = ?,
                exclude_school_holidays = ?, exclude_public_holidays = ?
            WHERE id = ?
            """,
            (
                payload.name.strip(),
                scheduled_days[0],
                scheduled_days[-1],
                json.dumps(scheduled_days),
                payload.hours_count,
                json.dumps([hour.model_dump() for hour in payload.hours]),
                payload.uniform_time,
                payload.uniform_count,
                payload.uniform_activities,
                json.dumps(
                    {
                        day: [hour.model_dump() for hour in hours]
                        for day, hours in payload.day_hours.items()
                    } if not (payload.uniform_time and payload.uniform_count) else {}
                ),
                payload.uniform_task_id,
                json.dumps(payload.activity_subjects),
                payload.exclude_school_holidays,
                payload.exclude_public_holidays,
                plan_id,
            ),
        )

        scheduled_keys = {(slot["day_of_week"], slot["period"]) for slot in scheduled_slots}
        for assignment in assignments:
            assignment_id = assignment["id"]
            existing_blocks = existing_by_assignment[assignment_id]
            for key, block in existing_blocks.items():
                if key not in scheduled_keys:
                    conn.execute("DELETE FROM time_blocks WHERE id = ?", (block["id"],))

            for slot in scheduled_slots:
                key = (slot["day_of_week"], slot["period"])
                existing = existing_blocks.get(key)
                if existing:
                    conn.execute(
                        """
                        UPDATE time_blocks
                        SET start_time = ?, end_time = ?
                        WHERE id = ?
                        """,
                        (slot["start_time"], slot["end_time"], existing["id"]),
                    )
                else:
                    event_type = conn.execute(
                        """
                        SELECT id, name, color FROM person_event_types
                        WHERE user_id = ? ORDER BY id LIMIT 1
                        """,
                        (assignment["user_id"],),
                    ).fetchone()
                    title = event_type["name"] if event_type else f'Fach {slot["period"]}'
                    color = event_type["color"] if event_type else "#fd7e14"
                    event_type_id = event_type["id"] if event_type else None
                    conn.execute(
                        """
                        INSERT INTO time_blocks
                            (user_id, title, short_title, day_of_week, start_time, end_time,
                             type, is_locked, color, plan_assignment_id, plan_period, is_visible,
                             person_event_type_id)
                        VALUES (?, ?, ?, ?, ?, ?, 'school', 0, ?, ?, ?, 1, ?)
                        """,
                        (
                            assignment["user_id"],
                            title,
                            title[:6],
                            slot["day_of_week"],
                            slot["start_time"],
                            slot["end_time"],
                            color,
                            assignment_id,
                            slot["period"],
                            event_type_id,
                        ),
                    )

        conn.commit()
        return get_plan_or_404(conn, plan_id)
    finally:
        conn.close()


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(plan_id: int):
    conn = database.get_db_connection()
    try:
        assignments = conn.execute(
            "SELECT id FROM user_plan_assignments WHERE plan_id = ?",
            (plan_id,),
        ).fetchall()
        for assignment in assignments:
            conn.execute(
                "DELETE FROM time_blocks WHERE plan_assignment_id = ?",
                (assignment["id"],),
            )
        conn.execute("DELETE FROM user_plan_assignments WHERE plan_id = ?", (plan_id,))
        conn.execute("UPDATE users SET assigned_plan_id = NULL WHERE assigned_plan_id = ?", (plan_id,))
        cursor = conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan nicht gefunden.")
        conn.commit()
    finally:
        conn.close()
