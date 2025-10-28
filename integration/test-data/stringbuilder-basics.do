// Test StringBuilder construction and methods for all backends
// Tests both positional and object literal construction, chaining, and conversion

function main(): int {
    // Test positional construction
    let sb1 = StringBuilder();
    
    // Test object literal construction  
    let sb2 = StringBuilder { };
    
    // Test positional construction with capacity
    let sb3 = StringBuilder(100);
    
    // Test basic append operations
    sb1.append("Hello");
    sb1.append(" ");
    sb1.append("World");
    
    // Test method chaining
    sb2.append("The answer is ").append(42).append("!");
    
    // Test different data types
    sb3.append("Boolean: ").append(true).append(", Double: ").append(3.14159);
    
    // Test toString conversion
    let result1 = sb1.toString();
    let result2 = sb2.toString();
    let result3 = sb3.toString();
    
    // Output results
    println(result1);
    println(result2);
    println(result3);
    
    // Test clear and reuse
    sb1.clear();
    sb1.append("Cleared and reused");
    println(sb1.toString());
    
    return 0;
}
