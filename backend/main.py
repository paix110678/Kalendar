from contextlib import asynccontextmanager
import asyncio
import hmac
import logging
import os
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import database
import auth_database
import backup_service
import uvicorn
from security import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    check_csrf,
    load_session,
)

# Router-Imports
from routers import auth, users, blocks, rewards, config, plans, holidays, backups, tasks, error_reports

logger = logging.getLogger("uvicorn.error")

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(errors="backslashreplace")


# Nativer, asynchroner Hintergrund-Timer für das stündliche Wetter-Update
async def hourly_weather_cron_task():
    # Wir warten nach dem Serverstart 3 Sekunden, damit die DB bereit ist
    await asyncio.sleep(3)
    while True:
        for db_file in auth_database.list_family_db_paths():
            with database.use_database_file(db_file):
                try:
                    await asyncio.to_thread(config.ensure_weather_location)
                except config.LocationLookupError as error:
                    logger.warning(
                        "Wetterstandort für %s konnte nicht ermittelt werden: %s",
                        db_file.name,
                        error,
                    )
                try:
                    await asyncio.to_thread(config.fetch_live_weather_pure_ram)
                except Exception:
                    logger.exception("Wetteraktualisierung für %s fehlgeschlagen", db_file.name)
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Familien-Kalender API wird gestartet.")
    database.init_db()
    auth_database.init_auth_db()
    backup_migration_failures = backup_service.migrate_backup_files()
    if backup_migration_failures:
        logger.error(
            "%s Datenbankbackup(s) konnten nicht auf das aktuelle Schema migriert werden.",
            len(backup_migration_failures),
        )
    weather_task = asyncio.create_task(hourly_weather_cron_task())
    logger.info("Datenbank initialisiert; Wetteraktualisierung geplant.")
    try:
        yield
    finally:
        weather_task.cancel()
        try:
            await weather_task
        except asyncio.CancelledError:
            pass
        logger.info("Familien-Kalender API wird beendet.")


app = FastAPI(
    title="Familien-Kalender API",
    version="2.0.0",
    lifespan=lifespan,
)

PUBLIC_AUTH_ENDPOINTS = {
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/verify-email"),
    ("POST", "/api/auth/resend-verification"),
    ("POST", "/api/auth/request-password-reset"),
    ("POST", "/api/auth/reset-password"),
    ("POST", "/api/auth/accept-invitation"),
}


@app.middleware("http")
async def authenticate_api_requests(request, call_next):
    if not request.url.path.startswith("/api/") or request.method == "OPTIONS":
        return await call_next(request)
    if (request.method, request.url.path) in PUBLIC_AUTH_ENDPOINTS:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    session = load_session(request.cookies.get(SESSION_COOKIE))
    if session is None:
        return JSONResponse(
            status_code=401,
            content={"detail": "Anmeldung erforderlich."},
            headers={"Cache-Control": "no-store"},
        )
    actor, csrf_hash = session
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        csrf_cookie = request.cookies.get(CSRF_COOKIE)
        csrf_header = request.headers.get("X-CSRF-Token")
        if not check_csrf(csrf_cookie, csrf_header, csrf_hash):
            logger.warning(
                "CSRF validation failed: method=%s path=%s cookie_present=%s "
                "header_present=%s values_match=%s session_match=%s",
                request.method,
                request.url.path,
                csrf_cookie is not None,
                csrf_header is not None,
                bool(
                    csrf_cookie
                    and csrf_header
                    and hmac.compare_digest(csrf_cookie, csrf_header)
                ),
                bool(csrf_cookie and check_csrf(csrf_cookie, csrf_cookie, csrf_hash)),
            )
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF-Prüfung fehlgeschlagen."},
                headers={"Cache-Control": "no-store"},
            )

    request.state.account = actor
    with database.use_database_file(actor.db_file):
        response = await call_next(request)
    if request.url.path == "/api/auth/me":
        csrf_cookie = request.cookies.get(CSRF_COOKIE)
        if csrf_cookie and check_csrf(csrf_cookie, csrf_cookie, csrf_hash):
            response.headers["X-CSRF-Token"] = csrf_cookie
    response.headers["Cache-Control"] = "no-store"
    return response


allowed_origins = [
    origin.strip()
    for origin in os.environ.get(
        "KALENDAR_CORS_ORIGINS",
        "http://localhost:4200,http://127.0.0.1:4200",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(blocks.router)
app.include_router(rewards.router)
app.include_router(config.router)
app.include_router(plans.router)
app.include_router(holidays.router)
app.include_router(backups.router)
app.include_router(tasks.router)
app.include_router(error_reports.router)

@app.get("/")
def read_root():
    return {"status": "online", "message": "Familienplaner-Zentrale läuft fehlerfrei."}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
