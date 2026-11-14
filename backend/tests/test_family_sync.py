import database
from routers import sync


def test_family_revision_tracks_shared_data_but_not_live_weather(tmp_path):
    database_path = tmp_path / "family.sqlite3"
    database.init_db(str(database_path))

    conn = database.get_db_connection(database_path)
    try:
        starting_revision = conn.execute(
            "SELECT revision FROM family_data_revision WHERE id = 1"
        ).fetchone()["revision"]

        conn.execute(
            "INSERT INTO users (name, role) VALUES ('Alex', 'adult')"
        )
        conn.commit()
        member_revision = conn.execute(
            "SELECT revision FROM family_data_revision WHERE id = 1"
        ).fetchone()["revision"]
        assert member_revision == starting_revision + 1

        conn.execute(
            "UPDATE system_config SET live_temp = '18' WHERE id = 1"
        )
        conn.commit()
        weather_revision = conn.execute(
            "SELECT revision FROM family_data_revision WHERE id = 1"
        ).fetchone()["revision"]
        assert weather_revision == member_revision

        conn.execute(
            "UPDATE system_config SET header_show_users = 0 WHERE id = 1"
        )
        conn.commit()
        settings_revision = conn.execute(
            "SELECT revision FROM family_data_revision WHERE id = 1"
        ).fetchone()["revision"]
        assert settings_revision == member_revision + 1
    finally:
        conn.close()

    with database.use_database_file(database_path):
        assert sync.get_family_data_revision() == {"revision": settings_revision}
