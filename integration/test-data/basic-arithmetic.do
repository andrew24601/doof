// Test basic integer arithmetic operations
// Tests: ADD_INT, SUB_INT, MUL_INT, DIV_INT, LOADK_INT16

function main(): int {
    let a: int = 10;
    let b: int = 5;
    
    let sum: int = a + b;        // ADD_INT
    let diff: int = a - b;       // SUB_INT  
    let product: int = a * b;    // MUL_INT
    let quotient: int = a / b;   // DIV_INT
    
    println(sum);      // Should print 15
    println(diff);     // Should print 5
    println(product);  // Should print 50
    println(quotient); // Should print 2
    
    return 0;
}
