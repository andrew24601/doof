# SQLite Sample

This sample keeps the SQLite bridge intentionally small and lets the Doof-facing API do the readability work. The reusable `sqlite.do` module exposes a thin wrapper around database handles, prepared statements, high-level execution helpers, and materialized row maps. `main.do` then shows how to map rows into ordinary Doof classes without introducing a heavier ORM layer.

Files:

- `main.do` creates an in-memory database, seeds a few rows with a prepared statement, and maps query row maps into `Todo` values.
- `sqlite.do` defines the Doof-facing `Database`, `Statement`, `ExecResult`, and `SqliteError` types together with helper functions such as `open`, `execute`, `executeInfo`, `run`, `queryAll`, and row readers like `readText` and `readInt`.
- `native_sqlite.hpp` is a compact header-only bridge around `sqlite3`.

## Build

From the repository root:

```bash
samples/sqlite/build.sh
```

Or build and run immediately:

```bash
samples/sqlite/build.sh --run
```

The build script prefers `pkg-config sqlite3` when available and otherwise falls back to `-lsqlite3`. It also looks for `nlohmann/json.hpp` in common Homebrew and system include paths because the generated Doof runtime uses it.

## Interface

The sample surface now leans on higher-level helpers:

- `open(path)` returns `Result<Database, SqliteError>`.
- `execute(database, sql, values?)` runs DDL or other non-row statements and returns `Result<void, SqliteError>`.
- `executeInfo(database, sql, values?)` does the same work when the caller needs `changes` or `lastInsertRowId`.
- `prepare(database, sql)` creates a reusable `Statement`, and `run(statement, values?)` executes it safely for non-row statements.
- `queryAll(database, sql, values?)` returns `Map<string, long | double | string | null>[]`.
- `step(statement)` is still available for low-level iteration, but it now materializes each row as a map instead of exposing a borrowed cursor view.
- `readText`, `readInt`, `readLong`, `readDouble`, and `readBool` read typed values from a materialized row map.

The sample intentionally excludes blobs, async access, migrations, and schema reflection.