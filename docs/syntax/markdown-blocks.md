# Markdown Blocks in Code

Doof recognizes Markdown-style blocks anywhere statements are permitted. These are line-based and integrate with normal code:

- Headers: lines starting with one or more `#` characters (up to six) are parsed as `markdownHeader` statements. Optional indentation is allowed. Generated output includes matching line comments, e.g. `// ## Subsection`.
- Tables (Rule Tables): consecutive lines that begin with `|` are parsed as a `markdownTable` statement. They are validated and desugared into standard control flow (nested if/else) during compilation.
- Placement: headers and tables can appear at the top level or inside blocks (functions, classes, control‑flow bodies). They consume the entire line and cannot be mixed with other statements on the same line.

## Rule Tables

Rule tables provide a compact way to express conditional logic and conclusions. The general structure:

```
| <header-1> | <header-2> | ... |
| ---        | ---        | ... |
| <cell-1>   | <cell-2>   | ... |
| ...        | ...        | ... |
```

Requirements:
- Every header, separator, and body row must start and end with `|` (surrounding whitespace is ignored).
- A separator row of dashes is required immediately after the header. Alignment markers are accepted (e.g. `:---`, `---:`, `:---:`) but are ignored by code generation.
- Each body row must have the same number of cells as the header. The parser reports a diagnostic if counts differ; missing cells are padded as empty for downstream processing.

### Column kinds (inferred from header)

- Comparison condition column: any non-empty header that parses as an expression. For a row to match, the cell compares against the header expression as described in “Conditional cell values” below.
- Boolean condition column: an empty header cell. Each row’s cell is parsed as a boolean expression; an empty cell means `true`.
- Conclusion declaration column: header starts with `=` followed by an identifier (e.g. `=y`). In a matching row, the cell expression is assigned to that identifier for the row’s actions.
- Conclusion action column: header is `=` with no identifier (e.g. `=`). In a matching row, the cell may contain one or more statements; an empty cell is a no‑op.

If a table contains no conclusion columns (`=name` or bare `=`), validation reports an error.

### Conditional cell values (comparison columns)

Within comparison columns (non‑empty header expression), each row cell can be:
- A single expression, e.g. `1`, `"ok"`, `status.ACTIVE`.
- A comma-separated list of expressions, e.g. `1, 3, 5`.
- A range expression:
	- Inclusive: `a..b` matches values `>= a && <= b`.
	- Exclusive: `a..<b` matches values `>= a && < b`.

Cells may mix single values and ranges via commas (e.g., `1..3, 8, 10..<20`). Empty cells in comparison columns are treated as “no match” for that column.

### Semantics

- Row condition: For each row, conditions across all condition columns (boolean and comparison) are combined with logical AND.
- Table flow: Rows are evaluated top‑to‑bottom. The first matching row executes its conclusions. Compilation desugars the table into nested `if`/`else if`/`else` form preserving order.
- Defaults:
	- Boolean condition column: empty cell => `true`.
	- Comparison condition column: empty cell => no match (i.e., `false`).
	- Declaration conclusion column: empty cell is an error (a value is required).
	- Action conclusion column: empty cell => no statements.

### Examples

Simple equality and list matching with a declaration conclusion:

```
let x: int = 2;
let y: int = -1;

| x     | =y |
| ---   | --- |
| 1     | 10 |
| 2, 3  | 20 |
|       | 0  |

println(y); // -> 20
```

Using ranges (inclusive and exclusive):

```
let score: int = 85;
let grade: string = "";

| score   | =grade        |
| ---     | ---           |
| 90..100 | "A"           |
| 80..89  | "B"           |
| 70..79  | "C"           |
| 60..69  | "D"           |
| 0..<60  | "F"           |

println(grade); // -> "B"
```

Boolean condition columns (empty headers) with expressions:

```
let isAdmin: bool = true;
let isOwner: bool = false;
let canEdit: bool = false;

|            |         | =canEdit |
|------------|---------|----------|
| isAdmin    |         | true     |
|            | isOwner | true     |
|            |         | false    |
```

Notes:
- Comparison headers can be any valid expression (e.g., a variable or member access) and set the discriminant for that column’s comparisons.
- Table alignment markers are accepted but only affect readability; they don’t change semantics.

### Diagnostics

The compiler emits clear diagnostics for common issues:
- Missing separator row after the header.
- Rows whose cell count differs from the header.
- Invalid identifier after `=` in a declaration conclusion header.
- Missing value in a declaration conclusion cell.

Headers and tables participate fully in validation and code generation.
