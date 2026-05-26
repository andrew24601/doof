# C++ Transpiler — Implementation Plan

## Current Status

**Phases 1-10 Complete** (as of February 19, 2026)

- ✅ **Core transpiler implemented** — 6 modules (~3300 lines total)
- ✅ **Full test coverage** — 146 unit tests + 88 end-to-end C++ compilation tests
- ✅ **Proof-of-concept validated** — generated C++ compiles and runs correctly with clang++ -std=c++17
- ✅ **Type mapping complete** — primitives, classes (shared_ptr), interfaces (variant), unions, enums
- ✅ **Runtime support** — `doof_runtime.hpp` with Result<T,E>, panic, println, concat, Range
- ✅ **Lambda capture analysis** — proper by-value/by-reference capture based on binding mutability
- ✅ **this capture in lambdas** — field access in lambdas captures `this` for implicit field references
- ✅ **Interface method dispatch** — `std::visit` for method calls on interface-typed objects
- ✅ **try/try!/try? operators** — IIFE-based Result unwrapping with proper error propagation
- ✅ **is-expression** — `std::holds_alternative` for variant/interface type checks
- ✅ **String interpolation** — `doof::concat()` with `doof::to_string()` for template literals
- ✅ **readonly class bindings** — `shared_ptr<const T>` for deep immutability
- ✅ **Type aliases** — `using Name = CppType;` from TypeAnnotation resolution
- ✅ **Default parameter values** — literal defaults emitted inline in C++ signatures
- ✅ **Enum member access** — `Color.Red` → `Color::Red` via `::` scope resolution
- ✅ **Enum helpers** — `Color_name()` and `Color_fromName()` generated for all enums
- ✅ **Runtime builtin mapping** — `println()` → `doof::println()` etc.
- ✅ **Case expressions** — value patterns, range patterns, wildcard default (IIFE)
- ✅ **For-of with ranges** — `doof::range` / `doof::range_exclusive` iteration
- ✅ **For-of with arrays** — `for x of items { }` → `for (const auto& x : items)` e2e tested
- ✅ **Array/tuple/map literals** — std::vector, std::make_tuple, std::unordered_map e2e tested
- ✅ **Positional destructuring** — `(a, b) := expr` → `const auto [a, b] = expr;` e2e tested
- ✅ **Named destructuring** — `{ x, y } := obj` → individual field accesses with correct by-name semantics (aliases, partial fields, any order)
- ✅ **Weak pointer fields** — `weak parent: Node` → `std::weak_ptr<Node>` with correct ctor params
- ✅ **Higher-order functions** — `doof::callback` parameters compile and run e2e
- ✅ **Recursion** — recursive functions (fibonacci) compile and run correctly
- ✅ **Named constructor field ordering** — args sorted to match class declaration order
- ✅ **Module splitting** — `.hpp`/`.cpp` per module with proper includes and forward declarations
- ✅ **main() wrapper** — Doof `main` → `doof_main()` + C++ `int main()` entry point
- ✅ **Anonymous namespace** — non-exported symbols in anonymous namespace for proper encapsulation
- ✅ **External build metadata generation** — `doof-build.json` handoff for native project integration
- ✅ **Multi-module compilation** — imported functions, classes, enums across modules (e2e tested)
- ✅ **Module initialization** — `_init_module()` functions for `readonly` globals with dependency ordering
- ✅ **Namespace-qualified imports** — `import * as ns from "mod"` with member access → direct symbol reference
- ✅ **Extern C++ interop** — `import class` declarations with header inference, explicit paths, and `as` namespace mapping
- ✅ **Concurrency** — `isolated` functions/methods, `Actor<T>` (thread+queue), `async` dispatch, `Promise<T>` (shared_future)
- ✅ **Mutating methods** — methods can modify `this` fields (no C++ `const` qualifier on methods)

**Test Results:** All 642 tests passing (633 existing + 9 new)

See [§13. Implementation Phases](#13-implementation-phases) for detailed progress.

---

## Design Goals

1. **Readable output** — generated C++ should look like hand-written C++, not compiler IR
2. **Simple transpiler** — walk the decorated AST, emit text; avoid building a C++ AST intermediate
3. **Leverage modern C++** — `std::variant`, `std::shared_ptr`, `std::weak_ptr`, lambdas, structured bindings, `constexpr`
4. **Closed-world** — all modules visible at compile time; enables devirtualization, dead-code elimination

Target: **C++17** (minimum for `std::variant`, structured bindings, `if constexpr`, `std::optional`).

---

## 1. Type Mapping

### 1.1 Primitives

| Doof | C++ |
|------|-----|
| `int` | `int32_t` |
| `long` | `int64_t` |
| `float` | `float` |
| `double` | `double` |
| `string` | `std::string` |
| `char` | `char32_t` |
| `bool` | `bool` |
| `void` | `void` |

Primitives are value types — no heap allocation, no pointers.

### 1.2 Classes → `std::shared_ptr`

Every class instance is heap-allocated and reference-counted:

```doof
class Point { x, y: float }
p := Point(1.0, 2.0)
```

```cpp
struct Point {
    float x;
    float y;
};

auto p = std::make_shared<Point>(Point{1.0f, 2.0f});
```

**Why `shared_ptr` everywhere for classes?** Doof uses reference counting with deterministic destructors. `shared_ptr` gives us exactly that semantics. The generated code stays readable — it's how a C++ programmer would write RC code.

### 1.3 Weak References → `std::weak_ptr`

```doof
class Node {
    weak parent: Node | null
    children: Array<Node>
}
```

```cpp
struct Node {
    std::weak_ptr<Node> parent;     // weak, nullable
    std::vector<std::shared_ptr<Node>> children;
};
```

### 1.4 Nullability — `T | null`

**Decision: Use `std::optional` consistently for primitives and value types. For `shared_ptr`/`weak_ptr`, use the pointer's natural null state.**

| Doof type | C++ type | Null representation |
|-----------|----------|---------------------|
| `int \| null` | `std::optional<int32_t>` | `std::nullopt` |
| `string \| null` | `std::optional<std::string>` | `std::nullopt` |
| `Point \| null` | `std::shared_ptr<Point>` | `nullptr` |
| `weak Point \| null` | `std::weak_ptr<Point>` | `expired()` / `nullptr` |

**Rationale:** Wrapping `shared_ptr` in `optional` adds a redundant boolean — the pointer itself is already nullable. This is how idiomatic C++ works. Primitives don't have a null state, so they use `std::optional`. This is both simpler to implement and produces more natural C++.

### 1.5 Union Types → `std::variant`

```doof
type Shape = Circle | Rectangle | Triangle
```

```cpp
using Shape = std::variant<
    std::shared_ptr<Circle>,
    std::shared_ptr<Rectangle>,
    std::shared_ptr<Triangle>
>;
```

For unions involving primitives and null:

```doof
x: int | string = 42
```

```cpp
std::variant<int32_t, std::string> x = 42;
```

**When a union includes `null`:** fold it into the variant as `std::monostate`:

```doof
x: int | string | null = null
```

```cpp
std::variant<std::monostate, int32_t, std::string> x = std::monostate{};
```

**Exception:** If the union is `T | null` where T is a single class type, skip the variant and just use `shared_ptr<T>` (nullable by nature) as described in §1.4.

**Summary of null-in-unions heuristic (simplicity-first):**

| Pattern | C++ | Reasoning |
|---------|-----|-----------|
| `ClassA \| null` | `std::shared_ptr<ClassA>` | ptr is already nullable |
| `weak ClassA \| null` | `std::weak_ptr<ClassA>` | same |
| `int \| null` | `std::optional<int32_t>` | single-type nullable |
| `int \| string` | `std::variant<int32_t, std::string>` | no null |
| `int \| string \| null` | `std::variant<std::monostate, int32_t, std::string>` | multi-type nullable |
| `ClassA \| ClassB` | `std::variant<shared_ptr<A>, shared_ptr<B>>` | no null |
| `ClassA \| ClassB \| null` | `std::variant<std::monostate, shared_ptr<A>, shared_ptr<B>>` | multi-type nullable |

### 1.6 Collections

| Doof | C++ |
|------|-----|
| `Array<T>` | `std::vector<T>` |
| `readonly Array<T>` | `const std::vector<T>` (or `std::span<const T>` for params) |
| `Map<K, V>` | `std::unordered_map<K, V>` |
| `Set<T>` | `std::unordered_set<T>` |
| `Tuple<A, B, C>` | `std::tuple<A, B, C>` |

### 1.7 Function Types → `doof::callback`

```doof
type Predicate = (x: int): bool
```

```cpp
using Predicate = doof::callback<bool(int32_t)>;
```

### 1.8 Enums

```doof
enum Color { Red, Green, Blue }
```

```cpp
enum class Color { Red, Green, Blue };

// Generated helper for .name / .fromName():
inline const char* Color_name(Color c) { ... }
inline std::optional<Color> Color_fromName(std::string_view s) { ... }
```

For string-valued enums, store a parallel lookup table.

---

## 2. Binding & Variable Mapping

| Doof | C++ | Notes |
|------|-----|-------|
| `const X = 42` | `constexpr auto X = 42;` | Compile-time constant |
| `readonly X = f()` | `const auto X = f();` | Runtime constant, deep immutable |
| `x := expr` | `const auto x = expr;` | Shallow immutable (binding can't change) |
| `let x = expr` | `auto x = expr;` | Mutable |

For `readonly` on class types, the binding uses `std::shared_ptr<const T>` to enforce deep immutability.

For `:=` on class types, the binding is `const std::shared_ptr<T>` — can't reseat the pointer, but the pointee is mutable.

---

## 3. Functions & Lambdas

### 3.1 Top-level Functions

```doof
export function add(a: int, b: int): int => a + b
```

```cpp
int32_t add(int32_t a, int32_t b) {
    return a + b;
}
```

Expression-bodied functions emit a `return` wrapper.

### 3.2 Lambdas → C++ Lambdas

```doof
double = (x: int): int => x * 2
numbers.map((x: int): int => x * 2)
```

```cpp
auto double_ = [](int32_t x) -> int32_t { return x * 2; };
numbers.map([](int32_t x) -> int32_t { return x * 2; });
```

**Capture strategy:**
- Immutable bindings (`:=`, `const`, `readonly`, params): capture by value (or by `const` ref for large types — optimization pass later)
- Mutable bindings (`let`): capture by reference `[&x]`
- `this` in methods: capture `[self = shared_from_this()]` to prevent dangling (class instances are always `shared_ptr`)

The transpiler walks the lambda body to determine which outer names are referenced, then emits an explicit capture list. This is straightforward because `resolvedBinding` on each `Identifier` node tells us exactly where each name comes from.

### 3.3 Parameterless Lambda Form

```doof
inc = => it + 1   // inherits param names from context
```

The checker resolves the implicit parameter. By the time we transpile, the AST has explicit parameters with resolved types — emit as a normal lambda.

---

## 4. Classes

### 4.1 Structure

```doof
class Circle {
    radius: float
    const kind = "circle"
    
    function area(): float => 3.14159 * radius * radius
}
```

```cpp
struct Circle : public std::enable_shared_from_this<Circle> {
    float radius;
    static constexpr const char* kind = "circle";
    
    float area() const {
        return 3.14159f * radius * radius;
    }
};
```

**Rules:**
- All classes `struct` (everything public — Doof has no access modifiers)
- Inherit `std::enable_shared_from_this<T>` (needed for `this` capture in lambdas)
- Methods that don't mutate fields → `const` (can be detected from the checker's analysis, or conservatively default to non-const and optimize later)
- `const` fields → `static constexpr` members
- `readonly` fields → initialized in constructor, then `const` after construction

### 4.2 Construction

Doof has no constructors — objects are created via positional or named initialization:

```doof
c = Circle(5.0)
c2 = Circle { radius: 5.0 }
```

Generate an aggregate-style constructor:

```cpp
auto c = std::make_shared<Circle>(Circle{5.0f});
auto c2 = std::make_shared<Circle>(Circle{.radius = 5.0f}); // C++20 designated inits
```

Or for C++17 compatibility, generate an explicit constructor from the field list:

```cpp
struct Circle : public std::enable_shared_from_this<Circle> {
    float radius;
    
    Circle(float radius) : radius(radius) {}
};
auto c = std::make_shared<Circle>(5.0f);
```

**Recommendation:** Generate explicit constructors for C++17 compatibility. Simpler, and it handles default values naturally.

### 4.3 Destructors

```doof
class FileHandle {
    path: string
    destructor {
        // cleanup code
    }
}
```

```cpp
struct FileHandle : public std::enable_shared_from_this<FileHandle> {
    std::string path;
    
    ~FileHandle() {
        // cleanup code
    }
};
```

Direct mapping — RAII semantics match exactly.

---

## 5. Interfaces → `std::variant` + `std::visit`

Doof interfaces are structural and the compiler is closed-world, so we know at compile time exactly which classes satisfy each interface.

### 5.1 Collecting Implementations

During a pre-emit analysis pass, scan all class declarations to determine which classes implement each interface (the checker already does structural compatibility checks). Build a map: `Interface → [ClassA, ClassB, ...]`.

### 5.2 Emitting Interface Types

```doof
interface Shape {
    function area(): float
}
// Circle and Rectangle implement Shape
```

```cpp
using Shape = std::variant<std::shared_ptr<Circle>, std::shared_ptr<Rectangle>>;
```

### 5.3 Calling Interface Methods

```doof
function printArea(s: Shape): void {
    println(s.area())
}
```

```cpp
void printArea(Shape s) {
    auto area_val = std::visit([](auto&& obj) { return obj->area(); }, s);
    println(area_val);
}
```

`std::visit` with a generic lambda is the cleanest approach — since all variant members share the method name, the generic lambda compiles for each alternative. The transpiler only needs to emit `std::visit` wrappers around member access on interface-typed expressions.

---

## 6. Error Handling — Result Type

### 6.1 Result as Variant

```cpp
template <typename T, typename E>
struct Result {
    std::variant<T, E> _data;
    
    bool isSuccess() const { return _data.index() == 0; }
    bool isFailure() const { return _data.index() == 1; }
    
    T& value() { return std::get<0>(_data); }
    E& error() { return std::get<1>(_data); }
    
    static Result success(T val) { return Result{std::move(val)}; }
    static Result failure(E err) { return Result{std::move(err)}; }
};
```

This is a small runtime support template — part of a `doof_runtime.hpp` header.

### 6.2 `try` Operator → Early Return

```doof
function readConfig(): Result<Config, IOError> {
    text := try readFile("config.json")   // unwrap or propagate
    config := try parseJson(text)
    config
}
```

```cpp
Result<Config, IOError> readConfig() {
    auto _tmp1 = readFile("config.json");
    if (_tmp1.isFailure()) return Result<Config, IOError>::failure(_tmp1.error());
    auto text = std::move(_tmp1.value());
    
    auto _tmp2 = parseJson(text);
    if (_tmp2.isFailure()) return Result<Config, IOError>::failure(_tmp2.error());
    auto config = std::move(_tmp2.value());
    
    return Result<Config, IOError>::success(std::move(config));
}
```

### 6.3 `try!` and `try?`

- `try!` → same pattern but calls `std::abort()` on failure
- `try?` → returns `std::nullopt` on failure (function returns `std::optional<T>`)

---

## 7. Pattern Matching — `case`

### 7.1 Value Patterns

```doof
case x {
    1 => "one"
    2 => "two"
    _ => "other"
}
```

```cpp
[&]() -> std::string {
    switch (x) {
        case 1: return "one";
        case 2: return "two";
        default: return "other";
    }
}()
```

Use an IIFE (immediately-invoked lambda) when `case` is used as an expression. This preserves the expression semantics in C++ cleanly.

### 7.2 Type Patterns on Variants

```doof
case shape {
    c: Circle => c.area()
    r: Rectangle => r.width * r.height
    _ => 0.0
}
```

```cpp
std::visit([](auto&& _val) -> double {
    using T = std::decay_t<decltype(_val)>;
    if constexpr (std::is_same_v<T, std::shared_ptr<Circle>>) {
        auto& c = _val;
        return c->area();
    } else if constexpr (std::is_same_v<T, std::shared_ptr<Rectangle>>) {
        auto& r = _val;
        return r->width * r->height;
    } else {
        return 0.0;
    }
}, shape);
```

### 7.3 Range Patterns

```doof
case score {
    90..100 => "A"
    80..<90 => "B"
}
```

```cpp
[&]() -> std::string {
    if (score >= 90 && score <= 100) return "A";
    if (score >= 80 && score < 90) return "B";
}()
```

---

## 8. Control Flow

These are straightforward 1:1 mappings:

| Doof | C++ |
|------|-----|
| `if / else if / else` | `if / else if / else` |
| `while` with `else` | `while` + bool flag for else |
| `for (init; cond; upd)` | `for (init; cond; upd)` |
| `for x of items` | `for (auto& x : items)` |
| `break @label` | `goto label_break;` (with label at loop end) |
| `continue @label` | `goto label_continue;` (with label at loop top) |

**Labeled loops:** C++ doesn't have labeled `break`/`continue`. Emit `goto` with generated labels — this is standard practice in transpilers and reads fine.

**`if`-expression:** Emit as ternary (`cond ? a : b`) when both branches are simple expressions, otherwise as IIFE.

**`while`/`for` with `else`:** Emit a bool flag `_loop_entered` set to `true` on first iteration; check after loop.

---

## 9. Modules → Translation Units

### 9.1 File Mapping

Each `.do` module produces:
- **`module_name.hpp`** — forward declarations, struct definitions, function declarations
- **`module_name.cpp`** — function bodies, `readonly` initializers

### 9.2 Imports → `#include`

```doof
import { Point, distance } from "./geometry"
```

```cpp
#include "geometry.hpp"
// symbols Point, distance are now available
```

Namespace imports: `import * as geo from "./geometry"` → everything is already in a namespace corresponding to the module:

```cpp
#include "geometry.hpp"
namespace geo = geometry;
```

### 9.3 Visibility

- Exported symbols → declared in `.hpp`
- Non-exported symbols → `static` or anonymous namespace in `.cpp`
- `import type` → include in `.hpp` only (no runtime dependency)

### 9.4 Module Initialization

`readonly` module-level bindings execute at load time. Emit as function-local statics inside a per-module `init()` function, called in dependency order from `main()`:

```cpp
// geometry.cpp
static bool _initialized = false;
void _init_geometry() {
    if (_initialized) return;
    _initialized = true;
    // init dependencies first
    _init_math();
    // then this module's readonly globals
    ...
}
```

### 9.5 Entry Point

```doof
function main(args: string[]): int { ... }
```

```cpp
int main(int argc, char** argv) {
    std::vector<std::string> args(argv, argv + argc);
    _init_all_modules();
    return doof_main(args);
}
```

---

## 10. Extern C++ Class Imports

Doof supports importing external C++ classes so that Doof code can interoperate with existing C++ libraries without wrapping them.

### 10.1 Syntax

Declare the shape of the external class using `import class`:

```doof
// Infer header from class name → "Logger.hpp"
import class Logger {
    log(message: string): void
    setLevel(level: int): void
}

// Explicit header path
import class HttpClient from "./vendor/http.hpp" {
    get(url: string): Result<string, int>
    post(url: string, body: string): Result<string, int>
}
```

**Rules:**
- The body declares the methods and fields Doof code is allowed to use (a structural contract)
- If no `from` clause, the transpiler emits `#include "ClassName.hpp"`
- If `from "path"` is specified, the transpiler emits `#include "path"`
- Extern classes behave exactly like regular Doof classes — they're wrapped in `std::shared_ptr` and reference-counted
- No Doof-side constructor generation — the C++ class must have a matching constructor
- Extern classes can appear in type annotations, function params, and variable bindings

### 10.2 Emitted C++

```doof
import class Logger {
    log(message: string): void
}

function main(): void {
    let logger = Logger()
    logger.log("hello")
}
```

```cpp
#include "Logger.hpp"

int main() {
    auto logger = std::make_shared<Logger>();
    logger->log("hello");
    return 0;
}
```

With an explicit header:

```doof
import class HttpClient from "./vendor/http.hpp" {
    get(url: string): Result<string, int>
}
```

```cpp
#include "./vendor/http.hpp"
```

### 10.3 Fields on Extern Classes

```doof
import class Vec3 from "./math.hpp" {
    x, y, z: float
    length(): float
}

function main(): void {
    v := Vec3(1.0, 2.0, 3.0)
    println(v.x)
    println(v.length())
}
```

```cpp
#include "./math.hpp"

int main() {
    const auto v = std::make_shared<Vec3>(1.0f, 2.0f, 3.0f);
    doof::println(v->x);
    doof::println(v->length());
    return 0;
}
```

Fields are accessed with `->` since extern classes are always `shared_ptr`-wrapped.

### 10.4 Type Checking

The analyzer treats `import class` like a regular class declaration for type-checking purposes — it creates a `ClassSymbol` with the declared fields and methods. The checker validates all usage against the declared contract. Any mismatch between the Doof declaration and the actual C++ class will surface as a C++ compile error, not a Doof error — the Doof side is a trust-me contract.

### 10.5 Namespace Support

For C++ classes in namespaces:

```doof
import class HttpClient from "<httplib.h>" as httplib::Client {
    get(path: string): Result<string, int>
}
```

The `as` clause provides the fully-qualified C++ name. Doof code uses `HttpClient`; emitted C++ uses `httplib::Client`.

---

## 11. Runtime Support Library — `doof_runtime.hpp`

A single header providing:

| Component | Contents |
|-----------|----------|
| `Result<T, E>` | Variant-based Result type with `isSuccess()`, `value()`, `error()` |
| `panic(msg)` | Print message + `std::abort()` |
| `println(...)` | Variadic print (wraps `std::cout`) |
| String interpolation helpers | `doof_concat(...)` for string interpolation segments |
| Range utilities | `doof_range(start, end)`, `doof_range_exclusive(start, end)` |
| Array/Map/Set helpers | Thin wrappers if needed for Doof-specific semantics |

Keep this minimal. The goal is that most Doof constructs map directly to C++ standard library types without runtime wrappers.

---

## 12. Transpiler Architecture

### 12.1 Pipeline Position

```
Source → Lexer → Parser → Analyzer → Checker → Emitter → .hpp/.cpp files
                                                  ↑
                                            (new module)
```

The emitter consumes the **decorated AST** — all `resolvedType`, `resolvedBinding`, and `resolvedSymbol` fields are populated. No additional type analysis needed.

### 12.2 Module Structure

```
src/
  emitter.ts          # Main emitter: walks AST, emits C++       (~275 lines) ✅ IMPLEMENTED
  emitter-types.ts    # Type mapping: ResolvedType → C++ string  (~182 lines) ✅ IMPLEMENTED
  emitter-expr.ts     # Expression emission + lambda captures    (~978 lines) ✅ IMPLEMENTED
  emitter-stmt.ts     # Statement / declaration emission          (~775 lines) ✅ IMPLEMENTED
  emitter-runtime.ts  # Runtime header generation                 (~175 lines) ✅ IMPLEMENTED
  emitter-module.ts   # Module splitting: .hpp/.cpp + CMake       (~890 lines) ✅ IMPLEMENTED
  emitter.test.ts     # Unit tests: Doof source → C++ output     (137 tests)  ✅ IMPLEMENTED
  emitter-e2e.test.ts # End-to-end: compile+run C++ with clang++  (79 tests)   ✅ IMPLEMENTED
```

**Total implementation: ~3275 lines across 6 modules + 216 tests**

### 12.3 Core Emitter Design

```typescript
interface EmitContext {
  /** Current indentation level */
  indent: number;
  /** The module being emitted */
  module: ModuleSymbolTable;
  /** All modules (for interface → variant resolution) */
  allModules: Map<string, ModuleSymbolTable>;
  /** Accumulated header output lines */
  headerLines: string[];
  /** Accumulated source output lines */
  sourceLines: string[];
  /** Interface → implementing classes map (computed once) */
  interfaceImpls: Map<string, ClassSymbol[]>;
  /** Counter for generating unique temp names */
  tempCounter: number;
}

function emitModule(module: ModuleSymbolTable, ctx: EmitContext): void {
  for (const stmt of module.program.statements) {
    emitStatement(stmt, ctx);
  }
}
```

### 12.4 Type Emission

```typescript
function emitType(type: ResolvedType): string {
  switch (type.kind) {
    case "primitive":
      return PRIMITIVE_MAP[type.name]; // "int" → "int32_t", etc.
    case "class":
      return `std::shared_ptr<${type.symbol.name}>`;
    case "interface":
      return type.symbol.name; // emitted as a `using` alias for std::variant
    case "weak":
      return `std::weak_ptr<${emitInnerType(type.inner)}>`;
    case "union":
      return emitUnionType(type);
    case "array":
      return `std::vector<${emitType(type.elementType)}>`;
    case "tuple":
      return `std::tuple<${type.elements.map(emitType).join(", ")}>`;
    case "function":
      return `doof::callback<${emitType(type.returnType)}(${...})>`;
    case "null":
      return "std::monostate";
    case "void":
      return "void";
  }
}
```

### 12.5 Expression Emission

Walk expression nodes, emit C++ text. Key cases:

| AST Node | Emission Strategy |
|----------|-------------------|
| Literals | Direct: `42`, `3.14f`, `"hello"`, `true` |
| Identifiers | Emit name (check `resolvedBinding` for any renaming) |
| Binary ops | `(left op right)` — most operators map 1:1 |
| Member access | `obj->field` (class via shared_ptr), `obj.field` (value type) |
| Optional chain `?.` | `(obj ? obj->field : std::nullopt)` or variant-aware |
| Call | `callee(args...)` |
| Construct | `std::make_shared<T>(T{args...})` |
| Lambda | `[captures](params) -> RetType { body }` |
| If-expression | Ternary or IIFE |
| Case-expression | `std::visit` + `if constexpr` or IIFE + switch |
| String interpolation | `doof_concat(part1, part2, ...)` |
| Array literal | `std::vector<T>{e1, e2, ...}` |
| Map literal | `std::unordered_map<K,V>{{k1,v1}, ...}` |
| Tuple literal | `std::make_tuple(e1, e2, ...)` |
| `is` expression | `std::holds_alternative<T>(x)` |
| Enum access | `EnumName::Variant` |
| `this` | `shared_from_this()` or `this` depending on context |

### 12.6 Statement Emission

| AST Node | Emission Strategy |
|----------|-------------------|
| `const` decl | `constexpr auto name = expr;` |
| `readonly` decl | `const auto name = expr;` |
| `:=` binding | `const auto name = expr;` |
| `let` decl | `auto name = expr;` |
| Function decl | `RetType name(params) { body }` |
| Class decl | `struct Name { fields; methods; };` in header |
| Interface decl | `using Name = std::variant<...>;` in header |
| Enum decl | `enum class Name { ... };` + helpers |
| Return | `return expr;` |
| If/While/For | Direct structural mapping |
| Expression stmt | `expr;` |
| Destructuring | `auto [a, b] = expr;` (C++17 structured bindings) |

---

## 13. Implementation Phases

**Status as of February 18, 2026:**
- ✅ **Phases 1-9 mostly complete** — 137 unit tests + 79 end-to-end C++ compilation tests passing
- ✅ Core modules: `emitter.ts` (~275 lines), `emitter-types.ts` (~182 lines), `emitter-expr.ts` (~978 lines), `emitter-stmt.ts` (~775 lines), `emitter-runtime.ts` (~175 lines), `emitter-module.ts` (~890 lines)
- ✅ Basic class support, enums, and interface aliasing working
- ✅ Runtime support library (`doof_runtime.hpp`) with Result<T,E>, panic, println, concat, Range
- ✅ End-to-end validation: generated C++ compiles and runs correctly with clang++ -std=c++17
- ✅ Lambda capture analysis: by-value for immutable bindings, by-reference for mutable
- ✅ Interface method dispatch via `std::visit` for variant-based interfaces
- ✅ try/try!/try? operator expansion as IIFE with Result unwrapping
- ✅ is-expression emitting `std::holds_alternative` for variant/interface checks
- ✅ String interpolation via `doof::concat()` + `doof::to_string()`
- ✅ Readonly class bindings as `shared_ptr<const T>`
- ✅ Type alias emission: `using Name = CppType;` with full TypeAnnotation resolution
- ✅ Default parameter values emitted inline in C++ function signatures
- ✅ Enum member access: `Color.Red` → `Color::Red` via `::` operator
- ✅ Runtime builtin function mapping: `println()` → `doof::println()` etc.
- ✅ Case expressions: value patterns (IIFE+if-chain), range patterns (inclusive/exclusive)
- ✅ For-of range iteration: `doof::range` / `doof::range_exclusive` compile and run
- ✅ Println/print with output capture verified in e2e tests
- ✅ `this` capture in lambdas: field access captures `this` for class method lambdas
- ✅ Weak pointer fields: `weak` modifier emits `std::weak_ptr<T>` with correct ctor params
- ✅ Array literal e2e: for-of over arrays, index access, println output
- ✅ Tuple literal + positional destructuring e2e
- ✅ Higher-order functions: `doof::callback` parameters compile and run
- ✅ Map literals: `std::unordered_map{...}` emission
- ✅ Recursion: recursive functions (fibonacci) verify correct C++ emission
- ✅ Module splitting: `.hpp`/`.cpp` per module with forward declarations, includes, and anonymous namespace
- ✅ `main()` entry point wrapper: `doof_main()` + C++ `int main()` with arg conversion
- ✅ External build metadata generation for project building
- ✅ Multi-module e2e: imported functions, classes, enums across modules compile and run

### Phase 1: Scaffold + Primitives (MVP) ✅ **COMPLETE**
- [x] `emitter.ts` scaffold with `EmitContext`, file writing
- [x] `emitter-types.ts` — primitive type mapping (int→int32_t, string→std::string, etc.)
- [x] Emit `const`, `readonly`, `:=`, `let` with primitive types
- [x] Emit top-level functions with primitive params/returns
- [x] Emit expression-bodied and block-bodied functions
- [x] Emit basic expressions: literals, binary ops, unary ops, calls, lambdas
- [x] Emit `if`/`while`/`for` statements
- [x] Emit `return`, `break`, `continue` (including labeled break/continue)
- [x] Tests: 56 unit tests covering primitives, functions, control flow, type mapping
- [x] **End-to-end tests**: 15 tests compiling and executing generated C++ with clang++

### Phase 2: Classes + Shared Ownership — **COMPLETE**
- [x] Emit `struct` definitions with `enable_shared_from_this`
- [x] Emit constructors (positional with std::make_shared<T>)
- [x] Emit method definitions
- [x] Emit member access (`->` for shared_ptr)
- [x] Emit destructors
- [x] Emit `weak` fields as `std::weak_ptr` with correct constructor parameter types ✅ IMPLEMENTED
- [x] `readonly` bindings for class types → `shared_ptr<const T>` ✅ IMPLEMENTED
- [x] Tests: class construction, method calls, readonly bindings, weak_ptr fields, multiple class types, method return values verified in e2e tests

### Phase 3: Unions + Pattern Matching — **COMPLETE**
- [x] Emit `std::variant` for union types with null-folding heuristic
- [x] Emit null-in-union heuristic (§1.4/§1.5) — int|null → optional, Class|null → shared_ptr
- [x] Emit `case` expressions — value patterns via IIFE+if-chain ✅ E2E TESTED
- [x] Emit `case` range patterns (inclusive `..` and exclusive `..<`) ✅ E2E TESTED
- [x] Emit `case` type patterns via `std::visit` with `if constexpr` + `std::is_same_v` ✅ FIXED
- [x] Emit `is` expressions as `std::holds_alternative` ✅ IMPLEMENTED
- [x] Tests: union type mapping, case value/range patterns, is-expressions (unit + e2e)

### Phase 4: Interfaces (Closed-World Devirtualization) — **MOSTLY COMPLETE**
- [x] Pre-emit pass: build interface → implementing-classes map
- [x] Emit `using InterfaceName = std::variant<shared_ptr<Class1>, ...>` aliases
- [x] Emit `std::visit` wrappers for interface method calls ✅ IMPLEMENTED
- [x] Emit `std::visit` for interface field access ✅ IMPLEMENTED
- [x] Tests: interface type alias generation, method dispatch working

### Phase 5: Lambdas + Closures — **COMPLETE**
- [x] Emit lambda expressions with capture lists
- [x] Determine captures from `resolvedBinding` provenance ✅ IMPLEMENTED
  - Immutable bindings (const/readonly/:=/param): captured by value
  - Mutable bindings (let): captured by reference
- [x] Handle `this` capture in methods: field access in lambdas captures `this` ✅ IMPLEMENTED
- [x] Emit `doof::callback` for stored lambdas and function-type parameters ✅ E2E TESTED
- [x] Tests: lambda capture by-value and by-reference, this capture, higher-order functions, e2e compilation + execution

### Phase 6: Error Handling — **COMPLETE**
- [x] Emit `doof_runtime.hpp` with `Result<T, E>` template
- [x] Emit `try` → IIFE with early-return expansion ✅ IMPLEMENTED
- [x] Emit `try!` → IIFE with panic expansion ✅ IMPLEMENTED
- [x] Emit `try?` → IIFE with optional conversion ✅ IMPLEMENTED
- [x] Full `Result<T,E>` type integration with checker ✅ IMPLEMENTED
  - `ResultResolvedType` in checker-types.ts with co-variant assignability
  - `resolveTypeAnnotation` handles `Result<T,E>` generic syntax
  - `inferUnaryType` validates `try`/`try!`/`try?` operands are `Result`-typed
  - `try` restricted to functions returning `Result`; `try!`/`try?` allowed anywhere
  - `Promise.get()` infers `Result<T, string>` return type
  - `emitType` maps `Result<T,E>` → `doof::Result<T, E>`
  - Emitter try operators use resolved type info for typed IIFEs
- [x] Tests: 15 checker tests, 8 emitter tests for Result type integration

### Phase 7: Modules + Linking — **COMPLETE**
- [x] Emit `.hpp` / `.cpp` split per module ✅ IMPLEMENTED (`emitter-module.ts`)
- [x] Emit `#include` for imports ✅ IMPLEMENTED (module imports → `.hpp` includes)
- [x] Emit `static` / anonymous namespace for non-exported symbols ✅ IMPLEMENTED
- [x] Emit module initialization chain (topological dependency order) ✅ IMPLEMENTED
- [x] Emit `main()` entry point wrapper (`doof_main()` + C++ `main()`) ✅ IMPLEMENTED
- [x] Generate `doof-build.json` build manifest ✅ IMPLEMENTED
- [x] Tests: multi-module programs, import resolution ✅ 23 unit tests + 10 e2e tests
- [x] `emitModuleSplit()` — single module → `.hpp`/`.cpp` pair ✅ IMPLEMENTED
- [x] `emitProject()` — all modules + runtime + CMake ✅ IMPLEMENTED
- [x] Module initialization runtime (`_init_module()` functions for `readonly` globals) ✅ IMPLEMENTED
- [x] Namespace-qualified imports (`import * as ns from "mod"`) ✅ IMPLEMENTED (checker + emitter)

### Phase 8: Extern C++ Interop — **COMPLETE**
- [x] Parse `import class` declarations (parser: `parseExternClassDeclaration`) ✅ 6 PARSER TESTS
- [x] Analyzer: create `ClassSymbol` with `extern_` metadata from extern class declarations ✅ 6 ANALYZER TESTS
- [x] Emit `#include` for extern class headers (inferred, explicit, angle-bracket) ✅ UNIT + E2E TESTED
- [x] Emit `shared_ptr` wrapping for all extern classes (same as native Doof classes) ✅ E2E TESTED
- [x] Emit fully-qualified C++ names when `as` namespace clause is present ✅ E2E TESTED
- [x] Skip struct/forward-decl generation for extern classes in module split ✅ UNIT TESTED
- [x] Tests: 19 unit tests + 5 e2e tests covering all extern class scenarios

### Phase 9: Collections + Polish — **MOSTLY COMPLETE**
- [x] Emit `std::vector` for array literals ✅ E2E TESTED (creation, for-of iteration, index access)
- [x] Emit `std::unordered_map` for map literals ✅ UNIT TESTED
- [ ] Emit `std::unordered_set` (no Set literal in AST)
- [x] Emit `std::tuple` + structured bindings for destructuring ✅ E2E TESTED
- [x] Emit named destructuring as individual field accesses (by name, not position) ✅ E2E TESTED
- [x] Emit string interpolation via `doof::concat` / `doof::to_string` ✅ TESTED (unit + e2e)
- [x] Emit range expressions (`doof::range` / `doof::range_exclusive`) ✅ E2E TESTED
- [x] Emit `for-of` as range-based for ✅ E2E TESTED (ranges, arrays)
- [x] Emit enums with helper functions (enum class + toString) ✅ E2E TESTED
- [x] Emit enum member access `Color.Red` → `Color::Red` ✅ E2E TESTED
- [x] Emit type aliases `using Name = CppType;` ✅ UNIT + E2E TESTED
- [x] Emit default parameter values ✅ E2E TESTED
- [x] Emit runtime builtin mapping (`println` → `doof::println`) ✅ E2E TESTED
- [x] Emit if-expressions as ternary ✅ E2E TESTED
- [x] Emit assignment operators (`+=`, `-=`, `*=`, etc.) ✅ E2E TESTED
- [x] Emit enum `fromName` helper function (string → optional enum) ✅ UNIT TESTED
- [x] Named constructor field ordering — args sorted by class declaration order ✅ UNIT TESTED
- [x] Complete `doof_runtime.hpp` (Result, panic, println, concat, Range implemented)
- [x] End-to-end test: compile generated C++ with clang++ ✅ **79 tests passing**

### Phase 10: Concurrency — ✅ REDESIGN IN PROGRESS

Implements `Actor<T>` for stateful concurrent domains, actor-call `async`,
`Promise<T>` results, and `retire actor` lifecycle. `isolated` remains parsed
as a compatibility modifier, but it does not authorize worker-pool dispatch.
Based on [spec/10-concurrency.md](../spec/10-concurrency.md).

**C++ Mapping Summary:**

| Doof Concept | C++ Implementation |
|---|---|
| `isolated function` | Compile-time check only; no runtime difference |
| `Actor<T>()` | `std::make_shared<doof::Actor<Counter>>()` — actor with internal thread + message queue |
| `actor.method(args)` (sync) | `actor->call_sync([](T& self) { self.method(args); })` — enqueue + block until complete |
| `async actor.method(args)` | `actor->call_async([](T& self) -> R { return self.method(args); })` → `doof::Promise<R>` |
| `promise.get()` | Returns `doof::Result<T, std::string>` — wraps `std::future` with exception→Result |
| `retire actor` | `actor->retire()` — drains accepted work, stops, and returns inner state |
| `Promise<T>` type | `doof::Promise<T>` — wraps `std::shared_future<T>` |

**Runtime support (`doof_runtime.hpp` additions):**

```cpp
// doof::Actor<T> — single-threaded message queue actor
template <typename T>
class Actor {
    std::unique_ptr<T> instance_;
    std::thread thread_;
    std::queue<std::function<void()>> mailbox_;
    std::mutex mutex_;
    std::condition_variable cv_;
    bool stopped_ = false;
    // ...
public:
    template <typename... Args>
    Actor(Args&&... args);
    template <typename R, typename F> R call_sync(F&& f);
    template <typename R, typename F> doof::Promise<R> call_async(F&& f);
    std::shared_ptr<T> retire();
    ~Actor() { stop(); }
};

// doof::Promise<T> — async result wrapper
template <typename T>
class Promise {
    std::shared_future<T> future_;
public:
    doof::Result<T, std::string> get();
};

```

**Lexer additions:**
- [x] `Async` keyword token
- [x] `Isolated` keyword token

**AST additions:**
- [x] `AsyncExpression` — `async EXPR` wrapping a call, method call, or block
- [x] `ActorCreationExpression` — `Actor<TypeName>(args...)`
- [x] `isolated_` flag on `FunctionDeclaration`

**Parser additions:**
- [x] Parse `async expr` as prefix expression
- [x] Parse `Actor<TypeName>(args...)` as special expression
- [x] Parse `isolated function` modifier

**Checker additions:**
- [x] `ActorType` resolved type wrapping the inner class
- [x] `PromiseType` resolved type wrapping the return type
- [x] Reject worker-pool `async`; `async` is valid only for actor method calls
- [x] Infer `Promise<T>` return type for async expressions
- [ ] Validate actor method parameter/return boundary types

**Emitter additions:**
- [x] Emit `doof::Actor<T>` construction
- [x] Emit `call_sync` / `call_async` for actor method calls
- [x] Emit `retire actor` as `Actor<T>::retire()`
- [x] Emit `doof::Promise<T>` type mapping
- [x] Runtime: `Actor<T>` and `Promise<T>` in `doof_runtime.hpp`
- [x] Include `<thread>`, `<mutex>`, `<future>`, `<queue>`, `<condition_variable>` when concurrency is used

**Tests:**
- [x] Lexer: `async`, `isolated` keywords
- [x] Parser: actor creation, async expressions, isolated functions
- [x] Checker: isolation validation, actor type inference, promise types
- [x] Emitter unit: C++ output for all concurrency constructs
- [x] Emitter e2e: compile and run concurrent C++ programs

---

## 14. Open Questions & Decisions

### 14.1 Resolved: Nullable Pointer Types

**Decision:** Don't wrap `shared_ptr`/`weak_ptr` in `std::optional`. Their null state (`nullptr` / `expired()`) serves as the null representation. Use `std::optional` only for nullable primitives and value types.

### 14.2 Resolved: Interfaces

**Decision:** Closed-world `std::variant` + `std::visit`, not virtual dispatch. Produces readable, efficient C++ and avoids vtable overhead.

### 14.3 `const` vs `constexpr`

For `const` bindings: use `constexpr` when the initializer is a literal or compile-time expression, `const` otherwise. The checker's `resolvedType` tells us the type; we'd need a simple `isConstexpr(expr)` check on the value expression.

**Pragmatic approach for Phase 1:** emit `constexpr` for literal values, `const` for everything else. Refine later.

### 14.4 String Representation

`std::string` is the simplest choice. If performance matters later, consider `std::string_view` for parameters, or a reference-counted string (`shared_ptr<const string>`). Start with `std::string`.

### 14.5 Move Semantics

The transpiler should emit `std::move()` when a value is consumed (last use of a local binding). This is an optimization — skip in early phases, add as a post-emit pass or when emitting assignments/returns.

### 14.6 Header-Only vs Split

For simplicity, Phase 1 could emit a single `.cpp` file per module (all-in-one). Split into `.hpp`/`.cpp` in Phase 7 when multi-module support lands.

**Current implementation:** Phase 1 emits a single C++ source string (no file writing yet). Multi-file output deferred to Phase 7.

### 14.7 Known Limitations (Phase 1)

✅ **What's Working:**
- Primitives, classes (shared_ptr), interfaces (variant aliases), enums
- Functions (expression-body and block-body, default parameter values)
- Control flow (if/while/for, break/continue, labeled loops)
- Lambda capture analysis (by-value for immutable, by-reference for mutable, `this` for field access)
- Union types with null-folding heuristic
- Case expressions (value patterns, range patterns, type patterns via visit)
- If-expressions (ternary emission)
- Binary/unary operators, compound assignment operators, member access
- Enum member access (`Color.Red` → `Color::Red`)
- Interface method dispatch via `std::visit`
- Interface field access via `std::visit`
- `is` expressions via `std::holds_alternative`
- `try`/`try!`/`try?` operators via IIFE expansion
- `readonly` class bindings as `shared_ptr<const T>`
- String interpolation via `doof::concat()` + `doof::to_string()`
- Type aliases (`using Name = CppType;`)
- Runtime builtin mapping (`println()` → `doof::println()`)
- For-of with range iteration (`doof::range` / `doof::range_exclusive`)
- For-of with arrays (range-based for in C++)
- Array literals (`std::vector<T>{...}`) with creation, iteration, index access
- Tuple literals (`std::make_tuple(...)`) and positional destructuring (`const auto [a, b] = ...;`)
- Map literals (`std::unordered_map{...}`)
- Weak pointer fields (`weak parent: Node` → `std::weak_ptr<Node>` with correct ctor params)
- Higher-order functions (`doof::callback` parameters compile and run)
- Recursive functions (verified with fibonacci e2e)
- Module splitting: `.hpp`/`.cpp` per module with forward declarations and includes
- `main()` entry point: `doof_main()` + C++ `int main()` wrapper
- Anonymous namespace for non-exported functions and variables
- External build metadata generation for project building
- Multi-module compilation: imported functions, classes, enums across modules
- Extern C++ class interop: `import class` with `#include` generation, `shared_ptr` wrapping, namespace-qualified names

⏳ **Not Yet Implemented:**
- ~~Named destructuring~~ ← **DONE (individual field accesses by name)**
- Move semantics for last-use optimization
- Pattern matching: nested patterns (guards are not in the spec)
- ~~Error handling: full Result<T,E> type integration with checker~~ ← **DONE (Result type fully integrated with checker and emitter)**
- Dotted type paths in annotations (`geo.Point` as a type from namespace imports — expressions work, types need parser support)
- ~~Concurrency~~ ← **DONE (Phase 10)**
- ~~Named constructors~~ ← **DONE (field ordering fixed)**
- ~~Module initialization chain~~ ← **DONE (module init functions)**
- ~~Namespace-qualified imports~~ ← **DONE (checker + emitter)**
- ~~Extern C++ class imports~~ ← **DONE (Phase 8)**

### 14.8 Known Issues & Areas for Further Investigation

These issues were identified during implementation and should be fixed before the transpiler is considered production-ready.

#### 14.8.1 All Class Methods Emitted as `const`

**Location:** [emitter-stmt.ts](../src/emitter-stmt.ts) — `emitFunctionDeclaration()`, line ~239

**Problem:** Every method inside a class body is unconditionally emitted with the `const` qualifier:
```cpp
void increment() const {      // ← always const
    this->count = count + 1;  // ← ERROR: assignment to field in const method
}
```
This causes a C++ compilation error whenever a method assigns to a field (`this.x = ...`). The Actor E2E test was forced to use only read-only methods to work around this.

**Root cause:** `emitter-stmt.ts` sets `constQualifier = " const"` for any function declaration emitted with `ctx.inClass === true`, regardless of whether the method body mutates `this`.

**Fix:** Walk the method body before emission to check for any `assignment-expression` or `let-declaration` that targets a member expression with an implicit `this` receiver. If found, omit the `const` qualifier. Alternatively, add a `mutating_: boolean` flag to `FunctionDeclaration` AST nodes and let the checker populate it.

#### 14.8.2 `async { block }` Returns `Promise<unknown>` Instead of `Promise<T>` (Obsolete)

**Location:** [checker.ts](../src/checker.ts) — `inferExprTypeInner()`, `async-expression` case

**Problem:** For `async { expr }`, the checker returned `{ kind: "promise", valueType: UNKNOWN_TYPE }` rather than inferring the type of the block's final expression. This was made obsolete by the concurrency redesign: `async` blocks are no longer part of the language model and now receive a semantic diagnostic.

**Fix:** Keep parser support temporarily for migration diagnostics, reject async blocks in the checker, and avoid emitting worker-pool async code.

#### 14.8.3 `KEYWORDS` Object Prototype Pollution (Fixed)

**Location:** [lexer.ts](../src/lexer.ts) — keyword lookup

**Problem (fixed February 19, 2026):** The keyword table was a plain `Record<string, TokenType>` object, meaning identifiers like `toString`, `valueOf`, `constructor`, and `hasOwnProperty` would resolve to their `Object.prototype` counterparts instead of being scanned as identifiers. This caused parse errors when any program used these names (e.g. `println(toString(val))`).

**Fix applied:** Changed `KEYWORDS[value]` to `Object.hasOwn(KEYWORDS, value) ? KEYWORDS[value] : undefined`.

**Remaining risk:** Other lookahead structures in the lexer and parser should be audited for the same pattern. `Map<string, TokenType>` would be safer than a plain object.

#### 14.8.4 Concurrency Includes Always Emitted

**Location:** [emitter-runtime.ts](../src/emitter-runtime.ts) — `generateRuntimeHeader()`

**Problem:** The concurrency headers (`<thread>`, `<mutex>`, `<future>`, `<queue>`, `<condition_variable>`) and the `doof::Actor<T>` / `doof::Promise<T>` template implementations are included in `doof_runtime.hpp` unconditionally, even for programs that don't use any concurrency. This increases compile times and includes unnecessary symbols.

**Fix:** Pass a feature flags argument to `generateRuntimeHeader(usesConcurrency: boolean)`. Set the flag by scanning the module's AST for `actor-creation-expression` or `async-expression` nodes before emission.

#### 14.8.5 Diagnostic Quality Improvements (Implemented)

The following diagnostic pipeline improvements were implemented:

- **Lexer error reporting:** `LexerDiagnostic` interface added to `lexer.ts`. Reports unterminated string literals, unterminated template literals, unterminated block comments, and unexpected/unknown characters with line and column positions.
- **Lexer diagnostics surfacing:** `parseWithDiagnostics()` in `parser.ts` returns lexer diagnostics alongside the parsed program. The analyzer surfaces these as module diagnostics.
- **Parse error span extraction:** When the parser throws a `ParseError`, the analyzer now extracts the structured line/column position into a proper `SourceSpan`, rather than using a zero span.
- **Import span propagation:** `analyzeModuleInternal()` accepts an optional `importSpan` parameter. When a module is not found, the diagnostic uses the import statement's span for accurate error positioning.

---

## 15. Testing Strategy

✅ **Implemented:** Each phase gets a corresponding test suite in `emitter.test.ts`:

```typescript
describe("emitter — primitives", () => {
  it("emits int constant", () => {
    const cpp = emit(`const X = 42`);
    expect(cpp).toContain("constexpr auto X = 42;");
  });
  
  it("emits function with int params", () => {
    const cpp = emit(`function add(a: int, b: int): int => a + b`);
    expect(cpp).toContain("int32_t add(int32_t a, int32_t b)");
    expect(cpp).toContain("return a + b;");
  });
});
```

**Test helper:**
```typescript
function emit(source: string): string {
  const ast = parse(source);
  const analysis = analyze({ "/main.do": source }, "/main.do");
  const typeInfo = check(analysis);
  return emitCpp(analysis.modules.get("/main.do")!, analysis);
}
```

**✅ Current test coverage:**
- **137 unit tests** in `emitter.test.ts` covering:
  - Type mapping (primitives, classes, interfaces, unions, enums, arrays, tuples)
  - Const/readonly/let declarations
  - Functions (expression-body and block-body, default parameters)
  - Control flow (if/while/for, break/continue)
  - Classes with constructors, methods, and weak_ptr fields
  - Enums with helper functions
  - Lambda expressions with proper capture analysis (including `this` capture)
  - Case expressions (value, range, and type patterns)
  - `is` expressions for variant type checking
  - Interface method dispatch via `std::visit`
  - `try`/`try!`/`try?` operator expansion
  - `readonly` class bindings as `shared_ptr<const T>`
  - String interpolation via `doof::concat()`
  - Type aliases (`using Name = CppType;`)
  - For-of with arrays and ranges
  - Map literals as `std::unordered_map`
  - Higher-order functions with `doof::callback` parameters
  - Positional destructuring as structured bindings
  - Module splitting: `.hpp`/`.cpp` generation, pragma once, includes, forward declarations
  - Non-exported symbol visibility (anonymous namespace)
  - `main()` entry point wrapper
  - Multi-module `#include` generation
    - `emitProject()` with project support files
  - Default parameter values in forward declarations
  - Named constructor field ordering (args sorted by class declaration order)
  - Enum `fromName` helper function
  - Module init functions for `readonly` globals
  - Namespace-qualified imports (`import * as ns` → checker binding + emitter resolution)
  
- **79 end-to-end tests** in `emitter-e2e.test.ts`:
  - Compiles generated C++ with `clang++ -std=c++17`
  - Executes resulting binaries and verifies output/exit codes
  - Tests arithmetic, control flow (abs function), loops (sum 1..10), function calls
  - Tests recursive functions (fibonacci)
  - Tests lambda capture by-value (immutable bindings) with correct execution
  - Tests lambda capture by-reference (mutable bindings) with correct execution
  - Tests higher-order functions with `doof::callback` parameter passing
  - Tests string interpolation compilation and runtime output
  - Tests interface variant dispatch compilation
  - Tests readonly class binding compilation
  - Tests array literal creation, for-of iteration, index access, println output
  - Tests tuple creation and positional destructuring
  - Tests weak_ptr field compilation in classes
  - Tests multiple class types interacting
  - Tests case expressions (value, range, wildcard patterns)
  - Tests for-of with inclusive/exclusive ranges
  - Tests if-expressions as ternary
  - Tests enum variant access
  - Tests default parameter values
  - Tests type alias compilation
  - Tests compound assignment operators
  - Tests string comparison and multi-part interpolation
  - Tests module splitting: single module .hpp/.cpp split compiles and runs
  - Tests multi-module: imported functions, classes, enums across modules
  - Tests non-exported function encapsulation across modules
  - Tests cross-module println output
  - Tests namespace-qualified imports (function calls and println output)

---

## 16. Example: Full Translation

### Doof Source

```doof
class Circle {
    radius: float
    function area(): float => 3.14159 * radius * radius
}

class Rectangle {
    width, height: float
    function area(): float => width * height
}

interface Shape {
    function area(): float
}

function totalArea(shapes: Array<Shape>): float {
    let sum = 0.0
    for shape of shapes {
        sum += shape.area()
    }
    sum
}

function main(): void {
    shapes := [
        Circle(5.0) as Shape,
        Rectangle(3.0, 4.0) as Shape
    ]
    println(totalArea(shapes))
}
```

### Generated C++

```cpp
#include "doof_runtime.hpp"
#include <memory>
#include <variant>
#include <vector>
#include <cstdint>
#include <string>

struct Circle : public std::enable_shared_from_this<Circle> {
    float radius;
    
    Circle(float radius) : radius(radius) {}
    
    float area() const {
        return 3.14159f * radius * radius;
    }
};

struct Rectangle : public std::enable_shared_from_this<Rectangle> {
    float width;
    float height;
    
    Rectangle(float width, float height) : width(width), height(height) {}
    
    float area() const {
        return width * height;
    }
};

using Shape = std::variant<std::shared_ptr<Circle>, std::shared_ptr<Rectangle>>;

float totalArea(const std::vector<Shape>& shapes) {
    float sum = 0.0f;
    for (const auto& shape : shapes) {
        sum += std::visit([](const auto& obj) { return obj->area(); }, shape);
    }
    return sum;
}

int main() {
    const std::vector<Shape> shapes = {
        std::make_shared<Circle>(5.0f),
        std::make_shared<Rectangle>(3.0f, 4.0f)
    };
    doof::println(totalArea(shapes));
    return 0;
}
```

**Note how readable the output is.** A C++ developer could maintain this code. That's the goal.
