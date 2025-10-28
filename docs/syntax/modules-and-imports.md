# Modules and File Organization

Each Doof source file (`.do`) is treated as a module. Only symbols explicitly exported from a file are visible to other files.

## Export Declarations
Use `export` to make functions, classes, enums, and variables available to other modules:

```doof
// math.do
export function add(a: int, b: int): int {
    return a + b;
}

export class Calculator {
    result: int = 0;
    
    multiply(a: int, b: int): int {
        return a * b;
    }
}

export enum Operation {
    ADD = "add",
    SUBTRACT = "subtract",
    MULTIPLY = "multiply"
}

export let DEFAULT_PRECISION: int = 2;
```

## Import Declarations
Use `import` to access symbols from other modules:

```doof
// main.do
import { add, Calculator, Operation } from "./math";

function main(): void {
    let sum = add(5, 3);
    let calc = Calculator{ result: 10 };
    let op = Operation.ADD;
    println(`Sum: ${sum}`);
}
```

## Namespaces in Generated C++
Each Doof file is mapped to a C++ namespace derived from its path relative to the configured source root:

- `src/math/operations.do` → `namespace math::operations`
- `utils/string-helpers.do` → `namespace utils::string_helpers`
- `data-processing.do` → `namespace data_processing`

Invalid characters in file/directory names (dashes, spaces, etc.) are converted to underscores.

## Source Root Configuration
Configure source roots via CLI to control namespace mapping:

```bash
doof --source-root src --source-root test *.do
```

This allows files in both `src/` and `test/` directories to map to clean namespaces without prefixes.

## Import Resolution
Imports are resolved to fully-qualified C++ names:

```doof
// Doof import
import { Calculator } from "./math";

// Generated C++ (in header)
using Calculator = math::Calculator;

// Generated C++ (in source)
math::Calculator calc;
```
