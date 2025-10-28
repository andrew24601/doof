// Test != (not equal) operations
// Tests: NE_INT, NE_FLOAT, NE_DOUBLE

function main(): int {
    // Integer comparisons
    let a: int = 5;
    let b: int = 3;
    let c: int = 5;
    
    println(a != b);  // Should print true (5 != 3)
    println(a != c);  // Should print false (5 != 5)
    
    // Float comparisons  
    let x: float = 2.5;
    let y: float = 3.7;
    let z: float = 2.5;
    
    println(x != y);  // Should print true (2.5 != 3.7)
    println(x != z);  // Should print false (2.5 != 2.5)
    
    return 0;
}
