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

import auth_database
import database


logger = logging.getLogger(__name__)
BACKUP_FORMAT = "kalendar-sqlite-backup"
BACKUP_VERSION = 1
BACKUP_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
AUTH_TABLES = {
    "accounts",
    "email_tokens",
    "families",
    "invitations",
    "sessions",
    "auth_rate_limits",
}
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
    if schema_tables & AUTH_TABLES:
        raise InvalidBackupError(
            "Familienbackups dürfen keine Login- oder Authentifizierungsdaten enthalten."
        )
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


def _family_profile_links(db_file: Path) -> tuple[str, list[dict]] | None:
    if not auth_database.AUTH_DB_FILE.is_file():
        return None

    auth_conn = auth_database.get_auth_connection()
    try:
        family = next(
            (
                row
                for row in auth_conn.execute(
                    "SELECT id, db_key FROM families"
                ).fetchall()
                if auth_database.get_family_db_path(row["db_key"]).resolve() == db_file.resolve()
            ),
            None,
        )
        if family is None:
            return None

        accounts = auth_conn.execute(
            """
            SELECT id, profile_id
            FROM accounts
            WHERE family_id = ? AND profile_id IS NOT NULL
            ORDER BY id
            """,
            (family["id"],),
        ).fetchall()
    finally:
        auth_conn.close()

    calendar_conn = sqlite3.connect(db_file)
    calendar_conn.row_factory = sqlite3.Row
    try:
        profiles = {
            row["id"]: {"name": row["name"], "role": row["role"]}
            for row in calendar_conn.execute("SELECT id, name, role FROM users")
        }
    finally:
        calendar_conn.close()

    return family["id"], [
        {
            "account_id": account["id"],
            "profile_id": account["profile_id"],
            "name": profiles.get(account["profile_id"], {}).get("name"),
            "role": profiles.get(account["profile_id"], {}).get("role"),
        }
        for account in accounts
    ]


def _profile_link_updates(
    links: list[dict],
    restored_db_file: Path,
) -> list[tuple[int | None, int, int]]:
    conn = sqlite3.connect(restored_db_file)
    conn.row_factory = sqlite3.Row
    try:
        profiles = {
            row["id"]: row
            for row in conn.execute("SELECT id, name, role FROM users")
        }
    finally:
        conn.close()

    profiles_by_name_role: dict[tuple[str, str], list[int]] = {}
    for profile in profiles.values():
        key = (profile["name"].strip().casefold(), profile["role"])
        profiles_by_name_role.setdefault(key, []).append(profile["id"])

    updates = []
    claimed_profile_ids: set[int] = set()
    for link in links:
        restored_profile_id = link["profile_id"] if link["profile_id"] in profiles else None
        if restored_profile_id is None and link["name"] and link["role"]:
            matches = profiles_by_name_role.get(
                (link["name"].strip().casefold(), link["role"]),
                [],
            )
            if len(matches) == 1:
                restored_profile_id = matches[0]
        if restored_profile_id in claimed_profile_ids:
            restored_profile_id = None
        if restored_profile_id is not None:
            claimed_profile_ids.add(restored_profile_id)
        updates.append((restored_profile_id, link["account_id"], link["profile_id"]))
    return updates


def _snapshot_database(source_path: Path, snapshot_path: Path) -> None:
    source = sqlite3.connect(source_path)
    snapshot = sqlite3.connect(snapshot_path)
    try:
        source.backup(snapshot)
    finally:
        snapshot.close()
        source.close()


def _replace_database_and_profile_links(
    live_db_path: Path,
    staged_db_path: Path,
    profile_links: tuple[str, list[dict]] | None,
) -> tuple[int, int]:
    if profile_links is None:
        os.replace(staged_db_path, live_db_path)
        return 0, 0

    family_id, links = profile_links
    updates = _profile_link_updates(links, staged_db_path)
    old_db_path = _new_temporary_database(live_db_path.parent)
    _snapshot_database(live_db_path, old_db_path)

    auth_conn = auth_database.get_auth_connection()
    database_replaced = False
    try:
        auth_conn.execute("BEGIN IMMEDIATE")
        current_family = auth_conn.execute(
            "SELECT 1 FROM families WHERE id = ?",
            (family_id,),
        ).fetchone()
        if current_family is None:
            raise InvalidBackupError(
                "Die zugehörige Familie wurde während der Wiederherstellung entfernt."
            )

        for _, account_id, previous_profile_id in updates:
            current_link = auth_conn.execute(
                """
                SELECT 1 FROM accounts
                WHERE id = ? AND family_id = ? AND profile_id = ?
                """,
                (account_id, family_id, previous_profile_id),
            ).fetchone()
            if current_link is None:
                raise InvalidBackupError(
                    "Eine Profilverknüpfung wurde während der Wiederherstellung geändert. "
                    "Bitte starte die Wiederherstellung erneut."
                )

        for _, account_id, _ in updates:
            auth_conn.execute(
                "UPDATE accounts SET profile_id = NULL WHERE id = ? AND family_id = ?",
                (account_id, family_id),
            )

        for profile_id, account_id, _ in updates:
            if profile_id is not None:
                auth_conn.execute(
                    "UPDATE accounts SET profile_id = ? WHERE id = ? AND family_id = ?",
                    (profile_id, account_id, family_id),
                )

        os.replace(staged_db_path, live_db_path)
        database_replaced = True
        auth_conn.commit()
    except Exception:
        auth_conn.rollback()
        if database_replaced:
            os.replace(old_db_path, live_db_path)
            old_db_path = None
        raise
    finally:
        auth_conn.close()
        if old_db_path is not None:
            old_db_path.unlink(missing_ok=True)

    restored_links = sum(profile_id is not None for profile_id, _, _ in updates)
    unlinked_accounts = len(updates) - restored_links
    return restored_links, unlinked_accounts


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
    profile_links = _family_profile_links(live_db_path)
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
        restored_links, unlinked_accounts = _replace_database_and_profile_links(
            live_db_path,
            staged_db_path,
            profile_links,
        )
        return {
            "restored_backup_id": backup_id,
            "recovery_backup_id": recovery_backup["id"],
            "profile_links_restored": restored_links,
            "accounts_unlinked": unlinked_accounts,
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
