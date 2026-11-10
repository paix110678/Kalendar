from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import os
import secrets
from pathlib import Path

from fastapi import HTTPException, Request, status

import auth_database


SESSION_COOKIE = "kalendar_session"
CSRF_COOKIE = "kalendar_csrf"
SESSION_MAX_AGE = 7 * 24 * 60 * 60


@dataclass(frozen=True)
class AccountContext:
    id: int
    family_id: str
    email: str
    display_name: str
    role: str
    profile_id: int | None
    db_file: Path


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_token() -> str:
    return secrets.token_urlsafe(32)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**15,
        r=8,
        p=1,
        dklen=64,
        maxmem=128 * 1024 * 1024,
    )
    return f"scrypt$32768$8$1${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, n, r, p, salt_hex, digest_hex = stored_hash.split("$")
        if algorithm != "scrypt":
            return False
        n_value, r_value, p_value = int(n), int(r), int(p)
        if n_value < 2**14 or n_value > 2**16 or r_value != 8 or p_value != 1:
            return False
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=n_value,
            r=r_value,
            p=p_value,
            dklen=len(expected),
            maxmem=128 * 1024 * 1024,
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def load_session(token: str | None):
    if not token:
        return None
    now = datetime.now(timezone.utc).isoformat()
    conn = auth_database.get_auth_connection()
    try:
        row = conn.execute(
            """
            SELECT accounts.id, accounts.family_id, accounts.email,
                   accounts.display_name, accounts.role, accounts.profile_id,
                   accounts.is_active, accounts.email_verified, sessions.csrf_hash,
                   families.db_key
            FROM sessions
            JOIN accounts ON accounts.id = sessions.account_id
            JOIN families ON families.id = accounts.family_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (hash_token(token), now),
        ).fetchone()
        if row is None or not row["is_active"] or not row["email_verified"]:
            return None
        actor = AccountContext(
            id=row["id"],
            family_id=row["family_id"],
            email=row["email"],
            display_name=row["display_name"],
            role=row["role"],
            profile_id=row["profile_id"],
            db_file=auth_database.get_family_db_path(row["db_key"]),
        )
        return actor, row["csrf_hash"]
    finally:
        conn.close()


def create_session(account_id: int, csrf_token: str):
    token = create_token()
    now = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(
        now.timestamp() + SESSION_MAX_AGE,
        timezone.utc,
    ).isoformat()
    conn = auth_database.get_auth_connection()
    try:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now.isoformat(),))
        conn.execute(
            """
            INSERT INTO sessions (token_hash, account_id, csrf_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                hash_token(token),
                account_id,
                hash_token(csrf_token),
                expires_at,
                now.isoformat(),
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return token


def cookie_secure() -> bool:
    return os.environ.get("KALENDAR_COOKIE_SECURE", "true").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


async def require_authenticated(request: Request) -> AccountContext:
    actor = getattr(request.state, "account", None)
    if actor is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Anmeldung erforderlich.")
    return actor


def require_roles(*roles: str):
    async def dependency(request: Request) -> AccountContext:
        actor = await require_authenticated(request)
        if actor.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Berechtigung.")
        return actor

    return dependency


def ensure_profile_access(actor: AccountContext, user_id: int, write: bool = False):
    if actor.role in {"admin", "adult"}:
        return
    if actor.profile_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nutzer nicht gefunden.")
    if write and actor.role in {"child", "guest"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Berechtigung.")


async def require_profile_access(request: Request, user_id: int) -> AccountContext:
    actor = await require_authenticated(request)
    ensure_profile_access(actor, user_id)
    return actor


def check_csrf(cookie_token: str | None, header_token: str | None, csrf_hash: str) -> bool:
    if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
        return False
    return hmac.compare_digest(hash_token(cookie_token), csrf_hash)


def rate_limit_identity(value: str) -> str:
    return hash_token(value.strip().lower())


def consume_rate_limit(identity: str, limit: int, window_seconds: int):
    now = int(datetime.now(timezone.utc).timestamp())
    key_hash = rate_limit_identity(identity)
    conn = auth_database.get_auth_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "DELETE FROM auth_rate_limits WHERE window_started < ?",
            (now - 24 * 60 * 60,),
        )
        row = conn.execute(
            "SELECT window_started, attempts FROM auth_rate_limits WHERE key_hash = ?",
            (key_hash,),
        ).fetchone()
        if row is None or now - row["window_started"] >= window_seconds:
            conn.execute(
                """
                INSERT INTO auth_rate_limits (key_hash, window_started, attempts)
                VALUES (?, ?, 1)
                ON CONFLICT(key_hash) DO UPDATE SET window_started = excluded.window_started,
                                                    attempts = 1
                """,
                (key_hash, now),
            )
        elif row["attempts"] >= limit:
            conn.rollback()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Zu viele Versuche. Bitte später erneut versuchen.",
            )
        else:
            conn.execute(
                "UPDATE auth_rate_limits SET attempts = attempts + 1 WHERE key_hash = ?",
                (key_hash,),
            )
        conn.commit()
    finally:
        conn.close()


def get_account(account_id: int):
    conn = auth_database.get_auth_connection()
    try:
        return conn.execute(
            """
            SELECT accounts.id, accounts.family_id, accounts.email,
                   accounts.display_name, accounts.role, accounts.profile_id,
                   accounts.email_verified, accounts.is_active, families.db_key
            FROM accounts
            JOIN families ON families.id = accounts.family_id
            WHERE accounts.id = ?
            """,
            (account_id,),
        ).fetchone()
    finally:
        conn.close()
