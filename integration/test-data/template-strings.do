// Test template string literals and interpolation


// Basic template string

// Template string with expressions

// Template string with function calls


// Multi-line template string

// Template string with calculations

// Nested template strings

    function getPrefix(): string {
        return "Mr.";
    }

function main(): int {
    let result = "";
    let name = "World";
    let age = 25;
    let active = true;
    let greeting = `Hello, ${name}!`;
    result = result + greeting + "|";
    let info = `Name: ${name}, Age: ${age}, Active: ${active ? "Yes" : "No"}`;
    result = result + info + "|";
    let fullGreeting = `${getPrefix()} ${name} is ${age} years old`;
    result = result + fullGreeting + "|";
    let multiline = `Line 1
    Line 2
    Line 3`;
    let lineCount = multiline.split("\n").length;
    result = result + lineCount + "|";
    let x = 10;
    let y = 5;
    let calculation = `${x} + ${y} = ${x + y}`;
    result = result + calculation + "|";
    let outer = `Outer: ${`Inner: ${name}`}`;
    result = result + outer;
    println(result);
    return 0;
}