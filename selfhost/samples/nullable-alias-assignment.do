// Nullable alias assignment slice for the parser's Expression/Statement locals.

class ExpressionLeft {
  value: int
}

class ExpressionRight {
  value: int
}

type Expression = ExpressionLeft | ExpressionRight

class StatementLeft {
  value: int
}

class StatementRight {
  value: int
}

type Statement = StatementLeft | StatementRight

class Holder {
  expression: Expression | null
  statement: Statement | null
}

function makeExpression(): Expression => ExpressionLeft { value: 1 }
function makeStatement(): Statement => StatementLeft { value: 2 }

function makeHolder(): Holder {
  let expression: Expression | null = null
  expression = makeExpression()
  let statement: Statement | null = null
  statement = makeStatement()
  return Holder { expression, statement }
}

function main(): int => 0
