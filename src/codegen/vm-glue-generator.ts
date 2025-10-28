import {
  ClassTypeNode,
  ExternClassDeclaration,
  ExternClassTypeNode,
  MethodDeclaration,
  Parameter,
  PrimitiveTypeNode,
  Program,
  Type,
  TypeAliasNode,
  UnionTypeNode,
  ValidationContext
} from '../types';
import { typeToString } from '../type-utils';

export interface VmGlueFile {
  className: string;
  headerFileName: string;
  headerContent: string;
  sourceFileName: string;
  sourceContent: string;
}

export interface RegisterAllGlueFiles {
  headerFileName: string;
  headerContent: string;
  sourceFileName: string;
  sourceContent: string;
}

interface ExternClassInfo {
  header: string;
  namespace?: string;
}

interface ClassContext {
  className: string;
  classInfo: ExternClassInfo;
  classInfoMap: Map<string, ExternClassInfo>;
}

interface ParameterConversion {
  expression: string;
  referencedClasses: Set<string>;
}

interface ReturnConversion {
  referencedClasses: Set<string>;
  render(invocationExpression: string): { preReturnLines: string[]; returnStatement: string };
}

interface MethodGlue {
  lines: string[];
  referencedClasses: Set<string>;
}

interface ExternReference {
  name: string;
  isWeak?: boolean;
}

const INDENT = '    ';
const LEVEL_1 = INDENT;
const LEVEL_2 = INDENT.repeat(2);
const LEVEL_3 = INDENT.repeat(3);
const LEVEL_4 = INDENT.repeat(4);
const LEVEL_5 = INDENT.repeat(5);

function sanitizeIdentifier(raw: string): string {
  if (!raw) {
    return '_';
  }
  let result = '';
  for (let index = 0; index < raw.length; index += 1) {
    const charCode = raw.charCodeAt(index);
    const isUpper = charCode >= 65 && charCode <= 90;
    const isLower = charCode >= 97 && charCode <= 122;
    const isDigit = charCode >= 48 && charCode <= 57;
    if (isUpper || isLower || isDigit || raw[index] === '_') {
      result += raw[index];
    } else {
      result += '_';
    }
  }
  if (!result) {
    return '_';
  }
  const firstCode = result.charCodeAt(0);
  if (firstCode >= 48 && firstCode <= 57) {
    return `_${result}`;
  }
  return result;
}

function handleVariableName(className: string): string {
  return `${sanitizeIdentifier(className)}_class_handle`;
}

function qualifiedClassName(className: string, info?: ExternClassInfo): string {
  if (!info || !info.namespace) {
    return className;
  }
  return `${info.namespace}::${className}`;
}

function buildClassInfoMap(program?: Program, validationContext?: ValidationContext): Map<string, ExternClassInfo> {
  const map = new Map<string, ExternClassInfo>();

  if (validationContext) {
    for (const [name, decl] of validationContext.externClasses.entries()) {
      map.set(name, {
        header: decl.header || `${name}.h`,
        namespace: decl.namespace
      });
    }
  }

  if (program) {
    for (const statement of program.body) {
      if (statement.kind !== 'externClass') {
        continue;
      }
      const externDecl = statement as ExternClassDeclaration;
      map.set(externDecl.name.name, {
        header: externDecl.header || `${externDecl.name.name}.h`,
        namespace: externDecl.namespace
      });
    }
  }

  return map;
}

function isNullPrimitive(type: Type): boolean {
  return type.kind === 'primitive' && type.type === 'null';
}

function isNullableType(type: Type): boolean {
  if (isNullPrimitive(type)) {
    return true;
  }
  if (type.kind === 'union') {
    const unionType = type as UnionTypeNode;
    return unionType.types.some(member => isNullableType(member));
  }
  if ((type.kind === 'class' || type.kind === 'externClass') && (type as { wasNullable?: boolean }).wasNullable) {
    return true;
  }
  return false;
}

function unwrapNullable(type: Type): Type {
  if (type.kind === 'union') {
    const unionType = type as UnionTypeNode;
    for (const member of unionType.types) {
      if (!isNullPrimitive(member)) {
        return unwrapNullable(member);
      }
    }
    return type;
  }
  return type;
}

function expectExternInfo(className: string, map: Map<string, ExternClassInfo>): ExternClassInfo {
  const info = map.get(className);
  if (!info) {
    throw new Error(`Missing extern class metadata for '${className}'`);
  }
  return info;
}

function unsupportedType(type: Type, usage: string): never {
  throw new Error(`VM glue generation does not support type '${typeToString(type)}' for ${usage}`);
}

function resolveExternReference(type: Type, ctx: ClassContext): ExternReference | undefined {
  if (type.kind === 'externClass') {
    const externType = type as ExternClassTypeNode;
    return { name: externType.name, isWeak: externType.isWeak };
  }
  if (type.kind === 'class') {
    const classType = type as ClassTypeNode;
    if (ctx.classInfoMap.has(classType.name)) {
      return { name: classType.name, isWeak: classType.isWeak };
    }
    return undefined;
  }
  if (type.kind === 'typeAlias') {
    const aliasType = type as TypeAliasNode;
    if (ctx.classInfoMap.has(aliasType.name)) {
      return { name: aliasType.name, isWeak: aliasType.isWeak };
    }
  }
  return undefined;
}

function convertPrimitiveParameter(
  methodLabel: string,
  paramName: string,
  primitiveType: PrimitiveTypeNode,
  nullable: boolean,
  argIndex: number
): ParameterConversion {
  const primitive = primitiveType.type;

  if (primitive === 'void' || primitive === 'null') {
    unsupportedType(primitiveType, `parameter '${paramName}' of ${methodLabel}`);
  }

  if (nullable) {
    unsupportedType(primitiveType, `nullable parameter '${paramName}' of ${methodLabel}`);
  }

  let helperCall: string;

  switch (primitive) {
    case 'int':
      helperCall = `DoofVMGlue::expect_int(args, ${argIndex}, "${methodLabel}", "${paramName}")`;
      break;
    case 'float':
      helperCall = `DoofVMGlue::expect_float(args, ${argIndex}, "${methodLabel}", "${paramName}")`;
      break;
    case 'double':
      helperCall = `DoofVMGlue::expect_double(args, ${argIndex}, "${methodLabel}", "${paramName}")`;
      break;
    case 'bool':
      helperCall = `DoofVMGlue::expect_bool(args, ${argIndex}, "${methodLabel}", "${paramName}")`;
      break;
    case 'char':
      helperCall = `DoofVMGlue::expect_char(args, ${argIndex}, "${methodLabel}", "${paramName}")`;
      break;
    case 'string':
      helperCall = `DoofVMGlue::expect_string(args, ${argIndex}, "${methodLabel}", "${paramName}")`;
      break;
    default:
      unsupportedType(primitiveType, `parameter '${paramName}' of ${methodLabel}`);
  }

  return {
    expression: helperCall,
    referencedClasses: new Set<string>()
  };
}

function convertExternParameter(
  ctx: ClassContext,
  methodLabel: string,
  paramName: string,
  externType: ExternReference,
  nullable: boolean,
  argIndex: number,
  sourceType: Type
): ParameterConversion {
  if (externType.isWeak) {
    unsupportedType(sourceType, `parameter '${paramName}' of ${methodLabel}`);
  }

  const referencedClasses = new Set<string>();
  referencedClasses.add(externType.name);

  const dependencyInfo = expectExternInfo(externType.name, ctx.classInfoMap);
  const qualified = qualifiedClassName(externType.name, dependencyInfo);
  const handleName = handleVariableName(externType.name);
  const helper = nullable ? 'expect_optional_object' : 'expect_object';
  const expression = `DoofVMGlue::${helper}<${qualified}>(args, ${argIndex}, ${handleName}, "${methodLabel}", "${paramName}")`;

  return {
    expression,
    referencedClasses
  };
}

function convertParameter(
  param: Parameter,
  index: number,
  method: MethodDeclaration,
  ctx: ClassContext
): ParameterConversion {
  const methodLabel = `${ctx.className}::${method.name.name}`;
  const argIndex = method.isStatic ? index : index + 1;
  const paramName = param.name.name || `arg${index}`;
  const nullable = isNullableType(param.type);
  const baseType = unwrapNullable(param.type);

  const externRef = resolveExternReference(baseType, ctx);
  if (externRef) {
    return convertExternParameter(
      ctx,
      methodLabel,
      paramName,
      externRef,
      nullable,
      argIndex,
      baseType
    );
  }

  if (baseType.kind === 'primitive') {
    return convertPrimitiveParameter(
      methodLabel,
      paramName,
      baseType as PrimitiveTypeNode,
      nullable,
      argIndex
    );
  }

  unsupportedType(param.type, `parameter '${paramName}' of ${methodLabel}`);
}

function convertReturnValue(method: MethodDeclaration, ctx: ClassContext): ReturnConversion {
  const methodLabel = `${ctx.className}::${method.name.name}`;
  const nullable = isNullableType(method.returnType);
  const baseType = unwrapNullable(method.returnType);

  const externRef = resolveExternReference(baseType, ctx);

  if (baseType.kind === 'primitive') {
    switch (baseType.type) {
      case 'void':
        return {
          referencedClasses: new Set<string>(),
          render: (invocationExpression: string) => ({
            preReturnLines: [`${invocationExpression};`],
            returnStatement: 'return Value::make_null();'
          })
        };
      case 'int':
        if (nullable) {
          unsupportedType(method.returnType, `nullable return type of ${methodLabel}`);
        }
        return {
          referencedClasses: new Set<string>(),
          render: (invocationExpression: string) => ({
            preReturnLines: [],
            returnStatement: `return Value::make_int(${invocationExpression});`
          })
        };
      case 'float':
        if (nullable) {
          unsupportedType(method.returnType, `nullable return type of ${methodLabel}`);
        }
        return {
          referencedClasses: new Set<string>(),
          render: (invocationExpression: string) => ({
            preReturnLines: [],
            returnStatement: `return Value::make_float(${invocationExpression});`
          })
        };
      case 'double':
        if (nullable) {
          unsupportedType(method.returnType, `nullable return type of ${methodLabel}`);
        }
        return {
          referencedClasses: new Set<string>(),
          render: (invocationExpression: string) => ({
            preReturnLines: [],
            returnStatement: `return Value::make_double(${invocationExpression});`
          })
        };
      case 'bool':
        if (nullable) {
          unsupportedType(method.returnType, `nullable return type of ${methodLabel}`);
        }
        return {
          referencedClasses: new Set<string>(),
          render: (invocationExpression: string) => ({
            preReturnLines: [],
            returnStatement: `return Value::make_bool(${invocationExpression});`
          })
        };
      case 'char':
        if (nullable) {
          unsupportedType(method.returnType, `nullable return type of ${methodLabel}`);
        }
        return {
          referencedClasses: new Set<string>(),
          render: (invocationExpression: string) => ({
            preReturnLines: [],
            returnStatement: `return Value::make_char(${invocationExpression});`
          })
        };
      case 'string':
        if (nullable) {
          unsupportedType(method.returnType, `nullable return type of ${methodLabel}`);
        }
        return {
          referencedClasses: new Set<string>(),
          render: (invocationExpression: string) => ({
            preReturnLines: [],
            returnStatement: `return Value::make_string(${invocationExpression});`
          })
        };
      default:
        unsupportedType(baseType, `return type of ${methodLabel}`);
    }
  }

  if (externRef) {
    if (externRef.isWeak) {
      unsupportedType(method.returnType, `return type of ${methodLabel}`);
    }
    const dependencyInfo = expectExternInfo(externRef.name, ctx.classInfoMap);
    const qualified = qualifiedClassName(externRef.name, dependencyInfo);
    const handleName = handleVariableName(externRef.name);
    return {
      referencedClasses: new Set<string>([externRef.name]),
      render: (invocationExpression: string) => ({
        preReturnLines: [],
        returnStatement: `return DoofVM::wrap_extern_object<${qualified}>(${handleName}, ${invocationExpression});`
      })
    };
  }

  unsupportedType(method.returnType, `return type of ${methodLabel}`);
}

function generateMethodGlue(method: MethodDeclaration, ctx: ClassContext): MethodGlue {
  const referencedClasses = new Set<string>();
  const methodLabel = `${ctx.className}::${method.name.name}`;
  if (!method.isStatic) {
    referencedClasses.add(ctx.className);
  }

  const parameterConversions: ParameterConversion[] = [];
  method.parameters.forEach((param, index) => {
    const conversion = convertParameter(param, index, method, ctx);
    parameterConversions.push(conversion);
    conversion.referencedClasses.forEach(name => referencedClasses.add(name));
  });

  const returnConversion = convertReturnValue(method, ctx);
  returnConversion.referencedClasses.forEach(name => referencedClasses.add(name));

  const captureHandles = Array.from(referencedClasses)
    .map(name => handleVariableName(name))
    .sort((a, b) => a.localeCompare(b));

  const captureList = captureHandles.length > 0 ? `[${captureHandles.join(', ')}]` : '[]';
  const qualifiedSelf = qualifiedClassName(ctx.className, ctx.classInfo);

  const methodLines: string[] = [];
  methodLines.push(`${LEVEL_1}vm.register_extern_function("${methodLabel}", ${captureList}(Value* args) -> Value {`);
  methodLines.push(`${LEVEL_2}return DoofVMGlue::dispatch("${methodLabel}", args, [&]() -> Value {`);

  const argumentExpressions = parameterConversions.map(conversion => conversion.expression).join(', ');
  const selfInvocationPrefix = method.isStatic
    ? `${qualifiedSelf}::${method.name.name}`
    : `DoofVMGlue::expect_object<${qualifiedSelf}>(args, 0, ${handleVariableName(ctx.className)}, "${methodLabel}", "self")->${method.name.name}`;
  const invocation = `${selfInvocationPrefix}(${argumentExpressions})`;

  const renderedReturn = returnConversion.render(invocation);
  renderedReturn.preReturnLines.forEach(line => {
    methodLines.push(`${LEVEL_3}${line}`);
  });
  methodLines.push(`${LEVEL_3}${renderedReturn.returnStatement}`);

  methodLines.push(`${LEVEL_2}});`);
  methodLines.push(`${LEVEL_1}});`);

  return {
    lines: methodLines,
    referencedClasses
  };
}

function generateClassGlue(declaration: ExternClassDeclaration, classInfoMap: Map<string, ExternClassInfo>): VmGlueFile {
  const className = declaration.name.name;
  const classInfo = expectExternInfo(className, classInfoMap);
  const ctx: ClassContext = {
    className,
    classInfo,
    classInfoMap
  };

  const headerFileName = `${className}_glue.h`;
  const sourceFileName = `${className}_glue.cpp`;

  const headerLines = [
    '#pragma once',
    '',
    '#include "vm.h"',
    '',
    `void register_${className}_glue(DoofVM& vm);`,
    ''
  ];

  const classDependencies = new Set<string>();
  classDependencies.add(className);
  const methodBlocks: string[][] = [];

  declaration.methods.forEach(method => {
    const methodGlue = generateMethodGlue(method, ctx);
    methodBlocks.push(methodGlue.lines);
    methodGlue.referencedClasses.forEach(name => classDependencies.add(name));
  });

  const dependencyHeaders = new Set<string>();
  classDependencies.forEach(name => {
    const info = expectExternInfo(name, classInfoMap);
    dependencyHeaders.add(info.header);
  });

  const orderedHeaders: string[] = [];
  orderedHeaders.push(classInfo.header);
  Array.from(dependencyHeaders)
    .filter(header => header !== classInfo.header)
    .sort((a, b) => a.localeCompare(b))
    .forEach(header => orderedHeaders.push(header));

  const sourceLines: string[] = [];
  sourceLines.push(`#include "${headerFileName}"`);
  orderedHeaders.forEach(header => {
    sourceLines.push(`#include "${header}"`);
  });
  sourceLines.push('#include "vm.h"');
  sourceLines.push('#include "vm_glue_helpers.h"');
  sourceLines.push('');
  sourceLines.push(`void register_${className}_glue(DoofVM& vm) {`);

  const orderedClassNames = [
    className,
    ...Array.from(classDependencies).filter(name => name !== className).sort((a, b) => a.localeCompare(b))
  ];

  orderedClassNames.forEach(name => {
    const handleName = handleVariableName(name);
    sourceLines.push(`${LEVEL_1}auto ${handleName} = vm.ensure_extern_class("${name}");`);
  });

  sourceLines.push('');
  methodBlocks.forEach(lines => {
    lines.forEach(line => sourceLines.push(line));
    sourceLines.push('');
  });
  if (methodBlocks.length === 0) {
    sourceLines.push('');
  }
  sourceLines.push('}');
  sourceLines.push('');

  return {
    className,
    headerFileName,
    headerContent: headerLines.join('\n'),
    sourceFileName,
    sourceContent: sourceLines.join('\n')
  };
}

export function generateVmGlueFromProgram(program: Program, validationContext?: ValidationContext): VmGlueFile[] {
  const classInfoMap = buildClassInfoMap(program, validationContext);
  const files: VmGlueFile[] = [];

  for (const statement of program.body) {
    if (statement.kind !== 'externClass') {
      continue;
    }
    const declaration = statement as ExternClassDeclaration;
    files.push(generateClassGlue(declaration, classInfoMap));
  }

  return files;
}

export function generateRegisterAllGlue(classNames: string[]): RegisterAllGlueFiles | undefined {
  if (classNames.length === 0) {
    return undefined;
  }

  const sortedNames = Array.from(new Set(classNames)).sort((a, b) => a.localeCompare(b));
  const headerFileName = 'register_all_vm_glue.h';
  const sourceFileName = 'register_all_vm_glue.cpp';

  const headerLines = [
    '#pragma once',
    '',
    '#include "vm.h"',
    '',
    'void register_all_vm_glue(DoofVM& vm);',
    ''
  ];

  const sourceLines = [
    `#include "${headerFileName}"`,
    ...sortedNames.map(name => `#include "${name}_glue.h"`),
    '',
    'void register_all_vm_glue(DoofVM& vm) {'
  ];

  sortedNames.forEach(name => {
    sourceLines.push(`${LEVEL_1}register_${name}_glue(vm);`);
  });

  sourceLines.push('}');
  sourceLines.push('');

  return {
    headerFileName,
    headerContent: headerLines.join('\n'),
    sourceFileName,
    sourceContent: sourceLines.join('\n')
  };
}
