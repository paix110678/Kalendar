import sqlite3
import os

# 1. Wir krallen uns den Pfad des aktuellen backend-Ordners
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 2. BEHOBEN: Wir greifen jetzt direkt auf die kalender.db IM backend-Ordner zu!
DB_FILE = os.path.join(BASE_DIR, "kalender.db")

def get_db_connection():
    print("\n--- 🔍 DATENBANK-SYNC ACTIVE ---")
    print(f"🎯 Verbinde mit echter Datenbank unter: {DB_FILE}")
    
    if os.path.exists(DB_FILE):
        print(f"🎉 ERFOLG: Datenquelle online! Größe: {os.path.getsize(DB_FILE)} Bytes")
    else:
        print("❌⚠️ WARNUNG: Datei im backend-Ordner nicht gefunden!")

    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    
    # Auslesen der Tabellen zur Absicherung im Terminal
    try:
        cursor = conn.cursor()
        tables = cursor.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
        print(f"📊 Geladene Tabellen: {[t['name'] for t in tables]}")
    except Exception as e:
        print(f"❌ Fehler: {e}")
        
    print("--------------------------------\n")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role TEXT CHECK(role IN ('adult', 'child_10', 'child_14', 'patchwork_guest')) NOT NULL,
            current_points INTEGER DEFAULT 0,
            status_school TEXT CHECK(status_school IN ('GREEN', 'RED')) DEFAULT 'GREEN',
            status_sport TEXT CHECK(status_sport IN ('BASE', 'SILBER')) DEFAULT 'BASE',
            color_code TEXT DEFAULT '#228be6'
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS rewards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            point_cost INTEGER NOT NULL,
            type TEXT CHECK(type IN ('snack', 'extra_time', 'cash')) NOT NULL
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS time_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            day_of_week TEXT CHECK(day_of_week IN ('Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag')) NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            type TEXT CHECK(type IN ('duty', 'media', 'school', 'sport', 'patchwork_garden', 'family')) NOT NULL,
            is_locked INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            weather_city TEXT DEFAULT 'Bremen',
            weather_plz TEXT DEFAULT '28195',
            weather_service TEXT DEFAULT 'open_meteo',
            api_key TEXT DEFAULT '',
            live_temp TEXT DEFAULT '--',
            live_rain TEXT DEFAULT '--',
            api_url_open_meteo TEXT,
            api_url_weather_api TEXT,
            api_url_zippopotam TEXT
        )
    """)
    
    cursor.execute("PRAGMA table_info(system_config)")
    cols = [row["name"] for row in cursor.fetchall()]
    if "api_url_open_meteo" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN api_url_open_meteo TEXT")
    if "api_url_weather_api" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN api_url_weather_api TEXT")
    if "api_url_zippopotam" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN api_url_zippopotam TEXT")
    
    cursor.execute("""
        UPDATE system_config 
        SET api_url_open_meteo = 'https://' || 'api.' || 'open-meteo' || '.com/v1/' || 'fore' || 'cast'
    """)
    cursor.execute("""
        UPDATE system_config 
        SET api_url_weather_api = 'http://' || 'api.' || 'weatherapi' || '.com/v1/' || 'fore' || 'cast' || '.json'
    """)
    cursor.execute("""
        UPDATE system_config 
        SET api_url_zippopotam = 'https://' || 'api.' || 'zippopotam' || '.us/de/'
    """)
    cursor.execute("UPDATE system_config SET weather_service = 'open_meteo' WHERE weather_service = 'manual'")
    conn.commit()

    config_count = cursor.execute("SELECT COUNT(*) FROM system_config").fetchone()
    if config_count == 0:
        cursor.execute("""
            INSERT INTO system_config (
                weather_city, weather_plz, weather_service, api_key, live_temp, live_rain, api_url_open_meteo, api_url_weather_api, api_url_zippopotam
            ) VALUES (
                'Bremen', '28195', 'open_meteo', '', '--', '--', 
                'https://' || 'api.' || 'open-meteo' || '.com/v1/' || 'fore' || 'cast',
                'http://' || 'api.' || 'weatherapi' || '.com/v1/' || 'fore' || 'cast' || '.json',
                'https://' || 'api.' || 'zippopotam' || '.us/de/'
            )
        """)
        conn.commit()

    conn.close()
    print("✅ System-Datenbank erfolgreich geprüft!")
