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

class Calculator "A calculator." {
  function add "Adds two values."(left "Left value.": int, right "Right value.": int): int => left + right
}

struct Multiplier "A multiplier." {
  factor: int
  function apply(value: int): int => value * factor
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

function metadataResult(): int {
  metadata := Calculator.metadata
  if metadata.name != "Calculator" || metadata.description != "A calculator." { return 90 }
  calculator := Calculator {}
  firstJson := metadata.invoke(calculator, "add", { left: 2, right: 3 }) else { return 91 }
  first := firstJson as int else { return 92 }
  secondJson := metadata.methods[0].invoke(calculator, { left: 1, right: 4 }) else { return 93 }
  second := secondJson as int else { return 94 }
  multiplier := Multiplier { factor: 3 }
  multipliedJson := Multiplier.metadata.invoke(multiplier, "apply", { value: 2 }) else { return 95 }
  multiplied := multipliedJson as int else { return 96 }
  return first + second + multiplied
}

function interfaceResult(): int {
  point := Point { value: 6 }
  shape: Drawable := point
  return shape.render() + shape.value
}

function setResult(): int {
  let values: Set<int> = [3, 1, 3, 2]
  values.delete(1)
  frozen := values.buildReadonly()
  if values.size != 0 || frozen.size != 2 || !frozen.has(3) { return 90 }
  copy := frozen.cloneMutable()
  copy.add(4)
  let total = 0
  for value of copy { total = total + value }
  return total
}

enum LoadError { Missing }

function loadValue(ok: bool): Result<int, LoadError> {
  if ok { return Success { value: 4 } }
  return Failure { error: .Missing }
}

function yieldCatchResult(): int {
  let value <- {
    if true { yield 3 }
    yield 0
  }
  value <- { yield value + 1 }
  success := catch {
    try loaded := loadValue(true)
    value = value + loaded
  }
  failure := catch {
    try loadValue(false)
    value = 99
  }
  return case success {
    _: LoadError -> 90,
    _ -> case failure { _: LoadError -> value, _ -> 91 }
  }
}

function main(): int {
  if actorResult() != 17 { return 1 }
  if iterableResult() != 6 { return 2 }
  if lambdaResult() != 3 { return 3 }
  if jsonResult() != 10 { return 4 }
  if interfaceResult() != 18 { return 5 }
  if setResult() != 9 { return 6 }
  if yieldCatchResult() != 8 { return 7 }
  if metadataResult() != 16 { return 8 }
  return 0
}
