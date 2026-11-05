import threading
import time
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import database
import requests
from datetime import datetime

router = APIRouter(prefix="/api/config", tags=["SystemConfig"])

WEATHER_CACHE_TTL_SECONDS = 60 * 60
_weather_cache_lock = threading.Lock()
_weather_cache: dict | None = None
_weather_cache_key: tuple | None = None
_weather_cache_time = 0.0
_location_lookup_lock = threading.Lock()
_attempted_location_lookups: set[tuple[str, str]] = set()
logger = logging.getLogger(__name__)


def _invalidate_weather_cache():
    global _weather_cache, _weather_cache_key, _weather_cache_time
    with _weather_cache_lock:
        _weather_cache = None
        _weather_cache_key = None
        _weather_cache_time = 0.0


class ConfigUpdate(BaseModel):
    weather_city: str
    weather_plz: str
    weather_service: str
    api_key: str
    weather_latitude: float | None = None
    weather_longitude: float | None = None


class LocationLookupError(Exception):
    pass


def ensure_weather_location() -> bool:
    with _location_lookup_lock:
        conn = database.get_db_connection()
        try:
            cfg = conn.execute(
                "SELECT id, weather_city, weather_plz, weather_latitude, weather_longitude "
                "FROM system_config ORDER BY id ASC LIMIT 1"
            ).fetchone()
        finally:
            conn.close()

        if cfg is None or not str(cfg["weather_plz"] or "").strip():
            return False
        if cfg["weather_latitude"] is not None and cfg["weather_longitude"] is not None:
            return True

        lookup_key = (database.DB_FILE, str(cfg["weather_plz"]).strip())
        if lookup_key in _attempted_location_lookups:
            return False
        _attempted_location_lookups.add(lookup_key)

        url_zippopotam = "".join(["https://", "api.", "zippopotam", ".us/de/"])
        try:
            response = requests.get(
                f"{url_zippopotam}{str(cfg['weather_plz']).strip()}",
                timeout=5,
            )
            response.raise_for_status()
            location_data = response.json()
            if not isinstance(location_data, dict):
                raise ValueError("Die Antwort für diese Postleitzahl ist ungültig.")
            places = location_data.get("places")
            if not isinstance(places, list) or not places:
                raise ValueError("Keine Orte für diese Postleitzahl gefunden.")
            place = places[0]
            city_name = place.get("place name")
            latitude = float(place["latitude"])
            longitude = float(place["longitude"])
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                raise ValueError("Die Koordinaten der Postleitzahl sind ungültig.")
            if not isinstance(city_name, str) or not city_name.strip():
                raise ValueError("Die Ortsangabe der Postleitzahl ist ungültig.")
        except (requests.RequestException, ValueError, KeyError, TypeError) as error:
            raise LocationLookupError(
                f"Ort und Koordinaten konnten für PLZ {cfg['weather_plz']} nicht ermittelt werden."
            ) from error

        conn = database.get_db_connection()
        try:
            conn.execute(
                """
                UPDATE system_config
                SET weather_city = ?, weather_latitude = ?, weather_longitude = ?
                WHERE id = ? AND weather_plz = ?
                  AND (weather_latitude IS NULL OR weather_longitude IS NULL)
                """,
                (
                    city_name.strip(),
                    latitude,
                    longitude,
                    cfg["id"],
                    cfg["weather_plz"],
                ),
            )
            conn.commit()
        finally:
            conn.close()

        _invalidate_weather_cache()
        return True

def _refresh_live_weather():
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
    lat = cfg["weather_latitude"]
    lon = cfg["weather_longitude"]
    city_name = cfg["weather_city"] or ""

    url_open_meteo = "".join(["https://", "api.", "open-meteo", ".com/v1/", "fore", "cast"])
    url_weather_api = "".join(["http://", "api.", "weatherapi", ".com/v1/", "fore", "cast", ".json"])

    print(f"📋 Konfiguration geladen: Ausgelesene PLZ aus DB = '{plz}' | Dienst = {service}")

    temp = "--"
    rain = "--"
    high_temp = "--"
    low_temp = "--"
    try:
        # Weather requests use the persisted location; ZIP lookups happen only on save or startup.
        if lat is not None and lon is not None:
            
            # --- Open-Meteo Modus ---
            if service == "open_meteo":
                w_params = {
                    "latitude": float(lat),
                    "longitude": float(lon),
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
            logger.info("Wetterabruf übersprungen; für PLZ %s sind keine Koordinaten gespeichert.", plz)
            
    except Exception as e:
        print(f"❌ WEATHER-ENGINE ERROR: {e}")
        logger.exception("Wetterdaten konnten nicht abgerufen werden.")
    finally:
        conn.close()
        print("--- 🔍 ENDE DETAIL-DIAGNOSE WETTER-API ---\n")
    
    return {
        "weather_city": city_name,
        "weather_plz": plz or "",
        "weather_latitude": lat,
        "weather_longitude": lon,
        "weather_service": service,
        "api_key": api_key,
        "live_temp": temp,
        "live_rain": rain,
        "high_temp": high_temp,
        "low_temp": low_temp
    }


def fetch_live_weather_pure_ram():
    global _weather_cache, _weather_cache_key, _weather_cache_time

    with _weather_cache_lock:
        conn = database.get_db_connection()
        try:
            cfg = conn.execute(
                "SELECT weather_plz, weather_service, api_key, weather_latitude, weather_longitude "
                "FROM system_config ORDER BY id ASC LIMIT 1"
            ).fetchone()
            if cfg is None:
                cache_key = (database.DB_FILE, None)
            else:
                cache_key = (
                    database.DB_FILE,
                    cfg["weather_plz"],
                    cfg["weather_service"],
                    cfg["api_key"],
                    cfg["weather_latitude"],
                    cfg["weather_longitude"],
                )
        finally:
            conn.close()

        now = time.monotonic()
        if (
            _weather_cache is not None
            and _weather_cache_key == cache_key
            and now - _weather_cache_time < WEATHER_CACHE_TTL_SECONDS
        ):
            return dict(_weather_cache)

        result = _refresh_live_weather()
        _weather_cache = dict(result)
        _weather_cache_key = cache_key
        _weather_cache_time = time.monotonic()
        return dict(result)


@router.get("")
def get_config():
    return fetch_live_weather_pure_ram()


@router.get("/settings")
def get_config_settings():
    conn = database.get_db_connection()
    try:
        cfg = conn.execute(
            """
            SELECT weather_city, weather_plz, weather_service, api_key,
                   weather_latitude, weather_longitude, live_temp, live_rain
            FROM system_config ORDER BY id ASC LIMIT 1
            """
        ).fetchone()
    finally:
        conn.close()

    if cfg is None:
        raise HTTPException(status_code=404, detail="Systemkonfiguration nicht gefunden.")

    result = {
        "weather_city": cfg["weather_city"] or "",
        "weather_plz": cfg["weather_plz"] or "",
        "weather_latitude": cfg["weather_latitude"],
        "weather_longitude": cfg["weather_longitude"],
        "weather_service": cfg["weather_service"] or "open_meteo",
        "api_key": cfg["api_key"] or "",
        "live_temp": cfg["live_temp"] or "--",
        "live_rain": cfg["live_rain"] or "--",
        "high_temp": "--",
        "low_temp": "--",
    }

    if _weather_cache_lock.acquire(blocking=False):
        try:
            cache_key = (
                database.DB_FILE,
                cfg["weather_plz"],
                cfg["weather_service"],
                cfg["api_key"],
                cfg["weather_latitude"],
                cfg["weather_longitude"],
            )
            if _weather_cache is not None and _weather_cache_key == cache_key:
                result.update({
                    key: _weather_cache[key]
                    for key in ("live_temp", "live_rain", "high_temp", "low_temp")
                })
        finally:
            _weather_cache_lock.release()
    return result


@router.post("/location")
def resolve_weather_location():
    try:
        resolved = ensure_weather_location()
        return {
            "location_resolved": resolved,
            "location_error": None if resolved else "Standort konnte nicht ermittelt werden.",
        }
    except LocationLookupError as error:
        logger.warning("%s", error)
        return {
            "location_resolved": False,
            "location_error": str(error),
        }


@router.put("")
def update_config(payload: ConfigUpdate):
    conn = database.get_db_connection()
    try:
        current = conn.execute(
            "SELECT id, weather_plz, weather_city, weather_latitude, weather_longitude "
            "FROM system_config ORDER BY id ASC LIMIT 1"
        ).fetchone()
        final_service = "open_meteo" if payload.weather_service == "manual" else payload.weather_service
        new_plz = payload.weather_plz.strip()
        location_changed = current is None or new_plz != str(current["weather_plz"] or "").strip()
        if location_changed and new_plz:
            _attempted_location_lookups.discard((database.DB_FILE, new_plz))
        if location_changed:
            city = ""
            latitude = None
            longitude = None
        else:
            city = current["weather_city"] or ""
            latitude = current["weather_latitude"]
            longitude = current["weather_longitude"]
        conn.execute("""
            UPDATE system_config
            SET weather_city = ?, weather_plz = ?, weather_service = ?, api_key = ?,
                weather_latitude = ?, weather_longitude = ?
            WHERE id = (SELECT id FROM system_config ORDER BY id ASC LIMIT 1)
        """, (city, new_plz, final_service, payload.api_key, latitude, longitude))
        conn.commit()
    finally:
        conn.close()

    _invalidate_weather_cache()
    
    location_resolved = latitude is not None and longitude is not None
    location_error = None
    if new_plz and not location_resolved:
        try:
            location_resolved = ensure_weather_location()
            if not location_resolved:
                location_error = (
                    "Standort wurde noch nicht ermittelt. Ein erneuter Versuch erfolgt beim nächsten Serverstart."
                )
        except LocationLookupError as error:
            location_error = (
                f"{error} Ein erneuter Versuch erfolgt beim nächsten Serverstart."
            )
            logger.warning("%s", location_error)

    return {
        "status": "success",
        "location_resolved": location_resolved,
        "location_error": location_error,
    }
