# VM backend – enums unimplemented (limitation)
Context: While running the comprehensive end-to-end integration on the VM backend, a top-level `enum` declaration caused bundling to fail with:

> Project transpilation failed: Unimplemented statement kind: enum
## XML-style Calls Follow-ups

- [ ] Attribute enum shorthand support (`priority=.LOW`) with proper enum type context.
- [ ] Generic type arguments in XML tag heads (e.g., `<List<int> />`) with disambiguation from comparison operators.
- [ ] Support non-array `children` types (single child, union element types) and richer validation.
- [ ] Round-trip formatting support to regenerate XML form from AST/formatter.
- [ ] Attribute spread / defaults and boolean attributes (value-less) semantics.
# JSON handling – improvement backlog

These items were identified during a review of the current JSON implementation (runtime + codegen). They’re not showstoppers but will improve robustness and coverage.

1) Map/Set JSON support
- Problem: _toJSON does not specialize Map<K,V> and Set<T> fields; fallback os << field will not compile because standard containers lack operator<< by default. _fromJSON has no generation for map/set either.
- Proposal: 
  - Add operator<< for std::unordered_map/std::map and std::unordered_set as JSON (keys serialized as strings when appropriate)
  - Extend generateFieldDeserialization to handle map/set using doof_runtime::json::JSONObject iteration
  - Provide runtime helpers (e.g., is_object, get_object) are present; add iteration utilities if needed
- Risk: key type constraints; start with string keys only, validate otherwise.

2) Unicode decode in JSON parser
- Problem: JSONParser only decodes \uXXXX to a single char for codepoints <= 0x7F; otherwise it preserves the literal \uXXXX sequence. Surrogate pairs are not handled.
- Proposal: Implement UTF-8 emission for codepoints, including surrogate pair handling. Keep fast-path for ASCII.
- Risk: added complexity; guard behind thorough tests.

3) Floating-point formatting stability
- Problem: JSONValue serialization uses iostreams for doubles. While acceptable, std::to_chars offers faster, locale-independent formatting and control over precision.
- Proposal: Use to_chars where available to format doubles (and floats) in JSONValue::serialize.
- Risk: minor; keep iostream fallback for older compilers.

4) Union field serialization
- Problem: Class fields of union types fall back to os << field; without a dedicated operator<< this may not serialize as JSON.
- Proposal: Generate a tagged-union serializer for union fields (emit discriminator + payload) consistent with existing union semantics.

5) Better diagnostics for array element type mismatches
- Problem: During deserialization of arrays, element conversions (e.g., item.as_int()) throw generic errors. Messages could include field path and index for clarity.
- Proposal: Wrap element extraction with context (field name + index) in generated code to improve error messages.

6) Pretty-print option
- Enhancement: Optional pretty-print (indent) mode for operator<< to aid debugging. Keep default compact for performance.

7) Consistent API naming
- Observation: Validator mentions doof_runtime::class_to_json, but codegen uses doof_runtime::class_to_json_string (correct). Align internal comments/mappings to avoid confusion.

---

# Rename cleanup – follow-ups

These are non-blocking cleanups after the Domino → Doof rename. Builds/tests are green; items below are polish and repo hygiene.

1) Remove legacy build artifacts
- Context: Multiple generated artifacts under vm/build, ios/*/build_ios, unity/*/build still reference Domino names (DominoVM.h, domino-vm.xcframework, etc.).
- Action: Clean and regenerate all platform builds to remove stale Domino-named outputs. Verify Package.swift points to doof-vm.xcframework only.

2) Unity sample naming consistency
- Context: C# MonoBehaviour and some headers still use "DominoRemoteRunner" class/file names for historical reasons.
- Action: Optionally rename to DoofRemoteRunner across C# and headers. Backward-compatible C API shims are in place (domino_* aliases forward to doof_*).

3) iOS sample namespace
- Context: Objective-C++ sample uses namespace DominoRemoteRunner; functional but inconsistent with Doof branding.
- Action: Optionally rename to DoofRemoteRunner and update exported symbol if public API requires it.

4) Guarded legacy headers
- Context: vm/include/DominoVM.h and vm/include/domino_vm_c.h intentionally emit #error to prevent accidental inclusion.
- Action: Keep as-is until downstreams migrate; then delete physically.

5) CI matrix
- Context: Ensure CI builds Unity/iOS samples or at least validates header/API drift against Doof C API.
- Action: Add lightweight headers-only builds or stub targets to catch regressions early.

---

# VM backend – generics object literal instantiation failure

Context: Running VM codegen for `integration/test-data/generics.do` fails with:

> Project transpilation failed: Unknown field value in class Box

What should happen:
- Monomorphization should produce `Box__primitive_int` and `Box__primitive_string`, and all object literal instantiations should target these names.
- VM codegen should construct objects and set fields for the specialized classes.

What likely happens:
- `ObjectExpression.className` remains `Box` at VM codegen time for the object-literal path, leading to a lookup miss in `getInstanceFieldIndex`.
- `instantiationInfo` and/or `inferredType` aren’t used reliably to recover the specialized class name in VM object creation.

Attempts made:
- VM object code now consults `validationContext.codeGenHints.objectInstantiations` and falls back to `inferredType.name` when class metadata is missing. Error persists, indicating hints may be absent and inferred type may not be specialized at this point.

Next steps:
- Verify that monomorphization rewrites `ObjectExpression.className` and `inferredType` for this program (add a focused unit test on the AST pre-VM-codegen).
- If needed, plumb the expected target type into expression generation (so object creation can pick the specialized class name based on the variable’s annotated type).
- Add a VM integration test mirroring the JS one to assert specialized classes and successful execution against `integration/expected/generics.expected`.

Done when:
- `npx tsx src/cli.ts -t vm -o temp/vm-out integration/test-data/generics.do` succeeds.
- VM runner prints:
  7\n
  generic\n
  7\n
  generics\n

---

# C++ vs VM expression codegen parity gaps

These inconsistencies and smells were found when comparing expression compilation between the C++ and VM backends. They’re actionable and should be aligned for predictable semantics across targets.

1) Non-null assertion semantics (!)
- Current: C++ emits runtime assertion or .value() extraction; VM simply evaluates the operand (no check).
- Risk: VM silently allows nulls where C++ would assert/fail; tests will diverge.
- Fix: In VM, after evaluating operand, emit IS_NULL and either PANIC/ASSERT extern or branch to load operand; consider an intrinsic ASSERT to avoid wiring cost.

2) Optional chaining with computed properties
- Current: VM supports obj?.[key] (computed) via GET_ARRAY/GET_MAP path; C++ optional chain only supports identifier/string property names (no computed index).
- Risk: Feature works on VM but fails on C++.
- Fix: Extend C++ optional-chain codegen to handle computed index by delegating to index-expression path, mirroring VM.

3) Array/String length vs size
- Current: C++ supports both .length and .size for arrays and strings; VM only handles array.length and string.length; map/set expose .size.
- Risk: Program using .size on arrays/strings works on C++ but fails on VM.
- Fix: In VM emitPropertyAccess, add support for array.size and string.size to emit LENGTH_ARRAY/LENGTH_STRING.

4) Map indexing semantics (read)
- Current: C++ generateIndexExpression uses map[key] which inserts default on missing key; VM GET_MAP/GET_MAP_INT reads without insertion.
- Risk: Side-effects diverge (C++ mutates map on read, VM does not).
- Fix: In C++, use .at(key) for read-only index expressions, and reserve operator[] for assignments. This matches VM and avoids accidental mutation.

5) Map.set return value
- Current: VM map.set returns the map (for chaining). C++ emits (map[key] = value) which returns the assigned value.
- Risk: Chaining behavior and types diverge between targets.
- Fix: Change C++ map.set to return the map (e.g., wrap in a comma-expression or helper) or standardize spec to return void/map and update both.

6) Unary plus operator (+x)
- Current: C++ supports unary '+'; VM does not implement it.
- Risk: Programs compiling on C++ fail on VM.
- Fix: In VM unary codegen, implement '+' as a no-op numeric conversion (MOVE / or explicit INT/FLT/DBL identity as needed by inferred type).

7) ++/-- on instance fields
- Current: C++ supports pre/post inc/dec for instance fields; VM has TODO/error (only static fields implemented).
- Risk: Behavior gap on common operators.
- Fix: In VM, load field (GET_FIELD), add/sub 1 with proper type, then SET_FIELD; handle pre/post result semantics mirroring identifier path.

8) String concatenation of non-primitives
- Current: C++ converts non-string primitives and objects (via std::to_string or stream) before '+'; VM relies on ADD_STRING and partial coercions. coerceToType only converts primitives; interpolated strings contain a TODO to coerce to string.
- Risk: Object + string may behave inconsistently or rely on runtime magic; interpolations may concatenate non-strings incorrectly.
- Fix: In VM, before ADD_STRING ensure both operands are strings: extend coerceToType to convert class/externClass/union to string via extern calls (e.g., toString) or a generic stringify helper; complete the TODO in vmgen-object-codegen for interpolated parts.

9) Optional chaining result typing (primitive vs pointer)
- Current: C++ wraps primitive results in std::optional and pointer-like in shared_ptr/nullptr; VM returns null-or-value directly.
- Risk: Semantics are compatible at language level (union with null), but ensure downstream codegen expects these shapes (e.g., non-null assertion and coalesce are consistent). Not a bug, but document the impedance.
- Action: Add validator notes/tests ensuring both backends agree on observable behavior in common patterns (coalesce, truthiness, chaining).

10) Union member/method access
- Current: C++ supports union member access (narrowing/std::visit) and union method calls; VM throws for union method calls and doesn’t special-case union property access.
- Risk: Programs using unions work on C++ but fail on VM.
- Fix: In VM, add union dispatch for member/method via TYPE_OF/variant tag + branching, or a small visit-like pattern; alternatively, have validator desugar into explicit type guards/branches prior to VM codegen.

11) String interpolation boolean formatting
- Current: C++ prints booleans as true/false explicitly for println; VM relies on extern println – formatting depends on runtime.
- Risk: Minor output drift.
- Fix: Ensure VM println extern formats bool consistently; add integration tests for println across types.

12) Division and numeric promotion consistency
- Current: Both use shared coercion inference; validate int/int division behavior (int vs float) matches across targets for inferred result types.
- Action: Add targeted tests for int/int → int, int/float → float, float/float → float in both backends.

Done when:
- The above deltas are addressed or explicitly documented, and parity tests in integration/vm-tests and C++ outputs agree on observable behavior.

---

# C++ string concatenation ergonomics

Context: Authoring Doof code that concatenates string literals and non-string values with `+` sometimes depends on implicit conversions that are awkward in C++ (e.g., `"a" + "b"` is pointer arithmetic in C++ unless one side is `std::string`). Our codegen generally wraps operands correctly, but literal+literal corner cases may arise when simplifying expressions.

Action items:
- Ensure both operands to `+` are coerced to `std::string` in generated C++ when the intended operation is string concatenation, including literal-only cases.
- Audit interpolation and concatenation lowering to avoid emitting raw `const char* + const char*` expressions.
- Add targeted tests mixing string literals, variables, numbers, and user types to guarantee consistent concatenation behavior across C++ and VM.

Done when:
- Concatenation of any combination of literals and expressions produces valid, readable C++17 without relying on unspecified pointer arithmetic.
- VM and C++ outputs agree on observable results for concatenation scenarios.
