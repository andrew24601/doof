# Pointers and References

Object types are always references (like JavaScript/TypeScript), and are mapped to `std::shared_ptr` in C++. No explicit reference syntax is needed for user-defined types.

Use the `weak` keyword to declare a weak reference (maps to `std::weak_ptr`).

```doof
class Node {
    value: int;
    next: Node;        // std::shared_ptr<Node>
    prev: weak Node;   // std::weak_ptr<Node>
}
```

Function parameter passing:
- Primitives (`int`, `float`, `double`, `bool`, `char`) are passed by value
- `string` types are passed by mutable reference (`std::string&`)
- Dynamic arrays (`T[]`), maps, and sets are passed by mutable reference
- Class instances are already references (`std::shared_ptr`)
