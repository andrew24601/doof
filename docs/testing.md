# Testing in Doof

Doof tests are a CLI convention. The `doof test` command discovers test functions in `.test.do` files, compiles them into a temporary harness, and runs each test in an isolated process.

## Conventions

- Test files are named `*.test.do`
- Export top-level functions whose names start with `test`
- Test functions take no parameters and return `void`
- Use `assert(condition, message)` for simple assertions
- Import `Assert` from `std/assert` for richer assertions

## Example

```javascript
// math.test.do
import { Assert } from "std/assert"

export function testAdd(): void {
  Assert.equal(1 + 1, 2)
}

export function testSubtract(): void {
  Assert.equal(10 - 3, 7, "expected subtraction to work")
}
```

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
