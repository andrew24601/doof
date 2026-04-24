# std/assert and Testing

## Imports

```doof
import { Assert } from "std/assert"
```

## API

```doof
Assert.equal<T>(actual: T, expected: T, message: string | null = null): void
Assert.notEqual<T>(actual: T, expected: T, message: string | null = null): void
Assert.isTrue(value: bool, message: string | null = null): void
Assert.isFalse(value: bool, message: string | null = null): void
Assert.fail(message: string | null = null): void
```

Each method panics on failure. The optional message is prepended to the default failure text.

## Example

```doof
import { Assert } from "std/assert"

export function testAdd(): void {
    Assert.equal(1 + 2, 3)
    Assert.notEqual(1 + 2, 4)
}
```

## Testing Pattern

- Place tests in `*.test.do` files
- Export top-level functions with names starting with `test`
- Use zero-argument `void` test functions
- Use `assert(...)` for primitive checks and `Assert` for richer messages
