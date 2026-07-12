// C++ type lowering for the self-hosted emitter.
//
// This module owns representation choices only.  It deliberately does not
// inspect declarations or expressions; those concerns belong to the other
// emitter modules.

import {
  ArrayResolvedType, ClassType, EnumType, FunctionType, InterfaceType, PrimitiveType, ResolvedType,
  NullType, TupleResolvedType, UnionResolvedType, UnknownType, VoidType,
} from "./semantic"
import type { AstFunctionType, ArrayType, NamedType, TypeAnnotation, UnionType } from "./ast"

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
      return "std::shared_ptr<" + ownedName(class_.name, class_.symbol.module, currentModulePath) + ">"
    }
    enum_: EnumType -> { return ownedName(enum_.name, enum_.symbol.module, currentModulePath) }
    interface_: InterfaceType -> { return ownedName(interface_.name, interface_.symbol.module, currentModulePath) }
    function_: FunctionType -> { return "std::shared_ptr<" + semanticName("FunctionType", currentModulePath) + ">" }
    array: ArrayResolvedType -> {
      return "std::shared_ptr<std::vector<" + emitType(array.elementType, currentModulePath) + ">>"
    }
    tuple: TupleResolvedType -> { return emitTupleType(tuple, currentModulePath) }
    union_: UnionResolvedType -> { return emitUnionType(union_, currentModulePath) }
    _: NullType -> { return "std::monostate" }
    _: VoidType -> { return "void" }
    _: UnknownType -> { panic("Cannot emit unresolved unknown type") }
  }
  return "void"
}

export function emitAnnotation(annotation: TypeAnnotation, currentModulePath: string = ""): string {
  case annotation {
    named: NamedType -> { return emitNamedAnnotation(named, currentModulePath) }
    array: ArrayType -> { return "std::shared_ptr<std::vector<" + emitAnnotation(array.elementType, currentModulePath) + ">>" }
    union_: UnionType -> { return emitUnionAnnotation(union_, currentModulePath) }
    function_: AstFunctionType -> {
      let params = ""
      for i of 0..<function_.params.length {
        if i > 0 { params = params + ", " }
        params = params + emitAnnotation(function_.params[i].type_, currentModulePath)
      }
      return "doof::callback<" + emitAnnotation(function_.returnType, currentModulePath) + "(" + params + ")>"
    }
  }
  return "void"
}

function emitNamedAnnotation(annotation: NamedType, currentModulePath: string = ""): string {
  if annotation.name == "byte" { return "uint8_t" }
  if annotation.name == "int" { return "int32_t" }
  if annotation.name == "long" { return "int64_t" }
  if annotation.name == "float" || annotation.name == "double" || annotation.name == "string" || annotation.name == "char" || annotation.name == "bool" || annotation.name == "void" { return emitPrimitive(annotation.name) }
  if annotation.name == "null" { return "std::monostate" }
  if annotation.name == "ResolvedType" { return resolvedTypeVariant(currentModulePath) }
  if annotation.name == "AstArrayType" { return "std::shared_ptr<" + ownedAnnotationName(annotation, "ArrayType", currentModulePath) + ">" }
  if annotation.name == "AstUnionType" { return "std::shared_ptr<" + ownedAnnotationName(annotation, "UnionType", currentModulePath) + ">" }
  if annotation.name == "AstNamedType" { return "std::shared_ptr<" + ownedAnnotationName(annotation, "NamedType", currentModulePath) + ">" }
  if annotation.name == "SemanticFunctionType" { return "std::shared_ptr<" + ownedAnnotationName(annotation, "FunctionType", currentModulePath) + ">" }
  if annotation.name == "Expression" { return "std::variant<" + expressionAlternatives(annotationModule(annotation), currentModulePath) + ">" }
  if annotation.name == "Statement" { return "std::variant<" + statementAlternatives(annotationModule(annotation), currentModulePath) + ">" }
  if annotation.name == "TypeAnnotation" { return "std::variant<std::shared_ptr<" + ownedAnnotationName(annotation, "NamedType", currentModulePath) + ">, std::shared_ptr<" + ownedAnnotationName(annotation, "ArrayType", currentModulePath) + ">, std::shared_ptr<" + ownedAnnotationName(annotation, "UnionType", currentModulePath) + ">, std::shared_ptr<" + ownedAnnotationName(annotation, "AstFunctionType", currentModulePath) + ">>" }
  return "std::shared_ptr<" + ownedAnnotationName(annotation, annotation.name, currentModulePath) + ">"
}

function emitUnionAnnotation(annotation: UnionType, currentModulePath: string = ""): string {
  let members: string[] = []
  let hasNull = false
  for member of annotation.types {
    case member {
      named: NamedType -> { if named.name == "null" { hasNull = true } else { members.push(emitNamedAnnotation(named, currentModulePath)) } }
      _ -> { members.push(emitAnnotation(member, currentModulePath)) }
    }
  }
  if hasNull && members.length == 1 && members[0] == resolvedTypeVariant(currentModulePath) {
    return "std::variant<std::monostate, " + resolvedTypeAlternatives(currentModulePath) + ">"
  }
  if hasNull && members.length == 1 {
    case annotation.types[0] {
      named: NamedType -> {
        if named.name == "Expression" { return "std::variant<std::monostate, " + expressionAlternatives(annotationModule(named), currentModulePath) + ">" }
        if named.name == "Statement" { return "std::variant<std::monostate, " + statementAlternatives(annotationModule(named), currentModulePath) + ">" }
        if named.name == "TypeAnnotation" { return "std::variant<std::monostate, std::shared_ptr<" + ownedAnnotationName(named, "NamedType", currentModulePath) + ">, std::shared_ptr<" + ownedAnnotationName(named, "ArrayType", currentModulePath) + ">, std::shared_ptr<" + ownedAnnotationName(named, "UnionType", currentModulePath) + ">, std::shared_ptr<" + ownedAnnotationName(named, "AstFunctionType", currentModulePath) + ">>" }
      }
      _ -> { }
    }
    if members[0] == "std::string" || members[0] == "int32_t" || members[0] == "int64_t" || members[0] == "float" || members[0] == "double" || members[0] == "char32_t" || members[0] == "bool" {
      return "std::optional<" + members[0] + ">"
    }
    return members[0]
  }
  let result = "std::variant<"
  if hasNull { result = result + "std::monostate" }
  for member of members {
    if result != "std::variant<" && !result.endsWith("<") { result = result + ", " }
    result = result + member
  }
  return result + ">"
}

function expressionAlternatives(ownerModule: string = "", currentModulePath: string = ""): string {
  return "std::shared_ptr<" + ownedName("IntLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("LongLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("FloatLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("DoubleLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("StringLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CharLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("BoolLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("NullLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("Identifier", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("BinaryExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnaryExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("AssignmentExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("MemberExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("IndexExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CallExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ArrayLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ObjectLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("TupleLiteral", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("LambdaExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("IfExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ConstructExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("DotShorthand", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ThisExpression", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CallerExpression", ownerModule, currentModulePath) + ">"
}

function statementAlternatives(ownerModule: string = "", currentModulePath: string = ""): string {
  return "std::shared_ptr<" + ownedName("ConstDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ReadonlyDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ImmutableBinding", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("LetDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("FunctionDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ClassDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("InterfaceDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("EnumDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("TypeAliasDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ImportDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ExportDeclaration", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ExportList", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("IfStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("CaseStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("WhileStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ForStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ForOfStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("WithStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ReturnStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("YieldStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("BreakStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ContinueStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("ExpressionStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("DestructuringStatement", ownerModule, currentModulePath) + ">, std::shared_ptr<" + ownedName("Block", ownerModule, currentModulePath) + ">"
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

function emitFunctionType(function_: FunctionType): string {
  return "std::shared_ptr<FunctionType>"
}

function resolvedTypeAlternatives(currentModulePath: string = ""): string {
  owner := "/selfhost/semantic.do"
  return "std::shared_ptr<" + ownedName("PrimitiveType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("ClassType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("EnumType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("InterfaceType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("FunctionType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("ArrayResolvedType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("TupleResolvedType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnionResolvedType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("NullType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("VoidType", owner, currentModulePath) + ">, std::shared_ptr<" + ownedName("UnknownType", owner, currentModulePath) + ">"
}

function resolvedTypeVariant(currentModulePath: string = ""): string {
  return "std::variant<" + resolvedTypeAlternatives(currentModulePath) + ">"
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
  let nonNull: ResolvedType[] = []
  let hasNull = false
  for member of union_.types {
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
  return result + ">"
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

function annotationModule(annotation: NamedType): string {
  if annotation.resolvedSymbol != null { return annotation.resolvedSymbol!.module }
  return ""
}

function ownedAnnotationName(annotation: NamedType, name: string, currentModulePath: string): string {
  return ownedName(name, annotationModule(annotation), currentModulePath)
}

function ownedName(name: string, ownerModule: string, currentModulePath: string): string {
  effective := effectiveOwner(name, ownerModule)
  if effective == "" || effective == currentModulePath || currentModulePath == "" { return name }
  return "::" + typeModuleNamespaceFor(effective) + "::" + name
}

function effectiveOwner(name: string, ownerModule: string): string {
  if ownerModule != "" { return ownerModule }
  for astName of ["AstLocation", "SourceSpan", "NamedType", "ArrayType", "UnionType", "AstFunctionType", "FunctionTypeParam", "IntLiteral", "LongLiteral", "FloatLiteral", "DoubleLiteral", "StringLiteral", "CharLiteral", "BoolLiteral", "NullLiteral", "Identifier", "BinaryExpression", "UnaryExpression", "AssignmentExpression", "MemberExpression", "IndexExpression", "CallArgument", "CallExpression", "ArrayLiteral", "ObjectProperty", "ObjectLiteral", "TupleLiteral", "LambdaExpression", "IfExpression", "ConstructExpression", "DotShorthand", "ThisExpression", "CallerExpression", "Expression", "Parameter", "Block", "ConstDeclaration", "ReadonlyDeclaration", "ImmutableBinding", "LetDeclaration", "FunctionDeclaration", "ReturnStatement", "YieldStatement", "IfStatement", "CaseStatement", "CaseArm", "TypePattern", "WildcardPattern", "ValuePattern", "IfBranch", "WhileStatement", "ForStatement", "ForOfStatement", "WithBinding", "WithStatement", "BreakStatement", "ContinueStatement", "ExpressionStatement", "DestructuringStatement", "ClassDeclaration", "ClassField", "InterfaceDeclaration", "InterfaceField", "EnumDeclaration", "EnumVariant", "TypeAliasDeclaration", "NamedImport", "NamespaceImport", "ImportDeclaration", "ExportDeclaration", "ExportSpecifier", "ExportList", "Statement", "TypeAnnotation"] {
    if astName == name { return "/selfhost/ast.do" }
  }
  for semanticNameValue of ["SemanticLocation", "SemanticSpan", "Diagnostic", "Symbol", "ImportBinding", "NamespaceBinding", "SourceFile", "PrimitiveType", "ClassType", "EnumType", "InterfaceType", "FunctionType", "FunctionParamType", "ArrayResolvedType", "TupleResolvedType", "UnionResolvedType", "NullType", "VoidType", "UnknownType", "Binding", "Scope", "CheckResult", "ResolvedType"] {
    if semanticNameValue == name { return "/selfhost/semantic.do" }
  }
  return ""
}

function semanticName(name: string, currentModulePath: string): string {
  return ownedName(name, "/selfhost/semantic.do", currentModulePath)
}

function typeModuleNamespaceFor(path: string): string {
  normalized := path.replaceAll("\\", "/")
  withoutRoot := if normalized.startsWith("/") then normalized.substring(1, 1000000) else normalized
  result := withoutRoot.replaceAll("/", "_").replaceAll(".do", "")
    .replaceAll("-", "_").replaceAll(".", "_")
  return "app_" + (if result == "" then "module" else result) + "_"
}
