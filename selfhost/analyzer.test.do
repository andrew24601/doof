import { Assert } from "std/assert"
import { createAnalyzer, createAnalyzerWithLoader } from "./analyzer"
import { Diagnostic, SemanticLocation, SemanticSpan, SourceFile } from "./semantic"
import { ClassDeclaration, FunctionDeclaration, NamedType } from "./ast"

export function testResolvesImportsAndExports(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { add } from \"./math\"\nfunction main(): int => add(1, 2)" },
    SourceFile { path: "/math.do", source: "export function add(a: int, b: int): int => a + b" },
  ]
  result := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.modules.length, 2)
  Assert.equal(result.modules[0].imports.length, 1)
  Assert.equal(result.modules[0].imports[0].localName, "add")
  Assert.equal(result.modules[0].imports[0].symbol != null, true)
}

export function testSuppressesMissingExportsWhenDependencyFailsToParse(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { first, second } from \"./broken\"\nfunction main(): void { }" },
    SourceFile { path: "/broken.do", source: "export readonly value: readonly string = \"broken\"" },
  ]
  result := createAnalyzer(sources).analyze("/main.do")

  Assert.equal(result.diagnostics.length, 1)
  Assert.equal(result.diagnostics[0].module, "/broken.do")
  Assert.equal(result.diagnostics[0].message.contains("Unexpected readonly type modifier"), true)
}

export function testResolvesExplicitBareModuleSources(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { add } from \"vendor/math\"\nfunction main(): int => add(1, 2)" },
    SourceFile { path: "/vendor/math.do", source: "export function add(a: int, b: int): int => a + b" },
  ]
  result := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.modules.length, 2)
  Assert.equal(result.modules[0].imports[0].sourceModule, "/vendor/math.do")
}

export function testDecoratesNamedTypes(): void {
  sources := [SourceFile {
    path: "/main.do",
    source: "class Point { x: int }\nfunction read(point: Point): int => point.x",
  }]
  result := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
  case result.modules[0].program.statements[1] {
    fn: FunctionDeclaration -> {
      case fn.params[0].type_! {
        named: NamedType -> { Assert.equal(named.resolvedSymbol != null, true) }
        _ -> { panic("expected a named type") }
      }
    }
    _ -> { panic("expected a function") }
  }
}

export function testRecognizesBuiltinTupleType(): void {
  result := createAnalyzer([SourceFile {
    path: "/main.do",
    source: "function pair<T>(value: T): Tuple<T, T> => (value, value)",
  }]).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
}

export function testResolvesReExportsToDefiningModule(): void {
  sources := [
    SourceFile { path: "/main.do", source: "import { sum } from \"./index\"\nfunction main(): int => sum(1, 2)" },
    SourceFile { path: "/index.do", source: "export { add as sum } from \"./math\"" },
    SourceFile { path: "/math.do", source: "export function add(a: int, b: int): int => a + b" },
  ]
  result := createAnalyzer(sources).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.modules[1].reExports.length, 1)
  Assert.equal(result.modules[0].imports[0].symbol != null, true)
  Assert.equal(result.modules[0].imports[0].symbol!.module, "/math.do")
}

export function testRecordsNativeClassMetadata(): void {
  result := createAnalyzer([SourceFile {
    path: "/main.do",
    source: "export import class Client from \"client.hpp\" as native::Client { get(): int }",
  }]).analyze("/main.do")
  Assert.equal(result.diagnostics.length, 0)
  case result.modules[0].program.statements[0] {
    class_: ClassDeclaration -> {
      Assert.equal(class_.native_, true)
      Assert.equal(result.modules[0].symbols[0].native_, true)
      Assert.equal(result.modules[0].symbols[0].nativeHeader, "client.hpp")
      Assert.equal(result.modules[0].symbols[0].nativeCppName, "native::Client")
    }
    _ -> { panic("expected native class declaration") }
  }
}

export function testAnalyzesOnlyTransitiveSourcesWithLoader(): void {
  let requested: string[] = []
  loader := (path: string): Result<SourceFile | null, Diagnostic> => {
    requested.push(path)
    if path == "/math.do" {
      return Success(SourceFile { path, source: "export function add(left: int, right: int): int => left + right" })
    }
    if path == "/unused.do" {
      return Success(SourceFile { path, source: "this is not valid Doof" })
    }
    return Success(null)
  }
  result := createAnalyzerWithLoader([
    SourceFile { path: "/main.do", source: "import { add } from \"./math\"\nfunction main(): int => add(1, 2)" },
  ], loader).analyze("/main.do")

  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.modules.length, 2)
  Assert.equal(requested.length, 1)
  Assert.equal(requested[0], "/math.do")
}

export function testReportsLoaderFailureWithoutModuleNotFoundDiagnostic(): void {
  zero := SemanticLocation { line: 0, column: 0, offset: 0 }
  loader := (path: string): Result<SourceFile | null, Diagnostic> => Failure(Diagnostic {
    severity: "error",
    message: "Could not read source file: permission denied",
    span: SemanticSpan { start: zero, end: zero },
    module: path,
  })
  result := createAnalyzerWithLoader([], loader).analyze("/main.do")

  Assert.equal(result.diagnostics.length, 1)
  Assert.equal(result.diagnostics[0].message, "Could not read source file: permission denied")
}
