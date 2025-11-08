# XML-style element calls

Doof supports an XML-like syntax for calling functions and constructing DSLs. This is especially useful for UI builders, trees, or declarative configuration.

The syntax maps directly to a regular function call with named arguments (attributes) and an optional children parameter (from element contents).

## Quick examples

```doof
// Calls Button(label: "Click", onClick: (event) => { ... }, children: [Text("Go")])
<Button label="Click" onClick=>(event) => println(event.x)>
  <Text value="Go" />
</Button>

// Self-closing tags
<Input type="text" value={name} />

// Attribute values can be expressions with braces
<View padding={base + 8} visible={flag && count > 0} />

// Nested elements and text nodes
<List>
  Hello, {userName}!
  <Item key={42} />
</List>
```

## Syntax

- Start tag: `<TagName ...>`
- End tag: `</TagName>`
- Self-closing: `<TagName ... />` (no children)
- Attributes: space-separated name/value pairs inside the start tag
- Children: text, nested elements, or braced expressions `{expr}` between start and end tags

### Attribute value forms

Each attribute becomes a named argument to the function named by the tag.

- String literal: `label="Click"`
- Number/boolean/char literal: `count=3`, `enabled=true`, `ch='x'`
- Identifier: `handler=onClick` (passes the variable `onClick`)
- Expression in braces: `padding={base + 8}`
- Lambda shorthand: `onClick => it.doSomething()` or `onClick=>(e) => handle(e)`
  - When the attribute value is a function, you can omit `=` and write `name => ...`.
  - Parameter names may be inferred from the expected function type; a single implicit parameter is available as `it`.

Ordering of attributes is not significant; named arguments are matched by name.

### Children

Element content becomes an array passed to a special parameter named `children` (if present in the target function signature). Children can be:

- Text nodes (collapsed to string literals; surrounding whitespace is normalized)
- Nested elements (`<Child ...> ... </Child>`) which themselves map to function calls
- Braced expressions `{expr}` which are inserted verbatim into the children array

Self-closing tags (`<Tag ... />`) have no children.

### Mapping to function calls

Conceptually, the XML element

```doof
<Tag a=1 b={x + 1}>Hello {name}</Tag>
```

is equivalent to a call like:

```doof
Tag(a: 1, b: x + 1, children: ["Hello ", name])
```

Notes:
- Named arguments are matched by name; ordering is relaxed.
- If the callee defines a parameter named `children`, the content array is passed there.
- If `children` isn’t part of the signature, passing children is a validation error.

### Lambda attributes and implicit parameter

When an attribute expects a function type, you can use either form:

```doof
// Standard form
<Button onClick={(e) => println(e)} />

// Shorthand (no equals)
<Button onClick => println(it) />
```

Rules:
- If the expected function type has a single parameter, you may omit the parameter list and use `it` inside the body.
- If you write an explicit parameter list, it is used as-is: `onSubmit=(data) => handle(data)`.

See also: [Lambda expressions](../lambdas.md#short-form-lambdas).

## Validation rules

- The tag name must resolve to a function or callable symbol.
- Unknown attribute names (not matching any parameter) are errors.
- Duplicate attribute names are errors.
- Attribute values are fully general expressions (subject to type checking).
- Children are only allowed when the callee has a `children` parameter (usually an array type).
- Named argument ordering is ignored; arguments are matched by name.

## Limitations and notes

- Generic type arguments in tags (e.g., `<List<int> />`) are currently not supported.
- Boolean attributes without values (e.g., `<Flag enabled />`) are not yet supported; use `enabled=true`.
- Enum shorthand inside attributes (e.g., `priority=.HIGH`) requires an enum-typed parameter context.
- Whitespace in text nodes is normalized; use braces to inject exact strings if needed.

For open items and planned enhancements, see enhancements/TODO.md.
