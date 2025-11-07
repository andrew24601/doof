import { validateIdentifier } from "./declaration-validator";
import { getMapMethodType, getSetMethodType, getArrayMethodType, getStringMethodType, getMathMethodType } from "./intrinsics-validator";
import { validateExpression } from "./expression-validator";
import { buildMemberExpressionAccessPath } from "./narrowing-utils";
import { typeToString, isTypeCompatible, createEnumType, createUnknownType, createFunctionType, resolveActualType, createPrimitiveType, commonTypes, isTypeEqual, isMethodSignatureEqual } from "../type-utils";
import { Type, MemberExpression, IndexExpression, ArrayTypeNode, MapTypeNode, SetTypeNode, PrimitiveTypeNode, UnionTypeNode, FunctionTypeNode, Identifier, Literal, Expression, ClassTypeNode, ClassDeclaration } from "../types";
import { Validator } from "./validator";
import { cloneTypeNode, substituteTypeParametersInType } from "./type-substitution";

export function validateMemberExpression(expr: MemberExpression, validator: Validator): Type {
  // Handle computed member access (indexing)
  if (expr.computed) {
    const objectType = validateExpression(expr.object, validator);
    const indexType = validateExpression(expr.property as Expression, validator);

    if (objectType.kind === 'array') {
      const arrayType = objectType as ArrayTypeNode;
      // Check index type is numeric
      if (indexType.kind !== 'primitive' || (indexType as PrimitiveTypeNode).type !== 'int') {
        validator.addError(`Array index must be of type 'int'`, (expr.property as Expression).location);
      }
      expr.inferredType = arrayType.elementType;
      return arrayType.elementType;
    } else if (objectType.kind === 'map') {
      const mapType = objectType as MapTypeNode;
      // Check index type matches key type
      if (!isTypeCompatible(indexType, mapType.keyType, validator)) {
        validator.addError(`Map index type '${typeToString(indexType)}' is not compatible with key type '${typeToString(mapType.keyType)}'`, (expr.property as Expression).location);
      }

      expr.inferredType = mapType.valueType;
      return mapType.valueType;
    } else {
      validator.addError(`Cannot index into type '${typeToString(objectType)}'`, expr.object.location);
      expr.inferredType = createUnknownType();
      return expr.inferredType;
    }
  }

  // Special case: check if validator is a static method call (ClassName.methodName)
  if (expr.object.kind === 'identifier') {
    const objName = (expr.object as Identifier).name;
    const memberName = getMemberPropertyName(expr.property);
    const staticMethodKey = `${objName}.${memberName}`;

    // Check if validator is a static method call
    const staticMethodType = validator.context.symbols.get(staticMethodKey);
    if (staticMethodType && staticMethodType.kind === 'function') {
      // IMPORTANT: Validate the object identifier to ensure its inferredType is set
      // This ensures that class identifiers in static method calls have their types inferred
      validateExpression(expr.object, validator);
      
      if (memberName === 'fromJSON') {
        maybeMarkTypeForJsonFrom(objName, validator);
      }
      expr.inferredType = staticMethodType;
      return staticMethodType;
    }

    // Check if this is enum member access, class static access, or extern class static access
    const typeDecl = validator.context.typeSymbols.get(objName);
    if (typeDecl) {
      switch (typeDecl.kind) {
        case 'enum':
          // This is enum member access
          const enumMember = typeDecl.members.find(m => m.name.name === memberName);
          if (enumMember) {
            // Return the enum type
            const enumType = createEnumType(objName);
            expr.inferredType = enumType;
            return enumType;
          } else {
            validator.addError(`Enum '${objName}' has no member '${memberName}'`, expr.property.location);
            expr.inferredType = createUnknownType();
            return expr.inferredType;
          }

        case 'class':
          // Look for static method
          const method = typeDecl.methods.find(m => m.name.name === memberName && m.isStatic);
          if (method) {
            // IMPORTANT: Validate the object identifier to ensure its inferredType is set
            validateExpression(expr.object, validator);
            
            const funcType = createFunctionType(
              method.parameters.map(p => ({ name: p.name.name, type: p.type })),
              method.returnType
            );
            // If this is a static fromJSON call, mark the target type for JSON-from helper generation
            if (memberName === 'fromJSON') {
              maybeMarkTypeForJsonFrom(typeDecl.name.name, validator);
            }
            // Resolve type aliases in the function type
            resolveActualType(funcType, validator, expr.location);
            expr.inferredType = funcType;
            return funcType;
          }

          // Look for static field
          const field = typeDecl.fields.find(f => f.name.name === memberName && f.isStatic);
          if (field) {
            // IMPORTANT: Validate the object identifier to ensure its inferredType is set
            validateExpression(expr.object, validator);
            
            expr.inferredType = field.type;
            return field.type;
          }

          validator.addError(`Static member '${memberName}' does not exist on class '${objName}'`, expr.property.location);
          expr.inferredType = createUnknownType();
          return expr.inferredType;

        case 'externClass':
          // Look for static method
          const externMethod = typeDecl.methods.find(m => m.name.name === memberName && m.isStatic);
          if (externMethod) {
            // IMPORTANT: Validate the object identifier to ensure its inferredType is set
            validateExpression(expr.object, validator);
            
            const funcType = createFunctionType(
              externMethod.parameters.map(p => ({ name: p.name.name, type: p.type })),
              externMethod.returnType
            );
            if (memberName === 'fromJSON') {
              maybeMarkTypeForJsonFrom(typeDecl.name.name, validator);
            }
            // Resolve type aliases in the function type
            resolveActualType(funcType, validator, expr.location);
            expr.inferredType = funcType;
            return funcType;
          }

          // Look for static field
          const externField = typeDecl.fields.find(f => f.name.name === memberName && f.isStatic);
          if (externField) {
            // IMPORTANT: Validate the object identifier to ensure its inferredType is set
            validateExpression(expr.object, validator);
            
            expr.inferredType = externField.type;
            return externField.type;
          }

          validator.addError(`Static member '${memberName}' does not exist on extern class '${objName}'`, expr.property.location);
          expr.inferredType = createUnknownType();
          return expr.inferredType;
      }
    }
  }

  // Regular member access on objects
  const objectType = validateExpression(expr.object, validator);

  // Handle intrinsic/collection methods via helper
  const memberName = getMemberPropertyName(expr.property);

  // First, handle map/array/string intrinsic methods
  if (objectType.kind === 'map') {
    const mapMethodType = getMapMethodType(memberName, objectType as MapTypeNode);
    if (mapMethodType) {
      expr.inferredType = mapMethodType;
      return mapMethodType;
    }
    validator.addError(`Unknown map method '${memberName}'`, expr.property.location);
    expr.inferredType = createUnknownType();
    return expr.inferredType;
  }

  if (objectType.kind === 'array') {
    const arrayMethodType = getArrayMethodType(memberName, objectType as ArrayTypeNode);
    if (arrayMethodType) {
      expr.inferredType = arrayMethodType;
      return arrayMethodType;
    }
    validator.addError(`Unknown array method '${memberName}'`, expr.property.location);
    expr.inferredType = createUnknownType();
    return expr.inferredType;
  }

  if (objectType.kind === 'set') {
    const setMethodType = getSetMethodType(memberName, objectType as SetTypeNode);
    if (setMethodType) {
      expr.inferredType = setMethodType;
      return setMethodType;
    }
    validator.addError(`Unknown set method '${memberName}'`, expr.property.location);
    expr.inferredType = createUnknownType();
    return expr.inferredType;
  }

  if (objectType.kind === 'primitive' && (objectType as PrimitiveTypeNode).type === 'string') {
    const stringMethodType = getStringMethodType(memberName);
    if (stringMethodType) {
      expr.inferredType = stringMethodType;
      return stringMethodType;
    }
    validator.addError(`Unknown string method '${memberName}'`, expr.property.location);
    // Return unknown type instead of making assumptions
    expr.inferredType = createUnknownType();
    return expr.inferredType;
  }

  // Handle built-in class-like objects (Math) and then instance members
  if (objectType.kind === 'class' || objectType.kind === 'externClass') {
    const className = objectType.name;
    if (className === 'Math') {
      const mathMethodType = getMathMethodType(memberName);
      if (mathMethodType) {
        expr.inferredType = mathMethodType;
        return mathMethodType;
      }
      validator.addError(`Unknown Math method '${memberName}'`, expr.property.location);
      expr.inferredType = createUnknownType();
      return expr.inferredType;
    }

    // Time/date types are handled via extern-class metadata and instance
    // method declarations; no ad-hoc special-casing is used here.

    // Now fall through to instance member resolution
    const typeDecl = validator.context.typeSymbols.get(className);
    if (typeDecl && (typeDecl.kind === 'class' || typeDecl.kind === 'externClass')) {
      const typeMapping = typeDecl.kind === 'class' && objectType.kind === 'class'
  ? buildTypeParameterMapping(typeDecl, objectType as ClassTypeNode)
        : undefined;
      // Special case: prioritize intrinsic registry for StringBuilder methods
      if (className === 'StringBuilder') {
        const intrinsicKey = `${className}.${memberName}`;
        const intrinsicDef = validator.intrinsicRegistry.get(intrinsicKey);
        if (intrinsicDef && intrinsicDef.overloads && intrinsicDef.overloads.length > 0) {
          const first = intrinsicDef.overloads[0];
          const funcType = createFunctionType(first.paramTypes.map((t, i) => ({ name: `arg${i + 1}`, type: t })), first.returnType([]));
          expr.inferredType = funcType;
          return funcType;
        }
      }

      // Look for instance field (non-static)
      const field = typeDecl.fields.find(f => f.name.name === memberName && !f.isStatic);
      if (field) {
        if (typeDecl.kind === 'class' && !validator.isPrivateMemberAccessible(field.isPublic, className)) {
          validator.addError(`Cannot access private field '${field.name.name}' outside class '${className}'`, expr.property.location);
        }
        const resolvedFieldType = typeDecl.kind === 'class' && typeMapping
          ? substituteTypeParametersInType(field.type, typeMapping)
          : field.type;
        return finalizeMemberType(expr, resolvedFieldType, validator);
      }

      // Look for instance method (non-static)
      if (typeDecl.kind === 'class' || typeDecl.kind === 'externClass') {
        const method = typeDecl.methods.find(m => m.name.name === memberName && !m.isStatic);
        if (method) {
          if (typeDecl.kind === 'class' && !validator.isPrivateMemberAccessible(method.isPublic, className)) {
            validator.addError(`Cannot access private method '${method.name.name}' outside class '${className}'`, expr.property.location);
          }
          const funcType = createFunctionType(
            method.parameters.map(p => ({
              name: p.name.name,
              type: typeDecl.kind === 'class' && typeMapping
                ? substituteTypeParametersInType(p.type, typeMapping)
                : p.type
            })),
            typeDecl.kind === 'class' && typeMapping
              ? substituteTypeParametersInType(method.returnType, typeMapping)
              : method.returnType
          );
          expr.inferredType = funcType;
          return funcType;
        }

        // If no method/field found on extern class, check intrinsic registry for mappings
        const intrinsicKey = `${className}.${memberName}`;
        const intrinsicDef = validator.intrinsicRegistry.get(intrinsicKey);
        if (intrinsicDef && intrinsicDef.overloads && intrinsicDef.overloads.length > 0) {
          const first = intrinsicDef.overloads[0];
          const funcType = createFunctionType(first.paramTypes.map((t, i) => ({ name: `arg${i + 1}`, type: t })), first.returnType([]));
          expr.inferredType = funcType;
          return funcType;
        }
      }

      validator.addError(`Property '${memberName}' does not exist on type '${className}'`, expr.property.location);
      expr.inferredType = createUnknownType();
      return expr.inferredType;
    } else {
      validator.addError(`Unknown class '${className}'`, expr.object.location);
      expr.inferredType = createUnknownType();
      return expr.inferredType;
    }
  } else if (objectType.kind === 'union') {
    // Handle union common-member access
    const unionType = objectType as UnionTypeNode;
    const memberName = getMemberPropertyName(expr.property);

    // Check if all variants have the member with identical type
    const memberTypes: Type[] = [];
    const methodSignatures: FunctionTypeNode[] = [];
    let allHaveMember = true;
    let allAreFields = true;
    let allAreMethods = true;

    for (const variantType of unionType.types) {
      let foundMember = false;
      let memberType: Type | undefined;
      let isMethod = false;

      // Check each variant type for the member using TypeSymbolTable
      // Only handle named types (class, struct, etc.)
      if (variantType.kind === 'class' || variantType.kind === 'externClass') {
        const typeName = (variantType as any).name; // Type assertion since we checked the kind
        const typeDecl = validator.context.typeSymbols.get(typeName);
        if (typeDecl) {
          if (typeDecl.kind === 'class') {
            // Look for field
            const field = typeDecl.fields.find(f => f.name.name === memberName);
            if (field) {
              foundMember = true;
              memberType = field.type;
            } else {
              // Look for method
              const method = typeDecl.methods.find(m => m.name.name === memberName);
              if (method) {
                foundMember = true;
                isMethod = true;
                memberType = createFunctionType(
                  method.parameters.map(p => ({ name: p.name.name, type: p.type })),
                  method.returnType
                );
              }
            }
          }
        }
      }

      if (!foundMember) {
        allHaveMember = false;
        break;
      }

      if (isMethod) {
        allAreFields = false;
        methodSignatures.push(memberType as FunctionTypeNode);
      } else {
        allAreMethods = false;
        memberTypes.push(memberType!);
      }
    }

    if (!allHaveMember) {
      validator.addError(`Not all variants of union type have member '${memberName}'`, expr.property.location);
    } else if (!allAreFields && !allAreMethods) {
      validator.addError(`Member '${memberName}' is not consistently a field or method across all union variants`, expr.property.location);
    } else if (allAreFields) {
      // Check that all field types are identical
      const firstType = memberTypes[0];
      const allIdentical = memberTypes.every(t => isTypeEqual(t, firstType));

      if (!allIdentical) {
        validator.addError(`Member '${memberName}' has different types across union variants. All types must be identical.`, expr.property.location);
      } else {
  return finalizeMemberType(expr, firstType, validator);
      }
    } else if (allAreMethods) {
      // Check that all method signatures are identical
      const firstSignature = methodSignatures[0];
      const allIdentical = methodSignatures.every(sig => isMethodSignatureEqual(sig, firstSignature));

      if (!allIdentical) {
        validator.addError(`Method '${memberName}' has different signatures across union variants. All signatures must be identical.`, expr.property.location);
      } else {
        expr.inferredType = firstSignature;
        return firstSignature;
      }
    }
  } else {
    validator.addError(`Cannot access property on non-object type`, expr.object.location);
  }

  expr.inferredType = createUnknownType();
  return expr.inferredType;
}

function buildTypeParameterMapping(classDecl: ClassDeclaration, instanceType: ClassTypeNode): Map<string, Type> | undefined {
  const typeParams = classDecl.typeParameters ?? [];
  if (typeParams.length === 0) {
    return undefined;
  }

  const typeArgs = instanceType.typeArguments ?? [];
  if (typeArgs.length !== typeParams.length) {
    return undefined;
  }

  const mapping = new Map<string, Type>();
  for (let i = 0; i < typeParams.length; i++) {
    mapping.set(typeParams[i].name, cloneTypeNode(typeArgs[i]));
  }
  return mapping;
}

function finalizeMemberType(expr: MemberExpression, resolvedType: Type, validator: Validator): Type {
  const path = buildMemberExpressionAccessPath(expr);
  if (path) {
    const narrowedType = validator.context.propertyNarrowings.get(path);
    if (narrowedType) {
      expr.inferredType = narrowedType;
      return narrowedType;
    }
  }

  expr.inferredType = resolvedType;
  return resolvedType;
}

export function validateIndexExpression(expr: IndexExpression, validator: Validator): Type {
  const objectType = validateExpression(expr.object, validator);
  const indexType = validateExpression(expr.index, validator);

  if (objectType.kind === 'array') {
    const arrayType = objectType as ArrayTypeNode;
    // Check index type is numeric
    if (indexType.kind !== 'primitive' || (indexType as PrimitiveTypeNode).type !== 'int') {
      validator.addError(`Array index must be of type 'int'`, expr.index.location);
    }
    expr.inferredType = arrayType.elementType;
    return arrayType.elementType;
  } else if (objectType.kind === 'map') {
    const mapType = objectType as MapTypeNode;
    // Check index type matches key type
    if (!isTypeCompatible(indexType, mapType.keyType, validator)) {
      validator.addError(`Map index type '${typeToString(indexType)}' is not compatible with key type '${typeToString(mapType.keyType)}'`, expr.index.location);
    }

    expr.inferredType = mapType.valueType;
    return mapType.valueType;
  } else if (objectType.kind === 'primitive' && (objectType as PrimitiveTypeNode).type === 'string') {
    // String indexing returns char
    if (indexType.kind !== 'primitive' || (indexType as PrimitiveTypeNode).type !== 'int') {
      validator.addError(`String index must be of type 'int'`, expr.index.location);
    }
    expr.inferredType = commonTypes.char;
    return commonTypes.char;
  } else {
    // For non-array, non-map, non-string objects, reject computed property access (identifier-based indexing)
    if (expr.index.kind === 'identifier') {
      validator.addError("computed property name expressions are not supported in property access", expr.index.location);
      expr.inferredType = createUnknownType();
      return expr.inferredType;
    }

    validator.addError(`Cannot index into type '${typeToString(objectType)}'`, expr.object.location);
    expr.inferredType = createUnknownType();
    return expr.inferredType;
  }
}

export function getMemberPropertyName(property: Identifier | Literal): string {
  if (property.kind === 'identifier') {
    return property.name;
  } else if (property.kind === 'literal' && property.literalType === 'string') {
    return property.value as string;
  } else {
    throw new Error(`Invalid property type: ${property.kind}`);
  }
}

function maybeMarkTypeForJsonFrom(typeName: string, validator: Validator) {
  // Use a set to track visited types to avoid infinite recursion
  const visited = new Set<string>();
  markTypeForJsonFrom(typeName, validator, visited);
}

// Public utility invoked when a static fromJSON method is referenced so that
// code generation knows to emit fromJSON/_fromJSON implementations for the
// declaring class and all of its transitive field member types.
export function markTypeForJsonFromEntry(typeName: string, validator: Validator) {
  maybeMarkTypeForJsonFrom(typeName, validator);
}

function markTypeForJsonFrom(typeName: string, validator: Validator, visited: Set<string>) {
  if (visited.has(typeName)) return; // Avoid infinite recursion
  visited.add(typeName);

  validator.context.codeGenHints.jsonFromTypes.add(typeName);

  // Recursively mark field types for classes
  const classDecl = validator.context.classes.get(typeName);
  if (classDecl) {
    for (const field of classDecl.fields) {
      markFieldTypeForJsonFrom(field.type, validator, visited);
    }
    return;
  }
}

function markFieldTypeForJsonFrom(type: Type, validator: Validator, visited: Set<string>) {
  if (!type) return;

  switch (type.kind) {
    case 'class':
      markTypeForJsonFrom(type.name, validator, visited);
      break;
    case 'array':
      markFieldTypeForJsonFrom(type.elementType, validator, visited);
      break;
    case 'map':
      markFieldTypeForJsonFrom(type.valueType, validator, visited);
      markFieldTypeForJsonFrom(type.keyType, validator, visited);
      break;
    case 'set':
      markFieldTypeForJsonFrom(type.elementType, validator, visited);
      break;
    case 'union':
      for (const t of (type as any).types) markFieldTypeForJsonFrom(t, validator, visited);
      break;
    default:
      break;
  }
}
