import {
  CallExpression,
  Type,
  PrimitiveTypeNode,
  EnumTypeNode,
  ClassTypeNode
} from "../types";
import {
  typeToString,
  isTypeCompatible,

  createEnumType
} from "../type-utils";
import { Validator } from "./validator";
import { validateExpression } from "./expression-validator";

/**
 * Validates calls to canonical type conversion functions: int(), float(), double(), string(), bool()
 * and enum conversion functions like MyEnum(value).
 */

export interface TypeConversionOverload {
  inputTypes: Type[];
  returnType: Type;
  cppMapping: string;
  vmMapping: string;
  description: string;
}

/**
 * Type conversion function definitions according to the spec
 */
export const TYPE_CONVERSION_FUNCTIONS = {
  int: [
    {
      inputTypes: [{ kind: 'primitive', type: 'int' }],
      returnType: { kind: 'primitive', type: 'int' },
      cppMapping: '(int)',
      vmMapping: 'INT_IDENTITY',
      description: 'int → int: returns value unchanged'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'float' }],
      returnType: { kind: 'primitive', type: 'int' },
      cppMapping: 'static_cast<int>',
      vmMapping: 'FLOAT_TO_INT',
      description: 'float → int: truncates toward zero'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'double' }],
      returnType: { kind: 'primitive', type: 'int' },
      cppMapping: 'static_cast<int>',
      vmMapping: 'DOUBLE_TO_INT',
      description: 'double → int: truncates toward zero'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'string' }],
      returnType: { kind: 'primitive', type: 'int' },
  cppMapping: 'doof_runtime::string_to_int',
      vmMapping: 'STRING_TO_INT',
      description: 'string → int: parses decimal integer, panics if not valid'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'bool' }],
      returnType: { kind: 'primitive', type: 'int' },
      cppMapping: 'static_cast<int>',
      vmMapping: 'BOOL_TO_INT',
      description: 'bool → int: true → 1, false → 0'
    }
  ] as TypeConversionOverload[],

  float: [
    {
      inputTypes: [{ kind: 'primitive', type: 'float' }],
      returnType: { kind: 'primitive', type: 'float' },
      cppMapping: '(float)',
      vmMapping: 'FLOAT_IDENTITY',
      description: 'float → float: returns value unchanged'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'double' }],
      returnType: { kind: 'primitive', type: 'float' },
      cppMapping: 'static_cast<float>',
      vmMapping: 'DOUBLE_TO_FLOAT',
      description: 'double → float: converts with potential precision loss'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'int' }],
      returnType: { kind: 'primitive', type: 'float' },
      cppMapping: 'static_cast<float>',
      vmMapping: 'INT_TO_FLOAT',
      description: 'int → float: converts directly'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'string' }],
      returnType: { kind: 'primitive', type: 'float' },
  cppMapping: 'doof_runtime::string_to_float',
      vmMapping: 'STRING_TO_FLOAT',
      description: 'string → float: parses as floating-point, panics if not valid'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'bool' }],
      returnType: { kind: 'primitive', type: 'float' },
      cppMapping: 'static_cast<float>',
      vmMapping: 'BOOL_TO_FLOAT',
      description: 'bool → float: true → 1.0, false → 0.0'
    }
  ] as TypeConversionOverload[],

  double: [
    {
      inputTypes: [{ kind: 'primitive', type: 'double' }],
      returnType: { kind: 'primitive', type: 'double' },
      cppMapping: '(double)',
      vmMapping: 'DOUBLE_IDENTITY',
      description: 'double → double: returns value unchanged'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'float' }],
      returnType: { kind: 'primitive', type: 'double' },
      cppMapping: 'static_cast<double>',
      vmMapping: 'FLOAT_TO_DOUBLE',
      description: 'float → double: converts with extended precision'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'int' }],
      returnType: { kind: 'primitive', type: 'double' },
      cppMapping: 'static_cast<double>',
      vmMapping: 'INT_TO_DOUBLE',
      description: 'int → double: converts directly'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'string' }],
      returnType: { kind: 'primitive', type: 'double' },
  cppMapping: 'doof_runtime::string_to_double',
      vmMapping: 'STRING_TO_DOUBLE',
      description: 'string → double: parses as floating-point, panics if not valid'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'bool' }],
      returnType: { kind: 'primitive', type: 'double' },
      cppMapping: 'static_cast<double>',
      vmMapping: 'BOOL_TO_DOUBLE',
      description: 'bool → double: true → 1.0, false → 0.0'
    }
  ] as TypeConversionOverload[],

  string: [
    {
      inputTypes: [{ kind: 'primitive', type: 'string' }],
      returnType: { kind: 'primitive', type: 'string' },
      cppMapping: '(std::string)',
      vmMapping: 'STRING_IDENTITY',
      description: 'string → string: returns value unchanged'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'int' }],
      returnType: { kind: 'primitive', type: 'string' },
      cppMapping: 'std::to_string',
      vmMapping: 'INT_TO_STRING',
      description: 'int → string: decimal representation'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'float' }],
      returnType: { kind: 'primitive', type: 'string' },
      cppMapping: 'std::to_string',
      vmMapping: 'FLOAT_TO_STRING',
      description: 'float → string: decimal representation'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'double' }],
      returnType: { kind: 'primitive', type: 'string' },
      cppMapping: 'std::to_string',
      vmMapping: 'DOUBLE_TO_STRING',
      description: 'double → string: decimal representation'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'bool' }],
      returnType: { kind: 'primitive', type: 'string' },
  cppMapping: 'doof_runtime::bool_to_string',
      vmMapping: 'BOOL_TO_STRING',
      description: 'bool → string: true → "true", false → "false"'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'char' }],
      returnType: { kind: 'primitive', type: 'string' },
      cppMapping: 'std::string(1, ',
      vmMapping: 'CHAR_TO_STRING',
      description: 'char → string: single character string'
    }
    // Note: enum and class instances are handled separately
  ] as TypeConversionOverload[],

  bool: [
    {
      inputTypes: [{ kind: 'primitive', type: 'bool' }],
      returnType: { kind: 'primitive', type: 'bool' },
      cppMapping: '(bool)',
      vmMapping: 'BOOL_IDENTITY',
      description: 'bool → bool: returns value unchanged'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'int' }],
      returnType: { kind: 'primitive', type: 'bool' },
      cppMapping: 'static_cast<bool>',
      vmMapping: 'INT_TO_BOOL',
      description: 'int → bool: 0 → false, any other value → true'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'float' }],
      returnType: { kind: 'primitive', type: 'bool' },
      cppMapping: 'static_cast<bool>',
      vmMapping: 'FLOAT_TO_BOOL',
      description: 'float → bool: 0.0 → false, any other value → true'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'double' }],
      returnType: { kind: 'primitive', type: 'bool' },
      cppMapping: 'static_cast<bool>',
      vmMapping: 'DOUBLE_TO_BOOL',
      description: 'double → bool: 0.0 → false, any other value → true'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'string' }],
      returnType: { kind: 'primitive', type: 'bool' },
  cppMapping: 'doof_runtime::string_to_bool',
      vmMapping: 'STRING_TO_BOOL',
      description: 'string → bool: accepts only "true", "false", "1", "0" (case-sensitive)'
    }
  ] as TypeConversionOverload[],

  char: [
    {
      inputTypes: [{ kind: 'primitive', type: 'char' }],
      returnType: { kind: 'primitive', type: 'char' },
      cppMapping: '(char)',
      vmMapping: 'CHAR_IDENTITY',
      description: 'char → char: returns value unchanged'
    },
    {
      inputTypes: [{ kind: 'primitive', type: 'int' }],
      returnType: { kind: 'primitive', type: 'char' },
      cppMapping: 'static_cast<char>',
      vmMapping: 'INT_TO_CHAR',
      description: 'int → char: converts codepoint to character (validates range)'
    }
  ] as TypeConversionOverload[]
};

/**
 * Validates a canonical type conversion function call like int(x), string(y), etc.
 */
export function validateTypeConversionCall(
  expr: CallExpression,
  functionName: string,
  validator: Validator
): Type | null {
  // Check if this is a canonical type conversion function
  const overloads = TYPE_CONVERSION_FUNCTIONS[functionName as keyof typeof TYPE_CONVERSION_FUNCTIONS];
  if (!overloads) {
    return null; // Not a canonical type conversion function
  }

  // Must have exactly one argument
  if (expr.arguments.length !== 1) {
    validator.addError(
      `Type conversion function '${functionName}()' expects exactly 1 argument, got ${expr.arguments.length}`,
      expr.location
    );
    return { kind: 'primitive', type: 'void' };
  }

  const arg = expr.arguments[0];
  const argType = validateExpression(arg, validator);

  // Find matching overload
  let matchingOverload: TypeConversionOverload | null = null;
  for (const overload of overloads) {
    if (overload.inputTypes.length === 1 && isTypeCompatible(argType, overload.inputTypes[0], validator)) {
      matchingOverload = overload;
      break;
    }
  }

  // Special handling for string() function with enums and classes
  if (functionName === 'string' && !matchingOverload) {
    if (argType.kind === 'enum') {
      // string(enumValue) returns the enum label
      const enumType = argType as EnumTypeNode;
      
      // Store conversion info for codegen
      // ENUM_TO_STRING removed from VM; enums represented directly as strings.
      expr.typeConversionInfo = {
        function: 'string',
        inputType: argType,
        returnType: { kind: 'primitive', type: 'string' },
        cppMapping: `doof_runtime::enum_to_string`,
        vmMapping: 'STRING_IDENTITY', // direct value already a string in VM
        description: `enum → string: returns the enum label (direct string in VM)`
      };
      
      return { kind: 'primitive', type: 'string' };
    }

    if (argType.kind === 'class') {
      // string(classInstance) returns JSON representation
      const classType = argType as ClassTypeNode;
      
      // Mark the class for JSON printing
      validator.context.codeGenHints.jsonPrintTypes.add(classType.name);
      
      expr.typeConversionInfo = {
        function: 'string',
        inputType: argType,
        returnType: { kind: 'primitive', type: 'string' },
  cppMapping: `doof_runtime::class_to_json`,
        vmMapping: 'CLASS_TO_JSON',
        description: `class → string: JSON representation`
      };
      
      return { kind: 'primitive', type: 'string' };
    }
  }

  // Special handling for char() function with strings (only single-character strings allowed)
  if (functionName === 'char' && !matchingOverload && argType.kind === 'primitive' && argType.type === 'string') {
    // Check if it's a string literal
    if (arg.kind === 'literal' && (arg as any).literalType === 'string') {
      const stringValue = (arg as any).value as string;
      if (stringValue.length !== 1) {
        validator.addError(
          `char() requires a single-character string literal, got string of length ${stringValue.length}`,
          arg.location
        );
        return { kind: 'primitive', type: 'void' };
      }
      
      // Store conversion info for compile-time conversion
      expr.typeConversionInfo = {
        function: 'char',
        inputType: argType,
        returnType: { kind: 'primitive', type: 'char' },
        cppMapping: `static_cast<char>`,
        vmMapping: 'STRING_TO_CHAR',
        description: 'string → char: single character conversion (compile-time checked)'
      };
      
      return { kind: 'primitive', type: 'char' };
    } else {
      // Runtime string variable - reject for now (require explicit helper)
      validator.addError(
        `char() with string variables not supported; use a character literal or explicit helper`,
        arg.location
      );
      return { kind: 'primitive', type: 'void' };
    }
  }

  if (!matchingOverload) {
    validator.addError(
      `Cannot convert type '${typeToString(argType)}' to '${functionName}'. Supported input types: ${
        overloads.map(o => typeToString(o.inputTypes[0])).join(', ')
      }`,
      arg.location
    );
    return { kind: 'primitive', type: 'void' };
  }

  // Store conversion info for codegen
  expr.typeConversionInfo = {
    function: functionName,
    inputType: argType,
    returnType: matchingOverload.returnType,
    cppMapping: matchingOverload.cppMapping,
    vmMapping: matchingOverload.vmMapping,
    description: matchingOverload.description
  };

  return matchingOverload.returnType;
}

/**
 * Validates an enum conversion function call like MyEnum(value)
 */
export function validateEnumConversionCall(
  expr: CallExpression,
  enumName: string,
  validator: Validator
): Type | null {
  const enumDecl = validator.context.enums.get(enumName);
  if (!enumDecl) {
    return null; // Not an enum
  }

  // Must have exactly one argument
  if (expr.arguments.length !== 1) {
    validator.addError(
      `Enum conversion function '${enumName}()' expects exactly 1 argument, got ${expr.arguments.length}`,
      expr.location
    );
    return createEnumType(enumName);
  }

  const arg = expr.arguments[0];
  const argType = validateExpression(arg, validator);

  // Determine the enum's backing type
  let backingType: Type;
  let hasStringValues = false;
  let hasNumericValues = false;

  for (const member of enumDecl.members) {
    if (member.value) {
      if (member.value.literalType === 'string') {
        hasStringValues = true;
      } else if (member.value.literalType === 'number') {
        hasNumericValues = true;
      }
    } else {
      // No explicit value means numeric (auto-assigned)
      hasNumericValues = true;
    }
  }

  if (hasStringValues && hasNumericValues) {
    validator.addError(
      `Enum '${enumName}' has mixed string and numeric values, which is not allowed`,
      expr.location
    );
    return createEnumType(enumName);
  }

  backingType = hasStringValues ? { kind: 'primitive', type: 'string' } : { kind: 'primitive', type: 'int' };

  // The argument must match the enum's backing type
  if (!isTypeCompatible(argType, backingType, validator)) {
    const backingTypeName = hasStringValues ? 'string' : 'int';
    validator.addError(
      `Enum conversion function '${enumName}()' expects a ${backingTypeName} (the enum's backing type), got '${typeToString(argType)}'`,
      arg.location
    );
    return createEnumType(enumName);
  }

  // Store conversion info for codegen
  expr.enumConversionInfo = {
    enumName,
    backingType,
    inputType: argType,
    returnType: createEnumType(enumName),
    cppMapping: `static_cast<${enumName}>`,
    vmMapping: hasStringValues ? 'STRING_TO_ENUM' : 'INT_TO_ENUM'
  };

  return createEnumType(enumName);
}

/**
 * Main entry point for validating type conversion calls
 */
export function validateAnyTypeConversionCall(
  expr: CallExpression,
  functionName: string,
  validator: Validator
): Type | null {
  // First try canonical type conversion functions
  const canonicalResult = validateTypeConversionCall(expr, functionName, validator);
  if (canonicalResult) {
    return canonicalResult;
  }

  // Then try enum conversion functions
  const enumResult = validateEnumConversionCall(expr, functionName, validator);
  if (enumResult) {
    return enumResult;
  }

  return null; // Not a type conversion function
}