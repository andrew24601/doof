// Test type conversions
// Tests: INT_TO_FLOAT, FLOAT_TO_INT, INT_TO_DOUBLE, DOUBLE_TO_INT, FLOAT_TO_DOUBLE, DOUBLE_TO_FLOAT

function main(): int {
    let i: int = 42;
    let f: float = 3.14;
    let d: double = 2.71828;
    
    let i_to_f: float = i;          // INT_TO_FLOAT (implicit)
    let f_to_i: int = f;            // FLOAT_TO_INT (implicit, truncates)
    let i_to_d: double = i;         // INT_TO_DOUBLE (implicit)
    let d_to_i: int = d;            // DOUBLE_TO_INT (implicit, truncates)
    let f_to_d: double = f;         // FLOAT_TO_DOUBLE (implicit)
    let d_to_f: float = d;          // DOUBLE_TO_FLOAT (implicit)
    
    println(i_to_f);    // Should print 42
    println(f_to_i);    // Should print 3
    println(i_to_d);    // Should print 42
    println(d_to_i);    // Should print 2
    println(f_to_d);    // Should print 3.14
    println(d_to_f);    // Should print 2.71828
    
    return 0;
}
