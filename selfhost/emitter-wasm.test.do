import { Assert } from "std/assert"
import { compileWithLoader } from "./compiler"
import { noSourceLoader } from "./resolver"
import { SourceFile } from "./semantic"

export function testEmitsJsonAbiWrappersForExportedFunctions(): void {
  result := compileWithLoader([
    SourceFile {
      path: "/main.do",
      source: "export function add(a: int, b: int = 2): int => a + b\nfunction main(): int => 0",
    },
  ], "/main.do", noSourceLoader, [], "wasm")

  for diagnostic of result.diagnostics { println(diagnostic.message) }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  Assert.equal(result.emission!.wasmExportNames.length, 1)
  Assert.equal(result.emission!.wasmExportNames[0], "doof_export_add")
  Assert.stringContains(result.emission!.wasmSupportSource, "extern \"C\" void doof_free(char* ptr)")
  Assert.stringContains(result.emission!.wasmSupportSource, "extern \"C\" char* doof_export_add(const char* params_json)")
  Assert.stringContains(result.emission!.wasmSupportSource, "::app_main_::add(a, b)")
  Assert.equal(result.emission!.modules[0].source.contains("int main("), false)
}

export function testRejectsGenericWasmExports(): void {
  result := compileWithLoader([
    SourceFile { path: "/main.do", source: "export function identity<T>(value: T): T => value" },
  ], "/main.do", noSourceLoader, [], "wasm")

  Assert.equal(result.emission == null, true)
  Assert.equal(result.diagnostics.length, 1)
  Assert.stringContains(result.diagnostics[0].message, "cannot be generic")
}

export function testRejectsUnsupportedWasmAbiTypes(): void {
  result := compileWithLoader([
    SourceFile { path: "/main.do", source: "export function count(values: Set<int>): int => values.size" },
  ], "/main.do", noSourceLoader, [], "wasm")

  Assert.equal(result.emission == null, true)
  Assert.equal(result.diagnostics.length, 1)
  Assert.stringContains(result.diagnostics[0].message, "must be supported by the JSON ABI")
}

export function testIncludesFunctionsExportedByASeparateList(): void {
  result := compileWithLoader([
    SourceFile { path: "/main.do", source: "function add(a: int, b: int): int => a + b\nexport { add }" },
  ], "/main.do", noSourceLoader, [], "wasm")

  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission!.wasmExportNames[0], "doof_export_add")
}
