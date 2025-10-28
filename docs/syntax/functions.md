# Functions

Top-level declarations (functions, variables, classes) can be marked with `export` to make them available to other modules.

```doof
function greet(name: string): void {
    println("Hello, " + name);
}

int add(a: int, b: int) {
    return a + b;
}
```

## Default parameter values

Parameters can have default values which must be strict literals (number, string, boolean, or enum value). Defaults are applied at the call site in generated C++.

```doof
function greet(name: string = "world"): void {
    println("Hello, " + name);
}

greet();        // Hello, world
greet("Alice"); // Hello, Alice

enum Mode { FAST, SLOW }
function run(mode: Mode = .FAST): void { /* ... */ }

class Calculator {
    multiply(a: int, b: int = 2): int { return a * b; }
}
```

Invalid defaults:
- Computed expressions, arrays, objects, or function calls

## Named argument invocation: {} vs ()

Two styles of invocation are supported.

Positional with ():
```doof
configure(true, true, false, false);
```

Named with {} (arguments must appear in declared order):
```doof
configure {
  enableFeatureA: true,
  enableFeatureB: true,
  useCache: false,
  verbose: false
};

// Field shorthand supported if variables are in scope
configure { enableFeatureA, enableFeatureB, useCache, verbose };
```

Rules:
- Use either () or {}; mixing is not allowed
- All required parameters must be provided
- Named calls use parameter names and must preserve declared order; misspelled/extra names are errors

C++ mapping: named arguments are syntactic sugar; generated calls are positional.

## Local variables

`let` for mutable and `const` for immutable variables.

```doof
let x = "text";
let y: double = 5;
const z = 42;
```

Notes:
- For arrays and collections, `const` makes the whole object immutable (no content mutation or rebinding)
- For class instances (references), `const` prevents rebinding, but contents may still be mutated through the reference

```doof
const arr = [1, 2, 3];
arr[0] = 99; // error: cannot modify contents of a const array
arr = [4, 5, 6]; // error: cannot reassign a const variable

const user = User { id: 1, email: "a@b.com" };
user.name = "Bob"; // ok: contents can change
user = User { id: 2, email: "b@b.com" }; // error: cannot rebind const variable
```

## Lambda expressions

See the dedicated guide: ../lambdas.md
