// Test Map data structure operations

// Create new Map

// Set values

// Get values

// Check existence

// Size

// Delete

// Iteration over Map


// Clear map

function main(): int {
    let result = "";
    let map: Map<string, int> = {};
    map["one"] = 1;
    map.set("two", 2);
    map.set("three", 3);
    let value1 = map.get("one");
    let value2 = map.get("two");
    result = result + string(value1) + string(value2) + "|";
    let hasOne = map.has("one");
    let hasFour = map.has("four");
    result = result + (hasOne ? "1" : "0") + (hasFour ? "1" : "0") + "|";
    result = result + map.size + "|";
    map.delete("two");
    result = result + map.size + "|";
    let keySum = "";
    for (let key of map.keys()) {
        keySum = keySum + key[0];
    }
    result = result + keySum + "|";
    let valueSum = 0;
    for (let value of map.values()) {
        valueSum = valueSum + value;
    }
    result = result + valueSum + "|";
    map.clear();
    result = result + map.size;
    println(result);
    return 0;
}