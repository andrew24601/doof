# Markdown Blocks in Code

doof recognizes Markdown-style documentation blocks anywhere statements are permitted. These blocks are line-based and do not affect runtime semantics; they are emitted as comments in generated output.

- Headers: lines starting with one or more `#` characters (up to six) are parsed as `markdownHeader` statements. Optional indentation is allowed. The generated C++ output includes matching line comments, e.g. `// ## Subsection`.
- Tables: consecutive lines that begin with `|` are parsed as a `markdownTable` statement. A separator row composed of dashes (optionally flanked by `:` to control alignment, e.g. `| :--- | ---: |`) is required immediately after the header. Every header, separator, and body row must start and end with `|` (ignoring surrounding whitespace). Cells are trimmed of surrounding whitespace and padding is added for missing columns.
- Placement: headers and tables can appear at the top level or inside blocks (functions, classes, control-flow bodies). They consume the entire line and cannot be mixed with other statements on the same line.
- Validation: table statements parse successfully but the validator reports an error indicating that markdown tables are not yet supported for code generation. Headers are accepted without errors.
