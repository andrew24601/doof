// Pattern matching — demonstrates case expressions with various patterns
function classify(score: int): string {
  return case score {
    90..100 => "A",
    80..<90 => "B",
    70..<80 => "C",
    60..<70 => "D",
    _ => "F"
  }
}

function collatz(n: int): int {
  if n % 2 == 0 {
    return n \ 2
  }
  return 3 * n + 1
}

function main(): int {
  // Grade classification
  scores := [95, 87, 73, 61, 45]
  for s of scores {
    println(`Score ${s} => Grade ${classify(s)}`)
  }

  println("")

  // Collatz sequence from 27
  let x = 27
  let steps = 0
  while x != 1 {
    x = collatz(x)
    steps = steps + 1
  }
  println(`Collatz(27) reached 1 in ${steps} steps`)

  return 0
}
