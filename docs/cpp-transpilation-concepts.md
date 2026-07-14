# Doof to C++ Transpilation Concepts

This document explains how important Doof language concepts are currently lowered into C++. It complements [cpp-transpiler-architecture.md](./cpp-transpiler-architecture.md), which describes the emitter's structure, and [source-file-structure.md](./source-file-structure.md), which maps the repository.

Use the spec files for language semantics and these notes for implementation strategy.

## Reading This Document

Each section answers four questions:

- what the Doof concept is
- what broad C++ strategy the emitter uses
- which source files own that lowering
- which tests and specs are the best validation anchors

## Decorated AST as the Lowering Boundary

The most important implementation detail is shared across nearly every concept: lowering happens from the decorated AST, not from raw syntax.

- syntax lives in `src/ast.ts`
- semantic type information comes from `resolvedType`
- binding provenance comes from `resolvedBinding`
- named-type resolution comes from `resolvedSymbol`

When a transpilation bug appears, first verify whether the semantic decoration is already wrong before changing the emitter.

For the self-hosted compiler this is a hard contract, not only a convention.
`selfhost/compiler.do` rejects the graph before emission if any declaration,
annotation, binding, pattern, or expression is missing resolved information or
contains `UnknownType`, including nested generic arguments. The self-hosted
emitter then consumes those decorations directly; it has no declaration scans,
raw-annotation resolution, or unknown-type fallback path.

## Types and Runtime Shapes

### Primitive and Composite Types

Strategy:

- Doof primitives map to direct C++ value types such as `int32_t`, `int64_t`, `float`, `double`, `bool`, and `std::string`
- classes lower to `std::shared_ptr<T>`
- structs lower to direct C++ values (`T`)
- tuples lower to `std::tuple<...>`
- Doof-visible function values lower to actor-affine
  `doof::callback<R(Args...)>` values, including function-typed parameters in
  bodiless extern declarations; raw `std::function` remains only for runtime
  internals
- arrays, maps, and sets lower to shared runtime container wrappers
- string indexing and `.charAt()` lower to the shared bounds-checked
  `doof::string_at` runtime helper
- `char` literals lower to escaped C++ universal character literals in the
  self-hosted emitter, so their spelling remains stable when a generated
  compiler parses and emits its own source; the bootstrap runtime provides
  explicit one-character conversions for both C++ `char` and `char32_t`
- `Range` lowers to `doof::Range`, preserving the lower bound and normalizing
  the upper bound to an exclusive value for member accessors

Primary modules:

- `src/emitter-types.ts`
- `src/emitter-defaults.ts`
- `selfhost/emitter-expr.do`
- `selfhost/driver.do`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-advanced.test.ts`
- `selfhost/bootstrap.test.do`
- `spec/02-type-system.md`

### Nullability and Unions

Strategy:

- nullable shapes are lowered differently depending on runtime representation
- pointer-like nullability uses pointer/null forms when possible
- value-like nullable unions, including `Struct | null`, use optional or variant-style lowering
- when checked source types are non-null but the emitted AST field or call
  parameter is a nullable multi-arm union, the self-hosted emitter promotes the
  value through `doof::optional_value(...)`; the checker must decorate the
  target expression so this decision is available at the emission boundary
- broader unions use one flattened `std::variant` shape and explicit extraction
  or coercion helpers; aggregate aliases such as `Expression` are spliced into
  the outer alternative list rather than producing nested variants
- self-hosted class-field lowering keeps the emitted carrier aligned with its
  initializer: when a nullable aggregate alias default emits
  `std::monostate{}`, a missing leading `std::monostate` alternative is restored
  in the field and constructor-parameter type
- self-hosted aggregate alternatives use stable canonical ordering so equivalent
  unions such as `Expression | Block` and `Block | Expression` reuse the same
  generated carrier shape
- named construction applies the same contextual union promotion to explicit
  and shorthand properties; explicit values flow through `emitExpression`,
  while shorthand properties use their checker-decorated property type because
  they have no expression node. `LambdaExpression.body` uses
  `doof::with_block(...)` for both `body: value` and `body`

Primary modules:

- `src/emitter-types.ts`
- `src/emitter-json-value.ts`
- `src/emitter-narrowing.ts`
- `src/emitter-expr-ops.ts`
- `selfhost/emitter-expr-calls.do`

Validation anchors:

- `src/emitter-advanced.test.ts`
- `src/emitter-e2e-advanced.test.ts`
- `spec/02-type-system.md`
- `selfhost/compiler.test.do`
- `selfhost/samples/lambda-body-union.do`

## Functions, Lambdas, and Generic Calls

### Module Identity and Cross-Module References

Strategy:

- every generated Doof module lowers into a deterministic logical C++
  namespace: packaged modules use their package `doof.json` name followed by
  their package-relative path, so the same package keeps the same namespace
  when compiled directly or as a dependency
- cross-module calls, values, and type references use the canonical defining-module namespace rather than import aliases
- self-hosted emission receives logical-prefix/package-name ownership from the
  reached manifest set and uses the same package-stable namespace for module
  bodies, types, calls, and declaration references; the longest owned prefix
  wins for nested acquisition overrides
- module-local declarations and references keep local C++ spellings within their owning namespace, so qualification marks a real module boundary rather than merely adding noise
- lossy namespace-component sanitisation is validated up front, so sibling
  source names such as `foo-bar` and `foo_bar` are rejected instead of being
  silently disambiguated with generated suffixes
- namespace-member lowering consumes checker decoration for the resolved exported symbol instead of re-resolving raw syntax during emission
- re-exported names lower directly to the original defining symbol; extern C++ symbols keep their native `cppName`
- native interop receives only scoped bridge aliases for the Doof types required by native headers; those aliases are an ABI aid, not a second generated module surface
- Doof-bodied methods on `import class` lower to out-of-line definitions on
  the native C++ class; the native header remains responsible for declaring
  those members and for providing `shared_from_this()` support when bare `this`
  is used
- The self-hosted emitter follows the same native-class policy for inferred,
  quoted, and angle-bracket headers, including static method scope calls and
  constructor arguments from named class construction
- when an exported generated type is part of a native interop surface, its own
  header also exposes the concrete field dependencies native code may dereference
  directly; ordinary Doof-only headers still prefer forward declarations

Primary modules:

- `src/emitter-names.ts`
- `src/emitter-module.ts`
- `src/emitter-expr.ts`
- `src/checker-expr.ts`

Validation anchors:

- `src/emitter-modules.test.ts`
- `src/emitter-e2e-modules.test.ts`
- `spec/11-modules.md`

### Functions and Methods

Strategy:

- function declarations lower to generated C++ functions or methods with resolved parameter and return types
- method placement depends on the owning declaration and module/header split
- default parameters and named-argument ordering are normalized during emission
- default parameter expressions may lower static class method calls as `Class::method(...)`

Primary modules:

- `src/emitter-decl.ts`
- `src/emitter-expr-calls.ts`
- `src/emitter-module.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-constructs.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `spec/04-functions-and-lambdas.md`

### Lambdas, Closures, Async, and Actors

Strategy:

- lambda lowering performs capture analysis before generating the C++ callable form
- capture analysis only includes bindings that are free in that lambda; lambda-local declarations and case-pattern bindings stay local to the generated callable
- nested lambdas get their own capture lists, while enclosing lambdas still
  capture any outer bindings needed only by deeper closures so C++ can make
  those names available transitively
- shorthand object and named-construction properties are treated like
  identifier references for capture analysis
- every lambda establishes its own callable return context, so nested lambda returns do not inherit outer `Result<T, E>` wrapping rules
- mutable captured locals may need special boxing or indirection so closures stay valid after escape
- both emitters box captured mutable locals in `std::shared_ptr<T>`, capture the
  box by value, and dereference it for reads and writes; uncaptured mutable
  locals remain ordinary stack values
- emitted lambdas are wrapped in `doof::callback`, and first-class callback
  invocation lowers to checked `.call(...)`
- `callback.post(...)` lowers to the runtime callback post operation and returns
  `doof::Promise<R>`
- `async` is actor-call-only and lowers to `Actor<T>::call_async`
- `retire actor` lowers to `Actor<T>::retire()` and returns the inner actor state
- actor-related forms are lowered through the same lambda-focused emission surface rather than through a separate compiler phase

Primary modules:

- `src/emitter-expr-lambda.ts`
- `src/emitter-context.ts`
- `selfhost/emitter-expr-lambda.do`
- `selfhost/emitter-context.do`

Validation anchors:

- `src/emitter-constructs.test.ts`
- `src/emitter-e2e-features.test.ts`
- `spec/04-functions-and-lambdas.md`
- `spec/10-concurrency.md`

### Generic Specialization

Strategy:

- the self-hosted compiler monomorphizes every reached ordinary Doof-defined generic function, method, class, alias use, and interface instantiation before header planning
- instantiations are keyed by declaration identity plus canonical concrete arguments and discovered to a fixed point by walking substituted bodies and signatures
- exact recursive instantiations deduplicate; expanding specialization chains produce a compiler diagnostic with a bounded instantiation trace
- generic aliases are erased after concrete substitution in the self-hosted compiler; no Doof generic is represented by a C++ template there
- generic native function imports produce module-owned concrete adapters whose bodies call the mapped C++ name with ordinary concrete arguments, leaving overload resolution and template deduction to C++
- generic wrapper classes explicitly named by a native class/function signature remain C++ templates at that native boundary; their transitive Doof consumers do not force unrelated generics back to template lowering
- the TypeScript bootstrap emitter retains its existing hybrid specialization and C++-template alias behavior while it remains the bootstrap oracle
- `T.fromJsonValue(...)` on a `JsonSerializable` type parameter lowers through the emitted class value type's `element_type`, so class instantiations represented as `std::shared_ptr<C>` call `T::element_type::fromJsonValue(...)`

Primary modules:

- `src/emitter-monomorphize.ts`
- `src/emitter-expr-calls.ts`
- `src/emitter-decl.ts`
- `src/emitter-module.ts`
- `selfhost/emitter-monomorphize.do`
- `selfhost/emitter-module.do`
- `selfhost/emitter-decl.do`
- `selfhost/emitter-expr-calls.do`

Validation anchors:

- `src/emitter-generics.test.ts`
- `src/emitter-e2e-features.test.ts`
- `selfhost/compiler.test.do`
- `spec/02-type-system.md`

## Objects, Interfaces, and Enums

### Classes, Structs, and Construction

Strategy:

- class values lower to shared pointer-managed objects
- struct values lower to direct values and are copied on assignment, parameter passing, and return
- constructor and field initialization order is emitted explicitly
- positional and named construction forms are normalized into the generated constructor call shape; classes emit `std::make_shared<T>(...)` while structs emit direct value construction
- member access uses `->` for classes and `.` for structs
- the self-hosted parser and analyzer retain the nominal kind on declarations
  and symbols; self-hosted type, construction, member, `this`, and JSON lowering
  all consult that symbol kind
- a static `constructor` method returning the nominal type, or `Result<Nominal, E>`,
  becomes the direct-construction target (`Type(...)` and `Type { ... }` emit
  `Type::constructor(...)`), except inside that type's own `constructor` body
  where construction emits the raw field constructor to avoid recursive factories
- generic static constructors specialize the owning class in the call target
  (`Channel<std::string>::constructor(...)`) when type arguments are explicit or inferred
- field defaults may call static class/struct methods and lower to the same `Type::method(...)`
  form used by ordinary static calls
- structs are not emitted with shared ownership bases, destructors, weak references, or interface dispatch support in v1

Primary modules:

- `src/emitter-decl.ts`
- `src/emitter-expr-calls.ts`
- `src/emitter-defaults.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `spec/07-classes-and-interfaces.md`

### Interfaces and Polymorphism

Strategy:

- interface lowering depends on the current closed-world module graph
- the emitter pre-computes implementing classes and uses generated interface alias types to support dispatch
- the self-hosted compiler builds a distinct implementation set for each concrete generic interface instantiation and substitutes both interface and candidate class arguments during structural conformance
- concrete `Stream<T>` values use the same closed-world variant and `std::visit` dispatch path; the former self-host-only `StreamBase<T>` virtual-dispatch special case is not emitted
- cross-module alternatives are forward-declared in public headers and privately included where a translation unit performs variant dispatch
- interface-related JSON and metadata surfaces build on the same implementation map

Primary modules:

- `src/emitter-module.ts`
- `src/emitter-decl.ts`
- `src/emitter-json.ts`
- `selfhost/checker.do`
- `selfhost/emitter-monomorphize.do`
- `selfhost/emitter-module.do`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-modules.test.ts`
- `src/emitter-e2e-modules.test.ts`
- `selfhost/compiler.test.do`
- `spec/07-classes-and-interfaces.md`

### Enums

Strategy:

- enums lower to dedicated C++ enum declarations and are carried through code generation as named enum values
- enum-aware operations are emitted as ordinary typed C++ expressions once semantic typing is resolved

Primary modules:

- `src/emitter-decl.ts`
- `src/emitter-expr-ops.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `spec/07-classes-and-interfaces.md`

## Expressions and Statements

### Expressions

Strategy:

- expression lowering is centralized in `src/emitter-expr.ts` and delegated by expression kind
- literals, operators, calls, control-flow expressions, and lambdas each have focused helper modules
- runtime coercion is introduced only when the semantic source and target shapes differ at runtime

Primary modules:

- `src/emitter-expr.ts`
- `src/emitter-expr-literals.ts`
- `src/emitter-expr-ops.ts`
- `src/emitter-expr-calls.ts`
- `src/emitter-expr-control.ts`
- `src/emitter-json-value.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-constructs.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `spec/05-operators.md`
- `spec/06-control-flow.md`

### Statements and Control Flow

Strategy:

- statement lowering lives in `src/emitter-stmt.ts`
- blocks, bindings, loops, `if`, `break`, `continue`, try/catch statements, and loop follow-up behavior are emitted with explicit control-flow state in `EmitContext`
- expression-level and statement-level control flow stay separate, even when they model similar language concepts

Primary modules:

- `src/emitter-stmt.ts`
- `src/emitter-context.ts`
- `src/emitter-expr-control.ts`

Validation anchors:

- `src/emitter-basics.test.ts`
- `src/emitter-constructs.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `src/emitter-e2e-combos.test.ts`
- `spec/06-control-flow.md`

## Errors, Results, and Narrowing

### `Result`, `try`, `catch`, and `as`

Strategy:

- `Success<T>` and `Failure<E>` lower to intrinsic wrapper structs, including
  empty `void` specializations
- `Result<T, E>` lowers through the ordinary union path as
  `std::variant<doof::Success<T>, doof::Failure<E>>`; the runtime `doof::Result`
  name is only an equivalent alias for native bridge signatures
- arm tests and extraction use centralized free helpers, while `case` uses the
  normal `std::visit` lowering
- `try` and `catch` forms are emitted with explicit success/failure control flow
- declaration-`else` evaluates its subject once, exposes either the full
  subject or captured failure payload in the handler, and extracts the narrowed
  success/non-null value only after the handler
- `as`-narrowing becomes explicit runtime checks that either extract a narrowed value or return a failure result

Primary modules:

- `src/emitter-types.ts`
- `src/emitter-stmt.ts`
- `src/emitter-expr-control.ts`
- `src/emitter-narrowing.ts`
- `selfhost/checker.do`
- `selfhost/emitter-stmt.do`

Validation anchors:

- `src/emitter-advanced.test.ts`
- `src/emitter-e2e-advanced.test.ts`
- `selfhost/checker.test.do`
- `selfhost/emitter.test.do`
- `spec/09-error-handling.md`

## Collections, Tuples, and Destructuring

Strategy:

- arrays, maps, sets, and tuples lower to runtime-backed C++ container or tuple shapes
- mutable array `.reserve(capacity)` lowers to `std::vector::reserve` through the shared runtime helper
- array and string `.contains(...)` / `.indexOf(...)` lower to their
  representation-specific `doof::array_*` and `doof::string_*` helpers; the
  self-hosted emitter selects these from the decorated receiver type
- destructuring expands into explicit extraction and assignment code rather than a dedicated C++ destructuring feature
- collection behavior depends on both type lowering and statement or expression emission helpers

Primary modules:

- `src/emitter-types.ts`
- `src/emitter-stmt.ts`
- `src/emitter-expr-ops.ts`
- `selfhost/emitter-expr-calls.do`

Validation anchors:

- `src/emitter-constructs.test.ts`
- `src/emitter-advanced.test.ts`
- `src/emitter-e2e-compile.test.ts`
- `selfhost/emitter.test.do`
- `spec/03-variables-and-bindings.md`
- `spec/08-pattern-matching.md`

## Modules, Runtime, and Generated Project Shape

### Module Splitting and Project Output

Strategy:

- each Doof module is emitted as a generated header/source pair
- project emission also writes runtime and target-specific support files
- self-hosted project emission copies the canonical runtime header used to
  build the compiler rather than rendering a second implementation;
  `DOOF_RUNTIME_HEADER` overrides its source path for relocated binaries
- self-hosted native package inputs are planned explicitly from reached
  manifests and copied beneath stable logical package roots, so equal native
  filenames from different packages do not collide
- the self-hosted `build` command resolves those output-relative paths only at
  the compiler boundary and forwards registered sources, includes, library
  paths, libraries, frameworks, defines, and compiler/linker flags
- each generated module header has one canonical materialized path; package
  roots contain forwarding headers for sibling native includes such as
  `types.hpp`, never a second copy of the declaration contents
- native namespaces receive aliases for the resolved Doof nominal types used
  by extern signatures, including non-generic sibling exports and the specific
  nominal dependencies imported by their defining module; dependency modules
  are not recursively flattened into the native namespace
- the emitted project layout is designed to be consumed by the CLI build pipeline rather than by a separate handwritten build integration layer
- `build.target = "wasm"` adds `doof_wasm.cpp`, which exposes entry-module exported functions as JSON-string C ABI wrappers and is compiled as an extra generated native source

Primary modules:

- `src/emitter-module.ts`
- `src/emitter-runtime.ts`

Validation anchors:

- `src/emitter-modules.test.ts`
- `src/emitter-e2e-modules.test.ts`
- `src/emitter-e2e-samples.test.ts`
- `spec/11-modules.md`

### JSON, Schema, Metadata, and Reflection

Strategy:

- serializable types get generated conversion helpers
- classes and structs with a dedicated static `constructor(...): Self` or
  `constructor(...): Result<Self, E>` are excluded from automatic JSON helper generation
- interface-level deserialization relies on the known set of implementations in the analyzed project
- metadata surfaces and `.invoke()` generation build on the same emitted type knowledge and JSON support

Primary modules:

- `src/emitter-json.ts`
- `src/emitter-json-value.ts`
- `src/emitter-schema.ts`
- `src/emitter-metadata.ts`

Validation anchors:

- `src/emitter-advanced.test.ts`
- `src/emitter-schema.test.ts`
- `src/emitter-metadata.test.ts`
- `src/emitter-e2e-advanced.test.ts`
- `spec/12-json-serialization.md`
- `spec/13-descriptions.md`

## Maintenance Rule

Update this document when the lowering strategy changes, not just when files move.

Good reasons to update it:

- a Doof construct starts lowering to a different C++ runtime shape
- a concept moves to a different owning emitter helper
- a new runtime support mechanism is introduced
- the best validation anchors for a concept change materially

If only the file layout changes, update [source-file-structure.md](./source-file-structure.md) instead. If the emitter flow changes but the concept strategy does not, update [cpp-transpiler-architecture.md](./cpp-transpiler-architecture.md).
