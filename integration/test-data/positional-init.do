// Test positional object initialization
// Tests: Positional initialization syntax with parentheses

class Point {
    x: int;
    y: int;
}

class Person {
    name: string;
    age: int;
}

function main(): int {
    // Positional initialization for class without constructor
    let point1 = Point(10, 20);
    println(point1.x);      // Should print: 10
    println(point1.y);      // Should print: 20
    
    // Positional initialization for class with constructor
    let person1 = Person("Bob", 25);
    println(person1.name);  // Should print: Bob
    println(person1.age);   // Should print: 25
    
    return 0;
}
