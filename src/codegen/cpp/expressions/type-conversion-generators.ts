import {
  CallExpression,
  Type,
  EnumTypeNode,
  ClassTypeNode,
  PrimitiveTypeNode,
  EnumDeclaration
} from "../../../types";
import { CppGenerator } from "../../cppgen";
import { generateExpression } from "../cpp-expression-codegen";
import { typeToString } from "../../../type-utils";

/**
 * Generates C++ code for type conversion function calls like int(), string(), etc.
 */
export function generateTypeConversionCall(generator: CppGenerator, expr: CallExpression): string {
  if (!expr.typeConversionInfo && !expr.enumConversionInfo) {
    throw new Error('generateTypeConversionCall called without type conversion info');
  }

  const arg = expr.arguments[0];
  const argExpr = generateExpression(generator, arg);

  // Handle canonical type conversion functions
  if (expr.typeConversionInfo) {
    const info = expr.typeConversionInfo;
    
    switch (info.function) {
      case 'int':
        return generateIntConversion(generator, argExpr, info.inputType, info.cppMapping);
      
      case 'float':
        return generateFloatConversion(generator, argExpr, info.inputType, info.cppMapping);
      
      case 'double':
        return generateDoubleConversion(generator, argExpr, info.inputType, info.cppMapping);
      
      case 'string':
        return generateStringConversion(generator, argExpr, info.inputType, info.cppMapping);
      
      case 'bool':
        return generateBoolConversion(generator, argExpr, info.inputType, info.cppMapping);
      
      default:
        throw new Error(`Unknown type conversion function: ${info.function}`);
    }
  }

  // Handle enum conversion functions
  if (expr.enumConversionInfo) {
    const info = expr.enumConversionInfo;
    return generateEnumConversion(generator, argExpr, info);
  }

  throw new Error('No valid conversion info found');
}

function generateIntConversion(generator: CppGenerator, argExpr: string, inputType: Type, cppMapping: string): string {
  if (inputType.kind === 'primitive') {
    const primitiveType = (inputType as PrimitiveTypeNode).type;
    
    switch (primitiveType) {
      case 'int':
        return argExpr; // No conversion needed
      
      case 'float':
      case 'double':
        return `static_cast<int>(${argExpr})`;
      
      case 'string':
        // Add runtime dependency
        generator.validationContext!.codeGenHints.includeTypeConversions = true;
  return `doof_runtime::string_to_int(${argExpr})`;
      
      case 'bool':
        return `static_cast<int>(${argExpr})`;
      
      default:
        throw new Error(`Unsupported int conversion from ${primitiveType}`);
    }
  }
  
  throw new Error(`Unsupported int conversion from ${typeToString(inputType)}`);
}

function generateFloatConversion(generator: CppGenerator, argExpr: string, inputType: Type, cppMapping: string): string {
  if (inputType.kind === 'primitive') {
    const primitiveType = (inputType as PrimitiveTypeNode).type;
    
    switch (primitiveType) {
      case 'float':
        return argExpr; // No conversion needed
      
      case 'double':
      case 'int':
        return `static_cast<float>(${argExpr})`;
      
      case 'string':
        // Add runtime dependency
        generator.validationContext!.codeGenHints.includeTypeConversions = true;
  return `doof_runtime::string_to_float(${argExpr})`;
      
      case 'bool':
        return `static_cast<float>(${argExpr})`;
      
      default:
        throw new Error(`Unsupported float conversion from ${primitiveType}`);
    }
  }
  
  throw new Error(`Unsupported float conversion from ${typeToString(inputType)}`);
}

function generateDoubleConversion(generator: CppGenerator, argExpr: string, inputType: Type, cppMapping: string): string {
  if (inputType.kind === 'primitive') {
    const primitiveType = (inputType as PrimitiveTypeNode).type;
    
    switch (primitiveType) {
      case 'double':
        return argExpr; // No conversion needed
      
      case 'float':
      case 'int':
        return `static_cast<double>(${argExpr})`;
      
      case 'string':
        // Add runtime dependency
        generator.validationContext!.codeGenHints.includeTypeConversions = true;
  return `doof_runtime::string_to_double(${argExpr})`;
      
      case 'bool':
        return `static_cast<double>(${argExpr})`;
      
      default:
        throw new Error(`Unsupported double conversion from ${primitiveType}`);
    }
  }
  
  throw new Error(`Unsupported double conversion from ${typeToString(inputType)}`);
}

function generateStringConversion(generator: CppGenerator, argExpr: string, inputType: Type, cppMapping: string): string {
  if (inputType.kind === 'primitive') {
    const primitiveType = (inputType as PrimitiveTypeNode).type;
    
    switch (primitiveType) {
      case 'string':
        return argExpr; // No conversion needed
      
      case 'int':
      case 'float':
      case 'double':
        return `std::to_string(${argExpr})`;
      
      case 'bool':
        // Add runtime dependency for proper true/false conversion
        generator.validationContext!.codeGenHints.includeTypeConversions = true;
  return `doof_runtime::bool_to_string(${argExpr})`;
      
      default:
        throw new Error(`Unsupported string conversion from ${primitiveType}`);
    }
  }
  
  if (inputType.kind === 'enum') {
    const enumType = inputType as EnumTypeNode;
    // Generate enum to string function call
    generator.validationContext!.codeGenHints.enumToStringFunctions.add(enumType.name);
    return `to_string(${argExpr})`;
  }
  
  if (inputType.kind === 'class') {
    const classType = inputType as ClassTypeNode;
    // Mark class for JSON printing
    generator.validationContext!.codeGenHints.jsonPrintTypes.add(classType.name);
  return `doof_runtime::class_to_json_string(${argExpr})`;
  }
  
  throw new Error(`Unsupported string conversion from ${typeToString(inputType)}`);
}

function generateBoolConversion(generator: CppGenerator, argExpr: string, inputType: Type, cppMapping: string): string {
  if (inputType.kind === 'primitive') {
    const primitiveType = (inputType as PrimitiveTypeNode).type;
    
    switch (primitiveType) {
      case 'bool':
        return argExpr; // No conversion needed
      
      case 'int':
      case 'float':
      case 'double':
        return `static_cast<bool>(${argExpr})`;
      
      case 'string':
        // Add runtime dependency
        generator.validationContext!.codeGenHints.includeTypeConversions = true;
  return `doof_runtime::string_to_bool(${argExpr})`;
      
      default:
        throw new Error(`Unsupported bool conversion from ${primitiveType}`);
    }
  }
  
  throw new Error(`Unsupported bool conversion from ${typeToString(inputType)}`);
}

function generateEnumConversion(generator: CppGenerator, argExpr: string, info: any): string {
  const { enumName, backingType } = info;
  
  if (backingType.kind === 'primitive') {
    const primitiveType = (backingType as PrimitiveTypeNode).type;
    
    if (primitiveType === 'int') {
      // Runtime validation for integer-backed enums
      generator.validationContext!.codeGenHints.includeTypeConversions = true;
      generator.validationContext!.codeGenHints.enumValidationFunctions.add(enumName);
  return `doof_runtime::validate_enum_int<${enumName}>(${argExpr})`;
    } else if (primitiveType === 'string') {
      // Runtime validation for string-backed enums  
      generator.validationContext!.codeGenHints.includeTypeConversions = true;
      generator.validationContext!.codeGenHints.enumValidationFunctions.add(enumName);
  return `doof_runtime::validate_enum_string<${enumName}>(${argExpr})`;
    }
  }
  
  throw new Error(`Unsupported enum conversion for ${enumName} with backing type ${typeToString(backingType)}`);
}

/**
 * Check if a call expression is a type conversion function call
 */
export function isTypeConversionCall(expr: CallExpression): boolean {
  return !!(expr.typeConversionInfo || expr.enumConversionInfo);
}