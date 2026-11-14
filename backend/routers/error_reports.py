import base64
import binascii
import json
import sqlite3

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

import auth_database

router = APIRouter(prefix="/api/error-reports", tags=["Error reports"])
MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024


class ReportDiagnostics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    browser: str = Field(..., max_length=512)
    platform: str = Field(..., max_length=128)
    language: str = Field(..., max_length=35)
    timezone: str = Field(..., max_length=128)
    route: str = Field(..., max_length=512)
    viewport_width: int = Field(..., ge=0, le=20000)
    viewport_height: int = Field(..., ge=0, le=20000)
    screen_width: int = Field(..., ge=0, le=20000)
    screen_height: int = Field(..., ge=0, le=20000)
    device_pixel_ratio: float = Field(..., gt=0, le=10)
    color_depth: int = Field(..., ge=1, le=64)


class ErrorReportPayload(BaseModel):
    description: str = Field(..., min_length=10, max_length=5000)
    diagnostics: ReportDiagnostics
    screenshot: str | None = Field(default=None, max_length=8_500_000)

    @field_validator("description")
    @classmethod
    def description_must_not_be_blank(cls, value: str) -> str:
        description = value.strip()
        if len(description) < 10:
            raise ValueError("Bitte beschreibe den Fehler mit mindestens 10 Zeichen.")
        return description

    @model_validator(mode="after")
    def validate_report_data(self):
        if self.screenshot is not None:
            prefix = "data:image/jpeg;base64,"
            if not self.screenshot.startswith(prefix):
                raise ValueError("Der Screenshot muss ein JPEG-Bild sein.")
            try:
                image_data = base64.b64decode(self.screenshot[len(prefix):], validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError("Der Screenshot ist ungültig kodiert.") from error
            if len(image_data) > MAX_SCREENSHOT_BYTES:
                raise ValueError("Der Screenshot darf höchstens 6 MB groß sein.")
            if not image_data.startswith(b"\xff\xd8") or not image_data.endswith(b"\xff\xd9"):
                raise ValueError("Der Screenshot enthält keine gültige JPEG-Datei.")
        return self


@router.post("")
def create_error_report(payload: ErrorReportPayload):
    screenshot = (
        base64.b64decode(payload.screenshot.split(",", 1)[1], validate=True)
        if payload.screenshot is not None
        else None
    )
    conn = auth_database.get_auth_connection()
    try:
        cursor = conn.execute(
            """
            INSERT INTO error_reports (description, diagnostics, screenshot)
            VALUES (?, ?, ?)
            """,
            (
                payload.description,
                json.dumps(payload.diagnostics.model_dump(), ensure_ascii=False),
                screenshot,
            ),
        )
        conn.commit()
        return {"id": cursor.lastrowid, "status": "created"}
    except sqlite3.Error as error:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Fehlerbericht konnte nicht gespeichert werden.") from error
    finally:
        conn.close()
