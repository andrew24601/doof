// Lambda AST construction: the body accepts either an expression or a block.

import {
  AstLocation, Block, Expression, IntLiteral, LambdaExpression, SourceSpan,
} from "../ast"

function span(): SourceSpan {
  location := AstLocation { line: 1, column: 1, offset: 0 }
  return SourceSpan { start: location, end: location }
}

function makeConcreteExpressionBody(): Expression {
  return LambdaExpression {
    kind: "lambda-expression",
    params: [],
    returnType: null,
    body: IntLiteral { kind: "int-literal", value: 1, span: span() },
    parameterless: true,
    trailing: false,
    span: span(),
  }
}

function makeBlockBody(): Expression {
  return LambdaExpression {
    kind: "lambda-expression",
    params: [],
    returnType: null,
    body: Block { kind: "block", statements: [], span: span() },
    parameterless: true,
    trailing: false,
    span: span(),
  }
}

function makeShorthandExpressionBody(): Expression {
  body: Expression := IntLiteral { kind: "int-literal", value: 1, span: span() }
  return LambdaExpression {
    kind: "lambda-expression",
    params: [],
    returnType: null,
    body,
    parameterless: true,
    trailing: false,
    span: span(),
  }
}

function makeShorthandBlockBody(): Expression {
  body := Block { kind: "block", statements: [], span: span() }
  return LambdaExpression {
    kind: "lambda-expression",
    params: [],
    returnType: null,
    body,
    parameterless: true,
    trailing: false,
    span: span(),
  }
}

function main(): int => 0
