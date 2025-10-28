// Test integer comparison operations
// Tests: EQ_INT, LT_INT, GT_INT

function main(): int {
    let a: int = 10;
    let b: int = 5;
    let c: int = 10;
    
    let equal: bool = a == c;      // EQ_INT (true)
    let not_equal: bool = a == b;  // EQ_INT (false)
    let less: bool = b < a;        // LT_INT (true)
    let greater: bool = a > b;     // GT_INT (true)
    let not_less: bool = a < b;    // LT_INT (false)
    let not_greater: bool = b > a; // GT_INT (false)
    
    println(equal);      // Should print true
    println(not_equal);  // Should print false
    println(less);       // Should print true
    println(greater);    // Should print true
    println(not_less);   // Should print false
    println(not_greater); // Should print false
    
    return 0;
}
