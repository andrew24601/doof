
function greet(name: string): string {
    return "Hello " + name;
}
function add(a: int, b: int): int {
    return a + b;
}
function multiply(x: int, y: int = 2): int {
    return x * y;
}
function factorial(n: int): int {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

function main(): int {
    let result = "";
    const appendToResult = (text: string): void => {
        result = result + text;
    };
    let greeting = greet("World");
    let sum = add(3, 4);
    let product1 = multiply(5, 2);
    let product2 = multiply(5, 3);
    let fact = factorial(4);
    appendToResult(greeting);
    appendToResult("|");
    appendToResult(string(sum));
    appendToResult("|");
    appendToResult(string(product1));
    appendToResult("|");
    appendToResult(string(product2));
    appendToResult("|");
    appendToResult(string(fact));
    println(result);
    return 0;
}