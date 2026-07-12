// Expression lowering for the self-hosted C++ emitter.
//
// Every expression is already decorated by the checker.  This module uses
// those decorations for arrays, member access, and contextual C++ spelling;
// it does not perform another type-checking pass.

import {
  ArrayLiteral, AssignmentExpression, BinaryExpression, BoolLiteral, CallExpression, CharLiteral,
  ConstructExpression, DoubleLiteral, Expression, FloatLiteral, FunctionDeclaration, Identifier,
  IfExpression, IndexExpression, IntLiteral, LongLiteral, MemberExpression,
  NullLiteral, ObjectProperty, StringLiteral, ThisExpression, TupleLiteral,
  UnaryExpression,
} from "./ast"
import { ArrayResolvedType, ClassType, EnumType, FunctionParamType, FunctionType, NullType, PrimitiveType, ResolvedType, Symbol, UnionResolvedType, UnknownType } from "./semantic"
import { EmitContext, findClass, findFunction } from "./emitter-context"
import { emitType } from "./emitter-types"

export function emitExpression(expression: Expression, context: EmitContext, expected: ResolvedType | null = null): string {
  let value = ""
  case expression {
    int_: IntLiteral -> { value = string(int_.value) }
    long_: LongLiteral -> { value = string(long_.value) + "LL" }
    float_: FloatLiteral -> { value = string(float_.value) + "f" }
    double_: DoubleLiteral -> { value = string(double_.value) }
    string_: StringLiteral -> { value = emitString(string_, context) }
    char_: CharLiteral -> { value = emitChar(char_.value) }
    bool_: BoolLiteral -> { value = if bool_.value then "true" else "false" }
    null_: NullLiteral -> { value = emitNullLiteral(expected) }
    identifier: Identifier -> { value = emitIdentifier(identifier, context) }
    binary: BinaryExpression -> { value = emitBinary(binary, context) }
    unary: UnaryExpression -> { value = emitUnary(unary, context) }
    assignment: AssignmentExpression -> { value = emitAssignment(assignment, context) }
    member: MemberExpression -> { value = emitMember(member, context) }
    index: IndexExpression -> { value = emitIndex(index, context) }
    call: CallExpression -> { value = emitCall(call, context) }
    array: ArrayLiteral -> { value = emitArray(array, context, expected) }
    tuple: TupleLiteral -> { value = emitTuple(tuple, context) }
    if_: IfExpression -> { value = emitIfExpression(if_, context) }
    construct: ConstructExpression -> { value = emitConstruct(construct, context) }
    _: ThisExpression -> { value = "*this" }
    _ -> { panic("Unsupported expression in initial C++ emitter") }
  }
  sourceType := expression.resolvedType
  if needsNullableVariantPromotion(sourceType, expected) {
    return "doof::optional_value(" + value + ")"
  }
  return value
}

function emitIfExpression(expression: IfExpression, context: EmitContext): string {
  let elseValue = emitExpression(expression.else_, context)
  case expression.else_ {
    member: MemberExpression -> {
      if member.property == "alias" { elseValue = elseValue + ".value()" }
    }
    _ -> { }
  }
  return "(" + emitExpression(expression.condition, context) + " ? " + emitExpression(expression.then_, context) + " : " + elseValue + ")"
}

function emitNullLiteral(expected: ResolvedType | null): string {
  if expected == null { return "nullptr" }
  case expected! {
    class_: ClassType -> {
      if class_.name == "Expression" || class_.name == "Statement" || class_.name == "TypeAnnotation" { return "std::monostate{}" }
      return "nullptr"
    }
    _: NullType -> { return "std::monostate{}" }
    union_: UnionResolvedType -> {
      let nonNull = 0
      for member of union_.types { if member.kind != "null" { nonNull = nonNull + 1 } }
      if nonNull == 1 {
        for member of union_.types {
          case member {
            _: PrimitiveType -> { return "std::nullopt" }
            class_: ClassType -> {
              if class_.name == "Expression" || class_.name == "Statement" || class_.name == "TypeAnnotation" { return "std::monostate{}" }
              return "nullptr"
            }
            _ -> { }
          }
        }
      }
      return "std::monostate{}"
    }
    _ -> { return "nullptr" }
  }
  return "nullptr"
}

function emitChar(value: char): string {
  if value == '\0' { return "U'\\0'" }
  if value == '\\' { return "U'\\\\'" }
  if value == '\'' { return "U'\\''" }
  if value == '\n' { return "U'\\n'" }
  if value == '\r' { return "U'\\r'" }
  if value == '\t' { return "U'\\t'" }
  code := int(value)
  if code <= 65535 {
    return "U'\\u" + hexDigit(code \ 4096) + hexDigit((code \ 256) % 16) + hexDigit((code \ 16) % 16) + hexDigit(code % 16) + "'"
  }
  return "U'\\U" + hexDigit((code \ 268435456) % 16) + hexDigit((code \ 16777216) % 16) + hexDigit((code \ 1048576) % 16) + hexDigit((code \ 65536) % 16) + hexDigit((code \ 4096) % 16) + hexDigit((code \ 256) % 16) + hexDigit((code \ 16) % 16) + hexDigit(code % 16) + "'"
}

function hexDigit(value: int): string {
  digits := "0123456789ABCDEF"
  return digits.substring(value, value + 1)
}

function emitAssignment(expression: AssignmentExpression, context: EmitContext): string {
  operator := if expression.operator == "\\=" then "/=" else expression.operator
  targetType := expression.target.resolvedType
  let value = emitExpression(expression.value, context, targetType)
  valueType := expression.value.resolvedType
  let nullableAstField = false
  case expression.target {
    member: MemberExpression -> { nullableAstField = member.property == "resolvedType" }
    _ -> { }
  }
  if (isNullableVariantType(targetType) || nullableAstField) && expression.value.kind != "null-literal" && !hasNullMember(valueType) {
    value = "doof::optional_value(" + value + ")"
  }
  return "(" + emitExpression(expression.target, context) + " " + operator + " " + value + ")"
}

function emitIdentifier(expression: Identifier, context: EmitContext): string {
  if expression.resolvedBinding != null && expression.resolvedBinding!.kind == "field" {
    return "this->" + cppIdentifier(expression.name)
  }
  for imported of context.imports {
    if imported.localName == expression.name && imported.symbol != null {
      return "::" + exprModuleNamespaceFor(imported.symbol!.module) + "::" + cppIdentifier(emittedSymbolName(imported.symbol!))
    }
  }
  if expression.resolvedBinding != null && expression.resolvedBinding!.symbol != null {
    symbol := expression.resolvedBinding!.symbol!
    if context.modulePath != "" && symbol.module != "" && symbol.module != context.modulePath {
      return "::" + exprModuleNamespaceFor(symbol.module) + "::" + cppIdentifier(emittedSymbolName(symbol))
    }
  }
  if expression.resolvedBinding != null && expression.resolvedBinding!.kind == "import" {
    for imported of context.imports {
      if imported.localName == expression.name && imported.symbol != null {
        return "::" + exprModuleNamespaceFor(imported.symbol!.module) + "::" + cppIdentifier(emittedSymbolName(imported.symbol!))
      }
    }
  }
  return cppIdentifier(expression.name)
}

export function cppIdentifier(name: string): string {
  if name == "operator" { return "operator_" }
  if name == "mutable" { return "mutable_" }
  if name == "class" { return "class_" }
  if name == "struct" { return "struct_" }
  if name == "namespace" { return "namespace_" }
  if name == "template" { return "template_" }
  if name == "typename" { return "typename_" }
  if name == "union" { return "union_" }
  return name
}

function emitUnary(expression: UnaryExpression, context: EmitContext): string {
  operand := emitExpression(expression.operand, context)
  if !expression.prefix && expression.operator == "!" {
    case expression.operand {
      member: MemberExpression -> {
        if member.property == "alias" { return operand + ".value()" }
        if member.property == "resolvedSymbol" { return operand }
        if member.property == "type_" || member.property == "returnType" || member.property == "defaultValue" || member.property == "value" || member.property == "resolvedType" || member.property == "init" || member.property == "condition" || member.property == "else_" || member.property == "source" { return "doof::unwrap_optional(" + operand + ")" }
      }
      _ -> { }
    }
    operandType := decoratedExpressionType(expression.operand)
    if operandType != null {
      case operandType! {
        union_: UnionResolvedType -> {
          if hasSinglePrimitiveMember(union_) { return operand + ".value()" }
          if isNullableVariantType(operandType) { return "doof::unwrap_optional(" + operand + ")" }
        }
        _ -> { }
      }
    }
    return operand
  }
  return binaryOperator(expression.operator) + operand
}

function hasSinglePrimitiveMember(union_: UnionResolvedType): bool {
  let count = 0
  for member of union_.types {
    if member.kind == "null" { continue }
    if member.kind != "primitive" { return false }
    count = count + 1
  }
  return count == 1
}

function emitBinary(expression: BinaryExpression, context: EmitContext): string {
  if expression.operator == "??" {
    left := emitExpression(expression.left, context)
    right := emitExpression(expression.right, context)
    return "(doof::is_null(" + left + ") ? " + right + " : doof::unwrap_optional(" + left + "))"
  }
  if (expression.operator == "==" || expression.operator == "!=") && expression.right.kind == "null-literal" {
    let test = "doof::is_null(" + emitExpression(expression.left, context) + ")"
    return if expression.operator == "==" then test else "(!" + test + ")"
  }
  if (expression.operator == "==" || expression.operator == "!=") && expression.left.kind == "null-literal" {
    let test = "doof::is_null(" + emitExpression(expression.right, context) + ")"
    return if expression.operator == "==" then test else "(!" + test + ")"
  }
  if expression.operator == "**" {
    return "std::pow(" + emitExpression(expression.left, context) + ", " + emitExpression(expression.right, context) + ")"
  }
  operator := if expression.operator == "\\" then "/" else expression.operator
  return "(" + emitExpression(expression.left, context) + " " + operator + " " + emitExpression(expression.right, context) + ")"
}

function binaryOperator(operator: string): string {
  return if operator == "!" then "!" else if operator == "-" then "-" else if operator == "+" then "+" else "~"
}

function emitMember(expression: MemberExpression, context: EmitContext): string {
  object := emitExpression(expression.object, context)
  case expression.object {
    identifier: Identifier -> {
      for namespace of context.namespaceImports {
        if namespace.localName == identifier.name {
          return "::" + exprModuleNamespaceFor(namespace.sourceModule) + "::" + cppIdentifier(expression.property)
        }
      }
    }
    _ -> { }
  }
  case expression.object {
    identifier: Identifier -> {
      if identifier.name == "TokenType" { return object + "::" + cppIdentifier(expression.property) }
    }
    _ -> { }
  }
  if expression.property == "kind" {
    objectType := decoratedExpressionType(expression.object)
    if objectType != null {
      case objectType! {
        class_: ClassType -> {
          if class_.name == "Expression" || class_.name == "Statement" || class_.name == "TypeAnnotation" { return "doof::kind(" + object + ")" }
          return object + "->kind"
        }
        _ -> { return "doof::kind(" + object + ")" }
      }
    }
    return "doof::kind(" + object + ")"
  }
  if expression.property == "resolvedType" {
    objectType := decoratedExpressionType(expression.object)
    if objectType != null {
      case objectType! {
        class_: ClassType -> {
          if class_.name == "Expression" { return "doof::resolved_type(" + object + ")" }
          return object + "->resolvedType"
        }
        _ -> { return "doof::resolved_type(" + object + ")" }
      }
    }
    return "doof::resolved_type(" + object + ")"
  }
  if expression.property == "span" { return "doof::span(" + object + ")" }
  if expression.property == "length" { return "doof::length(" + object + ")" }
  if expression.property == "push" { return object + "->push_back" }
  objectType := decoratedExpressionType(expression.object)
  if objectType != null {
    case objectType! {
      array: ArrayResolvedType -> {
        if expression.property == "length" { return "(" + object + ")->size()" }
      }
      primitive: PrimitiveType -> {
        if primitive.name == "string" && expression.property == "length" { return object + ".size()" }
      }
      _: EnumType -> { return object + "::" + cppIdentifier(expression.property) }
      _ -> { }
    }
  }
  return object + "->" + cppIdentifier(expression.property)
}

function emitIndex(expression: IndexExpression, context: EmitContext): string {
  object := emitExpression(expression.object, context)
  objectType := decoratedExpressionType(expression.object)
  if objectType != null {
    case objectType! {
      _: ArrayResolvedType -> { return "(*" + object + ")[" + emitExpression(expression.index, context) + "]" }
      _ -> { }
    }
  }
  case expression.object {
    member: MemberExpression -> {
      if member.property == "modules" || member.property == "tokens" || member.property == "braceDepth" || member.property == "templateDelimiters" || member.property == "inProgress" || member.property == "params" || member.property == "args" || member.property == "fields" || member.property == "methods" || member.property == "statements" || member.property == "types" || member.property == "elements" || member.property == "parts" || member.property == "interpolations" || member.property == "bindings" || member.property == "update" || member.property == "variants" {
        return "(*" + object + ")[" + emitExpression(expression.index, context) + "]"
      }
    }
    _ -> { }
  }
  return object + "[" + emitExpression(expression.index, context) + "]"
}

function emitCall(expression: CallExpression, context: EmitContext): string {
  case expression.callee {
    member: MemberExpression -> {
      if member.property == "startsWith" {
        let result = "doof::starts_with(" + emitExpression(member.object, context)
        for argument of expression.args { result = result + ", " + emitExpression(argument.value, context) }
        return result + ")"
      }
      if member.property == "endsWith" {
        let result = "doof::ends_with(" + emitExpression(member.object, context)
        for argument of expression.args { result = result + ", " + emitExpression(argument.value, context) }
        return result + ")"
      }
      if member.property == "substring" {
        let result = "doof::substring(" + emitExpression(member.object, context)
        for argument of expression.args { result = result + ", " + emitExpression(argument.value, context) }
        return result + ")"
      }
      if member.property == "replaceAll" {
        let result = "doof::replace_all(" + emitExpression(member.object, context)
        for argument of expression.args { result = result + ", " + emitExpression(argument.value, context) }
        return result + ")"
      }
      if member.property == "contains" {
        let result = "doof::contains(" + emitExpression(member.object, context)
        for argument of expression.args { result = result + ", " + emitExpression(argument.value, context) }
        return result + ")"
      }
      if member.property == "trim" && expression.args.length == 0 { return "doof::trim(" + emitExpression(member.object, context) + ")" }
      if member.property == "repeat" && expression.args.length == 1 { return "doof::repeat(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ")" }
      if member.property == "pop" && expression.args.length == 0 { return "doof::pop(" + emitExpression(member.object, context) + ")" }
    }
    _ -> { }
  }
  let callee = emitExpression(expression.callee, context)
  if expression.callee.kind == "identifier" {
    case expression.callee {
      identifier: Identifier -> { if isBuiltinName(identifier.name) { callee = builtinName(identifier.name) } }
      _ -> { }
    }
  }
  let result = callee + "("
  let functionType: FunctionType | null = null
  let functionDeclaration: FunctionDeclaration | null = null
  if expression.callee.resolvedType != null {
    case expression.callee.resolvedType! {
      resolved: FunctionType -> { functionType = resolved }
      _ -> { }
    }
  }
  if functionType == null {
    case expression.callee {
      identifier: Identifier -> {
        function_ := findFunction(context, identifier.name)
        if function_ != null {
          functionDeclaration = function_
          let params: FunctionParamType[] = []
          for parameter of function_!.params {
            let parameterType = unknownResolvedType()
            if parameter.resolvedType != null { parameterType = parameter.resolvedType! }
            params.push(FunctionParamType { name: parameter.name, type_: parameterType, hasDefault: parameter.defaultValue != null })
          }
          functionType = FunctionType { params, returnType: UnknownType {} }
        }
      }
      _ -> { }
    }
  }
  for i of 0..<expression.args.length {
    if i > 0 { result = result + ", " }
    let expected: ResolvedType | null = null
    if functionType != null && i < functionType!.params.length { expected = functionType!.params[i].type_ }
    let argument = emitExpectedExpression(expression.args[i].value, context, expected)
    if expression.callee.kind == "identifier" && i == 2 {
      case expression.callee {
        identifier: Identifier -> { if identifier.name == "makeLambda" { argument = "doof::with_block(" + argument + ")" } }
        _ -> { }
      }
    }
    result = result + argument
  }
  if functionDeclaration != null {
    for i of expression.args.length..<functionDeclaration!.params.length {
      parameter := functionDeclaration!.params[i]
      if parameter.defaultValue != null {
        if result != callee + "(" { result = result + ", " }
        result = result + emitExpression(parameter.defaultValue!, context, parameter.resolvedType)
      }
    }
  }
  return result + ")"
}

function builtinName(name: string): string {
  if name == "println" { return "doof::println" }
  if name == "panic" { return "doof::panic" }
  if name == "readFile" { return "doof::read_file" }
  if name == "writeFile" { return "doof::write_file" }
  if name == "absolutePath" { return "doof::absolute_path" }
  if name == "string" { return "doof::to_string" }
  if name == "int" { return "static_cast<int32_t>" }
  if name == "long" { return "static_cast<int64_t>" }
  if name == "float" { return "static_cast<float>" }
  if name == "double" { return "static_cast<double>" }
  if name == "char" { return "static_cast<char32_t>" }
  if name == "bool" { return "static_cast<bool>" }
  return name
}

function isBuiltinName(name: string): bool {
  return name == "println" || name == "panic" || name == "string" || name == "int" ||
    name == "long" || name == "float" || name == "double" || name == "char" || name == "bool" ||
    name == "readFile" || name == "writeFile" || name == "absolutePath"
}

function unknownResolvedType(): ResolvedType { return UnknownType {} }

function emitArray(expression: ArrayLiteral, context: EmitContext, expected: ResolvedType | null): string {
  arrayType := preferResolvedType(expression.resolvedType, expected)
  if arrayType != null {
    case arrayType! {
      array: ArrayResolvedType -> {
        elementType := emitType(array.elementType, context.modulePath)
        let values = ""
        for i of 0..<expression.elements.length {
          if i > 0 { values = values + ", " }
          values = values + emitExpression(expression.elements[i], context)
        }
        return "std::make_shared<std::vector<" + elementType + ">>(std::vector<" + elementType + ">{" + values + "})"
      }
      _ -> { }
    }
  }
  if expression.elements.length > 0 {
    elementType := inferredLiteralElementType(expression.elements[0])
    if elementType != "" {
      let values = ""
      for i of 0..<expression.elements.length {
        if i > 0 { values = values + ", " }
        values = values + emitExpression(expression.elements[i], context)
      }
      return "std::make_shared<std::vector<" + elementType + ">>(std::vector<" + elementType + ">{" + values + "})"
    }
  }
  panic("Array literal has no checked array type in " + context.modulePath + "::" + context.currentFunctionName)
  return "nullptr"
}

function inferredLiteralElementType(expression: Expression): string {
  case expression {
    _: StringLiteral -> { return "std::string" }
    _: IntLiteral -> { return "int32_t" }
    _: LongLiteral -> { return "int64_t" }
    _: FloatLiteral -> { return "float" }
    _: DoubleLiteral -> { return "double" }
    _: CharLiteral -> { return "char32_t" }
    _: BoolLiteral -> { return "bool" }
    _ -> { return "" }
  }
  return ""
}

function decoratedExpressionType(expression: Expression): ResolvedType | null {
  case expression {
    identifier: Identifier -> {
      if identifier.resolvedBinding != null { return identifier.resolvedBinding!.type_ }
    }
    _ -> { }
  }
  if expression.resolvedType != null { return expression.resolvedType }
  return null
}

function emitExpectedExpression(expression: Expression, context: EmitContext, expected: ResolvedType | null): string {
  value := emitExpression(expression, context, expected)
  source := expression.resolvedType
  if needsNullableVariantPromotion(source, expected) {
    return "doof::optional_value(" + value + ")"
  }
  return value
}

// Preserve the nullable representation when choosing a contextual type. The
// null-coalescing operator unwraps variant-backed optionals in generated C++;
// both branches here intentionally remain nullable ResolvedType values.
function preferResolvedType(value: ResolvedType | null, fallback: ResolvedType | null): ResolvedType | null {
  if value == null { return fallback }
  return value
}

function needsNullableVariantPromotion(source: ResolvedType | null, expected: ResolvedType | null): bool {
  if expected == null || !isNullableVariantType(expected) || source == null { return false }
  case source! {
    _: NullType -> { return false }
    _ -> { }
  }
  return !hasNullMember(source)
}

function isNullableVariantType(resolvedType: ResolvedType | null): bool {
  if resolvedType == null { return false }
  case resolvedType! {
    union_: UnionResolvedType -> {
      let hasNull = false
      let nonNullCount = 0
      for member of union_.types {
        if member.kind == "null" { hasNull = true }
        else { nonNullCount = nonNullCount + 1 }
      }
      if !hasNull { return false }
      if nonNullCount > 1 { return true }
      for member of union_.types {
        case member {
          class_: ClassType -> { return isAstVariantClass(class_.name) }
          _ -> { }
        }
      }
      return false
    }
    _ -> { return false }
  }
  return false
}

function isAstVariantClass(name: string): bool {
  return name == "Expression" || name == "Statement" || name == "TypeAnnotation"
}

function hasNullMember(resolvedType: ResolvedType | null): bool {
  if resolvedType == null { return false }
  case resolvedType! {
    _: NullType -> { return true }
    union_: UnionResolvedType -> {
      for member of union_.types { if member.kind == "null" { return true } }
    }
    _ -> { }
  }
  return false
}

function emitTuple(expression: TupleLiteral, context: EmitContext): string {
  let values = ""
  for i of 0..<expression.elements.length {
    if i > 0 { values = values + ", " }
    values = values + emitExpression(expression.elements[i], context)
  }
  return "std::make_tuple(" + values + ")"
}

function emitString(expression: StringLiteral, context: EmitContext): string {
  if expression.interpolations.length == 0 { return "std::string(" + quote(expression.parts[0]) + ")" }
  let result = "std::string(" + quote(expression.parts[0]) + ")"
  for i of 0..<expression.interpolations.length {
    result = result + " + doof::to_string(" + emitExpression(expression.interpolations[i], context) + ")"
    partIndex := i * 2 + 2
    if partIndex < expression.parts.length { result = result + " + std::string(" + quote(expression.parts[partIndex]) + ")" }
  }
  return result
}

function quote(value: string): string {
  escaped := value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t")
  return "\"" + escaped + "\""
}

function emitConstruct(expression: ConstructExpression, context: EmitContext): string {
  class_ := findClass(context, expression.type_)
  if class_ == null { panic("Cannot construct unknown class " + expression.type_) }
  let cppName = expression.type_
  for imported of context.imports {
    if imported.localName == expression.type_ && imported.symbol != null {
      cppName = "::" + exprModuleNamespaceFor(imported.symbol!.module) + "::" + emittedSymbolName(imported.symbol!)
    }
  }
  if expression.resolvedType != null {
    case expression.resolvedType! {
      resolved: ClassType -> {
        if context.modulePath != "" && resolved.symbol.module != "" && resolved.symbol.module != context.modulePath {
          cppName = "::" + exprModuleNamespaceFor(resolved.symbol.module) + "::" + emittedSymbolName(resolved.symbol)
        }
      }
      _ -> { }
    }
  }
  let values = ""
  let first = true
  for field of class_!.fields {
    for name of field.names {
      if !first { values = values + ", " }
      first = false
      property := findProperty(expression.args, name)
      let value = ""
      if property != null {
        if property!.value == null {
          value = cppIdentifier(name)
        }
        else {
          value = emitExpectedExpression(property!.value!, context, field.resolvedType)
        }
      } else if field.defaultValue != null {
        value = emitExpression(field.defaultValue!, context, field.resolvedType)
      } else {
        value = "{}"
      }
      if expression.type_ == "FunctionDeclaration" && name == "body" { value = "doof::with_block(" + value + ")" }
      if expression.type_ == "LambdaExpression" && name == "body" && property != null && property!.value != null {
        value = "doof::with_block(" + value + ")"
      }
      if property != null && needsNullableVariantPromotion(property!.resolvedType, field.resolvedType) {
        value = "doof::optional_value(" + value + ")"
      }
      values = values + value
    }
  }
  return "std::make_shared<" + cppName + ">(" + cppName + "{" + values + "})"
}

function findProperty(properties: ObjectProperty[], name: string): ObjectProperty | null {
  for property of properties { if property.name == name { return property } }
  return null
}

function exprModuleNamespaceFor(path: string): string {
  normalized := path.replaceAll("\\", "/")
  withoutRoot := if normalized.startsWith("/") then normalized.substring(1, 1000000) else normalized
  result := withoutRoot.replaceAll("/", "_").replaceAll(".do", "")
    .replaceAll("-", "_").replaceAll(".", "_")
  return "app_" + (if result == "" then "module" else result) + "_"
}

function emittedSymbolName(symbol: Symbol): string {
  return if symbol.originalName == "" then symbol.name else symbol.originalName
}
