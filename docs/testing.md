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
The self-hosted runner prints `BUILD <file>` before compiling each generated
test harness. Native compiler output is capped at 40 lines across parallel
compile tasks, followed by one truncation notice, so template diagnostics do
not overwhelm the surrounding test output.

- Discovery is static, not reflective
- The runner generates a temporary harness for each discovered test file
- Each harness is compiled independently, so one test file's mocks do not leak into another test file
- Each discovered test function still runs in its own process, so a failed assertion only fails that test
- Each test process starts in the owning package root, so relative fixture and artifact paths do not depend on where `doof test` was invoked

This matters for mocks: the root `.test.do` file defines the mock environment for the modules it imports.

### Self-hosted CLI

The self-hosted CLI supports file and recursive-directory discovery, `--list`,
case-insensitive `--filter`, one harness/build per test file, and one process per
test. Harness builds use the normal self-hosted native planner, including its
runtime precompiled header for multi-module graphs and bounded parallel object
compilation.

The self-hosted compiler supports `mock import` graph rewriting with the same
root-test scoping and exact source matching as the TypeScript compiler. Recorded
`mock function` and `mock class` call tracking are not yet supported there.
Child test output is inherited directly, and `DOOF_TEST_TIMEOUT_MS` remains a
TypeScript-runner-only option until the self-hosted process boundary grows a
timed execution API.

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
- Source-module and dependency specifiers are matched exactly

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

## Running Doof Tests

Run a single file:

```bash
npx doof test math.test.do
```

Run all tests under a directory:

```bash
npx doof test src
```

Directory discovery skips nested Doof packages. If the runner encounters a subdirectory containing its own `doof.json`, it ignores that subdirectory; run `doof test` against that package directly when you want its tests.

List discovered tests without running them:

```bash
npx doof test --list src
```

Run only tests whose id contains a string:

```bash
npx doof test --filter fibonacci samples
```

The discovered test id format is `<relative-path>::<functionName>`. `--filter` matches against that full id.

## Running Compiler Tests

The TypeScript compiler tests use Vitest and are split into two tiers:

- `npm test` runs the fast unit and integration tests. It excludes test files whose names contain `e2e`.
- `npm run test:e2e` runs the complete suite, including the native C++ compile-and-run E2E tests.

Use `npm run test:coverage` for coverage on the fast tier. To collect coverage for the complete suite, pass the coverage flag to the full command:

```bash
npm run test:e2e -- --coverage
```

### Self-hosted compiler tiers

The self-hosted suite follows a strict unit/component boundary. `*.test.do`
files may use focused in-memory inputs and small filesystem fixtures, but they
must not invoke native toolchains, spawn subprocesses, sweep the complete source
tree, package executables, or orchestrate bootstrap stages.

```bash
npm run test:selfhost
npm run test:selfhost:coverage
npm run test:release
```

`test:selfhost` runs the focused Doof-native suite. The coverage variant writes
Doof source coverage beneath `build/coverage/selfhost`. `test:release` is the
expensive acceptance workflow: it builds the seed and B5/B6 compilers through
the production parallel build paths, compares B5/B6 generated text artifacts,
then runs the native, stdlib, test-runner, packaging, and platform fixtures.
Set `DOOF_STDLIB_ROOT` when the stdlib is not at `../doof-stdlib`; on macOS,
`DOOF_HTTP_RUNTIME_TEST=1` also enables the localhost HTTP runtime leg.

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
