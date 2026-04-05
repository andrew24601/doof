// Multi-module example — main entry point
// Demonstrates importing functions and classes from other modules
import { add, multiply } from "./mathlib"
import { greet } from "./greeter"

function main(): int {
  greet("Doof")

  println(`2 + 3 = ${add(2, 3)}`)
  println(`4 * 5 = ${multiply(4, 5)}`)

  return 0
}
