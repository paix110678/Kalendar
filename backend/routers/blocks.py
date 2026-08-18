from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional
import database

router = APIRouter(prefix="/api/blocks", tags=["Blocks"])

class TimeBlockCreate(BaseModel):
    user_id: int
    title: str
    short_title: Optional[str] = None
    day_of_week: str = Field(..., pattern="^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)$")
    start_time: str = Field(..., pattern="^([0-1][0-9]|2[0-3]):[0-5][0-9]$")
    end_time: str = Field(..., pattern="^([0-1][0-9]|2[0-3]):[0-5][0-9]$")
    type: str

class TimeBlockUpdate(BaseModel):
    day_of_week: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    title: Optional[str] = None
    short_title: Optional[str] = None
    type: Optional[str] = None
    user_id: Optional[int] = None

class TimeBlockOwnerUpdate(BaseModel):
    user_id: int

class CategoryUpdate(BaseModel):
    label: str
    color: str
    default_short: str

@router.get("/categories")
def get_all_categories():
    conn = database.get_db_connection()
    categories = conn.execute("SELECT * FROM categories").fetchall()
    conn.close()
    return [dict(c) for c in categories]

@router.put("/categories/{cat_id}")
def update_category(cat_id: int, payload: CategoryUpdate):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE categories 
        SET label = ?, color = ?, default_short = ? 
        WHERE id = ?
    """, (payload.label, payload.color, payload.default_short, cat_id))
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.get("/all")
def get_all_blocks():
    conn = database.get_db_connection()
    blocks = conn.execute("SELECT * FROM time_blocks").fetchall()
    conn.close()
    return [dict(b) for b in blocks]

@router.get("/{user_id}")
def get_blocks_for_user(user_id: int):
    conn = database.get_db_connection()
    blocks = conn.execute("SELECT * FROM time_blocks WHERE user_id = ?", (user_id,)).fetchall()
    conn.close()
    return [dict(b) for b in blocks]

@router.post("")
def create_time_block(payload: TimeBlockCreate):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    final_short = payload.short_title
    if not final_short:
        cat = conn.execute("SELECT default_short FROM categories WHERE value = ?", (payload.type,)).fetchone()
        final_short = cat["default_short"] if cat else payload.title[:6]

    cursor.execute(
        "INSERT INTO time_blocks (user_id, title, short_title, day_of_week, start_time, end_time, type, is_locked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
        (payload.user_id, payload.title, final_short, payload.day_of_week, payload.start_time, payload.end_time, payload.type)
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return {"status": "success", "block_id": new_id}

@router.put("/{block_id}/owner")
def update_block_owner(block_id: int, payload: TimeBlockOwnerUpdate):
    conn = database.get_db_connection()
    block = conn.execute("SELECT * FROM time_blocks WHERE id = ?", (block_id,)).fetchone()
    if not block:
        conn.close()
        raise HTTPException(status_code=404, detail="Zeitblock nicht gefunden")
        
    user = conn.execute("SELECT * FROM users WHERE id = ?", (block["user_id"],)).fetchone()
    
    if user["role"] != "adult":
        if block["is_locked"] == 1:
            conn.close()
            raise HTTPException(status_code=403, detail="Dieser Block ist fixiert.")
        if user["status_school"] == "RED":
            conn.close()
            raise HTTPException(status_code=403, detail="Kontrollmodus aktiv (RED): Keine Autonomie.")

    conn.execute("UPDATE time_blocks SET user_id = ? WHERE id = ?", (payload.user_id, block_id))
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.put("/{block_id}/move")
def move_time_block(block_id: int, payload: TimeBlockUpdate):
    conn = database.get_db_connection()
    block = conn.execute("SELECT * FROM time_blocks WHERE id = ?", (block_id,)).fetchone()
    if not block:
        conn.close()
        raise HTTPException(status_code=404, detail="Zeitblock nicht gefunden")

    # KORREKTUR: Erzwingt kompromisslos die Werte aus dem Angular-Formular, falls sie übergeben wurden
    final_day = payload.day_of_week if payload.day_of_week is not None else block["day_of_week"]
    final_start = payload.start_time if payload.start_time is not None else block["start_time"]
    final_end = payload.end_time if payload.end_time is not None else block["end_time"]
    final_title = payload.title if payload.title is not None else block["title"]
    final_short = payload.short_title if payload.short_title is not None else block["short_title"]
    final_type = payload.type if payload.type is not None else block["type"]
    final_user_id = payload.user_id if payload.user_id is not None else block["user_id"]

    cursor = conn.cursor()
    # KORREKTUR: Schreibt die Werte knallhart in die SQLite-Zeile
    cursor.execute("""
        UPDATE time_blocks 
        SET day_of_week = ?, start_time = ?, end_time = ?, title = ?, short_title = ?, type = ?, user_id = ? 
        WHERE id = ?
    """, (final_day, final_start, final_end, final_title, final_short, final_type, final_user_id, block_id))
    
    conn.commit()
    conn.close()
    return {"status": "success"}

@router.delete("/{block_id}")
def delete_time_block(block_id: int):
    conn = database.get_db_connection()
    block = conn.execute("SELECT * FROM time_blocks WHERE id = ?", (block_id,)).fetchone()
    if not block:
        conn.close()
        raise HTTPException(status_code=404, detail="Zeitblock existiert nicht")
    
    conn.execute("DELETE FROM time_blocks WHERE id = ?", (block_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}
