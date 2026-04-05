// Concurrency — demonstrates isolated functions, async workers, and actors

// ── Isolated functions ──────────────────────────────────────────────────
// An isolated function promises not to access mutable global state,
// making it safe to run on worker threads.

isolated function square(x: int): int {
  return x * x
}

isolated function fib(n: int): int {
  if n <= 1 { return n }
  let a = 0
  let b = 1
  let i = 2
  while i <= n {
    let t = a + b
    a = b
    b = t
    i = i + 1
  }
  return b
}

// ── Actor class ─────────────────────────────────────────────────────────
// A plain class that can be wrapped in Actor<T> for safe concurrency.
// The actor processes method calls sequentially on its own thread.

class Accumulator {
  total: int

  add(n: int): void {
    this.total = this.total + n
  }

  getTotal(): int {
    return this.total
  }
}

// ── Main ────────────────────────────────────────────────────────────────

function main(): int {
  // --- 1. async workers: parallel computation via isolated functions ---
  println("=== Async Workers ===")

  const p1 = async square(6)
  const p2 = async square(7)
  const p3 = async fib(10)

  // Collect results — try! panics on failure
  const r1 = try! p1.get()
  const r2 = try! p2.get()
  const r3 = try! p3.get()

  println(`square(6)  = ${r1}`)
  println(`square(7)  = ${r2}`)
  println(`fib(10)    = ${r3}`)

  // --- 2. Actor: stateful concurrency with sequential processing ---
  println("")
  println("=== Actor ===")

  const acc = Actor<Accumulator>(0)

  // Synchronous calls — each blocks until the actor processes the message
  acc.add(r1)
  acc.add(r2)
  acc.add(r3)

  const total = acc.getTotal()
  println(`accumulator total = ${total}`)

  acc.stop()

  // --- 3. mixed: async dispatch on actor methods ---
  println("")
  println("=== Async Actor Dispatch ===")

  const acc2 = Actor<Accumulator>(0)

  // Fire-and-forget async calls — returns a Promise<void>
  const pa = async acc2.add(100)
  const pb = async acc2.add(200)

  // Wait for both to complete
  try! pa.get()
  try! pb.get()

  const total2 = acc2.getTotal()
  println(`async accumulator total = ${total2}`)

  acc2.stop()

  return 0
}
