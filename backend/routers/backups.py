import json
import logging
import sqlite3

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

import backup_service


router = APIRouter(prefix="/api/backups", tags=["Datenbank-Backups"])
logger = logging.getLogger(__name__)
MAX_BACKUP_UPLOAD_BYTES = 50 * 1024 * 1024


@router.get("")
def list_database_backups():
    backups, errors = backup_service.list_backups()
    return {"backups": backups, "errors": errors}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_database_backup():
    try:
        return backup_service.create_backup()
    except (OSError, sqlite3.Error, TypeError, ValueError) as error:
        logger.exception("Could not create database backup")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Datenbankbackup konnte nicht erstellt werden.",
        ) from error


@router.get("/{backup_id}/download")
def download_database_backup(backup_id: str):
    try:
        path = backup_service.download_backup(backup_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except backup_service.InvalidBackupError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    return FileResponse(
        path,
        media_type="application/json",
        filename=path.name,
    )


@router.delete("/{backup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_database_backup(backup_id: str):
    try:
        backup_service.delete_backup(backup_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except OSError as error:
        logger.exception("Could not delete database backup %s", backup_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Datenbankbackup konnte nicht gelöscht werden.",
        ) from error
    return None


@router.post("/{backup_id}/restore")
def restore_database_backup(backup_id: str):
    try:
        return backup_service.restore_backup(backup_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except backup_service.InvalidBackupError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    except (OSError, sqlite3.Error, TypeError, ValueError) as error:
        logger.exception("Could not restore database backup %s", backup_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Datenbankbackup konnte nicht wiederhergestellt werden.",
        ) from error


@router.post("/restore-file")
async def restore_database_backup_file(request: Request):
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_BACKUP_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Die Backup-Datei darf höchstens 50 MB groß sein.",
            )

    try:
        payload = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Die Datei enthält kein gültiges JSON-Backup.",
        ) from error

    try:
        return await run_in_threadpool(backup_service.restore_uploaded_backup, payload)
    except backup_service.InvalidBackupError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    except (OSError, sqlite3.Error, TypeError, ValueError) as error:
        logger.exception("Could not restore uploaded database backup")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Backup-Datei konnte nicht wiederhergestellt werden.",
        ) from error
