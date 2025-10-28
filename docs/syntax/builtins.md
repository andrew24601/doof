# Built-in Functions

## println

`println(value)` prints any value followed by a newline. The transpiler maps this to `std::cout << value << std::endl;` in C++.

Supported types:
- Built-in: `int`, `float`, `double`, `bool`, `char`, `string`
- Enums: printed as the symbolic name
- Structs and Classes: printed as JSON via a generated `operator<<`

Examples:
```doof
println("Hello, world!");
println(42);
println(someEnum);
println(someStruct);
println(someClassInstance);
```

Note: The JSON output includes all public fields of user-defined types.
