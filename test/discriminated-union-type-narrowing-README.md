# Discriminated Union Type Narrowing - Test Coverage

This test file provides comprehensive coverage for the discriminated union type narrowing feature implemented in the Doof transpiler. The feature allows safe access to union-specific members after type guard checks.

## What's Tested

### Basic Type Narrowing (3 tests)
- String discriminants (`person.kind == "Adult"`)
- Numeric discriminants (`obj.id == 1`) 
- Boolean discriminants (`status.isActive == true`)

### Complex Scenarios (3 tests)
- Nested if-else chains with multiple discriminants
- Multiple variables with discriminated unions
- Method calls on narrowed types

### Method Access (1 test)
- Narrowed method calls on discriminated union types

### Error Cases (3 tests)
- Common member access without type guards (should work)
- Non-common member access without type guards (should error)
- Invalid discriminant values (should handle gracefully)

### Integration (2 tests)
- Function parameters and return types
- Local variable declarations

### Code Quality (2 tests)
- Generated C++ code structure and indentation
- Type safety preservation in C++ output

## Key Assertions

Each test verifies that:
1. No compilation errors occur for valid discriminated union patterns
2. The generated C++ code contains `std::get<std::shared_ptr<Type>>(variant)` for narrowed access
3. The discriminant checks use `std::visit([](auto&& variant) { return variant->field; }, variant) == value`
4. Type-specific members are only accessible within appropriate type guards

## Coverage Notes

- Tests focus on the core `std::get<Type>(variant)` generation which proves type narrowing is working
- Some tests use method calls rather than direct property access to work around current language syntax limitations
- Tests cover both property access and method calls on narrowed types
- Error cases ensure the type system correctly rejects invalid member access

This comprehensive test suite ensures the discriminated union type narrowing feature remains stable and functional across future changes to the transpiler.
