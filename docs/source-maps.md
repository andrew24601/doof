# Source Mapping

The doof transpiler provides source mapping support for debugging and error diagnostics. The implementation varies by target:

- **C++ backend**: Uses `#line` preprocessor directives
- **JavaScript backend**: Uses Source Map V3 format (`.js.map` files)

---

## C++ Backend: `#line` Directives

The C++ backend emits `#line` preprocessor directives to map generated code back to the original `.do` source files. This improves compiler diagnostics and debugger navigation.

### Example
```cpp
#line 5 "example.do"
int x = 42;
```
If the compiler reports an error on the next statement, it will reference `example.do:5`.

### Emission Strategy
- Directives are emitted:
  - Before each top-level statement in the generated `.cpp` file.
  - Before each statement inside function/method bodies and blocks.
- Directives are suppressed in header (`.h`) output.
- Redundant consecutive directives (same file + line) are skipped.

### Notes & Limitations
- Column information is not encoded; only file + starting line of an AST node.
- Multi-line generated expansions (e.g. desugared constructs) share a single directive for the originating AST node.
- When source locations are missing for a node (should not happen in normal parsing), no directive is emitted – we fail fast rather than guess.

---

## JavaScript Backend: Source Map V3

The JavaScript backend generates [Source Map V3](https://sourcemaps.info/spec.html) files that map generated JavaScript back to the original `.do` source files. These are widely supported by browsers and debugging tools.

### Example
When transpiling `example.do` to JavaScript with source maps enabled:

```bash
doof example.do --target js --output ./dist
```

This generates:
- `example.js` - The transpiled JavaScript code
- `example.js.map` - The source map file

The generated JavaScript includes a source map reference:
```js
// ... generated code ...
//# sourceMappingURL=example.js.map
```

### Usage with Debugging Tools

Source maps enable:
- **Browser DevTools**: Step through original `.do` code while debugging transpiled JavaScript
- **Node.js**: Stack traces reference original source locations
- **VS Code**: Breakpoints and debugging in original `.do` files

### Emission Strategy
- Source mappings are added at statement boundaries (similar to C++ `#line` directives)
- The source map tracks:
  - Original source file path
  - Original line and column numbers
  - Generated line and column numbers
- The `.js.map` file is written alongside the `.js` output file

### Format
Source maps use the standard Source Map V3 JSON format:
```json
{
  "version": 3,
  "file": "example.js",
  "sources": ["example.do"],
  "mappings": "AAAA,AACC...",
  "names": []
}
```

---

## Disabling Source Mapping

Use the CLI flag:
```bash
--no-line-directives
```
(or alias `--no-lines`) to suppress all source mapping output for both C++ and JavaScript targets.

Programmatic control via `TranspilerOptions`:
```ts
const transpiler = new Transpiler({ 
  target: 'js',
  emitLineDirectives: false 
});
```

When disabled:
- C++: No `#line` directives are emitted
- JavaScript: No `.js.map` file is generated, and no `sourceMappingURL` comment is added

---

## Implementation Notes

### C++ Backend
- Uses preprocessor directives recognized by C/C++ compilers and debuggers
- Zero runtime overhead
- Supported by GCC, Clang, MSVC, and most C++ toolchains

### JavaScript Backend
- Uses the industry-standard Source Map V3 format
- Implemented using the [`source-map`](https://www.npmjs.com/package/source-map) npm package (v0.7.6)
- Compatible with Chrome DevTools, Firefox DevTools, Node.js, VS Code, and other tools
- Minimal runtime overhead (source map files are separate and only loaded when debugging)

### Column Information
- Currently, both backends track line numbers but not column numbers from the original source
- Source mappings reference the starting line of each AST node
- Multi-line generated expansions share a single mapping for the originating AST node

### Missing Source Locations
When source locations are missing for a node (should not happen in normal parsing):
- C++: No `#line` directive is emitted
- JavaScript: No source mapping is added for that statement
We fail fast rather than guess incorrect locations.

---

## Future Improvements

### Planned Enhancements
- **Column-aware mapping**: Track column information for more precise source mapping
- **Optimized source maps**: Optional grouping (emit only on line deltas > 1) to reduce file size
- **Name mappings**: Track identifier names for better debugging experience
- **Multi-file source maps**: Enhanced support for projects with multiple source files
- **Additional targets**: Source mapping for WebAssembly and other future backends

### Advanced Features
- **DWARF integration**: Explore DWARF debug formats for C++ backend as an alternative to `#line`
- **Inline source maps**: Option to embed source maps directly in generated JavaScript files
- **Source content embedding**: Include original source content in source maps for tools without file access
