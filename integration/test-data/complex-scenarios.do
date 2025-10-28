// Test complex nested scenarios and edge cases

// Deeply nested function calls with closures


// Complex object with nested methods and this binding


// Array of functions and dynamic dispatch


// Recursive data structure
    
    



// Multiple inheritance-like behavior with composition

class Flyable {
    fly(): string {
        return "flying";
    }
}

class Swimmable {
    swim(): string {
        return "swimming";
    }
}

class Duck {
    flyBehavior: Flyable = Flyable {};
    swimBehavior: Swimmable = Swimmable {};

    performFly(): string {
        return this.flyBehavior.fly();
    }

    performSwim(): string {
        return this.swimBehavior.swim();
    }
}

class TreeNode {
    value: int;
    left: TreeNode | null = null;
    right: TreeNode | null = null;

    // No explicit constructor supported; use object-literal initialization: TreeNode { value: 10 }
    sum(): int {
        let total = this.value;
        if (this.left != null) {
            total += this.left.sum();
        }
        if (this.right != null) {
            total += this.right.sum();
        }
        return total;
    }
}

// Extracted classes for complexObject (must be top-level)
class Operations {
    value: int;

    add(x: int): int {
        return this.value + x;
    }

    multiply(x: int): int {
        return this.value * x;
    }
}

class ComplexObject {
    value: int;
    operations: Operations;

    getValue(): int {
        return this.value;
    }

    chainedOperation(): int {
        return this.getValue() + 50;
    }
}

function inc(x: int): int { return x + 1; }
function dbl(x: int): int { return x * 2; }
function dec(x: int): int { return x - 1; }

function createNested(depth: int): (): string {
    if (depth <= 0) {
        return () => "base";
    }
    return () => depth + ":" + createNested(depth - 1)();
}

function main(): int {
    let result = "";
    let nested = createNested(3);
    result = result + nested() + "|";
    let ops: Operations = Operations { value: 0 };
    let complexObject: ComplexObject = ComplexObject { value: 100, operations: ops };
    complexObject.operations.value = 10; // Set value on operations
    result = result + ops.add(5) + "|";
    result = result + (complexObject.getValue() + 50) + "|";
    let chainResult = 5;
    chainResult = inc(chainResult);
    chainResult = dbl(chainResult);
    chainResult = dec(chainResult);
    result = result + chainResult + "|";
    let root: TreeNode = TreeNode { value: 10 };
    root.left = TreeNode { value: 5 };
    root.right = TreeNode { value: 15 };
    root.left!.left = TreeNode { value: 3 };
    root.left!.right = TreeNode { value: 7 };
    result = result + root.sum() + "|";
    let duck: Duck = Duck {};
    result = result + duck.performFly()[0] + duck.performSwim()[0];
    println(result);
    return 0;
}