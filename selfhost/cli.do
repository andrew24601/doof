// Minimal command-line model for the self-hosted compiler.
//
// Keep argument parsing independent from filesystem and process operations so
// future commands can reuse the same request shape without growing the native
// driver into a second compiler implementation.

export class CliRequest {
  command: string
  entry: string
  outputDirectory: string = ""
  sourcePaths: string[] = []
  moduleSources: ModuleSource[] = []
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
  return "usage: doof-selfhost <emit|check> [entry.do|package-dir] [options]\n" +
    "\n" +
    "commands:\n" +
    "  emit   check the source graph and write generated C++\n" +
    "  check  check the source graph without writing output\n" +
    "\n" +
    "options:\n" +
    "  -o, --output-directory <path>  directory for emitted module files\n" +
    "  --source <path>             add a source file to the graph (repeatable)\n" +
    "  --module <specifier> <path> map an external import to a source file\n" +
    "  -h, --help                  show this help"
}

export function parseCli(args: string[]): CliParseResult {
  if args.length == 0 { return CliParseResult { request: null, error: "missing command" } }
  if args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
    return CliParseResult { request: null, help: true }
  }

  command := args[0]
  if command != "emit" && command != "check" {
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
    if argument == "--source" {
      if index + 1 >= args.length { return CliParseResult { request: null, error: "missing value for --source" } }
      request.sourcePaths.push(args[index + 1])
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
