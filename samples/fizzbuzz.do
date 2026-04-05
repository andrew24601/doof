// FizzBuzz — a classic programming exercise demonstrating control flow
function fizzbuzz(n: int): string {
  if n % 15 == 0 {
    return "FizzBuzz"
  } else if n % 3 == 0 {
    return "Fizz"
  } else if n % 5 == 0 {
    return "Buzz"
  }
  return `${n}`
}

function main(): int {
  for i of 1..30 {
    println(fizzbuzz(i))
  }
  return 0
}
