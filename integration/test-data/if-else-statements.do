// Test various if-else statement forms
function main(): int {
    let result = "";

    // Basic if statement
    let x = 10;
    if (x > 5) {
        result = result + "greater";
    }

    // If-else statement
    let y = 3;
    if (y > 5) {
        result = result + "-big";
    } else {
        result = result + "-small";
    }

    // Nested if-else
    let z = 7;
    if (z > 10) {
        result = result + "-huge";
    } else if (z > 5) {
        result = result + "-medium";
    } else {
        result = result + "-tiny";
    }

    // Complex condition
    let a = 4;
    let b = 6;
    if (a > 2 && b < 10) {
        result = result + "-both";
    }

    // Simple ternary replacement
    let c = 8;
    if (c > 5) {
        result = result + "-yes";
    } else {
        result = result + "-no";
    }

    println(result);
    return 0;
}
