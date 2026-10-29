import json

import database
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, model_validator

router = APIRouter(prefix="/api/plans", tags=["Pläne"])

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
    start_day: str
    end_day: str
    hours_count: int = Field(ge=1, le=24)
    hours: list[PlanHour]

    @model_validator(mode="after")
    def validate_plan(self):
        if self.name != self.name.strip():
            raise ValueError("Der Planname darf nicht mit Leerzeichen beginnen oder enden.")
        if not self.name:
            raise ValueError("Der Planname darf nicht leer sein.")
        if self.start_day not in DAYS_OF_WEEK or self.end_day not in DAYS_OF_WEEK:
            raise ValueError("Bitte gültige Wochentage auswählen.")
        if DAYS_OF_WEEK.index(self.start_day) > DAYS_OF_WEEK.index(self.end_day):
            raise ValueError("Der erste Tag muss vor oder gleich dem letzten Tag liegen.")
        if len(self.hours) != self.hours_count:
            raise ValueError("Die Anzahl der Zeitstunden stimmt nicht mit der Stundenliste überein.")
        return self


def serialize_plan(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "start_day": row["start_day"],
        "end_day": row["end_day"],
        "hours_count": row["hours_count"],
        "hours": json.loads(row["hours_json"]),
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
        cursor = conn.execute(
            """
            INSERT INTO plans (name, start_day, end_day, hours_count, hours_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                payload.name.strip(),
                payload.start_day,
                payload.end_day,
                payload.hours_count,
                json.dumps([hour.model_dump() for hour in payload.hours]),
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
        cursor = conn.execute(
            """
            UPDATE plans
            SET name = ?, start_day = ?, end_day = ?, hours_count = ?, hours_json = ?
            WHERE id = ?
            """,
            (
                payload.name.strip(),
                payload.start_day,
                payload.end_day,
                payload.hours_count,
                json.dumps([hour.model_dump() for hour in payload.hours]),
                plan_id,
            ),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan nicht gefunden.")
        conn.commit()
        return get_plan_or_404(conn, plan_id)
    finally:
        conn.close()


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(plan_id: int):
    conn = database.get_db_connection()
    try:
        cursor = conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan nicht gefunden.")
        conn.commit()
    finally:
        conn.close()
