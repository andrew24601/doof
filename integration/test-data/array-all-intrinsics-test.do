// Test that multiple array intrinsics generate their respective support functions
function main(): int {
    let arr = [1, 2, 3, 4, 5, 6, 7, 8];
    
    // Use filter
    let evens = arr.filter(=> it % 2 == 0);
    
    // Use map
    let doubled = evens.map(=> it * 2);
    
    // Use forEach
    doubled.forEach(=> println(it));
    
    // Use reduce (with initial value as required)
    let sum = doubled.reduce(0, (acc: int, it: int, index: int, array: int[]) => acc + it);
    
    println(sum);
    return 0;
}