// Generic inference and decorated call-target resolution.

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


import { declarationFor } from "./checker-symbols"
import { findClassMethod } from "./checker-interfaces"

export function inferTypeArgument(pattern: ResolvedType, actual: ResolvedType, name: string): ResolvedType | null {
  case pattern {
    parameter: TypeParameterType -> { if parameter.name == name { return actual } }
    array: ArrayResolvedType -> {
      case actual {
        concrete: ArrayResolvedType -> { return inferTypeArgument(array.elementType, concrete.elementType, name) }
        _ -> { }
      }
    }
    map: MapResolvedType -> {
      case actual {
        concrete: MapResolvedType -> {
          key := inferTypeArgument(map.keyType, concrete.keyType, name)
          if key != null { return key }
          return inferTypeArgument(map.valueType, concrete.valueType, name)
        }
        _ -> { }
      }
    }
    set_: SetResolvedType -> {
      case actual {
        concrete: SetResolvedType -> { return inferTypeArgument(set_.elementType, concrete.elementType, name) }
        _ -> { }
      }
    }
    stream: StreamResolvedType -> {
      case actual {
        concrete: StreamResolvedType -> { return inferTypeArgument(stream.elementType, concrete.elementType, name) }
        _ -> { }
      }
    }
    class_: ClassType -> {
      case actual {
        concrete: ClassType -> {
          if class_.symbol.module != concrete.symbol.module || class_.symbol.name != concrete.symbol.name { return null }
          for i of 0..<class_.typeArgs.length {
            if i < concrete.typeArgs.length {
              candidate := inferTypeArgument(class_.typeArgs[i], concrete.typeArgs[i], name)
              if candidate != null { return candidate }
            }
          }
        }
        _ -> { }
      }
    }
    interface_: InterfaceType -> {
      case actual {
        concrete: InterfaceType -> {
          for i of 0..<interface_.typeArgs.length {
            if i < concrete.typeArgs.length {
              candidate := inferTypeArgument(interface_.typeArgs[i], concrete.typeArgs[i], name)
              if candidate != null { return candidate }
            }
          }
        }
        _ -> { }
      }
    }
    function_: FunctionType -> {
      case actual {
        concrete: FunctionType -> {
          for i of 0..<function_.params.length {
            if i < concrete.params.length {
              candidate := inferTypeArgument(function_.params[i].type_, concrete.params[i].type_, name)
              if candidate != null { return candidate }
            }
          }
          return inferTypeArgument(function_.returnType, concrete.returnType, name)
        }
        _ -> { }
      }
    }
    result_: ResultResolvedType -> {
      case actual {
        concrete: ResultResolvedType -> {
          value := inferTypeArgument(result_.valueType, concrete.valueType, name)
          if value != null { return value }
          return inferTypeArgument(result_.errorType, concrete.errorType, name)
        }
        _ -> { }
      }
    }
    tuple: TupleResolvedType -> {
      case actual {
        concrete: TupleResolvedType -> {
          for i of 0..<tuple.elements.length {
            if i < concrete.elements.length {
              candidate := inferTypeArgument(tuple.elements[i], concrete.elements[i], name)
              if candidate != null { return candidate }
            }
          }
        }
        _ -> { }
      }
    }
    weak_: WeakResolvedType -> {
      case actual {
        concrete: WeakResolvedType -> { return inferTypeArgument(weak_.inner, concrete.inner, name) }
        _ -> { }
      }
    }
    _ -> { }
  }
  return null
}

export function functionDeclarationForCallee(callee: Expression, calleeType: ResolvedType, result: AnalysisResult): FunctionDeclaration | null {
  case callee {
    identifier: Identifier -> {
      if identifier.resolvedBinding != null && identifier.resolvedBinding!.symbol != null {
        symbol := identifier.resolvedBinding!.symbol!
        declaration := declarationFor(result, symbol)
        if declaration != null {
          case declaration! {
            fn: FunctionDeclaration -> { return fn }
            class_: ClassDeclaration -> {
              let method = findClassMethod(class_.methods, identifier.name, false)
              if method != null { return method }
              method = findClassMethod(class_.methods, identifier.name, true)
              if method != null { return method }
            }
            _ -> { }
          }
        }
      }
    }
    member: MemberExpression -> {
      objectType := member.object.resolvedType
      if objectType != null {
        case objectType! {
          class_: ClassType -> {
            declaration := declarationFor(result, class_.symbol)
            if declaration != null {
              case declaration! {
                classDeclaration: ClassDeclaration -> {
                  let method = findClassMethod(classDeclaration.methods, member.property, false)
                  if method != null { return method }
                  method = findClassMethod(classDeclaration.methods, member.property, true)
                  if method != null { return method }
                }
                _ -> { }
              }
            }
          }
          actor: ActorType -> {
            declaration := declarationFor(result, actor.innerClass.symbol)
            if declaration != null {
              case declaration! {
                classDeclaration: ClassDeclaration -> {
                  method := findClassMethod(classDeclaration.methods, member.property, false)
                  if method != null { return method }
                }
                _ -> { }
              }
            }
          }
          interface_: InterfaceType -> {
            declaration := declarationFor(result, interface_.symbol)
            if declaration != null {
              case declaration! {
                interfaceDeclaration: InterfaceDeclaration -> {
                  for method of interfaceDeclaration.methods { if method.name == member.property { return method } }
                }
                _ -> { }
              }
            }
          }
          _ -> { }
        }
      }
    }
    _ -> { }
  }
  return null
}

export function constructorForClass(class_: ClassType, result: AnalysisResult): FunctionDeclaration | null {
  declaration := declarationFor(result, class_.symbol)
  if declaration == null { return null }
  case declaration! {
    classDeclaration: ClassDeclaration -> {
      for method of classDeclaration.methods { if method.name == "constructor" { return method } }
    }
    _ -> { }
  }
  return null
}

export function insideConstructorFactory(scope: Scope, class_: ClassType): bool {
  let current: Scope | null = scope
  while current != null {
    if current!.functionName != "" {
      if current!.functionName != "constructor" { return false }
      if current!.thisType == null { return false }
      case current!.thisType! {
        owner: ClassType -> { return owner.symbol.module == class_.symbol.module && owner.symbol.name == class_.symbol.name }
        _ -> { return false }
      }
    }
    current = current!.parent
  }
  return false
}

export function staticMemberOwner(objectType: ResolvedType, property: string, result: AnalysisResult): ClassDeclaration | null {
  case objectType {
    class_: ClassType -> {
      declaration := declarationFor(result, class_.symbol)
      if declaration != null {
        case declaration! {
          classDeclaration: ClassDeclaration -> {
            if property == "metadata" && classDeclaration.needsMetadata { return classDeclaration }
            if property == "fromJsonValue" && canGenerateJsonDeserialization(classDeclaration, jsonPrograms(result)) { return classDeclaration }
            for method of classDeclaration.methods { if method.name == property && method.static_ { return classDeclaration } }
            for field of classDeclaration.fields {
              for name of field.names { if name == property && field.static_ { return classDeclaration } }
            }
          }
          _ -> { }
        }
      }
    }
    _ -> { }
  }
  return null
}

function jsonPrograms(result: AnalysisResult): Program[] {
  let programs: Program[] = []
  for module of result.modules { programs.push(module.program) }
  return programs
}

// Emission is intentionally a pure consumer of decorated AST data.  This
// graph-wide validation is the last front-end boundary: a missing decoration
// or an UnknownType anywhere in a declaration, binding, annotation, or nested
// expression is a compilation error, so the emitter never needs recovery
// lookups or syntactic fallbacks.
