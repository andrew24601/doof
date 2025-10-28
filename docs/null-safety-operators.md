# Null Safety Operators in Doof

Doof provides several operators to make working with nullable values safer and more expressive. This guide covers the three main null safety operators:

- Null Coalescing (`??`)
- Optional Chaining (`?.`)
- Non-Null Assertion (`!`)

---

## Null Coalescing Operator (`??`)

Use `??` to provide a fallback value when an expression is null or undefined.

**Example:**
```
let displayName = user.name ?? "Anonymous";
```
If `user.name` is null, `displayName` will be set to "Anonymous".

---

## Optional Chaining Operator (`?.`)

Use `?.` to safely access properties or call methods on objects that may be null or undefined.

**Examples:**
```
let city = user?.address?.city;
let result = config?.getValue();
```
If any part of the chain is null, the result is null.

---

## Non-Null Assertion Operator (`!`)

Use `!` to assert that a value is not null or undefined. This removes nullability for type checking, but will report a runtime error or crash if the value is actually null at runtime.

**Example:**
```
let id = user!.id;
```
Use with caution—only when you are certain the value is not null.

---

## Combining Operators

These operators can be combined for concise and safe code:
```
let value = config?.option ?? defaultValue;
let name = (user.name ?? "Guest")!;
```

---

## See Also
- [Doof Syntax Reference](syntax.md)
- [Null Coalescing, Optional Chaining, and Non-Null Assertion Enhancement](enhancements/enhancement-null-coalescing-optional-chaining-nonnull.md)
