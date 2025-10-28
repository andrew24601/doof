// Test boundary conditions and edge cases

// Empty collections


// Null and undefined handling


// Zero and negative numbers


// String edge cases


// Boolean edge cases


// Large numbers (within safe integer range)


// Function with no parameters and no return
    // This function intentionally does nothing


// Array with single element

// Object with single property

    function doNothing(): void {
    }

function main(): int {
    let result = "";
    let emptyArray: int[] = [];
    let emptyMap: Map<string, int> = {};
    let emptySet: Set<string> = {};
    result = result + emptyArray.length + "|";
    result = result + emptyMap.size + "|";
    result = result + emptySet.size + "|";
    let nullValue: string | null = null;
    let undefinedValue: string | null = null;
    result = result + (nullValue == null ? "N" : "X") + "|";
    result = result + (undefinedValue == null ? "U" : "X") + "|";
    let zero = 0;
    let negative = -42;
    let positive = 42;
    result = result + (zero == 0 ? "Z" : "X") + "|";
    result = result + (negative < 0 ? "NEG" : "POS") + "|";
    result = result + (positive > 0 ? "POS" : "NEG") + "|";
    let emptyString = "";
    let whitespace = "   ";
    let singleChar = "a";
    result = result + emptyString.length + "|";
    result = result + whitespace.length + "|";
    result = result + singleChar.length + "|";
    let trueValue = true;
    let falseValue = false;
    result = result + (trueValue ? "T" : "F");
    result = result + (falseValue ? "T" : "F");
    let largePositive = 1000000;
    let largeNegative = -1000000;
    result = result + (largePositive > 999999 ? "LP" : "X");
    result = result + (largeNegative < -999999 ? "LN" : "X") + "|";
    doNothing(); // Should not affect result
    let singleElementArray = [42];
    result = result + singleElementArray[0] + "|";
    let singlePropObject:Map<string, string> = {key: "value"};
    result = result + singlePropObject["key"].length;
    println(result);
    return 0;
}