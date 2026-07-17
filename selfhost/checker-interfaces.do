// Interface implementation discovery and structural conformance.

import {
  ActorType, ArrayResolvedType, Binding, CheckResult, ClassType, EnumType, InterfaceType,
  Diagnostic, FunctionParamType, FunctionType,
  JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, PromiseType, ResolvedType, ResultResolvedType, Scope, SemanticLocation, SemanticSpan, SetResolvedType, Symbol,
  StreamResolvedType, TupleResolvedType, UnionResolvedType, UnknownType, TypeParameterType, VoidType, WeakResolvedType,
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
  AsyncExpression, RetireExpression, ActorCreationExpression, Parameter,
} from "./ast"
import {
  actorType, applyDeepReadonly, arrayType, classType, enumType, functionType, interfaceType, isAssignable, isNumeric, joinTypes,
  isJsonValueType, jsonObjectType, jsonValueType, mapType, resultType, streamType,
  nullType, numericResult, primitive, promiseType, sameType, tupleType, typeName, unionType,
  substituteTypeParams, typeParameter, unknownType, voidType,
} from "./checker-types"
import { canGenerateJsonDeserialization, canGenerateJsonSerialization } from "./json-semantics"
import { findActorBoundaryViolation } from "./checker-actor-boundary"
import { collectRetiredActorBindings, reportRetiredActorUses } from "./checker-actor-lifecycle"


import { methodSignature, resolveAnnotation, declarationFor, symbolName } from "./checker-symbols"

export function symbolSpan(info: ModuleInfo, name: string): SourceSpan {
  for statement of info.program.statements { if symbolName(statement) == name { return statement.span } }
  return info.program.span
}

export function findModule(result: AnalysisResult, path: string): ModuleInfo | null {
  for module of result.modules { if module.path == path { return module } }
  return null
}

// Interface lowering is closed-world: every class in the analyzed graph is a
// candidate, including classes that do not spell an explicit `implements` list.
// Populate this map before checking expressions so ordinary assignment and
// return compatibility can use the same structural result as emission.
export function discoverInterfaceImplementations(result: AnalysisResult): void {
  for interfaceModule of result.modules {
    for interfaceSymbol of interfaceModule.symbols {
      if interfaceSymbol.kind != "interface" { continue }
      for classModule of result.modules {
        for classSymbol of classModule.symbols {
          if classSymbol.kind != "class" { continue }
          if classSatisfiesInterface(result, classSymbol, interfaceSymbol) {
            if !containsImplementation(interfaceSymbol.implementations, classSymbol) {
              interfaceSymbol.implementations.push(classSymbol)
            }
          }
        }
      }
    }
  }
}

export function containsImplementation(implementations: Symbol[], candidate: Symbol): bool {
  for implementation of implementations {
    if implementation.module == candidate.module && implementation.name == candidate.name { return true }
  }
  return false
}

export function addImplementedInterfaceType(symbol: Symbol, name: string): void {
  for existing of symbol.implementedInterfaceTypes { if existing == name { return } }
  symbol.implementedInterfaceTypes.push(name)
}

// Concrete generic interfaces remain structural. Record matching ordinary
// classes as soon as a concrete interface use is resolved so subsequent
// assignment and call compatibility can use the normal assignability path.
export function registerConcreteInterfaceImplementations(result: AnalysisResult, interface_: InterfaceType): void {
  for module of result.modules {
    for symbol of module.symbols {
      if symbol.kind != "class" { continue }
      declaration := declarationFor(result, symbol)
      if declaration == null { continue }
      case declaration! {
        class_: ClassDeclaration -> {
          if class_.typeParams.length == 0 && classSatisfiesConcreteInterface(result, class_, classType(class_.name, symbol), interface_) {
            addImplementedInterfaceType(symbol, typeName(interface_))
          }
        }
        _ -> { }
      }
    }
  }
}

export function concreteTypes(types: ResolvedType[]): bool {
  for type_ of types {
    case type_ {
      _: TypeParameterType -> { return false }
      class_: ClassType -> { if !concreteTypes(class_.typeArgs) { return false } }
      interface_: InterfaceType -> { if !concreteTypes(interface_.typeArgs) { return false } }
      array: ArrayResolvedType -> { if !concreteTypes([array.elementType]) { return false } }
      map: MapResolvedType -> { if !concreteTypes([map.keyType, map.valueType]) { return false } }
      set_: SetResolvedType -> { if !concreteTypes([set_.elementType]) { return false } }
      stream: StreamResolvedType -> { if !concreteTypes([stream.elementType]) { return false } }
      result_: ResultResolvedType -> { if !concreteTypes([result_.valueType, result_.errorType]) { return false } }
      tuple: TupleResolvedType -> { if !concreteTypes(tuple.elements) { return false } }
      union_: UnionResolvedType -> { if !concreteTypes(union_.types) { return false } }
      weak_: WeakResolvedType -> { if !concreteTypes([weak_.inner]) { return false } }
      function_: FunctionType -> {
        for parameter of function_.params { if !concreteTypes([parameter.type_]) { return false } }
        if !concreteTypes([function_.returnType]) { return false }
      }
      _ -> { }
    }
  }
  return true
}

export function classSatisfiesConcreteInterface(result: AnalysisResult, class_: ClassDeclaration, classType_: ClassType, interfaceType_: InterfaceType): bool {
  declaration := declarationFor(result, interfaceType_.symbol)
  if declaration == null { return false }
  case declaration! {
    interface_: InterfaceDeclaration -> {
      for required of interface_.fields {
        actualField := findClassField(class_.fields, required.name)
        if actualField == null || actualField!.type_ == null { return false }
        if required.readonly_ && !actualField!.readonly_ { return false }
        actualBase := if actualField!.resolvedType == null then resolveAnnotation(actualField!.type_!, classModuleFor(result, classType_.symbol), result, class_.typeParams) else actualField!.resolvedType!
        requiredBase := if required.resolvedType == null then resolveAnnotation(required.type_, classModuleFor(result, interfaceType_.symbol), result, interface_.typeParams) else required.resolvedType!
        actual := substituteTypeParams(actualBase, class_.typeParams, classType_.typeArgs)
        expected := substituteTypeParams(requiredBase, interface_.typeParams, interfaceType_.typeArgs)
        if !isAssignable(actual, expected) { return false }
      }
      for requiredMethod of interface_.methods {
        actualMethod := findClassMethod(class_.methods, requiredMethod.name, requiredMethod.static_)
        if actualMethod == null { return false }
        actualBase := if actualMethod!.resolvedType == null then methodSignature(actualMethod!, classModuleFor(result, classType_.symbol), result) else actualMethod!.resolvedType!
        requiredBase := if requiredMethod.resolvedType == null then methodSignature(requiredMethod, classModuleFor(result, interfaceType_.symbol), result) else requiredMethod.resolvedType!
        actual := substituteTypeParams(actualBase, class_.typeParams, classType_.typeArgs)
        expected := substituteTypeParams(requiredBase, interface_.typeParams, interfaceType_.typeArgs)
        if !sameConcreteMethodType(actual, expected) { return false }
      }
      return true
    }
    _ -> { return false }
  }
  return false
}

export function classSatisfiesInterface(result: AnalysisResult, classSymbol: Symbol, interfaceSymbol: Symbol): bool {
  classDeclaration := declarationFor(result, classSymbol)
  interfaceDeclaration := declarationFor(result, interfaceSymbol)
  if classDeclaration == null || interfaceDeclaration == null { return false }
  case classDeclaration! {
    class_: ClassDeclaration -> {
      case interfaceDeclaration! {
        interface_: InterfaceDeclaration -> {
          for required of interface_.fields {
            classField := findClassField(class_.fields, required.name)
            if classField == null { return false }
            if required.readonly_ && !classField!.readonly_ { return false }
            actual := if classField!.resolvedType == null then resolveAnnotation(classField!.type_!, classModuleFor(result, classSymbol), result) else classField!.resolvedType!
            expected := if required.resolvedType == null then resolveAnnotation(required.type_, classModuleFor(result, interfaceSymbol), result) else required.resolvedType!
            if !isAssignable(actual, expected) { return false }
          }
          for requiredMethod of interface_.methods {
            classMethod := findClassMethod(class_.methods, requiredMethod.name, requiredMethod.static_)
            if classMethod == null || classMethod!.params.length != requiredMethod.params.length { return false }
            if !sameFunctionSignature(classMethod!, requiredMethod, result, classSymbol, interfaceSymbol) { return false }
          }
          return true
        }
        _ -> { return false }
      }
    }
    _ -> { return false }
  }
  return false
}

export function sameConcreteMethodType(actual: ResolvedType, expected: ResolvedType): bool {
  case actual {
    actualFunction: FunctionType -> {
      case expected {
        expectedFunction: FunctionType -> {
          if actualFunction.params.length != expectedFunction.params.length { return false }
          for index of 0..<actualFunction.params.length {
            if !sameType(actualFunction.params[index].type_, expectedFunction.params[index].type_) { return false }
          }
          return sameType(actualFunction.returnType, expectedFunction.returnType)
        }
        _ -> { return false }
      }
    }
    _ -> { return sameType(actual, expected) }
  }
  return false
}

export function findClassField(fields: ClassField[], name: string): ClassField | null {
  for field of fields { for fieldName of field.names { if fieldName == name { return field } } }
  return null
}

export function findClassMethod(methods: FunctionDeclaration[], name: string, static_: bool): FunctionDeclaration | null {
  for method of methods { if method.name == name && method.static_ == static_ { return method } }
  return null
}

export function sameFunctionSignature(classMethod: FunctionDeclaration, interfaceMethod: FunctionDeclaration, result: AnalysisResult, classSymbol: Symbol, interfaceSymbol: Symbol): bool {
  classModule := classModuleFor(result, classSymbol)
  interfaceModule := classModuleFor(result, interfaceSymbol)
  for i of 0..<classMethod.params.length {
    actualParameterType := if classMethod.params[i].resolvedType == null then resolveAnnotation(classMethod.params[i].type_!, classModule, result) else classMethod.params[i].resolvedType!
    interfaceType_ := if interfaceMethod.params[i].resolvedType == null then resolveAnnotation(interfaceMethod.params[i].type_!, interfaceModule, result) else interfaceMethod.params[i].resolvedType!
    if !sameType(actualParameterType, interfaceType_) { return false }
  }
  if classMethod.returnType == null || interfaceMethod.returnType == null { return classMethod.returnType == null && interfaceMethod.returnType == null }
  classReturn := resolveAnnotation(classMethod.returnType!, classModule, result)
  interfaceReturn := resolveAnnotation(interfaceMethod.returnType!, interfaceModule, result)
  return isAssignable(classReturn, interfaceReturn)
}

export function classModuleFor(result: AnalysisResult, symbol: Symbol): ModuleInfo {
  module := findModule(result, symbol.module)
  if module == null { panic("Missing module for symbol " + symbol.name) }
  return module!
}
