# doof Syntax Guide

**See Also:**
- [Null Safety Operators](null-safety-operators.md)

doof is a TypeScript-inspired language designed for easy transpilation to idiomatic C++. It combines familiar TypeScript class and collection syntax with C++-style primitive types and memory management.
# Immutability (update)
- Use `readonly` for immutable variables and parameters. `const` for variables is deprecated and emits a warning.
- Readonly collections are deeply immutable; element/value types must be immutable.
- `readonly class` asserts all fields are immutable; validation enforces this.
# doof Syntax Guide (split)

This guide has been split into focused topics under `docs/syntax/` to make it easier to read and maintain. Start here:

- Overview: [syntax/overview.md](syntax/overview.md)
- Modules and imports: [syntax/modules-and-imports.md](syntax/modules-and-imports.md)
- Primitives: [syntax/primitives.md](syntax/primitives.md)
- Strings and interpolation: [syntax/strings.md](syntax/strings.md)
- Classes and initialization: [syntax/classes.md](syntax/classes.md)
- Pointers and references: [syntax/pointers-and-references.md](syntax/pointers-and-references.md)
- Interfaces (structural): [syntax/interfaces.md](syntax/interfaces.md)
- Collections: [syntax/collections.md](syntax/collections.md)
- Functions: [syntax/functions.md](syntax/functions.md)
- Generics: [syntax/generics.md](syntax/generics.md)
- Async/Await: [syntax/async-await.md](syntax/async-await.md)
- Markdown blocks in code: [syntax/markdown-blocks.md](syntax/markdown-blocks.md)
- Expressions and control flow: [syntax/expressions-and-control-flow.md](syntax/expressions-and-control-flow.md)
- Numerics and conversions: [syntax/numerics-and-conversions.md](syntax/numerics-and-conversions.md)
- Built-in functions: [syntax/builtins.md](syntax/builtins.md)
- Error handling: [syntax/error-handling.md](syntax/error-handling.md)
- C++ mapping summary: [syntax/cpp-mapping.md](syntax/cpp-mapping.md)
- Multi-file project structure: [syntax/project-structure.md](syntax/project-structure.md)
 - XML element calls: [syntax/xml-elements.md](syntax/xml-elements.md)

See also:
- Lambdas: [lambdas.md](lambdas.md)
- Null safety operators: [null-safety-operators.md](null-safety-operators.md)
// In method calls
class TaskManager {
    setTaskPriority(taskId: int, priority: Priority): void {
        // implementation
    }
}

let manager: TaskManager = TaskManager {};
manager.setTaskPriority(456, .LOW);

// Mixed syntax is also supported
let mixedMap: Map<Status, string> = { 
    .ACTIVE: "Running", 
    Status.INACTIVE: "Stopped"  // Full syntax
};
```

This transpiles to:

```cpp
std::unordered_set<Status> statusSet = {Status::ACTIVE, Status::INACTIVE};

std::unordered_map<Status, std::string> statusMap = {
    {Status::ACTIVE, "Running"},
    {Status::INACTIVE, "Stopped"},
    {Status::PENDING, "Waiting"}
};

Task task = Task{
    "Important Task",
    Status::ACTIVE,
    Priority::HIGH
};

updateStatus(123, Status::INACTIVE);

Status currentStatus;
currentStatus = Status::PENDING;

std::shared_ptr<TaskManager> manager = std::make_shared<TaskManager>();
manager->setTaskPriority(456, Priority::LOW);

std::unordered_map<Status, std::string> mixedMap = {
    {Status::ACTIVE, "Running"},
    {Status::INACTIVE, "Stopped"}
};
```

The shorthand syntax is supported in:
- Set literals: `[.MEMBER1, .MEMBER2]`
- Map literals: `{ .KEY1: value1, .KEY2: value2 }`
- Object field initialization: `StructName { field: .MEMBER }`
- Function/method arguments: `func(.MEMBER)`
- Variable assignment: `variable = .MEMBER`
- Nested contexts where enum types can be inferred

Note: Enum shorthand is only available where the enum type can be inferred from context (type annotations, parameter types, field types, etc.).

## Lambda Expressions and Function Types

Doof provides comprehensive support for lambda expressions and function types. For detailed documentation on lambda syntax, concise declaration forms, trailing lambdas, and capture behavior, see [Lambda Documentation](lambdas.md).

### Quick Examples

```doof
// Concise function parameters
function process(callback(value: int)): void {
    callback(42);
}

// Concise lambda variables  
readonly doIt(value: int) => println(value);

// Concise callable class fields
class Button {
    onClick(event: MouseEvent);
    onSubmit(data: FormData): boolean;
}

// Traditional lambda expressions
readonly add: (a: int, b: int): int = (a, b) => a + b;

// Short-form lambdas
numbers.map(=> it * 2);

// Trailing lambda syntax
numbers.forEach => println(it);
```

- No `any` or `unknown` types. No `undefined` value
- `null` is mapped to `nullptr`.
- Type inference is limited; explicit types are preferred.

// Note: All classes and structs are directly printable as JSON via operator<< (e.g., std::cout << obj;).

## Multi-File Project Structure and Best Practices

### Project Organization

Organize your Doof project with clear module boundaries and logical file structure:

```
my-project/
├── src/
│   ├── main.do              # Application entry point
│   ├── utils/
│   │   ├── math.do          # Math utilities
│   │   ├── string-helpers.do # String manipulation
│   │   └── file-io.do       # File operations
│   ├── models/
│   │   ├── user.do          # User data structures
│   │   └── config.do        # Configuration types
│   └── services/
│       ├── database.do      # Database interface
│       └── api-client.do    # External API client
├── test/
│   ├── utils/
│   │   └── math.spec.do     # Math utilities tests
│   └── models/
│       └── user.spec.do     # User model tests
├── doof_runtime.h         # Runtime library header
├── doof_runtime.cpp       # Runtime library implementation
└── build/                   # Generated C++ output
    ├── main.h
    ├── main.cpp
    ├── utils_math.h
    ├── utils_math.cpp
    └── ...
```

### Export Guidelines

**Be Explicit About Public APIs:** Only export symbols that are intended for use by other modules.

```doof
// Good: Clear public API
export class UserManager {
    createUser(name: string): User { ... }
    deleteUser(id: int): void { ... }
}

// Private implementation details are not exported
class DatabaseConnection {
    private connect(): void { ... }
}
```

**Use Barrel Exports:** Create index files to aggregate exports from multiple modules:

```doof
// utils/index.do
export { add, subtract, multiply } from "./math";
export { capitalize, truncate } from "./string-helpers";
export { readConfig, writeConfig } from "./file-io";
```

### Import Best Practices

**Use Relative Paths:** Import from relative paths for local modules:

```doof
import { UserManager } from "./models/user";
import { DatabaseConfig } from "../config/database";
```

**Import Only What You Need:** Be specific about imports to improve compilation and readability:

```doof
// Good
import { add, multiply } from "./math";

// Less ideal (though functionally equivalent)
import * as Math from "./math";  // Not yet supported
```

### Namespace Management

**Understand Generated Namespaces:** File paths map to C++ namespaces:

- `src/utils/math.do` → `namespace utils::math`
- `services/api-client.do` → `namespace services::api_client`

**Configure Source Roots:** Use multiple source roots to keep namespaces clean:

```bash
# Both src/ and test/ files get clean namespaces
doof --source-root src --source-root test src/**/*.do test/**/*.do
```

### Compilation and Linking

When building multi-file Doof projects:

1. **Transpile All Files:**
   ```bash
   doof --source-root src src/**/*.do
   ```

2. **Compile Generated C++:**
   ```bash
   g++ -std=c++17 -I. -o myapp \
       build/*.cpp \
       doof_runtime.cpp
   ```

3. **Link Dependencies:** Ensure all generated C++ files and the runtime library are linked together.

### Circular Dependencies

Avoid circular import dependencies:

```doof
// BAD: user.do and order.do import each other
// user.do
import { Order } from "./order";
export class User {
    orders: Order[] = [];
}

// order.do  
import { User } from "./user";
export class Order {
    customer: User;
}
```

**Solution:** Use forward declarations or extract shared types:

```doof
// types.do
export enum OrderStatus { PENDING, FULFILLED, CANCELLED }

// user.do
import { OrderStatus } from "./types";
export class User {
    name: string = "";
}

// order.do
import { OrderStatus } from "./types";
// Import User by reference - store user ID instead of object
export class Order {
    customerId: int = 0;
    status: OrderStatus = OrderStatus.PENDING;
}
```

### Testing Multi-File Projects

Structure tests to mirror your source organization:

```doof
// test/utils/math.spec.do
import { add, multiply } from "../../src/utils/math";

function testAdd(): void {
    assert(add(2, 3) == 5);
    assert(add(-1, 1) == 0);
}

function testMultiply(): void {
    assert(multiply(3, 4) == 12);
    assert(multiply(0, 5) == 0);
}
```

### Performance Considerations

- **Header-Only Templates:** Template functions in the runtime library are header-only for optimal performance
- **Minimal Includes:** The transpiler only includes `doof_runtime.h` when runtime helpers are actually used
- **Namespace Isolation:** Each module compiles to its own namespace, preventing symbol collisions
- **Incremental Builds:** C++ compilers can leverage header files for faster incremental compilation
