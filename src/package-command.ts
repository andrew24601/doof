import * as path from "node:path";
import type { DoofBuildTarget } from "./build-targets.js";
import {
  printDiagnostic,
  RealFS,
  resolveCompilerToolchain,
  resolveNativeBuildOptions,
  runNativeBuildGraph,
  runPipelineWithFs,
} from "./cli-core.js";
import type { NativeBuildOptions } from "./emitter-module.js";
import { assembleIOSAppBundle } from "./ios-app-target.js";
import {
  buildIOSDeviceNativeBuild,
  resolveIOSDeviceBuildSettings,
} from "./ios-app-target-node.js";
import { assembleMacOSAppBundle } from "./macos-app-target.js";
import { archiveMacOSApp, signMacOSApp, type MacOSPackageSigningOptions } from "./macos-package.js";
import { signAndArchiveIOSApp, type IOSAdHocSigningOverrides } from "./ios-package.js";
import { copyPackagedExecutable, packageArchiveName, withReleaseBuildDefaults } from "./package-artifacts.js";

export interface PackageCommandOptions {
  entry: string;
  outDir: string;
  distDir: string;
  version: string;
  compiler: string | null;
  nativeBuild: NativeBuildOptions;
  targetOverride: DoofBuildTarget | null;
  verbose: boolean;
  macosSigning: MacOSPackageSigningOptions;
  iosSigning: IOSAdHocSigningOverrides;
}

export interface PackageCommandReporter {
  log(message: string): void;
}

export async function runPackageCommand(
  options: PackageCommandOptions,
  reporter: PackageCommandReporter,
): Promise<string> {
  const toolchain = resolveCompilerToolchain(options.compiler);
  const requestedNativeBuild = resolveNativeBuildOptions(options.nativeBuild);
  const { project, nativeBuild, outputBinaryName, provenance, buildManifest, buildTarget } = runPipelineWithFs(
    new RealFS(),
    options.entry,
    options.verbose,
    requestedNativeBuild,
    reporter.log,
    printDiagnostic,
    { buildTargetOverride: options.targetOverride ?? undefined, iosDestinationOverride: "device" },
  );
  const releaseNativeBuild = withReleaseBuildDefaults(nativeBuild, toolchain.kind);
  buildManifest.compilerFlags = [...releaseNativeBuild.compilerFlags];
  buildManifest.defines = [...releaseNativeBuild.defines];
  const effectiveNativeBuild = buildTarget?.kind === "ios-app"
    ? buildIOSDeviceNativeBuild(
      releaseNativeBuild,
      options.outDir,
      resolveIOSDeviceBuildSettings(buildTarget.config),
    )
    : releaseNativeBuild;
  const { outBinary: binary } = await runNativeBuildGraph(
    options.outDir,
    project,
    toolchain,
    effectiveNativeBuild,
    options.verbose,
    outputBinaryName,
    provenance,
    buildManifest,
  );

  if (buildTarget?.kind === "macos-app") {
    const bundle = assembleMacOSAppBundle({
      outputDir: options.outDir,
      executablePath: binary,
      executableName: outputBinaryName,
      config: buildTarget.config,
      log: options.verbose ? reporter.log : undefined,
    });
    signMacOSApp(bundle.appPath, options.macosSigning);
    const artifactPath = path.join(
      options.distDir,
      packageArchiveName(outputBinaryName, buildTarget.config.version || options.version, "macos"),
    );
    archiveMacOSApp(bundle.appPath, artifactPath);
    return artifactPath;
  }

  if (buildTarget?.kind === "ios-app") {
    const bundle = assembleIOSAppBundle({
      outputDir: options.outDir,
      executablePath: binary,
      executableName: outputBinaryName,
      config: buildTarget.config,
      destination: "device",
      log: options.verbose ? reporter.log : undefined,
    });
    const artifactPath = path.join(
      options.distDir,
      packageArchiveName(outputBinaryName, buildTarget.config.version || options.version, "ios"),
    );
    signAndArchiveIOSApp(bundle.appPath, artifactPath, buildTarget.config.bundleId, options.iosSigning);
    return artifactPath;
  }

  return copyPackagedExecutable(binary, options.distDir);
}
