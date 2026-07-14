// C++ type lowering for the self-hosted emitter.
//
// This module owns representation choices only.  It deliberately does not
// inspect declarations or expressions; those concerns belong to the other
// emitter modules.

import {
  ArrayResolvedType, ClassType, EnumType, FunctionParamType, FunctionType, InterfaceType, JsonValueResolvedType, MapResolvedType, PrimitiveType, ResolvedType, ResultResolvedType, StreamResolvedType, Symbol,
  NullType, TupleResolvedType, UnionResolvedType, UnknownType, TypeParameterType, VoidType,
} from "./semantic"
import { moduleNamespace } from "./emitter-names"
import { substituteTypeParams } from "./checker-types"
import { EmitContext } from "./emitter-context"
import { classInstantiationKey, concreteName, interfaceInstantiationKey } from "./emitter-monomorphize"

export function specializeEmitType(resolvedType: ResolvedType, context: EmitContext): ResolvedType {
  if context.substitution == null { return resolvedType }
  return substituteTypeParams(resolvedType, context.substitution!.names, context.substitution!.arguments)
}

export function emitContextType(resolvedType: ResolvedType, context: EmitContext): string {
  specialized := specializeEmitType(resolvedType, context)
  return emitType(lowerRegisteredTypes(specialized, context), context.modulePath)
}

// Replace reached Doof generic nominals throughout a compound type before
// ordinary representation lowering. This keeps tuples, callbacks, Results,
// unions, and collections from accidentally reintroducing C++ templates.
function lowerRegisteredTypes(type_: ResolvedType, context: EmitContext): ResolvedType {
  case type_ {
    class_: ClassType -> {
      boundaryKey := class_.symbol.module + "::" + class_.name
      for existing of context.nativeTemplateClassKeys {
        if existing == boundaryKey {
          let arguments: ResolvedType[] = []
          for argument of class_.typeArgs { arguments.push(lowerRegisteredTypes(argument, context)) }
          return ClassType { name: class_.name, symbol: class_.symbol, typeArgs: arguments }
        }
      }
      if class_.typeArgs.length > 0 && !class_.symbol.native_ {
        key := classInstantiationKey(class_.symbol.module, class_.name, class_.typeArgs)
        for i of 0..<context.concreteClassKeys.length {
          if context.concreteClassKeys[i] == key {
            return ClassType { name: context.concreteClassNames[i], symbol: class_.symbol }
          }
        }
        return ClassType { name: concreteName(class_.name, class_.typeArgs), symbol: class_.symbol }
      }
      let arguments: ResolvedType[] = []
      for argument of class_.typeArgs { arguments.push(lowerRegisteredTypes(argument, context)) }
      return ClassType { name: class_.name, symbol: class_.symbol, typeArgs: arguments }
    }
    interface_: InterfaceType -> {
      if interface_.typeArgs.length > 0 {
        return InterfaceType { name: concreteName(interface_.name, interface_.typeArgs), symbol: interface_.symbol }
      }
      return interface_
    }
    array: ArrayResolvedType -> { return ArrayResolvedType { elementType: lowerRegisteredTypes(array.elementType, context), readonly_: array.readonly_ } }
    map: MapResolvedType -> { return MapResolvedType { keyType: lowerRegisteredTypes(map.keyType, context), valueType: lowerRegisteredTypes(map.valueType, context), readonly_: map.readonly_ } }
    stream: StreamResolvedType -> { return StreamResolvedType { elementType: lowerRegisteredTypes(stream.elementType, context) } }
    result_: ResultResolvedType -> { return ResultResolvedType { valueType: lowerRegisteredTypes(result_.valueType, context), errorType: lowerRegisteredTypes(result_.errorType, context) } }
    tuple: TupleResolvedType -> {
      let elements: ResolvedType[] = []
      for element of tuple.elements { elements.push(lowerRegisteredTypes(element, context)) }
      return TupleResolvedType { elements }
    }
    union_: UnionResolvedType -> {
      let members: ResolvedType[] = []
      for member of union_.types { members.push(lowerRegisteredTypes(member, context)) }
      return UnionResolvedType { types: members, aliasName: union_.aliasName, aliasModule: union_.aliasModule }
    }
    function_: FunctionType -> {
      let parameters: FunctionParamType[] = []
      for parameter of function_.params {
        parameters.push(FunctionParamType { name: parameter.name, type_: lowerRegisteredTypes(parameter.type_, context), hasDefault: parameter.hasDefault })
      }
      return FunctionType { params: parameters, returnType: lowerRegisteredTypes(function_.returnType, context), typeParams: function_.typeParams }
    }
    _ -> { return type_ }
  }
  return type_
}

function concreteInterfaceName(context: EmitContext, key: string): string {
  for i of 0..<context.concreteInterfaceKeys.length {
    if context.concreteInterfaceKeys[i] == key { return context.concreteInterfaceNames[i] }
  }
  return ""
}

export function emitType(resolvedType: ResolvedType, currentModulePath: string = ""): string {
  case resolvedType {
    primitive: PrimitiveType -> { return emitPrimitive(primitive.name) }
    class_: ClassType -> {
      if class_.name == "Expression" { return "std::variant<" + expressionAlternatives(class_.symbol.module, currentModulePath) + ">" }
      if class_.name == "Statement" { return "std::variant<" + statementAlternatives(class_.symbol.module, currentModulePath) + ">" }
      if class_.name == "TypeAnnotation" { return "std::variant<std::shared_ptr<" + ownedName("NamedType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("ArrayType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnionType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("AstFunctionType", class_.symbol.module, currentModulePath) + ">>" }
      if class_.name == "AstNamedType" { return "std::shared_ptr<" + ownedName("NamedType", class_.symbol.module, currentModulePath) + ">" }
      if class_.name == "AstArrayType" { return "std::shared_ptr<" + ownedName("ArrayType", class_.symbol.module, currentModulePath) + ">" }
      if class_.name == "AstUnionType" { return "std::shared_ptr<" + ownedName("UnionType", class_.symbol.module, currentModulePath) + ">" }
      if class_.name == "SemanticFunctionType" { return "std::shared_ptr<" + ownedName("FunctionType", class_.symbol.module, currentModulePath) + ">" }
      if class_.symbol.kind == "struct" { return emitClassInnerType(class_, currentModulePath) }
      return "std::shared_ptr<" + emitClassInnerType(class_, currentModulePath) + ">"
    }
    enum_: EnumType -> { return ownedName(enum_.name, enum_.symbol.module, currentModulePath) }
    interface_: InterfaceType -> {
      name := if interface_.typeArgs.length == 0 then interface_.name else concreteName(interface_.name, interface_.typeArgs)
      return ownedName(name, interface_.symbol.module, currentModulePath)
    }
    function_: FunctionType -> { return emitCallbackType(function_, currentModulePath) }
    array: ArrayResolvedType -> {
      return "std::shared_ptr<std::vector<" + emitType(array.elementType, currentModulePath) + ">>"
    }
    map: MapResolvedType -> {
      return "std::shared_ptr<doof::ordered_map<" + emitType(map.keyType, currentModulePath) + ", " + emitType(map.valueType, currentModulePath) + ">>"
    }
    stream: StreamResolvedType -> { return concreteName("Stream", [stream.elementType]) }
    _: JsonValueResolvedType -> { return "doof::JsonValue" }
    result: ResultResolvedType -> { return "doof::Result<" + emitType(result.valueType, currentModulePath) + ", " + emitType(result.errorType, currentModulePath) + ">" }
    tuple: TupleResolvedType -> { return emitTupleType(tuple, currentModulePath) }
    union_: UnionResolvedType -> { return emitUnionType(union_, currentModulePath) }
    _: NullType -> { return "std::monostate" }
    _: VoidType -> { return "void" }
    _: UnknownType -> { panic("Cannot emit unresolved unknown type in " + currentModulePath) }
    parameter: TypeParameterType -> { return parameter.name }
  }
  return "void"
}

export function emitClassInnerType(class_: ClassType, currentModulePath: string = ""): string {
  let className = if class_.symbol.native_ then nativeCppName(class_.symbol) else ownedName(class_.name, class_.symbol.module, currentModulePath)
  if class_.typeArgs.length > 0 {
    className = className + "<"
    for i of 0..<class_.typeArgs.length {
      if i > 0 { className = className + ", " }
      className = className + emitType(class_.typeArgs[i], currentModulePath)
    }
    className = className + ">"
  }
  return className
}

function nativeCppName(symbol: Symbol): string {
  return "::" + (if symbol.nativeCppName == "" then symbol.name else symbol.nativeCppName)
}

function expressionAlternatives(ownerModule: string = "", currentModulePath: string = ""): string {
  return "std::shared_ptr<" + ownedName("IntLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("LongLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("FloatLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("DoubleLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("StringLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CharLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("BoolLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("NullLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("Identifier", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("BinaryExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnaryExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("AssignmentExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("MemberExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("IndexExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CallExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ArrayLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ObjectLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("TupleLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("LambdaExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("IfExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CaseExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ConstructExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("DotShorthand", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ThisExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CallerExpression", ownerModule, currentModulePath) + ">"
}

function typeAnnotationAlternatives(ownerModule: string = "", currentModulePath: string = ""): string {
  return "std::shared_ptr<" + ownedName("NamedType", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ArrayType", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnionType", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("AstFunctionType", ownerModule, currentModulePath) + ">"
}

function statementAlternatives(ownerModule: string = "", currentModulePath: string = ""): string {
  return "std::shared_ptr<" + ownedName("ConstDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ReadonlyDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ImmutableBinding", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("LetDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("FunctionDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ClassDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("InterfaceDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("EnumDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("TypeAliasDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ImportDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ExportDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ExportList", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("IfStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CaseStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("WhileStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ForStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ForOfStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("WithStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ReturnStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("YieldStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("BreakStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ContinueStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ExpressionStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("DestructuringStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("TryStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("Block", ownerModule, currentModulePath) + ">"
}

function emitPrimitive(name: string): string {
  if name == "byte" { return "uint8_t" }
  if name == "int" { return "int32_t" }
  if name == "long" { return "int64_t" }
  if name == "float" { return "float" }
  if name == "double" { return "double" }
  if name == "string" { return "std::string" }
  if name == "char" { return "char32_t" }
  if name == "bool" { return "bool" }
  panic("Cannot emit unknown primitive type " + name)
  return "void"
}

function emitCallbackType(function_: FunctionType, currentModulePath: string): string {
  let parameters = ""
  for i of 0..<function_.params.length {
    if i > 0 { parameters = parameters + ", " }
    parameters = parameters + emitType(function_.params[i].type_, currentModulePath)
  }
  return "doof::callback<" + emitType(function_.returnType, currentModulePath) + "(" + parameters + ")>"
}

function emitTupleType(tuple: TupleResolvedType, currentModulePath: string = ""): string {
  let result = "std::tuple<"
  for i of 0..<tuple.elements.length {
    if i > 0 { result = result + ", " }
    result = result + emitType(tuple.elements[i], currentModulePath)
  }
  return result + ">"
}

function emitUnionType(union_: UnionResolvedType, currentModulePath: string = ""): string {
  if union_.aliasModule == "/selfhost/semantic.do" && union_.aliasName == "ResolvedType" {
    return semanticResolvedTypeVariant(currentModulePath, containsNull(union_))
  }
  if union_.aliasModule == "/selfhost/ast.do" && union_.aliasName == "Expression" { return astAliasVariant(expressionAlternatives("/selfhost/ast.do", currentModulePath), containsNull(union_)) }
  if union_.aliasModule == "/selfhost/ast.do" && union_.aliasName == "Statement" { return astAliasVariant(statementAlternatives("/selfhost/ast.do", currentModulePath), containsNull(union_)) }
  if union_.aliasModule == "/selfhost/ast.do" && union_.aliasName == "TypeAnnotation" { return astAliasVariant(typeAnnotationAlternatives("/selfhost/ast.do", currentModulePath), containsNull(union_)) }
  if union_.aliasModule == "/selfhost/ast.do" && union_.aliasName == "CasePattern" { return "std::variant<std::shared_ptr<" + ownedName("TypePattern", "/selfhost/ast.do", currentModulePath) + ">, std::shared_ptr<" + ownedName("WildcardPattern", "/selfhost/ast.do", currentModulePath) + ">, std::shared_ptr<" + ownedName("ValuePattern", "/selfhost/ast.do", currentModulePath) + ">>" }
  if union_.aliasModule == "/selfhost/ast.do" && union_.aliasName == "ImportSpecifier" { return "std::variant<std::shared_ptr<" + ownedName("NamedImport", "/selfhost/ast.do", currentModulePath) + ">, std::shared_ptr<" + ownedName("NamespaceImport", "/selfhost/ast.do", currentModulePath) + ">>" }
  if union_.types.length == 0 {
    panic("Cannot emit empty resolved union in " + currentModulePath)
  }
  flattened := flattenUnionMembers(union_.types)
  let nonNull: ResolvedType[] = []
  let hasNull = false
  for member of flattened {
    if member.kind == "null" { hasNull = true }
    else { nonNull.push(member) }
  }

  // A nullable class already has a natural nullptr representation.  Primitive
  // nullable values use optional; larger unions retain an explicit variant.
  if hasNull && nonNull.length == 1 {
    case nonNull[0] {
      class_: ClassType -> {
        if class_.name == "Expression" { return "std::variant<std::monostate, " + expressionAlternatives(class_.symbol.module, currentModulePath) + ">" }
        if class_.name == "Statement" { return "std::variant<std::monostate, " + statementAlternatives(class_.symbol.module, currentModulePath) + ">" }
        if class_.name == "TypeAnnotation" { return "std::variant<std::monostate, std::shared_ptr<" + ownedName("NamedType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("ArrayType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnionType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("AstFunctionType", class_.symbol.module, currentModulePath) + ">>" }
        return emitType(nonNull[0], currentModulePath)
      }
      _: ArrayResolvedType -> { return emitType(nonNull[0], currentModulePath) }
      _: PrimitiveType -> { return "std::optional<" + emitType(nonNull[0], currentModulePath) + ">" }
      _ -> { }
    }
  }

  let result = "std::variant<"
  let hasMember = false
  if hasNull { result = result + "std::monostate"; hasMember = true }
  for member of nonNull {
    memberText := emitUnionMember(member, currentModulePath)
    if hasMember { result = result + ", " }
    result = result + memberText
    hasMember = true
  }
  if !hasMember {
    panic("Cannot emit empty resolved union in " + currentModulePath)
  }
  return result + ">"
}

function containsNull(union_: UnionResolvedType): bool {
  for member of union_.types {
    if member.kind == "null" { return true }
    case member {
      nested: UnionResolvedType -> { if containsNull(nested) { return true } }
      _ -> { }
    }
  }
  return false
}

// Resolved aliases can retain union members as nested semantic unions.  C++
// variants cannot use those nested carriers without changing visit and
// construction semantics, so canonicalize to one leaf-member list here.
function flattenUnionMembers(types: ResolvedType[]): ResolvedType[] {
  let result: ResolvedType[] = []
  for member of types {
    case member {
      nested: UnionResolvedType -> {
        for nestedMember of flattenUnionMembers(nested.types) { result.push(nestedMember) }
      }
      _ -> { result.push(member) }
    }
  }
  return result
}

function semanticResolvedTypeVariant(currentModulePath: string, nullable: bool): string {
  let result = "std::variant<"
  if nullable { result = result + "std::monostate, " }
  result = result + semanticResolvedTypeAlternatives(currentModulePath)
  return result + ">"
}

function astAliasVariant(alternatives: string, nullable: bool): string {
  let result = "std::variant<"
  if nullable { result = result + "std::monostate, " }
  return result + alternatives + ">"
}

function semanticResolvedTypeAlternatives(currentModulePath: string): string {
  owner := "/selfhost/semantic.do"
  return "std::shared_ptr<" + ownedName("PrimitiveType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("ClassType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("EnumType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("InterfaceType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("FunctionType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("ArrayResolvedType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("MapResolvedType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("StreamResolvedType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("JsonValueResolvedType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("ResultResolvedType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("TupleResolvedType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnionResolvedType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("NullType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("VoidType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnknownType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("TypeParameterType", owner, currentModulePath) + ">"
}

function emitUnionMember(member: ResolvedType, currentModulePath: string = ""): string {
  case member {
    class_: ClassType -> {
      if class_.name == "Expression" { return expressionAlternatives(class_.symbol.module, currentModulePath) }
      if class_.name == "Statement" { return statementAlternatives(class_.symbol.module, currentModulePath) }
      if class_.name == "TypeAnnotation" { return "std::shared_ptr<" + ownedName("NamedType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("ArrayType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnionType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("AstFunctionType", class_.symbol.module, currentModulePath) + ">" }
      return emitType(member, currentModulePath)
    }
    _ -> { return emitType(member, currentModulePath) }
  }
  return "void"
}

function ownedName(name: string, ownerModule: string, currentModulePath: string): string {
  effective := effectiveOwner(name, ownerModule)
  if effective == "" || effective == currentModulePath || currentModulePath == "" { return name }
  return "::" + typeModuleNamespaceFor(effective) + "::" + name
}

function effectiveOwner(name: string, ownerModule: string): string {
  if ownerModule != "" { return ownerModule }
  for astName of ["AstLocation", "SourceSpan", "NamedType", "ArrayType", "UnionType", "AstFunctionType", "FunctionTypeParam", "IntLiteral", "LongLiteral", "FloatLiteral", "DoubleLiteral", "StringLiteral", "CharLiteral", "BoolLiteral", "NullLiteral", "Identifier", "BinaryExpression", "UnaryExpression", "AssignmentExpression", "MemberExpression", "IndexExpression", "CallArgument", "CallExpression", "ArrayLiteral", "ObjectProperty", "ObjectLiteral", "TupleLiteral", "LambdaExpression", "IfExpression", "CaseExpression", "CaseExpressionArm", "ConstructExpression", "DotShorthand", "ThisExpression", "CallerExpression", "Expression", "Parameter", "Block", "ConstDeclaration", "ReadonlyDeclaration", "ImmutableBinding", "LetDeclaration", "FunctionDeclaration", "ReturnStatement", "YieldStatement", "IfStatement", "CaseStatement", "TryStatement", "CaseArm", "TypePattern", "WildcardPattern", "ValuePattern", "IfBranch", "WhileStatement", "ForStatement", "ForOfStatement", "WithBinding", "WithStatement", "BreakStatement", "ContinueStatement", "ExpressionStatement", "DestructuringStatement", "ClassDeclaration", "ClassField", "InterfaceDeclaration", "InterfaceField", "EnumDeclaration", "EnumVariant", "TypeAliasDeclaration", "NamedImport", "NamespaceImport", "ImportDeclaration", "ExportDeclaration", "ExportSpecifier", "ExportList", "Statement", "TypeAnnotation"] {
    if astName == name { return "/selfhost/ast.do" }
  }
  for semanticNameValue of ["SemanticLocation", "SemanticSpan", "Diagnostic", "Symbol", "ImportBinding", "NamespaceBinding", "SourceFile", "PrimitiveType", "ClassType", "EnumType", "InterfaceType", "FunctionType", "FunctionParamType", "ArrayResolvedType", "MapResolvedType", "StreamResolvedType", "JsonValueResolvedType", "ResultResolvedType", "TupleResolvedType", "UnionResolvedType", "NullType", "VoidType", "UnknownType", "Binding", "Scope", "CheckResult", "ResolvedType"] {
    if semanticNameValue == name { return "/selfhost/semantic.do" }
  }
  return ""
}

function semanticName(name: string, currentModulePath: string): string {
  return ownedName(name, "/selfhost/semantic.do", currentModulePath)
}

function typeModuleNamespaceFor(path: string): string {
  return moduleNamespace(path)
}
