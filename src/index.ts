// Main exports for doof transpiler

export { Lexer, TokenType } from './parser/lexer';
export { Parser } from './parser/parser';
export { Validator } from './validation/validator';
export { CppGenerator } from './codegen/cppgen';
export { JsGenerator } from './codegen/jsgen';
export type { ICodeGenerator, GeneratorResult } from './codegen-interface';
export type { GeneratorOptions } from './codegen-interface';
export { Transpiler, transpile, transpileFile, transpileProjectWithDependencies } from './transpiler';
export type { TranspilerOptions, TranspilerResult } from './transpiler';
export * from './types';
