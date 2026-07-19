// Type annotation, member, index, and callable-field resolution.

import {
  ActorType, ArrayResolvedType, Binding, CheckResult, ClassMetadataResolvedType, ClassType, EnumType, InterfaceType,
  Diagnostic, FunctionParamType, FunctionType,
  JsonValueResolvedType, MapResolvedType, MethodReflectionResolvedType, NullType, PrimitiveType, PromiseType, RangeResolvedType, ResolvedType, ResultResolvedType, Scope, SemanticLocation, SemanticSpan, SetResolvedType, Symbol,
  StreamResolvedType, TupleResolvedType, UnionResolvedType, UnknownType, TypeParameterType, VoidType, WeakResolvedType, ResolvedTypeConstraint,
} from "./semantic"
import { AnalysisResult, ModuleInfo } from "./analyzer"
import {
  ArrayLiteral, ArrayType, AsExpression, AssignmentExpression, AstLocation, BinaryExpression, Block,
  BoolLiteral, CallExpression, CallerExpression, CharLiteral, ClassDeclaration, ClassField, ConstructExpression,
  ConstDeclaration, ContinueStatement, DestructuringStatement, DoubleLiteral,
  DotShorthand, EnumDeclaration, ExportDeclaration, ExportList, Expression, ExpressionStatement,
  FloatLiteral, ForOfStatement, ForStatement, FunctionDeclaration, AstFunctionType,
  IfExpression, IfStatement, ImmutableBinding, Identifier, ImportDeclaration,
  IndexExpression, IntLiteral, InterfaceDeclaration, LetDeclaration,
  LambdaExpression, LongLiteral, MemberExpression, NamedType, NullLiteral,
  NamedImport, NamespaceImport, ObjectLiteral, ObjectProperty, Program,
  ReadonlyDeclaration, ReturnStatement, SourceSpan, Statement, StringLiteral,
  ThisExpression, TupleLiteral, TypeAliasDeclaration, TypeAnnotation,
  UnaryExpression, UnionType, WhileStatement, WithBinding, WithStatement, BreakStatement,
  YieldStatement, CaseArm, CaseExpression, CasePattern, CaseStatement, TypePattern, ValuePattern, WildcardPattern,
  TryStatement,
  AsyncExpression, RetireExpression, ActorCreationExpression, Parameter, WeakType, TypeParameterConstraint,
} from "./ast"
import {
  actorType, applyDeepReadonly, arrayType, classMetadataType, classType, enumType, functionType, interfaceType, isAssignable, isNumeric, joinTypes,
  isJsonValueType, isSupportedHashCollectionType, jsonObjectType, jsonValueType, mapType, resultType, setType, streamType,
  nullType, numericResult, primitive, promiseType, rangeType, sameType, tupleType, typeName, unionType,
  methodReflectionType, substituteTypeParams, typeParameter, unknownType, voidType, weakType,
} from "./checker-types"
import { canGenerateJsonDeserialization, canGenerateJsonSerialization, interfaceJsonDiscriminator, isGeneratedJsonType } from "./json-semantics"
import { findActorBoundaryViolation } from "./checker-actor-boundary"
import { collectRetiredActorBindings, reportRetiredActorUses } from "./checker-actor-lifecycle"


import { CheckerState } from "./checker-state"
import { typeError } from "./checker-common"
import { builtinSourceLocationType, optionalResolvedType, methodSignature, hasTypeParam, typeParamConstraintName, typeParamConstraint, symbolFor, declarationFor } from "./checker-symbols"
import { registerConcreteInterfaceImplementations, concreteTypes, classModuleFor } from "./checker-interfaces"

export function resolveType(state: CheckerState, annotation: TypeAnnotation, module: ModuleInfo, scope: Scope): ResolvedType {
  case annotation {
    named: NamedType -> {
      if named.name == "void" { return decorateType(state, annotation, voidType()) }
      if named.name == "null" { return decorateType(state, annotation, nullType()) }
      if named.name == "JsonValue" { return decorateType(state, annotation, jsonValueType()) }
      if named.name == "JsonObject" { return decorateType(state, annotation, jsonObjectType()) }
      if named.name == "SourceLocation" { return decorateType(state, annotation, builtinSourceLocationType()) }
      if named.name == "Range" { return decorateType(state, annotation, rangeType()) }
      if hasTypeParam(scope, named.name) { return decorateType(state, annotation, typeParameter(named.name, typeParamConstraintName(scope, named.name), typeParamConstraint(scope, named.name))) }
      if named.name == "Tuple" {
        let elements: ResolvedType[] = []
        for argument of named.typeArgs { elements.push(resolveType(state, argument, module, scope)) }
        return decorateType(state, annotation, tupleType(elements))
      }
      if named.name == "Map" || named.name == "ReadonlyMap" {
        if named.typeArgs.length != 2 { typeError(state, named.name + " requires two type arguments", named.span); return decorateType(state, annotation, unknownType()) }
        key := resolveType(state, named.typeArgs[0], module, scope)
        value := resolveType(state, named.typeArgs[1], module, scope)
        return decorateType(state, annotation, mapType(key, value, named.name == "ReadonlyMap"))
      }
      if named.name == "Set" || named.name == "ReadonlySet" {
        if named.typeArgs.length != 1 { typeError(state, named.name + " requires one type argument", named.span); return decorateType(state, annotation, unknownType()) }
        element := resolveType(state, named.typeArgs[0], module, scope)
        if !isSupportedHashCollectionType(element) {
          typeError(state, "Set element type \"" + typeName(element) + "\" is not supported; set elements must be byte, string, int, long, char, bool, or enum", named.typeArgs[0].span)
        }
        return decorateType(state, annotation, setType(element, named.name == "ReadonlySet"))
      }
      if named.name == "Stream" {
        if named.typeArgs.length != 1 { typeError(state, "Stream requires one type argument", named.span); return decorateType(state, annotation, unknownType()) }
        return decorateType(state, annotation, streamType(resolveType(state, named.typeArgs[0], module, scope)))
      }
      if named.name == "Actor" {
        if named.typeArgs.length != 1 { typeError(state, "Actor requires one type argument", named.span); return decorateType(state, annotation, unknownType()) }
        inner := resolveType(state, named.typeArgs[0], module, scope)
        case inner {
          class_: ClassType -> { return decorateType(state, annotation, actorType(class_)) }
          _ -> { typeError(state, "Actor requires a class type", named.span); return decorateType(state, annotation, unknownType()) }
        }
      }
      if named.name == "Promise" {
        if named.typeArgs.length != 1 { typeError(state, "Promise requires one type argument", named.span); return decorateType(state, annotation, unknownType()) }
        return decorateType(state, annotation, promiseType(resolveType(state, named.typeArgs[0], module, scope)))
      }
      if named.name == "Result" {
        if named.typeArgs.length != 2 { typeError(state, "Result requires two type arguments", named.span); return decorateType(state, annotation, unknownType()) }
        return decorateType(state, annotation, resultType(resolveType(state, named.typeArgs[0], module, scope), resolveType(state, named.typeArgs[1], module, scope)))
      }
      if named.name == "Success" || named.name == "Failure" {
        if named.typeArgs.length != 1 { typeError(state, named.name + " requires one type argument", named.span); return decorateType(state, annotation, unknownType()) }
        payload := resolveType(state, named.typeArgs[0], module, scope)
        if named.name == "Success" { return decorateType(state, annotation, resultType(payload, unknownType())) }
        return decorateType(state, annotation, resultType(unknownType(), payload))
      }
      if named.name == "byte" || named.name == "int" || named.name == "long" || named.name == "float" || named.name == "double" || named.name == "string" || named.name == "char" || named.name == "bool" {
        return decorateType(state, annotation, primitive(named.name))
      }
      let symbol: Symbol | null = named.resolvedSymbol
      if symbol == null { symbol = symbolFor(module, named.name) }
      if symbol == null { return decorateType(state, annotation, unknownType()) }
      if symbol!.kind == "type-alias" {
        declaration := declarationFor(state.result, symbol!)
        if declaration == null { return decorateType(state, annotation, unknownType()) }
        case declaration! {
          alias: TypeAliasDeclaration -> {
            if named.typeArgs.length != alias.typeParams.length {
              typeError(state, alias.name + " requires " + string(alias.typeParams.length) + " type argument" + (if alias.typeParams.length == 1 then "" else "s"), named.span)
              return decorateType(state, annotation, unknownType())
            }
            aliasScope := Scope { parent: scope }
            for typeParam of alias.typeParams { aliasScope.typeParams.push(typeParam) }
            let resolvedAlias = resolveType(state, alias.type_, classModuleFor(state.result, symbol!), aliasScope)
            let typeArgs: ResolvedType[] = []
            for argument of named.typeArgs { typeArgs.push(resolveType(state, argument, module, scope)) }
            validateTypeArgumentConstraints(state, alias.typeParams, alias.typeParamConstraints, typeArgs, named.span, classModuleFor(state.result, symbol!), scope)
            resolvedAlias = substituteTypeParams(resolvedAlias, alias.typeParams, typeArgs)
            return decorateType(state, annotation, resolvedAlias)
          }
          _ -> { return decorateType(state, annotation, unknownType()) }
        }
      }
      if symbol!.kind == "interface" {
        let typeArgs: ResolvedType[] = []
        for argument of named.typeArgs { typeArgs.push(resolveType(state, argument, module, scope)) }
        declaration := declarationFor(state.result, symbol!)
        if declaration != null {
          case declaration! {
            interfaceDeclaration: InterfaceDeclaration -> {
              validateTypeArgumentConstraints(state, interfaceDeclaration.typeParams, interfaceDeclaration.typeParamConstraints, typeArgs, named.span, classModuleFor(state.result, symbol!), scope)
            }
            _ -> { }
          }
        }
        concreteInterface := interfaceType(named.name, symbol!, typeArgs)
        if concreteTypes(typeArgs) { registerConcreteInterfaceImplementations(state.result, concreteInterface) }
        return decorateType(state, annotation, concreteInterface)
      }
      if symbol!.kind == "enum" { return decorateType(state, annotation, enumType(named.name, symbol!)) }
      let typeArgs: ResolvedType[] = []
      for argument of named.typeArgs { typeArgs.push(resolveType(state, argument, module, scope)) }
      declaration := declarationFor(state.result, symbol!)
      if declaration != null {
        case declaration! {
          classDeclaration: ClassDeclaration -> {
            validateTypeArgumentConstraints(state, classDeclaration.typeParams, classDeclaration.typeParamConstraints, typeArgs, named.span, classModuleFor(state.result, symbol!), scope)
          }
          _ -> { }
        }
      }
      return decorateType(state, annotation, classType(named.name, symbol!, typeArgs))
    }
    array: ArrayType -> { return decorateType(state, annotation, arrayType(resolveType(state, array.elementType, module, scope), array.readonly_)) }
    union: UnionType -> {
      let members: ResolvedType[] = []
      for item of union.types { members.push(resolveType(state, item, module, scope)) }
      return decorateType(state, annotation, unionType(members))
    }
    function_: AstFunctionType -> {
      let params: FunctionParamType[] = []
      for parameter of function_.params { params.push(FunctionParamType { name: parameter.name, type_: resolveType(state, parameter.type_, module, scope), hasDefault: false }) }
      return decorateType(state, annotation, functionType(params, resolveType(state, function_.returnType, module, scope)))
    }
    weak_: WeakType -> { return decorateType(state, annotation, weakType(resolveType(state, weak_.type_, module, scope))) }
  }
  return decorateType(state, annotation, unknownType())
}

/** Validates concrete arguments against substituted declaration constraints. */
export function validateTypeArgumentConstraints(state: CheckerState, names: string[], constraints: TypeParameterConstraint[], arguments: ResolvedType[], span: SourceSpan, module: ModuleInfo, outer: Scope): void {
  if names.length != arguments.length { return }
  constraintScope := Scope { parent: outer }
  for name of names {
    constraintScope.typeParams.push(name)
    constraintScope.typeParamConstraintNames.push("")
    constraintScope.typeParamConstraints.push(ResolvedTypeConstraint {})
  }
  for index of 0..<names.length {
    if index >= constraints.length || constraints[index].type_ == null { continue }
    case arguments[index] {
      parameter: TypeParameterType -> { if parameter.constraint == null && parameter.constraintName == "" { continue } }
      _ -> { }
    }
    annotation := constraints[index].type_!
    case annotation {
      named: NamedType -> {
        if named.typeArgs.length == 0 && named.name == "Reflectable" {
          case arguments[index] {
            _: ClassType -> { memberType(state, arguments[index], "metadata", span) }
            _ -> { reportConstraintViolation(state, names[index], arguments[index], "Reflectable", span) }
          }
          continue
        }
        if named.typeArgs.length == 0 && named.name == "JsonSerializable" {
          result := memberType(state, arguments[index], "fromJsonValue", span)
          if result.kind == "unknown" { reportConstraintViolation(state, names[index], arguments[index], "JsonSerializable", span) }
          continue
        }
      }
      _ -> { }
    }
    resolvedConstraint := resolveType(state, annotation, module, constraintScope)
    substitutedConstraint := substituteTypeParams(resolvedConstraint, names, arguments)
    if !isAssignable(arguments[index], substitutedConstraint) {
      reportConstraintViolation(state, names[index], arguments[index], typeName(substitutedConstraint), span)
    }
  }
}

function reportConstraintViolation(state: CheckerState, typeParam: string, argument: ResolvedType, constraint: string, span: SourceSpan): void {
  typeError(state, "Type \"" + typeName(argument) + "\" does not satisfy constraint \"" + constraint + "\" for type parameter \"" + typeParam + "\"", span)
}

export function decorateType(state: CheckerState, annotation: TypeAnnotation, resolvedType: ResolvedType): ResolvedType {
  annotation.resolvedType = optionalResolvedType(resolvedType)
  return resolvedType
}

export function memberType(state: CheckerState, object: ResolvedType, property: string, span: SourceSpan): ResolvedType {
  if typeName(object) == "string" {
    if property == "length" { return primitive("int") }
    if property == "startsWith" || property == "endsWith" || property == "contains" { return functionType([FunctionParamType { name: "value", type_: primitive("string"), hasDefault: false }], primitive("bool")) }
    if property == "indexOf" { return functionType([FunctionParamType { name: "value", type_: primitive("string"), hasDefault: false }], primitive("int")) }
    if property == "substring" { return functionType([FunctionParamType { name: "start", type_: primitive("int"), hasDefault: false }, FunctionParamType { name: "end", type_: primitive("int"), hasDefault: true }], primitive("string")) }
    if property == "replaceAll" { return functionType([FunctionParamType { name: "oldValue", type_: primitive("string"), hasDefault: false }, FunctionParamType { name: "newValue", type_: primitive("string"), hasDefault: false }], primitive("string")) }
    if property == "trim" { return functionType([], primitive("string")) }
    if property == "trimEnd" { return functionType([FunctionParamType { name: "suffix", type_: primitive("char"), hasDefault: true }], primitive("string")) }
    if property == "toLowerCase" || property == "toUpperCase" { return functionType([], primitive("string")) }
    if property == "repeat" { return functionType([FunctionParamType { name: "count", type_: primitive("int"), hasDefault: false }], primitive("string")) }
    if property == "slice" { return functionType([FunctionParamType { name: "start", type_: primitive("int"), hasDefault: false }], primitive("string")) }
    if property == "charAt" { return functionType([FunctionParamType { name: "index", type_: primitive("int"), hasDefault: false }], primitive("char")) }
    if property == "padStart" { return functionType([FunctionParamType { name: "length", type_: primitive("int"), hasDefault: false }, FunctionParamType { name: "fill", type_: primitive("char"), hasDefault: true }], primitive("string")) }
    if property == "split" { return functionType([FunctionParamType { name: "separator", type_: primitive("string"), hasDefault: false }], arrayType(primitive("string"))) }
  }
  case object {
    function_: FunctionType -> {
      if property == "call" { return function_ }
      if property == "post" { return functionType(function_.params, promiseType(function_.returnType)) }
      if property == "dispatch" {
        if function_.returnType.kind != "void" { typeError(state, "Method \"dispatch\" is only available on void-returning callbacks", span); return unknownType() }
        return functionType(function_.params, voidType())
      }
      return unknownType()
    }
    union: UnionResolvedType -> {
      let resolved: ResolvedType | null = null
      for member of union.types {
        memberValue := memberType(state, member, property, span)
        if memberValue.kind == "unknown" { continue }
        resolved = if resolved == null then memberValue else joinTypes(resolved!, memberValue)
      }
      if resolved != null { return resolved! }
      return unknownType()
    }
    array: ArrayResolvedType -> {
      if property == "length" { return primitive("int") }
      if property == "push" { return functionType([FunctionParamType { name: "value", type_: array.elementType, hasDefault: false }], voidType()) }
      if property == "contains" { return functionType([FunctionParamType { name: "value", type_: array.elementType, hasDefault: false }], primitive("bool")) }
      if property == "indexOf" { return functionType([FunctionParamType { name: "value", type_: array.elementType, hasDefault: false }], primitive("int")) }
      if property == "reserve" { return functionType([FunctionParamType { name: "capacity", type_: primitive("int"), hasDefault: false }], voidType()) }
      if property == "pop" { return functionType([], resultType(array.elementType, primitive("string"))) }
      if property == "some" || property == "every" {
        predicate := functionType([FunctionParamType { name: "it", type_: array.elementType, hasDefault: false }], primitive("bool"))
        return functionType([FunctionParamType { name: "predicate", type_: predicate, hasDefault: false }], primitive("bool"))
      }
      if property == "filter" {
        predicate := functionType([FunctionParamType { name: "it", type_: array.elementType, hasDefault: false }], primitive("bool"))
        return functionType([FunctionParamType { name: "predicate", type_: predicate, hasDefault: false }], arrayType(array.elementType, array.readonly_))
      }
      if property == "map" {
        mapped := typeParameter("U")
        mapper := functionType([FunctionParamType { name: "it", type_: array.elementType, hasDefault: false }], mapped)
        return functionType([FunctionParamType { name: "mapper", type_: mapper, hasDefault: false }], arrayType(mapped, array.readonly_), ["U"])
      }
      if property == "slice" { return functionType([FunctionParamType { name: "start", type_: primitive("int"), hasDefault: false }, FunctionParamType { name: "end", type_: primitive("int"), hasDefault: false }], arrayType(array.elementType, array.readonly_)) }
      if property == "buildReadonly" { return functionType([], arrayType(array.elementType, true)) }
      if property == "cloneMutable" { return functionType([], arrayType(array.elementType)) }
      return unknownType()
    }
    map: MapResolvedType -> {
      if property == "size" { return primitive("int") }
      if property == "has" { return functionType([FunctionParamType { name: "key", type_: map.keyType, hasDefault: false }], primitive("bool")) }
      if property == "get" { return functionType([FunctionParamType { name: "key", type_: map.keyType, hasDefault: false }], resultType(map.valueType, primitive("string"))) }
      if property == "set" { return functionType([FunctionParamType { name: "key", type_: map.keyType, hasDefault: false }, FunctionParamType { name: "value", type_: map.valueType, hasDefault: false }], voidType()) }
      if property == "keys" { return functionType([], arrayType(map.keyType)) }
      if property == "values" { return functionType([], arrayType(map.valueType)) }
      if property == "buildReadonly" { return functionType([], mapType(map.keyType, map.valueType, true)) }
      if property == "cloneMutable" { return functionType([], mapType(map.keyType, map.valueType)) }
      return unknownType()
    }
    set: SetResolvedType -> {
      if property == "size" { return primitive("int") }
      if property == "has" { return functionType([FunctionParamType { name: "value", type_: set.elementType, hasDefault: false }], primitive("bool")) }
      if set.readonly_ && property == "add" { typeError(state, "Method \"add\" is not available on readonly set", span); return unknownType() }
      if property == "add" { return functionType([FunctionParamType { name: "value", type_: set.elementType, hasDefault: false }], voidType()) }
      if set.readonly_ && property == "delete" { typeError(state, "Method \"delete\" is not available on readonly set", span); return unknownType() }
      if property == "delete" { return functionType([FunctionParamType { name: "value", type_: set.elementType, hasDefault: false }], voidType()) }
      if property == "values" { return functionType([], arrayType(set.elementType)) }
      if set.readonly_ && property == "buildReadonly" { typeError(state, "Method \"buildReadonly\" is not available on readonly set", span); return unknownType() }
      if property == "buildReadonly" { return functionType([], setType(set.elementType, true)) }
      if property == "cloneMutable" { return functionType([], setType(set.elementType)) }
      return unknownType()
    }
    result: ResultResolvedType -> {
      if property == "value" { return result.valueType }
      if property == "error" { return result.errorType }
      if property == "isSuccess" || property == "isFailure" { return functionType([], primitive("bool")) }
      if property == "unwrapOr" {
        if result.valueType.kind == "void" {
          typeError(state, "Method \"unwrapOr\" is not available on Result<void, E>", span)
          return unknownType()
        }
        return functionType([
          FunctionParamType { name: "defaultValue", type_: result.valueType, hasDefault: false },
        ], result.valueType)
      }
      return unknownType()
    }
    stream: StreamResolvedType -> {
      if property == "next" { return functionType([], primitive("bool")) }
      if property == "value" { return functionType([], stream.elementType) }
      return unknownType()
    }
    _: RangeResolvedType -> {
      if property == "lowerBound" || property == "upperBound" { return primitive("int") }
      return unknownType()
    }
    actor: ActorType -> { return memberType(state, actor.innerClass, property, span) }
    promise: PromiseType -> {
      if property == "get" { return functionType([], resultType(promise.valueType, primitive("string"))) }
      return unknownType()
    }
    parameter: TypeParameterType -> {
      if property == "metadata" {
        if parameter.constraintName != "Reflectable" {
          typeError(state, "Static member \"metadata\" requires type parameter \"" + parameter.name + "\" to be constrained by Reflectable", span)
          return unknownType()
        }
        return classMetadataType(parameter)
      }
      if property == "fromJsonValue" {
        if parameter.constraintName != "JsonSerializable" {
          typeError(state, "Static member \"fromJsonValue\" requires type parameter \"" + parameter.name + "\" to be constrained by JsonSerializable", span)
          return unknownType()
        }
        return functionType([
          FunctionParamType { name: "value", type_: jsonValueType(), hasDefault: false },
          FunctionParamType { name: "lenient", type_: primitive("bool"), hasDefault: true },
        ], resultType(parameter, primitive("string")))
      }
      return unknownType()
    }
    metadata: ClassMetadataResolvedType -> {
      if property == "name" || property == "description" { return primitive("string") }
      if property == "methods" { return arrayType(methodReflectionType(metadata.classType)) }
      if property == "defs" { return unionType([jsonValueType(), nullType()]) }
      if property == "invoke" {
        return functionType([
          FunctionParamType { name: "instance", type_: metadata.classType, hasDefault: false },
          FunctionParamType { name: "methodName", type_: primitive("string"), hasDefault: false },
          FunctionParamType { name: "params", type_: jsonValueType(), hasDefault: false },
        ], resultType(jsonValueType(), jsonValueType()))
      }
      return unknownType()
    }
    reflection: MethodReflectionResolvedType -> {
      if property == "name" || property == "description" { return primitive("string") }
      if property == "inputSchema" || property == "outputSchema" { return jsonValueType() }
      if property == "invoke" {
        return functionType([
          FunctionParamType { name: "instance", type_: reflection.classType, hasDefault: false },
          FunctionParamType { name: "params", type_: jsonValueType(), hasDefault: false },
        ], resultType(jsonValueType(), jsonValueType()))
      }
      return unknownType()
    }
    enum_: EnumType -> {
      if property == "name" { return primitive("string") }
      if property == "value" { return primitive("int") }
      if property == "fromName" {
        return functionType(
          [FunctionParamType { name: "value", type_: primitive("string"), hasDefault: false }],
          unionType([enum_, nullType()]),
        )
      }
      if property == "fromValue" {
        return functionType(
          [FunctionParamType { name: "value", type_: primitive("int"), hasDefault: false }],
          unionType([enum_, nullType()]),
        )
      }
      declaration := declarationFor(state.result, enum_.symbol)
      if declaration != null {
        case declaration! {
          enumDeclaration: EnumDeclaration -> {
            for variant of enumDeclaration.variants { if variant.name == property { return enum_ } }
          }
          _ -> { }
        }
      }
      return unknownType()
    }
    class_: ClassType -> {
      if class_.name == "SourceLocation" && class_.symbol.module == "<builtin>" {
        if property == "fileName" || property == "functionName" { return primitive("string") }
        if property == "line" { return primitive("int") }
        return unknownType()
      }
      declaration := declarationFor(state.result, class_.symbol)
      if declaration == null { return unknownType() }
      case declaration! {
        classDeclaration: ClassDeclaration -> {
          if property == "metadata" {
            if classDeclaration.typeParams.length > 0 {
              typeError(state, "Metadata is not available on generic type \"" + classDeclaration.name + "\"", span)
              return unknownType()
            }
            if !canGenerateJsonSerialization(classDeclaration, jsonPrograms(state.result)) || !canGenerateJsonDeserialization(classDeclaration, jsonPrograms(state.result)) {
              typeError(state, "Type \"" + classDeclaration.name + "\" is not eligible for metadata because it does not support automatic JSON generation", span)
              return unknownType()
            }
            let valid = true
            for method of classDeclaration.methods {
              if method.private_ || method.static_ { continue }
              for parameter of method.params {
                if parameter.resolvedType != null && !isGeneratedJsonType(parameter.resolvedType!, jsonPrograms(state.result)) {
                  typeError(state, "Parameter \"" + parameter.name + "\" of method \"" + method.name + "\" is not JSON-serializable", parameter.span)
                  valid = false
                }
              }
              if method.resolvedType != null {
                case method.resolvedType! {
                function_: FunctionType -> {
                  let successType = function_.returnType
                  case successType {
                    result: ResultResolvedType -> { successType = result.valueType }
                    _ -> { }
                  }
                  if successType.kind != "void" && !isGeneratedJsonType(successType, jsonPrograms(state.result)) {
                    typeError(state, "Return type of method \"" + method.name + "\" is not JSON-serializable", method.span)
                    valid = false
                  }
                }
                _ -> { }
                }
              }
            }
            if !valid { return unknownType() }
            classDeclaration.needsMetadata = true
            return classMetadataType(class_)
          }
          if property == "toJsonObject" && canGenerateJsonSerialization(classDeclaration, jsonPrograms(state.result)) {
            return functionType([], jsonObjectType())
          }
          if property == "fromJsonValue" && canGenerateJsonDeserialization(classDeclaration, jsonPrograms(state.result)) {
            return functionType([
              FunctionParamType { name: "value", type_: jsonValueType(), hasDefault: false },
              FunctionParamType { name: "lenient", type_: primitive("bool"), hasDefault: true },
            ], resultType(object, primitive("string")))
          }
          if property == "toJsonObject" || property == "fromJsonValue" {
            typeError(state, "Type \"" + classDeclaration.name + "\" does not support automatic JSON " + (if property == "toJsonObject" then "serialization" else "deserialization"), span)
            return unknownType()
          }
          for field of classDeclaration.fields {
            for name of field.names {
              if name == property {
                fieldType := if field.resolvedType != null then field.resolvedType! else if field.type_ != null then resolveType(state, field.type_!, state.info!, state.moduleScope!) else unknownType()
                return substituteTypeParams(fieldType, classDeclaration.typeParams, class_.typeArgs)
              }
            }
          }
          for method of classDeclaration.methods {
            if method.name == property {
              methodType := method.resolvedType ?? methodSignature(method, classModuleFor(state.result, class_.symbol), state.result)
              return substituteTypeParams(methodType, classDeclaration.typeParams, class_.typeArgs)
            }
          }
        }
        interface_: InterfaceDeclaration -> {
          for field of interface_.fields { if field.name == property { return field.resolvedType ?? resolveType(state, field.type_, state.info!, state.moduleScope!) } }
          for method of interface_.methods { if method.name == property { return method.resolvedType ?? methodSignature(method, classModuleFor(state.result, class_.symbol), state.result) } }
        }
        _ -> { }
      }
    }
    _: EnumType -> { return object }
    interfaceType_: InterfaceType -> {
      declaration := declarationFor(state.result, interfaceType_.symbol)
      if declaration == null { return unknownType() }
      case declaration! {
        interface_: InterfaceDeclaration -> {
          if property == "fromJsonValue" {
            if interface_.typeParams.length > 0 {
              typeError(state, "Automatic JSON deserialization is not available on generic interface \"" + interface_.name + "\"", span)
              return unknownType()
            }
            if interfaceType_.symbol.implementations.length == 0 {
              typeError(state, "Cannot deserialize interface \"" + interface_.name + "\": no implementing classes found", span)
              return unknownType()
            }
            discriminator := interfaceJsonDiscriminator(interface_, jsonPrograms(state.result))
            if discriminator == null {
              typeError(state, "Cannot deserialize interface \"" + interface_.name + "\": all implementing classes must share a const string field with distinct values (e.g. const kind = \"variant\")", span)
              return unknownType()
            }
            interface_.needsJson = true
            return functionType([
              FunctionParamType { name: "value", type_: jsonValueType(), hasDefault: false },
              FunctionParamType { name: "lenient", type_: primitive("bool"), hasDefault: true },
            ], resultType(object, primitive("string")))
          }
          for field of interface_.fields {
            if field.name == property {
              fieldType := field.resolvedType ?? resolveType(state, field.type_, state.info!, state.moduleScope!)
              return substituteTypeParams(fieldType, interface_.typeParams, interfaceType_.typeArgs)
            }
          }
          for method of interface_.methods {
            if method.name == property {
              methodType := method.resolvedType ?? methodSignature(method, classModuleFor(state.result, interfaceType_.symbol), state.result)
              return substituteTypeParams(methodType, interface_.typeParams, interfaceType_.typeArgs)
            }
          }
        }
        _ -> { }
      }
    }
    _ -> { }
  }
  return unknownType()
}

function jsonPrograms(result: AnalysisResult): Program[] {
  let programs: Program[] = []
  for module of result.modules { programs.push(module.program) }
  return programs
}

export function indexType(state: CheckerState, object: ResolvedType, index: ResolvedType, span: SourceSpan): ResolvedType {
  case object {
    array: ArrayResolvedType -> {
      if !isAssignable(index, primitive("int")) && typeName(index) != "unknown" { typeError(state, "Index must be an int", span) }
      return array.elementType
    }
    map: MapResolvedType -> {
      if !isAssignable(index, map.keyType) && typeName(index) != "unknown" { typeError(state, "Invalid map key type", span) }
      return map.valueType
    }
    _: TupleResolvedType -> { return unknownType() }
    primitive_: PrimitiveType -> {
      if primitive_.name == "string" {
        if !isAssignable(index, primitive("int")) && typeName(index) != "unknown" { typeError(state, "Index must be an int", span) }
        return primitive("char")
      }
    }
    _ -> { }
  }
  return unknownType()
}
