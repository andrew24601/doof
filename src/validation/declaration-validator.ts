import { isEnumMemberExpression, propagateTypeContext, validateExpression } from "./expression-validator";
import { validateFunctionBody, validateStatement } from "./statement-validator";
import { addTypeCompatibilityError, createClassType, createEnumType, createExternClassType, createFunctionType, createPrimitiveType, createUnknownType, createVoidType, isConstantLiteral, isStrictLiteral, isTypeCompatible, isValidParameterDefault, resolveActualType, typeToString, validateType, validateUniqueFieldNames, isImmutableType } from "../type-utils";
import { FunctionDeclaration, FunctionTypeNode, PrimitiveTypeNode, ClassDeclaration, ExternClassDeclaration, Parameter, ClassTypeNode, FieldDeclaration, MethodDeclaration, ExportDeclaration, Identifier, Type, BlockStatement, IfStatement, Program, Statement, GlobalValidationContext, ExportedSymbol, TypeSymbolTable, ConstructorDeclaration, ScopeTrackerEntry, ArrayTypeNode, SetTypeNode, MapTypeNode } from "../types";
import { Validator } from "./validator";
import { createScopeTrackerEntry, registerScopeTrackerEntry } from "./scope-tracker-helpers";

/**
 * Recursively propagate readonly to nested collection types.
 * This ensures `readonly int[][]` marks both the outer and inner arrays as readonly.
 */
function propagateReadonlyToNestedCollections(type: Type): void {
  if (type.kind === 'array') {
    (type as ArrayTypeNode).isReadonly = true;
    propagateReadonlyToNestedCollections((type as ArrayTypeNode).elementType);
  } else if (type.kind === 'map') {
    (type as MapTypeNode).isReadonly = true;
    propagateReadonlyToNestedCollections((type as MapTypeNode).valueType);
  } else if (type.kind === 'set') {
    (type as SetTypeNode).isReadonly = true;
    propagateReadonlyToNestedCollections((type as SetTypeNode).elementType);
  }
}

// Inline fluent interface detection to avoid async import issues
function classUsesThisAsValue(classDecl: any): boolean {
  if (!classDecl) return false;

  // Check both 'methods' and 'members' fields for compatibility
  const methods = classDecl.methods || classDecl.members || [];

  for (const method of methods) {
    if (method.kind === 'method' && hasThisAsValue(method)) {
      return true;
    }
  }
  return false;
}

function hasThisAsValue(method: any): boolean {
  if (method.body && method.body.body) {
    for (const stmt of method.body.body) {
      if (containsThisAsValue(stmt)) {
        return true;
      }
    }
  }
  return false;
}

function containsThisAsValue(node: any): boolean {
  if (!node) return false;

  if (node.kind === 'return' && node.value?.kind === 'this') {
    return true;
  }

  if (node.kind === 'call' && node.arguments) {
    for (const arg of node.arguments) {
      if (arg.kind === 'identifier' && arg.name === 'this') {
        return true;
      }
    }
  }

  // Check expression statements that contain calls
  if (node.kind === 'expression' && node.expression) {
    return containsThisAsValue(node.expression);
  }

  // Recursively check child nodes
  for (const key in node) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (containsThisAsValue(item)) {
          return true;
        }
      }
    } else if (typeof child === 'object' && child !== null) {
      if (containsThisAsValue(child)) {
        return true;
      }
    }
  }

  return false;
}

export function validateFunctionDeclaration(stmt: FunctionDeclaration, validator: Validator): void {
  // Create function type and add to symbol table
  const functionType: FunctionTypeNode = {
    kind: 'function',
    parameters: stmt.parameters.map(p => ({ name: p.name.name, type: p.type })),
    returnType: stmt.returnType || createVoidType(),
    typeParameters: stmt.typeParameters
  };

  const prevFunction = validator.context.currentFunction;
  validator.context.currentFunction = stmt;

  // Enter new scope for parameters
  const prevSymbols = new Map(validator.context.symbols);

  validator.pushTypeParameters(stmt.typeParameters);

  try {
    // Validate parameters
    for (const param of stmt.parameters) {
      validateParameter(param, validator);
      validator.context.symbols.set(param.name.name, param.type);

      if (stmt.isAsync) {
        if (!isImmutableType(param.type, validator)) {
          validator.addError(`Async function arguments must be immutable`, param.location);
        }
      }

      // Track parameters in scope tracker for lambda capture analysis
      const parameterEntry = createScopeTrackerEntry({
        name: param.name.name,
        kind: 'parameter',
        scopeName: stmt.name.name,
        location: param.location,
        type: param.type,
        isConstant: true,
        declaringClass: validator.context.currentClass?.name.name
      });
    registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, parameterEntry);
    }

    // Validate return type
    validateType(stmt.returnType, stmt.location, validator);

    // Resolve type aliases in the function type after validation
    resolveActualType(functionType, validator, stmt.location);
    validator.context.symbols.set(stmt.name.name, functionType);

    // Validate body with parameters pre-assigned
    validateFunctionBody(stmt.body, stmt.parameters.map(p => p.name.name), validator);

    // Check that all paths return a value if function is not void
    if (stmt.returnType.kind !== 'primitive' || (stmt.returnType as PrimitiveTypeNode).type !== 'void') {
      if (!allPathsReturn(stmt.body)) {
        validator.addError(`Function '${stmt.name.name}' not all code paths return a value`, stmt.location);
      }
    }
  } finally {
    // Restore scope
    validator.context.symbols = prevSymbols;
    validator.context.currentFunction = prevFunction;
    validator.popTypeParameters();
  }
}

export function validateClassDeclaration(stmt: ClassDeclaration, validator: Validator): void {
  const prevClass = validator.context.currentClass;
  validator.context.currentClass = stmt;

  validator.pushTypeParameters(stmt.typeParameters);

  try {
    // Validate fields
    validateUniqueFieldNames(stmt.fields, 'class', stmt.name.name, validator);
    for (const field of stmt.fields) {
      // If class is readonly, fields are implicitly readonly
      if (stmt.isReadonly && !field.isStatic) {
          field.isReadonly = true;
      }
      validateFieldDeclaration(field, validator);

      // If class is readonly, fields must be immutable
      if (stmt.isReadonly && !field.isStatic) {
          if (!isImmutableType(field.type, validator)) {
              validator.addError(`Readonly class field '${field.name.name}' must have an immutable type`, field.location);
          }
      }
    }

    // Validate private field initialization rules
    validatePrivateFieldInitialization(stmt, validator);

    // Validate methods
    const methodNames = new Set<string>();
    for (const method of stmt.methods) {
      if (methodNames.has(method.name.name)) {
        validator.addError(`Duplicate method '${method.name.name}' in class '${stmt.name.name}'`, method.location);
      }
      methodNames.add(method.name.name);
      // Default return type to void if not specified
      if (!method.returnType) {
        method.returnType = createVoidType();
      }
      validateMethodDeclaration(method, validator);
    }

    // Validate that all const fields have default values
    const constFieldsWithoutDefaults = stmt.fields.filter(f => f.isConst && !f.isStatic && !f.defaultValue);
    if (constFieldsWithoutDefaults.length > 0) {
      for (const field of constFieldsWithoutDefaults) {
        validator.addError(`Const field '${field.name.name}' must have a default value`, field.location);
      }
    }
  } finally {
    validator.popTypeParameters();
    validator.context.currentClass = prevClass;
  }
}

export function validateExternClassDeclaration(stmt: ExternClassDeclaration, validator: Validator): void {
  // Register extern class in context
  validator.context.externClasses.set(stmt.name.name, stmt);

  // Validate header if present
  if (stmt.header !== undefined) {
    if (stmt.header.trim() === '') {
      validator.addError(`Extern class '${stmt.name.name}' has empty cpp header path`, stmt.location);
    }
  }

  // Validate jsModule if present
  if (stmt.jsModule !== undefined) {
    if (stmt.jsModule.trim() === '') {
      validator.addError(`Extern class '${stmt.name.name}' has empty jsModule path`, stmt.location);
    }
  }

  // Validate fields - only public fields allowed in extern classes
  validateUniqueFieldNames(stmt.fields, 'extern class', stmt.name.name, validator);
  for (const field of stmt.fields) {
    if (!field.isPublic) {
      validator.addError(`Private fields not allowed in extern class '${stmt.name.name}'`, field.location);
    }
    if (field.defaultValue) {
      validator.addError(`Default values not allowed for extern class fields in '${stmt.name.name}'`, field.location);
    }
    validateFieldDeclaration(field, validator);
  }

  // Validate methods
  const methodNames = new Set<string>();
  for (const method of stmt.methods) {
    if (methodNames.has(method.name.name)) {
      validator.addError(`Duplicate method '${method.name.name}' in extern class '${stmt.name.name}'`, method.location);
    }
    methodNames.add(method.name.name);

    // Default return type to void if not specified
    if (!method.returnType) {
      method.returnType = createVoidType();
    }

    // Validate that methods have no body (extern classes are opaque)
    if (method.body.body.length > 0) {
      validator.addError(`Method '${method.name.name}' in extern class '${stmt.name.name}' cannot have a body`, method.location);
    }
  }
}

export function validateParameter(param: Parameter, validator: Validator): void {
  validateType(param.type, param.location, validator);

  // Validate default value if present
  if (param.defaultValue) {
    if (!isValidParameterDefault(param.defaultValue, validator)) {
      validator.addError(`Parameter default values must be strict literals (number, string, boolean, or enum value)`, param.defaultValue.location);
    } else {
      // Propagate type context for enum shorthand and other type inference
      propagateTypeContext(param.defaultValue, param.type, validator);

      // Type check the default value against the parameter type
      const defaultType = validateExpression(param.defaultValue, validator);
      if (!isTypeCompatible(defaultType, param.type, validator)) {
        validator.addError(`Parameter default value type '${typeToString(defaultType)}' is not compatible with parameter type '${typeToString(param.type)}'`, param.defaultValue.location);
      }
    }
  }
}

export function validateMethodDeclaration(method: MethodDeclaration, validator: Validator): void {
  const prevFunction = validator.context.currentFunction;
  const prevMethod = validator.context.currentMethod;
  const prevSymbols = new Map(validator.context.symbols);

  // Set current method and function context
  validator.context.currentMethod = method;
  validator.context.currentFunction = {
    kind: 'function',
    name: method.name,
    parameters: method.parameters,
    returnType: method.returnType,
    body: method.body,
    location: method.location
  } as FunctionDeclaration;

  // Push type parameters for generic methods
  validator.pushTypeParameters(method.typeParameters);

  try {
    // Add 'this' to scope if not static
    if (!method.isStatic && validator.context.currentClass) {
      let thisType: Type;
      // Check if this class will need enable_shared_from_this (fluent interface)
      const isFluentInterface = classUsesThisAsValue(validator.context.currentClass);

      if (isFluentInterface) {
        // For fluent interface classes, 'this' should be treated as shared_ptr<Class> for type compatibility
        thisType = {
          kind: 'class',
          name: validator.context.currentClass.name.name,
          isSharedPtr: true // Add a marker to indicate this is a shared_ptr context
        } as any; // Cast as any since we're extending the type
      } else {
        // Regular class type
        thisType = {
          kind: 'class',
          name: validator.context.currentClass.name.name
        };
      }
      validator.context.symbols.set('this', thisType);
    }

    // Validate parameters
    for (const param of method.parameters) {
      validateParameter(param, validator);
      validator.context.symbols.set(param.name.name, param.type);

      // Track parameters in scope tracker for lambda capture analysis
      const scopeName = validator.context.currentClass
        ? `${validator.context.currentClass.name.name}.${method.name.name}`
        : method.name.name;
      const parameterEntry = createScopeTrackerEntry({
        name: param.name.name,
        kind: 'parameter',
        scopeName,
        location: param.location,
        type: param.type,
        isConstant: true,
        declaringClass: validator.context.currentClass?.name.name
      });
    registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, parameterEntry);
    }

    // Validate return type
    validateType(method.returnType, method.location, validator);

    // Validate body with parameter pre-assignment
    validateFunctionBody(method.body, method.parameters.map(p => p.name.name), validator);

    // Check return paths
    if (method.returnType.kind !== 'primitive' || (method.returnType as PrimitiveTypeNode).type !== 'void') {
      if (!allPathsReturn(method.body)) {
        validator.addError(`Method '${method.name.name}' not all code paths return a value`, method.location);
      }
    }
  } finally {
    validator.context.symbols = prevSymbols;
    validator.context.currentFunction = prevFunction;
    validator.context.currentMethod = prevMethod;
    validator.popTypeParameters();
  }
}


export function validateFieldDeclaration(field: FieldDeclaration, validator: Validator): void {
  // Validate const/readonly rules
  if (field.isConst && field.isReadonly) {
    validator.addError(`Field cannot be both 'const' and 'readonly'`, field.location);
    return;
  }

  // Deep readonly enforcement for fields
  if (field.isReadonly) {
      if (field.type.kind === 'array' || field.type.kind === 'map' || field.type.kind === 'set' || field.type.kind === 'class') {
          (field.type as any).isReadonly = true;
      }
      
      // Propagate readonly to nested collections for deep immutability
      propagateReadonlyToNestedCollections(field.type);
      
      if (field.type.kind === 'array') {
          const arrayType = field.type as ArrayTypeNode;
          if (!isImmutableType(arrayType.elementType, validator)) {
              validator.addError(`Readonly field array must contain immutable elements`, field.location);
          }
      } else if (field.type.kind === 'set') {
          const setType = field.type as SetTypeNode;
          if (!isImmutableType(setType.elementType, validator)) {
              validator.addError(`Readonly field set must contain immutable elements`, field.location);
          }
      } else if (field.type.kind === 'map') {
          const mapType = field.type as MapTypeNode;
          if (!isImmutableType(mapType.valueType, validator)) {
              validator.addError(`Readonly field map must contain immutable values`, field.location);
          }
      }
  }

  // Const fields validation depends on context
  if (field.isConst && !field.defaultValue) {
    // In structs, const fields without defaults are allowed (aggregate initialization)
    // In classes, const fields without defaults require a default value
    if (validator.context.currentClass) {
      validator.addError(`Const field '${field.name.name}' must have a default value`, field.location);
    }
  }

  // Handle type inference for fields with default values but no explicit type
  if (field.type.kind === 'unknown' && field.defaultValue) {
    // Infer type from initializer for any field with a default value
    if (field.isConst) {
      // For const fields, be more restrictive about what can be used as initializers
      if (!isStrictLiteral(field.defaultValue) && !isEnumMemberExpression(field.defaultValue, validator)) {
        validator.addError(`Const field without explicit type must be initialized with a strict literal (number, string, boolean) or enum value`, field.location);
        field.type = createUnknownType();
      } else {
        // Infer the type from the initializer
        const inferredType = validateExpression(field.defaultValue, validator);
        field.type = inferredType;
      }
    } else {
      // For non-const fields, infer type from any valid default value
      const inferredType = validateExpression(field.defaultValue, validator);
      field.type = inferredType;
    }
  } else {
    validateType(field.type, field.location, validator);
  }

  if (field.defaultValue) {
    // Propagate type context for enum shorthand and other type inference
    propagateTypeContext(field.defaultValue, field.type, validator);

    const defaultType = validateExpression(field.defaultValue, validator);
    if (!isTypeCompatible(defaultType, field.type, validator)) {
      addTypeCompatibilityError(defaultType, field.type, field.location, 'use as default value', validator);
    }

    // Check that default value is a constant literal or enum member for const fields
    if (field.isConst) {
      if (!isStrictLiteral(field.defaultValue) && !isEnumMemberExpression(field.defaultValue, validator)) {
        validator.addError(`Const field default values must be strict literals (number, string, boolean, or enum value)`, field.location);
      }
    } else {
      // For non-const fields, use the existing constant literal check
      if (!isConstantLiteral(field.defaultValue, validator)) {
        validator.addError(`Field default values must be constant literals`, field.location);
      }
    }
  }

  // Validate const field rules
  if (field.isConst) {
    // Static const fields must have default values
    if (field.isStatic && !field.defaultValue) {
      validator.addError(`Static const fields must have a default value`, field.location);
    }

    // Check collections and objects are not used for const fields (discourage mutation)
    if (field.type.kind === 'array' || field.type.kind === 'map' || field.type.kind === 'set') {
      validator.addError(`Const fields cannot be collections (deep immutability is not enforced, but mutation is discouraged)`, field.location);
    }
  }
}

export function validateExportDeclaration(stmt: ExportDeclaration, validator: Validator): void {
  validateStatement(stmt.declaration, validator);
}

export function validateIdentifier(expr: Identifier, validator: Validator): Type {
  // Initialize scope info
  expr.scopeInfo = {
    isParameter: false,
    isLocalVariable: false,
    isClassMember: false,
    isStaticMember: false,
    isGlobalFunction: false,
    isImported: false,
    needsThisPrefix: false,
    scopeKind: undefined,
    scopeId: undefined,
    declarationScope: undefined
  };

  // First check local scope (parameters, local variables)
  let type = validator.context.symbols.get(expr.name);
  if (type) {
    const isParameter = isIdentifierParameter(expr.name, validator);
    const scopeTracker = validator.context.codeGenHints.scopeTracker;
    const currentScopeName = getCurrentScopeName(validator);
    const lambdaName = validator.getCurrentLambdaName();
    const captureScopeName = validator.getCurrentLambdaScopeName();

    const searchScopes: string[] = [currentScopeName];
    if (currentScopeName !== 'global') {
      searchScopes.push('global');
    }

    if (lambdaName && !searchScopes.includes(lambdaName)) {
      searchScopes.push(lambdaName);
    }

    if (!isParameter && captureScopeName && !searchScopes.includes(captureScopeName)) {
      searchScopes.push(captureScopeName);
    }

    let matchedEntry: ScopeTrackerEntry | undefined;
    for (const entry of scopeTracker.values()) {
      if (entry.name !== expr.name) {
        continue;
      }
      if (searchScopes.includes(entry.declarationScope)) {
        matchedEntry = entry;
        break;
      }
    }

    const inInstanceMethod = !!(validator.context.currentClass && validator.context.currentMethod && !validator.context.currentMethod.isStatic);
    if (!matchedEntry && !isParameter && inInstanceMethod) {
      const activeClass = validator.context.currentClass!;
      const fieldDecl = activeClass.fields.find((field) => field.name.name === expr.name);
      if (fieldDecl) {
        expr.resolvedMember = {
          kind: 'field',
          className: activeClass.name.name,
          memberName: expr.name
        };
        expr.scopeInfo.isClassMember = true;
        expr.scopeInfo.isStaticMember = fieldDecl.isStatic;
        expr.scopeInfo.needsThisPrefix = !fieldDecl.isStatic;
        expr.scopeInfo.declaringClass = activeClass.name.name;

        const resolvedType = type;
        expr.inferredType = resolvedType;

        const fieldEntry = createScopeTrackerEntry({
          name: expr.name,
          kind: 'field',
          scopeName: activeClass.name.name,
          location: expr.location,
          type: resolvedType,
          isConstant: fieldDecl.isConst || false,
          declaringClass: activeClass.name.name
        });
  registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, fieldEntry);
        expr.scopeInfo.scopeId = fieldEntry.scopeId;
        expr.scopeInfo.declarationScope = fieldEntry.declarationScope;
        expr.scopeInfo.scopeKind = fieldEntry.kind;

        return resolvedType;
      }

      const methodDecl = activeClass.methods.find((method) => method.name.name === expr.name);
      if (methodDecl) {
        expr.resolvedMember = {
          kind: 'method',
          className: activeClass.name.name,
          memberName: expr.name
        };
        expr.scopeInfo.isClassMember = true;
        expr.scopeInfo.isStaticMember = methodDecl.isStatic;
        expr.scopeInfo.needsThisPrefix = !methodDecl.isStatic;
        expr.scopeInfo.declaringClass = activeClass.name.name;

        const methodEntry = createScopeTrackerEntry({
          name: expr.name,
          kind: 'method',
          scopeName: activeClass.name.name,
          location: expr.location,
          isConstant: true,
          declaringClass: activeClass.name.name
        });
  registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, methodEntry);
        expr.scopeInfo.scopeId = methodEntry.scopeId;
        expr.scopeInfo.declarationScope = methodEntry.declarationScope;
        expr.scopeInfo.scopeKind = methodEntry.kind;

        const methodType: FunctionTypeNode = {
          kind: 'function',
          parameters: methodDecl.parameters.map((p) => ({ name: p.name.name, type: p.type })),
          returnType: methodDecl.returnType
        };
        expr.inferredType = methodType;
        return methodType;
      }
    }

    expr.inferredType = type;
    expr.scopeInfo.isParameter = isParameter;
    expr.scopeInfo.isLocalVariable = !isParameter;

    if (!matchedEntry) {
      const declarationScope = isParameter ? getParameterScopeName(validator) : currentScopeName;
      matchedEntry = createScopeTrackerEntry({
        name: expr.name,
        kind: isParameter ? 'parameter' : 'local',
        scopeName: declarationScope,
        location: expr.location,
        type,
        isConstant: isParameter,
        declaringClass: validator.context.currentClass?.name.name
      });
  registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, matchedEntry);
    }

    expr.scopeInfo.scopeId = matchedEntry.scopeId;
    expr.scopeInfo.declarationScope = matchedEntry.declarationScope;
    expr.scopeInfo.scopeKind = matchedEntry.kind;
    expr.scopeInfo.isConstant = matchedEntry.isConstant;

    if (validator.context.currentFunction?.isAsync) {
      if (matchedEntry.kind === 'local' && matchedEntry.declarationScope === 'global' && !matchedEntry.isConstant) {
        validator.addError(`Async functions cannot access global variables`, expr.location);
      }
    }

    if (type.kind === 'externClass') {
      const externName = (type as any).name || expr.name;
      if (externName !== 'StringBuilder') {
        validator.context.codeGenHints.externDependencies.add(externName);
      }
    }

    return type;
  }

  // If not found in local scope and we're in a class method context,
  // check for member fields and methods (but only for non-static methods)
  if (validator.context.currentClass && validator.context.currentMethod &&
    !validator.context.currentMethod.isStatic) {

    // Check for member fields
    for (const field of validator.context.currentClass.fields) {
      if (field.name.name === expr.name) {
        // Found a member field - record resolution information
        expr.resolvedMember = {
          kind: 'field',
          className: validator.context.currentClass.name.name,
          memberName: expr.name
        };
        expr.scopeInfo.isClassMember = true;
        expr.scopeInfo.isStaticMember = field.isStatic;
        expr.scopeInfo.needsThisPrefix = !field.isStatic;
        expr.scopeInfo.declaringClass = validator.context.currentClass.name.name;

        // Store scope information
        const fieldEntry = createScopeTrackerEntry({
          name: expr.name,
          kind: 'field',
          scopeName: validator.context.currentClass.name.name,
          location: expr.location,
          type: field.type,
          isConstant: field.isConst || false,
          declaringClass: validator.context.currentClass.name.name
        });
  registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, fieldEntry);
        expr.scopeInfo.scopeId = fieldEntry.scopeId;
        expr.scopeInfo.declarationScope = fieldEntry.declarationScope;
        expr.scopeInfo.scopeKind = fieldEntry.kind;

        expr.inferredType = field.type;
        return field.type;
      }
    }

    // Check for member methods
    for (const method of validator.context.currentClass.methods) {
      if (method.name.name === expr.name) {
        // Found a member method - record resolution information
        expr.resolvedMember = {
          kind: 'method',
          className: validator.context.currentClass.name.name,
          memberName: expr.name
        };
        expr.scopeInfo.isClassMember = true;
        expr.scopeInfo.isStaticMember = method.isStatic;
        expr.scopeInfo.needsThisPrefix = !method.isStatic;
        expr.scopeInfo.declaringClass = validator.context.currentClass.name.name;

        // Store scope information
        const methodEntry = createScopeTrackerEntry({
          name: expr.name,
          kind: 'method',
          scopeName: validator.context.currentClass.name.name,
          location: expr.location,
          isConstant: true,
          declaringClass: validator.context.currentClass.name.name
        });
  registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, methodEntry);
        expr.scopeInfo.scopeId = methodEntry.scopeId;
        expr.scopeInfo.declarationScope = methodEntry.declarationScope;
        expr.scopeInfo.scopeKind = methodEntry.kind;

        // Create function type for method
        const methodType: FunctionTypeNode = {
          kind: 'function',
          parameters: method.parameters.map(p => ({ name: p.name.name, type: p.type })),
          returnType: method.returnType
        };
        expr.inferredType = methodType;
        return methodType;
      }
    }
  }

  // Check global functions
  const funcDecl = validator.context.functions.get(expr.name);
  if (funcDecl) {
    expr.scopeInfo.isGlobalFunction = true;

    const funcType = createFunctionType(
      funcDecl.parameters.map(p => ({ name: p.name.name, type: p.type })),
      funcDecl.returnType
    );

    // Store scope information
    const globalEntry = createScopeTrackerEntry({
      name: expr.name,
      kind: 'global',
      scopeName: 'global',
      location: expr.location,
      type: funcType,
      isConstant: true
    });
  registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, globalEntry);
    expr.scopeInfo.scopeId = globalEntry.scopeId;
    expr.scopeInfo.declarationScope = globalEntry.declarationScope;
    expr.scopeInfo.scopeKind = globalEntry.kind;

    expr.inferredType = funcType;
    return funcType;
  }

  // Check imported symbols
  const importInfo = validator.context.imports.get(expr.name);
  if (importInfo) {
    expr.scopeInfo.isImported = true;

    const globalSymbol = validator.context.globalSymbols.get(importInfo.fullyQualifiedName);

    // Store scope information
    const importEntry = createScopeTrackerEntry({
      name: expr.name,
      kind: 'import',
      scopeName: importInfo.sourceModule,
      location: expr.location,
      type: globalSymbol?.signature,
      isConstant: true
    });
  registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, importEntry);
    expr.scopeInfo.scopeId = importEntry.scopeId;
    expr.scopeInfo.declarationScope = importEntry.declarationScope;
    expr.scopeInfo.scopeKind = importEntry.kind;

    // Look up the type from global context
    if (globalSymbol) {
      expr.inferredType = globalSymbol.signature;
      return globalSymbol.signature;
    }
  }

  // Check for builtin functions (like println)
  const builtinSymbol = validator.context.symbols.get(expr.name);
  if (builtinSymbol && builtinSymbol.kind === 'function') {
    // Initialize scopeInfo if it doesn't exist
    if (!expr.scopeInfo) {
      expr.scopeInfo = {
        isParameter: false,
        isLocalVariable: false,
        isClassMember: false,
        isStaticMember: false,
        isGlobalFunction: false,
        isImported: false,
        needsThisPrefix: false
      };
    }
    expr.scopeInfo.isGlobalFunction = true;

    // Store scope information
    const builtinEntry = createScopeTrackerEntry({
      name: expr.name,
      kind: 'global',
      scopeName: 'global',
      location: expr.location,
      type: builtinSymbol,
      isConstant: true
    });
  registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, builtinEntry);
    expr.scopeInfo.scopeId = builtinEntry.scopeId;
    expr.scopeInfo.declarationScope = builtinEntry.declarationScope;
    expr.scopeInfo.scopeKind = builtinEntry.kind;

    expr.inferredType = builtinSymbol;
    return builtinSymbol;
  }

  // Check for class or struct type names (for positional object initialization)
  const classDecl = validator.context.classes.get(expr.name);
  if (classDecl) {
    // Return a special type that indicates this is a class type name
    // This will be used in call expressions for positional object initialization
    const classType: ClassTypeNode = {
      kind: 'class',
      name: classDecl.name.name
    };
    expr.inferredType = classType;
    return classType;
  }

  // Check for extern class type names
  const externClassDecl = validator.context.externClasses.get(expr.name);
  if (externClassDecl) {
    const externName = externClassDecl.name.name;
    if (externName !== 'StringBuilder') {
      validator.context.codeGenHints.externDependencies.add(externName);
    }
    // Return a special type that indicates this is an extern class type name
    const externClassType = createExternClassType(externName);
    expr.inferredType = externClassType;
    return externClassType;
  }

  // Not found in any scope
  validator.addError(`Undefined identifier '${expr.name}'`, expr.location);
  return createUnknownType();
}

export function getCurrentScopeName(validator: Validator): string {
  if (validator.context.currentMethod) {
    return `${validator.context.currentClass?.name.name || 'unknown'}::${validator.context.currentMethod.name.name}`;
  } else if (validator.context.currentFunction) {
    return validator.context.currentFunction.name.name;
  } else if (validator.context.currentClass) {
    return validator.context.currentClass.name.name;
  } else {
    return 'global';
  }
}

function getParameterScopeName(validator: Validator): string {
  return validator.getCurrentLambdaName() ?? getCurrentScopeName(validator);
}

export function isIdentifierParameter(name: string, validator: Validator): boolean {
  if (validator.isLambdaParameter(name)) {
    return true;
  }

  const currentFunctionParams = validator.context.currentFunction?.parameters;
  if (currentFunctionParams && currentFunctionParams.some(param => param.name.name === name)) {
    return true;
  }

  const currentMethodParams = validator.context.currentMethod?.parameters;
  if (currentMethodParams && currentMethodParams.some(param => param.name.name === name)) {
    return true;
  }

  return false;
}

function allPathsReturn(block: BlockStatement): boolean {
  for (const stmt of block.body) {
    if (stmt.kind === 'return') {
      return true;
    }
    if (stmt.kind === 'if') {
      const ifStmt = stmt as IfStatement;
      if (ifStmt.elseStatement) {
        const thenReturns = statementReturns(ifStmt.thenStatement);
        const elseReturns = statementReturns(ifStmt.elseStatement);
        if (thenReturns && elseReturns) {
          return true;
        }
      }
    }
  }
  return false;
}

// Helper function to check if a statement returns on all paths
function statementReturns(stmt: Statement): boolean {
  if (stmt.kind === 'return') {
    return true;
  }
  if (stmt.kind === 'block') {
    return allPathsReturn(stmt);
  }
  if (stmt.kind === 'if') {
    const ifStmt = stmt as IfStatement;
    if (ifStmt.elseStatement) {
      const thenReturns = statementReturns(ifStmt.thenStatement);
      const elseReturns = statementReturns(ifStmt.elseStatement);
      return thenReturns && elseReturns;
    }
    return false; // if without else doesn't guarantee a return
  }
  return false;
}

function validatePrivateFieldInitialization(classDecl: ClassDeclaration, validator: Validator): void {
  const privateFields = classDecl.fields.filter(f => !f.isPublic && !f.isStatic);

  for (const field of privateFields) {
    const fieldName = field.name.name;
    const hasDefault = field.defaultValue !== undefined;

    // Private field must have a default value
    if (!hasDefault) {
      validator.addError(
        `Private field '${fieldName}' must have a default value.`,
        field.location
      );
    }
  }
}

export function collectDeclarations(validator: Validator, program: Program): void {
  // First pass: collect type declarations
  for (const stmt of program.body) {
    collectDeclaration(validator, stmt);
  }

  // Initialize the consolidated type symbol table after all declarations are collected
  initializeTypeSymbolTable(validator);

  // Second pass: populate symbol table with function signatures and class members
  for (const stmt of program.body) {
    populateSymbolTable(validator, stmt);
  }
}

function initializeTypeSymbolTable(validator: Validator): void {
  const onDuplicateError = (name: string, existing: any, duplicate: any) => {
    validator.addError(
      `Duplicate type name '${name}' detected. Type names must be unique within a module.`,
      duplicate.location
    );
  };

  validator.context.typeSymbols = new TypeSymbolTable(
    validator.context.interfaces,
    validator.context.classes,
    validator.context.enums,
    validator.context.externClasses,
    onDuplicateError
  );
}

export function collectDeclaration(validator: Validator, stmt: Statement): void {
  switch (stmt.kind) {
    case 'class':
      validator.context.classes.set(stmt.name.name, stmt);
      // Add class type to symbol table for type checking
      validator.context.symbols.set(stmt.name.name, createClassType(stmt.name.name));
      break;
    case 'externClass':
      validator.context.externClasses.set(stmt.name.name, stmt);
      // Add extern class type to symbol table for type checking
      validator.context.symbols.set(stmt.name.name, createExternClassType(stmt.name.name));
      break;
    case 'enum':
      validator.context.enums.set(stmt.name.name, stmt);
      // Add enum type to symbol table for type checking
      validator.context.symbols.set(stmt.name.name, createEnumType(stmt.name.name));
      break;
    case 'function':
      validator.context.functions.set(stmt.name.name, stmt);
      break;
    case 'export':
      collectDeclaration(validator, stmt.declaration);
      break;
    case 'interface':
      validator.context.interfaces.set(stmt.name.name, stmt);
      validator.context.symbols.set(stmt.name.name, { kind: 'typeAlias', name: stmt.name.name });
      break;
    case 'typeAlias':
      validator.context.typeAliases.set(stmt.name.name, stmt);
      validator.context.symbols.set(stmt.name.name, { kind: 'typeAlias', name: stmt.name.name });
      break;
  }
}

function populateSymbolTable(validator: Validator, stmt: Statement): void {
  switch (stmt.kind) {
    case 'function':
      const funcType = createFunctionType(
        stmt.parameters.map(p => ({ name: p.name.name, type: p.type })),
        stmt.returnType || createVoidType(),
        stmt.typeParameters
      );
      validator.context.symbols.set(stmt.name.name, funcType);
      break;
    case 'class':
      // Populate static methods in the symbol table as ClassName.methodName
      for (const method of stmt.methods) {
        if (method.isStatic) {
          const methodType = createFunctionType(
            method.parameters.map(p => ({ name: p.name.name, type: p.type })),
            method.returnType,
            method.typeParameters
          );
          // Store static methods with class prefix for member access validation
          validator.context.symbols.set(`${stmt.name.name}.${method.name.name}`, methodType);
        }
      }

      // Add auto-generated fromJSON static method
      const fromJSONType = createFunctionType(
        [{ name: 'json_str', type: createPrimitiveType('string') }],
        { kind: 'class', name: stmt.name.name, isWeak: false }
      );
      validator.context.symbols.set(`${stmt.name.name}.fromJSON`, fromJSONType);
      break;
    case 'externClass':
      // Populate static methods in the symbol table as ClassName.methodName
      for (const method of stmt.methods) {
        if (method.isStatic) {
          const methodType = createFunctionType(
            method.parameters.map(p => ({ name: p.name.name, type: p.type })),
            method.returnType,
            method.typeParameters
          );
          // Store static methods with class prefix for member access validation
          validator.context.symbols.set(`${stmt.name.name}.${method.name.name}`, methodType);
        }
      }
      break;
    case 'variable':
      if (stmt.type) {
        validator.context.symbols.set(stmt.identifier.name, stmt.type);
      }
      break;
    case 'export':
      populateSymbolTable(validator, stmt.declaration);
      break;
  }
}


export function buildGlobalSymbolTable(programs: Program[], globalContext: GlobalValidationContext): void {
  // First pass: collect all exported symbols from all modules
  const moduleExports = new Map<string, Set<string>>(); // module -> set of exported names

  for (const program of programs) {
    const moduleName = globalContext.moduleMap.get(program.filename!);
    if (!moduleName) continue;

    if (!moduleExports.has(moduleName)) {
      moduleExports.set(moduleName, new Set());
    }
    const currentModuleExports = moduleExports.get(moduleName)!;

    for (const stmt of program.body) {
      if (stmt.kind === 'export') {
        const exportedSymbol = extractExportedSymbol(stmt, moduleName);
        if (exportedSymbol) {
          // Check for duplicate exports within the same module
          if (currentModuleExports.has(exportedSymbol.name)) {
            globalContext.errors.push({
              message: `Duplicate export '${exportedSymbol.name}' already declared in module '${moduleName}'`,
              location: stmt.location
            });
          } else {
            currentModuleExports.add(exportedSymbol.name);
            globalContext.exportedSymbols.set(exportedSymbol.fullyQualifiedName, exportedSymbol);
          }
        }
      }
    }
  }
}

function extractExportedSymbol(exportDecl: ExportDeclaration, moduleName: string): ExportedSymbol | null {
  const decl = exportDecl.declaration;

  switch (decl.kind) {
    case 'function':
      return {
        name: decl.name.name,
        fullyQualifiedName: `${moduleName}::${decl.name.name}`,
        type: 'function',
        signature: createFunctionType(
          decl.parameters.map(p => ({ name: p.name.name, type: p.type })),
          decl.returnType || createVoidType(),
          decl.typeParameters
        ),
        sourceModule: moduleName
      };

    case 'class':
      return {
        name: decl.name.name,
        fullyQualifiedName: `${moduleName}::${decl.name.name}`,
        type: 'class',
        signature: createClassType(decl.name.name),
        sourceModule: moduleName
      };

    case 'externClass':
      return {
        name: decl.name.name,
        fullyQualifiedName: `${moduleName}::${decl.name.name}`,
        type: 'externClass',
        signature: createClassType(decl.name.name),
        sourceModule: moduleName
      };

    case 'enum':
      return {
        name: decl.name.name,
        fullyQualifiedName: `${moduleName}::${decl.name.name}`,
        type: 'enum',
        signature: createEnumType(decl.name.name),
        sourceModule: moduleName
      };

    case 'variable':
      if (!decl.type) return null;
      return {
        name: decl.identifier.name,
        fullyQualifiedName: `${moduleName}::${decl.identifier.name}`,
        type: 'variable',
        signature: decl.type,
        sourceModule: moduleName
      };

    default:
      return null;
  }
}

export function importGlobalSymbols(validator: Validator, globalContext: GlobalValidationContext): void {
  // Add all exported symbols to the current validation context for reference
  for (const [qualifiedName, symbol] of globalContext.exportedSymbols) {
    // Don't add symbols from the current module to avoid duplication
    if (symbol.sourceModule !== validator.context.currentModule) {
      validator.context.globalSymbols.set(qualifiedName, symbol);
    }
  }
}
