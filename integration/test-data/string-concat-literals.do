// Test string literal concatenation
// Tests: String literal + literal, literal + variable, variable + literal

function main(): int {
    // Test 1: Two literals
    let lit1: string = "Hello" + "World";
    println(lit1);  // Should print "HelloWorld"
    
    // Test 2: Multiple literals
    let lit2: string = "a" + "b" + "c";
    println(lit2);  // Should print "abc"
    
    // Test 3: Literal + variable
    let var1: string = "World";
    let lit3: string = "Hello " + var1;
    println(lit3);  // Should print "Hello World"
    
    // Test 4: Variable + literal
    let var2: string = "Hello";
    let lit4: string = var2 + " World";
    println(lit4);  // Should print "Hello World"
    
    // Test 5: Mixed literals and variables
    let first: string = "Hello";
    let second: string = "Beautiful";
    let lit5: string = first + " " + second + " World";
    println(lit5);  // Should print "Hello Beautiful World"
    
    // Test 6: Literal + number
    let lit6: string = "Count: " + 42;
    println(lit6);  // Should print "Count: 42"
    
    // Test 7: Literal + boolean
    let lit7: string = "Active: " + true;
    println(lit7);  // Should print "Active: true"
    
    return 0;
}
