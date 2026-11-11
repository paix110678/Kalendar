import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status

import auth_database
import database
from security import AccountContext, require_platform_admin


router = APIRouter(prefix="/api/platform", tags=["Platform"])
logger = logging.getLogger(__name__)


@router.get("/statistics")
def get_platform_statistics(
    _: AccountContext = Depends(require_platform_admin),
):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    auth_conn = auth_database.get_auth_connection()
    try:
        families = auth_conn.execute(
            "SELECT db_key, created_at FROM families ORDER BY created_at"
        ).fetchall()
        accounts = auth_conn.execute(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(is_active = 1), 0) AS active,
                   COALESCE(SUM(email_verified = 1), 0) AS verified,
                   COALESCE(SUM(created_at >= ?), 0) AS created_last_30_days
            FROM accounts
            """,
            (cutoff,),
        ).fetchone()
    finally:
        auth_conn.close()

    profile_count = 0
    time_block_count = 0
    task_count = 0
    for family in families:
        db_file = auth_database.get_family_db_path(family["db_key"])
        if not db_file.is_file():
            logger.error("Kalenderdatenbank fehlt: %s", db_file.name)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Die Statistik konnte nicht geladen werden, da eine Kalenderdatenbank fehlt.",
            )
        calendar_conn = database.get_db_connection(db_file)
        try:
            profile_count += calendar_conn.execute(
                "SELECT COUNT(*) FROM users"
            ).fetchone()[0]
            time_block_count += calendar_conn.execute(
                "SELECT COUNT(*) FROM time_blocks"
            ).fetchone()[0]
            task_count += calendar_conn.execute(
                "SELECT COUNT(*) FROM tasks"
            ).fetchone()[0]
        finally:
            calendar_conn.close()

    return {
        "calendar_count": len(families),
        "calendars_created_last_30_days": sum(
            family["created_at"] >= cutoff for family in families
        ),
        "account_count": accounts["total"],
        "active_account_count": accounts["active"],
        "verified_account_count": accounts["verified"],
        "accounts_created_last_30_days": accounts["created_last_30_days"],
        "profile_count": profile_count,
        "time_block_count": time_block_count,
        "task_count": task_count,
    }
