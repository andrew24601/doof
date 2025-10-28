// Test union types and type narrowing

// Union type variable

// Type narrowing with typeof

// Change the value and test again

// Function that accepts union type

function processValue(input: int | string | bool): string {
    if (input is int) {
        return "N" + input;
    } else if (input is string) {
        return "S" + input;
    } else {
        return "B" + (input ? "T" : "F");
    }
}

function main(): int {
    let result = "";
    let value: int | string = 42;
    if (value is int) {
        result = result + "num:" + value + "|";
    } else {
        result = result + "str:" + value + "|";
    }
    value = "hello";
    if (value is int) {
        result = result + "num:" + value + "|";
    } else {
        result = result + "str:" + value + "|";
    }
    result = result + processValue(123) + "|";
    result = result + processValue("test") + "|";
    result = result + processValue(true) + "|";
    result = result + processValue(false);
    println(result);
    return 0;
}