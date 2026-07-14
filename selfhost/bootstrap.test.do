// Maintained bootstrap acceptance test for the complete self-hosted source graph.
// The final test exercises both the first generated compiler and the second
// compiler produced from the same graph.

import { Assert } from "std/assert"
import { decodeUtf8 } from "std/blob"
import { exists, mkdir, readText, writeText } from "std/fs"
import { ExecOptions, run } from "std/os"
import { currentWorkingDirectory } from "std/path"
import { Compilation, compileWithLoader } from "./compiler"
import { ModuleGraphEmission } from "./emitter-module"
import { moduleHeaderName, moduleSourceName } from "./emitter-names"
import { environmentValue } from "./project"
import { SourceFile } from "./semantic"

function selfhostSourcePath(path: string): string {
  cwd := try! currentWorkingDirectory()
  direct := cwd + "/selfhost/" + path
  if exists(direct) { return direct }
  return cwd + "/../../../selfhost/" + path
}

function bootstrapStdTimeSource(): string {
  return "export class Instant {\n  epochNanos: long\n  static ofEpochSeconds(seconds: long): Instant => Instant { epochNanos: seconds * 1000000000L }\n}\n"
}

function bootstrapSource(logicalPath: string): SourceFile | null {
  if logicalPath.startsWith("/selfhost/") {
    relativePath := logicalPath.substring(10, logicalPath.length)
    diskPath := selfhostSourcePath(relativePath)
    if exists(diskPath) { return SourceFile { path: logicalPath, source: try! readText(diskPath) } }
    return null
  }
  if logicalPath == "/std/time/index.do" {
    return SourceFile { path: logicalPath, source: bootstrapStdTimeSource() }
  }
  if logicalPath.startsWith("/std/") {
    diskPath := "../doof-stdlib/" + logicalPath.substring(5, logicalPath.length)
    if exists(diskPath) { return SourceFile { path: logicalPath, source: try! readText(diskPath) } }
  }
  return null
}

function compileBootstrap(entry: string): Compilation {
  return compileWithLoader([], entry, bootstrapSource)
}

function writeSelfhostJsonSupport(): void {
  try! writeText("/tmp/native_json.hpp", try! readText("../doof-stdlib/json/native_json.hpp"))
}

function writeRuntime(): void {
  try! writeText("/tmp/doof_runtime.hpp", try! readText("doof_runtime.h"))
}

function writeBootstrapStdFsSupport(): void {
  try! writeText("/tmp/native_path.hpp", try! readText("../doof-stdlib/path/native_path.hpp"))
  try! writeText("/tmp/native_blob.hpp", try! readText("../doof-stdlib/blob/native_blob.hpp"))
  try! writeText("/tmp/native_fs.hpp", try! readText("../doof-stdlib/fs/native_fs.hpp"))
  try! writeText("/tmp/types.hpp", "#pragma once\n#include \"std_blob_types.hpp\"\n#include \"std_fs_types.hpp\"\nusing EntryKind = ::app_std_fs_types_::EntryKind;\nusing IoError = ::app_std_fs_types_::IoError;\nusing Endian = ::app_std_blob_types_::Endian;\nusing TextEncoding = ::app_std_blob_types_::TextEncoding;\nusing EncodingError = ::app_std_blob_types_::EncodingError;\nusing Instant = ::app_std_time_index_::Instant;\nnamespace doof_fs { using EntryKind = ::app_std_fs_types_::EntryKind; using IoError = ::app_std_fs_types_::IoError; using Instant = ::app_std_time_index_::Instant; using ::app_std_fs_types_::IoError_name; }\n")
}

function writeSplitArtifacts(graph: ModuleGraphEmission): string[] {
  let sourcePaths: string[] = []
  for module of graph.modules {
    try! writeText("/tmp/" + module.headerName, module.header)
    sourcePath := "/tmp/" + module.sourceName
    try! writeText(sourcePath, module.source)
    sourcePaths.push(sourcePath)
  }
  return sourcePaths
}

function buildSeedDriver(binaryPath: string): string {
  result := compileBootstrap("/selfhost/driver.do")
  if result.diagnostics.length > 0 {
    for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)

  driverSources := writeSplitArtifacts(result.emission!)
  writeRuntime()
  writeBootstrapStdFsSupport()
  writeSelfhostJsonSupport()

  let linkArgs: string[] = ["-std=c++17", "-framework", "CoreFoundation"]
  for sourcePath of driverSources { linkArgs.push(sourcePath) }
  linkArgs.push("-o")
  linkArgs.push(binaryPath)
  linked := try! run("clang++", linkArgs)
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 8)) }
  Assert.equal(linked.exitCode, 0)
  return binaryPath
}

function buildNextCompiler(compilerBinary: string, outputDirectory: string): string {
  built := try! run(
    compilerBinary,
    ["build", selfhostSourcePath("driver.do"), "-o", outputDirectory, "--compiler", "clang++"],
    ExecOptions { env: { "DOOF_STDLIB_ROOT": absolutePath("../doof-stdlib") } },
  )
  if built.exitCode != 0 { println(decodeUtf8(built.stdout)!) }
  if built.exitCode != 0 { println(firstStderrLines(decodeUtf8(built.stderr)!, 40)) }
  Assert.equal(built.exitCode, 0)
  return outputDirectory + "/doof"
}

function assertCompilerEmitsRunnableProgram(compilerBinary: string, stage: string): void {
  entry := "/tmp/doof-" + stage + "-main.do"
  math := "/tmp/doof-" + stage + "-math.do"
  outputDirectory := "/tmp/doof-" + stage + "-generated"
  try! writeText(entry, "import { add } from \"./doof-" + stage + "-math\"\nfunction main(): int => add(2, 3)\n")
  try! writeText(math, "export function add(left: int, right: int): int => left + right\n")

  emitted := try! run(compilerBinary, ["emit", entry, "-o", outputDirectory])
  if emitted.exitCode != 0 { println(decodeUtf8(emitted.stdout)!) }
  if emitted.exitCode != 0 { println(decodeUtf8(emitted.stderr)!) }
  Assert.equal(emitted.exitCode, 0)

  programBinary := "/tmp/doof-" + stage + "-generated-program"
  linked := try! run("clang++", [
    "-std=c++17",
    outputDirectory + "/" + moduleSourceName(entry),
    outputDirectory + "/" + moduleSourceName(math),
    "-I", outputDirectory,
    "-o", programBinary,
  ])
  if linked.exitCode != 0 { println(firstStderrLines(decodeUtf8(linked.stderr)!, 8)) }
  Assert.equal(linked.exitCode, 0)
  executed := try! run(programBinary)
  Assert.equal(executed.exitCode, 5)
}

function firstStderrLines(stderr: string, maxLines: int): string {
  lines := stderr.split("\n")
  limit := if lines.length < maxLines then lines.length else maxLines
  let result = ""
  for i of 0..<limit {
    if i > 0 { result = result + "\n" }
    result = result + lines[i]
  }
  if lines.length > maxLines { result = result + "\n... stderr truncated ..." }
  return result
}

export function testCompilesSelfhostSourceGraph(): void {
  result := compileBootstrap("/selfhost/compiler.do")
  if result.diagnostics.length > 0 {
    for diagnostic of result.diagnostics { println(diagnostic.module + ": " + diagnostic.message) }
  }
  Assert.equal(result.diagnostics.length, 0)
  Assert.equal(result.emission != null, true)
  let nativeArgs: string[] = ["-std=c++17", "-fsyntax-only"]
  for sourcePath of writeSplitArtifacts(result.emission!) { nativeArgs.push(sourcePath) }
  writeRuntime()
  native := try! run("clang++", nativeArgs)
  if native.exitCode != 0 { println(firstStderrLines(decodeUtf8(native.stderr)!, 8)) }
  Assert.equal(native.exitCode, 0)
}

export function testRunsSelfhostCompilerDriver(): void {
  driverBinary := buildSeedDriver("/tmp/doof-selfhost-driver")

  entry := "/tmp/doof-b4-main.do"
  math := "/tmp/doof-b4-math.do"
  outputDirectory := "/tmp/doof-b4-generated"
  try! writeText(entry, "import { add } from \"doof-b4-math\"\nfunction main(): int => add(2, 3)\n")
  try! writeText(math, "export function add(left: int, right: int): int => left + right\n")

  generated := try! run(driverBinary, ["emit", entry, "-o", outputDirectory, "--module", "doof-b4-math", math])
  if generated.exitCode != 0 { println(decodeUtf8(generated.stdout)!) }
  if generated.exitCode != 0 { println(decodeUtf8(generated.stderr)!) }
  Assert.equal(generated.exitCode, 0)
  Assert.equal(
    try! readText(outputDirectory + "/doof_runtime.hpp"),
    try! readText("doof_runtime.h"),
  )
  generatedHeader := try! readText(outputDirectory + "/" + moduleHeaderName(entry))
  generatedSource := try! readText(outputDirectory + "/" + moduleSourceName(entry))
  Assert.equal(generatedHeader.length > 0, true)
  Assert.equal(generatedSource.length > 0, true)

  checked := try! run(driverBinary, ["check", entry, "--module", "doof-b4-math", math])
  Assert.equal(checked.exitCode, 0)

  acquiredStd := try! run(
    driverBinary,
    ["check", selfhostSourcePath("samples/std-time-acquisition.do")],
    ExecOptions { env: { "DOOF_STDLIB_ROOT": absolutePath("../doof-stdlib") } },
  )
  if acquiredStd.exitCode != 0 { println(decodeUtf8(acquiredStd.stderr)!) }
  Assert.equal(acquiredStd.exitCode, 0)

  acquiredOutput := "/tmp/doof-b4-acquired-native-output"
  emittedAcquiredStd := try! run(
    driverBinary,
    ["emit", selfhostSourcePath("samples/std-time-acquisition.do"), "-o", acquiredOutput],
    ExecOptions { env: { "DOOF_STDLIB_ROOT": absolutePath("../doof-stdlib") } },
  )
  if emittedAcquiredStd.exitCode != 0 { println(decodeUtf8(emittedAcquiredStd.stderr)!) }
  Assert.equal(emittedAcquiredStd.exitCode, 0)
  Assert.equal(exists(acquiredOutput + "/std/time/doof_time.cpp"), true)
  Assert.equal(exists(acquiredOutput + "/std/time/doof_time.hpp"), true)
  Assert.equal(exists(acquiredOutput + "/std/time/index.hpp"), true)
  Assert.equal(exists(acquiredOutput + "/types.hpp"), false)

  nativeTimeProject := "/tmp/doof-selfhost-native-time-project"
  if !exists(nativeTimeProject) { try! mkdir(nativeTimeProject) }
  if !exists(nativeTimeProject + "/src") { try! mkdir(nativeTimeProject + "/src") }
  try! writeText(
    nativeTimeProject + "/doof.json",
    "{\n  \"name\": \"native-time-demo\",\n  \"build\": {\n    \"entry\": \"src/main.do\",\n    \"native\": {\n      \"sourceFiles\": [\"native.cpp\"],\n      \"extraCopyPaths\": [\"native.hpp\"],\n      \"defines\": [\"ROOT_NATIVE_VALUE=11\"]\n    }\n  }\n}\n",
  )
  try! writeText(
    nativeTimeProject + "/src/main.do",
    "import { Instant } from \"std/time\"\nimport function nativeRootValue(): int from \"native.hpp\"\nfunction main(): int {\n  if nativeRootValue() == 11 && Instant.now().toEpochNanos() > 0L { return 0 }\n  return 1\n}\n",
  )
  try! writeText(nativeTimeProject + "/native.hpp", "#pragma once\nint nativeRootValue();\n")
  try! writeText(
    nativeTimeProject + "/native.cpp",
    "#include \"native.hpp\"\n#ifndef ROOT_NATIVE_VALUE\n#error missing root native define\n#endif\nint nativeRootValue() { return ROOT_NATIVE_VALUE; }\n",
  )
  builtNativeTime := try! run(
    driverBinary,
    ["build", nativeTimeProject, "--compiler", "clang++"],
    ExecOptions { env: { "DOOF_STDLIB_ROOT": absolutePath("../doof-stdlib") } },
  )
  if builtNativeTime.exitCode != 0 { println(firstStderrLines(decodeUtf8(builtNativeTime.stderr)!, 20)) }
  Assert.equal(builtNativeTime.exitCode, 0)
  ranNativeTime := try! run(nativeTimeProject + "/build/native-time-demo")
  Assert.equal(ranNativeTime.exitCode, 0)

  platformStdlib := "/tmp/doof-selfhost-platform-stdlib"
  platformPackage := platformStdlib + "/platform-native"
  if !exists(platformStdlib) { try! mkdir(platformStdlib) }
  if !exists(platformPackage) { try! mkdir(platformPackage) }
  try! writeText(
    platformPackage + "/doof.json",
    "{\n  \"name\": \"std/platform-native\",\n  \"build\": {\n    \"native\": {\n      \"extraCopyPaths\": [\"native_platform.hpp\"],\n      \"macos\": { \"frameworks\": [\"CoreFoundation\"] }\n    }\n  }\n}\n",
  )
  try! writeText(
    platformPackage + "/index.do",
    "export import function platformValue(): int from \"native_platform.hpp\" as platform_native::value\n",
  )
  try! writeText(
    platformPackage + "/native_platform.hpp",
    "#pragma once\n#include <CoreFoundation/CoreFoundation.h>\n#include <cstdint>\nnamespace platform_native { inline int32_t value() { return static_cast<int32_t>(CFStringGetLength(CFSTR(\"ok\"))); } }\n",
  )
  nativePlatformProject := "/tmp/doof-selfhost-native-platform-project"
  if !exists(nativePlatformProject) { try! mkdir(nativePlatformProject) }
  if !exists(nativePlatformProject + "/src") { try! mkdir(nativePlatformProject + "/src") }
  try! writeText(
    nativePlatformProject + "/doof.json",
    "{\n  \"name\": \"native-platform-demo\",\n  \"build\": { \"entry\": \"src/main.do\" }\n}\n",
  )
  try! writeText(
    nativePlatformProject + "/src/main.do",
    "import { platformValue } from \"std/platform-native\"\nfunction main(): int => if platformValue() == 2 then 0 else 1\n",
  )
  builtNativePlatform := try! run(
    driverBinary,
    ["build", nativePlatformProject, "--compiler", "clang++"],
    ExecOptions { env: { "DOOF_STDLIB_ROOT": platformStdlib } },
  )
  if builtNativePlatform.exitCode != 0 { println(firstStderrLines(decodeUtf8(builtNativePlatform.stderr)!, 20)) }
  Assert.equal(builtNativePlatform.exitCode, 0)
  ranNativePlatform := try! run(nativePlatformProject + "/build/native-platform-demo")
  Assert.equal(ranNativePlatform.exitCode, 0)

  httpClientProject := absolutePath("samples/http-client")
  stdlibRoot := absolutePath("../doof-stdlib")
  checkedHttpClient := try! run(
    driverBinary,
    ["check", httpClientProject],
    ExecOptions { env: { "DOOF_STDLIB_ROOT": stdlibRoot } },
  )
  if checkedHttpClient.exitCode != 0 { println(decodeUtf8(checkedHttpClient.stdout)!) }
  if checkedHttpClient.exitCode != 0 { println(firstStderrLines(decodeUtf8(checkedHttpClient.stderr)!, 40)) }
  Assert.equal(checkedHttpClient.exitCode, 0)

  httpClientOutput := "/tmp/doof-selfhost-http-client"
  builtHttpClient := try! run(
    driverBinary,
    ["build", httpClientProject, "-o", httpClientOutput],
    ExecOptions { env: { "DOOF_STDLIB_ROOT": stdlibRoot } },
  )
  if builtHttpClient.exitCode != 0 { println(decodeUtf8(builtHttpClient.stdout)!) }
  if builtHttpClient.exitCode != 0 { println(firstStderrLines(decodeUtf8(builtHttpClient.stderr)!, 80)) }
  Assert.equal(builtHttpClient.exitCode, 0)
  Assert.equal(exists(httpClientOutput + "/http-client-sample"), true)

  localHttpProject := "/tmp/doof-selfhost-local-http-client"
  if !exists(localHttpProject) { try! mkdir(localHttpProject) }
  localHttpSource := (try! readText(httpClientProject + "/main.do")).replaceAll(
    "https://example.com",
    "http://127.0.0.1:18765",
  )
  try! writeText(localHttpProject + "/main.do", localHttpSource)
  try! writeText(localHttpProject + "/doof.json", "{\n  \"name\": \"local-http-client\",\n  \"build\": {}\n}\n")
  localHttpOutput := "/tmp/doof-selfhost-local-http-output"
  builtLocalHttp := try! run(
    driverBinary,
    ["build", localHttpProject, "-o", localHttpOutput],
    ExecOptions { env: { "DOOF_STDLIB_ROOT": stdlibRoot } },
  )
  if builtLocalHttp.exitCode != 0 { println(firstStderrLines(decodeUtf8(builtLocalHttp.stderr)!, 40)) }
  Assert.equal(builtLocalHttp.exitCode, 0)
  // Network-restricted test runners cannot bind loopback sockets. Keep the
  // deterministic runtime leg opt-in while always compiling its exact binary.
  if environmentValue("DOOF_HTTP_RUNTIME_TEST") == "1" {
    localHttpRun := try! run("sh", [
      "-c",
      "python3 -m http.server 18765 --bind 127.0.0.1 --directory /tmp >/tmp/doof-local-http-server.log 2>&1 & server=$!; sleep 1; \"$1\" >/tmp/doof-local-http-client.log; status=$?; kill $server; wait $server 2>/dev/null; exit $status",
      "local-http-runtime",
      localHttpOutput + "/local-http-client",
    ])
    if localHttpRun.exitCode != 0 { println(try! readText("/tmp/doof-local-http-client.log")) }
    Assert.equal(localHttpRun.exitCode, 0)
  }

  targetBinary := "/tmp/doof-b4-generated-program"
  targetSource := outputDirectory + "/" + moduleSourceName(entry)
  targetDependency := outputDirectory + "/" + moduleSourceName("/doof-b4-math.do")
  target := try! run("clang++", ["-std=c++17", targetSource, targetDependency, "-I", outputDirectory, "-o", targetBinary])
  if target.exitCode != 0 { println(firstStderrLines(decodeUtf8(target.stderr)!, 8)) }
  Assert.equal(target.exitCode, 0)
  executed := try! run(targetBinary)
  Assert.equal(executed.exitCode, 5)

  manifestProject := "/tmp/doof-selfhost-manifest-project"
  manifestEntry := manifestProject + "/src/main.do"
  if !exists(manifestProject) { try! mkdir(manifestProject) }
  if !exists(manifestProject + "/src") { try! mkdir(manifestProject + "/src") }
  try! writeText(manifestProject + "/doof.json", "{\n  \"name\": \"manifest-demo\",\n  \"build\": { \"entry\": \"src/main.do\", \"buildDir\": \"generated\" }\n}\n")
  try! writeText(manifestEntry, "function main(): int => 7\n")
  manifestCheck := try! run(driverBinary, ["check", manifestProject])
  if manifestCheck.exitCode != 0 { println(decodeUtf8(manifestCheck.stdout)!) }
  Assert.equal(manifestCheck.exitCode, 0)
  manifestEmit := try! run(driverBinary, ["emit", manifestProject])
  if manifestEmit.exitCode != 0 { println(decodeUtf8(manifestEmit.stdout)!) }
  if manifestEmit.exitCode != 0 { println(decodeUtf8(manifestEmit.stderr)!) }
  Assert.equal(manifestEmit.exitCode, 0)
  Assert.equal((try! readText(manifestProject + "/generated/" + moduleHeaderName("/tmp/doof-selfhost-manifest-project/src/main.do"))).length > 0, true)

  packaged := try! run(driverBinary, ["package", manifestProject, "--compiler", "clang++"])
  if packaged.exitCode != 0 { println(decodeUtf8(packaged.stdout)!) }
  if packaged.exitCode != 0 { println(decodeUtf8(packaged.stderr)!) }
  Assert.equal(packaged.exitCode, 0)
  Assert.equal(exists(manifestProject + "/generated/release/doof_runtime.hpp"), true)
  Assert.equal(exists(manifestProject + "/dist/manifest-demo"), true)
  packagedProgram := try! run(manifestProject + "/dist/manifest-demo")
  Assert.equal(packagedProgram.exitCode, 7)

}

export function testTwoStageBootstrapsSelfhostCompiler(): void {
  seedCompiler := buildSeedDriver("/tmp/doof-selfhost-bootstrap-seed")
  firstCompiler := buildNextCompiler(seedCompiler, "/tmp/doof-selfhost-b5-autodiscovered")
  assertCompilerEmitsRunnableProgram(firstCompiler, "b5")

  secondCompiler := buildNextCompiler(firstCompiler, "/tmp/doof-selfhost-b6-autodiscovered")
  assertCompilerEmitsRunnableProgram(secondCompiler, "b6")
}
