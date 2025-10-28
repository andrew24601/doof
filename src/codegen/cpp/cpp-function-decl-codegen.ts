// C++ function and method declaration generation for doof

import {
  Type, FunctionDeclaration, MethodDeclaration, Parameter, PrimitiveTypeNode,
  ArrayTypeNode, MapTypeNode, SetTypeNode, ClassTypeNode, EnumTypeNode
} from '../../types';
import { CppGenerator } from '../cppgen';
import { generateBlockStatement } from './cpp-statement-codegen';

export function generateFunctionDeclarationHeader(generator: CppGenerator, funcDecl: FunctionDeclaration): string {
  const params = formatParameterList(generator, funcDecl.parameters, true); // Include defaults in header
  const functionName = getCppFunctionName(generator, funcDecl);
  return generator.indent() + `${generator.generateType(funcDecl.returnType)} ${functionName}(${params});\n`;
}

export function generateFunctionDeclarationSource(generator: CppGenerator, funcDecl: FunctionDeclaration): string {
  const params = formatParameterList(generator, funcDecl.parameters, false); // No defaults in source
  const functionName = getCppFunctionName(generator, funcDecl);
  let output = `${generator.generateType(funcDecl.returnType)} ${functionName}(${params}) `;

  // Track function signature for later call resolution
  generator.functionSignatures.set(funcDecl.name.name, funcDecl);

  const prevScope = generator.currentScope;
  const prevReturnType = generator.currentFunctionReturnType;
  generator.currentScope = 'function';
  generator.currentFunctionReturnType = funcDecl.returnType;

  // Track function parameters in variable types
  for (const param of funcDecl.parameters) {
    generator.variableTypes.set(param.name.name, param.type);
  }

  output += generateBlockStatement(generator, funcDecl.body);

  generator.currentScope = prevScope;
  generator.currentFunctionReturnType = prevReturnType;

  return output;
}

export function generateMethodDeclarationHeader(generator: CppGenerator, method: MethodDeclaration, includeIndent: boolean = true): string {
  const params = formatParameterList(generator, method.parameters, true); // Include defaults in header
  const indent = includeIndent ? generator.indent() : '';
  return indent + `${generator.generateType(method.returnType)} ${method.name.name}(${params});\n`;
}

export function generateMethodDeclarationSource(generator: CppGenerator, method: MethodDeclaration, className: string): string {
  const params = formatParameterList(generator, method.parameters, false); // No defaults in source
  let output = `${generator.generateType(method.returnType)} ${className}::${method.name.name}(${params}) `;

  const prevScope = generator.currentScope;
  const prevMethod = generator.currentMethod;
  const prevReturnType = generator.currentFunctionReturnType;
  generator.currentScope = 'method';
  generator.currentMethod = method;
  generator.currentFunctionReturnType = method.returnType;

  // Track method parameters in variable types
  for (const param of method.parameters) {
    generator.variableTypes.set(param.name.name, param.type);
  }

  output += generateBlockStatement(generator, method.body);

  generator.currentScope = prevScope;
  generator.currentMethod = prevMethod;
  generator.currentFunctionReturnType = prevReturnType;

  return output;
}

export function generateStaticMethodDeclarationSource(generator: CppGenerator, method: MethodDeclaration, className: string): string {
  const params = formatParameterList(generator, method.parameters, false); // No defaults in source
  let output = `${generator.generateType(method.returnType)} ${className}::${method.name.name}(${params}) `;

  const prevScope = generator.currentScope;
  const prevMethod = generator.currentMethod;
  const prevReturnType = generator.currentFunctionReturnType;
  generator.currentScope = 'method';
  generator.currentMethod = method;
  generator.currentFunctionReturnType = method.returnType;

  // Track method parameters in variable types
  for (const param of method.parameters) {
    generator.variableTypes.set(param.name.name, param.type);
  }

  output += generateBlockStatement(generator, method.body);

  generator.currentScope = prevScope;
  generator.currentMethod = prevMethod;
  generator.currentFunctionReturnType = prevReturnType;

  return output;
}

// Helper functions

function getCppFunctionName(generator: CppGenerator, funcDecl: FunctionDeclaration): string {
  // If it's a main function with void return type and no namespace, rename to avoid conflict
  if (funcDecl.name.name === 'main' &&
    !generator.options.namespace &&
    funcDecl.parameters.length === 0 &&
    (!funcDecl.returnType ||
      (funcDecl.returnType.kind === 'primitive' && (funcDecl.returnType as PrimitiveTypeNode).type === 'void'))) {
    return 'doof_main';
  }
  return funcDecl.name.name;
}

function formatParameterList(generator: CppGenerator, parameters: Parameter[], includeDefaults: boolean = false): string {
  return parameters.map(p => {
    const wrapInCaptured = generator.shouldWrapCapturedMutableParameter(p);
    const typeName = wrapInCaptured
      ? generator.renderCapturedType(p.type)
      : generateParameterType(generator, p.type);

    let result = `${typeName} ${p.name.name}`;
    if (includeDefaults && p.defaultValue) {
      result += ` = ${generator.generateExpression(p.defaultValue)}`;
    }
    return result;
  }).join(', ');
}

function generateParameterType(generator: CppGenerator, type: Type): string {
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
      return `std::shared_ptr<std::vector<${generator.typeGen.generateType(arrayType.elementType)}>>`;
    case 'map':
      const mapType = type as MapTypeNode;
      return `std::map<${generator.typeGen.generateType(mapType.keyType)}, ${generator.typeGen.generateType(mapType.valueType)}>&`; // Pass maps by mutable reference
    case 'set':
      const setType = type as SetTypeNode;
      return `std::unordered_set<${generator.typeGen.generateType(setType.elementType)}>&`; // Pass sets by mutable reference
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
      const paramTypes = funcType.parameters.map(p => generator.typeGen.generateType(p.type)).join(', ');
      // Both escaping and non-escaping functions use std::function, but semantics differ
      // Escaping: may be stored, passed by value 
      // Non-escaping: temporary use only, also passed by value for simplicity
      return `std::function<${generator.typeGen.generateType(funcType.returnType)}(${paramTypes})>`;
    case 'union':
      return generator.typeGen.generateUnionType(type);
    default:
      throw new Error("Compiler error - unsupported parameter type");
  }
}
