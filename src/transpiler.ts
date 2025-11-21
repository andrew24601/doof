// Main transpiler interface

import { Lexer } from './parser/lexer';
import { Parser } from './parser/parser';
import { Validator } from './validation/validator';
import { CppGenerator } from './codegen/cppgen';
import { JsGenerator } from './codegen/jsgen';
import { VMGenerator } from './codegen/vmgen';
import { ICodeGenerator, GeneratorOptions } from './codegen-interface';
import { Program, ValidationContext, GlobalValidationContext } from './types';
import { NamespaceMapper } from './namespace-mapper';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveDependencyGraph } from './project/dependency-resolver';
import { collectExternClassMetadata, ExternClassMetadata } from './project/extern-metadata';
import { desugarInterfaces } from './validation/desugar';
import { monomorphizePrograms } from './project/monomorphizer';

export interface TranspilerOptions {
  target?: 'cpp' | 'js' | 'vm';
  namespace?: string;
  includeHeaders?: string[];
  outputHeader?: boolean;
  outputSource?: boolean;
  validate?: boolean;
  sourceRoots?: string[];
  verbose?: boolean;
  // Control #line directive emission in targets that support it (C++ only for now)
  emitLineDirectives?: boolean;
}

export interface TranspilerResult {
  header?: string;
  source?: string;
  sourceMap?: string;
  errors: TranspilerError[];
  warnings: string[];
  ast?: Program;
  validationContext?: ValidationContext;
  externMetadata?: ExternClassMetadata[];
}

export interface MultiFileTranspilerResult {
  files: Map<string, { header?: string; source?: string; sourceMap?: string; }>;
  errors: TranspilerError[];
  warnings: string[];
  globalContext?: GlobalValidationContext;
  bundleSource?: string;
  entryFile?: string;
  externMetadata?: ExternClassMetadata[];
}

export interface TranspilerError {
  filename?: string;
  line?: number;
  column?: number;
  message: string;
  severity?: 'error' | 'warning' | 'info';
}

export class Transpiler {
  private options: TranspilerOptions;

  constructor(options: TranspilerOptions = {}) {
    this.options = {
      target: 'cpp',
      validate: true,
      outputHeader: true,
      outputSource: true,
      verbose: false,
      emitLineDirectives: true,
      ...options
    };
  }

  private createGenerator(target: 'cpp' | 'js' | 'vm', generatorOptions: GeneratorOptions): ICodeGenerator {
    switch (target) {
      case 'js':
        return new JsGenerator(generatorOptions);
      case 'vm':
        return new VMGenerator();
      case 'cpp':
      default:
        return new CppGenerator(generatorOptions);
    }
  }

  transpile(source: string, filename: string = 'input'): TranspilerResult {
    const result: TranspilerResult = {
      errors: [],
      warnings: []
    };

    try {
      // Lexical analysis
      const lexer = new Lexer(source, filename);
      const tokens = lexer.tokenize();

      // Syntax analysis
      const parser = new Parser(tokens, filename, { sourceRoots: this.options.sourceRoots });
      const ast = parser.parse();
      result.ast = ast;

      // Check for parse errors first
      if (ast.errors && ast.errors.length > 0) {
        // Convert parse errors to the same format as validation errors
        for (const error of ast.errors) {
          const file = error.location ? (error.location.filename || filename) : filename;
          const line = error.location && error.location.start ? error.location.start.line : undefined;
          const column = error.location && error.location.start ? error.location.start.column : undefined;
          result.errors.push({ filename: file, line, column, message: error.message, severity: 'error' });
        }
        // Don't proceed with validation or code generation if there are parse errors
        return result;
      }

      // Semantic analysis (validation)
      const desugarResult = desugarInterfaces([ast], { closedWorld: true });
      result.warnings.push(...desugarResult.warnings);
      for (const err of desugarResult.errors) {
        const loc = err.location;
        result.errors.push({
          filename: loc?.filename || filename,
          line: loc?.start?.line,
          column: loc?.start?.column,
          message: err.message,
          severity: 'error'
        });
      }

      if (result.errors.length > 0) {
        return result;
      }

      if (this.options.validate) {
        const validator = new Validator({ verbose: this.options.verbose });
        const validationContext = validator.validate(ast);
        result.validationContext = validationContext;

        // Collect validation errors
        for (const error of validationContext.errors) {
          const file = error.location ? (error.location.filename || filename) : filename;
          const line = error.location && error.location.start ? error.location.start.line : undefined;
          const column = error.location && error.location.start ? error.location.start.column : undefined;
          
          if (error.severity === 'warning') {
             const locStr = line !== undefined && column !== undefined ? `${line}:${column}: ` : '';
             result.warnings.push(`${file}:${locStr}${error.message}`);
          } else {
             result.errors.push({ filename: file, line, column, message: error.message, severity: 'error' });
          }
        }

        // If there are validation errors, don't generate code
        if (result.errors.length > 0) {
          return result;
        }

        const monomorphization = monomorphizePrograms([{ program: ast, context: validationContext }]);
        for (const diag of monomorphization.diagnostics) {
          const loc = diag.location;
          result.errors.push({
            filename: loc?.filename || filename,
            line: loc?.start?.line,
            column: loc?.start?.column,
            message: diag.message,
            severity: 'error'
          });
        }

        if (result.errors.length > 0) {
          return result;
        }
      }

      // Code generation
      // Always provide includeHeaders, defaulting to standard set if not specified
      const generatorOptions: GeneratorOptions = {
        namespace: this.options.namespace,
        includeHeaders: this.options.includeHeaders && this.options.includeHeaders.length > 0
          ? this.options.includeHeaders
          : ['<iostream>', '<fstream>', '<string>', '<vector>', '<unordered_map>', '<unordered_set>', '<memory>', '<cmath>'],
        outputHeader: this.options.outputHeader,
        outputSource: this.options.outputSource,
        emitLineDirectives: this.options.emitLineDirectives === true
      };

      const target = this.options.target || 'cpp';
      const generator = this.createGenerator(target, generatorOptions);
      if (!result.validationContext) {
        throw new Error('Validation context is required for code generation. Ensure validation runs before generation.');
      }
      const generated = generator.generate(ast, this.getBasename(filename), result.validationContext, undefined, filename);

      if (this.options.outputHeader && generated.header) {
        result.header = generated.header;
      }
      if (this.options.outputSource) {
        result.source = generated.source;
      }
      if (generated.sourceMap) {
        result.sourceMap = generated.sourceMap;
      }

      result.externMetadata = collectExternClassMetadata(ast, result.validationContext);

    } catch (error) {
      if (error instanceof Error) {
        if (this.options.verbose) {
          console.error('Transpilation error:', error.stack || error.message);
        }
        // Enhanced error formatting with location
        if ('location' in error && error.location) {
          const loc = error.location as any;
          const file = loc.filename || filename;
          const line = loc.start ? loc.start.line : undefined;
          const column = loc.start ? loc.start.column : undefined;
          result.errors.push({ filename: file, line, column, message: error.message, severity: 'error' });
        } else {
          result.errors.push({ filename, message: error.message, severity: 'error' });
        }
      } else {
        result.errors.push({ filename, message: 'Unknown error occurred', severity: 'error' });
      }
    }

    return result;
  }

  private formatLocation(location: any, defaultFilename: string): string {
    const file = location.filename || defaultFilename;
    if (location.start) {
      return `${file}:${location.start.line}:${location.start.column}`;
    }
    return file;
  }

  transpileFile(filename: string): Promise<TranspilerResult> {
    return import('fs').then(fs => {
      return new Promise((resolve, reject) => {
        fs.readFile(filename, 'utf8', (err, data) => {
          if (err) {
            resolve({
              errors: [{ filename, message: `Failed to read file ${filename}: ${err.message}`, severity: 'error' }],
              warnings: []
            });
          } else {
            resolve(this.transpile(data, filename));
          }
        });
      });
    });
  }

  private getBasename(filename: string): string {
    const parts = filename.split(/[\/\\]/);
    const basename = parts[parts.length - 1];
    const dotIndex = basename.lastIndexOf('.');
    return dotIndex === -1 ? basename : basename.substring(0, dotIndex);
  }

  /**
   * Transpile multiple files as a project
   */
  async transpileProject(filePaths: string[]): Promise<MultiFileTranspilerResult> {
    const result: MultiFileTranspilerResult = {
      files: new Map(),
      errors: [],
      warnings: []
    };

    try {
      // Step 1: Parse all files
      const asts: Map<string, Program> = new Map();
      const namespaceMapper = new NamespaceMapper({ sourceRoots: this.options.sourceRoots });

      for (const filePath of filePaths) {
        try {
          const source = await fs.readFile(filePath, 'utf-8');
          const lexer = new Lexer(source, filePath);
          const tokens = lexer.tokenize();
          const parser = new Parser(tokens, filePath, { sourceRoots: this.options.sourceRoots });
          const ast = parser.parse();

          // Check for parse errors
          if (ast.errors && ast.errors.length > 0) {
            for (const error of ast.errors) {
              const file = error.location ? (error.location.filename || filePath) : filePath;
              const line = error.location && error.location.start ? error.location.start.line : undefined;
              const column = error.location && error.location.start ? error.location.start.column : undefined;
              result.errors.push({ filename: file, line, column, message: error.message, severity: 'error' });
            }
            continue; // Skip this file but continue processing others
          }
          
          // Set filename and module name
          ast.filename = filePath;
          const generatedNamespace = namespaceMapper.mapFileToNamespace(filePath);
          ast.moduleName = generatedNamespace;
          
          asts.set(filePath, ast);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push({ filename: filePath, message: `Failed to parse ${filePath}: ${errorMessage}`, severity: 'error' });
        }
      }

      // If parsing failed for any file, return early
      if (result.errors.length > 0) {
        return result;
      }

      // Step 2: Build global validation context 
      const globalContext: GlobalValidationContext = {
        files: asts,
        moduleMap: new Map(),
        exportedSymbols: new Map(),
        errors: []
      };

      // Build module map
      for (const [filePath, ast] of asts) {
        globalContext.moduleMap.set(filePath, ast.moduleName!);
      }

      // Step 3: Perform global validation
      const desugarResult = desugarInterfaces(Array.from(asts.values()), { closedWorld: true });
      result.warnings.push(...desugarResult.warnings);
      for (const err of desugarResult.errors) {
        const loc = err.location;
        result.errors.push({
          filename: loc?.filename,
          line: loc?.start?.line,
          column: loc?.start?.column,
          message: err.message,
          severity: 'error'
        });
      }

      if (result.errors.length > 0) {
        return result;
      }

    const astEntries = Array.from(asts.entries());

    let validationResults: ValidationContext[] = [];
      if (this.options.validate) {
        const validator = new Validator({ verbose: this.options.verbose });
        validationResults = validator.validateWithGlobalContext(Array.from(asts.values()), globalContext);
        
        // Collect all validation errors
        for (const [index, context] of validationResults.entries()) {
          const filePath = filePaths[index];
          for (const error of context.errors) {
            const file = error.location ? (error.location.filename || filePath) : filePath;
            const line = error.location && error.location.start ? error.location.start.line : undefined;
            const column = error.location && error.location.start ? error.location.start.column : undefined;
            
            if (error.severity === 'warning') {
               const locStr = line !== undefined && column !== undefined ? `${line}:${column}: ` : '';
               result.warnings.push(`${file}:${locStr}${error.message}`);
            } else {
               result.errors.push({ filename: file, line, column, message: error.message, severity: 'error' });
            }
          }
        }

        // If there are validation errors, don't generate code
        if (result.errors.length > 0) {
          result.globalContext = globalContext;
          return result;
        }
      }

      if (validationResults.length > 0) {
        const monoInputs = validationResults.map((context, index) => ({
          program: astEntries[index][1],
          context
        }));
        const monomorphization = monomorphizePrograms(monoInputs);
        for (const diag of monomorphization.diagnostics) {
          const loc = diag.location;
          result.errors.push({
            filename: loc?.filename,
            line: loc?.start?.line,
            column: loc?.start?.column,
            message: diag.message,
            severity: 'error'
          });
        }

        if (result.errors.length > 0) {
          result.globalContext = globalContext;
          return result;
        }
      }

      if (validationResults.length > 0) {
        const validationContextMap = new Map<string, ValidationContext>();
        for (let i = 0; i < filePaths.length && i < validationResults.length; i++) {
          const contextResult = validationResults[i];
          if (contextResult) {
            validationContextMap.set(filePaths[i], contextResult);
          }
        }
        if (validationContextMap.size > 0) {
          globalContext.validationContexts = validationContextMap;
        }
      }

      // Set the global context in the result
      result.globalContext = globalContext;
      
      // Add exports alias for backward compatibility
      if (result.globalContext) {
        (result.globalContext as any).exports = globalContext.exportedSymbols;
      }

      const target = this.options.target || 'cpp';

      if (target === 'vm') {
        const vmResult = this.generateVmProject(filePaths, asts, validationResults, globalContext);
        result.errors.push(...vmResult.errors);
        result.warnings.push(...vmResult.warnings);
        if (vmResult.source) {
          result.bundleSource = vmResult.source;
          result.entryFile = filePaths[0];
        }
        return result;
      }

      // Step 4: Generate code for each file
      for (const [index, [filePath, ast]] of astEntries.entries()) {
        try {
          const namespace = ast.moduleName || namespaceMapper.mapFileToNamespace(filePath);
          const generatorOptions: GeneratorOptions = {
            namespace,
            outputHeader: this.options.outputHeader,
            outputSource: this.options.outputSource,
            emitLineDirectives: this.options.emitLineDirectives === true
          };

          if (target === 'cpp') {
            generatorOptions.includeHeaders = this.options.includeHeaders && this.options.includeHeaders.length > 0
              ? this.options.includeHeaders
              : ['<iostream>', '<string>', '<vector>', '<unordered_map>', '<unordered_set>', '<memory>', '<cmath>'];
          }

          const generator = this.createGenerator(target, generatorOptions);
          const validationCtx = this.options.validate ? validationResults[index] : undefined;
          if (!validationCtx) {
            throw new Error(`Validation context is required for code generation of ${filePath}.`);
          }
          const code = generator.generate(ast, this.getBasename(filePath), validationCtx, globalContext, filePath);
          const basename = this.getBasename(filePath);

          result.files.set(filePath, {
            header: code.header,
            source: code.source,
            sourceMap: code.sourceMap
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push({ filename: filePath, message: `Failed to generate code for ${filePath}: ${errorMessage}`, severity: 'error' });
        }
      }

      const aggregatedMetadata = new Map<string, ExternClassMetadata>();
      for (const [index, [, ast]] of astEntries.entries()) {
        const validationCtx = this.options.validate ? validationResults[index] : undefined;
        for (const meta of collectExternClassMetadata(ast, validationCtx)) {
          aggregatedMetadata.set(meta.name, meta);
        }
      }
      if (aggregatedMetadata.size > 0) {
        result.externMetadata = Array.from(aggregatedMetadata.values()).sort((a, b) => a.name.localeCompare(b.name));
      }

    } catch (error) {
      const isErr = error instanceof Error;
      const errorMessage = isErr ? error.message : String(error);
      if (this.options.verbose && isErr) {
        // Emit stack for debugging hard failures that bypass validation
        console.error('Transpilation error stack:', (error as Error).stack);
      }
      result.errors.push({ message: `Project transpilation failed: ${errorMessage}`, severity: 'error' });
    }

    return result;
  }

  private generateVmProject(
    filePaths: string[],
    asts: Map<string, Program>,
    validationResults: ValidationContext[],
    globalContext: GlobalValidationContext
  ): TranspilerResult {
    const entryFile = filePaths[0];
    const entryProgram = asts.get(entryFile);

    if (!entryProgram) {
      return {
        errors: [{ filename: entryFile, message: `Entry file '${entryFile}' not found during VM bundling`, severity: 'error' }],
        warnings: []
      };
    }

    const entryIndex = filePaths.indexOf(entryFile);
    const entryValidationContext = this.options.validate && entryIndex >= 0
      ? validationResults[entryIndex]
      : undefined;

    const vmGenerator = new VMGenerator();
    const generatorResult = vmGenerator.generate(
      entryProgram,
      this.getBasename(entryFile),
      entryValidationContext,
      globalContext,
      entryFile
    );

    return {
      source: generatorResult.source,
      errors: [],
      warnings: []
    };
  }
}

// Convenience function for one-off transpilation
export function transpile(source: string, options?: TranspilerOptions): TranspilerResult {
  const transpiler = new Transpiler(options);
  return transpiler.transpile(source);
}

export function transpileFile(filename: string, options?: TranspilerOptions): Promise<TranspilerResult> {
  const transpiler = new Transpiler(options);
  return transpiler.transpileFile(filename);
}

export async function transpileVmBundle(entryFile: string, options?: TranspilerOptions): Promise<TranspilerResult> {
  const graph = await resolveDependencyGraph(entryFile, { sourceRoots: options?.sourceRoots });

  const dependencyErrors: TranspilerError[] = graph.errors.map(err => ({
    filename: err.filename,
    line: err.line,
    column: err.column,
    message: err.message,
    severity: 'error'
  }));

  if (dependencyErrors.length > 0) {
    return {
      errors: dependencyErrors,
      warnings: []
    };
  }

  const transpilerOptions: TranspilerOptions = {
    ...options,
    target: 'vm'
  };

  const transpiler = new Transpiler(transpilerOptions);
  const projectResult = await transpiler.transpileProject(graph.files);

  const resultErrors = [...projectResult.errors];
  const resultWarnings = [...projectResult.warnings];

  if (projectResult.bundleSource) {
    return {
      source: projectResult.bundleSource,
      errors: resultErrors,
      warnings: resultWarnings
    };
  }

  if (resultErrors.length === 0) {
    resultErrors.push({
      filename: graph.entry,
      message: 'VM bundling failed: no output generated',
      severity: 'error'
    });
  }

  return {
    errors: resultErrors,
    warnings: resultWarnings
  };
}

export async function transpileProjectWithDependencies(
  entryFile: string,
  options?: TranspilerOptions
): Promise<MultiFileTranspilerResult> {
  const graph = await resolveDependencyGraph(entryFile, { sourceRoots: options?.sourceRoots });

  const dependencyErrors: TranspilerError[] = graph.errors.map(err => ({
    filename: err.filename,
    line: err.line,
    column: err.column,
    message: err.message,
    severity: 'error'
  }));

  if (dependencyErrors.length > 0) {
    return {
      files: new Map(),
      errors: dependencyErrors,
      warnings: [],
      entryFile: graph.entry
    };
  }

  const transpiler = new Transpiler(options);
  const projectResult = await transpiler.transpileProject(graph.files);

  if (!projectResult.entryFile) {
    projectResult.entryFile = graph.entry;
  }

  return projectResult;
}
