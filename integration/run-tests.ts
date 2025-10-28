#!/usr/bin/env node

import { UnifiedTestRunner, createTestBackend, checkDependencies, Backend } from './test-utils.js';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliOptions {
  verbose: boolean;
  help: boolean;
  backend: Backend;
  specificTests: string[];
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    verbose: false,
    help: false,
    backend: 'vm', // Default to VM for backward compatibility
    specificTests: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--backend' || arg === '-b') {
      const backend = args[++i];
      if (backend === 'vm' || backend === 'cpp' || backend === 'js') {
        options.backend = backend;
      } else {
        console.error(`Invalid backend: ${backend}. Must be 'vm', 'cpp', or 'js'`);
        process.exit(1);
      }
    } else if (arg === '--all-backends') {
      // Special flag to run tests on all backends
      options.backend = 'all' as any;
    } else if (!arg.startsWith('-')) {
      // Treat non-flag arguments as specific test names
      options.specificTests.push(arg);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
Doof Multi-Backend Test Runner

Usage: npx tsx run-tests.ts [options] [test-names...]

Options:
  -v, --verbose        Show verbose output including passed tests
  -h, --help           Show this help message
  -b, --backend <type> Backend to test: 'vm' (default), 'cpp', or 'js'
  --all-backends       Run tests on all available backends

Examples:
  npx tsx run-tests.ts                          # Run all tests on VM backend
  npx tsx run-tests.ts --verbose                # Run all tests with verbose output
  npx tsx run-tests.ts --backend cpp            # Run all tests on C++ backend
  npx tsx run-tests.ts --backend js             # Run all tests on JavaScript backend
  npx tsx run-tests.ts --all-backends           # Run all tests on all backends
  npx tsx run-tests.ts basic-arithmetic         # Run specific test on VM backend
  npx tsx run-tests.ts --backend cpp basic-arithmetic  # Run specific test on C++ backend

Backends:
  vm   - Virtual Machine backend (requires vm/build/json-runner)
  cpp  - C++ backend (requires clang++ and doof_runtime.cpp)
  js   - JavaScript backend (requires Node.js)

Test Files:
  Test files should be placed in test-data/ with .do extension
  Expected outputs should be in expected/ with .expected extension
  Generated artifacts will be placed in generated/
`);
}

function findProjectRoot(startDir: string): string {
  let current = startDir;
  const filesystemRoot = path.parse(current).root;

  while (true) {
    const packageJsonPath = path.join(current, 'package.json');
    const cliPath = path.join(current, 'src', 'cli.ts');

    if (existsSync(packageJsonPath) && existsSync(cliPath)) {
      return current;
    }

    if (current === filesystemRoot) {
      throw new Error(`Unable to locate Doof project root starting from ${startDir}`);
    }

    current = path.dirname(current);
  }
}

async function runTestsForBackend(backend: Backend, options: CliOptions, projectRoot: string): Promise<boolean> {
  
  console.log(`\nRunning tests for ${backend.toUpperCase()} backend...`);
  
  // Create backend and test runner
  const testBackend = createTestBackend(backend, projectRoot);
  const runner = new UnifiedTestRunner(testBackend, {
    verbose: options.verbose
  });

  try {
    let suite;
    
    if (options.specificTests.length > 0) {
      suite = await runner.runSpecificTests(options.specificTests);
    } else {
      suite = await runner.runAllTests();
    }

    runner.printResults(suite);
    
    return suite.failedTests === 0;

  } catch (error) {
    console.error(`❌ Test runner failed for ${backend} backend:`);
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    return;
  }

  let projectRoot: string;
  try {
    projectRoot = findProjectRoot(__dirname);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Check dependencies
  console.log('Checking dependencies...');
  const deps = await checkDependencies();
  
  if (deps.errors.length > 0) {
    console.error('❌ Dependency check failed:');
    for (const error of deps.errors) {
      console.error(`  ${error}`);
    }
    process.exit(1);
  }
  
  console.log('✅ Dependencies check passed');

  let allSuccessful = true;

  if (options.backend === 'all' as any) {
    // Run tests on all available backends
    const backends: Backend[] = [];
    
    if (deps.vm) backends.push('vm');
    if (deps.cpp) backends.push('cpp');
    if (deps.js) backends.push('js');
    
    if (backends.length === 0) {
      console.error('❌ No backends available to test');
      process.exit(1);
    }
    
    console.log(`Running tests on ${backends.length} backends: ${backends.join(', ')}`);
    
    for (const backend of backends) {
  const success = await runTestsForBackend(backend, options, projectRoot);
      if (!success) {
        allSuccessful = false;
      }
    }
    
  } else {
    // Run tests on specified backend
    const backend = options.backend;
    
    // Check if the backend is available
    if (backend === 'vm' && !deps.vm) {
      console.error('❌ VM backend not available');
      process.exit(1);
    }
    if (backend === 'cpp' && !deps.cpp) {
      console.error('❌ C++ backend not available');
      process.exit(1);
    }
    if (backend === 'js' && !deps.js) {
      console.error('❌ JavaScript backend not available');
      process.exit(1);
    }
    
  const success = await runTestsForBackend(backend, options, projectRoot);
    allSuccessful = success;
  }

  // Exit with appropriate code
  if (!allSuccessful) {
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
