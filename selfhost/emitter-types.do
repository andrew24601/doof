// C++ type lowering for the self-hosted emitter.
//
// This module owns representation choices only.  It deliberately does not
// inspect declarations or expressions; those concerns belong to the other
// emitter modules.

import {
  ActorType, ArrayResolvedType, ClassType, EnumType, FunctionParamType, FunctionType, InterfaceType, JsonValueResolvedType, MapResolvedType, PrimitiveType, PromiseType, RangeResolvedType, ResolvedType, ResultResolvedType, SetResolvedType, StreamResolvedType, Symbol,
  NullType, TupleResolvedType, UnionResolvedType, UnknownType, TypeParameterType, VoidType, WeakResolvedType,
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
    set_: SetResolvedType -> { return SetResolvedType { elementType: lowerRegisteredTypes(set_.elementType, context), readonly_: set_.readonly_ } }
    stream: StreamResolvedType -> { return StreamResolvedType { elementType: lowerRegisteredTypes(stream.elementType, context) } }
    result_: ResultResolvedType -> { return ResultResolvedType { valueType: lowerRegisteredTypes(result_.valueType, context), errorType: lowerRegisteredTypes(result_.errorType, context) } }
    weak_: WeakResolvedType -> { return WeakResolvedType { inner: lowerRegisteredTypes(weak_.inner, context) } }
    actor: ActorType -> {
      lowered := lowerRegisteredTypes(actor.innerClass, context)
      case lowered {
        class_: ClassType -> { return ActorType { innerClass: class_ } }
        _ -> { return actor }
      }
    }
    promise: PromiseType -> { return PromiseType { valueType: lowerRegisteredTypes(promise.valueType, context) } }
    tuple: TupleResolvedType -> {
      let elements: ResolvedType[] = []
      for element of tuple.elements { elements.push(lowerRegisteredTypes(element, context)) }
      return TupleResolvedType { elements }
    }
    union_: UnionResolvedType -> {
      let members: ResolvedType[] = []
      for member of union_.types { members.push(lowerRegisteredTypes(member, context)) }
      return UnionResolvedType { types: members }
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
      if class_.name == "TypeAnnotation" { return "std::variant<std::shared_ptr<" + ownedName("NamedType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("ArrayType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnionType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("AstFunctionType", class_.symbol.module, currentModulePath) + ">, std::shared_ptr<" + ownedName("WeakType", class_.symbol.module, currentModulePath) + ">>" }
      if class_.name == "AstNamedType" { return "std::shared_ptr<" + ownedName("NamedType", class_.symbol.module, currentModulePath) + ">" }
      if class_.name == "AstArrayType" { return "std::shared_ptr<" + ownedName("ArrayType", class_.symbol.module, currentModulePath) + ">" }
      if class_.name == "AstUnionType" { return "std::shared_ptr<" + ownedName("UnionType", class_.symbol.module, currentModulePath) + ">" }
      if class_.name == "SemanticFunctionType" { return "std::shared_ptr<" + ownedName("FunctionType", class_.symbol.module, currentModulePath) + ">" }
      if class_.symbol.kind == "struct" { return emitClassInnerType(class_, currentModulePath) }
      return "std::shared_ptr<" + emitClassInnerType(class_, currentModulePath) + ">"
    }
    enum_: EnumType -> {
      if enum_.name == "ParseError" && enum_.symbol.module == "<builtin>" { return "doof::ParseError" }
      return ownedName(enum_.name, enum_.symbol.module, currentModulePath)
    }
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
    set_: SetResolvedType -> {
      return "std::shared_ptr<doof::ordered_set<" + emitType(set_.elementType, currentModulePath) + ">>"
    }
    stream: StreamResolvedType -> { return concreteName("Stream", [stream.elementType]) }
    _: RangeResolvedType -> { return "doof::Range" }
    _: JsonValueResolvedType -> { return "doof::JsonValue" }
    result: ResultResolvedType -> { return "doof::Result<" + emitType(result.valueType, currentModulePath) + ", " + emitType(result.errorType, currentModulePath) + ">" }
    actor: ActorType -> { return "std::shared_ptr<doof::Actor<" + emitClassInnerType(actor.innerClass, currentModulePath) + ">>" }
    promise: PromiseType -> { return "doof::Promise<" + emitType(promise.valueType, currentModulePath) + ">" }
    tuple: TupleResolvedType -> { return emitTupleType(tuple, currentModulePath) }
    union_: UnionResolvedType -> { return emitUnionType(union_, currentModulePath) }
    weak_: WeakResolvedType -> {
      case weak_.inner {
        class_: ClassType -> { return "std::weak_ptr<" + emitClassInnerType(class_, currentModulePath) + ">" }
        _ -> { return "std::weak_ptr<" + emitType(weak_.inner, currentModulePath) + ">" }
      }
    }
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

function expressionAlternatives(ownerModule: string, currentModulePath: string): string {
  return "std::shared_ptr<" + ownedName("IntLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("LongLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("FloatLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("DoubleLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("StringLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CharLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("BoolLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("NullLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("Identifier", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("BinaryExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnaryExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("AssignmentExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("MemberExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("IndexExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CallExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ArrayLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ObjectLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("TupleLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("LambdaExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("IfExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CaseExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ConstructExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("DotShorthand", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ThisExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CallerExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("AsExpression", ownerModule, currentModulePath) + ">"
}

function statementAlternatives(ownerModule: string, currentModulePath: string): string {
  return "std::shared_ptr<" + ownedName("ConstDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ReadonlyDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ImmutableBinding", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("LetDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("FunctionDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ClassDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("InterfaceDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("EnumDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("TypeAliasDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ImportDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("MockImportDirective", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ExportDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ExportList", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("IfStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CaseStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("WhileStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ForStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ForOfStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("WithStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ReturnStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("YieldStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("BreakStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ContinueStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ExpressionStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("DestructuringStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("TryStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("Block", ownerModule, currentModulePath) + ">"
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
  if hasNull && nonNull.length == 1 && usesNaturalNullableMember(nonNull[0]) {
    case nonNull[0] {
      class_: ClassType -> {
        if class_.symbol.kind == "struct" { return "std::optional<" + emitType(nonNull[0], currentModulePath) + ">" }
        return emitType(nonNull[0], currentModulePath)
      }
      _: ArrayResolvedType -> { return emitType(nonNull[0], currentModulePath) }
      _: MapResolvedType -> { return emitType(nonNull[0], currentModulePath) }
      _: SetResolvedType -> { return emitType(nonNull[0], currentModulePath) }
      _: WeakResolvedType -> { return emitType(nonNull[0], currentModulePath) }
      _: PrimitiveType -> { return "std::optional<" + emitType(nonNull[0], currentModulePath) + ">" }
      _ -> { }
    }
  }

  let result = "std::variant<"
  let hasMember = false
  if hasNull { result = result + "std::monostate"; hasMember = true }
  for member of nonNull {
    memberText := emitType(member, currentModulePath)
    if hasMember { result = result + ", " }
    result = result + memberText
    hasMember = true
  }
  if !hasMember {
    panic("Cannot emit empty resolved union in " + currentModulePath)
  }
  return result + ">"
}

/** Whether a checked type is represented by std::variant in generated C++. */
export function usesVariantRepresentation(type_: ResolvedType): bool {
  case type_ {
    _: InterfaceType -> { return true }
    union_: UnionResolvedType -> { return !usesNaturalNullableUnion(union_) }
    _ -> { return false }
  }
  return false
}

/** Whether a union uses a natural nullable/optional carrier instead of variant. */
export function usesNullableSingleValueRepresentation(type_: ResolvedType): bool {
  return naturalNullableUnionMember(type_) != null
}

function usesNaturalNullableUnion(union_: UnionResolvedType): bool {
  return naturalNullableUnionMember(union_) != null
}

/** Returns the sole non-null member when a union uses a natural nullable carrier. */
export function naturalNullableUnionMember(type_: ResolvedType): ResolvedType | null {
  case type_ {
    union_: UnionResolvedType -> {
      flattened := flattenUnionMembers(union_.types)
      let nonNull: ResolvedType[] = []
      let hasNull = false
      for member of flattened {
        if member.kind == "null" { hasNull = true }
        else { nonNull.push(member) }
      }
      if hasNull && nonNull.length == 1 && usesNaturalNullableMember(nonNull[0]) { return nonNull[0] }
    }
    _ -> { return null }
  }
  return null
}

function usesNaturalNullableMember(member: ResolvedType): bool {
  case member {
    _: ClassType -> { return true }
    _: ArrayResolvedType -> { return true }
    _: MapResolvedType -> { return true }
    _: SetResolvedType -> { return true }
    _: WeakResolvedType -> { return true }
    _: PrimitiveType -> { return true }
    _ -> { return false }
  }
  return false
}

// Keep lowering defensive against nested compound types even though the
// checker normally flattens unions as it constructs them.
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

function ownedName(name: string, ownerModule: string, currentModulePath: string): string {
  if ownerModule == "" || ownerModule == currentModulePath || currentModulePath == "" { return name }
  return "::" + typeModuleNamespaceFor(ownerModule) + "::" + name
}

function typeModuleNamespaceFor(path: string): string {
  return moduleNamespace(path)
}
