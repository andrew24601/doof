// Conditional and pattern-based expression lowering.

import { CaseExpression, DotShorthand, Expression, IfExpression, MemberExpression, NamedType, TypePattern, ValuePattern, WildcardPattern } from "./ast"
import { ResolvedType, ResultResolvedType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { exprModuleNamespaceFor } from "./emitter-expr-utils"
import { emitType } from "./emitter-types"

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
          if subjectResult.kind == "result" {
            case subjectResult {
              subjectResult: ResultResolvedType -> {
                case type_.type_ {
                  named: NamedType -> {
                    if named.name == "Success" {
                      armType := "doof::Success<" + emitType(subjectResult.valueType, context.modulePath) + ">"
                      condition = "std::holds_alternative<" + armType + ">(_case_subject)"
                      if type_.name != "_" { binding = "const auto& " + cppIdentifier(type_.name) + " = std::get<" + armType + ">(_case_subject);\n" }
                    } else if named.name == "Failure" {
                      armType := "doof::Failure<" + emitType(subjectResult.errorType, context.modulePath) + ">"
                      condition = "std::holds_alternative<" + armType + ">(_case_subject)"
                      if type_.name != "_" { binding = "const auto& " + cppIdentifier(type_.name) + " = std::get<" + armType + ">(_case_subject);\n" }
                    }
                  }
                  _ -> { }
                }
              }
              _ -> { }
            }
          }
          if condition == "true" && type_.resolvedType != null {
            case type_.resolvedType! {
              result: ResultResolvedType -> {
                case type_.type_ {
                  named: NamedType -> {
                    if named.name == "Success" {
                      armType := "doof::Success<" + emitType(result.valueType, context.modulePath) + ">"
                      condition = "std::holds_alternative<" + armType + ">(_case_subject)"
                      if type_.name != "_" { binding = "const auto& " + cppIdentifier(type_.name) + " = std::get<" + armType + ">(_case_subject);\n" }
                    } else if named.name == "Failure" {
                      armType := "doof::Failure<" + emitType(result.errorType, context.modulePath) + ">"
                      condition = "std::holds_alternative<" + armType + ">(_case_subject)"
                      if type_.name != "_" { binding = "const auto& " + cppIdentifier(type_.name) + " = std::get<" + armType + ">(_case_subject);\n" }
                    }
                  }
                  _ -> { }
                }
              }
              _ -> {
                armType := emitType(type_.resolvedType!, context.modulePath)
                condition = "std::holds_alternative<" + armType + ">(_case_subject)"
                if type_.name != "_" { binding = "const auto& " + cppIdentifier(type_.name) + " = std::get<" + armType + ">(_case_subject);\n" }
              }
            }
          }
        }
        value: ValuePattern -> { condition = "_case_subject == " + emitExpression(value.value, context) }
        _: WildcardPattern -> { condition = "true" }
      }
      output = output + "    if (" + condition + ") {\n"
      if binding != "" { output = output + "        " + binding }
      output = output + "        return " + emitExpression(arm.body, context, resultType) + ";\n"
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
