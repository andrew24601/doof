# Plan: Generics / Template Support for Doof

Add user-defined generics in 4 incremental phases, using **C++ template pass-through** (not Doof-side monomorphisation) for emission. Each phase is independently shippable.

---

### Strategic Decision: C++ Templates vs Monomorphisation

**Recommendation: C++ template pass-through.**

| | C++ Template Pass-through | Doof Monomorphisation |
|---|---|---|
| **Effort** | ~30% of full generics complexity | ~100% — essentially reimplementing C++'s template engine |
| **What Doof does** | Validates param count, infers type args, catches misuse | All of that PLUS tracks all instantiation sites, manages recursive instantiation, deduplicates, handles code bloat |
| **What C++ does** | Instantiation, specialization, code generation | Nothing template-related |
| **Error messages** | Most caught by Doof checker; rare C++ template errors leak through | All caught by Doof |
| **Interface variant pattern** | Needs adaptation (template the variant) | Can enumerate all concrete instantiations |
| **Door open?** | Monomorphisation is a pure emitter change — zero impact on parser, checker, type system | N/A |

The Doof checker will validate generics *before* emission, so users almost never see raw C++ template errors. Monomorphisation can be added later as a pure emitter optimization if ever needed.

---

### Phase 1: Generic Type Aliases (Low effort — already half-done)

Parser already parses `type List<T> = Array<T>` and stores `typeParams`, but the checker ignores them. Fix that.

- Add `TypeVariableType` to `ResolvedType` in src/checker-types.ts
- Implement type parameter substitution in `resolveTypeAnnotation` / `symbolToType` in src/checker.ts
- Emit `template<typename T> using List = std::vector<T>` in src/emitter-decl.ts
- Handle `typevar` kind in `emitType` in src/emitter-types.ts
- ~15 tests

**Enables:** `type Optional<T> = T | null`, `type Pair<A,B> = Tuple<A,B>`, `type Callback<T> = (value: T): void`

---

### Phase 2: Generic Functions (Medium effort, **highest value**)

Enable `function identity<T>(x: T): T { return x }` with call-site type inference.

- Add `typeParams: string[]` to `FunctionDeclaration` in src/ast.ts, parse in src/parser.ts
- Propagate to `FunctionSymbol` in src/types.ts and src/analyzer.ts
- **Type inference at call sites** in src/checker.ts: unify param types against arg types to infer `T`, then specialize the return type
- Extend `Scope` with type variable environment
- Emit `template<typename T>` function prefix in src/emitter-decl.ts
- ~30 tests

**Enables:** `map`, `filter`, `fold`, `identity`, `swap`, `zip` — the most commonly desired generic patterns

---

### Phase 3: Generic Classes (Medium-high effort, high value)

Enable `class Box<T> { value: T }` and `let b: Box<int> = Box { value: 42 }`.

- Add `typeParams: string[]` to `ClassDeclaration` in src/ast.ts, `ClassSymbol` in src/types.ts
- Add `typeArgs?: ResolvedType[]` to `ClassType` in src/checker-types.ts
- Substitute type params in field types, constructor validation, and member access in src/checker.ts
- Emit `template<typename T> struct Box : enable_shared_from_this<Box<T>> { ... }` in src/emitter-decl.ts
- Emit `std::shared_ptr<Box<int32_t>>` for instantiated types in src/emitter-types.ts
- **Important:** Template class definitions must go in `.hpp` files — adapt src/emitter-module.ts module splitting
- JSON serialization for generic classes may be deferred (requires `if constexpr` / SFINAE)
- ~35 tests

**Enables:** `Stack<T>`, `LinkedList<T>`, `Pair<A,B>`, `Tree<T>` — user-defined generic data structures

---

### Phase 4: Generic Interfaces (High effort, medium value)

Enable `interface Container<T> { get(): T }`.

**The core challenge:** Doof emits interfaces as `std::variant<shared_ptr<Impl1>, shared_ptr<Impl2>>`. With generics, you can't enumerate all instantiations.

Three options:

| Option | Approach | Tradeoff |
|--------|----------|----------|
| **A: Template the variant** | `template<typename T> using Container = std::variant<shared_ptr<Box<T>>, shared_ptr<Bag<T>>>` | Simple; requires all implementors share same type params |
| **B: Monomorphise variants only** | Collect all concrete instantiations used in program, materialize specialized variant per instantiation | Handles mixed generic + non-generic implementors; needs whole-program pass |
| **C: Virtual dispatch fallback** | Use vtable-based `unique_ptr<ContainerBase<T>>` for generic interfaces | Different perf characteristics; introduces second dispatch mechanism |

**Recommendation:** Start with **Option A** (template variants) with the restriction that all implementors of a generic interface must be generic over the same type params. Covers the common case (`Iterable<T>`, `Comparable<T>`). Option B can be added later when mixed-arity implementors are needed.

---

### Effort Summary

| Phase | Effort | Value | Cumulative |
|-------|--------|-------|------------|
| Phase 1: Type aliases | Low | Medium | Foundation — type variable infrastructure |
| Phase 2: Functions | Medium | **High** | Most commonly requested feature |
| Phase 3: Classes | Medium-high | **High** | Generic data structures |
| Phase 4: Interfaces | High | Medium | Abstraction over parameterized behavior |

**Phases 1–3 deliver ~90% of the practical value.** Phase 4 can be deferred indefinitely and worked around via type aliases + manual dispatch.

---

### Verification

1. All existing tests pass after each phase (`npm test`)
2. TypeScript compiles cleanly (`npm run build`)
3. E2E: Write `.do` samples using generics, compile and run the generated C++
4. Phase-specific: `List<int>` emits `vector<int32_t>`; `identity<T>(x)` infers T from args; `Box<int>.value` returns `int`; generic interface variant dispatch works with `std::visit`

### Decisions

- **C++ template pass-through** — not monomorphisation
- **Unconstrained type params** — no `<T extends X>` bounds initially
- **Invariant type params** — `Box<int>` ≠ `Box<long>`; variance deferred
- **Template definitions in `.hpp`** — required by C++ template model

### Further Considerations

1. **Method-level type params** (`map<U>(fn: (T) => U): Foo<U>`) — should methods have their own type params independent of the class? Useful, can include in Phase 3 or defer.
2. **Default type arguments** (`type Result<T, E = Error>`) — low-complexity ergonomic win, could include in Phase 1 or 2.
3. **Module splitting** — template declarations MUST go in `.hpp` not `.cpp` per C++ rules. src/emitter-module.ts currently splits declarations across both; generic code must stay header-only.
