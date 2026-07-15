import { Assert } from "std/assert"
import { createAnalyzer } from "./analyzer"
import { createChecker, validateCheckedTypes } from "./checker"
import { CheckResult, SourceFile } from "./semantic"
import { AsExpression, AssignmentExpression, Block, ClassDeclaration, ConstructExpression, Expression, ExpressionStatement, Identifier, IfStatement, FunctionDeclaration, ImmutableBinding, ObjectLiteral, WithStatement } from "./ast"
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

export function testArrayPopReturnsResult(): void {
  valid := checked("function take(values: int[]): Result<int, string> => values.pop()")
  Assert.equal(valid.diagnostics.length, 0)

  ignored := checked("function take(values: int[]): void { values.pop() }")
  Assert.equal(ignored.diagnostics.length, 1)
  Assert.equal(ignored.diagnostics[0].message.contains("Result value must be handled"), true)
}

export function testDecoratesReadonlyMapConstructionAndSizeMember(): void {
  source := "class RouteMatch { params: readonly Map<string, string> }\nfunction equal<T>(actual: T, expected: T): void {}\nfunction match(params: Map<string, string>): RouteMatch { return RouteMatch { params: params.buildReadonly() } }\nfunction verify(matched: RouteMatch | null): void { equal(matched!.params.size, 0) }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  diagnostics := validateCheckedTypes(analysis)
  for diagnostic of diagnostics { println(diagnostic.message) }
  Assert.equal(diagnostics.length, 0)
}

export function testCompleteDecorationGateRejectsMissingWithBindingType(): void {
  source := "function main(): int { with base := 20 { return base }\nreturn 0 }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  case analysis.modules[0].program.statements[0] {
    fn: FunctionDeclaration -> {
      case fn.body {
        block: Block -> {
          case block.statements[0] {
            with_: WithStatement -> { with_.bindings[0].resolvedType = null }
            _ -> { panic("expected a with statement") }
          }
        }
        _ -> { panic("expected a block function") }
      }
    }
    _ -> { panic("expected a function") }
  }
  diagnostics := validateCheckedTypes(analysis)
  Assert.equal(diagnostics.length, 1)
  Assert.equal(diagnostics[0].message.contains("Missing resolved type for with binding base"), true)
}

export function testCompleteDecorationGateTraversesAsSourceAndTarget(): void {
  source := "function narrow(raw: JsonValue): Result<string, string> => raw as string"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  case analysis.modules[0].program.statements[0] {
    fn: FunctionDeclaration -> {
      case fn.body {
        expression: Expression -> {
          case expression {
            as_: AsExpression -> {
              as_.expression.resolvedType = null
              as_.targetType.resolvedType = null
            }
            _ -> { panic("expected an as expression") }
          }
        }
        _ -> { panic("expected an expression function") }
      }
    }
    _ -> { panic("expected a function") }
  }
  diagnostics := validateCheckedTypes(analysis)
  Assert.equal(diagnostics.length, 2)
  Assert.equal(diagnostics[0].message.contains("Missing resolved type for expression identifier"), true)
  Assert.equal(diagnostics[1].message.contains("Missing resolved type for type annotation"), true)
}

export function testCompleteDecorationGateRequiresConstructionAttachments(): void {
  source := "class Widget { value: int\nstatic constructor(value: int): Widget => Widget { value } }\nwidget := Widget { value: 1 }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  case analysis.modules[0].program.statements[1] {
    binding: ImmutableBinding -> {
      case binding.value {
        construct: ConstructExpression -> {
          constructedType := construct.resolvedConstructedType
          construct.resolvedConstructedType = null
          missingType := validateCheckedTypes(analysis)
          Assert.equal(missingType.length, 1)
          Assert.equal(missingType[0].message.contains("Missing resolved type for constructed type"), true)
          construct.resolvedConstructedType = constructedType

          resolvedClass := construct.resolvedClass
          construct.resolvedClass = null
          missingClass := validateCheckedTypes(analysis)
          Assert.equal(missingClass.length, 1)
          Assert.equal(missingClass[0].message.contains("has no resolved class"), true)
          construct.resolvedClass = resolvedClass

          construct.resolvedConstructor = null
          missingConstructor := validateCheckedTypes(analysis)
          Assert.equal(missingConstructor.length, 1)
          Assert.equal(missingConstructor[0].message.contains("has no resolved constructor"), true)
        }
        _ -> { panic("expected a construct expression") }
      }
    }
    _ -> { panic("expected an immutable binding") }
  }
}

export function testCompleteDecorationGateRequiresClassObjectLiteralAttachment(): void {
  source := "class Widget { value: int }\nfunction make(): Widget => { value: 1 }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  case analysis.modules[0].program.statements[1] {
    fn: FunctionDeclaration -> {
      case fn.body {
        expression: Expression -> {
          case expression {
            object: ObjectLiteral -> { object.resolvedClass = null }
            _ -> { panic("expected an object literal") }
          }
        }
        _ -> { panic("expected an expression function") }
      }
    }
    _ -> { panic("expected a function") }
  }
  diagnostics := validateCheckedTypes(analysis)
  Assert.equal(diagnostics.length, 1)
  Assert.equal(diagnostics[0].message.contains("Class object literal has no resolved class"), true)
}

export function testInfersVoidForUnannotatedBlockFunction(): void {
  source := "export function testAll() { println(\"ok\") }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  Assert.equal(validateCheckedTypes(analysis).length, 0)
}

export function testChecksNamedStaticConstructorAndEnumShorthand(): void {
  source := "enum Endian { LittleEndian, BigEndian }\nimport class BlobBuilder from \"native.hpp\" as native::BlobBuilder { static constructor(size: long = 0L, endianness: Endian = .LittleEndian): BlobBuilder }\nfunction build(): void { builder := BlobBuilder{endianness: .BigEndian} }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  Assert.equal(validateCheckedTypes(analysis).length, 0)
}

export function testContextuallyTypesEnumShorthandInBinaryComparisons(): void {
  result := checked("enum Compression { Store, Deflate }\nfunction stored(compression: Compression): bool => compression == .Store\nfunction deflated(compression: Compression): bool => .Deflate == compression")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksBlockBodiedCaseExpressionArms(): void {
  result := checked("function describe(value: int): string => case value { 0 -> { yield \"zero\" } _ -> { if value < 0 { yield \"negative\" }\nyield \"positive\" } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsCaseExpressionBlockThatCanCompleteWithoutYield(): void {
  result := checked("function describe(value: int): string => case value { 0 -> { if value < 0 { yield \"negative\" } } _ -> \"positive\" }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message, "Block case-expression arms must yield a value on every path")
}

export function testContextuallyTypesShorthandArrayMapLambda(): void {
  result := checked("class Item { value: int }\nfunction values(items: Item[]): int[] => items.map(=> it.value)")
  Assert.equal(result.diagnostics.length, 0)
}

export function testInfersWiderCompatibleGenericArgument(): void {
  result := checked("function equal<T>(actual: T, expected: T): void {}\nfunction compare(value: string | null): void { equal(value, \"ok\") }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksBuiltinSourceLocationAndCallerDefaults(): void {
  result := checked("function debug(source: SourceLocation = @caller): string => source.fileName + string(source.line) + source.functionName")
  Assert.equal(result.diagnostics.length, 0)
}

export function testValidatesStaticGenericMethodsWithCallerDefaults(): void {
  source := "class Assert { static equal<T>(actual: T, expected: T, source: SourceLocation = @caller): void { assert(actual == expected, \"equal\") } }\nfunction test(): void { Assert.equal(1, 1) }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  createChecker(analysis).check("/main.do")
  diagnostics := validateCheckedTypes(analysis)
  for diagnostic of diagnostics { println(diagnostic.message) }
  Assert.equal(diagnostics.length, 0)
}

export function testRejectsMissingRequiredPositionalFunctionArguments(): void {
  result := checked("function combine(first: int, second: string, suffix: string = \"!\"): string => string(first) + second + suffix\nvalue := combine(1)")
  Assert.equal(result.diagnostics.length, 1)
  Assert.equal(result.diagnostics[0].message, "Expected 2-3 argument(s) but got 1")
}

export function testValidatesFieldConstructorPositionalArguments(): void {
  missing := checked("class Config { host: string\nport: int = 8080 }\nconfig := Config()")
  Assert.equal(missing.diagnostics.length, 1)
  Assert.equal(missing.diagnostics[0].message, "Class \"Config\" expects 1-2 constructor argument(s) but got 0")

  excess := checked("class Point { x, y: int }\npoint := Point(1, 2, 3)")
  Assert.equal(excess.diagnostics.length, 1)
  Assert.equal(excess.diagnostics[0].message, "Class \"Point\" expects 2 constructor argument(s) but got 3")

  incompatible := checked("class Point { x: int\ny: string }\npoint := Point(1, 2)")
  Assert.equal(incompatible.diagnostics.length, 1)
  Assert.equal(incompatible.diagnostics[0].message, "Argument 2 has type int; expected string")
}

export function testValidatesDedicatedConstructorPositionalArguments(): void {
  missing := checked("class Widget { value: int\nstatic constructor(value: int, label: string = \"widget\"): Widget => Widget { value } }\nwidget := Widget()")
  Assert.equal(missing.diagnostics.length, 1)
  Assert.equal(missing.diagnostics[0].message, "Class \"Widget\" expects 1-2 constructor argument(s) but got 0")

  incompatible := checked("class Widget { value: int\nstatic constructor(value: int): Widget => Widget { value } }\nwidget := Widget(\"bad\")")
  Assert.equal(incompatible.diagnostics.length, 1)
  Assert.equal(incompatible.diagnostics[0].message, "Argument 1 has type string; expected int")
}

export function testChecksSupportedJsonDeserializationSurface(): void {
  result := checked("class Config { name: string\nenabled: bool\ncount: int = 10\nnotes: string | null = null }\nfunction parse(value: JsonValue): Result<Config, string> => Config.fromJsonValue(value)")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksJsonValueAsNarrowingWithDeclarationElse(): void {
  result := checked("function read(raw: JsonValue): string { flag := raw as bool else { return \"bad\" }\nname := raw as string else { return \"bad\" }\nvalues := raw as readonly JsonValue[] else { return \"bad\" }\nreturn name + string(flag) + string(values.length) }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testAcceptsNullableNaturalRepresentationAsNarrowing(): void {
  result := checked("class Config { value: int }\nfunction config(value: Config | null): Result<Config, string> => value as Config\nfunction items(value: int[] | null): Result<int[], string> => value as int[]\nfunction count(value: int | null): Result<int, string> => value as int")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksExpressionResultElseWithFailureCapture(): void {
  result := checked("function save(): Result<void, string> => Success()\nfunction run(): void { save() else error { println(error) } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testAllowsDeclarationElseContinueAndMutableMapInterior(): void {
  result := checked("function run(values: Map<string, JsonValue>, items: JsonValue[]): void { for item of items { text := item as string else { continue }\nvalues[\"name\"] = text } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testAllowsJsonCollectionsAndLenientGeneratedDecode(): void {
  result := checked("class Options { enabled: bool\nname: string }\nfunction run(value: JsonValue, values: Map<string, JsonValue>, items: JsonValue[]): Result<Options, string> { values[\"items\"] = items\nreturn Options.fromJsonValue(value, true) }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testDecoratesPrivateMethodParameterMembers(): void {
  source := "class Option { readonly name: string\nreadonly multiple: bool }\nclass Spec { option(): void {}\nprivate add(option: Option, values: Map<string, JsonValue>): void { if option.multiple { raw := values.get(option.name) else { values[option.name] = []\nreturn }\nvalues[option.name] = raw } } }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  diagnostics := validateCheckedTypes(analysis)
  for diagnostic of diagnostics { println(diagnostic.message) }
  Assert.equal(diagnostics.length, 0)
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

export function testAcceptsLenientJsonDeserialization(): void {
  result := checked("class Config { name: string }\nfunction parse(value: JsonValue): Result<Config, string> => Config.fromJsonValue(value, true)")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksReadonlyArrayLiteralAndReadonlyField(): void {
  result := checked("class Request { readonly headers: int[] }\nfunction use(values: readonly int[]): int => values.length\nfunction main(): int { values := readonly [1, 2]\nrequest := Request { headers: values }\nreturn use(request.headers) }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testContextuallyInfersArrayLiteralReadonlyness(): void {
  result := checked("expectedBuilt: readonly byte[] := [1, 2, 3, 4, 5]")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksByteCastBuiltin(): void {
  result := checked("function carriageReturn(): byte => byte(13)")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksActorCreationSyncAsyncPromiseAndRetire(): void {
  result := checked("class Worker { value: int\nfunction add(amount: int): int { this.value = this.value + amount\nreturn this.value } }\nfunction run(): int { worker: Actor<Worker> := Actor<Worker>(1)\nvalue := worker.add(2)\npromise: Promise<int> := async worker.add(3)\nasyncValue := try! promise.get()\nstate: Worker := retire worker\nreturn value + asyncValue + state.value }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsNonActorAsyncAndRetire(): void {
  asyncResult := checked("function value(): int => 1\npromise := async value()")
  Assert.equal(asyncResult.diagnostics.length > 0, true)
  Assert.equal(asyncResult.diagnostics[0].message.contains("actor method calls"), true)
  retireResult := checked("value := retire 1")
  Assert.equal(retireResult.diagnostics.length > 0, true)
  Assert.equal(retireResult.diagnostics[0].message.contains("Cannot retire non-actor"), true)
}

export function testRejectsSameBindingUseAfterRetireButAllowsShadowing(): void {
  used := checked("class Worker { function value(): int => 1 }\nfunction run(): int { worker := Actor<Worker>()\nretire worker\nreturn worker.value() }")
  Assert.equal(used.diagnostics.length > 0, true)
  Assert.equal(used.diagnostics[0].message.contains("after it has been retired"), true)

  shadowed := checked("class Worker { function value(): int => 1 }\nfunction run(): int { worker := Actor<Worker>()\nretire worker\nif true { worker := Actor<Worker>()\nvalue := worker.value()\nretire worker\nreturn value }\nreturn 0 }")
  Assert.equal(shadowed.diagnostics.length, 0)
}

export function testValidatesActorBoundaryPayloads(): void {
  mutableResult := checked("class Payload { value: int }\nclass Worker { function accept(payload: Payload): void {} }\nworker := Actor<Worker>()\npayload := Payload { value: 1 }\nworker.accept(payload)")
  Assert.equal(mutableResult.diagnostics.length > 0, true)
  Assert.equal(mutableResult.diagnostics[0].message.contains("field \"value\" is mutable"), true)

  readonlyResult := checked("class Payload { readonly value: int }\nclass Worker { function accept(payload: Payload): int => payload.value }\nworker := Actor<Worker>()\npayload := Payload { value: 1 }\nvalue := worker.accept(payload)")
  Assert.equal(readonlyResult.diagnostics.length, 0)
}

export function testValidatesNestedAndGenericActorBoundaryPayloads(): void {
  nested := checked("class Worker { function accept(payload: Payload): void {} }\nclass Payload { readonly actor: Actor<Worker> }\nworker := Actor<Worker>()\npayload := Payload { actor: worker }\nworker.accept(payload)")
  Assert.equal(nested.diagnostics.length > 0, true)
  Assert.equal(nested.diagnostics[0].message.contains("Actor<T> references"), true)

  generic := checked("class Worker { function echo<T>(value: T): T => value }\nworker := Actor<Worker>()\nother := Actor<Worker>()\nresult := worker.echo<Actor<Worker> >(other)")
  Assert.equal(generic.diagnostics.length > 0, true)
  Assert.equal(generic.diagnostics[0].message.contains("Actor<T> references"), true)
}

export function testChecksPromiseVoidGet(): void {
  result := checked("function settle(promise: Promise<void>): Result<void, string> => promise.get()")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksActorAffineCallbackMembers(): void {
  result := checked("function use(callback: (value: int): int): Promise<int> => callback.post(1)\nfunction notify(callback: (value: int): void): void { callback.dispatch(1) }")
  Assert.equal(result.diagnostics.length, 0)
  invalid := checked("function use(callback: (value: int): int): void { callback.dispatch(1) }")
  Assert.equal(invalid.diagnostics.length > 0, true)
  Assert.equal(invalid.diagnostics[0].message.contains("void-returning callbacks"), true)
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

export function testAcceptsReturnsFromExhaustiveResultCase(): void {
  result := checked("function load(): Result<int, string> => Success { value: 1 }\nfunction answer(): Result<int, string> { case load() { success: Success -> { return Success { value: success.value } }, failure: Failure -> { return Failure { error: failure.error } } } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testDecoratesTypedResultArmPatterns(): void {
  source := "function load(): Result<int, string> => Failure { error: \"no\" }\nfunction inspect(): void { case load() { _: Failure<string> -> { } _ -> { } } }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  createChecker(analysis).check("/main.do")
  Assert.equal(validateCheckedTypes(analysis).length, 0)
}

export function testPostfixBangUnwrapsResultSuccessType(): void {
  result := checked("function decode(): Result<string, string> => Success { value: \"ok\" }\nfunction consume(value: string): void {}\nfunction main(): void { consume(decode()!) }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksResultStatusMethods(): void {
  result := checked("function load(): Result<int, string> => Failure { error: \"no\" }\nfunction failed(): bool => load().isFailure()\nfunction succeeded(): bool => load().isSuccess()")
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

export function testChecksClassDestructorBody(): void {
  result := checked("class Resource { function close(): void {}\ndestructor { close() } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsStructDestructor(): void {
  result := checked("struct Resource { destructor {} }")
  Assert.equal(result.diagnostics.length, 1)
  Assert.equal(result.diagnostics[0].message, "Struct \"Resource\" cannot declare a destructor")
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

export function testChecksTryValueDeclarations(): void {
  result := checked("function load(): Result<int, string> => Success { value: 1 }\nfunction run(): Result<int, string> { try const first = load()\ntry readonly second = load()\ntry let third = load()\nthird = third + first\nreturn Success { value: third + second } }")
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

export function testChecksContextualResultAndClassObjectLiterals(): void {
  result := checked("class Payload { count: int }\nenum LoadError { Missing }\nfunction load(ok: bool): Result<Payload, LoadError> { if !ok { return { error: .Missing } }\nreturn { value: { count: 4 } } }")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
}

export function testCollapsesDuplicateUnionMembers(): void {
  result := checked("function choose(value: string | string): string => value")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
}
