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
