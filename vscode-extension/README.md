# Doof Language Support

## Overview

This VS Code extension provides comprehensive language support for the Doof programming language (`.do` files). Doof is a modern programming language that transpiles to C++, offering TypeScript-like syntax with C++ performance.

## ✨ Enhanced Features

### 🔍 **Semantic Diagnostics**
- **Real-time validation** using the Doof lexer, parser, and validator
- **Type checking** with precise error locations
- **Semantic analysis** for complex language constructs
- **Problems panel integration** with clickable error navigation

### 🏗️ **Advanced Code Intelligence**

#### **AST-Powered Completions**
- Context-aware symbol suggestions from parsed AST
- Function signatures with parameter and return type information
- Class, struct, enum, and variable completions
- Built-in function and operator suggestions

#### **Enhanced Hover Information**
- **Type inference** showing actual inferred types
- **Function signatures** with parameter details
- **Class/struct information** with C++ mapping details
- **Symbol documentation** from AST analysis

#### **Semantic Highlighting**
- **Context-aware syntax coloring** beyond TextMate grammars
- **Symbol classification** (class, struct, enum, function, variable, field, parameter)
- **Modifier highlighting** (static, readonly, declaration, definition)
- **Real-time updates** as you type

### 🛠️ **Code Actions & Quick Fixes**
- **Missing type annotations** - automatic type suggestions
- **Invalid syntax patterns** - quick fix suggestions
- **Best practice recommendations** - modern Doof patterns

### 📋 **Document Symbols**
- **Outline view** powered by AST analysis
- **Accurate symbol hierarchy** including nested declarations
- **Quick navigation** to classes, functions, structs, enums

### 🐛 **Integrated Debugging**
- **Built-in VM runner** - bundled json-runner binary for immediate debugging
- **DAP protocol support** - full debug adapter protocol implementation
- **Breakpoints** - set and manage breakpoints in your `.do` files
- **Step execution** - step over, step in, step out
- **Variable inspection** - examine variables and scopes during execution
- **Remote debugging** - connect to remote VM instances
- **No build required** - debug your code directly from the extension

### � **Automatic Formatting**
- Native Doof pretty printer integration for `.do` files
- Respects editor indentation settings and Doof-specific formatter options
- Available via **Format Document**, format-on-save, and the command palette

### �🌐 **Multi-file Validation**
- **Cross-file type checking** using global validation context
- **Import/export resolution** between modules
- **Workspace-wide validation** command
- **Dependency analysis** and circular import detection

## 🚀 Quick Start

1. **Install** the extension from the VS Code marketplace
2. **Open** a `.do` file or create a new one
3. **Start coding** - features activate automatically!

## 📝 Language Features

### **Syntax Highlighting**
- Keywords, operators, and literals
- String interpolation and template literals
- Type annotations and generics
- Comments and documentation

### **Code Completion**
- Doof keywords (`class`, `struct`, `function`, `let`, `const`)
- Built-in types (`int`, `float`, `string`, `bool`, `Array`, `Map`, `Set`)
- Operators (`=>`, `..`, `..<`, `&&`, `||`)
- Functions and methods with snippet support

### **Hover Information**
Rich hover tooltips for:
- **Classes**: Reference types with shared_ptr semantics
- **Structs**: Value types with stack allocation
- **Functions**: Signatures with parameter and return types
- **Variables**: Type information and const/let distinction
- **Operators**: Detailed operator semantics

### **Diagnostics**
Real-time error detection for:
- **Type mismatches** and inference failures
- **Missing type annotations** in function parameters
- **Undefined symbols** and scope violations
- **Import/export errors** in multi-file projects
- **Syntax errors** with precise locations

## 🎯 Commands

> **Note:** Build, transpile, and VM glue workflows now live in the Doof CLI. The extension focuses on editing, diagnostics, and debugging.

| Command | Description |
|---------|-------------|
| `Doof: Validate All Doof Files` | Run global validation across workspace |
| `Doof: Debug Doof File` | Start debugging the current `.do` file |
| `Doof: Create Launch Configuration` | Create a debug launch configuration |
| `Doof: Build VM` | Build the VM from source (if needed) |

## ⚙️ Configuration

The extension works out of the box with sensible defaults. Advanced users can customize behavior through VS Code settings.

### VM glue generation

Use the Doof CLI to emit VM glue for extern classes. Run `npx doof --vm-glue <entry.do> --vm-glue-dir <out>` (or the equivalent npm script) from your workspace root. The CLI continues to generate glue automatically when targeting C++ builds.

### Formatter configuration

The Doof formatter runs the same pretty printer shipped with the CLI. It honors the active editor tab size by default, and you can fine-tune its behavior via VS Code settings:

```json
{
    "doof.format.maxLineLength": 100,
    "doof.format.alignObjectProperties": false,
    "doof.format.breakLongArrays": true,
    "doof.format.breakLongObjects": true,
    "doof.format.breakLongFunctionParameters": true,
    "doof.format.insertSpaceAfterKeywords": true,
    "doof.format.insertSpaceBeforeBlockBrace": true,
    "doof.format.insertSpaceAfterComma": true,
    "doof.format.insertSpaceAroundBinaryOperators": true,
    "doof.format.insertFinalNewline": true,
    "doof.format.trimTrailingWhitespace": true
}
```

- Leave `doof.format.indentSize` unset to mirror the editor's `tabSize`, or set it explicitly for consistent indentation across contributors.
- The formatter respects workspace or user overrides and falls back to the global `files.insertFinalNewline` and `files.trimTrailingWhitespace` settings when its dedicated options are not configured.

## 📁 File Types

- **`.do`** - Doof source files
- Automatically activates for Doof files in your workspace

## 🏃 Performance

- **Incremental parsing** - only re-parse changed files
- **Smart caching** - AST and validation results cached per document version
- **Background validation** - non-blocking analysis
- **Memory efficient** - automatic cache cleanup

## 🧑‍💻 Example Usage

```doof
// Enhanced features in action:

class Person {                    // ← Semantic highlighting
    private name: string          // ← Type annotations
    private age: int
    
    constructor(name: string, age: int) {  // ← Parameter completion
        this.name = name          // ← Member access validation
        this.age = age
    }
    
    public function greet(): void {        // ← Hover shows return type
        println("Hello, I'm " + this.name) // ← Built-in function completion
    }
}

let person: Person = { name: "Alice", age: 30 }  // ← Type inference
person.greet()                    // ← Method completion with signature
```

## 🎯 Code Snippets
Rich code snippets for common Doof constructs:
- `class` - Create a new class with constructor and methods
- `struct` - Create a new struct
- `function` - Create a new function
- `enum` - Create a new enum
- `exception` - Create a new exception type
- `import`/`export` - Module import/export statements
- `for`/`forof` - Loop constructs
- `switch` - Switch statements with pattern matching
- `try` - Try-catch blocks
- `lambda` - Lambda expressions
- `array`/`map`/`set` - Collection declarations
- `pipe` - Pipe operations

## 🔧 Development

### Building from Source
```bash
git clone <repository>
cd doof-plugin
npm install
npm run compile
```

### Testing
```bash
npm test
```

## 🐛 Debugging

The extension includes an integrated Doof debugger with a bundled VM runner. You can debug your `.do` files directly from VS Code without any additional setup.

### Quick Start Debugging

1. Open a `.do` file
2. Set breakpoints by clicking in the gutter (left of line numbers)
3. Press `F5` or use the "Debug Doof File" command
4. Use the debug controls to step through your code

### Debug Configuration

Create a `.vscode/launch.json` file for advanced debugging options:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "doof",
            "request": "launch",
            "name": "Debug Doof File",
            "program": "${file}",
            "stopOnEntry": true
        }
    ]
}
```

#### Configuration Options

- `program` - Path to the `.do` file to debug (default: `${file}`)
- `cwd` - Working directory (default: `${workspaceFolder}`)
- `stopOnEntry` - Pause on the first line (default: `true`)
- `verbose` - Enable verbose VM output (default: `false`)
- `mode` - Debug mode: `"local"` or `"remote"` (default: `"local"`)
- `vmPath` - Custom path to VM executable (optional, uses bundled VM by default)

### Remote Debugging

Connect to a remote VM instance:

```json
{
    "type": "doof",
    "request": "launch",
    "name": "Remote Debug",
    "program": "${file}",
    "mode": "remote",
    "host": "192.168.1.100",
    "port": 7777
}
```

### Bundled VM

The extension includes a bundled `json-runner` binary for immediate debugging. No separate VM build is required unless you're developing the VM itself. See [BUNDLED_VM.md](BUNDLED_VM.md) for details about updating the bundled binary.

## 🐛 Troubleshooting

**Extension not activating?**
- Ensure you have `.do` files in your workspace
- Check VS Code's Output panel for error messages

**Completions not working?**
- Verify file is saved with `.do` extension
- Check for syntax errors that might prevent parsing

**Diagnostics not updating?**
- Try saving the file to trigger re-validation
- Use `Doof: Validate All Doof Files` for workspace-wide refresh

## 🤝 Contributing

We welcome contributions! Please see our [contribution guidelines](CONTRIBUTING.md) for details.

## 📜 License

This extension is licensed under the [MIT License](LICENSE).

## 🔗 Related

- [Doof Language Documentation](https://doof-lang.org)
- [Doof Transpiler](https://github.com/doof-lang/transpiler)
- [VS Code Extension Development](https://code.visualstudio.com/api)

---

**Happy coding with Doof! 🎮** 