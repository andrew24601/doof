// Test <= and >= comparison operators (synthesized)
function main(): int {
    let a: int = 10;
    let b: int = 5;
    let c: int = 10;
    
    let lte1: bool = a <= c;  // 10 <= 10 = true (LTE_INT)
    let lte2: bool = b <= a;  // 5 <= 10 = true (LTE_INT)
    let lte3: bool = a <= b;  // 10 <= 5 = false (LTE_INT)
    
    let gte1: bool = a >= c;  // 10 >= 10 = true (synthesized as c <= a)
    let gte2: bool = a >= b;  // 10 >= 5 = true (synthesized as b <= a)
    let gte3: bool = b >= a;  // 5 >= 10 = false (synthesized as a <= b)
    
    println(lte1);  // Should print true
    println(lte2);  // Should print true
    println(lte3);  // Should print false
    println(gte1);  // Should print true
    println(gte2);  // Should print true
    println(gte3);  // Should print false
    
    return 0;
}
