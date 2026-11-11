from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import hmac
import logging
import os
import re
import smtplib
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator

import auth_database
import database
from security import (
    AccountContext,
    CSRF_COOKIE,
    SESSION_COOKIE,
    SESSION_MAX_AGE,
    consume_rate_limit,
    cookie_secure,
    create_session,
    create_token,
    get_account,
    hash_password,
    hash_token,
    require_authenticated,
    require_roles,
    verify_password,
)


router = APIRouter(prefix="/api/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DUMMY_PASSWORD_HASH = "scrypt$32768$8$1$" + ("00" * 16) + "$" + ("00" * 64)


class RegisterPayload(BaseModel):
    family_name: str = Field(..., min_length=1, max_length=100)
    display_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=12, max_length=128)
    bootstrap_token: str | None = Field(default=None, max_length=256)

    @field_validator("family_name", "display_name")
    @classmethod
    def trim_names(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Darf nicht leer sein.")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Bitte eine gültige E-Mail-Adresse eingeben.")
        return value


class LoginPayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Bitte eine gültige E-Mail-Adresse eingeben.")
        return value


class EmailPayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Bitte eine gültige E-Mail-Adresse eingeben.")
        return value


class TokenPayload(BaseModel):
    token: str = Field(..., min_length=20, max_length=256)


class ResetPasswordPayload(TokenPayload):
    password: str = Field(..., min_length=12, max_length=128)


class AcceptInvitationPayload(TokenPayload):
    display_name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=12, max_length=128)

    @field_validator("display_name")
    @classmethod
    def trim_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Darf nicht leer sein.")
        return value


class InvitePayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    role: str = Field(..., pattern="^(adult|teen|child|guest)$")
    profile_id: int = Field(..., ge=1)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Bitte eine gültige E-Mail-Adresse eingeben.")
        return value


class AccountUpdatePayload(BaseModel):
    role: str = Field(..., pattern="^(admin|adult|teen|child|guest)$")
    profile_id: int = Field(..., ge=1)
    is_active: bool


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _smtp_configured() -> bool:
    return bool(os.environ.get("KALENDAR_SMTP_HOST") and os.environ.get("KALENDAR_SMTP_FROM"))


def _send_email(recipient: str, subject: str, body: str):
    host = os.environ.get("KALENDAR_SMTP_HOST")
    sender = os.environ.get("KALENDAR_SMTP_FROM")
    if not host or not sender:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="E-Mail-Versand ist noch nicht konfiguriert.",
        )

    port = int(os.environ.get("KALENDAR_SMTP_PORT", "587"))
    username = os.environ.get("KALENDAR_SMTP_USER")
    password = os.environ.get("KALENDAR_SMTP_PASSWORD")
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15) as client:
                if username:
                    client.login(username, password or "")
                client.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=15) as client:
                client.starttls()
                if username:
                    client.login(username, password or "")
                client.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        logger.exception("Could not send account email")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="E-Mail konnte nicht versendet werden. Bitte später erneut versuchen.",
        ) from error


def _frontend_link(path: str, token: str) -> str:
    base_url = os.environ.get("KALENDAR_PUBLIC_URL", "http://localhost:4200").rstrip("/")
    query = f"token={token}"
    if path == "accept-invitation":
        query += "&flow=accept-invitation"
    return f"{base_url}/{path}?{query}"


def _issue_email_token(account_id: int, purpose: str, expires: timedelta) -> str:
    token = create_token()
    now = _utc_now()
    conn = auth_database.get_auth_connection()
    try:
        conn.execute(
            "DELETE FROM email_tokens WHERE consumed_at IS NOT NULL OR expires_at <= ?",
            (now.isoformat(),),
        )
        conn.execute(
            "DELETE FROM email_tokens WHERE account_id = ? AND purpose = ?",
            (account_id, purpose),
        )
        conn.execute(
            """
            INSERT INTO email_tokens (token_hash, account_id, purpose, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                hash_token(token),
                account_id,
                purpose,
                (now + expires).isoformat(),
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return token


def _email_for_token(token: str, purpose: str):
    conn = auth_database.get_auth_connection()
    try:
        return conn.execute(
            """
            SELECT email_tokens.account_id, accounts.email, accounts.display_name
            FROM email_tokens
            JOIN accounts ON accounts.id = email_tokens.account_id
            WHERE email_tokens.token_hash = ? AND email_tokens.purpose = ?
              AND email_tokens.consumed_at IS NULL AND email_tokens.expires_at > ?
              AND accounts.is_active = 1
            """,
            (hash_token(token), purpose, _utc_now().isoformat()),
        ).fetchone()
    finally:
        conn.close()


def _validate_profile_for_role(profile_id: int, role: str):
    conn = database.get_db_connection()
    try:
        profile = conn.execute(
            "SELECT id, role FROM users WHERE id = ? AND is_active = 1",
            (profile_id,),
        ).fetchone()
    finally:
        conn.close()
    if profile is None:
        raise HTTPException(status_code=404, detail="Familienprofil nicht gefunden.")
    expected_profile_roles = {
        "admin": {"adult"},
        "adult": {"adult"},
        "teen": {"child_14"},
        "child": {"child_10"},
        "guest": {"patchwork_guest"},
    }
    if profile["role"] not in expected_profile_roles[role]:
        raise HTTPException(
            status_code=422,
            detail="Die Rolle passt nicht zum ausgewählten Familienprofil.",
        )


def _account_response(row):
    return {
        "id": row["id"],
        "family_id": row["family_id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "role": row["role"],
        "profile_id": row["profile_id"],
        "email_verified": bool(row["email_verified"]),
        "is_active": bool(row["is_active"]),
    }


def _set_session_cookies(response: Response, token: str, csrf_token: str):
    secure = cookie_secure()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        max_age=SESSION_MAX_AGE,
        httponly=False,
        secure=secure,
        samesite="strict",
        path="/",
    )


def _clear_session_cookies(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/", secure=cookie_secure(), httponly=True, samesite="strict")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=cookie_secure(), samesite="strict")


def _create_or_claim_family(payload: RegisterPayload):
    auth_conn = auth_database.get_auth_connection()
    new_database_path = None
    try:
        auth_conn.execute("BEGIN IMMEDIATE")
        default_family = auth_conn.execute(
            "SELECT id, name, db_key FROM families WHERE db_key = 'default'"
        ).fetchone()
        family = None
        if default_family is None:
            family = {
                "id": uuid.uuid4().hex,
                "name": payload.family_name,
                "db_key": "default",
            }
            auth_conn.execute(
                """
                INSERT INTO families (id, name, db_key, created_at)
                VALUES (?, ?, 'default', ?)
                """,
                (family["id"], family["name"], _utc_now().isoformat()),
            )
        else:
            account_count = auth_conn.execute(
                "SELECT COUNT(*) FROM accounts WHERE family_id = ?",
                (default_family["id"],),
            ).fetchone()[0]
            if account_count == 0:
                conn = database.get_db_connection(database.DB_FILE)
                try:
                    has_profiles = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
                finally:
                    conn.close()
                bootstrap_token = os.environ.get("KALENDAR_BOOTSTRAP_TOKEN")
                if has_profiles and (
                    not bootstrap_token
                    or len(bootstrap_token) < 32
                    or not payload.bootstrap_token
                    or not hmac.compare_digest(bootstrap_token, payload.bootstrap_token)
                ):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Für die Übernahme des bestehenden Kalenders wird das Bootstrap-Token benötigt.",
                    )
                family = dict(default_family)
            else:
                family = {
                    "id": uuid.uuid4().hex,
                    "name": payload.family_name,
                    "db_key": uuid.uuid4().hex,
                }
                auth_conn.execute(
                    """
                    INSERT INTO families (id, name, db_key, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        family["id"],
                        family["name"],
                        family["db_key"],
                        _utc_now().isoformat(),
                    ),
                )
                new_database_path = auth_database.get_family_db_path(family["db_key"])

        conn = auth_conn.execute(
            "SELECT id FROM accounts WHERE email = ? COLLATE NOCASE",
            (payload.email,),
        ).fetchone()
        if conn:
            raise HTTPException(status_code=409, detail="Für diese E-Mail-Adresse besteht bereits ein Konto.")

        if family["db_key"] != "default":
            new_database_path = auth_database.get_family_db_path(family["db_key"])
            database.init_db(new_database_path)

        with database.use_database_file(auth_database.get_family_db_path(family["db_key"])):
            calendar_conn = database.get_db_connection()
            try:
                existing_adult = calendar_conn.execute(
                    "SELECT id FROM users WHERE role = 'adult' ORDER BY id LIMIT 1"
                ).fetchone()
                if existing_adult:
                    profile_id = existing_adult["id"]
                else:
                    cursor = calendar_conn.execute(
                        "INSERT INTO users (name, role) VALUES (?, 'adult')",
                        (payload.display_name,),
                    )
                    profile_id = cursor.lastrowid
                    calendar_conn.commit()
            finally:
                calendar_conn.close()

        cursor = auth_conn.execute(
            """
            INSERT INTO accounts (
                family_id, email, display_name, password_hash, role,
                profile_id, email_verified, is_active, created_at
            ) VALUES (?, ?, ?, ?, 'admin', ?, 0, 1, ?)
            """,
            (
                family["id"],
                payload.email,
                payload.display_name,
                hash_password(payload.password),
                profile_id,
                _utc_now().isoformat(),
            ),
        )
        account_id = cursor.lastrowid
        auth_conn.commit()
        return account_id
    except Exception:
        auth_conn.rollback()
        if new_database_path is not None and new_database_path.exists():
            new_database_path.unlink()
        raise
    finally:
        auth_conn.close()


@router.post("/register", status_code=status.HTTP_202_ACCEPTED)
def register(payload: RegisterPayload, request: Request):
    client_host = request.client.host if request.client else "unknown"
    consume_rate_limit(f"register:{client_host}", 5, 3600)
    if not _smtp_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="E-Mail-Versand muss vor der Registrierung konfiguriert werden.",
        )
    account_id = _create_or_claim_family(payload)
    token = _issue_email_token(account_id, "verify", timedelta(hours=24))
    _send_email(
        payload.email,
        "Familienkalender: E-Mail-Adresse bestätigen",
        "Hallo,\n\n"
        "bitte bestätige deine E-Mail-Adresse über diesen Link:\n"
        f"{_frontend_link('verify-email', token)}\n\n"
        "Der Link ist 24 Stunden gültig.",
    )
    return {"message": "Bitte prüfe dein Postfach und bestätige deine E-Mail-Adresse."}


@router.post("/login")
def login(payload: LoginPayload, request: Request, response: Response):
    client_host = request.client.host if request.client else "unknown"
    consume_rate_limit(f"login:{client_host}", 10, 900)
    conn = auth_database.get_auth_connection()
    try:
        account = conn.execute(
            "SELECT * FROM accounts WHERE email = ? COLLATE NOCASE",
            (payload.email,),
        ).fetchone()
    finally:
        conn.close()

    valid_password = verify_password(
        payload.password,
        account["password_hash"] if account else _DUMMY_PASSWORD_HASH,
    )
    if (
        account is None
        or not valid_password
        or not account["is_active"]
        or not account["email_verified"]
    ):
        raise HTTPException(status_code=401, detail="E-Mail-Adresse oder Passwort ist ungültig.")

    previous_token = request.cookies.get(SESSION_COOKIE)
    if previous_token:
        conn = auth_database.get_auth_connection()
        try:
            conn.execute(
                "DELETE FROM sessions WHERE token_hash = ?",
                (hash_token(previous_token),),
            )
            conn.commit()
        finally:
            conn.close()
    csrf_token = create_token()
    session_token = create_session(account["id"], csrf_token)
    _set_session_cookies(response, session_token, csrf_token)
    response.headers["X-CSRF-Token"] = csrf_token
    row = get_account(account["id"])
    result = _account_response(row)
    result["is_platform_admin"] = bool(row["is_platform_admin"])
    return result


@router.get("/me")
def get_current_account(actor: AccountContext = Depends(require_authenticated)):
    row = get_account(actor.id)
    result = _account_response(row)
    result["is_platform_admin"] = actor.is_platform_admin
    return result


@router.post("/logout")
def logout(request: Request, response: Response, actor: AccountContext = Depends(require_authenticated)):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        conn = auth_database.get_auth_connection()
        try:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))
            conn.commit()
        finally:
            conn.close()
    _clear_session_cookies(response)
    return {"message": "Abgemeldet."}


@router.post("/verify-email")
def verify_email(payload: TokenPayload):
    token_row = _email_for_token(payload.token, "verify")
    if token_row is None:
        raise HTTPException(status_code=400, detail="Der Bestätigungslink ist ungültig oder abgelaufen.")
    conn = auth_database.get_auth_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.execute(
            """
            UPDATE email_tokens SET consumed_at = ?
            WHERE token_hash = ? AND purpose = 'verify'
              AND consumed_at IS NULL AND expires_at > ?
            """,
            (_utc_now().isoformat(), hash_token(payload.token), _utc_now().isoformat()),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=400, detail="Der Bestätigungslink ist ungültig oder abgelaufen.")
        conn.execute(
            "UPDATE accounts SET email_verified = 1 WHERE id = ?",
            (token_row["account_id"],),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"message": "E-Mail-Adresse bestätigt. Du kannst dich jetzt anmelden."}


@router.post("/resend-verification")
def resend_verification(payload: EmailPayload, request: Request):
    client_host = request.client.host if request.client else "unknown"
    consume_rate_limit(f"verify-resend:{client_host}", 5, 3600)
    conn = auth_database.get_auth_connection()
    try:
        account = conn.execute(
            "SELECT id, email, email_verified FROM accounts WHERE email = ? COLLATE NOCASE",
            (payload.email,),
        ).fetchone()
    finally:
        conn.close()
    if account and not account["email_verified"]:
        token = _issue_email_token(account["id"], "verify", timedelta(hours=24))
        try:
            _send_email(
                account["email"],
                "Familienkalender: E-Mail-Adresse bestätigen",
                f"Bitte bestätige deine E-Mail-Adresse:\n{_frontend_link('verify-email', token)}\n",
            )
        except HTTPException as error:
            logger.warning("Verification email could not be sent: %s", error.detail)
    return {"message": "Falls ein unbestätigtes Konto besteht, wurde eine E-Mail versendet."}


@router.post("/request-password-reset")
def request_password_reset(payload: EmailPayload, request: Request):
    client_host = request.client.host if request.client else "unknown"
    consume_rate_limit(f"password-reset:{client_host}", 5, 3600)
    conn = auth_database.get_auth_connection()
    try:
        account = conn.execute(
            """
            SELECT id, email, email_verified FROM accounts
            WHERE email = ? COLLATE NOCASE AND is_active = 1
            """,
            (payload.email,),
        ).fetchone()
    finally:
        conn.close()
    if account and account["email_verified"]:
        token = _issue_email_token(account["id"], "reset", timedelta(hours=1))
        try:
            _send_email(
                account["email"],
                "Familienkalender: Passwort zurücksetzen",
                f"Setze dein Passwort über diesen Link zurück:\n{_frontend_link('reset-password', token)}\n",
            )
        except HTTPException as error:
            logger.warning("Password reset email could not be sent: %s", error.detail)
    return {"message": "Falls ein Konto besteht, wurde eine E-Mail zum Zurücksetzen versendet."}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordPayload):
    token_row = _email_for_token(payload.token, "reset")
    if token_row is None:
        raise HTTPException(status_code=400, detail="Der Link ist ungültig oder abgelaufen.")
    conn = auth_database.get_auth_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.execute(
            """
            UPDATE email_tokens SET consumed_at = ?
            WHERE token_hash = ? AND purpose = 'reset'
              AND consumed_at IS NULL AND expires_at > ?
            """,
            (_utc_now().isoformat(), hash_token(payload.token), _utc_now().isoformat()),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=400, detail="Der Link ist ungültig oder abgelaufen.")
        conn.execute(
            "UPDATE accounts SET password_hash = ? WHERE id = ?",
            (hash_password(payload.password), token_row["account_id"]),
        )
        conn.execute(
            "UPDATE sessions SET expires_at = ? WHERE account_id = ?",
            (_utc_now().isoformat(), token_row["account_id"]),
        )
        conn.execute(
            "UPDATE email_tokens SET consumed_at = ? WHERE account_id = ? AND consumed_at IS NULL",
            (_utc_now().isoformat(), token_row["account_id"]),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"message": "Passwort geändert. Du kannst dich jetzt anmelden."}


@router.post("/accept-invitation", status_code=status.HTTP_201_CREATED)
def accept_invitation(payload: AcceptInvitationPayload):
    conn = auth_database.get_auth_connection()
    try:
        invitation = conn.execute(
            """
            SELECT invitations.*, families.db_key
            FROM invitations
            JOIN families ON families.id = invitations.family_id
            WHERE token_hash = ? AND consumed_at IS NULL
              AND revoked_at IS NULL AND expires_at > ?
            """,
            (hash_token(payload.token), _utc_now().isoformat()),
        ).fetchone()
        if invitation is None:
            raise HTTPException(status_code=400, detail="Die Einladung ist ungültig oder abgelaufen.")
        if conn.execute(
            "SELECT 1 FROM accounts WHERE email = ? COLLATE NOCASE",
            (invitation["email"],),
        ).fetchone():
            raise HTTPException(status_code=409, detail="Für diese E-Mail-Adresse besteht bereits ein Konto.")
        if conn.execute(
            "SELECT 1 FROM accounts WHERE family_id = ? AND profile_id = ?",
            (invitation["family_id"], invitation["profile_id"]),
        ).fetchone():
            raise HTTPException(status_code=409, detail="Für dieses Familienprofil besteht bereits ein Login-Konto.")
        with database.use_database_file(auth_database.get_family_db_path(invitation["db_key"])):
            _validate_profile_for_role(invitation["profile_id"], invitation["role"])
        cursor = conn.execute(
            """
            INSERT INTO accounts (
                family_id, email, display_name, password_hash, role, profile_id,
                email_verified, is_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)
            """,
            (
                invitation["family_id"],
                invitation["email"],
                payload.display_name.strip(),
                hash_password(payload.password),
                invitation["role"],
                invitation["profile_id"],
                _utc_now().isoformat(),
            ),
        )
        conn.execute(
            "UPDATE invitations SET consumed_at = ? WHERE token_hash = ?",
            (_utc_now().isoformat(), hash_token(payload.token)),
        )
        conn.commit()
        return {"message": "Konto erstellt. Du kannst dich jetzt anmelden.", "account_id": cursor.lastrowid}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.get("/accounts")
def list_accounts(actor: AccountContext = Depends(require_roles("admin"))):
    conn = auth_database.get_auth_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, family_id, email, display_name, role, profile_id,
                   email_verified, is_active, created_at
            FROM accounts WHERE family_id = ? ORDER BY created_at, id
            """,
            (actor.family_id,),
        ).fetchall()
    finally:
        conn.close()

    calendar_conn = database.get_db_connection()
    try:
        profiles = {
            row["id"]: row["name"]
            for row in calendar_conn.execute("SELECT id, name FROM users").fetchall()
        }
    finally:
        calendar_conn.close()
    result = []
    for row in rows:
        account = _account_response(row)
        account["profile_name"] = profiles.get(row["profile_id"])
        account["created_at"] = row["created_at"]
        result.append(account)
    return result


@router.get("/invitations")
def list_invitations(actor: AccountContext = Depends(require_roles("admin"))):
    conn = auth_database.get_auth_connection()
    try:
        rows = conn.execute(
            """
            SELECT invitation_id, email, role, profile_id, created_at, expires_at,
                   consumed_at, revoked_at
            FROM invitations
            WHERE family_id = ?
            ORDER BY created_at DESC, invitation_id
            """,
            (actor.family_id,),
        ).fetchall()
    finally:
        conn.close()

    calendar_conn = database.get_db_connection()
    try:
        profiles = {
            row["id"]: row["name"]
            for row in calendar_conn.execute("SELECT id, name FROM users").fetchall()
        }
    finally:
        calendar_conn.close()

    now = _utc_now().isoformat()
    result = []
    for row in rows:
        if row["consumed_at"]:
            invitation_status = "accepted"
        elif row["revoked_at"]:
            invitation_status = "revoked"
        elif row["expires_at"] <= now:
            invitation_status = "expired"
        else:
            invitation_status = "pending"
        result.append(
            {
                "id": row["invitation_id"],
                "email": row["email"],
                "role": row["role"],
                "profile_id": row["profile_id"],
                "profile_name": profiles.get(row["profile_id"]),
                "created_at": row["created_at"],
                "expires_at": row["expires_at"],
                "status": invitation_status,
            }
        )
    return result


@router.post("/invitations", status_code=status.HTTP_201_CREATED)
def invite_account(
    payload: InvitePayload,
    request: Request,
    actor: AccountContext = Depends(require_roles("admin")),
):
    client_host = request.client.host if request.client else "unknown"
    consume_rate_limit(f"invite:{actor.id}:{client_host}", 30, 3600)
    if not _smtp_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="E-Mail-Versand muss vor dem Einladen konfiguriert werden.",
        )
    _validate_profile_for_role(payload.profile_id, payload.role)
    conn = auth_database.get_auth_connection()
    token = create_token()
    try:
        if conn.execute(
            "SELECT 1 FROM accounts WHERE email = ? COLLATE NOCASE",
            (payload.email,),
        ).fetchone():
            raise HTTPException(status_code=409, detail="Für diese E-Mail-Adresse besteht bereits ein Konto.")
        if conn.execute(
            """
            SELECT 1 FROM accounts
            WHERE family_id = ? AND profile_id = ?
            """,
            (actor.family_id, payload.profile_id),
        ).fetchone():
            raise HTTPException(status_code=409, detail="Für dieses Familienprofil besteht bereits ein Login-Konto.")
        if conn.execute(
            """
            SELECT 1 FROM invitations
            WHERE family_id = ? AND profile_id = ? AND consumed_at IS NULL
              AND revoked_at IS NULL AND expires_at > ?
            """,
            (actor.family_id, payload.profile_id, _utc_now().isoformat()),
        ).fetchone():
            raise HTTPException(status_code=409, detail="Für dieses Familienprofil besteht bereits eine Einladung.")
        conn.execute(
            """
            UPDATE invitations SET revoked_at = ?
            WHERE family_id = ? AND (email = ? COLLATE NOCASE OR profile_id = ?)
              AND consumed_at IS NULL AND revoked_at IS NULL
            """,
            (_utc_now().isoformat(), actor.family_id, payload.email, payload.profile_id),
        )
        conn.execute(
            """
            INSERT INTO invitations (
                invitation_id, token_hash, family_id, email, role, profile_id,
                created_by, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                uuid.uuid4().hex,
                hash_token(token),
                actor.family_id,
                payload.email,
                payload.role,
                payload.profile_id,
                actor.id,
                _utc_now().isoformat(),
                (_utc_now() + timedelta(days=7)).isoformat(),
            ),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    _send_email(
        payload.email,
        "Einladung zum Familienkalender",
        f"Du wurdest zum Familienkalender eingeladen.\n"
        f"Einladung annehmen: {_frontend_link('accept-invitation', token)}\n"
        "Der Link ist 7 Tage gültig.",
    )
    return {"message": "Einladung wurde versendet."}


@router.post("/invitations/{invitation_id}/resend")
def resend_invitation(
    invitation_id: str,
    request: Request,
    actor: AccountContext = Depends(require_roles("admin")),
):
    client_host = request.client.host if request.client else "unknown"
    consume_rate_limit(f"invite:{actor.id}:{client_host}", 30, 3600)
    if not _smtp_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="E-Mail-Versand muss vor dem Einladen konfiguriert werden.",
        )

    token = create_token()
    now = _utc_now()
    conn = auth_database.get_auth_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        invitation = conn.execute(
            """
            SELECT * FROM invitations
            WHERE invitation_id = ? AND family_id = ?
            """,
            (invitation_id, actor.family_id),
        ).fetchone()
        if invitation is None:
            raise HTTPException(status_code=404, detail="Einladung nicht gefunden.")
        if invitation["consumed_at"] or invitation["revoked_at"]:
            raise HTTPException(
                status_code=409,
                detail="Diese Einladung kann nicht erneut versendet werden.",
            )
        if conn.execute(
            "SELECT 1 FROM accounts WHERE email = ? COLLATE NOCASE",
            (invitation["email"],),
        ).fetchone():
            raise HTTPException(
                status_code=409,
                detail="Für diese E-Mail-Adresse besteht bereits ein Konto.",
            )
        if conn.execute(
            """
            SELECT 1 FROM accounts
            WHERE family_id = ? AND profile_id = ?
            """,
            (actor.family_id, invitation["profile_id"]),
        ).fetchone():
            raise HTTPException(
                status_code=409,
                detail="Für dieses Familienprofil besteht bereits ein Login-Konto.",
            )
        if conn.execute(
            """
            SELECT 1 FROM invitations
            WHERE family_id = ? AND profile_id = ? AND invitation_id != ?
              AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
            """,
            (actor.family_id, invitation["profile_id"], invitation_id, now.isoformat()),
        ).fetchone():
            raise HTTPException(
                status_code=409,
                detail="Für dieses Familienprofil besteht bereits eine andere Einladung.",
            )
        _validate_profile_for_role(invitation["profile_id"], invitation["role"])
        conn.execute(
            """
            UPDATE invitations
            SET token_hash = ?, created_at = ?, expires_at = ?
            WHERE invitation_id = ? AND family_id = ?
            """,
            (
                hash_token(token),
                now.isoformat(),
                (now + timedelta(days=7)).isoformat(),
                invitation_id,
                actor.family_id,
            ),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    _send_email(
        invitation["email"],
        "Einladung zum Familienkalender",
        f"Du wurdest zum Familienkalender eingeladen.\n"
        f"Einladung annehmen: {_frontend_link('accept-invitation', token)}\n"
        "Der Link ist 7 Tage gültig.",
    )
    return {"message": "Einladung wurde erneut versendet."}


@router.put("/accounts/{account_id}")
def update_account(
    account_id: int,
    payload: AccountUpdatePayload,
    actor: AccountContext = Depends(require_roles("admin")),
):
    conn = auth_database.get_auth_connection()
    try:
        target = conn.execute(
            "SELECT id, family_id FROM accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
        if target is None or target["family_id"] != actor.family_id:
            raise HTTPException(status_code=404, detail="Konto nicht gefunden.")
        if account_id == actor.id and (payload.role != "admin" or not payload.is_active):
            raise HTTPException(status_code=400, detail="Das eigene Admin-Konto kann hier nicht deaktiviert oder herabgestuft werden.")
        _validate_profile_for_role(payload.profile_id, payload.role)
        if conn.execute(
            """
            SELECT 1 FROM accounts
            WHERE family_id = ? AND profile_id = ? AND id != ?
            """,
            (actor.family_id, payload.profile_id, account_id),
        ).fetchone():
            raise HTTPException(status_code=409, detail="Für dieses Familienprofil besteht bereits ein anderes Login-Konto.")
        conn.execute(
            """
            UPDATE accounts SET role = ?, profile_id = ?, is_active = ?
            WHERE id = ? AND family_id = ?
            """,
            (
                payload.role,
                payload.profile_id,
                int(payload.is_active),
                account_id,
                actor.family_id,
            ),
        )
        if not payload.is_active:
            conn.execute(
                "DELETE FROM sessions WHERE account_id = ?",
                (account_id,),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"message": "Konto aktualisiert."}


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: int,
    actor: AccountContext = Depends(require_roles("admin")),
):
    if account_id == actor.id:
        raise HTTPException(status_code=400, detail="Das eigene Konto kann nicht gelöscht werden.")
    conn = auth_database.get_auth_connection()
    try:
        conn.execute(
            "DELETE FROM invitations WHERE created_by = ?",
            (account_id,),
        )
        cursor = conn.execute(
            "DELETE FROM accounts WHERE id = ? AND family_id = ?",
            (account_id, actor.family_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Konto nicht gefunden.")
        conn.commit()
    finally:
        conn.close()


@router.get("/family")
def get_family(actor: AccountContext = Depends(require_authenticated)):
    family = auth_database.get_family(actor.family_id)
    if family is None:
        raise HTTPException(status_code=404, detail="Familienbereich nicht gefunden.")
    return {"id": family["id"], "name": family["name"]}
