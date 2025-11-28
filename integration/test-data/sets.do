// Test Set data structure operations

// Create new Set

// Add values

// Size

// Check existence

// Delete

// Iteration over Set

// Set with numbers


// Clear set

function main(): int {
    let result = "";
    let set: Set<string> = [];
    set.add("apple");
    set.add("banana");
    set.add("cherry");
    set.add("apple"); // Duplicate, should be ignored
    result = result + set.size + "|";
    let hasApple = set.has("apple");
    let hasOrange = set.has("orange");
    result = result + (hasApple ? "1" : "0") + (hasOrange ? "1" : "0") + "|";
    set.delete("banana");
    result = result + set.size + "|";
    let totalLength = 0;
    for (let item of set) {
        totalLength = totalLength + item.length;
    }
    result = result + totalLength + "|";
    let numberSet: Set<int> = [];
    numberSet.add(1);
    numberSet.add(2);
    numberSet.add(3);
    numberSet.add(1); // Duplicate
    let numberSum = 0;
    for (let num of numberSet) {
        numberSum = numberSum + num;
    }
    result = result + numberSum + "|";
    set.clear();
    result = result + set.size;
    println(result);
    return 0;
}