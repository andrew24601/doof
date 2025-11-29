#!/usr/bin/env node

// CLI for Doof transpiler

import { Transpiler } from './transpiler';
import { formatDoofCode, FormatterOptions } from './formatter';
import { promises as fs, readFileSync } from 'fs';
import path from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { writeVmGlueFiles } from './vm-glue-writer';
import { logger, LogLevel } from './logger';

const exec = promisify(execCb);

// Get version from package.json
function getVersion(): string {
  try {
    const currentDir = __dirname;
    // Walk up to find package.json (handles both src/ and dist/)
    let dir = currentDir;
    for (let i = 0; i < 5; i++) {
      const pkgPath = path.join(dir, 'package.json');
      try {
        const content = readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        return pkg.version || '0.0.0';
      } catch {
        dir = path.dirname(dir);
      }
    }
    return '0.0.0';
  } catch {
    return '0.0.0';
  }
}

interface CliOptions {
  inputs?: string[];
  output?: string;
  target?: 'cpp' | 'js' | 'vm';
  namespace?: string;
  headerOnly?: boolean;
  sourceOnly?: boolean;
  noValidation?: boolean;
  sourceRoots?: string[];
  help?: boolean;
  version?: boolean;
  run?: boolean;
  verbose?: boolean;
  format?: boolean;
  formatInPlace?: boolean;
  formatOptions?: Partial<FormatterOptions>;
  vmGlue?: boolean;
  vmGlueDir?: string;
  noLineDirectives?: boolean; // Invert flag so default emits when we later enable by default
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--verbose':
        options.verbose = true;
        logger.setLevel(LogLevel.DEBUG);
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-v':
      case '--version':
        options.version = true;
        break;
      case '-o':
      case '--output':
        if (i + 1 < args.length) {
          options.output = args[++i];
        }
        break;
      case '-n':
      case '--namespace':
        if (i + 1 < args.length) {
          options.namespace = args[++i];
        }
        break;
      case '-t':
      case '--target':
        if (i + 1 < args.length) {
          const target = args[++i];
          if (target === 'cpp' || target === 'js' || target === 'vm') {
            options.target = target;
          } else {
            throw new Error(`Invalid target: ${target}. Must be 'cpp', 'js', or 'vm'`);
          }
        }
        break;
      case '--header-only':
        options.headerOnly = true;
        break;
      case '--source-only':
        options.sourceOnly = true;
        break;
      case '--no-validation':
        options.noValidation = true;
        break;
      case '--source-root':
        if (i + 1 < args.length) {
          const roots = args[++i].split(',').map(s => s.trim());
          options.sourceRoots = (options.sourceRoots || []).concat(roots);
        }
        break;
      case '-r':
      case '--run':
        options.run = true;
        break;
      case '--format':
        options.format = true;
        break;
      case '--format-in-place':
        options.formatInPlace = true;
        options.format = true;
        break;
      case '--indent-size':
        if (i + 1 < args.length) {
          const size = parseInt(args[++i], 10);
          if (!isNaN(size) && size > 0) {
            options.formatOptions = options.formatOptions || {};
            options.formatOptions.indentSize = size;
          }
        }
        break;
      case '--max-line-length':
        if (i + 1 < args.length) {
          const length = parseInt(args[++i], 10);
          if (!isNaN(length) && length > 0) {
            options.formatOptions = options.formatOptions || {};
            options.formatOptions.maxLineLength = length;
          }
        }
        break;
      case '--vm-glue':
        options.vmGlue = true;
        break;
      case '--vm-glue-dir':
        if (i + 1 < args.length) {
          options.vmGlueDir = args[++i];
        }
        break;
      case '--no-line-directives':
      case '--no-lines':
        options.noLineDirectives = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        options.inputs = options.inputs || [];
        options.inputs.push(arg);
        break;
    }
  }
  return options;
}

export function showHelp(): void {
  console.log(`
doof - TypeScript-like to C++ transpiler

Usage: doof [options] <input-file>...

Options:
  -h, --help              Show this help message
  -v, --version           Show version number
  -o, --output <dir>      Output directory (default: same as input)
  -t, --target <lang>     Target language: 'cpp' (default), 'js', or 'vm'
  -n, --namespace <ns>    C++ namespace for generated code
  --header-only           Generate only header file
  --source-only           Generate only source file
  --no-validation         Skip semantic validation
  --source-root <dir>     Source root directory for namespace mapping (can be used multiple times)
  --verbose               Print verbose error/debug output
  --vm-glue               Generate VM glue files for extern classes
  --vm-glue-dir <dir>     Output directory for VM glue files (default: output directory or input folder)
  --no-line-directives    Disable emission of C/C++ #line directives in generated output (for editor/debug mapping)
  -r, --run               Transpile, compile, and run the program (easy mode)

Formatting Options:
  --format                Format the source code and output to stdout
  --format-in-place       Format the source code in place (modifies original files)
  --indent-size <n>       Number of spaces for indentation (default: 4)
  --max-line-length <n>   Maximum line length before wrapping (default: 100)

Examples:
  doof input.do
  doof file1.do file2.do file3.do
  doof -o ./build input.do
  doof --namespace myapp input.do
  doof --header-only input.do
  doof --source-root src --source-root test input.do
  doof --run input.do
  doof --vm-glue src/runtime.do -o ./glue
  doof --format input.do
  doof --format-in-place *.do
  doof --format --indent-size 2 --max-line-length 80 input.do
`);
}

export function showVersion(): void {
  console.log(`doof ${getVersion()}`);
}

// Helper function to write multi-file output
async function writeMultiFileOutput(
  result: any,
  outputDir: string,
  transpilerOptions: any,
  inputFiles: string[]
): Promise<void> {
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (err) {
    console.error(`Error creating output directory: ${err}`);
    process.exit(1);
  }

  for (const [filePath, output] of result.files) {
    const basename = path.basename(filePath, '.do');
    const isJavaScript = transpilerOptions.target === 'js';
    const isVM = transpilerOptions.target === 'vm';
    
    if (output.header && transpilerOptions.outputHeader && !isJavaScript && !isVM) {
      const headerFile = path.join(outputDir, `${basename}.h`);
      await fs.writeFile(headerFile, output.header);
      console.error(`Generated ${headerFile}`);
    }
    
    if (output.source && transpilerOptions.outputSource) {
      let extension: string;
      if (isJavaScript) {
        extension = '.js';
      } else if (isVM) {
        extension = '.vmbc';
      } else {
        extension = '.cpp';
      }
      const sourceFile = path.join(outputDir, `${basename}${extension}`);
      await fs.writeFile(sourceFile, output.source);
      console.error(`Generated ${sourceFile}`);
      
      // Write source map for JavaScript target if available
      if (isJavaScript && output.sourceMap) {
        const sourceMapFile = path.join(outputDir, `${basename}.js.map`);
        await fs.writeFile(sourceMapFile, output.sourceMap);
        console.error(`Generated ${sourceMapFile}`);
      }
    }
  }

  const isVmTarget = transpilerOptions.target === 'vm';
  if (isVmTarget && transpilerOptions.outputSource) {
    const bundleSource: string | undefined = result.bundleSource;
    if (!bundleSource) {
      console.error('Error: VM target requested but no bundle output generated.');
      process.exit(1);
    }

    const entryFile = result.entryFile ?? inputFiles[0];
    const entryBasename = entryFile
      ? path.basename(entryFile, path.extname(entryFile))
      : 'bundle';
    const vmOutputPath = path.join(outputDir, `${entryBasename}.vmbc`);
    await fs.writeFile(vmOutputPath, bundleSource);
    console.error(`Generated ${vmOutputPath}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    return;
  }

  if (options.version) {
    showVersion();
    return;
  }

  if (!options.inputs || options.inputs.length === 0) {
    console.error('Error: No input files specified');
    console.error('Use --help for usage information');
    process.exit(1);
  }

  if (options.vmGlue && options.format) {
    console.error('Error: --vm-glue cannot be combined with formatting options');
    process.exit(1);
  }

  if (options.vmGlue) {
    await handleVmGlueGeneration(options);
    return;
  }

  // Handle formatting mode
  if (options.format) {
    await handleFormatting(options);
    return;
  }

  const inputFiles = options.inputs;

  // Check if input files exist
  for (const inputFile of inputFiles) {
    try {
      await fs.access(inputFile);
    } catch {
      console.error(`Error: Input file '${inputFile}' does not exist`);
      process.exit(1);
    }
  }

  // Determine output directory
  const outputDir = options.output || path.dirname(inputFiles[0]);

  // Set up transpiler options
  const transpilerOptions = {
    target: options.target || 'cpp',
    namespace: options.namespace,
    validate: !options.noValidation,
    outputHeader: !options.sourceOnly,
    outputSource: !options.headerOnly,
    sourceRoots: options.sourceRoots,
    verbose: options.verbose || false,
    emitLineDirectives: !options.noLineDirectives
  };

  try {
    console.error(`Transpiling ${inputFiles.length} file(s)...`);
    const transpiler = new Transpiler(transpilerOptions);
    const result = await transpiler.transpileProject(inputFiles);

    if (result.errors.length > 0) {
      console.error('Compilation errors:');
      for (const error of result.errors) {
        if (typeof error === 'string') {
          console.error(`  ${error}`);
        } else {
          const file = error.filename ? `${error.filename}:` : '';
          const loc = (error.line !== undefined && error.column !== undefined) ? `${error.line}:${error.column}:` : '';
          console.error(`  ${file}${loc} ${error.message}`);
        }
      }
      process.exit(1);
    }

    if (result.warnings.length > 0) {
      console.warn('Warnings:');
      for (const warning of result.warnings) {
        console.warn(`  ${warning}`);
      }
    }

  await writeMultiFileOutput(result, outputDir, transpilerOptions, inputFiles);

    if (options.run && inputFiles.length === 1 && transpilerOptions.target === 'cpp' && transpilerOptions.outputSource) {
      const inputFile = inputFiles[0];
      const basename = path.basename(inputFile, path.extname(inputFile));
      const cppFile = path.join(outputDir, `${basename}.cpp`);
      await runCppProgram(cppFile, outputDir, basename);
    }

    console.error('Transpilation completed successfully');

  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

async function handleVmGlueGeneration(options: CliOptions): Promise<void> {
  const inputFiles = options.inputs!;

  for (const inputFile of inputFiles) {
    try {
      await fs.access(inputFile);
    } catch {
      console.error(`Error: Input file '${inputFile}' does not exist`);
      process.exit(1);
    }
  }

  const outputBase = options.vmGlueDir ?? options.output ?? path.dirname(path.resolve(inputFiles[0]));
  const outputDir = path.resolve(outputBase);

  const transpiler = new Transpiler({
    validate: !options.noValidation,
    sourceRoots: options.sourceRoots,
    verbose: options.verbose || false,
    outputHeader: false,
    outputSource: false
  });

  const projectResult = await transpiler.transpileProject(inputFiles);

  if (projectResult.errors.length > 0) {
    console.error('Compilation errors:');
    for (const error of projectResult.errors) {
      if (typeof error === 'string') {
        console.error(`  ${error}`);
      } else {
        const file = error.filename ? `${error.filename}:` : '';
        const loc = error.line !== undefined && error.column !== undefined ? `${error.line}:${error.column}:` : '';
        console.error(`  ${file}${loc} ${error.message}`);
      }
    }
    process.exit(1);
  }

  if (projectResult.warnings.length > 0) {
    console.warn('Warnings:');
    for (const warning of projectResult.warnings) {
      console.warn(`  ${warning}`);
    }
  }

  const globalContext = projectResult.globalContext;
  if (!globalContext || globalContext.files.size === 0) {
    console.error('Error: Unable to build program context for VM glue generation');
    process.exit(1);
  }

  try {
    const glueResult = await writeVmGlueFiles(globalContext, { outputDir });
    if (glueResult.externClassCount === 0) {
      console.error('No extern classes found; no VM glue generated.');
      return;
    }

    for (const filePath of glueResult.generatedFiles) {
      console.error(`Generated ${filePath}`);
    }

    console.error('VM glue generation completed successfully');
  } catch (error) {
    console.error(`Error generating VM glue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

// Handle formatting mode
async function handleFormatting(options: CliOptions): Promise<void> {
  const inputFiles = options.inputs!;
  
  // Check if input files exist and are .do files
  for (const inputFile of inputFiles) {
    try {
      await fs.access(inputFile);
    } catch {
      console.error(`Error: Input file '${inputFile}' does not exist`);
      process.exit(1);
    }
    
    if (!inputFile.endsWith('.do')) {
  console.error(`Error: File '${inputFile}' is not a Doof source file (.do)`);
      process.exit(1);
    }
  }

  const formatterOptions = options.formatOptions || {};
  
  try {
    for (const inputFile of inputFiles) {
      console.error(`Formatting ${inputFile}...`);
      
      // Read the source file
      const sourceCode = await fs.readFile(inputFile, 'utf-8');
      
      // Format the code
  const formattedCode = formatDoofCode(sourceCode, formatterOptions);
      
      if (options.formatInPlace) {
        // Write back to the original file
        await fs.writeFile(inputFile, formattedCode);
        console.error(`Formatted ${inputFile} in place`);
      } else {
        // Output to stdout
        process.stdout.write(formattedCode);
      }
    }
    
    if (!options.formatInPlace) {
      console.error('Formatting completed successfully');
    }
    
  } catch (error) {
    console.error(`Formatting error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

// Helper to compile and run a C++ program
async function runCppProgram(sourceFile: string, outputDir: string, basename: string): Promise<void> {
  const binaryPath = path.join(outputDir, basename);
  const compileCmd = `g++ -std=c++17 -I. doof_runtime.cpp "${sourceFile}" -o "${binaryPath}"`;
  try {
    console.log(`Compiling with: ${compileCmd}`);
    await exec(compileCmd);
    console.log(`Running ${binaryPath}...`);
    const { stdout, stderr } = await exec(`"${binaryPath}"`);
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  } catch (err: any) {
    // Show any output that was produced before the error
    if (err.stdout) {
      process.stdout.write(err.stdout);
    }
    if (err.stderr) {
      process.stderr.write(err.stderr);
    }
    console.error('Compilation or execution failed:', err.message);
    process.exit(1);
  }
}


  main().catch(error => {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
