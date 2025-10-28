// Test constants and null handling
// Tests: LOADK, LOADK_NULL, LOADK_INT16, MOVE

function main(): int {
    let num: int = 42;         // LOADK_INT16
    let str: string = "test";  // LOADK
    let nullVal: int | null = null;  // LOADK_NULL
    
    let copy: int = num;       // MOVE
    
    println(num);    // Should print 42
    println(str);    // Should print "test"
    println(copy);   // Should print 42
    
    // Test null comparison
    if (nullVal == null) {     // EQ_OBJECT or special null comparison
        println("is null");
    } else {
        println("not null");
    }
    
    return 0;
}
