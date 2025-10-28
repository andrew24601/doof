// Test simple if-else control flow
// Tests: JMP_IF_FALSE, JMP_IF_TRUE, JMP

function main(): int {
    let x: int = 10;
    let y: int = 5;
    
    if (x > y) {              // LT_INT + JMP_IF_FALSE
        println("x is greater");
    } else {
        println("y is greater or equal");
    }
    
    if (x < y) {              // GT_INT + JMP_IF_FALSE  
        println("x is less");
    } else {
        println("x is greater or equal");
    }
    
    return 0;
}
