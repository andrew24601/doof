import { Assert } from "std/assert"
import { readText } from "std/fs"
import { createAnalyzer } from "./analyzer"
import { createChecker } from "./checker"
import { AnalysisResult } from "./analyzer"
import { Program } from "./ast"
import { SourceFile } from "./semantic"
import { ModuleEmission, ModuleGraphEmission, emitModule, emitModuleGraph, ModuleGraphPlan, planModuleGraph } from "./emitter-module"

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

function emitFile(path: string): ModuleEmission {
  source := try! readText(path)
  semantic := try! readText("selfhost/semantic.do")
  return emitSources([
    SourceFile { path: "/main.do", source },
    SourceFile { path: "/semantic.do", source: semantic },
  ], "/main.do")
}

function emitAstProject(): ModuleGraphEmission {
  ast := try! readText("selfhost/ast.do")
  semantic := try! readText("selfhost/semantic.do")
  analysis := createAnalyzer([
    SourceFile { path: "/selfhost/ast.do", source: ast },
    SourceFile { path: "/selfhost/semantic.do", source: semantic },
  ]).analyze("/selfhost/ast.do")
  Assert.equal(analysis.diagnostics.length, 0)
  checker := createChecker(analysis)
  Assert.equal(checker.check("/selfhost/semantic.do").diagnostics.length, 0)
  Assert.equal(checker.check("/selfhost/ast.do").diagnostics.length, 0)
  return emitModuleGraph(analysis, "/selfhost/ast.do")
}

function findProgram(analysis: AnalysisResult, path: string): Program | null {
  for module of analysis.modules { if module.path == path { return module.program } }
  return null
}

export function testKeepsHeaderAndSourceSeparate(): void {
  result := emit("function add(a: int, b: int): int => a + b\nfunction main(): int => add(2, 3)")
  Assert.equal(result.header.contains("int32_t add(int32_t a, int32_t b);"), true)
  Assert.equal(result.header.contains("return a + b"), false)
  Assert.equal(result.source.contains("int32_t add(int32_t a, int32_t b)"), true)
  Assert.equal(result.source.contains("int main() { return main_::doof_main(); }"), true)
}

export function testEmitsCheckedCoreExpressions(): void {
  result := emit("function main(): int { values: int[] := [1, 2, 3]\nreturn values[1] + 4 }")
  Assert.equal(result.source.contains("std::make_shared<std::vector<int32_t>>"), true)
  Assert.equal(result.source.contains("(*values)[1]"), true)
  Assert.equal(result.source.contains("return ("), true)
}

export function testEmitsArrayAndStringSearchMembers(): void {
  result := emit("function main(): int { values := [1, 2, 3]\ntext := \"hello\"\nif values.contains(2) && text.contains(\"ell\") { return values.indexOf(3) + text.indexOf(\"e\") }\nreturn 0 }")
  Assert.equal(result.source.contains("doof::array_contains(values, 2"), true)
  Assert.equal(result.source.contains("doof::array_indexOf(values, 3"), true)
  Assert.equal(result.source.contains("doof::string_contains(text, "), true)
  Assert.equal(result.source.contains("doof::string_indexOf(text, "), true)
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
  Assert.equal(result.source.contains("std::make_shared<Point>(Point{4})"), true)
}

export function testEmitsStrictPrimitiveJsonDeserialization(): void {
  result := emit("class Config { name: string\nenabled: bool\ncount: int = 10\nnotes: string | null = null }\nfunction parse(value: JsonValue): Result<Config, string> => Config.fromJsonValue(value)")
  Assert.equal(result.header.contains("static doof::Result<std::shared_ptr<Config>, std::string> fromJsonValue(const doof::JsonValue& _json);"), true)
  Assert.equal(result.source.contains("const auto* _object = doof::json_as_object(_json);"), true)
  Assert.equal(result.source.contains("Missing required field \\\"name\\\""), true)
  Assert.equal(result.source.contains("Field \\\"enabled\\\" expected boolean but got"), true)
  Assert.equal(result.source.contains("_field_count = 10;"), true)
  Assert.equal(result.source.contains("_field_notes = std::nullopt;"), true)
  Assert.equal(result.source.contains("doof::json_is_null(_iterator_notes->second)"), true)
  Assert.equal(result.source.contains("std::make_shared<Config>(Config{_field_name, _field_enabled, _field_count, _field_notes})"), true)
}

export function testEmitsStructJsonDeserializationByValue(): void {
  result := emit("struct Point { x: int\ny: double }\nfunction parse(value: JsonValue): Result<Point, string> => Point.fromJsonValue(value)")
  Assert.equal(result.header.contains("static doof::Result<Point, std::string> fromJsonValue(const doof::JsonValue& _json);"), true)
  Assert.equal(result.source.contains("return doof::Success<Point>{Point{_field_x, _field_y}};"), true)
  Assert.equal(result.source.contains("std::make_shared<Point>"), false)
}

export function testPreservesJsonCollectionSerialization(): void {
  result := emit("class Payload { items: JsonValue[]\nvalues: Map<string, JsonValue> }\nfunction serialize(value: Payload): JsonObject => value.toJsonObject()")
  Assert.equal(result.header.contains("doof::JsonObject toJsonObject() const;"), true)
  Assert.equal(result.header.contains("fromJsonValue"), false)
  Assert.equal(result.source.contains("doof::json_value(this->items)"), true)
  Assert.equal(result.source.contains("doof::json_value(this->values)"), true)
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

export function testEmitsVariantCaseBindings(): void {
  result := emit("class Left { value: int }\nclass Right { value: int }\nfunction main(value: Left | Right): int { case value { left: Left -> { return left.value } _ -> { return 0 } }\nreturn 0 }")
  Assert.equal(result.source.contains("std::holds_alternative<std::shared_ptr<Left>>(_case_subject)"), true)
  Assert.equal(result.source.contains("std::get<std::shared_ptr<Left>>(_case_subject)"), true)
  Assert.equal(result.source.contains("else {"), true)
}

export function testEmitsSelfhostAstModule(): void {
  result := emitFile("selfhost/ast.do")
  Assert.equal(result.header.contains("struct Program"), true)
  Assert.equal(result.header.contains("struct FunctionDeclaration"), true)
  Assert.equal(result.header.contains("std::shared_ptr"), true)
}

export function testEmitsSelfhostAstAndSemanticProject(): void {
  result := emitAstProject()
  Assert.equal(result.modules.length, 2)
  Assert.equal(result.modules[0].header.contains("struct Program"), true)
  Assert.equal(result.modules[1].header.contains("struct Symbol"), true)
  Assert.equal(result.modules[1].header.contains("std::variant<std::monostate, std::shared_ptr<PrimitiveType>"), true)
  Assert.equal(result.modules[1].header.contains("returnType = std::monostate{};"), true)
  Assert.equal(result.modules[1].header.contains("thisType = std::monostate{};"), true)
  Assert.equal(result.modules[0].header.contains("namespace app_selfhost_ast_"), true)
}

export function testHeaderPlannerIncludesRequiredStandardLibrary(): void {
  result := emit("function square(value: double): double => value ** value")
  Assert.equal(result.header.startsWith("#pragma once\n#include \"doof_runtime.hpp\"\n"), true)
  Assert.equal(result.header.contains("#include <cmath>"), true)
  Assert.equal(result.source.contains("std::pow(value, value)"), true)
}

export function testEmitsEnumsAndTypeAliases(): void {
  result := emit("enum Color { Red, Green = 3 }\ntype MaybeColor = Color | null\nfunction main(): int { color := Color.Red\nreturn 0 }")
  Assert.equal(result.header.contains("enum class Color"), true)
  Assert.equal(result.header.contains("Green = 3"), true)
  Assert.equal(result.header.contains("using MaybeColor ="), true)
  Assert.equal(result.source.contains("Color::Red"), true)
}

export function testEmitsAssignmentsAndArrayLoops(): void {
  result := emit("function main(): int { let values: int[] = [1, 2]\nvalues[0] = 4\nlet total = 0\nfor item of values { total = total + item }\nreturn total }")
  Assert.equal(result.source.contains("(*values)[0]"), true)
  Assert.equal(result.source.contains("for (const auto& item : *values)"), true)
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
  Assert.equal(header.contains("namespace doof_fs { using EntryKind = ::app_types_::EntryKind; }"), true)
  Assert.equal(header.contains("namespace doof_fs { using Instant = ::app_time_::Instant; }"), true)
  Assert.equal(header.contains("using IoError = ::app_types_::IoError;"), true)
  Assert.equal(header.contains("using Duration = ::app_time_::Duration;"), false)
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
