// Actor, Promise, async-call, and retirement lowering.

import { ActorCreationExpression, AsyncExpression, Block, CallExpression, Expression, MemberExpression, RetireExpression } from "./ast"
import { ActorType, FunctionType, PromiseType, ResolvedType, VoidType } from "./semantic"
import { EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitClassInnerType, emitContextType } from "./emitter-types"

export function emitActorCreation(expression: ActorCreationExpression, context: EmitContext): string {
  if expression.resolvedType == null { panic("Actor creation is missing its resolved type") }
  case expression.resolvedType! {
    actor: ActorType -> {
      let args = ""
      for i of 0..<expression.args.length {
        if i > 0 { args = args + ", " }
        args = args + emitExpression(expression.args[i], context)
      }
      className := emitClassInnerType(actor.innerClass, context.modulePath)
      return "std::make_shared<doof::Actor<" + className + ">>(" + className + "{" + args + "})"
    }
    _ -> { panic("Actor creation does not have Actor<T> type") }
  }
  return ""
}

export function emitAsyncActorCall(expression: AsyncExpression, context: EmitContext): string {
  case expression.expression {
    _: Block -> { panic("Cannot emit async block; async is only valid for actor method calls") }
    inner: Expression -> {
      case inner {
        call: CallExpression -> {
          case call.callee {
            member: MemberExpression -> {
              if member.object.resolvedType != null {
                case member.object.resolvedType! {
                  actor: ActorType -> { return emitActorMethodCall(call, member, actor, true, context) }
                  _ -> { }
                }
              }
            }
            _ -> { }
          }
        }
        _ -> { }
      }
    }
  }
  panic("Cannot emit non-actor async expression; async is only valid for actor method calls")
  return ""
}

export function emitRetireActor(expression: RetireExpression, context: EmitContext): string {
  return emitExpression(expression.actor, context) + "->retire()"
}

export function emitSyncActorCall(expression: CallExpression, member: MemberExpression, actor: ActorType, context: EmitContext): string {
  return emitActorMethodCall(expression, member, actor, false, context)
}

function emitActorMethodCall(expression: CallExpression, member: MemberExpression, actor: ActorType, async_: bool, context: EmitContext): string {
  object := emitExpression(member.object, context)
  className := emitClassInnerType(actor.innerClass, context.modulePath)
  let methodType: FunctionType | null = null
  if member.resolvedType != null {
    case member.resolvedType! {
      function_: FunctionType -> { methodType = function_ }
      _ -> { }
    }
  }
  let args = ""
  for i of 0..<expression.args.length {
    if i > 0 { args = args + ", " }
    let expected: ResolvedType | null = null
    if methodType != null && i < methodType!.params.length { expected = methodType!.params[i].type_ }
    args = args + emitExpression(expression.args[i].value, context, expected)
  }
  returnType := expression.resolvedType
  if returnType == null { panic("Actor method call is missing its resolved return type") }
  // Actor calls may return compound types containing reached generic nominals.
  // Lower those through the whole-program concrete-type registry just like
  // declarations do, or the lambda signature can reintroduce C++ templates.
  cppReturn := emitContextType(returnType!, context)
  callName := if async_ then "call_async" else "call_sync"
  capture := if args == "" then "[]" else if async_ then "[=]" else "[&]"
  let lambda = capture + "(" + className + "& _self)"
  if cppReturn == "void" {
    lambda = lambda + " { _self." + cppIdentifier(member.property) + "(" + args + "); }"
  } else {
    lambda = lambda + " -> " + cppReturn + " { return _self." + cppIdentifier(member.property) + "(" + args + "); }"
  }
  return object + "->template " + callName + "<" + cppReturn + ">(" + lambda + ")"
}
