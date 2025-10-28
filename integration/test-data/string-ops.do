// Test string operations
// Tests: ADD_STRING, LENGTH_STRING, EQ_STRING

function main(): int {
    let str1: string = "Hello";
    let str2: string = " World";
    let str3: string = "Hello";
    
    let concat: string = str1 + str2;  // ADD_STRING
    let len1: int = str1.length;       // LENGTH_STRING
    let len2: int = concat.length;     // LENGTH_STRING
    let equal: bool = str1 == str3;    // EQ_STRING (true)
    let not_equal: bool = str1 == str2; // EQ_STRING (false)
    
    println(concat);    // Should print "Hello World"
    println(len1);      // Should print 5
    println(len2);      // Should print 11
    println(equal);     // Should print true
    println(not_equal); // Should print false
    
    return 0;
}
