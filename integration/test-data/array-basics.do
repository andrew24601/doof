// Test array operations
// Tests: NEW_ARRAY, GET_ARRAY, SET_ARRAY

function main(): int {
    let arr: int[] = [1, 2, 3, 4, 5];  // NEW_ARRAY + SET_ARRAY calls
    
    let first: int = arr[0];    // GET_ARRAY
    let third: int = arr[2];    // GET_ARRAY
    
    arr[1] = 10;               // SET_ARRAY
    let second: int = arr[1];  // GET_ARRAY
    
    println(first);   // Should print 1
    println(second);  // Should print 10  
    println(third);   // Should print 3
    println(arr.length); // Should print 5
    
    return 0;
}
