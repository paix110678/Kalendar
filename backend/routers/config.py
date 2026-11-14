import threading
import time
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import auth_database
import database
from security import AccountContext, require_authenticated, require_roles
import requests
from datetime import datetime

router = APIRouter(prefix="/api/config", tags=["SystemConfig"])

WEATHER_CACHE_TTL_SECONDS = 60 * 60
_weather_cache_lock = threading.Lock()
_weather_cache: dict[tuple, tuple[dict, float]] = {}
_location_lookup_lock = threading.Lock()
_nominatim_lookup_lock = threading.Lock()
_nominatim_last_request_at = 0.0
_attempted_location_lookups: set[tuple[str, str]] = set()
logger = logging.getLogger(__name__)


def _invalidate_weather_cache():
    with _weather_cache_lock:
        _weather_cache.clear()


def _active_db_key() -> str:
    return str(database.get_active_db_file().resolve())


class ConfigUpdate(BaseModel):
    weather_plz: str


class HeaderPreferencesUpdate(BaseModel):
    show_users: bool
    show_view_mode: bool
    show_weather: bool


class WeatherLocationCreate(BaseModel):
    weather_plz: str = Field(..., min_length=5, max_length=5, pattern=r"^\d{5}$")


class ProfileWeatherSelection(BaseModel):
    location_id: int = Field(..., ge=1)


class LocationLookupError(Exception):
    pass


def _serialize_weather_location(row):
    return {
        "id": row["id"],
        "weather_city": row["weather_city"] or "",
        "weather_plz": row["weather_plz"] or "",
        "weather_latitude": row["weather_latitude"],
        "weather_longitude": row["weather_longitude"],
    }


def _sync_active_weather_location(conn):
    config = conn.execute(
        "SELECT * FROM system_config ORDER BY id ASC LIMIT 1"
    ).fetchone()
    if config is None:
        return
    active = conn.execute(
        "SELECT id FROM weather_locations WHERE is_active = 1 ORDER BY id LIMIT 1"
    ).fetchone()
    if active is None:
        return
    conn.execute(
        """
        UPDATE weather_locations
        SET weather_city = ?, weather_plz = ?, weather_latitude = ?, weather_longitude = ?
        WHERE id = ?
        """,
        (
            config["weather_city"] or "",
            config["weather_plz"] or "",
            config["weather_latitude"],
            config["weather_longitude"],
            active["id"],
        ),
    )


def _lookup_weather_location(postal_code: str) -> tuple[str, float, float]:
    url_zippopotam = "".join(["https://", "api.", "zippopotam", ".us/de/"])
    try:
        response = requests.get(f"{url_zippopotam}{postal_code}", timeout=5)
        response.raise_for_status()
        location_data = response.json()
        if not isinstance(location_data, dict):
            raise ValueError("Die Antwort für diese Postleitzahl ist ungültig.")
        places = location_data.get("places")
        if not isinstance(places, list) or not places:
            raise ValueError("Keine Orte für diese Postleitzahl gefunden.")
        place = places[0]
        if not isinstance(place, dict):
            raise ValueError("Die Ortsangabe der Postleitzahl ist ungültig.")
        city_name = place.get("place name")
        return _validated_location(
            city_name,
            place["latitude"],
            place["longitude"],
        )
    except (requests.RequestException, ValueError, KeyError, TypeError):
        try:
            results = _lookup_nominatim(postal_code)
            if not isinstance(results, list) or not results:
                raise ValueError("Keine passenden Ortsdaten gefunden.")
            result = results[0]
            if not isinstance(result, dict):
                raise ValueError("Die Ortsdaten haben ein ungültiges Format.")
            address = result.get("address")
            if not isinstance(address, dict):
                raise ValueError("Die Ortsangabe der Postleitzahl ist ungültig.")
            resolved_postal_code = str(address.get("postcode", "")).replace(" ", "")
            if resolved_postal_code != postal_code:
                raise ValueError("Die zurückgegebene Postleitzahl stimmt nicht überein.")
            if str(address.get("country_code", "de")).lower() != "de":
                raise ValueError("Die zurückgegebenen Ortsdaten gehören nicht zu Deutschland.")
            city_name = next(
                (
                    address[key]
                    for key in ("city", "town", "village", "municipality", "suburb")
                    if isinstance(address.get(key), str) and address[key].strip()
                ),
                None,
            )
            return _validated_location(city_name, result["lat"], result["lon"])
        except (requests.RequestException, ValueError, KeyError, TypeError) as fallback_error:
            raise LocationLookupError(
                f"Ort und Koordinaten konnten für PLZ {postal_code} nicht ermittelt werden."
            ) from fallback_error


def _lookup_nominatim(postal_code: str):
    global _nominatim_last_request_at
    with _nominatim_lookup_lock:
        elapsed = time.monotonic() - _nominatim_last_request_at
        if elapsed < 1:
            time.sleep(1 - elapsed)
        _nominatim_last_request_at = time.monotonic()
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "postalcode": postal_code,
                "country": "Germany",
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": 1,
            },
            headers={"User-Agent": "Kalendar weather location lookup"},
            timeout=5,
        )
        response.raise_for_status()
        return response.json()


def _validated_location(city_name, latitude, longitude) -> tuple[str, float, float]:
    latitude = float(latitude)
    longitude = float(longitude)
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError("Die Koordinaten der Postleitzahl sind ungültig.")
    if not isinstance(city_name, str) or not city_name.strip():
        raise ValueError("Die Ortsangabe der Postleitzahl ist ungültig.")
    return city_name.strip(), latitude, longitude


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

        lookup_key = (_active_db_key(), str(cfg["weather_plz"]).strip())
        if lookup_key in _attempted_location_lookups:
            return False
        _attempted_location_lookups.add(lookup_key)

        try:
            city_name, latitude, longitude = _lookup_weather_location(
                str(cfg["weather_plz"]).strip()
            )
        except LocationLookupError as error:
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
            _sync_active_weather_location(conn)
            conn.commit()
        finally:
            conn.close()

        _invalidate_weather_cache()
        return True

def _refresh_live_weather(location):
    city = location["weather_city"] or ""
    postal_code = location["weather_plz"] or ""
    latitude = location["weather_latitude"]
    longitude = location["weather_longitude"]
    result = {
        "weather_city": city,
        "weather_plz": postal_code,
        "weather_latitude": latitude,
        "weather_longitude": longitude,
        "live_temp": "--",
        "live_rain": "--",
        "high_temp": "--",
        "low_temp": "--",
    }
    if latitude is None or longitude is None:
        logger.info("Wetterabruf übersprungen; für PLZ %s fehlen Koordinaten.", postal_code)
        return result

    url = "".join(["https://", "api.", "open-meteo", ".com/v1/", "fore", "cast"])
    params = {
        "latitude": float(latitude),
        "longitude": float(longitude),
        "hourly": "precipitation_probability",
        "current": "temperature_2m",
        "timezone": "Europe/Berlin",
        "daily": "temperature_2m_max,temperature_2m_min",
    }
    try:
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        weather = response.json()
        if not isinstance(weather, dict):
            raise ValueError("Die Wetterdaten haben ein ungültiges Format.")
        current = weather.get("current", {})
        hourly = weather.get("hourly", {})
        daily = weather.get("daily", {})
        if not all(isinstance(section, dict) for section in (current, hourly, daily)):
            raise ValueError("Die Wetterdaten haben ein ungültiges Format.")
        if "temperature_2m" in current:
            result["live_temp"] = str(round(float(current["temperature_2m"])))
        probabilities = hourly.get("precipitation_probability", [])
        times = hourly.get("time", [])
        now = datetime.now().strftime("%Y-%m-%dT%H:00")
        current_hour = times.index(now) if now in times else datetime.now().hour
        if len(probabilities) > current_hour:
            result["live_rain"] = f"{probabilities[current_hour]}%"
        highs = daily.get("temperature_2m_max", [])
        lows = daily.get("temperature_2m_min", [])
        if highs:
            result["high_temp"] = str(round(float(highs[0])))
        if lows:
            result["low_temp"] = str(round(float(lows[0])))
    except (requests.RequestException, ValueError, TypeError, KeyError) as error:
        logger.warning("Wetterdaten für PLZ %s konnten nicht abgerufen werden: %s", postal_code, error)
    return result


def fetch_live_weather_pure_ram(location=None):
    with _weather_cache_lock:
        conn = database.get_db_connection()
        try:
            if location is None:
                location = conn.execute(
                    """
                    SELECT weather_city, weather_plz, weather_latitude, weather_longitude
                    FROM system_config ORDER BY id ASC LIMIT 1
                    """
                ).fetchone()
        finally:
            conn.close()

        if location is None:
            return _refresh_live_weather(
                {
                    "weather_city": "",
                    "weather_plz": "",
                    "weather_latitude": None,
                    "weather_longitude": None,
                }
            )

        cache_key = (
            _active_db_key(),
            location["weather_plz"],
            location["weather_city"],
            location["weather_latitude"],
            location["weather_longitude"],
        )
        now = time.monotonic()
        cached = _weather_cache.get(cache_key)
        if cached is not None and now - cached[1] < WEATHER_CACHE_TTL_SECONDS:
            return dict(cached[0])

        result = _refresh_live_weather(location)
        _weather_cache[cache_key] = (dict(result), time.monotonic())
        return dict(result)


@router.get("")
def get_config():
    return fetch_live_weather_pure_ram()


@router.get("/locations", dependencies=[Depends(require_roles("admin"))])
def get_weather_locations():
    conn = database.get_db_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM weather_locations ORDER BY is_active DESC, id"
        ).fetchall()
        return [_serialize_weather_location(row) for row in rows]
    finally:
        conn.close()


def _profile_weather_response(actor: AccountContext):
    auth_conn = auth_database.get_auth_connection()
    try:
        account = auth_conn.execute(
            "SELECT weather_location_id FROM accounts WHERE id = ? AND family_id = ?",
            (actor.id, actor.family_id),
        ).fetchone()
    finally:
        auth_conn.close()
    if account is None:
        raise HTTPException(status_code=404, detail="Konto nicht gefunden.")

    conn = database.get_db_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM weather_locations ORDER BY is_active DESC, id"
        ).fetchall()
        selected = next(
            (row for row in rows if row["id"] == account["weather_location_id"]),
            None,
        )
        if selected is None and rows:
            selected = next((row for row in rows if row["is_active"]), rows[0])
    finally:
        conn.close()

    if selected is None:
        weather = {
            "weather_city": "",
            "weather_plz": "",
            "weather_latitude": None,
            "weather_longitude": None,
            "live_temp": "--",
            "live_rain": "--",
            "high_temp": "--",
            "low_temp": "--",
        }
        selected_id = None
    else:
        weather = fetch_live_weather_pure_ram(selected)
        selected_id = selected["id"]

    return {
        "locations": [_serialize_weather_location(row) for row in rows],
        "selected_location_id": selected_id,
        **weather,
    }


@router.get("/profile-weather")
def get_profile_weather(actor: AccountContext = Depends(require_authenticated)):
    return _profile_weather_response(actor)


@router.put("/profile-weather")
def update_profile_weather(
    payload: ProfileWeatherSelection,
    actor: AccountContext = Depends(require_authenticated),
):
    conn = database.get_db_connection()
    try:
        exists = conn.execute(
            "SELECT 1 FROM weather_locations WHERE id = ?", (payload.location_id,)
        ).fetchone()
    finally:
        conn.close()
    if exists is None:
        raise HTTPException(status_code=404, detail="Wetterstandort nicht gefunden.")

    auth_conn = auth_database.get_auth_connection()
    try:
        cursor = auth_conn.execute(
            """
            UPDATE accounts SET weather_location_id = ?
            WHERE id = ? AND family_id = ?
            """,
            (payload.location_id, actor.id, actor.family_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Konto nicht gefunden.")
        auth_conn.commit()
    except Exception:
        auth_conn.rollback()
        raise
    finally:
        auth_conn.close()
    return _profile_weather_response(actor)


@router.get("/locations/{location_id}", dependencies=[Depends(require_roles("admin"))])
def get_weather_location(location_id: int):
    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT * FROM weather_locations WHERE id = ?", (location_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Standort nicht gefunden.")
        return _serialize_weather_location(row)
    finally:
        conn.close()


@router.post("/locations", dependencies=[Depends(require_roles("admin"))])
def create_weather_location(payload: WeatherLocationCreate):
    postal_code = payload.weather_plz.strip()

    city = ""
    latitude = None
    longitude = None
    location_error = None
    try:
        city, latitude, longitude = _lookup_weather_location(postal_code)
    except LocationLookupError as error:
        logger.warning("%s", error)
        raise HTTPException(status_code=502, detail=str(error)) from error

    conn = database.get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        active_exists = conn.execute(
            "SELECT 1 FROM weather_locations WHERE is_active = 1"
        ).fetchone() is not None
        cursor = conn.execute(
            """
            INSERT INTO weather_locations (
                weather_city, weather_plz, weather_latitude, weather_longitude, is_active
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                city,
                postal_code,
                latitude,
                longitude,
                0 if active_exists else 1,
            ),
        )
        if not active_exists:
            _activate_weather_location(conn, cursor.lastrowid)
        conn.commit()
        row = conn.execute(
            "SELECT * FROM weather_locations WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        result = _serialize_weather_location(row)
        result["location_error"] = location_error
        if row["is_active"]:
            _invalidate_weather_cache()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _activate_weather_location(conn, location_id: int):
    location = conn.execute(
        "SELECT * FROM weather_locations WHERE id = ?", (location_id,)
    ).fetchone()
    if location is None:
        raise HTTPException(status_code=404, detail="Standort nicht gefunden.")
    conn.execute("UPDATE weather_locations SET is_active = 0")
    conn.execute("UPDATE weather_locations SET is_active = 1 WHERE id = ?", (location_id,))
    config_id = conn.execute(
        "SELECT id FROM system_config ORDER BY id ASC LIMIT 1"
    ).fetchone()
    values = (
        location["weather_city"],
        location["weather_plz"],
        location["weather_latitude"],
        location["weather_longitude"],
    )
    if config_id is None:
        conn.execute(
            """
            INSERT INTO system_config (
                weather_city, weather_plz, weather_service, weather_latitude, weather_longitude
            )
            VALUES (?, ?, 'open_meteo', ?, ?)
            """,
            values,
        )
    else:
        conn.execute(
            """
            UPDATE system_config
            SET weather_city = ?, weather_plz = ?, weather_service = 'open_meteo',
                weather_latitude = ?, weather_longitude = ?
            WHERE id = ?
            """,
            (*values, config_id["id"]),
        )


@router.put("/locations/{location_id}/active", dependencies=[Depends(require_roles("admin"))])
def activate_weather_location(location_id: int):
    conn = database.get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        _activate_weather_location(conn, location_id)
        conn.commit()
        row = conn.execute(
            "SELECT * FROM weather_locations WHERE id = ?", (location_id,)
        ).fetchone()
        result = _serialize_weather_location(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    _invalidate_weather_cache()
    return result


@router.delete("/locations/{location_id}", dependencies=[Depends(require_roles("admin"))])
def delete_weather_location(location_id: int):
    conn = database.get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute(
            "SELECT * FROM weather_locations WHERE id = ?", (location_id,)
        ).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="Standort nicht gefunden.")
        if conn.execute("SELECT COUNT(*) FROM weather_locations").fetchone()[0] <= 1:
            raise HTTPException(
                status_code=409,
                detail="Der letzte Wetterstandort kann nicht gelöscht werden.",
            )
        conn.execute("DELETE FROM weather_locations WHERE id = ?", (location_id,))
        if current["is_active"]:
            next_location = conn.execute(
                "SELECT id FROM weather_locations ORDER BY id LIMIT 1"
            ).fetchone()
            _activate_weather_location(conn, next_location["id"])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    _invalidate_weather_cache()
    return {"status": "success", "message": "Wetterstandort wurde gelöscht."}


@router.get("/settings", dependencies=[Depends(require_roles("admin"))])
def get_config_settings():
    result = fetch_live_weather_pure_ram()
    if not result["weather_plz"]:
        raise HTTPException(status_code=404, detail="Systemkonfiguration nicht gefunden.")
    return result


@router.get("/header-preferences")
def get_header_preferences():
    conn = database.get_db_connection()
    try:
        cfg = conn.execute(
            """
            SELECT header_show_users, header_show_view_mode, header_show_weather
            FROM system_config ORDER BY id ASC LIMIT 1
            """
        ).fetchone()
    finally:
        conn.close()

    if cfg is None:
        raise HTTPException(status_code=404, detail="Systemkonfiguration nicht gefunden.")
    return {
        "show_users": bool(cfg["header_show_users"]),
        "show_view_mode": bool(cfg["header_show_view_mode"]),
        "show_weather": bool(cfg["header_show_weather"]),
    }


@router.put("/header-preferences", dependencies=[Depends(require_roles("admin"))])
def update_header_preferences(preferences: HeaderPreferencesUpdate):
    conn = database.get_db_connection()
    try:
        cursor = conn.execute(
            """
            UPDATE system_config
            SET header_show_users = ?, header_show_view_mode = ?, header_show_weather = ?
            WHERE id = (SELECT id FROM system_config ORDER BY id ASC LIMIT 1)
            """,
            (
                int(preferences.show_users),
                int(preferences.show_view_mode),
                int(preferences.show_weather),
            ),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Systemkonfiguration nicht gefunden.")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return preferences.model_dump()


@router.post("/location", dependencies=[Depends(require_roles("admin"))])
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


@router.put("", dependencies=[Depends(require_roles("admin"))])
def update_config(payload: ConfigUpdate):
    conn = database.get_db_connection()
    try:
        current = conn.execute(
            "SELECT id, weather_plz, weather_city, weather_latitude, weather_longitude "
            "FROM system_config ORDER BY id ASC LIMIT 1"
        ).fetchone()
        new_plz = payload.weather_plz.strip()
        location_changed = current is None or new_plz != str(current["weather_plz"] or "").strip()
        if location_changed and new_plz:
            _attempted_location_lookups.discard((_active_db_key(), new_plz))
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
            SET weather_city = ?, weather_plz = ?, weather_service = 'open_meteo',
                weather_latitude = ?, weather_longitude = ?
            WHERE id = (SELECT id FROM system_config ORDER BY id ASC LIMIT 1)
        """, (city, new_plz, latitude, longitude))
        conn.commit()
        _sync_active_weather_location(conn)
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
