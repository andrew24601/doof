import { Assert } from "std/assert"
import { readText } from "std/fs"
import { createAnalyzer } from "./analyzer"
import { createChecker } from "./checker"
import { AnalysisResult } from "./analyzer"
import { Program } from "./ast"
import { SourceFile } from "./semantic"
import { ModuleEmission, emitModule, ModuleGraphPlan, planModuleGraph } from "./emitter-module"
import { emitProject } from "./emitter-project"

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

function emitFile(path: string): ModuleEmission {
  source := try! readText(path)
  semantic := try! readText("selfhost/semantic.do")
  return emitSources([
    SourceFile { path: "/main.do", source },
    SourceFile { path: "/semantic.do", source: semantic },
  ], "/main.do")
}

function emitAstProject(): ModuleEmission {
  ast := try! readText("selfhost/ast.do")
  semantic := try! readText("selfhost/semantic.do")
  analysis := createAnalyzer([
    SourceFile { path: "/main.do", source: ast },
    SourceFile { path: "/semantic.do", source: semantic },
  ]).analyze("/main.do")
  Assert.equal(analysis.diagnostics.length, 0)
  checker := createChecker(analysis)
  Assert.equal(checker.check("/main.do").diagnostics.length, 0)
  Assert.equal(checker.check("/semantic.do").diagnostics.length, 0)
  return emitProject(analysis)
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

export function testEmitsClassesMethodsAndConstruction(): void {
  result := emit("class Point { x: int\nfunction double(): int => x * 2 }\nfunction main(): int { point := Point { x: 4 }\nreturn point.double() }")
  Assert.equal(result.header.contains("struct Point"), true)
  Assert.equal(result.header.contains("int32_t x;"), true)
  Assert.equal(result.header.contains("int32_t double();"), true)
  Assert.equal(result.source.contains("int32_t Point::double()"), true)
  Assert.equal(result.source.contains("this->x"), true)
  Assert.equal(result.source.contains("std::make_shared<Point>(Point{4})"), true)
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
  Assert.equal(result.header.contains("struct Program"), true)
  Assert.equal(result.header.contains("struct Symbol"), true)
  Assert.equal(result.header.contains("namespace selfhost_"), true)
}

export function testHeaderPlannerIncludesRequiredStandardLibrary(): void {
  result := emit("function square(value: double): double => value ** value")
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
