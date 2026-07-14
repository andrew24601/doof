// Project-level emission planning for the self-hosted compiler.
//
// Module emission owns generated C++ text. This layer combines that output
// with the reached packages' manifest-declared native inputs, assigning stable
// package-relative output paths before the driver touches the filesystem.

import { ModuleEmission, ModuleGraphEmission } from "./emitter-module"
import { NativeBuildPlan, PackageManifest } from "./package-manifest"

/** One package whose generated and native files participate in the project. */
export class NativePackageInput {
  logicalPrefix: string
  outputRoot: string
  manifest: PackageManifest
}

/** A native file or directory copied from a package into generated output. */
export class ProjectNativeCopy {
  sourcePath: string
  relativePath: string
}

/** Generated support content written in addition to the flat module outputs. */
export class ProjectSupportFile {
  relativePath: string
  content: string
}

/** Complete generated project shape consumed by materialization and building. */
export class ProjectEmission {
  modules: ModuleEmission[] = []
  supportFiles: ProjectSupportFile[] = []
  nativeCopies: ProjectNativeCopy[] = []
  nativeBuild: NativeBuildPlan = NativeBuildPlan {}
}

/** Plans generated support files and native package inputs for one project. */
export function planProjectEmission(
  graph: ModuleGraphEmission,
  packages: NativePackageInput[],
): ProjectEmission {
  project := ProjectEmission { modules: graph.modules }
  for package_ of packages {
    planPackageSupportFiles(project, graph, package_)
    planPackageNativeBuild(project, package_)
  }
  return project
}

function planPackageSupportFiles(
  project: ProjectEmission,
  graph: ModuleGraphEmission,
  package_: NativePackageInput,
): void {
  for module of graph.modules {
    relativeModulePath := logicalSuffix(module.modulePath, package_.logicalPrefix)
    if relativeModulePath == null { continue }
    relativeHeaderPath := replaceDoExtension(relativeModulePath!)
    addSupportFile(project.supportFiles, ProjectSupportFile {
      relativePath: projectJoinPath(package_.outputRoot, relativeHeaderPath),
      // Native sibling includes use package-relative names such as types.hpp.
      // Forward them to the one canonical generated header instead of copying
      // its definitions under a second path, which defeats #pragma once.
      content: "#pragma once\n#include \"" + module.headerName + "\"\n",
    })
  }
}

function planPackageNativeBuild(project: ProjectEmission, package_: NativePackageInput): void {
  native := package_.manifest.nativeBuild
  let copiedAny = false

  for includePath of native.includePaths {
    relativePath := addNativeCopy(project.nativeCopies, package_, includePath)
    appendUnique(project.nativeBuild.includePaths, relativePath)
    copiedAny = true
  }
  for sourcePath of native.sourceFiles {
    relativePath := addNativeCopy(project.nativeCopies, package_, sourcePath)
    appendUnique(project.nativeBuild.sourceFiles, relativePath)
    copiedAny = true
  }
  for libraryPath of native.libraryPaths {
    relativePath := addNativeCopy(project.nativeCopies, package_, libraryPath)
    appendUnique(project.nativeBuild.libraryPaths, relativePath)
    copiedAny = true
  }
  for extraCopyPath of native.extraCopyPaths {
    relativePath := addNativeCopy(project.nativeCopies, package_, extraCopyPath)
    appendUnique(project.nativeBuild.includePaths, projectParentPath(relativePath))
    copiedAny = true
  }

  if copiedAny { appendUnique(project.nativeBuild.includePaths, package_.outputRoot) }
  appendUniqueValues(project.nativeBuild.linkLibraries, native.linkLibraries)
  appendUniqueValues(project.nativeBuild.frameworks, native.frameworks)
  appendUniqueValues(project.nativeBuild.pkgConfigPackages, native.pkgConfigPackages)
  appendUniqueValues(project.nativeBuild.defines, native.defines)
  appendUniqueValues(project.nativeBuild.compilerFlags, native.compilerFlags)
  appendUniqueValues(project.nativeBuild.linkerFlags, native.linkerFlags)
}

function addNativeCopy(
  copies: ProjectNativeCopy[],
  package_: NativePackageInput,
  sourcePath: string,
): string {
  relativeWithinPackage := diskSuffix(sourcePath, package_.manifest.rootDirectory)
  relativePath := projectJoinPath(package_.outputRoot, relativeWithinPackage)
  for existing of copies {
    if existing.relativePath == relativePath {
      if existing.sourcePath != sourcePath {
        panic(
          "Native package copy collision for " + relativePath + ": "
            + existing.sourcePath + " conflicts with " + sourcePath,
        )
      }
      return relativePath
    }
  }
  copies.push(ProjectNativeCopy { sourcePath, relativePath })
  return relativePath
}

function logicalSuffix(path: string, prefix: string): string | null {
  if path == prefix { return "" }
  boundary := prefix + "/"
  if !path.startsWith(boundary) { return null }
  return path.substring(boundary.length, path.length)
}

function diskSuffix(path: string, root: string): string {
  if path == root { return "" }
  boundary := if root.endsWith("/") then root else root + "/"
  if !path.startsWith(boundary) {
    panic("Native path " + path + " is outside package root " + root)
  }
  return path.substring(boundary.length, path.length)
}

function replaceDoExtension(path: string): string {
  if path.endsWith(".do") { return path.substring(0, path.length - 3) + ".hpp" }
  return path + ".hpp"
}

function projectJoinPath(directory: string, suffix: string): string {
  if directory == "" { return suffix }
  if suffix == "" { return directory }
  if directory.endsWith("/") { return directory + suffix }
  return directory + "/" + suffix
}

function projectParentPath(path: string): string {
  let separator = -1
  let index = 0
  while index < path.length {
    if path[index] == '/' { separator = index }
    index = index + 1
  }
  if separator < 0 { return "" }
  return path.substring(0, separator)
}

function addSupportFile(files: ProjectSupportFile[], file: ProjectSupportFile): void {
  for existing of files {
    if existing.relativePath == file.relativePath {
      if existing.content != file.content {
        panic("Generated support file collision for " + file.relativePath)
      }
      return
    }
  }
  files.push(file)
}

function appendUniqueValues(target: string[], values: string[]): void {
  for value of values { appendUnique(target, value) }
}

function appendUnique(target: string[], value: string): void {
  for existing of target { if existing == value { return } }
  target.push(value)
}
