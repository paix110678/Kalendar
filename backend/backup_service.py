import base64
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import uuid

import database


logger = logging.getLogger(__name__)
BACKUP_FORMAT = "kalendar-sqlite-backup"
BACKUP_VERSION = 1
BACKUP_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
SQLITE_OBJECT_ORDER = {"table": 0, "view": 1, "index": 2, "trigger": 3}
_migration_errors: dict[str, str] = {}


class InvalidBackupError(ValueError):
    pass


def get_backup_directory() -> Path:
    active_db_file = database.get_active_db_file().resolve()
    default_db_file = Path(database.DB_FILE).resolve()
    if active_db_file == default_db_file:
        return active_db_file.parent / "backups"
    return active_db_file.parent / "backups" / active_db_file.stem


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _encode_value(value):
    if isinstance(value, bytes):
        return {"$sqlite_blob_base64": base64.b64encode(value).decode("ascii")}
    return value


def _decode_value(value):
    if isinstance(value, dict):
        if set(value) != {"$sqlite_blob_base64"}:
            raise InvalidBackupError("Backup enthält einen ungültigen Feldwert.")
        try:
            return base64.b64decode(value["$sqlite_blob_base64"], validate=True)
        except (ValueError, TypeError) as error:
            raise InvalidBackupError("Backup enthält einen ungültigen Binärwert.") from error
    return value


def _schema_objects(conn: sqlite3.Connection) -> list[dict]:
    objects = conn.execute(
        """
        SELECT type, name, tbl_name, sql
        FROM sqlite_master
        WHERE type IN ('table', 'view', 'index', 'trigger')
          AND name NOT LIKE 'sqlite_%'
          AND sql IS NOT NULL
        """
    ).fetchall()
    return [
        dict(row)
        for row in sorted(
            objects,
            key=lambda row: (
                SQLITE_OBJECT_ORDER[row["type"]],
                row["name"],
            ),
        )
    ]


def _serialize_connection(conn: sqlite3.Connection, created_at: str) -> dict:
    schema = _schema_objects(conn)
    tables = []
    for item in schema:
        if item["type"] != "table":
            continue

        columns = [
            row["name"]
            for row in conn.execute(
                f"PRAGMA table_xinfo({_quote_identifier(item['name'])})"
            ).fetchall()
            if row["hidden"] == 0
        ]
        if not columns:
            raise InvalidBackupError(
                f'Tabelle "{item["name"]}" besitzt keine sicher exportierbaren Spalten.'
            )
        select_columns = ", ".join(_quote_identifier(column) for column in columns)
        rows = conn.execute(
            f"SELECT {select_columns} FROM {_quote_identifier(item['name'])}"
        ).fetchall()
        tables.append({
            "name": item["name"],
            "columns": columns,
            "rows": [[_encode_value(value) for value in row] for row in rows],
        })

    sequences = []
    if conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
    ).fetchone():
        sequences = [
            {"name": row["name"], "seq": row["seq"]}
            for row in conn.execute("SELECT name, seq FROM sqlite_sequence ORDER BY name")
        ]

    return {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "created_at": created_at,
        "database": {
            "user_version": conn.execute("PRAGMA user_version").fetchone()[0],
            "application_id": conn.execute("PRAGMA application_id").fetchone()[0],
        },
        "schema": schema,
        "tables": tables,
        "sequences": sequences,
    }


def _validate_backup(payload: object) -> dict:
    if (
        not isinstance(payload, dict)
        or payload.get("format") != BACKUP_FORMAT
        or payload.get("version") != BACKUP_VERSION
        or not isinstance(payload.get("schema"), list)
        or not isinstance(payload.get("tables"), list)
    ):
        raise InvalidBackupError("Datei ist kein unterstütztes Kalender-Datenbankbackup.")

    schema = payload["schema"]
    tables = payload["tables"]
    allowed_types = set(SQLITE_OBJECT_ORDER)
    for item in schema:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("type"), str)
            or item["type"] not in allowed_types
            or not isinstance(item.get("name"), str)
            or not isinstance(item.get("sql"), str)
        ):
            raise InvalidBackupError("Backup enthält ungültige Datenbankschemadaten.")

    schema_tables = {
        item["name"] for item in schema if item["type"] == "table"
    }
    seen_tables = set()
    for table in tables:
        if (
            not isinstance(table, dict)
            or not isinstance(table.get("name"), str)
            or table["name"] not in schema_tables
            or not isinstance(table.get("columns"), list)
            or not table["columns"]
            or any(not isinstance(column, str) for column in table["columns"])
            or len(set(table["columns"])) != len(table["columns"])
            or not isinstance(table.get("rows"), list)
        ):
            raise InvalidBackupError("Backup enthält ungültige Tabellendaten.")
        if table["name"] in seen_tables:
            raise InvalidBackupError("Backup enthält eine Tabelle mehrfach.")
        seen_tables.add(table["name"])
        if any(
            not isinstance(row, list) or len(row) != len(table["columns"])
            for row in table["rows"]
        ):
            raise InvalidBackupError("Backup enthält ungültige Tabellenzeilen.")
    if seen_tables != schema_tables:
        raise InvalidBackupError("Backup enthält nicht alle Tabellenzeilen.")

    if (
        not isinstance(payload.get("created_at"), str)
        or not isinstance(payload.get("database"), dict)
        or not isinstance(payload["database"].get("user_version"), int)
        or not isinstance(payload["database"].get("application_id"), int)
        or not isinstance(payload.get("sequences"), list)
        or any(
            not isinstance(sequence, dict)
            or not isinstance(sequence.get("name"), str)
            or not isinstance(sequence.get("seq"), int)
            for sequence in payload["sequences"]
        )
    ):
        raise InvalidBackupError("Backup enthält ungültige Datenbankmetadaten.")
    for table in tables:
        for row in table["rows"]:
            for value in row:
                if isinstance(value, dict):
                    _decode_value(value)
                elif not isinstance(value, (type(None), str, int, float, bool)):
                    raise InvalidBackupError("Backup enthält einen ungültigen Feldwert.")
    return payload


def _load_backup(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as backup_file:
            return _validate_backup(json.load(backup_file))
    except (OSError, json.JSONDecodeError) as error:
        raise InvalidBackupError("Backup-Datei kann nicht gelesen werden.") from error


def _restore_payload(payload: dict, db_file: Path) -> None:
    conn = sqlite3.connect(db_file)
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        schema = payload["schema"]
        for item in schema:
            if item["type"] == "table":
                conn.execute(item["sql"])

        for table in payload["tables"]:
            columns = ", ".join(_quote_identifier(column) for column in table["columns"])
            placeholders = ", ".join("?" for _ in table["columns"])
            sql = (
                f"INSERT INTO {_quote_identifier(table['name'])} ({columns}) "
                f"VALUES ({placeholders})"
            )
            conn.executemany(
                sql,
                [
                    [_decode_value(value) for value in row]
                    for row in table["rows"]
                ],
            )

        sequences_table_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
        ).fetchone()
        if sequences_table_exists:
            for sequence in payload["sequences"]:
                conn.execute(
                    "UPDATE sqlite_sequence SET seq = ? WHERE name = ?",
                    (sequence["seq"], sequence["name"]),
                )
                if conn.execute(
                    "SELECT changes()"
                ).fetchone()[0] == 0:
                    conn.execute(
                        "INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)",
                        (sequence["name"], sequence["seq"]),
                    )

        for item in schema:
            if item["type"] != "table":
                conn.execute(item["sql"])

        conn.execute(
            "PRAGMA user_version = "
            + str(int(payload["database"].get("user_version", 0)))
        )
        conn.execute(
            "PRAGMA application_id = "
            + str(int(payload["database"].get("application_id", 0)))
        )
        conn.commit()
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise InvalidBackupError(f"SQLite-Integritätsprüfung fehlgeschlagen: {result}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _table_columns(conn: sqlite3.Connection, table_name: str) -> dict[str, sqlite3.Row]:
    return {
        row["name"]: row
        for row in conn.execute(
            f"PRAGMA table_xinfo({_quote_identifier(table_name)})"
        ).fetchall()
        if row["hidden"] == 0
    }


def _sync_schema_from_database(source_path: Path, target_path: Path) -> None:
    source = sqlite3.connect(source_path)
    target = sqlite3.connect(target_path)
    source.row_factory = sqlite3.Row
    target.row_factory = sqlite3.Row
    try:
        target.execute("PRAGMA foreign_keys = OFF")
        target_schema = {
            (row["type"], row["name"]): row["sql"]
            for row in target.execute(
                """
                SELECT type, name, sql FROM sqlite_master
                WHERE type IN ('table', 'view', 'index', 'trigger')
                  AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
                """
            )
        }
        source_schema = _schema_objects(source)

        for item in source_schema:
            if item["type"] != "table":
                continue
            table_name = item["name"]
            existing_columns = _table_columns(target, table_name)
            if not existing_columns:
                target.execute(item["sql"])
                existing_columns = _table_columns(target, table_name)

            source_columns = _table_columns(source, table_name)
            row_count = target.execute(
                f"SELECT COUNT(*) FROM {_quote_identifier(table_name)}"
            ).fetchone()[0]
            for column_name, source_column in source_columns.items():
                if column_name in existing_columns:
                    continue
                if source_column["pk"]:
                    raise InvalidBackupError(
                        f'Die neue Primärschlüsselspalte "{table_name}.{column_name}" '
                        "kann nicht verlustfrei zu einem bestehenden Backup hinzugefügt werden."
                    )

                definition = (
                    f"{_quote_identifier(column_name)} {source_column['type'] or ''}"
                )
                default_value = source_column["dflt_value"]
                if source_column["notnull"] and (
                    default_value is not None or row_count == 0
                ):
                    definition += " NOT NULL"
                if default_value is not None:
                    definition += f" DEFAULT {default_value}"
                target.execute(
                    f"ALTER TABLE {_quote_identifier(table_name)} ADD COLUMN {definition}"
                )

        target_schema = {
            (row["type"], row["name"]): row["sql"]
            for row in target.execute(
                """
                SELECT type, name, sql FROM sqlite_master
                WHERE type IN ('table', 'view', 'index', 'trigger')
                  AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
                """
            )
        }
        for item in source_schema:
            if item["type"] == "table":
                continue
            key = (item["type"], item["name"])
            if target_schema.get(key) == item["sql"]:
                continue
            if key in target_schema:
                drop_type = {
                    "view": "VIEW",
                    "index": "INDEX",
                    "trigger": "TRIGGER",
                }[item["type"]]
                target.execute(
                    f"DROP {drop_type} IF EXISTS {_quote_identifier(item['name'])}"
                )
            target.execute(item["sql"])

        target.commit()
        integrity = target.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise InvalidBackupError(
                f"SQLite-Integritätsprüfung nach Schemaabgleich fehlgeschlagen: {integrity}"
            )
    except Exception:
        target.rollback()
        raise
    finally:
        target.close()
        source.close()


def _new_temporary_database(directory: Path) -> Path:
    handle, file_path = tempfile.mkstemp(
        prefix=".database-",
        suffix=".sqlite3",
        dir=directory,
    )
    os.close(handle)
    return Path(file_path)


def _write_backup(payload: dict, backup_path: Path) -> None:
    handle, temporary_path = tempfile.mkstemp(
        prefix=".backup-",
        suffix=".json.tmp",
        dir=backup_path.parent,
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as backup_file:
            json.dump(payload, backup_file, ensure_ascii=False, separators=(",", ":"))
            backup_file.write("\n")
            backup_file.flush()
            os.fsync(backup_file.fileno())
        os.replace(temporary_path, backup_path)
    except Exception:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)
        raise


def create_backup() -> dict:
    backup_directory = get_backup_directory()
    backup_directory.mkdir(parents=True, exist_ok=True)
    backup_id = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        + "_"
        + uuid.uuid4().hex
    )
    backup_path = backup_directory / f"{backup_id}.json"
    snapshot_path = _new_temporary_database(backup_directory)
    try:
        source = database.get_db_connection()
        snapshot = sqlite3.connect(snapshot_path)
        snapshot.row_factory = sqlite3.Row
        try:
            source.backup(snapshot)
            payload = _serialize_connection(
                snapshot,
                datetime.now(timezone.utc).isoformat(),
            )
        finally:
            snapshot.close()
            source.close()
        _write_backup(payload, backup_path)
        return {
            "id": backup_id,
            "created_at": payload["created_at"],
            "size_bytes": backup_path.stat().st_size,
        }
    finally:
        snapshot_path.unlink(missing_ok=True)


def list_backups() -> tuple[list[dict], list[dict]]:
    backup_directory = get_backup_directory()
    if not backup_directory.exists():
        return [], []

    backups = []
    errors = []
    for path in sorted(backup_directory.glob("*.json"), reverse=True):
        if not BACKUP_ID_PATTERN.fullmatch(path.stem):
            errors.append({"file": path.name, "error": "Ungültiger Dateiname."})
            continue
        if path.stem in _migration_errors:
            errors.append({"file": path.name, "error": _migration_errors[path.stem]})
            continue
        try:
            payload = _load_backup(path)
            backups.append({
                "id": path.stem,
                "created_at": payload.get("created_at"),
                "size_bytes": path.stat().st_size,
            })
        except (InvalidBackupError, OSError) as error:
            logger.error("Could not read database backup %s: %s", path.name, error)
            errors.append({"file": path.name, "error": str(error)})
    return backups, errors


def get_backup_path(backup_id: str) -> Path:
    if not BACKUP_ID_PATTERN.fullmatch(backup_id):
        raise InvalidBackupError("Ungültige Backup-ID.")
    return get_backup_directory() / f"{backup_id}.json"


def download_backup(backup_id: str) -> Path:
    path = get_backup_path(backup_id)
    if not path.is_file():
        raise FileNotFoundError("Backup wurde nicht gefunden.")
    _load_backup(path)
    return path


def delete_backup(backup_id: str) -> None:
    path = get_backup_path(backup_id)
    if not path.is_file():
        raise FileNotFoundError(f"Backup {backup_id} not found")
    path.unlink()


def restore_backup(backup_id: str) -> dict:
    backup_path = download_backup(backup_id)
    payload = _load_backup(backup_path)
    return _restore_validated_payload(payload, backup_id)


def restore_uploaded_backup(payload: object) -> dict:
    validated_payload = _validate_backup(payload)
    backup_directory = get_backup_directory()
    backup_directory.mkdir(parents=True, exist_ok=True)
    backup_id = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        + "_"
        + uuid.uuid4().hex
    )
    backup_path = backup_directory / f"{backup_id}.json"
    _write_backup(validated_payload, backup_path)
    try:
        return _restore_validated_payload(validated_payload, backup_id)
    except (InvalidBackupError, OSError, sqlite3.Error, TypeError, ValueError):
        backup_path.unlink(missing_ok=True)
        raise


def _restore_validated_payload(payload: dict, backup_id: str) -> dict:
    live_db_path = database.get_active_db_file().resolve()
    staged_db_path = _new_temporary_database(live_db_path.parent)
    try:
        _restore_payload(payload, staged_db_path)
        database.init_db(str(staged_db_path))
        _sync_schema_from_database(live_db_path, staged_db_path)
        conn = sqlite3.connect(staged_db_path)
        conn.row_factory = sqlite3.Row
        try:
            result = conn.execute("PRAGMA integrity_check").fetchone()[0]
            if result != "ok":
                raise InvalidBackupError(f"SQLite-Integritätsprüfung fehlgeschlagen: {result}")
        finally:
            conn.close()

        recovery_backup = create_backup()
        os.replace(staged_db_path, live_db_path)
        return {
            "restored_backup_id": backup_id,
            "recovery_backup_id": recovery_backup["id"],
        }
    finally:
        staged_db_path.unlink(missing_ok=True)


def migrate_backup_files() -> list[dict]:
    backup_directory = get_backup_directory()
    if not backup_directory.exists():
        return []

    failures = []
    _migration_errors.clear()
    for path in sorted(backup_directory.glob("*.json")):
        if not BACKUP_ID_PATTERN.fullmatch(path.stem):
            continue

        staged_db_path = _new_temporary_database(backup_directory)
        migrated_path = path.with_suffix(".json.migrating")
        try:
            payload = _load_backup(path)
            _restore_payload(payload, staged_db_path)
            database.init_db(str(staged_db_path))
            _sync_schema_from_database(database.get_active_db_file().resolve(), staged_db_path)
            conn = sqlite3.connect(staged_db_path)
            conn.row_factory = sqlite3.Row
            try:
                migrated_payload = _serialize_connection(
                    conn,
                    payload.get("created_at") or datetime.now(timezone.utc).isoformat(),
                )
            finally:
                conn.close()

            if migrated_payload != payload:
                _write_backup(migrated_payload, migrated_path)
                os.replace(migrated_path, path)
                logger.info("Migrated database backup %s to the current schema", path.name)
            _migration_errors.pop(path.stem, None)
        except (InvalidBackupError, OSError, sqlite3.Error, ValueError, TypeError) as error:
            logger.exception("Could not migrate database backup %s", path.name)
            failures.append({"file": path.name, "error": str(error)})
            _migration_errors[path.stem] = str(error)
        finally:
            staged_db_path.unlink(missing_ok=True)
            migrated_path.unlink(missing_ok=True)
    return failures
