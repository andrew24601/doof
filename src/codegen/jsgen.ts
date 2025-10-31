// JavaScript code generator for doof

import {
  Program, Statement, Expression, ClassDeclaration,
  EnumDeclaration, FunctionDeclaration, VariableDeclaration, Parameter,
  FieldDeclaration, MethodDeclaration, EnumMember,
  IfStatement, WhileStatement, ForStatement, ForOfStatement, SwitchStatement,
  SwitchCase, ReturnStatement,
  BlockStatement, ExpressionStatement, ImportDeclaration, ExportDeclaration,
  Literal, Identifier, BinaryExpression, UnaryExpression, ConditionalExpression, CallExpression,
  MemberExpression, IndexExpression, ArrayExpression, ObjectExpression, PositionalObjectExpression, SetExpression, ObjectProperty,
  LambdaExpression, RangeExpression, EnumShorthandMemberExpression, TrailingLambdaExpression, TypeGuardExpression, InterpolatedString, PrimitiveTypeNode,
  ValidationContext, ImportInfo, GlobalValidationContext
} from '../types';
import { ICodeGenerator, GeneratorOptions, GeneratorResult } from '../codegen-interface';
import { generateExpression, JsGeneratorInterface } from './js/js-expression-codegen';
import { generateStatement, JsStatementGeneratorInterface } from './js/js-statement-codegen';
import * as path from 'path';

export class JsGenerator implements ICodeGenerator, JsGeneratorInterface, JsStatementGeneratorInterface {
  private options: GeneratorOptions;
  indentLevel: number = 0;
  currentClass?: ClassDeclaration;
  currentMethod?: MethodDeclaration;
  validationContext?: ValidationContext;
  globalContext?: GlobalValidationContext;
  private currentFilePath?: string;

  constructor(options: GeneratorOptions = {}) {
    this.options = {
      outputHeader: false,
      outputSource: true,
      ...options
    };
  }

  // Helper function to encode field names for JavaScript
  encodeJsFieldName(fieldName: string): string {
    // In JavaScript, we can use any string as a property name with bracket notation
    // but for dot notation we need valid identifiers
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(fieldName)) {
      return fieldName; // Valid identifier, use as-is
    } else {
      // Invalid identifier, needs bracket notation
      return fieldName.replace(/-/g, '_'); // Convert hyphens to underscores for property access
    }
  }

  // Helper function to get the encoded field name for a field declaration
  getJsFieldName(field: { name: { name: string } }): string {
    return this.encodeJsFieldName(field.name.name);
  }

  generate(
    program: Program,
    filename: string = 'output',
    validationContext?: ValidationContext,
    globalContext?: GlobalValidationContext,
    sourceFilePath?: string
  ): GeneratorResult {
    this.reset();
    if (!validationContext) {
      throw new Error('Validation context is required for JavaScript generation.');
    }
    this.validationContext = validationContext;
    this.globalContext = globalContext;
    this.currentFilePath = sourceFilePath;

    const source = this.generateSource(program, filename);
    this.currentFilePath = undefined;
    return { source };
  }

  private reset(): void {
    this.indentLevel = 0;
    this.currentClass = undefined;
    this.currentMethod = undefined;
    this.validationContext = undefined;
    this.globalContext = undefined;
    this.currentFilePath = undefined;
  }

  private generateSource(program: Program, filename: string): string {
    let output = `// Generated JavaScript from doof source: ${filename}\n\n`;

    // Generate imports
    if (this.validationContext?.imports && this.validationContext.imports.size > 0) {
      const importsByModule = new Map<string, Map<string, string>>();

      for (const importInfo of this.validationContext.imports.values()) {
        const modulePath = this.getModuleImportPath(importInfo);
        let specifiers = importsByModule.get(modulePath);
        if (!specifiers) {
          specifiers = new Map<string, string>();
          importsByModule.set(modulePath, specifiers);
        }
        if (!specifiers.has(importInfo.localName)) {
          specifiers.set(importInfo.localName, importInfo.importedName);
        }
      }

      const sortedModules = Array.from(importsByModule.entries()).sort(([a], [b]) => a.localeCompare(b));
      for (const [modulePath, specifiers] of sortedModules) {
        const sortedSpecifiers = Array.from(specifiers.entries()).sort(([a], [b]) => a.localeCompare(b));
        const specifierList = sortedSpecifiers
          .map(([local, imported]) => imported === local ? imported : `${imported} as ${local}`)
          .join(', ');
        output += `import { ${specifierList} } from '${modulePath}';\n`;
      }
      output += '\n';
    }

    // Generate extern class imports using validator metadata (per-module usage).
    const externDeps = this.validationContext?.codeGenHints?.externDependencies;
    if (externDeps && externDeps.size > 0) {
      for (const externName of [...externDeps].sort()) {
        output += `import { ${externName} } from '${externName}';\n`;
      }
      output += '\n';
    }

    // Check if StringBuilder is used and add its definition
    if (this.usesStringBuilder(program)) {
      output += this.generateStringBuilderClass();
      output += '\n';
    }

    // Inject JSON helpers for consistent Map/Set/class serialization across backends
    output += this.generateJsonHelpers();
    output += '\n';

    // Generate statements
    for (const stmt of program.body) {
      const generated = this.generateStatement(stmt);
      if (generated) {
        output += generated;
        output += '\n';
      }
    }

    // Auto-call main function if it exists
    const hasMainFunction = program.body.some(stmt => 
      stmt.kind === 'function' && (stmt as FunctionDeclaration).name.name === 'main'
    );
    
    if (hasMainFunction) {
      output += '\n// Auto-call main function\nmain();\n';
    }

    return output;
  }

  private getModuleId(sourceFile: string): string {
    // Convert source file path to module ID
    const lastSlash = sourceFile.lastIndexOf('/');
    const basename = lastSlash >= 0 ? sourceFile.substring(lastSlash + 1) : sourceFile;
    return basename.endsWith('.do') ? basename.slice(0, -3) : basename;
  }

  private getModuleImportPath(importInfo: ImportInfo): string {
    const sourceFile = importInfo.sourceFile;
    const withoutExtension = sourceFile.endsWith('.do') ? sourceFile.slice(0, -3) : sourceFile;

    if (!this.currentFilePath) {
      const moduleId = this.getModuleId(sourceFile);
      return `./${moduleId}.js`;
    }

    const fromDirectory = path.dirname(this.currentFilePath);
    let relativePath = path.relative(fromDirectory, withoutExtension);

    if (relativePath === '') {
      relativePath = `./${path.basename(withoutExtension)}`;
    } else if (!relativePath.startsWith('.')) {
      relativePath = `./${relativePath}`;
    }

    // Normalize Windows path separators to POSIX style for JS imports
    relativePath = relativePath.replace(/\\/g, '/');

    return `${relativePath}.js`;
  }

  private usesStringBuilder(program: Program): boolean {
    // Check if any statement or expression uses StringBuilder
    return this.hasStringBuilderUsage(program.body);
  }

  private hasStringBuilderUsage(statements: Statement[]): boolean {
    for (const stmt of statements) {
      if (this.statementUsesStringBuilder(stmt)) {
        return true;
      }
    }
    return false;
  }

  private statementUsesStringBuilder(stmt: Statement): boolean {
    switch (stmt.kind) {
      case 'variable':
        const varDecl = stmt as VariableDeclaration;
        if (varDecl.initializer) {
          return this.expressionUsesStringBuilder(varDecl.initializer);
        }
        break;
      case 'expression':
        const exprStmt = stmt as ExpressionStatement;
        return this.expressionUsesStringBuilder(exprStmt.expression);
      case 'block':
        const blockStmt = stmt as BlockStatement;
        return this.hasStringBuilderUsage(blockStmt.body);
      case 'if':
        const ifStmt = stmt as IfStatement;
        return this.expressionUsesStringBuilder(ifStmt.condition) ||
               this.statementUsesStringBuilder(ifStmt.thenStatement) ||
               (ifStmt.elseStatement ? this.statementUsesStringBuilder(ifStmt.elseStatement) : false);
      case 'function':
        const funcDecl = stmt as FunctionDeclaration;
        return this.statementUsesStringBuilder(funcDecl.body);
      case 'class':
        const classDecl = stmt as ClassDeclaration;
        for (const method of classDecl.methods) {
          if (this.statementUsesStringBuilder(method.body)) {
            return true;
          }
        }
        break;
    }
    return false;
  }

  private expressionUsesStringBuilder(expr: Expression): boolean {
    switch (expr.kind) {
      case 'positionalObject':
        const posExpr = expr as PositionalObjectExpression;
        return posExpr.className === 'StringBuilder';
      case 'object':
        const objExpr = expr as ObjectExpression;
        return objExpr.className === 'StringBuilder';
      case 'call':
        const callExpr = expr as CallExpression;
        // Check if it's a method call on StringBuilder
        if (callExpr.callee.kind === 'member') {
          const memberExpr = callExpr.callee as MemberExpression;
          if (memberExpr.object.kind === 'identifier') {
            // Check if the object type is StringBuilder (this is a simplification)
            return this.expressionUsesStringBuilder(memberExpr.object);
          }
        }
        return this.expressionUsesStringBuilder(callExpr.callee) ||
               callExpr.arguments.some(arg => this.expressionUsesStringBuilder(arg));
      case 'binary':
        const binExpr = expr as BinaryExpression;
        return this.expressionUsesStringBuilder(binExpr.left) ||
               this.expressionUsesStringBuilder(binExpr.right);
      case 'member':
        const memExpr = expr as MemberExpression;
        return this.expressionUsesStringBuilder(memExpr.object);
      // Add more cases as needed
      default:
        return false;
    }
  }

  private generateStringBuilderClass(): string {
    return `class StringBuilder {
  constructor(capacity) {
    this.buffer = '';
    this.capacity = capacity || 0;
  }

  append(value) {
    // Format numbers to match C++/VM precision  
    if (typeof value === 'number' && !Number.isInteger(value)) {
      // Use toFixed(6) to match C++/VM output format
      this.buffer += value.toFixed(6);
    } else {
      this.buffer += String(value);
    }
    return this;
  }

  toString() {
    return this.buffer;
  }

  clear() {
    this.buffer = '';
    return this;
  }

  reserve(capacity) {
    this.capacity = capacity;
    return this;
  }
}\n`;
  }

  generateStatement(stmt: Statement | Expression): string {
    return generateStatement(this, stmt);
  }

  generateParameter(param: Parameter): string {
    let output = param.name.name;
    if (param.defaultValue) {
      output += ' = ' + this.generateExpression(param.defaultValue);
    }
    return output;
  }

  generateExpression(expr: Expression): string {
    return generateExpression(this, expr);
  }

  indent(): string {
    return '  '.repeat(this.indentLevel);
  }

  // Runtime helpers for JSON serialization to mirror VM/C++ behavior
  private generateJsonHelpers(): string {
    return `// JSON helpers to normalize Map/Set/class to JSON-friendly structures and reconstruct them
function __doof_toJson(value) {
  if (value == null) return value;
  // Preserve primitives as-is
  const t = typeof value;
  if (t !== 'object') return value;

  // Arrays
  if (Array.isArray(value)) {
    return value.map(v => __doof_toJson(v));
  }

  // Map -> plain object with stringified keys
  if (value instanceof Map) {
    const obj = {};
    for (const [k, v] of value.entries()) {
      obj[String(k)] = __doof_toJson(v);
    }
    return obj;
  }

  // Set -> array
  if (value instanceof Set) {
    return Array.from(value, v => __doof_toJson(v));
  }

  // If the object defines toJSON, delegate to it first
  if (typeof value.toJSON === 'function') {
    try {
      const r = value.toJSON();
      // Ensure the result is also normalized (handles nested Maps/Sets)
      return __doof_toJson(r);
    } catch {
      // fall through to plain object copy
    }
  }

  // Plain object: shallow-copy enumerable own props with normalization
  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = __doof_toJson(value[key]);
  }
  return out;
}

// Parse object key back to typed key
function __doof_parseKey(keyStr, keyType) {
  if (!keyType || keyType.k !== 'primitive') return keyStr;
  switch (keyType.t) {
    case 'int': return parseInt(keyStr, 10);
    case 'float':
    case 'double': return Number(keyStr);
    case 'bool': return keyStr === 'true';
    case 'string':
    default: return keyStr;
  }
}

// Reconstruct JS structures from normalized JSON using a type descriptor
function __doof_fromJson(value, typeDesc) {
  if (value == null || !typeDesc) return value;

  switch (typeDesc.k) {
    case 'primitive':
      // Assume JSON already has the primitive in correct shape
      if (typeDesc.t === 'int') {
        return typeof value === 'number' ? (value | 0) : parseInt(String(value), 10);
      }
      if (typeDesc.t === 'float' || typeDesc.t === 'double') {
        return typeof value === 'number' ? value : Number(value);
      }
      if (typeDesc.t === 'bool') {
        return typeof value === 'boolean' ? value : String(value) === 'true';
      }
      return String(value);

    case 'array':
      if (!Array.isArray(value)) return [];
      return value.map(v => __doof_fromJson(v, typeDesc.el));

    case 'set':
      if (!Array.isArray(value)) return new Set();
      return new Set(value.map(v => __doof_fromJson(v, typeDesc.el)));

    case 'map': {
      if (value == null || typeof value !== 'object' || Array.isArray(value)) return new Map();
      const m = new Map();
      const keys = Object.keys(value);
      for (const k of keys) {
        const typedKey = __doof_parseKey(k, typeDesc.key);
        m.set(typedKey, __doof_fromJson(value[k], typeDesc.val));
      }
      return m;
    }

    case 'class': {
      const ctor = typeDesc.ctor;
      if (ctor && typeof ctor.fromJSON === 'function') {
        return ctor.fromJSON(value);
      }
      // Fallback: shallow assign
      const out = {};
      for (const key of Object.keys(value)) out[key] = value[key];
      return out;
    }

    default:
      return value;
  }
}
`;
  }
}
