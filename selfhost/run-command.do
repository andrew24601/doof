// Process invocation plans for artifacts produced by the self-hosted driver.
//
// Planning stays separate from std/os execution so command routing and argument
// forwarding remain deterministic unit-test surfaces.

export class RunInvocation {
  command: string
  arguments: string[] = []
  directory: string
}

/** Plans an inherited-I/O native program run from its package root. */
export function planNativeProgramRun(
  executablePath: string,
  programArguments: string[],
  packageRoot: string,
): RunInvocation {
  return RunInvocation { command: executablePath, arguments: programArguments, directory: packageRoot }
}

/** Plans the same macOS bundle launch used by the TypeScript CLI. */
export function planMacOSAppRun(appPath: string, packageRoot: string): RunInvocation {
  return RunInvocation { command: "open", arguments: ["-n", appPath], directory: packageRoot }
}

/** Plans installation into the currently booted iOS simulator. */
export function planIOSSimulatorInstall(appPath: string, packageRoot: string): RunInvocation {
  return RunInvocation {
    command: "xcrun",
    arguments: ["simctl", "install", "booted", appPath],
    directory: packageRoot,
  }
}

/** Plans launch of an installed app in the currently booted iOS simulator. */
export function planIOSSimulatorLaunch(bundleId: string, packageRoot: string): RunInvocation {
  return RunInvocation {
    command: "xcrun",
    arguments: ["simctl", "launch", "booted", bundleId],
    directory: packageRoot,
  }
}

/** Plans installation of a signed app on a connected physical iOS device. */
export function planIOSDeviceInstall(
  appPath: string,
  deviceIdentifier: string,
  packageRoot: string,
): RunInvocation {
  return RunInvocation {
    command: "xcrun",
    arguments: ["devicectl", "device", "install", "app", "--device", deviceIdentifier, appPath],
    directory: packageRoot,
  }
}

/** Plans launch of an installed app on a connected physical iOS device. */
export function planIOSDeviceLaunch(
  bundleId: string,
  deviceIdentifier: string,
  packageRoot: string,
): RunInvocation {
  return RunInvocation {
    command: "xcrun",
    arguments: [
      "devicectl", "device", "process", "launch", "--device", deviceIdentifier,
      "--terminate-existing", bundleId,
    ],
    directory: packageRoot,
  }
}
