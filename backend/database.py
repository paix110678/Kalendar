import json
import sqlite3
import os
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

# 1. Standardmäßig liegt die Datenbank im backend-Ordner; Container können den Pfad überschreiben.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.environ.get("KALENDAR_DB_PATH", os.path.join(BASE_DIR, "kalender.db"))
_active_db_file: ContextVar[str | None] = ContextVar("active_db_file", default=None)


def get_active_db_file():
    return Path(_active_db_file.get() or DB_FILE)


@contextmanager
def use_database_file(db_file):
    token = _active_db_file.set(str(db_file))
    try:
        yield
    finally:
        _active_db_file.reset(token)

def get_db_connection(db_file=None):
    path = Path(db_file) if db_file is not None else get_active_db_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def delete_user_profile_data(conn, user_id, schema="main"):
    if schema not in {"main", "calendar"}:
        raise ValueError("Invalid calendar database schema")

    exclusive_task_ids = [
        row["task_id"]
        for row in conn.execute(
            f"""
            SELECT task_id
            FROM {schema}.task_participants
            GROUP BY task_id
            HAVING COUNT(*) = 1 AND MIN(user_id) = ?
            """,
            (user_id,),
        ).fetchall()
    ]
    conn.execute(
        f"""
        DELETE FROM {schema}.time_blocks
        WHERE user_id = ?
           OR plan_assignment_id IN (
               SELECT id FROM {schema}.user_plan_assignments WHERE user_id = ?
           )
        """,
        (user_id, user_id),
    )
    conn.execute(
        f"DELETE FROM {schema}.task_participants WHERE user_id = ?",
        (user_id,),
    )
    for task_id in exclusive_task_ids:
        conn.execute(
            f"DELETE FROM {schema}.task_event_type_migrations WHERE task_id = ?",
            (task_id,),
        )
        conn.execute(f"DELETE FROM {schema}.tasks WHERE id = ?", (task_id,))
    conn.execute(
        f"""
        DELETE FROM {schema}.task_event_type_migrations
        WHERE event_type_id IN (
            SELECT id FROM {schema}.person_event_types WHERE user_id = ?
        )
        """,
        (user_id,),
    )
    conn.execute(
        f"DELETE FROM {schema}.person_event_types WHERE user_id = ?",
        (user_id,),
    )
    conn.execute(
        f"DELETE FROM {schema}.user_plan_assignments WHERE user_id = ?",
        (user_id,),
    )
    conn.execute(f"DELETE FROM {schema}.users WHERE id = ?", (user_id,))

def init_db(db_file=None):
    conn = get_db_connection(db_file)
    try:
        _init_db_connection(conn)
    finally:
        conn.close()


def _init_db_connection(conn):
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role TEXT CHECK(role IN ('adult', 'child_10', 'child_14', 'patchwork_guest')) NOT NULL,
            current_points INTEGER DEFAULT 0,
            status_school TEXT CHECK(status_school IN ('GREEN', 'RED')) DEFAULT 'GREEN',
            status_sport TEXT CHECK(status_sport IN ('BASE', 'SILBER')) DEFAULT 'BASE',
            color_code TEXT DEFAULT '#228be6',
            state_code TEXT,
            assigned_plan_id INTEGER,
            is_active INTEGER NOT NULL DEFAULT 1
        )
    """)

    cursor.execute("PRAGMA table_info(users)")
    user_columns = {row["name"] for row in cursor.fetchall()}
    if "is_active" not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS rewards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            point_cost INTEGER NOT NULL,
            type TEXT CHECK(type IN ('snack', 'extra_time', 'cash')) NOT NULL
        )
    """)

    # NEU: Die dynamische Kategorie-Tabelle speichert Name, Farbe und Standard-Abkürzung
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            value TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            color TEXT NOT NULL,
            default_short TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            color TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            FOREIGN KEY(category_id) REFERENCES categories(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS task_participants (
            task_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY(task_id, user_id),
            FOREIGN KEY(task_id) REFERENCES tasks(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS task_event_type_migrations (
            event_type_id INTEGER PRIMARY KEY,
            task_id INTEGER NOT NULL
        )
    """)

    # NEU: Das geänderte Tabellenmodell für die Zeitblöcke mit dem Abkürzungsfeld 'short_title'
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS time_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            short_title TEXT, -- Speichert die passgenaue Abkürzung für schmale Blöcke
            day_of_week TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            type TEXT NOT NULL,
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
            weather_latitude REAL,
            weather_longitude REAL,
            live_temp TEXT DEFAULT '--',
            live_rain TEXT DEFAULT '--',
            header_show_users INTEGER NOT NULL DEFAULT 1,
            header_show_view_mode INTEGER NOT NULL DEFAULT 1,
            header_show_weather INTEGER NOT NULL DEFAULT 1,
            api_url_open_meteo TEXT,
            api_url_weather_api TEXT,
            api_url_zippopotam TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS weather_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            weather_city TEXT NOT NULL DEFAULT '',
            weather_plz TEXT NOT NULL DEFAULT '',
            weather_latitude REAL,
            weather_longitude REAL,
            is_active INTEGER NOT NULL DEFAULT 0
        )
    """)
    _migrate_weather_locations(cursor)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            start_day TEXT NOT NULL,
            end_day TEXT NOT NULL,
            hours_count INTEGER NOT NULL,
            hours_json TEXT NOT NULL,
            exclude_school_holidays INTEGER NOT NULL DEFAULT 0,
            exclude_public_holidays INTEGER NOT NULL DEFAULT 0
        )
    """)

    cursor.execute("PRAGMA table_info(plans)")
    plan_columns = {row["name"] for row in cursor.fetchall()}
    if "exclude_school_holidays" not in plan_columns:
        cursor.execute(
            "ALTER TABLE plans ADD COLUMN exclude_school_holidays INTEGER NOT NULL DEFAULT 0"
        )
    if "exclude_public_holidays" not in plan_columns:
        cursor.execute(
            "ALTER TABLE plans ADD COLUMN exclude_public_holidays INTEGER NOT NULL DEFAULT 0"
        )

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS holiday_states (
            state_code TEXT PRIMARY KEY,
            added_at TEXT NOT NULL
        )
    """)

    cursor.execute("PRAGMA table_info(holiday_states)")
    holiday_state_columns = {row["name"] for row in cursor.fetchall()}
    if "api_url" in holiday_state_columns or "api_key" in holiday_state_columns:
        cursor.execute("""
            CREATE TABLE holiday_states_new (
                state_code TEXT PRIMARY KEY,
                added_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            INSERT INTO holiday_states_new (state_code, added_at)
            SELECT state_code, added_at FROM holiday_states
        """)
        cursor.execute("DROP TABLE holiday_states")
        cursor.execute("ALTER TABLE holiday_states_new RENAME TO holiday_states")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS holiday_years (
            state_code TEXT NOT NULL,
            year INTEGER NOT NULL,
            synced_at TEXT NOT NULL,
            PRIMARY KEY (state_code, year)
        )
    """)

    cursor.execute("PRAGMA table_info(holiday_years)")
    holiday_year_columns = {row["name"] for row in cursor.fetchall()}
    if "source_url" in holiday_year_columns:
        cursor.execute("""
            CREATE TABLE holiday_years_new (
                state_code TEXT NOT NULL,
                year INTEGER NOT NULL,
                synced_at TEXT NOT NULL,
                PRIMARY KEY (state_code, year)
            )
        """)
        cursor.execute("""
            INSERT INTO holiday_years_new (state_code, year, synced_at)
            SELECT state_code, year, synced_at FROM holiday_years
        """)
        cursor.execute("DROP TABLE holiday_years")
        cursor.execute("ALTER TABLE holiday_years_new RENAME TO holiday_years")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS holidays (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            state_code TEXT NOT NULL,
            year INTEGER NOT NULL,
            holiday_type TEXT NOT NULL DEFAULT 'school',
            name TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            UNIQUE (state_code, year, holiday_type, name, start_date, end_date)
        )
    """)

    cursor.execute("PRAGMA table_info(holidays)")
    holiday_columns = {row["name"] for row in cursor.fetchall()}
    if "holiday_type" not in holiday_columns:
        cursor.execute(
            "ALTER TABLE holidays ADD COLUMN holiday_type TEXT NOT NULL DEFAULT 'school'"
        )

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS plan_event_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            UNIQUE(name, color)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS person_event_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            UNIQUE(user_id, name, color),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_plan_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            plan_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(plan_id) REFERENCES plans(id)
        )
    """)

    cursor.execute("PRAGMA table_info(users)")
    user_cols = [row["name"] for row in cursor.fetchall()]
    if "state_code" not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN state_code TEXT")
    if "assigned_plan_id" not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN assigned_plan_id INTEGER")
    
    # REPARIERT & ERWEITERT: Migrationsschutz für bestehende Installationen (Fügt Spalten live hinzu)
    cursor.execute("PRAGMA table_info(time_blocks)")
    block_cols = [row["name"] for row in cursor.fetchall()]
    if "short_title" not in block_cols:
        cursor.execute("ALTER TABLE time_blocks ADD COLUMN short_title TEXT")
    if "color" not in block_cols:
        cursor.execute("ALTER TABLE time_blocks ADD COLUMN color TEXT")
    if "plan_assignment_id" not in block_cols:
        cursor.execute("ALTER TABLE time_blocks ADD COLUMN plan_assignment_id INTEGER")
    if "plan_period" not in block_cols:
        cursor.execute("ALTER TABLE time_blocks ADD COLUMN plan_period INTEGER")
    if "is_visible" not in block_cols:
        cursor.execute("ALTER TABLE time_blocks ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1")
    if "plan_event_type_id" not in block_cols:
        cursor.execute("ALTER TABLE time_blocks ADD COLUMN plan_event_type_id INTEGER")
    if "person_event_type_id" not in block_cols:
        cursor.execute("ALTER TABLE time_blocks ADD COLUMN person_event_type_id INTEGER")
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_time_blocks_plan_assignment "
        "ON time_blocks(plan_assignment_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_time_blocks_plan_event_type "
        "ON time_blocks(plan_event_type_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_time_blocks_person_event_type "
        "ON time_blocks(person_event_type_id)"
    )

    weekdays = ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")
    assigned_users = cursor.execute(
        """
        SELECT users.id AS user_id, users.assigned_plan_id, plans.name, plans.start_day,
               plans.end_day, plans.hours_json
        FROM users
        JOIN plans ON plans.id = users.assigned_plan_id
        LEFT JOIN user_plan_assignments ON user_plan_assignments.user_id = users.id
        WHERE user_plan_assignments.id IS NULL
        """
    ).fetchall()
    for assigned_user in assigned_users:
        assignment_cursor = cursor.execute(
            "INSERT INTO user_plan_assignments (user_id, plan_id, title) VALUES (?, ?, ?)",
            (assigned_user["user_id"], assigned_user["assigned_plan_id"], assigned_user["name"]),
        )
        try:
            plan_hours = json.loads(assigned_user["hours_json"])
            first_day = weekdays.index(assigned_user["start_day"])
            last_day = weekdays.index(assigned_user["end_day"])
        except (ValueError, TypeError, json.JSONDecodeError):
            continue
        if (
            not isinstance(plan_hours, list)
            or first_day > last_day
            or any(
                not isinstance(hour, dict)
                or not isinstance(hour.get("start_time"), str)
                or not isinstance(hour.get("end_time"), str)
                for hour in plan_hours
            )
        ):
            continue
        assignment_id = assignment_cursor.lastrowid
        for day in weekdays[first_day:last_day + 1]:
            for period, hour in enumerate(plan_hours, start=1):
                cursor.execute(
                    """
                    UPDATE time_blocks
                    SET plan_assignment_id = ?, plan_period = ?,
                        color = COALESCE(color, '#fd7e14')
                    WHERE user_id = ? AND type = 'school' AND day_of_week = ?
                      AND start_time = ? AND end_time = ? AND plan_assignment_id IS NULL
                    """,
                    (
                        assignment_id,
                        period,
                        assigned_user["user_id"],
                        day,
                        hour.get("start_time"),
                        hour.get("end_time"),
                    ),
                )

    legacy_plan_blocks = cursor.execute(
        """
        SELECT id, title, color
        FROM time_blocks
        WHERE plan_assignment_id IS NOT NULL AND plan_event_type_id IS NULL
        """
    ).fetchall()
    for block in legacy_plan_blocks:
        color = str(block["color"] or "#fd7e14")
        if (
            len(color) != 7
            or color[0] != "#"
            or any(character not in "0123456789abcdefABCDEF" for character in color[1:])
        ):
            color = "#fd7e14"
        cursor.execute(
            "INSERT OR IGNORE INTO plan_event_types (name, color) VALUES (?, ?)",
            (block["title"], color),
        )
        event_type = cursor.execute(
            "SELECT id FROM plan_event_types WHERE name = ? AND color = ?",
            (block["title"], color),
        ).fetchone()
        cursor.execute(
            "UPDATE time_blocks SET plan_event_type_id = ? WHERE id = ?",
            (event_type["id"], block["id"]),
        )

    legacy_plan_blocks = cursor.execute(
        """
        SELECT time_blocks.id, time_blocks.user_id, time_blocks.title, time_blocks.color,
               plan_event_types.name AS event_type_name,
               plan_event_types.color AS event_type_color
        FROM time_blocks
        LEFT JOIN plan_event_types ON plan_event_types.id = time_blocks.plan_event_type_id
        WHERE time_blocks.plan_assignment_id IS NOT NULL
          AND time_blocks.person_event_type_id IS NULL
        """
    ).fetchall()
    for block in legacy_plan_blocks:
        name = block["event_type_name"] or block["title"]
        color = str(block["event_type_color"] or block["color"] or "#fd7e14")
        if (
            len(color) != 7
            or color[0] != "#"
            or any(character not in "0123456789abcdefABCDEF" for character in color[1:])
        ):
            color = "#fd7e14"
        cursor.execute(
            "INSERT OR IGNORE INTO person_event_types (user_id, name, color) VALUES (?, ?, ?)",
            (block["user_id"], name, color),
        )
        event_type = cursor.execute(
            """
            SELECT id FROM person_event_types
            WHERE user_id = ? AND name = ? AND color = ?
            """,
            (block["user_id"], name, color),
        ).fetchone()
        cursor.execute(
            "UPDATE time_blocks SET person_event_type_id = ? WHERE id = ?",
            (event_type["id"], block["id"]),
        )

    cursor.execute("PRAGMA table_info(system_config)")
    cols = [row["name"] for row in cursor.fetchall()]
    if "api_url_open_meteo" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN api_url_open_meteo TEXT")
    if "api_url_weather_api" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN api_url_weather_api TEXT")
    if "api_url_zippopotam" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN api_url_zippopotam TEXT")
    if "weather_latitude" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN weather_latitude REAL")
    if "weather_longitude" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN weather_longitude REAL")
    if "header_show_users" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN header_show_users INTEGER NOT NULL DEFAULT 1")
    if "header_show_view_mode" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN header_show_view_mode INTEGER NOT NULL DEFAULT 1")
    if "header_show_weather" not in cols:
        cursor.execute("ALTER TABLE system_config ADD COLUMN header_show_weather INTEGER NOT NULL DEFAULT 1")
    
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

    # NEU: Befüllt die Kategorien-Tabelle mit deinen originalen Familienfarben, falls sie leer ist
    cat_count = cursor.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    if cat_count == 0:
        default_cats = [
            ('duty', 'Pflicht (Duty)', '#fa5252', 'Duty'),
            ('media', 'Medienzeit', '#be4bdb', 'Media'),
            ('school', 'Schule / Hausaufgaben', '#fd7e14', 'Schule'),
            ('sport', 'Sport / Verein', '#40c057', 'Sport'),
            ('patchwork_garden', 'Garten / Patchwork', '#fab005', 'Garten'),
            ('family', 'Familienzeit', '#15aabf', 'Family')
        ]
        cursor.executemany("INSERT INTO categories (value, label, color, default_short) VALUES (?, ?, ?, ?)", default_cats)
        conn.commit()

    school_category = cursor.execute(
        "SELECT id FROM categories WHERE value = 'school' ORDER BY id LIMIT 1"
    ).fetchone()
    if school_category is None:
        school_category = cursor.execute(
            "SELECT id FROM categories ORDER BY id LIMIT 1"
        ).fetchone()
    if school_category is not None:
        legacy_event_types = cursor.execute(
            """
            SELECT person_event_types.id, person_event_types.user_id,
                   person_event_types.name, person_event_types.color
            FROM person_event_types
            LEFT JOIN task_event_type_migrations
                ON task_event_type_migrations.event_type_id = person_event_types.id
            WHERE task_event_type_migrations.event_type_id IS NULL
            ORDER BY person_event_types.id
            """
        ).fetchall()
        for event_type in legacy_event_types:
            task_cursor = cursor.execute(
                "INSERT INTO tasks (title, color, category_id) VALUES (?, ?, ?)",
                (event_type["name"], event_type["color"], school_category["id"]),
            )
            task_id = task_cursor.lastrowid
            cursor.execute(
                "INSERT INTO task_participants (task_id, user_id) VALUES (?, ?)",
                (task_id, event_type["user_id"]),
            )
            cursor.execute(
                "INSERT INTO task_event_type_migrations (event_type_id, task_id) VALUES (?, ?)",
                (event_type["id"], task_id),
            )
        conn.commit()

    cursor.execute(
        """
        UPDATE person_event_types
        SET name = (
                SELECT tasks.title
                FROM task_event_type_migrations
                JOIN tasks ON tasks.id = task_event_type_migrations.task_id
                WHERE task_event_type_migrations.event_type_id = person_event_types.id
            ),
            color = (
                SELECT tasks.color
                FROM task_event_type_migrations
                JOIN tasks ON tasks.id = task_event_type_migrations.task_id
                WHERE task_event_type_migrations.event_type_id = person_event_types.id
            )
        WHERE id IN (SELECT event_type_id FROM task_event_type_migrations)
          AND EXISTS (
              SELECT 1
              FROM task_event_type_migrations
              JOIN tasks ON tasks.id = task_event_type_migrations.task_id
              WHERE task_event_type_migrations.event_type_id = person_event_types.id
          )
        """
    )
    cursor.execute(
        """
        UPDATE time_blocks
        SET title = (
                SELECT person_event_types.name
                FROM person_event_types
                WHERE person_event_types.id = time_blocks.person_event_type_id
            ),
            short_title = (
                SELECT substr(person_event_types.name, 1, 6)
                FROM person_event_types
                WHERE person_event_types.id = time_blocks.person_event_type_id
            ),
            color = (
                SELECT person_event_types.color
                FROM person_event_types
                WHERE person_event_types.id = time_blocks.person_event_type_id
            )
        WHERE person_event_type_id IN (SELECT event_type_id FROM task_event_type_migrations)
        """
    )
    conn.commit()

    config_count = cursor.execute("SELECT COUNT(*) FROM system_config").fetchone()[0]
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

    location_count = cursor.execute("SELECT COUNT(*) FROM weather_locations").fetchone()[0]
    if location_count == 0:
        legacy_config = cursor.execute(
            """
            SELECT weather_city, weather_plz, weather_service, api_key,
                   weather_latitude, weather_longitude
            FROM system_config ORDER BY id ASC LIMIT 1
            """
        ).fetchone()
        if legacy_config:
            cursor.execute(
                """
                INSERT INTO weather_locations (
                    weather_city, weather_plz, weather_latitude, weather_longitude, is_active
                )
                VALUES (?, ?, ?, ?, 1)
                """,
                (
                    legacy_config["weather_city"] or "",
                    legacy_config["weather_plz"] or "",
                    legacy_config["weather_latitude"],
                    legacy_config["weather_longitude"],
                ),
            )
            conn.commit()

    cursor.execute("DROP TABLE IF EXISTS holiday_settings")
    conn.commit()

    _install_family_data_revision_triggers(cursor)
    conn.commit()

    print("✅ System-Datenbank erfolgreich geprüft!")


def _install_family_data_revision_triggers(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS family_data_revision (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            revision INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    cursor.execute(
        "INSERT OR IGNORE INTO family_data_revision (id, revision) VALUES (1, 0)"
    )

    tables = (
        "users",
        "rewards",
        "categories",
        "tasks",
        "task_participants",
        "task_event_type_migrations",
        "time_blocks",
        "weather_locations",
        "plans",
        "holiday_states",
        "holiday_years",
        "holidays",
        "plan_event_types",
        "person_event_types",
        "user_plan_assignments",
    )
    for table in tables:
        for operation in ("INSERT", "UPDATE", "DELETE"):
            trigger_name = f"trg_family_revision_{table}_{operation.lower()}"
            cursor.execute(
                f"""
                CREATE TRIGGER IF NOT EXISTS {trigger_name}
                AFTER {operation} ON {table}
                BEGIN
                    UPDATE family_data_revision
                    SET revision = revision + 1
                    WHERE id = 1;
                END
                """
            )

    for operation in ("INSERT", "DELETE"):
        trigger_name = f"trg_family_revision_system_config_{operation.lower()}"
        cursor.execute(
            f"""
            CREATE TRIGGER IF NOT EXISTS {trigger_name}
            AFTER {operation} ON system_config
            BEGIN
                UPDATE family_data_revision
                SET revision = revision + 1
                WHERE id = 1;
            END
            """
        )

    cursor.execute(
        """
        CREATE TRIGGER IF NOT EXISTS trg_family_revision_system_config_update
        AFTER UPDATE ON system_config
        WHEN OLD.weather_city IS NOT NEW.weather_city
          OR OLD.weather_plz IS NOT NEW.weather_plz
          OR OLD.weather_service IS NOT NEW.weather_service
          OR OLD.api_key IS NOT NEW.api_key
          OR OLD.weather_latitude IS NOT NEW.weather_latitude
          OR OLD.weather_longitude IS NOT NEW.weather_longitude
          OR OLD.header_show_users IS NOT NEW.header_show_users
          OR OLD.header_show_view_mode IS NOT NEW.header_show_view_mode
          OR OLD.header_show_weather IS NOT NEW.header_show_weather
          OR OLD.api_url_open_meteo IS NOT NEW.api_url_open_meteo
          OR OLD.api_url_weather_api IS NOT NEW.api_url_weather_api
          OR OLD.api_url_zippopotam IS NOT NEW.api_url_zippopotam
        BEGIN
            UPDATE family_data_revision
            SET revision = revision + 1
            WHERE id = 1;
        END
        """
    )


def _migrate_weather_locations(cursor):
    columns = {
        row["name"] for row in cursor.execute("PRAGMA table_info(weather_locations)")
    }
    if not {"name", "weather_service", "api_key"}.intersection(columns):
        return

    cursor.execute("DROP TABLE IF EXISTS weather_locations_new")
    cursor.execute(
        """
        CREATE TABLE weather_locations_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            weather_city TEXT NOT NULL DEFAULT '',
            weather_plz TEXT NOT NULL DEFAULT '',
            weather_latitude REAL,
            weather_longitude REAL,
            is_active INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    cursor.execute(
        """
        INSERT INTO weather_locations_new (
            id, weather_city, weather_plz, weather_latitude, weather_longitude, is_active
        )
        SELECT id, weather_city, weather_plz, weather_latitude, weather_longitude, is_active
        FROM weather_locations
        """
    )
    cursor.execute("DROP TABLE weather_locations")
    cursor.execute("ALTER TABLE weather_locations_new RENAME TO weather_locations")
