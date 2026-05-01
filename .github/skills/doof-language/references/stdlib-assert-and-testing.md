# `std/assert` and Testing

## Imports

```doof
import { Assert } from "std/assert"
```

## Assertion API

```doof
Assert.equal<T>(actual: T, expected: T, message: string | null = null): void
Assert.notEqual<T>(actual: T, expected: T, message: string | null = null): void
Assert.isTrue(value: bool, message: string | null = null): void
Assert.isFalse(value: bool, message: string | null = null): void
Assert.fail(message: string | null = null): void
```

Each assertion panics on failure. The optional message is prepended to the default failure text.

## Basic Example

```doof
import { Assert } from "std/assert"

export function testAdd(): void {
    Assert.equal(1 + 2, 3)
    Assert.notEqual(1 + 2, 4)
}
```

## Test File Conventions

- Put tests in `*.test.do` files.
- Export top-level functions whose names start with `test`.
- Test functions take no parameters and return `void`.
- Use `assert(condition, message)` for simple checks and `Assert` for richer assertions.

Example:

```doof
import { add } from "./math"
import { Assert } from "std/assert"

export function testAdd(): void {
    Assert.equal(add(1, 2), 3)
}

export function testAddNegative(): void {
    Assert.equal(add(5, -2), 3, "expected add(5, -2) to equal 3")
}
```

## Running Tests

```bash
doof test math.test.do
doof test src
doof test --list src
doof test --filter math src
```

Runner behavior:

- Discovery is static, not reflective.
- The CLI generates a temporary harness per test file.
- Each `.test.do` module is compiled separately.
- Each exported test runs in its own process.
- One failing test does not stop later tests from running.
- `--filter` matches ids of the form `<relative-path>::<functionName>`.

## Mocking

Mocks are compile-time substitutions for imports and call sites.

Core pieces:

- `mock import` rewrites a dependency for a specific test module graph.
- `mock function` declares a recorded stand-in for a free function.
- `mock class` declares a recorded stand-in for a class with methods.
- Mock callables expose `.calls`, a typed array of captured argument objects.

Important rules:

- Put `mock import` directives at the top of the root `.test.do` file.
- Mock substitutions affect only that test file's module graph.
- `.calls` entries use the original parameter names as fields.
- Generic mock functions, generic mock classes or methods, and static mock methods are rejected.

### `mock import`

```doof
mock import for "./checkout" {
    "./payments" => "./payments.mock"
}

import { Assert } from "std/assert"
import { checkout } from "./checkout"
import { sendPayment } from "./payments.mock"

export function testCheckoutUsesMockPayment(): void {
    Assert.isTrue(checkout("acct-1", 7))
    Assert.equal(sendPayment.calls.length, 1)
    Assert.equal(sendPayment.calls[0].targetId, "acct-1")
    Assert.equal(sendPayment.calls[0].amount, 7)
}
```

### `mock class`

```doof
import { Assert } from "std/assert"

mock class PaymentGateway {
    sendPayment(targetId: string, amount: int): bool => true
}

export function testGatewayTracksCallsPerInstance(): void {
    let gateway = PaymentGateway()
    gateway.sendPayment("acct-1", 7)

    Assert.equal(gateway.sendPayment.calls.length, 1)
    Assert.equal(gateway.sendPayment.calls[0].targetId, "acct-1")
    Assert.equal(gateway.sendPayment.calls[0].amount, 7)
}
```

### Bodyless Mocks

```doof
mock function unexpectedNetworkCall(url: string): void
```

If execution reaches a bodyless mock, the emitted program panics immediately.