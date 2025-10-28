import {
  CallExpression,
  Type,
  EnumTypeNode,
  ClassTypeNode,
  PrimitiveTypeNode
} from "../../../types";
import { JsGeneratorInterface } from "../js-expression-codegen";
import { typeToString } from "../../../type-utils";

/**
 * Generates JavaScript code for type conversion function calls like int(), string(), etc.
 */
export function generateJsTypeConversionCall(generator: JsGeneratorInterface, expr: CallExpression): string {
  if (!expr.typeConversionInfo && !expr.enumConversionInfo) {
    throw new Error('generateJsTypeConversionCall called without type conversion info');
  }

  const arg = expr.arguments[0];
  const argExpr = generator.generateExpression(arg);

  // Handle canonical type conversion functions
  if (expr.typeConversionInfo) {
    const info = expr.typeConversionInfo;
    
    switch (info.function) {
      case 'int':
        return generateJsIntConversion(generator, argExpr, info.inputType);
      
      case 'float':
      case 'double':
        return generateJsFloatConversion(generator, argExpr, info.inputType);
      
      case 'string':
        return generateJsStringConversion(generator, argExpr, info.inputType);
      
      case 'bool':
        return generateJsBoolConversion(generator, argExpr, info.inputType);
      
      default:
        throw new Error(`Unknown type conversion function: ${info.function}`);
    }
  }

  // Handle enum conversion functions
  if (expr.enumConversionInfo) {
    const info = expr.enumConversionInfo;
    return generateJsEnumConversion(generator, argExpr, info);
  }

  throw new Error('No valid conversion info found');
}

function generateJsIntConversion(generator: JsGeneratorInterface, argExpr: string, inputType: Type): string {
  if (inputType.kind === 'primitive') {
    const primitiveType = (inputType as PrimitiveTypeNode).type;
    
    switch (primitiveType) {
      case 'int':
        return argExpr; // No conversion needed
      
      case 'float':
      case 'double':
        return `Math.trunc(${argExpr})`;
      
      case 'string':
        return `parseInt(${argExpr}, 10)`;
      
      case 'bool':
        return `(${argExpr} ? 1 : 0)`;
      
      default:
        throw new Error(`Unsupported int conversion from ${primitiveType}`);
    }
  }
  
  throw new Error(`Unsupported int conversion from ${typeToString(inputType)}`);
}

function generateJsFloatConversion(generator: JsGeneratorInterface, argExpr: string, inputType: Type): string {
  if (inputType.kind === 'primitive') {
    const primitiveType = (inputType as PrimitiveTypeNode).type;
    
    switch (primitiveType) {
      case 'float':
      case 'double':
        return argExpr; // No conversion needed (JS numbers are already float)
      
      case 'int':
        return argExpr; // JavaScript numbers are already floating-point
      
      case 'string':
        return `parseFloat(${argExpr})`;
      
      case 'bool':
        return `(${argExpr} ? 1.0 : 0.0)`;
      
      default:
        throw new Error(`Unsupported float conversion from ${primitiveType}`);
    }
  }
  
  throw new Error(`Unsupported float conversion from ${typeToString(inputType)}`);
}

function generateJsStringConversion(generator: JsGeneratorInterface, argExpr: string, inputType: Type): string {
  if (inputType.kind === 'primitive') {
    const primitiveType = (inputType as PrimitiveTypeNode).type;
    
    switch (primitiveType) {
      case 'string':
        return argExpr; // No conversion needed
      
      case 'int':
      case 'float':
      case 'double':
        return `String(${argExpr})`;
      
      case 'bool':
        return `String(${argExpr})`;
      
      default:
        throw new Error(`Unsupported string conversion from ${primitiveType}`);
    }
  }
  
  if (inputType.kind === 'enum') {
    // For enums, convert to string representation
    // This assumes the enum values are already string literals in JS
    return `String(${argExpr})`;
  }
  
  if (inputType.kind === 'class') {
    // For classes, convert to JSON string
    return `JSON.stringify(${argExpr})`;
  }
  
  throw new Error(`Unsupported string conversion from ${typeToString(inputType)}`);
}

function generateJsBoolConversion(generator: JsGeneratorInterface, argExpr: string, inputType: Type): string {
  if (inputType.kind === 'primitive') {
    const primitiveType = (inputType as PrimitiveTypeNode).type;
    
    switch (primitiveType) {
      case 'bool':
        return argExpr; // No conversion needed
      
      case 'int':
      case 'float':
      case 'double':
        return `Boolean(${argExpr})`;
      
      case 'string':
        return `Boolean(${argExpr})`;
      
      default:
        throw new Error(`Unsupported bool conversion from ${primitiveType}`);
    }
  }
  
  throw new Error(`Unsupported bool conversion from ${typeToString(inputType)}`);
}

function generateJsEnumConversion(generator: JsGeneratorInterface, argExpr: string, info: any): string {
  // Handle enum conversions based on the backing type
  if (info.backingType === 'string') {
    return `${info.enumName}[${argExpr}]`;
  } else {
    // For int-backed enums
    return `${info.enumName}[${argExpr}]`;
  }
}

/**
 * Check if a call expression is a type conversion function call
 */
export function isJsTypeConversionCall(expr: CallExpression): boolean {
  return !!(expr.typeConversionInfo || expr.enumConversionInfo);
}