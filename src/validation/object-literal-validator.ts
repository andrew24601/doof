import { validateCallExpression } from "./call-expression-validator";
import { cloneTypeNode, substituteTypeParametersInType } from "./type-substitution";
import { validateExpression } from "./expression-validator";
import { getMemberPropertyName } from "./member-access-validator";
import { propagateTypeContext } from "./expression-validator";
import { getLiteralType } from "./literals-validator";
import { typeToString, isTypeCompatible, createUnknownType, createClassType, resolveActualType, commonTypes, validateRequiredFields, getPropertyKeyName, isStrictLiteral, validateEnumMember, createPrimitiveType, validateType } from "../type-utils";
import { Type, ObjectExpression, PositionalObjectExpression, CallExpression, Identifier, EnumShorthandMemberExpression, Expression, Parameter, ClassDeclaration, Literal, ArrayExpression, MapTypeNode, UnionTypeNode, SetTypeNode, EnumTypeNode, ClassTypeNode, ObjectProperty, TypeParameter } from "../types";
import { Validator } from "./validator";

export function validateObjectExpression(expr: ObjectExpression, validator: Validator): Type {
  // Special case: Check if validator is actually a named argument function call
  // If expr.className refers to a function, convert validator to a named argument call
  if (expr.className) {
    const funcDecl = validator.context.functions.get(expr.className);
    if (funcDecl) {
      // Convert ObjectExpression to CallExpression with named arguments
      const callExpr: CallExpression = {
        kind: 'call',
        callee: {
          kind: 'identifier',
          name: expr.className,
          location: expr.location
        } as Identifier,
        arguments: [],
        namedArguments: expr.properties,
        location: expr.location
      };

      // Validate as a call expression
      const returnType = validateCallExpression(callExpr, validator);

      // Update the AST node in place (validator is a bit of a hack, but works for validation)
      (expr as any).kind = 'call';
      (expr as any).callee = callExpr.callee;
      (expr as any).arguments = callExpr.arguments;
      (expr as any).namedArguments = callExpr.namedArguments;
      (expr as any).callInfo = callExpr.callInfo;
      (expr as any).callInfoSnapshot = callExpr.callInfoSnapshot;
      if (callExpr.intrinsicInfo) {
        (expr as any).intrinsicInfo = callExpr.intrinsicInfo;
      }
      if (callExpr.typeConversionInfo) {
        (expr as any).typeConversionInfo = callExpr.typeConversionInfo;
      }
      if (callExpr.enumConversionInfo) {
        (expr as any).enumConversionInfo = callExpr.enumConversionInfo;
      }
      // Copy named argument evaluation order metadata
      if (callExpr.namedArgumentsLexicalOrder) {
        (expr as any).namedArgumentsLexicalOrder = callExpr.namedArgumentsLexicalOrder;
      }
      if (callExpr.argumentEvaluationOrder) {
        (expr as any).argumentEvaluationOrder = callExpr.argumentEvaluationOrder;
      }

      expr.inferredType = returnType;
      return returnType;
    }


  }

  // Instant and other runtime-backed types are handled via the extern-class
  // system and intrinsic registries below. No ad-hoc special-casing
  // is required here.

  // Get expected enum type for keys if validator is a map
  let expectedEnumKeyType: EnumTypeNode | undefined;
  if (expr._expectedEnumKeyType) {
    expectedEnumKeyType = expr._expectedEnumKeyType;
  }

  // Check if we have expected union type context for disambiguation BEFORE validating properties
  const expectedUnionType = (expr as any)._expectedUnionType;
  if (!expr.className && expectedUnionType && expectedUnionType.kind === 'union') {
    // Try to disambiguate union object literal
    const disambiguation = disambiguateUnionObjectLiteral(expr, expectedUnionType, validator);
    if (disambiguation.success) {
      expr.className = disambiguation.targetClassName;
      expr.inferredType = disambiguation.targetType;
    } else {
      validator.addError(disambiguation.errorMessage, expr.location);
      expr.inferredType = createUnknownType();
      return expr.inferredType;
    }
  }

  let classDecl: ClassDeclaration | undefined;
  let typeMapping: Map<string, Type> | undefined;
  const typeDecl = expr.className ? validator.context.typeSymbols.get(expr.className) : undefined;

  if (typeDecl && typeDecl.kind === 'class') {
    classDecl = typeDecl;
    typeMapping = prepareClassGenericInstantiation(expr, classDecl, validator);
  }

  // Validate properties (now with proper className context if union was disambiguated)
  validateObjectProperties(validator, expr, expectedEnumKeyType, classDecl, typeMapping);

  if (expr.className) {
    // Object literal with class or struct type

    // Check for extern class construction attempt - allow extern classes that
    // expose intrinsic metadata (e.g. StringBuilder) to be
    // constructed via object literal or positional syntax. Otherwise reject.
    if (typeDecl && typeDecl.kind === 'externClass') {
      // Special case: StringBuilder is allowed to be constructed
      if (expr.className !== 'StringBuilder') {
        // Extern classes cannot be constructed via object literals since explicit constructors are not supported
        validator.addError(`Cannot construct extern class '${expr.className}' using object literal syntax. Use factory methods instead.`, expr.location);
        expr.inferredType = commonTypes.void;
        return expr.inferredType;
      }

      if (expr.properties.length > 0) {
        validator.addError(`StringBuilder object literal does not support property initializers`, expr.location);
      }

      expr.instantiationInfo = {
        targetClass: 'StringBuilder',
        fieldMappings: [],
        unmatchedProperties: expr.properties.map(prop => getPropertyKeyName(prop.key))
      };

      const instantiationKey = `${expr.className}_${expr.location?.start?.line || 0}_${expr.location?.start?.column || 0}`;
      validator.context.codeGenHints.objectInstantiations.set(instantiationKey, expr.instantiationInfo);

      // Allow StringBuilder construction and return its type
      const stringBuilderType = validator.context.symbols.get('StringBuilder');
      if (stringBuilderType) {
        expr.inferredType = stringBuilderType;
        return expr.inferredType;
      }
    }

    if (!typeDecl) {
      // Check if validator might be a missing import by looking for potential exported symbols
      const potentialExport = validator.context.globalContext?.exportedSymbols.get(expr.className);
      if (potentialExport) {
        validator.addError(`Class '${expr.className}' not defined. Did you forget to import it from '${potentialExport.sourceModule}'?`, expr.location);
      } else {
        validator.addError(`Class '${expr.className}' not defined`, expr.location);
      }
      expr.inferredType = commonTypes.void;
      return expr.inferredType;
    }

    if (typeDecl.kind === 'class') {
      // Enhanced validation for class literals
      validateClassLiteral(expr, typeDecl, validator, typeMapping);

      const resultGenerics = expr.genericInstantiation
        ? expr.genericInstantiation.typeArguments.map(arg => cloneTypeNode(arg))
        : expr.resolvedTypeArguments?.map(arg => cloneTypeNode(arg));

      expr.inferredType = createClassType(expr.className, resultGenerics);
      return expr.inferredType;
    } else {
      // validator should never happen because of the check above, but satisfies TypeScript
      throw new Error(`Internal error: neither struct nor class found for ${expr.className}`);
    }
  } else {
    // Generic object literal - check if it has been pre-inferred
    if (expr.inferredType) {
      return expr.inferredType;
    }

    validator.addError(`Object literal without class type not supported`, expr.location);
    expr.inferredType = createUnknownType();
    return expr.inferredType;
  }
}

export function validatePositionalObjectExpression(expr: PositionalObjectExpression, validator: Validator): Type {
  const className = expr.className;

  // Get the type declaration
  const typeDecl = validator.context.typeSymbols.get(className);

  if (!typeDecl) {
    validator.addError(`Type '${className}' not defined`, expr.location);
    expr.inferredType = createUnknownType();
    return expr.inferredType;
  }

  // Check for extern class construction attempt (but allow StringBuilder)
  if (typeDecl && typeDecl.kind === 'externClass') {
    // Special case: StringBuilder is allowed to be constructed
    if (className !== 'StringBuilder') {
      validator.addError(`Cannot construct extern class '${className}' using positional syntax. Use static factory methods instead.`, expr.location);
      expr.inferredType = createUnknownType();
      return expr.inferredType;
    }
    
    // For StringBuilder, validate arguments before returning
    // StringBuilder() takes no arguments, StringBuilder(capacity) takes one int argument
    if (expr.arguments.length > 1) {
      validator.addError(`StringBuilder constructor takes at most 1 argument (capacity), got ${expr.arguments.length}`, expr.location);
    }
    
    // Validate each argument
    for (let i = 0; i < expr.arguments.length; i++) {
      const arg = expr.arguments[i];
      const argType = validateExpression(arg, validator);
      
      // For StringBuilder(capacity), capacity should be an int
      if (i === 0 && !isTypeCompatible(argType, createPrimitiveType('int'), validator)) {
        validator.addError(
          `StringBuilder capacity argument must be an integer, got '${typeToString(argType)}'`,
          arg.location
        );
      }
    }
    
    // Allow StringBuilder construction and return its type
    const stringBuilderType = validator.context.symbols.get('StringBuilder');
    if (stringBuilderType) {
      expr.inferredType = stringBuilderType;
      return expr.inferredType;
    }
  }

  if (typeDecl) {
    switch (typeDecl.kind) {
      case 'class':
        return validateClassPositionalInitialization(expr, typeDecl, validator);
    }
  }

  // This should never happen
  expr.inferredType = createUnknownType();
  return expr.inferredType;
}

function buildTypeParameterMapping(instantiation?: { typeParameters: TypeParameter[]; typeArguments: Type[] }): Map<string, Type> | undefined {
  if (!instantiation) {
    return undefined;
  }

  const { typeParameters, typeArguments } = instantiation;
  if (typeParameters.length !== typeArguments.length) {
    return undefined;
  }

  const mapping = new Map<string, Type>();
  for (let i = 0; i < typeParameters.length; i++) {
    mapping.set(typeParameters[i].name, cloneTypeNode(typeArguments[i]));
  }
  return mapping;
}

function validateClassPositionalInitialization(expr: PositionalObjectExpression, classDecl: ClassDeclaration, validator: Validator): Type {
  const typeMapping = buildTypeParameterMapping(expr.genericInstantiation);

  const fields = classDecl.fields.filter(f => !f.isStatic && f.isPublic);

  const targets = fields.map(field => ({
    name: field.name.name,
    type: typeMapping ? substituteTypeParametersInType(field.type, typeMapping) : field.type,
    hasDefault: !!field.defaultValue
  }));

  validatePositionalArguments(expr, targets, 'class', validator);

  const resultGenerics = expr.genericInstantiation
    ? expr.genericInstantiation.typeArguments.map(arg => cloneTypeNode(arg))
    : expr.resolvedTypeArguments?.map(arg => cloneTypeNode(arg));

  expr.inferredType = createClassType(expr.className, resultGenerics);
  return expr.inferredType;
}

function prepareClassGenericInstantiation(
  expr: ObjectExpression,
  classDecl: ClassDeclaration,
  validator: Validator
): Map<string, Type> | undefined {
  const typeParams = classDecl.typeParameters ?? [];

  if (typeParams.length === 0) {
    if (expr.typeArguments && expr.typeArguments.length > 0) {
      validator.addError(`Class '${classDecl.name.name}' does not accept type arguments`, expr.location);
    }
    return undefined;
  }

  let providedArgs = expr.typeArguments ?? [];

  if (providedArgs.length === 0 && expr.inferredType && expr.inferredType.kind === 'class') {
    const inferredClass = expr.inferredType as ClassTypeNode;
    if (inferredClass.typeArguments && inferredClass.typeArguments.length === typeParams.length) {
      providedArgs = inferredClass.typeArguments.map(arg => cloneTypeNode(arg));
      expr.typeArguments = providedArgs;
    }
  }

  if (providedArgs.length === 0) {
    validator.addError(
      `Class '${classDecl.name.name}' requires ${typeParams.length} type ${typeParams.length === 1 ? 'argument' : 'arguments'}`,
      expr.location
    );
    return undefined;
  }

  if (providedArgs.length !== typeParams.length) {
    validator.addError(
      `Class '${classDecl.name.name}' expects ${typeParams.length} type ${typeParams.length === 1 ? 'argument' : 'arguments'} but got ${providedArgs.length}`,
      expr.location
    );
    return undefined;
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

  expr.resolvedTypeArguments = normalizedArgs.map(arg => cloneTypeNode(arg));
  expr.genericInstantiation = {
    typeParameters: typeParams,
    typeArguments: expr.resolvedTypeArguments
  };

  return mapping;
}

function validatePositionalArguments(
  expr: PositionalObjectExpression,
  targets: Array<{ name: string; type: Type; hasDefault: boolean }>,
  contextName: string,
  validator: Validator
): void {
  // Check that we don't have more arguments than targets
  if (expr.arguments.length > targets.length) {
    validator.addError(`Too many arguments for ${contextName} '${expr.className}': expected at most ${targets.length}, got ${expr.arguments.length}`, expr.location);
  }

  // Validate each argument against the corresponding target type
  for (let i = 0; i < Math.min(expr.arguments.length, targets.length); i++) {
    const arg = expr.arguments[i];
    const target = targets[i];

    // Propagate expected type context
    propagateTypeContext(arg, target.type, validator);

    const argType = validateExpression(arg, validator);
    if (!isTypeCompatible(argType, target.type, validator)) {
      validator.addError(
        `Argument ${i + 1}: cannot convert '${typeToString(argType)}' to '${typeToString(target.type)}' (${contextName.includes('parameter') ? 'parameter' : 'field'} '${target.name}')`,
        arg.location
      );
    }
  }

  // Check that all required targets (those without defaults) are provided
  for (let i = expr.arguments.length; i < targets.length; i++) {
    const target = targets[i];
    if (!target.hasDefault) {
      const targetType = contextName.includes('parameter') ? 'parameter' : 'field';
      validator.addError(`Missing argument for required ${targetType} '${target.name}'`, expr.location);
    }
  }
}


function validateClassLiteral(
  expr: ObjectExpression,
  classDecl: ClassDeclaration,
  validator: Validator,
  typeMapping?: Map<string, Type>
): void {
  const providedProps = expr.properties.map(p => getPropertyKeyName(p.key));
  const providedPropsSet = new Set(providedProps);

  for (const property of expr.properties) {
    const propertyName = getPropertyKeyName(property.key);
    const field = classDecl.fields.find(f => f.name.name === propertyName);
    
    if (field && !field.isPublic) {
      if (!validator.isPrivateMemberAccessible(field.isPublic, classDecl.name.name)) {
        validator.addError(`Cannot access private field '${field.name.name}' outside class`, property.location);
      }
    }
  }

  validateConstFieldRequirements(expr, classDecl, validator);

  expr.instantiationInfo = {
    targetClass: classDecl.name.name,
    fieldMappings: [],
    unmatchedProperties: []
  };

  validateAggregateInitialization(expr, classDecl, providedPropsSet, validator);

  expr.instantiationInfo.fieldMappings = classDecl.fields
    .filter(field => !field.isStatic)
    .map(field => ({
      fieldName: field.name.name,
      type: typeMapping ? substituteTypeParametersInType(field.type, typeMapping) : field.type,
      defaultValue: field.defaultValue
    }));
  
  expr.instantiationInfo.unmatchedProperties = providedProps;

  const instantiationKey = `${expr.className}_${expr.location?.start?.line || 0}_${expr.location?.start?.column || 0}`;
  validator.context.codeGenHints.objectInstantiations.set(instantiationKey, expr.instantiationInfo);
}

function validateAggregateInitialization(expr: ObjectExpression, classDecl: ClassDeclaration, providedPropsSet: Set<string>, validator: Validator): void {
  // For aggregate initialization, we allow flexible field ordering but only public fields
  // Note: validateRequiredFields checks for missing required fields, but private fields
  // should not be required in object literals
  const publicFields = classDecl.fields.filter(f => f.isPublic);
  validateRequiredFields(publicFields, providedPropsSet, false, expr.location, validator);
}


function validateConstFieldRequirements(expr: ObjectExpression, classDecl: ClassDeclaration, validator: Validator): void {
  const providedProps = new Map<string, Expression>();

  // Build a map of provided properties
  for (const prop of expr.properties) {
    const keyName = getPropertyKeyName(prop.key);
    if (prop.value) {
      providedProps.set(keyName, prop.value);
    }
  }

  // Check all const fields
  for (const field of classDecl.fields) {
    if (field.isConst) {
      const propValue = providedProps.get(field.name.name);

      if (!propValue) {
        validator.addError(`Const field '${field.name.name}' must be present in object literal`, expr.location);
        continue;
      }

      // Validate that the provided value is a literal and matches the declared value
      if (!isStrictLiteral(propValue) && !isEnumMemberExpression(propValue, validator)) {
        validator.addError(`Const field '${field.name.name}' must be assigned a literal value`, expr.location);
        continue;
      }

      // If the field has a default value, ensure it matches
      if (field.defaultValue) {
        if (!areLiteralsEqual(propValue, field.defaultValue)) {
          validator.addError(`Const field '${field.name.name}' value must match declared value`, expr.location);
        }
      }
    }
  }
}

function areLiteralsEqual(expr1: Expression, expr2: Expression): boolean {
  if (expr1.kind === 'literal' && expr2.kind === 'literal') {
    return expr1.value === expr2.value;
  }
  if (expr1.kind === 'enumShorthand' && expr2.kind === 'enumShorthand') {
    return expr1.memberName === expr2.memberName;
  }
  return false;
}

function isEnumMemberExpression(expr: Expression, validator: Validator): boolean {
  // Check for enum member access: identifier.member
  if (expr.kind === 'member') {
    const memberExpr = expr as any;
    if (memberExpr.object.kind === 'identifier' && !memberExpr.computed) {
      const enumName = memberExpr.object.name;
      return validator.context.enums.has(enumName);
    }
  }

  // Check for enum shorthand: .member
  if (expr.kind === 'enumShorthand') {
    return true; // Validation of enum member happens elsewhere
  }

  return false;
}

// Helper method for validating object expression properties
function validateObjectProperties(
  validator: Validator,
  expr: ObjectExpression,
  expectedEnumKeyType?: EnumTypeNode,
  classDecl?: ClassDeclaration,
  typeMapping?: Map<string, Type>
): void {
  for (const prop of expr.properties) {
    // Validate the property key if it's an expression (like enum member access or shorthand)
    if (prop.key.kind === 'member') {
      validateExpression(prop.key, validator);
    } else if (prop.key.kind === 'enumShorthand') {
      const shorthandExpr = prop.key as EnumShorthandMemberExpression;
      if (!expectedEnumKeyType) {
        validator.addError(`Enum shorthand '.${shorthandExpr.memberName}' requires explicit enum type context`, prop.key.location);
      } else {
        validateEnumMember(expectedEnumKeyType, shorthandExpr.memberName, prop.key.location, validator);
      }
    }

    if (prop.value) {
      // Propagate expected enum type to property values for struct/class fields
      if (expr.className) {
        const effectiveClassDecl = classDecl ?? validator.context.classes.get(expr.className);

        if (effectiveClassDecl) {
          const fieldName = getPropertyKeyName(prop.key);
          const fieldDecl = effectiveClassDecl.fields.find(f => f.name.name === fieldName);

          if (fieldDecl) {
            let fieldType = fieldDecl.type;
            if (typeMapping) {
              fieldType = substituteTypeParametersInType(fieldType, typeMapping);
            }
            resolveActualType(fieldType, validator, expr.location);
            propagateTypeContext(prop.value, fieldType, validator);
          }
        }
      }

      validateExpression(prop.value, validator);
    } else if (prop.shorthand) {
      // For shorthand syntax, validate that the identifier exists in scope
      if (prop.key.kind === 'identifier') {
        const identifierType = validator.context.symbols.get(prop.key.name);
        if (!identifierType) {
          validator.addError(`Undefined identifier '${prop.key.name}' in shorthand property`, expr.location);
        }
      }
    }
  }
}

export function canInferObjectLiteralType(objExpr: ObjectExpression, expectedType: Type): boolean {
  if (expectedType.kind === 'map' || expectedType.kind === 'set' || expectedType.kind === 'class') {
    return true;
  }

  // Handle union types - can infer if union contains only class types
  if (expectedType.kind === 'union') {
    const unionType = expectedType as UnionTypeNode;
    return unionType.types.every(t => t.kind === 'class');
  }

  return false;
}

export function inferObjectLiteralType(objExpr: ObjectExpression, expectedType: Type, validator: Validator): void {
  if (expectedType.kind === 'map') {
    // For map types, validate that all keys and values match the expected types
    const mapType = expectedType as MapTypeNode;

    // Validate each property
    for (const prop of objExpr.properties) {
      if (prop.key.kind === 'literal') {
        const keyType = getLiteralType(prop.key as Literal);
        if (!isTypeCompatible(keyType, mapType.keyType, validator)) {
          validator.addError(
            `Map key type '${typeToString(keyType)}' is not compatible with expected key type '${typeToString(mapType.keyType)}'`,
            objExpr.location
          );
        }
      }

      if (prop.value) {
        const valueType = validateExpression(prop.value, validator);
        if (!isTypeCompatible(valueType, mapType.valueType, validator)) {
          validator.addError(
            `Map value type '${typeToString(valueType)}' is not compatible with expected value type '${typeToString(mapType.valueType)}'`,
            objExpr.location
          );
        }
      }
    }

    objExpr.inferredType = expectedType;
    objExpr.className = undefined; // Clear className for map literals
  } else if (expectedType.kind === 'set') {
    // For set types, validate that all elements match the expected element type
    const setType = expectedType as SetTypeNode;

    // Validate each property as a set element
    for (const prop of objExpr.properties) {
      if (prop.value) {
        const elementType = validateExpression(prop.value, validator);
        if (!isTypeCompatible(elementType, setType.elementType, validator)) {
          validator.addError(
            `Set element type '${typeToString(elementType)}' is not compatible with expected element type '${typeToString(setType.elementType)}'`,
            objExpr.location
          );
        }
      }
    }

    objExpr.inferredType = expectedType;
    objExpr.className = undefined; // Clear className for set literals
  } else if (expectedType.kind === 'class') {
    // Infer the class name from the expected type
    const classType = expectedType as any;
    objExpr.className = classType.name;
    objExpr.inferredType = expectedType;
  } else if (expectedType.kind === 'union') {
    // For union types, try to disambiguate which member the object literal represents
    const disambiguation = disambiguateUnionObjectLiteral(objExpr, expectedType, validator);
    if (disambiguation.success) {
      objExpr.className = disambiguation.targetClassName;
      objExpr.inferredType = disambiguation.targetType;
    } else {
      validator.addError(disambiguation.errorMessage, objExpr.location);
      objExpr.inferredType = createUnknownType();
    }
  }
}

/**
 * Disambiguates which union member an object literal should represent.
 * Uses a two-step process:
 * 1. Preflight filter: Filter candidates based on const field matches
 * 2. Field validation: Check if exactly one candidate can be instantiated from the object literal
 */
export function disambiguateUnionObjectLiteral(objExpr: ObjectExpression, unionType: UnionTypeNode, validator: Validator): {
  success: boolean;
  targetClassName?: string;
  targetType?: Type;
  errorMessage: string;
} {
  const candidates: Array<{ type: Type; declaration: ClassDeclaration }> = [];

  // Collect all class/struct candidates from the union
  for (const memberType of unionType.types) {
    if (memberType.kind === 'class') {
      const classType = memberType as ClassTypeNode;
      const classDecl = validator.context.classes.get(classType.name);
      if (classDecl) {
        candidates.push({ type: memberType, declaration: classDecl });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      success: false,
      errorMessage: 'Union type contains no constructible class types'
    };
  }

  // Step 1: Preflight filter based on const fields
  const providedPropsMap = new Map<string, Expression>();
  for (const prop of objExpr.properties) {
    const keyName = getPropertyKeyName(prop.key);
    if (prop.value) {
      providedPropsMap.set(keyName, prop.value);
    }
  }

  let filteredCandidates = candidates.filter(candidate => {

    // check const field matches
    for (const field of candidate.declaration.fields) {
      if (field.isConst && field.defaultValue) {
        const providedValue = providedPropsMap.get(field.name.name);
        if (providedValue) {
          // Check if const field value matches
          if (!isConstFieldValueMatch(field.defaultValue, providedValue)) {
            return false; // Const field mismatch, exclude this candidate
          }
        }
      }
    }
    return true;
  });

  // Step 2: Field validation
  const validCandidates = filteredCandidates.filter(candidate => {
    return canConstructFromObjectLiteral(objExpr, candidate.declaration, validator);
  });

  if (validCandidates.length === 0) {
    if (filteredCandidates.length === 0) {
      return {
        success: false,
        errorMessage: `Object literal does not match any union member based on const field values. Available types: ${candidates.map(c => c.declaration.name.name).join(', ')}`
      };
    } else {
      return {
        success: false,
        errorMessage: `Object literal fields do not match any union member. Available types: ${filteredCandidates.map(c => c.declaration.name.name).join(', ')}`
      };
    }
  }

  if (validCandidates.length > 1) {
    return {
      success: false,
      errorMessage: `Object literal is ambiguous and matches multiple union members: ${validCandidates.map(c => c.declaration.name.name).join(', ')}`
    };
  }

  // Success - exactly one candidate
  const targetCandidate = validCandidates[0];
  return {
    success: true,
    targetClassName: targetCandidate.declaration.name.name,
    targetType: targetCandidate.type,
    errorMessage: ''
  };
}

/**
 * Checks if a const field's default value matches the provided value in an object literal.
 */
function isConstFieldValueMatch(defaultValue: Expression, providedValue: Expression): boolean {
  // Simple implementation: compare literal values directly
  if (defaultValue.kind === 'literal' && providedValue.kind === 'literal') {
    const defaultLit = defaultValue as Literal;
    const providedLit = providedValue as Literal;
    return defaultLit.value === providedLit.value;
  }
  return false;
}

/**
 * Checks if an object literal can be used to construct a given class.
 */
function canConstructFromObjectLiteral(objExpr: ObjectExpression, declaration: ClassDeclaration, validator: Validator): boolean {
  const providedProps = new Set(objExpr.properties.map(p => getPropertyKeyName(p.key)));

  const classDecl = declaration as ClassDeclaration;

  // Since explicit constructors are removed, use field matching
  const requiredFields = classDecl.fields.filter(f => !f.isStatic && f.isPublic && !f.defaultValue);
  return requiredFields.every(field => providedProps.has(field.name.name));
}