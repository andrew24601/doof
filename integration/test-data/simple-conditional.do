// Test simple conditional execution
// Tests: GT_INT, JMP_IF_FALSE

function main(): int {
    let x: int = 10;
    let y: int = 5;
    
    if (x > y) {
        println(1);  // Print 1 if x > y
    } else {
        println(0);  // Print 0 if x <= y  
    }
    
    return 0;
}
