// Test boolean logic operations
// Tests: NOT_BOOL, AND_BOOL, OR_BOOL

function main(): int {
    let a: bool = true;
    let b: bool = false;
    
    let not_a: bool = !a;           // NOT_BOOL
    let not_b: bool = !b;           // NOT_BOOL
    let and_result: bool = a && b;   // AND_BOOL
    let or_result: bool = a || b;    // OR_BOOL
    
    println(not_a);     // Should print false
    println(not_b);     // Should print true
    println(and_result); // Should print false
    println(or_result);  // Should print true
    
    return 0;
}
