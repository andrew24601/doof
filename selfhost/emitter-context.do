// Shared state for the self-hosted emitter's nominal lowering.
//
// This is intentionally smaller than the TypeScript emitter context. It owns
// only the declarations needed by class construction and method field access;
// module dependency state belongs to the module/header planner.

import { Program } from "./ast"
import { ImportBinding, NamespaceBinding } from "./semantic"

export class EmitContext {
  modulePath: string = ""
  namespaceImports: NamespaceBinding[] = []
  imports: ImportBinding[] = []
  currentClass: string = ""
  currentClassNative: bool = false
  currentFunctionStatic: bool = false
  currentReturnVariantOptional: bool = false
  currentReturnErrorType: string = ""
  currentFunctionName: string = ""
  genericTypeParams: string[] = []
  tryCounter: int = 0
}

export function createEmitContext(program: Program): EmitContext {
  return createEmitContextForPrograms([program])
}

export function createEmitContextForPrograms(programs: Program[]): EmitContext {
  return EmitContext {}
}

export function createEmitContextForModule(program: Program, modulePath: string, allPrograms: Program[] = []): EmitContext {
  let programs = allPrograms
  if programs.length == 0 { programs = [program] }
  context := createEmitContextForPrograms(programs)
  context.modulePath = modulePath
  return context
}
