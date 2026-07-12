// Shared state for the self-hosted emitter's nominal lowering.
//
// This is intentionally smaller than the TypeScript emitter context. It owns
// only the declarations needed by class construction and method field access;
// module dependency state belongs to the module/header planner.

import { ClassDeclaration, ExportDeclaration, FunctionDeclaration, Program, Statement } from "./ast"
import { ImportBinding, NamespaceBinding } from "./semantic"

export class EmitContext {
  classes: ClassDeclaration[]
  functions: FunctionDeclaration[]
  modulePath: string = ""
  namespaceImports: NamespaceBinding[] = []
  imports: ImportBinding[] = []
  currentClass: string = ""
  currentReturnVariantOptional: bool = false
  currentFunctionName: string = ""
}

export function createEmitContext(program: Program): EmitContext {
  return createEmitContextForPrograms([program])
}

export function createEmitContextForPrograms(programs: Program[]): EmitContext {
  let classes: ClassDeclaration[] = []
  let functions: FunctionDeclaration[] = []
  for program of programs {
    for statement of program.statements { collectDeclarations(statement, classes, functions) }
  }
  return EmitContext { classes, functions }
}

export function createEmitContextForModule(program: Program, modulePath: string, allPrograms: Program[] = []): EmitContext {
  let programs = allPrograms
  if programs.length == 0 { programs = [program] }
  context := createEmitContextForPrograms(programs)
  context.modulePath = modulePath
  return context
}

function collectDeclarations(statement: Statement, classes: ClassDeclaration[], functions: FunctionDeclaration[]): void {
  case statement {
    class_: ClassDeclaration -> {
      classes.push(class_)
      for method of class_.methods { functions.push(method) }
    }
    fn: FunctionDeclaration -> { functions.push(fn) }
    export_: ExportDeclaration -> { collectDeclarations(export_.declaration, classes, functions) }
    _ -> { }
  }
}

export function findClass(context: EmitContext, name: string): ClassDeclaration | null {
  for class_ of context.classes { if class_.name == name { return class_ } }
  return null
}

export function findFunction(context: EmitContext, name: string): FunctionDeclaration | null {
  for function_ of context.functions { if function_.name == name { return function_ } }
  return null
}
