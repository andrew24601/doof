# Doof

Doof is a statically typed language that looks like TypeScript and compiles to native C++. The syntax is familiar; the safety guarantees are not.

```javascript
function main(): void {
  println("Hello, Doof!")
}
```

→ transpiles to idiomatic, optimized C++17 with no runtime, no GC, no surprises.

> [!CAUTION]
> Doof is almost entirely AI generated and is more for the author's amusement than for production use.

## What makes it interesting

### No null, no exceptions, no data races — by design

Three of the most common sources of production bugs are ruled out at the language level:

**Nullability is explicit.** There is no `null` unless you ask for it. `string` is always a string. `string | null` says you mean to handle the absent case.

**Errors are values.** Functions that can fail return `Result<T, E>`. The `try` operator threads errors through call chains cleanly, and `try!` / `try?` handle the two common cases without noise:

```javascript
function parseInt(s: string): Result<int, string> {
  if s == "0" { return Success { value: 0 } }
  return Failure { error: "not a number: " + s }
}

function compute(input: string): Result<int, string> {
  try n := parseInt(input)          // propagates Failure automatically
  try result := safeDivide(100, n)
  return Success { value: result }
}

const a = try! parseInt("42")       // unwrap or panic
const b = try? parseInt("bad")      // convert to null on failure
```

**Concurrency is race-free.** The compiler tracks which functions access mutable global state. Only provably `isolated` functions can be dispatched to worker threads. The `Actor<T>` model provides safe stateful concurrency without locks:

```javascript
isolated function fib(n: int): int { ... }  // compiler verifies no shared state

const p1 = async fib(40)     // runs on a worker thread
const p2 = async fib(41)
const r1 = try! p1.get()     // collect results
const r2 = try! p2.get()

const acc = Actor<Accumulator>(0)   // single-threaded actor
acc.add(r1)
acc.add(r2)
println(acc.getTotal())
```

### Immutability as the default

Bindings are immutable by default. You opt into mutation:

```javascript
name := "Alice"          // immutable binding, type inferred
let count = 0            // mutable binding
count = count + 1        // ok
name = "Bob"             // ❌ error: cannot reassign immutable binding
```

`readonly` enforces deeply immutable — safe to share across threads. `const` is a compile-time constant.

### Flexible construction, inferred types

Doof infers types from context wherever the intent is unambiguous, and offers several construction styles so you can match the form to the situation.

#### Positional vs. named class construction
```javascript
class Point { x, y: float }
class User {
    readonly id: int
    name: string
    email: string | null = null
}

// Positional — field declaration order, terse for small value types
p := Point(1.5, 2.5)

// Named — explicit, self-documenting, fields may be omitted if they have defaults
user := User { id: 1, name: "Alice" }

// Shorthand — { name } is sugar for { name: name } when a binding matches the field
id   := 1
name := "Alice"
user := User { id, name }        // equivalent to User { id: id, name: name }
```

#### Positional vs. named function calls

The same two forms apply to function calls. Named arguments use `{` and can appear in any order:
```javascript
function clamp(value: int, min: int, max: int): int {
    if value < min { return min }
    if value > max { return max }
    return value
}

clamp(score, 0, 100)                    // positional — order is the contract
clamp{ value: score, min: 0, max: 100 } // named — order doesn't matter
clamp{ min: 0, max: 100, value: score } // equally valid
```

Named calls are especially useful when a function has several parameters of the same type and the ordering would be easy to get wrong.

#### Construction type inferred from context

When the expected type is known — from a return annotation, a collection element type, or an argument position — you can omit the class name entirely:
```javascript
class Point { x, y: float }
class Rect  { origin: Point; width, height: float }

// Return position — the declared return type supplies the class name
function unit(): Point => { x: 1.0, y: 0.0 }

function bounds(): Rect {
    return { origin: { x: 0, y: 0 }, width: 800.0, height: 600.0 }
    //       ^^^^^^   ^^^^^^^^^^^^^^^^^^^
    //       Rect     Point — inferred from Rect.origin's type
}

// Collection literals — element type drives inference throughout
points: Point[] := [(0, 0), (1, 0), (0.5, 1)]
```

This keeps data-heavy code readable without requiring the class name to appear on every line.

#### Type inference for bindings and return types

The compiler also infers the types of bindings and unambiguous function return types without annotation:
```javascript
ratio  := 0.75              // double
count  := 0                 // int
active := true              // bool
label  := "hello"           // string

// Numeric context narrows literals — no cast needed
x: float  := 3.14           // narrowed from double literal to float
n: long   := 42             // widened from int literal to long

// Return type inferred for unambiguous single-expression functions
function double(x: int) => x * 2
function greet(name: string) => "Hi, ${name}"

// Shorthand lambda infers parameter names and types
numbers.map(=> it * 2)
numbers.filter(=> it > 10)
numbers.reduce(0, => acc + it)
```

### Pattern matching with type narrowing

`case` expressions match on values, ranges, and types. When you match on an interface type, the branch body knows the concrete type:

```javascript
function classify(score: int): string {
  return case score {
    90..100 => "A",
    80..<90 => "B",
    70..<80 => "C",
    _       => "F"
  }
}

function describe(shape: Shape): string {
  return case shape {
    c: Circle    => `circle r=${c.radius}`,
    r: Rectangle => `rect ${r.width}×${r.height}`
  }
}
```

### Closed-world compilation

All source is known at compile time. The compiler uses this to resolve structural interfaces to concrete `std::variant` types in C++, verify concurrency isolation across the whole program, and eliminate dead code. There is no reflection or dynamic dispatch overhead.

### Native C++ interop via `import class`

Doof code can call into C++ libraries by declaring their surface with `import class`. The type checker enforces the declared API; build flags wire up the actual headers and libraries. No FFI boilerplate, no code generation step.

```javascript
import class NativeHttpServer from "./native_http_server.hpp" {
  port: int
  isReady(): bool
  errorMessage(): string
  nextRequest(): NativeRequest
}
```

---

## Quick start

Install:

```bash
npm install --save-dev doof
```

Check, build, and run:

```bash
npx doof check samples/hello.do
npx doof build samples/hello.do
npx doof run   samples/hello.do
```

Each project needs a [`doof.json`](docs/packages.md) at its root. This repository includes one, so the samples above work as-is.

### Local global install for cross-repo testing

If you want the current checkout available across other local repositories, run:

```bash
npm run dev:install-global
```

That does two things:

- builds this repo and runs `npm link`, which makes the `doof` CLI available globally on your machine
- symlinks the Doof personal Copilot skill into `~/.copilot/skills/doof-language`, which makes it available across workspaces in VS Code

If another local repo needs `doof` as a linked package dependency instead of only a global CLI, run `npm link doof` in that repo.

To remove the global link and personal skill symlink later:

```bash
npm run dev:uninstall-global
```

Full CLI reference → [docs/cli.md](docs/cli.md)  
Package system → [docs/packages.md](docs/packages.md)  
Testing → [docs/testing.md](docs/testing.md)

## Language reference

| Document | Contents |
| --- | --- |
| [spec/01-overview.md](spec/01-overview.md) | Design philosophy, compilation model, hello world |
| [spec/02-type-system.md](spec/02-type-system.md) | Primitives, inference, nullability, unions, generics |
| [spec/03-variables-and-bindings.md](spec/03-variables-and-bindings.md) | `const`, `:=`, `let`, destructuring, scope |
| [spec/04-functions-and-lambdas.md](spec/04-functions-and-lambdas.md) | Functions, lambdas, closures |
| [spec/05-operators.md](spec/05-operators.md) | Arithmetic, comparison, null-coalescing, ranges |
| [spec/06-control-flow.md](spec/06-control-flow.md) | If/else, loops, break/continue |
| [spec/07-classes-and-interfaces.md](spec/07-classes-and-interfaces.md) | Classes, interfaces, object construction |
| [spec/08-pattern-matching.md](spec/08-pattern-matching.md) | `case`, value/range/type patterns, narrowing |
| [spec/09-error-handling.md](spec/09-error-handling.md) | `Result`, `try`, `panic` |
| [spec/10-concurrency.md](spec/10-concurrency.md) | Isolation, actors, workers, promises |
| [spec/11-modules.md](spec/11-modules.md) | Imports, exports, re-exports |
| [spec/12-json-serialization.md](spec/12-json-serialization.md) | Auto-generated JSON serialization |

## Samples

| Sample | What it shows |
| --- | --- |
| [`samples/hello.do`](samples/hello.do) | Hello world |
| [`samples/fibonacci.do`](samples/fibonacci.do) | Recursion |
| [`samples/results.do`](samples/results.do) | `Result` types and `try` propagation |
| [`samples/patterns.do`](samples/patterns.do) | `case` expressions and range matching |
| [`samples/closures.do`](samples/closures.do) | Lambdas and captured bindings |
| [`samples/concurrency.do`](samples/concurrency.do) | `isolated`, `async`, `Actor<T>` |
| [`samples/classes.do`](samples/classes.do) | Classes and methods |
| [`samples/sqlite/`](samples/sqlite/) | Native C++ interop — sqlite3 |
| [`samples/http-client/`](samples/http-client/) | Native C++ interop — libcurl |
| [`samples/openai-responses/`](samples/openai-responses/) | Metadata-driven API integration |
| [`samples/solitaire/`](samples/solitaire/) | Full SDL/Metal Klondike app |
| [`samples/seahaven-towers/`](samples/seahaven-towers/) | Full interactive Seahaven Towers app |
| [`samples/hello-package/`](samples/hello-package/) | Remote package import |

## Repository structure

- `src/` — compiler, checker, emitter, CLI, and tests
- `samples/` — runnable example programs
- `spec/` — language specification
- `docs/` — CLI reference, package system, and testing guide
- `playground/` — browser playground

## Development

```bash
npm install
npm run build   # compile TypeScript
npm test        # run compiler test suite
npm run sync:stdlib  # mirror implicit std/* repos into ./stdlib for local reference
```

`npm run sync:stdlib` reads the shared [stdlib-packages.json](stdlib-packages.json) manifest, downloads the matching `https://github.com/doof-lang/*` tag archives, and expands them into the ignored `stdlib/` directory so local docs tooling and AI agents can inspect the current implicit standard library sources.

## Status

Active development. The `src/` sources and `spec/` documents are the authoritative references.