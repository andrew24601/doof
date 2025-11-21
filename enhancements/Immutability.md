We want a comprehensive plan to add immutable data structures to doof.

This will require a number of enhancements to the core language, including:
* support for immutable collections (lists, sets, maps)
* new validation rules for readonly properties
* allow readonly to be instead of const for variables
* deprecate use of const for variables
* readonly should be deeply enforced - eg readonly fields of collections should be immutable too, and contain only immutable values
* classes with only readonly/const fields should be considered immutable
* allow tagging classes as readonly to aid validation
Immutability in doof provides safer defaults, enabling reasoning about data flow and preventing unintended side‑effects. This document captures the finalized semantics after the recent implementation.

Key points:
* `readonly` is the canonical way to declare immutable locals, fields, parameters and collections.
* `const` for variables is deprecated (still parsed, emits a warning, will be removed).
* Immutable (readonly) collections are deeply enforced: element/value types must themselves be immutable.
* Classes composed entirely of immutable (readonly) fields are treated as immutable; mutable fields break immutability.
* A `readonly class` tag provides an assertion that validation verifies (fails if any mutable field exists).
* Internally lowered temporaries (e.g. destructuring) are generated as `readonly` to avoid spurious deprecation warnings.
* Readonly collections cannot be assigned to mutable collection variables (no implicit mutability widening).
* Lambda capture analysis tracks mutable captures separately; readonly locals do not contribute to mutable capture sets.

Rationale for deprecating `const`:
`const` previously overlapped with `readonly` but created ambiguity (compile‑time constant vs runtime immutability). We unify on `readonly` for runtime immutability. The validator now emits: `'const' is deprecated for variables. Use 'readonly' instead.` Future phases may reserve `const` for true compile‑time evaluable constants (e.g. numeric literals, enum values). Until then, prefer `readonly` everywhere you need an immutable binding.

Migration (quick):
* Replace `const` local/field declarations with `readonly`.
* Ensure any collection types annotated as readonly have immutable element/value types.
* Verify classes marked `readonly class` contain only immutable field types.
* Remove assumptions that `const` prevents reassignment in runtime codegen paths—use `isReadonly` flag.

Example migration:
```doof
readonly answer: int = 42; // preferred
```

Attempting reassignment:
```doof
readonly n: int = 5;
n = 6; // error
```

# Summary of Immutability Rules

| Construct | Keyword | Mutability | Notes |
|-----------|---------|-----------|-------|
| Local variable | `readonly` | Immutable binding | Must have initializer or pass definite assignment rules if allowed (locals) |
| Local variable | `let` | Mutable binding | Can be reassigned; may hold mutable or immutable value |
| Local variable | `const` | Deprecated | Emits warning; treat as readonly; will be removed |
| Class field | `readonly` | Immutable field | Deep immutability enforced for collection/value types |
| Class field | (no keyword) | Mutable field | Can be reassigned / mutated |
| Class | `readonly class` | Immutable aggregate | All fields must be immutable; validation enforces |
| Array/Set/Map type | `readonly T[]` etc (annotation) | Deeply immutable container | Elements/values must be immutable |

# Immutable Collections

Examples:

readonly a = [1, 2, 3];
a[0] = 5; // error

readonly b = { x: 1, y: 2 };
b.x = 5; // error

Note that the mutability of the collections is inferred from the destination.

readonly c: int[] = [1, 2, 3];
let d: int[] = c; // error - cannot assign readonly to mutable

a.map(=> x * 2); // returns readonly array
d.map(=> x * 2); // returns mutable array

a.map(=> MutablePoint(x, x)); // error
a.map(=> ImmutablePoint(x, x)); // ok

# Deep Readonly Enforcement

class ImmutablePoint {
    readonly x: int;
    readonly y: int;
}

class MutablePoint {
    x: int;
    y: int;
}

readonly p1 = ImmutablePoint(1, 2);
p1.x = 5; // error

readonly p2 = MutablePoint(1, 2); // error - MutablePoint is not immutable

readonly arr: ImmutablePoint[] = [(1, 2), (3, 4)];
arr[0] = (5, 6); // error

readonly arr2: MutablePoint[] = [(1, 2), (3, 4)]; // error - element type not immutable

let mutableArr: ImmutablePoint[] = [(1, 2), (3, 4)]; // ok
mutableArr[0] = (5, 6); // ok

# Readonly Class Tag

readonly class ReadonlyClass {
    x: int;
    y: int;
}

let obj = ReadonlyClass(1, 2);
obj.x = 5; // error

readonly class OopsClass {
    x: int;
    y: int;
    z: MutablePoint; // error - mutable field disallowed
}

# Lambda Captures and Immutability
Readonly locals captured by lambdas do not count as mutable captures. A lambda that only closes over readonly data may be optimized (e.g. no defensive copying). Mutable captures are tracked separately, enabling future optimizations for pure lambdas.

# Destructuring
Lowering of destructuring variable declarations produces `readonly` temporaries (assignment targets remain governed by their declared mutability). This prevents internal compiler artifacts from triggering the deprecation warning.

# Future Work
* Reserve `const` purely for compile‑time evaluable expressions (folded at validation time).
* Introduce explicit immutable generic constraints (e.g. `<T: immutable>`).
* Provide runtime helpers for cloning between mutable and immutable collection representations (explicit, not implicit).

# Deprecate const for variables
const a = 5; // deprecated (emits warning)
readonly b = 10; // preferred
b = 15; // error

Use automated migration: search for `\bconst\b` excluding enums/types and replace with `readonly` for variable and field declarations, then re-run validation to catch deep immutability violations.

# immutable collections

Examples:

readonly a = [1, 2, 3];
a[0] = 5; // error

readonly b = { x: 1, y: 2 };
b.x = 5; // error

Note that the mutability of the collections is inferred from the destination.

readonly c: number[] = [1, 2, 3];
let d: number[] = c; // error - cannot assign readonly to mutable

a.map(=> x * 2); // ok - map returns a new readonly array
d.map(=> x * 2); // ok - map returns a new mutable array

a.map(=> MutablePoint(x, x)); // error - cannot create mutable values in readonly context
a.map(=> ImmutablePoint(x, x)); // ok

# deep readonly enforcement

class ImmutablePoint {
    readonly x: number;
    readonly y: number;
}

class MutablePoint {
    x: number;
    y: number;
}

readonly p1 = ImmutablePoint(1, 2);
p1.x = 5; // error

readonly p2 = MutablePoint(1, 2); // error - MutablePoint is not readonly

readonly arr:ImmutablePoint[] = [(1, 2), (3, 4)];
arr[0] = (5, 6); // error

readonly arr2:MutablePoint[] = [(1, 2), (3, 4)]; // error - MutablePoint is not readonly

let mutableArr:ImmutablePoint[] = [(1, 2), (3, 4)]; // ok
mutableArr[0] = (5, 6); // ok

# allow tagging classes as readonly

readonly class ReadonlyClass {
    x: number;
    y: number;
}

let obj = ReadonlyClass(1, 2);
obj.x = 5; // error

readonly class OopsClass {
    x: number;
    y: number;
    z: MutablePoint; // error - contains mutable field
}

# deprecate const for variables
const a = 5; // deprecated
readonly b = 10; // preferred
b = 15; // error

