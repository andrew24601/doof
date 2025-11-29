# doof

A TypeScript-like language transpiler targeting C++, JavaScript, and VM bytecode.

## Installation

```bash
npm install -g doof
```

## Usage

```bash
# Transpile to C++ (default)
doof input.do

# Transpile multiple files
doof file1.do file2.do file3.do

# Specify output directory
doof -o ./build input.do

# Transpile to JavaScript
doof -t js input.do

# Transpile to VM bytecode
doof -t vm input.do

# Specify C++ namespace
doof --namespace myapp input.do

# Transpile, compile, and run (C++ only)
doof --run input.do
```

## Options

```
-h, --help              Show help message
-v, --version           Show version number
-o, --output <dir>      Output directory (default: same as input)
-t, --target <lang>     Target language: 'cpp' (default), 'js', or 'vm'
-n, --namespace <ns>    C++ namespace for generated code
--header-only           Generate only header file
--source-only           Generate only source file
--no-validation         Skip semantic validation
--source-root <dir>     Source root directory for namespace mapping
--verbose               Print verbose error/debug output
--no-line-directives    Disable C/C++ #line directives in output
-r, --run               Transpile, compile, and run the program
```

### Code Formatting

```bash
# Format and output to stdout
doof --format input.do

# Format in place
doof --format-in-place input.do

# Custom formatting options
doof --format --indent-size 2 --max-line-length 80 input.do
```

## Language Overview

doof is a TypeScript-inspired language designed for easy transpilation to idiomatic C++. It combines familiar TypeScript class and collection syntax with C++-style primitive types and memory management.

### Example

```typescript
// hello.do
class Greeter {
    name: string;
    
    greet(): string {
        return `Hello, ${this.name}!`;
    }
}

function main(): int {
    let greeter = Greeter { name: "World" };
    print(greeter.greet());
    return 0;
}
```

Transpile and run:

```bash
doof --run hello.do
```

## C++ Runtime

The package includes `doof_runtime.cpp` and `doof_runtime.h` which provide runtime support for the generated C++ code. Include these when compiling your transpiled output.

## Programmatic API

```typescript
import { Transpiler, transpile } from 'doof';

// Simple single-file transpilation
const result = transpile(sourceCode, { target: 'cpp' });

// Multi-file project transpilation
const transpiler = new Transpiler({ target: 'cpp', namespace: 'myapp' });
const projectResult = await transpiler.transpileProject(['file1.do', 'file2.do']);
```

## License

MIT
