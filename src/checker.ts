/**
 * Full type analysis pass for Doof modules.
 *
 * Builds on the module-level analysis from analyzer.ts by:
 *   1. Resolving type annotations to semantic ResolvedType values.
 *   2. Building nested scopes for functions, methods, and blocks.
 *   3. Inferring expression types (literals, identifiers, operators, calls,
 *      member access) — decorating AST nodes directly with `resolvedType`.
 *   4. Tracking provenance for every identifier — decorating with `resolvedBinding`.
 *
 * After type checking, all resolved type information lives directly on the
 * AST nodes. The returned ModuleTypeInfo carries only diagnostics.
 *
 * Usage:
 *   const analysisResult = analyzer.analyzeModule("/path/to/entry.do");
 *   const checker = new TypeChecker(analysisResult);
 *   const info = checker.checkModule("/path/to/entry.do");
 *   // info.diagnostics — type-level diagnostics
 *   // AST nodes now carry resolvedType, resolvedBinding, resolvedSymbol
 */

import type { AnalysisResult } from "./analyzer.js";
import type {
  Expression,
  Statement,
  TypeAnnotation,
  Block,
  CaseArm,
  CasePattern,
  FunctionDeclaration,
  ClassDeclaration,
  InterfaceDeclaration,
  Parameter,
  SourceSpan,
  TryBinding,
  TypeAliasDeclaration,
} from "./ast.js";
import { validateCollectionTypeAnnotation } from "./checker-collection-annotations.js";
import type { ModuleSymbolTable, ModuleSymbol } from "./types.js";
import {
  buildMockCallMetadata,
  type ClassType,
  type FunctionResolvedParam,
  type ResolvedType,
  type Binding,
  type Scope,
  type ScopeKind,
  type ModuleTypeInfo,
  findUnsupportedHashCollectionConstraint,
  INT_TYPE,
  LONG_TYPE,
  FLOAT_TYPE,
  formatUnsupportedHashCollectionConstraintMessage,
  DOUBLE_TYPE,
  STRING_TYPE,
  CHAR_TYPE,
  BOOL_TYPE,
  JSON_VALUE_TYPE,
  JSON_OBJECT_TYPE,
  VOID_TYPE,
  NULL_TYPE,
  UNKNOWN_TYPE,
  isPrimitiveName,
  isAssignableTo,
  substituteTypeParams,
  typeToString,
} from "./checker-types.js";
import {
  BUILTIN_PARSE_ERROR_TYPE,
  BUILTIN_SPAN,
  NUMERIC_PRIMITIVE_NAMES,
  STRING_CONVERTIBLE_PRIMITIVE_NAMES,
  type BuiltinFunctionSpec,
  type CheckerHost,
} from "./checker-internal.js";
import { checkStatements, checkStatement, checkBlock } from "./checker-stmt.js";
import { checkFunction, checkClass, checkMethod } from "./checker-decl.js";
import { inferExprType } from "./checker-expr.js";
import { inferBinaryType, inferUnaryType, resolveExpectedEnumType } from "./checker-expr-ops.js";
import { inferMemberType, lookupFieldType, getPositionalFieldTypes } from "./checker-member.js";
import {
  buildResultArmScope,
  checkCatchExpression,
  checkTryStatement,
  getTryBindingValue,
  retypeTryBinding,
} from "./checker-result.js";

export function validateEmitReadyDeclarations(
  table: ModuleSymbolTable,
  info: ModuleTypeInfo,
): void {
  const hasBlockingDiagnostic = (span: SourceSpan): boolean =>
    info.diagnostics.some((diagnostic) =>
      diagnostic.severity === "error"
      && diagnostic.span.start.offset <= span.end.offset
      && diagnostic.span.end.offset >= span.start.offset,
    );

  const validateNamedValue = (
    kind: "declaration" | "binding",
    name: string,
    resolvedType: ResolvedType | undefined,
    span: SourceSpan,
  ): void => {
    if (resolvedType && resolvedType.kind !== "unknown") return;
    if (hasBlockingDiagnostic(span)) return;

    info.diagnostics.push({
      severity: "error",
      message: resolvedType
        ? `Cannot emit ${kind} "${name}" with unresolved type`
        : `Cannot emit ${kind} "${name}" without checker type information`,
      span,
      module: table.path,
    });
  };

  const validateTypedNode = (
    kind: string,
    resolvedType: ResolvedType | undefined,
    span: SourceSpan,
  ): void => {
    if (!resolvedType || resolvedType.kind !== "unknown") return;
    if (hasBlockingDiagnostic(span)) return;

    info.diagnostics.push({
      severity: "error",
      message: `Cannot emit ${kind.replace(/-/g, " ")} with unresolved type`,
      span,
      module: table.path,
    });
  };

  const visitParameter = (param: Parameter): void => {
    if (param.defaultValue) {
      visitExpression(param.defaultValue);
    }
  };

  const visitFunctionLike = (fn: FunctionDeclaration): void => {
    for (const param of fn.params) {
      visitParameter(param);
    }
    if (fn.body.kind === "block") {
      visitBlock(fn.body);
    } else {
      visitExpression(fn.body);
    }
  };

  const visitPattern = (pattern: CasePattern): void => {
    switch (pattern.kind) {
      case "value-pattern":
        visitExpression(pattern.value);
        break;

      case "range-pattern":
        if (pattern.start) visitExpression(pattern.start);
        if (pattern.end) visitExpression(pattern.end);
        break;

      case "type-pattern":
      case "wildcard-pattern":
        break;
    }
  };

  const visitCaseArm = (arm: CaseArm): void => {
    for (const pattern of arm.patterns) {
      visitPattern(pattern);
    }
    if (arm.body.kind === "block") {
      visitBlock(arm.body);
    } else {
      visitExpression(arm.body);
    }
  };

  const visitExpression = (expr: Expression): void => {
    validateTypedNode(expr.kind, expr.resolvedType, expr.span);

    switch (expr.kind) {
      case "string-literal":
        for (const part of expr.parts) {
          if (typeof part !== "string") {
            visitExpression(part);
          }
        }
        break;

      case "binary-expression":
        visitExpression(expr.left);
        visitExpression(expr.right);
        break;

      case "unary-expression":
        visitExpression(expr.operand);
        break;

      case "assignment-expression":
        visitExpression(expr.target);
        visitExpression(expr.value);
        break;

      case "member-expression":
      case "qualified-member-expression":
        visitExpression(expr.object);
        break;

      case "index-expression":
        visitExpression(expr.object);
        visitExpression(expr.index);
        break;

      case "call-expression":
        visitExpression(expr.callee);
        for (const arg of expr.args) {
          visitExpression(arg.value);
        }
        break;

      case "yield-block-expression":
        visitBlock(expr.body);
        break;

      case "array-literal":
      case "tuple-literal":
        for (const element of expr.elements) {
          visitExpression(element);
        }
        break;

      case "object-literal":
        for (const property of expr.properties) {
          if (property.value) {
            visitExpression(property.value);
          }
        }
        if (expr.spread) {
          visitExpression(expr.spread);
        }
        break;

      case "map-literal":
        for (const entry of expr.entries) {
          visitExpression(entry.key);
          visitExpression(entry.value);
        }
        break;

      case "lambda-expression":
        for (const param of expr.params) {
          visitParameter(param);
        }
        if (expr.body.kind === "block") {
          visitBlock(expr.body);
        } else {
          visitExpression(expr.body);
        }
        break;

      case "if-expression":
        visitExpression(expr.condition);
        visitExpression(expr.then);
        visitExpression(expr.else_);
        break;

      case "case-expression":
        visitExpression(expr.subject);
        for (const arm of expr.arms) {
          visitCaseArm(arm);
        }
        break;

      case "construct-expression":
        if (expr.named) {
          for (const property of expr.args as import("./ast.js").ObjectProperty[]) {
            if (property.value) {
              visitExpression(property.value);
            }
          }
        } else {
          for (const arg of expr.args as Expression[]) {
            visitExpression(arg);
          }
        }
        break;

      case "catch-expression":
        visitStatements(expr.body);
        break;

      case "async-expression":
        if (expr.expression.kind === "block") {
          visitBlock(expr.expression);
        } else {
          visitExpression(expr.expression);
        }
        break;

      case "non-null-assertion":
      case "as-expression":
        visitExpression(expr.expression);
        break;

      case "actor-creation-expression":
        for (const arg of expr.args) {
          visitExpression(arg);
        }
        break;

      case "int-literal":
      case "long-literal":
      case "float-literal":
      case "double-literal":
      case "char-literal":
      case "bool-literal":
      case "null-literal":
      case "identifier":
      case "enum-access":
      case "dot-shorthand":
      case "this-expression":
        break;
    }
  };

  const visitBlock = (block: Block): void => {
    for (const stmt of block.statements) {
      visitStatement(stmt);
    }
  };

  const visitStatements = (statements: Statement[]): void => {
    for (const stmt of statements) {
      visitStatement(stmt);
    }
  };

  const visitStatement = (stmt: Statement): void => {
    switch (stmt.kind) {
      case "const-declaration":
      case "readonly-declaration":
      case "immutable-binding":
      case "let-declaration":
        validateNamedValue("declaration", stmt.name, stmt.resolvedType, stmt.span);
        if (stmt.value) {
          visitExpression(stmt.value);
        }
        break;

      case "yield-block-assignment-statement":
        validateTypedNode(stmt.kind, stmt.resolvedType, stmt.span);
        visitExpression(stmt.value);
        break;

      case "function-declaration":
        visitFunctionLike(stmt);
        break;

      case "class-declaration":
        for (const field of stmt.fields) {
          for (const fieldName of field.names) {
            validateNamedValue("declaration", fieldName, field.resolvedType, field.span);
          }
          if (field.defaultValue) {
            visitExpression(field.defaultValue);
          }
        }
        for (const method of stmt.methods) {
          visitFunctionLike(method);
        }
        if (stmt.destructor) {
          visitBlock(stmt.destructor);
        }
        break;

      case "enum-declaration":
        for (const variant of stmt.variants) {
          if (variant.value) {
            visitExpression(variant.value);
          }
        }
        break;

      case "if-statement":
        visitExpression(stmt.condition);
        visitBlock(stmt.body);
        for (const elseIf of stmt.elseIfs) {
          visitExpression(elseIf.condition);
          visitBlock(elseIf.body);
        }
        if (stmt.else_) visitBlock(stmt.else_);
        break;

      case "case-statement":
        visitExpression(stmt.subject);
        for (const arm of stmt.arms) {
          visitCaseArm(arm);
        }
        break;

      case "while-statement":
        visitExpression(stmt.condition);
        visitBlock(stmt.body);
        if (stmt.then_) visitBlock(stmt.then_);
        break;

      case "for-statement":
        if (stmt.init) visitStatement(stmt.init);
        if (stmt.condition) visitExpression(stmt.condition);
        for (const update of stmt.update) {
          visitExpression(update);
        }
        visitBlock(stmt.body);
        if (stmt.then_) visitBlock(stmt.then_);
        break;

      case "for-of-statement":
        visitExpression(stmt.iterable);
        visitBlock(stmt.body);
        if (stmt.then_) visitBlock(stmt.then_);
        break;

      case "with-statement":
        for (const binding of stmt.bindings) {
          validateNamedValue("binding", binding.name, binding.resolvedType, binding.span);
          visitExpression(binding.value);
        }
        visitBlock(stmt.body);
        break;

      case "try-statement":
        visitStatement(stmt.binding);
        break;

      case "else-narrow-statement":
        validateNamedValue("binding", stmt.name, stmt.resolvedType, stmt.span);
        visitExpression(stmt.subject);
        visitBlock(stmt.elseBlock);
        break;

      case "export-declaration":
        visitStatement(stmt.declaration);
        break;

      case "block":
        visitBlock(stmt);
        break;

      case "return-statement":
        if (stmt.value) {
          visitExpression(stmt.value);
        }
        break;

      case "expression-statement":
        visitExpression(stmt.expression);
        break;

      case "array-destructuring":
      case "positional-destructuring":
      case "named-destructuring":
      case "array-destructuring-assignment":
      case "positional-destructuring-assignment":
      case "named-destructuring-assignment":
        visitExpression(stmt.value);
        break;

      case "yield-statement":
        visitExpression(stmt.value);
        break;

      case "import-declaration":
      case "mock-import-directive":
      case "extern-class-declaration":
      case "extern-function-declaration":
      case "export-list":
      case "export-all-declaration":
      case "break-statement":
      case "continue-statement":
      case "interface-declaration":
      case "type-alias-declaration":
        break;
    }
  };

  visitStatements(table.program.statements);
}

// ============================================================================
// TypeChecker
// ============================================================================

export class TypeChecker {
  private analysisResult: AnalysisResult;
  private moduleInfoCache = new Map<string, ModuleTypeInfo>();
  /**
   * Stack of error-type collectors for nested catch expressions.
   * When non-empty, `try` statements inside the innermost catch push their
   * error types here instead of requiring the enclosing function to return Result.
   */
  private catchErrorTypes: ResolvedType[][] = [];
  /**
   * Stack of type parameter maps for resolving type variables.
   * Pushed when entering a generic class/function/method, popped when leaving.
   */
  private typeParamStack: Set<string>[] = [];
  private host: CheckerHost;

  constructor(analysisResult: AnalysisResult) {
    this.analysisResult = analysisResult;
    this.host = this.createHost();
  }

  private createHost(): CheckerHost {
    const self = this;
    return {
      get analysisResult() { return self.analysisResult; },
      get catchErrorTypes() { return self.catchErrorTypes; },
      get typeParamStack() { return self.typeParamStack; },
      checkBlock: (...args) => self.checkBlock(...args),
      checkCatchExpression: (...args) => self.checkCatchExpression(...args),
      checkClass: (...args) => self.checkClass(...args),
      checkConditionIsBool: (...args) => self.checkConditionIsBool(...args),
      checkFunction: (...args) => self.checkFunction(...args),
      checkMethod: (...args) => self.checkMethod(...args),
      checkStatement: (...args) => self.checkStatement(...args),
      checkStatements: (...args) => self.checkStatements(...args),
      checkTryStatement: (...args) => self.checkTryStatement(...args),
      blockAlwaysExits: (...args) => self.blockAlwaysExits(...args),
      blockAlwaysYields: (...args) => self.blockAlwaysYields(...args),
      findReturnType: (...args) => self.findReturnType(...args),
      findThisType: (...args) => self.findThisType(...args),
      getPositionalFieldTypes: (...args) => self.getPositionalFieldTypes(...args),
      getTryBindingValue: (...args) => self.getTryBindingValue(...args),
      inferExprType: (...args) => self.inferExprType(...args),
      inferTypeArgs: (...args) => self.inferTypeArgs(...args),
      lookupBinding: (...args) => self.lookupBinding(...args),
      lookupFieldType: (...args) => self.lookupFieldType(...args),
      pushScope: (...args) => self.pushScope(...args),
      resolveGenericTypeArgs: (...args) => self.resolveGenericTypeArgs(...args),
      resolveTypeAnnotation: (...args) => self.resolveTypeAnnotation(...args),
      retypeTryBinding: (...args) => self.retypeTryBinding(...args),
      symbolToType: (...args) => self.symbolToType(...args),
    };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Type-check a single module and return per-expression types and
   * per-identifier binding resolutions.
   */
  checkModule(modulePath: string): ModuleTypeInfo {
    const cached = this.moduleInfoCache.get(modulePath);
    if (cached) {
      return cached;
    }

    const table = this.analysisResult.modules.get(modulePath);
    if (!table) {
      const info: ModuleTypeInfo = {
        diagnostics: [{
          severity: "error",
          message: `Module not found: ${modulePath}`,
          span: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } },
          module: modulePath,
        }],
      };
      this.moduleInfoCache.set(modulePath, info);
      return info;
    }

    const info: ModuleTypeInfo = {
      diagnostics: [],
    };
    this.moduleInfoCache.set(modulePath, info);

    // Imported modules may define fields whose types are inferred from default
    // values. Check dependencies first so member lookup sees decorated types.
    for (const imp of table.imports) {
      if (imp.symbol && imp.symbol.module !== modulePath) {
        this.checkModule(imp.symbol.module);
      }
    }
    for (const nsImp of table.namespaceImports) {
      if (nsImp.sourceModule !== modulePath) {
        this.checkModule(nsImp.sourceModule);
      }
    }

    const moduleScope = this.buildModuleScope(table);
    this.checkStatements(table.program.statements, moduleScope, table, info);
    this.validateTypeDeclarations(table, info);
    validateEmitReadyDeclarations(table, info);
    this.validateInterfacesHaveImplementors(table, info);

    return info;
  }

  private validateInterfacesHaveImplementors(
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    for (const [, sym] of table.symbols) {
      if (sym.symbolKind !== "interface" || sym.module !== table.path) continue;

      const ifaceType: ResolvedType = { kind: "interface", symbol: sym };
      let hasImplementor = false;

      for (const [, moduleTable] of this.analysisResult.modules) {
        for (const [, candidate] of moduleTable.symbols) {
          if (candidate.symbolKind !== "class") continue;
          const classType: ResolvedType = { kind: "class", symbol: candidate };
          if (isAssignableTo(classType, ifaceType)) {
            hasImplementor = true;
            break;
          }
        }
        if (hasImplementor) break;
      }

      if (!hasImplementor) {
        info.diagnostics.push({
          severity: "error",
          message: `Cannot emit interface "${sym.name}" without implementing classes`,
          span: sym.declaration.span,
          module: table.path,
        });
      }
    }
  }

  private validateTypeDeclarations(
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    const visitStatement = (stmt: Statement): void => {
      switch (stmt.kind) {
        case "interface-declaration":
          this.validateInterfaceDeclaration(stmt, table, info);
          break;

        case "type-alias-declaration":
          this.validateTypeAliasDeclaration(stmt, table, info);
          break;

        case "mock-import-directive":
          break;

        case "export-declaration":
          visitStatement(stmt.declaration);
          break;

        default:
          break;
      }
    };

    for (const stmt of table.program.statements) {
      visitStatement(stmt);
    }
  }

  private validateInterfaceDeclaration(
    decl: InterfaceDeclaration,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    if (decl.typeParams.length > 0) {
      this.typeParamStack.push(new Set(decl.typeParams));
    }

    for (const field of decl.fields) {
      validateCollectionTypeAnnotation(field.type, field.type.span, table, info, { allowOmittedTypeArgs: false });
      field.resolvedType = this.resolveTypeAnnotation(field.type, table);
      this.reportUnsupportedHashCollectionConstraint(field.resolvedType, field.type.span, table, info);
    }

    for (const method of decl.methods) {
      if (method.typeParams.length > 0) {
        this.typeParamStack.push(new Set(method.typeParams));
      }

      const params = method.params.map((param) => {
        if (param.type) {
          validateCollectionTypeAnnotation(param.type, param.type.span, table, info, { allowOmittedTypeArgs: false });
        }
        const paramType = param.type
          ? this.resolveTypeAnnotation(param.type, table)
          : UNKNOWN_TYPE;
        param.resolvedType = paramType;
        if (param.type) {
          this.reportUnsupportedHashCollectionConstraint(paramType, param.type.span, table, info);
        }
        return { name: param.name, type: paramType };
      });
      validateCollectionTypeAnnotation(method.returnType, method.returnType.span, table, info, { allowOmittedTypeArgs: false });
      const returnType = this.resolveTypeAnnotation(method.returnType, table);
      this.reportUnsupportedHashCollectionConstraint(returnType, method.returnType.span, table, info);
      method.resolvedType = {
        kind: "function",
        params,
        returnType,
        typeParams: method.typeParams.length > 0 ? method.typeParams : undefined,
      };

      if (method.typeParams.length > 0) {
        this.typeParamStack.pop();
      }
    }

    if (decl.typeParams.length > 0) {
      this.typeParamStack.pop();
    }
  }

  private validateTypeAliasDeclaration(
    decl: TypeAliasDeclaration,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    if (decl.typeParams.length > 0) {
      this.typeParamStack.push(new Set(decl.typeParams));
    }

    validateCollectionTypeAnnotation(decl.type, decl.type.span, table, info, { allowOmittedTypeArgs: false });
    const aliasType = this.resolveTypeAnnotation(decl.type, table);
    this.reportUnsupportedHashCollectionConstraint(aliasType, decl.type.span, table, info);

    if (decl.typeParams.length > 0) {
      this.typeParamStack.pop();
    }
  }

  private reportUnsupportedHashCollectionConstraint(
    type: ResolvedType,
    span: SourceSpan,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    const issue = findUnsupportedHashCollectionConstraint(type);
    if (!issue) return;

    info.diagnostics.push({
      severity: "error",
      message: formatUnsupportedHashCollectionConstraintMessage(issue),
      span,
      module: table.path,
    });
  }

  /**
   * Resolve a syntactic TypeAnnotation to a semantic ResolvedType using
   * the given module's symbol table.
   */
  resolveTypeAnnotation(ann: TypeAnnotation, table: ModuleSymbolTable): ResolvedType {
    switch (ann.kind) {
      case "named-type": {
        const name = ann.name;
        if (name === "JsonValue") return JSON_VALUE_TYPE;
        if (name === "JsonObject") return JSON_OBJECT_TYPE;
        if (isPrimitiveName(name)) return { kind: "primitive", name };
        if (name === "void") return VOID_TYPE;
        if (name === "null") return NULL_TYPE;

        // Built-in generic collections
        if (name === "Array" || name === "ReadonlyArray") {
          const elemType = ann.typeArgs.length > 0
            ? this.resolveTypeAnnotation(ann.typeArgs[0], table)
            : UNKNOWN_TYPE;
          return { kind: "array", elementType: elemType, readonly_: name === "ReadonlyArray" };
        }
        if (name === "Tuple") {
          return {
            kind: "tuple",
            elements: ann.typeArgs.map((a) => this.resolveTypeAnnotation(a, table)),
          };
        }

        // Map<K, V> / ReadonlyMap<K, V> — key-value map
        if (name === "Map" || name === "ReadonlyMap") {
          const keyType = ann.typeArgs.length > 0
            ? this.resolveTypeAnnotation(ann.typeArgs[0], table)
            : UNKNOWN_TYPE;
          const valueType = ann.typeArgs.length > 1
            ? this.resolveTypeAnnotation(ann.typeArgs[1], table)
            : UNKNOWN_TYPE;
          return { kind: "map", keyType, valueType, readonly_: name === "ReadonlyMap" };
        }
        if (name === "Set" || name === "ReadonlySet") {
          const elementType = ann.typeArgs.length > 0
            ? this.resolveTypeAnnotation(ann.typeArgs[0], table)
            : UNKNOWN_TYPE;
          return { kind: "set", elementType, readonly_: name === "ReadonlySet" };
        }

        // Actor<ClassName> — actor type wrapping a class
        if (name === "Actor") {
          if (ann.typeArgs.length === 1) {
            const innerType = this.resolveTypeAnnotation(ann.typeArgs[0], table);
            if (innerType.kind === "class") {
              return { kind: "actor", innerClass: innerType };
            }
          }
          return UNKNOWN_TYPE;
        }

        // Promise<T> — async promise type
        if (name === "Promise") {
          if (ann.typeArgs.length === 1) {
            const valueType = this.resolveTypeAnnotation(ann.typeArgs[0], table);
            return { kind: "promise", valueType };
          }
          return UNKNOWN_TYPE;
        }

        // Result<T, E> — error handling type
        if (name === "Result") {
          if (ann.typeArgs.length === 2) {
            const successType = this.resolveTypeAnnotation(ann.typeArgs[0], table);
            const errorType = this.resolveTypeAnnotation(ann.typeArgs[1], table);
            return { kind: "result", successType, errorType };
          }
          return UNKNOWN_TYPE;
        }

        if (name === "Stream") {
          if (ann.typeArgs.length === 1) {
            const elementType = this.resolveTypeAnnotation(ann.typeArgs[0], table);
            return { kind: "stream", elementType };
          }
          return UNKNOWN_TYPE;
        }

        // User-defined symbol
        // Check type parameter scopes first (innermost → outermost).
        for (let i = this.typeParamStack.length - 1; i >= 0; i--) {
          if (this.typeParamStack[i].has(name)) {
            return { kind: "typevar", name };
          }
        }

        const sym = table.symbols.get(name);
        if (name === "ParseError" && !sym) return BUILTIN_PARSE_ERROR_TYPE;
        if (!sym) return UNKNOWN_TYPE;
        return this.symbolToType(sym, table, ann.typeArgs);
      }

      case "array-type":
        return {
          kind: "array",
          elementType: this.resolveTypeAnnotation(ann.elementType, table),
          readonly_: ann.readonly_,
        };

      case "union-type":
        return {
          kind: "union",
          types: ann.types.map((t) => this.resolveTypeAnnotation(t, table)),
        };

      case "function-type":
        return {
          kind: "function",
          params: ann.params.map((p) => ({
            name: p.name,
            type: this.resolveTypeAnnotation(p.type, table),
          })),
          returnType: this.resolveTypeAnnotation(ann.returnType, table),
        };

      case "tuple-type":
        return {
          kind: "tuple",
          elements: ann.elements.map((e) => this.resolveTypeAnnotation(e, table)),
        };

      case "weak-type":
        return { kind: "weak", inner: this.resolveTypeAnnotation(ann.type, table) };
    }
  }

  // --------------------------------------------------------------------------
  // Scope building
  // --------------------------------------------------------------------------

  private buildModuleScope(table: ModuleSymbolTable): Scope {
    const scope: Scope = {
      parent: null,
      bindings: new Map(),
      kind: "module",
      thisType: null,
      returnType: null,
    };

    // Populate from module-level symbols (local declarations).
    for (const [name, sym] of table.symbols) {
      scope.bindings.set(name, this.symbolToBinding(sym));
    }

    // Imported bindings are already in table.symbols (analyzer merges them),
    // but we mark them with kind "import" for provenance.
    for (const imp of table.imports) {
      if (imp.symbol) {
        scope.bindings.set(imp.localName, this.symbolToBinding(imp.symbol, "import"));
      }
    }

    // Namespace imports: register each as a namespace binding so that
    // member expressions like `ns.Something` can be resolved.
    for (const nsImp of table.namespaceImports) {
      scope.bindings.set(nsImp.localName, {
        name: nsImp.localName,
        kind: "namespace-import",
        type: { kind: "namespace", sourceModule: nsImp.sourceModule },
        mutable: false,
        span: BUILTIN_SPAN,
        module: table.path,
      });
    }

    this.addBuiltinBindings(scope);

    // Built-in runtime functions (println, print, panic, etc.)
    this.addBuiltinFunctions(scope);

    return scope;
  }

  private addBuiltinBindings(scope: Scope): void {
    const primitiveNamespaces = ["byte", "int", "long", "float", "double", "string", "char", "bool"] as const;
    for (const name of primitiveNamespaces) {
      if (scope.bindings.has(name)) continue;
      scope.bindings.set(name, {
        name,
        kind: "builtin",
        type: { kind: "builtin-namespace", name },
        mutable: false,
        span: BUILTIN_SPAN,
        module: "<builtin>",
      });
    }

    if (!scope.bindings.has("ParseError")) {
      scope.bindings.set("ParseError", {
        name: "ParseError",
        kind: "enum",
        type: BUILTIN_PARSE_ERROR_TYPE,
        mutable: false,
        span: BUILTIN_SPAN,
        module: "<builtin>",
      });
    }
  }

  /**
   * Register built-in runtime functions (println, print, panic, etc.)
   * into the given scope so the type checker recognizes them.
   */
  private addBuiltinFunctions(scope: Scope): void {
    const builtins: { name: string; params: FunctionResolvedParam[]; returnType: ResolvedType }[] = [
      // println(value: T): void — print a value followed by a newline
      { name: "println", params: [{ name: "value", type: UNKNOWN_TYPE }], returnType: VOID_TYPE },
      // println(): void — print an empty line (0-arg overload handled by UNKNOWN_TYPE param being optional in practice)
      // print(value: T): void — print a value without a newline
      { name: "print", params: [{ name: "value", type: UNKNOWN_TYPE }], returnType: VOID_TYPE },
      // panic(message: string): void — abort with an error message
      { name: "panic", params: [{ name: "message", type: STRING_TYPE }], returnType: VOID_TYPE },
      // assert(condition: bool, message: string): void — panic when the condition is false
      { name: "assert", params: [{ name: "condition", type: BOOL_TYPE }, { name: "message", type: STRING_TYPE }], returnType: VOID_TYPE },
      // to_string(value: T): string — convert any value to a string
      { name: "to_string", params: [{ name: "value", type: UNKNOWN_TYPE }], returnType: STRING_TYPE },
      // concat(...args): string — concatenate values into a string
      { name: "concat", params: [{ name: "value", type: UNKNOWN_TYPE }], returnType: STRING_TYPE },
    ];

    for (const b of builtins) {
      // Don't override user-defined symbols with the same name
      if (scope.bindings.has(b.name)) continue;
      scope.bindings.set(b.name, {
        name: b.name,
        kind: "function",
        type: { kind: "function", params: b.params, returnType: b.returnType },
        mutable: false,
        span: BUILTIN_SPAN,
        module: "<builtin>",
      });
    }
  }

  private symbolToBinding(sym: ModuleSymbol, kindOverride?: "import"): Binding {
    const table = this.analysisResult.modules.get(sym.module);
    const type = table ? this.symbolToType(sym, table) : UNKNOWN_TYPE;

    let kind: Binding["kind"];
    if (kindOverride) {
      kind = kindOverride;
    } else {
      switch (sym.symbolKind) {
        case "class": kind = "class"; break;
        case "interface": kind = "interface"; break;
        case "enum": kind = "enum"; break;
        case "type-alias": kind = "type-alias"; break;
        case "function": kind = "function"; break;
        case "const": kind = "const"; break;
        case "readonly": kind = "readonly"; break;
      }
    }

    return {
      name: sym.name,
      kind,
      symbol: sym,
      type,
      mutable: false,
      span: sym.declaration.span,
      module: sym.module,
    };
  }

  private symbolToType(sym: ModuleSymbol, table: ModuleSymbolTable, typeArgs?: TypeAnnotation[]): ResolvedType {
    switch (sym.symbolKind) {
      case "class": {
        const resolvedArgs = this.resolveGenericTypeArgs(sym.declaration.typeParams, typeArgs, table);
        if (resolvedArgs && resolvedArgs.length > 0) {
          return { kind: "class", symbol: sym, typeArgs: resolvedArgs };
        }
        return { kind: "class", symbol: sym };
      }
      case "interface": {
        const resolvedArgs = this.resolveGenericTypeArgs(sym.declaration.typeParams, typeArgs, table);
        if (resolvedArgs && resolvedArgs.length > 0) {
          return { kind: "interface", symbol: sym, typeArgs: resolvedArgs };
        }
        return { kind: "interface", symbol: sym };
      }
      case "enum":
        return { kind: "enum", symbol: sym };
      case "type-alias": {
        const declTypeParams = sym.declaration.typeParams;
        if (declTypeParams.length > 0 && typeArgs && typeArgs.length > 0) {
          const paramMap = new Map<string, ResolvedType>();
          for (let i = 0; i < declTypeParams.length && i < typeArgs.length; i++) {
            paramMap.set(declTypeParams[i], this.resolveTypeAnnotation(typeArgs[i], table));
          }
          this.typeParamStack.push(new Set(declTypeParams));
          const baseType = this.resolveTypeAnnotation(sym.declaration.type, table);
          this.typeParamStack.pop();
          return substituteTypeParams(baseType, paramMap);
        }
        // Non-generic alias or no args provided — resolve with type params in scope
        if (declTypeParams.length > 0) {
          this.typeParamStack.push(new Set(declTypeParams));
          const t = this.resolveTypeAnnotation(sym.declaration.type, table);
          this.typeParamStack.pop();
          return t;
        }
        return this.resolveTypeAnnotation(sym.declaration.type, table);
      }
      case "function": {
        const declTypeParams = sym.declaration.typeParams;
        if (declTypeParams.length > 0) {
          this.typeParamStack.push(new Set(declTypeParams));
        }
        const params: FunctionResolvedParam[] = sym.declaration.params.map((p) => ({
          name: p.name,
          type: p.type ? this.resolveTypeAnnotation(p.type, table) : UNKNOWN_TYPE,
          hasDefault: p.defaultValue !== null,
          defaultValue: p.defaultValue,
        }));
        const returnType = sym.declaration.returnType
          ? this.resolveTypeAnnotation(sym.declaration.returnType, table)
          : UNKNOWN_TYPE;
        if (declTypeParams.length > 0) {
          this.typeParamStack.pop();
        }
        return {
          kind: "function",
          params,
          returnType,
          typeParams: declTypeParams.length > 0 ? declTypeParams : undefined,
          mockCall: sym.declaration.mock_
            ? buildMockCallMetadata(sym.module, sym.declaration.name, params)
            : undefined,
        };
      }
      case "const":
      case "readonly":
        return sym.declaration.type
          ? this.resolveTypeAnnotation(sym.declaration.type, table)
          : UNKNOWN_TYPE; // will be refined during checkStatement
    }
  }

  /** Resolve generic type arguments to ResolvedType values. */
  private resolveGenericTypeArgs(
    declTypeParams: string[],
    typeArgs: TypeAnnotation[] | undefined,
    table: ModuleSymbolTable,
  ): ResolvedType[] | undefined {
    if (!typeArgs || typeArgs.length === 0) return undefined;
    if (declTypeParams.length === 0) return undefined;
    return typeArgs.map((arg) => this.resolveTypeAnnotation(arg, table));
  }

  /**
   * Infer type arguments for a generic function call by unifying
   * parameter types with argument types.
   */
  private inferTypeArgs(
    typeParams: string[],
    params: { name: string; type: ResolvedType }[],
    argTypes: ResolvedType[],
  ): Map<string, ResolvedType> {
    const result = new Map<string, ResolvedType>();
    for (let i = 0; i < Math.min(params.length, argTypes.length); i++) {
      this.unifyType(params[i].type, argTypes[i], typeParams, result);
    }
    return result;
  }

  /**
   * Attempt to unify a parameter type with an argument type to discover
   * type variable bindings.
   */
  private unifyType(
    paramType: ResolvedType,
    argType: ResolvedType,
    typeParams: string[],
    result: Map<string, ResolvedType>,
  ): void {
    if (paramType.kind === "typevar" && typeParams.includes(paramType.name)) {
      if (!result.has(paramType.name)) {
        result.set(paramType.name, argType);
      }
      return;
    }
    if (paramType.kind === "array" && argType.kind === "array") {
      this.unifyType(paramType.elementType, argType.elementType, typeParams, result);
      return;
    }
    if (paramType.kind === "set" && argType.kind === "set") {
      this.unifyType(paramType.elementType, argType.elementType, typeParams, result);
      return;
    }
    if (paramType.kind === "stream" && argType.kind === "stream") {
      this.unifyType(paramType.elementType, argType.elementType, typeParams, result);
      return;
    }
    if (paramType.kind === "tuple" && argType.kind === "tuple") {
      const len = Math.min(paramType.elements.length, argType.elements.length);
      for (let i = 0; i < len; i++) {
        this.unifyType(paramType.elements[i], argType.elements[i], typeParams, result);
      }
      return;
    }
    if (paramType.kind === "stream" && argType.kind === "class") {
      const streamElementType = this.extractStreamElementType(argType);
      if (streamElementType) {
        this.unifyType(paramType.elementType, streamElementType, typeParams, result);
      }
      return;
    }
    if (paramType.kind === "function" && argType.kind === "function") {
      const len = Math.min(paramType.params.length, argType.params.length);
      for (let i = 0; i < len; i++) {
        this.unifyType(paramType.params[i].type, argType.params[i].type, typeParams, result);
      }
      this.unifyType(paramType.returnType, argType.returnType, typeParams, result);
      return;
    }
    if (paramType.kind === "result" && argType.kind === "result") {
      this.unifyType(paramType.successType, argType.successType, typeParams, result);
      this.unifyType(paramType.errorType, argType.errorType, typeParams, result);
      return;
    }
    if (paramType.kind === "union" && argType.kind === "union") {
      const len = Math.min(paramType.types.length, argType.types.length);
      for (let i = 0; i < len; i++) {
        this.unifyType(paramType.types[i], argType.types[i], typeParams, result);
      }
      return;
    }
  }

  private pushScope(parent: Scope, kind: ScopeKind, returnType?: ResolvedType | null): Scope {
    // Reset inCaseExpressionArm and inCatchExpressionBody when entering a new
    // function/method/lambda — a `return` inside a lambda inside a
    // case-expression arm or catch body is fine.
    const isNewFunction = kind === "function" || kind === "method";
    return {
      parent,
      bindings: new Map(),
      kind,
      thisType: kind === "method" ? parent.thisType : null,
      returnType: returnType !== undefined ? returnType : this.findReturnType(parent),
      inCaseExpressionArm: isNewFunction ? false : parent.inCaseExpressionArm,
      inValueYieldBlock: isNewFunction ? false : parent.inValueYieldBlock,
      valueYield: isNewFunction ? undefined : parent.valueYield,
      inCatchExpressionBody: isNewFunction ? false : parent.inCatchExpressionBody,
      inTrailingLambda: isNewFunction ? false : parent.inTrailingLambda,
    };
  }

  private extractStreamElementType(classType: ClassType): ResolvedType | null {
    const classDecl = classType.symbol.declaration;
    const nextMethod = classDecl.methods.find((method) => method.name === "next" && !method.static_);
    if (!nextMethod || nextMethod.params.length !== 0 || !nextMethod.resolvedType || nextMethod.resolvedType.kind !== "function") {
      return null;
    }

    let methodType = nextMethod.resolvedType;
    if (classType.typeArgs && classType.typeArgs.length > 0 && classDecl.typeParams.length > 0) {
      const paramMap = new Map<string, ResolvedType>();
      for (let i = 0; i < Math.min(classDecl.typeParams.length, classType.typeArgs.length); i++) {
        paramMap.set(classDecl.typeParams[i], classType.typeArgs[i]);
      }
      methodType = substituteTypeParams(methodType, paramMap) as typeof methodType;
    }

    if (methodType.returnType.kind !== "union") {
      return null;
    }

    const nonNullMembers = methodType.returnType.types.filter((type) => type.kind !== "null");
    return nonNullMembers.length === 1 ? nonNullMembers[0] : null;
  }

  // --------------------------------------------------------------------------
  // Statement checking
  // --------------------------------------------------------------------------

  private checkStatements(
    stmts: Statement[],
    scope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    return checkStatements(this.host, stmts, scope, table, info);
  }

  private checkStatement(
    stmt: Statement,
    scope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    return checkStatement(this.host, stmt, scope, table, info);
  }

  private checkBlock(
    block: Block,
    parentScope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    return checkBlock(this.host, block, parentScope, table, info);
  }

  // --------------------------------------------------------------------------
  // Function & class checking
  // --------------------------------------------------------------------------

  private checkFunction(
    decl: FunctionDeclaration,
    parentScope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    return checkFunction(this.host, decl, parentScope, table, info);
  }

  private checkClass(
    decl: ClassDeclaration,
    parentScope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    return checkClass(this.host, decl, parentScope, table, info);
  }

  private checkMethod(
    method: FunctionDeclaration,
    classDecl: ClassDeclaration,
    thisType: ResolvedType,
    parentScope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    return checkMethod(this.host, method, classDecl, thisType, parentScope, table, info);
  }

  // --------------------------------------------------------------------------
  // Expression type inference
  // --------------------------------------------------------------------------

  /**
   * Infer the type of an expression, decorate the AST node with
   * `resolvedType`, and return the type.
   *
   * @param expectedType Optional contextual type flowing from the declaration,
   *   parameter, or return type. Used for contextual typing of object/tuple
   *   literals as class construction, and for array element typing.
   */
  private inferExprType(
    expr: Expression,
    scope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
    expectedType?: ResolvedType,
  ): ResolvedType {
    return inferExprType(this.host, expr, scope, table, info, expectedType);
  }

  // --------------------------------------------------------------------------
  // Binary / unary type helpers
  // --------------------------------------------------------------------------

  private inferBinaryType(
    op: string,
    left: ResolvedType,
    right: ResolvedType,
    info: ModuleTypeInfo,
    table: ModuleSymbolTable,
    span: { start: { line: number; column: number; offset: number }; end: { line: number; column: number; offset: number } },
  ): ResolvedType {
    return inferBinaryType(op, left, right, info, table, span);
  }

  private inferUnaryType(
    op: string,
    operand: ResolvedType,
    scope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
    span: SourceSpan,
  ): ResolvedType {
    return inferUnaryType(op, operand, info, table, span);
  }

  private resolveExpectedEnumType(type?: ResolvedType) {
    return resolveExpectedEnumType(type);
  }

  // --------------------------------------------------------------------------
  // Member / field helpers
  // --------------------------------------------------------------------------

  private inferMemberType(
    objectType: ResolvedType,
    property: string,
    table: ModuleSymbolTable,
    mode: "instance" | "named-static" | "qualified-static" = "instance",
    info?: ModuleTypeInfo,
    span?: SourceSpan,
    binding?: Binding,
  ): ResolvedType {
    return inferMemberType(this.host, objectType, property, table, mode, info, span, binding);
  }

  /** Look up the type of a single field by name on a class type. */
  private lookupFieldType(
    objectType: ResolvedType,
    fieldName: string,
    table: ModuleSymbolTable,
  ): ResolvedType {
    return lookupFieldType(this.host, objectType, fieldName, table);
  }

  /**
   * Extract field types in declaration order (flattening multi-name fields)
   * for positional destructuring.
   */
  private getPositionalFieldTypes(
    type: ResolvedType,
    table: ModuleSymbolTable,
  ): ResolvedType[] {
    return getPositionalFieldTypes(this.host, type, table);
  }

  // --------------------------------------------------------------------------
  // Scope lookup helpers
  // --------------------------------------------------------------------------

  private lookupBinding(name: string, scope: Scope): Binding | null {
    let current: Scope | null = scope;
    while (current) {
      const binding = current.bindings.get(name);
      if (binding) return binding;
      current = current.parent;
    }
    return null;
  }

  private findThisType(scope: Scope): ResolvedType | null {
    let current: Scope | null = scope;
    while (current) {
      if (current.thisType) return current.thisType;
      current = current.parent;
    }
    return null;
  }

  /**
   * Check whether a block always exits its scope via return, break, or continue.
   * Intentionally simple — no full CFG. Covers the common guard-clause patterns.
   */
  private blockAlwaysExits(block: Block): boolean {
    if (block.statements.length === 0) return false;
    const last = block.statements[block.statements.length - 1];
    switch (last.kind) {
      case "return-statement":
      case "break-statement":
      case "continue-statement":
        return true;
      case "expression-statement":
        return this.expressionAlwaysExits(last.expression);
      case "case-statement": {
        const hasWildcardArm = last.arms.some((arm) => arm.patterns.some((pattern) => pattern.kind === "wildcard-pattern"));
        if (!hasWildcardArm) return false;
        return last.arms.every((arm) => arm.body.kind === "block" && this.blockAlwaysExits(arm.body));
      }
      case "if-statement":
        if (!last.else_) return false;
        // All branches (body, elseIfs, else_) must exit
        if (!this.blockAlwaysExits(last.body)) return false;
        for (const elseIf of last.elseIfs) {
          if (!this.blockAlwaysExits(elseIf.body)) return false;
        }
        return this.blockAlwaysExits(last.else_);
      default:
        return false;
    }
  }

  private expressionAlwaysExits(expression: import("./ast.js").Expression): boolean {
    if (expression.kind !== "call-expression") return false;
    if (expression.callee.kind !== "identifier") return false;
    return expression.callee.name === "panic"
      && expression.callee.resolvedBinding?.module === "<builtin>";
  }

  private blockAlwaysYields(block: Block): boolean {
    if (block.statements.length === 0) return false;
    const last = block.statements[block.statements.length - 1];
    switch (last.kind) {
      case "yield-statement":
        return true;
      case "case-statement": {
        const hasWildcardArm = last.arms.some((arm) => arm.patterns.some((pattern) => pattern.kind === "wildcard-pattern"));
        if (!hasWildcardArm) return false;
        return last.arms.every((arm) => arm.body.kind === "block" && this.blockAlwaysYields(arm.body));
      }
      case "if-statement":
        if (!last.else_) return false;
        if (!this.blockAlwaysYields(last.body)) return false;
        for (const elseIf of last.elseIfs) {
          if (!this.blockAlwaysYields(elseIf.body)) return false;
        }
        return this.blockAlwaysYields(last.else_);
      default:
        return false;
    }
  }

  /**
   * Build a child scope for a case arm that matches on a Result type.
   * Binds the pattern name to a success-wrapper or failure-wrapper type so
   * that `.value` / `.error` member access works in the arm body.
   */
  private buildResultArmScope(
    arm: import("./ast.js").CaseArm,
    subjectType: import("./checker-types.js").ResultResolvedType,
    parentScope: Scope,
  ): Scope {
    return buildResultArmScope(this.host, arm, subjectType, parentScope);
  }

  /**
   * Check a `catch` expression: walk the body collecting error types from
   * `try` statements, and return the union of those error types plus null.
   */
  private checkCatchExpression(
    expr: import("./ast.js").CatchExpression,
    scope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): ResolvedType {
    return checkCatchExpression(this.host, expr, scope, table, info);
  }

  /** Walk scope chain to find the expected return type of the enclosing function/method. */
  private findReturnType(scope: Scope): ResolvedType | null {
    let current: Scope | null = scope;
    while (current) {
      if (current.returnType !== null && current.returnType !== undefined) return current.returnType;
      if (current.kind === "function" || current.kind === "method") return null;
      current = current.parent;
    }
    return null;
  }

  /**
   * Check a `try` statement: validate the inner binding, verify the RHS is a
   * Result<T, E>, verify the enclosing function returns a compatible
   * Result<_, E>, and re-type the bound variable(s) with T instead of
   * Result<T, E>.
   */
  private checkTryStatement(
    binding: TryBinding,
    scope: Scope,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
    span: SourceSpan,
  ): void {
    return checkTryStatement(this.host, binding, scope, table, info, span);
  }

  /** Extract the value expression from a TryBinding node. */
  private getTryBindingValue(binding: TryBinding): Expression | null {
    return getTryBindingValue(binding);
  }

  /**
   * After validating a try statement, re-type bound variables from
   * Result<T, E> to T (the success type).
   */
  private retypeTryBinding(
    binding: TryBinding,
    successType: ResolvedType,
    scope: Scope,
    table: ModuleSymbolTable,
  ): void {
    return retypeTryBinding(this.host, binding, successType, scope, table);
  }

  /** Validate that a condition expression evaluates to bool. */
  private checkConditionIsBool(
    condType: ResolvedType,
    expr: Expression,
    table: ModuleSymbolTable,
    info: ModuleTypeInfo,
  ): void {
    if (
      condType.kind !== "unknown" &&
      !(condType.kind === "primitive" && condType.name === "bool")
    ) {
      info.diagnostics.push({
        severity: "error",
        message: `Condition must be of type "bool" but got "${typeToString(condType)}"`,
        span: expr.span,
        module: table.path,
      });
    }
  }

}
