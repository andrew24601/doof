# C++ Mapping Summary

Common mappings from doof constructs to idiomatic C++17.

| doof Example                 | C++ Equivalent Example                           | Notes                                         |
|-----------------------------:|:-------------------------------------------------|:----------------------------------------------|
| `int`                         | `int`                                            | Primitive                                     |
| `string`                      | `std::string`                                    |                                               |
| `T[]`                         | `std::vector<T>`                                 | Dynamic array                                 |
| `Set<T>`                      | `std::unordered_set<T>`                          |                                               |
| `Map<K, V>`                   | `std::unordered_map<K, V>`                       |                                               |
| `let x = 1`                   | `int x = 1;`                                     |                                               |
| `let s = "foo"`              | `std::string s = "foo";`                        |                                               |
| `let arr: int[] = [1,2,3]`    | `std::vector<int> arr = {1,2,3};`               | Dynamic array                                 |
| `class Foo { ... }`           | `class Foo { ... };`                             |                                               |
| `let obj = Foo { ... }`       | `auto obj = std::make_shared<Foo>(...);`         | All class instances are `std::shared_ptr`     |
| `function f(arr: int[])`      | `void f(std::vector<int>& arr)`                  | Arrays passed by mutable reference            |
| `let n: Node`                 | `std::shared_ptr<Node> n;`                       |                                               |
| `weak Node`                   | `std::weak_ptr<Node>`                            |                                               |
| `panic("message")`          | `std::cerr << ...; std::exit(1);`                | Program termination                           |
| `for (let i = 0; i < n; i++)` | `for (int i = 0; i < n; i++)`                    |                                               |
| `for (readonly x of arr)`     | `for (const auto& x : arr)`                      |                                               |
| `enum Color { Red, Blue }`    | `enum Color { Red, Blue };`                      |                                               |
| `let f = (a: int) => a + 1`   | `auto f = [](int a) { return a + 1; };`          |                                               |
| `import { foo } from "./bar"`| `using bar::foo;` or qualified name              |                                               |
