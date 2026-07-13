// Call, native-constructor, and class-construction lowering.

import { CallExpression, ConstructExpression, Expression, Identifier, MemberExpression, ObjectProperty, ThisExpression } from "./ast"
import { ArrayResolvedType, ClassType, FunctionType, InterfaceType, MapResolvedType, ResultResolvedType, ResolvedType, Symbol } from "./semantic"
import { EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { decoratedExpressionType, emittedSymbolName, emitExpectedExpression, exprModuleNamespaceFor, findProperty, needsNullableVariantPromotion, optionalExpectedType } from "./emitter-expr-utils"
import { emitType } from "./emitter-types"

export function emitCall(expression: CallExpression, context: EmitContext, expected: ResolvedType | null = null): string {
  case expression.callee {
    identifier: Identifier -> {
      if identifier.name == "Success" || identifier.name == "Failure" {
        let resultType: ResolvedType | null = null
        if expected != null { resultType = expected! }
        else if expression.resolvedType != null { resultType = expression.resolvedType! }
        if resultType == null { panic(identifier.name + " has no expected Result type") }
        case resultType! {
          result: ResultResolvedType -> {
            if expression.args.length == 0 { return "doof::" + identifier.name + "<" + emitType(if identifier.name == "Success" then result.valueType else result.errorType, context.modulePath) + ">{}" }
            valueType := if identifier.name == "Success" then result.valueType else result.errorType
            value := emitExpression(expression.args[0].value, context, valueType)
            return "doof::" + identifier.name + "<" + emitType(valueType, context.modulePath) + ">{ " + value + " }"
          }
          _ -> { }
        }
      }
    }
    _ -> { }
  }
  let nativeConstructorCall = false
  case expression.callee {
    _: Identifier -> { nativeConstructorCall = true }
    _ -> { }
  }
  if nativeConstructorCall && expression.resolvedType != null {
    case expression.resolvedType! {
      class_: ClassType -> {
        if class_.symbol.native_ {
          nativeName := "::" + (if class_.symbol.nativeCppName == "" then class_.symbol.name else class_.symbol.nativeCppName)
          let result = nativeName + "::constructor("
          constructorMethod := expression.resolvedConstructor
          for i of 0..<expression.args.length {
            if i > 0 { result = result + ", " }
            let expectedArgument: ResolvedType | null = null
            if constructorMethod != null && i < constructorMethod!.params.length { expectedArgument = constructorMethod!.params[i].resolvedType }
            let argumentText = emitExpression(expression.args[i].value, context, expectedArgument)
            result = result + argumentText
          }
          if constructorMethod != null {
            for i of expression.args.length..<constructorMethod!.params.length {
              if result != nativeName + "::constructor(" { result = result + ", " }
              if constructorMethod!.params[i].defaultValue == null { panic("Native constructor " + class_.name + " is missing a default argument") }
              result = result + emitExpression(constructorMethod!.params[i].defaultValue!, context, constructorMethod!.params[i].resolvedType)
            }
          }
          return result + ")"
        }
      }
      _ -> { }
    }
  }
  case expression.callee {
    member: MemberExpression -> {
      arrayObjectType := decoratedExpressionType(member.object)
      let nominalReceiver = false
      if arrayObjectType != null {
        case arrayObjectType! {
          _: ClassType -> { nominalReceiver = true }
          _ -> { }
        }
      }
      if member.property == "length" {
        if arrayObjectType != null {
          case arrayObjectType! {
            class_: ClassType -> { return emitExpression(member.object, context) + (if class_.symbol.kind == "struct" then "." else "->") + "length()" }
            _ -> { }
          }
        }
      }
      if arrayObjectType != null {
        case arrayObjectType! {
          _: InterfaceType -> { return emitInterfaceCall(member, expression, context) }
          _: ArrayResolvedType -> {
            if member.property == "buildReadonly" { return "doof::array_buildReadonly(" + emitExpression(member.object, context) + ", \"\", 0)" }
          }
          _: MapResolvedType -> {
            if member.property == "has" { return "(" + emitExpression(member.object, context) + "->find(" + emitExpression(expression.args[0].value, context) + ") != " + emitExpression(member.object, context) + "->end())" }
            if member.property == "set" { return "doof::map_set(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", " + emitExpression(expression.args[1].value, context) + ", \"\", 0)" }
            if member.property == "get" && expression.args.length > 0 { return "doof::map_get(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", \"\", 0)" }
          }
          _ -> { }
        }
      }
      if !nominalReceiver && member.property == "startsWith" { return emitBuiltinCall("doof::starts_with", member.object, expression, context) }
      if !nominalReceiver && member.property == "endsWith" { return emitBuiltinCall("doof::ends_with", member.object, expression, context) }
      if !nominalReceiver && member.property == "substring" { return emitBuiltinCall("doof::substring", member.object, expression, context) }
      if !nominalReceiver && member.property == "replaceAll" { return emitBuiltinCall("doof::replace_all", member.object, expression, context) }
      if !nominalReceiver && member.property == "contains" { return emitBuiltinCall("doof::contains", member.object, expression, context) }
      objectType := decoratedExpressionType(member.object)
      if objectType != null {
        case objectType! {
          _: ArrayResolvedType -> {
            if member.property == "slice" && expression.args.length == 2 {
              return "doof::array_slice(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", " + emitExpression(expression.args[1].value, context) + ", \"\", 0)"
            }
          }
          _ -> { }
        }
      }
      if !nominalReceiver && member.property == "trim" && expression.args.length == 0 { return "doof::trim(" + emitExpression(member.object, context) + ")" }
      if !nominalReceiver && member.property == "repeat" && expression.args.length == 1 { return "doof::repeat(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ")" }
      if !nominalReceiver && member.property == "slice" { return "doof::string_slice(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ")" }
      if !nominalReceiver && member.property == "charAt" { return "doof::string_at(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", \"\", 0)" }
      if !nominalReceiver && member.property == "padStart" {
        fill := if expression.args.length > 1 then emitExpression(expression.args[1].value, context) else "' '"
        return "doof::string_padStart(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", " + fill + ")"
      }
      if !nominalReceiver && member.property == "trimEnd" && expression.args.length == 0 { return "doof::string_trimEnd(" + emitExpression(member.object, context) + ")" }
      if !nominalReceiver && member.property == "trimEnd" && expression.args.length == 1 { return "doof::string_trimEnd(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ")" }
      if !nominalReceiver && member.property == "split" { return "doof::string_split(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ")" }
      if !nominalReceiver && member.property == "pop" && expression.args.length == 0 { return "doof::pop(" + emitExpression(member.object, context) + ")" }
      if member.property == "toJsonObject" && expression.args.length == 0 {
        object := emitExpression(member.object, context)
        objectType := decoratedExpressionType(member.object)
        if objectType != null {
          case objectType! {
            class_: ClassType -> { if class_.symbol.kind == "struct" { return object + ".toJsonObject()" } }
            _ -> { }
          }
        }
        return object + "->toJsonObject()"
      }
      case member.object {
        identifier: Identifier -> { if identifier.name == "int" && member.property == "parse" { return "doof::parse_int(" + emitExpression(expression.args[0].value, context) + ")" } }
        _ -> { }
      }
      if member.property == "fromJsonValue" && (!nominalReceiver || member.resolvedStaticOwner != null) {
        object := emitExpression(member.object, context)
        let args = ""
        for i of 0..<expression.args.length {
          if i > 0 { args = args + ", " }
          args = args + emitExpression(expression.args[i].value, context)
        }
        return object + "::fromJsonValue(" + args + ")"
      }
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
  let functionType: FunctionType | null = null
  if expression.callee.resolvedType != null {
    case expression.callee.resolvedType! {
      resolved: FunctionType -> { functionType = resolved }
      _ -> { }
    }
  }
  functionDeclaration := expression.resolvedFunction
  let isIdentifierCallback = false
  case expression.callee {
    identifier: Identifier -> { isIdentifierCallback = !isBuiltinName(identifier.name) }
    _ -> { }
  }
  invokesCallback := isIdentifierCallback && functionType != null && functionDeclaration == null
  callPrefix := if invokesCallback then callee + ".call(" else callee + "("
  let result = callPrefix
  for i of 0..<expression.args.length {
    if i > 0 { result = result + ", " }
    let expected: ResolvedType | null = null
    if functionType != null && i < functionType!.params.length { expected = optionalExpectedType(functionType!.params[i].type_) }
    if expected == null && functionDeclaration != null && i < functionDeclaration!.params.length { expected = functionDeclaration!.params[i].resolvedType }
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
        if result != callPrefix { result = result + ", " }
        result = result + emitExpression(parameter.defaultValue!, context, parameter.resolvedType)
      }
    }
  }
  return result + ")"
}

function emitBuiltinCall(name: string, object: Expression, expression: CallExpression, context: EmitContext): string {
  let result = name + "(" + emitExpression(object, context)
  for argument of expression.args { result = result + ", " + emitExpression(argument.value, context) }
  return result + ")"
}

function emitInterfaceCall(member: MemberExpression, call: CallExpression, context: EmitContext): string {
  object := emitExpression(member.object, context)
  let args = ""
  for i of 0..<call.args.length {
    if i > 0 { args = args + ", " }
    args = args + emitExpression(call.args[i].value, context)
  }
  return "std::visit([&](auto&& _obj) { return _obj->" + cppIdentifier(member.property) + "(" + args + "); }, " + object + ")"
}

function builtinName(name: string): string {
  if name == "println" { return "doof::println" }
  if name == "panic" { return "doof::panic" }
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
  return name == "println" || name == "panic" || name == "string" || name == "int" || name == "long" || name == "float" || name == "double" || name == "char" || name == "bool" || name == "readFile" || name == "writeFile" || name == "absolutePath"
}

export function emitConstruct(expression: ConstructExpression, context: EmitContext): string {
  if expression.type_ == "Success" || expression.type_ == "Failure" {
    resultType := expression.resolvedType
    if resultType == null { panic(expression.type_ + " has no resolved Result type") }
    case resultType! {
      result: ResultResolvedType -> {
        valueType := if expression.type_ == "Success" then result.valueType else result.errorType
        propertyName := if expression.type_ == "Success" then "value" else "error"
        property := findProperty(expression.args, propertyName)
        if property == null || property!.value == null { return "doof::" + expression.type_ + "<" + emitType(valueType, context.modulePath) + ">{ }" }
        value := emitExpectedExpression(property!.value!, context, valueType)
        return "doof::" + expression.type_ + "<" + emitType(valueType, context.modulePath) + ">{ " + value + " }"
      }
      _ -> { }
    }
    panic(expression.type_ + " does not construct a Result")
  }
  class_ := expression.resolvedClass
  if class_ == null { panic("Cannot construct unresolved class " + expression.type_) }
  let cppName = expression.type_
  let native = class_!.native_
  let structValue = false
  if native { cppName = "::" + (if class_!.nativeCppName == "" then class_!.name else class_!.nativeCppName) }
  if expression.resolvedType != null {
    case expression.resolvedType! {
      resolved: ClassType -> {
        structValue = resolved.symbol.kind == "struct"
        if resolved.symbol.native_ { cppName = "::" + (if resolved.symbol.nativeCppName == "" then resolved.symbol.name else resolved.symbol.nativeCppName) }
        else if context.modulePath != "" && resolved.symbol.module != "" && resolved.symbol.module != context.modulePath { cppName = "::" + exprModuleNamespaceFor(resolved.symbol.module) + "::" + emittedSymbolName(resolved.symbol) }
      }
      _ -> { }
    }
  }
  let values = ""
  let first = true
  for field of class_!.fields {
    if field.static_ { continue }
    for name of field.names {
      if !first { values = values + ", " }
      first = false
      property := findProperty(expression.args, name)
      let value = ""
      if property != null {
        if property!.value == null { value = cppIdentifier(name) }
        else {
          case property!.value! {
            _: ThisExpression -> {
              case field.resolvedType! {
                class_: ClassType -> { value = "std::shared_ptr<" + class_.name + ">(this, [](" + class_.name + "*) {})" }
                _ -> { value = emitExpectedExpression(property!.value!, context, field.resolvedType) }
              }
            }
            _ -> { value = emitExpectedExpression(property!.value!, context, field.resolvedType) }
          }
        }
      } else if field.defaultValue != null { value = emitExpression(field.defaultValue!, context, field.resolvedType) }
      else { value = "{}" }
      if expression.type_ == "FunctionDeclaration" && name == "body" { value = "doof::with_block(" + value + ")" }
      if expression.type_ == "LambdaExpression" && name == "body" && property != null { value = "doof::with_block(" + value + ")" }
      if property != null && needsNullableVariantPromotion(property!.resolvedType, field.resolvedType) { value = "doof::optional_value(" + value + ")" }
      values = values + value
    }
  }
  if native { return "std::make_shared<" + cppName + ">(" + values + ")" }
  if structValue { return cppName + "{" + values + "}" }
  return "std::make_shared<" + cppName + ">(" + cppName + "{" + values + "})"
}
