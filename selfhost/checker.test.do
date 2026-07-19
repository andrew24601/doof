import { Assert } from "std/assert"
import { createAnalyzer } from "./analyzer"
import { createChecker, validateCheckedTypes } from "./checker"
import { CheckResult, Diagnostic, SourceFile } from "./semantic"
import { AsExpression, AssignmentExpression, Block, ClassDeclaration, ConstructExpression, Expression, ExpressionStatement, Identifier, IfStatement, FunctionDeclaration, ImmutableBinding, LetDeclaration, ObjectLiteral, ReadonlyDeclaration, WithStatement } from "./ast"
import { typeName, unknownType } from "./checker-types"

function checked(source: string): CheckResult {
  sources := [SourceFile { path: "/main.do", source }]
  analysis := createAnalyzer(sources).analyze("/main.do")
  checker := createChecker(analysis)
  semantic := checker.check("/main.do")
  return CheckResult { diagnostics: semantic.diagnostics }
}

function checkedSources(sources: SourceFile[], entry: string): CheckResult {
  analysis := createAnalyzer(sources).analyze(entry)
  checker := createChecker(analysis)
  let diagnostics: Diagnostic[] = []
  for i of 0..<analysis.modules.length {
    module := analysis.modules[analysis.modules.length - 1 - i]
    checkedModule := checker.check(module.path)
    for diagnostic of checkedModule.diagnostics { diagnostics.push(diagnostic) }
  }
  return CheckResult { diagnostics }
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

export function testChecksWeakTypesAndStructRestrictions(): void {
  source := "class Node { weak parent: Node\nancestor: weak Node }\nfunction keep(value: weak Node): weak Node => value"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  semantic := createChecker(analysis).check("/main.do")
  Assert.equal(semantic.diagnostics.length, 0)
  case analysis.modules[0].program.statements[0] {
    class_: ClassDeclaration -> {
      Assert.equal(typeName(class_.fields[0].resolvedType ?? unknownType()), "Node")
      Assert.equal(typeName(class_.fields[1].resolvedType ?? unknownType()), "weak Node")
    }
    _ -> { panic("expected class") }
  }

  invalid := checked("class Node {}\nstruct Links { weak parent: Node\nancestor: weak Node }")
  Assert.equal(invalid.diagnostics.length, 2)
  Assert.equal(invalid.diagnostics[0].message.contains("cannot be weak"), true)
  Assert.equal(invalid.diagnostics[1].message.contains("cannot be weak"), true)
}

export function testRejectsGeneratedJsonForWeakFields(): void {
  modifier := checked("class Node { weak parent: Node }\nfunction encode(value: Node): JsonValue => value.toJsonObject()")
  Assert.equal(modifier.diagnostics.length > 0, true)
  Assert.equal(modifier.diagnostics[0].message.contains("does not support automatic JSON serialization"), true)

  qualifier := checked("class Node { parent: weak Node }\nfunction encode(value: Node): JsonValue => value.toJsonObject()")
  Assert.equal(qualifier.diagnostics.length > 0, true)
  Assert.equal(qualifier.diagnostics[0].message.contains("does not support automatic JSON serialization"), true)
}

export function testChecksArrayAndStringSearchMembers(): void {
  result := checked("function main(): int { values := [1, 2, 3]\ntext := \"hello\"\nif values.contains(2) && text.contains(\"ell\") { return values.indexOf(3) + text.indexOf(\"e\") }\nreturn 0 }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksRangeValuesSignaturesAndMembers(): void {
  result := checked("function first(values: Range): int { for value of values { return value }\nreturn values.lowerBound + values.upperBound }\nfunction main(): int => first(1..<4)")
  Assert.equal(result.diagnostics.length, 0)
}

export function testResolvesImportedRangeSignatures(): void {
  result := checkedSources([
    SourceFile { path: "/main.do", source: "import { first } from \"./range\"\nfunction main(): int => first(1..3)" },
    SourceFile { path: "/range.do", source: "export function first(values: int | Range): int => 1" },
  ], "/main.do")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsUnsupportedRangeBounds(): void {
  result := checked("function main(): void { floatRange := 1.0..3.0\nlongRange := 1L..<3L }")
  Assert.equal(result.diagnostics.length, 4)
  Assert.equal(result.diagnostics[0].message.contains("requires integer bounds"), true)
  Assert.equal(result.diagnostics[2].message.contains("currently requires int-compatible bounds"), true)
}

export function testChecksFiniteAndOpenEndedCaseRangePatterns(): void {
  result := checked("function category(value: int): string => case value { ..<0 -> \"negative\", 0..<10 -> \"small\", 10..20 -> \"medium\", 21.. -> \"large\" }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testArrayPopReturnsResult(): void {
  valid := checked("function take(values: int[]): Result<int, string> => values.pop()")
  Assert.equal(valid.diagnostics.length, 0)

  ignored := checked("function take(values: int[]): void { values.pop() }")
  Assert.equal(ignored.diagnostics.length, 1)
  Assert.equal(ignored.diagnostics[0].message.contains("Result value must be handled"), true)
}

export function testDecoratesArrayCloneMutableAndEnumLookupHelpers(): void {
  source := "enum Suit { Spades = 0, Hearts = 1 }\nclass Pile { cardIndices: int[] = [] }\nfunction clonePile(pile: Pile): Pile { return Pile { cardIndices: pile.cardIndices.cloneMutable() } }\nfunction foundationSuit(index: int): Suit { return Suit.fromValue(index) ?? .Spades }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  diagnostics := validateCheckedTypes(analysis)
  for diagnostic of diagnostics { println(diagnostic.message) }
  Assert.equal(diagnostics.length, 0)
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
  result := checked("class Handler { callback: (value: int): void }\nfunction parse(value: JsonValue): Result<Handler, string> => Handler.fromJsonValue(value)")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message, "Type \"Handler\" does not support automatic JSON deserialization")
}

export function testRejectsJsonMethodsForNestedUnsupportedFields(): void {
  decode := checked("class Handler { callback: (value: int): void }\nclass Envelope { handler: Handler }\nfunction parse(value: JsonValue): Result<Envelope, string> => Envelope.fromJsonValue(value)")
  Assert.equal(decode.diagnostics.length > 0, true)
  Assert.equal(decode.diagnostics[0].message, "Type \"Envelope\" does not support automatic JSON deserialization")

  encode := checked("class Handler { callback: (value: int): void }\nclass Envelope { handler: Handler }\nfunction write(value: Envelope): JsonObject => value.toJsonObject()")
  Assert.equal(encode.diagnostics.length > 0, true)
  Assert.equal(encode.diagnostics[0].message, "Type \"Envelope\" does not support automatic JSON serialization")
}

export function testChecksContextualNumericLiteralAssignments(): void {
  result := checked("function update(): double { let value: double = 1.0\nvalue = 2\nreturn value }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksRecursiveAutomaticJsonTypes(): void {
  source := "enum Kind { One, Two }\nclass Point { x: double\ny: double }\nclass Payload { kind: Kind\nids: int[]\npoints: Point[]\nselected: Point | null = null }\nfunction encode(value: Payload): JsonObject => value.toJsonObject()\nfunction decode(value: JsonValue): Result<Payload, string> => Payload.fromJsonValue(value)"
  result := checked(source)
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksTupleAutomaticJsonTypes(): void {
  source := "class Point { x: int\ny: int }\nclass Payload { pair: Tuple<string, int>\npoint: Tuple<Point, bool>\noptional: Tuple<int, string> | null = null }\nfunction encode(value: Payload): JsonObject => value.toJsonObject()\nfunction decode(value: JsonValue): Result<Payload, string> => Payload.fromJsonValue(value)"
  result := checked(source)
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksStringMapAutomaticJsonTypes(): void {
  source := "class Point { x: int\ny: int }\nclass Payload { counts: Map<string, int>\npoints: Map<string, Point> }\nfunction encode(value: Payload): JsonObject => value.toJsonObject()\nfunction decode(value: JsonValue): Result<Payload, string> => Payload.fromJsonValue(value)"
  result := checked(source)
  Assert.equal(result.diagnostics.length, 0)

  invalid := checked("class Payload { values: Map<int, string> }\nfunction decode(value: JsonValue): Result<Payload, string> => Payload.fromJsonValue(value)")
  Assert.equal(invalid.diagnostics.length > 0, true)
  Assert.equal(invalid.diagnostics[0].message, "Type \"Payload\" does not support automatic JSON deserialization")
}

export function testChecksDiscriminatedInterfaceJsonDeserialization(): void {
  valid := checked("interface Shape { area(): double }\nclass Circle implements Shape { const kind = \"circle\"\nradius: double\narea(): double => radius * radius }\nclass Rect implements Shape { const kind = \"rect\"\nwidth: double\nheight: double\narea(): double => width * height }\nfunction decode(value: JsonValue): Result<Shape, string> => Shape.fromJsonValue(value, true)")
  Assert.equal(valid.diagnostics.length, 0)

  invalid := checked("interface Shape { area(): double }\nclass Circle implements Shape { radius: double\narea(): double => radius * radius }\nclass Rect implements Shape { width: double\narea(): double => width }\nfunction decode(value: JsonValue): Result<Shape, string> => Shape.fromJsonValue(value)")
  Assert.equal(invalid.diagnostics.length > 0, true)
  Assert.stringContains(invalid.diagnostics[0].message, "must share a const string field with distinct values")

  duplicate := checked("interface Shape { area(): double }\nclass Circle implements Shape { const kind = \"shape\"\nradius: double\narea(): double => radius }\nclass Rect implements Shape { const kind = \"shape\"\nwidth: double\narea(): double => width }\nfunction decode(value: JsonValue): Result<Shape, string> => Shape.fromJsonValue(value)")
  Assert.equal(duplicate.diagnostics.length > 0, true)
  Assert.stringContains(duplicate.diagnostics[0].message, "distinct values")
}

export function testAcceptsLenientJsonDeserialization(): void {
  result := checked("class Config { name: string }\nfunction parse(value: JsonValue): Result<Config, string> => Config.fromJsonValue(value, true)")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksMetadataSchemaAndInvokeSurface(): void {
  result := checked("class Tool \"A tool.\" { function run \"Runs.\"(input \"Payload.\": string): string => input }\nmetadata := Tool.metadata\nname := metadata.name\nmethods := metadata.methods\ninvoked := metadata.invoke(Tool {}, \"run\", { input: \"ok\" })\nmethodInvoked := methods[0].invoke(Tool {}, { input: \"ok\" })")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksMetadataOnReflectableTypeParameter(): void {
  result := checked("function describe<T: Reflectable>(tool: T): string => T.metadata.name")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsMetadataOnUnconstrainedTypeParameter(): void {
  result := checked("function describe<T>(tool: T): string => T.metadata.name")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message.contains("constrained by Reflectable"), true)
}

export function testRejectsNonClassReflectableTypeArgument(): void {
  result := checked("function describe<T: Reflectable>(tool: T): string => T.metadata.name\nname := describe<int>(1)")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message.contains("does not satisfy constraint \"Reflectable\""), true)
}

export function testEnforcesOrdinaryGenericFunctionConstraints(): void {
  valid := checked("function keep<T: int | long>(value: T): T => value\nfirst := keep<int>(1)\nsecond := keep(2L)")
  Assert.equal(valid.diagnostics.length, 0)

  explicitInvalid := checked("function keep<T: int | long>(value: T): T => value\nvalue := keep<string>(\"no\")")
  Assert.equal(explicitInvalid.diagnostics.length, 1)
  Assert.equal(explicitInvalid.diagnostics[0].message.contains("does not satisfy constraint \"int | long\""), true)

  inferredInvalid := checked("function keep<T: int | long>(value: T): T => value\nvalue := keep(\"no\")")
  Assert.equal(inferredInvalid.diagnostics.length, 1)
  Assert.equal(inferredInvalid.diagnostics[0].message.contains("does not satisfy constraint \"int | long\""), true)
}

export function testEnforcesOrdinaryGenericNominalAndAliasConstraints(): void {
  valid := checked("class Box<T: int | long> { value: T }\ntype NumberBox<T: int | long> = Box<T>\nbox: NumberBox<long> := Box<long> { value: 1L }\ninferred := Box(1)")
  Assert.equal(valid.diagnostics.length, 0)

  invalidClass := checked("class Box<T: int | long> { value: T }\nbox := Box<string> { value: \"no\" }")
  Assert.equal(invalidClass.diagnostics.length > 0, true)
  Assert.equal(invalidClass.diagnostics[0].message.contains("does not satisfy constraint \"int | long\""), true)

  inferredInvalidClass := checked("class Box<T: int | long> { value: T }\nbox := Box(\"no\")")
  Assert.equal(inferredInvalidClass.diagnostics.length > 0, true)
  Assert.equal(inferredInvalidClass.diagnostics[0].message.contains("does not satisfy constraint \"int | long\""), true)

  invalidAlias := checked("type Numeric<T: int | long> = T\nvalue: Numeric<string> := \"no\"")
  Assert.equal(invalidAlias.diagnostics.length > 0, true)
  Assert.equal(invalidAlias.diagnostics[0].message.contains("does not satisfy constraint \"int | long\""), true)
}

export function testEnforcesImportedOrdinaryGenericConstraints(): void {
  result := checkedSources([
    SourceFile { path: "/main.do", source: "import { keep } from \"./numbers\"\nvalue := keep(\"no\")" },
    SourceFile { path: "/numbers.do", source: "export function keep<T: int | long>(value: T): T => value" },
  ], "/main.do")
  Assert.equal(result.diagnostics.length, 1)
  Assert.equal(result.diagnostics[0].message.contains("does not satisfy constraint \"int | long\""), true)
}

export function testRejectsMetadataForNonSerializableMethods(): void {
  result := checked("class Bad { function run(callback: (value: int): void): string => \"no\" }\nmetadata := Bad.metadata")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message.contains("not JSON-serializable"), true)
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

  mutableSet := checked("class Worker { function accept(values: Set<int>): void {} }\nworker := Actor<Worker>()\nvalues: Set<int> := [1]\nworker.accept(values)")
  Assert.equal(mutableSet.diagnostics.length > 0, true)
  Assert.equal(mutableSet.diagnostics[0].message.contains("set type \"Set<int>\" is mutable"), true)

  readonlySet := checked("class Worker { function accept(values: ReadonlySet<int>): int => values.size }\nworker := Actor<Worker>()\nvalues: Set<int> := [1]\nfrozen := values.buildReadonly()\nvalue := worker.accept(frozen)")
  Assert.equal(readonlySet.diagnostics.length, 0)
}

export function testValidatesNestedAndGenericActorBoundaryPayloads(): void {
  nested := checked("class Worker { function accept(payload: Payload): void {} }\nclass Payload { readonly actor: Actor<Worker> }\nworker := Actor<Worker>()\npayload := Payload { actor: worker }\nworker.accept(payload)")
  Assert.equal(nested.diagnostics.length > 0, true)
  Assert.equal(nested.diagnostics[0].message.contains("Actor<T> references"), true)

  generic := checked("class Worker { function echo<T>(value: T): T => value }\nworker := Actor<Worker>()\nother := Actor<Worker>()\nresult := worker.echo<Actor<Worker> >(other)")
  Assert.equal(generic.diagnostics.length > 0, true)
  Assert.equal(generic.diagnostics[0].message.contains("Actor<T> references"), true)
}

export function testRejectsActorMethodsThatAccessMutableModuleState(): void {
  result := checked("shared := [0]\nclass Worker { function run(): void { shared.push(1) } }\nfunction main(): void { worker := Actor<Worker>()\nworker.run() }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message.contains("Actor method \"run\" is not isolated"), true)
  Assert.equal(result.diagnostics[0].message.contains("mutable module binding \"shared\""), true)
}

export function testEnforcesExplicitIsolationTransitively(): void {
  result := checked("shared := [0]\nfunction mutate(): void { shared.push(1) }\nisolated function run(): void { mutate() }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message.contains("Isolated function \"run\" cannot call non-isolated function \"mutate\""), true)
}

export function testAllowsActorMethodsToCallIsolatedNativeMethodContracts(): void {
  result := checked("import class NativeProcess from \"native_process.hpp\" { isolated static run(): int }\nclass Worker { function compile(): int => NativeProcess.run() }\nfunction main(): void { worker := Actor<Worker>()\nworker.compile() }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testAllowsActorMethodsToCallIsolatedNativeFunctionContracts(): void {
  result := checked("import isolated function nativeRun(): int from \"native.hpp\"\nclass Worker { function run(): int => nativeRun() }\nfunction main(): void { worker := Actor<Worker>()\nworker.run() }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsActorMethodsThatCallNativeFunctionsWithoutIsolatedContracts(): void {
  result := checked("import function nativeRun(): int from \"native.hpp\"\nclass Worker { function run(): int => nativeRun() }\nfunction main(): void { worker := Actor<Worker>()\nworker.run() }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message.contains("Actor method \"run\" is not isolated"), true)
  Assert.equal(result.diagnostics[0].message.contains("non-isolated function \"nativeRun\""), true)
}

export function testRejectsActorMethodsThatTransitivelyAccessImportedMutableState(): void {
  result := checkedSources([
    SourceFile { path: "/main.do", source: "import { mutate } from \"./state\"\nclass Worker { function run(): void { mutate() } }\nfunction main(): void { worker := Actor<Worker>()\nworker.run() }" },
    SourceFile { path: "/state.do", source: "values := [0]\nexport function mutate(): void { values.push(1) }" },
  ], "/main.do")
  Assert.equal(result.diagnostics.length > 0, true)
  let found = false
  for diagnostic of result.diagnostics {
    if diagnostic.message.contains("Actor method \"run\" is not isolated") && diagnostic.message.contains("non-isolated function \"mutate\"") { found = true }
  }
  Assert.equal(found, true)
}

export function testAllowsActorLocalMutationAndRecursiveIsolatedCalls(): void {
  result := checked("readonly SCALE = 2\nfunction multiply(value: int): int => value * SCALE\nclass Worker { value: int\nfunction step(remaining: int): void { if remaining <= 0 { return }\nthis.value = multiply(this.value)\nstep(remaining - 1) } }\nfunction main(): void { worker := Actor<Worker>(1)\nworker.step(3) }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testRejectsMutableActorConstructionArguments(): void {
  result := checked("class Payload { value: int }\nclass Worker { payload: Payload }\nfunction main(): void { payload := Payload { value: 1 }\nworker := Actor<Worker>(payload) }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message.contains("Actor constructor argument 1"), true)
  Assert.equal(result.diagnostics[0].message.contains("field \"value\" is mutable"), true)
}

export function testRejectsActorDefaultsThatCaptureMutableModuleState(): void {
  result := checked("shared := [0]\nclass Worker { values: int[] = shared }\nfunction main(): void { worker := Actor<Worker>() }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message.contains("Actor<Worker> construction is not isolated"), true)
  Assert.equal(result.diagnostics[0].message.contains("mutable module binding \"shared\""), true)
}

export function testReadonlyInterfaceFieldsRequireReadonlyImplementations(): void {
  result := checked("interface Payload { readonly value: int }\nclass MutablePayload implements Payload { value: int }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message.contains("does not satisfy interface \"Payload\""), true)
}

export function testRejectsMutableStaticStateReachedFromActorMethods(): void {
  result := checked("class Globals { static count: int = 0 }\nclass Worker { function run(): void { Globals.count = Globals.count + 1 } }\nfunction main(): void { worker := Actor<Worker>()\nworker.run() }")
  Assert.equal(result.diagnostics.length > 0, true)
  let found = false
  for diagnostic of result.diagnostics { if diagnostic.message.contains("mutable static field \"Globals.count\"") { found = true } }
  Assert.equal(found, true)
}

export function testPropagatesIsolationThroughInterfaceDispatch(): void {
  source := "shared := [0]\ninterface Job { run(): void }\nclass UnsafeJob implements Job { function run(): void { shared.push(1) } }\nclass Worker { job: Job = UnsafeJob {}\nfunction execute(): void { this.job.run() } }\nfunction main(): void { worker := Actor<Worker>()\nworker.execute() }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  semantic := createChecker(analysis).check("/main.do")
  let unsafeFound = false
  let workerFound = false
  for statement of analysis.modules[0].program.statements {
    case statement {
      class_: ClassDeclaration -> {
        if class_.name == "UnsafeJob" { unsafeFound = true; Assert.equal(class_.methods[0].resolvedIsolated, false) }
        if class_.name == "Worker" { workerFound = true; Assert.equal(class_.methods[0].resolvedIsolated, false) }
      }
      _ -> { }
    }
  }
  Assert.equal(unsafeFound, true)
  Assert.equal(workerFound, true)
  result := CheckResult { diagnostics: semantic.diagnostics }
  Assert.equal(result.diagnostics.length > 0, true)
  let found = false
  for diagnostic of result.diagnostics {
    if diagnostic.message.contains("Actor method \"execute\" is not isolated") && diagnostic.message.contains("non-isolated function \"run\"") { found = true }
  }
  Assert.equal(found, true)
}

export function testRejectsMutableImplementationsWidenedToBoundaryInterfaces(): void {
  result := checked("interface Payload { readonly id: int }\nclass MutablePayload implements Payload { readonly id: int\nvalue: int }\nclass Worker { function accept(payload: Payload): void {} }\nfunction main(): void { worker := Actor<Worker>()\npayload: Payload := MutablePayload { id: 1, value: 2 }\nworker.accept(payload) }")
  Assert.equal(result.diagnostics.length > 0, true)
  let found = false
  for diagnostic of result.diagnostics {
    if diagnostic.message.contains("implementation \"MutablePayload\"") && diagnostic.message.contains("field \"value\" is mutable") { found = true }
  }
  Assert.equal(found, true)
}

export function testRequiresActorConstructorFactoriesToBeIsolated(): void {
  result := checked("shared := [0]\nclass Worker { values: int[]\nstatic constructor(): Worker => Worker { values: shared } }\nfunction main(): void { worker := Actor<Worker>() }")
  Assert.equal(result.diagnostics.length > 0, true)
  let found = false
  for diagnostic of result.diagnostics {
    if diagnostic.message.contains("Actor<Worker> construction is not isolated") && diagnostic.message.contains("non-isolated function \"constructor\"") { found = true }
  }
  Assert.equal(found, true)
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

export function testChecksDeclarationElseNarrowsOneLayerAtATime(): void {
  result := checked("function load(): Result<int, string> | null => null\nfunction main(): int { result := load() else { return 1 }\nvalue := result else { return 2 }\nreturn value }")
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

export function testChecksResultUnwrapOrFallback(): void {
  result := checked("function load(): Result<JsonValue, string> => Failure { error: \"no\" }\nfunction value(): JsonValue => load().unwrapOr(null)")
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

export function testChecksEmptyMapsWithNonStringKeyTypes(): void {
  result := checked("class State { glyphs: Map<int, string> = {} }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksStringCompoundAssignmentFromChar(): void {
  result := checked("function main(): string { let value = \"\"\nvalue += 'x'\nreturn value + 'y' }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testResolvesImportedReadonlyValueTypes(): void {
  result := checkedSources([
    SourceFile { path: "/constants.do", source: "export readonly TAU = 6.283185307179586" },
    SourceFile { path: "/main.do", source: "import { TAU } from \"./constants\"\nfunction scale(value: double): double => value * TAU" },
  ], "/main.do")
  Assert.equal(result.diagnostics.length, 0)
}

export function testAssignsJsonValueNullableUnions(): void {
  result := checked("function wrap(value: JsonValue): JsonValue | null { return value }\nfunction keep(value: JsonValue | null): JsonValue | null { let current: JsonValue | null = value\ncurrent = value\nreturn current }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testResolvesMapKeyAndValueArrays(): void {
  result := checked("function main(): int { values: Map<int, string> = {}\nreturn values.keys().length + values.values().length }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksSetAndReadonlySetMembers(): void {
  result := checked("enum Flag { One, Two }\nfunction bytes(values: Set<byte>): int => values.size\nfunction count(values: ReadonlySet<Flag>): int { let total = 0\nfor value of values { if values.has(value) { total = total + 1 } }\nreturn total + values.values().length }\nfunction main(): int { let values: Set<Flag> = [Flag.One, Flag.Two, Flag.One]\nvalues.add(Flag.Two)\nvalues.delete(Flag.One)\nfrozen := values.buildReadonly()\ncopy := frozen.cloneMutable()\ncopy.add(Flag.One)\nreturn count(frozen) + copy.size }")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
}

export function testInfersOmittedCollectionTypeArgumentsFromLiterals(): void {
  source := "numbers: Set := [1, 2, 3]\nfrozen: ReadonlySet := [1, 2, 3]\nqualified: readonly Set := [1, 2, 3]\nlet reboundable: readonly Set = [1, 2, 3]\nreadonly deep: Set = [1, 2, 3]\nscores: Map := { \"Ada\": 10, \"Grace\": 20 }\nfrozenScores: readonly Map := { \"Ada\": 10 }\nreadonly deepScores: Map = { \"Ada\": 10 }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  semantic := createChecker(analysis).check("/main.do")
  for diagnostic of semantic.diagnostics { println(diagnostic.message) }
  Assert.equal(semantic.diagnostics.length, 0)

  case analysis.modules[0].program.statements[0] {
    binding: ImmutableBinding -> { Assert.equal(typeName(binding.resolvedType ?? unknownType()), "Set<int>") }
    _ -> { panic("expected an immutable binding") }
  }
  case analysis.modules[0].program.statements[1] {
    binding: ImmutableBinding -> { Assert.equal(typeName(binding.resolvedType ?? unknownType()), "ReadonlySet<int>") }
    _ -> { panic("expected an immutable binding") }
  }
  case analysis.modules[0].program.statements[2] {
    binding: ImmutableBinding -> { Assert.equal(typeName(binding.resolvedType ?? unknownType()), "ReadonlySet<int>") }
    _ -> { panic("expected an immutable binding") }
  }
  case analysis.modules[0].program.statements[3] {
    binding: LetDeclaration -> { Assert.equal(typeName(binding.resolvedType ?? unknownType()), "ReadonlySet<int>") }
    _ -> { panic("expected a let binding") }
  }
  case analysis.modules[0].program.statements[4] {
    binding: ReadonlyDeclaration -> { Assert.equal(typeName(binding.resolvedType ?? unknownType()), "ReadonlySet<int>") }
    _ -> { panic("expected a readonly binding") }
  }
  case analysis.modules[0].program.statements[5] {
    binding: ImmutableBinding -> { Assert.equal(typeName(binding.resolvedType ?? unknownType()), "Map<string, int>") }
    _ -> { panic("expected an immutable binding") }
  }
  case analysis.modules[0].program.statements[6] {
    binding: ImmutableBinding -> { Assert.equal(typeName(binding.resolvedType ?? unknownType()), "readonly Map<string, int>") }
    _ -> { panic("expected an immutable binding") }
  }
  case analysis.modules[0].program.statements[7] {
    binding: ReadonlyDeclaration -> { Assert.equal(typeName(binding.resolvedType ?? unknownType()), "readonly Map<string, int>") }
    _ -> { panic("expected a readonly binding") }
  }
}

export function testChecksDotShorthandEnumMapKeysInFieldDefaults(): void {
  result := checked("enum Suit { Spades, Hearts }\nclass Pile {}\nclass State { foundations: Map<Suit, Pile> = { .Spades: Pile {}, .Hearts: Pile {} } }")
  Assert.equal(result.diagnostics.length, 0)
}

export function testChecksAndInfersIntegerMapKeys(): void {
  annotated := checked("ints: Map<int, string> := { 1: \"one\", 2: \"two\" }\nlongs: Map<long, string> := { 1L: \"one\", 2L: \"two\" }")
  Assert.equal(annotated.diagnostics.length, 0)

  source := "inferred: Map := { 1: \"one\", 2: \"two\" }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  semantic := createChecker(analysis).check("/main.do")
  Assert.equal(semantic.diagnostics.length, 0)
  case analysis.modules[0].program.statements[0] {
    binding: ImmutableBinding -> { Assert.equal(typeName(binding.resolvedType ?? unknownType()), "Map<int, string>") }
    _ -> { panic("expected an immutable binding") }
  }
}

export function testRejectsInvalidOmittedCollectionInferenceSites(): void {
  emptySet := checked("values: Set := []")
  Assert.equal(emptySet.diagnostics.length > 0, true)
  Assert.equal(emptySet.diagnostics[0].message.contains("empty set literal"), true)

  mixedSet := checked("values: Set := [1, \"two\"]")
  Assert.equal(mixedSet.diagnostics.length > 0, true)
  Assert.equal(mixedSet.diagnostics[0].message.contains("heterogeneous set elements"), true)

  wrongLiteral := checked("values: Set := { \"one\": 1 }")
  Assert.equal(wrongLiteral.diagnostics.length > 0, true)
  Assert.equal(wrongLiteral.diagnostics[0].message.contains("same-site non-empty set literal"), true)

  emptyMap := checked("values: Map := {}")
  Assert.equal(emptyMap.diagnostics.length > 0, true)
  Assert.equal(emptyMap.diagnostics[0].message.contains("empty map literal"), true)
}

export function testRejectsReadonlySetMutation(): void {
  result := checked("function mutate(values: ReadonlySet<int>): void { values.add(1)\nvalues.delete(1)\nvalues.buildReadonly() }")
  Assert.equal(result.diagnostics.length >= 3, true)
  let add = false
  let delete = false
  let build = false
  for diagnostic of result.diagnostics {
    if diagnostic.message.contains("Method \"add\" is not available on readonly set") { add = true }
    if diagnostic.message.contains("Method \"delete\" is not available on readonly set") { delete = true }
    if diagnostic.message.contains("Method \"buildReadonly\" is not available on readonly set") { build = true }
  }
  Assert.equal(add, true)
  Assert.equal(delete, true)
  Assert.equal(build, true)
}

export function testRejectsUnsupportedSetElementTypes(): void {
  numeric := checked("function use(values: Set<float>): void {}")
  Assert.equal(numeric.diagnostics.length > 0, true)
  Assert.equal(numeric.diagnostics[0].message.contains("Set element type \"float\" is not supported"), true)

  nominal := checked("class Item {}\nfunction use(values: ReadonlySet<Item>): void {}")
  Assert.equal(nominal.diagnostics.length > 0, true)
  Assert.equal(nominal.diagnostics[0].message.contains("Set element type \"Item\" is not supported"), true)
}

export function testKeepsSetMutabilityInvariant(): void {
  result := checked("function bad(values: Set<int>): ReadonlySet<int> { return values }")
  Assert.equal(result.diagnostics.length > 0, true)
  Assert.equal(result.diagnostics[0].message.contains("Cannot return Set<int> from function returning ReadonlySet<int>"), true)
}

export function testChecksYieldBlockDeclarationsAndReassignment(): void {
  valid := checked("function main(): int { let score: int <- { if true { yield 10 } else { yield 5 } }\nscore <- { yield score + 1 }\nreturn score }")
  for diagnostic of valid.diagnostics { println(diagnostic.message) }
  Assert.equal(valid.diagnostics.length, 0)

  missingYield := checked("function main(): int { let score <- { if true { yield 10 } }\nreturn score }")
  Assert.equal(missingYield.diagnostics.length > 0, true)
  Assert.equal(missingYield.diagnostics[0].message.contains("must yield a value on every path"), true)

  immutable := checked("function main(): int { value := 1\nvalue <- { yield 2 }\nreturn value }")
  Assert.equal(immutable.diagnostics.length > 0, true)
  Assert.equal(immutable.diagnostics[0].message.contains("immutable"), true)

  global := checked("readonly value <- { yield 1 }")
  Assert.equal(global.diagnostics.length > 0, true)
  Assert.equal(global.diagnostics[0].message.contains("local declarations"), true)

  prohibited := checked("function load(): Result<int, string> => Success { value: 1 }\nfunction main(): int { let value <- { try load()\nyield 1 }\nreturn value }")
  Assert.equal(prohibited.diagnostics.length > 0, true)
  Assert.equal(prohibited.diagnostics[0].message.contains("'try' cannot be used inside a value-producing block"), true)
}

export function testChecksCatchExpressionErrorUnionsAndNesting(): void {
  valid := checked("enum ReadError { Missing }\nenum ParseError { Invalid }\nfunction read(): Result<int, ReadError> => Failure { error: .Missing }\nfunction parse(): Result<int, ParseError> => Failure { error: .Invalid }\nfunction main(): void { error := catch { try read()\ninner := catch { try parse() } }\ncase error { _: ReadError -> println(\"read\"), _ -> println(\"ok\") } }")
  for diagnostic of valid.diagnostics { println(diagnostic.message) }
  Assert.equal(valid.diagnostics.length, 0)

  warning := checked("function main(): void { error := catch { println(\"ok\") } }")
  Assert.equal(warning.diagnostics.length, 1)
  Assert.equal(warning.diagnostics[0].severity, "warning")
  Assert.equal(warning.diagnostics[0].message.contains("contains no 'try'"), true)
}

export function testChecksDestructuringDeclarationsAndAssignments(): void {
  valid := checked("class Person { name: string\nage: int }\nstruct Pair { left: int\nright: string }\nfunction main(): int { values := [1, 2, 3]\n[first, _, third] := values\nperson := Person { name: \"Ada\", age: 37 }\n{ name as displayName, age } := person\npair := Pair { left: 4, right: \"ok\" }\n(left, right) := pair\nlet target = 0\n[target, _] = values\nlet renamed = \"\"\n{ name as renamed } = person\nreturn first + third + age + left + target + displayName.length + right.length + renamed.length }")
  for diagnostic of valid.diagnostics { println(diagnostic.message) }
  Assert.equal(valid.diagnostics.length, 0)
}

export function testRejectsInvalidDestructuringAssignmentsAndShapes(): void {
  immutable := checked("function main(): void { value := 0\n(value, _) = (1, 2) }")
  Assert.equal(immutable.diagnostics.length > 0, true)
  Assert.equal(immutable.diagnostics[0].message.contains("immutable"), true)

  missing := checked("function main(): void { (missing, _) = (1, 2) }")
  Assert.equal(missing.diagnostics.length > 0, true)
  Assert.equal(missing.diagnostics[0].message.contains("not defined"), true)

  incompatible := checked("function main(): void { let value = \"\"\n(value, _) = (1, 2) }")
  Assert.equal(incompatible.diagnostics.length > 0, true)
  Assert.equal(incompatible.diagnostics[0].message.contains("Cannot assign"), true)

  nonArray := checked("function main(): void { [value] := 1 }")
  Assert.equal(nonArray.diagnostics.length > 0, true)
  Assert.equal(nonArray.diagnostics[0].message.contains("Array destructuring requires"), true)

  tooShort := checked("class One { value: int }\nfunction main(): void { (first, second) := One { value: 1 } }")
  Assert.equal(tooShort.diagnostics.length > 0, true)
  Assert.equal(tooShort.diagnostics[0].message.contains("expected at least 2"), true)
}

export function testChecksTryDestructuringAgainstSuccessPayload(): void {
  result := checked("class Person { name: string\nage: int }\nfunction load(): Result<Person, string> => Success { value: Person { name: \"Ada\", age: 37 } }\nfunction run(): Result<int, string> { try { name, age } := load()\nreturn Success { value: name.length + age } }")
  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
}
