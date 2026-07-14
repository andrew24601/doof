import { Assert } from "std/assert"
import { createAnalyzer } from "./analyzer"
import { createChecker, validateCheckedTypes } from "./checker"
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

export function testChecksArrayAndStringSearchMembers(): void {
  result := checked("function main(): int { values := [1, 2, 3]\ntext := \"hello\"\nif values.contains(2) && text.contains(\"ell\") { return values.indexOf(3) + text.indexOf(\"e\") }\nreturn 0 }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksSupportedJsonDeserializationSurface(): void {
  result := checked("class Config { name: string\nenabled: bool\ncount: int = 10\nnotes: string | null = null }\nfunction parse(value: JsonValue): Result<Config, string> => Config.fromJsonValue(value)")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksJsonDeserializationBeforeClassDeclaration(): void {
  result := checked("function parse(value: JsonValue): Result<Config, string> => Config.fromJsonValue(value)\nclass Config { name: string\ncount = 10 }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsJsonDeserializationForUnsupportedFields(): void {
  result := checked("class Handler { values: int[] }\nfunction parse(value: JsonValue): Result<Handler, string> => Handler.fromJsonValue(value)")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message, "Type \"Handler\" does not support automatic JSON deserialization")
}

export function testRejectsLenientJsonDeserializationUntilSupported(): void {
  result := checked("class Config { name: string }\nfunction parse(value: JsonValue): Result<Config, string> => Config.fromJsonValue(value, true)")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message, "Too many arguments")
}

export function testChecksReadonlyArrayLiteralAndReadonlyField(): void {
  result := checked("class Request { readonly headers: int[] }\nfunction use(values: readonly int[]): int => values.length\nfunction main(): int { values := readonly [1, 2]\nrequest := Request { headers: values }\nreturn use(request.headers) }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksExplicitGenericNamedCall(): void {
  result := checked("function create<T>(value: T, count: int = 1): T => value\nfunction main(): string => create<string>{ value: \"ok\" }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testSubstitutesExplicitGenericTupleReturn(): void {
  result := checked("function pair<T>(value: T): Tuple<T, T> => (value, value)\n(first, second) := pair<int>(1)\nfunction total(): int => first + second\n")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsExplicitGenericCallArity(): void {
  result := checked("function create<T>(value: T): T => value\nfunction main(): int => create<int, string>(1)")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message, "Generic call requires 1 type argument; received 2")
}

export function testChecksDeclarationElseNarrowingAndCapture(): void {
  result := checked("function load(): Result<int, string> => Success { value: 4 }\nfunction maybe(): string | null => \"ok\"\nfunction main(): int { value := load() else error { println(error)\nreturn 1 }\nname := maybe() else { return 2 }\nreturn value + name.length }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRequiresDeclarationElseHandlerToExit(): void {
  result := checked("function load(): Result<int, string> => Success { value: 4 }\nfunction main(): int { value := load() else { println(\"failed\") }\nreturn value }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message, "Declaration-else block must exit scope")
}

export function testAllowsDiscardDeclarationElseToContinue(): void {
  result := checked("function save(): Result<void, string> => Success()\nfunction main(): int { _ := save() else error { println(error) }\nreturn 0 }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testAcceptsPanicAsDeclarationElseExit(): void {
  result := checked("function load(): Result<int, string> => Success { value: 4 }\nfunction main(): int { value := load() else { panic(\"load failed\") }\nreturn value }")
  Assert.equal(result.diagnostics.length, 0)
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

export function testAcceptsReturnsOnEveryIfPath(): void {
  result := checked("function answer(flag: bool): int { if flag { return 1 } else { return 2 } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testAcceptsReturnsFromExhaustiveCase(): void {
  result := checked("function answer(value: int): int { case value { 1 -> { return 1 }, _ -> { return 2 } } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testAcceptsUnconditionalNonTerminatingLoop(): void {
  result := checked("function run(): int { while true {} }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksStatementsAfterBreakableLoop(): void {
  result := checked("function run(flag: bool): int { while true { if flag { break } }\nreturn 1 }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testResolvesImplicitClassMethodCalls(): void {
  result := checked("class Box { function value(): int => 7\nfunction read(): int { answer := value()\nreturn answer } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testResolvesClassAndMethodTypeParameters(): void {
  source := "class Box<T> { map<U>(transform: (it: T): U): Box<U> => Box<U> {} }"
  result := checked(source)
  Assert.equal(result.diagnostics.length, 0)
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  createChecker(analysis).check("/main.do")
  Assert.equal(validateCheckedTypes(analysis).length, 0)
}

export function testValidatesGenericStreamMembers(): void {
  source := "class FilteredStream<T> implements Stream<T> { source: Stream<T>\npred: (it: T): bool\nnext(): bool => source.next()\nvalue(): T => source.value() }\nclass MappedStream<T, U> implements Stream<U> { source: Stream<T>\ntransform: (it: T): U\nnext(): bool => source.next()\nvalue(): U => transform(source.value()) }\nclass Chain<T> implements Stream<T> { source: Stream<T>\nmap<U>(transform: (it: T): U): Chain<U> => Chain<U> { source: MappedStream<T, U> { source, transform } } }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  Assert.equal(validateCheckedTypes(analysis).length, 0)
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

export function testChecksNativeResultMethodsThroughTryBindings(): void {
  result := checked("import class Writer from \"writer.hpp\" as native::Writer { static open(path: string): Result<Writer, string> writeBlob(data: byte[]): Result<void, string> }\nfunction write(): void { try writer := Writer.open(\"path\")\ntry writer.writeBlob([]) }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksExplicitAndStructuralInterfaceImplementations(): void {
  result := checked("interface Drawable { value: int\nrender(): int }\nclass Point implements Drawable { readonly value: int\nfunction render(): int => value }\nclass Other { value: int\nfunction render(): int => value }\nfunction read(shape: Drawable): int => shape.render()\nfunction main(): int { point := Point { value: 3 }\nother := Other { value: 4 }\nfirst := read(point)\nsecond := read(other)\nreturn first + second }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsClassesThatDoNotSatisfyInterfaces(): void {
  result := checked("interface Drawable { render(): int }\nclass Point implements Drawable { function render(): string => \"bad\" }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message, "Class \"Point\" does not satisfy interface \"Drawable\"")
}

export function testRejectsInterfacesWithoutImplementations(): void {
  result := checked("interface Empty { value: int }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message, "Cannot emit interface \"Empty\" without implementing classes")
}

export function testChecksIntrinsicJsonValueLiterals(): void {
  result := checked("function main(): JsonValue { payload: JsonValue := { name: \"Ada\", values: [1, true, null] }\nreturn payload }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsNonJsonCollections(): void {
  result := checked("function main(): void { values: int[] := [1, 2]\npayload: JsonValue := values }")
  Assert.equal(result.diagnostics.length > 0, true)
}
