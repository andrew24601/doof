// Utility functions for C++ code generation

import {
  Type, Parameter, Identifier, Literal, ValidationContext, ExternClassDeclaration,
  PrimitiveTypeNode, ArrayTypeNode, MapTypeNode, SetTypeNode, ClassTypeNode, EnumTypeNode,
  GlobalValidationContext
} from '../../types';

export interface CppGeneratorContext {
  getExternClass: (name: string) => ExternClassDeclaration | undefined;
  validationContext?: ValidationContext;
  globalContext?: GlobalValidationContext;
  generateType(type: Type): string;
  generateExpression(expr: any): string;
}

// Helper function to encode property names that aren't valid C++ identifiers
export function encodeCppFieldName(name: string): string {
  // If the name is already a valid C++ identifier, return as-is
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return name;
  }

  // For quoted property names with special characters, encode them
  // Replace non-alphanumeric characters with underscores
  let encoded = name.replace(/[^a-zA-Z0-9]/g, '_');

  // Ensure it starts with a letter or underscore
  if (/^[0-9]/.test(encoded)) {
    encoded = '_' + encoded;
  }

  return encoded;
}

// Helper function to get the appropriate field name for C++ generation
export function getCppFieldName(field: { name: { name: string } }): string {
  return encodeCppFieldName(field.name.name);
}

// Helper function to get member property name from expressions
export function getMemberPropertyName(property: Identifier | Literal | undefined): string {
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

// Check if a name is a runtime symbol
export function isRuntimeSymbol(name: string): boolean {
  // Check if this is a runtime symbol like 'println', 'print', etc.
  return ['println', 'panic', 'print', 'exit', 'time', 'round', 'floor', 'ceil', 'abs', 'min', 'max'].includes(name);
}

// Helper method to format parameter lists
export function formatParameterList(
  parameters: Parameter[], 
  context: CppGeneratorContext,
  includeDefaults: boolean = false
): string {
  return parameters.map(p => {
    let result = `${generateParameterType(p.type, context)} ${p.name.name}`;
    if (includeDefaults && p.defaultValue) {
      result += ` = ${context.generateExpression(p.defaultValue)}`;
    }
    return result;
  }).join(', ');
}

// Generate parameter type for function/method parameters
export function generateParameterType(type: Type, context: CppGeneratorContext): string {
  switch (type.kind) {
    case 'primitive':
      const primType = type as PrimitiveTypeNode;
      switch (primType.type) {
        case 'string': return 'const std::string&'; // Pass strings by const reference
        case 'void': return 'void';
        default: return primType.type; // Pass primitives by value
      }
    case 'array':
      const arrayType = type as ArrayTypeNode;
      // Dynamic array - use shared_ptr semantics
      return `std::shared_ptr<std::vector<${context.generateType(arrayType.elementType)}>>`;
    case 'map':
      const mapType = type as MapTypeNode;
      return `std::map<${context.generateType(mapType.keyType)}, ${context.generateType(mapType.valueType)}>&`; // Pass maps by mutable reference
    case 'set':
      const setType = type as SetTypeNode;
      return `std::unordered_set<${context.generateType(setType.elementType)}>&`; // Pass sets by mutable reference
    case 'class':
      const classType = type as ClassTypeNode;
      if (classType.isWeak) {
        return `std::weak_ptr<${classType.name}>`;
      } else {
        return `std::shared_ptr<${classType.name}>`; // Classes are already references
      }
    case 'externClass':
      const typeName = type.namespace ? `${type.namespace}::${type.name}` : type.name;
      if (type.isWeak) {
        return `std::weak_ptr<${typeName}>`;
      } else {
        return `std::shared_ptr<${typeName}>`; // Extern classes are already references
      }
    case 'enum':
      const enumType = type as EnumTypeNode;
      return enumType.name; // Pass enums by value
    case 'function':
      const funcType = type;
      const paramTypes = funcType.parameters.map(p => context.generateType(p.type)).join(', ');
      // Both escaping and non-escaping functions use std::function, but semantics differ
      // Escaping: may be stored, passed by value 
      // Non-escaping: temporary use only, also passed by value for simplicity
      return `std::function<${context.generateType(funcType.returnType)}(${paramTypes})>`;
    case 'union':
      return context.generateType(type); // Delegate to context's union type generation
    default:
      throw new Error("Compiler error - unsupported parameter type");
  }
}

// Helper method to get qualified class name for imports
export function getQualifiedClassName(
  className: string, 
  context: CppGeneratorContext
): string {
  if (context.validationContext?.imports.has(className)) {
    const importInfo = context.validationContext.imports.get(className)!;
    return `${importInfo.sourceModule}::${importInfo.importedName}`;
  }

  // Check for extern classes and use their namespace
  const externClass = context.getExternClass(className);
  if (externClass && externClass.namespace) {
    return `${externClass.namespace}::${className}`;
  }

  // Check if this type exists in the same module as any imported type
  if (context.validationContext?.imports) {
    for (const [localName, importInfo] of context.validationContext.imports) {
      // Check if the className exists in the global context for the same module
      if (context.globalContext?.exportedSymbols) {
        const fullyQualifiedName = `${importInfo.sourceModule}::${className}`;
        if (context.globalContext.exportedSymbols.has(fullyQualifiedName)) {
          return fullyQualifiedName;
        }
      }
    }
  }

  return className;
}

// Convert a source file path to a header filename
export function getHeaderNameFromFilePath(filePath: string): string {
  // Extract the basename without extension and add .h
  const lastSlash = filePath.lastIndexOf('/');
  const basename = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
  const nameWithoutExt = basename.endsWith('.do') ? basename.slice(0, -3) : basename;
  return nameWithoutExt + '.h';
}
