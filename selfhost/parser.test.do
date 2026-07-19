import { Assert } from "std/assert"
import { Parser, parse } from "./parser"
import {
  IntLiteral, LongLiteral, DoubleLiteral, BinaryExpression, CallExpression,
  MemberExpression, FunctionDeclaration, ClassDeclaration, ArrayLiteral, Block,
  IfStatement, ExpressionStatement, ConstDeclaration, ReadonlyDeclaration, ImmutableBinding, LetDeclaration, TryStatement,
  StringLiteral, LambdaExpression, AsyncExpression, RetireExpression, AsExpression,
  ActorCreationExpression, CaseExpression, EnumDeclaration, InterfaceDeclaration, NamedType, ObjectLiteral, RangePattern, TypeAliasDeclaration, UnionType, YieldStatement,
  MockImportDirective, WeakType, CatchExpression, YieldBlockExpression, YieldBlockAssignmentStatement, DestructuringStatement, DotShorthand,
} from "./ast"
import type { Statement, Expression } from "./ast"

function first(source: string): Statement {
  return parse(source).statements[0]
}

export function testParsesYieldBlockDeclarationsAndReassignment(): void {
  program := parse("function main(): int { let value <- { yield 1 }\nvalue <- { yield value + 1 }\nreturn value }")
  case program.statements[0] {
    fn: FunctionDeclaration -> { case fn.body {
      block: Block -> {
        case block.statements[0] {
          declaration: LetDeclaration -> { case declaration.value {
            _: YieldBlockExpression -> { }
            _ -> { panic("expected yield-block initializer") }
          } }
          _ -> { panic("expected let declaration") }
        }
        case block.statements[1] {
          assignment: YieldBlockAssignmentStatement -> { Assert.equal(assignment.name, "value") }
          _ -> { panic("expected yield-block reassignment") }
        }
      }
      _ -> { panic("expected function block") }
    } }
    _ -> { panic("expected function") }
  }
}

export function testParsesCatchExpression(): void {
  case first("error := catch { try load() }") {
    binding: ImmutableBinding -> { case binding.value {
      catch_: CatchExpression -> { Assert.equal(catch_.body.statements.length, 1) }
      _ -> { panic("expected catch expression") }
    } }
    _ -> { panic("expected immutable binding") }
  }
}

export function testParsesWeakFieldAndTypeQualifiers(): void {
  program := parse("class Node { weak parent: Node\nancestor: weak Node | null }")
  case program.statements[0] {
    class_: ClassDeclaration -> {
      Assert.equal(class_.fields[0].weak_, true)
      Assert.equal(class_.fields[1].weak_, false)
      case class_.fields[1].type_! {
        weak_: WeakType -> {
          Assert.equal(weak_.kind, "weak-type")
          case weak_.type_ {
            union_: UnionType -> { Assert.equal(union_.types.length, 2) }
            _ -> { panic("expected weak to qualify the complete union") }
          }
        }
        _ -> { panic("expected weak type") }
      }
    }
    _ -> { panic("expected class declaration") }
  }
}

export function testParsesFixedConstClassFields(): void {
  case first("class Circle { const kind = \"circle\"\nradius: double }") {
    class_: ClassDeclaration -> {
      Assert.equal(class_.fields[0].const_, true)
      Assert.equal(class_.fields[0].readonly_, false)
      case class_.fields[0].defaultValue! {
        value: StringLiteral -> { Assert.equal(value.value, "circle") }
        _ -> { panic("expected fixed string field") }
      }
    }
    _ -> { panic("expected class declaration") }
  }
}

export function testRetainsDeclarationDescriptions(): void {
  program := parse("class Tool \"A tool.\" { x \"x-axis\", y: int\nfunction run \"Runs.\"(input \"Payload.\": string): string => input }\ninterface Named \"A name.\" { value \"Value.\": string\nread \"Reads.\"(): string }\nenum State \"State.\" { Ready \"Ready now.\", Done }\ntype Label \"Label.\" = string\nreadonly version \"Version.\" = 1")
  case program.statements[0] {
    class_: ClassDeclaration -> {
      Assert.equal(class_.description, "A tool.")
      Assert.equal(class_.fields[0].descriptions[0], "x-axis")
      Assert.equal(class_.fields[0].descriptions[1], "")
      Assert.equal(class_.methods[0].description, "Runs.")
      Assert.equal(class_.methods[0].params[0].description, "Payload.")
    }
    _ -> { panic("expected described class") }
  }
  case program.statements[1] {
    interface_: InterfaceDeclaration -> {
      Assert.equal(interface_.description, "A name.")
      Assert.equal(interface_.fields[0].description, "Value.")
      Assert.equal(interface_.methods[0].description, "Reads.")
    }
    _ -> { panic("expected described interface") }
  }
  case program.statements[2] {
    enum_: EnumDeclaration -> {
      Assert.equal(enum_.description, "State.")
      Assert.equal(enum_.variants[0].description, "Ready now.")
    }
    _ -> { panic("expected described enum") }
  }
  case program.statements[3] {
    alias: TypeAliasDeclaration -> { Assert.equal(alias.description, "Label.") }
    _ -> { panic("expected described alias") }
  }
  case program.statements[4] {
    readonly_: ReadonlyDeclaration -> { Assert.equal(readonly_.description, "Version.") }
    _ -> { panic("expected described readonly") }
  }
}

export function testRecognizesDescriptionsWhenClassifyingShortFormMethods(): void {
  program := parse("class Tool { run \"Runs.\"(input: string): string => input\nstatic build \"Builds.\"<T>(value: T): T => value\nprivate reset \"Resets.\"(): void {} }")
  case program.statements[0] {
    class_: ClassDeclaration -> {
      Assert.equal(class_.fields.length, 0)
      Assert.equal(class_.methods.length, 3)
      Assert.equal(class_.methods[0].description, "Runs.")
      Assert.equal(class_.methods[1].description, "Builds.")
      Assert.equal(class_.methods[1].static_, true)
      Assert.equal(class_.methods[2].description, "Resets.")
      Assert.equal(class_.methods[2].private_, true)
    }
    _ -> { panic("expected class with described short-form methods") }
  }
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

function assertLong(expression: Expression, expected: long): void {
  case expression {
    value: LongLiteral -> { Assert.equal(value.kind, "long-literal"); Assert.equal(value.value, expected) }
    _ -> { panic("expected long literal") }
  }
}

export function testParsesMockImportDirectives(): void {
  case first("mock import for \"../scene\" {\n  \"./event\" => \"./scene_event.mock\",\n  \"./model\" => \"./scene_model.mock\";\n  \"./render\" => \"./scene_render.mock\"\n}") {
    directive: MockImportDirective -> {
      Assert.equal(directive.kind, "mock-import-directive")
      Assert.equal(directive.sourcePattern, "../scene")
      Assert.equal(directive.mappings.length, 3)
      Assert.equal(directive.mappings[0].dependency, "./event")
      Assert.equal(directive.mappings[0].replacement, "./scene_event.mock")
      Assert.equal(directive.mappings[1].dependency, "./model")
      Assert.equal(directive.mappings[2].replacement, "./scene_render.mock")
      Assert.equal(directive.mappings[0].span.start.line, 2)
    }
    _ -> { panic("expected mock import directive") }
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

export function testParsesLongLiteralsWithoutIntTruncation(): void {
  case first("72623859790382856L") {
    statement: ExpressionStatement -> { assertLong(statement.expression, 72623859790382856L) }
    _ -> { panic("expected expression statement") }
  }
  case first("4294967295L") {
    statement: ExpressionStatement -> { assertLong(statement.expression, 4294967295L) }
    _ -> { panic("expected expression statement") }
  }
}

export function testParsesLargeDoubleLiteralsWithoutIntTruncation(): void {
  case first("86400000000000.0") {
    statement: ExpressionStatement -> { assertDouble(statement.expression, 86400000000000.0) }
    _ -> { panic("expected expression statement") }
  }
  case first("1.4142135623730951") {
    statement: ExpressionStatement -> {
      case statement.expression {
        value: DoubleLiteral -> { Assert.isTrue(value.value > 1.414 && value.value < 1.415) }
        _ -> { panic("expected double literal") }
      }
    }
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

export function testParsesTrailingLambdaAfterMethodCall(): void {
  case first("receiver.onMessage() { this.values.push(it) }") {
    statement: ExpressionStatement -> {
      case statement.expression {
        call: CallExpression -> {
          Assert.equal(call.args.length, 1)
          case call.args[0].value {
            lambda: LambdaExpression -> {
              Assert.equal(lambda.parameterless, true)
              Assert.equal(lambda.trailing, true)
              case lambda.body {
                body: Block -> { Assert.equal(body.statements.length, 1) }
                _ -> { panic("expected trailing lambda block") }
              }
            }
            _ -> { panic("expected trailing lambda argument") }
          }
        }
        _ -> { panic("expected call expression") }
      }
    }
    _ -> { panic("expected expression statement") }
  }
}

export function testParsesReadonlyArrayLiteral(): void {
  case first("readonly [1, 2]") {
    statement: ExpressionStatement -> {
      case statement.expression {
        array: ArrayLiteral -> {
          Assert.equal(array.readonly_, true)
          Assert.equal(array.elements.length, 2)
        }
        _ -> { panic("expected readonly array literal") }
      }
    }
    _ -> { panic("expected expression statement") }
  }
}

export function testParsesReadonlyMapType(): void {
  case first("function read(value: readonly Map<string, JsonValue>): void { }") {
    fn: FunctionDeclaration -> {
      case fn.params[0].type_! {
        named: NamedType -> {
          Assert.equal(named.name, "ReadonlyMap")
          Assert.equal(named.typeArgs.length, 2)
        }
        _ -> { panic("expected readonly map named type") }
      }
    }
    _ -> { panic("expected function declaration") }
  }
}

export function testParsesReadonlySetType(): void {
  case first("function read(value: readonly Set<int>): void { }") {
    fn: FunctionDeclaration -> {
      case fn.params[0].type_! {
        named: NamedType -> {
          Assert.equal(named.name, "ReadonlySet")
          Assert.equal(named.typeArgs.length, 1)
        }
        _ -> { panic("expected readonly set named type") }
      }
    }
    _ -> { panic("expected function declaration") }
  }
}

export function testParsesExplicitGenericCalls(): void {
  program := parse("create<int>(1)\ncreate<string>{ value: \"ok\" }")
  for statement of program.statements {
    case statement {
      expression: ExpressionStatement -> {
        case expression.expression {
          call: CallExpression -> {
            Assert.equal(call.typeArgs.length, 1)
            Assert.equal(call.args.length, 1)
          }
          _ -> { panic("expected generic call") }
        }
      }
      _ -> { panic("expected expression statement") }
    }
  }
}

export function testParsesActorConcurrencyExpressions(): void {
  program := parse("worker := Actor<Worker>(42)\npromise := async worker.run()\nstate := retire worker\n")
  case program.statements[0] {
    binding: ImmutableBinding -> {
      case binding.value {
        actor: ActorCreationExpression -> { Assert.equal(actor.className, "Worker"); Assert.equal(actor.args.length, 1) }
        _ -> { panic("expected actor creation") }
      }
    }
    _ -> { panic("expected actor binding") }
  }
  case program.statements[1] {
    binding: ImmutableBinding -> {
      case binding.value {
        async_: AsyncExpression -> {
          case async_.expression {
            inner: Expression -> {
              case inner {
                call: CallExpression -> { Assert.equal(call.kind, "call-expression") }
                _ -> { panic("expected async call") }
              }
            }
            _ -> { panic("expected async call") }
          }
        }
        _ -> { panic("expected async expression") }
      }
    }
    _ -> { panic("expected promise binding") }
  }
  case program.statements[2] {
    binding: ImmutableBinding -> {
      case binding.value {
        retire_: RetireExpression -> { Assert.equal(retire_.actor.kind, "identifier") }
        _ -> { panic("expected retire expression") }
      }
    }
    _ -> { panic("expected retired state binding") }
  }
}

export function testParsesAsyncBlockForSemanticDiagnostic(): void {
  case first("async { return 42 }") {
    statement: ExpressionStatement -> {
      case statement.expression {
        async_: AsyncExpression -> {
          case async_.expression {
            block: Block -> { Assert.equal(block.kind, "block") }
            _ -> { panic("expected async block") }
          }
        }
        _ -> { panic("expected async expression") }
      }
    }
    _ -> { panic("expected expression statement") }
  }
}

export function testPreservesReadonlyInterfaceFields(): void {
  case first("interface Payload { readonly value: int\nmutable: string }") {
    interface_: InterfaceDeclaration -> {
      Assert.equal(interface_.fields[0].readonly_, true)
      Assert.equal(interface_.fields[1].readonly_, false)
    }
    _ -> { panic("expected interface declaration") }
  }
}

export function testSeparatesGenericNamedCallsAcrossLines(): void {
  program := parse("first := createChannel<int>{ capacity: 1 }\nsecond := createChannel<string>{ capacity: 2 }")
  Assert.equal(program.statements.length, 2)
}

export function testParsesDeclarationElseForms(): void {
  program := parse(`
    value := load() else error { return }
    typed: int := maybe() else { return }
    _ := save() else failure { println(failure) }
  `)
  Assert.equal(program.statements.length, 3)
  case program.statements[0] {
    binding: ImmutableBinding -> {
      Assert.equal(binding.else_ != null, true)
      Assert.equal(binding.failureName, "error")
    }
    _ -> { panic("expected declaration-else binding") }
  }
  case program.statements[1] {
    binding: ImmutableBinding -> {
      Assert.equal(binding.else_ != null, true)
      Assert.equal(binding.failureName, null)
    }
    _ -> { panic("expected typed declaration-else binding") }
  }
  case program.statements[2] {
    binding: ImmutableBinding -> {
      Assert.equal(binding.name, "_")
      Assert.equal(binding.failureName, "failure")
    }
    _ -> { panic("expected discard declaration-else binding") }
  }
}

export function testParsesAsNarrowingBeforeDeclarationElse(): void {
  program := parse("value := raw as bool else { return }")
  case program.statements[0] {
    binding: ImmutableBinding -> {
      case binding.value {
        as_: AsExpression -> {
          Assert.equal(as_.kind, "as-expression")
          case as_.targetType {
            named: NamedType -> { Assert.equal(named.name, "bool") }
            _ -> { panic("expected named as target") }
          }
        }
        _ -> { panic("expected as expression") }
      }
      Assert.equal(binding.else_ != null, true)
    }
    _ -> { panic("expected declaration-else binding") }
  }
}

export function testParsesTryValueDeclarations(): void {
  program := parse(`
    try const first = load()
    try readonly second = load()
    try let third = load()
  `)
  Assert.equal(program.statements.length, 3)
  case program.statements[0] {
    try_: TryStatement -> { case try_.binding { declaration: ConstDeclaration -> { Assert.equal(declaration.name, "first") }
      _ -> { panic("expected const try binding") } } }
    _ -> { panic("expected try statement") }
  }
  case program.statements[1] {
    try_: TryStatement -> { case try_.binding { declaration: ReadonlyDeclaration -> { Assert.equal(declaration.name, "second") }
      _ -> { panic("expected readonly try binding") } } }
    _ -> { panic("expected try statement") }
  }
  case program.statements[2] {
    try_: TryStatement -> { case try_.binding { declaration: LetDeclaration -> { Assert.equal(declaration.name, "third") }
      _ -> { panic("expected let try binding") } } }
    _ -> { panic("expected try statement") }
  }
}

export function testParsesMultipleValuePatternsAsAlternatives(): void {
  program := parse(`result := case ext {
    ".html" | ".htm" -> "text/html",
    _ -> "unknown"
  }`)
  case program.statements[0] {
    statement: ImmutableBinding -> { case statement.value {
      expression: CaseExpression -> {
        Assert.equal(expression.arms[0].patterns.length, 2)
        Assert.equal(expression.arms[0].patterns[0].kind, "value-pattern")
        Assert.equal(expression.arms[0].patterns[1].kind, "value-pattern")
      }
      _ -> { panic("expected case expression") }
    } }
    _ -> { panic("expected immutable binding") }
  }
}

export function testParsesFiniteAndOpenEndedCaseRangePatterns(): void {
  program := parse("result := case value { 1..5 -> 1, 6..<10 -> 2, 10.. -> 3, ..<0 -> 4, _ -> 5 }")
  case program.statements[0] {
    statement: ImmutableBinding -> { case statement.value {
      expression: CaseExpression -> {
        Assert.equal(expression.arms.length, 5)
        case expression.arms[0].patterns[0] {
          range: RangePattern -> {
            Assert.equal(range.inclusive, true)
          }
          _ -> { panic("expected inclusive range pattern") }
        }
        case expression.arms[1].patterns[0] {
          range: RangePattern -> { Assert.equal(range.inclusive, false) }
          _ -> { panic("expected exclusive range pattern") }
        }
        case expression.arms[2].patterns[0] {
          range: RangePattern -> { Assert.equal(range.inclusive, true) }
          _ -> { panic("expected lower-bounded range pattern") }
        }
        case expression.arms[3].patterns[0] {
          range: RangePattern -> { Assert.equal(range.inclusive, false) }
          _ -> { panic("expected upper-bounded range pattern") }
        }
      }
      _ -> { panic("expected case expression") }
    } }
    _ -> { panic("expected immutable binding") }
  }
}

export function testParsesExpressionResultElseAsDiscardBinding(): void {
  program := parse("save() else error { println(error) }")
  case program.statements[0] {
    binding: ImmutableBinding -> {
      Assert.equal(binding.name, "_")
      Assert.equal(binding.failureName, "error")
      Assert.equal(binding.else_ != null, true)
    }
    _ -> { panic("expected result-else discard binding") }
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

export function testPreservesStructDeclarations(): void {
  case first("struct Point { x: int }") {
    structDecl: ClassDeclaration -> { Assert.equal(structDecl.struct_, true) }
    _ -> { panic("expected struct declaration") }
  }
}

export function testParsesClassDestructorBody(): void {
  case first("class Resource { destructor { println(\"closed\") } }") {
    classDecl: ClassDeclaration -> {
      Assert.isTrue(classDecl.destructor_ != null)
      Assert.equal(classDecl.destructor_!.statements.length, 1)
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

export function testParsesQuotedStringMapKeys(): void {
  case first("options := { \"DOOF_STDLIB_ROOT\": absolutePath(\"../doof-stdlib\") }") {
    binding: ImmutableBinding -> {
      case binding.value {
        object: ObjectLiteral -> {
          Assert.equal(object.properties.length, 1)
          Assert.equal(object.properties[0].name, "DOOF_STDLIB_ROOT")
          case object.properties[0].value! {
            _: CallExpression -> { }
            _ -> { panic("expected map value expression") }
          }
        }
        _ -> { panic("expected string-keyed map literal") }
      }
    }
    _ -> { panic("expected immutable binding") }
  }
}

export function testParsesDotShorthandEnumMapKeys(): void {
  case first("piles: Map<Suit, int> := { .Spades: 1, .Hearts: 2 }") {
    binding: ImmutableBinding -> {
      case binding.value {
        object: ObjectLiteral -> {
          Assert.equal(object.properties.length, 2)
          case object.properties[0].key! {
            shorthand: DotShorthand -> { Assert.equal(shorthand.name, "Spades") }
            _ -> { panic("expected dot-shorthand map key") }
          }
          case object.properties[1].key! {
            shorthand: DotShorthand -> { Assert.equal(shorthand.name, "Hearts") }
            _ -> { panic("expected dot-shorthand map key") }
          }
        }
        _ -> { panic("expected enum-keyed map literal") }
      }
    }
    _ -> { panic("expected immutable binding") }
  }
}

export function testParsesIntegerMapKeys(): void {
  case first("labels: Map<int, string> := { 1: \"one\", 2L: \"two\" }") {
    binding: ImmutableBinding -> {
      case binding.value {
        object: ObjectLiteral -> {
          case object.properties[0].key! {
            key: IntLiteral -> { Assert.equal(key.value, 1) }
            _ -> { panic("expected integer map key") }
          }
          case object.properties[1].key! {
            key: LongLiteral -> { Assert.equal(key.value, 2L) }
            _ -> { panic("expected long map key") }
          }
        }
        _ -> { panic("expected integer-keyed map literal") }
      }
    }
    _ -> { panic("expected immutable binding") }
  }
}

export function testParsesTypedLambdaParametersAndReturnTypes(): void {
  program := parse("loader := (path: string): SourceFile | null => null")
  case program.statements[0] {
    binding: ImmutableBinding -> {
      case binding.value {
        lambda: LambdaExpression -> {
          Assert.equal(lambda.params.length, 1)
          Assert.equal(lambda.params[0].name, "path")
          case lambda.params[0].type_! {
            _: NamedType -> { }
            _ -> { panic("expected named parameter type") }
          }
          case lambda.returnType! {
            _: UnionType -> { }
            _ -> { panic("expected union return type") }
          }
        }
        _ -> { panic("expected typed lambda") }
      }
    }
    _ -> { panic("expected lambda binding") }
  }
}

export function testRetainsStructuredParseFailureLocation(): void {
  parser := Parser { source: "value := (path: string): int => path\nnext :=" }
  result := catchPanic(=> parser.parse())
  case result {
    _: Failure<string> -> { }
    _ -> { panic("expected parse failure") }
  }
  Assert.equal(parser.errorMessage, "Expected an expression")
  Assert.equal(parser.errorLine, 2)
  Assert.equal(parser.errorColumn, 8)
  Assert.equal(parser.errorOffset > 0, true)
}

export function testParsesMemberComparisonInWhile(): void {
  parse("function f(): void { while index < raw.length { return } }")
}

export function testDoesNotParseUppercaseConditionOperandAsConstruction(): void {
  program := parse("function f(signature: long): void { if signature != CENTRAL_DIRECTORY_SIGNATURE { return } }")
  case program.statements[0] {
    function_: FunctionDeclaration -> {
      case function_.body {
        body: Block -> {
          case body.statements[0] {
            if_: IfStatement -> {
              case if_.condition {
                binary: BinaryExpression -> { Assert.equal(binary.operator, "!=") }
                _ -> { panic("expected binary condition") }
              }
            }
            _ -> { panic("expected if statement") }
          }
        }
        _ -> { panic("expected function body") }
      }
    }
    _ -> { panic("expected function declaration") }
  }
}

export function testParsesBlockBodiedCaseExpressionArms(): void {
  case first("result := case value { f: Failure -> { Assert.fail(f.error.message)\nyield null } }") {
    binding: ImmutableBinding -> {
      case binding.value {
        case_: CaseExpression -> {
          case case_.arms[0].body {
            block: Block -> {
              Assert.equal(block.statements.length, 2)
              case block.statements[1] {
                _: YieldStatement -> { }
                _ -> { panic("expected yield statement") }
              }
            }
            _ -> { panic("expected block case arm") }
          }
        }
        _ -> { panic("expected case expression") }
      }
    }
    _ -> { panic("expected immutable binding") }
  }
}

export function testParsesNegatedDiagnosticCall(): void {
  parse("function f(): void { if !terminated { diagnostic(\"Unterminated block comment\", commentLine, commentColumn) } }")
}

export function testParsesNativeClassSurface(): void {
  program := parse("export import class Client from \"<client.hpp>\" as native::Client { value: int get(): int isolated static make(value: int): Client raw(): int => 7 label(): string { return \"ok\" } }")
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
      Assert.equal(class_.methods[1].isolated_, true)
      Assert.equal(class_.methods[1].bodyless, true)
      Assert.equal(class_.methods[2].bodyless, false)
      Assert.equal(class_.methods[3].bodyless, false)
    }
    _ -> { panic("expected native class declaration") }
  }
}

export function testParsesExportedIsolatedFunction(): void {
  program := parse("export isolated function compute(value: int): int => value")
  case program.statements[0] {
    function_: FunctionDeclaration -> {
      Assert.equal(function_.exported, true)
      Assert.equal(function_.isolated_, true)
    }
    _ -> { panic("expected isolated function declaration") }
  }
}

export function testParsesGenericNativeFunction(): void {
  program := parse("import function send<T>(value: T): void from \"native.hpp\" as native::send")
  case program.statements[0] {
    fn: FunctionDeclaration -> {
      Assert.equal(fn.typeParams.length, 1)
      Assert.equal(fn.typeParams[0], "T")
    }
    _ -> { panic("expected generic native function") }
  }
}

export function testPreservesGenericFunctionConstraints(): void {
  program := parse("function describe<T: Reflectable>(tool: T): string => T.metadata.name")
  case program.statements[0] {
    fn: FunctionDeclaration -> {
      Assert.equal(fn.typeParamConstraints.length, 1)
      case fn.typeParamConstraints[0].type_! {
        constraint: NamedType -> { Assert.equal(constraint.name, "Reflectable") }
        _ -> { panic("expected named constraint") }
      }
    }
    _ -> { panic("expected generic function") }
  }
}

export function testPreservesUnionGenericConstraints(): void {
  program := parse("function widen<T: int | long>(value: T): T => value")
  case program.statements[0] {
    fn: FunctionDeclaration -> {
      case fn.typeParamConstraints[0].type_! {
        constraint: UnionType -> {
          Assert.equal(constraint.types.length, 2)
          case constraint.types[0] {
            first: NamedType -> { Assert.equal(first.name, "int") }
            _ -> { panic("expected first named constraint member") }
          }
          case constraint.types[1] {
            second: NamedType -> { Assert.equal(second.name, "long") }
            _ -> { panic("expected second named constraint member") }
          }
        }
        _ -> { panic("expected union constraint") }
      }
    }
    _ -> { panic("expected generic function") }
  }
}

export function testParsesIsolatedNativeFunction(): void {
  program := parse("export import isolated function poll(): int from \"native.hpp\" as native::poll")
  case program.statements[0] {
    fn: FunctionDeclaration -> {
      Assert.equal(fn.exported, true)
      Assert.equal(fn.isolated_, true)
      Assert.equal(fn.bodyless, true)
      Assert.equal(fn.native_, true)
    }
    _ -> { panic("expected isolated native function") }
  }
}

export function testParsesDestructuringDeclarationsAndAssignments(): void {
  program := parse("function main(): void { values := [1, 2, 3]\n[first, _, third] := values\nlet (left, right) = (1, 2)\n{ name as displayName, age } := Person { name: \"Ada\", age: 37 }\n[first, third] = values\n(left, right) = (3, 4)\n{ name as displayName } = Person { name: \"Grace\", age: 40 } }")
  case program.statements[0] {
    fn: FunctionDeclaration -> { case fn.body {
      block: Block -> {
        for i of 1..<7 {
          case block.statements[i] {
            destructuring: DestructuringStatement -> {
              if i == 1 { Assert.equal(destructuring.kind, "array-destructuring") }
              if i == 2 { Assert.equal(destructuring.kind, "positional-destructuring"); Assert.equal(destructuring.bindingKind, "let") }
              if i == 3 { Assert.equal(destructuring.kind, "named-destructuring"); Assert.equal(destructuring.namedBindings[0].alias, "displayName") }
              if i == 4 { Assert.equal(destructuring.kind, "array-destructuring-assignment") }
              if i == 5 { Assert.equal(destructuring.kind, "positional-destructuring-assignment") }
              if i == 6 { Assert.equal(destructuring.kind, "named-destructuring-assignment") }
            }
            _ -> { panic("expected destructuring statement") }
          }
        }
      }
      _ -> { panic("expected function block") }
    } }
    _ -> { panic("expected function") }
  }
}

export function testParsesLineLeadingArrayDestructuringAfterExpression(): void {
  program := parse("function main(): void { println(\"ready\")\n[first, second] := [1, 2] }")
  case program.statements[0] {
    fn: FunctionDeclaration -> { case fn.body {
      block: Block -> {
        Assert.equal(block.statements.length, 2)
        case block.statements[1] {
          destructuring: DestructuringStatement -> { Assert.equal(destructuring.kind, "array-destructuring") }
          _ -> { panic("expected array destructuring") }
        }
      }
      _ -> { panic("expected function block") }
    } }
    _ -> { panic("expected function") }
  }
}

export function testTreatsEveryLineLeadingArrayAsANewStatement(): void {
  program := parse("function main(): void { println(\"ready\")\n[1, 2, 3] }")
  case program.statements[0] {
    fn: FunctionDeclaration -> { case fn.body {
      block: Block -> {
        Assert.equal(block.statements.length, 2)
        case block.statements[1] {
          expression: ExpressionStatement -> { case expression.expression {
            _: ArrayLiteral -> { }
            _ -> { panic("expected array literal") }
          } }
          _ -> { panic("expected expression statement") }
        }
      }
      _ -> { panic("expected function block") }
    } }
    _ -> { panic("expected function") }
  }
}

export function testParsesTryDestructuringForms(): void {
  program := parse("function load(): Result<Tuple<int, int>, string> => Success { value: (1, 2) }\nfunction run(): Result<int, string> { try (left, right) := load()\nlet a = 0\nlet b = 0\ntry (a, b) = load()\nreturn Success { value: left + right + a + b } }")
  case program.statements[1] {
    fn: FunctionDeclaration -> { case fn.body {
      block: Block -> {
        case block.statements[0] {
          try_: TryStatement -> { case try_.binding {
            destructuring: DestructuringStatement -> { Assert.equal(destructuring.kind, "positional-destructuring") },
            _ -> { panic("expected try destructuring") }
          } },
          _ -> { panic("expected try") }
        }
        case block.statements[3] {
          try_: TryStatement -> { case try_.binding {
            destructuring: DestructuringStatement -> { Assert.equal(destructuring.kind, "positional-destructuring-assignment") },
            _ -> { panic("expected try destructuring assignment") }
          } },
          _ -> { panic("expected try") }
        }
      }
      _ -> { panic("expected function block") }
    } }
    _ -> { panic("expected function") }
  }
}
