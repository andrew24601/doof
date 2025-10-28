// Test static methods and fields
// Tests: Static method calls, static field access, class-level functionality

class Counter {
    static count: int = 0;
    id: int;
        
    static getCount(): int {
        return Counter.count;
    }
    
    static reset(): void {
        Counter.count = 0;
    }

    static create(): Counter {
        Counter.count++;
        return {id: Counter.count};
    }
    
    getId(): int {
        return this.id;
    }
}

function main(): int {
    // Check initial static field value
    let initialCount: int = Counter.getCount();
    println(initialCount);  // Should print: 0
    
    // Create first instance
    let counter1 = Counter.create();
    let count1: int = Counter.getCount();
    let id1: int = counter1.getId();
    
    // Create second instance  
    let counter2 = Counter.create();
    let count2: int = Counter.getCount();
    let id2: int = counter2.getId();
    
    println(count1);        // Should print: 1
    println(id1);           // Should print: 1
    println(count2);        // Should print: 2
    println(id2);           // Should print: 2
    
    // Reset static counter
    Counter.reset();
    let finalCount: int = Counter.getCount();
    println(finalCount);    // Should print: 0
    
    return 0;
}
