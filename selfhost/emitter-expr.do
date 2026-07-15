// Expression dispatcher for the self-hosted C++ emitter.
//
// Construct-specific lowering lives in focused modules.  This file owns the
// single decorated-AST dispatch point and the public identifier helper used
// by statement and declaration emission.

import { ActorCreationExpression, ArrayLiteral, AsExpression, AssignmentExpression, AsyncExpression, BinaryExpression, BoolLiteral, CallExpression, CallerExpression, CaseExpression, CharLiteral, ConstructExpression, DoubleLiteral, DotShorthand, Expression, FloatLiteral, Identifier, IfExpression, IndexExpression, IntLiteral, LambdaExpression, LongLiteral, MemberExpression, NullLiteral, ObjectLiteral, RetireExpression, StringLiteral, ThisExpression, TupleLiteral, UnaryExpression } from "./ast"
import { ClassType, ResolvedType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { emitAs, emitAssignment, emitBinary, emitIdentifier, emitIndex, emitMember, emitUnary, cppIdentifier as emitCppIdentifier } from "./emitter-expr-ops"
import { emitCall, emitConstruct } from "./emitter-expr-calls"
import { emitArray, emitChar, emitNullLiteral, emitObject, emitString, emitTuple } from "./emitter-expr-literals"
import { emitCaseExpression, emitDotShorthand, emitIfExpression } from "./emitter-expr-control"
import { emitLambdaExpression } from "./emitter-expr-lambda"
import { decoratedExpressionType, needsNullableVariantPromotion, needsVariantPromotion } from "./emitter-expr-utils"
import { emitClassInnerType, emitType } from "./emitter-types"
import { emitActorCreation, emitAsyncActorCall, emitRetireActor } from "./emitter-expr-actor"
import { moduleDiagnosticPath } from "./emitter-names"

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
    caller: CallerExpression -> {
      functionName := if context.currentFunctionName == "" then "<module>" else context.currentFunctionName
      span := if context.sourceLocationSpanOverride == null then caller.span else context.sourceLocationSpanOverride!.span
      fileName := moduleDiagnosticPath(context.modulePath, true)
      value = "std::make_shared<doof::SourceLocation>(std::string(\"" + fileName + "\"), " + string(span.start.line) + ", std::string(\"" + functionName + "\"))"
    }
    identifier: Identifier -> { value = emitIdentifier(identifier, context) }
    binary: BinaryExpression -> { value = emitBinary(binary, context) }
    unary: UnaryExpression -> { value = emitUnary(unary, context) }
    as_: AsExpression -> { value = emitAs(as_, context) }
    assignment: AssignmentExpression -> { value = emitAssignment(assignment, context) }
    member: MemberExpression -> { value = emitMember(member, context) }
    index: IndexExpression -> { value = emitIndex(index, context) }
    call: CallExpression -> { value = emitCall(call, context, expected) }
    array: ArrayLiteral -> { value = emitArray(array, context, expected) }
    object: ObjectLiteral -> { value = emitObject(object, context, expected) }
    tuple: TupleLiteral -> { value = emitTuple(tuple, context) }
    lambda: LambdaExpression -> { value = emitLambdaExpression(lambda, context, expected) }
    if_: IfExpression -> { value = emitIfExpression(if_, context) }
    case_: CaseExpression -> { value = emitCaseExpression(case_, context, expected) }
    construct: ConstructExpression -> { value = emitConstruct(construct, context) }
    async_: AsyncExpression -> { value = emitAsyncActorCall(async_, context) }
    retire_: RetireExpression -> { value = emitRetireActor(retire_, context) }
    actor: ActorCreationExpression -> { value = emitActorCreation(actor, context) }
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
      else { value = "this->shared_from_this()" }
    }
    _ -> { panic("Unsupported expression in initial C++ emitter: " + expression.kind) }
  }
  sourceType := decoratedExpressionType(expression)
  if needsNullableVariantPromotion(sourceType, expected) {
    return "doof::optional_value(" + value + ")"
  }
  if needsVariantPromotion(sourceType, expected) {
    return "doof::variant_promote<" + emitType(expected!, context.modulePath) + ">(" + value + ")"
  }
  return value
}

export function cppIdentifier(name: string): string { return emitCppIdentifier(name) }

function decimalLiteral(value: string): string {
  if value.contains(".") || value.contains("e") || value.contains("E") { return value }
  return value + ".0"
}
