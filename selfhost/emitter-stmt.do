// Statement lowering for the self-hosted C++ emitter.
//
// This module owns block layout and control-flow statements.  Declarations
// are intentionally handled by emitter-decl.do so the module emitter can
// place signatures in headers and bodies in sources.

import {
  Block, Expression, ExpressionStatement, IfStatement, LetDeclaration, ImmutableBinding,
  ReadonlyDeclaration, ConstDeclaration, ReturnStatement, Statement,
  WhileStatement, CaseStatement, NamedType, TypePattern, ValuePattern, WildcardPattern,
  Identifier, BreakStatement, ContinueStatement, DestructuringStatement, ForOfStatement, ForStatement, BinaryExpression,
  TryStatement, WithStatement, YieldStatement,
} from "./ast"
import type { TypeAnnotation } from "./ast"
import { ArrayResolvedType, ClassType, InterfaceType, ResolvedType, StreamResolvedType, TupleResolvedType, UnionResolvedType } from "./semantic"
import { EmitContext, isCapturedMutable } from "./emitter-context"
import { emitCaseTypePattern } from "./emitter-case-pattern"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitType, specializeEmitType, usesVariantRepresentation } from "./emitter-types"

export function emitBlock(block: Block, level: int, context: EmitContext): string {
  let result = ""
  for statement of block.statements {
    result = result + emitStatement(statement, level, context)
  }
  return result
}

export function emitStatement(statement: Statement, level: int = 1, context: EmitContext): string {
  ind := indent(level)
  case statement {
    const_: ConstDeclaration -> { return emitLocalDeclaration(ind, const_.name, const_.type_, const_.resolvedType!, const_.value, context, true) }
    readonly_: ReadonlyDeclaration -> { return emitLocalDeclaration(ind, readonly_.name, readonly_.type_, readonly_.resolvedType!, readonly_.value, context, true) }
    binding: ImmutableBinding -> {
      if binding.else_ != null { return emitBindingElse(binding, level, context) }
      return emitLocalDeclaration(ind, binding.name, binding.type_, binding.resolvedType!, binding.value, context, true)
    }
    let_: LetDeclaration -> { return emitLocalDeclaration(ind, let_.name, let_.type_, let_.resolvedType!, let_.value, context, false) }
    return_: ReturnStatement -> { return ind + emitReturn(return_, context) }
    yield_: YieldStatement -> {
      if !context.inValueYieldBlock { panic("yield statement is outside a value-producing block") }
      return ind + "return " + emitExpression(yield_.value, context) + ";\n"
    }
    expression: ExpressionStatement -> { return ind + emitExpression(expression.expression, context) + ";\n" }
    if_: IfStatement -> { return emitIf(if_, level, context) }
    case_: CaseStatement -> { return emitCase(case_, level, context) }
    while_: WhileStatement -> { return emitWhile(while_, level, context) }
    forOf: ForOfStatement -> { return emitForOf(forOf, level, context) }
    for_: ForStatement -> { return emitFor(for_, level, context) }
    with_: WithStatement -> { return emitWith(with_, level, context) }
    destructuring: DestructuringStatement -> { return emitDestructuring(destructuring, level, context) }
    try_: TryStatement -> { return emitTry(try_, level, context) }
    _: BreakStatement -> { return ind + "break;\n" }
    _: ContinueStatement -> { return ind + "continue;\n" }
    block: Block -> { return emitBlock(block, level, context) }
    _ -> { panic("Unsupported statement in initial C++ emitter: " + statement.kind) }
  }
  return ""
}

/** Lowers ordered immutable bindings into a lexical C++ scope. */
function emitWith(statement: WithStatement, level: int, context: EmitContext): string {
  ind := indent(level)
  innerInd := indent(level + 1)
  let output = ind + "{\n"
  for binding of statement.bindings {
    if binding.resolvedType == null { panic("With binding was not resolved before emission: " + binding.name) }
    resolvedType := binding.resolvedType!
    value := emitExpression(binding.value, context, resolvedType)
    let declarationType = "auto"
    case resolvedType {
      _: ClassType -> { declarationType = emitType(resolvedType, context.modulePath) }
      union_: UnionResolvedType -> {
        if usesVariantRepresentation(union_) { declarationType = emitType(resolvedType, context.modulePath) }
      }
      _ -> { }
    }
    output = output + innerInd + "const " + declarationType + " " + cppIdentifier(binding.name) + " = " + value + ";\n"
  }
  output = output + emitBlock(statement.body, level + 1, context)
  return output + ind + "}\n"
}

function emitDestructuring(statement: DestructuringStatement, level: int, context: EmitContext): string {
  ind := indent(level)
  context.tryCounter = context.tryCounter + 1
  temporaryName := "_destructure_" + string(context.tryCounter)
  let result = ind + "auto " + temporaryName + " = " + emitExpression(statement.value, context) + ";\n"
  sourceType := statement.value.resolvedType
  for i of 0..<statement.bindings.length {
    name := statement.bindings[i]
    if name != "_" {
      qualifier := if statement.bindingKind == "let" then "auto" else "const auto"
      let value = "std::get<" + string(i) + ">(" + temporaryName + ")"
      if sourceType != null {
        case sourceType! {
          _: ArrayResolvedType -> { value = "(*" + temporaryName + ")[" + string(i) + "]" }
          _: TupleResolvedType -> { }
          _ -> { }
        }
      }
      if statement.kind.endsWith("-assignment") {
        result = result + ind + cppIdentifier(name) + " = " + value + ";\n"
      } else {
        result = result + ind + qualifier + " " + cppIdentifier(name) + " = " + value + ";\n"
      }
    }
  }
  return result
}

function emitBindingElse(binding: ImmutableBinding, level: int, context: EmitContext): string {
  ind := indent(level)
  if binding.else_ == null { return emitLocalDeclaration(ind, binding.name, binding.type_, binding.resolvedType!, binding.value, context, true) }
  context.tryCounter = context.tryCounter + 1
  temporaryName := "_binding_value_" + string(context.tryCounter)
  if binding.value.resolvedType != null && isSingleOptional(binding.value.resolvedType!) {
    let output = ind + "auto " + temporaryName + " = " + emitExpression(binding.value, context) + ";\n"
    output = output + ind + "if (doof::is_null(" + temporaryName + ")) {\n"
    if binding.failureName == null && binding.name != "_" { output = output + indent(level + 1) + "const auto& " + cppIdentifier(binding.name) + " = " + temporaryName + ";\n" }
    output = output + emitBlock(binding.else_!, level + 1, context)
    output = output + ind + "}\n"
    if binding.name == "_" { return output }
    return output + ind + "const auto " + cppIdentifier(binding.name) + " = doof::unwrap_optional(" + temporaryName + ");\n"
  }
  let output = ind + "auto " + temporaryName + " = " + emitExpression(binding.value, context) + ";\n"
  output = output + ind + "if (doof::is_failure(" + temporaryName + ")) {\n"
  if binding.failureName != null && binding.failureName! != "_" {
    output = output + indent(level + 1) + "const auto " + cppIdentifier(binding.failureName!) + " = doof::failure_error(" + temporaryName + ");\n"
  } else if binding.name != "_" {
    output = output + indent(level + 1) + "const auto& " + cppIdentifier(binding.name) + " = " + temporaryName + ";\n"
  }
  output = output + emitBlock(binding.else_!, level + 1, context)
  output = output + ind + "}\n"
  if binding.name == "_" { return output }
  return output + ind + "const auto " + cppIdentifier(binding.name) + " = doof::success_value(" + temporaryName + ");\n"
}

function isSingleOptional(resolvedType: ResolvedType): bool {
  case resolvedType {
    union_: UnionResolvedType -> {
      let hasNull = false
      let nonNull = 0
      for member of union_.types {
        if member.kind == "null" { hasNull = true }
        else { nonNull = nonNull + 1 }
      }
      return hasNull && nonNull == 1
    }
    _ -> { return false }
  }
  return false
}

function emitTry(statement: TryStatement, level: int, context: EmitContext): string {
  ind := indent(level)
  context.tryCounter = context.tryCounter + 1
  temporaryName := "_try_value_" + string(context.tryCounter)
  let value: Expression = Identifier { kind: "identifier", name: "<try>", span: statement.span }
  case statement.binding {
    declaration: ConstDeclaration -> { value = declaration.value }
    declaration: ReadonlyDeclaration -> { value = declaration.value }
    binding: ImmutableBinding -> { value = binding.value }
    declaration: LetDeclaration -> { value = declaration.value }
    expression: ExpressionStatement -> { value = expression.expression }
  }
  if context.currentReturnErrorType != "" {
      errorType := context.currentReturnErrorType
      let output = ind + "auto " + temporaryName + " = " + emitExpression(value, context) + ";\n"
      output = output + ind + "if (doof::is_failure(" + temporaryName + ")) return doof::Failure<" + errorType + ">{doof::failure_error(" + temporaryName + ")};\n"
      case statement.binding {
        declaration: ConstDeclaration -> {
          output = output + ind + "const auto " + cppIdentifier(declaration.name) + " = doof::success_value(" + temporaryName + ");\n"
        }
        declaration: ReadonlyDeclaration -> {
          output = output + ind + "const auto " + cppIdentifier(declaration.name) + " = doof::success_value(" + temporaryName + ");\n"
        }
        binding: ImmutableBinding -> {
          output = output + ind + "const auto " + cppIdentifier(binding.name) + " = doof::success_value(" + temporaryName + ");\n"
        }
        declaration: LetDeclaration -> {
          output = output + ind + "auto " + cppIdentifier(declaration.name) + " = doof::success_value(" + temporaryName + ");\n"
        }
        _: ExpressionStatement -> { }
      }
      return output
  }
  panic("try expression is outside a Result-returning function")
  return ""
}

function emitLocalDeclaration(ind: string, name: string, annotation: TypeAnnotation | null, resolvedType: ResolvedType | null, value: Expression, context: EmitContext, readonly_: bool): string {
  if resolvedType == null { panic("Local declaration was not resolved before emission") }
  let typeText = if annotation == null then "auto" else emitType(resolvedType!, context.modulePath)
  let prefix = if readonly_ then "const " else ""
  let expected: ResolvedType | null = resolvedType
  let valueText = emitExpression(value, context, expected)
  if !readonly_ && isCapturedMutable(context, name) {
    return ind + "auto " + cppIdentifier(name) + " = std::make_shared<" + emitType(resolvedType!, context.modulePath) + ">(" + valueText + ");\n"
  }
  return ind + prefix + typeText + " " + cppIdentifier(name) + " = " + valueText + ";\n"
}

function emitCase(statement: CaseStatement, level: int, context: EmitContext): string {
  ind := indent(level)
  inner := indent(level + 1)
  bodyIndent := indent(level + 2)
  subject := "_case_subject"
  let result = ind + "{\n" + inner + "auto " + subject + " = " + emitExpression(statement.subject, context) + ";\n"
  let previous = false
  subjectType := caseSubjectType(statement.subject)
  if subjectType == null { panic("Case statement subject has no resolved type") }

  for arm of statement.arms {
    for pattern of arm.patterns {
      let condition = ""
      let binding = ""
      let isWildcard = false
      case pattern {
        type_: TypePattern -> {
          bindingName := if type_.name == "_" then "" else cppIdentifier(type_.name)
          emitted := emitCaseTypePattern(type_, specializeEmitType(subjectType!, context), subject, bindingName, context.modulePath)
          condition = emitted.condition
          binding = emitted.binding
        }
        value: ValuePattern -> { condition = subject + " == " + emitExpression(value.value, context) }
        _: WildcardPattern -> { isWildcard = true }
      }

      if isWildcard {
        result = result + if previous then ind + "else {\n" else inner + "{\n"
      } else {
        result = result + if previous then ind + "else if (" + condition + ") {\n" else inner + "if (" + condition + ") {\n"
      }
      if binding != "" { result = result + bodyIndent + binding }
      case arm.body {
        block: Block -> { result = result + emitBlock(block, level + 2, context) + ind + "}\n" }
        _: Expression -> { panic("Expression case arm reached statement emitter") }
      }
      previous = true
      if isWildcard { return result + ind + "}\n" }
    }
  }
  return result + ind + "}\n"
}

function caseSubjectType(expression: Expression): ResolvedType | null {
  if expression.resolvedType != null { return expression.resolvedType }
  case expression {
    identifier: Identifier -> {
      if identifier.resolvedBinding != null { return identifier.resolvedBinding!.type_ }
    }
    _ -> { }
  }
  return null
}

function emitReturn(statement: ReturnStatement, context: EmitContext): string {
  if statement.value == null { return "return;\n" }
  expected := statement.resolvedExpectedType
  return "return " + emitExpression(statement.value!, context, expected) + ";\n"
}

function emitIf(statement: IfStatement, level: int, context: EmitContext): string {
  ind := indent(level)
  let result = ind + "if (" + emitCondition(statement.condition, context) + ") {\n"
  result = result + emitBlock(statement.body, level + 1, context) + ind + "}"
  for branch of statement.elseIfs {
    result = result + " else if (" + emitCondition(branch.condition, context) + ") {\n"
    result = result + emitBlock(branch.body, level + 1, context) + ind + "}"
  }
  if statement.else_ != null {
    result = result + " else {\n" + emitBlock(statement.else_!, level + 1, context) + ind + "}"
  }
  return result + "\n"
}

function emitWhile(statement: WhileStatement, level: int, context: EmitContext): string {
  ind := indent(level)
  return ind + "while (" + emitCondition(statement.condition, context) + ") {\n" +
    emitBlock(statement.body, level + 1, context) + ind + "}\n"
}

function emitForOf(statement: ForOfStatement, level: int, context: EmitContext): string {
  ind := indent(level)
  name := if statement.bindings.length == 0 then "_item" else cppIdentifier(statement.bindings[0])
  case statement.iterable {
    range: BinaryExpression -> {
      if range.operator == "..<" || range.operator == ".." {
        endOperator := if range.operator == "..<" then " < " else " <= "
        return ind + "for (int32_t " + name + " = " + emitExpression(range.left, context) + "; " + name + endOperator + emitExpression(range.right, context) + "; ++" + name + ") {\n" +
          emitBlock(statement.body, level + 1, context) + ind + "}\n"
      }
    }
    _ -> { }
  }
  iterable := emitExpression(statement.iterable, context)
  context.tryCounter = context.tryCounter + 1
  iterableName := "_iterable_" + string(context.tryCounter)
  iterableBinding := ind + "const auto& " + iterableName + " = " + iterable + ";\n"
  if statement.iterable.resolvedType != null {
    case statement.iterable.resolvedType! {
      _: StreamResolvedType -> {
        return iterableBinding + ind + "while (std::visit([](auto&& _obj) { return _obj->next(); }, " + iterableName + ")) {\n" +
          ind + "    const auto " + name + " = std::visit([](auto&& _obj) { return _obj->value(); }, " + iterableName + ");\n" +
          emitBlock(statement.body, level + 1, context) + ind + "}\n"
      }
      _ -> { }
    }
  }
  if statement.bindings.length > 1 {
    let names = ""
    for i of 0..<statement.bindings.length {
      if i > 0 { names = names + ", " }
      names = names + cppIdentifier(statement.bindings[i])
    }
    return iterableBinding + ind + "for (const auto& [" + names + "] : *" + iterableName + ") {\n" +
      emitBlock(statement.body, level + 1, context) + ind + "}\n"
  }
  return iterableBinding + ind + "for (const auto& " + name + " : *" + iterableName + ") {\n" +
    emitBlock(statement.body, level + 1, context) + ind + "}\n"
}

function emitFor(statement: ForStatement, level: int, context: EmitContext): string {
  ind := indent(level)
  let init = ""
  if statement.init != null { init = emitStatement(statement.init!, 0, context).trim() }
  let condition = "true"
  if statement.condition != null { condition = emitCondition(statement.condition!, context) }
  let update = ""
  for i of 0..<statement.update.length {
    if i > 0 { update = update + ", " }
    update = update + emitExpression(statement.update[i], context)
  }
  return ind + "for (" + init + "; " + condition + "; " + update + ") {\n" +
    emitBlock(statement.body, level + 1, context) + ind + "}\n"
}

function indent(level: int): string {
  return "    ".repeat(level)
}

function emitCondition(expression: Expression, context: EmitContext): string {
  value := emitExpression(expression, context)
  if value.startsWith("(") && value.endsWith(")") {
    return value.substring(1, value.length - 1)
  }
  return value
}
