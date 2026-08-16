from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import database
import requests
from datetime import datetime

router = APIRouter(prefix="/api/config", tags=["SystemConfig"])

class ConfigUpdate(BaseModel):
    weather_city: str
    weather_plz: str
    weather_service: str
    api_key: str

def fetch_live_weather_pure_ram():
    print("\n--- 🔍 START DETAIL-DIAGNOSE WETTER-API ---")
    conn = database.get_db_connection()
    cfg = conn.execute("SELECT * FROM system_config ORDER BY id ASC LIMIT 1").fetchone()
    if not cfg:
        print("❌ DIAGNOSE: Keine system_config in der Datenbank gefunden!")
        conn.close()
        print("--- 🔍 ENDE DETAIL-DIAGNOSE WETTER-API ---\n")
        return {"weather_city": "Lade...", "live_temp": "--", "live_rain": "--"}

    # BEHOBEN: Absolut keine feste Postleitzahl ("28790") mehr als Fallback im Code!
    plz = cfg["weather_plz"]
    service = cfg["weather_service"] or "open_meteo"
    api_key = cfg["api_key"] or ""

    url_open_meteo = "".join(["https://", "api.", "open-meteo", ".com/v1/", "fore", "cast"])
    url_weather_api = "".join(["http://", "api.", "weatherapi", ".com/v1/", "fore", "cast", ".json"])
    url_zippopotam = "".join(["https://", "api.", "zippopotam", ".us/de/"])

    print(f"📋 Konfiguration geladen: Ausgelesene PLZ aus DB = '{plz}' | Dienst = {service}")

    temp = "--"
    rain = "--"
    high_temp = "--"
    low_temp = "--"
    city_name = ""
    lat = None
    lon = None

    try:
        # Step A: Wenn eine PLZ in der Datenbank hinterlegt ist, fragen wir Zippopotam ab
        if plz and str(plz).strip():
            full_zip_url = f"{url_zippopotam}{str(plz).strip()}"
            print(f"🌐 Rufe PLZ-Schnittstelle auf: {full_zip_url}")
            zip_res = requests.get(full_zip_url, timeout=5)
            
            if zip_res.status_code == 200:
                zip_data = zip_res.json()
                if "places" in zip_data and len(zip_data["places"]) > 0:
                    place = zip_data["places"][0] # Holt das erste Element sicher über den numerischen Index
                    lat = str(place["latitude"])
                    lon = str(place["longitude"])
                    city_name = place.get("place name", "")
                    print(f"📍 Geocoding-Erfolg: '{city_name}' (Lat: {lat}, Lon: {lon})")
            else:
                print(f"⚠️ Zippopotam API meldet Statuscode {zip_res.status_code}. PLZ existiert evtl. nicht.")
        else:
            print("⚠️ DIAGNOSE: Keine PLZ in den Systemeinstellungen hinterlegt. Überspringe Abfrage.")

        # Step B: Wetter-Abruf NUR, wenn wir echte Koordinaten erhalten haben
        if lat and lon:
            
            # --- Open-Meteo Modus ---
            if service == "open_meteo":
                w_params = {
                    "latitude": lat,
                    "longitude": lon,
                    "hourly": "precipitation_probability",
                    "current": "temperature_2m",
                    "current_weather": "true",
                    "timezone": "Europe/Berlin",
                    "daily": "temperature_2m_max,temperature_2m_min"
                }
                print(f"🌐 Sende HTTP-Anfrage an Endpunkt: {url_open_meteo}")
                response = requests.get(url_open_meteo, params=w_params, timeout=5)
                print(f"📡 API-Antwort erhalten. HTTP-Statuscode: {response.status_code}")
                
                if response.status_code == 200:
                    w_res = response.json()
                    if "current" in w_res and "temperature_2m" in w_res["current"]:
                        temp = str(round(float(w_res["current"]["temperature_2m"])))
                    elif "current_weather" in w_res and "temperature" in w_res["current_weather"]:
                        temp = str(round(float(w_res["current_weather"]["temperature"])))
                    
                    if "hourly" in w_res and "precipitation_probability" in w_res["hourly"]:
                        current_hour = datetime.now().hour
                        rain_probabilities = w_res["hourly"]["precipitation_probability"]
                        if len(rain_probabilities) > current_hour:
                            rain = f"{rain_probabilities[current_hour]}%"
                    
                    # Daily high/low temperatures
                    if "daily" in w_res and "temperature_2m_max" in w_res["daily"] and "temperature_2m_min" in w_res["daily"]:
                        max_temp = w_res["daily"]["temperature_2m_max"]
                        min_temp = w_res["daily"]["temperature_2m_min"]
                        # Take the first day's value (today)
                        if len(max_temp) > 0:
                            high_temp = str(round(float(max_temp[0])))
                        else:
                            high_temp = "--"
                        if len(min_temp) > 0:
                            low_temp = str(round(float(min_temp[0])))
                        else:
                            low_temp = "--"
                    else:
                        high_temp = "--"
                        low_temp = "--"

            # --- WeatherAPI Modus ---
            elif service == "weather_api" and api_key:
                print(f"🌐 Sende HTTP-Anfrage an Endpunkt: {url_weather_api}")
                w_params = {"key": api_key, "q": f"{lat},{lon}", "days": "1"}
                response = requests.get(url_weather_api, params=w_params, timeout=5)
                if response.status_code == 200:
                    w_res = response.json()
                    if "current" in w_res:
                        temp = str(round(float(w_res["current"]["temp_c"])))
                        rain = f"{w_res['forecast']['forecastday']['day']['daily_chance_of_rain']}%"
        else:
            print("❌ DIAGNOSE-ABBRUCH: Keine Koordinaten ermittelbar. Wetterabruf blockiert.")

        # Speichert den Namen nur ab, wenn wir echte Daten generieren konnten
        if city_name and (temp != "--" or rain != "--"):
            conn.execute("UPDATE system_config SET weather_city = ? WHERE id = ?", (city_name, cfg["id"]))
            conn.commit()
            print(f"🎉 DIAGNOSE-ERFOLG: Reines Live-Wetter im RAM -> {city_name}: {temp}°C, Regen: {rain}")
        else:
            city_name = city_name or "--"
            print("⚠️ DIAGNOSE-WARNUNG: Keine Live-Wetterdaten geladen.")
            
    except Exception as e:
        print(f"❌ WEATHER-ENGINE ERROR: {e}")
        city_name = "Fehler"
    finally:
        conn.close()
        print("--- 🔍 ENDE DETAIL-DIAGNOSE WETTER-API ---\n")
    
    return {
        "weather_city": city_name,
        "weather_plz": plz or "",
        "weather_service": service,
        "api_key": api_key,
        "live_temp": temp,
        "live_rain": rain,
        "high_temp": high_temp,
        "low_temp": low_temp
    }

@router.get("")
def get_config():
    return fetch_live_weather_pure_ram()

@router.put("")
def update_config(payload: ConfigUpdate):
    conn = database.get_db_connection()
    final_service = "open_meteo" if payload.weather_service == "manual" else payload.weather_service
    conn.execute("""
        UPDATE system_config 
        SET weather_city = ?, weather_plz = ?, weather_service = ?, api_key = ?
        WHERE id = (SELECT id FROM system_config ORDER BY id ASC LIMIT 1)
    """, (payload.weather_city, payload.weather_plz, final_service, payload.api_key))
    conn.commit()
    conn.close()
    
    return {"status": "success"}
