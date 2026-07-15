// Conditional and pattern-based expression lowering.

import { Block, CaseExpression, DotShorthand, Expression, IfExpression, MemberExpression, NamedType, TypePattern, ValuePattern, WildcardPattern } from "./ast"
import { ResolvedType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { emitCaseTypePattern } from "./emitter-case-pattern"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitBlock } from "./emitter-stmt"
import { exprModuleNamespaceFor } from "./emitter-expr-utils"
import { emitType, specializeEmitType } from "./emitter-types"

export function emitDotShorthand(expression: DotShorthand, context: EmitContext): string {
  if expression.resolvedShorthandOwnerKind != "enum" && expression.resolvedShorthandOwnerKind != "class" {
    panic("Cannot emit unresolved dot shorthand ." + expression.name)
  }
  let owner = expression.resolvedShorthandOwnerName
  if context.modulePath != "" && expression.resolvedShorthandOwnerModule != "" && expression.resolvedShorthandOwnerModule != context.modulePath {
    owner = "::" + exprModuleNamespaceFor(expression.resolvedShorthandOwnerModule) + "::" + owner
  }
  return owner + "::" + cppIdentifier(expression.name)
}

export function emitIfExpression(expression: IfExpression, context: EmitContext): string {
  let elseValue = emitExpression(expression.else_, context)
  case expression.else_ {
    member: MemberExpression -> {
      if member.property == "alias" { elseValue = elseValue + ".value()" }
    }
    _ -> { }
  }
  return "(" + emitExpression(expression.condition, context) + " ? " + emitExpression(expression.then_, context) + " : " + elseValue + ")"
}

export function emitCaseExpression(expression: CaseExpression, context: EmitContext, expected: ResolvedType | null): string {
  let resultType: ResolvedType | null = null
  if expected != null { resultType = expected! }
  else if expression.resolvedType != null { resultType = expression.resolvedType! }
  if resultType == null { panic("Case expression has no resolved result type") }
  let output = "[&]() -> " + emitType(resultType!, context.modulePath) + " {\n"
  output = output + "    auto _case_subject = " + emitExpression(expression.subject, context) + ";\n"
  subjectResult := caseSubjectResultType(expression.subject)
  for arm of expression.arms {
    for pattern of arm.patterns {
      let condition = "true"
      let binding = ""
      case pattern {
        type_: TypePattern -> {
          bindingName := if type_.name == "_" then "" else cppIdentifier(type_.name)
          emitted := emitCaseTypePattern(type_, specializeEmitType(subjectResult, context), "_case_subject", bindingName, context.modulePath)
          condition = emitted.condition
          binding = emitted.binding
        }
        value: ValuePattern -> { condition = "_case_subject == " + emitExpression(value.value, context) }
        _: WildcardPattern -> { condition = "true" }
      }
      output = output + "    if (" + condition + ") {\n"
      if binding != "" { output = output + "        " + binding }
      case arm.body {
        block: Block -> {
          previousYieldState := context.inValueYieldBlock
          context.inValueYieldBlock = true
          output = output + emitBlock(block, 2, context)
          context.inValueYieldBlock = previousYieldState
        }
        bodyExpression: Expression -> { output = output + "        return " + emitExpression(bodyExpression, context, resultType) + ";\n" }
      }
      output = output + "    }\n"
    }
  }
  return output + "    throw std::runtime_error(\"non-exhaustive case expression\");\n}()"
}

function caseSubjectResultType(subject: Expression): ResolvedType {
  if subject.resolvedType == null {
    panic("Case expression subject has no resolved type")
  }
  return subject.resolvedType!
}
