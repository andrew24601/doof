# Change Log

All notable changes to the "doof-language-support" extension will be documented in this file.

## [0.0.1] - 2025-08-01

### Added
- Initial release of Doof Language Support extension
- Complete syntax highlighting for .do files using TextMate grammar
- IntelliSense with auto-completion for keywords, types, and operators
- Hover documentation for language features and built-in functions
- Rich code snippets for all major Doof constructs
- Real-time diagnostics and error detection
- Document symbol provider for outline navigation
- Language configuration for proper bracket matching and comments
- Context menu command for transpiling .do files to C++
- Support for all Doof language features:
  - Classes, structs, enums, exceptions
  - Import/export system
  - Pipe operations and lambda expressions
  - Pattern matching in switch statements
  - Object literal and positional construction
  - Collection types (arrays, maps, sets)
  - Two division operators (/ and \)
  - Range operators (.. and ..<)
  - String interpolation
  - Built-in functions (println)

### Technical Features
- TypeScript-based extension with full type safety
- ESBuild for fast compilation and bundling
- Comprehensive test coverage with sample .do file
- VS Code API integration for all language service features
- Professional file icons for light and dark themes

## [Unreleased]

### Planned Features
- Integration with actual Doof transpiler
- Syntax validation and semantic analysis
- Go to definition and find references
- Refactoring support
- Debug adapter protocol integration
- IntelliSense for imported symbols
- Project-wide symbol search
- Code formatting provider