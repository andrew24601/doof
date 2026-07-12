// Next emitter boundary after nullable variant assignment:
// constructing a nullable AST-style field from a value that is already nullable.

class Left {
  value: int
}

class Right {
  value: int
}

type Expression = Left | Right

class ReturnStatement {
  value: Expression | null
}

function makeReturn(): ReturnStatement {
  let value: Expression | null = null
  return ReturnStatement { value }
}

function main(): int => 0
