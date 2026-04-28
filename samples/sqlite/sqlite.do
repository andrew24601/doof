// Thin SQLite wrapper for Doof programs.

export type SqliteParam = int | long | bool | double | string | null
export type SqliteValue = long | double | string | null

export import class NativeSqliteDatabase from "./native_sqlite.hpp" {
  static open(path: string): Result<NativeSqliteDatabase, string>
  exec(sql: string): Result<NativeExecResult, string>
  prepare(sql: string): Result<NativeSqliteStatement, string>
  close(): Result<void, string>
  changes(): int
  lastInsertRowId(): long
}

export import class NativeExecResult from "./native_sqlite.hpp" {
  changes(): int
  lastInsertRowId(): long
}

export import class NativeSqliteStatement from "./native_sqlite.hpp" {
  bindText(index: int, value: string): Result<void, string>
  bindInt(index: int, value: int): Result<void, string>
  bindLong(index: int, value: long): Result<void, string>
  bindDouble(index: int, value: double): Result<void, string>
  bindNull(index: int): Result<void, string>
  step(): Result<bool, string>
  readCurrentRow(): Result<Map<string, SqliteValue>, string>
  reset(): Result<void, string>
  finalize(): Result<void, string>
}

export class SqliteError {
  stage: string
  code: int
  message: string
  sql: string | null
}

export class ExecResult {
  changes: int
  lastInsertRowId: long
}

export class Database {
  native: NativeSqliteDatabase
  path: string
}

export class Statement {
  native: NativeSqliteStatement
  sql: string
}

export function open(path: string): Result<Database, SqliteError> {
  return case NativeSqliteDatabase.open(path) {
    s: Success -> Success {
      value: Database {
        native: s.value,
        path,
      }
    },
    f: Failure -> Failure {
      error: decodeError("open", f.error, null)
    }
  }
}

export function close(database: Database): Result<void, SqliteError> {
  return case database.native.close() {
    s: Success -> Success(),
    f: Failure -> Failure {
      error: decodeError("close", f.error, null)
    }
  }
}

function decodeError(stage: string, raw: string, sql: string | null): SqliteError {
  separator := raw.indexOf("|")
  if separator < 0 {
    return SqliteError {
      stage,
      code: 0,
      message: raw,
      sql,
    }
  }

  codeText := raw.substring(0, separator)
  message := raw.slice(separator + 1)
  code := try? int.parse(codeText) ?? 0
  return SqliteError {
    stage,
    code,
    message,
    sql,
  }
}

function missingColumnError(name: string): SqliteError {
  return SqliteError {
    stage: "read",
    code: 0,
    message: "Unknown column ${name}",
    sql: null,
  }
}

function nullColumnError(name: string): SqliteError {
  return SqliteError {
    stage: "read",
    code: 0,
    message: "Column ${name} is NULL",
    sql: null,
  }
}

function valueTypeName(value: SqliteValue): string {
  return case value {
    _: long -> "long",
    _: double -> "double",
    _: string -> "string",
    _ -> "null"
  }
}

function typeMismatchError(name: string, expected: string, value: SqliteValue): SqliteError {
  return SqliteError {
    stage: "read",
    code: 0,
    message: "Column ${name} is ${valueTypeName(value)}, expected ${expected}",
    sql: null,
  }
}

function unexpectedRowError(sql: string): SqliteError {
  return SqliteError {
    stage: "step",
    code: 0,
    message: "Statement unexpectedly produced a row",
    sql,
  }
}

function toExecResult(result: NativeExecResult): ExecResult {
  return ExecResult {
    changes: result.changes(),
    lastInsertRowId: result.lastInsertRowId(),
  }
}

function emptyRow(): Map<string, SqliteValue> | null {
  return null
}

function readCurrentRow(statement: Statement): Result<Map<string, SqliteValue>, SqliteError> {
  return case statement.native.readCurrentRow() {
    s: Success -> Success {
      value: s.value
    },
    f: Failure -> Failure {
      error: decodeError("read", f.error, statement.sql)
    }
  }
}

export function executeInfo(database: Database, sql: string, values: SqliteParam[] = []): Result<ExecResult, SqliteError> {
  if values.length == 0 {
    return case database.native.exec(sql) {
      s: Success -> Success {
        value: toExecResult(s.value)
      },
      f: Failure -> Failure {
        error: decodeError("execute", f.error, sql)
      }
    }
  }

  try statement := prepare(database, sql)
  try row := stepWith(statement, values)
  if row != null {
    return Failure {
      error: unexpectedRowError(statement.sql)
    }
  }

  return Success {
    value: ExecResult {
      changes: database.native.changes(),
      lastInsertRowId: database.native.lastInsertRowId(),
    }
  }
}

export function execute(database: Database, sql: string, values: SqliteParam[] = []): Result<void, SqliteError> {
  return case executeInfo(database, sql, values) {
    s: Success -> Success(),
    f: Failure -> Failure {
      error: f.error
    }
  }
}

export function prepare(database: Database, sql: string): Result<Statement, SqliteError> {
  return case database.native.prepare(sql) {
    s: Success -> Success {
      value: Statement {
        native: s.value,
        sql,
      }
    },
    f: Failure -> Failure {
      error: decodeError("prepare", f.error, sql)
    }
  }
}

export function bindText(statement: Statement, index: int, value: string): Result<void, SqliteError> {
  return case statement.native.bindText(index, value) {
    s: Success -> Success(),
    f: Failure -> Failure {
      error: decodeError("bind", f.error, statement.sql)
    }
  }
}

export function bindInt(statement: Statement, index: int, value: int): Result<void, SqliteError> {
  return case statement.native.bindInt(index, value) {
    s: Success -> Success(),
    f: Failure -> Failure {
      error: decodeError("bind", f.error, statement.sql)
    }
  }
}

export function bindLong(statement: Statement, index: int, value: long): Result<void, SqliteError> {
  return case statement.native.bindLong(index, value) {
    s: Success -> Success(),
    f: Failure -> Failure {
      error: decodeError("bind", f.error, statement.sql)
    }
  }
}

export function bindDouble(statement: Statement, index: int, value: double): Result<void, SqliteError> {
  return case statement.native.bindDouble(index, value) {
    s: Success -> Success(),
    f: Failure -> Failure {
      error: decodeError("bind", f.error, statement.sql)
    }
  }
}

export function bindNull(statement: Statement, index: int): Result<void, SqliteError> {
  return case statement.native.bindNull(index) {
    s: Success -> Success(),
    f: Failure -> Failure {
      error: decodeError("bind", f.error, statement.sql)
    }
  }
}

export function bindValue(statement: Statement, index: int, value: SqliteParam): Result<void, SqliteError> {
  return case value {
    text: string -> bindText(statement, index, text),
    flag: bool -> bindInt(statement, index, if flag then 1 else 0),
    number: int -> bindInt(statement, index, number),
    whole: long -> bindLong(statement, index, whole),
    decimal: double -> bindDouble(statement, index, decimal),
    _ -> bindNull(statement, index)
  }
}

export function bindValues(statement: Statement, values: SqliteParam[] = []): Result<void, SqliteError> {
  for index of 0..<values.length {
    try bindValue(statement, index + 1, values[index])
  }

  return Success()
}

export function run(statement: Statement, values: SqliteParam[] = []): Result<void, SqliteError> {
  try row := stepWith(statement, values)
  if row != null {
    try reset(statement)
    return Failure {
      error: unexpectedRowError(statement.sql)
    }
  }

  return reset(statement)
}

export function stepWith(statement: Statement, values: SqliteParam[] = []): Result<Map<string, SqliteValue> | null, SqliteError> {
  try bindValues(statement, values)
  return step(statement)
}

export function reset(statement: Statement): Result<void, SqliteError> {
  return case statement.native.reset() {
    s: Success -> Success(),
    f: Failure -> Failure {
      error: decodeError("reset", f.error, statement.sql)
    }
  }
}

export function finalize(statement: Statement): Result<void, SqliteError> {
  return case statement.native.finalize() {
    s: Success -> Success(),
    f: Failure -> Failure {
      error: decodeError("finalize", f.error, statement.sql)
    }
  }
}

export function step(statement: Statement): Result<Map<string, SqliteValue> | null, SqliteError> {
  return case statement.native.step() {
    s: Success -> if s.value then readCurrentRow(statement) else Success {
      value: emptyRow()
    },
    f: Failure -> Failure {
      error: decodeError("step", f.error, statement.sql)
    }
  }
}

export function queryAll(database: Database, sql: string, values: SqliteParam[] = []): Result<Map<string, SqliteValue>[], SqliteError> {
  try statement := prepare(database, sql)
  try bindValues(statement, values)

  rows: Map<string, SqliteValue>[] := []
  while true {
    try row := step(statement)
    if row == null {
      return Success {
        value: rows
      }
    }

    rows.push(row!)
  }
}

export function queryOne(database: Database, sql: string, values: SqliteParam[] = []): Result<Map<string, SqliteValue> | null, SqliteError> {
  try rows := queryAll(database, sql, values)
  if rows.length == 0 {
    return Success {
      value: emptyRow()
    }
  }

  return Success {
    value: rows[0]
  }
}

export function toJsonRow(row: Map<string, SqliteValue>): Map<string, JsonValue> {
  jsonRow: Map<string, JsonValue> := {}
  for key, value of row {
    jsonRow[key] = value
  }
  return jsonRow
}

export function columnCount(row: Map<string, SqliteValue>): int {
  return row.size
}

export function hasColumn(row: Map<string, SqliteValue>, name: string): bool {
  return row.has(name)
}

export function readText(row: Map<string, SqliteValue>, name: string): Result<string, SqliteError> {
  try value := readValue(row, name)
  return case value {
    text: string -> Success {
      value: text
    },
    _ -> Failure {
      error: typeMismatchError(name, "string", value)
    }
  }
}

export function readLong(row: Map<string, SqliteValue>, name: string): Result<long, SqliteError> {
  try value := readValue(row, name)
  return case value {
    number: long -> Success {
      value: number
    },
    _ -> Failure {
      error: typeMismatchError(name, "long", value)
    }
  }
}

export function readInt(row: Map<string, SqliteValue>, name: string): Result<int, SqliteError> {
  try value := readLong(row, name)
  return Success {
    value: int(value)
  }
}

export function readDouble(row: Map<string, SqliteValue>, name: string): Result<double, SqliteError> {
  try value := readValue(row, name)
  return case value {
    decimal: double -> Success {
      value: decimal
    },
    whole: long -> Success {
      value: double(whole)
    },
    _ -> Failure {
      error: typeMismatchError(name, "double", value)
    }
  }
}

export function readBool(row: Map<string, SqliteValue>, name: string): Result<bool, SqliteError> {
  try value := readLong(row, name)
  return Success {
    value: value != 0L
  }
}

function readValue(row: Map<string, SqliteValue>, name: string): Result<SqliteValue, SqliteError> {
  if !row.has(name) {
    return Failure {
      error: missingColumnError(name)
    }
  }

  return Success {
    value: row[name]
  }
}

export function begin(database: Database): Result<void, SqliteError> {
  return execute(database, "BEGIN TRANSACTION")
}

export function commit(database: Database): Result<void, SqliteError> {
  return execute(database, "COMMIT")
}

export function rollback(database: Database): Result<void, SqliteError> {
  return execute(database, "ROLLBACK")
}