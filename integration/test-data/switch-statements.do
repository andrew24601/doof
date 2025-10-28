// Test switch statements with integer cases
function main(): int {
    let input = 2;
    let result = 0;

    switch (input) {
        case 1:
            result = 1;
        case 2:
            result = 2;
        case 3:
            result = 3;
        default:
            result = 99;
    }
    println(result); // Should print 2

    // Switch with different input
    let input2 = 5;
    let result2 = 0;
    switch (input2) {
        case 1:
            result2 = 10;
        case 2:
            result2 = 20;
        case 3:
            result2 = 30;
        default:
            result2 = 40;
    }
    println(result2); // Should print 40

    // Switch with multiple case labels (replaces fallthrough)
    let grade = 2; // Representing 'B'
    let score = 0;
    switch (grade) {
        case 1, 2: // 'A' or 'B'
            score = 90;
        case 3: // 'C'
            score = 80;
        case 4, 5: // 'D' or 'F'
            score = 60;
    }
    println(score); // Should print 90

    // Test empty cases - they should do nothing and not fall through
    let input3 = 7;
    let result3 = 100; // Initial value
    switch (input3) {
        case 6:
            // Empty case - should do nothing and exit switch
        case 7:
            // Another empty case - should do nothing and exit switch  
        case 8:
            result3 = 999; // This should NOT execute for input3 = 7
        default:
            result3 = 777; // This should NOT execute for input3 = 7
    }
    println(result3); // Should print 100 (unchanged)

    return 0;
}