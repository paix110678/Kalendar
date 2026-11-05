import logging
from datetime import date, datetime, timezone

import requests
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, field_validator

import database


router = APIRouter(prefix="/api/holidays", tags=["Ferien und Feiertage"])
logger = logging.getLogger(__name__)

OPENHOLIDAYS_API = "https://openholidaysapi.org"
REQUEST_TIMEOUT_SECONDS = 10
STATE_SUBDIVISIONS = {
    "BW": "DE-BW",
    "BY": "DE-BY",
    "BE": "DE-BE",
    "BB": "DE-BB",
    "HB": "DE-HB",
    "HH": "DE-HH",
    "HE": "DE-HE",
    "MV": "DE-MV",
    "NI": "DE-NI",
    "NW": "DE-NW",
    "RP": "DE-RP",
    "SL": "DE-SL",
    "SN": "DE-SN",
    "ST": "DE-ST",
    "SH": "DE-SH",
    "TH": "DE-TH",
}


class HolidayStateCreate(BaseModel):
    state_code: str

    @field_validator("state_code")
    @classmethod
    def validate_state_code(cls, value: str) -> str:
        code = value.strip().upper()
        if code not in STATE_SUBDIVISIONS:
            raise ValueError("state_code must be a German state abbreviation")
        return code


def _parse_holidays(payload, state_code: str, year: int, holiday_type: str):
    if not isinstance(payload, list):
        raise ValueError("OpenHolidays response must be a list")

    parsed = []
    seen = set()
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("every OpenHolidays entry must be an object")

        try:
            start = date.fromisoformat(item["startDate"])
            end = date.fromisoformat(item["endDate"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("OpenHolidays dates must be ISO dates") from error
        if end < start or start > year_end or end < year_start:
            raise ValueError("OpenHolidays entry is outside the requested year")

        names = item.get("name")
        if not isinstance(names, list):
            raise ValueError("OpenHolidays entry must contain localized names")
        name = next(
            (
                entry.get("text")
                for entry in names
                if isinstance(entry, dict) and entry.get("language") == "DE"
            ),
            None,
        )
        if not isinstance(name, str) or not name.strip():
            raise ValueError("OpenHolidays entry must contain a German name")

        subdivisions = item.get("subdivisions")
        if subdivisions:
            codes = {
                subdivision.get("code")
                for subdivision in subdivisions
                if isinstance(subdivision, dict)
            }
            if codes and STATE_SUBDIVISIONS[state_code] not in codes:
                continue

        record = (holiday_type, name.strip(), start.isoformat(), end.isoformat())
        if record not in seen:
            parsed.append(record)
            seen.add(record)
    return parsed


def _fetch_year(state_code: str, year: int):
    params = {
        "countryIsoCode": "DE",
        "subdivisionCode": STATE_SUBDIVISIONS[state_code],
        "languageIsoCode": "DE",
        "validFrom": f"{year}-01-01",
        "validTo": f"{year}-12-31",
    }
    results = []
    try:
        for endpoint, holiday_type in (
            ("SchoolHolidays", "school"),
            ("PublicHolidays", "public"),
        ):
            response = requests.get(
                f"{OPENHOLIDAYS_API}/{endpoint}",
                params=params,
                headers={"Accept": "application/json"},
                timeout=REQUEST_TIMEOUT_SECONDS,
                allow_redirects=False,
            )
            if 300 <= response.status_code < 400:
                raise ValueError("OpenHolidays redirects are not supported")
            response.raise_for_status()
            results.extend(_parse_holidays(response.json(), state_code, year, holiday_type))
    except (requests.RequestException, ValueError, TypeError) as error:
        failure = str(error) if isinstance(error, ValueError) else type(error).__name__
        logger.warning("OpenHolidays fetch failed for state %s, year %s: %s", state_code, year, failure)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenHolidays request or response failed for {state_code} {year}",
        ) from error

    return results


def _save_state_and_holidays(state_code: str, years: dict[int, list]):
    conn = database.get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute(
            "SELECT 1 FROM holiday_states WHERE state_code = ?", (state_code,)
        ).fetchone():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bundesland ist bereits gespeichert.")

        conn.execute(
            "INSERT INTO holiday_states (state_code, added_at) VALUES (?, ?)",
            (state_code, datetime.now(timezone.utc).isoformat()),
        )
        for year, holidays in years.items():
            conn.executemany(
                """
                INSERT INTO holidays (state_code, year, holiday_type, name, start_date, end_date)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (state_code, year, holiday_type, name, start, end)
                    for holiday_type, name, start, end in holidays
                ],
            )
            conn.execute(
                """
                INSERT INTO holiday_years (state_code, year, synced_at)
                VALUES (?, ?, ?)
                """,
                (state_code, year, datetime.now(timezone.utc).isoformat()),
            )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as error:
        conn.rollback()
        logger.exception("Could not save holidays for state %s", state_code)
        raise HTTPException(status_code=500, detail="Could not store holidays") from error
    finally:
        conn.close()


@router.get("/states")
def list_holiday_states():
    conn = database.get_db_connection()
    try:
        rows = conn.execute("SELECT state_code FROM holiday_states ORDER BY state_code").fetchall()
        return [row["state_code"] for row in rows]
    finally:
        conn.close()


@router.get("/states/data")
def list_saved_holiday_data():
    conn = database.get_db_connection()
    try:
        states = [
            row["state_code"]
            for row in conn.execute(
                "SELECT state_code FROM holiday_states ORDER BY state_code"
            ).fetchall()
        ]
        holidays = [
            dict(row)
            for row in conn.execute(
                """
                SELECT state_code, year, holiday_type, name, start_date, end_date
                FROM holidays
                ORDER BY state_code, year, start_date, name
                """
            ).fetchall()
        ]
        return {"states": states, "holidays": holidays}
    finally:
        conn.close()


@router.post("/states", status_code=status.HTTP_201_CREATED)
def add_holiday_state(payload: HolidayStateCreate):
    conn = database.get_db_connection()
    try:
        exists = conn.execute(
            "SELECT 1 FROM holiday_states WHERE state_code = ?", (payload.state_code,)
        ).fetchone()
    finally:
        conn.close()
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bundesland ist bereits gespeichert.")

    current_year = date.today().year
    years = {
        year: _fetch_year(payload.state_code, year)
        for year in (current_year, current_year + 1)
    }
    _save_state_and_holidays(payload.state_code, years)

    return {
        "state_code": payload.state_code,
        "years": list(years),
        "holidays": _list_holidays(payload.state_code),
    }


@router.delete("/states/{state_code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holiday_state(state_code: str):
    state = state_code.strip().upper()
    if state not in STATE_SUBDIVISIONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Ungültiges Bundesland.")
    conn = database.get_db_connection()
    try:
        exists = conn.execute(
            "SELECT 1 FROM holiday_states WHERE state_code = ?", (state,)
        ).fetchone()
        if exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bundesland nicht gefunden.")
        conn.execute("DELETE FROM holidays WHERE state_code = ?", (state,))
        conn.execute("DELETE FROM holiday_years WHERE state_code = ?", (state,))
        conn.execute("DELETE FROM holiday_states WHERE state_code = ?", (state,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return None


@router.get("/states/{state_code}/holidays")
def list_holidays(
    state_code: str,
    year: int | None = Query(default=None, ge=2000, le=2100),
):
    state = state_code.strip().upper()
    if state not in STATE_SUBDIVISIONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Ungültiges Bundesland.")
    return _list_holidays(state, year)


def _list_holidays(state: str, year: int | None = None):
    conn = database.get_db_connection()
    try:
        if conn.execute(
            "SELECT 1 FROM holiday_states WHERE state_code = ?", (state,)
        ).fetchone() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bundesland ist nicht gespeichert.")

        query = """
            SELECT state_code, year, holiday_type, name, start_date, end_date
            FROM holidays WHERE state_code = ?
        """
        params: tuple = (state,)
        if year is not None:
            query += " AND year = ?"
            params += (year,)
        query += " ORDER BY year, holiday_type, start_date, name"
        return [dict(row) for row in conn.execute(query, params).fetchall()]
    finally:
        conn.close()
