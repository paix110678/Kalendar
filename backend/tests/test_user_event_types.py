import database
from routers.users import get_person_event_types


def test_person_event_types_include_their_task_category(tmp_path):
    database_path = tmp_path / "calendar.sqlite3"
    database.init_db(str(database_path))

    conn = database.get_db_connection(database_path)
    try:
        user_id = conn.execute(
            "INSERT INTO users (name, role) VALUES ('Alex', 'child_10')"
        ).lastrowid
        category_id = conn.execute(
            """
            INSERT INTO categories (value, label, color, default_short)
            VALUES ('test_task_category', 'Schule', '#228be6', 'SCH')
            """
        ).lastrowid
        task_id = conn.execute(
            "INSERT INTO tasks (title, color, category_id) VALUES ('Mathematik', '#228be6', ?)",
            (category_id,),
        ).lastrowid
        task_event_type_id = conn.execute(
            """
            INSERT INTO person_event_types (user_id, name, color)
            VALUES (?, 'Mathematik', '#228be6')
            """,
            (user_id,),
        ).lastrowid
        conn.execute(
            "INSERT INTO task_event_type_migrations (event_type_id, task_id) VALUES (?, ?)",
            (task_event_type_id, task_id),
        )
        standalone_event_type_id = conn.execute(
            """
            INSERT INTO person_event_types (user_id, name, color)
            VALUES (?, 'Klavier', '#40c057')
            """,
            (user_id,),
        ).lastrowid
        conn.commit()
    finally:
        conn.close()

    with database.use_database_file(database_path):
        event_types = get_person_event_types(user_id)

    assert event_types == [
        {
            "id": task_event_type_id,
            "user_id": user_id,
            "name": "Mathematik",
            "color": "#228be6",
            "category_id": category_id,
        },
        {
            "id": standalone_event_type_id,
            "user_id": user_id,
            "name": "Klavier",
            "color": "#40c057",
            "category_id": None,
        },
    ]
