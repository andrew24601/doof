import { Assert } from "std/assert"
import { readText } from "std/fs"
import { Parser, parse } from "./parser"
import {
  IntLiteral, DoubleLiteral, BinaryExpression, CallExpression,
  MemberExpression, FunctionDeclaration, ClassDeclaration, ArrayLiteral,
  IfStatement, ExpressionStatement, ImmutableBinding,
  StringLiteral,
} from "./ast"
import type { Statement, Expression } from "./ast"

function first(source: string): Statement {
  return parse(source).statements[0]
}

function assertInt(expression: Expression, expected: int): void {
  case expression {
    value: IntLiteral -> { Assert.equal(value.kind, "int-literal"); Assert.equal(value.value, expected) }
    _ -> { panic("expected int literal") }
  }
}

function assertDouble(expression: Expression, expected: double): void {
  case expression {
    value: DoubleLiteral -> { Assert.equal(value.kind, "double-literal"); Assert.equal(value.value, expected) }
    _ -> { panic("expected double literal") }
  }
}

export function testParsesPrimitiveLiterals(): void {
  intStmt := first("42")
  Assert.equal(intStmt.kind, "expression-statement")
  case intStmt {
    statement: ExpressionStatement -> { assertInt(statement.expression, 42) }
    _ -> { panic("expected expression statement") }
  }
  case first("3.14") {
    statement: ExpressionStatement -> { assertDouble(statement.expression, 3.14) }
    _ -> { panic("expected expression statement") }
  }
}

export function testPreservesOperatorPrecedence(): void {
  case first("1 + 2 * 3") {
    statement: ExpressionStatement -> {
      case statement.expression {
        expression: BinaryExpression -> {
          Assert.equal(expression.operator, "+")
          case expression.right {
            right: BinaryExpression -> { Assert.equal(right.operator, "*") }
            _ -> { panic("expected multiplicative right operand") }
          }
        }
        _ -> { panic("expected binary expression") }
      }
    }
    _ -> { panic("expected expression statement") }
  }
}

export function testParsesPostfixCallsAndMembers(): void {
  case first("items.map(=> it * 2).length") {
    statement: ExpressionStatement -> {
      case statement.expression {
        expression: MemberExpression -> {
          Assert.equal(expression.kind, "member-expression")
          case expression.object {
            call: CallExpression -> {
              Assert.equal(call.kind, "call-expression")
              Assert.equal(call.args.length, 1)
            }
            _ -> { panic("expected call expression") }
          }
        }
        _ -> { panic("expected member expression") }
      }
    }
    _ -> { panic("expected expression statement") }
  }
}

export function testPreservesTemplateInterpolationParts(): void {
  case first("`hello \${name}!`") {
    statement: ExpressionStatement -> {
      case statement.expression {
        value: StringLiteral -> {
          Assert.equal(value.kind, "string-literal")
          Assert.equal(value.parts.length, 3)
        }
        _ -> { panic("expected string literal") }
      }
    }
    _ -> { panic("expected expression statement") }
  }
}

export function testParsesBindingsFunctionsAndClasses(): void {
  program := parse(`
    readonly answer: int = 42
    function double(value: int): int => value * 2
    class Point {
      x, y: double
      function length(): double => x * x + y * y
    }
  `)
  Assert.equal(program.statements.length, 3)
  Assert.equal(program.statements[0].kind, "readonly-declaration")
  case program.statements[1] {
    functionDecl: FunctionDeclaration -> {
      Assert.equal(functionDecl.name, "double")
      Assert.equal(functionDecl.params.length, 1)
    }
    _ -> { panic("expected function declaration") }
  }
  case program.statements[2] {
    classDecl: ClassDeclaration -> {
      Assert.equal(classDecl.name, "Point")
      Assert.equal(classDecl.fields.length, 1)
      Assert.equal(classDecl.methods.length, 1)
    }
    _ -> { panic("expected class declaration") }
  }
}

export function testParsesTypesCollectionsAndIfStatements(): void {
  program := parse(`
    values: int[] := [1, 2, 3]
    result := if values.length > 0 then values[0] else 0
    if result > 0 { return }
  `)
  Assert.equal(program.statements[0].kind, "immutable-binding")
  case program.statements[0] {
    binding: ImmutableBinding -> {
      case binding.value {
        values: ArrayLiteral -> { Assert.equal(values.elements.length, 3) }
        _ -> { panic("expected array literal") }
      }
    }
    _ -> { panic("expected immutable binding") }
  }
  Assert.equal(program.statements[1].kind, "immutable-binding")
  Assert.equal(program.statements[2].kind, "if-statement")
  case program.statements[2] {
    ifStmt: IfStatement -> { Assert.equal(ifStmt.body.statements.length, 1) }
    _ -> { panic("expected if statement") }
  }
}

export function testTracksSourceSpans(): void {
  parser := Parser { source: "let value = 42" }
  program := parser.parse()
  Assert.equal(program.span.start.line, 1)
  Assert.equal(program.span.start.column, 1)
  Assert.equal(program.statements[0].span.start.offset, 0)
  Assert.equal(program.statements[0].span.end.offset, 14)
}

export function testParsesSelfhostCompilerSources(): void {
  files := ["selfhost/lexer.do", "selfhost/ast.do", "selfhost/parser.do"]
  for path of files {
    let source = try! readText(path)
    program := parse(source)
    Assert.equal(program.kind, "program")
    Assert.equal(program.statements.length > 0, true)
  }
}

export function testParsesMemberComparisonInWhile(): void {
  parse("function f(): void { while index < raw.length { return } }")
}

export function testParsesNegatedDiagnosticCall(): void {
  parse("function f(): void { if !terminated { diagnostic(\"Unterminated block comment\", commentLine, commentColumn) } }")
}

export function testParsesNativeClassSurface(): void {
  program := parse("export import class Client from \"<client.hpp>\" as native::Client { value: int get(): int static make(value: int): Client raw(): int => 7 label(): string { return \"ok\" } }")
  case program.statements[0] {
    class_: ClassDeclaration -> {
      Assert.equal(class_.exported, true)
      Assert.equal(class_.native_, true)
      Assert.equal(class_.nativeHeader, "<client.hpp>")
      Assert.equal(class_.nativeCppName, "native::Client")
      Assert.equal(class_.fields.length, 1)
      Assert.equal(class_.methods.length, 4)
      Assert.equal(class_.methods[0].bodyless, true)
      Assert.equal(class_.methods[1].static_, true)
      Assert.equal(class_.methods[1].bodyless, true)
      Assert.equal(class_.methods[2].bodyless, false)
      Assert.equal(class_.methods[3].bodyless, false)
    }
    _ -> { panic("expected native class declaration") }
  }
}

export function testParsesSelfhostSemanticSources(): void {
  for path of [
    "selfhost/resolver.do", "selfhost/ast.do", "selfhost/semantic.do",
    "selfhost/parser.do", "selfhost/analyzer.do", "selfhost/checker-types.do",
    "selfhost/checker.do", "selfhost/emitter-context.do", "selfhost/emitter-types.do",
    "selfhost/emitter-expr.do", "selfhost/emitter-stmt.do", "selfhost/emitter-decl.do",
    "selfhost/emitter-header.do", "selfhost/emitter-module.do", "selfhost/emitter-project.do",
    "selfhost/compiler.do",
  ] {
    source := try! readText(path)
    parsed := parse(source)
    Assert.equal(parsed.statements.length > 0, true)
  }
}
