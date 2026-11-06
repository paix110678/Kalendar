from contextlib import asynccontextmanager
import asyncio
import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import database
import backup_service
import uvicorn

# Router-Imports
from routers import users, blocks, rewards, config, plans, holidays, backups, tasks, error_reports

logger = logging.getLogger("uvicorn.error")

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(errors="backslashreplace")


# Nativer, asynchroner Hintergrund-Timer für das stündliche Wetter-Update
async def hourly_weather_cron_task():
    # Wir warten nach dem Serverstart 3 Sekunden, damit die DB bereit ist
    await asyncio.sleep(3)
    try:
        await asyncio.to_thread(config.ensure_weather_location)
    except config.LocationLookupError as error:
        logger.warning("Standort konnte beim Start nicht ermittelt werden; neuer Versuch beim nächsten Start: %s", error)

    while True:
        print("⏰ Stündliche Wetter-API-Aktualisierung wird ausgeführt...")
        try:
            await asyncio.to_thread(config.fetch_live_weather_pure_ram)
        except Exception as e:
            print(f"⚠️ Wetter-Cron-Job verzögert: {e}")
        # Wartet exakt 1 Stunde (3600 Sekunden) im Hintergrund
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Familien-Kalender API wird gestartet.")
    database.init_db()
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
