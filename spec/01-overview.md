# Doof Language Specification

## Overview

Doof is a statically-typed, compiled programming language designed around safety, simplicity, and performance. It draws inspiration from JavaScript/TypeScript syntax while enforcing stronger guarantees through its type system and concurrency model.

## Design Philosophy

1. **Safety first** — No data races, no null pointer exceptions, no unhandled errors
2. **Explicitness** — Intent should be clear from the code
3. **Simplicity** — Features should be straightforward without hidden complexity
4. **Composability** — Features work together naturally
5. **Immutability by default** — Mutable state is opt-in, not opt-out

## Key Language Features

- **Strong static typing** with bidirectional type inference
- **Immutability control** via `:=` (shallow), `readonly` (deep), and `const` (compile-time)
- **No null by default** — nullability is explicit via union types (`T | null`)
- **No exceptions** — error handling via `Result` types with `try`/`try!`/`try?`/`??` operators, and `panic` for bugs
- **Pattern matching** via `case` expressions with type capture
- **Concurrency without data races** — isolation, actors, and worker pools
- **ESM-style modules** with static imports/exports
- **Structural interfaces** with nominal classes
- **First-class functions** with named parameters in type signatures

## Compilation Model

Doof uses **closed-world compilation** — all source code is known at compile time. This enables:

- Structural interface resolution to concrete union types
- Complete isolation checking for concurrency safety
- Aggressive optimisation and dead code elimination
- Tree-shaking of unused exports

## Document Structure

This specification is organised into the following sections:

| Document | Contents |
|----------|----------|
| [02-type-system.md](02-type-system.md) | Primitive types, type inference, nullability, unions, generics, readonly |
| [03-variables-and-bindings.md](03-variables-and-bindings.md) | `const`, `:=`, `let`, scope rules, hoisting, destructuring |
| [04-functions-and-lambdas.md](04-functions-and-lambdas.md) | Function declarations, lambdas, closures, parameter inference |
| [05-operators.md](05-operators.md) | Arithmetic, comparison, logical, bitwise, null-coalescing, ranges |
| [06-control-flow.md](06-control-flow.md) | If/else, loops, break/continue, early return |
| [07-classes-and-interfaces.md](07-classes-and-interfaces.md) | Classes, interfaces, object initialisation, destructuring |
| [08-pattern-matching.md](08-pattern-matching.md) | Case expressions, value/range/type matching, type narrowing |
| [09-error-handling.md](09-error-handling.md) | Result types, panic, design rationale |
| [10-concurrency.md](10-concurrency.md) | Isolation, actors, workers, promises, parameter passing rules |
| [11-modules.md](11-modules.md) | Imports, exports, re-exports, module organisation |

## Semicolons

Semicolons are **optional statement terminators**. They may appear after any statement or declaration but are never required. The idiomatic style omits them.

The sole exception is the traditional `for` loop header, where semicolons are **required separators** between the init, condition, and update clauses:

```javascript
for let i = 0; i < 10; i += 1 {
    print(i)
}
```

Semicolons may be used to place multiple statements on a single line, though this is discouraged:

```javascript
let x = 1; let y = 2; let z = 3    // legal but discouraged
```

## Hello World

```javascript
function main(): void {
    print("Hello, Doof!")
}
```

## Quick Taste

```javascript
import { readFile } from "io"

class User {
    readonly id: int
    readonly name: string
    readonly email: string | null = null
}

function processUsers(users: readonly User[]): Map<int, string> {
    result: Map<int, string> := {}
    
    for user of users {
        case user.email {
            null => print("${user.name} has no email"),
            e: string => result.set(user.id, e)
        }
    }
    
    return result
}

users = [
    User { id: 1, name: "Alice", email: "alice@example.com" },
    User { id: 2, name: "Bob" },
    User { id: 3, name: "Charlie", email: "charlie@example.com" }
]

readonly emailMap = processUsers(users)
print("Found ${emailMap.size} users with emails")
```
