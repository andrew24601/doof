import { Type, Identifier, MemberExpression, ValidationContext } from "../../types";

/**
 * Information about a detected static method call
 */
export interface StaticMethodInfo {
  className: string;
  methodName: string;
  methodType: Type;
}

/**
 * Checks if a member expression represents a static method call.
 * This utility is shared between C++ and VM backends to avoid duplicate logic.
 * 
 * @param memberExpr - The member expression to check (e.g., Counter.getCount)
 * @param validationContext - The validation context containing symbols
 * @returns StaticMethodInfo if it's a static method call, null otherwise
 */
export function detectStaticMethodCall(
  memberExpr: MemberExpression,
  validationContext?: ValidationContext
): StaticMethodInfo | null {
  // Must be an identifier.identifier pattern
  if (memberExpr.object.kind !== 'identifier' || memberExpr.property.kind !== 'identifier') {
    return null;
  }

  const className = memberExpr.object.name;
  const methodName = memberExpr.property.name;

  // Check if this is a static method call using validation context
  if (validationContext) {
    const staticMethodKey = `${className}.${methodName}`;
    const staticMethodType = validationContext.symbols.get(staticMethodKey);
    if (staticMethodType && staticMethodType.kind === 'function') {
      return {
        className,
        methodName,
        methodType: staticMethodType
      };
    }
  }

  return null;
}

/**
 * Checks if a class name exists in the validation context.
 * This is useful for fallback detection when symbol table lookup fails.
 * 
 * @param className - The class name to check
 * @param validationContext - The validation context
 * @returns true if the class exists, false otherwise
 */
export function isKnownClass(
  className: string,
  validationContext?: ValidationContext
): boolean {
  if (!validationContext) return false;
  
  return validationContext.classes.has(className) || 
         validationContext.externClasses?.has?.(className) || false;
}

/**
 * Creates a static method key for symbol table lookups.
 * Centralizes the key format used across the codebase.
 * 
 * @param className - The class name
 * @param methodName - The method name
 * @returns The formatted key (e.g., "Counter.getCount")
 */
export function createStaticMethodKey(className: string, methodName: string): string {
  return `${className}.${methodName}`;
}

/**
 * Checks if a member expression could potentially be a static field access.
 * This is a quick heuristic check before doing more expensive lookups.
 * 
 * @param memberExpr - The member expression to check
 * @returns true if it matches the pattern for static access
 */
export function looksLikeStaticAccess(memberExpr: MemberExpression): boolean {
  return memberExpr.object.kind === 'identifier' && 
         memberExpr.property.kind === 'identifier';
}