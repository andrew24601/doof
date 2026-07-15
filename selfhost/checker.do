// Public facade and module-level orchestration for the self-hosted checker.
//
// Focused checker phases operate on CheckerState through module functions.
// ModuleChecker remains as the small stable API consumed by the compiler.

import { AnalysisResult } from "./analyzer"
import { Binding, CheckResult, Diagnostic, Scope } from "./semantic"
import { CheckerState } from "./checker-state"
import { checkStatement, validateInterfaces } from "./checker-statements"
import { collectRetiredActorBindings, reportRetiredActorUses } from "./checker-actor-lifecycle"
import { discoverInterfaceImplementations, findModule } from "./checker-interfaces"
import { predeclareModuleBindings } from "./checker-symbols"
import { validateCheckedTypes as validateCheckedTypesImpl } from "./checker-validation"

export class ModuleChecker {
  state: CheckerState

  function check(entry: string): CheckResult {
    return checkModule(state, entry)
  }
}

// Reset only per-module state; the analysis graph is shared across checks so
// dependency-first checking can decorate every module in the same graph.
function checkModule(state: CheckerState, entry: string): CheckResult {
  state.diagnostics = []
  state.info = findModule(state.result, if entry.endsWith(".do") then entry else entry + ".do")
  if state.info == null { return CheckResult { diagnostics: state.diagnostics } }
  discoverInterfaceImplementations(state.result)
  state.moduleScope = Scope { parent: null }
  predeclareModuleBindings(state.info!, state.moduleScope!, state.result)
  let retiredActors: Binding[] = []
  for statement of state.info!.program.statements {
    checkStatement(state, statement, state.moduleScope!)
    reportRetiredActorUses(statement, retiredActors, state.info!.path, state.diagnostics)
    collectRetiredActorBindings(statement, retiredActors)
  }
  validateInterfaces(state, state.info!)
  return CheckResult { diagnostics: state.diagnostics }
}

export function createChecker(result: AnalysisResult): ModuleChecker {
  return ModuleChecker { state: CheckerState { result } }
}

export function validateCheckedTypes(result: AnalysisResult): Diagnostic[] {
  return validateCheckedTypesImpl(result)
}
