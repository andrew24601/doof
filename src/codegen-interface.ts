// Interface for code generators to support multiple target languages

import { Program, ValidationContext, GlobalValidationContext } from './types';

export interface GeneratorOptions {
  namespace?: string;
  includeHeaders?: string[];
  outputHeader?: boolean;
  outputSource?: boolean;
}

export interface GeneratorResult {
  header?: string;
  source: string;
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
