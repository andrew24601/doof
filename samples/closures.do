// Closures — demonstrates lambdas and closures with captured variables
function apply(f: (x: int): int, x: int): int => f(x)

function makeAdder(n: int): (x: int): int {
  return (x: int): int => x + n
}

function main(): int {
  // Lambda basics
  double := (x: int): int => x * 2
  println(`double(5) = ${apply(double, 5)}`)

  // Closures capturing immutable bindings
  add10 := makeAdder(10)
  add20 := makeAdder(20)
  println(`add10(5) = ${add10(5)}`)
  println(`add20(5) = ${add20(5)}`)

  // Mutable closure — counter
  let count = 0
  increment := (): void { count = count + 1 }

  increment()
  increment()
  increment()
  println(`count = ${count}`)

  return 0
}
