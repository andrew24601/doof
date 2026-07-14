// Shared state for the self-hosted emitter's nominal lowering.
//
// This is intentionally smaller than the TypeScript emitter context. It owns
// only the declarations needed by class construction and method field access;
// module dependency state belongs to the module/header planner.

import { Program } from "./ast"
import { ImportBinding, NamespaceBinding, Symbol, TypeSubstitution } from "./semantic"

export class EmitModuleSurface {
  path: string
  exports: Symbol[] = []
  imports: ImportBinding[] = []
  genericTypes: string[] = []
}

export class EmitContext {
  modulePath: string = ""
  namespaceImports: NamespaceBinding[] = []
  imports: ImportBinding[] = []
  moduleSurfaces: EmitModuleSurface[] = []
  currentClass: string = ""
  currentClassNative: bool = false
  currentFunctionStatic: bool = false
  currentReturnErrorType: string = ""
  currentFunctionName: string = ""
  genericTypeParams: string[] = []
  // Concrete Doof monomorphization substitution active while emitting a
  // specialized function, class, or method body.
  substitution: TypeSubstitution | null = null
  concreteFunctionNames: string[] = []
  concreteFunctionKeys: string[] = []
  concreteClassNames: string[] = []
  concreteClassKeys: string[] = []
  nativeTemplateClassKeys: string[] = []
  concreteMethodNames: string[] = []
  concreteMethodKeys: string[] = []
  concreteInterfaceNames: string[] = []
  concreteInterfaceKeys: string[] = []
  // Mutable locals captured by any lambda in the current callable. Their
  // declarations are heap-boxed and every identifier use dereferences the box.
  capturedMutables: string[] = []
  tryCounter: int = 0
}

export function isCapturedMutable(context: EmitContext, name: string): bool {
  for captured of context.capturedMutables { if captured == name { return true } }
  return false
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
