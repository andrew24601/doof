import { validateClassDeclaration, validateExportDeclaration, validateExternClassDeclaration, validateFieldDeclaration, validateFunctionDeclaration, validateMethodDeclaration } from "./declaration-validator";
import { analyzeTypeGuard, canInferObjectLiteralType, inferObjectLiteralType, propagateTypeContext, validateExpression } from "./expression-validator";
import { addTypeCompatibilityError, isBooleanType, isNonNullableType, isTypeCompatible, resolveActualType, typeToString, validateType, createPrimitiveType, requiresExplicitInitialization, isImmutableType } from "../type-utils";
import { WhileStatement, BlockStatement, ReturnStatement, PrimitiveTypeNode, IfStatement, ForStatement, VariableDeclaration, Expression, SwitchStatement, RangeExpression, EnumDeclaration, TypeAliasDeclaration, ForOfStatement, Type, ArrayTypeNode, SetTypeNode, MapTypeNode, ExpressionStatement, ObjectExpression, ClassTypeNode, GlobalValidationContext, ImportDeclaration, Program, ExportedSymbol, Statement, LambdaExpression, FunctionTypeNode, TrailingLambdaExpression, MarkdownTable, DestructuringAssignment, DestructuringVariableDeclaration } from "../types";
import { validateForOfStatement as validateIteratorForOf, IteratorTypeInfo } from "./validate-iter";
import { getExpressionId } from "../type-utils";
import { Validator } from "./validator";
import { createScopeTrackerEntry, registerScopeTrackerEntry } from "./scope-tracker-helpers";
import * as path from "path";
import { validateAndDesugarMarkdownTable } from "./validate-markdown-table";
// Inlined MVP lowering for destructuring to avoid module resolution issues
function __makeTempName(counter: number): string { return `__destr_${counter}`; }
function __createTempDeclaration(name: string, expr: Expression): VariableDeclaration {
  return { kind: 'variable', isConst: false, isReadonly: true, identifier: { kind: 'identifier', name, location: expr.location }, initializer: expr, location: expr.location } as VariableDeclaration;
}
function __createMemberAccess(objectIdent: any, field: string, loc: any): any {
  return { kind: 'member', object: objectIdent, property: { kind: 'identifier', name: field, location: loc }, computed: false, location: loc };
}
function __publicFieldNamesInOrder(classDecl: any): string[] {
  return classDecl.fields.filter((f: any) => !f.isStatic && f.isPublic).map((f: any) => f.name.name);
}
function lowerDestructuringVariable(stmt: DestructuringVariableDeclaration, validator: Validator): BlockStatement {
  const block: BlockStatement = { kind: 'block', body: [], location: stmt.location };
  const tempName = __makeTempName(validator.context.codeGenHints.callDispatch.size + (validator.context.errors.length || 0));
  const tempDecl = __createTempDeclaration(tempName, stmt.initializer);
  block.body.push(tempDecl);
  const tempIdent: any = { kind: 'identifier', name: tempName, location: stmt.initializer.location };

  if (stmt.pattern.kind === 'objectPattern') {
    for (const id of (stmt.pattern as any).names) {
      const varDecl: VariableDeclaration = { kind: 'variable', isConst: stmt.isConst, isReadonly: false, identifier: { kind: 'identifier', name: id.name, location: id.location }, initializer: __createMemberAccess(tempIdent, id.name, id.location), location: id.location } as VariableDeclaration;
      block.body.push(varDecl);
    }
    return block;
  }

  let fieldOrder: string[] = [];
  const inferred = (stmt.initializer as any).inferredType;
  if (inferred && inferred.kind === 'class') {
    const classDecl = validator.context.classes.get(inferred.name);
    if (classDecl) fieldOrder = __publicFieldNamesInOrder(classDecl);
  }
  const tuple = stmt.pattern as any;
  for (let i = 0; i < tuple.names.length; i++) {
    const target = tuple.names[i];
    const fieldName = fieldOrder[i] || `__field_${i}`;
    const varDecl: VariableDeclaration = { kind: 'variable', isConst: stmt.isConst, isReadonly: false, identifier: { kind: 'identifier', name: target.name, location: target.location }, initializer: __createMemberAccess(tempIdent, fieldName, target.location), location: target.location } as VariableDeclaration;
    block.body.push(varDecl);
  }
  return block;
}
function lowerDestructuringAssignment(stmt: DestructuringAssignment, validator: Validator): BlockStatement {
  const block: BlockStatement = { kind: 'block', body: [], location: stmt.location };
  const tempName = __makeTempName(validator.context.codeGenHints.callDispatch.size + (validator.context.errors.length || 0));
  const tempDecl = __createTempDeclaration(tempName, stmt.expression);
  block.body.push(tempDecl);
  const tempIdent: any = { kind: 'identifier', name: tempName, location: stmt.expression.location };

  if (stmt.pattern.kind === 'objectPattern') {
    for (const id of (stmt.pattern as any).names) {
      const assign: ExpressionStatement = { kind: 'expression', expression: { kind: 'binary', operator: '=', left: { kind: 'identifier', name: id.name, location: id.location } as any, right: __createMemberAccess(tempIdent, id.name, id.location), location: id.location } as any, location: id.location } as any;
      block.body.push(assign);
    }
    return block;
  }
  let fieldOrder: string[] = [];
  const inferred = (stmt.expression as any).inferredType;
  if (inferred && inferred.kind === 'class') {
    const classDecl = validator.context.classes.get(inferred.name);
    if (classDecl) fieldOrder = __publicFieldNamesInOrder(classDecl);
  }
  const tuple = stmt.pattern as any;
  for (let i = 0; i < tuple.names.length; i++) {
    const target = tuple.names[i];
    const fieldName = fieldOrder[i] || `__field_${i}`;
    const assign: ExpressionStatement = { kind: 'expression', expression: { kind: 'binary', operator: '=', left: { kind: 'identifier', name: target.name, location: target.location } as any, right: __createMemberAccess(tempIdent, fieldName, target.location), location: target.location } as any, location: target.location } as any;
    block.body.push(assign);
  }
  return block;
}

export function validateProgram(validator: Validator, program: Program): void {
  for (const stmt of program.body) {
    if (stmt.kind === 'blank') {
      continue;
    }
    // Only allow declarations at the top level unless allowTopLevelStatements is enabled
    if (!validator.allowTopLevelStatements) {
      if (!isTopLevelDeclaration(stmt)) {
        validator.addError(
          `Top-level executable statements are not allowed. Only declarations (functions, classes, enums, type aliases, variables) are permitted at the root level.`,
          stmt.location
        );
      }
    }
    validateStatement(stmt, validator);
  }
}

export function validateStatement(stmt: Statement, validator: Validator): void {
  switch (stmt.kind) {
    case 'blank':
      return; // No validation needed for blank statements
    case 'variable':
      validateVariableDeclaration(stmt, validator);
      break;
    case 'function':
      // Check if function is declared inside another function or class
      if (validator.context.currentFunction || validator.context.currentClass) {
        validator.addError('Functions cannot be declared inside other functions or classes', stmt.location);
      }
      validateFunctionDeclaration(stmt, validator);
      break;
    case 'class':
      // Check if class is declared inside a function or another class
      if (validator.context.currentFunction || validator.context.currentClass) {
        validator.addError('Classes cannot be declared inside functions or other classes', stmt.location);
      }
      validateClassDeclaration(stmt, validator);
      break;
    case 'externClass':
      validateExternClassDeclaration(stmt, validator);
      break;
    case 'enum':
      validateEnumDeclaration(stmt, validator);
      break;
    case 'typeAlias':
      validateTypeAliasDeclaration(stmt, validator);
      break;
    case 'if':
      validateIfStatement(stmt, validator);
      break;
    case 'while':
      validateWhileStatement(stmt, validator);
      break;
    case 'for':
      validateForStatement(stmt, validator);
      break;
    case 'forOf':
      validateForOfStatement(stmt, validator);
      break;
    case 'switch':
      validateSwitchStatement(stmt, validator);
      break;
    case 'return':
      validateReturnStatement(stmt, validator);
      break;
    case 'block':
      validateBlockStatement(stmt, validator);
      break;
    case 'expression':
      validateExpressionStatement(stmt, validator);
      break;
    case 'destructuringVariable': {
      // Validate initializer first to populate inferredType context for lowering
      const d = stmt as DestructuringVariableDeclaration;
      if (d.initializer) {
        validateExpression(d.initializer, validator);
      }
      const lowered = lowerDestructuringVariable(d, validator);
      // Mutate node to block for downstream codegen, but validate statements in current scope
      const asAny = stmt as any;
      asAny.kind = 'block';
      asAny.body = lowered.body;
      for (const s of lowered.body) {
        validateStatement(s, validator);
      }
      break;
    }
    case 'destructuringAssign': {
      // Validate RHS first to populate inferredType context for lowering
      const d = stmt as DestructuringAssignment;
      validateExpression(d.expression, validator);
      const lowered = lowerDestructuringAssignment(d, validator);
      const asAny = stmt as any;
      asAny.kind = 'block';
      asAny.body = lowered.body;
      for (const s of lowered.body) {
        validateStatement(s, validator);
      }
      break;
    }
    case 'import':
      // Skip import validation if we're in multi-file mode with global context
      // Imports have already been processed in resolveImports()
      if (!validator.context.globalContext) {
        validateImportDeclaration(stmt, null, validator, stmt.location.filename);
      }
      break;
    case 'export':
      validateExportDeclaration(stmt, validator);
      break;
    case 'break':
      validateBreakStatement(stmt, validator);
      break;
    case 'continue':
      validateContinueStatement(stmt, validator);
      break;
    case 'markdownHeader':
      // Markdown headers are allowed and do not affect validation state
      break;
    case 'markdownTable': {
      const table = stmt as MarkdownTable;
      const block = validateAndDesugarMarkdownTable(table, validator);

      // Replace the markdown table node in-place with the generated block
      for (const key of Object.keys(table)) {
        if (!(key in block)) {
          delete (table as any)[key];
        }
      }
      Object.assign(table, block);

      validateBlockStatement(table as unknown as BlockStatement, validator);
      break;
    }
    default:
      validator.addError(`Unknown statement kind: ${(stmt as any).kind}`, stmt.location);
  }
}
export function validateWhileStatement(stmt: WhileStatement, validator: Validator): void {
  const conditionType = validateExpression(stmt.condition, validator);
  if (!isBooleanType(conditionType)) {
    validator.addError(`While condition must be of type 'bool'`, stmt.condition.location);
  }

  const wasInLoop = validator.context.inLoop;
  validator.context.inLoop = true;
  validateStatement(stmt.body, validator);
  validator.context.inLoop = wasInLoop;
}



export function validateBlockStatement(stmt: BlockStatement, validator: Validator): void {
  const prevSymbols = new Map(validator.context.symbols);

  // Build a new body with destructuring statements flattened into sibling statements
  const newBody: any[] = [];

  for (const statement of stmt.body) {
    if (statement.kind === 'destructuringVariable') {
      const d = statement as DestructuringVariableDeclaration;
      if (d.initializer) {
        validateExpression(d.initializer, validator);
      }
      const lowered = lowerDestructuringVariable(d, validator);
      for (const s of lowered.body) {
        validateStatement(s, validator);
        newBody.push(s);
      }
      continue;
    }
    if (statement.kind === 'destructuringAssign') {
      const d = statement as DestructuringAssignment;
      validateExpression(d.expression, validator);
      const lowered = lowerDestructuringAssignment(d, validator);
      for (const s of lowered.body) {
        validateStatement(s, validator);
        newBody.push(s);
      }
      continue;
    }

    // Default: validate and keep the statement
    validateStatement(statement, validator);
    newBody.push(statement);
  }

  // Replace body with flattened version for downstream phases (codegen, DA analysis)
  (stmt as any).body = newBody;

  // Only check definite assignment if we're not already in function validation
  // (to avoid duplicate analysis - functions handle this via validateFunctionBody)
  if (!validator.inFunctionValidation) {
    checkDefiniteAssignmentInBlock(validator, stmt);
  }

  validator.context.symbols = prevSymbols;
}

export function validateReturnStatement(stmt: ReturnStatement, validator: Validator): void {
  if (!validator.context.currentFunction) {
    validator.addError(`Return statement outside of function`, stmt.location);
    return;
  }

  const expectedReturnType = validator.context.currentFunction.returnType;

  if (stmt.argument) {
    // Propagate expected return type to the return expression
    propagateTypeContext(stmt.argument, expectedReturnType, validator);

    const returnType = validateExpression(stmt.argument, validator);

    // Resolve type aliases before compatibility check
    resolveActualType(returnType, validator, stmt.location);
    resolveActualType(expectedReturnType, validator, stmt.location);

    if (!isTypeCompatible(returnType, expectedReturnType, validator)) {
      validator.addError(
        `Cannot return type '${typeToString(returnType)}' from function expecting '${typeToString(expectedReturnType)}'`,
        stmt.location
      );
    }
  } else {
    if (expectedReturnType.kind !== 'primitive' || (expectedReturnType as PrimitiveTypeNode).type !== 'void') {
      validator.addError(`Function must return a value`, stmt.location);
    }
  }
}

export function validateIfStatement(stmt: IfStatement, validator: Validator): void {
  const conditionType = validateExpression(stmt.condition, validator);
  if (!isBooleanType(conditionType)) {
    validator.addError(`If condition must be of type 'bool'`, stmt.condition.location);
  }

  // Check if the condition is a type guard and apply type narrowing
  const typeNarrowing = analyzeTypeGuard(stmt.condition, validator);

  if (typeNarrowing) {
    // Generate unique keys for this if statement (include a unique counter to prevent collisions)
    const ifCounter = validator.context.codeGenHints.typeNarrowing.size;
    const ifKey = `if_${stmt.location?.start?.line || 0}_${stmt.location?.start?.column || 0}_${ifCounter}`;
    const thenKey = `${ifKey}_then`;
    const elseKey = `${ifKey}_else`;

    // Helper function to get the original (pre-narrowing) type for a variable
    const originalTypes = typeNarrowing.originalTypes;
    const getOriginalType = (varName: string): Type | undefined => {
      if (originalTypes.has(varName)) {
        return originalTypes.get(varName);
      }
      // Look through existing narrowing hints to find the original type
      for (const [key, hint] of validator.context.codeGenHints.typeNarrowing) {
        if (hint.variableName === varName) {
          return hint.originalType;
        }
      }
      // If no narrowing hints exist, the current type is the original type
      if (varName.includes('.')) {
        return validator.context.propertyNarrowings.get(varName);
      }
      return validator.context.symbols.get(varName);
    };

    // Store narrowing info for then-branch
    for (const [varName, narrowedType] of typeNarrowing.thenNarrowing) {
      const originalType = getOriginalType(varName);
      if (originalType) {
        validator.context.codeGenHints.typeNarrowing.set(thenKey, {
          variableName: varName,
          narrowedType: narrowedType,
          originalType: originalType,
          branchType: 'then'
        });
      }
    }

    // Store narrowing info for else-branch
    for (const [varName, narrowedType] of typeNarrowing.elseNarrowing) {
      const originalType = getOriginalType(varName);
      if (originalType) {
        validator.context.codeGenHints.typeNarrowing.set(elseKey, {
          variableName: varName,
          narrowedType: narrowedType,
          originalType: originalType,
          branchType: 'else'
        });
      }
    }

    // Apply type narrowing for the then-branch
    withNarrowedContext(typeNarrowing.thenNarrowing, () => {
      validateStatement(stmt.thenStatement, validator);
    }, validator);

    // Apply type narrowing for the else-branch
    if (stmt.elseStatement) {
      withNarrowedContext(typeNarrowing.elseNarrowing, () => {
        validateStatement(stmt.elseStatement!, validator);
      }, validator);
    }
  } else {
    // No type narrowing, validate normally
    validateStatement(stmt.thenStatement, validator);
    if (stmt.elseStatement) {
      validateStatement(stmt.elseStatement, validator);
    }
  }
}

export function validateForStatement(stmt: ForStatement, validator: Validator): void {
  const prevSymbols = new Map(validator.context.symbols);

  if (stmt.init) {
    if (stmt.init.kind === 'variable') {
      validateVariableDeclaration(stmt.init, validator);
    } else {
      validateExpression(stmt.init as Expression, validator);
    }
  }

  if (stmt.condition) {
    const conditionType = validateExpression(stmt.condition, validator);
    if (!isBooleanType(conditionType)) {
      validator.addError(`For condition must be of type 'bool'`, stmt.condition.location);
    }
  }

  if (stmt.update) {
    validateExpression(stmt.update, validator);
  }

  const wasInLoop = validator.context.inLoop;
  validator.context.inLoop = true;
  validateStatement(stmt.body, validator);
  validator.context.inLoop = wasInLoop;

  validator.context.symbols = prevSymbols;
}

export function validateSwitchStatement(stmt: SwitchStatement, validator: Validator): void {
  const discriminantType = validateExpression(stmt.discriminant, validator);

  const wasInSwitch = validator.context.inSwitch;
  validator.context.inSwitch = true;

  for (const switchCase of stmt.cases) {
    if (!switchCase.isDefault) {
      for (const test of switchCase.tests) {
        if (test.kind === 'range') {
          const rangeTest = test as RangeExpression;
          const startType = validateExpression(rangeTest.start, validator);
          const endType = validateExpression(rangeTest.end, validator);
          if (!isTypeCompatible(startType, discriminantType, validator) || !isTypeCompatible(endType, discriminantType, validator)) {
            validator.addError(`Range values must be compatible with switch type`, test.location);
          }
        } else {
          // Handle all other expression types (literals, member access, etc.)
          const testType = validateExpression(test, validator);
          if (!isTypeCompatible(testType, discriminantType, validator)) {
            validator.addError(
              `Case value type '${typeToString(testType)}' is not compatible with switch type '${typeToString(discriminantType)}'`,
              test.location
            );
          }
        }
      }
    }

    // Flatten destructuring within case bodies to avoid introducing extra scopes
    const newCaseBody: Statement[] = [] as any;
    for (const statement of switchCase.body) {
      if (statement.kind === 'destructuringVariable') {
        const d = statement as DestructuringVariableDeclaration;
        if (d.initializer) {
          validateExpression(d.initializer, validator);
        }
        const lowered = lowerDestructuringVariable(d, validator);
        for (const s of lowered.body) {
          validateStatement(s, validator);
          newCaseBody.push(s);
        }
        continue;
      }
      if (statement.kind === 'destructuringAssign') {
        const d = statement as DestructuringAssignment;
        validateExpression(d.expression, validator);
        const lowered = lowerDestructuringAssignment(d, validator);
        for (const s of lowered.body) {
          validateStatement(s, validator);
          newCaseBody.push(s);
        }
        continue;
      }
      validateStatement(statement, validator);
      newCaseBody.push(statement);
    }
    (switchCase as any).body = newCaseBody;
  }

  validator.context.inSwitch = wasInSwitch;
}



export function validateEnumDeclaration(stmt: EnumDeclaration, validator: Validator): void {
  const memberNames = new Set<string>();
  let hasStringValues = false;
  let hasNumericValues = false;

  for (const member of stmt.members) {
    if (memberNames.has(member.name.name)) {
      validator.addError(`Duplicate enum member '${member.name.name}'`, member.location);
    }
    memberNames.add(member.name.name);

    if (member.value) {
      if (member.value.literalType === 'string') {
        hasStringValues = true;
      } else if (member.value.literalType === 'number') {
        hasNumericValues = true;
      }
    }
  }

  if (hasStringValues && hasNumericValues) {
    validator.addError(`Enum '${stmt.name.name}' cannot mix string and numeric values`, stmt.location);
  }
}

export function validateTypeAliasDeclaration(stmt: TypeAliasDeclaration, validator: Validator): void {
  const aliasName = stmt.name.name;

  // Check for duplicate type alias names
  if (validator.context.typeAliases.has(aliasName)) {
    const existing = validator.context.typeAliases.get(aliasName);
    if (existing !== stmt) {
      validator.addError(`Duplicate type alias '${aliasName}'`, stmt.location);
      return;
    }
  } else {
    // Register the type alias if not already registered (e.g. if not top-level)
    validator.context.typeAliases.set(aliasName, stmt);
  }

  // Check for name conflicts with other declarations
  if (validator.context.classes.has(aliasName) ||
  validator.context.enums.has(aliasName)) {
  validator.addError(`Type alias '${aliasName}' conflicts with existing declaration`, stmt.location);
  return;
  }

  // Validate the type expression
  validateType(stmt.type, stmt.location, validator);

  // Then check for circular references
  if (hasCircularTypeAlias(validator, stmt.type, aliasName, new Set())) {
    validator.addError(`Circular type alias detected in '${aliasName}'`, stmt.location);
    // Remove the invalid alias
    validator.context.typeAliases.delete(aliasName);
    return;
  }

  // Add to global symbols if exported
  if (stmt.isExport) {
    const fullyQualifiedName = validator.context.currentModule
      ? `${validator.context.currentModule}.${aliasName}`
      : aliasName;

    validator.context.globalSymbols.set(fullyQualifiedName, {
      name: aliasName,
      fullyQualifiedName,
      type: 'typeAlias',
      signature: stmt.type,
      sourceModule: validator.context.currentModule || 'main'
    });
  }
}


export function validateForOfStatement(stmt: ForOfStatement, validator: Validator): void {
  const prevSymbols = new Map(validator.context.symbols);

  const iterableType = validateExpression(stmt.iterable, validator);
  
  // Handle range iteration (existing logic)
  if (iterableType.kind === 'range') {
    const elementType = createPrimitiveType('int');
    validator.context.symbols.set(stmt.variable.name, elementType);
    
    const wasInLoop = validator.context.inLoop;
    validator.context.inLoop = true;
    validateStatement(stmt.body, validator);
    validator.context.inLoop = wasInLoop;
    
    validator.context.symbols = prevSymbols;
    return;
  }

  // Use comprehensive iterator validation for collections
  try {
    const iteratorInfo: IteratorTypeInfo = validateIteratorForOf(stmt, validator.context);
    
    // Determine the loop variable type based on iteration type
    let loopVarType: Type;
    
    switch (iteratorInfo.iterableType) {
      case 'array':
        loopVarType = iteratorInfo.elementType!;
        break;
      case 'set':
        // For sets, the loop variable gets the element type (potentially lowered from enum)
        loopVarType = iteratorInfo.requiresEnumLowering 
          ? createPrimitiveType('int') 
          : iteratorInfo.elementType!;
        break;
      case 'map':
        // For maps, we should validate destructuring pattern
        // For now, assume single variable gets the value type
        loopVarType = iteratorInfo.valueType!;
        break;
      default:
        validator.addError(`Unsupported iteration type: ${iteratorInfo.iterableType}`, stmt.location);
        return;
    }
        
    validator.context.symbols.set(stmt.variable.name, loopVarType);
    
    const wasInLoop = validator.context.inLoop;
    validator.context.inLoop = true;
    validateStatement(stmt.body, validator);
    validator.context.inLoop = wasInLoop;
    
  } catch (error: any) {
    // Iterator validation failed, add error
    validator.addError(error.message || 'Invalid for-of statement', stmt.location);
  }

  validator.context.symbols = prevSymbols;
}

export function validateExpressionStatement(stmt: ExpressionStatement, validator: Validator): void {
  validateExpression(stmt.expression, validator);
}

export function validateVariableDeclaration(stmt: VariableDeclaration, validator: Validator): void {
  let type: Type | undefined = stmt.type;

  // Handle concise lambda form
  if (stmt.isConciseLambda && stmt.lambdaParameters && stmt.initializer?.kind === 'lambda') {
    const lambda = stmt.initializer as LambdaExpression;
    
    // Validate lambda parameters
    for (const param of stmt.lambdaParameters) {
      validateType(param.type, param.location, validator);
    }
    
    // Set the lambda's parameters from the concise form
    lambda.parameters = stmt.lambdaParameters;
    
    // Create function type from parameters and inferred return type
    const paramTypes = stmt.lambdaParameters.map(p => ({ name: p.name.name, type: p.type }));
    let returnType: Type;
    
    if (lambda.returnType) {
      validateType(lambda.returnType, lambda.location, validator);
      returnType = lambda.returnType;
    } else {
      returnType = { kind: 'primitive', type: 'void' } as PrimitiveTypeNode;
    }
    
    const functionType: FunctionTypeNode = {
      kind: 'function',
      parameters: paramTypes,
      returnType,
      isConciseForm: true
    };
    
    // Set the function type as the lambda's expected type for validation
    lambda._expectedFunctionType = functionType;
    
    // Validate the lambda using the normal lambda validation
    const lambdaType = validateExpression(lambda, validator);
    
    stmt.inferredType = lambdaType;
    validator.context.symbols.set(stmt.identifier.name, lambdaType);
    
    // Track variable in scope tracker
    const scopeName = validator.context.currentFunction?.name.name || 'global';
    const entry = createScopeTrackerEntry({
      name: stmt.identifier.name,
      kind: 'local',
      scopeName,
      location: stmt.location,
      type: lambdaType,
      isConstant: stmt.isConst,
      declaringClass: validator.context.currentClass?.name.name
    });
  registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, entry);
    
    return;
  }

  // Regular variable declaration handling
  if (stmt.initializer) {
    const initializer = stmt.initializer
    // Resolve the explicit type before propagating context
    if (type) {
      resolveActualType(type, validator, stmt.location);
    }

    // If we have an explicit type and the initializer is an object or set literal,
    // try to infer the object literal type from the variable type
    if (type && initializer.kind === 'object') {
      const objExpr = initializer as ObjectExpression;
      if (!objExpr.className && canInferObjectLiteralType(objExpr, type)) {
        inferObjectLiteralType(objExpr, type, validator);
      }
    }
    // Propagate expected enum type to set literal
    if (type && initializer.kind === 'set' && type.kind === 'set' && type.elementType.kind === 'enum') {
      initializer._expectedEnumType = type.elementType;
    }
    // Propagate expected enum type to map literal keys
    if (type && initializer.kind === 'object' && type.kind === 'map' && type.keyType.kind === 'enum') {
      initializer._expectedEnumKeyType = type.keyType;
    }
    // Propagate type context to the initializer (handles nested structures recursively)
    if (type) {
      propagateTypeContext(initializer, type, validator);
    }

    const initType = validateExpression(stmt.initializer, validator);
    if (!type) {
      type = initType;
    } else {
      // Type was already resolved above
      if (!isTypeCompatible(initType, type, validator)) {
        addTypeCompatibilityError(initType, type, stmt.location, 'assign', validator);
      }
    }
  }

  if (!type) {
    validator.addError(`Variable '${stmt.identifier.name}' must have a type annotation or initializer`, stmt.location);
    return;
  }

  validateType(type, stmt.location, validator);

  // Apply readonly modifier to the type if variable is readonly
  if (stmt.isReadonly) {
    if (type.kind === 'array' || type.kind === 'map' || type.kind === 'set' || type.kind === 'class') {
      (type as any).isReadonly = true;
    }
    
    // Deep readonly enforcement
    if (type.kind === 'array') {
      const arrayType = type as ArrayTypeNode;
      if (!isImmutableType(arrayType.elementType, validator)) {
        validator.addError(`Readonly array must contain immutable elements`, stmt.location);
      }
    } else if (type.kind === 'set') {
      const setType = type as SetTypeNode;
      if (!isImmutableType(setType.elementType, validator)) {
        validator.addError(`Readonly set must contain immutable elements`, stmt.location);
      }
    } else if (type.kind === 'map') {
      const mapType = type as MapTypeNode;
      if (!isImmutableType(mapType.valueType, validator)) {
        validator.addError(`Readonly map must contain immutable values`, stmt.location);
      }
    }
  }

  // Const variables must have initializers
  if (stmt.isConst && !stmt.initializer) {
    validator.addError(`Const variable '${stmt.identifier.name}' must have an initializer`, stmt.location);
    return;
  }

  // Deprecation warning for const
  if (stmt.isConst) {
    validator.addWarning(`'const' is deprecated for variables. Use 'readonly' instead.`, stmt.location);
  }

  // Global variables of non-nullable types should be initialized to prevent null pointer issues
  const isGlobalScope = !validator.context.currentFunction && !validator.context.currentClass;
  if (isGlobalScope && !stmt.initializer && requiresExplicitInitialization(type, validator)) {
    validator.addError(`Global variable '${stmt.identifier.name}' of non-nullable type must be initialized`, stmt.location);
    return;
  }

  // Note: We now use definite assignment analysis to check for uninitialized usage
  if (!stmt.initializer && isNonNullableType(type, validator)) {
    // Variable is declared but not immediately initialized
    // The definite assignment analyzer will catch usage before assignment
  }

  stmt.inferredType = type;
  validator.context.symbols.set(stmt.identifier.name, type);
  
  // Track variable in scope tracker
  const scopeName = validator.context.currentFunction?.name.name || 'global';
  const entry = createScopeTrackerEntry({
    name: stmt.identifier.name,
    kind: 'local',
    scopeName,
    location: stmt.location,
    type,
    isConstant: stmt.isConst || stmt.isReadonly,
    declaringClass: validator.context.currentClass?.name.name
  });
  registerScopeTrackerEntry(validator.context.codeGenHints.scopeTracker, entry);
}

export function resolveImports(program: Program, globalContext: GlobalValidationContext, validator: Validator): void {
  for (const stmt of program.body) {
    if (stmt.kind === 'import') {
      validateImportDeclaration(stmt, globalContext, validator, program.filename);
    }
  }
}

export function validateImportDeclaration(stmt: ImportDeclaration, globalContext: GlobalValidationContext | null, validator: Validator, importingFile?: string): void {
  if (!globalContext) {
    // Fallback to simple validation for single-file mode
    for (const specifier of stmt.specifiers) {
      const localName = specifier.local?.name || specifier.imported.name;
      const unknownType: ClassTypeNode = { kind: 'class', name: 'unknown' };
      validator.context.symbols.set(localName, unknownType);
    }
    return;
  }

  // Resolve the source module from relative import path
  const sourceModulePath = stmt.source.value as string;
  const resolvedFilePath = resolveImportPath(sourceModulePath, globalContext, importingFile);

  if (!resolvedFilePath) {
    validator.addError(`Cannot resolve import from '${sourceModulePath}'`, stmt.location);
    return;
  }

  const sourceModule = globalContext.moduleMap.get(resolvedFilePath);
  if (!sourceModule) {
    validator.addError(`Cannot resolve import from '${sourceModulePath}'`, stmt.location);
    return;
  }

  // Validate each import specifier
  for (const specifier of stmt.specifiers) {
    const importedName = specifier.imported.name;
    const localName = specifier.local?.name || importedName;
    const fullyQualifiedName = `${sourceModule}::${importedName}`;

    const exportedSymbol = globalContext.exportedSymbols.get(fullyQualifiedName);
    if (!exportedSymbol) {
      validator.addError(`'${importedName}' is not exported from module '${sourceModulePath}'`, stmt.location);
      continue;
    }

    // Check for duplicate imports (same local name from different modules)
    if (validator.context.imports.has(localName)) {
      const existingImport = validator.context.imports.get(localName)!;
      if (existingImport.sourceModule !== sourceModule) {
        validator.addError(`Symbol '${localName}' is already imported from module '${existingImport.sourceModule}'. Cannot import it again from '${sourceModule}'.`, stmt.location);
        continue;
      }
    }

    // Add the imported symbol to the local symbol table
    validator.context.symbols.set(localName, exportedSymbol.signature);

    // so that object literal validation can access the full declaration
    if (exportedSymbol.type === 'class' || exportedSymbol.type === 'enum') {
      addImportedDeclaration(localName, exportedSymbol, resolvedFilePath, globalContext, validator);
    }

    // Track the import for code generation
    validator.context.imports.set(localName, {
      localName,
      importedName,
      sourceModule,
      sourceFile: resolvedFilePath,
      fullyQualifiedName
    });
  }
}

function resolveImportPath(importPath: string, globalContext: GlobalValidationContext, importerFile?: string): string | null {
  if (!importPath.startsWith('.')) {
    return null;
  }

  const normalizedImport = importPath.endsWith('.do') ? importPath : `${importPath}.do`;

  if (importerFile) {
    const importerDir = path.dirname(importerFile);
    const resolvedPath = path.resolve(importerDir, normalizedImport);
    const match = findFileInContext(globalContext, resolvedPath);
    if (match) {
      return match;
    }
  }

  // Fallback: attempt to locate the module by suffix when importer path is unavailable
  const strippedImport = normalizedImport.replace(/^[.\/]+/, '');
  const strippedWithoutExt = strippedImport.endsWith('.do') ? strippedImport.slice(0, -3) : strippedImport;

  for (const filePath of globalContext.files.keys()) {
    const withoutExt = path.normalize(filePath).replace(/\.[^/.]+$/, '');
    if (withoutExt.endsWith(strippedWithoutExt)) {
      return filePath;
    }
  }

  return null;
}

function findFileInContext(globalContext: GlobalValidationContext, resolvedPath: string): string | null {
  if (globalContext.files.has(resolvedPath)) {
    return resolvedPath;
  }

  const normalizedResolved = path.normalize(resolvedPath);
  for (const filePath of globalContext.files.keys()) {
    if (path.normalize(filePath) === normalizedResolved) {
      return filePath;
    }
  }

  return null;
}

function addImportedDeclaration(localName: string, exportedSymbol: ExportedSymbol, sourceFilePath: string, globalContext: GlobalValidationContext, validator: Validator): void {
  // Get the source program to find the actual declaration
  const sourceProgram = globalContext.files.get(sourceFilePath);
  if (!sourceProgram) {
    return;
  }

  // Find the exported declaration in the source program
  for (const stmt of sourceProgram.body) {
    if (stmt.kind === 'export') {
      const decl = stmt.declaration;

      if (exportedSymbol.type === 'class' && decl.kind === 'class') {
        if (decl.name.name === exportedSymbol.name) {
          // Add the class declaration with the local name
          const importedClassDecl = { ...decl, name: { ...decl.name, name: localName } };
          validator.context.classes.set(localName, importedClassDecl);
          return;
        }
      } else if (exportedSymbol.type === 'enum' && decl.kind === 'enum') {
        if (decl.name.name === exportedSymbol.name) {
          // Add the enum declaration with the local name
          const importedEnumDecl = { ...decl, name: { ...decl.name, name: localName } };
          validator.context.enums.set(localName, importedEnumDecl);
          return;
        }
      }
    }
  }
}

/**
 * Validates a function body with pre-assigned parameters
 */
export function validateFunctionBody(stmt: BlockStatement, preAssignedVariables: string[], validator: Validator): void {
  const prevSymbols = new Map(validator.context.symbols);
  const wasInFunctionValidation = validator.inFunctionValidation;
  validator.inFunctionValidation = true;

  // Build a new body with destructuring flattened to sibling statements
  const newBody: Statement[] = [] as any;
  for (const statement of stmt.body) {
    if (statement.kind === 'destructuringVariable') {
      const d = statement as DestructuringVariableDeclaration;
      if (d.initializer) {
        validateExpression(d.initializer, validator);
      }
      const lowered = lowerDestructuringVariable(d, validator);
      for (const s of lowered.body) {
        validateStatement(s, validator);
        newBody.push(s);
      }
      continue;
    }
    if (statement.kind === 'destructuringAssign') {
      const d = statement as DestructuringAssignment;
      validateExpression(d.expression, validator);
      const lowered = lowerDestructuringAssignment(d, validator);
      for (const s of lowered.body) {
        validateStatement(s, validator);
        newBody.push(s);
      }
      continue;
    }
    validateStatement(statement, validator);
    newBody.push(statement);
  }

  (stmt as any).body = newBody;

  // Run definite assignment analysis with pre-assigned variables
  checkDefiniteAssignmentInBlock(validator, stmt, preAssignedVariables);

  validator.context.symbols = prevSymbols;
  validator.inFunctionValidation = wasInFunctionValidation;
}


/**
 * Executes a callback with a narrowed symbol context.
 * The narrowing is temporarily applied to the symbols table.
 */
function withNarrowedContext(narrowing: Map<string, Type>, callback: () => void, validator: Validator): void {
  // Save the current symbol types that will be modified
  const savedVariableTypes = new Map<string, Type>();
  const savedPropertyTypes = new Map<string, Type>();
  const propertyKeysApplied: string[] = [];

  for (const [name, narrowedType] of narrowing) {
    if (name.includes('.')) {
      const currentPropertyType = validator.context.propertyNarrowings.get(name);
      if (currentPropertyType) {
        savedPropertyTypes.set(name, currentPropertyType);
      } else {
        propertyKeysApplied.push(name);
      }
      validator.context.propertyNarrowings.set(name, narrowedType);
      continue;
    }

    const currentType = validator.context.symbols.get(name);
    if (currentType) {
      savedVariableTypes.set(name, currentType);
    }
    // Apply the narrowed type
    validator.context.symbols.set(name, narrowedType);
  }

  try {
    // Execute the callback with narrowed context
    callback();
  } finally {
    // Restore the original variable types
    for (const [name, originalType] of savedVariableTypes) {
      validator.context.symbols.set(name, originalType);
    }

    // Remove any narrowed variable types that didn't exist before
    for (const [name] of narrowing) {
      if (!name.includes('.') && !savedVariableTypes.has(name)) {
        validator.context.symbols.delete(name);
      }
    }

    // Restore property narrowings
    for (const [name, originalType] of savedPropertyTypes) {
      validator.context.propertyNarrowings.set(name, originalType);
    }

    for (const name of propertyKeysApplied) {
      if (!savedPropertyTypes.has(name)) {
        validator.context.propertyNarrowings.delete(name);
      }
    }
  }
}

/**
 * Checks for definite assignment violations in a block
 */
function checkDefiniteAssignmentInBlock(validator: Validator, stmt: BlockStatement, preAssignedVariables: string[] = []): void {
  const unassignedUsages = validator.definiteAssignmentAnalyzer.getUnassignedUsages(stmt.body);
  for (const usage of unassignedUsages) {
    // Skip if the variable is pre-assigned (e.g., function parameter)
    if (preAssignedVariables.includes(usage.variableName)) {
      continue;
    }

    const variableType = validator.context.symbols.get(usage.variableName);
    if (variableType && isNonNullableType(variableType, validator)) {
      validator.addError(
        `Variable '${usage.variableName}' is used before being definitely assigned`,
        usage.location
      );
    }
  }
}

function hasCircularTypeAlias(validator: Validator, type: Type, targetAlias: string, visited: Set<string>): boolean {
  if (type.kind === 'typeAlias') {
    if (type.name === targetAlias) {
      return true;
    }
    if (visited.has(type.name)) {
      return true; // Circular reference detected
    }

    visited.add(type.name);
    const aliasDecl = validator.context.typeAliases.get(type.name);
    if (aliasDecl) {
      return hasCircularTypeAlias(validator, aliasDecl.type, targetAlias, visited);
    }
    visited.delete(type.name);
  } else if (type.kind === 'union') {
    for (const unionType of type.types) {
      if (hasCircularTypeAlias(validator, unionType, targetAlias, new Set(visited))) {
        return true;
      }
    }
  } else if (type.kind === 'array') {
    return hasCircularTypeAlias(validator, type.elementType, targetAlias, new Set(visited));
  } else if (type.kind === 'map') {
    return hasCircularTypeAlias(validator, type.keyType, targetAlias, new Set(visited)) ||
      hasCircularTypeAlias(validator, type.valueType, targetAlias, new Set(visited));
  } else if (type.kind === 'set') {
    return hasCircularTypeAlias(validator, type.elementType, targetAlias, new Set(visited));
  }

  return false;
}


/**
 * Validates a break statement
 */
export function validateBreakStatement(stmt: Statement, validator: Validator): void {
  // Check if we're in a loop context
  if (!validator.context.inLoop && !validator.context.inSwitch) {
    validator.addError(`'break' statement can only be used inside loops or switch statements`, stmt.location);
    return;
  }

  // Check if we're in a switch statement but NOT inside a loop
  if (validator.context.inSwitch && !validator.context.inLoop) {
    validator.addError(
      `'break' statements are not used in doof switch statements. Switch cases do not fall through by default. Use multiple case labels (e.g., 'case 1, 2:') for cases that should share logic.`,
      stmt.location
    );
  }
}

/**
 * Validates a continue statement
 */
export function validateContinueStatement(stmt: Statement, validator: Validator): void {
  if (!validator.context.inLoop) {
    validator.addError(`'continue' statement can only be used inside loops`, stmt.location);
  }

  // Continue inside a switch is only invalid if we're not also inside a loop
  if (validator.context.inSwitch && !validator.context.inLoop) {
    validator.addError(`'continue' statement cannot be used inside switch statements`, stmt.location);
  }
}

/**
 * Returns true if the statement is a declaration allowed at the top level.
 */
export function isTopLevelDeclaration(stmt: Statement): boolean {
  switch (stmt.kind) {
    case 'function':
    case 'class':
    case 'externClass':
    case 'enum':
    case 'typeAlias':
    case 'variable':
    case 'import':
    case 'export':
      return true;
    default:
      return false;
  }
}
