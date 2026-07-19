import { Assert } from "std/assert"
import {
  IOSCodesignIdentity, IOSProvisioningProfile, parseCodesignIdentities, parseConnectedIOSDevices,
  resolveIOSAdHocSigningIdentity,
  selectIOSDeviceIdentifier, selectProvisioningProfile, selectSigningIdentity,
  validateIOSAdHocSigning,
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

export function testValidatesAdHocPackageProfileAndIdentityTogether(): void {
  profile := IOSProvisioningProfile {
    profilePath: "/profile.mobileprovision",
    applicationIdentifier: "TEAMID.dev.doof.*",
    certFingerprints: ["11966AB9C099F8FABEFAC54C08D5BE2BD8C903AF"],
    expirationEpochMs: 200L,
    provisionedDeviceCount: 1,
  }
  identities := [IOSCodesignIdentity {
    fingerprint: "11966AB9C099F8FABEFAC54C08D5BE2BD8C903AF",
    name: "Apple Distribution: Jane Doe (TEAMID)",
  }]
  result := validateIOSAdHocSigning(
    profile, identities, "Apple Distribution: Jane Doe (TEAMID)", "dev.doof.demo", 100L,
  )
  Assert.equal(result.isFailure(), false)
}

export function testAutoResolvesSingleDistributionIdentityFromProfileCertificates(): void {
  profile := IOSProvisioningProfile {
    profilePath: "/profile.mobileprovision",
    applicationIdentifier: "TEAMID.dev.doof.demo",
    certFingerprints: ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    expirationEpochMs: 200L,
    provisionedDeviceCount: 1,
  }
  identities := [
    IOSCodesignIdentity {
      fingerprint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      name: "Apple Distribution: Other Team (OTHERTEAM)",
    },
    IOSCodesignIdentity {
      fingerprint: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      name: "Apple Distribution: Jane Doe (TEAMID)",
    },
  ]
  Assert.equal(
    try! resolveIOSAdHocSigningIdentity(profile, identities, ""),
    "Apple Distribution: Jane Doe (TEAMID)",
  )
}

export function testRequiresOverrideWhenProfileHasMultipleInstalledDistributionIdentities(): void {
  profile := IOSProvisioningProfile {
    profilePath: "/profile.mobileprovision",
    applicationIdentifier: "TEAMID.dev.doof.demo",
    certFingerprints: [
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    ],
    expirationEpochMs: 200L,
    provisionedDeviceCount: 1,
  }
  identities := [
    IOSCodesignIdentity {
      fingerprint: profile.certFingerprints[0],
      name: "Apple Distribution: First (TEAMID)",
    },
    IOSCodesignIdentity {
      fingerprint: profile.certFingerprints[1],
      name: "Apple Distribution: Second (TEAMID)",
    },
  ]
  result := resolveIOSAdHocSigningIdentity(profile, identities, "")
  Assert.equal(result.isFailure(), true)
  case result { failure: Failure<string> -> Assert.stringContains(failure.error, "Multiple Apple Distribution identities") }
}

export function testRejectsPackageIdentityOutsideProvisioningProfile(): void {
  profile := IOSProvisioningProfile {
    profilePath: "/profile.mobileprovision",
    applicationIdentifier: "TEAMID.dev.doof.demo",
    certFingerprints: ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    expirationEpochMs: 200L,
    provisionedDeviceCount: 1,
  }
  identities := [IOSCodesignIdentity {
    fingerprint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    name: "Apple Distribution: Wrong Team (OTHERTEAM)",
  }]
  result := validateIOSAdHocSigning(
    profile, identities, "Apple Distribution: Wrong Team (OTHERTEAM)", "dev.doof.demo", 100L,
  )
  Assert.equal(result.isFailure(), true)
  case result { failure: Failure<string> -> Assert.stringContains(failure.error, "not included in provisioning profile") }
}

export function testRejectsExpiredAndNonAdHocPackageProfiles(): void {
  identities := [IOSCodesignIdentity {
    fingerprint: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    name: "Apple Distribution: Jane Doe (TEAMID)",
  }]
  expired := IOSProvisioningProfile {
    profilePath: "/expired.mobileprovision",
    applicationIdentifier: "TEAMID.dev.doof.demo",
    certFingerprints: [identities[0].fingerprint],
    expirationEpochMs: 100L,
    provisionedDeviceCount: 1,
  }
  expiredResult := validateIOSAdHocSigning(expired, identities, identities[0].name, "dev.doof.demo", 100L)
  Assert.equal(expiredResult.isFailure(), true)
  case expiredResult { failure: Failure<string> -> Assert.stringContains(failure.error, "expired") }

  development := IOSProvisioningProfile {
    profilePath: "/development.mobileprovision",
    applicationIdentifier: "TEAMID.dev.doof.demo",
    certFingerprints: [identities[0].fingerprint],
    expirationEpochMs: 200L,
    provisionedDeviceCount: 1,
    getTaskAllow: true,
  }
  developmentResult := validateIOSAdHocSigning(development, identities, identities[0].name, "dev.doof.demo", 100L)
  Assert.equal(developmentResult.isFailure(), true)
  case developmentResult { failure: Failure<string> -> Assert.stringContains(failure.error, "Development") }

  store := IOSProvisioningProfile {
    profilePath: "/store.mobileprovision",
    applicationIdentifier: "TEAMID.dev.doof.demo",
    certFingerprints: [identities[0].fingerprint],
    expirationEpochMs: 200L,
  }
  storeResult := validateIOSAdHocSigning(store, identities, identities[0].name, "dev.doof.demo", 100L)
  Assert.equal(storeResult.isFailure(), true)
  case storeResult { failure: Failure<string> -> Assert.stringContains(failure.error, "registered devices") }
}
