import {
  Expression, Type, Literal, Identifier, PrimitiveTypeNode, UnionTypeNode, 
  EnumShorthandMemberExpression, EnumTypeNode, ClassTypeNode, ExternClassTypeNode
} from "../../../types";
import { CppGenerator } from "../../cppgen";
import type { ExpressionContext } from "../cpp-expression-codegen";

/**
 * Generates C++ code for literal expressions
 */
export function generateLiteral(generator: CppGenerator, literal: Literal, targetType?: Type): string {
  switch (literal.literalType) {
    case 'string':
      return `"${String(literal.value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
    case 'number':
      return literal.originalText ?? String(literal.value);
    case 'boolean':
      return String(literal.value);
    case 'char':
      return `'${String(literal.value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}'`;
    case 'null':
      if (targetType?.kind === 'union') {
        const unionType = targetType as UnionTypeNode;
        const hasNull = unionType.types.some(t => t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null');
        if (hasNull) {
          const nonNullTypes = unionType.types.filter(t =>
            !(t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null')
          );
          
          // If the union is with a class type (which becomes shared_ptr), use nullptr
          if (nonNullTypes.length === 1 && 
              (nonNullTypes[0].kind === 'class' || nonNullTypes[0].kind === 'externClass')) {
            return 'nullptr';
          }
          
          // For primitive union types, use std::nullopt
          return 'std::nullopt';
        }
      }
      return 'nullptr';
    default:
      return String(literal.value);
  }
}

/**
 * Generates C++ code for identifier expressions
 */
export function generateIdentifier(generator: CppGenerator, identifier: Identifier, context?: ExpressionContext): string {
  // Special handling for 'this' identifier
  if (identifier.name === 'this') {
    return generateThisExpression(generator, { needsSharedPtr: context?.needsSharedPtr || context?.isReturnContext });
  }

  const isCaptured = generator.isCapturedMutableIdentifier(identifier);
  const needsStorageAccess = isCaptured && context?.capturedAccessMode === 'storage';
  const wantsValueAccess = isCaptured && !needsStorageAccess;

  if (needsStorageAccess) {
    return identifier.name;
  }

  const scopeInfo = identifier.scopeInfo;
  const member = identifier.resolvedMember || (scopeInfo?.isClassMember ? {
    className: scopeInfo.declaringClass,
    memberName: identifier.name,
    kind: scopeInfo.scopeKind === 'method' ? 'method' : 'field'
  } : undefined);

  if (member) {
    const className = member.className || generator.currentClass?.name.name;
    if (!className) {
      throw new Error(`Missing class metadata for member '${member.memberName}'`);
    }

    let isStatic: boolean | undefined = scopeInfo?.isStaticMember;
    if (isStatic === undefined && generator.validationContext?.classes.has(className)) {
      const classDecl = generator.validationContext.classes.get(className)!;
      if (member.kind === 'field') {
        const fieldDecl = classDecl.fields.find(f => f.name.name === member.memberName);
        if (fieldDecl) {
          isStatic = fieldDecl.isStatic;
        }
      } else if (member.kind === 'method') {
        const methodDecl = classDecl.methods.find(m => m.name.name === member.memberName);
        if (methodDecl) {
          isStatic = methodDecl.isStatic;
        }
      }
    }

    if (member.kind === 'field') {
      if (isStatic === undefined) {
        throw new Error(`Unable to determine if field '${className}.${member.memberName}' is static`);
      }
      return isStatic ? `${className}::${member.memberName}` : `this->${member.memberName}`;
    }

    if (member.kind === 'method') {
      if (isStatic === undefined) {
        throw new Error(`Unable to determine if method '${className}.${member.memberName}' is static`);
      }
      return isStatic ? `${className}::${member.memberName}` : `this->${member.memberName}`;
    }

    throw new Error(`Unsupported member kind '${member.kind}' for identifier '${identifier.name}'`);
  }

  // Check if this identifier is an imported symbol
  if (generator.validationContext?.imports.has(identifier.name)) {
    const importInfo = generator.validationContext.imports.get(identifier.name)!;
    return `${importInfo.sourceModule}::${importInfo.importedName}`;
  }

  // Check if this is a runtime symbol
  if (isRuntimeSymbol(identifier.name)) {
  // Runtime symbols are handled by doof_runtime.h
    return identifier.name;
  }

  // Check for type narrowing context first
  const narrowedType = getNarrowedType(generator, identifier.name);
  const originalType = generator.variableTypes.get(identifier.name);

  if (narrowedType && originalType?.kind === 'union') {
    // For union types with narrowing, we need to use std::get or similar
    return generateNarrowedIdentifier(generator, identifier);
  }

  if (wantsValueAccess) {
    return `${identifier.name}.get()`;
  }

  return identifier.name;
}

/**
 * Generates C++ code for the 'this' keyword in various contexts
 */
export function generateThisExpression(generator: CppGenerator, context?: { needsSharedPtr?: boolean }): string {
  // Use shared_from_this() when the context explicitly requires a shared_ptr
  if (context?.needsSharedPtr && generator.currentClass) {
    return 'shared_from_this()';
  }

  // Default to raw 'this' for member access, method calls, etc.
  return 'this';
}

/**
 * Generates C++ code for narrowed identifier access in union types
 */
export function generateNarrowedIdentifier(generator: CppGenerator, identifier: Identifier): string {
  const narrowedType = getNarrowedType(generator, identifier.name);
  const originalType = generator.variableTypes.get(identifier.name);
  const baseName = generator.isCapturedMutableIdentifier(identifier) ? `${identifier.name}.get()` : identifier.name;

  if (narrowedType && originalType?.kind === 'union') {
    const unionType = originalType as UnionTypeNode;
    const hasNull = unionType.types.some(t => t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null');
    const nonNullTypes = unionType.types.filter(t => !(t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null'));

    if (hasNull && nonNullTypes.length === 1) {
      const baseType = nonNullTypes[0];

      if (baseType.kind === 'class' || baseType.kind === 'externClass') {
        // Class | null collapses to shared_ptr<T>; narrowed access can use the variable directly
        return baseName;
      }

      // Other nullable unions collapse to std::optional - unwrap to the underlying value
      return `${baseName}.value()`;
    }

    // For multi-type unions, use std::get to extract the active variant
    return `std::get<${generator.generateType(narrowedType)}>(${baseName})`;
  }

  return baseName;
}

/**
 * Generates C++ code for enum shorthand member expressions
 */
export function generateEnumShorthand(expr: EnumShorthandMemberExpression): string {
  if (expr.inferredType && expr.inferredType.kind === 'enum') {
    const enumType = expr.inferredType as EnumTypeNode;
    return `${enumType.name}::${expr.memberName}`;
  }
  throw new Error(`Enum shorthand .${expr.memberName} cannot be resolved without context`);
}

/**
 * Checks if a variable name has been narrowed in the current type narrowing context
 */
export function getNarrowedType(generator: CppGenerator, varName: string): Type | undefined {
  return generator.typeNarrowingContext?.get(varName);
}

/**
 * Checks if an identifier represents a shared_ptr type
 */
export function isSharedPtrType(expr: Expression): boolean {
  if (expr.inferredType == null) throw new Error('Expression has no inferred type');
  const type = expr.inferredType!;
  return type.kind === 'class' || type.kind === 'externClass';
}

/**
 * Checks if an identifier is a runtime symbol that requires doof_runtime.h
 */
function isRuntimeSymbol(name: string): boolean {
  // Check for known runtime symbols that require doof_runtime.h
  const runtimeSymbols = ['println', 'panic', 'Math', 'fs'];
  return runtimeSymbols.includes(name);
}

/**
 * Infers the type of an expression. After validation, all expressions should have inferredType.
 * This is a fallback for cases where it's missing.
 */
export function inferTypeFromExpression(generator: CppGenerator, expr: Expression): Type {
  if (expr.inferredType) {
    return expr.inferredType;
  }
  throw new Error('Expression has no inferred type');
}
