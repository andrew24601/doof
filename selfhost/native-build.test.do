import { Assert } from "std/assert"

import { ModuleEmission } from "./emitter-module"
import { NativeCompileTask, NativeCompileTaskBatch, batchNativeCompileTasks, planNativeCompile } from "./native-build"
import { NativeBuildPlan } from "./package-manifest"

export function testPlansGeneratedAndManifestNativeSources(): void {
  plan := planNativeCompile(
    "clang++",
    "/tmp/generated",
    "/tmp/generated/demo",
    [ModuleEmission {
      modulePath: "/main.do",
      header: "",
      source: "",
      headerName: "main.hpp",
      sourceName: "main.cpp",
    }],
    NativeBuildPlan {
      includePaths: ["include", "std/time"],
      sourceFiles: ["native/root.cpp", "std/time/doof_time.cpp"],
      libraryPaths: ["vendor/lib"],
      linkLibraries: ["sqlite3"],
      frameworks: ["CoreFoundation"],
      defines: ["ROOT_NATIVE=11"],
      compilerFlags: ["-Wconversion"],
      linkerFlags: ["-pthread"],
    },
  )

  Assert.equal(plan.compiler, "clang++")
  Assert.equal(plan.outputPath, "/tmp/generated/demo")
  Assert.equal(plan.compileTasks.length, 3)
  let expectedCompilePrefix: string[] = [
    "-std=c++17",
    "-DROOT_NATIVE=11",
    "-I", "/tmp/generated",
    "-I", "/tmp/generated/include",
    "-I", "/tmp/generated/std/time",
    "-Wconversion",
  ]
  for task of plan.compileTasks {
    for index of 0..<expectedCompilePrefix.length {
      Assert.equal(task.arguments[index], expectedCompilePrefix[index])
    }
    Assert.equal(task.arguments.contains("-c"), true)
    Assert.equal(task.arguments.contains(task.sourcePath), true)
    Assert.equal(task.arguments.contains(task.outputPath), true)
  }
  let expectedLink: string[] = [
    "/tmp/generated/.doof-objects/generated-0.o",
    "/tmp/generated/.doof-objects/native-0.o",
    "/tmp/generated/.doof-objects/native-1.o",
    "-L/tmp/generated/vendor/lib",
    "-lsqlite3",
    "-framework", "CoreFoundation",
    "-pthread",
    "-o", "/tmp/generated/demo",
  ]
  Assert.equal(plan.linkArguments.length, expectedLink.length)
  Assert.equal(plan.precompiledHeaderArguments.length, 0)
  for index of 0..<expectedLink.length {
    Assert.equal(plan.linkArguments[index], expectedLink[index])
  }
}

export function testPreservesAbsoluteNativePaths(): void {
  plan := planNativeCompile(
    "c++",
    "/tmp/generated",
    "/tmp/generated/demo",
    [],
    NativeBuildPlan { sourceFiles: ["/opt/native.cpp"], includePaths: ["/opt/include"] },
  )
  Assert.equal(plan.compileTasks[0].sourcePath, "/opt/native.cpp")
  Assert.equal(plan.compileTasks[0].arguments.contains("/opt/include"), true)
}

export function testCompilesNativeCSourcesWithAdjacentCDriver(): void {
  clangPlan := planNativeCompile(
    "/opt/llvm/bin/clang++",
    "/tmp/generated",
    "/tmp/generated/demo",
    [ModuleEmission {
      modulePath: "/main.do",
      header: "",
      source: "",
      headerName: "main.hpp",
      sourceName: "main.cpp",
    }],
    NativeBuildPlan { sourceFiles: ["vendor/zstd/debug.c", "native/bridge.cpp"] },
  )

  Assert.equal(clangPlan.compileTasks[0].compiler, "/opt/llvm/bin/clang++")
  Assert.equal(clangPlan.compileTasks[1].compiler, "/opt/llvm/bin/clang")
  Assert.equal(clangPlan.compileTasks[1].arguments.contains("-std=c++17"), false)
  Assert.equal(clangPlan.compileTasks[2].compiler, "/opt/llvm/bin/clang++")
  Assert.equal(clangPlan.compileTasks[2].arguments.contains("-std=c++17"), true)

  gccPlan := planNativeCompile(
    "g++",
    "/tmp/generated",
    "/tmp/generated/demo",
    [],
    NativeBuildPlan { sourceFiles: ["native.c"] },
  )
  Assert.equal(gccPlan.compileTasks[0].compiler, "gcc")

  defaultPlan := planNativeCompile(
    "c++",
    "/tmp/generated",
    "/tmp/generated/demo",
    [],
    NativeBuildPlan { sourceFiles: ["native.c"] },
  )
  Assert.equal(defaultPlan.compileTasks[0].compiler, "cc")
}

export function testCompilesSwiftSourcesAndLinksWithSwiftRuntime(): void {
  plan := planNativeCompile(
    "clang++",
    "/tmp/generated",
    "/tmp/generated/demo",
    [ModuleEmission {
      modulePath: "/main.do",
      header: "",
      source: "",
      headerName: "main.hpp",
      sourceName: "main.cpp",
    }],
    NativeBuildPlan {
      sourceFiles: ["std/apple-intelligence/apple_intelligence_impl.swift"],
      frameworks: ["Foundation", "FoundationModels"],
      linkerFlags: ["-Wl,-rpath,/tmp/lib"],
    },
    false,
    "macos",
  )

  Assert.equal(plan.compiler, "clang++")
  Assert.equal(plan.linker, "swiftc")
  Assert.equal(plan.compileTasks.length, 2)
  swiftTask: NativeCompileTask := plan.compileTasks[1]
  Assert.equal(swiftTask.compiler, "swiftc")
  Assert.equal(swiftTask.sourcePath, "/tmp/generated/std/apple-intelligence/apple_intelligence_impl.swift")
  Assert.equal(swiftTask.arguments[0], "-parse-as-library")
  Assert.equal(swiftTask.arguments[1], "-emit-object")
  Assert.equal(swiftTask.arguments.contains("-std=c++17"), false)
  Assert.equal(plan.linkArguments.contains("-framework"), true)
  Assert.equal(plan.linkArguments.contains("FoundationModels"), true)
  Assert.equal(plan.linkArguments.contains("-Xlinker"), true)
  Assert.equal(plan.linkArguments.contains("-lc++"), true)
  Assert.equal(plan.linkArguments.contains("-Wl,-rpath,/tmp/lib"), true)
}

export function testAddsReleaseDefaultsBeforeManifestFlags(): void {
  plan := planNativeCompile(
    "clang++",
    "/tmp/generated",
    "/tmp/dist/demo",
    [ModuleEmission {
      modulePath: "/main.do",
      header: "",
      source: "",
      headerName: "main.hpp",
      sourceName: "main.cpp",
    }],
    NativeBuildPlan {
      defines: ["APP_RELEASE=1"],
      compilerFlags: ["-O3"],
    },
    true,
  )
  Assert.equal(plan.compileTasks[0].arguments[0], "-std=c++17")
  Assert.equal(plan.compileTasks[0].arguments[1], "-O2")
  Assert.equal(plan.compileTasks[0].arguments[2], "-DNDEBUG")
  Assert.equal(plan.compileTasks[0].arguments[3], "-DAPP_RELEASE=1")
  Assert.equal(plan.compileTasks[0].arguments.contains("-O3"), true)
  Assert.equal(plan.outputPath, "/tmp/dist/demo")
}

export function testPlansClangPrecompiledRuntimeForMultiModuleBuilds(): void {
  modules := [
    ModuleEmission { modulePath: "/one.do", header: "", source: "", headerName: "one.hpp", sourceName: "one.cpp" },
    ModuleEmission { modulePath: "/two.do", header: "", source: "", headerName: "two.hpp", sourceName: "two.cpp" },
  ]
  plan := planNativeCompile(
    "c++",
    "/tmp/generated",
    "/tmp/generated/demo",
    modules,
    NativeBuildPlan { defines: ["DEBUG_BUILD=1"], compilerFlags: ["-Wconversion"] },
    false,
    "macos",
  )

  Assert.equal(plan.precompiledHeaderArguments.contains("c++-header"), true)
  Assert.equal(plan.precompiledHeaderArguments.contains("/tmp/generated/doof_runtime.hpp"), true)
  Assert.equal(plan.precompiledHeaderArguments.contains("/tmp/generated/doof_runtime.hpp.pch"), true)
  Assert.equal(plan.precompiledHeaderArguments.contains("-DDEBUG_BUILD=1"), true)
  Assert.equal(plan.precompiledHeaderArguments.contains("-Wconversion"), true)
  Assert.equal(plan.compileTasks[0].arguments.contains("-include-pch"), true)
  Assert.equal(plan.compileTasks[0].arguments.contains("/tmp/generated/doof_runtime.hpp.pch"), true)
  Assert.equal(plan.compileTasks[1].arguments.contains("-include-pch"), true)
}

export function testDoesNotApplyCxxPrecompiledHeaderToObjectiveCxxSources(): void {
  modules := [
    ModuleEmission { modulePath: "/one.do", header: "", source: "", headerName: "one.hpp", sourceName: "one.cpp" },
    ModuleEmission { modulePath: "/two.do", header: "", source: "", headerName: "two.hpp", sourceName: "two.cpp" },
  ]
  plan := planNativeCompile(
    "clang++",
    "/tmp/generated",
    "/tmp/generated/demo",
    modules,
    NativeBuildPlan { sourceFiles: ["std/http/native_http_client_apple.mm"] },
    false,
    "macos",
  )

  objectiveCxxTask: NativeCompileTask := plan.compileTasks[2]
  Assert.equal(objectiveCxxTask.sourcePath, "/tmp/generated/std/http/native_http_client_apple.mm")
  Assert.equal(objectiveCxxTask.arguments.contains("-include-pch"), false)
  Assert.equal(objectiveCxxTask.arguments.contains("/tmp/generated/doof_runtime.hpp.pch"), false)
}

export function testBatchesCompileTasksAcrossAtMostEightWorkers(): void {
  let tasks: NativeCompileTask[] = []
  for index of 0..<19 {
    tasks.push(NativeCompileTask {
      compiler: "clang++",
      sourcePath: "/tmp/source-" + string(index) + ".cpp",
      outputPath: "/tmp/source-" + string(index) + ".o",
    })
  }

  batches := batchNativeCompileTasks(tasks)
  readonly frozenBatches: readonly NativeCompileTaskBatch[] = batches
  Assert.equal(batches.length, 8)
  Assert.equal(batches[0].length, 3)
  Assert.equal(batches[1].length, 3)
  Assert.equal(batches[2].length, 3)
  Assert.equal(batches[3].length, 2)
  let assigned = 0
  for batch of batches { assigned = assigned + batch.length }
  Assert.equal(assigned, 19)

  small := batchNativeCompileTasks([tasks[0], tasks[1], tasks[2]])
  Assert.equal(small.length, 3)
  Assert.equal(batchNativeCompileTasks([]).length, 0)
}

export function testPlansGccAdjacentPrecompiledRuntime(): void {
  modules := [
    ModuleEmission { modulePath: "/one.do", header: "", source: "", headerName: "one.hpp", sourceName: "one.cpp" },
    ModuleEmission { modulePath: "/two.do", header: "", source: "", headerName: "two.hpp", sourceName: "two.cpp" },
  ]
  plan := planNativeCompile(
    "g++",
    "/tmp/generated",
    "/tmp/generated/demo",
    modules,
    NativeBuildPlan {},
  )

  Assert.equal(plan.precompiledHeaderArguments.contains("/tmp/generated/doof_runtime.hpp.gch"), true)
  Assert.equal(plan.compileTasks[0].arguments.contains("-include-pch"), false)
}

export function testPlansStandaloneEmscriptenWasmLink(): void {
  plan := planNativeCompile(
    "em++",
    "/tmp/generated",
    "/tmp/generated/demo.wasm",
    [ModuleEmission { modulePath: "/main.do", header: "", source: "", headerName: "main.hpp", sourceName: "main.cpp" }],
    NativeBuildPlan { sourceFiles: ["doof_wasm.cpp"], linkerFlags: ["-sINITIAL_MEMORY=33554432"] },
    false,
    "linux",
    ["doof_export_add"],
    true,
  )

  Assert.equal(plan.precompiledHeaderArguments.length, 0)
  Assert.equal(plan.compileTasks[0].arguments.contains("-Oz"), true)
  Assert.equal(plan.compileTasks[0].arguments.contains("-flto"), true)
  Assert.equal(plan.linkArguments.contains("-sSTANDALONE_WASM=1"), true)
  Assert.equal(plan.linkArguments.contains("--no-entry"), true)
  Assert.equal(plan.linkArguments.contains("-sEXPORTED_FUNCTIONS=[\"_malloc\",\"_free\",\"_doof_free\",\"_doof_export_add\"]"), true)
  Assert.equal(plan.linkArguments.contains("-sINITIAL_MEMORY=33554432"), true)
}
