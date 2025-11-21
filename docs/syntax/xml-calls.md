# XML-Style Call Syntax

This document describes the XML-style call syntax for doof, providing a declarative alternative to traditional function, method, and constructor invocation forms.

## Overview

Existing call forms:

1. Positional: `foo(a, b)`
2. Named-object: `foo { a: valueA, b: valueB }`
3. Constructor object literal: `Foo { field: value }`

New XML-style forms:

```doof
<Foo a=1 b="hi" />                    // Self-closing (no children)
<Foo a=1 b={compute()} />               // Attribute with expression
<Foo a=1>some text</Foo>                // Text children
<Foo a=1>{expr} more <Bar/> text</Foo>  // Mixed children
<obj.method a=1 />                      // Instance method invocation
<Foo onClick=>println(it) />            // Shorthand lambda attribute
```

Semantics match a named-argument call. Attributes map to parameters. Child content maps to a parameter named `children` when present.

## Attribute Syntax

Attribute forms:

| Form              | Meaning                            |
|-------------------|-------------------------------------|
| `name=123`        | Numeric literal                     |
| `name="text"`    | String literal                      |
| `name=identifier` | Identifier expression               |
| `name={expr}`     | Arbitrary expression inside braces  |
| `name=> expr`     | Shorthand lambda (see below)        |

Attributes can appear in any order. Ordering constraints that apply to `{ a: ..., b: ... }` object call syntax are relaxed here to improve ergonomics.

Duplicate attribute names are an error. Unknown attribute names produce an error (fail fast). Enum shorthand (`.MEMBER`) is not yet supported in attributes.

## Shorthand Lambda Attribute (`=>`)

A convenience for function-type parameters.

```doof
function foo(onClick: (it: int): void): void { /* ... */ }

readonly c = <foo onClick=>println(it) />
```

Rules:
- `param=> expr` parses as a lambda whose body is `expr`.
- Parameter list is inferred from the expected function type. Each expected parameter becomes an identifier visible inside the lambda body.
- If the expected function type specifies return type `void`, expression return value is ignored.
- Multiple parameters: `(a: int, b: string): bool` yields in body `a`, `b` available.
- Trailing block form: `param=> { println(a); println(b); }` also allowed.

Errors:
- Using `=>` when parameter type is not a function type.
- Referencing inferred parameter names that do not exist.

## Children Content

Body content (between opening `<Tag ...>` and closing `</Tag>`) is mapped to a special parameter named exactly `children` if such a parameter exists.

Example:
```doof
function panel(children: string[]): void { /* ... */ }

<panel>
  Hello world
  More text
</panel>
```
Equivalent to:
```doof
panel { children: ["Hello world More text"] }
```

### Mixed Children

Children may interleave:
- Text segments (collapsed whitespace) → string literals
- Nested XML elements → converted to their call expressions
- Braced expressions `{ expr }`

Final `children` value becomes an array literal: `[ child1, child2, ... ]`.

### Whitespace Collapsing

To prevent indentation from polluting content:
1. Leading newline immediately after `>` is removed.
2. Trailing newline immediately before the closing tag is removed.
3. For each text segment: trim leading/trailing whitespace; internal runs of whitespace (including newlines) collapse to a single space.
4. Empty segments after trimming are discarded.

To preserve intentional spacing, use explicit string expressions: `{" "}`.

### Errors

- Body present but no `children` parameter → error.
- `children` parameter type not an array → error (current restriction).
- Element types mismatch expected array element type → error.

## Nesting

Nested XML nodes are allowed indefinitely:
```doof
<layout>
  <row>
    <column span=2 />
    <column span=1 />
  </row>
</layout>
```
Each nested element is validated independently; resulting expressions populate the parent `children` array.

## Method Calls (`object.method`)

Instance and static method invocation is supported:
```doof
<manager.setPriority taskId=42 priority=.LOW />  // (enum shorthand inside attribute not yet supported; use full form)
```
Member path is parsed as part of the tag name before attributes.

## Self-Closing Tags

`<Foo />` is equivalent to no-children call. If a `children` parameter exists and is required, this form produces a missing argument error.

## Type Arguments (Future)

Generic invocation like `<List<int> />` is not yet supported in XML form. Use existing `List<int>()` syntax. (TODO recorded in enhancements.)

## Error Handling Summary

Fail fast principles:
- Mismatched tag name (`<Foo>...</Bar>`) → parse error.
- Unterminated tag at EOF → parse error.
- Duplicate attribute → validation error.
- Unknown attribute → validation error.
- Children without `children` param → validation error.
- Invalid shorthand lambda target type → validation error.

## Differences vs Named Object Call

| Aspect                   | Object Call `{}`                  | XML Call `<Tag ...>`             |
|--------------------------|-----------------------------------|----------------------------------|
| Ordering enforcement     | Yes                               | No                               |
| Children parameter       | Must appear explicitly            | Implicit via body                |
| Shorthand lambda         | Use `(x) => expr`                 | `param=> expr`                   |
| Declarative nesting      | Manual arrays / calls             | Direct tree structure            |

## Rationale

The XML form offers:
- Clear tree-like structure for UI / declarative domain code.
- Lightweight lambdas for event/callback parameters.
- Reduced syntactic noise for hierarchical composition.

## Examples

```doof
function button(text: string, onClick: (it: int): void, children: string[]): void { }

<button text="Save" onClick=>println(it)>
  Tooltip: Save changes
</button>

// Equivalent
button { text: "Save", onClick: (it: int) => println(it), children: ["Tooltip: Save changes"] }
```

## Deferred / Future Enhancements

- Enum shorthand in attributes (`priority=.LOW`).
- Generic type arguments `<Foo<int>>`.
- Non-array `children` parameter support (single item, union types).
- Round-trip formatting / regeneration of XML form.
- Attribute spread / defaults.

See `enhancements/TODO.md` for tracking.
