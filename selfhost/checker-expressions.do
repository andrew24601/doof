// Expression dispatch, operators, narrowing, and assignment checking.

import {
  ActorType, ArrayResolvedType, Binding, CheckResult, ClassType, EnumType, InterfaceType,
  Diagnostic, FunctionParamType, FunctionType,
  JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType, PromiseType, RangeResolvedType, ResolvedType, ResultResolvedType, Scope, SemanticLocation, SemanticSpan, Symbol,
  StreamResolvedType, TupleResolvedType, UnionResolvedType, UnknownType, TypeParameterType, VoidType,
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
  YieldStatement, YieldBlockExpression, CatchExpression, CaseArm, CaseExpression, CasePattern, CaseStatement, RangePattern, TypePattern, ValuePattern, WildcardPattern,
  TryStatement,
  AsyncExpression, RetireExpression, ActorCreationExpression, Parameter,
} from "./ast"
import {
  actorType, applyDeepReadonly, arrayType, classType, enumType, functionType, interfaceType, isAssignable, isNumeric, joinTypes,
  isJsonValueType, jsonObjectType, jsonValueType, mapType, resultType, streamType,
  nullType, numericResult, primitive, promiseType, rangeType, sameType, tupleType, typeName, unionType,
  substituteTypeParams, typeParameter, unknownType, voidType,
} from "./checker-types"
import { canGenerateJsonDeserialization, canGenerateJsonSerialization } from "./json-semantics"
import { findActorBoundaryViolation } from "./checker-actor-boundary"
import { collectRetiredActorBindings, reportRetiredActorUses } from "./checker-actor-lifecycle"


import { CheckerState } from "./checker-state"
import { checkFunction, checkBlock } from "./checker-statements"
import { checkCall, checkLambda, checkConstruct, callableField } from "./checker-calls"
import { checkArray, checkObject } from "./checker-literals"
import { resolveType, memberType, indexType } from "./checker-resolution"
import { finish, typeError, requireBool } from "./checker-common"
import { builtinSourceLocationType, casePatternName, optionalResolvedType, isNamespaceImport, isBuiltinNamespace, builtinNamespaceMemberType, namespaceMemberType, resolveAnnotation, declare, lookup, currentThisType, isBuiltinCallable, builtinCallable, hasTypeParam, typeParamConstraintName, typeParamConstraint, symbolFor, declarationFor } from "./checker-symbols"
import { constructorForClass, staticMemberOwner } from "./checker-generics"
import { checkerSemanticSpan } from "./checker-validation"

export function checkCaseExpression(state: CheckerState, expression: CaseExpression, scope: Scope, expected: ResolvedType | null): ResolvedType {
  subjectType := checkExpression(state, expression.subject, scope, null)
  let inferredType: ResolvedType = unknownType()
  for arm of expression.arms {
    armScope := Scope { parent: scope }
    checkCasePatterns(state, arm.patterns, subjectType, armScope)
    let armExpected = expected
    if armExpected == null {
      case inferredType {
        _: UnknownType -> { }
        _ -> { armExpected = inferredType }
      }
    }
    let armType: ResolvedType = unknownType()
    case arm.body {
      block: Block -> {
        armScope.inValueYieldBlock = true
        armScope.yieldType = if armExpected == null then optionalResolvedType(unknownType()) else armExpected
        if checkBlock(state, block, armScope) { typeError(state, "Block case-expression arms must yield a value on every path", block.span) }
        armType = armScope.yieldType ?? unknownType()
      }
      bodyExpression: Expression -> { armType = checkExpression(state, bodyExpression, armScope, armExpected) }
    }
    if inferredType.kind == "unknown" { inferredType = armType } else { inferredType = joinTypes(inferredType, armType) }
  }
  expression.resolvedType = optionalResolvedType(inferredType)
  return inferredType
}

export function checkCasePatterns(state: CheckerState, patterns: CasePattern[], subjectType: ResolvedType, scope: Scope): void {
  for pattern of patterns {
    case pattern {
      type_: TypePattern -> {
        let resolved: ResolvedType = unknownType()
        let contextualResultArm = false
        case subjectType {
          _: ResultResolvedType -> {
            case type_.type_ {
              named: NamedType -> {
                if named.name == "Success" || named.name == "Failure" {
                  contextualResultArm = true
                  resolved = subjectType
                  // Explicit payload arguments still need full decoration.
                  for argument of named.typeArgs { resolveType(state, argument, state.info!, scope) }
                }
              }
              _ -> { }
            }
          }
          _ -> { }
        }
        if !contextualResultArm { resolved = resolveType(state, type_.type_, state.info!, scope) }
        case type_.type_ {
          named: NamedType -> { named.resolvedType = optionalResolvedType(resolved) }
          _ -> { }
        }
        type_.resolvedType = optionalResolvedType(resolved)
        if type_.name != "_" {
          declare(scope, Binding {
            name: type_.name,
            kind: "case-binding",
            type_: resolved,
            mutable: false,
            span: checkerSemanticSpan(type_.span),
            module: state.info!.path,
            casePattern: casePatternName(type_),
          })
        }
      }
      value: ValuePattern -> { checkExpression(state, value.value, scope, optionalResolvedType(subjectType)) }
      range: RangePattern -> {
        if range.start != null { checkExpression(state, range.start!, scope, optionalResolvedType(subjectType)) }
        if range.end != null { checkExpression(state, range.end!, scope, optionalResolvedType(subjectType)) }
      }
      _: WildcardPattern -> { }
    }
  }
}

export function checkExpression(state: CheckerState, expression: Expression, scope: Scope, expected: ResolvedType | null): ResolvedType {
  case expression {
    yieldBlock: YieldBlockExpression -> {
      yieldScope := Scope {
        parent: scope,
        inValueYieldBlock: true,
        yieldType: if expected == null then optionalResolvedType(unknownType()) else expected,
      }
      if checkBlock(state, yieldBlock.body, yieldScope) {
        typeError(state, "Yield blocks must yield a value on every path", yieldBlock.body.span)
      }
      resolved := yieldScope.yieldType ?? unknownType()
      return finish(state, yieldBlock, resolved)
    }
    catch_: CatchExpression -> {
      let errorTypes: ResolvedType[] = []
      catchScope := Scope { parent: scope, capturesTryErrors: true, catchErrorTypes: errorTypes }
      checkBlock(state, catch_.body, catchScope)
      if errorTypes.length == 0 {
        state.diagnostics.push(Diagnostic {
          severity: "warning",
          message: "catch block contains no 'try' statements",
          span: checkerSemanticSpan(catch_.span),
          module: state.info!.path,
        })
        return finish(state, catch_, nullType())
      }
      let members: ResolvedType[] = []
      for errorType of errorTypes { members.push(errorType) }
      members.push(nullType())
      return finish(state, catch_, unionType(members))
    }
    _: IntLiteral -> {
      if expected != null { case expected! {
        primitiveExpected: PrimitiveType -> {
          if primitiveExpected.name == "byte" || primitiveExpected.name == "long" || primitiveExpected.name == "float" || primitiveExpected.name == "double" {
            return finish(state, expression, expected!)
          }
        }
        _ -> { }
      } }
      return finish(state, expression, primitive("int"))
    }
    _: LongLiteral -> {
      if expected != null { case expected! {
        primitiveExpected: PrimitiveType -> { if primitiveExpected.name == "double" { return finish(state, expression, expected!) } }
        _ -> { }
      } }
      return finish(state, expression, primitive("long"))
    }
    _: FloatLiteral -> {
      if expected != null { case expected! {
        primitiveExpected: PrimitiveType -> { if primitiveExpected.name == "double" { return finish(state, expression, expected!) } }
        _ -> { }
      } }
      return finish(state, expression, primitive("float"))
    }
    _: DoubleLiteral -> {
      if expected != null { case expected! {
        primitiveExpected: PrimitiveType -> { if primitiveExpected.name == "float" { return finish(state, expression, expected!) } }
        _ -> { }
      } }
      return finish(state, expression, primitive("double"))
    }
    string_: StringLiteral -> {
      for interpolation of string_.interpolations { checkExpression(state, interpolation, scope, null) }
      return finish(state, expression, primitive("string"))
    }
    _: CharLiteral -> { return finish(state, expression, primitive("char")) }
    _: BoolLiteral -> { return finish(state, expression, primitive("bool")) }
    _: NullLiteral -> { return finish(state, expression, nullType()) }
    _: CallerExpression -> { return finish(state, expression, builtinSourceLocationType()) }
    dot: DotShorthand -> { return checkDotShorthand(state, dot, expected) }
    identifier: Identifier -> { return checkIdentifier(state, identifier, scope) }
    binary: BinaryExpression -> { return checkBinary(state, binary, scope) }
    unary: UnaryExpression -> { return checkUnary(state, unary, scope) }
    as_: AsExpression -> { return checkAs(state, as_, scope) }
    assignment: AssignmentExpression -> { return checkAssignment(state, assignment, scope) }
    member: MemberExpression -> {
      let objectType = unknownType()
      let namespaceMember: ResolvedType | null = null
      case member.object {
        identifier: Identifier -> {
          if isNamespaceImport(state.info!, identifier.name) {
            namespaceMember = namespaceMemberType(state.info!, identifier.name, member.property, state.result)
          } else if isBuiltinNamespace(identifier.name) {
            identifier.resolvedBinding = Binding {
              name: identifier.name,
              kind: "builtin-type-namespace",
              type_: primitive(identifier.name),
              mutable: false,
              span: checkerSemanticSpan(identifier.span),
              module: state.info!.path,
            }
            identifier.resolvedType = optionalResolvedType(primitive(identifier.name))
            namespaceMember = builtinNamespaceMemberType(identifier.name, member.property)
          } else {
            objectType = checkExpression(state, member.object, scope, null)
          }
        }
        _ -> { objectType = checkExpression(state, member.object, scope, null) }
      }
      if namespaceMember != null { return finish(state, expression, namespaceMember!) }
      memberValue := memberType(state, objectType, member.property, member.span)
      member.resolvedStaticOwner = staticMemberOwner(objectType, member.property, state.result)
      member.resolvedCallableField = callableField(state, objectType, member.property)
      return finish(state, expression, memberValue)
    }
    index: IndexExpression -> { return finish(state, expression, indexType(state, checkExpression(state, index.object, scope, null), checkExpression(state, index.index, scope, optionalResolvedType(primitive("int"))), index.span)) }
    call: CallExpression -> { return checkCall(state, call, scope, expected) }
    array: ArrayLiteral -> { return checkArray(state, array, scope, expected) }
    tuple: TupleLiteral -> {
      let elements: ResolvedType[] = []
      for item of tuple.elements { elements.push(checkExpression(state, item, scope, null)) }
      return finish(state, expression, tupleType(elements))
    }
    object: ObjectLiteral -> {
      return checkObject(state, object, scope, expected)
    }
    lambda: LambdaExpression -> { return checkLambda(state, lambda, scope, expected) }
    if_: IfExpression -> {
      requireBool(state, checkExpression(state, if_.condition, scope, optionalResolvedType(primitive("bool"))), if_.condition.span)
      return finish(state, expression, joinTypes(checkExpression(state, if_.then_, scope, expected), checkExpression(state, if_.else_, scope, expected)))
    }
    case_: CaseExpression -> { return finish(state, expression, checkCaseExpression(state, case_, scope, expected)) }
    construct: ConstructExpression -> { return checkConstruct(state, construct, scope, expected) }
    async_: AsyncExpression -> {
      case async_.expression {
        block: Block -> {
          checkBlock(state, block, scope)
          typeError(state, "`async` is only valid for actor method calls; use a temporary actor for background work", async_.span)
          return finish(state, expression, promiseType(unknownType()))
        }
        inner: Expression -> {
          innerType := checkExpression(state, inner, scope, null)
          let actorCall = false
          case inner {
            call: CallExpression -> {
              case call.callee {
                member: MemberExpression -> {
                  if member.object.resolvedType != null {
                    case member.object.resolvedType! {
                      _: ActorType -> { actorCall = true }
                      _ -> { }
                    }
                  }
                }
                _ -> { }
              }
            }
            _ -> { }
          }
          if !actorCall { typeError(state, "`async` is only valid for actor method calls; use a temporary actor for background work", async_.span) }
          return finish(state, expression, promiseType(innerType))
        }
      }
    }
    retire_: RetireExpression -> {
      retiredType := checkExpression(state, retire_.actor, scope, null)
      case retiredType {
        actor: ActorType -> { return finish(state, expression, actor.innerClass) }
        _ -> { typeError(state, "Cannot retire non-actor type \"" + typeName(retiredType) + "\"", retire_.span); return finish(state, expression, unknownType()) }
      }
    }
    actorCreation: ActorCreationExpression -> {
      symbol := symbolFor(state.info!, actorCreation.className)
      if symbol == null || symbol!.kind != "class" {
        for argument of actorCreation.args { checkExpression(state, argument, scope, null) }
        typeError(state, "Actor requires a class type; \"" + actorCreation.className + "\" is not a class", actorCreation.span)
        return finish(state, expression, unknownType())
      }
      inner := classType(actorCreation.className, symbol!)
      constructorMethod := constructorForClass(inner, state.result)
      for i of 0..<actorCreation.args.length {
        let expectedArgument: ResolvedType | null = null
        if constructorMethod != null && i < constructorMethod!.params.length { expectedArgument = constructorMethod!.params[i].resolvedType }
        actual := checkExpression(state, actorCreation.args[i], scope, expectedArgument)
        violation := findActorBoundaryViolation(state.result, actual)
        if violation != null {
          typeError(state,
            "Actor constructor argument " + string(i + 1) + " of type \"" + typeName(actual) + "\" cannot cross actor boundary: " + violation!.reason,
            actorCreation.args[i].span,
          )
        }
      }
      return finish(state, expression, actorType(inner))
    }
    _: ThisExpression -> { return finish(state, expression, currentThisType(scope)) }
    _ -> { return finish(state, expression, unknownType()) }
  }
  return unknownType()
}

export function checkDotShorthand(state: CheckerState, expression: DotShorthand, expected: ResolvedType | null): ResolvedType {
  if expected == null { return finish(state, expression, unknownType()) }
  case expected! {
    enum_: EnumType -> {
      expression.resolvedShorthandOwnerName = enum_.name
      expression.resolvedShorthandOwnerKind = "enum"
      expression.resolvedShorthandOwnerModule = enum_.symbol.module
      return finish(state, expression, enum_)
    }
    class_: ClassType -> {
      expression.resolvedShorthandOwnerName = class_.name
      expression.resolvedShorthandOwnerKind = "class"
      expression.resolvedShorthandOwnerModule = class_.symbol.module
      return finish(state, expression, memberType(state, class_, expression.name, expression.span))
    }
    _ -> { }
  }
  return finish(state, expression, unknownType())
}

export function checkIdentifier(state: CheckerState, identifier: Identifier, scope: Scope): ResolvedType {
  let binding: Binding | null = lookup(scope, identifier.name)
  if binding == null && hasTypeParam(scope, identifier.name) {
    binding = Binding {
      name: identifier.name, kind: "type-parameter", type_: typeParameter(identifier.name, typeParamConstraintName(scope, identifier.name), typeParamConstraint(scope, identifier.name)), mutable: false,
      span: checkerSemanticSpan(identifier.span), module: state.info!.path,
    }
  }
  if binding == null { binding = implicitMethod(state, scope, identifier.name, identifier.span) }
  if binding == null && isBuiltinCallable(identifier.name) {
    binding = Binding { name: identifier.name, kind: "builtin", type_: builtinCallable(identifier.name), mutable: false, span: checkerSemanticSpan(identifier.span), module: state.info!.path }
  }
  if binding == null {
    typeError(state, "Unknown identifier '" + identifier.name + "'", identifier.span)
    return finish(state, identifier, unknownType())
  }
  identifier.resolvedBinding = binding
  return finish(state, identifier, binding.type_)
}

export function implicitMethod(state: CheckerState, scope: Scope, name: string, span: SourceSpan): Binding | null {
  case currentThisType(scope) {
    owner: ClassType -> {
      declaration := declarationFor(state.result, owner.symbol)
      if declaration == null { return null }
      case declaration! {
        class_: ClassDeclaration -> {
          for method of class_.methods {
            if method.name == name {
              methodType := method.resolvedType ?? checkFunction(state, method, scope, owner)
              return Binding {
                name, kind: "method", type_: methodType, mutable: false,
                span: checkerSemanticSpan(span), module: state.info!.path, symbol: owner.symbol,
              }
            }
          }
        }
        _ -> { }
      }
    }
    _ -> { }
  }
  return null
}

export function addClassMethods(state: CheckerState, scope: Scope, owner: ClassType): void {
  declaration := declarationFor(state.result, owner.symbol)
  if declaration == null { return }
  case declaration! {
    class_: ClassDeclaration -> {
      for method of class_.methods {
        let methodType: ResolvedType = unknownType()
        if method.resolvedType != null {
          methodType = method.resolvedType!
        } else {
          // Predeclare methods without decorating their annotations.  This
          // helper runs while another method is being checked, so its scope
          // does not contain the method's own type parameters.  The owning
          // method check is the authority that decorates those annotations.
          let methodTypeParams: string[] = []
          for typeParam of class_.typeParams { methodTypeParams.push(typeParam) }
          for typeParam of method.typeParams { methodTypeParams.push(typeParam) }
          let parameters: FunctionParamType[] = []
          for parameter of method.params {
            parameterType := if parameter.type_ == null then unknownType() else resolveAnnotation(parameter.type_!, state.info!, state.result, methodTypeParams)
            parameters.push(FunctionParamType { name: parameter.name, type_: parameterType, hasDefault: parameter.defaultValue != null })
          }
          returnType := if method.returnType == null then unknownType() else resolveAnnotation(method.returnType!, state.info!, state.result, methodTypeParams)
          methodType = functionType(parameters, returnType, method.typeParams)
        }
        declare(scope, Binding {
          name: method.name, kind: "method", type_: methodType, mutable: false,
          span: checkerSemanticSpan(method.span), module: state.info!.path, symbol: owner.symbol,
        })
      }
    }
    _ -> { }
  }
}

export function checkBinary(state: CheckerState, expression: BinaryExpression, scope: Scope): ResolvedType {
  let left: ResolvedType = unknownType()
  let right: ResolvedType = unknownType()
  case expression.left {
    _: DotShorthand -> {
      right = checkExpression(state, expression.right, scope, null)
      left = checkExpression(state, expression.left, scope, optionalResolvedType(right))
    }
    _ -> {
      case expression.right {
        _: DotShorthand -> {
          left = checkExpression(state, expression.left, scope, null)
          shorthandExpected := if expression.operator == "??" then nonNullType(state, left) else left
          right = checkExpression(state, expression.right, scope, optionalResolvedType(shorthandExpected))
        }
        _ -> {
          left = checkExpression(state, expression.left, scope, null)
          right = checkExpression(state, expression.right, scope, null)
        }
      }
    }
  }
  operator := expression.operator
  if operator == "&&" || operator == "||" {
    requireBool(state, left, expression.left.span); requireBool(state, right, expression.right.span)
    return finish(state, expression, primitive("bool"))
  }
  if operator == "??" {
    return finish(state, expression, coalescedType(state, left, right))
  }
  if operator == "..<" || operator == ".." {
    validateRangeOperand(state, operator, "left", left, expression.left.span)
    validateRangeOperand(state, operator, "right", right, expression.right.span)
    return finish(state, expression, rangeType())
  }
  if operator == "==" || operator == "!=" || operator == "<" || operator == "<=" || operator == ">" || operator == ">=" {
    return finish(state, expression, primitive("bool"))
  }
  if operator == "+" && typeName(left) == "string" && (typeName(right) == "string" || typeName(right) == "char" || typeName(right) == "unknown") { return finish(state, expression, primitive("string")) }
  if operator == "+" && typeName(right) == "string" && (typeName(left) == "char" || typeName(left) == "unknown") { return finish(state, expression, primitive("string")) }
  if isNumeric(left) && isNumeric(right) { return finish(state, expression, numericResult(left, right)) }
  typeError(state, "Operator '" + operator + "' is not defined for " + typeName(left) + " and " + typeName(right), expression.span)
  return finish(state, expression, unknownType())
}

function validateRangeOperand(state: CheckerState, operator: string, side: string, operand: ResolvedType, span: SourceSpan): void {
  if operand.kind == "unknown" { return }
  case operand {
    primitive_: PrimitiveType -> {
      if primitive_.name != "byte" && primitive_.name != "int" && primitive_.name != "long" {
        typeError(state, "Range operator \"" + operator + "\" requires integer bounds, got " + side + " bound of type \"" + typeName(operand) + "\"", span)
      } else if primitive_.name == "long" {
        typeError(state, "Range operator \"" + operator + "\" currently requires int-compatible bounds, got " + side + " bound of type \"long\"", span)
      }
    }
    _ -> { typeError(state, "Range operator \"" + operator + "\" requires integer bounds, got " + side + " bound of type \"" + typeName(operand) + "\"", span) }
  }
}

export function coalescedType(state: CheckerState, left: ResolvedType, right: ResolvedType): ResolvedType {
  case left {
    union_: UnionResolvedType -> {
      let nonNull: ResolvedType | null = null
      for member of union_.types {
        if member.kind != "null" {
          nonNull = if nonNull == null then member else joinTypes(nonNull!, member)
        }
      }
      if nonNull == null { return right }
      return joinTypes(nonNull!, right)
    }
    _: NullType -> { return right }
    _ -> { return left }
  }
  return unknownType()
}

export function checkUnary(state: CheckerState, expression: UnaryExpression, scope: Scope): ResolvedType {
  value := checkExpression(state, expression.operand, scope, null)
  // Keep the operand decoration explicit at this boundary.  The emitter
  // consumes the operand node later, and must not reconstruct its type from
  // the unary state.result (notably for try! over imported Result functions).
        expression.operand.resolvedType = optionalResolvedType(value)
  if expression.operator == "try!" || expression.operator == "try?" {
    case value {
      result: ResultResolvedType -> {
        if result.valueType.kind == "void" {
          if expression.operator == "try?" { typeError(state, "try? requires a Result with a success value", expression.span) }
          return finish(state, expression, result.valueType)
        }
        if expression.operator == "try?" { return finish(state, expression, unionType([result.valueType, nullType()])) }
        return finish(state, expression, result.valueType)
      }
      _ -> { typeError(state, expression.operator + " requires a Result expression", expression.span) }
    }
    return finish(state, expression, unknownType())
  }
  if !expression.prefix && expression.operator == "!" {
    case value {
      result: ResultResolvedType -> { return finish(state, expression, result.valueType) }
      _ -> { }
    }
    return finish(state, expression, nonNullType(state, value))
  }
  if expression.operator == "!" { requireBool(state, value, expression.span); return finish(state, expression, primitive("bool")) }
  if expression.operator == "+" || expression.operator == "-" || expression.operator == "~" {
    if !isNumeric(value) { typeError(state, "Unary '" + expression.operator + "' requires a numeric operand", expression.span) }
    return finish(state, expression, value)
  }
  return finish(state, expression, value)
}

/** Validates checked narrowing and preserves its fallible Result shape. */
export function checkAs(state: CheckerState, expression: AsExpression, scope: Scope): ResolvedType {
  sourceType := checkExpression(state, expression.expression, scope, null)
  targetType := resolveType(state, expression.targetType, state.info!, scope)
  case sourceType {
    result: ResultResolvedType -> {
      if !isValidAsNarrow(state, result.valueType, targetType) {
        typeError(state, "Cannot narrow \"" + typeName(sourceType) + "\" to \"" + typeName(targetType) + "\" with \"as\"", expression.span)
        return finish(state, expression, unknownType())
      }
      return finish(state, expression, resultType(targetType, unionType([result.errorType, primitive("string")])))
    }
    _ -> { }
  }
  if !isValidAsNarrow(state, sourceType, targetType) {
    typeError(state, "Cannot narrow \"" + typeName(sourceType) + "\" to \"" + typeName(targetType) + "\" with \"as\"", expression.span)
    return finish(state, expression, unknownType())
  }
  return finish(state, expression, resultType(targetType, primitive("string")))
}

export function isValidAsNarrow(state: CheckerState, source: ResolvedType, target: ResolvedType): bool {
  if sameType(source, target) { return true }
  if isNumeric(source) && isNumeric(target) { return true }
  case source {
    _: JsonValueResolvedType -> { return isJsonAsTarget(state, target) }
    union_: UnionResolvedType -> {
      for member of union_.types { if isValidAsNarrow(state, member, target) { return true } }
    }
    _: InterfaceType -> {
      case target {
        _: ClassType -> { return true }
        _ -> { }
      }
    }
    _ -> { }
  }
  return false
}

export function isJsonAsTarget(state: CheckerState, target: ResolvedType): bool {
  case target {
    primitiveType: PrimitiveType -> {
      return primitiveType.name == "bool" || primitiveType.name == "string" || isNumeric(primitiveType)
    }
    array: ArrayResolvedType -> { return isJsonValueType(array.elementType) }
    map: MapResolvedType -> { return sameType(map.keyType, primitive("string")) && isJsonValueType(map.valueType) }
    _: JsonValueResolvedType -> { return true }
    _ -> { return false }
  }
  return false
}

export function nonNullType(state: CheckerState, value: ResolvedType): ResolvedType {
  case value {
    union_: UnionResolvedType -> {
      let members: ResolvedType[] = []
      for member of union_.types { if member.kind != "null" { members.push(member) } }
      if members.length == 1 { return members[0] }
      if members.length > 1 { return unionType(members) }
      return unknownType()
    }
    _: NullType -> { return unknownType() }
    _ -> { return value }
  }
  return unknownType()
}

export function hasNullMember(state: CheckerState, value: UnionResolvedType): bool {
  for member of value.types { if member.kind == "null" { return true } }
  return false
}

export function checkAssignment(state: CheckerState, expression: AssignmentExpression, scope: Scope): ResolvedType {
  targetType := checkExpression(state, expression.target, scope, null)
  // Assignment emission needs the target decoration to choose representation
  // conversions, especially when a member is a nullable AST union field.
  finish(state, expression.target, targetType)
  case expression.target {
    identifier: Identifier -> {
      binding := lookup(scope, identifier.name)
      if binding != null {
        identifier.resolvedBinding = binding
        identifier.resolvedType = optionalResolvedType(binding!.type_)
      }
    }
    _ -> { }
  }
  value := checkExpression(state, expression.value, scope, optionalResolvedType(targetType))
  case expression.target {
    identifier: Identifier -> {
      target := lookup(scope, identifier.name)
      if target == null { typeError(state, "Unknown assignment target '" + identifier.name + "'", identifier.span) }
      else {
        if !target!.mutable { typeError(state, "Cannot assign to immutable binding '" + identifier.name + "'", identifier.span) }
        if expression.operator == "=" && !isAssignable(value, target!.type_) { typeError(state, "Cannot assign " + typeName(value) + " to " + typeName(target!.type_), expression.span) }
      }
    }
    index: IndexExpression -> {
      objectType := checkExpression(state, index.object, scope, null)
      case objectType {
        array: ArrayResolvedType -> {
          checkExpression(state, index.index, scope, optionalResolvedType(primitive("int")))
          if array.readonly_ { typeError(state, "Cannot assign through readonly array", expression.span) }
          if expression.operator == "=" && !isAssignable(value, array.elementType) { typeError(state, "Cannot assign " + typeName(value) + " to " + typeName(array.elementType), expression.span) }
        }
        map: MapResolvedType -> {
          key := checkExpression(state, index.index, scope, optionalResolvedType(map.keyType))
          if !isAssignable(key, map.keyType) { typeError(state, "Cannot use " + typeName(key) + " as map key " + typeName(map.keyType), index.index.span) }
          if map.readonly_ { typeError(state, "Cannot assign through readonly map", expression.span) }
          if expression.operator == "=" && !isAssignable(value, map.valueType) { typeError(state, "Cannot assign " + typeName(value) + " to " + typeName(map.valueType), expression.span) }
        }
        _ -> { typeError(state, "Index assignment requires an array or map", expression.span) }
      }
    }
    member: MemberExpression -> {
      checkExpression(state, member.object, scope, null)
      targetType := memberType(state, checkExpression(state, member.object, scope, null), member.property, member.span)
      if expression.operator == "=" && !isAssignable(value, targetType) { typeError(state, "Cannot assign " + typeName(value) + " to " + typeName(targetType), expression.span) }
    }
    _ -> { typeError(state, "Assignment target must be a binding", expression.target.span) }
  }
  return finish(state, expression, value)
}
