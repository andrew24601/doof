// Graph-wide decorated-AST validation before emission.

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
  YieldStatement, YieldBlockExpression, YieldBlockAssignmentStatement, CatchExpression, CaseArm, CaseExpression, CasePattern, CaseStatement, RangePattern, TypePattern, ValuePattern, WildcardPattern,
  TryStatement,
  AsyncExpression, RetireExpression, ActorCreationExpression, Parameter, WeakType, TypeParameterConstraint,
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


import { optionalResolvedType } from "./checker-symbols"

export function validateCheckedTypes(result: AnalysisResult): Diagnostic[] {
  let diagnostics: Diagnostic[] = []
  for module of result.modules {
    for statement of module.program.statements { validateStatement(statement, module.path, diagnostics) }
  }
  return diagnostics
}

export function validateStatement(statement: Statement, module: string, diagnostics: Diagnostic[]): void {
  case statement {
    const_: ConstDeclaration -> { validateValue(const_, const_.resolvedType, const_.type_, module, diagnostics); validateExpression(const_.value, module, diagnostics) }
    readonly_: ReadonlyDeclaration -> { validateValue(readonly_, readonly_.resolvedType, readonly_.type_, module, diagnostics); validateExpression(readonly_.value, module, diagnostics) }
    binding: ImmutableBinding -> {
      validateValue(binding, binding.resolvedType, binding.type_, module, diagnostics)
      validateExpression(binding.value, module, diagnostics)
      if binding.else_ != null { validateBlock(binding.else_!, module, diagnostics) }
    }
    let_: LetDeclaration -> { validateValue(let_, let_.resolvedType, let_.type_, module, diagnostics); validateExpression(let_.value, module, diagnostics) }
    fn: FunctionDeclaration -> { validateFunction(fn, module, diagnostics) }
    class_: ClassDeclaration -> {
      if class_.resolvedSymbol == null { addValidationError(module, class_.span, "Class '" + class_.name + "' has no resolved symbol", diagnostics) }
      validateTypeParameterConstraints(class_.typeParamConstraints, module, diagnostics)
      for implementation of class_.implements_ { validateTypeAnnotation(implementation, module, diagnostics) }
      for field of class_.fields {
        if field.type_ != null { validateTypeAnnotation(field.type_!, module, diagnostics) }
        validateResolved(field.resolvedType, field.span, module, "field " + class_.name, diagnostics)
        if field.defaultValue != null { validateExpression(field.defaultValue!, module, diagnostics) }
      }
      for method of class_.methods { validateFunction(method, module, diagnostics) }
    }
    interface_: InterfaceDeclaration -> {
      if interface_.resolvedSymbol == null { addValidationError(module, interface_.span, "Interface '" + interface_.name + "' has no resolved symbol", diagnostics) }
      validateTypeParameterConstraints(interface_.typeParamConstraints, module, diagnostics)
      for field of interface_.fields {
        validateTypeAnnotation(field.type_, module, diagnostics)
        validateResolved(field.resolvedType, field.span, module, "interface field " + interface_.name, diagnostics)
      }
      for method of interface_.methods { validateFunction(method, module, diagnostics) }
    }
    enum_: EnumDeclaration -> { for variant of enum_.variants { if variant.value != null { validateExpression(variant.value!, module, diagnostics) } } }
    alias: TypeAliasDeclaration -> {
      validateTypeParameterConstraints(alias.typeParamConstraints, module, diagnostics)
      validateTypeAnnotation(alias.type_, module, diagnostics)
      validateResolved(alias.resolvedType, alias.span, module, "type alias " + alias.name, diagnostics)
    }
    if_: IfStatement -> {
      validateExpression(if_.condition, module, diagnostics); validateBlock(if_.body, module, diagnostics)
      for branch of if_.elseIfs { validateExpression(branch.condition, module, diagnostics); validateBlock(branch.body, module, diagnostics) }
      if if_.else_ != null { validateBlock(if_.else_!, module, diagnostics) }
    }
    case_: CaseStatement -> {
      validateExpression(case_.subject, module, diagnostics)
      for arm of case_.arms {
        for pattern of arm.patterns { validatePattern(pattern, module, diagnostics) }
        case arm.body {
          block: Block -> { validateBlock(block, module, diagnostics) }
          expression: Expression -> { validateExpression(expression, module, diagnostics) }
        }
      }
    }
    while_: WhileStatement -> { validateExpression(while_.condition, module, diagnostics); validateBlock(while_.body, module, diagnostics); if while_.then_ != null { validateBlock(while_.then_!, module, diagnostics) } }
    for_: ForStatement -> {
      if for_.init != null { validateStatement(for_.init!, module, diagnostics) }
      if for_.condition != null { validateExpression(for_.condition!, module, diagnostics) }
      for update of for_.update { validateExpression(update, module, diagnostics) }
      validateBlock(for_.body, module, diagnostics); if for_.then_ != null { validateBlock(for_.then_!, module, diagnostics) }
    }
    forOf: ForOfStatement -> { validateExpression(forOf.iterable, module, diagnostics); validateBlock(forOf.body, module, diagnostics); if forOf.then_ != null { validateBlock(forOf.then_!, module, diagnostics) } }
    with_: WithStatement -> {
      for binding of with_.bindings {
        if binding.type_ != null { validateTypeAnnotation(binding.type_!, module, diagnostics) }
        validateResolved(binding.resolvedType, binding.span, module, "with binding " + binding.name, diagnostics)
        validateExpression(binding.value, module, diagnostics)
      }
      validateBlock(with_.body, module, diagnostics)
    }
    return_: ReturnStatement -> { if return_.value != null { validateExpression(return_.value!, module, diagnostics) } }
    yield_: YieldStatement -> { validateExpression(yield_.value, module, diagnostics) }
    assignment: YieldBlockAssignmentStatement -> { validateExpression(assignment.value, module, diagnostics); validateResolved(assignment.resolvedType, assignment.span, module, "yield-block assignment", diagnostics) }
    expression: ExpressionStatement -> { validateExpression(expression.expression, module, diagnostics) }
    destructuring: DestructuringStatement -> { validateExpression(destructuring.value, module, diagnostics) }
    try_: TryStatement -> {
      case try_.binding {
        declaration: ConstDeclaration -> { validateStatement(declaration, module, diagnostics) }
        declaration: ReadonlyDeclaration -> { validateStatement(declaration, module, diagnostics) }
        binding: ImmutableBinding -> { validateStatement(binding, module, diagnostics) }
        declaration: LetDeclaration -> { validateStatement(declaration, module, diagnostics) }
        expression: ExpressionStatement -> { validateStatement(expression, module, diagnostics) }
        destructuring: DestructuringStatement -> { validateStatement(destructuring, module, diagnostics) }
      }
    }
    export_: ExportDeclaration -> { validateStatement(export_.declaration, module, diagnostics) }
    block: Block -> { validateBlock(block, module, diagnostics) }
    _ -> { }
  }
}

export function validateValue(statement: Statement, resolvedType: ResolvedType | null, annotation: TypeAnnotation | null, module: string, diagnostics: Diagnostic[]): void {
  if annotation != null { validateTypeAnnotation(annotation!, module, diagnostics) }
  validateResolved(resolvedType, statement.span, module, "value", diagnostics)
}

export function validateFunction(fn: FunctionDeclaration, module: string, diagnostics: Diagnostic[]): void {
  validateResolved(fn.resolvedType, fn.span, module, "function " + fn.name, diagnostics)
  validateTypeParameterConstraints(fn.typeParamConstraints, module, diagnostics)
  if fn.returnType != null { validateTypeAnnotation(fn.returnType!, module, diagnostics) }
  for parameter of fn.params {
    if parameter.type_ != null { validateTypeAnnotation(parameter.type_!, module, diagnostics) }
    validateResolved(parameter.resolvedType, parameter.span, module, "parameter " + parameter.name, diagnostics)
    if parameter.defaultValue != null { validateExpression(parameter.defaultValue!, module, diagnostics) }
  }
  case fn.body {
    block: Block -> { validateBlock(block, module, diagnostics) }
    expression: Expression -> { validateExpression(expression, module, diagnostics) }
  }
}

function validateTypeParameterConstraints(constraints: TypeParameterConstraint[], module: string, diagnostics: Diagnostic[]): void {
  for constraint of constraints {
    if constraint.type_ == null { continue }
    case constraint.type_! {
      named: NamedType -> {
        if named.typeArgs.length == 0 && (named.name == "JsonSerializable" || named.name == "Reflectable") { continue }
      }
      _ -> { }
    }
    validateTypeAnnotation(constraint.type_!, module, diagnostics)
  }
}

export function validateBlock(block: Block, module: string, diagnostics: Diagnostic[]): void {
  for statement of block.statements { validateStatement(statement, module, diagnostics) }
}

export function validatePattern(pattern: CasePattern, module: string, diagnostics: Diagnostic[]): void {
  case pattern {
    type_: TypePattern -> { validateTypeAnnotation(type_.type_, module, diagnostics); validateResolved(type_.resolvedType, type_.span, module, "case pattern", diagnostics) }
    value: ValuePattern -> { validateExpression(value.value, module, diagnostics) }
    range: RangePattern -> {
      if range.start != null { validateExpression(range.start!, module, diagnostics) }
      if range.end != null { validateExpression(range.end!, module, diagnostics) }
    }
    _: WildcardPattern -> { }
  }
}

export function validateExpression(expression: Expression, module: string, diagnostics: Diagnostic[]): void {
  validateResolved(expression.resolvedType, expression.span, module, "expression " + expression.kind, diagnostics)
  case expression {
    string_: StringLiteral -> { for interpolation of string_.interpolations { validateExpression(interpolation, module, diagnostics) } }
    binary: BinaryExpression -> { validateExpression(binary.left, module, diagnostics); validateExpression(binary.right, module, diagnostics) }
    unary: UnaryExpression -> { validateExpression(unary.operand, module, diagnostics) }
    assignment: AssignmentExpression -> { validateExpression(assignment.target, module, diagnostics); validateExpression(assignment.value, module, diagnostics) }
    member: MemberExpression -> { validateExpression(member.object, module, diagnostics) }
    index: IndexExpression -> { validateExpression(index.object, module, diagnostics); validateExpression(index.index, module, diagnostics) }
    call: CallExpression -> {
      validateExpression(call.callee, module, diagnostics)
      for argument of call.typeArgs { validateTypeAnnotation(argument, module, diagnostics) }
      for argument of call.resolvedGenericTypeArgs { validateResolved(optionalResolvedType(argument), call.span, module, "generic call argument", diagnostics) }
      for argument of call.args { validateExpression(argument.value, module, diagnostics) }
    }
    array: ArrayLiteral -> { for item of array.elements { validateExpression(item, module, diagnostics) } }
    object: ObjectLiteral -> {
      if object.spread != null { validateExpression(object.spread!, module, diagnostics) }
      for property of object.properties {
        validateResolved(property.resolvedType, property.span, module, "object property", diagnostics)
        if property.key != null { validateExpression(property.key!, module, diagnostics) }
        if property.value != null { validateExpression(property.value!, module, diagnostics) }
      }
      if object.resolvedType != null {
        case object.resolvedType! {
          _: ClassType -> {
            if object.resolvedClass == null { addValidationError(module, object.span, "Class object literal has no resolved class", diagnostics) }
          }
          _ -> { }
        }
      }
    }
    tuple: TupleLiteral -> { for item of tuple.elements { validateExpression(item, module, diagnostics) } }
    lambda: LambdaExpression -> {
      if lambda.returnType != null { validateTypeAnnotation(lambda.returnType!, module, diagnostics) }
      for parameter of lambda.params {
        if parameter.type_ != null { validateTypeAnnotation(parameter.type_!, module, diagnostics) }
        validateResolved(parameter.resolvedType, parameter.span, module, "lambda parameter", diagnostics)
        if parameter.defaultValue != null { validateExpression(parameter.defaultValue!, module, diagnostics) }
      }
      case lambda.body {
        block: Block -> { validateBlock(block, module, diagnostics) }
        expression: Expression -> { validateExpression(expression, module, diagnostics) }
      }
    }
    if_: IfExpression -> { validateExpression(if_.condition, module, diagnostics); validateExpression(if_.then_, module, diagnostics); validateExpression(if_.else_, module, diagnostics) }
    case_: CaseExpression -> {
      validateExpression(case_.subject, module, diagnostics); validateResolved(case_.resolvedType, case_.span, module, "case expression", diagnostics)
      for arm of case_.arms {
        for pattern of arm.patterns { validatePattern(pattern, module, diagnostics) }
        case arm.body {
          block: Block -> { validateBlock(block, module, diagnostics) }
          bodyExpression: Expression -> { validateExpression(bodyExpression, module, diagnostics) }
        }
      }
    }
    yieldBlock: YieldBlockExpression -> { validateBlock(yieldBlock.body, module, diagnostics) }
    catch_: CatchExpression -> { validateBlock(catch_.body, module, diagnostics) }
    construct: ConstructExpression -> {
      if construct.type_ != "Success" && construct.type_ != "Failure" {
        validateResolved(construct.resolvedConstructedType, construct.span, module, "constructed type", diagnostics)
        if construct.resolvedClass == null { addValidationError(module, construct.span, "Construction of '" + construct.type_ + "' has no resolved class", diagnostics) }
        else {
          constructor := classConstructor(construct.resolvedClass!)
          if constructor != null && construct.resolvedConstructor == null && !spanInsideFunction(construct.span, constructor!) {
            addValidationError(module, construct.span, "Construction of '" + construct.type_ + "' has no resolved constructor", diagnostics)
          }
        }
      }
      if construct.resolvedConstructor != null {
        validateResolved(construct.resolvedConstructor!.resolvedType, construct.span, module, "constructor " + construct.type_, diagnostics)
      }
      for argument of construct.typeArgs { validateTypeAnnotation(argument, module, diagnostics) }
      for property of construct.args {
        validateResolved(property.resolvedType, property.span, module, "constructor property", diagnostics)
        if property.value != null { validateExpression(property.value!, module, diagnostics) }
      }
    }
    async_: AsyncExpression -> {
      case async_.expression {
        block: Block -> { validateBlock(block, module, diagnostics) }
        inner: Expression -> { validateExpression(inner, module, diagnostics) }
      }
    }
    retire_: RetireExpression -> { validateExpression(retire_.actor, module, diagnostics) }
    actor: ActorCreationExpression -> { for argument of actor.args { validateExpression(argument, module, diagnostics) } }
    as_: AsExpression -> { validateExpression(as_.expression, module, diagnostics); validateTypeAnnotation(as_.targetType, module, diagnostics) }
    identifier: Identifier -> {
      if identifier.resolvedBinding == null { addValidationError(module, identifier.span, "Identifier '" + identifier.name + "' has no resolved binding", diagnostics) }
      else { validateResolved(identifier.resolvedBinding!.type_, identifier.span, module, "binding " + identifier.name, diagnostics) }
    }
    _ -> { }
  }
}

export function classConstructor(class_: ClassDeclaration): FunctionDeclaration | null {
  for method of class_.methods { if method.name == "constructor" { return method } }
  return null
}

export function spanInsideFunction(span: SourceSpan, fn: FunctionDeclaration): bool {
  case fn.body {
    block: Block -> { return span.start.offset >= block.span.start.offset && span.end.offset <= block.span.end.offset }
    expression: Expression -> { return span.start.offset >= expression.span.start.offset && span.end.offset <= expression.span.end.offset }
  }
  return false
}

export function validateTypeAnnotation(annotation: TypeAnnotation, module: string, diagnostics: Diagnostic[]): void {
  case annotation {
    named: NamedType -> {
      validateResolved(named.resolvedType, named.span, module, "type annotation", diagnostics)
      for argument of named.typeArgs { validateTypeAnnotation(argument, module, diagnostics) }
    }
    array: ArrayType -> {
      validateResolved(array.resolvedType, array.span, module, "type annotation", diagnostics)
      validateTypeAnnotation(array.elementType, module, diagnostics)
    }
    union: UnionType -> {
      validateResolved(union.resolvedType, union.span, module, "type annotation", diagnostics)
      for member of union.types { validateTypeAnnotation(member, module, diagnostics) }
    }
    function_: AstFunctionType -> {
      validateResolved(function_.resolvedType, function_.span, module, "type annotation", diagnostics)
      for parameter of function_.params { validateTypeAnnotation(parameter.type_, module, diagnostics) }
      validateTypeAnnotation(function_.returnType, module, diagnostics)
    }
    weak_: WeakType -> {
      validateResolved(weak_.resolvedType, weak_.span, module, "type annotation", diagnostics)
      validateTypeAnnotation(weak_.type_, module, diagnostics)
    }
  }
}

export function validateResolved(resolvedType: ResolvedType | null, span: SourceSpan, module: string, owner: string, diagnostics: Diagnostic[]): void {
  if resolvedType == null { addValidationError(module, span, "Missing resolved type for " + owner, diagnostics); return }
  case resolvedType! {
    _: UnknownType -> { addValidationError(module, span, "Unknown resolved type for " + owner, diagnostics) }
    class_: ClassType -> { for argument of class_.typeArgs { validateResolved(argument, span, module, owner + " type argument", diagnostics) } }
    array: ArrayResolvedType -> { validateResolved(array.elementType, span, module, owner + " element", diagnostics) }
    map: MapResolvedType -> { validateResolved(map.keyType, span, module, owner + " key", diagnostics); validateResolved(map.valueType, span, module, owner + " value", diagnostics) }
    set_: SetResolvedType -> { validateResolved(set_.elementType, span, module, owner + " element", diagnostics) }
    stream: StreamResolvedType -> { validateResolved(stream.elementType, span, module, owner + " element", diagnostics) }
    result: ResultResolvedType -> { validateResolved(result.valueType, span, module, owner + " success", diagnostics); validateResolved(result.errorType, span, module, owner + " error", diagnostics) }
    actor: ActorType -> { validateResolved(optionalResolvedType(actor.innerClass), span, module, owner + " actor state", diagnostics) }
    promise: PromiseType -> { validateResolved(promise.valueType, span, module, owner + " promise value", diagnostics) }
    weak_: WeakResolvedType -> { validateResolved(weak_.inner, span, module, owner + " weak target", diagnostics) }
    tuple: TupleResolvedType -> { for item of tuple.elements { validateResolved(item, span, module, owner + " tuple element", diagnostics) } }
    union_: UnionResolvedType -> {
      if union_.types.length == 0 { addValidationError(module, span, "Empty resolved union for " + owner, diagnostics) }
      for member of union_.types { validateResolved(member, span, module, owner + " union member", diagnostics) }
    }
    function_: FunctionType -> {
      for parameter of function_.params { validateResolved(parameter.type_, span, module, owner + " parameter", diagnostics) }
      validateResolved(function_.returnType, span, module, owner + " return", diagnostics)
    }
    parameter: TypeParameterType -> { if parameter.constraint != null { validateResolved(parameter.constraint, span, module, owner + " constraint", diagnostics) } }
    _ -> { }
  }
}

export function addValidationError(module: string, span: SourceSpan, message: string, diagnostics: Diagnostic[]): void {
  diagnostics.push(Diagnostic { severity: "error", message: message + " at " + string(span.start.line) + ":" + string(span.start.column), span: checkerSemanticSpan(span), module })
}

export function checkerSemanticSpan(span: SourceSpan): SemanticSpan {
  return SemanticSpan {
    start: SemanticLocation { line: span.start.line, column: span.start.column, offset: span.start.offset },
    end: SemanticLocation { line: span.end.line, column: span.end.column, offset: span.end.offset },
  }
}
