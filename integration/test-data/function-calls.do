// Test simple function calls
// Tests: CALL, RETURN

function add(a: int, b: int): int {
    return a + b;  // RETURN
}

function multiply(x: int, y: int): int {
    let result: int = x * y;
    return result;  // RETURN
}

function main(): int {
    let sum: int = add(5, 3);        // CALL
    let product: int = multiply(4, 6); // CALL
    
    println(sum);     // Should print 8
    println(product); // Should print 24
    
    return 0;  // RETURN
}
