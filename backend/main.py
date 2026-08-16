from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import database
import asyncio

# Router-Imports
from routers import users, blocks, rewards, config

app = FastAPI(title="Familien-Kalender API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Nativer, asynchroner Hintergrund-Timer für das stündliche Wetter-Update
async def hourly_weather_cron_task():
    # Wir warten nach dem Serverstart 3 Sekunden, damit die DB bereit ist
    await asyncio.sleep(3)
    while True:
        print("⏰ Stündliche Wetter-API-Aktualisierung wird ausgeführt...")
        try:
            # BEHOBEN: Ruft jetzt die korrekte, bereinigte Methode 'fetch_live_weather_pure_ram' auf
            config.fetch_live_weather_pure_ram()
        except Exception as e:
            print(f"⚠️ Wetter-Cron-Job verzögert: {e}")
        # Wartet exakt 1 Stunde (3600 Sekunden) im Hintergrund
        await asyncio.sleep(3600)

@app.on_event("startup")
async def startup_event():
    # Zuerst die Datenbank initialisieren
    database.init_db()
    # Erst danach das Hintergrund-Intervall starten
    asyncio.create_task(hourly_weather_cron_task())

app.include_router(users.router)
app.include_router(blocks.router)
app.include_router(rewards.router)
app.include_router(config.router)

@app.get("/")
def read_root():
    return {"status": "online", "message": "Familienplaner-Zentrale läuft fehlerfrei."}
