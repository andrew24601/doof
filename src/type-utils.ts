import { isEnumMemberExpression } from "./validation/expression-validator";
import { Type, PrimitiveTypeNode, ClassTypeNode, ExternClassTypeNode, EnumTypeNode, ArrayTypeNode, MapTypeNode, SetTypeNode, FunctionTypeNode, UnionTypeNode, TypeAliasNode, Expression, ObjectExpression, ArrayExpression, Literal, MemberExpression, Identifier, FieldDeclaration, SourceLocation, UnknownTypeNode, EnumShorthandMemberExpression, RangeTypeNode, TypeParameter, TypeParameterTypeNode } from "./types";
import { Validator } from "./validation/validator";

// Cache commonly used types to avoid repeated creation
export const commonTypes = {
  void: { kind: 'primitive', type: 'void' },
  int: { kind: 'primitive', type: 'int' },
  float: { kind: 'primitive', type: 'float' },
  double: { kind: 'primitive', type: 'double' },
  bool: { kind: 'primitive', type: 'bool' },
  string: { kind: 'primitive', type: 'string' },
  char: { kind: 'primitive', type: 'char' },
  unknown: { kind: 'unknown' }
} as const;

// Helper methods for creating common type nodes
export function createPrimitiveType(type: string): PrimitiveTypeNode {
  // Use cached types when possible
  if (type in commonTypes && type !== 'unknown') {
    return commonTypes[type as keyof typeof commonTypes] as PrimitiveTypeNode;
  }
  return { kind: 'primitive', type } as PrimitiveTypeNode;
}

export function createFunctionType(parameters: Array<{ name: string; type: Type }>, returnType: Type, typeParameters?: TypeParameter[]): FunctionTypeNode {
  return {
    kind: 'function',
    parameters,
    returnType,
    typeParameters
  };
}

export function createVoidType(): PrimitiveTypeNode {
  return createPrimitiveType('void');
}

export function createUnknownType(): UnknownTypeNode {
  return commonTypes.unknown;
}

export function createBoolType(): PrimitiveTypeNode {
  return createPrimitiveType('bool');
}

export function createEnumType(name: string): EnumTypeNode {
  return { kind: 'enum', name };
}

export function createClassType(name: string, typeArguments?: Type[]): ClassTypeNode {
  return {
    kind: 'class',
    name,
    typeArguments: typeArguments ? [...typeArguments] : undefined
  };
}

export function createExternClassType(name: string, namespace?: string, typeArguments?: Type[]): ExternClassTypeNode {
  return { kind: 'externClass', name, namespace, typeArguments };
}

// Helper function to resolve type aliases to their actual types
function resolveType(type: Type, validator: Validator): Type {
  if (type.kind === 'typeAlias') {
    // Make a copy to avoid mutating the original type
    const typeCopy = { ...type };
    resolveActualType(typeCopy, validator);
    return typeCopy;
  }
  return type;
}

export function isTypeCompatible(sourceType: Type, targetType: Type, validator: Validator): boolean {
  // Resolve type aliases first
  const resolvedSourceType = resolveType(sourceType, validator);
  const resolvedTargetType = resolveType(targetType, validator);

  if (resolvedSourceType.kind === 'typeParameter' || resolvedTargetType.kind === 'typeParameter') {
    return true;
  }
  
  // Unknown types are only compatible with other unknown types
  if (resolvedSourceType.kind === 'unknown' || resolvedTargetType.kind === 'unknown') {
    return resolvedSourceType.kind === 'unknown' && resolvedTargetType.kind === 'unknown';
  }

  if (resolvedSourceType.kind === resolvedTargetType.kind) {
    switch (resolvedSourceType.kind) {
      case 'primitive':
        const sourcePrim = resolvedSourceType as PrimitiveTypeNode;
        const targetPrim = resolvedTargetType as PrimitiveTypeNode;

        // Allow implicit numeric conversions
        if (isNumericType(sourcePrim) && isNumericType(targetPrim)) {
          return true;
        }

        // No implicit char to string conversion - require explicit string(char) cast
        // if (sourcePrim.type === 'char' && targetPrim.type === 'string') {
        //   return true;
        // }

        return sourcePrim.type === targetPrim.type;
      case 'class':
        const sourceClass = resolvedSourceType as ClassTypeNode;
        const targetClass = resolvedTargetType as ClassTypeNode;
        
        // Readonly compatibility for classes
        if (sourceClass.isReadonly && !targetClass.isReadonly) {
            return false;
        }

        // Classes with the same name are compatible
        if (sourceClass.name !== targetClass.name) {
          return false;
        }
        const sourceArgs = sourceClass.typeArguments ?? [];
        const targetArgs = targetClass.typeArguments ?? [];
        if (sourceArgs.length !== targetArgs.length) {
          return false;
        }
        for (let i = 0; i < sourceArgs.length; i++) {
          if (!isTypeCompatible(sourceArgs[i], targetArgs[i], validator)) {
            return false;
          }
        }
        // For fluent interfaces, allow compatibility between regular class and shared_ptr version
        // This handles cases where 'this' (marked as shared_ptr) is passed to parameters expecting class type
        const sourceIsSharedPtr = (sourceClass as any).isSharedPtr;
        const targetIsSharedPtr = (targetClass as any).isSharedPtr;
        
        // If both have same name, they're compatible regardless of shared_ptr status (for fluent interfaces)
        return true;
      case 'externClass':
        const sourceExternClass = resolvedSourceType as ExternClassTypeNode;
        const targetExternClass = resolvedTargetType as ExternClassTypeNode;
        if (sourceExternClass.name !== targetExternClass.name) {
            return false;
        }
        const sourceExternArgs = sourceExternClass.typeArguments ?? [];
        const targetExternArgs = targetExternClass.typeArguments ?? [];
        if (sourceExternArgs.length !== targetExternArgs.length) {
          return false;
        }
        for (let i = 0; i < sourceExternArgs.length; i++) {
          if (!isTypeCompatible(sourceExternArgs[i], targetExternArgs[i], validator)) {
            return false;
          }
        }
        return true;
      case 'enum':
        const sourceEnum = resolvedSourceType as EnumTypeNode;
        const targetEnum = resolvedTargetType as EnumTypeNode;
        return sourceEnum.name === targetEnum.name;
      case 'array':
        const sourceArray = resolvedSourceType as ArrayTypeNode;
        const targetArray = resolvedTargetType as ArrayTypeNode;
        
        // Readonly compatibility: Readonly cannot be assigned to Mutable
        if (sourceArray.isReadonly && !targetArray.isReadonly) {
          return false;
        }

        // Arrays only need matching element types
        return isTypeCompatible(sourceArray.elementType, targetArray.elementType, validator);
      case 'map':
        const sourceMap = resolvedSourceType as MapTypeNode;
        const targetMap = resolvedTargetType as MapTypeNode;

        // Readonly compatibility: Readonly cannot be assigned to Mutable
        if (sourceMap.isReadonly && !targetMap.isReadonly) {
          return false;
        }

        return isTypeCompatible(sourceMap.keyType, targetMap.keyType, validator) &&
          isTypeCompatible(sourceMap.valueType, targetMap.valueType, validator);
      case 'set':
        const sourceSet = resolvedSourceType as SetTypeNode;
        const targetSet = resolvedTargetType as SetTypeNode;

        // Readonly compatibility: Readonly cannot be assigned to Mutable
        if (sourceSet.isReadonly && !targetSet.isReadonly) {
          return false;
        }

        return isTypeCompatible(sourceSet.elementType, targetSet.elementType, validator);
      case 'function':
        const sourceFunc = resolvedSourceType as FunctionTypeNode;
        const targetFunc = resolvedTargetType as FunctionTypeNode;

        if (sourceFunc.parameters.length !== targetFunc.parameters.length) {
          return false;
        }

        // Parameters are contravariant
        for (let i = 0; i < sourceFunc.parameters.length; i++) {
          if (!isTypeCompatible(targetFunc.parameters[i].type, sourceFunc.parameters[i].type, validator)) {
            return false;
          }
        }

        // Return type is covariant
        return isTypeCompatible(sourceFunc.returnType, targetFunc.returnType, validator);
      case 'union':
        const sourceUnion = resolvedSourceType as UnionTypeNode;
        const targetUnion = resolvedTargetType as UnionTypeNode;
        // Both are unions: every source type must be compatible with some target type
        return sourceUnion.types.every(sourceT =>
          targetUnion.types.some(targetT => isTypeCompatible(sourceT, targetT, validator))
        );
    }
  }

  // Check if source is union and target is not
  if (resolvedSourceType.kind === 'union') {
    const sourceUnion = resolvedSourceType as UnionTypeNode;
    // Source union is compatible with target if all union members are compatible
    return sourceUnion.types.every(sourceT => isTypeCompatible(sourceT, resolvedTargetType, validator));
  }

  // Check if target is union and source is not
  if (resolvedTargetType.kind === 'union') {
    const targetUnion = resolvedTargetType as UnionTypeNode;
    // Source is compatible with target union if it's compatible with any member
    return targetUnion.types.some(targetT => isTypeCompatible(resolvedSourceType, targetT, validator));
  }

  return false;
}

export function isNumericType(type: Type): boolean {
  if (type.kind === 'unknown') {
    // Unknown types are treated as potentially numeric to avoid cascading errors
    return true;
  }
  if (type.kind === 'primitive') {
    const primType = type as PrimitiveTypeNode;
    return ['int', 'float', 'double'].includes(primType.type);
  }
  return false;
}

export function isBooleanType(type: Type): boolean {
  if (type.kind === 'unknown') {
    // Unknown types are treated as potentially boolean to avoid cascading errors
    return true;
  }
  return type.kind === 'primitive' && (type as PrimitiveTypeNode).type === 'bool';
}

export function isStringType(type: Type): boolean {
  if (type.kind === 'unknown') {
    // Unknown types are treated as potentially string to avoid cascading errors
    return true;
  }
  return type.kind === 'primitive' && type.type === 'string';
}

export function isUnknownType(type: Type): boolean {
  return type.kind === 'unknown';
}

export function isPrintableType(type: Type): boolean {
  // Types that can be printed (have operator<< overloads or are directly printable)
  if (type.kind === 'unknown') {
    // Unknown types are assumed to be printable to avoid cascading errors
    return true;
  }
  if (type.kind === 'primitive') {
    const primType = type as PrimitiveTypeNode;
    // All primitive types except void are printable
    return primType.type !== 'void';
  }
  if (type.kind === 'enum') {
    // All enum types are printable (we generate operator<< overloads for them)
    return true;
  }
  if (type.kind === 'array') {
    // Arrays are printable via templated operator<< overloads that output JSON format
    return true;
  }
  if (type.kind === 'map' || type.kind === 'set') {
    // Maps and sets are not directly printable in our implementation
    return false;
  }
  if (type.kind === 'class') {
    // Classes are printable because we automatically generate operator<< overloads
    // This includes both direct objects and shared_ptr wrapped objects
    return true;
  }
  return false;
}

export function isNonNullableType(type: Type, validator: Validator): boolean {
  // Resolve type aliases first
  resolveActualType(type, validator);

  // Primitive null is nullable
  if (type.kind === 'primitive' && (type as PrimitiveTypeNode).type === 'null') {
    return false;
  }

  // Unions that contain null are nullable
  if (type.kind === 'union') {
    const unionType = type as UnionTypeNode;
    return !unionType.types.some(t =>
      t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null'
    );
  }

  // All other types (classes, structs, primitives except null, etc.) are non-nullable
  return true;
}

export function isNullableType(type: Type): boolean {
  // Primitive null is nullable
  if (type.kind === 'primitive' && (type as PrimitiveTypeNode).type === 'null') {
    return true;
  }

  // Unions that contain null are nullable
  if (type.kind === 'union') {
    const unionType = type as UnionTypeNode;
    return unionType.types.some(t => 
      t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null'
    );
  }

  // Classes/externClasses that were originally nullable are nullable
  if ((type.kind === 'class' || type.kind === 'externClass') && type.wasNullable) {
    return true;
  }

  // All other types are non-nullable
  return false;
}

export function stripNullableType(type: Type): Type {
  // If it's an optional type, return the element type
  // If it's a union with null, return a union without null (or just the non-null type if only one)
  if (type.kind === 'union') {
    const unionType = type as UnionTypeNode;
    const nonNullTypes = unionType.types.filter(t => 
      !(t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null')
    );
    
    if (nonNullTypes.length === 1) {
      return nonNullTypes[0];
    } else if (nonNullTypes.length > 1) {
      return {
        kind: 'union',
        types: nonNullTypes
      } as UnionTypeNode;
    }
  }

  // If it's a class/externClass that was nullable, return it without the nullable flag
  if ((type.kind === 'class' || type.kind === 'externClass') && type.wasNullable) {
    const cleanType = { ...type };
    delete cleanType.wasNullable;
    return cleanType;
  }

  // For primitive null, return void or unknown (this case is unusual)
  if (type.kind === 'primitive' && (type as PrimitiveTypeNode).type === 'null') {
    return { kind: 'unknown' } as UnknownTypeNode;
  }

  // For non-nullable types, return as is
  return type;
}

export function getCommonNumericType(type1: Type, type2: Type): Type {
  if (!isNumericType(type1) || !isNumericType(type2)) {
    return type1;
  }

  // If either type is unknown, return unknown
  if (type1.kind === 'unknown' || type2.kind === 'unknown') {
    return { kind: 'unknown' };
  }

  const prim1 = type1 as PrimitiveTypeNode;
  const prim2 = type2 as PrimitiveTypeNode;

  // double > float > int
  if (prim1.type === 'double' || prim2.type === 'double') {
    return { kind: 'primitive', type: 'double' };
  }
  if (prim1.type === 'float' || prim2.type === 'float') {
    return { kind: 'primitive', type: 'float' };
  }
  return { kind: 'primitive', type: 'int' };
}

export function typeToString(type: Type): string {
  switch (type.kind) {
    case 'primitive':
      return (type as PrimitiveTypeNode).type;
    case 'array':
      const arrayType = type as ArrayTypeNode;
      return `${typeToString(arrayType.elementType)}[]`;
    case 'map':
      const mapType = type as MapTypeNode;
      return `Map<${typeToString(mapType.keyType)}, ${typeToString(mapType.valueType)}>`;
    case 'set':
      const setType = type as SetTypeNode;
      return `Set<${typeToString(setType.elementType)}>`;
    case 'class':
      const classType = type as ClassTypeNode;
      const className = classType.isWeak ? `weak ${classType.name}` : classType.name;
      if (classType.typeArguments && classType.typeArguments.length > 0) {
        const args = classType.typeArguments.map(arg => typeToString(arg)).join(', ');
        return `${className}<${args}>`;
      }
      return className;
    case 'externClass':
      const externClassType = type as ExternClassTypeNode;
      const externName = externClassType.isWeak ? `weak ${externClassType.name}` : externClassType.name;
      if (externClassType.typeArguments && externClassType.typeArguments.length > 0) {
        const args = externClassType.typeArguments.map(arg => typeToString(arg)).join(', ');
        return `${externName}<${args}>`;
      }
      return externName;
    case 'enum':
      const enumType = type as EnumTypeNode;
      return enumType.name;
    case 'typeAlias':
      const aliasType = type as TypeAliasNode;
      return aliasType.name;
    case 'function':
      const funcType = type as FunctionTypeNode;
      const params = funcType.parameters.map(p => `${p.name}: ${typeToString(p.type)}`).join(', ');
      return `(${params}) => ${typeToString(funcType.returnType)}`;
    case 'union':
      const unionType = type as UnionTypeNode;
      return unionType.types.map(t => typeToString(t)).join(' | ');
    case 'typeParameter':
      return (type as TypeParameterTypeNode).name;
    case 'range':
      const rangeType = type as RangeTypeNode;
      return `${typeToString(rangeType.start)}${rangeType.inclusive ? '..=' : '..'}${typeToString(rangeType.end)}`;
    case 'unknown':
      return '<unknown>';
    default:
      return '<unknown>';
  }
}

export function isConstantLiteral(expr: Expression, validator: Validator): boolean {
  switch (expr.kind) {
    case 'literal':
      return true;
    case 'member':
      // Check if this is an enum member access
      return isEnumMemberExpression(expr, validator);
    case 'enumShorthand':
      // Enum shorthand expressions like .ACTIVE are constant literals
      return true;
    case 'object':
      // Object literals with constant properties are considered constant
      const objectExpr = expr as ObjectExpression;
      return objectExpr.properties.every(prop => {
        return prop.value ? isConstantLiteral(prop.value, validator) : true;
      });
    case 'array':
      // Array literals with constant elements are considered constant
      const arrayExpr = expr as ArrayExpression;
      return arrayExpr.elements.every(element => isConstantLiteral(element, validator));
    default:
      return false;
  }
}

export function isStrictLiteral(expr: Expression): boolean {
  if (expr.kind !== 'literal') {
    return false;
  }
  const literal = expr as Literal;
  // Strict literals are number, string, boolean only (no null, no objects, no arrays)
  return literal.literalType === 'number' || literal.literalType === 'string' || literal.literalType === 'boolean';
}

export function isImmutableType(type: Type, validator: Validator): boolean {
  resolveActualType(type, validator);

  switch (type.kind) {
    case 'primitive':
      return true; // Primitives are immutable by value
    case 'enum':
      return true; // Enums are immutable
    case 'array':
      return !!(type as ArrayTypeNode).isReadonly;
    case 'map':
      return !!(type as MapTypeNode).isReadonly;
    case 'set':
      return !!(type as SetTypeNode).isReadonly;
    case 'class':
      const classType = type as ClassTypeNode;
      if (classType.isReadonly) return true;
      
      const classDecl = validator.context.classes.get(classType.name);
      if (!classDecl) return false; // Unknown class, assume mutable
      
      if (classDecl.isReadonly) return true;
      
      // Check if all fields are readonly and immutable
      for (const field of classDecl.fields) {
          if (field.isStatic) continue;
          if (!field.isReadonly && !field.isConst) return false;
          if (!isImmutableType(field.type, validator)) return false;
      }
      return true;
    case 'externClass':
       return false;
    case 'union':
       return (type as UnionTypeNode).types.every(t => isImmutableType(t, validator));
    default:
       return false;
  }
}

export function isValidParameterDefault(expr: Expression, validator: Validator): boolean {
  // Parameter defaults can be:
  // 1. Strict literals (number, string, boolean)
  // 2. Enum member access (e.g., Color.Red)
  // 3. Enum shorthand (e.g., .Red when type is known)

  if (isStrictLiteral(expr)) {
    return true;
  }

  // Check for enum member access: identifier.member
  if (expr.kind === 'member') {
    const memberExpr = expr as MemberExpression;
    if (memberExpr.object.kind === 'identifier' && !memberExpr.computed) {
      const enumName = (memberExpr.object as Identifier).name;
      return validator.context.enums.has(enumName);
    }
  }

  // Check for enum shorthand: .member
  if (expr.kind === 'enumShorthand') {
    return true; // Validation of enum member happens elsewhere
  }

  return false;
}

export function validateEnumMember(enumType: EnumTypeNode, memberName: string, location: any, validator: Validator): boolean {
  const enumDecl = validator.context.enums.get(enumType.name);
  if (!enumDecl) {
    validator.addError(`Unknown enum type '${enumType.name}'`, location);
    return false;
  }

  const memberExists = enumDecl.members.some(member => member.name.name === memberName);
  if (!memberExists) {
    validator.addError(`Invalid enum member '.${memberName}' for enum '${enumType.name}'`, location);
    return false;
  }

  return true;
}

export function validateUniqueFieldNames(fields: FieldDeclaration[], containerType: string, containerName: string, validator: Validator): void {
  const fieldNames = new Set<string>();
  for (const field of fields) {
    if (fieldNames.has(field.name.name)) {
      validator.addError(`Duplicate field '${field.name.name}' in ${containerType} '${containerName}'`, field.location);
    }
    fieldNames.add(field.name.name);
  }
}

export function validateRequiredFields(
  fields: FieldDeclaration[],
  providedProps: Set<string>,
  isInsideClass: boolean,
  location: any,
  validator: Validator
): void {
  for (const field of fields) {
    // Skip private fields if constructing from outside the class
    if (!field.isPublic && !isInsideClass) {
      // Check if private field was provided (which is an error)
      if (providedProps.has(field.name.name)) {
        validator.addError(`Cannot access private field '${field.name.name}' outside class`, location);
      }
      continue; // Skip validation for private fields when outside class
    }

    if (!field.defaultValue && !providedProps.has(field.name.name)) {
      validator.addError(`Missing required property '${field.name.name}'`, location);
    }
  }
}

export function addTypeCompatibilityError(sourceType: Type, targetType: Type, location: any, context: string | undefined, validator: Validator): void {
  const contextStr = context ? ` ${context}` : '';
  validator.addError(
    `Cannot${contextStr} convert type '${typeToString(sourceType)}' to '${typeToString(targetType)}'`,
    location
  );
}

export function isValidMapKeyType(type: Type): boolean {
  if (type.kind === 'primitive') {
    const primitiveType = type as PrimitiveTypeNode;
    return ['int', 'bool', 'char', 'string'].includes(primitiveType.type);
  }
  if (type.kind === 'enum') {
    return true; // All enum types are valid keys
  }
  return false;
}

export function validateType(type: Type, location: SourceLocation, validator: Validator): void {
  // First, resolve class types that are actually structs
  resolveActualType(type, validator, location);

  switch (type.kind) {
    case 'primitive':
      // Primitive types are always valid
      break;
    case 'array':
      const arrayType = type as ArrayTypeNode;
      validateType(arrayType.elementType, location, validator);
      break;
    case 'map':
      const mapType = type as MapTypeNode;
      validateType(mapType.keyType, location, validator);
      validateType(mapType.valueType, location, validator);
      validateMapKeyType(mapType.keyType, location, validator);
      break;
    case 'set':
      const setType = type as SetTypeNode;
      validateType(setType.elementType, location, validator);
      validateSetElementType(setType.elementType, location, validator);
      break;
    case 'class':
      const classType = type as ClassTypeNode;
      if (!validator.context.classes.has(classType.name) &&
        !validator.context.enums.has(classType.name) &&
        !validator.context.externClasses.has(classType.name)) {
        validator.addError(`Unknown type '${classType.name}'`, location);
      }
      
      // Check if it's actually an extern class (if resolveActualType didn't catch it yet)
      if (validator.context.externClasses.has(classType.name)) {
          const externDecl = validator.context.externClasses.get(classType.name);
          const expectedParams = externDecl?.typeParameters ?? [];
          const providedArgs = classType.typeArguments ?? [];
          validateTypeArgs(expectedParams, providedArgs, classType.name, location, validator);
          break;
      }

      const classDecl = validator.context.classes.get(classType.name);
      const expectedParams = classDecl?.typeParameters ?? [];
      const providedArgs = classType.typeArguments ?? [];

      validateTypeArgs(expectedParams, providedArgs, classType.name, location, validator);
      break;
    case 'externClass':
      const externClassType = type as ExternClassTypeNode;
      if (!validator.context.externClasses.has(externClassType.name)) {
        validator.addError(`Unknown extern class '${externClassType.name}'`, location);
      }
      const externDecl = validator.context.externClasses.get(externClassType.name);
      const expectedExternParams = externDecl?.typeParameters ?? [];
      const providedExternArgs = externClassType.typeArguments ?? [];
      validateTypeArgs(expectedExternParams, providedExternArgs, externClassType.name, location, validator);
      break;
    case 'function':
      const funcType = type as FunctionTypeNode;
      for (const param of funcType.parameters) {
        validateType(param.type, location, validator);
      }
      validateType(funcType.returnType, location, validator);
      break;
    case 'union':
      const unionType = type as UnionTypeNode;

      // First resolve all type aliases in the union types
      for (const unionMemberType of unionType.types) {
        resolveActualType(unionMemberType, validator);
      }

      // Flatten nested unions (e.g., (A | B) | C becomes A | B | C)
      flattenUnionType(unionType);

      if (unionType.types.length < 2) {
        validator.addError(`Union type must have at least 2 types`, location);
      }
      for (const unionMemberType of unionType.types) {
        validateType(unionMemberType, location, validator);
      }
      // Check for duplicate types in union
      validateNoDuplicateUnionTypes(unionType.types, location, validator);
      break;
  }
}


export function resolveActualType(type: Type, validator: Validator, location?: SourceLocation): void {
  switch (type.kind) {
    case 'typeAlias':
      const aliasType = type as TypeAliasNode;
      if (validator.isTypeParameter(aliasType.name)) {
        Object.assign(type, {
          kind: 'typeParameter',
          name: aliasType.name
        } as TypeParameterTypeNode);
        return;
      }
      const aliasDecl = validator.context.typeAliases.get(aliasType.name);
      if (aliasDecl) {
        // Replace the type alias with its resolved type
        const resolvedType = resolveTypeAlias(aliasType, validator, location);
        Object.assign(type, resolvedType);
        resolveActualType(type, validator, location);
      } else {
        // Check if it's actually a class or enum
        const isWeak = aliasType.isWeak;
        if (validator.context.classes.has(aliasType.name)) {
          (type as any).kind = 'class';
          if (isWeak) {
            (type as any).isWeak = true;
          }
        } else if (validator.context.enums.has(aliasType.name)) {
          (type as any).kind = 'enum';
          if (isWeak) {
            validator.addError("'weak' can only be applied to class types", location || { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } });
          }
        } else if (validator.context.externClasses.has(aliasType.name)) {
          (type as any).kind = 'externClass';
          if (isWeak) {
            (type as any).isWeak = true;
          }
        } else if (isWeak) {
          // If weak was applied but type doesn't exist or isn't a class, error
          validator.addError("'weak' can only be applied to class types", location || { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } });
        } else {
          // Type alias doesn't resolve to any known type
          validator.addError(`Unknown type: ${aliasType.name}`, location || { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } });
        }
      }
      break;
    case 'array':
      const arrayType = type as ArrayTypeNode;
      resolveActualType(arrayType.elementType, validator, location);
      break;
    case 'map':
      const mapType = type as MapTypeNode;
      resolveActualType(mapType.keyType, validator, location);
      resolveActualType(mapType.valueType, validator, location);
      break;
    case 'set':
      const setType = type as SetTypeNode;
      resolveActualType(setType.elementType, validator, location);
      break;
    case 'class':
      const classType = type as ClassTypeNode;
      // If this "class" type is actually an enum, convert it
      if (validator.context.enums.has(classType.name)) {
        (type as any).kind = 'enum';
        break;
      }
      if (classType.typeArguments) {
        for (const arg of classType.typeArguments) {
          resolveActualType(arg, validator, location);
        }
      }
      break;
    case 'function':
      const funcType = type as FunctionTypeNode;
      for (const param of funcType.parameters) {
        resolveActualType(param.type, validator, location);
      }
      resolveActualType(funcType.returnType, validator, location);
      break;
    case 'union':
      const unionType = type as UnionTypeNode;
      // First resolve all member types
      for (const memberType of unionType.types) {
        resolveActualType(memberType, validator, location);
      }
      break;
  }
}

export function resolveTypeAlias(aliasType: TypeAliasNode, validator: Validator, location?: SourceLocation): Type {
  const aliasDecl = validator.context.typeAliases.get(aliasType.name);
  if (!aliasDecl) {
    // This should not happen if type resolution is working correctly
    // If we reach here, it means a real type alias declaration is missing
    validator.addError(`Unknown type alias '${aliasType.name}'`, location || { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } });
    return createUnknownType();
  }

  // Return a deep copy of the resolved type to avoid mutation
  return cloneType(aliasDecl.type, validator);
}


/**
 * Collapses nullable unions (T | null) to idiomatic C++ types.
 * - Class/struct/externClass | null -> shared_ptr<T> (collapsed)
 * - Primitive | null -> optional<T> (collapsed)
 * - More than 2 types or multiple non-null types -> remain as variant
 */
/**
 * Remove duplicate types from a union
 */
function deduplicateUnionTypes(types: Type[]): Type[] {
  const seen = new Set<string>();
  return types.filter(type => {
    const key = getTypeKey(type);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function cloneType(type: Type, validator: Validator): Type {
  switch (type.kind) {
    case 'primitive':
      return { ...type };
    case 'enum':
      return { ...type };
    case 'externClass':
      const ext = type as ExternClassTypeNode;
      return {
        kind: 'externClass',
        name: ext.name,
        isWeak: ext.isWeak,
        wasNullable: ext.wasNullable,
        namespace: ext.namespace,
        typeArguments: ext.typeArguments ? ext.typeArguments.map(arg => cloneType(arg, validator)) : undefined
      };
    case 'unknown':
    case 'typeParameter':
      return { ...type };
    case 'class':
      return {
        ...type,
        typeArguments: type.typeArguments ? type.typeArguments.map(arg => cloneType(arg, validator)) : undefined
      };
    case 'array':
      return { ...type, elementType: cloneType(type.elementType, validator) };
    case 'map':
      return { ...type, keyType: cloneType(type.keyType, validator), valueType: cloneType(type.valueType, validator) };
    case 'set':
      return { ...type, elementType: cloneType(type.elementType, validator) };
    case 'union':
      return { ...type, types: type.types.map(t => cloneType(t, validator)) };
    case 'function':
      return {
        ...type,
        parameters: type.parameters.map(p => ({ ...p, type: cloneType(p.type, validator) })),
        returnType: cloneType(type.returnType, validator)
      };
    case 'typeAlias':
      // Resolve nested type aliases
      return resolveTypeAlias(type, validator);
    default:
      return { ...type };
  }
}


export function getTypeKey(type: Type): string {
  switch (type.kind) {
    case 'primitive':
      return `primitive:${type.type}`;
    case 'class':
      const classType = type as ClassTypeNode;
      if (classType.typeArguments && classType.typeArguments.length > 0) {
        const argsKey = classType.typeArguments.map(arg => getTypeKey(arg)).join(',');
        return `class:${classType.name}<${argsKey}>`;
      }
      return `class:${classType.name}`;
    case 'externClass':
      const externClassType = type as ExternClassTypeNode;
      if (externClassType.typeArguments && externClassType.typeArguments.length > 0) {
        const argsKey = externClassType.typeArguments.map(arg => getTypeKey(arg)).join(',');
        return `externClass:${externClassType.name}<${argsKey}>`;
      }
      return `externClass:${externClassType.name}`;
    case 'enum':
      return `enum:${(type as EnumTypeNode).name}`;
    case 'array':
      return `array:${getTypeKey((type as ArrayTypeNode).elementType)}`;
    case 'map':
      const mapType = type as MapTypeNode;
      return `map:${getTypeKey(mapType.keyType)}-${getTypeKey(mapType.valueType)}`;
    case 'set':
      return `set:${getTypeKey((type as SetTypeNode).elementType)}`;
    case 'union':
      return `union:${(type as UnionTypeNode).types.map(t => getTypeKey(t)).sort().join('|')}`;
    case 'typeParameter':
      return `typeParameter:${(type as TypeParameterTypeNode).name}`;
    default:
      return `${type.kind}:${JSON.stringify(type)}`;
  }
}

function flattenUnionType(unionType: UnionTypeNode): void {
  const flattenedTypes: Type[] = [];

  for (const memberType of unionType.types) {
    if (memberType.kind === 'union') {
      // Recursively flatten nested unions
      flattenUnionType(memberType as UnionTypeNode);
      flattenedTypes.push(...(memberType as UnionTypeNode).types);
    } else {
      flattenedTypes.push(memberType);
    }
  }

  // Replace the union types with the flattened list
  unionType.types = flattenedTypes;
}

export function isTypeEqual(type1: Type, type2: Type): boolean {
  if (type1.kind !== type2.kind) return false;

  if (type1.kind === 'primitive' && type2.kind === 'primitive') {
    return (type1 as PrimitiveTypeNode).type === (type2 as PrimitiveTypeNode).type;
  }

  if (type1.kind === 'unknown' && type2.kind === 'unknown') {
    return true;
  }

  if (type1.kind === 'class' && type2.kind === 'class') {
    const class1 = type1 as ClassTypeNode;
    const class2 = type2 as ClassTypeNode;
    if (class1.name !== class2.name) {
      return false;
    }
    const args1 = class1.typeArguments ?? [];
    const args2 = class2.typeArguments ?? [];
    if (args1.length !== args2.length) {
      return false;
    }
    for (let i = 0; i < args1.length; i++) {
      if (!isTypeEqual(args1[i], args2[i])) {
        return false;
      }
    }
    return true;
  }

  if (type1.kind === 'externClass' && type2.kind === 'externClass') {
    const class1 = type1 as ExternClassTypeNode;
    const class2 = type2 as ExternClassTypeNode;
    if (class1.name !== class2.name) {
      return false;
    }
    const args1 = class1.typeArguments ?? [];
    const args2 = class2.typeArguments ?? [];
    if (args1.length !== args2.length) {
      return false;
    }
    for (let i = 0; i < args1.length; i++) {
      if (!isTypeEqual(args1[i], args2[i])) {
        return false;
      }
    }
    return true;
  }

  if (type1.kind === 'enum' && type2.kind === 'enum') {
    return (type1 as EnumTypeNode).name === (type2 as EnumTypeNode).name;
  }

  if (type1.kind === 'function' && type2.kind === 'function') {
    return isMethodSignatureEqual(type1 as FunctionTypeNode, type2 as FunctionTypeNode);
  }

  // Add more type equality checks as needed
  return false;
}

export function isMethodSignatureEqual(sig1: FunctionTypeNode, sig2: FunctionTypeNode): boolean {
  // Check parameter count
  if (sig1.parameters.length !== sig2.parameters.length) {
    return false;
  }

  // Check parameter types
  for (let i = 0; i < sig1.parameters.length; i++) {
    if (!isTypeEqual(sig1.parameters[i].type, sig2.parameters[i].type)) {
      return false;
    }
  }

  // Check return type
  return isTypeEqual(sig1.returnType, sig2.returnType);
}

function validateNoDuplicateUnionTypes(types: Type[], location: SourceLocation, validator: Validator): void {
  const typeStrings = types.map(type => typeToString(type));
  const seen = new Set<string>();
  for (const typeString of typeStrings) {
    if (seen.has(typeString)) {
      validator.addError(`Duplicate type '${typeString}' in union`, location);
      return;
    }
    seen.add(typeString);
  }
}

export function validateMapKeyType(keyType: Type, location: SourceLocation, validator: Validator): void {
  if (!isValidMapKeyType(keyType)) {
    validator.addError(`Invalid map key type: ${typeToString(keyType)}. Map keys must be int, bool, char, string, or enum types.`, location);
  }
}

export function validateSetElementType(elementType: Type, location: SourceLocation, validator: Validator): void {
  if (!isValidSetElementType(elementType)) {
    validator.addError(`Invalid set element type: ${typeToString(elementType)}. Set elements must be int, bool, char, string, or enum types.`, location);
  }
}

function isValidSetElementType(type: Type): boolean {
  // Same constraints as map keys for consistency
  return isValidMapKeyType(type);
}

/**
 * Determine the VM key type category for a given key type.
 * This maps type system key types to VM implementation categories.
 */
export function getKeyTypeCategory(keyType: Type): 'string' | 'int' {
  if (keyType.kind === 'primitive') {
    switch (keyType.type) {
      case 'string': return 'string';
      case 'int': 
      case 'bool':
      case 'char': return 'int'; // All map to int32_t in VM
      default: return 'string'; // Fallback for safety
    }
  }
  if (keyType.kind === 'enum') {
    return 'int'; // Enums are stored as integers
  }
  return 'string'; // Fallback for safety
}

/**
 * Determine the VM element type category for a given set element type.
 * This maps type system element types to VM implementation categories.
 */
export function getElementTypeCategory(elementType: Type): 'string' | 'int' {
  // Sets use the same category mapping as map keys
  return getKeyTypeCategory(elementType);
}

export function getPropertyKeyName(key: Identifier | Literal | MemberExpression | EnumShorthandMemberExpression): string {
  if (key.kind === 'identifier') {
    return key.name;
  } else if (key.kind === 'literal') {
    return String(key.value);
  } else if (key.kind === 'member') {
    // For enum member access like Status.ACTIVE
    const obj = key.object as Identifier;
    const prop = key.property as Identifier;
    return `${obj.name}.${prop.name}`;
  } else if (key.kind === 'enumShorthand') {
    // For enum shorthand like .ACTIVE
    return `.${key.memberName}`;
  }
  return 'unknown';
}

/**
 * Check if a type requires explicit initialization to avoid runtime issues.
 * This is different from isNonNullableType - it only checks for types that
 * could cause null pointer/undefined behavior if not initialized.
 * Primitives like int, bool, etc. have safe default values.
 */
export function requiresExplicitInitialization(type: Type, validator: Validator): boolean {
  // Resolve type aliases first
  resolveActualType(type, validator);

  switch (type.kind) {
    case 'primitive':
      // Primitives have safe default values (0, false, etc.)
      return false;
      
    case 'array':
      // Arrays need initialization to avoid null pointer access
      return true;
      
    case 'class':
    case 'externClass':
      // Classes need initialization 
      return true;
      
    case 'map':
    case 'set':
      // Collections need initialization
      return true;
      
    case 'union':
      // If union contains null, it doesn't require initialization 
      const unionType = type as UnionTypeNode;
      if (unionType.types.some(t => t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null')) {
        return false;
      }
      // Otherwise check if any member requires initialization
      return unionType.types.some(t => requiresExplicitInitialization(t, validator));
      
    default:
      // Be conservative - unknown types require initialization
      return true;
  }
}

/**
 * Generate a unique identifier for an expression based on its location
 * This is used as a key for storing type information in codeGenHints
 */
export function getExpressionId(expr: Expression): string {
  if (expr.location) {
    return `${expr.location.start.line}:${expr.location.start.column}-${expr.location.end.line}:${expr.location.end.column}`;
  }
  // Fallback for expressions without location info
  return `expr-${Date.now()}-${Math.random()}`;
}

/**
 * Calculate numeric type coercions needed for binary operations
 */
export function getNumericCoercions(leftType: Type, rightType: Type, targetType: Type): {
  leftCoercion?: { from: Type; to: Type };
  rightCoercion?: { from: Type; to: Type };
} {
  const result: {
    leftCoercion?: { from: Type; to: Type };
    rightCoercion?: { from: Type; to: Type };
  } = {};

  // Check if left operand needs coercion
  if (!isTypeEqual(leftType, targetType)) {
    result.leftCoercion = { from: leftType, to: targetType };
  }

  // Check if right operand needs coercion
  if (!isTypeEqual(rightType, targetType)) {
    result.rightCoercion = { from: rightType, to: targetType };
  }

  return result;
}

/**
 * Get string conversion coercion for non-string types
 */
export function getStringConversionCoercion(fromType: Type): { from: Type; to: Type } | undefined {
  if (isStringType(fromType)) {
    return undefined;
  }
  return { from: fromType, to: createPrimitiveType('string') };
}

/**
 * Get coercion from one type to another
 */
export function getCoercionForType(fromType: Type, toType: Type): { from: Type; to: Type } | undefined {
  if (isTypeEqual(fromType, toType)) {
    return undefined;
  }
  return { from: fromType, to: toType };
}

export function validateTypeArgs(expectedParams: TypeParameter[], providedArgs: Type[], typeName: string, location: SourceLocation, validator: Validator): void {
      if (expectedParams.length === 0) {
        if (providedArgs.length > 0) {
          validator.addError(`Class '${typeName}' does not accept type arguments`, location);
        }
      } else {
        if (providedArgs.length === 0) {
          validator.addError(`Class '${typeName}' requires ${expectedParams.length} type ${expectedParams.length === 1 ? 'argument' : 'arguments'}`, location);
        } else if (providedArgs.length !== expectedParams.length) {
          validator.addError(`Class '${typeName}' expects ${expectedParams.length} type ${expectedParams.length === 1 ? 'argument' : 'arguments'} but got ${providedArgs.length}`, location);
        }

        for (const arg of providedArgs) {
          validateType(arg, location, validator);
        }
      }
}
