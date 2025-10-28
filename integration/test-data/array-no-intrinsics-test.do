// Test that support functions are only generated on demand
function main(): int {
    let arr = [1, 2, 3, 4, 5];
    println(arr.length); // Should NOT generate any __array_* functions
    return 0;
}