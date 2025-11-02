# Classes and Initialization

Class fields and methods can optionally be marked with the `private` keyword. By default, all members are public unless marked as private. Fields and methods can also be marked with the `static` keyword to indicate they belong to the class rather than instances.

## Fields: const, readonly, default values

Fields in classes can be declared as mutable, immutable (const), or readonly. Const fields provide compile-time and runtime immutability, while readonly fields are set during initialization (object-literal or positional) or within a `static` factory method and are immutable afterward.

### Const fields

Use the `const` keyword before a field declaration in a class:

```doof
class User {
    const id: int = 42;           // const field with default value
    private const role: string = "admin"; // private const field
    name: string;
}

class Point {
    const x: int = 10;
    const y: int = 20;
    z: int;
}
```

### Readonly fields

Use the `readonly` keyword before a field declaration in a class:

```doof
class Person {
    const type: string = "person";  // const field - compile-time constant
    readonly name: string;           // readonly field - set during initialization
    private age: int;                // mutable field
}
```

Rules:
- Const fields must have strict literal default values when present and can never change
- Readonly fields have no default, must be set at initialization (object-literal or positional) or by a `static` factory method
- Mutable fields can be changed any time
- Fields cannot be both `const` and `readonly`

In classes, const fields can be public or private and follow access modifier rules.

### Default values

- Default values for fields (const or not) must be constant literals (number, string, boolean, or enum value)
- Collections, objects, or computed expressions are not allowed as default values for const fields
- If a const field has a default value, it cannot be overridden by initializers or factories
- If a const field has no default, it must be provided at initialization or by a factory method

### Static const fields

```doof
class Config {
    static const VERSION: string = "1.0.0";
    static const MAX_USERS: int = 100;
}
```

- Static const fields must have strict literal initializers
- They map to idiomatic C++ `static const` or `constexpr` where possible

### Immutability and C++ mapping

- Const fields are shallowly immutable: the value (reference or primitive) cannot change
- Readonly fields are initialized once via object-literal/positional/factory and then immutable
- In generated C++, const/readonly fields become `const` data members initialized in the constructor initializer list
- Static const fields map to `static const`/`constexpr`
- Assigning to const/readonly after construction is a C++ compile error

## Object initialization

Doof does not support explicit `constructor` declarations inside classes. Use object-literal or positional initialization, and `static` factory methods for custom logic.

### Object-literal initialization and required fields

```doof
class User {
    id: int;
    name: string = "";
    email: string;
}

// Provide required fields via object-literal
let u1 = User { id: 42, email: "a@b.com" }; // valid
// let u3 = User { name: "NoId" }; // error: 'id' and 'email' are required
```

Note: When using object-literal form outside class scope, only public fields can be initialized. Non-public fields can only be set via object-literal construction from within the class itself (e.g., in a `static` factory method).

#### Initializing private fields in a factory method

```doof
class Secret {
    private key: string;
    private value: int;

    static createWithKey(key: string, value: int): Secret {
        // Allowed inside the class: set private fields via object-literal
        return Secret { key: key, value: value };
    }
}

let s = Secret.createWithKey("abc123", 42); // valid
// let s2 = Secret { key: "hack", value: 99 }; // error: private fields
```

#### Examples

```doof
class Point {
    x: int;
    y: int;
    label: string = "";
}

let p1 = Point { x: 1, y: 2 };
let p2 = Point { x: 3, y: 4, label: "foo" };
```

### Object initialization syntax

Object instances are always created using the object-literal form `{ ... }`. The `new` operator is not supported.

```doof
const p1 = Point { x: 1, y: 2 };
let p2: Point = { x: 3, y: 4 };
let p3 = Task { name: "Important", status: .ACTIVE };

let p4: Point;
p4 = { x: 9, y: 10, label: "bar" };
```

Rules:
- Always use `{ ... }` for initialization
- The class name is only required when the type cannot be inferred
- Assignment to a variable with a class/struct type is allowed
- Field shorthand is supported: `Point { x, y }`

### Positional object initialization

```doof
// Object-literal form (explicit field names)
let p1 = Point { x: 1, y: 2 };
let u1 = User { id: 42, name: "Alice" };

// Positional form (arguments by position)
let p2 = Point(1, 2);
let u2 = User(42, "Alice");
```

### Type-inferred positional initialization (tuple syntax)

```doof
class Point { x: int; y: int; }

let p1: Point = Point(1, 2);
let p2: Point = (1, 2);
```

Supported contexts include assignments with explicit type, reassignments where type is known, returns, arguments, array literals with explicit element type, object field initialization, and default parameter values.

Rules and errors:
1. Target type must be inferable from context
2. Element count must match required positional fields
3. Each element must be type compatible
4. Only public fields can be initialized outside class scope
5. `(expr)` is grouping; tuples require multiple elements

### Rules for positional initialization

1. Type name required before parentheses unless inferred: `Point(1, 2)`; plain `(1, 2)` is invalid without context
2. Parameter order:
   - For classes: matches public field declaration order (unless a positional static factory is provided)
3. Defaults: trailing fields with defaults may be omitted
4. Access control: only public fields from outside the class
5. No mixing: cannot mix positional with object-literal in the same expression

### Examples

```doof
struct Point {
    x: int;
    y: int = 0;
}

let p1 = Point(10, 20);
let p2 = Point(10);      // y uses default 0
```

```doof
class User {
    id: int;
    name: string;
}

let u = User(42, "Alice");
```

### Field initialization precedence

1. Object is created (memory allocated)
2. Field default initializers are applied
3. Fields set via object-literal are assigned

For custom logic after initialization, use a `static` factory method:

```doof
class Example {
    x: int = 1;
    y: int = 2;
    z: int;

    static withZ(zValue: int): Example {
        let inst = Example { z: zValue };
        inst.x = 99; // custom logic
        return inst;
    }
}

let e = Example.withZ(5);
```

### Methods

```doof
class Point {
    x: int;
    y: int;

    move(dx: int, dy: int): void {
        this.x += dx;
        this.y += dy;
    }
}
```

### Extern classes

Doof supports `extern class` declarations for interfacing with user-supplied C++ classes defined in project-local headers.

```doof
extern class Foo {
    field: int;
    function doTheThing(param: string): void;
    static function create(param: int): Foo;
}
```

Features:
- Opaque types; only declared members are accessible
- No direct construction; use static factories
- Type-safe member access; header is included in generated C++

Usage:

```doof
extern class AudioEngine {
    static function initialize(): AudioEngine;
    function playSound(filename: string): void;
    function setVolume(volume: float): void;
}

function main() {
    let engine = AudioEngine.initialize();
    engine.setVolume(0.8);
    engine.playSound("music.wav");
}
```

Generated C++ includes `#include "AudioEngine.h"` and calls the corresponding methods.

## Destructuring patterns (MVP)

Simple destructuring is supported in declarations and assignments and lowers to member access:

```doof
class Point { x: int; y: int; }

function main(): int {
    let p = Point(1, 2);
    // Object pattern (by name)
    let { x, y } = p;    // introduces variables x and y

    // Tuple pattern (by public field order)
    let (a, b) = p;      // maps to a = p.x; b = p.y;

    // Assignments also supported
    { x, y } = p;
    (a, b) = p;
    return x + y + a + b;
}
```

Limitations in MVP:
- Only identifiers in patterns (no aliasing or defaults).
- Tuple pattern order uses the declared public field order of the RHS class.
- No nested patterns yet.
