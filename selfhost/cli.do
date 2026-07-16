// Minimal command-line model for the self-hosted compiler.
//
// Keep argument parsing independent from filesystem and process operations so
// future commands can reuse the same request shape without growing the native
// driver into a second compiler implementation.

export class CliRequest {
  command: string
  entry: string
  outputDirectory: string = ""
  compiler: string = ""
  sourcePaths: string[] = []
  moduleSources: ModuleSource[] = []
  filter: string = ""
  listOnly: bool = false
  coverage: bool = false
  coverageOutput: string = ""
  distDirectory: string = ""
  macosSigning: string = ""
  macosSignIdentity: string = ""
  macosSandbox: bool = false
  macosEntitlements: string = ""
  iosDestination: string = "simulator"
  iosSignIdentity: string = ""
  iosProvisioningProfile: string = ""
}

export class ModuleSource {
  specifier: string
  sourcePath: string
}

export class CliParseResult {
  request: CliRequest | null
  error: string = ""
  help: bool = false
}

export function cliUsage(): string {
  return "usage: doof-selfhost <build|package|emit|check|test> [entry.do|package-dir] [options]\n" +
    "\n" +
    "commands:\n" +
    "  build   emit generated C++ and build the executable\n" +
    "  package build an optimized executable in the package dist directory\n" +
    "  emit    check the source graph and write generated C++\n" +
    "  check   check the source graph without writing output\n" +
    "  test    discover and run exported test functions\n" +
    "\n" +
    "options:\n" +
    "  -o, --output-directory <path>  output root (package uses <path>/release)\n" +
    "  --compiler <path>           C++ compiler command (default: CXX or c++)\n" +
    "  --distdir <path>            packaged artifact directory\n" +
    "  --macos-signing <kind>      developer-id or ad-hoc\n" +
    "  --macos-sign-identity <id>  Developer ID Application identity\n" +
    "  --macos-sandbox             enable App Sandbox entitlement\n" +
    "  --macos-entitlements <path> merge additional entitlements plist\n" +
    "  --ios-destination <kind>   iOS build destination: simulator or device\n" +
    "  --ios-sign-identity <id>   Apple signing identity for device/package builds\n" +
    "  --ios-provisioning-profile <path> provisioning profile for device/package builds\n" +
    "  --source <path>             add a source file to the graph (repeatable)\n" +
    "  --module <specifier> <path> map an external import to a source file\n" +
    "  --filter <text>             run tests whose id contains text\n" +
    "  --list                      list tests without building or running\n" +
    "  --coverage                  collect line coverage while running tests\n" +
    "  --coverage-output <path>    write coverage JSON to this path\n" +
    "  -h, --help                  show this help"
}

export function parseCli(args: string[]): CliParseResult {
  if args.length == 0 { return CliParseResult { request: null, error: "missing command" } }
  if args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
    return CliParseResult { request: null, help: true }
  }

  command := args[0]
  if command != "build" && command != "package" && command != "emit" && command != "check" && command != "test" {
    return CliParseResult { request: null, error: "unknown command '" + command + "'" }
  }
  request := CliRequest { command, entry: if args.length < 2 then "." else args[1] }
  let index = if args.length < 2 then 1 else 2
  while index < args.length {
    argument := args[index]
    if argument == "-h" || argument == "--help" {
      return CliParseResult { request: null, help: true }
    }
    if argument == "-o" || argument == "--output-directory" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for " + argument } }
      request.outputDirectory = args[index + 1]
      index = index + 2
      continue
    }
    if argument == "--compiler" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --compiler" } }
      request.compiler = args[index + 1]
      index = index + 2
      continue
    }
    if argument == "--distdir" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --distdir" } }
      request.distDirectory = args[index + 1]
      index = index + 2
      continue
    }
    if argument == "--macos-signing" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --macos-signing" } }
      value := args[index + 1]
      if value != "developer-id" && value != "ad-hoc" {
        return CliParseResult { request: null, error: "invalid value for --macos-signing: " + value }
      }
      request.macosSigning = value
      index = index + 2
      continue
    }
    if argument == "--macos-sign-identity" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --macos-sign-identity" } }
      request.macosSignIdentity = args[index + 1]
      index = index + 2
      continue
    }
    if argument == "--macos-sandbox" {
      request.macosSandbox = true
      index = index + 1
      continue
    }
    if argument == "--macos-entitlements" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --macos-entitlements" } }
      request.macosEntitlements = args[index + 1]
      index = index + 2
      continue
    }
    if argument == "--ios-destination" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --ios-destination" } }
      value := args[index + 1]
      if value != "simulator" && value != "device" {
        return CliParseResult { request: null, error: "invalid value for --ios-destination: " + value }
      }
      request.iosDestination = value
      index += 2
      continue
    }
    if argument == "--ios-sign-identity" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --ios-sign-identity" } }
      request.iosSignIdentity = args[index + 1]
      index += 2
      continue
    }
    if argument == "--ios-provisioning-profile" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --ios-provisioning-profile" } }
      request.iosProvisioningProfile = args[index + 1]
      index += 2
      continue
    }
    if argument == "--source" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --source" } }
      request.sourcePaths.push(args[index + 1])
      index = index + 2
      continue
    }
    if argument == "--filter" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --filter" } }
      request.filter = args[index + 1]
      index = index + 2
      continue
    }
    if argument == "--list" {
      request.listOnly = true
      index = index + 1
      continue
    }
    if argument == "--coverage" {
      request.coverage = true
      index = index + 1
      continue
    }
    if argument == "--coverage-output" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --coverage-output" } }
      request.coverageOutput = args[index + 1]
      index = index + 2
      continue
    }
    if argument == "--module" {
      if index + 2 >= args.length { return CliParseResult { request: null, error: "missing values for --module" } }
      specifier := args[index + 1]
      if specifier.startsWith(".") || specifier == "" {
        return CliParseResult { request: null, error: "--module requires a bare module specifier" }
      }
      request.moduleSources.push(ModuleSource { specifier, sourcePath: args[index + 2] })
      index = index + 3
      continue
    }
    return CliParseResult { request: null, error: "unknown option '" + argument + "'" }
  }

  return CliParseResult { request }
}
