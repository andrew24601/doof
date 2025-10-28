# Strings and Interpolation

Doof supports two types of string literals.

## Double-quoted strings
Standard string literals using double quotes:
```doof
let message: string = "Hello, world!";
let path: string = "C:\\Users\\example"; // escape sequences supported
```

## Backtick strings
Template-style string literals using backticks:
```doof
let greeting: string = `Hello, world!`;
let multiline: string = `This is a
multi-line string`;
```

## String Interpolation
Both double-quoted and backtick strings support expression interpolation using `${expression}` syntax:

```doof
let name: string = "Alice";
let age: int = 30;

// Interpolation in double-quoted strings
let intro: string = "My name is ${name} and I'm ${age} years old";

// Interpolation in backtick strings
let template: string = `User: ${name}
Age: ${age}
Status: ${age >= 18 ? "adult" : "minor"}`;
```

## Interpolating Enums
When interpolating enum values in strings, the transpiler automatically generates appropriate string conversion functions:

```doof
enum Color { Red, Green, Blue }

let color = Color.Red;
let message = `The selected color is ${color}`; // Outputs: "The selected color is Red"
```

## Escape Sequences
Both string types support standard escape sequences:
- `\"` - double quote
- `\'` - single quote
- `\\` - backslash
- `\n` - newline
- `\t` - tab
- `\r` - carriage return
