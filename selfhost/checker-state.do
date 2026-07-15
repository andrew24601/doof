// Mutable state shared by the self-hosted checker phases.

import { AnalysisResult, ModuleInfo } from "./analyzer"
import { Diagnostic, Scope } from "./semantic"

export class CheckerState {
  result: AnalysisResult
  diagnostics: Diagnostic[] = []
  info: ModuleInfo | null = null
  moduleScope: Scope | null = null
}

