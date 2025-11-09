// Interface for code generators to support multiple target languages

import { Program, ValidationContext, GlobalValidationContext } from './types';

export interface GeneratorOptions {
  namespace?: string;
  includeHeaders?: string[];
  outputHeader?: boolean;
  outputSource?: boolean;
  // When true, emit C/C++ #line directives to map generated code back to the
  // original .do source files for better diagnostics and debugging.
  emitLineDirectives?: boolean;
}

export interface GeneratorResult {
  header?: string;
  source: string;
  sourceMap?: string; // Source Map V3 JSON for JavaScript backend
}

export interface ICodeGenerator {
  generate(
    program: Program,
    filename: string,
    validationContext: ValidationContext,
    globalContext?: GlobalValidationContext,
    sourceFilePath?: string
  ): GeneratorResult;
}
