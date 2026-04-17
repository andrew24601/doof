import {
  Database,
  SqliteError,
  SqliteValue,
  Statement,
  execute,
  executeInfo,
  open,
  prepare,
  queryAll,
  run,
  toJsonRow,
} from "./sqlite"

class Todo {
  id: int
  title: string
  done: bool
}

class SampleOutput {
  databasePath: string
  removed: int
  todos: Todo[]
}

function insertTodo(statement: Statement, title: string, done: bool): Result<void, SqliteError> {
  return run(statement, [title, done])
}

function readTodo(row: Map<string, SqliteValue>): Result<Todo, SqliteError> {
  return case Todo.fromJsonValue(toJsonRow(row), true) {
    s: Success => Success {
      value: s.value
    },
    f: Failure => Failure {
      error: SqliteError {
        stage: "read",
        code: 0,
        message: f.error,
        sql: null,
      }
    }
  }
}

function fetchTodos(database: Database): Result<Todo[], SqliteError> {
  try rows := queryAll(database, "SELECT id, title, done FROM todos ORDER BY id")
  todos: Todo[] := []

  for row of rows {
    try todo := readTodo(row)
    todos.push(todo)
  }

  return Success {
    value: todos
  }
}

function runSample(databasePath: string): Result<SampleOutput, SqliteError> {
  try database := open(databasePath)

  try execute(database, `CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER NOT NULL
  )`)
  try cleared := executeInfo(database, "DELETE FROM todos")

  try insertStatement := prepare(database, "INSERT INTO todos(title, done) VALUES (?, ?)")
  try insertTodo(insertStatement, "Design a clean Doof API", true)
  try insertTodo(insertStatement, "Bind parameters explicitly", true)
  try insertTodo(insertStatement, "Map rows into Todo values", false)
  try todos := fetchTodos(database)

  return Success {
    value: SampleOutput {
      databasePath,
      removed: cleared.changes,
      todos,
    }
  }
}

function formatOutput(output: SampleOutput): string {
  let text = "SQLite sample database: ${output.databasePath}\n"
  text += "Removed rows before seeding: ${output.removed}\n"
  text += "Loaded todos: ${output.todos.length}\n"
  text += "\n"

  for todo of output.todos {
    marker := if todo.done then "x" else " "
    text += "- [${marker}] #${todo.id}: ${todo.title}\n"
  }

  return text
}

function formatError(error: SqliteError): string {
  let text = "SQLite ${error.stage} failed (code ${error.code}): ${error.message}"
  sqlText := error.sql ?? ""
  if sqlText != "" {
    text += "\nSQL: ${sqlText}"
  }
  return text
}

function main(): int {
  result := runSample(":memory:")

  println(case result {
    s: Success => formatOutput(s.value),
    f: Failure => formatError(f.error)
  })

  return case result {
    s: Success => 0,
    f: Failure => 1
  }
}