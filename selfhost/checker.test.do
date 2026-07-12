import { Assert } from "std/assert"
import { createAnalyzer } from "./analyzer"
import { createChecker } from "./checker"
import { CheckResult, SourceFile } from "./semantic"
import { AssignmentExpression, Block, ClassDeclaration, ExpressionStatement, Identifier, IfStatement, FunctionDeclaration, ImmutableBinding } from "./ast"
import { typeName, unknownType } from "./checker-types"

function checked(source: string): CheckResult {
  sources := [SourceFile { path: "/main.do", source }]
  analysis := createAnalyzer(sources).analyze("/main.do")
  checker := createChecker(analysis)
  semantic := checker.check("/main.do")
  return CheckResult { diagnostics: semantic.diagnostics }
}

export function testInfersExpressionsAndCalls(): void {
  source := "values: int[] := [1, 2, 3]\nfunction main(): int { total := values.length\nreturn total }"
  sources := [SourceFile { path: "/main.do", source }]
  analysis := createAnalyzer(sources).analyze("/main.do")
  semantic := createChecker(analysis).check("/main.do")
  Assert.equal(semantic.diagnostics.length, 0)
  case analysis.modules[0].program.statements[0] {
    binding: ImmutableBinding -> { Assert.equal(typeName(binding.resolvedType ?? unknownType()), "int[]") }
    _ -> { panic("expected an immutable binding") }
  }
}

export function testRejectsImmutableAssignment(): void {
  result := checked("function main(): void { value := 1\nvalue = 2 }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message, "Cannot assign to immutable binding 'value'")
}

export function testRequiresReturnsOnEveryPath(): void {
  result := checked("function answer(flag: bool): int { if flag { return 1 } }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message, "Function 'answer' may complete without returning int")
}

export function testResolvesImplicitClassMethodCalls(): void {
  result := checked("class Box { function value(): int => 7\nfunction read(): int { answer := value()\nreturn answer } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testInfersNullableImplicitMethodResults(): void {
  result := checked("class Item {}\nclass Box { function maybe(): Item | null => null\nfunction read(): void { ignored := maybe() } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testDecoratesNestedNullableAssignmentTargets(): void {
  source := "class Left { value: int }\nclass Right { value: int }\ntype Expression = Left | Right\nclass ParserLike { function parse(): void { let value: Expression | null = null\nif true { value = Left { value: 1 } } else { value = Right { value: 2 } } } }"
  sources := [SourceFile { path: "/main.do", source }]
  analysis := createAnalyzer(sources).analyze("/main.do")
  semantic := createChecker(analysis).check("/main.do")
  Assert.equal(semantic.diagnostics.length, 0)
  case analysis.modules[0].program.statements[3] {
    class_: ClassDeclaration -> {
      case class_.methods[0].body {
        block: Block -> {
          case block.statements[1] {
            if_: IfStatement -> {
              case if_.body.statements[0] {
                expression: ExpressionStatement -> {
                  case expression.expression {
                    assignment: AssignmentExpression -> {
                      case assignment.target {
                        identifier: Identifier -> { Assert.equal(identifier.resolvedBinding != null, true) }
                      }
                    }
                  }
                }
              }
              case if_.else_! {
                elseBlock: Block -> {
                  case elseBlock.statements[0] {
                    expression: ExpressionStatement -> {
                      case expression.expression {
                        assignment: AssignmentExpression -> {
                          case assignment.target {
                            identifier: Identifier -> { Assert.equal(identifier.resolvedBinding != null, true) }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

export function testChecksNativeMethodsAndStaticMethods(): void {
  result := checked("import class Client from \"client.hpp\" as native::Client { get(): int static make(): Client }\nfunction read(client: Client): int { made := Client.make()\nreturn client.get() + made.get() }")
  Assert.equal(result.diagnostics.length, 0)
}
