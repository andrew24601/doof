# Lambda expressions and function types

Doof supports arrow-style lambdas and first-class function types. Lambdas transpile to idiomatic C++17 lambdas and callable types map to `std::function`.

## Table of Contents

1. [Basic lambda expressions](#basic-lambda-expressions)
2. [Function type declarations](#function-type-declarations)
3. [Concise lambda declaration forms](#concise-lambda-declaration-forms)
4. [Short-form lambdas](#short-form-lambdas)
5. [Trailing lambda syntax](#trailing-lambda-syntax)
6. [Captures and lifetimes](#captures-and-lifetimes)
7. [Type inference](#type-inference)
8. [C++ code generation](#c-code-generation)

## Basic lambda expressions

Lambda expressions use arrow syntax similar to TypeScript/JavaScript:

```doof
// Simple lambda with parameters
const add(a: int, b: int): int => a + b;

// Lambda with block body
const logger(msg: string) => {
    println("Log: " + msg);
    println("Timestamp: " + getCurrentTime());
};

// Lambda with no parameters
const getValue(): int => 42;

// Lambda with single parameter
const double(x: int): int => x * 2;
```

## Function type declarations

Function types can be declared using TypeScript-style syntax:

### Verbose function type syntax

```doof
// Function parameter with explicit type
function process(callback: (value: int): void): void {
    callback(42);
}

// Class field with function type
class EventHandler {
    onClick: (event: MouseEvent): void;
    onSubmit: (data: FormData): boolean;
}

// Variable with function type
const handler: (x: int, y: int): string = (x, y) => `Point(${x}, ${y})`;
```

## Concise lambda declaration forms

Doof supports concise syntax for common lambda declaration patterns:

### Concise function parameters

Instead of verbose function type syntax, you can use function-like parameter declarations:

```doof
// Verbose form
function process(callback: (value: int): void): void {
    callback(42);
}

// Concise form - much cleaner!
function process(callback(value: int)): void {
    callback(42);
}

// With return type
function transform(mapper(input: string): int): int[] {
    // ...
}

// Multiple parameters
function combine(operation(a: int, b: int): int): void {
    // ...
}
```

### Concise lambda variables

For lambda variables, you can omit the explicit type annotation:

```doof
// Verbose form
const doIt: (value: int): void = (value: int):void => println(value);

// Concise form
const doIt(value: int) => println(value);

// With explicit return type
const calculate(x: int, y: int): int => x * y + 1;

// With block body
const complex(data: string) => {
    const parsed = parseData(data);
    processData(parsed);
    return formatResult(parsed);
};
```

### Concise callable class members

Class fields that are function types can use concise callable syntax:

```doof
class Button {
    // Verbose form
    onClick: (event: MouseEvent): void;
    onSubmit: (data: FormData): boolean;
    
    // Concise form
    onHover(event: MouseEvent);
    onFocus();  // No parameters
    onValidate(input: string): boolean;  // With return type
}
```

## Short-form lambdas

When parameter names can be inferred from the function type at the call site, you can use a short form:

```doof
// If map is defined as: map(callback: (it: T): U)
// Parameter name "it" is inferred
const doubled = numbers.map(=> it * 2);

// Multiple parameters are taken in order from the signature
// If reduce is defined as: reduce(initialValue: T, callback: (acc: T, it: T): T)
// Note: initial value comes first
const sum = numbers.reduce(0, => acc + it);

// You can still use explicit parameters if preferred
const doubled = numbers.map((value) => value * 2);
```

## Trailing lambda syntax

When the last parameter of a function is a lambda, you can use trailing syntax:

```doof
// Standard call
numbers.forEach((it) => println(it));

// Trailing lambda - no parentheses needed
numbers.forEach => println(it);

// Trailing block for complex logic
numbers.filter => {
    if (it < 0) return false;
    if (it > 100) return false;
    return it % 2 === 0;
};

// Only works when the next parameter is a function type
processData(inputFile, outputFile) => {
    // This trailing block becomes the callback parameter
    transformData(data);
};
```

### Trailing lambda rules

- Allowed when the next parameter in the function signature is a function type
- Omitted parentheses form is only available after a member expression (e.g., `obj.method => ...`)
- If the function has additional required parameters (after the callback), you must pass them in the regular call parentheses or they must have defaults
- Parameter names are inferred from the function signature

## Captures and lifetimes

The transpiler analyzes captures and emits an appropriate C++ capture list automatically:

- Locals and parameters (read-only): captured by value; the lambda sees a snapshot and outer values are unaffected.
- Locals and parameters (mutated in any lambda): automatically boxed in a shared container and then captured by value. The box is `doof_runtime::Captured<T>` and is shared between the outer scope and all lambdas, so mutations in the lambda are visible to the outer scope.
    - Reads inside lambdas access the underlying value (the transpiler emits `.get()` where needed).
    - Writes/assignments/++/-- operate on the box (the transpiler routes operators to the container), so they update the shared storage.
    - For these cases, the C++ lambda is emitted with `mutable` so the by-value copy of the box can be modified.
- `this`, fields, and globals are captured by reference.
- Built-in functions and global functions are not captured.

Note on boxing: A local or parameter is only boxed when a lambda mutates it. Purely read captures remain plain values and are captured by value without a box.

## Type inference

### Lambda return type inference

```doof
// Return type inferred from context when used inline
const result = numbers.map(x => x * 2);  // Inferred as int[]

// Top-level lambdas can infer return type from the body
const add(a: int, b: int) => a + b;  // Inferred as (int, int) => int

// Parameter types in concise parameter position come from the signature
function process(callback(x: int)): void {
    // Parameter type is known from the function signature
}
```

### Variable type inference

```doof
// Type inferred from lambda signature
const handler(event: MouseEvent) => handleClick(event);
// Equivalent to: const handler: (event: MouseEvent): void = ...

// Return type inferred from body
const calculator(x: int) => x * 2 + 1;  // Returns int
```

## C++ code generation

Doof generates efficient C++ code using `std::function` and C++17 lambdas:

### Function parameters

```doof
// Doof
function process(callback(value: int)): void {
    callback(42);
}

// Generated C++
void process(std::function<void(int)> callback) {
    callback(42);
}
```

### Lambda variables

```doof
// Doof
const add(a: int, b: int): int => a + b;

// Generated C++ (return type is deduced)
auto add = [](int a, int b) { return (a + b); };
```

### Class fields

```doof
// Doof
class Button {
    onClick(event: MouseEvent);
}

// Generated C++ (header)
class Button {
public:
    std::function<void(MouseEvent)> onClick;
};

### Captured mutable locals (implementation detail)

When a local or parameter is mutated inside a lambda, it is compiled as a boxed value so that all closures and the outer scope share the same storage:

```doof
var counter: int = 0;
const inc() => { counter += 1; };
inc();
println(counter); // 1
```

Generates (simplified):

```cpp
doof_runtime::Captured<int> counter = 0;            // boxed at declaration
auto inc = [counter]() mutable { counter += 1; };    // capture the box by value, lambda is mutable
inc();
doof_runtime::println(counter.get());               // reads use .get() when needed
```

Read-only captures are not boxed and are captured by value as plain scalars.
```

## Best practices

1. Use concise forms for readability
2. Prefer const locals when capturing values
3. Use trailing-lambda syntax for DSL-like APIs where it reads better
4. Let the compiler infer types when context is clear; add explicit types for APIs

## Examples

### Event handler setup

```doof
class Application {
    onStart();
    onShutdown(exitCode: int);
    
    function initialize(): void {
        // Concise lambda assignment
        this.onStart = () => {
            initializeComponents();
            loadConfiguration();
        };
        
        this.onShutdown = (code) => {
            saveConfiguration();
            cleanupResources();
            exit(code);
        };
    }
}
```

### Functional processing

```doof
function processData(
    data: string[],
    logger(message: string),
    validator(item: string): boolean
): string[] {
    
    return data
        .filter => validator(it)
        .map => {
            logger(`Processing: ${it}`);
            return it.toUpperCase();
        };
}
```

### Builder pattern with lambdas

```doof
class QueryBuilder {
    function where(condition(row: Row): boolean): QueryBuilder {
        this.conditions.push(condition);
        return this;
    }
    
    function select(mapper(row: Row): any): QueryBuilder {
        this.selectFn = mapper;
        return this;
    }
}

// Usage with trailing lambdas
const results = new QueryBuilder()
    .where => it.age > 18
    .select => ({ name: it.name, email: it.email })
    .execute();
```
