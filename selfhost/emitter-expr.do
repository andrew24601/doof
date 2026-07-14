// Expression dispatcher for the self-hosted C++ emitter.
//
// Construct-specific lowering lives in focused modules.  This file owns the
// single decorated-AST dispatch point and the public identifier helper used
// by statement and declaration emission.

import { ArrayLiteral, AssignmentExpression, BinaryExpression, BoolLiteral, CallExpression, CaseExpression, CharLiteral, ConstructExpression, DoubleLiteral, DotShorthand, Expression, FloatLiteral, Identifier, IfExpression, IndexExpression, IntLiteral, LambdaExpression, LongLiteral, MemberExpression, NullLiteral, ObjectLiteral, StringLiteral, ThisExpression, TupleLiteral, UnaryExpression } from "./ast"
import { ClassType, ResolvedType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { emitAssignment, emitBinary, emitIdentifier, emitIndex, emitMember, emitUnary, cppIdentifier as emitCppIdentifier } from "./emitter-expr-ops"
import { emitCall, emitConstruct } from "./emitter-expr-calls"
import { emitArray, emitChar, emitNullLiteral, emitObject, emitString, emitTuple } from "./emitter-expr-literals"
import { emitCaseExpression, emitDotShorthand, emitIfExpression } from "./emitter-expr-control"
import { emitLambdaExpression } from "./emitter-expr-lambda"
import { decoratedExpressionType, needsNullableVariantPromotion } from "./emitter-expr-utils"
import { emitClassInnerType } from "./emitter-types"

export function emitExpression(expression: Expression, context: EmitContext, expected: ResolvedType | null = null): string {
  let value = ""
  case expression {
    int_: IntLiteral -> { value = string(int_.value) }
    long_: LongLiteral -> { value = string(long_.value) + "LL" }
    float_: FloatLiteral -> { value = decimalLiteral(string(float_.value)) + "f" }
    double_: DoubleLiteral -> { value = decimalLiteral(string(double_.value)) }
    string_: StringLiteral -> { value = emitString(string_, context) }
    char_: CharLiteral -> { value = emitChar(char_.value) }
    bool_: BoolLiteral -> { value = if bool_.value then "true" else "false" }
    null_: NullLiteral -> { value = emitNullLiteral(expected) }
    identifier: Identifier -> { value = emitIdentifier(identifier, context) }
    binary: BinaryExpression -> { value = emitBinary(binary, context) }
    unary: UnaryExpression -> { value = emitUnary(unary, context) }
    assignment: AssignmentExpression -> { value = emitAssignment(assignment, context) }
    member: MemberExpression -> { value = emitMember(member, context) }
    index: IndexExpression -> { value = emitIndex(index, context) }
    call: CallExpression -> { value = emitCall(call, context, expected) }
    array: ArrayLiteral -> { value = emitArray(array, context, expected) }
    object: ObjectLiteral -> { value = emitObject(object, context, expected) }
    tuple: TupleLiteral -> { value = emitTuple(tuple, context) }
    lambda: LambdaExpression -> { value = emitLambdaExpression(lambda, context) }
    if_: IfExpression -> { value = emitIfExpression(if_, context) }
    case_: CaseExpression -> { value = emitCaseExpression(case_, context, expected) }
    construct: ConstructExpression -> { value = emitConstruct(construct, context) }
    dot: DotShorthand -> { value = emitDotShorthand(dot, context) }
    this_: ThisExpression -> {
      let structThis = false
      if this_.resolvedType != null {
        case this_.resolvedType! {
          class_: ClassType -> { structThis = class_.symbol.kind == "struct" }
          _ -> { }
        }
      }
      if structThis { value = "*this" }
      else if context.currentClassNative { value = "this->shared_from_this()" }
      else {
        value = "*this"
        if expected != null {
          case expected! {
            class_: ClassType -> {
              inner := emitClassInnerType(class_, context.modulePath)
              value = "std::shared_ptr<" + inner + ">(this, [](" + inner + "*) {})"
            }
            _ -> { }
          }
        }
      }
    }
    _ -> { panic("Unsupported expression in initial C++ emitter: " + expression.kind) }
  }
  sourceType := decoratedExpressionType(expression)
  if needsNullableVariantPromotion(sourceType, expected) {
    return "doof::optional_value(" + value + ")"
  }
  return value
}

export function cppIdentifier(name: string): string { return emitCppIdentifier(name) }

function decimalLiteral(value: string): string {
  if value.contains(".") || value.contains("e") || value.contains("E") { return value }
  return value + ".0"
}
