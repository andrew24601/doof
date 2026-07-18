import { Assert } from "std/assert"
import {
  planIOSDeviceInstall, planIOSDeviceLaunch, planIOSSimulatorInstall, planIOSSimulatorLaunch,
  planMacOSAppRun, planNativeProgramRun,
} from "./run-command"

export function testPlansNativeProgramArgumentsAndPackageRoot(): void {
  plan := planNativeProgramRun("/tmp/build/demo", ["--port", "8080"], "/tmp/package")
  Assert.equal(plan.command, "/tmp/build/demo")
  Assert.equal(plan.arguments.length, 2)
  Assert.equal(plan.arguments[0], "--port")
  Assert.equal(plan.arguments[1], "8080")
  Assert.equal(plan.directory, "/tmp/package")
}

export function testPlansMacOSBundleLaunch(): void {
  plan := planMacOSAppRun("/tmp/build/Demo.app", "/tmp/package")
  Assert.equal(plan.command, "open")
  Assert.equal(plan.arguments[0], "-n")
  Assert.equal(plan.arguments[1], "/tmp/build/Demo.app")
  Assert.equal(plan.directory, "/tmp/package")
}

export function testPlansIOSSimulatorInstallAndLaunch(): void {
  install := planIOSSimulatorInstall("/tmp/build/Demo.app", "/tmp/package")
  Assert.equal(install.command, "xcrun")
  Assert.equal(install.arguments[0], "simctl")
  Assert.equal(install.arguments[1], "install")
  Assert.equal(install.arguments[2], "booted")
  Assert.equal(install.arguments[3], "/tmp/build/Demo.app")

  launch := planIOSSimulatorLaunch("dev.doof.demo", "/tmp/package")
  Assert.equal(launch.command, "xcrun")
  Assert.equal(launch.arguments[0], "simctl")
  Assert.equal(launch.arguments[1], "launch")
  Assert.equal(launch.arguments[2], "booted")
  Assert.equal(launch.arguments[3], "dev.doof.demo")
}

export function testPlansIOSDeviceInstallAndLaunch(): void {
  install := planIOSDeviceInstall("/tmp/build/Demo.app", "device-123", "/tmp/package")
  Assert.equal(install.command, "xcrun")
  Assert.equal(install.arguments.length, 7)
  Assert.equal(install.arguments[0], "devicectl")
  Assert.equal(install.arguments[1], "device")
  Assert.equal(install.arguments[2], "install")
  Assert.equal(install.arguments[3], "app")
  Assert.equal(install.arguments[4], "--device")
  Assert.equal(install.arguments[5], "device-123")
  Assert.equal(install.arguments[6], "/tmp/build/Demo.app")

  launch := planIOSDeviceLaunch("dev.doof.demo", "device-123", "/tmp/package")
  Assert.equal(launch.command, "xcrun")
  Assert.equal(launch.arguments[0], "devicectl")
  Assert.equal(launch.arguments[1], "device")
  Assert.equal(launch.arguments[2], "process")
  Assert.equal(launch.arguments[3], "launch")
  Assert.equal(launch.arguments[4], "--device")
  Assert.equal(launch.arguments[5], "device-123")
  Assert.equal(launch.arguments[6], "--terminate-existing")
  Assert.equal(launch.arguments[7], "dev.doof.demo")
}
