import {
  Expression, Type, InterpolatedString, NullCoalesceExpression, OptionalChainExpression,
  NonNullAssertionExpression, Identifier, Literal, PrimitiveTypeNode, UnionTypeNode
} from "../../../types";
import { CppGenerator } from "../../cppgen";
import { generateExpression } from "../cpp-expression-codegen";
import { inferTypeFromExpression, isSharedPtrType } from "./literal-identifier-generators";
import { shouldFlattenChain, flattenOptionalChain, generateFlattenedChain, generateFlattenedChainWithCoalescing } from "./chain-flattener";
import { isStringType as isStringTypeShared } from "../../shared/type-coercion";

let __expr_unique_counter = 0;

/**
 * Generates a unique variable name with the given prefix
 */
export function generateUniqueVariable(prefix: string): string { 
  return `${prefix}${__expr_unique_counter++}`; 
}

/**
 * Generates C++ code for interpolated string expressions
 */
export function generateInterpolatedString(generator: CppGenerator, expr: InterpolatedString): string {
  if (expr.tagIdentifier?.name === 'println') {
    return generatePrintlnWithInterpolation(generator, expr);
  } else if (expr.tagIdentifier) {
    return generateTaggedTemplate(generator, expr);
  } else {
    // Use StringBuilder for interpolated strings with multiple parts
    if (expr.parts.length > 1) {
      const builderVar = generateUniqueVariable('__sb_');
      let result = `[&]() {
          auto ${builderVar} = std::make_shared<doof_runtime::StringBuilder>();
`;

      // Estimate capacity for reserve
      let estimatedCapacity = 0;
      for (const part of expr.parts) {
        if (typeof part === 'string') {
          estimatedCapacity += part.length;
        } else {
          estimatedCapacity += 10; // Estimate for variable values
        }
      }

      if (estimatedCapacity > 20) {
        result += `          ${builderVar}->reserve(${estimatedCapacity});
`;
      }

      for (const part of expr.parts) {
        if (typeof part === 'string') {
          if (part.length > 0) { // Skip empty strings
            const escapedPart = part.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
            result += `          ${builderVar}->append("${escapedPart}");
`;
          }
        } else {
          const partType = inferTypeFromExpression(generator, part);
          if (partType.kind === 'primitive') {
            const primType = partType as PrimitiveTypeNode;
            if (primType.type === 'string') {
              result += `          ${builderVar}->append(${generateExpression(generator, part)});
`;
            } else if (primType.type === 'bool') {
              // For boolean, append the value directly without conversion
              result += `          ${builderVar}->append(${generateExpression(generator, part)});
`;
            } else {
              // For other types, append directly - StringBuilder should handle conversion
              result += `          ${builderVar}->append(${generateExpression(generator, part)});
`;
            }
          } else if (partType.kind === 'enum') {
            // For enums, use to_string function
            result += `          ${builderVar}->append(to_string(${generateExpression(generator, part)}));
`;
          } else {
            result += `          ${builderVar}->append(${generateExpression(generator, part)});
`;
          }
        }
      }

      result += `          return ${builderVar}->toString();
        }()`;
      return result;
    } else {
      // Single part, just return it directly or convert
      const part = expr.parts[0];
      if (typeof part === 'string') {
        const escapedPart = part.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        return `"${escapedPart}"`;
      } else {
        return generateExpression(generator, part);
      }
    }
  }
}

/**
 * Generates C++ code for println with interpolation
 */
export function generatePrintlnWithInterpolation(generator: CppGenerator, expr: InterpolatedString): string {
  let result = 'std::cout';

  for (const part of expr.parts) {
    if (typeof part === 'string') {
      result += ` << "${part.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    } else {
      result += ` << ${generateExpression(generator, part)}`;
    }
  }

  result += ' << std::endl';
  return result;
}

/**
 * Generates C++ code for tagged template literals
 */
export function generateTaggedTemplate(generator: CppGenerator, expr: InterpolatedString): string {
  // Tagged templates generate function calls with string arrays and value arrays
  const tagName = expr.tagIdentifier?.name || 'tag';

  // Extract the string parts (static text between interpolations)
  const stringParts: string[] = [];
  const values: string[] = [];

  // Split the template into static parts and interpolated expressions
  let currentPart = '';
  let partIndex = 0;

  for (const part of expr.parts) {
    if (typeof part === 'string') {
      currentPart += part;
    } else {
      // We hit an interpolation, save the current string part
      stringParts.push(`"${currentPart.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`);
      values.push(generateExpression(generator, part));
      currentPart = '';
    }
  }

  // Add the final string part
  stringParts.push(`"${currentPart.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`);

  // Generate vector initialization
  const stringsVector = `std::vector<std::string>{${stringParts.join(', ')}}`;
  const valuesVector = `std::vector<std::string>{${values.join(', ')}}`;

  return `${tagName}(${stringsVector}, ${valuesVector})`;
}

/**
 * Generates C++ code for null coalescing expressions (??)
 */
export function generateNullCoalesceExpression(generator: CppGenerator, expr: NullCoalesceExpression): string {
  // Check if left side is a flattened chain that we should handle specially
  if (shouldFlattenChain(expr.left)) {
    const flattened = flattenOptionalChain(expr.left);
    if (flattened) {
      const right = generateExpression(generator, expr.right);
      return generateFlattenedChainWithCoalescing(generator, flattened, right);
    }
  }

  const left = generateExpression(generator, expr.left);
  const right = generateExpression(generator, expr.right);

  // Get the inferred type of the left expression
  const leftType = expr.left.inferredType || inferTypeFromExpression(generator, expr.left);

  // For union types with null (like User | null), use shared_ptr logic
  if (leftType.kind === 'union') {
    const unionType = leftType as UnionTypeNode;
    const hasNull = unionType.types.some(t => t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null');
    const nonNullTypes = unionType.types.filter(t =>
      !(t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null')
    );

    if (hasNull && nonNullTypes.length === 1) {
      const baseType = nonNullTypes[0];
      // For class types, User | null becomes std::shared_ptr<User> (use shared_ptr logic)
      if (baseType.kind === 'class' || baseType.kind === 'externClass') {
        return `(${left} ? ${left} : ${right})`;
      }
      // For primitives, T | null becomes std::optional<T> (use optional logic)
      else {
        return `(${left}.has_value() ? ${left}.value() : ${right})`;
      }
    }
  }

  // For shared_ptr types directly, use direct comparison with nullptr
  if (isSharedPtrType(expr.left)) {
    return `(${left} ? ${left} : ${right})`;
  } else {
    // For optional types, use has_value()
    return `(${left}.has_value() ? ${left}.value() : ${right})`;
  }
}

/**
 * Generates C++ code for optional chaining expressions (?.)
 * NOTE: Method calls like calc?.add(5) are handled by generateOptionalChainMethodCall in method-call-generators.ts
 * This function only handles property access like person?.address?.city
 */
export function generateOptionalChainExpression(generator: CppGenerator, expr: OptionalChainExpression): string {
  // Check if this should be flattened for efficiency
  if (shouldFlattenChain(expr)) {
    const flattened = flattenOptionalChain(expr);
    if (flattened) {
      return generateFlattenedChain(generator, flattened);
    }
  }

  const object = generateExpression(generator, expr.object);

  // Check if the object expression is itself an optional chain result
  // This happens with nested chaining like person?.address?.city
  const isObjectOptionalResult = expr.object.kind === 'optionalChain';

  // This should only handle property access like a?.property
  const propertyName = getMemberPropertyName(expr.property);
  
  if (isObjectOptionalResult) {
    // Handle nested optional chaining for property access
    return `(${object}.has_value() ? std::make_optional(${object}.value()->${propertyName}) : std::nullopt)`;
  } else {
    return `(${object} ? std::make_optional(${object}->${propertyName}) : std::nullopt)`;
  }
}

/**
 * Generates C++ code for non-null assertion expressions (!)
 */
export function generateNonNullAssertionExpression(generator: CppGenerator, expr: NonNullAssertionExpression): string {
  const operand = generateExpression(generator, expr.operand);

  // Get the inferred type to determine how to handle the assertion
  const operandType = expr.operand.inferredType || inferTypeFromExpression(generator, expr.operand);

  // For union types with null (like User | null), add an assertion
  if (operandType.kind === 'union') {
    const unionType = operandType as UnionTypeNode;
    const hasNull = unionType.types.some(t => t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null');
    const nonNullTypes = unionType.types.filter(t =>
      !(t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null')
    );

    if (hasNull && nonNullTypes.length === 1) {
      const baseType = nonNullTypes[0];
      // For class types, User | null becomes std::shared_ptr<User> (add assert)
      if (baseType.kind === 'class' || baseType.kind === 'externClass') {
        return `(assert(${operand}), ${operand})`;
      }
      // For primitives, T | null becomes std::optional<T> (use .value())
      else {
        return `${operand}.value()`;
      }
    }
  }

  // For shared_ptr types, add assertion
  if (isSharedPtrType(expr.operand)) {
    return `(assert(${operand}), ${operand})`;
  } else {
    // For optional types, use .value()
    return `${operand}.value()`;
  }
}

/**
 * Gets the property name from a member expression property
 */
function getMemberPropertyName(property: Identifier | Literal | undefined): string {
  if (!property) {
    throw new Error('Optional chain segment is missing a property name');
  }
  if (property.kind === 'identifier') {
    return property.name;
  } else if (property.kind === 'literal' && property.literalType === 'string') {
    return String(property.value);
  } else {
    throw new Error(`Unsupported property type: ${property.kind}`);
  }
}
