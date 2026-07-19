// Call, native-constructor, and class-construction lowering.

import { CallArgument, CallExpression, ClassDeclaration, ConstructExpression, Expression, FunctionDeclaration, Identifier, MemberExpression, ObjectProperty, SourceSpan, ThisExpression } from "./ast"
import { ActorType, ArrayResolvedType, ClassType, EnumType, FunctionType, InterfaceType, MapResolvedType, ResultResolvedType, ResolvedType, SetResolvedType, StreamResolvedType, Symbol } from "./semantic"
import { EmitContext, SourceLocationSpanOverride } from "./emitter-context"
import { substituteTypeParams } from "./checker-types"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { decoratedExpressionType, emittedSymbolName, emitExpectedExpression, emitNullableVariantPromotion, exprModuleNamespaceFor, findProperty, needsNullableVariantPromotion, optionalExpectedType } from "./emitter-expr-utils"
import { emitContextType, emitType } from "./emitter-types"
import { specializeEmitType } from "./emitter-types"
import { classInstantiationKey, functionInstantiationKey, methodInstantiationKey } from "./emitter-monomorphize"
import { emitSyncActorCall } from "./emitter-expr-actor"

export function emitCall(expression: CallExpression, context: EmitContext, expected: ResolvedType | null = null): string {
  case expression.callee {
    identifier: Identifier -> {
      if identifier.name == "catchPanic" && expression.args.length == 1 {
        case expression.resolvedType! {
          result: ResultResolvedType -> {
            callback := emitExpression(expression.args[0].value, context)
            successType := emitType(result.valueType, context.modulePath)
            if result.valueType.kind == "void" {
              return "[&]() -> doof::Result<void, std::string> { try { " + callback + ".call(); return doof::Success<void>{}; } catch (const doof::Panic& _panic) { return doof::Failure<std::string>{_panic.message()}; } }()"
            }
            return "[&]() -> doof::Result<" + successType + ", std::string> { try { return doof::Success<" + successType + ">{" + callback + ".call()}; } catch (const doof::Panic& _panic) { return doof::Failure<std::string>{_panic.message()}; } }()"
          }
          _ -> { panic("catchPanic has no Result type") }
        }
      }
    }
    _ -> { }
  }
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
  case expression.callee {
    member: MemberExpression -> {
      if member.object.resolvedType != null {
        case member.object.resolvedType! {
          actor: ActorType -> { return emitSyncActorCall(expression, member, actor, context) }
          resultType: ResultResolvedType -> {
            if member.property == "isSuccess" { return "doof::is_success(" + emitExpression(member.object, context) + ")" }
            if member.property == "isFailure" { return "doof::is_failure(" + emitExpression(member.object, context) + ")" }
            if member.property == "unwrapOr" && expression.args.length == 1 {
              temporaryName := "_result_unwrap_" + string(context.tryCounter)
              context.tryCounter += 1
              object := emitExpression(member.object, context)
              fallback := emitExpression(expression.args[0].value, context, resultType.valueType)
              return "[&]() -> " + emitType(resultType.valueType, context.modulePath) + " { auto " + temporaryName + " = " + object + "; if (doof::is_failure(" + temporaryName + ")) return " + fallback + "; return std::move(doof::success_value(" + temporaryName + ")); }()"
            }
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
  if nativeConstructorCall && expression.resolvedConstructor != null && expression.callee.resolvedType != null {
    case expression.callee.resolvedType! {
      owner: ClassType -> {
        return emitConstructorFactoryCall(owner, expression.resolvedConstructor!, expression.args, context, expression.span)
      }
      _ -> { }
    }
  }
  if nativeConstructorCall && isClassCallee(expression.callee) && expression.resolvedType != null {
    case expression.resolvedType! {
      class_: ClassType -> {
        if class_.symbol.native_ {
          nativeName := "::" + (if class_.symbol.nativeCppName == "" then class_.symbol.name else class_.symbol.nativeCppName)
          if expression.resolvedConstructor == null { return "std::make_shared<" + nativeName + ">()" }
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
              result = result + emitDefaultExpression(constructorMethod!.params[i].defaultValue!, context, constructorMethod!.params[i].resolvedType, expression.span)
            }
          }
          return result + ")"
        }
        if expression.resolvedConstructor != null || isClassCallee(expression.callee) {
        let cppName = if class_.symbol.module != "" && class_.symbol.module != context.modulePath then "::" + exprModuleNamespaceFor(class_.symbol.module) + "::" + emittedSymbolName(class_.symbol) else emittedSymbolName(class_.symbol)
        concrete := concreteClassName(class_, context)
        if concrete != "" { cppName = concrete }
        let values = ""
        for i of 0..<expression.args.length {
          if i > 0 { values = values + ", " }
          values = values + emitExpression(expression.args[i].value, context)
        }
        if expression.resolvedClass != null {
          let fieldIndex = 0
          for field of expression.resolvedClass!.fields {
            if field.static_ || field.const_ { continue }
            for name of field.names {
              if fieldIndex >= expression.args.length {
                if values != "" { values = values + ", " }
                if field.defaultValue == null { panic("Construction of '" + class_.name + "' is missing required field '" + name + "'") }
                values = values + emitDefaultExpression(field.defaultValue!, context, field.resolvedType, expression.span)
              }
              fieldIndex = fieldIndex + 1
            }
          }
        }
        return if class_.symbol.kind == "struct" then cppName + "{" + values + "}" else "std::make_shared<" + cppName + ">(" + values + ")"
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
          _: InterfaceType -> {
            if member.property == "fromJsonValue" { return emitInterfaceJsonCall(member, expression, context) }
            return emitInterfaceCall(member, expression, context)
          }
          _: StreamResolvedType -> { return emitInterfaceCall(member, expression, context) }
          _: ArrayResolvedType -> {
            if member.property == "buildReadonly" { return "doof::array_buildReadonly(" + emitExpression(member.object, context) + ", \"\", 0)" }
            if member.property == "cloneMutable" { return "doof::array_cloneMutable(" + emitExpression(member.object, context) + ", \"\", 0)" }
            if member.property == "contains" { return "doof::array_contains(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", \"\", 0)" }
            if member.property == "indexOf" { return "doof::array_indexOf(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", \"\", 0)" }
            if member.property == "some" { return "doof::array_some(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", \"\", 0)" }
            if member.property == "every" { return "doof::array_every(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", \"\", 0)" }
            if member.property == "filter" { return "doof::array_filter(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", \"\", 0)" }
            if member.property == "map" { return "doof::array_map(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", \"\", 0)" }
          }
          map: MapResolvedType -> {
            if member.property == "has" { return "(" + emitExpression(member.object, context) + "->find(" + emitExpression(expression.args[0].value, context) + ") != " + emitExpression(member.object, context) + "->end())" }
            if member.property == "set" { return "doof::map_set(" + emitExpression(member.object, context) + ", " + emitExpectedExpression(expression.args[0].value, context, map.keyType) + ", " + emitExpectedExpression(expression.args[1].value, context, map.valueType) + ", \"\", 0)" }
            if member.property == "get" && expression.args.length > 0 { return "doof::map_get(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", \"\", 0)" }
            if member.property == "keys" { return "doof::map_keys(" + emitExpression(member.object, context) + ", \"\", 0)" }
            if member.property == "values" { return "doof::map_values(" + emitExpression(member.object, context) + ", \"\", 0)" }
            if member.property == "buildReadonly" { return "doof::map_buildReadonly(" + emitExpression(member.object, context) + ", \"\", 0)" }
            if member.property == "cloneMutable" { return "doof::map_cloneMutable(" + emitExpression(member.object, context) + ", \"\", 0)" }
          }
          _: SetResolvedType -> {
            if member.property == "has" { return "(" + emitExpression(member.object, context) + "->count(" + emitExpression(expression.args[0].value, context) + ") > 0)" }
            if member.property == "add" { return emitExpression(member.object, context) + "->insert(" + emitExpression(expression.args[0].value, context) + ")" }
            if member.property == "delete" { return emitExpression(member.object, context) + "->erase(" + emitExpression(expression.args[0].value, context) + ")" }
            if member.property == "values" { return "doof::set_values(" + emitExpression(member.object, context) + ", \"\", 0)" }
            if member.property == "buildReadonly" { return "doof::set_buildReadonly(" + emitExpression(member.object, context) + ", \"\", 0)" }
            if member.property == "cloneMutable" { return "doof::set_cloneMutable(" + emitExpression(member.object, context) + ", \"\", 0)" }
          }
          enum_: EnumType -> {
            if member.property == "fromName" || member.property == "fromValue" {
              args := if expression.args.length == 0 then "" else emitExpression(expression.args[0].value, context)
              return emitContextType(enum_, context) + "_" + member.property + "(" + args + ")"
            }
          }
          _ -> { }
        }
      }
      if !nominalReceiver && member.property == "startsWith" { return emitBuiltinCall("doof::string_startsWith", member.object, expression, context) }
      if !nominalReceiver && member.property == "endsWith" { return emitBuiltinCall("doof::string_endsWith", member.object, expression, context) }
      if !nominalReceiver && member.property == "substring" { return emitBuiltinCall("doof::string_substring", member.object, expression, context) }
      if !nominalReceiver && member.property == "replaceAll" { return emitBuiltinCall("doof::string_replaceAll", member.object, expression, context) }
      if !nominalReceiver && member.property == "contains" { return emitBuiltinCall("doof::string_contains", member.object, expression, context) }
      if !nominalReceiver && member.property == "indexOf" { return emitBuiltinCall("doof::string_indexOf", member.object, expression, context) }
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
      if !nominalReceiver && member.property == "trim" && expression.args.length == 0 { return "doof::string_trim(" + emitExpression(member.object, context) + ")" }
      if !nominalReceiver && member.property == "repeat" && expression.args.length == 1 { return "doof::string_repeat(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ")" }
      if !nominalReceiver && member.property == "slice" { return "doof::string_slice(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ")" }
      if !nominalReceiver && member.property == "charAt" { return "doof::string_at(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", \"\", 0)" }
      if !nominalReceiver && member.property == "padStart" {
        fill := if expression.args.length > 1 then emitExpression(expression.args[1].value, context) else "' '"
        return "doof::string_padStart(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ", " + fill + ")"
      }
      if !nominalReceiver && member.property == "trimEnd" && expression.args.length == 0 { return "doof::string_trimEnd(" + emitExpression(member.object, context) + ")" }
      if !nominalReceiver && member.property == "trimEnd" && expression.args.length == 1 { return "doof::string_trimEnd(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ")" }
      if !nominalReceiver && member.property == "toLowerCase" { return "doof::string_toLowerCase(" + emitExpression(member.object, context) + ")" }
      if !nominalReceiver && member.property == "toUpperCase" { return "doof::string_toUpperCase(" + emitExpression(member.object, context) + ")" }
      if !nominalReceiver && member.property == "split" { return "doof::string_split(" + emitExpression(member.object, context) + ", " + emitExpression(expression.args[0].value, context) + ")" }
      if !nominalReceiver && member.property == "pop" && expression.args.length == 0 { return "doof::array_pop(" + emitExpression(member.object, context) + ")" }
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
        identifier: Identifier -> {
          if member.property == "parse" && isNumericTypeNamespace(identifier.name) {
            return "doof::parse_" + identifier.name + "(" + emitExpression(expression.args[0].value, context) + ")"
          }
        }
        _ -> { }
      }
      if member.property == "fromJsonValue" && (!nominalReceiver || member.resolvedStaticOwner != null) {
        object := emitExpression(member.object, context)
        let args = ""
        for i of 0..<expression.args.length {
          if i > 0 { args = args + ", " }
          args = args + emitExpression(expression.args[i].value, context)
        }
        objectType := decoratedExpressionType(member.object)
        if objectType != null {
          case objectType! {
            _: InterfaceType -> { return object + "_fromJsonValue(" + args + ")" }
            _ -> { }
          }
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
  let concreteGenericArgs: ResolvedType[] = []
  for argument of expression.resolvedGenericTypeArgs { concreteGenericArgs.push(specializeEmitType(argument, context)) }
  if functionType != null && concreteGenericArgs.length > 0 {
    substituted := substituteTypeParams(functionType!, functionType!.typeParams, concreteGenericArgs)
    case substituted {
      specialized: FunctionType -> { functionType = specialized }
      _ -> { }
    }
  }
  functionDeclaration := expression.resolvedFunction
  let usesConcreteInstantiation = false
  if functionDeclaration != null && (functionDeclaration!.typeParams.length > 0 || functionDeclaration!.native_) {
    let targetModule = context.modulePath
    let concreteMethodName = ""
    case expression.callee {
      identifier: Identifier -> {
        if identifier.resolvedBinding != null {
          if identifier.resolvedBinding!.symbol != null { targetModule = identifier.resolvedBinding!.symbol!.module }
          else if identifier.resolvedBinding!.module != "" { targetModule = identifier.resolvedBinding!.module }
        }
      }
      member: MemberExpression -> {
        if member.object.resolvedType != null {
          case specializeEmitType(member.object.resolvedType!, context) {
            class_: ClassType -> {
              targetModule = class_.symbol.module
              ownerKey := classInstantiationKey(class_.symbol.module, class_.name, class_.typeArgs)
              methodKey := methodInstantiationKey(ownerKey, functionDeclaration!.name, concreteGenericArgs)
              concreteMethodName = concreteMethodNameFor(context, methodKey)
            }
            _ -> { }
          }
        }
      }
      _ -> { }
    }
    if concreteMethodName != "" {
      usesConcreteInstantiation = true
      case expression.callee {
        member: MemberExpression -> { callee = callee.substring(0, callee.length - member.property.length) + concreteMethodName }
        _ -> { }
      }
    } else {
      key := functionInstantiationKey(targetModule, functionDeclaration!.name, concreteGenericArgs)
      concreteName := concreteFunctionName(context, key)
      if concreteName != "" {
        usesConcreteInstantiation = true
        callee = if targetModule != "" && targetModule != context.modulePath then "::" + exprModuleNamespaceFor(targetModule) + "::" + concreteName else concreteName
      }
    }
  }
  if concreteGenericArgs.length > 0 && functionDeclaration != null && functionDeclaration!.typeParams.length > 0 && !usesConcreteInstantiation {
    callee = callee + "<"
    for i of 0..<concreteGenericArgs.length {
      if i > 0 { callee = callee + ", " }
      callee = callee + emitContextType(concreteGenericArgs[i], context)
    }
    callee = callee + ">"
  }
  let invokesCallback = false
  case expression.callee {
    identifier: Identifier -> { invokesCallback = !isBuiltinName(identifier.name) && functionType != null && functionDeclaration == null }
    member: MemberExpression -> { invokesCallback = member.resolvedCallableField && functionType != null }
    _ -> { invokesCallback = functionType != null && functionDeclaration == null }
  }
  callPrefix := if invokesCallback then callee + ".call(" else callee + "("
  let result = callPrefix
  let named = false
  for argument of expression.args { if argument.name != null { named = true } }
  if named && functionDeclaration != null {
    for i of 0..<functionDeclaration!.params.length {
      parameter := functionDeclaration!.params[i]
      argument := callArgumentNamed(expression, parameter.name)
      let expected: ResolvedType | null = parameter.resolvedType
      if functionType != null && i < functionType!.params.length { expected = optionalExpectedType(functionType!.params[i].type_) }
      if argument != null || parameter.defaultValue != null {
        if result != callPrefix { result = result + ", " }
        if argument != null { result = result + emitExpectedExpression(argument!.value, context, expected) }
        else { result = result + emitDefaultExpression(parameter.defaultValue!, context, expected, expression.span) }
      }
    }
  } else if named && functionType != null {
    // Callback-valued callees do not retain a declaration pointer. Their
    // function type still defines the named-argument order required by the
    // generated positional callback ABI.
    for parameter of functionType!.params {
      argument := callArgumentNamed(expression, parameter.name)
      if argument != null {
        if result != callPrefix { result = result + ", " }
        result = result + emitExpectedExpression(argument!.value, context, optionalExpectedType(parameter.type_))
      }
    }
  } else {
    for i of 0..<expression.args.length {
      if i > 0 { result = result + ", " }
      let expected: ResolvedType | null = null
      if functionType != null && i < functionType!.params.length { expected = optionalExpectedType(functionType!.params[i].type_) }
      if expected == null && functionDeclaration != null && i < functionDeclaration!.params.length { expected = functionDeclaration!.params[i].resolvedType }
      case expression.callee {
        identifier: Identifier -> { if identifier.name == "println" || isBuiltinConversionName(identifier.name) { expected = null } }
        _ -> { }
      }
      let argument = emitExpectedExpression(expression.args[i].value, context, expected)
      result = result + argument
    }
    if functionDeclaration != null {
      for i of expression.args.length..<functionDeclaration!.params.length {
        parameter := functionDeclaration!.params[i]
        if parameter.defaultValue != null {
          if result != callPrefix { result = result + ", " }
          result = result + emitDefaultExpression(parameter.defaultValue!, context, parameter.resolvedType, expression.span)
        }
      }
    }
  }
  return result + ")"
}

function isNumericTypeNamespace(name: string): bool {
  return name == "byte" || name == "int" || name == "long" || name == "float" || name == "double"
}

function isBuiltinConversionName(name: string): bool {
  return name == "string" || name == "byte" || name == "int" || name == "long" || name == "float" || name == "double" || name == "char" || name == "bool"
}

function isClassCallee(callee: Expression): bool {
  case callee {
    identifier: Identifier -> {
      if identifier.resolvedBinding == null { return false }
      binding := identifier.resolvedBinding!
      if binding.kind == "class" || binding.kind == "struct" { return true }
      // Method bindings retain their owner symbol for cross-module naming.  An
      // owner class does not make the method identifier a class constructor.
      if binding.kind == "import" && binding.symbol != null {
        return binding.symbol!.kind == "class" || binding.symbol!.kind == "struct"
      }
      return false
    }
    _ -> { return false }
  }
}

function callArgumentNamed(expression: CallExpression, name: string): CallArgument | null {
  for argument of expression.args { if argument.name == name { return argument } }
  return null
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

function emitInterfaceJsonCall(member: MemberExpression, call: CallExpression, context: EmitContext): string {
  let args = ""
  for i of 0..<call.args.length {
    if i > 0 { args = args + ", " }
    args = args + emitExpression(call.args[i].value, context)
  }
  return emitExpression(member.object, context) + "_fromJsonValue(" + args + ")"
}

function builtinName(name: string): string {
  if name == "println" { return "doof::println" }
  if name == "panic" { return "doof::panic" }
  if name == "assert" { return "doof::assert_" }
  if name == "string" { return "doof::to_string" }
  if name == "byte" { return "static_cast<uint8_t>" }
  if name == "int" { return "static_cast<int32_t>" }
  if name == "long" { return "static_cast<int64_t>" }
  if name == "float" { return "static_cast<float>" }
  if name == "double" { return "static_cast<double>" }
  if name == "char" { return "static_cast<char32_t>" }
  if name == "bool" { return "static_cast<bool>" }
  return name
}

function isBuiltinName(name: string): bool {
  return name == "println" || name == "panic" || name == "assert" || name == "catchPanic" || name == "string" || name == "byte" || name == "int" || name == "long" || name == "float" || name == "double" || name == "char" || name == "bool"
}

function declaredConstructor(class_: ClassDeclaration): FunctionDeclaration | null {
  for method of class_.methods { if method.name == "constructor" { return method } }
  return null
}

function insideDeclaredConstructor(class_: ClassDeclaration, context: EmitContext): bool {
  return context.currentClass == class_.name && context.currentFunctionName == "constructor"
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
  constructedType := expression.resolvedConstructedType
  if constructedType == null { panic("Construction of '" + expression.type_ + "' has no resolved constructed type") }
  let owner: ClassType | null = null
  case constructedType! {
    class_: ClassType -> { owner = class_ }
    _ -> { panic("Construction of '" + expression.type_ + "' has a non-class constructed type") }
  }
  constructorMethod := declaredConstructor(class_!)
  insideConstructor := insideDeclaredConstructor(class_!, context)
  if constructorMethod != null && !insideConstructor && expression.resolvedConstructor == null {
    panic("Construction of '" + expression.type_ + "' has no resolved constructor")
  }
  if expression.resolvedConstructor != null {
    if constructorMethod == null { panic("Construction of '" + expression.type_ + "' has unexpected constructor metadata") }
    return emitNamedConstructorFactoryCall(owner!, expression.resolvedConstructor!, expression, context)
  }
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
        concrete := concreteClassName(resolved, context)
        if concrete != "" { cppName = concrete }
      }
      _ -> { }
    }
  }
  let values = ""
  let first = true
  for field of class_!.fields {
    if field.static_ || field.const_ { continue }
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
      } else if field.defaultValue != null { value = emitDefaultExpression(field.defaultValue!, context, field.resolvedType, expression.span) }
      else { panic("Construction of '" + expression.type_ + "' is missing required field '" + name + "'") }
      if expression.type_ == "FunctionDeclaration" && name == "body" {
        value = "doof::variant_promote<" + emitContextType(field.resolvedType!, context) + ">(" + value + ")"
      }
      if expression.type_ == "LambdaExpression" && name == "body" && property != null {
        value = "doof::variant_promote<" + emitContextType(field.resolvedType!, context) + ">(" + value + ")"
      }
      if expression.type_ == "AsyncExpression" && name == "expression" && property != null {
        value = "doof::variant_promote<" + emitContextType(field.resolvedType!, context) + ">(" + value + ")"
      }
      // Shorthand fields have no expression node, so they cannot pass their
      // expected type through emitExpression's central promotion path.
      if property != null && property!.value == null && needsNullableVariantPromotion(property!.resolvedType, field.resolvedType) { value = emitNullableVariantPromotion(value, property!.resolvedType, field.resolvedType, context.modulePath) }
      values = values + value
    }
  }
  if native { return "std::make_shared<" + cppName + ">(" + values + ")" }
  if structValue { return cppName + "{" + values + "}" }
  return "std::make_shared<" + cppName + ">(" + values + ")"
}

function emitConstructorFactoryCall(owner: ClassType, constructorMethod: FunctionDeclaration, args: CallArgument[], context: EmitContext, callSiteSpan: SourceSpan): string {
  let cppName = if owner.symbol.native_ then "::" + (if owner.symbol.nativeCppName == "" then owner.symbol.name else owner.symbol.nativeCppName) else if owner.symbol.module != "" && owner.symbol.module != context.modulePath then "::" + exprModuleNamespaceFor(owner.symbol.module) + "::" + emittedSymbolName(owner.symbol) else emittedSymbolName(owner.symbol)
  concrete := concreteClassName(owner, context)
  if concrete != "" { cppName = concrete }
  let result = cppName + "::constructor("
  for i of 0..<args.length {
    if i > 0 { result = result + ", " }
    let expectedType: ResolvedType | null = null
    if i < constructorMethod.params.length { expectedType = constructorMethod.params[i].resolvedType }
    result = result + emitExpression(args[i].value, context, expectedType)
  }
  for i of args.length..<constructorMethod.params.length {
    if i > 0 { result = result + ", " }
    if constructorMethod.params[i].defaultValue == null { panic("Constructor " + owner.name + " is missing argument " + constructorMethod.params[i].name) }
    result = result + emitDefaultExpression(constructorMethod.params[i].defaultValue!, context, constructorMethod.params[i].resolvedType, callSiteSpan)
  }
  return result + ")"
}

function emitNamedConstructorFactoryCall(owner: ClassType, constructorMethod: FunctionDeclaration, expression: ConstructExpression, context: EmitContext): string {
  let cppName = if owner.symbol.native_ then "::" + (if owner.symbol.nativeCppName == "" then owner.symbol.name else owner.symbol.nativeCppName) else if owner.symbol.module != "" && owner.symbol.module != context.modulePath then "::" + exprModuleNamespaceFor(owner.symbol.module) + "::" + emittedSymbolName(owner.symbol) else emittedSymbolName(owner.symbol)
  concrete := concreteClassName(owner, context)
  if concrete != "" { cppName = concrete }
  let result = cppName + "::constructor("
  for i of 0..<constructorMethod.params.length {
    if i > 0 { result = result + ", " }
    parameter := constructorMethod.params[i]
    property := findProperty(expression.args, parameter.name)
    if property != null {
      if property!.value == null { result = result + cppIdentifier(property!.name) }
      else { result = result + emitExpression(property!.value!, context, parameter.resolvedType) }
    } else if parameter.defaultValue != null {
      result = result + emitDefaultExpression(parameter.defaultValue!, context, parameter.resolvedType, expression.span)
    } else { panic("Constructor " + owner.name + " is missing argument " + parameter.name) }
  }
  return result + ")"
}

function emitDefaultExpression(expression: Expression, context: EmitContext, expected: ResolvedType | null, callSiteSpan: SourceSpan): string {
  previous := context.sourceLocationSpanOverride
  context.sourceLocationSpanOverride = SourceLocationSpanOverride { span: callSiteSpan }
  result := emitExpression(expression, context, expected)
  context.sourceLocationSpanOverride = previous
  return result
}

function concreteFunctionName(context: EmitContext, key: string): string {
  for i of 0..<context.concreteFunctionKeys.length {
    if context.concreteFunctionKeys[i] == key { return context.concreteFunctionNames[i] }
  }
  return ""
}

function concreteMethodNameFor(context: EmitContext, key: string): string {
  for i of 0..<context.concreteMethodKeys.length {
    if context.concreteMethodKeys[i] == key { return context.concreteMethodNames[i] }
  }
  return ""
}

function concreteClassName(class_: ClassType, context: EmitContext): string {
  let typeArgs: ResolvedType[] = []
  for argument of class_.typeArgs { typeArgs.push(specializeEmitType(argument, context)) }
  if typeArgs.length == 0 { return "" }
  boundaryKey := class_.symbol.module + "::" + class_.name
  for existing of context.nativeTemplateClassKeys {
    if existing == boundaryKey {
      let name = emittedSymbolName(class_.symbol)
      if class_.symbol.module != "" && class_.symbol.module != context.modulePath { name = "::" + exprModuleNamespaceFor(class_.symbol.module) + "::" + name }
      name = name + "<"
      for i of 0..<typeArgs.length {
        if i > 0 { name = name + ", " }
        name = name + emitContextType(typeArgs[i], context)
      }
      return name + ">"
    }
  }
  key := classInstantiationKey(class_.symbol.module, class_.name, typeArgs)
  for i of 0..<context.concreteClassKeys.length {
    if context.concreteClassKeys[i] == key {
      name := context.concreteClassNames[i]
      if class_.symbol.module != "" && class_.symbol.module != context.modulePath { return "::" + exprModuleNamespaceFor(class_.symbol.module) + "::" + name }
      return name
    }
  }
  return ""
}
