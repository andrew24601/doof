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
