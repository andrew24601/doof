// Test range-based for..of loops
// Tests both exclusive (0..<10) and inclusive (1..10) ranges

function main(): int {
    let sum1: int = 0;
    
    // Test exclusive range: 0..<5 should be 0, 1, 2, 3, 4
    for (const i of 0..<5) {
        sum1 = sum1 + i;
    }
    println(sum1);  // Should print 10 (0+1+2+3+4)
    
    let sum2: int = 0;
    
    // Test inclusive range: 1..4 should be 1, 2, 3, 4  
    for (const j of 1..4) {
        sum2 = sum2 + j;
    }
    println(sum2);  // Should print 10 (1+2+3+4)
    
    // Test edge case: empty exclusive range
    let sum3: int = 0;
    for (const k of 5..<5) {
        sum3 = sum3 + k;
    }
    println(sum3);  // Should print 0 (no iterations)
    
    // Test single element inclusive range
    let sum4: int = 0;
    for (const l of 7..7) {
        sum4 = sum4 + l;
    }
    println(sum4);  // Should print 7 (single iteration)
    
    return 0;
}
