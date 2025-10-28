// Test arrow functions and lambda expressions

// Basic arrow function

// Arrow function with block body

// Arrow function with no parameters

// Arrow function used in array operations

// Higher-order function

// Closure capturing variables


// Test all functions
    function applyTwice(fn: (x: int): int, value: int): int {
        return fn(fn(value));
    }
    function createMultiplier(factor: int): (x: int): int {
        return (x: int) => x * factor;
    }

function main(): int {
    let result = "";
    let square = (x: int):int => x * x;
    let cube = (x: int):int => {
        let temp = x * x;
        return temp * x;
    };
    let getRandom = () => 42;
    let ints = [1, 2, 3, 4];
    let doubled = ints.map(=> it * 2);
    let filtered = ints.filter( => it > 2);
    let multiplyBy3 = createMultiplier(3);
    result = result + square(4) + "|";
    result = result + cube(3) + "|";
    result = result + getRandom() + "|";
    result = result + doubled[0] + doubled[1] + "|";
    result = result + filtered[0] + filtered[1] + "|";
    result = result + applyTwice(square, 2) + "|";
    result = result + multiplyBy3(5);
    println(result);
    return 0;
}