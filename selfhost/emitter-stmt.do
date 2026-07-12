// Statement lowering for the self-hosted C++ emitter.
//
// This module owns block layout and control-flow statements.  Declarations
// are intentionally handled by emitter-decl.do so the module emitter can
// place signatures in headers and bodies in sources.

import {
  Block, Expression, ExpressionStatement, IfStatement, LetDeclaration, ImmutableBinding, NullLiteral,
  ReadonlyDeclaration, ConstDeclaration, ReturnStatement, Statement,
  WhileStatement, CaseStatement, TypePattern, ValuePattern, WildcardPattern,
  Identifier, BreakStatement, ContinueStatement, ForOfStatement, ForStatement, BinaryExpression,
  NamedType, UnionType,
} from "./ast"
import type { TypeAnnotation } from "./ast"
import { FunctionType, ResolvedType, UnionResolvedType } from "./semantic"
import { EmitContext, findFunction } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitAnnotation, emitType } from "./emitter-types"

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
    const_: ConstDeclaration -> { return emitLocalDeclaration(ind, const_.name, const_.type_, const_.resolvedType, const_.value, context, true) }
    readonly_: ReadonlyDeclaration -> { return emitLocalDeclaration(ind, readonly_.name, readonly_.type_, readonly_.resolvedType, readonly_.value, context, true) }
    binding: ImmutableBinding -> { return emitLocalDeclaration(ind, binding.name, binding.type_, binding.resolvedType, binding.value, context, true) }
    let_: LetDeclaration -> { return emitLocalDeclaration(ind, let_.name, let_.type_, let_.resolvedType, let_.value, context, false) }
    return_: ReturnStatement -> { return ind + emitReturn(return_, context) }
    expression: ExpressionStatement -> { return ind + emitExpression(expression.expression, context) + ";\n" }
    if_: IfStatement -> { return emitIf(if_, level, context) }
    case_: CaseStatement -> { return emitCase(case_, level, context) }
    while_: WhileStatement -> { return emitWhile(while_, level, context) }
    forOf: ForOfStatement -> { return emitForOf(forOf, level, context) }
    for_: ForStatement -> { return emitFor(for_, level, context) }
    _: BreakStatement -> { return ind + "break;\n" }
    _: ContinueStatement -> { return ind + "continue;\n" }
    block: Block -> { return emitBlock(block, level, context) }
    _ -> { panic("Unsupported statement in initial C++ emitter: " + statement.kind) }
  }
  return ""
}

function emitLocalDeclaration(ind: string, name: string, annotation: TypeAnnotation | null, resolvedType: ResolvedType | null, value: Expression, context: EmitContext, readonly_: bool): string {
  let typeText = "auto"
  if annotation != null {
    case annotation! {
      _: UnionType -> { typeText = emitAnnotation(annotation!, context.modulePath) }
      named: NamedType -> {
        if named.name == "Expression" || named.name == "Statement" || named.name == "TypeAnnotation" { typeText = emitAnnotation(annotation!, context.modulePath) }
      }
      _ -> { }
    }
  }
  if annotation != null {
    case annotation! {
      _: UnionType -> { if resolvedType != null { typeText = emitType(resolvedType!, context.modulePath) } }
      _ -> { }
    }
  }
  let prefix = if readonly_ then "const " else ""
  let expected: ResolvedType | null = resolvedType
  let valueText = emitExpression(value, context, expected)
  case value {
    null_: NullLiteral -> {
      if annotation != null {
        case annotation! {
          union_: UnionType -> {
            for member of union_.types {
              case member {
                named: NamedType -> {
                  if named.name == "Expression" || named.name == "Statement" || named.name == "TypeAnnotation" { valueText = "std::monostate{}" }
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
  return ind + prefix + typeText + " " + cppIdentifier(name) + " = " + valueText + ";\n"
}

function emitCase(statement: CaseStatement, level: int, context: EmitContext): string {
  ind := indent(level)
  inner := indent(level + 1)
  bodyIndent := indent(level + 2)
  subject := "_case_subject"
  let result = ind + "{\n" + inner + "auto " + subject + " = " + emitExpression(statement.subject, context) + ";\n"
  let previous = false
  // A type-pattern case is always a discriminated union in the self-hosted
  // source graph.  The checker may represent a type alias as an unknown
  // wrapper while it is being bootstrapped, so pattern presence is the more
  // reliable emission signal than the subject decoration alone.
  variant := hasTypePattern(statement) || isVariantCaseType(caseSubjectType(statement.subject))

  for arm of statement.arms {
    for pattern of arm.patterns {
      let condition = ""
      let binding = ""
      let isWildcard = false
      case pattern {
        type_: TypePattern -> {
          let aliasName = ""
          case type_.type_ {
            named: NamedType -> { aliasName = named.name }
            _ -> { }
          }
          if aliasName == "Expression" {
            condition = "doof::is_expression(" + subject + ")"
            if type_.name != "_" { binding = "const auto " + cppIdentifier(type_.name) + " = doof::expression_value(" + subject + ");\n" }
          } else if variant && type_.resolvedType != null {
            typeName := emitType(type_.resolvedType!, context.modulePath)
            condition = "std::holds_alternative<" + typeName + ">(" + subject + ")"
            if type_.name != "_" { binding = "const auto " + cppIdentifier(type_.name) + " = std::get<" + typeName + ">(" + subject + ");\n" }
          } else {
            condition = "true"
            if type_.name != "_" { binding = "const auto " + cppIdentifier(type_.name) + " = " + subject + ";\n" }
          }
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
      result = result + emitBlock(arm.body, level + 2, context) + ind + "}\n"
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

function isVariantCaseType(resolvedType: ResolvedType | null): bool {
  if resolvedType == null { return false }
  case resolvedType! {
    union_: UnionResolvedType -> {
      let nonNull = 0
      for member of union_.types { if member.kind != "null" { nonNull = nonNull + 1 } }
      return nonNull > 1
    }
    _ -> { }
  }
  return false
}

function hasTypePattern(statement: CaseStatement): bool {
  for arm of statement.arms {
    for pattern of arm.patterns {
      case pattern {
        _: TypePattern -> { return true }
        _ -> { }
      }
    }
  }
  return false
}

function emitReturn(statement: ReturnStatement, context: EmitContext): string {
  if statement.value == null { return "return;\n" }
  let expected: ResolvedType | null = null
  function_ := findFunction(context, context.currentFunctionName)
  if function_ != null && function_!.resolvedType != null {
    case function_!.resolvedType! {
      resolved: FunctionType -> { expected = resolved.returnType }
      _ -> { }
    }
  }
  let value = emitExpression(statement.value!, context, expected)
  let nullValue = false
  case statement.value! {
    _: NullLiteral -> { nullValue = true }
    _ -> { }
  }
  if context.currentFunctionName == "parseOptionalType" {
    if nullValue { value = "std::monostate{}" }
    else { value = "doof::optional_value(" + value + ")" }
  }
  if context.currentReturnVariantOptional && context.currentFunctionName != "parseOptionalType" {
    if nullValue { value = "std::monostate{}" }
    else { value = "doof::optional_value(" + value + ")" }
  }
  return "return " + value + ";\n"
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
  return ind + "for (const auto& " + name + " : *" + iterable + ") {\n" +
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
