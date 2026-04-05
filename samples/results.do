// Result type — demonstrating error handling with Success and Failure

// A function that can fail: returns Failure on invalid input
function parseInt(s: string): Result<int, string> {
  if s == "42" {
    return Success { value: 42 }
  }
  if s == "0" {
    return Success { value: 0 }
  }
  return Failure { error: "not a number: " + s }
}

// Safe division — returns Failure on divide-by-zero
function safeDivide(a: int, b: int): Result<int, string> {
  if b == 0 {
    return Failure { error: "division by zero" }
  }
  return Success { value: a \ b }
}

// Use `try` for sequential error propagation (early return on failure)
function compute(input: string): Result<int, string> {
  try n := parseInt(input)
  try result := safeDivide(100, n)
  return Success { value: result }
}

function main(): int {
  // try! — unwrap or panic (for when failure is unrecoverable)
  const a = try! parseInt("42")
  println(a)

  // try? — convert Result to nullable (when you don't care about the error)
  const b = try? parseInt("bad")
  println("parse 'bad' returned null")

  // try propagation — errors flow through cleanly
  const c = try! compute("42")
  println(c)

  // Auto-wrapped return values also work
  const d = try! safeDivide(10, 2)
  println(d)

  return 0
}
