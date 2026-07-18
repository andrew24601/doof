import { Assert } from "std/assert"
import {
  IOSProvisioningProfile, parseCodesignIdentities, parseConnectedIOSDevices,
  selectIOSDeviceIdentifier, selectProvisioningProfile, selectSigningIdentity,
} from "./ios-device"

export function testParsesConnectedPhysicalIOSDevices(): void {
  devices := try! parseConnectedIOSDevices(
    "{\"result\":{\"devices\":[" +
      "{\"identifier\":\"watch-1\",\"hardwareProperties\":{\"platform\":\"watchOS\",\"reality\":\"physical\"},\"connectionProperties\":{\"tunnelState\":\"connected\"},\"deviceProperties\":{\"name\":\"Watch\"}}," +
      "{\"identifier\":\"sim-1\",\"hardwareProperties\":{\"platform\":\"iOS\",\"reality\":\"virtual\"},\"connectionProperties\":{\"tunnelState\":\"connected\"},\"deviceProperties\":{\"name\":\"Simulator\"}}," +
      "{\"identifier\":\"phone-1\",\"hardwareProperties\":{\"platform\":\"iOS\",\"reality\":\"physical\"},\"connectionProperties\":{\"tunnelState\":\"connected\"},\"deviceProperties\":{\"name\":\"My iPhone\"}}]}}",
  )
  Assert.equal(devices.length, 1)
  Assert.equal(devices[0].identifier, "phone-1")
  Assert.equal(devices[0].name, "My iPhone")
}

export function testSelectsExplicitOrSingleConnectedDevice(): void {
  devices := try! parseConnectedIOSDevices(
    "{\"result\":{\"devices\":[{\"identifier\":\"phone-1\",\"hardwareProperties\":{\"platform\":\"iOS\",\"reality\":\"physical\"},\"connectionProperties\":{\"tunnelState\":\"connected\"},\"deviceProperties\":{\"name\":\"My iPhone\"}}]}}",
  )
  Assert.equal(try! selectIOSDeviceIdentifier("override", []), "override")
  Assert.equal(try! selectIOSDeviceIdentifier("", devices), "phone-1")
}

export function testReportsMissingAndAmbiguousDevices(): void {
  missing := selectIOSDeviceIdentifier("", [])
  Assert.equal(missing.isFailure(), true)
  case missing { failure: Failure<string> -> Assert.stringContains(failure.error, "Could not auto-detect") }

  first := try! parseConnectedIOSDevices(
    "{\"result\":{\"devices\":[{\"identifier\":\"one\",\"hardwareProperties\":{\"platform\":\"iOS\"},\"connectionProperties\":{\"tunnelState\":\"connected\"},\"deviceProperties\":{\"name\":\"Work iPhone\"}},{\"identifier\":\"two\",\"hardwareProperties\":{\"platform\":\"iOS\"},\"connectionProperties\":{\"tunnelState\":\"connected\"},\"deviceProperties\":{\"name\":\"Personal iPhone\"}}]}}",
  )
  ambiguous := selectIOSDeviceIdentifier("", first)
  Assert.equal(ambiguous.isFailure(), true)
  case ambiguous { failure: Failure<string> -> {
    Assert.stringContains(failure.error, "Multiple connected iOS devices found")
    Assert.stringContains(failure.error, "Work iPhone (one)")
  } }
}

export function testSelectsMostSpecificActiveProvisioningProfile(): void {
  profiles := [
    IOSProvisioningProfile { profilePath: "/wild", applicationIdentifier: "TEAM.dev.doof.*", expirationEpochMs: 300L },
    IOSProvisioningProfile { profilePath: "/exact-expired", applicationIdentifier: "TEAM.dev.doof.demo", expirationEpochMs: 90L },
    IOSProvisioningProfile { profilePath: "/exact-active", applicationIdentifier: "TEAM.dev.doof.demo", expirationEpochMs: 200L },
  ]
  selected := try! selectProvisioningProfile("dev.doof.demo", profiles, 100L)
  Assert.equal(selected.profilePath, "/exact-active")

  expiredExact := try! selectProvisioningProfile("dev.doof.demo", [profiles[0], profiles[1]], 100L)
  Assert.equal(expiredExact.profilePath, "/exact-expired")
}

export function testReportsMissingProvisioningProfileAndSigningIdentity(): void {
  profileResult := selectProvisioningProfile("dev.missing.app", [], 100L)
  Assert.equal(profileResult.isFailure(), true)
  case profileResult { failure: Failure<string> -> Assert.stringContains(failure.error, "--ios-provisioning-profile") }

  identityResult := selectSigningIdentity(IOSProvisioningProfile {
    profilePath: "/empty.mobileprovision",
    applicationIdentifier: "TEAM.dev.doof.demo",
    expirationEpochMs: 200L,
  }, [])
  Assert.equal(identityResult.isFailure(), true)
  case identityResult { failure: Failure<string> -> Assert.stringContains(failure.error, "DeveloperCertificates") }
}

export function testParsesAndMatchesCodesignIdentityFingerprint(): void {
  identities := parseCodesignIdentities(
    "  1) 11966AB9C099F8FABEFAC54C08D5BE2BD8C903AF \"Apple Development: Jane Doe (TEAMID)\"\n" +
    "     0 valid identities found",
  )
  Assert.equal(identities.length, 1)
  Assert.equal(identities[0].name, "Apple Development: Jane Doe (TEAMID)")
  profile := IOSProvisioningProfile {
    profilePath: "/profile.mobileprovision",
    applicationIdentifier: "TEAMID.dev.doof.demo",
    certFingerprints: ["11966AB9C099F8FABEFAC54C08D5BE2BD8C903AF"],
    expirationEpochMs: 200L,
  }
  Assert.equal(try! selectSigningIdentity(profile, identities), identities[0].name)
}
