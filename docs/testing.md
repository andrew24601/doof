# Testing in Doof

Doof tests are a CLI convention. The `doof test` command discovers test functions in `.test.do` files, generates a temporary harness per test file, compiles each test module separately, and runs each discovered test in an isolated process.

## Conventions

- Test files are named `*.test.do`
- Export top-level functions whose names start with `test`
- Test functions take no parameters and return `void`
- Use `assert(condition, message)` for simple assertions
- Import `Assert` from `std/assert` for richer assertions
- Put `mock import` directives at the top of the root `.test.do` file when you need dependency substitution

## Example

```doof
// math.test.do
import { Assert } from "std/assert"

export function testAdd(): void {
  Assert.equal(1 + 1, 2)
}

export function testSubtract(): void {
  Assert.equal(10 - 3, 7, "expected subtraction to work")
}
```

## Execution Model

The test runner treats each `.test.do` file as its own compilation unit.

- Discovery is static, not reflective
- The runner generates a temporary harness for each discovered test file
- Each harness is compiled independently, so one test file's mocks do not leak into another test file
- Each discovered test function still runs in its own process, so a failed assertion only fails that test

This matters for mocks: the root `.test.do` file defines the mock environment for the modules it imports.

## Mocking Overview

Doof mocking is compile-time, not runtime patching.

- `mock import` rewrites a dependency for a specific import site during module resolution
- `mock function` declares a callable stand-in that records every invocation
- `mock class` declares a class whose mock methods record calls per instance
- Mock callables expose `.calls`, a typed array of recorded argument objects

Because `.calls` is statically typed, you can assert on parameter names directly:

```doof
Assert.equal(sendPayment.calls.length, 1)
Assert.equal(sendPayment.calls[0].targetId, "acct-1")
Assert.equal(sendPayment.calls[0].amount, 7)
```

## Mock Import

Use `mock import` in the root `.test.do` file to substitute one module for another only when resolving imports from a specific source module.

```doof
mock import for "./checkout" {
  "./payments" => "./payments.mock"
}
```

Rules:

- `mock import` is only valid in `.test.do` files
- It must appear at the top of the root test file, before ordinary statements
- It applies to the module graph rooted at that test file only
- Exact source matches and wildcard source patterns are supported; more specific matches win

Typical layout:

```text
checkout.do
payments.do
payments.mock.do
checkout.test.do
```

```doof
// checkout.do
import { sendPayment } from "./payments"

export function checkout(targetId: string, amount: int): bool {
  return sendPayment(targetId, amount)
}
```

```doof
// payments.mock.do
export mock function sendPayment(targetId: string, amount: int): bool => true
```

```doof
// checkout.test.do
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

## Mock Function

`mock function` works like a normal function declaration, but every call is recorded.

```doof
mock function sendPayment(targetId: string, amount: int): bool => true
```

The `.calls` array element type is synthesized from the parameter list. For the example above, each element has:

- `targetId: string`
- `amount: int`

Bodyless mocks are allowed when a test should fail if the mock is actually invoked:

```doof
mock function unexpectedCall(id: string): void
```

If emitted code reaches a bodyless mock, it panics immediately.

## Mock Class and Per-Instance Calls

Use `mock class` when the code under test expects an object with methods rather than a free function.

```doof
mock class PaymentGateway {
  sendPayment(targetId: string, amount: int): bool => true
}
```

Calls are tracked per instance:

```doof
import { Assert } from "std/assert"

export function testGatewayRecordsCallsPerInstance(): void {
  let a = PaymentGateway()
  let b = PaymentGateway()

  a.sendPayment("acct-1", 7)
  a.sendPayment("acct-2", 9)
  b.sendPayment("acct-3", 11)

  Assert.equal(a.sendPayment.calls.length, 2)
  Assert.equal(a.sendPayment.calls[1].amount, 9)
  Assert.equal(b.sendPayment.calls.length, 1)
  Assert.equal(b.sendPayment.calls[0].targetId, "acct-3")
}
```

## Current Limitations

The current implementation intentionally rejects a few mock forms:

- Generic mock functions
- Generic mock classes
- Generic mock methods
- Static mock methods

These are compile-time diagnostics rather than runtime failures.

## Running Tests

Run a single file:

```bash
npx doof test math.test.do
```

Run all tests under a directory:

```bash
npx doof test src
```

List discovered tests without running them:

```bash
npx doof test --list src
```

Run only tests whose id contains a string:

```bash
npx doof test --filter fibonacci samples
```

The discovered test id format is `<relative-path>::<functionName>`. `--filter` matches against that full id.

## Assertions

`std/assert` provides an `Assert` class with these methods:

| Method | Description |
| --- | --- |
| `Assert.equal(a, b, msg?)` | Fail if `a !== b` |
| `Assert.notEqual(a, b, msg?)` | Fail if `a === b` |
| `Assert.isTrue(v, msg?)` | Fail if `v` is not true |
| `Assert.isFalse(v, msg?)` | Fail if `v` is not false |
| `Assert.fail(msg)` | Unconditionally fail |

A failing `assert(...)` panics and terminates the current test. Because each test runs in a separate process, one failure does not prevent later tests from running.

## Native Dependencies in Tests

Test files follow the same compilation pipeline as regular programs, so all CLI native build flags (`--include-path`, `--link-lib`, `--framework`, etc.) apply when running `doof test`. If the module under test depends on native libraries, pass the same flags you use for `doof build`.
