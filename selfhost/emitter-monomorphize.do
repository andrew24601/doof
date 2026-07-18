// Whole-program discovery of concrete Doof generic instantiations.
//
// The checker decorates calls and nominal types with inferred type arguments.
// This pass follows those decorations to a fixed point before header planning,
// so C++ emission never delegates Doof specialization to C++ templates.

import {
  ActorCreationExpression, ArrayLiteral, AssignmentExpression, AsyncExpression, BinaryExpression, Block, CallExpression, CaseExpression, CaseStatement,
  ClassDeclaration, ClassField, ConstDeclaration, ConstructExpression, DestructuringStatement, ExportDeclaration, Expression,
  ExpressionStatement, ForOfStatement, ForStatement, FunctionDeclaration, Identifier, IfExpression, IfStatement,
  ImmutableBinding, IndexExpression, InterfaceDeclaration, LambdaExpression, LetDeclaration, MemberExpression, ObjectLiteral, Program,
  ReadonlyDeclaration, RetireExpression, ReturnStatement, Statement, StringLiteral, TryStatement, TupleLiteral, UnaryExpression,
  WhileStatement, WithStatement, YieldStatement, YieldBlockExpression, YieldBlockAssignmentStatement, CatchExpression,
} from "./ast"
import { AnalysisResult, ModuleInfo } from "./analyzer"
import { isAssignable, sameType, substituteTypeParams, typeName } from "./checker-types"
import {
  ActorType, ArrayResolvedType, ClassType, FunctionType, InterfaceType, MapResolvedType, PromiseType, ResolvedType, ResultResolvedType, SetResolvedType,
  StreamResolvedType, TupleResolvedType, TypeParameterType, TypeSubstitution, UnionResolvedType, WeakResolvedType,
} from "./semantic"
import { moduleNamespace } from "./emitter-names"

export class FunctionInstantiation {
  key: string
  modulePath: string
  declaration: FunctionDeclaration
  substitution: TypeSubstitution
  emittedName: string
  trace: string[] = []
}

export class ClassInstantiation {
  key: string
  modulePath: string
  declaration: ClassDeclaration
  substitution: TypeSubstitution
  emittedName: string
  trace: string[] = []
}

export class InterfaceInstantiation {
  key: string
  modulePath: string
  name: string
  substitution: TypeSubstitution
  emittedName: string
  implementations: ImplementationRef[] = []
}

export class ImplementationRef {
  modulePath: string
  typeName: string
}

export class MethodInstantiation {
  key: string
  modulePath: string
  ownerKey: string
  owner: ClassDeclaration
  declaration: FunctionDeclaration
  substitution: TypeSubstitution
  emittedName: string
  trace: string[] = []
}

export class InstantiationPlan {
  functions: FunctionInstantiation[] = []
  classes: ClassInstantiation[] = []
  interfaces: InterfaceInstantiation[] = []
  methods: MethodInstantiation[] = []
  overflow: bool = false
  overflowTrace: string[] = []
  currentTrace: string[] = []
  nativeTemplateClassKeys: string[] = []
}

export function buildInstantiationPlan(result: AnalysisResult): InstantiationPlan {
  plan := InstantiationPlan {}
  discoverNativeTemplateClasses(result, plan)
  for module of result.modules {
    for statement of module.program.statements { collectStatement(statement, module.path, result, plan, [], []) }
  }

  let functionIndex = 0
  let classIndex = 0
  let methodIndex = 0
  while functionIndex < plan.functions.length || classIndex < plan.classes.length || methodIndex < plan.methods.length {
    if plan.functions.length + plan.classes.length + plan.methods.length > 256 {
      plan.overflow = true
      for item of plan.currentTrace { plan.overflowTrace.push(item) }
      return plan
    }
    if functionIndex < plan.functions.length {
      instantiation := plan.functions[functionIndex]
      functionIndex = functionIndex + 1
      plan.currentTrace = instantiation.trace
      collectFunctionBody(instantiation.declaration, instantiation.modulePath, result, plan,
        instantiation.substitution.names, instantiation.substitution.arguments)
    }
    if classIndex < plan.classes.length {
      instantiation := plan.classes[classIndex]
      classIndex = classIndex + 1
      plan.currentTrace = instantiation.trace
      collectClassBody(instantiation.declaration, instantiation.modulePath, result, plan,
        instantiation.substitution.names, instantiation.substitution.arguments)
    }
    if methodIndex < plan.methods.length {
      instantiation := plan.methods[methodIndex]
      methodIndex = methodIndex + 1
      plan.currentTrace = instantiation.trace
      collectFunctionBody(instantiation.declaration, instantiation.modulePath, result, plan,
        instantiation.substitution.names, instantiation.substitution.arguments)
    }
  }
  discoverConcreteInterfaceImplementations(result, plan)
  return plan
}

export function functionInstantiationKey(modulePath: string, name: string, typeArgs: ResolvedType[]): string {
  return modulePath + "::function::" + name + "::" + concreteTypeListKey(typeArgs)
}

export function classInstantiationKey(modulePath: string, name: string, typeArgs: ResolvedType[]): string {
  return modulePath + "::class::" + name + "::" + concreteTypeListKey(typeArgs)
}

export function interfaceInstantiationKey(modulePath: string, name: string, typeArgs: ResolvedType[]): string {
  return modulePath + "::interface::" + name + "::" + concreteTypeListKey(typeArgs)
}

export function methodInstantiationKey(ownerKey: string, name: string, typeArgs: ResolvedType[]): string {
  return ownerKey + "::method::" + name + "::" + concreteTypeListKey(typeArgs)
}

export function concreteName(name: string, typeArgs: ResolvedType[]): string {
  let result = name
  for argument of typeArgs { result = result + "__" + mangleType(argument) }
  return result
}

export function findConcreteFunctionName(plan: InstantiationPlan, key: string): string {
  for instantiation of plan.functions { if instantiation.key == key { return instantiation.emittedName } }
  return ""
}

export function findConcreteClassName(plan: InstantiationPlan, key: string): string {
  for instantiation of plan.classes { if instantiation.key == key { return instantiation.emittedName } }
  return ""
}

function collectFunctionBody(fn: FunctionDeclaration, modulePath: string, analysis: AnalysisResult, plan: InstantiationPlan, names: string[], arguments: ResolvedType[]): void {
  for parameter of fn.params {
    if parameter.resolvedType != null { collectType(specialize(parameter.resolvedType!, names, arguments), analysis, plan) }
    if parameter.defaultValue != null { collectExpression(parameter.defaultValue!, modulePath, analysis, plan, names, arguments) }
  }
  if fn.resolvedType != null { collectType(specialize(fn.resolvedType!, names, arguments), analysis, plan) }
  case fn.body {
    block: Block -> { for statement of block.statements { collectStatement(statement, modulePath, analysis, plan, names, arguments) } }
    expression: Expression -> { collectExpression(expression, modulePath, analysis, plan, names, arguments) }
  }
}

function collectClassBody(class_: ClassDeclaration, modulePath: string, analysis: AnalysisResult, plan: InstantiationPlan, names: string[], arguments: ResolvedType[]): void {
  for field of class_.fields {
    if field.resolvedType != null { collectType(specialize(field.resolvedType!, names, arguments), analysis, plan) }
    if field.defaultValue != null { collectExpression(field.defaultValue!, modulePath, analysis, plan, names, arguments) }
  }
  for method of class_.methods {
    // Non-generic methods are part of every concrete class body. Generic
    // methods are discovered from their concrete call sites.
    if method.typeParams.length == 0 { collectFunctionBody(method, modulePath, analysis, plan, names, arguments) }
  }
  if class_.destructor_ != null { collectBlock(class_.destructor_!, modulePath, analysis, plan, names, arguments) }
}

function collectStatement(statement: Statement, modulePath: string, analysis: AnalysisResult, plan: InstantiationPlan, names: string[], arguments: ResolvedType[]): void {
  case statement {
    const_: ConstDeclaration -> { collectOptionalType(const_.resolvedType, names, arguments, analysis, plan); collectExpression(const_.value, modulePath, analysis, plan, names, arguments) }
    readonly_: ReadonlyDeclaration -> { collectOptionalType(readonly_.resolvedType, names, arguments, analysis, plan); collectExpression(readonly_.value, modulePath, analysis, plan, names, arguments) }
    binding: ImmutableBinding -> {
      collectOptionalType(binding.resolvedType, names, arguments, analysis, plan)
      collectExpression(binding.value, modulePath, analysis, plan, names, arguments)
      if binding.else_ != null { collectBlock(binding.else_!, modulePath, analysis, plan, names, arguments) }
    }
    let_: LetDeclaration -> { collectOptionalType(let_.resolvedType, names, arguments, analysis, plan); collectExpression(let_.value, modulePath, analysis, plan, names, arguments) }
    fn: FunctionDeclaration -> { if fn.typeParams.length == 0 { collectFunctionBody(fn, modulePath, analysis, plan, names, arguments) } }
    class_: ClassDeclaration -> { if class_.typeParams.length == 0 { collectClassBody(class_, modulePath, analysis, plan, names, arguments) } }
    if_: IfStatement -> {
      collectExpression(if_.condition, modulePath, analysis, plan, names, arguments); collectBlock(if_.body, modulePath, analysis, plan, names, arguments)
      for branch of if_.elseIfs { collectExpression(branch.condition, modulePath, analysis, plan, names, arguments); collectBlock(branch.body, modulePath, analysis, plan, names, arguments) }
      if if_.else_ != null { collectBlock(if_.else_!, modulePath, analysis, plan, names, arguments) }
    }
    case_: CaseStatement -> {
      collectExpression(case_.subject, modulePath, analysis, plan, names, arguments)
      for arm of case_.arms {
        case arm.body {
          block: Block -> { collectBlock(block, modulePath, analysis, plan, names, arguments) }
          expression: Expression -> { collectExpression(expression, modulePath, analysis, plan, names, arguments) }
        }
      }
    }
    while_: WhileStatement -> { collectExpression(while_.condition, modulePath, analysis, plan, names, arguments); collectBlock(while_.body, modulePath, analysis, plan, names, arguments); if while_.then_ != null { collectBlock(while_.then_!, modulePath, analysis, plan, names, arguments) } }
    for_: ForStatement -> {
      if for_.init != null { collectStatement(for_.init!, modulePath, analysis, plan, names, arguments) }
      if for_.condition != null { collectExpression(for_.condition!, modulePath, analysis, plan, names, arguments) }
      for update of for_.update { collectExpression(update, modulePath, analysis, plan, names, arguments) }
      collectBlock(for_.body, modulePath, analysis, plan, names, arguments); if for_.then_ != null { collectBlock(for_.then_!, modulePath, analysis, plan, names, arguments) }
    }
    forOf: ForOfStatement -> { collectExpression(forOf.iterable, modulePath, analysis, plan, names, arguments); collectBlock(forOf.body, modulePath, analysis, plan, names, arguments); if forOf.then_ != null { collectBlock(forOf.then_!, modulePath, analysis, plan, names, arguments) } }
    with_: WithStatement -> {
      for binding of with_.bindings { collectExpression(binding.value, modulePath, analysis, plan, names, arguments) }
      collectBlock(with_.body, modulePath, analysis, plan, names, arguments)
    }
    return_: ReturnStatement -> { if return_.value != null { collectExpression(return_.value!, modulePath, analysis, plan, names, arguments) } }
    yield_: YieldStatement -> { collectExpression(yield_.value, modulePath, analysis, plan, names, arguments) }
    expression: ExpressionStatement -> { collectExpression(expression.expression, modulePath, analysis, plan, names, arguments) }
    destructuring: DestructuringStatement -> { collectExpression(destructuring.value, modulePath, analysis, plan, names, arguments) }
    try_: TryStatement -> {
      case try_.binding {
        declaration: ConstDeclaration -> { collectStatement(declaration, modulePath, analysis, plan, names, arguments) }
        declaration: ReadonlyDeclaration -> { collectStatement(declaration, modulePath, analysis, plan, names, arguments) }
        binding: ImmutableBinding -> { collectStatement(binding, modulePath, analysis, plan, names, arguments) }
        declaration: LetDeclaration -> { collectStatement(declaration, modulePath, analysis, plan, names, arguments) }
        expression: ExpressionStatement -> { collectStatement(expression, modulePath, analysis, plan, names, arguments) }
        destructuring: DestructuringStatement -> { collectStatement(destructuring, modulePath, analysis, plan, names, arguments) }
      }
    }
    assignment: YieldBlockAssignmentStatement -> { collectExpression(assignment.value, modulePath, analysis, plan, names, arguments) }
    export_: ExportDeclaration -> { collectStatement(export_.declaration, modulePath, analysis, plan, names, arguments) }
    block: Block -> { collectBlock(block, modulePath, analysis, plan, names, arguments) }
    _ -> { }
  }
}

function collectBlock(block: Block, modulePath: string, analysis: AnalysisResult, plan: InstantiationPlan, names: string[], arguments: ResolvedType[]): void {
  for statement of block.statements { collectStatement(statement, modulePath, analysis, plan, names, arguments) }
}

function collectExpression(expression: Expression, modulePath: string, analysis: AnalysisResult, plan: InstantiationPlan, names: string[], arguments: ResolvedType[]): void {
  if expression.resolvedType != null { collectType(specialize(expression.resolvedType!, names, arguments), analysis, plan) }
  case expression {
    string_: StringLiteral -> { for interpolation of string_.interpolations { collectExpression(interpolation, modulePath, analysis, plan, names, arguments) } }
    binary: BinaryExpression -> { collectExpression(binary.left, modulePath, analysis, plan, names, arguments); collectExpression(binary.right, modulePath, analysis, plan, names, arguments) }
    unary: UnaryExpression -> { collectExpression(unary.operand, modulePath, analysis, plan, names, arguments) }
    assignment: AssignmentExpression -> { collectExpression(assignment.target, modulePath, analysis, plan, names, arguments); collectExpression(assignment.value, modulePath, analysis, plan, names, arguments) }
    member: MemberExpression -> { collectExpression(member.object, modulePath, analysis, plan, names, arguments) }
    index: IndexExpression -> { collectExpression(index.object, modulePath, analysis, plan, names, arguments); collectExpression(index.index, modulePath, analysis, plan, names, arguments) }
    call: CallExpression -> {
      collectExpression(call.callee, modulePath, analysis, plan, names, arguments)
      for argument of call.args { collectExpression(argument.value, modulePath, analysis, plan, names, arguments) }
      if call.resolvedFunction != null && (call.resolvedFunction!.typeParams.length > 0 || call.resolvedFunction!.native_) {
        let concreteArgs: ResolvedType[] = []
        for argument of call.resolvedGenericTypeArgs { concreteArgs.push(specialize(argument, names, arguments)) }
        if !containsTypeParameters(concreteArgs) {
          let recordedMethod = false
          case call.callee {
            member: MemberExpression -> {
              if member.object.resolvedType != null {
                case specialize(member.object.resolvedType!, names, arguments) {
                  ownerType: ClassType -> {
                    owner := classDeclaration(analysis, ownerType.symbol.module, ownerType.symbol.name)
                    if owner != null && call.resolvedFunction!.typeParams.length > 0 {
                      addMethod(plan, ownerType, owner!, call.resolvedFunction!, concreteArgs)
                      recordedMethod = true
                    }
                  }
                  _ -> { }
                }
              }
            }
            _ -> { }
          }
          if !recordedMethod {
            targetModule := functionModule(call, modulePath)
            addFunction(plan, targetModule, call.resolvedFunction!, concreteArgs)
          }
        }
      }
    }
    array: ArrayLiteral -> { for item of array.elements { collectExpression(item, modulePath, analysis, plan, names, arguments) } }
    object: ObjectLiteral -> {
      if object.spread != null { collectExpression(object.spread!, modulePath, analysis, plan, names, arguments) }
      for property of object.properties {
        if property.key != null { collectExpression(property.key!, modulePath, analysis, plan, names, arguments) }
        if property.value != null { collectExpression(property.value!, modulePath, analysis, plan, names, arguments) }
      }
    }
    tuple: TupleLiteral -> { for item of tuple.elements { collectExpression(item, modulePath, analysis, plan, names, arguments) } }
    lambda: LambdaExpression -> {
      for parameter of lambda.params { if parameter.defaultValue != null { collectExpression(parameter.defaultValue!, modulePath, analysis, plan, names, arguments) } }
      case lambda.body {
        block: Block -> { collectBlock(block, modulePath, analysis, plan, names, arguments) }
        inner: Expression -> { collectExpression(inner, modulePath, analysis, plan, names, arguments) }
      }
    }
    if_: IfExpression -> { collectExpression(if_.condition, modulePath, analysis, plan, names, arguments); collectExpression(if_.then_, modulePath, analysis, plan, names, arguments); collectExpression(if_.else_, modulePath, analysis, plan, names, arguments) }
    case_: CaseExpression -> {
      collectExpression(case_.subject, modulePath, analysis, plan, names, arguments)
      for arm of case_.arms {
        case arm.body {
          block: Block -> { collectBlock(block, modulePath, analysis, plan, names, arguments) }
          bodyExpression: Expression -> { collectExpression(bodyExpression, modulePath, analysis, plan, names, arguments) }
        }
      }
    }
    construct: ConstructExpression -> { for property of construct.args { if property.value != null { collectExpression(property.value!, modulePath, analysis, plan, names, arguments) } } }
    async_: AsyncExpression -> {
      case async_.expression {
        block: Block -> { collectBlock(block, modulePath, analysis, plan, names, arguments) }
        inner: Expression -> { collectExpression(inner, modulePath, analysis, plan, names, arguments) }
      }
    }
    retire_: RetireExpression -> { collectExpression(retire_.actor, modulePath, analysis, plan, names, arguments) }
    actor: ActorCreationExpression -> { for argument of actor.args { collectExpression(argument, modulePath, analysis, plan, names, arguments) } }
    yieldBlock: YieldBlockExpression -> { collectBlock(yieldBlock.body, modulePath, analysis, plan, names, arguments) }
    catch_: CatchExpression -> { collectBlock(catch_.body, modulePath, analysis, plan, names, arguments) }
    _ -> { }
  }
}

function collectOptionalType(type_: ResolvedType | null, names: string[], arguments: ResolvedType[], analysis: AnalysisResult, plan: InstantiationPlan): void {
  if type_ != null { collectType(specialize(type_!, names, arguments), analysis, plan) }
}

function collectType(type_: ResolvedType, analysis: AnalysisResult, plan: InstantiationPlan): void {
  case type_ {
    class_: ClassType -> {
      for argument of class_.typeArgs { collectType(argument, analysis, plan) }
      if class_.typeArgs.length > 0 && !containsTypeParameters(class_.typeArgs) {
        declaration := classDeclaration(analysis, class_.symbol.module, class_.symbol.name)
        if declaration != null && !declaration!.native_ { addClass(plan, class_.symbol.module, declaration!, class_.typeArgs) }
      }
    }
    interface_: InterfaceType -> {
      for argument of interface_.typeArgs { collectType(argument, analysis, plan) }
      if interface_.typeArgs.length > 0 && !containsTypeParameters(interface_.typeArgs) { addInterface(plan, interface_.symbol.module, interface_.name, interface_.typeArgs) }
    }
    array: ArrayResolvedType -> { collectType(array.elementType, analysis, plan) }
    map: MapResolvedType -> { collectType(map.keyType, analysis, plan); collectType(map.valueType, analysis, plan) }
    set_: SetResolvedType -> { collectType(set_.elementType, analysis, plan) }
    stream: StreamResolvedType -> { collectType(stream.elementType, analysis, plan); addInterface(plan, "", "Stream", [stream.elementType]) }
    result: ResultResolvedType -> { collectType(result.valueType, analysis, plan); collectType(result.errorType, analysis, plan) }
    actor: ActorType -> { collectType(actor.innerClass, analysis, plan) }
    promise: PromiseType -> { collectType(promise.valueType, analysis, plan) }
    tuple: TupleResolvedType -> { for element of tuple.elements { collectType(element, analysis, plan) } }
    union_: UnionResolvedType -> { for member of union_.types { collectType(member, analysis, plan) } }
    weak_: WeakResolvedType -> { collectType(weak_.inner, analysis, plan) }
    function_: FunctionType -> {
      for parameter of function_.params { collectType(parameter.type_, analysis, plan) }
      collectType(function_.returnType, analysis, plan)
    }
    _ -> { }
  }
}

function addFunction(plan: InstantiationPlan, modulePath: string, declaration: FunctionDeclaration, typeArgs: ResolvedType[]): void {
  key := functionInstantiationKey(modulePath, declaration.name, typeArgs)
  for existing of plan.functions { if existing.key == key { return } }
  emittedName := concreteName(declaration.name, typeArgs)
  plan.functions.push(FunctionInstantiation { key, modulePath, declaration, substitution: TypeSubstitution { names: declaration.typeParams, arguments: typeArgs }, emittedName, trace: extendedTrace(plan.currentTrace, emittedName) })
}

function addClass(plan: InstantiationPlan, modulePath: string, declaration: ClassDeclaration, typeArgs: ResolvedType[]): void {
  key := classInstantiationKey(modulePath, declaration.name, typeArgs)
  if containsString(plan.nativeTemplateClassKeys, nativeTemplateClassKey(modulePath, declaration.name)) { return }
  for existing of plan.classes { if existing.key == key { return } }
  emittedName := concreteName(declaration.name, typeArgs)
  plan.classes.push(ClassInstantiation { key, modulePath, declaration, substitution: TypeSubstitution { names: declaration.typeParams, arguments: typeArgs }, emittedName, trace: extendedTrace(plan.currentTrace, emittedName) })
}

export function nativeTemplateClassKey(modulePath: string, name: string): string => modulePath + "::" + name

function discoverNativeTemplateClasses(analysis: AnalysisResult, plan: InstantiationPlan): void {
  for module of analysis.modules {
    for statement of module.program.statements { discoverNativeTemplateClassesInStatement(statement, plan) }
  }
}

function discoverNativeTemplateClassesInStatement(statement: Statement, plan: InstantiationPlan): void {
  case statement {
    class_: ClassDeclaration -> {
      if !class_.native_ { return }
      for field of class_.fields { if field.resolvedType != null { collectNativeTemplateClasses(field.resolvedType!, plan) } }
      for method of class_.methods { if method.resolvedType != null { collectNativeTemplateClasses(method.resolvedType!, plan) } }
    }
    fn: FunctionDeclaration -> { if fn.native_ && fn.resolvedType != null { collectNativeTemplateClasses(fn.resolvedType!, plan) } }
    export_: ExportDeclaration -> { discoverNativeTemplateClassesInStatement(export_.declaration, plan) }
    _ -> { }
  }
}

function collectNativeTemplateClasses(type_: ResolvedType, plan: InstantiationPlan): void {
  case type_ {
    class_: ClassType -> {
      if !class_.symbol.native_ && class_.typeArgs.length > 0 { addString(plan.nativeTemplateClassKeys, nativeTemplateClassKey(class_.symbol.module, class_.name)) }
      for argument of class_.typeArgs { collectNativeTemplateClasses(argument, plan) }
    }
    interface_: InterfaceType -> { for argument of interface_.typeArgs { collectNativeTemplateClasses(argument, plan) } }
    array: ArrayResolvedType -> { collectNativeTemplateClasses(array.elementType, plan) }
    map: MapResolvedType -> { collectNativeTemplateClasses(map.keyType, plan); collectNativeTemplateClasses(map.valueType, plan) }
    set_: SetResolvedType -> { collectNativeTemplateClasses(set_.elementType, plan) }
    stream: StreamResolvedType -> { collectNativeTemplateClasses(stream.elementType, plan) }
    result_: ResultResolvedType -> { collectNativeTemplateClasses(result_.valueType, plan); collectNativeTemplateClasses(result_.errorType, plan) }
    actor: ActorType -> { collectNativeTemplateClasses(actor.innerClass, plan) }
    promise: PromiseType -> { collectNativeTemplateClasses(promise.valueType, plan) }
    tuple: TupleResolvedType -> { for element of tuple.elements { collectNativeTemplateClasses(element, plan) } }
    union_: UnionResolvedType -> { for member of union_.types { collectNativeTemplateClasses(member, plan) } }
    weak_: WeakResolvedType -> { collectNativeTemplateClasses(weak_.inner, plan) }
    function_: FunctionType -> {
      for parameter of function_.params { collectNativeTemplateClasses(parameter.type_, plan) }
      collectNativeTemplateClasses(function_.returnType, plan)
    }
    _ -> { }
  }
}

function addString(values: string[], value: string): void {
  if !containsString(values, value) { values.push(value) }
}

function containsString(values: string[], value: string): bool {
  for existing of values { if existing == value { return true } }
  return false
}

function addInterface(plan: InstantiationPlan, modulePath: string, name: string, typeArgs: ResolvedType[]): void {
  if containsTypeParameters(typeArgs) { return }
  key := interfaceInstantiationKey(modulePath, name, typeArgs)
  for existing of plan.interfaces { if existing.key == key { return } }
  plan.interfaces.push(InterfaceInstantiation { key, modulePath, name, substitution: TypeSubstitution { arguments: typeArgs }, emittedName: concreteName(name, typeArgs) })
}

function addMethod(plan: InstantiationPlan, ownerType: ClassType, owner: ClassDeclaration, declaration: FunctionDeclaration, methodArgs: ResolvedType[]): void {
  // Generic methods on ordinary classes map directly to C++ member templates.
  // Whole-program method specialization is reserved for specialized generic
  // owners, where the owner substitution must participate in the method key.
  if owner.typeParams.length == 0 { return }
  ownerKey := classInstantiationKey(ownerType.symbol.module, ownerType.name, ownerType.typeArgs)
  key := methodInstantiationKey(ownerKey, declaration.name, methodArgs)
  for existing of plan.methods { if existing.key == key { return } }
  let names: string[] = []
  let arguments: ResolvedType[] = []
  for name of owner.typeParams { names.push(name) }
  for argument of ownerType.typeArgs { arguments.push(argument) }
  for name of declaration.typeParams { names.push(name) }
  for argument of methodArgs { arguments.push(argument) }
  plan.methods.push(MethodInstantiation {
    key, modulePath: ownerType.symbol.module, ownerKey, owner, declaration,
    substitution: TypeSubstitution { names, arguments }, emittedName: concreteName(declaration.name, methodArgs),
    trace: extendedTrace(plan.currentTrace, concreteName(owner.name + "__" + declaration.name, methodArgs)),
  })
}

function extendedTrace(parent: string[], item: string): string[] {
  let trace: string[] = []
  // Keep diagnostics bounded even when the specialization chain itself is not.
  let start = if parent.length > 11 then parent.length - 11 else 0
  for index of start..<parent.length { trace.push(parent[index]) }
  trace.push(item)
  return trace
}

function discoverConcreteInterfaceImplementations(analysis: AnalysisResult, plan: InstantiationPlan): void {
  for interface_ of plan.interfaces {
    for module of analysis.modules {
      for statement of module.program.statements {
        let candidate: ClassDeclaration | null = null
        case statement {
          class_: ClassDeclaration -> { candidate = class_ }
          export_: ExportDeclaration -> {
            case export_.declaration {
              class_: ClassDeclaration -> { candidate = class_ }
              _ -> { }
            }
          }
          _ -> { }
        }
        if candidate != null && candidate!.typeParams.length == 0 && !candidate!.struct_ && classImplementsConcreteInterface(candidate!, [], interface_, analysis) {
          addImplementation(interface_, module.path, candidate!.name)
        }
      }
    }
    for class_ of plan.classes {
      if class_.declaration.struct_ { continue }
      if classImplementsConcreteInterface(class_.declaration, class_.substitution.arguments, interface_, analysis) {
        addImplementation(interface_, class_.modulePath, class_.emittedName)
      }
    }
  }
}

function addImplementation(interface_: InterfaceInstantiation, modulePath: string, typeName_: string): void {
  for existing of interface_.implementations { if existing.modulePath == modulePath && existing.typeName == typeName_ { return } }
  interface_.implementations.push(ImplementationRef { modulePath, typeName: typeName_ })
}

function classImplementsConcreteInterface(class_: ClassDeclaration, classArgs: ResolvedType[], interface_: InterfaceInstantiation, analysis: AnalysisResult): bool {
  if interface_.name == "Stream" {
    for implementation of class_.implements_ {
      if implementation.resolvedType == null { continue }
      case specialize(implementation.resolvedType!, class_.typeParams, classArgs) {
        stream: StreamResolvedType -> { if sameType(stream.elementType, interface_.substitution.arguments[0]) { return true } }
        _ -> { }
      }
    }
    next := classMethod(class_, "next")
    value := classMethod(class_, "value")
    if next == null || value == null || next!.resolvedType == null || value!.resolvedType == null { return false }
    nextType := specialize(next!.resolvedType!, class_.typeParams, classArgs)
    valueType := specialize(value!.resolvedType!, class_.typeParams, classArgs)
    case nextType {
      fn: FunctionType -> { if typeName(fn.returnType) != "bool" || fn.params.length != 0 { return false } }
      _ -> { return false }
    }
    case valueType {
      fn: FunctionType -> { return fn.params.length == 0 && sameType(fn.returnType, interface_.substitution.arguments[0]) }
      _ -> { return false }
    }
  }
  declaration := interfaceDeclaration(analysis, interface_.modulePath, interface_.name)
  if declaration == null { return false }
  for required of declaration!.fields {
    actual := classField(class_, required.name)
    if actual == null || actual!.resolvedType == null || required.resolvedType == null { return false }
    actualType := specialize(actual!.resolvedType!, class_.typeParams, classArgs)
    requiredType := specialize(required.resolvedType!, declaration!.typeParams, interface_.substitution.arguments)
    if !isAssignable(actualType, requiredType) { return false }
  }
  for required of declaration!.methods {
    actual := classMethod(class_, required.name)
    if actual == null || actual!.resolvedType == null || required.resolvedType == null { return false }
    actualType := specialize(actual!.resolvedType!, class_.typeParams, classArgs)
    requiredType := specialize(required.resolvedType!, declaration!.typeParams, interface_.substitution.arguments)
    if !sameConcreteMethodType(actualType, requiredType) { return false }
  }
  return true
}

function classField(class_: ClassDeclaration, name: string): ClassField | null {
  for field of class_.fields { for fieldName of field.names { if fieldName == name { return field } } }
  return null
}

function sameConcreteMethodType(actual: ResolvedType, expected: ResolvedType): bool {
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

function classMethod(class_: ClassDeclaration, name: string): FunctionDeclaration | null {
  for method of class_.methods { if method.name == name && !method.static_ { return method } }
  return null
}

function interfaceDeclaration(analysis: AnalysisResult, modulePath: string, name: string): InterfaceDeclaration | null {
  for module of analysis.modules {
    if module.path != modulePath { continue }
    for statement of module.program.statements {
      case statement {
        interface_: InterfaceDeclaration -> { if interface_.name == name { return interface_ } }
        export_: ExportDeclaration -> {
          case export_.declaration {
            interface_: InterfaceDeclaration -> { if interface_.name == name { return interface_ } }
            _ -> { }
          }
        }
        _ -> { }
      }
    }
  }
  return null
}

function functionModule(call: CallExpression, fallback: string): string {
  case call.callee {
    identifier: Identifier -> {
      if identifier.resolvedBinding != null {
        if identifier.resolvedBinding!.symbol != null { return identifier.resolvedBinding!.symbol!.module }
        if identifier.resolvedBinding!.module != "" { return identifier.resolvedBinding!.module }
      }
    }
    member: MemberExpression -> {
      if member.object.resolvedType != null {
        case member.object.resolvedType! {
          class_: ClassType -> { return class_.symbol.module }
          _ -> { }
        }
      }
    }
    _ -> { }
  }
  return fallback
}

function classDeclaration(analysis: AnalysisResult, modulePath: string, name: string): ClassDeclaration | null {
  for module of analysis.modules {
    if module.path != modulePath { continue }
    for statement of module.program.statements {
      declaration := classFromStatement(statement, name)
      if declaration != null { return declaration }
    }
  }
  return null
}

function classFromStatement(statement: Statement, name: string): ClassDeclaration | null {
  case statement {
    class_: ClassDeclaration -> { if class_.name == name { return class_ } }
    export_: ExportDeclaration -> { return classFromStatement(export_.declaration, name) }
    _ -> { }
  }
  return null
}

function specialize(type_: ResolvedType, names: string[], arguments: ResolvedType[]): ResolvedType {
  if names.length == 0 { return type_ }
  return substituteTypeParams(type_, names, arguments)
}

function containsTypeParameters(types: ResolvedType[]): bool {
  for type_ of types { if containsTypeParameter(type_) { return true } }
  return false
}

function containsTypeParameter(type_: ResolvedType): bool {
  case type_ {
    _: TypeParameterType -> { return true }
    class_: ClassType -> { return containsTypeParameters(class_.typeArgs) }
    interface_: InterfaceType -> { return containsTypeParameters(interface_.typeArgs) }
    array: ArrayResolvedType -> { return containsTypeParameter(array.elementType) }
    map: MapResolvedType -> { return containsTypeParameter(map.keyType) || containsTypeParameter(map.valueType) }
    set_: SetResolvedType -> { return containsTypeParameter(set_.elementType) }
    stream: StreamResolvedType -> { return containsTypeParameter(stream.elementType) }
    result: ResultResolvedType -> { return containsTypeParameter(result.valueType) || containsTypeParameter(result.errorType) }
    actor: ActorType -> { return containsTypeParameter(actor.innerClass) }
    promise: PromiseType -> { return containsTypeParameter(promise.valueType) }
    tuple: TupleResolvedType -> { return containsTypeParameters(tuple.elements) }
    union_: UnionResolvedType -> { return containsTypeParameters(union_.types) }
    weak_: WeakResolvedType -> { return containsTypeParameter(weak_.inner) }
    function_: FunctionType -> {
      for parameter of function_.params { if containsTypeParameter(parameter.type_) { return true } }
      return containsTypeParameter(function_.returnType)
    }
    _ -> { return false }
  }
  return false
}

function concreteTypeListKey(types: ResolvedType[]): string {
  let result = ""
  for type_ of types { result = result + "[" + canonicalTypeKey(type_) + "]" }
  return result
}

function canonicalTypeKey(type_: ResolvedType): string {
  case type_ {
    class_: ClassType -> { return "class:" + class_.symbol.module + ":" + class_.name + concreteTypeListKey(class_.typeArgs) }
    interface_: InterfaceType -> { return "interface:" + interface_.symbol.module + ":" + interface_.name + concreteTypeListKey(interface_.typeArgs) }
    array: ArrayResolvedType -> { return (if array.readonly_ then "readonly-array:" else "array:") + canonicalTypeKey(array.elementType) }
    map: MapResolvedType -> { return (if map.readonly_ then "readonly-map:" else "map:") + canonicalTypeKey(map.keyType) + ":" + canonicalTypeKey(map.valueType) }
    set_: SetResolvedType -> { return (if set_.readonly_ then "readonly-set:" else "set:") + canonicalTypeKey(set_.elementType) }
    stream: StreamResolvedType -> { return "stream:" + canonicalTypeKey(stream.elementType) }
    result: ResultResolvedType -> { return "result:" + canonicalTypeKey(result.valueType) + ":" + canonicalTypeKey(result.errorType) }
    actor: ActorType -> { return "actor:" + canonicalTypeKey(actor.innerClass) }
    promise: PromiseType -> { return "promise:" + canonicalTypeKey(promise.valueType) }
    tuple: TupleResolvedType -> { return "tuple:" + concreteTypeListKey(tuple.elements) }
    union_: UnionResolvedType -> { return "union:" + concreteTypeListKey(union_.types) }
    weak_: WeakResolvedType -> { return "weak:" + canonicalTypeKey(weak_.inner) }
    _ -> { return typeName(type_) }
  }
  return typeName(type_)
}

function mangleType(type_: ResolvedType): string {
  case type_ {
    class_: ClassType -> { return sanitize(moduleNamespace(class_.symbol.module) + "_" + class_.name + "_" + concreteTypeListMangle(class_.typeArgs)) }
    interface_: InterfaceType -> { return sanitize(moduleNamespace(interface_.symbol.module) + "_" + interface_.name + "_" + concreteTypeListMangle(interface_.typeArgs)) }
    array: ArrayResolvedType -> { return (if array.readonly_ then "readonly_array_" else "array_") + mangleType(array.elementType) }
    map: MapResolvedType -> { return (if map.readonly_ then "readonly_map_" else "map_") + mangleType(map.keyType) + "_" + mangleType(map.valueType) }
    set_: SetResolvedType -> { return (if set_.readonly_ then "readonly_set_" else "set_") + mangleType(set_.elementType) }
    stream: StreamResolvedType -> { return "stream_" + mangleType(stream.elementType) }
    result: ResultResolvedType -> { return "result_" + mangleType(result.valueType) + "_" + mangleType(result.errorType) }
    actor: ActorType -> { return "actor_" + mangleType(actor.innerClass) }
    promise: PromiseType -> { return "promise_" + mangleType(promise.valueType) }
    tuple: TupleResolvedType -> { return "tuple_" + concreteTypeListMangle(tuple.elements) }
    union_: UnionResolvedType -> { return "union_" + concreteTypeListMangle(union_.types) }
    weak_: WeakResolvedType -> { return "weak_" + mangleType(weak_.inner) }
    _ -> { return sanitize(typeName(type_)) }
  }
  return "type"
}

function concreteTypeListMangle(types: ResolvedType[]): string {
  let result = ""
  for type_ of types {
    if result != "" { result = result + "_" }
    result = result + mangleType(type_)
  }
  return result
}

function sanitize(value: string): string {
  return value.replaceAll("/", "_").replaceAll(".", "_").replaceAll("<", "_").replaceAll(">", "_")
    .replaceAll(",", "_").replaceAll(" ", "_").replaceAll("|", "_").replaceAll("[", "_").replaceAll("]", "_")
    .replaceAll(":", "_").replaceAll("(", "_").replaceAll(")", "_")
}
