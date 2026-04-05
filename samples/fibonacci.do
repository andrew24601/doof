// Fibonacci — compute the Nth Fibonacci number iteratively
function fibonacci(n: int): int {
  if n <= 1 {
    return n
  }
  let a = 0
  let b = 1
  let i = 2
  while i <= n {
    let temp = a + b
    a = b
    b = temp
    i = i + 1
  }
  return b
}

function main(): int {
  for i of 0..15 {
    println(`fib(${i}) = ${fibonacci(i)}`)
  }
  return 0
}
