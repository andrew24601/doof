// Actor-call boundary validation for the self-hosted checker.
//
// Validation is deliberately performed at call sites after generic
// substitution. The same method may be called locally without crossing an
// actor domain, while an Actor<T> receiver requires deeply immutable payloads.

import { AnalysisResult, ModuleInfo } from "./analyzer"
import {
  ActorType, ArrayResolvedType, ClassType, EnumType, FunctionType, InterfaceType,
  JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, PromiseType,
  ResolvedType, ResultResolvedType, StreamResolvedType, TupleResolvedType,
  TypeParameterType, UnionResolvedType, UnknownType, VoidType,
} from "./semantic"
import { ClassDeclaration, ExportDeclaration, InterfaceDeclaration, Statement } from "./ast"
import { classType, substituteTypeParams, typeName } from "./checker-types"

export class ActorBoundaryViolation {
  reason: string
}

export function findActorBoundaryViolation(result: AnalysisResult, type_: ResolvedType): ActorBoundaryViolation | null {
  return findViolation(result, type_, [])
}

function findViolation(result: AnalysisResult, type_: ResolvedType, seen: string[]): ActorBoundaryViolation | null {
  case type_ {
    _: PrimitiveType -> { return null }
    _: EnumType -> { return null }
    _: NullType -> { return null }
    _: VoidType -> { return null }
    _: UnknownType -> { return null }
    _: TypeParameterType -> { return null }
    _: JsonValueResolvedType -> { return null }
    _: ActorType -> { return ActorBoundaryViolation { reason: "Actor<T> references cannot cross actor boundaries" } }
    _: PromiseType -> { return ActorBoundaryViolation { reason: "Promise<T> values cannot cross actor boundaries" } }
    array: ArrayResolvedType -> {
      if !array.readonly_ { return ActorBoundaryViolation { reason: "array type \"" + typeName(type_) + "\" is mutable" } }
      return findViolation(result, array.elementType, seen)
    }
    map: MapResolvedType -> {
      if !map.readonly_ { return ActorBoundaryViolation { reason: "map type \"" + typeName(type_) + "\" is mutable" } }
      keyViolation := findViolation(result, map.keyType, seen)
      if keyViolation != null { return keyViolation }
      return findViolation(result, map.valueType, seen)
    }
    stream: StreamResolvedType -> { return ActorBoundaryViolation { reason: "stream type \"" + typeName(stream) + "\" is mutable" } }
    result_: ResultResolvedType -> {
      valueViolation := findViolation(result, result_.valueType, seen)
      if valueViolation != null { return valueViolation }
      return findViolation(result, result_.errorType, seen)
    }
    tuple: TupleResolvedType -> {
      for element of tuple.elements {
        violation := findViolation(result, element, seen)
        if violation != null { return violation }
      }
      return null
    }
    union_: UnionResolvedType -> {
      for member of union_.types {
        violation := findViolation(result, member, seen)
        if violation != null { return violation }
      }
      return null
    }
    function_: FunctionType -> {
      for parameter of function_.params {
        violation := findViolation(result, parameter.type_, seen)
        if violation != null {
          return ActorBoundaryViolation { reason: "callback parameter \"" + parameter.name + "\" cannot cross actor boundaries: " + violation!.reason }
        }
      }
      return findViolation(result, function_.returnType, seen)
    }
    class_: ClassType -> { return findClassViolation(result, class_, seen) }
    interface_: InterfaceType -> { return findInterfaceViolation(result, interface_, seen) }
  }
  return null
}

function findClassViolation(result: AnalysisResult, type_: ClassType, seen: string[]): ActorBoundaryViolation | null {
  key := "class:" + type_.symbol.module + ":" + typeName(type_)
  if containsString(seen, key) { return null }
  let nextSeen: string[] = []
  for item of seen { nextSeen.push(item) }
  nextSeen.push(key)
  declaration := classDeclaration(result, type_.symbol.module, type_.symbol.name)
  if declaration == null { return null }
  for field of declaration!.fields {
    if !field.readonly_ {
      name := if field.names.length == 0 then "<field>" else field.names[0]
      return ActorBoundaryViolation { reason: "field \"" + name + "\" is mutable" }
    }
    fieldType := field.resolvedType
    if fieldType == null { continue }
    effective := substituteTypeParams(fieldType!, declaration!.typeParams, type_.typeArgs)
    violation := findViolation(result, effective, nextSeen)
    if violation != null {
      name := if field.names.length == 0 then "<field>" else field.names[0]
      return ActorBoundaryViolation { reason: "field \"" + name + "\" cannot cross actor boundaries: " + violation!.reason }
    }
  }
  return null
}

function findInterfaceViolation(result: AnalysisResult, type_: InterfaceType, seen: string[]): ActorBoundaryViolation | null {
  key := "interface:" + type_.symbol.module + ":" + typeName(type_)
  if containsString(seen, key) { return null }
  let nextSeen: string[] = []
  for item of seen { nextSeen.push(item) }
  nextSeen.push(key)
  declaration := interfaceDeclaration(result, type_.symbol.module, type_.symbol.name)
  if declaration == null { return null }
  for field of declaration!.fields {
    if !field.readonly_ { return ActorBoundaryViolation { reason: "field \"" + field.name + "\" is mutable" } }
    if field.resolvedType == null { continue }
    effective := substituteTypeParams(field.resolvedType!, declaration!.typeParams, type_.typeArgs)
    violation := findViolation(result, effective, nextSeen)
    if violation != null {
      return ActorBoundaryViolation { reason: "field \"" + field.name + "\" cannot cross actor boundaries: " + violation!.reason }
    }
  }
  if declaration!.resolvedSymbol != null {
    for implementation of declaration!.resolvedSymbol!.implementations {
      implementationType := classType(implementation.name, implementation)
      violation := findClassViolation(result, implementationType, nextSeen)
      if violation != null {
        return ActorBoundaryViolation {
          reason: "implementation \"" + implementation.name + "\" cannot cross actor boundaries: " + violation!.reason,
        }
      }
    }
  }
  return null
}

function classDeclaration(result: AnalysisResult, modulePath: string, name: string): ClassDeclaration | null {
  module := findModule(result, modulePath)
  if module == null { return null }
  for statement of module!.program.statements {
    case unwrapExport(statement) {
      class_: ClassDeclaration -> { if class_.name == name { return class_ } }
      _ -> { }
    }
  }
  return null
}

function interfaceDeclaration(result: AnalysisResult, modulePath: string, name: string): InterfaceDeclaration | null {
  module := findModule(result, modulePath)
  if module == null { return null }
  for statement of module!.program.statements {
    case unwrapExport(statement) {
      interface_: InterfaceDeclaration -> { if interface_.name == name { return interface_ } }
      _ -> { }
    }
  }
  return null
}

function unwrapExport(statement: Statement): Statement {
  case statement {
    export_: ExportDeclaration -> { return export_.declaration }
    _ -> { return statement }
  }
}

function findModule(result: AnalysisResult, path: string): ModuleInfo | null {
  for module of result.modules { if module.path == path { return module } }
  return null
}

function containsString(values: string[], value: string): bool {
  for item of values { if item == value { return true } }
  return false
}
