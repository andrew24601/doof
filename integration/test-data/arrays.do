// Test comprehensive array operations

// Array creation and basic operations

// Array indexing

// Array methods


// Array iteration

// For-of with arrays

// Array concatenation

// Nested arrays

// Array with objects

class Point {
    x: int;
    y: int;
}

function main(): int {
    let result = "";
    let numbers = [1, 2, 3, 4, 5];
    let strings = ["hello", "world"];
    result = result + numbers[0] + "|";
    result = result + numbers[numbers.length - 1] + "|";
    numbers.push(6);
    result = result + numbers.length + "|";
    let popped = numbers.pop();
    result = result + popped + "|";
    let sum = 0;
    for (let i = 0; i < numbers.length; i++) {
        sum = sum + numbers[i];
    }
    result = result + sum + "|";
    let product = 1;
    for (let num of numbers) {
        product = product * num;
    }
    result = result + product + "|";
    let matrix = [[1, 2], [3, 4]];
    result = result + matrix[1][0] + "|";
    let coords:Point[] = [{x: 1, y: 2}, {x: 3, y: 4}];
    result = result + coords[0].x + coords[1].y;
    println(result);
    return 0;
}