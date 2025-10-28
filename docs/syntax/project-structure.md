# Multi-File Project Structure and Best Practices

## Organization

Organize your Doof project with clear module boundaries and logical file structure:

```
my-project/
├── src/
│   ├── main.do
│   ├── utils/
│   │   ├── math.do
│   │   ├── string-helpers.do
│   │   └── file-io.do
│   ├── models/
│   │   ├── user.do
│   │   └── config.do
│   └── services/
│       ├── database.do
│       └── api-client.do
├── test/
│   ├── utils/
│   │   └── math.spec.do
│   └── models/
│       └── user.spec.do
├── doof_runtime.h
├── doof_runtime.cpp
└── build/
    ├── main.h
    ├── main.cpp
    ├── utils_math.h
    ├── utils_math.cpp
    └── ...
```

## Export guidelines

Be explicit about public APIs:

```doof
export class UserManager {
    createUser(name: string): User { ... }
    deleteUser(id: int): void { ... }
}

class DatabaseConnection {
    private connect(): void { ... }
}
```

Use barrel exports to aggregate:

```doof
// utils/index.do
export { add, subtract, multiply } from "./math";
export { capitalize, truncate } from "./string-helpers";
export { readConfig, writeConfig } from "./file-io";
```

## Import best practices

- Use relative paths for local modules
- Import only what you need

## Namespace management

File paths map to C++ namespaces. Configure multiple source roots to keep namespaces clean:

```bash
doof --source-root src --source-root test src/**/*.do test/**/*.do
```

## Build

Transpile all files, compile generated C++, and link the runtime.

## Circular dependencies

Avoid circular imports; prefer shared types or IDs over back references.

## Testing

Mirror your source structure in tests and keep dependencies minimal.

## Performance

- Header-only templates in runtime for performance
- Minimal includes: only include `doof_runtime.h` when needed
- Namespace isolation prevents collisions
- C++ incremental builds benefit from headers
