# Error Handling with panic

Use `panic(message: string)` for unrecoverable errors. It prints the message to stderr and terminates the process (`std::exit(1)` in generated C++).

```doof
function divide(x: int, y: int): int {
    if (y == 0) { panic("Division by zero is not allowed"); }
    return x / y;
}

function validateInput(value: int): void {
    if (value < 0) { panic("Negative values are not supported"); }
}
```

Guidelines:
- `panic` never returns; use for unrecoverable errors
- Prefer optional types or error codes for recoverable cases
