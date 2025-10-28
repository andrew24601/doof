// Test float arithmetic operations
// Tests: ADD_FLOAT, SUB_FLOAT, MUL_FLOAT, DIV_FLOAT, LOADK

function main(): int {
    let a: float = 10.5;
    let b: float = 2.5;
    
    let sum: float = a + b;        // ADD_FLOAT
    let diff: float = a - b;       // SUB_FLOAT
    let product: float = a * b;    // MUL_FLOAT
    let quotient: float = a / b;   // DIV_FLOAT
    
    println(sum);      // Should print 13
    println(diff);     // Should print 8
    println(product);  // Should print 26.25
    println(quotient); // Should print 4.2
    
    return 0;
}
