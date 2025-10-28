// Test panic function for error handling

function safeDivision(x: int, y: int): int {
    if (y == 0) {
        panic("Division by zero error");
    }
    return x / y;
}

function validateInput(value: int): void {
    if (value < 0) {
        panic("Negative values not allowed");
    }
}

function main(): int {
    // This should work fine
    let result1 = safeDivision(10, 2);
    println("Safe division result: 5");
    
    // This should also work
    validateInput(5);
    println("Input validation passed");
    
    // This will panic and exit the program
    let result2 = safeDivision(10, 0);
    println("This should never be reached");
    
    return 0;
}