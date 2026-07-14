import { Assert } from "std/assert"

import { ModuleEmission } from "./emitter-module"
import { planNativeCompile } from "./native-build"
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
  let expected: string[] = [
    "-std=c++17",
    "-DROOT_NATIVE=11",
    "-I", "/tmp/generated",
    "-I", "/tmp/generated/include",
    "-I", "/tmp/generated/std/time",
    "-Wconversion",
    "/tmp/generated/main.cpp",
    "/tmp/generated/native/root.cpp",
    "/tmp/generated/std/time/doof_time.cpp",
    "-L/tmp/generated/vendor/lib",
    "-lsqlite3",
    "-framework", "CoreFoundation",
    "-pthread",
    "-o", "/tmp/generated/demo",
  ]
  Assert.equal(plan.arguments.length, expected.length)
  Assert.equal(plan.precompiledHeaderArguments.length, 0)
  for index of 0..<expected.length {
    Assert.equal(plan.arguments[index], expected[index])
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
  Assert.equal(plan.arguments.contains("/opt/native.cpp"), true)
  Assert.equal(plan.arguments.contains("/opt/include"), true)
}

export function testAddsReleaseDefaultsBeforeManifestFlags(): void {
  plan := planNativeCompile(
    "clang++",
    "/tmp/generated",
    "/tmp/dist/demo",
    [],
    NativeBuildPlan {
      defines: ["APP_RELEASE=1"],
      compilerFlags: ["-O3"],
    },
    true,
  )
  Assert.equal(plan.arguments[0], "-std=c++17")
  Assert.equal(plan.arguments[1], "-O2")
  Assert.equal(plan.arguments[2], "-DNDEBUG")
  Assert.equal(plan.arguments[3], "-DAPP_RELEASE=1")
  Assert.equal(plan.arguments.contains("-O3"), true)
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
  Assert.equal(plan.arguments.contains("-include-pch"), true)
  Assert.equal(plan.arguments.contains("/tmp/generated/doof_runtime.hpp.pch"), true)
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
  Assert.equal(plan.arguments.contains("-include-pch"), false)
}
