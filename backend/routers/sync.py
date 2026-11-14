import database
from fastapi import APIRouter


router = APIRouter(prefix="/api/sync", tags=["Synchronisierung"])


@router.get("/version")
def get_family_data_revision():
    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT revision FROM family_data_revision WHERE id = 1"
        ).fetchone()
        if row is None:
            raise RuntimeError("Die Familien-Datenversion wurde nicht initialisiert.")
        return {"revision": row["revision"]}
    finally:
        conn.close()
