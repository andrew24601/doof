import { Assert } from "std/assert"

import { ModuleEmission, ModuleGraphEmission } from "./emitter-module"
import { NativePackageInput, planProjectEmission } from "./emitter-project"
import { PackageManifest, NativeBuildPlan } from "./package-manifest"

function packageInput(logicalPrefix: string, diskRoot: string): NativePackageInput {
  return NativePackageInput {
    logicalPrefix,
    outputRoot: logicalPrefix.substring(1, logicalPrefix.length),
    manifest: PackageManifest {
      name: logicalPrefix,
      manifestPath: diskRoot + "/doof.json",
      rootDirectory: diskRoot,
      nativeBuild: NativeBuildPlan {
        sourceFiles: [diskRoot + "/native.cpp"],
        extraCopyPaths: [diskRoot + "/native.hpp"],
      },
    },
  }
}

export function testPlansPackageRelativeNativeCopiesWithoutFilenameCollisions(): void {
  graph := ModuleGraphEmission { modules: [
    ModuleEmission {
      modulePath: "/vendor/alpha/types.do",
      header: "alpha header",
      source: "alpha source",
      headerName: "vendor_alpha_types.hpp",
      sourceName: "vendor_alpha_types.cpp",
    },
    ModuleEmission {
      modulePath: "/vendor/beta/types.do",
      header: "beta header",
      source: "beta source",
      headerName: "vendor_beta_types.hpp",
      sourceName: "vendor_beta_types.cpp",
    },
  ] }

  project := planProjectEmission(graph, [
    packageInput("/vendor/alpha", "/cache/alpha"),
    packageInput("/vendor/beta", "/cache/beta"),
  ])

  Assert.equal(project.nativeCopies.length, 4)
  Assert.equal(project.nativeCopies[1].relativePath, "vendor/alpha/native.hpp")
  Assert.equal(project.nativeCopies[3].relativePath, "vendor/beta/native.hpp")
  Assert.equal(project.nativeBuild.sourceFiles[0], "vendor/alpha/native.cpp")
  Assert.equal(project.nativeBuild.sourceFiles[1], "vendor/beta/native.cpp")
  Assert.equal(project.nativeBuild.includePaths.contains("vendor/alpha"), true)
  Assert.equal(project.nativeBuild.includePaths.contains("vendor/beta"), true)
}

export function testForwardsPackageHeadersToCanonicalGeneratedHeaders(): void {
  graph := ModuleGraphEmission { modules: [ModuleEmission {
    modulePath: "/std/fs/types.do",
    header: "generated fs types",
    source: "generated source",
    headerName: "std_fs_types.hpp",
    sourceName: "std_fs_types.cpp",
  }] }

  project := planProjectEmission(graph, [NativePackageInput {
    logicalPrefix: "/std/fs",
    outputRoot: "std/fs",
    manifest: PackageManifest {
      name: "std/fs",
      manifestPath: "/stdlib/fs/doof.json",
      rootDirectory: "/stdlib/fs",
      nativeBuild: NativeBuildPlan { extraCopyPaths: ["/stdlib/fs/native_fs.hpp"] },
    },
  }])

  Assert.equal(project.supportFiles.length, 1)
  Assert.equal(project.supportFiles[0].relativePath, "std/fs/types.hpp")
  Assert.equal(project.supportFiles[0].content, "#pragma once\n#include \"std_fs_types.hpp\"\n")
  Assert.equal(project.nativeBuild.includePaths.contains("std"), true)
}

export function testPreservesNonPathNativeBuildOptions(): void {
  graph := ModuleGraphEmission {}
  project := planProjectEmission(graph, [NativePackageInput {
    logicalPrefix: "/std/path",
    outputRoot: "std/path",
    manifest: PackageManifest {
      name: "std/path",
      manifestPath: "/stdlib/path/doof.json",
      rootDirectory: "/stdlib/path",
      nativeBuild: NativeBuildPlan {
        frameworks: ["CoreFoundation"],
        defines: ["PATH_NATIVE=1"],
        compilerFlags: ["-Wconversion"],
      },
    },
  }])

  Assert.equal(project.nativeBuild.frameworks[0], "CoreFoundation")
  Assert.equal(project.nativeBuild.defines[0], "PATH_NATIVE=1")
  Assert.equal(project.nativeBuild.compilerFlags[0], "-Wconversion")
}
