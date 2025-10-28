// Test basic class features
// Tests: Class declaration, field access, method calls, object-literal construction

class Person {
    name: string;
    age: int;
    
    greet(): string {
        return "Hello, I am " + this.name;
    }
    
    getAge(): int {
        return this.age;
    }
    
    setAge(newAge: int): void {
        this.age = newAge;
    }
}

function main(): int {
    // Object-literal construction
    let person1 = Person { name: "Alice", age: 30 };
    
    // Method calls
    let greeting: string = person1.greet();
    let currentAge: int = person1.getAge();
    
    // Field access
    let personName: string = person1.name;
    
    // Method that modifies state
    person1.setAge(31);
    let newAge: int = person1.getAge();
    
    println(greeting);      // Should print: Hello, I am Alice
    println(currentAge);    // Should print: 30
    println(personName);    // Should print: Alice
    println(newAge);        // Should print: 31
    
    return 0;
}
