import database
from routers import blocks
from routers.blocks import DatabaseRowDelete, DatabaseRowUpdate


def test_database_inspector_updates_and_deletes_a_single_row(tmp_path):
    database_path = tmp_path / "database-inspector.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        conn = database.get_db_connection()
        try:
            row_id = conn.execute(
                """
                INSERT INTO categories (value, label, color, default_short)
                VALUES ('inspector-test', 'Vorher', '#000000', 'V')
                """
            ).lastrowid
            other_row_id = conn.execute(
                """
                INSERT INTO categories (value, label, color, default_short)
                VALUES ('inspector-other', 'Unverändert', '#ffffff', 'U')
                """
            ).lastrowid
            conn.commit()
        finally:
            conn.close()

        table_data = blocks.get_db_table_data("categories")
        assert table_data["primary_key"] == ["id"]
        blocks.update_db_table_row(
            "categories",
            DatabaseRowUpdate(
                row_key={"id": row_id},
                values={"label": "Geändert"},
            ),
        )
        blocks.delete_db_table_row(
            "categories",
            DatabaseRowDelete(row_key={"id": row_id}),
        )

        conn = database.get_db_connection()
        try:
            remaining = conn.execute(
                "SELECT id, label FROM categories WHERE id = ?",
                (other_row_id,),
            ).fetchone()
            deleted = conn.execute(
                "SELECT id FROM categories WHERE id = ?",
                (row_id,),
            ).fetchone()
        finally:
            conn.close()

    assert remaining["label"] == "Unverändert"
    assert deleted is None


def test_database_inspector_uses_rowid_for_tables_without_primary_key(tmp_path):
    database_path = tmp_path / "database-inspector-rowid.sqlite3"
    database.init_db(database_path)

    with database.use_database_file(database_path):
        conn = database.get_db_connection()
        try:
            conn.execute("CREATE TABLE inspector_rows (value TEXT NOT NULL)")
            conn.execute("INSERT INTO inspector_rows (value) VALUES ('Vorher')")
            conn.commit()
        finally:
            conn.close()

        table_data = blocks.get_db_table_data("inspector_rows")
        row = table_data["rows"][0]
        rowid_column = table_data["rowid_column"]
        assert rowid_column is not None
        blocks.update_db_table_row(
            "inspector_rows",
            DatabaseRowUpdate(
                row_key={rowid_column: row[rowid_column]},
                values={"value": "Geändert"},
            ),
        )
        updated = blocks.get_db_table_data("inspector_rows")

    assert updated["rows"][0]["value"] == "Geändert"
