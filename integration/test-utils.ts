import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ExpectationOverrides {
  expectPanic?: boolean;
  panicMessage?: string;
  expectedExitCode?: number;
}

interface TestExpectationFile extends ExpectationOverrides {
  skipBackends?: Array<'vm' | 'cpp' | 'js'>;
  onlyBackends?: Array<'vm' | 'cpp' | 'js'>;
  backends?: {
    vm?: ExpectationOverrides;
    cpp?: ExpectationOverrides;
    js?: ExpectationOverrides;
  };
}

interface EffectiveExpectation extends ExpectationOverrides {
  expectPanic: boolean;
  skip?: boolean;
}

function normalizeOutput(output: string): string {
  return output.trim().replace(/\r\n/g, '\n');
}

async function runCommand(command: string): Promise<ExecutionResult> {
  try {
    const result = await execAsync(command);
    return {
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      exitCode: 0
    };
  } catch (error) {
    if (error && typeof error === 'object') {
      const possible = error as { stdout?: string; stderr?: string; code?: number };
      const exitCode = typeof possible.code === 'number' ? possible.code : 1;
      const stdout = typeof possible.stdout === 'string' ? possible.stdout : '';
      const stderr = typeof possible.stderr === 'string' ? possible.stderr : '';
      return {
        stdout,
        stderr,
        exitCode
      };
    }
    throw error;
  }
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
  exitCode?: number;
  duration: number;
  backend: string;
}

export interface TestSuite {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
  duration: number;
  backend: string;
}

export type Backend = 'vm' | 'cpp' | 'js';

export interface TestBackend {
  name: string;
  compile(doFilePath: string, outputDir: string): Promise<string>; // Returns path to compiled artifact
  execute(artifactPath: string): Promise<ExecutionResult>; // Returns execution result
  cleanup?(artifactPath: string): Promise<void>; // Optional cleanup
}

export class VMTestBackend implements TestBackend {
  name = 'vm';
  private doofCliPath: string;
  private jsonRunnerPath: string;

  constructor(doofCliPath: string, jsonRunnerPath: string) {
    this.doofCliPath = doofCliPath;
    this.jsonRunnerPath = jsonRunnerPath;
  }

  async compile(doFilePath: string, outputDir: string): Promise<string> {
    const testName = path.basename(doFilePath, '.do');
    const vmbcFilePath = path.join(outputDir, `${testName}.vmbc`);
    
    const transpileCmd = `npx tsx "${this.doofCliPath}" -t vm -o "${outputDir}" "${doFilePath}"`;
    await execAsync(transpileCmd);
    
    // Check if .vmbc file was created
    await fs.access(vmbcFilePath);
    return vmbcFilePath;
  }

  async execute(artifactPath: string): Promise<ExecutionResult> {
    const runCmd = `"${this.jsonRunnerPath}" "${artifactPath}"`;
    return runCommand(runCmd);
  }
}

export class CppTestBackend implements TestBackend {
  name = 'cpp';
  private doofCliPath: string;
  private runtimeCppPath: string;

  constructor(doofCliPath: string, runtimeCppPath: string) {
    this.doofCliPath = doofCliPath;
    this.runtimeCppPath = runtimeCppPath;
  }

  async compile(doFilePath: string, outputDir: string): Promise<string> {
    const testName = path.basename(doFilePath, '.do');
    const cppFilePath = path.join(outputDir, `${testName}.cpp`);
    const executablePath = path.join(outputDir, testName);
    
    // Transpile to C++
    const transpileCmd = `npx tsx "${this.doofCliPath}" -t cpp -o "${outputDir}" "${doFilePath}"`;
    await execAsync(transpileCmd);
    
    // Check if .cpp file was created
    await fs.access(cppFilePath);
    
    // Compile with clang++
    const compileCmd = `clang++ -std=c++17 -I "${path.dirname(this.runtimeCppPath)}" "${cppFilePath}" "${this.runtimeCppPath}" -o "${executablePath}"`;
    await execAsync(compileCmd);
    
    // Check if executable was created
    await fs.access(executablePath);
    return executablePath;
  }

  async execute(artifactPath: string): Promise<ExecutionResult> {
    const runCmd = `"${artifactPath}"`;
    return runCommand(runCmd);
  }

  async cleanup(artifactPath: string): Promise<void> {
    try {
      await fs.unlink(artifactPath);
      // Also clean up the cpp file
      const testName = path.basename(artifactPath);
      const cppFilePath = path.join(path.dirname(artifactPath), `${testName}.cpp`);
      await fs.unlink(cppFilePath);
      // Also clean up the header file if it exists
      const headerFilePath = path.join(path.dirname(artifactPath), `${testName}.h`);
      try {
        await fs.unlink(headerFilePath);
      } catch {
        // Header file might not exist, ignore
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

export class JsTestBackend implements TestBackend {
  name = 'js';
  private doofCliPath: string;

  constructor(doofCliPath: string) {
    this.doofCliPath = doofCliPath;
  }

  async compile(doFilePath: string, outputDir: string): Promise<string> {
    const testName = path.basename(doFilePath, '.do');
    const jsFilePath = path.join(outputDir, `${testName}.js`);
    
    // Transpile to JavaScript
    const transpileCmd = `npx tsx "${this.doofCliPath}" -t js -o "${outputDir}" "${doFilePath}"`;
    await execAsync(transpileCmd);
    
    // Check if .js file was created
    await fs.access(jsFilePath);
    return jsFilePath;
  }

  async execute(artifactPath: string): Promise<ExecutionResult> {
    const runCmd = `node "${artifactPath}"`;
    return runCommand(runCmd);
  }

  async cleanup(artifactPath: string): Promise<void> {
    try {
      await fs.unlink(artifactPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

export class UnifiedTestRunner {
  private backend: TestBackend;
  private testDataDir: string;
  private expectedDir: string;
  private generatedDir: string;
  private verbose: boolean;

  constructor(backend: TestBackend, options: {
    testDataDir?: string;
    expectedDir?: string;
    generatedDir?: string;
    verbose?: boolean;
  } = {}) {
    this.backend = backend;
    this.testDataDir = options.testDataDir || path.join(__dirname, 'test-data');
    this.expectedDir = options.expectedDir || path.join(__dirname, 'expected');
    this.generatedDir = options.generatedDir || path.join(__dirname, 'generated');
    this.verbose = options.verbose || false;
  }

  async runSingleTest(testFile: string): Promise<TestResult> {
    const startTime = Date.now();
    const testName = path.basename(testFile, '.do');
    
    try {
      if (this.verbose) {
        console.log(`Running test: ${testName} on ${this.backend.name} backend`);
      }

      // Ensure generated directory exists
      await fs.mkdir(this.generatedDir, { recursive: true });
      
      const doFilePath = path.join(this.testDataDir, testFile);

      // Load expectation early to allow backend-specific skipping
      const expectation = await this.loadExpectation(testName);

      // Optional skip support: if skipBackends/onlyBackends rules exclude this backend, mark as passed (skipped)
      if (expectation.skip) {
        return {
          name: testName,
          passed: true,
          duration: Date.now() - startTime,
          backend: this.backend.name
        };
      }
      
      // Step 1: Compile using the backend
      let artifactPath: string;
      try {
        artifactPath = await this.backend.compile(doFilePath, this.generatedDir);
      } catch (error) {
        return {
          name: testName,
          passed: false,
          error: `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
          duration: Date.now() - startTime,
          backend: this.backend.name
        };
      }


      // Step 2: Execute using the backend
      let execution: ExecutionResult;
      try {
        execution = await this.backend.execute(artifactPath);
      } catch (error) {
        return {
          name: testName,
          passed: false,
          error: `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
          duration: Date.now() - startTime,
          backend: this.backend.name
        };
      }

      // Step 3: Compare output with expected
      const expectedFilePath = path.join(this.expectedDir, `${testName}.expected`);
      let expectedOutput: string;
      
      try {
        expectedOutput = await fs.readFile(expectedFilePath, 'utf-8');
      } catch {
        return {
          name: testName,
          passed: false,
          error: `Expected output file not found: ${expectedFilePath}`,
          duration: Date.now() - startTime,
          backend: this.backend.name
        };
      }

      // Normalize outputs for comparison (trim whitespace, normalize line endings)
      const normalizedActual = normalizeOutput(execution.stdout);
      const normalizedExpected = normalizeOutput(expectedOutput);
      const normalizedStderr = normalizeOutput(execution.stderr);

      let result: TestResult | undefined;

      if (expectation.expectPanic) {
        if (execution.exitCode === 0) {
          result = {
            name: testName,
            passed: false,
            error: 'Expected panic but execution exited with code 0',
            backend: this.backend.name,
            duration: 0
          };
          result.stderr = normalizedStderr;
          result.exitCode = execution.exitCode;
        } else if (typeof expectation.expectedExitCode === 'number' && execution.exitCode !== expectation.expectedExitCode) {
          result = {
            name: testName,
            passed: false,
            error: `Expected exit code ${expectation.expectedExitCode} but received ${execution.exitCode}`,
            backend: this.backend.name,
            duration: 0
          };
          result.stderr = normalizedStderr;
          result.exitCode = execution.exitCode;
        }
      } else if (execution.exitCode !== 0) {
        result = {
          name: testName,
          passed: false,
          error: `Execution failed with exit code ${execution.exitCode}`,
          backend: this.backend.name,
          duration: 0
        };
        result.stderr = normalizedStderr;
        result.exitCode = execution.exitCode;
      }

      if (!result && expectation.expectPanic && expectation.panicMessage) {
        const expectedMessage = normalizeOutput(expectation.panicMessage);
        let messageMatches = false;
        if (normalizedStderr === expectedMessage) {
          messageMatches = true;
        } else {
          const stderrLines = normalizedStderr.split('\n');
          for (const line of stderrLines) {
            if (line.trim() === expectedMessage) {
              messageMatches = true;
              break;
            }
          }
        }

        if (!messageMatches) {
          result = {
            name: testName,
            passed: false,
            error: 'Panic message mismatch',
            backend: this.backend.name,
            duration: 0
          };
          result.expected = expectedMessage;
          result.actual = normalizedStderr;
          result.stderr = normalizedStderr;
          result.exitCode = execution.exitCode;
        }
      }

      if (!result) {
        const outputsMatch = normalizedActual === normalizedExpected;
        if (outputsMatch) {
          result = {
            name: testName,
            passed: true,
            backend: this.backend.name,
            duration: 0
          };
        } else {
          result = {
            name: testName,
            passed: false,
            error: 'Output mismatch',
            backend: this.backend.name,
            duration: 0
          };
          result.expected = normalizedExpected;
          result.actual = normalizedActual;
          if (normalizedStderr.length > 0) {
            result.stderr = normalizedStderr;
          }
          result.exitCode = execution.exitCode;
        }
      }

      result.exitCode = typeof result.exitCode === 'number' ? result.exitCode : execution.exitCode;
      result.duration = Date.now() - startTime;

      if (this.verbose) {
        console.log(`  Result: ${result.passed ? 'PASS' : 'FAIL'} (${result.duration}ms)`);
        if (!result.passed) {
          if (typeof result.expected === 'string') {
            console.log(`    Expected: ${JSON.stringify(result.expected)}`);
          }
          if (typeof result.actual === 'string') {
            console.log(`    Actual:   ${JSON.stringify(result.actual)}`);
          }
          if (result.stderr) {
            console.log(`    Stderr:   ${JSON.stringify(result.stderr)}`);
          }
          if (typeof result.exitCode === 'number') {
            console.log(`    ExitCode: ${result.exitCode}`);
          }
        }
      }

      // Cleanup if the backend supports it
      if (this.backend.cleanup) {
        try {
          await this.backend.cleanup(artifactPath);
        } catch {
          // Ignore cleanup errors
        }
      }

  return result;

    } catch (error) {
      return {
        name: testName,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        backend: this.backend.name
      };
    }
  }

  async runAllTests(): Promise<TestSuite> {
    const startTime = Date.now();
    
    // Find all .do files in test-data directory
    const testFiles = await fs.readdir(this.testDataDir);
    const doFiles = testFiles.filter(file => file.endsWith('.do'));

    if (doFiles.length === 0) {
      throw new Error(`No .do test files found in ${this.testDataDir}`);
    }

    console.log(`Found ${doFiles.length} test files for ${this.backend.name} backend`);

    const results: TestResult[] = [];

    // Run tests sequentially to avoid resource conflicts
    for (const doFile of doFiles) {
      const result = await this.runSingleTest(doFile);
      results.push(result);
    }

    const passedTests = results.filter(r => r.passed).length;
    const failedTests = results.length - passedTests;

    return {
      totalTests: results.length,
      passedTests,
      failedTests,
      results,
      duration: Date.now() - startTime,
      backend: this.backend.name
    };
  }

  async runSpecificTests(testNames: string[]): Promise<TestSuite> {
    const startTime = Date.now();
    const results: TestResult[] = [];

    console.log(`Running ${testNames.length} specific tests on ${this.backend.name} backend`);

    for (const testName of testNames) {
      const doFile = testName.endsWith('.do') ? testName : `${testName}.do`;
      const result = await this.runSingleTest(doFile);
      results.push(result);
    }

    const passedTests = results.filter(r => r.passed).length;
    const failedTests = results.length - passedTests;

    return {
      totalTests: results.length,
      passedTests,
      failedTests,
      results,
      duration: Date.now() - startTime,
      backend: this.backend.name
    };
  }

  private async loadExpectation(testName: string): Promise<EffectiveExpectation> {
    const metaPath = path.join(this.expectedDir, `${testName}.meta.json`);

    try {
      const raw = await fs.readFile(metaPath, 'utf-8');
      const parsed = JSON.parse(raw) as TestExpectationFile;

      let resolvedExpectPanic = parsed.expectPanic;
      let resolvedPanicMessage = parsed.panicMessage;
      let resolvedExitCode = parsed.expectedExitCode;
      let skip = false;

      // Evaluate skip/only rules
      if (parsed.onlyBackends && parsed.onlyBackends.length > 0) {
        if (!parsed.onlyBackends.includes(this.backend.name as any)) {
          skip = true;
        }
      }
      if (!skip && parsed.skipBackends && parsed.skipBackends.length > 0) {
        if (parsed.skipBackends.includes(this.backend.name as any)) {
          skip = true;
        }
      }

      if (parsed.backends) {
        let backendOverrides: ExpectationOverrides | undefined;
        if (this.backend.name === 'vm') {
          backendOverrides = parsed.backends.vm;
        } else if (this.backend.name === 'cpp') {
          backendOverrides = parsed.backends.cpp;
        } else if (this.backend.name === 'js') {
          backendOverrides = parsed.backends.js;
        }

        if (backendOverrides) {
          if (typeof backendOverrides.expectPanic !== 'undefined') {
            resolvedExpectPanic = backendOverrides.expectPanic;
          }
          if (typeof backendOverrides.panicMessage !== 'undefined') {
            resolvedPanicMessage = backendOverrides.panicMessage;
          }
          if (typeof backendOverrides.expectedExitCode !== 'undefined') {
            resolvedExitCode = backendOverrides.expectedExitCode;
          }
        }
      }

      return {
        expectPanic: resolvedExpectPanic === true,
        panicMessage: resolvedPanicMessage,
        expectedExitCode: resolvedExitCode,
        skip
      };
    } catch {
      return { expectPanic: false };
    }
  }

  printResults(suite: TestSuite): void {
    console.log(`\n=== ${suite.backend.toUpperCase()} Test Results ===`);
    console.log(`Total: ${suite.totalTests}, Passed: ${suite.passedTests}, Failed: ${suite.failedTests}`);
    console.log(`Duration: ${suite.duration}ms\n`);

    // Print failed tests
    const failedTests = suite.results.filter(r => !r.passed);
    if (failedTests.length > 0) {
      console.log('Failed Tests:');
      for (const test of failedTests) {
        console.log(`  ❌ ${test.name} (${test.duration}ms)`);
        if (test.error) {
          console.log(`     Error: ${test.error}`);
        }
        if (test.expected && test.actual) {
          console.log(`     Expected: ${JSON.stringify(test.expected)}`);
          console.log(`     Actual:   ${JSON.stringify(test.actual)}`);
        }
        if (test.stderr) {
          console.log(`     Stderr:  ${JSON.stringify(test.stderr)}`);
        }
        if (typeof test.exitCode === 'number') {
          console.log(`     ExitCode: ${test.exitCode}`);
        }
      }
      console.log();
    }

    // Print passed tests
    if (this.verbose) {
      const passedTests = suite.results.filter(r => r.passed);
      if (passedTests.length > 0) {
        console.log('Passed Tests:');
        for (const test of passedTests) {
          console.log(`  ✅ ${test.name} (${test.duration}ms)`);
        }
        console.log();
      }
    }

    // Summary
    const successRate = (suite.passedTests / suite.totalTests * 100).toFixed(1);
    console.log(`Success Rate: ${successRate}%`);
  }
}

// Legacy class for backward compatibility
export class VMTestRunner extends UnifiedTestRunner {
  constructor(options: {
    doofCliPath?: string;
    jsonRunnerPath?: string;
    testDataDir?: string;
    expectedDir?: string;
    generatedDir?: string;
    verbose?: boolean;
  } = {}) {
    const projectRoot = path.resolve(__dirname, '../');
    const doofCliPath = options.doofCliPath || path.join(projectRoot, 'src/cli.ts');
    const jsonRunnerPath = options.jsonRunnerPath || path.join(projectRoot, 'vm/build/json-runner');
    
    const backend = new VMTestBackend(doofCliPath, jsonRunnerPath);
    
    super(backend, {
      testDataDir: options.testDataDir,
      expectedDir: options.expectedDir,
      generatedDir: options.generatedDir,
      verbose: options.verbose
    });
  }
}

export function createTestBackend(backend: Backend, projectRoot: string): TestBackend {
  const doofCliPath = path.join(projectRoot, 'src/cli.ts');
  
  switch (backend) {
    case 'vm':
      const jsonRunnerPath = path.join(projectRoot, 'vm/build/json-runner');
      return new VMTestBackend(doofCliPath, jsonRunnerPath);
      
    case 'cpp':
      const runtimeCppPath = path.join(projectRoot, 'doof_runtime.cpp');
      return new CppTestBackend(doofCliPath, runtimeCppPath);
      
    case 'js':
      return new JsTestBackend(doofCliPath);
      
    default:
      throw new Error(`Unknown backend: ${backend}`);
  }
}

export async function checkDependencies(): Promise<{ 
  transpiler: boolean; 
  vm: boolean; 
  cpp: boolean;
  js: boolean;
  errors: string[] 
}> {
  const errors: string[] = [];
  let transpiler = false;
  let vm = false;
  let cpp = false;
  let js = false;

  const projectRoot = path.resolve(__dirname, '../');

  // Check if doof CLI exists
  try {
    const doofCliPath = path.join(projectRoot, 'src/cli.ts');
    await fs.access(doofCliPath);
    transpiler = true;
  } catch {
    errors.push('Doof CLI not found at src/cli.ts');
  }

  // Check if VM json-runner exists
  try {
    const jsonRunnerPath = path.join(projectRoot, 'vm/build/json-runner');
    await fs.access(jsonRunnerPath);
    vm = true;
  } catch {
    errors.push('VM json-runner not found at vm/build/json-runner - run "cd vm && mkdir -p build && cd build && cmake .. && cmake --build ."');
  }

  // Check if C++ compiler exists
  try {
    await execAsync('clang++ --version');
    cpp = true;
  } catch {
    errors.push('C++ compiler (clang++) not found - install Xcode Command Line Tools');
  }

  // Check if doof runtime exists
  try {
    const runtimeCppPath = path.join(projectRoot, 'doof_runtime.cpp');
    await fs.access(runtimeCppPath);
  } catch {
    errors.push('Doof runtime not found at doof_runtime.cpp');
    cpp = false;
  }

  // Check if Node.js exists
  try {
    await execAsync('node --version');
    js = true;
  } catch {
    errors.push('Node.js not found - install Node.js');
  }

  return { transpiler, vm, cpp, js, errors };
}
