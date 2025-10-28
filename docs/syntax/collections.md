# Collections

## Arrays

Dynamic arrays use the `T[]` syntax and map to `std::vector<T>`:

```doof
int[] numbers = [1, 2, 3];
string[] names = ["Alice", "Bob"];
```

## Maps and Sets

- `Map<K, V>` → `std::unordered_map<K, V>`
- `Set<T>` → `std::unordered_set<T>`

Key/element restrictions for maps/sets:
- `int`, `bool`, `char`, `string`
- Enums

Examples:

```doof
Map<string, int> ages = { "Alice": 30, "Bob": 25 };
Map<int, string> codes = { 1: "one", 2: "two" };
Map<bool, string> flags = { true: "enabled", false: "disabled" };
Set<int> numbers = { 1, 2, 3 };
Set<string> names = { "Alice", "Bob" };
```

Parameter passing:
- Collections are passed by mutable reference to avoid copying
- Function and method parameters are immutable; copy to a local `let` variable to mutate
