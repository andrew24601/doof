// Smallest current self-hosted emitter bottleneck:
// converting a non-null variant into a nullable variant field and binding.

class Left {
  value: int
}

class Right {
  value: int
}

type Value = Left | Right

class Holder {
  value: Value | null
}

function makeValue(): Value => Left { value: 1 }

function makeHolder(): Holder {
  let value: Value | null = null
  value = makeValue()
  return Holder { value }
}

function main(): int => 0
