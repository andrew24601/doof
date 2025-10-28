// Test range-based loop constructs
function main(): int {
    // Range-based for loop (exclusive)
    let count = 0;
    for (const i of 0..<3) {
        count = count + i;
    }
    println(count); // Should print 3 (0+1+2)

    // Range-based for loop (inclusive)
    let sum = 0;
    for (const j of 1..3) {
        sum = sum + j;
    }
    println(sum); // Should print 6 (1+2+3)

    // Nested range loops
    let nestedSum = 0;
    for (const outer of 0..<2) {
        for (const inner of 0..<2) {
            nestedSum = nestedSum + outer + inner;
        }
    }
    println(nestedSum); // Should print 2 (0+0+0+1+1+0+1+1)

    return 0;
}
