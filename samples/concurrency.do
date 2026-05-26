// Concurrency — demonstrates actor-owned mutable domains.

class Computation {
  input: int

  square(): int {
    return this.input * this.input
  }

  fib(): int {
    if this.input <= 1 { return this.input }
    let a = 0
    let b = 1
    let i = 2
    while i <= this.input {
      const t = a + b
      a = b
      b = t
      i = i + 1
    }
    return b
  }
}

class Accumulator {
  total: int

  add(n: int): void {
    this.total = this.total + n
  }

  getTotal(): int {
    return this.total
  }
}

function main(): int {
  println("=== Async Actor Calls ===")

  const square6 = Actor<Computation>(6)
  const square7 = Actor<Computation>(7)
  const fib10 = Actor<Computation>(10)

  const p1 = async square6.square()
  const p2 = async square7.square()
  const p3 = async fib10.fib()

  const r1 = try! p1.get()
  const r2 = try! p2.get()
  const r3 = try! p3.get()

  retire square6
  retire square7
  retire fib10

  println(`square(6)  = ${r1}`)
  println(`square(7)  = ${r2}`)
  println(`fib(10)    = ${r3}`)

  println("")
  println("=== Actor State ===")

  const acc = Actor<Accumulator>(0)

  acc.add(r1)
  acc.add(r2)
  acc.add(r3)

  const total = acc.getTotal()
  println(`accumulator total = ${total}`)

  const finalState = retire acc
  println(`retired total = ${finalState.total}`)

  return 0
}
