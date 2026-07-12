import { Assert } from "std/assert"
import { createAnalyzer } from "./analyzer"
import { SourceFile } from "./semantic"
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
