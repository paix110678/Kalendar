from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional
import sqlite3
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

class PlanBlockVisibilityUpdate(BaseModel):
    visible: bool

class CategoryUpdate(BaseModel):
    label: str
    color: str
    default_short: str


class CategoryCreate(CategoryUpdate):
    value: str = Field(..., min_length=1, max_length=50)


def reject_plan_event_mutation(block):
    if block["plan_assignment_id"] is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Plan-Events können nur über die Planverwaltung geändert werden.",
        )


def serialize_time_block(row):
    block = dict(row)
    if block["person_event_type_name"] is not None:
        block["title"] = block["person_event_type_name"]
        block["color"] = block["person_event_type_color"]
    block.pop("person_event_type_name")
    block.pop("person_event_type_color")
    return block


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


@router.post("/categories", status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate):
    conn = database.get_db_connection()
    try:
        conn.execute(
            "INSERT INTO categories (value, label, color, default_short) VALUES (?, ?, ?, ?)",
            (payload.value, payload.label.strip(), payload.color, payload.default_short.strip()),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM categories WHERE value = ?", (payload.value,)).fetchone()
        return dict(row)
    except sqlite3.IntegrityError as error:
        conn.rollback()
        raise HTTPException(status_code=409, detail="Kategorie-Kürzel ist bereits vorhanden.") from error
    finally:
        conn.close()


@router.delete("/categories/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(cat_id: int):
    conn = database.get_db_connection()
    try:
        category = conn.execute("SELECT value FROM categories WHERE id = ?", (cat_id,)).fetchone()
        if category is None:
            raise HTTPException(status_code=404, detail="Kategorie nicht gefunden.")
        if conn.execute(
            "SELECT 1 FROM time_blocks WHERE type = ? LIMIT 1", (category["value"],)
        ).fetchone():
            raise HTTPException(
                status_code=409,
                detail="Kategorie wird noch in Kalenderterminen verwendet und kann nicht gelöscht werden.",
            )
        if conn.execute(
            "SELECT 1 FROM tasks WHERE category_id = ? LIMIT 1", (cat_id,)
        ).fetchone():
            raise HTTPException(
                status_code=409,
                detail="Kategorie wird noch in Aufgaben verwendet und kann nicht gelöscht werden.",
            )
        conn.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return None

@router.get("/all")
def get_all_blocks():
    conn = database.get_db_connection()
    try:
        blocks = conn.execute(
            """
            SELECT time_blocks.*, person_event_types.name AS person_event_type_name,
                   person_event_types.color AS person_event_type_color
            FROM time_blocks
            LEFT JOIN person_event_types
                ON person_event_types.id = time_blocks.person_event_type_id
               AND person_event_types.user_id = time_blocks.user_id
            """
        ).fetchall()
        return [serialize_time_block(block) for block in blocks]
    finally:
        conn.close()

@router.get("/{user_id}")
def get_blocks_for_user(user_id: int):
    conn = database.get_db_connection()
    try:
        blocks = conn.execute(
            """
            SELECT time_blocks.*, person_event_types.name AS person_event_type_name,
                   person_event_types.color AS person_event_type_color
            FROM time_blocks
            LEFT JOIN person_event_types
                ON person_event_types.id = time_blocks.person_event_type_id
               AND person_event_types.user_id = time_blocks.user_id
            WHERE time_blocks.user_id = ?
            """,
            (user_id,),
        ).fetchall()
        return [serialize_time_block(block) for block in blocks]
    finally:
        conn.close()

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

@router.put("/{block_id}/visibility")
def update_plan_block_visibility(block_id: int, payload: PlanBlockVisibilityUpdate):
    conn = database.get_db_connection()
    try:
        block = conn.execute(
            "SELECT plan_assignment_id FROM time_blocks WHERE id = ?",
            (block_id,),
        ).fetchone()
        if not block:
            raise HTTPException(status_code=404, detail="Zeitblock nicht gefunden")
        if block["plan_assignment_id"] is None:
            raise HTTPException(status_code=422, detail="Nur gespeicherte Plan-Events können einzeln ausgeblendet werden.")

        conn.execute(
            "UPDATE time_blocks SET is_visible = ? WHERE id = ?",
            (int(payload.visible), block_id),
        )
        conn.commit()
        return {"id": block_id, "is_visible": payload.visible}
    finally:
        conn.close()

@router.put("/{block_id}/owner")
def update_block_owner(block_id: int, payload: TimeBlockOwnerUpdate):
    conn = database.get_db_connection()
    try:
        block = conn.execute("SELECT * FROM time_blocks WHERE id = ?", (block_id,)).fetchone()
        if not block:
            raise HTTPException(status_code=404, detail="Zeitblock nicht gefunden")
        reject_plan_event_mutation(block)

        user = conn.execute("SELECT * FROM users WHERE id = ?", (block["user_id"],)).fetchone()

        if user["role"] != "adult":
            if block["is_locked"] == 1:
                raise HTTPException(status_code=403, detail="Dieser Block ist fixiert.")
            if user["status_school"] == "RED":
                raise HTTPException(status_code=403, detail="Kontrollmodus aktiv (RED): Keine Autonomie.")

        conn.execute("UPDATE time_blocks SET user_id = ? WHERE id = ?", (payload.user_id, block_id))
        conn.commit()
        return {"status": "success"}
    finally:
        conn.close()

@router.put("/{block_id}/move")
def move_time_block(block_id: int, payload: TimeBlockUpdate):
    conn = database.get_db_connection()
    try:
        block = conn.execute("SELECT * FROM time_blocks WHERE id = ?", (block_id,)).fetchone()
        if not block:
            raise HTTPException(status_code=404, detail="Zeitblock nicht gefunden")
        reject_plan_event_mutation(block)

        final_day = payload.day_of_week if payload.day_of_week is not None else block["day_of_week"]
        final_start = payload.start_time if payload.start_time is not None else block["start_time"]
        final_end = payload.end_time if payload.end_time is not None else block["end_time"]
        final_title = payload.title if payload.title is not None else block["title"]
        final_short = payload.short_title if payload.short_title is not None else block["short_title"]
        final_type = payload.type if payload.type is not None else block["type"]
        final_user_id = payload.user_id if payload.user_id is not None else block["user_id"]

        conn.execute("""
            UPDATE time_blocks
            SET day_of_week = ?, start_time = ?, end_time = ?, title = ?, short_title = ?, type = ?, user_id = ?
            WHERE id = ?
        """, (final_day, final_start, final_end, final_title, final_short, final_type, final_user_id, block_id))

        conn.commit()
        return {"status": "success"}
    finally:
        conn.close()

@router.delete("/{block_id}")
def delete_time_block(block_id: int):
    conn = database.get_db_connection()
    try:
        block = conn.execute("SELECT * FROM time_blocks WHERE id = ?", (block_id,)).fetchone()
        if not block:
            raise HTTPException(status_code=404, detail="Zeitblock existiert nicht")
        reject_plan_event_mutation(block)

        conn.execute("DELETE FROM time_blocks WHERE id = ?", (block_id,))
        conn.commit()
        return {"status": "success"}
    finally:
        conn.close()

# NEU: Listet alle anwenderdefinierten Tabellen aus SQLite dynamisch auf
@router.get("/db/tables")
def get_db_tables():
    conn = database.get_db_connection()
    tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
    conn.close()
    return [t["name"] for t in tables]

# NEU: Holt Spaltennamen und Zeilen für JEDE beliebige Tabelle vollkommen generisch ab
@router.get("/db/tables/{table_name}")
def get_db_table_data(table_name: str):
    conn = database.get_db_connection()
    valid_tables = [t["name"] for t in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if table_name not in valid_tables:
        conn.close()
        raise HTTPException(status_code=400, detail="Ungueltiger Tabellenname")
    
    columns_info = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    columns = [c["name"] for c in columns_info]
    rows = conn.execute(f"SELECT * FROM {table_name}").fetchall()
    conn.close()
    return {"columns": columns, "rows": [dict(r) for r in rows]}
