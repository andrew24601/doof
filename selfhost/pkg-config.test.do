import { Assert } from "std/assert"

import { NativeBuildPlan } from "./package-manifest"
import { PkgConfigCommandResult, applyPkgConfigResult } from "./pkg-config"

export function testConvertsPkgConfigFlagsIntoNativeBuildInputs(): void {
  native := NativeBuildPlan { includePaths: ["/existing/include"], linkLibraries: ["SDL3"] }

  try! applyPkgConfigResult(
    native,
    "sdl3",
    "cflags",
    PkgConfigCommandResult {
      exitCode: 0,
      output: "-I/opt/include/SDL3\t-I /existing/include -DTEST_FLAG=1 -D SPLIT_FLAG -Winvalid-pch\n",
    },
  )
  try! applyPkgConfigResult(
    native,
    "sdl3",
    "libs",
    PkgConfigCommandResult {
      exitCode: 0,
      output: "-L/opt/lib -L /second/lib -lSDL3 -framework Cocoa -Wl,-rpath,/opt/lib",
    },
  )

  Assert.equal(native.includePaths.length, 2)
  Assert.equal(native.includePaths[1], "/opt/include/SDL3")
  Assert.equal(native.libraryPaths[0], "/opt/lib")
  Assert.equal(native.libraryPaths[1], "/second/lib")
  Assert.equal(native.linkLibraries.length, 1)
  Assert.equal(native.linkLibraries[0], "SDL3")
  Assert.equal(native.frameworks[0], "Cocoa")
  Assert.equal(native.defines[0], "TEST_FLAG=1")
  Assert.equal(native.defines[1], "SPLIT_FLAG")
  Assert.equal(native.compilerFlags[0], "-Winvalid-pch")
  Assert.equal(native.linkerFlags[0], "-Wl,-rpath,/opt/lib")
}

export function testReportsMissingPkgConfigExecutable(): void {
  result := applyPkgConfigResult(
    NativeBuildPlan {},
    "sdl3",
    "cflags",
    PkgConfigCommandResult { exitCode: -1, error: "No such file or directory" },
  )

  _ := result else error {
    Assert.equal(error.contains("Failed to run pkg-config"), true)
    Assert.equal(error.contains("Install pkg-config"), true)
    Assert.equal(error.contains("sdl3"), true)
    return
  }
  panic("expected pkg-config failure")
}

export function testReportsMissingPkgConfigPackage(): void {
  result := applyPkgConfigResult(
    NativeBuildPlan {},
    "missing-native-package",
    "libs",
    PkgConfigCommandResult {
      exitCode: 1,
      output: "Package missing-native-package was not found in the pkg-config search path.",
    },
  )

  _ := result else error {
    Assert.equal(error.contains("could not resolve package \"missing-native-package\""), true)
    Assert.equal(error.contains("Install the package metadata"), true)
    Assert.equal(error.contains("search path"), true)
    return
  }
  panic("expected package resolution failure")
}
