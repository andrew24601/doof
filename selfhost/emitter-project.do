// Monolithic project emission for the first self-hosting bootstrap.
//
// Keeping all analyzed modules in one generated namespace avoids committing to
// a final cross-module ABI before the self-hosted compiler can compile its own
// nominal model. The normal multi-module header planner can be added behind a
// later project-emission boundary.

import { AnalysisResult } from "./analyzer"
import { ModuleEmission, CxxModuleEmitter } from "./emitter-module"
import { Program } from "./ast"

export function emitProject(result: AnalysisResult): ModuleEmission {
  let programs: Program[] = []
  for module of result.modules { programs.push(module.program) }
  return CxxModuleEmitter { moduleName: "selfhost" }.emitPrograms(programs, true)
}
