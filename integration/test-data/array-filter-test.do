// Simple array method test
function main(): int {
    let numbers = [1, 2, 3, 4, 5, 6, 7, 8];
    
    // Test filter only
    let evens = numbers.filter(=> it % 2 == 0);
    println(evens);

    return 0;
}