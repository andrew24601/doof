// Recursive AST-style union construction:
// a variant node contains children of the same union type.

class Leaf {
  value: int
}

class Branch {
  left: Expression
  right: Expression
}

type Expression = Leaf | Branch

function makeTree(): Expression {
  return Branch {
    left: Leaf { value: 1 },
    right: Branch {
      left: Leaf { value: 2 },
      right: Leaf { value: 3 }
    }
  }
}

function main(): int => 0
