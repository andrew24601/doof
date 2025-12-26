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

Named with {} (arguments can appear in any order):
```doof
configure {
  enableFeatureA: true,
  enableFeatureB: true,
  useCache: false,
  verbose: false
};

// Field shorthand supported if variables are in scope
configure { enableFeatureA, enableFeatureB, useCache, verbose };

// Arguments can be specified in any order
configure { verbose: false, useCache: true, enableFeatureA: false, enableFeatureB: true };
```

Rules:
- Use either () or {}; mixing is not allowed
- All required parameters must be provided
- Named arguments use parameter names; misspelled/extra names are errors
- Arguments can be specified in any order; the compiler reorders them for the target language

### Evaluation order

When named arguments are reordered, the compiler ensures that expressions with side effects are still evaluated in lexical (source) order. For efficiency, side-effect-free expressions (literals, identifiers, simple arithmetic) are not wrapped in temporaries.

```doof
// This evaluates getValue() before getDefault(), even though
// 'value' comes after 'default' in the function signature
function process(default: int, value: int): void { /* ... */ }

process { value: getValue(), default: getDefault() };
// Generates: (let _t0 = getValue(); let _t1 = getDefault(); process(_t1, _t0))
```

C++ mapping: named arguments are syntactic sugar; generated calls are positional.

## Local variables

Use `let` for mutable and `readonly` for immutable variables. `const` for variables is deprecated and will emit a warning.

```doof
let x = "text";
let y: double = 5;
readonly z = 42;
```

Notes:
- For arrays and collections, `readonly` makes the whole object immutable (no content mutation or rebinding), with deep immutability enforced for element/value types.
- For class instances (references), `readonly` prevents rebinding; mutating fields is only allowed if those fields are not readonly.

```doof
readonly arr = [1, 2, 3];
arr[0] = 99; // error: cannot modify contents of a readonly array
// arr = [4, 5, 6]; // error: cannot reassign a readonly variable

let user = User { id: 1, email: "a@b.com" };
user.name = "Bob"; // ok if 'name' field is mutable
readonly user2 = User { id: 2, email: "b@b.com" };
// user2 = User { id: 3, email: "c@b.com" }; // error: cannot rebind readonly variable
```

## Async Functions

Functions can be marked as `async` to indicate they are intended for asynchronous operations.

```doof
async function fetchData(): string {
    // ...
    return "data";
}

// Invoke asynchronously to get a Future
let future = async fetchData();
```

For more details, see the [Async/Await Guide](async-await.md).

## Lambda expressions

See the dedicated guide: ../lambdas.md
