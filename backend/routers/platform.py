import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status

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
        account_list = auth_conn.execute(
            """
            SELECT id, display_name, email, is_platform_admin
            FROM accounts
            ORDER BY display_name COLLATE NOCASE, email COLLATE NOCASE
            """
        ).fetchall()
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
        "accounts": [
            {
                "id": account["id"],
                "name": account["display_name"],
                "email": account["email"],
                "is_platform_admin": bool(account["is_platform_admin"]),
            }
            for account in account_list
        ],
        "active_account_count": accounts["active"],
        "verified_account_count": accounts["verified"],
        "accounts_created_last_30_days": accounts["created_last_30_days"],
        "profile_count": profile_count,
        "time_block_count": time_block_count,
        "task_count": task_count,
    }


@router.delete(
    "/accounts/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_platform_account(
    account_id: int,
    actor: AccountContext = Depends(require_platform_admin),
):
    if account_id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Das eigene Plattform-Admin-Konto kann hier nicht gelöscht werden.",
        )

    conn = auth_database.get_auth_connection()
    try:
        family_account = conn.execute(
            "SELECT family_id FROM accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
        if family_account is None:
            raise HTTPException(status_code=404, detail="Konto nicht gefunden.")

        family = conn.execute(
            "SELECT db_key FROM families WHERE id = ?",
            (family_account["family_id"],),
        ).fetchone()
        if family is None:
            logger.error("Konto %s verweist auf einen nicht vorhandenen Familienkalender.", account_id)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Der Kalender des Kontos konnte nicht gefunden werden.",
            )

        calendar_path = auth_database.get_family_db_path(family["db_key"])
        if not calendar_path.is_file():
            logger.error("Kalenderdatenbank fehlt: %s", calendar_path.name)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Die Kalenderdaten des Kontos konnten nicht gefunden werden.",
            )

        conn.execute("ATTACH DATABASE ? AS calendar", (str(calendar_path),))
        conn.execute("BEGIN IMMEDIATE")
        family_account = conn.execute(
            """
            SELECT id, family_id, email, profile_id, is_platform_admin
            FROM accounts WHERE id = ?
            """,
            (account_id,),
        ).fetchone()
        if family_account is None:
            raise HTTPException(status_code=404, detail="Konto nicht gefunden.")
        if family_account["is_platform_admin"]:
            platform_admin_count = conn.execute(
                "SELECT COUNT(*) FROM accounts WHERE is_platform_admin = 1"
            ).fetchone()[0]
            if platform_admin_count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Der letzte Plattform-Admin kann nicht gelöscht werden.",
                )
        current_family = conn.execute(
            "SELECT db_key FROM families WHERE id = ?",
            (family_account["family_id"],),
        ).fetchone()
        if current_family is None or current_family["db_key"] != family["db_key"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Der Familienkalender des Kontos hat sich geändert. Bitte erneut versuchen.",
            )

        if family_account["profile_id"] is not None:
            database.delete_user_profile_data(
                conn,
                family_account["profile_id"],
                schema="calendar",
            )

        conn.execute(
            "DELETE FROM invitations WHERE created_by = ? OR (family_id = ? AND email = ? COLLATE NOCASE)",
            (account_id, family_account["family_id"], family_account["email"]),
        )
        conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        conn.commit()
        conn.execute("DETACH DATABASE calendar")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
