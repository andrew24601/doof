import {
  CallExpression,
  Expression,
  Type,
  FunctionTypeNode,
  PositionalObjectExpression,
  OptionalChainExpression,
  Identifier,
  ObjectProperty,
  MemberExpression,
  TypeParameter,
  MapTypeNode,
  SetTypeNode,
  ObjectExpression,
  SetExpression
} from "../types";
import {
  typeToString,
  isTypeCompatible,
  isPrintableType,
  createUnknownType,
  getExpressionId,
  validateType,
  resolveActualType,
  isSideEffectFreeExpression
} from "../type-utils";
import { tryResolveIntrinsic, getMapMethodType, getSetMethodType, getArrayMethodType, getStringMethodType, getMathMethodType } from "./intrinsics-validator";
import { validateAnyTypeConversionCall } from "./type-conversion-validator";
import { getMemberPropertyName, markTypeForJsonFromEntry } from "./member-access-validator";
import { Validator } from "./validator";
import { validateExpression } from "./expression-validator";
import { propagateTypeContext } from "./binary-expression-validator";
import { validateObjectExpression, validatePositionalObjectExpression } from "./object-literal-validator";
import { validateSetExpression } from "./collection-validator";
import { cloneTypeNode, substituteTypeParametersInType } from "./type-substitution";

/**
 * Mark an expression's type (and nested component types) as needing JSON "to" helpers
 * when used in println.
 */
function maybeMarkExprForJsonPrint(expr: Expression, inferredType: Type, validator: Validator) {
  if (!inferredType) return;

  // Use a set to track visited types to avoid infinite recursion
  const visited = new Set<string>();
  markTypeForJsonPrint(inferredType, validator, visited);
}

function markTypeForJsonPrint(type: Type, validator: Validator, visited: Set<string>) {
  if (!type) return;

  switch (type.kind) {
    case 'class':
      const typeName = type.name;
      if (visited.has(typeName)) return; // Avoid infinite recursion
      visited.add(typeName);

      validator.context.codeGenHints.jsonPrintTypes.add(typeName);

      const classDecl = validator.context.classes.get(typeName);
      if (classDecl) {
        for (const field of classDecl.fields) {
          markTypeForJsonPrint(field.type, validator, visited);
        }
      }
      break;
    case 'array':
      markTypeForJsonPrint(type.elementType, validator, visited);
      break;
    case 'map':
      markTypeForJsonPrint(type.valueType, validator, visited);
      markTypeForJsonPrint(type.keyType, validator, visited);
      break;
    case 'set':
      markTypeForJsonPrint(type.elementType, validator, visited);
      break;
    case 'union':
      for (const t of type.types) markTypeForJsonPrint(t, validator, visited);
      break;
    default:
      break;
  }
}

function makeNullableType(type: Type): Type {
  if (isNullableType(type)) {
    return type; // Already nullable
  }

  return {
    kind: 'union',
    types: [type, { kind: 'primitive', type: 'null' }]
  };
}

function isNullableType(type: Type): boolean {
  if (type.kind === 'union') {
    return type.types.some(t => t.kind === 'primitive' && t.type === 'null');
  }
  return type.kind === 'primitive' && type.type === 'null';
}

function isStructOrCollectionLiteral(expr: Expression, validator: Validator): boolean {
  if (expr.kind === 'array') {
    return true; // Array literal
  }

  if (expr.kind === 'set') {
    return true; // Set literal
  }

  if (expr.kind === 'object') {
    if (expr.className) {
      // Note: Class literals are allowed as per enhancement rules
      const classDecl = validator.context.classes.get(expr.className);
      if (classDecl) {
        return false; // Class literal - allowed
      }
    }
    // Generic object literals (maps) are also collection-like
    if (!expr.className) {
      return true; // Generic object/map literal
    }
  }

  return false;
}

function isIntrinsicInstanceMethodCall(expr: CallExpression, validator: Validator): boolean {
  // Check if this is a member expression call (object.method())
  if (expr.callee.kind !== 'member') {
    return false;
  }

  const memberExpr = expr.callee;

  // Don't handle computed member access for now
  if (memberExpr.computed) {
    return false;
  }

  // Get the object type that the method is being called on
  const objectType = validateExpression(memberExpr.object, validator);
  const methodName = getMemberPropertyName(memberExpr.property);

  // Check if this is an intrinsic method call on built-in types
  if (objectType.kind === 'map') {
    return getMapMethodType(methodName, objectType) !== null;
  }

  if (objectType.kind === 'set') {
    return getSetMethodType(methodName, objectType) !== null;
  }

  if (objectType.kind === 'array') {
    return getArrayMethodType(methodName, objectType) !== null;
  }

  if (objectType.kind === 'primitive' && objectType.type === 'string') {
    return getStringMethodType(methodName) !== null;
  }

  if (objectType.kind === 'class') {
    const className = objectType.name;

    // Check for built-in class methods
    if (className === 'Math') {
      return getMathMethodType(methodName) !== null;
    }
  }

  // Also consider intrinsic registry entries for class/externClass names
  if (objectType.kind === 'class' || objectType.kind === 'externClass') {
    const className = objectType.name;
    const intrinsicKey = `${className}.${methodName}`;
    const intrinsicDef = validator.intrinsicRegistry.get(intrinsicKey);
    return !!(intrinsicDef && intrinsicDef.overloads && intrinsicDef.overloads.length > 0);
  }

  return false;
}

function storeCallDispatchInfo(expr: CallExpression, validator: Validator): void {
  if (!expr.callInfo) {
    return;
  }
  const exprId = getExpressionId(expr);
  validator.context.codeGenHints.callDispatch.set(exprId, expr.callInfo);
  expr.callInfoSnapshot = expr.callInfo;
}

function populateCallDispatchInfo(expr: CallExpression, validator: Validator): void {
  if (expr.callInfo) {
    storeCallDispatchInfo(expr, validator);
    return;
  }

  if (expr.callee.kind === 'identifier') {
    const funcName = (expr.callee as Identifier).name;

    if (funcName === 'println' || funcName === 'print' || funcName === 'panic') {
      expr.callInfo = { kind: 'intrinsic', targetName: funcName };
      storeCallDispatchInfo(expr, validator);
      return;
    }

    const identifierSymbol = validator.context.symbols.get(funcName);
    const isParameter = validator.context.currentFunction?.parameters.some(p => p.name.name === funcName);

    if (identifierSymbol && identifierSymbol.kind === 'function' && isParameter) {
      expr.callInfo = { kind: 'lambda', targetName: funcName };
    } else {
      expr.callInfo = { kind: 'function', targetName: funcName };
    }
    storeCallDispatchInfo(expr, validator);
    return;
  }

  if (expr.callee.kind === 'member') {
    const memberExpr = expr.callee as MemberExpression;

    if (memberExpr.property.kind !== 'identifier') {
      return;
    }

    const objectType = validateExpression(memberExpr.object, validator);
    const methodName = (memberExpr.property as Identifier).name;

    if (objectType && (objectType.kind === 'class' || objectType.kind === 'externClass')) {
      const className = objectType.name;

      if (memberExpr.object.kind === 'identifier' && (memberExpr.object as Identifier).name === className) {
        expr.callInfo = {
          kind: 'staticMethod',
          targetName: methodName,
          className,
          objectType
        };
      } else {
        expr.callInfo = {
          kind: 'instanceMethod',
          targetName: methodName,
          className,
          objectType,
          methodType: 'class'
        };
      }
      storeCallDispatchInfo(expr, validator);
      return;
    }

    if (objectType && objectType.kind === 'union') {
      expr.callInfo = {
        kind: 'unionMethod',
        targetName: methodName,
        objectType,
        unionType: objectType
      };
      storeCallDispatchInfo(expr, validator);
      return;
    }

    if (objectType && (objectType.kind === 'map' || objectType.kind === 'set' ||
        objectType.kind === 'array' || (objectType.kind === 'primitive' && objectType.type === 'string'))) {
      const methodType = objectType.kind === 'primitive' ? 'string' : objectType.kind;
      expr.callInfo = {
        kind: 'collectionMethod',
        targetName: methodName,
        objectType,
        methodType: methodType as any
      };
      storeCallDispatchInfo(expr, validator);
      return;
    }

    return;
  }

  expr.callInfo = { kind: 'lambda' };
  storeCallDispatchInfo(expr, validator);
}

function ensureCallInfo(expr: CallExpression, validator: Validator): void {
  if (expr.callInfo) {
    return;
  }

  if (expr.callInfoSnapshot) {
    expr.callInfo = expr.callInfoSnapshot;
    return;
  }

  const fallback = validator.context.codeGenHints.callDispatch.get(getExpressionId(expr));
  if (fallback) {
    expr.callInfo = fallback;
  }
}

function getEffectiveFunctionTypeForCall(expr: CallExpression, funcType: FunctionTypeNode, validator: Validator): FunctionTypeNode {
  const typeParams = funcType.typeParameters ?? [];
  const providedArgs = expr.typeArguments ?? [];
  const callableName = getCallableDisplayName(expr.callee);

  if (typeParams.length === 0) {
    if (providedArgs.length > 0) {
      validator.addError(`Function '${callableName}' does not accept type arguments`, expr.location);
    }
    return funcType;
  }

  if (providedArgs.length === 0) {
    validator.addError(
      `Function '${callableName}' requires ${typeParams.length} type ${typeParams.length === 1 ? 'argument' : 'arguments'}`,
      expr.location
    );
    return funcType;
  }

  if (providedArgs.length !== typeParams.length) {
    validator.addError(
      `Function '${callableName}' expects ${typeParams.length} type ${typeParams.length === 1 ? 'argument' : 'arguments'} but got ${providedArgs.length}`,
      expr.location
    );
    return funcType;
  }

  const mapping = new Map<string, Type>();
  const normalizedArgs: Type[] = [];

  for (let i = 0; i < typeParams.length; i++) {
    const clonedArg = cloneTypeNode(providedArgs[i]);
    validateType(clonedArg, expr.location, validator);
    resolveActualType(clonedArg, validator, expr.location);
    mapping.set(typeParams[i].name, clonedArg);
    normalizedArgs.push(clonedArg);
  }

  const substitutedParameters = funcType.parameters.map(param => ({
    name: param.name,
    type: substituteTypeParametersInType(param.type, mapping)
  }));

  const substitutedReturnType = substituteTypeParametersInType(funcType.returnType, mapping);

  const specializedType: FunctionTypeNode = {
    kind: 'function',
    parameters: substitutedParameters,
    returnType: substitutedReturnType,
    isPrintlnFunction: funcType.isPrintlnFunction,
    isConciseForm: funcType.isConciseForm
  };

  expr.resolvedTypeArguments = normalizedArgs.map(arg => cloneTypeNode(arg));
  expr.genericInstantiation = {
    typeParameters: typeParams,
    typeArguments: expr.resolvedTypeArguments
  };

  return specializedType;
}

function getCallableDisplayName(callee: Expression): string {
  switch (callee.kind) {
    case 'identifier':
      return callee.name;
    case 'member':
      if (callee.property.kind === 'identifier') {
        const objectName = callee.object.kind === 'identifier' ? callee.object.name : 'object';
        return `${objectName}.${callee.property.name}`;
      }
      return 'function';
    default:
      return 'function';
  }
}


function validateNamedArgumentCall(expr: CallExpression, funcType: FunctionTypeNode, validator: Validator): Type {
  const namedArgs = expr.namedArguments!;
  const parameters = funcType.parameters;

  // Create a map of parameter names to their index and type
  const paramMap = new Map<string, { index: number; type: Type }>();
  for (let i = 0; i < parameters.length; i++) {
    paramMap.set(parameters[i].name, { index: i, type: parameters[i].type });
  }

  // Track which parameters we've seen
  const explicitlyProvidedParams = new Set<string>();
  const spreadProvidedParams = new Set<string>();
  
  const argumentsByIndex: (Expression | undefined)[] = new Array(parameters.length);
  
  // Track lexical order of arguments for evaluation order tracking
  const lexicalOrderArgs: Array<{ paramIndex: number; expression: Expression }> = [];

  // Validate each named argument
  for (const namedArg of namedArgs) {
    if (namedArg.kind === 'spread') {
      const spreadType = validateExpression(namedArg.argument, validator);
      
      if (spreadType.kind === 'class') {
        const spreadClassDecl = validator.context.classes.get(spreadType.name);
        if (spreadClassDecl) {
          // Check for side effects
          if (!isSideEffectFreeExpression(namedArg.argument) && namedArg.argument.kind !== 'identifier') {
             validator.addError("Spread argument must be side-effect free (e.g. variable or literal)", namedArg.location);
          }

          for (const field of spreadClassDecl.fields) {
            if (field.isPublic && !field.isStatic) {
              const paramInfo = paramMap.get(field.name.name);
              if (paramInfo) {
                // Check for overwrite of explicit param
                if (explicitlyProvidedParams.has(field.name.name)) {
                  validator.addError(`Spread property '${field.name.name}' overwrites earlier argument`, namedArg.location);
                }
                
                spreadProvidedParams.add(field.name.name);
                
                // Synthesize member access
                const memberExpr: MemberExpression = {
                  kind: 'member',
                  object: namedArg.argument,
                  property: { kind: 'identifier', name: field.name.name, location: namedArg.location },
                  computed: false,
                  location: namedArg.location
                };
                
                let fieldType = field.type;
                if (spreadType.typeArguments && spreadClassDecl.typeParameters) {
                    const mapping = new Map<string, Type>();
                    for(let k=0; k<spreadClassDecl.typeParameters.length; k++) {
                        if (k < spreadType.typeArguments.length) {
                            mapping.set(spreadClassDecl.typeParameters[k].name, spreadType.typeArguments[k]);
                        }
                    }
                    fieldType = substituteTypeParametersInType(fieldType, mapping);
                }
                memberExpr.inferredType = fieldType;

                if (!isTypeCompatible(fieldType, paramInfo.type, validator)) {
                  validator.addError(
                    `Spread argument '${field.name.name}': cannot convert '${typeToString(fieldType)}' to '${typeToString(paramInfo.type)}'`,
                    namedArg.location
                  );
                }
                
                argumentsByIndex[paramInfo.index] = memberExpr;
              }
            }
          }
        }
      }
      continue;
    }

    if (namedArg.key.kind !== 'identifier') {
      validator.addError('Named argument keys must be identifiers', namedArg.key.location);
      continue;
    }

    const paramName = (namedArg.key as Identifier).name;
    const paramInfo = paramMap.get(paramName);

    if (!paramInfo) {
      validator.addError(`Unknown parameter '${paramName}'`, namedArg.key.location);
      continue;
    }

    if (explicitlyProvidedParams.has(paramName)) {
      validator.addError(`Parameter '${paramName}' specified multiple times`, namedArg.key.location);
      continue;
    }

    explicitlyProvidedParams.add(paramName);

    // Validate the argument value
    if (namedArg.value) {
      propagateTypeContext(namedArg.value, paramInfo.type, validator);
      const argType = validateExpression(namedArg.value, validator);

      if (!isTypeCompatible(argType, paramInfo.type, validator)) {
        validator.addError(
          `Argument '${paramName}': cannot convert '${typeToString(argType)}' to '${typeToString(paramInfo.type)}'`,
          namedArg.value.location
        );
      }

      argumentsByIndex[paramInfo.index] = namedArg.value;
      lexicalOrderArgs.push({ paramIndex: paramInfo.index, expression: namedArg.value });
    }
  }

  // Named argument order is not enforced for ergonomics

  // Check for missing required parameters & build finalized positional argument list
  for (let i = 0; i < parameters.length; i++) {
    const param = parameters[i];
    if (!explicitlyProvidedParams.has(param.name) && !spreadProvidedParams.has(param.name)) {
      validator.addError(`Missing required parameter '${param.name}'`, expr.location);
    }
  }

  // Lower named arguments to positional order for downstream code generation / analysis
  const normalizedArgs: Expression[] = [];
  for (let i = 0; i < parameters.length; i++) {
    const provided = argumentsByIndex[i];
    if (provided) {
      normalizedArgs.push(provided);
    } else {
      normalizedArgs.push({ kind: 'literal', value: null, literalType: 'null', location: expr.location } as any);
    }
  }
  expr.arguments = normalizedArgs;
  
  // Check if arguments are out of order and need temporaries for evaluation order
  // Arguments need reordering if they're not in ascending parameter index order
  let needsReordering = false;
  let prevParamIndex = -1;
  for (const arg of lexicalOrderArgs) {
    if (arg.paramIndex < prevParamIndex) {
      needsReordering = true;
      break;
    }
    prevParamIndex = arg.paramIndex;
  }
  
  if (needsReordering) {
    // Build the evaluation order metadata
    // For each lexical argument, determine if it needs a temporary
    // An argument needs a temporary if:
    // 1. It's not side-effect-free, AND
    // 2. There's a later lexical argument that has a smaller param index (would be evaluated before it positionally)
    
    const lexicalOrderWithTemps: Array<{ paramIndex: number; expression: Expression; needsTemp: boolean }> = [];
    
    for (let lexIdx = 0; lexIdx < lexicalOrderArgs.length; lexIdx++) {
      const arg = lexicalOrderArgs[lexIdx];
      const isSideEffectFree = isSideEffectFreeExpression(arg.expression);
      
      // Check if any later argument has a smaller param index
      let hasLaterSmallerIndex = false;
      for (let j = lexIdx + 1; j < lexicalOrderArgs.length; j++) {
        if (lexicalOrderArgs[j].paramIndex < arg.paramIndex) {
          hasLaterSmallerIndex = true;
          break;
        }
      }
      
      // Need temp if not side-effect-free AND there's reordering that could affect it
      const needsTemp = !isSideEffectFree && hasLaterSmallerIndex;
      
      lexicalOrderWithTemps.push({
        paramIndex: arg.paramIndex,
        expression: arg.expression,
        needsTemp
      });
    }
    
    // Store the evaluation order metadata
    expr.namedArgumentsLexicalOrder = lexicalOrderWithTemps;
    expr.argumentEvaluationOrder = lexicalOrderArgs.map(a => a.paramIndex);
  }

  populateCallDispatchInfo(expr, validator);
  ensureCallInfo(expr, validator);

  // If this is a static call to Class.fromJSON(...), mark the class and its
  // transitive field types for JSON deserialization generation.
  if (expr.callInfo && expr.callInfo.kind === 'staticMethod' && expr.callInfo.targetName === 'fromJSON') {
    const targetClass = (expr.callInfo as any).className as string | undefined;
    if (targetClass) {
      markTypeForJsonFromEntry(targetClass, validator);
    }
  }

  expr.inferredType = funcType.returnType;
  return funcType.returnType;
}

export function validateCallExpression(expr: CallExpression, validator: Validator): Type {
  // Handle generic collection constructors: Map<K, V>() and Set<T>()
  // Convert these into empty literals so they share code paths with non-empty constructions
  if (expr.callee.kind === 'identifier') {
    const name = (expr.callee as Identifier).name;
    if (name === 'Map' || name === 'Set') {
      const typeArgs = expr.typeArguments ?? [];

      if (name === 'Map') {
        // Expect exactly two type arguments and zero positional args
        if (typeArgs.length !== 2) {
          validator.addError(`Map constructor requires 2 type arguments <K, V>`, expr.location);
        }
        if (expr.arguments.length > 0 || (expr.namedArguments && expr.namedArguments.length > 0)) {
          validator.addError(`Map constructor does not accept runtime arguments; use an object literal to provide entries`, expr.location);
        }

        // Build an empty object literal and pre-infer it as a Map<K,V>
        const mapType: MapTypeNode = {
          kind: 'map',
          keyType: typeArgs[0] ?? createUnknownType(),
          valueType: typeArgs[1] ?? createUnknownType()
        } as any;

        const objExpr: ObjectExpression = {
          kind: 'object',
          properties: [],
          location: expr.location
        } as ObjectExpression;
        // Pre-infer so validator treats this as a generic map literal
        objExpr.inferredType = mapType;

        // Mutate the current node into the object expression to keep downstream codegen simple
        (expr as any).kind = 'object';
        delete (expr as any).callee;
        delete (expr as any).arguments;
        delete (expr as any).namedArguments;
        (expr as any).properties = objExpr.properties;
        (expr as any).className = undefined;
        (expr as any).inferredType = mapType;

        return validateObjectExpression((expr as unknown) as ObjectExpression, validator);
      }

      if (name === 'Set') {
        // Expect exactly one type argument and zero runtime args
        if (typeArgs.length !== 1) {
          validator.addError(`Set constructor requires 1 type argument <T>`, expr.location);
        }
        if (expr.arguments.length > 0 || (expr.namedArguments && expr.namedArguments.length > 0)) {
          validator.addError(`Set constructor does not accept runtime arguments; use a set literal {a, b} to provide elements`, expr.location);
        }

        const setType: SetTypeNode = {
          kind: 'set',
          elementType: typeArgs[0] ?? createUnknownType()
        } as any;

        const setExpr: SetExpression = {
          kind: 'set',
          elements: [],
          location: expr.location
        } as SetExpression;
        (setExpr as any).inferredType = setType;

        // Mutate current node into a set literal
        (expr as any).kind = 'set';
        delete (expr as any).callee;
        delete (expr as any).arguments;
        delete (expr as any).namedArguments;
        (expr as any).elements = setExpr.elements;
        (expr as any).inferredType = setType;

        return validateSetExpression((expr as unknown) as SetExpression, validator);
      }
    }
  }

  // Check for type conversion function calls first (int(), string(), etc.)
  if (expr.callee.kind === 'identifier') {
    const funcName = (expr.callee as Identifier).name;
    const typeConversionResult = validateAnyTypeConversionCall(expr, funcName, validator);
    if (typeConversionResult) {
      expr.inferredType = typeConversionResult;
      return typeConversionResult;
    }
  }

  // First validate the callee to get its type
  const calleeType = validateExpression(expr.callee, validator);

  // Check if this is a call to a class or struct type (positional object initialization)
  if (calleeType.kind === 'class' || calleeType.kind === 'externClass') {
    const typeName = calleeType.name;

    // If we have named arguments, treat this as an object literal (aggregate / constructor literal)
    // rather than positional initialization. This enables XML and explicit named arg syntax
    // to initialize classes by field names.
    if (expr.namedArguments && expr.namedArguments.length > 0) {
      // Reinterpret as object literal for class instantiation using named field initializers.
      const objExpr: ObjectExpression = {
        kind: 'object',
        properties: expr.namedArguments as ObjectProperty[],
        location: expr.location,
        className: typeName,
        typeArguments: expr.typeArguments
      } as any;

      const resultType = validateObjectExpression(objExpr, validator);

      // Attach normalized representation for downstream generators WITHOUT mutating original node shape in-place
      // (Generators for xmlCall and other wrappers rely on CallExpression shape; altering it earlier caused undefined.kind errors.)
      (expr as any).normalizedObjectLiteral = objExpr; // custom attachment
      expr.inferredType = resultType;
      // Keep callInfo constructor for dispatch metadata
      expr.callInfo = { kind: 'constructor', className: typeName, objectType: calleeType };
      return resultType;
    }

    // Set call info for positional constructor
    expr.callInfo = { kind: 'constructor', className: typeName, objectType: calleeType };

    let resolvedTypeArguments: Type[] | undefined;
    let genericInstantiation: { typeParameters: TypeParameter[]; typeArguments: Type[] } | undefined;

    if (calleeType.kind === 'class') {
      const classDecl = validator.context.classes.get(typeName);
      const typeParams = classDecl?.typeParameters ?? [];
      const providedArgs = expr.typeArguments ?? [];

      if (typeParams.length === 0) {
        if (providedArgs.length > 0) {
          validator.addError(`Class '${typeName}' does not accept type arguments`, expr.location);
        }
      } else {
        if (providedArgs.length === 0) {
          validator.addError(
            `Class '${typeName}' requires ${typeParams.length} type ${typeParams.length === 1 ? 'argument' : 'arguments'}`,
            expr.location
          );
        } else if (providedArgs.length !== typeParams.length) {
          validator.addError(
            `Class '${typeName}' expects ${typeParams.length} type ${typeParams.length === 1 ? 'argument' : 'arguments'} but got ${providedArgs.length}`,
            expr.location
          );
        } else {
          const normalizedArgs: Type[] = [];

          for (let i = 0; i < typeParams.length; i++) {
            const clonedArg = cloneTypeNode(providedArgs[i]);
            validateType(clonedArg, expr.location, validator);
            resolveActualType(clonedArg, validator, expr.location);
            normalizedArgs.push(clonedArg);
          }

          resolvedTypeArguments = normalizedArgs.map(arg => cloneTypeNode(arg));
          genericInstantiation = {
            typeParameters: typeParams,
            typeArguments: normalizedArgs.map(arg => cloneTypeNode(arg))
          };
        }
      }
    } else if (expr.typeArguments && expr.typeArguments.length > 0) {
      validator.addError(`Class '${typeName}' does not accept type arguments`, expr.location);
    }

    const positionalExpr = expr as unknown as PositionalObjectExpression;
    positionalExpr.kind = 'positionalObject';
    positionalExpr.className = typeName;
    positionalExpr.arguments = expr.arguments;
    positionalExpr.typeArguments = expr.typeArguments;
    positionalExpr.resolvedTypeArguments = resolvedTypeArguments;
    positionalExpr.genericInstantiation = genericInstantiation;

    delete (positionalExpr as any).callee;
    delete (positionalExpr as any).namedArguments;
    delete (positionalExpr as any).intrinsicInfo;
    delete (positionalExpr as any).typeConversionInfo;
    delete (positionalExpr as any).enumConversionInfo;

    return validatePositionalObjectExpression(positionalExpr, validator);
  }

  // Check for intrinsic function calls
  const intrinsicResult = tryResolveIntrinsic(expr, validator);
  if (intrinsicResult) {
    expr.inferredType = intrinsicResult.returnType;
    expr.intrinsicInfo = intrinsicResult;
    expr.callInfo = { kind: 'intrinsic', targetName: intrinsicResult.function };
    return intrinsicResult.returnType;
  }

  if (calleeType.kind === 'function') {
    const funcType = calleeType as FunctionTypeNode;
    const effectiveFuncType = getEffectiveFunctionTypeForCall(expr, funcType, validator);

    // Handle named arguments if present
    if (expr.namedArguments && expr.namedArguments.length > 0) {
      return validateNamedArgumentCall(expr, effectiveFuncType, validator);
    }

    // Handle regular positional arguments
    // Check argument count
    if (expr.arguments.length !== effectiveFuncType.parameters.length) {
      validator.addError(`Expected ${effectiveFuncType.parameters.length} arguments, got ${expr.arguments.length}`, expr.location);
    }

    // Special handling for println function - allow printable types
    const isPrintlnCall = effectiveFuncType.isPrintlnFunction;

    // Check argument types
    for (let i = 0; i < Math.min(expr.arguments.length, effectiveFuncType.parameters.length); i++) {
      const arg = expr.arguments[i];
      const paramType = effectiveFuncType.parameters[i].type;

      // Propagate expected type context to arguments
      propagateTypeContext(arg, paramType, validator);

      // Collection literals (array, map, set) can now be passed directly to any parameter
      // since they are all shared_ptr types in the C++ backend.
      // Class object literals are also allowed as they use make_shared.

      const argType = validateExpression(arg, validator);

      // For println, allow any printable type
      if (isPrintlnCall && i === 0) {
        if (!isPrintableType(argType)) {
          validator.addError(
            `Argument ${i + 1}: type '${typeToString(argType)}' cannot be printed`,
            arg.location
          );
        }
        // Mark type for JSON printing if it's a struct or class
        maybeMarkExprForJsonPrint(arg, argType, validator);
      } else {
        // Debug logging for Node type compatibility issues
        if (!isTypeCompatible(argType, paramType, validator)) {
          validator.addError(
            `Argument ${i + 1}: cannot convert '${typeToString(argType)}' to '${typeToString(paramType)}'`,
            arg.location
          );
        }
      }
    }

    // Check if this is an optional chaining method call
    const isOptionalChainCall = expr.callee.kind === 'optionalChain' &&
      (expr.callee as OptionalChainExpression).isMethodCall;

    let returnType = effectiveFuncType.returnType;
    if (isOptionalChainCall) {
      // For optional chaining method calls, the return type should be nullable
      returnType = makeNullableType(effectiveFuncType.returnType);
    }

    populateCallDispatchInfo(expr, validator);
    ensureCallInfo(expr, validator);

    expr.inferredType = returnType;
    return returnType;
  } else {
    validator.addError(`Expression is not callable`, expr.callee.location);
    expr.inferredType = createUnknownType();
    return expr.inferredType;
  }
}
