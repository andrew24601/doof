import { Lexer } from '../../../src/parser/lexer';
import { Parser } from '../../../src/parser/parser';
import { NamespaceMapper } from '../../../src/namespace-mapper';
import { Validator } from '../../../src/validation/validator';
import {
  Program,
  ValidationError,
  GlobalValidationContext,
  ValidationContext
} from '../../../src/types';

export interface FileEntry {
  path: string;
  content: string;
}

export interface MultiFileValidationOptions {
  sourceRoots?: string[];
}

export interface MultiFileValidationResult {
  programs: Map<string, Program>;
  errorsByFile: Map<string, ValidationError[]>;
  validationContexts: Map<string, ValidationContext>;
  globalContext: GlobalValidationContext;
}

export function validateFiles(
  fileEntries: FileEntry[],
  options: MultiFileValidationOptions = {}
): MultiFileValidationResult {
  const namespaceMapper = new NamespaceMapper({ sourceRoots: options.sourceRoots });
  const programs = new Map<string, Program>();
  const errorsByFile = new Map<string, ValidationError[]>();
  const validationContexts = new Map<string, ValidationContext>();

  for (const entry of fileEntries) {
    const fileErrors: ValidationError[] = [];

    try {
      const lexer = new Lexer(entry.content, entry.path);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens, entry.path, { sourceRoots: options.sourceRoots });
      const program = parser.parse();

      if (!program.moduleName) {
        program.moduleName = namespaceMapper.mapFileToNamespace(entry.path);
      }

      if (Array.isArray(program.errors) && program.errors.length > 0) {
        for (const parseError of program.errors) {
          fileErrors.push({
            message: parseError.message,
            location: parseError.location ?? {
              start: { line: 1, column: 1 },
              end: { line: 1, column: 1 },
              filename: entry.path
            }
          });
        }
      }

      programs.set(entry.path, program);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fileErrors.push({
        message: `Lexical or parse error: ${message}`,
        location: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 1 },
          filename: entry.path
        }
      });
    }

    if (fileErrors.length > 0) {
      errorsByFile.set(entry.path, fileErrors);
    }
  }

  const globalContext: GlobalValidationContext = {
    files: programs,
    moduleMap: new Map(
      Array.from(programs.entries()).map(([filePath, program]) => [
        filePath,
        program.moduleName ?? namespaceMapper.mapFileToNamespace(filePath)
      ])
    ),
    exportedSymbols: new Map(),
    errors: []
  };

  const orderedPrograms: Program[] = [];
  const orderedFiles: string[] = [];
  for (const entry of fileEntries) {
    const program = programs.get(entry.path);
    if (program) {
      orderedPrograms.push(program);
      orderedFiles.push(entry.path);
    }
  }

  if (orderedPrograms.length > 0) {
    const validator = new Validator({ allowTopLevelStatements: false, verbose: false });
    const contexts = validator.validateWithGlobalContext(orderedPrograms, globalContext);

    contexts.forEach((context, index) => {
      const filePath = orderedFiles[index];
      if (!filePath) {
        return;
      }

      if (context.errors.length > 0) {
        const existing = errorsByFile.get(filePath) ?? [];
        existing.push(...context.errors);
        errorsByFile.set(filePath, existing);
      }

      validationContexts.set(filePath, context);
    });

    if (validationContexts.size > 0) {
      globalContext.validationContexts = validationContexts;
    }
  }

  return {
    programs,
    errorsByFile,
    validationContexts,
    globalContext
  };
}
