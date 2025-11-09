# Source Mapping with `#line` Directives

The C++ backend emits `#line` preprocessor directives to map generated code back to the original `.do` source files. This improves compiler diagnostics and debugger navigation.

## Example
```cpp
#line 5 "example.do"
int x = 42;
```
If the compiler reports an error on the next statement, it will reference `example.do:5`.

## Emission Strategy
- Directives are emitted:
  - Before each top-level statement in the generated `.cpp` file.
  - Before each statement inside function/method bodies and blocks.
- Directives are suppressed in header (`.h`) output.
- Redundant consecutive directives (same file + line) are skipped.

## Disabling
Use the CLI flag:
```
--no-line-directives
```
(or alias `--no-lines`) to suppress all `#line` output.

Programmatic control via `TranspilerOptions`:
```ts
const transpiler = new Transpiler({ emitLineDirectives: false });
```

## Notes & Limitations
- Column information is not encoded; only file + starting line of an AST node.
- Multi-line generated expansions (e.g. desugared constructs) share a single directive for the originating AST node.
- When source locations are missing for a node (should not happen in normal parsing), no directive is emitted – we fail fast rather than guess.

## Future Improvements
- Optional grouping (emit only on line deltas > 1) to reduce file size.
- Column-aware mapping via external debug formats (DWARF) if needed.
- Support for additional targets that can consume mapping metadata (e.g. a JS sourcemap analog for a future WASM backend).
