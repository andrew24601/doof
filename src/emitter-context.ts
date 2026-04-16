/**
 * EmitContext — shared state threaded through all C++ emission functions.
 *
 * Extracted into its own file to break the cyclic dependency between
 * emitter.ts (which imports emitter-stmt/emitter-expr) and those modules
 * (which need EmitContext).
 */

import type { Block } from "./ast.js";
import type { ModuleSymbolTable, ClassSymbol } from "./types.js";
import type { ResolvedType } from "./checker-types.js";

// ============================================================================
// EmitContext
// ============================================================================

export interface EmitContext {
  /** Current indentation level. */
  indent: number;
  /** The module being emitted. */
  module: ModuleSymbolTable;
  /** All modules (for interface → variant resolution). */
  allModules: Map<string, ModuleSymbolTable>;
  /** Accumulated header output lines. */
  headerLines: string[];
  /** Accumulated source output lines. */
  sourceLines: string[];
  /** Interface → implementing classes map (computed once). */
  interfaceImpls: Map<string, ClassSymbol[]>;
  /** Counter for generating unique temp names. */
  tempCounter: number;
  /** Whether we're currently inside a class declaration. */
  inClass: boolean;
  /** Whether emitted function parameters should include default arguments. */
  emitParameterDefaults?: boolean;
  /** Emit block body helper — wired to emitter-stmt's emitBlockStatements. */
  emitBlock: (block: Block, ctx: EmitContext) => string;
  /** The return type of the current enclosing function (for Result wrapping). */
  currentFunctionReturnType?: ResolvedType;
  /**
   * When inside a catch-expression body, the name of the C++ variable that
   * collects errors.  `try` statements emit `break` + assignment to this
   * variable instead of `return Result::failure(...)`.
   * Stack-like: each nested catch pushes its own name.
   */
  catchVarName?: string;
  /** Expected result type when emitting yield statements inside case-expression arm blocks. */
  caseExpressionYieldType?: ResolvedType;
  /** Active loop controls, used to suppress loop `then` blocks on `break`. */
  loopControls?: { label: string | null; naturalCompletionFlag: string | null }[];
  /**
   * Set of `let` variable names that are captured by any lambda within the
   * current function body.  These variables are heap-boxed via
   * `std::make_shared<T>` so that escaping lambdas don't create dangling
   * references.  Populated by `scanCapturedMutables()` before body emission.
   */
  capturedMutables?: Set<string>;
  /** Concrete type substitutions used when emitting a monomorphized generic clone. */
  typeSubstitution?: Map<string, ResolvedType>;
  /** Override the emitted function name when generating a concrete clone. */
  functionNameOverride?: string;
  /** Skip template emission for monomorphized clones. */
  suppressTemplatePrefix?: boolean;
  /** Lookup from generic call instantiation key to emitted concrete helper name. */
  monomorphizedFunctionNames?: Map<string, string>;
  /** Raw class name override used for explicit class specializations. */
  classNameOverride?: string;
  /** Emit template<> instead of the class's generic template prefix. */
  emitExplicitClassSpecialization?: boolean;
  /** Emit only method declarations inside a class body; definitions are emitted separately. */
  emitMethodBodiesInline?: boolean;
  /** Emit a fully qualified function name for out-of-line method definitions. */
  qualifiedFunctionName?: string;
}
