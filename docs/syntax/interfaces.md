# Interfaces (Structural Typing)

Interfaces describe structural contracts that can be satisfied by any class exposing a compatible public surface. They are declared with the `interface` keyword and contain property and method signatures:

```doof
interface Identified {
    readonly id: int;
    nickname?: string;
    ping(): void;          // defaults to void when no return type is specified
}
```

Rules:
- Properties use `name: Type`; append `?` for optional members
- `readonly` requires the class field to be `readonly` or `const`
- Methods must match parameter and return types; `void` is assumed if omitted
- Only public, non-static class members participate in matching

## Extending interfaces

```doof
interface DomainObject { readonly id: int; }

interface UserLike extends DomainObject {
    email: string;
    deactivate(): void;
}
```

Members from base interfaces are merged. Circular inheritance is rejected.

## Structural matching

A class matches an interface when:
- Each required property appears as a public, non-static field with an identical type
- `readonly` interface properties map to class fields declared `readonly` or `const`
- Each required method appears as a public, non-static method with the same signature
- Optional properties/methods may be absent; extra class members are ignored

## Desugaring to union types

Interfaces are rewritten into union type aliases composed of all classes that satisfy the contract in the current compilation unit:

```doof
interface Drivable { drive(distance: int): void; }

class Car { drive(distance: int): void { /* ... */ } }
class Drone { drive(distance: int): void { /* ... */ } }
```

Desugars to:

```doof
type Drivable = Car | Drone;
```

If no class matches, the transpiler reports an error.
