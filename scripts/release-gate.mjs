import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const nodeCommand = process.execPath;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const runRoot = path.join(repositoryRoot, "build", "release-gate", runId);
const stdlibRoot = path.resolve(process.env.DOOF_STDLIB_ROOT || path.join(repositoryRoot, "..", "doof-stdlib"));
const environment = { ...process.env, DOOF_STDLIB_ROOT: stdlibRoot };

function displayCommand(command, args) {
  return [command, ...args].map((value) => JSON.stringify(value)).join(" ");
}

function run(command, args, options = {}) {
  console.log(`$ ${displayCommand(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || repositoryRoot,
    env: options.env || environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== (options.expectedStatus ?? 0)) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function stage(name, action) {
  const started = Date.now();
  console.log(`\n== ${name} ==`);
  action();
  console.log(`== ${name} completed in ${((Date.now() - started) / 1000).toFixed(1)}s ==`);
}

function compilerPath(directory) {
  return path.join(directory, `doof${executableSuffix}`);
}

function builtProgramPath(directory, name) {
  return path.join(directory, `${name}${executableSuffix}`);
}

function copyFixture(name) {
  const source = path.join(repositoryRoot, "selfhost", "release-fixtures", name);
  const destination = path.join(runRoot, "fixtures", name);
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

const comparedExtensions = new Set([".c", ".cc", ".cpp", ".h", ".hh", ".hpp", ".m", ".mm"]);

function collectTextArtifacts(root) {
  const artifacts = new Map();
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".doof-objects" || entry.name === ".reckon") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (comparedExtensions.has(path.extname(entry.name))) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        artifacts.set(relative, fs.readFileSync(absolute, "utf8"));
      }
    }
  }
  visit(root);
  return artifacts;
}

function compareBootstrapArtifacts(leftRoot, rightRoot) {
  const left = collectTextArtifacts(leftRoot);
  const right = collectTextArtifacts(rightRoot);
  const names = [...new Set([...left.keys(), ...right.keys()])].sort();
  const differences = names.filter((name) => left.get(name) !== right.get(name));
  if (differences.length > 0) {
    throw new Error(`B5/B6 generated artifacts differ:\n${differences.slice(0, 20).join("\n")}`);
  }
  console.log(`Compared ${names.length} generated text artifacts byte-for-byte.`);
}

function requirePath(target, description) {
  if (!fs.existsSync(target)) throw new Error(`Missing ${description}: ${target}`);
}

function runOptionalHttpRuntime(compiler, fixtureRoot) {
  if (process.env.DOOF_HTTP_RUNTIME_TEST !== "1") return;
  const localProject = path.join(runRoot, "fixtures", "local-http-client");
  fs.cpSync(fixtureRoot, localProject, { recursive: true });
  const mainPath = path.join(localProject, "main.do");
  fs.writeFileSync(mainPath, fs.readFileSync(mainPath, "utf8").replaceAll("https://example.com", "http://127.0.0.1:18765"));
  const manifestPath = path.join(localProject, "doof.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.name = "selfhost-release-local-http";
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const output = path.join(runRoot, "verify", "local-http");
  run(compiler, ["build", localProject, "-o", output]);
  const binary = builtProgramPath(output, manifest.name);
  run("sh", [
    "-c",
    "python3 -m http.server 18765 --bind 127.0.0.1 --directory \"$1\" >/dev/null 2>&1 & server=$!; sleep 1; \"$2\"; status=$?; kill $server; wait $server 2>/dev/null; exit $status",
    "release-http-runtime",
    runRoot,
    binary,
  ]);
}

try {
  requirePath(stdlibRoot, "Doof stdlib root (set DOOF_STDLIB_ROOT to override ../doof-stdlib)");
  fs.mkdirSync(runRoot, { recursive: true });
  console.log(`Release gate workspace: ${runRoot}`);

  stage("Build TypeScript compiler", () => run(npmCommand, ["run", "build"]));

  stage("Self-host unit coverage", () => run(nodeCommand, [
    "dist/bin.js", "test", "selfhost", "--coverage",
    "--coverage-output", path.join(runRoot, "coverage", "selfhost.json"),
  ]));

  const seedDirectory = path.join(runRoot, "seed");
  const b5Directory = path.join(runRoot, "b5");
  const b6Directory = path.join(runRoot, "b6");

  stage("Build seed compiler", () => run(nodeCommand, ["dist/bin.js", "build", ".", "-o", seedDirectory]));
  const seedCompiler = compilerPath(path.join(seedDirectory, "debug"));
  requirePath(seedCompiler, "seed compiler");

  stage("B5 self-build", () => run(seedCompiler, ["build", ".", "-o", b5Directory]));
  const b5Compiler = compilerPath(b5Directory);
  requirePath(b5Compiler, "B5 compiler");

  stage("B6 self-build", () => run(b5Compiler, ["build", ".", "-o", b6Directory]));
  const b6Compiler = compilerPath(b6Directory);
  requirePath(b6Compiler, "B6 compiler");

  stage("B5/B6 fixed-point comparison", () => compareBootstrapArtifacts(b5Directory, b6Directory));

  const runtimeFixture = copyFixture("runtime");
  const nativeFixture = copyFixture("native-interop");
  const stdlibFixture = copyFixture("stdlib");
  const testFixture = copyFixture("test-runner");

  stage("B6 command and portable E2E verification", () => {
    run(b6Compiler, ["check", runtimeFixture]);
    run(b6Compiler, ["emit", runtimeFixture, "-o", path.join(runRoot, "verify", "emit")]);

    const nativeOutput = path.join(runRoot, "verify", "native");
    run(b6Compiler, ["build", nativeFixture, "-o", nativeOutput]);
    run(builtProgramPath(nativeOutput, "selfhost-release-native-interop"), [], { cwd: runRoot });

    const stdlibOutput = path.join(runRoot, "verify", "stdlib");
    run(b6Compiler, ["build", stdlibFixture, "-o", stdlibOutput]);
    run(builtProgramPath(stdlibOutput, "selfhost-release-stdlib"), [], { cwd: runRoot });

    run(b6Compiler, ["test", testFixture, "--list"]);
    const selfhostCoverageReport = path.join(runRoot, "coverage", "selfhost-native.json");
    run(b6Compiler, ["test", testFixture, "--coverage", "--coverage-output", selfhostCoverageReport]);
    requirePath(selfhostCoverageReport, "self-hosted compiler coverage report");
    requirePath(selfhostCoverageReport.replace(/\.json$/, ".html"), "self-hosted compiler coverage HTML report");
    requirePath(path.join(testFixture, "runtime-cwd.txt"), "package-root test artifact");

    const packageState = path.join(runRoot, "verify", "runtime-package");
    run(b6Compiler, ["package", runtimeFixture, "-o", packageState]);
    const packagedBinary = builtProgramPath(path.join(runtimeFixture, "dist"), "selfhost-release-runtime");
    requirePath(packagedBinary, "packaged runtime fixture");
    requirePath(path.join(runtimeFixture, "dist", "release-resource.txt"), "packaged executable resource");
    run(packagedBinary, [], { cwd: runRoot });
  });

  if (process.platform === "darwin") {
    stage("macOS framework and HTTP verification", () => {
      const platformFixture = copyFixture("platform-framework");
      const platformOutput = path.join(runRoot, "verify", "platform-framework");
      run(b6Compiler, ["build", platformFixture, "-o", platformOutput]);
      run(builtProgramPath(platformOutput, "selfhost-release-platform-framework"), [], { cwd: runRoot });

      const iosFixture = copyFixture("ios-app");
      const iosOutput = path.join(runRoot, "verify", "ios-app");
      run(b6Compiler, ["build", iosFixture, "-o", iosOutput, "--ios-destination", "simulator"]);
      requirePath(path.join(iosOutput, "SelfhostIOS.app", "SelfhostIOS"), "self-hosted iOS simulator app executable");
      requirePath(path.join(iosOutput, "SelfhostIOS.app", "Info.plist"), "self-hosted iOS simulator app plist");

      const httpFixture = path.join(repositoryRoot, "samples", "http-client");
      run(b6Compiler, ["check", httpFixture]);
      run(b6Compiler, ["build", httpFixture, "-o", path.join(runRoot, "verify", "http-client")]);
      runOptionalHttpRuntime(b6Compiler, httpFixture);
    });
  }

  console.log(`\nRelease gate passed. Artifacts: ${runRoot}`);
} catch (error) {
  console.error(`\nRelease gate failed. Artifacts preserved at ${runRoot}`);
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}
