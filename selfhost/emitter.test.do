import { Assert } from "std/assert"
import { createAnalyzer } from "./analyzer"
import { createChecker } from "./checker"
import { AnalysisResult } from "./analyzer"
import { ConstructExpression, ImmutableBinding, Program } from "./ast"
import { SourceFile } from "./semantic"
import { ModuleEmission, emitModule, emitModuleGraph, ModuleGraphPlan, planModuleGraph } from "./emitter-module"
import { ModuleNamespaceMapping, configureModuleNamespaces } from "./emitter-names"

function emit(source: string): ModuleEmission {
  return emitSources([SourceFile { path: "/main.do", source }], "/main.do")
}

function emitSources(sources: SourceFile[], entry: string): ModuleEmission {
  analysis := createAnalyzer(sources).analyze(entry)
  Assert.equal(analysis.diagnostics.length, 0)
  checked := createChecker(analysis).check("/main.do")
  Assert.equal(checked.diagnostics.length, 0)
  program := findProgram(analysis, entry)
  return emitModule(program!, "main")
}

function emitMonomorphized(source: string): ModuleEmission {
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(analysis.diagnostics.length, 0)
  checked := createChecker(analysis).check("/main.do")
  Assert.equal(checked.diagnostics.length, 0)
  graph := emitModuleGraph(analysis, "/main.do")
  return graph.modules[0]
}

export function testEmitsIOSAppEntryWithoutNativeMain(): void {
  analysis := createAnalyzer([SourceFile { path: "/main.do", source: "function main(): void {}" }]).analyze("/main.do")
  Assert.equal(analysis.diagnostics.length, 0)
  checked := createChecker(analysis).check("/main.do")
  Assert.equal(checked.diagnostics.length, 0)
  source := emitModuleGraph(analysis, "/main.do", null, "ios-app").modules[0].source
  Assert.stringContains(source, "extern \"C\" int doof_entry_main")
  Assert.equal(source.contains("int main("), false)
}

export function testEmitsWeakFieldsAsWeakPointers(): void {
  result := emit("class Node { weak parent: Node\nancestor: weak Node }")
  Assert.equal(result.header.contains("std::weak_ptr<Node> parent"), true)
  Assert.equal(result.header.contains("std::weak_ptr<Node> ancestor"), true)
  Assert.equal(result.header.contains("Node(std::weak_ptr<Node> parent, std::weak_ptr<Node> ancestor)"), true)
}

export function testEmitsReflectableTypeParameterMetadataAccess(): void {
  result := emitMonomorphized("class Tool { function run(input: string): string => input }\nfunction describe<T: Reflectable>(tool: T): string => T.metadata.name\nfunction main(): int { println(describe<Tool>(Tool {}))\nreturn 0 }")
  Assert.stringContains(result.source, "doof::metadata_for_type<std::shared_ptr<Tool>>().name")
  Assert.stringContains(result.header, "static const doof::ClassMetadata<Tool> _metadata")
}

export function testEmitsJsonValueNullCasePattern(): void {
  result := emit("function isNull(value: JsonValue): bool => case value { _: null -> true, _ -> false }")
  Assert.stringContains(result.source, "doof::json_is_null(")
}

export function testLambdaCaptureExcludesItsOwnTypedParameters(): void {
  result := emit("function make(): (path: string): string { prefix := \"root/\"\nreturn (path: string): string => prefix + path }")
  Assert.equal(result.source.contains("[prefix](std::string path)"), true)
  Assert.equal(result.source.contains("[prefix, path]"), false)
}

export function testLambdaCapturesExplicitThis(): void {
  result := emit("class Receiver { values: int[] = []\nfunction make(): (value: int): void { return (value: int): void => this.values.push(value) } }")
  Assert.equal(result.source.contains("[this](int32_t value)"), true)
}

export function testLambdaCapturesThisForImplicitMethodCalls(): void {
  result := emit("class Receiver { handle(value: int): void {}\nmake(): (value: int): void => (value: int): void => handle(value) }")
  Assert.equal(result.source.contains("[this](int32_t value)"), true)
  Assert.equal(result.source.contains("return handle(value)"), true)
}

export function testEmitsJsonValueAsNarrowing(): void {
  result := emit("function read(raw: JsonValue): bool { value := raw as bool else { return false }\nreturn value }")
  Assert.equal(result.source.contains("doof::json_is_boolean(_as_value)"), true)
  Assert.equal(result.source.contains("doof::json_as_bool(_as_value)"), true)
}

export function testEmitsDotShorthandEnumMapKeys(): void {
  result := emit("enum Suit { Spades, Hearts }\nclass Pile {}\nclass State { foundations: Map<Suit, Pile> = { .Spades: Pile {}, .Hearts: Pile {} } }")
  Assert.stringContains(result.header, "{Suit::Spades, std::make_shared<Pile>()}")
  Assert.stringContains(result.header, "{Suit::Hearts, std::make_shared<Pile>()}")
}

export function testEmitsIntegerMapKeys(): void {
  result := emit("function ints(): Map<int, string> => { 1: \"one\", 2: \"two\" }\nfunction longs(): Map<long, string> => { 1L: \"one\", 2L: \"two\" }")
  Assert.stringContains(result.source, "{1, std::string(\"one\")}")
  Assert.stringContains(result.source, "{2LL, std::string(\"two\")}")
}

export function testEmitsArrayCloneMutableAndEnumFromValue(): void {
  result := emit("enum Suit { Spades = 0, Hearts = 1 }\nfunction clone(values: int[]): int[] => values.cloneMutable()\nfunction suit(index: int): Suit => Suit.fromValue(index) ?? .Spades")
  Assert.stringContains(result.source, "doof::array_cloneMutable(values")
  Assert.stringContains(result.source, "Suit_fromValue(index)")
  Assert.stringContains(result.header, "Suit_fromValue(int32_t value)")
}

export function testEmitsCStyleForInitializerWithoutExtraSemicolon(): void {
  result := emit("function sum(limit: int): int { let total = 0\nfor let i = 0; i < limit; i += 1 { total += i }\nreturn total }")
  Assert.stringContains(result.source, "for (auto i = 0; i < limit; (i += 1))")
  Assert.equal(result.source.contains("for (auto i = 0;;"), false)
}

export function testDoesNotCaptureModuleReadonlyValuesInLambdas(): void {
  result := emit("readonly CLICK_THRESHOLD: double = 5.0\nfunction invoke(handler: (): double): double => handler()\nfunction read(): double => invoke((): double => CLICK_THRESHOLD)")
  Assert.stringContains(result.source, "[]() -> double { return CLICK_THRESHOLD; }")
  Assert.equal(result.source.contains("[CLICK_THRESHOLD]"), false)
}

export function testEmitsRangeValuesSignaturesAndMembers(): void {
  result := emit("function first(values: Range): int { for value of values { return value }\nreturn values.lowerBound + values.upperBound }\nfunction main(): int => first(1..<4)")
  Assert.equal(result.header.contains("int32_t first(doof::Range values)"), true)
  Assert.equal(result.source.contains("for (const auto& value : _iterable_"), true)
  Assert.equal(result.source.contains("values.lowerBound + values.upperBound"), true)
  Assert.equal(result.source.contains("first(doof::range_exclusive(1, 4))"), true)
}

export function testEmitsFiniteAndOpenEndedCaseRangePatterns(): void {
  result := emit("function category(value: int): int => case value { ..<0 -> 1, 0..<10 -> 2, 10..20 -> 3, 21.. -> 4 }")
  Assert.stringContains(result.source, "_case_subject < 0")
  Assert.stringContains(result.source, "_case_subject >= 0 && _case_subject < 10")
  Assert.stringContains(result.source, "_case_subject >= 10 && _case_subject <= 20")
  Assert.stringContains(result.source, "_case_subject >= 21")
}

export function testEmitsCaseStatementRangePatterns(): void {
  result := emit("function category(value: int): void { case value { ..<0 -> println(\"negative\"), 0..10 -> println(\"small\"), 11.. -> println(\"large\") } }")
  Assert.stringContains(result.source, "if (_case_subject < 0)")
  Assert.stringContains(result.source, "else if (_case_subject >= 0 && _case_subject <= 10)")
  Assert.stringContains(result.source, "else if (_case_subject >= 11)")
}

export function testEmitsSetAndReadonlySetOperations(): void {
  result := emit("enum Flag { One, Two }\nfunction count(values: ReadonlySet<Flag>): int { let total = 0\nfor value of values { total = total + 1 }\nreturn total }\nfunction main(): int { let values: Set<Flag> = [Flag.One, Flag.Two, Flag.One]\nvalues.add(Flag.Two)\nvalues.delete(Flag.One)\nfrozen := values.buildReadonly()\ncopy := frozen.cloneMutable()\nreturn count(frozen) + copy.values().length + copy.size }")
  Assert.equal(result.header.contains("std::shared_ptr<doof::ordered_set<Flag>>"), true)
  Assert.equal(result.source.contains("std::make_shared<doof::ordered_set<Flag>>"), true)
  Assert.equal(result.source.contains("->insert(Flag::Two)"), true)
  Assert.equal(result.source.contains("->erase(Flag::One)"), true)
  Assert.equal(result.source.contains("doof::set_buildReadonly"), true)
  Assert.equal(result.source.contains("doof::set_cloneMutable"), true)
  Assert.equal(result.source.contains("doof::set_values"), true)
  Assert.equal(result.source.contains("->size()"), true)
}

export function testEmitsNullableJsonValueAsNarrowing(): void {
  result := emit("function read(value: JsonValue | null): Result<string, string> => value! as string")
  Assert.equal(result.source.contains("std::get<doof::JsonValue>(value)"), true)
  Assert.equal(result.source.contains("doof::unwrap_optional(value)"), false)
}

export function testEmitsRepresentationAwareNullableAsNarrowing(): void {
  result := emit("class Config { value: int }\nfunction config(value: Config | null): Result<Config, string> => value as Config\nfunction items(value: int[] | null): Result<int[], string> => value as int[]\nfunction count(value: int | null): Result<int, string> => value as int\nfunction wide(value: int | null): Result<long, string> => value as long")

  Assert.equal(result.source.contains("if (_as_value) return doof::Success<std::shared_ptr<Config>>{_as_value}"), true)
  Assert.equal(result.source.contains("if (_as_value) return doof::Success<std::shared_ptr<std::vector<int32_t>>>{_as_value}"), true)
  Assert.equal(result.source.contains("if (_as_value.has_value()) return doof::Success<int32_t>{_as_value.value()}"), true)
  Assert.equal(result.source.contains("doof::checked_numeric_as<int64_t>(_as_value.value())"), true)
  Assert.equal(result.source.contains("doof::variant_is"), false)
  Assert.equal(result.source.contains("doof::variant_narrow"), false)
}

export function testRetainsVariantBackedAsNarrowing(): void {
  result := emit("function text(value: int | string): Result<string, string> => value as string")
  Assert.equal(result.source.contains("doof::variant_is<std::string>(_as_value)"), true)
  Assert.equal(result.source.contains("doof::variant_narrow<std::string>(_as_value)"), true)
}

export function testEmitsLenientGeneratedJsonDecode(): void {
  result := emit("class Options { enabled: bool\nname: string }\nfunction decode(value: JsonValue): Result<Options, string> => Options.fromJsonValue(value, true)")
  Assert.equal(result.header.contains("bool _lenient = false"), true)
  Assert.equal(result.source.contains("json_is_lenient_boolean"), true)
  Assert.equal(result.source.contains("json_as_string_lenient"), true)
}

export function testEscapesShortCppKeywordEverywhere(): void {
  result := emit("class Option { short: string | null }\nfunction read(short: string): string => Option { short }.short!")
  Assert.equal(result.header.contains(" short_;"), true)
  Assert.equal(result.header.contains("std::string short_"), true)
  Assert.equal(result.source.contains("->short_"), true)
}

export function testEscapesCharCppKeywordEverywhere(): void {
  result := emit("function first(value: string): char { char := value[0]\nreturn char }")
  Assert.equal(result.source.contains("const auto char_ = value[0]"), true)
  Assert.equal(result.source.contains("return char_"), true)
  Assert.equal(result.source.contains("auto char ="), false)
}

export function testEscapesDeleteCppKeywordForMethods(): void {
  result := emit("class Router { delete(pattern: string): Router => this }\nfunction remove(router: Router): Router => router.delete(\"/old\")")
  Assert.equal(result.header.contains(" delete_(std::string pattern)"), true)
  Assert.equal(result.source.contains("Router::delete_(std::string pattern)"), true)
  Assert.equal(result.source.contains("router->delete_(std::string(\"/old\"))"), true)
}

export function testReturningThisRetainsOwningSharedPointer(): void {
  result := emit("class Builder { chain(): Builder => this }")
  Assert.equal(result.header.contains("public std::enable_shared_from_this<Builder>"), true)
  Assert.equal(result.source.contains("return this->shared_from_this();"), true)
  Assert.equal(result.source.contains("[](Builder*) {}"), false)
}

export function testFieldlessClassHasPublicDefaultConstructor(): void {
  result := emit("class Marker {}\nfunction make(): Marker => Marker {}")
  Assert.equal(result.header.contains("Marker() {}"), true)
}

export function testEmitsImportedFieldlessClassCallAsSharedPointer(): void {
  result := emitSources([
    SourceFile { path: "/main.do", source: "import { Marker } from \"./marker\"\nfunction makePositional(): Marker => Marker()" },
    SourceFile { path: "/marker.do", source: "export class Marker {}" },
  ], "/main.do")
  Assert.equal(result.source.contains("makePositional() {\n    return std::make_shared<::app_marker_::Marker>"), true)
}

export function testMaterializesCallerDefaultsAtPackageRelativeCallSite(): void {
  source := "function debug(source: SourceLocation = @caller): string => source.fileName\n" +
    "class Marker {\n" +
    "  source: SourceLocation\n" +
    "  static constructor(source: SourceLocation = @caller): Marker => Marker { source }\n" +
    "}\n" +
    "function wrapper(): string {\n" +
    "  ignored := debug()\n" +
    "  marker := Marker {}\n" +
    "  return marker.source.fileName\n" +
    "}\n"
  path := "/workspace/assert/tests/caller.test.do"
  analysis := createAnalyzer([SourceFile { path, source }]).analyze(path)
  Assert.equal(analysis.diagnostics.length, 0)
  checked := createChecker(analysis).check(path)
  Assert.equal(checked.diagnostics.length, 0)
  configureModuleNamespaces([
    ModuleNamespaceMapping { logicalPrefix: "/workspace/assert", packageName: "std/assert" },
  ])
  emitted := emitModuleGraph(analysis, path).modules[0].source
  configureModuleNamespaces([])

  Assert.equal(emitted.contains("SourceLocation>(std::string(\"tests/caller.test\"), 7, std::string(\"wrapper\"))"), true)
  Assert.equal(emitted.contains("SourceLocation>(std::string(\"tests/caller.test\"), 8, std::string(\"wrapper\"))"), true)
}

function findProgram(analysis: AnalysisResult, path: string): Program | null {
  for module of analysis.modules { if module.path == path { return module.program } }
  return null
}

export function testConstructionPanicsWhenConstructorAttachmentIsMissing(): void {
  source := "class Widget { value: int\nstatic constructor(value: int): Widget => Widget { value } }\nwidget := Widget { value: 1 }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  program := findProgram(analysis, "/main.do")!
  case program.statements[1] {
    binding: ImmutableBinding -> {
      case binding.value {
        construct: ConstructExpression -> { construct.resolvedConstructor = null }
        _ -> { panic("expected a construct expression") }
      }
    }
    _ -> { panic("expected an immutable binding") }
  }

  result := catchPanic(=> emitModule(program, "main"))
  case result {
    failure: Failure<string> -> { Assert.equal(failure.error.contains("has no resolved constructor"), true) }
    _ -> { panic("expected missing constructor metadata to panic") }
  }
}

export function testConstructionPanicsWhenRequiredFieldIsMissing(): void {
  source := "class Widget { value: int }\nwidget := Widget { value: 1 }"
  analysis := createAnalyzer([SourceFile { path: "/main.do", source }]).analyze("/main.do")
  Assert.equal(createChecker(analysis).check("/main.do").diagnostics.length, 0)
  program := findProgram(analysis, "/main.do")!
  case program.statements[1] {
    binding: ImmutableBinding -> {
      case binding.value {
        construct: ConstructExpression -> { construct.args = [] }
        _ -> { panic("expected a construct expression") }
      }
    }
    _ -> { panic("expected an immutable binding") }
  }

  result := catchPanic(=> emitModule(program, "main"))
  case result {
    failure: Failure<string> -> { Assert.equal(failure.error.contains("is missing required field 'value'"), true) }
    _ -> { panic("expected missing required field to panic") }
  }
}

export function testKeepsHeaderAndSourceSeparate(): void {
  result := emit("function add(a: int, b: int): int => a + b\nfunction main(): int => add(2, 3)")
  Assert.equal(result.header.contains("int32_t add(int32_t a, int32_t b);"), true)
  Assert.equal(result.header.contains("return a + b"), false)
  Assert.equal(result.source.contains("int32_t add(int32_t a, int32_t b)"), true)
  Assert.equal(result.source.contains("doof::detail::ApplicationDomain::shared()"), true)
  Assert.equal(result.source.contains("doof::detail::ActiveActorScope __doof_application_scope"), true)
  Assert.equal(result.source.contains("return main_::doof_main();"), true)
}

export function testEmitsNamedNativeConstructionThroughStaticConstructor(): void {
  result := emit("enum Endian { LittleEndian, BigEndian }\nimport class BlobBuilder from \"native.hpp\" as native::BlobBuilder { static constructor(size: long = 0L, endianness: Endian = .LittleEndian): BlobBuilder }\nfunction build(): void { builder := BlobBuilder{endianness: .BigEndian} }")
  Assert.equal(result.source.contains("::native::BlobBuilder::constructor("), true)
  Assert.equal(result.source.contains("Endian::BigEndian"), true)
}

export function testEmitsNamedDoofConstructionThroughStaticConstructor(): void {
  result := emit("class Widget { value: int\nstatic constructor(value: int): Widget => Widget { value } }\nfunction build(): void { widget := Widget{value: 7} }")
  Assert.equal(result.source.contains("Widget::constructor(7)"), true)
}

export function testSpecializesGenericResultCasePatterns(): void {
  result := emitMonomorphized("function failed<T, E>(result: Result<T, E>): bool => case result { _: Success -> false, _: Failure -> true }\nfunction main(): bool => failed<int, string>(Failure { error: \"no\" })")
  Assert.equal(result.source.contains("doof::Success<int32_t>"), true)
  Assert.equal(result.source.contains("doof::Failure<std::string>"), true)
  Assert.equal(result.source.contains("doof::Success<T>"), false)
  Assert.equal(result.source.contains("doof::Failure<E>"), false)
}

export function testEmitsActorCreationCallsPromiseAndRetirement(): void {
  result := emit("class Worker { value: int\nfunction add(amount: int): int { this.value = this.value + amount\nreturn this.value } }\nfunction main(): int { worker := Actor<Worker>(1)\nfirst := worker.add(2)\npromise := async worker.add(3)\nsecond := try! promise.get()\nstate := retire worker\nreturn first + second + state.value }")
  Assert.equal(result.source.contains("std::make_shared<doof::Actor<Worker>>(Worker{1})"), true)
  Assert.equal(result.source.contains("->template call_sync<int32_t>"), true)
  Assert.equal(result.source.contains("->template call_async<int32_t>"), true)
  Assert.equal(result.source.contains("promise.get()"), true)
  Assert.equal(result.source.contains("worker->retire()"), true)
}

export function testActorCreationUsesTrailingFieldDefaults(): void {
  result := emit("class Worker { values: int[] = []\nlimit: int = 4 }\nfunction create(): Actor<Worker> => Actor<Worker>()")
  Assert.equal(result.header.contains("Worker(std::shared_ptr<std::vector<int32_t>> values = std::make_shared<std::vector<int32_t>>(std::vector<int32_t>{}), int32_t limit = 4)"), true)
  Assert.equal(result.source.contains("std::make_shared<doof::Actor<Worker>>(Worker{})"), true)
}

export function testActorCallsUseConcreteGenericReturnTypes(): void {
  result := emitMonomorphized("class Sender<T> { readonly value: T }\nclass Receiver<T> { readonly value: T }\nclass Worker { function open(): Tuple<Sender<int>, Receiver<int> > => (Sender { value: 1 }, Receiver { value: 2 }) }\nfunction main(): int { worker := Actor<Worker>()\n(sender, receiver) := worker.open()\nretired := retire worker\nreturn sender.value + receiver.value }")
  Assert.equal(result.source.contains("call_sync<std::tuple<std::shared_ptr<Sender__int>, std::shared_ptr<Receiver__int>>>"), true)
  Assert.equal(result.source.contains("Sender<int32_t>"), false)
  Assert.equal(result.source.contains("Receiver<int32_t>"), false)
}

export function testEmitsVoidActorCallsAndPromiseAnnotation(): void {
  result := emit("class Worker { value: int\nfunction set(value: int): void { this.value = value } }\nfunction create(): Actor<Worker> => Actor<Worker>(0)\nfunction run(worker: Actor<Worker>): Promise<void> => async worker.set(2)")
  Assert.equal(result.header.contains("std::shared_ptr<doof::Actor<Worker>> create()"), true)
  Assert.equal(result.header.contains("doof::Promise<void> run"), true)
  Assert.equal(result.source.contains("call_async<void>"), true)
}

export function testMainWrapperReportsPanicsForEverySupportedSignature(): void {
  intMain := emit("function main(): int => 0").source
  voidMain := emit("function main(): void { }").source
  intArgsMain := emit("function main(args: string[]): int => args.length").source
  voidArgsMain := emit("function main(args: string[]): void { println(string(args.length)) }").source

  for source of [intMain, voidMain, intArgsMain, voidArgsMain] {
    Assert.equal(source.contains("catch (const doof::Panic& _panic)"), true)
    Assert.equal(source.contains("std::cerr << \"panic: \" << _panic.what() << std::endl;"), true)
    Assert.equal(source.contains("std::abort();"), true)
  }
}

export function testEmitsCheckedCoreExpressions(): void {
  result := emit("function main(): int { values: int[] := [1, 2, 3]\nreturn values[1] + 4 }")
  Assert.equal(result.source.contains("std::make_shared<std::vector<int32_t>>"), true)
  Assert.equal(result.source.contains("(*values)[1]"), true)
  Assert.equal(result.source.contains("return ("), true)
}

export function testPreservesFullFloatingPointLiteralText(): void {
  result := emit("function value(): double => 1.4142135623730951")
  Assert.equal(result.source.contains("1.4142135623730951"), true)
}

export function testEmitsArrayAndStringSearchMembers(): void {
  result := emit("function main(): int { values := [1, 2, 3]\ntext := \"hello\"\nif values.contains(2) && text.contains(\"ell\") { return values.indexOf(3) + text.indexOf(\"e\") }\nreturn 0 }")
  Assert.equal(result.source.contains("doof::array_contains(values, 2"), true)
  Assert.equal(result.source.contains("doof::array_indexOf(values, 3"), true)
  Assert.equal(result.source.contains("doof::string_contains(text, "), true)
  Assert.equal(result.source.contains("doof::string_indexOf(text, "), true)
}

export function testEmitsMapSizeAsContainerCall(): void {
  result := emit("function size(values: readonly Map<string, int>): int => values.size\nfunction keys(values: Map<string, int>): string[] => values.keys()\nfunction freeze(values: Map<string, int>): readonly Map<string, int> => values.buildReadonly()")
  Assert.equal(result.source.contains("values->size()"), true)
  Assert.equal(result.source.contains("doof::map_keys(values"), true)
  Assert.equal(result.source.contains("doof::map_buildReadonly(values"), true)
}

export function testWrapsMapSetArgumentsForJsonValueMaps(): void {
  result := emit("function fill(receipt: Map<string, JsonValue>, version: int, name: string): void { receipt.set(\"schemaVersion\", version)\nreceipt.set(\"name\", name) }\nfunction widen(value: int): long => long(value)")
  Assert.stringContains(result.source, "doof::map_set(receipt, std::string(\"schemaVersion\"), doof::json_value(version)")
  Assert.stringContains(result.source, "doof::map_set(receipt, std::string(\"name\"), doof::json_value(name)")
  Assert.stringContains(result.source, "static_cast<int64_t>(value)")
  Assert.equal(result.source.contains("static_cast<int64_t>(doof::json_value(value))"), false)
}

export function testInvokesCallbackValuedMemberThroughCallMethod(): void {
  result := emit("class Route { handler: (value: int): int\nget(value: int): int => value }\nfunction invoke(route: Route): int => route.handler(1) + route.get(1)")
  Assert.equal(result.source.contains("route->handler.call(1)"), true)
  Assert.equal(result.source.contains("route->get(1)"), true)
  Assert.equal(result.source.contains("route->get.call(1)"), false)
}

export function testOrdersNamedCallbackArgumentsByFunctionType(): void {
  result := emit("function invoke(callback: (left: int, right: int): int): int => callback{right: 2, left: 1}")
  Assert.equal(result.source.contains("callback.call(1, 2)"), true)
  Assert.equal(result.source.contains("callback.call(2, 1)"), false)
}

export function testContextuallyPromotesLambdaReturnIntoCallbackUnion(): void {
  result := emit("class Response {}\nclass Upgrade {}\ntype Outcome = Response | Upgrade\nclass Router { websocket(handler: (): Outcome): void {} }\nfunction register(router: Router): void { router.websocket((): Response => Response {}) }")
  Assert.equal(result.source.contains("doof::callback<std::variant<std::shared_ptr<Response>, std::shared_ptr<Upgrade>>()>([]() -> std::variant<std::shared_ptr<Response>, std::shared_ptr<Upgrade>>"), true)
  Assert.equal(result.source.contains("return doof::variant_promote<std::variant<std::shared_ptr<Response>, std::shared_ptr<Upgrade>>>(std::make_shared<Response>"), true)
}

export function testEmitsArrayCallbackMembers(): void {
  result := emit("class Item { value: int }\nfunction values(items: Item[]): int[] => items.map(=> it.value)\nfunction positive(values: int[]): int[] => values.filter(=> it > 0)")
  Assert.equal(result.source.contains("doof::array_map(items"), true)
  Assert.equal(result.source.contains("doof::array_filter(values"), true)
}

export function testEmitsReadonlyArrayAndGenericNamedCall(): void {
  result := emitMonomorphized("function create<T>(value: T, count: int = 1): T => value\nfunction main(): string { values := readonly [1, 2]\nreturn create<string>{ value: \"ok\" } }")
  Assert.equal(result.header.contains("create__string"), true)
  Assert.equal(result.header.contains("T create("), false)
  Assert.equal(result.source.contains("create__string(std::string(\"ok\"), 1)"), true)
  Assert.equal(result.source.contains("std::make_shared<std::vector<int32_t>>"), true)
}

export function testEmitsGenericTupleDestructuring(): void {
  result := emitMonomorphized("function pair<T>(value: T): Tuple<T, T> => (value, value)\nfunction main(): int { (first, second) := pair<int>(1)\nreturn first + second }")
  Assert.equal(result.source.contains("pair__int(1)"), true)
  Assert.equal(result.source.contains("std::get<0>(_destructure_"), true)
  Assert.equal(result.source.contains("std::get<1>(_destructure_"), true)
}

export function testEmitsDeclarationElseNarrowingAndCapture(): void {
  result := emit("function load(): Result<int, string> => Success { value: 4 }\nfunction main(): int { value := load() else error { println(error)\nreturn 1 }\nreturn value }")
  Assert.equal(result.source.contains("if (doof::is_failure(_binding_value_"), true)
  Assert.equal(result.source.contains("const auto error = doof::failure_error(_binding_value_"), true)
  Assert.equal(result.source.contains("const auto value = doof::success_value(_binding_value_"), true)
}

export function testEmitsPostfixBangResultUnwrap(): void {
  result := emit("function decode(): Result<string, string> => Success { value: \"ok\" }\nfunction main(): string => decode()!")
  Assert.equal(result.source.contains("if (doof::is_failure(_assert_value)) doof::panic(\"! failed\")"), true)
  Assert.equal(result.source.contains("return std::move(doof::success_value(_assert_value))"), true)
}

export function testEmitsResultStatusMethods(): void {
  result := emit("function load(): Result<int, string> => Failure { error: \"no\" }\nfunction main(): bool => load().isFailure() || load().isSuccess()")
  Assert.equal(result.source.contains("doof::is_failure(load())"), true)
  Assert.equal(result.source.contains("doof::is_success(load())"), true)
}

export function testEmitsResultUnwrapOrWithSingleEvaluation(): void {
  result := emit("function load(): Result<JsonValue, string> => Failure { error: \"no\" }\nfunction value(): JsonValue => load().unwrapOr(null)")
  Assert.stringContains(result.source, "auto _result_unwrap_")
  Assert.stringContains(result.source, "if (doof::is_failure(_result_unwrap_")
  Assert.stringContains(result.source, "return doof::json_value(nullptr);")
  Assert.stringContains(result.source, "return std::move(doof::success_value(_result_unwrap_")
}

export function testEmitsTryValueDeclarationsWithMutability(): void {
  result := emit("function load(): Result<int, string> => Success { value: 1 }\nfunction run(): Result<int, string> { try const first = load()\ntry readonly second = load()\ntry let third = load()\nthird = third + first\nreturn Success { value: third + second } }")
  Assert.equal(result.source.contains("const auto first = doof::success_value("), true)
  Assert.equal(result.source.contains("const auto second = doof::success_value("), true)
  Assert.equal(result.source.contains("auto third = doof::success_value("), true)
}

export function testEmitsWithBindingsInOrderedLexicalScope(): void {
  result := emit("function main(): int { with base := 20, doubled := base * 2 { return doubled + 2 }\nreturn 0 }")
  Assert.equal(result.source.contains("    {\n        const auto base = 20;\n        const auto doubled = (base * 2);\n        return (doubled + 2);\n    }"), true)
}

export function testEmitsTypedWithUnionUsingItsVariantCarrier(): void {
  result := emit("class Left { value: int }\nclass Right { value: int }\nfunction main(): int { with value: Left | Right := Left { value: 42 } { return case value { left: Left -> left.value right: Right -> right.value } }\nreturn 0 }")
  Assert.equal(result.source.contains("const std::variant<std::shared_ptr<Left>, std::shared_ptr<Right>> value = doof::variant_promote<"), true)
}

export function testEmitsYieldingCaseExpressionBlocks(): void {
  result := emit("function describe(value: int): string => case value { 0 -> { yield \"zero\" } _ -> { yield \"other\" } }")
  Assert.equal(result.source.contains("return std::string(\"zero\");"), true)
  Assert.equal(result.source.contains("return std::string(\"other\");"), true)
}

export function testPromotesNarrowVariantReturnsIntoWiderUnions(): void {
  result := emit("class First { value: int }\nclass Second { value: int }\nfunction widen(value: First): First | Second { return value }")
  Assert.equal(result.source.contains("doof::variant_promote<std::variant<std::shared_ptr<First>, std::shared_ptr<Second>>>(value)"), true)
}

export function testPromotesScalarAlternativesIntoNullableVariantFields(): void {
  result := emit("class Left {}\nclass Right {}\ntype Choice = Left | Right\nclass Box { choice: Choice | null }\nfunction explicit(left: Left): Box => Box { choice: left }\nfunction shorthand(choice: Left): Box => Box { choice }")
  target := "std::variant<std::monostate, std::shared_ptr<Left>, std::shared_ptr<Right>>"
  Assert.equal(result.source.contains("doof::variant_promote<" + target + ">(left)"), true)
  Assert.equal(result.source.contains("doof::variant_promote<" + target + ">(choice)"), true)
  Assert.equal(result.source.contains("doof::optional_value(left)"), false)
  Assert.equal(result.source.contains("doof::optional_value(choice)"), false)
}

export function testEmitsNullableAndDiscardDeclarationElse(): void {
  result := emit("function maybe(): string | null => \"ok\"\nfunction save(): Result<void, string> => Success()\nfunction main(): int { name := maybe() else { return 1 }\n_ := save() else error { println(error) }\nreturn name.length }")
  Assert.equal(result.source.contains("if (doof::is_null(_binding_value_"), true)
  Assert.equal(result.source.contains("const auto name = doof::unwrap_optional(_binding_value_"), true)
  Assert.equal(result.source.contains("const auto _ ="), false)
}

export function testEmitsClassesMethodsAndConstruction(): void {
  result := emit("class Point { x: int\nfunction double(): int => x * 2 }\nfunction main(): int { point := Point { x: 4 }\nreturn point.double() }")
  Assert.equal(result.header.contains("struct Point"), true)
  Assert.equal(result.header.contains("int32_t x;"), true)
  Assert.equal(result.header.contains("int32_t double();"), true)
  Assert.equal(result.source.contains("int32_t Point::double()"), true)
  Assert.equal(result.source.contains("this->x"), true)
  Assert.equal(result.source.contains("std::make_shared<Point>(4)"), true)
}

export function testEmitsClassDestructorBody(): void {
  result := emit("class Resource { value: int = 1\ndestructor { println(\"closed\") } }\nfunction open(): Resource => Resource {}")
  Assert.equal(result.header.contains("~Resource()"), true)
  Assert.equal(result.header.contains("doof::println(std::string(\"closed\"));"), true)
  Assert.equal(result.source.contains("std::make_shared<Resource>(1)"), true)
  Assert.equal(result.source.contains("std::make_shared<Resource>(Resource{"), false)
}

export function testEmitsStrictPrimitiveJsonDeserialization(): void {
  result := emit("class Config { name: string\nenabled: bool\ncount: int = 10\nnotes: string | null = null }\nfunction parse(value: JsonValue): Result<Config, string> => Config.fromJsonValue(value)")
  Assert.equal(result.header.contains("static doof::Result<std::shared_ptr<Config>, std::string> fromJsonValue(const doof::JsonValue& _json, bool _lenient = false);"), true)
  Assert.equal(result.source.contains("const auto* _object = doof::json_as_object(_json);"), true)
  Assert.equal(result.source.contains("Missing required field \\\"name\\\""), true)
  Assert.equal(result.source.contains("Field \\\"enabled\\\" expected boolean but got"), true)
  Assert.equal(result.source.contains("_field_count = 10;"), true)
  Assert.equal(result.source.contains("_field_notes = std::nullopt;"), true)
  Assert.equal(result.source.contains("doof::json_is_null(_iterator_notes->second)"), true)
  Assert.equal(result.source.contains("std::make_shared<Config>(_field_name, _field_enabled, _field_count.value(), _field_notes.value())"), true)
}

export function testDeserializesDefaultedStructFieldsWithoutDefaultConstruction(): void {
  result := emit("struct Depth { mode: int }\nclass Pass { depth: Depth = Depth { mode: 0 } }\nfunction parse(value: JsonValue): Result<Pass, string> => Pass.fromJsonValue(value)")
  Assert.stringContains(result.source, "std::optional<Depth> _field_depth;")
  Assert.stringContains(result.source, "std::make_shared<Pass>(_field_depth.value())")
  Assert.equal(result.source.contains("Depth _field_depth;"), false)
}

export function testEmitsStructJsonDeserializationByValue(): void {
  result := emit("struct Point { x: int\ny: double }\nfunction parse(value: JsonValue): Result<Point, string> => Point.fromJsonValue(value)")
  Assert.equal(result.header.contains("static doof::Result<Point, std::string> fromJsonValue(const doof::JsonValue& _json, bool _lenient = false);"), true)
  Assert.equal(result.source.contains("return doof::Success<Point>{Point{_field_x, _field_y}};"), true)
  Assert.equal(result.source.contains("std::make_shared<Point>"), false)
}

export function testEmitsJsonCollectionSerializationAndDeserialization(): void {
  result := emit("class Payload { items: JsonValue[]\nvalues: Map<string, JsonValue> }\nfunction serialize(value: Payload): JsonObject => value.toJsonObject()")
  Assert.equal(result.header.contains("doof::JsonObject toJsonObject() const;"), true)
  Assert.equal(result.header.contains("fromJsonValue"), true)
  Assert.equal(result.source.contains("doof::json_value(this->items)"), true)
  Assert.equal(result.source.contains("doof::json_value(this->values)"), true)
}

export function testEmitsNullableJsonObjectSerialization(): void {
  result := emit("class Config { values: JsonObject | null = null }\nfunction write(value: Config): JsonObject => value.toJsonObject()")
  Assert.equal(result.source.contains("this->values ? doof::json_value(this->values) : doof::json_value(nullptr)"), true)
  Assert.equal(result.header.contains("fromJsonValue"), true)
}

export function testEmitsRecursiveAutomaticJsonTypes(): void {
  result := emit("enum Kind { One, Two }\nclass Point { x: double\ny: double }\nclass Payload { kind: Kind\nids: int[]\npoints: Point[]\nselected: Point | null = null }\nfunction encode(value: Payload): JsonObject => value.toJsonObject()\nfunction decode(value: JsonValue): Result<Payload, string> => Payload.fromJsonValue(value)")
  Assert.equal(result.header.contains("Kind_fromName"), true)
  Assert.equal(result.source.contains("this->kind"), true)
  Assert.equal(result.source.contains("for (const auto& _element : *this->ids)"), true)
  Assert.equal(result.source.contains("Point::fromJsonValue"), true)
}

export function testEmitsTupleAutomaticJsonTypes(): void {
  result := emit("class Point { x: int\ny: int }\nclass Payload { pair: Tuple<string, int>\npoint: Tuple<Point, bool>\noptional: Tuple<int, string> | null = null }\nfunction encode(value: Payload): JsonObject => value.toJsonObject()\nfunction decode(value: JsonValue): Result<Payload, string> => Payload.fromJsonValue(value)")
  Assert.stringContains(result.header, "doof::JsonObject toJsonObject() const;")
  Assert.stringContains(result.header, "fromJsonValue(const doof::JsonValue& _json")
  Assert.stringContains(result.source, "std::get<0>(this->pair)")
  Assert.stringContains(result.source, "std::get<1>(this->point)")
  Assert.stringContains(result.source, "std::make_tuple(")
  Assert.stringContains(result.source, "Point::fromJsonValue((*_tuple)[0], _lenient)")
  Assert.stringContains(result.source, "std::holds_alternative<std::monostate>(this->optional)")
  Assert.stringContains(result.source, "std::variant<std::monostate, std::tuple<int32_t, std::string>>{std::monostate{}}")
}

export function testEmitsStringMapAutomaticJsonTypes(): void {
  result := emit("class Point { x: int\ny: int }\nclass Payload { counts: Map<string, int>\npoints: Map<string, Point> }\nfunction encode(value: Payload): JsonObject => value.toJsonObject()\nfunction decode(value: JsonValue): Result<Payload, string> => Payload.fromJsonValue(value)")
  Assert.stringContains(result.source, "std::make_shared<doof::ordered_map<std::string, doof::JsonValue>>();")
  Assert.stringContains(result.source, "for (const auto& _entry : *this->counts)")
  Assert.stringContains(result.source, "doof::json_value(_entry.second)")
  Assert.stringContains(result.source, "std::make_shared<doof::ordered_map<std::string, std::shared_ptr<Point>>>()")
  Assert.stringContains(result.source, "Point::fromJsonValue(_entry.second, _lenient)")
}

export function testEmitsDiscriminatedInterfaceJsonDeserialization(): void {
  result := emit("interface Shape { area(): double }\nclass Circle implements Shape { const kind = \"circle\"\nradius: double\narea(): double => radius * radius }\nclass Rect implements Shape { const kind = \"rect\"\nwidth: double\nheight: double\narea(): double => width * height }\nfunction decode(value: JsonValue): Result<Shape, string> => Shape.fromJsonValue(value, true)")
  Assert.stringContains(result.header, "doof::Result<Shape, std::string> Shape_fromJsonValue(const doof::JsonValue& _json, bool _lenient = false);")
  Assert.stringContains(result.source, "Shape_fromJsonValue(value, true)")
  Assert.stringContains(result.source, "_object->find(\"kind\")")
  Assert.stringContains(result.source, "if (_discriminator == \"circle\")")
  Assert.stringContains(result.source, "Circle::fromJsonValue(_json, _lenient)")
  Assert.stringContains(result.source, "Rect::fromJsonValue(_json, _lenient)")
  Assert.stringContains(result.source, "doof::Success<Shape>{Shape{doof::success_value(_result)}}")
  Assert.stringContains(result.header, "const std::string kind = std::string(\"circle\")")
  Assert.stringContains(result.source, "Field \\\"kind\\\" must be \\\"circle\\\"")
}

export function testEmitsDescriptionsMetadataSchemasAndInvoke(): void {
  result := emit("class Tool \"A tool.\" { count \"Current count.\": int = 0\nfunction run \"Runs it.\"(input \"The input.\": string): string => input }\nmetadata := Tool.metadata\nfunction invoke(tool: Tool, params: JsonValue): Result<JsonValue, JsonValue> => metadata.invoke(tool, \"run\", params)")
  Assert.equal(result.header.contains("// A tool."), true)
  Assert.equal(result.header.contains("// Current count."), true)
  Assert.equal(result.header.contains("// Runs it."), true)
  Assert.equal(result.header.contains("// @param input The input."), true)
  Assert.equal(result.header.contains("static const doof::ClassMetadata<Tool> _metadata;"), true)
  Assert.equal(result.source.contains("inline const doof::ClassMetadata<Tool> Tool::_metadata"), true)
  Assert.equal(result.source.contains("doof::MethodReflection<Tool>"), true)
  Assert.equal(result.source.contains("\"input\""), true)
  Assert.equal(result.source.contains("\"required\""), true)
  Assert.equal(result.source.contains("_instance.run(input)"), true)
  Assert.equal(result.source.contains("doof::Success<doof::JsonValue>"), true)
  Assert.equal(result.source.contains("Tool::_metadata"), true)
  Assert.equal(result.source.contains("metadata.invoke"), true)
}

export function testDoesNotEmitMetadataWhenUnused(): void {
  result := emit("class Tool { function run(input: string): string => input }")
  Assert.equal(result.header.contains("ClassMetadata<Tool>"), false)
  Assert.equal(result.source.contains("Tool::_metadata"), false)
}

export function testDoesNotEmitJsonMethodsThatDependOnUnsupportedNominalFields(): void {
  result := emit("class Handler { callback: (value: int): void }\nclass Envelope { handler: Handler }")
  Assert.equal(result.header.contains("doof::JsonObject toJsonObject() const;"), false)
  Assert.equal(result.source.contains("Envelope::toJsonObject"), false)
  Assert.equal(result.source.contains("Handler::fromJsonValue"), false)
}

export function testEmitsStructThisByValue(): void {
  result := emit("struct Point { length, kind, resolvedType, span, push, value: int\nfunction copy(): Point => this }\nstruct Methods { startsWith(): int => 1\npop(): int => 2 }\nfunction read(point: Point): int => point.length + point.kind + point.resolvedType + point.span + point.push + point.value\nfunction invoke(methods: Methods): int => methods.startsWith() + methods.pop()")
  Assert.equal(result.source.contains("return *this;"), true)
  Assert.equal(result.source.contains("std::shared_ptr<Point>(this"), false)
  for name of ["length", "kind", "resolvedType", "span", "push", "value"] {
    Assert.equal(result.source.contains("point." + name), true)
  }
  Assert.equal(result.source.contains("doof::length(point)"), false)
  Assert.equal(result.source.contains("doof::span(point)"), false)
  Assert.equal(result.source.contains("point->push_back"), false)
  Assert.equal(result.source.contains("methods.startsWith()"), true)
  Assert.equal(result.source.contains("methods.pop()"), true)
  Assert.equal(result.source.contains("doof::starts_with(methods"), false)
  Assert.equal(result.source.contains("doof::pop(methods"), false)
}

export function testEmitsCanonicalStringAndArrayHelpers(): void {
  result := emit("function transform(text: string, values: int[]): Result<int, string> { cleaned := text.trim().replaceAll(\"a\", \"b\")\nif cleaned.startsWith(\"b\") && cleaned.endsWith(\"b\") { return values.pop() }\nreturn Failure(\"missing\") }")
  Assert.equal(result.source.contains("doof::string_trim("), true)
  Assert.equal(result.source.contains("doof::string_replaceAll("), true)
  Assert.equal(result.source.contains("doof::string_startsWith("), true)
  Assert.equal(result.source.contains("doof::string_endsWith("), true)
  Assert.equal(result.source.contains("doof::array_pop("), true)
  Assert.equal(result.source.contains("doof::trim("), false)
  Assert.equal(result.source.contains("doof::starts_with("), false)
  Assert.equal(result.source.contains("doof::pop("), false)
}

export function testEmitsVariantCaseBindings(): void {
  result := emit("class Left { value: int }\nclass Right { value: int }\nfunction main(value: Left | Right): int { case value { left: Left -> { return left.value } _ -> { return 0 } }\nreturn 0 }")
  Assert.equal(result.source.contains("std::holds_alternative<std::shared_ptr<Left>>(_case_subject)"), true)
  Assert.equal(result.source.contains("std::get<std::shared_ptr<Left>>(_case_subject)"), true)
  Assert.equal(result.source.contains("else {"), true)
}

export function testEmitsExactClassCaseWithoutVariantOperations(): void {
  result := emit("class Node { value: int }\nfunction read(value: Node | null): int { case value! { node: Node -> { return node.value } }\nreturn 0 }")
  Assert.equal(result.source.contains("std::holds_alternative<std::shared_ptr<Node>>(_case_subject)"), false)
  Assert.equal(result.source.contains("const auto node = _case_subject;"), true)
}

export function testEmitsNullableClassCaseWithNullGuard(): void {
  result := emit("class Node { value: int }\nfunction read(value: Node | null): int { case value { node: Node -> { return node.value } _ -> { return 0 } } }")
  Assert.equal(result.source.contains("if (!doof::is_null(_case_subject))"), true)
  Assert.equal(result.source.contains("const auto node = doof::unwrap_optional(_case_subject);"), true)
}

export function testEmitsExactClassCaseExpressionWithoutVariantOperations(): void {
  result := emit("class Node { value: int }\nfunction read(value: Node): int => case value { node: Node -> node.value }")
  Assert.equal(result.source.contains("std::holds_alternative<std::shared_ptr<Node>>(_case_subject)"), false)
  Assert.equal(result.source.contains("const auto node = _case_subject;"), true)
}

export function testEmitsJsonValueCaseTypeGuardsAndNarrowing(): void {
  result := emit("function read(value: JsonValue): int { case value { text: string -> { return text.length } object: JsonObject -> { return object.size } _ -> { return 0 } } }")
  Assert.equal(result.source.contains("if (doof::json_is_string(_case_subject))"), true)
  Assert.equal(result.source.contains("const auto text = doof::json_as_string(_case_subject);"), true)
  Assert.equal(result.source.contains("else if (doof::json_is_object(_case_subject))"), true)
  Assert.equal(result.source.contains("const auto object = doof::json_object(_case_subject);"), true)
}

export function testHeaderPlannerIncludesRequiredStandardLibrary(): void {
  result := emit("function square(value: double): double => value ** value")
  Assert.equal(result.header.startsWith("#pragma once\n#include \"doof_runtime.hpp\"\n"), true)
  Assert.equal(result.header.contains("DOOF_SELFHOST_COMMON_HELPERS"), false)
  Assert.equal(result.header.contains("inline bool starts_with"), false)
  Assert.equal(result.header.contains("#include <cmath>"), true)
  Assert.equal(result.source.contains("std::pow(value, value)"), true)
}

export function testBreaksCircularStructHeaderDependencies(): void {
  sources := [
    SourceFile {
      path: "/render.do",
      source: "import { Transform } from \"./transform\"\nexport struct Point3 { x: double\ny: double\nz: double }\nexport class Camera { transform: Transform }",
    },
    SourceFile {
      path: "/transform.do",
      source: "import { Point3 } from \"./render\"\nexport struct Vec3 { x: double\ny: double\nz: double\nstatic fromPoint(point: Point3): Vec3 => Vec3 { x: point.x, y: point.y, z: point.z } }\nexport struct Transform { position: Point3 }",
    },
    SourceFile { path: "/main.do", source: "import { Camera } from \"./render\"\nfunction main(): int => 0" },
  ]
  analysis := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(analysis.diagnostics.length, 0)
  checker := createChecker(analysis)
  Assert.equal(checker.check("/render.do").diagnostics.length, 0)
  Assert.equal(checker.check("/transform.do").diagnostics.length, 0)
  Assert.equal(checker.check("/main.do").diagnostics.length, 0)
  graph := emitModuleGraph(analysis, "/main.do")
  let renderHeader = ""
  let transformHeader = ""
  for module of graph.modules {
    if module.modulePath == "/render.do" { renderHeader = module.header }
    if module.modulePath == "/transform.do" { transformHeader = module.header }
  }

  renderTransformForward := renderHeader.indexOf("namespace app_transform_ { struct Transform; }")
  renderPointDefinition := renderHeader.indexOf("struct Point3 {")
  renderTransformInclude := renderHeader.indexOf("#include \"transform.hpp\"")
  Assert.isTrue(renderTransformForward >= 0)
  Assert.isTrue(renderTransformForward < renderTransformInclude)
  Assert.isTrue(renderPointDefinition < renderTransformInclude)

  transformPointForward := transformHeader.indexOf("namespace app_render_ { struct Point3; }")
  transformRenderInclude := transformHeader.indexOf("#include \"render.hpp\"")
  transformDefinition := transformHeader.indexOf("struct Transform {")
  Assert.isTrue(transformPointForward >= 0)
  Assert.isTrue(transformPointForward < transformRenderInclude)
  Assert.isTrue(transformDefinition > transformRenderInclude)
}

export function testKeepsImportedStaticDefaultsOutOfHeaders(): void {
  sources := [
    SourceFile { path: "/dep.do", source: "export class Dep { static create(): Dep => Dep {} }" },
    SourceFile { path: "/main.do", source: "import { Dep } from \"./dep\"\nclass Holder { count: int = 1\ndep: Dep = Dep.create() }\nfunction make(): Holder => Holder()" },
  ]
  analysis := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(analysis.diagnostics.length, 0)
  checker := createChecker(analysis)
  Assert.equal(checker.check("/dep.do").diagnostics.length, 0)
  Assert.equal(checker.check("/main.do").diagnostics.length, 0)
  graph := emitModuleGraph(analysis, "/main.do")
  let header = ""
  let source = ""
  for module of graph.modules {
    if module.modulePath == "/main.do" { header = module.header; source = module.source }
  }
  Assert.equal(header.contains("Dep::create()"), false)
  Assert.equal(header.contains("Holder(int32_t count = 1"), false)
  Assert.equal(source.contains("std::make_shared<Holder>(1, ::app_dep_::Dep::create())"), true)
}

export function testEmitsNullableStructParametersAsOptionalValues(): void {
  result := emit("struct Point { x: int }\nfunction read(point: Point | null = null): bool => point == null")
  Assert.equal(result.header.contains("bool read(std::optional<Point> point = std::nullopt)"), true)
  Assert.equal(result.source.contains("doof::is_null(point)"), true)
}

export function testEmitsNullableMapsWithTheirPointerCarrier(): void {
  result := emit("function read(value: Map<string, int> | null): int => value!.size")
  Assert.equal(result.header.contains("std::variant<std::monostate"), false)
  Assert.equal(result.header.contains("std::shared_ptr<doof::ordered_map<std::string, int32_t>> value"), true)
}

export function testKeepsImmutableStructBindingInteriorMutable(): void {
  result := emit("struct Point { x: int\nsum(): int => x }\nfunction read(): int { point := Point(4)\nreturn point.sum() }")
  Assert.equal(result.source.contains("auto point ="), true)
  Assert.equal(result.source.contains("const auto point"), false)
}

export function testUsesBuiltinParseErrorForNumericParseCasePatterns(): void {
  result := emit("function parsed(value: string): bool => case int.parse(value) { success: Success -> true, failure: Failure -> false }")
  Assert.equal(result.source.contains("std::holds_alternative<doof::Failure<doof::ParseError>>"), true)
  Assert.equal(result.source.contains("std::get<doof::Failure<doof::ParseError>>"), true)
}

export function testEmitsEveryNumericParseNamespace(): void {
  result := emit("function parsed(value: string): bool => case double.parse(value) { _: Success -> true, _: Failure -> false }")
  Assert.equal(result.source.contains("doof::parse_double(value)"), true)
}

export function testEmitsEnumsAndTypeAliases(): void {
  result := emit("enum Color { Red, Green = 3 }\ntype MaybeColor = Color | null\nfunction main(): int { color := Color.Red\nreturn 0 }")
  Assert.equal(result.header.contains("enum class Color"), true)
  Assert.equal(result.header.contains("Green = 3"), true)
  Assert.equal(result.header.contains("operator<<(std::ostream& output, Color value)"), true)
  Assert.equal(result.header.contains("using MaybeColor ="), true)
  Assert.equal(result.source.contains("Color::Red"), true)
}

export function testEmitsAssignmentsAndArrayLoops(): void {
  result := emit("function main(): int { let values: int[] = [1, 2]\nvalues[0] = 4\nlet total = 0\nfor item of values { total = total + item }\nreturn total }")
  Assert.equal(result.source.contains("(*values)[0]"), true)
  Assert.equal(result.source.contains("const auto& _iterable_"), true)
  Assert.equal(result.source.contains("for (const auto& item : *_iterable_"), true)
}

export function testKeepsComputedForOfCollectionAlive(): void {
  result := emit("function values(): int[] => [1, 2, 3]\nfunction main(): int { let total = 0\nfor item of values() { total = total + item }\nreturn total }")
  Assert.equal(result.source.contains("const auto& _iterable_"), true)
  Assert.equal(result.source.contains(" = values();"), true)
  Assert.equal(result.source.contains("for (const auto& item : *_iterable_"), true)
  Assert.equal(result.source.contains("for (const auto& item : *values())"), false)
}

export function testEmitsStringCaseAndCallbackCallMembers(): void {
  result := emit("function invoke(handler: (): void): string { handler.call()\nreturn \"HTTP\".toLowerCase() }")
  Assert.equal(result.source.contains("handler.call()"), true)
  Assert.equal(result.source.contains("doof::string_toLowerCase("), true)
  Assert.equal(result.source.contains("HTTP"), true)
}

export function testAvoidsRedundantConditionParentheses(): void {
  result := emit("function main(flag: bool): int { if flag == true { return 1 } return 0 }")
  Assert.equal(result.source.contains("if (flag == true)"), true)
  Assert.equal(result.source.contains("if ((flag == true))"), false)
}

export function testPlansStableModuleNamesAndImportHeaders(): void {
  analysis := createAnalyzer([
    SourceFile { path: "/main.do", source: "import { add } from \"./lib/math\"\nfunction main(): int => add(2, 3)" },
    SourceFile { path: "/lib/math.do", source: "export function add(a: int, b: int): int => a + b" },
  ]).analyze("/main.do")
  Assert.equal(analysis.diagnostics.length, 0)
  plan: ModuleGraphPlan := planModuleGraph(analysis)
  Assert.equal(plan.modules.length, 2)
  Assert.equal(plan.modules[0].path, "/main.do")
  Assert.equal(plan.modules[0].namespaceName, "app_main_")
  Assert.equal(plan.modules[0].headerName, "main.hpp")
  Assert.equal(plan.modules[0].sourceName, "main.cpp")
  Assert.equal(plan.modules[0].includes[0], "lib_math.hpp")
  Assert.equal(plan.modules[1].namespaceName, "app_lib_math_")
  Assert.equal(plan.modules[1].headerName, "lib_math.hpp")
}

export function testEmitsNativeClassInterop(): void {
  result := emit("import class Client from \"<client.hpp>\" as native::Client { value: int get(): int static make(value: int): Client same(): Client { return this } }\nfunction read(client: Client): Client => client\nfunction main(): int { client := Client { value: 4 }\nmade := Client.make(4)\nreturn client.get() + made.get() }")
  Assert.equal(result.header.contains("#include <client.hpp>"), true)
  Assert.equal(result.header.contains("struct Client"), false)
  Assert.equal(result.header.contains("std::shared_ptr<::native::Client>"), true)
  Assert.equal(result.source.contains("std::make_shared<::native::Client>(4)"), true)
  Assert.equal(result.source.contains("::native::Client::make(4)"), true)
  Assert.equal(result.source.contains("std::shared_ptr<::native::Client> native::Client::same()"), true)
  Assert.equal(result.source.contains("this->shared_from_this()"), true)
  Assert.equal(result.source.contains("client->get()"), true)
}

export function testEmitsNativeCppNameThroughLocalExportList(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { NativeImage } from \"./native\"\nfunction load(image: NativeImage): NativeImage => image" },
    SourceFile { path: "/native.do", source: "import class NativeImage from \"native_image.hpp\" as doof_image::NativeImage {}\nexport { NativeImage }" },
  ]
  analysis := createAnalyzer(sources).analyze("/main.do")
  checker := createChecker(analysis)
  Assert.equal(checker.check("/native.do").diagnostics.length, 0)
  Assert.equal(checker.check("/main.do").diagnostics.length, 0)
  graph := emitModuleGraph(analysis, "/main.do")
  let header = ""
  for module of graph.modules { if module.modulePath == "/main.do" { header = module.header } }

  Assert.equal(header.contains("std::shared_ptr<::doof_image::NativeImage>"), true)
  Assert.equal(header.contains("app_native_::NativeImage"), false)
}

export function testResolvesNestedSourceRelativeNativeHeaderIntoPackageOutput(): void {
  path := "/workspace/http-server/tests/http_server.test.do"
  source := "import class NativeRequest from \"../native_http_server_test_support.hpp\" as native::NativeRequest {}"
  analysis := createAnalyzer([SourceFile { path, source }]).analyze(path)
  Assert.equal(analysis.diagnostics.length, 0)
  Assert.equal(createChecker(analysis).check(path).diagnostics.length, 0)
  configureModuleNamespaces([
    ModuleNamespaceMapping {
      logicalPrefix: "/workspace/http-server",
      packageName: "std/http-server",
      outputRoot: "",
    },
  ])
  header := emitModuleGraph(analysis, path).modules[0].header
  configureModuleNamespaces([])

  Assert.equal(header.contains("#include \"native_http_server_test_support.hpp\""), true)
  Assert.equal(header.contains("#include \"../native_http_server_test_support.hpp\""), false)
}

export function testEmitsByteCastBuiltin(): void {
  result := emit("function carriageReturn(): byte => byte(13)")
  Assert.equal(result.source.contains("static_cast<uint8_t>(13)"), true)
  Assert.equal(result.source.contains("byte.call"), false)
}

export function testEmitsExplicitArgumentsForTemplateGenericMethods(): void {
  result := emit("class Assert { static equal<T>(actual: T, expected: T): void {} }\nfunction compare(value: string | null): void { Assert.equal(value, \"ok\") }")
  Assert.equal(result.source.contains("Assert::equal<std::optional<std::string>>"), true)
  Assert.equal(result.source.contains("value, std::string(\"ok\"))"), true)
}

export function testEmitsImportedTypeAliasesForNativeNamespaces(): void {
  sources := [
    SourceFile { path: "/main.do", source: "export { EncodingError } from \"./types\"\nimport class Native from \"native.hpp\" as doof_blob::Native { error(): EncodingError }\nfunction read(value: Native): EncodingError => value.error()" },
    SourceFile { path: "/types.do", source: "export enum EncodingError { Invalid }" },
  ]
  analysis := createAnalyzer(sources).analyze("/main.do")
  checker := createChecker(analysis)
  Assert.equal(checker.check("/types.do").diagnostics.length, 0)
  Assert.equal(checker.check("/main.do").diagnostics.length, 0)
  graph := emitModuleGraph(analysis, "/main.do")
  let header = ""
  for module of graph.modules { if module.modulePath == "/main.do" { header = module.header } }
  Assert.equal(header.contains("namespace doof_blob { using EncodingError = ::app_types_::EncodingError; }"), true)
}

export function testEmitsNativeAliasesForImportedModuleTypeSurface(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { FileInfo, IoError } from \"./types\"\nexport { EntryKind } from \"./types\"\nimport class NativeReader from \"native.hpp\" as NativeReader { error(): IoError }\nexport import function metadata(path: string): Result<FileInfo, IoError> from \"native.hpp\" as doof_fs::metadata" },
    SourceFile { path: "/types.do", source: "import { Instant } from \"./time\"\nexport enum EntryKind { File }\nexport enum IoError { Other }\nexport class FileInfo { kind: EntryKind\nmodifiedAt: Instant }" },
    SourceFile { path: "/time.do", source: "export class Instant {}\nexport class Duration {}" },
  ]
  analysis := createAnalyzer(sources).analyze("/main.do")
  checker := createChecker(analysis)
  Assert.equal(checker.check("/time.do").diagnostics.length, 0)
  Assert.equal(checker.check("/types.do").diagnostics.length, 0)
  Assert.equal(checker.check("/main.do").diagnostics.length, 0)
  graph := emitModuleGraph(analysis, "/main.do")
  let header = ""
  for module of graph.modules { if module.modulePath == "/main.do" { header = module.header } }
  Assert.isTrue(header.indexOf("#include \"types.hpp\"") < header.indexOf("namespace doof_fs"))
  Assert.equal(header.contains("namespace doof_fs { using EntryKind = ::app_types_::EntryKind; }"), true)
  Assert.equal(header.contains("namespace doof_fs { using Instant = ::app_time_::Instant; }"), true)
  Assert.equal(header.contains("using IoError = ::app_types_::IoError;"), true)
  Assert.equal(header.contains("using Duration = ::app_time_::Duration;"), false)
}

export function testDoesNotForwardDeclareOrAliasImportedGenericTypesForNativeHeaders(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { Channel, createChannel } from \"./event\"\nimport class Native from \"native.hpp\" as native::Native {}\nfunction receive(channel: Channel<int>): void { created := createChannel<int>() }" },
    SourceFile { path: "/event.do", source: "export class Channel<T> {}\nexport function createChannel<T>(): Channel<T> => Channel<T> {}" },
  ]
  analysis := createAnalyzer(sources).analyze("/main.do")
  checker := createChecker(analysis)
  Assert.equal(checker.check("/event.do").diagnostics.length, 0)
  Assert.equal(checker.check("/main.do").diagnostics.length, 0)
  graph := emitModuleGraph(analysis, "/main.do")
  let header = ""
  for module of graph.modules { if module.modulePath == "/main.do" { header = module.header } }
  Assert.equal(header.contains("namespace app_event_ { struct Channel; }"), false)
  Assert.equal(header.contains("namespace native { using Channel = ::app_event_::Channel; }"), false)
  Assert.equal(header.contains("namespace native { using ::app_event_::createChannel; }"), false)
}

export function testEmitsInterfaceVariantsAndDispatch(): void {
  result := emit("interface Drawable { value: int\nrender(): int }\nclass Point implements Drawable { readonly value: int\nfunction render(): int => value }\nfunction read(shape: Drawable): int => shape.render()\nfunction main(): int { point := Point { value: 5 }\nshape: Drawable := point\nreturn read(shape) + shape.value }")
  Assert.equal(result.header.contains("using Drawable = std::variant<std::shared_ptr<Point>>;"), true)
  Assert.equal(result.source.contains("const Drawable shape = point;"), true)
  Assert.equal(result.source.contains("std::visit([&](auto&& _obj) { return _obj->render(); }, shape)"), true)
  Assert.equal(result.source.contains("std::visit([](auto&& _obj) { return _obj->value; }, shape)"), true)
}

export function testEmitsIntrinsicJsonValueLiterals(): void {
  result := emit("function main(): JsonValue { payload: JsonValue := { name: \"Ada\", values: [1, true] }\nreturn payload }")
  Assert.equal(result.header.contains("doof::JsonValue"), true)
  Assert.equal(result.source.contains("doof::ordered_map<std::string, doof::JsonValue>"), true)
  Assert.equal(result.source.contains("doof::json_value"), true)
}

export function testParsesNativeJsonFunctionSurface(): void {
  native := emit("export import function formatJsonValue(value: JsonValue): string from \"<json.hpp>\" as doof_json::format")
  Assert.equal(native.header.contains("#include <json.hpp>"), true)
  result := emitSources([
    SourceFile { path: "/main.do", source: "import { formatJsonValue } from \"./json\"\nfunction main(): string => formatJsonValue({ ok: true })" },
    SourceFile { path: "/json.do", source: "export import function formatJsonValue(value: JsonValue): string from \"<json.hpp>\" as doof_json::format" },
  ], "/main.do")
  Assert.equal(result.source.contains("doof_json::format"), true)
}

export function testEmitsContextualResultAndClassObjectLiterals(): void {
  result := emit("class Payload { count: int }\nfunction load(): Result<Payload, string> => { value: { count: 4 } }")
  Assert.equal(result.source.contains("doof::Success<std::shared_ptr<Payload>>"), true)
  Assert.equal(result.source.contains("std::make_shared<Payload>"), true)
}

export function testEmitsResultPayloadAccessThroughRuntimeHelpers(): void {
  result := emit("function load(): Result<int, string> => Failure { error: \"bad\" }\nfunction read(): Result<int, string> { value := load() else { return { error: value.error } }\nreturn { value } }")
  Assert.equal(result.source.contains("doof::failure_error(value)"), true)
}

export function testEmitsAsNarrowingOverResultValues(): void {
  result := emit("function parse(): Result<JsonValue, string> => Success { value: \"ok\" }\nfunction read(): Result<string, string> { value := parse() as string else { return { error: value.error } }\nreturn { value } }")
  Assert.equal(result.source.contains("if (doof::is_failure(_as_source))"), true)
  Assert.equal(result.source.contains("auto _as_value = doof::success_value(_as_source)"), true)
  Assert.equal(result.source.contains("doof::json_as_string(_as_value)"), true)
}

export function testDoesNotTreatFunctionsReturningNativeClassesAsConstructors(): void {
  result := emit("import class Handle from \"handle.hpp\" as native::Handle { value(): int }\nimport function open(): Handle from \"handle.hpp\" as native::open\nfunction read(): int => open().value()")
  Assert.equal(result.source.contains("native::open()"), true)
  Assert.equal(result.source.contains("make_shared<::native::Handle>()"), false)
}

export function testDoesNotTreatImplicitMethodsReturningNominalTypesAsConstructors(): void {
  result := emit("struct Token { kind: int }\nstruct Location { line: int }\nclass Parser { current(): Token => Token { kind: 1 }\nlocation(): Location => Location { line: 2 }\natEnd(): bool => current().kind == 0\nstart(): int => location().line }")
  Assert.equal(result.source.contains("current().kind"), true)
  Assert.equal(result.source.contains("location().line"), true)
  Assert.equal(result.source.contains("Token{}.kind"), false)
  Assert.equal(result.source.contains("Location{}.line"), false)
}

export function testEmitsYieldBlockDeclarationsAndReassignment(): void {
  result := emit("function main(): int { let value <- { if true { yield 1 } else { yield 2 } }\nvalue <- { yield value + 1 }\nreturn value }")
  Assert.stringContains(result.source, "auto value = [&]() -> int32_t")
  Assert.stringContains(result.source, "value = [&]() -> int32_t")
  Assert.stringContains(result.source, "return (value + 1)")
}

export function testEmitsYieldBlockReassignmentToCapturedMutable(): void {
  result := emit("function make(): (): int { let value = 0\nread := (): int => value\nvalue <- { yield value + 1 }\nreturn read }")
  Assert.stringContains(result.source, "auto value = std::make_shared<int32_t>(0)")
  Assert.stringContains(result.source, "(*value) = [&]() -> int32_t")
}

export function testEmitsCatchExpressionsWithRedirectedTryFailures(): void {
  result := emit("enum LoadError { Missing }\nfunction load(ok: bool): Result<int, LoadError> { if ok { return Success { value: 1 } }\nreturn Failure { error: .Missing } }\nfunction main(): int { error := catch { try value := load(false)\nprintln(string(value)) }\nreturn case error { _: LoadError -> 1, _ -> 0 } }")
  Assert.stringContains(result.source, "do {")
  Assert.stringContains(result.source, "doof::variant_promote<")
  Assert.stringContains(result.source, "doof::failure_error(_try_value_")
  Assert.stringContains(result.source, "break;")
}

export function testEmitsCompleteDestructuringSurface(): void {
  result := emit("class Person { name: string\nage: int }\nstruct Pair { left: int\nright: string }\nfunction main(): int { values := [1, 2, 3]\n[first, _, third] := values\nperson := Person { name: \"Ada\", age: 37 }\n{ name as displayName, age } := person\npair := Pair { left: 4, right: \"ok\" }\n(left, right) := pair\nlet target = 0\n[target, _] = values\nlet renamed = \"\"\n{ name as renamed } = person\nreturn first + third + age + left + target + displayName.length + right.length + renamed.length }")
  Assert.stringContains(result.source, "doof::array_require_min_size(")
  Assert.stringContains(result.source, "doof::array_at(")
  Assert.stringContains(result.source, "->name")
  Assert.stringContains(result.source, "->age")
  Assert.stringContains(result.source, ".left")
  Assert.stringContains(result.source, ".right")
  Assert.stringContains(result.source, "target = doof::array_at(")
  Assert.stringContains(result.source, "renamed = _destructure_")
}

export function testEmitsTryDestructuringFromSuccessPayload(): void {
  result := emit("function load(): Result<Tuple<int, int>, string> => Success { value: (1, 2) }\nfunction run(): Result<int, string> { try (left, right) := load()\nreturn Success { value: left + right } }")
  Assert.stringContains(result.source, "doof::success_value(_try_value_")
  Assert.stringContains(result.source, "std::get<0>(")
  Assert.stringContains(result.source, "std::get<1>(")
}
