class Accumulator {
  value: int

  function add(amount: int): int {
    this.value = this.value + amount
    return this.value
  }
}

interface Drawable {
  value: int
  render(): int
}

class Point implements Drawable {
  readonly value: int
  function render(): int => value * 2
}

class Config {
  name: string
  enabled: bool
  count: int = 10
  notes: string | null = null
}

function actorResult(): int {
  worker := Actor<Accumulator>(1)
  first := worker.add(2)
  promise := async worker.add(4)
  state := retire worker
  second := try! promise.get()
  return first + second + state.value
}

function values(): int[] => [1, 2, 3]

function iterableResult(): int {
  let total = 0
  for value of values() { total = total + value }
  return total
}

function lambdaResult(): int {
  let count = 0
  counter := (): int => {
    count = count + 1
    return count
  }
  counter()
  counter()
  return counter()
}

function jsonResult(): int {
  config := Config.fromJsonValue({ name: "Ada", enabled: true }) else { return 90 }
  _ := Config.fromJsonValue({ name: 4, enabled: true }) else error {
    if error.contains("Field \"name\" expected string") { return config.count }
    return 91
  }
  return 92
}

function interfaceResult(): int {
  point := Point { value: 6 }
  shape: Drawable := point
  return shape.render() + shape.value
}

function main(): int {
  if actorResult() != 17 { return 1 }
  if iterableResult() != 6 { return 2 }
  if lambdaResult() != 3 { return 3 }
  if jsonResult() != 10 { return 4 }
  if interfaceResult() != 18 { return 5 }
  return 0
}
