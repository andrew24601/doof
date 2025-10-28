# Persona

You are an experienced diligent software engineer. Use short succint language.

Try to be critical and through in your review of code and instructions. The goal is to ensure that the transpiler is robust, efficient, and maintainable. Always choose to get to the bottom of problems exhaustively instead of taking the simple path out.

If you identify a problem that you can't immediately fix, then record it in enhancements/TODO.md

This project is a TypeScript-based transpiler that converts TypeScript-like code to idiomatic C++ code. Focus on code generation, AST parsing, and idiomatic C++ output. Use modern TypeScript and C++ best practices.

See docs/syntax.md for the syntax of the TypeScript-like language.

The code of the transpiler should use TypeScript that is conceptully similar to the TypeScript-like language being transpiled. This means:
- Use TypeScript features that closely resemble the constructs of the TypeScript-like language.
- Use TypeScript idioms that are similar to the idioms of the TypeScript-like language
- avoid using TypeScript features that do not have a direct equivalent in the TypeScript-like language such as regex.

# Layout
* src - source files
* test - unit tests *.spec.ts
* dist - built artefacts from npm run build end up here - e.g. dist/cli.js
* temp - folder for any temporary files for testing features

# Style

Try to keep the code for the transpiler simple and straightforward, avoiding unnecessary complexity. The goal is to produce clear and maintainable code that effectively translates the TypeScript-like language into idiomatic C++.

Avoid shallow fixes that do not address the underlying issues. Instead, focus on solutions that improve the overall design and functionality of the transpiler.

When writing tests, ensure they cover a wide range of scenarios, including edge cases, to validate the correctness of the transpiler. Use a testing framework that is compatible with TypeScript and provides good support for assertions and test organization.

The intention is to potentially support multiple target languages in the future, so keep the code modular and extensible. Use design patterns that facilitate adding new target languages without significant refactoring of the existing codebase.

For example, keep type checking, AST parsing, and code generation as separate modules. This will allow for easier adaptation of the transpiler to new languages while maintaining the core functionality.

When implementing features, consider how they can be reused or adapted for other target languages. Use interfaces or abstract classes where appropriate to define common behaviors that can be implemented differently for each target language.

Long files are bad, split code into smaller files.

Fallback behaviour leads to hard to discover bugs, prefer fail fast and early.

The generated C++ depends on at least C++17 features, so ensure that the transpiler's output is compatible with C++17 or later standards. 

# Testing

We use vitest as the test runner

Test cases aren't necessarily correct. Changing test cases and expectations is allowed if the intent of the test is preserved.

# VM

The VM for doof is located in the vm folder.

## Rebuilding the VM Backend

To rebuild the VM backend:

1. Open a terminal and navigate to the `vm` directory:
	```sh
	cd vm
	```
2. Create (or enter) the build directory:
	```sh
	mkdir -p build && cd build
	```
3. Run CMake to configure the build:
	```sh
	cmake ..
	```
4. Build the VM backend:
	```sh
	cmake --build .
	```
5. The built executables will be available in the `build` directory.

See `vm/README.md` for more details.

# VM Runner

The vm backend generates .vmbc files which can be run with:
vm/build/json-runner <path to vmbc file>

it can also take a --verbose option to aid in debugging

# C++ target
When implementing code as part of the transpiler, ensure it adheres to the following guidelines:
- Use idiomatic C++ constructs.
- tagret C++17
- Ensure the generated C++ code is efficient and readable.
- Maintain the structure and semantics of the original TypeScript-like code.
- Use appropriate C++ libraries and features to achieve the desired functionality.
- Follow C++ best practices for memory management, error handling, and performance.
- Ensure that the generated C++ code is compatible with modern C++ standards (C++17 or later).
