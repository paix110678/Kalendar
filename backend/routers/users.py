from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from typing import List
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
